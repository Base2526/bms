import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { buildSchema, graphql } from "../apps/web/node_modules/graphql/index.js";
import * as math from "../apps/web/lib/bms/salesEvidenceMath.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file: string, dependency: (name: string) => any, clock: typeof Date = Date) {
  const exports: any = {};
  new Function("require", "exports", "Date", ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(dependency, exports, clock);
  return exports;
}
const branch = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const filter = { from: "2026-10-01", to: "2026-10-31" };
const line = (patch: any = {}) => ({ id: "1", sku: "SOUP", size: "BOWL", qty: "3", amount: "100.00", cost: "30.00", costSource: "CATALOG_AT_SALE", ...patch });
const sale = (patch: any = {}): math.SalesEvidenceEvent => ({ key: "SALE:1", kind: "SALE", orderId: "order-1", day: "2026-10-01", locationId: branch, channel: "pos",
  payload: { net: "100.00", discount: "0.00", extras: "0.00", shipping: "0.00", rounding: "0.00", taxable: "100.00", exempt: "0.00", vat: "6.54", lines: [line()], ...patch } });
const event = (kind: math.EvidenceKind, payload: any, patch: any = {}): math.SalesEvidenceEvent => ({ ...sale(), key: `${kind}:1`, kind, payload: { method: "CASH", ...payload }, ...patch });
const ret = (patch: any = {}) => event("RETURN", { amount: "33.33", lines: [{ id: "1", qty: "1", soldQty: "3", priorQty: "0", amount: "33.33", cost: "30.00", costSource: "CATALOG_AT_SALE", cancellationCause: null }], ...patch });
const finish = (...events: math.SalesEvidenceEvent[]) => { const accumulator = math.createSalesEvidenceAccumulator(); events.forEach(accumulator.add); return accumulator.finish(false); };

test("satang parsing is exact, signed rounding is separate, money never silently coerces", () => {
  assert.equal(math.evidenceCents("99999999999999.99"), 9999999999999999n);
  assert.equal(math.evidenceDecimal(-1n), "-0.01");
  assert.equal(math.evidenceDecimal(math.evidenceCents("1.2")), "1.20");
  for (const value of [null, undefined, 1, NaN, true, "", " ", "1e2", "0.001", "Infinity", "100000000000000", {}]) assert.throws(() => math.evidenceCents(value));
  assert.throws(() => math.inspectSalesEvidence(sale({ net: "-1" })));
});

test("3-for-100 uses line_amount, not rounded unit price or today's recipe price", () => {
  const result = math.inspectSalesEvidence(sale());
  assert.equal(result.amounts.saleNet, 10000n);
  assert.equal(result.amounts.saleKnownCost, 3000n);
  assert.equal(result.amounts.saleKnownExVat, 9346n);
  assert.deepEqual(result.attribution, [{ itemId: "1", sku: "SOUP", size: "BOWL", qty: "3", netAmount: "100.00" }]);
  assert.deepEqual(result.issues, []);
});

test("order discounts only attribute to products; extras, shipping, rounding reconcile separately", () => {
  const result = math.inspectSalesEvidence(sale({ net: "100.00", discount: "10.00", extras: "10.00", shipping: "20.00", rounding: "-0.25", taxable: "120.00", vat: "7.85" }));
  assert.equal(result.attribution[0].netAmount, "90.00");
  assert.equal(result.amounts.saleGross, 11000n);
  assert.equal(result.amounts.saleKnownExVat, 11215n);
  assert.equal(result.amounts.rounding, -25n);
  assert.deepEqual(result.issues, []);
});

test("cumulative attribution conserves cents for gifts, zero weights, many lines and awkward ratios", () => {
  assert.deepEqual(math.allocateEvidenceAmount(100n, [1n, 1n, 1n]), [33n, 34n, 33n]);
  assert.deepEqual(math.allocateEvidenceAmount(11n, [0n, 10n]), [0n, 11n]);
  assert.deepEqual(math.allocateEvidenceAmount(0n, [0n, 0n]), [0n, 0n]);
  assert.throws(() => math.allocateEvidenceAmount(1n, [0n]));
  assert.throws(() => math.allocateEvidenceAmount(-1n, [1n]));
  for (let n = 1; n < 200; n++) {
    const weights = Array.from({ length: n % 17 + 1 }, (_, i) => BigInt((i * 13 + n) % 19));
    if (!weights.some(w => w > 0n)) continue;
    const parts = math.allocateEvidenceAmount(BigInt(n), weights);
    assert.equal(parts.reduce((a, b) => a + b, 0n), BigInt(n));
    assert.ok(parts.every(p => p >= 0n));
  }
});

