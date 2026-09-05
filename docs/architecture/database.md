# Database

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Architecture overview: [system.md](system.md)

All BMS tables are tenant-scoped (`tenant_id UUID`) and enforced by Postgres Row-Level Security
(RLS) — see `db/migrations/4.2__bms_rls.sql` / `4.3__bms_rls_role.sql`. Writes go through
`beginTenantTx()` (`lib/bms/tenant.ts`), which drops the connection to role `bms_app` and sets
`bms.tenant_id` so RLS applies even if a `WHERE tenant_id = ...` clause is ever missed.

Plain `pg_dump` backups made with `--no-owner` / `--no-privileges` do not include PostgreSQL
cluster roles or object grants. After restoring one, apply migrations through
`6.6__bms_rls_role_restore_hardening.sql`; it idempotently provisions `bms_app`, restores the
current BMS grants, and ensures the older tenant-owned channel/RBAC/audit tables have RLS enabled.
If the runtime database login is not named `app`, grant it membership in `bms_app` explicitly.

Migrations are plain numbered SQL files under `db/migrations/`, applied in order, and written to
be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `ALTER`s).
BMS-specific migrations start at `3.2`; anything before that belongs to the base platform template
this project was built on top of (users/sessions/messages/etc.) and is out of scope here.

The base-platform `users` table originally had case-sensitive unique constraints. Migration `7.75`
adds canonical lowercase/trim checks and unique indexes for both email and username. It aborts when
historical case-insensitive duplicates exist rather than merging security principals automatically;
operators must resolve those records before retrying the migration.

## Tables by module

| Module | Tables | Key migration |
| --- | --- | --- |
| Products & Inventory | `bms_products`, `bms_product_images`, `bms_inventory`, `bms_stock_movements`, `bms_product_categories`, `bms_product_bundle_items`, `bms_product_stock_policies`, `bms_product_recipes`, `bms_product_recipe_items`, `bms_product_modifiers`, `bms_product_modifier_items`, `bms_product_menu_unavailability`, `bms_order_item_stock_consumption`, `bms_inventory_wastage` (+ `bms_order_stock_lines` view) | `3.2`, `5.9`, `6.0`, `6.5`, `7.33` (AI discovery indexes), `8.8` (`9.3` repair), `9.40`–`9.41`, `9.55` |
| Orders | `bms_orders`, `bms_order_items` | `3.3`, `3.5`, `7.21` (discount columns), `7.86` (pack snapshot), `9.21` (pack-aware line uniqueness), `9.22` (receipt price snapshot), `9.23` (pricing-rule snapshot), `9.24` (snapshot provenance) |
| Coupons | `bms_coupons`, `bms_customer_coupon_wallet` | `7.21`, `7.25` |
| CRM | `bms_customers`, `bms_customer_identities`, `bms_customer_addresses` | `3.6` |
| Purchase | `bms_suppliers`, `bms_supplier_products`, `bms_purchase_orders`, `bms_purchase_order_items` | `5.2`, `9.18` |
| Payment | `bms_payments` | `5.3` |
| POS & tax | `bms_locations`, `bms_inventory_lots`, `bms_product_packs`, `bms_product_price_tiers`, `bms_pos_devices`, `bms_pos_shifts`, `bms_pos_purchase_receipts`, `bms_pos_expenses`, `bms_pos_petty_cash_wallets`, `bms_pos_petty_cash_ledger`, `bms_order_item_lots`, `bms_pos_returns`, `bms_pos_return_items`, `bms_pos_return_item_lots`, `bms_pos_refund_allocations`, `bms_store_credits`, `bms_store_credit_ledger`, `bms_pos_deposits`, `bms_ar_accounts`, `bms_ar_invoices`, `bms_ar_receipts`, `bms_ar_ledger`, `bms_tax_documents`, `bms_tenant_vat_settings`, `bms_etax_submissions` (+ `users.pos_only`, per-size pack and wholesale-price columns, cross-size wholesale scope/percentage, credit-note/cash-rounding columns; scanner protocol columns on POS devices; deposit, drawer-movement, expense, and PO-receipt idempotency; `CREDIT` added to payment/refund methods; preferred split-refund method; return/refund event-shift attribution; sale/receiving branch and source/destination lot attribution for returns) | `7.84`–`9.34` (`9.4` repair) |
| Shipping | `bms_shipments`, `bms_shipment_tracking_events` | `5.4`, `7.76`, `7.77` |
| Omnichannel Inbox | `bms_conversations`, `bms_messages`, `bms_conversation_notes` | `5.5`, `7.51` (read/search indexes) |
| Restock follow-up | `bms_restock_subscriptions`, `bms_restock_deliveries` | `7.41` |
| Multi-tenant / RBAC | `bms_tenants`, `bms_tenant_channels`, `bms_role_permissions`, `bms_plans`, `bms_audit_log` | `4.0`–`5.1`, `5.7`, `5.8`, `7.78` |
| Channel Health | `bms_channel_health_log` (+ columns on `bms_tenant_channels`) | `6.4` |
| Store profile / AI policy | `bms_store_profile`, `bms_store_capabilities` | `6.9`, `7.17`, `7.30`, `9.39` (receipt language), `9.40`, `9.43` |
| AI usage / credits | `bms_tenant_ai_config`, `bms_ai_usage_monthly`, `bms_ai_usage_events`, `bms_ai_credit_ledger` | `6.8`, `7.27`, `7.35`, `7.82` (billing/provider/cost split) |
| AI context safety / learning | `bms_inbound_events`, `bms_ai_synonym_candidates`; `bms_conversations.ai_state` | `7.30` |
| AI quality review | `bms_messages.meta.aiQuality`, `bms_ai_quality_reviews` | `7.31`, `7.32` |
| AI Provider Health | `bms_ai_provider_health`, `bms_ai_provider_health_log` (platform-wide, no `tenant_id`) | `7.34` |
| Failure incidents | `bms_failure_incidents` | `7.36` |
| Generated report exports | `bms_generated_reports` | `7.53` |
| Sales digest reports | `bms_report_subscriptions`, `bms_report_deliveries` | `7.37` |
| Support tickets | `support_tickets`, `support_ticket_comments` | `7.45` |
| Support diagnostics | `bms_support_events`, `bms_support_bundles`; `system_logs.tenant_id`; diagnostic linkage on `support_tickets` | `9.46` |
| Follow-up Automation (MVP core) | `bms_conversation_intents`, `bms_followup_rules`, `bms_followup_jobs`, `bms_followup_history` (+ `bms_conversations.last_sender_type`, `bms_customers.followup_opt_out`) | `7.52` |
| Report email permission | (permission-only, no new table) | `7.54` |
| Job run history | `bms_job_runs` (platform-wide, no `tenant_id`) | `7.55` (renumbered from `7.53` — see note below) |
| Membership & loyalty | `bms_loyalty_settings`, `bms_membership_tiers`, `bms_loyalty_ledger`, `bms_order_discounts` (+ member and enrollment-attribution columns on `bms_customers`) | `7.96`, `9.38` |
| POS park / drawer cash / void | `bms_pos_parked_sales`, `bms_pos_cash_movements` (+ `bms_pos_returns.is_void`, `bms_orders.voided_at/voided_by/void_reason`; cash-movement idempotency) | `7.97`, `9.5` |
| POS Scan Manager / PO receipt retry | `bms_pos_purchase_receipts` (+ `bms_pos_devices.scanner_mode/scanner_prefix_key/scanner_suffix_key/scanner_max_gap_ms`) | `9.6` |
| POS petty-cash expenses | `bms_pos_expenses` (drawer-funded rows link atomically to `bms_pos_cash_movements`; personal-funded rows intentionally do not), `bms_pos_petty_cash_wallets`, `bms_pos_petty_cash_ledger` | `9.7`–`9.10` |
| Stock transfers & counts | `bms_stock_transfers`, `bms_stock_transfer_items`, `bms_stock_counts`, `bms_stock_count_items`; branch quarantine + receive discrepancy evidence + transfer-loss visibility | `7.98`, `9.35`, `9.36` |
| Phase 1 action + inventory intelligence | `bms_actions`, `bms_action_events`, `bms_inventory_policies`, `bms_inventory_demand_events` | `9.12`–`9.13` |
| Phase 2 retention engine | `bms_retention_cases` | `9.14` |
| Data-integrity lifecycle | event timestamps on `bms_orders` / `bms_payments`; non-negative product-cost constraint | `9.15` |

## Notable schema details

