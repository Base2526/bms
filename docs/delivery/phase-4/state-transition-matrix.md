# Phase 4 synthetic pickup journey

This matrix covers only the synthetic pre-handoff slice. It does not authorize a real driver app,
merchant handoff, BMS stock movement, POD, customer contact, COD or earnings.

| From | Named action | To | Actor/authority | Preconditions | Evidence | External effect |
| --- | --- | --- | --- | --- | --- | --- |
| `ASSIGNED` | `start_pickup` | `EN_ROUTE_PICKUP` | exact assigned driver principal with `driver.journey.write` | active assignment, active/verified synthetic driver, active branch membership, expected Delivery version | server time, assignment and `syntheticOnly=true` | Delivery outbox/audit only; no BMS command |
| `EN_ROUTE_PICKUP` | `arrive_pickup` | `AT_PICKUP` | exact assigned driver principal with `driver.journey.write` | same authority plus latest accepted synthetic location within the frozen dispatch freshness/accuracy policy | location sequence, received time and accuracy; coordinates remain in the existing location evidence row | Delivery outbox/audit only; no BMS command |

The database row lock and expected aggregate version serialize actions. Every command requires a
stable idempotency key; an exact replay returns the stored response. A wrong driver receives a
not-found response, stale or inaccurate location receives `ARRIVAL_LOCATION_REQUIRED`, and an
out-of-order action receives `INVALID_DRIVER_JOURNEY_TRANSITION`.

`AT_PICKUP` is the hard stop. Physical handoff must not occur until the authoritative BMS handoff
contract can commit its own stock/order transition. Delivery pickup evidence alone never moves BMS
stock and cannot advance this synthetic slice to `PICKED_UP`.
