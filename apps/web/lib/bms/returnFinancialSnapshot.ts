// Reporting evidence only. Never prices a return or authorises a cash/stock/tax mutation.
// VAT is a cumulative allocation of the frozen SALE buckets, NOT an issued credit note.
type Money = string;
export type ReturnFinancialSource = {
  payable: Money; shipping: Money; rounding: Money; extras: Money;
  taxable: Money; exempt: Money; vat: Money; extraTaxable: Money;
};
export type ReturnFinancialLine = { orderItemId: string; amount: Money; vatCategory: string };
type Components = { merchandiseGross: Money; extrasGross: Money; shippingGross: Money; rounding: Money };
type Tax = { taxableGross: Money; exemptGross: Money; vat: Money; exVat: Money };
export type ReturnFinancialSnapshot = {
  version: 1; policy: "RETAIN_AUXILIARIES_UNTIL_FULL_V1" | "LEGACY_PROPORTIONAL_V1";
  vatBasis: "SALE_BUCKET_CUMULATIVE_ALLOCATION_V1";
  amount: Money; source: ReturnFinancialSource; lines: ReturnFinancialLine[];
  components: Components | null; tax: Tax | null; issues: string[];
};

const cents = (v: unknown): bigint => {
  if (typeof v !== "string" || !/^-?\d{1,14}(?:\.\d{1,2})?$/.test(v)) throw new Error("RETURN_SNAPSHOT_INVALID_MONEY");
  const sign = v.startsWith("-") ? -1n : 1n;
  const [whole, fraction = ""] = v.replace(/^-/, "").split(".");
  return sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
};
const money = (n: bigint): Money => `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, "0")}`;
const nonnegative = (v: unknown) => { const n = cents(v); if (n < 0n) throw new Error("RETURN_SNAPSHOT_NEGATIVE_AMOUNT"); return n; };
const proportional = (amount: bigint, numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) { if (amount === 0n || numerator === 0n) return 0n; throw new Error("RETURN_SNAPSHOT_ZERO_BASIS"); }
  const magnitude = amount < 0n ? -amount : amount;
  return ((magnitude * numerator * 2n + denominator) / (2n * denominator)) * (amount < 0n ? -1n : 1n);
};
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const sourceKeys = ["payable", "shipping", "rounding", "extras", "taxable", "exempt", "vat", "extraTaxable"] as const;

/** Strict JSON boundary, used both for persisted history and report consumption. */
export function readReturnFinancialSnapshot(value: unknown, expectedAmount: string): ReturnFinancialSnapshot | null {
  try {
    const s = value as ReturnFinancialSnapshot;
    if (!s || s.version !== 1 || !["RETAIN_AUXILIARIES_UNTIL_FULL_V1", "LEGACY_PROPORTIONAL_V1"].includes(s.policy)
        || s.vatBasis !== "SALE_BUCKET_CUMULATIVE_ALLOCATION_V1" || cents(s.amount) !== nonnegative(expectedAmount)
        || !Array.isArray(s.issues) || !s.issues.every(i => typeof i === "string")
        || !Array.isArray(s.lines) || s.lines.length === 0) return null;
    for (const key of sourceKeys) key === "rounding" ? cents(s.source[key]) : nonnegative(s.source[key]);
    if (new Set(s.lines.map(l => l.orderItemId)).size !== s.lines.length
        || s.lines.some(l => !/^[1-9]\d*$/.test(l.orderItemId) || !["V", "N", "UNKNOWN"].includes(l.vatCategory))
        || sum(s.lines.map(l => nonnegative(l.amount))) !== cents(s.amount)) return null;
    if (s.components !== null) {
      const c = s.components;
      if (nonnegative(c.merchandiseGross) + nonnegative(c.extrasGross) + nonnegative(c.shippingGross) + cents(c.rounding) !== cents(s.amount)) return null;
      if (cents(c.shippingGross) > cents(s.source.shipping) || cents(c.extrasGross) > cents(s.source.extras)
          || (cents(c.rounding) < 0n ? -cents(c.rounding) : cents(c.rounding)) > (cents(s.source.rounding) < 0n ? -cents(s.source.rounding) : cents(s.source.rounding))
          || cents(c.rounding) * cents(s.source.rounding) < 0n) return null;
    }
    if (s.tax !== null) {
      if (!s.components) return null;
      const t = s.tax, gross = cents(s.amount) - cents(s.components.rounding);
      if (nonnegative(t.taxableGross) + nonnegative(t.exemptGross) !== gross || nonnegative(t.vat) > cents(t.taxableGross)
          || nonnegative(t.exVat) + cents(t.vat) !== gross) return null;
      if (cents(s.source.taxable) + cents(s.source.exempt) !== cents(s.source.payable) - cents(s.source.rounding)
          || cents(t.taxableGross) > cents(s.source.taxable) || cents(t.exemptGross) > cents(s.source.exempt)
          || cents(t.vat) > cents(s.source.vat) || cents(s.source.vat) > cents(s.source.taxable)) return null;
    }
    return s;
  } catch { return null; }
}

