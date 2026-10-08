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

The counter and printed receipt explain the same frozen evidence. Each closed participant line keeps
the rate label, entry time, actual exit/close time, charged-through time, actual minutes, billable
minutes and final amount. Actual and billable time are deliberately separate: minimums, grace,
rounding and fixed-duration packages can make them differ. Product detail comes from the reserved
order snapshot, never from today's catalogue price. Product promotions remain a separate visible
discount so gross item lines reconcile to the tab amount instead of inventing a net per-unit price.
A historical receipt must therefore remain the same after a rate or product is renamed.

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

### Flexible parties and billing groups (`10.7`)

Table capacity is a warning boundary, not a hidden hard limit. Opening a table, adding a player,
moving/merging a seating, and detaching a group all compare the resulting active headcount with
`table.seats`. The server refuses an over-capacity request unless the operator explicitly sends
`allowOverCapacity`; both registers show the count and ask for a second confirmation. The override is
included in the idempotency hash and audit metadata so a retry cannot silently turn a refusal into an
approval.

Purchased time can belong to one participant rather than the whole visit. `time_mode` has three
meanings: `ACTUAL` charges elapsed time, `SESSION_END` follows the visit's fixed end when staff adjust
it, and `DURATION` snapshots that player's own `planned_end_at` from their join time. Billing uses the
participant boundary, and floor alerts use the earliest live session/player boundary; no mutable
"expired" flag becomes authority.

Two open groups in the same session can be merged before either amount is frozen. The source
participants and active tab rows move to the destination, both PENDING reservations are rebuilt in
one transaction, and the source becomes `MERGED` with a pointer to the surviving group. A merged row
is retained as history but never counts as another active/awaiting bill.

One open group can also be detached to a free table. This creates a new seating and session, then
moves the group, its participants, its PENDING tab order, and only the game loans/held documents the
operator explicitly selected. The source session remains occupied by its other groups. Detaching the
last group is rejected—ordinary seating move already expresses that operation without inventing a new
visit. Group merge/detach is allowed only while the group is `OPEN`; a frozen or paid bill is never
rewritten.

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
- Migration `10.42` adds an optional title-level catalogue image, shared by its copies.
  Admin library managers upload PNG/JPEG/WebP up to 5MB; the server decodes, strips metadata
  and resizes to at most 1200px before publishing. These are public catalogue images, never
  customer documents. Ownership comes from the authenticated tenant; no client file ID is accepted.
  Older databases still list titles without images, but image writes require this migration.
- The Admin library prints selectable QR labels containing the existing physical `copyCode`.
  A 2D scanner is required for QR labels; existing text codes still work with focused HID input.
  Browser/Desktop returns can search or scan only outstanding loans on the current seating,
  then explicitly confirm normal return or inspection. Scanning alone never writes a loan/return.
  Return notes appear with outstanding loans, not in the lending form. The lending picker uses
  the remaining row width beside its confirmation button; both have 44px touch targets.
- Desktop product details are read-only and available from the catalogue card's info icon.
  The scan bar contains only the focused input and its F12 shortcut; Enter adds the typed code.
  Regular sale scans still add items without opening a modal. Barcode, size,
  unit price and availability come from the existing branch-scoped scan service; no new sale path.
  Catalogue info buttons show only a 20px information icon with no button background or border,
  inside a transparent 44px touch target,
  independent of the general POS button padding. F12 focuses the visible desktop catalogue scan
  field without stealing focus from a dialog. A pending scan response cannot clear a newer draft,
  and clicking a catalogue card preserves any text in the scan field.
- Admin library search matches game names and copy codes, with an availability filter and 20-title
  pages. POS and Admin lending share a virtualized searchable copy picker. A keyboard scanner must
  read the unique `copyCode` registered for that physical box, not a retail product barcode shared
  by multiple boxes. Scanning is focused-input only and selects a copy; the operator still confirms
  lending. Unavailable copies remain discoverable but cannot be selected, and the existing backend
  checkout transaction remains authoritative for branch, session, permissions and availability.
- Public discovery must be opt-in and read only published/aggregate data.
- Any action that changes money, such as editing `started_at`, waiving overtime, changing a rate, or discounting a session, needs permission and audit.
- A bill is always addressed by its billing group id. Handing the register a table id is ambiguous the moment a table is split, and an operation that guesses will one day charge the wrong people.

