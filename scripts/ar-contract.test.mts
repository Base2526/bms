// =============================================================
// ขายเชื่อ / ลูกหนี้การค้า (9.30) — เทสที่ไม่ต้องมีฐานข้อมูล
// -------------------------------------------------------------
// สองเรื่อง:
//   1. กติกาวงเงิน (`evaluateArCharge`) ซึ่งเป็นสูตรเดียวที่ตัดสินว่าปล่อยเชื่อได้ไหม
//      ทั้งด่านก่อนสร้างบิลและด่านในทรานแซกชันที่ตัดสต็อก
//   2. สแกนซอร์สว่า 'CREDIT' ไม่หลุดเข้าสูตรเงินในลิ้นชัก
//
// ข้อ 2 เป็นเทสอ่านซอร์สแบบเดียวกับ file-visibility-contract เพราะสิ่งที่ต้องกันคือ
// "วันหนึ่งมีคนแก้ drawerExpectedInTx ให้รวมทุกวิธีชำระ" ซึ่งจะทำให้ทุกร้านที่ขายเชื่อ
// นับปิดกะเกินเท่ายอดเชื่อทุกวัน โดยที่ไม่มีเทสไหนแดง (บิลก็ยังขายได้ปกติ)
//
//   node --experimental-strip-types --test scripts/ar-contract.test.mts
// =============================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateArCharge, type ArAccountStatus } from "../apps/web/lib/bms/arCredit.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

function account(over: Partial<{ status: ArAccountStatus; creditLimit: number; balance: number }> = {}) {
  return {
    id: "acc-1",
    status: (over.status ?? "ACTIVE") as ArAccountStatus,
    creditLimit: over.creditLimit ?? 10_000,
    balance: over.balance ?? 0,
  };
}

// ---------------------------------------------------------------
// กติกาวงเงิน
// ---------------------------------------------------------------

test("บัญชีว่างเปล่า ขายเชื่อในวงเงินได้", () => {
  const verdict = evaluateArCharge(account(), 3_000);
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.availableCredit, 7_000);
});

test("ยอดที่ทำให้ชนวงเงินพอดี ต้องผ่าน (ไม่ใช่ปฏิเสธที่ขอบ)", () => {
  // "วงเงิน 5,000" ต้องหมายถึงเป็นหนี้ได้ถึง 5,000 ไม่ใช่ 4,999.99 — ปฏิเสธที่ขอบ
  // คือบิลสุดท้ายของเดือนที่ลูกค้าคำนวณมาแล้วว่าพอดี จะถูกตีตกโดยไม่มีคำอธิบาย
  const verdict = evaluateArCharge(account({ creditLimit: 5_000, balance: 2_000 }), 3_000);
  assert.equal(verdict.ok, true, "ยอดที่ชนวงเงินพอดีถูกปฏิเสธ");
  if (verdict.ok) assert.equal(verdict.availableCredit, 0);
});

test("เกินวงเงินแม้สตางค์เดียวต้องถูกปฏิเสธ", () => {
  const verdict = evaluateArCharge(account({ creditLimit: 5_000, balance: 2_000 }), 3_000.01);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "LIMIT_EXCEEDED");
});

test("ข้อความปฏิเสธต้องบอกทั้งวงเงิน ยอดค้าง และยอดที่ขอ", () => {
  // แคชเชียร์ต้องตอบลูกค้าที่ยืนอยู่ตรงหน้าได้ทันทีว่าติดตรงไหน
  const verdict = evaluateArCharge(account({ creditLimit: 5_000, balance: 4_500 }), 1_000);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.match(verdict.reason, /5,?000\.00/);
    assert.match(verdict.reason, /4,?500\.00/);
    assert.match(verdict.reason, /1,?000\.00/);
  }
});

test("บัญชีที่ถูกระงับขายเชื่อไม่ได้ แม้วงเงินจะเหลือเต็ม", () => {
  const verdict = evaluateArCharge(account({ status: "ON_HOLD", balance: 0 }), 100);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "ON_HOLD");
});

test("บัญชีที่ปิดแล้วขายเชื่อไม่ได้", () => {
  const verdict = evaluateArCharge(account({ status: "CLOSED" }), 100);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "CLOSED");
});

