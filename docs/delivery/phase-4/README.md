# Fleet Delivery Phase 4 execution gate

Status: **IN PROGRESS / GATE BLOCKED — synthetic client foundation implemented; required authority
and real-device infrastructure are absent**

Date: 2026-10-18 (Asia/Bangkok)

The user authorized work on Phases 4–10. That authorization permits repository work, but it does not
replace the named DPO, Legal, Finance, Tax, Safety, Security and Operations approvals required by the
accepted design, nor can it supply the real Android/iOS devices required by the Phase 4 gate.

## 1. Verified repository state

- `VERIFIED`: Phase 3 exposes synthetic driver principal, availability, location and offer APIs.
- `VERIFIED`: no separate Fleet Delivery React Native app exists.
- `VERIFIED`: a platform-neutral synthetic driver client core now exists at
  `apps/fleet-delivery-driver-core`; it is not a distributable Android/iOS application.
- `VERIFIED`: an authenticated, bounded `GET /v1/driver/offers` feed resolves the exact driver
  principal and returns no customer identity, address, contact detail or coordinates.
- `VERIFIED`: availability and offer decisions can be queued through an injected persistence
  adapter, retain one idempotency key across retries and treat only the server response as authority.
- `VERIFIED`: a separate current-assignment read restores the server-owned active assignment after
  an app restart without relying on a local accept result.
- `VERIFIED`: a coherent polling/reconnect snapshot reads availability, the active assignment and
  pending offers from one repeatable-read database snapshot, with the invariant that an assigned
  driver receives no offers in that response.
- `VERIFIED`: Delivery object storage is deliberately `DisabledObjectStore`; no private POD upload
  or authorized streaming path exists.
- `VERIFIED`: no driver login/recovery, registered-device session, refresh-token rotation, KYC,
  FCM/APNs credential, notification endpoint or remote device-revocation implementation exists.
- `VERIFIED`: no approved GPS/POD/KYC retention schedule, lawful basis, storage region or privacy
  notice exists.
- `VERIFIED`: no real Android/iOS target device is connected to this workspace, so foreground,
  background and terminated behavior cannot be truthfully certified.

## 2. Blocking decisions and evidence

| Blocker | Required owner/evidence | Safe default while absent |
| --- | --- | --- |
| Driver legal/insurance/safety status | Legal + Operations + Safety written approval | synthetic drivers only |
| Driver login, recovery, MFA and device replacement | Security-approved identity/session design | no real account or credential |
| KYC/licence/vehicle review | Legal + Operations workflow and retention | no document upload or verification claim |
| Exact GPS collection and retention | DPO/Legal lawful basis, notice, window, deletion/hold schedule | no real-device GPS collection |
| POD/failure/return photo evidence | DPO/Legal/Security retention, access and incident policy | object storage remains disabled |
| Private object storage | approved provider, region, encryption/key owner, malware scanning and credentials | fail closed |
| Push notifications | approved FCM/APNs ownership, token lifecycle and message classification | use the implemented bounded snapshot API as the non-app polling/reconnect foundation |
| Contact/SOS/abuse handling | Safety + Support + Legal escalation owner and runbook | no phone disclosure or contact feature |
| Real-device gate | supported Android/iOS versions plus physical devices and signing setup | do not claim Phase 4 completion |

## 3. Why implementation stops here

Creating a production-shaped mobile shell before these decisions would force unapproved choices into
security credentials, exact-location collection, private evidence, retention and emergency handling.
Using mock devices or a public/local file URL would not satisfy the accepted gate. Advancing to Phase
5 before Phase 4 journeys pass would also violate the phase ordering and make BMS handoff depend on an
unverified client.

The safe synthetic boundary now includes the offer feed, platform-neutral client core and the
pre-handoff `ASSIGNED -> EN_ROUTE_PICKUP -> AT_PICKUP` journey. Migration `0008` expands only those
Delivery states and adds structured evidence to the append-only transition history. No mobile
binary, external resource, real credential or customer/driver record was created. The
following capabilities are hard-disabled in the client manifest: production authentication,
real-device location, KYC documents, POD photos, push notifications, customer contact and COD/
earnings.

