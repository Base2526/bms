// Reviewed management-cost evidence. Not a cash ledger, tax return or net-profit engine.
export const COST_SOURCE_KINDS = ["DOCUMENT", "POS_EXPENSE", "STATEMENT"] as const;
export const COST_DISPOSITIONS = ["UNREVIEWED", "OPERATING", "GP", "DEPRECIATION", "DUPLICATE", "EXCLUDED"] as const;
export type CostSourceKind = typeof COST_SOURCE_KINDS[number];
export type CostDisposition = typeof COST_DISPOSITIONS[number];
export type CostDecision = { disposition: CostDisposition; reason: string; duplicateKey: string | null;
  startMonth: string | null; lifeMonths: number | null; residual: number | null };
export type CostSource = { key: string; kind: CostSourceKind; id: string; month: string; amount: string | null;
  currency: string; category: string; reference: string; eligible: boolean; fingerprint: string };
export type CostReview = CostDecision & { version: number; sourceFingerprint: string };
export type ReviewedCostSource = CostSource & { review: CostReview | null };
export const COST_ROW_LIMIT = 1000;

export function costMonth(value: unknown): string {
  if (typeof value !== "string" || !/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(value)) throw new Error("COST_MONTH_INVALID");
  return value;
}
export function costSourceKey(value: unknown): { key: string; kind: CostSourceKind; id: string } {
  if (typeof value !== "string") throw new Error("COST_SOURCE_INVALID");
  const match = /^(DOCUMENT|POS_EXPENSE|STATEMENT):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
  if (!match) throw new Error("COST_SOURCE_INVALID");
  const kind = match[1].toUpperCase() as CostSourceKind, id = match[2].toLowerCase();
  return { key: `${kind}:${id}`, kind, id };
}
export function costCents(value: unknown): bigint | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}
function amount(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("COST_AMOUNT_OVERFLOW");
  return Number(cents) / 100;
}
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

export function normalizeCostDecision(input: any): CostDecision {
  if (!input || !COST_DISPOSITIONS.includes(input.disposition) || typeof input.reason !== "string"
    || !input.reason.trim() || input.reason.trim().length > 500) throw new Error("COST_REVIEW_INVALID");
  const disposition: CostDisposition = input.disposition;
  const duplicateKey = input.duplicateKey == null ? null : costSourceKey(input.duplicateKey).key;
  if ((disposition === "DUPLICATE") !== (duplicateKey != null)) throw new Error("COST_DUPLICATE_TARGET_REQUIRED");
  let startMonth: string | null = null, lifeMonths: number | null = null, residual: number | null = null;
  if (disposition === "DEPRECIATION") {
    startMonth = costMonth(input.startMonth);
    if (!Number.isInteger(input.lifeMonths) || input.lifeMonths < 1 || input.lifeMonths > 600
      || typeof input.residual !== "number" || costCents(input.residual) == null || input.residual < 0) throw new Error("COST_DEPRECIATION_INVALID");
    lifeMonths = input.lifeMonths; residual = input.residual;
  } else if (input.startMonth != null || input.lifeMonths != null || input.residual != null) throw new Error("COST_DEPRECIATION_NOT_APPLICABLE");
  return { disposition, reason: input.reason.trim(), duplicateKey, startMonth, lifeMonths, residual };
}

/** Whole-month straight-line management allocation. Cumulative cents conserve the asset's basis. */
export function monthlyDepreciation(basis: bigint, decision: CostDecision, month: string): bigint {
  const d = normalizeCostDecision(decision);
  if (d.disposition !== "DEPRECIATION" || basis < 0n || costCents(d.residual)! > basis) throw new Error("COST_DEPRECIATION_INVALID");
  const elapsed = monthIndex(costMonth(month)) - monthIndex(d.startMonth!);
  if (elapsed < 0 || elapsed >= d.lifeMonths!) return 0n;
  const depreciable = basis - costCents(d.residual)!;
  return depreciable * BigInt(elapsed + 1) / BigInt(d.lifeMonths!) - depreciable * BigInt(elapsed) / BigInt(d.lifeMonths!);
}

export function costReviewIsCurrent(source: ReviewedCostSource): boolean {
  return !!source.review && source.review.sourceFingerprint === source.fingerprint;
}
export function validateCostClassification(source: CostSource, decision: CostDecision): void {
  if (decision.disposition === "UNREVIEWED" || decision.disposition === "EXCLUDED") return;
  if (!source.eligible || source.currency !== "THB" || costCents(source.amount) == null) throw new Error("COST_SOURCE_NOT_ELIGIBLE");
  if (decision.disposition !== "DUPLICATE" && ["INVENTORY", "INGREDIENTS"].includes(source.category)) throw new Error("COST_INVENTORY_ALREADY_IN_COGS");
  if (source.kind === "STATEMENT" && !["GP", "DUPLICATE"].includes(decision.disposition)) throw new Error("COST_STATEMENT_GP_ONLY");
  if (decision.disposition === "DEPRECIATION") monthlyDepreciation(costCents(source.amount)!, decision, decision.startMonth!);
}

export function calculateOperatingCosts(monthValue: string, sources: ReviewedCostSource[], truncated = false) {
  const month = costMonth(monthValue);
  const byKey = new Map(sources.map(source => [source.key, source]));
  if (byKey.size !== sources.length) throw new Error("COST_DUPLICATE_SOURCE_ROWS");
  let operating = 0n, gp = 0n, depreciation = 0n, unresolvedCount = 0, duplicateCount = 0;
  const rows = sources.filter(s => s.month === month || s.review?.disposition === "DEPRECIATION").map(source => {
    const review = source.review;
    let state = "UNREVIEWED", recognized: bigint | null = null;
    if (!source.eligible && !review && source.kind !== "STATEMENT") { state = "NOT_ELIGIBLE"; recognized = 0n; }
    else if (review && !costReviewIsCurrent(source)) state = "SOURCE_CHANGED";
    else if (review) {
      try {
        const decision = normalizeCostDecision(review);
        validateCostClassification(source, decision);
        state = decision.disposition;
        const basis = costCents(source.amount);
        if (state === "EXCLUDED") recognized = 0n;
        else if (state === "DUPLICATE") {
          const target = byKey.get(decision.duplicateKey!);
          if (!target || target.key === source.key || !costReviewIsCurrent(target)
            || !["OPERATING", "GP", "DEPRECIATION"].includes(target.review!.disposition)) throw new Error("Invalid canonical evidence");
          validateCostClassification(target, normalizeCostDecision(target.review));
          recognized = 0n; duplicateCount++;
        } else if (state === "DEPRECIATION") { recognized = monthlyDepreciation(basis!, decision, month); depreciation += recognized; }
        else if (state === "OPERATING") { recognized = basis!; operating += recognized; }
        else if (state === "GP") { recognized = basis!; gp += recognized; }
      } catch { state = "REVIEW_REQUIRED"; recognized = null; }
    }
    if (recognized == null) unresolvedCount++;
    return { ...source, state, recognizedAmount: recognized == null ? null : amount(recognized) };
  });
  const known = operating + gp + depreciation;
  return { month, currency: "THB", scope: "ALL_BRANCHES", complete: !truncated && unresolvedCount === 0,
    truncated, unresolvedCount, duplicateCount, operatingAmount: amount(operating), gpAmount: amount(gp),
    depreciationAmount: amount(depreciation), knownTotal: amount(known),
    reviewedTotal: !truncated && unresolvedCount === 0 ? amount(known) : null, rows };
}
