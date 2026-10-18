# Fleet Delivery Phase 2 completion report

Status: **COMPLETE — Phase 3 approved by the user on 2026-10-18**

Date: 2026-10-18 (Asia/Bangkok)

## 1. Implemented scope

- `VERIFIED`: immutable-version merchant settings cover enablement, Asia/Bangkok weekly same-day
  hours, explicit readiness policy, quote TTL, a PostGIS service polygon and versioned pricing.
- `VERIFIED`: authenticated synthetic BMS envelopes persist current order, item-eligibility,
  drop-off confidence and synthetic route snapshots without customer PII.
- `VERIFIED`: quotes validate tenant/branch mapping, merchant enablement/hours, service area,
  geocode confidence, unpaid order version, item eligibility and 15-minute snapshot freshness.
- `VERIFIED`: quote price/subsidy/commission inputs and results are snapshotted as exact integer
  satang with append-only components and an expiry timestamp.
- `VERIFIED`: delivery creation binds one unexpired/current quote, is idempotent and concurrency-safe,
  records the initial transition/audit/outbox event and posts one balanced shadow allocation journal.
- `VERIFIED`: the Phase 2 state machine accepts named actions plus expected aggregate version; clients
  cannot submit an arbitrary target state.

## 2. API and contract surface

| Operation | Required service scope | Behavior |
| --- | --- | --- |
| `PUT /v1/merchant/configuration` | `merchant.settings.write` | Activates a higher immutable config version |
| `POST /v1/integration/events` | `events.ingest` | Stores and applies validated order-context v1 events |
| `POST /v1/quotes` | `quotes.create` | Issues an expiring server-authoritative quote |
| `POST /v1/deliveries` | `deliveries.create` | Atomically binds quote, creates Delivery and shadow journal |
| `POST /v1/deliveries/:id/actions/:action` | `deliveries.transition` | Applies a named optimistic transition |

All mutation routes require a mapped service principal, JSON validation and rate limiting. All except
event ingestion require a valid `Idempotency-Key`; same key/body replays the saved response and a
changed body conflicts.

## 3. Database changes

- `0004_phase2_core.sql` adds the merchant, area, price, context, quote, delivery, transition and
  ledger tables, forced RLS, least-privilege grants, unique constraints and append-only protections.
- `0005_split_ledger_triggers.sql` uses a table-specific trigger per row type and deferred balance
  validation; it intentionally does not share incompatible `NEW`/`OLD` column references.
- `0006_protect_phase2_snapshots.sql` prevents mutation of versioned configuration/context, quote
  economics and Delivery authority/money snapshots.
- Migration apply is additive, checksum-protected and rerunnable. Rollback is forward repair; accepted
  jobs, quote history, transitions, audit and posted journals are not deleted.

Detailed rules: [pricing and quote policy](pricing-and-quote-policy.md),
[state transition matrix](state-transition-matrix.md), and [ledger design](ledger-design.md).

## 4. Verification

| Check | Result |
| --- | --- |
| strict TypeScript | PASS |
| pure contract/domain/API tests | PASS; 10/10 |
| migration apply/re-run | PASS; `0001`–`0006` on fresh database, then `[]` |
| DB/API integration suites | PASS; 3/3 |
| quote boundary cases | PASS; exact rounding, expiry, ineligible, stale and outside-area denial |
| idempotency/concurrency | PASS; replay, changed body conflict and one winner for concurrent create |
| state boundary | PASS; expected-version and skipped-transition rejection |
| tenant boundary | PASS; mapping denial plus RLS invisibility/rejected cross-tenant write |
| journal boundary | PASS; balanced generated journal, unbalanced commit rejection and posted immutability |
| production bundle and Compose health | PASS |

The test environment uses only randomized synthetic identifiers, an ephemeral signing key and
loopback PostgreSQL/Redis ports. Disposable containers and volumes are removed after verification.

## 5. Deliberate exclusions and remaining gates

- No live BMS adapter, Google Maps, driver, customer, notification, storage or payment provider call.
- No real customer/order data, location history, COD, driver earning, commission recognition,
  settlement, refund, payout, tax document or bank outcome.
- Phase 0 Legal/Tax/DPO/Finance/Safety/Operations decisions remain unresolved for the phases they
  block. The shadow journal prevents a future money-model fork but is not an accounting assertion.
- The route provider remains exactly `synthetic`; provider outage/fallback behavior will not invent
  distance, price or ETA.

## 6. Exact proposed Phase 3 scope

Implement synthetic driver identity/verification/tenant access, vehicle/availability/location
evidence, dispatch policy versions, sequential offers with bounded radius expansion, atomic single
acceptance, lease/recovery and manual escalation. Keep real drivers, mobile apps, BMS calls,
notifications, COD, earnings, settlement and payout disabled.

## 7. Gate

Phase 2 acceptance checks are complete. The user explicitly approved Phase 3 on 2026-10-18.
