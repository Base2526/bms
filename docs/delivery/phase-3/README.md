# Fleet Delivery Phase 3 completion report

Status: **COMPLETE — Phase 4 approved by the user on 2026-10-18; Phase 4 gate is externally blocked**

Date: 2026-10-18 (Asia/Bangkok)

## 1. Implemented scope

- `VERIFIED`: Delivery-native synthetic driver subjects are separate from BMS users/POS devices and
  are bound to exactly one tenant plus explicit active branch memberships for this pilot.
- `VERIFIED`: verified/active state, one approved motorcycle, availability and append-only location
  evidence are rechecked by the server; suspension forces the driver offline and blocks acceptance.
- `VERIFIED`: immutable dispatch-policy versions bound pickup point, sequential batch size `1`, offer
  TTL, location quality/freshness, cooldown, search deadline and bounded radius expansion.
- `VERIFIED`: the worker claims due attempts with `SKIP LOCKED` leases, recovers expired leases,
  creates one offer at a time and escalates exhausted/timed-out search to a durable manual queue.
- `VERIFIED`: PostgreSQL row locks plus unique constraints make acceptance atomic. Duplicate accepts
  return the authoritative assignment and cannot create another assignment.
- `VERIFIED`: every offer freezes distance, policy version, location sequence/accuracy/time,
  longest-idle input and fairness mode for later review.

## 2. API and authorization surface

| Operation | Required scope | Additional authority |
| --- | --- | --- |
| `PUT /v1/dispatch/policy` | `dispatch.manage` | active server-side tenant/branch integration mapping |
| `PUT /v1/dispatch/drivers` | `dispatch.manage` | mapped tenant/branch; synthetic records only |
| `POST /v1/driver/availability` | `driver.availability.write` | exact active driver principal and branch membership |
| `POST /v1/driver/locations` | `driver.location.write` | exact active driver principal, membership and ONLINE/BUSY state |
| `POST /v1/deliveries/:id/actions/start_dispatch` | `dispatch.manage` | mapped tenant/branch, ready state and expected Delivery version |
| `POST /v1/dispatch/offers/:id/accept` | `driver.offers.decide` | exact offered driver principal and current eligibility |
| `POST /v1/dispatch/offers/:id/reject` | `driver.offers.decide` | exact offered driver principal |

All mutations require JSON validation, fail-closed rate limiting and an idempotency key. Admin/service
operations derive tenant access from the integration mapping. Driver operations never use that mapping:
they resolve the exact principal against the tenant-owned driver and active branch membership.

## 3. Database and worker changes

Migration `0007_phase3_dispatch.sql` adds `drivers`, `driver_memberships`, `driver_vehicles`,
`driver_availability`, `driver_locations`, `dispatch_policy_versions`, `dispatch_attempts`,
`dispatch_offers`, `driver_assignments` and `dispatch_manual_queue`. Every table carries `tenant_ref`,
uses forced RLS and has explicit least-privilege grants. Location evidence is append-only; policy
versions can only be deactivated when superseded.

The worker receives execute-only access to `claim_dispatch_attempts()` and
`advance_dispatch_attempt()`. Those security-definer functions use table-safe fields, explicit
PostGIS schema qualification, bounded claims and leases. Offer expiry, radius expansion, state
transition, outbox event and audit evidence commit with the dispatch transaction.

Detailed behavior: [dispatch policy](dispatch-policy.md), [location policy](location-policy.md), and
[state transition matrix](state-transition-matrix.md).

## 4. Verification

| Check | Result |
| --- | --- |
| strict TypeScript, pure tests and production bundles | PASS; `npm run gate`, 12/12 pure tests |
| fresh migration apply and checksum rerun | PASS; `0001`–`0007`, then no pending migration |
| DB/API suites | PASS; 4/4 suites |
| simultaneous acceptance | PASS; 100 requests, one assignment id and one assignment row |
| duplicate/late/wrong-driver acceptance | PASS; authoritative replay or stable denial, no second assignment |
| expiry and deterministic retry | PASS; expired offer reopens search |
| GPS evidence | PASS; stale, future, inaccurate, mock, impossible-travel and out-of-order policy tests |
| tenant/fleet scope | PASS; driver cross-tenant denial and direct RLS invisibility |
| fairness evidence | PASS; policy version, distance, location and longest-idle inputs frozen on offer |
| suspension | PASS; pending offer cannot be accepted after suspension |
| worker recovery | PASS; expired lease reclaimed by another worker |
| manual escalation | PASS; no eligible driver produces durable queue row and Delivery state |
| Compose runtime | PASS; API `/livez` and `/readyz` healthy, worker started with dispatch loop |
| dependency audit | PASS; 0 vulnerabilities |

The environment used randomized synthetic identifiers, ephemeral signing keys and loopback-only
PostgreSQL/Redis. It made no external provider, customer or BMS call.

## 5. Deliberate exclusions and remaining risks

- No driver app, login/recovery, KYC/document workflow, registered-device session or push token exists.
- No real driver, customer, message, route provider, BMS mutation, stock handoff or notification exists.
- No pickup/POD/failure/return evidence, live navigation, background GPS or offline mobile queue exists.
- No COD, driver earnings, tax assertion, settlement, refund, payout or bank transfer exists.
- Synthetic location storage has no production retention schedule. Real-device collection remains
  blocked on Phase 4 Privacy/Safety/Security approval and retention implementation.
- Manual escalation is a durable backend queue only; no Admin UI or manual assignment mutation is in
  this phase.

## 6. Exact proposed Phase 4 scope

Implement the real driver client boundary: Android/iOS login and registered-device session,
verification workflow, availability, foreground/background/offline GPS, offer refresh/decision,
navigation handoff, pickup checklist, private photo POD, failure/return evidence, notifications and
offline recovery. Keep real-money COD/earnings/payout and production launch disabled.

## 7. Gate

Phase 3 acceptance checks are complete. The user explicitly approved Phase 4–10 on 2026-10-18.
Execution is governed by the external-policy and real-device blockers in
[../phase-4/README.md](../phase-4/README.md); this approval is not evidence of DPO, Legal, Finance,
Tax, Safety or Operations sign-off.
