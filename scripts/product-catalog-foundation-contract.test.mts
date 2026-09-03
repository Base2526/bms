// Product catalog foundation (9.51) — database-free regression contract.
// Run from apps/web: npx tsx --test ../../scripts/product-catalog-foundation-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  normalizeProductSalesSurfaces,
  normalizeProductVariantCode,
  productTemplateDefaults,
  sameProductVariantCode,
} from "../apps/web/lib/bms/productConfiguration.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
// คอมเมนต์ที่อธิบายกฎเก่า/กฎที่เพิ่งเลิกใช้ ต้องไม่ถูกนับเป็นโค้ดจริง
// (กับดักเดิมของเทสแบบสแกนซอร์ส — เคยเขียวเพราะคอมเมนต์มาแล้ว)
const withoutComments = (text: string) => text
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

test("product templates are safe draft presets and ingredients are internal", () => {
  assert.deepEqual(productTemplateDefaults("PREPARED_MENU"), {
    stockPolicy: "RECIPE", baseUnit: "PIECE", surfaces: ["RESTAURANT_POS"], active: false,
  });
  assert.deepEqual(productTemplateDefaults("INGREDIENT").surfaces, []);
  assert.equal(productTemplateDefaults("READY_GOOD").active, false);
});

test("surface input is normalized and rejected closed", () => {
  assert.deepEqual(
    normalizeProductSalesSurfaces(["restaurant_pos", "RESTAURANT_POS", "retail_pos"]),
    ["RESTAURANT_POS", "RETAIL_POS"]
  );
  assert.throws(() => normalizeProductSalesSurfaces(["UNKNOWN"]));
});

