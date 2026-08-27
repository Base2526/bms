// =============================================================
// ค่าส่ง — ตัวเลขที่บวกเข้าบิลลูกค้าและเข้าฐาน VAT ด้วย
// -------------------------------------------------------------
// `lib/bms/shippingZones.ts` เป็นโค้ดบริสุทธิ์ (ไม่ import อะไรเลย) และเป็นที่ตัดสิน
// ว่าที่อยู่หนึ่งอยู่โซนไหน กับขั้นน้ำหนักไหนคิดเพิ่มเท่าไร — แต่ไม่เคยมีเทสสักตัว
//
// ทำไมถึงสำคัญกว่าที่ดู:
//   - ค่าส่งเข้าฐาน VAT ของร้านที่จด VAT (ดู vat-contract) ค่าส่งผิด = ใบกำกับผิดด้วย
//   - parser ทั้งสองตัว **ทิ้งแถวที่ผิดรูปเงียบ ๆ** โดยตั้งใจ ถ้าเงื่อนไขการทิ้งเพี้ยนไป
//     ร้านจะเห็นว่าตั้งค่าไว้แล้วแต่ระบบคิดเงินอีกอย่าง โดยไม่มี error ที่ไหนเลย
//   - ลำดับของขั้นน้ำหนักเป็นตัวกำหนดเงิน — shippingRates.ts เลือก "ขั้นแรกที่ครอบ
//     น้ำหนักจริง" ถ้าเรียงผิด ของหนักจะได้ค่าส่งของขั้นเบา
//
// ไม่ต้องมี DB รันจาก apps/web:
//   npx tsx --test ../../scripts/shipping-fee-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProvince,
  parseWeightTiers,
  parseZoneRates,
  zoneForProvince,
} from "../apps/web/lib/bms/shippingZones.ts";

// ---------------------------------------------------------------
// โซนตามจังหวัด
// ---------------------------------------------------------------

test("กรุงเทพในทุกสะกดที่ลูกค้าพิมพ์จริงต้องได้โซนเดียวกัน", () => {
  for (const raw of ["กรุงเทพมหานคร", "กรุงเทพ", "กรุงเทพฯ", "กทม", "กทม.", "Bangkok", "BKK", "  bangkok  "]) {
    assert.equal(zoneForProvince(raw), "BANGKOK", `"${raw}" ควรเป็นกรุงเทพ`);
  }
  assert.equal(normalizeProvince("กทม."), "กรุงเทพมหานคร", "normalize ให้เป็นชื่อทางการเสมอ");
});

test("คำนำหน้า จังหวัด/จ. ถูกตัดก่อนเทียบ", () => {
  assert.equal(zoneForProvince("จังหวัดนนทบุรี"), "PERIMETER");
  assert.equal(zoneForProvince("จ.สมุทรปราการ"), "PERIMETER");
});