test("วงเงิน 0 = เปิดบัญชีไว้แต่ยังขายเชื่อไม่ได้", () => {
  // ค่าปริยายของบัญชีใหม่คือ 0 — ต้องไปตั้งวงเงินก่อน ไม่ใช่ปล่อยเชื่อได้ทันทีที่เปิดบัญชี
  const verdict = evaluateArCharge(account({ creditLimit: 0 }), 1);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "LIMIT_EXCEEDED");
});

test("ยอดติดลบ (ร้านค้างลูกค้า) ถูกหักกลบให้อัตโนมัติ", () => {
  // เกิดจากคืนของหลังจ่ายครบ · ไม่หักกลบ = ลูกค้าเสียวงเงินไปเปล่า ๆ ทั้งที่ร้านเป็นฝ่ายค้าง
  const verdict = evaluateArCharge(account({ creditLimit: 1_000, balance: -200 }), 1_100);
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.availableCredit, 100);
});

test("คู่ตัวเลขที่บวกกันแล้วเกินเพราะเลขทศนิยมของ JS ต้องยังผ่าน", () => {
  // 259.30 + 55.29 = 314.59000000000003 ในเลขทศนิยมของ JS · ทั้งสองก้อนเป็นสตางค์
  // ลงตัวและวงเงินก็พอดีเป๊ะ แต่ถ้าเทียบโดยไม่ปัดกลับเป็น 2 ตำแหน่งจะถูกตีตกว่าเกิน
  // วงเงิน — และเกิดแบบสุ่มตามคู่ตัวเลข จนอธิบายกับเจ้าของร้านไม่ได้
  const verdict = evaluateArCharge(account({ creditLimit: 314.59, balance: 259.3 }), 55.29);
  assert.equal(verdict.ok, true, "ยอดที่พอดีเป๊ะถูกปฏิเสธเพราะเศษเลขทศนิยม");
});

test("เกินวงเงินแค่สตางค์เดียวก็ยังต้องถูกปฏิเสธ — การปัดต้องไม่กลายเป็นวงเงินแถม", () => {
  const verdict = evaluateArCharge(account({ creditLimit: 314.59, balance: 259.3 }), 55.3);
  assert.equal(verdict.ok, false);
});

test("ลดวงเงินหลังลูกค้าเป็นหนี้เกินไปแล้ว = ขายเชื่อเพิ่มไม่ได้", () => {
  // เกิดจริงเมื่อผู้จัดการหั่นวงเงินของลูกค้าที่ค้างนาน · ต้องไม่กลายเป็น "วงเงินติดลบ"
  // ที่คำนวณต่อไปเรื่อย ๆ แต่ต้องหยุดการปล่อยเชื่อทันที
  const verdict = evaluateArCharge(account({ creditLimit: 1_000, balance: 5_000 }), 1);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.code, "LIMIT_EXCEEDED");
});

test("ยอด 0 หรือติดลบไม่ควรผ่านเป็นการขายเชื่อ (ผู้เรียกกันไว้อีกชั้น)", () => {
  // evaluateArCharge ไม่ใช่ด่านของเรื่องนี้ แต่ต้องไม่ระเบิด — chargeArInTx โยน error เอง
  assert.equal(evaluateArCharge(account(), 0).ok, true);
});

// ---------------------------------------------------------------
// 'CREDIT' ต้องไม่ใช่เงินในลิ้นชัก
// ---------------------------------------------------------------

test("สูตรเงินที่ควรมีในลิ้นชักนับเฉพาะ method = 'CASH'", () => {
  const pos = read("apps/web/lib/bms/pos.ts");
  const start = pos.indexOf("export async function drawerExpectedInTx");
  assert.ok(start > 0, "หา drawerExpectedInTx ไม่เจอ — เทสนี้ต้องตามไปแก้");
  const body = pos.slice(start, pos.indexOf("export type VoidPosSaleResult", start));

  // ยอดขายที่เข้าลิ้นชักต้องกรองด้วย CASH ตรง ๆ
  assert.match(body, /pay\.method = 'CASH'/);
  assert.match(body, /a\.method = 'CASH'/);
  // และต้องไม่มีการอ้าง CREDIT/STORE_CREDIT เข้ามาในสูตรนี้เลย
  assert.ok(
    !/'CREDIT'|'STORE_CREDIT'/.test(body),
    "สูตรเงินในลิ้นชักอ้างถึงวิธีชำระที่ไม่ใช่เงินสด — ยอดปิดกะจะเกินจริงทุกวันที่ขายเชื่อ"
  );
});

