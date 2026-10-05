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
- first-run setup on **Windows, Linux and macOS** shows a quiet link under the pairing field,
  "ยังไม่มีลิงก์? …", whose target is decided by the main process, never the renderer. When this
  machine runs BMS Retail Local (macOS installation receipt, or a 1.5-second probe of the fixed
  loopback `/admin/login`) it reads **สร้างจากระบบหลังบ้านบนเครื่องนี้**: the app checks the local
  `/admin/login` (eight-second limit, no credentials or redirects) and opens `/admin/pos-devices`
  in the system browser, which still requires the normal admin login. On macOS it first validates
  the receipt/root-owned controller and starts the managed server when needed; Windows/Linux use
  the service already started by the installer, never elevate or execute a user-writable startup
  script. Otherwise (a POS-only machine) it reads **สร้างจากระบบหลังบ้าน BMS** and opens the cloud
  login `https://bms.jachoei.com/admin/login`. Only the local target fills an empty Server URL, and
  neither ever overwrites a remote URL or pairing link;
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

### Operator-initiated update notification

The `/pos/app`, `/pos/restaurant` and standalone `/pos` headers have a download icon in Desktop
only. Pharmacy uses the full sell workspace embedded in `/pos/app`; embedded workspaces do not
mount a second update menu. Restaurant keeps the menu across floor, kitchen and settings screens,
using its existing light/dark palette. The shared menu supports Thai and English and owns its
outside-click/Escape dismissal independently of the host header. A coloured dot indicates a newer public,
non-internal `pos` installer marked `latest` in `/admin/retail-local-releases` on the paired server.
The read-only `/api/retail-local/desktop-update` endpoint compares semantic versions (including
pilot versions), excludes server/combined, hidden and trial-only packages, and matches the shell's
OS and architecture. The uploaded POS version must match the packaged Electron app version;
a bootstrap or server release number is not a Desktop version.

Checks run at startup, every 30 minutes while visible, and on focus/reconnect (five-minute
throttle). The icon and popover are rendered only after a check finds a newer eligible release.
No release, an up-to-date version, an unknown version, or a failed check hides the entire control;
background checks continue so a later published update can appear without restarting the app.
Operators can check again in the available-update popover. Older shells without architecture
metadata require an explicit platform choice. No user-agent CPU guessing.

The operator's download link opens the existing public release download in the system browser.
It does not stop the register, install bytes, change pairing or restart the app. The cashier
finishes selling and opens the installer themselves. This is a manual-download notification,
not an in-app updater or a Retail Local server/runtime update. No forced minimum version is added.
Local installations see releases published on their paired server; no cloud fallback is assumed.

`scripts/desktop-update-browser-smoke.mjs` exercises the real Next routes with browser-only fixtures:
retail, pharmacy embedded/standalone, restaurant PIN-to-floor navigation and operational screens,
mobile bounds, explicit downloads, errors, old shells, browser-only hiding and English/dark mode.
Run with the dev server on port 3000 and Playwright available (or set `BMS_PLAYWRIGHT_MODULE` to
its module path). This does not test native installation or write shop data.

The `/pos/app` register uses a light-only palette. Its nested Ant theme and select popups
stay light even when the saved app theme or OS preference is dark; the global preference and
Restaurant POS theme are unchanged. `scripts/desktop-pos-theme-browser-smoke.mjs` verifies
member search and board-game copy selection on that real route using browser-only fixtures,
including light/dark/system preferences, desktop/mobile widths and portalled dropdowns.
It uses the same dev-server and Playwright environment as the update smoke above.

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
open **Settings → Customer display**, enable **เปิดจอลูกค้าเมื่อเปิด POS**, and choose automatic
or a specific connected display. On an unconfigured installation, the shell offers to enable the
customer display once after detecting a second monitor. Both acceptance and refusal are remembered;
an existing explicit off setting is never overridden. Enabled displays reopen on app startup.
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

The web-owned display uses a branded welcome, recent items, payment and completed-sale layout.
It clears completed bills after ten seconds and hides sensitive data after eight seconds without
a valid cashier snapshot. No shell rebuild is needed for these web layouts. Run
`npm run test:customer-display` for a sandboxed Electron check of all four states, responsive
viewports, QR rendering, local reconnection, completion expiry and member privacy.

## Receipt printer

