// =============================================================
// Serial numbers / IMEI per unit (8.3)
// -------------------------------------------------------------
// Lots (7.85) answer "which batch did this come from". Serials answer "who bought
// THIS unit, and when" — the question that gets asked when someone walks in with
// a warranty claim and no receipt.
//
// The controls that matter here are about wrong answers rather than missing ones:
// selling a serial that is already sold points the warranty history at the
// previous customer, and that mistake only surfaces at the claim.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/pos-serial-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";
import {
  findSerial,
  issuePosDeviceToken,
  listSerialsForOrder,
  openPosShift,
  recordPosSale,
  resolvePosScan,
  returnPosSale,
  setCashierPin,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "serial-test";
const SKU = `FAKE-${TAG}-PHONE`;
const PLAIN = `FAKE-${TAG}-CASE`;
const SIZE = "M";
const PIN = "8264";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let soldOrderId = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;

test("setup: one serial-tracked product and one ordinary one", async () => {
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

  for (const [sku, tracked] of [[SKU, true], [PLAIN, false]] as Array<[string, boolean]>) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category, serial_tracked)
       VALUES ($1,$2,$3,1000,TRUE,'V',$4)
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET price = 1000, active = TRUE, serial_tracked = EXCLUDED.serial_tracked`,
      [tenantId, sku, `FAKE ${TAG} ${sku}`, tracked]
    );
    // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
    await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,50,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 50, reserved_stock = 0`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  await query(
    `INSERT INTO bms_product_packs
       (tenant_id, product_sku, size, pack_code, unit_name, base_qty, price, active)
     VALUES ($1,$2,$3,'BOX10','กล่อง',10,10000,TRUE)
     ON CONFLICT (tenant_id, product_sku, size, pack_code) WHERE size IS NOT NULL DO UPDATE
       SET base_qty = 10, price = 10000, active = TRUE`,
    [tenantId, SKU, SIZE]
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
  await setCashierPin(tenantId, cashierId, PIN);
  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 5000 });
  if (opened.status === "OPENED" || opened.status === "ALREADY_OPEN") shiftId = opened.shift.id;
});

test("the scan tells the screen it must collect serials", async () => {
  const tracked = await resolvePosScan(tenantId, SKU, { size: SIZE, locationId });
  assert.equal(tracked?.serialTracked, true);
  const plain = await resolvePosScan(tenantId, PLAIN, { size: SIZE, locationId });
  assert.equal(plain?.serialTracked, false, "สินค้าปกติต้องไม่ถูกบังคับ");
});

test("selling without enough serials is refused before any stock moves", async () => {
  const before = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );

  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("short"),
    lines: [{ sku: SKU, size: SIZE, packQty: 2, serials: ["IMEI-A"] }],
    payments: [{ method: "CASH", amount: 2000, cashTendered: 2000 }],
  } as any);
  assert.equal(res.status, "SERIAL_REQUIRED");
  if (res.status === "SERIAL_REQUIRED") {
    assert.equal(res.expected, 2);
    assert.equal(res.received, 1);
  }

  const after = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  assert.equal(Number(after.rows[0].n), Number(before.rows[0].n),
    "ตรวจก่อนตัดสต็อก — ไม่งั้นต้องย้อนคืนทุกอย่างซึ่งพลาดง่ายกว่า");
});

test("the same serial twice on one line is refused", async () => {
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("dup"),
    lines: [{ sku: SKU, size: SIZE, packQty: 2, serials: ["IMEI-SAME", "IMEI-SAME"] }],
    payments: [{ method: "CASH", amount: 2000, cashTendered: 2000 }],
  } as any);
  assert.equal(res.status, "SERIAL_REQUIRED", "ยิงกล่องเดิมสองครั้งต้องไม่ผ่าน");
});

test("the same serial across two lines is refused", async () => {
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("dup-across-lines"),
    lines: [
      { sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-CROSS"] },
      { sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-CROSS"] },
    ],
    payments: [{ method: "CASH", amount: 2000, cashTendered: 2000 }],
  } as any);
  assert.equal(res.status, "SERIAL_REQUIRED");
});

test("pack serial quantity comes from the database, not browser baseQty", async () => {
  const short = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("pack-short"),
    lines: [{ sku: SKU, size: SIZE, packCode: "BOX10", packQty: 1, baseQty: 1, serials: ["PACK-01"] }],
    payments: [{ method: "CASH", amount: 10000, cashTendered: 10000 }],
  } as any);
  assert.equal(short.status, "SERIAL_REQUIRED");
  if (short.status === "SERIAL_REQUIRED") assert.equal(short.expected, 10);

  const serials = Array.from({ length: 10 }, (_, index) => `PACK-${String(index + 1).padStart(2, "0")}`);
  const sold = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("pack-ok"),
    lines: [{ sku: SKU, size: SIZE, packCode: "BOX10", packQty: 1, serials }],
    payments: [{ method: "CASH", amount: 10000, cashTendered: 10000 }],
  } as any);
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status === "SOLD") assert.equal((await listSerialsForOrder(tenantId, sold.orderId)).length, 10);
});

