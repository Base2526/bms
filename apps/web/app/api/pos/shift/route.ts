// =============================================================
// POST /api/pos/shift — เปิด/ปิดกะจากเครื่องหน้าร้าน
// -------------------------------------------------------------
// auth 2 ชั้น: device token (เครื่องนี้เป็นของร้านนี้) + PIN (คนนี้เป็นใคร)
// device token อย่างเดียวไม่พอ เพราะเปิดกะคือการรับผิดชอบเงินในลิ้นชัก
//
// เดิมต้องไปเปิดกะจากหน้าแอดมิน ซึ่งแปลว่าเปิดร้านตอนเช้าต้องมีคนเปิด
// คอมอีกเครื่อง — ใช้จริงไม่ได้
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  closePosShift,
  getOpenPosShift,
  openPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!userId || !pin) return NextResponse.json({ error: "ต้องระบุผู้ใช้และ PIN" }, { status: 400 });

  const auth = await verifyCashierPin(device.tenantId, userId, pin);
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }

  if (action === "open") {
    if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.shift.open"))) {
      return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์เปิดกะ" }, { status: 403 });
    }
    const result = await openPosShift({
      tenantId: device.tenantId,
      deviceId: device.id,
      openedBy: auth.userId,
      openingFloat: Number(body.openingFloat ?? 0),
      // บันทึกได้เฉพาะคนที่ยืนยัน PIN ในคำขอนี้ ห้ามรับ UUID เภสัชกรคนอื่นจาก body
      // จนกว่าจะมี flow ยืนยัน PIN ของเภสัชกรเวรแยกต่างหาก
      pharmacistUserId: auth.isPharmacist ? auth.userId : null,
    });
    const status =
      result.status === "OPENED" || result.status === "ALREADY_OPEN" ? 200
      : result.status === "DEVICE_NOT_FOUND" ? 404
      : result.status === "POLICY_NOT_READY" ? 409
      : 400;
    return NextResponse.json(result, { status });
  }

  if (action === "close") {
    if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.shift.close"))) {
      return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์ปิดกะ" }, { status: 403 });
    }
    const open = await getOpenPosShift(device.tenantId, device.id);
    if (!open) return NextResponse.json({ status: "NOT_OPEN" }, { status: 409 });

    const counted = Number(body.countedCash);
    if (!Number.isFinite(counted) || counted < 0) {
      return NextResponse.json({ error: "ต้องระบุยอดเงินที่นับได้" }, { status: 400 });
    }
    const result = await closePosShift({
      tenantId: device.tenantId,
      shiftId: open.id,
      closedBy: auth.userId,
      countedCash: counted,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json(result, { status: result.status === "CLOSED" ? 200 : 409 });
  }

  return NextResponse.json({ error: "action ต้องเป็น open หรือ close" }, { status: 400 });
}
