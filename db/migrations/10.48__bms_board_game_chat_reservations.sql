-- 10.48 Chat booking requests reuse the staff-reviewed reservation aggregate.
-- ROLLBACK: only when NO source='CHAT' rows exist. Deploy the previous code first,
-- then restore kind_shape from 10.2 and public_shape/public_text_check from 10.1;
-- drop chat_shape/customer_fk, chat indexes and the three columns below.
-- Never delete customer requests merely to make a rollback possible.
BEGIN;
ALTER TABLE bms_board_game_waitlist
  ADD COLUMN IF NOT EXISTS customer_id UUID,
  ADD COLUMN IF NOT EXISTS chat_request_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS chat_request_hash TEXT;
ALTER TABLE bms_board_game_waitlist DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_customer_fk;
ALTER TABLE bms_board_game_waitlist ADD CONSTRAINT bms_board_game_waitlist_customer_fk
  FOREIGN KEY (tenant_id, customer_id) REFERENCES bms_customers(tenant_id, id) ON DELETE CASCADE;
-- A chat request cannot survive without its customer authority. Hard erasure cascades;
-- normal CRM soft deletion does not delete reservations. SET NULL would violate chat_shape.
ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_kind_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_kind_shape CHECK (
    (
      kind = 'WALK_IN'
      AND source = 'STAFF'
      AND created_by IS NOT NULL
      AND queue_no IS NOT NULL
      AND reserved_for IS NULL
      AND reserved_duration_minutes IS NULL
      AND reserved_table_id IS NULL
      AND confirmed_at IS NULL
      AND checked_in_at IS NULL
      AND status NOT IN ('REQUESTED', 'CONFIRMED', 'REJECTED', 'EXPIRED')
    )
    OR
    (
      kind = 'RESERVATION'
      AND reserved_for IS NOT NULL
      AND reserved_duration_minutes BETWEEN 30 AND 720
      AND ((queue_no IS NULL) = (checked_in_at IS NULL))
      AND (status NOT IN ('WAITING', 'CALLED') OR queue_no IS NOT NULL)
      AND (
        (status = 'REQUESTED' AND source IN ('PUBLIC', 'CHAT') AND reserved_table_id IS NULL
          AND confirmed_at IS NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('REJECTED', 'CANCELLED', 'EXPIRED') AND source IN ('PUBLIC', 'CHAT')
          AND reserved_table_id IS NULL AND confirmed_at IS NULL AND closed_at IS NOT NULL)
        OR
        (status = 'CONFIRMED' AND reserved_table_id IS NOT NULL
          AND confirmed_at IS NOT NULL AND queue_no IS NULL AND checked_in_at IS NULL)
        OR
        (status IN ('WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED')
          AND reserved_table_id IS NOT NULL AND confirmed_at IS NOT NULL)
      )
    )
  );
ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_public_text_check;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_public_text_check CHECK (
    source IN ('STAFF', 'PUBLIC', 'CHAT')
    AND (guest_email IS NULL OR length(btrim(guest_email)) BETWEEN 3 AND 254)
    AND (public_manage_token_hash IS NULL OR length(public_manage_token_hash) = 64)
    AND (public_request_key_hash IS NULL OR length(public_request_key_hash) = 64)
    AND (public_request_hash IS NULL OR length(public_request_hash) = 64)
    AND (rejection_reason IS NULL OR length(rejection_reason) <= 300)
    AND (reminder_minutes_before IS NULL OR reminder_minutes_before BETWEEN 30 AND 10080)
    AND reminder_status IN ('NONE', 'PENDING', 'SENDING', 'SENT', 'FAILED')
    AND reminder_attempts BETWEEN 0 AND 20
    AND (reminder_error IS NULL OR length(reminder_error) <= 500)
  );
ALTER TABLE bms_board_game_waitlist
  DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_public_shape;
ALTER TABLE bms_board_game_waitlist
  ADD CONSTRAINT bms_board_game_waitlist_public_shape CHECK (
    (source = 'STAFF' AND created_by IS NOT NULL
      AND public_manage_token_hash IS NULL AND public_request_key_hash IS NULL
      AND public_request_hash IS NULL)
    OR
    (source = 'PUBLIC' AND kind = 'RESERVATION' AND created_by IS NULL
      AND public_manage_token_hash IS NOT NULL AND public_request_key_hash IS NOT NULL
      AND public_request_hash IS NOT NULL
      AND guest_email IS NOT NULL)
    OR (source = 'CHAT' AND kind = 'RESERVATION' AND created_by IS NULL
      AND customer_id IS NOT NULL AND guest_email IS NULL
      AND public_manage_token_hash IS NULL AND public_request_key_hash IS NULL
      AND public_request_hash IS NULL)
  );
ALTER TABLE bms_board_game_waitlist DROP CONSTRAINT IF EXISTS bms_board_game_waitlist_chat_shape;
ALTER TABLE bms_board_game_waitlist ADD CONSTRAINT bms_board_game_waitlist_chat_shape CHECK (
  (source = 'CHAT' AND customer_id IS NOT NULL
    AND chat_request_key_hash IS NOT NULL AND length(chat_request_key_hash) = 64
    AND chat_request_hash IS NOT NULL AND length(chat_request_hash) = 64
    AND deposit_policy_snapshot = 'NONE' AND deposit_status = 'NOT_REQUIRED' AND deposit_amount = 0
    AND reminder_status = 'NONE' AND decision_notification_status = 'NONE')
  OR (source <> 'CHAT' AND customer_id IS NULL AND chat_request_key_hash IS NULL AND chat_request_hash IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_waitlist_chat_request
  ON bms_board_game_waitlist (tenant_id, chat_request_key_hash) WHERE source = 'CHAT';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_chat_customer
  ON bms_board_game_waitlist (tenant_id, customer_id, created_at DESC) WHERE source = 'CHAT';
COMMIT;
