-- =============================================================
-- 7.30  BMS AI context strategy completion
-- -------------------------------------------------------------
-- Tenant AI policy, durable conversation state, inbound webhook
-- idempotency, and human-approved synonym discovery.
-- =============================================================

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS ai_language TEXT NOT NULL DEFAULT 'th',
  ADD COLUMN IF NOT EXISTS ai_ordering_style TEXT NOT NULL DEFAULT 'catalog_variant',
  ADD COLUMN IF NOT EXISTS ai_required_fields TEXT[] NOT NULL DEFAULT ARRAY['product','size','qty']::TEXT[],
  ADD COLUMN IF NOT EXISTS ai_interpret_short_replies BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_handoff_after_failed_turns INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_store_profile_ai_handoff_after_failed_turns_check'
  ) THEN
    ALTER TABLE bms_store_profile
      ADD CONSTRAINT bms_store_profile_ai_handoff_after_failed_turns_check
      CHECK (ai_handoff_after_failed_turns BETWEEN 1 AND 10);
  END IF;
END $$;

ALTER TABLE bms_conversations
  ADD COLUMN IF NOT EXISTS ai_state JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS bms_inbound_events (
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_bms_inbound_events_created
  ON bms_inbound_events(created_at);

CREATE TABLE IF NOT EXISTS bms_ai_synonym_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  normalized_term TEXT NOT NULL,
  display_term    TEXT NOT NULL,
  occurrences     INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  product_sku     TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, normalized_term)
);

CREATE INDEX IF NOT EXISTS idx_bms_ai_synonym_candidates_review
  ON bms_ai_synonym_candidates(tenant_id, status, occurrences DESC, last_seen_at DESC);

ALTER TABLE bms_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_inbound_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_inbound_events_tenant_isolation ON bms_inbound_events;
CREATE POLICY bms_inbound_events_tenant_isolation ON bms_inbound_events
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_ai_synonym_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_synonym_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_ai_synonym_candidates_tenant_isolation ON bms_ai_synonym_candidates;
CREATE POLICY bms_ai_synonym_candidates_tenant_isolation ON bms_ai_synonym_candidates
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_inbound_events TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_synonym_candidates TO bms_app;
