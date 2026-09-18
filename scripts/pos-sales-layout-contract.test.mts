/**
 * หน้าขายของ Web POS ต้องคงโครงที่อนุมัติจาก mockup:
 * รายการสินค้า 64% ทางซ้าย, รับชำระ 36% ทางขวา, ตารางรายการที่กวาดตาได้
 * และจอแคบต้องเหลือคอลัมน์เดียวโดยไม่มีหัวตารางเบียดออกนอกจอ
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../apps/web/app/(pos)/pos/page.tsx");
const css = read("../apps/web/app/(pos)/pos/pos.css");

test("the sell tab opts into the approved compact 64/36 workspace", () => {
  assert.match(page, /tab === "sell" \? " pos-main-grid--sell"/);
  assert.match(
    css,
    /\.pos-main-grid--sell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*64fr\)\s+minmax\(380px,\s*36fr\)\s*!important/,
  );
  assert.match(page, /tab === "sell" \? " pos-sale-basket"/);
  assert.match(page, /tab === "sell" \? " pos-sale-checkout"/);
});

test("the basket matches the mockup hierarchy", () => {
  assert.match(page, /className="pos-sale-basket-head"/);
  assert.match(page, /className="pos-sale-basket-title">รายการขาย/);
  assert.match(page, /onClick=\{\(\) => setParkOpen\(true\)\}[\s\S]{0,100}พักบิล/);
  assert.match(page, /className="pos-sale-line-header"[\s\S]{0,180}<span>สินค้า<\/span>[\s\S]*?<span>ราคา<\/span>[\s\S]*?<span>จำนวน<\/span>[\s\S]*?<span>รวม<\/span>/);
  assert.match(page, /className="pos-line-unit-price"/);
  assert.match(page, /className="pos-sale-empty"[\s\S]{0,180}ยังไม่มีสินค้าในบิล/);
});

test("the checkout keeps summary, method selection, cash keypad, and the primary action in one pane", () => {
  assert.match(page, /className="pos-sale-totalbar"/);
  assert.match(page, /className=\{tab === "sell" \? "pos-sale-checkout-scroll" : undefined\}/);
  assert.match(page, /className=\{tab === "sell" \? "pos-sale-checkout-footer" : undefined\}/);
  assert.match(page, /className="pos-sale-summary"/);
  assert.match(page, /className="pos-sale-summary-total"[\s\S]{0,100}ยอดสุทธิ/);
  assert.match(page, /className="pos-sale-payment-head"[\s\S]{0,100}วิธีชำระเงิน/);
  assert.match(page, /className="pos-sale-method-grid"/);
  assert.match(page, /className="pos-sale-cash"/);
  assert.match(page, /payBlockedReason \?\? `รับชำระ ฿\$\{baht\(amountDue\)\}`/);
  assert.match(page, /className="pos-sale-coupon"[\s\S]{0,180}<summary>โค้ดส่วนลด<\/summary>/);
  assert.match(page, /className="pos-sale-member-heading"[\s\S]{0,160}ลูกค้า \/ สมาชิก[\s\S]*?ค้นหาด้วยเบอร์โทรหรือเลขสมาชิกก่อนรับชำระ/);
  assert.match(page, /className="pos-sale-customer-discount-toggle"[\s\S]{0,180}aria-expanded=\{customerDiscountOpen\}/);
  assert.match(page, /ลูกค้าและส่วนลด[\s\S]{0,500}ไม่มีส่วนลด/);
  assert.match(css, /\.pos-sale-checkout \.pos-sale-adjustments\s*\{[\s\S]*?width:\s*100%;[\s\S]*?padding:\s*0;/);
  assert.match(css, /\.pos-sale-customer-discount \.pos-sale-member\s*\{[\s\S]*?width:\s*100%;[\s\S]*?display:\s*block;/);
  assert.match(page, /className="pos-sale-status"/);
  assert.match(page, /className="pos-sale-bill-options"[\s\S]{0,180}tab === "sell" \? "ตัวเลือกบิล"/);
  assert.match(css, /\.pos-sale-checkout\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.pos-sale-checkout-scroll\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.pos-sale-discount-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.pos-root \.pos-sale-method\s*\{[\s\S]*?min-height:\s*36px/);
  assert.match(css, /\.pos-sale-checkout \.pos-quick\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /\.pos-sale-checkout-footer\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(css, /\.pos-root \.pos-sale-checkout \.pos-pay\s*\{[\s\S]*?background:\s*var\(--pos-accent\)/);
});

test("the sales layout collapses safely on narrow screens", () => {
  assert.match(css, /@media \(max-width:\s*860px\)[\s\S]*?\.pos-sale-checkout\s*\{[\s\S]*?order:\s*-1/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.pos-sale-line-header\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:\s*600px\)[\s\S]*?\.pos-sale-method-grid\s*\{\s*grid-template-columns:\s*repeat\(3,/);
});
