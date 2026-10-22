# Branch Requisitions — implementation plan

Status: core workflow plus operations follow-up implemented on `codex/branch-requisition-plan`
(2026-10-23); not deployed or piloted with a real shop.
The original design below is retained as the roadmap. This implementation record takes precedence
where the original proposal describes a broader feature.

## Implementation record — first usable slice

- Admin route `/admin/branch-requisitions`: server-filtered requests, draft editor, submission,
  full/partial approval or rejection, consolidated outstanding demand, stock availability,
  transfer-draft creation, PO creation/linking, close/cancel and actor-attributed timeline.
- Migration `10.87__bms_branch_requisitions.sql`: five tenant-owned tables, fail-closed RLS,
  tenant-safe document links, permission seeds and grants. No inventory/realtime trigger is added.
- GraphQL uses one typed command with action/result enums. All non-draft commands require
  `confirmed: true`, optimistic version and a stable idempotency key. RBAC and assigned branches
  are checked server-side. The UI shows quantities, source/destination and supplier before confirm.
- Drafts and approvals do not move/reserve stock. Transfer creation plus allocation is one
  transaction, using `createStockTransferInTx()`. Sending/receiving uses existing Stock Transfers.
  Only good received units fulfil demand; damaged/missing units remain outstanding for replacement.
- PO creation plus allocation uses `createPurchaseOrderInTx()` in one transaction. Supplier/cost
  are explicit, with purchase.view + purchase.edit. Existing-PO allocations lock the PO and cannot
  exceed ordered quantity or approved demand. PO receipts NEVER count as destination receipts:
  the existing PO stores cumulative received quantity without per-request destination evidence.
- Active draft/in-transit transfers block close/cancel. Open/partial POs block close; any
  non-cancelled PO, received transfer or PO line with receipts (even subsequently cancelled)
  blocks cancellation. Closing unmet demand requires a reason. A partially received cancelled
  PO keeps its linked allocation for the purchasing cap: cumulative PO receipts cannot identify
  which request received those units, so the service must not silently release that evidence.
- Existing transfers cannot move lot/serial identity correctly through this workflow: creation
  refuses serial/bundle/recipe/lot-controlled or non-canonical-size items instead of corrupting
  their stock evidence. This is not a central-kitchen production/BOM execution module.
- The menu is RBAC-controlled, not hidden by branch count. Users with fewer than two accessible
  active branches see an explanation. Shared navigation currently has no branch-count context.
- Refresh is explicit and after commands; operational all-time metrics are server-aggregated and
  branch-scoped. Persistent personal notices refresh every minute on this page. Delivery is
  post-commit best effort (like existing order notices), not a guaranteed notification outbox.
  No new named realtime event, scheduled SLA escalation or external messaging channel is added.
  Urgency is a visible flag with required reason. Consolidation does not automatically
  choose a supplier, reserve stock, subtract planned POs, or issue a combined multi-request PO.
- Linked transfer/PO references now load and expand the exact document, using existing read
  services and permissions. Consolidation expands into paginated exact-SKU/size branch requests,
  then opens the normal decision drawer. One request per transfer/PO action; no mobile/AI write tool.

### Scope reconciliation — 2026-10-23

| Agreed operational capability | Implementation |
| --- | --- |
| Draft, submit, review, reject, close/cancel, transfer/PO linkage | Existing workflow retained; submit confirmation now includes the requested quantities |
| Review queue, priority and need-by filters | Dedicated queue and server-side inclusive date filters; invalid dates reject before SQL casts |
| Review exact quantities and explain reductions | Requested quantity, bounded approved input and per-line reason; existing server validation remains authoritative |
| Consolidation by product and requesting branch | Exact SKU/size drilldown with server pagination, not substring filtering of the current page |
| Progress and actor history | Decision events plus derived transfer sent/received/discrepancy events; latest decision actor on list |
| Operational metrics | Submitted/requested totals, pending review, approval/partial rates, fill rate, unallocated units, overdue requests, discrepancies and median review/delivery hours |
| Notifications | Submitted → eligible reviewers; decision → requester; sent/receipt/discrepancy → requester + reviewers. Tenant, branch and current permissions apply; self-notices excluded |
| Existing stock/PO behavior | Existing services remain authoritative; receipt evidence, stock movement and idempotency tests retained |

