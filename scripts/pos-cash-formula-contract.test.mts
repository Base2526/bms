// =============================================================
// เงินสดของกะมีสูตรเดียว — source contract (ไม่ต้องมี DB)
// -------------------------------------------------------------
// "เงินสดที่ควรมีในลิ้นชัก" ถูกคิดที่ห้าที่: ตอนกันไม่ให้จ่ายเกินลิ้นชัก (drawerExpectedInTx),
// ตอนปิดกะ (closePosShift), บนสรุปกะ X/Z (getPosShiftReport), บนหน้าภาพรวมกะหลังบ้าน
// (listPosShiftOverview) และบนไฟล์รายละเอียดกะ (getPosShiftExportData)
//
// ⚠️ ก่อนหน้านี้สามที่แรกคีย์ "การคืนเงินสด" ด้วย `COALESCE(pr.shift_id, o.pos_shift_id)`
// ส่วนอีกสองที่ใช้ `COALESCE(a.completed_shift_id, pr.shift_id, o.pos_shift_id)` ซึ่งคือกะที่
// **จ่ายเงินออกจริง** · การตัดรายการของออร์เดอร์ออนไลน์ (9.57) สร้าง allocation เป็น PENDING
// เสมอแม้วิธีจ่ายเป็นเงินสด แล้วมีคนมากดยืนยันจ่ายที่เครื่องทีหลัง — เงินออกจากลิ้นชักจริงแต่
// สูตรที่ตัดสิน "เงินที่ควรมี" มองไม่เห็น → ปิดกะแล้วเงินขาดเท่ายอดคืนโดยไม่มีอะไรอธิบาย
// และแผ่น "ตรวจสอบยอด" ในไฟล์ export บวกลงมาแล้วไม่เท่ากับยอดรวมที่พิมพ์อยู่บรรทัดล่าง
//
//   cd apps/web && npx tsx --test ../../scripts/pos-cash-formula-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

/** ตัดคอมเมนต์ออกก่อนสแกน — คอมเมนต์ที่อธิบายรูปแบบเก่าเคยทำให้เทสเขียวโดยโค้ดไม่มีอะไรเลย */
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

const REFUND_SHIFT_KEY = /COALESCE\(\s*a\.completed_shift_id,\s*pr\d?\.shift_id,\s*(?:o|ro)\d?\.pos_shift_id\s*\)/;

test("การคืนเงินสดเป็นของกะที่จ่ายเงินออกจริง ทุกที่ที่นับมันเป็นตัวเงิน", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));

  // ทุก statement ที่รวมยอด allocation ที่ COMPLETED เป็นตัวเงินของกะ ต้องคีย์ด้วย
  // completed_shift_id ก่อน · ตัวที่นับ PENDING ไม่ต้อง (ยังไม่ถูกจ่ายที่กะไหนเลย)
  const completedSums = pos.split("`").filter((sql) =>
    /FROM bms_pos_refund_allocations/.test(sql)
    && /SUM\(a\.amount\)/.test(sql)
    && /a\.status = 'COMPLETED'/.test(sql));
  assert.ok(completedSums.length >= 3,
    `คาดว่าจะมีจุดที่รวมยอดคืนที่จ่ายแล้วอย่างน้อย 3 จุด เจอ ${completedSums.length}`);
  for (const sql of completedSums) {
    assert.match(sql, REFUND_SHIFT_KEY,
      `ยังมีจุดที่คีย์ยอดคืนด้วยกะของใบคืนแทนกะที่จ่ายเงิน:\n${sql.slice(0, 400)}`);
  }
});

test("สูตรเงินสดในลิ้นชักมีชุดเดียว และปิดกะไม่คิดเอง", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));

  assert.match(pos, /const POS_SHIFT_CASH_SQL = `/);
  assert.match(pos, /export async function drawerCashComponentsInTx/);
  assert.match(pos, /export function drawerExpectedFrom/);

  // drawerExpectedInTx ต้องเป็นเพียงตัวห่อ ไม่ใช่สูตรที่สอง
  const drawer = pos.slice(
    pos.indexOf("export async function drawerExpectedInTx"),
    pos.indexOf("export async function drawerExpectedInTx") + 400
  );
  assert.match(drawer, /drawerExpectedFrom\(openingFloat, await drawerCashComponentsInTx\(/);

  // ปิดกะต้องใช้ตัวเดียวกัน ไม่ใช่ SELECT ของตัวเอง
  const close = pos.slice(
    pos.indexOf("export async function closePosShift"),
    pos.indexOf("export type PosSaleLine")
  );
  assert.match(close, /drawerCashComponentsInTx\(client, input\.tenantId, input\.shiftId\)/);
  assert.match(close, /drawerExpectedFrom\(Number\(open\.rows\[0\]\.opening_float\), cash\)/);
  assert.doesNotMatch(close, /pay\.method = 'CASH'/,
    "ปิดกะห้ามมี SELECT เงินสดของตัวเอง — เลขต้องมาจากสูตรเดียวกับที่จอบอกระหว่างกะ");
});

test("บิลที่ถูกยกเลิกถูกตัดออกทั้งขาขายและขาคืน ไม่ใช่นับทั้งคู่แล้วหักล้างกัน", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  const formula = pos.slice(pos.indexOf("const POS_SHIFT_CASH_SQL = `"));
  const body = formula.slice(0, formula.indexOf("`;"));

  assert.match(body, /o\.voided_at IS NULL/);
  assert.match(body, /pr\.is_void = FALSE/);
  assert.match(body, REFUND_SHIFT_KEY);
});

