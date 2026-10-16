# Freemium restored-dump rehearsal (10.73–10.75)

This is an operator runbook. The first local restored-dump rehearsal completed on 2026-10-16;
see the evidence summary below for its exact scope and limitations. Pure tests and mocked browsers
alone cannot prove live schema, trigger/grant compatibility, or existing-shop workflows.

## Remaining work and resume checkpoint

**Recorded 2026-10-16: paused at the user's request to work on other features.** Local restore and
migration/service rehearsal completed; live E2E and pilot have not started. This checkpoint records
the last verified state, not a promise that later code changes or local resources remain identical.

### Agreed seven-step status

1. **Implemented:** usable Free plan and removal of the order hard limit.
2. **Implemented:** finite Business AI allowance, with the scheduled transition preserving the old
   allowance through the rollout month. This restored copy transitions on 2026-11-01 at 00:00 Bangkok;
   a future environment's effective date must be read from its own catalogue, not copied from here.
3. **Implemented:** central entitlement service, with existing RBAC checks retained.
4. **Implemented:** branch/device/channel admission limits and independent legacy capacity rights.
5. **Not started:** small-shop pilot and operational plan changes through platform admin.
6. **Instrumentation implemented; observation pending:** conversion cohorts and attributed AI costs.
   No real pilot results yet. Plan conversion is not proof of payment; unknown cost stays NULL.
   These figures do not include infrastructure, storage, support or total operating margin.
7. **Deferred, not implemented:** recurring billing, after the pilot and a separate agreed scope.

### Outstanding checklist, in order

- [ ] Run live browser E2E against the isolated test backend (not mocked GraphQL): login/RBAC,
  Billing, platform-admin plan changes, capacity errors and upgrade/downgrade behavior. Cover both
  legacy policy 1 and fresh policy 2 shops, Thai/English and desktop/mobile layouts.
- [ ] Exercise the pilot's actual POS clients/devices: pairing/re-pairing, sale/payment/stock,
  idempotent replay and shift close. Use synthetic shop identities and orders only. The restored
  service tests passed, but do not certify physical devices or browser-to-server workflows.
- [ ] Check the integrations the pilot will enable using explicit test accounts/sandbox transports:
  AI calls and cost attribution, channel delivery and scheduled-report delivery as applicable.
  Restored credentials and queued production jobs must never be used. Leave unverified integrations
  disabled; external payment/provider billing and production performance are not proven here.
- [ ] Agree pilot shops, duration, owner/support process, success metrics, stop conditions and a
  reviewed rollback procedure. Include both legacy continuity and fresh-policy admission behavior;
  changing a legacy shop's plan alone does not exercise the new feature/capacity gates.
- [ ] Obtain explicit authorization for pilot execution/environment and collect conversion,
  quota/admission failures, shop disruption and priced/unpriced AI-cost evidence. A production pilot
  or deployment is outside the current authorization. Local rehearsal success alone is not approval.
- [ ] Evaluate pilot results before scoping recurring billing; add non-AI operating costs if making
  margin/pricing decisions. Do not interpret platform-admin upgrades as collected revenue.

### Where to resume

- Working branch at handoff: `codex/freemium-phase-one`. The worktree contains existing modified
  and untracked implementation files. Inspect status/diffs before resuming; do not reset, overwrite,
  or assume this checkpoint means the work was committed. Preserve unrelated feature work.
- Read this runbook, the latest `docs/feature-log.md`, repository instructions and relevant domain
  invariants. Re-run affected checks if intervening features changed these paths. Verification
  counts below describe the recorded run, not the current checkout automatically.
- Original archive and private evidence are under
  `C:\Users\somkid_voovadigital\Desktop\bms-rehearsal-T8oq1UW8`, with results in
  `evidence-20261016`. Do not edit the original dump or commit dumps, credentials or customer data.
