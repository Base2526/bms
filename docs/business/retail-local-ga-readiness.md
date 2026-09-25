# BMS Retail Local GA readiness

Assessment date: 2026-09-25. This file records the evidence boundary; it is not itself evidence.

## Verdict

**Not Commercial/GA.** The signed payload and Managed Runtime candidate paths are implemented, but
an installed-shop updater and several external certification/signing/control-plane gates remain
open. Pilot artifacts must not use the `stable` channel or be represented as generally available.

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
| License evidence | Implemented sender | signed/hash-chained fail-open outbox; receiver/control plane open |
| Stable-channel claim protection | Implemented | stable signer requires unexpired promotion evidence |

## Open release blockers

| Gate | Kind | What closes it |
| --- | --- | --- |
| Transactional installed-shop updater | Engineering + drill | Verified download, pre-update encrypted backup, schema-aware rollback/restore, Desktop/runtime version coordination, interrupted-update recovery on Windows and Ubuntu |
| Production release key custody | Operations/security | Key generated and used only by an isolated signing service; rotation and recovery runbook tested |
| Windows package trust | External signing | Authenticode-sign bootstrap, agent, and Desktop; verify timestamp and SmartScreen installation evidence |
| Linux package trust | External signing | Signed repository/package metadata and clean-host verification |
| Replacement-machine restore | Hardware evidence | Restore database, storage and encryption keys to a different supported host and reconcile totals |
| Failure recovery | Hardware evidence | Power loss, disk full, forced restart and suspend/resume runs with retained data and auditable outcomes |
| Peripheral certification | Hardware evidence | Named printer, scanner, drawer and customer-display matrix for each supported target |
| Clean-machine acceptance | Release evidence | Exact signed release on Windows 11, Windows 10 IoT LTSC 2021 and Ubuntu 24.04; transition targets remain separate |
| Encrypted off-host backup | Engineering + operations | Scheduled export, retention, restore sampling and customer-visible failure reporting |
| Remote diagnostics | Engineering + privacy | Explicit-consent encrypted support bundle with redaction tests; no secrets/raw customer data |
| Licensing back office | Engineering + operations | Secure activation binding, evidence ingestion/verification, duplicate review and device-transfer workflow; never a runtime kill switch |
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
