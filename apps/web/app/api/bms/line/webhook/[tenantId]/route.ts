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
import { logConversation, notifyInboxConversationChanged } from "@/lib/bms/inbox";
import { syncLineBotInfo, syncLineUserProfile } from "@/lib/bms/lineProfile";
import { recordInboundEvent, recordWebhookVerifyFailed, recordOutboundSuccess, recordOutboundError, formatOutboundErrorDetail } from "@/lib/bms/channelHealth";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { id?: string; type: string; text?: string };
};

async function pushLineReply(tenantId: string, token: string, replyToken: string, text: string) {
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (resp.ok) {
      await recordOutboundSuccess(tenantId, "line");
    } else {
      const detail = formatOutboundErrorDetail(resp, await resp.text().catch(() => ""));
      await recordOutboundError(tenantId, "line", resp.status, detail);
    }
  } catch (e) {
    console.error("[BMS] LINE push failed:", e);
  }
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
    if (!ok) {
      await recordWebhookVerifyFailed(tenantId, "line");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as { events?: LineEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];

  const replies = [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;
    const text = ev.message.text?.trim() ?? "";
    if (!text) continue;
    if (!(await claimInboundEvent(tenantId, "line", ev.message.id ?? ev.replyToken))) {
      replies.push({ replyToken: ev.replyToken, duplicate: true });
      continue;
    }

    const userId = ev.source?.userId ?? null;
    const result = await runPipeline(text, "line", tenantId, userId);

    // บันทึกลง inbox (เข้า+ออก) — best-effort
    await logConversation(tenantId, "line", userId, text, result.reply, result.quality);

    // ตอบกลับด้วย token ของร้าน (ถ้ามี)
    if (cfg.access_token && ev.replyToken) {
      await pushLineReply(tenantId, cfg.access_token, ev.replyToken, result.reply);
    }

    // Best-effort LINE profile cache. This is intentionally after the
    // Inbox write/reply path: profile sync must never block the sale-critical
    // message from appearing in Inbox.
    if (userId && cfg.access_token) {
      const profileSync = await syncLineUserProfile(tenantId, userId, cfg.access_token);
      if (profileSync.ok) {
        for (const conversationId of profileSync.conversationIds) {
          notifyInboxConversationChanged(tenantId, conversationId, "CONVERSATION_CHANGED");
        }
      } else if (!profileSync.skipped) {
        console.warn("[BMS] LINE profile sync skipped/failed:", {
          tenantId,
          status: profileSync.status,
          error: profileSync.error,
        });
      }
      const botInfoSync = await syncLineBotInfo(tenantId, cfg.access_token);
      if (!botInfoSync.ok && !botInfoSync.skipped) {
        console.warn("[BMS] LINE bot info sync skipped/failed:", {
          tenantId,
          status: botInfoSync.status,
          error: botInfoSync.error,
        });
      }
    }
    replies.push({ replyToken: ev.replyToken, reply: result.reply });
  }

  if (replies.length > 0) await recordInboundEvent(tenantId, "line");

  return NextResponse.json({ ok: true, tenantId, replies });
}
