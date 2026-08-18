// =============================================================
// /api/pos/deposit — มัดจำ / ค้างชำระ (9.0)
// -------------------------------------------------------------
// GET   รายการมัดจำที่ยังเปิดอยู่ (ของที่ถูกจองค้าง = ขายให้คนอื่นไม่ได้)
// POST  {action:"take"}     รับมัดจำของบิลที่สร้างไว้แล้ว (PENDING)
//       {action:"add"}      จ่ายเพิ่มแต่ยังไม่ครบ
//       {action:"settle"}   จ่ายส่วนที่เหลือ = รับของ → บิลเดินเส้นทางปิดการขายปกติ
//       {action:"close"}    ยกเลิก/ยึดมัดจำ (ต้องมี pos.deposit.cancel)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  settleDepositSale,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { addToDeposit, closeDeposit, listDeposits, takeDeposit } from "@/lib/bms/deposits";
import { parsePosPayments } from "@/lib/bms/posRouteHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  return NextResponse.json({
    deposits: await listDeposits(device.tenantId, "OPEN", { locationId: device.locationId }),
  });
}

export async function POST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ" }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!orderId) return NextResponse.json({ error: "ต้องระบุบิล" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });

  // ยกเลิก/ยึดมัดจำเป็นการตัดสินใจเรื่องเงินของลูกค้า จึงใช้สิทธิ์ที่สูงกว่าการรับเงิน
  const needed = action === "close" ? "pos.deposit.cancel" : "pos.deposit.take";
  if (!(await cashierHasPermission(device.tenantId, auth.userId, needed))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ทำรายการนี้" }, { status: 403 });
  }

  if (action === "take" || action === "add") {
    if (!idempotencyKey) return NextResponse.json({ error: "ต้องมี idempotencyKey" }, { status: 400 });
    const amount = Number(body.amount ?? 0);
    const method = String(body.method ?? "CASH").toUpperCase();
    const parsedPayment = parsePosPayments([{ method, amount }]);
    if (!parsedPayment.ok) return NextResponse.json({ error: parsedPayment.error }, { status: 400 });
    // เครดิตร้านต้องล็อกและหักยอดใน transaction เดียวกับการรับเงิน แต่ deposit
    // service ยังไม่มีขั้นนั้น จึงห้ามรับไว้เป็น payment เปล่า ๆ จนกว่าจะรองรับจริง
    if (method === "STORE_CREDIT") {
      return NextResponse.json({ error: "ยังไม่รองรับเครดิตร้านสำหรับเงินมัดจำ" }, { status: 400 });
    }
    const result = action === "take"
      ? await takeDeposit({
          tenantId: device.tenantId, orderId, amount, method,
          deviceId: device.id, shiftId: shift.id,
          expectedLocationId: device.locationId,
          customerNote: typeof body.customerNote === "string" ? body.customerNote : null,
          dueAt: typeof body.dueAt === "string" ? body.dueAt : null,
          createdBy: auth.userId,
          idempotencyKey,
        })
      : await addToDeposit({
          tenantId: device.tenantId, orderId, amount, method, actorUserId: auth.userId,
          locationId: device.locationId,
          idempotencyKey,
        });
    return NextResponse.json(result, { status: result.status === "TAKEN" ? 200 : 400 });
  }

  if (action === "settle") {
    const parsed = parsePosPayments(body.payments);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const result = await settleDepositSale({
      tenantId: device.tenantId, deviceId: device.id, shiftId: shift.id,
      cashierUserId: auth.userId, orderId, payments: parsed.payments,
    });
    const status = result.status === "SOLD" ? 200
      : result.status === "DEPOSIT_NOT_FOUND" ? 404
      : result.status === "SHIFT_NOT_OPEN" ? 409
      : 400;
    return NextResponse.json(result, { status });
  }

  if (action === "close") {
    const outcome = body.outcome === "FORFEITED" ? "FORFEITED" as const : "CANCELLED" as const;
    const result = await closeDeposit({
      tenantId: device.tenantId, orderId, outcome,
      reason: typeof body.reason === "string" ? body.reason : "",
      actorUserId: auth.userId,
      locationId: device.locationId,
    });
    return NextResponse.json(result, { status: result.status === "INVALID" ? 400 : 200 });
  }

  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}
