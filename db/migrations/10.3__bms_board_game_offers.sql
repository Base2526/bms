-- =============================================================
-- 10.3  Board-game packages and automatic time promotions
-- -------------------------------------------------------------
-- Offers affect the frozen play-time charge only. Products remain normal
-- tab/order lines, and a required SKU is an eligibility condition rather
-- than an included item invented outside inventory.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id           UUID,
  code                  TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  name                  TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  kind                  TEXT NOT NULL CHECK (kind IN (
                           'TIME_PERCENT','TIME_FIXED_PER_PERSON','GROUP_FIXED'
                         )),
  percent_off           NUMERIC(5,2),
  fixed_price           NUMERIC(12,2),
  min_players           INTEGER NOT NULL DEFAULT 1 CHECK (min_players BETWEEN 1 AND 100),
  max_players           INTEGER CHECK (max_players IS NULL OR max_players BETWEEN 1 AND 100),
  minimum_minutes       INTEGER NOT NULL DEFAULT 0 CHECK (minimum_minutes BETWEEN 0 AND 1440),
  required_product_sku  TEXT,
  valid_from            TIMESTAMPTZ,
  valid_until           TIMESTAMPTZ,
  weekdays              INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  starts_local_time     TIME,
  ends_local_time       TIME,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  note                  TEXT,
  version               INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),
  CONSTRAINT bms_board_game_offers_value_shape CHECK (
    (kind = 'TIME_PERCENT' AND percent_off > 0 AND percent_off <= 100 AND fixed_price IS NULL)
    OR (kind IN ('TIME_FIXED_PER_PERSON','GROUP_FIXED')
        AND fixed_price >= 0 AND percent_off IS NULL)
  ),
  CONSTRAINT bms_board_game_offers_player_shape CHECK (
    max_players IS NULL OR max_players >= min_players
  ),
  CONSTRAINT bms_board_game_offers_period_shape CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT bms_board_game_offers_weekdays_shape CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0,1,2,3,4,5,6]
  ),
  CONSTRAINT bms_board_game_offers_product_shape CHECK (
    required_product_sku IS NULL OR length(btrim(required_product_sku)) BETWEEN 1 AND 80
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_board_game_offers_active
  ON bms_board_game_offers (tenant_id, location_id, active, sort_order);

ALTER TABLE bms_board_game_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_offers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_offers_tenant_isolation ON bms_board_game_offers;
CREATE POLICY bms_board_game_offers_tenant_isolation ON bms_board_game_offers
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_offers TO bms_app;
SELECT public.create_revision_trigger('bms_board_game_offers');

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'board_game.offer.manage'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_board_game_offers IS
  'Automatic board-game play-time offers. Required products remain ordinary inventory-backed tab lines.';

COMMIT;

