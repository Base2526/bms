import assert from "node:assert/strict";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { applyStarterCategories } from "../apps/web/lib/bms/starterMasterData.ts";

const tag = `phase5-${process.pid}-${Date.now()}`;
let tenantId = "";
test.before(async () => {
  tenantId = (await query<{ id: string }>(`INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`, [`FAKE ${tag}`, tag])).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,business_type,business_archetype,country) VALUES($1,'fashion','fashion','TH')`, [tenantId]);
});
test.after(async () => { if (tenantId) await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]); });

test("apply twice does not grow and a local rename is not overwritten", async () => {
  const first = await applyStarterCategories(tenantId);
  assert.ok(first.createdCount > 0);
  const renamed = first.categories[0];
  await query(`UPDATE bms_product_categories SET name='ร้านแก้เอง' WHERE tenant_id=$1 AND id=$2`, [tenantId, renamed.id]);
  const second = await applyStarterCategories(tenantId);
  assert.equal(second.appliedCount, 0);
  assert.equal(second.createdCount, 0);
  const names = (await query<{ name: string }>(`SELECT name FROM bms_product_categories WHERE tenant_id=$1`, [tenantId])).rows.map((row) => row.name);
  assert.ok(names.includes("ร้านแก้เอง"));
  assert.equal(names.length, first.categories.length);
});

test("global tables are read-only for bms_app and emergency seeds are complete", async () => {
  assert.equal(Number((await query(`SELECT count(*) FROM bms_master_emergency_numbers WHERE country_code='TH' AND active`)).rows[0].count), 4);
  const grants = await query<{ table_name: string; privilege_type: string }>(
    `SELECT table_name,privilege_type FROM information_schema.role_table_grants
      WHERE grantee='bms_app' AND table_name IN ('bms_master_category_templates','bms_master_archetype_units','bms_master_holidays','bms_master_emergency_numbers')`,
  );
  assert.ok(grants.rows.some((row) => row.privilege_type === "SELECT"));
  assert.ok(!grants.rows.some((row) => ["INSERT","UPDATE","DELETE"].includes(row.privilege_type)));
});
