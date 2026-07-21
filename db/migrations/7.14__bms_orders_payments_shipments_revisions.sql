-- =============================================================
-- 7.14  BMS order/payment/shipment revision tables
-- -------------------------------------------------------------
-- High-risk business records with the highest dispute value.
-- =============================================================

SELECT public.create_revision_trigger('bms_orders');
SELECT public.create_revision_trigger('bms_order_items');
SELECT public.create_revision_trigger('bms_payments');
SELECT public.create_revision_trigger('bms_shipments');
