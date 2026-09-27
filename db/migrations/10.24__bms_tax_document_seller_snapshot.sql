-- =============================================================
-- 10.24  Seller identity snapshot on immutable tax documents
-- -------------------------------------------------------------
-- Reprinting or submitting an old document must not silently pick up a later
-- shop/profile/address edit. Existing rows receive the best evidence currently
-- available; every new document writes these fields in its issuance transaction.
-- =============================================================

BEGIN;

ALTER TABLE bms_tax_documents
  ADD COLUMN IF NOT EXISTS seller_name TEXT,
  ADD COLUMN IF NOT EXISTS seller_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS seller_branch_code TEXT,
  ADD COLUMN IF NOT EXISTS seller_address TEXT,
  ADD COLUMN IF NOT EXISTS seller_phone TEXT;

UPDATE bms_tax_documents d
   SET seller_name = COALESCE(d.seller_name, NULLIF(btrim(t.name), '')),
       seller_tax_id = COALESCE(d.seller_tax_id, NULLIF(btrim(s.tax_id), '')),
       seller_branch_code = COALESCE(d.seller_branch_code, NULLIF(btrim(l.branch_code), '')),
       seller_address = COALESCE(d.seller_address, NULLIF(btrim(l.address), ''), NULLIF(btrim(s.address), '')),
       seller_phone = COALESCE(d.seller_phone, NULLIF(btrim(l.phone), ''), NULLIF(btrim(s.phone), ''))
  FROM bms_tenants t
  JOIN bms_locations l ON l.tenant_id = t.id
  LEFT JOIN bms_store_profile s ON s.tenant_id = t.id
 WHERE d.tenant_id = t.id AND d.location_id = l.id
   AND (d.seller_name IS NULL OR d.seller_tax_id IS NULL OR d.seller_branch_code IS NULL
        OR d.seller_address IS NULL OR d.seller_phone IS NULL);

COMMENT ON COLUMN bms_tax_documents.seller_name IS
  'Immutable seller name snapshot at issuance; 10.24 backfilled legacy rows from current tenant data';
COMMENT ON COLUMN bms_tax_documents.seller_tax_id IS
  'Immutable seller tax-ID snapshot at issuance';
COMMENT ON COLUMN bms_tax_documents.seller_branch_code IS
  'Immutable seller establishment branch snapshot at issuance (00000 = head office)';
COMMENT ON COLUMN bms_tax_documents.seller_address IS
  'Immutable seller establishment address snapshot at issuance';
COMMENT ON COLUMN bms_tax_documents.seller_phone IS
  'Immutable seller phone snapshot at issuance';

COMMIT;

-- ROLLBACK intentionally omitted: dropping immutable financial evidence after new
-- documents use it is destructive. A pre-deploy rollback may drop the five columns.
