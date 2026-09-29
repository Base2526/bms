import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __devSeedSampleCatalogTest } from "../apps/web/lib/bms/devSeed";
import { __sampleDataTest } from "../apps/web/lib/bms/sampleData";
import {
  ONBOARDING_SAMPLE_IMAGE_PRODUCTS,
  STARTER_SAMPLE_IMAGE_PRODUCTS,
  onboardingSampleImageUrl,
} from "../apps/web/lib/bms/sampleCatalogImages";
import { RESTAURANT_MENU } from "../apps/web/lib/bms/restaurantCatalogSeed";
import {
  isShopArchetypeAvailableForNewInstall,
  isValidShopArchetype,
  normalizeShopArchetype,
  SHOP_ARCHETYPE_OPTIONS,
} from "../apps/web/lib/bms/shopArchetypes";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readBytes = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const json = (path: string) => JSON.parse(read(path));
const archetypeManifest = json("packages/retail-local-contract/shop-archetypes.json");

test("the versioned archetype manifest is the installer catalog authority", () => {
  const manifest = archetypeManifest;
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.defaultArchetype, "mini_mart");
  const ids = manifest.archetypes.map((entry: { id: string }) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    manifest.archetypes
      .filter((entry: { enabledForNewInstall: boolean; deprecated: boolean }) => entry.enabledForNewInstall && !entry.deprecated)
      .map((entry: { id: string }) => entry.id)
      .sort(),
    SHOP_ARCHETYPE_OPTIONS.map((option) => option.value).sort()
  );
  assert.equal(isValidShopArchetype("mini_mart"), true);
  assert.equal(isShopArchetypeAvailableForNewInstall("mini_mart"), true);
  assert.equal(isValidShopArchetype("not_a_shop_type"), false);
  assert.equal(normalizeShopArchetype("not_a_shop_type"), null);

  const aiEval = read("scripts/ai-eval/run.mjs");
  assert.match(aiEval, /packages\/retail-local-contract\/shop-archetypes\.json/);
  assert.doesNotMatch(aiEval, /const SHOP_ARCHETYPE_OPTIONS = \[\s*["']mini_mart/);
});

test("Starter Catalog covers every supported shop archetype with a bounded draft catalog", () => {
  const archetypes = archetypeManifest.archetypes.map((entry: { id: string }) => entry.id).sort();
  assert.deepEqual(Object.keys(__sampleDataTest.catalogs).sort(), archetypes);

  for (const archetype of archetypes) {
    const products = __sampleDataTest.catalogs[archetype];
    assert.equal(products.length, 4, `${archetype} must have exactly four examples`);
    assert.deepEqual(
      products.map((product) => product.name),
      STARTER_SAMPLE_IMAGE_PRODUCTS[archetype],
      `${archetype} Starter Catalog names must stay bound to their product images`
    );
    assert.equal(new Set(products.map((product) => product.code)).size, products.length);
    for (const product of products) {
      assert.ok(product.name.includes("ตัวอย่าง"), `${archetype}/${product.code} must be visibly labelled`);
      assert.ok(product.price >= 0);
      assert.ok(product.cost >= 0);
      assert.ok(!product.surfaces?.includes("PUBLIC_STOREFRONT"));
      assert.ok(!product.surfaces?.includes("CUSTOMER_AI"));
      assert.ok(!product.surfaces?.includes("ONLINE_ORDER"));
    }
  }
});

test("every sample product shown during onboarding has a bundled product-specific image", () => {
  const archetypes = archetypeManifest.archetypes.map((entry: { id: string }) => entry.id);
  const hashes = new Set<string>();

  const verifyImage = (imageUrl: string, context: string) => {
    assert.match(imageUrl, /^\/sample\/(?:catalog|starter)\/[a-z0-9_]+\/\d{2}\.jpg$/, `${context} must use a local sample image`);
    const bytes = readBytes(`apps/web/public${imageUrl}`);
    assert.ok(bytes.length > 3_000, `${context} image is unexpectedly small`);
    assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xff, 0xd8, 0xff], `${context} must be a JPEG`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.ok(!hashes.has(hash), `${context} reuses another product image`);
    hashes.add(hash);
  };

  for (const archetype of archetypes) {
    const starterProducts = __sampleDataTest.catalogs[archetype];
    starterProducts.forEach((product) => {
      const imageUrl = __sampleDataTest.imageUrlFor(archetype, product.name);
      assert.ok(imageUrl, `${archetype}/${product.code} is missing its Starter Catalog image`);
      verifyImage(imageUrl, `starter ${archetype}/${product.code}`);
    });

    if (archetype === "restaurant") {
      assert.ok(RESTAURANT_MENU.length >= 12);
      RESTAURANT_MENU.slice(0, 12).forEach((product) => {
        assert.ok(product.sampleImageUrl, `restaurant/${product.code} is missing its onboarding image`);
        const bytes = readBytes(`apps/web/public${product.sampleImageUrl}`);
        assert.ok(bytes.length > 4_000, `restaurant/${product.code} image is unexpectedly small`);
        assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xff, 0xd8, 0xff]);
        const hash = createHash("sha256").update(bytes).digest("hex");
        assert.ok(!hashes.has(hash), `restaurant/${product.code} reuses another product image`);
        hashes.add(hash);
      });
      continue;
    }

    const catalog = __devSeedSampleCatalogTest.catalogs[archetype];
    const expectedProductNames = ONBOARDING_SAMPLE_IMAGE_PRODUCTS[archetype];
    assert.ok(catalog, `${archetype} must have a curated onboarding catalog`);
    assert.ok(expectedProductNames, `${archetype} must have an onboarding image manifest`);
    assert.deepEqual(
      catalog.slice(0, expectedProductNames.length).map((product) => product.name),
      expectedProductNames,
      `${archetype} onboarding product names must stay bound to their images`
    );
    for (const productName of expectedProductNames) {
      const imageUrl = onboardingSampleImageUrl(archetype, productName);
      assert.ok(imageUrl, `${archetype}/${productName} is missing its onboarding image`);
      verifyImage(imageUrl, `onboarding ${archetype}/${productName}`);
    }
  }

  const seed = read("apps/web/lib/bms/devSeed.ts");
  assert.doesNotMatch(seed, /picsum\.photos/);
  assert.match(seed, /onboardingSampleImageUrl\(archetype!, item\.name\)/);
  for (const archetype of archetypes.filter((value: string) => value !== "restaurant")) {
    assert.match(seed, new RegExp(`\\n  ${archetype}: \\[`), `${archetype} must have a curated onboarding catalog`);
  }
});

