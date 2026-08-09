-- =============================================================
-- 7.68  Pharmacy assessments — store approved checkout draft
-- -------------------------------------------------------------
-- After pharmacist approval we may keep a tenant-catalog-backed draft
-- order on the assessment, then wait for the customer to reply
-- "ยืนยันสั่งซื้อ" in the same conversation before creating a real order
-- through the normal checkout flow.
-- =============================================================

ALTER TABLE bms_pharmacy_assessments
  ADD COLUMN IF NOT EXISTS checkout_order_draft JSONB;
