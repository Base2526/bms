/** Receipt evidence is counted once; cancelled drafts release their planning allocation. */
export function requisitionProgress(
  approved: number,
  drafts: number,
  transit: number,
  received: number,
  discrepancy: number,
) {
  const remaining = Math.max(0, approved - drafts - transit - received);
  const status =
    approved > 0 && received >= approved
      ? "RECEIVED"
      : discrepancy > 0
        ? "EXCEPTION"
        : received > 0
          ? "PARTIAL"
          : transit > 0
            ? "IN_TRANSIT"
            : drafts > 0
              ? "ALLOCATED"
              : "UNALLOCATED";
  return { remaining, status };
}

export function validRequisitionQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 1_000_000
  );
}

export function validRequisitionDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

/** PO amounts use NUMERIC(12,2) (5.2); reject rounded unit costs and overflow before I/O. */
export function validRequisitionPurchaseCosts(
  lines: ReadonlyArray<{ qty: number; unitCost?: number | null }>,
) {
  let totalMinor = 0;
  for (const { qty, unitCost } of lines) {
    if (
      !validRequisitionQuantity(qty) ||
      typeof unitCost !== "number" ||
      !Number.isFinite(unitCost) ||
      unitCost < 0 ||
      unitCost > 1_000_000 ||
      Number(unitCost.toFixed(2)) !== unitCost
    )
      return false;
    totalMinor += Math.round(unitCost * 100) * qty;
    if (totalMinor > 999_999_999_999) return false;
  }
  return lines.length > 0;
}
