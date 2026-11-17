import assert from "node:assert/strict";
import test from "node:test";
import { parsePosOpenItems } from "../apps/web/lib/bms/posOpenItems.ts";
import { buildReturnFinancialSnapshot, readReturnFinancialSnapshot } from "../apps/web/lib/bms/returnFinancialSnapshot.ts";

test("open item accepts exact satang and a distinct VAT choice", () => {
  assert.deepEqual(parsePosOpenItems([{ label: "  ผ้าพันคอ  ", qty: 2, unitAmount: 19.99, vatCategory: "V" }]), {
    ok: true, items: [{ label: "ผ้าพันคอ", qty: 2, unitAmount: 19.99, vatCategory: "V" }],
  });
  assert.equal(parsePosOpenItems([{ label: "หนังสือ", qty: 1, unitAmount: 10, vatCategory: "N" }]).ok, true);
});

test("open item rejects ambiguous or unsafe money and labels", () => {
  const base = { label: "สินค้า", qty: 1, unitAmount: 1, vatCategory: "V" };
  for (const bad of [
    { ...base, unitAmount: 1.001 }, { ...base, unitAmount: -1 },
    { ...base, unitAmount: Number.NaN }, { ...base, qty: 0 },
    { ...base, qty: 1.5 }, { ...base, vatCategory: "UNKNOWN" },
    { ...base, label: "a\nb" }, { ...base, label: " " },
  ]) assert.equal(parsePosOpenItems([bad]).ok, false, JSON.stringify(bad));
  assert.equal(parsePosOpenItems(Array(11).fill(base)).ok, false);
});

test("return evidence preserves the open item ID namespace and full refund VAT", () => {
  const snapshot = buildReturnFinancialSnapshot({
    amount: "19.99", previousRefund: "0.00", exactPricing: true, allReturned: true,
    source: { payable: "19.99", shipping: "0.00", rounding: "0.00", extras: "0.00",
      taxable: "19.99", exempt: "0.00", vat: "1.31", extraTaxable: "0.00" },
    lines: [{ orderItemId: "-1", amount: "19.99", vatCategory: "V" }], previous: [],
  });
  assert.equal(snapshot.tax?.vat, "1.31");
  assert.equal(readReturnFinancialSnapshot(snapshot, "19.99")?.lines[0]?.orderItemId, "-1");
});
