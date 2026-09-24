# BMS Retail Local — installation test

This package is an unsigned technical pilot. Test it on a Windows 11 machine that does not contain
the BMS source tree. Do not use real customer data during the pilot.

## Machine prerequisites

- Windows 11 64-bit with current updates;
- PowerShell 7 (`pwsh`), Docker Desktop with WSL 2, and hardware virtualization enabled;
- at least 8 GB RAM (16 GB recommended) and 15 GB free disk;
- ports `127.0.0.1:3100` and `127.0.0.1:3101` free;
- a UPS before testing with data that matters.

Verify the downloaded ZIP before extracting it:

```powershell
Get-FileHash .\BMS-Retail-Local-<version>.zip -Algorithm SHA256
Get-Content .\BMS-Retail-Local-<version>.zip.sha256
```

Extract the whole directory to a stable local path such as `C:\BMS-Retail-Local`. Do not run it
directly from inside the ZIP, a OneDrive-synchronised folder, or removable media.

## Install acceptance test

1. Start Docker Desktop and wait until its engine is ready.
2. Double-click `Install-BMS-Retail-Local.cmd` or run `pwsh .\install.ps1`.
3. Enter a test shop, owner email, password and 4–8 digit POS PIN.
4. Record the POS pairing token shown once; do not put it in the test report.
5. Confirm that `http://127.0.0.1:3100/admin/login` opens and the owner can sign in.
6. Run `pwsh .\doctor.ps1`; every row must say `PASS`.
7. Pair the POS with `http://127.0.0.1:3100`, open a shift, create a product and stock, make one
   cash sale, print/fallback-print a receipt, return it, and close the shift.
8. Run `pwsh .\stop.ps1`, disconnect the internet, run `pwsh .\start.ps1`, and repeat a plain retail
   cash sale. Provider-backed AI/email/payment/carrier/e-Tax features are not part of this offline test.
9. Create a backup on encrypted external storage with `pwsh .\backup.ps1 -Destination <path>`.
10. Change a test product, then restore the backup with
    `pwsh .\restore.ps1 -BackupDirectory <path> -ConfirmRestore`. Confirm the original product and
    receipt history return and `doctor.ps1` remains all-PASS.
11. Reboot Windows. Confirm Docker starts, all four services recover, and the last committed sale is
    still present.

## Failure report

Run the following and attach `doctor.json`. It contains service state and counts, not secret values:

```powershell
pwsh .\doctor.ps1 -Json > doctor.json
```

Record the package version from `release.json`, Windows/Docker Desktop versions, the exact failed
step, time, hardware model, printer/scanner model, and whether power/network was interrupted. Never
attach `.env.local`, `secrets.env`, a database dump, pairing token, customer data, or unreviewed logs.

## Reset the test machine

Normal uninstall keeps data for reinstall:

```powershell
pwsh .\uninstall.ps1
```

Erase the test database and local storage only after the backup test is complete:

```powershell
pwsh .\uninstall.ps1 -EraseData -ConfirmationText ERASE-BMS-LOCAL
```

Database volumes are then permanently removed. Local env/storage files go to the Windows Recycle
Bin; backups are deliberately retained and must be removed separately when no longer needed.
