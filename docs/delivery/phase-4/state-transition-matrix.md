# Phase 4 synthetic end-to-end journey

This matrix covers the repository-safe synthetic journey. It does not authorize a real driver app,
BMS stock movement, real POD bytes, customer contact, COD, earnings or provider traffic.

| From | Named action | To | Actor/authority | Preconditions | Evidence | External effect |
| --- | --- | --- | --- | --- | --- | --- |
| pre-pickup states, including `MANUAL_DISPATCH_REQUIRED` | `cancel_before_pickup` | `CANCELLED` | mapped service principal | expected version | transition/outbox/audit; open manual queue resolved; pending offers superseded | active assignment closes; BUSY returns ONLINE; OFFLINE remains OFFLINE |
| `ASSIGNED` | `start_pickup` | `EN_ROUTE_PICKUP` | exact assigned driver principal with `driver.journey.write` | active assignment, active/verified synthetic driver, active branch membership, expected Delivery version | server time, assignment and `syntheticOnly=true` | Delivery outbox/audit only; no BMS command |
| `EN_ROUTE_PICKUP` | `arrive_pickup` | `AT_PICKUP` | exact assigned driver principal with `driver.journey.write` | same authority plus latest accepted synthetic location within the frozen dispatch freshness/accuracy policy | location sequence, received time and accuracy; coordinates remain in the existing location evidence row | Delivery outbox/audit only; no BMS command |
| `AT_PICKUP` | `merchant_handoff` | `PICKED_UP` | mapped service principal with `deliveries.transition` | expected version; synthetic-only service action | server time and synthetic marker | no BMS stock/order write |
| `PICKED_UP` | `start_delivery` | `IN_TRANSIT` | exact assigned driver | active assignment and expected version | server time and assignment | no external provider call |
| `IN_TRANSIT` | `arrive_dropoff` | `AT_DROPOFF` | exact assigned driver | fresh accepted synthetic location | location evidence reference/quality only | no customer location stream |
| `AT_DROPOFF` | `deliver_with_pod` | `DELIVERED` | exact assigned driver | strict synthetic photo metadata; SHA-256, MIME, byte size and dimensions | metadata row only; no image bytes, signature or OTP | assignment closes; driver returns online; notification intent is suppressed |
| `DELIVERED` | `complete_delivery` | `COMPLETED` | mapped service principal | expected version | transition/outbox/audit | no settlement or payout |
| `PICKED_UP`/`IN_TRANSIT`/`AT_DROPOFF` | `report_failure` | `DELIVERY_FAILED` | exact assigned driver | reason enum; contact attempts fixed to zero | failure row without PII/contact detail | no customer contact or SOS call |
| `DELIVERY_FAILED` | `request_return` | `RETURN_REQUESTED` | mapped service principal | expected version | return row and transition evidence | no BMS return mutation |
| `RETURN_REQUESTED` | `approve_return` | `RETURN_APPROVED` | mapped service principal | expected version | approval transition | no refund/money movement |
| `RETURN_APPROVED` | `start_return` | `RETURN_IN_TRANSIT` | exact assigned driver | active assignment and expected version | transition evidence | no external provider call |
| `RETURN_IN_TRANSIT` | `arrive_return` | `RETURNED_TO_MERCHANT` | exact assigned driver | fresh accepted synthetic location | return/location evidence reference | assignment closes; driver returns online |
| `RETURNED_TO_MERCHANT` | `review_return` | `RETURN_REVIEW` | mapped service principal | expected version | review transition | no inventory write |
| `RETURN_REVIEW` | `resolve_return` | `RETURN_RESOLVED` | mapped service principal | expected version | resolution transition | no refund or settlement |

The database row lock and expected aggregate version serialize actions. Every command requires a
stable idempotency key; an exact replay returns the stored response. A wrong driver receives a
not-found response, stale or inaccurate location receives `ARRIVAL_LOCATION_REQUIRED`, and an
out-of-order action receives `INVALID_DRIVER_JOURNEY_TRANSITION`.

Each return transition checks the return record's previous status and exactly one affected row;
missing/inconsistent evidence rejects with `RETURN_STATE_CONFLICT` and rolls back the Delivery
transition, outbox, audit and idempotency result together. Finishing delivery/return or cancelling
releases BUSY availability only: a driver's explicit OFFLINE choice is preserved. Customer tracking
distinguishes `RETURN_REVIEW` from the final `RETURN_RESOLVED` stage.

The synthetic `merchant_handoff` action never claims that a physical or authoritative BMS handoff
occurred: it changes only the isolated Delivery aggregate and cannot move BMS stock/order state.
Likewise, synthetic POD stores metadata only. The API rejects OTP, signature, photo bytes and contact
details. Production remains blocked until the authoritative BMS handoff, private object storage,
retention, payment, notification and safety contracts are approved.