Metric definitions: all-time accessible-branch data independent of list filters. Approval/partial
rates use reviewed requests. Fill rate uses good received / approved units for APPROVED and CLOSED
requests (closed shortfalls remain in its denominator, CANCELLED requests do not). Unallocated units
use APPROVED requests only; overdue includes SUBMITTED and incompletely received APPROVED requests
before today's Bangkok date. Delivery time is measured only when every approved line is received
in good condition; a manual close does not fabricate completion. An unavailable median is `null`
on the API; missing medians and zero-denominator rates show a dash, never a fabricated zero. Discrepancies remain historical evidence
even after replacement delivery.

Remaining rollout choices, not silently implemented: branch-count-aware sidebar hiding, a tenant
pilot switch, guaranteed/retried notification delivery, automatic receipt allocation for direct-to-
branch POs and multi-request batch commands. Native POS, AI mutations, automated procurement and
central-kitchen production/BOM stay explicitly deferred as in section 3.

### Verification and rollout

Recheck (2026-10-22): catalog selections now whitelist GraphQL input fields (no Apollo `__typename`);
the browser smoke validates outgoing commands against `schema.graphql`. Blank/short-after-trim
idempotency keys reject before writes, and normalized retries use the same hash. Transfer creation
rolls back unless each real transfer item is linked exactly once, including legacy SKU normalization
differences. Cancelled PO receipts retain procurement evidence; the UI labels the whole PO-line
received quantity explicitly, never as branch delivery. A failed refresh after confirmed success
shows a read error, not an unknown-write retry. Invalid read IDs return BAD_USER_INPUT. The DB suite
also executes the actual requisition GraphQL SDL/resolvers, not only direct service calls.
PO creation rejects fractional cents and aggregate amounts beyond the persisted NUMERIC(12,2)
limit before creating any document; invalid costs return a typed business rejection.

Use the dedicated restored local database `bms_requisition_test` on port 5433, never the active
shop database. Re-run the new migration to verify idempotency. The DB suite creates/removes only
its own FAKE tenants and tests lifecycle, versions, duplicate retries, branch scope, transfer receipts,
discrepancies, unsupported stock, PO atomicity/caps, permission denial, RLS and audit rollback.
Browser smoke uses intercepted FAKE API data and blocks network writes; it verifies UI only.

Apply `10.87` then `10.88` before enabling the new menu for operators. `10.88` grants only safe
notification-recipient columns on users and adds operational indexes; readiness table checks do
not prove column grants, so run the DB recipient contract too. Pilot with one central stock
location and two branches, review shortages and discrepancies against existing transfer records,
then broaden role permissions. Rollback means reverting the application/menu while retaining
request and audit evidence; do not drop real requests, linked POs or transfers. Future work is
guaranteed notification delivery/SLA escalation, batch allocation UX and branch-aware PO receipt evidence—not another
stock ledger.

## 1. Decision

Add a tenant-scoped **Branch Requisition / คำขอเติมสินค้าระหว่างสาขา** workflow. It fills the gap
between a branch noticing demand and an operator creating a stock transfer or supplier purchase
order.

This is a planning and approval layer, not a second inventory system:

- `stockTransfers.ts` remains the only path that moves company-owned stock between branches;
- `purchase.ts` remains the only path that creates and receives supplier purchase orders;
- requisitions never change `bms_inventory`, lots, reservations, valuation, or movements directly;
- stock shown to the reviewer is evidence at review time, not a reservation or guarantee; and
- creating a transfer or PO always requires an explicit human action and the existing permission.

The first release targets shops with multiple branches, including shops that use one branch as a
warehouse or central kitchen. A single-branch shop does not need this workflow and should not see it
as a primary navigation item.

## 2. Problem being solved

BMS currently supports:

1. supplier PO: `OPEN -> PARTIAL -> RECEIVED` or `CANCELLED`;
2. branch stock transfer: `DRAFT -> IN_TRANSIT -> RECEIVED` or `CANCELLED`;
3. branch-scoped inventory, reservations, lot handling, movements and quarantine; and
4. stock counts, supplier-product mapping and purchasing reports.

It does not yet provide an authoritative record for:

