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

Four separate places moved stock by reading `bms_order_items` directly: deduct at sale, restore on
return, release reservations on cancel, and FEFO lot consumption. Each of them joining the recipe
itself would be four pieces of code that must be equally correct and would drift apart.

`bms_order_stock_lines` is a view that does the expansion once — ordinary lines pass through, set lines
become their components × set quantity — and all four read from it. **Anything new that moves stock
must read the view, not the table.**

Two failures that view prevents, both silent:

- deducting from the set's own inventory row would drive it negative and hit
  `CHECK (current_stock >= 0)` in the middle of closing a bill
- moving inventory without consuming lots leaves lot totals and stock totals disagreeing until
  somebody reconciles — the ledger would say the set moved while inventory moved the components

The view carries `order_item_id` so lot provenance still links back to the line that was sold.

A set with no components is refused (`BUNDLE_INCOMPLETE`) rather than sold, because selling it means
nothing leaves the warehouse. A short component blocks the sale and the error names **the component**,
not the set — "the set is out of stock" tells staff nothing they can act on.

Migration `9.3` idempotently repairs the bundle table, RLS/grants, and expansion view for long-lived
deployments that received bundle-aware application code without migration `8.8`. Do not add a runtime
fallback to ordinary order lines: a register that appears to recover while deducting the set row
instead of its components would turn a visible schema error into silent inventory corruption.

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
