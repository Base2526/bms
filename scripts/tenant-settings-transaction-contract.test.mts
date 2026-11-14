import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function clientFor(options: { failAudit?: boolean; missingTenant?: boolean } = {}) {
  const statements: string[] = [];
  let committed = false;
  let rolledBack = false;
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql === "COMMIT") committed = true;
      if (sql === "ROLLBACK") rolledBack = true;
      if (sql.includes("INSERT INTO bms_audit_log") && options.failAudit) throw new Error("FAKE audit failure");
      if (sql.includes("SELECT id FROM bms_tenants")) return { rows: options.missingTenant ? [] : [{ id: "tenant-a" }], rowCount: options.missingTenant ? 0 : 1 };
      if (sql.includes("FROM bms_tenant_ai_config")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM bms_store_profile")) return { rows: [], rowCount: 0 };
      if (sql.includes("RETURNING onboarding_progress")) return { rows: [{ onboarding_progress: { completed: ["shop"], skipped: [] }, onboarding_dismissed_at: null, onboarding_last_seen_at: new Date() }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release: () => statements.push("RELEASE"),
  };
  return { client, statements, state: () => ({ committed, rolledBack }) };
}

const beginTenantTx = async (client: any, tenant: string) => {
  assert.equal(tenant, "tenant-a");
  await client.query("BEGIN");
};

function aiConfigWith(db: ReturnType<typeof clientFor>) {
  return loadWithStubs("apps/web/lib/bms/aiConfig.ts", {
    "@/lib/db": { getClient: async () => db.client, query: async () => ({ rows: [] }) },
    "./tenant": { beginTenantTx },
    "./deploymentMode": {},
    "./aiProvider": { normalizeAiProvider: (v: unknown) => v === "anthropic" || v === "deepseek" ? v : null },
    "./crypto": { encryptSecret: (_v: string) => "FAKE-ciphertext" },
    "./slipReaders/qwen": {}, "./aiProviderHealth": {}, "./aiUsage": {}, "./aiMetering": {},
  });
}

test("AI key write and audit commit together; audit failure rolls both back", async () => {
  const failing = clientFor({ failAudit: true });
  await assert.rejects(aiConfigWith(failing).setTenantAiKey("tenant-a", { apiKey: "FAKE", provider: "anthropic" }, "actor-a"), /audit failure/);
  assert.equal(failing.state().committed, false);
  assert.equal(failing.state().rolledBack, true);
  assert.ok(failing.statements.some(sql => sql.includes("INSERT INTO bms_tenant_ai_config")));
  const success = clientFor();
  assert.equal(await aiConfigWith(success).setTenantAiKey("tenant-a", { apiKey: "FAKE", provider: "anthropic" }, "actor-a"), true);
  assert.equal(success.state().committed, true);
  assert.ok(success.statements.findIndex(sql => sql.includes("INSERT INTO bms_audit_log")) < success.statements.indexOf("COMMIT"));
});

test("invalid provider and missing tenant cannot persist an AI key", async () => {
  const invalid = clientFor();
  await assert.rejects(aiConfigWith(invalid).setTenantAiKey("tenant-a", { provider: "FAKE" }, "actor-a"));
  assert.equal(invalid.statements.length, 0);
  const missing = clientFor({ missingTenant: true });
  await assert.rejects(aiConfigWith(missing).setTenantAiKey("tenant-a", { provider: "anthropic" }, "actor-a"));
  assert.equal(missing.state().rolledBack, true);
  assert.ok(!missing.statements.some(sql => sql.includes("INSERT INTO bms_tenant_ai_config")));
});

test("onboarding progress re-reads after tenant lock and rolls back on audit failure", async () => {
  const db = clientFor({ failAudit: true });
  const onboarding = loadWithStubs("apps/web/lib/bms/onboarding.ts", {
    "@/lib/db": { getClient: async () => db.client, query: async () => ({ rows: [] }) },
    "./tenant": { beginTenantTx },
  });
  await assert.rejects(onboarding.updateOnboardingProgress({ tenantId: "tenant-a", completed: ["shop", "shop", "bad"], editorId: "actor-a" }), /audit failure/);
  assert.equal(db.state().committed, false);
  assert.equal(db.state().rolledBack, true);
  const lock = db.statements.findIndex(sql => sql.includes("SELECT id FROM bms_tenants"));
  const read = db.statements.findIndex(sql => sql.includes("FROM bms_store_profile"));
  assert.ok(lock >= 0 && read > lock);
});

test("platform tenant suspension cannot commit without its audit record", async () => {
  const failing = clientFor({ failAudit: true });
  const platform = loadWithStubs("apps/web/lib/bms/platform.ts", {
    "graphql/error": { GraphQLError: Error },
    "@/lib/auth": {},
    "@/lib/db": { getClient: async () => failing.client, query: async () => ({ rows: [] }) },
    "./tenant": { beginTenantTx, DEFAULT_TENANT_ID: "FAKE-default" },
  });
  await assert.rejects(platform.setTenantActive("tenant-a", false, "actor-a"), /audit failure/);
  assert.equal(failing.state().committed, false);
  assert.equal(failing.state().rolledBack, true);
});
