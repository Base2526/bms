import assert from "node:assert/strict";
import test from "node:test";

import {
  decoratePosSale,
  isDistinctPosApprover,
  isPosUuid,
  normalizePosSearchQuery,
  parsePosExtraLines,
  parsePosPayments,
  parsePosSaleLines,
} from "../apps/web/lib/bms/posRouteHelpers.ts";
import { cashRoundingDelta, isCashRounding } from "../apps/web/lib/pos/cashRounding.ts";
import { calculatePettyCashSettlement } from "../apps/web/lib/pos/pettyCash.ts";
import { buildReceipt } from "../apps/web/lib/pos/escpos.ts";
import { orderRefundPaymentsForAllocation } from "../apps/web/lib/pos/refundAllocation.ts";
import { appendSplitPaymentRow } from "../apps/web/lib/pos/paymentDraft.ts";
import {
  isReceiptLanguageMode,
  receiptDocumentTitle,
  receiptLabel,
  receiptLocale,
} from "../apps/web/lib/pos/receiptI18n.ts";

test("receipt language modes stay explicit and deterministic", () => {
  assert.equal(isReceiptLanguageMode("th"), true);
  assert.equal(isReceiptLanguageMode("en"), true);
  assert.equal(isReceiptLanguageMode("bilingual"), true);
  assert.equal(isReceiptLanguageMode("th-en"), false);
  assert.equal(receiptLabel("th", "รวม", "Total"), "รวม");
  assert.equal(receiptLabel("en", "รวม", "Total"), "Total");
  assert.equal(receiptLabel("bilingual", "รวม", "Total"), "รวม / Total");
  assert.equal(receiptLocale("th"), "th-TH");
  assert.equal(receiptLocale("en"), "en-US");
  assert.equal(receiptDocumentTitle("en", "sale", true), "Receipt/Abbreviated Tax Invoice");
  assert.equal(receiptDocumentTitle("bilingual", "return"), "ใบรับคืนสินค้า / Goods Return Receipt");
});

test("POS sale line parser keeps only valid positive integer pack quantities", () => {
  const lines = parsePosSaleLines([
    { sku: "SKU-1 ", size: "M", packQty: 2, packCode: "BOX" },
    { sku: " ", size: "M", packQty: 1 },
    { sku: "SKU-2", size: "", packQty: 1 },
    { sku: "SKU-3", size: "L", packQty: 1.5 },
  ]);
  assert.deepEqual(lines, [
    {
      sku: "SKU-1",
      size: "M",
      packQty: 2,
      packCode: "BOX",
      unitName: null,
      baseQty: null,
      packPrice: null,
      serials: null,
      modifierCodes: null,
      scaleBarcode: null,
    },
  ]);
});

/**
 * `parsePosSaleLines` is an allowlist, so a field the register sends but the parser does not name
 * disappears between the screen and `recordPosSale` — with no error anywhere. That is exactly what
 * happened to `9.40`/`9.41`: a menu sold with "extra egg" deducted the plain recipe (silently, with
 * a kitchen ticket that never mentioned the option), and a weighed line was priced as one base unit
 * instead of the grams on the label, so the bill died on PAYMENT_MISMATCH at the counter. The DB
 * contracts passed the whole time because they call createOrder directly and never cross the route.
 */
test("POS sale parser carries menu modifiers and the raw scale label to the server", () => {
  const [line] = parsePosSaleLines([
    {
      sku: "SKU-1", size: "M", packQty: 1,
      modifierCodes: [" extra_egg ", "NO_SUGAR", "extra_egg", ""],
      scaleBarcode: " 2212345007506 ",
    },
  ]);
  // Normalised the same way the stock resolver normalises them, so the codes the customer chose
  // and the codes checked against bms_product_modifiers cannot differ by case or duplication.
  assert.deepEqual(line.modifierCodes, ["EXTRA_EGG", "NO_SUGAR"]);
  assert.equal(line.scaleBarcode, "2212345007506");
});

