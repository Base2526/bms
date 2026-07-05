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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { events?: LineEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];

  const replies = [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;
    const text = ev.message.text?.trim() ?? "";
    if (!text) continue;

    const result = await runPipeline(text, "line", ev.source?.userId ?? null);
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
