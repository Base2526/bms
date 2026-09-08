// สัญญาของเลขคณิตส่วนลดสมาชิก + แต้ม (migration 7.96)
//
// ทำไมต้องมีเทสชุดนี้: จอ POS เรียก composeDiscounts ผ่าน
// POST /api/pos/member/preview เพื่อโชว์ยอดให้ลูกค้า แล้ว createOrder เรียกซ้ำ
// อีกครั้งตอน commit ถ้าสองทางได้เลขต่างกันแม้สตางค์เดียว ยอดที่เครื่องส่งมาจะ
// ไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH และบิลถูกยกเลิกทิ้งทั้งใบ
// หน้าเคาน์เตอร์จึงพังโดยที่ไม่มี error บอกสาเหตุ

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  composeDiscounts,
  consumedToCoverDeficit,
  DEFAULT_LOYALTY_SETTINGS,
  evaluatePointsEarn,
  pointsEarnedFor,
  pointsToDiscount,
  shouldPrintMemberPoints,
  tierDiscountAmount,
  type LoyaltySettings,
  type MembershipTier,
} from "../apps/web/lib/bms/loyaltyMath.ts";
import { priceLinesByQty, type PriceTier } from "../apps/web/lib/bms/pricing.ts";

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

test("tier qualification and tier sales count paid orders only", () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/membership.ts", import.meta.url), "utf8");
  assert.match(source, /const PAID_ORDER_STATUSES = \["PAID", "PACKING", "SHIPPED", "COMPLETED"\]/);

  const reviewStart = source.indexOf("export async function reviewMemberTier(");
  const reviewEnd = source.indexOf("export async function reviewMemberTierForOrder(");
  const reviewSource = source.slice(reviewStart, reviewEnd);
  assert.match(reviewSource, /o\.status = ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(reviewSource, /status NOT IN/);

  const reportStart = source.indexOf("export async function salesByTierReport(");
  const reportEnd = source.indexOf("export async function loyaltyOutstandingReport(");
  const reportSource = source.slice(reportStart, reportEnd);
  assert.match(reportSource, /o\.status = ANY\(\$2::text\[\]\)/);
  assert.doesNotMatch(reportSource, /status NOT IN/);
});

test("หลายไซซ์ + สมาชิก + คะแนน + ส่วนลดมือ ใช้ฐานเดียวกับ server", () => {
  const wholesale: PriceTier[] = [{ minQty: 5, unitPrice: 1300 }];
  const priced = priceLinesByQty(
    [
      { sku: "LANVIN", size: "XL", qty: 2 },
      { sku: "LANVIN", size: "M", qty: 3 },
    ],
    new Map([
      ["LANVIN\u0000XL", 1500],
      ["LANVIN\u0000M", 1500],
    ]),
    new Map([["LANVIN", wholesale]])
  );
  const subtotal = priced.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  assert.equal(subtotal, 7500, "2 XL กับ 3 M ห้ามรวมเป็น 5 เพื่อรับราคาส่ง");

  const discount = composeDiscounts({
    settings: settings(),
    subtotal,
    tier: tier(),
    pointsRequested: 2700,
    pointsAvailable: 2745,
    manualDiscount: 5,
  });
  assert.equal(discount.tierDiscount, 375);
  assert.equal(discount.pointsDiscount, 270);
  assert.equal(discount.manualDiscount, 5);
  assert.equal(discount.netTotal, 6850);
});

test("ราคาส่งเฉพาะไซซ์ถึงขั้นต่ำไม่ลากอีกไซซ์มาลด ก่อนคำนวณสมาชิกและแต้ม", () => {
  const wholesale: PriceTier[] = [
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "M", unitPrice: 80 },
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "XL", unitPrice: 120 },
  ];
  const priced = priceLinesByQty(
    [
      { sku: "SHIRT", size: "M", qty: 5 },
      { sku: "SHIRT", size: "XL", qty: 4 },
    ],
    new Map([
      ["SHIRT\u0000M", 100],
      ["SHIRT\u0000XL", 150],
    ]),
    new Map([["SHIRT", wholesale]])
  );
  assert.deepEqual(priced.map((line) => line.unitPrice), [80, 150]);

  const discount = composeDiscounts({
    settings: settings(),
    subtotal: 1_000,
    tier: tier(),
    pointsRequested: 200,
    pointsAvailable: 200,
    manualDiscount: 5,
  });
  assert.equal(discount.tierDiscount, 50);
  assert.equal(discount.pointsDiscount, 20);
  assert.equal(discount.netTotal, 925);
});

