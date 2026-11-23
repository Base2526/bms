// =============================================================
// POST /api/bms/tiktok/webhook — TikTok DM webhook (mock)
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/tiktok/webhook \
//     -H "content-type: application/json" \
//     -d '{"messages":[{"id":"dev-1","user_id":"u123","content":{"text":"Adidas XL มีไหม"}}]}'
// โครงสร้าง event ต่างจาก LINE; TikTok ยังไม่มีช่องทางตอบกลับจาก BMS
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { claimInboundEvent, releaseUnprocessedInboundEvent } from "@/lib/bms/inboundEvents";
import { logInboundMessage } from "@/lib/bms/inbox";
import { rateLimit } from "@/lib/bms/rateLimit";
import { readBoundedWebhookText } from "@/lib/bms/webhookBody";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * mock ยุคร้านเดียว — ไม่มี signature ให้ verify และเขียนเข้าร้าน default ตายตัว
 *
 * ปล่อยไว้ใน production คือให้ใครก็ยิงข้อความปลอมเข้ากล่องข้อความของร้าน default
 * การบันทึกข้อความปลอมจะรบกวน Inbox ของร้าน default แม้ไม่เรียก AI
 * ทางจริงคือ webhook ต่อร้านที่ verify ลายเซ็นแบบ fail-closed:
 * `/api/bms/{channel}/webhook/[tenantId]` — ตัวนี้เหลือไว้ให้ curl ตอน dev เท่านั้น
 */
function mockWebhookDisabled() {
  return process.env.NODE_ENV === "production";
}


type TikTokMessage = {
  id?: string;
  message_id?: string;
  user_id?: string;
  type?: string;
  message_type?: string;
  content?: { text?: string; type?: string };
};

function tiktokMessageType(message: TikTokMessage): string {
  return message.message_type ?? message.type ?? message.content?.type ?? "attachment";
}

async function handlePOST(req: NextRequest) {
  if (mockWebhookDisabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const limit = await rateLimit("dev-mock-webhook:tiktok", 20, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "rate limit exceeded" }, {
    status: 429, headers: { "retry-after": String(limit.retryAfter) },
  });
  const payload = await readBoundedWebhookText(req, 64 * 1024);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  let body: { messages?: TikTokMessage[] };
  try { body = JSON.parse(payload.text); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "JSON object required" }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length > 200) return NextResponse.json({ error: "too many messages" }, { status: 400 });

  const replies = [];
  for (const m of messages) {
    const customerRef = m?.user_id;
    const eventId = m?.message_id ?? m?.id;
    if (typeof customerRef !== "string" || !customerRef.trim() ||
      typeof eventId !== "string" || !eventId.trim() ||
      (m.content?.text != null && typeof m.content.text !== "string")) {
      return NextResponse.json({ error: "invalid message event" }, { status: 400 });
    }
    const text = m.content?.text?.trim() ?? "";
    if (!(await claimInboundEvent(DEFAULT_TENANT_ID, "tiktok", eventId))) {
      replies.push({ userId: customerRef, duplicate: true });
      continue;
    }
    const saved = await logInboundMessage(DEFAULT_TENANT_ID, "tiktok", customerRef, {
      body: text || `[ข้อความ TikTok ชนิด ${tiktokMessageType(m)}]`,
      meta: { type: text ? "text" : tiktokMessageType(m), providerMessageId: eventId, unsupportedForAi: true },
    });
    if (!saved) {
      await releaseUnprocessedInboundEvent(DEFAULT_TENANT_ID, "tiktok", eventId);
      throw new Error("TIKTOK_INBOUND_PERSIST_FAILED");
    }
    replies.push({ userId: customerRef, logged: text ? "text" : tiktokMessageType(m) });
  }

  return NextResponse.json({ ok: true, replies });
}

export const POST = withRouteErrorLog("POST /api/bms/tiktok/webhook", handlePOST);
