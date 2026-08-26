// สัญญาของราคาตามจำนวน (migration 8.1)
//
// เหตุผลเดียวกับ loyalty-contract: จอ POS คิดราคาเพื่อโชว์ยอด แล้ว createOrder
// คิดใหม่ตอน commit · ต่างกันแม้สตางค์เดียว = PAYMENT_MISMATCH แล้วบิลถูกทิ้งทั้งใบ
//
//   node --experimental-strip-types --test scripts/pricing-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPriceTiers,
  isFixedPricePack,
  normalizePackCode,
  normalizePricingSnapshot,
  priceLinesByQty,
  priceRemainingLines,
  syncSkuPricingSnapshot,
  unitPriceForQty,
  type PriceTier,
} from "../apps/web/lib/bms/pricing.ts";

test("คืนแล้วต่ำกว่าขั้นราคาส่ง ต้องตีราคาของที่เหลือกลับเป็นราคาป้าย", () => {
  const result = priceRemainingLines([{
    id: 1, sku: "A", size: "XL", qty: 5, packQty: 5, returnedPackQty: 0,
    receiptUnitPrice: 100, packUnitPrice: null,
    pricingSnapshot: {
      priceTiers: [{ minQty: 5, scope: "CROSS_VARIANT_PERCENT", discountPct: 10 }],
      promotion: null,
    },
  }], new Map([[1, 1]]));

  assert.equal(result.pricingSubtotal, 400,
    "เหลือ 4 ไม่ครบขั้นต่ำ 5 ต้องเป็น 4 × 100 ไม่ใช่ 4 × 90");
  assert.equal(result.pricingDiscount, 0);
});

test("คืนแล้วยังครบขั้นที่ต่ำกว่า ต้องลดระดับราคาส่งตาม snapshot ตอนขาย", () => {
  const result = priceRemainingLines([{
    id: 1, sku: "A", size: "M", qty: 10, packQty: 10, returnedPackQty: 0,
    receiptUnitPrice: 100, packUnitPrice: null,
    pricingSnapshot: {
      priceTiers: [{ minQty: 5, unitPrice: 90 }, { minQty: 10, unitPrice: 80 }],
      promotion: null,
    },
  }], new Map([[1, 3]]));

  assert.equal(result.pricingSubtotal, 630, "เหลือ 7 ต้องใช้ขั้น 5 ที่ 90");
  assert.equal(result.pricingDiscount, 70);
});

test("pricing snapshot ผิดรูปถูกลดเหลือกติกาที่ปลอดภัย", () => {
  assert.deepEqual(normalizePricingSnapshot({
    priceTiers: [
      { minQty: 1, unitPrice: -1 },
      { minQty: 5, scope: "CROSS_VARIANT_PERCENT", discountPct: 10 },
    ],
    promotion: { kind: "N_FOR_PRICE", buyQty: 0, bundlePrice: -10 },
  }), {
    priceTiers: [{
      minQty: 5,
      scope: "CROSS_VARIANT_PERCENT",
      size: null,
      unitPrice: null,
      discountPct: 10,
    }],
    promotion: null,
  });
});

test("BASE remains eligible for wholesale and promotions; named packs keep their fixed price", () => {
  assert.equal(normalizePackCode(undefined), "BASE");
  assert.equal(normalizePackCode(" base "), "BASE");
  assert.equal(normalizePackCode(" box-3 "), "BOX-3");
  assert.equal(isFixedPricePack("BASE"), false);
  assert.equal(isFixedPricePack(" base "), false);
  assert.equal(isFixedPricePack(null), false);
  assert.equal(isFixedPricePack("BOX"), true);
  assert.equal(isFixedPricePack("SINGLE-GIFT"), true,
    "a named pack stays fixed-price even when its base quantity is one");
});

const tiers: PriceTier[] = [
  { minQty: 3, unitPrice: 90 },
  { minQty: 10, unitPrice: 80 },
  { minQty: 50, unitPrice: 70 },
];

test("ขั้นที่สูงสุดที่ไม่เกินจำนวนที่ซื้อชนะ", () => {
  assert.equal(unitPriceForQty(100, tiers, 1), 100);
  assert.equal(unitPriceForQty(100, tiers, 2), 100);
  assert.equal(unitPriceForQty(100, tiers, 3), 90, "ครบขั้นพอดีต้องได้ราคาขั้นนั้น");
  assert.equal(unitPriceForQty(100, tiers, 9), 90);
  assert.equal(unitPriceForQty(100, tiers, 10), 80);
  assert.equal(unitPriceForQty(100, tiers, 49), 80);
  assert.equal(unitPriceForQty(100, tiers, 1000), 70);
});