test("ไฟล์รายละเอียดกะต้องแสดงใบคืนที่จ่ายเงินในกะนี้ด้วย ไม่ใช่เฉพาะใบที่รับคืนในกะนี้", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  const exportFn = pos.slice(
    pos.indexOf("export async function getPosShiftExportData"),
    pos.indexOf("export type PosNoSale")
  );
  assert.match(exportFn, /COALESCE\(pr\.shift_id, o\.pos_shift_id\) = \$2 OR a\.completed_shift_id = \$2/,
    "แผ่นรายละเอียดต้องมีแถวของเงินที่ออกจากลิ้นชักกะนี้ ไม่งั้นยอดรวมกับรายการไม่ตรงกัน");
});

test("หน้าภาพรวมกะคิดเงินสดด้วยกติกาเดียวกับเครื่อง — บิลที่ถูกยกเลิกไม่นับเป็นเงินในลิ้นชัก", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));

  // ⚠️ หน้านี้เขียน query ของตัวเอง (lateral ต่อแถว) ไม่ได้ใช้ POS_SHIFT_CASH_SQL จึงต้องมีด่านของตัวเอง
  // ก่อนแก้ subquery ของ cash_sales ไม่กรอง voided_at เลย ขณะที่สูตรกลางกรอง และขา "คืนเงิน" ก็ตัด
  // ใบ void ออกด้วย pr.is_void = FALSE ทั้งสองที่ → บิลเงินสดที่ถูก void ถูกนับเป็นเงินขาเข้าโดยไม่มี
  // ขาออกมาหักล้าง = ผู้จัดการเห็น "เงินที่ควรมี" สูงกว่าที่เครื่องบอกเท่ายอดบิลที่ยกเลิก
  // แล้วไปตามหาเงินที่ไม่เคยหาย
  const overview = pos.slice(
    pos.indexOf("function posShiftOverviewBaseSql"),
    pos.indexOf("export async function listPosShiftOverview")
  );
  assert.ok(overview.length > 0, "ไม่พบช่วงของ query หน้าภาพรวมกะ — เล็งเทสใหม่");

  // ⚠️ เล็งที่ subquery ของ bms_payments ตรง ๆ — คอลัมน์ชั้นนอกก็ชื่อ AS cash_sales เหมือนกัน
  // (COALESCE(o.cash_sales, 0) AS cash_sales) การหาจากชื่อ alias จะได้ตัวชั้นนอกที่ไม่มี WHERE เลย
  const paySubStart = overview.indexOf("FROM bms_payments");
  assert.ok(paySubStart > 0, "ไม่พบ subquery ของ cash_sales — เล็งเทสใหม่");
  const afterPay = overview.slice(paySubStart);
  const cashSalesSub = afterPay.slice(0, afterPay.indexOf("AS cash_sales"));
  assert.ok(cashSalesSub.length > 0, "ไม่พบปลายของ subquery cash_sales — เล็งเทสใหม่");
  assert.match(cashSalesSub, /pay\.method = 'CASH'/, "subquery ที่เล็งไม่ใช่ตัวที่รวมเงินสด — เล็งเทสใหม่");
  assert.match(cashSalesSub, /voided_at IS NULL/,
    "cash_sales ของหน้าภาพรวมกะต้องตัดบิลที่ถูกยกเลิกออก เหมือน POS_SHIFT_CASH_SQL");

  // เลขคณิตต้องมีชุดเดียว: ตัวห่อของหน้านี้ต้องเรียก drawerExpectedFrom ไม่ใช่คิดเอง
  const expectedFn = pos.slice(pos.indexOf("const expected = (row: any) =>"));
  const body = expectedFn.slice(0, expectedFn.indexOf("};"));
  assert.ok(body.length > 0, "ไม่พบตัวห่อ expected() — เล็งเทสใหม่");
  assert.match(body, /drawerExpectedFrom\(/,
    "หน้าภาพรวมกะต้องคิดเงินที่ควรมีด้วย drawerExpectedFrom ไม่ใช่สูตรที่สอง");
  assert.doesNotMatch(body, /Number\(row\.cash_refunds\)\s*\+/,
    "เจอเลขคณิตของตัวเองในตัวห่อ — สองสูตรจะ drift แล้วสองหน้าจอตอบไม่ตรงกัน");
});

test("สรุปกะต้องมีบรรทัดปัดเศษเงินสด ไม่งั้นยอดขายกับผลรวมวิธีชำระไม่มีทางเท่ากัน", async () => {
  const pos = code(await read("apps/web/lib/bms/pos.ts"));
  const page = code(await read("apps/web/app/(pos)/pos/page.tsx"));
  const exportSheet = code(await read("apps/web/lib/bms/posShiftExport.ts"));

  // bms_orders.total_amount ไม่รวมยอดปัดเศษโดยตั้งใจ แต่ bms_payments.amount รวม
  assert.match(pos, /roundingTotal: number;/);
  assert.match(pos, /SUM\(rounding_amount\) FILTER \(WHERE voided_at IS NULL\)/);
  assert.match(pos, /roundingTotal: Number\(s\.rounding \?\? 0\)/);
  assert.match(page, /shiftReport\.roundingTotal/);
  assert.match(exportSheet, /ปัดเศษเงินสด/);
});
