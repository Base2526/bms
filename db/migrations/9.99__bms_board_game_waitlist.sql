-- =============================================================
-- 9.99  Board-game walk-in queue
-- -------------------------------------------------------------
-- A board-game session starts only after a party has a real table.  This table owns the state
-- before that point: a walk-in party waiting, called, seated, cancelled, or absent.  Seating links
-- the queue row to the normal board-game session instead of creating a second timing/billing path.
--
-- Queue numbers follow the branch service day (shop timezone, 04:00 boundary by default), not the
-- calendar midnight.  A cafe still open after midnight must not issue queue 1 in front of people
-- who have already been waiting.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_bms_realtime_board_game_waitlist ON bms_board_game_waitlist;
--   DROP FUNCTION IF EXISTS public.bms_realtime_board_game_waitlist_trigger();
--   DROP TABLE IF EXISTS bms_board_game_waitlist;
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_waitlist (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id        UUID NOT NULL,
  service_date       DATE NOT NULL,
  queue_no           INTEGER NOT NULL CHECK (queue_no > 0),
  status             TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN (
    'WAITING', 'CALLED', 'SEATED', 'CANCELLED', 'NO_SHOW'
  )),
  party_size         INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 500),
  guest_name         TEXT CHECK (
    guest_name IS NULL OR length(btrim(guest_name)) BETWEEN 1 AND 120
  ),
  guest_phone        TEXT CHECK (
    guest_phone IS NULL OR length(btrim(guest_phone)) BETWEEN 1 AND 40
  ),
  note               TEXT CHECK (note IS NULL OR length(note) <= 300),
  preferred_area_id  UUID,
  seated_table_id    UUID,
  seated_session_id  UUID,
  created_by         UUID NOT NULL REFERENCES users(id),
  updated_by         UUID REFERENCES users(id),
  called_at          TIMESTAMPTZ,
  seated_at          TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, service_date, queue_no),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id, preferred_area_id)
    REFERENCES bms_board_game_areas(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, seated_table_id)
    REFERENCES bms_board_game_tables(tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, seated_session_id)
    REFERENCES bms_board_game_sessions(tenant_id, location_id, id),
  CONSTRAINT bms_board_game_waitlist_seated_shape CHECK (
    (status = 'SEATED') = (seated_at IS NOT NULL)
    AND (status <> 'SEATED' OR (
      seated_table_id IS NOT NULL AND seated_session_id IS NOT NULL
    ))
  ),
  CONSTRAINT bms_board_game_waitlist_closed_shape CHECK (
    (status IN ('SEATED', 'CANCELLED', 'NO_SHOW')) = (closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_open
  ON bms_board_game_waitlist (tenant_id, location_id, status, created_at)
  WHERE status IN ('WAITING', 'CALLED');
CREATE INDEX IF NOT EXISTS idx_bms_board_game_waitlist_day
  ON bms_board_game_waitlist (tenant_id, location_id, service_date, created_at);

ALTER TABLE bms_board_game_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_waitlist FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_waitlist_tenant_isolation ON bms_board_game_waitlist;
CREATE POLICY bms_board_game_waitlist_tenant_isolation ON bms_board_game_waitlist
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_waitlist TO bms_app;
SELECT public.create_revision_trigger('bms_board_game_waitlist');

CREATE OR REPLACE FUNCTION public.bms_realtime_board_game_waitlist_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.bms_emit_realtime_event(
    'board_game.waitlist.changed', NEW.tenant_id, NEW.location_id, NULL,
    'board_game_waitlist', NEW.id::text, NULL, NEW.updated_at,
    jsonb_strip_nulls(jsonb_build_object(
      'status', NEW.status,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
    ))
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bms_realtime_board_game_waitlist ON bms_board_game_waitlist;
CREATE TRIGGER trg_bms_realtime_board_game_waitlist
AFTER INSERT OR UPDATE OF status ON bms_board_game_waitlist
FOR EACH ROW EXECUTE FUNCTION public.bms_realtime_board_game_waitlist_trigger();

ALTER FUNCTION public.bms_realtime_board_game_waitlist_trigger()
  OWNER TO bms_realtime_dispatcher;

COMMENT ON TABLE bms_board_game_waitlist IS
  'Walk-in parties that do not have a table yet. Seating opens the normal board-game session and '
  'links it here atomically, so queue time has a measurable end without creating a second billing path.';

COMMIT;
