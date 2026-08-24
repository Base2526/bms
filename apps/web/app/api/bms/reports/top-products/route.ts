// GET /api/bms/reports/top-products?from=&to=&limit=   [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTopSellingProducts } from "@/lib/bms/reports";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("report.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const url = new URL(req.url);
  const rows = await getTopSellingProducts(
    auth.tenantId,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    Number(url.searchParams.get("limit")) || 10
  );
  return NextResponse.json({ products: rows });
}

export const GET = withRouteErrorLog("GET /api/bms/reports/top-products", handleGET);
