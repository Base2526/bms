-- =============================================================
-- 7.51  BMS Inbox read-path indexes
-- =============================================================
-- Target /admin/inbox list/detail reads and text search as seeded message
-- volume grows. These indexes do not change application behavior.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_bms_conversations_tenant_status_recent
ON bms_conversations(tenant_id, status, last_message_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_conversations_tenant_recent
ON bms_conversations(tenant_id, last_message_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_messages_tenant_conversation_recent
ON bms_messages(tenant_id, conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_bms_audit_log_inbox_events_recent
ON bms_audit_log(tenant_id, target, created_at DESC)
WHERE action IN ('inbox.assign', 'inbox.helper_add', 'inbox.helper_remove', 'inbox.status');

CREATE INDEX IF NOT EXISTS idx_bms_conversations_last_message_trgm
ON bms_conversations USING GIN (last_message gin_trgm_ops)
WHERE last_message IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_conversations_customer_ref_trgm
ON bms_conversations USING GIN (customer_ref gin_trgm_ops)
WHERE customer_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_messages_body_trgm
ON bms_messages USING GIN (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bms_customers_name_trgm
ON bms_customers USING GIN (name gin_trgm_ops)
WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_customer_identities_display_name_trgm
ON bms_customer_identities USING GIN (display_name gin_trgm_ops)
WHERE display_name IS NOT NULL;
