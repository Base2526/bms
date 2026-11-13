BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS bms_branch_price_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES bms_locations(id),
  product_sku text NOT NULL,
  size text NOT NULL,
  pack_code text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku),
  CONSTRAINT bms_branch_price_window_dates CHECK (ends_at IS NULL OR ends_at > starts_at)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'bms_branch_price_windows'::regclass
      AND conname = 'bms_branch_price_windows_no_overlap'
  ) THEN
    ALTER TABLE bms_branch_price_windows ADD CONSTRAINT bms_branch_price_windows_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =, location_id WITH =, product_sku WITH =,
        size WITH =, pack_code WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (cancelled_at IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_branch_price_windows_lookup
  ON bms_branch_price_windows (tenant_id, location_id, product_sku, size, pack_code, starts_at DESC)
  WHERE cancelled_at IS NULL;

ALTER TABLE bms_branch_price_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_branch_price_windows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_branch_price_windows_tenant ON bms_branch_price_windows;
CREATE POLICY bms_branch_price_windows_tenant ON bms_branch_price_windows
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON bms_branch_price_windows TO bms_app;

COMMIT;

-- ROLLBACK: deploy the previous application first, then retain this table as historical
-- evidence until all published windows and affected sale snapshots have been reviewed.
