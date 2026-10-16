# Retention engine

Cloud feature policy (`10.74`): Business is required for new analyses in newly created shops.
All pre-rollout shops retain permanent access; Retail Local is separate. The service checks
entitlement before scanning order history/generating cases, within the write transaction.
After downgrade, old cases/analytics remain readable and existing-case transitions remain
permission-gated as before. `bmsRefreshRetention(existingOnly:true)` updates conversion/expiry
without generating recommendations or new cases. The default remains full generation and denies
without entitlement. Both refresh modes audit transactionally; holdout and human approval remain.

`/admin/followup-queue` includes a permission-gated Retention engine tab backed by
`bmsRetentionCases` and `bmsRetentionAnalytics`. Refresh creates one monthly case per identified
customer with paid POS or online history. The queue shows RFM, value, expected return date, risk,
recommended contact channel, bilingual message, safe no-discount service offer, next product when
basket evidence exists, and the reason for the recommendation.

Treatment cases require `retention.manage` and explicit `Accept` before staff can mark them
contacted. The application never sends the proposed message automatically. Holdout cases cannot be
accepted or contacted at the service layer. Paid orders after contact (treatment) or assignment
(holdout) drive conversion and revenue attribution; the UI reports both rates and their difference
as estimated incremental lift.
Attribution is limited to 30 days and stale open cases become `EXPIRED`.
