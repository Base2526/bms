import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as offers from "../apps/web/lib/bms/boardGameOffers.ts";
import * as coverage from "../apps/web/lib/bms/boardGamePassCoverage.ts";
import * as idempotency from "../apps/web/lib/bms/idempotencyErrors.ts";
import { POS_BOARD_GAME_CHECKOUT_QUERY } from "../apps/web/lib/pos/mobileFlowGraphql.ts";

// Exercise the public close service, real rounding, offer row mapping and pass comparison.
// SQL transport is a deterministic fixture; this does not claim PostgreSQL integration coverage.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
test("checkout query validates its frozen offer evidence against the committed schema", () => {
  const { buildSchema, parse, validate } = require("./node_modules/graphql/index.js");
  const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
  assert.deepEqual(validate(schema, parse(POS_BOARD_GAME_CHECKOUT_QUERY)), []);
});
const compiled = ts.transpileModule(readFileSync(new URL("../apps/web/lib/bms/boardGameCafe.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const tenant = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const branchId = "33333333-3333-4333-8333-333333333333";
const startedAt = new Date("2026-10-06T03:00:00Z");

function harness(minutes: number, options: {
  active?: boolean; unlimitedPass?: boolean; passMinutes?: number;
  players?: Array<Record<string, any>>; offer?: Record<string, any>;
  products?: string[]; failSnapshot?: boolean; noOffers?: boolean;
} = {}) {
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
  const calls: string[] = [];
  let group: any = { id: groupId, group_no: 1, status: "OPEN", amount_due: 0, tab_amount: 0, charge_snapshot: [] };
  const offerRow = { id: "offer", code: "FAKE_2_PLUS_1", name: "FAKE 2+1", kind: "TIME_BUY_GET",
    buy_minutes: 120, free_minutes: 60, min_players: 1, minimum_minutes: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6], active: options.active !== false, sort_order: 0,
    ...options.offer };
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    release() {},
    async query(sql: string, params: any[] = []) {
      calls.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock")) return result();
      assert.equal(params[0], tenant, "all business reads and writes are tenant scoped");
      if (sql.includes("SELECT business_archetype")) return result([{ business_archetype: "board_game_cafe" }]);
      if (sql.includes("SELECT g.id, g.status, g.group_no, g.ended_at")) {
        assert.match(sql, /g\.tenant_id = \$1 AND g\.location_id = \$2 AND g\.id = \$3/);
        assert.match(sql, /g\.status = 'CLOSING'/);
        assert.deepEqual(params, [tenant, branchId, groupId]);
        return result([{ ...group, started_at: startedAt, billing_mode: "OPEN_ENDED", session_group_count: 1,
          table_code: "FAKE", table_name: "FAKE Table", tab_item_count: 0,
          pass_covered_amount: group.charge_snapshot.reduce((sum: number, line: any) => sum + (line.coveredAmount ?? 0), 0),
          offer_discount_amount: group.charge_snapshot.reduce((sum: number, line: any) => sum + (line.offerDiscountAmount ?? 0), 0),
          offer_code: group.charge_snapshot[0]?.offerCode, offer_name: group.charge_snapshot[0]?.offerName }]);
      }
      if (sql.includes("SELECT id, participant_type, rate_code_snapshot")) return result();
      if (sql.includes("SELECT session_id FROM")) return result([{ session_id: "session" }]);
      if (sql.includes("SELECT id, status, started_at")) return result([{ id: "session", status: "OPEN", started_at: startedAt }]);
      if (sql.includes("FROM bms_board_game_billing_groups") && sql.includes("FOR UPDATE") && !sql.includes("FROM bms_board_game_member_passes pass")) return result([group]);
      if (sql.includes("FROM bms_board_game_session_games") || sql.includes("FROM bms_board_game_identity_holds")) return result();
      if (sql.includes("FROM bms_board_game_member_passes pass")) {
        assert.match(sql, /FOR UPDATE/, "close must lock the pass budget before pricing");
        return result(options.unlimitedPass || options.passMinutes != null
          ? [{ id: "pass", customer_id: "member", kind: options.unlimitedPass ? "UNLIMITED" : "MINUTES",
            remaining_minutes: options.passMinutes ?? null }] : []);
      }
      if (sql.includes("SELECT p.id, p.customer_id")) return result((options.players ?? [{}]).map((player, index) => ({
        id: `player-${index}`, customer_id: "member", display_name: "FAKE Player", participant_type: "GENERAL",
        billable: true, billing_group_no: 1, hourly_rate_snapshot: "50.00",
        joined_at: startedAt, actual_end_at: endedAt, charge_end_at: endedAt,
        minimum_minutes: 0, rounding_minutes: 1, grace_minutes: 0,
        ...player,
      })));
      if (sql.includes("SELECT s.location_id, store.timezone")) return result([{ location_id: "branch", timezone: "Asia/Bangkok" }]);
      if (sql.includes("FROM bms_board_game_offers")) {
        assert.match(sql, /tenant_id = \$1 AND active AND \(location_id IS NULL OR location_id = \$2\)/);
        assert.equal(params[1], "branch");
        return result(options.noOffers ? [] : [offerRow]);
      }
      if (sql.includes("SELECT DISTINCT product_sku")) {
        assert.match(sql, /billing_group_id = \$2 AND status = 'ACTIVE'/);
        assert.equal(params[1], groupId);
        return result((options.products ?? []).map(product_sku => ({ product_sku })));
      }
      if (sql.includes("UPDATE bms_board_game_billing_groups")) {
        if (options.failSnapshot) throw new Error("fixture snapshot failure");
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
    crypto: require("crypto"), "@/lib/db": { getClient: async () => client, query: client.query },
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
  return { calls, offerRow,
    checkout: () => exported.getBoardGameCheckoutForPos(tenant, branchId, groupId),
    removeLegacyEvidence: () => { for (const line of group.charge_snapshot) delete line.offerEvaluation; },
    close: (override: Record<string, unknown> = {}) => exported.closeBoardGameBillingGroupForBilling(tenant, groupId, {
    idempotencyKey: "fake-time-promotion-close", endedAt,
    ...override,
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
    assert.equal(closed.lines[0].offerPaidMinutes, net * 60 / 50);
    assert.equal(closed.lines[0].offerFreeMinutes, minutes - net * 60 / 50);
    assert.equal(closed.lines[0].offerEvaluation.status, discount > 0 ? "APPLIED" : "NO_SAVING");
    assert.equal(closed.lines[0].grossAmount - discount, net);
    assert.equal(h.calls.at(-1), "COMMIT");
    h.offerRow.free_minutes = 120;
    const replay = await h.close();
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.lines, closed.lines, "retry and later offer edits preserve the frozen bill");
    assert.equal(h.calls.filter(sql => sql.includes("UPDATE bms_board_game_billing_groups")).length, 1);
  }
});

test("rounding, grace and minimum time precede repeating buy/get pricing", async () => {
  for (const [actual, rules, billable, amount] of [
    [119, { rounding_minutes: 30 }, 120, 100],
    [121, { rounding_minutes: 30 }, 150, 100],
    [180, { rounding_minutes: 30 }, 180, 100],
    [181, { rounding_minutes: 30 }, 210, 125],
    [181, { rounding_minutes: 30, grace_minutes: 5 }, 180, 100],
    [10, { minimum_minutes: 60 }, 60, 50],
    [3, { grace_minutes: 5 }, 0, 0],
  ] as const) {
    const closed = await harness(actual, { players: [rules] }).close();
    assert.equal(closed.lines[0].billableMinutes, billable, `${actual} actual minutes`);
    assert.equal(closed.amountDue, amount);
  }
});

test("players retain separate durations/rates; spectators and zero rates add no charge", async () => {
  const closed = await harness(180, { players: [
    {},
    { hourly_rate_snapshot: "30", joined_at: new Date(startedAt.getTime() + 120 * 60_000) },
    { billable: false },
    { hourly_rate_snapshot: "0" },
  ] }).close();
  assert.deepEqual(closed.lines.map((line: any) => line.amount), [100, 30, 0]);
  assert.equal(closed.amountDue, 130, "one player's free hour cannot cover a later arrival");
});

test("eligibility uses close-time dates, shop clock, headcount, minimum and real tab SKU", async () => {
  // Fixture closes at 13:00 Tuesday in Asia/Bangkok.
  for (const offer of [
    { valid_from: "2026-10-06T06:00:01Z" },
    { valid_until: "2026-10-06T06:00:00Z" },
    { weekdays: [1] }, { starts_local_time: "14:00", ends_local_time: "18:00" },
    { starts_local_time: "10:00", ends_local_time: "13:00" },
    { min_players: 2 }, { minimum_minutes: 181 },
    { required_product_sku: "FAKE-DRINK" },
  ]) {
    assert.equal((await harness(180, { offer }).close()).amountDue, 150, JSON.stringify(offer));
  }
  assert.equal((await harness(180, { offer: { max_players: 1 }, players: [{}, {}] }).close()).amountDue, 300);
  const closed = await harness(180, { offer: {
    valid_from: "2026-10-06T06:00:00Z", valid_until: "2026-10-07T00:00:00Z",
    weekdays: [2], starts_local_time: "13:00", ends_local_time: "18:00",
    min_players: 1, max_players: 1, minimum_minutes: 180, required_product_sku: "FAKE-DRINK",
  }, products: ["FAKE-DRINK"] }).close();
  assert.equal(closed.amountDue, 100);
});

test("actual-time screenshot fixture receives repeating 2+1 without a purchased boundary", async () => {
  const closed = await harness(1457, { players: [
    { hourly_rate_snapshot: "30", rounding_minutes: 15, grace_minutes: 5 },
    { hourly_rate_snapshot: "50", rounding_minutes: 30 },
    { hourly_rate_snapshot: "50", rounding_minutes: 30 },
    { hourly_rate_snapshot: "30", rounding_minutes: 15, grace_minutes: 5 },
  ] }).close();
  assert.equal(closed.amountDue, 2625);
  assert.deepEqual(closed.lines.map((line: any) => line.billableMinutes), [1455, 1470, 1470, 1455]);
  assert.deepEqual(closed.lines.map((line: any) => line.offerPaidMinutes), [975, 990, 990, 975]);
  assert.deepEqual(closed.lines.map((line: any) => line.offerFreeMinutes), [480, 480, 480, 480]);
  assert.equal(closed.lines.reduce((sum: number, line: any) => sum + line.grossAmount, 0), 3905);
  assert.equal(closed.lines.reduce((sum: number, line: any) => sum + line.offerDiscountAmount, 0), 1280);
  assert.equal(closed.lines.filter((line: any) => line.offerEvaluation).length, 1);
});

test("actual and purchased-time boundaries use the same promotion, without extending a timer", async () => {
  const actual = await harness(180).close();
  const purchased = await harness(120, { players: [{ charge_end_at: new Date(startedAt.getTime() + 180 * 60_000) }] }).close();
  for (const closed of [actual, purchased]) {
    assert.equal(closed.amountDue, 100);
    assert.equal(closed.lines[0].offerFreeMinutes, 60);
    assert.equal(closed.lines[0].billableMinutes, 180);
  }
  assert.equal(actual.lines[0].actualMinutes, 180);
  assert.equal(purchased.lines[0].actualMinutes, 120);
  const only120 = await harness(120).close();
  assert.equal(only120.lines[0].offerFreeMinutes, 0);
  assert.equal(only120.lines[0].billableMinutes, 120);
});

test("failed eligibility explains the same predicate that excluded the offer, frozen on retry", async () => {
  for (const [offer, reason] of [
    [{ active: false }, "INACTIVE"], [{ min_players: 2 }, "MIN_PLAYERS"],
    [{ max_players: 0 }, "MAX_PLAYERS"], [{ free_minutes: 0 }, "INVALID_TIME_RULE"],
    [{ minimum_minutes: 181 }, "MINIMUM_MINUTES"], [{ required_product_sku: "FAKE-DRINK" }, "REQUIRED_PRODUCT"],
    [{ valid_from: "2026-10-06T06:00:01Z" }, "NOT_STARTED"],
    [{ valid_until: "2026-10-06T06:00:00Z" }, "EXPIRED"],
    [{ weekdays: [1] }, "WEEKDAY"], [{ starts_local_time: "14:00", ends_local_time: "18:00" }, "TIME_WINDOW"],
  ] as const) {
    const h = harness(180, { offer });
    const closed = await h.close();
    assert.equal(closed.amountDue, 150);
    const evaluation = closed.lines[0].offerEvaluation;
    assert.equal(evaluation.status, "INELIGIBLE");
    assert.equal(evaluation.checks[0].reason, reason);
    assert.equal(evaluation.evaluatedAt, "2026-10-06T06:00:00.000Z");
    h.offerRow.minimum_minutes = 0;
    h.offerRow.active = true;
    h.offerRow.weekdays = [0, 1, 2, 3, 4, 5, 6];
    assert.deepEqual((await h.close()).lines, closed.lines);
  }
});

test("no configured offer, a better pass and zero charge have distinct explanations", async () => {
  for (const [options, expected] of [
    [{ noOffers: true }, "NO_ACTIVE_OFFERS"], [{ passMinutes: 120 }, "PASS_BETTER"],
    [{ players: [{ hourly_rate_snapshot: 0 }] }, "NO_CHARGE"],
  ] as const) {
    const closed = await harness(180, options).close();
    assert.equal(closed.lines[0].offerEvaluation.status, expected);
    assert.deepEqual(closed.lines[0].offerEvaluation.checks, []);
    assert.equal(closed.lines[0].offerFreeMinutes, undefined);
  }
  for (const legacy of [undefined, null, {}, { status: "APPLIED" }, { status: "unknown" }]) {
    assert.equal(offers.readBoardGameOfferEvaluation(legacy), null);
  }
});

test("checkout reads frozen evaluation and paid/free minutes without re-reading offers", async () => {
  const h = harness(180);
  const closed = await h.close();
  h.calls.length = 0;
  h.offerRow.active = false;
  const checkout = await h.checkout();
  assert.equal(checkout.amountDue, 100);
  assert.equal(checkout.chargeLines[0].offerPaidMinutes, 120);
  assert.equal(checkout.chargeLines[0].offerFreeMinutes, 60);
  assert.deepEqual(checkout.offerEvaluation, closed.lines[0].offerEvaluation);
  assert.equal(h.calls.some(sql => sql.includes("FROM bms_board_game_offers")), false);
  h.removeLegacyEvidence();
  const legacy = await h.checkout();
  assert.equal(legacy.offerEvaluation, null);
  assert.equal(legacy.amountDue, 100);
  assert.equal(h.calls.some(sql => sql.includes("UPDATE")), false);
});

test("equal-priced time offer preserves pass minutes; a better pass alone is consumed once", async () => {
  const tie = harness(180, { passMinutes: 60 });
  const tied = await tie.close();
  assert.equal(tied.amountDue, 100);
  assert.equal(tied.lines[0].passId, null);
  assert.equal(tie.calls.some(sql => sql.includes("INSERT INTO bms_board_game_pass_ledger")), false);
  const betterPass = harness(180, { passMinutes: 120 });
  const covered = await betterPass.close();
  assert.equal(covered.amountDue, 50);
  assert.equal(covered.lines[0].coveredMinutes, 120);
  assert.equal(covered.lines[0].offerId, undefined);
  await betterPass.close();
  assert.equal(betterPass.calls.filter(sql => sql.includes("INSERT INTO bms_board_game_pass_ledger")).length, 1);
});

test("conflicting retries cannot reprice a closed bill; snapshot failure rolls back before pass spend", async () => {
  const closed = harness(180);
  await closed.close();
  await assert.rejects(closed.close({ idempotencyKey: "different-request" }), idempotency.IdempotencyConflictError);
  await assert.rejects(closed.close({ endedAt: new Date(startedAt.getTime() + 240 * 60_000) }), idempotency.IdempotencyConflictError);
  assert.equal(closed.calls.filter(sql => sql.includes("UPDATE bms_board_game_billing_groups")).length, 1);
  const failing = harness(180, { passMinutes: 120, failSnapshot: true });
  await assert.rejects(failing.close(), /fixture snapshot failure/);
  assert.equal(failing.calls.at(-1), "ROLLBACK");
  assert.equal(failing.calls.includes("COMMIT"), false);
  assert.equal(failing.calls.some(sql => sql.includes("INSERT INTO bms_board_game_pass_ledger")), false);
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
