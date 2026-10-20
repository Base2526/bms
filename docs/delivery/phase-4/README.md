# Fleet Delivery Phase 4 execution gate

Passenger clarification (2026-10-18): the user has now requested motorcycle passenger rides.
The separate [passenger sandbox](../passenger-sandbox.md) adds local test signup and pay-after-arrival
in both Debug apps. This document's production identity/KYC/GPS and physical-device blockers remain
unchanged; the goods-delivery grant/driver flow described below is still a separate surface.

Maps follow-up: [passenger maps](../passenger-maps.md) adds Google SDK/search wiring and nearby
matching with foreground Simulator/Emulator-only OS location. Debug overlays request foreground
permission; production capability and iOS physical-device/Release location remain disabled. Older
permission-absence evidence below describes the earlier shell, not this new Debug overlay.
No real-device GPS approval, owner sign-off or Google-live certification is implied.

Status: **IN PROGRESS / GATE BLOCKED — internal React Native test app implemented; required authority
and representative real-device evidence are absent**

Date: 2026-10-18 (Asia/Bangkok)

The user authorized work on Phases 4–10. That authorization permits repository work, but it does not
replace the named DPO, Legal, Finance, Tax, Safety, Security and Operations approvals required by the
accepted design, nor can it supply the real Android/iOS devices required by the Phase 4 gate.

## 1. Verified repository state

- `VERIFIED`: Phase 3 exposes synthetic driver principal, availability, location and offer APIs.
- `VERIFIED`: a separate bare React Native test app now exists at `apps/fleet-delivery-driver`; it
  does not share the BMS POS app identity or business rules.
- `VERIFIED`: the app uses `apps/fleet-delivery-driver-core`, OS secure storage, strict shared
  contracts, a bounded offline Sync Center and debug-only synthetic activation.
- `VERIFIED`: Release builds expose no activation form and cannot create a driver session; this is
  deliberately not a production authentication implementation.
- `VERIFIED`: an authenticated, bounded `GET /v1/driver/offers` feed resolves the exact driver
  principal and returns no customer identity, address, contact detail or coordinates.
- `VERIFIED`: availability and offer decisions can be queued through an injected persistence
  adapter, retain one idempotency key across retries and treat only the server response as authority.
- `VERIFIED`: a separate current-assignment read restores the server-owned active assignment after
  an app restart without relying on a local accept result.
- `VERIFIED`: a coherent polling/reconnect snapshot reads availability, the active assignment and
  pending offers from one repeatable-read database snapshot, with the invariant that an assigned
  driver receives no offers in that response.
- `VERIFIED`: the synthetic journey continues through handoff, transit, drop-off, metadata-only
  photo POD and completion, or failure and return/review/resolution.
- `VERIFIED`: POD stores only SHA-256/MIME/size/dimension metadata. Object storage remains
  `DisabledObjectStore`; no image bytes, signature, OTP, private upload or streaming path exists.
- `VERIFIED`: tenant-scoped, idempotent dispute open/resolve APIs accept bounded category/reason
  text and append audit/outbox evidence without contact data or financial authority.
- `VERIFIED`: no driver login/recovery, registered-device session, refresh-token rotation, KYC,
  FCM/APNs credential, notification endpoint or remote device-revocation implementation exists.
- `VERIFIED`: no approved GPS/POD/KYC retention schedule, lawful basis, storage region or privacy
  notice exists.
- `VERIFIED`: the redacted device inventory found no online physical target: no Android device and
  one iPhone SE (3rd generation) in `unavailable` state. One simulator exists but cannot substitute
  for physical-device certification.
- `VERIFIED`: the automated device-safety boundary passes: Android requests only Internet and
  disables backup; iOS declares no location/camera/background-notification permission or push
  entitlement; restricted capabilities remain false; secure storage is device-only/while-unlocked.
- `BLOCKED`: no physical baseline case ran. GPS, notification, remote-revocation and rooted/
  jailbroken-device cases have no approved policy or implementation and therefore ran zero cases.
  See [the redacted result](device-test-results-2026-10-18.json) and
  [real-device runbook](real-device-test-runbook.md).

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
| Real-device gate | supported Android/iOS versions plus online physical devices and signing setup | run only the fail-closed baseline in the current build; do not claim Phase 4 completion |

