// =============================================================
// เงินสดของกะ: สูตรเดียวกันทุกที่ — DB contract (เขียนจริงลงฐาน ห้ามรันกับ production)
// -------------------------------------------------------------
// ⚠️ เคสที่ตรึงไว้: **การคืนเงินสดที่จ่ายออกจากลิ้นชักในกะอื่น**
//
// การตัดรายการของออร์เดอร์ออนไลน์ (9.57) สร้าง refund allocation เป็น `PENDING` เสมอ
// **แม้วิธีจ่ายจะเป็นเงินสด** (`allocationCompleted = onlineCancellation ? false : …`)
// แล้วมีคนมากดยืนยันจ่ายที่เครื่องทีหลัง — `completed_shift_id` คือกะที่เงินออกจริง ส่วน
// `pr.shift_id` เป็น NULL (ใบคืนไม่มีเครื่อง) และ `o.pos_shift_id` ก็ NULL (บิลออนไลน์)
//
// ก่อนแก้: `drawerExpectedInTx()`/`closePosShift()` คีย์ด้วย `COALESCE(pr.shift_id,
// o.pos_shift_id)` จึงมองไม่เห็นเงินก้อนนี้เลย ขณะที่สรุปกะ X/Z และหน้าภาพรวมกะใช้
// `completed_shift_id` → เงินออกจากลิ้นชักจริงแต่ "เงินที่ควรมี" ไม่ลด → ปิดกะแล้วเงินขาด
// เท่ายอดคืนโดยไม่มีอะไรอธิบาย และแผ่น "ตรวจสอบยอด" ในไฟล์ export บวกลงมาไม่เท่ายอดรวม
//
// ชุดนี้สร้างร้านทดสอบของตัวเองแล้วลบทิ้ง (รันซ้ำได้)
//
//   cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
//     POSTGRES_PASSWORD=app npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit ../../scripts/pos-cash-formula-db-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import {
  closePosShift,
  completePosRefundAllocation,
  drawerExpectedInTx,
  getPosShiftExportData,
  getPosShiftReport,
  issuePosDeviceToken,
  openPosShift,
  recordPosSale,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "pos-cashformula-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let onlineOrderId = "";
let allocationId = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;

test("setup: a throwaway shop with a register and an open shift", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, cash_rounding, pos_blind_close)
     VALUES ($1,'NONE',FALSE)`,
    [tenantId]
  );
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, active)
     VALUES ($1,'MAIN',$2,$3,TRUE) RETURNING id`,
    [tenantId, `FAKE ${TAG} main`, String(90000 + (process.pid % 9000))]
  )).rows[0].id;
  cashierId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} cashier`, `fake-${TAG}-${process.pid}@example.invalid`]
  )).rows[0].id;

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$2,100,TRUE,'V')`,
    [tenantId, SKU]
  );
  // 9.51: สินค้าที่ไม่ประกาศช่องทางขายเป็นฉบับร่าง ขายที่เคาน์เตอร์ไม่ได้
  for (const surface of ["RETAIL_POS", "ONLINE_ORDER"]) {
    await query(
      `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tenantId, SKU, surface]
    );
  }
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,1000,0)`,
    [tenantId, locationId, SKU, SIZE]
  );

  deviceId = (await upsertPosDevice(tenantId, {
    locationId, code: `${TAG}-REG`, name: `FAKE ${TAG} register`, active: true,
  })).id;
  await issuePosDeviceToken(tenantId, deviceId);

  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 1000 });
  assert.ok(opened.status === "OPENED", JSON.stringify(opened));
  if (opened.status === "OPENED") shiftId = opened.shift.id;
});

/**
 * ใบคืนที่ "ไม่มีเครื่อง" พร้อม allocation เงินสดที่ยังไม่จ่าย
 *
 * สร้างรูปทรงแถวตรง ๆ แทนการเดินเส้นทางร้านอาหารออนไลน์ทั้งเส้น (ต้องมี archetype
 * restaurant + ออร์เดอร์เดลิเวอรี + ผังโต๊ะ) เพราะสิ่งที่ชุดนี้ตรึงคือ **สิ่งที่เกิดกับลิ้นชัก
 * หลังจากมีแถวหน้าตาแบบนี้แล้ว** ไม่ใช่ตัวเส้นทางที่สร้างมัน · ตัวที่ถูกทดสอบจริงคือ
 * `completePosRefundAllocation()` และสูตรเงินสดของกะ ซึ่งเป็นโค้ดจริงทั้งคู่
 */
