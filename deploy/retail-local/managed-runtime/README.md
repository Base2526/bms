# BMS Retail Local Managed Runtime

This directory contains the managed-runtime implementation for signed, one-click commercial
self-install releases. It does not replace the existing Docker Desktop technical-pilot installer
until the acceptance gates below have evidence from clean target machines.

## First certified targets

- supported Windows 11 x64 releases: private WSL2 distribution + Moby;
- Windows 10 IoT Enterprise LTSC 2021 x64: the fixed-purpose appliance target;
- Windows 10 22H2 x64: transition only, with current ESU evidence;
- Ubuntu 24.04 LTS x64: primary native-Linux target;
- Ubuntu 22.04 LTS x64: transition target;
- macOS 15+ on Apple Silicon or Intel: architecture-matched Lima/VZ + private Moby technical pilot.

`support-matrix.json` is product policy, not a claim that a target has passed certification. The
installer must also require a signed release manifest whose `platformTarget` names one of these
entries. A future Windows release is not supported merely because its build number is higher.

## Trust boundary

The host agent owns runtime lifecycle, downloads, signature verification, backup/update orchestration,
and health reporting. Electron remains a client window and never receives a Docker/Moby socket,
database credential, price rule, or settlement authority.

Every downloaded release is a JWS-compatible Ed25519 envelope described by
`release-manifest.schema.json`; the decoded body follows `release-payload.schema.json`. The signature
covers the exact ASCII `protected.payload` bytes, avoiding cross-language JSON canonicalization
ambiguity. Each component also has a SHA-256; OCI images additionally require an immutable digest.
HTTPS alone, tags, and a checksum downloaded beside an artifact are not publisher identity.

Every newly signed release includes `shop-archetypes` as a `support-file` component sourced from
`packages/retail-local-contract/shop-archetypes.json`. Windows and Ubuntu installers build their
first-run menu from that verified component, so the catalog comes from the exact application release
rather than an unversioned latest endpoint. `enabledForNewInstall=false` or `deprecated=true` hides
an id from new installations without making existing shops unreadable. A genuinely new id still
requires a compatible application release and Starter Catalog implementation before signing.

`verify-release.mjs` is the dependency-free reference verifier for release tooling and tests.
`apps/retail-local-agent` is the native single-binary implementation used by the installers. The
customer bundle contains a release-owned, ACL-protected keyring; the manifest URL cannot replace its
trust root.

The release private key belongs only in the signing service. It must never be present in this
repository, an installer, an image, or a target shop. Key rotation uses a new embedded public key id
in a signed agent release before manifests start using that id.

## Implemented install path

- native Windows/Linux/macOS preflight and exact support-target selection;
- Ed25519 release verification before payload interpretation;
- resumable HTTPS component download with byte size and SHA-256 validation;
- immutable OCI image-id verification after engine load;
- private Windows WSL2 + Moby runtime, native Ubuntu Moby/systemd runtime, and macOS Lima/VZ + Moby
  technical-pilot runtime;
- loopback-only Web/WS, with PostgreSQL, Redis, and engine sockets off host ports;
- atomic first-run migration/provisioning and ACL/mode-protected secrets;
- short-lived pairing handoff into Electron `safeStorage` without displaying a device token;
- encrypted logical database/files/secrets backup through `bms-localctl backup`;
- scheduled age-encrypted off-host backup for Windows and Ubuntu, with a separately held recipient
  key, SHA-256 sidecar, retention, stale/failure status, and no dependency on the licensing service;
- signed transactional update with replay protection, pre-migration encrypted backup, health-gated
  commit, schema-aware data restore, and interrupted-update recovery;
- an Inno Setup definition for the small Windows bootstrap `.exe`;
- small macOS Apple Silicon/Intel `.pkg` builders plus signed architecture-specific release
  preparation; no server/runtime/POS payload is embedded in the normal bootstrap;
- release signing tooling that derives hashes from the actual artifact bytes.

The Windows/Ubuntu/macOS bootstrap remains small: application images, the private runtime, and Desktop
are downloaded after publisher verification. The target needs internet access during first install.
The old large macOS package is retained only as an explicit offline recovery path. All current macOS
technical-pilot packages are still unsigned and not notarized.

Uninstall on all three hosts removes every BMS startup/timer source before it stops the private runtime,
shows numbered progress, and bounds licensing evidence plus runtime-stop commands so an unavailable
runtime cannot leave the uninstaller apparently frozen. Windows runs cleanup PowerShell hidden; Linux
also stops any active evidence or off-host-backup job; macOS unloads the KeepAlive LaunchAgent before
calling Lima. A normal uninstall keeps shop data, secrets, and the private runtime for recovery.
Permanent deletion still requires the explicit `-EraseData`/`--erase-data` confirmation flow and refuses
to delete host data when container/VM cleanup fails.

The repository-level release command now uses this online bootstrap path by default for Windows,
Ubuntu and macOS. It requires an externally supplied public-key-only keyring and platform-specific HTTPS
signed-manifest URLs:

