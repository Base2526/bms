# Finance policy decisions

No real COD, commission settlement, earning, payout, transfer or Delivery tax document is authorized.
Each row's Evidence label applies to the whole row.

## Current facts and exact-money boundary

- `VERIFIED`: BMS stores monetary values in exact PostgreSQL numeric columns, but many legacy
  GraphQL fields are `Float`. BMS order amount due includes `shipping_fee`.
- `PROPOSED`: Delivery stores THB amounts as signed 64-bit integer satang. Cross-service JSON uses
  integer satang and currency `THB`; if a BMS adapter must accept decimal, it accepts canonical
  two-decimal strings and converts exactly.
- `PROPOSED`: reject fractional satang, exponent notation, non-THB currency, overflow and
  non-canonical forms. Never round binary float into a journal.
- `PROPOSED`: percentage calculations use integer/rational math with one approved half-up rule at the
  final satang boundary; each quote snapshots input amounts, rule/version and rounding delta.
- `UNRESOLVED`: Finance must approve rounding, VAT-inclusive/exclusive treatment and which delivery
  fee amount is commission-eligible.

## Policy decisions

| Topic | Options / issue | Safe default | Evidence | Owner / gate |
| --- | --- | --- | --- | --- |
| Customer fee and subsidy | Customer pays full, merchant subsidy, platform subsidy | Customer contribution + merchant subsidy are separate snapshotted components; no platform subsidy | `UNRESOLVED` | Finance + Product / Phase 2 |
| Commission | Percentage of gross fee, net fee, or service component | Proposed 5% of approved eligible delivery fee only; shadow record until approved | `UNRESOLVED` | Finance + Tax / Phase 6 |
| Driver earnings | Base/distance/wait/return/cancel/toll/tip/incentive/tax | No payable earning; record synthetic preview only | `UNRESOLVED` | Finance + Legal + Product / Phase 6 |
| COD scope | Merchandise, delivery fee, both, neither | Disabled | `UNRESOLVED` | Finance + Operations + Legal / Phase 6 |
| COD custody | Driver, merchant, platform; deposit cadence/debt limit | No collection | `UNRESOLVED` | Finance + Operations / Phase 6 |
| COD shortages/overages | Debt, expense, dispute, offset | Freeze reconciliation/payout; human review, no auto-offset | `UNRESOLVED` | Finance + Legal / Phase 6 |
| Merchant of record | BMS merchant, Delivery entity, split | BMS remains merchandise authority; Delivery issues nothing | `UNRESOLVED` | Tax counsel + Finance / Phase 6 |
| VAT/withholding | Fee/commission/earning/payout treatment | No real posting or document | `UNRESOLVED` | Tax counsel / Phase 6 |
| Refunds | Merchandise versus delivery fee; pre/post pickup liability | BMS owns merchandise refund; Delivery proposes no fee refund without liability decision | `UNRESOLVED` | Finance + Product + Legal / Phase 5/6 |
| Payout | Manual batch/external transfer; cadence/minimum | Disabled; later prepare/approve/confirm separation | `UNRESOLVED` | Finance + Security / Phase 6 |
| Tips/tolls/incentives | Included in fee/earning/tax | Excluded from MVP | `PROPOSED` | Product explicit exclusion / Phase 0 |

## Proposed ledger invariants

- `PROPOSED`: posted journals are append-only, balanced in satang, tenant/period scoped and linked to
  an immutable business event/rule snapshot. Corrections use reversing/compensating journals.
- `PROPOSED`: no balance field is authoritative without entries. A database constraint/deferred
  validation and property tests prove debit equals credit before posting.
- `PROPOSED`: idempotency prevents the same business event/version from posting twice. Settlement or
  payout allocation has unique active constraints.
- `PROPOSED`: finance periods snapshot reporting timezone/cutoff. Closing a period blocks mutation;
  later corrections post in a current open period with original-reference metadata.
- `PROPOSED`: payout lifecycle is `DRAFT -> PREPARED -> APPROVED -> EXTERNALLY_SENT -> CONFIRMED` or
  rejected/failed with explicit compensations. Preparer, approver and confirmer cannot be the same
  actor for one batch.
- `PROPOSED`: bank APIs and automatic transfer are out of MVP. External evidence cannot itself mark a
  transfer confirmed without an independent authorized action.

## Illustrative account classes — not an approved chart of accounts

| Class | Purpose | Evidence |
| --- | --- | --- |
| Customer delivery fee receivable/reference | Track amount expected through the approved payment authority | `PROPOSED` |
| Merchant subsidy receivable/reference | Track merchant-funded portion | `PROPOSED` |
| Driver earning payable | Accrued approved earning | `PROPOSED` |
| Commission revenue / tax payable | Only after merchant-of-record/tax decision | `UNRESOLVED` |
| COD cash-in-driver-custody and merchant payable | Only after COD policy | `UNRESOLVED` |
| Clearing/suspense | Temporary reconciled differences with aging/owner | `PROPOSED` |
| Refund/adjustment/rounding | Explicit components, never hidden netting | `PROPOSED` |

## BMS integration limits

- `VERIFIED`: Delivery cannot confirm a BMS payment, refund or tax document and cannot change
  merchandise line authority.
- `PROPOSED`: BMS exposes exact status/version and exact decimal/satang boundary fields additively;
  legacy GraphQL `Float` remains display/backward-compatibility only.
- `PROPOSED`: quote binding changes only BMS shipping fee under a locked, eligible order and records
  quote id/version/rule snapshot reference and audit.
- `PROPOSED`: finance reconciliation compares exact components and records drift; it never silently
  overwrites either ledger.

## Phase gates

- `UNRESOLVED`: Finance/Tax/Legal approvals above are required before Phase 6 design is executable.
- `PROPOSED`: Phases 1–5 may use synthetic amounts and a minimum balanced shadow ledger only when no
  payable/receivable, customer charge, COD, payout or tax document is created.
- `PROPOSED`: real-money enablement requires a separate production authorization after journal,
  duplicate payout, separation-of-duty, refund, COD mismatch and recovery tests pass.

**STOP — Awaiting approval.**
