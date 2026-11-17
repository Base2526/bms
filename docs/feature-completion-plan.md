# BMS feature completion plan

Status: implementation backlog, not a production certification. Rechecked against the repository
on 2026-11-17. The release registry remains `baseline-in-progress`; a code status, a migration
filename, or a linked test does not prove tenant enablement or live-provider behavior.
The detailed work packages at the end of this document cover the 36 known gaps from the
2026-11-17 recheck. They are a scoped backlog, not a promise that the registry is exhaustive.

## A–J execution tracker

These ten tracks translate the work below into reviewable completion gates. **None is fully
closed.** “Repository progress” describes the current working tree; it is not a deployed release.

| Track | Work | Repository progress | Closure still required |
| --- | --- | --- | --- |
| A | Inventory and release evidence | 88 known workflows registered; evidence template/checker added; missing direct test links reduced to 6 | Reconcile every older inventory row and create an exact clean-commit release record |
| B | Tenant security and RBAC | Permission matrix reads/writes now use tenant RLS context; write, actor audit and confirmation are atomic/explicit | Isolated DB denial, grants and concurrent-edit tests; Administrator UAT |
| C | Money, stock and order integrity | Existing service and pure/DB contract suites identified; shipment audit moved into its transaction | Restored DB races, replay/rollback, backup restore and shipment-create idempotency policy |
| D | Retail web cart and pickup | Server-reviewed variant/pack cart and signed checkout are in source; retail pickup is still absent | DB/browser proof, retail pickup state machine and end-to-end customer pilot |
| E | Branch pricing | Base/pack branch overrides, promotion windows, return snapshots and `10.116` dated branch prices exist in source | Isolated DB/browser proof, cross-channel satang tests and target rollout |
| F | Restaurant counter and notifications | Pickup email templates/queue code exist; report digest now dispatches hourly for local send hours | Apply migrations, durable status-email retry, printer/display tests and branch pilot |
| G | Mobile and desktop POS | Native suites exist; code and packaging work is active | Signed builds, reconnect/replay, device and OS hardware matrix |
| H | External providers and delivery | Adapter scaffolds and capability gates exist | Contracts, verified signatures, sandbox/shadow/live reconciliation and carrier booking policy |
| I | Tax, finance, pharmacy and operations | e-Tax cron now uses central auth/history and reports partial failure; regulated workflows remain gated | Isolated DB/clinical/finance checks, licensed pharmacist, real sender/provider and branch pilots |
| J | Deploy and production qualification | Web gate and local draft evidence can run; target preflight exists | Clean artifact digest, target schema/flags, backup restore, tenant rollout and operator sign-off |

Track details and implementation order follow. Do not close a track from a code status or pure test
alone; attach the evidence listed in the completion rule below.

### Local verification on 2026-11-16

On a dirty Windows working tree, `npm run gate` passed: release registry, regression inventory,
TypeScript, 3,804 pure tests (6 skipped), and the Web production build (151 static pages). The
Mobile TypeScript check and Jest suite (473/473), and Desktop Node suite (153/153), passed
separately. The gate first exposed a Windows path-separator error in the Admin copy scanner and a
Windows `spawn npx ENOENT` in the load-measurement contract; both were repaired and the full gate
passed. This is local source evidence only. No isolated DB suite, authenticated browser, live
provider, hardware, backup restore, or target deployment was run in this pass.

### Earlier local verification on 2026-11-12

The current **dirty working tree** passed `cd apps/web && npm run gate`: the release-registry
check, regression inventory, TypeScript, 3,587 pure assertions (6 skipped), and production
build. The exported GraphQL schema contract and Mobile TypeScript check also passed. Mobile Jest
passed 462/462 assertions across 59 suites; Desktop `npm test` passed 138/138. These results
belong to this workspace state, not a clean release commit or target deployment.

The browser request for `/admin/payment` redirected to `/admin/login?next=/admin/payment` as
expected for an unauthenticated visitor. The login page rendered, but the payment editor behind
authentication was not inspected at desktop/mobile widths. Local PostgreSQL refused connections,
so database contracts, authenticated UI flows and migration verification remain unrun. No live
provider, hardware, backup restore or production rollout was exercised.

## Completion rule

Record four independent results for each workflow: (1) implementation and boundary tests,
(2) database/browser/native tests on the exact commit, (3) pilot with the intended tenant,
provider and hardware, and (4) target deployment evidence (artifact digest, schema, flags,
permissions, rollback and operator sign-off). A missing result stays visible; never turn it into
`AVAILABLE` by inference. `scripts/release-feature-registry.json` tracks known code workflows;
planned work and external gates below are deliberately separate.

## Order of work

