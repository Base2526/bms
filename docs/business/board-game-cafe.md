# Board Game Cafe

`board_game_cafe` is the archetype for shops whose primary sale is a timed in-store play session,
often mixed with snacks, drinks, retail accessories, memberships, and a play-library of board games.

## Domain Boundary

Keep four concepts separate:

| Concept | Source of truth | Why |
| --- | --- | --- |
| Sellable goods | Product + Inventory | Snacks, drinks, sleeves, dice, and games sold as retail stock still leave the shelf through POS. |
| Play time | Board-game session/rate module | Time charges depend on participants, start/end time, rounding, grace periods, discounts, and membership rules. |
| **What a bill settles** | **Billing group (`9.89`)** | A table visit and a bill are not the same thing. One table can owe several bills, and each is paid by a different person at a different moment. |
| Play-library games | Game Library assets | A playable game copy is borrowed, returned, inspected, damaged, or retired. It is not sold and should not reduce stock when played. |

The register opens a board-game session, calculates time charges in the backend, adds sellable
products to the same bill, then settles through the existing POS/payment path. Board-game sessions do
not create a second payment flow.

### The bill belongs to a group, not to a table (`9.89`)

`9.80` put the money on the *session*: one settlement key, one frozen `charge_snapshot`, one
`current_order_id`, and `9.82`'s unique index claimed that order per session. `billing_group_no`
already existed on a participant and reached the charge lines, but every group still settled inside
the same order — so a split table could produce only one bill, and "this group pays and leaves" had
nowhere to be recorded.

`bms_board_game_billing_groups` now owns the money; the session owns seating and timing only.

| Rule | Why it is that way |
| --- | --- |
| Opening a table creates one group per group number the staff typed | A table nobody split gets exactly one group, so its bill is identical to before. |
| Closing a table closes **every open group**, one bill each | The register settles them one at a time; the counter sees which groups are still unpaid. |
| The table's status is derived from its groups | It stays occupied while any group is open or unpaid, which is what decides whether the table can be reopened. Paying one bill must never free a table where people are still playing. |
| A closed group refuses new players | Its charge lines were frozen at close, so a late arrival could never be charged. |
| The order records both the group and the session | The group is what was paid; the session is which table visit it came from, which outlives the tab. |
| The session's own money columns are history | Nothing writes `amount_due`, `charge_snapshot`, `current_order_id` or the settlement keys on a session any more. A column that *some* code still writes is how two sources of truth start. |

### Ordering onto a bill while people are still playing (`9.90`)

`bms_board_game_group_items` is the tab: what a group has ordered so far. It is the source of
truth; the group's PENDING order is a **reservation derived from it**, rebuilt whenever the lines
change — the same shape a restaurant check uses for its kitchen rounds.

| Rule | Why it is that way |
| --- | --- |
| Adding a line reserves stock immediately | The drink is gone the moment it is handed over. Inventory that still counts it is wrong for hours, and without a reservation two tables can both be promised the last box — the second one finding out at settlement, after it was drunk. |
| A removed line is kept as `CANCELLED` | "We never ordered that" is the dispute this table exists to answer. Deleting the row answers nothing. |
| The old reservation is released **inside the settlement transaction** | Releasing it any earlier opens a window where another register can sell what this table is already holding. |
| Serial-tracked products cannot go on a tab | Serial numbers (`8.3`) are collected from the register's cart. A tab line never passes that gate, so it would be sold with no serial recorded. |
| The register charges `totalDue` (time + tab) | The server always bills both. A screen that adds only the play time sends a short amount and the whole bill is thrown away as `PAYMENT_MISMATCH` in front of the customer. |
| Discounts preview the combined product basket | Wholesale tiers, product promotions, member tiers, coupons, points, and manual discounts use the tab products plus any products added at checkout. Both registers quote that basket through `createOrderInTx()` in an always-rolled-back transaction and recheck it immediately before payment. Play time and service/extra lines remain outside the discount base. A coupon is rejected when that product base is zero, so a service-only bill cannot consume a redemption for ฿0. |
| Cancelling a table releases every reserved line | A group that walks out must not keep stock reserved against a table nobody is sitting at. Only a group that has actually **been paid** blocks cancellation. |

