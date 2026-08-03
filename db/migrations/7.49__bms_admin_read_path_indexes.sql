-- =============================================================
-- 7.49  BMS admin read-path indexes
-- =============================================================
-- These indexes target always-visible admin shell badges and dashboard
-- summaries. They keep local/dev data sets responsive as fake seed volume
-- grows, without changing any application behavior.

CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant_created_at
ON bms_orders(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant_status_created_at
ON bms_orders(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant_status_updated_at
ON bms_orders(tenant_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_bms_payments_tenant_status_created_at
ON bms_payments(tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_bms_order_items_tenant_sku_order
ON bms_order_items(tenant_id, product_sku, order_id);

CREATE INDEX IF NOT EXISTS idx_bms_order_items_tenant_order
ON bms_order_items(tenant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_bms_conversations_unread_status
ON bms_conversations(tenant_id, status, assigned_to_user_id)
WHERE unread > 0;

CREATE INDEX IF NOT EXISTS idx_bms_conversations_waiting_unread
ON bms_conversations(tenant_id, last_message_at)
WHERE unread > 0 AND status <> 'CLOSED';

CREATE INDEX IF NOT EXISTS idx_bms_audit_log_ai_tool_recent
ON bms_audit_log(tenant_id, created_at DESC)
WHERE action = 'ai.tool_call';

CREATE INDEX IF NOT EXISTS idx_bms_conversation_notes_ai_recent
ON bms_conversation_notes(tenant_id, created_at DESC)
WHERE author = 'AI';
