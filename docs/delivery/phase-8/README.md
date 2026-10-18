# Phase 8 — security and release-readiness foundation

Status: **NO-GO FOR PRODUCTION**.

This phase hardens and verifies the synthetic foundation. It is not production authorization and
does not close policy, legal, privacy, safety, SRE or cross-system gates owned outside Engineering.

## Implemented controls

- Every JSON response carries `no-store`, `nosniff`, deny-framing, no-referrer, restrictive CSP and
  camera/geolocation/microphone denial headers.
- The HTTP server bounds request time, header time/count, keep-alive time and requests per socket.
- `/readyz` fails with 503 when PostgreSQL or Redis is unavailable and immediately enters a distinct
  draining state during shutdown. Shutdown stops acceptance, closes idle connections and has a
  bounded forced-close fallback before dependency clients close.
- The runtime images remain non-root (`node`), read-only, all Linux capabilities dropped and
  `no-new-privileges` enabled. Development ports remain loopback-only.
- CI rejects high/critical API/worker production dependency vulnerabilities before build/tests. The
  mobile job separately binds its current advisory count/set, rejects drift or any production-enabled
  plan while findings remain, and keeps the known high-severity findings visible as a release blocker.
- The backup/restore verifier restores into an explicitly named disposable database and checks
  migration history, forced RLS, Phase 6 finance guards and Phase 7 operations indexes before cleanup.
- Release, rollback, incident, credential-rotation and recovery steps are documented in the runbook.
- The current synthetic API/event inventory is frozen in a separate document so disabled and absent
  capabilities cannot be mistaken for implemented production behavior.

## Verification evidence

- strict TypeScript, 43 DB-free tests and production API/worker bundles pass;
- four DB/API suites pass on fresh migrations `0001`–`0010`; migration rerun applies nothing;
- backup/restore verification passes against a separate restored PostgreSQL database;
- API and worker runtime images build and start with `/readyz` healthy;
- container inspection confirms `user=node`, read-only root filesystem, `cap_drop=ALL` and
  `no-new-privileges=true`;
- the API/worker production dependency audit reports zero vulnerabilities;
- the separate React Native lockfile has deterministic provenance and license checks, while its
  production audit reports 20 high-severity and zero critical transitive React Native/Metro/CLI
  advisories; these remain an explicit release blocker rather than being hidden by the root audit;
- Compose validation and diff whitespace checks pass.

The restore exercise validates mechanics and selected controls on local synthetic data only. It does
not establish an approved RPO/RTO, encrypted/offsite backup, production data volume, point-in-time
recovery, regional failover or an operator drill.

## Production blockers

- `RTK.md` referenced by repository instructions is still missing.
- Real driver identity/device/KYC, mobile privacy, exact-location retention, evidence storage and
  safety/support policy are not approved or implemented.
- Mobile native signing, physical-device certification and resolution or Security acceptance of the
  20 high-severity React Native toolchain advisories are absent.
- BMS handoff/stock authority, customer tracking grants, provider integrations and cross-system E2E
  remain blocked.
- COD, commission recognition, earnings, settlement, refund, payout, transfer and tax remain disabled.
- Admin placement, federation, platform scope, private evidence access and finance separation of
  duties remain unresolved.
- SLO, pilot volume, retention, RPO/RTO, alert thresholds, infrastructure topology, key rotation
  ownership, incident commander and risk-acceptance authority are not approved.
- No independent security review, real-device suite, provider failure suite, approved-volume load
  test, regional restore or production deployment rehearsal has occurred.

## Go/no-go decision

**NO-GO.** Keep all real users, providers, BMS mutations, physical handoff, private evidence and real
money disabled. A future go decision requires every blocker above to have named evidence and owner
approval, followed by the complete checklist in `release-and-recovery-runbook.md`. Production deploy
still requires a separate explicit authorization.
