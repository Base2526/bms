// =============================================================
// /api/bms/facebook/webhook/[tenantId] — Facebook Messenger webhook ต่อร้าน
// -------------------------------------------------------------
//   GET  = verification (hub.challenge) ตอนตั้งใน Meta App
//   POST = ข้อความเข้า → pipeline → log inbox → ตอบผ่าน Graph Send API
//   verify X-Hub-Signature-256 ด้วย App Secret (channel_secret ของร้าน)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getChannel } from "@/lib/bms/channels";
import { verifyMetaSignature } from "@/lib/bms/crypto";
import { rateLimit } from "@/lib/bms/rateLimit";
import { metaChallenge, metaEnvelopeMatches, parseMetaEvents, parseMetaInboxSignals } from "@/lib/bms/meta";
import { applyMetaInboxSignals } from "@/lib/bms/metaInboxSignals";
import { recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import { enqueueMetaInboundEvents, runMetaInboundBatch } from "@/lib/bms/metaInboundJobs";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = "facebook";

async function handleGET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const cfg = await getChannel(params.tenantId?.trim(), CHANNEL);
  const challenge = metaChallenge(new URL(req.url), cfg);
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const rl = await rateLimit(`${CHANNEL}:${tenantId}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });

  const cfg = await getChannel(tenantId, CHANNEL);
  if (!cfg || !cfg.active) return NextResponse.json({ ok: true, skipped: "channel not configured" });
  if (!cfg.external_account_id || !cfg.webhook_verify_token) {
    return NextResponse.json({ error: "Meta Page ID / webhook verify token not configured" }, { status: 503 });
  }

  const raw = await req.text();
  // fail-closed: channel active ต้องมี channel_secret เสมอ ไม่งั้นใครก็ปลอม request เข้ามาได้
  // (เดิมข้ามการ verify ไปเลยถ้าไม่มี secret — เป็นช่องโหว่ ไม่ใช่ fallback ที่ตั้งใจ)
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  const ok = verifyMetaSignature(cfg.channel_secret, raw, req.headers.get("x-hub-signature-256"));
  if (!ok) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  if (!metaEnvelopeMatches(body, cfg.external_account_id)) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "Meta Page does not match this tenant" }, { status: 403 });
  }
  const events = parseMetaEvents(body, cfg.external_account_id);
  const signals = parseMetaInboxSignals(body, cfg.external_account_id);
  const signalResult = await applyMetaInboxSignals(tenantId, CHANNEL, signals);
  const queued = await enqueueMetaInboundEvents(tenantId, CHANNEL, events);
  // Process the just-arrived tenant immediately for chat latency. The row already exists, so a
  // request interruption or process crash is recoverable by Meta retry and the cron worker.
  const work = events.length > 0
    ? await runMetaInboundBatch(Math.min(events.length, 25), tenantId)
    : { processed: 0, failed: 0, deadLettered: 0 };

  // The durable row makes an interrupted inline attempt recoverable without re-accepting effects.
  return NextResponse.json({ ok: true, tenantId, received: events.length, signals: signals.length,
    ...signalResult, ...queued, ...work });
}

export const GET = withRouteErrorLog("GET /api/bms/facebook/webhook/[tenantId]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/facebook/webhook/[tenantId]", handlePOST);
