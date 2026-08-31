// =============================================================
// POST /api/pos/pharmacy-review — ส่งบิลหน้าร้านเข้าคิวเภสัชกรตรวจ
// -------------------------------------------------------------
// auth: เหมือนขายหน้าร้านทุกอย่าง — เครื่องยืนยัน tenant/branch, PIN ยืนยันคน
// ไม่เชื่อ cart/price/assessment จาก browser เป็น authority
// idempotencyKey เครื่องเป็นคนสร้าง: ยิงซ้ำเพราะ response หาย ต้องได้เคสเดิม
// =============================================================

import { NextResponse } from "next/server";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  requestPosPharmacyReview,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { parsePosSaleLines } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

async function handlePOST(req: NextRequest) {
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
    return badRequest("shiftId, cashierUserId, idempotencyKey จำเป็น");
  }
  if (idempotencyKey.length > 240) {
    return badRequest("idempotencyKey ต้องยาวไม่เกิน 240 ตัวอักษร");
  }
  const auth = await verifyCashierPin(device.tenantId, cashierUserId, typeof body.pin === "string" ? body.pin : "");
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.sell"))) {
    return NextResponse.json({ error: await posPermissionDeniedMessage(device.tenantId, "pos.sell") }, { status: 403 });
  }

  const lines = parsePosSaleLines(body.lines);
  if (lines.length === 0) return badRequest("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");

  const result = await requestPosPharmacyReview({
    tenantId: device.tenantId,
    deviceId: device.id,
    shiftId,
    cashierUserId: auth.userId,
    idempotencyKey,
    customerId: typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null,
    label: typeof body.label === "string" ? body.label : "",
    lines,
    parkedCart: body.parkedCart,
    itemCount: Number(body.itemCount ?? 0),
    subtotalHint: Number(body.subtotalHint ?? 0),
  });

  const status =
    result.status === "REVIEW_REQUESTED" ? 200
    : result.status === "REVIEW_REQUESTED_UNPARKED" ? 409
    : result.status === "SHIFT_NOT_OPEN" ? 409
    : result.status === "TOO_MANY" ? 409
    : result.status === "INVALID_PACK" ? 409
    : result.status === "NOT_REQUIRED" ? 409
    : result.status === "EMPTY" ? 400
    : String(result.status).startsWith("PHARMACY_") ? 403
    : 400;

  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/pharmacy-review", handlePOST);