test("multiple recipe versions and modifier-inclusive costs keep each sale-time snapshot", () => {
  const result = math.inspectSalesEvidence(sale({ net: "200.00", taxable: "200.00", vat: "13.08",
    lines: [line({ cost: "20.00" }), line({ id: "2", cost: "40.00" })] }));
  assert.equal(result.amounts.saleKnownCost, 6000n);
  assert.equal(result.attribution.length, 2);
});

test("unknown and reconstructed cost remain visibly different from verified zero cost", () => {
  assert.equal(finish(sale({ lines: [line({ cost: null, costSource: "MISSING" })] })).missingCostLines, 1);
  const legacy = finish(sale({ lines: [line({ costSource: "LEGACY_CURRENT" })] }));
  assert.equal(legacy.legacyCostLines, 1); assert.equal(legacy.status, "INCOMPLETE");
  assert.equal(legacy.totals.saleKnownCost, "30.00");
  const invalid = finish(sale({ lines: [line({ costSource: "CURRENT_RECIPE" })] }));
  assert.equal(invalid.totals.saleKnownCost, "0.00"); assert.equal(invalid.missingCostLines, 1);
  const free = finish(sale({ lines: [line({ cost: "0.00" })] }));
  assert.equal(free.status, "COMPLETE"); assert.equal(free.totals.saleKnownCost, "0.00");
});

test("default zero tax buckets do not turn missing VAT evidence into tax-free revenue", () => {
  const result = finish(sale({ taxable: "0.00", exempt: "0.00", vat: "0.00" }));
  assert.equal(result.status, "INCOMPLETE");
  assert.ok(result.issues.some(i => i.code === "VAT_SNAPSHOT_UNRECONCILED"));
  assert.equal(result.totals.saleKnownExVat, "0.00"); assert.equal(result.netRevenue, null);
  const exempt = finish(sale({ taxable: "0.00", exempt: "100.00", vat: "0.00" }));
  assert.equal(exempt.totals.saleKnownExVat, "100.00");
});

test("mismatched totals, duplicate lines, invalid quantities and oversized lines cannot look complete", () => {
  const mismatch = math.inspectSalesEvidence(sale({ discount: "10.00" }));
  assert.ok(mismatch.issues.includes("ORDER_TOTAL_MISMATCH")); assert.deepEqual(mismatch.attribution, []);
  assert.throws(() => math.inspectSalesEvidence(sale({ lines: [line(), line()] })), /DUPLICATE_LINE/);
  for (const qty of ["0", "-1", "1.5", null, 2]) assert.throws(() => math.inspectSalesEvidence(sale({ lines: [line({ qty })] })));
  const oversized = finish(sale({ lines: Array.from({ length: 1001 }, (_, i) => line({ id: String(i) })) }));
  assert.equal(oversized.status, "INCOMPLETE"); assert.equal(oversized.totals.saleNet, "100.00");
  assert.ok(oversized.issues.some(i => i.code === "LINE_LIMIT"));
});

test("return acceptance, split-tender payment completions and cross-branch cash dates are independent", () => {
  const result = finish(sale(), { ...ret(), locationId: foreign, day: "2026-10-02" },
    event("REFUND", { amount: "10.00" }, { key: "REFUND:a", day: "2026-10-02", locationId: foreign }),
    event("REFUND", { amount: "23.33" }, { key: "REFUND:b", day: "2026-10-03", locationId: foreign }));
  assert.equal(result.totals.returnClaim, "33.33");
  assert.equal(result.totals.refundCompleted, "33.33");
  assert.equal(result.totals.returnKnownCostBasis, "10.00");
  assert.equal(result.groups.length, 3);
  assert.equal(result.groups[0].locationId, branch);
  assert.equal(result.groups[2].totals.refundCompleted, "23.33");
  assert.equal(result.netRevenue, null); assert.equal(result.netCost, null); assert.equal(result.netProfit, null);
});