## Register surfaces (browser and native)

Printed receipts include the saved time-charge total plus per-player details from the billing
group's frozen `charge_snapshot`: rate label, hourly rate, billed minutes, actual minutes when
recorded, net charge and applied pass/offer benefits. These are explanatory notes, not additional
charge lines; printing never recalculates the fee or reads today's rate catalog. Missing legacy
evidence stays omitted. Desktop returns to the board-game floor after the native printer reports
success. Failure leaves the receipt available for retry; browser print dialogs also leave it open
because `afterprint` cannot distinguish printing from cancellation.
The browser path keeps its print lock until the dialog ends (or its cleanup fallback runs), so
double clicks cannot open multiple dialogs and an old cleanup cannot unlock a later print.

Desktop checkout exposes member search, coupon entry and points redemption through
`bmsPosMemberPreview`. Board-game previews pass the billing-group id so the server includes its
frozen time, tab, benefits and reservation deposit. Pending or failed previews block a new sale;
an unknown sale outcome keeps its original idempotent payload for retry. A synchronous submit lock
also covers price revalidation before the first request, not only the network write. While that
write is pending or uncertain, changing tender, leaving checkout, switching cashier and unpairing
are blocked. A proxy HTTP timeout or incomplete success is still uncertain, not a rejection.
These checkout discounts
do not replace time offers. Migration `10.40` adds `TIME_BUY_GET`: each player's already-rounded
billable minutes run through repeating paid/free cycles (default 120 paid + 60 free minutes).
Partial free intervals are free; time beyond a cycle starts its paid interval again. At a hypothetical
50/hour, 3 hours costs 100, 4 hours 150, and 6 hours 200. The server uses the frozen hourly rate,
compares the offer against other eligible offers and passes, and snapshots the winner without
stacking benefits. Group fixed-price caps allocate cumulative proportional shares in satang,
so their lines sum to the capped total without negative charges or charging a zero-cost participant.
Already-frozen bills are not recalculated. Product buy-X-get-Y
is separate from time offers; `10.41` supports cross-SKU buy-A-get-B for eligible retail stock
products, not play time or playable library copies.
For a fixed-duration 2+1 visit, enter the full 180-minute playing duration. The offer discounts
billable minutes at close; it does not extend the timer from 120 to 180 minutes. The running table
still shows the frozen hourly rate, while checkout shows the winning discount and net amount.
Offer edits never reprice groups whose time has already been closed. Both the assistant capability
search and register guide explain this distinction; capability support is not evidence that a
particular shop configured an eligible offer.
Actual-time (`OPEN_ENDED` / participant `ACTUAL`) visits use the same offer evaluation as
purchased time; no advance 120-minute purchase is required. Eligibility uses the group close
time in the store timezone, including date, weekday, time window, player counts, minimum
minutes and required real tab SKU. New charge snapshots preserve the evaluation once on their
first charge line, with at most 20 failed-offer reasons (and an omitted count), plus paid/free
minutes per participant for a winning buy/get offer. Checkout displays those frozen reasons when
no promotion applies and the paid/free breakdown when it does. It never queries current offers
to explain an old bill; missing historical evidence is shown as unknown, not as proof that no
offer existed. The reason evaluator is also the pricing eligibility predicate.
Rounding, minimum time and grace are applied before the paid/free cycles: with 30-minute
rounding and no grace, 181 actual minutes becomes 210 billable minutes (150 paid minutes
under 120+60), not a flat two-hour charge. The promotion is evaluated per billable participant,
not by pooling time from different players.
The deploy readiness checks require both `10.40` columns before enabling this version's offer readers.
The desktop refresh button refreshes data in place without clearing the operator, shift or cart.
Receipt QR requires the Cloud tax-request service and a public HTTPS origin; missing readiness or
an ineligible receipt is reported to the cashier rather than printing an unusable link.

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
record people leaving, give a late player an independent purchased-time boundary, merge open groups
for one checkout or detach one to a free table, add snacks and drinks to a group's tab or take them
off again, and check game copies out or back in with an issue note. On a merged table the app lists the parties sharing the
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

## Customer chat safety boundaries

### Directory visibility versus shop chat

