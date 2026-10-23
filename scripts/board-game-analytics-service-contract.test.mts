import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as math from "../apps/web/lib/bms/boardGameAnalyticsMath.ts";
import * as evidence from "../apps/web/lib/bms/salesEvidenceMath.ts";
import { buildReturnFinancialSnapshot, readReturnFinancialSnapshot } from "../apps/web/lib/bms/returnFinancialSnapshot.ts";

// Execute the real service, substituting only transport/authentication boundaries.
// SQL assertions do not substitute for running the separate PostgreSQL suite.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/lib/bms/boardGameAnalytics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const tenant = id(1), actor = id(2), location = id(3), areaA = id(4), areaB = id(5);
const tableA = id(6), tableB = id(7), sessionId = id(8), orderId = id(9);
const day = "2026-10-01";

function harness(options: { open?: boolean; oldReturn?: boolean; costHidden?: boolean; scoped?: boolean; missingHours?: boolean; missingCost?: boolean; failAudit?: boolean; vat?: boolean; invalidVat?: boolean; earlyDeparture?: boolean; manyOffers?: boolean; opensAt?: string; futurePlayer?: boolean; missingWait?: boolean } = {}, implementation = compiled) {
  const old = options.oldReturn === true;
  const serviceDay = old ? "2026-09-30" : day;
  const start = new Date(`${serviceDay}T03:00:00Z`), moved = new Date(`${serviceDay}T04:00:00Z`), end = new Date(`${serviceDay}T05:00:00Z`);
  const now = new Date(`${day}T05:00:00Z`);
  const rows = (items: any[] = []) => ({ rows: items, rowCount: items.length });
  const calls: Array<{ sql: string; params: any[] }> = [];
  const financialSnapshot = buildReturnFinancialSnapshot({ amount: "200.00", previousRefund: "0.00", exactPricing: true, allReturned: true, previous: [],
    source: { payable: "200.00", shipping: "0.00", rounding: "0.00", extras: "100.00", taxable: options.vat ? "200.00" : "0.00", exempt: options.vat ? "0.00" : "200.00", vat: options.vat ? "13.08" : "0.00", extraTaxable: options.vat ? "100.00" : "0.00" },
    lines: [{ orderItemId: "1", amount: "200.00", vatCategory: options.vat ? "V" : "N" }],
  });
  const event: evidence.SalesEvidenceEvent = { key: `${old ? "RETURN" : "SALE"}:${orderId}`, kind: old ? "RETURN" : "SALE", day, orderId, locationId: location, channel: "pos",
    payload: old ? { amount: "200.00", financialSnapshot, lines: [{ id: "2", orderItemId: "1", amount: "200.00", qty: "1", soldQty: "1", priorQty: "0", cost: "40.00", costSource: "CATALOG_AT_SALE", actualCost: "40.00", sku: "snack" }] }
      : { net: "200.00", discount: "0.00", extras: "100.00", shipping: "0.00", rounding: "0.00", taxable: "0.00", exempt: "200.00", vat: "0.00",
        lines: [{ id: "1", qty: "1", amount: "100.00", cost: "40.00", costSource: "CATALOG_AT_SALE", actualCost: options.missingCost ? null : "40.00", sku: "snack" }] },
  };
  if (!old && options.vat) Object.assign(event.payload, { taxable: "200.00", exempt: "0.00", vat: "13.08" });
  if (options.invalidVat) event.payload.taxable = "100.00";
  event.payload.lines[0].vatCategory = options.vat ? "V" : "N";
  const client = { release() {}, async query(sql: string, params: any[] = []) {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql)) return rows();
    if (sql === "SELECT transaction_timestamp() AS now") return rows([{ now }]);
    assert.equal(params[0], tenant, "every business query is tenant scoped");
    if (sql.includes("AS scoped")) return rows([{ scoped: options.scoped === true, allowed: [location], requested_exists: true }]);
    if (sql.includes("pg_timezone_names")) return rows([{ timezone: "Asia/Bangkok" }]);
    if (sql.includes("SELECT 1 FROM bms_board_game_areas") || sql.includes("SELECT 1 FROM bms_locations")) return rows([{}]);
    if (sql.includes("FROM bms_board_game_tables t")) return rows([
      { id: tableA, location_id: location, area_id: areaA, code: "A", name: "A", seats: 4, area_name: "Area A", location_name: "Main", available: true },
      { id: tableB, location_id: location, area_id: areaB, code: "B", name: "B", seats: 4, area_name: "Area B", location_name: "Main", available: true },
    ]);
    if (sql.includes("FROM bms_board_game_branch_hours")) return rows(options.missingHours ? [] : Array.from({ length: 7 }, (_, weekday) => ({ location_id: location, weekday, opens_at: options.opensAt ?? "10:00:00", closes_at: "22:00:00", closed: false, effective_from: "2026-01-01" })));
    if (sql.includes("min((created_at")) return rows([{ date: null }]);
    if (sql.includes("FROM bms_board_game_table_occupancy")) return rows(old ? [] : [
      { id: id(10), table_id: tableA, seating_id: id(11), started_at: start, ended_at: options.open ? null : moved, backfilled: false },
      ...(!options.open ? [{ id: id(12), table_id: tableB, seating_id: id(11), started_at: moved, ended_at: end, backfilled: false }] : []),
    ].filter((row) => params[1].includes(row.table_id)));
    if (sql.includes("FROM bms_board_game_sessions s")) {
      assert.match(sql, /o\.session_id=s\.id/);
      assert.match(sql, /g\.current_order_id=ANY\(\$6::uuid\[\]\)/);
      assert.deepEqual(params[5], options.open ? [] : [orderId]);
      return rows([{ id: sessionId, table_id: tableA, seating_id: id(11), started_at: start, ended_at: options.open ? null : end, status: options.open ? "OPEN" : "PAID", guest_count: 0 }]);
    }
    if (sql.includes("FROM bms_board_game_session_table_occupancy")) {
      assert.doesNotMatch(sql, /started_at </, "allocation must retain the full path across report boundaries");
      return rows([
        { id: id(13), session_id: sessionId, table_id: tableA, started_at: start, ended_at: options.open ? null : moved },
        ...(!options.open ? [{ id: id(14), session_id: sessionId, table_id: tableB, started_at: moved, ended_at: end }] : []),
      ]);
    }
    if (sql.includes("FROM bms_board_game_billing_groups")) return rows(options.open ? [] : [{ id: id(15), session_id: sessionId, status: "PAID", amount_due: options.manyOffers ? "189.00" : "100.00",
      charge_snapshot: options.manyOffers ? Array.from({ length: 21 }, (_, i) => ({ grossAmount: 10, amount: 9, offerDiscountAmount: 1, offerId: id(30 + i), offerName: "Offer " + i })) : [{ grossAmount: 100, amount: 100 }], ended_at: end, current_order_id: orderId }]);
    if (sql.includes("FROM bms_board_game_session_participants")) {
      assert.match(sql, /LEAST\(p\.left_at,g\.ended_at\) AS left_at/, "an early-paying group's players stop before the whole visit ends");
      return rows(old ? [] : [{ session_id: sessionId, joined_at: options.futurePlayer ? new Date(now.getTime() + 3600_000) : start, left_at: options.earlyDeparture ? moved : options.open ? null : end }]);
    }
    if (sql.includes("FROM bms_board_game_waitlist")) return rows([{ entries: 0, seated: 0, no_show: 0, cancelled: 0, deposits_forfeited: "0", invalid_wait: options.missingWait ? 1 : 0 }]);
    if (sql.includes("FROM bms_payments")) { assert.doesNotMatch(sql, /OR mp\.location_id IS NULL/); return rows([{ revenue: "0", minutes: "0" }]); }
    if (sql.includes("FROM bms_board_game_session_games")) { assert.match(sql, /LEAST\(COALESCE\(loan\.returned_at,\$5\),\$3,\$5\)/); assert.equal(params[4], now); return rows(); }
    if (sql.includes("FROM bms_board_game_copies")) return rows([{ attention: 0, purchase_cost: "500.00" }]);
    if (sql.includes("INSERT INTO bms_board_game_branch_hours")) return rows();
    if (sql.includes("INSERT INTO bms_audit_log")) { if (options.failAudit) throw new Error("audit unavailable"); return rows(); }
    throw new Error(`Unhandled SQL: ${sql}`);
  } };
  const deps: Record<string, any> = {
    "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => client.query("BEGIN") },
    "./boardGameCafe": { requireBoardGameCafeTenant: async () => undefined },
    "./boardGameAnalyticsMath": math, "./salesEvidenceMath": evidence, "./returnFinancialSnapshot": { readReturnFinancialSnapshot },
    "./salesEvidence": { scanSalesEvidenceInTx: async (_c: any, _t: any, _a: any, _i: any, consume: any) => { if (!options.open) consume(event); return { truncated: false }; } },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", implementation)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  return { service: module.exports, calls, report: (areaId: string | null = null, locationId: string | null = location) => module.exports.getBoardGameAnalytics(tenant, actor,
    { from: day, to: day, locationId, areaId }, undefined, { includeCosts: !options.costHidden }) };
}

