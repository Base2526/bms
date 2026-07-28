-- =============================================================
-- 7.32  BMS AI quality — query and foreign-key indexes
-- -------------------------------------------------------------
-- Keep tenant/date scans bounded, support the actual severity
-- ordering used by the review queue, and avoid full child-table
-- scans when Inbox rows are deleted through ON DELETE CASCADE.
-- =============================================================

-- message_id is globally unique in bms_messages, so one review per message is
-- the stronger invariant. It also gives the message FK an efficient cascade
-- lookup; PostgreSQL does not index referencing FK columns automatically.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_ai_quality_message
  ON bms_ai_quality_reviews(message_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'bms_ai_quality_reviews'::regclass
       AND conname = 'bms_ai_quality_reviews_tenant_id_message_id_key'
  ) THEN
    ALTER TABLE bms_ai_quality_reviews
      DROP CONSTRAINT bms_ai_quality_reviews_tenant_id_message_id_key;
  END IF;
END $$;

-- Used by retention cleanup, date-bounded metrics, and unfiltered queue lists.
CREATE INDEX IF NOT EXISTS idx_bms_ai_quality_tenant_created
  ON bms_ai_quality_reviews(tenant_id, created_at DESC);

-- The FK cascade from bms_conversations searches by conversation_id alone, so
-- the tenant-leading review-list index cannot serve that lookup.
CREATE INDEX IF NOT EXISTS idx_bms_ai_quality_conversation_fk
  ON bms_ai_quality_reviews(conversation_id);

-- Match the queue's HIGH -> MEDIUM -> LOW expression ordering. status remains
-- before the expression because the normal operator workflow filters by it.
CREATE INDEX IF NOT EXISTS idx_bms_ai_quality_queue_ranked
  ON bms_ai_quality_reviews(
    tenant_id,
    status,
    (CASE severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END),
    created_at DESC
  );
DROP INDEX IF EXISTS idx_bms_ai_quality_queue;

-- Metrics read only AI-authored messages that carry the bounded quality label.
-- The partial predicate keeps this index much smaller than a full meta index.
CREATE INDEX IF NOT EXISTS idx_bms_messages_ai_quality_metrics
  ON bms_messages(tenant_id, created_at DESC)
  WHERE sender = 'ai' AND meta ? 'aiQuality';

-- Supports the lateral lookup for the latest inbound customer message before
-- an AI response without indexing unrelated outbound/system messages.
CREATE INDEX IF NOT EXISTS idx_bms_messages_latest_inbound
  ON bms_messages(conversation_id, created_at DESC, id DESC)
  WHERE direction = 'IN';
