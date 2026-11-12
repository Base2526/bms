# BMS POS Mobile

Bare React Native POS client (`react-native@0.87.1`, no Expo). The app uses HTTPS GraphQL for
authoritative reads and commands and GraphQL WS only for scoped invalidation. The database and BMS
services remain the source of truth.

## Pairing by Admin QR (Android / iOS)

Open Admin **POS Devices** through a device-reachable HTTPS origin, select the register and confirm
**Issue token**. The one-time display now includes a locally generated QR containing the HTTPS
origin and the issued device credential (`bmspos://pair?t=...&h=...`). No external QR service is used.
In the mobile app, open **Device Settings > Scan QR to pair**. A valid scan calls the existing
server verification and secure-storage flow automatically; a different existing credential requires
confirmation first. Cashier PIN/RBAC and unresolved offline-cash guards still apply.

QRs are bearer credentials, not one-use tickets: closing the modal removes the displayed QR but
does not revoke its token. Do not share screenshots. Only the token hash is retained by the backend;
an existing token cannot be redisplayed. Issuing another token invalidates the old one immediately.
HTTP/loopback Admin origins do not offer a mobile QR. Both devices must reach the advertised HTTPS
origin and trust its certificate. Manual link/token entry remains available; externally opened deep
links still only prefill Settings and require Save.

The QR action uses the existing native QR scanner separately from product lookup. Invalid QR,
cancelled scans and late results after leaving Settings do not change pairing. The native scanner
requires a supported iOS device with camera access (iOS 16+) or Android Google Code Scanner/Google
Play services availability; unavailable scanners fall back to manual entry. Validate camera access,
first pairing, replacement/cancellation, offline cash and relaunch on physical Android/iOS devices
before release. Windows cannot verify an iOS native build.

Detailed recheck on `codex/mobile-qr-pairing` (2026-11-03) also covers:

- Admin double-issue prevention, cache-free credential handling and truthful clipboard failure;
- field-level query permissions, including a device-manager role without staff/product read access;
- transactional token rotation and audit with server-derived tenant/editor/actor;
- malformed bootstrap identities/errors, HTTP 401 versus 403/5xx, failed secure-storage writes and
  incompatible pending cash; only a verified, stored token reports success;
- credential redaction before status display, diagnostic persistence and restored-queue delivery;
- navigation remaining on Settings after a rejected first-pair candidate, while a revoked saved
  credential still clears the cashier and resets navigation;
- rejecting pairing QR/token inputs on product/stock scanners before calling a SKU resolver.

The three previously failing source-text contracts were updated to verify the current safeguards:
queue validation both before and after verification, full versus partial return statuses, and the
release script's dynamically selected schema version. No product behavior was weakened to satisfy
the old assertions. These checks do not certify physical cameras or a native iOS build. Docker's
engine was unavailable during this recheck, so token transaction tests use the real compiled service
and tenant helper with a simulated database transport; actual PostgreSQL RLS/grants/trigger execution
still require the disposable-database runbook before release.

Final automated results for this recheck: Mobile TypeScript and **386 tests / 48 suites** passed;
Desktop **91 tests** passed. Web `npm run gate` passed TypeScript, **3,343 pure tests** (2 existing
opt-in tests skipped, 0 failures), and the production build. The production Admin browser smoke
passed **9 scenarios** at 1440/390/320 px, including device-only permission, denied permission,
HTTP origin, failed/empty/malformed issuance, explicit retry, duplicate clicks, clipboard behavior,
QR screenshot decoding and modal cleanup. Android `:app:assembleDebug` and production-mode Metro
bundles for both Android/iOS passed. `adb devices` found no connected device. No deployment,
physical-camera certification or native iOS build is implied by these results.

A second lifecycle recheck on the same date fixes pending replacement confirmations when Settings
loses focus, rejects stale camera results even when the pairing target or availability changes and
then returns to its original value, and releases the parent's busy state when a responsive layout
unmounts the scanner. Late callbacks from an old confirmation or scanner cannot complete a new
attempt or clear its busy state. Four additional regression tests reproduce these cases. Fresh
validation passed Mobile TypeScript, **390 tests / 48 suites**, targeted scanner ESLint, and
production-mode Android/iOS Metro bundles. The native/device/PostgreSQL limitations above remain;
Web gate, Desktop tests and Android native build results refer to the preceding recheck.