test("การคืนของบิลเชื่อต้องปิดรายการทันที ไม่ค้างเป็น PENDING", () => {
  // ค้าง PENDING = ปิดกะไม่ได้จนกว่าจะมีคนกดยืนยัน "คืนเงิน" ที่ไม่มีเงินให้คืน
  const pos = read("apps/web/lib/bms/pos.ts");
  assert.match(
    pos,
    /const completed = payment\.method === "CASH" \|\| payment\.method === "CREDIT";/,
    "การคืนบิลเชื่อไม่ได้ถูกทำเครื่องหมายว่าจบแล้ว"
  );
});

test("ขายเชื่อต้องถูกตรวจก่อนสร้างบิล ไม่ใช่หลังจากสต็อกถูกจอง", () => {
  const pos = read("apps/web/lib/bms/pos.ts");
  const precheck = pos.indexOf("precheckArCharge(");
  const createOrder = pos.indexOf("const created = await createOrder({");
  assert.ok(precheck > 0 && createOrder > 0);
  assert.ok(
    precheck < createOrder,
    "ด่านวงเงินอยู่หลัง createOrder — บิลที่ถูกปฏิเสธจะทิ้งสต็อกที่จองไว้"
  );
});

test("การตั้งหนี้ต้องอยู่หลังการตัดสต็อกเสมอ (ลำดับล็อกกัน deadlock)", () => {
  // เส้นทางคืนของล็อกสต็อกก่อนแล้วค่อยลดหนี้ · ถ้าเส้นทางขายกลับลำดับ สองบิลของ
  // ลูกค้าคนเดียวกันที่เดินพร้อมกันจะจับคู่ล็อกไขว้กันแล้วได้ 40P01 กลางเคาน์เตอร์
  const pos = read("apps/web/lib/bms/pos.ts");
  const fulfil = pos.indexOf("const fulfilled = await fulfilPosOrderInTx(");
  const charge = pos.indexOf("await chargeArInTx(");
  assert.ok(fulfil > 0 && charge > 0);
  assert.ok(charge > fulfil, "chargeArInTx ถูกเรียกก่อนตัดสต็อก — ลำดับล็อกกลับกับเส้นทางคืนของ");
});

test("route ขายเชื่อรับผู้อนุมัติจาก PIN ที่ตรวจแล้ว ไม่ใช่ id ดิบจาก body", () => {
  const route = read("apps/web/app/api/pos/sale/route.ts");
  assert.match(route, /creditApprovedBy = approver\.userId/);
  assert.match(route, /cashierHasPermission\(device\.tenantId, approver\.userId, "ar\.sell"\)/);
  assert.ok(
    !/creditApprovedBy:\s*body\./.test(route),
    "route ส่ง id ผู้อนุมัติจาก body ตรง ๆ — ใครก็อ้างว่าหัวหน้าอนุมัติได้"
  );
});

test("รับชำระหนี้ที่เคาน์เตอร์ต้องเอากะจากตัวเครื่อง ไม่ใช่จาก body", () => {
  // รับ shiftId จาก body ได้ = เครื่องหนึ่งยัดเงินเข้ากะของอีกเครื่องได้
  const route = read("apps/web/app/api/pos/ar/collect/route.ts");
  assert.match(route, /shiftId: shift\?\.id \?\? null/);
  assert.ok(
    !/body\.shiftId/.test(route),
    "route รับ shiftId จาก body — เงินสดจะเข้าลิ้นชักผิดกะ"
  );
  assert.ok(
    !/body\.tenantId/.test(route),
    "route รับ tenant จาก body — ห้ามให้ client บอกว่าตัวเองเป็นร้านไหน"
  );
});

test("รับชำระซ้ำต้องล็อกคีย์ tenant-wide และยอม replay เฉพาะคำขอเดิม", () => {
  const ar = read("apps/web/lib/bms/ar.ts");
  assert.match(
    ar,
    /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/,
    "ไม่มี advisory lock ต่อ idempotency key — คำขอชนกันอาจกลายเป็น unique-constraint 500"
  );
  assert.match(ar, /request_hash !== requestHash/);
  assert.match(ar, /status: "IDEMPOTENCY_CONFLICT"/);
  assert.ok(
    ar.indexOf("pg_advisory_xact_lock") < ar.indexOf("SELECT id, account_id, request_hash FROM bms_ar_receipts"),
    "ต้องล็อกคีย์ก่อนอ่าน replay ไม่ใช่หลังแตะ state ไปแล้ว"
  );
});
