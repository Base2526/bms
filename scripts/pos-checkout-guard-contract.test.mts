// =============================================================
// กล่องรับชำระของเครื่องขายร้านอาหาร — source + logic contract
// -------------------------------------------------------------
// ไม่ต้องมี DB · ตรึงสองเรื่องที่พังแล้วเห็นยากจนกว่าจะมีคนยืนอยู่หน้าเคาน์เตอร์:
//
//   1. **จอต้องกันสิ่งที่ตัวเองรู้อยู่แล้วว่า server จะปฏิเสธ** — ปุ่ม "ยืนยันรับเงิน" เคยกดได้
//      เสมอ แล้วไปล้มทีหลัง · บิลโต๊ะที่ล้มกลางทางถูก claim เป็น CLOSING แล้วต้องคืนสถานะ
//      ต่อหน้าลูกค้า (กฎเดียวกับที่จอกันตัวเลือกที่บังคับของเมนูไว้ก่อนส่ง)
//   2. **ปุ่มของ antd ใน `.pos-root` ถูก pos.css ทาทับครึ่งเดียว** จนสองครึ่งมาจากคนละธีม
//      วัดจริงในธีมมืด: `<Button danger>` ได้ contrast 1.09 และปุ่ม primary ที่ disable ได้ 1
//      (เกณฑ์ปกติคือ 4.5) = ปุ่มที่อ่านไม่ออกเลย
//
//   cd apps/web && npx tsx --test ../../scripts/pos-checkout-guard-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkoutBlockReason, type PosPaymentDraft } from "../apps/web/lib/pos/paymentDraft.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const row = (over: Partial<PosPaymentDraft> = {}): PosPaymentDraft =>
  ({ id: "p1", method: "CASH", amount: "100", tendered: "", ref: "", ...over });

test("ยอดชำระรวมต้องเท่ากับยอดที่ต้องชำระเป๊ะ — บอกด้วยว่าขาดหรือเกินเท่าไร", () => {
  assert.equal(checkoutBlockReason([row()], 100), null);
  assert.match(checkoutBlockReason([row({ amount: "80" })], 100)!, /ขาด ฿20\.00/);
  assert.match(checkoutBlockReason([row({ amount: "120" })], 100)!, /เกินไป ฿20\.00/);
  assert.equal(checkoutBlockReason([], 100), "ต้องระบุช่องทางชำระเงิน");
  // เคสจากภาพจริง: เงินสด 701 + QR 201 = 902 บนบิล 701
  const split = [row({ amount: "701", tendered: "701" }), row({ id: "p2", method: "QR", amount: "201" })];
  assert.match(checkoutBlockReason(split, 701)!, /เกินไป ฿201\.00/);
});

test("เงินสดที่รับมาน้อยกว่ายอดของช่องทางนั้น = ทอนติดลบ ซึ่ง server ปฏิเสธอยู่แล้ว", () => {
  // เว้นว่าง = รับมาพอดี · server ยอมรับ จอจึงต้องไม่บล็อก
  assert.equal(checkoutBlockReason([row({ amount: "100", tendered: "" })], 100), null);
  assert.equal(checkoutBlockReason([row({ amount: "100", tendered: "100" })], 100), null);
  assert.equal(checkoutBlockReason([row({ amount: "100", tendered: "500" })], 100), null);
  assert.match(checkoutBlockReason([row({ amount: "100", tendered: "80" })], 100)!, /เงินสดที่รับมาน้อยกว่า/);
  // ช่องทางที่ไม่ใช่เงินสดไม่มีเรื่องเงินทอน
  assert.equal(checkoutBlockReason([row({ method: "QR", amount: "100", tendered: "1" })], 100), null);
  // แถวที่เพิ่งเพิ่มยังไม่ได้กรอกยอด — กดยืนยันไม่ได้ และต้องบอกว่าเพราะอะไร
  assert.match(
    checkoutBlockReason([row({ amount: "100" }), row({ id: "p2", method: "QR", amount: "" })], 100)!,
    /มากกว่า 0/
  );
});

