import { applyPromotion, isSaleTimePricingSnapshot, normalizePricingSnapshot } from "./pricing";

type SavedLine = {
  product_sku: string;
  product_name: string | null;
  size: string;
  qty: number;
  pack_unit_price: string | null;
  receipt_unit_price: string;
  pricing_snapshot: unknown;
};

/** Describe saved rules only; never consult today's catalog or add a second gift line. */
export function receiptPromotionNotes(lines: SavedLine[]): string[] {
  const eligible = lines.filter((line) => line.pack_unit_price == null && isSaleTimePricingSnapshot(line.pricing_snapshot));
  const groups = new Map<string, SavedLine[]>();
  for (const line of eligible) {
    const key = JSON.stringify([line.product_sku, line.size]);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const notes = [...groups.values()].flatMap((group) => {
    const line = group[0];
    const snapshot = normalizePricingSnapshot(line.pricing_snapshot);
    const promo = snapshot.promotion;
    if (!promo || promo.kind === "BUY_A_GET_B") return [];
    const qty = group.reduce((sum, item) => sum + Number(item.qty), 0);
    // createOrderInTx applies the promotion to the list price, before modifiers.
    const base = Number(line.receipt_unit_price) - snapshot.modifierUnitPrice;
    const outcome = applyPromotion(base, qty, promo);
    if (outcome.saved <= 0) return [];
    const name = `${line.product_name ?? line.product_sku}${line.size && line.size !== "-" ? ` (${line.size})` : ""}`;
    return [promo.kind === "BUY_X_GET_Y"
      ? `${name}: ซื้อ ${promo.buyQty} แถม ${promo.getQty} ได้แถม ${outcome.freeQty} ชิ้น (รวมในจำนวนสินค้าแล้ว)`
      : `${name}: โปร ${promo.buyQty} ชิ้น ${promo.bundlePrice.toFixed(2)} บาท จำนวน ${Math.floor(qty / promo.buyQty)} ชุด`];
  });
  const gifts = new Map(eligible.flatMap((l) => normalizePricingSnapshot(l.pricing_snapshot).crossSkuGifts ?? [])
    .map((e) => [e.rule.id, e]));
  for (const { rule, awardedQty } of gifts.values()) {
    if (awardedQty <= 0) continue;
    notes.push(`ซื้อ ${rule.buySku} (${rule.buySize}) ${rule.buyQty} แถม ${rule.giftSku} (${rule.giftSize}) ${rule.getQty} · ได้แถม ${awardedQty} ชิ้น (รวมในจำนวนสินค้าแล้ว)`);
  }
  return notes;
}
