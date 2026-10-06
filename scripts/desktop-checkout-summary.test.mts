import assert from "node:assert/strict";
import test from "node:test";
import { cartProductPricing, cartProductSubtotal, type PricedCartLine } from "../packages/pos-client-core/src/cartPricing.ts";
import { editCheckoutPayment, syncSingleCheckoutPayment, type CheckoutPayment } from "../apps/web/components/pos-desktop/checkoutPayment.ts";
import { calculateCashChange, validatePayments } from "../packages/pos-client-core/src/payment.ts";

const line = (sku: string, price: number, extra: Partial<PricedCartLine> = {}): PricedCartLine =>
  ({ sku, size: "S", qty: 1, baseQty: 1, packCode: "BASE", basePrice: price, packBasePrice: price, ...extra });
const gift = { kind: "BUY_A_GET_B" as const, id: "FAKE-promo", buySku: "A", buySize: "S", buyQty: 1, giftSku: "G", giftSize: "S", getQty: 1 };
const screenshot = [line("355", 1963, { size: "L" }), line("A", 3596, { promotion: gift }), line("G", 1458), line("A", 4000, { size: "L" })];
const cents = (n: number) => Math.round(n * 100);

test("four-line checkout shows a real free gift and reconciles to 9559", () => {
  const priced = cartProductPricing(screenshot);
  assert.equal(priced.listSubtotal, 11017);
  assert.equal(priced.subtotal, 9559);
  assert.deepEqual(priced.lines.map(l => l.amount), [1963, 3596, 0, 4000]);
  assert.equal(priced.lines[2].freeQty, 1);
  assert.equal(priced.lines[2].discountAmount, 1458);
  assert.equal(calculateCashChange(priced.subtotal, 12354), 2795);
});

test("gift quantity, size, named packs, modifiers and removal use the existing basket rules", () => {
  const partial = cartProductPricing([screenshot[1], line("G", 1458, { qty: 2 })]);
  assert.equal(partial.lines[1].amount, 1458);
  assert.equal(partial.lines[1].freeQty, 1);
  for (const extra of [{ size: "L" }, { packCode: "BOX" }, { modifierUnitPrice: 5 }]) {
    const priced = cartProductPricing([screenshot[1], line("G", 1458, extra)]);
    assert.equal(priced.lines[1].freeQty, 0);
    assert.equal(priced.lines[1].discountAmount, 0);
  }
  assert.equal(cartProductPricing([screenshot[2]]).lines[0].amount, 1458);
});

test("wholesale, same-SKU bundle allocation, fractional quantities and modifiers reconcile", () => {
  const bundle = { kind: "N_FOR_PRICE" as const, buyQty: 3, bundlePrice: 100 };
  const cases = [
    [line("A", 50, { promotion: bundle }), line("A", 50, { modifierUnitPrice: 5 }), line("A", 50)],
    [line("A", 100, { qty: 5, priceTiers: [{ minQty: 5, unitPrice: 90 }] })],
    [line("A", .333, { qty: 1 }), line("B", .333), line("C", .333)],
    [line("A", 2.5, { baseQty: 125, packBasePrice: 312.5, scaleBarcode: "FAKE" })],
    [line("OLD", 50, { basePrice: null })],
    [line("A", 50, { promotion: bundle, qty: 3 }), line("A", 50, { packCode: "BOX", baseQty: 6, packBasePrice: 270 })],
    [line("A", 50, { promotion: bundle, qty: 0 }), line("A", 50, { qty: 0 })],
    [line("A", 50, { promotion: { kind: "BUY_X_GET_Y", buyQty: 2, getQty: 1 }, qty: 3 })],
    [],
  ];
  assert.deepEqual(cartProductPricing(cases[0]).lines.map(l => l.amount), [33.33, 38.33, 33.34]);
  assert.equal(cartProductPricing(cases[1]).subtotal, 450);
  assert.equal(cartProductPricing(cases[4]).subtotal, 50);
  for (const lines of cases) {
    const result = cartProductPricing(lines);
    assert.equal(result.subtotal, cartProductSubtotal(lines));
    assert.equal(result.lines.reduce((sum, l) => sum + cents(l.amount), 0), cents(result.subtotal));
    assert.equal(result.lines.reduce((sum, l) => sum + cents(l.listAmount) - cents(l.discountAmount), 0), cents(result.subtotal));
  }
});

const cash = (): CheckoutPayment => ({ id: "cash", method: "cash", amount: 12354, tendered: 12354 });
test("automatic cash follows a decreasing or increasing total, without stale change", () => {
  let payments = syncSingleCheckoutPayment([cash()], 9559, false);
  assert.equal(payments[0].tendered, 9559);
  assert.equal(calculateCashChange(9559, payments[0].tendered!), 0);
  payments = syncSingleCheckoutPayment(payments, 11017, false);
  assert.equal(payments[0].tendered, 11017);
  assert.strictEqual(syncSingleCheckoutPayment(payments, 11017, false), payments);
});

test("explicit cash is preserved, even when insufficient; exact opts back into auto", () => {
  let payments = [editCheckoutPayment(cash(), { tendered: 12354 })];
  payments = syncSingleCheckoutPayment(payments, 9559, false);
  assert.equal(payments[0].tendered, 12354);
  assert.equal(calculateCashChange(9559, payments[0].tendered!), 2795);
  payments = syncSingleCheckoutPayment(payments, 13000, false);
  assert.equal(payments[0].tendered, 12354);
  assert.equal(validatePayments(13000, payments).canConfirm, false);
  payments = [editCheckoutPayment(payments[0], { tendered: 13000 }, true)];
  assert.equal(syncSingleCheckoutPayment(payments, 9559, false)[0].tendered, 9559);
});

test("split payments and uncertain attempts stay frozen; fresh/noncash payments have no stale tender", () => {
  const split: CheckoutPayment[] = [cash(), { id: "qr", method: "qr", amount: 100, reference: "FAKE" }];
  assert.strictEqual(syncSingleCheckoutPayment(split, 9559, false), split);
  const pending = [cash()];
  assert.strictEqual(syncSingleCheckoutPayment(pending, 9559, true), pending);
  assert.equal(editCheckoutPayment(cash(), { amount: 200 }).tendered, 200);
  assert.equal(syncSingleCheckoutPayment([{ id: "new", method: "cash", amount: 0, tendered: 0 }], 50, false)[0].tendered, 50);
  assert.equal(syncSingleCheckoutPayment([{ ...cash(), method: "qr" }], 9559, false)[0].tendered, undefined);
});