test("ไม่มีขั้น หรือจำนวนไม่ถูกต้อง = ราคาปกติ", () => {
  assert.equal(unitPriceForQty(100, [], 99), 100);
  assert.equal(unitPriceForQty(100, tiers, 0), 100);
  assert.equal(unitPriceForQty(100, tiers, -5), 100);
  assert.equal(unitPriceForQty(100, tiers, Number.NaN), 100);
});

test("ลำดับที่ใส่ขั้นมาต้องไม่มีผลกับคำตอบ", () => {
  const shuffled = [tiers[2], tiers[0], tiers[1]];
  for (const q of [1, 3, 10, 50, 77]) {
    assert.equal(unitPriceForQty(100, shuffled, q), unitPriceForQty(100, tiers, q), `qty ${q}`);
  }
});

test("ขั้นที่ต่ำกว่า 2 ถูกเมิน — 1 ชิ้นคือราคาปกติเสมอ", () => {
  assert.equal(unitPriceForQty(100, [{ minQty: 1, unitPrice: 10 }], 5), 100);
  assert.equal(unitPriceForQty(100, [{ minQty: 0, unitPrice: 10 }], 5), 100);
});

test("ขั้นสูงที่แพงกว่าขั้นต่ำต้องถูกใช้ตามที่ตั้งไว้ ไม่ใช่ถูก 'แก้ให้'", () => {
  // ร้านที่คิดเพิ่มเมื่อซื้อยกลัง (ต้องแพ็กพิเศษ) ตั้งใจจริง — หน้าที่ของฟังก์ชันนี้
  // คือคาดเดาได้ ไม่ใช่เดาเจตนาแล้วเลือกราคาที่ถูกที่สุดให้เอง
  const odd: PriceTier[] = [{ minQty: 3, unitPrice: 90 }, { minQty: 10, unitPrice: 120 }];
  assert.equal(unitPriceForQty(100, odd, 12), 120);
});

test("ราคาและจำนวนนับแยกต่อ SKU+ไซซ์", () => {
  const priced = priceLinesByQty(
    [
      { sku: "A", size: "60ML", qty: 5 },
      { sku: "A", size: "150ML", qty: 5 },
    ],
    new Map([["A\u000060ML", 100], ["A\u0000150ML", 200]]),
    new Map([["A", tiers]])
  );
  assert.equal(priced[0].unitPrice, 90, "60ML จำนวน 5 ได้ขั้น 3");
  assert.equal(priced[1].unitPrice, 90, "150ML จำนวน 5 ได้ขั้น 3 โดยไม่เอาราคา 60ML มาปน");
  assert.equal(priced[0].tierApplied, true);
});

test("ราคาส่งคงที่กำหนดคนละราคาต่อไซซ์ที่ขั้นต่ำเดียวกันได้", () => {
  const sizedTiers: PriceTier[] = [
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "M", unitPrice: 80 },
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "XL", unitPrice: 120 },
  ];
  const priced = priceLinesByQty(
    [
      { sku: "SHIRT", size: "M", qty: 5 },
      { sku: "SHIRT", size: "XL", qty: 5 },
    ],
    new Map([
      ["SHIRT\u0000M", 100],
      ["SHIRT\u0000XL", 150],
    ]),
    new Map([["SHIRT", sizedTiers]])
  );

  assert.equal(priced[0].unitPrice, 80);
  assert.equal(priced[1].unitPrice, 120);
});

test("กฎเฉพาะไซซ์ชนะกฎทุกไซซ์เมื่อขั้นต่ำเท่ากันโดยไม่ขึ้นกับลำดับแถว", () => {
  const rules: PriceTier[] = [
    { minQty: 5, scope: "PER_VARIANT_FIXED", unitPrice: 90 },
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "XL", unitPrice: 125 },
  ];

  assert.equal(unitPriceForQty(150, rules, 5, 5, "XL"), 125);
  assert.equal(unitPriceForQty(100, [...rules].reverse(), 5, 5, "M"), 90);
});

test("signature ของกฎหลายไซซ์คงที่แม้ DB คืนแถวขั้นต่ำเดียวกันคนละลำดับ", () => {
  const rules: PriceTier[] = [
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "XL", unitPrice: 120 },
    { minQty: 5, scope: "PER_VARIANT_FIXED", size: "M", unitPrice: 80 },
  ];
  assert.deepEqual(canonicalPriceTiers(rules), canonicalPriceTiers([...rules].reverse()));
});

