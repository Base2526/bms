CREATE TABLE IF NOT EXISTS bms_retention_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  cohort TEXT NOT NULL CHECK (cohort IN ('TREATMENT','HOLDOUT')),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ACCEPTED','CONTACTED','CONVERTED','DISMISSED','EXPIRED')),
  rfm_segment TEXT NOT NULL,
  recency_days INTEGER NOT NULL,
  frequency INTEGER NOT NULL,
  monetary NUMERIC(14,2) NOT NULL,
  expected_return_at DATE,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  recommended_channel TEXT,
  recommended_message_th TEXT NOT NULL,
  recommended_message_en TEXT NOT NULL,
  recommended_offer TEXT NOT NULL,
  recommended_product_sku TEXT,
  recommendation_reason_th TEXT NOT NULL,
  recommendation_reason_en TEXT NOT NULL,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  contacted_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  converted_order_id UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  converted_revenue NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, period_key)
);
CREATE INDEX IF NOT EXISTS idx_bms_retention_queue ON bms_retention_cases (tenant_id,status,risk_score DESC,monetary DESC);

ALTER TABLE bms_retention_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_retention_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_retention_cases_tenant_isolation ON bms_retention_cases;
CREATE POLICY bms_retention_cases_tenant_isolation ON bms_retention_cases
  USING (tenant_id=COALESCE(NULLIF(current_setting('bms.tenant_id',true),'')::uuid,tenant_id))
  WITH CHECK (tenant_id=COALESCE(NULLIF(current_setting('bms.tenant_id',true),'')::uuid,tenant_id));
GRANT SELECT,INSERT,UPDATE ON bms_retention_cases TO bms_app;

INSERT INTO bms_role_permissions (tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','retention.view'),('Manager','retention.manage'),('Sales','retention.view'),('Sales','retention.manage')) p(role_name,permission) ON p.role_name=r.name
ON CONFLICT (tenant_id,role_id,permission) DO NOTHING;
