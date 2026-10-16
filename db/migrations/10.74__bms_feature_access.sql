-- Phase two: freeze legacy access once; future shops use package features.
-- Both ALTERs run atomically under the table lock. Concurrent tenant creation
-- lands either before (legacy) or after (version 2), never between defaults.
DO $$ BEGIN
  ALTER TABLE bms_tenants ADD COLUMN IF NOT EXISTS feature_policy_version SMALLINT
    NOT NULL DEFAULT 1 CHECK (feature_policy_version IN (1, 2));
  ALTER TABLE bms_tenants ALTER COLUMN feature_policy_version SET DEFAULT 2;
END $$;

COMMENT ON COLUMN bms_tenants.feature_policy_version IS
  '1 = permanent legacy access to REPORT_SCHEDULE and RETENTION_ENGINE only; 2 = package policy. Never recompute on migration rerun or plan change.';

-- No resources/jobs are changed. Existing subscriptions and retention cases
-- remain operational after downgrade. No new tenant table or grants required.
-- Deploy compatible application code first, then this migration. Before it,
-- missing version means legacy; database errors must still propagate.
-- ROLLBACK: revert application gates; leave this column and its default intact.
-- Never drop/recreate this column: that would re-grandfather new shops.
