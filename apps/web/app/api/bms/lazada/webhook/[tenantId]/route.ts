// =============================================================
// POST /api/bms/lazada/webhook/[tenantId] — Lazada webhook ต่อร้าน
// -------------------------------------------------------------
// ⚠️ SCAFFOLD — โครงนี้ทำตาม pattern เดียวกับ tiktok/shopee webhook
// (verify HMAC ด้วย channel_secret ของร้าน + parse body → pipeline → log inbox)
// แต่ "ชื่อ field ใน body" และ "scheme การ verify signature" ด้านล่าง
// เป็นการเดา ยังไม่เคยตรวจกับเอกสาร Lazada Open Platform จริง —
// ต้องแก้ parseLazadaMessages() + header signature ให้ตรง spec จริงก่อนใช้ production
// (Lazada Open Platform ใช้ OAuth + HMAC-SHA256 บน app_secret เรียงพารามิเตอร์เฉพาะ
//  ไม่ใช่ channel_secret ต่อร้านแบบนี้ตรง ๆ — ต้องตรวจสอบก่อน)
// send API (ตอบกลับลูกค้าใน Lazada Chat) ยังไม่ implement (roadmap)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation, logInboundMessage, type Attachment } from "@/lib/bms/inbox";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import crypto from "crypto";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LazadaMessage = {
  id?: string;
  message_id?: string;
  buyer_id?: string;
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

function parseLazadaMessages(body: any): LazadaMessage[] {
  // TODO(prod): แทนที่ด้วย mapping จริงตาม payload ของ Lazada Open Platform
  if (Array.isArray(body?.messages)) return body.messages;
  if (body?.data) return [body.data];
  return [];
}

function lazadaMessageType(message: LazadaMessage): string {
  return message.message_type ?? message.type ?? message.content?.type ?? "attachment";
}

function lazadaAttachment(message: LazadaMessage): Attachment | null {
  const url = message.content?.url ?? message.content?.media_url ?? message.content?.image_url ?? message.content?.file_url ?? null;
  if (!url) return null;
  return {
    url,
    name: message.content?.file_name ?? `${lazadaMessageType(message)} from Lazada`,
    mimeType: message.content?.mime_type ?? null,
  };
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = await rateLimit(`lazada:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "lazada");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const raw = await req.text();
  // TODO(prod): ยืนยัน scheme จริงจาก Lazada Open Platform ก่อนใช้ — โครงนี้เป็น placeholder
  // fail-closed: channel active ต้องมี channel_secret เสมอ ไม่งั้นใครก็ปลอม request เข้ามาได้
  // (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่ ไม่ใช่ fallback ที่ตั้งใจ)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, "lazada");
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const sig = req.headers.get("x-lazada-signature") || req.headers.get("authorization");
  const mac = crypto.createHmac("sha256", cfg.channel_secret).update(raw).digest("hex");
  if (!sig || sig !== mac) {
    await recordWebhookVerifyFailed(tenantId, "lazada");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  const messages = parseLazadaMessages(body);

  const replies = [];
  for (const m of messages) {
    const text = (m.content?.text ?? m.message ?? "").trim();
    if (!(await claimInboundEvent(tenantId, "lazada", m.message_id ?? m.id))) {
      replies.push({ userId: m.buyer_id ?? m.sender_id, duplicate: true });
      continue;
    }
    const userId = m.buyer_id ?? m.sender_id ?? null;
    if (!text) {
      const attachment = lazadaAttachment(m);
      await logInboundMessage(tenantId, "lazada", userId, {
        body: attachment ? "" : `[ข้อความ Lazada ชนิด ${lazadaMessageType(m)}]`,
        attachment,
        meta: {
          type: lazadaMessageType(m),
          providerMessageId: m.message_id ?? m.id ?? null,
          unsupportedForAi: true,
          raw: { hasAttachment: Boolean(attachment) },
        },
      });
      replies.push({ userId, logged: lazadaMessageType(m) });
      continue;
    }

    const result = await runPipeline(text, "lazada", tenantId, userId);

    await logConversation(tenantId, "lazada", userId, text, result.reply, result.quality);

    // TODO(prod): ยิงกลับผ่าน Lazada Chat API ด้วย cfg.access_token (ยังไม่ implement)
    replies.push({ userId, reply: result.reply });
  }
  if (replies.length > 0) await recordInboundEvent(tenantId, "lazada");

  return NextResponse.json({ ok: true, tenantId, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/lazada/webhook/[tenantId]", handlePOST);
