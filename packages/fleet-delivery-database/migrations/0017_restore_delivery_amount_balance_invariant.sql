ALTER TABLE fleet_delivery.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_amount_balance_check;
ALTER TABLE fleet_delivery.deliveries
  ADD CONSTRAINT deliveries_amount_balance_check CHECK (
    customer_contribution_satang + merchant_subsidy_satang + explicit_discount_satang
      = gross_delivery_fee_satang
  );

-- Migration 0015 replaced an unnamed constraint while naming the expanded terminal invariant.
-- PostgreSQL had assigned deliveries_check to this amount-balance invariant, so restore it under
-- an explicit stable name. ROLLBACK: do not remove while the delivery writer relies on this guard.
