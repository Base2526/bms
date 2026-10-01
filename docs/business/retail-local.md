# BMS Retail Local

Commercial self-install development is tracked separately in
[Retail Local Managed Runtime](retail-local-managed-runtime.md). It is an incubating Windows
WSL2/Moby, Ubuntu systemd/Moby, and macOS Apple Virtualization Framework/Lima delivery layer. The
macOS Apple Silicon and Intel online bootstraps are internal technical pilots whose clean-machine evidence,
signing, notarization, update, and recovery gates are still open; none of these
paths replaces the self-contained technical pilot package until its install, update, backup,
restore, and failure-mode gates have evidence.

`BMS Retail Local` is a deployment profile of the existing BMS codebase, not a second POS, database
model, or settlement engine. The technical pilot runs one shop on one supported host. Electron or a
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
- optional resumable sample data through the shared onboarding seeder; sample products follow the
  selected archetype, remain marked as fake data, and use bundled product-specific photos instead of
  remote random images; the restaurant onboarding set keeps its menu-specific food photos and also creates a visibly labelled
  starter floor with two zones and eight tables, but never mixes sample tables into an existing
  operator-created floor;
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

## Build installers

The default Windows/Ubuntu/macOS release build is the small online bootstrap. First install requires
internet access; signed release components are downloaded progressively, resumed after interruption,
and verified before use. The bootstrap never contains application images, a database, shop secrets,
or a private release key. Build it with the external public keyring and the platform-specific signed
manifest URLs documented in [`deploy/retail-local/BUILD.md`](../../deploy/retail-local/BUILD.md).

Retail Local Server supports Windows x64 and Ubuntu x64 only. Windows x86 remains a separate legacy
POS client option, and Linux 32-bit is unsupported by Electron/runtime dependencies. Do not publish a
32-bit server installer whose preflight or downloaded components cannot run.

The self-contained image bundle below is the explicit offline recovery/technical-pilot path, not the
default upload artifact. On a development machine at the repository root:

For the Windows, Linux and macOS online workflow, explicit offline fallback, POS version
update instructions, checksums, and architecture policy, see
[`deploy/retail-local/BUILD.md`](../../deploy/retail-local/BUILD.md).

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

The installer asks for the shop name, shop archetype, whether to create optional sample data, owner
identity, password, and POS PIN. It generates every
database/application secret locally, loads the packaged Web/WS images (or builds them in source-dev
mode), applies all migrations, provisions the shop atomically, and starts the stack. The POS pairing
token is displayed once and is stored in the database only as a SHA-256 hash. Paste it into BMS POS
with server URL `http://127.0.0.1:3100`; Electron stores it in the OS keystore.

Archetype is committed in the same transaction as the shop. The installer writes a protected
provisioning checkpoint containing the one-time pairing result before it starts optional sample
data. Seeding then runs in a separate process through `createOnboardingSampleData()`, so products
match the selected archetype and a seed crash or power loss cannot strand the new register without
its token. The macOS, Windows, and Linux installers retry a requested Starter Catalog when the
provisioning status is missing or incomplete, and accept restaurant completion only when the result
contains both the product step and `restaurant_layout`; the installation receipt records the actual
sample status. If optional seeding fails, the usable shop is preserved and the operator can resume
the seed safely from Getting Started. The database-backed
`retail-local-onboarding-all-archetypes-db-contract` walks this same installer entry point for every
enabled archetype, verifies the matching 12-product/photo catalog and sales surface, verifies the
restaurant's two zones and eight tables, then replays the seed and requires all row counts to remain
unchanged.

The generated `.env.local` contains encryption/signing keys. It is ACL-restricted by the installer,
git-ignored, and must never be emailed or committed.

Use [the installation test checklist](../../deploy/retail-local/TEST-INSTALL.md) on a clean Windows
machine. `doctor.ps1` checks secret presence without printing values, Compose/service health, HTTP,
the migration ledger, the installation singleton, and writable storage. `uninstall.ps1` keeps data
by default; its permanent test reset requires both `-EraseData` and the exact confirmation text.

## Operations

### After installation

After installation, the POS first-run screen exposes **เปิดระบบหลังบ้านบนเครื่องนี้**
on Windows, Linux and macOS, including when automatic pairing was not completed.
It opens the fixed local `/admin/pos-devices` page in the system browser after an
eight-second-bounded login-page readiness check; normal administrator authentication
is still required. macOS first uses its verified managed-runtime controller to start
the service. Windows/Linux do not execute privileged startup commands from Electron;
an unavailable service produces a repair/setup message instead. An empty Server URL is
filled after opening successfully, but existing remote URLs and pairing links are preserved.

### Installation error reports

