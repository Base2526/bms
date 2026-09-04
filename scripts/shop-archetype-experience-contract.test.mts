// Database-free contract for the archetype-aware admin experience.
// Run from apps/web: npx tsx --test ../../scripts/shop-archetype-experience-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SHOP_ARCHETYPE_OPTIONS } from "../apps/web/lib/bms/shopArchetypes.ts";
import {
  PRODUCT_CREATION_TEMPLATES,
  PRODUCT_SALES_SURFACES,
  inferProductCreationTemplate,
  productTemplateDefaults,
} from "../apps/web/lib/bms/productTemplatePresets.ts";
import {
  SHOP_EXPERIENCE_PROFILES,
  additionalProductTemplates,
  productFormFieldVisibility,
  shopExperienceForArchetype,
} from "../apps/web/lib/bms/shopExperience.ts";
import { resolveStoreCapabilityState } from "../apps/web/lib/bms/storeCapabilities.ts";
import {
  validateProductConfigurationFields,
  validateProductFields,
} from "../apps/web/lib/bms/products.ts";
import en from "../apps/web/i18n/en.ts";
import th from "../apps/web/i18n/th.ts";

const ARCHETYPES = SHOP_ARCHETYPE_OPTIONS.map((option) => option.value);
const ROOT = path.resolve(import.meta.dirname, "..");
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const CAPABILITIES = new Set([
  "PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "FEFO",
  "WEIGHTED_PRODUCT", "UNIT_CONVERSION", "SERIAL_TRACKING", "PHARMACY_POLICY",
  "RECIPE", "MODIFIER", "KITCHEN_WORKFLOW", "WASTAGE",
]);

test("all shop archetypes have an explicit experience profile", () => {
  assert.deepEqual(Object.keys(SHOP_EXPERIENCE_PROFILES).sort(), [...ARCHETYPES].sort());
  for (const archetype of ARCHETYPES) {
    const profile = shopExperienceForArchetype(archetype);
    assert.equal(profile.archetype, archetype);
    assert.ok(profile.recommendedTemplates.length > 0, `${archetype} has no recommended product template`);
    assert.equal(profile.importExample.length, 14, `${archetype} import example does not match the template columns`);
    assert.ok((en as any).shop_archetypes[profile.descriptionKey.split(".").at(-1)!]);
    assert.ok((th as any).shop_archetypes[profile.descriptionKey.split(".").at(-1)!]);

    const templatePartition = [...profile.recommendedTemplates, ...additionalProductTemplates(profile)].sort();
    assert.deepEqual(templatePartition, [...PRODUCT_CREATION_TEMPLATES].sort(), `${archetype} does not partition every template exactly once`);
    assert.ok(profile.recommendedCapabilities.every((capability) => CAPABILITIES.has(capability)));
    assert.ok(profile.primarySalesSurfaces.every((surface) => PRODUCT_SALES_SURFACES.includes(surface)));
    assert.equal(new Set(profile.recommendedTemplates).size, profile.recommendedTemplates.length);
    assert.equal(new Set(profile.recommendedCapabilities).size, profile.recommendedCapabilities.length);

    const importTemplate = profile.importExample[9];
    const importPolicy = profile.importExample[10];
    const importSurfaces = profile.importExample[13].split("|").filter(Boolean);
    assert.ok(profile.recommendedTemplates.includes(importTemplate as any), `${archetype} import example is not recommended`);
    assert.equal(productTemplateDefaults(importTemplate).stockPolicy, importPolicy, `${archetype} import policy drifts from its template`);
    assert.ok(importSurfaces.every((surface) => PRODUCT_SALES_SURFACES.includes(surface as any)));

    const exampleInput = {
      sku: profile.importExample[0],
      barcode: profile.importExample[1] || null,
      name: profile.importExample[2],
      description: profile.importExample[3] || null,
      price: profile.importExample[4],
      cost_price: profile.importExample[5] || null,
      category: profile.importExample[6] || null,
      brand: profile.importExample[7] || null,
      keywords: profile.importExample[8].split("|").filter(Boolean),
      creation_template: importTemplate,
      stock_policy: importPolicy,
      base_unit: profile.importExample[11],
      variant_codes: profile.importExample[12].split("|").filter(Boolean),
      sales_surfaces: importSurfaces,
    };
    assert.doesNotThrow(() => validateProductFields(exampleInput), `${archetype} import example has invalid product fields`);
    assert.doesNotThrow(
      () => validateProductConfigurationFields(exampleInput),
      `${archetype} import example has invalid product configuration`
    );
  }
});

