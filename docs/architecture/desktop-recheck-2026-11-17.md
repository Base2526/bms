# Desktop POS recheck — 17 November 2026

Scope: `apps/desktop/` on Windows, Linux and macOS, plus its `/pos` web bridge. This is a
code/package/test audit from an Apple Silicon Mac. It is not hardware or three-OS certification.

## Findings resolved

1. `pack:win` selected the build host's architecture despite the x64 target in the builder config.
   On this ARM Mac it produced a Windows ARM64 installer. The script now passes `--x64` explicitly;
   a package contract guards it. The corrected build produced an x64 Electron executable and NSIS
   installer. The accidental ARM64 installer from this audit was removed from `dist/`.
2. Managed customer and queue displays retried rejected network loads, but Chromium could resolve
   `loadURL()` on an HTTP 5xx document. The main process now retries only a 5xx main document for
   the matching managed display, every five seconds. It ignores failed subresources and other
   windows, and closes the retry registration with the window. A lifecycle regression test covers
   this case.
3. The customer-display smoke expected one literal space in a summary. The rendered copy contained
   the correct count with two text-node spaces. The smoke now waits for the requested viewport and
   checks the words/count with whitespace tolerance; all phases and viewports pass.

## Verification performed

| Surface | Result | Evidence and limit |
| --- | --- | --- |
| Desktop units and syntax | Pass | `npm test`: 155/155; `npm run lint`: pass. |
| macOS Electron | Pass | Setup/startup smoke, synthetic Keychain encryption/decryption, 58/80 mm receipt rendering, customer display, managed display, queue board/manager, and restaurant hover/kitchen/service/header smokes. A separate Chrome setup smoke checked Windows/Linux/macOS labels, local/cloud links, language and compact layout. These use fixtures, not live orders or physical peripherals. |
| POS web boundary | Pass | 54 desktop-filtered pure contracts. Eight desktop browser smokes covered checkout summary, refresh, failed unpair, update discovery, changing prices, theme, scan selection and loyalty with mocked device/API responses across desktop and compact widths. No live sale was submitted. |
| macOS packages | Pass | Intel and Apple Silicon DMGs built from current source; `afterPack` verified packaged bytes/version. Both DMG checksums verified and mounted with `app.asar`; Mach-O architecture matches the filename. Builds were unsigned as configured. |
| Linux packages | Partial pass | x64 AppImage and amd64 DEB built with packaged-source verification. The DEB installed in a disposable Ubuntu 24.04 x64 container; Electron stayed running under Xvfb for the 12-second check. The AppImage SquashFS payload extracted with `AppRun` and `app.asar` present. No GNOME/KDE, keyring, CUPS, Wayland or physical display check was possible there. |
| Windows package | Partial pass | Corrected x64 NSIS build passed packaged-source verification; the enclosed Electron binary is PE x86-64. Installer and app have no Authenticode certificate. Native Windows install/start, DPAPI and printer checks were not run. |

The Docker web development container was OOM-killed during one browser smoke attempt. It was
restarted; the timed-out smoke and the remaining desktop browser smokes passed on rerun.
The compact setup, nine-line customer display and 58 mm receipt captures were also inspected
visually; their key text and controls were readable without obvious clipping. A screenshot is not
evidence of physical paper output.

## Remaining acceptance work

- Run the Windows workflow on a Windows runner and verify installed NSIS launch, pairing/DPAPI,
  login at startup, sleep/reconnect, HID scanning and the target OS printer driver.
- Run the Linux workflow on native x64 GNOME and KDE (X11 and Wayland where supported), including
  keyring locked/unavailable states, AppImage/DEB startup, CUPS, display hotplug and suspend.
- Launch the installed macOS app from both DMGs, exercise Gatekeeper behaviour for these unsigned
  pilot artifacts, and test camera, external display, printing and reconnect on real hardware.
- Signing/notarization, an update policy and production hardware verification remain prerequisites
  for distribution beyond the internal pilot.
- The package version remains `0.2.14-pilot.10`. These locally built files are verification
  outputs; publishing this change needs a new version and the Retail Local signed manifest/artifact
  update described in the desktop README.
