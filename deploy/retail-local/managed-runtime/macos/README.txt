BMS Retail Local Server for macOS Apple Silicon

This package installs the complete Retail Local server payload and a private virtual-machine
runtime. Docker Desktop is not required and is not used on the target Mac.

After installing the package:

1. Open Applications > BMS Retail Local.
2. Enter the shop name and initial administrator credentials.
3. Wait for the Web, WebSocket, PostgreSQL, and Redis health checks.
4. Open http://127.0.0.1:3100/admin/login.

Useful commands:

  bms-retail-local status
  bms-retail-local doctor
  bms-retail-local stop
  bms-retail-local start
  bms-retail-local logs
  bms-retail-local backup OUTPUT.age AGE_RECIPIENT

The private VM and shop data are stored in the setup user's Library/Application Support directory.
Removing the installer files does not implicitly delete shop data.

Technical pilot limitations:

- Apple Silicon and macOS 15 or newer only.
- At least 8 GiB RAM and 12 GiB free disk; 30 GiB free is recommended for updates and backups.
- The package is unsigned and not notarized.
- Run clean-install, restart, backup/restore, peripheral, and power-loss acceptance checks before
  considering this build for production use.
