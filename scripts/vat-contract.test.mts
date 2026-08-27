// =============================================================
// VAT บนใบกำกับ — ตัวเลขที่ยื่นสรรพากรต้องไม่ขยับเพราะฟีเจอร์ใหม่
// -------------------------------------------------------------
// lib/bms/vat.ts เป็นโค้ดบริสุทธิ์ 243 บรรทัด ไม่ import อะไรเลย และเป็นที่เดียวที่
// ตัดสินว่า VAT ของทั้งระบบเป็นเท่าไร — แต่ไม่เคยมีเทส pure สักตัว มีแค่การถูกเรียก
// ผ่านชุด DB (order-extra-lines) ซึ่งต้องมี Postgres จึงไม่เคยรันในรอบที่แก้โค้ดจริง
//
// ทำไมต้องมี:
//   - ผิด 1 สตางค์บนใบกำกับ = เอกสารผิด ไม่ใช่ "ปัดเศษต่างกันนิดหน่อย"
//   - วิธีปัดเป็นค่าตั้งต่อร้าน (7.89) และ **ห้ามเปลี่ยนหลังออกใบแรก** ฟีเจอร์ใหม่ที่
//     เผลอเปลี่ยนพฤติกรรม default = เปลี่ยนวิธีปัดของร้านที่ออกใบไปแล้วทั้งหมด
//   - ฐาน VAT ต้องเท่ากับเงินที่รับจริงเสมอ ต่ำกว่านั้น = ยื่นภาษีต่ำกว่าความจริง
//     (กับดักของ 8.6 ที่ลืม UNION ค่าบริการเข้าฐาน)
//
// เลขอ้างอิงในกลุ่มแรกมาจากใบเสร็จจริงที่จดไว้ในหัวไฟล์ vat.ts (วราภรณ์ / Makro)
// ไม่ใช่ค่าที่ก็อปมาจาก output ของโค้ด — คำนวณมือแล้วเทียบ
//
// ไม่ต้องมี DB รันจาก apps/web:
//   npx tsx --test ../../scripts/vat-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  bahtText,
  computeVat,
  formatDocumentDate,
  unresolvedVatSkus,
  type VatLine,
  type VatRounding,
  type VatSettings,
} from "../apps/web/lib/bms/vat.ts";

const REGISTERED: VatSettings = { vatRegistered: true, priceIncludesVat: true, vatRate: 7 };
const withMode = (mode: VatRounding): VatSettings => ({ ...REGISTERED, vatRounding: mode });
const v = (amount: number): VatLine => ({ amount, vatCategory: "V" });

// ---------------------------------------------------------------
// ใบจริงสองใบที่วิธีปัดต่างกัน — ตัวเลขนี้คือเหตุผลที่ vatRounding ต้องมีอยู่
// ---------------------------------------------------------------

test("วราภรณ์ (BASE_FIRST): 134.00 → ฐาน 125.23 + VAT 8.77", () => {
  // 134 ÷ 1.07 = 125.2336... ปัดเป็น 125.23 แล้ว VAT ได้จากการลบ
  const r = computeVat([v(134)], withMode("BASE_FIRST"));
  assert.equal(r.vatAmount, 8.77);
  assert.equal(r.netBeforeVat, 125.23);
  assert.equal(r.grandTotal, 134);
});

test("Makro (VAT_FIRST_TRUNCATE): 354.00 → VAT 23.15 + ฐาน 330.85", () => {
  // 354 × 7/107 = 23.1588... ตัดทิ้งเป็น 23.15 (ไม่ใช่ปัดขึ้น) แล้วฐานได้จากการลบ
  const r = computeVat([v(354)], withMode("VAT_FIRST_TRUNCATE"));
  assert.equal(r.vatAmount, 23.15);
  assert.equal(r.netBeforeVat, 330.85);
  assert.equal(r.grandTotal, 354);
});

test("VAT_FIRST_ROUND ต่างจาก TRUNCATE หนึ่งสตางค์บนใบเดียวกัน", () => {
  const r = computeVat([v(354)], withMode("VAT_FIRST_ROUND"));
  assert.equal(r.vatAmount, 23.16);
  assert.equal(r.netBeforeVat, 330.84);
  // หนึ่งสตางค์นี้คือทั้งหมดที่ทำให้ต้องมีค่าตั้งต่อร้าน — ถ้าเทสนี้เขียวทั้งที่เลข
  // เท่ากับ TRUNCATE แปลว่าโหมดถูกยุบรวมกันไปแล้ว
  assert.notEqual(r.vatAmount, computeVat([v(354)], withMode("VAT_FIRST_TRUNCATE")).vatAmount);
});

