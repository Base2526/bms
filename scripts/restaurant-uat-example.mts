// Read-only worked example. No database, HTTP, credentials, or business mutations.
// Calculator checks use BMS functions; the stock/cash ledger is an independent UAT oracle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateRecipeCostEstimate } from "../apps/web/lib/bms/recipeCosting.ts";
import { calculatePricePlan, normalizePricePlan } from "../apps/web/lib/bms/restaurantPricePlanning.ts";
import { composeDiscounts, evaluatePointsEarn } from "../apps/web/lib/bms/loyaltyMath.ts";
import { requisitionProgress } from "../apps/web/lib/bms/branchRequisitionMath.ts";

const data = JSON.parse(readFileSync(new URL("../docs/testing/restaurant-uat-sample-data.json", import.meta.url), "utf8"));
const product = (sku: string) => data.products.find((p: any) => p.sku === sku);
const round = (n: number) => Math.round(n * 100) / 100;
const costs: Record<string, number> = {};
for (const p of data.products) {
  if (!p.recipe) { costs[p.sku] = p.unitCost; continue; }
  const cost = calculateRecipeCostEstimate({ outputQty: 1,
    assumptions: { labor: data.planning.overhead, electricity: data.planning.overhead, gas: data.planning.overhead },
    ingredients: p.recipe.map((r: any) => ({ sku: r.sku, size: product(r.sku).unit, qty: r.qty, unitCost: String(product(r.sku).unitCost) })) });
  assert.equal(cost.status, "COMPLETE");
  costs[p.sku] = cost.totalUnitCost!;
}
assert.equal(costs["FAKE-LATTE"], 18);
assert.equal(costs["FAKE-AMERICANO"], 12);
const scenario = { label: "FAKE latte", price: 80, vatMode: "NONE", vatPercent: 0, gpPercent: 0,
  gpBasis: "NET_REVENUE", extraUnitCost: 0, expectedDailyUnits: 150, targetMarginPercent: null };
const plan = normalizePricePlan({ recipeId: "00000000-0000-4000-8000-000000000001",
  assumptionSource: "FAKE UAT arithmetic assumptions", dailyFixedCost: data.planning.dailyFixedCost,
  dailyTargetProfit: data.planning.dailyTargetProfit, scenarios: [scenario] });
const price = calculatePricePlan(plan, costs["FAKE-LATTE"])[0];
assert.equal(price.contribution, 62);
assert.equal(price.breakEvenUnits, 100);
assert.equal(price.targetDailyUnits, 150);
const discount = composeDiscounts({ settings: data.loyalty, subtotal: 80, tier: null,
  pointsRequested: 100, pointsAvailable: data.customer.startingPoints, manualDiscount: 0 });
const earned = evaluatePointsEarn(data.loyalty, { netTotal: discount.netTotal, discountAmount: discount.totalDiscount });
assert.equal(discount.netTotal, 70); assert.equal(earned.points, 7);
const pointsAfter = data.customer.startingPoints - discount.pointsUsed + earned.points;
assert.equal(pointsAfter, 107);
const request = requisitionProgress(20, 0, 0, 8, 2);
assert.equal(request.remaining, 12); assert.equal(request.status, "EXCEPTION");

const f = data.integrated;
const stock = structuredClone(data.openingStock);
stock["FAKE-CENTRAL"]["FAKE-MILK"] += f.poMilkQty;
stock["FAKE-CENTRAL"]["FAKE-WATER"] -= f.transferWaterQty;
stock["FAKE-A"]["FAKE-WATER"] += f.transferWaterQty;
let grossSales = 0, grossCost = 0;
for (const line of f.sale) {
  const p = product(line.sku);
  grossSales += p.salePrice * line.qty; grossCost += costs[line.sku] * line.qty;
  for (const r of p.recipe ?? [{ sku: p.sku, qty: 1 }]) stock["FAKE-A"][r.sku] -= r.qty * line.qty;
}
const refund = product("FAKE-WATER").salePrice * f.returnWaterQty;
const returnCost = costs["FAKE-WATER"] * f.returnWaterQty;
stock["FAKE-A"]["FAKE-WATER"] += f.returnWaterQty;
stock["FAKE-A"]["FAKE-MILK"] -= f.wasteMilkQty;
const countLoss = stock["FAKE-A"]["FAKE-CUP"] - f.countedCups;
stock["FAKE-A"]["FAKE-CUP"] = f.countedCups;
const netSales = grossSales - refund, netSaleCost = grossCost - returnCost;
const expected = { grossSales, grossCost, cashTendered: f.cashTendered, change: f.cashTendered - grossSales,
  refund, netSales, netSaleCost, ingredientContribution: netSales - netSaleCost,
  wasteCost: round(f.wasteMilkQty * costs["FAKE-MILK"]), countLossCost: countLoss * costs["FAKE-CUP"],
  cashExpense: f.cashExpense, drawerAtClose: f.openingCash + netSales - f.cashExpense, stock };
assert.equal(grossSales, 250); assert.equal(grossCost, 62);
assert.equal(expected.netSales, 235); assert.equal(expected.netSaleCost, 55);
assert.equal(expected.drawerAtClose, 715);
assert.deepEqual(stock["FAKE-A"], { "FAKE-BEAN": 1940, "FAKE-MILK": 4600, "FAKE-CUP": 96, "FAKE-WATER": 29 });
console.log(JSON.stringify({ status: "PASS", scope: "Pure BMS calculators and independent expected ledger only; no UI sale, database transaction, refund or tax issuance executed.",
  recipeCosts: { latte: costs["FAKE-LATTE"], americano: costs["FAKE-AMERICANO"] },
  pricePlan: { contribution: price.contribution, breakEvenUnits: price.breakEvenUnits, targetDailyUnits: price.targetDailyUnits },
  loyalty: { netTotal: discount.netTotal, pointsUsed: discount.pointsUsed, earned: earned.points, pointsAfter },
  partialRequisition: request, integratedExpected: expected }, null, 2));