test("รวมข้ามไซซ์เพื่อผ่านขั้นต่ำ แต่ลดเปอร์เซ็นต์จากราคาของแต่ละไซซ์", () => {
  const crossSizeTiers: PriceTier[] = [{
    minQty: 10,
    scope: "CROSS_VARIANT_PERCENT",
    discountPct: 20,
    unitPrice: null,
  }];
  const priced = priceLinesByQty(
    [
      { sku: "A", size: "S", qty: 4 },
      { sku: "A", size: "M", qty: 3 },
      { sku: "A", size: "L", qty: 3 },
    ],
    new Map([["A\u0000S", 10], ["A\u0000M", 12], ["A\u0000L", 15]]),
    new Map([["A", crossSizeTiers]])
  );
  assert.deepEqual(priced.map((line) => line.unitPrice), [8, 9.6, 12]);
  assert.equal(priced.reduce((sum, line) => sum + line.unitPrice * line.qty, 0), 96.8);
});

test("รวมข้ามไซซ์ไม่ถึงขั้นต่ำยังใช้ราคาปกติ และเปอร์เซ็นต์ผิดรูปไม่ถูกใช้", () => {
  assert.equal(unitPriceForQty(12, [{ minQty: 10, scope: "CROSS_VARIANT_PERCENT", discountPct: 20 }], 3, 9), 12);
  assert.equal(unitPriceForQty(12, [{ minQty: 10, scope: "CROSS_VARIANT_PERCENT", discountPct: 0 }], 3, 10), 12);
  assert.equal(unitPriceForQty(12, [{ minQty: 10, scope: "CROSS_VARIANT_PERCENT", discountPct: 101 }], 3, 10), 12);
});

test("เปอร์เซ็นต์ 4 ตำแหน่งแปลงราคา 1,500 เป็น 1,300 ได้ตรงสตางค์", () => {
  assert.equal(unitPriceForQty(1_500, [{
    minQty: 5,
    scope: "CROSS_VARIANT_PERCENT",
    discountPct: 13.3333,
  }], 2, 5), 1_300);
});

test("scan ไซซ์ล่าสุดเปลี่ยน pricing snapshot ของ SKU เดียวกันทุกไซซ์", () => {
  const oldTier: PriceTier[] = [{ minQty: 5, unitPrice: 1_300 }];
  const latestTier: PriceTier[] = [{
    minQty: 10,
    scope: "CROSS_VARIANT_PERCENT",
    discountPct: 16.6667,
  }];
  const lines = [
    { sku: "LANVIN", size: "M", priceTiers: oldTier, promotion: null },
    { sku: "LANVIN", size: "XL", priceTiers: oldTier, promotion: null },
    { sku: "OTHER", size: "S", priceTiers: oldTier, promotion: null },
  ];

  const synced = syncSkuPricingSnapshot(lines, {
    sku: "LANVIN",
    priceTiers: latestTier,
    promotion: { kind: "BUY_X_GET_Y", buyQty: 3, getQty: 1 },
    serialTracked: true,
  });

  assert.equal(synced[0].priceTiers, latestTier);
  assert.equal(synced[1].priceTiers, latestTier);
  assert.deepEqual(synced[0].promotion, { kind: "BUY_X_GET_Y", buyQty: 3, getQty: 1 });
  assert.equal(synced[0].serialTracked, true);
  assert.equal(synced[2], lines[2], "SKU อื่นต้องไม่ถูกแก้ snapshot");
});

test("สินค้าคนละ SKU ไม่รวมจำนวนกัน", () => {
  const priced = priceLinesByQty(
    [
      { sku: "A", qty: 5 },
      { sku: "B", qty: 5 },
    ],
    new Map([["A", 100], ["B", 100]]),
    new Map([["A", tiers], ["B", tiers]])
  );
  assert.equal(priced[0].unitPrice, 90, "5 ชิ้นได้ขั้น 3 ไม่ใช่ขั้น 10");
  assert.equal(priced[1].unitPrice, 90);
});

test("บรรทัดที่ขายเป็นหน่วยขาย (pack) ไม่ถูกแตะ แต่จำนวนยังนับรวม", () => {
  const priced = priceLinesByQty(
    [
      { sku: "A", qty: 10, packUnitPrice: 850 },   // ยกกล่อง — ราคา pack ชนะ
      { sku: "A", qty: 2 },                         // ซื้อแยกอีก 2
    ],
    new Map([["A", 100]]),
    new Map([["A", tiers]])
  );
  assert.equal(priced[0].tierApplied, false, "pack ต้องไม่ถูกขั้นราคาแก้");
  assert.equal(priced[0].unitPrice, 100, "unit_price ของบรรทัด pack ยังเป็นราคาต่อหน่วยฐานตามเดิม");
  // รวมทั้งบิล 12 ชิ้น → บรรทัดที่ขายแยกได้ขั้น 10
  assert.equal(priced[1].unitPrice, 80);
});

