-- =============================================================
-- 7.31  BMS AI quality — sampled review queue
-- -------------------------------------------------------------
-- Keep only review metadata and references to the existing Inbox messages.
-- Raw customer/AI text remains in bms_messages under its existing retention.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_ai_quality_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  message_id        BIGINT NOT NULL REFERENCES bms_messages(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('AUTO_FAILURE', 'AUTO_SAMPLE', 'MANUAL')),
  signal_outcome    TEXT NOT NULL
                      CHECK (signal_outcome IN ('SUCCESS', 'CLARIFICATION', 'HANDOFF', 'UNRESOLVED', 'FAILURE')),
  reason_codes      TEXT[] NOT NULL DEFAULT '{}',
  severity          TEXT NOT NULL DEFAULT 'LOW'
                      CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'REVIEWED', 'DISMISSED')),
  verdict           TEXT CHECK (verdict IN ('PASS', 'FAIL', 'UNCLEAR')),
  category          TEXT CHECK (category IN (
                      'CORRECT', 'HALLUCINATION', 'WRONG_TOOL', 'TOOL_ERROR',
                      'MISUNDERSTOOD', 'BAD_HANDOFF', 'POLICY', 'TONE', 'OTHER'
                    )),
  reviewer_note     TEXT,
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_bms_ai_quality_queue
  ON bms_ai_quality_reviews(tenant_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_ai_quality_conversation
  ON bms_ai_quality_reviews(tenant_id, conversation_id, created_at DESC);

ALTER TABLE bms_ai_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_quality_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_ai_quality_reviews_tenant_isolation ON bms_ai_quality_reviews;
CREATE POLICY bms_ai_quality_reviews_tenant_isolation ON bms_ai_quality_reviews
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_quality_reviews TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- Managers can inspect and review AI quality by default. Administrator remains
-- a super role in application code and receives every catalog permission.
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
  FROM bms_tenants t
  JOIN roles r ON r.name = 'Manager'
 CROSS JOIN (VALUES ('ai_quality.view'), ('ai_quality.review')) AS p(permission)
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