test("real service caps an open visit at database now, not the end of today", async () => {
  const report = await harness({ open: true }).report();
  assert.equal(report.totals.occupiedTableHours, 2);
  assert.equal(report.totals.guests, 1, "terminal guest_count is not historical headcount");
  assert.equal(report.totals.seatUtilizationPct, 2.08);
  assert.ok(report.issues.some((row: any) => row.code === "CURRENT_CAPACITY_BASIS"));
});

test("an early-paying group does not accrue seat-minutes until the last group leaves", async () => {
  const report = await harness({ open: true, earlyDeparture: true }).report();
  assert.equal(report.totals.occupiedTableHours, 2);
  assert.equal(report.totals.seatUtilizationPct, 1.04);
});

test("headcount follows the participant's actual area interval, never future or departed players", async () => {
  const early = harness({ earlyDeparture: true });
  assert.equal((await early.report(areaA)).totals.guests, 1);
  assert.equal((await early.report(areaB)).totals.guests, 0, "a player left before the party moved into area B");
  assert.equal((await harness({ open: true, futurePlayer: true }).report()).totals.guests, 0);
  assert.equal((await harness({ opensAt: "12:00:00" }).report()).totals.guests, 1, "opening hours cannot erase a verified player");
});

test("heatmap retains recognized revenue outside opening hours and when hours are unknown", async () => {
  for (const opts of [{ opensAt: "12:00:00" }, { missingHours: true }]) {
    const result = await harness(opts).report();
    assert.equal(result.heatmap.reduce((sum: number, row: any) => sum + Number(row.revenue), 0), 200);
    for (const hour of [10, 11]) {
      const bucket = result.heatmap.find((row: any) => row.weekday === 4 && row.hour === hour);
      assert.ok(bucket, "off-hours revenue bucket must not disappear");
      assert.equal(bucket.availableTableHours, 0);
      assert.equal(bucket.utilizationPct, null);
      assert.equal(bucket.revenue, "100.00");
    }
  }
});