- Last known local Docker context: `desktop-linux` using the local named-pipe engine. Verify the
  endpoint and object labels again before any start/write. Rehearsal objects use
  `bms.task=freemium-restored-rehearsal`; do not start the project's normal production Compose stack.
- The completed database container is `bms-freemium-restore-1611`, volume
  `bms-freemium-restore-1611-pgdata`, internal network `bms-freemium-restore-network`.
  Its fixed-target relay is `bms-freemium-restore-relay` at `127.0.0.1:55476`.
  The older `bms-freemium-restore` container is only an incomplete setup attempt, not the verified DB.
  All three containers were stopped at handoff; inspect availability before reusing anything.
- Keep `bms_realtime_test` for original-data comparisons. Write tests use disposable
  `bms_rehearsal_workflow_before` / `bms_rehearsal_workflow_after` copies with the rehearsal marker.
  Prior synthetic fixtures remain in those copies. Follow the suite's guards below rather than
  redirecting it at the comparison DB. Do not replay all historical migrations from an empty DB.
- **Next actionable task:** prepare an isolated app configuration against a disposable test copy,
  prove outbound transports/workers are disabled or test-only, then run the live E2E checklist.
  Do not start an app against the restored credentials/queues without that isolation review.

Legacy access is specific: feature policy 1 preserves scheduled reports and Retention access;
capacity policy 1 preserves branch/device/channel capacity. It does not promise unlimited AI
forever or exemptions from all product/user admission rules. Core shop operations remain ungated.
Production remains untouched; no automatic deployment, pilot or recurring charge is authorized.

## Isolation and prerequisites

Use the separate cluster in [realtime-test-database.md](realtime-test-database.md), including its
role/bootstrap and restore instructions. Restore into `bms_realtime_test` ONLY, from a fresh dump
with schema, data, policies and grants. Never restore over an existing production/dev database.
Keep the original dump immutable. Record its SHA-256, timestamp and source migration version in
a private rehearsal record (not Git). Do not paste customer data or credentials into logs/chat.

Start only the database, not Web/scheduler/workers. Restored channel credentials, pending mail,
payments and webhook jobs must never be replayed to external services. Do not add production
environment files. Before application workflow tests, use synthetic identities and blocked/mock
network transports; never send email, chat, refunds or shipping requests to real recipients.

Verify the restored baseline before applying anything. In particular preserve realtime function
ownership, `bms_realtime_dispatcher` BYPASSRLS, all required table/sequence grants, and `bms_app`
without SUPERUSER/BYPASSRLS. Restore errors are failures, not ignorable warnings. The baseline must
already support the prerequisite schema through 10.72; do not replay all migrations from zero.

## Capture and compare (psql on the rehearsal machine)

Use an existing secure local PostgreSQL connection configuration to the isolated test instance.
Do not put a password in command history. The following commands use paths relative to this repo.
Use the isolated restore superuser: the script refuses a restricted role whose RLS could hide rows.
`freemium-rehearsal-snapshot.sql` is read-only with a repeatable-read snapshot, refuses other database
names, checks required table grants, and prints resource counts/fingerprints, policy distributions,
global plan metadata and trigger definitions (not customer rows).
Capture stdout **and stderr** into private evidence files; stop on every nonzero exit.

```sh
psql -X -d bms_realtime_test -v ON_ERROR_STOP=1 -f db/checks/freemium-rehearsal-snapshot.sql

psql -X -d bms_realtime_test -v ON_ERROR_STOP=1 -1 -f db/migrations/10.73__bms_freemium_phase_one.sql
psql -X -d bms_realtime_test -v ON_ERROR_STOP=1 -1 -f db/migrations/10.74__bms_feature_access.sql
# 10.75 contains its own BEGIN/COMMIT; do not wrap it in another -1 transaction.
psql -X -d bms_realtime_test -v ON_ERROR_STOP=1 -f db/migrations/10.75__bms_capacity_and_package_metrics.sql

psql -X -d bms_realtime_test -v ON_ERROR_STOP=1 -f db/checks/freemium-rehearsal-snapshot.sql
```

