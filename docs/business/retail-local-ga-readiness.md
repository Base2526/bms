# BMS Retail Local GA readiness

Assessment date: 2026-09-25. This file records the evidence boundary; it is not itself evidence.

## Verdict

**Not Commercial/GA.** The signed payload, install, and transactional update candidate paths are
implemented, but external certification/signing, control-plane deployment and real-machine qualification gates
remain open. Pilot artifacts must not use the `stable` channel or be represented as generally available.

## Implemented and covered by repository tests

| Capability | State | Repository evidence |
| --- | --- | --- |
| One installation provisions one tenant atomically | Implemented | migration `10.15`, `localProvisioning.ts` |
| Signed release envelope and immutable component hashes | Implemented | agent + JS verifier tests |
| Resumable per-release staging | Implemented | agent tests; state is release-version scoped |
| Ubuntu bootstrap package | Implemented candidate | CI builds and inspects `.deb` |
| Windows bootstrap definition | Implemented candidate | Windows CI parses scripts and smoke-builds unsigned EXE |
| Private runtime and loopback-only services | Implemented | Compose/installer contract tests |
| Encrypted logical backup and guarded restore | Implemented candidate | lifecycle contract tests; replacement drill still required |
| Scheduled encrypted off-host backup | Implemented candidate | Windows/Ubuntu scheduler, separate-destination guard, age recipient encryption, checksums, retention and stale/failure status; restore sampling still required |
| License evidence + control plane | Implemented candidate | token-bound ingestion, Ed25519/hash-chain verification, append-only timeline, duplicate review, token rotation, 30-day trial/paid lifecycle audit and human transfer/deactivation APIs; deployment/ops qualification still required |
| Stable-channel claim protection | Implemented | stable signer requires unexpired promotion evidence |
| Transactional installed-shop updater | Implemented candidate | signed newer-only release, encrypted pre-update backup, health-gated commit, rollback/data restore and interrupted-update recovery tests |
| Consent-gated support diagnostics | Implemented candidate | tenant/device authorization, allowlist redaction, private encrypted-capable storage, retention and dedicated contract suites |

## Open release blockers

| Gate | Kind | What closes it |
| --- | --- | --- |
| Transactional update qualification | Hardware evidence | Run exact signed update, incompatible-schema rollback and power interruption on Windows and Ubuntu; reconcile sales, stock, payments, files and Desktop pairing |
| Production release key custody | Operations/security | Key generated and used only by an isolated signing service; rotation and recovery runbook tested |
| Windows package trust | External signing | Authenticode-sign bootstrap, agent, and Desktop; verify timestamp and SmartScreen installation evidence |
| Linux package trust | External signing | Signed repository/package metadata and clean-host verification |
| Replacement-machine restore | Hardware evidence | Restore database, storage and encryption keys to a different supported host and reconcile totals |
| Failure recovery | Hardware evidence | Power loss, disk full, forced restart and suspend/resume runs with retained data and auditable outcomes |
| Peripheral certification | Hardware evidence | Named printer, scanner, drawer and customer-display matrix for each supported target |
| Clean-machine acceptance | Release evidence | Exact signed release on Windows 11, Windows 10 IoT LTSC 2021 and Ubuntu 24.04; transition targets remain separate |
| Encrypted off-host backup qualification | Hardware + operations evidence | Run scheduled export to a real supported destination, alert on a forced failure, restore a retained sample to a replacement host and reconcile totals |
| Remote diagnostics qualification | Privacy + operations evidence | Verify the existing explicit-consent redacted bundle on the exact local release and approve the support transport/retention procedure |
| Licensing back-office qualification | Deployment + operations evidence | Deploy the token-bound receiver, restrict platform-admin access, exercise duplicate/key/chain alerts plus token rotation and device transfer, and approve the customer-resolution runbook; never a runtime kill switch |
| Support lifecycle | Operations | Published supported versions, response path, key/package revocation and end-of-support policy |

## Promotion rule

Each target release owns its evidence. `promotion-evidence.json` must match the exact release version,
platform target and source commit, and every required gate must link to current HTTPS evidence. Run:

```bash
node deploy/retail-local/managed-runtime/verify-promotion-evidence.mjs \
  promotion-evidence.json release-descriptor.json
```

Passing this structural verifier means the evidence package is complete and current; release
management must still review that the linked evidence is authentic. Missing or expired evidence
keeps the channel at `pilot`.