test("ปุ่มยืนยัน แถบสรุป และ settle() ต้องใช้ตัวตัดสินเดียวกัน", async () => {
  const page = strip(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(page, /const checkoutBlock = check == null \? null : checkoutBlockReason\(payments, checkoutDue\)/);
  assert.match(page, /okButtonProps=\{\{ disabled: Boolean\(checkoutBlock\) \}\}/);
  assert.match(page, /const blocked = checkoutBlockReason\(payments, checkoutDue\)/);
  // สามที่ตัดสินเองจะ drift แล้ววันหนึ่งปุ่มกดได้แต่ settle ปฏิเสธ
  assert.doesNotMatch(page, /Math\.abs\(paymentTotal - checkoutDue\) > 0\.009/);
});

test("ปุ่มของ antd ต้องไม่ถูก pos.css ทาทับครึ่งเดียวจนสองครึ่งมาจากคนละธีม", async () => {
  const css = strip(await read("apps/web/app/(pos)/pos/pos.css"));
  const rules = [...css.matchAll(/(^|\})\s*([^{}]*?button[^{}]*?)\{/g)].map((m) => m[2].trim());
  // เฉพาะกฎ "เหมาทุกปุ่มใต้ .pos-root" — กฎที่เจาะจง widget ของหน้าจอเอง
  // (`.pos-root .pos-qty button`) ไม่มีทางไปโดนปุ่มของ antd อยู่แล้ว
  const blanket = rules.filter((selector) =>
    /(^|,)\s*(:where\(\.pos-root\)|\.pos-root)\s+button(?![\w-])/.test(selector));
  assert.ok(blanket.length > 0, "ไม่พบกฎเหมาปุ่มของ pos.css — regex คงเลิกตรงกับไฟล์แล้ว");
  for (const selector of blanket) {
    assert.ok(selector.includes(":not(.ant-btn)"),
      `กฎ "${selector}" ยังทาปุ่มของ antd ด้วย — ครึ่งหนึ่งของปุ่มจะมาจากธีมของ pos.css อีกครึ่งจาก antd`);
    // `:not(.ant-btn)` เพิ่ม specificity หนึ่งคลาส ถ้าไม่ห่อ .pos-root ด้วย :where()
    // กฎนี้จะไปทับสีปุ่มของ CSS module (`.page .btnDanger`) ทั้งหน้า
    assert.ok(selector.includes(":where(.pos-root)"),
      `กฎ "${selector}" ต้องห่อ .pos-root ด้วย :where() เพื่อคง specificity เดิม`);
  }
  // กล่องรับชำระต้องใช้ปุ่มของหน้าจอเอง ไม่ใช่ <Button> ของ antd
  const page = strip(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.doesNotMatch(page, /<Button danger/);
  assert.doesNotMatch(page, /<Button type="dashed"/);
});

test("รับเงินสดเกินต้องบอกเงินทอนตอนถือเงินอยู่ในมือ ไม่ใช่หลังกดยืนยัน", async () => {
  const page = strip(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // หน้าค้าปลีกแสดง "เงินทอนรายการนี้" ระหว่างกรอกมาตลอด · หน้านี้เคยมีเงินทอนแค่ในแผงใบเสร็จ
  // ซึ่งขึ้น **หลัง** เก็บเงินไปแล้ว = แคชเชียร์ต้องคิดเลขเองตอนที่ลูกค้ายืนรอทอน
  assert.match(page, /const cashChangeOf = \(payment: PosPaymentDraft\)/);
  assert.match(page, /เงินทอนรายการนี้/);
  // เฉพาะช่องทางเงินสดที่กรอกแล้วและไม่ต่ำกว่ายอด — ทอนติดลบไม่มีอยู่จริง
  assert.match(page, /payment\.method !== "CASH" \|\| !payment\.tendered\.trim\(\)/);
  assert.match(page, /change >= 0 \? Math\.round\(change \* 100\) \/ 100 : null/);
  // ต้องคิดจากค่าที่กรอก ไม่ใช่ผูกกับยอดบิลทั้งใบ (บิลแบ่งจ่ายมีเงินสดแค่บางส่วน)
  assert.doesNotMatch(page, /เงินทอนรายการนี้[\s\S]{0,120}checkoutDue/);
});
