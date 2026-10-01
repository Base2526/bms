BMS Retail Local Server for macOS

This is the small Server-only online bootstrap. It contains no Ubuntu image, service image, Docker
engine, or POS application. The first setup requires an internet connection and downloads only the
server components from a signed BMS release. Interrupted downloads resume, and every component is
checked against the publisher signature and SHA-256 before use. Docker Desktop is not required on
the target Mac.

After installing the package:

1. Open Applications > BMS Retail Local.
2. Keep the Mac online while Setup downloads and verifies the release.
3. Enter the shop name and initial administrator credentials.
4. Wait for the Web, WebSocket, PostgreSQL, and Redis health checks.
5. Open the back office at http://127.0.0.1:3100/admin/login.
6. Install BMS POS Desktop separately on each cashier machine and pair it to this server.

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

- macOS 15 or newer on Apple Silicon or Intel; install the package matching the Mac architecture.
- At least 8 GiB RAM and 12 GiB free disk; 30 GiB free is recommended for updates and backups.
- The package is unsigned and not notarized.
- Run clean-install, restart, backup/restore, peripheral, and power-loss acceptance checks before
  considering this build for production use.