test("POS รวมราคาส่งข้ามไซซ์แล้วใช้สมาชิก แต้ม และส่วนลดมือได้ยอดตรง server", () => {
  const crossVariant: PriceTier[] = [{
    minQty: 5,
    scope: "CROSS_VARIANT_PERCENT",
    discountPct: 13.3333333333,
    unitPrice: null,
  }];
  const priced = priceLinesByQty(
    [
      { sku: "LANVIN", size: "XL", qty: 2 },
      { sku: "LANVIN", size: "M", qty: 3 },
    ],
    new Map([
      ["LANVIN\u0000XL", 1500],
      ["LANVIN\u0000M", 1500],
    ]),
    new Map([["LANVIN", crossVariant]])
  );
  const subtotal = priced.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  assert.equal(subtotal, 6500, "XL 2 + M 3 ต้องรวมเป็น 5 แล้วลดราคาของแต่ละไซซ์");

  const discount = composeDiscounts({
    settings: settings(),
    subtotal,
    tier: tier(),
    pointsRequested: 2700,
    pointsAvailable: 2745,
    manualDiscount: 5,
  });
  assert.equal(discount.tierDiscount, 325);
  assert.equal(discount.pointsDiscount, 270);
  assert.equal(discount.manualDiscount, 5);
  assert.equal(discount.netTotal, 5900);
});

