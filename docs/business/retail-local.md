# BMS Retail Local

Commercial self-install development is tracked separately in
[Retail Local Managed Runtime](retail-local-managed-runtime.md). It is an incubating Windows
WSL2/Moby, Ubuntu systemd/Moby, and macOS Apple Virtualization Framework/Lima delivery layer. The
macOS Apple Silicon full installer is an internal technical pilot whose clean-machine evidence,
signing, notarization, update, and recovery gates are still open; none of these
paths replaces the self-contained technical pilot package until its install, update, backup,
restore, and failure-mode gates have evidence.

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

## macOS Apple Silicon full installer

Build the internal full-server package on an Apple Silicon development Mac:

```bash
deploy/retail-local/managed-runtime/macos/build-pkg.sh --version 0.4.0-internal.1
```

The resulting `BMS-Retail-Local-VERSION-arm64.pkg` contains the pinned Ubuntu VM image, Lima runtime,
private Moby engine, Compose, age, and all ARM64 BMS service images. The target Mac needs macOS 15 or
newer, Apple Silicon, at least 8 GiB RAM and 12 GiB free disk (30 GiB recommended); it does not need Docker Desktop,
Homebrew, Node.js, or the source repository. This package is intentionally large because it carries
the server payload instead of downloading it after install.

After installing the `.pkg`, the operator opens `Applications/BMS Retail Local.app`, enters
the first shop/admin details, and waits for migration, provisioning, and health checks. Runtime data
stays under that operator's `~/Library/Application Support/BMS/RetailLocal`; the system package owns
only immutable runtime/payload bytes. The launchd agent starts the private VM for that operator after
login. Operational commands are `bms-retail-local status`, `doctor`, `start`, `stop`, `logs`, and
`backup OUTPUT.age AGE_RECIPIENT`.

For a `server-pos` install, the operator then opens `BMS POS` and selects
**เปิดระบบหลังบ้านบนเครื่องนี้**. Desktop starts the trusted local runtime if necessary and opens the
POS-device administration page in the system browser (through login when required). The operator
creates a pairing link there, returns to BMS POS, and pastes it into the first-run form. No localhost
URL needs to be memorized; a cashier using an off-machine server keeps the normal explicit server URL
and pairing-token flow.

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

This is an unsigned ZIP technical pilot, not yet a consumer-ready signed `.exe` or `.pkg` installer.
Commercial self-install release still requires:

- signed Windows bootstrapper, signed/notarized macOS server package, and signed Electron installer;
- automatic updater with tested application + schema rollback policy;
- supported printer/scanner/drawer matrix and real hardware certification;
- power-loss, disk-full, forced-restart, backup corruption, and restore drills;
- qualification evidence for the Managed Runtime encrypted off-host scheduler, retention/failure
  reporting, and a replacement-machine sample restore;
- remote diagnostic/support workflow that never exports secrets or raw customer data;
- production deployment/operations evidence for the fail-open licensing evidence receiver,
  duplicate review/device transfer, and a documented support lifecycle;
- signed/notarized qualification of the private macOS Lima/VZ runtime as the supported replacement
  for Docker Desktop on Apple Silicon.

Do not advertise Retail Local as generally available until those gates have evidence. In particular,
do not describe the current Electron package as containing the server: it remains a keystore-backed
client window around the authoritative local Web service.

## Website release downloads

The public `/retail-local` page reads installer releases from
`bms_retail_local_release_assets`. Platform admins publish those rows from
`/admin/retail-local-releases` by uploading the exact installer, setting its platform, package type,
version, minimum OS, release notes, and deciding whether that asset is `latest`.

Each platform has three independent package types:

- `server-pos` is the recommended combined installer for a one-computer store;
- `server` installs only the authoritative Retail Local services on a dedicated host;
- `pos` installs only BMS POS Desktop on an additional cashier device and must be paired to an
  existing Retail Local Server.

The package type describes delivery, not a new runtime boundary. A combined installer still installs
the existing server and client components; POS Desktop never owns a database or alternate sales rules.

Release platforms are deliberately architecture-specific: `windows-x64`, `ubuntu-x64`, and the
experimental `macos-arm64`. Windows packages use `.exe` and Ubuntu packages use `.deb`. On macOS,
`server` and `server-pos` use Apple Installer packages (`.pkg`), while `pos` uses the existing POS
Desktop disk image (`.dmg`). Intel Mac packages are not currently accepted on this page.

The uploaded bytes are stored through the shared storage driver and kept as private `files` rows.
Public users download through `/api/retail-local/download/[id]`, which serves only non-hidden Retail
Local assets with `Content-Disposition: attachment` and the stored SHA-256 header. Do not point the
public page at `/api/files/[id]` directly.

Release status controls the website:

- `latest` is the primary download button for that platform and package type; only one asset per
  `(platform, package_type)` may be latest.
- `supported`, `legacy`, and `deprecated` remain in the archive for controlled rollback or
  diagnostics.
- `hidden` is not listed and cannot be downloaded from the Retail Local endpoint.

The older env-based URL knobs remain as a temporary **server-only** fallback for deployments that
have not migrated to managed release uploads yet:

```text
RETAIL_LOCAL_WINDOWS_DOWNLOAD_URL=https://downloads.example.com/BMS-Retail-Local-Setup.exe
RETAIL_LOCAL_UBUNTU_DOWNLOAD_URL=https://downloads.example.com/bms-retail-local-bootstrap_VERSION_amd64.deb
RETAIL_LOCAL_MACOS_DOWNLOAD_URL=https://downloads.example.com/BMS-Retail-Local-VERSION-arm64.pkg
```

If no managed release exists for a platform, a valid HTTPS fallback URL may enable the button. An
unset or invalid URL leaves that platform's download button disabled; the page must not invent a link
or fall back to an unversioned file. Older releases stay outside the primary download action because
an in-place downgrade may be incompatible with the installed schema.
