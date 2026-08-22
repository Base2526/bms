-- =============================================================
-- 7.61  AI Pharmacy Intake Assistant — conversation link
-- -------------------------------------------------------------
-- Cheap per-conversation flag lib/bms/pipeline.ts checks every turn
-- (analogous to bms_conversations.ai_state), so a conversation currently
-- mid-intake branches into the dedicated pharmacy orchestrator BEFORE the
-- normal AI tool loop, instead of joining bms_pharmacy_assessments on
-- every single customer message.
-- =============================================================

ALTER TABLE bms_conversations
  ADD COLUMN IF NOT EXISTS pharmacy_intake_case_id UUID
    REFERENCES bms_pharmacy_assessments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_conv_pharmacy_intake
  ON bms_conversations(tenant_id, pharmacy_intake_case_id) WHERE pharmacy_intake_case_id IS NOT NULL;