The branch profile has two separate audiences. `public_visible` is the opt-in for the
nearby directory (`/board-game`, `/api/board-game/nearby`) only. It is **not** a chat-off
switch. A saved profile on an active branch of an active board-game tenant lets that
shop's chat read the profile name, summary, address, phone and opening hours even when
the branch is hidden from the directory. No profile still means `NOT_PUBLISHED`;
the service never creates one automatically.

| Existing switch | Public directory | Shop chat |
| --- | --- | --- |
| Branch `public_visible` | Required to list the branch | Not required |
| `publish_rates` | Controls hourly rates on a listed branch | Controls hourly rates; off = `NOT_PUBLISHED`, not free |
| `publish_availability` | Controls aggregate table counts | Controls table and available-copy counts; off = unknown/null, not zero |
| `publish_table_details` | Controls customer-safe area/floor and capacity groups | Controls the same grouped details; off by default and never exposes table numbers, ids, occupants or sessions |
| Title `public_visible` | Controls game highlights | Controls library search results |

Lost/retired copies remain excluded. Since `10.48`, `canSubmitViaChat` is true only when
booking is enabled and the branch's deposit policy is `NONE`. Multiple matching branches still require clarification.
The tenant-scoped `listBoardGameChatBranches` and public `listPublicBoardGameCafes`
share the same SQL projection but have separate WHERE clauses. Chat has no coordinate
input, returns `distanceKm: null`, and reads at most 100 branches ordered by display name
and location ID. The public reader keeps its existing filtering, distance calculation,
ordering and limits. Internal IDs are stripped before a customer tool returns data.

#### Release note — แยกข้อมูลแชทจากรายชื่อร้านใกล้คุณ

ตั้งแต่เวอร์ชันนี้ แชทของร้านตอบค่าเล่น จำนวนโต๊ะว่าง รายละเอียดโซน/ชั้นและขนาดโต๊ะแบบรวม
และเกมที่ติ๊กแสดงได้ตามสวิตช์ “เผยแพร่ค่าเล่น / เผยแพร่โต๊ะว่าง /
เผยแพร่โซนและขนาดโต๊ะ” และ “แสดงต่อสาธารณะ” ของแต่ละเกม
โดยไม่ต้องเปิดร้านในรายชื่อร้านใกล้คุณ ชื่อสาขา คำอธิบาย ที่อยู่ เบอร์โทร และเวลาเปิดปิด
ในโปรไฟล์สาขาถูกใช้ตอบลูกค้าในแชทด้วย

**สวิตช์เผยแพร่ค่าเล่นและโต๊ะว่างมีค่าปริยายเป็นเปิด (`TRUE` ตั้งแต่ migration `9.83`)**
ร้านที่มีโปรไฟล์อยู่แล้วแต่ซ่อนจากรายชื่อสาธารณะจึงอาจเริ่มตอบข้อมูลนี้หลัง deploy
หากไม่ต้องการให้แชทตอบเรื่องใด ให้ปิดสวิตช์นั้นที่ `/admin/board-game`
สวิตช์รายละเอียดโซนและขนาดโต๊ะเพิ่มใน `10.50` และปิดเป็นค่าปริยาย เพื่อไม่ขยายข้อมูล
ของโปรไฟล์เดิมโดยไม่ได้รับความยินยอม เมื่อเปิดแล้วจะเผยแพร่เฉพาะชื่อโซน/ชั้น จำนวนที่นั่ง
และจำนวนโต๊ะแบบจัดกลุ่ม ไม่ส่งเลขโต๊ะ รหัสโต๊ะ session หรือข้อมูลลูกค้า
หน้าค้นหาสาธารณะยังไม่แสดงร้านที่ปิด “แสดงในรายชื่อร้านใกล้คุณ” เหมือนเดิม
การแยกตัวอ่านเดิมไม่มี migration หรือสวิตช์ใหม่; `10.50` เพิ่มเฉพาะ opt-in รายละเอียดโต๊ะ
ส่วนคำขอจองผ่านแชทเพิ่มแยกใน `10.48` ด้านล่าง

Read-only impact count before deployment (distinct shops versus branch profiles; a rate-enabled
shop may still have no active rates, so this measures eligibility, not promised answers):

