-- =============================================================
-- 10.11  เอกสารรายจ่าย: ภาษีซื้อ + ค่าใช้จ่ายหลังบ้าน + ภาษีหัก ณ ที่จ่าย
-- -------------------------------------------------------------
-- ตารางเดียวสำหรับ "เงินที่ร้านจ่ายออกพร้อมหลักฐาน" — ใบกำกับภาษีซื้อ ใบเสร็จค่าเช่า
-- บิลค่าไฟ และการหักภาษี ณ ที่จ่าย เป็นแถวเดียวกันของเหตุการณ์เดียว ถ้าแยกสามตาราง
-- ใบเดียวต้องบันทึกสองที่ แล้ววันหนึ่งยอดสองที่ไม่ตรงกัน
--
--   - VAT ขอคืนได้เฉพาะเมื่อหลักฐานเป็นใบกำกับภาษีที่มีเลขที่และเลขผู้เสียภาษีของผู้ขาย
--     (CHECK บังคับ) — ใบเสร็จธรรมดาบันทึกเป็นค่าใช้จ่ายได้ แต่ vat_amount ต้องเป็น 0
--   - ใบกำกับภาษีซื้อจากผู้ขายรายเดียวกันเลขเดียวกัน บันทึกได้ครั้งเดียว (กันขอภาษีซื้อซ้ำ)
--   - หัก ณ ที่จ่ายต้องรู้ประเภทผู้รับเงิน (บุคคลธรรมดา → ภ.ง.ด.3 · นิติบุคคล → ภ.ง.ด.53)
--     และวันที่จ่าย (งวดของภาษีหัก ณ ที่จ่ายคือเดือนที่จ่าย ไม่ใช่เดือนของใบแจ้งหนี้)
--   - ยกเลิกเป็นสถานะ VOID ไม่ลบแถว — เอกสารที่ถูกนำไปยื่นแล้วต้องยังตามได้
--
-- ❗ FK ไป users/ผู้ขาย/PO/ไฟล์ เป็น SET NULL ทั้งหมด — บทเรียนจาก 9.92: FK แบบ RESTRICT
--    ไป users ทำให้ลบร้านที่เคยใช้ฟีเจอร์นี้ไม่ได้เลย
-- ❗ ไม่แตะเส้นทางขาย · ฐานที่ยังไม่ apply = หน้าเอกสารรายจ่ายและรายงานภาษีซื้อใช้ไม่ได้
--
-- ก่อนรัน (read-only):
--   SELECT to_regclass('bms_expense_documents');
-- =============================================================

BEGIN;

-- ---- ข้อมูลภาษีของผู้ขาย/ผู้รับเงิน ----
ALTER TABLE bms_suppliers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE bms_suppliers ADD COLUMN IF NOT EXISTS branch_code TEXT;
ALTER TABLE bms_suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE bms_suppliers ADD COLUMN IF NOT EXISTS entity_type TEXT;

ALTER TABLE bms_suppliers DROP CONSTRAINT IF EXISTS bms_suppliers_entity_type_check;
ALTER TABLE bms_suppliers ADD CONSTRAINT bms_suppliers_entity_type_check
  CHECK (entity_type IS NULL OR entity_type IN ('INDIVIDUAL', 'JURISTIC'));
ALTER TABLE bms_suppliers DROP CONSTRAINT IF EXISTS bms_suppliers_tax_id_shape;
ALTER TABLE bms_suppliers ADD CONSTRAINT bms_suppliers_tax_id_shape
  CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$');
ALTER TABLE bms_suppliers DROP CONSTRAINT IF EXISTS bms_suppliers_branch_code_shape;
ALTER TABLE bms_suppliers ADD CONSTRAINT bms_suppliers_branch_code_shape
  CHECK (branch_code IS NULL OR branch_code ~ '^[0-9]{5}$');

