-- =============================================================
-- 5.3  BMS Payment — payment records + slip/QR + verification
-- -------------------------------------------------------------
-- ตาม CLAUDE.md §9 + TOOLS.md: verifyPaymentSlip / confirmPayment / refundPayment
--
-- flow ต่อ 1 payment:  PENDING → CONFIRMED         (แอดมิน/ผู้มีสิทธิ์ยืนยัน)
--                            └→ REJECTED           (สลิปไม่ผ่าน)
--                      CONFIRMED → REFUNDED         (คืนเงิน — manager)
--
-- confirmPayment จะ transition order PENDING → PAID ในทรานแซกชันเดียว
-- verify_result เก็บผล OCR/AI (AI แค่ "แนะนำ" ไม่ยืนยันเอง ตาม BUSINESS_RULES)
-- multi-tenant + RLS เหมือนตาราง BMS อื่น (idempotent)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  method        TEXT NOT NULL
                  CHECK (method IN ('BANK_TRANSFER','QR','CARD','TIKTOK','CASH')),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','CONFIRMED','REJECTED','REFUNDED')),
  slip_url      TEXT,                 -- URL/path ของสลิป (เช่น /api/files/<id>)
  slip_ref      TEXT,                 -- เลขอ้างอิง/txn id
  verify_result JSONB,                -- ผล OCR/AI slip verification (แนะนำ ไม่ผูกมัด)
  note          TEXT,
  verified_by   TEXT,                 -- email/id ของผู้ยืนยัน
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_payments_order  ON bms_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_bms_payments_tenant ON bms_payments(tenant_id, status);

-- ---- Row-Level Security (เหมือน 4.2) ----
DO $$
BEGIN
  EXECUTE 'ALTER TABLE bms_payments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE bms_payments FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS bms_payments_tenant_isolation ON bms_payments';
  EXECUTE $p$
    CREATE POLICY bms_payments_tenant_isolation ON bms_payments
      USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
      WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  $p$;
END $$;

-- ---- grant ให้ RLS role (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_payments TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
