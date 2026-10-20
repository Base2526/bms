# Phase 3 dispatch policy

## Eligibility

A candidate must be active and verified, have an active membership for the Delivery tenant/branch,
an active approved vehicle whose type exactly matches the frozen Delivery requirement and whose
capacity covers `required_capacity_kg`, `ONLINE` availability, no active assignment and a latest accepted
location within the policy freshness, accuracy and current-radius bounds. A recent offer inside the
configured cooldown excludes the driver. Suspension or verification loss is checked again while the
offer row and Delivery are locked for acceptance; vehicle type/capacity are rechecked there too.

This synthetic phase enables exactly `ON_DEMAND` + `MOTORCYCLE` + `SMALL`, with no special handling,
COD, provider ETA or cross-tenant pool. Capacity is explicit per quote and copied immutably to the
Delivery. Unsupported vehicle/service/package options never default to eligible.

## Ranking and offer evidence

`DISTANCE_THEN_LONGEST_IDLE` orders candidates by PostGIS pickup distance, then oldest
`last_assigned_at` (`NULL` first), then driver id for deterministic ties. Batch size is exactly `1`.
The offer stores policy version, fairness mode, pickup distance, location sequence/accuracy/receive
time, last assignment time, active workload, service-requirement version, required type/capacity and
the matched vehicle type/capacity.

## Attempt loop

1. `start_dispatch` locks a `READY_FOR_DISPATCH` Delivery at the expected version, binds the active
   policy and moves it to `SEARCHING_DRIVER`.
2. A worker claims due attempts with a bounded `SKIP LOCKED` lease.
3. A still-live pending offer waits until its expiry. An expired offer is marked `EXPIRED` and search
   resumes.
4. If no candidate exists, radius increases by the configured increment up to the maximum.
5. A candidate receives one `PENDING` offer and the next action is its TTL.
6. Search deadline produces `SEARCH_TIMEOUT`; maximum-radius exhaustion produces
   `NO_ELIGIBLE_DRIVER`. Both create one manual queue row and move the Delivery to
   `MANUAL_DISPATCH_REQUIRED`.

Expired worker leases are claimable by another worker. A worker that no longer owns the live lease
receives `LEASE_LOST` and performs no mutation.

## Atomic acceptance

Acceptance locks offer, attempt, Delivery and driver; checks expected offer version, TTL, exact
principal, branch membership, current driver status, location and ONLINE state; inserts the assignment;
marks offer/attempt/Delivery/availability; and writes transition, outbox and audit in one transaction.
Unique indexes enforce one accepted offer and assignment per Delivery and one active assignment per
driver. A repeated accept by the winning driver returns the existing assignment.

## Rollback

Disable dispatch intake and worker first. Deploy a compatible forward repair; do not delete policy,
offer, assignment, transition, audit or outbox history. Reverting schema requires proving there are no
Phase 3 Delivery states or rows and is not the normal rollback path.
