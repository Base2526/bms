// =============================================================
// โปรโมชันแยกสาขา (migration 9.61) — สัญญาที่ไม่ต้องมีฐานข้อมูล
// -------------------------------------------------------------
// 8.7 ทำโปรไว้ระดับร้านล้วน · 9.61 เพิ่ม location_id ให้สาขาตั้งโปรของตัวเองได้
//
// เทสนี้ตรึงสองอย่างที่พังเงียบได้:
//
//   1. กติกา "ใครชนะ" ต้องมีสูตรเดียว — จอ POS พรีวิวราคาด้วย resolvePosScan แล้ว
//      createOrder คิดใหม่ตอน commit · ถ้าสองฝั่งเลือกโปรคนละแถว ยอดต่างกัน แล้วบิล
//      ถูกทิ้งทั้งใบด้วย PAYMENT_MISMATCH โดยหน้าเคาน์เตอร์ไม่รู้สาเหตุ
//   2. เส้นทางอ่านทั้งสองต้องกรองสาขาจริง ๆ — ลืมกรองที่ใดที่หนึ่ง = สาขาหนึ่งขาย
//      ด้วยโปรของอีกสาขา ซึ่งเป็นความเสียหายที่ร้านอธิบายลูกค้าไม่ได้
//
//   node --experimental-strip-types --test scripts/promotion-branch-scope-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  applyPromotion,
  pickPriceTiersForLocation,
  pickPromotionForLocation,
  type Promotion,
  type ScopedPromotion,
} from "../apps/web/lib/bms/pricing.ts";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";

const threeForHundred: Promotion = { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 100 };
const buyTwoGetOne: Promotion = { kind: "BUY_X_GET_Y", buyQty: 2, getQty: 1 };

const storeWide: ScopedPromotion = { locationId: null, promotion: threeForHundred };
const branchADeal: ScopedPromotion = { locationId: BRANCH_A, promotion: buyTwoGetOne };

/** ตัดคอมเมนต์ก่อนสแกนซอร์สเสมอ — คอมเมนต์ที่อธิบายกฎเก่าเคยทำให้ assertion เขียวผิดตัวมาแล้ว */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const read = (path: string) => withoutComments(readFileSync(new URL(path, import.meta.url), "utf8"));

test("โปรของสาขาทับโปรทั้งร้านของสินค้าตัวเดียวกัน", () => {
  assert.deepEqual(pickPromotionForLocation([storeWide, branchADeal], BRANCH_A), buyTwoGetOne);
  // ลำดับแถวที่ Postgres คืนมาไม่มีการรับประกัน — ผลต้องเหมือนกันทั้งสองลำดับ
  assert.deepEqual(pickPromotionForLocation([branchADeal, storeWide], BRANCH_A), buyTwoGetOne);
});

test("สาขาที่ไม่ได้ตั้งโปรเอง ยังได้โปรของทั้งร้าน", () => {
  assert.deepEqual(pickPromotionForLocation([storeWide, branchADeal], BRANCH_B), threeForHundred);
});

test("สาขาที่ตั้งโปรเองโดยไม่มีโปรทั้งร้าน ก็ยังได้โปรของตัวเอง", () => {
  assert.deepEqual(pickPromotionForLocation([branchADeal], BRANCH_A), buyTwoGetOne);
});

test("ไม่รู้ว่าขายที่สาขาไหน ต้องไม่หยิบโปรรายสาขามาใช้", () => {
  // เดาสาขาแล้วคิดเงินผิด แย่กว่าไม่ลดให้ — เส้นทางที่ไม่มีสาขาได้แค่โปรทั้งร้าน
  assert.deepEqual(pickPromotionForLocation([storeWide, branchADeal], null), threeForHundred);
  assert.equal(pickPromotionForLocation([branchADeal], null), null);
  assert.equal(pickPromotionForLocation([branchADeal], undefined), null);
});

test("ไม่มีโปรเลย = ไม่มีโปร ไม่ใช่หยิบของสาขาอื่น", () => {
  assert.equal(pickPromotionForLocation([], BRANCH_A), null);
  assert.equal(pickPromotionForLocation([{ locationId: BRANCH_B, promotion: buyTwoGetOne }], BRANCH_A), null);
});