/** All money/line amounts are the return engine's already-final amounts, in decimal strings. */
export function buildReturnFinancialSnapshot(input: {
  amount: Money; previousRefund: Money; source: ReturnFinancialSource;
  lines: ReturnFinancialLine[]; exactPricing: boolean; allReturned: boolean;
  previous: { amount: Money; snapshot: unknown }[];
}): ReturnFinancialSnapshot {
  const policy = input.exactPricing ? "RETAIN_AUXILIARIES_UNTIL_FULL_V1" : "LEGACY_PROPORTIONAL_V1";
  const s: ReturnFinancialSnapshot = { version: 1, policy, vatBasis: "SALE_BUCKET_CUMULATIVE_ALLOCATION_V1",
    amount: input.amount, source: { ...input.source }, lines: input.lines.map(l => ({ ...l })), components: null, tax: null, issues: [] };
  // A malformed new calculation is a programming error: fail the entire caller transaction.
  if (!readReturnFinancialSnapshot(s, input.amount)) throw new Error("RETURN_SNAPSHOT_INVALID_INPUT");
  const amount = nonnegative(input.amount), previousRefund = nonnegative(input.previousRefund);
  const source = Object.fromEntries(sourceKeys.map(k => [k, cents(input.source[k])])) as Record<typeof sourceKeys[number], bigint>;
  const unknown = (code: string) => { s.issues.push(code); return s; };
  if (input.previous.length > 1000) return unknown("RETURN_HISTORY_LIMIT");
  if (sum(input.previous.map(p => nonnegative(p.amount))) !== previousRefund) return unknown("RETURN_HISTORY_AMOUNT_MISMATCH");
  const previous = input.previous.map(p => readReturnFinancialSnapshot(p.snapshot, p.amount));
  if (previous.some(p => !p?.components)) return unknown("RETURN_PRIOR_COMPONENTS_UNKNOWN");
  const history = previous as ReturnFinancialSnapshot[];
  if (history.some(p => p.policy !== policy || sourceKeys.some(k => cents(p.source[k]) !== source[k]))) return unknown("RETURN_SOURCE_CHANGED");
  if (amount + previousRefund > source.payable || (input.allReturned && amount + previousRefund !== source.payable)) return unknown("RETURN_PAYABLE_MISMATCH");
  const auxiliary = (key: "shipping" | "extras" | "rounding", field: keyof Components) => {
    const before = sum(history.map(p => cents(p.components![field])));
    const cumulative = input.exactPricing
      ? input.allReturned ? source[key] : 0n
      : proportional(source[key], previousRefund + amount, source.payable);
    return cumulative - before;
  };
  const shipping = auxiliary("shipping", "shippingGross"), extras = auxiliary("extras", "extrasGross"), rounding = auxiliary("rounding", "rounding");
  const merchandise = amount - shipping - extras - rounding;
  if (shipping < 0n || extras < 0n || merchandise < 0n) return unknown("RETURN_COMPONENTS_UNRECONCILED");
  s.components = { merchandiseGross: money(merchandise), extrasGross: money(extras), shippingGross: money(shipping), rounding: money(rounding) };
  if (source.taxable + source.exempt !== source.payable - source.rounding || source.vat > source.taxable
      || source.extraTaxable > source.extras) return unknown("RETURN_SALE_VAT_UNRECONCILED");
  if (history.some(p => !p.tax)) return unknown("RETURN_PRIOR_VAT_UNKNOWN");
  const beforeTaxable = sum(history.map(p => cents(p.tax!.taxableGross)));
  const beforeExempt = sum(history.map(p => cents(p.tax!.exemptGross)));
  const beforeVat = sum(history.map(p => cents(p.tax!.vat)));
  const gross = amount - rounding;
  let taxable: bigint;
  if (input.allReturned) taxable = source.taxable - beforeTaxable;
  else if (source.taxable === 0n) taxable = 0n;
  else if (source.exempt === 0n) taxable = gross;
  else {
    if (input.lines.some(l => l.vatCategory === "UNKNOWN" && cents(l.amount) > 0n)) return unknown("RETURN_LINE_VAT_UNKNOWN");
    const taxableWeight = sum(input.lines.filter(l => l.vatCategory === "V").map(l => cents(l.amount)));
    // Frozen line classifications, not today's catalog. Extras are not discounted products.
    taxable = proportional(merchandise, taxableWeight, amount) + shipping
      + proportional(extras, source.extraTaxable, source.extras);
  }
  const exempt = gross - taxable;
  if (taxable < 0n || exempt < 0n || beforeTaxable + taxable > source.taxable || beforeExempt + exempt > source.exempt) return unknown("RETURN_VAT_BUCKET_EXCEEDED");
  const vat = proportional(source.vat, beforeTaxable + taxable, source.taxable) - beforeVat;
  if (vat < 0n || vat > taxable) return unknown("RETURN_VAT_UNRECONCILED");
  s.tax = { taxableGross: money(taxable), exemptGross: money(exempt), vat: money(vat), exVat: money(gross - vat) };
  if (!readReturnFinancialSnapshot(s, input.amount)) throw new Error("RETURN_SNAPSHOT_INVALID_RESULT");
  return s;
}
