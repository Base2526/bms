-- =============================================================
-- 7.16  ลบ legacy revision triggers ที่ชนกับ BMS revision (7.0)
-- -------------------------------------------------------------
-- ปัญหา: 7.0__bms_revision_helpers.sql ทำ CREATE OR REPLACE FUNCTION
--   trg_generic_revision() ทับฟังก์ชันชื่อเดียวกันของ "revision ระบบเก่า"
--   ฟังก์ชันใหม่ INSERT ... (id, tenant_id, editor_id, revision_id, snapshot, ...)
--   แต่ตาราง *_revisions ของระบบเก่า (users/posts/comments/post_*) มีสคีมาคนละแบบ
--   (users_id/editor_id/snapshot — ไม่มี tenant_id) → ทุกครั้งที่ UPDATE ตารางเหล่านี้
--   จะ error: column "tenant_id" of relation "users_revisions" does not exist
--   (เจอตอนบันทึกโปรไฟล์ /admin/profile — และจะเจอกับการแก้ post/comment ด้วย)
--
-- ทำไม "drop" ไม่ใช่ "fix ให้ทำงาน":
--   1) trigger เหล่านี้ตอนนี้มีแต่ทำให้ UPDATE พัง (ไม่ได้ revision อะไรได้จริงตั้งแต่ 7.0)
--   2) users อยู่นอกสโคป BMS revision (ดู 7.x — เฉพาะ bms_* เท่านั้น)
--   3) ถ้าปล่อยให้ snapshot users ได้ จะเก็บ to_jsonb(OLD) รวม password_hash ลง
--      users_revisions = ช่องโหว่ความปลอดภัย — จึงไม่ควร revision ตาราง users เลย
-- ข้อมูลเก่าใน *_revisions (เช่น users_revisions 30 แถว) เก็บไว้เป็น history เฉย ๆ (inert)
-- ถ้าภายหลังต้องการ revision ตาราง legacy จริง ต้องออกแบบฟังก์ชัน/ตารางใหม่แยก (และห้าม snapshot password_hash)
-- =============================================================

DROP TRIGGER IF EXISTS users_rev_trg               ON users;
DROP TRIGGER IF EXISTS posts_rev_trg               ON posts;
DROP TRIGGER IF EXISTS comments_rev_trg            ON comments;
DROP TRIGGER IF EXISTS post_seller_accounts_rev_trg ON post_seller_accounts;
DROP TRIGGER IF EXISTS post_tel_numbers_rev_trg    ON post_tel_numbers;
