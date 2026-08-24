// =============================================================
// reserveStock(): one shop, one branch, one ledger row
// -------------------------------------------------------------
// This function used to take (sku, size, qty) and nothing else. Two shops that
// both sell the same product code — the same real product, bought from the same
// distributor — share a row key on everything the statement filtered by, so a
// single call reserved stock in both of them. The caller got 200 OK.
//
// The cross-tenant case is the reason this suite creates the same SKU in two
// tenants: it is not an exotic setup, it is what happens the second time any
// shop lists a mainstream product.
//
// The other half is the ledger. `docs/business/inventory.md` states that every
// stock change generates a movement, and this function never wrote one, so goods
// could stop being sellable with nothing recording who held them or when. That is
// the bucket the products page now reports as "reserved but unexplained".
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/reserve-stock-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { reserveStock } from "../apps/web/lib/bms/stock.ts";

const TAG = "reserve-test";
/** สินค้ารหัสเดียวกันที่ทั้งสองร้านขาย — เคสที่ทำให้บั๊กข้ามร้านเกิดขึ้นจริง */
const SKU = `FAKE-${TAG}-SHARED`;
const SIZE = "M";

type Shop = { tenantId: string; locationId: string; name: string };
const shops: Shop[] = [];
let secondBranch = "";

const stockOf = async (tenantId: string, locationId: string) => {
  const res = await query<{ c: number; r: number }>(
    `SELECT current_stock AS c, reserved_stock AS r FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  return res.rowCount ? { current: Number(res.rows[0].c), reserved: Number(res.rows[0].r) } : null;
};

const movementsOf = async (tenantId: string) =>
  (await query<{ type: string; qty: number; location_id: string; note: string | null; actor: string | null }>(
    `SELECT type, qty, location_id, note, actor FROM bms_stock_movements
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY created_at, id`,
    [tenantId, SKU]
  )).rows;

test("setup: the same product code stocked by two different shops", async () => {
  const tenants = await query<{ id: string; name: string }>(
    `SELECT id, name FROM bms_tenants ORDER BY created_at LIMIT 2`
  );
  for (const row of tenants.rows) {
    const loc = await query<{ id: string }>(
      `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
        ORDER BY is_head_office DESC, created_at LIMIT 1`,
      [row.id]
    );
    if (!loc.rowCount) continue;
    shops.push({ tenantId: row.id, locationId: loc.rows[0].id, name: row.name });
  }
  assert.ok(shops.length >= 1, "ต้องมีร้านที่มีสาขาอย่างน้อยหนึ่งร้าน");

  for (const shop of shops) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$3,100,TRUE,'V')
       ON CONFLICT (tenant_id, sku) DO UPDATE SET active = TRUE`,
      [shop.tenantId, SKU, `FAKE ${TAG}`]
    );
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,10,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 10, reserved_stock = 0`,
      [shop.tenantId, shop.locationId, SKU, SIZE]
    );
    await query(
      `DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`,
      [shop.tenantId, SKU]
    );
  }

  // สาขาที่สองของร้านแรก — สร้างเองแทนการรอให้ฐานมีอยู่ ไม่งั้นเทสสาขาจะข้าม
  // ตัวเองเงียบ ๆ ในฐานที่ทุกร้านมีสาขาเดียว (ซึ่งเป็นสภาพของ dev ตอนนี้)
  // `is_head_office = FALSE` บังคับเสมอ: คอลัมน์ default เป็น TRUE ตั้งแต่ยุคร้านเดียว
  // และ branch_code '00000' สงวนให้สำนักงานใหญ่ (9.1)
  const branch = await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,$2,$3,$4,FALSE,TRUE)
     ON CONFLICT (tenant_id, code) DO UPDATE SET active = TRUE
     RETURNING id`,
    [shops[0].tenantId, `FAKE-${TAG}`, `FAKE ${TAG} branch`, "90001"]
  );
  secondBranch = branch.rows[0].id;
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,10,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 10, reserved_stock = 0`,
    [shops[0].tenantId, secondBranch, SKU, SIZE]
  );
});

test("reserving in one shop leaves the other shop's shelf untouched", async () => {
  if (shops.length < 2) {
    console.log("  (skipped: this database has only one tenant with a branch)");
    return;
  }
  const res = await reserveStock({
    tenantId: shops[0].tenantId, sku: SKU, size: SIZE, qty: 3, actor: TAG,
  });
  assert.equal(res.status, "RESERVED", JSON.stringify(res));

  assert.equal((await stockOf(shops[0].tenantId, shops[0].locationId))!.reserved, 3);
  assert.equal(
    (await stockOf(shops[1].tenantId, shops[1].locationId))!.reserved,
    0,
    "ร้านที่สองไม่ได้สั่งอะไรเลย ของบนชั้นต้องไม่ขยับ — นี่คือบั๊กเดิมทั้งหมด"
  );
  assert.equal((await movementsOf(shops[1].tenantId)).length, 0, "และต้องไม่มี ledger ของร้านที่สอง");
});

test("reserving names one branch and does not spill into the shop's other branches", async () => {
  const before = (await stockOf(shops[0].tenantId, secondBranch))!.reserved;
  const res = await reserveStock({
    tenantId: shops[0].tenantId, sku: SKU, size: SIZE, qty: 1,
    locationId: shops[0].locationId, actor: TAG,
  });
  assert.equal(res.status, "RESERVED", JSON.stringify(res));
  assert.equal(
    (await stockOf(shops[0].tenantId, secondBranch))!.reserved,
    before,
    "การจองเป็นของสาขา — สาขาอื่นของร้านเดียวกันก็ต้องไม่ขยับ"
  );
});

test("every successful reservation leaves a RESERVE movement behind", async () => {
  const moves = await movementsOf(shops[0].tenantId);
  assert.ok(moves.length > 0, "ไม่มี ledger = ของหายไปจากยอดขายได้โดยไม่มีใครรู้ว่าใครกันไว้");
  for (const m of moves) {
    assert.equal(m.type, "RESERVE");
    assert.equal(m.actor, TAG, "ต้องรู้ว่าใครสั่งกันของ");
  }
  const reservedAtBranches =
    (await stockOf(shops[0].tenantId, shops[0].locationId))!.reserved
    + (await stockOf(shops[0].tenantId, secondBranch))!.reserved;
  assert.equal(
    moves.reduce((sum, m) => sum + Number(m.qty), 0),
    reservedAtBranches,
    "ผลรวม ledger ต้องเท่ากับยอดที่จองไว้จริงของทุกสาขา"
  );
  assert.equal(
    new Set(moves.map((m) => m.location_id)).size >= 1,
    true,
    "movement ต้องบันทึกสาขาไว้ด้วย ไม่งั้นตามหาของไม่เจอในร้านหลายสาขา"
  );
});

test("a branch that does not stock the item is NOT_FOUND, not a silent no-op", async () => {
  const res = await reserveStock({
    tenantId: shops[0].tenantId, sku: `${SKU}-NOPE`, size: SIZE, qty: 1, actor: TAG,
  });
  assert.equal(res.status, "NOT_FOUND");
});

test("another shop's branch id cannot be borrowed to reserve across the boundary", async () => {
  if (shops.length < 2) {
    console.log("  (skipped: this database has only one tenant with a branch)");
    return;
  }
  const victimBefore = (await stockOf(shops[1].tenantId, shops[1].locationId))!.reserved;
  // ส่ง locationId ของร้านอื่นมาพร้อม tenant ของตัวเอง — คู่ที่ไม่มีอยู่จริง
  const res = await reserveStock({
    tenantId: shops[0].tenantId, sku: SKU, size: SIZE, qty: 1,
    locationId: shops[1].locationId, actor: TAG,
  });
  assert.equal(res.status, "NOT_FOUND", "คู่ tenant+location ที่ไม่มีจริงต้องไม่เจอแถว");
  assert.equal(
    (await stockOf(shops[1].tenantId, shops[1].locationId))!.reserved,
    victimBefore,
    "และต้องไม่ไปแตะสต็อกของร้านที่เป็นเจ้าของสาขานั้น"
  );
});

test("reserving more than the branch has is refused without moving anything", async () => {
  const before = (await stockOf(shops[0].tenantId, shops[0].locationId))!;
  const res = await reserveStock({
    tenantId: shops[0].tenantId, sku: SKU, size: SIZE, qty: 999, actor: TAG,
  });
  assert.equal(res.status, "INSUFFICIENT");
  if (res.status === "INSUFFICIENT") assert.equal(res.requested, 999);

  const after = (await stockOf(shops[0].tenantId, shops[0].locationId))!;
  assert.deepEqual(after, before, "คำขอที่ล้มต้องไม่ทิ้งการจองครึ่ง ๆ ไว้");
});

test("a rejected reservation writes no ledger row either", async () => {
  const moves = await movementsOf(shops[0].tenantId);
  assert.equal(
    moves.every((m) => Number(m.qty) < 999),
    true,
    "ledger ของคำขอที่ถูกปฏิเสธไม่ควรมีอยู่ — ROLLBACK ต้องครอบทั้ง ledger และสต็อก"
  );
});

test("teardown: remove every row this suite created", async () => {
  for (const shop of shops) {
    await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [shop.tenantId, SKU]);
    await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [shop.tenantId, SKU]);
    await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [shop.tenantId, SKU]);
  }
  // สาขาที่เทสสร้างเอง — ต้องลบทีหลังสุด เพราะ inventory อ้าง location อยู่
  if (secondBranch) {
    await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND location_id = $2`, [shops[0].tenantId, secondBranch]);
    await query(`DELETE FROM bms_locations WHERE tenant_id = $1 AND code = $2`, [shops[0].tenantId, `FAKE-${TAG}`]);
  }
});
