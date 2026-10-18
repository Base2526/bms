# Fleet Delivery release and recovery runbook

This runbook is a reviewable procedure, not authorization to deploy. Commands must target a confirmed
Fleet Delivery environment; never substitute the BMS database or production into local examples.

## Pre-release evidence

1. Record the commit, immutable image digests, migration range and compatible BMS adapter version.
2. Attach `npm run gate`, `npm run test:db`, dependency/secret/image scan and approved load results.
3. Record named approvals for Security, SRE, Product, Operations, DPO/Legal and, when relevant,
   Finance/Tax. Do not treat a Git approval as business-policy approval.
4. Confirm service JWKS, issuer and audience come from the environment secret manager. Test the new
   verification key before retiring the old key; never log or commit a signing key/token.
5. Confirm an encrypted backup and restore target, measured RPO/RTO, monitoring, paging owner and
   rollback decision owner. Verify storage region and retention/legal-hold policy.
6. Confirm every production capability switch remains off unless its own gate and authorization are
   attached. COD/payout cannot inherit general release approval.

## Deployment sequence

1. Stop new intake while retaining durable inbox/outbox, assignments and audit history.
2. Take and verify the approved backup. Apply additive migrations with the migration owner only.
3. Rerun migrations and require an empty applied list. Never edit an applied migration checksum.
4. Start API/worker with no production intake. Require liveness, readiness and dependency telemetry.
5. Run mapped synthetic tenant checks for auth denial, RLS isolation, idempotency replay, event gap,
   operations reads and worker lease recovery.
6. Enable only the specifically approved tenant/branch capability and observe error, latency, queue
   age and reconciliation indicators through the approved soak interval.

## Forward-compatible rollback

1. Disable new intake and dispatch production, then mark the incident/release state.
2. Do not delete or rewrite deliveries, transitions, inbox/outbox, audits or posted shadow journals.
3. Keep workers running only when the previous binary is contract-compatible and processing is safer
   than pausing. Otherwise stop claims and preserve leases/rows for reconciliation.
4. Deploy the last compatible binary by immutable digest. Apply a reviewed forward repair migration
   when schema correction is needed; never downgrade by dropping accepted history.
5. Reconcile every unknown external outcome with the original idempotency key before reenabling.

## Backup/restore verification for the disposable local stack

With the isolated Compose PostgreSQL/Redis healthy and migrations applied:

```bash
infrastructure/fleet-delivery/scripts/verify-backup-restore.sh
```

The script accepts only a restore database name ending in `_restore_verify`, restores a custom-format
dump, checks migration/RLS/finance/index invariants and deletes the restored database and dump on exit.
It must not be used as the production backup scheduler or retention mechanism.

## Incident actions

- **Database unavailable:** readiness fails; stop intake/dispatch, preserve unknown outcomes, page the
  DBA/SRE owner and restore only through the approved recovery plan.
- **Redis unavailable:** rate-limited API operations fail closed. PostgreSQL remains workflow truth;
  never bypass rate limiting or recreate durable state from Redis.
- **Suspected service-key compromise:** disable/revoke the principal or key, stop intake, retain audit
  evidence, rotate with overlap only for uncompromised callers and review mapped tenant activity.
- **Inbox gap/body mismatch:** do not invent an event. Keep `ACTION_REQUIRED`, obtain an authenticated
  authoritative snapshot and reconcile through the bounded issue queue.
- **Worker/outbox backlog:** stop expansion, inspect oldest age/attempt/error without exposing payload
  PII, repair destination/consumer, then resume bounded claims. Never bulk-mark rows published.
- **Cross-tenant or private-data exposure:** disable the affected surface, preserve logs/audit, notify
  the named incident/DPO owner and do not self-decide notification or deletion obligations.
- **Finance/COD/payout signal:** those capabilities should be disabled. Freeze the path and escalate;
  never add a manual database write to simulate collection, settlement or confirmation.

## Key rotation drill

Publish the new public verification key, verify tokens signed by both keys during the approved overlap,
switch callers, revoke the old key/principal, prove old tokens fail and retain only safe fingerprints in
the incident/change record. Rotation of private signing keys happens in the owning secret system, not
in this repository.