test("reservation wait starts at check-in; missing or invalid arrival evidence stays unknown", async () => {
  const h = harness({ missingWait: true });
  const result = await h.report();
  const q = h.calls.find(c => c.sql.includes("FROM bms_board_game_waitlist"))!;
  assert.match(q.sql, /CASE WHEN kind='RESERVATION' THEN checked_in_at ELSE created_at END AS wait_started_at/);
  assert.match(q.sql, /seated_at-wait_started_at/);
  assert.match(q.sql, /wait_started_at <= seated_at/);
  assert.match(q.sql, /wait_started_at IS NULL/);
  assert.equal(q.params[4].toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(result.totals.waitlist.avgWaitMinutes, null);
  assert.ok(result.issues.some((row: any) => row.code === "WAIT_TIME_INCOMPLETE"));
  assert.equal(result.complete, false);
});

test("real compiled-service mutants are killed by numeric and permission witnesses", async () => {
  const mutations = [
    { before: "observedEnd(row.ended_at, observedAt, bounds.end)", after: "observedEnd(row.ended_at, bounds.end, bounds.end)", options: { open: true }, area: null,
      verify: (r: any) => assert.equal(r.totals.occupiedTableHours, 2) },
    { before: "distribute(amount, spans).filter", after: "distribute(amount, spans.filter((span) => selectedTableIds.has(span.tableId))).filter", options: {}, area: areaA,
      verify: (r: any) => assert.equal(r.totals.netPlay, "50.00") },
    { before: "revenue = -inspected.amounts.returnKnownMerchandiseGross", after: "revenue = -inspected.amounts.returnClaim", options: { oldReturn: true }, area: null,
      verify: (r: any) => assert.equal(r.totals.tabRevenue, "-100.00") },
    { before: "purchaseCostTotal: options.includeCosts &&", after: "purchaseCostTotal: true &&", options: { costHidden: true }, area: null,
      verify: (r: any) => assert.equal(r.library.purchaseCostTotal, null) },
    { before: "hours: rows.map((row) => ({ ...row, effectiveFrom: input.effectiveFrom }))", after: "hours: rows", options: {}, area: null,
      verify: null },
  ];
  for (const mutation of mutations) {
    assert.ok(source.includes(mutation.before), `mutation target exists: ${mutation.before}`);
    const changed = ts.transpileModule(source.replace(mutation.before, mutation.after), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const h = harness(mutation.options, changed);
    if (mutation.verify) {
      const result = await h.report(mutation.area);
      assert.throws(() => mutation.verify!(result), assert.AssertionError, `mutant survived: ${mutation.before}`);
    } else {
      const result = await h.service.upsertBoardGameBranchHours(tenant, actor, { locationId: location, effectiveFrom: day, hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "10:00", closesAt: "22:00", closed: false })) });
      assert.throws(() => assert.equal(result.hours[0].effectiveFrom, day), assert.AssertionError);
    }
  }
});

