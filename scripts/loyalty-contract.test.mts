// สัญญาของเลขคณิตส่วนลดสมาชิก + แต้ม (migration 7.96)
//
// ทำไมต้องมีเทสชุดนี้: จอ POS เรียก composeDiscounts ผ่าน
// POST /api/pos/member/preview เพื่อโชว์ยอดให้ลูกค้า แล้ว createOrder เรียกซ้ำ
// อีกครั้งตอน commit ถ้าสองทางได้เลขต่างกันแม้สตางค์เดียว ยอดที่เครื่องส่งมาจะ
// ไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH และบิลถูกยกเลิกทิ้งทั้งใบ
// หน้าเคาน์เตอร์จึงพังโดยที่ไม่มี error บอกสาเหตุ

import assert from "node:assert/strict";
import test from "node:test";

import {
  composeDiscounts,
  consumedToCoverDeficit,
  DEFAULT_LOYALTY_SETTINGS,
  pointsEarnedFor,
  pointsToDiscount,
  tierDiscountAmount,
  type LoyaltySettings,
  type MembershipTier,
} from "../apps/web/lib/bms/loyaltyMath.ts";

const settings = (over: Partial<LoyaltySettings> = {}): LoyaltySettings => ({
  ...DEFAULT_LOYALTY_SETTINGS,
  enabled: true,
  ...over,
});

const tier = (over: Partial<MembershipTier> = {}): MembershipTier => ({
  id: "t1",
  code: "GOLD",
  name: "Gold",
  discountType: "PERCENT",
  discountValue: 5,
  qualifySpend12m: 0,
  qualifyPoints: 0,
  sortOrder: 1,
  active: true,
  ...over,
});

test("ส่วนลดสามชั้นซ้อนกันได้ และผลรวมต่อชั้นต้องเท่ากับ totalDiscount", () => {
  const r = composeDiscounts({
    settings: settings(),
    subtotal: 1000,
    tier: tier(),
    couponDiscount: 100,
    pointsRequested: 200,
    pointsAvailable: 320,
  });
  assert.equal(r.tierDiscount, 50);
  assert.equal(r.couponDiscount, 100);
  assert.equal(r.pointsDiscount, 20);
  assert.equal(r.pointsUsed, 200);
  assert.equal(r.totalDiscount, 170);
  assert.equal(r.netTotal, 830);
  assert.equal(r.capped, false);
  // ตัวเลขต่อชั้นต้องรวมได้เท่ายอดรวมเสมอ — bms_order_discounts ต้องตรงกับ
  // bms_orders.discount_amount ไม่งั้นสืบย้อนใบกำกับไม่ได้
  assert.equal(
    r.tierDiscount + r.couponDiscount + r.pointsDiscount + r.manualDiscount,
    r.totalDiscount
  );
});

test("แลกแต้มได้ไม่เกินที่มี และเศษแต้มไม่ถูกหักไปเปล่า ๆ", () => {
  const r = composeDiscounts({
    settings: settings(),
    subtotal: 1000,
    tier: null,
    pointsRequested: 999,
    pointsAvailable: 250,
  });
  // 250 แต้มแลกได้ 2 หน่วย = 200 แต้ม ส่วนอีก 50 แต้มยังอยู่กับลูกค้า
  assert.equal(r.pointsUsed, 200);
  assert.equal(r.pointsDiscount, 20);
});

test("แต้มต่ำกว่าขั้นต่ำของร้านแลกไม่ได้เลย", () => {
  const r = composeDiscounts({
    settings: settings({ redeemMinPoints: 100 }),
    subtotal: 500,
    tier: null,
    pointsRequested: 99,
    pointsAvailable: 99,
  });
  assert.equal(r.pointsUsed, 0);
  assert.equal(r.pointsDiscount, 0);
  assert.equal(r.totalDiscount, 0);
});

