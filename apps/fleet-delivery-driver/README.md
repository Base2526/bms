# BMS Fleet Delivery Driver

Bare React Native app for the **internal, synthetic Phase 4 driver workflow**. It is a separate app
from `apps/mobile`, which remains the BMS POS app. The reserved Android application ID and iOS bundle
identifier are `com.bms.delivery.driver`; Debug builds use the isolated `.debug` suffix.

Status: **internal test build only; production activation is fail-closed**.

## Implemented boundary

- Thai and English UI.
- Debug-only activation against HTTPS or loopback HTTP.
- Access token and offline command queue stored through the OS keystore/keychain.
- Server-owned driver snapshot, availability, pending offer, and current assignment display.
- Offer accept/reject and the bounded `ASSIGNED -> EN_ROUTE_PICKUP -> AT_PICKUP` journey.
- A 100-command validated offline queue with original idempotency keys, foreground recovery, polling,
  explicit Sync Center, and visible server rejection codes.
- No customer identity, address, contact, coordinate, photo, or financial payload is persisted by the
  app.

The app stops at `AT_PICKUP`. Production authentication, device registration/revocation, real GPS,
KYC, POD, push notifications, customer contact, COD, earnings, merchant handoff, and drop-off are
hard-disabled in `src/config/capabilities.ts`. Debug and Release use isolated application identities;
a Release build never reads or writes the Debug keychain/keystore session, has no activation form,
and cannot create a session until an approved identity implementation replaces the debug flow.
Android Release is intentionally unsigned and never falls back to the debug keystore.

## Local checks

Use Node 22.11 or later.

```bash
npm ci
npm run typecheck
npm run test:ci
npm run lint
npm run verify:supply-chain
npm run verify:audit-boundary
npm run verify:licenses
npm run verify:reproducibility
cd android && ./gradlew assembleDebug assembleRelease
cd ../ios && bundle exec pod install
```

Run Metro with `npm start`, then use `npm run android` or `npm run ios`. Debug activation requires a
short-lived synthetic driver bearer token and explicit tenant/branch references. Do not use a real
driver credential, customer record, or production environment.

## Architecture

- `src/state/DriverSessionContext.tsx`: fail-closed secure session lifecycle.
- `src/state/DriverRuntimeContext.tsx`: snapshot recovery, polling, offline queue, and commands.
- `src/storage/secureStore.ts`: strict session schema and reference-only encrypted queue.
- `../fleet-delivery-driver-core`: platform-neutral transport and idempotent queue behavior.
- `../../packages/fleet-delivery-contracts`: strict API response and command contracts.

The app is intentionally a standalone npm project because React Native owns native dependency and
lockfile lifecycles independently from the Fleet Delivery Node workspace.

## Release blockers

The reproducibility check proves deterministic Android/iOS JavaScript bundles and copied assets on one
host; it does not prove deterministic native APK/IPA archives, compiler provenance or signing.

This source tree is not evidence that the Phase 4 real-device gate passed. Release still requires the
owner approvals and device exercises in `docs/delivery/phase-4/README.md` and
`docs/delivery/phase-9/evidence/driver-device-safety.md`. As of 2026-10-18, `npm audit --omit=dev`
reports 20 high-severity and zero critical transitive React Native/Metro/CLI advisories for which npm
proposes incompatible downgrades; these remain a Security-owned release blocker and must not be bypassed with
`npm audit fix --force`. Both Debug and Release compile checks are required; Release artifacts remain
unsigned and non-activatable.