test("every panel GraphQL document validates against the exported schema", () => {
  const { buildSchema, parse, validate } = require("./node_modules/graphql/index.js");
  const schema = buildSchema(readFileSync(new URL("../schema.graphql", import.meta.url), "utf8"));
  const panel = readFileSync(new URL("../apps/web/app/(admin)/admin/board-game/BoardGameAnalyticsPanel.tsx", import.meta.url), "utf8");
  const documents = [...panel.matchAll(/gql`([\s\S]*?)`/g)];
  assert.equal(documents.length, 4);
  for (const [, document] of documents) assert.deepEqual(validate(schema, parse(document)), []);
});

test("real resolvers enforce RBAC, server-derived identity, cost disclosure and typed rejection", async () => {
  const graphqlSource = readFileSync(new URL("../apps/web/graphql/bmsBoardGameAnalytics.ts", import.meta.url), "utf8");
  const graphqlCompiled = ts.transpileModule(graphqlSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let permissions = new Set<string>();
  let serviceCalls = 0;
  let domainError: Error | null = null;
  let lastArgs: any[] = [];
  const deps: Record<string, any> = {
    "graphql/error": require("./node_modules/graphql/error/index.js"),
    "@/lib/auth": { requireAuth: () => ({ author_id: actor }) },
    "@/lib/bms/tenant": { getTenantId: () => tenant },
    "@/lib/bms/permissions": {
      loadPermissions: async () => permissions,
      requirePermission: async (_ctx: any, permission: string) => { if (!permissions.has(permission)) throw new Error("FORBIDDEN"); },
    },
    "@/lib/bms/boardGameAnalytics": {
      getBoardGameAnalytics: async (...args: any[]) => { serviceCalls++; lastArgs = args; if (domainError) throw domainError; return { complete: true }; },
      listBoardGameBranchHours: async () => { serviceCalls++; return []; },
      upsertBoardGameBranchHours: async () => { serviceCalls++; return { hours: [] }; },
    },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", graphqlCompiled)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  const resolvers = module.exports.bmsBoardGameAnalyticsResolvers;
  const input = { from: day, to: day, locationId: location };
  await assert.rejects(resolvers.Query.bmsBoardGameAnalytics(null, { input }, {}), /FORBIDDEN/);
  await assert.rejects(resolvers.Query.bmsBoardGameBranchHours(null, { locationId: location }, {}), /FORBIDDEN/);
  await assert.rejects(resolvers.Mutation.bmsUpsertBoardGameBranchHours(null, { input: {} }, {}), /FORBIDDEN/);
  assert.equal(serviceCalls, 0);
  permissions = new Set(["report.view"]);
  const result = await resolvers.Query.bmsBoardGameAnalytics(null, { input }, { tenantId: "forged-client-scope" });
  assert.equal(result.status, "OK"); assert.equal(lastArgs[0], tenant); assert.equal(lastArgs[1], actor);
  assert.deepEqual(lastArgs[4], { includeCosts: false });
  permissions.add("product.view"); permissions.add("tax.document.view");
  await resolvers.Query.bmsBoardGameAnalytics(null, { input }, {});
  assert.deepEqual(lastArgs[4], { includeCosts: true });
  domainError = new Error("BOARD_GAME_ANALYTICS_INVALID_DATE");
  assert.deepEqual(await resolvers.Query.bmsBoardGameAnalytics(null, { input }, {}), {
    status: "BAD_USER_INPUT", code: "BOARD_GAME_ANALYTICS_INVALID_DATE", report: null, hours: [],
  });
  domainError = new Error("unexpected database failure");
  await assert.rejects(resolvers.Query.bmsBoardGameAnalytics(null, { input }, {}), /unexpected database failure/);
});

test("area selection preserves proportional money and reconciles to all tables", async () => {
  const all = await harness().report(), a = await harness().report(areaA), b = await harness().report(areaB);
  assert.equal(all.totals.netPlay, "100.00"); assert.equal(all.totals.tabRevenue, "100.00");
  assert.equal(a.totals.netPlay, "50.00"); assert.equal(b.totals.netPlay, "50.00");
  assert.equal(a.totals.tabRevenue, "50.00"); assert.equal(a.totals.tabCost, "20.00");
  assert.equal(a.byTable.length, 1); assert.equal(a.byTable[0].revenue, "100.00");
  assert.equal(evidence.evidenceCents(a.totals.tabRevenue) + evidence.evidenceCents(b.totals.tabRevenue), evidence.evidenceCents(all.totals.tabRevenue));
});

test("return of an older visit reverses merchandise and play separately without rebooking old sales", async () => {
  const report = await harness({ oldReturn: true }).report();
  assert.equal(report.totals.sessions, 0); assert.equal(report.totals.paidSessions, 0);
  assert.equal(report.totals.grossPlay, "0.00"); assert.equal(report.totals.playReturns, "100.00");
  assert.equal(report.totals.netPlay, "-100.00"); assert.equal(report.totals.tabRevenue, "-100.00");
  assert.equal(report.totals.tabCost, "-40.00");
  assert.equal(report.byTable[0].revenue, "-100.00");
});

test("cost permission hides product AND library purchase costs; missing hours hide heatmap percentages", async () => {
  const hidden = await harness({ costHidden: true }).report();
  assert.equal(hidden.totals.tabCost, null); assert.equal(hidden.library.purchaseCostTotal, null);
  assert.ok(hidden.issues.some((row: any) => row.code === "COST_HIDDEN"));
  const missing = await harness({ missingCost: true }).report();
  assert.equal(missing.totals.tabGrossProfit, null); assert.equal(missing.complete, false);
  const noHours = await harness({ missingHours: true }).report();
  assert.equal(noHours.totals.utilizationPct, null); assert.ok(noHours.heatmap.every((row: any) => row.utilizationPct === null));
  assert.equal(noHours.totals.netPlay, "100.00", "hours are not a revenue filter");
});

test("gross profit excludes allocated VAT on both sale and full return", async () => {
  const sale = await harness({ vat: true }).report();
  assert.equal(sale.totals.tabRevenue, "100.00");
  assert.equal(sale.totals.tabRevenueExVat, "93.46");
  assert.equal(sale.totals.tabGrossProfit, "53.46");
  const returned = await harness({ oldReturn: true, vat: true }).report();
  assert.equal(returned.totals.tabRevenueExVat, "-93.46");
  assert.equal(returned.totals.tabGrossProfit, "-53.46");
  const invalid = await harness({ vat: true, invalidVat: true }).report();
  assert.equal(invalid.totals.tabCost, "40.00");
  assert.equal(invalid.totals.tabGrossProfit, null);
  assert.ok(invalid.issues.some((row: any) => row.code === "VAT_EVIDENCE_INCOMPLETE"));
});

test("scoped staff cannot request all branches and validation rolls back safely", async () => {
  const h = harness({ scoped: true });
  await assert.rejects(h.report(null, null), /ALL_BRANCH_ACCESS_REQUIRED/);
  assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
  await assert.rejects(h.service.getBoardGameAnalytics(tenant, actor, { from: "2026-13-01", to: day }), /INVALID_DATE/);
});

test("full offer aggregation is opt-in; existing report and export keep the twenty-offer limit", async () => {
  const h = harness({ manyOffers: true });
  assert.equal((await h.report()).topOffers.length, 20);
  const full = await h.service.getBoardGameAnalytics(tenant, actor, { from: day, to: day, locationId: location }, undefined, { includeCosts: false, includeAllOffers: true });
  assert.equal(full.topOffers.length, 21);
  assert.ok(full.topOffers.every((o: any) => o.uses === 1 && o.discount === "1.00"));
});

test("saving all seven hours returns GraphQL-required effectiveFrom and audits atomically", async () => {
  const input = { locationId: location, effectiveFrom: day, hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "10:00", closesAt: "22:00", closed: false })) };
  const h = harness(), result = await h.service.upsertBoardGameBranchHours(tenant, actor, input);
  assert.equal(result.hours.length, 7); assert.ok(result.hours.every((row: any) => row.effectiveFrom === day));
  assert.equal(h.calls.filter((call) => call.sql.includes("INSERT INTO bms_board_game_branch_hours")).length, 7);
  assert.equal(h.calls.at(-1)?.sql, "COMMIT");
  const failed = harness({ failAudit: true });
  await assert.rejects(failed.service.upsertBoardGameBranchHours(tenant, actor, input), /audit unavailable/);
  assert.equal(failed.calls.at(-1)?.sql, "ROLLBACK");
});