test("special operating modes stay explicit and restrictive", () => {
  assert.equal(shopExperienceForArchetype("pharmacy").specialMode, "PHARMACY");
  assert.equal(shopExperienceForArchetype("restaurant").specialMode, "RESTAURANT");
  for (const archetype of ARCHETYPES.filter((value) => !["pharmacy", "restaurant"].includes(value))) {
    assert.equal(shopExperienceForArchetype(archetype).specialMode, "NONE");
  }
  assert.deepEqual(shopExperienceForArchetype("restaurant").primarySalesSurfaces,
    ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"]);
  assert.ok(!shopExperienceForArchetype("mini_mart").primarySalesSurfaces.includes("RESTAURANT_POS"));
  assert.ok(!shopExperienceForArchetype("fashion").primarySalesSurfaces.includes("RESTAURANT_POS"));
});

test("general retail and backend product defaults cannot drift apart", () => {
  const general = productTemplateDefaults("GENERAL");
  assert.deepEqual(general.surfaces, ["RETAIL_POS", "PUBLIC_STOREFRONT", "CUSTOMER_AI", "ONLINE_ORDER"]);
  for (const archetype of ARCHETYPES.filter((value) => value !== "restaurant")) {
    assert.ok(
      !shopExperienceForArchetype(archetype).primarySalesSurfaces.includes("RESTAURANT_POS"),
      `${archetype} unexpectedly defaults new products onto Restaurant POS`
    );
  }
  assert.deepEqual(productTemplateDefaults("READY_GOOD"), {
    stockPolicy: "DIRECT",
    baseUnit: "PIECE",
    surfaces: ["RESTAURANT_POS", "RETAIL_POS"],
    active: false,
  });
});

test("editing reconstructs the closest non-persistent creation template", () => {
  assert.equal(inferProductCreationTemplate("RECIPE", ["RESTAURANT_POS"]), "PREPARED_MENU");
  assert.equal(inferProductCreationTemplate("NON_STOCK", ["RESTAURANT_POS"]), "QUICK_MENU");
  assert.equal(inferProductCreationTemplate("DIRECT", []), "INGREDIENT");
  assert.equal(inferProductCreationTemplate("DIRECT", ["RESTAURANT_POS", "RETAIL_POS"]), "READY_GOOD");
  assert.equal(inferProductCreationTemplate("DIRECT", ["RETAIL_POS"]), "GENERAL");
  assert.equal(inferProductCreationTemplate("PACK", ["RESTAURANT_POS"]), "GENERAL");
});

test("mixed and unknown shops use the explicit safe profile", () => {
  assert.equal(shopExperienceForArchetype("other").archetype, "other");
  assert.equal(shopExperienceForArchetype(null).archetype, "other");
  assert.equal(shopExperienceForArchetype("unknown").archetype, "other");
  assert.deepEqual(shopExperienceForArchetype("other").recommendedCapabilities, []);
});

test("restaurant menus keep core fields and progressively reveal commercial fields", () => {
  const restaurant = shopExperienceForArchetype("restaurant");
  assert.deepEqual(productFormFieldVisibility(restaurant, "PREPARED_MENU"), {
    barcode: false,
    shippingWeight: false,
    brand: false,
    wholesalePriceTiers: false,
  });
  assert.deepEqual(productFormFieldVisibility(restaurant, "READY_GOOD"), {
    barcode: true,
    shippingWeight: true,
    brand: true,
    wholesalePriceTiers: false,
  });
  assert.ok(Object.values(productFormFieldVisibility(restaurant, "PREPARED_MENU", true)).every(Boolean));

  const fashion = shopExperienceForArchetype("fashion");
  assert.deepEqual(productFormFieldVisibility(fashion, "GENERAL"), {
    barcode: true,
    shippingWeight: true,
    brand: true,
    wholesalePriceTiers: true,
  });

  const productUi = source("apps/web/app/(admin)/admin/products/page.tsx");
  assert.match(productUi, /setShowRestaurantAdditionalFields\(Boolean\(/,
    "editing a product with existing commercial data must reveal those fields");
  assert.match(productUi, /productFieldVisibility\.wholesalePriceTiers/);
  assert.match(productUi, /disabled=\{loading\}[\s\S]*?onClick=\{openCreate\}/,
    "archetype-dependent creation defaults must not be available before profile loading finishes");
});

test("the global sidebar uses bounded feature checks instead of the full capability scan", () => {
  const sidebar = source("apps/web/components/AdminSidebar.tsx");
  assert.doesNotMatch(sidebar, /bmsStoreCapabilities/);
  assert.match(sidebar, /bmsWastageEnabled/);
  assert.match(sidebar, /bmsPackToolsConfigured/);

  const resolvers = source("apps/web/graphql/bmsStockCapabilities.ts");
  assert.match(resolvers, /async bmsWastageEnabled/);
  assert.match(resolvers, /async bmsPackToolsConfigured/);
  assert.match(resolvers, /AND \(NOT is_base OR barcode IS NOT NULL\)/);
  assert.match(resolvers, /FROM bms_products[\s\S]*?AND barcode IS NOT NULL/,
    "a product barcode must keep Product labels discoverable without a pack row");
  assert.match(resolvers, /stock_policy IN \('PACK', 'BUNDLE'\)/,
    "an unfinished pack model must keep its configuration route discoverable");

  // The archetype/capability guards moved into lib/bms/adminNavigation.ts, which
  // scripts/admin-navigation-contract.test.mts exercises by calling them. What still belongs here
  // is that the shell feeds those guards the real signals rather than re-deriving them.
  assert.match(sidebar, /wastageEnabled: bootstrapData\?\.bmsWastageEnabled === true/);
  assert.match(sidebar, /packToolsConfigured: bootstrapData\?\.bmsPackToolsConfigured === true/);
  assert.match(sidebar, /archetype: bootstrapData\?\.bmsStoreProfile\?\.businessArchetype \?\? null/);

  const navigation = source("apps/web/lib/bms/adminNavigation.ts");
  assert.match(navigation, /recommendedCapabilities[\s\S]*?"PACK"[\s\S]*?"MULTI_BARCODE"/,
    "pack tools must stay reachable for an archetype that recommends them, before any pack exists");
  assert.match(navigation, /showWastageInNavigation/);
});

test("status-only capabilities distinguish recommendation from real configuration", () => {
  const recommendedButUnused = resolveStoreCapabilityState({
    capability: "PACK",
    preset: true,
    configured: false,
  });
  assert.equal(recommendedButUnused.gating, false);
  assert.equal(recommendedButUnused.enabled, false);
  assert.equal(recommendedButUnused.configured, false);
  assert.equal(recommendedButUnused.status, "AVAILABLE");
  assert.equal(recommendedButUnused.source, "PRESET");

  const usedOutsidePreset = resolveStoreCapabilityState({
    capability: "PACK",
    preset: false,
    configured: true,
  });
  assert.equal(usedOutsidePreset.enabled, true);
  assert.equal(usedOutsidePreset.configured, true);
  assert.equal(usedOutsidePreset.status, "CONFIGURED");
  assert.equal(usedOutsidePreset.source, "DETECTED");

  const disabledRecipe = resolveStoreCapabilityState({
    capability: "RECIPE",
    preset: true,
    override: { enabled: false, config: {}, source: "MANUAL" },
    configured: true,
  });
  assert.equal(disabledRecipe.gating, true);
  assert.equal(disabledRecipe.enabled, false);
  assert.equal(disabledRecipe.configured, false);
  assert.equal(disabledRecipe.status, "AVAILABLE");
  assert.equal(disabledRecipe.source, "MANUAL");
});

test("saving a legacy profile does not erase its AI business type before archetype selection", () => {
  const profile = source("apps/web/app/(admin)/admin/settings/StoreProfileCard.tsx");
  assert.match(profile, /v\.businessArchetype\s*\?\s*archetypeToBusinessType\(v\.businessArchetype\)\s*:\s*\(v\.businessType \?\? null\)/);
  assert.match(profile, /value \? archetypeToBusinessType\(value\) : null/);
});
