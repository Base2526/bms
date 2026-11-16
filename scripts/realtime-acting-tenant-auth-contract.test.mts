import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("realtime acting-tenant ticket follows current platform-admin status", async () => {
  const source = readFileSync(path.join(root, "apps/web/lib/bms/realtimeAuth.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  let isPlatformAdmin = false;
  let claims: Record<string, unknown> | null = null;
  const queriedTenants: string[] = [];
  const mocks: Record<string, unknown> = {
    "server-only": {},
    "@/lib/db": { query: async (sql: string, args: unknown[]) => {
      if (sql.includes("FROM bms_tenants")) {
        queriedTenants.push(String(args[0]));
        return { rows: [{ active: true }] };
      }
      if (sql.includes("FROM bms_user_allowed_locations")) return { rows: [{ location_id: "location-a" }] };
      throw new Error(`Unexpected query: ${sql}`);
    } },
    "@/lib/auth/adminIdentity": { refreshAdminIdentity: async () => ({
      id: "admin-a", jti: "session-a", tenant_id: "own-tenant", is_platform_admin: isPlatformAdmin,
    }) },
    "@/lib/auth/token": { jwtSecret: () => "fake-secret" },
    "@/lib/redisSession": { isAdminSessionActiveForRealtime: async () => true },
    "./permissions": { loadPermissions: async () => new Set(["inbox.view"]) },
    "./pos": { authenticatePosDevice: async () => null },
    "../../../../packages/realtime/src/wsTicket": {
      REALTIME_TICKET_AUDIENCE: "fake-audience", REALTIME_TICKET_VERSION: 1,
      signRealtimeTicket: async (value: Record<string, unknown>) => { claims = value; return "signed-fixture"; },
    },
  };
  new Function("require", "module", "exports", js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);

  const mint = module.exports.mintAdminRealtimeTicket as (session: unknown, acting: unknown) => Promise<unknown>;
  const session = { id: "admin-a", jti: "session-a" };
  const acting = { by: "admin-a", actTenantId: "other-tenant" };
  assert.ok(await mint(session, acting));
  assert.equal(claims?.tenantId, "own-tenant");
  assert.equal(claims?.actingTenantId, undefined);
  assert.deepEqual(queriedTenants, ["own-tenant"]);

  isPlatformAdmin = true;
  assert.ok(await mint(session, acting));
  assert.equal(claims?.tenantId, "other-tenant");
  assert.equal(claims?.actingTenantId, "other-tenant");
  assert.deepEqual(queriedTenants, ["own-tenant", "other-tenant"]);
});
