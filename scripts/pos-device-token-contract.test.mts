import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function execute(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)((id: string) => {
    if (id in dependencies) return dependencies[id];
    return new Proxy({}, { get: (_target, key) => { if (key === "__esModule") return true; return () => { throw new Error(`Unexpected dependency: ${id}.${String(key)}`); }; } });
  }, module, module.exports);
  return module.exports;
}

function harness(options: { missing?: boolean; failAudit?: boolean; failUpdate?: boolean } = {}) {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  let hash = "OLD_HASH", pendingHash = hash, inTx = false, released = false;
  const client = {
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      if (sql === "BEGIN") { inTx = true; pendingHash = hash; }
      if (sql.includes("UPDATE bms_pos_devices")) {
        assert.ok(inTx, "credential changes must be in a transaction");
        assert.match(sql, /WHERE tenant_id = \$1 AND id = \$2/);
        assert.deepEqual(params?.slice(0, 2), ["tenant-a", "device-a"]);
        if (options.failUpdate) throw new Error("update failed");
        if (!options.missing) pendingHash = params![2];
        return { rowCount: options.missing ? 0 : 1, rows: [] };
      }
      if (sql.includes("INSERT INTO bms_audit_log")) {
        assert.ok(inTx);
        assert.deepEqual(params, ["tenant-a", "admin@example.test", "device-a"]);
        if (options.failAudit) throw new Error("audit failed");
      }
      if (sql === "COMMIT") { hash = pendingHash; inTx = false; }
      if (sql === "ROLLBACK") { pendingHash = hash; inTx = false; }
      return { rowCount: 1, rows: [] };
    },
    release() { released = true; },
  };
  // Use the real tenant helper so role, tenant GUC and actor attribution are exercised too.
  const tenant = execute("apps/web/lib/bms/tenant.ts", { crypto });
  const service = execute("apps/web/lib/bms/pos.ts", {
    crypto,
    "@/lib/db": { getClient: async () => client, query: () => { throw new Error("unscoped query"); } },
    "./tenant": tenant,
  });
  return { calls, issue: () => service.issuePosDeviceToken("tenant-a", "device-a", { editorId: "actor-a", auditActor: "admin@example.test" }), state: () => ({ hash, inTx, released }) };
}

test("token issuance commits only a hash and audit under the tenant role", async () => {
  const h = harness();
  const issued = await h.issue();
  assert.match(issued.token, /^pos_[A-Za-z0-9_-]{43}$/);
  assert.equal(h.state().hash, crypto.createHash("sha256").update(issued.token).digest("hex"));
  assert.ok(h.calls.some(c => c.sql === "SET LOCAL ROLE bms_app"));
  assert.ok(h.calls.some(c => c.sql.includes("set_config('bms.tenant_id'") && c.params?.[0] === "tenant-a"));
  assert.ok(h.calls.some(c => c.sql.includes("set_config('app.editor_id'") && c.params?.[0] === "actor-a"));
  const update = h.calls.findIndex(c => c.sql.includes("UPDATE bms_pos_devices"));
  const audit = h.calls.findIndex(c => c.sql.includes("INSERT INTO bms_audit_log"));
  const commit = h.calls.findIndex(c => c.sql === "COMMIT");
  assert.ok(update >= 0 && audit > update && commit > audit);
  assert.ok(!JSON.stringify(h.calls).includes(issued.token));
  assert.deepEqual(h.state(), { hash: h.state().hash, inTx: false, released: true });
});

for (const options of [{ failAudit: true }, { failUpdate: true }]) {
  test(`failed token issuance rolls back the old credential: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await assert.rejects(h.issue());
    assert.deepEqual(h.state(), { hash: "OLD_HASH", inTx: false, released: true });
    assert.ok(!h.calls.some(c => c.sql === "COMMIT"));
  });
}

test("missing/foreign devices neither rotate nor write an audit", async () => {
  const h = harness({ missing: true });
  assert.equal(await h.issue(), null);
  assert.deepEqual(h.state(), { hash: "OLD_HASH", inTx: false, released: true });
  assert.ok(!h.calls.some(c => c.sql.includes("bms_audit_log")));
});

test("GraphQL checks permission and derives tenant/actor without a second audit", async () => {
  const calls: string[] = [];
  let denied = true;
  const resolver = execute("apps/web/graphql/bmsPos.ts", {
    "graphql/error": require("graphql/error"),
    "@/lib/bms/permissions": { requirePermission: async (_ctx: unknown, permission: string) => { calls.push(permission); if (denied) throw new Error("FORBIDDEN"); } },
    "@/lib/auth": { requireAuth: () => ({ author_id: "actor-a" }) },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-a" },
    "@/lib/bms/pos": { issuePosDeviceToken: async (...args: unknown[]) => { assert.deepEqual(args, ["tenant-a", "device-a", { editorId: "actor-a", auditActor: "admin@example.test" }]); calls.push("issue"); return { token: "FAKE" }; } },
    "@/lib/bms/audit": { audit: () => { throw new Error("must not audit outside transaction"); } },
  }).bmsPosResolvers.Mutation.bmsIssuePosDeviceToken;
  const ctx = { admin: { email: "admin@example.test" } };
  await assert.rejects(resolver(null, { deviceId: "device-a", tenantId: "foreign" }, ctx), /FORBIDDEN/);
  assert.deepEqual(calls, ["pos.device.manage"]);
  denied = false;
  assert.deepEqual(await resolver(null, { deviceId: "device-a", tenantId: "foreign" }, ctx), { token: "FAKE" });
  assert.deepEqual(calls, ["pos.device.manage", "pos.device.manage", "issue"]);
});
