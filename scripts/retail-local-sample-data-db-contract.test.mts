import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  createStarterCatalog,
  deleteSampleData,
  SampleDataError,
} from "../apps/web/lib/bms/sampleData.ts";

const tag = `sample-data-${process.pid}-${Date.now()}`;
let tenantId = "";

test("setup a throwaway shop", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${tag}`, `fake-${tag}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_type, business_archetype)
     VALUES ($1,'fashion','fashion')`,
    [tenantId]
  );
  await query(
    `INSERT INTO bms_locations (tenant_id, code, name, is_head_office)
     VALUES ($1,'MAIN',$2,TRUE)`,
    [tenantId, `FAKE ${tag} main`]
  );
});

test("Starter Catalog creates only inactive, zero-stock, non-online examples and deletes them as one set", async () => {
  const sample = await createStarterCatalog(tenantId);
  assert.equal(sample.status, "ACTIVE");
  assert.equal(sample.archetype, "fashion");
  assert.equal(sample.products.length, 4);
  assert.equal(sample.blocked, false);

  const products = await query<{
    active: boolean;
    current_stock: string;
    image_url: string | null;
    online_surfaces: string;
  }>(
    `SELECT product.active,
            product.image_url,
            COALESCE(sum(inventory.current_stock), 0)::text AS current_stock,
            count(surface.*) FILTER (
              WHERE surface.surface IN ('PUBLIC_STOREFRONT','CUSTOMER_AI','ONLINE_ORDER')
            )::text AS online_surfaces
       FROM bms_products product
       LEFT JOIN bms_inventory inventory
         ON inventory.tenant_id = product.tenant_id AND inventory.product_sku = product.sku
       LEFT JOIN bms_product_sales_surfaces surface
         ON surface.tenant_id = product.tenant_id AND surface.product_sku = product.sku
      WHERE product.tenant_id = $1 AND product.sku LIKE 'SAMPLE-%'
      GROUP BY product.sku, product.active, product.image_url`,
    [tenantId]
  );
  assert.equal(products.rowCount, 4);
  assert.ok(products.rows.every((row) => row.active === false));
  assert.ok(products.rows.every((row) => Number(row.current_stock) === 0));
  assert.ok(products.rows.every((row) => Number(row.online_surfaces) === 0));
  assert.ok(products.rows.every((row) => /^\/sample\/starter\/fashion\/\d{2}\.jpg$/.test(row.image_url ?? "")));

  const deleted = await deleteSampleData(tenantId);
  assert.equal(deleted.deletedProducts, 4);
  assert.equal(Number((await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms_products WHERE tenant_id = $1 AND sku LIKE 'SAMPLE-%'`,
    [tenantId]
  )).rows[0].count), 0);
});

test("cleanup refuses all deletion after one sample product becomes real data", async () => {
  const sample = await createStarterCatalog(tenantId);
  const changedSku = sample.products[0].sku;
  await query(
    `UPDATE bms_products SET description = description || ' แก้ไขโดยร้าน', updated_at = now()
      WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, changedSku]
  );

  await assert.rejects(
    () => deleteSampleData(tenantId),
    (error: unknown) => error instanceof SampleDataError && error.code === "BLOCKED"
  );
  assert.equal(Number((await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms_products WHERE tenant_id = $1 AND sku LIKE 'SAMPLE-%'`,
    [tenantId]
  )).rows[0].count), 4, "cleanup must be all-or-nothing");
});

test("teardown the throwaway shop", async () => {
  if (!tenantId) return;
  // The product -> tenant FK intentionally predates ON DELETE CASCADE. Delete
  // product roots first; their owned catalog/inventory rows cascade from there.
  await query(`DELETE FROM bms_products WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_tenants WHERE id = $1`, [tenantId]);
});
