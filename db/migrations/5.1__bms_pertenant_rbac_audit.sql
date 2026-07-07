-- =============================================================
-- 5.1  BMS — per-tenant RBAC + audit log
-- -------------------------------------------------------------
-- • bms_role_permissions: เพิ่ม tenant_id → แต่ละร้านกำหนดสิทธิ์ role เองได้
--   (roles ยัง global แต่ "สิทธิ์ของ role" แยกต่อร้าน)
-- • bms_audit_log: บันทึกการกระทำของ admin
-- =============================================================

-- ---- per-tenant role permissions ----
ALTER TABLE bms_role_permissions ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- backfill rows เดิม = default tenant
UPDATE bms_role_permissions SET tenant_id = '11111111-1111-1111-1111-111111111111' WHERE tenant_id IS NULL;
ALTER TABLE bms_role_permissions ALTER COLUMN tenant_id SET NOT NULL;

-- re-key PK → (tenant_id, role_id, permission) ก่อน (ต้องมาก่อน copy ไม่งั้น conflict บน PK เดิม)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_role_permissions_pkey'
              AND pg_get_constraintdef(oid) NOT LIKE '%tenant_id%') THEN
    ALTER TABLE bms_role_permissions DROP CONSTRAINT bms_role_permissions_pkey;
    ALTER TABLE bms_role_permissions ADD PRIMARY KEY (tenant_id, role_id, permission);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_role_perms_tenant_fk') THEN
    ALTER TABLE bms_role_permissions ADD CONSTRAINT bms_role_perms_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES bms_tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- คัดลอก template (ของ default) ให้ทุก tenant ที่ยังไม่มีสิทธิ์
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, rp.role_id, rp.permission
  FROM bms_tenants t
  CROSS JOIN (SELECT role_id, permission FROM bms_role_permissions
               WHERE tenant_id = '11111111-1111-1111-1111-111111111111') rp
 WHERE t.id <> '11111111-1111-1111-1111-111111111111'
ON CONFLICT DO NOTHING;

-- ---- audit log ----
CREATE TABLE IF NOT EXISTS bms_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  actor       TEXT,               -- email/id ของ admin
  action      TEXT NOT NULL,      -- เช่น order.ship, product.upsert, plan.change
  target      TEXT,               -- id/sku ที่ถูกกระทำ
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_audit_tenant ON bms_audit_log(tenant_id, created_at DESC);

-- ให้ bms_app (RLS role) เขียน audit/role_permissions ได้
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_audit_log TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
