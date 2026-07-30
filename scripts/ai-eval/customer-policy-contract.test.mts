import assert from "node:assert/strict";
import test from "node:test";

import {
  isAlternativeCatalogRequest,
  suppressUnconfiguredPaymentAdvice,
} from "../../apps/web/lib/bms/customerReplyPolicy.ts";
import {
  configuredPaymentAccounts,
  configuredPaymentMethodLabels,
  hasConfiguredPaymentAccounts,
  supportsCustomerPaymentMethod,
} from "../../apps/web/lib/bms/paymentConfiguration.ts";

test("short Thai requests for other products are catalog discovery", () => {
  assert.equal(isAlternativeCatalogRequest("ดูอย่างอื่นด้วย"), true);
  assert.equal(isAlternativeCatalogRequest("ขอดูสินค้าอื่นเพิ่มเติมค่ะ"), true);
  assert.equal(isAlternativeCatalogRequest("มีรุ่นอื่นไหม"), true);
  assert.equal(isAlternativeCatalogRequest("เอาอันนี้เลยค่ะ"), false);
});

test("blank payment rows are not treated as configured channels", () => {
  const accounts = [
    { type: "BANK", bankName: "Example Bank", accountNo: "  " },
    { type: "PROMPTPAY", promptpayId: "" },
  ];
  assert.deepEqual(configuredPaymentAccounts(accounts), []);
  assert.equal(hasConfiguredPaymentAccounts(accounts), false);
  assert.deepEqual(configuredPaymentMethodLabels(accounts), []);
});

test("customer payment methods must match a configured receiving account", () => {
  const accounts = [
    { type: "BANK", bankName: "Example Bank", accountNo: "123-4-56789-0" },
    { type: "PROMPTPAY", promptpayId: "0812345678" },
  ];
  assert.equal(supportsCustomerPaymentMethod(accounts, "BANK_TRANSFER"), true);
  assert.equal(supportsCustomerPaymentMethod(accounts, "QR"), true);
  assert.equal(supportsCustomerPaymentMethod(accounts, "CARD"), false);
  assert.deepEqual(configuredPaymentMethodLabels(accounts), [
    "โอนเข้าบัญชีธนาคาร",
    "พร้อมเพย์",
  ]);
});

test("unconfigured payment advice is removed without losing an order summary", () => {
  const reply =
    "รับออร์เดอร์แล้วค่ะ\nรวม 8,440 บาท\n\nตอนนี้รอการชำระเงินอยู่นะคะ สนใจชำระผ่านช่องทางไหนดีคะ (โอนธนาคาร / พร้อมเพย์ / อื่น ๆ)";
  assert.equal(
    suppressUnconfiguredPaymentAdvice(reply),
    "รับออร์เดอร์แล้วค่ะ\nรวม 8,440 บาท"
  );
});

test("payment-only advice becomes a safe unconfigured notice", () => {
  assert.equal(
    suppressUnconfiguredPaymentAdvice(
      "สนใจชำระผ่านช่องทางไหนดีคะ โอนธนาคารหรือพร้อมเพย์"
    ),
    "ตอนนี้ทางร้านยังไม่ได้ระบุช่องทางชำระเงินไว้ค่ะ กรุณารอแอดมินแจ้งรายละเอียดก่อนนะคะ"
  );
});

test("a product whose name mentions QR is not mistaken for payment advice", () => {
  assert.equal(
    suppressUnconfiguredPaymentAdvice(
      "เครื่องสแกน QR รุ่น Mini ราคา 990 บาท สนใจให้เช็กสต็อกไหมคะ"
    ),
    "เครื่องสแกน QR รุ่น Mini ราคา 990 บาท สนใจให้เช็กสต็อกไหมคะ"
  );
});
