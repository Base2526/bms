// =============================================================
// POST /api/pos/void — ยกเลิกบิลที่กดผิด (7.97)
// -------------------------------------------------------------
// ไม่ใช่การคืนสินค้า: ดูเหตุผลที่แยกกันใน lib/bms/pos.ts § void
//
// ต้องมีสองคน: คนขายกด PIN ของตัวเอง + คนที่มีสิทธิ์ pos.void กด PIN อนุมัติ
// การยกเลิกบิลคือการลบยอดขายออกจากกะ ซึ่งเป็นช่องทุจริตตรงที่สุดที่ POS มี
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  verifyCashierPin,
  voidPosSale,
} from "@/lib/bms/pos";
import { isDistinctPosApprover } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!orderId || !idempotencyKey) return NextResponse.json({ error: "ต้องระบุบิลและ idempotencyKey" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "ต้องระบุเหตุผลที่ยกเลิก" }, { status: 400 });

  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const approverId = typeof body.approverUserId === "string" ? body.approverUserId.trim() : "";
  const approverPin = typeof body.approverPin === "string" ? body.approverPin : "";
  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!approverId || !approverPin) return NextResponse.json({ error: "ยกเลิกบิลต้องมีผู้อนุมัติกด PIN" }, { status: 400 });

  const actor = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!actor.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: actor.reason }, { status: 403 });
  if (!isDistinctPosApprover(actor.userId, approverId)) {
    return NextResponse.json({ error: "ผู้อนุมัติยกเลิกบิลต้องเป็นคนละคนกับพนักงานขาย" }, { status: 400 });
  }

  const approver = await verifyCashierPin(device.tenantId, approverId, approverPin);
  if (!approver.ok) return NextResponse.json({ error: "PIN ผู้อนุมัติไม่ถูกต้อง", reason: approver.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, approver.userId, "pos.void"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "pos.void", { secondPerson: true }) }, { status: 403 });
  }

  const result = await voidPosSale({
    tenantId: device.tenantId,
    deviceId: device.id,
    shiftId: shift.id,
    orderId,
    actorUserId: actor.userId,
    approvedByUserId: approver.userId,
    reason,
    idempotencyKey,
  });
  const status = result.status === "VOIDED" ? 200
    : result.status === "NOT_FOUND" ? 404
    : result.status === "SHIFT_CLOSED" ? 409
    : result.status === "ALREADY_RETURNED" ? 409
    : 400;
  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/void", handlePOST);
