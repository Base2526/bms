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
  recordCashMovement,
  recordPosSale,
  resumeParkedSale,
  setCashierPin,
  upsertPosDevice,
  voidPosSale,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "pos-shiftops-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "5137";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let soldOrderId = "";
let parkedId = "";

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
  await query(`UPDATE bms_store_profile SET cash_rounding = 'NONE' WHERE tenant_id = $1`, [tenantId]);

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
    reason: "แลกเหรียญมาเพิ่ม", actorUserId: cashierId,
  });
  assert.equal(put.status, "RECORDED");
  // 1000 float + 500 = 1500
  assert.equal(put.status === "RECORDED" ? put.drawerAfter : null, 1500);

  const take = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "OUT", amount: 300,
    reason: "นำส่งธนาคาร", actorUserId: cashierId, approvedByUserId: cashierId,
  });
  assert.equal(take.status, "RECORDED");
  assert.equal(take.status === "RECORDED" ? take.drawerAfter : null, 1200);

  // พิมพ์ 99999 แทน 999 — รายการที่ทำให้ยอดที่ควรมีติดลบคือรายการที่กรอกผิดแน่นอน
  const tooMuch = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "OUT", amount: 99999,
    reason: "พิมพ์ผิด", actorUserId: cashierId, approvedByUserId: cashierId,
  });
  assert.equal(tooMuch.status, "WOULD_OVERDRAW");

  const moves = await listCashMovements(tenantId, shiftId);
  assert.equal(moves.length, 2, "รายการที่ถูกปฏิเสธต้องไม่ถูกบันทึก");
});

test("a movement with no reason is refused", async () => {
  const res = await recordCashMovement({
    tenantId, deviceId, shiftId, direction: "IN", amount: 100,
    reason: "  ", actorUserId: cashierId,
  });
  assert.equal(res.status, "INVALID");
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
  assert.equal(report!.cashIn, 500);
  assert.equal(report!.cashOut, 300);
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

  assert.equal(closed.cashIn, 500);
  assert.equal(closed.cashOut, 300);
  assert.equal(closed.shift.expectedCash, reportExpected,
    "สองสูตรนี้ต้องได้เลขเดียวกัน ไม่งั้นกระดาษที่ผู้จัดการเซ็นจะไม่ตรงกับลิ้นชัก");
  assert.equal(closed.shift.cashVariance, -50);
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
  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_parked_sales WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
});