| Wave | Deliverable | AI can complete in the repository | External closure |
| --- | --- | --- | --- |
| 0 | Release baseline | Reconcile registry with `feature-inventory.md`, add specific test links, check migration references and record missing evidence | Read-only target schema/flag check and deployment owner |
| 1 | Core transaction safety | DB tests for sale/payment/stock/return races, idempotency, tenant/RBAC denial and rollback; repair failures in shared services | Isolated restored test database; backup/restore drill |
| 2 | Retail self-service | Web cart and retail Click & Collect through existing order/checkout services, with server pricing and confirmation | Shop policy for reservations, handover and cancellation; pilot |
| 3 | Branch commerce | Branch price precedence and immutable sale snapshots across POS, OMS, AI and reports | Price policy approval; multi-branch pilot |
| 4 | Restaurant counter | Station printer routing, pickup-specific messages and queue failure/retry coverage | Named printer/display hardware and branch pilot |
| 5 | Native clients | Mobile timeout/replay/reconnect and desktop packaging/recovery; add missing peripherals one at a time | Signed builds and device/OS matrix |
| 6 | External channels | Provider adapters, verified signatures, durable inbox/outbox, reconciliation and failure recovery | Contracts, credentials, sandbox/shadow/live evidence |
| 7 | Regulated and pilot areas | Tax/bank DB coverage, pharmacy safeguards, Operations A–H and Retail Local reliability | Tax/provider review, licensed pharmacist, real branch and clean-machine qualification |

Do not start a later wave by weakening an earlier transaction or tenant boundary. Independent
provider pilots may run while repository work continues, but their flags stay off until their own
gate passes. Keep each change small enough to review and release independently.

## Wave 0: release evidence

- Reconcile every human inventory row and newer domain workflow to a stable registry ID or an
  explicit planned-work entry. Do not publish registry counts as a total before this is complete.
- Link a test only if it exercises that feature's service, adapter or caller. A link identifies a
  suite; the manifest must not claim that it ran or passed. Keep `maxUnmappedTests` at the actual
  remaining baseline so unmapped evidence cannot silently grow.
- Compare code and migration identity numerically. Check target schema with the read-only
  readiness script before deployment; run DB contracts only on an isolated database.
- Persist a release record containing commit, artifact digest, environment, applied migrations,
  flags, package policy, tenant scope and results from Web, DB, browser, Mobile, Desktop and live
  integration checks. The present manifest cannot answer per-tenant availability alone.

Exit: the registry and domain docs agree on code status, and every missing production dependency
has a named owner and evidence slot. See [release-feature-control.md](release-feature-control.md).

### Feature-level test links still missing

The draft release manifest currently lists 88 **known** code capabilities, not every BMS feature.
The current 88 known entries comprise 24 `AVAILABLE`, 39 `CONDITIONAL`, 17 `PILOT`,
6 `BETA`, 1 `WIP`, and 1 `MOCK`. A `CONDITIONAL` entry may simply require ordinary shop
configuration or permission; it is not automatically an unfinished implementation.
It has 6 capability IDs without a test that directly exercises their workflow. These are test
coverage gaps, not proof that the workflows are broken. Add a link only after the stated boundary
is exercised; the target run result must be recorded separately.

| Capability | Minimum useful proof | Additional closure |
| --- | --- | --- |
| `pos.expenses` | Shift cash-out, second PIN, idempotency and drawer reconciliation | Real register close-out |
| `reports.email` | Confirmed send, bounded file access, retry and provider failure | Verified sender and delivered attachment |
| `restaurant.waitlist` | Queue/book/seat transitions, same-transaction check open and capacity race | Branch seating pilot |
| `settings.byok` | Secret storage/redaction, provider switch and tool-permission invariance | Owner credential/provider test |
| `settings.marketplaces` | Signature, tenant mapping, duplicate webhook and failure replay | Official Shopee/Lazada contract verification |
| `shipping.carrier-integrations` | Provider booking outbox, retry and reconciliation | Signed Flash/Kerry contract and sandbox |

`payments.review` now links the REST/GraphQL human-confirmation boundary contract, and `tax.etax`
links the cron auth/history/partial-failure contract. Neither link proves payment rollback, e-Tax
queue eligibility or live provider submission; those checks remain open.

The remaining older inventory rows also need stable IDs or explicit planned-work entries before
changing `baseline-in-progress` to `complete`. The 6 rows above are only the current registry's
test-link debt.

## Wave 1: core business correctness

- Prove last-item competition between POS and online orders, reservation release, duplicate sale
  and payment retries, partial refund/void, lot-aware return and cross-branch return rollback.
- Assert the same tenant/branch and cashier permission gates at REST and GraphQL boundaries.
  Sensitive writes require confirmation and same-transaction audit.
