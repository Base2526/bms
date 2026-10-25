import {
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
export type ProductionIngredient = { sku: string; size: string; qty: number };
export const PRODUCTION_PERMISSIONS = {
  CREATE: "operations.production.manage",
  READY: "operations.production.manage",
  CANCEL: "operations.production.manage",
  POST: "operations.production.post",
  WASTE: "operations.production.post",
} as const;
export function productionQuantity(n: unknown): number {
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 2147483647)
    return reject("INVALID_QUANTITY");
  return n as number;
}
export function productionDate(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v.startsWith("0000-") ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    return reject("INVALID_DATE");
  return v;
}
export function productionIngredients(v: unknown): ProductionIngredient[] {
  if (!Array.isArray(v) || !v.length || v.length > 200)
    return reject("INVALID_INGREDIENTS");
  const seen = new Set<string>();
  return v
    .map((x) => {
      const sku = checklistText(x?.sku, 200, true),
        size = checklistText(x?.size, 100, true),
        qty = productionQuantity(x?.qty),
        key = JSON.stringify([sku, size]);
      if (seen.has(key)) return reject("DUPLICATE_INGREDIENT");
      seen.add(key);
      return { sku, size, qty };
    })
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size));
}
export function scaleProductionIngredients(
  items: ProductionIngredient[],
  recipeYield: number,
  planned: number,
) {
  productionQuantity(recipeYield);
  productionQuantity(planned);
  return productionIngredients(items).map((x) => {
    const value = BigInt(x.qty) * BigInt(planned),
      divisor = BigInt(recipeYield);
    if (value % divisor !== 0n) return reject("FRACTIONAL_BASE_UNIT");
    return { ...x, qty: productionQuantity(Number(value / divisor)) };
  });
}
