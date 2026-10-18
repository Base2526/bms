# Fleet Delivery Phase 5 integration foundation

Status: **IN PROGRESS / EXECUTABLE BMS COMMANDS BLOCKED**

Date: 2026-10-18 (Asia/Bangkok)

This phase starts with the consumer and reconciliation boundary only. It does not claim that the
Phase 4 real-device gate passed, and it does not authorize physical handoff, BMS stock/order writes,
customer tracking, notifications or production credentials.

## Implemented safe slice

- The strict order-context consumer contract accepts only
  `bms.order-context-changed.v1` and `bms.order-context-snapshot.v1`, producer `bms` or
  `synthetic-test`, aggregate type `bms-order` and the existing privacy-bounded payload.
- A normal change event must be exactly the next aggregate version. A first event above version 1 or
  any later version jump remains in the durable inbox as `ACTION_REQUIRED` with
  `ORDER_CONTEXT_VERSION_GAP`; it does not replace the current snapshot.
- Only an authenticated full snapshot event can cross a version gap. Older/equal snapshots or
  changes remain `ACTION_REQUIRED` as `STALE_ORDER_CONTEXT`; duplicate identity/body handling remains
  unchanged.
- `GET /v1/integration/reconciliation/issues` requires `reconciliation.read`, rate limiting and an
  active principal-to-tenant/branch mapping. It is read-only, uses a tenant RLS read snapshot and
  returns a bounded cursor page without the raw envelope, payload or customer data.
- The cursor preserves PostgreSQL microsecond precision so a page boundary cannot return the final
  row of the previous page again.

No schema migration was needed: the existing durable inbox status/result fields are the authority.
No automatic repair endpoint exists. Reconciliation may consume an owner-produced snapshot, but it
never fabricates a missing commerce event or mutates BMS.

## BMS boundary audit

The existing `handoffDeliveryOrder()` service is for provider-backed restaurant delivery and
requires a BMS user, POS device, `restaurant.delivery.handoff`, provider integration rows and its own
handoff model. The generic shipping service is carrier/shipment oriented. Neither is a
Delivery-service adapter and neither may be called with invented user/device credentials.

The future `fleetDeliveryCommitHandoff` boundary must therefore be a narrow BMS-owned wrapper that:

1. authenticates an approved Delivery service principal and derives tenant/branch/order from a
   server-side mapping;
2. requires explicit merchant confirmation, active assignment and exact expected versions;
3. reuses the authoritative BMS stock/order transaction so `PACKING -> SHIPPED`, stock movement,
   audit and durable outbox commit together;
4. stores stable idempotency/body fingerprint state locally in BMS; and
5. returns a committed BMS handoff/order version or a stable rejection. An unknown transport outcome
   leaves goods with the merchant and is reconciled with the same key.

## Verification

- Strict TypeScript and production build pass.
- 27/27 DB-free contract/domain/client/API tests pass.
- 4/4 DB/API suites pass, including version-gap quarantine, authoritative snapshot recovery,
  stale-event quarantine, cursor pagination, invalid-cursor denial and cross-tenant denial.
- Migrations `0001`–`0008` apply on a fresh disposable database and rerun with no checksum drift.

## Synthetic Customer App foundation (later local slice)

The repository now includes a local-only Customer client core and migration `0012` for short-lived,
purpose-bound synthetic grants. The service principal registers only a token digest for one exact
order; Customer quote/create/status requests carry neither tenant, branch nor order authority, and
write transactions plus the tracking snapshot recheck the live grant. `customer-search`,
`dev:customer-flow` and `dev:customer-dispatch` exercise this boundary against the real local
API/database. It does not add customer-authoritative payment, POD access, notifications, precise
location or a BMS writer, and it is not evidence that the original cross-system Phase 5 gate passed.

The separate Android-first React Native debug shell is in `apps/fleet-delivery-customer`. It stores
the short-lived activation in the OS keystore, exposes only package weight and explicit quote
confirmation, then shows the coarse status through `DRIVER_ASSIGNED`. Payment/readiness and dispatch
remain service-owned; offer acceptance remains driver-owned. The release variant renders a locked screen,
rejects synthetic activation, disables cleartext traffic, is unsigned, and has no location, camera,
notification or contacts permission. Both APK variants compile and the merged-manifest boundary is
machine-checked; no emulator or physical Android device was attached during this verification, so
this is not device-certification evidence.

## Remaining gate

Executable handoff remains blocked until Commerce/Operations approve the lifecycle and confirmation
contract, Security/Platform approve the Delivery-to-BMS principal and scopes, and BMS owns an adapter
that reuses its authoritative stock/order service. Production customer tracking still requires the
approved revocable-grant/location/POD policy owned by Security/Product/Privacy. No Phase 5 completion or
cross-system E2E claim is made before those dependencies exist.

**PRODUCTION BOUNDARY — Event gap detection and read-only reconciliation only.**
