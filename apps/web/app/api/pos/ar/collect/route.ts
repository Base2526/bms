// =============================================================
// POST /api/pos/ar/collect — รับชำระหนี้ที่เคาน์เตอร์ (9.30)
// -------------------------------------------------------------
// auth: header `x-pos-device-token` + PIN พนักงาน + สิทธิ์ `ar.collect`
//
// ⚠️ กะและสาขามาจาก **ตัวเครื่องที่ authenticate แล้ว** ไม่ใช่จาก body — เงินสดที่รับ
// ต้องเข้าลิ้นชักของกะที่กำลังเปิดอยู่จริงที่เครื่องนี้ ถ้ารับ shiftId จาก body ได้
// เครื่องหนึ่งจะยัดเงินเข้ากะของอีกเครื่องได้ แล้วยอดปิดกะทั้งสองฝั่งผิดพร้อมกัน
//
// idempotencyKey เครื่องเป็นคนสร้างต่อการกดหนึ่งครั้ง (ไม่ใช่ต่อ signature ของคำขอ)
// — บทเรียนเดียวกับ 9.5: กดซ้ำเพราะเน็ตช้าต้องไม่รับเงินสองรอบ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { AR_RECEIPT_METHODS, recordArReceipt, type ArReceiptMethod } from "@/lib/bms/ar";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const method = String(body.method ?? "").toUpperCase() as ArReceiptMethod;

  if (!cashierUserId || !pin) return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  if (!accountId) return NextResponse.json({ error: "ต้องระบุบัญชีลูกหนี้" }, { status: 400 });
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return NextResponse.json({ error: "ต้องมี idempotencyKey ที่ยาวไม่เกิน 240 ตัวอักษร" }, { status: 400 });
  }
  if (!AR_RECEIPT_METHODS.includes(method)) {
    return NextResponse.json({ error: `วิธีรับชำระไม่ถูกต้อง: ${method || "(ว่าง)"}` }, { status: 400 });
  }

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: auth.reason }, { status: 403 });
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "ar.collect"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์รับชำระหนี้" }, { status: 403 });
  }

  // เงินสดต้องมีลิ้นชักรองรับ · วิธีอื่นรับได้แม้ยังไม่เปิดกะ (เงินไม่ได้เข้าลิ้นชัก)
  const shift = await getOpenPosShift(device.tenantId, device.id);
  if (method === "CASH" && !shift) {
    return NextResponse.json({ error: "รับเงินสดต้องเปิดกะก่อน" }, { status: 409 });
  }

  const result = await recordArReceipt({
    tenantId: device.tenantId,
    accountId,
    amount: Number(body.amount),
    method,
    reference: typeof body.reference === "string" ? body.reference : null,
    note: typeof body.note === "string" ? body.note : null,
    receivedBy: auth.userId,
    idempotencyKey,
    locationId: device.locationId,
    deviceId: device.id,
    shiftId: shift?.id ?? null,
  });

  if (result.status === "RECEIVED") return NextResponse.json(result, { status: 200 });
  return NextResponse.json(result, {
    status: result.status === "OVER_PAYMENT" || result.status === "IDEMPOTENCY_CONFLICT" ? 409 : 400,
  });
}

export const POST = withRouteErrorLog("POST /api/pos/ar/collect", handlePOST);
