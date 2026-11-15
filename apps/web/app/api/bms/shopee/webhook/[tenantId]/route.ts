// =============================================================
// POST /api/bms/shopee/webhook/[tenantId] — Shopee webhook ต่อร้าน
// -------------------------------------------------------------
// ⚠️ SCAFFOLD — โครงนี้ทำตาม pattern เดียวกับ tiktok webhook (verify
// HMAC ด้วย channel_secret ของร้าน + parse body → log inbox)
// แต่ "ชื่อ field ใน body" และ "scheme การ verify signature" ด้านล่าง
// เป็นการเดา ยังไม่เคยตรวจกับเอกสาร Shopee Open Platform จริง —
// ต้องแก้ parseShopeeMessages() + header signature ให้ตรง spec จริงก่อนใช้ production
// (Shopee Open Platform ใช้ OAuth + HMAC-SHA256 บน partner_key เป็นหลัก
//  ไม่ใช่ channel_secret ต่อร้านแบบนี้ตรง ๆ — ต้องตรวจสอบก่อน)
// send API (ตอบกลับลูกค้าใน Shopee Chat) ยังไม่ implement (roadmap)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logInboundMessage, type Attachment } from "@/lib/bms/inbox";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import crypto from "crypto";
import { claimInboundEvent, releaseUnprocessedInboundEvent } from "@/lib/bms/inboundEvents";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShopeeMessage = {
  id?: string;
  message_id?: string;
  from_id?: string;
  sender_id?: string;
  type?: string;
  message_type?: string;
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
  message?: string;
};

function parseShopeeMessages(body: any): ShopeeMessage[] {
  // TODO(prod): แทนที่ด้วย mapping จริงตาม payload ของ Shopee Open Platform
  if (Array.isArray(body?.messages)) return body.messages;
  if (body?.data) return [body.data];
  return [];
}

function shopeeMessageType(message: ShopeeMessage): string {
  return message.message_type ?? message.type ?? message.content?.type ?? "attachment";
}

function shopeeAttachment(message: ShopeeMessage): Attachment | null {
  const url = message.content?.url ?? message.content?.media_url ?? message.content?.image_url ?? message.content?.file_url ?? null;
  if (!url) return null;
  return {
    url,
    name: message.content?.file_name ?? `${shopeeMessageType(message)} from Shopee`,
    mimeType: message.content?.mime_type ?? null,
  };
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = await rateLimit(`shopee:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "shopee");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const raw = await req.text();
  // TODO(prod): ยืนยัน scheme จริงจาก Shopee Open Platform ก่อนใช้ — โครงนี้เป็น placeholder
  // fail-closed: channel active ต้องมี channel_secret เสมอ ไม่งั้นใครก็ปลอม request เข้ามาได้
  // (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่ ไม่ใช่ fallback ที่ตั้งใจ)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, "shopee");
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const sig = req.headers.get("x-shopee-signature") || req.headers.get("authorization");
  const mac = crypto.createHmac("sha256", cfg.channel_secret).update(raw).digest("hex");
  if (!sig || sig !== mac) {
    await recordWebhookVerifyFailed(tenantId, "shopee");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  const messages = parseShopeeMessages(body);

  const replies = [];
  for (const m of messages) {
    const sender = m?.from_id ?? m?.sender_id;
    if ((typeof sender !== "string" && typeof sender !== "number") || !String(sender).trim())
      return NextResponse.json({ error: "sender required" }, { status: 400 });
    const rawText = m.content?.text ?? m.message ?? "";
    if (typeof rawText !== "string") return NextResponse.json({ error: "invalid message text" }, { status: 400 });
    const text = rawText.trim();
    const eventId = m.message_id ?? m.id;
    if ((typeof eventId !== "string" && typeof eventId !== "number") || !String(eventId).trim())
      return NextResponse.json({ error: "message id required" }, { status: 400 });
    if (!(await claimInboundEvent(tenantId, "shopee", eventId))) {
      replies.push({ userId: String(sender), duplicate: true });
      continue;
    }
    const userId = String(sender);
    const attachment = text ? null : shopeeAttachment(m);
    const savedConversationId = await logInboundMessage(tenantId, "shopee", userId, {
      body: text || (attachment ? "" : `[ข้อความ Shopee ชนิด ${shopeeMessageType(m)}]`),
      attachment,
      meta: {
        type: text ? "text" : shopeeMessageType(m),
        providerMessageId: eventId,
        unsupportedForAi: true,
        raw: { hasAttachment: Boolean(attachment) },
      },
    });
    if (!savedConversationId) {
      await releaseUnprocessedInboundEvent(tenantId, "shopee", eventId);
      throw new Error("SHOPEE_INBOUND_PERSIST_FAILED");
    }
    replies.push({ userId, logged: text ? "text" : shopeeMessageType(m) });
  }
  if (replies.length > 0) await recordInboundEvent(tenantId, "shopee");

  return NextResponse.json({ ok: true, tenantId, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/shopee/webhook/[tenantId]", handlePOST);
