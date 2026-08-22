// =============================================================
// ยืนยันรายการก่อนสร้างบิล + ตัวอย่างการสั่งที่ระบบรับได้จริง
// -------------------------------------------------------------
// ไม่ต่อ network ไม่ต่อ DB — ทดสอบชั้นที่คิดเองได้ทั้งหมด (fingerprint + การประกอบข้อความ
// + ตัวอย่างคงที่) ส่วนที่ต้องมี DB (create_order ปฏิเสธการเขียนจริง) ต้องรันกับ Postgres
// จึงยังไม่อยู่ในชุดนี้ — ดูหมายเหตุท้ายไฟล์
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import {
  composeMissingQuantityQuestion,
  composeOrderQuoteSummary,
  multiItemOrderExample,
  orderQuoteFingerprint,
  type OrderQuoteLine,
} from "../../apps/web/lib/bms/orderQuote.ts";
import {
  looksLikeRequestedItemList,
  parseRequestedItems,
  stripMarkdownEmphasis,
} from "../../apps/web/lib/bms/requestedItems.ts";

const BASKET = [
  { sku: "PARA-500", size: "10", qty: 5, packCode: "BLISTER" },
  { sku: "DOMP-10", size: "10", qty: 3, packCode: "BOX" },
];

test("ลายนิ้วมือไม่ขึ้นกับลำดับที่โมเดลส่งมา (ตะกร้าเดียวกันสลับบรรทัดได้)", () => {
  assert.equal(
    orderQuoteFingerprint(BASKET),
    orderQuoteFingerprint([...BASKET].reverse())
  );
});

test("เปลี่ยนจำนวน หน่วยขาย หรือเพิ่มรายการ = ลายนิ้วมือคนละอัน", () => {
  const base = orderQuoteFingerprint(BASKET);
  assert.notEqual(
    base,
    orderQuoteFingerprint([{ ...BASKET[0], qty: 6 }, BASKET[1]]),
    "เปลี่ยนจำนวนแล้วยังใช้คำยืนยันเดิมได้ = ลูกค้าถูกเก็บเงินของที่ไม่ได้ตกลง"
  );
  assert.notEqual(base, orderQuoteFingerprint([{ ...BASKET[0], packCode: "BOX" }, BASKET[1]]));
  assert.notEqual(
    base,
    orderQuoteFingerprint([...BASKET, { sku: "ORS-1", size: "1", qty: 1 }]),
    "แอบเพิ่มรายการหลังลูกค้ายืนยันต้องไม่ผ่าน"
  );
});

test("ลายนิ้วมือทนต่อการเขียน sku/size ต่างตัวพิมพ์และช่องว่าง", () => {
  assert.equal(
    orderQuoteFingerprint(BASKET),
    orderQuoteFingerprint([
      { sku: " para-500 ", size: "10", qty: 5, packCode: " blister " },
      { sku: "domp-10", size: "10", qty: 3, packCode: "box" },
    ])
  );
});

test("หน่วยขายที่ไม่ได้ระบุ กับระบุเป็นค่าว่าง ต้องถือว่าเหมือนกัน", () => {
  assert.equal(
    orderQuoteFingerprint([{ sku: "A", size: "M", qty: 1 }]),
    orderQuoteFingerprint([{ sku: "A", size: "M", qty: 1, packCode: null }])
  );
});

const QUOTE_LINES: OrderQuoteLine[] = [
  {
    sku: "PARA-500",
    name: "พาราเซตามอล 500 มก.",
    size: "10",
    displayQty: 5,
    packUnitName: "แผง",
    unitPrice: 12,
  },
  {
    sku: "DOMP-10",
    name: "ยาแก้ท้องอืด โดมเพอริโดน",
    size: "10",
    displayQty: 3,
    packUnitName: "กล่อง",
    unitPrice: 45,
  },
];

