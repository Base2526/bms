// POST /api/bms/order/:id/pack — OMS transition (packOrder)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { packOrder } from "@/lib/bms/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const orderId = params.id?.trim();
  if (!orderId) return NextResponse.json({ error: "order id required" }, { status: 400 });
  const ok = await packOrder(orderId);
  if (!ok) return NextResponse.json({ status: "INVALID_TRANSITION", orderId }, { status: 409 });
  return NextResponse.json({ ok: true, orderId });
}
