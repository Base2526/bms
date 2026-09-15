-- =============================================================
-- 9.90  A board-game bill can be ordered onto while people are still playing
-- -------------------------------------------------------------
-- After `9.89` a group owned its money, but the only way to put a snack on that
-- money was the register's Sell tab *after* the table had closed.  A cafe does
-- not work that way: the Coke leaves the fridge at 14:00 and the table pays at
-- 17:00.  Until then the drink existed nowhere — not on a bill, and not in
-- inventory, because nothing had reserved it.
--
-- `bms_board_game_group_items` is the tab: the lines a group has ordered so far.
-- It is the source of truth; the PENDING order on the group is a *derived*
-- reservation rebuilt from these rows, exactly the way a restaurant check
-- rebuilds its reservation on every kitchen round.
--
-- Why the tab reserves stock instead of waiting for payment:
--   * the item is physically gone the moment it is handed over, so inventory
--     that still counts it is wrong for hours;
--   * without a reservation two tables can both be promised the last box, and
--     the second one only finds out at settlement — after it was drunk.
--
-- Why there is no `sent` state like a restaurant check has:
--   a kitchen round is a staff action that commits food to be cooked.  Handing
--   over a drink has no such step, so a line is committed the moment it is
--   added and the reservation is rebuilt in that same transaction.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_group_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  billing_group_id  UUID NOT NULL,
  product_sku       TEXT NOT NULL,
  -- Name at the time it was ordered. Renaming a product later must not rewrite
  -- what the guest was told they were buying.
  product_name      TEXT NOT NULL CHECK (length(btrim(product_name)) BETWEEN 1 AND 200),
  size              TEXT NOT NULL,
  pack_code         TEXT,
  unit_name         TEXT,
  -- How many selling units, and how many base units one selling unit is.
  pack_qty          INTEGER NOT NULL CHECK (pack_qty BETWEEN 1 AND 9999),
  base_qty          INTEGER NOT NULL DEFAULT 1 CHECK (base_qty BETWEEN 1 AND 9999),
  modifier_codes    TEXT[] NOT NULL DEFAULT '{}',
  modifier_names    TEXT[] NOT NULL DEFAULT '{}',
  note              TEXT CHECK (note IS NULL OR length(note) <= 300),
  -- A removed line is kept, not deleted: "we never ordered that" is exactly the
  -- dispute this table exists to answer.
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  added_by          UUID REFERENCES users(id),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by      UUID REFERENCES users(id),
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, billing_group_id)
    REFERENCES bms_board_game_billing_groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku),
  CONSTRAINT bms_board_game_group_items_cancel_shape
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

-- ยอดของบน tab แยกจาก `amount_due` ซึ่ง `9.89` นิยามไว้ว่าเป็น "ค่าเล่นที่แช่ไว้ตอนปิด"
-- ยัดสองความหมายลงคอลัมน์เดียวแปลว่าตอนปิดโต๊ะ ยอดของขนมจะถูกเขียนทับด้วยค่าเล่นเงียบ ๆ
ALTER TABLE bms_board_game_billing_groups
  ADD COLUMN IF NOT EXISTS tab_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (tab_amount >= 0);

COMMENT ON COLUMN bms_board_game_billing_groups.tab_amount IS
  'Value of the ACTIVE tab lines as the live reservation priced them. Separate from amount_due, which is the frozen play-time charge.';

CREATE INDEX IF NOT EXISTS idx_bms_board_game_group_items_group
  ON bms_board_game_group_items (tenant_id, billing_group_id, added_at, id);
CREATE INDEX IF NOT EXISTS idx_bms_board_game_group_items_open
  ON bms_board_game_group_items (tenant_id, billing_group_id)
  WHERE status = 'ACTIVE';

-- -------------------------------------------------------------
-- Tenant isolation, grants, revisions
-- -------------------------------------------------------------

ALTER TABLE bms_board_game_group_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_group_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_board_game_group_items_tenant_isolation
  ON bms_board_game_group_items;
CREATE POLICY bms_board_game_group_items_tenant_isolation
  ON bms_board_game_group_items
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_group_items TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_group_items');

COMMENT ON TABLE bms_board_game_group_items IS
  'What a board-game billing group has ordered so far. Source of truth for the tab; the group''s PENDING order is a reservation derived from these rows and rebuilt whenever they change.';
COMMENT ON COLUMN bms_board_game_group_items.status IS
  'CANCELLED lines stay for history. Removing a mis-rung line must not erase that it was rung.';

COMMIT;

-- ROLLBACK:
-- Dropping this table discards tabs that people have already been served from.
-- Release every group's reservation order first, or the stock those orders hold
-- is reserved for lines that no longer exist:
--   UPDATE bms_orders SET status = 'CANCELLED' WHERE id IN (
--     SELECT current_order_id FROM bms_board_game_billing_groups
--      WHERE current_order_id IS NOT NULL AND status = 'OPEN');
--   DROP TABLE IF EXISTS bms_board_game_group_items;
