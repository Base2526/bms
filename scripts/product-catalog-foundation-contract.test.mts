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
} from "../apps/web/lib/bms/productConfiguration.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("product templates are safe draft presets and ingredients are internal", () => {
  assert.deepEqual(productTemplateDefaults("PREPARED_MENU"), {
    stockPolicy: "RECIPE", baseUnit: "PIECE", surfaces: ["RESTAURANT_POS"], active: false,
  });
  assert.deepEqual(productTemplateDefaults("INGREDIENT").surfaces, []);
  assert.equal(productTemplateDefaults("READY_GOOD").active, false);
});

test("variant and surface input is normalized and rejected closed", () => {
  assert.equal(normalizeProductVariantCode(" large size "), "LARGE_SIZE");
  assert.deepEqual(
    normalizeProductSalesSurfaces(["restaurant_pos", "RESTAURANT_POS", "retail_pos"]),
    ["RESTAURANT_POS", "RETAIL_POS"]
  );
  assert.throws(() => normalizeProductVariantCode("หวานน้อย"));
  assert.throws(() => normalizeProductSalesSurfaces(["UNKNOWN"]));
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