COMMENT ON COLUMN bms_suppliers.entity_type IS
  'INDIVIDUAL = บุคคลธรรมดา (หัก ณ ที่จ่ายยื่น ภ.ง.ด.3) · JURISTIC = นิติบุคคล (ภ.ง.ด.53) (10.11)';

-- ---- เอกสารรายจ่าย ----
CREATE TABLE IF NOT EXISTS bms_expense_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL,
  category            TEXT NOT NULL CHECK (category IN (
                        'INVENTORY', 'RENT', 'UTILITIES', 'INTERNET', 'ADVERTISING', 'TRANSPORT',
                        'REPAIRS', 'PROFESSIONAL_FEE', 'WAGES', 'OTHER')),
  document_kind       TEXT NOT NULL CHECK (document_kind IN (
                        'TAX_INVOICE', 'RECEIPT', 'CASH_BILL', 'PAYMENT_VOUCHER')),
  supplier_id         UUID,
  payee_name          TEXT NOT NULL CHECK (btrim(payee_name) <> ''),
  payee_tax_id        TEXT CHECK (payee_tax_id IS NULL OR payee_tax_id ~ '^[0-9]{13}$'),
  payee_branch_code   TEXT CHECK (payee_branch_code IS NULL OR payee_branch_code ~ '^[0-9]{5}$'),
  payee_address       TEXT,
  payee_type          TEXT CHECK (payee_type IS NULL OR payee_type IN ('INDIVIDUAL', 'JURISTIC')),
  document_no         TEXT,
  document_date       DATE NOT NULL,
  paid_at             DATE,
  amount_before_vat   NUMERIC(14,2) NOT NULL CHECK (amount_before_vat >= 0),
  vat_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  vat_claim_month     DATE,
  wht_income_type     TEXT CHECK (wht_income_type IS NULL OR wht_income_type IN (
                        'RENT', 'SERVICE', 'PROFESSIONAL', 'TRANSPORT', 'ADVERTISING', 'OTHER')),
  wht_rate            NUMERIC(5,2) CHECK (wht_rate IS NULL OR (wht_rate > 0 AND wht_rate <= 100)),
  wht_amount          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wht_amount >= 0),
  purchase_order_id   UUID,
  evidence_file_id    INTEGER,
  note                TEXT,
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOID')),
  void_reason         TEXT,
  voided_at           TIMESTAMPTZ,
  voided_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key     TEXT,
  request_hash        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES bms_suppliers(tenant_id, id) ON DELETE SET NULL (supplier_id),

  -- VAT ขอคืนได้เฉพาะใบกำกับภาษีที่ระบุตัวผู้ขายได้
  CONSTRAINT bms_expense_documents_vat_needs_tax_invoice
    CHECK (vat_amount = 0 OR document_kind = 'TAX_INVOICE'),
  CONSTRAINT bms_expense_documents_tax_invoice_identity
    CHECK (document_kind <> 'TAX_INVOICE'
           OR (document_no IS NOT NULL AND btrim(document_no) <> '' AND payee_tax_id IS NOT NULL)),
  -- เดือนที่ใช้สิทธิ์ภาษีซื้อ: วันแรกของเดือน และไม่ก่อนเดือนของใบกำกับ
  CONSTRAINT bms_expense_documents_claim_month_shape
    CHECK (vat_claim_month IS NULL
           OR (vat_claim_month = date_trunc('month', vat_claim_month)::date
               AND vat_claim_month >= date_trunc('month', document_date)::date)),
  CONSTRAINT bms_expense_documents_claim_month_needs_vat
    CHECK ((vat_amount > 0) = (vat_claim_month IS NOT NULL)),
  -- หัก ณ ที่จ่ายต้องรู้ว่ายื่นแบบไหน งวดไหน และอัตราเท่าไร
  CONSTRAINT bms_expense_documents_wht_shape
    CHECK ((wht_amount > 0) = (wht_income_type IS NOT NULL)
           AND (wht_amount > 0) = (wht_rate IS NOT NULL)
           AND (wht_amount = 0 OR (payee_type IS NOT NULL
                                   AND payee_tax_id IS NOT NULL AND paid_at IS NOT NULL))),
  CONSTRAINT bms_expense_documents_wht_not_more_than_base
    CHECK (wht_amount <= amount_before_vat),
  CONSTRAINT bms_expense_documents_void_shape
    CHECK ((status = 'VOID') = (voided_at IS NOT NULL)
           AND (status <> 'VOID' OR (void_reason IS NOT NULL AND btrim(void_reason) <> '')))
);

