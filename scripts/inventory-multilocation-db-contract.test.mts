// =============================================================
// Multi-location stock: adjust, transfer, count (7.98)
// -------------------------------------------------------------
// 7.84 gave every inventory row a location_id, but nothing could act on more
// than the default one: adjustStock resolved the default location and ignored
// the rest, and there was no way to move goods between branches or reconcile a
// shelf against the system. This suite drives all three against real Postgres.
//
// The two behaviours worth stating outright, because both are easy to get
// wrong and neither is visible from the type signatures:
//
//   - a transfer is two steps; goods in transit belong to NO branch, which is
//     what makes a count at the source branch correct while the van is moving
//   - a count applies the DIFFERENCE against its snapshot, never the counted
//     number as an absolute, so sales that happen mid-count survive
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/inventory-multilocation-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { adjustStock, listVariants, setReorderPoint } from "../apps/web/lib/bms/products.ts";
import {
  cancelStockTransfer,
  createStockTransfer,
  listStockTransfers,
  receiveStockTransfer,
  sendStockTransfer,
} from "../apps/web/lib/bms/stockTransfers.ts";
import {
  applyStockCount,
  createStockCount,
  listStockCounts,
  recordCountItem,
} from "../apps/web/lib/bms/stockCounts.ts";

const TAG = "inv-multiloc-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let mainLocation = "";
let branchLocation = "";
let actorId = "";

const stockAt = async (locationId: string): Promise<number> => {
  const res = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  return res.rowCount ? Number(res.rows[0].n) : 0;
};

test("setup: two branches, one product, stock only at the main branch", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  actorId = (await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name = 'Administrator' ORDER BY u.created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  mainLocation = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  // สาขาที่สองของเทสเอง — ร้านจริงอาจมีสาขาเดียว
  const branch = await query<{ id: string }>(
    // branch_code ต้องตั้งเอง — default คือ '00000' (สำนักงานใหญ่) ซึ่งมี unique
    // index (tenant_id, branch_code) คุมอยู่ ปล่อย default = ชนกับสาขาหลักทันที
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, active, is_head_office)
     VALUES ($1, $2, $3, $4, TRUE, FALSE)
     ON CONFLICT (tenant_id, code) DO UPDATE SET active = TRUE
     RETURNING id`,
    [tenantId, `${TAG}-BR`, `FAKE ${TAG} branch`, "90001"]
  );
  branchLocation = branch.rows[0].id;

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 100, reserved_stock = 0`,
    [tenantId, mainLocation, SKU, SIZE]
  );
  await query(
    `DELETE FROM bms_inventory WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3`,
    [tenantId, branchLocation, SKU]
  );
});

// ---- ข้อ 10: adjustStock ต้องเลือกสาขาได้ ------------------------------

test("adjustStock hits the branch it is told to, not always the default", async () => {
  await adjustStock(tenantId, SKU, SIZE, 25, `${TAG} รับเข้าสาขา`, "test", actorId, branchLocation);
  assert.equal(await stockAt(branchLocation), 25);
  assert.equal(await stockAt(mainLocation), 100, "สาขาหลักต้องไม่ถูกแตะ");

  // ไม่ระบุสาขา = สาขาเริ่มต้น (พฤติกรรมเดิมก่อน 7.98 ต้องไม่เปลี่ยน)
  await adjustStock(tenantId, SKU, SIZE, 5, `${TAG} รับเข้าสาขาหลัก`, "test", actorId);
  assert.equal(await stockAt(mainLocation), 105);
  assert.equal(await stockAt(branchLocation), 25);
});

test("branch variants stay separate and reorder targets the named branch", async () => {
  const variants = await listVariants(tenantId, SKU);
  const main = variants.find((row) => row.location_id === mainLocation && row.size === SIZE);
  const branch = variants.find((row) => row.location_id === branchLocation && row.size === SIZE);
  assert.equal(main?.current_stock, 105);
  assert.equal(branch?.current_stock, 25);
  assert.notEqual(main?.location_name, branch?.location_name);

  await setReorderPoint(tenantId, SKU, SIZE, 7, actorId, branchLocation);
  const after = await listVariants(tenantId, SKU);
  assert.equal(after.find((row) => row.location_id === branchLocation)?.reorder_point, 7);
  assert.notEqual(after.find((row) => row.location_id === mainLocation)?.reorder_point, 7);
});

test("adjustStock refuses a location that belongs to another shop", async () => {
  await assert.rejects(
    () => adjustStock(tenantId, SKU, SIZE, 1, null, "test", actorId,
      "00000000-0000-0000-0000-000000000000"),
    /ไม่พบสาขานี้/
  );
});

// ---- ข้อ 11a: โอนย้ายระหว่างสาขา ---------------------------------------

