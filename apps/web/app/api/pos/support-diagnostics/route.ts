import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import {
  authenticatePosDevice,
  cashierHasPermission,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { rateLimit } from "@/lib/bms/rateLimit";
import {
  buildSupportBundle,
  recordSupportBundleExport,
  recordSupportEvents,
  sendSupportBundle,
} from "@/lib/bms/supportDiagnostics";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const permission = action === "events" ? "support.logs.view"
    : action === "export" ? "support.logs.export"
    : action === "send" ? "support.logs.send"
    : null;
  if (!permission) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  const userId = String(body?.cashierUserId ?? "").trim();
  const pin = typeof body?.cashierPin === "string" ? body.cashierPin : "";
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  const actor = await verifyCashierPin(device.tenantId, userId, pin);
  if (!actor.ok) return NextResponse.json({ error: actor.reason === "LOCKED" ? "บัญชีถูกล็อกชั่วคราว" : "PIN ไม่ถูกต้อง" }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, actor.userId, permission))) {
    return NextResponse.json({ error: `ไม่มีสิทธิ์ ${permission}` }, { status: 403 });
  }

  const limit = await rateLimit(
    `pos-support:${device.tenantId}:${device.id}:${actor.userId}:${action}`,
    action === "events" ? 30 : 5,
    60_000
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "ทำรายการถี่เกินไป", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  if (action === "events") {
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!events.length) return NextResponse.json({ error: "events required" }, { status: 400 });
    const inserted = await recordSupportEvents({
      tenantId: device.tenantId,
      actorId: String(actor.userId),
      events: events.map((event: Record<string, unknown>) => ({
        ...event,
        deviceId: device.id,
        locationId: device.locationId,
      })),
    });
    return NextResponse.json({ inserted });
  }

  const from = typeof body?.from === "string" ? body.from : null;
  const to = typeof body?.to === "string" ? body.to : null;
  if (action === "export") {
    const bundle = await buildSupportBundle({ tenantId: device.tenantId, actorId: String(actor.userId), from, to });
    const bundleId = await recordSupportBundleExport({ tenantId: device.tenantId, actorId: String(actor.userId), bundle });
    const truncatedSources = Object.entries(bundle.manifest.truncated)
      .filter(([, truncated]) => truncated)
      .map(([source]) => source)
      .join(",");
    return new NextResponse(new Uint8Array(bundle.buffer), {
      headers: {
        "content-type": "application/gzip",
        "content-disposition": `attachment; filename="support-diagnostics-${bundleId}.ndjson.gz"`,
        "x-support-bundle-id": bundleId,
        "x-content-sha256": bundle.checksum,
        "x-support-truncated": truncatedSources,
        "cache-control": "private, no-store",
      },
    });
  }

  if (body?.confirmed !== true) return NextResponse.json({ error: "explicit confirmation required" }, { status: 400 });
  const description = String(body?.description ?? "").trim();
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
  const email = await query<{ email: string }>(
    `SELECT email FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [device.tenantId, actor.userId]
  );
  const result = await sendSupportBundle({
    tenantId: device.tenantId,
    actorId: String(actor.userId),
    actorEmail: String(email.rows[0]?.email ?? "pos-support@invalid.local"),
    description,
    from,
    to,
  });
  return NextResponse.json(result, { status: 201 });
}

export const POST = withRouteErrorLog("POST /api/pos/support-diagnostics", handlePOST);
