BEGIN;
ALTER TABLE bms_tax_invoice_requests
  ADD COLUMN IF NOT EXISTS submission_count INTEGER,
  ADD COLUMN IF NOT EXISTS request_deadline TIMESTAMPTZ;

-- Existing requests retain their real audit-derived usage, never the staff-edit version.
UPDATE bms_tax_invoice_requests r SET submission_count = LEAST(3, 1 + (
  SELECT count(*)::int FROM bms_audit_log a
  WHERE a.tenant_id=r.tenant_id AND a.target=r.id::text AND a.action='tax.request.revise'
)) WHERE submission_count IS NULL;
UPDATE bms_tax_invoice_requests r SET request_deadline = (
  SELECT COALESCE((SELECT min(d.issued_at) FROM bms_tax_documents d
    WHERE d.tenant_id=r.tenant_id AND d.order_id=r.order_id AND d.doc_type='ABBREVIATED'),
    o.paid_at,o.created_at) + interval '168 hours'
  FROM bms_orders o WHERE o.tenant_id=r.tenant_id AND o.id=r.order_id
) WHERE request_deadline IS NULL;
ALTER TABLE bms_tax_invoice_requests
  ALTER COLUMN submission_count SET DEFAULT 1,
  ALTER COLUMN submission_count SET NOT NULL,
  ALTER COLUMN request_deadline SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_tax_invoice_requests'::regclass AND conname='tax_request_submission_count_range') THEN
    ALTER TABLE bms_tax_invoice_requests ADD CONSTRAINT tax_request_submission_count_range CHECK (submission_count BETWEEN 1 AND 3);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_tax_request_submissions (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  submission_no INTEGER NOT NULL CHECK (submission_no BETWEEN 1 AND 3),
  client_version INTEGER CHECK (client_version >= 0),
  buyer JSONB NOT NULL CHECK (jsonb_typeof(buyer)='object'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  legacy_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id,request_id,submission_no),
  UNIQUE (tenant_id,request_id,client_version),
  FOREIGN KEY (tenant_id,request_id) REFERENCES bms_tax_invoice_requests(tenant_id,id) ON DELETE CASCADE
);
-- Old buyer revisions were not snapshotted. Preserve only the known latest snapshot; do not invent history.
INSERT INTO bms_tax_request_submissions(tenant_id,request_id,submission_no,buyer,submitted_at,legacy_snapshot)
 SELECT r.tenant_id,r.id,r.submission_count,r.buyer,r.updated_at,TRUE
 FROM bms_tax_invoice_requests r
 WHERE NOT EXISTS (SELECT 1 FROM bms_tax_request_submissions s WHERE s.tenant_id=r.tenant_id AND s.request_id=r.id)
 ON CONFLICT DO NOTHING;
ALTER TABLE bms_tax_request_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_tax_request_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_tax_request_submissions_tenant ON bms_tax_request_submissions;
CREATE POLICY bms_tax_request_submissions_tenant ON bms_tax_request_submissions
 USING (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_tax_request_submissions TO bms_app;
COMMIT;
