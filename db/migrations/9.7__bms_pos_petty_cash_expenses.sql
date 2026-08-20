-- =============================================================
-- 9.7 — POS petty-cash expenses
-- -------------------------------------------------------------
-- แยก "ค่าใช้จ่ายร้าน" ออกจาก drawer movement ทั่วไป เช่น นำฝากธนาคาร
-- หรือย้ายเงินทอนไปอีกเครื่อง เพื่อไม่ให้รายงานค่าใช้จ่ายนับการย้ายเงินเป็นต้นทุน
--
-- DIRECT  = จ่ายให้ผู้ขายทันที (เช่น ค่าน้ำแข็ง)
-- ADVANCE = เบิกไปซื้อก่อน แล้วกลับมาปิดยอดจริง/คืนเงินทอน
--
-- เงินทุกบาทที่เข้า/ออกยังลง bms_pos_cash_movements เสมอ เพื่อให้สูตรปิดกะ
-- มีแหล่งความจริงเดียว ส่วนตารางนี้เก็บความหมายทางธุรกิจของรายการนั้น
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_expenses (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  shift_id                   UUID NOT NULL REFERENCES bms_pos_shifts(id) ON DELETE RESTRICT,
  device_id                  UUID NOT NULL REFERENCES bms_pos_devices(id) ON DELETE RESTRICT,
  kind                       TEXT NOT NULL CHECK (kind IN ('DIRECT','ADVANCE')),
  category                   TEXT NOT NULL CHECK (category IN (
    'INGREDIENTS','PACKAGING','DELIVERY','TRANSPORT','CLEANING','REPAIRS','UTILITIES','OTHER'
  )),
  description                TEXT NOT NULL CHECK (btrim(description) <> ''),
  payee                      TEXT,
  status                     TEXT NOT NULL CHECK (status IN ('OPEN','SETTLED')),
  advanced_amount            NUMERIC(12,2) NOT NULL CHECK (advanced_amount > 0),
  actual_amount              NUMERIC(12,2) CHECK (actual_amount >= 0),
  returned_amount            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
  extra_cash_out             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (extra_cash_out >= 0),
  receipt_ref                TEXT,
  create_cash_movement_id    UUID NOT NULL UNIQUE REFERENCES bms_pos_cash_movements(id) ON DELETE RESTRICT,
  settlement_movement_id     UUID UNIQUE REFERENCES bms_pos_cash_movements(id) ON DELETE RESTRICT,
  actor_user_id              UUID NOT NULL REFERENCES users(id),
  approved_by                UUID NOT NULL REFERENCES users(id),
  settled_by                 UUID REFERENCES users(id),
  settlement_approved_by     UUID REFERENCES users(id),
  create_idempotency_key     TEXT NOT NULL,
  create_request_hash        TEXT NOT NULL,
  settlement_idempotency_key TEXT,
  settlement_request_hash    TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at                 TIMESTAMPTZ,
  CHECK (payee IS NULL OR btrim(payee) <> ''),
  CHECK (receipt_ref IS NULL OR btrim(receipt_ref) <> ''),
  CHECK (actor_user_id <> approved_by),
  CHECK (settled_by IS NULL OR settlement_approved_by IS NULL OR settled_by <> settlement_approved_by),
  CHECK (
    (kind = 'DIRECT' AND status = 'SETTLED' AND actual_amount = advanced_amount
      AND returned_amount = 0 AND extra_cash_out = 0 AND settled_at IS NOT NULL)
    OR
    (kind = 'ADVANCE' AND status = 'OPEN' AND actual_amount IS NULL
      AND returned_amount = 0 AND extra_cash_out = 0 AND settled_at IS NULL)
    OR
    (kind = 'ADVANCE' AND status = 'SETTLED' AND actual_amount IS NOT NULL
      AND returned_amount = GREATEST(advanced_amount - actual_amount, 0)
      AND extra_cash_out = GREATEST(actual_amount - advanced_amount, 0)
      AND settled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_expenses_shift
  ON bms_pos_expenses (tenant_id, shift_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_pos_expenses_open
  ON bms_pos_expenses (tenant_id, shift_id, created_at)
  WHERE status = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_expenses_create_idempotency
  ON bms_pos_expenses (tenant_id, create_idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_expenses_settlement_idempotency
  ON bms_pos_expenses (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;

ALTER TABLE bms_pos_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_expenses_tenant_isolation ON bms_pos_expenses;
CREATE POLICY bms_pos_expenses_tenant_isolation ON bms_pos_expenses
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_pos_expenses TO bms_app;

-- ผู้ขายเริ่มรายการได้ แต่เงินจริงจะออกไม่ได้จนกว่าคนที่สองซึ่งมี
-- pos.cash.movement จะกด PIN อนุมัติที่ route boundary
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.expense.create'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name IN ('Manager','Sales','Cashier')
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_pos_expenses IS
  'Petty-cash business documents; physical drawer deltas remain in bms_pos_cash_movements';
COMMENT ON COLUMN bms_pos_expenses.receipt_ref IS
  'Optional supplier receipt/invoice number or evidence reference; no raw file bytes in this table';
