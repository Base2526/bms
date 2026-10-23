-- =============================================================
-- 10.89  Board-game profit and table-utilization evidence
-- -------------------------------------------------------------
-- A seating only remembers its current table. Moving it therefore destroys
-- the historical table/time split required by a utilization report. This
-- append-oriented ledger records each physical-table interval in the same
-- transaction as the seating change. Existing seatings are explicitly marked
-- as backfill because moves that happened before this migration cannot be
-- reconstructed truthfully.
--
-- The public-profile `opening_hours` field remains display prose. Effective-
-- dated structured hours below are the only denominator used by analytics.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_table_occupancy (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  table_id    UUID NOT NULL,
  seating_id  UUID NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  end_reason  TEXT CHECK (end_reason IN ('CLOSED','MOVED','MERGED_INTO','CANCELLED','BACKFILL')),
  backfilled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, table_id)
    REFERENCES bms_board_game_tables(tenant_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, seating_id)
    REFERENCES bms_board_game_seatings(tenant_id, location_id, id) ON DELETE CASCADE,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_table_occupancy_open_table
  ON bms_board_game_table_occupancy (tenant_id, table_id)
  WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_table_occupancy_open_seating
  ON bms_board_game_table_occupancy (tenant_id, seating_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bms_board_game_table_occupancy_range
  ON bms_board_game_table_occupancy (tenant_id, location_id, started_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_bms_board_game_table_occupancy_seating
  ON bms_board_game_table_occupancy (tenant_id, seating_id, started_at);

INSERT INTO bms_board_game_table_occupancy (
  tenant_id, location_id, table_id, seating_id, started_at, ended_at, end_reason, backfilled
)
SELECT st.tenant_id, st.location_id, st.table_id, st.id, st.opened_at, st.closed_at,
       CASE WHEN st.closed_at IS NULL THEN NULL ELSE 'BACKFILL' END, TRUE
  FROM bms_board_game_seatings st
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_board_game_table_occupancy o
    WHERE o.tenant_id = st.tenant_id AND o.seating_id = st.id
 );

-- Revenue attribution needs a separate membership timeline. A physical seating can contain
-- several sessions after a merge, so seating occupancy alone cannot say when each bill arrived.
CREATE TABLE IF NOT EXISTS bms_board_game_session_table_occupancy (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  session_id  UUID NOT NULL,
  table_id    UUID NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  end_reason  TEXT CHECK (end_reason IN ('CLOSED','MOVED','MERGED','DETACHED','CANCELLED','BACKFILL')),
  backfilled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, location_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, table_id)
    REFERENCES bms_board_game_tables(tenant_id, location_id, id) ON DELETE CASCADE,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_session_table_occupancy_open
  ON bms_board_game_session_table_occupancy (tenant_id, session_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bms_board_game_session_table_occupancy_range
  ON bms_board_game_session_table_occupancy (tenant_id, location_id, session_id, started_at, ended_at);

INSERT INTO bms_board_game_session_table_occupancy (
  tenant_id, location_id, session_id, table_id, started_at, ended_at, end_reason, backfilled
)
SELECT s.tenant_id, s.location_id, s.id, st.table_id, s.started_at,
       CASE WHEN s.status IN ('OPEN','CLOSING') THEN NULL ELSE COALESCE(s.ended_at, s.updated_at) END,
       CASE WHEN s.status IN ('OPEN','CLOSING') THEN NULL ELSE 'BACKFILL' END,
       TRUE
  FROM bms_board_game_sessions s
  JOIN bms_board_game_seatings st
    ON st.tenant_id = s.tenant_id AND st.location_id = s.location_id AND st.id = s.seating_id
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_board_game_session_table_occupancy o
    WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id
 );

CREATE TABLE IF NOT EXISTS bms_board_game_branch_hours (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL,
  weekday        SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at       TIME,
  closes_at      TIME,
  closed         BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NOT NULL,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, weekday, effective_from),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK (
    (closed AND opens_at IS NULL AND closes_at IS NULL)
    OR (NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at <> closes_at)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_branch_hours_effective
  ON bms_board_game_branch_hours (tenant_id, location_id, weekday, effective_from DESC);

ALTER TABLE bms_board_game_table_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_table_occupancy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_table_occupancy_tenant_isolation ON bms_board_game_table_occupancy;
CREATE POLICY bms_board_game_table_occupancy_tenant_isolation ON bms_board_game_table_occupancy
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_board_game_branch_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_branch_hours FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_branch_hours_tenant_isolation ON bms_board_game_branch_hours;
CREATE POLICY bms_board_game_branch_hours_tenant_isolation ON bms_board_game_branch_hours
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

ALTER TABLE bms_board_game_session_table_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_session_table_occupancy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_session_table_occupancy_tenant_isolation ON bms_board_game_session_table_occupancy;
CREATE POLICY bms_board_game_session_table_occupancy_tenant_isolation ON bms_board_game_session_table_occupancy
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_table_occupancy TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_session_table_occupancy TO bms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_branch_hours TO bms_app;

ALTER TABLE bms_generated_reports
  DROP CONSTRAINT IF EXISTS bms_generated_reports_report_type_check;
ALTER TABLE bms_generated_reports
  ADD CONSTRAINT bms_generated_reports_report_type_check
  CHECK (report_type IN (
    'SALES','INVENTORY','PROFIT','PRODUCTS','PAYMENTS','PURCHASES','CUSTOMERS',
    'OPERATIONS','SPECIALIZED','VAT_SALES','VAT_PURCHASE','STOCK_LEDGER',
    'BOARD_GAME_ANALYTICS'
  ));

COMMENT ON TABLE bms_board_game_table_occupancy IS
  'Physical table occupancy intervals. Backfilled rows are approximate before migration 10.89 because pre-ledger moves are unrecoverable.';
COMMENT ON TABLE bms_board_game_session_table_occupancy IS
  'Per-session table-membership intervals used to allocate frozen billing-group revenue across moves, merges and detaches without double-counting physical occupancy.';
COMMENT ON TABLE bms_board_game_branch_hours IS
  'Effective-dated structured branch hours used only for board-game utilization denominators; public opening_hours prose is unchanged.';

COMMIT;

-- ROLLBACK:
-- Roll back application code first so seating writes stop requiring the ledger.
-- Keep generated reports/files as audit history. If removal is still required:
--   DELETE FROM bms_generated_reports WHERE report_type = 'BOARD_GAME_ANALYTICS';
--   DROP TABLE IF EXISTS bms_board_game_session_table_occupancy;
--   DROP TABLE IF EXISTS bms_board_game_table_occupancy;
--   DROP TABLE IF EXISTS bms_board_game_branch_hours;
-- Reapply the report-type CHECK from 10.23 afterwards.