```sql
SELECT COUNT(DISTINCT profile.tenant_id) AS affected_shops,
       COUNT(*) AS affected_branches,
       COUNT(DISTINCT profile.tenant_id) FILTER (WHERE profile.publish_rates) AS rate_enabled_shops,
       COUNT(DISTINCT profile.tenant_id) FILTER (WHERE profile.publish_availability) AS availability_enabled_shops
FROM bms_board_game_public_locations profile
JOIN bms_locations location
  ON location.tenant_id = profile.tenant_id AND location.id = profile.location_id
JOIN bms_tenants tenant ON tenant.id = profile.tenant_id AND tenant.active
JOIN bms_store_profile store
  ON store.tenant_id = profile.tenant_id AND store.business_archetype = 'board_game_cafe'
WHERE profile.public_visible = FALSE
  AND (profile.publish_rates OR profile.publish_availability)
  AND location.active;
```

Verification: `scripts/ai-eval/board-game-customer-contract.test.mts` pins the independent
readers, mandatory chat tenant and the pre-split public SQL fingerprint. The rollback-only
fixture in `scripts/board-game-seating-db-contract.test.mts` exercises four rates, six
public titles, hidden/lost copies, occupied/blocked tables, both publication flags, tenant
isolation, inactive branches/tenants and absent profiles against real PostgreSQL when configured.
It rolls back only its own fixtures and checks their exact IDs/slugs are gone. Pure tests do
not establish real database, provider, customer-chat or browser-form behavior.

### Chat reservation requests (`10.48`, 2026-10-07)

This section records the original request-only release. `10.49` adds the opt-in confirmation and
customer actions described below; its active-booking cap includes future CONFIRMED rows too.

Chat reuses `bms_board_game_waitlist`, not a second reservation system. The branch must be active,
have a saved profile, enable booking and use deposit policy `NONE`. A hidden directory branch can
qualify. The tool resolves a branch name, converts local time using the same PostgreSQL timezone
helper as PUBLIC, and applies the same advance-time, duration, party-size and request-TTL rules.
CRM contact is required. The server previews every detail and waits for a short affirmative after
that exact latest summary. Changed details, stale summaries and intervening messages never grant
consent. A CRM row lock serializes the three-pending-request cap; a tenant-unique hashed retry key
replays identical input and rejects changed input. Request and domain audit commit together.

**Review:** Admin now shows reservation cards, channel, CRM contact snapshot and a link to POS.
Admin did not previously have a PIN reservation-review form; no second review endpoint was added.
Browser and RN POS keep their existing review controls/PIN. CHAT cards tell staff to call the
customer because this phase sends no decision message. The existing table lock/capacity/live-session/
overlap checks still decide confirmation, and deposit policy is checked again at that time.
`source` is already GraphQL `String!`, so CHAT requires no SDL change. A codegen check also found
pre-existing emergency/pharmacy type drift against the unchanged committed SDL; RN types were
regenerated from that SDL and a repeat generation was byte-identical (no schema change).

#### Source decisions (all source-sensitive paths in `boardGameWaitlist.ts`)

| Path | CHAT decision | Reason |
| --- | --- | --- |
| Waitlist row type, SELECT/map, staff list | Include | Same review queue; CRM name/phone snapshot is staff-only. |
| Public request configuration, insertion, token retry | Exclude | Original PUBLIC behavior/required email and hashes remain unchanged. |
| Chat preview/write/retry/pending cap | CHAT only | Server identity, customer lock, REQUESTED without a table. |
| Customer chat status | CHAT only, tenant + customer | Never expose another customer's requests or a table number. |
| Public token read (`getPublicBoardGameReservation`) | Exclude | CHAT has no public token or email. |
| Public deposit owner lookup | Exclude | No public manage token. |
| Deposit submission token lookup and locked active row | Exclude | No deposit or money path from CHAT. |
| Public cancellation token lookup and locked row | Exclude | Chat cancellation remains staff-only. |
| Staff reschedule reminder reset (all five CASE fields) | Leave PUBLIC-only | Staff may change a confirmed CHAT row; email state remains NONE. No customer tool. |
| Staff review selector | PUBLIC + CHAT | Existing POS permission/PIN and same table advisory lock. |
| Staff rejection notification state | CHAT → NONE | No automatic decision message. |
| Staff confirmation policy | CHAT requires NONE again | A later branch deposit change must not create unpayable CHAT deposits. |
| Staff confirmation reminder and decision state | CHAT → NONE | Null email; no retry queue entry. |
| Single decision sender and retry selector | Leave PUBLIC-only | CHAT is never claimed, no attempts/error increments. |
| Due reminder tenant scan and locked row claim | Null email excluded twice | CHAT is never claimed, even if its reminder lead would be due. |
| TTL expiry / unpaid expiry / no-show | Existing source-independent rules | REQUESTED CHAT expires by TTL; no money is created. |
| Check-in, staff close/cancel, seating | Existing source-independent rules | Same arrival window/queue number/session transaction; no new clock/bill path. |