test("POS sale parser bounds modifier codes and keeps absent ones null", () => {
  const [flooded] = parsePosSaleLines([
    { sku: "SKU-1", size: "M", packQty: 1, modifierCodes: Array.from({ length: 50 }, (_, i) => `M${i}`) },
  ]);
  assert.equal(flooded.modifierCodes?.length, 20);
  const [plain] = parsePosSaleLines([{ sku: "SKU-1", size: "M", packQty: 1, scaleBarcode: "   " }]);
  assert.equal(plain.modifierCodes, null);
  assert.equal(plain.scaleBarcode, null, "a blank label must not become an empty scale line");
});

test("POS payment parser accepts valid methods and rejects bad inputs", () => {
  const ok = parsePosPayments([{ method: "wallet", amount: 199, ref: "APP-123" }]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.payments[0], {
      method: "WALLET",
      amount: 199,
      cashTendered: null,
      ref: "APP-123",
    });
  }
  assert.deepEqual(parsePosPayments([{ method: "CRYPTO", amount: 10 }]), {
    ok: false,
    error: "วิธีชำระเงินไม่ถูกต้อง: CRYPTO",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 0 }]), {
    ok: false,
    error: "จำนวนเงินต้องมากกว่า 0",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 100, cashTendered: 99 }]), {
    ok: false,
    error: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดที่ชำระด้วยเงินสด",
  });
  assert.deepEqual(parsePosPayments([{ method: "CASH", amount: 100, cashTendered: "not-a-number" }]), {
    ok: false,
    error: "เงินสดที่รับมาต้องไม่น้อยกว่ายอดที่ชำระด้วยเงินสด",
  });
  assert.equal(parsePosPayments([
    { method: "CASH", amount: 100, cashTendered: 120 },
    { method: "CARD", amount: 50, ref: "EDC-001" },
  ]).ok, true);
});

test("entering split payment clears a stale cash tender from the single-payment form", () => {
  const next = appendSplitPaymentRow([
    { id: "pay-1", method: "CASH", amount: "48300", tendered: "48300", ref: "" },
  ], 48300, "pay-2");

  assert.deepEqual(next, [
    { id: "pay-1", method: "CASH", amount: "48300", tendered: "", ref: "" },
    { id: "pay-2", method: "QR", amount: "", tendered: "", ref: "" },
  ]);

  // Reproduces the reported bill after the cashier assigns 15,000 to cash: an empty
  // tender is sent as null and the server treats it as exact cash, not 33,300 change.
  next[0].amount = "15000";
  assert.equal(next[0].tendered, "");
});

test("adding another split-payment row preserves tenders already entered per cash row", () => {
  const current = [
    { id: "pay-1", method: "CASH", amount: "15000", tendered: "20000", ref: "" },
    { id: "pay-2", method: "QR", amount: "5000", tendered: "", ref: "QR-001" },
  ];

  assert.deepEqual(appendSplitPaymentRow(current, 48300, "pay-3"), [
    ...current,
    { id: "pay-3", method: "QR", amount: "", tendered: "", ref: "" },
  ]);
});

test("split-payment refunds honor the chosen channel instead of UUID order", () => {
  const payments = [
    { id: "0000", method: "QR" as const },
    { id: "ffff", method: "CARD" as const },
    { id: "1111", method: "CASH" as const },
  ];
  assert.deepEqual(
    orderRefundPaymentsForAllocation(payments, "CARD").map((payment) => payment.method),
    ["CARD", "QR", "CASH"],
    "ช่องทางที่พนักงานเลือกต้องมาก่อนแม้ UUID จะเรียงไว้ท้ายสุด"
  );
  assert.deepEqual(
    orderRefundPaymentsForAllocation(payments).map((payment) => payment.method),
    ["CARD", "QR", "CASH"],
    "client รุ่นเก่า/void ต้องใช้ fallback คงที่ ไม่กลับไปใช้ UUID เป็นลำดับช่องทาง"
  );
});

test("POS sale parser treats browser price fields as optional transport data", () => {
  const [line] = parsePosSaleLines([
    { sku: "SKU-1", size: "M", packQty: 1, packCode: "BOX", baseQty: 999, packPrice: 0.01 },
  ]);
  assert.equal(line.sku, "SKU-1");
  assert.equal(line.packCode, "BOX");
  // The route may carry these previews, but recordPosSale re-resolves pack/base quantity/price
  // from the tenant catalog before creating the order.
  assert.equal(line.baseQty, 999);
  assert.equal(line.packPrice, 0.01);
});

