// สัญญาของการแยกแยะ "ขอซื้อสินค้า" กับ "ขอให้เภสัชกรประเมินอาการ"
//
// ทำไมต้องมีชุดนี้: เส้นแบ่งนี้คือประตูที่ตัดสินว่าข้อความหนึ่งจะไปเส้นทาง catalog
// (ขายได้) หรือเข้าคิวเภสัชกร ถ้าเส้นเลื่อนไปทางขายง่ายขึ้น ระบบจะเริ่มหยิบยาให้คน
// ที่กำลังเล่าอาการ ซึ่งเป็นการตัดสินใจทางคลินิกที่ AI ห้ามทำ
//
// รันด้วย tsx ไม่ใช่ node --experimental-strip-types เพราะ trigger.ts import
// ../requestedItems แบบไม่มีนามสกุล (node จะ resolve ไม่เจอ) · ไม่ต้องมี DB
//
//   cd apps/web && npx tsx --test ../../scripts/pharmacy-trigger-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

import {
  isExplicitPharmacyProductRequest,
  normalizePharmacyProductSearchText,
} from "../apps/web/lib/bms/pharmacy/trigger.ts";

test('"อยากได้"/"ต้องการ" ต้องนับเป็นการขอซื้อสินค้า (ช่องที่หลุดมาก่อน)', () => {
  // ก่อนแก้ verb list มีแค่ ขอซื้อ|ต้องการซื้อ|อยากซื้อ|ขอสั่ง|สั่งซื้อ|เอา|รับ|มี|ขาย|หา
  // ทำให้ข้อความที่คนไทยพิมพ์บ่อยที่สุดไม่เคยเข้าเส้นทาง catalog เลย
  assert.equal(isExplicitPharmacyProductRequest("อยากได้ พารา 1 แผง"), true);
  assert.equal(isExplicitPharmacyProductRequest("ต้องการ พารา 1 แผง"), true);
  assert.equal(
    isExplicitPharmacyProductRequest("อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด"),
    true
  );
});

test("คำขอเดิมต้องไม่พัง", () => {
  assert.equal(isExplicitPharmacyProductRequest("ขอซื้อ พารา"), true);
  assert.equal(isExplicitPharmacyProductRequest("อยากซื้อ พารา"), true);
  assert.equal(isExplicitPharmacyProductRequest("มี ยาแดง ไหม"), true);
});

test("อาการ + ยาที่ไม่ระบุชื่อ ยังต้องไม่ถือเป็นการขอซื้อ — ห้ามคลายข้อนี้", () => {
  // ข้อความแบบนี้ต้องถามกลับ/ให้เภสัชกรประเมิน ไม่ใช่ไปหยิบยาให้
  // (ตอนแรกผมเข้าใจผิดว่านี่คือบั๊ก "ทิ้งรายการที่เหลือ" — ไม่ใช่ มันคือการกันไว้)
  assert.equal(isExplicitPharmacyProductRequest("อยากได้ ยาแก้ไอ ให้ลูก 1 ขวด"), false);
  assert.equal(isExplicitPharmacyProductRequest("อยากได้ ยาแก้ท้องเสีย"), false);
  assert.equal(isExplicitPharmacyProductRequest("ต้องการ ยาแก้ไข้"), false);
});

test("named product หนึ่งบรรทัดห้ามพา generic symptom medicine อีกบรรทัดข้าม intake", () => {
  assert.equal(
    isExplicitPharmacyProductRequest("อยากได้ พารา 1 แผง, ยาแก้ไอให้ลูก 1 ขวด"),
    false
  );
  assert.equal(
    isExplicitPharmacyProductRequest("อยากได้ ยาแดง 1 ขวด, ยาแก้ท้องเสียให้เด็ก"),
    false
  );
});

test("ข้อความที่ไม่มีคำขอเลยไม่ถือเป็นการขอซื้อ", () => {
  assert.equal(isExplicitPharmacyProductRequest("ปวดหัวมาก"), false);
  assert.equal(isExplicitPharmacyProductRequest(""), false);
});

test("ตัดคำขอ/จำนวน/หน่วยออกจากชื่อที่เอาไปค้น แต่เก็บความแรงไว้", () => {
  // ความแรง/ปริมาตรคือตัวระบุสินค้า ตัดออกแล้วจะค้นเจอตัวผิด
  assert.equal(normalizePharmacyProductSearchText("อยากได้ พารา 500mg 2 แผง"), "พารา 500mg");
  assert.equal(normalizePharmacyProductSearchText("ต้องการ ยาแดง 1 ขวด"), "ยาแดง");
  assert.equal(normalizePharmacyProductSearchText("ขอซื้อ พารา 1 แผง"), "พารา");
});