-- รองรับเครื่อง dev/staging ที่เคย apply ร่าง 10.11 ก่อนเพิ่ม exact-idempotency
ALTER TABLE bms_expense_documents ADD COLUMN IF NOT EXISTS request_hash TEXT;

-- CHECK ใน CREATE TABLE ไม่ได้อัปเดตเมื่อ table มีอยู่แล้ว จึงประกาศซ้ำแบบ idempotent
-- เพื่อให้การ rerun ยกฐานที่เคยใช้ร่างเดิมขึ้นมาที่ contract ล่าสุดจริง
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_vat_needs_tax_invoice;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_vat_needs_tax_invoice
  CHECK (vat_amount = 0 OR document_kind = 'TAX_INVOICE');
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_tax_invoice_identity;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_tax_invoice_identity
  CHECK (document_kind <> 'TAX_INVOICE'
         OR (document_no IS NOT NULL AND btrim(document_no) <> '' AND payee_tax_id IS NOT NULL));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_claim_month_shape;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_claim_month_shape
  CHECK (vat_claim_month IS NULL
         OR (vat_claim_month = date_trunc('month', vat_claim_month)::date
             AND vat_claim_month >= date_trunc('month', document_date)::date));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_claim_month_needs_vat;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_claim_month_needs_vat
  CHECK ((vat_amount > 0) = (vat_claim_month IS NOT NULL));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_wht_shape;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_wht_shape
  CHECK ((wht_amount > 0) = (wht_income_type IS NOT NULL)
         AND (wht_amount > 0) = (wht_rate IS NOT NULL)
         AND (wht_amount = 0 OR (payee_type IS NOT NULL
                                 AND payee_tax_id IS NOT NULL AND paid_at IS NOT NULL)));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_wht_not_more_than_base;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_wht_not_more_than_base
  CHECK (wht_amount <= amount_before_vat);
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_void_shape;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_void_shape
  CHECK ((status = 'VOID') = (voided_at IS NOT NULL)
         AND (status <> 'VOID' OR (void_reason IS NOT NULL AND btrim(void_reason) <> '')));

-- PO รุ่นเก่ายังไม่มี composite key; เพิ่มก่อนใช้ FK เพื่อห้ามอ้าง PO ของร้านอื่น
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_purchase_orders_tenant_id_id_key'
  ) THEN
    ALTER TABLE bms_purchase_orders
      ADD CONSTRAINT bms_purchase_orders_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_purchase_order_fk;
ALTER TABLE bms_expense_documents
  ADD CONSTRAINT bms_expense_documents_purchase_order_fk
  FOREIGN KEY (tenant_id, purchase_order_id)
  REFERENCES bms_purchase_orders(tenant_id, id) ON DELETE SET NULL (purchase_order_id);

-- files.id เป็น PK อยู่แล้ว แต่ composite key ทำให้ FK ตรึง owner ของไฟล์กับร้านด้วย
-- ไม่ใช่พึ่ง service อย่างเดียว (ไฟล์ private ของร้านอื่นต้องอ้างไม่ได้แม้เขียน SQL ตรง)
CREATE UNIQUE INDEX IF NOT EXISTS uq_files_tenant_id_id ON files (tenant_id, id);
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_evidence_file_id_fkey;
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_evidence_file_fk;
ALTER TABLE bms_expense_documents
  ADD CONSTRAINT bms_expense_documents_evidence_file_fk
  FOREIGN KEY (tenant_id, evidence_file_id)
  REFERENCES files(tenant_id, id) ON DELETE SET NULL (evidence_file_id);

