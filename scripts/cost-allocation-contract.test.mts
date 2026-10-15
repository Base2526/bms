import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { buildSchema, graphql } from "../apps/web/node_modules/graphql/index.js";
import * as math from "../apps/web/lib/bms/costAllocationMath.ts";
import * as costs from "../apps/web/lib/bms/operatingCostMath.ts";
import * as evidence from "../apps/web/lib/bms/salesEvidenceMath.ts";
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = `DOCUMENT:${id(99)}`;
const target = (n = 1, channel: string | null = null, weight: string | null = null) => ({ locationId: id(n), channel, weight });
const rule = (patch: any = {}): math.AllocationRule => ({ method: "DIRECT", reason: "Reviewed rent allocation", targets: [target()], ...patch });
const request = (patch: any = {}) => ({ month: "2026-10", sourceKey: key, rule: rule(), ...patch });
const source = (patch: any = {}) => ({ key, reference: "FAKE rent", state: "OPERATING", recognizedAmount: 100, fingerprint: "a".repeat(64),
  review: { disposition: "OPERATING", version: 1, sourceFingerprint: "a".repeat(64) }, ...patch });
const sales = (branch = 1, net = "100.00", qty = "1", channel = "pos"): evidence.SalesEvidenceEvent => ({
  key: `SALE:${branch}:${channel}`, kind: "SALE", locationId: id(branch), channel, day: "2026-10-01", orderId: id(20 + branch),
  payload: { net, discount: "0.00", extras: "0.00", shipping: "0.00", rounding: "0.00", taxable: net, exempt: "0.00", vat: "0.00",
    lines: [{ id: "1", sku: "SOUP", size: "BOWL", qty, amount: net, cost: null, costSource: "MISSING" }] } });

