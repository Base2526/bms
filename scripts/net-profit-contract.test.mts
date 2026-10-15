import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { buildSchema, graphql } from "../apps/web/node_modules/graphql/index.js";
import * as math from "../apps/web/lib/bms/netProfitMath.ts";
import * as driver from "../apps/web/lib/bms/costAllocationMath.ts";
import * as costs from "../apps/web/lib/bms/operatingCostMath.ts";
import { buildReturnFinancialSnapshot } from "../apps/web/lib/bms/returnFinancialSnapshot.ts";
import type { SalesEvidenceEvent } from "../apps/web/lib/bms/salesEvidenceMath.ts";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sale = (patch: any = {}, branch = 1, channel = "pos"): SalesEvidenceEvent => ({
  key: `SALE:${branch}:${channel}`, orderId: id(99), locationId: id(branch), channel, day: "2026-10-01", kind: "SALE",
  payload: { net: "107.00", discount: "0.00", extras: "0.00", shipping: "0.00", rounding: "0.00", taxable: "107.00", exempt: "0.00", vat: "7.00",
    lines: [{ id: "1", sku: "SOUP", size: "BOWL", qty: "1", amount: "107.00", cost: "40.00", costSource: "CATALOG_AT_SALE" }], ...patch } });
const expense = (amount = "10.00", classification = "OPERATING", channel: string | null = "pos", branch = 1) => ({
  sourceKey: `DOCUMENT:${classification}:${branch}:${channel}`, amount, classification, state: "CURRENT",
  snapshot: { allocations: [{ locationId: id(branch), channel, amount }] } });
const allocations = (rows: any[] = [expense()], patch: any = {}) => ({
  complete: true, truncated: false, reviewedTotal: rows.reduce((n, r) => n + Number(r.amount ?? 0), 0).toFixed(2), rows,
  locations: [1, 2].map(n => ({ id: id(n), name: `Branch ${n}` })), ...patch });