The tab's value lives in `tab_amount`, separate from `amount_due`, which `9.89` defined as the
frozen play-time charge. One column holding both would mean closing the table silently overwrites
the snack total with the time total.

The status formula lives once, in `refreshSessionFromGroupsInTx()`. `pos.ts` calls it rather than
writing its own `UPDATE`; two copies would eventually disagree about whether a table is free.

### One group pays while the table keeps playing (Phase 3)

A cashier can close one `OPEN` billing group instead of freezing the whole session. The command
stores that group's end time, play-time snapshot, tab value and idempotency claim, then hands its
group id to the existing POS checkout. Other groups stay `OPEN`: their clocks keep running, their
tabs remain editable, and new participants may still join an open group.

The table remains occupied after that bill is paid because session status is still derived from all
groups. A participant in a closed group cannot be marked as leaving or edited afterwards—the frozen
charge is the receipt evidence. A checked-out game belongs to the session rather than one bill, so
it does not block an early group from leaving; it does block the **last** open group from closing
until every copy is returned. Closing the last group with an asset still out would create a table
with no active players but no responsible open bill.

Both browser and native registers address checkout by `billingGroupId`. A group's PENDING order may
already exist as the reservation for its snack tab, so `currentOrderId` is not evidence that payment
finished; `CLOSING` is the authoritative "awaiting payment" state and `PAID` is the terminal one.

### Moving and merging tables without touching a bill (Phase 4)

Through `9.90` the session owned `table_id`, so the floor could not record what a cafe actually
does. `9.91` introduces a **seating**: the current physical occupancy of one table. One `ACTIVE`
seating owns one table; a session — one party's visit, with its clocks, participants, loans and
billing groups — points at the seating it is currently sitting at.

* **Move** sends the selected party to a free table. When that party is alone at the table the
  seating itself moves, keeping its id and opening time; when the table had been merged, only the
  selected party is detached onto a new seating, so merging is not a one-way door.
* **Merge** sends every party at this table into an occupied destination's seating and closes the
  source seating as `MERGED`. Several sessions then share one seating and appear as one card on the
floor, while each keeps its own clock, tab and bills.

Game loans and held identity documents keep that same session ownership. The register therefore
loads every session sharing a merged seating, shows the combined assets grouped by the table where
each visit opened, and still sends a new checkout/hold command only to the explicitly selected
party. Changing that selection clears the previous detail immediately; a slow response for the old
party must never put its command buttons back on screen.

Neither command touches a session, billing group, tab row or order: ids, frozen charge lines and
PENDING reservation orders survive both unchanged. Each command refuses the other's job — moving
onto an occupied table and merging into a free one are both rejections — because a silent guess
relocates people the operator did not choose.

`bms_board_game_sessions.table_id` becomes history: the table the visit opened at. Anything asking
"which table is this party at now?" reads the seating, or it shows a guest a table they left an hour
ago. A table is free only when every session sharing its seating is settled or cancelled, so the
public directory and the floor both count occupancy from `ACTIVE` seatings rather than sessions.

### Member passes: time the member already paid for (Phase 5)

A cafe sells a monthly unlimited pass or an hour bundle. `9.92` records it as an entitlement, not
as a Product: like play time itself it has no SKU and never moves stock. `bms_board_game_pass_plans`
is what the shop sells; `bms_board_game_member_passes` is one member's contract with the plan's
price, kind and minutes **snapshotted at sale time**, so raising a price never rewrites a contract
already sold; `bms_board_game_pass_ledger` is every movement of minutes, with the balance on the
contract row as a cache of it.

Coverage is applied where the money is decided — when a billing group is **closed**. That is the
moment a group claims settlement exclusively, so it is also the only safe moment to spend a quota:
the passes are locked, the charge lines are computed against them, the frozen snapshot records
`grossAmount`, `coveredMinutes` and `coveredAmount` per person, and the minutes are spent in the
same transaction. A preview never spends anything, or two tables open at once would each be quoted
the same last hour.

Rules worth knowing before changing any of it:

* An unlimited pass must leave **exactly** zero — the covered amount is subtracted as the whole
  line, never recomputed from minutes, or a satang is left on a bill nobody can explain.
* A line that costs nothing (an observer, or a rate of zero) never burns a member's quota.
* A member holding several active passes uses the one that can actually help: unlimited first, then
  one with minutes left, then the soonest to expire.
