# Inventory & Purchase

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_inventory`, `bms_stock_movements`, `bms_purchase_orders` ([../architecture/database.md](../architecture/database.md))

Inventory is the source of truth. Never update stock directly — always go through the Inventory
Service (`lib/bms/stock.ts`, `lib/bms/movements.ts`).

```
Current Stock = Available Stock + Reserved Stock
Available Stock = Current Stock − Reserved Stock
```

For lot-tracked variants, sellable availability additionally excludes active quality holds and
expired lots; a mismatch between lot totals and physical stock blocks new reservations until
reconciled. `reserveStock()` preserves `NOT_FOUND` for a missing branch inventory row and
`INSUFFICIENT` for an existing empty/unavailable row. Successful `availableAfter` reports the
remaining usable quantity, excluding held/expired lots. Physical stock and the reservation ledger
remain unchanged by this reporting distinction.

POS scan, variant selection, direct-stock restaurant menus and the device-branch stock overview
use the same usable quantity, including Desktop and native GraphQL callers. RECIPE/NON_STOCK
items retain their virtual-stock behavior. Generic transfer send/receive and count apply return
`LOT_QUALITY_HOLD` with a review reason as a normal business result (not a server/unknown-result
error); the entire transaction rolls back, including earlier lines. Rejected actions do not consume
the inventory idempotency key. Unexpected database errors still propagate.

Creating a hold or approving its release also enqueues the existing branch-scoped
`inventory.changed` invalidation in the same transaction: physical inventory is unchanged, so its
ordinary triggers cannot announce this availability change. No inspection details enter the event.
Existing realtime delivery flags, dispatcher and polling/reconciliation requirements still apply.

Restock subscriptions use that same usable quantity for subscription checks, ready-to-notify
eligibility, staff lists and the final pre-send check. Held-only, expired or unreconciled stock
must not generate a customer "back in stock" claim. Receipt/return hooks may mark ready only
when usable stock exists; sending rechecks current stock even if the notice was ready earlier.

Every stock change **must** generate a Stock Movement record. Never update inventory without
logging movement.

## Movement types (`bms_stock_movements.type`)

### Branch requisitions (`10.87`)

`/admin/branch-requisitions` adds a planning layer before the existing transfer/purchase workflows:
draft → submitted → approved/rejected → closed/cancelled. It never changes stock itself.
`inventory.requisition.view/create/review` controls access; assigned branches are enforced in the
service. Transfers additionally require `inventory.transfer`; PO work requires `purchase.view/edit`.
Non-draft decisions require explicit confirmation, version and stable idempotency key.

Approved quantities may be fulfilled by several transfers. Draft/in-transit quantities consume the
allocation; cancelled drafts release it. Good received units fulfil demand, damaged/missing units do
not. Linked PO quantities are procurement evidence only, never proof of delivery to the branch.
Creating a linked transfer or PO and recording its allocation share one transaction and audit.
Lot/serial/bundle/recipe items unsupported by the existing transfer engine are refused at this boundary.
The operations follow-up (`10.88`) adds a review queue, server-side priority/date filters,
paginated branch drilldown, exact linked-document navigation and derived send/receive/discrepancy
history. The operational summary computes rates/lead times from authoritative events and receipts;
closed shortfalls are not delivered units. Best-effort post-commit notices target current eligible
reviewers/requesters, never all tenant users, and are listed on the request page (60-second refresh).
Manual refresh displays current progress. Full scope, limitations and rollout:
[Branch requisition implementation record](branch-requisitions-plan.md#implementation-record--first-usable-slice).

### Stock movement ledger

| Type | Meaning |
| --- | --- |
| `STOCK_IN` | Manual adjustment increase, or receiving a Purchase Order |
| `STOCK_OUT` | Manual adjustment decrease |
| `RESERVE` | Order created (reserve stock) |
| `RELEASE` | Order cancelled or auto-released (return reservation) |
| `SHIP` | Order shipped (permanent deduction: current −= qty, reserved −= qty) |
| `RETURN` | Goods returned (stock re-added) |
| `TRANSFER_OUT` | Goods sent from one branch and now in transit |
| `TRANSFER_IN` | Goods received into the destination branch |
| `TRANSFER_LOST` | Short receipt that is no longer held by any branch and must be followed up |
| `QUARANTINE_IN` | Damaged goods received into a branch-held, non-sellable bucket |
| `COUNT_ADJUST` | Variance accepted from a stock count apply |

`TRANSFER` is no longer a roadmap placeholder: `7.98` split it into `TRANSFER_OUT` and
`TRANSFER_IN` so branch-to-branch movement is not misread as stock leaving or entering the company.
Since `9.35`–`9.36`, damaged receipt and missing receipt are also explicit: damaged pieces increase
`quarantine_stock` at the destination and use `QUARANTINE_IN`; missing pieces use `TRANSFER_LOST`
so the loss is visible in product stock totals and transfer history without being counted as
sellable or company-held stock. Generic manual adjustments still record as plain
`STOCK_IN`/`STOCK_OUT`; `DAMAGED` remains a future reporting-specific type rather than a live schema
value today.

## Multi-branch visibility and policy

### Basic branch parking (`10.52`)

In **Locations → Add/Edit branch → Parking**, choose Not specified, Parking provided, or No
shop-provided parking. Optionally enter total car/motorcycle spaces, entrance, fees/validation,
hours/restrictions, nearby alternatives, and an HTTPS map link. Enable publication only after
reviewing the details. These are basic branch facts shared by restaurant, board-game and all other
shop types; AI reads them from `get_store_info`, never interprets capacity as free spaces right now,
and asks which branch when ambiguous. Empty/hidden information does not mean no parking. Apply
`10.52__bms_location_parking.sql` before saving. Editing requires `location.manage` and branch access.

Branch identity is operational data, not only display text. A shop with more than one active
location must be able to answer four separate questions without opening the database:

- where the stock is now (`bms_inventory.location_id`);
- where an order was sold/reserved from (`bms_orders.location_id`, plus POS device/shift when it is
  a counter sale);
- whether a promotion is allowed at the selling branch (`bms_coupon_locations`, added in `9.37`), and
  which offer that branch actually runs (`bms_product_promotions.location_id`, added in `9.61` — a
  branch offer overrides the store-wide one; see
  [../business/pos.md](./pos.md#each-branch-runs-its-own-offer-961));
- whether an operator is supposed to work across all branches or only assigned branches
  (`bms_user_allowed_locations`, added in `9.37` as the tenant-scoped policy foundation).

`bms_coupon_locations` is intentionally optional. No rows for a coupon means "all active branches",
which preserves existing behaviour for single-branch shops and legacy coupons. Adding one or more
rows turns the coupon into a branch-specific promotion. POS coupon preview and `createOrder()` both
check the order/device branch before applying the discount, so a branch-only coupon cannot be shown
as usable at POS and then fail later at settlement.

`bms_user_allowed_locations` is also optional for now. No rows for a user means existing tenant-wide
RBAC still applies; once branch-restricted staff management is wired, rows in this table become the
allow-list that list pages and mutations must respect in addition to the normal permission check.
This avoids silently changing existing teams while giving the Phase 4 access-control work a single
source of truth.

## Who is holding reserved stock

`bms_inventory.reserved_stock` is a running total. Nothing in the schema records which bill owns
which reserved unit, so the number alone cannot answer the question staff actually ask at the
counter: a customer wants the last piece, who is holding it, and can we sell it?

The reserved figure on `/admin/products` is therefore clickable. `listVariantReservations()`
(`lib/bms/stock.ts`, exposed as the `bmsVariantReservations` query) rebuilds the answer from the
bills that still hold stock — `PENDING`, `PAID`, and `PACKING`, since a reservation is released only
when the order ships (`SHIP`), is cancelled, or auto-releases. Each row names the bill, its
quantity, channel, customer, branch, and whether an open deposit (`9.0`) is the reason the goods are
held.

Two details are structural rather than cosmetic:

- **It reads the `bms_order_stock_lines` view, not `bms_order_items`.** A bundle reserves its
  components (`8.8`), so a bill that bought a gift set holds stock of a product that does not appear
  on its own lines. Reading the raw table would leave those units looking unowned; the row instead
  carries the parent sets' SKUs — plural, because one bill can hold the same component through two
  different sets, and naming only the first tells staff to look for half of what they are holding.
- **Both directions of disagreement are shown, never rounded away.** A reservation can be stranded by
  a bill that failed midway, by a hold taken through `/api/bms/reserve`, or by a hand-edit — that is
  stock locked with nobody to chase. The opposite happens too and is worse: bills holding **more**
  than the table has reserved, which means reserved goods still read as available and those bills
  will fail or oversell at fulfilment. The dev database shows exactly this for `NIKE-AIR` — one unit
  reserved against twelve claimed by ten bills, nine of them left behind by AI-eval runs that created
  orders without reserving. Both figures are reported with their own warning; neither is clamped away
  silently. The modal reports
  `reservedTotal`, what the bills account for, and the difference — because presenting only the
  explainable part tells the reader the list is complete when stock is still locked with no owner to
  chase. The list itself is capped at 200 bills, but the totals count every bill and the screen says
  when it truncated.

The query needs `order.view`, not `product.view`: the answer contains bill ids, customer names, and
phone numbers, so someone who only maintains the catalogue does not read the customer list through
the products page. Verified by `scripts/variant-reservations-db-contract.test.mts` (12 tests).

Two failure modes are deliberately visible rather than smoothed over. A failed query shows the error
instead of an empty table, because "no bill is holding this" and "we could not find out" are
different answers and only one of them lets a cashier sell the last piece. And the modal renders a
result only when it belongs to the size that was clicked, so the answer for M can never appear under
the heading for S. The query reads the `bms_order_stock_lines` view (`8.8`, repaired in `9.3`),
`bms_locations` (`7.84`), and `bms_pos_deposits` (`9.0`); like every other feature here it assumes
its migrations are applied, and on a database missing them the drill-down surfaces the SQLSTATE
rather than pretending nothing is reserved.

## Holding stock without a bill (`/api/bms/reserve`)

`createOrder()` is the ordinary way stock gets reserved, inside the same transaction as the bill.
`POST /api/bms/reserve` is the exception — a hold with no order behind it — and it was the most
dangerous endpoint in the app until this was fixed:

- **It had no tenant at all.** `reserveStock()` filtered on `product_sku` and `size` only, so the
  `UPDATE` matched that product in every shop and every branch that stocked it. Two shops listing the
  same mainstream product is not a corner case, and the dev database already had `NIKE-AIR/XL` in two
  tenants. The caller got `200 RESERVED`; the other shop's shelf simply changed. This was the only
  statement in the codebase touching `bms_inventory` without `tenant_id` — the other fifteen were
  already correct, which is exactly why `scripts/inventory-tenant-scope-contract.test.mts` now checks
  all of them.
- **It required no authentication.** `middleware.ts` only guards `/admin/**`; anything under `/api/**`
  that is not an admin page passes straight through. The route now calls
  `authorizeAdminRoute("stock.adjust")`, and **the tenant comes from the signed session or drill-down
  cookie, never from the request body** — accepting it from the body would restore the same hole
  behind a login.
- **It recorded no stock movement,** against this document's own rule that every stock change writes
  one. Goods could stop being sellable with nothing saying who held them or when. It now writes a
  `RESERVE` movement in the same transaction as the reservation, so a hold taken this way is
  traceable in the product's movement history instead of appearing only as an unexplained number.

A branch may be named in the body, because one shop legitimately has several. An id belonging to
another shop simply fails to match a row and returns `NOT_FOUND`, and nothing is written.

## Product rules

- SKU must be unique; barcode should be unique.
- Inactive products cannot be sold.
- Price cannot be negative; stock cannot go negative unless `AllowNegativeStock` is enabled.
- **Implemented product detail** (`bms_products`, migration `5.9`): `image_url` (upload via
  `/api/bms/products/upload`, ≤10MB, images only), `description`, `cost_price` (used to compute
  `price − cost_price` margin in the Products page — not yet rolled into Reports), free-text
  `category`/`brand` with autocomplete from prior values used in the shop.
- **Implemented product gallery** (`bms_product_images`, migration `6.5`): one product can now
  store multiple uploaded images in display order. `image_url` still acts as the primary cover
  image for backward compatibility; the current Products UI sends both `image_url` and
  `image_urls[]`.
- Categories are a managed list (`bms_product_categories`, migration `6.0`) that the shop can edit
  from a dropdown; renaming a category syncs to products referencing the old name in one
  transaction. Deleting a category does not delete products, only removes it from the dropdown.

## Bulk product import (CSV/XLSX)

**Implemented** — `/admin/products` "นำเข้า" button opens `ImportModal.tsx`, which parses the file
entirely client-side (`xlsx`/SheetJS, handles both `.csv` and `.xlsx`) and drives a two-step
preview-then-commit flow over a single GraphQL mutation:

```
Mutation.bmsImportProducts(items: [BmsProductImportRowInput!]!, commit: Boolean = false): BmsProductImportResult!
```

- `commit: false` (preview, the default) validates every row and returns a per-row
  `CREATE` / `UPDATE` / `ERROR` verdict **without writing to the database**.
- `commit: true` re-runs the identical validation, then writes only the non-error rows by looping
  the existing `upsertProduct()` (`lib/bms/products.ts`) once per row — bulk import does not
  duplicate product-write logic, it wraps the same single-item path used by the manual product form.
- Both modes share `validateProductFields()` and `validateProductConfigurationFields()`.
  Preview is advisory: transactional constraints, readiness and concurrent edits are checked again at commit.

**Rules enforced by `lib/bms/productImport.ts` (`runImport()`):**

- **Row limit**: 500 rows per import (`PRODUCT_IMPORT_MAX_ROWS`), enforced both client-side (before
  ever calling the mutation) and again in the resolver (defense in depth against a direct GraphQL
  call). A 5MB file-size gate on the client protects against parsing a huge file before the row
  count can even be checked.
- **Images are never imported or erased by import.** Existing cover/gallery and shipping weight
  are preserved. Unknown headers (including image/stock columns) are rejected with a correction message,
  not silently discarded. Add images afterward from the normal product edit form.
- **Duplicate SKUs within the same file**: first occurrence wins; every later row with the same SKU
  is flagged as an `ERROR` row ("SKU ซ้ำกับแถวที่ N ในไฟล์นี้") rather than silently skipped or
  silently overwritten.
- **CREATE vs UPDATE** is decided with one batched `sku = ANY($2)` lookup against the tenant's
  existing products (not one query per row).
- **Quota is all-or-nothing, not first-N-rows-win.** If `current product count + new-SKU count`
  would exceed the plan's `max_products`, the entire commit is blocked (`quotaExceeded: true` +
  a Thai summary message) rather than silently importing only as many new SKUs as fit. The preview's
  quota check is advisory (point-in-time); commit remains authoritative because it still calls the
  real `upsertProduct()` per row, which still calls `enforceProductQuota()` fresh — a late-arriving
  over-quota row (e.g. a race with another admin) still surfaces as a per-row commit error even if
  the preview looked fine a moment earlier.
- **Permission**: reuses `product.edit` (the same permission that gates the single-item
  `bmsUpsertProduct`) — no separate import permission was added.
- **Revision grouping**: one `revisionId` (UUID) is generated per import call and threaded through
  every `upsertProduct()` call during commit, so an update-heavy import's revision snapshots share
  one `revision_id` and can be queried as a batch. Revision triggers only fire on `UPDATE`, not
  `INSERT` (`db/migrations/7.0__bms_revision_helpers.sql`), so a 100%-new-SKU import produces zero
  revision rows.
- **Audit**: one `audit(ctx, "product.import", ...)` call per commit with row-count summaries in
  `meta`, not one row per imported product — only logged on `commit:true`, never on preview.

Template columns (Thai headers, matched by trimmed/case-insensitive text so a reordered or
hand-edited sheet still parses): `SKU` / `บาร์โค้ด` / `ชื่อสินค้า` / `รายละเอียด` / `ราคาขาย` /
`ต้นทุน` / `หมวดหมู่` / `ยี่ห้อ` / `คีย์เวิร์ด` / `รูปแบบสินค้า` / `Stock Policy` / `หน่วยฐาน` /
`ตัวเลือก` / `ช่องทางขาย`. Lists use `|` (or `,`); variant spelling is preserved.
`SKU`/`ชื่อสินค้า`/`ราคาขาย` are required. Missing, duplicate and unknown headers are rejected
with the exact column names. There is no `เปิดขาย` column: new products always remain Draft.

The download has three sheets: empty **Products** for real data, **Examples** with distinct examples
for all 14 shop archetypes, and **Guide** with field rules and follow-up setup. The 21 examples cover
all five creation presets, seven stock policies and five sales surfaces. Copy suitable example rows
to Products and replace them with real shop data. Products is selected even when tabs are reordered;
if it is missing from a template, Examples/Guide are never used as fallback. Legacy single-sheet
XLSX/XLS and CSV files are still accepted.

Set SKU/barcode cells to **Text before entering** codes to preserve leading zeroes and long codes.
Formatted numeric prices use their underlying value, not the displayed rounded/currency string.
Invalid/blank prices and invalid costs produce row errors through GraphQL (never NaN/null transport
failures). Formulas, dates, Excel error cells and unsafe numeric identifiers are rejected with sheet/cell
coordinates and repair instructions. Error row numbers remain the physical Excel row numbers after blanks.
Sample barcodes use valid in-store codes and must be replaced with the shop's actual codes.

On update, omitted optional columns preserve stored values; blank cells in supplied descriptive/cost/barcode
columns clear them. Supplied sales surfaces replace the enabled set (blank disables all); variants add/reactivate
the listed codes and do not remove existing ones. Stock Policy and base unit initialize new products only;
a conflicting value for an existing SKU is rejected in preview and rechecked under the tenant lock at commit.
Change an existing stock model in Stock models instead. Import does not create opening stock, packs, recipes,
bundle components, lots, serials, or variant-specific prices; configure those through their existing workflows.

Errors remain visible in the modal. Confirmation with row errors explicitly imports only valid rows;
fix failed rows and upload them again. A quota-blocked batch is never shown as successful.

## Purchase Orders (supplier replenishment)

**Implemented** (`bms_purchase_orders.status`):

```
OPEN → PARTIAL → RECEIVED
     ↘ CANCELLED
```

Receiving goods automatically increases inventory (`STOCK_IN` movement) and recalculates PO status
to `PARTIAL` or `RECEIVED` depending on how much of the ordered quantity has arrived. A cancelled PO
cannot receive further — and cancelling never claws back stock already received (standard inventory
accounting: what's received stays received).

Permissions: `purchase.view` / `purchase.edit` / `purchase.receive` / `purchase.cancel`.

Since `9.18`, `bms_supplier_products` maps the supplier's SKU, product name, and barcode to the
shop-owned `product_sku + size`. The shop identity remains authoritative for inventory and POS
receiving. Selecting an existing supplier in the PO form loads these mappings, so staff can search
by either identity and reuse the last unit cost. Entering a supplier SKU for a new pairing creates
or updates the mapping in the same transaction as the PO. A supplier SKU cannot point to two shop
variants for the same supplier.

Each PO line snapshots `supplier_sku` and `supplier_product_name`. Editing a supplier catalog later
therefore does not rewrite an old PO or make a delivery note impossible to reconcile. Catalog-only
fields such as pack quantity, minimum order quantity, and lead time remain advisory; receiving
still validates and moves stock only against the PO's shop SKU and size.

Since `9.6`, an authorised cashier can receive an existing `OPEN`/`PARTIAL` PO from the POS Receive
tab. Scans only build a draft; confirmation is the stock mutation. Unlike the legacy admin workflow
(which defaults to the shop's main location), this path takes the active location from the
authenticated POS device and passes it into the shared purchase service. The inventory row, lot,
`STOCK_IN` movement, PO progress, `purchase.receive` audit row, and retry receipt all use that same
location and transaction. A stable per-device idempotency key prevents a lost response from adding
the same delivery twice.

## Customer restock follow-up

When a customer explicitly opts in after an exact SKU/size is unavailable, the customer AI may
call `subscribe_restock_notification`. The subscription is scoped to the server-established
channel identity and is supported only on channels with real proactive push delivery: LINE,
Facebook, and Instagram. The AI must not infer consent from a product question or purchase intent.

This is more than a convenience reminder. It is a **sales-recovery workflow**:

- a stock-out conversation should not end as a lost sale when the customer still wants the item;
- the shop captures that demand as a queue instead of relying on staff memory;
- once stock returns, staff can follow up from `/admin/restock-subscriptions` and try to convert the
  waiting customer into revenue; and
- the queue also shows which SKU/size combinations repeatedly lose sales because inventory was not
  available, which helps replenishment planning.

Subscriptions move through:

```text
ACTIVE -> READY_TO_NOTIFY -> NOTIFIED -> PURCHASED
   |             |               |
   +-------------+---------------+-> CANCELLED / EXPIRED
```

- Manual positive stock adjustments, PO receipt, returned goods, and released reservations re-check
  availability after the inventory transaction commits. An `ACTIVE` subscription becomes
  `READY_TO_NOTIFY` only while available stock is greater than zero.
- Restocking never sends automatically. Staff review or edit the generated draft at
  `/admin/restock-subscriptions` and confirm the send with `inbox.reply` permission.
- Each send/resend creates a `bms_restock_deliveries` attempt with a body snapshot, actor, timestamp,
  and `SENT`/`FAILED` result. Failed attempts leave the subscription ready for retry.
- The admin page also surfaces funnel/report metrics from this queue itself: total waiting demand,
  ready-to-notify, already-notified, recovered subscriptions, unique recovered customers, linked
  recovered orders, recovered order-item revenue, and conversion rates. Linking each conversion to
  its real order avoids double-counting unrelated items in a mixed basket and makes the queue
  explainable as a measurable sales-recovery workflow.
- The send path checks live availability again. If stock has sold out, it sends nothing and moves
  the subscription back to `ACTIVE`.
- Creating an order first moves the subscription to `ORDERED`; it becomes `PURCHASED` only when a
  staff confirms payment (or marks a manual/cash payment) and the order becomes `PAID`.
  Cancellation, expiry, and return reopen the subscription and clear its order/revenue attribution.
- Recovered revenue is the matching order-item value after allocating the order discount
  proportionally. Metrics require a paid operational order and exclude refunded payments, so refunds
  do not remain revenue while manual/cash-paid orders are still counted.
- Sales staff see only subscriptions for conversations assigned to them or where they are a helper;
  Manager and Administrator roles follow the normal tenant-wide Inbox visibility.

For demos and team explanations, position this feature as:

`out-of-stock -> capture demand -> notify when replenished -> recover the sale`

That makes `restock subscriptions` one of the clearest examples that BMS is not just answering
chat, but turning missed demand into an actionable sales pipeline.

## POS stock and lot handling

POS catalog search is filtered to the device location. At checkout, the backend re-resolves each
SKU/size/pack and reserves stock through `createOrder()`; fulfilment then consumes current and
reserved stock atomically and assigns tracked lots FEFO, skipping expired lots. Mixed base-unit and
pack lines for the same SKU/size remain distinct order lines, while inventory updates aggregate their
base quantities before changing the stock row.

Full and partial returns restore both the inventory total and the exact source-lot allocation.
`bms_pos_return_item_lots` records what has already been restored so repeated partial returns cannot
credit one lot twice. Since `9.34`, a counter return restores stock at the authenticated receiving
register's branch, which may differ from the sale branch. The row keeps the source lot and destination
restock lot separately; bundle returns restore the actual component lines. The stock movement ledger
records `RETURN` at the receiving branch with the original order reference. This is not a
`TRANSFER_IN`: a later decision to send the returned item back to its sale branch uses the ordinary
two-step transfer. See [pos.md](pos.md) for the counter workflow and opening checklist.


## Multiple branches: transfers and counts (7.98)

`7.84` gave every inventory row a `location_id`, but nothing could act on more than the default
branch. `adjustStock()` resolved the default location and ignored its caller, so a two-branch shop
could not correct the second branch's numbers at all — while its POS registers happily sold from it.
`adjustStock()` accepts a `locationId` and verifies the branch belongs to the shop before touching a
row. The admin Products screen always supplies it; its rows are branch × size, never anonymous
duplicate sizes. Reorder points use the same explicit branch rule. The summary keeps sellable stock,
in-transit units and quarantined units separate so company-owned goods are visible without making
them available to POS. Transfer-loss totals are shown as follow-up evidence, not company-held stock.

### Transfers are two steps

`bms_stock_transfers` moves goods branch to branch as **send** then **receive**. Stock leaves the
source when it is sent and arrives at the destination when it is received; in between it belongs to
no branch at all. That is not an accounting nicety — it is what makes a stock count at the source
branch correct while the van is still moving.

A send refuses to move more than the unreserved quantity. Since `9.35`, receiving splits every line
into sellable received, damaged/quarantined, and missing. These must add up to the sent quantity.
Any discrepancy requires a controlled reason and a written note. Sellable units enter
`current_stock`; damaged units enter the destination's `quarantine_stock` with a `QUARANTINE_IN`
movement; missing units get their own `TRANSFER_LOST` evidence tied to the source and transfer
number. The immutable receive row and audit retain the per-line reason/note rather than calling
every difference “lost”. Cancelling is only possible before sending.

Receipt overrides must name distinct item IDs from that exact transfer. Unknown or duplicate IDs
reject the entire receipt before stock, audit or idempotency results are written; they must never be
ignored and turned into a default full receipt. Omitted overrides retain the existing full-receipt
default. Creation validates the total of repeated normalized SKU/size lines against the database
integer limit before inserting, including native/internal callers.

`TRANSFER_IN`/`TRANSFER_OUT` are separate movement types from `STOCK_IN`/`STOCK_OUT` because a
transfer does not remove goods from the company, and a total-stock-value report must not treat it as
if it did.

### Counts apply a difference, never an absolute

The trap in stock taking is that the shop keeps selling while someone walks the aisles. If applying
a count wrote the counted number straight into `current_stock`, every unit sold during the count
would be conjured back: count 10 at 9am, sell 3 at 10am, apply at noon, and the shelf says 10 when
it holds 7.

So `bms_stock_count_items` stores `snapshot_qty` — the system quantity at the moment the line was
added — and applying the count adds `counted − snapshot` to whatever the current quantity is by
then. Sales during the count survive, and the recorded variance is only the goods that were actually
missing. The snapshot is captured on first entry and does not move when a counter corrects a typo,
because a snapshot that chases every edit would swallow the sales that happened in between.

Applying is refused outright (`WOULD_BREAK_RESERVED`) if it would drop stock below what customers
have reserved at that branch; that situation needs a person to decide, not a silent winner.

`inventory.count` and `inventory.count.apply` are deliberately separate permissions, seeded by
`7.98` to Warehouse and Manager respectively. Walking the shelves and writing numbers down is a
warehouse job; signing off that the goods really are gone is an accounting decision.

### Document numbers

Transfers and counts are numbered `TRF-YYMMDD-NNN` / `CNT-YYMMDD-NNN`, per shop and per day rather
than from a global sequence. Both the date and the running number come from a single SQL statement
(`insertWithDailyDocNo` in `lib/bms/dailyDocNo.ts`), never from the Node clock: taking the date from
the app and the count from `CURRENT_DATE` means that a shop whose app runs `Asia/Bangkok` against a
UTC database issues duplicate numbers every morning between midnight and 07:00, when the two
disagree about what day it is. The insert also retries under a savepoint on a unique violation, so
two people creating a transfer at the same moment get consecutive numbers instead of a 500.

### Where the screens are

`/admin/stock-transfers` and `/admin/stock-counts`, gated by `inventory.transfer` and
`inventory.count`. Both appear in the shop group of the sidebar next to Purchase (PO), which is the
same family of work: goods arriving, goods moving, goods missing.

The receive dialog defaults every line to the quantity that was sent and lets it be lowered — that
input is the whole point of the screen, so it is a number field per line rather than a single
"received in full" button. The count screen leads with the variance, not the counted number: a
counter needs to see *what changed*, and a manager signing the count off needs the short total in
one place before pressing apply. The apply button is disabled, with the reason spelled out, for
anyone holding `inventory.count` but not `inventory.count.apply`.

The native POS reaches the same work from `งาน -> สต็อกสาขา`. The destination is selectable for a
transfer, but the source branch and every stock-count branch come from the paired device. The receive
screen requires a controlled reason plus note for damaged or missing units. Applying a count remains
a separate permission and shows the first-entry snapshot, counted quantity, and variance before
confirmation.

### Admin REST and mobile GraphQL

Staff stock transfers enforce assigned branch scope on REST and staff GraphQL (including the
deprecated combined command). Reads include documents touching either accessible endpoint. Create
requires both branches; send/cancel require the source; receive requires the destination. No assigned
branches retains the established all-branches policy. A branch-only employee can submit a
replenishment request for a manager to create the transfer instead.

Staff commands require an 8–200 character `idempotencyKey`; the optional SDL fields preserve schema
compatibility, but missing keys return `INVALID` without writing. Create/receive inputs and
send/cancel arguments accept the key. `commandStaffStockTransfer()` validates both transports and
supplies the trusted staff-scope flag. Scope is checked inside the tenant transaction before replay;
staff hashes bind the actor. Reusing a successful key with changed payload/actor returns `CONFLICT`.
Native device/cashier guards and native request hashes are unchanged.

The admin page saves the exact pending command in tab session storage scoped to tenant and user
before sending. Double-clicks are blocked. Unknown results (network, malformed response, 5xx) block
new commands and offer **ตรวจผลคำขอเดิม** using the original payload/key, including after reloading
the same tab. Auth/scope rejection and key conflicts retain the pending command for investigation.
Confirmed success clears it before refreshing, so refresh failure is not reported as mutation
failure. Closing the tab or clearing browser storage loses the local recovery record; inspect
existing documents before starting a replacement command in another tab/device.

The page also sends the GET's `commandScope` as an optional REST precondition. The server compares
it with the authenticated tenant/user and returns `SCOPE_CHANGED` (409) before executing a stale-tab
command. This value grants no authority. Refreshing after a user/shop switch restores only that
scope's pending command; the previous scope's recovery record remains intact. Older GET responses
cannot overwrite pending mutation state, and failure to persist a command prevents sending it while
keeping the form available for correction.

The admin screens keep `/api/bms/inventory/transfers` and `/api/bms/inventory/counts` as guarded REST
compatibility adapters. The native POS uses typed device-scoped GraphQL operations in
`graphql/bmsPosDevice.ts`. Both adapters call `lib/bms/stockTransfers.ts` and
`lib/bms/stockCounts.ts`; neither owns transfer or count rules.

Every native mutation verifies the cashier PIN and action permission. Tenant, source/count branch,
device, and shift authority are server-derived. `9.88` adds tenant-scoped inventory operation
idempotency: the service takes an advisory transaction lock, compares a canonical request hash, and
stores the exact success response in the same transaction as the stock movement. An unknown network
result can therefore be retried with the original key without sending, receiving, or applying twice.

GraphQL exposure still does not make these commands AI tools. A future tool must be a validated
wrapper in `lib/bms/tools/catalog.ts`, derive the tenant from `ExecCtx`, enforce the exact permission,
and remain propose-only where stock moves. Calling either transport adapter from a tool is not an
acceptable shortcut.

### What lands in the audit log

Both files write to `bms_audit_log` **inside the same transaction as the stock movement**, matching
the convention `pos.ts` uses for `pos.sale`/`pos.return`:

| Action | Target | Notable meta |
| --- | --- | --- |
| `inventory.transfer.create` | transfer id | `transferNo`, both branches, `lines`, `units` |
| `inventory.transfer.send` | transfer id | `units` that left the source branch |
| `inventory.transfer.receive` | transfer id | `unitsSent`, `unitsReceived`, `unitsDamaged`, `unitsMissing`, per-line reason/note |
| `inventory.transfer.cancel` | transfer id | `transferNo` |
| `inventory.count.create` | count id | `countNo`, branch |
| `inventory.count.apply` | count id | `adjustedItems`, `varianceUnits` |
| `inventory.count.cancel` | count id | `countNo` |

Individual counted lines (`recordCountItem`) are deliberately **not** audited: one shelf produces
hundreds of them and they would bury everything else in the log. The reviewable fact is who accepted
the variance, which is the apply entry.

Both REST and POS GraphQL adapters pass the verified actor as a raw `users.id` into the shared
service. `listAudit()` resolves it back to an email on read, which also
repairs the POS rows (`pos.sale`, `pos.return`, `pos.void`, …) that have always been stored that
way — searching `/admin/audit` by email now reaches them.

Being inside the transaction matters: a transfer that succeeds without its audit row is stock that
left a branch with nobody named on it, which is exactly the case an auditor asks about. For the same
reason `cancelStockTransfer`/`cancelStockCount` open a `beginTenantTx` rather than issuing a bare
`UPDATE` — a write outside a tenant transaction runs without `SET LOCAL ROLE bms_app`, so RLS never
gets a chance to catch a mistargeted row.

## Go-live checklist (multi-branch, 7.98)

Only needed for shops running more than one branch. Single-branch shops are unaffected by `7.98` —
every existing caller keeps resolving the default location.

- Apply `7.98__bms_stock_transfers_and_counts.sql` with `psql -1`. Without the single transaction a
  mid-file failure leaves half the tables behind and they have to be dropped by hand.
- Before releasing a Q6B native POS build, apply
  `9.88__bms_inventory_operation_idempotency.sql`. The mobile transfer/count mutations require this
  table to replay an unknown network result safely; deploying the client first makes every one of
  those writes fail instead of silently falling back to a non-idempotent path. `9.88` is listed in
  `scripts/schemaReadiness.mts`, so `db/checks/schema-readiness.sql` names it on a database that is
  missing it — the failure is otherwise a bare `42P01` rollback with nothing pointing at the cause.
- A retry that carries the original key but a *changed* body is refused, not applied: the first
  request already committed under that key. The server answers `CONFLICT`
  (`extensions.reason = IDEMPOTENCY_CONFLICT`), never a 500, because the documented client action
  for a 500 is "retry with the exact same key" — which for this case loops forever. The register
  releases the key, refetches, and lets the operator act on the real state.
- Confirm the migration seeded `inventory.transfer` and `inventory.count` to Manager and Warehouse,
  and `inventory.count.apply` to Manager only. Missing seeds mean `/admin/stock-transfers` and
  `/admin/stock-counts` return 403 with no visible error — the app does not log out on 403.
- Give every branch its own `branch_code`. It defaults to `'00000'` and is unique per tenant, so a
  second branch created without one collides with head office immediately.
- Check that each branch has inventory rows for the SKUs it actually sells; a transfer can only send
  what the source branch holds unreserved.
- Rehearse one transfer end to end, including a short receive: send it, receive fewer units than
  were sent, then confirm the source branch shows a `STOCK_OUT` movement noted as lost in transit
  and the audit log holds `inventory.transfer.receive` with a non-zero `unitsMissing`.
- Rehearse one count on a branch while a sale goes through on the same SKU mid-count, then apply it.
  The sale must survive; the recorded variance must reflect only the goods that were missing.
- Decide who holds `inventory.count.apply` before handing the count screen to warehouse staff.
  Accepting a variance writes stock off, and it cannot be undone from the UI.


## Barcodes (7.99)

Two different jobs share one field, and confusing them is the whole problem.

**A product the manufacturer labelled** already carries an EAN-13 or UPC that GS1 issued to the brand
owner. That number must be **scanned in**, never typed and never generated. Generating a fresh number
for such a product leaves the system holding a code that does not match the one printed on the item,
so staff scan the bottle and nothing is found. The field takes scanner input directly — a
keyboard-wedge scanner types the digits and presses Enter for you.

**A product with no barcode** — split packs, repacked bulk, own-made goods, imports with no code —
needs a number the shop invents and prints itself. That is what the generate button is for.

Generated codes are EAN-13 in the **20–29 prefix range GS1 reserves for in-store use**, with a
correct check digit. Both halves matter: a random number in, say, the 885x Thai prefix would collide
with a code GS1 issued to a real company, and the day that company's product arrives in the shop it
would scan as yours instead; a wrong check digit means scanners reject the label outright. Numbers
walk a sequence rather than being random — random needs retry loops that collide more often the
larger the catalogue gets — and the generator steps over any number the shop already typed by hand.

The button does not write to the database. It hands the number to the form and the user saves; people
open a form, click things, and close it again all the time, and a code burned on every click would
leave gaps in the sequence with no product holding them.

`checkBarcode()` in [barcode.ts](../../apps/web/lib/bms/barcode.ts) validates on entry and **warns
without blocking**. Real shops carry genuinely odd codes: Code 128 of arbitrary length, a factory's
internal reference, a number someone wrote on the shelf years ago. Blocking anything that is not a
clean EAN-13 would stop a shop from recording products it actually sells, and the POS lookup matches
exactly anyway, so an unusual code still scans. What the warning does is tell you the difference
between a code you can print a label for and one you cannot.

### Uniqueness is per shop

`3.4` created `uq_bms_products_barcode` as `UNIQUE (barcode)` with no tenant column, written when the
system served one shop. Under multi-tenancy that meant **two shops selling the same product could not
both record its real barcode**. The second shop got a duplicate-key error for a value it cannot see,
held by a shop it does not know exists — an error with no possible explanation from the user's side,
and a certainty for common goods like soap or a well-known fragrance.

`7.99` scopes it to `(tenant_id, barcode)`, matching what `bms_product_packs` already did in `7.86`.
Duplicates inside one shop are still rejected: one barcode must not resolve to two products.

Relaxing the index cannot fail on any database, because the old index guaranteed no duplicates exist
anywhere. The migration still checks for within-shop duplicates first and stops with the offending
codes named, in case a database was hand-edited and lost the index at some point.

### Printing the labels

`/admin/product-labels` closes the loop: pick products, set how many stickers each needs, print. A
generated code is worthless until it is on the product.

Labels are 40×30mm, the size Thai label printers most commonly take, laid out so they also work on
A4 sticker sheets. Sizing is in millimetres rather than pixels because that is the unit label
printers think in. Printing goes through the browser's own dialog, not the ESC/POS path used for
receipts — a label printer is a different device from a receipt printer, and letting the OS dialog
choose keeps both workable.

The barcode is drawn by `eanBars()` in [lib/pos/barcode.ts](../../apps/web/lib/pos/barcode.ts), which
**refuses to draw a code whose check digit is wrong**. Drawing it anyway would be worse than
refusing: the shop prints and applies a whole batch of stickers, then discovers they scan as nothing
while a customer is waiting. Products selected but unprintable are listed with the reason and a link
back to generate a code.

Guard bars run longer than data bars, and quiet zones are left on both sides — a barcode with correct
bars but no margin does not scan. The digits are always printed underneath so staff can key the
number in when a sticker is creased or smudged.

The bar pattern is asserted bit-for-bit against the standard in
[barcode-contract.test.mts](../../scripts/barcode-contract.test.mts), built by hand from the encoding
tables rather than recorded from the function's own output.


## Bundles / kits (8.8)

A gift set is one thing the customer buys and three things that leave the warehouse. Set `is_bundle`
on a product and list its components in `bms_product_bundle_items`; the set is priced on its own row
(that is the point — cheaper than buying loose) and stock comes out of the components.

The structural problem is that `bms_order_items` has an FK to `bms_inventory`, so every line needs a
stock row, but a set is not stocked. The set therefore gets an inventory row that **stays at zero**
forever, created automatically on first sale, and reservation skips it and goes to the components. That
zero is not a fudge: a set's sellable quantity genuinely comes from its components, not from itself.
The receipt still shows "gift set", which is what the customer bought — recording the three components
as separate lines would produce a receipt that neither matches the customer's understanding nor
explains the price.

### One expansion, not four

Separate places moved stock by reading `bms_order_items` directly: deduct at sale, restore on
return, release reservations on cancel, FEFO lot consumption, shipment fulfilment, and the expiry
sweep. Each of them joining the recipe
itself would be four pieces of code that must be equally correct and would drift apart.

`bms_order_stock_lines` is a view that does the expansion once — ordinary legacy lines pass through,
legacy set lines become their components × set quantity, and orders created after `9.40` read their
immutable `bms_order_item_stock_consumption` snapshot. **Anything new that moves stock must read the
view, not the table.**

Two failures that view prevents, both silent:

- deducting from the set's own inventory row would drive it negative and hit
  `CHECK (current_stock >= 0)` in the middle of closing a bill
- moving inventory without consuming lots leaves lot totals and stock totals disagreeing until
  somebody reconciles — the ledger would say the set moved while inventory moved the components

The view carries `order_item_id` so lot provenance still links back to the line that was sold.

**Two more places were reading the table, and both failed closed** (found 2026-08-31, fixed with
`9.42`): `createShipment()` deducted stock straight from `bms_order_items`, so a bill containing a
set — and, after `9.40`, any menu item — could not be shipped at all; and `releaseExpiredOrders()`
released reservations the same way, so one derived order anywhere in the batch rolled back the whole
cron and **no tenant's expired holds were ever released**. Neither failure names bundles in its
error, which is why both survived since `8.8`. The invariant is now enforced by
`scripts/order-stock-lines-contract.test.mts`: any SQL statement in `lib/bms` that writes
`bms_inventory` while naming `bms_order_items` fails the gate, and the four owning files must each
still name the view. A prose rule that six call sites have to remember is one refactor away from
being seven.

A set with no components is refused (`BUNDLE_INCOMPLETE`) rather than sold, because selling it means
nothing leaves the warehouse. A short component blocks the sale and the error names **the component**,
not the set — "the set is out of stock" tells staff nothing they can act on.

Migration `9.3` idempotently repairs the bundle table, RLS/grants, and expansion view for long-lived
deployments that received bundle-aware application code without migration `8.8`. Do not add a runtime
fallback to ordinary order lines: a register that appears to recover while deducting the set row
instead of its components would turn a visible schema error into silent inventory corruption.

## Multi-store stock policies (`9.40`–`9.41`)

An archetype is an onboarding preset, not a stock rule. `bms_store_capabilities` stores tenant
overrides, while `bms_product_stock_policies` decides each product's authoritative behaviour:
`DIRECT`, `PACK`, `BUNDLE`, `WEIGHTED`, `RECIPE`, or `SERIALIZED`. A mixed shop can keep a restaurant
archetype and manually enable weighed products without moving tenant or inventory data.

### Catalog lifecycle and product roles (`9.51`)

Product setup is now draft-first. Creating or importing a new SKU always stores `active = false`;
reactivating an inactive SKU runs the same readiness check as the explicit publish mutation. The
check blocks missing catalog variants, zero selling prices, unknown VAT classification for a
VAT-registered shop, incomplete RECIPE/PACK configuration, and disabled required capabilities.
Warnings such as an absent kitchen station or incomplete recipe cost remain visible without
silently inventing values.

`bms_product_variants` is the catalog source of truth for sizes, serving options, colours and other
sellable variants. A row can exist while every branch has zero stock; `bms_inventory` remains the
physical per-branch balance and is never mutated merely to create an option. Existing writes to
inventory, packs, recipes and modifiers synchronize a corresponding catalog variant through an
insert-only trigger for backward compatibility.

`bms_product_sales_surfaces` explicitly separates lifecycle from visibility. An active SKU is sold
only on its enabled surfaces: `RETAIL_POS`, `RESTAURANT_POS`, `PUBLIC_STOREFRONT`, `CUSTOMER_AI`, or
`ONLINE_ORDER`. An ingredient can therefore remain active for recipe consumption while appearing on
no menu or customer catalog; a bottled drink can intentionally appear on both POS surfaces. The
store archetype supplies initial form defaults only and never overrides these per-product choices.

Two consequences of "visibility is declared, never inferred" are easy to get wrong and are
therefore fixed in code rather than left to operator memory. First, the `9.51` backfill treats a
product as priced when either `bms_products.price` or an active **base pack** price is above zero:
a menu priced only through its base pack (supported since `8.1`/`9.22`) would otherwise lose every
surface the moment the migration ran. Second, sample data is inserted directly (it does not go
through `upsertProduct`), so `seedFakeProducts()` writes the surface rows itself — and that path is
also the "create sample data" button a brand-new shop presses, not just the dev seeder. A seeded
product with no surface row would look active in the catalog while being invisible and unsellable
everywhere.

The Products form exposes five starter templates—quick menu, prepared menu, ready-made item,
ingredient and general product—then stores the same shared product model. The shop experience
profile ranks only the templates relevant to the current archetype; specialist templates remain
available behind an explicit expansion. The same profile also groups Stock Models into recommended,
already-in-use and additional capabilities. Existing configuration always remains visible even when
it is not recommended for the archetype. Stock policy dependencies continue to be edited in Stock
Models. Changing a RECIPE product to another policy is refused while active recipes or modifiers
exist unless the operator explicitly asks to deactivate those derived records in the same
transaction.

Restaurant product creation keeps the shared catalog's core identity, pricing, tax, search and sales
surface fields visible. Barcode, shipping weight, brand and wholesale tiers are progressively
disclosed according to the selected template: packaged ready goods expose the relevant retail
fields, while prepared/quick menus keep them behind an explicit action. Editing a product that
already contains any of those values expands the section automatically; hiding the section never
clears or changes stored data.

Inventory quantities remain integers. Measured goods choose the smallest useful base unit, such as
gram, millilitre, or millimetre; display units and precision are presentation metadata. Existing
`bms_product_packs.base_qty` remains the source of truth for piece/pack/carton conversion.

`resolveStockConsumptionInTx()` expands a sold line once. Recipe versions and selected modifier codes
become component quantities in `bms_order_item_stock_consumption` before the order commits. Reserve,
cancel, ship, POS FEFO, return, and movement ledger all consume that snapshot through
`bms_order_stock_lines`, so editing a recipe later cannot reinterpret an old bill.

### Which capability flags are switches, and which are not

`bms_store_capabilities` holds thirteen flags, but only five are read before anything happens:
`RECIPE`, `MODIFIER`, `WEIGHTED_PRODUCT`, `KITCHEN_WORKFLOW`, `WASTAGE`. The other eight describe
what the shop's data already looks like — packs exist because rows exist in `bms_product_packs`,
expiry blocking and FEFO happen because rows exist in `bms_inventory_lots`, serial capture happens
because `bms_products.serial_tracked` is set, and the pharmacy gate is `business_archetype`.

They shipped as switches anyway, so a shop could turn `LOT_TRACKING` off and still be refused an
expired lot, or read `SERIAL_TRACKING: off` while the register kept demanding serials. A switch that
changes nothing is worse than no switch: it is read as a statement about the system's behaviour.
Those eight now render as detected status, and `upsertStoreCapability()` refuses to write them —
a stored override that means nothing is the same lie, one layer down.

Making them real switches was rejected, not overlooked: an off position for `LOT_TRACKING`,
`EXPIRY_TRACKING` or `FEFO` is a button that sells expired stock, and an off position for `PACK`
would stop pack scanning at every restaurant, whose preset has no `PACK` at all while its products
may still have packs configured. `scripts/store-capability-gates-contract.test.mts` keeps the
switch list equal to the set of capabilities the source actually gates on, in both directions.

Restaurant recipes are versioned in `bms_product_recipes`; one active version exists per SKU/size.
Recipe saves are copy-on-write: changing ingredients, their quantities, or `output_qty` creates a
new id/version, including edits to an inactive recipe. An unchanged definition (ignoring component
order) keeps its id; activation/deactivation alone changes only `active`. Saving changed content
with `active=false` leaves the currently active recipe available. With `active` omitted, an edit
inherits the source's current active state; a new recipe defaults inactive. Callers must use the
returned id. The product row lock serializes version allocation/activation, readiness is rechecked,
and `product.recipe_upsert` is audited in the same tenant transaction, with `sourceRecipeId` when
content is copied. Quantities/yield must be positive PostgreSQL INTEGER base units; fractional
values are rejected, not truncated. No migration or reconstruction of overwritten history occurs.

This is service-level content preservation, not database-enforced immutability or the planned
DRAFT/PUBLISHED/RETIRED lifecycle. Migration `10.61` adds per-check-item stock/cost snapshots. A first
successful kitchen send freezes the resolved recipe/modifier consumption and catalog cost. Later
rounds, split/merge and kitchen cancellation reuse each SENT item's own evidence; NEW lines remain
unfrozen even if a split temporarily reserves them. Missing cost remains unknown. A menu ordered in
two rounds can therefore use two versions without rewriting the first round. No new payment or
stock ledger is introduced. Explicit empty consumption remains empty after a policy change.

Existing open checks are adopted only from persisted reservation rows, marked `LEGACY_RESERVATION`
(not proof of the original kitchen round). Missing/ambiguous evidence, legacy empty consumption or
fractional stock allocation require operator review; the whole operation rolls back. No backfill
uses today's catalog. Finish legacy NON_STOCK checks before rollout where possible. Ordinary full
check cancellation remains available through its existing approval flow.

Scope: selling-price/promotional/catalog-availability checks still run under the existing rules on
rebuild. Disabling a menu/modifier can block a rebuild; changing a pack's base quantity is rejected
instead of silently resizing historical stock. Receipt gross display remains separate from exact
`line_amount`. Return promotion eligibility groups the new restaurant lines by menu/variant, while
named packs and retail stay separate. Deletion tooling must delete order items before check items.
The existing authorized full-tenant purge detaches these links before deleting the restaurant floor,
within its original transaction and selected-tenant scope; its authorization rules are unchanged.

Restaurant costing rollout (2026-10-15): recipe content preservation and per-item pinning are now
implemented, with executable DB-free tests and DB scenarios. PostgreSQL migration/locking/RLS and
end-to-end settlement verification remain a deployment gate on a restored disposable database.
The user explicitly deferred DB execution on 2026-10-15 because this machine has no test database;
local completion covers code, documentation, DB-free contracts and mocked browser checks only.
Phase 2 adds pinned subrecipes and recipe SOP (`10.62`). At Stock models > Recipes, choose a child
product and exact version (inactive versions are allowed), then enter the child output base units
needed for the parent's yield, not a batch count. For example, a 100 g sauce recipe using 60 g sugar,
referenced for 20 g output, contributes 12 g sugar. Fractional base ingredients are refused: use
smaller base units or adjust the yield instead of rounding. Duplicate leaf ingredients are combined.
This is virtual ingredient expansion, not stocked-preparation production or a second stock ledger.

The parent stores its chosen version until explicitly changed; child recipe/SOP edits never rewrite
parents, historical BOMs or sent-check snapshots. Edit ingredients, output, child pins or SOP to
create a new version; status-only/no-op saves retain the version. Missing SOP is explicitly absent.
Expand a saved recipe row to read its ordered staff-written SOP. These are reference instructions,
not a kitchen checklist or completion evidence. No AI tools/customer response behavior is added.
Saving rejects self/ancestor cycles, missing/foreign refs, overflow, more than 200 leaf ingredients,
20 immediate children, 8 nested levels or 64 versions (also bounded to 256 traversal visits).
SOP accepts up to 50 nonblank steps, 2,000 characters each. Existing legacy flat editors cannot
silently discard a composed recipe's references or SOP. Referenced recipe/product deletion can now
be refused by FK; retire/deactivate versions instead. The save uses the original product.edit
permission and transactional audit. DB-free coverage does not prove the new FK/RLS/concurrency SQL.

Phase 3 adds recipe planning estimates (`10.63`). Expand a saved recipe row and click Recipe cost estimate
to open the responsive detail dialog and read its server-calculated
ingredient breakdown from the compiled leaf BOM and current `bms_products.cost_price` per base unit.
The read is one tenant-scoped SQL statement, labelled with recipe version and catalog observation time;
refreshing can change the estimate when catalog prices change, without changing recipe or bill history.
The existing readiness estimate remains ingredient-only and keeps its original behavior.

The recipe editor accepts three optional whole-batch assumptions: labor person-minutes × THB/person-hour
÷ 60, electricity kWh × THB/kWh, and gas kg × THB/kg. Each needs a staff-written source/date/basis
(1–500 characters); quantity/rate are nonnegative, at most 1,000,000 with up to six decimals. These are
staff assumptions, not independently verified tariffs or expense documents. All three cover the full
recipe output, INCLUDING child preparation. Child overhead is deliberately not added again; review
these assumptions after changing yield/composition. No automatic allocation from payroll/bills exists.
Unchecked categories and missing/invalid ingredient costs are unknown. Explicit zero usage requires
quantity/rate/source. Known subtotal stays visible, but full batch and per-output-unit totals are null
until all categories and ingredients are known. Exact fixed-point math aggregates before two-decimal
rounding and yield division; displayed rounded rows may differ from totals. Unsafe money ranges fail.

Assumptions are copy-on-write definition content: edits (including source-only edits or clearing)
append a version, no-op/status-only saves retain it, omitted API input preserves it. Explicit null
clears all categories; a provided object replaces the entire three-category set (omitted categories
become unknown). Old clients continue to preserve assumptions. The same product.edit permission,
product lock and transactional audit apply; product.view reads estimates, including inactive versions.
No new AI tool, POS/mobile flow, stock movement, payment, expense, report or realtime event is added.
Modifiers, rent, depreciation, VAT/GP and purchase-lot actual COGS are excluded. This estimate is never
copied into `cost_amount_snapshot` or sent-check snapshots. Migration must precede recipe API deployment.
DB-free contracts and mocked browser checks do not prove PostgreSQL constraints/RLS/locking; DB testing
remains explicitly deferred on this machine.

Phase 4 adds monthly cost reconciliation (`10.64`) in Reports, separate from gross profit, net profit,
tax and cash-flow statements. Reads require report.view + expense.view + delivery.settlement.view
and unrestricted all-branch access: statement fees have no reliable branch allocation. Reviews also
require expense.manage, confirmation and a reason. No client amount or tenant is authoritative.

Sources: expense documents use pre-input-VAT base (credit notes negative, supplier notes in received
month); settled POS expenses use actual gross amount in Bangkok settlement month; LIVE delivery
statement headers use fee + commission in Bangkok period-end month, eligible only MATCHED/CLOSED.
Never add statement lines, payouts, refunds, drawer/wallet movements or recipe estimates again.
Classify as OPERATING, GP, DEPRECIATION, DUPLICATE, EXCLUDED or UNREVIEWED. Inventory/ingredient
purchases cannot become another cost on top of COGS. Duplicate decisions require a reviewed canonical
typed source key, including across months; no chains or automatic equal-amount matching.

Depreciation allocates basis minus residual over 1–600 whole months from a chosen start month, with
integer-cent cumulative rounding conserving the total. It is non-cash planning, not a tax schedule.
Source fingerprints invalidate stale evidence; versions reject stale edits; identical retries do not
duplicate audits. Review and before/after audit commit together. Source documents, stock, money and
tax ledgers stay unchanged. Previously reviewed LIVE statements remain visible if environment changes.

Unknown/stale/non-THB evidence leaves reviewedTotal null, with known subtotals separate; no FX guessing.
The 1,000-row limit includes historical depreciation schedules (1,001 loaded to detect truncation),
and truncation also means unknown. Fully reviewed only describes loaded records, not completeness of
bookkeeping. Migration must precede deployment; real SQL/RLS/locking tests are deferred here. No AI,
realtime, external provider or mobile POS changes. Promotion/menu planning is described in phase 6 below.

**Phase 8: monthly operating-expense allocation (`10.66`).** Reports > Open expense allocation uses
its own month, independent of the parent report filters. First review/classify sources in phase 4;
only current OPERATING, GP and monthly DEPRECIATION recognized amounts may be allocated. Inventory/
ingredient purchases, duplicate sources, exclusions and recipe labor/energy estimates are not added
again. Supplier credits retain their negative sign. This is management attribution, not a new expense,
cash/stock/tax posting, statutory depreciation schedule or the phase-9 net-profit report.

Each month/source has one latest allocation version and retains all older versions. Choose one or
more branch/channel targets (at most 100) and a reason: DIRECT requires one target; EQUAL divides
equally; WEIGHTED uses nonnegative integer weights (70/30 can represent percentages); SALES_GROSS or
SALES_UNITS derives weights from the shared phase-7 source stream. Blank channel means all channels
of that branch. Duplicate/overlapping targets are rejected, not silently counted twice. Only declared
targets share that source's cost; manual weights are staff decisions, not measured usage. There is
no implicit carry-forward into another month and no automatic menu/SKU allocation in this phase.
In result groups, null channel is a branch-wide cost bucket, not a subtotal of the channel-specific
buckets belonging to other expenses. Sum each bucket once; do not add a derived subtotal again.

Sales drivers are paid product activity **after order discounts, including VAT, before return/void
reversals**, not net revenue/units; free gifts count as units. Extras, shipping and rounding are
excluded from the product sales denominator. This explicitly reuses gross recorded activity while
phase-7 tax/return reconciliation remains unresolved. No top-N query or client-provided sales figure
is accepted. Missing cost or VAT does not invalidate a gross-sales weight, but mismatched product
totals, unknown sale dates, missing branch/channel, scan truncation and malformed evidence do.
Zero denominator with a nonzero expense requires a different reviewed basis; never fall back to equal
shares. True zero expense stays zero. BigInt cumulative rounding conserves every cent, also for credits.

Reads and writes require report.view, expense.view, delivery.settlement.view, tax.document.view and
unrestricted branch access; saving also requires expense.manage and explicit human confirmation.
Tenant/actor derive from auth, and branch/currency checks repeat inside the serializable tenant
transaction. Source reviews and the complete bounded sales stream are composed on the same client
and snapshot. The writer re-reads the preview evidence, compares fingerprints and expected version,
then inserts the new immutable version and decision audit atomically. Exact retries do not duplicate
versions/audits. No money amount, tenant, denominator or result is accepted from the client.

The worksheet shows the server preview before enabling confirmation. Edits/month changes/closing
invalidate pending previews; old success/error responses cannot replace current evidence. A rejected
save clears confirmation and needs a new preview. Source, review, target or sales-population changes
make saved results STALE: the frozen result remains inspectable but is excluded from current totals.
Reviewed exclusion/duplicate/void eligibility makes the old allocation INACTIVE without deleting it.
Missing sources remain unresolved. Full allocatedTotal is null until all loaded reviewed costs are
current and allocated; known subtotals remain separate. Complete is not proof all expenses were entered.

Apply `10.66` before deploying the worksheet/API. DB work is deferred: migration apply/reapply, inherited
source grants, new table RLS and append-only grants, cross-tenant isolation, concurrent version/review/
sales changes, serializable retries, audit rollback and real query plans. DB-free fakes and mocked
browser smokes verify orchestration/UI only. Existing profit reports, POS, returns, stock, tax documents,
AI, mobile and realtime contracts are unchanged. Phase 9 below consumes current allocations in a
separate read-only profit worksheet; it does not replace the legacy profit engine.

### Restaurant phases 1–9: completion and remaining-work log (2026-10-15)

**สถานะส่งมอบเดิม:** มี implementation ระยะ 1–9 ตามขอบเขตด้านล่าง แต่ **ยังไม่รองรับทุก feature
ในภาพแบบครบวงจร** รอบส่งมอบเดิมผู้ใช้ให้ข้าม DB ไปก่อน ต่อมาผู้ใช้อนุญาตทดสอบ local Docker DB
และมีการเพิ่ม/รัน integration tests แล้ว ดูผลและข้อจำกัดในหัวข้อ D ด้านล่าง การ commit/push
เป็นการเก็บและส่งงานบน feature branch ไม่ใช่การอนุมัติ deploy หรือยืนยัน production readiness.
รายการนี้เป็น backlog ณ วันที่บันทึก ไม่ใช่ข้อความว่าแก้ข้อจำกัดเหล่านี้แล้ว

| ระยะ | สิ่งที่มีแล้ว | ขอบเขตที่ต้องไม่ตีความเกินจริง |
| --- | --- | --- |
| 1 | Version สูตรและ snapshot วัตถุดิบ/ต้นทุนข้ามรอบครัว แยก/รวมบิล | ไม่ได้ freeze ราคา ความพร้อมขาย หรือ modifier ทั้ง catalog; legacy ที่ไม่มีหลักฐานยังไม่ทราบต้นทุน |
| 2 | สูตรย่อยแบบอ้าง version, compiled BOM และ SOP | SOP เป็นข้อมูลอ้างอิง ไม่ใช่ checklist ปฏิบัติงานหรือ ledger ผลิตสินค้าสำเร็จรูป |
| 3 | ประมาณต้นทุนสูตร รวมสมมติฐานแรงงาน/พลังงาน/แก๊ส | เป็นต้นทุนเพื่อวางแผน ไม่ใช่ต้นทุนจริงตามล็อตซื้อ; ไม่หักซ้ำกับค่าใช้จ่ายจริง |
| 4 | ทบทวนค่าใช้จ่ายรายเดือน, GP และค่าเสื่อมเชิงบริหาร | ไม่รับรองว่าลงบัญชีครบทั้งหมด; ค่าเสื่อมไม่ใช่ระบบภาษี/บัญชีสินทรัพย์เต็มรูปแบบ |
| 5 | จำลองราคาปลีก/ยกชุด/ช่องทาง, VAT/GP และจุดคุ้มทุน | เป็น scenario ไม่เปลี่ยนราคาขายจริง และไม่ใช่พยากรณ์ยอดขายตาม sales mix จริง |
| 6 | Menu Engineering จาก demand ที่กรอก และจำลองชุดโปรโมชั่น | ยังไม่ได้ใช้ยอดขายจริง และยังไม่ publish กฎโปรโมชั่นไปขาย |
| 7 | Sales evidence และ snapshot คืนสินค้าแยก VAT/ค่าส่ง/เงินปัดเศษ | VAT คืนเป็นการปันจาก SALE ไม่ใช่ใบลดหนี้ภาษี; หลักฐานเก่าที่หายไม่เดาเติม |
| 8 | ปันส่วนค่าใช้จ่ายตามสาขา/ช่องทาง แบบ direct/equal/weighted/sales พร้อม version/audit | ยังไม่ปันรายเมนู/SKU; sales driver เป็นยอดสินค้ารวม VAT ก่อนคืน ไม่ใช่ยอดสุทธิหลังคืน |
| 9 | รายงานกำไรสุทธิจากหลักฐานที่บันทึก ก่อนภาษีเงินได้ | ไม่ใช่กำไรจริงครบทุกกรณี: ใช้ CATALOG_AT_SALE ไม่ใช่ล็อตซื้อ; มี RETURN จะยังไม่สรุป net COGS/profit |

#### A. Backlog เดิมก่อนส่วนขยาย 10.67–10.69

สถานะปัจจุบัน: COST-ACTUAL, COST-RETURN, LOSS-VALUE และ MENU-ACTUAL มี service/UI/tests
ตามหัวข้อ Completed restaurant costing workflow ด้านล่างแล้ว PRICE-PUBLISH รองรับเปิดใช้ทันที
สำหรับราคาต่อหน่วย/ชุดเมนูเดียวกัน/โปร N-for-price พร้อม confirmation/history; scheduling และ
mixed-menu activation อัตโนมัติยังไม่ใช่ขอบเขตนี้ MONEY-RECONCILE ปิดการหักซ้ำของ POS return/
refund/ใบลดหนี้ที่จับคู่ได้แล้ว แต่รายการเก่าหรือนอก flow ที่ไม่มีหลักฐานยังต้องทบทวน
รายการ 1–6 ต่อไปนี้เก็บไว้เป็นเกณฑ์และประวัติของ backlog เดิม ไม่ใช่สถานะล่าสุดของทุกข้อ.

1. **COST-RETURN — ต้นทุนที่กลับคืนจริง:** เพิ่มหลักฐาน cost reversal/stock recovery ที่มี
   authority สำหรับคืน/void รวมอาหารปรุงแล้ว การปล่อย reservation คืนบางส่วนสะสม ข้ามเดือน
   และข้ามสาขา ต้องแยกเงินคืนออกจากมูลค่าสต็อกที่รับกลับ ปัจจุบันทุก RETURN ทำให้กำไรเต็มเป็น
   unknown แม้ snapshot VAT/ค่าส่ง/ปัดเศษครบแล้ว เกณฑ์จบ: ย้อนกลับต้นทุนตามหลักฐานเดิมเพียงครั้งเดียว
   และกรณีไม่มีหลักฐานยังแสดง unknown ไม่ใช้ quantity cost basis แทนมูลค่ารับคืน
2. **COST-ACTUAL — ต้นทุนจริงย้อนหลัง:** กำหนดและ implement นโยบาย valuation/COGS ที่สอดคล้อง
   กับหลักฐานซื้อ/ล็อตและการใช้วัตถุดิบ รวมต้นทุนเมื่อรับคืน ไม่อ้างว่าราคา catalog ณ วันขายเท่ากับ
   ต้นทุนซื้อจริง เกณฑ์จบ: trace ที่มาต้นทุนได้ และข้อมูลเก่าที่ไม่มีหลักฐานไม่ถูกเติมด้วยราคาปัจจุบัน
3. **LOSS-VALUE — มูลค่าสูญเสียและปรับสต็อก:** ประเมินมูลค่า wastage, transfer loss,
   count adjustment และ manual stock-out พร้อม linkage/dedup เพื่อไม่หักซ้ำกับ COGS/expense
   ปัจจุบันพบรายการเหล่านี้ที่ยังไม่มีมูลค่าจะไม่สรุปกำไรเต็ม
4. **MONEY-RECONCILE — กระทบยอดรายการนอก flow:** เชื่อม blind return, payment refund ที่ยัง
   ไม่จัดสรร, back-office return และใบเพิ่มหนี้/ลดหนี้กับยอดขาย/คืน/VAT ให้ครบ ต้องไม่หัก refund,
   CREDIT และ credit note ซ้ำกัน และไม่ใช้ management VAT allocation แทนเอกสารภาษีจริง
5. **MENU-ACTUAL — Menu Engineering จากยอดขายจริง:** ใช้ sales evidence ของช่วงเวลา/สาขา/
   ช่องทางที่เลือก รวมส่วนลด คืน ของแถม และ coverage ต้นทุน สร้างเกณฑ์ popularity/contribution
   จากประชากรยอดขายจริง แสดง unknown/truncated ชัดเจน ไม่แทนข้อมูลขาดด้วยศูนย์ ระยะ 6 ปัจจุบัน
   ยังเป็นแผนจาก demand ที่กรอก ต้องคงหน้าวางแผนเดิมไว้แยกจากผลจริง
6. **PRICE-PUBLISH — นำแผนราคา/โปรโมชั่นไปขาย:** เพิ่ม flow preview → human confirmation →
   version/effective window/scope → activate ผ่าน selling service กลาง พร้อม RBAC, audit,
   idempotency, conflict/applicability checks และ snapshot กฎที่ใช้จริงบนบิล รวมของแถมและกฎคืน
   ต้องทดสอบ POS/ออนไลน์ที่อยู่ใน scope และราคา/โปรโมชั่นเดิม ไม่ให้การกดคำนวณแผนเปลี่ยนราคาทันที

ลำดับที่แนะนำ: ตกลงนโยบาย COST-ACTUAL/COST-RETURN ร่วมกัน → ทำหลักฐานต้นทุนและ LOSS-VALUE/
MONEY-RECONCILE → MENU-ACTUAL → PRICE-PUBLISH โดย recheck service/API/UI/migration และเพิ่ม
regression ทุกช่วง รหัสข้างต้นเป็น backlog IDs ไม่ใช่การกำหนดเลขระยะใหม่แทนแผนที่ผู้ใช้ตกลงไว้

ขอบเขตเพิ่มเติมที่ **ยังไม่มี** และต้องตกลงก่อนขยาย: ปันส่วนรายเมนู/SKU, sales driver แบบสุทธิ
หลังคืน, carry-forward การปันส่วนข้ามเดือน, ภาษีเงินได้/บัญชีแยกประเภทเต็มระบบ, export/mobile/
realtime สำหรับ worksheet กำไรใหม่ รายงานและ export เดิมยังไม่ถูกแทนที่ ส่วน `COMPLETE` หมายถึง
หลักฐานที่โหลดมากระทบยอดได้ ไม่ได้ยืนยันว่าบันทึกรายรับ/ค่าใช้จ่ายครบทุกแหล่งแล้ว

#### B. รายการตรวจ DB ที่ค้าง ณ รอบส่งมอบเดิม (ผลติดตามอยู่ในหัวข้อ D)

- **DB-SCHEMA:** apply/reapply migration `10.61`–`10.66` ตามลำดับบน throwaway DB ที่ restore
  baseline ได้รับอนุญาตแล้ว ตรวจ readiness, FK/constraints, grants/RLS และ cross-tenant isolation
  ห้ามถือว่า migration ชุดนี้สร้าง DB ว่างได้ และห้ามนำขึ้น production จากผล pure tests อย่างเดียว
- **DB-RESTAURANT:** SQL จริงของ snapshot ข้ามรอบครัว/แยก-รวมบิล/ยกเลิก/settlement, legacy
  checks, transaction rollback, idempotency และสูตร/version/subrecipe เมื่อแก้ไขพร้อมกัน
- **DB-RETURN:** immutable snapshot guard, partial-to-full mixed VAT/rounding, refund/CREDIT/
  void replay และ concurrency รวม stock/tax/realtime triggers ในธุรกรรมจริง
- **DB-COST:** operating-cost review/dedup/source retirement, allocation version locks,
  exact replay, stale preview, audit rollback และ SERIALIZABLE snapshot/retry เมื่อยอดขายหรือ
  source/review เปลี่ยนพร้อมกัน ต้องทดสอบ grants ของ source tables ด้วย
- **DB-REPORT:** SQL และ query plans ของ phase 7–9, paging/caps/timeouts, เดือนปัจจุบันที่มี
  sale/return ใหม่, หลายสาขา, permission denial และ snapshot consistency ทั้ง sales/expenses
  ใน query เดียว ตรวจจำนวนข้อมูลระดับใช้งานจริง ไม่ใช้ fake SQL เป็นหลักฐาน performance
- **DB-COVERAGE/ROLLOUT:** รัน DB suites ที่เพิ่ม/แก้ และเติม DB integration coverage ของ allocation/
  net profit ที่ยังมีเพียง doubles ตรวจ active legacy checks ก่อน rollout และลง prerequisite
  migrations ก่อน API/UI ไม่มี DB suite หรือ migration ใดถูกรันในงานรอบนี้

การผ่าน B ไม่ทำให้ A เสร็จโดยอัตโนมัติ และการปิด A ด้วย pure tests ไม่ทดแทน B

#### C. Verification evidence และการส่งมอบ

- ผลล่าสุดก่อนเพิ่ม log นี้ (2026-10-15): `npm run gate` ผ่าน typecheck, 235 DB-free test files
  (2,848 passed / 2 skipped / 0 failed; รวม 2,850 cases) และ production build
- Browser smoke บน final build แบบ mocked API/idle WS ผ่าน 12 cases: net profit, allocation,
  operating cost แต่ละชุด TH/EN ที่ desktop 1280px และ mobile 390px พร้อมตรวจภาพ
- Schema export, browser-script syntax และ `git diff --check` ผ่าน ผลและข้อจำกัดแต่ละระยะอยู่ใน
  [scripts/README.md](../../scripts/README.md) ไม่มีหลักฐาน live DB หรือ live gateway จาก mock เหล่านี้
- Local logs/screenshots อยู่ใน ignored `.test-output/`; ไม่รวม credentials, environment files,
  database dumps หรือผลทดสอบชั่วคราวใน commit การเพิ่ม log รอบนี้เป็น documentation-only
- รอบส่งมอบรันซ้ำเฉพาะ `node scripts/run-contract-tests.mjs pure net-profit`: ผ่าน 26/26,
  staged diff whitespace check ผ่าน และไม่พบ excluded paths/secret patterns ที่ตรวจ
  ไม่ได้รัน full gate/browser smoke ซ้ำหลังเพิ่ม log; ผล full gate ด้านบนเป็นของ final code เดิม
- ผู้ใช้ขอ commit/push งานค้างทั้งหมดบน `codex/restaurant-costing-foundation`; ตรวจผล Git
  หลังดำเนินการแยกต่างหาก ข้อความนี้ไม่ใช่หลักฐานว่า push สำเร็จหรือ deploy แล้ว

#### D. Local Docker DB follow-up (2026-10-15)

ผู้ใช้อนุญาตให้แก้ test cleanup และทดสอบระยะ 1–9 กับ DB จริงแล้ว ใช้สำเนาจาก local Docker
บน PostgreSQL แยกที่ `127.0.0.1:5433/bms_realtime_test` พร้อม Redis ทดสอบแยก ข้อมูลฐานต้นฉบับ
ไม่ถูกแก้ไข รายละเอียดคำสั่งและ coverage matrix อยู่ใน
[scripts/README.md — Restaurant phases 1–9](../../scripts/README.md#restaurant-phases-1–9-real-db-follow-up-2026-10-15).

- แก้ cleanup สูตรให้ลบความสัมพันธ์สูตรย่อย/สูตร/สินค้าก่อนลบร้าน โดยจำกัดด้วย UUID fixture
- เพิ่ม `restaurant-costing-db-contract.test.mts` สำหรับ SQL จริงของระยะ 2–9 รวมสิทธิ์/tenant/
  สาขา, concurrent writes, retry, stale evidence, audit rollback และ serializable source reads
- เพิ่ม migration contract ตรวจติดตั้ง 10.61–10.66 ครั้งแรกและรันซ้ำภายใน transaction ที่ rollback
  บนฐานสำเนา ตรวจ RLS/grants/FK/trigger ร่วมกับ service tests; ไม่แก้ migration ที่ใช้ไปแล้ว
- ระยะ 1 ใช้ DB suites เดิมของ recipe versioning, restaurant POS และ kitchen station ร่วมกัน
- ผลคืนจริงยืนยันว่ามีทั้ง frozen return VAT และใบลดหนี้ กำไร/รายรับสุทธิยังต้องเป็น unknown
  เมื่อมี tax adjustments ที่ยังไม่กระทบยอด ไม่ทำให้ backlog MONEY-RECONCILE หรือ COST-RETURN ปิดลง

ผลรอบนี้: ชุดหลัก **99/99 ผ่าน ไม่มี skip** (recipe-versioning 5, restaurant-costing รวม migration
26, restaurant-pos 51, kitchen-station 17) และ strict TypeScript ของชุดเทสต์ใหม่ผ่าน
รอบแรก DB ทั้ง repository บนสำเนาที่ restore ใหม่ได้ **676 ผ่าน / 21 ไม่ผ่าน / 14 skipped**
จาก 70 ไฟล์ รวม 711 tests โดยเก็บ baseline ไว้ใน `.test-output/restaurant-phases-db/final-all/`
ต่อมาแก้ทั้ง 21 failures แล้วรันใหม่ได้ **710 ผ่าน / 0 ไม่ผ่าน / 14 skipped** จาก 70 ไฟล์ รวม
724 tests (nested tests ที่เคยถูกบล็อกได้รัน และเพิ่ม array regression หนึ่งเคส) ทั้ง 14 เคสที่ข้าม
ได้รันผ่านบนฐานเฉพาะครบแล้ว รวม gift schema ปัจจุบัน/ก่อน migration, answer evidence และ installer
ผลล่าสุดอยู่ใน `.test-output/db-green/` พร้อม `verification.json` ตรวจชื่อเคสที่ครอบคลุม
รายละเอียดการแก้และผลตรวจอื่นอยู่ใน [scripts README](../../scripts/README.md#all-db-failure-fixes-and-rerun-2026-10-15)
ตรวจ schema readiness ในรอบก่อนหน้าผ่าน และ cleanup ไม่เหลือร้าน costing/recipe fixture หรือ audit-failure functions

ยังไม่ถือว่าผ่าน production rollout: ต้องประเมิน query plans/latency ด้วยปริมาณข้อมูลเป้าหมาย,
20,000-event cap, historical/legacy coverage ที่เกิน fixture และ live browser/gateway แยกต่างหาก
ผล DB tests ไม่ได้ทำให้ feature backlog ในหัวข้อ A เสร็จอัตโนมัติ

**Phase 9: recorded monthly net profit (before income tax).** Reports > Open recorded net profit
combines phase-7 events and phase-4 reviewed expenses with phase-8 current allocations, on one
serializable tenant snapshot. One full monthly sales scan supplies both profit and allocation drivers.
Requires report.view + expense.view + delivery.settlement.view + tax.document.view and unrestricted
branch access. Only month (20xx YYYY-MM) is accepted; tenant/actor derive from auth. No mutation,
new table, migration, export, AI tool, mobile or realtime event is added.

Revenue is saved sale net + shipping - saved VAT + signed rounding, less accepted returns' frozen
ex-VAT amount + signed rounding. Extras are already inside sale net; order discounts are already
applied. Return VAT is management allocation from SALE buckets, not an issued credit note or VAT
filing. Sale/return events use their own Bangkok dates; returns follow the receiving branch, including
cross-month/cross-branch returns. Completed cash/noncash refunds and CREDIT reductions are shown as
separate diagnostics and are never subtracted again. Unallocated payment refunds, back-office returns
and tax adjustments block full revenue instead of guessing a linkage or double-counting a credit note.

Cost uses only CATALOG_AT_SALE snapshots. Legacy reconstructed/current/missing cost is unknown, not
zero. This is **not actual purchase-lot valuation**. Return quantity cost basis remains diagnostic:
without authoritative cost-reversal evidence, any return leaves net COGS/profit unknown. Do not assume
a refund restocks cooked food or treat reservation release as valued stock recovery. Supplemental
reads detect blind returns and unvalued WASTAGE/TRANSFER_LOST/COUNT_ADJUST/manual STOCK_OUT events;
these block full profit rather than treating loss as zero or guessing current catalog values.

Net profit = net revenue - historical net COGS - reviewed OPERATING - GP - monthly management
DEPRECIATION. Signed credits preserve cents. No inventory purchases, drawer movement duplicates,
recipe labor/energy estimates or allocation copy is deducted twice. Whole-tenant expenses use
recognized source totals once, even before allocation; branch/channel results require complete,
current allocations. Branch-wide cost buckets count once in the branch total and are not channel
subtotals: nonzero unallocated shared cost blocks channel profit, never implicitly spreads it.
Expense-only branches/channels are retained. Unknown evidence yields null full totals and labelled
known subtotals; samples cap at 100, supplemental gaps at 1,000 + probe. Truncation never means zero.

COMPLETE means **loaded evidence reconciles**, not proof all bookkeeping is entered or an audited
statutory profit. Income tax is not calculated; management depreciation and current THB-profile
checks retain their existing limitations. Returns with unverified cost reversal, unvalued inventory
adjustments, unlinked tax notes and legacy evidence remain data-model reconciliation gaps even after
DB testing; they are not falsely presented as merely waiting for a DB test. The old phase-7 nullable
net fields, gross-profit dashboard and exports retain their original behavior.

The worksheet has an independent month and read-only refresh. Changing month unmounts the old query,
late responses cannot replace the new month, and loading/error hides stale totals. No browser-side
authoritative arithmetic. DB work remains deferred: existing source migrations through 10.66,
source grants/RLS, snapshot isolation, concurrent source/review changes and bounded-query plans.

Phase 7 adds the **sales evidence read foundation**, not the phase-9 net-profit report or a new
operator screen. `salesEvidence.ts` / `salesEvidenceMath.ts` and `bmsSalesEvidence` read existing
order/item snapshots, extras, POS returns, completed refund allocations, standalone refunded
payments, back-office returns and tax notes. The original profit/dashboard/export implementations
stay unchanged. The phase-7 completion adds return evidence capture described below; refund pricing,
stock and tax-document behavior are unchanged. No current recipe or product cost enters this read.
Future P&L/menu readers can reuse `scanSalesEvidence` with a synchronous, side-effect-free server
consumer; the summary uses this same stream. Consumers and cursors are never API inputs, and a
failed consumer aborts the read transaction rather than returning a partial successful report.

The query requires report.view + tax.document.view; tenant/actor come from the authenticated server
context. Branch permissions are resolved inside the same serializable tenant transaction. An omitted
branch filter means the actor's allowed branches, not all branches; explicit inaccessible/nonexistent
branches are denied. Sales belong to the sale branch; POS return/refund evidence belongs to the
receiving branch. Channel means the order's original channel, not payment method or fulfilment mode.
There is no implicit restaurant-only filter: the foundation covers all order channels for reuse.

Dates are inclusive Bangkok calendar dates (up to 366 days). Sales use paid_at, with a flagged
created_at fallback; returns use acceptance created_at, completed allocations use completed_at,
standalone refunds use refunded_at with a flagged fallback, and tax notes use issued_at (NOT the
statutory tax-report issue_date basis). Paid sales remain visible even after cancellation/void,
paired with their separately visible return/refund facts. Cancelled paid orders without a POS return
are explicitly reconciliation-required. This deliberately differs from a netted shift
report. No refund completion is subtracted a second time from a return claim. CREDIT allocations
are receivable reductions, separately totalled from completed cash/provider refunds. Pending refunds
are not completed money. Unallocated standalone refunds/back-office returns and tax notes are
explicit unresolved evidence, not inferred menu-level revenue adjustments.

Money is returned as exact decimal strings after BigInt satang arithmetic. saleNet is the recorded
order total excluding shipping/rounding; saleGross is that header total plus order discount (already
after product promotions). Product lines use line_amount, never unit_price multiplied by quantity.
The internal proportional order-discount attribution conserves cents, excludes extras, and is
labelled DERIVED_PROPORTIONAL_NOT_POSTED; it is not an immutable historical per-line allocation.
Pre-promotion discounts, individual VAT allocations and missing historical snapshots are not
reconstructed. VAT/ex-VAT known subtotals accept only order tax buckets that reconcile to the order
total plus shipping; default-zero unmatched buckets are unknown. Explicit zero cost, missing cost,
CATALOG_AT_SALE and LEGACY_CURRENT remain distinct. Catalog snapshots are not purchase-lot COGS.
The current store currency must explicitly be THB; absent/non-THB settings require review. This
guard does not certify historical currency, which orders do not snapshot; the API labels that basis.

Return cost is a separately labelled quantity-proportional basis, cumulatively rounded using all
prior return quantities (including outside the selected period). It is NOT proof of ingredient
restocking or an authoritative COGS reversal; online reservation releases are called out separately.
New POS returns carry the immutable financial snapshot below; older return claims can still include
unallocated shipping/rounding and must remain explicitly unknown.
Consequently netRevenue/netCost/netProfit are null by design, including on otherwise complete reads.
COMPLETE only describes the selected evidence read, never complete bookkeeping or net profit.
The later profit/menu integrations must resolve these explicit source gaps, not turn known subtotals
into full totals. Historical gaps are never backfilled from current settings.

**Phase-7 completion (`10.65`): return financial snapshots.** `processPosReturn()` inserts a v1
`bms_pos_returns.financial_snapshot` in the same tenant transaction as the return, items, stock,
refund allocations and audit, after the existing order lock and approval checks. It covers partial,
full, cross-branch, void and restaurant online line cancellation through the shared engine. This is
automatic evidence capture, not a new operator workflow or a change to refund entitlement. Snapshot
failure rolls back with the return. Idempotent retries reuse history without writing/recomputing it.
Settlement completion never changes the snapshot; a DB trigger rejects snapshot updates, including
NULL-to-value backfills. Legacy NULL means unknown.

The snapshot stores exact decimal amounts, source order tax buckets/auxiliaries, the returned line
ids/amounts/VAT classifications, a versioned allocation policy, components and explicit gap reasons.
For exact sale-time pricing, shipping, extras and signed cash rounding remain until the final return,
matching the existing remaining-basket calculation. For legacy proportional pricing they follow a
cumulative refund proportion, conserving every source cent across successive returns. Merchandise
gross is the residual. Identity: claim = merchandiseGross + extrasGross + shippingGross + rounding.
Rounding may be negative and is outside the VAT base; it is not a discount or shipping charge.

VAT is explicitly `SALE_BUCKET_CUMULATIVE_ALLOCATION_V1`, **not the issued credit-note VAT**. Partial
mixed-VAT attribution uses frozen returned-line classifications and separates auxiliaries; the final
return consumes remaining sale tax buckets. VAT is cumulatively rounded against the original saved
VAT/taxable amounts, preserving the sale's final VAT cents rather than applying today's VAT settings.
Identity: claim - rounding = taxableGross + exemptGross = exVat + vat. VAT is embedded in merchandise/
extras/shipping gross and must NOT be added to them again. Missing/unreconciled sale buckets, mixed
bucket overflow, unknown VAT classification, source/policy changes, legacy prior returns, mismatched
history or the 1,000-prior-return cap remain unknown with reasons, not zero. Components can be known
while VAT is unknown. Allocation is not a statutory calculation or a claim that a credit note exists.
Credit notes still issue after commit and may fail independently; void still cancels tax documents.
The report marks allocated VAT as reconciliation-required and leaves tax notes separately visible.

The evidence API exposes known component subtotals and separately named allocated VAT/ex-VAT totals.
It validates the stored JSON, amount and exact return-line identities before counting them; malformed
snapshots remain diagnostic gaps. No claim or payment is subtracted twice, and no net-profit formula
is activated. Back-office/non-POS returns, blind returns without an original sale, generic payment
refunds and provider-managed returns do not acquire invented line snapshots through this change.

Identity-paged reads aggregate on the server in one transaction, never reuse a truncated top-sellers
list. Pages are 100 events; 20,000 events plus one probe, 1,000 lines per header plus one probe, and a
30-second scan budget bound work. A cap yields INCOMPLETE with a limit reason and partial known totals;
a SQL timeout/failure is an error, never a zero report. Diagnostic samples are capped at 100, while
issue counts and grouped totals include all loaded events. Source ids in diagnostics have no PII.
The original round deferred DB verification; the local Docker follow-up in section D now exercises
real source SQL, RLS/grants, serializable reads, first/repeated migration application, immutable
snapshots, concurrent retries, audit rollback and mixed VAT/extras/rounding with real POS credit notes.
There is no new AI tool, realtime event or client workflow. Apply `10.65` before deploying the return
writer and reader; schema readiness includes the mandatory column. Production-scale query plans,
the 20,000-event cap and wider legacy evidence still need separate rollout verification.

Phase 6 adds read-only promotion/menu planning from the Recipes card in Stock models. Permissions
remain product.view + report.view. Select 2–12 unique recipe UUIDs and unique labels; current cost
comes only from the tenant-scoped estimator. Reads are bounded and sequential, with an observation
timestamp per recipe, not an atomic multi-recipe snapshot. Missing/foreign ids reject the whole preview.
No new table, migration, AI tool, provider, financial query, POS/mobile flow or promotion mutation.

This is an explicit planning worksheet, **not automatic historical-sales Menu Engineering**. Staff
must supply comparable daily quantities (including explicit zero-demand menus), realized prices,
VAT/GP assumptions and a dated branch/channel/population/source note. Blank quantity is unknown.
No existing top-seller query is reused as a complete population: those queries truncate and do not
provide the line/refund allocation needed for a historical menu-margin report. That integration,
actual promotion activation, modifiers, capacity and cannibalization analysis remain outside this increment.

Popularity threshold = 70% / number of selected menus. Contribution threshold = sum(unit contribution
in cents × assumed units) / total units. Equality counts as high; classify STAR (high/high), PLOWHORSE
(high/low), PUZZLE (low/high), DOG (low/low). All groups are UNCLASSIFIED if any recipe cost or demand
is unknown, or total demand is zero. Negative contributions remain negative; a relative STAR is not
proof of positive profit. Zero-demand menus still count in the population. Classifications use the
exact weighted fraction; threshold display truncates to satang. Menu-mix totals multiply displayed
unit contributions (satang), then deduct shared daily fixed cost once. Unknown fixed cost leaves
projected profit null but does not prevent classification. Totals include only individual menus.

An optional bundle selects 1–12 distinct members of that menu population, each 1–1,000 integer output
base units (including gifts), with its own final price/VAT/GP/extras/demand/target-margin assumptions.
Recipe cost is summed from server unit costs × quantities. Individual-menu extras stay in the
individual-sale baseline; bundle extras must be entered once for the entire bundle. Compare the same
quantities' tax-inclusive individual payment and contribution with bundle payment/contribution.
Negative savings means a more expensive bundle. Missing member costs leave bundle contribution and
targets unknown, but known payment comparisons remain visible. A known subset can still be simulated
when other menu costs are unknown. Bundle demand/profit is an independent alternative, never added
to menu-mix totals. Reuse phase-5 exact rational targets, including null targets for non-positive
contribution. No assumed sales volume is presented as evidence of demand or achievable capacity.

Forms are ephemeral, no-cache, disabled during calculation and clear results on edits. Recipe-version
selectors inherit the parent Form disabled context (never override it with an explicit false after
selecting a product). Request revisions and a captured form-value fingerprint reject stale successes
and errors after edits or newer calculations; an old request cannot unlock a newer pending request.
Closing the modal invalidates callbacks. Programmatic form changes are checked even when they bypass
onValuesChange. Existing
recipe source SQL/RLS and migration prerequisites still require DB verification later; pure contracts
and mocked browser tests cannot certify them. Phase-6 calculations never rewrite prior sale snapshots.

Phase 5 adds read-only price/break-even previews from expanded recipe rows in Stock models, with
product.view + report.view. Reuse one tenant-scoped current complete recipe estimate per request
(inactive versions supported). Up to 12 named scenarios are alternatives assuming only this recipe
output base unit is sold, not a weighted menu mix or shop-wide forecast. No persistence, migration,
AI/provider calls or changes to actual pricing, bill snapshots, stock, financial reports or ledgers.

Inputs: final realized price after discounts, VAT NONE/INCLUSIVE/EXCLUSIVE and explicit rate, GP rate
and NET_REVENUE/CUSTOMER_TOTAL base, extra variable cost, optional expected daily units and target
contribution margin. Common daily fixed cost may be unknown (blank); zero is explicit. Daily target
profit and a source/date/allocation note are required. These are staff assumptions, not verified
tax/provider settings. Include unrecoverable fee tax/packaging in extra cost. No modifier, pack,
promotion, refund, tax-recovery, income-tax, minimum/tier fee or capacity model is implied.

Contribution = revenue before output VAT − GP − complete recipe unit cost − extra variable cost.
Recipe cost already includes labor/energy and is rounded to cents; do not add these again to fixed
cost. Phase-4 monthly totals are deliberately not imported/divided automatically. Positive contribution
yields ceil(fixed/contribution) break-even units and ceil((fixed + target profit)/contribution) target
units. Daily profit = expected units × contribution − fixed. GP/VAT use exact rational arithmetic
until display; targets use unrounded contribution, including tiny positives displayed as 0.00.
Minimum price for target contribution margin uses the same VAT/GP factors and rounds UP to cents,
at least 0.01 because margin is undefined at zero revenue. Impossible combinations yield UNREACHABLE.

Missing recipe cost gives unknown contribution/targets; missing fixed cost gives unknown daily
targets/profit. Non-positive contribution suppresses sales targets, including the degenerate zero
fixed-cost/zero-contribution case (not a claim that its arithmetic balance is impossible).
Rounded display rows may not sum. Money inputs max 1 billion THB with two decimals;
rates 0–100%, target margin 0–99.99%, expected daily units integer 0–1 million; labels unique, at most
60 characters; source note 1–500. NONE with nonzero VAT is rejected. No tax rate is auto-selected.
Inputs are ephemeral; editing hides old results and failed previews never show stale results.
Existing 10.63 recipe evidence is required; real source reads are now covered by the section-D Docker DB follow-up.
Stocked-preparation production is separate. Catalog estimates, order-creation cost snapshots and
period expenses must remain distinct; missing evidence is unknown, not zero. Nothing here changes
the existing profit report or claims purchase-lot actual COGS, and no historical costs are backfilled.

Modifiers apply integer positive or negative component deltas, but the resolved total for any
component may never be negative. Completed POS recipe lines create idempotent kitchen tickets **when
the shop has `KITCHEN_WORKFLOW` on** — a shop that uses recipes only to deduct ingredients would
otherwise accumulate tickets no page shows and nobody can clear. The sidebar entry for the board
follows the same flag, so the menu and the tickets always appear together. A ticket may still carry
no station: the board has an "unassigned" lane, and an empty board reads as a broken feature.
Wastage is a separate tenant/location ledger and moves only unreserved stock, recording inventory,
movement, audit **and lot** rows in one transaction. The lot step is not optional bookkeeping:
`SUM(bms_inventory_lots.qty) = bms_inventory.current_stock` is enforced only by every write going
through `lots.ts`, and throwing away expired goods is the main way lot-tracked stock leaves a shelf.
Moving the summary row alone left the expired lot holding the quantity that was just binned, so FEFO
offered it again on the next bill and `reconcileLotTotals()` reported drift with nothing to trace it
to. A write-off consumes the soonest-expiring lot **first and does not skip expired ones** — the
opposite of the sale path, because the expired unit is exactly the one being discarded — and a shop
whose lot rows are short of the summary row is refused outright rather than half-applied.

Cancelling or voiding a bill closes that bill's open kitchen tickets in the same transaction, and
the board itself shows open work plus the last 12 hours of served tickets, newest first when the row
cap bites. Both exist for the same reason: a ticket that outlives its bill, or a cap that hands a
busy kitchen its 200 oldest served tickets forever, reads at the pass as "the register stopped
sending orders".

Scale mapping (`9.41`) supports EAN-13 prefix `22`: five item-code digits map to exactly one
`WEIGHTED`/`GRAM` product variant and the embedded grams are re-parsed by the server both at scan and
sale commit. Prefix `21` price-embedded labels remain refused because reversing a rounded price into
stock quantity can silently move the wrong amount.

## Phase 1 inventory intelligence (9.12)

`getInventoryActionCenter()` combines paid-order velocity, current available stock, recorded lost
sales/restock requests (including active `bms_restock_subscriptions`), quantities still incoming on
open POs, and per-variant safety-stock/lead-time
policy. It returns demand trend, stock-out horizon and a review-only reorder quantity. A recommendation
never creates or changes a PO.

Forecast-driven labels and purchase quantities require at least seven paid orders across three
distinct Bangkok sales days in the selected window. A new shop below that floor receives
`INSUFFICIENT_DATA` / `COLLECT_MORE_DATA`, an empty forecast recommendation, and the observed sample
counts—not a confident stock-out date. Current low/out-of-stock and expiry facts remain visible
because they do not depend on historical demand.

Variants with no observed demand and positive stock are `DEAD`; variants holding more than roughly
three recent demand windows are `SLOW`. Those labels lead to discontinue/bundle or
markdown/transfer/bundle actions. They are operational heuristics, not accounting valuation. Lots
expiring within 60 days are sorted FEFO and receive block/dispose, markdown/transfer, or FEFO-priority
actions according to days remaining. Staff must reconcile lot totals to inventory before relying on
expiry quantities.

`bms_inventory_demand_events` is append-only feedback for demand the order ledger cannot see. Record
only a customer-observed lost sale or restock request; guesses inflate purchasing recommendations.
`bms_inventory_policies` defaults to seven safety-stock days and seven lead-time days until a manager
sets a variant-specific policy.

### Branch-aware inventory copilot (10.99)

`inventoryIntelligence.ts` is now the common read model for Dashboard and staff AI tools. Every row
is keyed by `(tenant, location, SKU, size)`. Demand velocity comes from
`bms_order_stock_lines`, not catalog items, and usable stock comes from the shared lot-quality rule.
An optional row in `bms_inventory_location_policies` overrides the tenant-wide policy for one branch.
Demand and open PO quantities that have no verified branch allocation remain in separate
`unallocatedDemand` / `unallocatedIncoming` lists; they are never copied into every branch.

The Dashboard and assistant expose deterministic reservation/lot reconciliation, stale transfer/PO,
repeated count adjustment, wastage/loss and missing-policy signals. These are review signals, not a
fraud verdict, and never adjust inventory. Transfer suggestions only use donor stock above that
branch's safety and coverage target. Creating a PO or draft transfer through the assistant is
propose-only, uses a stable idempotency key, and still requires the shared human confirmation UI.
Receiving a PO is deliberately not an AI tool.

The daily `inventory-intelligence-maintenance` job records bounded forecast evidence and evaluates a
matured snapshot against later verified stock demand. MAE, WAPE and bias are reported with sample
count. Forecast rows are evidence only: they never create a PO, transfer stock, alter a policy or
change an action automatically.

Missing product cost is not zero cost. Profit output is incomplete (`cost`, `profit`, and margin are
`null`) whenever any sold SKU lacks `cost_price`, while known-cost and missing-line/SKU counts remain
visible for repair. Action Center separately flags missing costs and zero prices. Zero price remains
allowed for an intentional giveaway; the signal requires human review instead of guessing intent.

## Scale barcodes: weight and price embedded (8.8)

Scales with a label printer — vegetables, meat, anything sold loose — print an EAN-13 with the weight
or the price embedded in the digits, and the counter has to decode it.

`parseScaleBarcode()` reads two forms:

```
21 + item code (5) + price in satang (5) + check digit
22 + item code (5) + weight in grams (5) + check digit
```

Prefix `20` stays reserved for the codes the generate button issues (piece goods). Sharing a prefix
would mean a piece-goods barcode getting decoded as a weight and priced wrongly.

**The format is whatever the shop's scale is configured to print, not a world standard.** Guessing
would mean charging the wrong amount every time while everything looks normal, so the convention above
is stated and the shop must set its scale to match. A code whose check digit fails is not decoded at
all — reading a corrupted weight and charging from it is worse than refusing.

**Not yet wired into the sale path.** Decoding is only half the feature: a weight-embedded sale needs
the product's base unit to be grams, and a price-embedded sale means the counter supplies an amount —
which the server would have to re-derive from the barcode at commit, or the register would be deciding
prices. That contradicts the invariant the whole POS is built on, so the parser and its tests ship now
and the sale path stays untouched until the re-derivation is built.


### Completed restaurant costing workflow — 10.67–10.69

The 15 items in the reference checklist now have operator workflows: ingredient and supplier records;
central catalog cost updates; Single/Batch recipes, pinned subrecipes/BOM and SOP; labour/gas/electric
assumptions; reviewed rent/depreciation; price/VAT/GP scenarios, retail/pack prices, promotion comparisons
and daily break-even targets; and menu engineering. Actual-cost and publishing additions are below.

- **Actual valuation:** moving weighted average per SKU/variant/branch, using authoritative PO item
  cost on receipt. Review unknown opening inventory at Reports > Actual costs and menu engineering,
  with evidence, current quantity/version and explicit confirmation. It never rewrites old sales.
- **Sales/returns/transfers:** cost is frozen with the physical movement in the business transaction.
  Returns carry original consumed value and cumulative partial-return allocation conserves cents.
  Transfers carry value to the destination; quarantine is separate, losses/wastage and reviewed count
  differences affect management cost. Unknown receipt/opening value remains unknown, not catalog cost.
- **Actual menu engineering:** posted sale/return units, merchandise revenue net of allocated VAT and
  actual material cost; no demand assumptions. A missing valuation or unresolved financial event blocks
  classification. STAR/PLOWHORSE/PUZZLE/DOG use 70% of equal share and weighted unit contribution.
  This is material contribution, not per-menu net profit after shared operating costs.
- **Publish:** calculate a recipe price scenario, choose unit price, same-menu pack or N-for-price,
  preview, then confirm. Requires product.edit + report.view and access to the affected branch (all-branch access for global prices); VAT must match the
  store. Shared pack/promotion writers, immutable publication record and audit commit together.
  Retries reuse the request id; stale recipe/cost/price/promotion observations are rejected. Base/pack changes can target a branch (10.71); without a branch they affect all branches/channels immediately. N-for-price rules can select a branch, sales surface and start/end time; existing quantity tiers/promotions can still alter final checkout pricing.
  Mixed-menu comparisons have a separate reviewed publication workflow (10.72) that creates a sellable pinned recipe and ingredient BOM.

**Evidence boundary:** existing unvalued sales are not retroactively assigned current prices.
Unknown opening stock needs an authorized evidence-backed review. Cash refunds and uniquely linked,
validated POS credit notes are not deducted twice. Unlinked tax adjustments, blind returns and legacy
back-office returns remain explicit reconciliation gaps. No statutory P&L/tax certification is claimed.

Verification: `restaurant-actual-costs-db-contract.test.mts` covers opening audit rollback, tenant
isolation, concurrent purchases, frozen sale cost, partial-return rounding/replay, transfer loss,
wastage, menu results, publication/VAT/stale confirmation, shared pricing, and migration reapplication.

Price publication requires VAT-inclusive checkout for registered stores (non-registered/exempt
prices remain untaxed). Exclusive what-if prices convert to inclusive selling prices before human
confirmation. A legacy VAT-exclusive checkout configuration is rejected instead of publishing a
price that its current settlement engine would collect incorrectly. The what-if calculator still
supports both VAT price modes.

### Costing completeness follow-up — 10.70

- Opening valuation uses server-side literal SKU/variant search and offset/limit pagination (50 rows in
  the UI, up to 1,000 per API page); there is no 1,000-row reachability limit. Read/review stays branch
  authorized. A page is an observation; quantity/version are checked again when confirming a value.
- Recipe, price and menu planners expose an explicit catalog or branch moving-average basis. The
  latter requires an authorized branch, positive valued stock and a valuation quantity matching the
  physical balance. Unknown opening stock never falls back to catalog cost. Labour/utilities remain
  declared assumptions. Publication recomputes the selected basis and rejects stale costs.
- Actual Menu Engineering includes active recipes with zero sales plus recorded sold items, including
  discontinued items. An optional SKU population filters the comparison. Zero-unit rows show NO_SALES
  without poisoning sold-menu classification; net negative quantities show NET_RETURNS. Material
  contribution is not full per-menu net profit. Unknown cost or unreconciled financial evidence still
  blocks a complete comparison. The scan cap of 20,000 events/population rows is explicit.
- N_FOR_PRICE can target a variant, branch, RETAIL_POS / RESTAURANT_POS / ONLINE_ORDER surface and time
  window. One-unit rules support scoped unit-price offers; 10.71 also adds branch base/pack overrides. The shared web,
  native and settlement pricing paths filter variant eligibility before applying quantity tiers.
  A promotion never raises the normal price. 10.71 allows successive non-overlapping windows per SKU/branch: future publication retains the
  current rule until activation. Preview includes existing rules and the selected scope. A rule is not an additional independently stacked discount.
- VAT-exclusive scenario input is converted to the VAT-inclusive customer price before confirmation;
  a legacy store configured for VAT-exclusive checkout must be reviewed in Tax settings first. No
  store tax flag or existing price is silently rewritten. Mixed-menu bundle comparisons require a separate explicit preview/confirm to publish a sellable recipe SKU (10.72).

### Operating completion — 10.71–10.72

- At price publication, choose all branches or one authorized branch for BASE/PACK. Branch overrides
  use the catalog variant and existing named-pack definition; quantity and barcode stay shared. A base
  override also works before a BASE pack row exists. Recipe menu prices and filters use serving variants
  even when only ingredients own stock. Both higher and lower
  branch prices are supported. Scan, available pack choices, catalog filtering and settlement resolve
  the same override; sale snapshots preserve returns after later price edits. Tiers/promotions still
  apply through existing pricing rules.
- Future promotions are separate rows. Their intervals are `[start,end)`, with database exclusion
  enforcing no overlap for one SKU/branch. A new window closes its predecessor at the activation
  boundary, not at save time, and inherits the next start as its end when omitted. An explicit end
  crossing the next window is rejected. Current edits retain future windows. Cancellation disables
  the selected row; it does not silently extend a prior offer. Legacy pre-10.41 schema behavior is
  retained for the dedicated migration compatibility test.
- Reports > Actual costs > Net profit by menu uses the full monthly menu population for the selected
  scope. Preview an explicit positive-net-revenue, positive-net-unit or equal allocation, with a
  rationale, then confirm. Revenue, actual material costs, operating expense, GP, depreciation and
  stock adjustments are displayed separately. Each allocation conserves cents. Non-menu revenue
  (including shipping/rounding) is shown as its own reconciliation bucket: menu profit plus that bucket
  equals the existing recorded net-profit report. Unknown opening costs/financial sources remain
  unknown. Changed source evidence hides stale confirmed totals until reconfirmed. This is monthly
  management profit before income tax, not a statutory statement. Read permissions mirror net profit;
  confirmation additionally requires expense.manage. All-branch authority is required to read the
  complete source ledger even when displaying a branch.
- From a calculated multi-menu bundle, choose Publish menu bundle; enter a new SKU/name, reviewed
  bundle tax category, sales surfaces and kitchen station. Review price and the flattened ingredient
  BOM and confirm. The shared catalog, pinned-recipe and readiness services create and activate a
  RECIPE product atomically, without stock fabrication. Ingredient consumption uses normal recipe
  sale/return handling. Child assumptions are combined by output quantity with weighted rates;
  historical actual costs still come exclusively from inventory evidence. Tax category is explicitly
  reviewed for the sold bundle rather than inferred from component taxes. Conflicts, missing costs,
  fractional base-unit BOMs, stale review or failed audit publish nothing. Replays create no duplicates.
  Requires product.edit + product.delete (activation permission) + report.view and all-branch access.

## Platform unit mapping (`10.76`)

Each product pack may optionally reference a UN/ECE Recommendation 20 `unit_code` from
`bms_master_units`. `unit_name` remains the tenant-owned receipt/display snapshot. New sales freeze
the selected code on the order item for e-Tax; changing or retiring a master unit never rewrites an
old bill. Missing mappings are warnings on POS readiness, not sale blockers.
