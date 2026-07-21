-- =============================================================
-- 7.10  BMS purchase order items revision table
-- -------------------------------------------------------------
-- Purchase order line-item history.
-- =============================================================

SELECT public.create_revision_trigger('bms_purchase_order_items');
