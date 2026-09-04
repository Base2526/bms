// NON_STOCK stock policy (9.52) — database-free regression contract.
// Run from apps/web: npx tsx --test ../../scripts/non-stock-policy-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  POLICY_REQUIRED_CAPABILITY,
  PRODUCT_STOCK_POLICIES,
  productStockPolicyOptions,
} from "../apps/web/lib/bms/productStockPolicyOptions.ts";
import path from "node:path";

import { productTemplateDefaults } from "../apps/web/lib/bms/productConfiguration.ts";
import { PRODUCT_STOCK_POLICIES } from "../apps/web/lib/bms/productStockPolicies.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
// A comment explaining an old rule must never be mistaken for the rule itself —
// the standing trap of source-scanning tests in this repo.
const withoutComments = (text: string) => text
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "");

test("NON_STOCK is an accepted stock policy", () => {
  assert.ok(PRODUCT_STOCK_POLICIES.includes("NON_STOCK" as never));
});

test("the QUICK_MENU template is a chat-ready restaurant draft that needs no recipe", () => {
  assert.deepEqual(productTemplateDefaults("QUICK_MENU"), {
    stockPolicy: "NON_STOCK",
    baseUnit: "PIECE",
    surfaces: ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"],
    active: false,
  });
  assert.deepEqual(productTemplateDefaults("QUICK_MENU").surfaces,
    ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"]);
  assert.equal(productTemplateDefaults("PREPARED_MENU").stockPolicy, "RECIPE",
    "the recipe template is untouched");
});

test("service validation accepts NON_STOCK and QUICK_MENU", () => {
  const products = withoutComments(source("apps/web/lib/bms/products.ts"));
  assert.match(products, /"SERIALIZED",\s*"NON_STOCK"\]\.includes\(requestedPolicy\)/);
  assert.match(products, /"QUICK_MENU",\s*"PREPARED_MENU"/);
});

test("a NON_STOCK line consumes nothing but still creates its zero inventory row", () => {
  const consumption = withoutComments(source("apps/web/lib/bms/stockConsumption.ts"));
  const branch = consumption.slice(consumption.indexOf('policy.stock_policy === "NON_STOCK"'));
  assert.ok(branch.length > 0, "the NON_STOCK branch must exist");
  const body = branch.slice(0, branch.indexOf("}\n\n"));
  // derived: true is what makes createOrder() insert the zero bms_inventory row that
  // bms_order_items' FK has required since migration 3.3.
  assert.match(body, /derived:\s*true/);
  assert.match(body, /lines:\s*\[\]/);
});

test("NON_STOCK accepts instruction-only modifiers and rejects ingredient deltas", () => {
  const consumption = withoutComments(source("apps/web/lib/bms/stockConsumption.ts"));
  const branch = consumption.slice(consumption.indexOf('policy.stock_policy === "NON_STOCK"'));
  const body = branch.slice(0, branch.indexOf("}\n\n"));
  assert.match(body, /if \(hasStockModifiers\)[\s\S]*MODIFIER_REQUIRES_RECIPE/);
  assert.match(consumption, /LEFT JOIN bms_product_modifier_items/,
    "a modifier without an ingredient row must still resolve as a valid instruction");
});

test("the kitchen board covers NON_STOCK menus sold on a plain retail register", () => {
  const kitchen = withoutComments(source("apps/web/lib/bms/kitchen.ts"));
  assert.match(kitchen, /stock_policy IN \('RECIPE', 'NON_STOCK'\)/);
  assert.doesNotMatch(kitchen, /stock_policy = 'RECIPE'/);
});

test("migration 9.52 keeps NON_STOCK out of the view's legacy fallback branch", () => {
  const sql = source("db/migrations/9.52__bms_product_non_stock_policy.sql");
  const body = withoutComments(sql);
  assert.match(body, /CREATE VIEW bms_order_stock_lines/);
  assert.match(body, /COALESCE\(sp\.stock_policy, 'DIRECT'\) <> 'NON_STOCK'/);
  assert.match(body, /'SERIALIZED', 'NON_STOCK'/, "the CHECK constraint must accept the new code");
  // The predicate belongs to the non-bundle legacy branch only.
  assert.equal((body.match(/<> 'NON_STOCK'/g) ?? []).length, 1);
});

test("both admin surfaces can select the new policy", () => {
  // ทั้งสองหน้าอ่านลิสต์เดียวกันจากโมดูล pure แล้ว (ดู product-policy-reachability)
  // เทสนี้จึงคุม "NON_STOCK เลือกได้จริงโดยไม่ต้องเปิดความสามารถอะไรก่อน" ซึ่งเป็น
  // ประเด็นของ 9.52 — เดิม stock-models ผูกมันไว้กับ capability RECIPE ซึ่งกลับหัว
  // (ร้านที่ไม่อยากคุมวัตถุดิบคือคนที่ต้องใช้ NON_STOCK พอดี)
  assert.ok(PRODUCT_STOCK_POLICIES.includes("NON_STOCK"));
  assert.equal(POLICY_REQUIRED_CAPABILITY.NON_STOCK, undefined);
  assert.ok(productStockPolicyOptions(() => false).includes("NON_STOCK"));

  const products = source("apps/web/app/(admin)/admin/products/page.tsx");
  assert.match(products, /productStockPolicyOptions\(capabilityIsActive/);
  assert.match(products, /productTemplateDefaults\(template\)/,
    "the product UI must consume the shared template defaults");
  assert.match(products, /admin_products\.template_quick_menu/);
  const stockModels = source("apps/web/app/(admin)/admin/stock-models/page.tsx");
  assert.match(stockModels, /POLICY_OPTIONS = PRODUCT_STOCK_POLICIES\.map/);
  assert.match(stockModels, /POLICY_REQUIRED_CAPABILITY\[option\.value\]/);
});

test("the quick-menu copy exists in both languages", () => {
  for (const locale of ["th", "en"]) {
    const dict = source(`apps/web/i18n/${locale}.ts`);
    assert.match(dict, /template_quick_menu:/, `${locale} label`);
    assert.match(dict, /template_quick_menu_hint:/, `${locale} hint`);
  }
});

test("the register accepts a NON_STOCK line before any inventory row exists", () => {
  const pos = withoutComments(source("apps/web/lib/bms/pos.ts"));
  // canonicalizePosSaleLines admits a line only if it has a stock row, or the product
  // owns no stock. A NON_STOCK menu owns none and its zero FK row is created by the
  // first createOrder — so without NON_STOCK here the first sale of every quick menu
  // died with INVALID_PACK, on the retail register and on a parked bill alike.
  assert.match(pos, /OR p\.is_bundle OR sp\.stock_policy IN \('RECIPE', 'NON_STOCK'\)/);
  assert.doesNotMatch(pos, /OR p\.is_bundle OR sp\.stock_policy = 'RECIPE'/);
});

test("a scan falls back to the catalog variant when no stock row exists yet", () => {
  const pos = withoutComments(source("apps/web/lib/bms/pos.ts"));
  const scan = pos.slice(pos.indexOf("export async function resolvePosScan"));
  // Size was resolved only from bms_inventory/packs, so a never-sold menu scanned as
  // size NULL and could not be added to a bill at all.
  assert.match(scan.slice(0, scan.indexOf("AS size")),
    /FROM bms_product_variants variant/);
});
