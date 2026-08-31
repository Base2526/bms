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
  // 21/22 belong to the scale (9.41). Minting a piece-goods barcode there means its middle five
  // digits can collide with a configured scale item code, and the register would read that piece
  // as a weighed product with a weight taken from its own barcode — a wrong price that looks right.
  assert.throws(() => inStoreBarcode(1, "21"), /เครื่องชั่ง/);
  assert.throws(() => inStoreBarcode(1, "22"), /เครื่องชั่ง/);
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

// ---- การวาดแท่ง EAN (lib/pos/barcode.ts) ------------------------------
// สติกเกอร์ที่วาดผิดคือความเสียหายที่รู้ตอนยืนอยู่หน้าลูกค้าแล้ว เพราะร้านแปะไป
// ทั้งล็อตก่อนจะมีใครลองยิง

import { eanBars } from "../apps/web/lib/pos/barcode.ts";

test("EAN-13 ต้องได้ 95 โมดูลเสมอ และปฏิเสธเลขที่ยิงไม่ติด", () => {
  const r = eanBars("4006381333931");
  assert.ok(r, "เลขที่ถูกต้องต้องวาดได้");
  assert.equal(r!.width, 95, "EAN-13 กว้าง 95 โมดูลตายตัว");
  assert.deepEqual(r!.humanReadable, { lead: "4", left: "006381", right: "333931" });

  // check digit ผิด = ไม่วาด · ปล่อยให้วาดคือร้านแปะสติกเกอร์ที่สแกนไม่ผ่านทั้งล็อต
  assert.equal(eanBars("4006381333930"), null);
  assert.equal(eanBars("123456"), null);
  assert.equal(eanBars("ABC1234567890"), null);
});

test("EAN-8 ก็วาดได้ และกว้าง 67 โมดูล", () => {
  const r = eanBars("96385074");
  assert.ok(r);
  assert.equal(r!.width, 67);
  assert.deepEqual(r!.humanReadable, { lead: "", left: "9638", right: "5074" });
});

test("แท่ง guard ต้องถูกทำเครื่องหมายไว้ หัว-กลาง-ท้าย", () => {
  const r = eanBars("4006381333931")!;
  // guard หัว 2 แท่ง + กลาง 2 แท่ง + ท้าย 2 แท่ง
  assert.equal(r.guardBarIndexes.length, 6);
  // แท่งแรกสุดและแท่งสุดท้ายต้องเป็น guard
  assert.equal(r.guardBarIndexes[0], 0);
  assert.equal(r.guardBarIndexes[r.guardBarIndexes.length - 1], r.bars.length - 1);
});

test("เลขที่ปุ่มสร้างให้ ต้องวาดเป็นสติกเกอร์ได้ทุกตัว", () => {
  // ถ้าข้อนี้พัง แปลว่าปุ่ม generate ออกเลขที่พิมพ์ไม่ได้ ซึ่งทำให้ปุ่มไร้ประโยชน์
  for (const n of [0, 1, 7, 42, 999, 123456, 9_999_999_999]) {
    const code = inStoreBarcode(n);
    const r = eanBars(code);
    assert.ok(r, `วาดไม่ได้: ${code}`);
    assert.equal(r!.width, 95);
  }
});

test("ลายแท่งของ EAN-13 ต้องตรงกับมาตรฐานทีละบิต", () => {
  // 4006381333931 · หลักแรก 4 → parity ของ 6 หลักซ้าย = L G L L G G
  //   0(L) 0(G) 6(L) 3(L) 8(G) 1(G)  แล้ว center  แล้ว 3 3 3 9 3 1 แบบ R ทั้งหมด
  // ประกอบมือจากตารางในมาตรฐาน ไม่ได้ลอกจากผลลัพธ์ของฟังก์ชัน
  const expected =
    "101" +
    "0001101" + "0100111" + "0101111" + "0111101" + "0001001" + "0110011" +
    "01010" +
    "1000010" + "1000010" + "1000010" + "1110100" + "1000010" + "1100110" +
    "101";

  const r = eanBars("4006381333931")!;
  const bits = Array(r.width).fill("0");
  for (const bar of r.bars) {
    for (let i = 0; i < bar.width; i += 1) bits[bar.x + i] = "1";
  }
  assert.equal(bits.join(""), expected);
  assert.equal(expected.length, 95);
});

// ---- บาร์โค้ดจากเครื่องชั่ง (8.8) --------------------------------------
// รูปแบบนี้คือค่าที่ตั้งไว้ในเครื่องชั่งของร้าน ไม่ใช่มาตรฐานเดียวทั่วโลก
// แกะผิดหมายถึงคิดเงินผิดทุกครั้งโดยที่ทุกอย่างดูปกติ

import { parseScaleBarcode, scaleBarcode } from "../apps/web/lib/bms/barcode.ts";

test("แกะราคาที่ฝังมา (prefix 21, หน่วยสตางค์)", () => {
  const code = scaleBarcode("PRICE", "1234", 123.45);
  assert.ok(code.startsWith("21"));
  assert.deepEqual(parseScaleBarcode(code), { kind: "PRICE", itemCode: "01234", priceBaht: 123.45 });
});

test("แกะน้ำหนักที่ฝังมา (prefix 22, หน่วยกรัม)", () => {
  const code = scaleBarcode("WEIGHT", "77", 1250);
  assert.ok(code.startsWith("22"));
  assert.deepEqual(parseScaleBarcode(code), { kind: "WEIGHT", itemCode: "00077", grams: 1250 });
});

test("เลขที่ check digit ผิดต้องไม่ถูกแกะ", () => {
  const good = scaleBarcode("WEIGHT", "77", 1250);
  const bad = good.slice(0, 12) + String((Number(good[12]) + 1) % 10);
  assert.equal(parseScaleBarcode(bad), null,
    "ปล่อยผ่านแล้วเอาน้ำหนักที่อ่านเพี้ยนไปคิดเงิน = ผิดโดยไม่มีสัญญาณ");
});

test("prefix 20 (เลขที่ร้านสร้างเอง) ต้องไม่ถูกแกะเป็นของชั่ง", () => {
  // ถ้าใช้ prefix เดียวกัน เลขของสินค้าชิ้นจะถูกแกะเป็นน้ำหนักแล้วคิดเงินเพี้ยน
  assert.equal(parseScaleBarcode(inStoreBarcode(42)), null);
  // และบาร์โค้ดของแบรนด์ก็ต้องไม่ถูกแกะ
  assert.equal(parseScaleBarcode("4006381333931"), null);
  assert.equal(parseScaleBarcode("96385074"), null);
  assert.equal(parseScaleBarcode("ไม่ใช่เลข"), null);
});

test("ค่าที่เกินช่วง 5 หลักต้องสร้างไม่ได้", () => {
  assert.throws(() => scaleBarcode("WEIGHT", "1", 100000), /5 หลัก/);
  assert.throws(() => scaleBarcode("PRICE", "1", 1000), /5 หลัก/);   // 1000 บาท = 100000 สตางค์
  assert.throws(() => scaleBarcode("WEIGHT", "123456", 1), /1–5 หลัก/);
});