test("partial-return cost attribution conserves original cents across separately requested periods", () => {
  const values = [0, 1, 2].map(prior => math.inspectSalesEvidence(ret({ lines: [{ qty: "1", soldQty: "3", priorQty: String(prior), amount: "33.33", cost: "0.01", costSource: "CATALOG_AT_SALE" }] })).amounts.returnKnownCostBasis);
  assert.deepEqual(values, [0n, 1n, 0n]);
  assert.equal(values.reduce((a, b) => a + b), 1n);
  const excessive = math.inspectSalesEvidence(ret({ lines: [{ qty: "2", soldQty: "3", priorQty: "2", amount: "33.33", cost: "30.00", costSource: "CATALOG_AT_SALE" }] }));
  assert.ok(excessive.issues.includes("RETURN_QUANTITY_MISMATCH")); assert.equal(excessive.amounts.returnKnownCostBasis, 0n);
});

test("online cancellation is not presented as restocked cooked food", () => {
  const r = ret(); r.payload.lines[0].cancellationCause = "MERCHANT_OUT_OF_STOCK";
  const result = finish(r);
  assert.ok(result.issues.some(i => i.code === "RESERVATION_RELEASE_NOT_RESTOCK"));
  assert.ok(result.issues.some(i => i.code === "RETURN_COST_IS_QUANTITY_BASIS"));
  assert.equal(result.netCost, null);
});

test("credit-sale returns reduce receivables, not completed cash/provider refunds", () => {
  const result = finish(event("REFUND", { amount: "30.00", method: "CREDIT" }),
    event("REFUND", { amount: "70.00", method: "CARD" }, { key: "REFUND:2" }));
  assert.equal(result.totals.creditReductionCompleted, "30.00");
  assert.equal(result.totals.refundCompleted, "70.00");
  const unknown = finish(event("REFUND", { amount: "30.00", method: "UNKNOWN" }));
  assert.equal(unknown.totals.refundCompleted, "0.00"); assert.equal(unknown.totals.paymentRefundUnallocated, "30.00");
  assert.equal(unknown.status, "INCOMPLETE");
});

test("void/whole-return evidence retains sale and reversal as separate facts, never double subtracts payments", () => {
  const result = finish(sale(), ret({ amount: "100.00", lines: [{ qty: "3", soldQty: "3", priorQty: "0", amount: "100.00", cost: "30.00", costSource: "CATALOG_AT_SALE" }] }),
    event("REFUND", { amount: "100.00" }));
  assert.equal(result.totals.saleNet, "100.00"); assert.equal(result.totals.returnClaim, "100.00");
  assert.equal(result.totals.refundCompleted, "100.00"); assert.equal(result.totals.returnKnownCostBasis, "30.00");
  assert.equal(result.netProfit, null);
  const cancelled = finish(sale({ cancelledWithoutReturn: true }));
  assert.equal(cancelled.totals.saleNet, "100.00");
  assert.ok(cancelled.issues.some(i => i.code === "CANCELLED_SALE_REQUIRES_RECONCILIATION"));
});

test("backoffice refunds, tax notes and returns remain unallocated instead of being subtracted twice", () => {
  const result = finish(event("PAYMENT_REFUND", { amount: "107.00" }),
    event("BACKOFFICE_RETURN", { amount: "100.00" }),
    event("TAX_ADJUSTMENT", { amount: "107.00", docType: "CREDIT_NOTE" }),
    event("TAX_ADJUSTMENT", { amount: "7.00", docType: "DEBIT_NOTE" }, { key: "TAX_ADJUSTMENT:2" }));
  assert.equal(result.totals.paymentRefundUnallocated, "107.00");
  assert.equal(result.totals.taxAdjustmentGross, "-100.00");
  assert.equal(result.totals.backofficeReturnValue, "100.00");
  assert.equal(result.netRevenue, null); assert.equal(result.status, "INCOMPLETE");
});

