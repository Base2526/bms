import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as math from "../apps/web/lib/bms/boardGameAnalyticsMath.ts";

// Real service with mocked DB transport, not proof of PostgreSQL/RLS execution.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/lib/bms/boardGameOwnerReads.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const tenant = id(1), actor = id(2), location = id(3), now = new Date("2026-10-23T05:00:00Z");
function harness(options: { denied?: boolean; wrongShop?: boolean; fail?: boolean; mismatch?: boolean; missingExpiryCount?: boolean } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const delegated: string[] = [];
  let released = false;
  const rows = (items: any[] = []) => ({ rows: items, rowCount: items.length });
  const client = { release() { released = true; }, async query(sql: string, params: any[] = []) {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE)\b/);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return rows();
    if (sql === "SELECT transaction_timestamp() AS now") return rows([{ now }]);
    assert.equal(params[0], tenant);
    if (sql.includes("bms_locations l")) {
      assert.match(sql, /l\.tenant_id=\$1 AND l\.id=\$3/);
      assert.match(sql, /user_id=\$2 AND location_id=l\.id/);
      assert.deepEqual(params, [tenant, actor, location]);
      return rows(options.denied ? [] : [{ id: location }]);
    }
    if (sql.includes("pg_timezone_names")) return rows([{ timezone: "Asia/Bangkok" }]);
    if (options.fail) throw new Error("transport unavailable");
    if (sql.includes("AS expiring_passes")) return rows(options.missingExpiryCount ? [] : [{ expiring_passes: 65 }]);
    if (sql.includes("FROM bms_board_game_member_passes")) return rows([
      { id: id(4), plan_code: "P", plan_name: "Unlimited", kind: "UNLIMITED", remaining_minutes: null, expires_at: now, location_id: null, customer_name: "PRIVATE" },
      { id: id(5), plan_code: "Q", plan_name: "Minutes", kind: "MINUTES", remaining_minutes: 60, expires_at: now, location_id: location },
    ]);
    if (sql.includes("count(*)::int AS plays")) return rows([
      { title_id: id(4), name: "Game", plays: 3, minutes: "61.4", condition_note: "PRIVATE" },
      { title_id: id(5), name: "Game2", plays: 2, minutes: "12" },
    ]);
    if (sql.includes("FROM bms_board_game_titles t WHERE")) return rows([{ id: id(4), title: "No recorded loans", customer_name: "PRIVATE" }]);
    if (sql.includes("FROM bms_board_game_copies c")) return rows([{ id: id(4), copy_code: "C1", title: "Game", status: "DAMAGED", condition_note: "PRIVATE", purchase_cost: "999" }]);
    throw new Error(`Unhandled SQL ${sql}`);
  } };
  const deps: Record<string, any> = {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (c: any, t: string, opts: any) => { assert.equal(t, tenant); assert.equal(opts.serializable, true); await c.query("BEGIN"); } },
    "./boardGameAnalyticsMath": math,
    "./boardGameCafe": {
      requireBoardGameCafeTenant: async (_c: any, t: string) => { assert.equal(t, tenant); if (options.wrongShop) throw new Error("wrong archetype"); },
      listBoardGameFloor: async (t: string, l: string) => {
        assert.equal(t, tenant); assert.equal(l, location); delegated.push("floor");
        if (options.fail) throw new Error("transport unavailable");
        return { areas: [{ id: id(7), name: "Zone", note: "PRIVATE" }], tables: [
          { id: id(4), code: "A", name: "A", seats: 4, areaId: id(7), blocked: false, occupied: true, openSession: { sessionCount: 2, status: "OPEN", alertStatus: "ACTIVE", awaitingPaymentCount: 1, guestName: "PRIVATE", amountDue: 999 } },
          { id: id(5), code: "B", name: "B", seats: 4, areaId: id(7), blocked: true, occupied: false, openSession: null },
          { id: id(6), code: "C", name: "C", seats: 4, areaId: id(7), blocked: false, occupied: true, openSession: null },
        ] };
      },
      boardGamePassOutstanding: async (t: string, branches: string[]) => {
        assert.equal(t, tenant); assert.deepEqual(branches, [location]); delegated.push("passes");
        return { activeMinutePasses: 2, activeUnlimitedPasses: 1, outstandingMinutes: 180, expiringIn30Days: 60, balanceMismatchCount: options.mismatch ? 1 : 0, customer_name: "PRIVATE" };
      },
    },
    "./boardGameWaitlist": { listBoardGameWaitlist: async (t: string, l: string) => {
      assert.equal(t, tenant); assert.equal(l, location); delegated.push("queue");
      return { waitingCount: 1, calledCount: 0, confirmedReservationCount: 1, requestedReservationCount: 1, waitingGuests: 3,
        entries: ["WAITING", "CONFIRMED", "REQUESTED", "CANCELLED"].map((status, i) => ({ id: id(10 + i), kind: i ? "RESERVATION" : "WALK_IN", status, queueNo: i, partySize: 3,
          reservedFor: i ? "2026-10-30T05:00:00Z" : null, reservedTableCode: null, guestPhone: "PRIVATE", note: "PRIVATE" })) };
    } },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  return { service: module.exports, calls, delegated, released: () => released };
}

