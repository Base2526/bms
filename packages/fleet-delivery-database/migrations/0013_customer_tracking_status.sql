ALTER TABLE fleet_delivery.customer_grants
  DROP CONSTRAINT IF EXISTS customer_grants_allowed_actions_check;

ALTER TABLE fleet_delivery.customer_grants
  ADD CONSTRAINT customer_grants_allowed_actions_check CHECK (
    allowed_actions = ARRAY['QUOTE','CREATE_DELIVERY']::text[]
    OR allowed_actions = ARRAY['QUOTE','CREATE_DELIVERY','TRACK']::text[]
  );

-- Existing grants intentionally keep their original authority. Only a newly issued grant that
-- explicitly contains TRACK can read the customer-safe projection.

-- ROLLBACK: stop issuing TRACK grants and deploy the previous application. Do not remove TRACK
-- from already issued rows in place; revoke those grants and issue replacement grants instead.