* Closing the same bill twice spends nothing twice — the ledger is unique per
  (pass, billing group, participant) — and cancelling a table that was already closed gives the
  minutes back, because nobody paid.
* A bill fully covered by a pass totals ฿0. The register may settle it with no payment lines at
  all; that exception exists for this one path and the "payments must equal the amount due" check
  still decides whether zero is the right answer.

A plan may belong to one branch (`location_id`) or to every branch (`NULL`). That is enforced in the
service and at the route, and the catalogue a screen receives is filtered to the branches the account
actually runs — a screen that offers a plan the server will refuse is lying to the person using it.
`9.94` snapshots that scope onto the member's contract too. Coverage and every scoped read use the
contract's branch, not the plan's current branch, so editing the catalogue later cannot move an old
entitlement or let it pay for a visit at another branch.
The minute balance on a contract is a cache of the ledger, and `boardGamePassOutstanding()` measures
it: `balanceMismatchCount` must be zero before books close, the same rule points and store credit
already follow.

Selling a pass is a guarded action of its own (`board_game.pass.manage`), the same shape gift cards
use (`8.9`): taking the money still goes through the existing POS sale, and the contract records
which order paid for it. Cancelling a pass stops it covering anything; refunds go through the POS
refund path like any other money.

### Automatic pass renewal (`10.4`)

Automatic renewal uses customer-bound store credit because the platform has no verified stored-card
provider. Staff enable it from an active pass and record the member's consent. The agreement snapshots
the sold terms and branch; each due cycle creates a **new** pass rather than extending or rewriting the
old entitlement.

The frequent guarded cron locks one agreement and its funding credit, then creates the pass, its ISSUE
ledger row, a confirmed `BOARD_GAME_MEMBER_PASS` payment, and the store-credit REDEEM row in one
transaction. If the credit is expired, belongs to somebody else, or has insufficient balance, no pass
is created: the agreement becomes `PAST_DUE` and retries the same scheduled cycle later. Card charging
must not be added until a real provider/vault and consent contract exists.

### Packages and play-time promotions (`10.3`)

Board-game offers are typed rules over the play-time charge: percentage off, fixed price per person,
or fixed price for the billing group. They may be branch/date/weekday/time scoped, require a minimum
duration or party size, and optionally require an exact SKU already present on the group's real tab.
That SKU remains an ordinary Product line with normal reservation and stock movement; the offer never
manufactures an included item or hides it in a time line.

At billing-group close the server evaluates every eligible offer and compares the best result with
member-pass coverage. The lower total wins; a tie chooses the offer so no pass quota is wasted. The
winner and discount are frozen into each charge-snapshot line. The browser and native registers need
no separate discount command because both consume that same frozen group amount.
The register shows only that winning benefit (offer name and saved amount, or pass coverage) in the
payment summary; the offer catalogue stays in Admin. The member-pass table likewise uses one compact
renewal badge with the next date or current problem, while full controls remain in the renewal section.

### The card at the counter while a box is out (Phase 6)

A cafe hands a two-thousand-baht boxed game to a stranger who sat down twenty minutes ago and holds
an ID card until the box comes back. `9.93` turns that slip of paper in the drawer into a record the
shop can act on: `bms_board_game_identity_holds` belongs to the **visit**, not to the member, because
the question it answers is "whose card is in the drawer right now".

The number is optional — a shop that only keeps the physical card still gets the gate below, and
requiring it would push that shop back to paper, which is worse in every direction. When it is typed
it goes through `encryptSecret()` before it touches the table, the same envelope channel tokens use;
production refuses to encrypt without `BMS_SECRET_KEY`, which is the right answer for an ID number.
Screens show only the last four characters, because a "find this card in the drawer" that needed a
decrypt forty times a day would stop the decrypt being an exceptional act.

Rules worth knowing before changing any of it:

* **Handing the card back erases it.** The number exists to answer "who walked out with our game";
  once the card is in the guest's hand there is no question left, so the name, the number and the
  last four are cleared in the same transaction and `purged_at` is stamped. The row survives as a
  tombstone — type, times and the two staff members — so "did we give it back, and who handed it
  over" is still answerable. A hold that is still `HELD` deliberately keeps its number: that is the
  incident the number was recorded for.
