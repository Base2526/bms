import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOP_ARCHETYPE_OPTIONS,
  normalizeShopArchetype,
} from "../apps/web/lib/bms/shopArchetypes.ts";
import {
  presetCapabilitiesForArchetype,
} from "../apps/web/lib/bms/storeCapabilities.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("new business archetypes normalize and select stock-focused presets", () => {
  const values = new Set(SHOP_ARCHETYPE_OPTIONS.map((option) => option.value));
  for (const value of ["pet_supply", "building_materials", "restaurant"]) {
    assert.ok(values.has(value as any));
    assert.equal(normalizeShopArchetype(value), value);
  }
  assert.deepEqual(
    [...presetCapabilitiesForArchetype("pet_supply")].sort(),
    ["EXPIRY_TRACKING", "LOT_TRACKING", "MULTI_BARCODE", "PACK", "WEIGHTED_PRODUCT"].sort()
  );
  assert.ok(presetCapabilitiesForArchetype("building_materials").has("UNIT_CONVERSION"));
  assert.ok(presetCapabilitiesForArchetype("building_materials").has("SERIAL_TRACKING"));
  assert.ok(presetCapabilitiesForArchetype("restaurant").has("RECIPE"));
  assert.ok(presetCapabilitiesForArchetype("restaurant").has("KITCHEN_WORKFLOW"));
});

test("migration keeps integer base stock and makes snapshots win over legacy expansion", () => {
  const migration = read("db/migrations/9.40__bms_multi_store_stock_capabilities.sql");
  assert.match(migration, /qty\s+INTEGER NOT NULL CHECK \(qty > 0\)/);
  assert.match(migration, /bms_order_item_stock_consumption/);
  assert.match(migration, /NOT EXISTS \([\s\S]*bms_order_item_stock_consumption/);
  assert.match(migration, /CREATE VIEW bms_order_stock_lines/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
  assert.match(migration, /FOREIGN KEY \(tenant_id, order_item_id\)/);
});

test("all order inventory paths continue through the shared stock-lines view", () => {
  const orders = read("apps/web/lib/bms/orders.ts");
  const pos = read("apps/web/lib/bms/pos.ts");
  const movements = read("apps/web/lib/bms/movements.ts");
  assert.match(orders, /resolveStockConsumptionInTx/);
  assert.match(orders, /snapshotOrderItemConsumptionInTx/);
  assert.ok((orders.match(/FROM bms_order_stock_lines/g) ?? []).length >= 3);
  assert.ok((pos.match(/FROM bms_order_stock_lines/g) ?? []).length >= 3);
  assert.match(movements, /FROM bms_order_stock_lines/);
  assert.match(pos, /parseScaleBarcode/);
  assert.match(pos, /scaleHit = await resolvePosScan/);
  // A weighed line may only come from a prefix-22 label that maps to a configured variant. The
  // price-embedded prefix 21 must never reach the branch that sets an embedded quantity, because
  // reversing a rounded total back into grams moves the wrong stock while the screen looks right.
  assert.match(pos, /scale\.kind === "WEIGHT" && scale\.grams > 0/);
  const embedded = pos.slice(pos.indexOf("const scale = parseScaleBarcode"));
  assert.ok(
    embedded.indexOf("embeddedBaseQty = scale.grams") > embedded.indexOf('scale.kind === "WEIGHT"'),
    "an embedded quantity must be set only inside the weight-label branch"
  );
  // …and a scale-shaped code that maps to nothing falls through to the ordinary barcode lookup
  // instead of making that product unscannable (checkBarcode warns but never blocks, so a shop
  // can legitimately hold a 21/22-prefixed product barcode).
  assert.doesNotMatch(pos, /if \(mapped\.rowCount !== 1\) return null;/);
  const recipes = read("apps/web/lib/bms/productRecipes.ts");
  assert.match(recipes, /WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/g);
  assert.match(recipes, /ย้ายสูตรไปสินค้า\/ตัวเลือกอื่นไม่ได้/);
  assert.match(recipes, /ย้าย Modifier ไปสินค้าอื่นไม่ได้/);
});
