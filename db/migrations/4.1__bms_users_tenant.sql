-- =============================================================
-- 4.1  BMS SaaS — ผูก user เข้ากับ tenant
-- -------------------------------------------------------------
-- admin/staff แต่ละคนสังกัด 1 tenant → JWT พก tenant_id → scope อัตโนมัติ
-- backfill user เดิมทั้งหมด = default tenant
-- =============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE users SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;

-- FK (ไม่ตั้ง NOT NULL เพื่อความยืดหยุ่นกับ user ระบบเดิมที่อาจไม่ผูกร้าน)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES bms_tenants(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