test("POS extra lines drop non-finite quantities before they reach Postgres", () => {
  assert.deepEqual(parsePosExtraLines([
    { label: "ค่าถุง", qty: "not-a-number", unitAmount: 5 },
    { label: "จำนวนเศษ", qty: 1.5, unitAmount: 10 },
    { label: "ค่าห่อ", qty: 2, unitAmount: 10 },
  ]), [
    { label: "ค่าห่อ", qty: 2, unitAmount: 10 },
  ]);
});

test("POS search query normalization trims whitespace and null safely", () => {
  assert.equal(normalizePosSearchQuery("  milk tea  "), "milk tea");
  assert.equal(normalizePosSearchQuery(null), "");
});

test("POS order references reject barcodes before reaching UUID database columns", () => {
  assert.equal(isPosUuid("2000000000015"), false);
  assert.equal(isPosUuid("c4f9052a-9484-46e9-a47d-e7b57c08e867"), true);
  assert.equal(isPosUuid(" C4F9052A-9484-46E9-A47D-E7B57C08E867 "), true);
});

test("POS approval requires a different acting user", () => {
  assert.equal(isDistinctPosApprover("cashier-1", "manager-1"), true);
  assert.equal(isDistinctPosApprover("cashier-1", "cashier-1"), false);
  assert.equal(isDistinctPosApprover(" CASHIER-1 ", "cashier-1"), false);
  assert.equal(isDistinctPosApprover("cashier-1", " "), false);
});

// จอขายกับ server ต้องได้ตัวเลขเดียวกันเป๊ะ ไม่งั้นบิลโดน PAYMENT_MISMATCH ทิ้งทั้งใบ
// (ทั้งสองฝั่ง import ฟังก์ชันตัวเดียวกันนี้ — เทสต์ล็อกพฤติกรรมของมันไว้)
test("cash rounding matches the amount the counter must actually collect", () => {
  assert.equal(cashRoundingDelta(101.13, "NONE"), 0);
  // ปัดขึ้น/ลงเข้าหาค่าที่ใกล้ที่สุด
  assert.equal(cashRoundingDelta(101.13, "0.25"), 0.12);
  assert.equal(cashRoundingDelta(101.13, "0.50"), -0.13);
  assert.equal(cashRoundingDelta(101.13, "1.00"), -0.13);
  // เศษครึ่งพอดีปัดขึ้น (เข้าทางร้าน)
  assert.equal(cashRoundingDelta(10.5, "1.00"), 0.5);
  assert.equal(cashRoundingDelta(10.125, "0.25"), 0.13);
  // ยอดที่ลงตัวอยู่แล้วต้องไม่ขยับ
  assert.equal(cashRoundingDelta(20, "0.25"), 0);
  assert.equal(cashRoundingDelta(20.5, "0.50"), 0);
});

test("cash rounding rejects modes that are not in the settings enum", () => {
  assert.equal(isCashRounding("0.25"), true);
  assert.equal(isCashRounding("0.10"), false);
  assert.equal(isCashRounding(null), false);
});

test("petty-cash advances return change or request only the real extra cash", () => {
  assert.deepEqual(calculatePettyCashSettlement(500, 430), {
    advancedAmount: 500,
    actualAmount: 430,
    returnedAmount: 70,
    extraCashOut: 0,
    drawerDelta: -70,
  });
  assert.deepEqual(calculatePettyCashSettlement(500, 540.125), {
    advancedAmount: 500,
    actualAmount: 540.13,
    returnedAmount: 0,
    extraCashOut: 40.13,
    drawerDelta: 40.13,
  });
  assert.deepEqual(calculatePettyCashSettlement(500, 500), {
    advancedAmount: 500,
    actualAmount: 500,
    returnedAmount: 0,
    extraCashOut: 0,
    drawerDelta: 0,
  });
  assert.throws(() => calculatePettyCashSettlement(0, 0), RangeError);
  assert.throws(() => calculatePettyCashSettlement(100, -1), RangeError);
});

