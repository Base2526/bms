# Data classification, retention, and PDPA decisions

This is an engineering inventory, not legal approval. Exact retention, lawful basis, controller/
processor allocation and data-subject handling remain blocked on the DPO/Legal owner. Each Evidence
label applies to the whole row.

## Classification levels

| Level | Meaning | Handling baseline | Evidence |
| --- | --- | --- | --- |
| `PUBLIC` | Intentionally public service text/status | Integrity controls; no secret/identity | `PROPOSED` |
| `INTERNAL` | Operational metadata without sensitive personal data | Authenticated staff/service, safe logs | `PROPOSED` |
| `CONFIDENTIAL` | Recipient/contact/address, exact job data, earnings | Object-scoped access, encryption, redacted logs/exports | `PROPOSED` |
| `RESTRICTED` | Driver KYC, exact GPS history, POD, disputes, credentials, finance evidence | Separate permission, access audit, private storage, export controls | `PROPOSED` |

## Data inventory

| Data | Class / purpose | Collection window and viewers | Retention proposal | Deletion/export/legal hold | Evidence / owner |
| --- | --- | --- | --- | --- | --- |
| Tenant/branch external refs | `INTERNAL`; integration routing | While integration/job exists; scoped operators/services | Business/audit window | Preserve referential tombstone | `PROPOSED`; BMS + Platform |
| Opaque BMS customer ref | `CONFIDENTIAL`; reconciliation | Bound job only; authorized service/support | Minimum commerce dispute window | Follow BMS merge/deletion signal; retain non-identifying transaction ref if legally required | `UNRESOLVED`; DPO |
| Recipient name/phone | `CONFIDENTIAL`; pickup/drop-off contact | Active job and approved support only | Delete/anonymize shortly after support window unless dispute hold | Export from BMS authority; Delivery returns its snapshot/access log | `UNRESOLVED`; DPO + Support |
| Pickup/drop-off address/instructions | `CONFIDENTIAL`; route/fulfillment | Quote through active job/support | Short operational/dispute window; coarsen analytics | Delete coordinates/text when purpose ends unless hold | `UNRESOLVED`; DPO + Operations |
| Driver identity/profile | `CONFIDENTIAL`; employment/contract operations | Account lifecycle; driver self + authorized ops | Legal/employment/contract window | Access/correction/export; deletion subject to obligations | `UNRESOLVED`; Legal/HR/DPO |
| KYC/licence/vehicle/insurance | `RESTRICTED`; verification/safety | Onboarding through expiry/review | Statutory/claim window; exact values by legal schedule | Private, field-level redaction; legal hold | `UNRESOLVED`; Legal/DPO |
| Driver session/device | `CONFIDENTIAL`; security | Active session plus security investigation | Short revocation/security window | Revoke immediately; minimize device identifiers | `PROPOSED`; Security |
| Live/exact GPS | `RESTRICTED`; dispatch/safety/route proof | Only approved availability/active job; driver + scoped dispatch/support | Short raw window, then delete/coarsen | No public export; preserve only incident slice under hold | `UNRESOLVED`; DPO + Safety |
| Coarsened customer tracking location | `CONFIDENTIAL`; tracking | Active job only; token holder | Ephemeral/cache only | Expires with grant/job | `PROPOSED`; Product + Privacy |
| POD photo/metadata | `RESTRICTED`; delivery evidence | Delivery completion through dispute window; evidence permission | Private dispute/legal window | Customer access unresolved; hold suspends deletion | `UNRESOLVED`; Legal + DPO |
| Failure/return/dispute evidence | `RESTRICTED`; investigation/liability | Incident through resolution/appeal | Legal/insurance window | Controlled export, immutable hold trail | `UNRESOLVED`; Legal + Safety |
| Audit/security logs | `RESTRICTED`; accountability/security | System lifecycle | Approved security/legal window; PII minimized | Append-only; redaction/tombstone policy for data subjects | `UNRESOLVED`; Security + DPO |
| Event/inbox/outbox payloads | `INTERNAL` or higher by fields; consistency | Integration/replay window | Longer than outage/reconciliation target; payload allowlist | Purge by policy unless hold; retain hashes/metadata as approved | `UNRESOLVED`; SRE + DPO |
| Quote/pricing snapshots | `INTERNAL`; historical price proof | Quote through finance/audit | Finance/tax window if bound; short if abandoned | Non-personal components retained; addresses removed | `UNRESOLVED`; Finance + DPO |
| Earnings/COD/ledger/payout | `RESTRICTED`; accounting | Finance lifecycle | Statutory accounting/tax window | Posted journals retained; personal exports/redaction per law | `UNRESOLVED`; Finance + Legal |
| Notification tokens/results | `CONFIDENTIAL`; delivery of messages | Active installation/account | Remove stale/revoked tokens promptly; result window bounded | Driver may revoke; never log raw token | `PROPOSED`; Security + Product |
| Customer tracking grant | `CONFIDENTIAL`; link authorization | Active delivery/action | Short expiry plus revocation/audit metadata | Rotate/revoke; retain fingerprint only as approved | `UNRESOLVED`; Security + DPO |

## Handling requirements

- `PROPOSED`: collect minimum fields at the latest necessary time; do not copy the full customer or
  product record into Delivery.
- `PROPOSED`: encrypt transport and storage; private object storage uses short-lived authorized
  streaming/download, not stable public URLs. Key ownership and rotation are documented.
- `PROPOSED`: exact GPS, KYC, POD and finance exports require explicit permission, bounded filters,
  asynchronous generation, expiry and access audit.
- `PROPOSED`: strip photo EXIF unless an approved evidence field is extracted separately; validate
  MIME by content, pixels, size and decode; scan/quarantine according to security policy.
- `PROPOSED`: analytics use coarsened/de-identified data. No model training or secondary marketing
  use is authorized.
- `PROPOSED`: backups, replicas, logs, caches and dead letters follow the same classification and a
  documented deletion propagation schedule.

## Data-subject and incident workflow

- `PROPOSED`: BMS remains the authority for customer identity request resolution; Delivery searches
  opaque mappings and returns/export/deletes only its purpose-bound copies.
- `PROPOSED`: driver requests are resolved in Delivery. Posted finance/audit/legal records are
  retained where required but unnecessary direct identifiers are redacted/pseudonymized.
- `PROPOSED`: legal hold records reason, scope, approver, start/review/end; it suspends automated
  deletion for the exact data only.
- `PROPOSED`: incident response can revoke customer/driver/service grants, preserve scoped evidence,
  assess affected subjects/controllers and execute approved notification timelines.
- `UNRESOLVED`: DPO/Legal must approve controller/processor roles, lawful bases/consent wording,
  privacy notice, storage region, cross-border subprocessors, response SLAs and every retention value.

**STOP — Awaiting approval.**
