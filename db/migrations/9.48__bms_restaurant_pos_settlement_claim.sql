-- =============================================================
-- 9.48  Restaurant POS: one active settlement attempt per check
-- -------------------------------------------------------------
-- CLOSING is a durable cross-instance claim, not only a UI status. The
-- attempt id prevents an older failed request from reopening a check claimed
-- by a newer cashier, while started_at permits recovery after a crashed app.
-- =============================================================

ALTER TABLE bms_restaurant_checks
  ADD COLUMN IF NOT EXISTS settlement_attempt_id UUID,
  ADD COLUMN IF NOT EXISTS settlement_started_at TIMESTAMPTZ;

-- Repair the pre-9.48 crash window: POS settlement could commit first and the
-- process could stop before its second transaction marked the table paid.
UPDATE bms_restaurant_checks c
   SET status = 'PAID',
       closed_by = COALESCE(c.closed_by, o.cashier_user_id),
       closed_at = COALESCE(c.closed_at, o.updated_at, now()),
       settlement_attempt_id = NULL,
       settlement_started_at = NULL,
       updated_at = now()
  FROM bms_orders o
 WHERE c.tenant_id = o.tenant_id
   AND c.current_order_id = o.id
   AND o.restaurant_check_id = c.id
   AND c.status IN ('OPEN', 'CLOSING')
   AND o.status = 'COMPLETED';

UPDATE bms_restaurant_checks
   SET settlement_attempt_id = COALESCE(settlement_attempt_id, gen_random_uuid()),
       settlement_started_at = COALESCE(settlement_started_at, updated_at, now())
 WHERE status = 'CLOSING';

ALTER TABLE bms_restaurant_checks
  DROP CONSTRAINT IF EXISTS bms_restaurant_checks_settlement_claim_shape;

ALTER TABLE bms_restaurant_checks
  ADD CONSTRAINT bms_restaurant_checks_settlement_claim_shape CHECK (
    (settlement_attempt_id IS NULL) = (settlement_started_at IS NULL)
    AND ((status = 'CLOSING') = (settlement_attempt_id IS NOT NULL))
  ) NOT VALID;

ALTER TABLE bms_restaurant_checks
  VALIDATE CONSTRAINT bms_restaurant_checks_settlement_claim_shape;

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_checks_settlement_claim
  ON bms_restaurant_checks (tenant_id, settlement_started_at)
  WHERE status = 'CLOSING';

COMMENT ON COLUMN bms_restaurant_checks.settlement_attempt_id IS
  'Cross-instance claim token for the active POS settlement attempt.';
COMMENT ON COLUMN bms_restaurant_checks.settlement_started_at IS
  'Lease start for settlement recovery; active attempts are not reclaimed immediately.';
