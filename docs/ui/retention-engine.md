# Retention engine

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