test("สรุปรายการต้องมีทุกบรรทัดพร้อมชื่อสินค้าที่ลูกค้าอ่านรู้เรื่อง", () => {
  const summary = composeOrderQuoteSummary(QUOTE_LINES, "th");
  assert.match(summary, /พาราเซตามอล 500 มก\. ไซซ์ 10 × 5 แผง/);
  assert.match(summary, /ยาแก้ท้องอืด โดมเพอริโดน ไซซ์ 10 × 3 กล่อง/);
  // ต้องบอกวิธียืนยันด้วย ไม่งั้นลูกค้าไม่รู้ว่าต้องทำอะไรต่อ
  assert.match(summary, /ยืนยัน/);
});

test("ยอดที่แสดงต้องบอกชัดว่ายังไม่ใช่ยอดสุทธิ", () => {
  const summary = composeOrderQuoteSummary(QUOTE_LINES, "th");
  // 12×5 + 45×3 = 195
  assert.match(summary, /195/);
  // ถ้าไม่กำกับไว้ ลูกค้าจะยึดเลขนี้แล้วรู้สึกถูกเก็บเกินตอนเห็นยอดจริงที่รวมค่าส่ง
  assert.match(summary, /ยังไม่รวมค่าส่ง\/ส่วนลด\/แต้ม/);
});

test("รายการที่ไม่รู้ราคาแม้ตัวเดียว ต้องไม่แสดงยอดรวมมั่ว ๆ", () => {
  const summary = composeOrderQuoteSummary(
    [QUOTE_LINES[0], { ...QUOTE_LINES[1], unitPrice: null }],
    "th"
  );
  assert.ok(!/รวมค่าสินค้า/.test(summary), "ราคาไม่ครบแต่ยังสรุปยอด = เดาเลขให้ลูกค้า");
  // แต่ยังต้องลิสต์รายการนั้นให้เห็น ห้ามตัดทิ้งเพราะไม่รู้ราคา
  assert.match(summary, /ยาแก้ท้องอืด โดมเพอริโดน/);
});

test("ภาษาอังกฤษต้องไม่มีคำไทยหลุดปน", () => {
  const summary = composeOrderQuoteSummary(QUOTE_LINES, "en");
  assert.match(summary, /Please confirm your order/);
  assert.match(summary, /THB/);
  assert.ok(!/บาท|ยืนยัน|ไซซ์/.test(summary));
});

test("ตัวอย่างที่บอทสอน ต้องเป็นรูปแบบที่ระบบรับได้จริง (ไม่ใช่แค่ดูดี)", () => {
  const example = multiItemOrderExample("th");
  // ดึงบรรทัดตัวอย่างจริงออกมาแล้วป้อนกลับเข้า parser เดียวกับที่รับข้อความลูกค้า
  const exampleLine = example
    .split("\n")
    .find((line) => line.includes(",") && /\d/.test(line));
  assert.ok(exampleLine, "ไม่พบบรรทัดตัวอย่างในข้อความที่สอนลูกค้า");
  assert.equal(
    looksLikeRequestedItemList(exampleLine as string),
    true,
    "ตัวอย่างที่สอนลูกค้าต้องผ่าน looksLikeRequestedItemList — ไม่งั้นบอทสอนรูปแบบที่ตัวเองรับไม่ได้ (เคสจริง 2026-08-19)"
  );
  const items = parseRequestedItems(exampleLine as string);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.notEqual(item.qty, null, `ตัวอย่างมีรายการที่ไม่มีจำนวน: ${item.rawText}`);
    assert.notEqual(item.unit, null, `ตัวอย่างมีรายการที่ไม่มีหน่วย: ${item.rawText}`);
  }
});

