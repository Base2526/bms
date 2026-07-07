// =============================================================
// POST /api/bms/line/webhook/[tenantId] — LINE webhook ต่อร้าน
// -------------------------------------------------------------
// แต่ละร้านเอา URL นี้ไปใส่ใน LINE Developers Console ของตัวเอง
//   • verify X-Line-Signature ด้วย channel_secret ของร้าน
//   • ตอบกลับด้วย access_token ของร้าน (LINE reply API)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { verifyLineSignature } from "@/lib/bms/crypto";
import { rateLimit } from "@/lib/bms/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
};

async function pushLineReply(token: string, replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  }).catch((e) => console.error("[BMS] LINE push failed:", e));
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  // rate limit ต่อร้าน (กัน abuse / flood)
  const rl = rateLimit(`line:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "line");
  if (!cfg || !cfg.active) {
    // ยังไม่เชื่อม LINE — ตอบ 200 กัน LINE retry รัว ๆ
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  // ต้องอ่าน raw body เพื่อ verify signature
  const raw = await req.text();
  if (cfg.channel_secret) {
    const ok = verifyLineSignature(cfg.channel_secret, raw, req.headers.get("x-line-signature"));
    if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as { events?: LineEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];

  const replies = [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;
    const text = ev.message.text?.trim() ?? "";
    if (!text) continue;

    const result = await runPipeline(text, "line", tenantId, ev.source?.userId ?? null);

    // ตอบกลับด้วย token ของร้าน (ถ้ามี)
    if (cfg.access_token && ev.replyToken) {
      await pushLineReply(cfg.access_token, ev.replyToken, result.reply);
    }
    replies.push({ replyToken: ev.replyToken, reply: result.reply });
  }

  return NextResponse.json({ ok: true, tenantId, replies });
}
