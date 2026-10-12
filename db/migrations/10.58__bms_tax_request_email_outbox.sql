BEGIN;
CREATE TABLE IF NOT EXISTS bms_tax_request_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  document_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 100),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
  invoice_snapshot JSONB NOT NULL CHECK (jsonb_typeof(invoice_snapshot)='object'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN','CANCELLED')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  UNIQUE (tenant_id,request_id,idempotency_key),
  FOREIGN KEY (tenant_id,request_id) REFERENCES bms_tax_invoice_requests(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,document_id) REFERENCES bms_tax_documents(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_tax_request_emails_latest ON bms_tax_request_emails(tenant_id,request_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_tax_request_emails_pending ON bms_tax_request_emails(tenant_id,created_at) WHERE status IN ('PENDING','SENDING');
ALTER TABLE bms_tax_request_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_tax_request_emails FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_request_emails_tenant ON bms_tax_request_emails;
CREATE POLICY tax_request_emails_tenant ON bms_tax_request_emails
  USING (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON bms_tax_request_emails TO bms_app;
COMMIT;
