import { NextResponse, type NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { rateLimit } from "@/lib/bms/rateLimit";
import { readBoundedWebhookText } from "@/lib/bms/webhookBody";
import { recordSupportEventsDetailed } from "@/lib/bms/supportDiagnostics";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";

async function handlePOST(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const token = bearer || req.headers.get("x-pos-device-token")?.trim() || "";
  const device = await authenticatePosDevice(token);
  if (!device) {
    return NextResponse.json(
      { error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" },
      { status: 401 },
    );
  }

  const limit = await rateLimit(
    `pos-support-events:${device.tenantId}:${device.id}`,
    60,
    60_000,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many diagnostic batches", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const payload = await readBoundedWebhookText(req, 256 * 1024);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  let body: { events?: unknown };
  try { body = JSON.parse(payload.text); }
  catch { return NextResponse.json({ error: "invalid JSON payload" }, { status: 400 }); }
  const events = Array.isArray(body?.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ error: "events required" }, { status: 400 });

  const result = await recordSupportEventsDetailed({
    tenantId: device.tenantId,
    actorId: `pos:${device.id}`,
    events: events.map((event: any) => ({
      ...event,
      // A delayed client timestamp before the device's latest edit cannot prove
      // which branch it belonged to then. Allow the full accepted clock skew
      // before attributing a branch; null is safer than a false branch history.
      locationId: Number.isFinite(Date.parse(event?.occurredAt))
        && device.updatedAt && Date.parse(event.occurredAt) >= Date.parse(device.updatedAt) + 5 * 60_000
        ? device.locationId : null,
      deviceId: device.id,
      category: "pos",
      sessionId: null,
      context: {
        ...(event?.context && typeof event.context === "object" ? event.context : {}),
        source: event?.context?.source === "desktop-pos" ? "desktop-pos" : "native-pos",
      },
    })),
  });
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/pos/diagnostics/events", handlePOST);
