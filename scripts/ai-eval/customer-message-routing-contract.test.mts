import assert from "node:assert/strict";
import test from "node:test";

import {
  couponCodeFromMessage,
  isEnglishCustomerReply,
  shippingProvinceFromMessage,
} from "../../apps/web/lib/bms/customerMessageRouting.ts";

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
