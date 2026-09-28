import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __sampleDataTest } from "../apps/web/lib/bms/sampleData";
import {
  isShopArchetypeAvailableForNewInstall,
  isValidShopArchetype,
  normalizeShopArchetype,
  SHOP_ARCHETYPE_OPTIONS,
} from "../apps/web/lib/bms/shopArchetypes";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
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
  assert.match(runner, /createStarterCatalog/);
  assert.match(runner, /sampleMode === "STARTER_CATALOG"/);
  assert.match(runner, /status: "FAILED"/);
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
