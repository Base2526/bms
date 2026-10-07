-- 10.43 — Grounded restaurant customer answers: food declarations, aggregate availability,
--          and chat-originated reservation requests that still require staff acceptance.
--
-- Food declarations are positive, shop-maintained facts. An empty allergen list is not evidence
-- of absence unless allergen_information_provided is true, and even then the customer assistant
-- must not promise freedom from cross-contact. Dietary tags are menu labels, not certifications.
--
-- A chat reservation starts as REQUESTED. It is deliberately not WAITING: only a device/PIN-
-- authenticated staff action may accept it into the operational reservation board. Customer
-- identity is linked server-side through customer_id; raw channel references never enter the row.

ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS allergen_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allergen_information_provided BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS food_safety_note TEXT;

ALTER TABLE bms_products
  DROP CONSTRAINT IF EXISTS bms_products_allergen_codes_valid,
  ADD CONSTRAINT bms_products_allergen_codes_valid CHECK (
    allergen_codes <@ ARRAY[
      'PEANUT','TREE_NUT','MILK','EGG','WHEAT_GLUTEN','SOY',
      'FISH','SHELLFISH','SESAME','SULPHITE'
    ]::text[]
  ),
  DROP CONSTRAINT IF EXISTS bms_products_dietary_tags_valid,
  ADD CONSTRAINT bms_products_dietary_tags_valid CHECK (
    dietary_tags <@ ARRAY['VEGETARIAN','VEGAN','JAY','HALAL']::text[]
  ),
  DROP CONSTRAINT IF EXISTS bms_products_food_safety_note_length,
  ADD CONSTRAINT bms_products_food_safety_note_length CHECK (
    food_safety_note IS NULL OR length(food_safety_note) <= 500
  );

COMMENT ON COLUMN bms_products.allergen_codes IS
  'Positive allergen declarations maintained by the shop. Absence from this array is not proof of absence unless allergen_information_provided is true.';
COMMENT ON COLUMN bms_products.allergen_information_provided IS
  'The shop reviewed the structured allergen declaration. It does not certify freedom from cross-contact.';
COMMENT ON COLUMN bms_products.dietary_tags IS
  'Shop-maintained menu labels (vegetarian/vegan/jay/halal), not third-party certifications.';

ALTER TABLE bms_restaurant_waitlist
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE bms_restaurant_waitlist
  DROP CONSTRAINT IF EXISTS bms_restaurant_waitlist_status_check,
  ADD CONSTRAINT bms_restaurant_waitlist_status_check CHECK (status IN (
    'REQUESTED', 'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'
  )),
  DROP CONSTRAINT IF EXISTS bms_restaurant_waitlist_source_check,
  ADD CONSTRAINT bms_restaurant_waitlist_source_check CHECK (source IN ('STAFF', 'CUSTOMER_AI')),
  DROP CONSTRAINT IF EXISTS bms_restaurant_waitlist_customer_fk,
  ADD CONSTRAINT bms_restaurant_waitlist_customer_fk
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES bms_customers(tenant_id, id) ON DELETE SET NULL (customer_id),
  DROP CONSTRAINT IF EXISTS bms_restaurant_waitlist_actor_shape,
  ADD CONSTRAINT bms_restaurant_waitlist_actor_shape CHECK (
    (source = 'STAFF' AND created_by IS NOT NULL)
    -- The service always links a customer at creation. Preserve operational history if that
    -- customer is later removed: the FK clears only customer_id and the orphan has no chat owner.
    OR (source = 'CUSTOMER_AI' AND kind = 'RESERVATION' AND created_by IS NULL)
  );

DROP INDEX IF EXISTS idx_bms_restaurant_waitlist_open;
CREATE INDEX idx_bms_restaurant_waitlist_open
  ON bms_restaurant_waitlist (tenant_id, location_id, status, created_at)
  WHERE status IN ('REQUESTED', 'WAITING', 'CALLED');

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_waitlist_customer
  ON bms_restaurant_waitlist (tenant_id, customer_id, created_at DESC)
  WHERE source = 'CUSTOMER_AI';

-- One unresolved request for the same customer, branch and appointment. This makes provider/tool
-- retries replay the existing request instead of filling the board with duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_waitlist_customer_request
  ON bms_restaurant_waitlist (tenant_id, location_id, customer_id, reserved_for)
  WHERE source = 'CUSTOMER_AI' AND status IN ('REQUESTED', 'WAITING', 'CALLED');

COMMENT ON COLUMN bms_restaurant_waitlist.source IS
  'STAFF entries are operational immediately; CUSTOMER_AI reservations remain REQUESTED until accepted by staff.';
COMMENT ON COLUMN bms_restaurant_waitlist.customer_id IS
  'Server-resolved canonical customer identity for customer-originated requests; never supplied by the model.';
