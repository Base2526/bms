import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOP_ARCHETYPE_OPTIONS,
  archetypeNeedsRestockEmphasis,
  commercePolicyForArchetype,
  normalizeShopArchetype,
} from "../../apps/web/lib/bms/shopArchetypes.ts";

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
  for (const value of ["mini_mart", "fashion", "home_kitchen", "beauty_personal_care", "gadgets_accessories"]) {
    assert.equal(archetypeNeedsRestockEmphasis(value), true, value);
  }
  for (const value of ["food_beverage", "b2b_wholesale", "gifts_seasonal", "other"]) {
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
