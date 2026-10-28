# BMS POS Mobile

Bare React Native POS client (`react-native@0.87.1`, no Expo). The app uses HTTPS GraphQL for
authoritative reads and commands and GraphQL WS only for scoped invalidation. The database and BMS
services remain the source of truth.

## Product Positioning

BMS Cloud and BMS Hybrid POS are one product, not separate editions or databases. Cloud is the
authoritative operating mode. The native client's **Emergency Offline Mode** is a bounded continuity
capability inside that product: today it queues only plain retail cash sales on the paired mobile
device, then submits them through the normal server settlement path when connectivity returns. It is
not a local server or full-offline promise.

## Current Status

The in-repository RN workflows are connected to the generated GraphQL contract:

- secure device pairing with the device token in Keychain;
- server bootstrap, cashier selection, PIN verification, and in-memory cashier credentials;
- retail/pharmacy catalog browse and server-backed search, camera or focused Bluetooth/USB HID
  barcode/SKU resolution with an on-device scanner-mode preference, cart, member, coupon and
  discount preview;
- sale/deposit, split cash/QR/card/bank/wallet/store-credit/credit payment, receipt delivery,
  sale history, partial/full return, exchange cart, refund completion, void, and parked bills;
- full receipt preview after checkout and from sale detail on Android/iOS, with server-returned
  line amounts, extra charges, discounts, VAT, split tender, cash change, return/void status,
  and the eligible full-tax-invoice request QR; email/linked-member LINE delivery requires a
  separate confirmation and keeps recipient inputs separate;
- Wi-Fi/LAN receipt-printer configuration (private IPv4, TCP port, 58/80 mm), a test page,
  and manual printing from the receipt preview; print stays disabled until the selected ESC/POS
  printer answers the online/cover/paper status checks;
- shift open/close, shift report, cash in/out, no-sale, expenses, deposits, petty cash, purchase
  receiving, AR collection, store-credit lookup, and required second-person approval;
- pharmacy counter authorization and parked pharmacist-review handoff/resume;
- bounded GraphQL operations so a dropped connection cannot leave scan or payment spinning forever;
- Emergency Offline Mode: an encrypted native queue for plain retail cash sales, with a persisted
  unknown/syncing/review state machine, device/branch/shift-bound request-integrity fingerprint,
  full-screen Sync Center, per-item/manual retry, original-cashier attribution, fail-closed secure
  storage, shift-close/unpair/re-pair guards, recovery of a committed result after shift close, and
  a synced badge in receipt history;
- restaurant dine-in and takeaway checks, variants/modifiers, floor/check operations, kitchen rounds,
  settlement, incoming-order review, QR queue, service calls, waitlist, and menu availability; the
  QR/call/waitlist reads stay active across tabs and drive the `คิว/QR` badge and alerts;
- board-game floor and timed sessions, fixed-duration alerts, member lookup, participant bill groups,
  one-group-at-a-time close while others keep playing, moving a party to a free table or merging two
  occupied tables without touching a bill, playable-copy checkout/return/issue handling,
  and payment through the existing POS checkout;
- branch stock transfer create/send/receive/cancel with explicit damaged/missing evidence, plus stock
  count create/line entry/apply/cancel using the server-owned snapshot-delta rule;
- a `product.view`-guarded branch stock lookup by product name, SKU, legacy barcode, or active pack
  barcode, showing usable, current, reserved, quarantined and incoming quantities separately; rows
  that require lot/serial or derived-stock workflows remain visible with an explicit limitation and
  fail closed if submitted to aggregate transfer/count operations;
- stock lookup uses a lookup-labelled scanner action; sale screens retain their add-item action.
  HID keyboard recovery guidance follows iOS/Android settings, and both modes resolve through
  the same server-backed callback without moving stock or adding sale items during lookup;
- kitchen ticket board, station SLA, bulk status updates, and fallback refresh;
- named GraphQL subscriptions, bounded event deduplication, batched active-query refetch,
  foreground/reconnect recovery, and degraded polling.
- separate HTTP/server reachability status plus a bounded encrypted recovery queue for eligible
  retail cash sales; the queue excludes PINs, syncs serially with the original idempotency key,
  recovers a committed result before retrying, normalizes interrupted writes after process restart,
  keeps rejected sales visible in the on-device Sync Center, and blocks shift close while unresolved.

Recipe and published menu-set cards use the server's availability status. Their own inventory
may correctly be zero because settlement consumes ingredients. Size selection follows the scan's
`stockTracked` flag; direct-stock variants with zero available quantity remain disabled. Before
payment or resuming a parked bill, a changed SKU/variant/pack conversion is rejected for review:
remove and re-add that line rather than silently changing the physical quantity in the saved cart.

All tenant, location, device, and shift scope is server-derived. Money and stock operations retain
their idempotency key across an unknown network result. Cash out, void, and manual discount filter the
server-provided approver list by the required permission and still receive server-side PIN/RBAC
validation.

Operations quality holds are enforced by shared backend services: scan/variant quantities,
direct-stock restaurant menus and branch stock summaries exclude held/expired lots. Existing
inventory subscriptions invalidate active queries after HOLD/RELEASE. Transfers and count apply
return `LOT_QUALITY_HOLD` with a review reason in data, not an unknown-result GraphQL error; all
lines roll back. A cached Emergency Offline snapshot cannot know a newly placed hold: replay still
revalidates on the server and keeps any rejected accepted-cash sale for reconciliation.

