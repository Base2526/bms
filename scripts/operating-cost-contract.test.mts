import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as math from "../apps/web/lib/bms/operatingCostMath.ts";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const decision = (patch: any = {}): math.CostDecision => ({ disposition: "OPERATING", reason: "Reviewed evidence", duplicateKey: null,
  startMonth: null, lifeMonths: null, residual: null, ...patch });
const source = (n: number, patch: any = {}): math.ReviewedCostSource => ({ key: `DOCUMENT:${id(n)}`, kind: "DOCUMENT", id: id(n), month: "2026-10",
  amount: "100.00", currency: "THB", category: "RENT", reference: `FAKE-${n}`, eligible: true, fingerprint: "a".repeat(64),
  review: { ...decision(), version: 1, sourceFingerprint: "a".repeat(64) }, ...patch });
const review = (patch: any = {}) => ({ ...decision(patch), version: 1, sourceFingerprint: "a".repeat(64) });
test("monthly costs count each canonical source once, not equal-money heuristics", () => {
  const a = source(1), b = source(2, { kind: "POS_EXPENSE", key: `POS_EXPENSE:${id(2)}`, review: review({ disposition: "DUPLICATE", duplicateKey: a.key }) });
  const c = source(3, { kind: "STATEMENT", category: "PLATFORM_GP", key: `STATEMENT:${id(3)}`, amount: "30.00", review: review({ disposition: "GP" }) });
  const result = math.calculateOperatingCosts("2026-10", [a, b, c, source(4)]);
  assert.equal(result.operatingAmount, 200); assert.equal(result.gpAmount, 30); assert.equal(result.reviewedTotal, 230);
  assert.equal(result.duplicateCount, 1); assert.equal(result.complete, true);
});
test("unknown, changed, foreign-currency and truncated evidence never become zero totals", () => {
  for (const row of [source(2, { review: null }), source(2, { amount: null }), source(2, { currency: "USD" }), source(2, { fingerprint: "b".repeat(64) })]) {
    const result = math.calculateOperatingCosts("2026-10", [source(1), row]);
    assert.equal(result.knownTotal, 100); assert.equal(result.reviewedTotal, null); assert.equal(result.unresolvedCount, 1);
  }
  const truncated = math.calculateOperatingCosts("2026-10", [source(1)], true);
  assert.equal(truncated.reviewedTotal, null); assert.equal(truncated.complete, false);
});
test("void/unsettled evidence is not expense, but invalid statement GP stays unknown", () => {
  const rows = [source(1, { eligible: false, review: null }), source(2, { eligible: false, kind: "POS_EXPENSE", review: null })];
  assert.equal(math.calculateOperatingCosts("2026-10", rows).reviewedTotal, 0);
  rows.push(source(3, { eligible: false, kind: "STATEMENT", review: null }));
  assert.equal(math.calculateOperatingCosts("2026-10", rows).reviewedTotal, null);
  const changed = source(4, { eligible: false, fingerprint: "b".repeat(64) });
  assert.equal(math.calculateOperatingCosts("2026-10", [changed]).rows[0].state, "SOURCE_CHANGED");
});
test("inventory/ingredients cannot be charged again; explicit exclusion retains reason", () => {
  for (const category of ["INVENTORY", "INGREDIENTS"]) {
    assert.throws(() => math.validateCostClassification(source(1, { category }), decision()), /COGS/);
    const result = math.calculateOperatingCosts("2026-10", [source(1, { category, review: review({ disposition: "EXCLUDED" }) })]);
    assert.equal(result.reviewedTotal, 0); assert.equal(result.rows[0].review?.reason, "Reviewed evidence");
  }
});
test("supplier credits reduce reviewed costs; statement cannot be ordinary operating expense", () => {
  assert.equal(math.calculateOperatingCosts("2026-10", [source(1), source(2, { amount: "-25.00" })]).reviewedTotal, 75);
  assert.throws(() => math.validateCostClassification(source(1, { kind: "STATEMENT" }), decision()), /GP_ONLY/);
});
test("duplicate cannot reference itself, another duplicate, missing or stale canonical evidence", () => {
  const canonical = source(1);
  for (const target of [undefined, source(1, { review: null }), source(1, { fingerprint: "b".repeat(64) }),
    source(1, { review: review({ disposition: "DUPLICATE", duplicateKey: source(2).key }) })]) {
    const duplicate = source(2, { review: review({ disposition: "DUPLICATE", duplicateKey: canonical.key }) });
    const result = math.calculateOperatingCosts("2026-10", [duplicate, ...(target ? [target] : [])]);
    assert.equal(result.rows[0].state, "REVIEW_REQUIRED"); assert.equal(result.reviewedTotal, null);
  }
  const self = source(1, { review: review({ disposition: "DUPLICATE", duplicateKey: canonical.key }) });
  assert.equal(math.calculateOperatingCosts("2026-10", [self]).rows[0].state, "REVIEW_REQUIRED");
});
test("cross-month duplicate belongs to canonical month, not a second expense this month", () => {
  const canonical = source(1, { month: "2026-09" });
  const result = math.calculateOperatingCosts("2026-10", [canonical, source(2, { review: review({ disposition: "DUPLICATE", duplicateKey: canonical.key }) })]);
  assert.equal(result.rows.length, 1); assert.equal(result.reviewedTotal, 0); assert.equal(result.duplicateCount, 1);
});
test("whole-month depreciation conserves cents, residual and year boundaries without purchase double count", () => {
  const d = decision({ disposition: "DEPRECIATION", startMonth: "2026-12", lifeMonths: 7, residual: 3.45 });
  const months = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"];
  assert.equal(months.reduce((sum, month) => sum + math.monthlyDepreciation(12345n, d, month), 0n), 12000n);
  assert.equal(math.monthlyDepreciation(12345n, d, "2026-11"), 0n); assert.equal(math.monthlyDepreciation(12345n, d, "2027-07"), 0n);
  const result = math.calculateOperatingCosts("2027-01", [source(1, { amount: "123.45", review: review(d) })]);
  assert.equal(result.operatingAmount, 0); assert.equal(result.depreciationAmount, 17.14);
  assert.equal(result.reviewedTotal, 17.14);
});
test("input boundaries reject malformed month/key, unsafe precision, missing reason and invalid schedules", () => {
  for (const month of ["2026-13", "2026-1", "2026-01-01", "", null]) assert.throws(() => math.costMonth(month));
  for (const key of ["DOCUMENT:bad", `OTHER:${id(1)}`, null]) assert.throws(() => math.costSourceKey(key));
  for (const value of [NaN, Infinity, "1e2", "1.001", "1000000000000", true]) assert.equal(math.costCents(value), null);
  for (const patch of [{ reason: " " }, { reason: "x".repeat(501) }, { disposition: "OTHER" }, { duplicateKey: source(1).key },
    { disposition: "DUPLICATE" }, { lifeMonths: 3 }, { disposition: "DEPRECIATION", startMonth: "2026-10", lifeMonths: 0, residual: 0 },
    { disposition: "DEPRECIATION", startMonth: "2026-10", lifeMonths: 601, residual: 0 }]) assert.throws(() => math.normalizeCostDecision(decision(patch)));
  const d = decision({ disposition: "DEPRECIATION", startMonth: "2026-10", lifeMonths: 12, residual: 101 });
  assert.throws(() => math.monthlyDepreciation(10000n, d, "2026-10"));
  assert.throws(() => math.calculateOperatingCosts("2026-10", [source(1), source(1)]), /DUPLICATE_SOURCE_ROWS/);
});

