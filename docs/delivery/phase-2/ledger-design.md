# Phase 2 minimum shadow ledger

## Purpose and boundary

The Phase 2 ledger freezes the allocation model at Delivery creation so later finance phases cannot
derive history from mutable settings. `DELIVERY_FEE_ALLOCATION_SHADOW` is explicitly a shadow journal:
it does not assert receipt, external payment success, revenue recognition, VAT/WHT, merchant debt,
driver earning, COD, settlement or payout.

## Chart of accounts

| Code | Type | Phase 2 entry |
| --- | --- | --- |
| `CUSTOMER_DELIVERY_RECEIVABLE` | Asset | debit customer contribution when non-zero |
| `MERCHANT_SUBSIDY_RECEIVABLE` | Asset | debit merchant subsidy when non-zero |
| `PLATFORM_PROMOTION_EXPENSE` | Expense | debit explicit discount when non-zero; fixed at zero in Phase 2 |
| `DELIVERY_FEE_CLEARING` | Clearing | credit gross delivery fee |

The debit total equals the gross fee and the credit total equals the gross fee. Zero-value component
rows remain in the quote component snapshot but no zero-value ledger entry is created.

## Posting and correction

The Delivery transaction creates the aggregate, transition, accounts, draft journal and entries,
then marks the journal `POSTED`. Deferred triggers reject commit unless actual debit/credit totals
equal each other and the declared totals. Posted journals and entries are immutable; quote components
and state transitions are append-only. A future correction must create a linked compensating journal,
but Phase 2 exposes no correction operation because liability and accounting policy remain unapproved.

Currency is `THB`, amounts are integer satang, source event is unique per tenant/journal type, and
effective/posted/created timestamps are stored in UTC (`timestamptz`).
