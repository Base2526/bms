// POST /api/bms/shipment/:id/status — เปลี่ยนสถานะ shipment  [Phase 1: default tenant]
//   DELIVERED → order SHIPPED → COMPLETED (best-effort)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { setShipmentStatus, SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/bms/shipping";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "shipment id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  const status = body.status as ShipmentStatus;
  if (!SHIPMENT_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${SHIPMENT_STATUSES.join(", ")}` }, { status: 400 });
  }
  const ok = await setShipmentStatus(DEFAULT_TENANT_ID, id, status);
  if (!ok) return NextResponse.json({ status: "NOT_FOUND", id }, { status: 404 });
  return NextResponse.json({ ok: true, id, status });
}

export const POST = withRouteErrorLog("POST /api/bms/shipment/[id]/status", handlePOST);
