// =============================================================
// POS shift operations — park, cash in/out, void, shift report (7.97)
// -------------------------------------------------------------
// Four features that all hang off one open shift, so one suite drives them in
// the order a real counter does: open a shift, park a cart and pull it back,
// move cash in and out of the drawer, sell a bill and void it, then read the
// shift report and close on a known variance.
//
// What this suite exists to catch, specifically:
//   - a voided bill must leave the sales figures AND stay out of return reports
//   - drawer movements must reach expected_cash, or every shift closes short
//   - the report's expected cash and closePosShift's expected cash must agree;
//     two formulas that drift apart is the failure that makes the paper the
//     manager signs disagree with the till
//
// Run from apps/web (same invocation as the other DB suites):
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit ../../scripts/pos-shift-ops-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { updateVatSettings, getVatSettings } from "../apps/web/lib/bms/taxDocuments.ts";
import {
  closePosShift,
  deleteParkedSale,
  getPosShiftReport,
  issuePosDeviceToken,
  listCashMovements,
  listParkedSales,
  listRecentPosSales,
  openPosShift,
  parkSale,
  listNoSales,
  recordCashMovement,
  recordNoSale,
  recordPosSale,
  returnPosSale,
  resumeParkedSale,
  setCashierPin,
  upsertPosDevice,
  verifyCashierPin,
  voidPosSale,
} from "../apps/web/lib/bms/pos.ts";
import {
  createPosExpense,
  fundPosPettyCash,
  getPosPettyCashWallet,
  listPosExpenses,
  settlePosExpense,
} from "../apps/web/lib/bms/posExpenses.ts";

const TAG = "pos-shiftops-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "5137";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let approverId = "";
let shiftId = "";
let soldOrderId = "";
let parkedId = "";
let initialPettyCashBalance = 0;
let initialPettyCashWalletExisted = false;
let directExpenseId = "";
let advanceExpenseId = "";
const transientBranchIds: string[] = [];

const key = (n: string) => `${TAG}-${n}-${process.pid}`;

