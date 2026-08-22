// =============================================================
// Returning goods with no receipt (8.2)
// -------------------------------------------------------------
// 7.91 handled returns against a bill and required an orderId, so a customer who
// lost the receipt could not be served at all. This adds the path — and it is
// the most direct fraud route a shop has, so most of this suite is about the
// controls rather than the happy path.
//
// The one that would be silently expensive to get wrong: the cash paid out must
// land in the same place ordinary drawer movements do, or expected cash at close
// is short by exactly the refunds and nobody can explain the gap.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/pos-blind-return-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  blindReturnPosSale,
  closePosShift,
  getPosShiftReport,
  issuePosDeviceToken,
  openPosShift,
  setCashierPin,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "blindreturn-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "7391";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let approverId = "";
let shiftId = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;
const stock = async (): Promise<number> => {
  const res = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  return res.rowCount ? Number(res.rows[0].n) : 0;
};

test("setup: a ฿100 product, a register, and ฿1,000 in the drawer", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
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
     VALUES ($1,$2,$3,$4,50,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 50, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );

  const device = await upsertPosDevice(tenantId, {
    locationId, code: `${TAG}-REG`, name: `FAKE ${TAG} register`, active: true,
  });
  deviceId = device.id;
  await issuePosDeviceToken(tenantId, deviceId);

  cashierId = (await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name = 'Administrator' ORDER BY u.created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  approverId = (await query<{ id: string }>(
    `INSERT INTO users (name, email, role, password_hash, fake_test, tenant_id, role_id)
     SELECT $2, $3, u.role, u.password_hash, TRUE, u.tenant_id, u.role_id
       FROM users u WHERE u.tenant_id = $1 AND u.id = $4
     RETURNING id`,
    [tenantId, `${TAG} approver`, `${TAG}-${process.pid}@example.invalid`, cashierId]
  )).rows[0].id;
  await setCashierPin(tenantId, cashierId, PIN);

  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 1000 });
  assert.ok(opened.status === "OPENED" || opened.status === "ALREADY_OPEN");
  if (opened.status === "OPENED" || opened.status === "ALREADY_OPEN") shiftId = opened.shift.id;
});

test("goods come back into stock and the cash leaves the drawer through one path", async () => {
  const before = await stock();
  const res = await blindReturnPosSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
    reason: "ลูกค้าทำใบเสร็จหาย ของยังอยู่ในสภาพเดิม",
    lines: [{ sku: SKU, size: SIZE, qty: 2, unitRefund: 100 }],
    idempotencyKey: key("ok"),
  });
  assert.equal(res.status, "RETURNED", JSON.stringify(res));
  if (res.status !== "RETURNED") return;
  assert.equal(res.refundAmount, 200);
  assert.equal(await stock(), before + 2);
  const audit = await query<{ actor: string; meta: { approvedBy?: string } }>(
    `SELECT actor, meta FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'pos.blind_return' AND target = $2`,
    [tenantId, res.blindReturnId]
  );
  assert.equal(audit.rowCount, 1, "blind return ต้องมี audit กลางใน transaction เดียวกัน");
  assert.equal(audit.rows[0].actor, cashierId);
  assert.equal(audit.rows[0].meta.approvedBy, approverId);

  // เงินออกต้องอยู่ในตารางเดียวกับเงินลิ้นชักปกติ ไม่ใช่แหล่งที่สองที่ไม่เข้าสูตรปิดกะ
  const report = await getPosShiftReport(tenantId, shiftId);
  assert.equal(report!.cashOut, 200,
    "ถ้าเงินออกไม่เข้าสูตรนี้ ปิดกะจะเงินขาด 200 โดยไม่มีใครอธิบายได้");
  assert.equal(report!.expectedCash, 800);
});

