import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function loadPlatformGate(admin: { id: string } | null, db: "platform" | "staff" | "error") {
  const mocks: Record<string, unknown> = {
    "server-only": {},
    "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
    "@/lib/auth/server": { verifyAdminSession: () => admin },
    "@/lib/db": { query: async (_sql: string, params: unknown[]) => {
      assert.deepEqual(params, [admin?.id]);
      if (db === "error") throw new Error("missing column");
      return { rows: [{ is_platform_admin: db === "platform" }] };
    } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/auth/platform-page.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => mocks[name], module, module.exports);
  return module.exports.requirePlatformAdminPage as () => Promise<void>;
}

function loadHealth(options: { failDb?: boolean; failRedis?: boolean } = {}) {
  const dbCalls: Array<{ sql: string; params: unknown[] }> = [];
  const mocks: Record<string, unknown> = {
    "@/lib/db": { query: async (sql: string, params: unknown[] = []) => {
      dbCalls.push({ sql, params });
      if (options.failDb) throw new Error("missing migration");
      if (sql.includes("pg_stat_activity")) return { rows: [{ active: "2", idle: "1", idle_in_tx: "0", total: "3", longest_active_query_sec: "4.8" }] };
      if (sql.includes("pg_settings")) return { rows: [{ setting: "100" }] };
      if (sql.includes("pg_database_size")) return { rows: [{ size: "2048" }] };
      if (sql.includes("COUNT(*)::int AS c")) return { rows: [{ c: "1" }] };
      if (sql.includes("FROM bms_tenant_channels tc")) return { rows: [{ tenant_id: "t1", tenant_name: "Shop", channel: "line", status: "disconnected", status_detail: null, last_checked_at: null }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    } },
    "@/lib/cache": { sharedRedisClient: {
      ping: async () => { if (options.failRedis) throw new Error("redis unavailable"); },
      info: async () => "connected_clients:3\nused_memory_human:2M\n",
    } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/lib/bms/systemHealth.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { health: module.exports, dbCalls };
}

test("system-health reads are platform gated and display failures as warning data", () => {
  const layout = read("apps/web/app/(admin)/admin/system-health/layout.tsx");
  const page = read("apps/web/app/(admin)/admin/system-health/page.tsx");
  assert.match(layout, /await requirePlatformAdminPage\(\)/);
  assert.match(page, /listAiProviderHealth\(\)\.catch\(/);
  assert.match(page, /listLatestJobRunPerJob\(\)\.catch\(/);
  assert.match(page, /getDbHealth\(\)/);
  assert.doesNotMatch(page, /recordJobRun|INSERT INTO|UPDATE bms_|DELETE FROM/);
});

test("system-health platform gate denies missing, staff and uncertain identities", async () => {
  await assert.rejects(loadPlatformGate(null, "staff")(), /redirect:\/admin\/login/);
  await assert.rejects(loadPlatformGate({ id: "staff-1" }, "staff")(), /redirect:\/admin$/);
  await assert.rejects(loadPlatformGate({ id: "staff-1" }, "error")(), /redirect:\/admin$/);
  await assert.doesNotReject(loadPlatformGate({ id: "platform-1" }, "platform")());
});

test("database or Redis failure is isolated instead of throwing the health page", async () => {
  const { health } = loadHealth({ failDb: true, failRedis: true });
  assert.deepEqual(await health.getDbHealth(), { ok: false, error: "missing migration" });
  assert.deepEqual(await health.getChannelHealthOverview(), { ok: false, error: "missing migration" });
  assert.deepEqual(await health.getRedisHealth(), { ok: false, error: "redis unavailable" });
});

test("available vitals are parsed and cross-tenant channel rows remain bounded", async () => {
  const { health, dbCalls } = loadHealth();
  assert.deepEqual(await health.getDbHealth(), {
    ok: true, active: 2, idle: 1, idleInTransaction: 0, total: 3,
    maxConnections: 100, longestActiveQuerySec: 5, dbSizeBytes: 2048,
  });
  const redis = await health.getRedisHealth();
  assert.equal(redis.ok, true);
  assert.ok(Number.isFinite(redis.latencyMs));
  assert.equal(redis.connectedClients, 3);
  assert.equal(redis.usedMemoryHuman, "2M");
  const channels = await health.getChannelHealthOverview(7);
  assert.equal(channels.ok, true);
  assert.equal(channels.unhealthyCount, 1);
  assert.equal(channels.rows.length, 1);
  assert.ok(dbCalls.some(({ sql, params }) => sql.includes("LIMIT $1") && params[0] === 7));
});