## Feature recheck 2026-11-12

Reviewed the implemented native feature inventory against the screens/providers, generated GraphQL
operations, shared services and existing contracts: pairing/PIN and permissions; catalog/scanners;
cart, payment, receipts and returns; shifts/drawer; offline recovery and realtime; restaurant floor,
checks, incoming orders and kitchen; board-game sessions/queues; inventory transfers/counts; settings
and LAN printing. This is source/build/regression coverage, not physical-device acceptance or a claim
that every backend database transition has been exercised.

| Gap found | Correction |
| --- | --- |
| Kitchen tickets dropped the server's size/modifier codes; cancelled or unknown statuses became new work | Preserve and display size/options/notes, and show only the supported ticket statuses |
| Rapid taps could overlap stock, kitchen, shift, restaurant and board-game commands before React rerendered | Synchronous in-flight guards, released on success or failure |
| Missing/null/blank stock-count or incoming-order cancellation status discarded the retry key | Treat an incomplete result as unknown; keep the same request identity for a retry |
| Successful shift, kitchen, restaurant or board-game service-call commands could appear to fail if a follow-up read failed | Keep the confirmed server outcome; query errors still belong to the read surface |
| A newly opened table bill depended on a successful refresh to retain its ID | Retain the committed ID and route parameters before adding items; reuse that bill on the next action |
| Cash movement modal could close and clear its key while saving | Keep the modal and fields locked until the pending command finishes; failed attempts retain the draft/key |
| Only selected flows bounded their GraphQL operations | Apply the existing 15-second deadline to all HTTP GraphQL operations, abort the transport and discard late results, with no automatic mutation retry; WS subscriptions are unchanged |
| Shared operation timeout could wait forever when a transport/body parser ignored abort | Reject on an independent deadline and ignore late completion, preserving an unknown mutation outcome |
| Blank or whitespace cash/count fields became numeric zero | Require an explicit value for opening float, counted shift cash and stock-count quantities; an entered `0` remains valid |

New regression suites exercise the actual providers/screens and Apollo link, including duplicate taps,
incomplete responses, failed post-commit reads, pending-modal dismissal and transport cancellation.

The dependency follow-up refreshes compatible versions in the lockfile while keeping React Native
**0.87.1**, React **19.2.3** and the native dependency declarations unchanged. This includes
`shell-quote` **1.12.0**, GraphQL Codegen CLI **7.4.6**, navigation core **7.24.0**, and patched
compatible parser/validation dependencies. Navigation core no longer pulls the vulnerable
`query-string`/`decode-uri-component` chain. The checks below were rerun after this refresh.

Verification on this Windows checkout:

| Check | Result |
| --- | --- |
| Mobile `npm test -- --runInBand` | **443 tests / 58 suites passed** (baseline 405 / 51; 38 added regressions) |
| Mobile `npm run typecheck` and `npm run lint` | Passed |
| Web `npm run gate` in the original checkout | Passed typecheck, **3,529 DB-free tests (6 skipped)** and production build; installed Next.js was 14.2.5, so locked dependencies are checked separately |
| Web `npm run gate` in an isolated worktree with clean locked Web/realtime dependencies | Passed typecheck, **3,529 DB-free tests (6 skipped)** and production build on **Next.js 14.2.35** |
| Android `:app:assembleDebug` | Passed; development APK, not a signed store release |
| Android and iOS production-mode Metro bundles | Passed after the final screen changes |
| `git diff --check` | Passed |
| Physical device and native iOS checks | Not run: `adb devices` listed no devices; Windows has no Xcode |

Local logs are under repository-root `.test-output/mobile-audit-*` and `.test-output/cross-app-*`;
build output is ignored.
Existing hardware/platform exclusions below remain explicit: physical camera/HID/printer verification,
native iOS compilation on macOS, signed store builds, suspended-app push, global HID capture and
pharmacy evidence capture are not supplied by this audit. No production deployment or database write
was performed.

