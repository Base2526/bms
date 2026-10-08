-- Customer answer provenance, separate from security audit and human verdicts.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS bms_messages_evidence_owner ON bms_messages(tenant_id, conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS bms_messages_evidence_turn ON bms_messages(tenant_id, (meta->'aiEvidence'->>'turnId'))
  WHERE direction = 'OUT' AND meta->'aiEvidence'->>'turnId' IS NOT NULL;
CREATE TABLE IF NOT EXISTS bms_ai_turn_evidence (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  input_message_id BIGINT NOT NULL,
  output_message_id BIGINT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','FAILED','EXPIRED')),
  reasons JSONB NOT NULL DEFAULT '[]',
  attempted_calls INTEGER NOT NULL CHECK (attempted_calls >= 0),
  captured_calls INTEGER NOT NULL CHECK (captured_calls BETWEEN 0 AND 20),
  schema_version INTEGER NOT NULL,
  reply_hash TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  snapshot_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '180 days',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, output_message_id),
  FOREIGN KEY (tenant_id, conversation_id, input_message_id) REFERENCES bms_messages(tenant_id, conversation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id, output_message_id) REFERENCES bms_messages(tenant_id, conversation_id, id) ON DELETE CASCADE,
  CHECK (input_message_id <> output_message_id),
  CHECK (captured_calls <= attempted_calls),
  CHECK (jsonb_typeof(reasons) = 'array' AND octet_length(reasons::text) <= 4096)
);
CREATE INDEX IF NOT EXISTS bms_ai_turn_evidence_input ON bms_ai_turn_evidence(tenant_id, conversation_id, input_message_id);
CREATE INDEX IF NOT EXISTS bms_ai_turn_evidence_recent ON bms_ai_turn_evidence(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS bms_ai_turn_evidence_expiry ON bms_ai_turn_evidence(tenant_id, snapshot_expires_at);
CREATE TABLE IF NOT EXISTS bms_ai_tool_evidence (
  tenant_id UUID NOT NULL,
  turn_id UUID NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  call_id UUID NOT NULL,
  tool TEXT NOT NULL CHECK (length(tool) <= 80),
  source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  safe_input JSONB NOT NULL,
  safe_output JSONB NOT NULL,
  reasons JSONB NOT NULL,
  projection_version INTEGER NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  omissions JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, turn_id, sequence),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES bms_ai_turn_evidence(tenant_id, id) ON DELETE CASCADE,
  CHECK (octet_length(safe_input::text) <= 4096 AND octet_length(safe_output::text) <= 16384)
);
ALTER TABLE bms_ai_turn_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_turn_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_tool_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_ai_tool_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_ai_turn_evidence;
CREATE POLICY tenant_isolation ON bms_ai_turn_evidence USING
  (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS tenant_isolation ON bms_ai_tool_evidence;
CREATE POLICY tenant_isolation ON bms_ai_tool_evidence USING
  (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('bms.tenant_id', true), '')::uuid);
COMMENT ON TABLE bms_ai_turn_evidence IS 'Capture coverage, not factual accuracy or channel delivery. Exact source messages; no duplicate text.';
COMMENT ON TABLE bms_ai_tool_evidence IS 'Versioned allowlisted/redacted snapshots. Never raw args, clinical text, contacts, bank details or signed URLs.';
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_ai_turn_evidence, bms_ai_tool_evidence TO bms_app;
COMMIT;
