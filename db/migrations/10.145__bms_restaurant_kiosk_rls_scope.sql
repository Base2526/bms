-- Kiosk rows are private by default. A public lookup may see only the active row whose
-- token digest the service installed as a transaction-local locator GUC.
-- This is additive to 10.144; never rewrite that deployment identity.
DROP POLICY IF EXISTS bms_restaurant_kiosks_tenant_isolation ON bms_restaurant_kiosks;
CREATE POLICY bms_restaurant_kiosks_tenant_isolation ON bms_restaurant_kiosks
  USING (
    tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid
    OR (active AND token_hash = NULLIF(current_setting('bms.kiosk_token_hash', true), ''))
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS bms_restaurant_kiosk_submissions_tenant_isolation ON bms_restaurant_kiosk_submissions;
CREATE POLICY bms_restaurant_kiosk_submissions_tenant_isolation ON bms_restaurant_kiosk_submissions
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

-- Rollback (only after disabling the public route): restore 10.144's two policies.
-- Do not drop the tables or the accepted check/order evidence.
