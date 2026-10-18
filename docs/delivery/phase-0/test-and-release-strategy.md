# Test and release strategy

No implementation tests were run because Phase 0 changed documentation only. Repository validation
commands are recorded in the phase report. Each Evidence label applies to the whole row or bullet.

## Existing BMS gates

- `VERIFIED`: `cd apps/web && npm run gate` runs typecheck, DB-free contract suites and production
  build. It does not run DB tests, mobile Jest, desktop tests or live browser/device checks.
- `VERIFIED`: one BMS contract file can run with
  `node scripts/run-contract-tests.mjs <pure|db> <filter>`; a no-match filter fails.
- `VERIFIED`: approved GraphQL changes regenerate `schema.graphql` and need resolver/service/contract
  parity. DB suites use a local throwaway database, never production.

## Test pyramid and ownership

| Layer | Required coverage | Gate owner | Evidence |
| --- | --- | --- | --- |
| Unit/property | Exact money/rounding, state transitions, policy evaluation, canonical hash, token claims | Delivery team | `PROPOSED` |
| Migration/DB | Apply/re-run, constraints/indexes, RLS/object isolation, journal balance, lease recovery | DBA + Delivery | `PROPOSED` |
| Provider/consumer contract | BMS adapter operations, exact scalars, event schemas/version compatibility | BMS + Delivery | `PROPOSED` |
| API authorization | Every principal/permission/tenant/branch/object allow/deny, limits/errors | Security + teams | `PROPOSED` |
| Integration/E2E | Quote-to-delivery, handoff, delivered, cancel, return, reconciliation | QA + teams | `PROPOSED` |
| Concurrency | Quote bind, 100 offer accepts, handoff replay, journal/payout allocation | Backend + DBA | `PROPOSED` |
| Mobile/device | Android/iOS foreground/background/terminated, permission revoke, offline/clock/device loss | Mobile QA | `PROPOSED` |
| Security | Upload fuzz, token replay/revocation, IDOR, SSRF, secrets/dependencies, GraphQL complexity | Security | `PROPOSED` |
| Load/chaos | Approved pilot/target GPS, quote, dispatch, events; DB/Redis/storage/maps/push/BMS outages | SRE | `PROPOSED` |
| Backup/recovery | Restore to approved RPO/RTO, queue replay, credential rotation, migration rollback/forward | SRE + DBA | `PROPOSED` |

## Mandatory scenario suites

- `PROPOSED`: quote expiry/requote, order/address change, stale eligibility, exact rounding/subsidy,
  maps timeout/quota, duplicate create and changed body under same key.
- `PROPOSED`: duplicate/out-of-order/gapped/poison event, worker crash/lease reclaim, replay/backfill,
  BMS outage and reconciliation drift.
- `PROPOSED`: merchant not ready, failed BMS handoff, unknown handoff response, BMS version conflict,
  and no physical release before BMS success.
- `PROPOSED`: 100 simultaneous accepts, late/repeated accept, expired/rejected offer, stale/mock/out-of-
  order GPS, suspension, manual assignment and reassignment race.
- `PROPOSED`: malicious/corrupt/oversized photo, MIME mismatch, EXIF stripping, upload/confirm race,
  orphan cleanup, private read denial and storage outage.
- `PROPOSED`: every approved cancellation/failure/return cell; no post-pickup ordinary cancellation.
- `PROPOSED`: payment reversal/refund states, exact amount drift, balanced/reversing journal, duplicate
  payout, failed transfer and COD discrepancy only after Phase 6 approval.
- `PROPOSED`: leaked/expired/revoked customer token, service key rotation/revocation and every tenant/
  branch/object denial.

## Candidate pilot objectives — require approval and measurement

| Objective | Candidate pilot value | Evidence / owner |
| --- | --- | --- |
| Scope | Up to 3 tenants, 10 branches, 100 verified drivers, 50 concurrent active deliveries | `UNRESOLVED`; Product + Operations |
| GPS write load | 20 writes/s sustained, 50 writes/s burst; client cadence policy separately approved | `UNRESOLVED`; SRE + Privacy |
| Quote API | p95 <= 2 s excluding explicitly reported provider timeout; no fabricated result | `UNRESOLVED`; Product + SRE |
| Non-provider API | p95 <= 500 ms, p99 <= 1 s at pilot load | `UNRESOLVED`; SRE |
| Dispatch | p95 first-offer decision <= 5 s after ready, excluding driver response | `UNRESOLVED`; Operations + SRE |
| Tracking freshness | Label stale after 30 s; never display stale as live | `UNRESOLVED`; Product + Privacy |
| Availability | 99.5% monthly pilot for safe core APIs, with provider dependencies reported separately | `UNRESOLVED`; Product + SRE |
| Recovery | Candidate RPO <= 5 min and RTO <= 60 min, demonstrated by restore drill | `UNRESOLVED`; SRE + DBA |
| Degraded mode | No new quote/handoff when BMS authority unavailable; operator escalation within 15 min | `UNRESOLVED`; Operations + SRE |

These candidates are test inputs only after approval; they are not promises or current capabilities.

## Release sequence

1. `PROPOSED`: merge contract/schema changes disabled by feature switches; provider/consumer tests
   prove both deployed versions interoperate.
2. `PROPOSED`: deploy Delivery database/migrations and services with no intake; verify health,
   migration re-run, backup and synthetic smoke.
3. `PROPOSED`: deploy BMS adapter/event producer with production disabled; verify shadow events and
   reconciliation using synthetic tenant data.
4. `PROPOSED`: enable internal synthetic tenant, then one approved branch, with independent quote,
   intake, dispatch, GPS, notification, COD and payout switches.
5. `PROPOSED`: expand only after error/latency/drift/privacy and support review. COD/payout remain off
   until Phase 6 and separate launch approval.

## Rollback and compatibility

- `PROPOSED`: prefer forward-compatible rollback: stop new production, drain/retain durable rows,
  deploy previous compatible binary and reconcile. Never delete accepted jobs or posted history.
- `PROPOSED`: database migrations are additive/idempotent with a tested forward repair path; destructive
  rollback is not assumed. Cross-service migration order is recorded per release.
- `PROPOSED`: mobile/API compatibility supports the approved minimum app versions and rejects unsafe
  obsolete commands with structured upgrade errors.
- `PROPOSED`: production deploy, provider credentials, real users/messages/payments/COD/payouts each
  require separate explicit authorization.

## Phase 1 acceptance proposal

- `PROPOSED`: build/lint/typecheck, migration apply/re-run, DB isolation, service-auth negative tests,
  idempotency mismatch, outbox/inbox replay, worker lease recovery, `/livez`/`/readyz`, Compose smoke,
  secret scan and provider/consumer synthetic contracts pass.
- `PROPOSED`: Phase 1 creates no BMS mutation, live credential, real message, real driver/customer,
  Google/storage/push call or money journal.
- `UNRESOLVED`: final CI owner, runtime Node version, repository placement, numeric objectives and
  release approvers must be accepted first.

**STOP — Awaiting approval.**