- Drawer cash-out and void now reject a missing or identical second approver at the service
  boundary as well as the PIN-verified adapters. A cash-movement replay with changed amount,
  direction, reason, device, shift or actor now returns `INVALID` rather than reporting the old
  movement as a success. The pure service-boundary tests passed; the expanded DB scenario still
  needs the isolated test database.
- `createShipment()` now records `shipping.create` in the same transaction for REST, GraphQL and
  AI tool calls with a server-derived actor. Prove audit rollback and grants on an isolated DB;
  the previous GraphQL-only post-commit audit gave no such guarantee.
- A repeated `createShipment()` now returns the existing parcel for matching details and rejects
  changed details or legacy duplicates. The pure boundary covers replay and refusal; the concurrent
  DB assertion is added to `multi-store-stock-db-contract` but still needs the isolated database.
  Deliberate changes use the tracking editor. Verify this on the target schema before enabling
  carrier booking for real merchants.
- Parcel creation and the ordinary `shipOrder()` path now share one reserved-stock consumer. It
  checks every inventory row, consumes tracked lots, and records SHIP movements in the same tenant
  transaction. The new DB contract must run on the isolated database before this is considered proven.
- Reconcile bill line amounts, payment allocations, movements, tax snapshots and reports after
  every scenario. Restore a backup to a different isolated instance and reconcile again.
- Verify Redis, cron ownership and realtime recovery without letting a failed notification undo
  a committed sale.

Exit: no duplicate money or stock movement on replay; a rejected operation leaves no partial
business evidence; denial reveals no other tenant's data. Use the invariants in
[agent-invariants.md](agent-invariants.md) and the smoke flow in
[retail-omnichannel-readiness.md](business/retail-omnichannel-readiness.md).

## Waves 2–4: missing customer and counter workflows

### Retail web cart and Click & Collect

The public product page now adds base-unit variants and configured packs to a local cart. A tenant-scoped server preview
simulates `createOrderInTx()` and rolls back; a signed 10-minute review token binds the server totals
and the confirmation rechecks publication, price and stock before one commit. Repeated confirms
reuse the order idempotency key and return its signed checkout link. Pack size and price are
revalidated from `bms_product_packs`; the browser sends only the pack code and count. A complete
customer pilot is still missing; the new DB contract for rollback, stale price and replay has not
run on the isolated database. Slip submission stays `PENDING` until staff confirms payment.
Public catalog stock and product-detail stock for retail now use the default order branch; a
restaurant or a shop with no active branch cannot offer the retail cart. The updated DB and browser
checks remain open.

Retail pickup needs its own fulfillment contract: selected branch, requested time, recipient,
preparation, ready and one-time handover. Define when reserved stock becomes consumed, how an
uncollected order expires, and how refund/tax rules apply. The current `orders.ts` permits
`fulfillmentType` only for restaurant online orders; do not relabel that flow as retail pickup.

### Branch pricing

Base/pack branch overrides already win over shared catalog prices, and sale snapshots protect
historical returns. `10.116` now adds future branch price windows with confirmed cancellation;
expiry restores the current override or shared catalog. Promotion windows remain a separate
mechanism. The new path still needs migration application, isolated DB and desktop/mobile browser
proof. Then prove the chosen price and discounts to the satang across POS, OMS, checkout and
customer tools. Do not treat source code or a passing pure suite as a tenant rollout.
The price resolver now keeps legacy overrides readable when `10.116` has not yet been applied.

### Restaurant counter

The Desktop workstation has a local station-to-OS-printer pilot with a bounded journal and
operator-reviewed uncertain retries. Centrally managed printer profiles, shared routing across
workstations, browser/mobile printing and named hardware verification remain open; the kitchen
display remains the work source of truth. See [business/pos.md](business/pos.md).
Pickup-specific status email templates and routing are implemented in `10.114`; apply that migration
before the caller. Target preflight checks that all eight Thai/English templates are published and
active; live delivery through the configured mail provider remains to verify. The parcel service now
rejects `PICKUP` before stock or shipment writes, including when a saved address exists; a pickup
handover still uses the order stock transition. The pickup queue itself
has code and migrations `10.112`–`10.113`:
verify issuance after sale, same-number replay, kitchen ready/undo, void, public-board redaction,
display windows and hardware. SMS/LINE queue calling is separate provider work.

Order-status email is currently fire-and-forget after commit. A provider failure can lose a
notification without retry; a durable outbox and replay/duplicate-send policy need design and DB
tests before calling delivery reliable.

Exit: customer and operator can complete each workflow end to end on desktop and mobile browser
widths, with DB race/rollback evidence and no invented payment or fulfillment state.

## Waves 5–7: controlled rollout

- Mobile and Desktop: test installed signed builds, pairing/keystore recovery, pending offline
  cash, reconnect/replay and actual scanner/printer/drawer/display models. Emergency Offline
  remains plain retail cash on the phone until a separately designed expansion is proven.
