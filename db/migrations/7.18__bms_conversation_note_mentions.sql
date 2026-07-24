-- =============================================================
-- 7.18  BMS Inbox — @mention staff ในโน้ตภายใน (bms_conversation_notes)
-- -------------------------------------------------------------
-- mention เป็น explicit picker ฝั่ง client (ไม่ regex-parse ข้อความ) —
--   mutation bmsAddConversationNote รับ mentionedUserIds แยกจาก body ตรงๆ
--   กันปัญหาชื่อซ้ำ/สะกดผิดในข้อความ, "@ชื่อ" ที่แทรกใน body เป็นแค่ display เฉยๆ
-- แยกตารางจาก bms_conversation_notes เดิม (ไม่เติมคอลัมน์ลง note) เพื่อรองรับ
--   1 โน้ต mention ได้หลายคน + เก็บสถานะอ่านแล้ว/ยังต่อคน (read_at) แยกกัน —
--   ใช้ต่อยอด "mention ของฉัน"/unread badge ได้ในอนาคตโดยไม่ต้อง migration เพิ่ม
-- แจ้งเตือนจริงใช้ระบบ notifications เดิม (lib/notifications/service.ts +
--   notificationCreated subscription) ไม่สร้าง pubsub topic ใหม่ซ้ำซ้อน —
--   ตารางนี้เป็นแค่ log/สถานะอ่านแล้ว ไม่ใช่ตัวส่ง realtime
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_conversation_note_mentions (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  note_id           BIGINT NOT NULL REFERENCES bms_conversation_notes(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bms_note_mentions_note ON bms_conversation_note_mentions(note_id);
CREATE INDEX IF NOT EXISTS idx_bms_note_mentions_unread
  ON bms_conversation_note_mentions(tenant_id, mentioned_user_id, read_at);

-- ---- RLS (เหมือน 5.5/6.1) ----
ALTER TABLE bms_conversation_note_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_conversation_note_mentions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_conversation_note_mentions_tenant_isolation ON bms_conversation_note_mentions;
CREATE POLICY bms_conversation_note_mentions_tenant_isolation ON bms_conversation_note_mentions
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_conversation_note_mentions TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
