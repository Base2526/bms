# Phase 6 — finance fail-closed foundation

Status: **POLICY BLOCKED / SHADOW ONLY**.

Phase 6 real-money behavior is not authorized. Finance, Tax, Legal, Product, Operations and Security
decisions identified in `../phase-0/finance-policy-decisions.md` remain unresolved, and production
enablement still requires a separate explicit authorization. This slice therefore tightens the gate;
it does not implement COD, recognition, payable earnings, settlement, refunds, payouts, transfers or
Delivery tax documents.

## Implemented safe boundary

- `GET /v1/finance/capabilities` is an authenticated, rate-limited, tenant/branch-mapped read. It
  requires `finance.capabilities.read` and returns a strict versioned manifest.
- The manifest is fixed to `SHADOW_ONLY`, `THB`, `realMoneyEnabled=false`, unresolved policy and a
  separate-production-authorization requirement. Every real finance capability is literally `false`.
- Migration `0009_phase6_finance_fail_closed.sql` prevents the app role from inventing ledger account
  codes or retyping the four Phase 2 shadow allocation accounts. The existing journal-type constraint
  continues to permit only `DELIVERY_FEE_ALLOCATION_SHADOW`.
- The shadow journal remains non-authoritative allocation evidence. It does not prove collection,
  payment, revenue, VAT/WHT, merchant debt, driver earning, COD custody, settlement or payout.

## Deliberately absent

- no finance mutation endpoint;
- no COD collector or custody record;
- no driver payable or earning formula;
- no commission recognition or settlement posting;
- no refund liability decision or fee-refund writer;
- no payout batch, bank detail, external transfer or confirmation;
- no tax document;
- no UI that could imply any of the above is available.

## Gate to continue real Phase 6

Obtain written decisions and approved account/journal templates for every unresolved item in the
Phase 0 finance policy document. Then implement in a new migration and service change with finance
RBAC, tenant/branch isolation, period controls, immutable compensations, duplicate-payout protection,
separation of duties and external-evidence tests. Real money must remain disabled until the separate
launch authorization is recorded.
