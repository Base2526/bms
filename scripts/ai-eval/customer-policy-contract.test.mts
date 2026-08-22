import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutDetailsFromReply,
  checkoutNextStepReply,
  isAlternativeCatalogRequest,
  suppressUnconfiguredPaymentAdvice,
} from "../../apps/web/lib/bms/customerReplyPolicy.ts";
import {
  customerPaymentAccountLines,
  configuredPaymentAccounts,
  configuredPaymentMethodLabels,
  hasConfiguredPaymentAccounts,
  supportsCustomerPaymentMethod,
} from "../../apps/web/lib/bms/paymentConfiguration.ts";
import {
  normalizeCustomerIdentity,
  reorderTargetIdentity,
} from "../../apps/web/lib/bms/customerIdentity.ts";

test("general and pharmacy flows normalize the same channel customer identity", () => {
  assert.deepEqual(normalizeCustomerIdentity(" LINE ", "  U123  "), {
    channel: "line",
    customerRef: "U123",
  });
  assert.equal(normalizeCustomerIdentity("line", "  "), null);
});

test("a cross-channel reorder is stored on the customer's current identity", () => {
  assert.deepEqual(
    reorderTargetIdentity(
      { channel: "facebook", customerRef: "FB-OLD" },
      { channel: "line", customerRef: "LINE-CURRENT" }
    ),
    { channel: "line", customerRef: "LINE-CURRENT" }
  );
  assert.deepEqual(
    reorderTargetIdentity({ channel: "facebook", customerRef: "FB-OLD" }),
    { channel: "facebook", customerRef: "FB-OLD" }
  );
  assert.deepEqual(
    reorderTargetIdentity({ channel: "web", customerRef: null }),
    { channel: "web", customerRef: null }
  );
});

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
  assert.equal(
    suppressUnconfiguredPaymentAdvice("Would you like to pay by bank transfer or PromptPay?", true),
    "The shop has not configured a payment method yet. Please wait for an admin to confirm the details."
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

test("checkout reuses complete delivery details and does not ask the customer to fill them again", () => {
  const reply = checkoutNextStepReply(
    {
      marketplaceManaged: false,
      hasRecipientName: true,
      hasPhone: true,
      hasShippingAddress: true,
      shippingAddressCount: 1,
      defaultAddressLabel: "บ้าน",
      missingFields: [],
    },
    []
  );
  assert.match(reply, /ใช้ข้อมูลเดิมให้อัตโนมัติ/);
  assert.doesNotMatch(reply, /กรอก|แจ้งชื่อผู้รับ|แจ้งเบอร์|แจ้งที่อยู่/);
  assert.doesNotMatch(reply, /ชำระ|พร้อมเพย์|ธนาคาร/);
});

test("checkout asks only for the first missing delivery field", () => {
  const reply = checkoutNextStepReply(
    {
      marketplaceManaged: false,
      hasRecipientName: true,
      hasPhone: false,
      hasShippingAddress: false,
      shippingAddressCount: 0,
      defaultAddressLabel: null,
      missingFields: ["phone", "shippingAddress"],
    },
    [{ type: "BANK", bankName: "Example Bank", accountNo: "123-4-56789-0" }]
  );
  assert.match(reply, /แจ้งเบอร์โทรศัพท์/);
  assert.doesNotMatch(reply, /แจ้งที่อยู่/);
  assert.doesNotMatch(reply, /Example Bank|ชำระเงิน/);
});

test("checkout shows only configured payment accounts", () => {
  const accounts = [
    {
      type: "BANK",
      bankName: "Example Bank",
      accountNo: "123-4-56789-0",
      accountName: "Example Shop",
    },
    { type: "PROMPTPAY", promptpayId: " " },
  ];
  assert.deepEqual(customerPaymentAccountLines(accounts), [
    "• Example Bank เลขบัญชี 123-4-56789-0 ชื่อบัญชี Example Shop",
  ]);
  const reply = checkoutNextStepReply(
    {
      marketplaceManaged: false,
      hasRecipientName: true,
      hasPhone: true,
      hasShippingAddress: true,
      shippingAddressCount: 1,
      defaultAddressLabel: null,
      missingFields: [],
    },
    accounts
  );
  assert.match(reply, /Example Bank/);
  assert.doesNotMatch(reply, /พร้อมเพย์/);
});

test("marketplace checkout never asks for delivery or payment details again", () => {
  const reply = checkoutNextStepReply(
    {
      marketplaceManaged: true,
      hasRecipientName: false,
      hasPhone: false,
      hasShippingAddress: false,
      shippingAddressCount: 0,
      defaultAddressLabel: null,
      missingFields: [],
    },
    [{ type: "BANK", bankName: "Example Bank", accountNo: "123" }]
  );
  assert.equal(
    reply,
    "ข้อมูลผู้รับ ที่อยู่ และการชำระเงินใช้งานจาก Seller Center จึงไม่ต้องกรอกซ้ำค่ะ"
  );
});

test("checkout continuation maps a reply to the field that was actually requested", () => {
  assert.deepEqual(
    checkoutDetailsFromReply("เบอร์ 081-234-5678 ค่ะ", [
      {
        role: "assistant",
        content:
          "มีชื่อผู้รับแล้วค่ะ ก่อนจัดส่งรบกวนแจ้งเบอร์โทรศัพท์ที่ติดต่อได้ค่ะ",
      },
    ]),
    { phone: "081-234-5678" }
  );
  assert.deepEqual(
    checkoutDetailsFromReply("ที่อยู่: 18 ซอยสุขุมวิท 46 กรุงเทพ 10110", [
      {
        role: "assistant",
        content:
          "มีชื่อและเบอร์โทรแล้วค่ะ ก่อนจัดส่งรบกวนแจ้งที่อยู่จัดส่งค่ะ",
      },
    ]),
    { shippingAddress: "18 ซอยสุขุมวิท 46 กรุงเทพ 10110" }
  );
});

test("checkout continuation does not save navigation or existing-address confirmations as PII", () => {
  const history = [
    {
      role: "assistant" as const,
      content: "ก่อนจัดส่ง รบกวนแจ้งชื่อผู้รับค่ะ",
    },
  ];
  assert.equal(checkoutDetailsFromReply("ดูอย่างอื่นด้วย", history), null);
  assert.equal(checkoutDetailsFromReply("ใช้ข้อมูลเดิม", history), null);
});

test("English checkout copy and continuation stay on the same deterministic contract", () => {
  const status = {
    marketplaceManaged: false,
    hasRecipientName: true,
    hasPhone: false,
    hasShippingAddress: false,
    shippingAddressCount: 0,
    defaultAddressLabel: null,
    missingFields: ["phone", "shippingAddress"] as Array<"phone" | "shippingAddress">,
  };
  const reply = checkoutNextStepReply(status, [], true);
  assert.match(reply, /provide a contact phone number/i);
  assert.doesNotMatch(reply, /shipping address/i);
  assert.deepEqual(
    checkoutDetailsFromReply("Phone: 081-234-5678", [{ role: "assistant", content: reply }]),
    { phone: "081-234-5678" }
  );
  assert.equal(
    checkoutDetailsFromReply("use existing details", [{ role: "assistant", content: "Please provide the recipient name." }]),
    null
  );
  assert.deepEqual(configuredPaymentMethodLabels([
    { type: "BANK", bankName: "Example Bank", accountNo: "123" },
    { type: "PROMPTPAY", promptpayId: "0812345678" },
  ], true), ["bank transfer", "PromptPay"]);
});
