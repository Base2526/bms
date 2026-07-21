-- =============================================================
-- 7.1  BMS core revision tables
-- -------------------------------------------------------------
-- First rollout batch: highest-risk business records.
-- =============================================================

SELECT public.create_revision_trigger('bms_orders');
SELECT public.create_revision_trigger('bms_order_items');
SELECT public.create_revision_trigger('bms_products');
SELECT public.create_revision_trigger('bms_inventory');
SELECT public.create_revision_trigger('bms_customers');
SELECT public.create_revision_trigger('bms_customer_addresses');
SELECT public.create_revision_trigger('bms_payments');
SELECT public.create_revision_trigger('bms_shipments');
