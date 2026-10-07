import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BOARD_GAME_CLAIM_GOLDENS, BOARD_GAME_CLAIM_NEGATIVES, BOARD_GAME_RECHECK_NEGATIVES, BOARD_GAME_GUARD_CORPUS } from "./board-game-guard-corpus.mjs";
import { boardGameCustomerGuard } from "../../apps/web/lib/bms/boardGameCustomerGuard.ts";

import {
  checkoutDetailsFromReply,
  checkoutNextStepReply,
  isAlternativeCatalogRequest,
  hasUnsupportedBoardGameActionClaim,
  boardGameCheckoutFallback,
  storeInfoReply,
  suppressUnconfiguredPaymentAdvice,
} from "../../apps/web/lib/bms/customerReplyPolicy.ts";
import {
  customerPaymentAccountLines,
  configuredPaymentAccounts,
  configuredPaymentMethodLabels,
  configuredPosPaymentQr,
  hasConfiguredPaymentAccounts,
  supportsCustomerPaymentMethod,
} from "../../apps/web/lib/bms/paymentConfiguration.ts";
import {
  normalizeCustomerIdentity,
  reorderTargetIdentity,
} from "../../apps/web/lib/bms/customerIdentity.ts";

for (const text of BOARD_GAME_CLAIM_GOLDENS) test(`BG claim golden: ${text}`, () => {
  assert.equal(hasUnsupportedBoardGameActionClaim(text), true);
});
for (const text of [...BOARD_GAME_CLAIM_NEGATIVES, ...BOARD_GAME_RECHECK_NEGATIVES]) test(`BG claim negative: ${text}`, () => {
  assert.equal(hasUnsupportedBoardGameActionClaim(text), false);
});
test("BG claim refusals cannot hide another affirmative clause", () => {
  for (const text of ["ไม่สามารถลดได้ แต่จองโต๊ะให้แล้วนะคะ", "I cannot refund you. Your table is booked", "ยังไม่ได้แจ้งพนักงาน\nได้รับเงินแล้วค่ะ"]) assert.equal(hasUnsupportedBoardGameActionClaim(text), true, text);
  for (const text of ["ไม่สามารถดำเนินการผ่านระบบนี้หรือรับปากว่าจะจองโต๊ะไว้ให้แล้วได้", "I cannot arrange it or promise that your table is booked"]) assert.equal(hasUnsupportedBoardGameActionClaim(text), false, text);
});

test("BG normalized contrast cannot hide an affirmative claim", () => {
  for (const text of ["ไม่สามารถลดได้ แ**ต่**จองโต๊ะให้แล้วนะคะ", "I cannot refund you b\u200but your table is booked"]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(text), true, text);
  }
});

test("BG created-order checkout fallback cannot reuse an unsupported model claim", () => {
  for (const english of [false, true]) for (const claim of BOARD_GAME_CLAIM_GOLDENS) {
    assert.equal(boardGameCheckoutFallback(claim, english), english ? "Your order has been received." : "รับออร์เดอร์แล้วค่ะ");
  }
  assert.equal(boardGameCheckoutFallback("Safe retail order details"), "Safe retail order details");
  const source = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = source.indexOf("} else if (execCtx.createdOrderId) {");
  const end = source.indexOf("} else if (execCtx.pharmacyReviewCaseId)", start);
  const block = source.slice(start, end);
  assert.match(block, /profile.businessArchetype === "board_game_cafe"\s*\? boardGameCheckoutFallback\(loop.reply, englishReply\)/);
});
test("BG own guard replies and pipeline fallback never count as completed actions", () => {
  for (const item of BOARD_GAME_GUARD_CORPUS.filter(item => item.guard)) for (const english of [false, true]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(boardGameCustomerGuard(item.message, english)!.reply), false, item.id);
  }
  const src = readFileSync(new URL("../../apps/web/lib/bms/pipeline.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const segment = src.slice(src.indexOf('} else if (profile.businessArchetype === "board_game_cafe" && hasUnsupportedBoardGameActionClaim('));
  const block = segment.slice(0, segment.indexOf("} else if (hasUnverifiedFacts"));
  assert.ok(block.length > 0);
  const replies = [...block.matchAll(/[?:]\s*"([^"]+)"/g)].map(match => match[1]);
  assert.equal(replies.length, 2);
  for (const reply of replies) assert.equal(hasUnsupportedBoardGameActionClaim(reply), false, reply);
  assert.ok(block.includes("hasUnsupportedBoardGameActionClaim(loop.reply)"));
  assert.equal(block.includes("submit_payment"), false, "slip submission must not authorize a received-money claim");
});

test("board-game replies cannot claim unsupported reservations, refunds or staff notifications", () => {
  for (const reply of ["จองโต๊ะให้แล้วค่ะ", "ต่อเวลาให้เรียบร้อยค่ะ", "คืนมัดจำสำเร็จแล้ว", "แจ้งพนักงานแล้วค่ะ", "ส่งเรื่องให้แอดมินแล้วค่ะ", "Your booking is confirmed", "Staff have been notified"]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(reply), true, reply);
  }
  for (const reply of ["ยังไม่ได้จองโต๊ะให้ค่ะ", "ยังไม่สามารถแจ้งพนักงานได้ค่ะ", "การจองต้องให้พนักงานยืนยันค่ะ", "The booking is not confirmed", "Staff have not been notified", "ค่าเล่นชั่วโมงละ 50 บาท"]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(reply), false, reply);
  }
});

