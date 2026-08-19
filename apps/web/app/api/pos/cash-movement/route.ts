// =============================================================
// /api/pos/cash-movement — เงินเข้า/ออกลิ้นชักที่ไม่ใช่การขาย (7.97)
// -------------------------------------------------------------
// GET   รายการของกะนี้ + ยอดที่ควรอยู่ในลิ้นชักตอนนี้
// POST  บันทึกรายการใหม่
//
// เงินออกต้องมีคนที่สองอนุมัติเสมอ (PIN แยก + สิทธิ์ pos.cash.movement)
// เงินเข้าไม่ต้อง — การเอาเงินใส่ลิ้นชักเพิ่มไม่ใช่ช่องทุจริต และการบังคับหา
// หัวหน้าทุกครั้งที่ไปแลกเหรียญมาจะทำให้ไม่มีใครบันทึก แล้วยอดปิดกะพังเหมือนเดิม
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  listCashMovements,
  recordCashMovement,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { isDistinctPosApprover } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 });
  return NextResponse.json({ movements: await listCashMovements(device.tenantId, shift.id) });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const direction = body.direction === "OUT" ? "OUT" : body.direction === "IN" ? "IN" : null;
  if (!direction) return NextResponse.json({ error: "direction ต้องเป็น IN หรือ OUT" }, { status: 400 });

  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });

  const actor = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!actor.ok) {
    return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: actor.reason }, { status: 403 });
  }

  // ---- เงินออก: ต้องมีผู้อนุมัติที่กด PIN ของตัวเอง ------------------
  let approvedBy: string | null = null;
  if (direction === "OUT") {
    const approverId = typeof body.approverUserId === "string" ? body.approverUserId.trim() : "";
    const approverPin = typeof body.approverPin === "string" ? body.approverPin : "";
    if (!approverId || !approverPin) {
      return NextResponse.json({ error: "เงินออกจากลิ้นชักต้องมีผู้อนุมัติกด PIN" }, { status: 400 });
    }
    if (!isDistinctPosApprover(actor.userId, approverId)) {
      return NextResponse.json({ error: "ผู้อนุมัติเงินออกต้องเป็นคนละคนกับผู้ทำรายการ" }, { status: 400 });
    }
    const approver = await verifyCashierPin(device.tenantId, approverId, approverPin);
    if (!approver.ok) {
      return NextResponse.json({ error: "PIN ผู้อนุมัติไม่ถูกต้อง", reason: approver.reason }, { status: 403 });
    }
    if (!(await cashierHasPermission(device.tenantId, approver.userId, "pos.cash.movement"))) {
      return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์อนุมัติเงินออกจากลิ้นชัก" }, { status: 403 });
    }
    approvedBy = approver.userId;
  }

  const result = await recordCashMovement({
    tenantId: device.tenantId,
    deviceId: device.id,
    shiftId: shift.id,
    direction,
    amount: Number(body.amount ?? 0),
    reason: typeof body.reason === "string" ? body.reason : "",
    actorUserId: actor.userId,
    approvedByUserId: approvedBy,
  });
  const status = result.status === "RECORDED" ? 200
    : result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "WOULD_OVERDRAW" ? 409
    : 400;
  return NextResponse.json(result, { status });
}

export const GET = withRouteErrorLog("GET /api/pos/cash-movement", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/cash-movement", handlePOST);