- TikTok outbound, Shopee/Lazada, Flash/Kerry and delivery platforms require verified provider
  authority. Finish adapters and deterministic retry/reconcile tests first, then sandbox, shadow
  comparison and a real settlement cycle. GrabFood/LINE MAN remain contract-blocked.
- PDF invoice email and SMTP require a verified sender and real-provider send/retry evidence;
  e-Tax requires a verified signing/submission provider. Issuing a tax invoice is not submission.
- Bank reconciliation remains an evidence sidecar. Add DB isolation/rollback tests and a finance
  pilot; a confirmed link must never mutate payments, AR, expense, refund, tax or ledger rows.
- Pharmacy intake stays flag-off until approved shop guidance, licensed pharmacist workflow,
  clinical/privacy review, DB tests and real pilot. AI never makes a clinical decision.
- Operations A–H need branch-role, recipe, lot and unit UAT; quality holds restrict usable lots
  without changing physical balances. Retail Local remains pilot until the exact release passes
  signing, clean-machine, replacement restore, failure recovery and support gates.

Exit: record provider/hardware/clinical/finance sign-off for the exact artifact and tenant scope.
Keep an unmet gate visible rather than describing it as a code defect or a completed integration.

## Verification for every change

1. Run the narrow affected pure or DB contract first. DB suites write data: never point them at
   production. Add a meaningful race/rollback/denial test when the change touches authority.
2. Run route browser smoke at desktop and mobile widths when changing a page, layout, provider
   boundary or CSS Module. Run Mobile Jest and Desktop Node suites when those clients change.
3. Run `cd apps/web && npm run gate` for the Web release candidate. Export `schema.graphql` in the
   same change as a typed GraphQL change.
4. Generate the release manifest from an exact clean commit, run target preflight, then record
   deployment and rollout evidence. A passing Web gate alone is not DB/native/provider proof.

Current known gaps and their business boundaries are documented in
[feature-inventory.md](feature-inventory.md),
[restaurant-cafe-readiness.md](business/restaurant-cafe-readiness.md),
[delivery-platforms.md](integrations/delivery-platforms.md) and
[retail-local-ga-readiness.md](business/retail-local-ga-readiness.md).

## Detailed work packages — 17 November 2026

The numbers below map to the 36 gaps in the 2026-11-17 recheck. A package is complete only when
its stated behavior, negative/rollback cases, and rollout evidence are all recorded. Use a separate
reviewable change for each service/schema boundary; UI and docs ship with that boundary. Dependencies
can be investigated in parallel, but an external contract, licensed review, policy decision, or
target deployment cannot be inferred from repository tests. The current working tree contains
uncommitted assistant-image and Desktop-display work; freeze an exact clean commit before recording
release results.

For each package, record: owner, target tenant/environment, code commit, migration list, flags,
test run and result, browser/native/provider or hardware evidence, rollback, and reviewer sign-off.
`P0` is a release prerequisite, `P1` closes customer and money paths, `P2` closes the restaurant
counter, `P3` depends on provider authority, `P4` is regulated, `P5` is pilot qualification, and
`P6` needs a separate product-scope decision. These are priority groups, not calendar promises.

### P0 — establish trustworthy release and transaction evidence

**[32] Complete the release inventory and tenant rollout record.**

- Reconcile every row in `feature-inventory.md` and newer domain docs with a stable registry ID or
  an explicit planned-work entry; correct dated contradictions such as retail cart, scheduled branch
  prices, pickup queue and the Desktop station-printer pilot. Add direct workflow tests for the six
  unmapped IDs listed above, without claiming that a link means the suite passed.
- Generate a manifest from an exact clean commit. Store its artifact digest, applied target
  migrations, effective flags/entitlements and tenant scope alongside Web, DB, browser, native,
  provider and hardware results. Exit when the manifest can answer whether a named tenant can use
  a named workflow, and missing evidence remains visible rather than marked `AVAILABLE`.

**[33] Prove money, stock, order and tenant authority on an isolated restored database.**

- Baseline the restored schema, apply relevant migrations twice, and run concurrent last-item POS/
  online sales, payment confirmation, replay with the same and changed idempotency key, partial
  return/void, lot-aware cross-branch return, shipment creation and audit-failure rollback.
- Assert tenant/branch/RBAC denial at REST and GraphQL, plus totals from order line amounts,
  payment allocations, stock movements, tax snapshots and reports. Restore an encrypted backup
  to a different throwaway instance and reconcile the same totals. Exit only with zero duplicate
  money/stock movement and zero partial evidence after a rejected operation.

**[36] Resolve tax-point and document-policy decisions before changing behavior.**

- Ask the shop's accountant to decide, with dated examples and expected VAT periods, the tax point
  for online prepayment, delivery, services and deposits; full invoices after partial return;
  corrections, credit/debit notes and amended filings. Record approver, scope and source evidence
  in [tax-accounting-review.md](business/tax-accounting-review.md).
