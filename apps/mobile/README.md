# BMS POS Mobile

Bare React Native POS client (`react-native@0.87.1`, no Expo). The app uses HTTPS GraphQL for
authoritative reads and commands and GraphQL WS only for scoped invalidation. The database and BMS
services remain the source of truth.

## Current Status

The in-repository RN workflows are connected to the generated GraphQL contract:

- secure device pairing with the device token in Keychain;
- server bootstrap, cashier selection, PIN verification, and in-memory cashier credentials;
- retail/pharmacy catalog browse and server-backed search, barcode/SKU resolution, cart, member,
  coupon and discount preview;
- sale, split cash/QR/card payment, receipt, sale history, partial return, void, parked bills;
- shift open/close, shift report, cash in/out, and required second-person approval;
- restaurant floor, checks, add/remove item, kitchen round, settlement, incoming-order acceptance;
- kitchen ticket board and status updates;
- named GraphQL subscriptions, bounded event deduplication, batched active-query refetch,
  foreground/reconnect recovery, and degraded polling.

All tenant, location, device, and shift scope is server-derived. Money operations retain their
idempotency key across an unknown network result. Cash out, void, and manual discount filter the
server-provided approver list by the required permission and still receive server-side PIN/RBAC
validation.

The files under `src/mocks/` and the old pure calculation helpers are test fixtures only. Runtime
screens, components, and state providers do not import mock data.

## Architecture

```text
React Native screen
  -> generated Apollo query/mutation over HTTPS
  -> thin GraphQL resolver
  -> BMS service + PostgreSQL transaction
  -> authoritative response

PostgreSQL transaction -> realtime outbox -> dispatcher -> Redis -> GraphQL WS
  -> named invalidation -> active Apollo query refetch
```

Important paths:

- `src/graphql/operations.graphql`: RN operations and named subscriptions.
- `src/graphql/generated.ts`: generated typed documents; do not edit manually.
- `src/graphql/BmsGraphqlProvider.tsx`: Apollo HTTP/WS transport and auth headers.
- `src/state/RealtimeContext.tsx`: reconnect, deduplication, batching, and degraded refresh.
- `src/state/SessionContext.tsx`: cashier PIN held in React memory only.
- `src/state/{Catalog,Cart,Sales,Shift,Kitchen,IncomingOrders}Context.tsx`: authoritative workflow
  adapters.
- `../../schema.graphql`: committed executable schema artifact used by codegen.

## Run

```bash
npm install
npm run graphql:codegen
npm run lint
npm run typecheck
npm test -- --runInBand

cd ios && export LANG=en_US.UTF-8 && pod install && cd ..
npm run ios
npm run android
```

Use a URL reachable from the simulator/device when pairing. `localhost` inside Android does not
refer to the development Mac; use the emulator host alias or a LAN address as appropriate.

When the local Caddy endpoint uses an `mkcert` certificate, install its root CA into each newly
created or reset iOS Simulator before pairing:

```bash
npm run ios:trust-local-ca
```

Keep App Transport Security enabled. A physical device or production endpoint must use a CA that
the device already trusts, or have an organization-managed CA profile installed explicitly.

## Native Alerts

Alert tones use `react-native-sound`. After dependency or resource changes, run `pod install` and
rebuild the native app; reloading JavaScript on an old binary cannot install a native module.

Tone resources are reproducible:

```bash
node scripts/make-alert-tones.mjs
```

Android resource names must stay lowercase `[a-z0-9_]`. Sound behavior still needs verification on
real iOS and Android hardware because unit tests can validate API calls but cannot prove audible
output.

## Remaining Native Integrations

These are not replaced by GraphQL and remain separate rollout work:

- camera scanning and verified Bluetooth/USB scanner integration;
- ESC/POS printing, cash-drawer kick, and customer display hardware;
- FCM/APNs push while the app is suspended or terminated;
- persistence/sync policy for per-device alert preferences;
- real-device iOS/Android sound, reconnect, and poor-network soak tests;
- pharmacy review/evidence UI for approval-gated products and richer variant/modifier selectors.

Until those hardware and specialist workflows land, the server fails closed for unsupported or
approval-gated sales. REST compatibility routes and polling remain for the browser POS rollout; do
not remove them based only on this RN migration.