In **Settings → เครื่องพิมพ์ใบเสร็จ**, select an OS-installed printer and 58 or 80 mm paper, then
save. The receipt screen also exposes these settings. Print sends one copy directly to that exact
printer without the OS selection dialog. Settings are local to the workstation and survive restart.
Save changes before using **พิมพ์ทดสอบ** to queue a clearly labelled non-receipt test page.
The cashier then confirms whether the paper actually came out and is readable. A spool callback
alone never confirms that. A printer whose driver exposes no status requires that confirmation
before receipt printing; it is remembered for the saved printer/paper combination.

The cashier surfaces share one status poll (every five seconds and on window focus), disable
receipt/reprint buttons while checking, busy, missing, unhealthy or awaiting a test result, and
show the reason with **ตรวจสอบอีกครั้ง** and **พิมพ์ทดสอบ** beside the receipt. Keyboard-triggered
printing follows the same guard. Known offline/paper-out/jam/paused states block test jobs too;
after fixing the device, refresh its status to re-enable testing. A failed receipt job stays blocked
until a new test is confirmed. Sales/payment remain available regardless of printer readiness.

Native preflight repeats this check before queuing, even if the UI was stale. Windows status uses
the [Winspool flags](https://learn.microsoft.com/en-us/windows/win32/printdocs/printer-info-2);
macOS/Linux use [CUPS state/reasons](https://www.cups.org/doc/cupspm.html). Driver reports can lag
or omit physical failures; neither polling nor a successful test guarantees a future job. The UI
does not claim real-time hardware certification. Older native bridges lacking health reporting
show an update-required warning and disable direct receipt printing.

Only the paired cashier main frame (`/pos`, `/pos/app`, `/pos/restaurant`) may call printer IPC.
No HTML, URL, credential, or document payload is accepted from IPC arguments: the shell captures
only the existing server-backed `#pos-receipt` DOM, waits for images/fonts, and prints a sandboxed
hidden window with no preload or POS storage partition. It never calculates or settles money.
The print document embeds the app's bundled Thai font and does not depend on OS Thai font support.
A missing saved printer, failed image load, or driver error is visible and never silently selects
another printer or opens a fallback dialog. Concurrent jobs are rejected; timeouts instruct the
cashier to inspect the queue before retrying, because a spool acknowledgement is not proof of paper.
Existing authorized WebUSB drawer kicks remain separate from native receipt printing.

Older shells and ordinary browsers keep the existing WebUSB/browser-dialog flow. Deploying only
the web app cannot add native printer support: rebuild/update the desktop shell too. Direct ESC/POS
USB/LAN from the main process remains a separate milestone. Physical printer/driver combinations
still require hardware acceptance testing on each supported OS.

`npm test` includes mocked print failures, timeouts, duplicate clicks and frame authorization.
`npm run test:receipt-smoke` renders the real receipt/settings in Electron at 58/80 mm and
desktop/mobile widths, exercises mock controls, and writes screenshots to `dist-smoke/` without
sending anything to a physical printer (requires the web app's development dependencies).

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

The DEB must not rely on anything a minimal Debian/Ubuntu install lacks, because `apt` then reports
success while the app cannot start or cannot be read:

- `build.deb.depends` restates electron-builder's default Depends list (setting the key replaces it)
  and adds `libasound2t64 | libasound2`. The Electron binary links `libasound.so.2`, the default list
  omits it, and Ubuntu 24.04 renamed the package with the `t64` suffix.
- The setup and startup pages ship IBM Plex Sans Thai (SIL OFL 1.1, `renderer/fonts/`) instead of
  naming a font the OS may not have; without it every Thai glyph renders as an empty box. It is the
  same face `/pos` self-hosts through `next/font`.

`test/packaging.test.mjs` pins both rules. Verified 2026-10-01 on WSL Ubuntu 24.04 with no Thai
font and no ALSA preinstalled: `apt` pulled `libasound2t64`, `ldd` reported no missing library,
both pages loaded the bundled Thai faces, and install → remove → purge left no files behind.
WSL does not run AppArmor, so the profile install/removal in the maintainer scripts is still
unverified there.

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

Every electron-builder target runs `scripts/verify-packaged-app.cjs` after packing. It compares
the actual `app.asar` renderer/IPC source bytes and app version against the build source and fails
on drift. This does not refresh an already published online payload: a desktop change also needs
a new `desktop.artifact`, newly signed manifest with its new digest, and publication of that release.
Rebuilding only the small online bootstrap still downloads the old app from the old manifest.

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