test("replaying the same key pays out once, not twice", async () => {
  const before = await stock();
  const again = await blindReturnPosSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
    reason: "ยิงซ้ำเพราะเน็ตหลุด",
    lines: [{ sku: SKU, size: SIZE, qty: 2, unitRefund: 100 }],
    idempotencyKey: key("ok"),
  });
  assert.equal(again.status, "RETURNED");
  assert.equal(again.status === "RETURNED" ? again.replayed : false, true);
  assert.equal(await stock(), before, "ของต้องไม่เข้าสต็อกรอบสอง");

  const report = await getPosShiftReport(tenantId, shiftId);
  assert.equal(report!.cashOut, 200, "เงินต้องไม่ออกรอบสอง");
});

test("the refund per unit cannot exceed today's shelf price", async () => {
  const res = await blindReturnPosSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
    reason: "พยายามคืนแพงกว่าราคาขาย",
    lines: [{ sku: SKU, size: SIZE, qty: 1, unitRefund: 5000 }],
    idempotencyKey: key("toohigh"),
  });
  assert.equal(res.status, "PRICE_TOO_HIGH");
  if (res.status === "PRICE_TOO_HIGH") assert.equal(res.maxUnitRefund, 100);
});

test("a reason is mandatory, and an empty basket is refused", async () => {
  assert.equal(
    (await blindReturnPosSale({
      tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
      reason: "   ", lines: [{ sku: SKU, size: SIZE, qty: 1, unitRefund: 10 }],
      idempotencyKey: key("noreason"),
    })).status,
    "INVALID"
  );
  assert.equal(
    (await blindReturnPosSale({
      tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
      reason: "ตะกร้าว่าง", lines: [], idempotencyKey: key("empty"),
    })).status,
    "EMPTY"
  );
});

test("the cashier cannot approve their own no-receipt return", async () => {
  const result = await blindReturnPosSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: cashierId,
    reason: "ใบเสร็จหาย", lines: [{ sku: SKU, size: SIZE, qty: 1, unitRefund: 50 }],
    idempotencyKey: key("same-actor"),
  });
  assert.equal(result.status, "INVALID");
  if (result.status === "INVALID") assert.match(result.reason, /คนละคน/);
});

test("you cannot hand over cash the drawer does not hold", async () => {
  const res = await blindReturnPosSale({
    tenantId, deviceId, shiftId, actorUserId: cashierId, approvedByUserId: approverId,
    reason: "คืนเกินเงินในลิ้นชัก",
    lines: [{ sku: SKU, size: SIZE, qty: 40, unitRefund: 100 }],   // 4,000 จากลิ้นชักที่เหลือ 800
    idempotencyKey: key("nocash"),
  });
  assert.equal(res.status, "NOT_ENOUGH_CASH");
  if (res.status === "NOT_ENOUGH_CASH") assert.equal(res.available, 800);

  // รายการที่ล้มต้องไม่ทิ้งของเข้าสต็อกไว้ครึ่ง ๆ
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_pos_blind_returns
      WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key("nocash")]
  );
  assert.equal(Number(rows.rows[0].n), 0);
});

test("closing the shift accounts for the refund", async () => {
  const report = await getPosShiftReport(tenantId, shiftId);
  const closed = await closePosShift({
    tenantId, shiftId, closedBy: cashierId, countedCash: report!.expectedCash!, note: `${TAG}`,
  });
  assert.equal(closed.status, "CLOSED");
  if (closed.status !== "CLOSED") return;
  assert.equal(closed.cashOut, 200);
  assert.equal(closed.shift.cashVariance, 0, "นับได้เท่าที่ควรมี = ส่วนต่างศูนย์");
});

test("teardown: remove every row this suite created", async () => {
  const brs = await query<{ id: string }>(
    `SELECT id FROM bms_pos_blind_returns WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]
  );
  if (brs.rowCount) {
    await query(`DELETE FROM bms_audit_log WHERE tenant_id = $1 AND action = 'pos.blind_return' AND target = ANY($2::text[])`,
      [tenantId, brs.rows.map((r) => r.id)]);
    await query(`DELETE FROM bms_pos_blind_return_items WHERE tenant_id = $1 AND blind_return_id = ANY($2::uuid[])`,
      [tenantId, brs.rows.map((r) => r.id)]);
  }
  await query(`DELETE FROM bms_pos_blind_returns WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2 AND fake_test`, [tenantId, approverId]);
});
