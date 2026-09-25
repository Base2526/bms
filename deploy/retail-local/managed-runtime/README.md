# BMS Retail Local Managed Runtime

This directory contains the managed-runtime implementation for signed, one-click commercial
self-install releases. It does not replace the existing Docker Desktop technical-pilot installer
until the acceptance gates below have evidence from clean target machines.

## First certified targets

- supported Windows 11 x64 releases: private WSL2 distribution + Moby;
- Windows 10 IoT Enterprise LTSC 2021 x64: the fixed-purpose appliance target;
- Windows 10 22H2 x64: transition only, with current ESU evidence;
- Ubuntu 24.04 LTS x64: primary native-Linux target;
- Ubuntu 22.04 LTS x64: transition target.

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

`verify-release.mjs` is the dependency-free reference verifier for release tooling and tests.
`apps/retail-local-agent` is the native single-binary implementation used by the installers. The
customer bundle contains a release-owned, ACL-protected keyring; the manifest URL cannot replace its
trust root.

The release private key belongs only in the signing service. It must never be present in this
repository, an installer, an image, or a target shop. Key rotation uses a new embedded public key id
in a signed agent release before manifests start using that id.

## Implemented install path

- native Windows/Linux preflight and exact support-target selection;
- Ed25519 release verification before payload interpretation;
- resumable HTTPS component download with byte size and SHA-256 validation;
- immutable OCI image-id verification after engine load;
- private Windows WSL2 + Moby runtime and native Ubuntu Moby/systemd runtime;
- loopback-only Web/WS, with PostgreSQL, Redis, and engine sockets off host ports;
- atomic first-run migration/provisioning and ACL/mode-protected secrets;
- short-lived pairing handoff into Electron `safeStorage` without displaying a device token;
- encrypted logical database/files/secrets backup through `bms-localctl backup`;
- scheduled age-encrypted off-host backup for Windows and Ubuntu, with a separately held recipient
  key, SHA-256 sidecar, retention, stale/failure status, and no dependency on the licensing service;
- signed transactional update with replay protection, pre-migration encrypted backup, health-gated
  commit, schema-aware data restore, and interrupted-update recovery;
- an Inno Setup definition for the small Windows bootstrap `.exe`;
- release signing tooling that derives hashes from the actual artifact bytes.

The bootstrap remains small: application images, the private runtime, and Desktop are downloaded
after publisher verification. The target needs internet access during install; a separately signed
offline bundle is future work.

Production rootfs builds must call `runtime-rootfs/build-rootfs.sh` with an Ubuntu image reference
pinned by digest. A mutable `ubuntu:24.04` tag is used only by the CI Dockerfile smoke build and is
never acceptable as a signed release input.

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
After installation, update only through `sudo bms-retail-local-update`; rerunning the raw Linux setup
script still refuses an existing shop.

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