// รหัสตัวเลือกอยู่ใน namespace เดียวกับ bms_inventory.size ที่เป็น free text มาตลอด
// (ทั้ง seed ของ repo เองและร้านจริงมี "60ml", "100 ml", "10 เม็ด") และฟอร์มสินค้าเติมค่า
// เดิมกลับมาตอนบันทึก การแปลงตัวพิมพ์/ปฏิเสธภาษาไทยจึงทำให้ "เปิดสินค้ามากดบันทึก" ล้ม
// หรืองอกตัวเลือกใบที่สองที่ไม่มีราคาผูกไว้
test("variant codes round-trip the spelling the shop already uses", () => {
  assert.equal(normalizeProductVariantCode("  60ml  "), "60ml");
  assert.equal(normalizeProductVariantCode("100   ml"), "100 ml");
  assert.equal(normalizeProductVariantCode("10 เม็ด"), "10 เม็ด");
  assert.equal(normalizeProductVariantCode("1 ชุด"), "1 ชุด");
  assert.throws(() => normalizeProductVariantCode("   "));
  assert.throws(() => normalizeProductVariantCode("x".repeat(65)));
  assert.ok(sameProductVariantCode("std", "STD"));
  assert.ok(!sameProductVariantCode("60ml", "150ml"));
  // ทั้งสองเส้นทางเขียนต้องลงแถวเดิมเมื่อต่างกันแค่ตัวพิมพ์
  const products = source("apps/web/lib/bms/products.ts");
  const configuration = source("apps/web/lib/bms/productConfiguration.ts");
  assert.match(products, /resolveStoredVariantCodeInTx\(/);
  assert.match(configuration, /lower\(code\) = lower\(\$3\)/);
  assert.doesNotMatch(configuration, /normalizeProductVariantCode[\s\S]{0,200}toUpperCase\(\)/);
});

test("migration installs catalog variants, explicit surfaces and modifier groups safely", () => {
  const sql = source("db/migrations/9.51__bms_product_catalog_foundation.sql");
  for (const table of [
    "bms_product_variants", "bms_product_sales_surfaces", "bms_product_modifier_groups",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON[\\s\\S]*${table}`));
  }
  assert.match(sql, /INSERT INTO bms_product_variants[\s\S]*bms_inventory/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS group_id UUID/);
  assert.match(sql, /'MULTIPLE', 0, NULL::integer/);
  assert.match(sql, /ALTER COLUMN group_id SET NOT NULL/);
  assert.match(sql, /CREATE TRIGGER trg_bms_inventory_ensure_variant/);
  assert.match(sql, /Customer-facing paths[\s\S]*business_archetype[\s\S]*bms_product_recipe_items/);
});

test("upsert cannot mutate lifecycle and publishing cannot bypass readiness", () => {
  const products = source("apps/web/lib/bms/products.ts");
  const configuration = source("apps/web/lib/bms/productConfiguration.ts");
  const resolvers = source("apps/web/graphql/bmsProducts.ts");
  assert.match(products, /const effectiveActive = isNew \? false : null/);
  assert.match(configuration, /if \(!readiness\.ready\)/);
  assert.match(configuration, /UPDATE bms_products SET active = TRUE/);
  assert.match(resolvers, /if \(args\.active\) \{[\s\S]*publishProduct/);
});

test("every selling path uses an explicit sales surface", () => {
  const products = source("apps/web/lib/bms/products.ts");
  const pos = source("apps/web/lib/bms/pos.ts");
  const restaurant = source("apps/web/lib/bms/restaurantPos.ts");
  const orders = source("apps/web/lib/bms/orders.ts");
  assert.match(products, /opts\.salesSurface \?\? "CUSTOMER_AI"/);
  assert.match(products, /surface\.surface = \$\$\{salesSurfaceParam\}/);
  assert.match(source("apps/web/app/api/pos/search/route.ts"), /salesSurface: "RETAIL_POS"/);
  assert.match(products, /surface\.surface = 'PUBLIC_STOREFRONT'/);
  assert.match(pos, /surface \?\? "RETAIL_POS"/);
  assert.match(restaurant, /surface\.surface = 'RESTAURANT_POS'/);
  assert.match(orders, /"RESTAURANT_POS"[\s\S]*"RETAIL_POS"[\s\S]*"ONLINE_ORDER"/);
});

test("restaurant modifiers are grouped and revalidated on the server", () => {
  const orders = source("apps/web/lib/bms/orders.ts");
  const recipes = source("apps/web/lib/bms/productRecipes.ts");
  assert.match(orders, /MODIFIER_GROUP_MIN/);
  assert.match(orders, /MODIFIER_GROUP_MAX/);
  assert.match(orders, /MODIFIER_GROUP_SINGLE/);
  assert.match(recipes, /Modifier ใช้ได้เฉพาะสินค้าที่มี Stock Policy เป็น RECIPE/);
  assert.match(recipes, /default_selected/);
});

test("P2 workflows keep copied and imported products as drafts", () => {
  const configuration = source("apps/web/lib/bms/productConfiguration.ts");
  const products = source("apps/web/lib/bms/products.ts");
  const importService = source("apps/web/lib/bms/productImport.ts");
  const importer = source("apps/web/app/(admin)/admin/products/ImportModal.tsx");
  assert.match(configuration, /targetSku[\s\S]*FALSE, price/);
  assert.match(configuration, /Inventory, reservations, serials,[\s\S]*barcodes are deliberately not copied/);
  assert.match(products, /requestedVariants \?\? \(isNew \? \["STD"\] : null\)/);
  assert.match(importService, /validateProductConfigurationFields\(row\)/);
  assert.match(importer, /"รูปแบบสินค้า"/);
  assert.match(importer, /"ช่องทางขาย"/);
});

// เก็บเงินบิลโต๊ะเดินผ่าน recordPosSale ตัวเดียวกับบิลค้าปลีก ถ้า canonicalize ตรึงเป็น
// RETAIL_POS เมนูที่เปิดขายแค่ที่โต๊ะ (เทมเพลต PREPARED_MENU ตั้ง RESTAURANT_POS ตัวเดียว)
// จะสั่งได้ ครัวทำเสร็จ แต่คิดเงินไม่ได้ — ล้มกลางโต๊ะเป็น INVALID_PACK
test("settling a dine-in check checks the restaurant surface, not the retail one", () => {
  const pos = withoutComments(source("apps/web/lib/bms/pos.ts"));
  assert.doesNotMatch(pos, /surface\.surface = 'RETAIL_POS'/);
  assert.match(pos, /salesSurface: "RETAIL_POS" \| "RESTAURANT_POS"/);
  assert.match(
    pos,
    /canonicalizePosSaleLines\([\s\S]{0,120}input\.restaurantCheckId \? "RESTAURANT_POS" : "RETAIL_POS"/
  );
});

// ตัวอย่างข้อมูลเข้าฐานด้วย INSERT ตรง ไม่ผ่าน upsertProduct จึงไม่มีใครใส่ช่องทางขายให้
// เส้นทางนี้คือปุ่ม "สร้างข้อมูลตัวอย่าง" ของร้านใหม่ด้วย ไม่ใช่แค่เครื่องมือ dev
test("seeded sample products declare their sales surfaces", () => {
  const seed = source("apps/web/lib/bms/devSeed.ts");
  assert.match(seed, /function fakeProductSurfaces/);
  assert.match(seed, /INSERT INTO bms_product_sales_surfaces[\s\S]*unnest\(\$3::text\[\]\)/);
  assert.match(seed, /surf AS \([\s\S]*INSERT INTO bms_product_sales_surfaces/);
  assert.match(seed, /archetype === "restaurant"\) return \["RESTAURANT_POS"\]/);
  assert.doesNotMatch(seed, /archetype === "restaurant"[\s\S]{0,80}\.push\("RESTAURANT_POS"\)/);
  assert.match(seed, /archetype === "restaurant" \? CURATED_SEED_PRODUCTS\.food_beverage/);
  const onboarding = source("apps/web/lib/bms/onboardingSampleData.ts");
  assert.match(onboarding, /seedFakeProducts/);
});

// ราคาหน่วยฐานอยู่ที่ bms_product_packs.price ได้ (9.22/8.1) — เทียบแต่ p.price > 0
// จะถอดช่องทางขายของเมนูที่ตั้งราคาผ่าน pack ออกทั้งหมดตอน migrate
test("surface backfill counts a base pack price as a selling price", () => {
  const sql = source("db/migrations/9.51__bms_product_catalog_foundation.sql");
  assert.doesNotMatch(sql, /WHERE p\.price > 0/);
  assert.doesNotMatch(sql, /\n     p\.price > 0\n/);
  const priceTests = sql.match(/base_pack\.is_base AND base_pack\.active/g) ?? [];
  assert.equal(priceTests.length, 2);
});

// เคสหน้าร้านกับเคสออนไลน์เลือกยาจากคนละชุด: ยาที่ขายได้เฉพาะหน้าร้านต้องยังอยู่ในตัวเลือก
// ของเคสจากเครื่องขาย และเคสออนไลน์ต้องไม่ได้ใบอนุมัติที่ createOrder ปฏิเสธทีหลัง
test("the pharmacist product picker follows the case channel", () => {
  const pharmacy = source("apps/web/graphql/bmsPharmacy.ts");
  assert.match(pharmacy, /function catalogSurfaceForChannel[\s\S]{0,200}"RETAIL_POS" : "CUSTOMER_AI"/);
  assert.match(pharmacy, /salesSurface: await assessmentCatalogSurface\(/);
  assert.match(pharmacy, /salesSurface: suggestionSurface/);
  assert.match(pharmacy, /catalogSurfaceForChannel\(assessment\.channelId\)/);
  const page = source("apps/web/app/(admin)/admin/pharmacy-queue/[caseId]/page.tsx");
  assert.match(page, /bmsPharmacyCatalog\(search: \$search, limit: \$limit, assessmentId: \$assessmentId\)/);
});

// คอลัมน์ที่กรอกแล้วไม่มีผลแย่กว่าไม่มีคอลัมน์: upsertProduct ไม่สนใจ active ที่ส่งมาแล้ว
test("the import template no longer offers a lifecycle column", () => {
  const importer = withoutComments(source("apps/web/app/(admin)/admin/products/ImportModal.tsx"));
  assert.doesNotMatch(importer, /"เปิดขาย"/);
  assert.doesNotMatch(importer, /TRUE_WORDS/);
  assert.match(importer, /draft_only_desc/);
  for (const dictionary of ["apps/web/i18n/th.ts", "apps/web/i18n/en.ts"]) {
    assert.match(source(dictionary), /draft_only_desc:/);
  }
});
