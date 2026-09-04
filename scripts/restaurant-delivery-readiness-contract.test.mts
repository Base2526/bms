import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_RESTAURANT_SEED_SET,
  RESTAURANT_QUICK_MENU,
  RESTAURANT_RECIPE_MENU,
  normalizeRestaurantSeedSet,
} from "../apps/web/lib/bms/restaurantCatalogSeed";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("restaurant sample data offers quick and recipe sets, defaulting to no-recipe menus", () => {
  assert.equal(DEFAULT_RESTAURANT_SEED_SET, "quick");
  assert.ok(RESTAURANT_QUICK_MENU.length > 0 && RESTAURANT_RECIPE_MENU.length > 0);
  assert.ok(RESTAURANT_QUICK_MENU.every((item) => item.stockPolicy !== "RECIPE" && !item.recipe?.length));
  assert.ok(RESTAURANT_RECIPE_MENU.some((item) => item.stockPolicy === "RECIPE" && item.recipe?.length));
  assert.equal(normalizeRestaurantSeedSet("recipe"), "recipe");
  assert.equal(normalizeRestaurantSeedSet("anything-else"), "quick");
  const seeder = read("apps/web/lib/bms/devSeed.ts");
  assert.match(seeder, /const menu = RESTAURANT_SEED_SETS\[seedSet\]/);
  assert.match(seeder, /seedSet === "recipe" \? RESTAURANT_INGREDIENTS : \[\]/);
});

test("restaurant onboarding teaches delivery operations rather than mandatory recipes", () => {
  const en = read("apps/web/i18n/en.ts");
  const th = read("apps/web/i18n/th.ts");
  for (const source of [en, th]) {
    const section = source.slice(source.indexOf("checklist_restaurant_1"), source.indexOf("checklist_default_1"));
    assert.doesNotMatch(section, /recipe for each|ใส่สูตรให้ทุกเมนู/);
    assert.match(section, /chat|แชท/);
    assert.match(section, /flat delivery fee|ค่าส่งเหมา/);
  }
});

test("delivery uses existing flat shipping, prepaid packing, and OTHER rider tracking", () => {
  assert.match(read("apps/web/lib/bms/storeProfile.ts"), /shippingMode: "flat"/);
  // PAID -> PACKING stays the boundary that creates kitchen work, but only for a restaurant
  // fulfillment. Asserting the old `RETURNING id` shape would force retail packing to enqueue
  // kitchen tickets again for any product that happens to carry a station.
  const orders = read("apps/web/lib/bms/orders.ts");
  assert.match(orders, /status = 'PAID'[\s\S]{0,120}RETURNING fulfillment_type/);
  assert.match(orders, /fulfillment_type !== null\)?\s*\{?[\s\S]{0,160}enqueueKitchenTicketsInTx/);
  assert.match(read("apps/web/lib/bms/carriers/constants.ts"), /"OTHER"/);
});

test("new assistant guides are pinned in the evaluation corpus", () => {
  const guides = read("apps/web/lib/bms/assistantKnowledge/guides.ts");
  const corpus = read("scripts/ai-eval/work-assistant-question-corpus.mts");
  for (const id of ["restaurant.menu-availability", "restaurant.delivery-accept", "restaurant.delivery-cancel-refund"]) {
    assert.match(guides, new RegExp(`id: "${id.replaceAll(".", "\\.")}"`));
    assert.match(corpus, new RegExp(`expectTop: "${id.replaceAll(".", "\\.")}"`));
  }
});