* **A table cannot end while a card is still held.** The gate sits at all three exits a table has —
  closing the last billing group, closing the whole table, and cancelling it — because leaving one
  open would make the other two decorative. It is the last group only: a party that pays and leaves
  early closes normally while the rest keep playing, exactly like a game copy still on the table.
  A card can be taken only while the session is `OPEN`; once billing changes it to `CLOSING`, no
  late request can slip a new card in behind that gate. Final POS settlement checks again for old
  `HELD` rows, and locks session → billing group → order in the same order as close/cancel.
* Taking a game box back is **not** the same as giving the card back. The system records a physical
  act; it cannot perform one.
* **Reading a stored number is its own act.** `board_game.identity.reveal` (Manager) gates it, it
  exists only in the back office, and every read writes an audit row. The register never has it: a
  register is a shared screen that faces the customer, so "show the ID number" one tap away is the
  wrong place for it. Taking and returning a card use `board_game.session.manage`, which everyone at
  the counter already holds.
* No photograph of the document is stored. Type, name and (optionally) number is the whole record.

Both registers reach it: the browser over `POST /api/pos/board-game` and the native app over
`bmsPosTakeBoardGameIdentityHold` / `bmsPosReleaseBoardGameIdentityHold`, through the one shared
command table. The floor tab of `/admin/board-game` also lists **every card the branch is still
holding**, because "is anything left in the drawer" is a closing-time question and answering it one
table at a time means nobody answers it.

## Implemented Shape

The first operational release includes:

1. `board_game_cafe` archetype and onboarding policy.
2. Board-game table/session records: open, extend, close, cancel.
3. Participant rates: general, student, member, observer/guardian.
4. Time-billing rules: minimum minutes, rounding minutes, grace period, overtime behaviour.
5. Session alerts for ending-soon and overdue states.
6. POS bill generation using existing order/payment settlement, including one-group-at-a-time close.
7. Game Library: title + physical copy with condition/status.
8. Purchase receiving destination: stock for resale or Game Library for play copies.
9. Existing CRM customer/member identity linkage and POS split-payment support.
10. Public discovery: opt-in listing, location, opening hours, published rates, game highlights, and aggregate availability.
11. Floor moves: relocating a party to a free table and merging two occupied tables, without touching any bill.
12. Member passes: monthly unlimited or hour-bundle contracts that cover play time when a bill is frozen.
13. Identity holds: an encrypted record of the card held while a game box is out, erased when it goes back.
14. Walk-in queue: branch/service-day queue numbers, call/no-show/cancel states, table-fit visibility,
    and atomic seating into the normal session path.
15. Staff-managed advance reservations: a confirmed table/time window, overlap protection, arrival
    check-in, cancellation/no-show, and atomic seating into that same session path.
16. Public reservation requests: opt-in per branch, staff review before a table is promised, opaque
    customer cancellation, and retryable email reminders for confirmed bookings.
17. Reservation completion: branch-local request time, bounded request expiry, immediate decision
    email, customer status polling, configurable deposits, private slip review, and deposit credit
    applied through the existing POS payment path.

The public directory is `/board-game`. A branch stays private until a manager explicitly publishes
it with valid coordinates. The public API exposes aggregate table availability only; it never returns
table identifiers, active sessions, participants, or customer data.

Advanced board-game profitability and utilization analytics remain a later phase. Stored-card renewal
also remains unavailable until the platform has a verified payment-instrument provider contract;
`10.4` supports automatic renewal through customer-bound store credit only.

### Walk-in queue (`9.99`)

`bms_board_game_waitlist` owns only the time before a party receives a table. It is not a session,
does not accrue play charges, and never reserves sellable stock. Queue numbers are scoped to a branch
and its service day; an open row stays visible until staff seat, cancel, or mark it no-show.

The queue is ordered by arrival, but seating is deliberately not strict FIFO: a free two-seat table
cannot serve the six-person party at the head of the line. Both registers show compatible free tables
while preserving arrival order and wait duration. An estimated table time comes from the current
sessions' `expected_end_at` and is guidance, never a promise; guests may extend and merged seatings
may contain several sessions.

