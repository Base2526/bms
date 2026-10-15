import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as pricing from "../apps/web/lib/bms/restaurantPricePlanning.ts";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(dependency, exports);
  return exports;
}
const math = load("apps/web/lib/bms/restaurantMenuPlanning.ts", name => {
  assert.equal(name, "./restaurantPricePlanning"); return pricing;
});
const id = (n: number) => `0000000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scenario = (label: string, price = 100, units: number | null = 10, patch: any = {}) => ({ label, price, expectedDailyUnits: units,
  vatMode: "NONE", vatPercent: 0, gpPercent: 0, gpBasis: "NET_REVENUE", extraUnitCost: 0, targetMarginPercent: null, ...patch });
const item = (n: number, price = 100, units: number | null = 10, patch: any = {}) => ({ recipeId: id(n), scenario: scenario(`Menu ${n}`, price, units, patch) });
const plan = (patch: any = {}) => ({ assumptionSource: "FAKE daily cohort/channel/date", dailyFixedCost: 100, dailyTargetProfit: 0,
  items: [item(1), item(2)], bundle: null, ...patch });
const costs = (...values: (number | null)[]) => new Map(values.map((value, index) => [id(index + 1), value]));
const bundle = (patch: any = {}) => ({ scenario: scenario("Bundle", 150), parts: [{ recipeId: id(1), qty: 1 }, { recipeId: id(2), qty: 1 }], ...patch });

test("all four engineering quadrants use chosen population, weighted margin and 70% equal share", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 100, 40), item(2, 30, 40), item(3, 100, 10), item(4, 30, 10)] }), costs(10, 10, 10, 10));
  assert.equal(r.status, "COMPLETE"); assert.deepEqual(r.rows.map((r: any) => r.classification), ["STAR", "PLOWHORSE", "PUZZLE", "DOG"]);
  assert.equal(r.popularityThresholdPercent, 17.5); assert.equal(r.contributionThreshold, 55);
  assert.equal(r.totalUnits, 100); assert.equal(r.totalContribution, 5500); assert.equal(r.projectedProfit, 5400);
});
test("ties are high and cost/demand zero is known; zero-demand menus remain in population", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 20, 7), item(2, 20, 13)] }), costs(0, 0));
  assert.deepEqual(r.rows.map((r: any) => r.classification), ["STAR", "STAR"]); // 7/20 = 35%
  const zero = math.calculateMenuPlan(plan({ items: [item(1, 20, 0), item(2, 20, 10)] }), costs(0, 0));
  assert.equal(zero.rows[0].classification, "PUZZLE"); assert.equal(zero.popularityThresholdPercent, 35);
});
test("weighted benchmark classification uses exact fraction, not truncated display", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 0.01, 2), item(2, 0.02, 1)] }), costs(0, 0));
  assert.equal(r.contributionThreshold, 0.01); assert.equal(r.rows[0].classification, "PLOWHORSE");
  assert.equal(r.totalContribution, 0.04);
});
test("all-zero demand has no classification but zero totals and fixed-cost loss remain visible", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 100, 0), item(2, 100, 0)] }), costs(40, 40));
  assert.equal(r.status, "NO_DEMAND"); assert.equal(r.contributionThreshold, null); assert.equal(r.totalContribution, 0); assert.equal(r.projectedProfit, -100);
  assert.ok(r.rows.every((r: any) => r.classification === "UNCLASSIFIED" && r.popularityPercent == null));
});
test("missing cost anywhere prevents every margin group, including a zero-demand item", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1), item(2, 100, 0)] }), costs(40, null));
  assert.equal(r.status, "INCOMPLETE_COST"); assert.equal(r.totalContribution, null); assert.equal(r.projectedProfit, null);
  assert.ok(r.rows.every((r: any) => r.classification === "UNCLASSIFIED")); assert.equal(r.rows[0].price.contribution, 60);
});
test("unknown demand differs from zero; unknown fixed cost does not prevent engineering", () => {
  const unknown = math.calculateMenuPlan(plan({ items: [item(1), item(2, 100, null)] }), costs(40, 40));
  assert.equal(unknown.status, "INCOMPLETE_DEMAND"); assert.equal(unknown.totalUnits, null); assert.equal(unknown.contributionThreshold, null);
  assert.ok(unknown.rows.every((r: any) => r.popularityPercent == null && r.classification === "UNCLASSIFIED"));
  const fixed = math.calculateMenuPlan(plan({ dailyFixedCost: null }), costs(40, 40));
  assert.equal(fixed.status, "COMPLETE"); assert.equal(fixed.totalContribution, 1200); assert.equal(fixed.projectedProfit, null);
});
test("negative contribution is preserved; relative high group never turns losses into profit", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 0), item(2, 5)] }), costs(40, 40));
  assert.equal(r.totalContribution, -750); assert.equal(r.projectedProfit, -850); assert.equal(r.rows[1].classification, "STAR");
  assert.equal(r.rows[1].price.contribution, -35);
});
test("bundle quantities include gifts and use server recipe costs once; extras are alternative-specific", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 100, 10, { extraUnitCost: 5 }), item(2, 50, 10, { extraUnitCost: 3 })],
    bundle: bundle({ parts: [{ recipeId: id(1), qty: 2 }, { recipeId: id(2), qty: 1 }], scenario: scenario("Buy 2 + gift", 200, 5, { extraUnitCost: 8 }) }) }), costs(40, 10));
  assert.equal(r.bundle.recipeCost, 90); assert.equal(r.bundle.price.variableUnitCost, 98); assert.equal(r.bundle.price.contribution, 102);
  assert.equal(r.bundle.baselineCustomerTotal, 250); assert.equal(r.bundle.customerSavings, 50);
  assert.equal(r.bundle.baselineContribution, 147); assert.equal(r.bundle.contributionDelta, -45);
  assert.equal(r.bundle.price.projectedDailyProfit, 410); assert.equal(r.totalContribution, 920); assert.equal(r.projectedProfit, 820);
});
test("bundle VAT/GP bases reuse price planner, baseline is tax-inclusive customer payment", () => {
  const r = math.calculateMenuPlan(plan({ items: [item(1, 100, 10, { vatMode: "EXCLUSIVE", vatPercent: 7 }), item(2, 100)],
    bundle: bundle({ scenario: scenario("Delivery", 214, 10, { vatMode: "INCLUSIVE", vatPercent: 7, gpPercent: 30, gpBasis: "CUSTOMER_TOTAL" }) }) }), costs(40, 40));
  assert.equal(r.bundle.baselineCustomerTotal, 207); assert.equal(r.bundle.customerSavings, -7);
  assert.equal(r.bundle.price.netRevenue, 200); assert.equal(r.bundle.price.gpAmount, 64.2); assert.equal(r.bundle.price.contribution, 55.8);
});
test("bundle can use known subset without pretending unknown menu cost is zero", () => {
  const r = math.calculateMenuPlan(plan({ bundle: bundle({ parts: [{ recipeId: id(1), qty: 2 }] }) }), costs(40, null));
  assert.equal(r.status, "INCOMPLETE_COST"); assert.equal(r.bundle.recipeCost, 80); assert.equal(r.bundle.price.contribution, 70);
  const incomplete = math.calculateMenuPlan(plan({ bundle: bundle() }), costs(40, null));
  assert.equal(incomplete.bundle.recipeCost, null); assert.equal(incomplete.bundle.price.contribution, null);
  assert.equal(incomplete.bundle.baselineContribution, null); assert.equal(incomplete.bundle.contributionDelta, null);
  assert.equal(incomplete.bundle.customerSavings, 50);
});
test("bundle exact break-even and target margin; nonpositive bundle has no sales target", () => {
  const p = plan({ dailyFixedCost: 0.01, bundle: bundle({ parts: [{ recipeId: id(1), qty: 1 }],
    scenario: scenario("Fraction", 1, 1, { vatMode: "INCLUSIVE", vatPercent: 7, targetMarginPercent: 20 }) }) });
  const r = math.calculateMenuPlan(p, costs(0.93, 1)); assert.equal(r.bundle.price.contribution, 0); assert.equal(r.bundle.price.breakEvenUnits, 3);
  assert.equal(r.bundle.price.targetPrice, 1.25);
  p.bundle.scenario.price = 0;
  const loss = math.calculateMenuPlan(p, costs(0.93, 1)); assert.equal(loss.bundle.price.breakEvenUnits, null);
});
test("bounded and normalized inputs reject duplicate recipes/labels, invalid bundle membership and unsafe ranges", () => {
  for (const patch of [{ items: [] }, { items: [item(1)] }, { items: Array(13).fill(item(1)) }, { items: [item(1), item(1)] },
    { items: [item(1), { ...item(1), recipeId: id(1).toUpperCase() }] }, { items: [item(1), { ...item(2), scenario: scenario("Menu 1") }] },
    { assumptionSource: " " }, { dailyFixedCost: -1 }, { items: [item(1), item(2, 1, 1.1)] }, { bundle: { parts: [] } },
    { bundle: bundle({ parts: [{ recipeId: id(3), qty: 1 }] }) }, { bundle: bundle({ parts: [{ recipeId: id(1), qty: 0 }] }) },
    { bundle: bundle({ parts: [{ recipeId: id(1), qty: 1001 }] }) }, { bundle: bundle({ parts: [{ recipeId: id(1), qty: 1 }, { recipeId: id(1).toUpperCase(), qty: 2 }] }) },
    { bundle: bundle({ scenario: scenario("invalid", 100, 1, { vatPercent: 7 }) }) }]) assert.throws(() => math.normalizeMenuPlan(plan(patch)), /INVALID_INPUT/);
  const normalized = math.normalizeMenuPlan(plan({ items: [{ ...item(1), recipeId: id(1).toUpperCase() }, item(2)] }));
  assert.equal(normalized.items[0].recipeId, id(1));
  assert.throws(() => math.calculateMenuPlan(plan(), costs(90_000_000_000_000, 90_000_000_000_000)), /RANGE_EXCEEDED/);
});
test("real service validates before I/O, bounds reads and trusts server tenant/cost only", async () => {
  const calls: any[] = []; let missing = false, incomplete = false, fail = false;
  const service = load("apps/web/lib/bms/restaurantMenuPlans.ts", name => {
    if (name === "./restaurantMenuPlanning") return math;
    if (name === "./recipeCostEstimates") return { getRecipeCostEstimate: async (...args: any[]) => {
      calls.push(args); if (fail) throw new Error("DB unavailable");
      return missing ? null : { recipeId: args[1], recipeVersion: 7, calculatedAt: "FAKE", status: incomplete ? "INCOMPLETE" : "COMPLETE", totalUnitCost: 40 };
    } };
    throw new Error(name);
  });
  const run = (input: any = plan()) => service.previewRestaurantMenuPlan("tenant-server", input);
  assert.equal((await run({})).status, "INVALID_INPUT"); assert.equal(calls.length, 0);
  let r = await run({ ...plan({ bundle: bundle() }), tenantId: "forged", cost: 0 });
  assert.equal(r.analysis.totalContribution, 1200); assert.equal(calls.length, 2); assert.ok(calls.every(c => c[0] === "tenant-server"));
  incomplete = true; r = await run(); assert.equal(r.analysis.totalContribution, null);
  missing = true; r = await run(); assert.equal(r.status, "NOT_FOUND"); assert.deepEqual(r.estimates, []); assert.equal(r.analysis, null);
  fail = true; await assert.rejects(run(), /DB unavailable/);
});
test("GraphQL requires both permissions before service, server tenant, and query-only result contract", async () => {
  const calls: any[] = []; let deny = "product.view";
  const api = load("apps/web/graphql/bmsRestaurantMenuPlans.ts", name => {
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, p: string) => { if (p === deny) throw new Error("FORBIDDEN"); } };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "tenant-server" };
    if (name === "@/lib/bms/restaurantMenuPlans") return { previewRestaurantMenuPlan: async (...args: any[]) => { calls.push(args); return { status: "OK" }; } };
    throw new Error(name);
  }).bmsRestaurantMenuPlanResolvers;
  const run = () => api.Query.bmsRestaurantMenuPlan(null, { input: plan(), tenantId: "forged" }, {});
  for (deny of ["product.view", "report.view"]) { await assert.rejects(run(), /FORBIDDEN/); assert.equal(calls.length, 0); }
  deny = ""; assert.equal((await run()).status, "OK"); assert.deepEqual(calls[0], ["tenant-server", plan()]); assert.equal(api.Mutation, undefined);
  const sdl = read("schema.graphql"); assert.match(sdl, /bmsRestaurantMenuPlan\(input: BmsRestaurantMenuPlanInput!\): BmsRestaurantMenuPlan!/);
});
test("no actual sales, price, stock, expense, AI or promotion mutation is wired", () => {
  for (const file of ["restaurantMenuPlans", "restaurantMenuPlanning"]) assert.doesNotMatch(read(`apps/web/lib/bms/${file}.ts`), /INSERT INTO|UPDATE bms_|DELETE FROM|from ["'].*(?:reports|operatingCosts|pricing|pos|orders|tax)["']/);
  const ui = read("apps/web/app/(admin)/admin/stock-models/RestaurantMenuPlan.tsx");
  assert.match(ui, /fetchPolicy: "no-cache"/); assert.match(ui, /onValuesChange/); assert.doesNotMatch(ui, /useMutation|localStorage/);
});
