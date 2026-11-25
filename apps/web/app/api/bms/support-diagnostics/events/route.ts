import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { recordSupportEventsDetailed } from "@/lib/bms/supportDiagnostics";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("support.logs.view");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden", requiredPermission: "support.logs.view" },
      { status: auth.status }
    );
  }
  const limit = await rateLimit(`support-events:${auth.tenantId}:${auth.adminId}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many diagnostic batches", retryAfter: limit.retryAfter },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }
  const body = await req.json().catch(() => ({}));
  const events = Array.isArray(body?.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ error: "events required" }, { status: 400 });
  if (events.some((event: unknown) => event != null && typeof event === "object"
    && (event as { category?: unknown }).category === "pos")) {
    return NextResponse.json({ error: "POS events require a paired device" }, { status: 400 });
  }
  const result = await recordSupportEventsDetailed({
    tenantId: auth.tenantId,
    actorId: String(auth.adminId),
    events,
  });
  return NextResponse.json({ ...result, inserted: result.accepted });
}

export const POST = withRouteErrorLog("POST /api/bms/support-diagnostics/events", handlePOST);
