import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("clinical protocol and pharmacist licence writes commit with tenant audit", async (t) => {
  const globals = globalThis as any;
  const previousPool = globals.__bmsPostgresPool;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let mode = "ok";
  let released = 0;
  const row = (status = "DRAFT") => ({
    id: "protocol-a", tenant_id: "tenant-a", protocol_key: "fever", name: "Fever",
    version: 1, supported_symptom_group: "fever", display_label: "Fever",
    trigger_terms: ["fever"], required_fields: [], conditional_questions: [], red_flag_rules: [],
    completion_rules: { requireAllOf: [] }, escalation_rules: {}, status,
    clinically_approved: status === "APPROVED", enabled: status === "APPROVED",
    reviewed_by: null, reviewed_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  });
  globals.__bmsPostgresPool = {
    query: async () => { throw new Error("write escaped its tenant transaction"); },
    connect: async () => ({
      release: () => { released++; },
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes("bms_lock_guidance_pharmacist_license")) {
          return { rows: [{ ok: mode !== "unlicensed" }], rowCount: 1 };
        }
        if (sql.includes("SELECT protocol_key FROM bms_pharmacy_protocols") && sql.includes("trigger_terms")) {
          return { rows: mode === "collision" ? [{ protocol_key: "other" }] : [], rowCount: mode === "collision" ? 1 : 0 };
        }
        if (sql.includes("SELECT protocol_key FROM bms_pharmacy_protocols")) return { rows: [{ protocol_key: "fever" }], rowCount: 1 };
        if (sql.includes("SELECT status, clinically_approved, protocol_key")) {
          return { rows: [{ status: mode === "unapproved" ? "DRAFT" : "APPROVED", clinically_approved: mode !== "unapproved", protocol_key: "fever" }], rowCount: 1 };
        }
        if (sql.includes("SELECT * FROM bms_pharmacy_protocols")) return { rows: [row()], rowCount: 1 };
        if (sql.includes("INSERT INTO bms_pharmacy_protocols") || sql.includes("UPDATE bms_pharmacy_protocols")) {
          if (mode === "stale" && sql.includes("RETURNING *")) return { rows: [], rowCount: 0 };
          const status = sql.includes("PENDING_REVIEW'") ? "PENDING_REVIEW" : sql.includes("clinically_approved = $5") ? "APPROVED" : "DRAFT";
          return { rows: [row(status)], rowCount: 1 };
        }
        if (sql.includes("bms_set_pharmacist_license")) return { rows: [{ changed: true }], rowCount: 1 };
        if (sql.includes("INSERT INTO bms_audit_log") && mode === "audit-failure") throw new Error("FAKE audit failure");
        return { rows: [], rowCount: 1 };
      },
    }),
  };
  try {
    const protocol = await import("../apps/web/lib/bms/pharmacy/protocols.ts");
    const { setPharmacistLicense } = await import("../apps/web/lib/bms/pharmacy/pharmacistLicense.ts");
    const input: Parameters<typeof protocol.upsertPharmacyProtocol>[1] = {
      protocolKey: "fever", name: "Fever", supportedSymptomGroup: "fever",
      displayLabel: "Fever", triggerTerms: ["fever"], requiredFields: [],
      conditionalQuestions: [], redFlagRules: [], completionRules: { requireAllOf: [] },
      escalationRules: {},
    };
    const actions = [
      { name: "draft", run: () => protocol.upsertPharmacyProtocol("tenant-a", input, "actor-a"), audit: "pharmacy.protocol.draft_saved" },
      { name: "submit", run: () => protocol.submitPharmacyProtocolForReview("tenant-a", "protocol-a", "actor-a"), audit: "pharmacy.protocol.review_requested" },
      { name: "review", run: () => protocol.reviewPharmacyProtocol("tenant-a", "protocol-a", "actor-a", "APPROVE"), audit: "pharmacy.protocol.approve" },
      { name: "enable", run: () => protocol.setPharmacyProtocolEnabled("tenant-a", "protocol-a", true, "actor-a"), audit: "pharmacy.protocol.enabled" },
    ];
    for (const action of actions) {
      for (const current of ["ok", "audit-failure", "stale", ...(action.name === "review" ? ["unlicensed"] : []), ...(action.name === "submit" ? ["collision"] : []), ...(action.name === "enable" ? ["unapproved"] : [])]) {
        await t.test(`${action.name}: ${current}`, async () => {
          mode = current; calls.length = 0; released = 0;
          if (current === "ok") {
            assert.equal((await action.run()).id, "protocol-a");
            assert.equal(calls.at(-1)?.sql, "COMMIT");
          } else {
            await assert.rejects(action.run);
            assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
            assert.ok(!calls.some((call) => call.sql === "COMMIT"));
          }
          const tenantAt = calls.findIndex((call) => call.sql.includes("set_config('bms.tenant_id'"));
          const auditAt = calls.findIndex((call) => call.sql.includes("INSERT INTO bms_audit_log"));
          assert.equal(calls[0]?.sql, "BEGIN");
          assert.ok(tenantAt > 0);
          if (current === "ok" || current === "audit-failure") {
            assert.ok(auditAt > tenantAt);
            assert.equal(calls[auditAt].params[2], action.audit);
            assert.deepEqual(calls[auditAt].params.slice(0, 2), ["tenant-a", "actor-a"]);
          } else assert.equal(auditAt, -1);
          if (action.name === "review") {
            const licenseAt = calls.findIndex((call) => call.sql.includes("bms_lock_guidance_pharmacist_license"));
            const updateAt = calls.findIndex((call) => call.sql.includes("UPDATE bms_pharmacy_protocols"));
            assert.ok(licenseAt > tenantAt);
            if (current === "unlicensed") assert.equal(updateAt, -1);
          }
          assert.equal(released, 1);
        });
      }
    }
    await t.test("licence change requires confirmation and audits in the transaction", async () => {
      mode = "ok"; calls.length = 0; released = 0;
      const input = { tenantId: "tenant-a", actorId: "actor-a", userId: "user-a", isLicensedPharmacist: true, licenseNo: "FAKE-LICENCE", confirmed: false };
      await assert.rejects(setPharmacistLicense(input), /ยืนยัน/);
      assert.equal(calls.length, 0);
      input.confirmed = true;
      await setPharmacistLicense(input);
      assert.equal(calls.at(-1)?.sql, "COMMIT");
      assert.ok(calls.findIndex((call) => call.sql.includes("bms_set_pharmacist_license")) > calls.findIndex((call) => call.sql.includes("set_config('bms.tenant_id'")));
      assert.ok(calls.some((call) => call.sql.includes("INSERT INTO bms_audit_log")));
      assert.equal(released, 1);
      mode = "audit-failure"; calls.length = 0; released = 0;
      await assert.rejects(setPharmacistLicense(input), /audit failure/);
      assert.ok(calls.some((call) => call.sql === "ROLLBACK"));
      assert.ok(!calls.some((call) => call.sql === "COMMIT"));
      assert.equal(released, 1);
    });
  } finally {
    globals.__bmsPostgresPool = previousPool;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});

