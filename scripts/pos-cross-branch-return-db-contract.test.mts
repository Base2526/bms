// Cross-branch counter return (9.34). Dev database only.
// Run from apps/web through npm run test:db or directly with next-runtime-shim.

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { getPosReturnSummary } from "../apps/web/lib/bms/reports.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";
import {
  closePosShift,
  getPosShiftReport,
  issuePosDeviceToken,
  listRecentPosSales,
  openPosShift,
  recordPosSale,
  returnPosSale,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = `pos-cross-branch-${process.pid}`;
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let saleLocationId = "";
let returnLocationId = "";
let saleDeviceId = "";
let returnDeviceId = "";
let saleShiftId = "";
let returnShiftId = "";
let actorId = "";
let approverId = "";
let orderId = "";

const key = (suffix: string) => `${TAG}-${suffix}`;

test("setup two branches, registers, one lot and two distinct people", async () => {
  tenantId = (await query<{ id: string }>(
    `SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`
  )).rows[0].id;
  saleLocationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  returnLocationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, active, is_head_office)
     VALUES ($1,$2,$3,$4,TRUE,FALSE) RETURNING id`,
    [tenantId, `${TAG}-B`, `FAKE ${TAG} receiving`, `9${String(process.pid).slice(-4).padStart(4, "0")}`]
  )).rows[0].id;

  actorId = (await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name = 'Administrator'
      ORDER BY u.created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  approverId = (await query<{ id: string }>(
    `INSERT INTO users (name, email, role, password_hash, fake_test, tenant_id, role_id)
     SELECT $2, $3, u.role, u.password_hash, TRUE, u.tenant_id, u.role_id
       FROM users u WHERE u.tenant_id = $1 AND u.id = $4
     RETURNING id`,
    [tenantId, `${TAG} approver`, `${TAG}@example.invalid`, actorId]
  )).rows[0].id;

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_inventory
       (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,10,0)`,
    [tenantId, saleLocationId, SKU, SIZE]
  );
  await query(
    `INSERT INTO bms_inventory_lots
       (tenant_id, location_id, product_sku, size, lot_no, expiry_date, qty)
     VALUES ($1,$2,$3,$4,$5,'2030-12-31',10)`,
    [tenantId, saleLocationId, SKU, SIZE, `${TAG}-LOT`]
  );

  saleDeviceId = (await upsertPosDevice(tenantId, {
    locationId: saleLocationId, code: `${TAG}-SALE`, active: true,
  })).id;
  returnDeviceId = (await upsertPosDevice(tenantId, {
    locationId: returnLocationId, code: `${TAG}-RETURN`, active: true,
  })).id;
  await issuePosDeviceToken(tenantId, saleDeviceId);
  await issuePosDeviceToken(tenantId, returnDeviceId);

  const saleShift = await openPosShift({
    tenantId, deviceId: saleDeviceId, openedBy: actorId, openingFloat: 0,
  });
  const returnShift = await openPosShift({
    tenantId, deviceId: returnDeviceId, openedBy: actorId, openingFloat: 1000,
  });
  assert.ok(saleShift.status === "OPENED" || saleShift.status === "ALREADY_OPEN");
  assert.ok(returnShift.status === "OPENED" || returnShift.status === "ALREADY_OPEN");
  if (saleShift.status === "OPENED" || saleShift.status === "ALREADY_OPEN") saleShiftId = saleShift.shift.id;
  if (returnShift.status === "OPENED" || returnShift.status === "ALREADY_OPEN") returnShiftId = returnShift.shift.id;
});