test("setup: shop, product, register, cashier PIN", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;

  const loc = await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  );
  assert.ok(loc.rows[0], "ต้องมีสาขา (7.84)");
  locationId = loc.rows[0].id;

  // ปัดเศษเงินสดปิด — ยอดที่คาดไว้ต้องเป็นเลขตรงเพื่อให้ variance ตรวจได้
  //
  // และปิดโหมดนับปิดตาไว้เป็นค่าตั้งต้นของชุดนี้ (8.0 ตั้ง DEFAULT TRUE) เพราะเทส
  // ส่วนใหญ่ตรวจ "ตัวเลขที่ควรมี" ตรง ๆ ซึ่งโหมดนั้นซ่อนไว้โดยตั้งใจ · เทสที่ตรวจ
  // ตัวโหมดเองเปิด-ปิดเองในเทสนั้น
  await query(
    `UPDATE bms_store_profile SET cash_rounding = 'NONE', pos_blind_close = FALSE WHERE tenant_id = $1`,
    [tenantId]
  );

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,10000,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 10000, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );

  const device = await upsertPosDevice(tenantId, {
    locationId, code: `${TAG}-REG`, name: `FAKE ${TAG} register`, active: true,
  });
  deviceId = device.id;
  await issuePosDeviceToken(tenantId, deviceId);

  const admin = await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name = 'Administrator'
      ORDER BY u.created_at LIMIT 1`,
    [tenantId]
  );
  assert.ok(admin.rows[0], "ต้องมี Administrator อย่างน้อย 1 คน");
  cashierId = admin.rows[0].id;
  approverId = (await query<{ id: string }>(
    `INSERT INTO users (name, email, role, password_hash, fake_test, tenant_id, role_id)
     SELECT $2, $3, u.role, u.password_hash, TRUE, u.tenant_id, u.role_id
       FROM users u WHERE u.tenant_id = $1 AND u.id = $4
     RETURNING id`,
    [tenantId, `${TAG} approver`, `${TAG}-${process.pid}@example.invalid`, cashierId]
  )).rows[0].id;
  await setCashierPin(tenantId, cashierId, PIN);
});

test("open shift with a ฿1,000 float", async () => {
  const res = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 1000 });
  assert.ok(res.status === "OPENED" || res.status === "ALREADY_OPEN", JSON.stringify(res));
  if (res.status === "OPENED" || res.status === "ALREADY_OPEN") shiftId = res.shift.id;
});

// ---- พักบิล ----------------------------------------------------------

test("park a cart, see it listed, pull it back exactly once", async () => {
  const cart = [{ sku: SKU, size: SIZE, packQty: 2, packCode: null }];
  const parked = await parkSale({
    tenantId, deviceId, shiftId, parkedBy: cashierId,
    label: "ป้าแดง", cart, itemCount: 2, subtotalHint: 200,
  });
  assert.equal(parked.status, "PARKED");
  if (parked.status !== "PARKED") return;
  parkedId = parked.parked.id;

  const list = await listParkedSales(tenantId, shiftId);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, "ป้าแดง");
  assert.equal(list[0].itemCount, 2);

  const resumed = await resumeParkedSale(tenantId, shiftId, parkedId);
  assert.equal(resumed.status, "RESUMED");
  assert.deepEqual(resumed.status === "RESUMED" ? resumed.cart : null, cart);

  // เรียกซ้ำต้องไม่ได้ตะกร้าซ้ำ — สองเครื่องที่แชร์กะเดียวกันจะได้ของซ้ำสองจอ
  const again = await resumeParkedSale(tenantId, shiftId, parkedId);
  assert.equal(again.status, "NOT_FOUND");
  assert.equal((await listParkedSales(tenantId, shiftId)).length, 0);
});

test("parking rejects an empty cart and an unnamed bill", async () => {
  assert.equal((await parkSale({
    tenantId, deviceId, shiftId, parkedBy: cashierId,
    label: "ไม่มีของ", cart: [], itemCount: 0, subtotalHint: 0,
  })).status, "EMPTY");

  assert.equal((await parkSale({
    tenantId, deviceId, shiftId, parkedBy: cashierId,
    label: "   ", cart: [{ sku: SKU, size: SIZE, packQty: 1 }], itemCount: 1, subtotalHint: 100,
  })).status, "EMPTY");
});

// ---- เงินเข้า-ออกลิ้นชัก ----------------------------------------------

test("drawer movements land in the drawer and refuse to overdraw it", async () => {
  const put = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "IN", amount: 500,
    reason: "แลกเหรียญมาเพิ่ม", actorUserId: cashierId, idempotencyKey: key("cash-in"),
  });
  assert.equal(put.status, "RECORDED");
  // 1000 float + 500 = 1500
  assert.equal(put.status === "RECORDED" ? put.drawerAfter : null, 1500);
  const putReplay = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "IN", amount: 500,
    reason: "แลกเหรียญมาเพิ่ม", actorUserId: cashierId, idempotencyKey: key("cash-in"),
  });
  assert.equal(putReplay.status, "RECORDED");
  assert.equal(putReplay.status === "RECORDED" ? putReplay.replayed : false, true);

  const take = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "OUT", amount: 300,
    reason: "นำส่งธนาคาร", actorUserId: cashierId, approvedByUserId: cashierId,
    idempotencyKey: key("cash-out"),
  });
  assert.equal(take.status, "RECORDED");
  assert.equal(take.status === "RECORDED" ? take.drawerAfter : null, 1200);

  // พิมพ์ 99999 แทน 999 — รายการที่ทำให้ยอดที่ควรมีติดลบคือรายการที่กรอกผิดแน่นอน
  const tooMuch = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "OUT", amount: 99999,
    reason: "พิมพ์ผิด", actorUserId: cashierId, approvedByUserId: cashierId,
    idempotencyKey: key("cash-overdraw"),
  });
  assert.equal(tooMuch.status, "WOULD_OVERDRAW");

  const moves = await listCashMovements(tenantId, shiftId);
  assert.equal(moves.length, 2, "รายการที่ถูกปฏิเสธต้องไม่ถูกบันทึก");
});

test("a movement with no reason is refused", async () => {
  const res = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "IN", amount: 100,
    reason: "  ", actorUserId: cashierId, idempotencyKey: key("cash-no-reason"),
  });
  assert.equal(res.status, "INVALID");
});

// ---- ค่าใช้จ่ายเงินสดย่อย --------------------------------------------

test("direct expense and advance settlement share the drawer ledger atomically", async () => {
  const direct = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", category: "INGREDIENTS",
    description: "ค่าน้ำแข็ง", payee: "ร้านน้ำแข็ง", amount: 100,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-direct"),
  });
  assert.equal(direct.status, "RECORDED", JSON.stringify(direct));
  if (direct.status === "RECORDED") directExpenseId = direct.expense.id;

  const advance = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "ADVANCE", category: "INGREDIENTS",
    description: "เบิกซื้อน้ำตาล", amount: 200,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-advance"),
  });
  assert.equal(advance.status, "RECORDED", JSON.stringify(advance));
  if (advance.status !== "RECORDED") return;
  advanceExpenseId = advance.expense.id;

  const pendingClose = await closePosShift({
    tenantId, shiftId, closedBy: cashierId, countedCash: 0,
  });
  assert.equal(pendingClose.status, "PENDING_EXPENSES");

  const settled = await settlePosExpense({
    tenantId, deviceId, shiftId, expenseId: advance.expense.id, actualAmount: 150,
    receiptRef: "RCPT-TEST", actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-settle"),
  });
  assert.equal(settled.status, "SETTLED", JSON.stringify(settled));
  if (settled.status === "SETTLED") {
    assert.equal(settled.expense.returnedAmount, 50);
    assert.equal(settled.expense.extraCashOut, 0);
  }
  const replay = await settlePosExpense({
    tenantId, deviceId, shiftId, expenseId: advance.expense.id, actualAmount: 150,
    receiptRef: "RCPT-TEST", actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-settle"),
  });
  assert.equal(replay.status, "SETTLED");
  assert.equal(replay.status === "SETTLED" ? replay.replayed : false, true);

  const extraAdvance = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "ADVANCE", category: "TRANSPORT",
    description: "เบิกค่าน้ำมัน", amount: 50,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-advance-extra"),
  });
  assert.equal(extraAdvance.status, "RECORDED", JSON.stringify(extraAdvance));
  if (extraAdvance.status !== "RECORDED") return;
  const movesBeforeRejectedSettle = await listCashMovements(tenantId, shiftId);
  const rejectedSettle = await settlePosExpense({
    tenantId, deviceId, shiftId, expenseId: extraAdvance.expense.id, actualAmount: 99999,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-settle-overdraw"),
  });
  assert.equal(rejectedSettle.status, "WOULD_OVERDRAW");
  assert.equal((await listCashMovements(tenantId, shiftId)).length, movesBeforeRejectedSettle.length,
    "settlement ที่ถอนเกินต้อง rollback โดยไม่ทิ้ง movement");

  const extraSettled = await settlePosExpense({
    tenantId, deviceId, shiftId, expenseId: extraAdvance.expense.id, actualAmount: 80,
    receiptRef: "RCPT-EXTRA-TEST", actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-settle-extra"),
  });
  assert.equal(extraSettled.status, "SETTLED", JSON.stringify(extraSettled));
  if (extraSettled.status === "SETTLED") {
    assert.equal(extraSettled.expense.returnedAmount, 0);
    assert.equal(extraSettled.expense.extraCashOut, 30);
  }

  const expenses = await listPosExpenses(tenantId, shiftId, deviceId);
  assert.equal(expenses.length, 3);
  assert.equal(expenses.reduce((sum, expense) => sum + (expense.actualAmount ?? 0), 0), 330);
});

test("sole owner can record personal funds without changing the drawer", async () => {
  const drawerBefore = (await getPosShiftReport(tenantId, shiftId))!.expectedCash;
  const before = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_cash_movements
      WHERE tenant_id = $1 AND shift_id = $2`,
    [tenantId, shiftId]
  );
  const personal = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", fundingSource: "PERSONAL",
    category: "PACKAGING", description: "เจ้าของซื้อถุงด้วยเงินส่วนตัว",
    amount: 75, receiptRef: "PERSONAL-RCPT-TEST", actorUserId: cashierId,
    idempotencyKey: key("expense-personal"),
  });
  assert.equal(personal.status, "RECORDED", JSON.stringify(personal));
  if (personal.status !== "RECORDED") return;
  assert.equal(personal.expense.fundingSource, "PERSONAL");
  assert.equal(personal.expense.approvedByName, null);
  assert.equal(personal.drawerAfter, drawerBefore, "เงินส่วนตัวต้องไม่ลดเงินในลิ้นชัก");

  const after = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_cash_movements
      WHERE tenant_id = $1 AND shift_id = $2`,
    [tenantId, shiftId]
  );
  assert.equal(after.rows[0].n, before.rows[0].n, "เงินส่วนตัวต้องไม่สร้าง drawer movement");

  const replay = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", fundingSource: "PERSONAL",
    category: "PACKAGING", description: "เจ้าของซื้อถุงด้วยเงินส่วนตัว",
    amount: 75, receiptRef: "PERSONAL-RCPT-TEST", actorUserId: cashierId,
    idempotencyKey: key("expense-personal"),
  });
  assert.equal(replay.status, "RECORDED");
  assert.equal(replay.status === "RECORDED" ? replay.replayed : false, true);

  const noEvidence = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", fundingSource: "PERSONAL",
    category: "OTHER", description: "ไม่มีหลักฐาน", amount: 10,
    actorUserId: cashierId, idempotencyKey: key("expense-personal-no-evidence"),
  });
  assert.equal(noEvidence.status, "INVALID");
});

test("branch petty cash funds and spends outside the drawer with an append-only balance", async () => {
  const initialWallet = await query<{ balance: string }>(
    `SELECT balance FROM bms_pos_petty_cash_wallets WHERE tenant_id = $1 AND location_id = $2`,
    [tenantId, locationId]
  );
  initialPettyCashWalletExisted = Boolean(initialWallet.rowCount);
  initialPettyCashBalance = Number(initialWallet.rows[0]?.balance ?? 0);
  const tooLarge = await fundPosPettyCash({
    tenantId, locationId, source: "OWNER_PERSONAL", amount: 10_000_000_000,
    reason: "ยอดเกินขนาดคอลัมน์", evidenceRef: "PETTY-TOO-LARGE",
    actorUserId: cashierId, idempotencyKey: key("petty-fund-too-large"),
  });
  assert.equal(tooLarge.status, "INVALID", "ยอดเกิน NUMERIC(12,2) ต้องไม่หลุดไปเป็น database 500");
  const before = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_cash_movements
      WHERE tenant_id = $1 AND shift_id = $2`,
    [tenantId, shiftId]
  );
  const funded = await fundPosPettyCash({
    tenantId, locationId, source: "OWNER_PERSONAL", amount: 300,
    reason: "ตั้งเงินสดย่อยประจำวัน", evidenceRef: "PETTY-FUND-TEST",
    actorUserId: cashierId, idempotencyKey: key("petty-fund"),
  });
  assert.equal(funded.status, "FUNDED", JSON.stringify(funded));
  assert.equal(funded.status === "FUNDED" ? funded.balanceAfter : null, initialPettyCashBalance + 300);

  const replay = await fundPosPettyCash({
    tenantId, locationId, source: "OWNER_PERSONAL", amount: 300,
    reason: "ตั้งเงินสดย่อยประจำวัน", evidenceRef: "PETTY-FUND-TEST",
    actorUserId: cashierId, idempotencyKey: key("petty-fund"),
  });
  assert.equal(replay.status, "FUNDED");
  assert.equal(replay.status === "FUNDED" ? replay.replayed : false, true);

  const expense = await createPosExpense({
    tenantId, locationId, deviceId, shiftId, kind: "DIRECT", fundingSource: "PETTY_CASH",
    category: "INGREDIENTS", description: "ซื้อน้ำตาลจากเงินสดย่อย",
    amount: 80, receiptRef: "PETTY-RCPT-TEST", actorUserId: cashierId,
    idempotencyKey: key("expense-petty"),
  });
  assert.equal(expense.status, "RECORDED", JSON.stringify(expense));
  assert.equal(expense.status === "RECORDED" ? expense.pettyCashAfter : null, initialPettyCashBalance + 220);

  const wallet = await getPosPettyCashWallet(tenantId, locationId);
  assert.equal(wallet.balance, initialPettyCashBalance + 220);
  assert.ok(wallet.entries.some((entry) => entry.direction === "IN" && entry.evidenceRef === "PETTY-FUND-TEST"));
  assert.ok(wallet.entries.some((entry) => entry.direction === "OUT" && entry.evidenceRef === "PETTY-RCPT-TEST"));

  const overdraw = await createPosExpense({
    tenantId, locationId, deviceId, shiftId, kind: "DIRECT", fundingSource: "PETTY_CASH",
    category: "OTHER", description: "จ่ายเกินวงเงิน", amount: initialPettyCashBalance + 999,
    receiptRef: "PETTY-OVERDRAW-TEST", actorUserId: cashierId,
    idempotencyKey: key("expense-petty-overdraw"),
  });
  assert.equal(overdraw.status, "PETTY_CASH_INSUFFICIENT");
  assert.equal(overdraw.status === "PETTY_CASH_INSUFFICIENT" ? overdraw.available : null, initialPettyCashBalance + 220);

  const after = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_cash_movements
      WHERE tenant_id = $1 AND shift_id = $2`,
    [tenantId, shiftId]
  );
  assert.equal(after.rows[0].n, before.rows[0].n, "เงินสดย่อยต้องไม่สร้าง drawer movement");

  await assert.rejects(
    query(
      `INSERT INTO bms_pos_petty_cash_ledger
         (tenant_id, location_id, direction, source, amount, balance_after, reason,
          evidence_ref, actor_user_id, idempotency_key, request_hash)
       VALUES ($1,$2,'IN','EXPENSE',1,$3,'invalid shape','TEST',$4,$5,$6)`,
      [tenantId, locationId, initialPettyCashBalance, cashierId,
        key("petty-invalid-shape"), "a".repeat(64)]
    ),
    /bms_pos_petty_cash_ledger_shape_check/,
    "database ต้องปฏิเสธ IN ที่อ้างว่าเป็น EXPENSE แม้ caller ไม่ผ่าน service"
  );
});

test("tenant-wide idempotency serializes the same funding key across branches", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  for (const n of [1, 2]) {
    const branch = await query<{ id: string }>(
      `INSERT INTO bms_locations (tenant_id, code, name, branch_code, active, is_head_office)
       VALUES ($1,$2,$3,$4,TRUE,FALSE) RETURNING id`,
      [tenantId, `${TAG}-${suffix}-${n}`, `FAKE ${TAG} idempotency ${n}`, `${suffix}-${n}`]
    );
    transientBranchIds.push(branch.rows[0].id);
  }
  const sharedKey = key("petty-cross-branch");
  const inputs = transientBranchIds.map((branchId, index) => ({
    tenantId, locationId: branchId, source: "OWNER_PERSONAL" as const, amount: 40,
    reason: `เติมพร้อมกันสาขา ${index + 1}`, evidenceRef: `CROSS-BRANCH-${index + 1}`,
    actorUserId: cashierId, idempotencyKey: sharedKey,
  }));
  const results = await Promise.all(inputs.map((input) => fundPosPettyCash(input)));
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["FUNDED", "IDEMPOTENCY_CONFLICT"],
    "key เดียวกันข้ามสาขาต้องมีผู้ชนะคนเดียวและอีกคำขอเป็น conflict ไม่ใช่ database 500"
  );

  const winner = results.findIndex((result) => result.status === "FUNDED");
  await query(`UPDATE bms_locations SET active = FALSE WHERE tenant_id = $1 AND id = $2`,
    [tenantId, inputs[winner].locationId]);
  const replayAfterDeactivate = await fundPosPettyCash(inputs[winner]);
  assert.equal(replayAfterDeactivate.status, "FUNDED",
    "retry ที่ commit แล้วต้องคืนผลเดิม แม้สาขาถูกปิดภายหลัง");
  assert.equal(replayAfterDeactivate.status === "FUNDED" ? replayAfterDeactivate.replayed : false, true);
});

// ---- ขาย แล้ว void ----------------------------------------------------

test("sell one bill for ฿300 cash", async () => {
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 3 }],
    payments: [{ method: "CASH", amount: 300, cashTendered: 500 }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  soldOrderId = sale.orderId;
});

test("void puts the stock back, cancels the tax document, and leaves the sales figures", async () => {
  const before = await query<{ n: string }>(
    `SELECT current_stock::text AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );

  const res = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: soldOrderId,
    actorUserId: cashierId, approvedByUserId: cashierId,
    reason: "สแกนซ้ำ", idempotencyKey: key("void"),
  });
  assert.equal(res.status, "VOIDED", JSON.stringify(res));

  const after = await query<{ n: string }>(
    `SELECT current_stock::text AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  assert.equal(Number(after.rows[0].n) - Number(before.rows[0].n), 3, "ของ 3 ชิ้นต้องกลับเข้าสต็อก");

  const order = await query<{ voided_at: Date | null; void_reason: string | null }>(
    `SELECT voided_at, void_reason FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, soldOrderId]
  );
  assert.ok(order.rows[0].voided_at, "ต้องประทับเวลาที่ยกเลิก");
  assert.equal(order.rows[0].void_reason, "สแกนซ้ำ");

  // ใบกำกับถูกยกเลิก ไม่ใช่ถูกลบ — เลขที่ออกไปแล้วต้องยังอยู่ในลำดับ
  const doc = await query<{ n: string; cancelled: string }>(
    `SELECT COUNT(*)::text AS n,
            COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL)::text AS cancelled
       FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, soldOrderId]
  );
  if (Number(doc.rows[0].n) > 0) {
    assert.equal(doc.rows[0].cancelled, doc.rows[0].n, "ใบกำกับทุกใบของบิลนี้ต้องถูกยกเลิก");
  }
});

test("a voided bill is flagged as a void, not as a customer return", async () => {
  const ret = await query<{ is_void: boolean }>(
    `SELECT is_void FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, soldOrderId]
  );
  assert.equal(ret.rows[0]?.is_void, true,
    "ไม่ตั้งธงนี้ = การกดผิดจะไปปลุกสัญญาณจับทุจริตใน pos-return-audit");

  const recent = await listRecentPosSales(tenantId, deviceId, 20);
  const row = recent.find((r) => r.orderId === soldOrderId);
  assert.ok(row?.voidedAt, "จอต้องแยกป้าย 'ยกเลิกแล้ว' ออกจาก 'คืนแล้ว' ได้");
});

