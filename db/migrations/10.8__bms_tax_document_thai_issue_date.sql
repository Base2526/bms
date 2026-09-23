-- =============================================================
-- 10.8  วันที่ของเอกสารภาษีเป็นวันที่ไทย ไม่ใช่วันที่ของเซิร์ฟเวอร์
-- -------------------------------------------------------------
-- ต้นเหตุ: container และ Postgres รันเป็น UTC · `issue_date` ใช้ DEFAULT CURRENT_DATE
-- (7.88) → เอกสารที่ออกช่วง 00:00–06:59 น. เวลาไทยได้วันที่ของ "เมื่อวาน"
-- รายงานภาษีขายแบ่งเดือนด้วยคอลัมน์นี้ บิลตอน 00:30 น. วันที่ 1 จึงตกไปอยู่ในเดือนก่อน
-- (ฐาน dev มี 6 จาก 17 ใบที่ผิด ณ วันที่เขียนไฟล์นี้)
--
-- โค้ดชุดเดียวกันนี้เขียน issue_date เองแล้วทุกเส้นทาง (taxDocumentNumber.ts) ไฟล์นี้:
--   1. เปลี่ยน DEFAULT ให้ถูกด้วย เผื่อผู้เขียนรายอื่นที่ไม่ได้ส่งค่า
--   2. แก้แถวเก่าให้ตรงกับวันที่ไทยของ issued_at — ใบเสร็จที่พิมพ์ให้ลูกค้าแสดงวันเวลา
--      ไทยจาก issued_at อยู่แล้ว การแก้จึงทำให้ฐานข้อมูลตรงกับกระดาษ ไม่ได้เปลี่ยนความหมาย
--
-- ❗ ไม่แตะ doc_no — เลขเอกสารที่ออกไปแล้วพิมพ์อยู่ในมือลูกค้า (6 หลักของวันที่ในเลข
--    ของใบเก่าจึงอาจเป็นวันที่ UTC ต่อไป ซึ่งยอมรับได้ เลขเป็นตัวระบุ ไม่ใช่วันที่)
-- ❗ เก็บค่าเดิมไว้ในตารางสำรองก่อนแก้ ใช้ย้อนกลับได้ (ดู ROLLBACK ท้ายไฟล์)
-- ❗ UPDATE นี้ยิง realtime trigger ของ bms_tax_documents หนึ่ง event ต่อแถวที่แก้
--    (เป็นแค่ hint ให้จอโหลดใหม่ ไม่มีผลกับเงิน) — จำนวนแถวเท่ากับบิลช่วงกลางดึก
--
-- ก่อนรัน (read-only) — ดูว่าจะแก้กี่แถว:
--   SELECT count(*) FROM bms_tax_documents
--    WHERE issue_date <> (issued_at AT TIME ZONE 'Asia/Bangkok')::date;
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_tax_documents_issue_date_backup_10_8 (
  document_id     UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  old_issue_date  DATE NOT NULL,
  new_issue_date  DATE NOT NULL,
  backed_up_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bms_tax_documents_issue_date_backup_10_8 IS
  'ค่า issue_date เดิมก่อน 10.8 แก้เป็นวันที่ไทย — ใช้ย้อนกลับเท่านั้น แอปไม่อ่านตารางนี้';

-- ตารางสำรองไม่ใช่ข้อมูลที่แอปใช้ — ปิดไม่ให้ role ของแอปอ่าน/เขียน
REVOKE ALL ON bms_tax_documents_issue_date_backup_10_8 FROM PUBLIC;

INSERT INTO bms_tax_documents_issue_date_backup_10_8 (document_id, tenant_id, old_issue_date, new_issue_date)
SELECT id, tenant_id, issue_date, (issued_at AT TIME ZONE 'Asia/Bangkok')::date
  FROM bms_tax_documents
 WHERE issue_date <> (issued_at AT TIME ZONE 'Asia/Bangkok')::date
ON CONFLICT (document_id) DO NOTHING;

UPDATE bms_tax_documents d
   SET issue_date = b.new_issue_date
  FROM bms_tax_documents_issue_date_backup_10_8 b
 WHERE b.document_id = d.id
   AND d.issue_date = b.old_issue_date;

ALTER TABLE bms_tax_documents
  ALTER COLUMN issue_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date);

COMMENT ON COLUMN bms_tax_documents.issue_date IS
  'วันที่ของเอกสารตามเวลาไทย (Asia/Bangkok) — รายงานภาษีแบ่งงวดด้วยคอลัมน์นี้ (10.8)';

COMMIT;

-- ตรวจหลังรัน (ต้องได้ 0):
--   SELECT count(*) FROM bms_tax_documents
--    WHERE issue_date <> (issued_at AT TIME ZONE 'Asia/Bangkok')::date;
--
-- ROLLBACK (คืนค่าเดิมจากตารางสำรอง):
-- BEGIN;
-- UPDATE bms_tax_documents d SET issue_date = b.old_issue_date
--   FROM bms_tax_documents_issue_date_backup_10_8 b
--  WHERE b.document_id = d.id AND d.issue_date = b.new_issue_date;
-- ALTER TABLE bms_tax_documents ALTER COLUMN issue_date SET DEFAULT CURRENT_DATE;
-- DROP TABLE bms_tax_documents_issue_date_backup_10_8;
-- COMMIT;
