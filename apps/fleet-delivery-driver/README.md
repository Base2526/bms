# BMS Driver

**Passenger addition (2026-10-18):** Debug now opens **BMS Driver**, with test signup, vehicle
plate, online/offline and passenger travel through pay-after-arrival. Follow
[the two-app guide](../../docs/delivery/passenger-sandbox.md). Real KYC/GPS/payment/auth remain off.
Debug Simulator/Emulator foreground location and nearby matching are covered in
[the maps guide](../../docs/delivery/passenger-maps.md); physical-device GPS remains gated.
`npm run ios` uses the shared simulator runner with Driver Metro 8089 and Debug simulator-only
Keychain identity. The original goods-delivery surface below remains accessible from the app.

Bare React Native app for the **internal, synthetic Phase 4 driver workflow**. It is a separate app
from `apps/mobile`, which remains the BMS POS app. The reserved Android application ID and iOS bundle
identifier are `com.bms.delivery.driver`; Debug builds use the isolated `.debug` suffix.

Status: **internal test build only; production activation is fail-closed**.

## Implemented boundary

- Thai and English UI.
- Debug-only activation against HTTPS or loopback HTTP.
- Access token and offline command queue stored through the OS keystore/keychain.
- Server-owned driver snapshot, availability, pending offer, and current assignment display.
- Offer accept/reject plus the synthetic pickup, delivery, photo-metadata POD, failure and return
  journeys through `DELIVERED` or `RETURNED_TO_MERCHANT`.
- A 100-command validated offline queue with original idempotency keys, foreground recovery, polling,
  explicit Sync Center, and visible server rejection codes.
- No customer identity, address, contact, coordinate, photo, or financial payload is persisted by the
  app.

The app can advance the isolated Delivery aggregate after `AT_PICKUP`, but it does not perform a
physical/BMS handoff. Its POD button sends fixed synthetic photo metadata only—no camera capture,
image bytes, signature or OTP. Production authentication, device registration/revocation, real GPS,
KYC, real POD storage, push notifications, customer contact, SOS, COD and earnings are hard-disabled
in `src/config/capabilities.ts`. Debug and Release use isolated application identities;
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
npm run verify:security-patch
npm run verify:supply-chain
npm run verify:audit-boundary
npm run verify:device-safety
npm run verify:licenses
npm run verify:reproducibility
cd android && ./gradlew assembleDebug assembleRelease
cd ../ios && bundle exec pod install
```

Run Metro with `npm start`, then use `npm run android` or `npm run ios`. Debug activation requires a
short-lived synthetic driver bearer token and explicit tenant/branch references. Do not use a real
driver credential, customer record, or production environment.

Before a physical-device exercise, run `npm run device:inventory -- --require-physical`. The command
reports only device state/model counts and never persists a serial or UDID. Follow
`docs/delivery/phase-4/real-device-test-runbook.md`: the current build supports the fail-closed
baseline only. GPS, notification and device-trust feature cases remain explicitly blocked; absence
of a permission prompt is not evidence that those features passed.

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
`docs/delivery/phase-9/evidence/driver-device-safety.md`. The React Native graph uses the reviewed
local `braces@3.0.4-bms.1` fork to reject structural nesting above 100 levels before recursive
walkers execute. `npm audit --omit=dev` now reports zero vulnerabilities and the verifier exercises
the malicious pattern, but the patch still requires an independent Security review before release.
Do not replace it with `npm audit fix --force` or remove the exact-hash policy. Both Debug and Release
compile checks are required; Release artifacts remain unsigned and non-activatable.