test("POS last-sale decorator adds storefront metadata without changing sale fields", () => {
  const decorated = decoratePosSale(
    { orderId: "ord-1", docNo: "Z6908310001", total: 250, paymentMethod: "CARD" },
    { storeName: "Main Branch", branchCode: "00001", posLabel: "POS01", vatRegistered: true }
  );
  assert.deepEqual(decorated, {
    orderId: "ord-1",
    docNo: "Z6908310001",
    receiptNo: "Z6908310001",
    billNo: "Z6908310001",
    total: 250,
    paymentMethod: "CARD",
    storeName: "Main Branch",
    branchCode: "00001",
    posLabel: "POS01",
    vatRegistered: true,
  });
});

test("sale receipt prints human bill number separately from technical POS references", () => {
  const orderId = "8ed2e0e7-6b54-43b5-83b1-7e42ab6c1e67";
  const bytes = buildReceipt({
    storeName: "Test Store",
    locationId: "loc-123456789",
    branchCode: "00001",
    taxId: null,
    posDeviceId: "dev-abcdefghi",
    posNo: "POS01",
    shiftId: "shift-987654321",
    vatIncluded: false,
    docTitle: "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ",
    docNo: "Z6908310001",
    orderId,
    at: "31/8/2569 12:00:00",
    cashier: "Cashier",
    lines: [{ name: "Item", qty: 1, amount: 90 }],
    itemCount: 1,
    total: 90,
    paymentLabel: "เงินสด",
  });
  const binary = Buffer.from(bytes);
  assert.equal(binary.includes(Buffer.from("Z6908310001", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Order 8ed2e0e7", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Location loc-1234", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Device dev-abcd", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Shift shift-98", "ascii")), true);
  const barcodePrefix = Buffer.from([0x1d, 0x6b, 69, "Z6908310001".length]);
  const barcodeOffset = binary.indexOf(barcodePrefix);
  assert.notEqual(barcodeOffset, -1);
  assert.equal(
    binary.subarray(barcodeOffset + barcodePrefix.length, barcodeOffset + barcodePrefix.length + "Z6908310001".length)
      .equals(Buffer.from("Z6908310001", "ascii")),
    true
  );
});

test("English ESC/POS receipt uses customer-facing English labels", () => {
  const bytes = buildReceipt({
    languageMode: "en",
    storeName: "Test Store",
    branchCode: "00001",
    taxId: null,
    posNo: "POS01",
    vatIncluded: false,
    docTitle: receiptDocumentTitle("en", "sale"),
    docNo: "SALE-001",
    at: "8/31/2026, 12:00:00 PM",
    cashier: "Cashier",
    lines: [{ name: "Item", qty: 1, amount: 90 }],
    itemCount: 1,
    total: 90,
    tendered: 100,
    change: 10,
    vat: { rate: 7, vatAmount: 5.89, netBeforeVat: 84.11 },
  });
  const binary = Buffer.from(bytes);
  assert.equal(binary.includes(Buffer.from("Receipt", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Net before VAT", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Tendered/Change", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("Cashier Cashier", "ascii")), true);
});

test("return slip prints its credit-note reference but barcodes the searchable original sale", () => {
  const bytes = buildReceipt({
    storeName: "Test Store",
    branchCode: "00001",
    taxId: null,
    posNo: "POS01",
    vatIncluded: false,
    docTitle: "ใบรับคืนสินค้า",
    docNo: null,
    relatedDocNo: "CN-260826-001",
    referenceDocNo: "SALE-260826-001",
    barcodeValue: "SALE-260826-001",
    at: "26/8/2569 12:00:00",
    cashier: "Cashier",
    lines: [{ name: "Item", qty: 1, amount: 90 }],
    itemCount: 1,
    total: 90,
    paymentLabel: "คืนเงินสด",
  });
  const binary = Buffer.from(bytes);
  assert.equal(binary.includes(Buffer.from("CN-260826-001", "ascii")), true);
  assert.equal(binary.includes(Buffer.from("SALE-260826-001", "ascii")), true);
  // GS k 69 <len> must encode the original sale, never the CN number.
  const barcodePrefix = Buffer.from([0x1d, 0x6b, 69, "SALE-260826-001".length]);
  const barcodeOffset = binary.indexOf(barcodePrefix);
  assert.notEqual(barcodeOffset, -1);
  assert.equal(
    binary.subarray(barcodeOffset + barcodePrefix.length, barcodeOffset + barcodePrefix.length + "SALE-260826-001".length)
      .equals(Buffer.from("SALE-260826-001", "ascii")),
    true
  );
});
