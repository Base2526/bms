// Monthly management P&L over recorded evidence, before income tax. Not a statutory ledger.
import { evidenceCents as cents, evidenceDecimal as decimal, inspectSalesEvidence, type SalesEvidenceEvent } from "./salesEvidenceMath";

type Bucket = { sales: bigint; returns: bigint; cost: bigint; returnCostBasis: bigint; refunds: bigint; creditReductions: bigint;
  revenueComplete: boolean; costComplete: boolean; operating: bigint; gp: bigint; depreciation: bigint };
const empty = (): Bucket => ({ sales: 0n, returns: 0n, cost: 0n, returnCostBasis: 0n, refunds: 0n, creditReductions: 0n,
  revenueComplete: true, costComplete: true, operating: 0n, gp: 0n, depreciation: 0n });
type AllocationReport = {
  reviewedTotal: string | null; complete: boolean; truncated: boolean;
  locations: { id: string; name: string }[];
  rows: { sourceKey: string; classification: string; amount: string | null; state: string;
    snapshot: { allocations: { locationId: string; channel: string | null; amount: string }[] } | null }[];
};
export type ProfitGap = { key: string; code: string };
const costIssues = new Set(["MISSING_COST", "INVALID_COST_SOURCE", "LEGACY_RECONSTRUCTED_COST"]);
const keyOf = (locationId: string | null, channel: string | null) => JSON.stringify([locationId, channel]);

