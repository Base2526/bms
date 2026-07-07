// =============================================================
// /api/bms/shipment — สร้างการจัดส่ง (POST) + list (GET)   [Phase 1: default tenant]
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/shipment \
//     -H "content-type: application/json" \
//     -d '{"orderId":"<id>","carrier":"FLASH","trackingNo":"TH123"}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createShipment, listShipments, CARRIERS, type Carrier } from "@/lib/bms/shipping";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rows = await listShipments(DEFAULT_TENANT_ID, {
    orderId: url.searchParams.get("orderId"),
    status: url.searchParams.get("status"),
    limit: Number(url.searchParams.get("limit")) || 50,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ shipments: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const carrier = body.carrier as Carrier;

  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  if (!CARRIERS.includes(carrier)) {
    return NextResponse.json({ error: `carrier must be one of ${CARRIERS.join(", ")}` }, { status: 400 });
  }

  const result = await createShipment({
    tenantId: DEFAULT_TENANT_ID,
    orderId,
    carrier,
    trackingNo: typeof body.trackingNo === "string" ? body.trackingNo : null,
    note: typeof body.note === "string" ? body.note : null,
  });

  const httpStatus =
    result.status === "CREATED" ? 201
      : result.status === "ORDER_NOT_FOUND" ? 404
      : result.status === "INVALID_STATE" ? 409
      : 400; // BAD_CARRIER
  return NextResponse.json(result, { status: httpStatus });
}
