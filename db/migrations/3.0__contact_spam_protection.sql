CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_contact_spam_settings (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'PROMPT',
  risk_threshold integer NOT NULL DEFAULT 75,
  sync_enabled boolean NOT NULL DEFAULT true,
  auto_mark_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_contact_spam_settings_mode_check
    CHECK (mode IN ('OFF', 'PROMPT', 'AUTO')),
  CONSTRAINT user_contact_spam_settings_threshold_check
    CHECK (risk_threshold >= 0 AND risk_threshold <= 100)
);

CREATE TABLE IF NOT EXISTS public.user_contact_spam_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_normalized text NOT NULL,
  contact_name text,
  source text NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  CONSTRAINT user_contact_spam_marks_source_check
    CHECK (source IN ('MANUAL', 'SUGGESTED', 'AUTO')),
  CONSTRAINT user_contact_spam_marks_unique_phone
    UNIQUE (user_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS idx_user_contact_spam_marks_user_active
  ON public.user_contact_spam_marks (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_contact_spam_marks_phone
  ON public.user_contact_spam_marks (phone_normalized);