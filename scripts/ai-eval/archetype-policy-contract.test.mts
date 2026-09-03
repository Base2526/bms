import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SHOP_ARCHETYPE_OPTIONS,
  archetypeNeedsRestockEmphasis,
  commercePolicyForArchetype,
  normalizeShopArchetype,
} from "../../apps/web/lib/bms/shopArchetypes.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("every signup archetype normalizes and has a complete commerce policy", () => {
  for (const option of SHOP_ARCHETYPE_OPTIONS) {
    assert.equal(normalizeShopArchetype(option.value), option.value);
    const policy = commercePolicyForArchetype(option.value);
    assert.ok(policy.salesMotion);
    assert.ok(policy.discovery);
    assert.ok(policy.basket);
    assert.ok(policy.repeatPurchase);
    assert.ok(policy.fulfillment);
  }
  assert.equal(normalizeShopArchetype("unknown"), null);
});

test("high-repeat and variant businesses emphasize restock while food and wholesale do not", () => {
  for (const value of ["mini_mart", "fashion", "home_kitchen", "beauty_personal_care", "gadgets_accessories", "pet_supply", "building_materials"]) {
    assert.equal(archetypeNeedsRestockEmphasis(value), true, value);
  }
  for (const value of ["food_beverage", "restaurant", "b2b_wholesale", "gifts_seasonal", "other"]) {
    assert.equal(archetypeNeedsRestockEmphasis(value), false, value);
  }
});

test("archetypes select materially different sales motions", () => {
  const motions = new Set(SHOP_ARCHETYPE_OPTIONS.map((option) => commercePolicyForArchetype(option.value).salesMotion));
  assert.ok(motions.size >= 8);
  assert.equal(commercePolicyForArchetype("b2b_wholesale").salesMotion, "bulk_quote_reorder");
  assert.equal(commercePolicyForArchetype("food_beverage").salesMotion, "menu_fast_checkout");
  assert.equal(commercePolicyForArchetype("fashion").salesMotion, "variant_fit");
});

test("Inbox AI uses one precise example set and keeps legacy fallback", () => {
  const pipeline = source("apps/web/lib/bms/pipeline.ts");
  const archetypeExamples = pipeline.slice(
    pipeline.indexOf("function buildBusinessArchetypeExamples"),
    pipeline.indexOf("type AiProfileContext")
  );
  for (const { value } of SHOP_ARCHETYPE_OPTIONS) {
    assert.match(archetypeExamples, new RegExp(`case ["']${value}["']:`), `${value} has no Inbox AI examples`);
  }
  assert.match(pipeline, /archetypeExamples\.length > 0[\s\S]*?\? archetypeExamples[\s\S]*?: buildBusinessTypeExamples/);
  assert.doesNotMatch(
    pipeline,
    /lines\.push\(\.\.\.buildBusinessTypeExamples[\s\S]{0,120}lines\.push\(\.\.\.buildBusinessArchetypeExamples/,
    "broad and precise examples must not be injected together"
  );
});

test("Inbox follow-up AI receives the same archetype commerce policy", () => {
  const followups = source("apps/web/lib/bms/followups.ts");
  assert.match(followups, /commercePolicyForArchetype\(storeProfile\.businessArchetype\)/);
  assert.match(followups, /salesMotion=\$\{commercePolicy\.salesMotion\}/);
  assert.match(followups, /repeatPurchase=\$\{commercePolicy\.repeatPurchase\}/);
});

test("archetype guidance never widens the customer-visible catalog", () => {
  const products = source("apps/web/lib/bms/products.ts");
  assert.match(products, /const salesSurface = opts\.salesSurface \?\? "CUSTOMER_AI"/);
  assert.match(products, /salesSurface === "CUSTOMER_AI"[\s\S]*?surface = 'ONLINE_ORDER' AND order_surface\.enabled/);
  assert.doesNotMatch(
    products.slice(products.indexOf("export async function listSellableProducts"), products.indexOf("export async function resolveSellableProduct")),
    /business_archetype/,
    "archetype is guidance only; explicit per-product surfaces remain authoritative"
  );
});
