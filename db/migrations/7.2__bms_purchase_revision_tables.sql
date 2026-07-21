-- =============================================================
-- 7.2  BMS purchase revision tables
-- -------------------------------------------------------------
-- Procurement history after the sales-critical batch.
-- =============================================================

SELECT public.create_revision_trigger('bms_suppliers');
SELECT public.create_revision_trigger('bms_purchase_orders');
SELECT public.create_revision_trigger('bms_purchase_order_items');
