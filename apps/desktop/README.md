# BMS POS Desktop

Windows, Linux and macOS desktop shell for the existing BMS POS surface. The backend remains
authoritative; this app does not contain a database or a second settlement path.

BMS Cloud and BMS Hybrid POS are one product. This desktop shell is currently a cloud-connected POS
surface within it; **Emergency Offline Mode is mobile-only**. The shell must not be sold as a local
server or full-offline register until it has an encrypted queue, the same server revalidation and
recovery guarantees, and its own failure-mode evidence.

## Current milestone (0.2)

- first-run server and device pairing;
- pairing verification through the existing device-scoped `/api/pos/session` endpoint;
- device token encrypted at rest with Electron `safeStorage` (Windows DPAPI, Linux Secret Service
  or KWallet, and macOS Keychain); Linux refuses Electron's insecure `basic_text` fallback;
- locked-down Electron window with context isolation, renderer sandboxing, origin checks, and a small
  allow-listed IPC bridge;
- the new `/pos/app` renderer uses the same cashier/shift/catalog/scan/sale GraphQL operations and
  platform-neutral flow, payment, pricing, timeout, and idempotency helpers as the iOS/Android client;
- first-class desktop flow: device verification → cashier PIN → shift gate → catalogue/scan → cart →
  payment/split payment → receipt;
- specialised flows that have not yet moved into the new renderer (returns, PO receiving, deposits,
  shift management, settings, restaurant and board-game operations) hand off to the existing
  server-authoritative POS routes. Nothing is hidden or duplicated, and settlement still has one path;
- a **pharmacy** register always sells in the full sell workspace, never the compact `/pos/app` sell
  screen: the pharmacist review queue, pharmacist PIN at the counter and clinical evidence live only
  there, and the compact screen sends every pharmacy field as null. The customer display follows
  whichever workspace is visibly selling;
- rollout is backward compatible: the first connection probes `/pos/app` with `HEAD` and falls back
  to `/pos` only when a paired pre-rollout server confirms HTTP 404; the selected route is stored
  beside the encrypted pairing so later launches open immediately, then refresh compatibility in
  the background for the next launch without replacing an active cashier screen;
- paired startup paints a local connection screen before probing the server, bounds the compatibility
  probe and page navigation with timeouts, and offers retry or re-pair recovery instead of leaving the
  native window on its background colour when the network or web deployment stalls;
- on macOS first-run setup, **เปิดระบบหลังบ้านบนเครื่องนี้** validates the installed Retail Local
  receipt and root-owned controller, starts the managed server when needed, and opens
  `/admin/pos-devices` in the system browser so the operator can create the pairing link without
  knowing a localhost URL; remote-server pairing remains the explicit URL/token flow;
- retail, restaurant, board-game, customer-display, and cashier-manual POS routes remain hosted in
  the desktop shell;
- one register owns at most one customer-display window: settings can keep it off, automatically use
  the first display other than the cashier screen, or remember one explicitly selected display;
  hot-plug changes are reconciled, the customer window has no preload/IPC bridge, and `/pos/app`
  publishes its cart and server-confirmed payment result over the existing same-device
  `BroadcastChannel`;
- Windows NSIS, Linux AppImage/DEB, and macOS DMG package configuration.
- fixed 100% renderer zoom on every platform and child POS window; Electron zoom shortcuts, wheel/
  pinch zoom, macOS trackpad pinch at Chromium startup, and menu roles are disabled while OS
  accessibility magnifiers remain available.
- across retail, Restaurant, and Board Game surfaces, `Command/Ctrl+R` refreshes authoritative data
  inside the current content workspace without destroying the shell, operator PIN or shift context;
  `Command/Ctrl+Shift+R` is labelled as the explicit full application reload for recovering a stuck
  screen. The same explanation appears in the POS help surface, and older web deployments fall back
  to a full reload when they do not expose the content-refresh bridge.
- restaurant provider/chat orders are polled from the existing device-scoped incoming-order API on
  every restaurant screen (including while the shift is closed), appear as a persistent rail badge and prominent action banner, and use
  the existing per-device sound settings. A newly actionable transition (accept, hand-off, expired/
  cancelled provider state, or failed/manual provider synchronization) can also flash the native taskbar and
  show a generic OS notification while the cashier window is unfocused; no provider, customer or
  order payload crosses that IPC boundary or appears on a lock screen. The cashier renderer remains
  active while minimized so realtime and bounded polling can still raise that attention. Provider
  terminal state and missed acceptance deadlines suppress stale accept/handoff controls, and the web
  workflow uses the existing cancellation/refund path; the native shell still owns no order action.

ESC/POS USB/LAN printing, cash-drawer control, signed releases, auto-update, and extending Emergency
Offline Mode to Desktop are separate rollout milestones.

## Develop

```powershell
cd apps/desktop
npm install
npm test          # pairing + keystore-policy units, no Electron needed
npm run lint
npm start
```

`npm run gate` in `apps/web` does not run these; run them from this directory when you change the
shell.

## Customer display

Connect the customer monitor as an **extended** desktop, not a mirrored screen. In the register,
open **Settings → Customer display** and choose off, automatic, or a specific connected display.
"Identify displays" places a temporary number on every screen. The shell detects display
add/remove/metric changes and restores the configured customer window when its target is available.

One register supports one cashier display plus at most one read-only customer display. Kitchen,
queue and menu-board screens are separate devices/surfaces rather than third and fourth windows of
the register. On Linux Wayland the compositor may refuse application-directed positioning; the
settings page reports that limitation so the operator can move the window manually.

The web renderer capability-checks these IPC methods. Older installed shells therefore keep the
manual customer-display button instead of crashing when a newer server is deployed; automatic
display selection appears after the desktop app itself is updated to 0.2.3 or newer.

