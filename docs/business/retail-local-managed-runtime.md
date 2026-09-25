# BMS Retail Local Managed Runtime

Current Commercial/GA evidence status: [Retail Local GA readiness](retail-local-ga-readiness.md).

Managed Runtime is the commercial self-install direction for Retail Local. The customer downloads one
signed installer, supplies shop/owner/password/PIN details, and reaches a paired POS without handling
Docker Desktop, WSL, Compose, ports, environment files, or a raw device token.

It remains a deployment profile of the authoritative BMS stack. It does not create a local-only price,
stock, payment, permission, tax, or settlement implementation, and Electron remains a keystore-backed
client rather than a server.

## Licensing and evidence

Licensing is an administrative control, not an availability dependency. Once installed, the shop's
POS, payments, returns, stock, shifts, reports, data access, backup, restore, and disaster recovery
continue regardless of control-plane reachability or commercial review. The product has no remote
kill switch, mandatory runtime lease, grace-period shutdown, or licensing-driven read-only mode.

A new commercial installation may be issued as a **30-day trial**. The control plane starts the
window from authoritative server time and derives `TRIAL_ACTIVE`, `TRIAL_EXPIRING` (14 days or less),
or `TRIAL_EXPIRED`; it does not send those states back as runtime authority. Expiry creates a sales
follow-up signal only. The already-installed shop keeps every local business and recovery path.
Cloud services that carry an operator cost may use their own separately documented quota, but no
cloud/add-on decision may be reused as permission to block local transactions or customer data.
Platform staff can extend a trial, mark payment review, reactivate/cancel the commercial record, or
convert it to paid without reinstalling or replacing the installation identity. Every such action
requires explicit confirmation, a reason, a caller operation id for retry safety, and an append-only
actor/timestamp audit row. Due follow-ups are created at 14, 7 and 1 day before expiry and at expiry.
They are back-office work items only. Trial or payment state must never be printed on a customer's
receipt, bill, tax invoice, kitchen ticket, or other business document.

The host agent maintains a separate evidence identity and records `INSTALLATION_REGISTERED`,
`RUNTIME_SEEN`, `UPDATE_INSTALLED`, `TRANSFER_REQUESTED`, and `INSTALLATION_DEACTIVATED`. Each event
contains only the issued license id, random installation id, provisioned tenant/POS-device ids,
platform/release/agent versions, UTC device time, sequence number, prior-event hash, and device-key
thumbprint. The canonical event is signed with the installation's Ed25519 key. The private key stays
under the Managed Runtime data ACL and is never included in evidence or backup telemetry.

Events are appended locally and placed in an outbox before delivery. Platform staff issue a
seven-day, one-use activation code; the installer exchanges it over HTTPS for the license reference
and evidence ingestion token. Only hashes of both credentials are stored by the control plane,
while the root-only Managed Runtime profile keeps the ingestion token. Activation can be skipped or
retried after install and an exchange failure never changes installation success. The evidence
endpoint is derived locally from the trusted HTTPS Activation URL packaged into the bootstrap; it
is never accepted from the activation response. HTTPS failure, timeout, or a non-2xx response
preserves the event for a later attempt and returns a queued result; it never stops
the runtime. The receiving control plane adds authoritative `receivedAt`, stores the event append-only,
verifies the bearer binding, Ed25519 signature, device-key thumbprint, hash-chain and sequence, and opens a
`LICENSE_REVIEW_REQUIRED` case on duplicate or conflicting installations. Staff resolve that case
with the customer through transfer, reset, or a commercial agreement. Existing installations remain
operational throughout review. The control plane must not collect raw hardware serials, MAC address,
GPS, sales lines, customer data, credentials, or secrets for this purpose.

The evidence wire contract is [license-evidence.schema.json](../../deploy/retail-local/managed-runtime/license-evidence.schema.json).
The agent commands are:

```text
bms-runtime-agent license-record ...   # append, sign, queue, then attempt delivery
bms-runtime-agent license-pulse ...    # RUNTIME_SEEN from the persisted minimal profile
bms-runtime-agent license-flush ...    # retry queued events in sequence order
```

Linux records a pulse after a Managed Runtime service start and through a best-effort daily timer.
Windows installs a best-effort daily task after licensing is configured. Both are explicitly outside
service readiness and sales paths.
Until the commercial bootstrap supplies a license id and HTTPS evidence endpoint, the pulse is a
harmless no-op; absence of licensing configuration is visible to release operations but does not
turn a candidate build into a production license implementation.

Migrations `10.16`–`10.18` and `retailLocalLicensing.ts` implement the platform control-plane candidate. A
platform administrator can issue a license/activation code, list licenses, inspect the installation/event
timeline (`occurredAt` plus authoritative `receivedAt`), rotate a leaked token, and approve,
deactivate or transfer an installation through `/api/admin/retail-local/licenses`. The one-use
activation code is returned only when issued and must be delivered through the commercial bootstrap,
not logs or ordinary email. The ingestion token is never shown to an operator during normal setup.
A duplicate/key/chain/limit conflict is accepted as evidence and creates a human
review; it does not send a sanction to the shop.

