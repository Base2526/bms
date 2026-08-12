-- =============================================================
-- 7.79  ซ่อม template อีเมลรีเซ็ตรหัสผ่าน (auth.reset) ที่ส่งออกไปเป็นอีเมลเนื้อว่าง
-- -------------------------------------------------------------
-- อาการที่เจอจริง: ผู้ใช้กด "ลืมรหัสผ่าน" แล้วได้อีเมลที่มีแต่หัวข้อ
-- ("Reset your password - จ่าเฉย (JACHOEI)") เนื้อในว่างทั้งฉบับ ไม่มีลิงก์รีเซ็ตเลย
--
-- สาเหตุ: DB นี้สืบทอดมาจากโปรเจกต์เดิม จึงมีแถว `auth.reset` เวอร์ชัน 1 ของเดิมค้างอยู่ (หัวข้อมี
-- `{{app_name}}` ซึ่งไม่มีอยู่ใน migration ไหนของ repo นี้เลย) แถวนั้นอ้างตัวแปรที่โค้ดปัจจุบัน
-- (`lib/passwordReset.ts`) ไม่ได้ส่งเข้าไป — Mustache แทนตัวแปรที่ไม่มีด้วยสตริงว่าง จึงเหลือแต่
-- โครง HTML เปล่า ๆ · และเพราะ `7.67__auth_reset_email_template.sql` ใช้
-- `ON CONFLICT (key, locale, version) DO NOTHING` การ INSERT แถวที่ถูกต้องของ 7.67 จึง
-- **ถูกข้ามไปเงียบ ๆ** เพราะชนกับแถวเก่าที่เป็น version 1 อยู่แล้ว → ระบบยังใช้แถวเสียตัวเดิมตลอด
-- (`getLatestEmailTemplate()` เลือกด้วย `ORDER BY version DESC` จากแถวที่ is_active/is_published)
--
-- ตรวจก่อนรัน (read-only) เพื่อดูว่าเครื่องนี้มีแถวเสียจริงไหม:
--   SELECT id, key, locale, version, is_active, is_published, subject_tpl,
--          (html_tpl LIKE '%reset_url%') AS has_reset_url, length(html_tpl) AS html_len
--     FROM email_templates WHERE key = 'auth.reset' ORDER BY locale, version;
--
-- migration นี้ idempotent: รันซ้ำได้ผลเดิม (DO UPDATE บังคับเนื้อหาให้ถูก)
-- ไม่แตะ template key อื่น และไม่ลบแถวใด ๆ (แค่ปิด is_active ของแถวที่ใช้ไม่ได้ เพื่อให้ย้อนดูได้)
-- =============================================================

-- 1) ปิดใช้งานแถว auth.reset ที่ "ไม่มีลิงก์รีเซ็ต" — อีเมลรีเซ็ตรหัสผ่านที่ไม่มี {{{reset_url}}}
--    ใช้งานไม่ได้โดยนิยาม ไม่ว่าเนื้อหาที่เหลือจะเป็นอะไร
UPDATE email_templates
   SET is_active = FALSE,
       updated_at = now()
 WHERE key = 'auth.reset'
   AND html_tpl NOT LIKE '%reset_url%'
   AND is_active = TRUE;

-- 2) บังคับให้แถวที่ถูกต้องมีอยู่จริงและเนื้อหาตรงกับตัวแปรที่ `lib/passwordReset.ts` ส่งเข้ามา
--    (user_name, reset_url, expiry_minutes) — ใช้ DO UPDATE ไม่ใช่ DO NOTHING เพื่อไม่ให้เกิด
--    ปัญหาเดิมซ้ำรอยกับ 7.67 ที่ถูกแถวเก่าบล็อกไว้เงียบ ๆ
INSERT INTO email_templates
  (key, locale, version, is_active, is_published, subject_tpl, html_tpl, text_tpl)
VALUES
  (
    'auth.reset', 'th', 2, TRUE, TRUE,
    'รีเซ็ตรหัสผ่านของคุณ - {{app_name}}',
    '<h2>รีเซ็ตรหัสผ่าน</h2><p>สวัสดี {{user_name}}</p><p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p><p><a href="{{{reset_url}}}">รีเซ็ตรหัสผ่าน</a></p><p>ลิงก์นี้มีอายุ {{expiry_minutes}} นาที</p><p>ถ้าคุณไม่ได้ร้องขอการรีเซ็ต ให้ละเว้นอีเมลฉบับนี้ได้เลย</p>',
    'รีเซ็ตรหัสผ่าน: {{{reset_url}}} (ลิงก์มีอายุ {{expiry_minutes}} นาที)'
  ),
  (
    'auth.reset', 'en', 2, TRUE, TRUE,
    'Reset your password - {{app_name}}',
    '<h2>Reset your password</h2><p>Hello {{user_name}},</p><p>Use the link below to set a new password:</p><p><a href="{{{reset_url}}}">Reset password</a></p><p>This link expires in {{expiry_minutes}} minutes.</p><p>If you did not request this, you can ignore this email.</p>',
    'Reset your password: {{{reset_url}}} (expires in {{expiry_minutes}} minutes)'
  )
ON CONFLICT (key, locale, version) DO UPDATE
   SET is_active    = TRUE,
       is_published = TRUE,
       subject_tpl  = EXCLUDED.subject_tpl,
       html_tpl     = EXCLUDED.html_tpl,
       text_tpl     = EXCLUDED.text_tpl,
       updated_at   = now();

-- ตรวจหลังรัน: แถวที่ระบบจะใช้จริงต่อ locale ต้องเป็น version 2 และ has_reset_url = true
--   SELECT DISTINCT ON (locale) locale, version, subject_tpl,
--          (html_tpl LIKE '%reset_url%') AS has_reset_url
--     FROM email_templates
--    WHERE key = 'auth.reset' AND is_active AND is_published
--    ORDER BY locale, version DESC;
