-- =============================================================
-- 7.35  Tenant AI BYOK provider
-- -------------------------------------------------------------
-- Legacy rows are Anthropic. A tenant may now choose Anthropic or
-- DeepSeek while the API key remains encrypted in the existing column.
-- Provider endpoints stay server-controlled; tenants cannot supply an
-- arbitrary base URL.
-- =============================================================

ALTER TABLE bms_tenant_ai_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'anthropic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bms_tenant_ai_config_provider_check'
       AND conrelid = 'bms_tenant_ai_config'::regclass
  ) THEN
    ALTER TABLE bms_tenant_ai_config
      ADD CONSTRAINT bms_tenant_ai_config_provider_check
      CHECK (provider IN ('anthropic', 'deepseek'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_tenant_ai_config_provider
  ON bms_tenant_ai_config (provider);
