# BMS Retail Local

Commercial self-install development is tracked separately in
[Retail Local Managed Runtime](retail-local-managed-runtime.md). It is an incubating Windows
WSL2/Moby and Ubuntu systemd/Moby delivery layer; it does not replace the self-contained technical
pilot package until its install, update, backup, restore, and failure-mode gates have evidence.

`BMS Retail Local` is a deployment profile of the existing BMS codebase, not a second POS, database
model, or settlement engine. The technical pilot runs one shop on one Windows host. Electron or a
browser connects to `http://127.0.0.1:3100`; the same Web/API services remain authoritative for
price, stock, permission, payment, tax documents, and audit.

## Current supported boundary

- one installation, one provisioned tenant, one `MAIN` branch, and one initial `POS-01` device;
- retail archetype (`mini_mart`) only for the first-run profile;
- local PostgreSQL, Redis, Web, WebSocket, and file storage packaged with Docker Compose;
- portable test ZIP with prebuilt application/PostgreSQL/Redis images and SHA-256 verification;
- deterministic ordered migrations with checksums and an advisory lock;
- first-run tenant/admin/PIN/device provisioning in one database transaction;
- database + storage + secret backup, guarded restore, start/stop/status, and backup-before-update;
- loopback-only published ports. PostgreSQL and Redis are never published to the LAN;
- no Cloud replication. The database on this host is the sole source of truth.

Internet-dependent capabilities (AI providers, email, chat channels, payment terminals, carriers,
delivery platforms, and e-Tax providers) still require the internet and their real provider
configuration. Local deployment is not a promise that those external services work offline.

## Build a test package

On a development machine at the repository root:

```powershell
pwsh .\deploy\retail-local\package.ps1 -Version 0.1.0-pilot.1
```

This produces a ZIP and a `.sha256` file under `artifacts/retail-local/`. The ZIP contains prebuilt
Web, WS, PostgreSQL and Redis images; the target machine does not need the repository, Node.js, npm,
or internet access to fetch images. The Web image contains the exact init schema and migrations used
by its migration runner. The checksum detects corruption or modification but is not a publisher
signature.

## Install (technical pilot)

Prerequisites: Windows 11, PowerShell 7, Docker Desktop running, enough free disk space, and a tested
UPS for the host.

Verify the ZIP checksum, extract the complete folder to a stable local path, start Docker Desktop,
then double-click `Install-BMS-Retail-Local.cmd` or run `pwsh .\install.ps1`. The installer runs a
preflight check, validates and loads the image archive, creates local secrets, migrates/provisions,
waits for both Web and WS to become healthy, then performs HTTP health checks. Running directly from
source remains supported for development; in that mode the installer builds the images locally.

The installer asks for the shop name, owner identity, password, and POS PIN. It generates every
database/application secret locally, loads the packaged Web/WS images (or builds them in source-dev
mode), applies all migrations, provisions the shop atomically, and starts the stack. The POS pairing
token is displayed once and is stored in the database only as a SHA-256 hash. Paste it into BMS POS
with server URL `http://127.0.0.1:3100`; Electron stores it in the OS keystore.

The generated `.env.local` contains encryption/signing keys. It is ACL-restricted by the installer,
git-ignored, and must never be emailed or committed.

Use [the installation test checklist](../../deploy/retail-local/TEST-INSTALL.md) on a clean Windows
machine. `doctor.ps1` checks secret presence without printing values, Compose/service health, HTTP,
the migration ledger, the installation singleton, and writable storage. `uninstall.ps1` keeps data
by default; its permanent test reset requires both `-EraseData` and the exact confirmation text.

## Operations

```powershell
.\start.ps1
.\status.ps1
.\doctor.ps1
.\stop.ps1
.\backup.ps1
.\update.ps1
```

`start.ps1` refuses to start Web/WS if migrations fail. `update.ps1` takes a backup before building
or migrating. Backups contain the database, stored files, and the secrets needed to decrypt channel
credentials; the backup directory therefore needs encrypted removable media or another encrypted
destination.

Restore is intentionally explicit and destructive to the current local database:

```powershell
.\restore.ps1 -BackupDirectory 'D:\BMS-Backup\20260924-120000' -ConfirmRestore
```

The existing storage directory is moved aside with a timestamp before the restored archive is
expanded. Do not delete that retained directory until the restored store has been reconciled.

## Migration authority

`apps/web/scripts/retail-local-migrate.mjs` is the Retail Local migration authority. It is packaged
inside the Web image together with `db/init.sql` and `db/migrations/`, so a target install never reads
schema SQL from a source-tree bind mount. It:

1. takes a database advisory lock;
2. applies the base schema and numbered SQL in numeric order;
3. inserts the authoritative legacy role migration before `1.24` and excludes the incompatible dead
   role migration, rollback, destructive cleanup, and tenant-specific pharmacy template;
4. strips only standalone transaction-wrapper lines, then applies each migration and its history row
   in one transaction;
5. records SHA-256 checksums and refuses to continue if an already-applied file changes.

Do not replace this with `db/schema_full.sql`; that generated file was not an applied-migration
ledger and historically missed the BMS migration chain.

## Release gates still open

This is an unsigned ZIP technical pilot, not yet a consumer-ready signed `.exe` installer.
Commercial self-install release still requires:

- signed Windows bootstrapper and signed Electron installer;
- automatic updater with tested application + schema rollback policy;
- supported printer/scanner/drawer matrix and real hardware certification;
- power-loss, disk-full, forced-restart, backup corruption, and restore drills;
- encrypted off-host backup transport and retention policy;
- remote diagnostic/support workflow that never exports secrets or raw customer data;
- licensing/device-transfer policy and a documented support lifecycle;
- a decision on whether Docker Desktop remains a customer prerequisite or is replaced by a managed
  service/appliance runtime.

Do not advertise Retail Local as generally available until those gates have evidence. In particular,
do not describe the current Electron package as containing the server: it remains a keystore-backed
client window around the authoritative local Web service.
