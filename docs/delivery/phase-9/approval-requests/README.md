# Phase 9 approval request bundle

Status: **READY TO SEND / NOT DISPATCHED / NO APPROVAL IMPLIED**

This bundle turns the open Phase 9 decisions into reviewable requests. It does not implement or
enable production authentication, real-driver identity/KYC, POD, customer contact, COD, earnings or
any other blocked capability. A coding instruction is not an owner approval.

## Dispatch state

Six recipient-free Gmail drafts were prepared, but no named authorized recipients were available.
`approval-requests.json` therefore remains `NOT_DISPATCHED`. Add only a real person holding the
listed role, then send and store a durable, access-controlled response reference—never credentials,
KYC, POD, coordinates, raw findings or customer PII here.

## Capability sequence after approval

1. Production authentication: select the identity provider, MFA/recovery policy, registered-device
   model, token claims/TTL/rotation, remote revocation and support workflow. Implement this first;
   every later driver feature depends on a verified real-driver principal.
2. Driver identity/KYC: implement purpose-specific private uploads, quarantine/scan, reviewer RBAC,
   expiry/reverification, suspension and audited access using the approved field/retention schedule.
3. POD: implement job-bound upload intents, content validation/EXIF stripping, private streaming,
   evidence state transitions, dispute/legal hold and deletion propagation. A URL is never proof.
4. Customer contact: implement approved masking/relay only for an active assignment, with purpose,
   rate/time bounds, revocation, abuse escalation and no raw contact in mobile persistence or logs.
5. COD/earnings: implement exact-satang policy, immutable balanced journals, custody events,
   discrepancy freeze, period controls and separation of duties before any payable/payout surface.
6. Run every required non-production exercise, physical-device suite and recovery/provider drill.
7. Record named approvals with durable evidence in `readiness-gates.json`; run the Phase 9 evaluators.
8. Even `PILOT_READY` still needs a separate Phase 10 production authorization and bounded cohort.

The code remains fail closed until steps 1–7 are complete. Do not pre-add native permissions,
provider credentials, private buckets, contact providers or finance mutation endpoints.

Run `npm run approval-requests:verify` to confirm every blocked gate and required approval role is
covered by a packet while the request bundle itself grants no authority.