Revision triggers serialize the row generically; the existing realtime trigger in `9.99` references
only tenant/location/id/status/updated_at and emits allow-listed status hints. No new column is added
to its payload. RLS/table grants are inherited; actual trigger execution still requires DB verification.
The composite customer FK uses CASCADE for hard erasure, so test-shop/customer deletion is not blocked.
Normal CRM soft deletion does not delete a reservation.
CRM merge moves CHAT requests to the surviving customer in the existing merge transaction, preserving
status and retry hashes; moving channel identities must not make their old requests unreadable.
The merge refuses while the two identities together have more than three pending CHAT requests;
staff must resolve those requests first, never silently cancel them to fit the limit.

#### Reproducible bilingual flow

Pure dependency-injected tests use FAKE Main, 10 January 2027 18:00 Asia/Bangkok, 120 minutes, 4 people.
They exercise the real request policy and server formatters, not a live AI provider or chat channel.

| Stage | Thai | English |
| --- | --- | --- |
| Request details supplied | จอง FAKE Main วันที่ 10 ม.ค. 2027 เวลา 18:00 น. 2 ชั่วโมง 4 คน | Request FAKE Main on 10 Jan 2027 at 18:00 for 120 minutes, 4 people |
| Server summary, zero writes | กรุณาตรวจคำขอจองโต๊ะ … ยังไม่ได้ยืนยันโต๊ะ<br>1. ยืนยันส่งคำขอ<br>2. แก้ไขคำขอ | Please confirm this table request … no table is confirmed.<br>1. Submit request<br>2. Edit request |
| Customer affirmation | 1 (หรือ “ตกลงค่ะ”) | 1 (or “yes please”) |
| Server receipt, exactly one injected write | ส่งคำขอจองโต๊ะ #12345678 ให้ร้านตรวจแล้วค่ะ ตอนนี้ยังไม่ได้ยืนยันโต๊ะ … | Booking request #12345678 was sent for staff review. No table is confirmed yet. … |
| Own status | #12345678 … รอร้านตรวจ ยังไม่ได้ยืนยันโต๊ะ | #12345678 … Awaiting staff review; no table is confirmed |

Dates are rendered in branch timezone (Thai locale uses the Buddhist year). Confirmed status comes
only from a later authoritative staff-reviewed status read, never the submission message.

#### Deployment and rollback (not executed in this task)

1. Back up the target PostgreSQL database and verify that backup can be restored to an isolated test
   database. Do not rebuild BMS by blindly replaying historical migrations into an empty database.
2. Run `psql -v ON_ERROR_STOP=1 -f db/checks/schema-readiness.sql` on that restored test DB. Before
   migration only the three new `10.48` columns should be missing; resolve other gaps separately.
3. Apply `psql -1 -v ON_ERROR_STOP=1 -f db/migrations/10.48__bms_board_game_chat_reservations.sql`.
   Repeat readiness; inspect `pg_constraint` and `information_schema.columns` (DB contract checks both).
4. Configure the isolated DB for the guarded runner and run
   `node scripts/run-contract-tests.mjs db board-game-waitlist` and the existing seating DB suite.
   Confirm fixture cleanup and revision/realtime inserts. These tests write only FAKE fixtures and
   invoke the real scheduled services; the configured database must be dedicated to testing.
5. Only after authorization and successful DB proof: back up production, apply `10.48`, recheck
   readiness, deploy code, verify the real chat summary/consent/status and staff queue with test identities.

Prefer a forward fix or code rollback retaining the additive schema. Full schema rollback is allowed
only when `SELECT count(*) FROM bms_board_game_waitlist WHERE source='CHAT'` is zero. Stop chat writes,
deploy previous code, lock the waitlist during rollback, verify zero again, restore the named kind
CHECK from `10.2` and public shape/text CHECKs from `10.1`, then drop only the new customer FK/chat
CHECK/indexes/three columns. Never delete customer requests to make rollback pass. If CHAT rows exist,
retain schema and preserve a staff review path until requests are resolved; do not silently strand them.

