import { getRecipeCostEstimate } from "./recipeCostEstimates";
import { normalizePricePlan, calculatePricePlan } from "./restaurantPricePlanning";

export async function previewRestaurantPricePlan(tenantId: string, input: unknown, actor?:string) {
  // Validate before DB I/O. Inputs are assumptions, never authoritative recipe costs or real prices.
  let plan;
  try { plan = normalizePricePlan(input); }
  catch { return { status: "INVALID_INPUT", errorCode: "PRICE_PLAN_INVALID_INPUT", estimate: null, scenarios: [] }; }
  const estimate = await getRecipeCostEstimate(tenantId, plan.recipeId,undefined,plan,actor);
  if (!estimate) return { status: "NOT_FOUND", errorCode: "RECIPE_NOT_FOUND", estimate: null, scenarios: [] };
  try {
    return { status: "OK", errorCode: null, estimate,
      scenarios: calculatePricePlan(plan, estimate.status === "COMPLETE" ? estimate.totalUnitCost : null) };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("PRICE_PLAN_")) throw error;
    return { status: "INVALID_INPUT", errorCode: error.message, estimate: null, scenarios: [] };
  }
}
