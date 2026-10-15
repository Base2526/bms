import { calculatePricePlan, normalizePricePlan, type PriceScenario } from "./restaurantPricePlanning";

// Planning only: supplied demand is NOT a sales query; never use these results in settlement.
export type MenuPlan = { assumptionSource: string; dailyFixedCost: number | null; dailyTargetProfit: number;
  items: { recipeId: string; scenario: PriceScenario }[];
  bundle: { scenario: PriceScenario; parts: { recipeId: string; qty: number }[] } | null };
const invalid = (): never => { throw new Error("MENU_PLAN_INVALID_INPUT"); };
export function normalizeMenuPlan(input: any): MenuPlan {
  if (!input || !Array.isArray(input.items) || input.items.length < 2 || input.items.length > 12) return invalid();
  const ids = new Set<string>(), labels = new Set<string>();
  const normalize = (recipeId: unknown, scenario: unknown) => normalizePricePlan({ recipeId,
    assumptionSource: input.assumptionSource, dailyFixedCost: input.dailyFixedCost,
    dailyTargetProfit: input.dailyTargetProfit, scenarios: [scenario] });
  const items = input.items.map((item: any) => {
    const p = normalize(item?.recipeId, item?.scenario), recipeId = p.recipeId.toLowerCase(), scenario = p.scenarios[0];
    if (ids.has(recipeId) || labels.has(scenario.label)) return invalid();
    ids.add(recipeId); labels.add(scenario.label);
    return { recipeId, scenario };
  });
  let bundle: MenuPlan["bundle"] = null;
  if (input.bundle != null) {
    const b = input.bundle;
    if (!Array.isArray(b.parts) || b.parts.length < 1 || b.parts.length > 12) return invalid();
    const used = new Set<string>();
    const parts = b.parts.map((part: any) => {
      const recipeId = typeof part?.recipeId === "string" ? part.recipeId.toLowerCase() : "";
      if (!ids.has(recipeId) || used.has(recipeId) || !Number.isInteger(part.qty) || part.qty < 1 || part.qty > 1000) return invalid();
      used.add(recipeId); return { recipeId, qty: part.qty };
    });
    bundle = { parts, scenario: normalize(items[0].recipeId, b.scenario).scenarios[0] };
  }
  const p = normalize(items[0].recipeId, items[0].scenario);
  return { items, bundle, assumptionSource: p.assumptionSource, dailyFixedCost: p.dailyFixedCost, dailyTargetProfit: p.dailyTargetProfit };
}
function cents(value: number): bigint {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) throw new Error("MENU_PLAN_RANGE_EXCEEDED");
  return BigInt(Math.round(value * 100));
}
function amount(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MENU_PLAN_RANGE_EXCEEDED");
  return Number(value) / 100;
}
/** Menu comparisons deliberately use displayed unit contribution in cents, including negative margins.
 * Popularity >= 70% of equal share; contribution >= demand-weighted mean. Ties count as high.
 * One unknown cost/demand invalidates the common benchmark, not just the affected row.
 */
export function calculateMenuPlan(input: MenuPlan, costs: Map<string, number | null>) {
  const plan = normalizeMenuPlan(input);
  const priced = plan.items.map(item => ({ ...item, price: calculatePricePlan({ recipeId: item.recipeId,
    assumptionSource: plan.assumptionSource, dailyFixedCost: null, dailyTargetProfit: 0, scenarios: [item.scenario] },
  costs.get(item.recipeId) ?? null)[0] }));
  const demandKnown = priced.every(r => r.scenario.expectedDailyUnits != null);
  const costKnown = priced.every(r => r.price.contribution != null);
  const totalUnits = demandKnown ? priced.reduce((s, r) => s + r.scenario.expectedDailyUnits!, 0) : null;
  const contributionCents = demandKnown && costKnown ? priced.reduce((s, r) => s + cents(r.price.contribution!) * BigInt(r.scenario.expectedDailyUnits!), 0n) : null;
  const status = !costKnown ? "INCOMPLETE_COST" : !demandKnown ? "INCOMPLETE_DEMAND" : totalUnits === 0 ? "NO_DEMAND" : "COMPLETE";
  const rows = priced.map(r => {
    let classification = "UNCLASSIFIED";
    if (status === "COMPLETE") {
      const popular = BigInt(r.scenario.expectedDailyUnits!) * BigInt(priced.length) * 10n >= BigInt(totalUnits!) * 7n;
      const profitable = cents(r.price.contribution!) * BigInt(totalUnits!) >= contributionCents!;
      classification = popular ? profitable ? "STAR" : "PLOWHORSE" : profitable ? "PUZZLE" : "DOG";
    }
    return { recipeId: r.recipeId, label: r.scenario.label, units: r.scenario.expectedDailyUnits, price: r.price, classification,
      popularityPercent: totalUnits != null && totalUnits > 0 ? r.scenario.expectedDailyUnits! * 100 / totalUnits : null };
  });
  let bundle = null;
  if (plan.bundle) {
    const parts = plan.bundle.parts.map(part => ({ ...part, row: priced.find(r => r.recipeId === part.recipeId)! }));
    // Per-item extras (e.g. packaging) belong to the individual alternative, NOT to the bundle.
    // Bundle extraUnitCost must contain all bundle-specific extras once.
    const complete = parts.every(p => costs.get(p.recipeId) != null);
    const bundleCost = complete ? amount(parts.reduce((s, p) => s + cents(costs.get(p.recipeId)!) * BigInt(p.qty), 0n)) : null;
    const price = calculatePricePlan({ recipeId: parts[0].recipeId, assumptionSource: plan.assumptionSource,
      dailyFixedCost: plan.dailyFixedCost, dailyTargetProfit: plan.dailyTargetProfit, scenarios: [plan.bundle.scenario] }, bundleCost)[0];
    const baselineCustomerTotal = amount(parts.reduce((s, p) => s + cents(p.row.price.customerTotal) * BigInt(p.qty), 0n));
    const baselineContribution = complete ? amount(parts.reduce((s, p) => s + cents(p.row.price.contribution!) * BigInt(p.qty), 0n)) : null;
    bundle = { price, recipeCost: bundleCost, baselineCustomerTotal, baselineContribution,
      customerSavings: amount(cents(baselineCustomerTotal) - cents(price.customerTotal)),
      contributionDelta: baselineContribution == null || price.contribution == null ? null : amount(cents(price.contribution) - cents(baselineContribution)) };
  }
  return { status, rows, totalUnits, popularityThresholdPercent: 70 / priced.length,
    contributionThreshold: status === "COMPLETE" ? Number(contributionCents! / BigInt(totalUnits!)) / 100 : null,
    // Threshold display is truncated toward zero; classification uses the exact weighted fraction.
    totalContribution: contributionCents == null ? null : amount(contributionCents),
    projectedProfit: contributionCents == null || plan.dailyFixedCost == null ? null : amount(contributionCents - cents(plan.dailyFixedCost)), bundle };
}
