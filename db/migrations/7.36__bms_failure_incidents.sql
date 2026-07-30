-- =============================================================
-- 7.36  BMS Failure Incidents — แจ้งเตือนเมื่อระบบขัดข้อง (ร้าน + platform admin)
-- -------------------------------------------------------------
-- ปัญหาเดิม: ความล้มเหลวที่ลูกค้าเห็นจริง (ทูล AI พัง / tool-loop พัง / LINE push
--   ไม่ออก) เป็นแค่ console.error เฉย ๆ — ไม่มีใครรู้จนลูกค้าบ่น. Channel Health
--   (6.4) และ AI Provider Health (7.34) ตอบได้แค่ "provider/ช่องทางต่อได้ไหม"
--   ไม่ได้ตอบว่า "มีลูกค้าเจอ error ไปแล้วกี่คน แชทไหน" และทั้งคู่เป็น read-only
--   ต้องเปิดหน้าเว็บเองถึงจะเห็น
--
-- ตารางนี้เป็น log ราย occurrence (append-only แบบ bms_audit_log) ไม่ใช่ตาราง
--   สถานะ 1 แถวต่อ provider แบบ 7.34 — เพราะคำถามที่ต้องตอบคือ "แชทไหนได้รับ
--   ผลกระทบ" ซึ่งร้านต้องเอาไปตามลูกค้ากลับทีละราย ไม่ใช่แค่ "ตอนนี้พังอยู่ไหม"
--
-- tier แยกผู้รับ (ตัดสินใจร่วมกับ user แล้ว):
--   A = ลูกค้าเห็นข้อความ error จริง  → แจ้งร้าน + platform admin
--   B = พังเงียบ (context/state หาย, push ไม่ออก) → platform admin เท่านั้น
--       เพราะร้านแก้เองไม่ได้ ถ้าแจ้งด้วยจะเป็น noise
--
-- dedupe/cooldown อ่านจากตารางนี้เอง (MAX(notified_*_at) ต่อ tenant+code) จึง
--   ไม่ต้องมีตาราง dedupe แยกแบบ slack_alert_dedupe (2.9) — ได้ทั้งประวัติและ
--   สถานะ cooldown จากที่เดียว. ตั้งใจใช้ cooldown ต่อเหตุการณ์ ไม่ใช่ threshold
--   แบบ "3 ครั้งใน 10 นาที" ของ maybeAlertSlackForLog เพราะเคสจริงที่เจอ error
--   ห่างกัน 7 ชั่วโมง (11:29 น. และ 18:46 น.) จะไม่เข้าเงื่อนไขนั้นเลย
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_failure_incidents (
  id                   BIGSERIAL PRIMARY KEY,
  tenant_id            UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- ชื่อเหตุการณ์แบบคงที่ ใช้เป็นคีย์ cooldown ด้วย เช่น 'ai.tool_failed'
  code                 TEXT NOT NULL,
  tier                 TEXT NOT NULL CHECK (tier IN ('A', 'B')),
  surface              TEXT NOT NULL DEFAULT 'system'
    CHECK (surface IN ('customer', 'staff', 'system')),
  channel              TEXT,
  -- ไม่ผูก FK โดยเจตนา: incident ต้องบันทึกได้แม้ resolve conversation ไม่สำเร็จ
  -- (ซึ่งตัวมันเองก็เป็นสาเหตุความล้มเหลวที่เราจะแจ้งได้) และแม้แชทถูกลบไปแล้ว
  conversation_id      UUID,
  customer_ref         TEXT,
  -- ข้อความ error ตัดความยาวแล้ว ไม่เก็บ raw args/PII (ตามแบบ ai.tool_call audit)
  error_message        TEXT,
  meta                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  notified_shop_at     TIMESTAMPTZ,
  notified_platform_at TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_failure_incidents_tenant_created
  ON bms_failure_incidents(tenant_id, created_at DESC);

-- cooldown lookup: MAX(notified_shop_at)/MAX(notified_platform_at) ต่อ tenant+code
CREATE INDEX IF NOT EXISTS idx_bms_failure_incidents_cooldown
  ON bms_failure_incidents(tenant_id, code, created_at DESC);

-- ---- RLS (เหมือน 6.1/7.18) ----
ALTER TABLE bms_failure_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_failure_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_failure_incidents_tenant_isolation ON bms_failure_incidents;
CREATE POLICY bms_failure_incidents_tenant_isolation ON bms_failure_incidents
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_failure_incidents TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
