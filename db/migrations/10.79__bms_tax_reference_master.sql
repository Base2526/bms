-- Recovery-safe entry point for SQL clients such as HeidiSQL. A previous
-- attempt may have left this connection inside an aborted transaction; no SQL
-- except ROLLBACK can run in that state. This also harmlessly emits a warning
-- when the connection is already idle. Run this file as one complete batch.
ROLLBACK;
BEGIN;

-- Phase 4: versioned tax/e-Tax reference data. These tables advise and
-- validate configuration; bms_store_profile.vat_rate remains the sale-time
-- authority and issued bms_tax_documents remain immutable snapshots.
-- ROLLBACK: return XML to the compatibility constants in etax/xml.ts, then
-- drop these three global reference tables and their revision tables. The
-- global revision helper is shared by the master-data tables from 10.76 and
-- 10.78, so keep it while either of those migrations remains installed.

-- create_revision_trigger() is intentionally tenant-only: its trigger reads
-- OLD.tenant_id and its history table requires tenant_id. Platform master data
-- has no tenant_id, so give global reference tables their own append-only
-- history helper. The ALTER path repairs the unusable tenant revision tables
-- created for the 10.76/10.78 global masters without rewriting those applied
-- migrations.
CREATE OR REPLACE FUNCTION public.trg_global_revision() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_editor uuid;
  v_revision uuid;
  v_rev_table text := TG_TABLE_NAME || '_revisions';
BEGIN
  BEGIN
    v_editor := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_editor := NULL;
  END;

  BEGIN
    v_revision := NULLIF(current_setting('app.revision_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_revision := NULL;
  END;

  IF TG_OP = 'UPDATE' THEN
    EXECUTE format(
      'INSERT INTO %I (id, editor_id, revision_id, snapshot, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())',
      v_rev_table
    ) USING v_editor, v_revision, to_jsonb(OLD);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_global_revision_trigger(p_table text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rev_table text := p_table || '_revisions';
  trg_name text := p_table || '_rev_trg';
BEGIN
  -- Repairs for master tables introduced by earlier phases are best-effort:
  -- some long-lived environments have not applied every optional phase yet.
  -- Phase 4 tables call this helper only after their own CREATE TABLE, so they
  -- remain mandatory while missing earlier-phase tables are safely skipped.
  IF to_regclass(format('%I.%I', 'public', p_table)) IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I (' ||
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ' ||
    'editor_id uuid, ' ||
    'revision_id uuid, ' ||
    'snapshot jsonb NOT NULL, ' ||
    'created_at timestamptz NOT NULL DEFAULT now())',
    rev_table
  );

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = rev_table AND column_name = 'tenant_id'
  ) THEN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id DROP NOT NULL', rev_table);
  END IF;

  EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', rev_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rev_table || '_tenant_isolation', rev_table);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', rev_table);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM bms_app', rev_table);
  EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', rev_table);
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg_name, p_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.trg_global_revision()',
    trg_name,
    p_table
  );
END;
$$;

CREATE TABLE IF NOT EXISTS bms_master_tax_document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  bms_document_type TEXT CHECK (bms_document_type IS NULL OR bms_document_type IN ('ABBREVIATED','FULL','CREDIT_NOTE')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  CHECK (name_th <> '' AND name_en <> ''),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (code, effective_from),
  UNIQUE (bms_document_type, effective_from)
);

-- This must precede the seed. A database that attempted the original 10.79
-- may already have the tenant-only trigger attached to this global table.
SELECT public.create_global_revision_trigger('bms_master_tax_document_types');

INSERT INTO bms_master_tax_document_types
  (code,name_th,name_en,bms_document_type,effective_from,source,source_version)
VALUES
  ('T01','ใบรับ','Receipt',NULL,'1900-01-01','ETDA Trade Services Message Standard','ETDA 3-2560 v2.0'),
  -- The three mappings below deliberately preserve the existing BMS beta XML
  -- byte contract. They are compatibility mappings, not a claim of XSD readiness.
  ('T02','ใบแจ้งหนี้/ใบกำกับภาษี','Invoice / Tax Invoice','ABBREVIATED','1900-01-01','BMS e-Tax beta compatibility mapping','pre-10.79'),
  ('T03','ใบเสร็จรับเงิน/ใบกำกับภาษี','Receipt / Tax Invoice','FULL','1900-01-01','BMS e-Tax beta compatibility mapping','pre-10.79'),
  ('T04','ใบส่งของ/ใบกำกับภาษี','Delivery Order / Tax Invoice','CREDIT_NOTE','1900-01-01','BMS e-Tax beta compatibility mapping','pre-10.79'),
  ('T05','ใบกำกับภาษีอย่างย่อ','Abbreviated Tax Invoice',NULL,'1900-01-01','ETDA Trade Services Message Standard','ETDA 3-2560 v2.0'),
  ('80','ใบเพิ่มหนี้','Debit Note',NULL,'1900-01-01','ETDA Trade Services Message Standard','ETDA 3-2560 v2.0'),
  ('81','ใบลดหนี้','Credit Note',NULL,'1900-01-01','ETDA Trade Services Message Standard','ETDA 3-2560 v2.0'),
  ('388','ใบกำกับภาษี','Tax Invoice',NULL,'1900-01-01','ETDA Trade Services Message Standard','ETDA 3-2560 v2.0')
