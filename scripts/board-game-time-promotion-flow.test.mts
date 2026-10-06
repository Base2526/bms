import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as offers from "../apps/web/lib/bms/boardGameOffers.ts";
import * as coverage from "../apps/web/lib/bms/boardGamePassCoverage.ts";
import * as idempotency from "../apps/web/lib/bms/idempotencyErrors.ts";

// Exercise the public close service, real rounding, offer row mapping and pass comparison.
// SQL transport is a deterministic fixture; this does not claim PostgreSQL integration coverage.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const compiled = ts.transpileModule(readFileSync(new URL("../apps/web/lib/bms/boardGameCafe.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const tenant = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const startedAt = new Date("2026-10-06T03:00:00Z");

function harness(minutes: number, options: { active?: boolean; unlimitedPass?: boolean } = {}) {
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
  const calls: string[] = [];
  let group: any = { id: groupId, group_no: 1, status: "OPEN", amount_due: 0, tab_amount: 0, charge_snapshot: [] };
  const offerRow = { id: "offer", code: "FAKE_2_PLUS_1", name: "FAKE 2+1", kind: "TIME_BUY_GET",
    buy_minutes: 120, free_minutes: 60, min_players: 1, minimum_minutes: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6], active: options.active !== false, sort_order: 0 };
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    release() {},
    async query(sql: string, params: any[] = []) {
      calls.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) return result();
      assert.equal(params[0], tenant, "all business reads and writes are tenant scoped");
      if (sql.includes("SELECT business_archetype")) return result([{ business_archetype: "board_game_cafe" }]);
      if (sql.includes("SELECT session_id FROM")) return result([{ session_id: "session" }]);
      if (sql.includes("SELECT id, status, started_at")) return result([{ id: "session", status: "OPEN", started_at: startedAt }]);
      if (sql.includes("FROM bms_board_game_billing_groups") && sql.includes("FOR UPDATE") && !sql.includes("FROM bms_board_game_member_passes pass")) return result([group]);
      if (sql.includes("FROM bms_board_game_session_games") || sql.includes("FROM bms_board_game_identity_holds")) return result();
      if (sql.includes("FROM bms_board_game_member_passes pass")) return result(options.unlimitedPass
        ? [{ id: "pass", customer_id: "member", kind: "UNLIMITED", remaining_minutes: null }] : []);
      if (sql.includes("SELECT p.id, p.customer_id")) return result([{
        id: "player", customer_id: "member", display_name: "FAKE Player", participant_type: "GENERAL",
        billable: true, billing_group_no: 1, hourly_rate_snapshot: "50.00",
        joined_at: startedAt, actual_end_at: endedAt, charge_end_at: endedAt,
        minimum_minutes: 0, rounding_minutes: 1, grace_minutes: 0,
      }]);
      if (sql.includes("SELECT s.location_id, store.timezone")) return result([{ location_id: "branch", timezone: "Asia/Bangkok" }]);
      if (sql.includes("FROM bms_board_game_offers")) return result([offerRow]);
      if (sql.includes("SELECT DISTINCT product_sku")) return result();
      if (sql.includes("UPDATE bms_board_game_billing_groups")) {
        group = { ...group, status: "CLOSING", ended_at: params[2], amount_due: params[4],
          settlement_idempotency_key: params[5], settlement_request_hash: params[6],
          charge_snapshot: JSON.parse(params[7]) };
        return result([group]);
      }
      if (sql.includes("INSERT INTO bms_board_game_pass_ledger")) return result([{ id: "ledger" }]);
      if (sql.includes("UPDATE bms_board_game_member_passes") || sql.includes("INSERT INTO bms_audit_log")) return result();
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const dependencies: Record<string, any> = {
    crypto: require("crypto"), "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async () => client.query("BEGIN") },
    "./idempotencyErrors": idempotency, "./boardGameOffers": offers,
    "./boardGamePassCoverage": coverage,
    "./boardGameSessionStatus": { refreshSessionFromGroupsInTx: async () => {} },
    "./locations": {}, "./orders": {}, "./pos": {},
  };
  const exported: any = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected import: ${name}`);
    return dependencies[name];
  }, exported);
  return { calls, offerRow, close: () => exported.closeBoardGameBillingGroupForBilling(tenant, groupId, {
    idempotencyKey: "fake-time-promotion-close", endedAt,
  }) };
}

test("closing 2, 3 and 6 hours freezes the buy/get net charge and discount", async () => {
  for (const [minutes, net, discount] of [[120, 100, 0], [180, 100, 50], [360, 200, 100]]) {
    const h = harness(minutes);
    const closed = await h.close();
    assert.equal(closed.amountDue, net);
    assert.equal(closed.groups[0].status, "CLOSING");
    assert.equal(closed.lines[0].billableMinutes, minutes);
    assert.equal(closed.lines[0].offerCode, "FAKE_2_PLUS_1");
    assert.equal(closed.lines[0].offerDiscountAmount, discount);
    assert.equal(closed.lines[0].grossAmount - discount, net);
    assert.equal(h.calls.at(-1), "COMMIT");
    h.offerRow.free_minutes = 120;
    const replay = await h.close();
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.lines, closed.lines, "retry and later offer edits preserve the frozen bill");
    assert.equal(h.calls.filter(sql => sql.includes("UPDATE bms_board_game_billing_groups")).length, 1);
  }
});

test("an inactive offer leaves the normal fee, and a better pass wins without stacking", async () => {
  const inactive = await harness(180, { active: false }).close();
  assert.equal(inactive.amountDue, 150);
  assert.equal(inactive.lines[0].offerId, undefined);
  const pass = await harness(180, { unlimitedPass: true }).close();
  assert.equal(pass.amountDue, 0);
  assert.equal(pass.lines[0].coveredAmount, 150);
  assert.equal(pass.lines[0].offerId, undefined);
});
