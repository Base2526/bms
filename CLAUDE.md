# AI Business Management System (BMS)

BMS turns every customer conversation into a business workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

It is **not** a chatbot. AI never touches the database — it only calls approved backend tools.
Business logic always lives in `apps/web/lib/bms/*.ts`, shared by REST and GraphQL.

This file is the **navigation index + AI rules**. Working rules for agents are in
[AGENTS.md](AGENTS.md); machine-local notes in [CLAUDE.local.md](CLAUDE.local.md).

## Documentation map

| Doc | Covers |
| --- | --- |
| [architecture/system.md](docs/architecture/system.md) | Module build status, RBAC model, folder structure, roadmap |
| [architecture/database.md](docs/architecture/database.md) | Tables per module, RLS/tenant scoping, migration notes |
| [architecture/api.md](docs/architecture/api.md) | REST routes, GraphQL modules, auth scopes, RBAC gates |
| [architecture/realtime-production-audit.md](docs/architecture/realtime-production-audit.md) · [ADR 001](docs/architecture/decisions/001-transactional-realtime-invalidation.md) | Current realtime security/reliability audit · accepted phased outbox/invalidation design |
| [architecture/mobile-graphql-ws-realtime.md](docs/architecture/mobile-graphql-ws-realtime.md) | Mobile/RN GraphQL primary API, REST exception inventory, POS migration gaps and phase boundaries |
| [architecture/react-native-graphql-client.md](docs/architecture/react-native-graphql-client.md) | Native POS HTTP GraphQL + ticketed GraphQL WS client wiring, retry and rollout contract |
| [architecture/graphql-client-readiness-brief.md](docs/architecture/graphql-client-readiness-brief.md) · [`schema.graphql`](schema.graphql) | Why the surface was typed and in what order · the committed SDL artifact a client generates from (`npm run schema:export`; production keeps introspection off) |
| [architecture/realtime-test-database.md](docs/architecture/realtime-test-database.md) | Runbook for the throwaway Postgres that realtime migrations `9.70`–`9.74` and `9.84`–`9.86` must be proven on — why a separate instance, why a dump is required, and what the run cannot answer |
| [architecture/multi-instance-readiness.md](docs/architecture/multi-instance-readiness.md) · [admin-scale-readiness.md](docs/architecture/admin-scale-readiness.md) | Running >1 instance · measured admin load |
| [business/order.md](docs/business/order.md) · [inventory.md](docs/business/inventory.md) · [payment.md](docs/business/payment.md) · [pos.md](docs/business/pos.md) · [board-game-cafe.md](docs/business/board-game-cafe.md) · [crm.md](docs/business/crm.md) | Order lifecycle/coupons · stock/PO/import + branch transfers/counts · payment + slip verify · counter/native POS · Board Game Cafe · customer identity/inbox |
| [apps/mobile/README.md](apps/mobile/README.md) | Bare React Native POS scaffold: screens, device pairing, native build commands, and the explicit mock/backend boundary |
| [business/restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) | Restaurant chat ordering + delivery (`9.55`–`9.57`): closed decisions, sold-out flag, human accept, line cancellation/refund |
| [AI_GUIDELINES.md](docs/AI_GUIDELINES.md) | Rules for AI features and approval boundaries |
| [ai/workflow.md](docs/ai/workflow.md) · [tools.md](docs/ai/tools.md) · [prompts.md](docs/ai/prompts.md) · [quality.md](docs/ai/quality.md) | Pipeline + provider routing + usage accounting · tool catalog · prompts · quality signals |
| [ai/work-assistant-coverage.md](docs/ai/work-assistant-coverage.md) | Global staff assistant: capability/guide catalog, what each status word means, coverage + regression gates |
| [pharmacy/README.md](apps/web/lib/bms/pharmacy/README.md) | Pharmacy intake: flags, migrations `7.57`–`7.73` + `7.83`, pharmacist-decides contract |
| [integrations/](docs/integrations/) · [ui/](docs/ui/) | LINE · TikTok · Lazada/Shopee (beta) · carriers — Customer 360 · checkout wireframe · dashboard · retention engine |
| [scripts/README.md](scripts/README.md) | How to run every suite and tool, what pass/fail output looks like, exit codes |
| [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | Deterministic contract suites + live-model evals |
| [agent-invariants.md](docs/agent-invariants.md) | Per-domain rules in full (AGENTS.md has the short form) |
| [feature-log.md](docs/feature-log.md) · [local-notes-archive.md](docs/local-notes-archive.md) | Why each built feature works the way it does (EN · TH) |

## Current status (2026-09)

Fully built except: **Shopee/Lazada** (🧪 beta, signatures unverified) · **Flash/Kerry carriers**
(🧪 safety layer done, adapters await a real merchant contract) · **AI Pharmacy Intake** (🧪
flag-gated off) · **e-Tax submission**
(🧪 built, gated off by default, no signing/submission provider verified yet) · **POS ESC/POS
printing/cash-drawer** (🧪 written, never run against real hardware). POS counter sale/return/refund
and Thai tax invoicing (migrations `7.84`–`7.95`), membership/tiers/loyalty points (`7.96`), parked
bills + drawer movements + void + shift report (`7.97`, hardened through `9.5` with idempotent
drawer cash movements, whole-bill serial checks, and shift-report correctness fixes), inter-branch
stock transfers + stock counts (`7.98`), and a keyboard-wedge Scan Manager plus retry-safe PO
receiving at the register (`9.6`) are otherwise fully built — see
[business/pos.md](docs/business/pos.md) and [business/inventory.md](docs/business/inventory.md).
The commercial intelligence roadmap is built through **Q3**: Phase 1 bundles the daily Action Center
and inventory purchasing intelligence (`9.12`–`9.13`), while Phase 2 adds the monthly customer
retention engine (`9.14`) with RFM/risk scoring, verified next-product evidence, a propose-only
comeback queue, deterministic holdout, and bounded 30-day conversion attribution. See
[ui/dashboard.md](docs/ui/dashboard.md), [ui/retention-engine.md](docs/ui/retention-engine.md), and
[business/crm.md](docs/business/crm.md). Q4 profit/growth simulation remains planned.
Migrations `8.0`–`9.4` add further POS features (blind close/no-sale, price tiers, blind returns,
serials, commission, non-stock charge lines, promotions, bundles, store credit, deposits, branch
creation) not yet reflected in this summary — see [CLAUDE.local.md](CLAUDE.local.md) for the
per-migration build/verify/production status of each.

**REST surface hardening (2026-08-24, no migration)** — `middleware.ts` only guards `/admin/**`, so
every route under `/api/**` needs its own check. Twenty-three single-tenant-era routes had none:
`/api/bms/reserve` could reserve stock in *every* shop selling a SKU without logging in, and the
order/payment/purchase/shipment/report/inbox routes let an anonymous caller act on the default shop.
All now use `authorizeAdminRoute(<permission>)` with the tenant taken from the signed session; two
webhook mocks that cannot check a session are 404 in production, the public demo endpoint gained a
rate limit, and the two upload routes — authenticated but permission-less — now require the
permission the step that consumes the file needs. `/admin/products` also gained a drill-down that answers "who is holding this reserved
stock". Details: [business/inventory.md](docs/business/inventory.md) and
[architecture/api.md](docs/architecture/api.md).

**Global AI Work Assistant (2026-08-28, no migration, no new permission)** — the staff tool-calling
runtime now also serves `bmsWorkAssistant` from a Drawer on every back-office page, grounded on a
deterministic bilingual catalog (49 capabilities, 110 guides, 20 FAQ answers, 24 limit groups/139
rules per language — counted from the catalog module on 2026-09-18; counts drift as features ship, so re-count
before quoting them, and note the board-game queue/reservation/offer/renewal work is **not yet** in the catalog)
covering every Sidebar
destination and every routable Admin page. `/pos` gets the same catalog as offline guide search with
no GraphQL/AI call, so a `pos_only` cashier is never pulled toward `/admin`. No new tool executes
anything a permission did not already allow. The FAQ *and* the limits/traps moved out of
`/admin/manual` into the catalog, so the page and the assistant read one array instead of two copies. Every question the product asks
is pinned to the entry that must *lead* its answer (`scripts/ai-eval/work-assistant-question-corpus.mts`)
— retrieving the right guide at rank 6 is a failure, not a pass. Coverage, status vocabulary and the
regression gates: [ai/work-assistant-coverage.md](docs/ai/work-assistant-coverage.md).

**Credit sales and accounts receivable (`9.30`, written 2026-08-27)** — a `CREDIT` payment method
completes an order and deducts stock like any other sale, but opens an AR invoice in the same
settlement transaction instead of counting toward drawer cash; collecting the debt later is a drawer
cash-in on the *collecting* shift, never a payment added to the old order. Credit limits are checked
before order creation and again under the account lock after stock settlement, and a return against
`CREDIT` reduces the debt immediately — a resulting negative balance transfers to the oldest open
invoice under that lock rather than reporting debt the customer no longer owes. `ar.writeoff` stays
separate from `ar.manage`. See
[agent-invariants.md § POS and tax](docs/agent-invariants.md#pos-and-tax).

**Shop archetype lock + bilingual labels (2026-08-31)** — the `9.40`–`9.43` archetype work expanded
the catalog and now locks `business_archetype` after the tenant's first real order; the dropdown
labels themselves now live in the shared `th`/`en` dictionary. Demo rows marked with `FAKE-*` stay
editable, but real order history freezes the preset so AI guidance, onboarding checklists and
capability defaults cannot drift behind the business record. See
[ui/shop-signup-archetype-spec.md](docs/ui/shop-signup-archetype-spec.md) and
[shop-archetype-guide.md](docs/shop-archetype-guide.md).

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
[business/pos.md](docs/business/pos.md) § Restaurant POS and
[architecture/database.md](docs/architecture/database.md) § Restaurant POS.

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
[business/inventory.md](docs/business/inventory.md) §§ Multi-store stock policies / Catalog
lifecycle and [agent-invariants.md](docs/agent-invariants.md#product-catalog-variants-sales-surfaces-and-stock-policies).

**Kitchen stations (`9.53`–`9.54`, 2026-09-02–09-03)** — a station is a registered work area
(`bms_kitchen_stations`: id, active flag, sort order, optional branch scope), not a free-text label
and not a branch. Tickets carry both `station_id` and a name **snapshot**, so renaming a station
never rewrites what the kitchen already saw, and a branch-scoped station's bills from elsewhere
route to an unassigned column instead of a kitchen that branch doesn't have. Per-station SLA
thresholds color the register KDS and `/admin/kitchen`; a station stays open to new tickets even
after being deactivated, because losing food off the board from a settings change is worse than a
ticket sitting on a station being retired. See [business/pos.md](docs/business/pos.md) § Kitchen
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
above — see [business/restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) for
the full brief and [CLAUDE.local.md](CLAUDE.local.md) for the incident-by-incident record.

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
[business/pos.md](docs/business/pos.md) § Table QR self-ordering and
[agent-invariants.md § Restaurant POS](docs/agent-invariants.md#restaurant-pos-dine-in).

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
[agent-invariants.md § Realtime invalidation](docs/agent-invariants.md#realtime-invalidation-architecture).
**`apps/ws` and `apps/web` deploy together or not at all**, `WS_ALLOWED_ORIGINS` has no safe
default, and every Redis command on this path is time-bounded — the deployment requirements and
what each gets wrong are in
[architecture/realtime-production-audit.md](docs/architecture/realtime-production-audit.md#deployment-requirements-verified-2026-09-14).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](docs/agent-invariants.md#board-game-cafe).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](docs/agent-invariants.md#board-game-cafe).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](docs/agent-invariants.md#board-game-cafe).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](docs/agent-invariants.md#board-game-cafe).

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
[business/board-game-cafe.md](docs/business/board-game-cafe.md) and
[agent-invariants.md § Board game cafe](docs/agent-invariants.md#board-game-cafe).

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

**Typed GraphQL surface for external clients (2026-09-11, no migration, no permission).** The mobile/
POS surface is now generatable: `schema.graphql` is committed and pinned to the executable schema by
`graphql-schema-artifact-contract`, every mobile/POS operation takes a named input object and returns
a named output type (no `JSON` left in any response tree), eight REST-ism action multiplexers were split
into 32 named mutations with the old fields kept `@deprecated`, and every client-facing error carries
an `extensions.code` while business rejections stay in `data.<operation>.status`. Four POS
multiplexers (`bmsPosDeposit`, `bmsPosExpense`, `bmsPosPark`, `bmsPosShift`) are still
`action`-dispatched. RN bootstrap/PIN auth moved first and generated documents compile; remaining
business workflows retain compatibility routes until their parity tests land — see
[architecture/graphql-client-readiness-brief.md](docs/architecture/graphql-client-readiness-brief.md).

Build table + roadmap: [architecture/system.md](docs/architecture/system.md#build-status-2026-09).
Migrations written but not yet applied to production are listed in
[CLAUDE.local.md](CLAUDE.local.md) § ก่อน production — check the target database, several features
look done in code but need their migration first.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the database — only approved tools in [ai/tools.md](docs/ai/tools.md).
- **The staff assistant's knowledge catalog states product capability, never tenant state.**
  `AVAILABLE`/`CONDITIONAL`/`BETA`/`MOCK` describe one capability, not a module — shipment
  creation is `AVAILABLE` while carrier booking stays `MOCK`. A status that overstates what has
  been verified end to end is a lie told to staff at a counter, so e-Tax, Shopee/Lazada and
  ESC/POS printing are `BETA` until a real integration is proven.
- **Standing on a page re-ranks its guides; it never turns them into an answer.** The
  current-page bonus is larger than any relevance floor, so a result carries `matchedQuery` and
  only query-matched entries become citations or links — otherwise every guide on the page is
  cited for every message and "no verified guide matched" becomes unreachable. Page context is
  retrieval only and never grants permission; a guide's `route` must be a page that renders,
  because the assistant hands it to the user as a link.
- **A verified answer is a payload, not a retrieval key.** Each FAQ and each limit group names the
  guide that owns it; questions, group titles and the phrasings staff really type are folded into
  that guide's aliases, but answer and rule text is never scored. Scoring long prose makes every
  answer a weak match for every question — the "it found something" failure. The Manual renders the
  same arrays, so an answer has one home, not two.
- **A question is answered by the entry that leads the result, not by one buried in it.** Every
  question the product ships (starter chips) or was verified against is pinned in
  `scripts/ai-eval/work-assistant-question-corpus.mts` with the entry that must rank first, and
  every question that needs live data is pinned to an approved tool plus the permission gating it.
  Every guide and capability needs at least one such question: an entry nobody can ask about is
  unreachable, and unreachable text is where wrong text survives.
- **The register assistant stays inside the register.** `/pos` gets deterministic guide search
  with no GraphQL/AI call, limited to guides performed at the register (`pageId === "pos"`) — a
  `pos_only` account cannot open `/admin` at all, so answering a cashier with a back-office
  guide is a dead end.
- AI **never** fabricates stock/price/order numbers — facts come from a successful backend result.
- AI **never** sets a price, a pack size, or a pieces-per-unit count — a pack code returned by
  `check_stock` reaches `create_order` as a name only; pieces-per-pack and pack price are always
  read from `bms_product_packs` server-side, never supplied by the model.
- Sensitive actions (delete, refund, cancel, change price, adjust inventory) require **human
  confirmation + RBAC permission**.
- **A customer order is never created until the customer has seen every line and said yes.** The
  first `create_order` call for a basket on the customer surface writes nothing — it returns
  `CONFIRMATION_REQUIRED` plus the resolved lines, the pipeline shows a **server-composed** itemised
  summary (never the model's prose), and only a call whose lines still match the fingerprint the
  customer affirmed creates the order. The confirmation signal is server-only (`ExecCtx`), so the
  model cannot grant it to itself, change a quantity, or add a line after the customer agreed.
- Ambiguous pharmacy catalog matches use server-owned line codes (`A1/B2`) persisted in conversation
  state. A choice turn always produces a new server-composed basket summary; confirmation text sent
  with the choice cannot skip that second, fingerprint-bound confirmation.
- **AI never answers with an empty turn.** A model turn carrying no text block is a system failure
  (`ai.empty_reply`), not an answer — the customer is told the system failed and a human is alerted.
  Never tell a customer to retype what they typed correctly.
- Every AI tool attempt is audited without raw arguments/PII; successful writes and confirmed
  proposals keep their normal domain audit entries too.
- High-impact records use revision history for before/after snapshots; the audit log remains the
  source for who/when/action. Sensitive writes record their audit row **inside the same transaction**
  as the money or stock they move, so a committed movement can never lack one.
- **A REST route is not protected by being under `/api`.** `middleware.ts` guards `/admin/**` only.
  Every `/api/bms/*` route authenticates itself — `authorizeAdminRoute(permission)` for staff routes,
  a verified signature for webhooks, a job token for cron — and **derives the tenant server-side**.
  A route that is public by design needs a rate limit, because a public endpoint that calls a model
  spends the operator's money. Enforced by `scripts/inventory-tenant-scope-contract.test.mts`.
- **Counter POS and branch inventory operations have GraphQL mobile adapters plus REST
  compatibility.** A register uses `x-scope: pos` with a device Bearer token; the server derives its
  tenant/location/device, and every mutation separately verifies cashier PIN + action permission.
  REST and GraphQL call the same service and neither makes an operation an AI tool. A future staff
  tool still needs a wrapper in `lib/bms/tools/catalog.ts`, server-derived tenant, immediate RBAC
  re-check, in-transaction audit, and explicit confirmation for stock/money movement. Never call one
  adapter from another as a shortcut.
- **Realtime is an invalidation hint that shares a transaction with the money it describes.** An
  event is enqueued into `bms_realtime_outbox` in the same tenant transaction as its aggregate
  change; publishing happens after commit from a leased dispatcher, and `apps/ws` never connects to
  PostgreSQL. That boundary is also the danger: **anything a realtime trigger does wrong rolls back
  a business write**, so a trigger may only touch columns that exist on *its own* table and the
  `SECURITY DEFINER` owner needs an explicit table grant — `BYPASSRLS` skips the row policy, never
  the grant. Payloads carry allowlisted scalars only, never PII, message bodies, payment details or
  pharmacy clinical content. Full rules:
  [agent-invariants.md § Realtime invalidation](docs/agent-invariants.md#realtime-invalidation-architecture).
- **A column the order path writes unconditionally is a deploy blocker, not a feature flag.**
  `createOrderInTx()` writes every column in its `INSERT` for every channel of every tenant, so a
  database missing one cannot complete a single sale. Declare it in `scripts/schemaReadiness.mts`
  and regenerate `db/checks/schema-readiness.sql` in the same change — a readiness list that is
  missing a file answers "ready" and is worse than no check at all.
  `schema-readiness-coverage-contract` walks back from the real `INSERT` column list and fails when
  one is undeclared.
- **`schema.graphql` is the client contract, not a build artifact.** Production keeps introspection
  off, so an external client generates from the committed SDL; regenerate it with
  `npm run schema:export` in the same change that alters the schema or
  `graphql-schema-artifact-contract` fails. A mobile operation never accepts tenant, location,
  device or shift from its caller — the server derives scope from the device token or
  `getTenantId(ctx)` — and a money/stock/document mutation carries an `idempotencyKey`. Old fields
  are `@deprecated` and kept; nothing is removed while a caller may still exist.
