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
- first-run selection of one supported shop archetype; the selected archetype is an onboarding
  preset, never an alternate price, stock, or settlement engine;
- `packages/retail-local-contract/shop-archetypes.json` is the versioned catalog authority. Offline
  packages carry that release's snapshot; Managed Runtime receives the same file as a signed,
  checksummed release component. Installers show only `enabledForNewInstall` entries that are not
  `deprecated`. Removing a type means deprecating/hiding it for new installs, never invalidating the
  stable id already stored by an existing shop. SaaS signup and later profile changes enforce the
  same new-selection rule, while the settings UI keeps an existing deprecated id readable;
- optional archetype-specific Starter Catalog: four inactive products with zero stock and no online
  sales surfaces, registered to one tenant-owned sample run for guarded all-or-nothing cleanup;
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
or internet access to fetch images. It also contains the archetype-catalog snapshot compatible with
those images. The Web image contains the exact init schema and migrations used by its migration
runner. The checksum detects corruption or modification but is not a publisher signature. An old
offline EXE deliberately keeps its old compatible snapshot; publish a new package to add a new type.

For an internal Windows pilot, wrap that verified payload in a single offline Inno Setup executable.
The combined variant embeds the existing x64 POS installer and starts it only after the server writes
its installation receipt:

```powershell
pwsh .\deploy\retail-local\windows-offline\build-offline-exe.ps1 `
  -Version 0.2.11 -PackageType all
```

This creates `Server`, `Server + POS`, `POS x64`, and `POS x86 Legacy` `.exe` files plus SHA-256
sidecars under `artifacts/retail-local/`. It does not turn the pilot into a signed or generally
available release; the server targets still require Windows x64, PowerShell 7 and Docker Desktop.

## Install (technical pilot)

Prerequisites: Windows 11, PowerShell 7, Docker Desktop running, enough free disk space, and a tested
UPS for the host.

Verify the ZIP checksum, extract the complete folder to a stable local path, start Docker Desktop,
then double-click `Install-BMS-Retail-Local.cmd` or run `pwsh .\install.ps1`. The installer runs a
preflight check, validates and loads the image archive, creates local secrets, migrates/provisions,
waits for both Web and WS to become healthy, then performs HTTP health checks. Running directly from
source remains supported for development; in that mode the installer builds the images locally.

The installer asks for the shop name, shop type, whether to create a Starter Catalog, owner identity,
password, and POS PIN. It generates every
database/application secret locally, loads the packaged Web/WS images (or builds them in source-dev
mode), applies all migrations, provisions the shop atomically, and starts the stack. The POS pairing
token is displayed once and is stored in the database only as a SHA-256 hash. Paste it into BMS POS
with server URL `http://127.0.0.1:3100`; Electron stores it in the OS keystore.

Starter Catalog generation runs only after the core shop transaction commits, so an optional sample
failure never makes the installation unusable. Examples are draft products with zero stock and are
not published to storefront, customer AI, or online ordering. Admin > Getting Started shows the
registered run and offers explicit whole-set deletion. Cleanup refuses the entire operation if any
example was edited, activated, converted, or referenced by an order or purchase order; a SKU prefix
is never treated as ownership evidence. Pharmacy examples are non-clinical supplies only, restaurant
recipes remain unconfigured drafts, and board-game examples are sellable goods rather than play time
or library copies.

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

For managed-runtime installs, updates follow the standard user-initiated flow in
[retail-local-managed-runtime.md](retail-local-managed-runtime.md#update-and-recovery): show the
signed release manifest and release notes, run preflight, create a verified encrypted backup, stage
and verify the new bytes, migrate through the transaction controller, health-check before commit, and
fall back through rollback/full restore if needed. Early pilot shops may receive frequent updates, but
they still require an operator action such as **Check for update** or **Back up and update**; do not
ship a silent auto-update path for schema/runtime changes.

On Windows, the installed shortcuts separate **BMS Retail Local Check for Updates** from **BMS Retail
Local Update**. On Ubuntu, `sudo bms-retail-local-update --check` performs the same signed preview and
`sudo bms-retail-local-update` asks for `UPDATE` before it stages components. `--yes` is reserved for
an operator-facing launcher that already displayed the verified preview and captured the same explicit
consent; it is not permission for a silent schedule.

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
The combined `server-pos` package is trial-locked distribution: it is stored with
`access_level = trial`, omitted from anonymous public downloads, and fetched only through
the standard Retail Local license/onboarding flow. That lock applies to installer distribution only
and must never become a runtime lease for an installed shop.
Trial onboarding uses two records together: the trial-locked `server-pos` release asset and a Retail
Local license whose `customer_reference` names the customer/account the platform issued it to. After
activation, signed evidence adds the actual tenant/POS references reported by the installed host.

Release platforms are deliberately architecture-specific: `windows-x64`, `ubuntu-x64`, and the
experimental `macos-arm64`. Windows packages use `.exe` and Ubuntu packages use `.deb`. On macOS,
`server` and `server-pos` use Apple Installer packages (`.pkg`), while `pos` uses the existing POS
Desktop disk image (`.dmg`). Intel Mac packages are not currently accepted on this page.

The browser sends installer bytes to the dedicated
`/api/admin/retail-local/releases-upload` Pages API route. That route disables the Pages body parser,
reads the raw Node `IncomingMessage`, and is excluded from `middleware.ts`; do not move it into an App
Route/`NextRequest`. Next.js 14's request adapter expands large request bodies in memory even when
application code consumes `request.body` as a stream (`vercel/next.js#59519`), which OOM-killed the
1.9 GiB production Web process during a 2 GiB upload.

The uploaded bytes stream from that raw multipart request directly through the shared storage driver;
neither the browser nor the upload handler reads the complete installer into an `ArrayBuffer`/`Buffer`.
The local driver writes incrementally and the S3 driver uses bounded multipart parts, while SHA-256
and size are computed over that same stream. The default upload ceiling is 4 GiB and may be changed
with `BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES` (bytes). Keep release files as private `files` rows. The
file row and its `bms_retail_local_release_assets` owner are committed in one database transaction;
a validation or pre-commit failure removes the stored bytes.

Public users download through `/api/retail-local/download/[id]`, which serves only non-hidden public
Retail Local assets with `Content-Disposition: attachment` and the stored SHA-256 header. Trial-locked
assets require platform-admin authorization. Do not point the public page at `/api/files/[id]`
directly.

Release notes are operational instructions, not marketing copy. For every Retail Local installer they
must call out the expected update path, downtime/restart expectation, backup requirement, migration or
data-risk notes, and rollback/restore status so the shop owner can decide when to press update.

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
