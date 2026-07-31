-- =============================================================
-- 7.38  bms_report_deliveries: เก็บ snapshot ของสิ่งที่ส่งจริง (subject/html/payload/text)
-- -------------------------------------------------------------
-- ก่อนหน้านี้ log เก็บแค่ status/error — พอส่งสำเร็จแล้ว ไม่มีทางย้อนดูว่าอีเมล/ข้อความ
-- ที่ส่งไปจริงมีเนื้อหาอะไรบ้าง (ตัวเลขคำนวณสดทุกครั้ง ไม่ได้ persist ไว้ที่ไหน)
-- เพิ่มคอลัมน์เดียว เก็บ snapshot ต่อช่องทาง ณ เวลาที่ส่งจริง ให้หน้า UI preview ย้อนหลังได้:
--   EMAIL -> {subject, html}   SLACK -> {payload: <slack block json>}   LINE -> {text}
-- ไม่มี PII ของลูกค้า (เป็นสรุปยอดขายของร้าน ไม่ใช่ข้อมูลรายบุคคล) จึง snapshot ได้ตรงๆ
-- แบบเดียวกับ bms_audit_log.meta (JSON.stringify ผ่าน query() เดิม ไม่มี logic parse พิเศษ)
-- =============================================================

ALTER TABLE bms_report_deliveries ADD COLUMN IF NOT EXISTS payload_snapshot JSONB;
