-- =============================================================
-- 7.60  AI Pharmacy Intake Assistant — clinical event trail
-- -------------------------------------------------------------
-- bms_audit_log (actor/action/target) stays the actor/action-of-record
-- trail for pharmacy mutations too (same convention as inbox.assign,
-- ai.tool_call, followup.sent). This table is IN ADDITION to that, not a
-- replacement: it's a queryable previous_state/next_state event stream
-- specific to a case, which bms_audit_log's single unstructured `meta`
-- blob doesn't model and other modules already query bms_audit_log by
-- `action LIKE 'order.%'`-style prefix — mixing 10+ pharmacy event kinds
-- in there would pollute it.
--
-- Both tables are always written together from lib/bms/pharmacy/events.ts's
-- recordPharmacyEvent(), never independently. `meta` must be data-minimized
-- (never raw_messages/structured_answers/medical_info/complaint/ai_summary)
-- — enforced in code by minimizeForAudit(), not by this schema.
--
-- Append-only, like bms_audit_log/bms_followup_history — no DELETE grant.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pharmacy_assessment_events (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  assessment_id  UUID NOT NULL REFERENCES bms_pharmacy_assessments(id) ON DELETE CASCADE,
  actor          TEXT NOT NULL, -- email/id/"system"/"ai:<model_version>" — never health data
  action         TEXT NOT NULL, -- fixed vocabulary, see lib/bms/pharmacy/events.ts
  previous_state TEXT,
  next_state     TEXT,
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_pharm_events_assessment
  ON bms_pharmacy_assessment_events(assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_pharm_events_tenant
  ON bms_pharmacy_assessment_events(tenant_id, created_at DESC);

ALTER TABLE bms_pharmacy_assessment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_assessment_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_assessment_events_tenant_isolation ON bms_pharmacy_assessment_events;
CREATE POLICY bms_pharmacy_assessment_events_tenant_isolation ON bms_pharmacy_assessment_events
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT ON bms_pharmacy_assessment_events TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
