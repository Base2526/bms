# Passenger maps / nearby matching — local sandbox

## Scope and gate

Both apps now include Google Maps SDK (`react-native-maps`), explicit Google Places search,
map-pin selection, Google Routes motorcycle routing and OS geolocation on **Debug
Simulator/Emulator only**. No provider fallback, fake-car animation, turn-by-turn navigation or
production ETA is claimed. Missing keys/provider errors appear in UI.
The Customer Route screen keeps pickup/drop-off in one editor, shows bounded suggestions with
straight-line distance, and opens a dedicated confirmation sheet. In pin mode the user drags the
map beneath a fixed centre pin; the selected coordinate updates only in memory until quote creation.
Confirming the pin makes one explicit server-side Google Routes `TWO_WHEELER` request. The returned
road distance is the sole distance used for the five-minute sandbox fare, the encoded provider
polyline is decoded with Bangkok bounds and drawn in green, and provider duration/warnings are shown.
Provider failure fails closed; it never draws or prices a straight-line fallback as a road route.

Real-device GPS remains disabled pending the existing Phase 4 Privacy/Legal approval packet.
Simulator source is a test claim, not device attestation. Release never mounts the sandbox.
The iOS device/Release plist still declares no location permission; only Debug Simulator uses
`Info-Simulator.plist`. Android Debug adds foreground permissions; Release removes all location
permissions. Background location is never enabled. These are not production-certified apps.

## Google configuration — existing project only

No cloud account, billing change, paid API enablement or key was created by this change. Use
restricted keys with quotas/billing alerts. Never paste keys into chat or commit them.

| Variable                          | Consuming process          | Restrict to                                                          |
| --------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `BMS_RIDE_GOOGLE_PLACES_KEY`      | `npm run dev:ride-sandbox` | Places API (New), server IP as applicable; server only               |
| `BMS_RIDE_GOOGLE_ROUTES_KEY`      | `npm run dev:ride-sandbox` | Routes API, server IP as applicable; server only                     |
| `BMS_GOOGLE_MAPS_IOS_API_KEY`     | `npm run ios`              | Maps SDK for iOS; Customer/Driver Debug bundle IDs                   |
| `BMS_GOOGLE_MAPS_ANDROID_API_KEY` | Android Gradle build       | Maps SDK for Android; Customer/Driver Debug packages + signing SHA-1 |

Debug identifiers: `com.bms.delivery.customer.debug`, `com.bms.delivery.driver.debug`.
The local ride launcher deliberately resolves provider hosts over IPv4 so the Routes/Places server
keys can use the public IPv4 returned by `curl -4 https://ifconfig.me/ip`. Do not whitelist a rotating
IPv6 privacy address, loopback, or a private LAN address for this launcher.
Use separate restricted keys, never embed the server Places/Routes keys in the app. The iOS runner forwards
its key through `SIMCTL_CHILD_...` at launch only, not JS or Xcode command arguments/logs.
Android embeds its SDK key in the Debug manifest; treat APKs/build logs accordingly.
An Android-restricted Maps SDK key cannot authenticate the server-side Routes request. Conversely,
never put the server Routes key into an APK. Reusing an existing key is valid only within the same
application-restriction type and after the required API has been explicitly allowed on that key.
These variables belong to the separate local launcher/native build, not deployed BMS Web/Compose.
Google Login client IDs are not Maps keys; no root `.env` is automatically repurposed.

The local launcher stores the two server keys in the signed-in user's macOS Keychain. On the first
run, the native `security` prompt asks for each value without echoing it or placing it in shell
history. Later runs load both keys automatically. Environment variables still take precedence for
temporary overrides and CI; secrets are never copied to `.env` or the repository.