Emergency Offline Mode is intentionally limited to plain retail cash sales. Restaurant, board-game,
pharmacy, member/points/coupon, approval, serial/weighted/modifier, credit, deposit, split and
non-cash workflows still require the server. A pending reference is not a receipt or tax document;
those exist only after the normal backend settlement commits.

Continuity currently assumes the app is already signed in, the original shift remains open, and the
product/pricing snapshot needed for the cart was loaded before the outage. The encrypted queue
survives a process restart, but restarting while still offline does not provide offline PIN login or
an unrestricted local catalog. During the same signed-in session, successfully resolved product
snapshots stay in memory so the cashier can create further eligible cash sales from those cached
products without waiting for the server. A server-rejected price or stock conflict remains unresolved until it
is safely retried or handled through manager reconciliation; cash must never be accepted a second
time for that reference.

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

For the Android Emulator dev stack, `docker-compose.dev.yml` also exposes Caddy on host loopback
port `3001`. Run `adb reverse tcp:3000 tcp:3001` and keep the paired server as
`http://localhost:3000`; the device sees one loopback origin while Caddy routes HTTP and WebSocket
traffic to the correct services. The host port is deliberately bound to `127.0.0.1` so the device
bearer token is not accepted over cleartext from the LAN.

When the local Caddy endpoint uses an `mkcert` certificate, install its root CA into each newly
created or reset iOS Simulator before pairing:

```bash
npm run ios:trust-local-ca
```

Keep App Transport Security enabled. A physical device or production endpoint must use a CA that
the device already trusts, or have an organization-managed CA profile installed explicitly.

## Barcode Scanner Modes

The sale-screen scanner modal supports one-shot camera capture and focused Bluetooth/USB HID input.
Camera is the safe default. Choosing Hardware Scanner stores only that convenience preference in a
dedicated Keychain service; if it cannot be read, the next open returns to camera.

Hardware mode assumes the scanner is paired with the OS as a keyboard and its terminator submits the
focused field. The modal remains open for consecutive items, clears and refocuses after each success,
and guards against a CR+LF pair resolving the same code twice. A failed code remains selected so it
can be replaced. If the scanner emits Thai characters, switch the hardware keyboard layout to
English (US); the app deliberately does not guess a character-to-digit remapping. Modifier and
multi-pack products still open the normal product-options flow before they are added.

This mode captures only while the scanner modal is open and focused. It is separate from the
browser POS device's FOCUS/PREFIX Scan Manager settings and does not grant any permission or bypass
the server resolver. Global iOS/Android key capture remains future native work.

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

## Native Integrations

### Network Receipt Printing

Open **เครื่องพิมพ์ใบเสร็จ** in device settings or **เชื่อมต่อเครื่องพิมพ์** in the receipt
preview. Enter the printer's private IPv4 address and raw TCP port (normally 9100), choose
58 mm (384 dots) or 80 mm (576 dots), and connect. No brand/model field is required.
The printer must support ESC/POS raster images and `DLE EOT` status 1, 2 and 4. This is not a
universal Wi-Fi/AirPrint/IPP driver or Bluetooth/USB pairing; a printer that accepts TCP but
does not answer these status commands remains unavailable. Network addresses are configured
explicitly; the app does not scan the shop network.

The native transport is `react-native-tcp-socket`. `react-native-view-shot` captures only the
server-backed receipt paper in memory; `fast-png` and `@point-of-sale/receipt-printer-encoder`
encode bounded monochrome raster bands, preserving Thai and QR pixels without a printer code
page. No receipt files, PINs or device tokens are sent to the printer, persisted in a print
queue, or uploaded. Only the printer preference is saved in a separate Keychain service.
If preference storage fails, the active connection remains usable with a visible warning;
the address must be entered again after restarting the app. Hermes compatibility shims supply
Latin-1 `TextDecoder` and `structuredClone`; iOS captures use device-scale-adjusted dimensions
and support 16-bit PNG, while Android captures use pixel dimensions directly.

Readiness is checked on connect, every five seconds while idle, and immediately before the
receipt bytes. Paper-out, open cover, socket close, status timeout or write failure disables
printing. Backgrounding or changing the paired device disconnects; returning to the app never
silently reconnects or prints. A write acknowledgement means **data sent**, not proof that paper
came out. Unknown/partial jobs are not automatically retried; check the paper before an explicit
reprint. Printing never settles another sale, issues a tax document, cuts paper or opens a drawer.
Pending Emergency Offline references have no printable receipt in this flow.

Both native apps must be rebuilt after installing these dependencies (`pod install` on iOS).
iOS needs Local Network permission; denial leaves printing disabled. Validate the test page,
Thai text, QR scan, paper width and disconnect/paper-out behavior on actual hardware before rollout.

### Other Hardware

These are not replaced by GraphQL and remain separate rollout work:

- global Bluetooth/USB key capture outside the explicit scanner modal (camera and focused HID input
  are live; native `pressesBegan`/`UIKeyCommand` and Android key-event capture remain separate work);
- Bluetooth/USB printing, AirPrint/IPP, cash-drawer kick, and customer display hardware;
- FCM/APNs push while the app is suspended or terminated;
- persistence/sync policy for per-device alert preferences;
- real-device iOS/Android sound, reconnect, and poor-network soak tests;
- pharmacy evidence capture/upload for approval-gated products.

Until those hardware and specialist workflows land, the server fails closed for unsupported
evidence-required sales. REST compatibility routes and polling remain for the browser POS rollout;
do not remove them based only on this RN migration.
