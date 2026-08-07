-- =============================================================
-- 7.57  AI Pharmacy Intake Assistant — RBAC
-- -------------------------------------------------------------
-- New role "Pharmacist" + a fact-flag on users (is_licensed_pharmacist).
-- The flag is a FACT about the human, independent of role/permission —
-- lib/bms/pharmacy/assessments.ts's approveAssessment()/rejectAssessment()/
-- referToDoctor() check it unconditionally, with NO Administrator super-role
-- shortcut, because loadPermissions() in lib/bms/permissions.ts gives
-- Administrator every BMS_PERMISSIONS string automatically — that bypass is
-- fine for ordinary operational permissions, but must never let an
-- unlicensed Administrator account approve a clinical intake case.
-- =============================================================

INSERT INTO roles (name, description) VALUES
  ('Pharmacist', 'เภสัชกร — ตรวจ/อนุมัติ/ปฏิเสธ/ส่งต่อ AI Pharmacy Intake')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_licensed_pharmacist BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pharmacist_license_no TEXT;

CREATE INDEX IF NOT EXISTS idx_users_licensed_pharmacist
  ON users(tenant_id) WHERE is_licensed_pharmacist;

-- ---- permissions ----
-- Pharmacist gets everything pharmacy-related. Manager only gets the
-- config/read side (assign a case to a pharmacist, manage protocols, read
-- the audit trail) — never .review/.approve/.reject/.request_more_information,
-- which stay gated by is_licensed_pharmacist regardless of role/permission.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Pharmacist', 'pharmacy.assessment.read'),
  ('Pharmacist', 'pharmacy.assessment.assign'),
  ('Pharmacist', 'pharmacy.assessment.request_more_information'),
  ('Pharmacist', 'pharmacy.assessment.review'),
  ('Pharmacist', 'pharmacy.assessment.approve'),
  ('Pharmacist', 'pharmacy.assessment.reject'),
  ('Pharmacist', 'pharmacy.protocol.manage'),
  ('Pharmacist', 'pharmacy.audit.read'),
  ('Manager', 'pharmacy.assessment.read'),
  ('Manager', 'pharmacy.assessment.assign'),
  ('Manager', 'pharmacy.protocol.manage'),
  ('Manager', 'pharmacy.audit.read')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
