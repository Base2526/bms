BMS Retail Local Server for macOS

This package installs the complete Retail Local server payload and a private virtual-machine
runtime. Docker Desktop is not required and is not used on the target Mac.

After installing the package:

1. Setup should open automatically in Terminal.
2. If it does not open, open Applications > BMS Retail Local manually.
3. Enter the shop name and initial administrator credentials.
4. Wait for the Web, WebSocket, PostgreSQL, and Redis health checks.
5. Open http://127.0.0.1:3100/admin/login.

Useful commands:

  bms-retail-local status
  bms-retail-local doctor
  bms-retail-local stop
  bms-retail-local start
  bms-retail-local logs
  bms-retail-local backup OUTPUT.age AGE_RECIPIENT
  bms-retail-local uninstall
  bms-retail-local uninstall --erase-data --confirm ERASE-BMS-RETAIL-LOCAL

For a guided uninstall, open Applications/BMS Retail Local Uninstall.command and choose whether to
keep recovery data or permanently erase it after verifying a backup.

The private VM and shop data are stored in the setup user's Library/Application Support directory.
Removing the installer files does not implicitly delete shop data.
The plain uninstall command only stops and unregisters startup so the shop can be recovered. Use
--erase-data only after a verified backup when this Mac should permanently forget the shop.

Technical pilot limitations:

- macOS 15 or newer only. Use the arm64 package for Apple Silicon and the x64 package for Intel.
- At least 8 GiB RAM and 12 GiB free disk; 30 GiB free is recommended for updates and backups.
- The package is unsigned and not notarized.
- Run clean-install, restart, backup/restore, peripheral, and power-loss acceptance checks before
  considering this build for production use.
