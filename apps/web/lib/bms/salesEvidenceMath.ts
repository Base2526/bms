// Phase 7: historical evidence, not today's recipe estimate or a net-profit ledger.
// Amounts cross SQL/JSON boundaries as decimal strings. All arithmetic is in satang.
import { readReturnFinancialSnapshot } from "./returnFinancialSnapshot";
export type EvidenceKind = "SALE" | "RETURN" | "REFUND" | "PAYMENT_REFUND" | "BACKOFFICE_RETURN" | "TAX_ADJUSTMENT";
export type SalesEvidenceEvent = {
  key: string; kind: EvidenceKind; day: string; locationId: string | null; channel: string;
  orderId: string; payload: any;
};
export const EVIDENCE_METRICS = ["saleGross", "orderDiscount", "saleNet", "extras", "shipping", "rounding",
  "saleKnownVat", "saleKnownExVat", "saleKnownCost", "returnClaim", "returnKnownCostBasis", "refundCompleted", "creditReductionCompleted",
  "paymentRefundUnallocated", "backofficeReturnValue", "taxAdjustmentGross",
  "returnKnownMerchandiseGross", "returnKnownExtrasGross", "returnKnownShippingGross", "returnKnownRounding",
  "returnAllocatedVat", "returnAllocatedExVat"] as const;
type Metric = typeof EVIDENCE_METRICS[number];
type Amounts = Record<Metric, bigint>;
const zero = (): Amounts => Object.fromEntries(EVIDENCE_METRICS.map(k => [k, 0n])) as Amounts;
export function evidenceCents(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?\d{1,14}(?:\.\d{1,2})?$/.test(value)) throw new Error("SALES_EVIDENCE_INVALID_MONEY");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n);
}
export function evidenceDecimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}
const positive = (v: unknown) => { const n = evidenceCents(v); if (n < 0n) throw new Error("SALES_EVIDENCE_NEGATIVE_AMOUNT"); return n; };
const quantity = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^[1-9]\d{0,9}$/.test(v)) throw new Error("SALES_EVIDENCE_INVALID_QUANTITY");
  return BigInt(v);
};
/** Cumulative proportional attribution; conserves cents, never claims a persisted discount allocation. */
export function allocateEvidenceAmount(amount: bigint, weights: bigint[]): bigint[] {
  if (amount < 0n || weights.some(w => w < 0n)) throw new Error("SALES_EVIDENCE_INVALID_ALLOCATION");
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n) {
    if (amount !== 0n) throw new Error("SALES_EVIDENCE_ZERO_WEIGHT");
    return weights.map(() => 0n);
  }
  let cumulative = 0n, allocated = 0n;
  return weights.map(w => {
    cumulative += w;
    const target = (amount * cumulative * 2n + total) / (total * 2n);
    const part = target - allocated; allocated = target; return part;
  });
}