Repeat the three migration commands in the same order, then capture a third snapshot. Keep the
restored instance quiescent through all three snapshots. Expected differences:

- Every `FINGERPRINT` line remains identical, including orders, inventory, payments, devices,
  users/RBAC, schedules, Retention cases and historical AI usage/credits. A difference is a stop.
  The script covers every ordinary/partitioned public table (not partition children twice), except
  `bms_plans` and `bms_package_events`, whose intentional changes are checked separately.
- Existing tenant policy distributions are unchanged (an absent column counts as legacy 1).
  New column defaults are 2; neither rerun nor plan changes may re-grandfather a version-2 tenant.
- Plans have the agreed product/staff/order/capacity matrix. Business's previous AI allowance and
  effective Bangkok deadline are captured once, and **do not change on rerun**.
- `bms_package_events` is the intentional new evidence table: one baseline per pre-10.75 tenant,
  RLS enabled, SELECT/INSERT for bms_app, no UPDATE/DELETE. It is not a business-resource fingerprint.
- Existing realtime owners/triggers are unchanged. A restored wrong owner or missing sequence
  privilege must be fixed as a restore/pre-existing issue and baseline rechecked, not hidden by
  disabling triggers or broadening application privileges.

## Workflow evidence after the snapshots

Use disposable fixture shops/resources in the **restored schema**, not the real customer rows.
Compare the same tests before/after where baseline supports the behavior. Synthetic-schema
`freemium-*-db-contract` tests are useful separately but do not replace this step.

1. Read old shop entitlements, including shops above new limits. Edit/re-enable existing branches,
   POS devices and channel connections; issue/re-pair a test device without creating a new device.
2. Exercise existing POS sale/payment/stock/shift workflows with fixture data and stable idempotency
   keys. Verify money, stock movement, audit and realtime outbox commit together; replay is a no-op.
3. Read/edit an old scheduled report; render to a captured test transport only. Read/transition and
   reconcile existing Retention cases after a downgrade, without generating new locked cases.
4. Check AI allowances before/after the scheduled Bangkok boundary without resetting old usage,
   bonuses or adjustments; mock providers. Cost evidence must never block valid points.
5. Create a fresh fixture shop after rollout: defaults 2/2; parallel additions respect Free 1/1/1,
   Pro 1/3/3 and Business 5/10/unlimited. Disabled registrations still count. Upgrade then downgrade:
   existing identities stay usable; only additions lock. Cross-tenant attempts remain denied.
6. Verify platform-only metrics and append-only event RLS, repeat/no-op plan changes, failed
   telemetry/audit cases, and unknown AI cost mixed with zero-call events. No payment is inferred.

If any before/after behavior differs unexpectedly, stop rollout, retain private failure evidence,
fix code/new migration as needed, and repeat from a fresh restore. Never rewrite 10.73–10.75 after
they have been applied to another environment. Application rollback leaves policy columns and
evidence intact; dropping/recreating them would re-grandfather newer shops. An older application
that ignores the AI transition also needs the reviewed catalogue rollback described in 10.73.

Production deployment, real-shop pilot selection, and recurring collection remain separate steps
requiring explicit authorization. No command in this runbook authorizes them.

## Local restored-dump evidence — 2026-10-16

- Source: user-provided PostgreSQL 16.11 custom archive plus roles, outside Git. SHA-256 matched
  the supplied checksums. Original dump files were not edited. Restore used `--exit-on-error`
  and `--single-transaction`, preserving object ownership and ACLs (no `--no-owner`/`--no-acl`).