test("owner reads deny branch/archetype before delegated or business reads and always release", async () => {
  for (const options of [{ denied: true }, { wrongShop: true }]) {
    for (const name of ["readBoardGameLiveOperations", "readBoardGamePassBalances", "readBoardGameOwnerLibrary"]) {
      const h = harness(options);
      await assert.rejects(() => h.service[name](tenant, actor, { locationId: location, view: "ATTENTION" }));
      assert.deepEqual(h.delegated, []);
      assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
      assert.equal(h.released(), true);
      assert.ok(!h.calls.some(c => c.sql.includes("FROM bms_board_game_copies")));
    }
  }
});

test("live floor counts physical occupied tables once, pages safely, omits PII and money", async () => {
  const h = harness();
  const result = await h.service.readBoardGameLiveOperations(tenant, actor, { locationId: location, limit: 1 });
  assert.equal(result.observedAt, now.toISOString());
  assert.deepEqual(result.totals, { tables: 3, occupied: 2, blocked: 1, available: 0, waiting: 1, called: 0, confirmedReservations: 1, requestedReservations: 1, waitingGuests: 3 });
  assert.equal(result.tables.rows[0].sessionCount, 2);
  assert.equal(result.tables.nextOffset, 1);
  assert.equal(result.entries.nextOffset, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|amountDue|guestPhone/);
  assert.match(result.basis, /not an atomic snapshot.*future dates.*REQUESTED is not confirmed.*No promised wait/);
  const second = await h.service.readBoardGameLiveOperations(tenant, actor, { locationId: location, limit: 1, offset: 1 });
  assert.notEqual(result.tables.rows[0].tableId, second.tables.rows[0].tableId);
  assert.equal(second.entries.rows[0].reservedFor, "2026-10-30T05:00:00Z");
  const floorSource = readFileSync(new URL("../apps/web/lib/bms/boardGameCafe.ts", import.meta.url), "utf8");
  assert.match(floorSource, /occupied: Boolean\(row.seating_id\)/, "seating, not an open session, owns the table");
});

test("passes disclose shared scope, minute units, unlimited null and drift; never identities", async () => {
  const h = harness({ mismatch: true });
  const result = await h.service.readBoardGamePassBalances(tenant, actor, { locationId: location, limit: 1 });
  assert.equal(result.complete, false);
  assert.equal(result.outstanding.expiringMinutesIn30Days, 60, "legacy expiringIn30Days is MINUTES, not contract count");
  assert.equal(result.outstanding.expiringPassesIn30Days, 65, "contract count is not the first page length");
  assert.ok(!("expiringIn30Days" in result.outstanding));
  assert.equal(result.expiring.rows[0].remainingMinutes, null);
  assert.equal(result.expiring.rows[0].allBranchPass, true);
  assert.equal(result.expiring.nextOffset, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|customer_name/);
  const count = h.calls.find(c => c.sql.includes("AS expiring_passes"))!;
  assert.match(count.sql, /p\.location_id=\$2 OR p\.location_id IS NULL/);
  assert.match(count.sql, /p\.expires_at>now\(\).*interval '30 days'/);
  assert.deepEqual(count.params, [tenant, location]);
  assert.doesNotMatch(count.sql, /LIMIT|OFFSET/);
  const q = h.calls.find(c => c.sql.includes("SELECT p.id,p.plan_code"))!;
  assert.match(q.sql, /p\.location_id=\$2 OR p\.location_id IS NULL/);
  assert.match(q.sql, /p\.expires_at>now\(\).*interval '30 days'/);
  assert.deepEqual(q.params, [tenant, location, 2, 0]);
  assert.match(result.basis, /not proof of redemption eligibility/);
  const next = await h.service.readBoardGamePassBalances(tenant, actor, { locationId: location, limit: 1, offset: 50 });
  assert.equal(next.outstanding.expiringPassesIn30Days, 65, "count is independent of offset");
});

