BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_tax_documents_tenant_id ON bms_tax_documents(tenant_id,id);
CREATE TABLE IF NOT EXISTS bms_tax_invoice_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  order_id UUID NOT NULL,
  buyer JSONB NOT NULL CHECK (jsonb_typeof(buyer) = 'object'),
  access_hash TEXT NOT NULL CHECK (access_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','NEEDS_INFO','REJECTED','ISSUED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  feedback TEXT,
  document_id UUID,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  access_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 days'),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, order_id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES bms_orders(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, document_id) REFERENCES bms_tax_documents(tenant_id,id),
  CHECK ((status = 'ISSUED') = (document_id IS NOT NULL)),
  CHECK (status NOT IN ('NEEDS_INFO','REJECTED') OR (feedback IS NOT NULL AND length(btrim(feedback)) BETWEEN 1 AND 1000))
);
CREATE INDEX IF NOT EXISTS idx_bms_tax_requests_queue ON bms_tax_invoice_requests(tenant_id,location_id,status,created_at);
ALTER TABLE bms_tax_invoice_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_tax_invoice_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_tax_requests_tenant ON bms_tax_invoice_requests;
CREATE POLICY bms_tax_requests_tenant ON bms_tax_invoice_requests
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true),'')::uuid);
GRANT SELECT, INSERT, UPDATE ON bms_tax_invoice_requests TO bms_app;
COMMIT;
