-- =============================================================
-- 9.37 — Branch visibility and policy scope foundations
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_coupons_tenant_id
  ON bms_coupons(tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_locations_tenant_id
  ON bms_locations(tenant_id, id);

CREATE TABLE IF NOT EXISTS bms_coupon_locations (
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  coupon_id   UUID NOT NULL,
  location_id UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, coupon_id, location_id),
  CONSTRAINT bms_coupon_locations_coupon_fk
    FOREIGN KEY (tenant_id, coupon_id) REFERENCES bms_coupons(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT bms_coupon_locations_location_fk
    FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_coupon_locations_location
  ON bms_coupon_locations(tenant_id, location_id);

ALTER TABLE bms_coupon_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_coupon_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_coupon_locations_tenant_isolation ON bms_coupon_locations;
CREATE POLICY bms_coupon_locations_tenant_isolation ON bms_coupon_locations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_coupon_locations TO bms_app;

CREATE TABLE IF NOT EXISTS bms_user_allowed_locations (
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, location_id),
  CONSTRAINT bms_user_allowed_locations_location_fk
    FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_user_allowed_locations_user
  ON bms_user_allowed_locations(tenant_id, user_id);

ALTER TABLE bms_user_allowed_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_user_allowed_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_user_allowed_locations_tenant_isolation ON bms_user_allowed_locations;
CREATE POLICY bms_user_allowed_locations_tenant_isolation ON bms_user_allowed_locations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_user_allowed_locations TO bms_app;

COMMENT ON TABLE bms_coupon_locations IS
  'Optional branch scope for coupons. No rows means all active branches can use the coupon.';
COMMENT ON TABLE bms_user_allowed_locations IS
  'Optional branch access scope for staff. No rows keeps existing tenant-wide RBAC behavior.';
