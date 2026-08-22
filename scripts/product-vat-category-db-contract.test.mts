// =============================================================
// Product VAT category — the write path that never existed (7.88)
// -------------------------------------------------------------
// bms_products.vat_category has been read since 7.88 (order line snapshots,
// tax invoices, e-Tax XML) and gates go-live on /admin/pos-readiness, but
// nothing in the app could write it: upsertProduct listed 13 columns and this
// was not one of them. A VAT-registered shop therefore hit a blocker with no
// remedy short of hand-written SQL.
//
// The single most dangerous behaviour here is the one this suite exists for:
// omitting vat_category must NOT reset it. Bulk import and any older form that
// does not know about the field would otherwise silently wipe every shop's tax
// classification back to UNKNOWN on the next save.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/product-vat-category-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { setVatCategoryForUnknown, upsertProduct } from "../apps/web/lib/bms/products.ts";

const TAG = "vatcat-test";
const SKU_A = `FAKE-${TAG}-A`;
const SKU_B = `FAKE-${TAG}-B`;
const SKU_C = `FAKE-${TAG}-C`;

let tenantId = "";
/** สินค้าจริงของร้านที่ค้าง UNKNOWN อยู่ก่อนเทส — ปุ่ม bulk แก้ทั้งร้านตามดีไซน์
 *  จึงต้องจดไว้แล้วคืนค่าตอน teardown ไม่ใช่ปล่อยให้ข้อมูล dev เพี้ยนไปเรื่อย ๆ */
let preexistingUnknown: string[] = [];

const catOf = async (sku: string): Promise<string> => {
  const res = await query<{ vat_category: string }>(
    `SELECT vat_category FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, sku]
  );
  return res.rows[0]?.vat_category ?? "(missing)";
};

const base = (sku: string) => ({ sku, name: `FAKE ${TAG} ${sku}`, price: 100, active: true });

test("setup", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku LIKE $2`, [tenantId, `FAKE-${TAG}-%`]);

  const others = await query<{ sku: string }>(
    `SELECT sku FROM bms_products
      WHERE tenant_id = $1 AND active AND vat_category = 'UNKNOWN' AND sku NOT LIKE $2`,
    [tenantId, `FAKE-${TAG}-%`]
  );
  preexistingUnknown = others.rows.map((r) => r.sku);
});

test("a new product with no VAT category is UNKNOWN, not guessed", async () => {
  await upsertProduct(tenantId, base(SKU_A));
  assert.equal(await catOf(SKU_A), "UNKNOWN",
    "ห้ามเดาประเภทภาษีให้ร้าน — ต้องให้คนตั้งเอง");
});

test("the form can set it, which was impossible before", async () => {
  await upsertProduct(tenantId, { ...base(SKU_A), vat_category: "V" });
  assert.equal(await catOf(SKU_A), "V");

  await upsertProduct(tenantId, { ...base(SKU_A), vat_category: "N" });
  assert.equal(await catOf(SKU_A), "N", "เปลี่ยนไปมาได้");
});

test("omitting the field keeps the stored value — the regression that would wipe every shop", async () => {
  await upsertProduct(tenantId, { ...base(SKU_A), vat_category: "V" });
  // บันทึกจากฟอร์ม/ตัวนำเข้าที่ไม่รู้จักคอลัมน์นี้
  await upsertProduct(tenantId, { ...base(SKU_A), name: "ชื่อใหม่" });
  assert.equal(await catOf(SKU_A), "V",
    "ไม่ส่งมา = คงค่าเดิม · ถ้าอันนี้พัง bulk import จะล้างประเภทภาษีทั้งร้านเงียบ ๆ");

  // ค่าที่ไม่รู้จักถือว่าไม่ได้ส่งมา ไม่ใช่ throw และไม่ใช่เขียนค่าเพี้ยนลงฐาน
  await upsertProduct(tenantId, { ...base(SKU_A), vat_category: "X" as any });
  assert.equal(await catOf(SKU_A), "V");
});

test("the bulk setter touches only UNKNOWN rows", async () => {
  await upsertProduct(tenantId, { ...base(SKU_A), vat_category: "N" });   // ตั้งไว้แล้ว
  await upsertProduct(tenantId, base(SKU_B));                             // UNKNOWN
  await upsertProduct(tenantId, { ...base(SKU_C), active: false });        // UNKNOWN + ปิดขาย

  const changed = await setVatCategoryForUnknown(tenantId, "V");
  assert.equal(await catOf(SKU_A), "N", "สินค้าที่ตั้งค่าไว้แล้วต้องไม่ถูกเขียนทับ");
  assert.equal(await catOf(SKU_B), "V");
  assert.equal(await catOf(SKU_C), "UNKNOWN", "activeOnly=true (default) ต้องไม่แตะสินค้าที่ปิดขาย");

  // ตัวเลขที่คืนต้องนับรวมสินค้าจริงของร้านที่ค้าง UNKNOWN อยู่ด้วย ไม่ใช่แค่ของเทส
  assert.equal(changed, 1 + preexistingUnknown.length);
});

test("the bulk setter refuses UNKNOWN as a target", async () => {
  await assert.rejects(() => setVatCategoryForUnknown(tenantId, "UNKNOWN" as any), /V หรือ N/);
});

test("teardown: remove test products and put real ones back to UNKNOWN", async () => {
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku LIKE $2`, [tenantId, `FAKE-${TAG}-%`]);
  if (preexistingUnknown.length) {
    await query(
      `UPDATE bms_products SET vat_category = 'UNKNOWN'
        WHERE tenant_id = $1 AND sku = ANY($2::text[])`,
      [tenantId, preexistingUnknown]
    );
  }
});