test("goods in transit belong to no branch until they are received", async () => {
  const created = await createStockTransfer({
    tenantId, fromLocationId: mainLocation, toLocationId: branchLocation,
    items: [{ sku: SKU, size: SIZE, qty: 30 }], note: `${TAG}`, createdBy: actorId,
  });
  assert.equal(created.status, "CREATED");
  if (created.status !== "CREATED") return;

  // ยังไม่ส่ง — ยังไม่มีอะไรขยับ
  assert.equal(await stockAt(mainLocation), 105);

  assert.equal((await sendStockTransfer({ tenantId, transferId: created.transferId, actorUserId: actorId })).status, "OK");
  assert.equal(await stockAt(mainLocation), 75, "ของต้องออกจากต้นทางทันทีที่กดส่ง");
  assert.equal(await stockAt(branchLocation), 25, "ของยังไม่ถึงปลายทาง — อยู่บนรถ");

  assert.equal((await receiveStockTransfer({ tenantId, transferId: created.transferId, actorUserId: actorId })).status, "OK");
  assert.equal(await stockAt(branchLocation), 55);
  assert.equal(await stockAt(mainLocation), 75);
});

test("receiving less than was sent records the shortfall instead of hiding it", async () => {
  const created = await createStockTransfer({
    tenantId, fromLocationId: mainLocation, toLocationId: branchLocation,
    items: [{ sku: SKU, size: SIZE, qty: 10 }], createdBy: actorId,
  });
  if (created.status !== "CREATED") return assert.fail("สร้างใบโอนไม่สำเร็จ");
  await sendStockTransfer({ tenantId, transferId: created.transferId, actorUserId: actorId });

  const transfer = (await listStockTransfers(tenantId, "IN_TRANSIT")).find((t) => t.id === created.transferId);
  const itemId = transfer!.items[0].id;

  // ส่ง 10 ถึงจริง 8 — สองชิ้นหายระหว่างทาง
  const invalid = await receiveStockTransfer({
    tenantId, transferId: created.transferId, actorUserId: actorId,
    received: [{ itemId, qty: 8 }],
  });
  assert.equal(invalid.status, "INVALID", "รับขาดต้องระบุสาเหตุและหมายเหตุ");

  await receiveStockTransfer({
    tenantId, transferId: created.transferId, actorUserId: actorId,
    receivingNote: "ตรวจรับหน้ากล้องคลัง",
    received: [{
      itemId, qty: 7, damagedQty: 1,
      reason: "LOST_IN_TRANSIT", note: "กล่องฉีก พบของดี 7 เสียหาย 1 ไม่พบ 2",
    }],
  });
  assert.equal(await stockAt(branchLocation), 62, "ปลายทางเพิ่มเฉพาะของดี 7 ไม่ใช่ของเสียหาย");
  assert.equal(await stockAt(mainLocation), 65);

  const detail = (await listStockTransfers(tenantId, "RECEIVED")).find((t) => t.id === created.transferId)!;
  assert.equal(detail.items[0].receivedQty, 7);
  assert.equal(detail.items[0].damagedQty, 1);
  assert.equal(detail.items[0].missingQty, 2);
  assert.equal(detail.items[0].discrepancyReason, "LOST_IN_TRANSIT");
  assert.match(detail.items[0].discrepancyNote ?? "", /กล่องฉีก/);
  assert.equal(detail.receivingNote, "ตรวจรับหน้ากล้องคลัง");

  const quarantined = await query<{ n: number }>(
    `SELECT quarantine_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, branchLocation, SKU, SIZE]
  );
  assert.equal(Number(quarantined.rows[0].n), 1);

  const missing = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_stock_movements
      WHERE tenant_id = $1 AND product_sku = $2 AND type = 'STOCK_OUT'
        AND note LIKE '%ของขาดระหว่างโอน%'`,
    [tenantId, SKU]
  );
  assert.equal(Number(missing.rows[0].n), 1, "ของที่หายระหว่างทางต้องมีบรรทัดของตัวเอง");
});

test("a transfer cannot move more than is unreserved, and cannot be cancelled once sent", async () => {
  const tooBig = await createStockTransfer({
    tenantId, fromLocationId: mainLocation, toLocationId: branchLocation,
    items: [{ sku: SKU, size: SIZE, qty: 99999 }], createdBy: actorId,
  });
  if (tooBig.status !== "CREATED") return assert.fail("สร้างใบโอนไม่สำเร็จ");
  const res = await sendStockTransfer({ tenantId, transferId: tooBig.transferId, actorUserId: actorId });
  assert.equal(res.status, "INSUFFICIENT");
  assert.equal(await stockAt(mainLocation), 65, "ใบที่ส่งไม่ผ่านต้องไม่ตัดสต็อกบางส่วน");

  // ยกเลิกได้ตอนยังไม่ส่ง
  assert.equal((await cancelStockTransfer({ tenantId, transferId: tooBig.transferId, actorUserId: actorId })).status, "OK");

  const sent = await createStockTransfer({
    tenantId, fromLocationId: mainLocation, toLocationId: branchLocation,
    items: [{ sku: SKU, size: SIZE, qty: 1 }], createdBy: actorId,
  });
  if (sent.status !== "CREATED") return assert.fail("สร้างใบโอนไม่สำเร็จ");
  await sendStockTransfer({ tenantId, transferId: sent.transferId, actorUserId: actorId });
  const late = await cancelStockTransfer({ tenantId, transferId: sent.transferId, actorUserId: actorId });
  assert.equal(late.status, "WRONG_STATE", "ของออกจากชั้นแล้วต้องเดินให้จบด้วยการรับ");
  await receiveStockTransfer({ tenantId, transferId: sent.transferId, actorUserId: actorId });
});

