// POST /api/bms/order/:id/cancel — OMS transition (cancelOrder) [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cancelOrder } from "@/lib/bms/orders";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const orderId = params.id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const ok = await cancelOrder(DEFAULT_TENANT_ID, orderId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}
