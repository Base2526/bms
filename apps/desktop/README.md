# BMS POS Desktop

Windows and Linux desktop shell for the existing BMS POS surface, with a macOS test build. The
backend remains authoritative; this app does not contain a database or a second settlement path.

## Current milestone

- first-run server and device pairing;
- pairing verification through the existing device-scoped `/api/pos/session` endpoint;
- device token encrypted at rest with Electron `safeStorage` (Windows DPAPI, Linux Secret Service
  or KWallet, and macOS Keychain); Linux refuses Electron's insecure `basic_text` fallback;
- locked-down Electron window with context isolation, renderer sandboxing, origin checks, and a small
  allow-listed IPC bridge;
- retail, restaurant, customer-display, and cashier-manual POS routes hosted in the desktop shell;
- Windows NSIS, Linux AppImage/DEB, and macOS DMG package configuration.

ESC/POS USB/LAN printing, cash-drawer control, signed releases, auto-update, and offline tender are
separate rollout milestones.

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

## Test on macOS

Windows and Linux are the deployment targets, but the shell itself is plain Electron and runs on
macOS, so the app can be exercised on a Mac when neither machine is available.

```bash
cd apps/desktop
npm install          # pulls the darwin Electron binary for this machine
npm run lint
npm test             # pairing + keystore-policy units, no Electron needed
npm run test:smoke   # launches Electron, asserts the setup screen, writes dist-smoke/setup.png
npm start
```

What differs from Windows/Linux, and what it means for a test result:

- `safeStorage` is backed by the **macOS Keychain** instead of DPAPI. macOS asks for Keychain access
  the first time the device token is written; denying it makes pairing fail with a Keychain message,
  which is the correct behaviour, not a bug.
- A device token paired on Windows **cannot be read on macOS** and the reverse is also true. The two
  keystores are different, so the Mac has to pair the device again. Pairing state is not portable.
- The menu bar is the system menu on macOS, so `autoHideMenuBar` has no effect. The extra Electron
  menu is a platform difference, not a regression.
- Windows-only behaviour — DPAPI, the NSIS installer, `AppUserModelId` taskbar identity — and
  Linux-only behaviour — the Secret Service/KWallet check, AppImage/DEB packaging, desktop
  integration — cannot be proven here. A macOS pass means the POS surface, pairing flow, IPC
  allow-list and window security are correct; it does not certify either shipped build.
- `npm run test:smoke` drives a stubbed preload that reports `win32`, so it asserts the Windows
  labels on every host. It checks the setup screen renders and fits; it does not exercise the real
  keystore of the machine it runs on.

A macOS disk image can be built for hand-off to another Mac. This must run **on macOS** —
electron-builder cannot produce a `.app` from Windows:

```bash
cd apps/desktop
npm run pack:mac
```

The image is unsigned, so Gatekeeper blocks the first launch. Open it from Finder with right-click →
Open, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/BMS POS.app"
```

## Build the Windows installer

```powershell
cd apps/desktop
npm run pack:win
```

The unsigned installer is written to `apps/desktop/dist/`. Production distribution still requires a
Windows code-signing certificate and a release/update policy; the Linux AppImage and DEB are
unsigned for the same reason and have no update channel either. A signed macOS release would need an
Apple Developer ID and notarization, which is a separate decision from the Windows/Linux rollout.