- a branch asking another branch or the central team for goods;
- reviewing several branches' demand in one queue;
- approving a requested quantity in full or in part;
- consolidating demand by SKU/size before deciding whether to transfer or purchase;
- explaining which transfer or PO was created for a request; or
- measuring request fulfilment and lead time.

Without this layer, requests are likely to arrive through chat or phone and the reason for a later
transfer is lost.

## 3. Scope and non-goals

### Phase 1 scope

- Admin web workflow for create, edit draft, submit, review, approve partially or fully, reject and
  cancel.
- Server-backed request list and consolidation view, scoped by tenant and authorised branches.
- Create one or more existing stock-transfer drafts from approved lines.
- Show shortages and allow a separately confirmed existing PO creation flow to link ordered lines
  back to requisition lines.
- Derive fulfilment progress from linked transfer receipts and PO receipts.
- Actor timeline and same-transaction decision audits.
- Thai and English UI keys with exact parity.

### Deferred

- Native POS/mobile request creation.
- Automatic replenishment, automatic approval or automatic supplier ordering.
- Production recipes, batch/yield planning, kitchen manufacturing, wastage and expiry forecasting.
- Vehicle routing and delivery scheduling.
- Requisition-specific reservation of stock.
- AI mutation tools. A future AI integration may propose a draft only and must never move stock.

## 4. Workflow and state model

Keep two separate axes so the requisition cannot disagree with its linked stock documents:

```text
Decision status (stored)
DRAFT -> SUBMITTED -> APPROVED -> CLOSED
              |          |
              +-> REJECTED
DRAFT/SUBMITTED/APPROVED -> CANCELLED (only while no irreversible fulfilment exists)

Fulfilment status (derived from allocations + linked documents)
UNALLOCATED -> ALLOCATED -> IN_TRANSIT -> PARTIAL -> RECEIVED
                                  |             |
                                  +-> EXCEPTION <-+
```

Definitions:

- `DRAFT`: requesting branch can edit lines; no central commitment.
- `SUBMITTED`: immutable to the requester while awaiting review.
- `APPROVED`: every line has a reviewed quantity and decision; zero-approved requests become
  `REJECTED`, not `APPROVED`.
- `CLOSED`: the approved quantity is fulfilled, or an authorised reviewer explicitly closes an
  unfulfilled remainder with a reason. A fully fulfilled request may be presented as complete
  without immediately materialising a header update; the linked documents remain authoritative.
- `REJECTED`: all lines rejected with reviewer reason.
- `CANCELLED`: stopped before irreversible fulfilment. A request with an `IN_TRANSIT`/`RECEIVED`
  transfer or received PO quantity cannot be cancelled.

`UNALLOCATED`, `ALLOCATED`, `IN_TRANSIT`, `PARTIAL`, `RECEIVED` and `EXCEPTION` are query results,
not columns on the requisition header. Transfer/PO state remains authoritative for physical
movement. `EXCEPTION` means a linked cancellation, shortage, damage or missing quantity needs human
resolution; it is not a generic failure state.

## 5. Data model

Use the next free migration number at implementation time (currently expected after `10.86`). Never
rewrite migration `7.98` or another applied file.

### `bms_branch_requisitions`

| Column | Purpose |
| --- | --- |
| `id uuid` | Primary key |
| `tenant_id uuid` | Required tenant owner and RLS scope |
| `request_no text` | Daily tenant number, proposed `REQ-YYMMDD-NNN` |
| `requesting_location_id uuid` | Branch that needs the goods |
| `needed_on date null` | Requested need-by date; not a delivery promise |
| `priority text` | `NORMAL` or `URGENT`; urgent requires a note |
| `status text` | State machine above |
| `note text null` | Request context, bounded length |
| `version integer` | Optimistic concurrency for review/edit commands |
| actor/time columns | `created_by`, `submitted_by/at`, `reviewed_by/at`, `closed_by/at`, `created_at`, `updated_at` |
| decision columns | `review_note`, `close_reason` where applicable |

Constraints: tenant-scoped unique `(tenant_id, request_no)`, valid status/priority, location tenant
ownership enforced in the service transaction, and timestamps consistent with status.

### `bms_branch_requisition_items`

