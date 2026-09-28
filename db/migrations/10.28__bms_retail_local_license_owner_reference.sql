-- 10.28 - Require an owner reference for new Retail Local licenses
-- A trial or paid commercial record must be traceable to the customer/account
-- the platform issued it for. Existing historical rows are not rewritten here,
-- but every new or updated row must carry a bounded external reference.

ALTER TABLE bms_retail_local_licenses
  DROP CONSTRAINT IF EXISTS bms_retail_local_licenses_customer_reference_required_check;

ALTER TABLE bms_retail_local_licenses
  ADD CONSTRAINT bms_retail_local_licenses_customer_reference_required_check
  CHECK (
    customer_reference IS NOT NULL
    AND customer_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ) NOT VALID;

COMMENT ON COLUMN bms_retail_local_licenses.customer_reference IS
  'Required platform/customer/account reference used to identify who this commercial license was issued to; not customer-facing POS data.';
