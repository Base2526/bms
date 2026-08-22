-- =============================================================
-- 7.52  BMS Follow-up Automation — MVP core
-- -------------------------------------------------------------
-- Conversation follow-up fields + intent log + configurable Rule Engine +
-- scheduler job/history tables. NOT the full spec: no Workflow Engine
-- (workflow_templates/_instances/_steps) and no Follow-up Scoring model in
-- this pass — see CLAUDE.local.md § Follow-up Automation "Deferred" for why.
--
-- bms_conversations.last_sender_type — genuinely missing today (only
--   last_message/last_message_at existed). Set by lib/bms/inbox.ts's
--   logConversation() ('customer'/'ai') and sendStaffMessage() ('staff'),
--   plus the new followups scheduler ('ai'). Cheap indexed signal for
--   "did the customer/staff reply since we scheduled this" without joining
--   bms_messages on every scheduler poll.
-- bms_customers.followup_opt_out — customer-level (not conversation-level)
--   because opt-out should persist across channels/conversations.
-- bms_conversation_intents — append-only (like bms_audit_log), one row per
--   classification run, not overwritten — keeps history.
-- bms_followup_rules — the configurable engine; scheduler never hardcodes
--   delay/goal/retry, it only reads this table.
-- bms_followup_jobs — one row per (conversation, rule) in flight; UNIQUE
--   partial index prevents double-scheduling the same rule on a conversation.
-- bms_followup_history — append-only send/skip/fail log (same pattern as
--   bms_audit_log/bms_report_deliveries); the admin Queue page's data source.
-- =============================================================

ALTER TABLE bms_conversations
  ADD COLUMN IF NOT EXISTS last_sender_type TEXT
    CHECK (last_sender_type IN ('customer', 'staff', 'ai'));

ALTER TABLE bms_customers
  ADD COLUMN IF NOT EXISTS followup_opt_out BOOLEAN NOT NULL DEFAULT false;

-- ---- intent log ----
CREATE TABLE IF NOT EXISTS bms_conversation_intents (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  intent          TEXT NOT NULL CHECK (intent IN (
                    'ASK_PRICE', 'PRODUCT_INFORMATION', 'ORDER', 'BOOKING', 'SUPPORT',
                    'COMPLAINT', 'PAYMENT', 'DELIVERY', 'GENERAL_QUESTION', 'OTHER'
                  )),
  confidence      NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source          TEXT NOT NULL CHECK (source IN ('ai', 'heuristic')),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_conv_intents_conv ON bms_conversation_intents(conversation_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_conv_intents_tenant ON bms_conversation_intents(tenant_id);

-- ---- rule engine (config, no hardcoded logic) ----
CREATE TABLE IF NOT EXISTS bms_followup_rules (
  id                  UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  intent              TEXT NOT NULL CHECK (intent IN (
                        'ASK_PRICE', 'PRODUCT_INFORMATION', 'ORDER', 'BOOKING', 'SUPPORT',
                        'COMPLAINT', 'PAYMENT', 'DELIVERY', 'GENERAL_QUESTION', 'OTHER'
                      )),
  enabled             BOOLEAN NOT NULL DEFAULT true,
  priority            INTEGER NOT NULL DEFAULT 0,
  delay_minutes       INTEGER NOT NULL CHECK (delay_minutes > 0),
  max_retry           INTEGER NOT NULL DEFAULT 1 CHECK (max_retry >= 0),
  -- validated against a fixed allowed set at the service layer (lib/bms/followups.ts),
  -- not a per-element CHECK — same convention as bms_store_profile.enabled_carriers
  stop_conditions     TEXT[] NOT NULL DEFAULT '{}',
  message_goal        TEXT NOT NULL CHECK (message_goal IN (
                        'CLOSE_SALE', 'COLLECT_MISSING_INFO', 'CONTINUE_CONVERSATION', 'CONFIRM_BOOKING',
                        'CUSTOMER_SATISFACTION', 'PAYMENT_REMINDER', 'RECOVER_ABANDONED_CART', 'SUPPORT_FOLLOWUP'
                      )),
  business_hours_only BOOLEAN NOT NULL DEFAULT false,
  template            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_followup_rules_tenant_intent ON bms_followup_rules(tenant_id, intent) WHERE enabled;

-- ---- scheduler jobs (one per conversation+rule in flight) ----
CREATE TABLE IF NOT EXISTS bms_followup_jobs (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES bms_followup_rules(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'STOPPED', 'FAILED')),
  next_run_at     TIMESTAMPTZ NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_result     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one active (PENDING) job per conversation+rule — never double-schedule the same rule
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_followup_jobs_pending
  ON bms_followup_jobs(conversation_id, rule_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bms_followup_jobs_due ON bms_followup_jobs(next_run_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bms_followup_jobs_tenant ON bms_followup_jobs(tenant_id);

-- ---- append-only send/skip/fail history ----
CREATE TABLE IF NOT EXISTS bms_followup_history (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  job_id          UUID REFERENCES bms_followup_jobs(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  rule_id         UUID REFERENCES bms_followup_rules(id) ON DELETE SET NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('SENT', 'SKIPPED', 'FAILED')),
  reason          TEXT,
  message_body    TEXT,
  goal            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bms_followup_history_conv ON bms_followup_history(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_followup_history_tenant ON bms_followup_history(tenant_id, created_at DESC);

-- ---- RLS (เหมือน 6.1) ----
ALTER TABLE bms_conversation_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_conversation_intents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_conversation_intents_tenant_isolation ON bms_conversation_intents;
CREATE POLICY bms_conversation_intents_tenant_isolation ON bms_conversation_intents
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_followup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_followup_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_followup_rules_tenant_isolation ON bms_followup_rules;
CREATE POLICY bms_followup_rules_tenant_isolation ON bms_followup_rules
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_followup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_followup_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_followup_jobs_tenant_isolation ON bms_followup_jobs;
CREATE POLICY bms_followup_jobs_tenant_isolation ON bms_followup_jobs
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_followup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_followup_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_followup_history_tenant_isolation ON bms_followup_history;
CREATE POLICY bms_followup_history_tenant_isolation ON bms_followup_history
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_conversation_intents TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_followup_rules TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_followup_jobs TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_followup_history TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permissions: followup.view (Sales+Manager), followup.manage (Manager) ----
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'followup.view'),
  ('Manager', 'followup.manage'),
  ('Sales', 'followup.view')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