test("a completed sale records every serial against the bill", async () => {
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("ok"),
    lines: [{ sku: SKU, size: SIZE, packQty: 2, serials: ["IMEI-001", "IMEI-002"] }],
    payments: [{ method: "CASH", amount: 2000, cashTendered: 2000 }],
  } as any);
  assert.equal(res.status, "SOLD", JSON.stringify(res));
  if (res.status !== "SOLD") return;
  soldOrderId = res.orderId;

  const serials = await listSerialsForOrder(tenantId, soldOrderId);
  assert.equal(serials.length, 2);
  assert.deepEqual(serials.map((x) => x.serial).sort(), ["IMEI-001", "IMEI-002"]);
  assert.ok(serials.every((x) => x.status === "SOLD"));
});

test("looking up a serial answers who bought it and when", async () => {
  const hit = await findSerial(tenantId, "IMEI-001");
  assert.ok(hit, "เลขที่ขายไปแล้วต้องค้นเจอ");
  assert.equal(hit!.sku, SKU);
  assert.equal(hit!.status, "SOLD");
  assert.equal(hit!.orderId, soldOrderId);
  assert.ok(hit!.soldAt, "ต้องรู้ว่าขายวันไหน — เป็นข้อมูลที่ใช้นับประกัน");

  assert.equal(await findSerial(tenantId, "IMEI-NEVER-EXISTED"), null);
});

test("selling a serial that is already sold is refused", async () => {
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("resell"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-001"] }],
    payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }],
  } as any);
  assert.equal(res.status, "SERIAL_ALREADY_SOLD");
  if (res.status === "SERIAL_ALREADY_SOLD") assert.equal(res.serial, "IMEI-001");
});

test("two simultaneous bills cannot both claim the same serial", async () => {
  const results = await Promise.all([
    recordPosSale({
      tenantId, deviceId, shiftId, cashierUserId: cashierId,
      idempotencyKey: key("race-a"),
      lines: [{ sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-RACE"] }],
      payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }],
    } as any),
    recordPosSale({
      tenantId, deviceId, shiftId, cashierUserId: cashierId,
      idempotencyKey: key("race-b"),
      lines: [{ sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-RACE"] }],
      payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }],
    } as any),
  ]);
  assert.equal(results.filter((result) => result.status === "SOLD").length, 1);
  assert.equal(results.filter((result) => result.status === "SERIAL_ALREADY_SOLD").length, 1);
});

test("returning the whole bill frees its serials to be sold again", async () => {
  const ret = await returnPosSale({
    tenantId, deviceId, shiftId, orderId: soldOrderId, actorUserId: cashierId,
    approvedByUserId: cashierId, note: "ลูกค้าเปลี่ยนใจ",
    idempotencyKey: key("return"),
  });
  assert.equal(ret.status, "RETURNED", JSON.stringify(ret));

  const hit = await findSerial(tenantId, "IMEI-001");
  assert.equal(hit!.status, "RETURNED");
  assert.ok(hit!.returnedAt);

  // เครื่องที่คืนมาแล้วขายใหม่ได้ (สินค้าเปลี่ยนคืน/มือสองเป็นเรื่องปกติ)
  const again = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("resell-after-return"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1, serials: ["IMEI-001"] }],
    payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }],
  } as any);
  assert.equal(again.status, "SOLD", JSON.stringify(again));
  const back = await findSerial(tenantId, "IMEI-001");
  assert.equal(back!.status, "SOLD");
  assert.equal(back!.returnedAt, null, "ขายใหม่แล้วต้องล้างวันคืนทิ้ง");
});

test("teardown: remove every row this suite created", async () => {
  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND pos_device_id = $2`, [tenantId, deviceId]
  );
  const ids = orders.rows.map((r) => r.id);
  await query(`DELETE FROM bms_product_serials WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, PLAIN]]);
  if (ids.length) {
    const rets = await query<{ id: string }>(
      `SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]
    );
    if (rets.rowCount) {
      await query(`DELETE FROM bms_pos_refund_allocations WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, rets.rows.map((r) => r.id)]);
      await query(`DELETE FROM bms_pos_return_items WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, rets.rows.map((r) => r.id)]);
    }
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, PLAIN]]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, PLAIN]]);
  await query(`DELETE FROM bms_product_packs WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, PLAIN]]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`, [tenantId, [SKU, PLAIN]]);
});
