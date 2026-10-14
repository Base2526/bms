-- Tax controls: append-only action evidence and versioned period snapshots.
-- Existing tax point / COMPLETED eligibility is deliberately unchanged.
ALTER TABLE bms_tax_documents DROP CONSTRAINT IF EXISTS bms_tax_documents_doc_type_check;
ALTER TABLE bms_tax_documents ADD CONSTRAINT bms_tax_documents_doc_type_check
  CHECK (doc_type IN ('ABBREVIATED','FULL','CREDIT_NOTE','DEBIT_NOTE'));
ALTER TABLE bms_document_counters DROP CONSTRAINT IF EXISTS bms_document_counters_doc_type_check;
ALTER TABLE bms_document_counters ADD CONSTRAINT bms_document_counters_doc_type_check
  CHECK (doc_type IN ('ABBREVIATED','FULL','CREDIT_NOTE','DEBIT_NOTE'));
ALTER TABLE bms_tax_documents
  ADD COLUMN IF NOT EXISTS buyer_vat_registered boolean,
  ADD COLUMN IF NOT EXISTS print_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS adjustment_kind text CHECK (adjustment_kind IN ('PRICE','CORRECTION'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_tax_documents_tenant_id ON bms_tax_documents(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_locations_tax_tenant_id ON bms_locations(tenant_id,id);

CREATE TABLE IF NOT EXISTS bms_tax_document_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL REFERENCES bms_locations(id),
  document_id uuid NOT NULL REFERENCES bms_tax_documents(id),
  result_document_id uuid REFERENCES bms_tax_documents(id),
  action text NOT NULL CHECK (action IN ('SUBSTITUTE','CORRECT','CREDIT','DEBIT')),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  reason text NOT NULL,
  evidence text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_name text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issue_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date,
  copy_number integer,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,document_id) REFERENCES bms_tax_documents(tenant_id,id),
  FOREIGN KEY (tenant_id,result_document_id) REFERENCES bms_tax_documents(tenant_id,id),
  CHECK ((action='SUBSTITUTE' AND copy_number IS NOT NULL AND copy_number > 0 AND result_document_id IS NULL)
    OR (action <> 'SUBSTITUTE' AND copy_number IS NULL AND result_document_id IS NOT NULL)),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, document_id, copy_number)
);
CREATE INDEX IF NOT EXISTS idx_bms_tax_actions_month
  ON bms_tax_document_actions (tenant_id, location_id, issue_date);

CREATE TABLE IF NOT EXISTS bms_tax_period_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL REFERENCES bms_locations(id),
  tax_month text NOT NULL CHECK (tax_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  version integer NOT NULL CHECK (version > 0),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  report_hash text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, location_id, tax_month, version)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_tax_document_actions','bms_tax_period_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''bms.tenant_id'',true),'''')::uuid)', t || '_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app', t);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM bms_app', t);
  END LOOP;
END $$;
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission FROM bms_tenants t CROSS JOIN roles r
CROSS JOIN (VALUES ('tax.document.adjust'),('tax.period.close')) p(permission)
WHERE r.name = 'Manager' ON CONFLICT DO NOTHING;
-- No existing document is backfilled from today's identity; old snapshots remain unchanged.