test("ทุกวิธีปัดให้ยอดที่ลูกค้าจ่ายเท่ากันเสมอ — ต่างกันแค่การแบ่งฐาน/VAT", () => {
  for (const mode of ["BASE_FIRST", "VAT_FIRST_TRUNCATE", "VAT_FIRST_ROUND"] as VatRounding[]) {
    const r = computeVat([v(354), v(134), v(19.99)], withMode(mode));
    assert.equal(r.grandTotal, 507.99, `${mode} ทำให้ยอดที่เก็บจากลูกค้าเปลี่ยน`);
    // ฐาน + VAT ต้องกลับมาเท่ายอดเดิมพอดี ไม่ว่าตัวไหนถูกปัดก่อน
    assert.equal(r.netBeforeVat + r.vatAmount, r.grandTotal);
  }
});

test("คิดเป็นกลุ่มทั้งบิล ไม่ใช่ปัดทีละบรรทัดแล้วบวกกัน", () => {
  // 3 บรรทัด ๆ ละ 10.00 → กลุ่ม: 30 ÷ 1.07 = 28.0374 → ฐาน 28.04, VAT 1.96
  // ถ้าปัดทีละบรรทัด: 10 ÷ 1.07 = 9.3458 → 9.35, VAT 0.65 × 3 = 1.95 (ต่างกัน 1 สตางค์)
  const r = computeVat([v(10), v(10), v(10)], REGISTERED);
  assert.equal(r.vatAmount, 1.96);
  assert.equal(r.netBeforeVat, 28.04);
});

// ---------------------------------------------------------------
// ประเภทสินค้า
// ---------------------------------------------------------------

test("ร้านที่ไม่ได้จด VAT — ทุกบาทไปกองยกเว้น ไม่มี VAT และ rate เป็น 0", () => {
  const r = computeVat([v(500), { amount: 200, vatCategory: "N" }], {
    vatRegistered: false,
    priceIncludesVat: true,
    vatRate: 7,
  });
  assert.equal(r.vatAmount, 0);
  assert.equal(r.vatRate, 0);
  assert.equal(r.taxableAmount, 0);
  assert.equal(r.exemptAmount, 700);
  assert.equal(r.grandTotal, 700);
});

test("UNKNOWN ต้องถูกนับเป็นเสียภาษี ไม่ใช่ยกเว้น", () => {
  // เดาว่ายกเว้นแล้วผิด = เก็บภาษีขาด (แก้ยาก) · เดาว่าเสียแล้วผิด = เก็บเกิน (แก้ได้)
  // ทางที่ถูกคือบังคับระบุก่อนออกใบ แต่ default ต้องเอียงไปทางปลอดภัยเสมอ
  const r = computeVat([{ amount: 107, vatCategory: "UNKNOWN" }], REGISTERED);
  assert.equal(r.taxableAmount, 107);
  assert.equal(r.exemptAmount, 0);
  assert.equal(r.vatAmount, 7);
});

test("บิลที่มีทั้งของเสียภาษีและของยกเว้น คิด VAT เฉพาะฝั่งเสียภาษี", () => {
  const r = computeVat([v(107), { amount: 100, vatCategory: "N" }], REGISTERED);
  assert.equal(r.taxableAmount, 107);
  assert.equal(r.exemptAmount, 100);
  assert.equal(r.vatAmount, 7);
  assert.equal(r.netBeforeVat, 200); // 100 (ฐานของ 107) + 100 ยกเว้น
  assert.equal(r.grandTotal, 207);
});

test("ร้านที่ตั้งราคายังไม่รวม VAT — บวก VAT เข้าก่อนแล้วคิดแบบเดียวกัน", () => {
  const r = computeVat([v(100)], { vatRegistered: true, priceIncludesVat: false, vatRate: 7 });
  assert.equal(r.taxableAmount, 107);
  assert.equal(r.vatAmount, 7);
  assert.equal(r.netBeforeVat, 100);
  assert.equal(r.grandTotal, 107);
});

test("จด VAT แต่อัตราเป็น 0 — ไม่มี VAT แต่ยอดยังอยู่ฝั่งเสียภาษี", () => {
  const r = computeVat([v(100)], { vatRegistered: true, priceIncludesVat: true, vatRate: 0 });
  assert.equal(r.vatAmount, 0);
  assert.equal(r.taxableAmount, 100);
  assert.equal(r.netBeforeVat, 100);
});