test("diagnostics are bounded while all group totals and issue counts include the full input", () => {
  const acc = math.createSalesEvidenceAccumulator();
  for (let i = 0; i < 105; i++) acc.add(sale({ legacyDate: true }));
  const result = acc.finish(true);
  assert.equal(result.samples.length, 100); assert.equal(result.eventCount, 105);
  assert.equal(result.totals.saleNet, "10500.00");
  assert.equal(result.issues.find(i => i.code === "LEGACY_DATE_FALLBACK")?.count, 105);
  assert.ok(result.issues.some(i => i.code === "EVENT_LIMIT")); assert.equal(result.status, "INCOMPLETE");
});

function harness(options: any = {}) {
  const calls: any[] = []; let released = false, pageIndex = 0;
  const client = { release() { released = true; }, async query(sql: string, params?: any[]) {
    calls.push({ sql, params });
    if (sql.includes("AS scoped")) return { rows: [{ currency: "THB", ...(options.access ?? { scoped: false, allowed: [], requested_exists: true }) }] };
    if (sql.includes("transaction_timestamp")) return { rows: [{ at: new Date("2026-10-15T00:00:00Z") }] };
    if (sql.includes("WITH events AS")) {
      if (options.fail) throw new Error("source read failed");
      return { rows: options.page ? options.page(params, pageIndex++) : options.rows ?? [] };
    }
    return { rows: [] };
  } };
  const service = load("apps/web/lib/bms/salesEvidence.ts", name => {
    if (name === "@/lib/db") return { getClient: async () => client };
    if (name === "./tenant") return { beginTenantTx: async (c: any, tenant: string, opts: any) => { calls.push({ beginTenant: tenant, opts }); await c.query("BEGIN"); } };
    if (name === "./salesEvidenceMath") return math;
    throw new Error(name);
  }, options.clock);
  return { service, calls, released: () => released };
}

test("date/filter boundary rejects coercion, impossible dates, excessive range and caller tenant before I/O", async () => {
  const h = harness();
  for (const input of [null, [], {}, { ...filter, tenantId: "foreign" }, { ...filter, from: "2026-02-30" },
    { ...filter, to: "2026-09-30" }, { from: "2025-01-01", to: "2026-10-31" },
    { ...filter, channel: "pos' OR true" }, { ...filter, locationId: "bad" }, { ...filter, channel: 1 }]) {
    await assert.rejects(h.service.getSalesEvidence("tenant-a", "actor", input), /SALES_EVIDENCE_/);
  }
  assert.deepEqual(h.calls, []);
});

test("one serializable tenant snapshot reads all pages with server branch scope and no catalog writes", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ ...sale(), key: `SALE:${String(i).padStart(3, "0")}` }));
  const h = harness({ access: { scoped: true, allowed: [branch], requested_exists: true },
    page: (params: any[]) => rows.filter(r => r.key > params[5]).slice(0, params[6]) });
  const result = await h.service.getSalesEvidence("tenant-a", "actor", filter);
  assert.equal(result.eventCount, 101); assert.equal(result.totals.saleNet, "10100.00");
  assert.equal(result.truncated, false); assert.equal(result.observedAt, "2026-10-15T00:00:00.000Z");
  assert.equal(h.calls[0].beginTenant, "tenant-a"); assert.deepEqual(h.calls[0].opts, { serializable: true });
  const pages = h.calls.filter(c => c.sql?.includes("WITH events AS"));
  assert.equal(pages.length, 2); assert.deepEqual(pages[0].params.slice(0, 6), ["tenant-a", filter.from, filter.to, [branch], null, ""]);
  assert.equal(pages[1].params[5], "SALE:099");
  assert.doesNotMatch(pages[0].sql, /bms_products|bms_product_recipes|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  assert.match(pages[0].sql, /location_id=ANY\(\$4::uuid\[\]\)/);
  assert.match(pages[0].sql, /prev\.tenant_id=ri\.tenant_id/);
  assert.match(pages[0].sql, /a\.tenant_id=p\.tenant_id AND a\.payment_id=p\.id/);
  assert.match(pages[0].sql, /Asia\/Bangkok/);
  assert.match(pages[0].sql, /o\.paid_at IS NOT NULL OR o\.status IN/);
  assert.equal(h.calls.at(-1).sql, "COMMIT"); assert.ok(h.released());
});

