// POST /api/bms/order/:id/ship — OMS transition (shipOrder)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { shipOrder } from "@/lib/bms/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const orderId = params.id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const ok = await shipOrder(orderId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}