// ---------------------------------------------------------------
// ส่วนลดทั้งบิล — จุดที่ผิดแล้วเอกสารไม่ตรงเงิน
// ---------------------------------------------------------------

test("ส่วนลดทั้งบิลลดฐานภาษีตามสัดส่วน ไม่ใช่ให้ VAT คิดจากราคาเต็ม", () => {
  // 200 เสียภาษี + 100 ยกเว้น ลด 30 → ลดฝั่งเสียภาษี 20 ฝั่งยกเว้น 10 ตามสัดส่วน
  const r = computeVat([v(200), { amount: 100, vatCategory: "N" }], REGISTERED, {
    discountAmount: 30,
  });
  assert.equal(r.taxableAmount, 180);
  assert.equal(r.exemptAmount, 90);
  assert.equal(r.grandTotal, 270, "ยอดบนใบต้องเท่าเงินที่รับจริง");
  assert.equal(r.vatAmount, 11.78); // 180 ÷ 1.07 = 168.2243 → 168.22
  assert.equal(r.netBeforeVat, 258.22);
  assert.equal(r.netBeforeVat + r.vatAmount, r.grandTotal);
});

test("⚠️ ค่าบริการ/ค่าถุงไม่ถูกลด แต่ยังอยู่ในฐาน VAT เต็มจำนวน", () => {
  // นี่คือกับดักของ 8.6 — ลืมเอาค่าบริการเข้าฐาน = ยื่นภาษีต่ำกว่าเงินที่รับจริง
  // เท่ากับค่าบริการทั้งหมดที่เคยเก็บ
  const r = computeVat(
    [v(200), { amount: 10, vatCategory: "V", discountEligible: false }],
    REGISTERED,
    { discountAmount: 20 }
  );
  assert.equal(r.taxableAmount, 190, "ลด 20 จากสินค้า 200 แล้วบวกค่าบริการ 10 กลับเต็มจำนวน");
  assert.equal(r.grandTotal, 190);
  assert.equal(r.vatAmount, 12.43); // 190 ÷ 1.07 = 177.5701 → 177.57
});

test("⚠️ ส่วนลดกินค่าบริการไม่ได้ แม้จะลดจนสินค้าเหลือศูนย์", () => {
  // เคสที่แยกพฤติกรรมได้จริง: ถ้า discountEligible ถูกเมิน ส่วนลดจะลามไปกินค่าบริการ
  // ด้วย → ลูกค้าไม่ต้องจ่ายค่าถุง และฐาน VAT หายไปเท่าค่าบริการนั้น
  const r = computeVat(
    [v(200), { amount: 10, vatCategory: "V", discountEligible: false }],
    REGISTERED,
    { discountAmount: 250 }
  );
  assert.equal(r.taxableAmount, 10, "ลดสินค้าจนหมดแล้ว ค่าบริการต้องยังถูกเก็บ");
  assert.equal(r.grandTotal, 10);
});

test("⚠️ ค่าบริการไม่ร่วมวงเฉลี่ยส่วนลด — สัดส่วนเสียภาษี/ยกเว้นต้องไม่เพี้ยน", () => {
  // สินค้าเสียภาษี 100 + ยกเว้น 100 (ทั้งคู่ลดได้) + ค่าบริการ 10 (ลดไม่ได้) ลด 50
  // ฐานที่เอามาเฉลี่ยคือ 200 ไม่ใช่ 210 → เสียภาษีเหลือ 75 ยกเว้นเหลือ 75
  // ถ้าเผลอเอาค่าบริการเข้ามาเฉลี่ยด้วย จะได้ 83.81/76.19 แล้ว VAT เปลี่ยนทันที
  const r = computeVat(
    [
      v(100),
      { amount: 100, vatCategory: "N" },
      { amount: 10, vatCategory: "V", discountEligible: false },
    ],
    REGISTERED,
    { discountAmount: 50 }
  );
  assert.equal(r.taxableAmount, 85); // 75 (สินค้า) + 10 (ค่าบริการ)
  assert.equal(r.exemptAmount, 75);
  assert.equal(r.grandTotal, 160);
  assert.equal(r.vatAmount, 5.56); // 85 ÷ 1.07 = 79.4393 → 79.44
});