Seating a queue row locks it, opens the real board-game session through
`openBoardGameSessionInTx()`, and records `SEATED` plus the session/table links in the same tenant
transaction. A commit can therefore never leave a seated queue with no clock or an opened clock whose
queue still says waiting. From that point onward seating, timing, bills, tabs and game loans remain
owned by their existing domains; the queue row is historical evidence for measured waiting time.

`scripts/board-game-waitlist-contract.test.mts` guards the static architecture in the pure suite.
`scripts/board-game-waitlist-db-contract.test.mts` creates an isolated cafe tenant and proves queue
number concurrency, replay conflicts, branch scope, capacity rollback, and atomic seating against a
real local Postgres through the guarded DB-test runner.

### Advance reservations (`10.0`)

An advance reservation reuses `bms_board_game_waitlist` with `kind = 'RESERVATION'`; it is still the
state before a real visit, not a second session or billing path. Staff choose one branch table, start
time, expected duration, party size and bounded contact details. A table row plus a table-scoped
advisory lock serialise booking, check-in and seating so two registers cannot promise overlapping
windows. A live open-ended session blocks the table; a fixed session is eligible only when its
expected end does not cross the requested start.

A confirmed reservation can be checked in from two hours before until six hours after its start.
Check-in changes it into the normal `WAITING` queue and allocates the service-day queue number in the
same transaction. Staff may also seat it directly inside that arrival window; seating calls
`openBoardGameSessionInTx()` and writes the session/table links atomically, exactly like a walk-in.
Confirmed, waiting and called reservations continue to hold their requested window until seated,
cancelled or marked no-show.

Before check-in, staff may correct the contact, party size, table, start time and duration. A
reschedule locks the reservation row, then locks the old and new table keys in sorted order before it
re-runs capacity, live-session and overlap checks; editing therefore cannot bypass the promise made
by creation or deadlock two registers swapping tables. Both registers can search by name, phone or
table and filter the active list by service date.

The frequent cron calls `/api/bms/board-game/reservations/expire`. It is guarded by
`authorizeCronRequest()`, recorded through `recordJobRun()`, and claims due rows with
`FOR UPDATE SKIP LOCKED`. A confirmed reservation still untouched six hours after its start becomes
`NO_SHOW`; a checked-in `WAITING`/`CALLED` party is deliberately left for staff to handle.

Staff-operated booking is available on the browser and native POS. Public requests and reminders use
the separate contract below. A deposit must not be represented as a Product SKU or mixed into
play-time billing.

### Public reservation requests and reminders (`10.1`)

Public booking is an explicit branch opt-in layered onto the published directory. A customer submits
contact details and a requested time window, but receives `REQUESTED`, not a table promise. The row
has no `reserved_table_id` until a PIN-authenticated staff member chooses a capacity-safe table;
confirmation repeats the live-session and overlap checks under the same per-table advisory lock as a
staff-created booking. Rejecting or cancelling a request never starts a session.

The customer manages the request with a high-entropy token generated in the browser. Only its SHA-256
hash is stored, and public reads return a bounded booking view rather than contact details or internal
table ids. Both public endpoints are rate-limited.

Confirmed public bookings snapshot the branch reminder lead time. The frequent cron claims due rows
with `FOR UPDATE SKIP LOCKED`, sends through the configured email provider, and records `SENT` or a
bounded `FAILED` reason with at most three attempts. A stale `SENDING` claim becomes retryable after
30 minutes. Delivery is operational evidence only; the reservation row remains authoritative.

### Reservation completion and deposits (`10.2`)

The browser sends the requested wall-clock value unchanged and the service converts it with the
published branch timezone. A stable browser-generated request token is reused after an uncertain
response, so a retry returns the original row or rejects different request data instead of creating a
second booking. Unreviewed requests expire at the earlier of their configured TTL or requested time.
The customer status page polls and refreshes on focus; staff decisions are emailed immediately with
bounded retry evidence, independently of the later booking reminder.

A branch can require no deposit, a fixed amount, or a percentage of the estimated general play-time
charge. The policy, amount, due time and cancellation refund cutoff are snapshotted when staff confirm
the table. Customer proof is an image stored as a tenant-owned private file; the payment stays
`PENDING` until a user with `payment.confirm` confirms it. An unpaid confirmed booking expires after
its payment window, and check-in/seating require `NOT_REQUIRED` or `PAID`.

