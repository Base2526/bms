# Phase 2 Delivery state transition matrix

Only this pre-dispatch subset is implemented. Driver/return/completion states remain later-phase work.

| Source | Named action | Target | Actor / scope | Preconditions | Version | Evidence/event | BMS/stock/money effect | Recovery / compensation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | `create` | `AWAITING_PAYMENT` | mapped service / `deliveries.create` | current eligible order snapshot; issued unexpired quote; one fulfillment ref | creates v1 | transition, audit, `delivery-created.v1` outbox | no BMS command or stock move; balanced shadow allocation journal only | same idempotency body replays; changed body conflicts; unknown response retries same key |
| `AWAITING_PAYMENT` | `payment_confirmed` | `AWAITING_MERCHANT_ACCEPTANCE` | mapped service / `deliveries.transition` | expected version; synthetic BMS authority asserts payment fact | +1 | transition, audit, `delivery-state-changed.v1` | no local payment, kitchen or stock mutation; no new journal | version conflict reloads authority; never infer payment from local intent |
| `AWAITING_MERCHANT_ACCEPTANCE` | `merchant_accepted` | `PREPARING` | mapped service / `deliveries.transition` | expected version and accepted merchant event | +1 | transition, audit, state outbox | no stock move or customer notification | retry same idempotency key; skipped state rejected |
| `PREPARING` | `merchant_ready` | `READY_FOR_DISPATCH` | mapped service / `deliveries.transition` | expected version and explicit readiness | +1 | transition, audit, state outbox | no dispatch, assignment or BMS handoff in Phase 2 | stays ready until later dispatch phase; no fabricated ETA |
| any implemented non-terminal state | `cancel_before_pickup` | `CANCELLED` | mapped service / `deliveries.transition` | expected version; pre-pickup only; reason code | +1; terminal timestamp | transition, audit, state outbox | no automatic BMS cancel/refund or journal reversal | BMS/liability decision remains human/authority-owned; terminal history is not rewritten |

Assignment ownership, driver evidence, notifications, timeouts and stock effects are `not applicable`
in Phase 2 because those capabilities are disabled. Later phases must extend this matrix rather than
bypass the named-action and expected-version contract.
