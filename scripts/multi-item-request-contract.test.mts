// สัญญาของการแยก "ลูกค้าขอหลายรายการในข้อความเดียว"
//
// เคสต้นเรื่อง: ร้านขายยา ลูกค้าทักมาว่า "อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด"
// ก่อนแก้ ข้อความนี้ถูกยุบเป็นสินค้าเดียวชื่อมั่ว ๆ แล้วของ 2 ตัวหายเงียบ ๆ
//
// ไฟล์นี้ไม่ต้องมี DB — requestedItems.ts ตั้งใจไม่ import อะไรนอกจาก quantityUnits.ts
// (เหตุผล: pharmacy/trigger.ts ต้อง side-effect free จึงต้อง import ตัวแยกนี้ได้)
//
//   node --experimental-strip-types --test scripts/multi-item-request-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

// requestedItems.ts imports nothing, so this suite needs no bundler and no DB.
// The pharmacy trigger assertions live in pharmacy-trigger-contract.test.mts
// because trigger.ts has a (dependency-free but extensionless) import that
// `node --experimental-strip-types` cannot resolve.
import {
  extractQty,
  extractUnit,
  parseRequestedItems,
  requestedItemTargetIndex,
  stripRequestNoise,
  updateRequestedItems,
} from "../apps/web/lib/bms/requestedItems.ts";

const PHARMACY_MESSAGE = "อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด";

test("แยก 3 รายการจากข้อความร้านยาต้นเรื่องได้ครบ", () => {
  const items = parseRequestedItems(PHARMACY_MESSAGE);
  assert.equal(items.length, 3, "ต้องได้ 3 รายการ ไม่ใช่ก้อนเดียว");
  assert.match(items[0].nameHint, /พารา/);
  assert.match(items[1].nameHint, /ยาแดง/);
  assert.match(items[2].nameHint, /ยาแก้ปวด/);
});

test("รายการที่ลูกค้าไม่บอกจำนวนต้องได้ qty = null ห้ามเดาเป็น 1", () => {
  const items = parseRequestedItems(PHARMACY_MESSAGE);
  assert.equal(items[0].qty, 1);
  assert.equal(items[1].qty, 1);
  assert.equal(
    items[2].qty,
    null,
    "เดาเป็น 1 = สั่งของที่ลูกค้าไม่ได้สั่ง ต้องถามกลับเท่านั้น"
  );
});

test("เก็บหน่วยที่ลูกค้านับไว้เป็นใบ้หา pack", () => {
  const items = parseRequestedItems(PHARMACY_MESSAGE);
  assert.equal(items[0].unit, "แผง");
  assert.equal(items[1].unit, "ขวด");
  assert.equal(items[2].unit, null);
});

test("เก็บข้อความต้นฉบับของแต่ละรายการไว้ให้เภสัชกรอ่าน", () => {
  const items = parseRequestedItems(PHARMACY_MESSAGE);
  assert.equal(items[0].rawText, "อยากได้ พารา 1 แผง");
  assert.equal(items[1].rawText, "ยาแดง 1 ขวด");
  assert.equal(items[2].rawText, "ยาแก้ปวด");
});

test("หน่วยยาทุกตัวถูกนับเป็นจำนวน", () => {
  for (const unit of ["แผง", "ขวด", "ซอง", "กล่อง", "หลอด", "ตลับ", "กระปุก"]) {
    assert.equal(extractQty(`ยาหม่อง 2 ${unit}`), 2, `หน่วย ${unit} ต้องอ่านจำนวนได้`);
    assert.equal(extractUnit(`ยาหม่อง 2 ${unit}`), unit);
  }
});