test("transferring to the same branch is refused", async () => {
  const res = await createStockTransfer({
    tenantId, fromLocationId: mainLocation, toLocationId: mainLocation,
    items: [{ sku: SKU, size: SIZE, qty: 1 }], createdBy: actorId,
  });
  assert.equal(res.status, "INVALID");
});

// ---- ข้อ 11b: นับสต็อก -------------------------------------------------

test("a count applies the difference against its snapshot, so sales mid-count survive", async () => {
  const before = await stockAt(mainLocation);   // 64

  const created = await createStockCount({ tenantId, locationId: mainLocation, createdBy: actorId });
  assert.equal(created.status, "CREATED");
  if (created.status !== "CREATED") return;

  // คนเดินนับได้ 60 (หาย 4) — snapshot ถูกจับตอนนี้
  const item = await recordCountItem({
    tenantId, countId: created.countId, sku: SKU, size: SIZE,
    countedQty: before - 4, actorUserId: actorId,
  });
  assert.equal(item.status, "OK");
  assert.equal(item.status === "OK" ? item.snapshotQty : null, before);
  assert.equal(item.status === "OK" ? item.variance : null, -4);

  // ระหว่างที่ใบนับยังเปิด ร้านขายไปอีก 3 ชิ้น
  await adjustStock(tenantId, SKU, SIZE, -3, `${TAG} ขายระหว่างนับ`, "test", actorId, mainLocation);
  assert.equal(await stockAt(mainLocation), before - 3);

  const applied = await applyStockCount({ tenantId, countId: created.countId, actorUserId: actorId });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.status === "APPLIED" ? applied.varianceUnits : null, -4);

  // ถ้าเอา counted ไปทับตรง ๆ จะได้ before−4 (= เสกของที่ขายไปแล้วกลับมา 3 ชิ้น)
  assert.equal(await stockAt(mainLocation), before - 4 - 3,
    "ต้องหักทั้งของที่หาย (4) และของที่ขายไประหว่างนับ (3)");
});

test("a count that would drop stock below what customers reserved is refused", async () => {
  await query(
    `UPDATE bms_inventory SET reserved_stock = 50
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, mainLocation, SKU, SIZE]
  );

  const created = await createStockCount({ tenantId, locationId: mainLocation, createdBy: actorId });
  if (created.status !== "CREATED") return assert.fail("สร้างใบนับไม่สำเร็จ");
  await recordCountItem({
    tenantId, countId: created.countId, sku: SKU, size: SIZE, countedQty: 1, actorUserId: actorId,
  });

  const applied = await applyStockCount({ tenantId, countId: created.countId, actorUserId: actorId });
  assert.equal(applied.status, "WOULD_BREAK_RESERVED");

  const still = await listStockCounts(tenantId, "DRAFT");
  assert.ok(still.some((c) => c.id === created.countId), "ใบนับที่ apply ไม่ผ่านต้องยังเปิดอยู่");

  await query(
    `UPDATE bms_inventory SET reserved_stock = 0
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, mainLocation, SKU, SIZE]
  );
});

test("teardown: remove every row this suite created", async () => {
  const counts = await query<{ id: string }>(`SELECT id FROM bms_stock_counts WHERE tenant_id = $1`, [tenantId]);
  const transfers = await query<{ id: string }>(`SELECT id FROM bms_stock_transfers WHERE tenant_id = $1`, [tenantId]);
  if (counts.rowCount) {
    await query(`DELETE FROM bms_stock_count_items WHERE tenant_id = $1 AND count_id = ANY($2::uuid[])`,
      [tenantId, counts.rows.map((r) => r.id)]);
  }
  if (transfers.rowCount) {
    await query(`DELETE FROM bms_stock_transfer_items WHERE tenant_id = $1 AND transfer_id = ANY($2::uuid[])`,
      [tenantId, transfers.rows.map((r) => r.id)]);
  }
  await query(`DELETE FROM bms_stock_counts WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_stock_transfers WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_locations WHERE tenant_id = $1 AND code = $2`, [tenantId, `${TAG}-BR`]);
});
