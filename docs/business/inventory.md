# Inventory & Purchase

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_inventory`, `bms_stock_movements`, `bms_purchase_orders` ([../architecture/database.md](../architecture/database.md))

Inventory is the source of truth. Never update stock directly — always go through the Inventory
Service (`lib/bms/stock.ts`, `lib/bms/movements.ts`).

```
Current Stock = Available Stock + Reserved Stock
Available Stock = Current Stock − Reserved Stock
```

Every stock change **must** generate a Stock Movement record. Never update inventory without
logging movement.

## Movement types (`bms_stock_movements.type`)

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
| `COUNT_ADJUST` | Variance accepted from a stock count apply |

`TRANSFER` is no longer a roadmap placeholder: `7.98` split it into `TRANSFER_OUT` and
`TRANSFER_IN` so branch-to-branch movement is not misread as stock leaving or entering the company.
Generic manual adjustments still record as plain `STOCK_IN`/`STOCK_OUT`; `DAMAGED` remains a future
reporting-specific type rather than a live schema value today.

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
- Both modes share one validator, `validateProductFields()` (extracted out of `upsertProduct` for
  this purpose), so preview and commit can never drift apart.

**Rules enforced by `lib/bms/productImport.ts` (`runImport()`):**

- **Row limit**: 500 rows per import (`PRODUCT_IMPORT_MAX_ROWS`), enforced both client-side (before
  ever calling the mutation) and again in the resolver (defense in depth against a direct GraphQL
  call). A 5MB file-size gate on the client protects against parsing a huge file before the row
  count can even be checked.
- **Images are never imported.** The template has no image column; if a hand-edited file includes
  one anyway it is silently ignored rather than rejecting the whole file. Add images afterward from
  the normal product edit form.
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
`ต้นทุน` / `หมวดหมู่` / `ยี่ห้อ` / `คีย์เวิร์ด` (`|` or `,` separated) / `เปิดขาย` (`TRUE`/`FALSE`,
blank defaults to `true`). `SKU`/`ชื่อสินค้า`/`ราคาขาย` are required; if any is missing from the
header row the whole file is rejected up front with a message to re-download the template.

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
credit one lot twice. The stock movement ledger records `RETURN` with the POS order reference. See
[pos.md](pos.md) for the counter workflow and opening checklist.


## Multiple branches: transfers and counts (7.98)

`7.84` gave every inventory row a `location_id`, but nothing could act on more than the default
branch. `adjustStock()` resolved the default location and ignored its caller, so a two-branch shop
could not correct the second branch's numbers at all — while its POS registers happily sold from it.
`adjustStock()` now takes an optional `locationId` (omitted still means the default branch, so
existing callers are unchanged) and verifies the branch belongs to the shop before touching a row.

### Transfers are two steps

`bms_stock_transfers` moves goods branch to branch as **send** then **receive**. Stock leaves the
source when it is sent and arrives at the destination when it is received; in between it belongs to
no branch at all. That is not an accounting nicety — it is what makes a stock count at the source
branch correct while the van is still moving.

A send refuses to move more than the unreserved quantity: goods a customer already has on order at
that branch must not be shipped elsewhere. A receive may record less than was sent (broken, lost,
miscounted at packing); the shortfall gets its own `STOCK_OUT` movement at the source, noted as lost
in transit, rather than evaporating into the difference between two branch totals. Cancelling is
only possible before sending — once goods are off the shelf, the transfer has to be closed by
receiving it.

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

### Why this module is REST, not GraphQL

Every other BMS module exposes its writes through GraphQL. These two do not, on purpose:
`/api/bms/inventory/transfers` and `/api/bms/inventory/counts` are plain REST routes authorised by
`authorizeAdminRoute()`, which performs the same session check, drill-down tenant resolution, and
`requirePermission()` call the resolvers use.

The reason is the counting workflow. A shelf count is one short request per scanned line, hundreds
of times, from a handheld browser on shop wifi; a single-purpose REST endpoint keeps that loop
small and lets the route return the snapshot and variance for that one line without a round trip
through the schema. Nothing about the module needs a client-composed query — both screens want the
whole list every time.

The cost is real and worth naming: these mutations are invisible to anything that consumes the
GraphQL schema, including the AI tool catalogue. If a tool ever needs to move stock between
branches, it needs a validated wrapper in `lib/bms/tools/catalog.ts`, not necessarily a GraphQL
mutation. That wrapper must derive the tenant from `ExecCtx`, enforce `inventory.transfer`, keep the
service's in-transaction audit, and propose the movement for human confirmation rather than execute
it immediately. Calling the REST route from a resolver or tool is not an acceptable shortcut.

### What lands in the audit log

Both files write to `bms_audit_log` **inside the same transaction as the stock movement**, matching
the convention `pos.ts` uses for `pos.sale`/`pos.return`:

| Action | Target | Notable meta |
| --- | --- | --- |
| `inventory.transfer.create` | transfer id | `transferNo`, both branches, `lines`, `units` |
| `inventory.transfer.send` | transfer id | `units` that left the source branch |
| `inventory.transfer.receive` | transfer id | `unitsSent`, `unitsReceived`, `unitsMissing` |
| `inventory.transfer.cancel` | transfer id | `transferNo` |
| `inventory.count.create` | count id | `countNo`, branch |
| `inventory.count.apply` | count id | `adjustedItems`, `varianceUnits` |
| `inventory.count.cancel` | count id | `countNo` |

Individual counted lines (`recordCountItem`) are deliberately **not** audited: one shelf produces
hundreds of them and they would bury everything else in the log. The reviewable fact is who accepted
the variance, which is the apply entry.

These routes have no GraphQL context, so they store `actor` as a raw `users.id` rather than the
email a resolver would have written. `listAudit()` resolves it back to an email on read, which also
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

**Not built: label printing.** A generated code is only useful once it is on the product, and there is
no label/sticker printing screen in this repo. Until there is, generate codes only where the shop has
another way to produce the label.
