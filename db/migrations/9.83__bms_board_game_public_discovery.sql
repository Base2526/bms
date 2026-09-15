-- =============================================================
-- 9.83  Opt-in public discovery for board-game cafe branches
-- -------------------------------------------------------------
-- A branch is never discoverable merely because the tenant selected the
-- board_game_cafe archetype. The shop must explicitly publish this profile.
-- Only the fields in this table and aggregate availability are exposed by the
-- public service; table/session/customer identifiers stay private.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_public_locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id           UUID NOT NULL,
  public_visible        BOOLEAN NOT NULL DEFAULT FALSE,
  display_name          TEXT CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120),
  summary               TEXT CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 500),
  public_address        TEXT CHECK (public_address IS NULL OR length(btrim(public_address)) BETWEEN 1 AND 300),
  public_phone          TEXT CHECK (public_phone IS NULL OR length(btrim(public_phone)) BETWEEN 1 AND 40),
  opening_hours         TEXT CHECK (opening_hours IS NULL OR length(btrim(opening_hours)) BETWEEN 1 AND 300),
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  publish_rates         BOOLEAN NOT NULL DEFAULT TRUE,
  publish_availability  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK (NOT public_visible OR (latitude IS NOT NULL AND longitude IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_public_locations_visible
  ON bms_board_game_public_locations (updated_at DESC, tenant_id, location_id)
  WHERE public_visible;

ALTER TABLE bms_board_game_public_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_public_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_public_locations_tenant_isolation
  ON bms_board_game_public_locations;
CREATE POLICY bms_board_game_public_locations_tenant_isolation
  ON bms_board_game_public_locations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON bms_board_game_public_locations TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_public_locations');

COMMENT ON TABLE bms_board_game_public_locations IS
  'Explicitly published branch profile for public board-game cafe discovery. Exact table/session/customer data is never public.';

COMMIT;

-- ROLLBACK:
-- DROP TABLE IF EXISTS bms_board_game_public_locations;
