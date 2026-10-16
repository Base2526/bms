-- Recovery-safe entry point for SQL clients such as HeidiSQL. Run the whole file.
ROLLBACK;
BEGIN;

-- Phase 6: a platform-global barcode suggestion cache.
-- Provider responses are deliberately excluded: Barcode Lookup's subscription terms
-- do not grant a durable, cross-merchant redistribution right. Only an explicit
-- merchant confirmation or a platform-curated row may enter this table.

CREATE TABLE IF NOT EXISTS bms_master_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  size_text TEXT,
  unit_code TEXT REFERENCES bms_master_units(code),
  category_hint TEXT,
  image_file_id BIGINT,
  source TEXT NOT NULL CHECK (source IN ('PROVIDER','MERCHANT_CONFIRMED','PLATFORM_CURATED')),
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE','APPROVED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (barcode ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  CHECK (barcode !~ '^2[0-9]' AND barcode !~ '^02[0-9]'),
  CHECK (name <> '')
);
CREATE INDEX IF NOT EXISTS idx_bms_master_barcodes_review
  ON bms_master_barcodes(status, confirmations DESC, updated_at DESC);

-- This tenant-owned ledger prevents one shop repeatedly inflating the confirmation
-- counter. Tenant identity never appears in the global master row or its revisions.
CREATE TABLE IF NOT EXISTS bms_barcode_master_contributions (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  -- Audit snapshot only: do not cascade/delete this proof when the product is
  -- later removed, or the same shop could inflate confirmations by recreating it.
  product_sku TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, barcode)
);
ALTER TABLE bms_barcode_master_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_barcode_master_contributions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_barcode_master_contributions_tenant_isolation ON bms_barcode_master_contributions;
CREATE POLICY bms_barcode_master_contributions_tenant_isolation ON bms_barcode_master_contributions
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS barcode_master_contribution_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.submit_master_barcode_candidate(
  p_barcode TEXT,
  p_name TEXT,
  p_brand TEXT,
  p_size_text TEXT,
  p_unit_code TEXT,
  p_category_hint TEXT,
  p_product_sku TEXT,
  p_actor TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant UUID;
  v_inserted INTEGER;
  v_sum INTEGER := 0;
  v_i INTEGER;
  v_digit INTEGER;
  v_len INTEGER;
BEGIN
  v_tenant := NULLIF(current_setting('bms.tenant_id', true), '')::uuid;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bms_store_profile
     WHERE tenant_id = v_tenant AND barcode_master_contribution_enabled
  ) THEN RETURN FALSE; END IF;

  p_barcode := btrim(COALESCE(p_barcode, ''));
  p_name := left(btrim(COALESCE(p_name, '')), 200);
  v_len := length(p_barcode);
  IF p_name = '' OR p_barcode !~ '^[0-9]+$' OR v_len NOT IN (8,12,13,14)
     OR p_barcode ~ '^2[0-9]' OR p_barcode ~ '^02[0-9]' THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bms_products
     WHERE tenant_id = v_tenant AND sku = p_product_sku
  ) THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  -- GS1 modulo-10 check digit, weighted from the rightmost data digit.
  FOR v_i IN REVERSE v_len - 1..1 LOOP
    v_digit := substr(p_barcode, v_i, 1)::integer;
    v_sum := v_sum + v_digit * CASE WHEN (v_len - v_i) % 2 = 1 THEN 3 ELSE 1 END;
  END LOOP;
  IF ((10 - (v_sum % 10)) % 10) <> right(p_barcode, 1)::integer THEN RETURN FALSE; END IF;

  INSERT INTO bms_barcode_master_contributions
    (tenant_id,barcode,product_sku,confirmed_by)
  VALUES (v_tenant,p_barcode,p_product_sku,NULLIF(p_actor,''))
  ON CONFLICT (tenant_id,barcode) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN RETURN FALSE; END IF;

  INSERT INTO bms_master_barcodes
    (barcode,name,brand,size_text,unit_code,category_hint,image_file_id,source,confirmations,status)
  VALUES (
    p_barcode,p_name,NULLIF(left(btrim(COALESCE(p_brand,'')),120),''),
    NULLIF(left(btrim(COALESCE(p_size_text,'')),80),''),
    CASE WHEN EXISTS (
      SELECT 1 FROM bms_master_units u
       WHERE u.code = NULLIF(left(upper(btrim(COALESCE(p_unit_code,''))),3),'')
    ) THEN NULLIF(left(upper(btrim(COALESCE(p_unit_code,''))),3),'') ELSE NULL END,
    NULLIF(left(btrim(COALESCE(p_category_hint,'')),120),''),NULL,
    'MERCHANT_CONFIRMED',1,'CANDIDATE'
  )
  ON CONFLICT (barcode) DO UPDATE SET
    confirmations = bms_master_barcodes.confirmations + 1,
    name = CASE WHEN bms_master_barcodes.status = 'CANDIDATE' THEN EXCLUDED.name ELSE bms_master_barcodes.name END,
    brand = CASE WHEN bms_master_barcodes.status = 'CANDIDATE' THEN EXCLUDED.brand ELSE bms_master_barcodes.brand END,
    size_text = CASE WHEN bms_master_barcodes.status = 'CANDIDATE' THEN EXCLUDED.size_text ELSE bms_master_barcodes.size_text END,
    unit_code = CASE WHEN bms_master_barcodes.status = 'CANDIDATE' THEN EXCLUDED.unit_code ELSE bms_master_barcodes.unit_code END,
    category_hint = CASE WHEN bms_master_barcodes.status = 'CANDIDATE' THEN EXCLUDED.category_hint ELSE bms_master_barcodes.category_hint END,
    updated_at = now();

  INSERT INTO bms_audit_log (tenant_id,actor,action,target,meta)
  VALUES (v_tenant,COALESCE(NULLIF(p_actor,''),'system'),'barcode.master_confirm',p_barcode,
          jsonb_build_object('productSku',p_product_sku));
  RETURN TRUE;
END $$;

SELECT public.create_global_revision_trigger('bms_master_barcodes');

REVOKE ALL ON TABLE bms_master_barcodes FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE bms_master_barcodes FROM bms_app;
GRANT SELECT ON TABLE bms_master_barcodes TO bms_app;
REVOKE ALL ON TABLE bms_master_barcodes_revisions FROM PUBLIC;
GRANT SELECT ON TABLE bms_master_barcodes_revisions TO bms_app;
REVOKE ALL ON TABLE bms_barcode_master_contributions FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE bms_barcode_master_contributions TO bms_app;
REVOKE ALL ON FUNCTION public.submit_master_barcode_candidate(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_master_barcode_candidate(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO bms_app;

COMMENT ON TABLE bms_master_barcodes IS 'Global barcode autofill suggestions. Never stores tenant, shop, price, cost or stock; provider payloads are not persisted.';
COMMENT ON COLUMN bms_master_barcodes.image_file_id IS 'Reserved for a future platform-owned asset; tenant-private file ids must never be stored here.';
COMMENT ON COLUMN bms_store_profile.barcode_master_contribution_enabled IS 'Explicit shop opt-in; default false. A user must also confirm each product submission.';

COMMIT;
