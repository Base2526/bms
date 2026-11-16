import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("fake-data seeder rejects revoked or demoted admin sessions before returning an actor", async () => {
  const source = readFileSync(path.join(root, "apps/web/lib/dev-guards.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const current = { result: { ok: false, status: 401 } as Record<string, unknown>, calls: 0 };
  const mocks: Record<string, unknown> = {
    "@/lib/auth/server": { verifyAdminSession: () => ({ id: "stale-cookie" }) },
    "@/lib/bms/adminRouteAuth": { authorizePlatformAdminRoute: async () => {
      current.calls += 1;
      return current.result;
    } },
    "@/lib/db": { query: async () => { throw new Error("Seeder must not bypass the admin route guard"); } },
    "@/lib/bms/tenant": { DEFAULT_TENANT_ID: "default" },
  };
  new Function("require", "module", "exports", js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);

  const guard = module.exports.requirePlatformAdminSeeder as () => Promise<any>;
  assert.deepEqual(await guard(), { ok: false, reason: "not admin" });
  current.result = { ok: false, status: 403 };
  assert.deepEqual(await guard(), { ok: false, reason: "platform admin required" });
  const refreshedAdmin = { id: "active-platform-admin", role: "Administrator", is_platform_admin: true };
  current.result = { ok: true, admin: refreshedAdmin };
  assert.deepEqual(await guard(), { ok: true, actor: refreshedAdmin });
  assert.equal(current.calls, 3);
});
