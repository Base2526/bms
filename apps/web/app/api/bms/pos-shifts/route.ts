import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { isPosShiftOverviewDate, listPosShiftOverview } from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readParam(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  return value || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("pos.shift.report.all");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const params = req.nextUrl.searchParams;
  const from = readParam(params, "from");
  const to = readParam(params, "to");
  const locationId = readParam(params, "locationId");
  const deviceId = readParam(params, "deviceId");
  const personId = readParam(params, "personId");
  if ((from && !isPosShiftOverviewDate(from)) || (to && !isPosShiftOverviewDate(to))) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  }
  if ([locationId, deviceId, personId].some((value) => value && !UUID_RE.test(value))) {
    return NextResponse.json({ error: "invalid filter id" }, { status: 400 });
  }
  const status = readParam(params, "status");
  const signal = readParam(params, "signal");
  if (status && status !== "ALL" && status !== "OPEN" && status !== "CLOSED") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const signals = ["ALL", "VARIANCE", "STALE_OPEN", "PENDING_REFUND", "OPEN_EXPENSE", "RETURN", "VOID", "NO_SALE"];
  if (signal && !signals.includes(signal)) {
    return NextResponse.json({ error: "invalid signal" }, { status: 400 });
  }
  const result = await listPosShiftOverview(auth.tenantId, {
    openedFrom: from,
    openedTo: to,
    locationId,
    deviceId,
    personId,
    status: status === "OPEN" || status === "CLOSED" ? status : "ALL",
    signal: signal === "VARIANCE" || signal === "STALE_OPEN" || signal === "PENDING_REFUND" ||
      signal === "OPEN_EXPENSE" || signal === "RETURN" || signal === "VOID" || signal === "NO_SALE"
        ? signal
        : "ALL",
    limit: Number(params.get("limit") ?? 30),
    offset: Number(params.get("offset") ?? 0),
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const GET = withRouteErrorLog("GET /api/bms/pos-shifts", handleGET);
