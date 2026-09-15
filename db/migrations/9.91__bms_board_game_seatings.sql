-- =============================================================
-- 9.91  Board-game seating: the physical table is not the bill or visit
-- -------------------------------------------------------------
-- A session owns one visit's timers, participants, loans and billing groups.
-- Until now it also owned `table_id`, which makes two ordinary floor actions
-- impossible to model truthfully:
--   * moving a party rewrites where the visit originally opened;
--   * merging two occupied tables would require merging sessions and therefore
--     rewriting their bills, clocks, loans and order history.
--
-- A seating is the current physical occupancy. One active seating owns one
-- table, while several still-active sessions may share that seating after a
-- merge. Sessions and every bill below them keep their identity unchanged.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_seatings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id              UUID NOT NULL,
  table_id                 UUID NOT NULL,
  -- Stable bridge used by the idempotent backfill and useful provenance after
  -- several sessions are later merged into the same seating. It deliberately
  -- has no FK: the seating outlives a session-row purge inside test cleanup.
  origin_session_id        UUID,
  status                   TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE', 'CLOSED', 'MERGED')),
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  merged_into_seating_id   UUID,
  version                  INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (tenant_id, origin_session_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, table_id)
    REFERENCES bms_board_game_tables(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, merged_into_seating_id)
    REFERENCES bms_board_game_seatings(tenant_id, location_id, id),
  CONSTRAINT bms_board_game_seatings_closed_shape
    CHECK ((status = 'ACTIVE') = (closed_at IS NULL)),
  CONSTRAINT bms_board_game_seatings_merge_shape
    CHECK ((status = 'MERGED') = (merged_into_seating_id IS NOT NULL))
);

ALTER TABLE bms_board_game_sessions
  ADD COLUMN IF NOT EXISTS seating_id UUID;

-- The pre-9.91 unique active-session index guarantees this creates at most one
-- ACTIVE seating for each table. Historical sessions each receive their own
-- CLOSED seating so their original table remains queryable without inventing
-- shared history after the fact.
INSERT INTO bms_board_game_seatings (
  id, tenant_id, location_id, table_id, origin_session_id, status, opened_at, closed_at,
  version, created_at, updated_at
)
SELECT gen_random_uuid(), s.tenant_id, s.location_id, s.table_id, s.id,
       CASE WHEN s.status IN ('OPEN', 'CLOSING') THEN 'ACTIVE' ELSE 'CLOSED' END,
       s.started_at,
       CASE WHEN s.status IN ('OPEN', 'CLOSING') THEN NULL
            ELSE COALESCE(s.ended_at, s.updated_at, s.started_at) END,
       0, s.created_at, s.updated_at
  FROM bms_board_game_sessions s
 WHERE s.seating_id IS NULL;

-- The insert is one row per session, so table/time identifies its backfill row.
UPDATE bms_board_game_sessions s
   SET seating_id = st.id
  FROM bms_board_game_seatings st
 WHERE s.seating_id IS NULL
   AND st.tenant_id = s.tenant_id
   AND st.location_id = s.location_id
   AND st.origin_session_id = s.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms_board_game_sessions WHERE seating_id IS NULL) THEN
    ALTER TABLE bms_board_game_sessions ALTER COLUMN seating_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_board_game_sessions'::regclass
       AND conname = 'bms_board_game_sessions_seating_location_fk'
  ) THEN
    ALTER TABLE bms_board_game_sessions
      ADD CONSTRAINT bms_board_game_sessions_seating_location_fk
      FOREIGN KEY (tenant_id, location_id, seating_id)
      REFERENCES bms_board_game_seatings(tenant_id, location_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_sessions
  VALIDATE CONSTRAINT bms_board_game_sessions_seating_location_fk;

-- Occupancy now belongs to the seating, not the visit. Multiple visits are
-- intentionally allowed to share one active seating after a table merge.
DROP INDEX IF EXISTS uq_bms_board_game_sessions_open_table;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_seatings_active_table
  ON bms_board_game_seatings (tenant_id, table_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_seatings_location_active
  ON bms_board_game_seatings (tenant_id, location_id, table_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_sessions_seating_active
  ON bms_board_game_sessions (tenant_id, seating_id, started_at, id)
  WHERE status IN ('OPEN', 'CLOSING');

ALTER TABLE bms_board_game_seatings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_seatings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_seatings_tenant_isolation
  ON bms_board_game_seatings;
CREATE POLICY bms_board_game_seatings_tenant_isolation
  ON bms_board_game_seatings
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_seatings TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_seatings');

COMMENT ON TABLE bms_board_game_seatings IS
  'Current physical occupancy for board-game visits. One active seating owns a table; several sessions may share it after a merge without merging their clocks, loans or bills.';
COMMENT ON COLUMN bms_board_game_sessions.seating_id IS
  'Current physical seating. Several active sessions may share it after a table merge; billing groups and order history remain attached to their original session.';
COMMENT ON COLUMN bms_board_game_sessions.table_id IS
  'Table where this visit originally opened (legacy/current through 9.90). Current physical table is bms_board_game_seatings.table_id from 9.91 onward.';
COMMENT ON COLUMN bms_board_game_seatings.origin_session_id IS
  'Session that first created this seating. Provenance/backfill key only; every currently seated session is found through bms_board_game_sessions.seating_id.';

COMMIT;

-- ROLLBACK:
-- Moving/merging creates truthful floor history that cannot be represented by
-- the old one-session-per-table shape. Roll back code first and only drop this
-- layer after every active seating contains exactly one session and that
-- session has been copied back to the seating's table_id.
