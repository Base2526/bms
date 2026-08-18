// สัญญาของบาร์โค้ด: check digit + ช่วงเลขที่ร้านสร้างเองได้
//
// ทำไมต้องมีเทสชุดนี้: จอกับ server ใช้ checkBarcode ตัวเดียวกัน ถ้าคิด check digit
// ต่างกันจอจะบอกว่าเลขถูกแต่ยิงไม่ติดหน้าร้าน · และเลขที่สร้างเองต้องอยู่ในช่วง
// 20–29 เท่านั้น หลุดออกไปคือไปทับเลขที่ GS1 ออกให้บริษัทอื่นจริง ๆ แล้ววันหนึ่ง
// สินค้านั้นเข้าร้าน จะยิงไปโดนของเราแทน
//
//   node --experimental-strip-types --test scripts/barcode-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkBarcode,
  eanCheckDigit,
  inStoreBarcode,
  isInStoreBarcode,
} from "../apps/web/lib/bms/barcode.ts";

test("check digit ตรงกับตัวเลขจริงที่พิมพ์อยู่บนสินค้า", () => {
  // EAN-13 ที่ใช้อ้างอิงกันทั่วไป
  assert.equal(eanCheckDigit("400638133393"), 1);   // 4006381333931
  assert.equal(eanCheckDigit("978020137962"), 4);   // 9780201379624 (ISBN-13 → EAN-13)
  // EAN-8 — ความยาวคู่ ถ้าไล่น้ำหนัก 3/1 จากซ้ายจะได้ผลผิด
  assert.equal(eanCheckDigit("9638507"), 4);        // 96385074
  // UPC-A
  assert.equal(eanCheckDigit("03600029145"), 2);    // 036000291452
});

test("เลขมาตรฐานที่ถูกต้องต้องผ่าน และรู้ว่าเป็นสัญลักษณ์อะไร", () => {
  assert.deepEqual(checkBarcode("4006381333931"), { kind: "VALID", symbology: "EAN-13" });
  assert.deepEqual(checkBarcode("96385074"), { kind: "VALID", symbology: "EAN-8" });
  assert.deepEqual(checkBarcode("036000291452"), { kind: "VALID", symbology: "UPC-A" });
  assert.deepEqual(checkBarcode("  4006381333931  "), { kind: "VALID", symbology: "EAN-13" });
});

test("พิมพ์ตกหลักเดียวต้องจับได้ พร้อมบอกหลักที่ควรเป็น", () => {
  const res = checkBarcode("4006381333930");
  assert.equal(res.kind, "BAD_CHECK_DIGIT");
  if (res.kind === "BAD_CHECK_DIGIT") {
    assert.equal(res.symbology, "EAN-13");
    assert.equal(res.expected, 1);
  }
});

test("เลขที่ไม่ใช่ความยาวมาตรฐานถือว่าใช้ได้แต่พิมพ์ไม่ได้ — เตือน ไม่บล็อก", () => {
  // เลขแบบที่ร้านเคยกรอกไว้เอง (เช่น 123456) ต้องยังใช้ในระบบได้
  const short = checkBarcode("123456");
  assert.equal(short.kind, "NON_STANDARD");

  // Code 128 จากซัพพลายเออร์มีตัวอักษรได้
  const alpha = checkBarcode("ABC-123");
  assert.equal(alpha.kind, "NON_STANDARD");

  assert.deepEqual(checkBarcode("   "), { kind: "EMPTY" });
});

test("เลขที่สร้างเองต้องเป็น EAN-13 ที่ถูกต้องและอยู่ในช่วงร้านใช้ภายใน", () => {
  const first = inStoreBarcode(1);
  assert.equal(first.length, 13);
  assert.ok(first.startsWith("20"), `ต้องขึ้นต้น 20 ได้ ${first}`);
  assert.deepEqual(checkBarcode(first), { kind: "VALID", symbology: "EAN-13" });
  assert.equal(isInStoreBarcode(first), true);

  // ลำดับต่างกันต้องได้เลขต่างกัน และทุกตัวต้องเป็น EAN-13 ที่ถูกต้อง
  const seen = new Set<string>();
  for (const n of [0, 1, 2, 9, 10, 999, 1000, 123456, 9_999_999_999]) {
    const code = inStoreBarcode(n);
    assert.deepEqual(checkBarcode(code), { kind: "VALID", symbology: "EAN-13" }, `${n} → ${code}`);
    assert.equal(seen.has(code), false, `ซ้ำที่ ${n}`);
    seen.add(code);
  }
});

test("prefix นอกช่วง 20–29 ต้องสร้างไม่ได้", () => {
  assert.equal(inStoreBarcode(1, "29").startsWith("29"), true);
  // 885 = prefix ของไทยที่ GS1 ออกให้บริษัทจริง ห้ามให้ร้านสร้างทับ
  assert.throws(() => inStoreBarcode(1, "88"), /20–29/);
  assert.throws(() => inStoreBarcode(1, "19"), /20–29/);
  assert.throws(() => inStoreBarcode(1, "2"), /20–29/);
  assert.throws(() => inStoreBarcode(-1), /ไม่ติดลบ/);
});

test("บาร์โค้ดของแบรนด์ต้องไม่ถูกนับว่าเป็นเลขที่ร้านสร้างเอง", () => {
  assert.equal(isInStoreBarcode("4006381333931"), false);
  assert.equal(isInStoreBarcode("123456"), false);
  // อยู่ในช่วง 20–29 แต่ check digit ผิด = ไม่นับ (เลขที่ยิงไม่ติดอยู่ดี)
  assert.equal(isInStoreBarcode("2000000000010"), false);
});