export function inspectSalesEvidence(event: SalesEvidenceEvent) {
  const p = event.payload, amounts = zero(), issues = new Set<string>();
  const attribution: { itemId: string; sku: string; size: string; qty: string; netAmount: string }[] = [];
  let missingCostLines = 0, legacyCostLines = 0;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("SALES_EVIDENCE_INVALID_PAYLOAD");
  if (p.legacyDate === true) issues.add("LEGACY_DATE_FALLBACK");
  const readCost = (line: any): bigint | null => {
    if (line.cost == null || line.costSource === "MISSING") { missingCostLines++; issues.add("MISSING_COST"); return null; }
    if (line.costSource === "LEGACY_CURRENT") { legacyCostLines++; issues.add("LEGACY_RECONSTRUCTED_COST"); }
    else if (line.costSource !== "CATALOG_AT_SALE") { missingCostLines++; issues.add("INVALID_COST_SOURCE"); return null; }
    return positive(line.cost);
  };
  if (event.kind === "SALE") {
    if (p.cancelledWithoutReturn === true) issues.add("CANCELLED_SALE_REQUIRES_RECONCILIATION");
    amounts.saleNet = positive(p.net); amounts.orderDiscount = positive(p.discount);
    amounts.saleGross = amounts.saleNet + amounts.orderDiscount;
    amounts.extras = positive(p.extras); amounts.shipping = positive(p.shipping);
    amounts.rounding = evidenceCents(p.rounding);
    if (!Array.isArray(p.lines) || p.lines.length > 1000) {
      issues.add("LINE_LIMIT"); return { amounts, issues: [...issues], missingCostLines, legacyCostLines, attribution };
    }
    const ids = new Set<string>();
    const weights = p.lines.map((line: any) => {
      if (typeof line.id !== "string" || ids.has(line.id)) throw new Error("SALES_EVIDENCE_DUPLICATE_LINE");
      ids.add(line.id); quantity(line.qty);
      const cost = readCost(line); if (cost !== null) amounts.saleKnownCost += cost;
      return positive(line.amount);
    });
    const lineGross = weights.reduce((a: bigint, b: bigint) => a + b, 0n) + amounts.extras;
    if (lineGross - amounts.orderDiscount !== amounts.saleNet
        || amounts.orderDiscount > amounts.saleGross - amounts.extras) issues.add("ORDER_TOTAL_MISMATCH");
    else {
      const discounts = allocateEvidenceAmount(amounts.orderDiscount, weights);
      p.lines.forEach((line: any, index: number) => attribution.push({ itemId: line.id, sku: line.sku,
        size: line.size, qty: line.qty, netAmount: evidenceDecimal(weights[index] - discounts[index]) }));
    }
    // Default-zero legacy order columns are NOT proof of zero VAT. Require a reconciled bucket snapshot.
    const taxable = positive(p.taxable), exempt = positive(p.exempt), vat = positive(p.vat);
    if (taxable + exempt !== amounts.saleNet + amounts.shipping || vat > taxable) issues.add("VAT_SNAPSHOT_UNRECONCILED");
    else { amounts.saleKnownVat = vat; amounts.saleKnownExVat = amounts.saleNet + amounts.shipping - vat; }
    if (p.lines.length === 0 && amounts.extras === 0n && amounts.saleNet !== 0n) issues.add("MISSING_LINES");
  } else if (event.kind === "RETURN") {
    amounts.returnClaim = positive(p.amount);
    if (!Array.isArray(p.lines) || p.lines.length > 1000) { issues.add("LINE_LIMIT"); }
    else {
      let claimed = 0n;
      for (const line of p.lines) {
        claimed += positive(line.amount);
        const qty = quantity(line.qty), soldQty = quantity(line.soldQty);
        if (typeof line.priorQty !== "string" || !/^\d{1,14}$/.test(line.priorQty)) throw new Error("SALES_EVIDENCE_INVALID_PRIOR_QUANTITY");
        const before = BigInt(line.priorQty);
        if (before < 0n || before + qty > soldQty) { issues.add("RETURN_QUANTITY_MISMATCH"); continue; }
        const cost = readCost(line);
        if (cost !== null) {
          const rounded = (q: bigint) => (cost * q * 2n + soldQty) / (2n * soldQty);
          amounts.returnKnownCostBasis += rounded(before + qty) - rounded(before);
        }
        // A refund is not proof that cooked food or ingredients were physically restocked.
        if (line.cancellationCause != null) issues.add("RESERVATION_RELEASE_NOT_RESTOCK");
      }
      if (claimed !== amounts.returnClaim) issues.add("RETURN_TOTAL_MISMATCH");
    }
    const snapshot = readReturnFinancialSnapshot(p.financialSnapshot, p.amount);
    const snapshotLinesMatch = snapshot && Array.isArray(p.lines) && p.lines.length <= 1000
      && p.lines.length === snapshot.lines.length
      && new Set(p.lines.map((l: any) => l.orderItemId)).size === p.lines.length
      && p.lines.every((line: any) => snapshot.lines.some(saved => saved.orderItemId === line.orderItemId
        && evidenceCents(saved.amount) === evidenceCents(line.amount)));
    if (!snapshot || !snapshotLinesMatch) {
      issues.add("RETURN_COMPONENTS_UNALLOCATED");
      if (p.financialSnapshot != null) issues.add("RETURN_SNAPSHOT_INVALID");
    } else {
      for (const code of snapshot.issues) issues.add(code);
      if (!snapshot.components) issues.add("RETURN_COMPONENTS_UNALLOCATED");
      else {
        amounts.returnKnownMerchandiseGross = evidenceCents(snapshot.components.merchandiseGross);
        amounts.returnKnownExtrasGross = evidenceCents(snapshot.components.extrasGross);
        amounts.returnKnownShippingGross = evidenceCents(snapshot.components.shippingGross);
        amounts.returnKnownRounding = evidenceCents(snapshot.components.rounding);
      }
      if (!snapshot.tax) issues.add("RETURN_VAT_UNALLOCATED");
      else {
        amounts.returnAllocatedVat = evidenceCents(snapshot.tax.vat);
        amounts.returnAllocatedExVat = evidenceCents(snapshot.tax.exVat);
        issues.add("RETURN_VAT_IS_SALE_ALLOCATION"); // Never silently stand in for the post-commit tax document.
      }
    }
    issues.add("RETURN_COST_IS_QUANTITY_BASIS"); // Not an authoritative inventory-cost reversal.
  } else if (event.kind === "REFUND") {
    if (p.method === "CREDIT") amounts.creditReductionCompleted = positive(p.amount);
    else if (typeof p.method === "string" && ["CASH", "QR", "CARD", "BANK_TRANSFER", "TIKTOK", "WALLET", "STORE_CREDIT", "PLATFORM_SETTLEMENT"].includes(p.method)) amounts.refundCompleted = positive(p.amount);
    else { amounts.paymentRefundUnallocated = positive(p.amount); issues.add("REFUND_METHOD_UNKNOWN"); }
  }
  else if (event.kind === "PAYMENT_REFUND") {
    amounts.paymentRefundUnallocated = positive(p.amount); issues.add("PAYMENT_REFUND_WITHOUT_LINE_ALLOCATION");
  } else if (event.kind === "BACKOFFICE_RETURN") {
    amounts.backofficeReturnValue = positive(p.amount); issues.add("BACKOFFICE_RETURN_WITHOUT_LINE_ALLOCATION");
  } else if (event.kind === "TAX_ADJUSTMENT") {
    amounts.taxAdjustmentGross = positive(p.amount) * (p.docType === "DEBIT_NOTE" ? 1n : -1n);
    issues.add("TAX_ADJUSTMENT_REQUIRES_RECONCILIATION");
  } else throw new Error("SALES_EVIDENCE_INVALID_EVENT_KIND");
  return { amounts, issues: [...issues], missingCostLines, legacyCostLines, attribution };
}

