import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  partiallyReturnPosSale,
  returnPosSale,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/bms/payments";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) {
    return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!orderId || !cashierUserId || !pin) {
    return badRequest("orderId, cashierUserId และ pin จำเป็นทั้งหมด");
  }

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "order.return"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์คืนสินค้า" }, { status: 403 });
  }

  const mode = String(body.mode ?? "").toUpperCase();
  if (mode !== "FULL" && mode !== "PARTIAL") {
    return badRequest("mode ต้องเป็น FULL หรือ PARTIAL");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!/^\[(DAMAGED|WRONG_ITEM|CUSTOMER_CHANGE|PRICE_ERROR|QUALITY_ISSUE|OTHER)\]\s+\S/.test(note)) {
    return badRequest("ต้องเลือกประเภทเหตุผลและระบุรายละเอียดการคืนสินค้า");
  }
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 240) {
    return badRequest("idempotencyKey จำเป็นและต้องยาวไม่เกิน 240 ตัวอักษร");
  }
  const preferredRefundMethodRaw = typeof body.preferredRefundMethod === "string"
    ? body.preferredRefundMethod.trim().toUpperCase()
    : "";
  if (preferredRefundMethodRaw
      && !PAYMENT_METHODS.includes(preferredRefundMethodRaw as PaymentMethod)) {
    return badRequest("preferredRefundMethod ไม่ใช่วิธีชำระเงินที่รองรับ");
  }
  const preferredRefundMethod = preferredRefundMethodRaw
    ? preferredRefundMethodRaw as PaymentMethod
    : null;

  const approvalUserId = typeof body.approvalUserId === "string" ? body.approvalUserId.trim() : "";
  const approvalPin = typeof body.approvalPin === "string" ? body.approvalPin : "";
  let approvedByUserId: string | null = null;
  if (approvalUserId && approvalPin) {
    const approval = await verifyCashierPin(device.tenantId, approvalUserId, approvalPin);
    if (!approval.ok) {
      const message =
        approval.reason === "NO_PIN" ? "ผู้อนุมัติยังไม่ได้ตั้ง PIN"
        : approval.reason === "LOCKED" ? "PIN ผู้อนุมัติถูกล็อกชั่วคราว"
        : "PIN ผู้อนุมัติไม่ถูกต้อง";
      return NextResponse.json({ error: message, reason: approval.reason, lockedUntil: approval.lockedUntil }, { status: 403 });
    }
    approvedByUserId = approval.userId;
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const partialLines = rawLines
    .map((line: any) => ({
      orderItemId: Number(line?.orderItemId),
      packQty: Number(line?.packQty),
    }))
    .filter((line) => Number.isInteger(line.orderItemId) && Number.isInteger(line.packQty) && line.packQty > 0);

  if (mode === "PARTIAL" && partialLines.length === 0) {
    return badRequest("การคืนบางรายการต้องมี lines ที่ถูกต้องอย่างน้อย 1 รายการ");
  }
  if (mode === "FULL" && rawLines.length > 0) {
    return badRequest("การคืนทั้งบิลต้องไม่ส่ง lines");
  }

  // ส่ง null เข้า service ได้เพื่อให้ idempotent replay ของรายการที่ commit แล้ว
  // ยังตอบเดิมหลังปิดกะ; คำขอใหม่จะถูก service ปฏิเสธด้วย SHIFT_NOT_OPEN
  const shiftId = (await getOpenPosShift(device.tenantId, device.id))?.id ?? null;

  const result =
    mode === "PARTIAL"
      ? await partiallyReturnPosSale({
          tenantId: device.tenantId,
          deviceId: device.id,
          shiftId,
          orderId,
          actorUserId: auth.userId,
          lines: partialLines,
          note,
          approvedByUserId,
          preferredRefundMethod,
          idempotencyKey,
        })
      : await returnPosSale({
          tenantId: device.tenantId,
          deviceId: device.id,
          shiftId,
          orderId,
          actorUserId: auth.userId,
          note,
          approvedByUserId,
          preferredRefundMethod,
          idempotencyKey,
        });

  const status =
    result.status === "RETURNED" ? 200
    : result.status === "PARTIAL_RETURNED" ? 200
    : result.status === "ORDER_NOT_FOUND" ? 404
    : result.status === "ORDER_NOT_POS" ? 409
    : result.status === "APPROVAL_REQUIRED" ? 403
    : result.status === "NO_CONFIRMED_PAYMENTS" ? 409
    : result.status === "REFUND_METHOD_UNAVAILABLE" ? 409
    : result.status === "IDEMPOTENCY_CONFLICT" ? 409
    : result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "WOULD_OVERDRAW" ? 409
    : 409;

  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/return", handlePOST);
