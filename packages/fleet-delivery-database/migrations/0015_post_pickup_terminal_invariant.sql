ALTER TABLE fleet_delivery.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_check;
ALTER TABLE fleet_delivery.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_terminal_state_check;
ALTER TABLE fleet_delivery.deliveries
  ADD CONSTRAINT deliveries_terminal_state_check CHECK (
    (state IN (
      'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED_TO_MERCHANT', 'RETURN_REVIEW', 'RETURN_RESOLVED'
    )) = (terminal_at IS NOT NULL)
  );

-- ROLLBACK: only restore the pre-0014 CANCELLED-only invariant after the prior binary is deployed
-- and no row remains in a post-pickup terminal or return-review state.
