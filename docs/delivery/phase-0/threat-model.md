# Threat model

Scope: BMS adapter, Delivery API/workers/admin, driver app, customer tracking, database/PostGIS,
Redis, private object storage, maps/push providers and finance workflows. Each row's Evidence label
applies to the whole row.

## Trust boundaries and assets

- `VERIFIED`: BMS commerce DB/services and current auth/realtime are a separate trust boundary from
  the proposed Delivery system.
- `PROPOSED`: Delivery API, workers, database, Redis and object storage are independently deployed;
  provider callbacks, mobile/customer clients and BMS cross authenticated boundaries.
- `PROPOSED`: critical assets are tenant/order mapping, service/driver/customer credentials, exact
  location, recipient/KYC/POD data, assignment authority, immutable state/audit, and balanced ledger/
  payout/COD evidence.

## Threat and control matrix

| Threat | Primary controls | Detection / recovery | Residual decision | Evidence |
| --- | --- | --- | --- | --- |
| IDOR/cross-tenant or branch read/write | Server-derived mapping; object checks; optional proved RLS; 404 concealment | Denial tests, access audit, anomaly alert | Driver-pool tenancy/RLS approval | `PROPOSED` |
| Forged/stale/mock GPS | Server receive time, plausibility/accuracy flags, sequence/version, device/app attestation where approved | Stale label, route anomaly, human review | Attestation vendor and enforcement | `UNRESOLVED` |
| Service/customer/driver token theft | Short TTL, audience/purpose, key rotation, device/session binding, revocation, no token logs | Fingerprint audit, replay alerts, emergency disable | TTL/MFA/mTLS policy | `UNRESOLVED` |
| Replayed webhook/event/command | Signature/service auth, timestamp/jti where applicable, durable idempotency + body hash | Same-id/different-body incident, replay audit | Transport/signature format | `PROPOSED` |
| Duplicate/out-of-order/gap event | Aggregate version, inbox unique key/hash, snapshot reconciliation | Gap/dead-letter metrics and action-required queue | Retention/replay window | `PROPOSED` |
| Duplicate assignment / 100 accepts | DB unique active assignment, expected version, transaction lock | Conflict response, concurrency test, repair scan | Dispatch policy | `PROPOSED` |
| Duplicate payout/COD manipulation | Balanced append-only ledger, unique allocation, SoD, external evidence | Imbalance/duplicate/debt aging alerts | Finance/legal policy | `UNRESOLVED` |
| Account takeover/device loss | Driver recovery/MFA, registered device, remote session revoke, sensitive-screen protection | New-device alert, security review | Identity provider/MFA | `UNRESOLVED` |
| Malicious image/upload | Content decode/MIME/pixel/size bounds, private quarantine, EXIF stripping, signed upload intent | Scan failure, orphan cleanup, storage audit | Malware scanning service | `UNRESOLVED` |
| Object URL/evidence leak | Private bucket, purpose-specific authorization, short-lived streaming URL, no referrer | Access logs, key revoke, incident workflow | Customer POD access policy | `PROPOSED` |
| Admin abuse/privilege escalation | Permission/object scope, reason/confirm, SoD, fresh identity, immutable audit | Sensitive-action review and alerts | Admin placement/personas | `UNRESOLVED` |
| PII leakage in events/logs/errors/exports | Payload allowlist, structured redaction, safe errors, bounded scoped exports | DLP/secret scans, log review | Retention/export policy | `PROPOSED` |
| Log injection | Structured fields, length/control-char normalization, no raw headers/body | Parser alerts and correlation ids | Logging stack | `PROPOSED` |
| SSRF/provider callback abuse | Fixed allowlisted provider origins, egress policy, DNS/IP protections, no arbitrary callback URL | Egress/provider error metrics | Deployment network control | `PROPOSED` |
| Dependency/supply-chain compromise | Lockfiles, pinned images, dependency/secret scanning, SBOM, signed release/mobile build | CVE alert, rollback/revoke | Release owner/tooling | `UNRESOLVED` |
| DoS/cost exhaustion | Body/query depth/complexity/rate bounds, cursor limits, queue backpressure, maps/push quotas | Latency/error/cost/budget alerts, kill switches | Numeric thresholds | `UNRESOLVED` |
| Redis loss/poisoning | Redis only for ephemeral coordination; DB is workflow/money authority; TLS/auth/isolation | Rebuild cache/leases, degraded health | Deployment topology | `PROPOSED` |
| Database compromise/migration error | Least-privilege roles, encryption, backups, reviewed idempotent migrations, restore/rollback drill | Audit/backup validation, forward recovery | RPO/RTO and hosting | `UNRESOLVED` |
| Notification/deep-link spoofing | Notification is hint only; app refetches authoritative state | Invalid offer/assignment rejection | Push provider setup | `PROPOSED` |
| Unsafe delivery/harassment/SOS gap | Refusal/return path, contact masking, incident escalation, least data exposure | Human safety queue and evidence hold | Legal/support emergency owner | `UNRESOLVED` |

## Abuse cases and fail-safe behavior

- `PROPOSED`: a caller who knows a BMS order id cannot quote, track or mutate it without the mapped
  service/customer/object authority.
- `PROPOSED`: stale driver GPS never appears as live; a stale point cannot win dispatch without an
  explicit policy and label.
- `PROPOSED`: maps outage produces `QUOTE_UNAVAILABLE`; no straight-line fallback is called a route
  or authoritative fare.
- `PROPOSED`: BMS outage prevents new quote binding/handoff/completion. Already picked-up jobs retain
  offline-readable instructions only if separately approved; recovery reconciles rather than guesses.
- `PROPOSED`: storage outage prevents POD confirmation unless an approved replay-safe encrypted
  local capture flow exists; it never records delivered without evidence required by policy.
- `PROPOSED`: finance imbalance, unknown transfer or SoD violation freezes the batch; no payout/COD
  offset proceeds.

## Security verification required before launch

- `PROPOSED`: automated tenant/branch/object denial matrix, service/customer/driver token negative
  tests, command replay/body-mismatch tests, assignment and payout concurrency tests, upload fuzz/
  limits, event gap/replay, GraphQL/query limits and secret/log scanning.
- `PROPOSED`: independent review of mobile storage/network security, service key rotation, Admin SoD,
  infrastructure exposure, backup restoration and incident drills.
- `UNRESOLVED`: named Security/DPO/Safety approvers and risk-acceptance authority must be assigned.

**STOP — Awaiting approval.**
