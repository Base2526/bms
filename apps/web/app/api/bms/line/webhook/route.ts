// =============================================================
// POST /api/bms/line/webhook — LINE Messaging API webhook (mock)
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/line/webhook \
//     -H "content-type: application/json" \
//     -d '{"events":[{"type":"message","replyToken":"tok","message":{"type":"text","text":"Nike XL มีไหม"}}]}'
// ช่วง mock: คืน reply ใน response (ยังไม่ push กลับ LINE จริง)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";
import { logConversation } from "@/lib/bms/inbox";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * mock ยุคร้านเดียว — ไม่มี signature ให้ verify และเขียนเข้าร้าน default ตายตัว
 *
 * ปล่อยไว้ใน production คือให้ใครก็ยิงข้อความปลอมเข้ากล่องข้อความของร้าน default
 * **และเรียก AI ให้ตอบทุกครั้ง** (ค่า token เป็นของเจ้าของระบบ ไม่ใช่ของผู้ยิง)
 * ทางจริงคือ webhook ต่อร้านที่ verify ลายเซ็นแบบ fail-closed:
 * `/api/bms/{channel}/webhook/[tenantId]` — ตัวนี้เหลือไว้ให้ curl ตอน dev เท่านั้น
 */
function mockWebhookDisabled() {
  return process.env.NODE_ENV === "production";
}


type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { id?: string; type: string; text?: string };
};

async function handlePOST(req: NextRequest) {
  if (mockWebhookDisabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { events?: LineEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];

  const replies = [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;
    const text = ev.message.text?.trim() ?? "";
    if (!text) continue;
    if (!(await claimInboundEvent(DEFAULT_TENANT_ID, "line", ev.message.id ?? ev.replyToken))) {
      replies.push({ replyToken: ev.replyToken, duplicate: true });
      continue;
    }

    const customerRef = ev.source?.userId ?? null;
    const result = await runPipeline(text, "line", DEFAULT_TENANT_ID, customerRef);
    await logConversation(DEFAULT_TENANT_ID, "line", customerRef, text, result.reply, result.quality);
    // TODO(prod): await pushLineReply(ev.replyToken, result.reply)
    replies.push({ replyToken: ev.replyToken, reply: result.reply });
  }

  return NextResponse.json({ ok: true, replies });
}

// --- ตัวอย่าง push กลับ LINE จริง (เปิดใช้ตอน integrate) ---------
// async function pushLineReply(replyToken: string | undefined, text: string) {
//   if (!replyToken) return;
//   await fetch("https://api.line.me/v2/bot/message/reply", {
//     method: "POST",
//     headers: {
//       "content-type": "application/json",
//       authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
//     },
//     body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
//   });
// }

export const POST = withRouteErrorLog("POST /api/bms/line/webhook", handlePOST);
