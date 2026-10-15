// Read-only what-if arithmetic. Never import into pricing, settlement, stock or actual-profit reports.
export type PriceScenario = { label: string; price: number; vatMode: "NONE" | "INCLUSIVE" | "EXCLUSIVE";
  vatPercent: number; gpPercent: number; gpBasis: "CUSTOMER_TOTAL" | "NET_REVENUE"; extraUnitCost: number;
  expectedDailyUnits: number | null; targetMarginPercent: number | null };
export type PricePlanInput = { costBasis?: "CATALOG" | "WEIGHTED_AVERAGE"; locationId?: string | null; recipeId: string; assumptionSource: string; dailyFixedCost: number | null;
  dailyTargetProfit: number; scenarios: PriceScenario[] };
const invalid = (): never => { throw new Error("PRICE_PLAN_INVALID_INPUT"); };
function hundredths(value: unknown, max = 1_000_000_000): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return invalid();
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function normalizePricePlan(input: any): PricePlanInput {
  if (!input || typeof input.recipeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.recipeId)
    || typeof input.assumptionSource !== "string" || !input.assumptionSource.trim() || input.assumptionSource.trim().length > 500
    || !Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 12) return invalid();
  if (input.dailyFixedCost != null) hundredths(input.dailyFixedCost);
  hundredths(input.dailyTargetProfit);
  const names = new Set<string>();
  const scenarios = input.scenarios.map((row: any): PriceScenario => {
    if (!row || typeof row.label !== "string" || !row.label.trim() || row.label.trim().length > 60 || names.has(row.label.trim())
      || !["NONE", "INCLUSIVE", "EXCLUSIVE"].includes(row.vatMode) || !["CUSTOMER_TOTAL", "NET_REVENUE"].includes(row.gpBasis)) return invalid();
    names.add(row.label.trim());
    hundredths(row.price); hundredths(row.extraUnitCost); hundredths(row.vatPercent, 100); hundredths(row.gpPercent, 100);
    if (row.vatMode === "NONE" && row.vatPercent !== 0) return invalid();
    if (row.expectedDailyUnits != null && (!Number.isInteger(row.expectedDailyUnits) || row.expectedDailyUnits < 0 || row.expectedDailyUnits > 1_000_000)) return invalid();
    if (row.targetMarginPercent != null) hundredths(row.targetMarginPercent, 99.99);
    return { label: row.label.trim(), price: row.price, vatMode: row.vatMode, vatPercent: row.vatPercent,
      gpPercent: row.gpPercent, gpBasis: row.gpBasis, extraUnitCost: row.extraUnitCost,
      expectedDailyUnits: row.expectedDailyUnits ?? null, targetMarginPercent: row.targetMarginPercent ?? null };
  });
  if (input.costBasis != null && !["CATALOG","WEIGHTED_AVERAGE"].includes(input.costBasis)) return invalid();
  if (input.costBasis === "WEIGHTED_AVERAGE" && (typeof input.locationId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.locationId))) return invalid();
  return { ...(input.costBasis ? {costBasis:input.costBasis,locationId:input.costBasis==="CATALOG"?null:input.locationId} : {}), recipeId: input.recipeId, assumptionSource: input.assumptionSource.trim(), dailyFixedCost: input.dailyFixedCost ?? null,
    dailyTargetProfit: input.dailyTargetProfit, scenarios };
}
type Fraction = { n: bigint; d: bigint };
const f = (n: bigint, d = 1n): Fraction => ({ n, d });
const mul = (a: Fraction, b: Fraction) => f(a.n * b.n, a.d * b.d);
const sub = (a: Fraction, b: Fraction) => f(a.n * b.d - b.n * a.d, a.d * b.d);
function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PRICE_PLAN_RANGE_EXCEEDED");
  return Number(value);
}
const ceil = (a: Fraction) => (a.n + a.d - 1n) / a.d;
const money = (a: Fraction) => safe((a.n < 0n ? -1n : 1n) * ((a.n < 0n ? -a.n : a.n) * 2n + a.d) / (2n * a.d)) / 100;
const ratio = (a: Fraction, b: Fraction) => f(a.n * b.d, a.d * b.n);

/** Exact fractions until display; upward-rounded whole-unit targets never use rounded contribution. */
export function calculatePricePlan(input: PricePlanInput, recipeUnitCost: number | null) {
  const plan = normalizePricePlan(input);
  const cost = recipeUnitCost == null ? null : hundredths(recipeUnitCost, 90_000_000_000_000);
  return plan.scenarios.map(row => {
    const tax = 10_000n + hundredths(row.vatPercent, 100);
    const netFactor = row.vatMode === "INCLUSIVE" ? f(10_000n, tax) : f(1n);
    const grossFactor = row.vatMode === "EXCLUSIVE" ? f(tax, 10_000n) : f(1n);
    const gpFactor = mul(row.gpBasis === "CUSTOMER_TOTAL" ? grossFactor : netFactor, f(hundredths(row.gpPercent, 100), 10_000n));
    const price = f(hundredths(row.price)), net = mul(price, netFactor), gross = mul(price, grossFactor), gp = mul(price, gpFactor);
    const variable = cost == null ? null : f(cost + hundredths(row.extraUnitCost));
    const contribution = variable == null ? null : sub(sub(net, gp), variable);
    const fixed = plan.dailyFixedCost == null ? null : hundredths(plan.dailyFixedCost);
    const units = (target: bigint) => contribution && contribution.n > 0n ? safe(ceil(ratio(f(target), contribution))) : null;
    const breakEvenUnits = fixed == null ? null : units(fixed);
    const marginFactor = row.targetMarginPercent == null ? null : sub(mul(netFactor, f(10_000n - hundredths(row.targetMarginPercent, 99.99), 10_000n)), gpFactor);
    // Margin is undefined at zero revenue. Even a zero-cost scenario needs a positive cent price.
    const targetCents = variable && marginFactor && (marginFactor.n > 0n || (marginFactor.n === 0n && variable.n === 0n))
      ? (marginFactor.n === 0n ? 1n : ceil(ratio(variable, marginFactor))) : null;
    const targetPrice = targetCents == null ? null : safe(targetCents < 1n ? 1n : targetCents) / 100;
    return { label: row.label, status: contribution == null ? "INCOMPLETE_COST" : contribution.n <= 0n ? "NON_POSITIVE_CONTRIBUTION"
      : fixed == null ? "INCOMPLETE_FIXED_COST" : "COMPLETE",
      customerTotal: money(gross), netRevenue: money(net), outputVat: money(sub(gross, net)), gpAmount: money(gp),
      variableUnitCost: variable == null ? null : money(variable), contribution: contribution == null ? null : money(contribution),
      contributionMarginPercent: contribution == null || net.n === 0n ? null : money(mul(ratio(contribution, net), f(10_000n))),
      breakEvenUnits, breakEvenCustomerSales: breakEvenUnits == null ? null : money(mul(gross, f(BigInt(breakEvenUnits)))),
      targetDailyUnits: fixed == null ? null : units(fixed + hundredths(plan.dailyTargetProfit)),
      projectedDailyProfit: contribution == null || fixed == null || row.expectedDailyUnits == null ? null
        : money(sub(mul(contribution, f(BigInt(row.expectedDailyUnits))), f(fixed))),
      targetPrice, targetPriceStatus: row.targetMarginPercent == null ? "NOT_REQUESTED" : variable == null ? "INCOMPLETE_COST"
        : targetPrice == null ? "UNREACHABLE" : "COMPLETE" };
  });
}