test("โปรที่เลือกได้ ถูกส่งต่อเข้าสูตรราคาเดิมของ 8.7 ไม่ใช่สูตรใหม่", () => {
  const picked = pickPromotionForLocation([storeWide, branchADeal], BRANCH_A);
  // ซื้อ 2 แถม 1 · หยิบ 3 ชิ้นราคาป้าย 40 → จ่าย 2 ชิ้น = 80
  assert.deepEqual(applyPromotion(40, 3, picked), { amount: 80, freeQty: 1, saved: 40 });
  // สาขาอื่นได้ 3 ชิ้น 100 จากตะกร้าเดียวกันเป๊ะ — นี่คือสิ่งที่ 9.61 ทำให้เป็นไปได้
  const other = pickPromotionForLocation([storeWide, branchADeal], BRANCH_B);
  assert.deepEqual(applyPromotion(40, 3, other), { amount: 100, freeQty: 0, saved: 20 });
});

test("เส้นทางอ่านทั้งสองกรองสาขา และตัดสินด้วยฟังก์ชันตัวเดียวกัน", () => {
  const orders = read("../apps/web/lib/bms/orders.ts");
  const pos = read("../apps/web/lib/bms/pos.ts");

  for (const [name, source] of [["orders.ts", orders], ["pos.ts", pos]] as const) {
    const promoQuery = source.slice(source.indexOf("FROM bms_product_promotions"));
    assert.ok(
      /location_id IS NULL OR location_id = \$\d/.test(promoQuery.slice(0, 400)),
      `${name} อ่านโปรโดยไม่กรองสาขา — สาขาหนึ่งจะขายด้วยโปรของอีกสาขา`
    );
    assert.ok(
      source.includes("pickPromotionForLocation("),
      `${name} ต้องเลือกโปรด้วย pickPromotionForLocation() ไม่ใช่เขียนกติกาของตัวเอง`
    );
  }

  // `LIMIT 1` ของเดิมใช้ไม่ได้แล้ว: SKU เดียวมีได้สองแถว (ทั้งร้าน + สาขานี้)
  // แถวที่ได้จะขึ้นกับลำดับที่ Postgres บังเอิญคืนมา = โปรสลับกันเองแบบสุ่ม
  const posPromoQuery = pos.slice(pos.indexOf("FROM bms_product_promotions"));
  assert.ok(
    !/LIMIT 1/.test(posPromoQuery.slice(0, 400)),
    "pos.ts ยังตัดผลโปรด้วย LIMIT 1 — แถวที่ได้กลายเป็นเรื่องบังเอิญ"
  );
});

test("migration 9.61 คงกฎ 'หนึ่งโปร active ต่อขอบเขต' ไว้ทั้งสองขอบเขต", () => {
  const sql = readFileSync(
    new URL("../db/migrations/9.61__bms_product_promotions_branch_scope.sql", import.meta.url),
    "utf8"
  );
  // ดัชนีเดิมครอบทั้งร้าน ถ้าไม่ทิ้ง สาขาที่สองจะตั้งโปรของตัวเองไม่ได้เลย
  assert.ok(/DROP INDEX IF EXISTS uq_bms_promotions_active_sku\b/.test(sql));
  assert.ok(/uq_bms_promotions_active_sku_store[\s\S]*WHERE active AND location_id IS NULL/.test(sql));
  assert.ok(/uq_bms_promotions_active_sku_branch[\s\S]*WHERE active AND location_id IS NOT NULL/.test(sql));
  // FK แบบ composite: โปรของร้าน A ชี้ไปสาขาของร้าน B ไม่ได้โดยโครงสร้าง
  assert.ok(/FOREIGN KEY \(tenant_id, location_id\)[\s\S]*REFERENCES bms_locations \(tenant_id, id\)/.test(sql));
});


// ---------------------------------------------------------------------------
// 9.65 — บันไดราคาส่งแยกสาขา
// ---------------------------------------------------------------------------