test("licence migration limits the helper to the transaction tenant and Administrator", () => {
  const sql = readFileSync(new URL("../db/migrations/10.111__bms_pharmacist_license_admin_write.sql", import.meta.url), "utf8");
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /current_setting\('bms\.tenant_id'/);
  assert.match(sql, /current_setting\('app\.editor_id'/);
  assert.match(sql, /actor\.role = 'Administrator'/);
  assert.match(sql, /FOR SHARE OF actor/);
  assert.match(sql, /target\.id = p_user_id AND target\.tenant_id = p_tenant_id/);
  assert.match(sql, /REVOKE ALL ON FUNCTION.*FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION.*TO bms_app/);
  assert.doesNotMatch(sql, /GRANT UPDATE.*ON users TO bms_app/i);
});

test("pharmacist directory is Administrator-only, searchable and bounded at the server", () => {
  const resolver = readFileSync(new URL("../apps/web/graphql/bmsPharmacy.ts", import.meta.url), "utf8");
  assert.match(resolver, /function requireAdministrator\(ctx: any\) \{\s*requireAuth\(ctx\)/);
  const start = resolver.indexOf("async bmsPharmacyLicenseCandidates(");
  const end = resolver.indexOf("async bmsPharmacyAddClinicalEvidence(", start);
  const directory = resolver.slice(start, end);
  assert.match(directory, /requireAdministrator\(ctx\)/);
  assert.match(directory, /search\.length > 100/);
  assert.match(directory, /WHERE tenant_id = \$1/);
  assert.match(directory, /strpos\(lower\(name\), lower\(\$2\)\)/);
  assert.match(directory, /LIMIT 50/);
});