export function createSalesEvidenceAccumulator() {
  const total = zero();
  const groups = new Map<string, { day: string; locationId: string | null; channel: string; amounts: Amounts; eventCount: number }>();
  const issues = new Map<string, number>();
  const samples: { eventKey: string; orderId: string; codes: string[] }[] = [];
  let eventCount = 0, missingCostLines = 0, legacyCostLines = 0;
  const add = (event: SalesEvidenceEvent) => {
    const result = inspectSalesEvidence(event);
    const key = JSON.stringify([event.day, event.locationId, event.channel]);
    if (!groups.has(key)) groups.set(key, { day: event.day, locationId: event.locationId, channel: event.channel, amounts: zero(), eventCount: 0 });
    const group = groups.get(key)!; group.eventCount++; eventCount++;
    for (const metric of EVIDENCE_METRICS) { total[metric] += result.amounts[metric]; group.amounts[metric] += result.amounts[metric]; }
    missingCostLines += result.missingCostLines; legacyCostLines += result.legacyCostLines;
    for (const code of result.issues) issues.set(code, (issues.get(code) ?? 0) + 1);
    if (result.issues.length && samples.length < 100) samples.push({ eventKey: event.key, orderId: event.orderId, codes: result.issues });
  };
  const serialize = (a: Amounts) => Object.fromEntries(EVIDENCE_METRICS.map(k => [k, evidenceDecimal(a[k])])) as Record<Metric, string>;
  return { add, finish(truncated: boolean, limitCode = "EVENT_LIMIT") {
    if (truncated) issues.set(limitCode, 1);
    return { status: issues.size ? "INCOMPLETE" : "COMPLETE", eventCount, truncated,
      missingCostLines, legacyCostLines, totals: serialize(total),
      groups: [...groups.values()].sort((a, b) => JSON.stringify([a.day, a.locationId, a.channel]).localeCompare(JSON.stringify([b.day, b.locationId, b.channel])))
        .map(g => ({ day: g.day, locationId: g.locationId, channel: g.channel, eventCount: g.eventCount, totals: serialize(g.amounts) })),
      issues: [...issues].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })), samples,
      // Known evidence totals remain available; never expose a fake net profit from these mixed event clocks.
      netRevenue: null, netCost: null, netProfit: null,
    };
  } };
}
