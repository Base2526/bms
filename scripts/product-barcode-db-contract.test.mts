// =============================================================
// Product barcode: per-tenant uniqueness + in-store code generation (7.99)
// -------------------------------------------------------------
// 3.4 created uq_bms_products_barcode as UNIQUE (barcode) with no tenant column,
// back when the system was a single shop. Under multi-tenancy that meant two
// shops selling the same product could not both record its real EAN-13 — the
// second one got "duplicate key" for a barcode it could not see, held by a shop
// it does not know exists. 7.99 scopes the index to (tenant_id, barcode).
//
// barcode-contract.test.mts covers the arithmetic with no database. This suite
// covers what only the database can answer: that the index really is per-tenant
// now, that it still blocks duplicates inside one shop, and that the generator
// walks the sequence and steps over numbers a shop already typed by hand.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/product-barcode-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { checkBarcode, inStoreBarcode } from "../apps/web/lib/bms/barcode.ts";
import { generateInStoreBarcode, upsertProduct } from "../apps/web/lib/bms/products.ts";

const TAG = "barcode-test";
const SKU_A = `FAKE-${TAG}-A`;
const SKU_B = `FAKE-${TAG}-B`;
const SHARED = "4006381333931";   // EAN-13 ที่ถูกต้อง ใช้แทนสินค้าที่สองร้านขายเหมือนกัน

let tenantA = "";
let tenantB = "";
/** บาร์โค้ดช่วง 20xx ที่ร้านมีอยู่ก่อนเทส — generator เดินลำดับต่อจากของจริง */
let baselineMaxSeq = 0;

const base = (sku: string) => ({ sku, name: `FAKE ${TAG} ${sku}`, price: 100, active: true });

test("setup: two shops", async () => {
  const ts = await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 2`);
  assert.equal(ts.rowCount, 2, "เทสนี้ต้องมีร้านอย่างน้อย 2 ร้านในฐาน");
  tenantA = ts.rows[0].id;
  tenantB = ts.rows[1].id;

  for (const t of [tenantA, tenantB]) {
    await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku LIKE $2`, [t, `FAKE-${TAG}-%`]);
  }

  const used = await query<{ barcode: string }>(
    `SELECT barcode FROM bms_products WHERE tenant_id = $1 AND barcode ~ '^2[0-9]{12}$'`,
    [tenantA]
  );
  for (const r of used.rows) {
    const seq = Number(r.barcode.slice(2, 12));
    if (Number.isFinite(seq) && seq > baselineMaxSeq) baselineMaxSeq = seq;
  }
});

test("two shops can hold the same real EAN-13 — the 7.99 fix", async () => {
  await upsertProduct(tenantA, { ...base(SKU_A), barcode: SHARED });
  // ก่อน 7.99 บรรทัดถัดไปคือ "duplicate key" ที่ร้าน B อธิบายไม่ได้
  await upsertProduct(tenantB, { ...base(SKU_A), barcode: SHARED });

  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_products WHERE barcode = $1 AND sku = $2`,
    [SHARED, SKU_A]
  );
  assert.equal(Number(rows.rows[0].n), 2);
});

test("the same barcode twice inside one shop is still rejected", async () => {
  await assert.rejects(
    () => upsertProduct(tenantA, { ...base(SKU_B), barcode: SHARED }),
    (err: any) => err?.code === "23505" || /duplicate|ซ้ำ/i.test(String(err?.message)),
    "ในร้านเดียวกันต้องยังห้ามซ้ำ — ไม่งั้นยิงบาร์โค้ดเดียวได้สองสินค้า"
  );
});

test("the generator returns a printable in-store EAN-13", async () => {
  const code = await generateInStoreBarcode(tenantA);
  assert.deepEqual(checkBarcode(code), { kind: "VALID", symbology: "EAN-13" });
  assert.ok(code.startsWith("20"), `ต้องอยู่ในช่วงที่ GS1 กันไว้ให้ร้าน ได้ ${code}`);
  assert.equal(code, inStoreBarcode(baselineMaxSeq + 1), "ต้องเดินลำดับต่อจากเลขที่ร้านใช้แล้ว");
});

test("the sequence advances once a generated code is actually saved", async () => {
  const first = await generateInStoreBarcode(tenantA);
  // ยังไม่บันทึก → กดอีกครั้งได้เลขเดิม (ปุ่มไม่เขียนฐาน คนกดแล้วปิดฟอร์มทิ้งได้)
  assert.equal(await generateInStoreBarcode(tenantA), first);

  await upsertProduct(tenantA, { ...base(SKU_B), barcode: first });
  const second = await generateInStoreBarcode(tenantA);
  assert.notEqual(second, first);
  assert.deepEqual(checkBarcode(second), { kind: "VALID", symbology: "EAN-13" });
});

test("the generator steps over a number the shop typed by hand out of order", async () => {
  // ร้านกรอกเลขช่วงเดียวกันไว้เองแบบกระโดด — เลขถัดไปต้องไม่ชนกับมัน
  const ahead = inStoreBarcode(baselineMaxSeq + 50);
  await upsertProduct(tenantA, { ...base(`FAKE-${TAG}-AHEAD`), barcode: ahead });

  const next = await generateInStoreBarcode(tenantA);
  assert.notEqual(next, ahead);
  assert.equal(next, inStoreBarcode(baselineMaxSeq + 51),
    "ต้องเดินต่อจากเลขสูงสุดที่มีอยู่ ไม่ใช่เติมช่องว่างแล้วชนของเดิม");
});

test("teardown", async () => {
  for (const t of [tenantA, tenantB]) {
    await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku LIKE $2`, [t, `FAKE-${TAG}-%`]);
  }
});
