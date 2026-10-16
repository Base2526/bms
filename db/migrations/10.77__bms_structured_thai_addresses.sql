-- 10.77 Structured Thai address snapshots (master-data phase 2)
-- Additive only: legacy free-text addresses remain authoritative/readable.
-- Apply with psql -1. ALTER TABLE takes a brief ACCESS EXCLUSIVE lock.
-- ROLLBACK: revert application writers first. Keep snapshot columns while referenced;
-- then drop the new FKs/columns only after exporting affected address and tax rows.

ALTER TABLE bms_customer_addresses
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS subdistrict TEXT;

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS province_code TEXT,
  ADD COLUMN IF NOT EXISTS district_code TEXT,
  ADD COLUMN IF NOT EXISTS subdistrict_code TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS subdistrict TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT;

ALTER TABLE bms_locations
  ADD COLUMN IF NOT EXISTS province_code TEXT,
  ADD COLUMN IF NOT EXISTS district_code TEXT,
  ADD COLUMN IF NOT EXISTS subdistrict_code TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS subdistrict TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT;

ALTER TABLE bms_tax_documents
  ADD COLUMN IF NOT EXISTS buyer_province_code TEXT,
  ADD COLUMN IF NOT EXISTS buyer_district_code TEXT,
  ADD COLUMN IF NOT EXISTS buyer_subdistrict_code TEXT,
  ADD COLUMN IF NOT EXISTS buyer_province TEXT,
  ADD COLUMN IF NOT EXISTS buyer_district TEXT,
  ADD COLUMN IF NOT EXISTS buyer_subdistrict TEXT,
  ADD COLUMN IF NOT EXISTS buyer_postcode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_province_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_province_code_fkey
      FOREIGN KEY (province_code) REFERENCES bms_master_th_provinces(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_district_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_district_code_fkey
      FOREIGN KEY (district_code) REFERENCES bms_master_th_districts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_subdistrict_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_subdistrict_code_fkey
      FOREIGN KEY (subdistrict_code) REFERENCES bms_master_th_subdistricts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_locations_province_code_fkey') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_province_code_fkey
      FOREIGN KEY (province_code) REFERENCES bms_master_th_provinces(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_locations_district_code_fkey') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_district_code_fkey
      FOREIGN KEY (district_code) REFERENCES bms_master_th_districts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_locations_subdistrict_code_fkey') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_subdistrict_code_fkey
      FOREIGN KEY (subdistrict_code) REFERENCES bms_master_th_subdistricts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_tax_documents_buyer_province_code_fkey') THEN
    ALTER TABLE bms_tax_documents ADD CONSTRAINT bms_tax_documents_buyer_province_code_fkey
      FOREIGN KEY (buyer_province_code) REFERENCES bms_master_th_provinces(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_tax_documents_buyer_district_code_fkey') THEN
    ALTER TABLE bms_tax_documents ADD CONSTRAINT bms_tax_documents_buyer_district_code_fkey
      FOREIGN KEY (buyer_district_code) REFERENCES bms_master_th_districts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_tax_documents_buyer_subdistrict_code_fkey') THEN
    ALTER TABLE bms_tax_documents ADD CONSTRAINT bms_tax_documents_buyer_subdistrict_code_fkey
      FOREIGN KEY (buyer_subdistrict_code) REFERENCES bms_master_th_subdistricts(code);
  END IF;
END $$;

COMMENT ON COLUMN bms_tax_documents.buyer_province IS
  'Immutable buyer address snapshot; printing never joins mutable master data.';
COMMENT ON COLUMN bms_customer_addresses.district IS
  'Display snapshot from master data; legacy rows may remain NULL.';
COMMENT ON COLUMN bms_customer_addresses.subdistrict IS
  'Display snapshot from master data; legacy rows may remain NULL.';
