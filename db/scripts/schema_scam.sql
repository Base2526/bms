-- =============================================
-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)
-- Output: db/schema_scam.sql
-- GeneratedAt: 2026-03-01T10:44:20.256402+00:00
-- Included migrations:
--  - 1.20__scam_phones_summary.sql
-- =============================================

BEGIN;

-- =====================================================
-- MIGRATION: 1.20__scam_phones_summary.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS scam_phones_summary (
  phone          text PRIMARY KEY,
  report_count   integer NOT NULL DEFAULT 0,
  last_report_at timestamptz,
  risk_level     integer NOT NULL DEFAULT 0,
  post_ids       uuid[] NOT NULL DEFAULT '{}',
  is_deleted     boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMIT;
