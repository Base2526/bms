# Cross-system state and compensation matrix

There is no distributed transaction. The physical action occurs only after the authoritative local
commit succeeds; the other system converges through a durable event and snapshot reconciliation.
Each row's Evidence label applies to the whole row.

## Working Delivery states

`DRAFT`, `QUOTED`, `AWAITING_PAYMENT`, `AWAITING_MERCHANT_ACCEPTANCE`, `PREPARING`,
`READY_FOR_DISPATCH`, `OFFERING`, `ASSIGNED`, `DRIVER_ARRIVED`, `HANDOFF_PENDING`, `PICKED_UP`,
`DELIVERY_ATTEMPTED`, `DELIVERED`, `RETURN_REQUIRED`, `RETURNING`, `RETURNED`, `CANCELLED`, `FAILED`.

- `PROPOSED`: these are Delivery states only; none is added to `bms_orders`.
- `PROPOSED`: terminal failure is operational history, not an automatic BMS cancel/refund.
- `UNRESOLVED`: Product/Operations must approve the final state names and which states are customer
  visible.

## State and compensation

| Trigger / precondition | BMS authoritative change | Delivery authoritative change | Commit/order rule | Retry / compensation | Evidence |
| --- | --- | --- | --- | --- | --- |
| Eligible unpaid order requests quote | None | Create expiring `QUOTED` quote | Delivery commits quote before response | Expired/stale quote is immutable; issue a new quote | `PROPOSED` |
| Bind exact quote while order `PENDING`, no pending/confirmed payment, unchanged eligibility/version | Lock order; set exact `shipping_fee` and quote ref/version; outbox event | Mark quote bound and delivery `AWAITING_PAYMENT` after BMS result/event | BMS commits first; same idempotency key on unknown outcome | Delivery queries BMS snapshot; never issues a second fee mutation blindly | `PROPOSED` |
| Cart/address/order changes before payment | BMS changes order/version and invalidates bound quote | Mark quote stale/expired | BMS event then Delivery inbox | New quote required; no fallback price | `PROPOSED` |
| Payment submitted | BMS creates `PENDING` payment; order stays `PENDING` | Observe non-eligible-to-requote status | BMS only | Reconcile from BMS; Delivery never marks paid | `VERIFIED` |
| Payment confirmed | BMS payment `CONFIRMED`, order `PAID`, audit/outbox atomically | Move to `AWAITING_MERCHANT_ACCEPTANCE` | BMS first | Duplicate event is success; gap triggers snapshot | `PROPOSED` |
| Merchant accepts/prepares | BMS remains commerce authority; normal pack flow reaches `PACKING` | `PREPARING` | BMS service/UI action then event | Rejection/cancel follows approved liability matrix | `PROPOSED` |
| Merchant marks ready | Persist readiness snapshot/version while BMS stays `PACKING` | `READY_FOR_DISPATCH` then `OFFERING` | BMS ready event is prerequisite | If Delivery unavailable, state remains ready and raises action-required; no BMS state invention | `PROPOSED` |
| Driver accepts offer | None | Atomically create one assignment, `ASSIGNED` | Delivery DB unique constraint/version decides winner | Losers receive conflict; expired/unknown results refetch | `PROPOSED` |
| Driver arrives | None | `DRIVER_ARRIVED` with server time/location evidence | Delivery only | Stale/mock GPS is evidence flag, not auto-verdict | `PROPOSED` |
| Merchant and driver confirm physical handoff | `PACKING -> SHIPPED`, stock movement/reservation/audit/outbox in one BMS tx | `HANDOFF_PENDING` until BMS result, then `PICKED_UP` | **BMS commit must succeed before goods leave merchant** | Unknown response: hold goods, retry same key, reconcile. If BMS committed but Delivery missed event, inbox replay/snapshot advances Delivery. | `PROPOSED` |
| Customer delivery with valid POD evidence | No immediate write until Delivery commit/event | Evidence committed; `DELIVERED`; outbox | Delivery commits first | BMS completion request retries same key; BMS rejection creates action-required, does not erase POD | `PROPOSED` |
| BMS accepts completion | `SHIPPED -> COMPLETED`, audit/outbox | Record BMS completion version | BMS only | Reconcile until both terminal projections agree | `PROPOSED` |
| Customer cancels before pickup | BMS validates cancellation/refund rules and commits authoritative cancel | `CANCELLED` after BMS outcome/event | BMS first when an order exists | If driver assigned, Delivery closes offer/assignment and calculates no money until policy approved | `PROPOSED` |
| Merchant/driver cancels before pickup | No direct change from Delivery | Request/reason enters action-required | Human/BMS policy decides | Keep order unchanged until BMS command succeeds | `PROPOSED` |
| Failure after pickup | BMS remains `SHIPPED` until reviewed return/completion decision | `RETURN_REQUIRED` -> `RETURNING` | Delivery failure evidence first | Never call ordinary cancel; no automatic refund | `PROPOSED` |
| Merchant receives return | Approved BMS return service applies stock/tax/refund preconditions | `RETURNED` after receipt/evidence | BMS return and Delivery receipt are correlated, not distributed | Mismatch is action-required reconciliation; compensation is an explicit BMS/ledger adjustment | `PROPOSED` |
| BMS cancels/returns/refunds independently | BMS commits and emits durable event | Observe, block incompatible actions, reconcile job | BMS first | Do not reverse posted Delivery ledger silently; append compensating entries after policy approval | `PROPOSED` |
| Event duplicate/out of order | No extra source change | Inbox compares identity/hash/version | Consumer transaction | Same identity/body = success; different body = incident; version gap = snapshot | `PROPOSED` |

## Liability decisions that remain blocked

| Scenario | Safe MVP behavior | Evidence | Owner |
| --- | --- | --- | --- |
| No driver found | Stop at merchant-ready/action-required; do not promise ETA or fee refund | `UNRESOLVED` | Product + Operations + Finance |
| Merchant delay/no-show | Record timestamps/evidence; no automatic charge | `UNRESOLVED` | Operations + Legal |
| Driver no-show/cancel | Reassign only before pickup; suspend/review separately | `UNRESOLVED` | Operations + Legal |
| Customer unreachable/unsafe drop-off | Start return workflow; no unattended drop unless separately approved | `UNRESOLVED` | Safety + Legal + Operations |
| Damage/loss/partial handoff | Stop automated settlement/refund; evidence and human dispute review | `UNRESOLVED` | Legal + Insurance + Finance |
| Failed return | Escalate and freeze settlement/payout allocation | `UNRESOLVED` | Operations + Finance + Legal |

## Reconciliation invariant

- `PROPOSED`: neither reconciler advances the other system by direct database write.
- `PROPOSED`: automated repair may only replay an already-authorized idempotent command or refresh a
  projection. Any new commerce or money decision requires a human-authorized command and audit.
- `PROPOSED`: a mismatch records both versions, observed values, correlation id, owner, severity and
  next action; the reconciler never hides drift by overwriting history.

**STOP — Awaiting approval.**
