// =============================================================
// รายงานสินค้าและวัตถุดิบ — DB contract (เขียนจริงลงฐาน ห้ามรันกับ production)
// -------------------------------------------------------------
// ตัวเลขคำนวณมือ (สินค้า A สาขาหลัก ต้นทุน 30):
//   สต็อกเดิมก่อนมี ledger 5 (ไม่มี movement)         → ยอดยกมาที่ไม่มีหลักฐาน 5
//   40 วันก่อน รับจาก PO 10                          → ยอดยกมาจาก ledger 10
//   ในงวด: ซื้อ 20 · ขาย 7 · ลูกค้าคืน 2 · ของเสีย 1 · โอนออก 3 · ปรับลด 1
//          จอง 4 และโอนหาย 3 (ต้องไม่ถูกนับ) · นับได้ 22 จากระบบ 25 (นับลด 3)
//   ยอดยกมา 15 · รับ 22 · จ่าย 15 · คงเหลือ 22 = current_stock · มูลค่า 660
//
//   node scripts/run-contract-tests.mjs db stock-ledger
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { recordMovement } from "../apps/web/lib/bms/movements.ts";
import { applyStockCount, createStockCount, recordCountItem } from "../apps/web/lib/bms/stockCounts.ts";
import { getStockLedger } from "../apps/web/lib/bms/stockLedger.ts";
import { buildStockLedgerReportDoc, buildXlsx } from "../apps/web/lib/bms/documentGenerator.ts";
import { taxClockOf } from "../apps/web/lib/bms/taxDocumentNumber.ts";

const TAG = "stockledger-test";
const SKU_A = `FAKE-${TAG}-A`;
const SKU_B = `FAKE-${TAG}-B`;
const SKU_MENU = `FAKE-${TAG}-MENU`;
const SIZE = "M";

let tenantId = "";
let userId = "";
let mainId = "";
let branchId = "";

const daysAgo = (n: number) => taxClockOf(new Date(Date.now() - n * 86_400_000)).isoDate;
const today = taxClockOf(new Date()).isoDate;

async function move(
  locationId: string, sku: string, type: string, qty: number, opts: { note?: string; ageDays?: number } = {}
) {
  await query(
    `INSERT INTO bms_stock_movements (tenant_id, location_id, product_sku, size, type, qty, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8))`,
    [tenantId, locationId, sku, SIZE, type, qty, opts.note ?? null, opts.ageDays ?? 0]
  );
}

test("setup: two establishments with a mixed movement history", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${process.pid}`]
  )).rows[0].id;
  userId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT 'FAKE staff', $2, $2, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1 RETURNING id`,
    [tenantId, `fake-${TAG}-${process.pid}@example.invalid`]
  )).rows[0].id;
  mainId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'MAIN','FAKE HQ','00000',TRUE,TRUE) RETURNING id`, [tenantId]
  )).rows[0].id;
  branchId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,'BR1','FAKE branch','00001',FALSE,TRUE) RETURNING id`, [tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, cost_price, active) VALUES
       ($1,$2,'สินค้า A',50,30,TRUE), ($1,$3,'สินค้า B',50,NULL,TRUE), ($1,$4,'เมนูสูตร',80,NULL,TRUE)`,
    [tenantId, SKU_A, SKU_B, SKU_MENU]
  );

  // สินค้า A สาขาหลัก — current_stock สุดท้ายก่อนนับ = 5 + 10 + 20 − 7 + 2 − 1 − 3 − 1 = 25
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock) VALUES
       ($1,$2,$3,$4,25,0), ($1,$5,$3,$4,3,0), ($1,$5,$6,$4,4,0), ($1,$2,$7,$4,0,0)`,
    [tenantId, mainId, SKU_A, SIZE, branchId, SKU_B, SKU_MENU]
  );
  await move(mainId, SKU_A, "STOCK_IN", 10, { note: "PO:old00000", ageDays: 40 });
  await move(mainId, SKU_A, "STOCK_IN", 20, { note: "PO:new00000" });
  await move(mainId, SKU_A, "SHIP", 7);
  await move(mainId, SKU_A, "RETURN", 2);
  await move(mainId, SKU_A, "WASTAGE", 1);
  await move(mainId, SKU_A, "TRANSFER_OUT", 3);
  await move(mainId, SKU_A, "STOCK_OUT", 1, { note: "ปรับยอดมือ" });
  await move(mainId, SKU_A, "RESERVE", 4);
  await move(mainId, SKU_A, "TRANSFER_LOST", 3);
  await move(branchId, SKU_A, "TRANSFER_IN", 3);

  // การนับจริงผ่านเส้นทางของระบบ — ต้องบันทึกทิศทาง
  const count = await createStockCount({ tenantId, locationId: mainId, createdBy: userId });
  assert.equal(count.status, "CREATED", JSON.stringify(count));
  if (count.status !== "CREATED") return;
  const item = await recordCountItem({ tenantId, countId: count.countId, sku: SKU_A, size: SIZE, countedQty: 22, actorUserId: userId });
  assert.equal(item.status, "OK", JSON.stringify(item));
  const applied = await applyStockCount({ tenantId, countId: count.countId, actorUserId: userId });
  assert.equal(applied.status, "APPLIED", JSON.stringify(applied));
});

