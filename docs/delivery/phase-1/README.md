# Fleet Delivery Phase 1 completion report

Status: **COMPLETE — Phase 2 approved by the user on 2026-10-18**

Date: 2026-10-18 (Asia/Bangkok)

## 1. Objectives and verified assumptions

- `VERIFIED`: the accepted same-repository/separate-deployment layout is implemented with independent
  API, worker, contracts, domain, database, shared and infrastructure paths.
- `VERIFIED`: the foundation uses Node 22, strict TypeScript, PostgreSQL 16 + PostGIS, Redis, private-
  storage interface, versioned contracts, service-auth verifier and durable reliability primitives.
- `VERIFIED`: no BMS database/API mutation, driver/customer workflow, provider call, real credential,
  notification, COD, payout, commission settlement or production deployment was created.

## 2. Implemented architecture decisions

- `VERIFIED`: `fleet-delivery` namespace avoids existing BMS `deliveryPlatforms` routes/permissions.
- `VERIFIED`: cross-service money helpers accept integer satang/canonical THB decimal only.
- `VERIFIED`: event envelope v1 is strict/versioned; inbox detects duplicate identity and changed-body
  conflict.
- `VERIFIED`: service JWT verifier enforces issuer, audience, algorithm, expiry, subject, jti, scope,
  key id and database-backed jti/key revocation. Tokens do not grant tenant scope.
- `VERIFIED`: integration mappings derive principal/tenant/branch association server-side before a
  tenant transaction sets a fail-closed RLS GUC.
- `VERIFIED`: outbox workers claim through bounded `SKIP LOCKED` security-definer functions; API role
  cannot use worker functions and worker role has no direct table grants.

## 3. Files and components

| Component | Paths |
| --- | --- |
| API and health/auth/ingestion | `apps/fleet-delivery-api/` |
| Synthetic outbox worker | `apps/fleet-delivery-worker/` |
| Wire/exact-money contracts | `packages/fleet-delivery-contracts/` |
| Canonical request/idempotency domain helpers | `packages/fleet-delivery-domain/` |
| Pool, tenant tx, migrations, inbox/outbox | `packages/fleet-delivery-database/` |
| Env, Redis and disabled object-store abstraction | `packages/fleet-delivery-shared/` |
| Isolated Docker/PostGIS/Redis stack | `infrastructure/fleet-delivery/` |
| Dedicated CI | `.github/workflows/fleet-delivery-gate.yml` |

## 4. Migration and compatibility impact

- `VERIFIED`: `0001_foundation.sql` creates only the separate Delivery schema/database objects:
  integration mapping/revocation, tenant-RLS inbox/outbox/idempotency/audit tables and worker claim/
  complete/fail functions. `0002_restrict_outbox_app_grant.sql` removes direct outbox updates from
  the API role so only worker functions can publish/fail rows. `0003_bind_mapping_producer.sql`
  prevents a mapped principal from impersonating another event producer name.
- `VERIFIED`: migration filenames are ordered, checksummed and advisory-lock serialized; re-run is a
  no-op. No existing BMS migration, schema, GraphQL contract or compose service changed.
- `VERIFIED`: root npm workspace includes only new `fleet-delivery-*` workspaces; existing application
  package manifests and gates are unchanged.

## 5. Commands and actual results

| Command / check | Result |
| --- | --- |
| `npm install --ignore-scripts` | PASS; 98 packages audited, 0 vulnerabilities |
| `npm run gate` | PASS; strict typecheck, 6/6 pure tests, API/worker bundles |
| `docker compose ... config --quiet` | PASS |
| `docker compose ... up -d --build` | PASS after replacing amd64-only upstream PostGIS image with a multi-architecture local build |
| `GET /livez`, `GET /readyz` | PASS; readiness reported database and Redis `ok` |
| migration container first and second run | PASS; fresh database applied `0001`–`0003`, second applied `[]` |
| `npm run test:db` against disposable PostGIS/Redis | PASS; 2/2 DB/API integration suites |
| live worker `synthetic://ack` outbox smoke | PASS; row reached `PUBLISHED` |
| dependency audit | PASS; 0 vulnerabilities reported by npm |

The first DB-test attempt exposed a test-harness issue: an intentional RLS rejection aborted the test
transaction before its visibility assertion. The test now isolates the expected rejection with a
savepoint and passes. The initial ARM Docker attempt exposed that the selected upstream PostGIS tag
was amd64-only; dev Compose now builds PostGIS from the multi-architecture PostgreSQL image. Host-side
API integration tests use a loopback-only Redis port (`127.0.0.1:56379`); it is not publicly bound.

## 6. Invariants checked

- `VERIFIED`: tenant RLS rejects a write for another tenant and hides that tenant's rows.
- `VERIFIED`: same message id/body is a duplicate success; same identity/different body conflicts.
- `VERIFIED`: an ephemeral signed service token can ingest only through its active server-side tenant/
  branch mapping; an unmapped tenant returns 404.
- `VERIFIED`: migration checksum/re-run and worker lease ownership are exercised.
- `VERIFIED`: missing, forbidden and revoked service tokens are denied in unit tests.
- `VERIFIED`: production API startup requires verifier configuration; development without a synthetic
  key returns service-auth-unavailable rather than accepting requests.
- `VERIFIED`: no client tenant id alone grants scope; an active server mapping is mandatory.

## 7. Remaining gaps and risks

- `UNRESOLVED`: no production issuer/key-distribution/mTLS/network or credential-rotation environment
  exists; creating one requires separate authorization.
- `UNRESOLVED`: storage remains deliberately disabled, and Google/push/BMS adapters do not exist.
- `UNRESOLVED`: Phase 0 legal, tax, DPO, driver, liability, COD and payout decisions remain blocked
  for their later phases.
- `VERIFIED`: the API route stores approved synthetic envelopes only as `STORED_NO_HANDLER`; it does
  not run business actions.

## 8. Rollout and rollback

- `VERIFIED`: only a loopback-bound disposable development Compose stack was started. No production
  deploy or external resource was created.
- `PROPOSED`: rollout remains feature-disabled until consumer/provider contracts and later phase gates
  pass. Rollback stops intake/worker and deploys a compatible binary; database repair is forward-only.

## 9. Exact proposed Phase 2 scope

- Implement synthetic merchant settings/service area/hours/readiness, eligibility snapshots, expiring
  exact quotes, quote components, delivery aggregate/state transitions and minimum balanced shadow
  journals.
- Keep all BMS calls, real users/messages, driver matching/app, COD, payouts and real finance disabled.
- Add migration/RLS/property/API/concurrency tests for quote expiry, exact rounding, duplicate create,
  changed-body idempotency, state transitions and balanced journals.

## 10. Gate

Phase 1 acceptance checks are complete. The user explicitly approved Phase 2 on 2026-10-18.