-- ใบกำกับภาษีซื้อของผู้ขายรายเดียวกัน เลขเดียวกัน ใช้สิทธิ์ได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_expense_documents_tax_invoice
  ON bms_expense_documents (tenant_id, payee_tax_id, COALESCE(payee_branch_code, ''), document_no)
  WHERE status = 'ACTIVE' AND document_kind = 'TAX_INVOICE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_expense_documents_idempotency
  ON bms_expense_documents (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_idempotency_shape;
ALTER TABLE bms_expense_documents
  ADD CONSTRAINT bms_expense_documents_idempotency_shape
  CHECK ((idempotency_key IS NULL) = (request_hash IS NULL));

CREATE INDEX IF NOT EXISTS idx_bms_expense_documents_date
  ON bms_expense_documents (tenant_id, location_id, document_date);
CREATE INDEX IF NOT EXISTS idx_bms_expense_documents_claim
  ON bms_expense_documents (tenant_id, vat_claim_month) WHERE vat_claim_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_expense_documents_wht
  ON bms_expense_documents (tenant_id, paid_at) WHERE wht_amount > 0;

ALTER TABLE bms_expense_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_expense_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_expense_documents_tenant_isolation ON bms_expense_documents;
CREATE POLICY bms_expense_documents_tenant_isolation ON bms_expense_documents
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE ON bms_expense_documents TO bms_app;
SELECT public.create_revision_trigger('bms_expense_documents');

COMMENT ON TABLE bms_expense_documents IS
  'เงินที่ร้านจ่ายออกพร้อมหลักฐาน: ภาษีซื้อ ค่าใช้จ่าย และภาษีหัก ณ ที่จ่าย ในแถวเดียว (10.11)';

-- ---- สิทธิ์ ----
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
CROSS JOIN (VALUES ('expense.view'), ('expense.manage')) AS p(permission)
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- ชนิดรายงาน (บทเรียน 9.95) ----
ALTER TABLE bms_generated_reports
  DROP CONSTRAINT IF EXISTS bms_generated_reports_report_type_check;
ALTER TABLE bms_generated_reports
  ADD CONSTRAINT bms_generated_reports_report_type_check
  CHECK (
    report_type IN (
      'SALES',
      'INVENTORY',
      'PROFIT',
      'PRODUCTS',
      'PAYMENTS',
      'PURCHASES',
      'CUSTOMERS',
      'OPERATIONS',
      'SPECIALIZED',
      'VAT_SALES',
      'STOCK_LEDGER',
      'VAT_PURCHASE',
      'EXPENSES',
      'WHT',
      'ACCOUNTING_PACK'
    )
  );

COMMIT;

-- ตรวจหลังรัน:
--   SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'bms_expense_documents';
--   SELECT privilege_type FROM information_schema.table_privileges
--    WHERE table_name = 'bms_expense_documents' AND grantee = 'bms_app';
--   SELECT count(*) FROM bms_role_permissions WHERE permission IN ('expense.view','expense.manage');
--
-- ROLLBACK (ต้องไม่มีเอกสารที่ถูกนำไปยื่นแล้ว — ตรวจ count(*) ก่อน):
-- BEGIN;
-- DROP TABLE bms_expense_documents;
-- DELETE FROM bms_role_permissions WHERE permission IN ('expense.view','expense.manage');
-- ALTER TABLE bms_suppliers DROP COLUMN tax_id, DROP COLUMN branch_code, DROP COLUMN address, DROP COLUMN entity_type;
-- (แล้วรันบล็อก CHECK ของ 10.9 ซ้ำ)
-- COMMIT;
