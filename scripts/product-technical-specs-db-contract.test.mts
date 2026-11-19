import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { stageTechnicalSpecs, publishTechnicalSpecs, listTechnicalSpecs,
  publishedTechnicalSpecsForTool, searchPublishedTechnicalSpecs } from "../apps/web/lib/bms/productTechnicalSpecs.ts";
import { customerTools } from "../apps/web/lib/bms/tools/catalog.ts";

const sku = `FAKE-SPEC-${randomUUID().slice(0, 8)}`;
let tenantId = "", preparerId = "", reviewerId = "";
const key = () => `spec-test-${randomUUID()}`;
const draft = (requestKey: string, grade = "C35") => ({ sku, variantCode: "STD",
  lengthMm: 6000, diameterMm: 12.5, nominalWeightG: 5240.125,
  grade, standardCode: "FAKE STANDARD 1", usageLimitations: "FAKE: supplier states indoor use only",
  sourceReference: "FAKE supplier sheet rev 2", requestKey });

test("setup sourced-spec fixture on the isolated DB", async () => {
  const reg = await query<{ name: string | null }>(
    `SELECT to_regclass('bms_product_technical_specs')::text AS name`);
  assert.equal(reg.rows[0].name, "bms_product_technical_specs", "apply migration 10.135 on throwaway DB");
  tenantId = (await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE id='11111111-1111-1111-1111-111111111111'`)).rows[0].id;
  const staff = await query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id=$1 ORDER BY id LIMIT 2`, [tenantId]);
  assert.equal(staff.rows.length, 2);
  [preparerId,reviewerId] = staff.rows.map((x) => x.id);
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES ($1,$2,'FAKE sourced steel bar',100,true,'V')`, [tenantId,sku]);
  await query(`INSERT INTO bms_product_variants(tenant_id,product_sku,code,active)
    VALUES ($1,$2,'STD',true) ON CONFLICT DO NOTHING`, [tenantId,sku]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
    VALUES ($1,$2,'ONLINE_ORDER',true) ON CONFLICT (tenant_id,product_sku,surface)
    DO UPDATE SET enabled=true`, [tenantId,sku]);
});

test("invalid or unsourced facts are rejected before writes", async () => {
  assert.equal((await stageTechnicalSpecs(tenantId,preparerId,
    { ...draft(key()), diameterMm: 12.1234 })).status, "INVALID_INPUT");
  assert.equal((await stageTechnicalSpecs(tenantId,preparerId,
    { ...draft(key()), sourceReference: "" })).status, "INVALID_INPUT");
  assert.equal((await stageTechnicalSpecs(tenantId,preparerId,
    { sku, variantCode: "STD", sourceReference: "FAKE source", requestKey: key() })).status,
    "INVALID_INPUT");
  const foreignActor = (await query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id='22222222-2222-2222-2222-222222222222' LIMIT 1`)).rows[0].id;
  assert.equal((await stageTechnicalSpecs(tenantId,foreignActor,draft(key()))).status,
    "ACTOR_FORBIDDEN");
});

test("draft is idempotent and invisible to customer facts until independent publication", async () => {
  const input = draft(key());
  const first = await stageTechnicalSpecs(tenantId,preparerId,input);
  assert.deepEqual(first, { status: "DRAFT", revisionNo: 1 });
  assert.deepEqual(await stageTechnicalSpecs(tenantId,preparerId,input), first);
  assert.equal((await stageTechnicalSpecs(tenantId,preparerId,
    { ...input, grade: "C40" })).status, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual((await publishedTechnicalSpecsForTool(tenantId,sku)).items, []);
  assert.equal((await publishTechnicalSpecs(tenantId,preparerId,sku,"STD",1)).status,
    "SECOND_REVIEWER_REQUIRED");
  assert.equal((await publishTechnicalSpecs(tenantId,reviewerId,sku,"STD",1)).status, "PUBLISHED");
  const published = await publishedTechnicalSpecsForTool(tenantId,sku);
  assert.equal(published.status, "VERIFIED");
  assert.equal(published.items.length, 1);
  assert.equal(published.items[0].grade, "C35");
  assert.equal(published.items[0].source_reference, null);
  assert.equal((await searchPublishedTechnicalSpecs(tenantId,"C35")).items.length, 1);
});

test("new draft preserves old customer facts, publication replaces them without rewriting history", async () => {
  const second = await stageTechnicalSpecs(tenantId,preparerId,draft(key(),"C40"));
  assert.equal(second.revisionNo, 2);
  assert.equal((await publishedTechnicalSpecsForTool(tenantId,sku)).items[0].grade, "C35");
  assert.equal((await searchPublishedTechnicalSpecs(tenantId,"C40")).items.length, 0);
  assert.equal((await publishTechnicalSpecs(tenantId,reviewerId,sku,"STD",2)).status, "PUBLISHED");
  assert.equal((await publishedTechnicalSpecsForTool(tenantId,sku)).items[0].grade, "C40");
  assert.equal((await searchPublishedTechnicalSpecs(tenantId,"C35")).items.length, 0);
  assert.equal((await searchPublishedTechnicalSpecs(tenantId,"C40")).items.length, 1);
  const customerTool = customerTools("building_materials").find((tool) => tool.name === "search_product_specs");
  assert.ok(customerTool);
  const toolResult = await customerTool.execute({ keyword: "C40", tenantId: "22222222-2222-2222-2222-222222222222" },
    { tenantId, surface: "customer", actor: "ai:customer" });
  assert.equal(toolResult.ok, true);
  const answer = toolResult.data as { products: Array<{ sku: string; grade: string; sourceReference?: string }> };
  assert.equal(answer.products[0].sku, sku);
  assert.equal(answer.products[0].grade, "C40");
  assert.equal(answer.products[0].sourceReference, undefined);
  const history = await query<{ revision_no: number; status: string }>(
    `SELECT revision_no,status FROM bms_product_technical_specs
      WHERE tenant_id=$1 AND product_sku=$2 ORDER BY revision_no`, [tenantId,sku]);
  assert.deepEqual(history.rows.map((x) => [x.revision_no,x.status]),
    [[1,"SUPERSEDED"],[2,"PUBLISHED"]]);
  assert.equal((await listTechnicalSpecs(tenantId,sku)).length, 1);
});

test("spec RLS hides another tenant, and audit records both decisions", async () => {
  const client = await getClient();
  try {
    await beginTenantTx(client,"22222222-2222-2222-2222-222222222222");
    const cross = await client.query(`SELECT 1 FROM bms_product_technical_specs WHERE product_sku=$1`, [sku]);
    assert.equal(cross.rowCount, 0);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  const audits = await query<{ action: string }>(
    `SELECT action FROM bms_audit_log WHERE tenant_id=$1 AND target=$2
      AND action IN ('product.spec.stage','product.spec.publish')`, [tenantId,sku]);
  assert.deepEqual(audits.rows.map((x) => x.action).sort(),
    ["product.spec.publish","product.spec.publish","product.spec.stage","product.spec.stage"]);
});

test("teardown sourced-spec fixture", async () => {
  await query(`DELETE FROM bms_product_technical_specs WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_product_sales_surfaces WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_product_variants WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_products WHERE tenant_id=$1 AND sku=$2`, [tenantId,sku]);
});
