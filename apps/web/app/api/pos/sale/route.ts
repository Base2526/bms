// =============================================================
// POST /api/pos/sale — ขาย 1 บิลจากเครื่องหน้าร้าน
// -------------------------------------------------------------
// auth: header `x-pos-device-token` เท่านั้น — เครื่องหน้าร้านเปิดค้างทั้งวัน
// จะใช้ session cookie ของ admin ไม่ได้ · tenant มาจากตัวเครื่อง ไม่ใช่จาก body
// (ห้ามให้ client บอกว่าตัวเองเป็นร้านไหน)
//
// idempotencyKey เครื่องเป็นคนสร้าง: {device}-{shift}-{seq}
// ยิงซ้ำเพราะ response หายกลางทาง → ได้บิลเดิม ไม่ใช่บิลใหม่
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticatePosDevice, recordPosSale, verifyCashierPin, type PosPaymentInput, type PosSaleLine } from "@/lib/bms/pos";
import { PAYMENT_METHODS } from "@/lib/bms/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-pos-device-token") ?? "";
  const device = await authenticatePosDevice(token);
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const shiftId = typeof body.shiftId === "string" ? body.shiftId.trim() : "";
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!shiftId || !cashierUserId || !idempotencyKey) {
    return badRequest("shiftId, cashierUserId, idempotencyKey จำเป็นทั้งหมด");
  }

  // PIN ตรวจทุกบิล ไม่ใช่ครั้งเดียวตอนเปิดกะ — จอเก็บไว้ในหน่วยความจำหลังพนักงาน
  // พิมพ์ครั้งแรก แล้วส่งมาด้วยทุกครั้ง ถูกกว่าการออก token อายุสั้นแล้วต้องดูแลอายุ
  // พนักงานที่ยังไม่ตั้ง PIN ขายไม่ได้ (ไม่ปล่อยผ่านเป็นค่า default)
  const pin = typeof body.pin === "string" ? body.pin : "";
  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: PosSaleLine[] = rawLines
    .map((l: any) => ({
      sku: String(l?.sku ?? "").trim(),
      size: String(l?.size ?? "").trim(),
      packQty: Number(l?.packQty),
      packCode: l?.packCode ? String(l.packCode) : null,
      unitName: l?.unitName ? String(l.unitName) : null,
      baseQty: l?.baseQty == null ? null : Number(l.baseQty),
      packPrice: l?.packPrice == null ? null : Number(l.packPrice),
    }))
    .filter((l) => l.sku && l.size && Number.isInteger(l.packQty) && l.packQty > 0);
  if (lines.length === 0) return badRequest("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");

  const rawPayments = Array.isArray(body.payments) ? body.payments : [];
  const payments: PosPaymentInput[] = [];
  for (const p of rawPayments as any[]) {
    const method = String(p?.method ?? "").toUpperCase();
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      return badRequest(`วิธีชำระเงินไม่ถูกต้อง: ${method || "(ว่าง)"}`);
    }
    const amount = Number(p?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return badRequest("จำนวนเงินต้องมากกว่า 0");
    payments.push({
      method: method as PosPaymentInput["method"],
      amount,
      cashTendered: p?.cashTendered == null ? null : Number(p.cashTendered),
      ref: p?.ref ? String(p.ref) : null,
    });
  }
  if (payments.length === 0) return badRequest("ต้องระบุการชำระเงินอย่างน้อย 1 รายการ");

  const result = await recordPosSale({
    tenantId: device.tenantId,
    shiftId,
    cashierUserId,
    idempotencyKey,
    lines,
    payments,
    couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
    discountApprovedBy: typeof body.discountApprovedBy === "string" ? body.discountApprovedBy : null,
    discountReason: typeof body.discountReason === "string" ? body.discountReason : null,
    // server-derived เท่านั้น: id ของ assessment ที่เภสัชกรอนุมัติแล้ว
    pharmacyApprovedAssessmentId:
      typeof body.pharmacyApprovedAssessmentId === "string" ? body.pharmacyApprovedAssessmentId : null,
  });

  // ขายซ้ำด้วยคีย์เดิม → 200 พร้อม replayed: true (ไม่ใช่ error — เครื่องแค่ยิงซ้ำ)
  if (result.status === "SOLD") return NextResponse.json(result, { status: 200 });

  const httpStatus =
    result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "EMPTY" ? 400
    : result.status === "PAYMENT_MISMATCH" ? 400
    : result.status === "LOT_EXPIRED_OR_SHORT" ? 409
    : result.status === "INSUFFICIENT" ? 409
    : result.status === "NOT_FOUND" ? 404
    : String(result.status).startsWith("PHARMACY_") ? 403
    : 409;

  return NextResponse.json(result, { status: httpStatus });
}
