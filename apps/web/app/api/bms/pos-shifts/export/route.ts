import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getArShiftSummary } from "@/lib/bms/ar";
import { getPosShiftExportData } from "@/lib/bms/pos";
import { buildPosShiftWorkbook } from "@/lib/bms/posShiftExport";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("pos.shift.report.all");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const body = await req.json().catch(() => ({})) as { shiftId?: unknown };
  const shiftId = typeof body.shiftId === "string" ? body.shiftId.trim() : "";
  if (!UUID_RE.test(shiftId)) {
    return NextResponse.json({ error: "valid shiftId is required" }, { status: 400 });
  }

  const data = await getPosShiftExportData(auth.tenantId, shiftId, null);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.report.expectedCashHidden) {
    return NextResponse.json(
      { error: "shift export is unavailable until blind close is completed" },
      { status: 409 }
    );
  }

  const receivables = await getArShiftSummary(auth.tenantId, shiftId);
  const workbook = buildPosShiftWorkbook(data, receivables);
  const opened = data.report.openedAt.slice(0, 10);
  const filename = `pos-shift-${data.report.deviceCode.replace(/[^a-zA-Z0-9_-]/g, "-")}-${opened}.xlsx`;

  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const POST = withRouteErrorLog("POST /api/bms/pos-shifts/export", handlePOST);
