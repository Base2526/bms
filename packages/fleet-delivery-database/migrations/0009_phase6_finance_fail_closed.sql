-- Phase 6 cannot create real-money account classes until Finance, Tax and Legal approve the model.
-- Keep the Phase 2 shadow allocation chart explicit instead of allowing arbitrary app-created codes.
ALTER TABLE fleet_delivery.ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_shadow_code_check;
ALTER TABLE fleet_delivery.ledger_accounts
  ADD CONSTRAINT ledger_accounts_shadow_code_check CHECK (code IN (
    'CUSTOMER_DELIVERY_RECEIVABLE',
    'MERCHANT_SUBSIDY_RECEIVABLE',
    'PLATFORM_PROMOTION_EXPENSE',
    'DELIVERY_FEE_CLEARING'
  ));

ALTER TABLE fleet_delivery.ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_shadow_type_check;
ALTER TABLE fleet_delivery.ledger_accounts
  ADD CONSTRAINT ledger_accounts_shadow_type_check CHECK (
    (code IN ('CUSTOMER_DELIVERY_RECEIVABLE', 'MERCHANT_SUBSIDY_RECEIVABLE') AND account_type = 'ASSET')
    OR (code = 'PLATFORM_PROMOTION_EXPENSE' AND account_type = 'EXPENSE')
    OR (code = 'DELIVERY_FEE_CLEARING' AND account_type = 'CLEARING')
  );

COMMENT ON CONSTRAINT ledger_accounts_shadow_code_check ON fleet_delivery.ledger_accounts IS
  'Fail-closed Phase 6 gate: only the non-authoritative Phase 2 shadow allocation chart is allowed.';
COMMENT ON CONSTRAINT ledger_accounts_shadow_type_check ON fleet_delivery.ledger_accounts IS
  'Fail-closed Phase 6 gate: shadow account code and type must match the documented allocation model.';

-- ROLLBACK: do not drop these constraints merely to enable a finance feature. After written
-- Finance/Tax/Legal approval and a separate production authorization, deploy a new migration that
-- replaces them with the approved chart, journal templates, RBAC and separation-of-duty controls.