test("voiding twice is safe, and a void with no reason is refused", async () => {
  const again = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: soldOrderId,
    actorUserId: cashierId, approvedByUserId: cashierId,
    reason: "กดซ้ำเพราะเน็ตหลุด", idempotencyKey: key("void-2"),
  });
  assert.equal(again.status, "VOIDED", "ยิงซ้ำต้องตอบว่าสำเร็จ ไม่ใช่ error");

  const noReason = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: soldOrderId,
    actorUserId: cashierId, approvedByUserId: cashierId,
    reason: "   ", idempotencyKey: key("void-3"),
  });
  assert.equal(noReason.status, "NOT_VOIDABLE");
});

// ---- สรุปกะ + ปิดกะ ---------------------------------------------------

test("the shift report keeps the void out of sales and out of returns", async () => {
  const report = await getPosShiftReport(tenantId, shiftId);
  assert.ok(report);
  assert.equal(report!.voidCount, 1);
  assert.equal(report!.voidTotal, 300);
  assert.equal(report!.salesTotal, 0, "บิลเดียวของกะนี้ถูกยกเลิก ยอดขายต้องเป็น 0");
  assert.equal(report!.billCount, 0);
  assert.equal(report!.returnCount, 0, "void ต้องไม่ถูกนับเป็นการคืนสินค้า");
  assert.equal(report!.cashIn, 550);
  assert.equal(report!.cashOut, 680);
  assert.equal(report!.expenseCount, 5);
  assert.equal(report!.expenseTotal, 485);
  assert.equal(report!.personalExpenseCount, 1);
  assert.equal(report!.personalExpenseTotal, 75);
  assert.equal(report!.pettyCashExpenseCount, 1);
  assert.equal(report!.pettyCashExpenseTotal, 80);
  assert.equal(report!.openExpenseCount, 0);
  assert.equal(await getPosShiftReport(tenantId, shiftId, crypto.randomUUID()), null,
    "เครื่องอื่นที่รู้ shift UUID ต้องอ่านรายงานนี้ไม่ได้");
});

