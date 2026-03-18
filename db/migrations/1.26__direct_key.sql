รันครั้งที่ 1

-- 1) เพิ่มคอลัมน์
ALTER TABLE chats ADD COLUMN IF NOT EXISTS direct_key text;

-- 2) (แนะนำ) ใส่ CHECK ให้ 1:1 ต้องมี direct_key
-- ALTER TABLE chats
--   ADD CONSTRAINT IF NOT EXISTS chats_direct_key_chk
--   CHECK (is_group = true OR direct_key IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chats_direct_key_chk'
  ) THEN
    ALTER TABLE chats
      ADD CONSTRAINT chats_direct_key_chk
      CHECK (is_group = true OR direct_key IS NOT NULL);
  END IF;
END$$;


-- 3) สร้าง unique index เฉพาะห้อง 1:1
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_uq
ON chats (direct_key)
WHERE is_group = false;

CREATE UNIQUE INDEX IF NOT EXISTS chat_members_uq ON chat_members(chat_id, user_id);


รันครั้งที่ 2

-- 1) เพิ่มคอลัมน์
ALTER TABLE chats ADD COLUMN IF NOT EXISTS direct_key text;

-- 2) ทำ unique index แบบไม่ partial (สำคัญ)
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_uq
ON chats (direct_key);

-- 3) (แนะนำ) ให้ chat_members กันซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_uq
ON chat_members(chat_id, user_id);

DROP INDEX IF EXISTS chats_direct_key_uq_partial;
-- (ชื่อ index ของคุณอาจไม่ใช่นี้ ให้ดูชื่อจริงด้วย \di ใน psql)
