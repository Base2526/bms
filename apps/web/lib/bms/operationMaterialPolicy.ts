import {
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import {
  productionDate,
  productionQuantity,
} from "./operationProductionPolicy";
export const MATERIAL_PERMISSIONS = {
  CREATE: "operations.material.manage",
  CONFIRM: "operations.material.review",
  REFRESH: "operations.material.manage",
  CLOSE: "operations.material.review",
  CANCEL: "operations.material.manage",
  CREATE_PO: "operations.material.manage",
  LINK_PO: "operations.material.manage",
  LINK_REQUISITION: "operations.material.manage",
  INSPECT: "operations.material.manage",
  RECEIVE: "purchase.receive",
  CANCEL_INSPECTION: "operations.material.manage",
} as const;
export function materialWindow(from: unknown, to: unknown) {
  const a = productionDate(from),
    b = productionDate(to),
    days = (Date.parse(b) - Date.parse(a)) / 86400000;
  if (days < 0 || days > 6) reject("INVALID_DATE_RANGE");
  return { from: a, to: b };
}
export function materialCount(n: unknown, zero = false) {
  if (zero && n === 0) return 0;
  return productionQuantity(n);
}
export function materialKey(x: { sku: string; size: string }) {
  return JSON.stringify([x.sku, x.size]);
}
export function materialSources(
  input: unknown,
): Array<{ id: string; priority: number }> {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    return reject("INVALID_SOURCES");
  const seen = new Set<string>();
  return input.map((x) => {
    const id = checklistText(x?.id, 36, true);
    if (
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) ||
      seen.has(id) ||
      ![1, 2, 3].includes(x.priority)
    )
      reject("INVALID_SOURCES");
    seen.add(id);
    return { id, priority: x.priority };
  });
}
/** Available is consumed once in this preview only; this never reserves inventory. */
export function allocateMaterial(
  demands: Array<{
    productionId: string;
    priority: number;
    dueAt: string;
    qty: number;
  }>,
  available: number | null,
) {
  let remaining = available;
  return [...demands]
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(a.dueAt) - Date.parse(b.dueAt) ||
        a.productionId.localeCompare(b.productionId),
    )
    .map((x) => {
      const allocated = remaining == null ? null : Math.min(remaining, x.qty);
      if (remaining != null) remaining -= allocated!;
      return {
        ...x,
        allocated,
        shortage: allocated == null ? null : x.qty - allocated,
      };
    });
}
