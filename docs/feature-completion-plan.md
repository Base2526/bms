# BMS feature completion plan

Status: implementation backlog, not a production certification. Reviewed against the repository
on 2026-11-12. The release registry remains `baseline-in-progress`; a code status, a migration
filename, or a linked test does not prove tenant enablement or live-provider behavior.

## A–J execution tracker

These ten tracks translate the work below into reviewable completion gates. **None is fully
closed.** “Repository progress” describes the current working tree; it is not a deployed release.

| Track | Work | Repository progress | Closure still required |
| --- | --- | --- | --- |
| A | Inventory and release evidence | 86 known workflows registered; evidence template/checker added; missing direct test links reduced to 8 | Reconcile every older inventory row and create an exact clean-commit release record |
| B | Tenant security and RBAC | Permission matrix reads/writes now use tenant RLS context; write, actor audit and confirmation are atomic/explicit | Isolated DB denial, grants and concurrent-edit tests; Administrator UAT |
| C | Money, stock and order integrity | Existing service and pure/DB contract suites identified; shipment audit moved into its transaction | Restored DB races, replay/rollback, backup restore and shipment-create idempotency policy |
| D | Retail web cart and pickup | Catalog and signed checkout exist | Server-priced cart, retail pickup state machine and end-to-end customer pilot |
| E | Branch pricing | Shop-wide and some branch promotion rules exist | Branch price precedence, immutable snapshots and cross-channel satang tests |
| F | Restaurant counter and notifications | Pickup email templates/queue code exist; report digest now dispatches hourly for local send hours | Apply migrations, durable status-email retry, printer/display tests and branch pilot |
| G | Mobile and desktop POS | Native suites exist; code and packaging work is active | Signed builds, reconnect/replay, device and OS hardware matrix |
| H | External providers and delivery | Adapter scaffolds and capability gates exist | Contracts, verified signatures, sandbox/shadow/live reconciliation and carrier booking policy |
| I | Tax, finance, pharmacy and operations | e-Tax cron now uses central auth/history and reports partial failure; regulated workflows remain gated | Isolated DB/clinical/finance checks, licensed pharmacist, real sender/provider and branch pilots |
| J | Deploy and production qualification | Web gate and local draft evidence can run; target preflight exists | Clean artifact digest, target schema/flags, backup restore, tenant rollout and operator sign-off |

Track details and implementation order follow. Do not close a track from a code status or pure test
alone; attach the evidence listed in the completion rule below.

### Local verification on 2026-11-12

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

The draft release manifest currently lists 86 **known** code capabilities, not every BMS feature:
24 `AVAILABLE`, 39 `CONDITIONAL`, 15 `PILOT`, 6 `BETA`, 1 `WIP`, and 1 `MOCK`.
It has 8 capability IDs without a test that directly exercises their workflow. These are test
coverage gaps, not proof that the workflows are broken. Add a link only after the stated boundary
is exercised; the target run result must be recorded separately.

| Capability | Minimum useful proof | Additional closure |
| --- | --- | --- |
| `payments.review` | Confirmation boundary now has a direct pure contract; still prove slip approval/rejection, replay, permission and payment rollback together | Bank/provider evidence and human confirmation |
| `pos.expenses` | Shift cash-out, second PIN, idempotency and drawer reconciliation | Real register close-out |
| `reports.email` | Confirmed send, bounded file access, retry and provider failure | Verified sender and delivered attachment |
| `restaurant.waitlist` | Queue/book/seat transitions, same-transaction check open and capacity race | Branch seating pilot |
| `settings.byok` | Secret storage/redaction, provider switch and tool-permission invariance | Owner credential/provider test |
| `settings.marketplaces` | Signature, tenant mapping, duplicate webhook and failure replay | Official Shopee/Lazada contract verification |
| `shipping.carrier-integrations` | Provider booking outbox, retry and reconciliation | Signed Flash/Kerry contract and sandbox |
| `tax.etax` | Queue eligibility, repeat submission and fail-closed provider result | Verified signer/submission provider and tax review |

The remaining older inventory rows also need stable IDs or explicit planned-work entries before
changing `baseline-in-progress` to `complete`. The 8 rows above are only the current registry's
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
- A repeated `createShipment()` on an already `SHIPPED` order can attach another parcel. Define
  when replacement is legitimate, then enforce one replay outcome and test concurrent requests
  before enabling carrier booking for real merchants.
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

The public product page is a catalog, not a self-service order. Build a server-priced cart using
published `ONLINE_ORDER` items, variants and packs. Show every line before an affirmative; call
`createOrder()` and the existing signed checkout path. Refresh price, stock, promotions and shipping
at confirmation, with duplicate submission and last-item DB tests. Slip submission stays `PENDING`
until staff confirms payment.

Retail pickup needs its own fulfillment contract: selected branch, requested time, recipient,
preparation, ready and one-time handover. Define when reserved stock becomes consumed, how an
uncollected order expires, and how refund/tax rules apply. The current `orders.ts` permits
`fulfillmentType` only for restaurant online orders; do not relabel that flow as retail pickup.

### Branch pricing

Define server precedence and effective dates for branch price overrides while preserving shop-wide
defaults. Snapshot the selected price in the sale; never reprice a historical return from today's
catalog. Reuse the same pricing service in POS, OMS, checkout and customer tools. Test promotions,
packs, wholesale tiers and membership discounts to the satang across branches.

### Restaurant counter

Finish station-to-printer assignment, bounded print outbox/retry and operator-visible failures.
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
