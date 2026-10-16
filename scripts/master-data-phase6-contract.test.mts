import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseProductBarcode } from "../apps/web/lib/bms/productBarcodeLookupContract.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read("db/migrations/10.81__bms_barcode_master_cache.sql");
const products = read("apps/web/lib/bms/products.ts");
const master = read("apps/web/lib/bms/barcodeMaster.ts");

test("global barcode master contains no tenant, shop, price, cost, or stock columns", () => {
  const table = migration.match(/CREATE TABLE IF NOT EXISTS bms_master_barcodes \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.ok(table);
  for (const forbidden of ["tenant_id", "shop", "price", "cost", "stock"]) {
    assert.doesNotMatch(table, new RegExp(`\\b${forbidden}\\b`, "i"));
  }
  assert.match(table, /status TEXT[\s\S]*CANDIDATE[\s\S]*APPROVED[\s\S]*REJECTED/);
});
test("restricted 20-29 and scale-label barcodes never become external or master candidates", () => {
  for (const code of ["2000000000015", "2100000000014", "2200000000013", "02000000000015"]) {
    assert.equal(parseProductBarcode(code)?.external, false, code);
  }
  assert.match(migration, /p_barcode ~ '\^2\[0-9\]' OR p_barcode ~ '\^02\[0-9\]'/);
  assert.match(master, /!isProductGtin\(input\.barcode\) \|\| \/\^0\?2\[0-9\]\//);
});

test("candidate submission requires both shop opt-in and per-save confirmation", () => {
  assert.match(migration, /barcode_master_contribution_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /WHERE tenant_id = v_tenant AND barcode_master_contribution_enabled/);
  assert.match(products, /confirmed: input\.confirm_barcode_master === true/);
  assert.match(master, /if \(!input\.confirmed/);
});

test("one shop cannot inflate confirmations by deleting and recreating a product", () => {
  const ledger = migration.match(/CREATE TABLE IF NOT EXISTS bms_barcode_master_contributions \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.match(ledger, /PRIMARY KEY \(tenant_id, barcode\)/);
  assert.doesNotMatch(ledger, /REFERENCES bms_products/);
  assert.match(migration, /FROM bms_products[\s\S]*tenant_id = v_tenant AND sku = p_product_sku/);
});

test("approved master is checked before the provider and provider payload stays uncached", () => {
  const lookup = read("apps/web/lib/bms/productBarcodeLookup.ts");
  assert.ok(lookup.indexOf("findApprovedMasterBarcode") < lookup.indexOf("fetchBarcodeProduct(code"));
  assert.doesNotMatch(read("apps/web/lib/bms/productBarcodeProvider.ts"), /INSERT|UPDATE bms_master_barcodes/i);
});

