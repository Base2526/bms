-- =============================================================
-- 7.45  Support ticket internal comments
-- =============================================================

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_email TEXT,
  from_status TEXT,
  to_status TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket_created
ON support_ticket_comments(ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_at
ON support_tickets(updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON support_tickets TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_ticket_comments TO bms_app;