test("library USAGE pages past 100, clips time, and tenant-scopes every join", async () => {
  const h = harness();
  const result = await h.service.readBoardGameOwnerLibrary(tenant, actor, { locationId: location, view: "USAGE", from: "2026-10-01", to: "2026-10-23", offset: 150, limit: 1 });
  assert.deepEqual(result.rows[0], { titleId: id(4), name: "Game", plays: 3, minutes: 61 });
  assert.equal(result.nextOffset, 151);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  const q = h.calls.find(c => c.sql.includes("count(*)::int AS plays"))!;
  assert.match(q.sql, /LEAST\(COALESCE\(g.returned_at,\$5\),\$3,\$5\)/);
  for (const alias of ["s", "c"]) assert.match(q.sql, new RegExp(`${alias}\\.tenant_id=g\\.tenant_id`));
  assert.match(q.sql, /t\.tenant_id=c\.tenant_id/);
  assert.equal(q.params[1].toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(q.params[2].toISOString(), "2026-10-23T17:00:00.000Z");
  assert.deepEqual(q.params.slice(3), [location, now, 2, 150]);
});

test("UNPLAYED is recorded history absence, ATTENTION reads only known condition statuses", async () => {
  const h = harness();
  const unseen = await h.service.readBoardGameOwnerLibrary(tenant, actor, { locationId: location, view: "UNPLAYED" });
  assert.match(unseen.basis, /NOT proof never physically played/);
  const q = h.calls.find(c => c.sql.includes("FROM bms_board_game_titles t WHERE"))!;
  assert.match(q.sql, /AND NOT EXISTS/);
  assert.match(q.sql, /s\.location_id=\$2/);
  assert.match(q.sql, /c\.location_id=\$2/);
  const attention = await h.service.readBoardGameOwnerLibrary(tenant, actor, { locationId: location, view: "ATTENTION" });
  assert.deepEqual(attention.rows, [{ copyId: id(4), copyCode: "C1", title: "Game", status: "DAMAGED" }]);
  const a = h.calls.find(c => c.sql.includes("SELECT c.id,c.copy_code"))!;
  assert.match(a.sql, /'NEEDS_CHECK','DAMAGED','MISSING_PARTS','REPAIRING'/);
  assert.equal(a.params[2], true);
  assert.doesNotMatch(JSON.stringify([attention, unseen]), /PRIVATE|purchase_cost|condition_note/);
});

test("bad scope/page/date never reaches transport, failures never become empty success", async () => {
  const missing = harness({ missingExpiryCount: true });
  await assert.rejects(() => missing.service.readBoardGamePassBalances(tenant, actor, { locationId: location }), /BOARD_GAME_OWNER_INVALID_RESULT/);
  assert.equal(missing.calls.at(-1)?.sql, "ROLLBACK");
  for (const input of [{ locationId: "x", view: "COPIES" }, { locationId: location, view: "COPIES", limit: 51 },
    { locationId: location, view: "USAGE", from: "2026-02-30", to: "2026-03-01" },
    { locationId: location, view: "USAGE", from: "2026-01-01", to: "2026-12-31" },
    { locationId: location, view: "UNPLAYED", from: "2026-01-01" }]) {
    const h = harness();
    await assert.rejects(() => h.service.readBoardGameOwnerLibrary(tenant, actor, input));
    assert.equal(h.calls.length, 0);
  }
  for (const name of ["readBoardGameLiveOperations", "readBoardGamePassBalances", "readBoardGameOwnerLibrary"]) {
    const h = harness({ fail: true });
    await assert.rejects(() => h.service[name](tenant, actor, { locationId: location, view: "COPIES" }), /transport unavailable/);
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
    assert.equal(h.released(), true);
  }
});
