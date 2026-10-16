import assert from "node:assert/strict";
import test from "node:test";
import { getClient, query } from "../apps/web/lib/db.ts";
import { applyMasterDrugSuggestionToPolicy } from "../apps/web/lib/bms/pharmacy/productPolicy.ts";
import { upsertProduct } from "../apps/web/lib/bms/products.ts";

const tag = `phase7-${process.pid}-${Date.now()}`;
const code = `FAKE-${tag}`.toUpperCase();
const sku = `FAKE-${tag}-SKU`;
let tenantId = "";
let actorId = "";

test.before(async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`, [`FAKE ${tag}`, tag],
  )).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,business_archetype) VALUES($1,'pharmacy')`, [tenantId]);
  actorId = (await query<{ id: string }>(
    `INSERT INTO users(name,username,email,role,role_id,tenant_id,password_hash,fake_test)
     SELECT $2,$3,$3,'Administrator',r.id,$1,'x',TRUE FROM roles r
      WHERE r.name='Administrator' LIMIT 1 RETURNING id`,
    [tenantId, `FAKE ${tag}`, `${tag}@example.invalid`],
  )).rows[0].id;
  await upsertProduct(tenantId, { sku, name: "Phase 7 product", price: 1 });
  await query(
    `INSERT INTO bms_master_drugs(code,country_code,generic_name,dosage_form,strength,
       regulatory_class,suggested_sale_policy,suggested_quantity_limit,source,source_version,
       reviewed_by_pharmacist,version,active)
     VALUES($1,'TH','FAKE GENERIC','tablet','10 mg','DANGEROUS_DRUG',
       'PHARMACIST_APPROVAL',2,'FAKE TEST','v1',FALSE,1,TRUE)`,
    [code],
  );
});

test.after(async () => {
  if (tenantId) await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenantId]);
  await query(`DELETE FROM bms_master_drugs WHERE code=$1`, [code]);
});

test("applying a recommendation writes a tenant Draft, frozen snapshot, and same-tx audit", async () => {
  const policy = await applyMasterDrugSuggestionToPolicy({
    tenantId, productSku: sku, masterDrugCode: code, actorId, actorLabel: `${tag}@example.invalid`,
  });
  assert.equal(policy.status, "DRAFT");
  assert.equal(policy.masterDrugCode, code);
  const stored = (await query<any>(
    `SELECT * FROM bms_pharmacy_product_policies WHERE tenant_id=$1 AND product_sku=$2`,
    [tenantId, sku],
  )).rows[0];
  assert.equal(stored.sale_policy, "PHARMACIST_APPROVAL");
  assert.equal(stored.max_quantity, 2);
  assert.equal(stored.master_drug_suggestion_snapshot.version, 1);
  assert.equal(stored.master_drug_suggestion_snapshot.reviewedByPharmacist, false);
  assert.equal(Number((await query(
    `SELECT count(*) FROM bms_audit_log WHERE tenant_id=$1
      AND action='pharmacy.product_policy.master_suggestion_applied' AND target=$2`,
    [tenantId, sku],
  )).rows[0].count), 1);
});

test("editing the master later never changes the tenant policy or its snapshot", async () => {
  await query(`UPDATE bms_master_drugs SET active=FALSE,effective_to=now() WHERE code=$1 AND effective_to IS NULL`, [code]);
  await query(
    `INSERT INTO bms_master_drugs(code,country_code,generic_name,dosage_form,strength,
       regulatory_class,suggested_sale_policy,suggested_quantity_limit,source,source_version,
       reviewed_by_pharmacist,version,active)
     VALUES($1,'TH','FAKE GENERIC','tablet','10 mg','DANGEROUS_DRUG',
       'DIRECT_SALE',9,'FAKE TEST','v2',FALSE,2,TRUE)`,
    [code],
  );
  const stored = (await query<any>(
    `SELECT sale_policy,max_quantity,master_drug_suggestion_snapshot
       FROM bms_pharmacy_product_policies WHERE tenant_id=$1 AND product_sku=$2`,
    [tenantId, sku],
  )).rows[0];
  assert.equal(stored.sale_policy, "PHARMACIST_APPROVAL");
  assert.equal(stored.max_quantity, 2);
  assert.equal(stored.master_drug_suggestion_snapshot.version, 1);
});

test("bms_app cannot write the global drug master", async () => {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await assert.rejects(
      () => client.query(`UPDATE bms_master_drugs SET generic_name='blocked' WHERE code=$1`, [code]),
      (error: any) => error?.code === "42501",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});

test("bms_app can write only through the reviewed master function", async () => {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    const saved = await client.query<any>(
      `SELECT * FROM public.upsert_master_drug(
        NULL,$1,'TH','FAKE FUNCTION','tablet','5 mg','OTHER_DRUG','PHARMACIST_APPROVAL',
        NULL,'{}'::text[],'FAKE TEST','v1',FALSE,NULL,NULL,1,TRUE
      )`,
      [`FUNCTION-${code}`],
    );
    assert.equal(saved.rowCount, 1);
    assert.equal(saved.rows[0].version, 1);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
});
