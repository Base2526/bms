-- =============================================================
-- 10.17  Retail Local 30-day trial lifecycle
-- -------------------------------------------------------------
-- Commercial state is deliberately separate from evidence review state.
-- Trial expiry is a back-office follow-up signal and must never become a
-- runtime lease, remote kill switch, or transaction/data-access guard.
-- =============================================================

BEGIN;

ALTER TABLE bms_retail_local_licenses
  ADD COLUMN IF NOT EXISTS license_type VARCHAR(16) NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS commercial_status VARCHAR(24) NOT NULL DEFAULT 'PAID_ACTIVE',
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commercial_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS commercial_updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_retail_local_licenses_license_type_check'
  ) THEN
    ALTER TABLE bms_retail_local_licenses
      ADD CONSTRAINT bms_retail_local_licenses_license_type_check
      CHECK (license_type IN ('TRIAL', 'PAID'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_retail_local_licenses_commercial_status_check'
  ) THEN
    ALTER TABLE bms_retail_local_licenses
      ADD CONSTRAINT bms_retail_local_licenses_commercial_status_check
      CHECK (commercial_status IN ('TRIAL_ACTIVE', 'PAID_ACTIVE', 'PAYMENT_REVIEW', 'CANCELLED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_retail_local_licenses_trial_window_check'
  ) THEN
    ALTER TABLE bms_retail_local_licenses
      ADD CONSTRAINT bms_retail_local_licenses_trial_window_check
      CHECK (
        license_type = 'PAID'
        OR (trial_started_at IS NOT NULL AND trial_expires_at IS NOT NULL AND trial_expires_at > trial_started_at)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_retail_local_licenses_commercial_type_check'
  ) THEN
    ALTER TABLE bms_retail_local_licenses
      ADD CONSTRAINT bms_retail_local_licenses_commercial_type_check
      CHECK (
        (commercial_status = 'TRIAL_ACTIVE' AND license_type = 'TRIAL')
        OR (commercial_status = 'PAID_ACTIVE' AND license_type = 'PAID')
        OR commercial_status IN ('PAYMENT_REVIEW', 'CANCELLED')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_licenses_trial_followup
  ON bms_retail_local_licenses (trial_expires_at)
  WHERE license_type = 'TRIAL' AND commercial_status IN ('TRIAL_ACTIVE', 'PAYMENT_REVIEW');

CREATE TABLE IF NOT EXISTS bms_retail_local_license_commercial_events (
  id              BIGSERIAL PRIMARY KEY,
  license_id      UUID NOT NULL REFERENCES bms_retail_local_licenses(id) ON DELETE RESTRICT,
  action          VARCHAR(32) NOT NULL
                    CHECK (action IN (
                      'TRIAL_CREATED', 'PAID_CREATED', 'MIGRATED_AS_PAID',
                      'CONVERT_TO_PAID', 'EXTEND_TRIAL', 'MARK_PAYMENT_REVIEW',
                      'REACTIVATE', 'CANCEL'
                    )),
  previous_status VARCHAR(24),
  next_status     VARCHAR(24) NOT NULL
                    CHECK (next_status IN (
                      'TRIAL_ACTIVE', 'TRIAL_EXPIRING', 'TRIAL_EXPIRED',
                      'PAID_ACTIVE', 'PAYMENT_REVIEW', 'CANCELLED'
                    )),
  reason          VARCHAR(500) NOT NULL,
  actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_license_commercial_events_timeline
  ON bms_retail_local_license_commercial_events (license_id, occurred_at DESC, id DESC);

INSERT INTO bms_retail_local_license_commercial_events
  (license_id, action, previous_status, next_status, reason)
SELECT l.id, 'MIGRATED_AS_PAID', NULL, 'PAID_ACTIVE',
       'Existing license migrated into the explicit commercial lifecycle'
FROM bms_retail_local_licenses l
WHERE NOT EXISTS (
  SELECT 1 FROM bms_retail_local_license_commercial_events e WHERE e.license_id = l.id
);

REVOKE ALL ON bms_retail_local_license_commercial_events FROM PUBLIC;
GRANT SELECT, INSERT ON bms_retail_local_license_commercial_events TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_retail_local_license_commercial_events_id_seq TO bms_app;

COMMENT ON COLUMN bms_retail_local_licenses.commercial_status IS
  'Commercial follow-up state only; never an entitlement check on an installed shop.';
COMMENT ON COLUMN bms_retail_local_licenses.trial_expires_at IS
  'Authoritative control-plane trial deadline; expiry never disables local business operations.';
COMMENT ON TABLE bms_retail_local_license_commercial_events IS
  'Append-only audit of human commercial actions; never consumed by POS, payment, stock, backup, restore, or data access.';

COMMIT;