**`bms_inventory.reserved_stock` has no ownership ledger** — the table is keyed by
`(tenant_id, location_id, product_sku, size)` and `reserved_stock` is a running total that
`createOrder()` increments and `SHIP`/cancel decrement. No column or table says which bill owns which
reserved unit, which is why "who is holding this piece" has to be rebuilt from the bills still in
`PENDING`/`PAID`/`PACKING` (via the `bms_order_stock_lines` view, so a bundle's components are
attributed to the bill that bought the set) and why the part no bill explains must be reported rather
than hidden. Any statement against this table that omits `tenant_id` silently affects every shop
stocking the same SKU — `scripts/inventory-tenant-scope-contract.test.mts` fails on one. Detail:
[../business/inventory.md](../business/inventory.md#who-is-holding-reserved-stock).

**Size-specific wholesale tiers (`9.20`)** — `bms_product_price_tiers.size` targets a
`PER_VARIANT_FIXED` rule to one inventory size. `NULL` preserves legacy rows as a shared fixed price
for all sizes, while `CROSS_VARIANT_PERCENT` requires `NULL` because it qualifies from the SKU-wide
quantity. The unique rule key is tenant + SKU + scope + normalized size + minimum quantity, allowing
M and XL to carry different prices at the same minimum without duplicate rules for either size.

**Supplier product mapping (`9.18`)** — `bms_supplier_products` is tenant-owned and maps one
supplier-facing SKU to one authoritative shop `product_sku + size`. Supplier SKU uniqueness is
case-insensitive within a supplier. The mapping can retain supplier name/barcode, latest unit cost,
pack/minimum quantities, and lead time, while PO items snapshot the supplier SKU and product name
used at creation. Inventory foreign keys and all receiving mutations continue to use the shop SKU.

**Data-integrity lifecycle (`9.15`)** — orders retain `paid_at`, `cancelled_at`, and `returned_at`;
payments retain `confirmed_at`, `rejected_at`, and `refunded_at`. These are event timestamps, not
aliases for `created_at`/`updated_at`, so a refund or cancellation performed on a later Bangkok
business day remains attributable to the day it happened. Existing terminal rows are backfilled
with the best available legacy evidence. New transitions set the timestamp inside the same tenant
transaction as the state change. The migration also adds a `NOT VALID` non-negative `cost_price`
check: it protects every new/updated row without making deployment fail on a legacy bad row that
operators still need to repair.

**Phase 1 action center (`9.12`)** — `bms_actions` materializes one tenant-scoped action per Bangkok
business day and signal. It stores priority, evidence, expected impact, confidence, owner, due date,
deep link and the terminal lifecycle `NEW -> ACCEPTED -> COMPLETED` or `DISMISSED`/`EXPIRED`.
`bms_action_events` is the append-only transition history; the service writes its domain audit row in
the same tenant transaction. `bms_inventory_policies` supplies per-variant safety-stock and supplier
lead-time assumptions. `bms_inventory_demand_events` records lost sales and restock requests so unmet
demand contributes to later purchase recommendations. All four tables use forced tenant RLS and
`bms_app` grants. Recommendations remain advisory and never create a PO automatically.

**Phase 2 retention engine (`9.14`)** — `bms_retention_cases` stores one monthly case per tenant and
identified customer. It snapshots RFM inputs, expected return date, risk, bilingual recommendation,
verified channel/product evidence, treatment/holdout cohort, operator lifecycle and attributed order
revenue. Treatment contact is explicit and audited; holdout contact is refused by the service.
Conversions are attributed for at most 30 days from treatment contact or holdout assignment, after
which open cases become `EXPIRED`. The table has forced tenant RLS and no delete grant.

**Loyalty ledger (`7.96`)** — `bms_loyalty_ledger` is append-only and is the only source of truth for
points. `bms_customers.points_balance` is a cache of `SUM(points)` and may go negative when a customer
returns goods after redeeming; the next grant covers the deficit through `consumed_points` before
adding anything usable. Usable points are `SUM(points - consumed_points)` over grant rows that have
not expired, consumed FIFO by `expires_at`. `UNIQUE (tenant_id, order_id, kind)` on `EARN`/`REDEEM`
makes POS replay idempotent; `UNIQUE (tenant_id, pos_return_id, kind)` does the same for partial
returns, and cancel/full-return reversals are the rows with `pos_return_id IS NULL`.

**Member enrollment attribution (`9.38`)** — `bms_customers.enrollment_channel` records how the
membership was created. A POS enrollment snapshots the authenticated register's
`enrolled_location_id`, `enrolled_pos_device_id`, current `enrolled_shift_id` when one is open, and
the PIN-verified `enrolled_by` user. These fields are written only on the first successful
enrollment and are not inferred from the first order or overwritten by a repeated enrollment.
Legacy members remain `NULL` and the UI labels them as unknown rather than inventing a branch.
Composite tenant foreign keys prevent a location, device, or shift from another shop being stored.

Two things about writing to these tables:

- `bms_customers` has a revision trigger (`7.1`/`7.6`), so every balance write must set
  `app.skip_revision` (`7.24`) or the revision table grows by one full row snapshot per sale. Only a
  real tier change is worth a revision.
- `bms_order_discounts` records where a bill's discount came from, one row per source, and its rows
  always sum to `bms_orders.discount_amount`. That column stays the number the VAT base and the
  abbreviated tax invoice read — a member discount must never be applied at cash-collection time.

**POS sale/return ledger (`7.84`–`7.91`)** — devices bind a browser token to one tenant/location,
shifts bind the drawer to one device, and orders snapshot device/shift/cashier plus an idempotency
key. `bms_order_item_lots` records FEFO lot consumption. A return has item rows and separate lot
provenance rows, so repeated partial returns restore each sold lot quantity only once.
`bms_pos_refund_allocations` separates receiving goods from returning money: cash allocations finish
immediately while non-cash allocations remain pending until an authorized operator records the
provider/terminal reference. Migration `9.31` adds nullable
`bms_pos_returns.preferred_refund_method`: the counter records which original payment method the
operator selected first for a split-payment return, and idempotent replay must match it. Allocation
is capped by the original payment's remaining refundable amount and never derives method priority
from same-transaction timestamps or random UUID order. Migration `9.32` adds
`bms_pos_returns.shift_id` (the shift that accepted the return) and
`bms_pos_refund_allocations.completed_shift_id` (the shift that confirmed the money leg). Both are
nullable only for legacy evidence gaps; new writes bind them from the authenticated device's open
shift. Migration `9.33` adds the separate `pos.shift.report.all` back-office permission plus a
shift-list index; the register-scoped `pos.shift.report` still only answers for the owning device,
while the admin overview can read shifts across devices for the same tenant. All POS tables are
tenant-owned, RLS-protected, and granted to `bms_app`. See
[../business/pos.md](../business/pos.md).

**Cashier-only accounts (`7.92__bms_cashier_role_and_pos_only_accounts.sql`)** — adds `users.pos_only`;
enforced as a hard login gate in `loginAdmin`, not just a hidden menu item. A `pos_only` account
cannot toggle its own flag or an Administrator's.

**Pack sizes v2 (`7.93__bms_product_packs_per_size.sql`)** — reworks `bms_product_packs` to carry a
barcode/price per pack size rather than one conversion factor per product.

**e-Tax submission queue (`7.94__bms_etax_submissions.sql`)** — `bms_etax_submissions`, one row per
issued tax document, tracks `PENDING → BUILT → SIGNED → SENT → ACCEPTED/REJECTED/FAILED` with
`attempts`/`next_attempt_at` for backoff retry. Written only through `lib/bms/etax/queue.ts`,
processed by `POST /api/bms/jobs/etax` — that route authenticates with `x-job-token`/`BMS_JOB_TOKEN`
(unlike every other cron route's `x-cron-secret`) and does not yet call `recordJobRun()`, so it has
no run history on `/admin/operations-schedule`. Gated off by default
(`ETAX_ENABLED`/`bms_store_profile.etax_enabled`).

**Credit note / cash rounding (`7.95__bms_credit_note_and_cash_rounding.sql`)** — adds cash-rounding
columns to `bms_tax_documents`/`bms_tenant_vat_settings` and formalizes `CREDIT_NOTE` as a `doc_type`
alongside `ABBREVIATED`/`FULL`. A tax document's rate/amounts are a snapshot at issue time; changing
`bms_tenant_vat_settings` only affects documents issued afterward.

**Parked bills / drawer cash / void (`7.97__bms_pos_park_cash_void.sql`)** — three things in one file
because all of them hang off the same shift and all of them feed the close-shift cash formula; applying
half of it means closing a drawer with half the numbers.

`bms_pos_parked_sales` is a basket snapshot per shift: `label` (`CHECK (btrim(label) <> '')`, required
so staff can tell two parked bills apart), `cart JSONB`, `item_count`, `subtotal_hint`, plus
`location_id`, `device_id`, `shift_id`, `parked_by`. `shift_id` is `ON DELETE CASCADE` on purpose —
closing the drawer expires the parked bills with it instead of carrying them across a day of price and
stock changes. A parked row reserves **no** stock and locks **no** price: resume re-prices from the live
catalog, and `createOrder()` still answers `INSUFFICIENT` if the goods sold out meanwhile. That is
deliberate; reserving stock for a customer who never came back means locked inventory nobody sweeps up.
`resumeParkedSale()` reads and deletes in a single `DELETE ... RETURNING`, so two terminals sharing one
shift cannot resume the same basket onto both screens. The 20-per-shift ceiling lives in
`lib/bms/pos.ts`, not the schema.

`bms_pos_cash_movements` records drawer money that is not a sale: `direction`
(`CHECK (direction IN ('IN','OUT'))`), `amount NUMERIC(12,2) CHECK (amount > 0)`, a mandatory `reason`
(`CHECK (btrim(reason) <> '')`), and a deliberately separate `actor_user_id` (NOT NULL) and
`approved_by` (nullable — the second person is enforced in code, not by the column). The expected drawer
balance is computed by one formula in both places that need it (`drawerExpectedInTx()` when recording a
movement and `closePosShift()` when closing): opening float + `CASH` payments on the shift's orders with
status `CONFIRMED`/`REFUNDED` − completed `CASH` refund allocations + `IN` − `OUT`. An `OUT` that would
drive that expected balance negative is refused (`WOULD_OVERDRAW`) — not because the system knows what
is physically in the drawer, but because such a line is a typo for certain and would make the whole
shift unexplainable. Every movement also writes a `pos.cash.movement` row to `bms_audit_log` in the same
transaction, since whoever asks "who took money out this month" reads the audit log, not this table.

**POS petty-cash expenses (`9.7__bms_pos_petty_cash_expenses.sql`)** — `bms_pos_expenses` gives a
drawer `OUT` its business meaning without treating every cash transfer as an expense. `DIRECT` rows
are immediately `SETTLED`; `ADVANCE` rows begin `OPEN` and settle against an actual amount. A lower
actual amount links an `IN` change-return movement, while a higher amount links an extra `OUT`.
`create_cash_movement_id` is mandatory for `funding_source = 'DRAWER'`; `9.8` permits it to be null
for a `DIRECT` personal-funded row with mandatory evidence and no approver. `9.9` adds a third
`PETTY_CASH` funding source: it has no drawer movement or approver, but must link exactly one debit in
`bms_pos_petty_cash_ledger`. The per-branch row in `bms_pos_petty_cash_wallets` is locked before each
credit/debit, may never be negative, and is updated in the same tenant transaction as the append-only
ledger, expense and audit rows. Funding can identify owner cash or a business account, always requires
evidence, and never enters a shift's expected-cash formula. `9.10` additionally constrains ledger
shape: outside funding is `IN` without a shift/device, while an expense debit is `OUT` with both, and
bounded text/hash fields must match the service contract. `settlement_movement_id` is optional when an
advance matches exactly, and request key/hash pairs make create and settle replay-safe while rejecting
a reused key with changed input. The service serializes each tenant/scope/key with a transaction-level
PostgreSQL advisory lock and resolves a committed replay before checking mutable shift/location state,
so concurrent cross-branch reuse cannot leak a unique-constraint error and retry still works after a
shift or location closes. Open advances block shift close. The table is tenant-owned, RLS-protected,
and granted only `SELECT`/`INSERT`/`UPDATE` to `bms_app`; rows are never deleted by the service.

Void adds `bms_pos_returns.is_void BOOLEAN NOT NULL DEFAULT FALSE`, `bms_orders.voided_at`/`voided_by`/
`void_reason`, and a partial index `idx_bms_orders_voided ... WHERE voided_at IS NOT NULL`. A void
reuses the return machinery exactly (`processPosReturn({ isVoid: true })`) so stock, lots, loyalty and
refunds unwind through the one already-tested path; `is_void` is what keeps a mis-scan out of the return
reports and out of the `pos-return-audit` fraud signal that fires on frequent cashier returns. The
stamping happens **inside** that refund transaction — `voided_at`/`voided_by`/`void_reason`, cancelling
(never deleting) the order's `bms_tax_documents` row through `cancelled_at`/`cancelled_reason` so no
issued number vanishes from the sequence, and a `pos.void` audit line carrying the approver — so
"refunded but never stamped" is unreachable. `voidPosSale()` accepts only a `COMPLETED`/`PAID` order on
the still-open shift that owns it and with no prior return; a replay of an already-voided order answers
`VOIDED` instead of erroring. `getPosShiftReport()` (the X/Z report) removes voided bills from every
figure rather than just the bill count, and a closed shift reports the `expected_cash` stored at close
rather than recomputing, so a reprint matches the paper a manager already signed. Both new tables carry
the standard tenant RLS policy and `bms_app` grants. Permissions seeded: `pos.void` and
`pos.cash.movement` for `Manager` only (money disappearing from sales and money disappearing from the
drawer are the two classic retail leaks), `pos.shift.report` for `Manager`/`Sales`/`Cashier`. A cashier
can still perform a void or a cash-out, but with a supervisor's PIN at that moment rather than by
holding the permission.

**Inter-branch transfers & stock counts (`7.98__bms_stock_transfers_and_counts.sql`)** — `7.84` added
`bms_locations` and `bms_inventory.location_id`, but there was no way to move goods between branches and
no way to reconcile a shelf against the system, so a second location's numbers could only drift. The
migration first widens the `bms_stock_movements` type CHECK to accept `TRANSFER_IN`, `TRANSFER_OUT` and
`COUNT_ADJUST` alongside `STOCK_IN`/`STOCK_OUT`/`RESERVE`/`RELEASE`/`SHIP`/`RETURN`. The split matters
for reporting: a transfer is not stock leaving the company, and a count variance is goods already lost
and only now discovered — neither should read as an ordinary receipt or sale.

`bms_stock_transfers` is two-step by design (`status` `DRAFT` → `IN_TRANSIT` → `RECEIVED`, or
`CANCELLED` from `DRAFT` only), with `UNIQUE (tenant_id, transfer_no)`,
`CHECK (from_location <> to_location)`, and per-step actor/time columns (`sent_by`/`sent_at`,
`received_by`/`received_at`, `cancelled_by`/`cancelled_at`). Goods in transit are in no branch's stock
at all, which is the correct answer: sending decrements `current_stock` at the source, receiving
increments the destination, so a count run at the source mid-journey rightly does not find them.
Sending also refuses to push the source below its `reserved_stock` — stock a customer was already
promised must not be driven to another branch. `bms_stock_transfer_items` has
`UNIQUE (transfer_id, product_sku, size)`, `qty CHECK (qty > 0)`, and a nullable
`received_qty CHECK (received_qty >= 0)`: receiving less than was sent is legitimate (breakage, loss,
miscount at packing) and the shortfall is written as its own `TRANSFER_LOST` movement at the
**source** with a note naming the transfer, rather than being absorbed silently into the difference
between two branches. `9.36` keeps that loss visible on product inventory as an operational follow-up
number, but it is deliberately outside company-held stock because the goods are neither sellable nor
physically held in quarantine.

`bms_stock_counts` / `bms_stock_count_items` (`DRAFT` → `APPLIED`/`CANCELLED`,
`UNIQUE (tenant_id, count_no)`, `UNIQUE (count_id, product_sku, size)`) exist for the case where the
shop keeps selling while somebody walks the aisles. `snapshot_qty` is the system quantity captured the
moment a line is first entered, and is deliberately **not** refreshed when the counter corrects a typo;
applying the count adds `counted_qty − snapshot_qty` to `current_stock` instead of overwriting it, so a
sale made during the count is not conjured back onto the shelf. Applying is refused
(`WOULD_BREAK_RESERVED`) when the result would fall below `reserved_stock`; that is a conflict for a
human to settle, not one for the system to pick a side on quietly. Item-level entry is intentionally not
audited — a shelf count is hundreds of lines and would bury the log — but `inventory.count.apply` writes
one `bms_audit_log` row naming who accepted the shrinkage.

Both item tables use a composite `FOREIGN KEY (tenant_id, product_sku) REFERENCES
bms_products(tenant_id, sku)`, because `bms_products`' primary key is `(tenant_id, sku)`. The composite
form enforces that the line's tenant and the product's tenant are the same row, not merely that the SKU
exists in *some* tenant. The services still validate SKUs before inserting, so a typo returns a sentence
naming the bad SKU instead of a bare 500 from the FK. All four tables carry the standard tenant RLS
policy and `bms_app` grants. Permissions seeded: `inventory.transfer` and `inventory.count` for
`Manager`/`Warehouse`, `inventory.count.apply` for `Manager` only — entering the numbers is warehouse
work, accepting that the goods are really gone is an accounting decision, and the two should not be the
same person.

Two things to know before applying `7.98`. **Apply it with `psql -1`**: the file is not self-wrapping,
and the first attempt on this repo's dev database failed partway through on a wrong (non-composite) FK,
leaving half its tables behind to be dropped by hand before a retry. Second, a branch created without an
explicit `bms_locations.branch_code` takes that column's `'00000'` default from `7.84` and immediately
collides with head office under `uq_bms_locations_branch_code (tenant_id, branch_code)`; multi-branch
transfers are the first feature that makes a second location routine, so this is where it first bites.

**Daily document numbers (`lib/bms/dailyDocNo.ts`)** — `bms_stock_transfers.transfer_no` and
`bms_stock_counts.count_no` are `TRF-YYMMDD-NNN` / `CNT-YYMMDD-NNN`, per tenant per day, not a global
sequence. Both the date stamp and the counter come from a single SQL statement, so an app running in
`Asia/Bangkok` against a UTC database cannot stamp today's date onto a counter that is still counting
yesterday's rows — that produced genuinely duplicate numbers, not merely an unlucky race. The insert
runs under a `SAVEPOINT` and retries (up to five times) on unique violation `23505`, which converges:
losing the race means the other writer has committed, so the recount sees its row. It must therefore be
called from inside an already-open transaction.

**`bms_products` customer discovery (`7.33`)** — customer AI reads the live active catalog directly;
there is no product embedding/cache that must be refreshed after an insert. A newly created active
product with sellable inventory is therefore visible to `browse_catalog`/`list_new_arrivals` on the
next tool call, even if it introduces a new category. The active-tenant/creation-time index supports
new-arrival reads, while trigram indexes support bounded partial matching over name, SKU, category,
and brand. Product aliases remain authoritative in `bms_products.keywords`.

**`bms_customer_identities`** — maps `(tenant_id, channel, external_ref)` → `customer_id`, with a
`UNIQUE (tenant_id, channel, external_ref)` constraint (added in `4.0`, originally per-channel-only
in `3.6`). This is *the* matching key for "who is this customer" — there is no automatic dedup by
phone/email across channels (see [../ui/customer360.md](../ui/customer360.md) for the manual merge
feature that fixes this per-customer). Since `6.7`, the table also stores cached channel profile
metadata (`display_name`, `picture_url`, `status_message`, `language`, `profile_synced_at`,
`profile_error_at`, `profile_error`) for display-only use. LINE OA sync writes these fields after
webhook processing; Inbox uses them as fallback when no authoritative CRM customer name/avatar is
available.

Pharmacy intake establishes this identity before creating an assessment, then stores the canonical
`customer_id` on `bms_pharmacy_assessments`. Migration `7.69` changes new assessments to begin with
`patient_relationship = 'UNKNOWN'`; intake must resolve `SELF`/`CHILD`/`PARENT`/`OTHER` before any
patient memory can be reused. Historical implicit `SELF` values are reset to `UNKNOWN`. The partial
patient-memory index supports newest consented and customer-confirmed profile reads by tenant,
customer, and relationship.

Migration `7.70` adds `display_label` and `trigger_terms` to `bms_pharmacy_protocols`. Active
protocol reads require `status = 'APPROVED'`, `clinically_approved = true`, and `enabled = true`;
the ENV allowlist remains an independent platform kill switch.

Migration `7.71` adds tenant/SKU-scoped `bms_pharmacy_product_policies`. Product names and free-text
categories are never regulatory authority: a policy starts as `DRAFT`, must be reviewed by a user
verified through `bms_is_licensed_pharmacist`, and only `APPROVED` rows participate in order
authorization. The order transaction checks this table before reserving inventory and fails closed
for a pharmacy SKU with no approved policy.

Migration `7.72` replaces free-text regulatory classification with a structured framework/class pair
(`DRUG`, `MEDICAL_DEVICE`, `NOT_REGULATED`, or `UNKNOWN`) and an evidence source/reference. A Draft may
remain `UNKNOWN`, but it cannot be submitted for pharmacist review until both the classification and
its evidence source are identified. On first installation, legacy policies return to `DRAFT` because
their previous approval did not verify the new evidence fields. Its legacy backfill runs only once, so rerunning
the idempotent migration does not overwrite pharmacist-reviewed values.

Migration `7.73` adds a database constraint between `product_type` and `regulatory_framework`.
Contradictory legacy rows are reset to `UNKNOWN`/`DRAFT` for human review instead of being guessed
into a legal class.

**Omnichannel Inbox read path (`7.51`)** — `/admin/inbox` reads the latest conversation list and the
selected conversation separately. Recent-list indexes cover tenant/status/time ordering, detail
indexes cover latest message/event slices, and trigram indexes support bounded text search across
conversation previews, customer refs, message bodies, CRM names, and cached channel display names.
Keep list/detail GraphQL queries bounded; do not reintroduce unbounded message/note/event reads on
the initial inbox view.

**`bms_orders` / `bms_order_items`** — orders start directly at `PENDING` with stock already
reserved; there is no separate `DRAFT` status in the implementation despite earlier planning docs
mentioning one. `bms_order_items` snapshots `unit_price` at order time (not a live join to
`bms_products.price`), so historical order totals don't change if a product's price changes later.
Since `7.21`, `bms_orders.total_amount` is the **post-discount** amount actually owed;
`discount_amount`/`coupon_code` are snapshotted at order creation the same way item prices are, so
totals stay correct even if the coupon is later edited or deleted.

Since `7.86`, an item can snapshot a selling unit in `pack_code`, `pack_qty`, and
`pack_unit_price`. Migration `9.21` makes line uniqueness match that model: one order may contain the
same SKU and size once per normalized selling unit (for example, one `BOX` line plus one loose
`BASE` line). `NULL`, blank, and any case/spacing variation of `BASE` all identify the same loose-unit
line, so they cannot bypass uniqueness or produce duplicate base rows.

Since `9.22`, `receipt_unit_price` separately snapshots the selling-unit price shown before
wholesale/promotion and order-level discounts. `unit_price` remains the effective price used by
order arithmetic. Receipt reprints use `receipt_unit_price` plus the snapshotted discount breakdown,
so a size priced at 1,000 with a 10% cross-size wholesale rule still reprints as 1,000 and an
explicit −100 adjustment instead of silently relabelling the product price as 900. Legacy rows are
backfilled once from the best available variant/base-pack evidence at migration time; new rows are
exact snapshots created with the order.

Since `9.23`, `pricing_snapshot` preserves the wholesale tiers and product promotion used when the
order was created. A POS partial return prices the retained quantities against this snapshot, not the
shop's current rules: dropping below a wholesale threshold therefore removes that price from the
retained basket. `bms_pos_returns.pricing_adjustment_amount` records how much this reduced the current
refund, while `remaining_amount_after_return` records the resulting net balance. The original order
and tax document remain immutable. Legacy rule snapshots are reconstructed once from the rules present
when `9.23` is applied, because the exact historical rule set was not previously stored. That
reconstruction is not authoritative and is never used to change a legacy refund; only snapshots
written with `source: "SALE"` while creating a new order can trigger retained-basket repricing.
Migration `9.24` enforces that provenance marker and updates the database comment so support tools do
not mistake legacy reconstruction for an exact historical snapshot.

**Shipping carrier integration (`7.76`/`7.77`)** — both migrations are additive on `bms_shipments`;
a manual shipment stays valid and simply keeps `carrier_booking_status = 'manual'` with the sync
columns null. `7.76` adds `external_shipment_id`, `carrier_last_synced_at`, and
`carrier_tracking_source` (`manual`/`live`/`mock`). `7.77` adds the retryable booking state —
`carrier_booking_status` (`manual`/`ready`/`booking`/`booked`/`failed`/`unconfigured`/
`not_implemented`), `carrier_booking_error`, `carrier_booking_attempted_at` — and replaces `7.76`'s
lookup index with `uq_bms_shipments_external_shipment_id` on `(tenant_id, carrier,
external_shipment_id)`, so an idempotent retry can never bind one carrier parcel to two local
shipments. `bms_shipment_tracking_events` is the tenant-scoped, RLS-protected event history:
`UNIQUE (shipment_id, carrier_status, occurred_at)` makes repeated polling idempotent, and
`source` is constrained to `live`/`mock` so mock-mode data can never be read back as real carrier
history. Carrier requests happen outside the fulfillment transaction, so these columns — not an
in-transaction call result — are the record of what the carrier actually accepted.

**`bms_coupons` (`7.21`)** — one row per discount code, `UNIQUE (tenant_id, code)`. `type` is
`PERCENT` (capped at 100 by a `CHECK`) or `FIXED`. Redemption is applied inside the same transaction
as `createOrder()` (`applyCouponInTx()`, `lib/bms/coupons.ts`) — the coupon row is locked with
`FOR UPDATE` and `redemptions_count` incremented atomically, so concurrent checkouts can't both
"win" the last redemption of a limited coupon. `redemptions_count` is decremented again only for
pre-sale cancellation paths (`cancelOrder()` and unpaid-order auto-release) in the same transaction
that returns reserved stock. Payment rejection alone leaves the order open and does not release the
coupon; post-sale returns/refunds do not release coupon quota automatically. Per-customer limits are
checked by counting matching non-cancelled `bms_orders` rows directly; there is no separate
redemption-log table.

**`bms_customer_coupon_wallet` (`7.25`)** — a light entitlement table that records which coupons a
customer has explicitly received. One row represents one `(tenant, customer, coupon)` relationship;
the unique constraint is intentionally permanent, so re-granting the same coupon later reuses the
row by clearing `revoked_at` and refreshing `assigned_at` instead of creating duplicates. This table
does **not** carry the source of truth for usage counts or redemption state — those still come from
`bms_orders` — but it lets the product answer "which coupons belong to this customer", "what was
sent to them in chat", and "which assigned coupons are near expiry" without guessing from all global
active coupons. The current assignment flow is best-effort from staff Inbox coupon sends
(`sendStaffMessage()`), source-tagged as `MANUAL_CHAT`.

Since `7.26`, the same table also carries a lightweight lifecycle snapshot: `ASSIGNED`, `RESERVED`,
`REDEEMED`, `REVOKED`, `EXPIRED`, plus timestamps and order links
(`claimed_at`, `reserved_at`/`reserved_order_id`, `redeemed_at`/`redeemed_order_id`, `expired_at`).
These fields are intentionally derivative and UX-oriented: they help AI and operators talk about
"ลูกค้าใช้คูปองนี้ไปหรือยัง" or "กำลังจองอยู่กับออเดอร์ไหน" without replacing the authoritative
order/payment facts. Pre-sale cancellation clears a reservation (and even a paid-path redemption if
that order is cancelled before shipping) so the wallet remains consistent with the coupon quota
release policy. The database CHECK still accepts legacy `CLAIMED` rows from the earlier claim-link
experiment, but the current product flow normalizes those rows back to `ASSIGNED`; customers no
longer need to press a claim button.

**`bms_tenant_channels`** — one row per `(tenant_id, channel)`, `channel` is a free-text column
(no CHECK constraint / enum), storing `access_token` and `channel_secret` **encrypted** (AES-256-GCM
via `lib/bms/crypto.ts`), plus an `extra JSONB` column and `active BOOLEAN`. Because `channel` is
unconstrained text, adding a new channel (e.g. Shopee/Lazada) needs no migration — only application
code needs to know the new value (see [../integrations/](../integrations/)). LINE OA bot/source
display metadata is cached in `extra` (`botDisplayName`, `botBasicId`, `botPictureUrl`,
`botChatMode`, `botInfoSyncedAt`) so Inbox can show which OA/shop received a message without
calling LINE APIs during reads.

**Channel Health (`6.4__bms_channel_health.sql`)** — `bms_tenant_channels` also carries `status`
(CHECK-constrained enum: `connected`/`token_expired`/`webhook_failed`/`rate_limited`/`no_events`/
`send_failed`), `status_detail`, `last_error_at`, `last_inbound_event_at`, `last_outbound_success_at`,
`last_checked_at` — the shop's actual connection health, deliberately separate from `active` (the
admin's on/off switch). `active`+`has_token` are checked client-side before trusting `status` at all,
since a never-configured channel still defaults to `status = 'connected'` in the DB (meaningless until
a real webhook/send event happens). `bms_channel_health_log` is an append-only history of status
transitions (written only when status actually changes), separate from `bms_audit_log` because these
are automated events from external platforms, not admin actions. Written exclusively through
`setChannelStatus()` in `lib/bms/channelHealth.ts` — see [../integrations/lazada.md](../integrations/lazada.md)
for a caveat on what a `webhook_failed` badge means for the Shopee/Lazada beta scaffold specifically.

**AI Provider Health (`7.34__bms_ai_provider_health.sql`)** — same shape as Channel Health but for the
shared platform AI provider (Anthropic/DeepSeek/Qwen OCR) instead of a chat channel. `bms_ai_provider_health`
has **no `tenant_id`** and no RLS (same convention as `bms_plans`) because it tracks the platform's own
shared credentials, not any one shop's data — a tenant's own BYOK key failing is that tenant's problem
and is intentionally not tracked here. Composite primary key `(provider, purpose)` because one provider
can serve more than one purpose independently (Anthropic can back sensitive `chat` baseline/fallback
and, if `BMS_SLIP_READER_FALLBACK_PROVIDER=anthropic`, `ocr` slip fallback — each can be
healthy/unhealthy on its own).
Written exclusively through `setAiProviderStatus()` in `lib/bms/aiProviderHealth.ts`, called from three
places: `finalizeAiUsageEvent()` in `lib/bms/aiUsage.ts` (the single choke point every shared-key chat
and OCR call already passes through — BYOK-sourced events are skipped by checking `source = 'shared'`),
the `/admin/env` "ทดสอบ" button (`testPlatformAiKey()` in `lib/bms/aiConfig.ts`), and the cron
`POST /api/bms/ai/check-health`. `bms_ai_provider_health_log` is append-only history, written only on
an actual status change (same anti-spam rule as `bms_channel_health_log`).
The UI derives `STALE` for a connected row whose `last_checked_at` is older than the configured
freshness window; `stale` is not stored in the database status constraint.

**Tenant AI provider (`7.35__bms_tenant_ai_provider.sql`)** — adds a constrained
`bms_tenant_ai_config.provider` (`anthropic`/`deepseek`, default `anthropic`) so legacy BYOK rows
retain their meaning while new tenants can supply a DeepSeek key. The encrypted-key column remains
the same and arbitrary tenant-supplied base URLs are intentionally unsupported.

**Failure incidents (`7.36__bms_failure_incidents.sql`)** — tenant-scoped, append-only log of system
failures that reached a customer or degraded AI behavior, written only through `reportBmsFailure()`
in `lib/bms/failureAlert.ts`. Deliberately **per-occurrence rows** (like `bms_audit_log`) rather than
one status row per subject (like `bms_ai_provider_health`): the question this table answers is *which
conversations were affected*, so a shop can follow up with each customer, not *is it broken right
now*. `conversation_id` is **intentionally not a foreign key** — an incident must still be recorded
when resolving the conversation is itself the failure being reported, and when the conversation was
later deleted. `notified_shop_at`/`notified_platform_at` double as the alert-cooldown source
(`MAX(...)` per `(tenant_id, code)`), so no separate dedupe table is needed; they are set only after a
notification actually succeeded, so a failed/timed-out notification retries instead of starting a
silent cooldown. This table complements rather than replaces Channel Health and AI Provider Health:
those record *connection status*, this records *customer-visible events that already happened*.

**Generated report exports (`7.53__bms_generated_reports.sql`)** — tenant-scoped, append-only rows
describing each on-demand report export (`SALES` / `INVENTORY` / `PROFIT`) created from
`lib/bms/reportEngine.ts`, regardless of whether the caller came from GraphQL, REST, or the staff AI
tool. Each row stores the export type/format, user-supplied params JSON, optional AI executive
summary text, `generated_by`, and a nullable `file_id` reference into the shared `files` table. The
database row is tenant-owned and RLS-protected, but the referenced file still lives in the global
`files` table, so downloads must verify both: the requester's tenant owns a row in
`bms_generated_reports` for that `file_id`, and the underlying `files` row exists and is not deleted.
That is why report downloads use `/api/bms/reports/download/[id]` instead of the public-ish
`/api/files/[id]` path used for ordinary attachments/images. This table is an audit/history ledger,
not a mutable "latest report" state table: re-generating the same report creates a new row and file.

**Job run history (`7.55__bms_job_runs.sql`, renumbered from `7.53` while merging
`feat/redis-infra-improvements` into `feat/report-generation` — `7.53` was already
`7.53__bms_generated_reports.sql` on this branch, and `7.54` is
`7.54__bms_report_email_permission.sql`)** — platform-wide (no `tenant_id`/RLS, same convention
as `bms_ai_provider_health`) append-only log of every cron/batch invocation, filling a gap
`/admin/operations-schedule` used to admit openly: that page could describe a job's intended
schedule/purpose by reading source files, but never showed a real last-run status. One row per
invocation via `lib/bms/jobRuns.ts` `recordJobRun()` (inserts `status='running'`, then updates to
`success`/`error` once the wrapped function settles — the same helper closes the row on both
outcomes so a route can't forget to) or `recordExternalJobRun()` for a job that already finished
outside this process (currently only the `daily-log-triage` GitHub Action, reporting back through
`POST /api/bms/jobs/report-run`). `job_name` matches the `key` used in
`lib/bms/operationsSchedule.ts`'s `DEFINITIONS` array by convention, not a foreign key — the two
were built as separate registries (one describes "what a job is", the other "what actually
happened") and are joined only in the UI. A `running` row whose process crashed before finishing is
never auto-corrected; the UI flags it "stuck" once it's older than a fixed threshold rather than
guessing at a real outcome.

**Sales digest reports (`7.37__bms_report_subscriptions.sql`)** — `bms_report_subscriptions` is one
row per tenant (`tenant_id` PK, like `bms_store_profile`): frequency (`DAILY`/`WEEKLY`/`MONTHLY`),
send hour (+ weekday for weekly / day-of-month for monthly), a recipient + enable flag per channel
(email address, Slack webhook URL — encrypted like `channel_secret` via `lib/bms/crypto.ts`, LINE
user id), an overall `enabled` flag, and `last_sent_at`/`last_period_key`/`last_status` for
idempotency. `bms_report_deliveries` is append-only (like `bms_audit_log`), one row per channel per
send attempt, so the platform-admin page can show real delivery history instead of just a single
last-status field. `last_period_key` (e.g. `DAILY:2026-07-30`) is the actual dedup key — the cron
can be invoked at any frequency (hourly, even more often) without ever double-sending, since a
tenant whose current period already matches `last_period_key` is skipped. `sendTestDigest()`
deliberately does not touch `last_sent_at`/`last_period_key`, so testing configuration never
disturbs the real schedule. Both tables have the standard tenant-owned RLS policy and `bms_app`
grants; there is no new permission — the shop-facing config mutation gates with the same
`requireTenantAdmin()` pattern as `bms_store_profile`/`bms_tenant_channels`, and the cross-tenant
platform view gates with `requirePlatformAdmin()`.

**`bms_product_images` (`6.5__bms_product_images.sql`)** — ordered gallery rows
`(tenant_id, product_sku, file_id, sort_order)` pointing at the shared `files` table. The older
`bms_products.image_url` column remains in place as the canonical cover image for backward
compatibility with existing UI/API consumers. In the current implementation, product save replaces
the gallery rows for that SKU inside the same tenant-scoped transaction, then repopulates them in
the submitted order. The table has its own RLS policy and explicit `bms_app` grants; forgetting
those breaks product save even if the table itself exists.

**Support tickets (`7.45__support_ticket_comments.sql`)** — `support_tickets` stores the public
support intake from `/support`; it keeps the user-submitted contact/topic/message plus page/UA/IP
metadata and trackable `updated_at` / `closed_at` timestamps. `support_ticket_comments` stores the
internal notes and status transitions for `/admin/support-tickets`, preserving a readable history
of what changed and why. The support tables are platform-wide rather than tenant-owned because
they belong to ops/support, not a specific shop's business data.

**`bms_role_permissions`** — composite key `(tenant_id, role_id, permission)`; `permission` is a
free-text string validated against the `BMS_PERMISSIONS` catalog in `lib/bms/permissions.ts`, not a
DB-level enum. Administrator role bypasses this table entirely (hardcoded super-access in code).
Migration `7.78` seeds `user.view`/`user.manage` here for `Manager` in every tenant, which is what
lets a shop owner manage their own staff; *which* users they may touch is a separate code-level role
rank (`lib/bms/staffRoles.ts`) and is not stored in this table — see the RBAC section of
[api.md](api.md) before changing either half.

**AI usage accounting (`7.82__bms_ai_usage_accounting.sql`)** — splits what used to be one
`credits_used`/`estimated_cost` pair on `bms_ai_usage_events` into three independent dimensions:
`billable_credits` (what the tenant was charged — one credit per *logical* request on a finite plan,
zero on an unlimited plan), `provider_calls` (actual provider attempts), and `actual_cost_usd` (metered
cost attributed from provider-reported tokens against the configured rate card), plus
`unpriced_provider_calls` for attempts that returned no usage. `estimated_cost` on both
`bms_ai_usage_events` and `bms_ai_usage_monthly` widens to `NUMERIC(16,8)`, because the old
`NUMERIC(12,4)` rounded small but valid per-request costs to zero. `actual_cost_usd` is nullable **on
purpose**: unknown cost must never be recorded as an authoritative `$0`. `CHECK` constraints keep all
three counters non-negative and `unpriced_provider_calls <= provider_calls`. The backfill classifies
legacy rows (using `meta.provider_calls`, `error_message`, `status`, `source` and `completed_at`) and
stamps `meta.usage_accounting_version = '2'`, so re-running the migration is a no-op. Two indexes
support the read paths: `created_at DESC` for the recent-usage tables and a partial
`(tenant_id, year_month, created_at) WHERE status = 'started' AND completed_at IS NULL` for the stale
reservation sweep. Attempts belonging to one logical request share `meta.usage_group_id`, and
`requests` counts `DISTINCT usage_group_id` — do not treat one event as one billed request.

**Default account language (`7.81__users_language_default_th.sql`)** — changes only the `users.language`
column default from `'en'` (set way back in `1.13`) to `'th'`, because none of the three `INSERT INTO
users` paths set the column and a brand-new account therefore flipped a Thai visitor's UI to English on
first login. Existing `'en'` rows are intentionally left alone: an explicit English choice cannot be
distinguished from an untouched default. The `CHECK (language IN ('th','en'))` from `7.56` still applies.

**Auth hardening (`7.80__auth_session_and_reset_token_hardening.sql`)** —
`users.admin_session_version` invalidates existing admin JWTs after a password or role change;
request authentication compares it with the live user row. `password_reset_tokens.token_hash`
stores only a SHA-256 digest of the bearer token. The legacy plaintext `token` column remains
nullable for migration compatibility but new code never writes or queries it.

**`bms_audit_log`** — append-only, written via `audit(ctx, action, target, meta)`
(`lib/bms/audit.ts`); failures to write are swallowed (never blocks the mutation that triggered it).
The AI runtime writes `ai.tool_call` for every tool success, failure, denial, or proposal. Its meta
contains only surface/outcome/permission/sensitivity/channel—not raw args, prompts, or customer PII.
Successful AI writes also retain their normal domain action, while confirmed sensitive proposals
are audited by the existing GraphQL mutation.
Realtime diagnostics write `inbox.diagnostic_event` for `Emit` and `inbox.diagnostic_message` for
`Create Msg`. The latter also creates ordinary tenant-scoped `bms_conversations`/`bms_messages`
rows using `customer_ref = diagnostic:{channel}:{adminId}`, `sender = diagnostic`, and
`meta.diagnostic = true`; no separate diagnostic tables or migrations are required.

**`bms_store_profile` (`6.9__bms_store_profile.sql`, `7.30__bms_ai_context_strategy.sql`)** —
one row per tenant (`tenant_id` PK), holding the store facts AI may disclose to customers:
business type, name/about/address/phone/hours, shipping and return policies, shop-owned receiving
accounts, and flat/free-threshold delivery estimates. It has forced RLS and explicit `bms_app`
grants; writes run through `beginTenantTx()`. Carrier quotes are not stored or implied—the current
estimate is only the shop-configured flat-rate policy.

Receipt-language extension (`9.39`) stores `receipt_language_mode` (`th`, `en`, or `bilingual`) on
the same tenant profile. It is customer-document policy shared by the POS preview, ESC/POS output,
email, and LINE; it is deliberately independent from the AI language and staff UI preference.

Signup/onboarding extension (`7.42`) — the current store-profile `business_type` remains the broad
AI-facing classification, while the separate optional `business_archetype` field captures richer
onboarding/demo defaults. `bms_pending_shop_signups.business_archetype` stores the value until email
verification, then `verifyPendingShopSignup()` copies it into the first `bms_store_profile` row in
the same transaction that creates the tenant and Manager account. See
[../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md).

Migration `7.43` enforces the shared archetype allowlist at the database boundary (while allowing
`NULL`) and stores durable onboarding state on `bms_store_profile`: completed/skipped step keys,
dismissed time, and last-seen time. It also adds `resolved_order_id` and an order-item
`recovered_revenue` snapshot to restock subscriptions, so recovery KPIs are attributable to a real
tenant order rather than inferred from status alone.

Migration `7.44` adds the intermediate restock `ORDERED` state and a tenant-scoped
`bms_onboarding_seed_runs` ledger. The ledger records completed seed stages and allows a failed or
stale run to resume without repeating already completed stages; RLS and `bms_app` grants match the
other tenant-owned onboarding data.

Migration `9.43` makes `business_archetype` immutable after the tenant's first real order. The
service reads and merges the profile inside a tenant transaction, while database triggers enforce
the same rule for every write path. Both sides lock the tenant row before checking order history;
because `bms_orders.tenant_id` references that row, a concurrent first order and archetype change
are serialized rather than both passing on stale snapshots. Demo-seed orders identified by the
reserved `FAKE-*` customer marker do not establish this lock.

Migration `7.30` also adds validated AI language/ordering/required-field/short-reply/handoff policy.
`bms_inbound_events` is the tenant/channel/platform-event idempotency ledger, while
`bms_ai_synonym_candidates` stores bounded search misses for human review. Both have forced RLS and
`bms_app` grants. `bms_conversations.ai_state` is non-authoritative conversation memory; orders and
stock remain backend sources of truth.

**Multi-store stock capabilities (`9.40`–`9.41`, `9.45`)** — `bms_store_capabilities` stores manual tenant
overrides on top of archetype presets. `bms_product_stock_policies` stores product-level stock mode,
integer base unit, lot/expiry/FEFO flags, kitchen station, and optional scale mapping. Versioned
`bms_product_recipes`/items and product modifiers describe derived consumption. New orders snapshot
the resolved component lines into `bms_order_item_stock_consumption`; `bms_order_stock_lines` prefers
that snapshot and preserves direct/bundle fallback only for historical rows. `bms_kitchen_tickets`
and `bms_inventory_wastage` are tenant-scoped operational ledgers. Every new table has forced RLS,
`bms_app` grants, and composite tenant foreign keys.

**Kitchen station master (`9.54`)** — a station used to exist only as free text on
`bms_product_stock_policies.kitchen_station`, so everything that referred to one referred to it by an
exactly-matching name: SLA thresholds (`9.53`) are keyed by name, tickets stored a name, and the
board's filter was built from whichever names happened to have open work. Renaming a station was
impossible, because the name *was* the identity. `bms_kitchen_stations` gives a station its own id,
an active flag, a sort order and an optional branch scope. Three rules it does not bend:

- **A station is a work area inside a branch — never a branch, and never a stock location.** Stock
  still moves by the order's `location_id`; nothing in `9.54` touches a stock or money path.
- **`location_id NULL` means the station serves every branch**; a non-null one belongs to that branch
  alone, and a bill from any other branch resolves to no station (the ticket lands in the board's
  unassigned column rather than being routed to a kitchen that branch does not have).
- **Tickets store both `station_id` and a `station` name snapshot.** Renaming a station today must
  not rewrite what the kitchen saw yesterday, so `bms_kitchen_tickets.station` and
  `bms_restaurant_kitchen_tickets.station` keep the name recorded at queue time while `station_id`
  is the live reference. Both foreign keys are `ON DELETE SET NULL`, so a station deleted directly in
  the database cannot take menu items or history with it.

Station names are unique per tenant across every branch and both active states, because the SLA table
is still keyed by name; two stations called "บาร์" would give one ticket two different thresholds.
Codes are unique per scope through two partial indexes — a plain `UNIQUE (tenant_id, location_id,
code)` would not constrain the store-wide rows at all, since NULL never conflicts with NULL. The
`9.54` backfill promotes every station name still present in stock policies, SLA rows and both ticket
tables into a store-wide master row, and never drops the legacy text columns: readers that predate
`9.54` keep working through a deploy. `printer_profile_id` is a placeholder with no table behind it,
no reader and no writer — per-station printer routing is not built.

`9.45` adds non-negative `bms_product_modifiers.price_delta`. It is a surcharge per sold menu unit,
resolved from active tenant catalog rows during order creation and copied into the order item's
sale-time `pricing_snapshot`; POS payloads never provide a modifier price. The same migration seeds
the restaurant floor, kitchen-transition and whole-check-cancel permissions for operational roles.
Modifier consumption is intentionally recipe-relative; order creation rejects modifier codes on
DIRECT/PACK products so pricing and stock snapshots cannot diverge.

**`bms_ai_quality_reviews` (`7.31__bms_ai_quality_review.sql`)** — a tenant-scoped review queue that
references the existing Inbox conversation and AI message. It stores only automatic outcome/reason
codes, sampling source, severity, workflow status, and a human verdict/category/note; it does not
duplicate customer or AI message text. Every failure/handoff/unresolved turn is queued, plus a
stable approximately 5% sample of normal turns. Source-message deletion cascades to the review row.
Each message has at most one review. Tenant/date and severity-queue indexes serve dashboard reads;
foreign-key and partial Inbox indexes keep cascade deletion, metrics, and customer-preview lookups
bounded as volume grows. RLS and `bms_app` grants follow the standard tenant-owned table pattern. See
[AI quality control](../ai/quality.md) for metric definitions and privacy behavior.

## Revision checklist

Use revision tables only for records where a before/after snapshot materially improves auditability,
rollback confidence, or dispute handling. For everything else, prefer append-only history tables or
`bms_audit_log`.

### Should have revision history

These entities are likely to benefit from `_revisions` tables or an equivalent snapshot history:

- `bms_orders`
- `bms_order_items`
- `bms_payments`
- `bms_shipments`
- `bms_products`
- `bms_inventory`
- `bms_customers`
- `bms_customer_addresses`
- `bms_customer_identities`
- `bms_suppliers`
- `bms_purchase_orders`
- `bms_purchase_order_items`
- `bms_store_profile`
- `bms_tenant_channels`
- `bms_tenant_ai_config`

### Should not have revision history

These tables are better served by immutable rows, append-only logs, or reference-style updates:

- `bms_plans`
- `bms_role_permissions`
- `bms_tenants`
- `bms_product_categories`
- `bms_ai_usage_monthly`
- `bms_channel_health_log`
- `bms_customer_ai_summary`
- `bms_audit_log`

### Case-by-case

Decide per workflow rather than forcing a blanket rule:

- `bms_conversations` — use revision only if state fields such as assignment/status/tags need
  exact before/after snapshots; otherwise audit/event history is usually enough.
- `bms_messages` — usually append-only; do not add revision unless message edit history becomes a
  product requirement.
- `bms_conversation_notes` — revision is optional if staff edits to notes must be recoverable.
- `bms_stock_movements` — usually the movement rows themselves are the history; revision is only
  needed if you add mutable metadata that must be snapshotted.

### Rule of thumb

- If the row changes money, stock, customer master data, shipping/order state, or AI-visible store
  settings, revision is usually worth it.
- If the row is reference data, usage data, an append-only log, or a derived summary, revision is
  usually wasteful.
- If reviewers only need "who did what and when", `bms_audit_log` is the right tool.

### Suggested rollout priority

If revision history is added gradually, this is the order I would use:

| Priority | Tables | Why first |
| --- | --- | --- |
| 1 | `bms_orders`, `bms_payments`, `bms_shipments` | Highest dispute risk; customers and staff need exact historical state |
| 2 | `bms_products`, `bms_inventory`, `bms_stock_movements` | Stock and pricing mistakes are expensive and hard to reconstruct |
| 3 | `bms_customers`, `bms_customer_addresses`, `bms_customer_identities` | CRM merges and edits need a recoverable before/after trail |
| 4 | `bms_purchase_orders`, `bms_purchase_order_items`, `bms_suppliers` | Procurement history matters, but usually after sales-critical flows |
| 5 | `bms_store_profile`, `bms_tenant_channels`, `bms_tenant_ai_config` | Config changes affect behavior, but can often be audited before revisionized |

### Quick review checklist

Before adding a revision table, ask:

- Can a human dispute this record later?
- Would a rollback need the exact previous row state?
- Is the table frequently edited instead of appended to?
- Would an audit log alone be enough?
- Does the record affect money, stock, or customer trust?

If the answer is "yes" to the first, second, or fifth question, revision is usually justified.

### Migration plan

The repo carries a generic revision pattern (`create_revision_trigger()` /
`trg_generic_revision()`). Migration `7.0__bms_revision_helpers.sql` standardizes it for BMS by
creating tenant-scoped `<table>_revisions` tables, enabling RLS, granting `bms_app`, and recording
`app.editor_id` / `app.revision_id` from the current transaction. `beginTenantTx()` accepts
`{ editorId }` for attributable tenant writes. That means rollout can be incremental instead of a
database rewrite.

Recommended plan:

1. Confirm the target tables for revision and freeze the initial scope.
2. Add one numbered migration that creates or reuses the generic revision helpers if the current
   database does not already have them.
3. Add revision tables for the first rollout batch only:
   - `bms_orders`
   - `bms_payments`
   - `bms_shipments`
   - `bms_products`
   - `bms_inventory`
4. Backfill only if the business truly needs historical snapshots from before the migration date.
   For most tables, starting from the migration timestamp is enough.
5. Add second-batch revision tables in a later migration:
   - `bms_customers`
   - `bms_customer_addresses`
   - `bms_customer_identities`
   - `bms_purchase_orders`
   - `bms_purchase_order_items`
   - `bms_suppliers`
6. Add config-facing revision tables only after the operational tables are stable:
   - `bms_store_profile`
   - `bms_tenant_channels`
   - `bms_tenant_ai_config`
7. Leave append-only logs and reference tables as-is; do not force them into revision just to be
   consistent.
8. Verify:
   - the revision trigger fires only on update,
   - the revision row stores the correct editor/revision id,
   - RLS and grants still apply to the new tables,
   - reads and writes to the parent tables remain backward compatible.

Implemented migration shape:

- `7.0__bms_revision_helpers.sql` creates/replaces the helper functions.
- `7.1`–`7.3` are broad batch wrappers for core/purchase/config revision tables.
- `7.4`–`7.14` are narrower per-domain wrappers for teams that prefer applying one area at a time.
- Minimal snapshot columns: `id`, `tenant_id`, `editor_id`, `revision_id`, `snapshot`, `created_at`.
- Revision rows store the row state before `UPDATE`; they do not backfill changes made before the
  trigger existed.
- The admin UI at `/admin/revisions` supports list/detail/compare for products, orders, payments,
  and shipments through GraphQL.
- No business logic in the migration beyond table/trigger setup.
- One follow-up validation step per batch using the existing integration or SQL smoke checks.

If a future table needs revision, prefer another small wrapper that calls `create_revision_trigger()`
instead of duplicating trigger DDL.

## Adding a table for a new module

Copy the RLS policy from `4.2` and the `bms_app` grant from `4.3` for any new `bms_*` table — see
the "adding a new module" checklist referenced from [CLAUDE.local.md](../../CLAUDE.local.md).

## Fake evaluation ground truth (`9.16`)

`bms_fake_eval_runs` stores an immutable, tenant-scoped snapshot and SHA-256 fingerprint of a fake
store dataset. `bms_fake_eval_cases` stores the corresponding questions, typed expected values,
tolerances, and bounded evidence references; `bms_fake_eval_results` preserves submitted structured
answers and deterministic scores. All three tables use tenant RLS, `bms_app` grants, and cascade with
the tenant/run. The migration grants `bms_app` only the additional non-PII `users` flags needed for
staff/POS/pharmacist counts; it does not widen access to password, PIN hash, email, or phone. These
tables are QA answer-key storage only: no customer or staff AI tool exposes them.

Full-shop fake seeding writes the run only after all business fixtures succeed. A later data change
does not rewrite history; per-domain row signatures make even a non-aggregate product/message edit
change the fingerprint. The service reports that run as stale and refuses to score against it. Fake
cleanup deletes the run, which cascades its cases and score history.

## Branch visibility and policy scope (`9.37`)

`bms_coupon_locations` stores the optional branch allow-list for a discount code. The primary key is
`(tenant_id, coupon_id, location_id)` and all foreign keys include tenant-owned parents, so a coupon
cannot be scoped to a branch in another shop. No rows means "usable at every active branch"; rows
present means "usable only at these branches". The table has tenant RLS and `bms_app` grants.

`bms_user_allowed_locations` is the Phase 4 foundation for branch-restricted staff access. It is
tenant-scoped by `(tenant_id, user_id, location_id)`, has tenant RLS and `bms_app` grants, and is
deliberately optional for backward compatibility: no rows for a user preserves existing tenant-wide
RBAC until each page/mutation is wired to enforce the allow-list.

## Restaurant POS (`9.44`–`9.49`)

`bms_restaurant_areas` and `bms_restaurant_tables` are branch-owned floor configuration.
Migration `9.59` adds each table's `shape` (`round`/`rect`) and non-negative pixel coordinates
`position_x + position_y`. Areas remain ordered tabs rather than drawable regions. Existing tables
are backfilled into a four-column grid per area so an upgraded floor never opens as one overlapping
stack. Admin edits soft-delete areas/tables to retain closed-check history; every write is tenant- and
branch-validated and audited in the same transaction.
Composite foreign keys added in `9.47` require an area's table and a table's check to carry the same
`tenant_id + location_id`; tenant isolation alone is not enough because one tenant can own several
branches.
Migration `9.49` extends the same database-level chain through
`location -> POS device -> shift -> restaurant check`, including the device id carried by the shift;
a UUID from another branch or tenant can no longer satisfy a restaurant check FK even if supplied by
SQL outside the service.
`bms_restaurant_checks` is the open dine-in service state, with a partial unique index allowing only
one OPEN/CLOSING check per table. `version` changes with cart edits and `reserved_version` records the
version represented by `current_order_id`; checkout requires equality so unsent food cannot bypass
stock reservation or the kitchen. Replacing that order for a later kitchen round is atomic: the old
PENDING order is cancelled and the new whole-check order is created through `createOrderInTx()` in
the same tenant transaction. An insufficient new basket therefore rolls back to the prior order and
reservation instead of leaving already-cooking lines unexplained. Check cancellation likewise closes
the order, reservation, tickets, check and audit in one transaction.

Migration `9.48` adds `settlement_attempt_id + settlement_started_at`, making `CLOSING` a
cross-instance lease: an active cashier cannot be overwritten by another register, while a crashed
attempt becomes recoverable after the bounded lease. The check changes to `PAID` inside the same POS
transaction as payment, stock, FEFO and tax; `9.48` also repairs legacy OPEN/CLOSING checks whose
linked order had already reached `COMPLETED` in the old two-transaction flow.

`bms_restaurant_check_items` keeps menu, pack, modifier and kitchen-note snapshots by service round.
`bms_restaurant_kitchen_tickets` drives pre-payment KDS states independently from the completed-order
tickets introduced in `9.40`; because those tickets exist before any sale, the kitchen board's
`orderId` is nullable and dine-in rows identify themselves by table and round instead. The settling `bms_orders` row references `restaurant_check_id`, both to
preserve traceability and to suppress duplicate kitchen-ticket creation during POS fulfilment. All
five new tables have tenant RLS and `bms_app` grants; editable floor/check records use revision
triggers, while the high-volume ticket state is represented by its audit events.

`9.45` does not add a second payment or kitchen ledger. Split tender continues to write the normal
POS payment allocations, and KDS polling reads the existing branch-scoped ticket rows. Its only
schema addition is modifier catalog pricing plus the restaurant-specific RBAC seeds.

## Product catalog foundation (`9.51`)

`bms_product_variants` stores product options independently of branch stock. Its composite primary
key is `(tenant_id, product_sku, code)` and its product FK is tenant-composite. Migration backfill
unions inventory, pack, recipe and modifier sizes; insert triggers on those four legacy sources keep
older writers compatible without creating stock.

`bms_product_sales_surfaces` stores explicit product visibility for retail POS, restaurant POS,
public storefront, customer AI and online order creation. `bms_products.active` remains lifecycle
state; reads and order creation require both active and the appropriate enabled surface.

`bms_product_modifier_groups` owns per-product/variant selection rules. Existing modifier rows are
backfilled into an `OPTIONS` group and receive `group_id`, `default_selected` and `sort_order`.
All three new tables carry tenant RLS, `bms_app` grants and revision triggers. The modifier group FK
includes `tenant_id`, preventing a modifier from linking to another shop's group.
# Restaurant online order acceptance (9.56)

`bms_orders.fulfillment_type` (`DELIVERY`/`PICKUP`) and `promised_at` are first-class fields so the
incoming queue and kitchen can sort without parsing notes. `bms_store_profile` stores validated
weekly `restaurant_order_hours` plus the audited whole-shop pause state. An online restaurant order
reserves stock when created, but payment does not start cooking: a human at the order's branch moves
it from `PAID` to `PACKING` and creates kitchen tickets in the same tenant transaction.

## Restaurant line cancellation (9.57)

Restaurant line cancellation reuses `bms_pos_returns`, its item rows, refund allocations, pricing
snapshots, loyalty reversal, and audit transaction. `pos_device_id = NULL` identifies the online
path. Each return item records an immutable merchant/customer cause; a branch sold-out flag forces
the merchant cause. Repricing differences absorbed by the shop use the distinct
`MERCHANT_ABSORBED` order-discount source and accumulate on conflict. The store-level approval limit
defaults to ฿2,000. `order.line.cancel` is seeded to Manager and Cashier without widening
`order.return`.
