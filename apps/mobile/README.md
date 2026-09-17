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
- sale/deposit, split cash/QR/card/bank/wallet/store-credit/credit payment, receipt delivery,
  sale history, partial/full return, exchange cart, refund completion, void, and parked bills;
- shift open/close, shift report, cash in/out, no-sale, expenses, deposits, petty cash, purchase
  receiving, AR collection, store-credit lookup, and required second-person approval;
- pharmacy counter authorization and parked pharmacist-review handoff/resume;
- restaurant dine-in and takeaway checks, variants/modifiers, floor/check operations, kitchen rounds,
  settlement, incoming-order review, QR queue, service calls, waitlist, and menu availability; the
  QR/call/waitlist reads stay active across tabs and drive the `คิว/QR` badge and alerts;
- board-game floor and timed sessions, fixed-duration alerts, member lookup, participant bill groups,
  one-group-at-a-time close while others keep playing, moving a party to a free table or merging two
  occupied tables without touching a bill, playable-copy checkout/return/issue handling,
  and payment through the existing POS checkout;
- branch stock transfer create/send/receive/cancel with explicit damaged/missing evidence, plus stock
  count create/line entry/apply/cancel using the server-owned snapshot-delta rule;
- kitchen ticket board, station SLA, bulk status updates, and fallback refresh;
- named GraphQL subscriptions, bounded event deduplication, batched active-query refetch,
  foreground/reconnect recovery, and degraded polling.

All tenant, location, device, and shift scope is server-derived. Money and stock operations retain
their idempotency key across an unknown network result. Cash out, void, and manual discount filter the
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
- `src/navigation/AppNavigator.tsx`: authenticated navigation shell. Bottom tabs contain only section
  roots; checkout, receipts, table/session details, inventory, and other drill-down workflows are
  pushed above the tabs so native transitions and Back behaviour stay consistent on phone/tablet.
- `src/screens/boardGame/BoardGameScreen.tsx`: board-game floor, timed session, member, bill-group,
  alert, and game-loan workflow.
- `src/screens/inventory/InventoryScreen.tsx`: branch transfer and stock-count workflow, reached from
  `งาน`/`เพิ่มเติม` when the bar is full and exposed as its own bottom-tab destination on
  non-restaurant tablets.
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
The paired origin must route both `/api/graphql` to the web service and WebSocket upgrades on
`/graphql` to the WS service. Port `3000` alone reaches Next.js HTTP but not the compose WS service
on `8081`; use the local Caddy HTTPS origin for full GraphQL + realtime testing.

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

- verified global Bluetooth/USB scanner integration (the native one-shot camera scanner is live;
  manual barcode/SKU input remains its explicit fallback);
- ESC/POS printing, cash-drawer kick, and customer display hardware;
- FCM/APNs push while the app is suspended or terminated;
- persistence/sync policy for per-device alert preferences;
- real-device iOS/Android sound, reconnect, and poor-network soak tests;
- pharmacy evidence capture/upload for approval-gated products.

Until those hardware and specialist workflows land, the server fails closed for unsupported
evidence-required sales. REST compatibility routes and polling remain for the browser POS rollout;
do not remove them based only on this RN migration.
