// Database-free contract for the archetype-aware admin experience.
// Run from apps/web: npx tsx --test ../../scripts/shop-archetype-experience-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "../apps/web/node_modules/xlsx/xlsx.mjs";

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
  PRODUCT_IMPORT_TEMPLATE_COLUMNS,
  PRODUCT_IMPORT_TEMPLATE_HEADERS,
  parseProductImportWorksheet,
  productImportExampleToInput,
  selectProductImportSheetName,
} from "../apps/web/lib/bms/productImportTemplate.ts";
import { buildProductImportWorkbook, parseProductImportWorkbook } from "../apps/web/lib/bms/productImportWorkbook.ts";
import { checkBarcode } from "../apps/web/lib/bms/barcode.ts";
import { PRODUCT_STOCK_POLICIES } from "../apps/web/lib/bms/productStockPolicyOptions.ts";
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
    assert.ok(profile.importExamples.length > 0, `${archetype} has no import examples`);
    assert.ok((en as any).shop_archetypes[profile.descriptionKey.split(".").at(-1)!]);
    assert.ok((th as any).shop_archetypes[profile.descriptionKey.split(".").at(-1)!]);

    const templatePartition = [...profile.recommendedTemplates, ...additionalProductTemplates(profile)].sort();
    assert.deepEqual(templatePartition, [...PRODUCT_CREATION_TEMPLATES].sort(), `${archetype} does not partition every template exactly once`);
    assert.ok(profile.recommendedCapabilities.every((capability) => CAPABILITIES.has(capability)));
    assert.ok(profile.primarySalesSurfaces.every((surface) => PRODUCT_SALES_SURFACES.includes(surface)));
    assert.equal(new Set(profile.recommendedTemplates).size, profile.recommendedTemplates.length);
    assert.equal(new Set(profile.recommendedCapabilities).size, profile.recommendedCapabilities.length);

    const exampleSkus = new Set<string>();
    for (const example of profile.importExamples) {
      assert.equal(example.length, PRODUCT_IMPORT_TEMPLATE_COLUMNS.length,
        `${archetype} import example does not match the template columns`);
      const exampleInput = productImportExampleToInput(example);
      if (exampleInput.barcode) assert.equal(checkBarcode(exampleInput.barcode).kind, "VALID");
      const importTemplate = exampleInput.creation_template!;
      const importPolicy = exampleInput.stock_policy!;
      const importSurfaces = exampleInput.sales_surfaces ?? [];
      assert.ok(profile.recommendedTemplates.includes(importTemplate as any), `${archetype} import example is not recommended`);
      assert.ok(PRODUCT_STOCK_POLICIES.includes(importPolicy as any), `${archetype} import policy is unknown`);
      assert.ok(importSurfaces.every((surface) => PRODUCT_SALES_SURFACES.includes(surface as any)));
      assert.ok(!exampleSkus.has(exampleInput.sku), `${archetype} repeats SKU ${exampleInput.sku}`);
      exampleSkus.add(exampleInput.sku);
      assert.doesNotThrow(() => validateProductFields(exampleInput), `${archetype} import example has invalid product fields`);
      assert.doesNotThrow(
        () => validateProductConfigurationFields(exampleInput),
        `${archetype} import example has invalid product configuration`
      );
    }
  }
});