The Windows, Linux and macOS POS and Server + POS setup scripts create a local
support archive when installation fails. Review the archive and submit it through
`https://bms.jachoei.com/installer-report` with explicit consent. There is no automatic
upload. The same form accepts Windows ZIP, Linux/macOS TAR.GZ, or the contained
`diagnostics.json` / `diagnostics.txt`. Keep the file and retry when offline; a failed
submission never changes the installation or deletes the local report.

| Platform | Location and access |
| --- | --- |
| Windows Server + POS | `%ProgramData%\BMS\RetailLocal\diagnostics\bms-install-error-*.zip`; **Send error report** opens the report folder and browser form |
| Windows POS | `%LOCALAPPDATA%\BMS\POSBootstrap\diagnostics\bms-install-error-*.zip`; **Send error report** opens the report folder and browser form |
| Linux POS / Server + POS | `/var/tmp/bms-install-report.*/report.tar.gz`; the exact path is printed on failure, with the private report directory/archive assigned to the sudo operator |
| macOS Server + POS | `~/Library/Application Support/BMS/RetailLocal/diagnostics/report.*/report.tar.gz`; the setup launcher offers to open Finder |
| macOS POS | `~/Library/Application Support/BMS/POSBootstrap/diagnostics/report.*/report.tar.gz`; setup offers to open Finder |

Windows `diagnostics.json` includes the bootstrap version, failed stage, redacted exception,
Windows version/build/architecture, RAM, system-disk capacity/free space,
virtualization flags, selected WSL/Docker service states and the current user's WSL
package version/BMSRuntime registration when available. Inventory has an eight-second
wait limit; a timed-out or unavailable check stays explicitly unknown. It does not
start WSL, Docker or the shop. Reporting failure does not replace the setup error.

Linux/macOS `diagnostics.txt` includes the bootstrap version, failed stage, exit code,
source line and a redacted setup reason. Command failures without a setup-specific reason
are identified by their stage/exit code/line; raw stderr is not exported. System fields
include OS version/build or distribution/kernel, architecture, RAM, processor count and
disk space. Linux adds CPU virtualization flags and selected systemd service states;
macOS adds Hypervisor support and the selected private Lima VM state when available.
Each external inventory probe has a two-second limit and reports unavailable on failure.
The archive uses system `tar`, so reporting does not require Python, jq, zip, a running
VM, or an internet connection. Linux reports are placed outside the root-only shop
directory so sharing one does not require granting access to shop data.

Only the diagnostic summary and a review note enter the archive. Raw transcripts, shop/customer data,
database/backups, environment files, machine/user names, hardware serials, credentials
and command lines are excluded. Known credential patterns, URLs, email addresses and
local paths are removed from exception text; users should still review the report
before sharing because error text may contain unexpected information. Existing
raw setup logs remain local and must not be attached without separate review.
Each failure gets a unique report; a later retry does not overwrite it. Unix setup
handles HUP/INT/TERM while preserving a nonzero exit. Power loss, SIGKILL or force-closing
PowerShell cannot run the failure handler; these reports do not replace the installer's
existing resume/checkpoint mechanism. Native package-manager failures before setup starts
still use the operating system's package logs.

#### Central report inbox

Platform administrators use **Platform > Installer error reports** at
`/admin/installer-reports`. The inbox filters platform, architecture, product, installer
version, OS version, failed stage, status and received date; search accepts error text
or a report reference. Matching sanitized failures are grouped by product, platform, architecture,
installer version, stage, error text and exit/HRESULT code. Counts represent reports,
not unique computers. The details drawer exposes the allow-listed system evidence and
sanitized failure, JSON download, investigation notes and New/Investigating/Resolved
status. Concurrent edits are rejected rather than overwriting another administrator;
the drawer refresh button reloads the current revision before editing again. Requests
time out after 30 seconds and can be retried. Received-date filters reject nonexistent
dates and reversed ranges.

These are **unverified, user-submitted pre-install reports**, not authenticated machine
identity, tenant data, an automatic root-cause diagnosis, or proof that a fix was tested.
No shop account is required to submit. Only platform-admin authenticated APIs can read
or update reports; no public report lookup exists, even with a receipt UUID.

Deployment prerequisites (not enabled by a source change alone):

1. Apply migration `10.31__bms_installer_reports.sql` on the central BMS database.
2. Set `BMS_INSTALLER_REPORTS_ENABLED=true` on **central BMS only**, not shop installs.
   Missing/false returns 503 and preserves the user's local report.
3. Serve the central host over trusted HTTPS. Configure the ingress to replace
   `X-Forwarded-For`, cap request bodies at 64 KiB and impose a body timeout. Redis
   limits submissions to 10/source/hour and 1,000/fleet/day; the shared limiter's
   existing per-process fallback applies when Redis is unavailable.
