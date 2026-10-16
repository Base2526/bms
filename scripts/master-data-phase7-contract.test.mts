import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read("db/migrations/10.82__bms_master_drugs.sql");
const master = read("apps/web/lib/bms/masterDrugs.ts");
const barcodeMaster = read("apps/web/lib/bms/barcodeMaster.ts");
const policy = read("apps/web/lib/bms/pharmacy/productPolicy.ts");
const resolver = read("apps/web/graphql/bmsPharmacy.ts");
const ui = read("apps/web/app/(admin)/admin/pharmacy-protocols/page.tsx");

test("global drug master has no tenant scope or RLS and bms_app is read-only", () => {
  const table = migration.match(/CREATE TABLE IF NOT EXISTS bms_master_drugs \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.ok(table);
  assert.doesNotMatch(table, /\btenant_id\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE bms_master_drugs ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /GRANT SELECT ON TABLE bms_master_drugs TO bms_app/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE bms_master_drugs FROM bms_app/);
  const writeFunction = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.upsert_master_drug"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.review_master_barcode"),
  );
  assert.match(writeFunction, /SECURITY DEFINER/);
  assert.doesNotMatch(writeFunction, /SECURITY INVOKER/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.upsert_master_drug[\s\S]*GRANT EXECUTE ON FUNCTION public\.upsert_master_drug/);
});

test("there is no real drug seed before a named pharmacist owns the dataset", () => {
  assert.match(migration, /SAMPLE-DO-NOT-USE/);
  assert.match(migration, /BMS_SAMPLE_NOT_CLINICALLY_REVIEWED/);
  assert.match(migration, /FALSE,1,FALSE/);
  assert.equal((migration.match(/INSERT INTO bms_master_drugs/g) ?? []).length, 1);
});

test("master drug edits create effective-dated versions instead of overwriting history", () => {
  assert.match(migration, /UNIQUE \(code, version\)/);
  assert.match(migration, /effective_from TIMESTAMPTZ[\s\S]*effective_to TIMESTAMPTZ/);
  assert.match(migration, /SET active = FALSE, effective_to = now\(\)/);
  const upsert = master.slice(master.indexOf("export async function upsertMasterDrug"), master.indexOf("export async function applyMasterDrugSuggestionToPolicy"));
  assert.doesNotMatch(upsert, /ON CONFLICT[\s\S]*DO UPDATE/);
  assert.match(upsert, /SELECT \* FROM public\.upsert_master_drug/);
  assert.doesNotMatch(upsert, /INSERT INTO bms_master_drugs|UPDATE bms_master_drugs/);
});

test("pharmacist review provenance is mandatory when a row claims review", () => {
  assert.match(migration, /reviewed_by_pharmacist = FALSE OR[\s\S]*reviewed_by_pharmacist_name IS NOT NULL[\s\S]*reviewed_by_pharmacist_license_no IS NOT NULL[\s\S]*reviewed_at IS NOT NULL/);
  assert.match(master, /MASTER_DRUG_REVIEWER_REQUIRED/);
  assert.match(ui, /master_not_reviewed/);
});

test("automatic matching uses only Phase 6 approved barcode links", () => {
  assert.match(policy, /barcode_ref\.status = 'APPROVED'/);
  assert.match(policy, /bms_product_packs pack/);
  assert.match(migration, /WHERE status = 'APPROVED'[\s\S]*barcode = ANY/);
  assert.doesNotMatch(policy, /master_drug\.barcodes\s*@>|ANY\(master_drug\.barcodes\)/);
  assert.match(migration, /p_status = 'APPROVED'[\s\S]*effective_to IS NULL[\s\S]*v_saved\.barcode=ANY\(barcodes\)[\s\S]*cardinality\(v_matches\) = 1/);
  assert.match(barcodeMaster, /SELECT \* FROM public\.review_master_barcode/);
});

test("applying a suggestion copies a snapshot into Draft without cross-shop approval", () => {
  const apply = master.slice(master.indexOf("export async function applyMasterDrugSuggestionToPolicy"));
  assert.match(apply, /master_drug_suggestion_snapshot/);
  assert.match(apply, /status='DRAFT',reviewed_by=NULL,reviewed_at=NULL/);
  assert.match(apply, /JSON\.stringify\(snapshot\)/);
  assert.match(migration, /Later master edits never rewrite/);
  assert.doesNotMatch(apply, /SET\s+status\s*=\s*'APPROVED'/i);
  assert.match(policy, /input\.regulatoryEvidenceSource === "MASTER_DRUG_REFERENCE"/);
});

test("use-recommendation requires pharmacy.policy.review and audits in the tenant transaction", () => {
  const mutation = resolver.match(/async bmsApplyMasterDrugSuggestion\([\s\S]*?\n    },/)?.[0] ?? "";
  assert.match(mutation, /requirePermission\(ctx, "pharmacy\.policy\.review"\)/);
  const begin = master.indexOf("beginTenantTx(client, input.tenantId");
  const audit = master.indexOf("pharmacy.product_policy.master_suggestion_applied");
  const commit = master.indexOf('client.query("COMMIT")');
  assert.ok(begin >= 0 && audit > begin && commit > audit);
});

test("sale-decision authority remains tenant policy fields, not live master data", () => {
  const decision = read("apps/web/lib/bms/pharmacy/productPolicyDecision.ts");
  assert.doesNotMatch(decision, /bms_master_drugs|masterDrug|suggestedSalePolicy/);
  assert.match(policy, /SELECT product_sku, sale_policy, status, max_quantity/);
});

test("the tenant UI supports barcode suggestion and explicit manual selection", () => {
  assert.match(ui, /row\?\.suggestedMasterDrug\?\.code/);
  assert.match(ui, /bmsMasterDrugs\(limit: 500\)/);
  assert.match(ui, /bmsApplyMasterDrugSuggestion/);
  assert.match(ui, /master_suggestion_draft_only/);
});

