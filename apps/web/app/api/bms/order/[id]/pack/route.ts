// POST /api/bms/order/:id/pack — OMS transition (packOrder) [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { packOrder } from "@/lib/bms/orders";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("order.ship");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const orderId = params.id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const ok = await packOrder(auth.tenantId, orderId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}

export const POST = withRouteErrorLog("POST /api/bms/order/[id]/pack", handlePOST);