test("เม็ด/แคปซูล ไม่ใช่จำนวนที่ขอ แต่เป็นตัวระบุสินค้า", () => {
  // "พารา 500mg 10 เม็ด" = ชื่อสินค้า (แผงบรรจุ 10 เม็ด) ไม่ใช่ขอ 10 หน่วย
  // ถ้าอ่านเป็นจำนวน "1 แผงของแพ็ก 10 เม็ด" จะกลายเป็น "10 ของอะไรไม่รู้"
  assert.equal(extractQty("พารา 500mg 10 เม็ด"), null);
  assert.equal(extractUnit("พารา 500mg 10 เม็ด"), null);
  assert.match(
    stripRequestNoise("อยากได้ พารา 500mg 10 เม็ด"),
    /500mg 10 เม็ด/,
    "ตัวระบุความแรง/บรรจุต้องอยู่ในชื่อที่เอาไปค้น"
  );
});

test("จำนวนคำไทยใช้กับหน่วยยาได้", () => {
  assert.equal(extractQty("ขอ พารา สอง แผง"), 2);
  assert.equal(extractQty("ยาแดง หนึ่ง ขวด"), 1);
});

test("ตัวคั่นรายการทุกแบบ", () => {
  const cases: Array<[string, string]> = [
    ["พารา 1 แผง, ยาแดง 1 ขวด", "จุลภาค"],
    ["พารา 1 แผง + ยาแดง 1 ขวด", "บวก"],
    ["พารา 1 แผง\nยาแดง 1 ขวด", "ขึ้นบรรทัดใหม่"],
    ["พารา 1 แผง และ ยาแดง 1 ขวด", "และ"],
    ["พารา 1 แผง กับ ยาแดง 1 ขวด", "กับ"],
    ["พารา 1 แผง แล้วก็ ยาแดง 1 ขวด", "แล้วก็"],
  ];
  for (const [text, label] of cases) {
    assert.equal(parseRequestedItems(text).length, 2, `ตัวคั่น ${label} ต้องแยกได้`);
  }
});

test("ไม่มีจำนวนเลยแต่ใช้จุลภาค = ยังต้องแยกรายการ", () => {
  // กับดักที่เกือบพลาด: กฎเดิมเชื่อผลการแยกเฉพาะเมื่อมี segment ที่ระบุ size/qty
  // ข้อความนี้ไม่มีทั้งคู่ ถ้าไม่มีกฎ "ตัวคั่นชัดเจน" จะยุบกลับเป็นก้อนเดียว
  const items = parseRequestedItems("พารา, ยาแดง, ยาแก้ปวด");
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.qty),
    [null, null, null]
  );
});

test('"และ"/"กับ" ในประโยคธรรมดาไม่ถูกหักเป็นรายการ', () => {
  // เป็นคำในภาษาไทยทั่วไป ไม่ใช่ตัวคั่นรายการเสมอ
  const items = parseRequestedItems("สั่งของและอยากถามว่าส่งฟรีไหม");
  assert.equal(items.length, 1, "ไม่มีจำนวนและไม่มีตัวคั่นชัดเจน → ถือเป็นข้อความเดียว");
});

test("ข้อความสินค้าเดียวยังทำงานเหมือนเดิม (backward compat)", () => {
  const items = parseRequestedItems("อยากได้ พารา 1 แผง");
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 1);
  assert.equal(items[0].unit, "แผง");
  assert.match(items[0].nameHint, /พารา/);
});

test("ข้อความว่างคืน array ว่าง ไม่ throw", () => {
  assert.deepEqual(parseRequestedItems(""), []);
  assert.deepEqual(parseRequestedItems("   "), []);
});

test("จำนวนที่มากับหน่วยไม่ปนกันข้ามรายการ", () => {
  const items = parseRequestedItems("พารา 2 แผง, ยาแดง 3 ขวด, สำลี 1 ห่อ");
  assert.deepEqual(
    items.map((i) => [i.qty, i.unit]),
    [
      [2, "แผง"],
      [3, "ขวด"],
      [1, "ห่อ"],
    ]
  );
});