test("direct, equal, weighted and negative supplier credits conserve every satang deterministically", () => {
  assert.equal(math.allocateOperatingCost("100.01", rule())[0].amount, "100.01");
  const r = rule({ method: "EQUAL", targets: [target(3), target(1), target(2)] });
  assert.deepEqual(math.allocateOperatingCost("1.00", r).map(p => p.amount), ["0.33", "0.34", "0.33"]);
  assert.deepEqual(math.allocateOperatingCost("-1.00", r).map(p => p.amount), ["-0.33", "-0.34", "-0.33"]);
  const weighted = rule({ method: "WEIGHTED", targets: [target(1, null, "70"), target(2, null, "30")] });
  assert.deepEqual(math.allocateOperatingCost("100.00", weighted).map(p => p.amount), ["70.00", "30.00"]);
  for (let cents = -333; cents <= 333; cents++) {
    const amount = evidence.evidenceDecimal(BigInt(cents));
    assert.equal(math.allocateOperatingCost(amount, r).reduce((n, p) => n + evidence.evidenceCents(p.amount), 0n), BigInt(cents));
  }
});
test("zero basis is not an equal-share fallback; true zero expenses remain zero", () => {
  const r = rule({ method: "WEIGHTED", targets: [target(1, null, "0")] });
  assert.throws(() => math.allocateOperatingCost("1.00", r), /ZERO_BASIS/);
  assert.equal(math.allocateOperatingCost("0.00", r)[0].amount, "0.00");
});
test("boundaries reject client authority, overlap, invalid weights, excessive targets and bad months", () => {
  for (const patch of [{ tenantId: id(1) }, { amount: "999" }, { month: "2100-01" }, { month: "2026-13" }, { sourceKey: "fake" }])
    assert.throws(() => math.normalizeAllocationRequest(request(patch)));
  for (const patch of [{ method: "OTHER" }, { reason: " " }, { reason: "a".repeat(501) }, { targets: [] }, { targets: Array(101).fill(target()) },
    { targets: [target(), target()] }, { targets: [target(1), target(1, "pos")], method: "EQUAL" },
    { targets: [target(1), target(2)], method: "DIRECT" }, { targets: [target(1, "INVALID")] },
    { method: "WEIGHTED", targets: [target(1, null, "1.5")] }, { targets: [target(1, null, "1")] }]) assert.throws(() => math.normalizeAllocationRule(rule(patch)));
  assert.doesNotThrow(() => math.normalizeAllocationRule(rule({ method: "EQUAL", targets: [target(1, "pos"), target(1, "line")] })));
  for (const patch of [{ confirmed: false }, { expectedVersion: -1 }, { previewFingerprint: "bad" }]) assert.throws(() => math.normalizeAllocationRequest({
    ...request(), confirmed: true, expectedVersion: 0, previewFingerprint: "a".repeat(64), ...patch }, true));
});
test("driver uses actual product totals after discount, excludes extras/shipping/rounding, ignores returns and cost gaps", () => {
  const collector = math.createAllocationDriver();
  const sale = sales(); Object.assign(sale.payload, { net: "100.00", discount: "10.00", extras: "10.00", shipping: "20.00", rounding: "-0.25", taxable: "120.00" });
  collector.add(sale); collector.add({ ...sale, kind: "RETURN", payload: { intentionally: "not read" } });
  collector.add(sales(2, "30.00", "3"));
  const driver = collector.finish(false);
  assert.deepEqual(driver.issues, []); assert.equal(driver.rows[0].gross, "90.00");
  const r = rule({ method: "SALES_GROSS", targets: [target(1), target(2)] });
  assert.deepEqual(math.allocateOperatingCost("100.00", r, driver).map(p => p.amount), ["75.00", "25.00"]);
  assert.deepEqual(math.allocateOperatingCost("100.00", { ...r, method: "SALES_UNITS" }, driver).map(p => p.amount), ["25.00", "75.00"]);
});
test("channel targets select a declared population, not all branches or top-N sales", () => {
  const c = math.createAllocationDriver(); c.add(sales(1, "90.00", "1", "pos")); c.add(sales(1, "10.00", "1", "line")); c.add(sales(2));
  const parts = math.allocateOperatingCost("100.00", rule({ method: "SALES_GROSS", targets: [target(1, "pos"), target(1, "line")] }), c.finish(false));
  assert.deepEqual(parts.map(p => p.amount), ["10.00", "90.00"]); // canonical target ordering
});
test("truncated, mismatched and undated sales cannot become a complete denominator", () => {
  const r = rule({ method: "SALES_GROSS" });
  for (const patch of [{ legacyDate: true }, { net: "999.00" }, { lines: Array(1001).fill({}) }]) {
    const c = math.createAllocationDriver(), s = sales(); Object.assign(s.payload, patch); c.add(s);
    assert.throws(() => math.allocateOperatingCost("1.00", r, c.finish(false)), /SALES_INCOMPLETE/);
  }
  assert.throws(() => math.allocateOperatingCost("1.00", r, { rows: [], issues: [], truncated: true }), /SALES_INCOMPLETE/);
  assert.throws(() => math.allocateOperatingCost("1.00", r, { rows: [], issues: [], truncated: false }), /ZERO_BASIS/);
});
function load(file: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(dependency, exports);
  return exports;
}
function harness() {
  const state = { versions: [] as any[], audits: [] as any[], sources: [source()], complete: true, truncated: false, scoped: false, currency: "THB",
    failAudit: false, failSql: false, conflict: false, acquired: 0, released: 0, sales: [sales(1), sales(2, "300.00")], salesTruncated: false, scans: 0 };
  let backup: any = null; const calls: any[] = [];
  const client = { release() { state.released++; }, async query(sql: string, params: any[] = []) {
    calls.push({ sql, params }); let rows: any[] = [];
    if (sql === "BEGIN") backup = structuredClone({ versions: state.versions, audits: state.audits });
    else if (sql === "ROLLBACK") { Object.assign(state, backup); backup = null; }
    else if (sql === "COMMIT") { if (state.conflict) throw Object.assign(new Error("serialization"), { code: "40001" }); backup = null; }
    else if (sql.includes("SET LOCAL") || sql.includes("pg_advisory_xact_lock")) {}
    else if (sql.includes("AS scoped")) { assert.deepEqual(params, ["tenant-a", "actor"]); rows = [{ scoped: state.scoped, currency: state.currency }]; }
    else if (sql.startsWith("SELECT id,name FROM bms_locations")) rows = [1, 2, 3].map(n => ({ id: id(n), name: `Branch ${n}` }));
    else if (sql.includes("DISTINCT ON (source_key)")) {
      if (state.failSql) throw new Error("DB unavailable");
      rows = state.versions.filter(r => r.version === Math.max(...state.versions.filter(v => v.source_key === r.source_key).map(v => v.version)));
    } else if (sql.includes("SELECT version,request_hash,snapshot")) rows = state.versions.filter(v => v.source_key === params[2]).slice(-1);
    else if (sql.includes("INSERT INTO bms_cost_allocations")) {
      assert.ok(backup); assert.equal(params[0], "tenant-a"); assert.equal(params[6], "actor");
      state.versions.push({ source_key: params[2], version: params[3], request_hash: params[4], snapshot: JSON.parse(params[5]) });
    } else if (sql.includes("INSERT INTO bms_audit_log")) { if (state.failAudit) throw new Error("audit failed"); state.audits.push(params); }
    else throw new Error(`Unexpected SQL ${sql}`);
    return { rows, rowCount: rows.length };
  } };
  const service = load("apps/web/lib/bms/costAllocations.ts", name => {
    if (name === "crypto") return crypto;
    if (name === "@/lib/db") return { getClient: async () => { state.acquired++; return client; } };
    if (name === "./tenant") return { beginTenantTx: async (c: any, tenant: string, opts: any) => {
      assert.equal(tenant, "tenant-a"); assert.equal(opts.serializable, true); assert.ok(!opts.editorId || opts.editorId === "actor"); await c.query("BEGIN");
    } };
    if (name === "./operatingCostMath") return costs;
    if (name === "./costAllocationMath") return math;
    if (name === "./salesEvidenceMath") return evidence;
    if (name === "./operatingCosts") return { getOperatingCostsInTx: async (c: any, tenant: string, month: string) => {
      assert.equal(c, client); assert.ok(backup); assert.equal(tenant, "tenant-a"); assert.equal(month, "2026-10");
      return { rows: state.sources, complete: state.complete, truncated: state.truncated, unresolvedCount: state.complete ? 0 : 1, reviewedTotal: state.complete ? 100 : null };
    } };
    if (name === "./salesEvidence") return { scanSalesEvidenceInTx: async (c: any, tenant: string, actor: string, input: any, consume: any) => {
      state.scans++; assert.equal(c, client); assert.ok(backup); assert.equal(tenant, "tenant-a"); assert.equal(actor, "actor");
      assert.deepEqual(input, { from: "2026-10-01", to: "2026-10-31" }); state.sales.forEach(consume); return { truncated: state.salesTruncated };
    } };
    throw new Error(name);
  });
  const preview = (patch: any = {}) => service.previewCostAllocation("tenant-a", "actor", request(patch));
  const save = (input: any) => service.saveCostAllocation("tenant-a", "actor", input);
  const input = async (patch: any = {}) => { const p = await preview(patch); return { ...request(patch), confirmed: true, expectedVersion: p.expectedVersion, previewFingerprint: p.snapshot.fingerprint }; };
  return { state, calls, preview, save, input, report: () => service.getCostAllocationReport("tenant-a", "actor", "2026-10") };
}
test("service previews source-derived money, commits immutable version with audit and exact retry", async () => {
  const h = harness(); const input = await h.input(); assert.equal((await h.report()).allocatedTotal, null);
  assert.deepEqual(await h.save(input), { status: "SAVED", version: 1, replayed: false });
  assert.deepEqual(await h.save(input), { status: "SAVED", version: 1, replayed: true });
  assert.equal(h.state.audits.length, 1); assert.equal(h.state.versions.length, 1);
  assert.equal((await h.report()).allocatedTotal, "100.00"); assert.equal(h.state.scans, 0);
  assert.equal(h.state.acquired, h.state.released);
});
test("JSONB object-key reordering does not invalidate saved evidence", async () => {
  const h = harness(); await h.save(await h.input());
  const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reorder(v[k])])) : v;
  h.state.versions[0].snapshot = reorder(h.state.versions[0].snapshot);
  assert.equal((await h.report()).rows[0].state, "CURRENT");
  h.state.versions[0].snapshot.allocations[0].amount = "999.00";
  assert.equal((await h.report()).rows[0].state, "STALE");
});
test("changed source, classification or sales blocks confirmation; latest report excludes stale allocations", async () => {
  const h = harness(); const input = await h.input(); h.state.sources[0].recognizedAmount = 101;
  await assert.rejects(h.save(input), /PREVIEW_STALE/); assert.equal(h.state.versions.length, 0);
  h.state.sources[0].recognizedAmount = 100; await h.save(input);
  h.state.sources[0].review.version = 2;
  assert.equal((await h.report()).allocatedTotal, null); assert.equal((await h.report()).knownAllocated, "0.00");
  const newer = await h.input(); await h.save(newer); assert.equal(h.state.versions.length, 2);
  assert.equal(h.state.versions[0].snapshot.sourceBasis.review.version, 1);
  await assert.rejects(h.save({ ...input, rule: rule({ reason: "Stale edit" }) }), /CONFLICT/);
});
test("automatic rules use shared evidence in the same transaction and detect denominator changes", async () => {
  const h = harness(), patch = { rule: rule({ method: "SALES_GROSS", targets: [target(1), target(2)] }) };
  const p = await h.preview(patch); assert.deepEqual(p.snapshot.allocations.map((a: any) => a.amount), ["25.00", "75.00"]);
  const input = await h.input(patch); h.state.sales[1] = sales(2, "100.00");
  await assert.rejects(h.save(input), /PREVIEW_STALE/);
  await h.save(await h.input(patch)); h.state.salesTruncated = true;
  assert.equal((await h.report()).rows[0].state, "STALE");
  await assert.rejects(h.preview(patch), /SALES_INCOMPLETE/);
});
test("negative credits and monthly depreciation use recognized source amount only", async () => {
  for (const [state, recognized] of [["OPERATING", -10.01], ["DEPRECIATION", 17.14], ["GP", 20]] as const) {
    const h = harness(); Object.assign(h.state.sources[0], { state, recognizedAmount: recognized });
    const p = await h.preview(); assert.equal(p.snapshot.amount, recognized.toFixed(2));
    await h.save(await h.input()); assert.equal((await h.report()).allocatedTotal, recognized.toFixed(2));
  }
});
test("excluded or duplicate source retires old allocation without rewriting it or double counting", async () => {
  const h = harness(); await h.save(await h.input()); const snapshot = structuredClone(h.state.versions[0].snapshot);
  for (const state of ["EXCLUDED", "DUPLICATE", "NOT_ELIGIBLE"]) {
    Object.assign(h.state.sources[0], { state, recognizedAmount: 0 });
    const report = await h.report(); assert.equal(report.rows[0].state, "INACTIVE"); assert.equal(report.allocatedTotal, "0.00");
    await assert.rejects(h.preview(), /SOURCE_REVIEW_REQUIRED/); assert.deepEqual(h.state.versions[0].snapshot, snapshot);
  }
});
test("missing/unreviewed sources, unknown totals and cost caps never become complete allocation", async () => {
  const h = harness(); h.state.complete = false; await h.save(await h.input());
  assert.equal((await h.report()).allocatedTotal, null); assert.equal((await h.report()).knownAllocated, "100.00");
  h.state.truncated = true; await assert.rejects(h.preview(), /COSTS_TRUNCATED/);
  assert.equal((await h.report()).knownAllocated, "0.00");
  h.state.sources = []; assert.equal((await h.report()).rows[0].state, "STALE");
});
test("tenant scope, foreign target, confirmation and all-source currency fail closed", async () => {
  const h = harness(); const input = await h.input(); const acquired = h.state.acquired;
  await assert.rejects(h.save({ ...input, confirmed: false }), /CONFIRMATION/); assert.equal(h.state.acquired, acquired);
  await assert.rejects(h.save({ ...input, tenantId: "foreign" }), /INVALID_INPUT/);
  await assert.rejects(h.preview({ rule: rule({ targets: [target(999)] }) }), /TARGET_NOT_FOUND/);
  h.state.scoped = true;
  await assert.rejects(h.report(), /ALL_BRANCH/); await assert.rejects(h.save(input), /ALL_BRANCH/);
  h.state.scoped = false; h.state.currency = "USD"; await assert.rejects(h.preview(), /CURRENCY/);
  assert.equal(h.state.versions.length, 0); assert.equal(h.state.acquired, h.state.released);
});
test("audit failure and serialization conflict roll back version and audit; infrastructure errors are not empty reports", async () => {
  const h = harness(); const input = await h.input(); h.state.failAudit = true;
  await assert.rejects(h.save(input), /audit failed/); assert.equal(h.state.versions.length, 0);
  h.state.failAudit = false; h.state.conflict = true;
  await assert.rejects(h.save(input), /CONFLICT/); assert.equal(h.state.versions.length, 0); assert.equal(h.state.audits.length, 0);
  h.state.conflict = false; h.state.failSql = true; await assert.rejects(h.report(), /DB unavailable/);
});
test("API repeats all source permissions, derives server identities and keeps business rejections in data", async () => {
  let denied = "", failure = ""; const calls: any[] = [];
  class GqlError extends Error { extensions: any; constructor(m: string, o: any) { super(m); this.extensions = o.extensions; } }
  const run = async (...args: any[]) => { calls.push(args); if (failure) throw new Error(failure); return { status: "OK" }; };
  const api = load("apps/web/graphql/bmsCostAllocations.ts", name => {
    if (name === "graphql/error") return { GraphQLError: GqlError };
    if (name === "@/lib/auth") return { requireAuth: () => ({ author_id: "server-actor" }) };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, p: string) => { if (p === denied) throw new Error("DENIED"); } };
    if (name === "@/lib/bms/costAllocations") return { getCostAllocationReport: run, previewCostAllocation: run, saveCostAllocation: run };
    throw new Error(name);
  }).bmsCostAllocationResolvers;
  for (denied of ["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"]) await assert.rejects(api.Query.bmsCostAllocations(null, { month: "2026-10" }, {}), /DENIED/);
  denied = "expense.manage"; await assert.rejects(api.Mutation.bmsSaveCostAllocation(null, { input: {} }, {}), /DENIED/);
  assert.equal(calls.length, 0); denied = "";
  await api.Query.bmsPreviewCostAllocation(null, { input: request() }, {}); assert.deepEqual(calls.at(-1), ["server-tenant", "server-actor", request()]);
  failure = "COST_ALLOCATION_PREVIEW_STALE"; assert.equal((await api.Mutation.bmsSaveCostAllocation(null, { input: {} }, {})).status, "REJECTED");
  failure = "COST_ALLOCATION_ALL_BRANCH_ACCESS_REQUIRED"; await assert.rejects(api.Query.bmsCostAllocations(null, { month: "2026-10" }, {}), (e: any) => e.extensions.code === "FORBIDDEN");
  failure = "DB unavailable"; await assert.rejects(api.Query.bmsCostAllocations(null, { month: "2026-10" }, {}), /DB unavailable/);
});
test("exported GraphQL SDL carries decimal snapshots and rejects tenant/amount overrides", async () => {
  const schema = buildSchema(read("schema.graphql")); const h = harness();
  const result = await graphql({ schema, source: `query($input:BmsCostAllocationPreviewInput!) { bmsPreviewCostAllocation(input:$input) { status snapshot { amount allocations { amount } } } }`,
    variableValues: { input: request() }, rootValue: { bmsPreviewCostAllocation: ({ input }: any) => h.preview(input) } });
  assert.equal(result.errors, undefined); assert.equal((result.data as any).bmsPreviewCostAllocation.snapshot.amount, "100.00");
  const bad = await graphql({ schema, source: `query($input:BmsCostAllocationPreviewInput!) { bmsPreviewCostAllocation(input:$input) { status } }`,
    variableValues: { input: { ...request(), tenantId: "forged" } } }); assert.ok(bad.errors?.length);
});
test("schema and wiring retain RLS, append-only grants, source reuse and no money-path imports", () => {
  const sql = read("db/migrations/10.66__bms_cost_allocations.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_cost_allocations/); assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /WITH CHECK \(tenant_id=NULLIF/); assert.match(sql, /GRANT SELECT, INSERT/); assert.match(sql, /REVOKE UPDATE, DELETE/);
  assert.match(sql, /PRIMARY KEY \(tenant_id,month,source_key,version\)/); assert.match(sql, /ROLLBACK:/);
  assert.match(sql, /created_by UUID REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(read("apps/web/graphql/resolvers.ts"), /\.\.\.bmsCostAllocationResolvers.Mutation/);
  for (const f of ["pos.ts", "orders.ts", "restaurantPos.ts", "reports.ts"]) assert.doesNotMatch(read(`apps/web/lib/bms/${f}`), /costAllocations/);
  assert.doesNotMatch(read("apps/web/lib/bms/costAllocations.ts"), /UPDATE bms_(orders|inventory|expense_documents)|INSERT INTO bms_payments|recipeCost/);
});
