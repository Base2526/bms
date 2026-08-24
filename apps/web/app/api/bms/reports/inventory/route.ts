// GET /api/bms/reports/inventory — สรุปสต็อก   [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getInventorySummary } from "@/lib/bms/reports";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest) {
  const auth = await authorizeAdminRoute("report.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const summary = await getInventorySummary(auth.tenantId);
  return NextResponse.json(summary);
}

export const GET = withRouteErrorLog("GET /api/bms/reports/inventory", handleGET);
