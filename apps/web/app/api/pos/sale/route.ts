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
import { authenticatePosDevice, cashierHasPermission, recordPosSale, verifyCashierPin } from "@/lib/bms/pos";
import { isDistinctPosApprover, parsePosExtraLines, parsePosPayments, parsePosSaleLines } from "@/lib/bms/posRouteHelpers";
import { writeLogServer } from "@/lib/log/writeLog.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    return await handleSale(req);
  } catch (error: any) {
    // ห้ามปล่อย exception ลอยขึ้นไปถึง Next: route handler ที่โยน error ตอบเป็น
    // 500 ที่ "ไม่มี body" → จอ POS ทำ res.json() แล้วได้ "Unexpected end of JSON
    // input" ซึ่งแยกไม่ออกเลยว่าเน็ตหลุดหรือเซิร์ฟเวอร์พัง และไม่มีอะไรให้ไล่ต่อ
    console.error("[pos/sale] unhandled", {
      code: error?.code ?? null,        // SQLSTATE ถ้ามาจาก pg
      detail: error?.detail ?? null,
      constraint: error?.constraint ?? null,
      message: error?.message ?? null,
      stack: error?.stack ?? null,
    });
    // เขียนลง system_logs ด้วย ไม่ใช่แค่ stdout: หน้าร้านไม่มีใครเปิด docker logs ดู
    // และ /api/pos/* ไม่ผ่าน metricsPlugin ของ GraphQL จึงไม่มีที่ไหนเก็บเลย
    // ไม่ await — ถ้าต้นเหตุคือฐานล่ม การรอเขียน log จะหน่วงจอแคชเชียร์เปล่า ๆ
    // (writeLogServer กลืน error ของตัวเองอยู่แล้ว ไม่มีทาง throw กลับมา)
    // ห้ามใส่ body ลงไป: มี PIN ของพนักงานและผู้อนุมัติอยู่ในนั้น
    void writeLogServer("error", "pos", "pos/sale unhandled error", {
      action: "pos.sale.unhandled",
      status: "500",
      routeName: "/api/pos/sale",
      errorMessage: error?.message ?? null,
      stack: error?.stack ?? null,
      sqlstate: error?.code ?? null,
      constraint: error?.constraint ?? null,
      detail: error?.detail ?? null,
    });
    // status นี้แปลว่า "ไม่รู้ผล" ไม่ใช่ "ขายไม่สำเร็จ" — บิลอาจ commit ไปแล้วก่อน
    // พัง จอต้องคงคีย์ idempotency ไว้ให้กดซ้ำ ไม่ใช่ล้างตะกร้า
    return NextResponse.json(
      {
        status: "SERVER_ERROR",
        error: error?.message ? String(error.message) : "เซิร์ฟเวอร์ผิดพลาด",
      },
      { status: 500 }
    );
  }
}

