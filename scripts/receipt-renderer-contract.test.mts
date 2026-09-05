// =============================================================
// ใบเสร็จ: จอกับกระดาษต้องเป็นของชิ้นเดียวกัน — source contract
// -------------------------------------------------------------
// ไม่ต้องมี DB · ชุดนี้ตรึงสิ่งที่พังแล้วไม่มีใครเห็นจนลูกค้าถือกระดาษมาเทียบ:
//
//   • เครื่องขายสองหน้า (`/pos`, `/pos/restaurant`) เคยประกอบใบเสร็จบนจอเองคนละชุด
//     แยกจาก payload ที่ส่งเข้าเครื่องพิมพ์ · ผลคือ **สองใบไม่ตรงกันจริง**: จอบอกวิธีชำระ
//     ทีละช่องทาง กระดาษบอกแค่ "จ่ายหลายวิธี" · จอบอกว่าเงินคืนไปทางไหน กระดาษเงียบ ·
//     จอมีบรรทัดปัดเศษของร้านที่ยังไม่จด VAT กระดาษไม่มี
//   • หน้าร้านอาหารเคยมีทางพิมพ์ทางเดียว (WebUSB) ซึ่งใช้ไม่ได้บนหลายเบราว์เซอร์
//   • `requestAnimationFrame` ไม่ทำงานเมื่อแท็บถูกซ่อน = กดพิมพ์แล้วเงียบ
//
//   cd apps/web && npx tsx --test ../../scripts/receipt-renderer-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReceipt, type ReceiptPayload } from "../apps/web/lib/pos/escpos.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
function code(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const PAPER = "apps/web/components/pos/ReceiptPaper.tsx";
const ESCPOS = "apps/web/lib/pos/escpos.ts";
const RETAIL = "apps/web/app/(pos)/pos/page.tsx";
const RESTAURANT = "apps/web/app/(pos)/pos/restaurant/page.tsx";

test("ใบเสร็จมี renderer สองตัวแต่ payload ก้อนเดียว และทั้งคู่ต้องอ่านฟิลด์เดียวกัน", async () => {
  const paper = code(await read(PAPER));
  const escpos = code(await read(ESCPOS));

  // ฟิลด์ที่ "เป็นเนื้อหาของใบเสร็จ" ต้องถูกอ่านทั้งสองฝั่ง — ฝั่งใดฝั่งหนึ่งลืม = จอกับ
  // กระดาษบอกคนละเรื่อง ซึ่งเป็นอาการที่ทำให้ต้องรวม renderer ตั้งแต่แรก
  for (const field of [
    "storeName", "branchCode", "taxId", "posNo", "docTitle", "billNo", "notes",
    "lines", "discountLines", "vat", "roundingAmount", "itemCount", "total",
    "returnReason", "refundLines", "payments", "paymentLabel", "tendered", "change",
    "docNo", "at", "cashier", "member", "barcodeValue", "referenceDocNo",
  ]) {
    assert.match(paper, new RegExp(`payload\\.${field}\\b`), `กระดาษบนจอไม่ได้อ่าน ${field}`);
    assert.match(escpos, new RegExp(`payload\\.${field}\\b`), `ตัวพิมพ์ไม่ได้อ่าน ${field}`);
  }

  // ปัดเศษต้องอยู่นอกบล็อก VAT ทั้งสองฝั่ง — ร้านที่ยังไม่จด VAT ก็ปัดเศษได้
  assert.match(paper, /payload\.roundingAmount \?\? payload\.vat\?\.roundingAmount/);
  assert.match(escpos, /payload\.roundingAmount \?\? payload\.vat\?\.roundingAmount/);

  // ห้ามคิดเลขในตัวเรนเดอร์ — ทุกยอดต้องมาจาก payload ที่ประกอบจากผลของ server
  assert.doesNotMatch(paper, /[-+*/]=|\.reduce\(|Number\(/);
});

test("ทั้งสองเครื่องขายประกอบ payload ที่เดียว แล้วป้อนทั้งจอและเครื่องพิมพ์", async () => {
  const retail = code(await read(RETAIL));
  const restaurant = code(await read(RESTAURANT));

  assert.match(retail, /function receiptPayloadOf\(r: Receipt\): ReceiptPayload/);
  assert.match(retail, /function receiptToEscPos\(r: Receipt\) \{\s*return buildReceipt\(receiptPayloadOf\(r\)\);\s*\}/);
  assert.match(retail, /<ReceiptPaper payload=\{receiptPayloadOf\(receipt\)\} \/>/);

  assert.match(restaurant, /function receiptPayload\(receipt: ReceiptSelection\): ReceiptPayload \| null/);
  assert.match(restaurant, /return buildReceipt\(payload\)/);
  assert.match(restaurant, /<ReceiptPaper payload=/);

  // ห้ามมีใบเสร็จ DOM ชุดที่สองอีก — `#pos-receipt` ต้องมาจากคอมโพเนนต์ตัวเดียว
  for (const [name, source] of [["retail", retail], ["restaurant", restaurant]] as const) {
    assert.doesNotMatch(source, /id="pos-receipt"/, `${name} ยังประกอบใบเสร็จ DOM เอง`);
  }
  assert.match(code(await read(PAPER)), /id=\{RECEIPT_PRINT_ID\}/);
});

test("ทางพิมพ์สำรองต้องยิงแม้แท็บถูกซ่อน และยิงครั้งเดียว", async () => {
  for (const path of [RETAIL, RESTAURANT]) {
    const source = code(await read(path));
    // rAF ไม่ทำงานเมื่อแท็บถูกซ่อน (แท็บเล็ตหน้าร้านสลับแอปได้ตลอด) — ต้องมีตัวสำรอง
    assert.match(source, /window\.requestAnimationFrame\(fire\)/, `${path} พึ่ง rAF ตัวเดียว`);
    assert.match(source, /window\.setTimeout\(fire, \d+\)/, `${path} ไม่มีตัวสำรองของ rAF`);
    assert.match(source, /if \(printed\) return;/, `${path} อาจยิง print dialog ซ้อนสองใบ`);
    assert.doesNotMatch(source, /requestAnimationFrame\(\(\) => window\.print\(\)\)/);
  }
});

test("ป้ายวิธีชำระมีตารางเดียว — เครื่องขายสองหน้าห้ามถือคนละชุด", async () => {
  const lib = code(await read("apps/web/lib/pos/receiptI18n.ts"));
  assert.match(lib, /export function posPaymentMethodLabel/);
  for (const path of [RETAIL, RESTAURANT]) {
    const source = code(await read(path));
    assert.match(source, /posPaymentMethodLabel[\s\S]{0,400}?from "@\/lib\/pos\/receiptI18n"/);
    assert.doesNotMatch(source, /function posPaymentMethodLabel/,
      "หน้าเครื่องขายห้ามนิยามป้ายวิธีชำระเอง — เพิ่มวิธีชำระใหม่แล้วอีกหน้าจะพิมพ์รหัสดิบให้ลูกค้าอ่าน");
  }
});

test("บิลแบ่งจ่ายและใบรับคืนต้องบอกรายช่องทางบนกระดาษ ไม่ใช่เห็นแค่บนจอ", async () => {
  const retail = code(await read(RETAIL));
  const restaurant = code(await read(RESTAURANT));
  // หน้าร้านอาหารรองรับแบ่งจ่ายมาตั้งแต่ 9.44 แต่ใบเสร็จเคยบอกแค่ยอดรับ/ทอนรวม
  assert.match(restaurant, /payments: receipt\.payments\.map/);
  // ปัดเศษเงินสดต้องถึงกระดาษด้วย — ร้านอาหารส่วนใหญ่ไม่จด VAT จึงไม่มีบล็อก VAT ให้อาศัย
  assert.match(restaurant, /roundingAmount: result\.roundingAmount/);
  assert.match(restaurant, /payments: settledPayments/);
  // ใบขาย: ส่งรายวิธีชำระเข้า payload · ใบรับคืน: ส่งว่าเงินกลับไปทางไหนและรอยืนยันไหม
  assert.match(retail, /payments: nonSaleReceipt \? null : salePayments\.map/);
  assert.match(retail, /pending: refund\.status === "PENDING"/);
  // ตกไปใช้ payment เดี่ยวเมื่อบิลไม่มีแถวชำระเงิน (บิลเก่า) — ไม่ใช่ปล่อยว่าง
  assert.match(retail, /r\.payments\.length > 0 \? r\.payments : \[\{/);
});

/**
 * ใบรับคืนพิมพ์จริงแล้วมีอะไรบ้าง — ตรวจที่ไบต์ ไม่ใช่ที่ซอร์ส
 *
 * ส่วนนี้เดิม **เห็นได้แค่บนจอ** ของหน้าค้าปลีก กระดาษเงียบสนิทว่าเงินคืนไปทางไหนและ
 * ยังรอยืนยันอยู่ไหม · สลิปคืนที่ไม่บอกเรื่องนี้ตอบลูกค้าที่ถามว่า "แล้วเงินจะเข้าเมื่อไร"
 * ไม่ได้เลย · assert ที่ไบต์เพราะการสแกนซอร์สบอกได้แค่ว่า "มีโค้ดอยู่" ไม่ได้บอกว่าพิมพ์ออกมา
 */
const RETURN_PAYLOAD: ReceiptPayload = {
  storeName: "Shop B",
  branchCode: "00000",
  taxId: null,
  posNo: "E001",
  vatIncluded: false,
  docTitle: "ใบรับคืนสินค้า",
  docNo: null,
  relatedDocNo: "CN-001",
  referenceDocNo: "B-77",
  barcodeValue: "B-77",
  at: "5/9/2569 10:17:15",
  cashier: "A",
  lines: [{ name: "ชามะนาวเย็น (S)", qty: 1, amount: 120 }],
  itemCount: 1,
  total: 120,
  returnReason: "ลูกค้าเปลี่ยนใจ",
  refundLines: [
    { label: "เงินสด", amount: 80 },
    { label: "QR", amount: 40, ref: "QR-RF-7", pending: true },
  ],
};

test("ใบรับคืนที่พิมพ์จริงต้องบอกว่าเงินกลับไปทางไหนและยังรอยืนยันไหม", async () => {
  const text = Buffer.from(buildReceipt(RETURN_PAYLOAD)).toString("latin1");
  assert.ok(text.includes("80.00"), "ไม่มียอดที่คืนเป็นเงินสด");
  assert.ok(text.includes("40.00"), "ไม่มียอดที่คืนทาง QR");
  assert.ok(text.includes("QR-RF-7"), "ไม่มีเลขอ้างอิงคืนเงิน — ลูกค้าตามเงินที่ยังไม่เข้าไม่ได้");
  assert.ok(text.includes("B-77"), "ไม่มีเลขบิลขายเดิมให้สแกนกลับ");
  assert.ok(text.includes("CN-001"), "ไม่มีเลขใบลดหนี้");
});

test("บิลแบ่งจ่ายและปัดเศษของร้านที่ยังไม่จด VAT ต้องออกมาบนกระดาษ", async () => {
  const text = Buffer.from(buildReceipt({
    ...RETURN_PAYLOAD,
    docTitle: "ใบเสร็จรับเงิน",
    returnReason: null,
    refundLines: null,
    relatedDocNo: null,
    referenceDocNo: null,
    total: 360,
    roundingAmount: -0.25,
    payments: [
      { label: "เงินสด", amount: 200, tendered: 500, change: 300 },
      { label: "เครดิตร้าน", amount: 160, ref: "GC-8842" },
    ],
  })).toString("latin1");
  assert.ok(text.includes("200.00") && text.includes("160.00"), "บิลแบ่งจ่ายไม่ได้บอกยอดรายช่องทาง");
  assert.ok(text.includes("500.00 / 300.00"), "ไม่มีบรรทัดรับเงิน/เงินทอนของช่องทางเงินสด");
  assert.ok(text.includes("GC-8842"), "ไม่มีเลขอ้างอิงของช่องทางที่สอง");
  // ร้านที่ยังไม่จด VAT ไม่มีบล็อก VAT ให้บรรทัดปัดเศษไปอาศัยอยู่ — เดิมจึงหายไปเลย
  assert.ok(text.includes("-0.25"), "บรรทัดปัดเศษเงินสดหายไปจากกระดาษ");
});