test("import examples model the archetype-specific product structure", () => {
  const inputs = (archetype: string) => shopExperienceForArchetype(archetype).importExamples.map(productImportExampleToInput);
  const input = (archetype: string) => inputs(archetype)[0]!;

  assert.deepEqual(input("home_kitchen").variant_codes, ["24CM", "28CM"]);
  assert.deepEqual(input("beauty_personal_care").variant_codes, ["15ML", "30ML"]);
  assert.deepEqual(input("b2b_wholesale").variant_codes, ["70GSM", "80GSM"]);
  assert.equal(input("b2b_wholesale").base_unit, "REAM");
  assert.equal(input("gifts_seasonal").stock_policy, "BUNDLE");
  assert.deepEqual(input("pet_supply").variant_codes, ["1KG", "3KG"]);
  assert.equal(input("building_materials").base_unit, "BAG");
  assert.deepEqual(input("board_game_cafe").variant_codes, ["STANDARD", "JAPANESE"]);

  const restaurantRows = inputs("restaurant");
  const restaurant = restaurantRows.find((row) => row.creation_template === "PREPARED_MENU")!;
  assert.equal(restaurant.creation_template, "PREPARED_MENU");
  assert.equal(restaurant.stock_policy, "RECIPE");
  assert.deepEqual(restaurant.sales_surfaces, ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"]);
  assert.deepEqual(
    restaurantRows.map((row) => row.creation_template).sort(),
    ["INGREDIENT", "PREPARED_MENU", "QUICK_MENU", "READY_GOOD"]
  );

  const examples = ARCHETYPES.map((archetype) => JSON.stringify(shopExperienceForArchetype(archetype).importExamples));
  assert.equal(new Set(examples).size, ARCHETYPES.length,
    "each shop archetype must download a distinct set of example rows");
});

test("downloaded examples cover every supported import mode and column", () => {
  const examples = ARCHETYPES.flatMap((archetype) => shopExperienceForArchetype(archetype).importExamples);
  const inputs = examples.map(productImportExampleToInput);

  assert.deepEqual(
    Array.from(new Set(inputs.map((input) => input.creation_template))).sort(),
    [...PRODUCT_CREATION_TEMPLATES].sort(),
    "the example set must cover every product creation template"
  );
  assert.deepEqual(
    Array.from(new Set(inputs.map((input) => input.stock_policy))).sort(),
    [...PRODUCT_STOCK_POLICIES].sort(),
    "the example set must cover every stock policy"
  );
  assert.deepEqual(
    Array.from(new Set(inputs.flatMap((input) => input.sales_surfaces ?? []))).sort(),
    [...PRODUCT_SALES_SURFACES].sort(),
    "the example set must cover every sales surface"
  );
  for (const [index, column] of PRODUCT_IMPORT_TEMPLATE_COLUMNS.entries()) {
    assert.ok(examples.some((example) => String(example[index] ?? "").trim()),
      `column ${column.header} has no populated example`);
  }
});

test("the downloaded workbook schema has unique headers and complete required fields", () => {
  const normalizedHeaders = PRODUCT_IMPORT_TEMPLATE_COLUMNS.map(({ header }) => header.trim().toLowerCase());
  assert.equal(new Set(normalizedHeaders).size, normalizedHeaders.length);
  assert.deepEqual(
    PRODUCT_IMPORT_TEMPLATE_COLUMNS.filter(({ required }) => required).map(({ field }) => field),
    ["sku", "name", "price"]
  );
});

test("every archetype XLSX round-trips through the real import parser and service validators", () => {
  for (const archetype of ARCHETYPES) {
    const examples = shopExperienceForArchetype(archetype).importExamples;
    const workbook = buildProductImportWorkbook(examples, archetype);
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const reopened = XLSX.read(bytes, { type: "buffer" });
    assert.deepEqual(reopened.SheetNames, ["Products", "Examples", "Guide"]);
    const productsSheet = reopened.Sheets.Products;
    const examplesSheet = reopened.Sheets.Examples;
    assert.ok(productsSheet, `${archetype} workbook lost its Products sheet`);
    assert.ok(examplesSheet, `${archetype} workbook lost its Examples sheet`);
    const blankProducts = XLSX.utils.sheet_to_json<unknown[]>(productsSheet, { header: 1, raw: false, defval: "" });
    assert.deepEqual(blankProducts, [PRODUCT_IMPORT_TEMPLATE_HEADERS],
      `${archetype} Products sheet must not contain accidentally importable samples`);
    assert.deepEqual(parseProductImportWorksheet(blankProducts), []);

    const exampleAoa = XLSX.utils.sheet_to_json<unknown[]>(examplesSheet, { header: 1, raw: false, defval: "" });
    XLSX.utils.sheet_add_aoa(productsSheet, exampleAoa.slice(1), { origin: "A2" });
    const customerEditedBytes = XLSX.write(reopened, { type: "buffer", bookType: "xlsx" });
    const customerEdited = XLSX.read(customerEditedBytes, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(customerEdited.Sheets.Products!, { header: 1, raw: false, defval: "" });
    const parsedRows = parseProductImportWorkbook(customerEdited);
    assert.equal(parsedRows.length, examples.length, `${archetype} workbook lost example rows`);
    for (const [index, parsed] of parsedRows.entries()) {
      assert.equal(parsed.rowNumber, index + 2);
      assert.equal(parsed.sku, examples[index]![0], `${archetype} workbook changed its SKU`);
      assert.doesNotThrow(() => validateProductFields(parsed), `${archetype} failed imported product validation`);
      assert.doesNotThrow(() => validateProductConfigurationFields(parsed), `${archetype} failed imported configuration validation`);
    }
  }
});

test("the importer selects Products even when workbook tabs are reordered", () => {
  assert.equal(selectProductImportSheetName(["Guide", "Examples", "Products"]), "Products");
  assert.equal(selectProductImportSheetName(["Sheet1"]), "Sheet1", "CSV and legacy one-sheet files keep working");
  assert.equal(selectProductImportSheetName([]), null);
});

test("every downloaded example reaches the real backend import preview without row errors", async () => {
  const pool = (globalThis as any).__bmsPostgresPool;
  const savedQuery = pool.query;
  const savedDeployment = process.env.BMS_DEPLOYMENT_MODE;
  pool.query = async (sql: string) => {
    assert.match(sql, /SELECT p.sku, s.stock_policy, s.base_unit FROM bms_products p/);
    return { rows: [], rowCount: 0 };
  };
  process.env.BMS_DEPLOYMENT_MODE = "retail-local";
  try {
    const { runImport } = await import("../apps/web/lib/bms/productImport.ts");
    const rows = ARCHETYPES
      .flatMap((archetype) => shopExperienceForArchetype(archetype).importExamples)
      .map((example, index) => ({ rowNumber: index + 2, ...productImportExampleToInput(example) }));
    const result = await runImport("template-contract", rows, { commit: false });
    assert.equal(result.errorCount, 0);
    assert.equal(result.updateCount, 0);
    assert.equal(result.createCount, rows.length);
    assert.equal(result.rows.length, rows.length);
    assert.ok(result.rows.every((row) => row.action === "CREATE" && row.error === null));
  } finally {
    pool.query = savedQuery;
    if (savedDeployment == null) delete process.env.BMS_DEPLOYMENT_MODE;
    else process.env.BMS_DEPLOYMENT_MODE = savedDeployment;
  }
});

test("import errors identify the exact headers to fix and variant spelling is preserved", () => {
  assert.throws(
    () => parseProductImportWorksheet([["SKU", "ราคาขาย"]]),
    (error: unknown) => error instanceof Error
      && (error as any).code === "MISSING_HEADERS"
      && (error as any).headers.includes("ชื่อสินค้า")
  );
  assert.throws(
    () => parseProductImportWorksheet([["SKU", "SKU", "ชื่อสินค้า", "ราคาขาย"]]),
    (error: unknown) => error instanceof Error
      && (error as any).code === "DUPLICATE_HEADERS"
      && (error as any).headers.includes("sku")
  );
  const mixedCase = [...shopExperienceForArchetype("fashion").importExamples[0]!];
  mixedCase[12] = "Small|Medium|XL";
  const [parsed] = parseProductImportWorksheet([PRODUCT_IMPORT_TEMPLATE_HEADERS, mixedCase]);
  assert.deepEqual(parsed.variant_codes, ["Small", "Medium", "XL"]);

  const blankPrice = [...shopExperienceForArchetype("fashion").importExamples[0]!];
  blankPrice[4] = "";
  const [missingRequiredCell] = parseProductImportWorksheet([PRODUCT_IMPORT_TEMPLATE_HEADERS, blankPrice]);
  assert.throws(
    () => validateProductFields(missingRequiredCell!),
    /คอลัมน์ ราคาขาย.*0 ขึ้นไป/,
    "a blank required price cell must not silently become zero"
  );
});

test("row validation errors name the column, rejected value class, and corrective action", () => {
  const valid = productImportExampleToInput(shopExperienceForArchetype("fashion").importExamples[0]!);
  assert.throws(() => validateProductFields({ ...valid, sku: "" }), /คอลัมน์ SKU.*ไม่ซ้ำ/);
  assert.throws(() => validateProductFields({ ...valid, name: "" }), /คอลัมน์ ชื่อสินค้า.*ห้ามว่าง/);
  assert.throws(() => validateProductFields({ ...valid, price: Number.NaN }), /คอลัมน์ ราคาขาย.*0 ขึ้นไป/);
  assert.throws(
    () => validateProductConfigurationFields({ ...valid, stock_policy: "WRONG" as any }),
    /คอลัมน์ Stock Policy.*WRONG.*ชีต Guide/
  );
  assert.throws(
    () => validateProductConfigurationFields({ ...valid, sales_surfaces: ["WRONG"] as any }),
    /ช่องทางขายไม่ถูกต้อง: WRONG/
  );
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
