-- =============================================================
-- 7.5  BMS products revision table
-- -------------------------------------------------------------
-- Product history is high value and often edited.
-- =============================================================

SELECT public.create_revision_trigger('bms_products');
SELECT public.create_revision_trigger('bms_inventory');
