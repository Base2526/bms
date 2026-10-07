import assert from "node:assert/strict";
import test from "node:test";

import {
  couponCodeFromMessage,
  isEnglishCustomerReply,
  isStoreInfoQuestion,
  isBoardGameVisitQuestion,
  shippingProvinceFromMessage,
} from "../../apps/web/lib/bms/customerMessageRouting.ts";

test("natural opening and closing questions retrieve shop facts", () => {
  for (const message of ["เวลาเปิด ปิด", "เวลาเปิด-ปิด", "ปิดกี่โมงครับ", "เปิดวันไหนบ้าง", "หยุดวันไหน", "closing hours", "What time do you close?", "ร้านอะไรครับนี้", "ร้านอยู่ตรงไหนครับ"]) {
    assert.equal(isStoreInfoQuestion(message), true, message);
  }
  for (const message of ["เปิดบิลให้หน่อย", "ปิดออร์เดอร์", "อยากซื้อเกม"]) {
    assert.equal(isStoreInfoQuestion(message), false, message);
  }
});

test("general play interest uses cafe facts without treating purchases as visits", () => {
  for (const message of ["อยากเล่นเกม", "อยากมาเล่นบอร์ดเกมครับ", "มีเกมไหม", "มีเกมให้เล่นไหมคะ", "I want to play board games"]) {
    assert.equal(isBoardGameVisitQuestion(message, "board_game_cafe"), true, message);
    assert.equal(isBoardGameVisitQuestion(message, "retail"), false, message);
  }
  for (const message of ["อยากซื้อเกม", "มี Catan ไหม", "ค่าเล่นเกมเท่าไหร่", "จองโต๊ะให้หน่อย"]) {
    assert.equal(isBoardGameVisitQuestion(message, "board_game_cafe"), false, message);
  }
});

test("coupon code extraction wins for natural coupon questions", () => {
  assert.equal(couponCodeFromMessage("ใช้โค้ด SAVE10 ได้ไหม"), "SAVE10");
  assert.equal(couponCodeFromMessage("โค้ด SAVE10 ใช้ได้ไหม"), "SAVE10");
  assert.equal(couponCodeFromMessage("apply coupon WELCOME_20"), "WELCOME_20");
  assert.equal(couponCodeFromMessage("ตอนนี้มีคูปองอะไรบ้าง"), null);
});

test("shipping province extraction passes only explicit destinations", () => {
  assert.equal(shippingProvinceFromMessage("ค่าส่งไปเชียงใหม่เท่าไหร่"), "เชียงใหม่");
  assert.equal(shippingProvinceFromMessage("ส่งจากกรุงเทพไปเชียงใหม่กี่วัน"), "เชียงใหม่");
  assert.equal(shippingProvinceFromMessage("ค่าส่ง กทม. เท่าไหร่"), "กรุงเทพมหานคร");
  assert.equal(shippingProvinceFromMessage("ส่งไป จ.เชียงใหม่ กี่วัน"), "เชียงใหม่");
  assert.equal(shippingProvinceFromMessage("shipping to Chiang Mai cost"), "Chiang Mai");
  assert.equal(shippingProvinceFromMessage("ค่าส่งเท่าไหร่"), null);
});

test("bilingual reply selection follows the configured customer language", () => {
  assert.equal(isEnglishCustomerReply("en", "สวัสดี"), true);
  assert.equal(isEnglishCustomerReply("th", "shipping fee?"), false);
  assert.equal(isEnglishCustomerReply("th-en", "shipping fee?"), true);
  assert.equal(isEnglishCustomerReply("th-en", "ค่าส่ง SAVE10 เท่าไหร่"), false);
});
