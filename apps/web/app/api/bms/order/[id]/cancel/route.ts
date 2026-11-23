// POST /api/bms/order/:id/cancel — OMS transition (cancelOrder) [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cancelOrder, canAccessOrderBranch } from "@/lib/bms/orders";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRoute("order.cancel");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const body = await req.json().catch(() => null);
  if (body?.confirmed !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  const orderId = (await params).id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  if (!(await canAccessOrderBranch(auth.tenantId, orderId, String(auth.adminId)))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = await cancelOrder(auth.tenantId, orderId, String(auth.adminId));
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}

export const POST = withRouteErrorLog("POST /api/bms/order/[id]/cancel", handlePOST);