- Isolation: Docker Desktop's local named-pipe engine; a new dedicated volume and internal network,
  PostgreSQL 16.11, logical-replication workers disabled. No Web, scheduler, mail or channel workers.
  Docker's internal network did not expose its published DB port to Windows; a credential-free,
  fixed-target Node TCP relay provided **127.0.0.1:55476** only. The database itself remained on
  the internal network. Integration tests reject other DB names/ports and external socket/HTTP I/O.
- Restore prerequisite found: the roles file's `GRANT bms_app TO app ... GRANTED BY app` fails
  because the named grantor lacks ADMIN OPTION. This happened with both 16.15 and 16.11, so it is
  not a patch-version diagnosis. After reviewing the complete roles file, the one failed membership
  was restored by `rehearsal_admin` with the same effective options: ADMIN=false, INHERIT=true,
  SET=true. **Only the grantor differs** in the isolated cluster; the original roles file is intact.
  No production privilege was changed and no broad privilege was added to `bms_app`.
- Baseline: 29 restored shops; neither policy-version column existed. Required app table grants
  passed. Separate workflow copies were made before and after migration so fixture writes never
  contaminate the main before/after data comparison.
- All migrations 10.73–10.75 succeeded, then succeeded again. All **348 existing public-table
  fingerprints** matched before, after and after rerun, excluding only the two intentionally added
  tenant policy fields. The plan catalogue and new baseline evidence were identical on rerun.
- All 29 shops became feature/capacity version 1; new defaults are 2. There are 29 BASELINE events.
  Business retains its previous -1 allowance until **2026-11-01 00:00 Asia/Bangkok**, then 5,000.
  No existing usage/bonus/adjustment rows were reset. Schema diff contains only the intended new
  columns, constraints, comments and package-event table/indexes/RLS/ACLs; old ownership, policies,
  functions and triggers did not change. `bms_app` has SELECT/INSERT, not UPDATE/DELETE, on events.
  A further rerun on the workflow copy after creating version-2 shops preserved the complete
  tenant-to-policy mapping: newer shops were not re-grandfathered.
- `freemium-restored-db-contract`: baseline 7 passed / 2 deliberately skipped (10.75 absent),
  migrated copy 9 passed. Covers every original shop's effective legacy access; fixture edits and
  device token issuance; cash sale/payment/stock/audit/outbox/replay/shift close; report saves and
  summary computation without delivery; existing Retention transitions after downgrade; concurrent
  new-device admission; cross-tenant event denial; real PostgreSQL telemetry lock timeout and parent
  transaction survival; scheduled AI allowance boundary; distinct conversion and unknown-cost totals.
- `ai-entitlement-authority-db-contract`: 5 passed before and 5 after, covering live platform-admin
  authority/revocation and twenty concurrent contenders for the last Free/Pro AI point. No inference
  request is made. These are targeted restored-schema checks, not a claim that every DB suite ran.
- Private evidence lives beside the dump in `evidence-20261016`: snapshots, schema diff, migration
  logs and before/after TAP output. Never commit that directory, copied customer rows or credentials.
- All rehearsal containers were stopped after verification. The original dump, dedicated database
  volumes and before/after workflow copies are retained locally; no unrelated container was stopped.

This proves the tested local migration and service paths against this dump. It does not prove
browser/device end-to-end behavior against a live server, actual channel/report delivery, external
payments, provider billing, or production performance. Real-shop staging pilot and production
deployment remain separate approvals. No application behavior or migration SQL needed changing
as a result of this rehearsal; the fixes were restore setup and the test fixture's required branch.

The opt-in suite requires a disposable copy named `bms_rehearsal_workflow_before` or
`bms_rehearsal_workflow_after`, database setting `bms.rehearsal='isolated-restored-copy'`,
`BMS_RESTORED_REHEARSAL=1`, `BMS_DEPLOYMENT_MODE=cloud`, and local connection variables. Run through
`node scripts/run-contract-tests.mjs db freemium-restored`. Fixtures remain in the disposable copy
for inspection; do not point the suite at the pristine snapshot database or a shared database.
