import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  completePosRefundAllocation,
  getOpenPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allocationId = typeof body.allocationId === "string" ? body.allocationId.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!allocationId || !userId || !pin) {
    return NextResponse.json({ error: "allocationId, userId และ pin จำเป็นทั้งหมด" }, { status: 400 });
  }
  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) {
    return NextResponse.json({ error: "PIN ผู้ยืนยันไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  }
  const shiftId = (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;
  const result = await completePosRefundAllocation({
    tenantId: device.tenantId,
    deviceId: device.id,
    locationId: device.locationId,
    shiftId,
    allocationId,
    actorUserId: auth.userId,
    externalRef: typeof body.externalRef === "string" ? body.externalRef : null,
  });
  const status = result.status === "COMPLETED" ? 200
    : result.status === "NOT_FOUND" ? 404
    : result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "REFERENCE_REQUIRED" ? 400
    : 403;
  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/refund-settlement", handlePOST);
