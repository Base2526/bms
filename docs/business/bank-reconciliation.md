# Bank reconciliation — Phase 1–6

Bank reconciliation compares an imported bank statement with facts already recorded in BMS. It is
an evidence workflow, not a general ledger and not an automatic posting engine.

## Safety boundary

- The feature defaults off with `BMS_BANK_RECONCILIATION_ENABLED=false` and
  `NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED=false`.
- Migration `10.110` only adds sidecar tables. It adds no trigger or constraint to existing sales,
  payment, AR, expense, refund, delivery, tax or stock tables.
- A candidate is a deterministic suggestion. Only an authorized person can confirm a link.
- A confirmed link never changes its source row. When a source changes, its fingerprint becomes
  stale and the user must review again.
- Bank tables and their revision tables deny access when the tenant context is absent. The app role
  can update workflow columns only; imported dates, amounts, fingerprints and files are immutable.
- Original files are private and tenant-owned. `/api/files/:id` deliberately refuses bank statement
  files; the dedicated route re-checks `bank_reconciliation.view` and tenant scope.

## Phase delivery

| Phase | Delivered behavior |
| --- | --- |
| 1 — Foundation | Bank accounts, RLS/RBAC, immutable statement staging, CSV/XLS/XLSX validation, SHA-256 dedupe and explicit commit. |
| 2 — Matching | Bounded candidates for confirmed payments, AR receipts, paid expense documents, completed refunds, closed/matched delivery settlements and opposite bank entries. Exact amount/date is ranked highest. |
| 3 — Review | Human confirm, partial matching, ignore with reason, void with reason and transactional audit. No AI and no automatic confirmation. |
| 4 — Month close | Unresolved-item gate, balance equation check, versioned close/reopen and accountant export to XLSX/CSV. |
| 5 — Pilot | Deployment feature flags plus tenant role permissions allow a migration-first controlled pilot. Readiness is shown in the admin page. |
| 6 — Optional API | File import remains the supported source. Open Banking truthfully reports `NOT_CONFIGURED` until a real provider contract, consent model and credentials are available. |

## Permissions

- `bank_reconciliation.view` — see statements, matches, periods and exports.
- `bank_reconciliation.import` — create/archive a bank account and validate/commit/void imports.
- `bank_reconciliation.review` — inspect candidates, confirm/void a link and ignore a row.
- `bank_reconciliation.close` — close or reopen a month.

Administrator remains the code-level super role. Migration `10.110` seeds all four permissions to
Manager. Other roles receive no implicit financial access.

## Import contract

Files are limited to 10 MB and 50,000 entries. The first sheet is used. Formula cells are rejected.
Supported headers include English and Thai variants for date, description, reference, debit, credit,
amount, direction and balance. The preview displays at most 20 entries; the full normalized set is
stored only inside the tenant-scoped import transaction. Full account numbers are never stored:
accounts keep a tenant-scoped HMAC-SHA-256 fingerprint and the final four digits.
The HMAC uses `BMS_BANK_FINGERPRINT_SECRET` (falling back to the deployment's `JWT_SECRET`) and
requires at least 32 bytes. Keep that secret stable; rotating it requires a planned fingerprint
migration.
Matching to existing BMS money sources is currently THB-only because those source tables do not yet
carry a currency dimension. The review list uses server-side pagination, so imports above 500 rows
remain fully reviewable.

## Rollout

1. Back up and apply migration `10.110`.
2. Verify RLS, grants and Manager permission rows using the checks at the end of the migration.
3. Enable the server flag for a non-production pilot. Keep the public flag off while smoke-testing
   the API and permissions.
4. Enable the public flag, create one bank account and import a small redacted statement.
5. Compare all candidate matches manually. Confirm that existing money/source rows are byte-for-byte
   unchanged and audit rows were created.
6. Test close/reopen and accountant export, then expand the pilot.

Rollback is operational: turn both flags off. Do not drop evidence tables after users have confirmed
matches; retain them for audit and data-retention policy.