async function handleSale(req: NextRequest) {
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
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.sell"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์ขายหน้าร้าน" }, { status: 403 });
  }

  const lines = parsePosSaleLines(body.lines);
  if (lines.length === 0) return badRequest("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");

  const paymentParse = parsePosPayments(body.payments);
  if (!paymentParse.ok) return badRequest(paymentParse.error);
  const payments = paymentParse.payments;

  // ---- ส่วนลดมือ: ต้องมีหัวหน้ากด PIN อนุมัติทุกครั้ง ----------------
  // ผู้อนุมัติต้องเป็นคนละคนกับคนขาย แม้คนขายจะถือ permission นี้อยู่ก็ตาม
  let approval: { amount: number; userId: string; reason: string } | null = null;
  const requestedDiscount = Math.round(Number(body.manualDiscount ?? 0) * 100) / 100;
  if (Number.isFinite(requestedDiscount) && requestedDiscount > 0) {
    const reason = typeof body.discountReason === "string" ? body.discountReason.trim() : "";
    const approverId = typeof body.discountApproverUserId === "string" ? body.discountApproverUserId.trim() : "";
    const approverPin = typeof body.discountApproverPin === "string" ? body.discountApproverPin : "";
    if (!reason) return badRequest("ส่วนลดหน้าร้านต้องระบุเหตุผล");
    if (reason.length > 200) return badRequest("เหตุผลส่วนลดยาวเกินไป");
    if (!approverId || !approverPin) return badRequest("ส่วนลดหน้าร้านต้องให้ผู้มีสิทธิ์อนุมัติกด PIN");
    if (!isDistinctPosApprover(auth.userId, approverId)) {
      return badRequest("ผู้อนุมัติส่วนลดต้องเป็นคนละคนกับพนักงานขาย");
    }

    const approver = await verifyCashierPin(device.tenantId, approverId, approverPin);
    if (!approver.ok) {
      const message =
        approver.reason === "NO_PIN" ? "ผู้อนุมัติยังไม่ได้ตั้ง PIN"
        : approver.reason === "LOCKED" ? "ผู้อนุมัติใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
        : "PIN ผู้อนุมัติไม่ถูกต้อง";
      return NextResponse.json({ error: message, reason: approver.reason }, { status: 403 });
    }
    if (!(await cashierHasPermission(device.tenantId, approver.userId, "pos.discount.approve"))) {
      return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์อนุมัติส่วนลด" }, { status: 403 });
    }
    approval = { amount: requestedDiscount, userId: approver.userId, reason };
  }

  const result = await recordPosSale({
    tenantId: device.tenantId,
    deviceId: device.id,
    shiftId,
    cashierUserId: auth.userId,
    idempotencyKey,
    lines,
    payments,
    couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
    // สมาชิก (7.96): id ถูกตรวจว่าเป็นลูกค้าของร้านนี้ใน createOrder อีกชั้น
    // แต้มที่ขอแลกเชื่อจาก body ได้ เพราะยอดที่ใช้ได้จริงถูกล็อกและตรวจใน tx
    customerId: typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null,
    pointsToRedeem: Number.isFinite(Number(body.pointsToRedeem)) ? Number(body.pointsToRedeem) : null,
    // ส่วนลดมือ: จำนวนเงินเชื่อจาก body ได้ (createOrder บังคับเพดานเองอีกชั้น) แต่
    // "ใครอนุมัติ" ต้องพิสูจน์ด้วย PIN ที่ตรวจกับฐานข้อมูลข้างบน ห้ามเชื่อ id จาก body
    // ค่าบริการ/ค่าถุง (8.6) — เชื่อจาก body ได้ เพราะเป็น "เก็บเงินเพิ่ม" ไม่ใช่ลดยอด
    // เงินเข้าลิ้นชักซึ่งถูกนับตอนปิดกะ และป้ายรายการโผล่บนใบเสร็จให้ลูกค้าเห็น
    extraLines: parsePosExtraLines(body.extraLines),
    manualDiscount: approval?.amount ?? null,
    discountApprovedBy: approval?.userId ?? null,
    discountReason: approval?.reason ?? null,
    // clinical assessment ยังไม่มี flow ที่ผูกกับ server state — ห้ามเชื่อจาก body
    pharmacyApprovedAssessmentId: null,
  });

  // ขายซ้ำด้วยคีย์เดิม → 200 พร้อม replayed: true (ไม่ใช่ error — เครื่องแค่ยิงซ้ำ)
  if (result.status === "SOLD") return NextResponse.json(result, { status: 200 });

  const httpStatus =
    result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "EMPTY" ? 400
    : result.status === "PAYMENT_MISMATCH" ? 400
    : result.status === "LOT_EXPIRED_OR_SHORT" ? 409
    : result.status === "INVALID_PACK" ? 409
    : result.status === "INSUFFICIENT" ? 409
    : result.status === "POINTS_INVALID" ? 400
    : result.status === "NOT_FOUND" ? 404
    : String(result.status).startsWith("PHARMACY_") ? 403
    : 409;

  return NextResponse.json(result, { status: httpStatus });
}
