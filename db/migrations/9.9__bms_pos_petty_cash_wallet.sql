-- =============================================================
-- 9.9 — POS petty-cash wallet (outside the register drawer)
-- -------------------------------------------------------------
-- ร้านที่มีคนขายคนเดียวใช้เงินสดย่อยของสาขาได้โดยไม่ต้องทำหลักฐานเท็จว่า
-- มีผู้อนุมัติคนที่สอง เงินก้อนนี้เติมจากเงินเจ้าของหรือบัญชีร้านและไม่อยู่ใน
-- ลิ้นชัก POS จึงไม่เข้าสูตร expected cash ของกะ
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_petty_cash_wallets (
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES bms_locations(id) ON DELETE RESTRICT,
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, location_id)
);

CREATE TABLE IF NOT EXISTS bms_pos_petty_cash_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id        UUID NOT NULL REFERENCES bms_locations(id) ON DELETE RESTRICT,
  shift_id           UUID REFERENCES bms_pos_shifts(id) ON DELETE RESTRICT,
  device_id          UUID REFERENCES bms_pos_devices(id) ON DELETE RESTRICT,
  direction          TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  source             TEXT NOT NULL CHECK (source IN ('OWNER_PERSONAL','BUSINESS_ACCOUNT','EXPENSE')),
  amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  balance_after      NUMERIC(12,2) NOT NULL CHECK (balance_after >= 0),
  reason             TEXT NOT NULL CHECK (btrim(reason) <> ''),
  evidence_ref       TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  actor_user_id      UUID NOT NULL REFERENCES users(id),
  idempotency_key    TEXT NOT NULL,
  request_hash       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_petty_cash_ledger_location
  ON bms_pos_petty_cash_ledger (tenant_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_pos_petty_cash_ledger_shift
  ON bms_pos_petty_cash_ledger (tenant_id, shift_id, created_at DESC)
  WHERE shift_id IS NOT NULL;

ALTER TABLE bms_pos_expenses
  ADD COLUMN IF NOT EXISTS petty_cash_ledger_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_expenses_petty_cash_ledger
  ON bms_pos_expenses (petty_cash_ledger_id)
  WHERE petty_cash_ledger_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_pos_expenses'::regclass
       AND conname = 'bms_pos_expenses_petty_cash_ledger_fk'
  ) THEN
    ALTER TABLE bms_pos_expenses
      ADD CONSTRAINT bms_pos_expenses_petty_cash_ledger_fk
      FOREIGN KEY (petty_cash_ledger_id) REFERENCES bms_pos_petty_cash_ledger(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE bms_pos_expenses
  DROP CONSTRAINT IF EXISTS bms_pos_expenses_funding_source_check,
  DROP CONSTRAINT IF EXISTS bms_pos_expenses_funding_guard_check;

ALTER TABLE bms_pos_expenses
  ADD CONSTRAINT bms_pos_expenses_funding_source_check
    CHECK (funding_source IN ('DRAWER','PERSONAL','PETTY_CASH')),
  ADD CONSTRAINT bms_pos_expenses_funding_guard_check
    CHECK (
      (funding_source = 'DRAWER'
        AND create_cash_movement_id IS NOT NULL
        AND petty_cash_ledger_id IS NULL
        AND approved_by IS NOT NULL
        AND actor_user_id <> approved_by)
      OR
      (funding_source = 'PERSONAL'
        AND kind = 'DIRECT'
        AND create_cash_movement_id IS NULL
        AND petty_cash_ledger_id IS NULL
        AND approved_by IS NULL
        AND receipt_ref IS NOT NULL
        AND btrim(receipt_ref) <> '')
      OR
      (funding_source = 'PETTY_CASH'
        AND kind = 'DIRECT'
        AND create_cash_movement_id IS NULL
        AND petty_cash_ledger_id IS NOT NULL
        AND approved_by IS NULL
        AND receipt_ref IS NOT NULL
        AND btrim(receipt_ref) <> '')
    );

ALTER TABLE bms_pos_petty_cash_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_petty_cash_wallets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_petty_cash_wallets_tenant_isolation ON bms_pos_petty_cash_wallets;
CREATE POLICY bms_pos_petty_cash_wallets_tenant_isolation ON bms_pos_petty_cash_wallets
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_pos_petty_cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_petty_cash_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_petty_cash_ledger_tenant_isolation ON bms_pos_petty_cash_ledger;
CREATE POLICY bms_pos_petty_cash_ledger_tenant_isolation ON bms_pos_petty_cash_ledger
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_pos_petty_cash_wallets TO bms_app;
GRANT SELECT, INSERT ON bms_pos_petty_cash_ledger TO bms_app;

-- เติมเงินสดย่อยเป็นการรับรองว่าเงินมาจากนอกลิ้นชัก จึงเปิดให้เฉพาะเจ้าของร้าน
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.petty_cash.manage'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Administrator'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_pos_petty_cash_wallets IS
  'Per-branch petty-cash balance kept outside the POS drawer';
COMMENT ON TABLE bms_pos_petty_cash_ledger IS
  'Append-only funding and expense debits for branch petty cash; never part of POS expected cash';
COMMENT ON COLUMN bms_pos_expenses.funding_source IS
  'DRAWER links a cash movement and distinct approver; PERSONAL is owner-paid; PETTY_CASH links the outside-drawer branch wallet; both non-drawer sources require evidence';
