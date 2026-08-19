// =============================================================
// ตะกร้าที่พิมพ์เป็นรายการล้วน ๆ ไม่มีคำกริยาสั่งซื้อ
// -------------------------------------------------------------
// รูปแบบนี้คือรูปแบบที่ **บอทของเราสอนลูกค้าเอง** เมื่อถูกถามว่าสั่งหลายรายการยังไง
// แต่ทั้ง understand() (ต้องเห็น ORDER_HINT) และ isExplicitPharmacyProductRequest()
// (ต้องเห็นคำกริยาขอซื้อ) เคยตกมันทั้งคู่ → ไม่มีเส้นทาง deterministic ไหนรับเลย
//
// ไม่ต่อ network ไม่ต่อ DB
// =============================================================
import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeRequestedItemList } from "../../apps/web/lib/bms/requestedItems.ts";
import { isExplicitPharmacyProductRequest } from "../../apps/web/lib/bms/pharmacy/trigger.ts";

const REAL_CUSTOMER_MESSAGE =
  "**พาราเซตามอล 500 มก. ไซซ์ 10 เม็ด 5 แผง, พาราเซตามอล 500 มก. ไซซ์ 100 เม็ด 2 กล่อง, ยาแก้ท้องอืด โดมเพอริโดน ไซซ์ 10 เม็ด 3 กล่อง**";

test("ข้อความจริงจาก production ต้องถูกอ่านว่าเป็นรายการสั่งซื้อ", () => {
  assert.equal(looksLikeRequestedItemList(REAL_CUSTOMER_MESSAGE), true);
});

test("ต้องมีจำนวน+หน่วยครบทุกท่อน ไม่ใช่แค่ท่อนใดท่อนหนึ่ง", () => {
  // ท่อนที่ 2 ไม่มีจำนวน → ยังไม่ใช่รายการที่พร้อม ต้องไปให้คนถามต่อ
  assert.equal(looksLikeRequestedItemList("พารา 5 แผง, ยาแดง"), false);
  // ท่อนที่ 2 มีจำนวนแต่ไม่มีหน่วย
  assert.equal(looksLikeRequestedItemList("พารา 5 แผง, ยาแดง 2"), false);
  assert.equal(looksLikeRequestedItemList("พารา 5 แผง, ยาแดง 2 ขวด"), true);
});

test("รายการเดียวไม่นับ — เส้นทางสินค้าเดี่ยวเดิมจัดการอยู่แล้ว", () => {
  assert.equal(looksLikeRequestedItemList("พารา 5 แผง"), false);
});

test("ประโยคยาวที่มีจำนวนโผล่มาลอย ๆ ต้องไม่ถูกอ่านว่าเป็นตะกร้า", () => {
  assert.equal(
    looksLikeRequestedItemList("อยากถามว่าถ้าสั่ง 2 ขวด ค่าส่งเท่าไหร่คะ"),
    false
  );
  assert.equal(looksLikeRequestedItemList("ร้านเปิดกี่โมงคะ"), false);
  assert.equal(looksLikeRequestedItemList(""), false);
});

test("ร้านยา: รายการไม่มีคำกริยาต้องเข้าถึงเส้นทาง catalog ได้", () => {
  // เดิมคืน false เพราะไม่มีคำกริยา — ระเบิดเวลา: ถ้าร้านเพิ่ม "ท้องอืด" เป็น triggerTerm
  // ตะกร้าทั้งใบจะถูกแทนด้วยคำถามคัดกรองโดยลูกค้าไม่รู้ว่ารายการหายไปไหน
  assert.equal(isExplicitPharmacyProductRequest(REAL_CUSTOMER_MESSAGE), true);
  assert.equal(
    isExplicitPharmacyProductRequest("พาราเซตามอล 500 มก. 5 แผง, ยาแดง 2 ขวด"),
    true
  );
});

test("ด่านคลินิกไม่ถูกผ่อน: ยาตามอาการแบบกว้างยังต้องให้เภสัชกรคัดกรอง ทั้งตะกร้า", () => {
  // ท่อนแรกเป็นสินค้าที่ระบุชื่อชัด แต่ท่อนที่สองเป็นยาตามอาการให้เด็ก
  // ต้องไม่ให้ท่อนแรกพาท่อนที่สองผ่านการคัดกรองไปด้วย
  assert.equal(
    isExplicitPharmacyProductRequest("พาราเซตามอล 5 แผง, ยาแก้ไอให้ลูก 1 ขวด"),
    false
  );
  assert.equal(
    isExplicitPharmacyProductRequest("พาราเซตามอล 5 แผง, ยาแก้ท้องเสีย 2 ซอง"),
    false
  );
});

test("คำกริยาสั่งซื้อยังทำงานเหมือนเดิม (ไม่ได้ไปแทนที่ด่านเดิม)", () => {
  assert.equal(isExplicitPharmacyProductRequest("อยากได้ พาราเซตามอล 1 แผง"), true);
  assert.equal(isExplicitPharmacyProductRequest("ปวดหัวมาก 3 วันแล้ว ทำไงดี"), false);
});