test("ร้านที่ปิดโปรแกรมยังได้ส่วนลด tier แต่แลกแต้มไม่ได้", () => {
  const r = composeDiscounts({
    settings: settings({ enabled: false }),
    subtotal: 1000,
    tier: tier(),
    pointsRequested: 500,
    pointsAvailable: 500,
  });
  assert.equal(r.tierDiscount, 50);
  assert.equal(r.pointsUsed, 0);
});

test("ชนเพดานส่วนลดต่อบิล: ตัดจากชั้นที่ย้อนคืนง่ายที่สุดก่อน และผลรวมยังตรง", () => {
  const r = composeDiscounts({
    settings: settings({ maxDiscountPct: 10 }),
    subtotal: 1000,
    tier: tier({ discountValue: 5 }),   // 50
    couponDiscount: 80,                  // รวม 130 เกินเพดาน 100
    pointsRequested: 200,
    pointsAvailable: 200,
  });
  assert.equal(r.capped, true);
  assert.equal(r.cappedAt, 100);
  assert.equal(r.totalDiscount, 100);
  // แต้ม/ส่วนลดมือถูกตัดก่อน คูปองที่นับ redemption แล้วย้อนยากถูกตัดหลัง
  assert.equal(r.pointsDiscount, 0);
  assert.equal(r.pointsUsed, 0);
  assert.equal(r.tierDiscount, 50);
  assert.equal(r.couponDiscount, 50);
  assert.equal(
    r.tierDiscount + r.couponDiscount + r.pointsDiscount + r.manualDiscount,
    r.totalDiscount
  );
});

test("ส่วนลดรวมไม่เกินยอดบิล — ลูกค้าจ่าย 0 ได้ แต่บิลติดลบไม่ได้", () => {
  const r = composeDiscounts({
    settings: settings(),
    subtotal: 30,
    tier: tier({ discountType: "FIXED", discountValue: 100 }),
    pointsRequested: 1000,
    pointsAvailable: 1000,
  });
  assert.equal(r.totalDiscount, 30);
  assert.equal(r.netTotal, 0);
  // ยอดเต็มถูกลดด้วย tier ไปแล้ว จึงไม่มีที่ให้แต้ม — ห้ามหักแต้มลูกค้าทิ้ง
  assert.equal(r.pointsUsed, 0);
});

test("ชั้นที่ปิดใช้งานหรือไม่มีส่วนลดต้องไม่ลดอะไร และไม่มี label", () => {
  assert.equal(tierDiscountAmount(tier({ active: false }), 1000), 0);
  assert.equal(tierDiscountAmount(tier({ discountType: "NONE" }), 1000), 0);
  assert.equal(tierDiscountAmount(null, 1000), 0);
  const r = composeDiscounts({ settings: settings(), subtotal: 1000, tier: tier({ discountType: "NONE" }) });
  assert.equal(r.tierLabel, null);
});

test("ส่วนลดแบบจำนวนเงินไม่เกินยอดบิล", () => {
  assert.equal(tierDiscountAmount(tier({ discountType: "FIXED", discountValue: 500 }), 200), 200);
});

test("อัตราแลกที่ไม่ลงตัวยังปัดเป็นหน่วยแลกเสมอ", () => {
  const s = settings({ redeemPointsPerUnit: 30, redeemBahtPerUnit: 7 });
  assert.deepEqual(pointsToDiscount(s, 95), { points: 90, discount: 21 });
  assert.deepEqual(pointsToDiscount(s, 29), { points: 0, discount: 0 });
  assert.deepEqual(pointsToDiscount(s, 0), { points: 0, discount: 0 });
});

test("แต้มที่ได้คิดจากยอดหลังส่วนลดโดย default — ส่วนลดต้องไม่ปั๊มแต้ม", () => {
  const s = settings({ earnPointsPerBaht: 1 });
  assert.equal(pointsEarnedFor(s, { netTotal: 830, discountAmount: 170 }), 830);
  assert.equal(
    pointsEarnedFor(settings({ earnBase: "BEFORE_DISCOUNT" }), { netTotal: 830, discountAmount: 170 }),
    1000
  );
});

