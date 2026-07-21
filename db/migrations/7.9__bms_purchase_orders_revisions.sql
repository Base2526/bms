-- =============================================================
-- 7.9  BMS purchase orders revision table
-- -------------------------------------------------------------
-- Purchase order header history.
-- =============================================================

SELECT public.create_revision_trigger('bms_purchase_orders');
