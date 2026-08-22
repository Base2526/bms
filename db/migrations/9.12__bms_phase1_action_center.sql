-- Phase 1: traceable daily actions and inventory-demand feedback.
CREATE TABLE IF NOT EXISTS bms_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('POS','STOCK','MARGIN','RETENTION','SALES','OPERATIONS')),
  priority TEXT NOT NULL CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  title TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_impact TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  deep_link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','ACCEPTED','COMPLETED','DISMISSED','EXPIRED')),
  status_reason TEXT,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  measured_outcome JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_key)
);

CREATE TABLE IF NOT EXISTS bms_action_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES bms_actions(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_inventory_policies (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  safety_stock_days INTEGER NOT NULL DEFAULT 7 CHECK (safety_stock_days BETWEEN 0 AND 90),
  lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days BETWEEN 0 AND 180),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_sku, size),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_inventory_demand_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('LOST_SALE','RESTOCK_REQUEST')),
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  source TEXT NOT NULL DEFAULT 'STAFF',
  note TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_actions_queue ON bms_actions (tenant_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS idx_bms_action_events_action ON bms_action_events (tenant_id, action_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bms_demand_events_variant ON bms_inventory_demand_events (tenant_id, product_sku, size, occurred_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_actions','bms_action_events','bms_inventory_policies','bms_inventory_demand_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
      USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
      WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON bms_actions, bms_action_events, bms_inventory_policies, bms_inventory_demand_events TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'action.manage' FROM bms_tenants t CROSS JOIN roles r
WHERE r.name IN ('Manager','Warehouse','Sales')
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
