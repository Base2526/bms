ALTER TABLE fleet_delivery.deliveries DROP CONSTRAINT IF EXISTS deliveries_state_check;
ALTER TABLE fleet_delivery.deliveries ADD CONSTRAINT deliveries_state_check CHECK (state IN (
  'AWAITING_PAYMENT', 'AWAITING_MERCHANT_ACCEPTANCE', 'PREPARING', 'READY_FOR_DISPATCH',
  'SEARCHING_DRIVER', 'OFFERED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP',
  'MANUAL_DISPATCH_REQUIRED', 'CANCELLED'
));

ALTER TABLE fleet_delivery.delivery_state_transitions
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE fleet_delivery.delivery_state_transitions
  DROP CONSTRAINT IF EXISTS delivery_state_transitions_evidence_object_check;
ALTER TABLE fleet_delivery.delivery_state_transitions
  ADD CONSTRAINT delivery_state_transitions_evidence_object_check
  CHECK (jsonb_typeof(evidence) = 'object');

-- ROLLBACK: deploy the prior binary, verify no delivery is EN_ROUTE_PICKUP/AT_PICKUP and no caller
-- depends on transition evidence, then restore the 0007 state constraint. Keep the evidence column;
-- it is append-only operational history and must not be dropped as rollback cleanup.
