-- =============================================================
-- 7.41  Customer restock subscriptions + outbound attempt history
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_restock_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES bms_conversations(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('line','facebook','instagram')),
  customer_ref      TEXT NOT NULL,
  product_sku       TEXT NOT NULL,
  size              TEXT NOT NULL,
  requested_qty     INTEGER NOT NULL DEFAULT 1 CHECK (requested_qty > 0),
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','READY_TO_NOTIFY','NOTIFIED','PURCHASED','CANCELLED','EXPIRED')),
  source            TEXT NOT NULL DEFAULT 'AI_CHAT' CHECK (source IN ('AI_CHAT','ADMIN')),
  consented_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at          TIMESTAMPTZ,
  last_notified_at  TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bms_restock_subscriptions_product_fk
    FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CONSTRAINT bms_restock_subscriptions_identity_key
    UNIQUE (tenant_id, channel, customer_ref, product_sku, size)
);

CREATE TABLE IF NOT EXISTS bms_restock_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  subscription_id   UUID NOT NULL REFERENCES bms_restock_subscriptions(id) ON DELETE CASCADE,
  attempt_no        INTEGER NOT NULL CHECK (attempt_no > 0),
  channel           TEXT NOT NULL CHECK (channel IN ('line','facebook','instagram')),
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
  inbox_message_id  BIGINT REFERENCES bms_messages(id) ON DELETE SET NULL,
  error             TEXT,
  triggered_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, subscription_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_bms_restock_subscriptions_queue
  ON bms_restock_subscriptions (tenant_id, status, ready_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_restock_subscriptions_product
  ON bms_restock_subscriptions (tenant_id, product_sku, size, status);
CREATE INDEX IF NOT EXISTS idx_bms_restock_deliveries_subscription
  ON bms_restock_deliveries (tenant_id, subscription_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_restock_subscriptions','bms_restock_deliveries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_restock_subscriptions, bms_restock_deliveries TO bms_app;