Start the complete local backend preflight with one command:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms
npm run dev:ride
```

This starts/waits for the existing PostgreSQL and Redis volumes, configures `adb reverse` for every
authorized Android target, safely replaces only a previous listener whose command and working
directory prove it is this ride sandbox (including a shell job left stopped by Ctrl-Z),
applies migrations, and starts port 4200. It never runs `down -v`. `/healthz` reports whether both
provider keys are configured without exposing either value. An unrelated process on port 4200 is
never killed.

Similarly read/export `BMS_GOOGLE_MAPS_IOS_API_KEY` in each app's launch terminal, or
`BMS_GOOGLE_MAPS_ANDROID_API_KEY` before Android builds. Never loosen restrictions just to make
the sandbox work. SDK validity requires live map rendering; mock tests do not establish it.

## Setup and two-target test

1. Preserve local Postgres/Redis; run `npm run dev:ride` from repo root (starts the two dependencies,
   applies `0019`, and performs Android forwarding without a database reset). Start Customer Metro
   on 8088 and Driver Metro on 8089 as in the passenger guide.
2. Run `npm ci` in each native app and `pod install` in each `ios` folder. **Rebuild both apps**:
   Metro reload or an old `--no-build` shell cannot install map/geolocation native modules.
3. Use two existing simulator/emulator targets, one app per target. List iOS targets with
   `xcrun simctl list devices available`; launch each with `npm run ios -- --udid <target-id>`.
4. Set Driver simulated position to Siam: `xcrun simctl location <driver-target-id> set 13.7463,100.5347`.
   This is synthetic, not actual GPS. Test area latitude 13–15, longitude 99–102; outside is rejected.
5. Driver: register/login test account, go online, tap **ใช้ตำแหน่ง OS Simulator (foreground)**,
   allow foreground location. A latest fix is read/sent every 10 seconds, never queued offline.
6. Customer: read provider disclosure. The Route screen starts at pickup: choose the current OS
   Simulator location, a bounded suggestion, or submit **ค้นหาใน Google**, then confirm the fixed
   centre pin. Repeat for drop-off; a quote is not requested until both points are explicitly chosen.
   Use public landmarks only, not private home addresses.
   Search is explicit-submit only, no per-keystroke requests. Fixture places are clearly separate;
   displayed distance is straight-line selection guidance, not road distance or ETA.
7. Tap **ค้นหาคนขับใกล้จุดรับ (5 กม.)**. This returns count/nearest straight-line distance only,
   no stranger's exact location or identity. It is a point-in-time result, not a reservation/ETA.
8. Quote/confirm, driver accepts. Customer sees the assigned driver's fresh Simulator marker through
   3-second foreground snapshot polling. Continue arrive/start/finish/sandbox pay from the
   [passenger runbook](passenger-sandbox.md). Fare remains sandbox-only but uses the returned Google
   road distance: 20 THB + 8 THB per started kilometre.
9. Test far/offline/busy/stale drivers, denied permission, provider outage and direct API bypass.
   Background Driver: collection stops and clear is attempted; freshness independently excludes old
   fixes. Foreground again requires pressing the location button. No automatic background resume.

## Backend/privacy behavior

- `0019` adds latest `location`/`location_received_at` account columns and a partial online index.
  Existing tenant RLS/grants apply. Driver writes serialize on the account lock; no GPS in audit,
  durable commands, Keychain or logs. No location trail. Only source `SIMULATOR` is accepted.
- PostGIS selects online/idle drivers within 5 km with accuracy <=100 m and both capture/receive
  timestamps <=60 seconds old. Accept repeats the exact eligibility check in its locked transaction.
- Offline/logout clears latest fix. A 30-second local cleanup clears fixes older than 60 seconds
  (up to ~90 seconds while running); startup clears residue before serving. A stopped process cannot
  promise on-disk deletion, but stale rows are always excluded from reads/matching. This is **not**
  approved retention for real GPS. Simulator teleporting is permitted; no spoof-safety claim.
- Only driver self or that active trip's owning rider can see the assigned-driver fix. Completion
  removes live rider visibility. Nearby is rider-only and returns aggregates, never driver IDs.
- `/sandbox/places`, `/sandbox/quotes`, `/nearby`, `/location` authenticate and use server tenant context, body bounds,
  Origin denial and fail-closed rate limits. Places adds 10/account/minute, five results, fixed HTTPS
  endpoint, field mask, timeout, no redirects and no retry billing. Missing key fails closed.
- Quotes add a separate 10/account/minute Google Routes quota and request exactly one traffic-aware
  `TWO_WHEELER` route with a bounded field mask, timeout, no redirect and no automatic retry. The
  server—not the app—binds provider road distance to exact-satang fare and the idempotent quote.
  A provider rejection happens before the quote mutation; the client therefore clears only that
  failed pending quote and allows the rider to choose new points. Network loss after an accepted
  response still retains the original idempotency key.
- Provider search results are memory-only until selected. Selected endpoints persist in existing
  quote/trip/idempotency records. Before prolonged/live use, Legal must approve provider storage,
  attribution and endpoint retention/redaction terms. This does not authorize indefinite Google
  content storage or private passenger data. Physical GPS, public operation and production remain NO_GO.

## Verification

Backend tests cover near/far/stale/offline/busy drivers, direct acceptance denial, same-trip races,
other-rider location isolation, RLS, migration replay and the existing payment flow. Provider tests
mock Places/Routes HTTP (bounds/consent/errors/no-key/mode/field mask); native Jest tests cover
polyline decoding/drawing, opt-in, no-key UI, physical-GPS denial and background stop/no-auto-resume.
Actual Google live rendering/search/routing still requires configured keys.
Physical-device GPS and real navigation are not verified by simulator tests.

Verified locally on 2026-10-18:

- Root gate: typecheck, 64 pure tests and API/worker build passed.
- All five DB/API integration suites passed on a disposable local database with all 19 migrations
  applied first. The database was removed afterward; the main development database was preserved.
  Pre-migrate an isolated database before the full suite: older suites assume a ready schema and
  a running development worker can compete for claims in a shared database.
- Customer Jest 16 tests and Driver Jest 10 tests passed; both app typechecks and lint passed.
  Customer coverage includes the new Home → Route → pin confirmation → ride option sequence.
- Both iOS Debug ARM64 Simulator builds and both Android ARM64 Debug/unsigned Release builds passed.
  Native boundary checks passed; Android Release merged manifests have no location permissions.
- iOS Simulator manual checks: OS permission prompt, synthetic Siam position, customer pickup
  selection, truthful zero-nearby result, driver fresh fix reaching the server, clearing on Home,
  and no automatic location restart on returning to the app. This was not a simultaneous two-device
  end-to-end trip and not an Android emulator UI test.
- Production dependency audits reported zero advisories in both apps; this is not an all-dependencies
  audit claim. Driver dependency licence and supply-chain checks passed.

Still unverified: live Google map/search/road routing (keys not configured), physical devices,
turn-by-turn navigation and production readiness. Approved build-cache cleanup touched only generated outputs of the
two apps; it did not remove source, environment files, database or Simulator data.

Official references: [Maps setup](https://github.com/react-native-maps/react-native-maps/blob/master/docs/installation.md),
[Geolocation API](https://github.com/michalchudziak/react-native-geolocation),
[Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search),
[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Compute Routes](https://developers.google.com/maps/documentation/routes/compute_route_directions).
