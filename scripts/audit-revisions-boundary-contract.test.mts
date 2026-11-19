import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function harness(options: { scope?: string; allow?: boolean; rows?: any[] } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const permissions: string[] = [];
  class GraphQLError extends Error { extensions: unknown; constructor(message: string, config?: { extensions?: unknown }) { super(message); this.extensions = config?.extensions; } }
  const mocks: Record<string, unknown> = {
    "graphql/error": { GraphQLError },
    "@/lib/db": { query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: options.rows ?? [] };
    } },
    "@/lib/bms/permissions": { requirePermission: async (_ctx: unknown, permission: string) => {
      permissions.push(permission);
      if (options.allow === false) throw new GraphQLError("forbidden");
    } },
    "@/lib/bms/tenant": { getTenantId: () => "tenant-a" },
    "@/lib/auth": { requireAuth: () => ({ scope: options.scope ?? "admin" }) },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/graphql/bmsRevisions.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { resolvers: module.exports.bmsRevisionsResolvers.Query, queries, permissions };
}

test("revision history refuses non-admin and permission-denied reads before SQL", async () => {
  const nonAdmin = harness({ scope: "web" });
  await assert.rejects(nonAdmin.resolvers.bmsRevisionHistory(null, { kind: "orders", entityId: "o1" }, {}));
  assert.equal(nonAdmin.queries.length, 0);
  const denied = harness({ allow: false });
  await assert.rejects(denied.resolvers.bmsRevisionHistory(null, { kind: "orders", entityId: "o1" }, {}));
  assert.deepEqual(denied.permissions, ["order.view"]);
  assert.equal(denied.queries.length, 0);
  const invalid = harness();
  await assert.rejects(invalid.resolvers.bmsRevisionHistory(null, { kind: "unlisted_table", entityId: "o1" }, {}));
  assert.equal(invalid.queries.length, 0);
});

test("revision list and detail bind tenant, bounded results and editor attribution", async () => {
  const row = { id: "rev-1", tenant_id: "tenant-a", editor_id: "admin-1", editor_label: "admin@example.test",
    revision_id: "group-1", snapshot: { id: "order-1", status: "PAID" }, created_at: "2026-11-12T00:00:00Z" };
  const h = harness({ rows: [row] });
  const history = await h.resolvers.bmsRevisionHistory(null, { kind: "orders", entityId: "order-1", limit: 900 }, {});
  assert.equal(history[0].editorLabel, "admin@example.test");
  assert.equal(history[0].entityId, "order-1");
  assert.match(h.queries[0].sql, /r\.tenant_id = \$1/);
  assert.equal(h.queries[0].params[0], "tenant-a");
  assert.equal(h.queries[0].params.at(-1), 200);
  const detail = await h.resolvers.bmsRevisionDetail(null, { kind: "orders", revisionId: "rev-1" }, {});
  assert.equal(detail.snapshot.status, "PAID");
  assert.match(h.queries[1].sql, /r\.tenant_id = \$1 AND r\.id = \$2/);
  assert.deepEqual(h.queries[1].params, ["tenant-a", "rev-1"]);
  assert.deepEqual(h.permissions, ["order.view", "order.view"]);
});

test("revision comparison returns exact nested before/after changes only inside one tenant", async () => {
  const h = harness({ rows: [
    { id: "old", snapshot: { total: 100, payment: { status: "PENDING" } }, created_at: "2026-11-11" },
    { id: "new", snapshot: { total: 100, payment: { status: "PAID" } }, created_at: "2026-11-12" },
  ] });
  const result = await h.resolvers.bmsRevisionCompare(null, {
    kind: "orders", fromRevisionId: "old", toRevisionId: "new",
  }, {});
  assert.deepEqual(result.diff, [{ path: "payment.status", before: "PENDING", after: "PAID" }]);
  assert.match(h.queries[0].sql, /WHERE tenant_id = \$1 AND id IN \(\$2, \$3\)/);
  assert.deepEqual(h.queries[0].params, ["tenant-a", "old", "new"]);
  const missing = harness({ rows: [{ id: "old", snapshot: {} }] });
  assert.equal(await missing.resolvers.bmsRevisionCompare(null, {
    kind: "orders", fromRevisionId: "old", toRevisionId: "foreign",
  }, {}), null);
});
