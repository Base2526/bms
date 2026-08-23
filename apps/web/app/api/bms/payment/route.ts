// =============================================================
// /api/bms/payment — บันทึกการชำระ (POST) + list (GET)   [Phase 1: default tenant]
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/payment \
//     -H "content-type: application/json" \
//     -d '{"orderId":"<id>","method":"QR","amount":6400,"slipRef":"TXN123"}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { submitPayment, listPayments, PAYMENT_METHODS, type PaymentMethod } from "@/lib/bms/payments";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const url = new URL(req.url);
  const rows = await listPayments(DEFAULT_TENANT_ID, {
    orderId: url.searchParams.get("orderId"),
    status: url.searchParams.get("status"),
    limit: Number(url.searchParams.get("limit")) || 50,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ payments: rows });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const method = body.method as PaymentMethod;

  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  if (!PAYMENT_METHODS.includes(method)) {
    return NextResponse.json({ error: `method must be one of ${PAYMENT_METHODS.join(", ")}` }, { status: 400 });
  }

  const result = await submitPayment({
    tenantId: DEFAULT_TENANT_ID,
    orderId,
    method,
    amount: typeof body.amount === "number" ? body.amount : null,
    slipUrl: typeof body.slipUrl === "string" ? body.slipUrl : null,
    slipRef: typeof body.slipRef === "string" ? body.slipRef : null,
    note: typeof body.note === "string" ? body.note : null,
  });

  const httpStatus =
    result.status === "SUBMITTED" ? 201
      : result.status === "ORDER_NOT_FOUND" ? 404
      : result.status === "INVALID_ORDER_STATE" ? 409
      : 400;
  return NextResponse.json(result, { status: httpStatus });
}

export const GET = withRouteErrorLog("GET /api/bms/payment", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/payment", handlePOST);
