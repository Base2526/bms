-- =============================================================
-- 7.59  AI Pharmacy Intake Assistant — assessments (core entity)
-- -------------------------------------------------------------
-- One row per intake case. AI never writes `status` here — see
-- lib/bms/pharmacy/assessments.ts: the ONLY function in the codebase that
-- writes status='APPROVED' is approveAssessment(), which additionally
-- checks users.is_licensed_pharmacist unconditionally (no Administrator
-- super-role shortcut).
--
-- "unknown must never collapse to false/no" is enforced at the schema
-- level for every clinically load-bearing yes/no field: tri-state
-- TEXT CHECK (...IN ('YES','NO','UNKNOWN')), never BOOLEAN. The same
-- convention is used for tri-state leaves inside the complaint/medical_info
-- JSONB blobs (validated at the service layer, not by SQL, because
-- protocols define their own field sets and a rigid relational schema
-- would need a migration every time a protocol adds a field).
--
-- No ai_reasoning/chain-of-thought column exists anywhere in this table —
-- only structured ai_summary/ai_summary_version/ai_prompt_version/
-- ai_model_version. This is a mechanical guarantee, not a convention.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pharmacy_assessments (
  id                     UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id            UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  channel_id             TEXT,
  conversation_id        UUID REFERENCES bms_conversations(id) ON DELETE SET NULL,
  protocol_id            UUID REFERENCES bms_pharmacy_protocols(id),

  -- ---- consent ----
  patient_relationship   TEXT NOT NULL DEFAULT 'SELF'
                            CHECK (patient_relationship IN ('SELF', 'CHILD', 'PARENT', 'OTHER')),
  consent_status         TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (consent_status IN ('PENDING', 'GRANTED', 'REVOKED')),
  consent_at             TIMESTAMPTZ,
  consent_version        TEXT,

  -- ---- state machine (see lib/bms/pharmacy/stateMachine.ts for the transition matrix) ----
  status                 TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                            'DRAFT', 'COLLECTING_INFORMATION', 'WAITING_FOR_PHARMACIST',
                            'PHARMACIST_REVIEWING', 'NEED_MORE_INFORMATION', 'APPROVED',
                            'REJECTED', 'REFER_TO_DOCTOR', 'EMERGENCY_REFERRAL', 'CLOSED'
                          )),
  needs_manual_intake    BOOLEAN NOT NULL DEFAULT FALSE, -- AI unavailable at least once during intake — pharmacist queue flags this
  risk_level             TEXT NOT NULL DEFAULT 'UNKNOWN'
                            CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH', 'EMERGENCY', 'UNKNOWN')),
  assigned_pharmacist_id UUID REFERENCES users(id),
  approved_by            UUID REFERENCES users(id),
  approved_at            TIMESTAMPTZ,
  decision_reason        TEXT,

  -- ---- patient information ----
  patient_dob            DATE,
  patient_age_years      INTEGER,
  biological_sex         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (biological_sex IN ('MALE', 'FEMALE', 'UNKNOWN')),
  weight_kg              NUMERIC(6, 2),
  height_cm              NUMERIC(6, 2),
  pregnancy_status       TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (pregnancy_status IN ('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE')),
  breastfeeding_status   TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (breastfeeding_status IN ('YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE')),

  -- ---- complaint / medical / safety (see lib/bms/pharmacy/assessments.ts for the validated shape) ----
  complaint               JSONB NOT NULL DEFAULT '{}',
  medical_info            JSONB NOT NULL DEFAULT '{}',
  current_question_key    TEXT,
  missing_fields          TEXT[] NOT NULL DEFAULT '{}',
  conflicting_fields      TEXT[] NOT NULL DEFAULT '{}',
  detected_red_flags      JSONB NOT NULL DEFAULT '[]',
  out_of_scope_reason     TEXT,
  escalation_reason       TEXT,

  -- ---- conversation / AI contract (structured only — no reasoning/chain-of-thought) ----
  raw_messages             JSONB NOT NULL DEFAULT '[]',
  structured_answers       JSONB NOT NULL DEFAULT '{}',
  ai_summary               TEXT,
  ai_summary_version       INTEGER NOT NULL DEFAULT 0,
  ai_prompt_version        TEXT,
  ai_model_version         TEXT,
  pharmacist_edits         JSONB NOT NULL DEFAULT '[]',
  pharmacist_decision_notes TEXT,

  version                INTEGER NOT NULL DEFAULT 1, -- optimistic lock (defense in depth on top of FOR UPDATE)
  expires_at             TIMESTAMPTZ,
  closed_at              TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ, -- soft delete, same convention as bms_messages/bms_customer_addresses etc.
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_tenant ON bms_pharmacy_assessments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_status ON bms_pharmacy_assessments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_risk ON bms_pharmacy_assessments(tenant_id, risk_level);
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_assigned
  ON bms_pharmacy_assessments(tenant_id, assigned_pharmacist_id) WHERE assigned_pharmacist_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_created ON bms_pharmacy_assessments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_conversation
  ON bms_pharmacy_assessments(tenant_id, conversation_id) WHERE conversation_id IS NOT NULL;
-- lazy-expiry sweep target — only rows that are still "open" and not soft-deleted
CREATE INDEX IF NOT EXISTS idx_bms_pharm_assess_expiring
  ON bms_pharmacy_assessments(expires_at)
  WHERE status NOT IN ('APPROVED', 'REJECTED', 'REFER_TO_DOCTOR', 'EMERGENCY_REFERRAL', 'CLOSED')
    AND deleted_at IS NULL;

-- idempotency backstop: at most one *active* case per conversation, even if the
-- app-level lock in createAssessmentOnce() is somehow bypassed
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pharm_assess_active_per_conversation
  ON bms_pharmacy_assessments(tenant_id, conversation_id)
  WHERE conversation_id IS NOT NULL
    AND status NOT IN ('CLOSED', 'REJECTED')
    AND deleted_at IS NULL;

ALTER TABLE bms_pharmacy_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_assessments_tenant_isolation ON bms_pharmacy_assessments;
CREATE POLICY bms_pharmacy_assessments_tenant_isolation ON bms_pharmacy_assessments
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pharmacy_assessments TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