For the original `10.48` release, out of scope: automatic decision messages, chat deposits, chat reschedule/cancel, live
provider/channel verification and authenticated browser appearance. DB apply/tests are not established
by pure tests or a production build; see the latest `CLAUDE.local.md` result for actual execution.

### Chat actions (`10.49`)

At `/admin/board-game`, branch settings now include **Automatically confirm chat bookings (no
deposit)**. It defaults off, requires booking enabled and deposit policy NONE, and is saved through
the existing branch-scoped `board_game.floor.manage` route. Migration
`10.49__bms_board_game_chat_actions.sql` must precede deployment; apply it to an isolated test
database first. Disabling this setting affects new bookings, not existing confirmed reservations.

The customer still reviews the exact server summary and confirms it. When enabled, the backend
allocates a capacity-compatible table under reservation locks and commits CONFIRMED; no table
available means no booking is created. Only that result permits “จองสำเร็จแล้ว”.

Customers can cancel their own pending/confirmed no-deposit CHAT booking before check-in. They can
reschedule a CONFIRMED booking on the same table after specifying a new local date/time. The current
duration and headcount are retained unless the customer explicitly changes them. Status replies
offer server-bound numbered booking/action choices, so the customer does not retype a reference.
Selecting cancellation still opens a separate exact confirmation summary; it does not cancel
immediately. Conflicts leave the original booking intact. Public-token or staff-created bookings
are not claimed merely by typing a reference in chat. Every change requires a new server summary,
fresh customer consent, current identity/row-version validation and an idempotent transaction.

Refund, discount, extra-time and staff-help requests are customer-confirmed Inbox notes with a
durable mention to the assigned staff member (or another eligible shop staff member). Staff review
the chat and apply an approved change through existing POS/payment screens and permissions.
The queue receipt does not mean staff have read it or approved it; no automatic money or time
mutation is performed. Missing staff recipients fail visibly instead of claiming a notification.

Verification on 2026-10-08: TypeScript passed. A schema-only isolated local database passed the
new chat-action DB suite (7/7) and existing waitlist/reservation DB suite (10/10); migration `10.49`
was applied twice successfully there. Tests cover concurrent table allocation, opt-out, changed
policy/consent, identity isolation, reschedule rollback, duplicate cancellations and durable staff
mentions without money/time writes. Redis push and email delivery were not configured in that
environment. Full pure suite: 2,437 passed, 6 skipped, 1 unrelated existing Admin alert-dismissal
failure in unchanged CustomerOrderDetail/DashboardActions components. Live-model/channel and
authenticated browser verification have not been performed. No migration was applied to the
running shop database and no existing branch was opted in.

### Deterministic reply boundaries

Customer chat can read published rates, game-library metadata and aggregate availability. It
can submit or confirm bookings according to branch policy and change its own booking through the
approved confirmed-action flow. It can queue staff requests, but cannot itself extend play time,
issue a refund or grant a discount. A successful slip submission is not payment confirmation.
The response guard must not exempt completion claims because an unrelated tool succeeded;
verified action receipts are composed by the server, not the model.

`boardGameUrgentGuard()` is a pure, shop-neutral emergency/safety boundary, called on the actual
message before profile, conversation or history reads. It follows the existing pharmacy emergency
fast path without changing that path's fixed copy. Other board-game guards remain archetype-scoped.
A missing profile fails closed; failed optional context must not erase a known store archetype.
Ordinary questions about prices, booking policy, child/observer charges, game names and merchandise
must still reach approved read tools, not a blanket refusal.

The new Thai/English safety reply is an **unreviewed draft**. Deterministic phrase matching does not
cover every possible wording and does not establish live-provider, live-chat or database behavior.
See [the detailed recheck](../ai/board-game-guards-recheck.md) for literal cases, validation results,
copy requiring human review and remaining booking-link decisions.

## Reuse Existing BMS

Reuse existing services for:

- product catalog and inventory for retail goods;
- purchase orders and receiving for supplier workflow;
- POS shifts, payments, receipts, returns/voids, and tax documents;
- customer/CRM records and membership identity;
- RBAC, audit, realtime, and reports.

New board-game services must live under `apps/web/lib/bms/` and keep API/routes thin. Every
tenant-owned table needs `tenant_id`, RLS, and `bms_app` grants.
