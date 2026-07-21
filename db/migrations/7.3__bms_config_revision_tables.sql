-- =============================================================
-- 7.3  BMS configuration revision tables
-- -------------------------------------------------------------
-- Store profile + tenant integrations/settings.
-- =============================================================

SELECT public.create_revision_trigger('bms_store_profile');
SELECT public.create_revision_trigger('bms_tenant_channels');
SELECT public.create_revision_trigger('bms_tenant_ai_config');