A read-only GraphQL regeneration validated every native operation against `schema.graphql`, but
the full generated-file comparison is **not clean**: the unused Admin helper
`SchemaMutationBmsSetPharmacistLicenseArgs` lacks `confirmed`, and
`SchemaQueryBmsPharmacyLicenseCandidatesArgs` is absent. No native operation uses these helpers.
The committed generated file was left unchanged under the repository instruction prohibiting changes
to generated artifacts; the comparison is saved in `.test-output/cross-app-codegen-diff.log`.
It is a remaining codegen maintenance item, not a passing drift check.

The Mobile dependency audit improves from **40 findings (1 critical, 20 high)** to **20 findings
(0 critical, 1 high, 10 moderate, 9 low)**. The remaining high item is the `image-size` parser used by
Metro at build time: Metro **0.87.0** requires `image-size ^1.0.2`, while the advisories are fixed
outside that range. It requires a supported Metro/RN migration rather than forcing a different
parser API into the current build. Remaining moderate/low findings are in the codegen, lint, test
and RN CLI tool chains. These are dependency findings, not proof of an exploitable installed app;
they remain unresolved. No forced dependency downgrade or override was applied. Before/after audit
JSON is saved under `.test-output/cross-app-mobile-dependency-audit*.json`.

The shared Web server also has unresolved dependency advisories, including a critical Next.js
finding. See the [Desktop release findings](../desktop/README.md#remaining-release-findings) for the
locked dependency audit and isolated verification. Native test/build results do not certify the
server's production security or exercise live database settlement/stock transitions.

## Backend connection recheck (2026-11-12)

Native HTTP GraphQL now shares a connection-error presentation contract with the Desktop compact
renderer. Messages separate failed reads from unknown writes, include a safe `POS_*` category and
HTTP status when known, and explain the next step. Raw network/parser/internal-server messages and
proxy bodies are not displayed. Server-composed PIN, permission, validation and business-rejection
messages remain intact; code, reason, path and variant-selection metadata remain available to callers.
HTTP 403 is not a logout, and no connection failure automatically repeats a business command.

Malformed successful GraphQL data is rejected rather than treated as confirmation. Mixed
decided/unknown GraphQL errors keep the idempotency key. Pairing body reads, WS-ticket minting and
diagnostic sends use independent deadlines even if the transport ignores abort; late pairing data
cannot save credentials. A stuck diagnostic batch no longer blocks later queued events.

Verification: **461 tests / 59 suites**, TypeScript, ESLint, and Android/iOS production Metro bundles
passed. The new tests cover auth/denial, rate limits, server errors, malformed responses, read/write
timeout guidance, privacy, late pairing responses and stalled diagnostic sends.
Logs: `.test-output/connection-*`. This does not exercise live
database commits, physical devices or native iOS compilation. Previous dependency and generated-type
maintenance findings above remain outstanding.

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
- server-backed sale-history search (receipt, customer/member, SKU and barcode), returning at most
  50 matching receipts rather than searching only the 50 most recently loaded receipts;
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
- bounded HTTP GraphQL operations so a dropped connection cannot leave native workflows spinning
  forever; uncertain mutations are never automatically retried;
- Emergency Offline Mode: an encrypted native queue for plain retail cash sales, with a persisted
  unknown/syncing/review state machine, device/branch/shift-bound request-integrity fingerprint,
  full-screen Sync Center, per-item/manual retry, original-cashier attribution, fail-closed secure
  storage, shift-close/unpair/re-pair guards, recovery of a committed result after shift close, and
  a synced badge in receipt history;
- restaurant dine-in and takeaway checks, variants/modifiers, floor/check operations, kitchen rounds,
  settlement, incoming-order review, QR queue, service calls, waitlist, and menu availability; the
  QR/call/waitlist reads stay active across tabs and drive the `คิว/QR` badge and alerts;
- pickup queue numbers for retail sales and restaurant takeaway: the branch policy or per-device
  switch requests a number only after a successful online settlement, prints it on the receipt,
  exposes PIN/RBAC-protected call/recall/collect/undo/cancel actions in the Sell screen, and offers a
  same-order retry when a committed sale could not issue its number. A failed queue read is never
  shown as an empty queue: stale actions pause until a successful refresh. Emergency Offline sales
  deliberately do not issue a number until the server owns the completed sale;
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
  foreground/reconnect recovery, and fallback polling while connecting, reconnecting or degraded.
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

The `start`, `ios` and `android` scripts default to Metro port **8082** because the Docker WS service
uses 8081. iOS uses React Native's host discovery and configured Metro port instead of forcing
`localhost`; a physical iPhone must be able to reach the development computer. For a custom Metro
port, pass the same `--port` to both the start and platform commands.

The `Mobile contracts` workflow (`.github/workflows/mobile-contracts.yml`) runs on every PR and
push to `main`/`develop`, including backend-only changes. It checks generated GraphQL types,
TypeScript, lint, and Jest; it does not build Android/iOS binaries or exercise real devices.
After updating `schema.graphql`, run `npm run graphql:codegen` here and include the generated diff
in the same change. CI runs `npm run graphql:check` to reject stale committed output.

Android release builds use the upload signing configuration only when the existing external
`secure/bms-pos-upload-key.properties` file is available. Without it the release artifact is
**unsigned**, never silently signed with the committed debug key. Debug builds retain debug signing.
Store credentials and signing keys outside source control; an unsigned artifact is not a distributable
release. Signed release, Play upload and TestFlight/archive verification remain separate checks.

## iOS and Android audit 2026-11-03

Branch: `codex/mobile-ios-android-audit`. This review covers native configuration, pairing and
authentication state, GraphQL contracts, catalog/scanner, checkout/returns, offline recovery,
realtime, history search and existing restaurant/board-game/inventory contracts. It is a code and
automated-test audit, not real-device certification or proof of every backend database transition.

### Corrections

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| iOS registered the pairing scheme but did not forward links received while the app was running | Forward `application(_:open:options:)` to `RCTLinkingManager` | Native code follows the [React Native linking contract](https://reactnative.dev/docs/linking); device smoke still required |
| The shared iOS scheme referenced a `BmsPosTests` target that does not exist in the project | Remove the dangling test-target reference | XML/project-reference inspection; this project still has no XCTest/UI-test target |
| iOS forced `localhost:8082` while default npm scripts started Metro on 8081; loopback also prevents host discovery on physical phones | Default all three scripts to 8082 and let React Native resolve the development host | CLI option/configuration inspection; physical-device debug launch still required |
| Android release silently used debug signing when upload credentials were absent | Leave release unsigned until upload credentials are supplied | Gradle configuration reviewed; signed release verification still required |
| A bootstrap response could pass the sequence check at headers, then finish JSON parsing after a newer rejection/unpair | Recheck the sequence after body parsing and before publishing verification | Delayed body cannot clear a rejection or persist a superseded pairing |
| An old health request could reject the newly paired device or publish stale online state | Abort and invalidate the old probe; isolate cleanup by generation; clear last-online evidence when pairing changes | Delayed header/body rejection, concurrent probe completion and rejected-token tests |
| Unpair checked pending offline cash only before the confirmation dialog | Recheck in `DeviceProvider.unpair()` immediately before removing credentials; storage-read failure also blocks removal | Pending cash and unavailable secure-storage tests |
| A socket stuck connecting/reconnecting did not receive HTTP fallback refreshes | Reconcile active reads every 30 seconds in these states as well as offline/degraded | Fake-timer tests for all connection states and cleanup |
| Counter actions and returns retained spent keys after decided GraphQL rejections; return/void also dropped keys on missing results | Clear keys on decided errors; preserve them for network/internal-server uncertainty and absent business results | Deposit, return and void tests covering decided errors, unknown failures and missing results |
| A successful counter action/return could be reported as failed when its follow-up read failed | Keep the committed outcome; do not reopen a completed return as a retryable failure | Successful deposit and partial-return tests with a rejected refresh |
| Sale-history search only filtered the latest 50 locally and could discard barcode matches | Send the search through the existing branch-scoped GraphQL service; retain its matches and 50-row bound | Search query, old receipt, barcode and clear-search tests |
| Secure storage unavailable at launch stayed unavailable after unlocking; incomplete saved credentials looked unpaired | Retry the same Keychain service on foreground, distinguish corrupt records from absent records, and ignore a late restore after explicit pairing changes | Locked/unlocked, corrupt/absent, unchanged token and late-restore tests |
| Same-frame taps could send duplicate counter/return commands before React disabled the button | Acquire a synchronous in-flight lock, including before exchange confirmations | Two-tap deposit and return tests failed before the fix and pass after it |
| An object with missing/null/empty operation status was treated as a decided rejection and released its key | Treat incomplete status as unknown and retain the original retry key | Three malformed deposit-result regressions |
| Pairing used the cash queue from before the network verification and could overlap unpair/storage writes | Re-read the queue before saving, reject overlapping pairing changes, cancel superseded checks and reverify when rejection arrives during the write | Late queue rows/read failure, concurrent pair/unpair, delayed queue rejection and delayed write rejection |

### Automated verification

| Check | Result |
| --- | --- |
| `npm run graphql:check` | Passed; generated output matches the committed schema |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test -- --runInBand` | 43 suites, 307 tests passed after the second review (baseline: 39 suites, 266 tests) |
| `node scripts/run-contract-tests.mjs pure mobile` from repo root | 97 tests passed |
| `node scripts/run-contract-tests.mjs pure react-native` | 9 tests passed |
| `node scripts/run-contract-tests.mjs pure offline` | 9 tests passed |
| Metro production JavaScript bundles for iOS and Android | Passed; this does not compile Swift/Kotlin/C++ or produce a signed app |
| Android `:app:assembleDebug` | Passed after the scanner staging fix and passed again on a second Gradle invocation; Debug APK contains scanner libraries for all four configured ABIs |
| Scanner `externalNativeBuildDebug` / `externalNativeBuildRelease` | Both passed for all four ABIs; Release here is the native scanner library, not a full release APK/AAB |
| Android APK checks | `apksigner verify --verbose` and `zipalign -c -P 16 4` passed; this is a debug-signed development APK |
| iOS native build/archive | Not run: Windows host has no Xcode |

Metro reports a dependency importing React Native's private feature-flag path and falls back to file
resolution; bundling succeeds. Do not equate the warning with native hardware compatibility.

On this Windows host, Android Studio's bundled OpenJDK 25.0.3 initially failed to establish the
Gradle loopback pipe. A short existing directory supplied through `-Djdk.net.unixdomain.tmpdir`
resolved it. The native dependency build also needed `--enable-native-access=ALL-UNNAMED` to avoid
a restricted-method warning interrupting the CMake/Prefab step. These were process-local build
options, not changes to machine settings or the application's runtime permissions. With `JAVA_HOME`
and `ANDROID_HOME` pointing at the installed JDK/SDK, the equivalent invocation from repository root is:

```powershell
New-Item -ItemType Directory -Force .test-output/java-tmp | Out-Null
$mobileJavaTemp = (Resolve-Path .test-output/java-tmp).Path
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$mobileJavaTemp --enable-native-access=ALL-UNNAMED"
Set-Location apps/mobile/android
./gradlew.bat :app:assembleDebug --no-daemon --console=plain -PreactNativeDevServerPort=8082
```

The scanner failure was traced to Windows path handling in SDK CMake 3.22.1's Ninja 1.10.2.
`ninja -d explain -n NitroDataScanner` reported the Nitro prefab config missing even though it
existed. In this checkout its unnormalized path (including `arm64-v8a/../prefab`) was 263 characters,
while the normalized path was 250. Root `android/build.gradle` now sets the scanner's
`externalNativeBuild.cmake.buildStagingDirectory` to `android/.cxx/scanner` on Windows. The same
dependency path becomes 232 characters, and the fresh scanner Debug native build passed for
`arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`; the full application then assembled successfully.
The second Gradle invocation also completed `:app:assembleDebug` and the scanner's
`:react-native-data-scanner:externalNativeBuildRelease` across all four ABIs. A direct Debug
`ninja -d explain -n NitroDataScanner` then reported `no work to do`, rather than regenerating CMake.
This uses the supported [AGP staging-directory setting](https://developer.android.com/reference/tools/gradle-api/9.0/com/android/build/api/dsl/Cmake#buildStagingDirectory(kotlin.Any))
outside temporary `build/` output. Background: [Ninja Windows long-path issue](https://github.com/ninja-build/ninja/issues/1900).
No generated Ninja file or scanner dependency source needs a manual edit, and non-Windows builds
retain their existing staging location. Very deep checkout roots can still require shorter paths.

The development artifact is `android/app/build/outputs/apk/debug/app-debug.apk`. It requires Metro
on port 8082 and is not the upload-signed release package. Do not uninstall an existing shop app to
work around a debug/release signing mismatch. Native scanner operation, camera permissions,
Google scanner UI availability and pairing retention still require a real-device upgrade test.

Build logs are retained locally in `.test-output/mobile-scanner-short-path.log`,
`.test-output/mobile-android-fixed-build.log` and `.test-output/mobile-android-recheck.log` at repository
root. Existing non-fatal AGP opt-out deprecations, dependency manifest/legacy API warnings, SDK
XML-version mismatch and DateTimePicker CMake object-path warnings remain visible in the logs.

### Pairing after an application update

`authenticatePosDevice()` checks the stored SHA-256 token hash and active device flag; device tokens
have no expiry and are not tied to an app version. Issuing a new token for the **same device** replaces
the hash and invalidates the old token. Updating the server against a different/restored database can
also change which token is recognized. These are distinct from an application update.

Mobile keeps the same `com.bms.pos.device` Keychain service. An update must preserve the application
identity/signing configuration and installed data; uninstalling/clearing data is not an upgrade test.
Do not remove the app to work around a signing mismatch, especially with accepted offline cash.
An unavailable Keychain/Keystore is shown as a storage problem; after unlocking and returning to the
app, restoration retries without deleting or reissuing the credential. Incomplete saved records also
remain intact for recovery. A late restore cannot undo explicit unpairing.

A red banner alone cannot identify the cause: record its text, HTTP status, app version, platform,
server host and whether the app was updated in place. Do not include tokens or PINs in diagnostics.
Check the existing pairing/connection status first; 401 needs device/URL/token investigation, 403
needs permission review, and network/5xx failures need connection/server recovery. Pending offline
cash must be resolved before removing pairing. See the Desktop README for OS-keystore recovery.

### Device and deployment checks still required

The audit host is Windows, has no Xcode, no Android emulator package, and `adb devices` returned no
attached device. Visual navigation, keyboard behaviour and native OS callbacks could not be exercised
here. Use a development tenant and complete the following on both a phone and a tablet where applicable:

1. Open pairing links from a terminated, backgrounded and foregrounded app. Confirm the expected
   host is displayed and pairing only occurs after the operator saves. Revoke/rotate the token;
   confirm denial is distinguished from a temporary outage and an ordinary permission denial.
2. Select a cashier, enter valid/invalid PINs, switch cashier and reopen the app. Check phone keyboard,
   tablet rotation, safe areas, Android Back, iOS gestures and receipt/checkout modal dismissal.
3. Scan with the camera and focused HID input; test denied camera permission, cancellation, CR+LF,
   pack/variant selection and unsupported devices. Android's scanner dependency uses Google's scanner
   UI; availability must be checked on the target device, including devices without Google services.
4. Run cash and split tender, rounding, discount second-person approval, park/resume, deposit, partial
   return, void and refund completion. Interrupt a request after sending; verify one server transaction
   and the original retry identity. Verify actual stock movements, payment and audit rows in a local DB.
5. Queue eligible retail cash while offline, restart, recover and sync; test wrong cashier/shift,
   corrupted or unavailable secure storage, shift-close and unpair denial. Restaurant/pharmacy/member
   and non-cash sales must not acquire offline eligibility. Never accept the same cash twice.
6. Drop WS while HTTP remains available, background/foreground the app, and restore connectivity.
   Check restaurant QR/service-call badges, kitchen tickets, board-game sessions and branch inventory.
7. Print Thai text and scan the receipt QR on real 58/80 mm printers. Test local-network denial on iOS,
   paper-out, cover-open, unplugged network and a partial write. No automatic reprint or cash-drawer kick.
8. Build/archive and verify release signatures, installation/upgrades and platform store submission
   separately. No production DB tests or store publication were performed by this audit.

Features still explicitly outside current delivery: Bluetooth/USB/AirPrint/IPP printing, global HID
capture outside the scanner modal, cash-drawer hardware, suspended/terminated-app FCM/APNs push,
offline PIN login/full offline catalog and pharmacy evidence capture/upload. These are product gaps,
not capabilities proven by a green Jest run. Native Wi-Fi printing remains a hardware pilot.

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
