-- Call Block + Spam Detection System (additive, minimal-risk)
-- Adds tables requested by spec without breaking existing ones.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) user_blocked_numbers
-- Canonical per-user block list (normalized_number)
CREATE TABLE IF NOT EXISTS public.user_blocked_numbers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  normalized_number text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, normalized_number)
);

CREATE INDEX IF NOT EXISTS idx_user_blocked_numbers_user
  ON public.user_blocked_numbers (user_id);

CREATE INDEX IF NOT EXISTS idx_user_blocked_numbers_norm
  ON public.user_blocked_numbers (normalized_number);


-- 2) community_spam_reports
-- Append-only community signal (normalized_number)
CREATE TABLE IF NOT EXISTS public.community_spam_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_number text NOT NULL,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_spam_reports_norm
  ON public.community_spam_reports (normalized_number);

CREATE INDEX IF NOT EXISTS idx_community_spam_reports_user_time
  ON public.community_spam_reports (user_id, created_at DESC);


-- 3) call_history_logs
-- Per-user audit trail of what the runtime did / warned.
CREATE TABLE IF NOT EXISTS public.call_history_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  normalized_number text NOT NULL,

  type              text NOT NULL,   -- 'call' | 'sms'
  source            text NOT NULL,   -- 'self' | 'community' | 'unknown'
  action            text NOT NULL,   -- 'blocked_call' | 'spam_warning' | 'allowed'
  matched_by        text,            -- optional: 'local_db' | 'server_sync' | etc

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_history_logs_user_time
  ON public.call_history_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_history_logs_norm
  ON public.call_history_logs (normalized_number);
