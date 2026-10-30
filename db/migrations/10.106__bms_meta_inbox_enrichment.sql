-- 10.106 — Preserve bounded Meta Messenger context needed by the BMS Inbox.
--
-- This is deliberately provider metadata, not customer CRM authority. It stores only
-- reply/quick-reply/referral identifiers selected by the verified webhook parser.

ALTER TABLE bms_channel_inbound_jobs
  ADD COLUMN IF NOT EXISTS event_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bms_channel_inbound_jobs.event_meta IS
  'Bounded provider context (reply target, quick reply, referral); never raw webhook payload or CRM PII.';

-- ROLLBACK (only after deploying an application that no longer reads event_meta):
-- ALTER TABLE bms_channel_inbound_jobs DROP COLUMN event_meta;