- Only then change the service, migration, API/DB tests and operator manual together. Exit when
  every affected money/document transition has an approved expected result and an immutable audit
  path. A policy review is not authority to backdate or bypass existing guards.

**[34] Qualify realtime recovery and admin capacity.**

- Verify every named subscription has the intended caller refetch, permission and redaction
  behavior; exercise reconnect, Redis outage, outbox backlog, trigger rollback and multi-instance
  recovery on the throwaway environment. Keep polling fallback until caller parity is proven.
- Define the `active admin` workload and per-screen latency target, then run repeatable dashboard,
  Inbox, orders and Customer 360 load scenarios. Exit when measured capacity meets the approved
  target on the release topology; the old 1,000-admin goal is not a current capacity claim.

**[35] Close the System Health observation gaps.**

- Inventory REST routes not wrapped by `withRouteErrorLog()`, add bounded metrics where useful,
  enable and verify `pg_stat_statements` through an operations change, and produce an actual daily
  slow-query report. Decide app CPU/memory collection separately because Docker-socket access
  changes container privileges.
- Exit when an operator can see request errors/latency and slow queries from the target deployment,
  with known unwrapped/streaming limits documented. Do not add per-request database writes.

### P1 — finish retail self-service and branch commerce

**[16] Qualify the existing public retail cart.**

- Run the new cart DB contract on an isolated database: variant/pack pricing, ten-line limit,
  tenant/branch stock, expired or tampered review token, changed price/stock/publication, duplicate
  confirmation, rollback and signed checkout. Run the actual public product/cart/checkout path at
  desktop and mobile widths with a real test tenant.
- Exit when a customer can review, confirm once, submit a slip as `PENDING`, and staff can confirm
  payment without an invented gateway result. Pilot one shop with configured payment details.

**[01] Build a retail-specific Click & Collect contract.**

- Product owner decides selected branch, requested versus promised collection time, recipient
  proof, reservation expiry, uncollected order, cancellation/refund and tax treatment. Add retail
  fulfillment states and service methods without reusing restaurant `fulfillmentType` as authority.
  Use the existing order/stock/payment services and tenant transactions.
- Add checkout, staff preparation/ready, customer notification and one-time handover UI. Prove
  concurrent collection, repeat handover, expired reservation, partial return and branch denial on
  a DB; run customer and counter browser flows. Exit after a real branch pilot from cart to pickup.

**[17] Qualify scheduled branch prices and define remaining branch price scope.**

- Apply `10.116` on a restored database and rerun it; test non-overlap, future start, cancellation,
  expiry fallback and sale-time price snapshots. Compare satang-exact totals across POS, mobile,
  Desktop, orders, cart, checkout, AI tools, returns and reports.
- Ask product/pricing to decide whether wholesale quantity ladders and member-tier discounts must
  also differ by branch. Implement only the approved scope, with server price authority and a
  multi-branch pilot. Exit when historical bills remain unchanged after a price edit.

**[18] Roll out lot identity through transfers.**

- Confirm `10.107` on the target before deploying transfer writers. On an isolated restored DB,
  prove FEFO send, receive with lot number/expiry, duplicate send/receive, conflicting expiry,
  held/unknown lots, rollback and tenant/branch grants; compare source and destination lineage.
- Exit after an operator runs a real send/receive and the destination lot can be traced back to
  its source. Keep the feature WIP until target migration and pilot evidence are recorded.

**[09] Scope and implement advanced coupon marketing separately.**

- Decide which of product/category/channel targeting, multiple coupons per order, bulk wallet
  campaigns and near-expiry views are required. For each selected rule, define precedence against
  promotions, member/points discounts, returns, quota and anonymous customer identity.
- Add server-side preview/reservation/redemption and bounded campaign reads, then DB-test quota
  races, rejected codes, replay and rollback. Exit when POS, online orders, AI and reports agree on
  the frozen discount; do not ship a UI-only eligibility rule.

**[10] Extend follow-up automation only after choosing a workflow model.**

- Product owner specifies multi-step branches, scoring inputs, stop conditions, opt-out and human
  review. Keep the existing scheduler's six mandatory stops and channel outbound restrictions.
- Build a versioned rule/workflow model, deterministic scheduling and bounded history. Test
  duplicate cron claims, new-inbound rearm, partial/uncertain sends, provider failure and tenant
  isolation. Exit after a live channel sandbox and one reviewed pilot cohort.

### P2 — restaurant counter, pickup queue and notification reliability

**[11] Decide restaurant COD and offline dine-in as separate projects.**

