-- =============================================================
-- 9.33 — Back-office POS shift overview permission
-- -------------------------------------------------------------
-- The POS register can only read reports for its own device. The admin overview
-- intentionally sees shifts across devices, so it gets a separate permission
-- instead of widening pos.shift.report for cashier/sales roles.
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_bms_pos_shifts_tenant_opened_overview
  ON bms_pos_shifts (tenant_id, opened_at DESC, status, device_id);

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.shift.report.all'
FROM bms_tenants t
JOIN roles r ON r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
