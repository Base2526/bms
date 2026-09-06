-- =============================================================
-- 9.62 — QR โต๊ะหมดอายุตอน "ปิดบิลจริง" เท่านั้น ไม่ใช่ตอนเริ่มกดคิดเงิน
-- -------------------------------------------------------------
-- ⚠️ นี่คือการแก้บั๊กทำลายข้อมูลของ 9.60 — apply ก่อนใครเพื่อนได้เลย
--
-- 9.60 ติด trigger ไว้ว่า "ออกจากสถานะ OPEN เมื่อไหร่ = ปิดบิล" แล้วสั่งสองอย่าง:
-- ยกเลิก session ของโทรศัพท์ลูกค้าทุกเครื่องที่โต๊ะนั้น และเปลี่ยนคำขอที่ยังไม่ได้ตรวจ
-- (PENDING) เป็น EXPIRED · แต่ `bms_restaurant_checks.status` มี **สี่** ค่า และ
-- `CLOSING` (9.48) ไม่ใช่การปิดบิล — มันคือ "แคชเชียร์เพิ่งกดคิดเงิน" ซึ่งเป็นสถานะ
-- ชั่วคราวที่ `reopenClosingCheck()` คืนกลับเป็น OPEN ทุกครั้งที่การรับเงินไม่สำเร็จ
-- (ยอดไม่ตรง / เน็ตหลุด / กะปิดไปแล้ว — เรื่องปกติที่เคาน์เตอร์)
--
-- ผลจริงก่อนแก้ (ยืนยันด้วยการรันบนฐาน dev แล้ว rollback):
--   OPEN -> CLOSING  → submission กลายเป็น EXPIRED และ session ถูก revoke
--   CLOSING -> OPEN  → trigger ไม่ทำงาน (OLD.status ไม่ใช่ OPEN แล้ว) ของที่หายไม่กลับมา
-- แปลว่า **แค่กดคิดเงินพลาดหนึ่งครั้ง ออร์เดอร์ที่ลูกค้าส่งเข้ามาก็หายถาวร** —
-- หายแบบมองไม่เห็นด้วย เพราะกล่องขาเข้าของพนักงานอ่านเฉพาะ PENDING/ACCEPTED/REJECTED
-- ส่วนลูกค้าเห็นบนจอตัวเองว่า "หมดอายุ" โดยไม่มีใครสั่งอะไรผิด
--
-- แก้เป็น: หมดอายุเมื่อบิลไปถึงสถานะ **ปลายทาง** เท่านั้น (PAID / CANCELLED) ซึ่งเป็น
-- สองค่าเดียวกับที่ CHECK ของตารางบังคับว่าต้องมี closed_at · CLOSING จึงไม่แตะอะไรเลย
-- และเจตนาเดิมของ 9.60 (ปิดบิล = โทรศัพท์เก่าสั่งต่อไม่ได้ และคำขอค้างต้องออกจากคิว)
-- ยังอยู่ครบทุกประการ
--
-- ไม่มี schema เปลี่ยน · ไม่มี permission ใหม่ · ไม่แตะแถวข้อมูลเดิม
-- แถวที่ถูกทำให้ EXPIRED ไปแล้วก่อน apply ไฟล์นี้ **จงใจไม่กู้คืน** — เดาไม่ได้ว่าแถวไหน
-- หมดอายุเพราะบิลปิดจริง (ถูกต้อง) และแถวไหนหมดอายุเพราะบั๊กนี้ · การกู้ผิดตัวคือการ
-- ปลุกออร์เดอร์ของบิลที่จ่ายเงินไปแล้วขึ้นมาให้พนักงานกดรับซ้ำ ซึ่งแย่กว่าปล่อยไว้
--
-- ROLLBACK (คืนพฤติกรรมเดิมของ 9.60 — ไม่แนะนำ ดูเหตุผลข้างบน):
--   CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close()
--   RETURNS TRIGGER LANGUAGE plpgsql AS $$
--   BEGIN
--     IF OLD.status = 'OPEN' AND NEW.status <> 'OPEN' THEN
--       UPDATE bms_restaurant_qr_sessions
--          SET revoked_at = COALESCE(revoked_at, now())
--        WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND revoked_at IS NULL;
--       UPDATE bms_restaurant_qr_submissions
--          SET status = 'EXPIRED', updated_at = now()
--        WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND status = 'PENDING';
--     END IF;
--     RETURN NEW;
--   END $$;
-- =============================================================

CREATE OR REPLACE FUNCTION bms_expire_restaurant_qr_on_check_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- ⚠️ ห้ามเขียนเป็น "NEW.status <> 'OPEN'" อีก — CLOSING คือการ *เริ่ม* คิดเงิน
  -- ซึ่งย้อนกลับเป็น OPEN ได้ ส่วนสองค่านี้คือสถานะปลายทางที่ย้อนไม่ได้
  -- (ตรงกับ CHECK ของตาราง: status IN ('PAID','CANCELLED') = closed_at IS NOT NULL)
  IF NEW.status IN ('PAID', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE bms_restaurant_qr_sessions
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND revoked_at IS NULL;
    UPDATE bms_restaurant_qr_submissions
       SET status = 'EXPIRED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND check_id = NEW.id AND status = 'PENDING';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION bms_expire_restaurant_qr_on_check_close() IS
  'Expires table QR sessions and unreviewed customer proposals when a dine-in check reaches a '
  'terminal status. CLOSING is a reversible settlement claim (9.48) and deliberately does nothing.';