// ---- โปรโมชัน ซื้อ X แถม Y / N ชิ้นราคาเดียว (8.7) --------------------
// โปรเป็นกลไก "ราคาของกลุ่มชิ้น" ไม่ใช่ส่วนลดชั้นที่ 5 — จึงไม่ถูกตัดด้วยเพดาน
// max_discount_pct ของบิล · เทสชุดนี้ล็อกเลขคณิตที่จอกับ createOrder ใช้ร่วมกัน

import { applyPromotion, type Promotion } from "../apps/web/lib/bms/pricing.ts";

const bogo: Promotion = { kind: "BUY_X_GET_Y", buyQty: 3, getQty: 1 };
const threeFor100: Promotion = { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 100 };

test("ซื้อ 3 แถม 1 — จ่ายเฉพาะชิ้นที่ไม่ฟรี และเศษจ่ายเต็ม", () => {
  // ยังไม่ครบชุด
  assert.deepEqual(applyPromotion(40, 3, bogo), { amount: 120, freeQty: 0, saved: 0 });
  // ครบชุดแรก (4 ชิ้น = จ่าย 3)
  assert.deepEqual(applyPromotion(40, 4, bogo), { amount: 120, freeQty: 1, saved: 40 });
  // 7 ชิ้น = ครบชุดเดียว เหลือเศษ 3 จ่ายเต็ม → จ่าย 6 ชิ้น
  assert.deepEqual(applyPromotion(40, 7, bogo), { amount: 240, freeQty: 1, saved: 40 });
  // 8 ชิ้น = ครบสองชุด → จ่าย 6 ชิ้น
  assert.deepEqual(applyPromotion(40, 8, bogo), { amount: 240, freeQty: 2, saved: 80 });
});

test("3 ชิ้น 100 — เศษที่ไม่ครบชุดจ่ายราคาเต็มต่อชิ้น", () => {
  assert.deepEqual(applyPromotion(40, 2, threeFor100), { amount: 80, freeQty: 0, saved: 0 });
  assert.deepEqual(applyPromotion(40, 3, threeFor100), { amount: 100, freeQty: 0, saved: 20 });
  assert.deepEqual(applyPromotion(40, 4, threeFor100), { amount: 140, freeQty: 0, saved: 20 });
  assert.deepEqual(applyPromotion(40, 6, threeFor100), { amount: 200, freeQty: 0, saved: 40 });
});

test("โปรที่แพงกว่าซื้อแยกต้องไม่ถูกบังคับใช้", () => {
  // ร้านลดราคาปกติลงมาเหลือ 30 แต่ยังตั้งโปร 3 ชิ้น 100 ค้างอยู่
  // ซื้อแยก 3 ชิ้น = 90 ซึ่งถูกกว่าราคาชุด · เก็บลูกค้า 100 เพราะ "โปร" คือความ
  // เสียหายที่ร้านอธิบายไม่ได้ · ต้องเลือกยอดที่ต่ำกว่าเสมอ
  assert.deepEqual(applyPromotion(30, 3, threeFor100), { amount: 90, freeQty: 0, saved: 0 });
});

test("ไม่มีโปร หรือค่าที่ไม่สมเหตุสมผล = ราคาเต็ม", () => {
  assert.deepEqual(applyPromotion(40, 5, null), { amount: 200, freeQty: 0, saved: 0 });
  assert.deepEqual(applyPromotion(40, 0, bogo), { amount: 0, freeQty: 0, saved: 0 });
  assert.deepEqual(
    applyPromotion(40, 5, { kind: "N_FOR_PRICE", buyQty: 0, bundlePrice: 10 }),
    { amount: 200, freeQty: 0, saved: 0 }
  );
});

test("แถมฟรีทั้งหมดได้ ถ้าร้านตั้งอย่างนั้นจริง", () => {
  // ซื้อ 1 แถม 1 · หยิบ 2 → จ่าย 1
  assert.deepEqual(
    applyPromotion(50, 2, { kind: "BUY_X_GET_Y", buyQty: 1, getQty: 1 }),
    { amount: 50, freeQty: 1, saved: 50 }
  );
  // และ 3 ชิ้น 0 บาท (แจกฟรี) ต้องได้ 0 ไม่ใช่ถูกปฏิเสธเพราะ "ถูกกว่าไม่ได้"
  assert.deepEqual(
    applyPromotion(50, 3, { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 0 }),
    { amount: 0, freeQty: 0, saved: 150 }
  );
});
