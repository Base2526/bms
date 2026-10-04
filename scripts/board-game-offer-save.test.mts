import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/lib/bms/boardGameOffers.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const tenant = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const offerId = "33333333-3333-4333-8333-333333333333";
const input = {
  code: "FAKE_PROMO", name: "FAKE Time Offer", kind: "TIME_FIXED_PER_PERSON",
  fixedPrice: 50, minPlayers: 1, maxPlayers: null, minimumMinutes: 120,
  validFrom: "2026-10-04T08:08:00Z", validUntil: "2026-10-31T08:08:00Z",
  weekdays: [0, 1, 2, 3, 4, 5, 6], startsLocalTime: null, endsLocalTime: null,
};

function harness(options: { missingBranch?: boolean; missingSku?: boolean; noUpdate?: boolean; fail?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let released = false;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT 1 FROM bms_locations")) return { rowCount: options.missingBranch ? 0 : 1 };
      if (sql.includes("SELECT 1 FROM bms_products")) return { rowCount: options.missingSku ? 0 : 1 };
      if (/^(INSERT|UPDATE)/.test(sql)) {
        const indexes = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
        assert.deepEqual(indexes, Array.from({ length: params.length }, (_, i) => i + 1), "SQL must consume every bound parameter without a numbering gap");
        if (options.fail) throw new Error("database failure");
        return { rowCount: options.noUpdate ? 0 : 1, rows: [{ id: offerId, code: "FAKE_PROMO", name: input.name,
          kind: input.kind, fixed_price: "50", min_players: 1, minimum_minutes: 120, weekdays: input.weekdays, active: true, sort_order: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => { released = true; },
  };
  const exports: any = {};
  const dependencies: Record<string, unknown> = {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: unknown, id: string) => {
      assert.equal(id, tenant);
      await client.query("BEGIN");
    } },
  };
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return { save: exports.upsertBoardGameOffer, calls, released: () => released };
}

test("new offers bind contiguous parameters for all kinds and both branch scopes", async () => {
  for (const kind of ["TIME_FIXED_PER_PERSON", "TIME_PERCENT", "GROUP_FIXED", "TIME_BUY_GET"]) {
    for (const locationId of [null, branch]) {
      const h = harness();
      await h.save(tenant, { ...input, locationId, kind, percentOff: 20, buyMinutes: 120, freeMinutes: 60 });
      const saved = h.calls.find((call) => call.sql.startsWith("INSERT"))!;
      assert.deepEqual(saved.params, [tenant, locationId, "FAKE_PROMO", input.name, kind,
        kind === "TIME_PERCENT" ? 20 : null, ["TIME_PERCENT", "TIME_BUY_GET"].includes(kind) ? null : 50,
        1, null, 120, null, new Date(input.validFrom), new Date(input.validUntil), input.weekdays,
        null, null, true, 0, null, kind === "TIME_BUY_GET" ? 120 : null, kind === "TIME_BUY_GET" ? 60 : null]);
      assert.equal(h.calls.at(-1)?.sql, "COMMIT");
      assert.equal(h.released(), true);
    }
  }
});

test("updates retain tenant/id guards and align optional SKU, times and disabled state", async () => {
  const h = harness();
  await h.save(tenant, { ...input, id: offerId, locationId: branch, requiredProductSku: "fake-drink",
    startsLocalTime: "10:00", endsLocalTime: "18:00", active: false, sortOrder: 7, note: "test" });
  const saved = h.calls.find((call) => call.sql.startsWith("UPDATE"))!;
  assert.match(saved.sql, /WHERE tenant_id=\$1 AND id=\$2/);
  assert.deepEqual(saved.params, [tenant, offerId, branch, "FAKE_PROMO", input.name, input.kind,
    null, 50, 1, null, 120, "FAKE-DRINK", new Date(input.validFrom), new Date(input.validUntil),
    input.weekdays, "10:00", "18:00", false, 7, "test", null, null]);
});

test("missing branch/SKU/offer and database failure roll back and release", async () => {
  for (const options of [{ missingBranch: true }, { missingSku: true }, { noUpdate: true }, { fail: true }]) {
    const h = harness(options);
    await assert.rejects(h.save(tenant, { ...input, id: offerId, locationId: branch, requiredProductSku: "FAKE" }));
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
    assert.equal(h.calls.some((call) => call.sql === "COMMIT"), false);
    assert.equal(h.released(), true);
  }
});

test("PostgreSQL executes new and updated offer statements in a temporary table only", {
  skip: process.env.BMS_TEST_TEMP_POSTGRES !== "1",
}, async () => {
  const { Client } = require("pg");
  const host = process.env.POSTGRES_HOST || "localhost";
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "this opt-in test only connects to local PostgreSQL");
  const db = new Client({ host, port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "appdb", user: process.env.POSTGRES_USER || "app",
    password: process.env.POSTGRES_PASSWORD || "app", connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    const migration = readFileSync(new URL("../db/migrations/10.3__bms_board_game_offers.sql", import.meta.url), "utf8");
    const table = migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS"), migration.indexOf("CREATE INDEX"))
      .replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE")
      .replace("REFERENCES bms_tenants(id) ON DELETE CASCADE", "")
      .replace("  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),\n", "");
    await db.query(table);
    // No real tenant tables are reachable through unqualified names in this test.
    await db.query("SET search_path TO pg_temp");
    const timeMigration = readFileSync(new URL("../db/migrations/10.40__bms_board_game_time_buy_get.sql", import.meta.url), "utf8");
    await db.query(timeMigration);
    await db.query(timeMigration);
    for (const [index, locationId] of [null, branch].entries()) {
      const h = harness();
      await h.save(tenant, { ...input, code: `FAKE_${index}`, locationId });
      const insert = h.calls.find((call) => call.sql.startsWith("INSERT"))!;
      const saved = (await db.query(insert.sql, insert.params)).rows[0];
      assert.equal(saved.location_id, locationId);
      assert.equal(Number(saved.fixed_price), 50);
      assert.equal(saved.minimum_minutes, 120);
      const update = harness();
      await update.save(tenant, { ...input, code: `FAKE_${index}`, id: saved.id, locationId, fixedPrice: 75 });
      const statement = update.calls.find((call) => call.sql.startsWith("UPDATE"))!;
      assert.equal(Number((await db.query(statement.sql, statement.params)).rows[0].fixed_price), 75);
    }
    const timeOffer = harness();
    await timeOffer.save(tenant, { ...input, code: "FAKE_BUY_GET", kind: "TIME_BUY_GET", buyMinutes: 120, freeMinutes: 60 });
    const statement = timeOffer.calls.find((call) => call.sql.startsWith("INSERT"))!;
    const saved = (await db.query(statement.sql, statement.params)).rows[0];
    assert.equal(saved.kind, "TIME_BUY_GET");
    assert.equal(saved.buy_minutes, 120);
    assert.equal(saved.free_minutes, 60);
    assert.equal(saved.fixed_price, null);
    await assert.rejects(db.query("UPDATE bms_board_game_offers SET free_minutes = 0 WHERE id = $1", [saved.id]));
    await assert.rejects(db.query("UPDATE bms_board_game_offers SET buy_minutes = NULL WHERE id = $1", [saved.id]));
  } finally { await db.end(); }
});
