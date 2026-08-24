import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("supplier mapping schema is tenant-scoped and keeps PO snapshots", async () => {
  const sql = await read("db/migrations/9.18__bms_supplier_product_mapping.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_supplier_products/i);
  assert.match(sql, /FOREIGN KEY \(tenant_id, supplier_id\)/i);
  assert.match(sql, /FOREIGN KEY \(tenant_id, product_sku\)/i);
  assert.match(sql, /lower\(supplier_sku\)/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY bms_supplier_products_tenant_isolation/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_supplier_products TO bms_app/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS supplier_sku TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS supplier_product_name TEXT/i);
});

test("PO creation maps supplier identity without changing stock identity", async () => {
  const service = await read("apps/web/lib/bms/purchase.ts");
  assert.match(service, /INSERT INTO bms_supplier_products/);
  assert.match(service, /SUPPLIER_SKU_CONFLICT/);
  assert.match(service, /INSERT INTO bms_purchase_order_items[\s\S]*supplier_sku, supplier_product_name/);
  assert.match(service, /INSERT INTO bms_inventory[\s\S]*product_sku, size/);
  assert.match(service, /listSupplierProducts/);
});

test("GraphQL and admin PO surface expose both shop and supplier identities", async () => {
  const [schema, resolver, page] = await Promise.all([
    read("apps/web/graphql/typeDefs.ts"),
    read("apps/web/graphql/bmsPurchase.ts"),
    read("apps/web/app/(admin)/admin/purchase/page.tsx"),
  ]);
  assert.match(schema, /bmsSupplierProducts\(supplierId: ID!/);
  assert.match(schema, /supplierSku: String/);
  assert.match(resolver, /requirePermission\(ctx, "purchase\.view"\)[\s\S]*listSupplierProducts/);
  assert.match(page, /Q_SUPPLIER_PRODUCTS/);
  assert.match(page, /shop_sku_placeholder/);
  assert.match(page, /supplier_sku_placeholder/);
  assert.match(page, /variants \{ size \}/, "PO query must load the product's available sizes");
  assert.match(page, /const sizeOptions = \[\.\.\.new Set/, "PO form must derive unique size choices per SKU");
  assert.match(page, /<AutoComplete[\s\S]*options=\{sizeOptions\}/, "size must be selectable while still allowing a new value");
  assert.match(page, /setFieldValue\(\["items", name, "size"\], undefined\)/,
    "changing SKU must clear a stale size from the previous product");
});