test("an online cash refund is paid out from this register's drawer", async () => {
  onlineOrderId = (await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, channel, customer_ref, status, total_amount,
                             location_id, fulfillment_type)
     VALUES ($1,'web',$2,'COMPLETED',250,$3,'DELIVERY') RETURNING id`,
    [tenantId, `fake-${TAG}-customer`, locationId]
  )).rows[0].id;
  const paymentId = (await query<{ id: string }>(
    `INSERT INTO bms_payments (tenant_id, order_id, method, amount, status, confirmed_at)
     VALUES ($1,$2,'CASH',250,'CONFIRMED',now()) RETURNING id`,
    [tenantId, onlineOrderId]
  )).rows[0].id;
  const posReturnId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_returns
       (tenant_id, order_id, pos_device_id, shift_id, returned_by, return_mode,
        refund_amount, settlement_status, idempotency_key, is_void)
     VALUES ($1,$2,NULL,NULL,$3,'PARTIAL',250,'PENDING',$4,FALSE) RETURNING id`,
    [tenantId, onlineOrderId, cashierId, key("online-return")]
  )).rows[0].id;
  allocationId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_refund_allocations
       (tenant_id, pos_return_id, payment_id, method, amount, status)
     VALUES ($1,$2,$3,'CASH',250,'PENDING') RETURNING id`,
    [tenantId, posReturnId, paymentId]
  )).rows[0].id;

  const settled = await completePosRefundAllocation({
    tenantId, deviceId, locationId, shiftId, allocationId,
    actorUserId: cashierId, externalRef: "FAKE-ONLINE-REFUND-REF",
  });
  assert.equal(settled.status, "COMPLETED", JSON.stringify(settled));
  assert.equal((await query<{ completed_shift_id: string | null }>(
    `SELECT completed_shift_id FROM bms_pos_refund_allocations WHERE id = $1`, [allocationId]
  )).rows[0].completed_shift_id, shiftId, "เงินออกจากลิ้นชักของกะนี้ ไม่ใช่กะของบิลเดิม");
});

test("⚠️ เงินสดที่จ่ายคืนออกไปจริงต้องหายจาก 'เงินที่ควรมี' ไม่ใช่โผล่แค่ในรายงาน", async () => {
  // ขายเงินสดหนึ่งบิลเพื่อให้มีเงินเข้าลิ้นชักด้วย ไม่ใช่มีแต่ขาออก
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId, idempotencyKey: key("cash-sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "CASH", amount: 100, cashTendered: 100 }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));

  const report = await getPosShiftReport(tenantId, shiftId, deviceId);
  assert.ok(report);
  assert.equal(report!.cashRefunds, 250, "สรุปกะเห็นเงินที่จ่ายคืนออกไปแล้ว");

  const client = await getClient();
  let drawer = 0;
  try {
    await beginTenantTx(client, tenantId);
    drawer = await drawerExpectedInTx(client, tenantId, shiftId, 1000);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.equal(drawer, report!.expectedCash,
    "สูตรที่ตัดสินว่าจ่ายเงินคืนได้ไหม กับตัวเลขที่รายงานบอก ต้องเป็นเลขเดียวกัน");
  assert.equal(drawer, 1000 + 100 - 250, "เงินตั้งต้น + ขายเงินสด − คืนเงินสดที่จ่ายจริง");
});

test("แผ่นตรวจสอบยอดในไฟล์รายละเอียดกะต้องมีแถวของเงินที่จ่ายออกจริง", async () => {
  const data = await getPosShiftExportData(tenantId, shiftId, deviceId);
  assert.ok(data);
  const row = data!.refunds.find((r: any) => r.allocationId === allocationId);
  assert.ok(row, "ใบคืนที่จ่ายเงินในกะนี้ต้องอยู่ในรายละเอียดของกะนี้");

  // ยอดรวมบนแผ่นต้องบวกลงตัวกับรายการที่พิมพ์อยู่ใต้มัน
  const r = data!.report;
  const cashSales = r.byMethod.find((m) => m.method === "CASH")?.amount ?? 0;
  assert.equal(
    Math.round((r.openingFloat + cashSales + r.cashIn - r.cashRefunds - r.cashOut) * 100) / 100,
    r.expectedCash,
    "แผ่น 'ตรวจสอบยอด' ต้องบวกลงมาแล้วได้ยอดรวมที่พิมพ์ไว้"
  );
});

test("ปิดกะได้เลขเดียวกับที่จอบอกระหว่างกะ", async () => {
  const report = await getPosShiftReport(tenantId, shiftId, deviceId);
  const expected = report!.expectedCash!;
  const closed = await closePosShift({
    tenantId, shiftId, closedBy: cashierId, countedCash: expected, note: `${TAG} close`,
  });
  assert.equal(closed.status, "CLOSED", JSON.stringify(closed));
  if (closed.status !== "CLOSED") return;
  assert.equal(closed.shift.expectedCash, expected,
    "ปิดกะต้องใช้สูตรเดียวกับที่จอบอก ไม่งั้นแคชเชียร์นับตรงแล้วยังขึ้นว่าเงินขาด");
  assert.equal(closed.shift.cashVariance, 0, "นับได้ตามที่จอบอก ส่วนต่างต้องเป็น 0");
  assert.equal(closed.cashOut, 0);
});

test("teardown: drop the throwaway tenant and everything under it", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (!ids.length) return;
  for (const table of [
    "bms_pos_refund_allocations",
    "bms_pos_returns",
    "bms_payments",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_order_items",
    "bms_order_discounts",
    "bms_orders",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
    "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    0,
    "ร้านทดสอบต้องไม่เหลือค้างในฐาน"
  );
});
