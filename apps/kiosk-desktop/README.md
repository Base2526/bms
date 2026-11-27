# BMS Desktop Kiosk (assisted pilot)

Standalone Electron shell for the existing `/kiosk/[token]` customer page. It is
not Desktop POS and cannot accept proposals, settle checks or print receipts.

## Provisioning

1. Manager: at `/admin/restaurant-floor`, select the branch, register one
   active kiosk device, copy the one-time device credential and set a 6–8 digit
   maintenance PIN. Cashier PINs remain at `/admin/pos-devices`.
2. Cashier on a paired POS with an open shift and `restaurant.floor.manage`:
   issue the public customer URL in `/pos/restaurant` → Kiosk.
3. IT on the touch machine: install **BMS Kiosk**, enter the public URL and
   dedicated device credential. The app checks the active URL and device belong
   to the same branch before opening the customer renderer. The credential is
   encrypted using Electron `safeStorage` in the app's own `userData` directory.
4. Open local settings with `Ctrl+Alt+K` at the machine, enter the maintenance
   PIN, then change the URL. The PIN prompt and local settings lock after two
   minutes. Leaving settings starts a fresh customer session so the previous
   cart and status cannot return. A recovery screen offers staff settings
   through the same PIN.

The guest renderer has no preload, IPC bridge, POS session or cashier PIN. It
allows only the exact bound URL. The app verifies the shop and branch before a
separate staff confirmation saves the configuration. It blocks extra windows,
downloads, permissions and navigation. Network/PIN verification failures do
not unlock settings. A revoked/rotated URL or device closes the customer page;
a transient heartbeat failure does not discard an in-progress customer cart.
Customer state is held in an in-memory Electron partition, not disk. The server
checks the device credential, current PIN revision and branch URL again when
binding a screen, including after a PIN or credential change.
Native load callbacks are bound to their own window: a page that finishes
loading late cannot hide a PIN/recovery screen or revive an earlier guest.
The screen distinguishes wrong branch, URL rotation, PIN change or missing PIN,
request throttling (429), unavailable shared rate limiting (503), network
timeout, server error, secure-storage failure and renderer crash. A 429 is not
a PIN lock; staff should wait and retry, while a locked PIN requires the
manager's back-office action or the lock interval to expire.
Catalog images may come from external URLs. The Web kiosk sets `no-referrer` and
the native guest session removes `Referer` on external requests so its public
URL token is not sent to an image host; broken images use the Web fallback.

## Windows pilot machine

- Use a dedicated standard OS account for customers and a separate IT
  administrator account. Record the Windows edition/build, touch monitor,
  resolution, scaling and OS policy in the pilot checklist. The packaged app
  attempts per-user launch registration at sign-in; a real
  logout/login and reboot test is still required.
- Electron fullscreen does not lock Windows. For an Electron desktop app,
  evaluate [Shell Launcher](https://learn.microsoft.com/windows/configuration/shell-launcher/)
  on a supported Enterprise/Education/IoT Enterprise edition and add explicit
  lockdown policy; Shell Launcher has no default lockdown rules. Microsoft
  describes [Assigned Access](https://learn.microsoft.com/windows/configuration/kiosk)
  for Edge/UWP single-app or a restricted multi-app experience. Do not assume
  that Pro Assigned Access can directly host this Electron app as a single-app
  kiosk. IT must select and test the OS policy for the actual edition before
  customers use the screen. Shell Launcher and Assigned Access cannot both be
  configured on one system.
- Install the Windows x64 package under IT supervision, select the customer
  touch display as primary, calibrate all corners, test 100/125/150% scaling,
  virtual keyboard (Thai/English), reboot and network recovery. Test Alt+Tab,
  Alt+F4, Windows key, touch gestures and a newly attached USB keyboard under
  the chosen OS policy. POS pairing and printer credentials do not belong on
  the kiosk account.
- Upgrade with the same OS account; verify encrypted configuration survives
  and the active URL still binds. Test a rollback installer separately before
  approving a version. A reinstall does not prove config recovery by itself.
- To retire a machine: disable the public URL from POS, revoke the kiosk device
  in the back office, confirm pending proposals have been handled, then have
  IT uninstall the app and remove its dedicated `userData` record and OS
  account according to the shop's retention policy. Never copy the encrypted
  record to a different OS account as a recovery shortcut.
  On Windows, the encrypted record is under the kiosk account's
  `%APPDATA%\BMS Kiosk\kiosk-device.enc.json`. Only IT should rename this file
  during reprovisioning; preserve a protected copy for diagnosis until the
  manager confirms the replacement device credential works.

## Recovery

If the OS secure-storage key is unavailable, the app remains in recovery and
does not delete the encrypted record. IT must sign in to the machine with an
OS administrator account and restore the OS credential store or reprovision
the machine with a new credential issued in the back office. If a device
credential was rotated, the old one cannot verify the PIN; IT reprovisions
under OS administrator control. There is no hardcoded fallback PIN. Before
staff re-enter an order after any outage, search its request code in POS to
check whether the original proposal/check already committed.

## Verification

```sh
npm ci
npm run lint
npm test
npm run test:smoke
npm run test:integration
npm run pack:win
```

`test:smoke` is a local Electron renderer fixture. `test:integration` runs the
real native main against a local FAKE HTTP server in a temporary OS data
directory, including a transient outage and device revocation. Both write
screenshots to
`.test-output/kiosk-desktop-shell/`. It is not a physical USB-touch, restored-DB,
KDS, printer, cash or receipt acceptance test. See
`docs/business/restaurant-kiosk-pilot-checklist.md` for the live gate.
## Download and release gate

The branch manager downloads a published Windows x64 installer from
`/admin/restaurant-floor` → select branch → **Kiosk device / maintenance PIN**
→ **Install BMS Kiosk**. `restaurant.floor.manage` and branch scope are checked
again by the download API. Only a platform administrator uploads a draft and
publishes it for a branch. Android/iOS public app links and Retail Local POS
packages are separate release channels. The customer kiosk page has no download.

After a customer submits a request, the branch manager can search its visible request code at
`/admin/restaurant-floor` under **Track kiosk requests**. This read-only view distinguishes a
pending proposal, an accepted check and a paid POS sale, with the check's current order, receipt
and pickup number when present. It does not authorize acceptance or payment. If the read fails,
staff verify the code and bill in the paired POS before entering anything again.

The platform administrator records the SHA-256, uploads the NSIS `.exe` as a
draft, and checks the actual stored bytes and Authenticode signature before
publishing. A locally built unsigned installer remains a draft; it is **not**
available to a shop. After download, IT compares the downloaded SHA-256 to the
back-office value (`Get-FileHash -Algorithm SHA256`) and verifies Authenticode
(`Get-AuthenticodeSignature`) reports `Valid`, then checks the signer against
the approved BMS signing identity. A filename or uploaded checksum alone does
not prove a signature. The current package has previously reported `NotSigned`;
signing, verification and installation on the actual pilot machine remain
release gates.

For upgrade or rollback, IT uses an explicitly published and signed version,
records its checksum, installs under the same OS account, and verifies that the
encrypted configuration survives and the URL/device still bind. A hidden
release is no longer downloadable; ask the platform release administrator for
an approved version. If download or verification fails, do not install the
file or switch to a public mirror. Keep POS ordering available while IT resolves
the release. The private release store must be durable across web instances;
local ephemeral container storage is insufficient for this route.
