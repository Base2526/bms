import { getRecipeCostEstimate } from "./recipeCostEstimates";
import { calculateMenuPlan, normalizeMenuPlan } from "./restaurantMenuPlanning";

export async function previewRestaurantMenuPlan(tenantId: string, input: unknown) {
  const rejected = (status: string, errorCode: string) => ({ status, errorCode, analysis: null, estimates: [] });
  let plan;
  try { plan = normalizeMenuPlan(input); }
  catch { return rejected("INVALID_INPUT", "MENU_PLAN_INVALID_INPUT"); }
  // Bounded sequential observations, not one atomic multi-recipe snapshot. Return each timestamp.
  const estimates = [];
  for (const item of plan.items) {
    const estimate = await getRecipeCostEstimate(tenantId, item.recipeId);
    if (!estimate) return rejected("NOT_FOUND", "RECIPE_NOT_FOUND");
    estimates.push(estimate);
  }
  try {
    const costs = new Map(estimates.map(e => [e.recipeId.toLowerCase(), e.status === "COMPLETE" ? e.totalUnitCost : null]));
    return { status: "OK", errorCode: null, estimates, analysis: calculateMenuPlan(plan, costs) };
  } catch (error) {
    if (!(error instanceof Error) || !/^(MENU|PRICE)_PLAN_/.test(error.message)) throw error;
    return rejected("INVALID_INPUT", error.message);
  }
}
