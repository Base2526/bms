# POS client core

Dependency-free client behaviour shared by the native iOS/Android POS and the desktop renderer.
It contains navigation transitions, operation timeout/idempotency helpers, payment-form maths, and
the cashier-facing cart price preview.

This package is not a business-rules layer. Prices, permissions, inventory, shifts, tenders, and
settlement remain authoritative in the BMS backend. Client calculations exist only to present and
validate the cashier form before the server recomputes and commits the transaction.

`runWithOperationTimeout()` rejects at its deadline independently of whether the transport or body
parser honors `AbortSignal`. It also aborts the transport, clears its timer on completion and ignores
late resolution. A timed-out mutation has an unknown outcome; callers preserve the original
idempotency key and never infer that the backend rolled back or automatically retry it.

`connectionFailure.ts` is the shared connection-error presentation contract. It returns `kind`,
`code`, `httpStatus`, `outcome` (`read_failed`, `rejected`, `unknown`) and an operator message with
recovery guidance. It never interpolates raw exception messages, response bodies, URLs or request
variables. `POS_*` identifies a failure category, not a request/correlation ID. The caller's operation
type determines whether to warn about an unknown write or a failed read. Existing server-composed
domain errors retain their codes/reasons, and business rejection data is not reclassified.

Mobile applies the contract before Apollo diagnostics/UI handling. Desktop compact GraphQL uses the
same contract; the restaurant REST JSON adapter bounds headers/body and rejects HTML 200 responses.
HTTP 401 still means rejected authentication; 403 must not log out or unpair the register. Mixed
decided/unknown GraphQL errors, or a network error alongside a decided field, cannot prove that the whole mutation
was rejected. Preserve the original key in those cases. A browser offline flag likewise cannot prove
a submitted command never reached the server. An external abort cancels waiting without proving a
backend rollback.
