-- =============================================================
-- 7.12  BMS tenant channels revision table
-- -------------------------------------------------------------
-- Per-tenant integration credentials/config history.
-- =============================================================

SELECT public.create_revision_trigger('bms_tenant_channels');
