// =============================================================
// POST /api/pos/expense — ค่าใช้จ่ายเงินสดย่อยหน้าร้าน
// -------------------------------------------------------------
// list   : รายการของกะนี้
// create : จ่ายตรง เบิกเงินไปซื้อของ หรือเจ้าของสำรองจ่ายส่วนตัว
// settle : ลงยอดซื้อจริง แล้วคืนเงินทอน/จ่ายส่วนเกินเข้าลิ้นชักอัตโนมัติ
// fund   : เจ้าของเติมกระเป๋าเงินสดย่อยของสาขาจากเงินนอกลิ้นชัก
//
// เงินออกจากลิ้นชักต้องมีสองคนเสมอ ส่วน PERSONAL ต้องถือสิทธิ์เฉพาะ
// pos.expense.personal, มีหลักฐาน และไม่สร้าง cash movement
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";
import {
  createPosExpense,
  fundPosPettyCash,
  getPosPettyCashWallet,
  listPosExpenses,
  POS_EXPENSE_CATEGORIES,
  settlePosExpense,
  type PosExpenseCategory,
  type PosExpenseFundingSource,
  type PosExpenseKind,
  type PosPettyCashFundingSource,
} from "@/lib/bms/posExpenses";
import { isDistinctPosApprover } from "@/lib/bms/posRouteHelpers";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return NextResponse.json({ error: "device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!UUID_RE.test(cashierUserId) || !pin || pin.length > 32) {
    return NextResponse.json({ error: "ต้องระบุพนักงานและ PIN" }, { status: 400 });
  }
  const actor = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!actor.ok) return NextResponse.json({ error: "PIN ไม่ถูกต้อง", reason: actor.reason }, { status: 403 });

  if (action === "fund") {
    if (!(await cashierHasPermission(device.tenantId, actor.userId, "pos.petty_cash.manage"))) {
      return NextResponse.json({ error: "บัญชีนี้ไม่มีสิทธิ์เติมเงินสดย่อย" }, { status: 403 });
    }
    const source = body.source === "OWNER_PERSONAL" || body.source === "BUSINESS_ACCOUNT"
      ? body.source as PosPettyCashFundingSource : null;
    if (!source) return NextResponse.json({ error: "แหล่งเงินสดย่อยไม่ถูกต้อง" }, { status: 400 });
    const result = await fundPosPettyCash({
      tenantId: device.tenantId,
      locationId: device.locationId,
      source,
      amount: Number(body.amount),
      reason: typeof body.reason === "string" ? body.reason : "",
      evidenceRef: typeof body.evidenceRef === "string" ? body.evidenceRef : "",
      actorUserId: actor.userId,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
    });
    const status = result.status === "FUNDED" ? 200
      : result.status === "LOCATION_NOT_FOUND" || result.status === "IDEMPOTENCY_CONFLICT" ? 409
      : 400;
    return NextResponse.json(result, { status });
  }

  if (!(await cashierHasPermission(device.tenantId, actor.userId, "pos.expense.create"))) {
    return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์ทำรายการค่าใช้จ่าย" }, { status: 403 });
  }

  if (action === "list") {
    const shift = await getOpenPosShift(device.tenantId, device.id);
    if (!shift) return NextResponse.json({ error: "ยังไม่ได้เปิดกะ", status: "SHIFT_NOT_OPEN" }, { status: 409 });
    const [expenses, wallet, canUsePersonalFunds, canManagePettyCash] = await Promise.all([
      listPosExpenses(device.tenantId, shift.id, device.id),
      getPosPettyCashWallet(device.tenantId, device.locationId),
      cashierHasPermission(device.tenantId, actor.userId, "pos.expense.personal"),
      cashierHasPermission(device.tenantId, actor.userId, "pos.petty_cash.manage"),
    ]);
    return NextResponse.json({
      expenses,
      categories: POS_EXPENSE_CATEGORIES,
      canUsePersonalFunds,
      canManagePettyCash,
      pettyCashWallet: wallet,
    });
  }
  if (action !== "create" && action !== "settle") {
    return NextResponse.json({ error: "action ต้องเป็น list, create หรือ settle" }, { status: 400 });
  }

  // A retry carries the shift it originally acted on. New writes still require
  // that shift to be OPEN in the service, while a committed retry can return its
  // original result after the shift has closed.
  const requestedShiftId = typeof body.shiftId === "string" ? body.shiftId.trim() : "";
  const openShift = await getOpenPosShift(device.tenantId, device.id);
  const shiftId = UUID_RE.test(requestedShiftId) ? requestedShiftId : openShift?.id ?? "";
  if (!shiftId) {
    return NextResponse.json({ error: "ยังไม่ได้เปิดกะ", status: "SHIFT_NOT_OPEN" }, { status: 409 });
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 180) {
    return NextResponse.json({ error: "idempotencyKey จำเป็นและต้องไม่เกิน 180 ตัวอักษร" }, { status: 400 });
  }
  const receiptRef = typeof body.receiptRef === "string" ? body.receiptRef : null;
  if (body.fundingSource != null && body.fundingSource !== "DRAWER"
      && body.fundingSource !== "PERSONAL" && body.fundingSource !== "PETTY_CASH") {
    return NextResponse.json({ error: "แหล่งเงินค่าใช้จ่ายไม่ถูกต้อง" }, { status: 400 });
  }
  const fundingSource: PosExpenseFundingSource = body.fundingSource === "PERSONAL" ? "PERSONAL"
    : body.fundingSource === "PETTY_CASH" ? "PETTY_CASH" : "DRAWER";

  let approverUserId: string | null = null;
  if (action === "settle" || fundingSource === "DRAWER") {
    const approverId = typeof body.approverUserId === "string" ? body.approverUserId.trim() : "";
    const approverPin = typeof body.approverPin === "string" ? body.approverPin : "";
    if (!UUID_RE.test(approverId) || !approverPin || approverPin.length > 32) {
      return NextResponse.json({ error: "เงินออกจากลิ้นชักต้องมีผู้อนุมัติกด PIN" }, { status: 400 });
    }
    if (!isDistinctPosApprover(actor.userId, approverId)) {
      return NextResponse.json({ error: "ผู้อนุมัติต้องเป็นคนละคนกับผู้ทำรายการ" }, { status: 400 });
    }
    const approver = await verifyCashierPin(device.tenantId, approverId, approverPin);
    if (!approver.ok) {
      return NextResponse.json({ error: "PIN ผู้อนุมัติไม่ถูกต้อง", reason: approver.reason }, { status: 403 });
    }
    if (!(await cashierHasPermission(device.tenantId, approver.userId, "pos.cash.movement"))) {
      return NextResponse.json({ error: "พนักงานคนนี้ไม่มีสิทธิ์อนุมัติเงินออกจากลิ้นชัก" }, { status: 403 });
    }
    approverUserId = approver.userId;
  } else if (fundingSource === "PERSONAL"
      && !(await cashierHasPermission(device.tenantId, actor.userId, "pos.expense.personal"))) {
    return NextResponse.json({ error: "บัญชีนี้ไม่มีสิทธิ์ใช้โหมดเจ้าของคนเดียว" }, { status: 403 });
  }

  if (action === "create") {
    const kind = body.kind === "DIRECT" || body.kind === "ADVANCE" ? body.kind as PosExpenseKind : null;
    const category = typeof body.category === "string"
      && (POS_EXPENSE_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category as PosExpenseCategory
      : null;
    if (!kind || !category) return NextResponse.json({ error: "รูปแบบหรือหมวดค่าใช้จ่ายไม่ถูกต้อง" }, { status: 400 });
    const result = await createPosExpense({
      tenantId: device.tenantId,
      shiftId,
      deviceId: device.id,
      locationId: device.locationId,
      kind,
      category,
      description: typeof body.description === "string" ? body.description : "",
      payee: typeof body.payee === "string" ? body.payee : null,
      amount: Number(body.amount),
      receiptRef,
      actorUserId: actor.userId,
      fundingSource,
      approvedByUserId: approverUserId,
      idempotencyKey,
    });
    const status = result.status === "RECORDED" ? 200
      : result.status === "SHIFT_NOT_OPEN" || result.status === "WOULD_OVERDRAW"
        || result.status === "PETTY_CASH_INSUFFICIENT" || result.status === "IDEMPOTENCY_CONFLICT" ? 409
      : 400;
    return NextResponse.json(result, { status });
  }

  const expenseId = typeof body.expenseId === "string" ? body.expenseId.trim() : "";
  if (!UUID_RE.test(expenseId)) return NextResponse.json({ error: "รายการค่าใช้จ่ายไม่ถูกต้อง" }, { status: 400 });
  const result = await settlePosExpense({
    tenantId: device.tenantId,
    shiftId,
    deviceId: device.id,
    expenseId,
    actualAmount: Number(body.actualAmount),
    receiptRef,
    actorUserId: actor.userId,
    approvedByUserId: approverUserId!,
    idempotencyKey,
  });
  const status = result.status === "SETTLED" ? 200
    : result.status === "NOT_FOUND" ? 404
    : result.status === "SHIFT_NOT_OPEN" || result.status === "ALREADY_SETTLED"
      || result.status === "WOULD_OVERDRAW" || result.status === "IDEMPOTENCY_CONFLICT" ? 409
    : 400;
  return NextResponse.json(result, { status });
}

export const POST = withRouteErrorLog("POST /api/pos/expense", handlePOST);
