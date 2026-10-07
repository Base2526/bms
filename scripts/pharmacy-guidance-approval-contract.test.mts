import test from "node:test";
import assert from "node:assert/strict";

test("guidance approval checks and snapshots the licence inside the audited tenant transaction", async (t) => {
  const state = globalThis as any, previous = state.__bmsPostgresPool;
  const oldMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const calls: { sql: string; params: unknown[] }[] = [];
  let mode = "allowed", released = 0;
  state.__bmsPostgresPool = {
    query: async () => { throw new Error("approval queried outside its transaction"); },
    connect: async () => ({ release: () => released++, query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("bms_lock_guidance_pharmacist_license")) {
        assert.deepEqual(params, ["tenant-a", "actor-a"]);
        if (mode === "missing-migration") throw Object.assign(new Error("missing helper"), { code: "42883" });
        return { rows: mode === "missing-user" ? [] : [{ ok: mode !== "unlicensed-admin", license_no: "FAKE-LICENCE" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE bms_pharmacy_guidance_templates")) {
        assert.deepEqual(params, ["tenant-a", "template-a", "actor-a", 7, "FAKE-LICENCE"]);
        return { rows: mode === "stale" ? [] : [{ id: "template-a" }], rowCount: mode === "stale" ? 0 : 1 };
      }
      if (sql.includes("FROM bms_pharmacy_guidance_templates g")) return { rows: [{ id: "template-a", code: "MISSED_DOSE", locale: "th", body: "FAKE approved body", status: "APPROVED", version: 7, approved_license_no: "FAKE-LICENCE" }], rowCount: 1 };
      if (sql.includes("INSERT INTO bms_audit_log") && mode === "audit-failure") throw new Error("FAKE audit failure");
      return { rows: [], rowCount: 1 };
    } }),
  };
  try {
    const { approvePharmacyGuidance, pharmacyGuidanceEditorContext } = await import("../apps/web/lib/bms/pharmacy/guidanceTemplateStore.ts");
    for (const current of ["allowed", "unlicensed-admin", "missing-user", "missing-migration", "stale", "audit-failure"]) {
      await t.test(current, async () => {
        mode = current; calls.length = 0; released = 0;
        const work = () => approvePharmacyGuidance("tenant-a", "actor-a", "template-a", 7);
        if (mode === "allowed") {
          assert.equal((await work()).approvedLicenseNo, "FAKE-LICENCE");
          assert.equal(calls.at(-1)?.sql, "COMMIT");
          assert.ok(calls.some((c) => c.sql.includes("INSERT INTO bms_audit_log")));
        } else {
          await assert.rejects(work);
          assert.ok(calls.some((c) => c.sql === "ROLLBACK"));
          assert.ok(!calls.some((c) => c.sql === "COMMIT"));
        }
        const atLicense = calls.findIndex((c) => c.sql.includes("bms_lock_guidance_pharmacist_license"));
        assert.ok(atLicense > calls.findIndex((c) => c.sql.includes("set_config('bms.tenant_id'")));
        assert.equal(calls[0].sql, "BEGIN");
        assert.equal(released, 1);
        if (["unlicensed-admin", "missing-user", "missing-migration"].includes(mode)) {
          assert.ok(!calls.some((c) => c.sql.includes("UPDATE bms_pharmacy_guidance_templates")));
        }
      });
    }
    await t.test("editor context uses the acting user's licence and real shop facts, with missing facts left null", async (sub) => {
      const { sharedRedisClient } = await import("../apps/web/lib/cache.ts");
      sub.mock.method(sharedRedisClient, "get", async () => null);
      sub.mock.method(sharedRedisClient, "set", async () => "OK");
      let licensed = true;
      sub.mock.method(state.__bmsPostgresPool, "query", async (sql: string, params: unknown[]) => {
        if (sql.includes("bms_is_licensed_pharmacist")) {
          assert.deepEqual(params, ["tenant-a", "actor-a"]);
          return { rows: [{ ok: licensed }] };
        }
        assert.match(sql, /FROM bms_store_profile WHERE tenant_id = \$1/);
        assert.deepEqual(params, ["tenant-a"]);
        return { rows: [{ phone: "FAKE-PHONE", business_hours: "FAKE-HOURS", address: null }] };
      });
      const facts = { shopPhone: "FAKE-PHONE", businessHours: "FAKE-HOURS", shopAddress: null };
      assert.deepEqual(await pharmacyGuidanceEditorContext("tenant-a", "actor-a"), { ...facts, licensedPharmacist: true });
      licensed = false;
      assert.deepEqual(await pharmacyGuidanceEditorContext("tenant-a", "actor-a"), { ...facts, licensedPharmacist: false });
    });
  } finally {
    state.__bmsPostgresPool = previous;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
  }
});