function load(path: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText)(dependency, exports);
  return exports;
}
import * as crypto from "node:crypto";
function harness() {
  const state = { rows: [1, 2].map(n => ({ key: `DOCUMENT:${id(n)}`, kind: "DOCUMENT", id: id(n), month: "2026-10", amount: "100.00",
    currency: "THB", category: "RENT", reference: `FAKE-${n}`, eligible: true, revision: "1" })), reviews: {} as Record<string, any>, audits: [] as any[],
    restricted: false, failAudit: false, acquired: 0, released: 0 };
  let backup: any; const calls: any[] = [];
  const client = { release() { state.released++; }, async query(sql: string, params: any[] = []) {
    calls.push({ sql, params }); let rows: any[] = [];
    if (sql === "BEGIN") backup = structuredClone({ reviews: state.reviews, audits: state.audits });
    else if (sql === "ROLLBACK") Object.assign(state, backup);
    else if (sql === "COMMIT" || sql.includes("pg_advisory_xact_lock")) {}
    else if (sql.includes("SELECT version,request_hash,decision")) rows = state.reviews[params[1]] ? [state.reviews[params[1]]] : [];
    else if (sql.startsWith("SELECT id FROM")) rows = [{ id: params[1] }];
    else if (sql.startsWith("WITH sources")) rows = params[0] !== "tenant-a" ? [] : state.rows.filter(row => sql.includes("selected AS") || row.key === params[1])
      .map(row => ({ ...row, ...state.reviews[row.key] }));
    else if (sql.includes("INSERT INTO bms_operating_cost_reviews")) state.reviews[params[1]] = { version: params[2], source_fingerprint: params[3], decision: JSON.parse(params[4]), request_hash: params[5] };
    else if (sql.includes("INSERT INTO bms_audit_log")) { if (state.failAudit) throw new Error("FAKE audit failure"); state.audits.push(params); }
    else throw new Error(`Unexpected query ${sql}`);
    return { rows, rowCount: rows.length };
  } };
  const service = load("apps/web/lib/bms/operatingCosts.ts", name => {
    if (name === "crypto") return crypto;
    if (name === "./operatingCostMath") return math;
    if (name === "./locations") return { userHasLocationScope: async () => state.restricted };
    if (name === "./tenant") return { beginTenantTx: async (c: any, tenant: string, options: any) => {
      assert.equal(tenant, "tenant-a"); if (options) assert.equal(options.editorId, "actor"); await c.query("BEGIN");
    } };
    if (name === "@/lib/db") return { getClient: async () => { state.acquired++; return client; } };
    throw new Error(name);
  });
  const report = () => service.getOperatingCostReport("tenant-a", "actor", "2026-10");
  const save = (input: any) => service.reviewOperatingCost("tenant-a", "actor", input);
  const input = async (n = 0, patch: any = {}) => { const row = (await report()).rows[n]; return { ...decision(), sourceKey: row.key,
    sourceFingerprint: row.fingerprint, expectedVersion: row.review?.version ?? 0, confirmed: true, ...patch }; };
  return { state, calls, report, save, input };
}
test("real review service derives source amounts, commits audit and supports exact retry with no duplicate audit", async () => {
  const h = harness(); const input = await h.input();
  assert.deepEqual(await h.save({ ...input, amount: 999, tenantId: "forged" }), { version: 1 });
  assert.deepEqual(await h.save(input), { version: 1 }); assert.equal(h.state.audits.length, 1);
  const report = await h.report(); assert.equal(report.knownTotal, 100); assert.equal(report.reviewedTotal, null);
  assert.ok(h.calls.some(c => c.sql.includes("FOR SHARE") && c.params[0] === "tenant-a"));
  assert.equal(h.state.acquired, h.state.released);
});
test("stale reviewer, changed/foreign source and missing confirmation fail without mutating evidence", async () => {
  const h = harness(); const input = await h.input(); await h.save(input);
  await assert.rejects(h.save({ ...input, reason: "Changed stale review" }), /CONFLICT/);
  const fresh = await h.input(); h.state.rows[0].amount = "101.00";
  await assert.rejects(h.save(fresh), /SOURCE_CHANGED/);
  await assert.rejects(h.save({ ...input, sourceKey: `DOCUMENT:${id(999)}` }), /NOT_FOUND/);
  const before = h.state.acquired; await assert.rejects(h.save({ ...input, confirmed: false }), /CONFIRMATION/);
  assert.equal(h.state.acquired, before); assert.equal(h.state.audits.length, 1);
  await assert.rejects(h.save({ ...input, expectedVersion: 2147483647 }), /CONFIRMATION/);
});
test("all-branch gate applies to reads and writes before connection", async () => {
  const h = harness(); const input = await h.input(); h.state.restricted = true; const before = h.state.acquired;
  await assert.rejects(h.report(), /ALL_BRANCH_ACCESS/); await assert.rejects(h.save(input), /ALL_BRANCH_ACCESS/);
  assert.equal(h.state.acquired, before);
});
test("canonical review required, source rechecked, no duplicate chain, and audit failure rolls back", async () => {
  const h = harness(); const primary = await h.input(), dup = await h.input(1, { disposition: "DUPLICATE", duplicateKey: primary.sourceKey });
  await assert.rejects(h.save(dup), /CANONICAL_REVIEW/); await h.save(primary); await h.save(dup);
  assert.equal((await h.report()).reviewedTotal, 100);
  await assert.rejects(h.save(await h.input(0, { disposition: "DUPLICATE", duplicateKey: dup.sourceKey })), /CANONICAL_REVIEW/);
  const before = structuredClone(h.state.reviews); h.state.failAudit = true;
  await assert.rejects(h.save(await h.input(0, { disposition: "EXCLUDED" })), /audit failure/);
  assert.deepEqual(h.state.reviews, before); assert.equal(h.state.audits.length, 2);
});
test("API requires all source permissions, derives actor/tenant, maps business errors but not infrastructure failures", async () => {
  const calls: any[] = []; let denied = "expense.view", failure: string | null = null;
  class ApiError extends Error { extensions: any; constructor(message: string, options: any) { super(message); this.extensions = options.extensions; } }
  const resolver = load("apps/web/graphql/bmsOperatingCosts.ts", name => {
    if (name === "graphql/error") return { GraphQLError: ApiError };
    if (name === "@/lib/auth") return { requireAuth: () => ({ author_id: "actor" }) };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, permission: string) => { if (permission === denied) throw new Error("FORBIDDEN"); calls.push(permission); } };
    if (name === "@/lib/bms/operatingCosts") return { getOperatingCostReport: async (...args: any[]) => { calls.push(args); if (failure) throw new Error(failure); return {}; },
      reviewOperatingCost: async (...args: any[]) => { calls.push(args); return { version: 1 }; } };
    return {};
  }).bmsOperatingCostResolvers;
  const run = () => resolver.Query.bmsOperatingCosts(null, { month: "2026-10", tenantId: "forged" }, {});
  await assert.rejects(run(), /FORBIDDEN/); assert.ok(!calls.some(Array.isArray));
  denied = ""; await run(); assert.deepEqual(calls.at(-1), ["server-tenant", "actor", "2026-10"]);
  denied = "expense.manage"; await assert.rejects(resolver.Mutation.bmsReviewOperatingCost(null, { input: {} }, {}), /FORBIDDEN/);
  denied = ""; await resolver.Mutation.bmsReviewOperatingCost(null, { input: { confirmed: true } }, {});
  assert.deepEqual(calls.at(-1), ["server-tenant", "actor", { confirmed: true }]);
  for (const [msg, code] of [["COST_ALL_BRANCH_ACCESS_REQUIRED", "FORBIDDEN"], ["COST_REVIEW_CONFLICT", "CONFLICT"], ["COST_MONTH_INVALID", "BAD_USER_INPUT"]]) {
    failure = msg; await assert.rejects(run(), (e: any) => e.extensions?.code === code);
  }
  failure = "DB unavailable"; await assert.rejects(run(), (e: any) => e.message === failure && !e.extensions);
});
test("manual additions preserve the positional menu metadata contract in both languages", () => {
  const file = ts.createSourceFile("manual.tsx", read("apps/web/app/(admin)/admin/manual/page.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sizes: Record<string, number> = {};
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["MENU_META", "MENU_CARDS_TH", "MENU_CARDS_EN"].includes(node.name.text)
      && node.initializer && ts.isArrayLiteralExpression(node.initializer)) sizes[node.name.text] = node.initializer.elements.length;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(sizes.MENU_META > 0);
  assert.equal(sizes.MENU_CARDS_TH, sizes.MENU_META);
  assert.equal(sizes.MENU_CARDS_EN, sizes.MENU_META);
});

test("SQL/migration contracts retain tenant, RLS, grants, bounded reads, signed notes and ledger separation", () => {
  const sql = read("db/migrations/10.64__bms_operating_cost_reviews.sql"), service = read("apps/web/lib/bms/operatingCosts.ts");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS/); assert.match(sql, /PRIMARY KEY \(tenant_id, source_key\)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/); assert.match(sql, /WITH CHECK/); assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE/);
  assert.match(sql, /ROLLBACK/); assert.doesNotMatch(sql, /CREATE TRIGGER/);
  for (const predicate of [/d.tenant_id=\$1/, /e.tenant_id=\$1/, /s.tenant_id=\$1/, /i.tenant_id=s.tenant_id/, /r.tenant_id=\$1/,
    /SUPPLIER_CREDIT_NOTE' THEN -1/, /s.fee_amount\+s.commission_amount/, /LIMIT \$3/, /i.environment='LIVE'/]) assert.match(service, predicate);
  assert.doesNotMatch(service, /bms_pos_cash_movements|bms_delivery_settlement_lines|bms_pos_petty_cash_ledger|recipeCosting|cost_amount_snapshot/);
  assert.doesNotMatch(service, /UPDATE bms_expense_documents|UPDATE bms_pos_expenses|UPDATE bms_delivery_settlements/);
});