test("เม็ด/แคปซูลยังเป็นรายละเอียดสินค้า แต่หน่วยบรรจุทั่วไปอ่านได้", () => {
  assert.equal(extractQty("พารา 500mg 10 เม็ด"), null);
  assert.equal(extractQty("สำลี 2 ห่อ"), 2);
  assert.equal(extractQty("แอลกอฮอล์ 3 ถุง"), 3);
  assert.equal(extractQty("วิตามิน 1 กระป๋อง"), 1);
});

test("เลขไทยและคำจำนวนหกถึงสิบใช้กับ pack ได้", () => {
  assert.equal(extractQty("พารา ๑ แผง"), 1);
  assert.equal(extractQty("ยาแดง ๒ ขวด"), 2);
  assert.equal(extractQty("สำลี หก ห่อ"), 6);
  assert.equal(extractQty("หน้ากาก สิบ กล่อง"), 10);
});

test("รองรับ English conjunction/pack และ semicolon", () => {
  const english = parseRequestedItems("paracetamol 1 box and alcohol 2 bottles");
  assert.equal(english.length, 2);
  assert.deepEqual(english.map((item) => item.qty), [1, 2]);
  assert.equal(parseRequestedItems("พารา 1 แผง; ยาแดง 1 ขวด").length, 2);
});

test("เครื่องหมายบวกในชื่อสินค้าไม่ถูกแยก แต่บวกที่คั่นรายการชัดเจนยังแยก", () => {
  assert.equal(parseRequestedItems("Vitamin C + Zinc 1 กล่อง").length, 1);
  assert.equal(parseRequestedItems("พารา 1 แผง + ยาแดง 1 ขวด").length, 2);
  const mixed = parseRequestedItems("Vitamin C + Zinc 1 กล่อง, พารา 1 แผง");
  assert.equal(mixed.length, 2);
  assert.match(mixed[0].nameHint, /Vitamin C \+ Zinc/);
});

test("เลขลำดับใน bullet ไม่ปนเข้า product hint", () => {
  const items = parseRequestedItems("1. พารา 1 แผง\n2. ยาแดง 1 ขวด");
  assert.deepEqual(items.map((item) => item.nameHint), ["พารา", "ยาแดง"]);
});

test("คำถามเรื่องส่งของท้ายรายการไม่ถูกสร้างเป็นสินค้าอีกบรรทัด", () => {
  const items = parseRequestedItems("พารา 1 แผง, ยาแดง 1 ขวด, ส่งพรุ่งนี้ได้ไหม");
  assert.deepEqual(items.map((item) => item.nameHint), ["พารา", "ยาแดง"]);
});

test("follow-up แก้เฉพาะรายการที่อ้างชื่อหรือลำดับ", () => {
  const initial = parseRequestedItems(PHARMACY_MESSAGE);
  const byName = updateRequestedItems(initial, "ยาแก้ปวด 2 กล่อง");
  assert.deepEqual(byName.map((item) => item.qty), [1, 1, 2]);
  assert.equal(byName[2].unit, "กล่อง");

  const byOrdinal = updateRequestedItems(initial, "ตัวที่ 3 เอา 3 กล่อง");
  assert.deepEqual(byOrdinal.map((item) => item.qty), [1, 1, 3]);
  assert.equal(requestedItemTargetIndex(initial, "รายการที่ 2"), 1);
});

test("follow-up อย่างละ/ลบรายการไม่ทำให้บรรทัดอื่นหาย", () => {
  const initial = parseRequestedItems("พารา, ยาแดง, สำลี");
  const each = updateRequestedItems(initial, "อย่างละ 2 ชิ้น");
  assert.deepEqual(each.map((item) => item.qty), [2, 2, 2]);

  const removed = updateRequestedItems(each, "ไม่เอายาแดงแล้ว");
  assert.deepEqual(removed.map((item) => item.nameHint), ["พารา", "สำลี"]);
});
