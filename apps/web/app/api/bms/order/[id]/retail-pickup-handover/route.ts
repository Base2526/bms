import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canAccessOrderBranch, handoverRetailPickup } from "@/lib/bms/orders";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRoute("order.ship");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const orderId = (await params).id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (body?.confirmed !== true) return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  if (!(await canAccessOrderBranch(auth.tenantId, orderId, String(auth.adminId)))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ok = await handoverRetailPickup(auth.tenantId, orderId, String(auth.adminId));
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}

export const POST = withRouteErrorLog("POST /api/bms/order/[id]/retail-pickup-handover", handlePOST);