test("explicit foreign/nonexistent branch is denied before event reads; omitted scope is not widened", async () => {
  for (const access of [{ scoped: true, allowed: [branch], requested_exists: true }, { scoped: false, allowed: [], requested_exists: false }]) {
    const h = harness({ access });
    await assert.rejects(h.service.getSalesEvidence("tenant-a", "actor", { ...filter, locationId: foreign }), /FORBIDDEN/);
    assert.equal(h.calls.some(c => c.sql?.includes("WITH events AS")), false);
    assert.equal(h.calls.at(-1).sql, "ROLLBACK"); assert.ok(h.released());
  }
});

test("read failure and duplicate/nonadvancing cursor roll back and release the connection", async () => {
  for (const options of [{ fail: true }, { rows: [sale(), sale()] }]) {
    const h = harness(options);
    await assert.rejects(h.service.getSalesEvidence("tenant-a", "actor", filter));
    assert.equal(h.calls.at(-1).sql, "ROLLBACK"); assert.ok(h.released());
  }
});

test("future menu/profit readers share scoped source stream; consumer failures abort the read", async () => {
  const h = harness({ rows: [sale()] }); const seen: any[] = [];
  const result = await h.service.scanSalesEvidence("tenant-a", "actor", filter, (e: any) => { seen.push(e); });
  assert.equal(seen.length, 1); assert.equal(seen[0].payload.lines[0].sku, "SOUP");
  assert.equal(result.eventCount, 1);
  for (const consume of [() => { throw new Error("consumer failed"); }, () => Promise.resolve(), () => Promise.reject(new Error("async consumer failed"))]) {
    const bad = harness({ rows: [sale()] });
    await assert.rejects(bad.service.scanSalesEvidence("tenant-a", "actor", filter, consume));
    assert.equal(bad.calls.at(-1).sql, "ROLLBACK"); assert.ok(bad.released());
  }
});

test("unknown/non-THB currency requires review rather than silently reporting mixed money", async () => {
  for (const currency of [null, "USD", "", "JPY"]) {
    const h = harness({ access: { scoped: false, allowed: [], requested_exists: true, currency } });
    await assert.rejects(h.service.getSalesEvidence("tenant-a", "actor", filter), /CURRENCY_REVIEW_REQUIRED/);
    assert.equal(h.calls.some(c => c.sql?.includes("WITH events AS")), false);
    assert.equal(h.calls.at(-1).sql, "ROLLBACK");
  }
});

test("safety cap probes one extra event, marks incomplete, and does not call top-N a complete population", async () => {
  const h = harness({ page: (params: any[], pageIndex: number) => Array.from({ length: params[6] }, (_, i) =>
    event("REFUND", { amount: "0.01" }, { key: `REFUND:${String(pageIndex * 100 + i).padStart(6, "0")}` })) });
  const result = await h.service.getSalesEvidence("tenant-a", "actor", filter);
  assert.equal(result.eventCount, 20000); assert.equal(result.truncated, true);
  assert.equal(result.totals.refundCompleted, "200.00"); assert.equal(result.status, "INCOMPLETE");
  assert.ok(result.issues.some((i: any) => i.code === "EVENT_LIMIT"));
});

test("empty input population is distinct from failed/partial reads", async () => {
  const h = harness(); const result = await h.service.getSalesEvidence("tenant-a", "actor", { ...filter, channel: "pos", locationId: branch });
  assert.equal(result.status, "COMPLETE"); assert.equal(result.eventCount, 0); assert.deepEqual(result.groups, []);
  assert.equal(result.netProfit, null);
});

test("scan budget stops between pages and labels partial evidence rather than hanging indefinitely", async () => {
  let ticks = 0;
  class Clock extends Date { static now() { return ticks++ * 15000; } }
  const h = harness({ clock: Clock, page: () => Array.from({ length: 100 }, (_, i) => ({ ...sale(), key: `SALE:${String(i).padStart(3, "0")}` })) });
  const result = await h.service.getSalesEvidence("tenant-a", "actor", filter);
  assert.equal(result.eventCount, 100); assert.equal(result.truncated, true);
  assert.ok(result.issues.some((i: any) => i.code === "SCAN_TIME_LIMIT"));
  assert.equal(h.calls.at(-1).sql, "COMMIT"); assert.ok(h.released());
});