- For COD, obtain payment, rider-handoff, cancellation/refund and tax ownership policy before
  touching `markPacking()`; test that unpaid food cannot appear paid. For offline dine-in, design
  durable table/check/round conflict resolution before adding a queue beyond plain retail cash.
- Build queue calls through SMS/LINE only after provider identity, consent, delivery status,
  replay and opt-out rules exist. Exit for each subproject with a branch pilot; the existing queue
  board is not evidence that external messages or offline dine-in work.

**[12] Complete station-printer routing beyond the Desktop pilot.**

- Define centrally managed printer profiles, station/workstation ownership, duplicate prevention,
  offline journal recovery and operator handling of uncertain prints. Preserve KDS as work authority;
  a print result must not move kitchen or order state.
- Implement shared routing one client at a time, then test named printer models, paper/network
  failure, retry and reassignment on real hardware. Exit after the branch signs off the printed
  tickets against KDS rounds and no duplicate kitchen action occurs.

**[31] Qualify pickup numbers, public board and promotional media.**

- Apply `10.112`–`10.115` in order. DB-test number uniqueness/replay, issuance after sale, kitchen
  ready/undo, void, window expiry and public-board redaction; browser-test desktop/mobile board
  layout and media fallback. Use separate evidence for a physical display and speakers.
- Exit when a branch can issue, call, correct and close a number on its target display without
  leaking customer or order identifiers. SMS/LINE calling remains [11].

**[22] Make status email durable and qualify tax-PDF/SMTP delivery.**

- Convert fire-and-forget order-status email to a committed outbox with explicit retry and
  uncertain-send reconciliation; define a stable message key and bounded backoff. Confirm all
  `10.114` pickup templates on the target before enabling the caller.
- With a verified sender, exercise success, timeout, provider rejection, retry and duplicate
  prevention for status emails and `10.58` invoice PDFs; apply `10.59` before SMTP logging. Exit
  when mail logs and the customer mailbox agree for pilot messages; keep provider acceptance
  distinct from actual delivery.

**[23] Certify POS receipt printers and drawers.**

- Select a named printer/drawer matrix per OS and transport. Exercise `DLE EOT`, receipt raster,
  paper-out/disconnect, retry, drawer pulse and browser fallback after a server-backed sale.
- Exit with model, firmware, OS, driver, connection and test result recorded for each supported
  combination. A passing unit test or browser print dialog does not certify drawer operation.

### P3 — external channel and provider contracts

**[02] Add TikTok outbound only from an official send contract.**

- Obtain the eligible business account, official authentication/send API, webhook event identity,
  rate limits, retry and media rules. Keep inbound-only Inbox behavior until those are verified.
- Add a channel adapter and durable outbound status, then test signature, recipient binding,
  duplicate send, timeout, provider error and no-AI fallback. Exit after sandbox send/reply and
  staff/AI pilot; a locally saved Inbox row is not delivery to TikTok.

**[03] Replace Shopee/Lazada beta scaffolds with verified marketplace contracts.**

- Verify each provider's real webhook signature, event IDs, tenant/shop mapping, order and chat
  permissions, seller-managed payment/shipping semantics, retries and API version. Keep each
  provider independently gated; do not copy the TikTok-shaped signature assumption.
- Build sanitized fixtures for bad signatures, duplicates, changed payloads, out-of-order events
  and failed persistence; then run provider sandbox and shadow reconciliation before any live
  merchant. Exit only when the provider's official contract and one complete merchant cycle match
  local order, stock and channel evidence.

**[04] Implement Flash/Kerry booking after merchant authority is obtained.**

- Acquire account-issued sandbox/production URLs, authentication, label, cancellation, tracking,
  webhook and idempotency terms. Map provider payloads only inside the carrier adapters and keep
  the shipment UUID as the stable retry key; never turn a mock result into booked state.
- Test duplicate booking, timeout, label URL, event order, terminal states and reconciliation.
  Exit after sandbox booking/label/tracking/cancel and a live merchant pilot with actual pickup.

**[05] Qualify foodpanda and unblock GrabFood/LINE MAN separately.**

- For foodpanda, obtain merchant portal webhook authority, rejection/scheduled-preparation and
  settlement samples; resolve pause/retry policy, catalog drift, authoritative fetch-latest,
  amendments, statement parsing, retention and escalation from
  [delivery-platforms.md](integrations/delivery-platforms.md). Keep provider tablet fallback.
- For GrabFood/LINE MAN, obtain the partner contract before enabling network calls. Per provider,
  run signed webhook, mapping, price, stock, accept/ready/handoff, cancellation, tax, payout and
  replay scenarios through sandbox, shadow and one real settlement cycle. Exit only after the
  platform control plane permits activation and operator/tax reviewers sign off.

**[06] Decide whether recurring BMS-plan billing should be built.**