test("ส่วนลดมากกว่ายอดบิล — ยอดลงเหลือ 0 ไม่ติดลบ", () => {
  const r = computeVat([v(100)], REGISTERED, { discountAmount: 150 });
  assert.equal(r.taxableAmount, 0);
  assert.equal(r.exemptAmount, 0);
  assert.equal(r.grandTotal, 0);
  assert.equal(r.vatAmount, 0);
  // discountAmount คืนค่าที่ "ขอลด" ไม่ใช่ค่าที่ "ลดได้จริง" — ตรงนี้ไม่เคยถูกเขียนลง
  // เอกสารภาษี (taxDocuments.ts เก็บแค่ taxable/exempt/vat/rounding/grandTotal)
  // ถ้าวันหนึ่งเอาไปพิมพ์บนใบ ต้อง clamp ก่อน ไม่งั้นใบจะโชว์ส่วนลดเกินยอดบิล
  assert.equal(r.discountAmount, 150);
});

test("ส่วนลดติดลบถูกปัดขึ้นเป็น 0 — ห้ามกลายเป็นการบวกเงิน", () => {
  const r = computeVat([v(100)], REGISTERED, { discountAmount: -50 });
  assert.equal(r.discountAmount, 0);
  assert.equal(r.grandTotal, 100);
});

// ---------------------------------------------------------------
// ค่าส่ง
// ---------------------------------------------------------------

test("ค่าส่งเป็นค่าบริการ — เข้าฐาน VAT ของร้านที่จด VAT", () => {
  const r = computeVat([v(100)], REGISTERED, { shippingAmount: 50 });
  assert.equal(r.taxableAmount, 150);
  assert.equal(r.shippingAmount, 50);
  assert.equal(r.vatAmount, 9.81); // 150 ÷ 1.07 = 140.1869 → 140.19
  assert.equal(r.grandTotal, 150);
});

test("ร้านที่ไม่ได้จด VAT — ค่าส่งไปกองยกเว้น ไม่ใช่สร้างฐานภาษีขึ้นมา", () => {
  const r = computeVat([v(100)], { vatRegistered: false, priceIncludesVat: true, vatRate: 7 }, {
    shippingAmount: 50,
  });
  assert.equal(r.taxableAmount, 0);
  assert.equal(r.exemptAmount, 150);
  assert.equal(r.vatAmount, 0);
});

test("ส่วนลดทั้งบิลลดค่าส่งด้วย เพราะค่าส่งอยู่ในฝั่งที่ลดได้", () => {
  const r = computeVat([v(100)], REGISTERED, { shippingAmount: 50, discountAmount: 30 });
  assert.equal(r.taxableAmount, 120);
  assert.equal(r.grandTotal, 120);
});

// ---------------------------------------------------------------
// การปัดเศษเงินสด (POS) — ต่อกับ cash rounding ที่ pos-contract คุมอยู่
// ---------------------------------------------------------------

test("ปัดเศษเงินสดเข้ายอดสุทธิ แต่ไม่แตะฐาน VAT", () => {
  const r = computeVat([v(107)], REGISTERED, { roundingAmount: -0.25 });
  assert.equal(r.taxableAmount, 107, "การปัดเศษที่เคาน์เตอร์ต้องไม่เปลี่ยนยอดที่ยื่นภาษี");
  assert.equal(r.vatAmount, 7);
  assert.equal(r.grandTotal, 106.75);
  assert.equal(r.roundingAmount, -0.25);
});

// ---------------------------------------------------------------
// สมบัติที่ต้องจริงทุกบิล — ตัวจับ regression ที่ครอบกว่าเคสเดี่ยว
// ---------------------------------------------------------------

