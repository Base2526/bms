-- =============================================================
-- 10.59  BMS Mail Log — รับ provider = 'smtp'
-- -------------------------------------------------------------
-- lib/mailer.ts เพิ่ม MAIL_PROVIDER=smtp (SMTP relay ทั่วไป: Resend, Amazon SES,
-- Postmark, Brevo, Mailgun) แต่ 7.40 สร้าง CHECK ไว้เป็น ('sendgrid', 'gmail')
--
-- ไม่ apply = อีเมลยังส่งออกได้ปกติ แต่ recordMailLog() จะ INSERT ไม่ผ่าน CHECK แล้ว
-- กลืน error ไว้ (best-effort โดยออกแบบ) → หน้า /admin/mail-log ไม่มีอีเมลที่ส่งผ่าน
-- smtp สักฉบับ ทั้งที่ส่งจริง · ต้อง apply ก่อนตั้ง MAIL_PROVIDER=smtp
--
-- หา CHECK ด้วยเงื่อนไขแคบ (single-column บน provider และ def มี 'sendgrid') แทนการ
-- อ้างชื่อ constraint ตรง ๆ — ชื่อ auto-generated อาจต่างกันระหว่างฐาน และกันลบ CHECK ผิดตัว
-- (กับดักเดียวกับที่ 9.52/9.57 จดไว้)
--
-- ROLLBACK (ทำได้เฉพาะเมื่อยังไม่มีแถว provider='smtp'):
--   SELECT count(*) FROM bms_mail_log WHERE provider = 'smtp';   -- ต้องเป็น 0
--   ALTER TABLE bms_mail_log DROP CONSTRAINT bms_mail_log_provider_check;
--   ALTER TABLE bms_mail_log ADD CONSTRAINT bms_mail_log_provider_check
--     CHECK (provider IN ('sendgrid', 'gmail'));
-- =============================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.conrelid = 'public.bms_mail_log'::regclass
       AND con.contype = 'c'
       AND array_length(con.conkey, 1) = 1
       AND att.attname = 'provider'
       AND pg_get_constraintdef(con.oid) LIKE '%sendgrid%'
  LOOP
    EXECUTE format('ALTER TABLE public.bms_mail_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE bms_mail_log
  ADD CONSTRAINT bms_mail_log_provider_check
  CHECK (provider IN ('sendgrid', 'gmail', 'smtp'));
