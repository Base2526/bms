import assert from "node:assert/strict";
import test from "node:test";
import { receiptPromotionNotes } from "../apps/web/lib/bms/receiptPromotionNotes.ts";

const line = {
  product_sku: "FAKE-DRINK", product_name: "Test drink", size: "STD", qty: 3,
  pack_unit_price: null, receipt_unit_price: "30",
  pricing_snapshot: { source: "SALE", promotion: { kind: "BUY_X_GET_Y", buyQty: 2, getQty: 1 } },
};
test("saved buy/get promotions report included gifts once across split lines", () => {
  const notes = receiptPromotionNotes([{ ...line, qty: 1 }, { ...line, qty: 2 }]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /ซื้อ 2 แถม 1 ได้แถม 1 ชิ้น/);
  assert.match(notes[0], /รวมในจำนวนสินค้าแล้ว/);
  assert.deepEqual(receiptPromotionNotes([{ ...line, qty: 2 }]), []);
});
test("legacy snapshots, packs and different sizes cannot invent free items", () => {
  assert.deepEqual(receiptPromotionNotes([{ ...line, pricing_snapshot: { ...line.pricing_snapshot, source: "BACKFILL" } }]), []);
  assert.deepEqual(receiptPromotionNotes([{ ...line, pack_unit_price: "50" }]), []);
  assert.deepEqual(receiptPromotionNotes([{ ...line, qty: 1 }, { ...line, qty: 2, size: "L" }]), []);
});
test("bundle promotion uses saved list price excluding modifiers, not current tiers", () => {
  const bundle = { ...line, receipt_unit_price: "50", pricing_snapshot: { source: "SALE",
    modifierUnitPrice: 10, priceTiers: [{ minQty: 3, unitPrice: 20 }],
    promotion: { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 100 } } };
  assert.match(receiptPromotionNotes([bundle])[0], /3 ชิ้น 100.00 บาท จำนวน 1 ชุด/);
  assert.deepEqual(receiptPromotionNotes([{ ...bundle, receipt_unit_price: "30" }]), []);
});