test("ทุกส่วนผสม: taxable + exempt + rounding = ยอดที่ลูกค้าจ่าย", () => {
  const modes: VatRounding[] = ["BASE_FIRST", "VAT_FIRST_TRUNCATE", "VAT_FIRST_ROUND"];
  const amounts = [0.01, 9.99, 33.33, 134, 354, 1999.95];
  let checked = 0;
  for (const mode of modes) {
    for (const includes of [true, false]) {
      for (const amount of amounts) {
        for (const discount of [0, 7.77, amount * 2]) {
          for (const shipping of [0, 50]) {
            const r = computeVat(
              [
                { amount, vatCategory: "V" },
                { amount: amount / 2, vatCategory: "N" },
                { amount: 10, vatCategory: "V", discountEligible: false },
              ],
              { vatRegistered: true, priceIncludesVat: includes, vatRate: 7, vatRounding: mode },
              { discountAmount: discount, shippingAmount: shipping, roundingAmount: -0.25 }
            );
            const label = `${mode}/${includes}/${amount}/${discount}/${shipping}`;
            assert.equal(
              Math.round((r.taxableAmount + r.exemptAmount + r.roundingAmount) * 100) / 100,
              r.grandTotal,
              `ยอดที่ลูกค้าจ่ายไม่ตรงกับผลรวมของฐาน: ${label}`
            );
            assert.equal(
              Math.round((r.netBeforeVat + r.vatAmount) * 100) / 100,
              Math.round((r.taxableAmount + r.exemptAmount) * 100) / 100,
              `ฐานก่อน VAT + VAT ไม่กลับมาเท่ายอดก่อนปัดเศษ: ${label}`
            );
            assert.ok(r.taxableAmount >= 0 && r.exemptAmount >= 0, `ยอดติดลบ: ${label}`);
            assert.ok(r.vatAmount >= 0, `VAT ติดลบ: ${label}`);
            checked++;
          }
        }
      }
    }
  }
  assert.equal(checked, 216, "จำนวนชุดที่ตรวจเปลี่ยนไป — แก้ลูปแล้วลืมแก้ตัวเลขนี้");
});

// ---------------------------------------------------------------
// ตัวกันไม่ให้ออกใบทั้งที่ยังไม่รู้ประเภทภาษี
// ---------------------------------------------------------------

test("unresolvedVatSkus คืนเฉพาะ SKU ที่ยังไม่ระบุ และไม่ซ้ำ", () => {
  assert.deepEqual(
    unresolvedVatSkus([
      { sku: "A", vatCategory: "V" },
      { sku: "B", vatCategory: "UNKNOWN" },
      { sku: "B", vatCategory: "UNKNOWN" },
      { sku: "C", vatCategory: "N" },
      { sku: "D", vatCategory: "UNKNOWN" },
    ]),
    ["B", "D"]
  );
  assert.deepEqual(unresolvedVatSkus([{ sku: "A", vatCategory: "V" }]), [], "พร้อมออกใบ = ลิสต์ว่าง");
});

// ---------------------------------------------------------------
// ข้อความบังคับบนใบกำกับเต็มรูป
// ---------------------------------------------------------------

test("bahtText อ่านจำนวนเงินตามหลักภาษาไทยที่ใช้บนเอกสารจริง", () => {
  assert.equal(bahtText(134), "หนึ่งร้อยสามสิบสี่บาทถ้วน");
  assert.equal(bahtText(0), "ศูนย์บาทถ้วน");
  assert.equal(bahtText(1), "หนึ่งบาทถ้วน");
  assert.equal(bahtText(11), "สิบเอ็ดบาทถ้วน", "หลักหน่วยที่เป็น 1 ต้องอ่านว่า เอ็ด");
  assert.equal(bahtText(21), "ยี่สิบเอ็ดบาทถ้วน", "หลักสิบที่เป็น 2 ต้องอ่านว่า ยี่สิบ");
  assert.equal(bahtText(101), "หนึ่งร้อยเอ็ดบาทถ้วน");
  assert.equal(bahtText(1_000_000), "หนึ่งล้านบาทถ้วน");
  assert.equal(bahtText(1_234_567), "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน");
});

test("bahtText อ่านสตางค์ และปัดก่อนอ่านเสมอ", () => {
  assert.equal(bahtText(8.77), "แปดบาทเจ็ดสิบเจ็ดสตางค์");
  assert.equal(bahtText(125.23), "หนึ่งร้อยยี่สิบห้าบาทยี่สิบสามสตางค์");
  assert.equal(bahtText(0.01), "ศูนย์บาทหนึ่งสตางค์");
  // เศษจาก float ต้องไม่โผล่เป็นสตางค์แปลก ๆ บนเอกสาร
  assert.equal(bahtText(0.1 + 0.2), "ศูนย์บาทสามสิบสตางค์");
  assert.equal(bahtText(-8.77), "ลบแปดบาทเจ็ดสิบเจ็ดสตางค์", "ใบลดหนี้ติดลบได้");
});

test("formatDocumentDate รองรับทั้ง พ.ศ. และ ค.ศ. ตามค่าตั้งของร้าน", () => {
  const d = new Date(2026, 7, 27); // 27 ส.ค. 2026 (เดือนนับจาก 0)
  assert.equal(formatDocumentDate(d, "CE"), "27/08/2026");
  assert.equal(formatDocumentDate(d, "BE"), "27/08/2569");
});
