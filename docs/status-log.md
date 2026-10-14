# BMS status log

Per-feature decision narrative moved out of [CLAUDE.md](../CLAUDE.md) on 2026-10-13 to keep the
always-loaded agent context small. Text is unchanged; newest entries are at the end. The compact
area index lives in CLAUDE.md § Current status; full per-domain rules live in
[agent-invariants.md](agent-invariants.md).

## Current status summary (as written 2026-10)

Fully built except: **Shopee/Lazada** (🧪 beta, signatures unverified) · **Flash/Kerry carriers**
(🧪 safety layer done, adapters await a real merchant contract) · **AI Pharmacy Intake** (🧪
flag-gated off) · **e-Tax submission**
(🧪 built, gated off by default, no signing/submission provider verified yet) · **POS ESC/POS
printing/cash-drawer** (🧪 written, never run against real hardware; the native app's Wi-Fi/LAN
raster receipt printing is unit-tested but not yet certified on a real printer) · **Windows/Linux/macOS desktop
POS client** (🧪 MVP shell — every package is unsigned, with no auto-update and no offline tender)
· **Delivery platforms** (🧪 foodpanda sandbox/shadow only; GrabFood and LINE MAN contract-blocked;
no provider is live-ready) · **Retail Local** (🧪 technical pilot, not Commercial/GA — installers are
unsigned and clean-machine/restore/failure drills are still open).
POS counter sale/return/refund
and Thai tax invoicing (migrations `7.84`–`7.95`), membership/tiers/loyalty points (`7.96`), parked
bills + drawer movements + void + shift report (`7.97`, hardened through `9.5` with idempotent
drawer cash movements, whole-bill serial checks, and shift-report correctness fixes), inter-branch
stock transfers + stock counts (`7.98`), and a keyboard-wedge Scan Manager plus retry-safe PO
receiving at the register (`9.6`) are otherwise fully built — see
[business/pos.md](business/pos.md) and [business/inventory.md](business/inventory.md).
The native iOS/Android register now has one-shot camera scanning and an explicitly opened,
focused Bluetooth/USB HID mode. It remembers camera versus hardware input on the device, keeps the
modal open for consecutive scans, suppresses CR+LF duplicates, and preserves the existing
modifier/pack selection flow. Global hardware-key capture outside that modal and real-device scanner
certification remain rollout work; this is not the browser Scan Manager's global PREFIX mode.
The commercial intelligence roadmap is built through **Q3**: Phase 1 bundles the daily Action Center
and inventory purchasing intelligence (`9.12`–`9.13`), while Phase 2 adds the monthly customer
retention engine (`9.14`) with RFM/risk scoring, verified next-product evidence, a propose-only
comeback queue, deterministic holdout, and bounded 30-day conversion attribution. See
[ui/dashboard.md](ui/dashboard.md), [ui/retention-engine.md](ui/retention-engine.md), and
[business/crm.md](business/crm.md). Q4 profit/growth simulation remains planned.
Migrations `8.0`–`9.4` add further POS features (blind close/no-sale, price tiers, blind returns,
serials, commission, non-stock charge lines, promotions, bundles, store credit, deposits, branch
creation) not yet reflected in this summary — see [CLAUDE.local.md](../CLAUDE.local.md) for the
per-migration build/verify/production status of each.


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
the full brief and [CLAUDE.local.md](../CLAUDE.local.md) for the incident-by-incident record.

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
against a database — see [CLAUDE.local.md](../CLAUDE.local.md) § Tax leak guards — and
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

**AI access is monthly points; cost is reporting (`10.54`–`10.56`).** Free 100 / Pro 1,000
(THB 599) / Business unlimited (THB 1,990) points, reset at 00:00 Asia/Bangkok on the first, one
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