| Column | Purpose |
| --- | --- |
| `id bigint` | Stable line identity |
| `tenant_id`, `requisition_id` | Tenant-safe parent relationship |
| `product_sku`, `size` | Shop-owned variant identity |
| `requested_qty integer` | Positive base-unit quantity requested |
| `approved_qty integer null` | Reviewer decision, `0..requested_qty` |
| `line_note`, `review_note` | Bounded branch/reviewer explanations |
| snapshot columns | Product display name and optional pack context for historical readability |

Use a unique line per `(tenant_id, requisition_id, product_sku, size)`. Pack input must be converted
through the existing product-pack authority before storage; the stored request quantity is a base
unit quantity.

### `bms_branch_requisition_transfer_allocations`

Links an approved requisition line to an existing `bms_stock_transfer_items` row and stores the
allocated quantity. It does not store a second transfer status or received quantity. Progress is
derived from the linked transfer item.

### `bms_branch_requisition_purchase_allocations`

Links a requisition line to an existing `bms_purchase_order_items` row and records how much of that
PO line was intended to cover the request. A PO receipt replenishes a selected branch; it does not
complete the branch request until goods reach the requesting branch through the correct existing
flow. If the PO is received directly at the requesting branch, the link may count that receipt
toward completion; otherwise a transfer is still required.

### Database requirements

- All four tables carry `tenant_id`, RLS policies and `bms_app` grants.
- Composite foreign keys include tenant identity where the referenced table supports it; otherwise
  the service validates tenant ownership under `beginTenantTx()` before insertion.
- Header and line history is append-preserving through decision/timeline rows or existing revision
  conventions; do not make audit log the only user-visible timeline.
- Add required indexes for tenant/status/date, requesting branch/status, SKU/size consolidation and
  allocation lookups.
- Generate request numbers with `insertWithDailyDocNo()` using the database clock.

## 6. Permissions and branch scope

Add permissions to the one `BMS_PERMISSIONS` catalog:

- `inventory.requisition.view`: view requests for branches the user may access;
- `inventory.requisition.create`: create/edit/submit/cancel own-branch drafts;
- `inventory.requisition.review`: approve, partially approve, reject and close remainders.

Creating a transfer additionally requires existing `inventory.transfer`. Creating a PO additionally
requires existing `purchase.edit`. Viewing linked PO details still requires `purchase.view`.

Proposed default seeds:

- Warehouse: view + create;
- Manager: view + create + review;
- Administrator: receives all permissions through the existing super-role behavior.

Permission alone does not grant all-branch access. Reads and mutations must also apply the existing
branch-access resolver. The requesting branch and tenant come from authenticated server context or
an authorised branch selection, never from an unverified client tenant id.

## 7. Service boundary

Create `apps/web/lib/bms/branchRequisitions.ts`. It owns SQL and state transitions. REST/GraphQL/UI
adapters remain thin.

Proposed service API:

```ts
listBranchRequisitions(scope, filters, pagination)
getBranchRequisition(scope, id)
getBranchRequisitionConsolidation(scope, filters)
createBranchRequisition(input)
updateBranchRequisitionDraft(input)
submitBranchRequisition(input)
reviewBranchRequisition(input)
cancelBranchRequisition(input)
createTransfersForRequisition(input)
linkPurchaseOrderToRequisition(input)
closeBranchRequisitionRemainder(input)
```

Rules:

- Every write starts `beginTenantTx(client, tenantId, {editorId})`.
- Lock the header row before checking status/version and changing decisions.
- Validate every location, SKU/size and linked transfer/PO inside the same tenant transaction.
- Require stable idempotency keys for create, submit, review, transfer creation, PO linking and close.
- Exact retries return the stored result; changed bodies under the same key return conflict.
- Audit the decision in the same transaction. Do not audit each consolidation read or each line loop.
- `createTransfersForRequisition()` calls/reuses transfer-domain primitives; it must not reproduce
  transfer stock rules. If the current public service cannot participate safely in the same
  transaction, first extract an in-transaction primitive rather than nesting transactions.
- PO creation remains an explicit separately confirmed operation. The shortage calculation may
  prepare arguments but cannot create a PO as a read side effect.

## 8. Quantity and consolidation rules

For each approved line, show these facts separately:

- requested quantity;
- approved quantity;
- allocated to transfer drafts;
- sent and received quantities derived from linked transfers;
- damaged/missing quantity derived from transfer receipt evidence;
- linked incoming PO quantity and actually received PO quantity; and
- remaining unallocated approved quantity.

