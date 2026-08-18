// สัญญาของราคาตามจำนวน (migration 8.1)
//
// เหตุผลเดียวกับ loyalty-contract: จอ POS คิดราคาเพื่อโชว์ยอด แล้ว createOrder
// คิดใหม่ตอน commit · ต่างกันแม้สตางค์เดียว = PAYMENT_MISMATCH แล้วบิลถูกทิ้งทั้งใบ
//
//   node --experimental-strip-types --test scripts/pricing-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

import { priceLinesByQty, unitPriceForQty, type PriceTier } from "../apps/web/lib/bms/pricing.ts";

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

test("จำนวนนับรวมทั้งบิลต่อ SKU ไม่ใช่ต่อบรรทัด", () => {
  // 60ml 5 ขวด + 150ml 5 ขวด = ซื้อสินค้านั้น 10 ชิ้น → ได้ราคาขั้น 10
  const priced = priceLinesByQty(
    [
      { sku: "A", size: "60ML", qty: 5 },
      { sku: "A", size: "150ML", qty: 5 },
    ],
    new Map([["A", 100]]),
    new Map([["A", tiers]])
  );
  assert.equal(priced[0].unitPrice, 80);
  assert.equal(priced[1].unitPrice, 80);
  assert.equal(priced[0].tierApplied, true);
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