const scan = { truncated: false, limitCode: "EVENT_LIMIT" };
const run = (events: SalesEvidenceEvent[] = [sale()], alloc = allocations(), gaps: math.ProfitGap[] = [], trunc = false) => {
  const c = math.createNetProfitAccumulator(); events.forEach(c.add); return c.finish(alloc, { ...scan, truncated: trunc }, gaps);
};
const returned = (patch: any = {}): SalesEvidenceEvent => {
  const financialSnapshot = buildReturnFinancialSnapshot({ amount: "107.00", previousRefund: "0.00", exactPricing: true, allReturned: true,
    source: { payable: "107.00", shipping: "0.00", rounding: "0.00", extras: "0.00", taxable: "107.00", exempt: "0.00", vat: "7.00", extraTaxable: "0.00" },
    lines: [{ orderItemId: "1", amount: "107.00", vatCategory: "V" }], previous: [] });
  return { ...sale(), key: "RETURN:1", kind: "RETURN", locationId: id(2), day: "2026-10-02", payload: { amount: "107.00", financialSnapshot,
    lines: [{ orderItemId: "1", qty: "1", soldQty: "1", priorQty: "0", amount: "107.00", cost: "40.00", costSource: "CATALOG_AT_SALE" }], ...patch } };
};
test("recorded monthly profit deducts reviewed expenses once, uses historical costs and decimal strings", () => {
  const r = run(); assert.equal(r.totals.netRevenue, "100.00"); assert.equal(r.totals.netCost, "40.00");
  assert.equal(r.totals.grossProfit, "60.00"); assert.equal(r.totals.netProfit, "50.00");
  assert.equal(r.complete, true); assert.equal(r.branches[0].netProfit, "50.00"); assert.equal(r.channels[0].netProfit, "50.00");
});
test("discount, extras, shipping, VAT and signed rounding reconcile without double subtraction", () => {
  const s = sale({ net: "100.00", discount: "10.00", extras: "10.00", shipping: "7.00", rounding: "-0.25",
    lines: [{ id: "1", qty: "1", amount: "100.00", cost: "40.00", costSource: "CATALOG_AT_SALE" }] });
  const r = run([s], allocations([expense("20.00"), expense("10.00", "GP"), expense("5.00", "DEPRECIATION")]));
  assert.equal(r.totals.netRevenue, "99.75"); assert.equal(r.totals.expenseTotal, "35.00"); assert.equal(r.totals.netProfit, "24.75");
  s.payload.rounding = "0.25"; assert.equal(run([s]).totals.netRevenue, "100.25");
});
test("negative supplier credits and losses retain signs; no income-tax guess or margin division", () => {
  assert.equal(run([sale()], allocations([expense("-10.01")])).totals.netProfit, "70.01");
  assert.equal(run([sale()], allocations([expense("100.01")])).totals.netProfit, "-40.01");
  assert.equal(run([], allocations([expense("10.00")])).totals.netProfit, "-10.00");
});
test("return revenue uses frozen components but quantity cost basis never becomes a claimed cost reversal", () => {
  const r = run([sale(), returned()]);
  assert.equal(r.totals.netRevenue, "0.00"); assert.equal(r.totals.knownReturnRevenue, "100.00");
  assert.equal(r.totals.returnQuantityCostBasis, "40.00"); assert.equal(r.totals.knownSalesCost, "40.00");
  assert.equal(r.totals.netCost, null); assert.equal(r.totals.netProfit, null);
  assert.ok(r.issues.some(i => i.code === "RETURN_COST_REVERSAL_UNVERIFIED"));
  assert.equal(r.branches.find(b => b.locationId === id(2))!.netRevenue, "-100.00");
});
test("prior-period returns do not require same-month sale or fabricate positive profit", () => {
  const r = run([returned()], allocations([])); assert.equal(r.totals.netRevenue, "-100.00"); assert.equal(r.totals.netProfit, null);
});
test("completed cash/noncash refunds and CREDIT reductions are separate diagnostics, never double expenses", () => {
  const events = [sale(), ...["CASH", "CARD", "CREDIT"].map((method, i) => ({ ...sale(), kind: "REFUND" as const, key: `REFUND:${i}`, payload: { method, amount: "20.00" } }))];
  const r = run(events); assert.equal(r.totals.refundCompleted, "40.00"); assert.equal(r.totals.creditReductionCompleted, "20.00");
  assert.equal(r.totals.netProfit, "50.00");
});
test("missing or legacy reconstructed cost is unknown, not zero or today's catalog", () => {
  for (const costSource of ["MISSING", "LEGACY_CURRENT", "INVALID"]) {
    const s = sale(); s.payload.lines[0].costSource = costSource;
    const r = run([s]); assert.equal(r.totals.netRevenue, "100.00"); assert.equal(r.totals.netCost, null);
    assert.equal(r.totals.knownSalesCost, "0.00"); assert.equal(r.totals.netProfit, null);
  }
});
test("missing VAT, old dates, cancelled sales and mismatched totals never supply complete revenue", () => {
  for (const patch of [{ taxable: "0.00" }, { legacyDate: true }, { cancelledWithoutReturn: true }, { net: "108.00" }, { lines: Array(1001).fill({}) }]) {
    const r = run([sale(patch)]); assert.equal(r.totals.netRevenue, null); assert.equal(r.complete, false);
  }
});
test("legacy or mismatched return snapshots do not hide unknown return revenue", () => {
  for (const patch of [{ financialSnapshot: null }, { lines: [] }, { amount: "108.00" }]) {
    const r = run([returned(patch)]); assert.equal(r.totals.netRevenue, null); assert.equal(r.totals.netProfit, null);
  }
});
test("tax notes, unallocated payment refunds and backoffice returns are not blindly subtracted", () => {
  for (const kind of ["TAX_ADJUSTMENT", "PAYMENT_REFUND", "BACKOFFICE_RETURN"] as const) {
    const r = run([sale(), { ...sale(), kind, key: kind, payload: { amount: "107.00", docType: "CREDIT_NOTE" } }]);
    assert.equal(r.totals.knownReturnRevenue, "0.00"); assert.equal(r.totals.netRevenue, null); assert.equal(r.totals.netProfit, null);
  }
});
test("whole-tenant profit can be known before allocation; grouped profit cannot", () => {
  for (const state of ["UNALLOCATED", "STALE"]) {
    const r = run([sale()], allocations([{ ...expense(), state }], { complete: false }));
    assert.equal(r.totals.netProfit, "50.00"); assert.equal(r.branches[0].netProfit, null);
    assert.equal(r.branches[0].knownExpenseTotal, "0.00");
  }
});
test("unknown reviewed expense blocks all full profit totals but preserves known subtotals", () => {
  const r = run([sale()], allocations([expense()], { complete: false, reviewedTotal: null }));
  assert.equal(r.totals.knownExpenseTotal, "10.00"); assert.equal(r.totals.expenseTotal, null); assert.equal(r.totals.netProfit, null);
});
test("a disappeared allocated expense source cannot silently become zero whole-tenant cost", () => {
  const missing = { ...expense(), amount: null, classification: "MISSING", state: "STALE" };
  const r = run([sale()], allocations([missing], { complete: false, reviewedTotal: "0.00" }));
  assert.equal(r.totals.knownExpenseTotal, "0.00"); assert.equal(r.totals.expenseTotal, null); assert.equal(r.totals.netProfit, null);
});
test("branch-wide costs are buckets, not channel subtotals; never guessed or counted twice", () => {
  const r = run([sale(), sale({}, 1, "line")], allocations([expense("20.00", "OPERATING", null), expense("10.00", "GP", "pos")]));
  assert.equal(r.totals.netProfit, "90.00"); assert.equal(r.branches[0].netProfit, "90.00");
  assert.ok(r.channels.every(c => c.netProfit === null));
  assert.equal(r.channels.filter(c => c.bucketOnly).length, 1);
  assert.equal(r.channels.reduce((n, c) => n + Number(c.knownExpenseTotal), 0), 30);
});
test("channel and branch results conserve cents including expense-only branches", () => {
  const r = run([sale()], allocations([expense("3.33"), expense("6.67", "GP", "line", 2)]));
  assert.equal(r.totals.netProfit, "50.00"); assert.equal(r.branches[1].netProfit, "-6.67");
  assert.equal(r.channels.reduce((n, c) => n + Math.round(Number(c.netProfit) * 100), 0), 5000);
});
test("excluded and duplicate expense sources are not deducted twice", () => {
  const rows = [expense(), { ...expense("0.00"), classification: "DUPLICATE", state: "INACTIVE" },
    { ...expense("0.00"), classification: "EXCLUDED", state: "INACTIVE" }];
  assert.equal(run([sale()], allocations(rows)).totals.netProfit, "50.00");
});
test("blind returns and unvalued stock adjustments block profit without a fake valuation", () => {
  for (const code of ["BLIND_RETURN_UNRECONCILED", "INVENTORY_ADJUSTMENT_UNVALUED"]) {
    const r = run([sale()], allocations(), [{ key: "gap", code }]); assert.equal(r.totals.netProfit, null); assert.equal(r.totals.netCost, null);
    assert.equal(r.totals.netRevenue, code === "BLIND_RETURN_UNRECONCILED" ? null : "100.00");
  }
});
test("scan caps, malformed evidence, duplicates and damaged allocation totals fail closed", () => {
  assert.equal(run([sale()], allocations(), [], true).totals.netProfit, null);
  const c = math.createNetProfitAccumulator(); c.add(sale()); assert.throws(() => c.add(sale()), /DUPLICATE_EVENT/);
  assert.throws(() => run([sale({ net: "bad" })]), /INVALID_MONEY/);
  const a = allocations(); a.rows[0].snapshot!.allocations[0].amount = "9.99"; assert.throws(() => run([sale()], a), /ALLOCATION_MISMATCH/);
  assert.throws(() => run([sale()], allocations([], { reviewedTotal: "1.00" })), /EXPENSE_MISMATCH/);
  const r = math.createNetProfitAccumulator().finish(allocations(), scan, [], true); assert.equal(r.totals.netProfit, null);
});
test("diagnostics are bounded while counts retain all events", () => {
  const events = Array.from({ length: 150 }, (_, i) => ({ ...sale({ legacyDate: true }), key: `SALE:${i}` }));
  const r = run(events); assert.equal(r.samples.length, 100); assert.equal(r.eventCount, 150);
  assert.equal(r.issues.find(i => i.code === "LEGACY_DATE_FALLBACK")!.count, 150);
});
test("invalid event scope is explicit and an accumulator cannot accidentally deduct expenses twice", () => {
  for (const patch of [{ locationId: null }, { locationId: "bad" }, { channel: null }, { channel: "BAD" }]) {
    const r = run([{ ...sale(), ...patch } as any]); assert.equal(r.totals.netProfit, null);
    assert.ok(r.issues.some(i => i.code === "PROFIT_EVENT_SCOPE_UNKNOWN"));
  }
  const c = math.createNetProfitAccumulator(); c.add(sale()); c.finish(allocations(), scan);
  assert.throws(() => c.finish(allocations(), scan), /ACCUMULATOR_CLOSED/); assert.throws(() => c.add(sale()), /ACCUMULATOR_CLOSED/);
});