test("split-payment return is counted once, while pending/cancelled bills are not sales", async () => {
  await query(
    `INSERT INTO bms_orders
       (tenant_id, location_id, channel, status, total_amount, pos_device_id, pos_shift_id, cashier_user_id)
     VALUES
       ($1,$2,'pos','PENDING',999,$3,$4,$5),
       ($1,$2,'pos','CANCELLED',888,$3,$4,$5)`,
    [tenantId, locationId, deviceId, shiftId, cashierId]
  );
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId, idempotencyKey: key("split-sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [
      { method: "CASH", amount: 50, cashTendered: 50 },
      { method: "CASH", amount: 50, cashTendered: 50 },
    ],
  });
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  const returned = await returnPosSale({
    tenantId, deviceId, orderId: sale.orderId, actorUserId: cashierId,
    note: "ทดสอบ split refund", idempotencyKey: key("split-return"),
  });
  assert.equal(returned.status, "RETURNED", JSON.stringify(returned));

  const report = await getPosShiftReport(tenantId, shiftId);
  assert.equal(report!.salesTotal, 100, "บิล PENDING/CANCELLED ต้องไม่เพิ่มยอดขาย");
  assert.equal(report!.billCount, 1);
  assert.equal(report!.returnCount, 1, "หนึ่ง return ที่มีสอง allocation ต้องนับครั้งเดียว");
  assert.equal(report!.returnTotal, 100, "refund amount ต้องไม่ถูกคูณตามจำนวน allocation");
  assert.equal(report!.cashRefunds, 100);
});