The money remains in `bms_payments`: `payable_type = BOARD_GAME_RESERVATION` is the cash receipt,
while a `RESERVATION_DEPOSIT` payment on the real POS order is an internal tender linked back to that
receipt. `bms_board_game_reservation_deposit_applications` prevents one deposit from being used twice.
Tax and loyalty use the real gross sale; only the amount collected at settlement is reduced. A timely
cancellation creates a refund-pending state, a late cancellation/no-show forfeits it, and any balance
left after all billing groups settle can be partially refunded in the same payment ledger. The deposit
is never a Product SKU, never moves stock and never becomes a second board-game billing ledger.

## Dev/Test Fixtures

`POST /api/dev/fake/bms-board-game` is platform-admin only and disabled in production unless fake
seeding is explicitly enabled. It prepares a board-game cafe with `FAKE`-marked zones/tables, four
rate types, CRM members, open-ended and fixed-duration sessions, ending/overdue/closing examples,
multiple billing groups, game titles/copies, active and returned loans, an issue case, and an
unpublished public-profile draft. The full-shop provisioner runs the same fixture automatically when
the selected archetype is `board_game_cafe`.

`DELETE /api/dev/fake/cleanup` removes linked fake POS orders and queue history before sessions, then
removes the library, floor, rates, and unpublished profile fixtures in foreign-key order. It does not delete a
public profile after an operator has published it. Fake staff accounts that were later used by
protected business-history rows are reported as `usersSkippedReferenced` and retained instead of
making the whole cleanup fail or deleting that history.

## UX Rules

- Products are only for things the shop sells.
- Time rates are configured in a board-game settings surface, not in the product form.
- Play-library copies have copy codes and condition/status, not sellable SKU stock.
- Public discovery must be opt-in and read only published/aggregate data.
- Any action that changes money, such as editing `started_at`, waiving overtime, changing a rate, or discounting a session, needs permission and audit.
- A bill is always addressed by its billing group id. Handing the register a table id is ambiguous the moment a table is split, and an operation that guesses will one day charge the wrong people.

## Register surfaces (browser and native)

### Guest service bell (`9.96`, scope hardened by `9.98`)

An open board-game session can issue a session-scoped `/bg/[token]` QR from the native register.
The guest can request game/rules help, report missing or damaged pieces, ask for food/drinks, request
the bill or more time, report a spill, or enter a short free-text request. The request is operational
work only: it never changes play time, freezes a bill, adds a sellable line, moves stock, or changes a
game-copy condition automatically.

The native floor keeps a live branch-scoped bell badge, marks the affected table, and lets a
PIN-verified `board_game.session.manage` operator acknowledge then complete the request. New calls
reuse the global POS sound/vibration pipeline. A request belongs to the board-game session, while its
displayed table is resolved from the session's current seating, so moving or merging tables does not
send staff to the scan-time table. Only one active request may exist per session; the public route is
rate-limited and idempotent, and another request becomes available after staff completes the current
one. Paying or cancelling the session revokes its guest token and expires any active calls in the
same database transition.

Issuing access and acknowledging/completing a call also consume the native register's stable
idempotency key, including a request hash so reusing a key for different work is rejected. Database
constraints bind token, session, branch and scan-time table as one tenant/branch chain; application
checks remain in place for readable errors, but are not the only isolation boundary.

`GAME_ISSUE` deliberately does not mark a copy damaged. After checking the physical game, staff use
the existing return/condition workflow to choose `NEEDS_CHECK`, `MISSING_PARTS`, `DAMAGED`, or another
authoritative copy status. Completing a service call means the guest was helped, not that the asset
was repaired.

Both registers carry the same `โต๊ะ/เวลา` tab, gated on the `board_game_cafe` archetype, and both
decide with the same code. The browser register (`/pos`) reaches it over REST
(`POST /api/pos/board-game`) because the POS layout deliberately carries no Apollo provider; the
native register reaches it over GraphQL (`bmsPosBoardGame*`). Both adapters call
`lib/bms/boardGamePosOperations.ts`, which owns the three things that must never differ between
surfaces:

| Owned by the shared module | Why it cannot live in an adapter |
| --- | --- |
| The permission of each command (`BOARD_GAME_POS_ACTIONS`) | Two permission tables drift, and the surface that keeps the old rule keeps allowing what the other already refuses — silently |
| The branch check for a session or a loan id | An id from another branch must be "not found" on both surfaces, not just the one that remembered to check |
| Input normalization into what the service accepts | Two normalizers mean the same screen action charges differently depending on which register the staff picked up |

Only authentication (device token + PIN body vs. device Bearer + credentials input) and the error
shape (HTTP status vs. `extensions.code`) belong to the adapters. A rule rejection is answered as a
decision on both — `409`/`CONFLICT` with the reason the counter needs — and never as the masked
`500`/`INTERNAL_SERVER_ERROR` whose client contract tells the caller to retry the same key forever.

Before this, the web could only open tables from `/admin/board-game`, which a `pos_only` cashier
cannot reach at all — so the shop's most frequent action was the one its register could not do.

When the paired store archetype is `board_game_cafe`, `apps/mobile` shows a dedicated `โต๊ะ/เวลา`
tab. It reads the branch floor, rates, sessions, and playable-copy availability through generated
device-scoped GraphQL operations. Staff can open an open-ended or fixed-duration session, choose
existing members, assign participant bill groups, receive ending-soon/overdue popups, add time,
record people leaving, add snacks and drinks to a group's tab or take them off again, and check game
copies out or back in with an issue note. On a merged table the app lists the parties sharing the
seating and makes the staff pick one before any command runs — a button that silently acts on
whichever party the screen happened to select is a button that charges the wrong people.

Closing a session freezes the server-calculated participant charge lines. The app then opens the
normal POS checkout, where snacks and other sellable products can share the bill. The time amount is
shown as a service line but is never sent as a SKU; settlement supplies only the billing-group ID and
the server validates the branch/status and links the paid order atomically. All mutations retain one
idempotency key across an unknown network result.

Both registers also have to be able to settle a bill that has nothing left to collect: a member pass
can cover the whole time charge (`9.92`), and a group of non-billable spectators or a visit still
inside its grace window reaches ฿0 with no pass involved at all. `recordPosSale()` has allowed that
since `9.92`, but each adapter parses its own payment rows first, so the exception has to exist at
every edge — the browser sends `payments: []` when the amount is zero and was refused by its own
route until `9.94`. What a pass paid is server data (`passCoveredAmount`), shown on the bill line by
both registers; deriving "a member pass covered this" from a zero total instead would put a claim on
a customer-facing screen that is false whenever the zero came from somewhere else.

### What a register may print as money, and what it must fit on a phone

`bms_board_game_billing_groups.amount_due` is the play charge **frozen at close** (`9.89`; the
only write is in `closeOpenBillingGroupInTx`). A group that is still OPEN therefore holds 0 — a 0
that means "not frozen yet", not "owes nothing". `/admin/board-game` and the native register have
always shown the amount only once the session is `CLOSING`; a surface that prints it in every state
tells the counter that a table two hours into its session owes nothing. The browser register now
follows the same rule: a floor tile shows money only when a bill is actually waiting to be
collected, and the session card splits "frozen and waiting" from "the open group’s tab" instead of
adding them into one number that has no name.

The register is also used one-handed on a phone, so two layout rules hold for this tab:

| Rule | Why |
| --- | --- |
| A row that pairs text with buttons must wrap, and its text column must be allowed to shrink | Measured at 320px before this was enforced: the game-return buttons ended 7px past the viewport with no horizontal scroller to reach them, and "report a damaged box" is the only way a shop records that liability |
| The floor grid narrows its track on phones, and every track stays wrapped in `min(<px>, 100%)` | A 168px track gives **one column** at both 320px and 375px, which turns the floor plan into a list; a bare `minmax(<px>, 1fr)` insists on its minimum even when the box is narrower and overflows instead |

Both rules are pinned by `scripts/board-game-register-contract.test.mts`.

## Reuse Existing BMS

Reuse existing services for:

- product catalog and inventory for retail goods;
- purchase orders and receiving for supplier workflow;
- POS shifts, payments, receipts, returns/voids, and tax documents;
- customer/CRM records and membership identity;
- RBAC, audit, realtime, and reports.

New board-game services must live under `apps/web/lib/bms/` and keep API/routes thin. Every
tenant-owned table needs `tenant_id`, RLS, and `bms_app` grants.
