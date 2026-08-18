// =============================================================
// POST /api/pos/blind-return — คืนสินค้าโดยไม่มีใบเสร็จ (8.2)
// -------------------------------------------------------------
// ลูกค้าทำใบเสร็จหายแล้วคืนไม่ได้เลยคือปัญหาจริงหน้าร้าน แต่ทางนี้ก็เป็นช่องทุจริต
// ที่ตรงที่สุด (เอาของที่ไม่ได้ซื้อมาคืนเอาเงิน) จึงต้องมีสองคนเสมอ:
//   • คนขายกด PIN ของตัวเอง
//   • คนที่มีสิทธิ์ pos.return.noreceipt กด PIN อนุมัติ (seed ให้ Manager เท่านั้น)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  blindReturnPosSale,
  cashierHasPermission,
  getOpenPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { isDistinctPosApprover } from "@/lib/bms/posRouteHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const approverId = typeof body.approverUserId === "string" ? body.approverUserId.trim() : "";
  const approverPin = typeof body.approverPin === "string" ? body.approverPin : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!approverId || !approverPin) {
    return NextResponse.json({ error: "การคืนที่ไม่มีใบเสร็จต้องมีผู้อนุมัติกด PIN" }, { status: 400 });
  }
  if (!idempotencyKey) return NextResponse.json({ error: "ต้องมี idempotencyKey" }, { status: 400 });

  const actor = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!actor.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: actor.reason }, { status: 403 });

  if (!isDistinctPosApprover(actor.userId, approverId)) {
    return NextResponse.json({ error: "ผู้อนุมัติต้องเป็นคนละคนกับพนักงานที่รับคืน" }, { status: 400 });
  }

  const approver = await verifyCashierPin(device.tenantId, approverId, approverPin);
  if (!approver.ok) return NextResponse.json({ error: "PIN ผู้อนุมัติไม่ถูกต้อง", reason: approver.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, approver.userId, "pos.return.noreceipt"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์อนุมัติการคืนที่ไม่มีใบเสร็จ" }, { status: 403 });
  }

  const result = await blindReturnPosSale({
    tenantId: device.tenantId,
    deviceId: device.id,
    shiftId: shift.id,
    actorUserId: actor.userId,
    approvedByUserId: approver.userId,
    reason: typeof body.reason === "string" ? body.reason : "",
    customerId: typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null,
    customerNote: typeof body.customerNote === "string" ? body.customerNote : null,
    lines: Array.isArray(body.lines) ? (body.lines as any[]) : [],
    idempotencyKey,
  });

  const status = result.status === "RETURNED" ? 200
    : result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "NOT_ENOUGH_CASH" ? 409
    : 400;
  return NextResponse.json(result, { status });
}
