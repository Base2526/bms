BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS bms_branch_prices (
 tenant_id uuid NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
 location_id uuid NOT NULL REFERENCES bms_locations(id),
 product_sku text NOT NULL,
 size text NOT NULL,
 pack_code text NOT NULL,
 price numeric(12,2) NOT NULL CHECK(price>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,location_id,product_sku,size,pack_code),
 FOREIGN KEY(tenant_id,product_sku) REFERENCES bms_products(tenant_id,sku)
);
ALTER TABLE bms_branch_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_branch_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_branch_prices;
CREATE POLICY tenant_isolation ON bms_branch_prices USING(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON bms_branch_prices TO bms_app;
DROP INDEX IF EXISTS uq_bms_promotions_active_sku;
DROP INDEX IF EXISTS uq_bms_promotions_active_global;
DROP INDEX IF EXISTS uq_bms_promotions_active_branch;
-- Remove the 9.61 partial unique indexes, independent of their historical names.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT indexrelid::regclass AS name FROM pg_index WHERE indrelid='bms_product_promotions'::regclass AND indisunique AND indpred IS NOT NULL
 LOOP EXECUTE format('DROP INDEX %s',r.name); END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='bms_product_promotions'::regclass AND conname='bms_promotion_windows_exclusive') THEN
 ALTER TABLE bms_product_promotions ADD CONSTRAINT bms_promotion_windows_exclusive EXCLUDE USING gist
 (tenant_id WITH =, product_sku WITH =, (COALESCE(location_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
 tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(active);
 END IF;
END $$;
COMMIT;
-- ROLLBACK: revert application and preserve branch prices/schedule history. Restore unique indexes only after explicitly resolving future windows.