test("แต้มปัดลงเสมอ และยอดต่ำกว่าขั้นต่ำไม่ได้แต้ม", () => {
  assert.equal(pointsEarnedFor(settings({ earnPointsPerBaht: 0.1 }), { netTotal: 99, discountAmount: 0 }), 9);
  assert.equal(
    pointsEarnedFor(settings({ earnMinSpend: 100 }), { netTotal: 99.99, discountAmount: 0 }),
    0
  );
  assert.equal(pointsEarnedFor(settings({ enabled: false }), { netTotal: 1000, discountAmount: 0 }), 0);
});

test("โหมดนับครั้งให้แต้มคงที่ ไม่ผูกกับยอด", () => {
  const s = settings({ earnMode: "VISIT", visitPoints: 5, earnMinSpend: 100 });
  assert.equal(pointsEarnedFor(s, { netTotal: 5000, discountAmount: 0 }), 5);
  assert.equal(pointsEarnedFor(s, { netTotal: 99, discountAmount: 0 }), 0);
});

test("แต้มที่ได้ครั้งถัดไปกลบยอดติดลบจากการคืนสินค้าก่อน", () => {
  // ลูกค้าแลกแต้มแล้วคืนของ ยอดเหลือ −50 · ได้แต้มใหม่ 83 ต้องใช้ได้ 33
  assert.equal(consumedToCoverDeficit(-50, 83), 50);
  assert.equal(consumedToCoverDeficit(-100, 83), 83);
  assert.equal(consumedToCoverDeficit(0, 83), 0);
  assert.equal(consumedToCoverDeficit(200, 83), 0);
});

// ---- ส่วนลดมือ (ชั้นที่ 4) -------------------------------------------
// composeDiscounts รองรับชั้นนี้มาตั้งแต่ 7.96 แต่ createOrder เพิ่งต่อท่อให้ใช้จริง
// สองเทสนี้ล็อกพฤติกรรมที่ route ฝั่ง POS พึ่งพา: ยอดที่ขอต้องได้เท่าที่ขอ
// เมื่อยังไม่ชนเพดาน และต้องถูกตัด "ก่อนชั้นอื่น" เมื่อชนเพดาน

test("ส่วนลดมือซ้อนบนชั้นอื่นได้ และผลรวมต่อชั้นเท่ากับ totalDiscount", () => {
  const r = composeDiscounts({
    settings: settings({ maxDiscountPct: 100 }),
    subtotal: 1000,
    tier: tier(),           // 5% = 50
    couponDiscount: 100,
    manualDiscount: 30,
  });
  assert.equal(r.tierDiscount, 50);
  assert.equal(r.couponDiscount, 100);
  assert.equal(r.manualDiscount, 30);
  assert.equal(r.totalDiscount, 180);
  assert.equal(r.netTotal, 820);
  assert.equal(
    r.tierDiscount + r.couponDiscount + r.pointsDiscount + r.manualDiscount,
    r.totalDiscount
  );
});

test("ชนเพดานแล้วส่วนลดมือถูกตัดก่อนชั้นอื่น (คูปอง/ชั้นสมาชิกย้อนคืนยากกว่า)", () => {
  const r = composeDiscounts({
    settings: settings({ maxDiscountPct: 10 }),   // เพดาน 100 จาก 1000
    subtotal: 1000,
    tier: tier(),           // 5% = 50
    couponDiscount: 40,
    manualDiscount: 50,     // รวมดิบ 140 → เกินเพดาน 40
  });
  assert.equal(r.totalDiscount, 100);
  assert.equal(r.tierDiscount, 50);      // ชั้นที่ย้อนยากที่สุด ไม่ถูกแตะ
  assert.equal(r.couponDiscount, 40);
  assert.equal(r.manualDiscount, 10);    // โดนตัด 40 จากชั้นนี้ทั้งหมด
  assert.equal(r.capped, true);
});