4. Keep the existing daily `support-diagnostics-retention` cron enabled with its
   `BMS_CRON_SECRET`. It now also deletes up to 1,000 expired installer reports per
   run. Reports become inaccessible after 90 days even if cron is delayed; physical
   deletion requires the worker to run successfully. Monitor its run history.
5. Deploy the web app before distributing newly built installers with the send link.

`POST /api/installer-reports` accepts a bounded binary/text body with
`X-BMS-Report-Consent: 1`. It returns a receipt only after persistence succeeds.
The endpoint uses a raw Pages API stream with body parsing disabled and a middleware
exclusion, enforcing 64 KiB while receiving even without Content-Length. A stalled body
times out after 15 seconds; rejected partial bodies close their connection without draining.
The server re-redacts and allow-lists fields, never persists the original archive,
rejects unexpected archive entries/links/paths, and bounds decompression in memory.
Retries of identical normalized reports return the original receipt without adding
another row or extending retention. Neither IP addresses nor submitted filenames are
stored. Existing authenticated tenant support bundles remain a separate feature at
`/admin/support-diagnostics`; this inbox also works before a tenant has been created.

Verification: `node scripts/run-contract-tests.mjs pure installer-reports`; isolated
DB tests use `POSTGRES_DB=bms_installer_reports_test` and a loopback PostgreSQL server
via `node scripts/run-contract-tests.mjs db installer-reports`. The browser smoke
script `scripts/installer-reports-browser-smoke.mjs` targets only localhost:3107 with
that disposable database and a test-only signing secret, never a live deployment.

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

## macOS online bootstrap

The normal customer `.pkg` is architecture-specific and contains only the native agent, trusted
public keyring, manifest URL, controller, and setup UI. Build it on a development Mac after publishing
the matching signed release:

```bash
deploy/retail-local/managed-runtime/macos/build-bootstrap-pkg.sh \
  --version 0.4.0-internal.1 --architecture arm64 \
  --manifest-url https://releases.example.com/retail-local/0.4.0/macos-15-arm64/release.jws.json \
  --keyring /secure/bms-release/trusted-release-keys.json

deploy/retail-local/managed-runtime/macos/build-pos-bootstrap-dmg.sh \
  --version 0.4.0-internal.1 --architecture arm64 \
  --manifest-url https://releases.example.com/retail-local/0.4.0/macos-15-arm64/release.jws.json \
  --keyring /secure/bms-release/trusted-release-keys.json
```

The first Setup requires internet and progressively downloads the pinned Ubuntu VM image, Lima,
private Moby/Compose/age runtime, BMS service images, archetype contract, and matching BMS POS app.
Downloads resume after interruption; the signed manifest, byte sizes, SHA-256 hashes and OCI image
IDs are verified before execution. The target Mac needs macOS 15 or newer, matching Apple Silicon or
Intel architecture, at least 8 GiB RAM and 12 GiB free disk (30 GiB recommended); it does not need
Docker Desktop, Homebrew, Node.js, or the source repository.

The POS-only `.dmg` uses the same trust chain but downloads only `desktop.artifact`. It intentionally
does not embed Electron, so it stays a few megabytes while still verifying the signed manifest,
target architecture, byte size and SHA-256 before installing `/Applications/BMS POS.app`.

After installing the `.pkg`, the operator opens `Applications/BMS Retail Local.app`, enters
the first shop/admin details, and waits for migration, provisioning, and health checks. Runtime data
stays under that operator's `~/Library/Application Support/BMS/RetailLocal`; the system package owns
only immutable runtime/payload bytes. The launchd agent starts the private VM for that operator after
login. Operational commands are `bms-retail-local status`, `doctor`, `start`, `stop`, `logs`, and
`backup OUTPUT.age AGE_RECIPIENT`.

The signed Desktop component is installed after the server passes health checks. Setup hands the
one-time `POS-01` credential to BMS POS automatically, so the operator does not need to paste a local
URL or pairing token. Later launches can still use **เปิดระบบหลังบ้านบนเครื่องนี้** to start or open
the trusted local runtime.

`build-pkg.sh` remains an explicit, large full-offline recovery builder. It is not the default
customer artifact and must be selected only for an approved no-internet installation.

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
  for Docker Desktop on Apple Silicon and Intel.

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
experimental `macos-arm64`/`macos-x64`. Windows packages use `.exe` and Ubuntu packages use `.deb`. On macOS,
`server` and `server-pos` use Apple Installer packages (`.pkg`), while `pos` uses the existing POS
Desktop disk image (`.dmg`).

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
