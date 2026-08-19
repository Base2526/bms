// POST /api/bms/order/:id/pay — OMS transition (payOrder) [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { payOrder } from "@/lib/bms/orders";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const orderId = params.id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const ok = await payOrder(DEFAULT_TENANT_ID, orderId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}

export const POST = withRouteErrorLog("POST /api/bms/order/[id]/pay", handlePOST);