test("บันไดของสาขาแทนที่บันไดของทั้งร้านทั้งชุด ไม่ใช่ผสมขั้นกัน", () => {
  const store = [
    { locationId: null, minQty: 5, scope: "PER_VARIANT_FIXED" as const, size: null, unitPrice: 90, discountPct: null },
    { locationId: null, minQty: 10, scope: "PER_VARIANT_FIXED" as const, size: null, unitPrice: 80, discountPct: null },
  ];
  const branch = [
    { locationId: "loc-1", minQty: 10, scope: "PER_VARIANT_FIXED" as const, size: null, unitPrice: 70, discountPct: null },
  ];
  const all = [...store, ...branch];

  const atBranch = pickPriceTiersForLocation(all, "loc-1");
  assert.deepEqual(atBranch.map((tier) => tier.minQty), [10],
    "ขั้น 5 ชิ้นของส่วนกลางต้องไม่แทรกเข้าบันไดของสาขา — บันไดที่ไม่มีใครตั้งไว้อธิบายไม่ได้");
  assert.equal(atBranch[0].unitPrice, 70);

  assert.deepEqual(pickPriceTiersForLocation(all, "loc-2").map((tier) => tier.minQty), [5, 10],
    "สาขาที่ไม่ได้ตั้งเองต้องใช้บันไดของทั้งร้าน");
  assert.deepEqual(pickPriceTiersForLocation(all, null).map((tier) => tier.minQty), [5, 10],
    "ไม่รู้ว่าขายที่สาขาไหน = ใช้บันไดรายสาขาไม่ได้ (เดาสาขาแล้วคิดเงินผิดแย่กว่าไม่ลด)");
  assert.deepEqual(pickPriceTiersForLocation(branch, "loc-2"), [],
    "สาขาอื่นต้องไม่ได้บันไดของ loc-1 มาแม้จะไม่มีของส่วนกลางเลย");
  // ผลที่คืนต้องเป็น PriceTier ล้วน ไม่ติด locationId ไปให้ unitPriceForQty ตีความ
  assert.ok(!("locationId" in (atBranch[0] as Record<string, unknown>)));
});

test("ทั้งจอพรีวิวและตอน commit ต้องเลือกบันไดด้วยฟังก์ชันตัวเดียวกัน", () => {
  const pos = readFileSync(new URL("../apps/web/lib/bms/pos.ts", import.meta.url), "utf8");
  const orders = readFileSync(new URL("../apps/web/lib/bms/orders.ts", import.meta.url), "utf8");
  for (const [name, src] of [["pos.ts", pos], ["orders.ts", orders]] as const) {
    assert.ok(/pickPriceTiersForLocation\(/.test(src),
      `${name} ต้องเลือกบันไดผ่าน pickPriceTiersForLocation — สองสูตรจะ drift แล้วจอกับ server คิดคนละยอด`);
    const tierQuery = src.slice(src.indexOf("FROM bms_product_price_tiers"));
    assert.ok(/location_id IS NULL OR location_id = /.test(tierQuery.slice(0, 400)),
      `${name} ต้องอ่านทั้งบันไดของทั้งร้านและของสาขาที่กำลังขาย`);
  }
  // ฟอร์มสินค้าแก้เฉพาะบันไดของทั้งร้าน — ไม่กรองสาขาตอนลบ = ล้างบันไดของทุกสาขาเงียบ ๆ
  const products = readFileSync(new URL("../apps/web/lib/bms/products.ts", import.meta.url), "utf8");
  const del = products.slice(products.indexOf("DELETE FROM bms_product_price_tiers"));
  assert.ok(/location_id IS NULL/.test(del.slice(0, 200)),
    "upsertProduct ต้องลบเฉพาะบันไดของทั้งร้าน");
});

test("migration 9.65 ให้สาขาตั้งขั้นที่จำนวนเดียวกับส่วนกลางได้", () => {
  const sql = readFileSync(
    new URL("../db/migrations/9.65__bms_product_price_tiers_branch_scope.sql", import.meta.url),
    "utf8"
  );
  // คีย์เดิมไม่มีสาขา สาขาจึงตั้งขั้นที่ min_qty เดียวกับของส่วนกลางไม่ได้เลย
  assert.ok(/DROP INDEX IF EXISTS uq_bms_product_price_tiers_rule\b/.test(sql));
  assert.ok(/COALESCE\(location_id, '00000000-0000-0000-0000-000000000000'::uuid\)/.test(sql),
    "NULL ไม่ชนกับ NULL ใน unique index — ต้องแทนด้วยค่าที่เทียบกันได้");
  assert.ok(/FOREIGN KEY \(tenant_id, location_id\)[\s\S]*REFERENCES bms_locations \(tenant_id, id\)/.test(sql));
});
