BEGIN;

-- Phase 4: versioned tax/e-Tax reference data. These tables advise and
-- validate configuration; bms_store_profile.vat_rate remains the sale-time
-- authority and issued bms_tax_documents remain immutable snapshots.
-- ROLLBACK: return XML to the compatibility constants in etax/xml.ts, then
-- drop these three global reference tables and their revision tables.

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

INSERT INTO bms_master_tax_buyer_types
  (code,name_th,name_en,tax_id_policy,branch_policy,effective_from,source,source_version)
VALUES
  ('COMPANY','นิติบุคคล','Company','THAI_13_REQUIRED','REQUIRED_DEFAULT_HEAD_OFFICE','1900-01-01','BMS tax buyer contract','10.60'),
  ('INDIVIDUAL','บุคคลธรรมดา','Individual','THAI_13_OPTIONAL','FORBIDDEN','1900-01-01','BMS tax buyer contract','10.60'),
  ('FOREIGNER','ชาวต่างชาติ','Foreigner','THAI_13_OPTIONAL','FORBIDDEN','1900-01-01','BMS tax buyer contract','10.60')
ON CONFLICT (code,effective_from) DO NOTHING;

SELECT public.create_revision_trigger('bms_master_tax_document_types');
SELECT public.create_revision_trigger('bms_master_vat_rates');
SELECT public.create_revision_trigger('bms_master_tax_buyer_types');

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
