# Passenger Motorbike sandbox — 2026-10-18

The user confirmed **motorcycle passenger rides**, referencing Grab/Bolt interaction patterns.
This is not a rename of parcel Delivery. Existing goods-delivery APIs/payment-before-dispatch
remain unchanged. Debug Customer/Driver apps now open **BMS Go** and **BMS Driver** by default;
the button “กลับไปโหมดส่งสินค้าเดิม” retains the original delivery surface. Release remains locked.

## Implemented scope

- Local test registration/login for RIDER/DRIVER, test display name and driver vehicle plate.
  Username normalization reuses the pure BMS identity helper. Passwords use salted async scrypt.
  Opaque eight-hour sessions are hashed in PostgreSQL, revocable at logout, and stored in isolated
  device-only Keychain/Keystore. This is **not** phone/email verification, KYC, or production auth.
- Driver online/offline, bounded nearby-request feed, one active trip per rider/driver, race-safe
  acceptance. Only online/idle drivers within 5 km, with a Simulator fix <=60 seconds old and
  accuracy <=100 m, see/accept requests. Acceptance rechecks eligibility inside the transaction.
  Going offline does not abandon an accepted trip.
- Google Maps SDK/search/pin selection wiring and foreground OS Simulator location are now included:
  see [maps setup and limitations](passenger-maps.md). Five labeled Bangkok **test places** remain
  a separate fixture list, never presented as Google results. Server-priced five-minute quotes use one
  explicit Google Routes `TWO_WHEELER` road distance with no straight-line fallback. Sandbox rate:
  20 THB + 8 THB per started road kilometre, 100 m–50 km. This is not Grab/Bolt pricing or
  turn-by-turn navigation. All money uses integer satang.
