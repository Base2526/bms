# Integration events and reconciliation

BMS realtime remains a UI invalidation channel. This document proposes a separate durable contract.
Each row's Evidence label applies to the whole row.

## Transport and ownership

- `VERIFIED`: BMS already uses transactional domain outbox patterns for realtime and provider
  integrations, but its realtime envelope intentionally lacks durable business payloads.
- `PROPOSED`: each producer owns a transactional outbox in its own database. A dispatcher sends to
  an authenticated ingestion endpoint; the consumer commits a durable inbox before acknowledging.
- `PROPOSED`: delivery is at least once. Ordering is guaranteed only per aggregate version, not
  globally. Consumers tolerate duplicates/out-of-order messages and reconcile version gaps.
- `PROPOSED`: commands that mutate BMS use a narrow authenticated BMS adapter and its local
  idempotency store. Events report committed facts and do not masquerade as commands.
- `UNRESOLVED`: Platform must approve HTTP push/pull versus a managed broker. The safe Phase 1
  skeleton uses a transport-neutral dispatcher and synthetic HTTP contract tests only.

## Envelope v1

```json
{
  "messageId": "uuid",
  "messageType": "bms.order.payment-eligibility-changed.v1",
  "schemaVersion": 1,
  "producer": "bms",
  "tenantRef": "opaque-ref",
  "branchRef": "opaque-ref",
  "aggregateType": "bms-order",
  "aggregateRef": "opaque-ref",
  "aggregateVersion": 12,
  "occurredAt": "2026-10-18T00:00:00.000Z",
  "correlationId": "uuid",
  "causationId": "uuid-or-null",
  "payload": {}
}
```

- `PROPOSED`: `messageId` is stable across transport retries; the logical unique key is producer +
  message id. A canonical JSON hash detects same-id/different-body conflicts.
- `PROPOSED`: payload schemas are allowlisted and versioned. No token, secret, raw payment evidence,
  KYC, full CRM profile, attachment or unnecessary address/GPS data is allowed.
- `PROPOSED`: event time is informative; aggregate version is ordering authority. Producer DB commit
  time and receive time are retained for diagnostics.

## Minimum event catalog

| Event fact | Producer | Consumer action | Required payload (minimum) | Evidence |
| --- | --- | --- | --- | --- |
| Order delivery context created/changed | BMS | Refresh eligibility/context snapshot | order ref/version, branch ref, fulfillment, eligibility version/result | `PROPOSED` |
| Payment eligibility changed | BMS | Block/advance quote or delivery workflow | order ref/version, eligibility enum, payment state enum | `PROPOSED` |
| Merchant accepted/ready | BMS | Start/continue dispatch | order ref/version, readiness version/time, bag/seal metadata ref | `PROPOSED` |
| Handoff committed | BMS | Advance `HANDOFF_PENDING -> PICKED_UP` | order ref/version, handoff id/time | `PROPOSED` |
| Order cancelled/returned/refunded | BMS | Block incompatible actions and reconcile | order ref/version, safe state, amount reference/version only | `PROPOSED` |
| Quote bound/expired | Delivery | Display/reconcile exact delivery fee | quote/delivery ref/version, amount satang, currency, expiry | `PROPOSED` |
| Delivery assigned | Delivery | Update merchant/customer projection | delivery ref/version, public assignment state; no driver contact | `PROPOSED` |
| Picked up | Delivery | Verify against BMS handoff event | delivery ref/version, BMS handoff ref | `PROPOSED` |
| Delivered/failed/returned | Delivery | Request/reconcile approved BMS transition | delivery ref/version, outcome/reason code, private evidence ref | `PROPOSED` |
| Finance reconciliation outcome | Owning reconciler | Surface drift/action-required | run id, refs, compared versions, outcome/code; no raw ledger body | `PROPOSED` |

## Command catalog

| Command | Target authority | Preconditions | Idempotency scope | Unknown outcome recovery | Evidence |
| --- | --- | --- | --- | --- | --- |
| Bind/unbind quote | BMS | Exact order/version/state/payment/quote checks | service + operation + order + key + fingerprint | Query order snapshot, retry exact body/key | `PROPOSED` |
| Record merchant readiness | BMS | Human permission/location/order state | actor + order + readiness key | Read current readiness version | `PROPOSED` |
| Commit handoff | BMS | Merchant confirmation, active assignment, order `PACKING` | service + order + handoff key | Hold physical goods; query snapshot/retry same key | `PROPOSED` |
| Request completion | BMS | Delivery `DELIVERED`, evidence ref, BMS `SHIPPED` | service + delivery version + key | Reconcile both snapshots | `PROPOSED` |
| Request cancellation/return/refund | BMS | Approved lifecycle/liability/human confirmation | service/actor + request type + target + key | Query request/result; never issue a different command automatically | `PROPOSED` |

## Inbox, outbox, retry and dead letter

- `PROPOSED`: producer inserts aggregate change and outbox row in one transaction. Outbox has
  `PENDING`, `LEASED`, `PUBLISHED`, `FAILED`, attempt count, next attempt, lease expiry and error code.
- `PROPOSED`: workers claim bounded batches with database leases/`SKIP LOCKED`; a crashed lease can
  be reclaimed. Retry uses bounded exponential backoff and timeout. Provider/service calls occur
  after the producer commit.
- `PROPOSED`: consumer transaction inserts inbox identity/hash and applies one aggregate version.
  Duplicate same hash returns prior outcome; changed hash becomes `ACTION_REQUIRED` and alerts.
- `PROPOSED`: poison messages stop after the approved attempt budget and move to an operator-visible
  dead-letter state. Replay preserves the original id/body/correlation and records who requested it.
- `UNRESOLVED`: attempt budgets, timeouts, retention and alert thresholds require SRE approval.

## Reconciliation

1. `PROPOSED`: detect missing aggregate versions, aged outbox/inbox rows, mismatched terminal states,
   exact amount differences and orphan external references.
2. `PROPOSED`: read minimal authoritative snapshots from both systems with a correlation id.
3. `PROPOSED`: classify `IN_SYNC`, `TRANSIENT`, `REPLAY_SAFE`, `HUMAN_ACTION_REQUIRED` or
   `SECURITY_INCIDENT` and persist both observed versions/hashes.
4. `PROPOSED`: automatically replay only the same already-authorized event/command. Never fabricate
   a new payment, refund, stock, delivery, evidence or ledger decision.
5. `PROPOSED`: close a case only after a fresh comparison. Keep immutable run/correction history.

## Replay and retention

- `PROPOSED`: retain enough outbox/inbox history to exceed maximum outage plus reconciliation and
  audit windows; exact durations are blocked by decision 15/18.
- `PROPOSED`: use cursor checkpoints per producer/consumer and backfill by aggregate/version range.
  A replay is bounded, rate-limited and can be paused without losing rows.
- `PROPOSED`: kill switches independently control new intake, command dispatch and event consumption;
  each switch declares how accepted jobs and queued rows drain.

## Required operational views

- `PROPOSED`: queue age/depth, attempts, dead letters, version gaps, drift age, replay actor/outcome
  and oldest unprocessed item are visible in a Delivery operations surface.
- `VERIFIED`: BMS `/admin/system-health` must remain read-only; remediation buttons belong in an
  authorized operations/reconciliation surface.

**STOP — Awaiting approval.**
