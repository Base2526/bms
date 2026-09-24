import { NextResponse, type NextRequest } from "next/server";

import { rateLimit } from "@/lib/bms/rateLimit";
import { intakeDeliveryWebhook } from "@/lib/bms/deliveryPlatforms/webhooks";
import type { DeliveryProvider } from "@/lib/bms/deliveryPlatforms";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDERS: Readonly<Record<string, DeliveryProvider>> = {
  grabfood: "GRABFOOD",
  lineman: "LINEMAN",
  foodpanda: "FOODPANDA",
};

async function handlePOST(
  req: NextRequest,
  { params }: { params: { provider: string; integrationId: string } },
) {
  const provider = PROVIDERS[params.provider?.toLowerCase()];
  const integrationId = params.integrationId?.trim();
  if (!provider || !UUID.test(integrationId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const limited = await rateLimit(`delivery-webhook:${provider}:${integrationId}`, 240, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return NextResponse.json({ error: "invalid utf-8 payload" }, { status: 400 });
  }

  const result = await intakeDeliveryWebhook({ provider, integrationId, rawBody, headers: req.headers });
  switch (result.status) {
    case "ACCEPTED":
    case "DUPLICATE":
      return NextResponse.json({ ok: true, accepted: true, duplicate: result.duplicate }, { status: 202 });
    case "NOT_FOUND":
    case "PROVIDER_MISMATCH":
      return NextResponse.json({ error: "not found" }, { status: 404 });
    case "DISABLED":
      return NextResponse.json({ error: "integration disabled" }, { status: 503 });
    case "UNAUTHORIZED":
      return NextResponse.json({ error: "invalid webhook authentication" }, { status: 401 });
    case "CONTRACT_BLOCKED":
      return NextResponse.json({ error: "provider contract not configured" }, { status: 503 });
    case "CONFLICT":
      return NextResponse.json({ error: "event identity conflict" }, { status: 409 });
    default:
      return NextResponse.json({ error: "invalid webhook payload" }, { status: 400 });
  }
}

export const POST = withRouteErrorLog(
  "POST /api/bms/delivery/[provider]/webhook/[integrationId]",
  handlePOST,
);