```powershell
pwsh .\deploy\retail-local\build-release.ps1 `
  -Version 0.5.0 `
  -Keyring C:\secure\bms\trusted-release-keys.json `
  -WindowsManifestUri https://releases.example.com/retail-local/windows-11-x64/release.jws.json `
  -WindowsX86ManifestUri https://releases.example.com/retail-local/windows-10-x86-pos/release.jws.json `
  -LinuxManifestUri https://releases.example.com/retail-local/ubuntu-24.04-lts-x64/release.jws.json
```

Use `-Distribution Offline -AllowOfflineRecovery` only for the explicit legacy recovery/pilot
payload. Managed Runtime
supports Windows x64, Ubuntu x64, macOS Apple Silicon and macOS Intel. Windows x86 remains a
POS-only online-bootstrap legacy target; Linux
32-bit is unsupported by the current Electron/runtime/image stack and is never emitted as a server
installer.

Production rootfs builds must call `runtime-rootfs/build-rootfs.sh` with an Ubuntu image reference
pinned by digest. A mutable `ubuntu:24.04` tag is used only by the CI Dockerfile smoke build and is
never acceptable as a signed release input.

## Local Windows end-to-end release test

Before connecting production object storage and the isolated signing service, a Windows developer
machine can exercise the same signed-manifest, resumable-download, WSL import, image-digest, and POS
installation path against loopback:

```powershell
pwsh .\deploy\retail-local\managed-runtime\windows\prepare-local-test-release.ps1 `
  -Version 0.2.13-localtest.1 `
  -SourceImageVersion 0.2.13
```

The command creates a fresh **test-only** Ed25519 keypair, embeds only its public keyring in an x64
bootstrap, serves release bytes from `https://localhost:8443`, and trusts a seven-day localhost TLS
certificate in the current user's root store. Private keys remain under the ignored artifact
directory and are never served. The generated installer is deliberately named `SMOKE-ONLY`; neither
the key nor this release is a production trust root.

Keep the local server running while exercising the installer. Afterwards, stop only that recorded
Node process and remove only its recorded TLS certificate with:

```powershell
pwsh .\deploy\retail-local\managed-runtime\windows\stop-local-test-release.ps1 `
  -ReleaseDirectory .\artifacts\retail-local\local-test-release\0.2.13-localtest.1
```

The stop command preserves release files for diagnosis. Use a new local-test version for each run;
the preparation command refuses to overwrite an existing key or signed release.

## Not yet a GA claim

The current gate-by-gate verdict is maintained in
[Retail Local GA readiness](../../../docs/business/retail-local-ga-readiness.md).

The code path is implemented, but Commercial/GA release promotion remains blocked until all of these
external release gates are complete:

- production Ed25519 release key in an isolated signing service and the matching embedded keyring;
- Authenticode signing for the bootstrap/agent/Desktop and repository signing for Linux packages;
- an evidenced backup/restore drill on replacement hardware;
- an evidenced transactional update/rollback and power-interruption drill on every supported target;
- an evidenced scheduled off-host run plus replacement-machine sample restore using the separately
  held recovery identity;
- clean-machine Windows 10/11 and Ubuntu acceptance runs, including reboot, power loss, disk full,
  suspend/resume, printer/scanner/customer-display, and uninstall-retains-data cases.
- deployed licensing evidence ingestion, duplicate review/device-transfer operations, and a published
  support lifecycle (none of these may disable an installed shop);
- exact-release privacy/retention approval for the consent-gated remote diagnostics workflow.

Until those gates pass, publish this only as an internal/pilot artifact. Ubuntu exposes the separate
`bms-retail-local-update` command; a newer Windows bootstrap detects an existing receipt and enters
the verified updater without rotating installation secrets.

The `stable` channel is mechanically fail-closed as well as documented: `sign-release.mjs` refuses
to sign it outside an explicitly authorised isolated CI job and requires a release/target/commit-
matched `promotion-evidence.json`. Every required gate must be `passed`, unexpired, and link to HTTPS
evidence. Validate the evidence before the signing job with:

```bash
node deploy/retail-local/managed-runtime/verify-promotion-evidence.mjs \
  promotion-evidence.json release-descriptor.json
```

Use `promotion-evidence.example.json` only as a shape reference. Example URLs and assertions are not
evidence. This guard prevents an accidental GA label; it does not manufacture the missing signing,
hardware, recovery, licensing-control-plane, or clean-machine results.

Run the Linux candidate check with:

```bash
bash deploy/retail-local/managed-runtime/preflight-linux.sh
```

Run the Windows candidate check from PowerShell 7 with:

```powershell
pwsh .\deploy\retail-local\managed-runtime\preflight-windows.ps1 -Json
```

Prepare a signed macOS release and build the small architecture-specific online bootstrap with:

```bash
deploy/retail-local/managed-runtime/macos/prepare-release.sh \
  --version 0.4.0-internal.1 --architecture arm64 \
  --base-url https://releases.example.com/retail-local/0.4.0/macos-15-arm64 \
  --desktop-app 'apps/desktop/dist/mac-arm64/BMS POS.app' \
  --private-key /secure/bms-release/release-private.pem --key-id production-2026-09

