import {
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamInstant } from "./operationTeamPolicy";
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
/** An output without expiry tracking may have no shelf-life date; never invent one. */
export function productionExpiryDate(v: unknown, required: boolean): string | null {
  if (v == null || v === "") {
    if (required) return reject("EXPIRY_REQUIRED");
    return null;
  }
  return productionDate(v);
}
/** Optional evidence only; it never mutates physical stock or invents conversion cost. */
export function productionMetrics(v: {
  startedAt?: unknown; endedAt?: unknown; rejectedQty?: unknown;
  laborMinutes?: unknown; energyKwh?: unknown;
}) {
  const paired = v.startedAt != null || v.endedAt != null;
  if (paired && (v.startedAt == null || v.endedAt == null)) return reject("INVALID_RUN_TIME");
  const startedAt = paired ? teamInstant(v.startedAt) : null;
  const endedAt = paired ? teamInstant(v.endedAt) : null;
  if (startedAt && endedAt &&
      (endedAt <= startedAt || Date.parse(endedAt) - Date.parse(startedAt) > 7 * 86400000 ||
       Date.parse(endedAt) > Date.now() + 300000)) return reject("INVALID_RUN_TIME");
  const whole = (n: unknown) => n == null ? null :
    Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 2147483647
      ? n as number : reject("INVALID_QUANTITY");
  const rejectedQty = whole(v.rejectedQty);
  const laborMinutes = whole(v.laborMinutes);
  const energyKwh = v.energyKwh == null ? null : Number(v.energyKwh);
  if (energyKwh !== null &&
      (!Number.isFinite(energyKwh) || energyKwh < 0 || energyKwh > 999999999 ||
       Math.abs(Math.round(energyKwh * 1000) - energyKwh * 1000) > 0.000001))
    return reject("INVALID_ENERGY");
  return { startedAt, endedAt, rejectedQty, laborMinutes, energyKwh };
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
