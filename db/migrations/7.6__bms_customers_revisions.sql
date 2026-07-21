-- =============================================================
-- 7.6  BMS customer revision tables
-- -------------------------------------------------------------
-- CRM history for customer master + address book.
-- =============================================================

SELECT public.create_revision_trigger('bms_customers');
SELECT public.create_revision_trigger('bms_customer_addresses');
