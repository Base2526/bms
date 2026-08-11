// =============================================================
// POST /api/bms/tiktok/webhook/[tenantId] — TikTok webhook ต่อร้าน
// -------------------------------------------------------------
// verify signature ด้วย channel_secret ของร้าน (ถ้าตั้งไว้)
// โครง event ต่างจาก LINE จึง parse คนละแบบ แต่เข้า pipeline เดียวกัน
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation } from "@/lib/bms/inbox";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import crypto from "crypto";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TikTokMessage = { id?: string; message_id?: string; user_id?: string; content?: { text?: string } };

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = await rateLimit(`tiktok:${tenantId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const cfg = await getChannel(tenantId, "tiktok");
  if (!cfg || !cfg.active) {
    return NextResponse.json({ ok: true, skipped: "channel not configured" });
  }

  const raw = await req.text();
  // TikTok: HMAC-SHA256 hex ใน header — fail-closed: channel active ต้องมี channel_secret เสมอ
  // ไม่งั้นใครก็ปลอม request เข้ามาได้ (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, "tiktok");
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const sig = req.headers.get("x-tiktok-signature") || req.headers.get("x-signature");
  const mac = crypto.createHmac("sha256", cfg.channel_secret).update(raw).digest("hex");
  if (!sig || sig !== mac) {
    await recordWebhookVerifyFailed(tenantId, "tiktok");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })() as { messages?: TikTokMessage[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const replies = [];
  for (const m of messages) {
    const text = m.content?.text?.trim() ?? "";
    if (!text) continue;
    if (!(await claimInboundEvent(tenantId, "tiktok", m.message_id ?? m.id))) {
      replies.push({ userId: m.user_id, duplicate: true });
      continue;
    }
    const userId = m.user_id ?? null;
    const result = await runPipeline(text, "tiktok", tenantId, userId);

    // บันทึกลง inbox (เข้า+ออก) — best-effort
    await logConversation(tenantId, "tiktok", userId, text, result.reply, result.quality);

    // TODO(prod): ยิงกลับผ่าน TikTok Business Messaging API ด้วย cfg.access_token
    replies.push({ userId: m.user_id, reply: result.reply });
  }
  if (replies.length > 0) await recordInboundEvent(tenantId, "tiktok");

  return NextResponse.json({ ok: true, tenantId, replies });
}
