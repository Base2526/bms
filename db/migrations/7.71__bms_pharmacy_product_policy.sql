-- Pharmacy product-sale policy. Product names/categories are not regulatory
-- authority: every pharmacy SKU must be reviewed explicitly before a customer
-- channel may create an order for it.

CREATE TABLE IF NOT EXISTS bms_pharmacy_product_policies (
  id                  UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku         TEXT NOT NULL,
  product_type        TEXT NOT NULL DEFAULT 'UNKNOWN'
                        CHECK (product_type IN (
                          'UNKNOWN', 'GENERAL_PRODUCT', 'MEDICAL_SUPPLY',
                          'MEDICAL_DEVICE', 'HOUSEHOLD_REMEDY', 'DRUG'
                        )),
  regulatory_class    TEXT NOT NULL DEFAULT 'UNKNOWN',
  sale_policy         TEXT NOT NULL DEFAULT 'PHARMACIST_APPROVAL'
                        CHECK (sale_policy IN (
                          'DIRECT_SALE', 'SHORT_SAFETY_CHECK',
                          'PHARMACIST_APPROVAL', 'PRESCRIPTION_REQUIRED',
                          'ONLINE_SALE_PROHIBITED'
                        )),
  registration_no     TEXT,
  max_quantity        INTEGER CHECK (max_quantity IS NULL OR max_quantity > 0),
  safety_rule_key     TEXT,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'RETIRED')),
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_sku),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_pharmacy_product_policies_sale
  ON bms_pharmacy_product_policies (tenant_id, status, sale_policy);

ALTER TABLE bms_pharmacy_product_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_product_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_product_policies_tenant_isolation
  ON bms_pharmacy_product_policies;
CREATE POLICY bms_pharmacy_product_policies_tenant_isolation
  ON bms_pharmacy_product_policies
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pharmacy_product_policies TO bms_app;

-- Completed cases must not prevent a later, unrelated case in the same chat.
DROP INDEX IF EXISTS uq_bms_pharm_assess_active_per_conversation;
CREATE UNIQUE INDEX uq_bms_pharm_assess_active_per_conversation
  ON bms_pharmacy_assessments(tenant_id, conversation_id)
  WHERE conversation_id IS NOT NULL
    AND status IN (
      'DRAFT', 'COLLECTING_INFORMATION', 'PENDING_CONFIRMATION',
      'WAITING_FOR_PHARMACIST', 'PHARMACIST_REVIEWING', 'NEED_MORE_INFORMATION'
    )
    AND deleted_at IS NULL;
