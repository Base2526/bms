# BMS status log

Per-feature decision narrative moved out of [CLAUDE.md](../CLAUDE.md) on 2026-10-13 to keep the
always-loaded agent context small. The moved text is unchanged; newest entries are at the end.
Entries were brought up to date on 2026-11-09 (through migration `10.111`, PR #406 and the
release-manifest commits). The compact area index lives in CLAUDE.md § Current status; full
per-domain rules live in [agent-invariants.md](agent-invariants.md).

## Current status summary (as written 2026-11)

Not production-ready (🧪): **Shopee/Lazada** (beta, signatures unverified) · **Flash/Kerry carriers**
(safety layer done, adapters await a real merchant contract) · **AI Pharmacy Intake** (flag-gated
off) · **e-Tax submission** (built, gated off by default, no signing/submission provider verified) ·
**ESC/POS printing and cash drawer** (browser WebUSB code and the native app's Wi-Fi/LAN raster
receipt printing are written and unit-tested but never certified on real hardware) ·
**Windows/Linux/macOS desktop POS client** (MVP shell — every package is unsigned, with no
auto-update and no offline tender) · **Delivery platforms** (foodpanda sandbox/shadow only; GrabFood
and LINE MAN contract-blocked; no provider is live-ready) · **Retail Local** (technical pilot, not
Commercial/GA — installers are unsigned and clean-machine/restore/failure drills are still open) ·
**Tax-invoice PDF email and the SMTP relay** (built, not yet sent through a real provider) ·
**Automated AI plan billing** (none; plan prices are catalogue evidence, not payment) · **Q4
profit/growth simulation** (planned). Pharmacy guidance texts have not been clinically reviewed by a
licensed pharmacist.

Built but explicitly not rolled out: lot identity through branch transfers (`10.107` — committed and
clone-DB verified, WIP for rollout, production deployment unverified); bank reconciliation
(`10.110`, both feature flags off by default, migration-first controlled pilot); branch requisitions
and store operations (`10.87`–`10.88`, `10.91`–`10.98`, code built, not piloted); platform master
data (`10.76`–`10.86`, pilot data review pending). A migration file in the repository is not
evidence that a target database has it — check the target before claiming a feature there.

Everything else in the CLAUDE.md area index is built. POS counter sale/return/refund and Thai tax
invoicing (migrations `7.84`–`7.95`), membership/tiers/loyalty points (`7.96`), parked bills +
drawer movements + void + shift report (`7.97`, hardened through `9.5` with idempotent drawer cash
movements, whole-bill serial checks, and shift-report correctness fixes), inter-branch stock
transfers + stock counts (`7.98`), and a keyboard-wedge Scan Manager plus retry-safe PO receiving at
the register (`9.6`) are fully built — see [business/pos.md](business/pos.md) and
[business/inventory.md](business/inventory.md). The `8.0`–`9.4` POS additions — blind close/no-sale
(`8.0`), wholesale price tiers (`8.1`), blind returns (`8.2`), serials (`8.3`), commission (`8.5`),
non-stock charge lines (`8.6`), promotions (`8.7`), bundles and scale barcodes (`8.8`), gift
cards/store credit (`8.9`), deposits (`9.0`, `9.2`) and branch management (`9.1`, repairs
`9.3`–`9.4`) — each have their own section in those two documents. Their per-migration build/verify
narrative, like that of later migrations, is archived in
[local-notes-archive.md](local-notes-archive.md); search it by migration number (for example
`grep -n "8.7" docs/local-notes-archive.md`).

The native iOS/Android register has one-shot camera scanning and an explicitly opened, focused
Bluetooth/USB HID mode. It remembers camera versus hardware input on the device, keeps the modal
open for consecutive scans, suppresses CR+LF duplicates, and preserves the existing modifier/pack
selection flow. Global hardware-key capture outside that modal and real-device scanner certification
remain rollout work; this is not the browser Scan Manager's global PREFIX mode.

The commercial intelligence roadmap is built through **Q3**: Phase 1 bundles the daily Action Center
and inventory purchasing intelligence (`9.12`–`9.13`, extended per branch by `10.99`–`10.100`),
while Phase 2 adds the monthly customer retention engine (`9.14`) with RFM/risk scoring, verified
next-product evidence, a propose-only comeback queue, deterministic holdout, and bounded 30-day
conversion attribution. See [ui/dashboard.md](ui/dashboard.md),
[ui/retention-engine.md](ui/retention-engine.md), and [business/crm.md](business/crm.md). Q4
profit/growth simulation remains planned. The commit-bound release inventory is
[release-feature-control.md](release-feature-control.md).


## Feature entries

**REST surface hardening (2026-08-24, no migration)** — `middleware.ts` only guards `/admin/**`, so
every route under `/api/**` needs its own check. Twenty-three single-tenant-era routes had none:
`/api/bms/reserve` could reserve stock in *every* shop selling a SKU without logging in, and the
order/payment/purchase/shipment/report/inbox routes let an anonymous caller act on the default shop.
All now use `authorizeAdminRoute(<permission>)` with the tenant taken from the signed session; two
webhook mocks that cannot check a session are 404 in production, the public demo endpoint gained a
rate limit, and the two upload routes — authenticated but permission-less — now require the
permission the step that consumes the file needs. `/admin/products` also gained a drill-down that answers "who is holding this reserved
stock". Details: [business/inventory.md](business/inventory.md) and
[architecture/api.md](architecture/api.md).

**Global AI Work Assistant (2026-08-28, no migration, no new permission)** — the staff tool-calling
runtime now also serves `bmsWorkAssistant` from a Drawer on every back-office page, grounded on a
deterministic bilingual catalog (51 capabilities, 119 guides, 20 FAQ answers, 24 limit groups/139
rules per language — counted from the catalog module on 2026-10-02; counts drift as features ship, so re-count
before quoting them, and note the board-game queue/reservation/offer/renewal work is **not yet** in the catalog)
covering every Sidebar
destination and every routable Admin page. `/pos` gets the same catalog as offline guide search with
no GraphQL/AI call, so a `pos_only` cashier is never pulled toward `/admin`. No new tool executes
anything a permission did not already allow. The FAQ *and* the limits/traps moved out of
`/admin/manual` into the catalog, so the page and the assistant read one array instead of two copies. Every question the product asks
is pinned to the entry that must *lead* its answer (`scripts/ai-eval/work-assistant-question-corpus.mts`)
— retrieving the right guide at rank 6 is a failure, not a pass. Coverage, status vocabulary and the
regression gates: [ai/work-assistant-coverage.md](ai/work-assistant-coverage.md).

