// =============================================================
// POST /api/bms/tiktok/webhook/[tenantId] — TikTok webhook ต่อร้าน
// -------------------------------------------------------------
// verify signature ด้วย channel_secret ของร้าน; บันทึก Inbox เพื่อให้คนตอบใน TikTok เอง
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logInboundMessage, type Attachment } from "@/lib/bms/inbox";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import { verifyHexHmacSignature } from "@/lib/bms/crypto";
import { claimInboundEvent, releaseUnprocessedInboundEvent } from "@/lib/bms/inboundEvents";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readBoundedWebhookText } from "@/lib/bms/webhookBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TikTokMessage = {
  id?: string;
  message_id?: string;
  user_id?: string;
  message_type?: string;
  type?: string;
  content?: {
    text?: string;
    type?: string;
    url?: string;
    media_url?: string;
    image_url?: string;
    file_url?: string;
    file_name?: string;
    mime_type?: string;
  };
};

function tiktokMessageType(message: TikTokMessage): string {
  return message.message_type ?? message.type ?? message.content?.type ?? "attachment";
}

function tiktokAttachment(message: TikTokMessage): Attachment | null {
  const url = message.content?.url ?? message.content?.media_url ?? message.content?.image_url ?? message.content?.file_url ?? null;
  if (!url) return null;
  return {
    url,
    name: message.content?.file_name ?? `${tiktokMessageType(message)} from TikTok`,
    mimeType: message.content?.mime_type ?? null,
  };
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const tenantId = (await params).tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = await rateLimit(`tiktok:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "tiktok");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const payload = await readBoundedWebhookText(req, 1024 * 1024);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const raw = payload.text;
  // TikTok: HMAC-SHA256 hex ใน header — fail-closed: channel active ต้องมี channel_secret เสมอ
  // ไม่งั้นใครก็ปลอม request เข้ามาได้ (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, "tiktok");
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const sig = req.headers.get("x-tiktok-signature") || req.headers.get("x-signature");
  if (!verifyHexHmacSignature(cfg.channel_secret, raw, sig)) {
    await recordWebhookVerifyFailed(tenantId, "tiktok");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: { messages?: TikTokMessage[] };
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid JSON payload" }, { status: 400 }); }
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  const messages = body.messages;
  if (messages.length > 200) return NextResponse.json({ error: "too many messages" }, { status: 413 });

  // Validate the complete batch before claiming any event. A malformed later item
  // must not leave earlier messages committed behind a 400 provider retry.
  for (const m of messages) {
    const sender = m?.user_id;
    if ((typeof sender !== "string" && typeof sender !== "number") || !String(sender).trim())
      return NextResponse.json({ error: "sender required" }, { status: 400 });
    if (m.content?.text != null && typeof m.content.text !== "string")
      return NextResponse.json({ error: "invalid message text" }, { status: 400 });
    const eventId = m.message_id ?? m.id;
    if ((typeof eventId !== "string" && typeof eventId !== "number") || !String(eventId).trim())
      return NextResponse.json({ error: "message id required" }, { status: 400 });
  }

  const replies = [];
  for (const m of messages) {
    const sender = m.user_id!;
    const text = m.content?.text?.trim() ?? "";
    const eventId = m.message_id ?? m.id;
    if (!(await claimInboundEvent(tenantId, "tiktok", eventId))) {
      replies.push({ userId: String(sender), duplicate: true });
      continue;
    }
    const userId = String(sender);
    // No outbound API is implemented. Running AI here could commit a business
    // action that the customer never sees or confirms, so staff handle all turns.
    // A caption can accompany media; preserve both for staff review.
    const attachment = tiktokAttachment(m);
    const savedConversationId = await logInboundMessage(tenantId, "tiktok", userId, {
      body: text || (attachment ? "" : `[ข้อความ TikTok ชนิด ${tiktokMessageType(m)}]`),
      attachment,
      meta: {
        type: text ? "text" : tiktokMessageType(m),
        providerMessageId: eventId,
        unsupportedForAi: true,
        raw: { hasAttachment: Boolean(attachment) },
      },
    });
    if (!savedConversationId) {
      await releaseUnprocessedInboundEvent(tenantId, "tiktok", eventId);
      throw new Error("TIKTOK_INBOUND_PERSIST_FAILED");
    }
    replies.push({ userId, logged: text ? "text" : tiktokMessageType(m) });
  }
  if (replies.length > 0) await recordInboundEvent(tenantId, "tiktok");

  return NextResponse.json({ ok: true, tenantId, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/tiktok/webhook/[tenantId]", handlePOST);
