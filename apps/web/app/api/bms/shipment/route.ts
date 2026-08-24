// =============================================================
// /api/bms/shipment — สร้างการจัดส่ง (POST) + list (GET)   [signed admin + RBAC · tenant จาก session]
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/shipment \
//     -H "content-type: application/json" \
//     -d '{"orderId":"<id>","carrier":"FLASH","trackingNo":"TH123"}'
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createShipment, listShipments, CARRIERS, type Carrier } from "@/lib/bms/shipping";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("shipping.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const url = new URL(req.url);
  const rows = await listShipments(auth.tenantId, {
    orderId: url.searchParams.get("orderId"),
    status: url.searchParams.get("status"),
    limit: Number(url.searchParams.get("limit")) || 50,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ shipments: rows });
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("shipping.create");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const carrier = body.carrier as Carrier;

  if (!orderId) return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  if (!CARRIERS.includes(carrier)) {
    return NextResponse.json({ error: `carrier must be one of ${CARRIERS.join(", ")}` }, { status: 400 });
  }

  const result = await createShipment({
    tenantId: auth.tenantId,
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

export const GET = withRouteErrorLog("GET /api/bms/shipment", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/shipment", handlePOST);
