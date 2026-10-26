# scripts/ — ชุดเทสและเครื่องมือตรวจของ repo นี้

## Operations integration regressions

`node scripts/run-contract-tests.mjs pure operation-integration-regression` executes the real
evidence, reservation, quality-stock and restock services with substituted database/storage/channel
boundaries. Covers the production `files` role restriction, denied reads, upload rollback and lost
commit, missing versus empty stock, held/expired lot availability and suppression of false restock
messages. The checklist DB fixture also denies `bms_app` SELECT on `files` to match migration 9.28.
These DB-free tests do not replace the disposable PostgreSQL suites.

`node scripts/run-contract-tests.mjs pure operation-pos-integration` covers Desktop/native scan
and variant availability, restaurant menu stock policies, branch summaries, multi-line transfer/count
rollback with decided hold outcomes, transactional inventory invalidation, and native GraphQL
operation compatibility. `apps/mobile` additionally exercises usable scan quantities and pack limits
in its CatalogProvider Jest suite. These do not certify native hardware or a packaged app.

## Materials and receiving — Release G

- `node scripts/run-contract-tests.mjs pure operation-material`: integer/window/source validation
  and deterministic stock allocation. The full `npm run gate` also checks i18n/schema/adapters/build.
- DB filter `operation-material`: restored disposable `127.0.0.1:5433/bms_realtime_test` only;
  requires current base schema plus operations 10.91–10.96, applies 10.97 twice. Covers frozen demand,
  partial/final/rejected receipt, explicit separate review, movement/lot/value atomic rollback,
  concurrent receiving/replay, stale stock/run/unit, external-receipt unknowns, PO allocation conflict,
  branch requests, RBAC/branch/tenant/RLS, scoped cron dedupe and full test-tenant purge. Boundary
  fixtures prove the 500th link/inspection remains readable and the 501st creates no orphan PO/task;
  rescheduling a production run preserves historical detail while blocking new supply.
  POS legacy receive idempotency is exercised using the same purchase wrapper. Fault injection and
  fixtures write only disposable test data and remove it afterward; never point at production.
- Regressions: DB `operation-production`, `operation-improvement`, `restaurant-actual-costs`,
  `stock-ledger`, `pos-scan-manager`; A–D `operation-checklists` uses isolated `bms_operations_test`.
  `branch-requisitions` uses isolated `bms_requisition_test` with current schema (including G and the
  existing 10.89 purge dependencies), not a reduced empty schema.
- `node scripts/operation-material-browser-smoke.mjs`: local production Next at :3018, real compiled
  route/SDL with mocked auth/GraphQL. English/Thai × 1280/390, PO form, reviewed receipt confirmation,
  lost-response retry key, historical-only warning, refresh, forbidden tab, no horizontal page overflow. Screenshots under
  `.test-output/operation-material-browser/`. This does not claim a live-store end-to-end UAT.

2026-10-24 completion/recheck: G DB 22/22, repeated under `TZ=UTC` 22/22; A–D 32/32,
E 28/28, F 18/18, actual costs 20/20, stock ledger 8/8, branch requisitions 18/18.
The POS scan-manager source-contract suite passed 7/7 (not an actual DB execution claim).
Final gate: typecheck, 3,040 pure passed / 6 conditional skips / 0 failures, production build passed.
G browser passed all four language/width combinations, including historical-only recovery and manual;
A–F browser regressions also passed all four combinations each. Logs: `.test-output/release-g-*.log`.
No production migration/deployment or real-store UAT was performed.


## Operations improvement — Release F

2026-10-24 follow-up recheck fixed four edge cases:

- Partial SOP carry displayed learning from the reset basis: detail reads now match each kind to
  its own basis. Tests exercise ACK-only carry and training-only carry while preserving old versions.
- Followup selection filtered eligibility after the 50-row cap: the `FOLLOWUP` catalog kind now
  filters ACTIVE/separate-review templates before limiting, tested with 55 retired templates.
- Weekly readiness snapshots lacked exact evidence identities: new snapshots pin learning/basis IDs
  and detect same-verdict reassessment, preserving the original immutable snapshot.
- Readiness refreshed by history length, which stops changing at 100: each successful refresh now
  remounts the readiness read. Browser regression fills the history to 100, records PRACTICE after
  PASS and verifies the readiness warning changes without reopening the drawer.

Recheck DB runs: F **18/18**, E **28/28**, A–D **32/32**, actual-cost **20/20**, ledger **8/8**
(**106 passed**), on the same isolated databases described below. `npm run gate` passed typecheck,
**3,072 pure tests / 6 skipped / 0 failed**, and production build. Logs are
`.test-output/release-f-recheck-gate.log` and `release-f-recheck-<suite>.log`; the deliberately red
pre-fix regression run is `release-f-recheck-before.log`. No new migration is required by these
corrections; F still requires 10.95/10.96.
F/E and A–D regression browser rechecks passed on the new production build in en/th at 1280px and 390px, including the
100-row reassessment regression and server-side FOLLOWUP selector assertion. Browser logs use
`release-f-recheck-<suite>-browser.log`. The schema-readiness recheck again reports only the existing
unrelated 10.89 gap (`release-f-recheck-readiness.log`); all operations requirements pass.

- Pure filter `operation-improvement`: seven-day calendar bounds and exact decimal waste totals,
  including unknown costs and separate acknowledgement/assessment permissions.
- DB filter `operation-improvement`: restored disposable `127.0.0.1:5433/bms_realtime_test` only;
  A–E prerequisites first, applies 10.95/10.96. Covers immutable SOP versions, ACK/TRAINED/assessment
  separation, carry/reset bases, self/branch/tenant isolation, concurrent publication, replay,
  atomic audit rollback, unique FAIL linkage, canonical followup/assignment notice, assignee brief,
  separate review, closure/reopen cycles, report cohorts, immutable/changed weekly evidence and
  schema-readiness detection of an older training constraint. Fixture cleanup is exact tenant UUID.
- Production DB adds an actual-value weekly-report case: draft excluded from actual yield, exact
  waste movement/value link and historical NULL cost remaining unknown.
- `node scripts/operation-improvement-browser-smoke.mjs`: local Next :3018, real route and SDL
  validation with mocked GraphQL/auth, English/Thai at 1280/390px. Exercises ACK lost-response replay,
  training/assessment, new SOP version form defaults, server source selectors, issue/followup target,
  weekly confirmation, permission visibility, manual and overflow. Optional BMS_SMOKE_LANG/WIDTH
  restrict a debugging run; omit both for full coverage. Screenshots under
  `.test-output/operation-improvement-browser/`. It is not live-account end-to-end acceptance.
- Existing A–D browser fixture now answers the optional readiness/run-brief queries; no SOP fixture
  is explicitly unknown readiness. Existing E fixture answers a null improvement brief.
- New constraint readiness support checks validated `pg_constraint` definitions, not table presence
  alone. `10.96` is mandatory for TRAINED. Generated SQL and CLI use the same requirement catalog.

2026-10-24 DB verification: F **15/15**, E **28/28**, A–D **32/32**, restaurant actual-cost **20/20**,
stock-ledger **8/8** passed. F/E/cost/ledger used restored :5433; A–D used isolated :5549. A broad
`operation-` filter initially selected A–D on :5433; its safety guard refused before writes, and A–D
was rerun successfully on its designated database. No production database was touched.

Final 2026-10-24 `npm run gate`: typecheck, **3,036 pure tests passed / 6 skipped / 0 failed**,
and production build passed (`.test-output/release-f-gate.log`). F DB verification was repeated
after the final permission changes: **15/15**. F and E browser fixtures passed against that
production build in English/Thai at both 1280px and 390px, including the canonical assignee target
brief in F. The A–D regression browser fixture also passed all four language/viewport combinations
against the same production build. Logs: `.test-output/release-f-db-final.log`,
`release-f-browser-final.log`, `release-e-browser-final.log` and `release-ad-browser-final.log`
in the same directory. These browser fixtures mock transport/auth;
they do not replace a real-account pilot.

Global readiness on the restored test instance still reports **10.89 board-game occupancy tables
missing** (pre-existing/outside F). Operations 10.91–10.96 all pass their schema checks. This is not
a claim that the entire restored database is rollout-ready; the unrelated migration was not applied.
No commit, push or deployment is implied by these results. Real-account role/branch/cron pilot is
still required before production use.

## Operations production — Release E

- `node scripts/run-contract-tests.mjs pure operation-production`: quantities, dates and scaled BOM.
- DB filter `operation-production`: restored disposable `127.0.0.1:5433/bms_realtime_test` only,
  A–D and valuation prerequisites first. Covers actual production/lots/value, POS sale/return,
  recipe consumption without double deduction, concurrent/replayed posts, rollback, RLS/grants,
  duty resolution, notices, stock ledger and adapters. Fixtures use FAKE UUID-scoped tenants.
- `node scripts/operation-production-browser-smoke.mjs`: local Next at :3018 by default; real
  components/SDL, mocked auth/GraphQL. en/th × desktop/mobile, confirmation, same-key retry and
  disposal. Set `BMS_PLAYWRIGHT_MODULE` to the installed Playwright module if not locally resolvable.
- Regression: `restaurant-actual-costs` DB filter on :5433; `operation-checklists` on its separate
  synthetic `bms_operations_test` DB. Never run either against an active shop database.

## Board-game owner assistant reads

- `node scripts/run-contract-tests.mjs pure board-game-analytics-tools`: actual tool adapters/runtime,
  staff-only permissions, scoped report views, safe exports/email proposals and unsupported-intent guards.
- `node scripts/run-contract-tests.mjs pure board-game-owner-reads`: compiled service with mocked DB
  transport; branch/archetype denial, projections/PII, pass units/drift, paged library SQL and failure paths.
- `node scripts/run-contract-tests.mjs pure work-assistant`: bilingual guides, capability boundaries,
  pinned owner questions and tool registration. This is deterministic retrieval, not a live-model eval.
- `node scripts/run-contract-tests.mjs db board-game-analytics-db-contract`: local throwaway DB only;
  occupancy/RLS and owner-read SQL smoke against a FAKE tenant. Requires a restored compatible schema
  including `10.89`. The pure tests do not prove PostgreSQL query execution or RLS.
- Run filtered suites serially or set distinct `BMS_TEST_OUTPUT_DIR` values to preserve each TAP log.

## Branch requisitions (`10.87`–`10.88`)

- `node scripts/run-contract-tests.mjs pure branch-requisitions`: allocation/progress math.
- `node scripts/run-contract-tests.mjs db branch-requisitions`: real services, tenant RLS,
  version/idempotency races, good/damaged/short receipts, purchase allocation limits, audit rollback,
  permissions and authorized test-tenant purge. Requires loopback `POSTGRES_HOST` and dedicated
  restored `POSTGRES_DB=bms_requisition_test` (local throwaway container, port 5433), with migration
  `10.87` and `10.88` applied. Creates/removes exact random FAKE tenants; never target a real shop database.
  Operations coverage includes date validation, scoped metrics, exact demand pagination, derived
  transfer timeline and notification recipients/personal reads (including real tenant-role grants).
- `node scripts/branch-requisitions-browser-smoke.mjs`: local dev web only; intercepts API/GraphQL
  with FAKE fixtures and blocks external requests. TH/EN at 1280/390 px: list, consolidation, stock,
  review queue/date filters, metrics, demand drilldown, transfer confirmation, PO form, draft creation,
  exact linked PO/transfer routes and denied access. `BMS_PLAYWRIGHT_MODULE` may
  point to an installed Playwright module. Screenshots go to ignored `.test-output/`.
  Browser payloads are validated against the committed GraphQL schema, including Apollo metadata;
  a lost mutation response and a failed read after known success exercise retry/read-error handling.
  This checks the UI, not a live API/browser integration. The DB suite separately executes the
  requisition SDL/resolvers with the real GraphQL executor, including malformed filters and denial.
- `node scripts/run-contract-tests.mjs db staff-stock-transfer-route`: isolated `bms_requisition_test`
  only. Executes real REST handlers with signed fixture sessions: 401/403, scoped reads, forged scope,
  malformed body, stable-key replay, conflict, missing document and cancellation. The requisition DB
  suite also covers staff source/destination scope, concurrent requests, revoked scope before replay,
  actor-bound keys, exact-once stock/audit and named/compatibility GraphQL adapters.
- `node scripts/stock-transfers-browser-smoke.mjs`: local production/dev web with intercepted FAKE
  API responses, at 1280/390 px. Tests scoped buttons, create/send/receive retry after response loss,
  same-tab reload recovery, malformed response, known success + failed refresh, and permission denial.
  Also covers blocked browser storage (no POST), a stale GET during a command, and switching the
  authenticated user/shop while preserving the original scope's recovery record. DB coverage rejects
  overflow after merging duplicate product lines and unknown/duplicate receipt item IDs atomically.
  Uses the same `BMS_SMOKE_URL`/`BMS_PLAYWRIGHT_MODULE` options and ignored `.test-output/` screenshots.