**Credit sales and accounts receivable (`9.30`, written 2026-08-27)** — a `CREDIT` payment method
completes an order and deducts stock like any other sale, but opens an AR invoice in the same
settlement transaction instead of counting toward drawer cash; collecting the debt later is a drawer
cash-in on the *collecting* shift, never a payment added to the old order. Credit limits are checked
before order creation and again under the account lock after stock settlement, and a return against
`CREDIT` reduces the debt immediately — a resulting negative balance transfers to the oldest open
invoice under that lock rather than reporting debt the customer no longer owes. `ar.writeoff` stays
separate from `ar.manage`. See
[agent-invariants.md § POS and tax](agent-invariants.md#pos-and-tax).

**Shop archetype lock + bilingual labels (2026-08-31)** — the `9.40`–`9.43` archetype work expanded
the catalog and now locks `business_archetype` after the tenant's first real order; the dropdown
labels themselves now live in the shared `th`/`en` dictionary. Demo rows marked with `FAKE-*` stay
editable, but real order history freezes the preset so AI guidance, onboarding checklists and
capability defaults cannot drift behind the business record. See
[ui/shop-signup-archetype-spec.md](ui/shop-signup-archetype-spec.md) and
[shop-archetype-guide.md](shop-archetype-guide.md).

**Restaurant POS (`9.44`–`9.45`, 2026-09-01)** — `/pos/restaurant` is a separate operating surface
selected only for the `restaurant` archetype: floor plan, open checks, kitchen rounds sent before
payment, table moves, split-tender checkout and a branch-scoped kitchen display. It reuses the one
POS settlement engine (`recordPosSale()`), so money, stock, FEFO lots, the drawer and tax documents
keep a single formula. `9.45` closes the remaining core gaps: a modifier's `price_delta` is
server-owned catalog data resolved inside the order transaction and snapshotted into that line's
sale-time pricing — the register submits codes, never prices — and floor setup, kitchen transitions
and whole-check cancellation get semantic permissions (`restaurant.floor.manage`,
`restaurant.kitchen.update`, `restaurant.check.cancel`) instead of borrowing `pos.device.manage`
and `order.ship`. Replacing a check's reservation for a later round now happens in one transaction
through `createOrderInTx()`: a round that cannot be reserved rolls back to the previous order rather
than leaving food already cooking without reserved stock. See
[business/pos.md](business/pos.md) § Restaurant POS and
[architecture/database.md](architecture/database.md) § Restaurant POS.

**Product catalog foundation + multi-store stock capabilities (`9.40`–`9.43`, `9.51`–`9.52`,
2026-08-31–09-02)** — `bms_product_variants` is now the source of truth for a product's
serving/size options, independent of branch stock: a `RECIPE`/`NON_STOCK` item's own inventory row
stays at zero on purpose, so a variant can exist while every branch has zero stock. Inventory/pack/
recipe/modifier writes sync a variant row into it one-way; reading `bms_inventory` to discover a
product's sizes is wrong for these policies and was found live in the AI chat stock-check path.
`bms_product_sales_surfaces` makes channel visibility explicit
(`RETAIL_POS`/`RESTAURANT_POS`/`PUBLIC_STOREFRONT`/`CUSTOMER_AI`/`ONLINE_ORDER`) and separate from
`active` lifecycle state; a new/imported product is a draft until a surface is turned on. `NON_STOCK`
(`9.52`) sells with zero ingredient tracking, using `cost_price` for margin reporting, as a stepping
stone toward `RECIPE`. Of the thirteen `bms_store_capabilities` flags an archetype preset can carry,
only five gate real behavior (`RECIPE`, `MODIFIER`, `WEIGHTED_PRODUCT`, `WASTAGE`,
`KITCHEN_WORKFLOW`); the rest describe what the shop's data already looks like. See
[business/inventory.md](business/inventory.md) §§ Multi-store stock policies / Catalog
lifecycle and [agent-invariants.md](agent-invariants.md#product-catalog-variants-sales-surfaces-and-stock-policies).

**Kitchen stations (`9.53`–`9.54`, 2026-09-02–09-03)** — a station is a registered work area
(`bms_kitchen_stations`: id, active flag, sort order, optional branch scope), not a free-text label
and not a branch. Tickets carry both `station_id` and a name **snapshot**, so renaming a station
never rewrites what the kitchen already saw, and a branch-scoped station's bills from elsewhere
route to an unassigned column instead of a kitchen that branch doesn't have. Per-station SLA
thresholds color the register KDS and `/admin/kitchen`; a station stays open to new tickets even
after being deactivated, because losing food off the board from a settings change is worse than a
ticket sitting on a station being retired. See [business/pos.md](business/pos.md) § Kitchen
stations.

**Restaurant chat ordering + delivery (`9.55`–`9.57`, 2026-09-04)** — a `restaurant`-archetype shop
can now take food orders through chat/online and hand them to the kitchen and a delivery rider,
reusing the existing `flat` shipping mode and prepaid-only checkout rather than building a second
fulfillment model. A branch can mark one menu item "sold out today" (`9.55`) without touching
`bms_products.active`; the flag resets on the earliest of a 15-minute cron (honoring each shop's own
reset time/timezone) or the branch's next shift-open — shift-open clears only closures whose
service day has actually ended, never the whole branch, because a shift belongs to a device and a
cashier, not to a service day. An online order requires an explicit branch and `DELIVERY`/`PICKUP`
choice (`9.56`); payment alone never creates kitchen work, only a human `PAID -> PACKING` accept
does. Line cancellation (`9.57`) reuses the POS return engine rather than a second money path,
writes an immutable merchant/customer cause, and reprices/absorbs/queues a refund exactly like a
counter partial return. A same-day recheck found and fixed ten defects before this shipped
end-to-end, including a query ordering by a `bms_locations` column that does not exist (every
online order failed to create), a migration that could drop the wrong `bms_order_discounts` check
constraint, and the same "read `bms_inventory` instead of the catalog variant" mistake called out
above — see [business/restaurant-chat-delivery.md](business/restaurant-chat-delivery.md) for
the full brief and [local-notes-archive.md](local-notes-archive.md) § Restaurant chat delivery rollout
(2026-09-04) for the incident-by-incident record.

**Pharmacy non-clinical customer assistance (`10.44`, 2026-10-07)** — fixed medication-advice
handoff remains active with intake disabled. Pharmacy-only reads expose shop-transcribed label
facts, bounded expiry snapshots, historical shift evidence (not confirmed presence) and own-case
status/expiry without health content. No invented reply ETA or clinical activation. See
[pharmacy README](../apps/web/lib/bms/pharmacy/README.md#non-clinical-customer-assistance-1044).

**Restaurant customer answers + reservation requests (`10.43`, 2026-10-07)** — customer product
tools now read structured, shop-maintained positive allergen declarations and dietary labels; an
empty/unreviewed declaration remains unknown and cross-contact is never guaranteed. A branch-safe
aggregate tool reports current table/queue/kitchen counts but deliberately returns no invented
wait/preparation estimate. Chat may submit a table `REQUESTED` row linked to the canonical customer,
but only a PIN-authenticated `pos.sell` operator can accept it into the operational waitlist; the
server-built reply always says the table is not reserved or confirmed yet.

**Restaurant floor editor + table QR self-ordering (`9.59`–`9.60`, `9.62`, 2026-09-06)** —
`/admin/restaurant-floor` lays out zones and tables by drag-and-drop and prints one rotatable QR per
table; a guest who scans it gets a menu bound to that table's **already-open** check and can only
send a `PENDING` proposal, which a PIN-verified `pos.sell` operator accepts (lines + reservation +
kitchen round in one transaction) or rejects with a reason. Possession of a printed token identifies
a table, never a right. A recheck of the whole restaurant surface fixed three things that made the
feature unsafe or unusable in a real service: `9.62` stops the QR expiry trigger from firing on the
reversible `CLOSING` settlement claim — before it, **one mismatched payment silently destroyed every
waiting proposal at that table and cut every guest's phone, permanently**; the "sold out today" gate
moved from order-rebuild time to the moment a line enters a check, because re-gating a whole dine-in
check made a dish marked sold out *after* it was served block that table from sending another round
or paying at all; and every floor operation (including QR rotation, which invalidates a sticker on a
physical table) now resolves the owning branch and honours `bms_user_allowed_locations`. See
[business/pos.md](business/pos.md) § Table QR self-ordering and
[agent-invariants.md § Restaurant POS](agent-invariants.md#restaurant-pos-dine-in).

**Transactional realtime invalidation (`9.70`–`9.74`, `9.84`–`9.86`, updated 2026-09-14).** The shared event
contract, outbox, domain triggers, leased dispatcher, hardened database-free WS gateway,
HTTP-minted tickets, one generic stream and 18 named views pass pure and local DB contracts.
`9.73` fixed the first POS device row-shape failure and `9.74` split the device/shift trigger
functions permanently; `9.84` filters heartbeat noise, `9.85` closes the final 20 known
business-table coverage gaps, and `9.86` invalidates parked bills when resume/discard deletes them.
The coverage guard now checks each `INSERT`/`UPDATE`/`DELETE`, not only whether a table has some
trigger. A live local probe has also proved HTTP ticket minting and PostgreSQL ->
outbox dispatcher -> Redis -> two WS instances. Browser POS and `apps/mobile` now call named views;
RN also compiles generated Apollo operations and verifies cashier PIN through GraphQL. Keep REST and
polling until per-workflow parity plus production recovery/load proof pass. Rollout flags gate
*delivery only* — see
[agent-invariants.md § Realtime invalidation](agent-invariants.md#realtime-invalidation-architecture).
**`apps/ws` and `apps/web` deploy together or not at all**, `WS_ALLOWED_ORIGINS` has no safe
default, and every Redis command on this path is time-bounded — the deployment requirements and
what each gets wrong are in
[architecture/realtime-production-audit.md](architecture/realtime-production-audit.md#deployment-requirements-verified-2026-09-14).

**Board game cafe (`9.79`–`9.83`, 2026-09-14).** The `board_game_cafe` archetype now has an
operational module for timed table play without turning play time into a Product field. Board-game
tables, time rates, participants/bill groups, fixed-duration alerts, member lookup, playable game
library copies, POS handoff, receipts/reprints and opt-in public nearby-store discovery are wired
through `apps/web/lib/bms/boardGameCafe.ts`, thin REST routes, `/admin/board-game`, `/pos`, and the
public `/board-game` directory. Settlement still uses the existing POS order/payment path, while
public discovery exposes only published profile data, rates, game highlights and aggregate table
availability. The platform-admin fake seeder now creates a removable full operator dataset for this
archetype, including members, alert states, split billing groups, loans/issues and an unpublished
discovery draft. Member passes (`9.92`), encrypted identity holds (`9.93`) and automatic renewal
(`10.4`) have since landed; board-game profitability/utilization analytics remain a later
reporting phase. See
[business/board-game-cafe.md](business/board-game-cafe.md).

**A board-game bill belongs to a group, not a table (`9.89`, 2026-09-15).** `9.80` put the money on
the table session — one settlement key, one frozen snapshot, one settling order — so a split table
could produce only one bill and "this group pays and leaves" had nowhere to be recorded.
`bms_board_game_billing_groups` now owns the settlement state; the session owns seating and timing.
An unsplit table still produces exactly one bill, because one group is created for it. Closing a
table closes every open group into **one bill each**, charging only that group's people, and the
table's status is derived from its groups — paying one bill never frees a table where another group
is still playing. Every operation that names a bill takes a group id; a table id is ambiguous the
moment the table is split. The session's own money columns are kept as history and are no longer
written. This is phase 1 of moving the billing unit from the table toward the person; table moves
that do not touch billing build on it.

**A board-game bill can be ordered onto during play (`9.90`, 2026-09-15).** Phase 2: staff add
snacks and drinks to a group's tab while the table is still playing, and the stock is reserved at
that moment — because the drink is already gone, and an unreserved one can be promised to a second
table that only finds out at settlement. `bms_board_game_group_items` is the tab; the group's
PENDING order is a reservation derived from it and rebuilt whenever the lines change. Settlement
releases that reservation **inside the same transaction** that builds the final bill, so stock is
never briefly free. Closing a table bills the tab and the play time on one order. See
[business/board-game-cafe.md](business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).

**A board-game group can pay while the others keep playing (Phase 3, 2026-09-15).** The register can
freeze one `OPEN` billing group, settle its time plus tab through the existing POS flow, and leave
every other group accruing time on the same occupied table. The session status remains derived from
all groups, so paying the early bill never frees the table. Game loans belong to the session: an
early group may leave while a copy remains in use, but the final open group cannot close until all
copies are returned. Browser REST and native GraphQL expose the same `group.close` operation and
checkout is addressed by billing-group id throughout.

**A board-game table can be moved or merged without touching a bill (`9.91`, 2026-09-15).** Phase 4
splits *where a party sits* from *whose visit it is*: `bms_board_game_seatings` is the current
physical occupancy of one table, and a session points at the seating it currently occupies. Moving
sends the selected party to a free table — the seating itself when the party sits alone, a detached
new seating when the table had been merged, so merging is not a one-way door. Merging sends every
party at a table into an occupied destination and closes the source as `MERGED`; several sessions
then share one card on the floor while each keeps its own clock, tab and bills. Neither command
touches a session, billing group, tab row or order. `bms_board_game_sessions.table_id` becomes
history — the table the visit *opened* at — so every "which table is this?" read goes through the
seating, and a table is free only once every session sharing it is settled or cancelled. See
[business/board-game-cafe.md](business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).

**A board-game member can pay for play time in advance (`9.92`, 2026-09-15).** Phase 5 sells a
monthly unlimited pass or an hour bundle as an **entitlement, not a Product** — no SKU, no stock,
with the plan's price/kind/minutes snapshotted onto the member's contract so a later price change
never rewrites what was sold. The minute balance is a cache of `bms_board_game_pass_ledger`.
Coverage is applied when a billing group is **closed**, which is the one moment a group claims
settlement exclusively: the passes are locked, the frozen charge snapshot records the gross amount,
covered minutes and covered amount per person, and the minutes are spent in the same transaction —
a preview never spends a quota. An unlimited pass leaves exactly ฿0, and such a bill is the only
sale in the platform allowed to settle with no payment lines. Closing twice spends nothing twice,
and cancelling a table that was already closed gives the minutes back. Selling a pass is its own
permission (`board_game.pass.manage`) in the shape gift cards already use; taking the money still
goes through the existing POS sale. See
[business/board-game-cafe.md](business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).

**A board-game cafe holds a card, not an ID database (`9.93`, 2026-09-16).** Phase 6: the card a
cafe keeps while a game box is out becomes a record instead of a slip of paper. A hold belongs to
the **visit**, not to the member, and the number is optional — a shop that only keeps the physical
card still gets the gate, and requiring the number would push it back to paper. When typed, the
number goes through `encryptSecret()` before it touches the table and only its last four characters
ever leave the server. **Handing the card back erases the name, the number and the tail in the same
transaction**, leaving a tombstone that still answers "did it go back, and who handed it over"; a
hold that is still `HELD` keeps its number on purpose, because that is the incident it was recorded
for. **A table cannot end while a card is held** — at all three exits (last billing group, whole
table, cancel), and only at the last group so an early-paying party still leaves normally. Reading a
stored number back is its own permission (`board_game.identity.reveal`, Manager), exists only in the
back office, and is audited every time: a register is a shared screen that faces the customer. See
[business/board-game-cafe.md](business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).

**Board-game branch and checkout hardening (`9.94`, 2026-09-16).** A sold member pass now snapshots
its branch, so editing a plan cannot move old entitlements and a branch pass cannot cover another
branch's visit; scoped lists and outstanding totals use the same contract scope. Pass issuance
rejects a missing branch for branch plans, validates linked orders in-tenant, and hashes every
semantic field for idempotency. Identity holds can be taken only while a session is `OPEN`, final
POS settlement rechecks old held-card rows, and the settlement lock order is session → billing group
→ order to match close/cancel and remove the payment-time deadlock.

**Reports that can be persisted, and profit that cannot be rewritten (`9.95`, `9.97`,
2026-09-17).** `/admin/reports` grew past its original three exports, but
`bms_generated_reports.report_type` still carried the `7.53` CHECK — the new management reports were
generated and then refused at insert. `9.95` widens it. `9.97` is the larger rule: historical profit
used to join **today's** `bms_products.cost_price`, so editing a cost silently rewrote last quarter.
Each sold line now carries `cost_amount_snapshot` with a `cost_snapshot_source`; new sales are
`CATALOG_AT_SALE` and rows reconstructed at migration time say so, because a reconstruction must
never be presented as equally authoritative evidence.

**A board-game guest can call staff without touching the bill (`9.96`, scope hardened by `9.98`,
2026-09-17).** A table QR (`/bg/...`) raises a service call. It is operational work only: it never
moves play time, a bill, stock, or a game-copy condition, and a reported game problem still goes
through the existing loan/issue path. The call is session-scoped, so move/merge resolves the current
table from the seating and a terminal session revokes the guest token and expires its open calls.
`9.96` copied branch/session/token/table ids onto the call row for fast reads but proved only tenant
ownership one pair at a time; `9.98` adds the composite constraints, so a future writer cannot
assemble a session, token and table from three different branches of the same tenant.

**A party without a table is its own state (`9.99`–`10.2`, 2026-09-17).** A board-game session only
starts once a party has a real table, so everything before that lives in
`bms_board_game_waitlist` — never a second clock, bill, stock reservation or POS path. A walk-in
takes a queue number scoped to the branch **service day** (shop timezone, 04:00 by default), because
a cafe open past midnight must not hand out queue 1 in front of people who have waited an hour.
Seating locks the row and calls `openBoardGameSessionInTx()` in the same transaction, so a commit
can never leave a seated queue with no clock. `10.0` adds advance reservations as the same row with
`kind = 'RESERVATION'`, serialized per table by an advisory lock; check-in converts the promise into
today's queue. `10.1` opens an explicit per-branch public request: the customer gets `REQUESTED`,
not a table, until PIN-authenticated staff confirm it under the same overlap checks, the manage
token is stored only as a SHA-256 hash, and reminder delivery is a retryable projection that is
never authority for the booking. `10.2` completes it — branch-local time input, bounded
request/payment expiry, decision-delivery evidence, and a reservation **deposit carried by the
existing payment ledger**: a deposit is a liability until it is applied to a real POS order, never a
Product SKU and never a second board-game money ledger.

**A play-time package is chosen by the server, not by the register (`10.3`, 2026-09-18).**
`bms_board_game_offers` holds typed rules over the frozen play-time charge only — percentage off,
fixed price per person, or one fixed price for the billing group — optionally scoped by
branch/date/weekday/time and gated on a minimum duration, party size, or an exact SKU that is
**already on the group's real tab**. That SKU stays an ordinary Product line with its normal
reservation and stock movement; an offer never manufactures an included item. At group close the
server evaluates every eligible offer, compares the best result with member-pass coverage, and
freezes the winner into the charge snapshot — they never stack, and a tie chooses the offer so no
pass quota is burned. Both registers read that frozen amount and show one compact explanation; the
catalogue is Admin-only (`board_game.offer.manage`). See
[business/board-game-cafe.md](business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](agent-invariants.md#board-game-cafe).

**A member pass can renew itself, but only from real money (`10.4`, 2026-09-18).** The platform has
no verified stored-card provider, so automatic renewal is deliberately funded by **store credit
bound to the same CRM customer** — pretending to charge a card would be a promise the system cannot
keep. Staff enable it from an active pass and record consent; the agreement snapshots the sold terms
and branch, and each due cycle creates a **new** pass instead of extending the old entitlement. The
frequent guarded cron (`/api/bms/board-game/pass-renewals/run`) locks one agreement and its funding
credit, then writes the pass, its ledger `ISSUE`, a confirmed `BOARD_GAME_MEMBER_PASS` payment and
the store-credit `REDEEM` in one transaction. Expired, foreign or insufficient credit creates no
entitlement at all: the agreement becomes `PAST_DUE` and retries the same scheduled cycle. The
generic payment-refund button refuses a renewal payment, because it knows neither whether the pass
was used nor which credit to restore, and marking money refunded without moving any is worse than
no button.

**A register can say what went wrong on it (no migration, `support.logs.view`).**
`POST /api/pos/diagnostics/events` accepts bounded batches of device telemetry on a device token,
rate-limited per device, with tenant/branch/device derived from that token and the actor recorded as
`pos:<device id>`. It deliberately needs **no cashier PIN**: it touches no money, stock or document,
and the events worth having most — a rejected token, a failed bootstrap, a dead network — happen
before anyone has typed one. Staff read them back through `bmsPosDeviceDiagnostics` on
`/admin/pos-devices`, gated by `support.logs.view`.

**A desktop register is a window onto `/pos`, not a second register (`apps/desktop`, no
migration, no permission).** The Electron shell for Windows, Linux and macOS hosts the same authoritative
`/pos`, `/pos/restaurant`, `/pos/display` and `/pos/manual` routes: it carries no database, no
pricing and no settlement path, and can do nothing a paired browser register cannot already do.
What it does own is the credential — first-run pairing verifies the device token through
`/api/pos/session`, stores it through the OS keystore (`safeStorage`: DPAPI · Secret Service/KWallet
· Keychain) instead of `localStorage`, and hands it to the renderer only across an IPC bridge that
refuses any frame which is not the setup page or a paired `/pos` frame on the paired origin.
**On Linux the shell fails closed**: Electron's `basic_text` fallback is not acceptable protection
for a bearer credential, so pairing is blocked with an actionable message until Secret Service or
KWallet is available. Packaging is Windows NSIS, Linux AppImage/DEB (x64) and macOS DMG for both
Intel and Apple Silicon — **every one of them unsigned**, so macOS Gatekeeper blocks a first launch
and these are internal-test builds, not a distribution channel. `desktop-linux.yml` and
`desktop-macos.yml` lint, test and build their own platform on its own runner and upload a 14-day
artifact; neither signs, notarizes nor publishes a release. Release signing/notarization, ESC/POS
printing, cash-drawer control, auto-update and offline tender remain separate milestones — see
[apps/desktop/README.md](../apps/desktop/README.md).

**Typed GraphQL surface for external clients (2026-09-11, no migration, no permission).** The mobile/
POS surface is now generatable: `schema.graphql` is committed and pinned to the executable schema by
`graphql-schema-artifact-contract`, every mobile/POS operation takes a named input object and returns
a named output type (no `JSON` left in any response tree), eight REST-ism action multiplexers were split
into 32 named mutations with the old fields kept `@deprecated`, and every client-facing error carries
an `extensions.code` while business rejections stay in `data.<operation>.status`. Four POS
multiplexers (`bmsPosDeposit`, `bmsPosExpense`, `bmsPosPark`, `bmsPosShift`) are still
`action`-dispatched. RN bootstrap/PIN auth moved first and generated documents compile; remaining
business workflows retain compatibility routes until their parity tests land — see
[architecture/graphql-client-readiness-brief.md](architecture/graphql-client-readiness-brief.md).

**Emergency Offline Mode is an encrypted cash queue on the phone, not an offline backend (`10.5`).**
`apps/mobile` may accept a plain retail cash sale while the server is unreachable, but only after
the cashier is signed in, the original shift is open and the product snapshot is loaded. The
temporary reference is not a receipt or tax document. On reconnect the normal `recordPosSale()`
rechecks device/cashier/shift/branch, price, stock, tax and eligibility under the original
idempotency key; `bms_orders.pos_offline_tendered_at`/`pos_offline_synced_at` are evidence only.
Accepted cash is never discarded — an unresolved row blocks shift close, unpair and re-pair.
Restaurant, pharmacy, board-game, member/coupon, approval, serial/weighted/modifier, credit/deposit
and non-cash work stay server-required, and the desktop shell has no offline tender. See
[business/cloud-hybrid-pos.md](business/cloud-hybrid-pos.md).

**A board-game bill keeps the words it was sold with, and a person keeps their own clock (`10.6`–
`10.7`).** Participants freeze the rate code/name at sale so renaming a rate never rewrites an old
receipt. Each participant has a `time_mode` (`ACTUAL`/`SESSION_END`/`DURATION`) and an optional
`planned_end_at` charged at least through that time; billing groups can merge (`MERGED` +
`merged_into_group_id`) and detach while open, and seating past capacity is an explicit,
server-checked override.

**Thai tax evidence cannot drift after the sale (`10.8`–`10.11`, `10.13`, `10.23`–`10.25`).** A
sale line's money is `bms_order_items.line_amount` — a promotion discount is allocated per line in
satang — and every sales, tax and report reader uses it instead of `unit_price × qty`. A full tax
invoice issues only for a completed bill that was never voided or returned, and the back office
refuses to cancel/return/refund a bill with an active tax document (return it at the register so a
credit note is issued). Documents carry the Bangkok issue date (`10.8`) and a seller snapshot taken
at issue (`10.24`); an unsent e-Tax row of a cancelled document becomes `CANCELLED` (`10.25`).
Pricing excluding VAT is no longer configurable. Expense documents (`10.11`, `/admin/expenses`,
`expense.view`/`expense.manage` seeded to Manager) claim input VAT only on a `TAX_INVOICE` with a
document number and a checksum-valid payee tax id, record withholding tax, are corrected by `VOID`
with a reason, and the duplicate-invoice key is the normalised number + branch. `VAT_SALES`,
`VAT_PURCHASE` and `STOCK_LEDGER` are persisted report types. `10.13` has **not** been verified
against a database — see [local-notes-archive.md](local-notes-archive.md) § Tax leak guards — and
[business/pos.md](business/pos.md).

**Delivery platforms are capability-gated, never guessed (`10.12`, `10.14`, `10.21`).** Webhooks write a
sanitized durable inbox; order, payment and reservation commit together; every provider call runs
after commit from a command outbox. The opaque integration id derives the tenant and a `VERIFIED`
store mapping derives the branch; only verified item/variant/modifier mappings create an order.
Platform partner contracts and encrypted credentials live in the platform-admin
`/admin/delivery-provider-settings`; tenants authorize stores and map menus at
`/admin/delivery-platforms` (nine `delivery.*`/`restaurant.*` permissions, seeded to Manager, with
review/handoff also to Sales and Cashier). foodpanda uses OAuth client credentials and is the only
adapter that calls a network, in sandbox/shadow; accept/reject/pause still need partner
confirmation. GrabFood and LINE MAN are contract-blocked. `PLATFORM_SETTLEMENT` is server-only. See
[integrations/delivery-platforms.md](integrations/delivery-platforms.md).

**Social Login is a platform-admin switch on top of real configuration (`10.22`).** Google and Facebook
are enabled per surface (`PUBLIC_LOGIN`, `ADMIN_LOGIN`, `SHOP_SIGNUP`, all off by default) at
`/admin/auth-settings`; a surface works only when its switch is on **and** its runtime config is
ready. Client ids/secrets live in environment variables, never the database, and one
`(provider, provider_id)` maps to one user.

**Sample data is removed by ledger, never by name (`10.26`, `10.30`).** `bms_sample_runs` and
`bms_sample_records` record exactly which root rows a run created; a `FAKE-`/`SAMPLE-` prefix
never authorises a delete. `/api/bms/onboarding/sample-data` needs `product.edit`, seeds the
Starter Catalog only, and deletes only after the typed confirmation `DELETE SAMPLE`. Onboarding
seeds now accept every archetype.

**Retail Local runs the same BMS on one shop's own host (`10.15`–`10.20`, `10.27`–`10.29`,
`10.31`–`10.36`).** It is a deployment profile, not a fork: one local PostgreSQL is the only source of
truth, `bms_local_installation` is a singleton, first-run provisioning creates tenant/admin/`MAIN`/
`POS-01` atomically, services bind to loopback, and `retail-local-migrate.mjs` applies the chain in
order with checksums. Packages are Server + POS, Server and POS-only: Server runs on Windows x64 and
Ubuntu x64 (Linux has a server-only bootstrap), `windows-x86-legacy` is POS-only, and macOS
Apple Silicon/Intel packages are experimental; every online bootstrap is a small signed-manifest
downloader with no embedded payload, and offline bundles are built only on explicit request.
Updates are operator-initiated (check, then back up and update) with a verified encrypted backup,
transactional migration and health-gated commit or rollback. **Licensing is evidence-only and
fail-open**: setup never asks for an Activation Code, installing creates no licence or trial,
activation is an optional post-install step from `/admin/retail-local-license`
(`retail_local.license.view`/`.manage`, seeded to no role), retries replay only the exact code +
request id (`10.35`), and no licence, trial or review state may ever stop POS, payment, stock, tax,
backup, restore or data access. Platform admins manage licences, releases
(`/admin/retail-local-releases`, streamed through the Pages API upload route) and installer error
reports (`/admin/installer-reports`, `10.31`, consent-gated and opt-in); the installation registry
(`10.36`) counts instances by a random UUID and never stores hardware identity or source IP. The
public download page is `/retail-local`. See [business/retail-local.md](business/retail-local.md)
and [business/retail-local-ga-readiness.md](business/retail-local-ga-readiness.md).

**The public site explains the flow it actually ships.** `/how-it-works` (and a compact version on
`/`) renders an interactive BMS flow diagram from `components/marketing/flow/flowData.ts`; frontend
only, bilingual through `bmsFlow.*` keys, and `bms-flow-data-contract` forbids naming an unverified
provider integration.

**Supplier VAT adjustments are received evidence, not a money or stock path (`10.37`).**
`/admin/expenses` records supplier credit/debit notes with positive *difference* amounts, the
original invoice reference, reason and received date. Only reports apply the negative sign to
`SUPPLIER_CREDIT_NOTE`; the claim month is the month received (no six-month deferral), WHT fields
are rejected, and no tax document, cash or stock moves. See
[business/pos.md](business/pos.md#tax-settings).

**A receipt QR lets the buyer request a full tax invoice; staff still issue it (`10.38`–`10.39`,
`10.58`).** Opt-in with `BMS_TAX_REQUESTS_ENABLED` plus an HTTPS origin/secret; Retail Local refuses
it. The signed receipt capability derives tenant/order server-side and a separate 256-bit tracking
secret (hash stored) owns read-back, so a QR never re-reads a previous buyer. Each receipt allows
three successful submissions (initial + two corrections) strictly before 168 hours from the
abbreviated receipt's issue; snapshots are append-only and identical retries replay. Issuing needs
`tax.document.issue`, an allowed branch, explicit confirmation and the reviewed version, locking
order → request → tax document in one transaction. `10.58` emails a PDF *copy* through a tenant
outbox committed with the invoice and delivered after commit (Thai font embedded at PDFKit
construction); the list shows a safe failure reason, uncertain attempts need a manual retry, a
failed email never undoes issuance, and the PDF is not an e-Tax submission. Real-provider delivery
is not yet verified. See
[business/pos.md](business/pos.md#cloud-receipt-qr--full-tax-invoice-request-1038).

**Buy-A-get-B gifts are real stock lines (`10.41`).** `BUY_A_GET_B` applies to direct-stock
`RETAIL_POS` variants only, with no chained/overlapping deals; one pure basket engine previews what
`createOrderInTx()` commits as `line_amount`, the awarded rule is frozen into
`pricing_snapshot.crossSkuGifts`, and returns reclaim gifts that lose entitlement from that frozen
rule. A stock-free gift line is never invented.

**Board-game additions (`10.40`, `10.42`, `10.48`–`10.50`).** `TIME_BUY_GET` offers repeat per
participant over already-rounded billable minutes and compete (never stack) with other offers and
member passes. Library titles may carry one catalogue image. Customer chat can book a table only
through a server-resolved preview whose fingerprint the customer affirms within 15 minutes; it
writes `REQUESTED` by default, or `CONFIRMED` with an atomically allocated table only when the
branch opts into `chat_auto_confirm` (no-deposit branches only, at most three active future CHAT
bookings per CRM customer). Area/capacity table details reach customers only after an explicit
per-branch opt-in. See [business/board-game-cafe.md](business/board-game-cafe.md#chat-reservation-requests-1048-2026-10-07).

**Pharmacist-approved guidance and an emergency directory (`10.45`–`10.47`).** A shop may copy
starting drafts into per-tenant guidance for 11 clinical question kinds; a customer reads a body only
while `APPROVED`, only a licensed pharmacist approves (no Administrator shortcut, licence row locked
until commit by `10.47`), and an edit returns it to `DRAFT`. No row = the existing fixed pharmacist
handoff, word for word. The optional emergency directory (`10.46`) never collects customer location;
emergency wording is checked before any profile/context read and lists at most three active 24-hour
facilities. No text has been clinically reviewed by a licensed pharmacist. See
[pharmacy README](../apps/web/lib/bms/pharmacy/README.md#pharmacist-approved-guidance-for-clinical-customer-questions-1045).

**Customer chat states facts the shop published, never inferred ones (`10.51`–`10.53`).** Restaurant
table details are opt-in per branch (`10.51`); branch parking (`10.52`, `bms_locations.parking_info`,
every shop type) is never "no parking" when unpublished and never current vacancy. Customer answer
evidence (`10.53`) links exact source messages and bounded allowlisted tool snapshots under forced
tenant RLS, separate from the audit log; its PARTIAL/FAILED/NOT_CAPTURED states are capture status,
not a factual verdict, and a capture failure never retries a business action. See
[ai/quality.md](ai/quality.md).

**AI access is monthly points; cost is reporting (`10.54`–`10.56`, updated by `10.73`, `10.101`,
`10.102`).** Free 100 / Pro 1,000 / Growth 2,500 / Business 5,000 / Enterprise 10,000 points (the
Business figure after the rollout-month transition; prices moved from the `10.73` THB 599/1,990 to
the `10.101`/`10.102` catalogue — see the package entry below), reset
at 00:00 Asia/Bangkok on the first, one
point per logical shared-provider request (retries/tool rounds/fallback share it), no rollover.
The briefly introduced per-shop USD cap is removed: unknown or missing cost never blocks a valid
request, but an attempt must still be durably recorded before network I/O. Administrator/Manager get
deduplicated 80%/90%/exhausted/recovered notices. Grant-changing mutations need database-verified
platform-admin authority; catalog prices are not proof of payment (no recurring billing). Retail
Local reports `LOCAL_OWN_KEY`/`LOCAL_UNCONFIGURED` and charges no points. See
[ai/usage-cost-audit.md](ai/usage-cost-audit.md).

**Reviewed customer merges and signed web-chat sessions (no migration).** `bmsMergeCustomers` now
requires a ten-minute signed preview bound to tenant/actor/direction/snapshot plus reason,
verification method, an evidence reference and confirmation; merge and `customer.merge` audit commit
together. AI only proposes ids. Website chat returns an opaque 30-day signed `sessionId` bound to the
URL's tenant; an unsigned legacy id starts a new identity and never claims old history. See
[business/crm.md](business/crm.md#reviewed-staff-merges-and-web-chat-ownership-2026-10).

**Mail, scheduling and public pages (`10.57`, `10.59`).** `MAIL_PROVIDER=smtp` adds a generic SMTP
relay (`SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`; ports 465/2465 implicit TLS, every other port
`requireTLS`) beside SendGrid/Gmail, and receipts/order-status emails reply to the shop's
`contact_email`; apply `10.59` first or `/admin/mail-log` silently misses SMTP sends (not yet applied
or sent through a real relay). An opt-in Docker `scheduler` service dispatches the existing
authenticated cron APIs — choose exactly one owner with `BMS_CRON_RUNNER`
([architecture/scheduler.md](architecture/scheduler.md)). Platform admins set homepage
Android/App Store links at `/admin/app-downloads` (`10.57`), and `/data-deletion` publishes the
public data-deletion instructions.

**The native register prints over Wi-Fi/LAN (no migration).** `apps/mobile` sends server-backed
receipt paper as an ESC/POS raster to a private-IPv4 TCP printer (58/80 mm) and prints only after
the `DLE EOT` online/cover/paper checks pass; receipts, PINs and tokens are never queued or sent to
the printer. No Bluetooth/USB/AirPrint, no cash-drawer kick, and no certification on real hardware
yet. See [apps/mobile/README.md](../apps/mobile/README.md).

**A tax correction is a new reviewed document, never an edit (`10.60`).** Tax documents and counters
accept `DEBIT_NOTE`; newly issued full/credit/debit documents freeze a `print_snapshot` (lines,
seller/buyer identity, amounts, calendar era) and record buyer VAT registration separately, without
backfilling old documents with today's identity. `bms_tax_document_actions` records
substitute/correct/credit/debit actions with an idempotency key, evidence reference and reason, and
`bms_tax_period_snapshots` freezes versioned monthly sales/input-VAT reports per establishment; both
are append-only (SELECT/INSERT grants only). `tax.document.adjust` and `tax.period.close` are seeded
to Manager. Current/future months and reports with unresolved exceptions cannot close, later drift
is shown as a warning on the archive rather than rewriting it, and paper `PRICE`/`CORRECTION`
workflows are excluded from the e-Tax provider queue. The tax-point decisions are **pending
accounting confirmation**, and the migration was not exercised against a database in that round —
see [business/tax-accounting-review.md](business/tax-accounting-review.md) and
[architecture/database.md](architecture/database.md) § Tax document controls.

**Restaurant costing reads recorded evidence, never today's catalog (`10.61`–`10.66`).** `10.61`
freezes a stock/cost snapshot on each restaurant check item at first kitchen send and links order
items to it (`stock_consumption_version = 2`); apply it before deploying, because common order
inserts read the column. `10.62` adds pinned subrecipes compiled into a leaf BOM with exact integer
arithmetic plus SOP steps, as copy-on-write recipe versions that never create production inventory.
`10.63` stores labour/electricity/gas assumptions on a recipe version (null is unknown, not zero),
`10.64` records human operating-cost reviews, `10.65` freezes a trigger-guarded financial snapshot
on each POS return, and `10.66` appends versioned monthly cost allocations by branch/channel. The
phase-9 recorded net-profit read composes these on one serializable snapshot, keeps unknown cost
unknown and uses `CATALOG_AT_SALE` cost, so it is management profit before income tax, not actual
purchase-lot valuation or a statutory statement. `10.61`–`10.66` were installed and re-run on a
restored local Docker clone in the 2026-10-15 DB follow-up; production query plans remain a rollout
check. See [business/inventory.md](business/inventory.md) § Restaurant phases 1–9 and
[architecture/database.md](architecture/database.md).

**Actual cost is a moving weighted average frozen with the stock movement, and a price changes only
through a confirmed publication (`10.67`–`10.72`).** `bms_inventory_values` keeps the current
weighted average per branch/SKU/size and `bms_inventory_value_entries` freezes each movement's value
in the stock transaction (transfers carry value, transit loss is expensed); unknown opening value
stays NULL until an evidence-backed, explicitly confirmed opening, and `10.69` ties the balance to
its exact inventory row. `bms_price_plan_publications` records a confirmed price plan while the
shared pack/promotion writers run in the same transaction; stale observations, VAT mismatches and
branch-restricted actors are rejected. `10.70` scopes N-for-price rules to a variant and sales
surface. `10.71` adds explicit branch prices (absence inherits the catalog) and replaces the
one-active-promotion index with a GiST exclusion, so future windows can be scheduled without
ambiguity at checkout. `10.72` adds append-only reviewed menu-profit allocations that reconcile to
the recorded net-profit report, and publishes a mixed-menu bundle as a pinned `RECIPE` product.
Material contribution is not per-menu net profit, and existing unvalued sales are never repriced.
See [business/inventory.md](business/inventory.md) §§ Completed restaurant costing workflow /
Costing completeness follow-up / Operating completion.

**A package limits what a shop may add, never what it may sell (`10.73`–`10.75`,
`10.101`–`10.102`).** The Cloud catalogue is Free/Pro/Growth/Business/Enterprise Factory at THB
0/990/1,990/4,900/29,900 per month (`10.101`/`10.102`; Enterprise is sales-led, not self-serve) with
enforced product and total-user limits (the owner counts) and, for shops created after `10.75`
(`capacity_policy_version = 2`), branch/device/channel limits that count disabled rows too.
`feature_policy_version` (`10.74`) keeps existing shops on the legacy policy permanently; new shops
get `REPORT_SCHEDULE` on Pro and above and `RETENTION_ENGINE` on Business. Quota checks reject
additions only: existing rows stay editable, and checkout, POS sales, device pairing, webhooks,
order volume, existing jobs and Retail Local are never gated. Plan changes commit with their audit,
platform admins edit the catalogue through a preview/confirm flow (`10.83`), and
`bms_package_events`/`bmsPackageMetrics` report plan conversion, not payment or revenue. Prices are
catalogue evidence — there is no recurring billing. Dev fake seeders use the same quota authority
(#355). Rehearse `10.75` on a restored throwaway database before any production rollout. See
[architecture/database.md](architecture/database.md) and
[architecture/system.md](architecture/system.md).

**Platform reference data is shared, read-only to shops, and copied into tenant rows as snapshots
(`10.76`–`10.86`).** Banks, units, the Thai address hierarchy, carriers and shipping zones, tax
reference tables, starter categories/holidays/emergency numbers, a reviewed barcode cache, drug
suggestions, countries/currencies/timezones and an effective-dated AI rate card are global tables
with no `tenant_id`; `bms_app` only reads them, and every platform-admin write goes through a narrow
`SECURITY DEFINER` function (`10.86`) with revision and audit in one transaction. Tenant rows keep
their own snapshots (addresses, tax buyers, pack unit codes, shipment carrier names) and printing
never joins master data. Nothing is copied into a shop without an explicit action; master drugs ship
only an inactive `SAMPLE-DO-NOT-USE` row and stay suggestions that a shop pharmacist must approve;
the VAT reference is advisory while `bms_store_profile.vat_rate` stays the sale-time authority;
AU/GB locality tables stay empty until a licence/residency review. Code is built; pilot data review
is pending. See [architecture/database.md](architecture/database.md) § Platform master data
foundation and the sections after it.

**A branch requisition is a planning document; stock moves only through a transfer or PO
(`10.87`–`10.88`).** `/admin/branch-requisitions` adds draft → submitted → approved/rejected →
closed/cancelled requests with integer requested/approved quantities, optimistic versions and a
Bangkok-day `REQ-` number. Approved quantities are fulfilled by linked transfers, where only good
received units count as delivered, or allocated to PO items, which are procurement evidence and
never proof of delivery; creating the linked document and recording the allocation share one
transaction and audit. `inventory.requisition.view/create/review` are seeded to Manager (Warehouse
gets view/create) and transfers/POs still need their own permissions. `10.88` adds the review queue,
filters and best-effort post-commit notices to current eligible reviewers/requesters. Code is built
but not piloted. See [business/inventory.md](business/inventory.md) § Branch requisitions and
[business/branch-requisitions-plan.md](business/branch-requisitions-plan.md).

**Board-game profitability uses frozen money and recorded occupancy (`10.89`).** The Analytics tab
on `/admin/board-game` (`report.view`; editing branch hours also needs `board_game.floor.manage`)
reports utilization as occupied over available table-minutes, from effective-dated
`bms_board_game_branch_hours` and an occupancy ledger written in the same transaction as
open/move/merge/detach/close. Play revenue comes only from frozen paid billing-group snapshots and
tab revenue from immutable `line_amount`; RevPATH, seat utilization and an XLSX export
(`BOARD_GAME_ANALYTICS`) build on them. Missing hours, VAT allocation or cost stay unknown with a
visible issue, never zero; pre-ledger occupancy is backfilled and flagged approximate; fixed costs
are excluded and nothing is forecast. See [business/board-game-cafe.md](business/board-game-cafe.md)
§ Profit and table utilization.

**The customer display shows a per-tender Dynamic PromptPay QR only from a verified bank-issued base
(`10.90`).** When a QR tender is selected, the customer display (`/pos/display`) renders a Dynamic
PromptPay QR carrying that tender's amount (Tag 54, recomputed CRC), built only from an amount-free
static QR saved in Settings → Receiving accounts whose embedded recipient matches the configured
PromptPay ID. It is never synthesized from a PromptPay ID, there is no static fallback, and the
cashier still confirms funds manually. `10.90` adds an optional idle welcome background
(`bms_store_profile.customer_display_background_url`), decoded and re-encoded server-side; cart,
payment and QR phases keep the solid background. See [business/pos.md](business/pos.md) § Customer
display and receipt delivery.

**Store operations record evidence; only an explicit post moves stock (`10.91`–`10.98`).** One admin
page, `/admin/operations`, delivers Releases A–H: checklists and food-safety evidence with private
image evidence (`10.91`), supervisor follow-up and escalation (`10.92`), rosters, handovers and a
daily manager review (`10.93`), production batches (`10.94`), SOP standards, learning evidence and
improvement reviews (`10.95`–`10.96`), material plans with inspected receiving (`10.97`), and
quality cases with lot holds (`10.98`). Releases A–D write no stock or money, and a roster is not a
POS shift, payroll or proof of presence. A production batch posts `PRODUCTION_OUT`/`PRODUCTION_IN`
only on an explicit post; materials planning leaves `purchase.ts` as the stock authority; a lot hold
restricts usable availability for POS, menus and transfers but never moves quantity or value, and an
approved disposal (different proposer and reviewer) moves stock, value and audit in one transaction.
History tables are append-only under forced RLS, and 20 `operations.*` permissions gate the page.
Code is built but not piloted. See
[business/operation-checklists.md](business/operation-checklists.md),
[business/operation-production.md](business/operation-production.md) and
[business/operation-improvement.md](business/operation-improvement.md).

**Branch inventory intelligence never spreads unattributed demand, and landed cost never rewrites
the supplier price (`10.99`–`10.100`, `10.103`).** `inventoryIntelligence.ts` is the shared read
model for the Dashboard and staff AI tools, keyed by tenant/branch/SKU/size: a
`bms_inventory_location_policies` row overrides tenant policy for one branch, and demand or open PO
quantity without a verified branch stays in separate unallocated lists. Reconciliation, stale
transfer/PO, repeated adjustment and loss signals are review signals, not fraud verdicts. AI tools
may only propose a transfer or PO (a fresh idempotency key per proposal;
`bms_purchase_order_idempotency` makes confirmation retries replay) through the shared human
confirmation UI, and receiving a PO is not an AI tool. A daily job records forecast snapshots and
evaluates matured ones (method `2.1`); forecasts never write stock. `10.100` makes branch deletion
clear only the demand row's branch. `10.103` adds a reviewed per-unit `additional_unit_cost`
(freight, duty, non-recoverable tax) with a mandatory note on PO lines; receiving freezes
`unit_cost + additional_unit_cost` into lot cost and valuation, and earlier receipts are never
backfilled. See [business/inventory.md](business/inventory.md) §§ Branch-aware inventory copilot /
Completed restaurant costing workflow.

**Stock writes refuse drift instead of carrying it (#362, #365, #396, no migration).** Since the
quality-hold release (#362), sellable availability for reservations, POS scan, menus and restock
notices excludes held or expired lots, and a lot-total mismatch blocks new reservations until
reconciled. Staff transfers enforce assigned branch scope on REST and staff GraphQL — create needs
both branches, send/cancel the source, receive the destination — with retry-safe commands (#365).
Stock integrity (#396) tightens the shared services: PO receipts enforce lot/expiry tracking even on
the first receipt into an empty branch, manual adjustments refuse lot/expiry policies, back-office
full returns reconcile the original lot allocation or roll back with `STOCK_REVIEW_REQUIRED`, and
counts need an explicit non-negative integer (missing is not zero). Mobile Operations gains purchase
receiving with an immutable pending receipt in secure storage, and the desktop shell gains ordered
unpair and window-lifecycle handling. Covered by `stock-integrity-contract` and
`stock-integrity-db-contract` (restored disposable database only). See
[business/inventory.md](business/inventory.md).

**Lot identity travels with a branch transfer (`10.107`) — committed and clone-DB verified, WIP for
rollout, production deployment unverified.** SEND allocates unexpired, not-held source lots FEFO
inside the transaction that lowers `current_stock` and is refused when lot totals do not match
physical stock; `bms_stock_transfer_item_lots` snapshots lot number, expiry and cost per line and
source lot. RECEIVE recreates good units as the same lot number and expiry at the destination with
cost carried over; damaged units go to quarantine, a shortfall on a multi-lot line lands on the
latest-expiry lot as a deterministic estimate rather than evidence, and a quality hold placed after
sending blocks the receipt. PO receipts, wastage, counts and POS returns apply the same
reconciliation. On 2026-11-05 the final code passed `npm run gate` and eight PostgreSQL suites
(81/81) on a clone with `10.107` applied only to that clone — verification evidence, not a
production deployment. Do not describe lot transfers as available in production before confirming
the target database and rollout. See [business/inventory.md](business/inventory.md) § Lot transfers
and [architecture/system.md](architecture/system.md).

**A Meta webhook is bound to one Page and processed from a durable queue (`10.104`, `10.108`).** The
Facebook/Instagram route takes the tenant from the path, verifies the raw body, binds `entry.id` to
the saved account ID (`external_account_id`) and uses a webhook verify token distinct from the App
Secret. Each message is stored in `bms_channel_inbound_jobs` under its unique `message.mid` before
any AI or Graph API call; once `effects_started_at` is stamped, an uncertain outcome becomes `DEAD`
for manual review instead of replaying a possible order or reservation. `10.108` keeps only bounded
reply-target, quick-reply and ad-referral identifiers (`event_meta`), never the raw signed payload.
Business Suite echoes are timeline evidence only, delivery/read events advance outbound status, and
replies go out only inside Meta's 24-hour window. Customer names and pictures are cached best-effort
from the User Profile API (LINE profiles refresh through the same `channel-profile-sync` job) and
never overwrite a staff-maintained CRM name; reading profiles of non-role users needs Meta Advanced
Access first. Apply both migrations before deploying; existing Meta channels need a Page ID and a
verify token. See [integrations/facebook-messenger.md](integrations/facebook-messenger.md).

**BMS's own sales chat answers only from approved public material (#352, #390, no migration).** A
server-selected `bms_presales` mode serves BMS's own verified LINE OA and, only when both
`BMS_FACEBOOK_PRESALES_TENANT_ID` and `BMS_FACEBOOK_PRESALES_PAGE_ID` match the signed webhook,
BMS's own Facebook Page; customer text, button payloads and tenant labels can never select it, and
shop Pages stay in shop-commerce mode. It reads at most eight messages of its own conversation as
untrusted context, uses only `search_bms_presales` and `list_bms_public_plans`, and the server
composes the approved answers. Its one deterministic write is an explicit request for Sales to call
back: the conversation, `sales-callback`/`hot-lead` tags, Sales-first assignment, internal mention
and `presales.callback_request` audit commit before the assistant acknowledges the queue (#390
queues Facebook requests the same way). No subscription payment or activation is promised. The
corpus and presales suites are DB-free contracts, not measured live-model accuracy. See
[ai/prompts.md](ai/prompts.md) and [agent-invariants.md](agent-invariants.md).

**An Inbox AI reply is "sent" only after the channel accepted it (#406, no migration).**
LINE/Facebook/Instagram AI replies are saved `PENDING` and become `SENT` or `FAILED` after the
channel call; Inbox retry is server-gated to `FAILED` push messages and locks the message row during
the attempt. Channel-health telemetry is best-effort after provider acceptance, so a health write
failure cannot relabel an accepted reply `FAILED` and invite a duplicate resend.
Web/TikTok/Shopee/Lazada do not push yet and are marked `SENT` once persisted. Meta messages with
attachments, including captioned ones, go to Inbox for staff review instead of the text-only AI
pipeline, which must not guess unseen media. See [business/crm.md](business/crm.md).

**Retail Local collects leads only with consent, can erase them, and prices service rather than
permission (`10.105`–`10.106`).** The public `/retail-local` page has an optional,
unchecked-by-default consent form; `bms_submit_retail_local_lead(...)` is the only public write and
returns no PII or id. Platform admins work the Leads tab of `/admin/retail-local-licenses` with
revisions and redacted change events, and contact/consent fields are immutable. `10.106` adds a
platform-admin `bms_erase_retail_local_lead()` that clears the contact fields and every history
snapshot holding them and freezes the row — always re-apply `10.106` after re-running `10.105`. Lead
capture is Cloud-only (the endpoint answers 404 on a shop's own install), and the linked privacy
policy still needs legal review before leads are collected in production. The proposed pricing (free
use without expiry, a one-time Local Plus licence and an installation-help offer) lives only in
`retailLocalPricing.ts`, is still pending owner, EULA and accounting approval, and never blocks
transactions, backup, recovery or corrective updates. Release housekeeping added deletion of one
managed-runtime release target and a purge of hidden, non-latest installer files (tombstone plus
audit in one transaction); release prep reached `0.2.14-pilot.7`. Retail Local remains a technical
pilot. See [business/retail-local.md](business/retail-local.md).

**A private file has an owner, and a chat attachment follows chat membership (`10.109`, #402).**
`files.visibility` defaults to private, and `/api/files/[id]` serves a file without a session only
when it is `public` (storefront/post/avatar images). `10.109` adds `owner_user_id`, so personal
uploads are listed, renamed and deleted only by their owner; chat image/audio rows are backfilled to
private with the sender as owner and stream only to current chat members. Legacy
key/database/config/script/installer artifacts are reclassified private and denied by the generic
route, while clinical, operations, support-bundle and release files keep their dedicated routes. A
tenant mismatch answers 404, not 403, and no owner or tenant is taken from request input. The same
hardening rejects GraphQL operations beyond depth 30, 2,500 fields or 200 aliases before resolvers
run, enables CSRF/origin/body-size defenses, caps multipart bodies at the proxy, requires current
membership for every community-chat operation, binds dev database tools to loopback and logs
parameter shape instead of credentials or PII on database failures. See
[architecture/database.md](architecture/database.md) § Stored-file ownership.

**Bank reconciliation matches a statement to recorded facts; it never posts (`10.110`).** Phases 1–6
add bank accounts (only an HMAC fingerprint and the last four digits of the account number),
immutable statement staging for CSV/XLS/XLSX (10 MB / 50,000 entries, formulas rejected, SHA-256
dedupe, explicit commit), deterministic candidates against confirmed payments, AR receipts, paid
expense documents, completed refunds, delivery settlements and opposite bank entries, human
confirm/partial/ignore/void with transactional audit, and versioned month close/reopen with XLSX/CSV
export. A confirmed link never changes its source row; a changed source makes the link stale for
review. `10.110` adds sidecar tables only (no trigger or constraint on sales, payment, AR, expense,
refund, delivery, tax or stock tables), denies access without tenant context, and seeds the four
`bank_reconciliation.*` permissions to Manager. Both feature flags default off, rollout is
migration-first with a controlled pilot, matching is THB-only, and Open Banking reports
`NOT_CONFIGURED`. See [business/bank-reconciliation.md](business/bank-reconciliation.md).

**Recording a pharmacist licence is an audited, database-checked Administrator action
(`10.111`, #400, #405).** Licences are edited at `/admin/pharmacy-protocols/licenses`: save, then
confirm the exact person and new state. `10.111` adds `bms_set_pharmacist_license()`, a narrow
`SECURITY DEFINER` helper that checks the transaction tenant and a same-tenant Administrator actor,
locks that actor through commit and updates only the target's licence columns; `bms_app` gets no
general licence UPDATE grant, and a missing helper fails closed. The flag and number are
shop-recorded evidence — the software checks no external licence registry. Clinical protocol and
Product Policy draft/submit/review/enable writes now commit their audit in the same tenant
transaction, review holds the `10.47` licence-row lock through commit, and concurrent enables of one
protocol are serialized. AI Pharmacy Intake stays flag-gated off, and the guidance texts are still
not clinically reviewed. See [pharmacy README](../apps/web/lib/bms/pharmacy/README.md).

**A register pairs by an Admin QR, and a desktop or native client never loses a pending sale
(#353, #394, #395, no migration).** Admin POS Devices shows a locally generated pairing QR (HTTPS
origin plus device credential) right after token issuance, and the mobile app's dedicated scan
verifies and stores it through the existing flow. The QR is a bearer credential, not a one-use
ticket: closing the modal does not revoke it, only the token hash is stored, reissuing invalidates
the old token, HTTP/loopback origins are never advertised, and product/stock scanners reject pairing
codes before SKU lookup; token rotation and its audit commit in one transaction. Desktop and native
checkout keep the whole pending request and its idempotency key across `PAYMENT_FAILED`,
`SERVER_ERROR` or a missing result (#353). The iOS/Android audit (#394) forwards running-app deep
links on iOS, leaves Android release builds unsigned instead of debug-signed when upload credentials
are absent, rechecks pending offline cash immediately before unpair and keeps or clears idempotency
keys by outcome; the desktop shell keeps an unreadable pairing file for recovery. These are code and
automated-test results, not physical-device certification or a published signed build. See
[apps/mobile/README.md](../apps/mobile/README.md),
[apps/desktop/README.md](../apps/desktop/README.md) and [business/pos.md](business/pos.md).

**Public and staff search answer only from verified catalogs
(#372–#374, #377, #380–#381, #399, #401, #404, no migration).** `/learn` is a bilingual public
learning center authored in `lib/learning/catalog.ts` (board-game and restaurant paths) with GET
search over that catalogue only — no public LLM endpoint or tenant query — and reading progress
stays in the browser. Public SEO adds stable `/th` and `/en` URLs, canonical/alternate links, one
root sitemap with a robots policy that excludes private surfaces, and JSON-LD only where the visible
page supports it. `/features` (#399) answers a prospect's free-text question with one reviewed
presales topic, says when no verified answer exists instead of claiming absence, and points Cloud
prices to the current packages and Retail Local prices to the team. `/admin/search` and the header
search (#401) open Work Assistant knowledge deterministically without an AI call; admin display
identity and avatars refresh from Postgres instead of the JWT, and platform admins carry a "Super
Admin" tag on `/admin/users` (#404). See [ui/learning-center.md](ui/learning-center.md),
[ui/public-seo.md](ui/public-seo.md) and
[business/product-overview-th.md](business/product-overview-th.md).

**A release is identified by an exact commit and its feature manifest, not by a migration filename
(release-manifest commits, 2026-11-09).** `scripts/release-features.mts` builds a commit-bound
manifest from the Work Assistant capability catalog plus `scripts/release-feature-registry.json`
(stable IDs, source and test paths); a dirty tree is refused unless explicitly marked as a local
draft, and `--previous` adds an added/changed/removed diff. `npm run gate` now also checks the
registry and the regression-file inventory (`check-regression-inventory.mjs`, including mutation and
live-model drivers), and the GitHub gate uploads a candidate manifest. The registry scope is
`baseline-in-progress`: its count is not the number of BMS features, `AVAILABLE` is a code status
rather than production enablement, and `inventory.transfer-lots` stays WIP. Production availability
still needs the deployed artifact, target schema, flags, configuration, entitlements and rollout
evidence. See [release-feature-control.md](release-feature-control.md).

