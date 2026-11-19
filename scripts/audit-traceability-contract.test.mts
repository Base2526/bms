import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function load<T>(relative: string, mocks: Record<string, unknown>): T {
  const source = readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as T };
  new Function("require", "module", "exports", compiled)((name: string) => {
    if (name === "crypto") return require("node:crypto");
    assert.ok(name in mocks, `unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

test("audit timeline uses bound tenant and actor filters with stable cursor pagination", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const at = "2026-11-16T02:00:00.000Z";
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: String(3 - index), source_order: 1, source: "BUSINESS", actor: "staff@example.test",
    actor_user_id: "11111111-1111-4111-8111-111111111111", action: "stock.adjust",
    target: `sku-${index}`, meta: {}, outcome: null, created_at: at,
  }));
  const module = load<{ listAuditTimeline: (tenant: string, filter: any) => Promise<any> }>(
    "apps/web/lib/bms/auditTimeline.ts",
    { "@/lib/db": { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: calls.length === 1 ? rows : [rows[2]] };
    } } }
  );
  const filter = { actorUserId: "11111111-1111-4111-8111-111111111111", q: "stock",
    from: "2026-11-01", to: "2026-12-01", limit: 2 };
  const first = await module.listAuditTimeline("tenant-a", filter);
  assert.equal(first.nodes.length, 2);
  assert.equal(first.nodes[0].id, "BUSINESS:3");
  assert.ok(first.nextCursor);
  assert.equal(calls[0].params[0], "tenant-a");
  assert.equal(calls[0].params[1], filter.actorUserId);
  assert.equal(calls[0].params.at(-1), 3);
  assert.match(calls[0].sql, /s\.tenant_id = \$1::uuid/);
  assert.match(calls[0].sql, /a\.tenant_id = \$1/);
  assert.match(calls[0].sql, /\|\| s\.meta AS meta/);
  assert.match(calls[0].sql, /a\.actor = 'user:' \|\| \$2::text/);
  assert.match(calls[0].sql, /s\.actor_user_id = \$2::uuid/);
  assert.match(calls[0].sql, /a\.meta->>'resourceId' = \$3/);
  assert.match(calls[0].sql, /FROM \(SELECT \* FROM business UNION ALL SELECT \* FROM security\) events/);
  assert.equal([...calls[0].sql.matchAll(/LIMIT \$9/g)].length, 3,
    "each source and the final merge must be bounded");
  const second = await module.listAuditTimeline("tenant-a", { ...filter, cursor: first.nextCursor });
  assert.equal(second.nodes[0].id, "BUSINESS:1");
  assert.equal(calls[1].params[7], "2");
  await assert.rejects(module.listAuditTimeline("tenant-a", { actorUserId: "invalid" }));
  await assert.rejects(module.listAuditTimeline("tenant-a", { cursor: "tampered" }));
  await assert.rejects(module.listAuditTimeline("tenant-a", {
    cursor: Buffer.from(JSON.stringify({ at, sourceOrder: 1, id: "9999999999999999999" })).toString("base64url"),
  }));
  assert.equal(calls.length, 2);
});

test("actor-only history reads bounded exact-identity index streams", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const module = load<{ listAuditTimeline: (tenant: string | null, filter: any) => Promise<any> }>(
    "apps/web/lib/bms/auditTimeline.ts",
    { "@/lib/db": { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [] };
    } } }
  );
  const actor = "11111111-1111-4111-8111-111111111111";
  await module.listAuditTimeline("22222222-2222-4222-8222-222222222222", { actorUserId: actor, limit: 30 });
  assert.match(calls[0].sql, /business_new AS/);
  assert.match(calls[0].sql, /business_raw AS/);
  assert.match(calls[0].sql, /business_prefixed AS/);
  assert.match(calls[0].sql, /FROM business_ids candidate/);
  assert.equal([...calls[0].sql.matchAll(/LIMIT \$9/g)].length, 5);
  assert.equal(calls[0].params[1], actor);
  assert.equal(calls[0].params[8], 31);
  await module.listAuditTimeline(null, { actorUserId: actor });
  assert.match(calls[1].sql, /s\.tenant_id IS NULL/);
  assert.equal(calls[1].params[0], null);
});

test("security event stores a digest of session identity and never the token", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const module = load<{ recordSecurityEvent: (input: any) => Promise<void> }>(
    "apps/web/lib/bms/securityEvents.ts",
    { "@/lib/db": { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [] };
    } } }
  );
  await module.recordSecurityEvent({
    tenantId: "tenant-a", actorUserId: "user-a", event: "auth.login", outcome: "SUCCESS",
    source: "ADMIN_PASSWORD", sessionId: "secret-session-token",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[5], require("node:crypto").createHash("sha256").update("secret-session-token").digest("hex"));
  assert.ok(!JSON.stringify(calls).includes("secret-session-token"));
});

test("required business audit propagates insert failure to the owning transaction", async () => {
  const failure = new Error("audit unavailable");
  const module = load<{ insertAuditInTx: (client: any, input: any) => Promise<void> }>(
    "apps/web/lib/bms/audit.ts",
    { "@/lib/db": { query: async () => ({ rows: [] }) }, "./tenant": { getTenantId: () => "tenant-a" } }
  );
  await assert.rejects(
    module.insertAuditInTx({ query: async () => { throw failure; } }, {
      tenantId: "tenant-a", actor: "user-a", action: "stock.adjust", actorUserId: "user-a",
    }),
    failure
  );
});

test("test-shop deletion rolls back when its platform security event cannot commit", async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }], rowCount: 1 };
    },
    release() {},
  };
  const module = load<{ deleteTenant: (id: string, actor: string) => Promise<unknown> }>(
    "apps/web/lib/bms/platform.ts",
    {
      "graphql/error": { GraphQLError: Error }, "@/lib/auth": {},
      "@/lib/db": { getClient: async () => client,
        query: async () => ({ rows: [{ slug: "test-audit", name: "Test" }], rowCount: 1 }) },
      "./tenant": { DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000000" },
      "./securityEvents": { insertSecurityEventInTx: async () => { throw new Error("security audit unavailable"); } },
    }
  );
  await assert.rejects(module.deleteTenant("11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"), /security audit unavailable/);
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.includes("COMMIT"));
});

test("user logout resolves the tenant on the server and always clears the cookie", async () => {
  const events: any[] = [];
  const cleared: string[] = [];
  let failLookup = false;
  const module = load<{ POST: () => Promise<unknown> }>(
    "apps/web/app/api/auth/logout/route.ts",
    {
      "next/server": { NextResponse: { json: () => ({ cookies: { set: (name: string) => cleared.push(name) } }) } },
      "@/lib/auth/token": { USER_COOKIE: "USER_COOKIE", verifyTokenString: () => ({ id: "user-a" }) },
      "next/headers": { cookies: () => ({ get: () => ({ value: "signed-token" }) }) },
      "@/lib/db": { query: async (_sql: string, params: unknown[]) => {
        assert.deepEqual(params, ["user-a"]);
        if (failLookup) throw new Error("database unavailable");
        return { rows: [{ tenant_id: "tenant-a" }] };
      } },
      "@/lib/bms/securityEvents": { recordSecurityEventBestEffort: async (event: any) => events.push(event) },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    }
  );
  await module.POST();
  assert.equal(events[0].tenantId, "tenant-a");
  assert.deepEqual(cleared, ["USER_COOKIE"]);
  failLookup = true;
  await module.POST();
  assert.deepEqual(cleared, ["USER_COOKIE", "USER_COOKIE"]);
  assert.equal(events.length, 1);
});
