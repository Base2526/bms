CREATE INDEX IF NOT EXISTS deliveries_operations_list_idx
  ON fleet_delivery.deliveries (tenant_ref, branch_ref, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS deliveries_operations_state_list_idx
  ON fleet_delivery.deliveries (tenant_ref, branch_ref, state, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS dispatch_manual_queue_open_operations_idx
  ON fleet_delivery.dispatch_manual_queue (tenant_ref, branch_ref, created_at, id)
  WHERE status = 'OPEN';

-- ROLLBACK: these indexes may be dropped concurrently after verifying no deployed operations reader
-- depends on their query plan. No business rows, authority or mutable workflow are introduced here.
