/**
 * Retail Local first-run sample-data matrix.
 *
 * This deliberately exercises the same `createOnboardingSampleData()` entry point used by the
 * Windows, Linux and macOS installers. Every shop is a disposable `test-*` tenant and is removed
 * through the production tenant cleanup service, even when an assertion fails.
 *
 * Run only against a local database:
 *   cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
 *     POSTGRES_PASSWORD=... npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
 *     --test --test-concurrency=1 ../../scripts/retail-local-onboarding-all-archetypes-db-contract.test.mts
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closeDatabasePool, query } from "../apps/web/lib/db.ts";
import { createOnboardingSampleData } from "../apps/web/lib/bms/onboardingSampleData.ts";
import { deleteTenant } from "../apps/web/lib/bms/platform.ts";
import { provisionTestShop } from "../apps/web/lib/bms/testShop.ts";
import { ONBOARDING_SAMPLE_IMAGE_PRODUCTS } from "../apps/web/lib/bms/sampleCatalogImages.ts";
import {
  archetypeNeedsRestockEmphasis,
  SHOP_ARCHETYPE_OPTIONS,
  type ShopArchetype,
} from "../apps/web/lib/bms/shopArchetypes.ts";
import { RESTAURANT_MENU } from "../apps/web/lib/bms/restaurantCatalogSeed.ts";

const BASE_STEPS = ["products", "customers", "orders", "conversations", "coupons", "purchase"];

function assertLocalDatabase() {
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(process.env.POSTGRES_HOST ?? ""),
    "local test DB required"
  );
  assert.ok(process.env.POSTGRES_DB, "an explicit test database is required");
}

type Counts = {
  products: string;
  customers: string;
  orders: string;
  conversations: string;
  coupons: string;
  purchases: string;
  restocks: string;
  areas: string;
  tables: string;
};

async function countsFor(tenantId: string): Promise<Counts> {
  return (await query<Counts>(
    `SELECT
       (SELECT count(*)::text FROM bms_products WHERE tenant_id = $1) AS products,
       (SELECT count(*)::text FROM bms_customers WHERE tenant_id = $1) AS customers,
       (SELECT count(*)::text FROM bms_orders WHERE tenant_id = $1) AS orders,
       (SELECT count(*)::text FROM bms_conversations WHERE tenant_id = $1) AS conversations,
       (SELECT count(*)::text FROM bms_coupons WHERE tenant_id = $1) AS coupons,
       (SELECT count(*)::text FROM bms_purchase_orders WHERE tenant_id = $1) AS purchases,
       (SELECT count(*)::text FROM bms_restock_subscriptions WHERE tenant_id = $1) AS restocks,
       (SELECT count(*)::text FROM bms_restaurant_areas WHERE tenant_id = $1) AS areas,
       (SELECT count(*)::text FROM bms_restaurant_tables WHERE tenant_id = $1) AS tables`,
    [tenantId]
  )).rows[0];
}

function expectedProductNames(archetype: ShopArchetype): readonly string[] {
  if (archetype === "restaurant") return RESTAURANT_MENU.slice(0, 12).map((item) => item.name);
  return ONBOARDING_SAMPLE_IMAGE_PRODUCTS[archetype] ?? [];
}

after(async () => {
  await closeDatabasePool();
});

test("Retail Local sample data completes for every enabled shop archetype", async (t) => {
  assertLocalDatabase();
  assert.equal(SHOP_ARCHETYPE_OPTIONS.length, 14, "the installer archetype matrix changed; update this contract");

  for (const { value: archetype } of SHOP_ARCHETYPE_OPTIONS) {
    await t.test(archetype, async (t) => {
      let tenantId: string | null = null;
      t.after(async () => {
        if (tenantId) await deleteTenant(tenantId).catch(() => void 0);
      });

      const shop = await provisionTestShop({
        name: `Retail Local ${archetype} sample contract`,
        businessArchetype: archetype,
      });
      tenantId = shop.tenantId;

      const result = await createOnboardingSampleData(tenantId);
      const expectedSteps = [
        ...BASE_STEPS,
        ...(archetypeNeedsRestockEmphasis(archetype) ? ["restock"] : []),
        ...(archetype === "restaurant" ? ["restaurant_layout"] : []),
      ];
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.archetype, archetype);
      assert.deepEqual(result.completedSteps, expectedSteps);

      const stored = (await query<{
        archetype: string;
        status: string;
        completed_steps: string[];
      }>(
        `SELECT archetype, status, completed_steps
           FROM bms_onboarding_seed_runs WHERE tenant_id = $1`,
        [tenantId]
      )).rows[0];
      assert.equal(stored.archetype, archetype);
      assert.equal(stored.status, "COMPLETED");
      assert.deepEqual(stored.completed_steps, expectedSteps);

      const products = await query<{
        name: string;
        image_url: string | null;
        retail_pos: string;
        restaurant_pos: string;
      }>(
        `SELECT product.name, product.image_url,
                count(surface.*) FILTER (
                  WHERE surface.surface = 'RETAIL_POS' AND surface.enabled
                )::text AS retail_pos,
                count(surface.*) FILTER (
                  WHERE surface.surface = 'RESTAURANT_POS' AND surface.enabled
                )::text AS restaurant_pos
           FROM bms_products product
           LEFT JOIN bms_product_sales_surfaces surface
             ON surface.tenant_id = product.tenant_id AND surface.product_sku = product.sku
          WHERE product.tenant_id = $1 AND product.active
          GROUP BY product.sku, product.name, product.image_url
          ORDER BY product.name`,
        [tenantId]
      );
      assert.equal(products.rowCount, 12, `${archetype} must create twelve active sample products`);
      assert.deepEqual(
        products.rows.map((row) => row.name).sort(),
        [...expectedProductNames(archetype)].sort(),
        `${archetype} created products from the wrong catalog`
      );
      assert.ok(
        products.rows.every((row) => row.image_url?.startsWith(
          archetype === "restaurant" ? "/sample/restaurant/" : `/sample/catalog/${archetype}/`
        )),
        `${archetype} must use its own bundled product images`
      );
      if (archetype === "restaurant") {
        assert.ok(products.rows.every((row) => row.restaurant_pos === "1" && row.retail_pos === "0"));
      } else {
        assert.ok(products.rows.every((row) => row.retail_pos === "1" && row.restaurant_pos === "0"));
      }

      const beforeReplay = await countsFor(tenantId);
      assert.equal(beforeReplay.products, "12");
      assert.equal(beforeReplay.customers, "10");
      // Some archetypes deliberately add recovery/restock scenarios on top of the requested base
      // fixtures. The contract is therefore a lower bound here; replay equality below is what
      // proves that a second installer launch does not append another scenario set.
      assert.ok(Number(beforeReplay.orders) >= 12, `${archetype} must create at least twelve orders`);
      assert.ok(Number(beforeReplay.conversations) >= 8, `${archetype} must create at least eight conversations`);
      assert.equal(beforeReplay.coupons, "3");
      assert.equal(beforeReplay.purchases, "6");
      assert.equal(
        beforeReplay.restocks,
        archetypeNeedsRestockEmphasis(archetype) ? "8" : "0",
        `${archetype} restock sample count is wrong`
      );
      assert.equal(beforeReplay.areas, archetype === "restaurant" ? "2" : "0");
      assert.equal(beforeReplay.tables, archetype === "restaurant" ? "8" : "0");

      const replay = await createOnboardingSampleData(tenantId);
      assert.equal(replay.status, "ALREADY_COMPLETED");
      assert.deepEqual(replay.completedSteps, expectedSteps);
      assert.deepEqual(await countsFor(tenantId), beforeReplay, `${archetype} replay created duplicate data`);

      await deleteTenant(tenantId);
      tenantId = null;
    });
  }
});
