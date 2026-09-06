-- =============================================================
-- 9.59  Editable restaurant floor layout
-- =============================================================

ALTER TABLE bms_restaurant_tables
  ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'round' CHECK (shape IN ('round', 'rect')),
  ADD COLUMN IF NOT EXISTS position_x INTEGER NOT NULL DEFAULT 0 CHECK (position_x >= 0),
  ADD COLUMN IF NOT EXISTS position_y INTEGER NOT NULL DEFAULT 0 CHECK (position_y >= 0);

-- Existing floors predate coordinates. Spread each area's tables over a useful
-- four-column grid so the new editor never opens with every table stacked at 0,0.
WITH numbered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, location_id, area_id
           ORDER BY sort_order, code
         ) - 1 AS idx
    FROM bms_restaurant_tables
)
UPDATE bms_restaurant_tables AS t
   SET position_x = 40 + (numbered.idx % 4) * 110,
       position_y = 40 + (numbered.idx / 4) * 130
  FROM numbered
 WHERE t.id = numbered.id
   AND t.position_x = 0
   AND t.position_y = 0;