`POST /api/admin/retail-local/licenses` accepts `licenseType: "TRIAL"` or `"PAID"`; omission keeps
the existing paid behavior. Commercial actions use
`POST /api/admin/retail-local/licenses/{id}/commercial`. List/detail responses include the stored
commercial state, effective derived state, exact trial timestamps, and whole days remaining. Trial
expiry is derived at read time rather than by a cron, so a missed scheduler cannot make the ledger
lie. Evidence review status remains a separate field: suspected duplicate use and an expired trial
are different conversations and must never be collapsed into one enforcement switch.

## Platform shape

On Windows, a native signed host agent manages a private `BMSRuntime` WSL2 distribution containing
Moby and the pinned BMS services. On Ubuntu, the same agent contract manages Moby through systemd
without virtualization. PostgreSQL data stays on the Linux filesystem; it is never run from `/mnt/c`.
Web and WS remain loopback-only and PostgreSQL, Redis, and the engine socket are never published.

The Windows product boundary is one dedicated operator account per shop host. WSL distributions are
user-scoped and systemd services alone do not keep an instance alive, so the host agent must own
login startup and runtime liveness. A headless server that must run before login is a different
Hyper-V/appliance product and is not implied by this design.

## Supported-target policy

The initial primary targets are serviced Windows 11 x64, Windows 10 IoT Enterprise LTSC 2021 x64,
and Ubuntu 24.04 LTS x64. Windows 10 22H2 is transition-only and needs evidence of current ESU;
Ubuntu 22.04 is transition-only. Consumer Windows 10 without ESU, 32-bit systems, ARM64, arbitrary
Linux distributions, Windows Server, and macOS local server are not initial targets.

Passing preflight means only that a machine is a candidate. A production claim additionally requires
the exact OS/runtime/agent/application combination to pass the clean-install, update, restore,
power-loss, disk-full, suspend/resume, printer/scanner/display, and secret-recovery matrix.

## Install state machine

The installer persists only non-secret progress and resumes after a required reboot:

1. verify the signed installer and support target;
2. enable/install the platform runtime and reboot if required;
3. verify the signed release envelope and stage every component;
4. verify SHA-256 and OCI digests before any provisioning;
5. create machine secrets, migrate, and provision exactly once;
6. pass service and HTTP health checks;
7. transfer the one-time device token to Electron over a local ACL-bound channel, store it with
   `safeStorage`, then erase transient copies;
8. mark installation complete and open the PIN screen.

A failed or interrupted stage resumes idempotently. It must not report success, expose a half-paired
register, or rerun a completed provision operation.

## Update and recovery

Application, runtime, and host-agent releases are separate layers. An update downloads and verifies
all new bytes before stopping the current stack, creates a verified backup before migration, retains
the previous images, and publishes success only after health checks. Image rollback is allowed only
when the release declares schema compatibility; otherwise recovery restores the pre-update database,
files, and encryption keys together.

Live PostgreSQL storage is not backed up by copying a running WSL VHDX. The supported backup is a
logical database dump plus stored files, installation metadata, and the exact secrets required to
decrypt credentials. Commercial recovery must be portable to a replacement machine, so machine-only
DPAPI wrapping cannot be the sole backup key.

Windows and Ubuntu can schedule that logical bundle to a separate destination with age recipient
encryption. The shop machine stores only the public recipient; the recovery identity stays in a
separate support/customer vault. The job refuses the Windows system disk or the Ubuntu runtime
filesystem, writes through a partial file, emits a SHA-256 sidecar, applies bounded retention, and
records a customer-readable failed/passed status. A passed scheduled copy is still not proof of
recoverability: stable promotion needs a sampled replacement-machine restore and reconciliation.

The backup includes the non-secret `licenseCode` in `installation.json` so support can identify the
commercial record after a restore. It deliberately excludes the evidence private key and bearer
token. After restoring to a replacement computer, support issues a new one-use activation code and
the operator runs `bms-retail-local-activate --transfer` (or the Windows **Activate or Transfer**
shortcut; a restored license reference also selects transfer automatically). That creates a new evidence identity and a reviewable transfer request; the restored shop
continues operating before, during, and after that process.

Uninstall keeps shop data by default. Permanent erase is a separate, explicit workflow; unregistering
the WSL distribution is destructive and must never occur during an ordinary uninstall.

## Current delivery status

The repository now implements the native agent, signed/resumable staging, private Windows WSL rootfs,
Ubuntu systemd install, pinned managed Compose contract, one-time Desktop pairing handoff, encrypted
logical backup/restore, safe default uninstall, release signer, and Windows bootstrap packaging
definition. It includes scheduled encrypted off-host export, retention, checksums and stale/failure
reporting on both supported runtime families. It also implements a signed transactional updater: replay/downgrade refusal, verified
pre-migration encrypted backup, retained previous images, health-gated commit, schema-aware rollback
or full data restore, and startup recovery for an interrupted runtime transaction. The legacy Docker
Desktop pilot remains available and unchanged while this path is certified.

This is release-candidate engineering, not a GA declaration. Promotion to `stable` requires a
production signing trust root, signed OS packages, evidenced update/rollback and replacement-machine
restore drills, and a clean-machine evidence matrix for every target. Windows 10 22H2 is
never promoted without current ESU evidence; ordinary out-of-support Windows 10 remains unsupported.
The stable signer enforces these claims through a release/target/commit-matched, unexpired promotion
evidence file; a pilot build or a self-authored checklist is not accepted as GA evidence.
