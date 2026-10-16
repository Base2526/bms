import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { upsertProduct } from "../apps/web/lib/bms/products.ts";

const tag = `phase6-${process.pid}-${Date.now()}`;
const valid = "4006381333931";
let tenantId = "";

test.before(async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`, [`FAKE ${tag}`, tag],
  )).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,business_type,barcode_master_contribution_enabled) VALUES($1,'general',FALSE)`, [tenantId]);
});
test.after(async () => {
  await query(`DELETE FROM bms_master_barcodes WHERE barcode=$1`, [valid]);
  if (tenantId) await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]);
});
test("shop disabled and unchecked saves do not submit candidates", async () => {
  await upsertProduct(tenantId, { sku:`FAKE-${tag}-OFF`, name:"Off", price:1, barcode:valid, confirm_barcode_master:true });
  assert.equal(Number((await query(`SELECT count(*) FROM bms_master_barcodes WHERE barcode=$1`, [valid])).rows[0].count), 0);
  await query(`UPDATE bms_store_profile SET barcode_master_contribution_enabled=TRUE WHERE tenant_id=$1`, [tenantId]);
  await upsertProduct(tenantId, { sku:`FAKE-${tag}-OFF`, name:"Off", price:1, barcode:valid, confirm_barcode_master:false });
  assert.equal(Number((await query(`SELECT count(*) FROM bms_master_barcodes WHERE barcode=$1`, [valid])).rows[0].count), 0);
});

test("an opted-in explicit confirmation creates one candidate per shop", async () => {
  await upsertProduct(tenantId, { sku:`FAKE-${tag}-OFF`, name:"Confirmed", price:999, cost_price:888, barcode:valid, brand:"Test", confirm_barcode_master:true });
  const row = (await query<any>(`SELECT * FROM bms_master_barcodes WHERE barcode=$1`, [valid])).rows[0];
  assert.equal(row.status, "CANDIDATE");
  assert.equal(row.confirmations, 1);
  assert.equal(row.name, "Confirmed");
  assert.equal("tenant_id" in row, false);
  assert.equal("price" in row, false);
  await upsertProduct(tenantId, { sku:`FAKE-${tag}-OFF`, name:"Confirmed again", price:2, barcode:valid, confirm_barcode_master:true });
  assert.equal(Number((await query(`SELECT confirmations FROM bms_master_barcodes WHERE barcode=$1`, [valid])).rows[0].confirmations), 1);
});

test("restricted internal codes are rejected even with both opt-ins", async () => {
  const code = "2000000000015";
  await upsertProduct(tenantId, { sku:`FAKE-${tag}-INTERNAL`, name:"Internal", price:1, barcode:code, confirm_barcode_master:true });
  assert.equal(Number((await query(`SELECT count(*) FROM bms_master_barcodes WHERE barcode=$1`, [code])).rows[0].count), 0);
});