test("a stock count records its direction", async () => {
  const r = await query<{ qty: number; direction: string | null }>(
    `SELECT qty, direction FROM bms_stock_movements WHERE tenant_id = $1 AND type = 'COUNT_ADJUST'`, [tenantId]
  );
  assert.deepEqual(r.rows, [{ qty: 3, direction: "OUT" }]);
});

test("a COUNT_ADJUST without a direction is refused by the writer and by the database", async () => {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await assert.rejects(
      recordMovement(client, { tenantId, locationId: mainId, sku: SKU_A, size: SIZE, type: "COUNT_ADJUST", qty: 1 }),
      /ต้องระบุทิศทาง/
    );
    await assert.rejects(
      recordMovement(client, { tenantId, locationId: mainId, sku: SKU_A, size: SIZE, type: "SHIP", qty: 1, direction: "OUT" }),
      /ห้ามระบุ direction/
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  await assert.rejects(
    query(
      `INSERT INTO bms_stock_movements (tenant_id, location_id, product_sku, size, type, qty)
       VALUES ($1,$2,$3,$4,'COUNT_ADJUST',1)`,
      [tenantId, mainId, SKU_A, SIZE]
    ),
    /bms_stock_movements_count_direction_required/
  );
});

test("the period shows opening, every kind of in/out, and a closing equal to stock on hand", async () => {
  const r = await getStockLedger(tenantId, { from: daysAgo(10), to: today });
  const a = r.rows.find((x) => x.locationId === mainId && x.sku === SKU_A)!;
  assert.ok(a);
  assert.equal(a.openingRecorded, 10);
  assert.equal(a.openingUnrecorded, 5, "stock that predates the ledger is shown, not hidden");
  assert.equal(a.opening, 15);
  assert.equal(a.purchased, 20);
  assert.equal(a.returned, 2);
  assert.equal(a.totalIn, 22);
  assert.equal(a.sold, 7);
  assert.equal(a.wasted, 1);
  assert.equal(a.transferredOut, 3);
  assert.equal(a.adjustedOut, 1);
  assert.equal(a.countedDown, 3);
  assert.equal(a.totalOut, 15, "reservations and lost transfers are not stock leaving");
  assert.equal(a.closing, 22);
  const onHand = await query<{ current_stock: number }>(
    `SELECT current_stock FROM bms_inventory WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3`,
    [tenantId, mainId, SKU_A]
  );
  assert.equal(a.closing, onHand.rows[0].current_stock);
  assert.equal(a.closingValue, 660);
});

test("each establishment keeps its own rows", async () => {
  const r = await getStockLedger(tenantId, { from: daysAgo(10), to: today });
  const branchA = r.rows.find((x) => x.locationId === branchId && x.sku === SKU_A)!;
  assert.equal(branchA.transferredIn, 3);
  assert.equal(branchA.closing, 3);
  // เมนูสูตรที่สต็อกของตัวเองเป็น 0 ตามดีไซน์ไม่ต้องขึ้นเป็นแถวว่าง
  assert.ok(!r.rows.some((x) => x.sku === SKU_MENU));
  // สินค้าที่ไม่มีต้นทุนทำให้มูลค่ารวมคำนวณไม่ได้ — ห้ามคิดเป็น 0
  assert.equal(r.missingCostCount, 1);
  assert.equal(r.totalClosingValue, null);

  const onlyBranch = await getStockLedger(tenantId, { from: daysAgo(10), to: today, locationId: branchId });
  assert.ok(onlyBranch.rows.every((x) => x.locationId === branchId));
});

test("a past period closes at what was on hand then, not today", async () => {
  const r = await getStockLedger(tenantId, { from: daysAgo(45), to: daysAgo(20) });
  const a = r.rows.find((x) => x.locationId === mainId && x.sku === SKU_A)!;
  assert.equal(a.opening, 5);
  assert.equal(a.purchased, 10);
  assert.equal(a.totalOut, 0);
  assert.equal(a.closing, 15);
});

test("the XLSX export is numeric and Thai-labelled", async () => {
  const r = await getStockLedger(tenantId, { from: daysAgo(10), to: today });
  const wb = XLSX.read(buildXlsx(buildStockLedgerReportDoc(r, (d) => d)), { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Summary", "สินค้าและวัตถุดิบ"]);
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets["สินค้าและวัตถุดิบ"]);
  const a = rows.find((x) => x["รหัสสินค้า"] === SKU_A && x["สถานประกอบการ"].startsWith("สำนักงานใหญ่"));
  assert.equal(a["คงเหลือ"], 22);
  assert.equal(a["ในยอดยกมา: ไม่มีหลักฐาน"], 5);
});

test("teardown", async () => {
  if (!tenantId) return;
  for (const t of [
    "bms_stock_count_items", "bms_stock_counts", "bms_inventory_operation_idempotency", "bms_stock_movements",
    "bms_inventory", "bms_products", "bms_audit_log", "bms_locations",
  ]) {
    await query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  }
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
  const left = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]);
  assert.equal(left.rows[0].n, 0);
});
