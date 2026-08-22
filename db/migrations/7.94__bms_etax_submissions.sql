-- =============================================================
-- 7.94  BMS e-Tax Invoice — คิวนำส่งข้อมูลให้กรมสรรพากร
-- -------------------------------------------------------------
-- ต้องรัน 7.88 ก่อน (bms_tax_documents)
--
-- ⚠️ อ่านก่อน: ไฟล์นี้สร้าง "ระบบคิวและร่องรอย" ไม่ใช่การนำส่งจริง
--
-- e-Tax Invoice ของจริงต้องมี 3 อย่างที่โค้ดสร้างเองไม่ได้:
--   1. ลงทะเบียนกับกรมสรรพากร (ผ่าน etax.rd.go.th)
--   2. ใบรับรองอิเล็กทรอนิกส์จาก CA ไทย สำหรับเซ็น XML
--   3. ช่องทางนำส่ง — ยิงตรง RD หรือผ่านผู้ให้บริการนำส่งข้อมูลที่ RD รับรอง
--
-- ที่ทำได้และควรทำไว้ก่อน คือทำให้ "ไม่มีบิลไหนหาย":
-- ทุกใบกำกับที่ออกจะมีแถวในคิวนี้ พร้อมสถานะ จำนวนครั้งที่ลอง และข้อความผิดพลาด
-- ถ้าวันหนึ่งเปลี่ยนผู้ให้บริการ ก็เปลี่ยนแค่ adapter — ข้อมูลย้อนหลังยังอยู่ครบ
--
-- ปิดไว้ด้วย env ETAX_ENABLED (default false) เหมือนโมดูล pharmacy
-- รันซ้ำได้ปลอดภัย
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_etax_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES bms_tax_documents(id) ON DELETE CASCADE,

  status         TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'BUILT', 'SIGNED', 'SENT', 'ACCEPTED', 'REJECTED', 'FAILED')),

  -- XML ที่ประกอบได้ (ยังไม่เซ็น) — เก็บไว้ให้ตรวจย้อนหลังได้ว่าเราส่งอะไรไป
  xml            TEXT,
  -- XML ที่เซ็นแล้ว เก็บแยกเพราะเป็นคนละสิ่งในทางกฎหมาย
  signed_xml     TEXT,
  -- ผู้ให้บริการที่ใช้ส่ง ณ ครั้งนั้น ('rd-direct' / ชื่อผู้ให้บริการ / 'noop')
  provider       TEXT,
  -- เลขอ้างอิงที่ปลายทางตอบกลับ — ใช้ตามเรื่องกับ RD หรือผู้ให้บริการ
  provider_ref   TEXT,

  attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     TEXT,
  -- เวลาที่ควรลองใหม่ (exponential backoff) — NULL = ลองได้ทันที
  next_attempt_at TIMESTAMPTZ,

  built_at       TIMESTAMPTZ,
  signed_at      TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  settled_at     TIMESTAMPTZ,          -- ปลายทางตอบรับ/ปฏิเสธเมื่อไหร่

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 1 เอกสาร = 1 แถวในคิว · ส่งซ้ำใช้การอัปเดตแถวเดิม ไม่ใช่สร้างใหม่
  -- ไม่งั้นนับจำนวนที่ยังไม่ส่งไม่ได้ และอาจส่งซ้ำให้ RD
  UNIQUE (document_id)
);

-- งานที่ยังต้องทำ — ตัวจับคิวอ่าน index นี้
CREATE INDEX IF NOT EXISTS idx_bms_etax_queue
  ON bms_etax_submissions (tenant_id, status, next_attempt_at)
  WHERE status IN ('PENDING', 'BUILT', 'SIGNED', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_bms_etax_document
  ON bms_etax_submissions (document_id);

-- ---- ค่าตั้งระดับร้าน ------------------------------------------------
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS etax_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  -- เลขทะเบียนผู้ประกอบการ e-Tax ที่ RD ออกให้ (ไม่ใช่เลขผู้เสียภาษี)
  ADD COLUMN IF NOT EXISTS etax_operator_id TEXT,
  -- ชื่อ adapter ที่ใช้ส่ง — ต้องตรงกับที่ลงทะเบียนไว้ใน lib/bms/etax/providers
  ADD COLUMN IF NOT EXISTS etax_provider    TEXT;

COMMENT ON COLUMN bms_store_profile.etax_enabled IS
  'เปิดคิวนำส่ง e-Tax ของร้านนี้ · ยังต้องเปิด env ETAX_ENABLED ด้วยทั้งคู่';

-- ---- RLS (copy 4.2) --------------------------------------------------
ALTER TABLE bms_etax_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_etax_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_etax_submissions_tenant_isolation ON bms_etax_submissions;
CREATE POLICY bms_etax_submissions_tenant_isolation ON bms_etax_submissions
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- GRANT (copy 4.3) ------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_etax_submissions TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','etax.view'),
  ('Manager','etax.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