- Regression: `db inventory-multilocation`; full `cd apps/web && npm run gate` checks shared services,
  schema artifact, navigation, translations, assistant guides and production compilation.


## Restaurant pickup checkout (2026-10-22)

- `node scripts/run-contract-tests.mjs pure restaurant-pickup`: whole checkout service with
  mocked dependencies; persisted PICKUP/contact rules, payment scope, legacy delivery/marketplace
  boundaries and deterministic Thai/English replies.
- `node scripts/run-contract-tests.mjs db restaurant-pickup`: disposable PostgreSQL **only**.
  Requires `POSTGRES_HOST=127.0.0.1`, `POSTGRES_PORT=5547`,
  `POSTGRES_DB=bms_restaurant_readiness_test`, and superuser `POSTGRES_USER/POSTGRES_PASSWORD`.
  Creates/drops a random synthetic schema and creates `bms_app` if absent. Uses real order/tenant
  services and PostgreSQL RLS for repricing/payment races, rollback and concurrent handover.
  Carrier and stock-movement writer are substituted; this is not a restored-schema,
  realtime-trigger or inventory-valuation rehearsal. Never target a real shop database.

## Freemium phases 1–2 (`10.73` / `10.74`)

- Restored-dump validation is separate from synthetic contracts: follow
  [the rehearsal runbook](../docs/architecture/freemium-rehearsal.md) and its read-only
  `db/checks/freemium-rehearsal-snapshot.sql` before/after/rerun comparisons on the isolated restore.
  `freemium-metrics-contract` runs without DB: telemetry timeout/rollback boundaries and unknown
  cost handling. Its SQL-source guard check is not evidence of a successful restored rehearsal.
  `freemium-restored-db-contract` is opt-in (`BMS_RESTORED_REHEARSAL=1`) and requires the dedicated
  marked workflow copies/loopback port documented in that runbook. It tests real services against
  the restored schema, retains synthetic fixture shops only in those copies, and blocks external
  network calls. Do not run the synthetic `freemium-*` suites against the restored snapshot DB.

- `freemium-capacity-*` additionally covers 10.75: registration limits, concurrent admissions,
  legacy/migration rerun continuity, downgrade editing, tenant/RLS isolation, audit rollback,
  distinct cohort conversion and nullable shared/BYOK cost. The DB fixture is synthetic, not a dump.
  `ai-usage-browser-smoke.mjs` also covers Billing capacity and Tenants pilot metrics in both languages
  at desktop/mobile widths; all API replies are mock fixtures, never real shop mutations.

- Review regression suites (`freemium-review-*`): concurrent downgrade vs all six AI grant writers,
  atomic plan/audit rollback, Starter Catalog batch quota and unchanged old rows. The DB suite uses
  its own random schema in `bms_freemium_test`, synthetic data and real migrations/services only;
  it does not call providers or deliver messages. Not a restored production-schema rehearsal.

- `node scripts/run-contract-tests.mjs pure freemium`: package/time policy, server feature denial,
  auth/RBAC/tenant binding, transactional audit and existing-work continuity (no network/DB).
- `node scripts/run-contract-tests.mjs db freemium`: loopback PostgreSQL only; phase two additionally
  requires the dedicated database name `bms_freemium_test`. Configure `POSTGRES_HOST`, `POSTGRES_PORT`,
  `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` for a disposable superuser test instance.
  Phase one uses temporary tables; phase two creates/drops a uniquely named synthetic schema and
  creates `bms_app` if absent. Covers migration reruns, role/RLS, plan locks, audit rollback, legacy
  grants, downgrade continuity and real Retention conversion. Not a restored production replay.
- `scripts/ai-usage-browser-smoke.mjs` and `scripts/freemium-feature-browser-smoke.mjs`: local
  production server (`BMS_SMOKE_URL`, default localhost:3007), mocked APIs, Chrome via Playwright
  (`BMS_PLAYWRIGHT_MODULE` optionally selects its module). Thai/English at 1440px/390px; screenshots
  go into `.test-output/`. No live customer messages, payments or provider calls.