ON CONFLICT (code,effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS bms_master_vat_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  rate NUMERIC(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (country_code ~ '^[A-Z]{2}$'),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (country_code,effective_from)
);

-- Install the global trigger before ON CONFLICT DO UPDATE below; otherwise a
-- retry against the original table fires trg_generic_revision(), which reads
-- the nonexistent OLD.tenant_id and aborts the whole transaction.
SELECT public.create_global_revision_trigger('bms_master_vat_rates');

INSERT INTO bms_master_vat_rates
  (country_code,rate,effective_from,effective_to,source,source_version)
VALUES
  ('TH',7.0000,'2017-10-01','2027-09-30','Thai Revenue Department','Royal Decree 807 B.E. 2569')
ON CONFLICT (country_code,effective_from) DO UPDATE
  SET effective_to=EXCLUDED.effective_to,source=EXCLUDED.source,source_version=EXCLUDED.source_version,updated_at=now();

CREATE TABLE IF NOT EXISTS bms_master_tax_buyer_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  tax_id_policy TEXT NOT NULL CHECK (tax_id_policy IN ('THAI_13_REQUIRED','THAI_13_OPTIONAL','OPTIONAL')),
  branch_policy TEXT NOT NULL CHECK (branch_policy IN ('REQUIRED_DEFAULT_HEAD_OFFICE','OPTIONAL','FORBIDDEN')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code IN ('COMPANY','INDIVIDUAL','FOREIGNER')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (code,effective_from)
);

SELECT public.create_global_revision_trigger('bms_master_tax_buyer_types');

INSERT INTO bms_master_tax_buyer_types
  (code,name_th,name_en,tax_id_policy,branch_policy,effective_from,source,source_version)
VALUES
  ('COMPANY','นิติบุคคล','Company','THAI_13_REQUIRED','REQUIRED_DEFAULT_HEAD_OFFICE','1900-01-01','BMS tax buyer contract','10.60'),
  ('INDIVIDUAL','บุคคลธรรมดา','Individual','THAI_13_OPTIONAL','FORBIDDEN','1900-01-01','BMS tax buyer contract','10.60'),
  ('FOREIGNER','ชาวต่างชาติ','Foreigner','THAI_13_OPTIONAL','FORBIDDEN','1900-01-01','BMS tax buyer contract','10.60')
ON CONFLICT (code,effective_from) DO NOTHING;

-- Repair the global master triggers introduced by 10.76 and 10.78, then use
-- the same helper for this phase. Tenant-owned shipping overrides deliberately
-- keep the original tenant revision helper.
SELECT public.create_global_revision_trigger('bms_master_banks');
SELECT public.create_global_revision_trigger('bms_master_units');
SELECT public.create_global_revision_trigger('bms_master_th_provinces');
SELECT public.create_global_revision_trigger('bms_master_th_districts');
SELECT public.create_global_revision_trigger('bms_master_th_subdistricts');
SELECT public.create_global_revision_trigger('bms_master_carriers');
SELECT public.create_global_revision_trigger('bms_master_th_shipping_zones');

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bms_master_tax_document_types','bms_master_vat_rates','bms_master_tax_buyer_types'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM bms_app', tbl);
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl || '_revisions');
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl || '_revisions');
  END LOOP;
END $$;

COMMENT ON TABLE bms_master_tax_document_types IS 'Versioned e-Tax document codes; current XML mappings remain beta compatibility mappings.';
COMMENT ON TABLE bms_master_vat_rates IS 'Advisory statutory VAT references only; never the sale calculation authority.';
COMMENT ON TABLE bms_master_tax_buyer_types IS 'Versioned buyer validation policy; checksum implementation remains in application code.';

COMMIT;
