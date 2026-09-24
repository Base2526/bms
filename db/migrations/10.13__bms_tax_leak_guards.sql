-- =============================================================
-- 10.13  Tax leak guards: exact sale-line amount + normalized input-tax identity
-- -------------------------------------------------------------
-- A promotion prices a SKU+size basket as one amount (for example 3 for 100).
-- NUMERIC(12,2) unit_price cannot represent 100 / 3 without losing a satang, so
-- line_amount is the immutable monetary authority while unit_price remains a
-- useful per-unit display/reference value. Existing rows are backfilled from the
-- only evidence they had; issued tax documents are never rewritten.
--
-- Input-tax invoice numbers are compared after upper-casing and removing spaces
-- and hyphens. NULL/blank branch is the same establishment as head office 00000.
-- The preflight DO block deliberately aborts if existing active rows collide;
-- operators must investigate them, never let a migration delete financial evidence.
-- =============================================================

BEGIN;

ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS line_amount NUMERIC(14,2);

UPDATE bms_order_items
   SET line_amount = ROUND(COALESCE(pack_unit_price * pack_qty, unit_price * qty), 2)
 WHERE line_amount IS NULL;

ALTER TABLE bms_order_items
  ALTER COLUMN line_amount SET NOT NULL;

ALTER TABLE bms_order_items
  DROP CONSTRAINT IF EXISTS bms_order_items_line_amount_nonnegative;
ALTER TABLE bms_order_items
  ADD CONSTRAINT bms_order_items_line_amount_nonnegative CHECK (line_amount >= 0);

COMMENT ON COLUMN bms_order_items.line_amount IS
  'Immutable amount actually charged for this sale line before order-level discount; exact to satang even when a promotion cannot be represented as qty * NUMERIC(12,2) unit_price (10.13)';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM bms_expense_documents
     WHERE status = 'ACTIVE' AND document_kind = 'TAX_INVOICE'
     GROUP BY tenant_id,
              payee_tax_id,
              COALESCE(NULLIF(btrim(payee_branch_code), ''), '00000'),
              upper(regexp_replace(document_no, '[[:space:]-]+', '', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'active input-tax invoices collide after document-number/branch normalization; inspect duplicates before applying 10.13';
  END IF;
END $$;

DROP INDEX IF EXISTS uq_bms_expense_documents_tax_invoice;
DROP INDEX IF EXISTS uq_bms_expense_documents_tax_invoice_normalized;
CREATE UNIQUE INDEX uq_bms_expense_documents_tax_invoice_normalized
  ON bms_expense_documents (
    tenant_id,
    payee_tax_id,
    (COALESCE(NULLIF(btrim(payee_branch_code), ''), '00000')),
    (upper(regexp_replace(document_no, '[[:space:]-]+', '', 'g')))
  )
  WHERE status = 'ACTIVE' AND document_kind = 'TAX_INVOICE';

COMMIT;

-- ROLLBACK (only before code starts writing promotion-exact line_amount values):
-- BEGIN;
-- DROP INDEX IF EXISTS uq_bms_expense_documents_tax_invoice_normalized;
-- CREATE UNIQUE INDEX uq_bms_expense_documents_tax_invoice
--   ON bms_expense_documents (tenant_id, payee_tax_id, COALESCE(payee_branch_code, ''), document_no)
--   WHERE status = 'ACTIVE' AND document_kind = 'TAX_INVOICE';
-- ALTER TABLE bms_order_items DROP COLUMN IF EXISTS line_amount;
-- COMMIT;
