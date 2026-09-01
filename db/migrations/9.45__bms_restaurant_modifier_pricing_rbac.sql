-- =============================================================
-- 9.45  Restaurant modifier pricing and operational permissions
-- -------------------------------------------------------------
-- Modifier prices are server-owned catalog data.  They are added to the
-- immutable sale-time pricing snapshot; clients may select a code but never
-- supply its price.
-- =============================================================

ALTER TABLE bms_product_modifiers
  ADD COLUMN IF NOT EXISTS price_delta NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_product_modifiers_price_delta_nonnegative'
       AND conrelid = 'bms_product_modifiers'::regclass
  ) THEN
    ALTER TABLE bms_product_modifiers
      ADD CONSTRAINT bms_product_modifiers_price_delta_nonnegative
      CHECK (price_delta >= 0);
  END IF;
END $$;

COMMENT ON COLUMN bms_product_modifiers.price_delta IS
  'Non-negative surcharge per sold menu unit. Resolved by createOrder in the tenant transaction; never trusted from a POS payload.';

-- Administrator is a super-role in code.  Explicit seeds cover the normal
-- restaurant operators without reusing unrelated shipping/device permissions.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager',    'restaurant.floor.manage'),
  ('Manager',    'restaurant.kitchen.update'),
  ('Manager',    'restaurant.check.cancel'),
  ('Sales',      'restaurant.kitchen.update'),
  ('Cashier',    'restaurant.kitchen.update'),
  ('Pharmacist', 'restaurant.kitchen.update')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
