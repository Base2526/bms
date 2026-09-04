-- 9.55 Restaurant menu temporary unavailability ("sold out today")
-- A row closes one product at one branch without changing the product's durable active flag.

BEGIN;

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS menu_availability_reset_time TIME NOT NULL DEFAULT '04:00';

CREATE TABLE IF NOT EXISTS bms_product_menu_unavailability (
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL,
  product_sku     TEXT NOT NULL,
  unavailable_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  unavailable_by  UUID NOT NULL REFERENCES users(id),
  reason          TEXT,
  resets_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, location_id, product_sku),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CONSTRAINT bms_product_menu_unavailability_reason_check
    CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 240)
);

CREATE INDEX IF NOT EXISTS idx_bms_product_menu_unavailability_due
  ON bms_product_menu_unavailability (resets_at);

COMMENT ON TABLE bms_product_menu_unavailability IS
  'Branch-scoped temporary menu closure (9.55). A row is cleared when resets_at passes -- by the
reset cron, or by the next shift-open at that branch acting as the fallback sweep. Shift-open must
never clear a row that is still inside its service day: shifts are per device and per cashier, so a
second register opening would otherwise put genuinely sold-out food back on the menu. active is
never touched by this table.';
COMMENT ON COLUMN bms_store_profile.menu_availability_reset_time IS
  'Local wall-clock time at which temporary menu closures reset each service day. Default 04:00.';

ALTER TABLE bms_product_menu_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_menu_unavailability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_menu_unavailability_tenant_isolation
  ON bms_product_menu_unavailability;
CREATE POLICY bms_product_menu_unavailability_tenant_isolation
  ON bms_product_menu_unavailability
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_menu_unavailability TO bms_app;
GRANT SELECT, UPDATE ON bms_store_profile TO bms_app;

SELECT public.create_revision_trigger('bms_product_menu_unavailability');

COMMIT;