test("ตัวอย่างต้องรอดจากตัวตัด markdown โดยไม่เปลี่ยนแม้ตัวอักษรเดียว", () => {
  // property ที่ต้องการจริง ๆ ไม่ใช่ "ห้ามมี * เลย" (3*3 เป็นขนาดสินค้าที่ถูกต้อง) แต่คือ
  // **สิ่งที่เราสอน = สิ่งที่เราแกะ** ถ้าตัวอย่างมี emphasis ปน (`**` หรือ `*` ติดช่องว่าง)
  // ตัวตัดจะเปลี่ยนข้อความ = ลูกค้าก็อปมาแล้วได้คนละอย่างกับที่เห็น (ต้นเหตุเคส 2026-08-19)
  for (const lang of ["th", "en"] as const) {
    const example = multiItemOrderExample(lang);
    assert.equal(
      stripMarkdownEmphasis(example),
      example,
      `ตัวอย่าง (${lang}) มี markdown emphasis ปนอยู่ — ลูกค้าจะก็อปติดมาแล้วระบบแกะได้คนละอย่าง`
    );
  }
});

test("ตัวอย่างภาษาไทยยกขนาดสินค้าแบบ 3*3 มาได้โดยไม่ใช้ markdown", () => {
  // ผ้าก๊อซขายด้วยขนาด 3*3 นิ้ว — ตัวอย่างจงใจมีเคสนี้เพื่อกันคนมาแก้ให้ strip * ทั้งหมด
  const example = multiItemOrderExample("th");
  assert.match(example, /3\*3/);
  assert.equal(looksLikeRequestedItemList("ผ้าก๊อซ 3*3 นิ้ว 2 ห่อ, เกลือแร่ 3 ซอง"), true);
});

test("รายการที่ไม่ได้บอกจำนวน ต้องถูกถามกลับพร้อมยกทุกรายการให้เห็น", () => {
  const items = parseRequestedItems("พารา 5 แผง, ยาแดง, เกลือแร่ 3 ซอง");
  const question = composeMissingQuantityQuestion(items, "th");
  // ทุกรายการต้องปรากฏ ไม่ใช่แค่ตัวที่ขาดจำนวน — ลูกค้าต้องตรวจได้ว่าไม่มีอะไรหายไป
  assert.match(question, /พารา/);
  assert.match(question, /ยาแดง/);
  assert.match(question, /เกลือแร่/);
  // ตัวที่มีจำนวนแล้วต้องแสดงจำนวน ตัวที่ขาดต้องถูกถาม
  assert.match(question, /พารา × 5 แผง/);
  assert.match(question, /ยาแดง — รับกี่/);
});

test("ถามหลายรายการพร้อมกันได้ ไม่ใช่ไล่ถามทีละตัว", () => {
  const items = parseRequestedItems("พารา 5 แผง, ยาแดง, เกลือแร่");
  const question = composeMissingQuantityQuestion(items, "th");
  assert.match(question, /2 รายการ/, "ต้องบอกว่ายังขาดกี่รายการ แล้วถามรวบในเทิร์นเดียว");
});

test("ห้ามเดาจำนวนให้ลูกค้า — qty ที่เป็น null ต้องไม่กลายเป็น 1", () => {
  const items = parseRequestedItems("พารา 5 แผง, ยาแดง");
  const missing = items.filter((item) => item.qty === null);
  assert.equal(missing.length, 1);
  const question = composeMissingQuantityQuestion(items, "th");
  assert.ok(!/ยาแดง × 1/.test(question), "เติมจำนวนให้เอง = สั่งของที่ลูกค้าไม่ได้สั่ง");
});

// หมายเหตุ: ส่วนที่เทสชุดนี้ยัง **ไม่** ครอบ เพราะต้องมี Postgres จริง —
//   1. create_order บน customer surface ไม่เขียนอะไรเลยเมื่อยังไม่มีคำยืนยันที่ตรงลายนิ้วมือ
//   2. เรียกซ้ำด้วยรายการชุดเดิมหลังลูกค้ายืนยัน แล้วบิลถูกสร้างจริง
//   3. staff surface ไม่ถูกกระทบ
// ทั้งสามข้อต้องรันกับฐานจริงก่อน deploy (ดูคำสั่งใน CLAUDE.local.md)
