// =============================================================
// /api/bms/instagram/webhook/[tenantId] — Instagram DM webhook ต่อร้าน
// -------------------------------------------------------------
// IG DM ใช้ Messenger Platform เดียวกับ Facebook (graph.facebook.com)
//   GET  = verification (hub.challenge)
//   POST = ข้อความเข้า → pipeline → log inbox → ตอบผ่าน Graph Send API
//   verify X-Hub-Signature-256 ด้วย App Secret (channel_secret ของร้าน)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runPipeline } from "@/lib/bms/pipeline";
import { getChannel } from "@/lib/bms/channels";
import { verifyMetaSignature } from "@/lib/bms/crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { logConversation, deliverToChannel } from "@/lib/bms/inbox";
import { metaChallenge, parseMetaEvents } from "@/lib/bms/meta";
import { recordInboundEvent, recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import { claimInboundEvent } from "@/lib/bms/inboundEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = "instagram";

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const cfg = await getChannel(params.tenantId?.trim(), CHANNEL);
  const challenge = metaChallenge(new URL(req.url), cfg);
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = rateLimit(`${CHANNEL}:${tenantId}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });

  const cfg = await getChannel(tenantId, CHANNEL);
  if (!cfg || !cfg.active) return NextResponse.json({ ok: true, skipped: "channel not configured" });

  const raw = await req.text();
  if (cfg.channel_secret) {
    const ok = verifyMetaSignature(cfg.channel_secret, raw, req.headers.get("x-hub-signature-256"));
    if (!ok) {
      await recordWebhookVerifyFailed(tenantId, CHANNEL);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  const events = parseMetaEvents(body);

  for (const ev of events) {
    if (!(await claimInboundEvent(tenantId, CHANNEL, ev.eventId))) continue;
    const result = await runPipeline(ev.text, CHANNEL, tenantId, ev.senderId);
    await logConversation(tenantId, CHANNEL, ev.senderId, ev.text, result.reply, result.quality);
    await deliverToChannel(tenantId, CHANNEL, ev.senderId, result.reply);
  }
  if (events.length > 0) await recordInboundEvent(tenantId, CHANNEL);

  return NextResponse.json({ ok: true, tenantId, handled: events.length });
}
