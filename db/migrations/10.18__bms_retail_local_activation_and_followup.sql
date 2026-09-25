-- =============================================================
-- 10.18  Retail Local activation, retry safety and trial follow-up
-- -------------------------------------------------------------
-- Activation is a one-time commercial bootstrap. Failure to redeem never
-- becomes a runtime entitlement check. Trial follow-ups are platform work
-- items only and never flow into POS, tax, backup, restore or data access.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_retail_local_license_bootstrap_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  token_hash  CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  issued_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_license_bootstrap_tokens_active
  ON bms_retail_local_license_bootstrap_tokens (token_hash, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE bms_retail_local_license_commercial_events
  ADD COLUMN IF NOT EXISTS operation_id UUID,
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bms_retail_local_license_commercial_events_details_object_check'
  ) THEN
    ALTER TABLE bms_retail_local_license_commercial_events
      ADD CONSTRAINT bms_retail_local_license_commercial_events_details_object_check
      CHECK (jsonb_typeof(details) = 'object');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_retail_local_license_commercial_events_operation
  ON bms_retail_local_license_commercial_events (license_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bms_retail_local_trial_followups (
  id                    BIGSERIAL PRIMARY KEY,
  license_id            UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  trial_expires_at      TIMESTAMPTZ NOT NULL,
  milestone_days        INTEGER NOT NULL CHECK (milestone_days IN (14, 7, 1, 0)),
  due_at                TIMESTAMPTZ NOT NULL,
  status                VARCHAR(24) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'ACKNOWLEDGED', 'CANCELLED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledgement_note  VARCHAR(500),
  UNIQUE (license_id, trial_expires_at, milestone_days),
  CHECK (
    (status = 'ACKNOWLEDGED' AND acknowledged_at IS NOT NULL AND acknowledgement_note IS NOT NULL)
    OR (status <> 'ACKNOWLEDGED' AND acknowledged_at IS NULL AND acknowledged_by IS NULL
        AND acknowledgement_note IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_trial_followups_due
  ON bms_retail_local_trial_followups (due_at, license_id)
  WHERE status = 'PENDING';

INSERT INTO bms_retail_local_trial_followups
  (license_id, trial_expires_at, milestone_days, due_at)
SELECT l.id, l.trial_expires_at, milestone.days,
       l.trial_expires_at - (milestone.days * interval '1 day')
FROM bms_retail_local_licenses l
CROSS JOIN (VALUES (14), (7), (1), (0)) AS milestone(days)
WHERE l.license_type = 'TRIAL' AND l.trial_expires_at IS NOT NULL
ON CONFLICT (license_id, trial_expires_at, milestone_days) DO NOTHING;

REVOKE ALL ON bms_retail_local_license_bootstrap_tokens,
  bms_retail_local_trial_followups FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON bms_retail_local_license_bootstrap_tokens,
  bms_retail_local_trial_followups TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_retail_local_trial_followups_id_seq TO bms_app;

COMMENT ON TABLE bms_retail_local_license_bootstrap_tokens IS
  'One-time installer activation exchange. Expiry or redemption failure never disables an installed shop.';
COMMENT ON COLUMN bms_retail_local_license_commercial_events.operation_id IS
  'Caller idempotency key; one commercial mutation result per license and operation.';
COMMENT ON TABLE bms_retail_local_trial_followups IS
  'Platform commercial work queue only; never an entitlement, receipt or tax-document input.';

COMMIT;
