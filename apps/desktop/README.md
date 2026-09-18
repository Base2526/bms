# BMS POS Desktop

Windows desktop shell for the existing BMS POS surface. The backend remains authoritative; this app
does not contain a database or a second settlement path.

## Current milestone

- first-run server and device pairing;
- pairing verification through the existing device-scoped `/api/pos/session` endpoint;
- device token encrypted at rest with Electron `safeStorage` (Windows DPAPI);
- locked-down Electron window with context isolation, renderer sandboxing, origin checks, and a small
  allow-listed IPC bridge;
- retail, restaurant, customer-display, and cashier-manual POS routes hosted in the desktop shell;
- Windows NSIS installer configuration.

ESC/POS USB/LAN printing, cash-drawer control, signed releases, auto-update, and offline tender are
separate rollout milestones.

## Develop

```powershell
cd apps/desktop
npm install
npm test
npm run lint
npm start
```

For local development, the setup screen accepts `http://localhost:<port>`. Non-loopback servers must
use HTTPS because the device token is a bearer credential.

## Test on macOS

Windows remains the deployment target, but the shell itself is plain Electron and runs on macOS, so
the app can be exercised on a Mac when no Windows machine is available.

```bash
cd apps/desktop
npm install          # pulls the darwin Electron binary for this machine
npm run lint
npm test             # pairing unit tests, no Electron needed
npm run test:smoke   # launches Electron, asserts the setup screen, writes dist-smoke/setup.png
npm start
```

What differs from Windows, and what it means for a test result:

- `safeStorage` is backed by the **macOS Keychain** instead of DPAPI. macOS asks for Keychain access
  the first time the device token is written; denying it makes pairing fail with a Keychain message,
  which is the correct behaviour, not a bug.
- A device token paired on Windows **cannot be read on macOS** and the reverse is also true. The two
  keystores are different, so the Mac has to pair the device again. Pairing state is not portable.
- The menu bar is the system menu on macOS, so `autoHideMenuBar` has no effect. The extra Electron
  menu is a platform difference, not a regression.
- Windows-only behaviour — DPAPI, the NSIS installer, `AppUserModelId` taskbar identity — cannot be
  proven here. A macOS pass means the POS surface, pairing flow, IPC allow-list and window security
  are correct; it does not certify the Windows build.

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
Windows code-signing certificate and a release/update policy. A signed macOS release would need an
Apple Developer ID and notarization, which is a separate decision from the Windows rollout.
