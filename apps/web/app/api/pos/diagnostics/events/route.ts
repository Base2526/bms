import { NextResponse, type NextRequest } from "next/server";
import { authenticatePosDevice } from "@/lib/bms/pos";
import { rateLimit } from "@/lib/bms/rateLimit";
import { recordSupportEvents } from "@/lib/bms/supportDiagnostics";
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

  const body = await req.json().catch(() => ({}));
  const events = Array.isArray(body?.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ error: "events required" }, { status: 400 });

  const inserted = await recordSupportEvents({
    tenantId: device.tenantId,
    actorId: `pos:${device.id}`,
    events: events.map((event: any) => ({
      ...event,
      locationId: device.locationId,
      deviceId: device.id,
      category: "pos",
      context: {
        ...(event?.context && typeof event.context === "object" ? event.context : {}),
        source: "native-pos",
      },
    })),
  });
  return NextResponse.json({ inserted });
}

export const POST = withRouteErrorLog("POST /api/pos/diagnostics/events", handlePOST);
