// =============================================================
// POST /api/bms/order/:id/cancel — ยกเลิก order → คืน reserved stock
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/order/<ORDER_ID>/cancel
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cancelOrder } from "@/lib/bms/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const orderId = params.id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "order id required" }, { status: 400 });
  }

  const ok = await cancelOrder(orderId);
  if (!ok) {
    return NextResponse.json(
      { status: "NOT_CANCELLABLE", orderId },
      { status: 409 }
    );
  }
  return NextResponse.json({ status: "CANCELLED", orderId });
}