test("regulated and specialised archetypes keep their domain boundaries", () => {
  const pharmacy = __sampleDataTest.catalogs.pharmacy.map((product) => `${product.code} ${product.name}`).join(" ");
  assert.doesNotMatch(pharmacy, /พารา|ยาแก้|antibiotic|dosage/i);
  assert.ok(__sampleDataTest.catalogs.pharmacy.every((product) => /ไม่ใช่คำแนะนำ|ต้อง/.test(product.description)));

  const boardGame = __sampleDataTest.catalogs.board_game_cafe;
  assert.ok(boardGame.every((product) => !/TIME|SESSION|MEMBER|GAME-COPY/.test(product.code)));

  const restaurant = __sampleDataTest.catalogs.restaurant;
  assert.ok(restaurant.some((product) => product.stockPolicy === "RECIPE"));
  assert.ok(restaurant.some((product) => product.surfaces?.length === 0));
});

test("sample ownership is registry-backed, tenant-scoped, and cleanup is guarded", () => {
  const migration = read("db/migrations/10.26__bms_sample_data_lifecycle.sql");
  const service = read("apps/web/lib/bms/sampleData.ts");
  const route = read("apps/web/app/api/bms/onboarding/sample-data/route.ts");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_sample_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_sample_records/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('bms\.tenant_id'/);
  assert.match(service, /record\.sample_run_id = \$2/);
  assert.match(service, /product\.modified \|\| product\.referenced \|\| product\.converted/);
  assert.match(service, /status\.blocked/);
  assert.match(service, /DELETE FROM bms_products[\s\S]*tenant_id = \$1 AND sku = ANY/);
  assert.doesNotMatch(service, /DELETE FROM bms_products[\s\S]*LIKE ['"]SAMPLE/);
  assert.match(route, /authorizeAdminRoute\("product\.edit"\)/);
  assert.match(route, /confirmation !== "DELETE SAMPLE"/);
});

test("first-run installers pass shop type and optional Starter Catalog explicitly", () => {
  const service = read("apps/web/lib/bms/localProvisioning.ts");
  const runner = read("apps/web/scripts/retail-local-provision.mts");
  const sampleRunner = read("apps/web/scripts/retail-local-sample-data.mts");
  const compose = read("deploy/retail-local/compose.yml");
  const managedCompose = read("deploy/retail-local/managed-runtime/compose.managed.yml");
  const windows = read("deploy/retail-local/install.ps1");
  const linux = read("deploy/retail-local/linux-offline/bms-retail-local-setup");
  const managedWindows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const managedLinux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const pack = read("deploy/retail-local/package.ps1");
  const signer = read("deploy/retail-local/managed-runtime/sign-release.mjs");
  const signup = read("apps/web/lib/bms/signup.ts");
  const storeProfile = read("apps/web/lib/bms/storeProfile.ts");

  assert.match(service, /normalizeShopArchetype\(input\.businessArchetype/);
  assert.match(service, /archetypeToBusinessType\(businessArchetype\)/);
  assert.doesNotMatch(service, /VALUES \(\$1, 'general', 'mini_mart'\)/);
  assert.match(runner, /sampleMode === "STARTER_CATALOG"/);
  assert.match(sampleRunner, /createOnboardingSampleData/);
  assert.match(sampleRunner, /status: "FAILED"/);
  for (const content of [compose, managedCompose]) {
    assert.match(content, /BMS_LOCAL_BUSINESS_ARCHETYPE/);
    assert.match(content, /BMS_LOCAL_SAMPLE_MODE/);
  }
  for (const content of [windows, linux, managedWindows, managedLinux]) {
    assert.match(content, /shop-archetypes/);
    assert.match(content, /enabledForNewInstall/);
    assert.match(content, /deprecated/);
    assert.match(content, /STARTER_CATALOG/);
  }
  assert.match(pack, /packages\\retail-local-contract\\shop-archetypes\.json/);
  assert.match(pack, /shopArchetypes/);
  assert.match(signer, /\["shop-archetypes", "support-file"\]/);
  assert.doesNotMatch(windows, /ValidateSet\("mini_mart"/);
  assert.match(signup, /isValidShopArchetype\(businessArchetype\)/);
  assert.match(storeProfile, /isShopArchetypeAvailableForNewInstall\(merged\.businessArchetype\)/);
});
