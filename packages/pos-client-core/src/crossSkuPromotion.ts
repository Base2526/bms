export type CrossSkuPromotion = {
  kind: "BUY_A_GET_B";
  id: string;
  buySku: string;
  buySize: string;
  buyQty: number;
  giftSku: string;
  giftSize: string;
  getQty: number;
};

export type GiftPricingLine = {
  sku: string;
  size: string;
  qty: number;
  unitPrice: number;
  eligible: boolean;
};

export function normalizeCrossSkuPromotion(raw: unknown): CrossSkuPromotion | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== "BUY_A_GET_B"
    || [p.id, p.buySku, p.buySize, p.giftSku, p.giftSize].some((s) => typeof s !== "string" || !s.trim())
    || p.buySku === p.giftSku || !Number.isSafeInteger(p.buyQty) || Number(p.buyQty) < 1
    || !Number.isSafeInteger(p.getQty) || Number(p.getQty) < 1) return null;
  return { kind: "BUY_A_GET_B", id: String(p.id), buySku: String(p.buySku), buySize: String(p.buySize),
    buyQty: Number(p.buyQty), giftSku: String(p.giftSku), giftSize: String(p.giftSize), getQty: Number(p.getQty) };
}

/** Only quantities actually present in the basket can be free. Gifts never earn gifts. */
export function crossSkuGiftPricing(lines: readonly GiftPricingLine[], promotions: readonly CrossSkuPromotion[]) {
  const discounts = lines.map(() => 0);
  const awarded = new Map<string, number>();
  const rules = [...new Map(promotions.map((p) => [p.id, p])).values()];
  const giftSkus = new Set(rules.map((p) => p.giftSku));
  const consumed = lines.map(() => 0);
  for (const rule of rules) {
    if (giftSkus.has(rule.buySku)) continue;
    const bought = lines.reduce((sum, l) => sum + (l.eligible && l.sku === rule.buySku && l.size === rule.buySize ? l.qty : 0), 0);
    let remaining = Math.floor(bought / rule.buyQty) * rule.getQty;
    let count = 0;
    lines.forEach((line, index) => {
      if (!line.eligible || line.sku !== rule.giftSku || line.size !== rule.giftSize || remaining <= 0) return;
      const qty = Math.min(Math.max(0, line.qty - consumed[index]), remaining);
      discounts[index] += Math.round(line.unitPrice * qty * 100) / 100;
      consumed[index] += qty;
      remaining -= qty;
      count += qty;
    });
    awarded.set(rule.id, count);
  }
  return { discounts, awarded, freeQuantities: consumed, totalDiscount: Math.round(discounts.reduce((a, b) => a + b, 0) * 100) / 100 };
}

export type GiftSaleEvidence = { rule: CrossSkuPromotion; awardedQty: number };

/** Returning qualifying purchases requires returning any gifts that lose entitlement. */
export function missingGiftReturns(
  original: readonly GiftPricingLine[], remaining: readonly GiftPricingLine[], evidence: readonly GiftSaleEvidence[],
): Array<{ sku: string; size: string; qty: number }> {
  const sum = (lines: readonly GiftPricingLine[], sku: string, size: string) => lines.reduce(
    (n, l) => n + (l.eligible && l.sku === sku && l.size === size ? l.qty : 0), 0);
  return [...new Map(evidence.map((e) => [e.rule.id, e])).values()].flatMap(({ rule, awardedQty }) => {
    const allowed = Math.floor(sum(remaining, rule.buySku, rule.buySize) / rule.buyQty) * rule.getQty;
    const returnedGifts = sum(original, rule.giftSku, rule.giftSize) - sum(remaining, rule.giftSku, rule.giftSize);
    const qty = Math.max(0, awardedQty - returnedGifts - allowed);
    return qty > 0 ? [{ sku: rule.giftSku, size: rule.giftSize, qty }] : [];
  });
}