// ---- no-sale + นับปิดตา (8.0) ----------------------------------------

test("opening the drawer without a sale is always recorded, and needs a reason", async () => {
  assert.equal(
    (await recordNoSale({ tenantId, deviceId, shiftId, actorUserId: cashierId, reason: "  " })).status,
    "INVALID"
  );

  const ok = await recordNoSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, reason: "แลกแบงก์ย่อยให้ลูกค้า",
  });
  assert.equal(ok.status, "RECORDED");

  const list = await listNoSales(tenantId, shiftId);
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, "แลกแบงก์ย่อยให้ลูกค้า");

  const report = await getPosShiftReport(tenantId, shiftId);
  assert.equal(report!.noSaleCount, 1, "จำนวนครั้งต้องขึ้นบนสรุปกะ — เป็นสัญญาณทุจริตที่ต้องเห็น");
  const audit = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'pos.no_sale' AND meta->>'shiftId' = $2`,
    [tenantId, shiftId]
  );
  assert.equal(Number(audit.rows[0].n), 1, "การเปิดลิ้นชักต้องอยู่ใน audit log กลางด้วย");
});

test("blind close hides expected cash while the shift is open, everywhere it could leak", async () => {
  const before = await getVatSettings(tenantId);
  await updateVatSettings(tenantId, { ...before, blindClose: true });

  const report = await getPosShiftReport(tenantId, shiftId);
  assert.equal(report!.expectedCash, null, "คนนับต้องไม่เห็นคำตอบก่อนกรอก");
  assert.equal(report!.expectedCashHidden, true);
  // ข้อเท็จจริงที่ไม่ใช่คำตอบยังต้องเห็นได้ ไม่งั้นรายงานอธิบายอะไรไม่ได้เลย
  assert.equal(report!.cashIn, 550);
  assert.equal(report!.cashOut, 680);

  // ช่องรั่วที่ตั้งใจปิด: นำเงินเข้า ฿1 แล้วอ่าน drawerAfter = อ่านคำตอบได้ทั้งหมด
  const move = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "IN", amount: 1,
    reason: "ทดสอบว่ายอดไม่รั่ว", actorUserId: cashierId, idempotencyKey: key("cash-blind-in"),
  });
  assert.equal(move.status, "RECORDED");
  assert.equal(move.status === "RECORDED" ? move.drawerAfter : "x", null);

  // ถอนเกินยังต้องถูกปฏิเสธ แต่ห้ามบอกว่าเหลือเท่าไร
  const over = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "OUT", amount: 99999,
    reason: "ทดสอบ", actorUserId: cashierId, approvedByUserId: cashierId,
    idempotencyKey: key("cash-blind-overdraw"),
  });
  assert.equal(over.status, "WOULD_OVERDRAW");
  assert.equal(over.status === "WOULD_OVERDRAW" ? over.available : 0, null);

  await updateVatSettings(tenantId, { ...before, blindClose: false });
  const open = await getPosShiftReport(tenantId, shiftId);
  assert.notEqual(open!.expectedCash, null, "ปิดโหมดแล้วต้องกลับมาเห็น");
});

test("expected cash agrees between the report and closePosShift", async () => {
  const report = await getPosShiftReport(tenantId, shiftId);
  const reportExpected = report!.expectedCash;

  // นับเงินให้ขาดไป 50 เพื่อดูว่า variance ถูกคิดจริง
  const closed = await closePosShift({
    tenantId, shiftId, closedBy: cashierId, countedCash: reportExpected - 50,
    note: `${TAG} close`,
  });
  assert.equal(closed.status, "CLOSED", JSON.stringify(closed));
  if (closed.status !== "CLOSED") return;

  // เทียบกับตัวเลขของรายงานเอง ไม่ใช่ค่าคงที่ที่เขียนไว้ — เทสก่อนหน้าเพิ่มรายการเงิน
  // เข้าลิ้นชักได้อีก และสิ่งที่เทสนี้ตรวจจริง ๆ คือ "สองทางต้องได้เลขเดียวกัน"
  // ไม่ใช่ "เลขต้องเป็น 500"
  assert.equal(closed.cashIn, report!.cashIn);
  assert.equal(closed.cashOut, report!.cashOut);
  assert.equal(closed.shift.expectedCash, reportExpected,
    "สองสูตรนี้ต้องได้เลขเดียวกัน ไม่งั้นกระดาษที่ผู้จัดการเซ็นจะไม่ตรงกับลิ้นชัก");
  assert.equal(closed.shift.cashVariance, -50);
});

test("expense retries return their committed result after the shift has closed", async () => {
  const directReplay = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", category: "INGREDIENTS",
    description: "ค่าน้ำแข็ง", payee: "ร้านน้ำแข็ง", amount: 100,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-direct"),
  });
  assert.equal(directReplay.status, "RECORDED", JSON.stringify(directReplay));
  assert.equal(directReplay.status === "RECORDED" ? directReplay.replayed : false, true);
  assert.equal(directReplay.status === "RECORDED" ? directReplay.expense.id : "", directExpenseId);

  const settleReplay = await settlePosExpense({
    tenantId, deviceId, shiftId, expenseId: advanceExpenseId, actualAmount: 150,
    receiptRef: "RCPT-TEST", actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-settle"),
  });
  assert.equal(settleReplay.status, "SETTLED", JSON.stringify(settleReplay));
  assert.equal(settleReplay.status === "SETTLED" ? settleReplay.replayed : false, true);

  const conflict = await createPosExpense({
    tenantId, deviceId, shiftId, kind: "DIRECT", category: "INGREDIENTS",
    description: "ค่าน้ำแข็ง", payee: "ร้านน้ำแข็ง", amount: 101,
    actorUserId: cashierId, approvedByUserId: approverId,
    idempotencyKey: key("expense-direct"),
  });
  assert.equal(conflict.status, "IDEMPOTENCY_CONFLICT",
    "key เดิมแต่ payload ต่างต้องเป็น conflict แม้กะปิดแล้ว");
});

test("parallel wrong PIN attempts still reach the lock threshold", async () => {
  await setCashierPin(tenantId, cashierId, PIN);
  const attempts = await Promise.all(
    Array.from({ length: 5 }, (_, i) => verifyCashierPin(tenantId, cashierId, `90${i}0`))
  );
  assert.ok(attempts.some((r) => !r.ok && r.reason === "LOCKED"),
    "atomic failure count ต้องล็อกได้แม้คำขอทั้งห้ามาพร้อมกัน");
  const correctWhileLocked = await verifyCashierPin(tenantId, cashierId, PIN);
  assert.equal(correctWhileLocked.ok, false);
  if (!correctWhileLocked.ok) assert.equal(correctWhileLocked.reason, "LOCKED");
  // ไม่ทิ้ง Administrator ของ dev tenant ไว้ในสถานะล็อกหลังชุดทดสอบ
  await setCashierPin(tenantId, cashierId, PIN);
});

test("teardown: remove every row this suite created", async () => {
  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND pos_device_id = $2`, [tenantId, deviceId]
  );
  const orderIds = orders.rows.map((r) => r.id);
  if (orderIds.length) {
    const returns = await query<{ id: string }>(
      `SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`,
      [tenantId, orderIds]
    );
    const returnIds = returns.rows.map((r) => r.id);
    if (returnIds.length) {
      await query(`DELETE FROM bms_pos_refund_allocations WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, returnIds]);
      await query(`DELETE FROM bms_pos_return_items WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, returnIds]);
    }
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, orderIds]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, orderIds]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, orderIds]);
  }
  await query(`DELETE FROM bms_pos_no_sales WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_expenses WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(
    `DELETE FROM bms_pos_petty_cash_ledger
      WHERE tenant_id = $1 AND location_id = $2 AND idempotency_key LIKE $3`,
    [tenantId, locationId, `%${TAG}%`]
  );
  if (transientBranchIds.length) {
    await query(`DELETE FROM bms_pos_petty_cash_ledger WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])`,
      [tenantId, transientBranchIds]);
    await query(`DELETE FROM bms_pos_petty_cash_wallets WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])`,
      [tenantId, transientBranchIds]);
    await query(`DELETE FROM bms_locations WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, transientBranchIds]);
  }
  if (initialPettyCashWalletExisted) {
    await query(
      `UPDATE bms_pos_petty_cash_wallets SET balance = $3, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2`,
      [tenantId, locationId, initialPettyCashBalance]
    );
  } else {
    await query(`DELETE FROM bms_pos_petty_cash_wallets WHERE tenant_id = $1 AND location_id = $2`, [tenantId, locationId]);
  }
  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_parked_sales WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2 AND fake_test = TRUE`, [tenantId, approverId]);
});