- The quote review uses a Service Catalog image (not a live driver's motorcycle photo) and exposes
  `แนะนำ` / `เร็วกว่า` / `ถูกกว่า` ranking views. Only Motorbike is currently enabled, so all three
  views honestly show that one service. Availability comes from online, idle drivers with fresh GPS
  inside 5 km. `เร็วกว่า` uses the lowest Google Routes `TWO_WHEELER` road ETA across at most the
  five nearest eligible drivers; `ถูกกว่า` uses the exact server-priced payable amount, never the
  lower edge of a display range. With zero eligible drivers the create-trip action is disabled and
  the rider can refresh availability. Raw candidate coordinates never leave the sandbox server.
- `SEARCHING → ACCEPTED → AT_PICKUP → IN_PROGRESS → AWAITING_PAYMENT → COMPLETED`.
  Either participant may cancel before travel starts. Only the assigned driver advances travel;
  only the owning rider pays, only after arrival. No parcel/POD/merchant state is reused.
- **Internal payment simulator**, selectable successful/declined outcomes. Decline remains payable.
  Success atomically writes a sandbox receipt, completes the trip and increases driver gross test
  receipts once. No real gateway, card input, webhook, charge, payout, fee split or tax document.
- Server-restored current trip, three-second foreground polling, latest 30 history entries, durable
  commands stored before I/O. Lost replies keep the original key across restart/reauthentication.
  Client state never independently declares a ride paid/completed.

## Start backend (preserve existing data)

```bash
cd /Users/s0mkidd/Desktop/Projects/bms
npm ci
npm run dev:ride
```

Keep running. On first use, macOS Keychain securely prompts once for the restricted Places and Routes
server keys; later runs load them automatically. The launcher starts/waits for PostgreSQL and Redis,
configures Android forwarding when `adb` has an authorized target, safely replaces its own old port
4200 process, reads the existing infrastructure `.env` without printing it, applies pending Fleet
migrations including `0018`/`0019`, then serves `http://127.0.0.1:4200` using the application DB role.
No data reset, no `down -v`, and no key is written to `.env` or source.
It refuses `NODE_ENV=production`; the deployed Delivery API does **not** mount these routes.

## Start iOS apps

Customer Metro, in its own terminal:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/fleet-delivery-customer
npm ci
# First setup only: npm run ios:pods
npm start -- --port 8088
```

Driver Metro, another terminal:

```bash
cd /Users/s0mkidd/Desktop/Projects/bms/apps/fleet-delivery-driver
npm ci
# First setup only: cd ios && bundle exec pod install && cd ..
npm start -- --port 8089
```

In separate terminals run `npm run ios` in **each app directory**. If multiple simulators exist,
use `npm run ios -- --udid <simulator-id>`. `--no-build` reuses an already built current native
Debug shell. Both apps coexist on one simulator; switch using Home. Each uses its own ad-hoc
simulator-only Debug Keychain identity. Device/Release signing is not configured by this change.

## Android emulator / USB Android debug

With both Metro servers running, `npm run dev:ride` already configures these forwards for every
authorized Android target. The commands below are only a manual recovery option:

```bash
adb reverse tcp:4200 tcp:4200
adb reverse tcp:8088 tcp:8088
adb reverse tcp:8089 tcp:8089
cd /Users/s0mkidd/Desktop/Projects/bms/apps/fleet-delivery-customer
npm run android -- --port 8088
cd /Users/s0mkidd/Desktop/Projects/bms/apps/fleet-delivery-driver
npm run android -- --port 8089
```

For multiple devices select the intended device explicitly in adb/RN CLI. Only HTTPS or loopback
HTTP origins are accepted. Physical iPhone testing needs signing and a secure reachable endpoint;
the local launcher intentionally does not expose the host to the LAN.

## Full manual flow — no scenario runner

Use only fake names/plates and passwords not reused elsewhere.

1. Driver: register; select **เปิดพร้อมให้บริการ (ทดสอบ)** and **ใช้ตำแหน่ง OS Simulator (foreground)**.
   Set a simulated Bangkok location near pickup and grant permission. Keep Driver foreground on a
   second simulator; backgrounding now stops location, so one simulator cannot keep both apps live.
2. Customer: register; API stays `http://127.0.0.1:4200`.
   The home service grid exposes **Motorbike** and **Go Send** as real actions: Motorbike starts
   this passenger flow, while Go Send returns to the existing parcel-delivery flow. **Rides** and
   **Schedule** are visibly disabled as **เร็ว ๆ นี้** until their own vehicle and scheduled-booking
   backend contracts exist.
3. Select **Motorbike** or **ไปที่ไหน?**. On the simulator the app reads a fresh current location
   into the pickup field, then focuses **ไปที่ไหน?** for the destination. Each populated field has
   its own clear control; clearing pickup returns to pickup search and **ใช้ตำแหน่งปัจจุบัน**.
   Choose/confirm pickup and drop-off. Confirming drop-off requests the Google motorcycle road
   route and price.
4. Review the road polyline, distance, duration and fare; select **เลือก Motorbike**, confirm.
   Status SEARCHING.
5. Driver: wait for polling; select **รับงานนี้ · ไปรับผู้โดยสาร**, confirm.
6. Select **ถึงจุดรับผู้โดยสารแล้ว**, confirm. Customer sees AT_PICKUP.
7. Select **รับผู้โดยสารแล้ว · เริ่มเดินทาง**, confirm.
8. Select **ถึงปลายทาง · จบการเดินทาง**, confirm. AWAITING_PAYMENT, not yet paid.
9. Customer: optionally select **ทดสอบชำระไม่สำเร็จ**, confirm. Trip must remain payable.
10. Select **จ่าย sandbox**, confirm. Both show completion. **ประวัติ** shows the same trip,
    fare and test receipt. Driver gross test receipts increase once.
11. Restart/log in again: server history persists. On lost reply, use **ลองส่งคำสั่งเดิมอีกครั้ง**
    before a new command. Never clear Keychain to discard a pending payment command.

Also test: no online driver, pre-pickup cancellation, post-start cancellation denial, offline while
assigned, competing drivers, double taps, wrong roles, quote/session expiry, network failure,
and cross-account/tenant access denial.

## Security and verification boundary

Prior passenger baseline, **before the maps follow-up**, verified locally on 2026-10-18: root gate
(60 pure tests, typecheck, API/worker build), local DB/API
5/5 without skips, Customer Jest 10/10 and Driver Jest 10/10, both mobile typechecks, Android
Debug/unsigned Release builds for both apps, and Driver locally signed iOS Debug build. Customer
and Driver ran on the same iOS 26.1 Simulator: separate test registrations, Siam → Lumphini quote
36 THB, request, online/accept, pickup/start/finish, declined payment then successful retry, and
Customer and Driver history showing the same persisted sandbox receipt, with Driver gross test
receipts of 36 THB. The Customer receipt also survived a UI reload. This is a simulator/manual UI exercise,
not a real ride, real payment or physical-device certification. No hosted CI result is claimed.

- `0018` adds six `ride_sandbox_*` tables in the separate Fleet schema; forced RLS and the existing
  tenant transaction helper apply. Tenant `sandbox:passenger-local` is fixed by the server, never
  accepted from a client. Audit/idempotency records commit atomically with mutations; the app role
  has no update/delete grant on those histories.
- The shared native view is in `apps/fleet-delivery-customer-core/native`, neutral transport in
  `src/rideSandbox.ts`. Each app resolves its own React/RN/Keychain runtime.
- Redis rate limiting fails closed, browser Origin requests are rejected, bodies are bounded,
  credentials are not logged. Test names/place labels are visible to authenticated test users;
  never put real passenger/driver PII here.
- API/DB regression: `apps/fleet-delivery-api/src/rideSandbox.integration.test.ts`, included in
  `npm run test:db` (explicit local test DB/Redis required). Root pure tests cover durable retry;
  Customer Jest covers registration/payment/release lock. Both apps typecheck the shared view.
- Historical Phase 9/10 approvals/evidence do not approve passenger service. Historical handoff
  checksums predate this change and must not be represented as current release evidence.

Still missing for real integration/release: verified phone/KYC, live Google credential verification,
road routing/navigation/ETA, approved real-device/background GPS, APNs/FCM, contact/SOS, payment-provider sandbox
credentials/integration/webhooks/refunds/reconciliation, driver settlement, production auth/device
trust, physical-device certification, signed distribution and passenger operating approvals.
These are separate engineering/integration work, not switches on this local simulator.
