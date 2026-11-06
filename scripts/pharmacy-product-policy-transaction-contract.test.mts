import test from "node:test";
import assert from "node:assert/strict";

test("Product Policy writes and audits share a tenant transaction", async (t) => {
  const state = globalThis as any;
  const previousPool = state.__bmsPostgresPool;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let mode = "ok";
  let released = 0;
  const row = (status: string) => ({
    id: "policy-a", tenant_id: "tenant-a", product_sku: "SKU-A",
    product_type: "DRUG", regulatory_framework: "DRUG",
    regulatory_class: "DANGEROUS_DRUG", regulatory_evidence_source: "FDA_REGISTRATION",
    regulatory_evidence_ref: null, sale_policy: "PHARMACIST_APPROVAL",
    registration_no: "FAKE-REG", max_quantity: null, safety_rule_key: null,
    status, reviewed_by: null, reviewed_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
  state.__bmsPostgresPool = {
    query: async () => { throw new Error("Product Policy write escaped its tenant transaction"); },
    connect: async () => ({
      release: () => { released++; },
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("bms_lock_guidance_pharmacist_license")) {
          assert.deepEqual(params, ["tenant-a", "actor-a"]);
          if (mode === "missing-helper") throw new Error("missing licence helper");
          return { rows: mode === "unlicensed" ? [{ ok: false }] : [{ ok: true }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO bms_pharmacy_product_policies")) {
          return { rows: mode === "stale" ? [] : [row("DRAFT")], rowCount: mode === "stale" ? 0 : 1 };
        }
        if (sql.includes("SELECT * FROM bms_pharmacy_product_policies")) {
          return { rows: mode === "stale" ? [] : [row("DRAFT")], rowCount: mode === "stale" ? 0 : 1 };
        }
        if (sql.includes("UPDATE bms_pharmacy_product_policies")) {
          return { rows: mode === "stale" ? [] : [row(sql.includes("PENDING_REVIEW', updated_at") ? "PENDING_REVIEW" : "APPROVED")], rowCount: mode === "stale" ? 0 : 1 };
        }
        if (sql.includes("INSERT INTO bms_audit_log") && mode === "audit-failure") throw new Error("FAKE audit failure");
        return { rows: [], rowCount: 1 };
      },
    }),
  };
  try {
    const policy = await import("../apps/web/lib/bms/pharmacy/productPolicy.ts");
    const input: Parameters<typeof policy.upsertPharmacyProductPolicyDraft>[1] = {
      productSku: "SKU-A", productType: "DRUG", regulatoryFramework: "DRUG",
      regulatoryClass: "DANGEROUS_DRUG", regulatoryEvidenceSource: "FDA_REGISTRATION",
      salePolicy: "PHARMACIST_APPROVAL", registrationNo: "FAKE-REG",
    };
    const actions = [
      { name: "draft", run: () => policy.upsertPharmacyProductPolicyDraft("tenant-a", input, "actor-a"), sql: "INSERT INTO bms_pharmacy_product_policies", audit: "pharmacy.product_policy.draft_saved" },
      { name: "submit", run: () => policy.submitPharmacyProductPolicyForReview("tenant-a", "SKU-A", "actor-a"), sql: "UPDATE bms_pharmacy_product_policies", audit: "pharmacy.product_policy.submitted" },
      { name: "review", run: () => policy.reviewPharmacyProductPolicy("tenant-a", "SKU-A", "actor-a", "APPROVE"), sql: "UPDATE bms_pharmacy_product_policies", audit: "pharmacy.product_policy.reviewed" },
    ];
    for (const action of actions) {
      for (const current of ["ok", "audit-failure", "stale", ...(action.name === "review" ? ["unlicensed", "missing-helper"] : [])]) {
        await t.test(`${action.name}: ${current}`, async () => {
          mode = current; calls.length = 0; released = 0;
          if (current === "ok") {
            assert.equal((await action.run()).productSku, "SKU-A");
            assert.equal(calls.at(-1)?.sql, "COMMIT");
          } else {
            await assert.rejects(action.run);
            assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
            assert.ok(!calls.some((call) => call.sql === "COMMIT"));
          }
          assert.equal(calls[0]?.sql, "BEGIN");
          const tenantAt = calls.findIndex((call) => call.sql.includes("set_config('bms.tenant_id'"));
          const writeAt = calls.findIndex((call) => call.sql.includes(action.sql));
          const auditAt = calls.findIndex((call) => call.sql.includes("INSERT INTO bms_audit_log"));
          assert.ok(tenantAt > 0);
          if (current === "ok" || current === "audit-failure") {
            assert.ok(writeAt > tenantAt);
            assert.ok(auditAt > writeAt);
            assert.equal(calls[auditAt].params[2], action.audit);
            assert.deepEqual(calls[auditAt].params.slice(0, 2), ["tenant-a", "actor-a"]);
          } else {
            assert.equal(auditAt, -1);
          }
          if (action.name === "review") {
            const licenseAt = calls.findIndex((call) => call.sql.includes("bms_lock_guidance_pharmacist_license"));
            assert.ok(licenseAt > tenantAt);
            if (current === "unlicensed" || current === "missing-helper") assert.equal(writeAt, -1);
          }
          assert.equal(released, 1);
        });
      }
    }
  } finally {
    state.__bmsPostgresPool = previousPool;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
