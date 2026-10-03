-- Supplier notes are evidence only: no stock, cash, or payment mutation.
BEGIN;
ALTER TABLE bms_expense_documents ADD COLUMN IF NOT EXISTS received_date DATE;
ALTER TABLE bms_expense_documents ADD COLUMN IF NOT EXISTS reference_document_no TEXT;
ALTER TABLE bms_expense_documents ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_document_kind_check;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_document_kind_check
  CHECK (document_kind IN ('TAX_INVOICE','RECEIPT','CASH_BILL','PAYMENT_VOUCHER','SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE'));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_vat_needs_tax_invoice;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_vat_needs_tax_invoice
  CHECK (vat_amount = 0 OR document_kind IN ('TAX_INVOICE','SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE'));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_tax_invoice_identity;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_tax_invoice_identity
  CHECK (document_kind NOT IN ('TAX_INVOICE','SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE')
    OR (document_no IS NOT NULL AND btrim(document_no) <> '' AND payee_tax_id IS NOT NULL));
ALTER TABLE bms_expense_documents DROP CONSTRAINT IF EXISTS bms_expense_documents_adjustment_shape;
ALTER TABLE bms_expense_documents ADD CONSTRAINT bms_expense_documents_adjustment_shape CHECK (
  CASE WHEN document_kind IN ('SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE') THEN
    received_date IS NOT NULL AND received_date >= document_date
    AND reference_document_no IS NOT NULL AND length(btrim(reference_document_no)) BETWEEN 1 AND 500
    AND adjustment_reason IS NOT NULL AND length(btrim(adjustment_reason)) BETWEEN 1 AND 2000
    AND payee_branch_code IS NOT NULL AND vat_amount > 0
    AND vat_claim_month IS NOT NULL AND vat_claim_month = date_trunc('month', received_date)::date
    AND wht_amount = 0 AND wht_rate IS NULL AND wht_income_type IS NULL
  ELSE received_date IS NULL AND reference_document_no IS NULL AND adjustment_reason IS NULL END
);

-- Keep the invoice key unchanged; notes have their own per-kind namespace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_expense_documents_adjustment_normalized
  ON bms_expense_documents (tenant_id, document_kind, payee_tax_id,
    COALESCE(NULLIF(btrim(payee_branch_code),''),'00000'),
    upper(regexp_replace(document_no, '[[:space:]-]+', '', 'g')))
  WHERE status='ACTIVE' AND document_kind IN ('SUPPLIER_CREDIT_NOTE','SUPPLIER_DEBIT_NOTE');
COMMIT;