- Finance/product specify merchant of record, invoice/VAT treatment, payment provider, mandate,
  failed charge, grace period, downgrade, refund and legacy-tenant policy. The existing plan and
  AI-points catalog must not be treated as a paid subscription ledger.
- If approved, add a separate subscription/payment service and webhook inbox with idempotent
  billing periods, human-visible adjustments and audit. Test webhook replay, missed cycles,
  proration and entitlement timing in sandbox; exit after a controlled pilot and reconciliation
  against provider payouts. Until then keep plan changes platform-admin operations.

### P4 — regulated finance, tax and pharmacy

**[19] Pilot bank reconciliation as evidence only.**

- Apply `10.110` on an isolated restored DB and prove RLS/grants, import deduplication, immutable
  statement facts, reviewer-only links, stale source detection, close/reopen and audit rollback.
  Assert that confirmed links never update payment, AR, expense, refund, settlement, tax or ledger.
- Finance reviewer defines account coverage, period close and export process. Enable server then
  public flag for one non-production tenant, reconcile a real-format statement, and sign off a
  limited pilot. Open Banking stays `NOT_CONFIGURED` until a separate verified contract exists.

**[20] Close e-Tax signing and submission.**

- Choose an approved signing/submission provider and obtain certificate custody, document schema,
  acknowledgment, rejection, duplicate, correction and retention rules. Apply tax-policy decisions
  from [36] before changing document eligibility or tax points.
- Test enqueue after an immutable eligible document, cancel-before-send, provider timeout,
  duplicate submit, partial failure and recovery with the same document identity. Exit only when
  a real provider acknowledgment and government-facing status are reconciled; an issued PDF or
  queued job is not proof of filing.

**[21] Qualify pharmacy intake with licensed clinical control.**

- Apply pharmacy migrations and DB-test licence row locking, clinical guidance states, approval
  consumption, channel sale prohibition, private evidence reads, emergency raw-message routing,
  RLS and rollback. Verify the shop-recorded licence against the real professional registry using
  a human procedure; the model must never approve clinical content.
- Have a licensed pharmacist review every active guidance body and emergency wording, then run
  privacy/clinical UAT with a real shop behind the off-by-default flag. Exit only with dated
  pharmacist approval, branch procedure and safe handoff evidence.

**[13] Add Thai-capable generated-report PDF output.**

- Embed a licensed Thai TTF in the shared document generator, keep XLSX/CSV content parity, and
  test mixed Thai/English labels, long values, page breaks and downloadable tenant-private files.
- Render and visually inspect representative Sales, Inventory, Profit and Customer PDFs. Exit when
  Thai glyphs print and copy correctly on the actual report formats without missing columns.

### P5 — native clients, local deployment and domain pilots

**[24] Qualify Mobile POS by device and workflow.**

- Run signed iOS/Android builds and test pairing/PIN, app background/foreground, reconnect,
  websocket invalidation, timeout replay and encrypted Emergency Offline cash recovery against a
  real test server. Add global HID capture only after deciding focus and accessibility behavior;
  separately scope second-screen display, background push and pharmacy evidence.
- Test named scanner models (including CR+LF), Wi-Fi printer and drawer on devices; record OS,
  hardware, firmware and failure behavior. Exit when each supported workflow passes the device
  matrix; do not widen offline sales beyond plain retail cash by implication.

**[25] Qualify Desktop POS packages and decide offline/update scope.**

- Sign/notarize the exact Windows, Linux and macOS packages; install and upgrade on clean target
  machines, exercising pairing recovery, OS keystore, customer/queue windows, printer journal,
  rollback and unpair. Keep the shell free of business rules.
- Product owner decides whether offline tender and auto-update are required for this release;
  each needs a separate authority/recovery design and security review. Exit after installed-package
  smoke and a named OS/hardware matrix, not source-only Electron tests.

**[26] Promote Retail Local only after exact-release GA gates.**

- Test signed installers and updater on supported clean Windows, Ubuntu and macOS targets;
  replacement-machine restore, off-host backup sample, power loss, disk full, schema rollback,
  peripheral matrix, diagnostics consent and support response. Reconcile sales/stock/payments/files
  and Desktop pairing before/after each drill.
- Commercial owner closes pricing/EULA/VAT/support decisions and verifies authentic promotion
  evidence for the exact artifact. Treat Local-to-Cloud migration, BMS-hosted backup, MA-expiry
  schema and multi-POS LAN installer support as separately scoped post-pilot projects; do not call
  the technical pilot GA to absorb them.

**[15] Decide which advanced factory functions are needed after the first pilot.**

- Pilot `10.122`–`10.127` with real SKU/base units, BOM yields, machine roster, QC reviewers and
  traceability. Then prioritize WIP, finite capacity, automatic MRP, conversion-cost valuation,
  co-products, fixed-price contracts and variable-weight rolls from actual pilot evidence.
