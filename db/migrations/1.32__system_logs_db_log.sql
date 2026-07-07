-- Ensure system logs table exists for DB_LOG persistence.
--
-- Note: This migration is written to be non-breaking for existing installs.
-- If you already have `public.system_logs` (e.g. legacy BIGSERIAL id), this will NOT attempt to change types.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'system_logs'
  ) THEN
    CREATE TABLE public.system_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      level text NOT NULL,
      category text NOT NULL,
      message text NOT NULL,
      meta jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_system_logs_created_at
ON public.system_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_logs_category
ON public.system_logs (category);

CREATE INDEX IF NOT EXISTS idx_system_logs_level
ON public.system_logs (level);