test("exported SDL executes decimal-string evidence and rejects caller-supplied tenant scope", async () => {
  const schema = buildSchema(read("schema.graphql"));
  let calls = 0;
  const rootValue = { bmsSalesEvidence: async ({ input }: any) => {
    calls++; return harness({ rows: [sale()] }).service.getSalesEvidence("tenant-a", "actor", input);
  } };
  const result = await graphql({ schema, rootValue, source: `query($input: BmsSalesEvidenceInput!) {
    bmsSalesEvidence(input: $input) { status currency netProfit returnVatBasis
      totals { saleNet saleKnownCost creditReductionCompleted returnKnownShippingGross returnKnownRounding returnAllocatedVat returnAllocatedExVat }
      groups { day totals { saleNet } } issues { code count } }
  }`, variableValues: { input: filter } });
  assert.equal(result.errors, undefined);
  assert.equal((result.data as any).bmsSalesEvidence.totals.saleNet, "100.00");
  assert.equal((result.data as any).bmsSalesEvidence.netProfit, null);
  assert.equal((result.data as any).bmsSalesEvidence.returnVatBasis, "SALE_BUCKET_CUMULATIVE_ALLOCATION_NOT_CREDIT_NOTE");
  assert.equal((result.data as any).bmsSalesEvidence.totals.returnAllocatedVat, "0.00");
  const rejected = await graphql({ schema, rootValue, source: `query($input: BmsSalesEvidenceInput!) {
    bmsSalesEvidence(input: $input) { status }
  }`, variableValues: { input: { ...filter, tenantId: "foreign" } } });
  assert.ok(rejected.errors?.length); assert.equal(calls, 1);
});

test("GraphQL repeats both source permissions, derives identity, preserves forbidden and returns typed rejection", async () => {
  const calls: any[] = []; let denied = "", failure = "";
  class GqlError extends Error { extensions: any; constructor(message: string, opts: any) { super(message); this.extensions = opts.extensions; } }
  const adapter = load("apps/web/graphql/bmsSalesEvidence.ts", name => {
    if (name === "graphql/error") return { GraphQLError: GqlError };
    if (name === "@/lib/auth") return { requireAuth: () => ({ author_id: "server-user" }) };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_ctx: any, permission: string) => { calls.push(permission); if (denied === permission) throw new Error("DENIED"); } };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/salesEvidence") return { getSalesEvidence: async (...args: any[]) => { calls.push(args); if (failure) throw new Error(failure); return { status: "COMPLETE" }; } };
    throw new Error(name);
  }).bmsSalesEvidenceResolvers.Query.bmsSalesEvidence;
  for (denied of ["report.view", "tax.document.view"]) {
    calls.length = 0; await assert.rejects(adapter(null, { input: filter }, {}), /DENIED/);
    assert.equal(calls.some(Array.isArray), false);
  }
  denied = ""; calls.length = 0;
  assert.equal((await adapter(null, { input: filter }, {})).status, "COMPLETE");
  assert.deepEqual(calls, ["report.view", "tax.document.view", ["server-tenant", "server-user", filter]]);
  failure = "SALES_EVIDENCE_INVALID_RANGE";
  assert.equal((await adapter(null, { input: filter }, {})).errorCode, failure);
  failure = "SALES_EVIDENCE_FORBIDDEN";
  await assert.rejects(adapter(null, { input: filter }, {}), (e: any) => e.extensions.code === "FORBIDDEN");
  failure = "database unavailable";
  await assert.rejects(adapter(null, { input: filter }, {}), /database unavailable/);
});

test("new evidence adapter is wired without replacing the existing profit engine", () => {
  assert.match(read("apps/web/graphql/resolvers.ts"), /\.\.\.bmsSalesEvidenceResolvers.Query/);
  assert.match(read("apps/web/graphql/typeDefs.ts"), /bmsSalesEvidence\(input: BmsSalesEvidenceInput!\): BmsSalesEvidence!/);
  assert.doesNotMatch(read("apps/web/lib/bms/reports.ts"), /salesEvidence/);
  for (const file of ["orders.ts", "pos.ts", "restaurantPos.ts"]) assert.doesNotMatch(read(`apps/web/lib/bms/${file}`), /salesEvidence/);
});
