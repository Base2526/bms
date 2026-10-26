# Operations production — Release E

## Release H — quality cases, lot holds and impact evidence

Entry: `/admin/operations` → Quality & lots. Apply **10.98 after 10.91–10.97 before any
web/cron/POS writer using this version**. Implementation readiness is not production approval.

1. Open a branch case with owner, Bangkok due time, priority, facts and separately labelled
   hypothesis. Optional source checklist/G inspection/E batch IDs are validated against the branch.
   Hold an exact DIRECT, nonserialized/nonbundle lot immediately without a checklist. Existing
   inactive variants remain eligible for quality restriction/disposal, without enabling sales or
   relaxing production eligibility. HOLD/RELEASE
   changes no quantity, cash, quarantine balance or inventory value; one active hold per tenant/lot.
2. Held lots are excluded from E/G readiness, order reservation, POS/online lot consumption and
   ordinary wastage. Generic stock adjustments/counts/transfers cannot bypass active holds. Healthy
   reconciled lots remain usable. Existing reservations are not silently cancelled; consumption
   rechecks holds and may require staff resolution.
3. Assign a published same-branch separate-review checklist. A–D retain execution, photos, failed
   checks, corrective actions, My Work and escalation. Approval alone never releases stock. New
   holds/held returns/receipts into held lots clear the current inspection link and require a new inspection, preserving
   earlier tasks/history. No automatic completion of superseded tasks.
   Case assignment/findings may change after approval without rewriting the immutable inspection.
   Findings-only edits retain the task version and exact due instant (including seconds). Active
   task reassignment still uses canonical state/assignee guards; submitted work cannot be reassigned.
4. Trace recorded downstream E input lots → output lots → sales/cross-branch returns, plus exact
   G receipt evidence. This is not a complete recall register: unrecorded history, transfers/repacking
   and customer identities are not reconstructed. Restricted branches visibly make results partial.
   Bounds: 200 lots, 500 rows per evidence family; overflow rejects rather than silently truncates.
   Save with current fingerprint; saved snapshots are historical and hidden after branch revocation.
   Cross-branch return links have deterministic ordering and are displayed alongside lot/branch IDs;
   sales and receipt quantities identify their source lot and unit.
5. Propose RELEASE or integer-base-unit DISPOSE after an approved inspection. Another authorized
   person confirms the exact proposal. Recheck case/hold version, quantity, unit, inspection identity
   AND version, branch and RBAC, including retries. Disposal additionally needs stock.adjust,
   reconciled lots and unreserved stock and uses the canonical wastage/movement/valuation transaction.
   Unknown cost stays unknown. Partial/full disposal never implicitly releases a lot; release does
   not override expiry. Old pending decisions must be rejected/reproposed after a new inspection.
   Rejection requires branch/reviewer access but not current catalog/stock eligibility: a stale
   proposal must remain rejectable. Disabled WASTAGE returns a business rejection, never partial work.
6. Submit findings; someone other than owner/creator closes only when no ACTIVE holds (even empty)
   or pending decisions remain. Held POS returns retain restriction across branches and invalidate
   inspection evidence. A hold created AFTER an earlier return does not automatically hold that
   destination: trace and explicitly hold it. Downstream lots are not automatically held.
7. Internal inbox: change/review notices commit with the action, including held returns/receipts
   before their due time. Overdue notices use the existing 15-minute cron; all deduplicate by case
   version. Weekly F reports include cases and exact disposal movements/value separately from
   E waste. No customer recall messages or external pushes.

Permissions: checklist.view + quality.view + product.view for details; quality.manage for cases/
proposals, quality.hold for restrictions, quality.review for decisions/closure, checklist.manage for
task assignment, stock.adjust for disposal. Tenant/branch guards and append-only audit are mandatory.
No AI tool/new realtime trigger. Search is server-backed; detail shows up to 500 holds/decisions,
active/pending first, and latest 100 events with a truncation warning. Resolve and refresh batches
if inherited returns exceed the display bound; manual holds are capped at 500 per case.

Rollback must not restore a hold-unaware writer while active holds exist: stop affected writes and
retain evidence, never auto-release/dispose. UAT must verify units, recipe lot provenance, review
roles, return branches and reconciliation. Excludes physical quarantine-bin workflows, supplier
returns/credits, automatic recall contact, certification, offline lot sales and deployment.

Local verification (2026-10-24): `npm run gate` passed typecheck, DB-free contracts and production
build (6 existing skips). Isolated DB suites passed 144 cases: A–D 32, E 28, F 18, G 22, H 16,
actual costing 20, stock ledger 8. H includes concurrent disposal/replay, audit-failure rollback,
RLS/branch revocation, held returns/receipts, online shipping and production lineage. Recheck also
covers immutable inspection edits, inactive-variant disposal, catalog-drift rejection, disabled
wastage rollback and immediate replenishment notices. Compiled
operations/manual browser fixtures passed English/Thai at 1280/390px, including exact due-time
preservation, explicit approval, lost-response retry, return links and trace snapshots.
Browser transport is mocked; real store UAT, production
migration/deployment and external delivery are not covered. Redis was unavailable in the isolated
online-order test; committed stock behavior and database notices were verified independently.