test("sell at branch A and find the bill from branch B", async () => {
  const sold = await recordPosSale({
    tenantId,
    deviceId: saleDeviceId,
    shiftId: saleShiftId,
    cashierUserId: actorId,
    idempotencyKey: key("sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "CASH", amount: 100, cashTendered: 100 }],
  } as any);
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;
  orderId = sold.orderId;

  const found = await listRecentPosSales(tenantId, returnDeviceId, 20, {
    query: orderId.slice(0, 8), locationId: returnLocationId,
  });
  const bill = found.find((row) => row.orderId === orderId);
  assert.ok(bill, "another branch must find the completed bill by short order id");
  assert.equal(bill?.sourceChannel, "pos");
  assert.equal(bill?.saleLocationId, saleLocationId);
  assert.equal(bill?.returnEligible, true);
});

test("cross-branch return needs a distinct approver and restores only branch B", async () => {
  const refused = await returnPosSale({
    tenantId, deviceId: returnDeviceId, shiftId: returnShiftId, orderId,
    actorUserId: actorId, approvedByUserId: actorId,
    note: "[CUSTOMER_CHANGE] cross-branch contract",
    idempotencyKey: key("return-refused"),
  });
  assert.equal(refused.status, "CROSS_BRANCH_APPROVAL_REQUIRED");

  const returned = await returnPosSale({
    tenantId, deviceId: returnDeviceId, shiftId: returnShiftId, orderId,
    actorUserId: actorId, approvedByUserId: approverId,
    note: "[CUSTOMER_CHANGE] cross-branch contract",
    idempotencyKey: key("return"),
  });
  assert.equal(returned.status, "RETURNED", JSON.stringify(returned));
  if (returned.status !== "RETURNED") return;
  assert.equal(returned.crossBranch, true);
  assert.equal(returned.saleLocationId, saleLocationId);
  assert.equal(returned.returnLocationId, returnLocationId);

  const stock = await query<{ location_id: string; current_stock: number }>(
    `SELECT location_id, current_stock FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
    [tenantId, SKU, SIZE]
  );
  const byLocation = new Map(stock.rows.map((row) => [row.location_id, Number(row.current_stock)]));
  assert.equal(byLocation.get(saleLocationId), 9, "sale branch remains reduced after return elsewhere");
  assert.equal(byLocation.get(returnLocationId), 1, "receiving branch owns the returned unit");

  const lot = await query<{ source_location: string; restock_location: string; qty: number }>(
    `SELECT source.location_id AS source_location,
            restock.location_id AS restock_location,
            link.qty
       FROM bms_pos_return_item_lots link
       JOIN bms_inventory_lots source ON source.id = link.lot_id
       JOIN bms_inventory_lots restock ON restock.id = link.restock_lot_id
       JOIN bms_pos_return_items item ON item.id = link.pos_return_item_id
      WHERE item.pos_return_id = $1`,
    [returned.posReturnId]
  );
  assert.equal(lot.rows[0]?.source_location, saleLocationId);
  assert.equal(lot.rows[0]?.restock_location, returnLocationId);
  assert.equal(Number(lot.rows[0]?.qty), 1);

  const movement = await query<{ location_id: string; qty: number }>(
    `SELECT location_id, qty FROM bms_stock_movements
      WHERE tenant_id = $1 AND ref_order_id = $2 AND type = 'RETURN'`,
    [tenantId, orderId]
  );
  assert.equal(movement.rows[0]?.location_id, returnLocationId);
  assert.equal(Number(movement.rows[0]?.qty), 1);

  const replay = await returnPosSale({
    tenantId, deviceId: returnDeviceId, shiftId: returnShiftId, orderId,
    actorUserId: actorId, approvedByUserId: approverId,
    note: "[CUSTOMER_CHANGE] cross-branch contract",
    idempotencyKey: key("return"),
  });
  assert.equal(replay.status, "RETURNED");
  assert.equal(replay.status === "RETURNED" ? replay.replayed : false, true);

  const report = await getPosReturnSummary(tenantId);
  const reportRow = report.recent.find((row: any) => row.id === returned.posReturnId);
  assert.equal(reportRow?.crossBranch, true);
  assert.equal(reportRow?.saleLocationName != null, true);
  assert.equal(reportRow?.returnLocationName != null, true);
});

test("teardown cross-branch fixtures", async () => {
  for (const [shiftId, deviceId] of [[saleShiftId, saleDeviceId], [returnShiftId, returnDeviceId]]) {
    const report = shiftId ? await getPosShiftReport(tenantId, shiftId, deviceId) : null;
    if (report?.status === "OPEN") {
      await closePosShift({
        tenantId, shiftId, closedBy: actorId,
        countedCash: Number(report.expectedCash ?? 0), note: `${TAG} cleanup`,
      });
    }
  }
  if (orderId) {
    const returns = await query<{ id: string }>(
      `SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = $2`, [tenantId, orderId]
    );
    const returnIds = returns.rows.map((row) => row.id);
    if (returnIds.length) {
      await query(`DELETE FROM bms_pos_refund_allocations WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`, [tenantId, returnIds]);
      await query(`DELETE FROM bms_pos_return_items WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`, [tenantId, returnIds]);
      await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, returnIds]);
    }
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = $2`, [tenantId, orderId]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, orderId]);
  }
  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND device_id = ANY($2::uuid[])`, [tenantId, [saleDeviceId, returnDeviceId]]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = ANY($2::uuid[])`, [tenantId, [saleDeviceId, returnDeviceId]]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [saleDeviceId, returnDeviceId]]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2 AND fake_test = TRUE`, [tenantId, approverId]);
  await query(`DELETE FROM bms_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, returnLocationId]);
});