test("ห้าจังหวัดปริมณฑลคิดคนละอัตรากับต่างจังหวัด", () => {
  for (const raw of ["นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "สมุทรสาคร", "นครปฐม"]) {
    assert.equal(zoneForProvince(raw), "PERIMETER", `${raw} ต้องเป็นปริมณฑล`);
  }
  // ชื่ออังกฤษที่ลูกค้าพิมพ์เองก็ต้องได้โซนเดียวกัน ไม่งั้นบิลเดียวกันคิดเงินคนละอย่าง
  assert.equal(zoneForProvince("nonthaburi"), "PERIMETER");
  assert.equal(zoneForProvince("Samut Prakan"), "PERIMETER");
});

test("จังหวัดอื่นทั้งหมดเป็นต่างจังหวัด และค่าว่างไม่เดาโซน", () => {
  assert.equal(zoneForProvince("เชียงใหม่"), "UPCOUNTRY");
  assert.equal(zoneForProvince("ภูเก็ต"), "UPCOUNTRY");
  // null = "ไม่รู้" ไม่ใช่ "ต่างจังหวัด" — ผู้เรียกต้องถอยไปใช้อัตราเหมา ไม่ใช่เดา
  assert.equal(zoneForProvince(null), null);
  assert.equal(zoneForProvince(""), null);
  assert.equal(zoneForProvince("   "), null);
});

// ---------------------------------------------------------------
// อัตราต่อโซน
// ---------------------------------------------------------------

test("parseZoneRates รับเฉพาะโซนที่รู้จักและค่าที่ใช้ได้", () => {
  assert.deepEqual(
    parseZoneRates([
      { zone: "BANGKOK", fee: 40 },
      { zone: "MARS", fee: 10 },
      { zone: "UPCOUNTRY", fee: -5 },
      { zone: "PERIMETER", fee: "60" },
    ]),
    [
      { zone: "BANGKOK", fee: 40 },
      { zone: "PERIMETER", fee: 60 },
    ]
  );
});

test("parseZoneRates ยอมรับส่งฟรี (0) แต่ไม่ยอมรับค่าที่ไม่ใช่ตัวเลข", () => {
  assert.deepEqual(parseZoneRates([{ zone: "BANGKOK", fee: 0 }]), [{ zone: "BANGKOK", fee: 0 }]);
  assert.deepEqual(parseZoneRates([{ zone: "BANGKOK", fee: "ฟรี" }]), []);
  assert.deepEqual(parseZoneRates([{ zone: "BANGKOK" }]), []);
});

test("โซนซ้ำ — แถวแรกชนะ ไม่ใช่แถวหลังทับ", () => {
  assert.deepEqual(
    parseZoneRates([
      { zone: "BANGKOK", fee: 40 },
      { zone: "BANGKOK", fee: 999 },
    ]),
    [{ zone: "BANGKOK", fee: 40 }]
  );
});

test("ค่าที่ไม่ใช่ array คืนลิสต์ว่าง ไม่ throw", () => {
  for (const raw of [null, undefined, "", 0, {}, "[]"]) {
    assert.deepEqual(parseZoneRates(raw), []);
    assert.deepEqual(parseWeightTiers(raw), []);
  }
});

// ---------------------------------------------------------------
// ขั้นน้ำหนัก — ลำดับคือเงิน
// ---------------------------------------------------------------

test("ขั้นน้ำหนักถูกเรียงจากเบาไปหนักเสมอ ไม่ว่าจะบันทึกมาลำดับไหน", () => {
  // shippingRates.ts เลือก "ขั้นแรกที่ครอบน้ำหนักจริง" ถ้าไม่เรียง พัสดุ 900 กรัม
  // จะไปเจอขั้น 5000 ก่อนแล้วได้ค่าส่งผิด
  assert.deepEqual(
    parseWeightTiers([
      { maxGrams: 5000, surcharge: 80 },
      { maxGrams: 1000, surcharge: 0 },
      { maxGrams: 2000, surcharge: 30 },
    ]),
    [
      { maxGrams: 1000, surcharge: 0 },
      { maxGrams: 2000, surcharge: 30 },
      { maxGrams: 5000, surcharge: 80 },
    ]
  );
});

test("ขั้นน้ำหนักที่ผิดรูปถูกทิ้ง และเศษกรัมถูกตัดเป็นจำนวนเต็ม", () => {
  assert.deepEqual(
    parseWeightTiers([
      { maxGrams: 0, surcharge: 10 },
      { maxGrams: -1, surcharge: 10 },
      { maxGrams: 1000, surcharge: -1 },
      { maxGrams: 1500.7, surcharge: 25 },
      { maxGrams: "2000", surcharge: "30" },
      { surcharge: 40 },
    ]),
    [
      { maxGrams: 1500, surcharge: 25 },
      { maxGrams: 2000, surcharge: 30 },
    ]
  );
});

test("ขั้นน้ำหนักที่คิดเพิ่ม 0 บาทยังต้องถูกเก็บไว้", () => {
  // ขั้นแรกของร้านส่วนใหญ่คือ "ไม่เกิน 1 กก. ไม่คิดเพิ่ม" — ถ้าถูกทิ้งเพราะเป็น 0
  // พัสดุเบาจะตกไปใช้ขั้นถัดไปแล้วลูกค้าโดนชาร์จเกิน
  assert.deepEqual(parseWeightTiers([{ maxGrams: 1000, surcharge: 0 }]), [
    { maxGrams: 1000, surcharge: 0 },
  ]);
});