## Release G — materials, replenishment and inspected receiving

Entry: `/admin/operations` → Materials. Apply **10.97** after 10.87/10.88 and 10.91–10.96
before this app: branch PO allocation, weekly reports and tenant cleanup also read G tables.
This is implementation/test readiness, not production rollout or food-safety certification.

1. Select one branch, <=7 inclusive Bangkok dates, explicit DRAFT/READY production batches and
   priority 1–3. Preview the frozen BOM demand, name the plan, assign a published same-branch
   separate-review checklist, person and due time. Drafts enter demand only by explicit selection.
   Change sources by cancel/recreate; later recipe edits never rewrite frozen BOMs.
2. DRAFT → CONFIRMED requires material.review. CREATE/CONFIRM/REFRESH append immutable snapshot
   evidence. REFRESH changes only the current snapshot. Unit drift or inconsistent lot totals are
   UNKNOWN, not zero. Stock allocation is once across active plans, by priority/due/batch ID, and
   is **not a reservation**. Integer base units only. Conservative expiry requires usability through
   the latest ingredient demand across active plans (and the viewed plan's end date); earlier batches
   may therefore show less stock than they could individually consume. No hourly shelf-life model.
3. Create a PO for one ingredient/variant with explicit supplier/cost, link a compatible open PO
   line, or link a same-branch APPROVED request for its exact approved quantity. Existing services
   remain authoritative. PO and branch-request procurement cannot claim the same PO line. G refuses
   lot-tracked branch-request transfers; use the existing supported nonlot send/receive workflow.
4. Create a receiving inspection with frozen accepted/rejected quantities, lot/expiry, note,
   assignee, due time and separate-review checklist. A–D own photos, thresholds, FAIL/corrective work,
   My Work and escalation. Approval alone **does not receive stock**. Correct by cancel/recreate;
   cancellation does not silently void or approve the canonical task.
5. A purchase.receive operator separately confirms posting after approval. The server rechecks plan,
   inspection/run versions, PO received quantity, product unit, stock/lot reconciliation, expiry and
   existing lot date. Accepted stock, lot, valuation, movement, receipt evidence, inspection state,
   audit and idempotency commit or roll back together via purchase.ts. A reviewed FAIL cannot post
   accepted goods. Rejected-only records move no stock; rejection is not a credit note or return.
6. Current usable stock, pending supply and uncovered shortage stay separate. Receipts outside G
   have UNKNOWN allocation, never guessed branch/inspection provenance. Pending/uncovered become
   unknown and replenishment against that uncertain line is blocked. Resolve the underlying PO,
   close the plan and re-plan remaining production where necessary. Actual branch stock still
   participates in readiness. Exact G receipts retain branch/PO item/lot/movement identities.
7. Close with no unfinished linked supply or pending inspection. Cancel additionally refuses
   received goods. Both release membership without undoing stock or completing canonical tasks.
   E rechecks physical availability when posting production.

If a source task is rescheduled outside the plan window (or planning inputs exceed bounds/become
incompatible), detail remains readable with a historical-evidence heading and explanatory warning. Current
readiness is unknown, and confirm/refresh/new supply remain blocked by the service. Existing
inspections/receipts and close/cancel are still available subject to their normal guards. Correct
the schedule or finish outstanding supply, close/cancel and replan; saved figures are not live stock.

Permissions: checklist.view + material.view + product.view for workspace; material.manage for
planning, material.review for confirm/close, checklist.manage for task creation, purchase.view/edit
for PO actions, inventory.requisition.view for request links, purchase.receive for posting. Costs
require report.view. Server tenant/branch scope, SERIALIZABLE transactions, version guards and
actor/key replay apply before mutation; hiding UI buttons is not authorization.

Bounds: at most 100 selected batches per plan, 500 active/selected batches per branch calculation
and 5,000 BOM entries. Each plan supports 500 supply links and 500 inspections (including cancelled
ones); further creation is rejected before making a PO or checklist task so existing evidence stays
readable. Workspace/catalog searches are server-backed and paginated/bounded; history shows the latest
100 decisions with an explicit truncation flag. Split large work into smaller plans and close completed
plans to release active batch membership.

The existing 15-minute cron claims bounded SKIP LOCKED batches. Overdue/cancelled unfulfilled supply
and due plan reviews notify eligible assignee/supervisor through the canonical operations inbox,
deduplicated by plan version. No external push or continuous forecasting. Views refresh on request/
after writes; inbox polls. F weekly snapshots include bounded plan/receiving evidence (per SKU/unit,
no mixed-unit total), authorized by summary.review + report.view, never PO prices. Actual FAIL actions
can feed F issues; rejecting a quantity does not invent a FAIL.

Not included: auto-ordering/AI writes, forecasts, reservations, lot transfers, supplier returns,
credit notes, quarantine/recall, certification or deployment. Store UAT using actual units, lot
policy and receiving checklists remains required.


Release F dependency: app versions including F also require `10.95`, which links every new waste
record to its canonical movement for weekly cost evidence. Old NULL references stay unknown;
no historical stock or value is rewritten. See [Release F](operation-improvement.md).

Entry: `/admin/operations` → Preparation & production. Migration `10.94`, after operations
`10.91`–`10.93` and existing recipe/lot/valuation schema. Implementation is not production approval.
No AI tool, external messaging or new realtime trigger is added.

## Operator workflow

1. Configure a recipe version and a **separate DIRECT-stock output SKU/variant** with the same
   base unit. Selling recipes use the prepared SKU as a direct ingredient, NOT a virtual subrecipe.
   Existing recipes are never converted automatically. Inputs must be DIRECT, non-serialized and
   non-bundle variants; existing subrecipes are already compiled into leaf inputs.
2. Publish a preparation checklist at the branch/station. Select branch, recipe version, output SKU,
   integer planned quantity, template and due instant. Choose a person OR duty. Duty resolves at the
   planned due instant; missing/ambiguous matches stay unassigned. My work, escalation, photos and
   handover use the linked canonical run. Stock authority is separate from checklist authority.
   Type in each recipe/output selector to search the server independently (100 matches per selector).
   Selecting an item preserves its label even when it is outside the next default result window.
3. Review unreserved stock constrained by usable lots; inconsistent lot totals show unknown.
   Plans freeze BOM/SOP but reserve nothing. Cancel/recreate to change a plan.
4. Mark DRAFT → READY. Enter actual inputs (same ingredient set), positive output, produced date,
   shop-provided expiry date and variance explanation, then explicitly confirm posting.
5. POST consumes usable source lots FEFO, writes PRODUCTION_OUT, receives one unique output lot,
   and writes PRODUCTION_IN. Stock, lots, provenance, value, batch state, notices, idempotency result
   and audit commit together. Posting never approves/closes the checklist; checklist review or
   handover receipt never posts stock. Explicit handover transfer changes the canonical assignee.
6. Dispose the batch's remaining output lot with a reason and optional corrective-action ID from
   its checklist. This composes the existing wastage writer and does not close the action. Do not
   dispose yield variance again: consumed material value is already carried into actual output.

## State, authority and cost

- `DRAFT → READY → POSTED`; DRAFT/READY may become CANCELLED with reason. Posted inputs/output
  remain immutable. Cancelling a plan does not void its checklist; void that work separately if needed.
  Use existing authorized stock-count adjustments for physical
  discrepancies, citing the batch ID; this does not rewrite production history. Zero-yield total
  failure is outside this positive-output flow: cancel the unposted plan and record actual raw
  material disposal through the existing authorized wastage workflow.
- `operations.production.manage` plans/readies/cancels; create also needs checklist.manage.
  `operations.production.post` posts/disposes; disposal additionally requires stock.adjust.
  All require checklist.view. Catalog reads/UI require product.view; costs are redacted without
  report.view. Posting is by current linked assignee or production manager. Branch/permission checks
  precede replay. A roster grants no additional permission. Stable command keys survive lost responses.
  A denied retry releases the retry dialog but does not prove the original request failed:
  an authorized manager must inspect history before creating another command.
- Integer base units only. Fractional expansion, overflow, changed ingredient sets/units, foreign
  recipe/template/branch and output self-reference reject. Posting locks catalog and sorted stock,
  checks reservations and lot reconciliation, then moves all evidence in one transaction.
  Disposal also revalidates the pinned output unit and DIRECT-stock policy; catalog changes must
  not reinterpret the original lot. Unsupported valuation currency is a business rejection.
  Batch detail reads status, inputs, costs, lots and history from one serializable snapshot.
- Material value comes from existing branch moving weighted averages, never client/catalog amounts.
  Output value sums persisted input movement values in the transaction. Unknown input value means
  unknown output value, not zero. Batch unit cost uses actual yield. Subsequent stock mixes normally;
  sale/disposal valuation is weighted stock value, not purchase-lot valuation. Labor/energy/shared
  expenses are excluded. Production movements are conversion, not a second expense/COGS posting.
- Expiry precision is **day**, against Bangkok date. No hourly expiry, guessed shelf life, safety
  certification, work-in-progress accounting or co-products. Historical produced dates do not
  backdate stock/cost ledgers. Source stock without lots has explicitly absent lineage.
- Output is lot tracked from its first batch. Untracked positive opening output stock and mismatched
  lot totals require reconciliation. No new order/payment/return/reservation engine is introduced.
  Source lot allocations and immutable snapshots provide batch lineage, not a new full recall system
  across arbitrary subsequent transfers/repackaging.

## Notices and bounded reads

The existing 15-minute cron scans at most 100 tenants × 100 batches, oldest followup first,
SKIP LOCKED. Nonempty output lots expiring by tomorrow (including expired) notify current assignee
and eligible configured supervisor once per recipient/batch/expiry. Yield variance notifies the
supervisor at posting. Admin bell → checklist → batch links; no email/LINE/push.
Server search/page: 25 batches with optional inclusive Bangkok due-date filter (max 93 days),
100 catalog options with truncation, 200 history entries with
truncation. Availability is an observation, not a promise. No demand forecasting/automatic purchasing.

## Verification and rollout

Run `operation-production` pure/DB, existing actual-cost/A–D regression, production browser smoke
and web gate. DB suite targets restored disposable `127.0.0.1:5433/bms_realtime_test` only, with
existing inventory realtime triggers. Browser fixtures use real components/SDL and mocked auth/data;
they do not replace real-account end-to-end acceptance.

Verified locally on 2026-10-24 (no commit, deployment or production migration):

- Web `npm run gate`: exit 0; typecheck, 3,078 pure tests passed / 6 skipped,
  and production build. Existing Node deprecation/Browserslist warnings remain.
- Release E disposable-DB contracts: 22/22 passed, including migration reapplication,
  RLS/grants, revoked scope on replay, duplicate/concurrent commands, stock contention,
  expiry, cost conservation/unknown values, stock-ledger reconciliation, source-lot lineage,
  exact-lot waste, audit failure and a later-ingredient failure rolling back all earlier work.
  Real POS sale/return and a menu consuming prepared stock exercise existing movement/value
  services and inventory realtime triggers. GraphQL resolvers use actual services in DB tests.
- Existing restaurant actual-cost DB regression: 20/20 passed. A–D checklist/team DB
  regression on the separate operations fixture: 32/32 passed.
- Release E browser fixture: English/Thai at 1280px and 390px passed against the production
  build, including create/preview/confirm, post, lost-response retry with the same key,
  waste, permission denial, date-filter controls, translations and the in-app manual.
  A–D browser fixtures also passed all four language/width combinations during this work.
  Browser transport/auth are mocked; this is not a live-account end-to-end test.
- The existing restored test database initially lacked some baseline grants/migrations.
  Existing migration grants (8.4/9.70/10.12) and missing 10.87/10.88 were restored there
  before regression testing, followed by operations migrations 10.91–10.94. No fresh
  production dump was taken and no live database was changed.

Apply migrations before app/cron. Pilot a small recipe set at one branch: receive, produce, sell
a menu consuming prepared stock, return, dispose, reconcile totals/value, verify real roles and cron.
Rollback disables production commands and pauses cron before app rollback; retain history and new
movement kinds. No production migration/deploy or destructive down migration is part of implementation.

### Detailed recheck — 2026-10-24

Fixed after the initial implementation review:

- A terminal GraphQL rejection after an uncertain response left the shared retry modal open with
  no pending command. It now closes that retry-only state, refreshes authorized evidence and warns
  that the first attempt may already have committed. The browser regression commits the first
  waste command, drops its response, denies the retry, and proves stock moves only once.
- Recipe/output dropdowns previously searched only their loaded 100 options and shared the batch
  search. They now have independent server searches, visible result limits and preserved selection
  labels. DB coverage reaches an output beyond the first hundred; browser fixtures return catalog
  items only after their respective server search.
- A real concurrent post between detail queries produced a READY header with POSTED inputs/costs.
  The reproducing test failed before the fix; one serializable read snapshot now keeps these aligned.
- Changing an output's base unit through the stock-policy service after posting still allowed waste
  under the old batch quantities. The reproducing test failed before the fix; disposal now locks and
  checks the pinned unit and DIRECT policy before changing stock/value/evidence.
- Unsupported valuation currency now returns a business status instead of a GraphQL/internal error.
  Malformed template UUIDs and calendar year zero reject before PostgreSQL writes.

Recheck verification: web gate exit 0 (typecheck, 3,070 pure tests passed / 6 skipped, production
build); production DB **27/27**, existing actual-cost DB **20/20**, checklist/team DB **32/32**, and
stock-ledger DB **8/8** passed. Release E browser checks passed English/Thai at 1280px and 390px,
including the new server-search and committed-but-denied-retry cases. Checklist/team browser
regression also passed all four English/Thai and desktop/mobile combinations. The same isolated test
databases and mocked browser transport limits above apply. No additional migration is needed for
these fixes; no production DB, commit, push or deployment was performed.