export function createNetProfitAccumulator() {
  const total = empty(), branches = new Map<string, Bucket>(), channels = new Map<string, Bucket>();
  const issues = new Map<string, number>(), samples: { key: string; code: string }[] = [], seen = new Set<string>();
  let eventCount = 0, finished = false;
  const issue = (code: string, key: string) => {
    issues.set(code, (issues.get(code) ?? 0) + 1);
    if (samples.length < 100) samples.push({ key, code });
  };
  const get = (map: Map<string, Bucket>, key: string) => {
    if (!map.has(key)) map.set(key, empty()); return map.get(key)!;
  };
  return {
    add(event: SalesEvidenceEvent) {
      if (finished) throw new Error("NET_PROFIT_ACCUMULATOR_CLOSED");
      if (seen.has(event.key)) throw new Error("NET_PROFIT_DUPLICATE_EVENT");
      seen.add(event.key); eventCount++;
      const b = empty(), result = inspectSalesEvidence(event), a = result.amounts;
      const codes = new Set(result.issues);
      if (event.kind === "SALE") {
        b.revenueComplete = result.issues.every(c => costIssues.has(c));
        b.costComplete = !result.issues.some(c => costIssues.has(c) || ["LINE_LIMIT", "MISSING_LINES", "LEGACY_DATE_FALLBACK", "CANCELLED_SALE_REQUIRES_RECONCILIATION"].includes(c));
        if (b.revenueComplete) b.sales = a.saleKnownExVat + a.rounding;
        // Legacy/current catalog reconstruction is not historical cost, even in the known subtotal.
        if (Array.isArray(event.payload.lines) && event.payload.lines.length <= 1000) {
          for (const line of event.payload.lines) if (line.costSource === "CATALOG_AT_SALE" && line.cost != null) b.cost += cents(line.cost);
        }
      } else if (event.kind === "RETURN") {
        b.revenueComplete = result.issues.every(c => costIssues.has(c) || ["RETURN_COST_IS_QUANTITY_BASIS", "RESERVATION_RELEASE_NOT_RESTOCK", "RETURN_VAT_IS_SALE_ALLOCATION", "RETURN_QUANTITY_MISMATCH"].includes(c));
        if (b.revenueComplete) b.returns = a.returnAllocatedExVat + a.returnKnownRounding;
        b.returnCostBasis = a.returnKnownCostBasis;
        // The existing evidence cannot prove a cost reversal/restock (especially cooked food).
        // Do not silently turn the diagnostic quantity basis into an actual reduction of COGS.
        b.costComplete = false; codes.add("RETURN_COST_REVERSAL_UNVERIFIED");
      } else if (event.kind === "REFUND") {
        b.refunds = a.refundCompleted; b.creditReductions = a.creditReductionCompleted;
        // Payment timing is not another revenue/cost event. Unknown methods remain diagnostics.
      } else {
        b.revenueComplete = false;
        if (event.kind === "BACKOFFICE_RETURN") b.costComplete = false;
      }
      for (const code of codes) issue(code, event.key);
      if (typeof event.locationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.locationId)
          || typeof event.channel !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(event.channel)) {
        issue("PROFIT_EVENT_SCOPE_UNKNOWN", event.key); b.revenueComplete = false; b.costComplete = false;
      }
      const targets = [total, get(branches, keyOf(event.locationId, null)), get(channels, keyOf(event.locationId, event.channel))];
      for (const target of targets) {
        for (const k of ["sales", "returns", "cost", "returnCostBasis", "refunds", "creditReductions"] as const) target[k] += b[k];
        target.revenueComplete &&= b.revenueComplete; target.costComplete &&= b.costComplete;
      }
    },
    finish(allocation: AllocationReport, scan: { truncated: boolean; limitCode: string }, gaps: ProfitGap[] = [], gapsTruncated = false) {
      if (finished) throw new Error("NET_PROFIT_ACCUMULATOR_CLOSED");
      finished = true;
      if (scan.truncated) issue(scan.limitCode, "SALES_SCAN");
      if (gapsTruncated) issue("PROFIT_GAP_LIMIT", "SUPPLEMENTAL_SCAN");
      for (const gap of gaps) issue(gap.code, gap.key);
      const unknownRevenue = scan.truncated || gapsTruncated || gaps.some(g => g.code === "BLIND_RETURN_UNRECONCILED");
      const unknownCost = scan.truncated || gapsTruncated || gaps.length > 0;
      const branchWide = new Set<string>();
      const addExpense = (b: Bucket, classification: string, amount: string) => {
        const field = classification === "OPERATING" ? "operating" : classification === "GP" ? "gp" : "depreciation";
        b[field] += cents(amount);
      };
      for (const row of allocation.rows) {
        if (!["OPERATING", "GP", "DEPRECIATION"].includes(row.classification) || row.amount == null) continue;
        addExpense(total, row.classification, row.amount);
        if (row.state !== "CURRENT" || !row.snapshot) continue;
        const parts = row.snapshot.allocations;
        if (parts.reduce((n, p) => n + cents(p.amount), 0n) !== cents(row.amount)) throw new Error("NET_PROFIT_ALLOCATION_MISMATCH");
        for (const part of parts) {
          addExpense(get(branches, keyOf(part.locationId, null)), row.classification, part.amount);
          addExpense(get(channels, keyOf(part.locationId, part.channel)), row.classification, part.amount);
          if (part.channel === null && cents(part.amount) !== 0n) branchWide.add(part.locationId);
        }
      }
      const expenseSum = total.operating + total.gp + total.depreciation;
      if (allocation.reviewedTotal != null && cents(allocation.reviewedTotal) !== expenseSum) throw new Error("NET_PROFIT_EXPENSE_MISMATCH");
      // A saved allocation whose source disappeared is evidence of an unresolved expense,
      // even if the remaining phase-4 source query happens to sum to zero.
      const expensesComplete = allocation.reviewedTotal != null && !allocation.truncated
        && !allocation.rows.some(row => row.classification === "MISSING");
      if (!expensesComplete) issue("OPERATING_COST_REVIEW_INCOMPLETE", "EXPENSES");
      if (!allocation.complete) issue("COST_ALLOCATION_INCOMPLETE", "ALLOCATION");
      for (const branch of branchWide) issue("BRANCH_WIDE_COST_NOT_CHANNEL_ALLOCATED", branch);
      const render = (b: Bucket, expenseComplete: boolean, bucketOnly = false) => {
        const revenueComplete = b.revenueComplete && !unknownRevenue && !bucketOnly;
        const costComplete = b.costComplete && !unknownCost && !bucketOnly;
        const netRevenue = revenueComplete ? b.sales - b.returns : null;
        const netCost = costComplete ? b.cost : null;
        const gross = netRevenue != null && netCost != null ? netRevenue - netCost : null;
        const expense = b.operating + b.gp + b.depreciation;
        const profit = gross != null && expenseComplete ? gross - expense : null;
        return { complete: profit != null, revenueComplete, costComplete, expensesComplete: expenseComplete,
          knownSalesRevenue: decimal(b.sales), knownReturnRevenue: decimal(b.returns), knownSalesCost: decimal(b.cost),
          returnQuantityCostBasis: decimal(b.returnCostBasis), refundCompleted: decimal(b.refunds), creditReductionCompleted: decimal(b.creditReductions),
          netRevenue: netRevenue == null ? null : decimal(netRevenue), netCost: netCost == null ? null : decimal(netCost),
          grossProfit: gross == null ? null : decimal(gross), knownOperatingExpense: decimal(b.operating), knownGpExpense: decimal(b.gp),
          knownDepreciationExpense: decimal(b.depreciation), knownExpenseTotal: decimal(expense),
          expenseTotal: expenseComplete ? decimal(expense) : null, netProfit: profit == null ? null : decimal(profit) };
      };
      const groups = (map: Map<string, Bucket>, channelGroups: boolean) => [...map].sort(([a], [b]) => a < b ? -1 : 1).map(([key, b]) => {
        const [locationId, channel] = JSON.parse(key);
        const shared = channelGroups && branchWide.has(locationId);
        const bucketOnly = channelGroups && channel === null;
        return { locationId, locationName: allocation.locations.find(l => l.id === locationId)?.name ?? locationId,
          channel, bucketOnly, sharedBranchCost: shared,
          ...render(b, expensesComplete && allocation.complete && !shared, bucketOnly) };
      });
      const totals = render(total, expensesComplete);
      return { status: "OK", complete: totals.complete, eventCount, truncated: scan.truncated || allocation.truncated || gapsTruncated,
        totals, branches: groups(branches, false), channels: groups(channels, true),
        issues: [...issues].sort(([a], [b]) => a < b ? -1 : 1).map(([code, count]) => ({ code, count })), samples,
        basis: "RECORDED_MONTHLY_PRE_INCOME_TAX_V1", costBasis: "CATALOG_AT_SALE_NOT_PURCHASE_LOT",
        returnBasis: "SALE_VAT_ALLOCATION_COST_REVERSAL_UNKNOWN", expenseBasis: "REVIEWED_SOURCE_MONTH_NOT_CASH_DATE" };
    },
  };
}
