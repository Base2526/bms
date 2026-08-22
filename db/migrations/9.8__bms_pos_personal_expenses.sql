-- =============================================================
-- 9.8 — POS sole-owner / personal-funds expenses
-- -------------------------------------------------------------
-- ร้านที่มีเจ้าของทำงานคนเดียวต้องบันทึกต้นทุนได้โดยไม่ปลอมหลักฐานว่า
-- มีผู้อนุมัติคนที่สอง วิธีนี้จึงบันทึกเฉพาะเอกสารค่าใช้จ่ายที่เจ้าของ
-- สำรองจ่ายด้วยเงินส่วนตัว และไม่สร้าง movement ในลิ้นชัก
--
-- เงินที่ออกจากลิ้นชักจริงยังใช้ funding_source = DRAWER และต้องมี
-- movement + ผู้อนุมัติคนละคนเหมือนเดิม
-- =============================================================

ALTER TABLE bms_pos_expenses
  ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'DRAWER';

ALTER TABLE bms_pos_expenses
  ALTER COLUMN create_cash_movement_id DROP NOT NULL,
  ALTER COLUMN approved_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_pos_expenses'::regclass
       AND conname = 'bms_pos_expenses_funding_source_check'
  ) THEN
    ALTER TABLE bms_pos_expenses
      ADD CONSTRAINT bms_pos_expenses_funding_source_check
      CHECK (funding_source IN ('DRAWER','PERSONAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_pos_expenses'::regclass
       AND conname = 'bms_pos_expenses_funding_guard_check'
  ) THEN
    ALTER TABLE bms_pos_expenses
      ADD CONSTRAINT bms_pos_expenses_funding_guard_check
      CHECK (
        (funding_source = 'DRAWER'
          AND create_cash_movement_id IS NOT NULL
          AND approved_by IS NOT NULL
          AND actor_user_id <> approved_by)
        OR
        (funding_source = 'PERSONAL'
          AND kind = 'DIRECT'
          AND create_cash_movement_id IS NULL
          AND approved_by IS NULL
          AND receipt_ref IS NOT NULL
          AND btrim(receipt_ref) <> '')
      );
  END IF;
END $$;

-- สิทธิ์นี้แยกจาก pos.expense.create เพื่อไม่ให้พนักงานทุกคนอ้างว่าใช้เงิน
-- ส่วนตัวได้โดยปริยาย ค่าเริ่มต้นเปิดเฉพาะ Administrator (เจ้าของร้าน)
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.expense.personal'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Administrator'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON COLUMN bms_pos_expenses.funding_source IS
  'DRAWER creates a cash movement and needs a distinct approver; PERSONAL is owner-paid, requires evidence, and never changes drawer cash';