The consolidation screen groups only exact `product_sku + size` identities. It must not guess a
replacement SKU, convert an unknown pack or combine recipe ingredients.

Suggested availability is evidence only:

```text
transferable = current_stock - reserved_stock
```

computed per potential source branch using the existing inventory authority. In-transit and
quarantined stock stay separate and are never included as transferable. Because stock can change
after review, transfer creation re-checks live unreserved stock and may return a business rejection.

## 9. GraphQL and transport

Prefer typed GraphQL for the new admin surface so future mobile support can reuse the contract.
Add a dedicated resolver module that performs:

```text
requirePermission -> resolve tenant/branch scope -> validate input -> service call -> format result
```

Business refusals such as stale version, invalid state or insufficient transferable stock return a
typed status in `data`, not a GraphQL transport error. Authentication and permission failures remain
401/403 behavior through existing helpers.

After typeDefs change:

- regenerate committed `schema.graphql` with `npm run schema:export`;
- add operations/hooks using the repository's established admin GraphQL client pattern; and
- keep all authoritative rules in the service, not the resolver or component.

Do not add a REST mutation unless an existing browser boundary requires it. If one is added, guard
it with `authorizeAdminRoute()` and mirror the exact GraphQL permission.

## 10. Admin UX

Add `/admin/branch-requisitions` under the Inventory section. Navigation visibility requires
`inventory.requisition.view` and should be de-emphasised or hidden for a tenant with only one active
branch.

### Main page

- Server-backed filters: status, requesting branch, need-by window, priority and SKU/search text.
- Tabs/views: `คำขอของสาขา`, `รอตรวจ`, and `รวมความต้องการ` when the user has review permission.
- Table/cards show request number, branch, need-by date, line/unit totals, progress and latest actor.
- Mobile layout must remain usable without relying on a wide table.

### Request editor

- Branch selector limited to authorised branches; default to the user's active branch where known.
- Product search resolves exact SKU/size and shows live branch stock as context.
- Quantity, need-by date, priority and note; urgent requires a reason.
- Draft save and Submit are distinct. Submit confirmation shows immutable summary.

### Review drawer/page

- Requested and approved quantity per line.
- Live transferable stock by candidate source branch, reservations shown separately.
- Approve all, partial approval and reject with required reason where quantity is reduced.
- Optimistic-version conflict reloads current data rather than overwriting another review.

### Consolidation view

- Group approved/unallocated demand by SKU/size, then show requesting branches beneath it.
- Reviewer chooses source branch and allocation quantity.
- `สร้างใบโอนฉบับร่าง` opens a confirmation that names source, destinations and quantities.
- Shortage view offers `เตรียมรายการสร้าง PO`; the final PO confirmation remains the existing
  purchase permission-gated action.

### Progress/detail

- Timeline: created, submitted, reviewed, transfer drafted/sent/received, discrepancy and closed.
- Deep links to linked transfers and POs only when the viewer has their respective permissions.
- Never label an approved quantity as reserved or guaranteed.

## 11. Audit actions

Write one decision audit per command in the same transaction:

- `inventory.requisition.create`
- `inventory.requisition.update`
- `inventory.requisition.submit`
- `inventory.requisition.review`
- `inventory.requisition.cancel`
- `inventory.requisition.transfer_create`
- `inventory.requisition.purchase_link`
- `inventory.requisition.close_remainder`

Metadata contains ids, request number, branch ids, line/unit summaries, before/after status and
reasons. Do not store unnecessary free text, supplier secrets or client-supplied tenant identity.
The normal transfer/PO audit still records its own authoritative action.

## 12. Notifications and realtime

Phase 1 may use the existing persistent admin notification mechanism after commit:

- submitted request -> users eligible to review that branch;
- approved/rejected -> requester;
- transfer sent/received or discrepancy -> linked request participants.

Do not publish a new realtime event merely to refresh one page unless polling/refetch is inadequate.
If a named realtime event is later required, add it only through `packages/realtime`, write the
outbox row in the business transaction and update audience/permission contracts. `apps/ws` must not
query PostgreSQL.

## 13. Reporting

Phase 1 operational metrics:

- submitted request count and requested units;
- approval rate and partial-approval rate;
- median submit-to-review and review-to-complete time;
- fill rate: fulfilled approved units / approved units;
- unallocated approved units and overdue need-by requests;
- transfer discrepancy units linked to requests.

Keep requested, approved, ordered, sent and received quantities distinct. A linked PO is not proof
that the branch received its request. Reports use server-side aggregation and `report.view` if placed
outside the operational page.

## 14. Implementation sequence

### Slice A — contract and database

1. Confirm the migration number is still free.
2. Add tables, constraints, RLS, grants, indexes, default role seeds and rollback comments.
3. Add permission catalog entries and bilingual permission-group labels.
4. Add state/quantity pure helpers and contract tests.
5. Prove migration idempotency, tenant isolation and grants on the DB test environment.

### Slice B — request lifecycle

1. Implement the service list/get/create/update/submit/review/cancel functions.
2. Add same-transaction audit and idempotency receipts.
3. Add GraphQL types, typed result statuses and resolvers.
4. Export `schema.graphql`.
5. Build the admin request list, editor and review UI with Thai/English parity.

### Slice C — fulfilment integration

1. Add consolidation query and live source-branch availability evidence.
2. Extract reusable in-transaction transfer creation primitive if required.
3. Create and link transfer drafts atomically with allocation rows.
4. Add separately confirmed PO creation/linking path.
5. Derive fulfilment status from linked documents and add the explicit close-remainder decision.

### Slice D — operations and rollout

1. Add timeline, deep links, notifications and operational metrics.
2. Update `docs/business/inventory.md`, `docs/architecture/database.md` and the in-app manual.
3. Add schema readiness checks and deployment ordering notes.
4. Browser-test desktop and mobile widths with Manager, Warehouse and denied roles.
5. Pilot behind an explicit tenant capability/feature flag if the first customer workflow is still
   being validated; do not tie it to a business archetype as permanent behavior.

## 15. Test plan

### Pure/contract

- Allowed and forbidden state transitions.
- Partial approval math and zero-approved rejection.
- Consolidation groups only exact SKU/size.
- Transferable stock excludes reserved, in-transit and quarantine.
- GraphQL permission mapping and typed business statuses.
- i18n exact parity, navigation contract and schema artifact parity.

### Database

- RLS tenant isolation and cross-tenant link rejection.
- Branch-scope denial despite holding the permission.
- Concurrent review/version conflict.
- Exact idempotent replay and changed-body conflict.
- Audit rollback rolls back the business decision.
- Two concurrent request-number allocations remain unique.
- Transfer creation plus allocation is atomic.
- Insufficient live stock creates neither allocation nor transfer.
- Partial/damaged/missing receipt derives the correct request progress.
- PO received at central branch does not falsely complete a destination-branch request.

### API/UI

- unauthenticated, missing permission and wrong-branch denial;
- validation errors, draft edit, submit, partial approval, reject and cancel;
- server-backed pagination/filtering;
- confirmation contents for transfer and PO creation;
- desktop/mobile layout and raw i18n-key absence;
- deep links hidden when linked-document permission is absent.

### Commands

Run the narrow contract and DB suites first, then:

```bash
cd apps/web
npm run typecheck
npm run test:pure
npm run build
```

Run `npm run test:db` only against the documented local throwaway database, never production. Finish
with `npm run gate` when the full slice is ready.

## 16. Acceptance criteria

The first release is complete when:

1. an authorised branch user can submit a traceable request without moving stock;
2. an authorised reviewer can approve exact quantities across authorised branches;
3. a confirmed action creates ordinary BMS transfer drafts without duplicating stock logic;
4. shortage evidence can lead to an explicitly confirmed ordinary PO;
5. request progress is derived from linked authoritative documents;
6. tenant, branch, permission, idempotency and audit guarantees are covered by tests; and
7. single-branch shops and all existing PO/transfer workflows continue unchanged.

## 17. Decisions to confirm before Slice A

- Whether phase 1 needs a tenant feature flag or can ship generally but remain hidden for one branch.
- Whether a PO received directly at the requesting branch should automatically count as fulfilment
  or require an explicit allocation confirmation.
- Whether Warehouse may submit only its paired/default branch or any assigned branch on the admin
  web surface.
- Whether urgent requests require reviewer SLA reporting in phase 1 or only a visible priority.