function load(path: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(dependency, exports);
  return exports;
}
function harness() {
  const state = { acquired: 0, released: 0, scoped: false, currency: "THB", scans: 0, allocations: 0, fail: "", events: [sale()],
    truncated: false, gaps: [] as math.ProfitGap[], calls: [] as string[] };
  let active = false;
  const client = { release() { state.released++; }, async query(sql: string, params: any[] = []) {
    state.calls.push(sql);
    if (sql === "BEGIN") { active = true; return { rows: [] }; }
    assert.ok(active);
    if (sql === "COMMIT" || sql === "ROLLBACK") { active = false; return { rows: [] }; }
    if (sql.startsWith("SET LOCAL")) return { rows: [] };
    if (sql.includes("AS scoped")) { assert.deepEqual(params, ["tenant-a", "actor"]); return { rows: [{ scoped: state.scoped, currency: state.currency }] }; }
    if (sql.includes("BLIND_RETURN:")) {
      assert.deepEqual(params, ["tenant-a", "2026-10-01", "2026-10-31"]);
      assert.match(sql, /tenant_id=\$1/g); assert.match(sql, /LIMIT 1001/); assert.match(sql, /Asia\/Bangkok/);
      if (state.fail === "gaps") throw new Error("database unavailable"); return { rows: state.gaps };
    }
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  const service = load("apps/web/lib/bms/netProfit.ts", name => {
    if (name === "@/lib/db") return { getClient: async () => { state.acquired++; return client; } };
    if (name === "./tenant") return { beginTenantTx: async (c: any, tenant: string, opts: any) => {
      assert.equal(tenant, "tenant-a"); assert.deepEqual(opts, { serializable: true }); await c.query("BEGIN");
    } };
    if (name === "./operatingCostMath") return costs;
    if (name === "./costAllocationMath") return driver;
    if (name === "./netProfitMath") return math;
    if (name === "./salesEvidence") return { scanSalesEvidenceInTx: async (c: any, tenant: string, actor: string, filter: any, consume: any) => {
      assert.ok(active); assert.equal(c, client); assert.equal(tenant, "tenant-a"); assert.equal(actor, "actor");
      assert.deepEqual(filter, { from: "2026-10-01", to: "2026-10-31" }); state.scans++; state.events.forEach(consume);
      return { ...scan, truncated: state.truncated, observedAt: "2026-10-15T00:00:00.000Z" };
    } };
    if (name === "./costAllocations") return { getCostAllocationReportInTx: async (c: any, tenant: string, actor: string, month: string, d: any) => {
      assert.ok(active); assert.equal(c, client); assert.equal(tenant, "tenant-a"); assert.equal(actor, "actor"); assert.equal(month, "2026-10");
      assert.equal(d.rows[0].gross, "107.00"); assert.equal(d.truncated, state.truncated); state.allocations++;
      if (state.fail === "allocation") throw new Error("allocation failed"); return allocations();
    } };
    throw new Error(name);
  });
  return { state, report: (month: any = "2026-10") => service.getNetProfitReport("tenant-a", "actor", month) };
}
test("service composes one monthly scan and current allocations inside the same serializable tenant snapshot", async () => {
  const h = harness(), r = await h.report(); assert.equal(r.totals.netProfit, "50.00"); assert.equal(r.month, "2026-10");
  assert.equal(r.observedAt, "2026-10-15T00:00:00.000Z"); assert.equal(h.state.scans, 1); assert.equal(h.state.allocations, 1);
  assert.equal(h.state.acquired, h.state.released); assert.ok(h.state.calls.includes("COMMIT"));
  assert.ok(h.state.calls.every(sql => !/INSERT|UPDATE|DELETE/.test(sql)));
});
test("service rejects bad months before I/O, checks all-branch permissions and currency inside transaction", async () => {
  for (const month of [null, {}, "2100-01", "2026-13", "2026-10-01"]) { const h = harness(); await assert.rejects(h.report(month)); assert.equal(h.state.acquired, 0); }
  for (const patch of [{ scoped: true }, { currency: "USD" }]) {
    const h = harness(); Object.assign(h.state, patch); await assert.rejects(h.report(), /ALL_BRANCH|CURRENCY/);
    assert.equal(h.state.scans, 0); assert.ok(h.state.calls.includes("ROLLBACK")); assert.equal(h.state.released, 1);
  }
});
test("infrastructure failures propagate after rollback; truncated scans and supplemental gaps remain incomplete", async () => {
  for (const fail of ["gaps", "allocation"]) { const h = harness(); h.state.fail = fail; await assert.rejects(h.report()); assert.ok(h.state.calls.includes("ROLLBACK")); assert.equal(h.state.released, 1); }
  const h = harness(); h.state.truncated = true; assert.equal((await h.report()).totals.netProfit, null);
  h.state.truncated = false; h.state.gaps = Array.from({ length: 1001 }, (_, i) => ({ key: `gap:${i}`, code: "INVENTORY_ADJUSTMENT_UNVALUED" }));
  const r = await h.report(); assert.equal(r.truncated, true); assert.equal(r.samples.length, 100); assert.equal(r.totals.netProfit, null);
});
test("API enforces every source permission and server identities; expected rejections stay in data", async () => {
  let denied = "", failure = ""; const calls: any[] = [];
  class GqlError extends Error { extensions: any; constructor(m: string, o: any) { super(m); this.extensions = o.extensions; } }
  const api = load("apps/web/graphql/bmsNetProfit.ts", name => {
    if (name === "graphql/error") return { GraphQLError: GqlError };
    if (name === "@/lib/auth") return { requireAuth: () => ({ author_id: "server-actor" }) };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, p: string) => { if (denied === p) throw new Error("DENIED"); } };
    if (name === "@/lib/bms/netProfit") return { getNetProfitReport: async (...args: any[]) => { calls.push(args); if (failure) throw new Error(failure); return { status: "OK" }; } };
    throw new Error(name);
  }).bmsNetProfitResolvers.Query.bmsNetProfit;
  for (const p of ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"]) { denied = p; await assert.rejects(api(null, { month: "2026-10" }, {}), /DENIED/); }
  assert.equal(calls.length, 0); denied = ""; await api(null, { month: "2026-10", tenantId: "forged" }, {});
  assert.deepEqual(calls[0], ["server-tenant", "server-actor", "2026-10", true]);
  failure = "NET_PROFIT_ALL_BRANCH_ACCESS_REQUIRED"; await assert.rejects(api(null, {}, {}), (e: any) => e.extensions.code === "FORBIDDEN");
  failure = "NET_PROFIT_CURRENCY_REVIEW_REQUIRED"; assert.deepEqual(await api(null, {}, {}), { status: "REJECTED", errorCode: failure });
  failure = "DB unavailable"; await assert.rejects(api(null, {}, {}), /DB unavailable/);
});
test("GraphQL exposes nullable exact money and no caller scope or write operation", async () => {
  const schema = buildSchema(read("schema.graphql"));
  const result = await graphql({ schema, source: '{ bmsNetProfit(month:"2026-10") { status totals { netProfit netRevenue } } }',
    rootValue: { bmsNetProfit: () => run() } });
  assert.equal(result.errors, undefined); assert.equal((result.data as any).bmsNetProfit.totals.netProfit, "50.00");
  const reject = await graphql({ schema, source: '{ bmsNetProfit(month:"2026-10",tenantId:"foreign") { status } }' }); assert.ok(reject.errors?.length);
  assert.equal(schema.getMutationType()?.getFields().bmsNetProfit, undefined);
});
test("phase 9 reuses sources; existing profit report and sale/return/stock engines do not import the new calculator", () => {
  const service = read("apps/web/lib/bms/netProfit.ts");
  assert.match(service, /scanSalesEvidenceInTx/); assert.match(service, /getCostAllocationReportInTx/);
  assert.doesNotMatch(service, /FROM bms_products|recipeCostEstimates|INSERT INTO|UPDATE bms_/);
  for (const p of ["pos", "orders", "restaurantPos", "reports"]) assert.doesNotMatch(read(`apps/web/lib/bms/${p}.ts`), /from ["']\.\/netProfit/);
  assert.match(read("apps/web/app/(admin)/admin/reports/NetProfitReport.tsx"), /<Result key=\{month\}/);
});
