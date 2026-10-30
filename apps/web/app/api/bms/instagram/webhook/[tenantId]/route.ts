// Instagram DM uses the same tenant-bound Meta webhook queue as Facebook Messenger.
import { NextResponse, type NextRequest } from "next/server";

import { getChannel } from "@/lib/bms/channels";
import { recordWebhookVerifyFailed } from "@/lib/bms/channelHealth";
import { verifyMetaSignature } from "@/lib/bms/crypto";
import { metaChallenge, metaEnvelopeMatches, parseMetaEvents, parseMetaInboxSignals } from "@/lib/bms/meta";
import { applyMetaInboxSignals } from "@/lib/bms/metaInboxSignals";
import { enqueueMetaInboundEvents, runMetaInboundBatch } from "@/lib/bms/metaInboundJobs";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL = "instagram";

async function handleGET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const cfg = await getChannel(params.tenantId?.trim(), CHANNEL);
  const challenge = metaChallenge(new URL(req.url), cfg);
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

async function handlePOST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenant required" }, { status: 400 });

  const limited = await rateLimit(`${CHANNEL}:${tenantId}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const cfg = await getChannel(tenantId, CHANNEL);
  if (!cfg || !cfg.active) return NextResponse.json({ ok: true, skipped: "channel not configured" });
  if (!cfg.external_account_id || !cfg.webhook_verify_token) {
    return NextResponse.json({ error: "Meta account ID / webhook verify token not configured" }, { status: 503 });
  }

  const raw = await req.text();
  if (!cfg.channel_secret) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "channel secret not configured" }, { status: 401 });
  }
  if (!verifyMetaSignature(cfg.channel_secret, raw, req.headers.get("x-hub-signature-256"))) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
  if (!metaEnvelopeMatches(body, cfg.external_account_id, "instagram")) {
    await recordWebhookVerifyFailed(tenantId, CHANNEL);
    return NextResponse.json({ error: "Meta account does not match this tenant" }, { status: 403 });
  }
  const events = parseMetaEvents(body, cfg.external_account_id, "instagram");
  const signals = parseMetaInboxSignals(body, cfg.external_account_id, "instagram");
  const signalResult = await applyMetaInboxSignals(tenantId, CHANNEL, signals);
  const queued = await enqueueMetaInboundEvents(tenantId, CHANNEL, events);
  const work = events.length > 0
    ? await runMetaInboundBatch(Math.min(events.length, 25), tenantId)
    : { processed: 0, failed: 0, deadLettered: 0 };
  return NextResponse.json({ ok: true, tenantId, received: events.length, signals: signals.length,
    ...signalResult, ...queued, ...work });
}

export const GET = withRouteErrorLog("GET /api/bms/instagram/webhook/[tenantId]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/instagram/webhook/[tenantId]", handlePOST);
