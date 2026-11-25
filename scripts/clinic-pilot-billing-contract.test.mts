import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("cashier worklist is role-gated, tenant-scoped, bounded and contains no chart text", async () => {
  const calls: unknown[][] = [];
  let allowed = true;
  const rows = Array.from({ length: 101 }, (_, index) => ({
    id: `encounter-${index}`, patient_hn: `HN-${String(index).padStart(6, "0")}`,
    patient_name: `Synthetic Patient ${index}`, signed_at: new Date("2026-11-25T02:00:00Z"),
    charge_status: null, order_id: null, draft_record: "must-not-leak",
  }));
  const client = { query: async (sql: string, params: unknown[]) => {
    calls.push(["query", sql, params]);
    return { rows, rowCount: rows.length };
  } };
  const mocks: Record<string, unknown> = {
    "../orders": { createOrderInTx: async () => null },
    "../productPacks": { getVariantBasePriceInTx: async () => null },
    "./access": {
      ClinicError: class ClinicError extends Error {},
      boundedText: (value: unknown) => String(value).trim(),
      clinicTx: async (tenantId: string, actorId: string, fn: (client: unknown) => Promise<unknown>) => {
        calls.push(["tx", tenantId, actorId]);
        return fn(client);
      },
      requireClinicRole: async (_client: unknown, tenantId: string, actorId: string, roles: string[]) => {
        calls.push(["role", tenantId, actorId, roles]);
        if (!allowed) throw new Error("CLINIC_ACCESS_DENIED");
      },
      auditClinicRead: async (_client: unknown, tenantId: string, actorId: string, kind: string, target: string) => {
        calls.push(["audit", tenantId, actorId, kind, target]);
      },
      auditClinicWrite: async () => null,
      uuid: (value: unknown) => value,
    },
  };
  const source = readFileSync(path.join(root, "apps/web/lib/bms/clinic/billing.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected billing import ${name}`);
    return mocks[name];
  }, module, module.exports);

  allowed = false;
  await assert.rejects(module.exports.listBillableClinicEncounters({
    tenantId: "trusted-tenant", actorId: "cashier", search: "HN-000001",
  }), /CLINIC_ACCESS_DENIED/);
  assert.deepEqual(calls.map(call => call[0]), ["tx", "role"]);
  calls.length = 0;
  allowed = true;
  const result = await module.exports.listBillableClinicEncounters({
    tenantId: "trusted-tenant", actorId: "cashier", search: "HN-000001",
  });
  assert.equal(result.encounters.length, 100);
  assert.equal(result.truncated, true);
  assert.equal("draft_record" in result.encounters[0], false);
  assert.deepEqual(calls.map(call => call[0]), ["tx", "role", "query", "audit"]);
  assert.deepEqual(calls[1], ["role", "trusted-tenant", "cashier", ["CASHIER"]]);
  const sql = String(calls[2]?.[1]);
  assert.match(sql, /e\.tenant_id=\$1/);
  assert.match(sql, /e\.status='SIGNED'/);
  assert.match(sql, /LIMIT 101/);
  assert.doesNotMatch(sql, /draft_record|signed_notes|\.content/);
  assert.deepEqual(calls[2]?.[2], ["trusted-tenant", "HN-000001%", "%HN-000001%"]);
  assert.deepEqual(calls[3], ["audit", "trusted-tenant", "cashier", "CLINIC_BILLING_WORKLIST", "worklist"]);
});
