-- 10.103 — Preserve allocated landed cost on each PO line.
--
-- unit_cost remains the supplier's invoiced goods price. additional_unit_cost is the
-- reviewed per-unit allocation of freight, duty and other non-recoverable acquisition
-- costs. Inventory valuation consumes their sum when stock is received.

ALTER TABLE bms_purchase_order_items
  ADD COLUMN IF NOT EXISTS additional_unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_cost_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_purchase_order_items_additional_unit_cost_nonnegative'
  ) THEN
    ALTER TABLE bms_purchase_order_items
      ADD CONSTRAINT bms_purchase_order_items_additional_unit_cost_nonnegative
      CHECK (additional_unit_cost >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_purchase_order_items_additional_cost_evidence_check'
  ) THEN
    ALTER TABLE bms_purchase_order_items
      ADD CONSTRAINT bms_purchase_order_items_additional_cost_evidence_check
      CHECK (
        (additional_unit_cost = 0 AND additional_cost_note IS NULL)
        OR (additional_unit_cost > 0 AND additional_cost_note IS NOT NULL
            AND length(btrim(additional_cost_note)) BETWEEN 1 AND 500)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_purchase_order_items
  VALIDATE CONSTRAINT bms_purchase_order_items_additional_unit_cost_nonnegative,
  VALIDATE CONSTRAINT bms_purchase_order_items_additional_cost_evidence_check;

COMMENT ON COLUMN bms_purchase_order_items.additional_unit_cost IS
  'Reviewed per-unit landed-cost allocation (freight/duty/non-recoverable acquisition cost); inventory valuation uses unit_cost + this amount.';
COMMENT ON COLUMN bms_purchase_order_items.additional_cost_note IS
  'Required allocation source/basis when additional_unit_cost is positive; absent when the amount is zero.';
