-- =============================================================
-- 6.1  BMS Inbox — มอบหมาย staff หลัก + คนช่วยตอบ (helpers) + auto-assign
-- -------------------------------------------------------------
-- assigned_to (TEXT อีเมลอิสระ ของเดิม) → เก็บไว้เฉย ๆ (ไม่ใช้ต่อ) เปลี่ยนมา
--   ผูกกับ users จริงผ่าน assigned_to_user_id เพื่อโชว์ avatar/ชื่อ + เลือกจาก
--   dropdown ได้ (lib/bms/inbox.ts จะหยุดอ่าน/เขียน assigned_to เดิม)
-- bms_conversation_helpers = ทีมที่ช่วยตอบ (many-to-many แยกจาก staff หลัก
--   1 คน — conversation ต้องมี assigned_to_user_id เสมอ, บังคับที่ชั้น
--   application: auto-assign ตอนแชทเข้าใหม่ + กันลบ user ที่ยังถือแชทค้าง)
-- users.is_available = staff พร้อมรับแชทใหม่ไหม (ใช้กรอง auto-assign เท่านั้น
--   ไม่กระทบแชทที่ถืออยู่แล้ว)
-- ประวัติการมอบหมาย/โอนใช้ bms_audit_log เดิม (target = conversation id,
--   action = 'inbox.assign' / 'inbox.helper_add' / 'inbox.helper_remove')
--   — ไม่สร้างตาราง log ใหม่ซ้ำซ้อน
-- =============================================================

ALTER TABLE bms_conversations
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_conv_assigned_user ON bms_conversations(tenant_id, assigned_to_user_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS bms_conversation_helpers (
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by        TEXT,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bms_conv_helpers_conv ON bms_conversation_helpers(conversation_id);
CREATE INDEX IF NOT EXISTS idx_bms_conv_helpers_user ON bms_conversation_helpers(tenant_id, user_id);

-- ---- RLS (เหมือน 5.5) ----
ALTER TABLE bms_conversation_helpers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_conversation_helpers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_conversation_helpers_tenant_isolation ON bms_conversation_helpers;
CREATE POLICY bms_conversation_helpers_tenant_isolation ON bms_conversation_helpers
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_conversation_helpers TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่: inbox.assign (โอน/เปลี่ยน staff หลัก แยกจาก inbox.manage
--   เดิม เพราะ Sales ต้องโอนแชทของตัวเองให้เพื่อนได้ แต่ไม่ควรได้ inbox.manage
--   เต็ม (แก้ status/tags/notes) ไปด้วย) ----
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','inbox.assign'),
  ('Sales','inbox.assign')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
