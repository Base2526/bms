// POST /api/bms/purchase/:id/cancel — ยกเลิก PO (เฉพาะ OPEN/PARTIAL)  [signed admin + RBAC · tenant จาก session]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cancelPurchaseOrder } from "@/lib/bms/purchase";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("purchase.cancel");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const poId = params.id?.trim();
  if (!poId) return NextResponse.json({ error: "po id required" }, { status: 400 });
  const ok = await cancelPurchaseOrder(auth.tenantId, poId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", poId }, { status: 409 });
  return NextResponse.json({ ok: true, poId });
}

export const POST = withRouteErrorLog("POST /api/bms/purchase/[id]/cancel", handlePOST);