## 3. Why production implementation stops here

The internal shell exercises only the already-approved synthetic API boundary. Extending it into a
production driver product before these decisions would force unapproved choices into security
credentials, exact-location collection, private evidence, retention and emergency handling. Using
mock devices or a public/local file URL would not satisfy the accepted gate.

The safe synthetic boundary now includes the offer feed, platform-neutral client core, separate
Driver and Customer React Native Android/iOS source trees, and repository-only post-pickup/return
journeys. Migrations `0008` and `0014`–`0017` add the states, metadata-only evidence tables and named
terminal/amount invariants. Local unsigned native
builds have been created for verification, but no signed or distributable production artifact,
external resource, real credential or customer/driver record was created. The following capabilities
are hard-disabled in the client manifest: production authentication,
real-device location, KYC documents, real POD photos, push notifications, customer contact and COD/
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
- Named driver actions from `start_pickup` through `deliver_with_pod`, `report_failure`,
  `start_return` and `arrive_return` require
  `driver.journey.write`, the exact active assignment, an active/verified driver and the expected
  Delivery version. Arrival additionally requires a fresh, accurate accepted synthetic location.
- Transition evidence stores the location sequence/time/accuracy without duplicating coordinates;
  outbox and `DRIVER` audit rows commit atomically. Service handoff/completion/return actions affect
  only the isolated Delivery aggregate and never mutate BMS stock/order state. See
  [state transition matrix](state-transition-matrix.md).
- The offline queue supports availability, offer decisions and all synthetic driver journey actions. It
  is capped at 100 commands,
  validates persisted values, serializes queue operations and keeps the original idempotency key.
- Consecutive availability intent in the same tenant/branch is coalesced without crossing an offer or
  journey command: an identical state keeps its original key, while a changed state replaces only
  the tail command.
- Retryable network, server and authentication failures retain the command. A non-retryable server
  denial removes it from the queue and returns the authoritative error to the UI caller.
- Access-token and storage implementations remain injected; the core neither persists a token nor
  queues customer data, coordinates, photos or financial data.

Verification on 2026-10-18: strict TypeScript, 57/57 DB-free tests and production bundles passed; all
4 DB/API suites passed on the disposable test stack, including own-driver offer/assignment visibility,
other-driver isolation, cross-tenant
denial, coherent polling snapshots before and after assignment, restart recovery, transition-order
denial, wrong-driver denial, stale-location denial, idempotent replay, append-only location-reference
evidence, `DRIVER` actor audit, removal of the offer after acceptance and the existing 100-request
atomic acceptance test. Migration `0001`–`0017` applied on a fresh disposable database and the
checksum rerun applied nothing. The React Native shell separately passes strict TypeScript, ESLint,
the app Jest suites, mobile lock provenance, dependency-license verification, malicious nesting rejection,
a zero-vulnerability production dependency audit and two-iteration Android/iOS bundle reproducibility.
Driver Android Debug/unsigned Release and iOS Debug/Release simulator builds pass. Customer Android
Debug/unsigned Release and iOS Debug simulator builds also pass (Customer Debug simulator now uses
Xcode's local ad-hoc signing with a simulator-only Keychain identity);
these do not substitute for signed artifacts or physical-device certification.
The device-safety verifier also passes its permission, identity, entitlement, privacy-manifest,
secure-storage and disabled-capability assertions. The redacted inventory found zero online physical
devices, so the physical baseline, GPS, notification and device-trust result counts remain zero.

The follow-up recheck adds DB/API regressions for cancellation from manual dispatch and after
assignment, the full failure/return path, idempotent return replay, inconsistent-return rollback,
preserving OFFLINE after completion, dispute scope/duplicate denial and financial/terminal guards.
All 17 migrations were independently applied to a newly created local database, rerun with zero
changes, and the temporary database removed. Backup/restore passed; its cleanup now owns only a
database created by that run and refuses a source/restore name collision.
Customer iOS activation was visually checked on Simulator after correcting the shared scheme,
CLI dependency, Metro origin and simulator Keychain identity. Customer CI and secret-scanning scope
now include both mobile source trees and the scenario runner. Hosted CI and physical-device tests
have not been run by this recheck.

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
