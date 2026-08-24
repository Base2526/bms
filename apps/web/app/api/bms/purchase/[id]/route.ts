// GET /api/bms/purchase/:id — รายละเอียด PO + รายการ   [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPurchaseOrder } from "@/lib/bms/purchase";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("purchase.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const poId = params.id?.trim();
  if (!poId) return NextResponse.json({ error: "po id required" }, { status: 400 });
  const po = await getPurchaseOrder(auth.tenantId, poId);
  if (!po) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(po);
}

export const GET = withRouteErrorLog("GET /api/bms/purchase/[id]", handleGET);