test("regression: ตะกร้า 22 ชิ้นในภาพต้องใช้ขั้นรวมไซซ์ก่อนคิดสมาชิกและแต้ม", () => {
  const lanvinTiers: PriceTier[] = [
    { minQty: 5, scope: "PER_VARIANT_FIXED", unitPrice: 1_300 },
    { minQty: 10, scope: "CROSS_VARIANT_PERCENT", discountPct: 16.6667 },
  ];
  const priced = priceLinesByQty(
    [
      { sku: "BABYMILD", size: "S", qty: 4 },
      { sku: "BURBERRY", size: "M", qty: 2 },
      { sku: "JUICY", size: "S", qty: 2 },
      { sku: "JUICY", size: "M", qty: 2 },
      { sku: "JUICY", size: "XL", qty: 2 },
      { sku: "LANVIN", size: "M", qty: 5 },
      { sku: "LANVIN", size: "XL", qty: 5 },
    ],
    new Map([
      ["BABYMILD\u0000S", 300],
      ["BURBERRY\u0000M", 999],
      ["JUICY\u0000S", 600],
      ["JUICY\u0000M", 800],
      ["JUICY\u0000XL", 1_000],
      ["LANVIN\u0000M", 1_500],
      ["LANVIN\u0000XL", 1_500],
    ]),
    new Map([["LANVIN", lanvinTiers]])
  );
  const subtotal = priced.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  assert.equal(subtotal, 20_498, "Lanvin รวม 10 ชิ้นต้องเป็น 1,250 บาทต่อชิ้น ไม่ค้างที่ 1,300");

  const discount = composeDiscounts({
    settings: settings(),
    subtotal,
    tier: tier(),
    pointsRequested: 2_700,
    pointsAvailable: 2_760,
    manualDiscount: 78.1,
  });
  assert.equal(discount.totalDiscount, 1_373);
  assert.equal(discount.netTotal, 19_125);
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

test("ค่าถุงบวกหลังส่วนลดสินค้า ไม่เพิ่มฐานส่วนลดสมาชิก", () => {
  const r = composeDiscounts({
    settings: settings(),
    subtotal: 600,
    tier: tier({ discountValue: 3 }),
    manualDiscount: 2,
  });
  assert.equal(r.tierDiscount, 18);
  assert.equal(r.manualDiscount, 2);
  assert.equal(r.netTotal, 580);
  assert.equal(r.netTotal + 20, 600, "ค่าถุง ฿20 ต้องบวกเต็มจำนวนหลังส่วนลด");
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

test("กดแลกทั้งหมด 3,045 แต้ม ใช้เฉพาะ 3,000 และต้องเหลือเศษ 45", () => {
  const r = composeDiscounts({
    settings: settings(),
    subtotal: 5000,
    tier: null,
    pointsRequested: 3045,
    pointsAvailable: 3045,
  });
  assert.equal(r.pointsUsed, 3000);
  assert.equal(r.pointsDiscount, 300);
  assert.equal(3045 - r.pointsUsed, 45);
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
// =============================================================
// "ทำไมบิลนี้ได้ +0 แต้ม" — เคสจริงจากหน้าร้าน 2026-09-08
// -------------------------------------------------------------
// บิลโต๊ะ ฿69 ผูกสมาชิกแล้วได้ +0 แต้ม โดยที่ไม่มีจอไหนบอกเหตุผล พนักงานจึง
// รู้ตอนใบเสร็จออกจากเครื่องพิมพ์แล้ว · สาเหตุอยู่ที่การตั้งค่าของร้าน ไม่ใช่บั๊ก
// ของการคิดเลข แต่ "การไม่บอกเหตุผล" คือสิ่งที่ต้องกันไม่ให้กลับมา
// =============================================================

test("evaluatePointsEarn เป็นบันไดเดียวกับ pointsEarnedFor เสมอ", () => {
  // ห้ามมีบันไดที่สองไว้ "หาเหตุผล" — วันที่สองบันไดต่างกัน จอจะอธิบายด้วย
  // เงื่อนไขที่ไม่ได้ตัดสินจริง ซึ่งแย่กว่าไม่อธิบายเลย
  const cases: LoyaltySettings[] = [
    settings(),
    settings({ enabled: false }),
    settings({ earnMinSpend: 100 }),
    settings({ earnPointsPerBaht: 0.01 }),
    settings({ earnMode: "VISIT", visitPoints: 0 }),
    settings({ earnMode: "VISIT", visitPoints: 3 }),
    settings({ earnBase: "BEFORE_DISCOUNT" }),
  ];
  for (const s of cases) {
    for (const [netTotal, discountAmount] of [[69, 0], [0, 0], [1000, 250], [99.5, 0.5]]) {
      assert.equal(
        evaluatePointsEarn(s, { netTotal, discountAmount }).points,
        pointsEarnedFor(s, { netTotal, discountAmount }),
        `บันไดต่างกันที่ ${JSON.stringify({ s, netTotal, discountAmount })}`
      );
    }
  }
});

test("บิล ฿69 ที่ร้านตั้ง 100 บาท = 1 แต้ม ได้ 0 แต้ม และบอกว่าเพราะอัตราต่ำ", () => {
  // เลขจริงจากเคสหน้าร้าน: 69 × 0.01 = 0.69 → ปัดลงเหลือ 0
  const out = evaluatePointsEarn(settings({ earnPointsPerBaht: 0.01 }), {
    netTotal: 69,
    discountAmount: 0,
  });
  assert.equal(out.points, 0);
  assert.equal(out.block, "RATE_TOO_LOW");
  assert.equal(out.base, 69);
  // 25 บาท = 1 แต้ม ต้องได้แต้มจริงจากยอดเดียวกัน (กันการ "แก้" ด้วยการตอบ 0 ทุกกรณี)
  const ok = evaluatePointsEarn(settings({ earnPointsPerBaht: 0.04 }), { netTotal: 69, discountAmount: 0 });
  assert.equal(ok.points, 2);
  assert.equal(ok.block, null);
});

test("แต่ละด่านที่ทำให้ได้ 0 แต้ม ต้องแยกเหตุผลออกจากกันได้", () => {
  // สี่ด่านนี้ทางแก้คนละเรื่องกันทั้งหมด (เปิดสวิตช์ / ลดขั้นต่ำ / ขึ้นอัตรา /
  // ตั้งแต้มต่อครั้ง) เหมารวมเป็น "ไม่ได้แต้ม" เฉย ๆ = พนักงานทำอะไรต่อไม่ได้
  assert.equal(evaluatePointsEarn(settings({ enabled: false }), { netTotal: 69, discountAmount: 0 }).block, "PROGRAM_DISABLED");
  assert.equal(evaluatePointsEarn(settings({ earnMinSpend: 100 }), { netTotal: 69, discountAmount: 0 }).block, "BELOW_MIN_SPEND");
  assert.equal(evaluatePointsEarn(settings({ earnPointsPerBaht: 0.01 }), { netTotal: 69, discountAmount: 0 }).block, "RATE_TOO_LOW");
  assert.equal(evaluatePointsEarn(settings({ earnMode: "VISIT", visitPoints: 0 }), { netTotal: 69, discountAmount: 0 }).block, "NO_VISIT_POINTS");
  // โปรแกรมปิดต้องชนะทุกด่าน — ถ้าตอบ RATE_TOO_LOW ผู้จัดการจะไปแก้อัตราซึ่งไม่ช่วยอะไร
  assert.equal(
    evaluatePointsEarn(settings({ enabled: false, earnPointsPerBaht: 0.01, earnMinSpend: 999 }), { netTotal: 69, discountAmount: 0 }).block,
    "PROGRAM_DISABLED"
  );
  // ฐานคิดแต้มต้องคืนมาแม้โปรแกรมปิด จอจึงอธิบายได้ว่าคิดจากยอดไหน
  assert.equal(evaluatePointsEarn(settings({ enabled: false }), { netTotal: 69, discountAmount: 31 }).base, 69);
  assert.equal(
    evaluatePointsEarn(settings({ enabled: false, earnBase: "BEFORE_DISCOUNT" }), { netTotal: 69, discountAmount: 31 }).base,
    100
  );
});

test("ใบเสร็จพิมพ์บล็อกแต้มเฉพาะตอนที่มีอะไรจะบอกจริง", () => {
  // ร้านที่ไม่มีโปรแกรม: "แต้มที่ได้บิลนี้ +0" อ่านว่า "ร้านมีโปรแกรม แต่ฉันไม่ได้แต้ม"
  assert.equal(shouldPrintMemberPoints({ loyaltyEnabled: false, isMember: true, pointsEarned: 0 }), false);
  // แต่บิลที่ได้แต้มไปแล้วต้องพิมพ์เสมอ แม้ร้านปิดโปรแกรมทีหลัง — ใบเสร็จเป็น
  // หลักฐานของตอนขาย ไม่ใช่ของการตั้งค่าวันที่พิมพ์ซ้ำ
  assert.equal(shouldPrintMemberPoints({ loyaltyEnabled: false, isMember: true, pointsEarned: 5 }), true);
  // โปรแกรมเปิด + เป็นสมาชิก + ได้ 0 → พิมพ์ตามจริง (จอเป็นคนอธิบายเหตุผลก่อนรับเงิน)
  assert.equal(shouldPrintMemberPoints({ loyaltyEnabled: true, isMember: true, pointsEarned: 0 }), true);
  // ลูกค้าที่มีแถวใน CRM แต่ไม่ได้สมัครสมาชิกไม่มีสิทธิ์ได้แต้มอยู่แล้ว
  assert.equal(shouldPrintMemberPoints({ loyaltyEnabled: true, isMember: false, pointsEarned: 0 }), false);
});

test("พรีวิวคิดแต้มจากยอดหลังส่วนลด ด้วยฐานเดียวกับตอน commit", () => {
  const src = readFileSync(new URL("../apps/web/lib/bms/membership.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function previewMemberDiscount");
  assert.ok(start >= 0, "หา previewMemberDiscount ไม่เจอ");
  // ปลายฟังก์ชัน = `}` ที่คอลัมน์ 0 · ห้ามใช้ indexOf("\\n}") เฉย ๆ เพราะ object type
  // ของพารามิเตอร์ก็ปิดที่คอลัมน์ 0 เหมือนกัน (`}): Promise<...>`) แล้ว slice จะสั้นเกิน
  // เหลือแค่ signature — เทสจะแดงด้วยเหตุผลผิด (เจอมาแล้วตอนเขียนเทสนี้)
  const end = src.slice(start).search(/\n\}\r?\n/);
  assert.ok(end > 0, "หาปลาย previewMemberDiscount ไม่เจอ");
  const body = src.slice(start, start + end);
  // ต้องใช้ netTotal/totalDiscount ของ breakdown ไม่ใช่ args.subtotal ดิบ —
  // earnPointsForOrderInTx อ่าน total_amount กับ discount_amount ของบิล
  assert.match(body, /evaluatePointsEarn\(settings, \{\s*netTotal: breakdown\.netTotal,\s*discountAmount: breakdown\.totalDiscount,/);
  assert.doesNotMatch(body, /evaluatePointsEarn\(settings, \{\s*netTotal: args\.subtotal/);
  // ลูกค้าที่ไม่ได้สมัครสมาชิกต้องได้ null ไม่ใช่ 0 (0 อ่านว่า "สมัครแล้วแต่ไม่ได้แต้ม")
  assert.match(body, /const isMember = Boolean\(member\?\.memberNo\)/);
  assert.match(body, /pointsWillEarn: isMember \? earn\.points : null/);
});

test("จอต้องได้ผลลัพธ์ที่คิดแล้ว ไม่ใช่อัตราให้คูณเอง", () => {
  // จอที่คูณอัตราเองคือสูตรชุดที่สอง แล้ววันหนึ่งจะสัญญาแต้มที่ ledger ไม่ได้ให้
  for (const rel of [
    "../apps/web/app/(pos)/pos/page.tsx",
    "../apps/web/app/(pos)/pos/restaurant/page.tsx",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.doesNotMatch(src, /earnPointsPerBaht/, `${rel} ห้ามรู้จักอัตราสะสมแต้ม`);
    assert.doesNotMatch(src, /earnMinSpend/, `${rel} ห้ามรู้จักยอดขั้นต่ำ`);
  }
});

test("ทั้งสองจอเตือนเรื่องแต้มก่อนรับเงิน และแปลครบทุกด่าน", () => {
  const blocks = ["PROGRAM_DISABLED", "BELOW_MIN_SPEND", "RATE_TOO_LOW", "NO_VISIT_POINTS"];
  const retail = readFileSync(new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url), "utf8");
  const retailFn = retail.slice(retail.indexOf("function earnBlockText"));
  for (const b of blocks) {
    assert.ok(retailFn.slice(0, retailFn.indexOf("\n}")).includes(b), `หน้าค้าปลีกไม่แปลด่าน ${b}`);
  }
  assert.match(retail, /memberPreview\?\.pointsWillEarn != null/);
  // แผงแลกแต้มต้องหายไปเมื่อโปรแกรมปิด — ไม่งั้นเป็นปุ่มที่ server ปฏิเสธเงียบ ๆ
  assert.match(retail, /memberPreview\?\.loyaltyEnabled === false \? null/);

  const rest = readFileSync(new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url), "utf8");
  const restFn = rest.slice(rest.indexOf("function earnBlockText"));
  for (const b of blocks) {
    assert.ok(restFn.slice(0, restFn.indexOf("\n  }")).includes(b), `จอร้านอาหารไม่แปลด่าน ${b}`);
  }
  // ฐานคิดแต้มคือ total_amount ซึ่งไม่รวมยอดปัดเศษ — ส่ง checkoutDue คือสัญญาผิดตัวเลข
  assert.match(rest, /const earnBasisAmount = check\?\.amountDue \?\? null/);
  assert.doesNotMatch(rest, /amount=\$\{encodeURIComponent\(String\(checkoutDue\)\)\}/);
});

test("ทุกด่านมีข้อความครบทั้งไทยและอังกฤษ", () => {
  // ด่านที่ไม่มีคำแปลจะโชว์ชื่อคีย์ดิบบนจอร้าน (getMessage คืนคีย์ตัวเองเมื่อหาไม่เจอ)
  const keys = ["points_will_earn", "points_off_program", "points_off_min_spend", "points_off_rate", "points_off_visit"];
  for (const lang of ["th", "en"]) {
    const src = readFileSync(new URL(`../apps/web/i18n/${lang}.ts`, import.meta.url), "utf8");
    for (const k of keys) assert.ok(src.includes(`${k}:`), `${lang}.ts ขาดคีย์ ${k}`);
  }
});