test("opening hours replies reproduce saved hours including closed days", () => {
  const info = { storeName: "FAKE Cafe", businessHours: "อังคาร–อาทิตย์ 10:00–22:00 หยุดวันจันทร์" };
  for (const question of ["เวลาเปิด ปิด", "ปิดกี่โมงครับ", "หยุดวันไหน"]) {
    const reply = storeInfoReply(info, question);
    assert.match(reply, /เวลาทำการ: อังคาร–อาทิตย์ 10:00–22:00 หยุดวันจันทร์/);
    assert.doesNotMatch(reply, /แอดมิน|รอสักครู่|สินค้า/);
  }
  assert.match(storeInfoReply(info, "closing hours", true), /Opening hours:/);
});

test("a known shop name does not hide missing hours or invent open-now status", () => {
  for (const businessHours of [null, "", "   "]) {
    const reply = storeInfoReply({ storeName: "FAKE Cafe", businessHours }, "วันนี้เปิดไหม");
    assert.match(reply, /ยังไม่ได้ระบุเวลาเปิด–ปิด/);
    assert.doesNotMatch(reply, /เปิดอยู่|ปิดอยู่|รอสักครู่/);
  }
});

test("play interest uses the saved description and schedule without promising games or tables", () => {
  const reply = storeInfoReply({
    storeName: "FAKE Cafe", about: "คาเฟ่บอร์ดเกม", businessHours: "10:00–22:00", address: "FAKE address",
  }, "อยากเล่นเกม", false, true);
  assert.match(reply, /คาเฟ่บอร์ดเกม/);
  assert.match(reply, /10:00–22:00/);
  assert.match(reply, /มากี่ท่าน/);
  assert.doesNotMatch(reply, /สินค้า|โต๊ะว่าง|จองแล้ว|บาท|Catan/);
  assert.match(storeInfoReply({ about: "คาเฟ่บอร์ดเกม" }, "ร้านอะไรครับนี้"), /คาเฟ่บอร์ดเกม/);
});

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

test("POS customer display renders only a provider-issued QR payload", () => {
  assert.equal(configuredPosPaymentQr([
    { type: "PROMPTPAY", promptpayId: "0812345678" },
  ]), null);
  assert.deepEqual(configuredPosPaymentQr([
    {
      type: "PROMPTPAY",
      promptpayId: "0812345678",
      accountName: "Example Shop",
      qrPayload: "000201-provider-issued-payload-6304ABCD",
    },
  ]), {
    payload: "000201-provider-issued-payload-6304ABCD",
    accountName: "Example Shop",
    promptpayId: "0812345678",
  });
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
test("reservation requests are not confirmed bookings: phase zero bilingual goldens", () => {
  for (const text of ["รับจองไว้ให้แล้ว", "บันทึกการจองไว้แล้ว", "เก็บโต๊ะไว้ให้แล้ว", "กันโต๊ะไว้ให้แล้ว", "จองโต๊ะให้เรียบร้อยแล้ว", "ยืนยันการจองแล้ว", "โต๊ะของคุณพร้อมแล้ว", "Your table is booked", "I've reserved a table for you", "your booking is confirmed"]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(text), true, text);
  }
  for (const text of ["ส่งคำขอจองแล้ว รอร้านยืนยัน", "ยังไม่ได้จองหรือยืนยันโต๊ะ", "I cannot confirm the booking", "ส่งคำขอจองโต๊ะ #12345678 ให้ร้านตรวจแล้วค่ะ ตอนนี้ยังไม่ได้ยืนยันโต๊ะ", "Booking request #12345678 was sent for staff review. No table is confirmed yet."]) {
    assert.equal(hasUnsupportedBoardGameActionClaim(text), false, text);
  }
  assert.equal(hasUnsupportedBoardGameActionClaim("ส่งคำขอจองแล้ว และยืนยันการจองแล้ว"), true);
  assert.equal(hasUnsupportedBoardGameActionClaim("Your booking is confirmed, not a confirmed table"), true);
});