When the cashier selects QR payment, the display can show the exact provider-issued QR configured
under **Admin → Settings → Receiving accounts**, together with the amount assigned to that QR
tender. A PromptPay ID by itself is display text, not authority to invent an EMV payload, so no QR
is generated until the shop supplies the real payload from its bank/payment provider.

For local development, the setup screen accepts `http://localhost:<port>`. Non-loopback servers must
use HTTPS because the device token is a bearer credential.

## Build and test on Linux

The supported first rollout is x64 Linux with a desktop keyring. GNOME sessions need Secret Service
(normally `gnome-keyring`/libsecret); KDE sessions need an unlocked KWallet. The app deliberately
blocks pairing when Electron selects `basic_text`, because that backend does not provide acceptable
protection for a bearer device token.

```bash
cd apps/desktop
npm install
npm run lint
npm test
npm run test:smoke
npm run pack:linux
```

The build writes both `BMS-POS-<version>-x86_64.AppImage` and
`BMS-POS-<version>-amd64.deb` to `apps/desktop/dist/`. AppImage is the portable pilot artifact; the
DEB is the managed install for Debian/Ubuntu deployments. Build production Linux artifacts on a
Linux CI runner even though electron-builder can prepare some Linux targets from other hosts: that
runner is where executable permissions, desktop integration, dependencies, and launch behaviour
can be verified together. `.github/workflows/desktop-linux.yml` provides a manual build and uploads
both packages as a 14-day workflow artifact; it deliberately does not publish or sign a release.

Linux release acceptance still needs a supported-distro matrix covering GNOME/KDE, Wayland/X11,
CUPS receipt printing, keyboard-wedge scanners, a second customer display, suspend/reconnect, and
keyring locked/unavailable states. AppImage/DEB packaging does not add offline tender or direct
ESC/POS/cash-drawer support.

## Build and test on macOS

The macOS build produces unsigned disk images for Intel and Apple Silicon. It supports macOS 12
(Monterey) or newer and shares the same Electron shell as Windows and Linux, but must be built and
exercised on a Mac. Keep the Electron major below 44 while Monterey remains supported: Electron 44
and newer require macOS 13.

```bash
cd apps/desktop
npm install          # pulls the darwin Electron binary for this machine
npm run lint
npm test             # pairing + keystore-policy units, no Electron needed
npm run test:smoke   # launches Electron, asserts the setup screen, writes dist-smoke/setup.png
npm start
```

What differs on macOS, and what it means for a test result:

- `safeStorage` is backed by the **macOS Keychain** instead of DPAPI. macOS asks for Keychain access
  the first time the device token is written; denying it makes pairing fail with a Keychain message,
  which is the correct behaviour, not a bug.
- A device token paired on Windows **cannot be read on macOS** and the reverse is also true. The two
  keystores are different, so the Mac has to pair the device again. Pairing state is not portable.
- The menu bar is the system menu on macOS, so `autoHideMenuBar` has no effect. The extra Electron
  menu is a platform difference, not a regression.
- Each platform can only be certified on itself. Windows-only behaviour — DPAPI, the NSIS
  installer, `AppUserModelId` taskbar identity — and Linux-only behaviour — the Secret
  Service/KWallet check, AppImage/DEB packaging, desktop integration — cannot be proven on a Mac,
  and Gatekeeper, the system menu bar and the Keychain prompt cannot be proven anywhere else. A pass
  on one host means the POS surface, pairing flow, IPC allow-list and window security are correct
  there; it certifies no other build.
- `npm run test:smoke` drives a stubbed preload that reports `win32`, so it asserts the Windows
  labels on every host. It checks the setup screen renders and fits; it does not exercise the real
  keystore of the machine it runs on.

The disk images must be built **on macOS** — electron-builder cannot produce a `.app` from Windows
or Linux:

```bash
cd apps/desktop
npm run pack:mac
```

The build writes `BMS-POS-<version>-arm64.dmg` for Apple Silicon and
`BMS-POS-<version>-x64.dmg` for Intel Macs to `apps/desktop/dist/`.

When this same client is embedded in the Retail Local `server-pos` package and is paired to the exact
managed origin `http://127.0.0.1:3100`, opening BMS POS also checks the local service. If launchd has
not started it yet, Desktop invokes only the root-owned `bms-retail-local ensure-running` controller
and waits for health before opening the register. This behavior never applies to a remote pairing,
to `localhost`, or to another port, so Desktop cannot silently change a cashier's selected server.
Before pairing, the same controller is available only through the macOS setup action that opens the
local POS-device administration page; it does not guess or replace a remote server URL.
`.github/workflows/desktop-macos.yml` creates the two unsigned DMGs on a macOS runner after tests,
lint and the Electron setup smoke test, and keeps them as a 14-day workflow artifact.

The image is unsigned, so Gatekeeper blocks the first launch. This is suitable only for internal
testing. Open it from Finder with right-click → Open, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/BMS POS.app"
```

## Build the Windows installer

```powershell
cd apps/desktop
npm run pack:win
```

The unsigned installer is written to `apps/desktop/dist/`. Production distribution still requires a
Windows code-signing certificate and a release/update policy; the Linux AppImage/DEB and the macOS
DMGs are unsigned for the same reason and have no update channel either. A signed macOS release
additionally needs an Apple Developer ID and notarization — the macOS workflow runs with
`CSC_IDENTITY_AUTO_DISCOVERY` off so a runner holding no certificate still builds deterministically,
which keeps every artifact internal-test only until those decisions are made.

`.github/workflows/desktop-windows.yml` builds the NSIS installer on a Windows runner and uploads it
as a 14-day internal-test artifact. Windows, Linux and macOS jobs intentionally package on their own
operating systems; one host's passing build is not evidence for another host's keystore or installer.