## 4. Implemented synthetic slice

- `GET /v1/driver/offers` requires `driver.offers.read`, rate limiting, an exact synthetic driver
  principal and active tenant/branch membership. The response is bounded to 20 live offers and uses
  server time/expiry.
- `GET /v1/driver/assignments/current` requires `driver.assignments.read` and the same exact
  principal/membership checks. It returns at most one active assignment and no customer or route
  details.
- `GET /v1/driver/snapshot` requires `driver.snapshot.read` and returns availability, assignment and
  at most 20 live offers from one tenant-scoped repeatable-read, read-only transaction. It exposes no
  customer, route or coordinate data and never combines an active assignment with pending offers.
- The client validates the response with a strict schema and does not infer assignment from a local
  tap or device clock.
- `POST /v1/driver/deliveries/:id/actions/start_pickup` and `arrive_pickup` require
  `driver.journey.write`, the exact active assignment, an active/verified driver and the expected
  Delivery version. Arrival additionally requires a fresh, accurate accepted synthetic location.
- Transition evidence stores the location sequence/time/accuracy without duplicating coordinates;
  outbox and `DRIVER` audit rows commit atomically. The boundary stops at `AT_PICKUP`, before any
  merchant handoff or BMS stock/order mutation. See [state transition matrix](state-transition-matrix.md).
- The offline queue supports availability, offer decisions and the two synthetic pickup actions. It
  is capped at 100 commands,
  validates persisted values, serializes queue operations and keeps the original idempotency key.
- Consecutive availability intent in the same tenant/branch is coalesced without crossing an offer or
  journey command: an identical state keeps its original key, while a changed state replaces only
  the tail command.
- Retryable network, server and authentication failures retain the command. A non-retryable server
  denial removes it from the queue and returns the authoritative error to the UI caller.
- Access-token and storage implementations remain injected; the core neither persists a token nor
  queues customer data, coordinates, photos or financial data.

Verification on 2026-10-18: strict TypeScript passed; 25/25 pure tests passed; all 4 DB/API suites
passed, including own-driver offer/assignment visibility, other-driver isolation, cross-tenant
denial, coherent polling snapshots before and after assignment, restart recovery, transition-order
denial, wrong-driver denial, stale-location denial, idempotent replay, append-only location-reference
evidence, `DRIVER` actor audit, removal of the offer after acceptance and the existing 100-request
atomic acceptance test. Migration `0001`–`0008` applied on a fresh disposable database and the
checksum rerun applied nothing.

## 5. Later-phase blockers

- Phase 5 gap detection and read-only reconciliation have started, but executable handoff still needs
  an approved BMS service principal and authoritative BMS handoff contract. Customer tracking needs
  separate Security/Product/Privacy authority. Those Phase 0 decisions remain unresolved.
- Phase 6 explicitly forbids COD, payable earnings, settlement, refund or payout implementation until
  Finance/Tax/Legal approve the chart, formulas, custody, liability and separation of duties.
- Phase 7 Admin placement and platform/tenant/finance permission separation remain unresolved.
- Phase 8 cannot produce a go decision without approved SLO/RPO/RTO, restore/load/incident drills and
  named owner sign-offs.
- Phase 9 now defines fail-closed pilot certification and blocker closure; Phase 10 defines a
  separately authorized controlled launch. Neither definition supplies an approval or permits this
  synthetic driver surface to cross its physical-handoff boundary.

## 6. Minimum unblock packet

Before implementation resumes, record owner-approved decisions for all rows in section 2, provide
non-production private storage and push configuration, name supported Android/iOS target versions,
  make representative physical devices available, and satisfy the Phase 9 readiness gates. Finance,
Tax and Legal must separately approve the Phase 6 policy matrix; a general coding approval is not a
substitute.

**PRODUCTION BOUNDARY — Awaiting the minimum unblock packet before physical handoff or real-device work.**
