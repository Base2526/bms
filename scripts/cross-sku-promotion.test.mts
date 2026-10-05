import assert from "node:assert/strict";
import test from "node:test";
import { crossSkuGiftPricing, missingGiftReturns, normalizeCrossSkuPromotion, type CrossSkuPromotion } from "../packages/pos-client-core/src/crossSkuPromotion.ts";
import { cartProductSubtotal } from "../packages/pos-client-core/src/cartPricing.ts";
import { priceRemainingLines } from "../apps/web/lib/bms/pricing.ts";
import { receiptPromotionNotes } from "../apps/web/lib/bms/receiptPromotionNotes.ts";

const rule: CrossSkuPromotion = { kind: "BUY_A_GET_B", id: "gift-1", buySku: "A", buySize: "M", buyQty: 2, giftSku: "B", giftSize: "S", getQty: 1 };
const basket = (a: number, b: number) => [
  { sku: "A", size: "M", qty: a, unitPrice: 100, eligible: true },
  { sku: "B", size: "S", qty: b, unitPrice: 30, eligible: true },
];

test("gift engine and shared POS preview agree across thresholds and paid extra gifts", () => {
  for (let a = 0; a <= 8; a++) for (let b = 0; b <= 6; b++) {
    const lines = basket(a, b);
    const free = Math.min(Math.floor(a / 2), b);
    assert.equal(crossSkuGiftPricing(lines, [rule, rule]).totalDiscount, free * 30);
    const preview = cartProductSubtotal(lines.map((l) => ({ ...l, baseQty: 1, packCode: "BASE", promotion: rule,
      priceTiers: [{ minQty: 2, unitPrice: 1 }] })));
    assert.equal(preview, a * 100 + (b - free) * 30);
  }
});

test("split lines, wrong variants, absent gifts and ineligible lines", () => {
  const [a, b] = basket(2, 1);
  assert.equal(crossSkuGiftPricing([a], [rule]).totalDiscount, 0);
  assert.equal(crossSkuGiftPricing([a, { ...b, size: "L" }], [rule]).totalDiscount, 0);
  assert.equal(crossSkuGiftPricing([{ ...a, eligible: false }, b], [rule]).totalDiscount, 0);
  assert.equal(crossSkuGiftPricing([a, { ...b, eligible: false }], [rule]).totalDiscount, 0);
  assert.equal(crossSkuGiftPricing([{ ...a, qty: 1 }, { ...a, qty: 3 }, b, b], [rule]).totalDiscount, 60);
  const chained = { ...rule, id: "chain", buySku: "B", buySize: "S", giftSku: "C" };
  assert.equal(crossSkuGiftPricing([a, b, { ...b, sku: "C" }], [rule, chained]).awarded.get("chain"), undefined);
});

test("invalid rules cannot silently turn another SKU into a free item", () => {
  for (const change of [{ buyQty: 0 }, { getQty: 1.5 }, { giftSku: "A" }, { giftSize: "" }, { id: null }, { id: {} }]) {
    assert.equal(normalizeCrossSkuPromotion({ ...rule, ...change }), null);
  }
});

test("other variants keep wholesale prices and zero-priced gifts retain integer quantities", () => {
  const lines = basket(2, 1);
  assert.equal(cartProductSubtotal([...lines, { ...lines[1], size: "L", qty: 2 }].map((l) => ({
    ...l, baseQty: 1, packCode: "BASE", promotion: rule, priceTiers: [{ minQty: 2, unitPrice: 20 }],
  }))), 240);
  assert.deepEqual(crossSkuGiftPricing([lines[0], { ...lines[1], unitPrice: 0 }], [rule]).freeQuantities, [0, 1]);
});

test("frozen return rule requires lost gifts and reprices retained basket", () => {
  const evidence = [{ rule, awardedQty: 2 }];
  assert.deepEqual(missingGiftReturns(basket(4, 2), basket(3, 2), evidence), [{ sku: "B", size: "S", qty: 1 }]);
  assert.deepEqual(missingGiftReturns(basket(4, 2), basket(3, 1), evidence), []);
  assert.deepEqual(missingGiftReturns(basket(4, 2), basket(4, 1), evidence), []);
  const lines = basket(4, 2).map((l, i) => ({ ...l, id: i + 1, packQty: l.qty, returnedPackQty: 0,
    receiptUnitPrice: l.unitPrice, packUnitPrice: null,
    pricingSnapshot: { source: "SALE", priceTiers: [], promotion: null, crossSkuGifts: evidence } }));
  assert.equal(priceRemainingLines(lines, new Map([[1, 1], [2, 1]])).pricingSubtotal, 300);
  assert.equal(priceRemainingLines(lines, new Map([[2, 1]])).pricingSubtotal, 400);
  assert.equal(priceRemainingLines(lines, new Map([[1, 4], [2, 2]])).pricingSubtotal, 0);
  const notes = receiptPromotionNotes(lines.map((l) => ({ product_sku: l.sku, product_name: l.sku, size: l.size,
    qty: l.qty, pack_unit_price: null, receipt_unit_price: String(l.unitPrice), pricing_snapshot: l.pricingSnapshot })));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /A.*B/);
});