- Each approved extension needs a single authoritative stock/cost transaction and DB tests for
  unit conversion, lot identity, holds, rollback and historical documents. Exit per extension,
  not by relabeling the current evidence-only machine/labor/energy fields as cost accounting.

**[27] Qualify Operations A–H with branch roles and lot controls.**

- Apply `10.91`–`10.98` in order; test scheduler claims, checklist revisions, handovers, production
  posting, material receiving, QC holds, separate-person approval, lot disposal and audit rollback
  on a restored DB. Verify quality holds change usable stock without changing physical balance.
- Run real branch/recipe/lot/unit UAT and obtain owner review for each release A–H. Exit when
  operator evidence matches movement/valuation ledgers; rosters and checklists remain evidence,
  not payroll or proof of physical presence.

**[28] Pilot branch planning, master data and fish-dock flows separately.**

- Branch requisitions/intelligence: verify `10.87`–`10.88` and `10.99`–`10.100`, permissions,
  forecast bounds and human review before any PO or transfer movement. Master data: review pilot
  imports, aliases and effective dates against actual shop data before broad use.
- Fish intake/owner: apply `10.119`–`10.120`, test weighed grams, receipt cost, opening balance,
  historical Excel as evidence-only, lot locations and sale price precision on a real test tenant.
  Exit per domain with an operator pilot; do not infer production deployment from migration files.

**[29] Close Board Game beta analytics and owner reads.**

- Apply `10.89` and any later board-game chat-publication migration on the target. DB-test
  utilization and RevPATH over opening-hour changes, partial legacy backfill, branch permissions,
  pass balances and library loan history; keep missing cost unknown.
- Run a cafe pilot comparing server totals with closed group bills and recorded sessions. Decide
  fixed overhead, game depreciation, box ROI and purchase recommendations separately; the
  current beta does not calculate them.

**[30] Qualify AI answer evidence and live Inbox delivery.**

- Run production-like/live-model evaluations for answer provenance: verified versus missing facts,
  malformed model output, provider failure and snapshot retention without retrying a business
  action. Apply the required migrations before enabling the evidence view.
- With real LINE/Meta sandbox accounts, test inbound media, provider send, `PENDING` timeout,
  `PARTIAL`, confirmed `FAILED` retry, deduplication and human reconciliation. Exit when the Inbox
  status reflects provider evidence and the reviewer can trace the exact answer; do not infer
  delivery from a saved message row.

### P6 — product-scope decisions and public presentation

**[07] Decide whether to build Q4 Profit/Growth Simulation.**

- Product/finance approve the questions, time horizon, assumptions, source fields and how unknown
  costs/capacity are shown. Keep output advisory and separate from actual ledger/report totals.
- If approved, create a versioned scenario model and reproducible calculations; test missing
  inputs, extreme values and scenario comparison with a pilot merchant. Exit when every projection
  exposes its assumptions and no screen presents it as a guaranteed result.

**[08] Hold Insurance Sales Inbox until regulatory scope is approved.**

- Obtain legal/compliance review of licence, solicitation, consent, data retention, staff role and
  what the AI may say. Do not route insurance leads through ordinary sales AI by changing a label.
- If approved, implement a distinct intake/handoff workflow with consent, restricted access,
  immutable audit and deletion/retention tests. Exit after compliance and operator sign-off.

**[14] Finish public help and live-dashboard figures only with real sources.**

- Replace `/help` mockup with indexed, role-aware deep links into the maintained guide catalog;
  test search, stale links and Thai/English parity. Decide which public metrics may be shown.
- For viewers, conversion and comments, acquire authorized provider APIs and define freshness,
  tenant scope and failure/unknown states. Remove the mock figures only after server-backed data
  and browser proof; never present placeholder numbers as live facts.

### Suggested first release slices

1. **Evidence baseline:** [32] registry reconciliation and the six missing workflow test links,
   then [33] isolated DB transaction proof and [36] policy decisions. This identifies which code
   can safely advance without changing shop behavior.
2. **Retail pilot candidate:** [16] cart proof, [17] branch prices and [18] lot transfers, each
   with its own migration/preflight and rollback; build [01] pickup only after its policy is agreed.
3. **Restaurant pilot candidate:** [31] queue/display and [22] reliable notifications, then [12]
   station printers and [23] hardware certification. Keep [11] COD/offline as separate scopes.
4. **Provider/regulatory candidates:** start contract, accountant and pharmacist work early, but
   activate [02]–[05] and [19]–[21] only after their own authority and evidence gates pass.

Do not combine all packages into a single release. Advance each package from `specified` to
`implemented`, `verified`, `piloted`, and `deployed for named tenants` with an exact artifact and
rollback record. A package may remain deliberately out of scope after the product owner decision;
record that outcome rather than silently marking it complete.
