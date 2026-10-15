import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { normalizePricePlan, calculatePricePlan, type PricePlanInput } from "../apps/web/lib/bms/restaurantPricePlanning.ts";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = "00000000-0000-4000-8000-000000000001";
const scenario = (patch: any = {}) => ({ label: "Retail", price: 100, vatMode: "NONE", vatPercent: 0, gpPercent: 0,
  gpBasis: "NET_REVENUE", extraUnitCost: 0, expectedDailyUnits: 20, targetMarginPercent: 40, ...patch });
const plan = (row: any = {}, patch: any = {}): PricePlanInput => ({ recipeId: id, assumptionSource: "FAKE reviewed basis", dailyFixedCost: 1000,
  dailyTargetProfit: 200, scenarios: [scenario(row)], ...patch });
const calc = (row: any = {}, patch: any = {}, cost: number | null = 40) => calculatePricePlan(plan(row, patch), cost)[0];
test("retail contribution, whole-unit break-even, target profit and target margin use one consistent basis", () => {
  const r = calc(); assert.equal(r.status, "COMPLETE"); assert.equal(r.contribution, 60); assert.equal(r.contributionMarginPercent, 60);
  assert.equal(r.breakEvenUnits, 17); assert.equal(r.breakEvenCustomerSales, 1700); assert.equal(r.targetDailyUnits, 20);
  assert.equal(r.projectedDailyProfit, 200); assert.equal(r.targetPrice, 66.67);
});
test("VAT inclusive/exclusive have equivalent net revenue; GP gross and net bases are explicit", () => {
  for (const [price, vatMode] of [[107, "INCLUSIVE"], [100, "EXCLUSIVE"]]) {
    const net = calc({ price, vatMode, vatPercent: 7, gpPercent: 30 });
    const gross = calc({ price, vatMode, vatPercent: 7, gpPercent: 30, gpBasis: "CUSTOMER_TOTAL" });
    assert.equal(net.netRevenue, 100); assert.equal(net.customerTotal, 107); assert.equal(net.outputVat, 7); assert.equal(net.gpAmount, 30);
    assert.equal(net.contribution, 30); assert.equal(gross.gpAmount, 32.1); assert.equal(gross.contribution, 27.9);
    assert.equal(net.breakEvenUnits, 34); assert.equal(gross.breakEvenUnits, 36);
  }
});
test("fee plus extra cost is deducted once; scenario prices are independent, not a mixed basket", () => {
  const input = plan({}, { scenarios: [scenario(), scenario({ label: "Wholesale", price: 70, extraUnitCost: 5 }), scenario({ label: "Delivery", price: 120, gpPercent: 30, extraUnitCost: 10 })] });
  assert.deepEqual(calculatePricePlan(input, 40).map(r => r.contribution), [60, 25, 34]);
});
test("missing recipe evidence preserves known revenue/GP but never substitutes zero cost", () => {
  const r = calc({ gpPercent: 10 }, {}, null);
  assert.equal(r.netRevenue, 100); assert.equal(r.gpAmount, 10); assert.equal(r.status, "INCOMPLETE_COST");
  for (const key of ["variableUnitCost", "contribution", "contributionMarginPercent", "breakEvenUnits", "targetDailyUnits", "projectedDailyProfit", "targetPrice"]) assert.equal((r as any)[key], null);
});
test("missing fixed cost differs from zero; missing expected units differs from zero sales", () => {
  const unknown = calc({}, { dailyFixedCost: null }); assert.equal(unknown.contribution, 60); assert.equal(unknown.breakEvenUnits, null); assert.equal(unknown.status, "INCOMPLETE_FIXED_COST");
  const zero = calc({ expectedDailyUnits: 0 }, { dailyFixedCost: 0 }); assert.equal(zero.breakEvenUnits, 0); assert.equal(zero.projectedDailyProfit, 0);
  assert.equal(calc({ expectedDailyUnits: 0 }).projectedDailyProfit, -1000);
  assert.equal(calc({ expectedDailyUnits: null }).projectedDailyProfit, null);
});
test("non-positive contribution has no finite sales target; losses remain visible", () => {
  for (const price of [0, 39, 40]) {
    const r = calc({ price }); assert.equal(r.status, "NON_POSITIVE_CONTRIBUTION"); assert.equal(r.breakEvenUnits, null); assert.equal(r.targetDailyUnits, null);
    assert.ok(r.projectedDailyProfit! <= -1000);
  }
  assert.equal(calc({ price: 0 }).contributionMarginPercent, null);
  assert.equal(calc({ price: 0 }, { dailyFixedCost: 0, dailyTargetProfit: 0 }, 0).breakEvenUnits, null, "degenerate zero-balance case is not a sales recommendation");
});
test("break-even uses unrounded fractional contribution, not displayed satang", () => {
  const r = calc({ price: 1, vatMode: "INCLUSIVE", vatPercent: 7, targetMarginPercent: null }, { dailyFixedCost: 0.01, dailyTargetProfit: 0 }, 0.93);
  assert.equal(r.contribution, 0); assert.equal(r.status, "COMPLETE"); assert.equal(r.breakEvenUnits, 3);
});
test("minimum price rounds UP and applies the chosen VAT and GP factors", () => {
  const r = calc({ vatMode: "INCLUSIVE", vatPercent: 7, gpPercent: 30, gpBasis: "CUSTOMER_TOTAL", extraUnitCost: 5, targetMarginPercent: 20 });
  assert.equal(r.targetPrice, 100.53); // 45 / (0.8/1.07 - 0.3)
  const meet = calc({ price: r.targetPrice, vatMode: "INCLUSIVE", vatPercent: 7, gpPercent: 30, gpBasis: "CUSTOMER_TOTAL", extraUnitCost: 5, targetMarginPercent: 20 });
  assert.ok(meet.contributionMarginPercent! >= 20);
  assert.equal(calc({ gpPercent: 100, targetMarginPercent: 20 }).targetPriceStatus, "UNREACHABLE");
  assert.equal(calc({ targetMarginPercent: null }).targetPriceStatus, "NOT_REQUESTED");
});
test("zero-cost target prices still need positive revenue for a defined margin", () => {
  assert.equal(calc({}, {}, 0).targetPrice, 0.01);
  assert.equal(calc({ gpPercent: 100, targetMarginPercent: 0 }, {}, 0).targetPrice, 0.01);
});
test("boundaries reject malformed, oversized, duplicate and inconsistent assumptions", () => {
  assert.throws(() => calc({ expectedDailyUnits: 1_000_000 }, {}, 90_000_000_000_000), /RANGE_EXCEEDED/);
  for (const patch of [{ recipeId: "bad" }, { assumptionSource: " " }, { assumptionSource: "x".repeat(501) }, { dailyFixedCost: -1 },
    { dailyTargetProfit: null }, { scenarios: [] }, { scenarios: Array(13).fill(scenario()) }, { scenarios: [scenario(), scenario()] }]) assert.throws(() => normalizePricePlan(plan({}, patch)), /INVALID_INPUT/);
  for (const patch of [{ label: " " }, { label: "x".repeat(61) }, { price: NaN }, { price: Infinity }, { price: 1.001 }, { price: 1e10 },
    { price: "100" }, { vatMode: "OTHER" }, { vatPercent: 7 }, { gpBasis: "OTHER" }, { gpPercent: 100.01 }, { extraUnitCost: -1 },
    { expectedDailyUnits: 1.1 }, { expectedDailyUnits: 1_000_001 }, { targetMarginPercent: 100 }]) assert.throws(() => normalizePricePlan(plan(patch)), /INVALID_INPUT/);
});
test("service validates before I/O, reads server tenant/cost, returns business statuses, propagates infrastructure errors", async () => {
  const calls: any[] = []; let estimate: any = { status: "COMPLETE", totalUnitCost: 40 }, fail = false;
  const service = load("apps/web/lib/bms/restaurantPricePlans.ts", name => {
    if (name === "./restaurantPricePlanning") return { normalizePricePlan, calculatePricePlan };
    if (name === "./recipeCostEstimates") return { getRecipeCostEstimate: async (...args: any[]) => { calls.push(args); if (fail) throw new Error("DB unavailable"); return estimate; } };
    throw new Error(name);
  });
  const run = (input: any = plan()) => service.previewRestaurantPricePlan("tenant-server", input);
  assert.equal((await run({})).status, "INVALID_INPUT"); assert.equal(calls.length, 0);
  assert.equal((await run({ ...plan(), unitCost: 0, tenantId: "forged" })).scenarios[0].contribution, 60);
  assert.deepEqual(calls[0], ["tenant-server", id,undefined,normalizePricePlan(plan()),undefined]);
  estimate = { status: "INCOMPLETE", totalUnitCost: 0 }; assert.equal((await run()).scenarios[0].contribution, null);
  estimate = { status: "COMPLETE", totalUnitCost: 90_000_000_000_000 };
  assert.equal((await run(plan({ expectedDailyUnits: 1_000_000 }))).errorCode, "PRICE_PLAN_RANGE_EXCEEDED");
  estimate = null; assert.equal((await run()).status, "NOT_FOUND");
  fail = true; await assert.rejects(run(), /DB unavailable/);
});
test("GraphQL enforces both permissions before service and derives tenant; no mutation is exposed", async () => {
  let deny = "product.view"; const calls: any[] = [];
  const api = load("apps/web/graphql/bmsRestaurantPricePlans.ts", name => {
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, p: string) => { if (p === deny) throw new Error("FORBIDDEN"); } };
    if (name === "@/lib/auth") return {requireAuth:()=>({author_id:"server-actor"})};
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "tenant-server" };
    if (name === "@/lib/bms/restaurantPricePlans") return { previewRestaurantPricePlan: async (...args: any[]) => { calls.push(args); return {}; } };
    throw new Error(name);
  }).bmsRestaurantPricePlanResolvers;
  const run = () => api.Query.bmsRestaurantPricePlan(null, { input: plan(), tenantId: "forged" }, {});
  for (deny of ["product.view", "report.view"]) { await assert.rejects(run(), /FORBIDDEN/); assert.equal(calls.length, 0); }
  deny = ""; await run(); assert.deepEqual(calls[0], ["tenant-server", plan(),"server-actor"]); assert.equal(api.Mutation, undefined);
});
test("preview is isolated from persistence, actual pricing, monthly expenses and financial ledgers", () => {
  for (const file of ["restaurantPricePlans", "restaurantPricePlanning"]) assert.doesNotMatch(read(`apps/web/lib/bms/${file}.ts`), /INSERT INTO|UPDATE bms_|DELETE FROM|from ["'].*(?:operatingCosts|pricing|pos|orders|tax)["']/);
  const ui = read("apps/web/app/(admin)/admin/stock-models/RestaurantPricePlan.tsx");
  assert.match(ui, /fetchPolicy: "no-cache"/); assert.match(ui, /onValuesChange/); assert.doesNotMatch(ui, /useMutation|localStorage/);
});
function load(path: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(dependency, exports);
  return exports;
}