Restaurant handoff/backlog (2026-10-15): see
[phase 1–9 completion and remaining-work log](../docs/business/inventory.md#restaurant-phases-1–9-completion-and-remaining-work-log-2026-10-15).
It separates implemented scope, unfinished business-evidence/features, and deferred DB verification.
The user requested commit/push after the verification records below; statements that no commit/push
was performed describe those earlier test runs, not the later Git handoff. The user subsequently
authorized local Docker DB testing on 2026-10-15; the DB deferrals below describe the earlier rounds.

## Restaurant phases 1–9: real DB follow-up (2026-10-15)

Use the [restored disposable instance](../docs/architecture/realtime-test-database.md), never the
dev database. The new suites additionally require loopback host, port **5433** and database
**bms_realtime_test**. A separate test Redis can be started with
`docker run --name bms-costing-test-redis -p 127.0.0.1:6381:6379 -d redis:7-alpine`;
set `REDIS_URL=redis://127.0.0.1:6381` for the test runner. No source-database password, dump,
customer data or test logs belong in Git. Remove the test Redis and disposable DB after testing.

| Phase | Real DB coverage |
| --- | --- |
| 1 | `db recipe-versioning`, `db restaurant-pos`, `db kitchen-station`: append-only recipes, concurrency/rollback, first-send cost/stock evidence across rounds, split/merge, kitchen cancellation and settlement |
| 2 | `db restaurant-costing`: pinned inactive child versions, SOP edits, integral BOM expansion, cycle/foreign-reference rejection, concurrent saves |
| 3 | Same suite: current catalog estimates, whole-batch overhead, immutable assumption versions and unknown inputs |
| 4 | Same suite: expense documents, settled POS expenses and LIVE GP sources; review/replay/conflict, canonical dedup, credits, depreciation, stale/retired sources and audit rollback |
| 5–6 | Same suite: actual recipe reads for VAT/GP/break-even, demand/menu/bundle planning, unknown cost and absence of price/order writes |
| 7 | Same suite: actual POS partial/full returns, concurrent retry, void, audit rollback, immutable snapshots, mixed VAT/extras, signed rounding, branch/month event clocks and 101-sale keyset paging |
| 8 | Same suite: exact-cent allocations, versions/replay, concurrent conflict, stale previews, gross-sales drivers, tenant/branch isolation, confirmation and audit rollback |
| 9 | Same suite: real monthly sales/expenses/allocations, frozen vs current cost, unknown cost/loss/return/tax evidence, serializable source snapshots and a 1,001-expense read cap |
| Schema/API | `db restaurant-costing` also runs the migration suite: first application plus reapplication of 10.61–10.66, grants/RLS, foreign keys, immutable trigger, unauthenticated/denied/success resolver paths and real per-tenant permissions |

`restaurant-costing-migrations-db-contract.test.mts` reconstructs the pre-feature schema inside
one **rollback-only** transaction on the restored test instance. It transactionally truncates the
affected copied tables, removes the feature objects, runs the migration files twice (only stripping
their outer BEGIN/COMMIT), checks structure/grants, then rolls everything back. It does not build
an empty database from the repository migration history or alter the original dev database.

`recipe-versioning-db-contract.test.mts` now removes child recipe references, recipes and products
before deleting its exact fixture tenant UUID, in one cleanup transaction. The new fixture helper
also preserves both assertion and cleanup errors, and verifies that its tenant was removed.
Audit-failure tests install a uniquely named, tenant-specific trigger only on the disposable DB
and remove it in `finally`; no production service is stubbed or weakened to make a test pass.

These tests validate the implemented scope. They do not implement purchase-lot valuation, return
cost recovery, historical-sales Menu Engineering or price/promotion activation. A real POS return
also produces a credit note: known return VAT/components remain visible, while phase-9 net revenue
and profit stay unknown when those tax adjustments have not been reconciled. Production-scale query
plans, the 20,000-event cap and a live HTTP/browser/Redis→gateway→client flow remain separate checks.

Run through `node scripts/run-contract-tests.mjs db <filter>` with the isolated connection env from
the runbook. Result logs for this follow-up are under ignored `.test-output/restaurant-phases-db/`.

Verified 2026-10-15: focused DB runs **99/99 passed, no skips**: recipe-versioning 5,
restaurant-costing (service + migration suites) 26, restaurant-pos 51, kitchen-station 17.
The initial complete DB run on a newly restored copy covered **70 files / 711 tests: 676 passed,
21 failed, 14 skipped**. Every final failing test name was also present in the earlier 68-file
baseline (648 passed / 23 failed / 14 skipped); two baseline failures did not recur and are not
claimed as fixes. Existing failures include fixture/NOT NULL cleanup, catalog `allergen_codes`
SQL typing, deposit and tax-report expectations. That initial repository-wide DB gate was **not green**;
the follow-up below resolves those failures.
See `final-all/db.failures.txt` and the four `focused/*/db.tap` logs under that output directory.
The tests plus their imported services passed a separate strict TypeScript check (including .mts,
which the ordinary web tsconfig does not include). Schema readiness passed; no costing/recipe
fixture tenants or fault-injection functions remained. `git diff --check` passed. No browser/build
or full pure-suite rerun is claimed for this test/documentation change.

### All-DB failure fixes and rerun (2026-10-15)

All 21 initial failures are resolved. Two production fixes were needed: explicitly type the
`allergen_codes` / `dietary_tags` INSERT parameters as `text[]`, and include locked earlier deposit
instalments in the final POS payment-total check. Regression assertions cover nonempty/omitted/empty
food arrays and a 5,000 deposit sale with 1,000 + 1,500 already paid, 2,500 collected, and no duplicate
payment/stock deduction on retry. The expected-paid guard, tenant locks and transaction remain intact.

Fixture repairs supply the required fake password hash, cast UUID/text parameters, use a temporary
local media directory, and delete delivery children before parents in one exact-tenant transaction.
Assertions now follow the existing contracts: chat booking requires `booking_enabled` independently
of directory publication, XLSX Summary uses positional metadata rows, and issued credit-note print
snapshots retain earlier-credit amounts after a later cancellation.

| Verification target | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| All 70 DB files, freshly restored `bms_realtime_test` | 710 | 0 | 14 |
| Cross-SKU gifts, restored `bms_gift_test_current` | 11 | 0 | 1 legacy-only |
| Cross-SKU gifts, `bms_gift_test_legacy` without 10.41 columns | 2 | 0 | 10 current-only |
| Customer answer evidence, fresh dedicated `evidence_test` instance | 1 | 0 | 0 |
| Installer reports, empty dedicated `bms_installer_reports_test` | 1 | 0 | 0 |

The main run has **724 tests** (previously blocked nested tests now execute, plus one new array
regression). Every one of its **14 skipped test names** passed on the dedicated targets; the gift
setup runs twice, so do not sum executions as unique cases. No skip guard was relaxed. The legacy
gift target is a disposable clone with the three 10.41 columns removed and the 8.7 kind/shape checks
restored; no migration file or source database was altered. Evidence uses port 55453 and
`BMS_EVIDENCE_DISPOSABLE_DB=1`; the gift legacy target uses `BMS_GIFT_LEGACY_SCHEMA=1`.

Logs are in ignored `.test-output/db-green/{full,gift-current,gift-legacy,evidence,installer}/`;
`verification.json` reconciles the skipped names with successful dedicated runs. The web
`npm run typecheck` and affected pure suites (`pos`: 233; `product`: 52) passed. There are no
standalone pure filters named `price-tiers` or `deposits`; those checks are in DB mode.
The additional strict compilation probe initially reported union-narrowing and XLSX declaration
issues in four older suites outside the web tsconfig. These are resolved in the follow-up below.
No full pure gate or production build rerun is claimed. All test DB containers/volumes and test Redis
are removed after verification; the dev stack is retained.

### Strict DB verification scripts (2026-10-15)

Run `cd apps/web && npm run typecheck:db-verification` for the complete scope of that strict probe:
**12 DB suites plus `testing/restaurantCostingFixture.mts`**, along with their imported dependencies.
The committed `scripts/tsconfig.db-verification.json` preserves all 13 original script entries,
inherits the web compiler settings and explicitly enables `strict`, `noEmit` and TypeScript-extension
imports. This selected verification scope is separate from the 70-file DB execution runner; it does
not claim to typecheck every test script in the repository.

Board-game tests now assert the expected result shape before reading union-specific fields,
including replay payloads. Deposit tests check the returned order ID and deposit object before
reading their fields. The two workbook suites resolve the installed `xlsx` package from the web
workspace using its published declarations instead of an untyped direct `.mjs` import. No error
suppression, new `any` cast or relaxed compiler setting was introduced.

Verification: `typecheck:db-verification` and the ordinary web `typecheck` both exit 0. The four
changed DB suites pass **52/52, no skips** on a freshly restored disposable Docker database:
board-game-seating 13, deposits 12, stock-ledger 8, tax-sales-report 19. Logs are in ignored
`.test-output/strict-db-scripts/`. The earlier full DB run remains recorded above; this follow-up
reruns the affected suites only. The disposable DB/Redis are removed afterward; dev data is unchanged.

Phase-9 recorded net profit: `node scripts/run-contract-tests.mjs pure net-profit` covers exact
pre-income-tax arithmetic, discounts/extras/shipping/VAT/signed rounding, historical vs legacy costs,
cross-month/branch returns, refund/CREDIT non-double-counting, negative expenses, unknown review or
disappeared sources, branch-wide vs channel buckets, unvalued inventory/blind-return gaps and scan
caps. It executes the real math/service/resolver with strict dependency/SQL doubles and GraphQL SDL;
it does not prove SQL, RLS/grants, isolation, query plans or stock-cost reversals on a real DB.
`node scripts/net-profit-browser-smoke.mjs` runs TH/EN at 1280/390px against a local production server
with mocked HTTP and idle WS (no gateway). It checks late success/rejection after month changes,
loading/error stale-total hiding, unknown results, read-only access, source-permission denial,
manual content, viewport containment and unbroken money strings. Existing allocation/cost browser
smokes are regressions. DB tests were deferred in that original round; see the real-DB follow-up above. Phase 9 adds no migration;
existing sources through 10.66 are prerequisites. Return cost reversal, purchase-lot valuation and
unreconciled adjustments remain business-evidence limitations, distinct from DB-test deferral.
Verified 2026-10-15: final `npm run gate` passed typecheck, 235 DB-free files (2,848 passed /
2 skipped / 0 failed; 2,850 total, including 26 phase-9 cases) and production build. New profit plus
existing allocation and operating-cost browser smokes passed all 12 TH/EN 1280/390px cases on the
final production build. Screenshots were visually checked; money is nowrap and the long worksheet
scrolls inside the viewport. Schema export, browser-script syntax and git diff --check passed.
Logs: `.test-output/restaurant-phase9/`; screenshots: `.test-output/net-profit-browser/`.
The final browser-server log is clean. Build still emits the existing unavailable-DB prerender
sentinel (127.0.0.1:1 in operations-schedule) and exits 0; this is not a DB test. No DB test,
migration execution, commit or push was performed. Local fixture server was stopped after checks.

Phase-8 expense allocation: `node scripts/run-contract-tests.mjs pure cost-allocation` covers signed
cent conservation, direct/equal/weighted/sales bases, overlap/zero/unknown/cap rejection, gross product
denominators (not net sales), source reuse in one transaction, stale previews, JSONB order stability,
append-only versions, exact retry, audit rollback, source retirement, tenant/RBAC and typed GraphQL.
`node scripts/cost-allocation-browser-smoke.mjs` uses local mocked APIs at TH/EN 1280/390px, holds a
preview response across close/reopen, checks disabled inputs, confirmation, stale rejection/retry,
read-only/denied/error states, manual content and viewport layout. It does not connect to a DB.
Apply/reapply 10.66, RLS/grants, concurrency and real rollback/query plans are DB-deferred by request.
Verified 2026-10-15: 18 focused allocation tests passed. `npm run gate` passed typecheck,
234 DB-free files (2,822 passed / 2 skipped / 0 failed; 2,824 total) and production build.
Both allocation and existing operating-cost browser smokes passed all four TH/EN desktop/mobile
cases (1280/390px) against the production build with mocked HTTP and idle WebSocket transport;
no gateway connection or realtime behavior is tested. Allocation screenshots were
visually inspected. The allocation smoke matches the preview action independently of Ant's exiting
loading-icon animation. Schema export, readiness generation, script syntax and git diff --check passed.
An initial fixture run let WS upgrades reach the standalone Next server (unconfigured gateway URL),
which logged a Next response-header error. Both browser fixtures now intercept WS as well as HTTP;
the final server log is clean. No application realtime code was changed.
Logs: `.test-output/restaurant-phase8/`; screenshots: `.test-output/cost-allocation-browser/`.
Build emitted the existing unavailable-DB sentinel during operations-schedule prerender
(127.0.0.1:1) but finished successfully. This does not certify live SQL, RLS/grants, transaction
isolation, concurrency or query performance. Apply migration 10.66 before enabling the new feature;
no migration/DB test, commit or push was performed. Allocation remains separate from actual net profit.

Sales evidence foundation (phase 7): `node scripts/run-contract-tests.mjs pure sales-evidence`
executes exact satang allocation, historical vs missing/legacy costs, tax-bucket reconciliation,
extras/shipping/rounding separation, independent return/payment dates, CREDIT debt reductions,
cross-branch groups, cumulative partial-return cost basis, bounded diagnostics and scan-cap handling.
The service/resolver run against a fake client with permission denial, tenant/branch scope, invalid
inputs, all-page aggregation, currency refusal, rollback/release and typed error cases. This does NOT
execute SQL or certify RLS, indexes, isolation or performance. The new API leaves existing reports
unchanged; the return-snapshot completion below adds capture, not refund/stock/tax repricing. No new UI. Source gaps are explicit and net-profit
fields remain null. DB checks remain deferred by the user; do not provision a DB for this work.
Verified 2026-10-15: 27 focused cases passed, including executable GraphQL SDL and source-stream
consumer failure handling. Final `npm run gate` passed typecheck, 232 DB-free files (2,775 passed /
2 skipped / 0 failed; 2,777 total) and production build. Schema export and git diff --check passed.
Logs: `.test-output/restaurant-phase7/`. Build emitted the existing unavailable-DB sentinel during
operations-schedule prerender (127.0.0.1:1); exit status was 0, not a live-DB certification. No UI
changed, so no browser smoke was added/run in this phase. No DB test, migration execution, commit
or push. SQL/source permissions, transaction isolation and query plans remain unverified on DB.

Phase-7 return-snapshot completion: `node scripts/run-contract-tests.mjs pure return-financial-snapshot`.
29 focused cases cover exact vs legacy policies, partial-to-full returns, mixed VAT, positive/negative
rounding, prior unknowns, changed/malformed evidence, caps, gift zero weights, report identity checks,
and migration/readiness source contracts. The real processPosReturn function body runs with strict
SQL/dependency doubles for snapshot insert + audit, replay/conflict, rollback at snapshot/item/audit,
no payments/insufficient cash, cash/CREDIT completion, cross-branch approval, void and restaurant
reservation release. These prove orchestration and rollback requests, NOT live SQL/RLS/locking.
Migration `10.65` must precede deployment. DB tests (apply/reapply, immutable guard, inherited RLS/
grants, concurrent return/replay, settlement/realtime triggers and actual financial reconciliation)
are explicitly deferred; do not provision a DB. No operator route/layout/CSS changed, so no new
browser smoke is required. Earlier phase-7 verification counts above describe the read-only baseline.
Verified 2026-10-15 completion: all 29 focused snapshot cases passed; final `npm run gate` passed
typecheck, 233 DB-free files (2,804 passed / 2 skipped / 0 failed; 2,806 total) and production build.
Schema export, generated readiness parity and git diff --check passed. Logs are under
`.test-output/restaurant-phase7-return-snapshot/`. The build's unavailable-DB sentinel remains a
known prerender warning, not a DB test. No DB test/migration execution, commit or push was performed.

Restaurant menu/promotion planning (phase 6): `node scripts/run-contract-tests.mjs pure restaurant-menu-plan`
includes the request-order regression suite executing the real component with controlled Form/hooks
and deferred Apollo responses: old success/error, out-of-order completion, programmatic changes,
unmount, and latest-request loading ownership. The browser smoke holds actual mocked HTTP responses
until assertions finish (no timing sleeps), checks every recipe selector is disabled, and verifies
v7-to-v8 recalculation after release in TH/EN at 1280/390px.
The suites also cover four relative engineering quadrants, exact weighted thresholds/ties, zero/unknown/negative
evidence, bundle gifts/quantities/extras, VAT/GP bases, alternative-only demand, bounds, server-derived
cost/tenant and permission denial. `node scripts/restaurant-menu-plan-browser-smoke.mjs` uses local
mocked APIs in TH/EN at desktop/mobile widths. Demand is supplied planning input, not historical sales.
No new migration or real selling-rule write. Real recipe SQL/RLS remains deferred; mocks cannot prove it.
Verified 2026-10-15: 15 focused contracts passed; full gate passed typecheck, 230 pure-test files
(2,740 passed / 2 skipped / 0 failed) and production build. Schema export passed. Menu-planning,
price-planning and recipe-versioning browser smokes each passed TH/EN at 1280/390px (12 cases),
including permission/error states and manual rendering, with no page errors. Desktop/mobile menu
screenshots were visually checked under `.test-output/restaurant-menu-plan-browser/`.
Build still logs the intentional unavailable-DB sentinel from existing operations-schedule prerender;
the local Next server also still logs the pre-existing background `undefined.bind` error. Target
routes returned 200 and browser assertions passed; this is not a clean-runtime or live-DB certification.
No migration, DB test, commit or push was performed in phase 6. Automatic historical-sales menu
engineering and real promotion activation are not implemented by this planning worksheet.

Phase-6 P2 stale-response fix, verified 2026-10-15: the new held-response browser assertion failed
against the pre-fix production build (recipe picker incorrectly remained enabled), then passed all
four TH/EN desktop/mobile cases on the fixed build. Eight new request-order contracts passed (23
menu-plan contracts total). Full gate: typecheck, 231 pure-test files, 2,748 passed / 2 skipped /
0 failed, and production build passed. Price-plan and recipe-versioning browser regressions also
passed all four cases each (12 browser cases total); no page errors, with desktop/mobile screenshots
visually checked. Logs: `.test-output/restaurant-phase6-p2-final/`. Scope is UI request ownership and
shared recipe-picker disabled inheritance only; no arithmetic, API, schema/migration, tenant/RBAC,
stock, money or sale snapshot changes. DB/RLS tests remain deferred. Existing unavailable-DB build
logs and Next background `undefined.bind` logs remain; these passing checks do not certify live DB
or general runtime health. No commit or push.

Restaurant price planning (phase 5): `node scripts/run-contract-tests.mjs pure restaurant-price-plan`
covers exact VAT/GP bases, contribution and upward-rounded targets, missing/zero/negative evidence,
target-margin prices, input bounds, service/GraphQL permissions and tenant isolation, and read-only
separation from real prices/ledgers. `node scripts/restaurant-price-plan-browser-smoke.mjs` exercises
TH/EN at 1280/390px against mocked local APIs. No new migration; existing recipe reads still need
real DB verification later. No database is provisioned or live provider/tax setting inferred.
Verified 2026-10-15: 13 focused contracts passed, full pure suite 2,725 passed / 2 skipped;
typecheck, schema export, i18n parity and production build passed. Price-plan browser smoke and
existing recipe-versioning browser smoke each passed TH/EN at 1280/390px (8 cases total), including
the manual; final runs had no page errors. Images are under `.test-output/restaurant-price-plan-browser/`.
The build still logs the unavailable DB sentinel during the existing operations-schedule prerender;
local Next background `undefined.bind` errors remain an environment/runtime limitation, not proof of
a healthy DB-backed deployment. No new phase-5 migration, commit or push was performed.

Operating costs (`10.64`, phase 4): `node scripts/run-contract-tests.mjs pure operating-cost` covers
fixed-point depreciation, signed notes, canonical/cross-month dedup, missing/stale/currency/truncation,
fake-client service retry/conflict/rollback, all-branch scope and executable API permission boundaries.
`node scripts/operating-cost-browser-smoke.mjs` uses mocked APIs on a local production server only,
in TH/EN at 1280/390px. No database is provisioned. Migration reapplication, actual source SQL,
RLS/grants and concurrent transactions remain deferred deployment checks; these tests do not prove them.
Verification on 2026-10-15: 16 phase-4 contracts passed; full pure suite 2,712 passed / 2 skipped;
typecheck and production build passed; final browser smoke passed all four language/viewport cases,
including Reports and Manual. The manual's positional card/metadata mismatch found by browser QA was
fixed and now has a contract guard. Build logs still show the expected unavailable DB sentinel during
operations-schedule prerender. The local Next server also emits the previously observed background
`undefined.bind` errors; target routes returned 200 and the final browser run had no page errors.
These checks are not evidence that the whole DB-backed runtime is healthy.

Recipe costing (`10.63`, phase 3): `node scripts/run-contract-tests.mjs pure recipe-costing` covers
fixed-point batch/yield math, missing/zero/invalid evidence, input bounds, tenant-scoped consistent
reads, GraphQL permission/denial/bad-id boundaries, and no linkage to stock/payment/profit paths.
`pure recipe-versioning` also verifies assumptions/source-only versioning, omission preservation,
explicit clearing and rollback. The browser smoke below covers cost editing/reopen, read-only viewing,
complete/incomplete/error states in TH/EN at 1280/390px with mocked APIs only. No DB is provisioned or
used by these checks. Applying `10.63` twice and verifying real RLS/grants/transactions on a restored
disposable DB remain deployment checks; this machine's user explicitly deferred DB testing.

Recipe composition/SOP (`10.62`, phase 2): `node scripts/run-contract-tests.mjs pure recipe-composition`
executes exact leaf-BOM expansion, invalid input, quantity/graph limits, tenant-scoped pinned loading,
cycles, and GraphQL permission/tenant/error boundaries. `pure recipe-versioning` also executes
SOP-only version changes, pinned inactive children, explicit upgrades, legacy-client preservation,
and transactional rollback requests with a fake client. These do not execute PostgreSQL or prove
locks/RLS/FKs. Apply `10.62` before recipe APIs; DB execution remains deferred by the user.
The recipe browser smoke also selects an inactive pinned child, saves SOP, reopens the new version,
and verifies read-only SOP access in Thai/English at desktop/mobile widths using mocked APIs.

Restaurant item snapshots (`10.61`): `node scripts/run-contract-tests.mjs pure restaurant-item-snapshot`
executes JSON validation, integer/cents legacy allocation, fake-client evidence adoption, and grouped
restaurant return promotions. `node scripts/run-contract-tests.mjs db restaurant-pos` includes actual
multi-version kitchen rounds, split/merge, cancellation, settlement, and failed-send rollback;
`db kitchen-station` covers the related kitchen path. Apply `10.61` twice on a restored disposable
database and verify RLS/grants/indexes/empty-v2 view behavior before rollout. These PostgreSQL checks
have NOT run in this change's environment (no restored BMS test database available); explicitly
deferred by the user on 2026-10-15, not required to finish this machine's DB-free work.
`node scripts/run-contract-tests.mjs pure restaurant-kitchen-snapshot` executes the real send-round
orchestrator and snapshot loader against transactional fakes: retry/no duplicate tickets, rejection,
audit/link failure rollback requests, missing legacy evidence, branch/device denial, and kitchen-off.
It also exercises tenant-purge link detachment ordering, target scope and failure rollback requests.
The order engine is stubbed in that suite; it does not prove SQL atomicity, locks, or actual stock.

Recipe version preservation (2026-10-15): `node scripts/run-contract-tests.mjs pure recipe-versioning`
executes validation and the real service against a transactional fake (including rollback and audit).
`node scripts/run-contract-tests.mjs db recipe-versioning` covers append-only content, activation,
component-FK rollback, tenant isolation and concurrent version allocation on the restored disposable
database. The DB suite is not replaced by the fake. `recipe-versioning-browser-smoke.mjs` opens Stock
Models and Manual in Thai/English at 1280/390px with mocked APIs, checks the version warning and a
save/refetch returning a new id, and stores screenshots under `.test-output/recipe-versioning-browser`.
Use `BMS_SMOKE_URL` for a local server and `BMS_PLAYWRIGHT_MODULE` for an external Playwright install.

ไฟล์ในนี้มีสองพวก และ **ชื่อไฟล์คือสัญญา**:

| รูปชื่อไฟล์ | คืออะไร | ต้องมี Postgres |
| --- | --- | --- |
| `*-db-contract.test.mts` | เทสที่ **เขียนจริงลงฐาน** | ต้องมี |
| `*.test.mts` อื่น ๆ (รวม `ai-eval/`) | เทส pure — อ่านซอร์ส/ตรรกะ/fake provider | ไม่ต้อง |
| `check-*.mts`, `rotate-*.mts` | เครื่องมือตรวจ/ซ่อมของจริง (อ่านอย่างเดียว ยกเว้น rotate) | แล้วแต่ตัว |
| `preflight-deploy.mts`, `export-graphql-schema.mts` | เครื่องมือก่อน deploy · เรนเดอร์ SDL artifact | preflight ต้องมี · export ไม่ต้อง |
| `retail-local-*.test.{mjs,sh,ps1}`, `installer-reports-browser-smoke.mjs` | เทสของตัวติดตั้ง Retail Local — **ตัวรันกลางไม่หยิบ** (หยิบเฉพาะ `*.test.mts`) ดู § 9 | ไม่ต้อง |
| `*-browser-smoke.mjs`, `tax-invoice-pdf-smoke.mts`, `testing/*-mutations.mjs`, `testing/scheduler-smoke.mjs`, `infra/*.test.mts` | สโมคเบราว์เซอร์/คอนเทนเนอร์และตัวขับ mutation — **ตัวรันกลางไม่หยิบ** ดู § 10 | ไม่ต้อง (บางตัวต้องมี dev server/Docker) |

Tax review checks (2026-10-14): `node scripts/run-contract-tests.mjs pure tax` includes
`tax-invoice-eligibility-contract` (executes service guards with a fake query client, no database).
`tax-document-preview-browser-smoke.mjs` opens the real tax and manual routes at 1280/390px using
mocked API responses, checks copy/date/branch rendering and cancelled-document print denial, and
saves screenshots and print PDFs under `.test-output/tax-document-preview`. Run against a local
server using `BMS_SMOKE_URL`; set `BMS_PLAYWRIGHT_MODULE` if Playwright is outside normal resolution.
The public `tax-request-form-browser-smoke.mjs` additionally needs the local server's tax-request
feature enabled with a test-only secret and HTTPS public origin. Both smokes block external requests.
These checks do not prove SQL execution: run `db tax-sales-report` and `db tax-backoffice-guards`
against a restored disposable local database before deploying.

ตอนนี้ (นับ 2026-10-13 ที่ `676a38a7`): **287 ไฟล์เทส** = pure **220 ไฟล์** (194 ใน `scripts/` +
26 ใน `scripts/ai-eval/`) + DB **67 ไฟล์** (ทั้งหมดอยู่ชั้นบนสุดของ `scripts/`)

ผลรัน `npm run test:pure` วันเดียวกัน: **2,609 เทส — 2,602 ผ่าน · 1 แดง · 6 ข้าม (skip)** ใช้เวลา ~51 วินาที
· ตัวที่แดงคือ `ai-eval/restaurant-customer-assistance-contract` → *restaurant availability exposes only
opt-in capacity groups, never table or guest identities* (บรรทัด 79): regex
`/tableCode|tableName|checkId|occupant/` ไปเจอคำว่า `occupant` ใน **ข้อความ note ที่บอกโมเดลว่า "never
identify a table or occupant"** ของ `return {...}` ใน service — ยังไม่ได้ตัดสินว่าแก้ที่เทสหรือที่ข้อความ
**ห้ามอ่านว่าชุด pure เขียว** · จำนวนเทสของชุด DB ยังไม่ได้นับใหม่ (เครื่องที่นับไม่มี Postgres ให้รัน)

ตัวรัน `scripts/run-contract-tests.mjs` เดินหาไฟล์เอง: ชั้นบนสุดของ `scripts/` + โฟลเดอร์ย่อย `ai-eval/`
**โฟลเดอร์เดียว** (`scripts/infra/`, `scripts/testing/` ไม่ถูกเดิน) · ชื่อมี `-db-contract` = โหมด db
ที่เหลือ = โหมด pure · ตัวรันพิมพ์จำนวนไฟล์ของโหมดเป็นบรรทัดแรก (`[gate] โหมด pure — 220 ไฟล์`) และ
`run-contract-tests.mjs <mode> zzz-nope` บอกจำนวนไฟล์ของโหมดนั้นตอนกรองไม่ตรง

> **ตัวเลขนี้เก่าได้เร็ว** — นับใหม่ก่อนอ้าง (ตรงกับวิธีที่ตัวรันแยกโหมด):
>
> ```bash
> ls scripts/*.test.mts | grep -vc -- -db-contract      # pure ชั้นบนสุด
> ls scripts/ai-eval/*.test.mts | grep -vc -- -db-contract  # pure ใน ai-eval
> ls scripts/*-db-contract.test.mts | wc -l              # db
> ```
>
> แล้วอ่านจำนวนเทสจากบรรทัด `# tests` / `# pass` / `# fail` / `# skipped` ท้าย `.test-output/pure.tap`
> (หรือบรรทัด `tests=… pass=… fail=…` ใน `.test-output/pure.failures.txt`)

> ทำไมต้องมีตัวรันกลาง: ก่อนหน้านี้ชุดเทสถูกรันด้วยคำสั่งยาว ๆ ที่จดไว้ใน `CLAUDE.local.md`
> แล้วต้องก็อปมาต่อชื่อไฟล์เอง ผลคือเทส DB หลายชุดไม่เคยถูกรันจริงในรอบที่แก้โค้ด —
> **เทสที่รันยากคือเทสที่ไม่ถูกรัน**

---

## ประตูเดียวที่ต้องจำ: `npm run gate`

```bash
cd apps/web && npm run gate
```

`gate` = `typecheck` → `test:pure` → `build` (นิยามอยู่ใน `apps/web/package.json`)
**รันก่อน merge ทุกครั้ง** · CI (`.github/workflows/gate.yml`) รันชุดเดียวกันนี้ต่อ PR
**ไม่มี job ของเทส DB ใน CI** เพราะสร้างฐานใหม่จาก `db/migrations` ไม่ได้ (ดู `CLAUDE.local.md`)

`gate` หยุดที่ขั้นแรกที่ล้ม — เห็น `tsc` แดงแปลว่าเทสยังไม่ได้รันเลย ไม่ใช่ว่าเทสผ่าน

---

## 1. `npm run test:pure` — ไม่ต้องมีฐานข้อมูล

```bash
cd apps/web && npm run test:pure
```

### ผ่าน (สิ่งที่จะได้เห็นบนจอ)

ตัวอย่างนี้มาจากรอบ 2026-09-07 ตอนชุดยังมี 80 ไฟล์ — **รูปแบบยังเหมือนเดิม แต่ตัวเลขปัจจุบันดูหัวไฟล์นี้**
(รอบปัจจุบันใช้ราว 50 วินาที):

```
[gate] โหมด pure — 80 ไฟล์
...
✔ ทุก entry ในแคตตาล็อกมีคำถามที่คนถามจริง (5.3575ms)
ℹ tests 904
ℹ suites 0
ℹ pass 904
ℹ fail 0
ℹ duration_ms 28134.2541
[gate] ผลเต็ม .test-output/pure.tap · สรุปรอบนี้ .test-output/pure.run.txt · ไม่มีตัวแดง .test-output/pure.failures.txt
```

**อ่านสามบรรทัดนี้พอ**: `ℹ tests` (จำนวนที่รัน) · `ℹ pass` · `ℹ fail` — ผ่านคือ `ℹ fail 0`
คู่กับ exit code `0` · มีบรรทัด `ℹ skipped` ด้วย (6 ตัวในรอบ 2026-10-13 — เทสที่ต้องมี Windows/
PostgreSQL/เบราว์เซอร์จริงจึงข้ามตัวเองบนเครื่องที่ไม่มี) · `tests = pass + fail + skipped`

> **บรรทัดที่ดูเหมือน error ไม่ใช่ความล้มเหลว** — ชุด `ai-eval` จงใจป้อน JSON เสียให้โมเดลปลอม
> เพื่อทดสอบเส้นทางล้มเหลว stderr ของมันจึงโผล่มาทั้งบนจอและเป็น comment ในไฟล์ TAP:
>
> ```
> [BMS] pharmacy AI extract validation exhausted for case case-eval: SyntaxError: ...
> ```
>
> **ตัวชี้ขาดคือ `ℹ fail` กับ exit code เท่านั้น** ไม่ใช่การมีคำว่า SyntaxError บนจอ

### ไม่ผ่าน (สิ่งที่จะได้เห็น)

**บนจอ** — spec ลิสต์เฉพาะตัวที่แดงไว้ท้ายรอบใน section ของตัวเอง:

```
✖ failing tests:

test at ../../scripts/restaurant-request-contract.test.mts
✖ chat has exactly one door to the write path, and reorder is not it (6.9ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(!customerTools('restaurant').some(tool=>tool.name==='reorder'))
```

**ในไฟล์ `.test-output/pure.tap`** — บล็อกเต็มของ TAP (ตัวอย่างจริง จากการถอดด่าน `reorder`
ของร้านอาหารออกแล้วรันใหม่):

```
not ok 24 - chat has exactly one door to the write path, and reorder is not it
  ---
  duration_ms: 6.9695
  type: 'test'
  location: '...\scripts\restaurant-request-contract.test.mts:1:11062'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:

      assert.ok(!customerTools('restaurant').some(tool=>tool.name==='reorder'))

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
...
# tests 30
# pass 29
# fail 1
```

สิ่งที่ได้จากบล็อกนี้ 4 อย่าง: **ชื่อการันตีที่พัง** (ข้อความหลัง `not ok`) ·
**ไฟล์เทส** (`location`) · **บรรทัด assert ที่ล้มจริง** · **ค่าที่คาดกับค่าที่ได้**
· exit code `1`

### ผลเต็มอยู่ในไฟล์ทุกรอบ — ไม่ต้องพึ่ง scrollback

ทุกรอบเขียนสามไฟล์ (โหมดละชุด · เขียนทับทุกครั้ง · อยู่ใน `.gitignore` แล้ว):

```
.test-output/pure.tap           ← TAP เต็มทุกบรรทัด ไม่มีรหัสสี จึง grep/diff ได้
.test-output/pure.run.txt       ← รอบนั้นรันอะไร กับฐานไหน จบยังไง
.test-output/pure.failures.txt  ← เฉพาะตัวที่แดง — ไฟล์ที่เอาไปแปะให้คน/AI อ่านต่อ
```

### `pure.failures.txt` — อันที่เอาไปแปะได้

**อย่าก็อป `.tap` ไปให้ใครอ่าน** — รอบที่เขียวคือ ~263 KB และ **หนึ่ง** assertion ที่แดงกินได้
ถึง 576 บรรทัด / 28 KB เพราะ `assert.match()` ที่ล้มจะพิมพ์ทั้งไฟล์ต้นฉบับลงในบล็อก `error:`

ไฟล์ `.failures.txt` ตัดเหลือหัวรอบ + ตัวที่แดงพร้อมที่อยู่ในซอร์ส + ข้อความ error ที่ถูกจำกัด
ความยาว (ตัวอย่างจริง: TAP 47 KB → สรุป 3.8 KB):

```
# BMS contract tests — สรุปเฉพาะที่แดง
mode=pure
filter=restaurant-pos-contract
files=1
commit=d910d124
database=-
exit=1
tap=.test-output/pure.tap
tests=60 pass=59 fail=1

พบ 1 เทสที่แดง:

────────────────────────────────────────────────────────
[1/1] จอครัวต้องขอกะ+บิลให้ครบก่อนแตะแถวตั๋ว (ลำดับ กะ → บิล → ตั๋ว)
ที่: scripts/restaurant-pos-contract.test.mts:1284
code=ERR_ASSERTION  operator=match  failureType=testCodeFailure
error:
  The input did not match the regular expression /const ids = \[\.\.\.new Set\(...
  ...
  … ตัดออก 196 บรรทัด — ของเต็มที่ .test-output/pure.tap บรรทัด 345
```

- **ที่อยู่มาจาก stack frame ไม่ใช่ `location:`** — `location:` ของ tsx ชี้เป็น offset ของไฟล์ที่
  bundle แล้ว (เช่น `:1:77290`) ซึ่งเปิดตามไม่ได้ · และพาธถูกตัดเหลือจากรากรีโป ชื่อผู้ใช้
  บนเครื่องจึงไม่ติดไปกับผลที่ส่งต่อ
- **เขียนทุกรอบ ไม่ใช่เฉพาะตอนแดง** — รอบที่เขียวเขียนทับด้วย `✅ ไม่มีเทสที่แดงในรอบนี้`
  เพราะไฟล์เก่าที่ค้างคือสิ่งที่จะถูกก็อปส่งต่อโดยไม่มีใครรู้ว่าเป็นของรอบไหน
- **แดงเป็นร้อยก็ยังแปะได้** — ลงรายละเอียด 20 ตัวแรก ที่เหลือลิสต์ชื่ออย่างเดียว
- ⚠️ **สองกรณีที่ไฟล์นี้เตือนแทนที่จะบอกว่าเขียว**: TAP ไม่มีแผน `1..N` (รอบถูกฆ่า/ค้าง) ·
  และ `exit` ไม่ใช่ 0 แต่ไม่มี `not ok` เลย ซึ่งมักแปลว่าไฟล์เทสโหลดไม่ขึ้น (syntax/import)
  แล้วข้อความจริงอยู่บนจอ ไม่ได้อยู่ใน TAP

`pure.run.txt` ของรอบที่จบแล้ว:

```
mode=pure
filter=-
files=80
commit=a4abc8c6
database=-
started=2026-09-07T08:30:13.929Z
tap=.test-output\pure.tap
files:
  admin-navigation-contract.test.mts
  ...
finished=2026-09-07T08:30:15.989Z
duration_ms=2060
exit=0
```

> **⚠️ ไม่มีบรรทัด `exit=` = รอบนั้นยังไม่จบ ห้ามอ่านว่าเขียว**
> บรรทัดนั้นถูกเขียน *หลัง* กระบวนการลูกจบเท่านั้น · process ที่ถูกฆ่ากลางทางทิ้งไฟล์ TAP
> ครึ่งเดียวที่ไม่มี `not ok` อยู่ในนั้นเลย ซึ่งอ่านเหมือนผ่าน
>
> และ `database=` มีไว้เพราะ **ไฟล์ผลที่ไม่รู้ว่าเป็นของฐานไหนตอบอะไรไม่ได้** (โหมด DB)
> ส่วน `files:` ทำให้จับได้ทันทีว่ามีไฟล์แปลกปลอมเข้ามาในรอบ

สามงานที่ต้องใช้ไฟล์ `.tap` (ทำอยู่แล้วด้วยมือ) — ส่วนการ **เอาผลไปให้คนอื่นอ่านต่อ** ใช้
`.failures.txt` แทน:

```bash
grep '^not ok' .test-output/pure.tap                      # ไล่ตัวแดง
grep '^not ok' .test-output/pure.tap | sort > /tmp/after   # diff ก่อน/หลังว่าไม่มี regression
diff /tmp/before /tmp/after
```

เปลี่ยนที่เก็บได้ด้วย `BMS_TEST_OUTPUT_DIR` (CI ใช้เป็น artifact ได้เลย)

---

## 2. `npm run test:db` — เขียนจริงลงฐาน ห้ามรันกับ production

ชุดนี้สร้าง/ลบข้อมูลจริง และบางชุด **แก้ค่าของร้านจริงแล้วคืนตอน teardown**
(เช่น `product-vat-category` ที่แก้ประเภทภาษีของสินค้าทั้งร้าน) รันผิดฐาน = แก้ข้อมูลลูกค้า

```bash
cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
  POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' ../../.env.dev | cut -d= -f2-)" \
  REDIS_URL=redis://127.0.0.1:6379 npm run test:db
```

`POSTGRES_HOST=localhost` เพราะ `.env.dev` ชี้ host ชื่อ `postgres` (ชื่อใน docker network)

### ด่านกันรันผิดฐาน — ทั้งสองแบบออก exit `2` และ **ยังไม่รันเทสสักตัว**

ไม่ตั้ง env:

```
เทส DB ต้องมี POSTGRES_HOST + POSTGRES_DB (และ POSTGRES_USER/POSTGRES_PASSWORD)
ดูคำสั่งเต็มใน CLAUDE.local.md § ก่อน production
```

ชี้ไปเครื่องที่ไม่ใช่ท้องถิ่น:

```
ปฏิเสธการรันเทส DB กับ host "db.example.com" ซึ่งไม่ใช่เครื่องท้องถิ่น
ชุดนี้เขียนจริงลงฐาน ห้ามรันกับ production
ถ้าเป็น staging ที่ตั้งใจจริง ตั้ง BMS_TEST_ALLOW_REMOTE_DB=1
```

host ที่ถือว่าท้องถิ่น: `localhost` · `127.0.0.1` · `::1` · `postgres` · `db`

### ผ่านด่านแล้วจะพิมพ์ว่ากำลังรันกับฐานไหน

```
[gate] เทส DB จะรันกับ localhost/bms
[gate] โหมด db — 67 ไฟล์
```

**อ่านบรรทัดนี้ก่อนปล่อยให้รันต่อทุกครั้ง**

### ต่อฐานไม่ได้ = เทสแดง (ไม่ใช่ข้าม)

```
not ok 1 - restaurant intake -> callback -> atomic order; original demand, retries and tenant isolation
  code: 'ECONNREFUSED'
# tests 1
# pass 0
# fail 1
```

**แยกให้ออก**: exit `2` = ด่านปฏิเสธ ยังไม่ได้แตะฐาน · exit `1` = รันแล้วมีอะไรแดง
(รวมกรณีต่อฐานไม่ได้) — อย่างหลังไม่ได้แปลว่าโค้ดผิด ให้ดูว่า Postgres ขึ้นอยู่หรือยัง

### `npm run test:all` = pure + db (287 ไฟล์) ใช้ด่านและ env ชุดเดียวกับ `test:db`

---

## 3. รันไฟล์เดียวตอนกำลังแก้

ส่ง **ชื่อไฟล์บางส่วน** เป็นอาร์กิวเมนต์ที่สามให้ตัวรันกลาง:

```bash
node scripts/run-contract-tests.mjs pure restaurant-request
node scripts/run-contract-tests.mjs db   restaurant-request
```

บอกด้วยว่ากรองเหลือกี่ไฟล์ จึงเห็นทันทีถ้าพิมพ์ชื่อผิดแล้วรันไม่ตรงไฟล์:

```
[gate] โหมด pure — 1 ไฟล์ (กรองด้วย "restaurant-request" จาก 220)
# tests 30
# pass 30
# fail 0
```

กรองไม่ตรงอะไรเลย = exit `2` **ไม่ใช่ "ผ่าน 0 ไฟล์"** (ซึ่งอ่านเหมือนเขียว —
`contract-runner-contract` ตรึงข้อนี้ไว้ด้วยการรันตัวรันจริง):

```
ตัวกรอง "nope-nothing" ไม่ตรงไฟล์ไหนในโหมด pure (220 ไฟล์)
ตัวอย่างชื่อที่มี: admin-navigation-contract, ai-eval/archetype-policy-contract, ...
```

> **ทำไมต้องใช้ทางนี้กับชุด DB**: `npx tsx --test <ไฟล์>` ตรง ๆ **ข้ามด่านตรวจ host ทั้งหมด**
> และตอนนับเมื่อ 2026-09-07 **34 จาก 36 ไฟล์ของชุด DB ไม่มีด่านของตัวเอง** (มีแค่
> `restaurant-request-db-contract` ที่ assert `local test DB required`) — ตอนนี้ชุด DB มี 67 ไฟล์ และ
> **ยังไม่ได้นับใหม่ว่าตัวไหนมีด่านของตัวเอง** (บางตัวที่เพิ่มทีหลัง เช่น `customer-answer-evidence-db-contract`
> ต้องการ `BMS_EVIDENCE_DISPOSABLE_DB=1` + ฐานแยกของตัวเอง) — ชุดนี้เขียนจริงลงฐาน · ผ่านตัวรันกลางแล้วได้ทั้ง
> ด่าน host และ shim ครบ:
>
> ```
> ปฏิเสธการรันเทส DB กับ host "db.example.com" ซึ่งไม่ใช่เครื่องท้องถิ่น
> ```
> (ทดสอบแล้วว่าด่านยังทำงานเมื่อกรองไฟล์เดียว — exit `2`)

### ถ้าจะรันมือด้วย `npx tsx` จริง ๆ ต้องใส่ shim เอง

```bash
cd apps/web && npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
  --test ../../scripts/restaurant-request-contract.test.mts
```

ลืม `--import` แล้วได้ error ที่ไม่เกี่ยวกับเทสเลย:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'server-only' imported from
  .../apps/web/lib/log/log.server.ts
```

เทสที่ import โมดูลฝั่ง server (เช่น `lib/bms/tools/catalog.ts`) ต้องมี shim ตัวนี้
ส่วนเทสที่แตะแต่โมดูล pure รันได้โดยไม่มี — จึงพลาดง่ายและอาการไม่เหมือนเทสแดง

### Live realtime fan-out smoke

หลังเปิด web, Redis และ WS อย่างน้อยสอง instance ให้พิสูจน์เส้นจริงจาก domain event ผ่าน
outbox dispatcher และ Redis ไปถึงทุก socket ด้วย:

```bash
cd apps/web
set -a; source ../../.env.dev; set +a
POSTGRES_HOST=localhost \
BMS_REALTIME_WS_URLS=ws://127.0.0.1:8081/graphql,ws://127.0.0.1:8083/graphql \
npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
  ../../scripts/realtime-live-smoke.mts
```

สคริปต์รับ ticket ผ่าน HTTP route จริง ใช้ native socket header สร้างข้อมูล throwaway และลบทิ้ง
เมื่อจบ จึงต้องรันกับฐาน local เท่านั้น

---

## 4. `check-schema-readiness.mts` — ฐานนี้ apply migration ครบไหม (อ่านอย่างเดียว)

repo นี้ apply migration ด้วยมือตามเลข และ **ไม่มี schema probe ที่ไหนในแอป** เส้นทางร้อน
(สร้างบิล/ขาย/ส่งครัว) อ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข ฐานที่ตกไปหนึ่งไฟล์จึงล้มด้วย 42703/42P01
แล้วโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" เฉย ๆ (production redact ข้อความจริงทิ้ง) —
ตัวนี้แปลอาการนั้นกลับเป็น **ชื่อไฟล์ที่ต้องรัน**

```bash
npx tsx scripts/check-schema-readiness.mts
```

อ่าน `.env` / `.env.prod` / `.env.dev` ที่รากโปรเจกต์ให้เอง (env ที่ส่งมาชนะไฟล์)
และ **พิมพ์เสมอว่ากำลังตรวจฐานไหน** เพราะตรวจผิดฐานแล้วรายงานว่าครบ อันตรายกว่าไม่ตรวจ

บรรทัดแรกที่ต้องอ่าน:

```
ฐานที่กำลังตรวจ: app@localhost:5432/appdb (จาก env ที่ส่งมา)
```

### ครบ (exit 0)

```
✅ 9.66__bms_restaurant_order_requests.sql
✅ 9.40__bms_multi_store_stock_capabilities.sql
...
สรุป: ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น
```

### ขาด (exit 1)

```
❌ 9.66__bms_restaurant_order_requests.sql
   ผลถ้าไม่รัน: แชทร้านอาหารรับคำขอก่อนตรวจสต็อกไม่ได้ และร้านเปิดคิวตรวจคำขอไม่ได้
   - ไม่มีตาราง bms_restaurant_order_requests
   - ไม่มีคอลัมน์ bms_orders.restaurant_request_instructions

สรุป: ขาด 1 ไฟล์ — รันตามลำดับเลขนี้ (psql -1 ทีละไฟล์):
```

### ต่อฐานไม่ได้ (exit 1) — แยกจาก "ไม่มีปัญหา" ชัดเจน

```
❌ ต่อฐานข้อมูลไม่ได้ — ยังไม่ได้ตรวจอะไรเลย
   ต่อ localhost:5432 ไม่ได้ (Postgres ไม่ได้รันอยู่ หรือพอร์ตไม่ตรง)
```

### บนเซิร์ฟเวอร์ที่ไม่มี Node

ใช้ไฟล์ SQL ที่ generate จาก **ลิสต์ตัวเดียวกัน**:

```bash
docker compose ... exec -T postgres psql -U <user> -d <db> < db/checks/schema-readiness.sql
```

ได้ตารางสองอัน: `ไฟล์ที่ยังไม่ได้รัน / ของที่ขาด / ผลถ้าไม่รัน` แล้วบรรทัด `สรุป`

> **`db/checks/schema-readiness.sql` เป็นไฟล์ที่ถูก generate — ห้ามแก้ด้วยมือ**
> แก้ที่ `scripts/schemaReadiness.mts` แล้ว regenerate:
> ```bash
> npx tsx scripts/check-schema-readiness.mts --sql > db/checks/schema-readiness.sql
> ```
> เทส `schema-readiness-contract` เทียบไฟล์กับตัวเรนเดอร์ ลืม regenerate แล้วชุด pure แดง
> (เกิดจริงกับ `9.66` — ของที่ commit ไว้ตกแถวคอลัมน์ไป ทำให้ตัวตรวจบนเซิร์ฟเวอร์
> มองไม่เห็นคอลัมน์ที่ทำให้จอครัวตาย)

> **ลิสต์เองก็ขาดได้ และนั่นแย่กว่าไฟล์ที่ไม่ตรง** — ลิสต์ที่ขาดไฟล์ตอบว่า "ฐานพร้อม" แล้ว deploy
> ไปขายไม่ได้สักบิล · `schema-readiness-coverage-contract` เดินกลับทางจาก **คอลัมน์ที่
> `createOrderInTx()` เขียนจริง** แล้วบังคับว่าตัวที่มาจาก migration ในช่วงที่ลิสต์ครอบต้องถูก
> ประกาศไว้ · เส้นแบ่งอ่านจากลิสต์เอง ไม่ได้ฝังเลขไว้ · ด่านนี้คือตัวที่เจอว่า `9.82`
> (`board_game_session_id`) กับ `9.87` (`restaurant_service_mode`) หายไปทั้งคู่

> **ชั้นถัดไปของกับดักเดียวกัน: ชื่อตารางถูก แต่ลิสต์คอลัมน์ขาด** — `sql-table-reference-contract`
> กัน "ตารางที่ไม่มีอยู่จริง" ส่วน `insert-required-columns-contract` อ่านคอลัมน์ที่ห้ามว่าง
> (NOT NULL + ไม่มี DEFAULT) จาก `db/migrations` แล้วบังคับว่าทุก `INSERT INTO t (...)` และทุก
> `bulkInsert(client, "t", [...])` ใน `apps/web`/`packages` ต้องส่งค่าครบ · ด่านนี้คือตัวที่เจอว่า
> seeder ไม่เคยส่ง `bms_order_items.receipt_unit_price` (`9.22`) ซึ่งทำให้ปุ่ม "สร้างร้านทดสอบ"
> และปุ่ม "สร้างข้อมูลตัวอย่าง" ของร้านจริงล้มด้วย `23502` ทุกครั้ง

---

## 5. `check-bms-secret-key.mts` — คีย์เข้ารหัสใช้งานได้จริงไหม (อ่านอย่างเดียว)

ไม่พิมพ์ค่าความลับออกมา · รันกับ production ได้ · ควรรัน **ในคอนเทนเนอร์** เพื่อดูของที่แอปเห็นจริง:

```bash
docker compose ... exec web npx tsx scripts/check-bms-secret-key.mts
```

พิมพ์เป็นหัวข้อสี่ข้อตามลำดับนี้: **1) คีย์มาถึงโปรเซสนี้** (ตั้งไว้ไหม รูปแบบ hex 64 ถูกไหม) ·
**2) คุณภาพของคีย์** (เป็นคีย์ dev ที่คำนวณจากซอร์สได้ไหม) · **3) เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริง** ·
**4) ข้อมูลที่เก็บไว้จริง** (ถอดได้กี่ค่า)

ตัวอย่างจริงจากเครื่องที่ไม่ได้ตั้งคีย์และไม่มีฐาน (exit 1):

```
1) คีย์มาถึงโปรเซสนี้
   ❌ ไม่มี BMS_SECRET_KEY เลย
      ถ้าตั้งใน .env แล้วยังเห็นข้อความนี้ = compose ไม่ได้ส่งต่อ
3) เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริง
   ✅ encrypt → decrypt กลับมาได้ค่าเดิม
4) ข้อมูลที่เก็บไว้จริง
   ⚠️  อ่าน bms_tenant_channels ไม่ได้
```

**"ใช้งานได้" ไม่เท่ากับ "ปลอดภัย"** — สรุปแยก 4 แบบ: ใช้งานไม่ได้ / ใช้งานได้บางส่วน
(มีข้อมูลที่ถอดไม่ออก = ช่องทางตายเงียบ) / **ตรวจข้อมูลจริงไม่สำเร็จ** / ใช้ได้และเป็นคีย์ของเราเอง
· ข้อที่สามมีแยกไว้เพราะเวอร์ชันแรกรายงานว่า "ไม่มีค่าที่เข้ารหัสไว้เลย" ตอนที่ต่อฐานไม่ได้
ซึ่งอ่านแล้วเข้าใจว่าปลอดภัย

## 6. `rotate-bms-secret-key.mts` — ย้ายค่าที่เข้ารหัสด้วยคีย์ dev ไปคีย์จริง

ใช้เมื่อ production เคยรันโดยไม่ตั้ง `BMS_SECRET_KEY` (ค่าเก่าถูกเข้ารหัสด้วยคีย์ที่คำนวณจากซอร์สได้
ตั้งคีย์จริงแล้วจะถอดไม่ออก → ช่องทางของร้านดูเหมือนไม่มี token แล้วตายเงียบ)

```bash
npx tsx scripts/rotate-bms-secret-key.mts            # dry-run (ค่าปริยาย ไม่เขียนอะไร)
npx tsx scripts/rotate-bms-secret-key.mts --apply    # เขียนจริง
```

รันซ้ำได้ · ครอบ `bms_tenant_channels.{access_token,channel_secret}` และ
`bms_tenant_ai_config.api_key_encrypted` — **มีที่เก็บค่า `enc:` ใหม่ต้องเพิ่มใน `TARGETS`**

---

## 7. `npm run schema:export` — เรนเดอร์ `schema.graphql` (ไม่ต้องมีฐาน)

```bash
cd apps/web && npm run schema:export      # เขียน <repo>/schema.graphql
```

เรียก `renderBmsGraphqlSdl()` บน `buildBmsGraphqlSchema()` ซึ่งเป็น **สคีมาตัวเดียวกับที่
`/api/graphql` เสิร์ฟ** แล้วเรียง field แบบ lexicographic (ไม่ให้ลำดับ import สร้าง diff หลอก)

- **artifact นี้เป็นซอร์สไฟล์ ไม่ใช่ของที่ build ทิ้ง** — production ปิด introspection ไว้
  ไฟล์ที่ commit จึงเป็นสิ่งเดียวที่ client เอาไป codegen ได้
- **แก้สคีมาแล้วต้องรันตัวนี้ในคอมมิตเดียวกัน** ไม่งั้น `graphql-schema-artifact-contract`
  (อยู่ในชุด pure → CI จับ) แดงพร้อม diff ที่ชื่อ type
- ⚠️ เทสใน `scripts/` import แพ็กเกจ `graphql` ตรง ๆ ไม่ได้ (อยู่ที่ `apps/web/node_modules`
  เท่านั้น) และชื่อโฟลเดอร์ `apps/web/graphql` ชนกับชื่อแพ็กเกจภายใต้ `baseUrl="."` —
  ตัวเรนเดอร์จึงต้องอยู่ใต้ `apps/web/graphql/` และ import subpath
  (`graphql/utilities/index.js`) ไม่ใช่ `"graphql"`

---

## 8. `preflight-deploy.mts` — ตรวจก่อน deploy (อ่านอย่างเดียว ไม่ apply migration ให้)

```bash
npx tsx scripts/preflight-deploy.mts
```

resolve ว่า "ฐานเป้าหมายคือใบไหน" ครั้งเดียว (`scripts/dbEnv.mts`) แล้ว **ส่ง env ที่ resolve แล้ว
ต่อให้ลูกทุกตัวแบบระบุชัด** — เดิมรันสองเครื่องมือจากเครื่องเดียวกันแล้วอาจตรวจฐานคนละใบโดยไม่มี
อะไรบอก

ด่านที่บล็อก: `check-schema-readiness` · `JWT_SECRET`/`BMS_SECRET_KEY` (hex 64) ·
`check-bms-secret-key` · GRANT ของ `bms_app` (เรียกไฟล์เทสตัวเดิม **และตรวจว่าบรรทัดประกาศ
read-only ยังอยู่ก่อนเรียก**) · `NODE_ENV=production` ต้องไม่มี `BMS_ALLOW_FAKE_SEED=1` ·
**env ของ realtime/WS** (`WS_ALLOWED_ORIGINS` ต้องตั้งและต้องไม่ใช่ localhost · `JWT_SECRET`
ต้องยาวอย่างน้อย 12 ตัวอักษร ไม่งั้นเซ็น/ตรวจ ticket ไม่ได้เลย) · เตือนเมื่อ `WS_TRUST_PROXY`
ไม่ใช่ `1`

**exit `2` = "ตรวจไม่ได้" ห้ามอ่านว่าผ่าน** — ห้าม deploy เหมือน `1` แต่ทางแก้คนละเรื่อง
(ไปรัน migration อย่างหนึ่ง · ต่อฐานให้ได้ก่อนอีกอย่าง)

รายการที่คนต้องยืนยันเอง (เทส DB ผ่าน · เปิดดูในเบราว์เซอร์แล้ว · สำรองฐานก่อน migration ·
seed permission ใหม่ครบทุกร้าน) **จงใจเป็นคำเตือน ไม่ใช่ด่านที่บล็อก** — ด่านที่รู้อยู่แล้วว่าแดง
คือด่านที่ทุกคนเรียนรู้ที่จะข้าม

**⚠️ ยังไม่มีเทสของตัวเอง** และยังไม่เคยเห็นเส้นทาง exit `0` (เครื่องที่เขียนไม่มี Postgres)

---

## 9. เทสของตัวติดตั้ง Retail Local ที่อยู่นอกตัวรันกลาง

`run-contract-tests.mjs` หยิบเฉพาะ `*.test.mts` ไฟล์พวกนี้จึง **ไม่อยู่ใน `npm run gate`**:

| ไฟล์ | รันที่ไหน |
| --- | --- |
| `retail-local-bootstrap-behavior.test.mjs` | `.github/workflows/retail-local-managed-runtime.yml` (Ubuntu · Windows · macOS) — `node --test` |
| `retail-local-unix-diagnostics.test.mjs` | workflow เดียวกัน (Ubuntu · macOS) |
| `retail-local-update-transaction.test.sh` | workflow เดียวกัน (Ubuntu) |
| `retail-local-uninstall-container.test.sh` | workflow เดียวกัน — ใน container `ubuntu:24.04` |
| `retail-local-license-container.test.mjs` | workflow เดียวกัน (job ของ licensing) — `node --test` · **ต้องมี Docker** (probe mailbox ใน container แยก ไม่แตะ stack ของร้าน) |
| `retail-local-setup-diagnostics.test.ps1` · `retail-local-migration-checksum.test.mjs` · `installer-reports-browser-smoke.mjs` | **รันมือเท่านั้น** — ไม่มี workflow ไหนเรียก |

workflow เดียวกันรัน `go test` ของ `apps/retail-local-agent` และสร้างตัวติดตั้งแบบ unsigned เพื่อตรวจ
(smoke) — **ผลของ CI ไม่ใช่หลักฐานการติดตั้งจริงบนเครื่องสะอาด** ดู
[docs/business/retail-local-ga-readiness.md](../docs/business/retail-local-ga-readiness.md)

ส่วนชุด `*.test.mts` ของ Retail Local (`retail-local-contract`, `-managed-runtime-contract`,
`-release-{download,upload}-contract`, `-license-*`, `-optional-activation`, `-activation-retry`,
`-installation-registry`, `-request-body`, `-sample-data-*`, `installer-reports-*`) อยู่ในตัวรันกลางตามปกติ

---

## 10. สโมคและตัวขับ mutation ที่อยู่นอกตัวรันกลาง

ไฟล์กลุ่มนี้ **ไม่อยู่ใน `npm run gate`/CI** ต้องรันมือ · ผล "ผ่าน" ของมันจึงเป็นหลักฐานเฉพาะรอบที่มีคนรัน
และ **ไม่ใช่หลักฐานกับฐานข้อมูลจริง/ผู้ให้บริการจริง** (เกือบทุกตัว mock API)

### สโมคเบราว์เซอร์ (`scripts/*-browser-smoke.mjs`)

ทุกตัวใช้ Playwright (`BMS_PLAYWRIGHT_MODULE` ชี้โมดูลได้ · ค่าปริยาย `playwright`) เปิด Chrome headless
กับ dev server ท้องถิ่น (`BMS_SMOKE_URL` · ค่าปริยายแตกต่างกันต่อไฟล์ เช่น `http://localhost:3003`)
**ดัก `/api/*` และ `/graphql` ด้วย fixture `FAKE-*`** (เขียนอะไรลงฐานไม่ได้) แล้วเก็บภาพหน้าจอไว้ใต้
`.test-output/<ชื่อ>/` (สองตัวของเดสก์ท็อปเก็บใต้ `apps/desktop/dist-smoke/`) · หลายตัวไล่ทั้ง th/en และ
ความกว้าง 1440/1280 กับ 390 px

| ไฟล์ | หน้าที่ตรวจ |
| --- | --- |
| `tax-request-email-browser-smoke.mjs` | `/admin/tax-documents` — กล่องตรวจคำขอใบกำกับ: ติ๊กส่งอีเมลเป็นค่าเริ่มต้น · ปิด notice แล้วไม่ส่ง · ออกใบกำกับ+ส่งอีเมล · เหตุผลที่ส่งไม่สำเร็จแบบปลอดภัย · ส่งซ้ำที่ต้องยืนยัน (มี `expectedEmailId` + `emailKey`) · poll จนเห็นสถานะส่งแล้วโดยไม่ต้องกดอะไร (1280/390 px) |
| `tax-request-form-browser-smoke.mjs` | ฟอร์มขอใบกำกับฝั่งลูกค้าที่ `/tax-invoice/request` (ไม่มีคุกกี้แอดมิน) |
| `ai-usage-browser-smoke.mjs` · `retail-local-ai-browser-smoke.mjs` | แต้ม/การใช้ AI ที่หน้าแรก `/admin/assistant` `/admin/billing` (Cloud) · หน้า `/admin/billing` ของ Retail Local — สองตัวนี้ assert ว่า host ต้องเป็น localhost |
| `answer-evidence-browser-smoke.mjs` | ไทม์ไลน์หลักฐานคำตอบ AI ที่ `/admin/ai-quality` (`10.53`) |
| `customer-merge-browser-smoke.mjs` | กล่องตรวจก่อนรวมลูกค้า ที่ `/admin/customers` และ `/admin/assistant` |
| `customer-purchase-browser-smoke.mjs` · `dashboard-actions-browser-smoke.mjs` | รายละเอียดการซื้อในหน้า `/admin/customers` · ปุ่ม Action Center บนแดชบอร์ด (รวมกรณีไม่มีสิทธิ์จัดการ) |
| `cross-sku-promotion-browser-smoke.mjs` | โปรซื้อ A แถม B ข้าม SKU (`10.41`) |
| `board-game-library-browser-smoke.mjs` · `board-game-offer-checkout-browser-smoke.mjs` | คลังเกมที่ `/admin/board-game` · โปรค่าเวลาตอนเก็บเงิน (กรณีได้โปร/ไม่เข้าเงื่อนไข/บิลเก่า) |
| `desktop-*-browser-smoke.mjs` (6 ไฟล์) | หน้าขายของเดสก์ท็อป: สรุปตะกร้า · ธีม · สถานะรีเฟรช · เลือกตัวเลือกจากการสแกน · สมาชิก/แต้ม · การอัปเดต — รันบนเบราว์เซอร์ของเครื่องที่ทดสอบ ไม่ใช่แอป Electron จริง (`desktop-checkout-summary` เขียนไว้ตรง ๆ ว่าเป็นการจำลอง renderer/IPC **ไม่ใช่การรับรองบน OS จริง**) |
| `installer-reports-browser-smoke.mjs` | ดู § 9 — ใช้กับ dev server แยกของ installer reports เท่านั้น |

### อื่น ๆ

- **`tax-invoice-pdf-smoke.mts`** — เรียก `renderTaxInvoicePdf()` ด้วยใบกำกับ `FAKE` 60 บรรทัดข้อความไทย
  แล้ว assert ว่าได้ **4 หน้า** (ไม่มีหน้าเปล่าที่มีแต่ท้ายกระดาษ) และเขียน
  `.test-output/tax-invoice-pdf/sample.pdf` ไว้ให้เปิดดูด้วยตา · ไม่ต้องมีฐาน
  · ส่วน **`tax-invoice-pdf-bundle-contract.test.mts`** อยู่ในชุด pure ตามปกติ: transpile ตัว renderer
  แล้ว bundle ด้วย webpack ของ Next จริง จากนั้น render PDF และ assert ว่าฟอนต์ไทยถูกฝัง (`/FontFile2`)
  — มีไว้กันกรณีที่โค้ดรันได้ตอน dev แต่ bundle ฝั่ง server ไปหาไฟล์ AFM ของ Helvetica ที่ไม่มี (`PDF_FAILED`)
- **`testing/scheduler-smoke.mjs`** — สโมคคอนเทนเนอร์ของ central scheduler: ต้อง
  `docker build --target scheduler -t bms-scheduler:review -f apps/web/Dockerfile .` ก่อน แล้วรันจากราก repo ·
  สร้าง network/fake Web/Redis ทิ้งเองทั้งหมด ไม่ใช้ env ของ deployment · รายละเอียดที่
  [docs/architecture/scheduler.md](../docs/architecture/scheduler.md) § Verification ·
  ส่วน `central-scheduler-contract` และ `scheduler-diagnostics-contract` อยู่ในชุด pure
- **`testing/*-mutations.mjs`** (`board-game-chat-booking` · `board-game-chat-readers` · `board-game-guards` ·
  `emergency-facilities` · `pharmacy-guards` · `pharmacy-guidance`) — ตัวขับ mutation test แบบกลไก: แก้ซอร์ส
  ชั่วคราวแล้วดูว่าเทสที่ควรแดงแดงจริง จากนั้นคืนไบต์เดิม · **รันหลัง gate หยุดแล้วเท่านั้น** · บางตัวบังคับ
  ให้ส่ง SHA ของ backup stash ที่มีงานปัจจุบันครบเป็นอาร์กิวเมนต์ บางตัวปฏิเสธไฟล์เป้าหมายที่ยังไม่ commit ·
  ห้ามใช้ `git checkout`/`reset` คืนไฟล์ (อ่านหัวไฟล์ก่อนรันทุกครั้ง)
- **`infra/multi-instance-contract.test.mts`** — ชื่อเป็น `.test.mts` แต่อยู่ใน `scripts/infra/` ซึ่งตัวรันกลาง
  **ไม่เดิน** จึงไม่อยู่ในชุด pure · ต้องมี Redis + MinIO จริง ดู
  [docs/architecture/multi-instance-readiness.md](../docs/architecture/multi-instance-readiness.md)

## ตารางสรุป exit code

| exit | หมายความว่า |
| --- | --- |
| `0` | ผ่านทั้งหมด |
| `1` | มีเทสแดง / มี migration ขาด / ต่อฐานไม่ได้ — **รันแล้วและมีผลลัพธ์** |
| `2` | ตัวรันปฏิเสธก่อนเริ่ม (โหมดผิด, ไม่มี env ของ DB, host ไม่ใช่ท้องถิ่น) — **ยังไม่ได้รันอะไร** |

---

## เขียนเทสใหม่: เขียวไม่พอ ต้องพิสูจน์ว่ามันแดงได้

กฎของ repo นี้คือ **เทสที่ผ่าน mutation test ไม่ได้ = เทสที่ยังไม่จริง** วิธีพิสูจน์:
ย้อนโค้ดที่กำลังตรึงกลับไปทีละจุด แล้วดูว่า **เทสที่แดงคือตัวที่ควรแดง** จากนั้นคืนไฟล์

เจอมาแล้วหลายรอบว่าเขียวโดยไม่ตรวจอะไร:

- เทสสแกนซอร์สที่ไปเจอ **คอมเมนต์** ที่อธิบายกฎเก่า ไม่ใช่โค้ด → ตัดคอมเมนต์ก่อนเทียบทุกครั้ง
- `slice(indexOf(A), indexOf(B))` ที่ `B` ไม่มีอยู่จริง → `indexOf` คืน `-1` แล้วสไลซ์ไปท้ายไฟล์
  หรือได้ช่วงว่าง → assert ผ่านโดยไม่ได้อ่านของที่ตั้งใจ (ใส่ `assert.ok(slice.length > 0)` กันไว้)
- assert ที่ตรึง **รูปประโยคของโค้ด** ไม่ใช่การันตี → เขียนโค้ดใหม่แล้วแดงทั้งที่กฎยังอยู่
  ทางแก้คือเล็งที่พฤติกรรม (เรียกฟังก์ชันจริง) เมื่อทำได้
- เทสที่เลือกค่าตัวอย่างซึ่งบังเอิญผ่านทั้งสองทาง (เช่นขอไซซ์ที่เป็น `min()` อยู่แล้ว)

## เอกสารที่ลึกกว่านี้

- `scripts/ai-eval/README.md` — ชุด deterministic contract ของ AI pipeline + live-model eval
- `scripts/bms-log-triage/README.md` · `scripts/load-test/README.md`
- `CLAUDE.local.md` § ประตูก่อน merge/deploy — คำสั่งเต็มของเทส DB และของค้างต่อฟีเจอร์
- `docs/architecture/realtime-test-database.md` — วิธีรันชุด DB ของ `realtime-*-db-contract`
  ซึ่งต้องมี migration `9.70`–`9.74` (ต้องใช้ **คนละ instance** สำหรับ production-like rollout
  เพราะ role ของ dispatcher เป็นระดับ cluster และต้อง restore จาก dump เพราะสร้างฐานเปล่าจาก
  `db/migrations` ไม่ได้) · **จดจำนวนที่ผ่าน/แดงก่อน apply ไว้เป็น baseline เสมอ**


### Tax document controls (10.60)

`node scripts/run-contract-tests.mjs pure tax-controls` exercises the actual control service against
simulated query results: preview/confirmation, stale reads, RBAC/branch refusal, bucket credit limits,
retries, rollback on audit failure, substitutes, buyer correction and versioned sales/purchase archives.
It also executes the real sales-report builder with replacement chains, debit/credit signs and
zero-value document-event annotations. These tests do not execute PostgreSQL or prove RLS/concurrency.
The implementation round explicitly excludes database use at the user's request.

`node scripts/tax-controls-browser-smoke.mjs` opens the real tax route at 1280/390px and
intercepts every API with fixtures. It covers all five preview/confirmation flows, individual VAT
registration, mobile overflow and excluding unconfirmed previews from print. Screenshots and PDFs
are saved in `.test-output/tax-controls-browser`. Use a local dev server on port 3107 (or
`BMS_SMOKE_URL`) and an installed Playwright module (or its file URL in `BMS_PLAYWRIGHT_MODULE`).
This is UI verification only; it does not verify database transactions or production authentication.

## Restaurant feature completion and weighted-average valuation (2026-10-15)

The reference image's costing/recipe/SOP/BOM/price/VAT/GP/break-even/menu workflows now include
moving weighted-average material cost by SKU/variant/branch, reviewed opening stock values,
original-cost returns/transfers, valued losses/count adjustments, actual-sales menu engineering,
and a separate preview/confirmation workflow for real unit/pack/N-for-price prices.

New migrations: **10.67–10.69**. Apply these before starting the new application code. Initial
verification applied and re-applied them on the restored local throwaway database. The subsequent
explicitly authorized local-main rollout is recorded below.
10.69 prevents an inventory deletion/recreated SKU from inheriting an obsolete valuation balance;
append-only cost evidence is retained. Repeated inventory-multilocation runs pass with this FK.

| Verification on final implementation | Result |
| --- | --- |
| Full DB runner, 71 files / 740 cases | **726 pass, 0 fail, 14 target-specific skips** |
| Dedicated gift-current schema | 11 pass, 0 fail; legacy-only case runs below |
| Dedicated gift-legacy schema | 2 pass, 0 fail; includes shared setup |
| Dedicated answer-evidence database | 1 pass, 0 fail |
| Dedicated installer database | 1 pass, 0 fail |
| All 14 main-run skipped case names matched to successful dedicated runs | **14/14 covered** |
| New actual-cost/publication DB suite (part of full runner) | **16/16 pass** |
| Strict web typecheck and original 13 verification scripts plus new suite | **pass** |
| Full `npm run gate`: typecheck, 235 pure suites, production build | **pass; 2,814 pure cases passed, 6 skipped, 0 failed** |
| Actual cost/opening and price publication browser smokes | **8/8 pass: TH/EN, 1280px/390px; mocked APIs** |
| Generated GraphQL SDL and `git diff --check` | **pass** |

Commands remain `npm --prefix apps/web run typecheck:db-verification`, `npm --prefix apps/web run gate`
and `node scripts/run-contract-tests.mjs db` with the disposable local PostgreSQL/Redis environment.
The new strict scope is the original 13 files plus `restaurant-actual-costs-db-contract.test.mts`.
New browser script: `restaurant-actual-costs-browser-smoke.mjs`; the existing
`restaurant-price-plan-browser-smoke.mjs` additionally verifies publication preview/confirmation.

Evidence is in ignored `.test-output/costing-completed/` (`verification.json`, DB TAP, strict/gate
and browser logs), `.test-output/costing-special/`, and the two restaurant browser screenshot folders.
The new DB suite covers concurrent receipts, exact partial-return rounding, recipe consumption,
VAT/exempt/non-registered sales, stale/denied confirmation, audit rollback, shared pricing and
migration reapplication/RLS/grants. The public POS result shape is unchanged; new non-VAT sales
now freeze exempt revenue evidence without issuing a tax document.

Boundaries: historical unvalued sales stay unknown; opening reviews are prospective. Unlinked tax
adjustments, blind returns and legacy back-office financial returns still require reconciliation.
Actual menu contribution excludes labour/GP/shared overhead, which remain in reviewed branch P&L.
Mixed-menu bundles use the existing bundle-product workflow. Price publication is immediate/global;
registered checkout must use inclusive prices (exclusive planning prices convert before review).
The legacy exclusive-checkout configuration is refused. Browser mocks verify UI, not live auth or
payment integration; real SQL/business transitions are covered by the DB suites above. No deployment,
commit or push was performed by this completion task.

### Local Docker main database and real browser verification (2026-10-15)

At the user's explicit request, re-applied **10.67, 10.68 and 10.69**, in order, to local
`bms-postgres-1` / database `bms`, with `ON_ERROR_STOP`. All three committed successfully.
The tables and lifecycle FK already existed and the four new tables were empty before this run;
10.69 removed zero orphan balances. Verified forced RLS, grants, append-only history permissions,
indexes and the inventory composite FK. A new custom-format backup was taken first and its TOC
validated, stored with mode 0600 in ignored `.test-output/local-main-costing/`.

`restaurant-costing-live-browser-smoke.mjs` uses real password login, GraphQL and database writes;
it does not mock application APIs. Chrome pins the configured local HTTPS hostname to loopback,
checks the response's server address, and goes through the existing Docker Caddy/web stack.
It requires `BMS_LIVE_COSTING_FIXTURE` pointing to an independently provisioned, disposable
`live-costing-<uuid>@example.invalid` account fixture (`email`, `password`, `recipes` IDs), plus
`BMS_PLAYWRIGHT_MODULE` when Playwright is outside the normal module path. Never supply a real
shop account. Provision and remove fixtures separately; the browser runner never clears a DB.

The real-browser matrix passed **TH/EN × 1280px/390px**: actual menu sales/costs, branch isolation,
opening evidence preview/invalidation/confirmation, recipe BOM/SOP and cost estimate, VAT/GP and
daily break-even planning, unit/pack/N-for-price publication, recorded net profit, operating-cost
and allocation worksheets. Exact fixture SQL checks confirmed four publication histories and
four matching audits, all four UI opening values, unit price 107, pack/promotion price 214.
A subsequent sale through the real POS service used the published recipe price and froze 40 THB
ingredient cost. This last checkout assertion is service-level, not a POS browser/payment test.

Additional real-browser checks passed for explicit rent/depreciation review and direct branch
allocation: recorded net profit was **300 = 400 revenue − 80 material cost − 20 expenses**.
Live API checks rejected missing confirmation, stale publication fingerprints and an inaccessible
branch without invalidating login. The live in-app manual also rendered at desktop/mobile widths.
The test tenant and its business data were removed by exact UUID after verification; no original
shop rows were selected for cleanup. A scan of tenant-owned tables found only diagnostic
`system_logs`, retained for normal log retention. Session/fixture credential files were removed.

Evidence: `.test-output/local-main-costing/browser-summary.json`, `persistence-verification.json`,
`schema-verification.txt`, migration logs and TH/EN desktop/mobile screenshots. Strict typechecking
of the original 13 scripts plus the actual-cost suite passed again. The full DB suite above was
not rerun against the main database: fault-injection suites remain restricted to throwaway DBs.

10.70 costing completion extends the actual-cost DB suite with >1,000-row paging/search, unsold
menu population, explicit branch weighted recipe costs, stale receipt/publication checks, and actual
multi-variant POS settlement under branch/surface/time-scoped rules. It also exercises the shared
native cart calculator. Restore the disposable database baseline and apply 10.70 before DB mode.
Never fill opening valuations for real shops as test setup; live smokes use a disposable tenant.

`restaurant-costing-gaps-live-browser-smoke.mjs` verifies real local APIs/UI at desktop/mobile widths:
page 21 and literal search over 1,007 synthetic stock rows, menu population selection, weighted recipe,
price and two-menu plans, unknown branch cost, scoped/scheduled publication and promotion management.
Like the original live smoke it requires a provisioned disposable tenant fixture and pins HTTPS DNS to
loopback; it never mocks GraphQL or assigns opening costs to existing shops.

### Restaurant operating completion — 10.71–10.72 (2026-10-16)

This supersedes the earlier immediate/global-price, single-active-row and manual mixed-bundle
limitations above. `restaurant-completion-db-contract.test.mts` exercises branch BASE/PACK prices
(including custom base-unit names and recipe variants without inventory), real settlement/returns,
non-overlapping future promotion windows, atomic pinned-BOM publication, reviewed menu net-profit
allocation/reconciliation, stale confirmations, RBAC, unknown costs and audit rollback.
`restaurant-costing-migrations-db-contract.test.mts` also proves fresh/repeated 10.71–10.72,
forced RLS, schedule exclusion and append-only allocation grants. The strict verification config
includes the new suite alongside the existing agreed scripts.

Run the full DB runner on the restored disposable Docker database, not the shop database. The main
run has **753 cases: 739 passed, 14 environment-gated skips, zero failures**. All 14 skipped case
names are covered on dedicated gift-current/gift-legacy, empty answer-evidence and empty installer
schemas. Their guards intentionally remain enabled; incompatible schema cases cannot share one DB.
Full pure contracts and strict typechecking are also rerun. Detailed evidence and timestamps are in
ignored `.test-output/costing-completion/verification.json` and the accompanying TAP/log files.

The real local browser scripts use a disposable tenant with sufficient product quota, real login,
GraphQL and SQL, loopback-pinned HTTPS and no application API mocks:

- `restaurant-costing-live-browser-smoke.mjs`: existing cost/SOP/price flows, Thai/English desktop/mobile.
- `restaurant-costing-gaps-live-browser-smoke.mjs`: 1,007-row pagination/search, weighted costs,
  unknown branch evidence, future scoped promotion and management screens, desktop/mobile.
- `restaurant-completion-live-browser-smoke.mjs`: reviewed menu net profit, invalidated previews,
  branch base prices and mixed-menu publication, desktop/mobile. `BMS_SMOKE_RUN_SUFFIX` allows a
  second run in the same fixture while retaining the append-only publication records.

Migrations 10.71–10.72 are applied to local Docker main after a verified custom-format backup.
Only synthetic fixture costs/openings are written. Real opening stock is never inferred; historical
unknown cost remains unknown. Net menu profit is monthly management profit before income tax and
requires reviewed source expenses plus a confirmed allocation rule. Named-pack quantities remain
shared; branch prices override those units. Checkout still requires the established inclusive VAT
configuration, and the preview converts exclusive scenario input before publication.


Client impact checks for restaurant pricing: `desktop-costing-prices-browser-smoke.mjs` opens the
local `/pos/app` renderer with simulated GraphQL/IPC responses. It verifies repeated-scan branch
prices, an offer restricted to one size, whole-cart repricing before payment, offer expiry, and
wide/narrow layouts. `darwin`/`win32`/`linux` are simulated platform metadata, not OS certification.
Run with `BMS_SMOKE_URL=http://127.0.0.1:3000` and optional `BMS_PLAYWRIGHT_MODULE`.
Native Jest includes `CartContext`, `CartLineAmount`, and scoped promotion tests. The completion DB
suite compares the shared native/Desktop calculator with real branch-priced POS settlement on the
isolated port-5433 database; it must not run against the primary development database.

## Operations checklist Release A + B + C + D (2026-10-24)

- `node scripts/run-contract-tests.mjs pure operation-checklists`: input/threshold/state policy.
- `node scripts/run-contract-tests.mjs pure operation-team`: duty time/key validation, canonical snapshot fingerprint and distinct permissions.
- `node scripts/run-contract-tests.mjs db operation-checklists`: requires disposable local
  `bms_operations_test` and explicit POSTGRES settings; applies synthetic dependencies and
  migrations `10.91`, `10.92` and `10.93` twice. Exercises RLS, branch/RBAC, reviewer separation, immutable snapshots,
  idempotency/concurrency, audit rollback, schedules and private decoded image evidence. Release C
  additionally checks actor inboxes, opt-in thresholds, recipient revocation, deduplication, acknowledgment,
  rerouting, transaction rollback on notice failure and Bangkok-date/distinct-run reporting.
  D checks cross-branch overlap/concurrent publish, occurrence-time duty resolution, missing/ambiguous
  assignment, acceptance, stale handover/explicit transfer, immutable manager review, unified inbox,
  supervisor fallback, audit rollback, revoked recipients and real GraphQL adapters.
- `node scripts/operation-checklists-browser-smoke.mjs`: local Next UI with fake auth/GraphQL,
  real exported SDL, Thai/English at 1280/390 pixels, lost-response retry, publication confirmation,
  denial, search and overflow checks, plus personal work/inbox, escalation/acknowledgment, supervisor
  policy edits and reports, D roster/retry/publication, handover receipt/transfer, manager confirmation,
  bell read/deep links and roster deep links. Set `BMS_SMOKE_URL` and `BMS_PLAYWRIGHT_MODULE` as needed.
  Screenshots go to ignored `.test-output/operation-checklists-browser/`.
- [Scope and rollout caveats](../docs/business/operation-checklists.md). No production DB,
  real staff acceptance, external alerts or deployment is exercised by these fixtures.

## Release H verification

`operation-quality-db-contract.test.mts` uses only isolated `127.0.0.1:5433/bms_realtime_test`
with fake tenants; reapplies 10.98, checks holds/POS/online returns, review identity, disposal,
audit rollback, replay/RBAC/RLS, notifications and recorded trace. Do not run migration-reapplication
suites concurrently on the same database: they acquire schema locks.
Recheck regressions cover post-approval/active-task edits, inactive-variant disposal, catalog-drift
rejection, disabled wastage and immediate held-return notices (including future-due cases).
`operation-quality-browser-smoke.mjs` exercises the compiled operations/manual routes and committed
SDL in English/Thai at 1280/390px with mocked auth/transport (no production writes). Set
`BMS_SMOKE_URL` to the isolated built server; `BMS_PLAYWRIGHT_MODULE` may point to the local runtime.
The browser also asserts exact due-time preservation on findings-only edits and visible return links.