deploy/retail-local/managed-runtime/macos/build-bootstrap-pkg.sh \
  --version 0.4.0-internal.1 --architecture arm64 \
  --manifest-url https://releases.example.com/retail-local/0.4.0/macos-15-arm64/release.jws.json \
  --keyring /secure/bms-release/trusted-release-keys.json

deploy/retail-local/managed-runtime/macos/build-pos-bootstrap-dmg.sh \
  --version 0.4.0-internal.1 --architecture arm64 \
  --manifest-url https://releases.example.com/retail-local/0.4.0/macos-15-arm64/release.jws.json \
  --keyring /secure/bms-release/trusted-release-keys.json
```

The POS-only DMG is also an online bootstrap: it contains no Electron payload and stages only the
signed `desktop` component. Repeat both builders with `x64` and the Intel Desktop app for Intel Macs.
For an approved no-internet recovery
installation only, build the old full payload explicitly:

```bash
deploy/retail-local/managed-runtime/macos/build-pkg.sh \
  --version 0.4.0-internal.1 --architecture arm64 --package-type server-pos
```

Docker is needed only on the release workstation to build the matching OCI images. The target package
uses the downloaded Lima/VZ private runtime and never calls Docker Desktop. After package
installation, keep the Mac online and open `/Applications/BMS Retail Local.app`.

Developer verification:

```bash
(cd apps/retail-local-agent && go test ./... && go vet ./...)
node --test --experimental-strip-types scripts/retail-local-managed-runtime-contract.test.mts
scripts/retail-local-update-transaction.test.sh
(cd apps/desktop && npm test && npm run lint)
```

Build the Ubuntu x64 bootstrap package with a trusted **public-key-only** keyring:

```bash
deploy/retail-local/managed-runtime/linux/build-deb.sh \
  --keyring /secure/release/trusted-release-keys.json \
  --manifest-url https://releases.example.com/retail-local/ubuntu-24.04/release.jws.json \
  --activation-url https://control.example.com/api/bms/retail-local/activate \
  --version 0.5.0
```

The result is a roughly 3 MB `.deb`. Installing it adds `bms-retail-local-setup`; it does not start
the runtime or mutate shop data during `dpkg` installation. The setup command performs preflight and
downloads only components authenticated by the packaged public key. A build with no
`--manifest-url` is an internal bootstrap and requires the signed-manifest URL as its first argument.
After installation, use `sudo bms-retail-local-update --check` for a signed preview, then
`sudo bms-retail-local-update` to review the same metadata and confirm installation. The `--yes`
option is only for an operator-facing launcher that already showed the verified preview and captured
consent. Rerunning the raw Linux setup script still refuses an existing shop.

The setup command securely prompts for the one-use Activation Code. A missing, expired, or
temporarily unreachable activation service is reported but does not fail installation or restrict
the store. Activate later with `sudo bms-retail-local-activate`; after restoring a backup to a
replacement host, use `sudo bms-retail-local-activate --transfer`. The encrypted backup keeps only
the non-secret license reference, not the evidence signing key or bearer token. A restored license
reference also makes the activation helper choose the transfer event automatically.
Ubuntu schedules a daily best-effort evidence pulse at 03:00 with a randomized delay; failure is
ignored by systemd and never changes runtime readiness. Windows uses the equivalent daily task.

Configure Ubuntu off-host backup only after mounting a NAS/removable filesystem at its own mount
point. Generate and custody the age identity outside the shop computer, then pass only its public
recipient to the shop:

```bash
sudo bms-retail-local-configure-backup age1... /mnt/bms-offhost 35
sudo systemctl start bms-retail-local-offhost-backup.service
sudo bms-retail-local-backup-status
```

On Windows, open **BMS Retail Local > Configure Off-host Backup** and enter the same kind of public
recipient, a UNC/network/removable/separate-physical-disk directory, and retention days. The task
runs daily at 02:00 and retries after a missed schedule. **Off-host Backup Status** returns an error
when the last run failed or the last success is older than 48 hours. The private age identity must be
kept in the recovery vault/second medium, never beside the backup files; losing it makes the backup
unrecoverable. A release is not promoted until support restores a sample to a replacement machine
with that identity and reconciles store totals.

Licensing is evidence-only and fail-open. It can flag an installation for back-office review, but it
cannot stop an installed shop, make it read-only, or sit on a POS/payment/data/backup path. The agent
keeps signed hash-chained events in `license-evidence/ledger.jsonl`, queues undelivered envelopes in
`license-evidence/outbox/`, and treats network/control-plane failure as `queued`, not as a runtime
failure. See [the licensing design](../../../docs/business/retail-local-managed-runtime.md#licensing-and-evidence).
The control plane can issue the commercial record as a 30-day trial and report that it is active,
expiring, or expired, but that state is deliberately not a host-agent command. Conversion to paid
keeps the same installation, tenant, POS device, data, and evidence identity. Customer receipts,
bills and tax documents never carry Trial or licensing state; follow-up belongs in the platform
admin queue.
