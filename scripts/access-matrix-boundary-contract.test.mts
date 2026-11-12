import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function harness(options: { fail?: "insert" | "audit"; roleName?: string } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rights = new Set(["product.view"]);
  const staged = new Set(rights);
  let committed = false;
  let rolledBack = false;
  let releases = 0;
  const client = {
    release: () => { releases++; },
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql === "COMMIT") { rights.clear(); for (const p of staged) rights.add(p); committed = true; return { rowCount: 0, rows: [] }; }
      if (sql === "ROLLBACK") { rolledBack = true; return { rowCount: 0, rows: [] }; }
      if (sql.includes("FROM bms_tenants")) return { rowCount: 1, rows: [{ id: "tenant-a" }] };
      if (sql.includes("FROM bms_role_permissions rp")) return { rowCount: staged.size, rows: [...staged].map((permission) => ({ permission })) };
      if (sql.includes("FROM roles r")) return { rowCount: 2, rows: [
        { id: "role-1", name: "Sales", is_super: false, permissions: [...staged] },
        { id: "role-2", name: "Administrator", is_super: true, permissions: [] },
      ] };
      if (sql.includes("FROM roles")) return { rowCount: 1, rows: [{ name: options.roleName ?? "Sales" }] };
      if (sql.includes("SELECT permission FROM bms_role_permissions")) return { rowCount: staged.size, rows: [...staged].map((permission) => ({ permission })) };
      if (sql.includes("DELETE FROM bms_role_permissions")) { staged.clear(); return { rowCount: 1, rows: [] }; }
      if (sql.includes("INSERT INTO bms_role_permissions")) {
        if (options.fail === "insert") throw new Error("permission insert failed");
        for (const p of params.slice(2)) staged.add(String(p));
        return { rowCount: staged.size, rows: [] };
      }
      if (sql.includes("INSERT INTO bms_audit_log")) {
        if (options.fail === "audit") throw new Error("audit insert failed");
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  class GraphQLError extends Error { extensions: unknown; constructor(message: string, options?: { extensions?: unknown }) { super(message); this.extensions = options?.extensions; } }
  const mocks: Record<string, unknown> = {
    "graphql/error": { GraphQLError },
    "@/lib/auth": { requireAuth: () => ({ scope: "admin" }) },
    "@/lib/db": { getClient: async () => client, query: async () => { throw new Error("pool query bypassed transaction"); } },
    "./tenant": { getTenantId: () => "tenant-a", beginTenantTx: async (_client: unknown, tenantId: string, opts: unknown) => {
      calls.push({ sql: "beginTenantTx", params: [tenantId, opts] });
    } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/bms/permissions.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { setRolePermissions: module.exports.setRolePermissions as
    (tenantId: string, roleId: string, permissions: string[], actorId: string) => Promise<boolean>,
    loadPermissions: module.exports.loadPermissions as (ctx: unknown) => Promise<Set<string>>,
    listRolesWithPermissions: module.exports.listRolesWithPermissions as (tenantId: string) => Promise<any[]>,
    calls, rights, get committed() { return committed; }, get rolledBack() { return rolledBack; }, get releases() { return releases; } };
}

test("role reads establish tenant RLS context before loading the matrix", async () => {
  const own = harness();
  const perms = await own.loadPermissions({ admin: { id: "admin-1", role: "Sales" } });
  assert.deepEqual([...perms], ["product.view"]);
  assert.deepEqual(own.calls[0], { sql: "beginTenantTx", params: ["tenant-a", undefined] });
  assert.ok(own.calls.some(({ sql, params }) => sql.includes("rp.tenant_id = $2") && params[1] === "tenant-a"));
  assert.equal(own.calls.at(-1)?.sql, "COMMIT");
  const matrix = harness();
  const roles = await matrix.listRolesWithPermissions("tenant-a");
  assert.equal(roles[0].permissions[0], "product.view");
  assert.ok(roles[1].permissions.includes("product.edit"));
  assert.equal(matrix.calls[0]?.sql, "beginTenantTx");
  assert.ok(matrix.calls.some(({ sql, params }) => sql.includes("rp.tenant_id = $2") && params[1] === "tenant-a"));
});

test("role edit locks its tenant and commits permissions with actor audit", async () => {
  const h = harness();
  assert.equal(await h.setRolePermissions("tenant-a", "role-1", ["product.edit", "product.edit"], "admin-1"), true);
  assert.deepEqual([...h.rights], ["product.edit"]);
  assert.equal(h.committed, true);
  assert.equal(h.releases, 1);
  assert.deepEqual(h.calls[0], { sql: "beginTenantTx", params: ["tenant-a", { editorId: "admin-1" }] });
  assert.ok(h.calls.some(({ sql, params }) => sql.includes("FROM bms_tenants") && sql.includes("FOR UPDATE") && params[0] === "tenant-a"));
  const audit = h.calls.find(({ sql }) => sql.includes("INSERT INTO bms_audit_log"));
  assert.deepEqual(audit?.params.slice(0, 3), ["tenant-a", "admin-1", "role-1"]);
  assert.deepEqual(JSON.parse(String(audit?.params[3])), { added: ["product.edit"], removed: ["product.view"] });
  assert.ok(h.calls.findIndex(({ sql }) => sql.includes("INSERT INTO bms_audit_log")) < h.calls.findIndex(({ sql }) => sql === "COMMIT"));
});

test("permission insert or audit failure rolls back the old matrix", async () => {
  for (const fail of ["insert", "audit"] as const) {
    const h = harness({ fail });
    await assert.rejects(h.setRolePermissions("tenant-a", "role-1", ["product.edit"], "admin-1"));
    assert.deepEqual([...h.rights], ["product.view"]);
    assert.equal(h.committed, false);
    assert.equal(h.rolledBack, true);
    assert.equal(h.releases, 1);
  }
});

test("unknown permission is rejected before a write and Administrator stays immutable", async () => {
  const invalid = harness();
  await assert.rejects(invalid.setRolePermissions("tenant-a", "role-1", ["invented.grant"], "admin-1"));
  assert.equal(invalid.calls.length, 0);
  await assert.rejects(invalid.setRolePermissions("tenant-a", "role-1", ["product.view"], ""));
  assert.equal(invalid.calls.length, 0);
  const superRole = harness({ roleName: "Administrator" });
  await assert.rejects(superRole.setRolePermissions("tenant-a", "role-1", ["product.edit"], "admin-1"));
  assert.equal(superRole.rolledBack, true);
  assert.ok(!superRole.calls.some(({ sql }) => sql.includes("DELETE FROM bms_role_permissions")));
});

test("GraphQL checks super admin before calling the domain write", () => {
  const resolver = read("apps/web/graphql/bmsDashboard.ts").split("async bmsSetRolePermissions(")[1].split("// couponSummary")[0];
  assert.match(resolver, /requireSuper\(ctx\);[\s\S]*args\.confirmed !== true[\s\S]*setRolePermissions\(getTenantId\(ctx\)/);
  assert.doesNotMatch(resolver, /audit\(ctx, "rbac\.set"/);
});

test("matrix editor shows the exact role and grants before human confirmation", () => {
  const page = read("apps/web/app/(admin)/admin/permissions/page.tsx");
  assert.match(page, /const added = current\.filter/);
  assert.match(page, /const removed = role\.permissions\.filter/);
  assert.match(page, /Modal\.confirm\(\{/);
  assert.match(page, /onOk: async \(\) => \{ await setPerms\(/);
  assert.match(page, /confirmed: true/);
  assert.doesNotMatch(page, /onClick=\{\(\) => setPerms\(/);
});
