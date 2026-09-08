// =============================================================
// แบ่งจ่าย 2 ช่องทาง — อีกช่องต้องลดยอดให้เองอัตโนมัติ
// -------------------------------------------------------------
// อาการจริงที่ผู้ใช้ส่งมา: บิล 358 · เงินสด "ยอดช่องทางนี้" ค้างที่ 358 (เต็มบิล จากตอนยัง
// เป็นช่องทางเดียว) แล้วเพิ่ม QR 100 → รวมกลายเป็น 458 = "ยอดชำระรวมเกินไป ฿100.00"
// ทั้งที่แคชเชียร์ไม่ได้ตั้งใจให้เกิน · ต้นเหตุคือช่องทางแรกไม่เคยถูกลดยอดให้เองเลย
//
//   cd apps/web && npx tsx --test ../../scripts/pos-split-payment-rebalance-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rebalanceSplitPayments, type PosPaymentDraft } from "../apps/web/lib/pos/paymentDraft.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const row = (over: Partial<PosPaymentDraft> = {}): PosPaymentDraft =>
  ({ id: "p1", method: "CASH", amount: "358", tendered: "", ref: "", ...over });

test("เคสจากภาพจริง: แก้ยอด QR เป็น 100 แล้วเงินสด (358 ค้างจากตอนช่องทางเดียว) ต้องลดเป็น 258", () => {
  const payments = [row({ id: "cash", amount: "358" }), row({ id: "qr", method: "QR", amount: "100" })];
  const next = rebalanceSplitPayments(payments, "qr", 358);
  assert.equal(next.find((p) => p.id === "cash")!.amount, "258");
  assert.equal(next.find((p) => p.id === "qr")!.amount, "100", "แถวที่เพิ่งพิมพ์เองต้องไม่ถูกเขียนทับ");
});

test("แก้อีกฝั่ง (เงินสด) ก็ต้องดันยอดกลับมาที่ QR เหมือนกัน — สมมาตรทั้งสองทิศ", () => {
  const payments = [row({ id: "cash", amount: "200" }), row({ id: "qr", method: "QR", amount: "358" })];
  const next = rebalanceSplitPayments(payments, "cash", 358);
  assert.equal(next.find((p) => p.id === "cash")!.amount, "200");
  assert.equal(next.find((p) => p.id === "qr")!.amount, "158");
});

test("พิมพ์เกินยอดบิล — อีกช่องเว้นว่างให้ checkoutBlockReason เตือน ไม่ยัด 0 ให้ดูเหมือนตั้งใจ", () => {
  const payments = [row({ id: "cash", amount: "500" }), row({ id: "qr", method: "QR", amount: "100" })];
  const next = rebalanceSplitPayments(payments, "cash", 358);
  assert.equal(next.find((p) => p.id === "qr")!.amount, "");
});

test("พิมพ์ค่าว่าง/ค่าที่ไม่ใช่ตัวเลข — ไม่แตะอีกช่องทาง (รอให้กรอกให้ครบก่อน)", () => {
  const payments = [row({ id: "cash", amount: "" }), row({ id: "qr", method: "QR", amount: "100" })];
  const next = rebalanceSplitPayments(payments, "cash", 358);
  assert.equal(next.find((p) => p.id === "qr")!.amount, "100", "ยังไม่ต้องแตะจนกว่าจะมีตัวเลขจริง");
});

test("มี 3 ช่องทางขึ้นไป — ไม่แตะเลย (ไม่มีช่องที่เหลือตัวเดียวให้หักแบบไม่กำกวม)", () => {
  const payments = [
    row({ id: "a", amount: "100" }),
    row({ id: "b", method: "QR", amount: "100" }),
    row({ id: "c", method: "CARD", amount: "100" }),
  ];
  const next = rebalanceSplitPayments(payments, "b", 358);
  assert.deepEqual(next, payments);
});

test("ทศนิยมปัดสองตำแหน่งเสมอ — ไม่ทิ้งขยะทศนิยมของ floating point", () => {
  const payments = [row({ id: "cash", amount: "119.33" }), row({ id: "qr", method: "QR", amount: "0" })];
  const next = rebalanceSplitPayments(payments, "cash", 358);
  assert.equal(next.find((p) => p.id === "qr")!.amount, "238.67");
});

test("id ที่แก้ไม่มีอยู่จริง — คืนอาร์เรย์เดิม ไม่ throw", () => {
  const payments = [row({ id: "cash" }), row({ id: "qr", method: "QR", amount: "100" })];
  const next = rebalanceSplitPayments(payments, "ghost", 358);
  assert.deepEqual(next, payments);
});

test("ทั้งสองหน้าเครื่องขาย (ร้านอาหาร + ค้าปลีก) ต้องต่อฟังก์ชันนี้เข้ากับช่อง 'ยอดช่องทางนี้' จริง", async () => {
  const restaurant = strip(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(
    restaurant,
    /rebalanceSplitPayments\(current\.map\(\(row\) => row\.id === payment\.id \? \{ \.\.\.row, amount: event\.target\.value \} : row\), payment\.id, checkoutDue\)/,
    "ช่อง 'ยอดช่องทางนี้' ของหน้าร้านอาหารต้องเรียก rebalanceSplitPayments ไม่ใช่แค่ map แก้ค่าตรง ๆ"
  );

  const retail = strip(await read("apps/web/app/(pos)/pos/page.tsx"));
  assert.match(retail, /function updatePaymentAmount\(id: string, value: string\)/);
  assert.match(retail, /rebalanceSplitPayments\(\s*cur\.map\(\(payment\) => \(payment\.id === id \? \{ \.\.\.payment, amount: value \} : payment\)\),\s*id,\s*amountDue,?\s*\)/);
  assert.match(retail, /onChange=\{\(e\) => updatePaymentAmount\(payment\.id, e\.target\.value\)\}/);
});
