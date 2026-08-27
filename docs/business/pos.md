# Point of Sale (POS)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Payments: [payment.md](payment.md) · Inventory: [inventory.md](inventory.md)

The BMS POS at `/pos` is an online, general-retail checkout surface. A device token identifies the
tenant, branch, and register; a cashier user plus PIN identifies every sale, shift action, return,
and refund settlement. The browser never supplies authoritative tenant, price, pack conversion, or
stock values.

### Why the counter talks REST, not GraphQL

Every counter action is a REST route under `/api/pos/*`, unlike the rest of BMS. That is forced by
the authentication model rather than chosen for style: a register authenticates with
`x-pos-device-token` and a cashier PIN, not an admin session cookie, so it has no GraphQL context to
run `requirePermission()` against. The equivalent checks live in the routes —
`authenticatePosDevice()`, `verifyCashierPin()`, and `cashierHasPermission()` — and the second-person
PIN requirement for discounts, voids, and cash-out sits there too.

The cost is that counter actions are absent from the GraphQL schema and therefore from the AI tool
catalogue today. GraphQL is not a prerequisite for an AI tool: a future staff tool must wrap the
underlying service in `lib/bms/tools/catalog.ts`, preserve device/person authorization semantics,
re-check RBAC, and remain propose-only where money or stock moves. It must not call a REST route from
a resolver or tool as a shortcut.

Auditing does not depend on the transport. `pos.sale`, `pos.return`, `pos.refund.complete`,
`pos.void`, `pos.cash.movement`, `pos.shift.open`, and `pos.shift.close` are all written to
`bms_audit_log` inside the same transaction as the money and stock they describe, so a committed
movement can never lack its audit row. Both ends of a shift are recorded — the float accepted at
open, and the expected/counted/variance figures at close — because a drawer that is only audited
when it closes cannot be reconciled against what was put in it.

A void is stamped in that same transaction too. `voidPosSale()` reverses the sale through
`processPosReturn()`, and the `voided_at` stamp, the tax-document cancellation, and the `pos.void`
row all happen inside that reversal's transaction under its `isVoid` flag rather than in a second
one afterwards. An earlier arrangement did use a second transaction, and a crash in the gap left a
bill fully refunded but not stamped, which the retry path then rejected with `ALREADY_RETURNED` —
recoverable only by hand. The `pos.return` entry additionally carries an `isVoid` flag, because a
void travels through the return machinery and reports counting genuine returns must not also count
bills rung up by mistake.

## Supported counter workflow

1. An administrator creates an active location and POS device at `/admin/pos-devices`, issues its
   one-time token, and pairs the browser.
2. Staff PINs and RBAC are configured. Selling, opening/closing a shift, returning goods, and
   confirming a non-cash refund each have independent server-side permission checks.
3. The cashier opens a shift with the drawer float, scans a barcode/SKU or searches the live catalog,
   and can sell base units or configured packs.
4. If the basket contains a pharmacy-controlled SKU that requires a pharmacist check, the cashier can
   send the case straight from POS into the pharmacy queue. That creates or reuses a product-review
   assessment, links it to a parked-bill snapshot, and clears the counter so the next customer is
   not blocked. The parked bill can be resumed only after the assessment becomes `APPROVED`.
5. One bill can be split across cash, QR, card, bank transfer, or wallet. The method is picked from
   a row of buttons under the amount; cash opens the quick-tender pad, the other methods take a
   reference number and keep their amount locked to the bill total. "Split payment" switches to the
   multi-row form. The payment rows must add up to the server-computed order amount; cash
   tender/change is recorded per cash row.
6. Successful settlement changes the order to `COMPLETED`, consumes reserved/current stock, assigns
   lots FEFO where lots are tracked, records movements, and issues an abbreviated tax document when
   the tenant is VAT-registered. These steps commit atomically.
7. Recent sales can be searched by order UUID, receipt/tax document number, product barcode, SKU,
   member details, or phone number, previewed by line, and reprinted. When a query is present the
   list can widen across the tenant's POS history, but bills sold on another device stay view/print
   only on this screen; receipt-based return and exchange controls open only for bills from the
   current register. Each bill in that list is one compact row; return, refund, and exchange
   controls open on demand for one bill at a time, and the reason code plus detail are shared by
   the partial and full return actions. An exchange loads the remaining original items into a new
   cart; it is a new sale, not a mutation of the old receipt.
8. Returns may be full or partial. A reason code plus detail is mandatory, returned quantities are
   cumulative and cannot exceed the sold quantity, net refund uses the original order-level discount,
   and stock/lot provenance is restored atomically.
9. Cash refunds complete immediately. Card/QR/bank/wallet refunds remain `PENDING` until a user with
   `payment.refund` records the external refund reference. A shift cannot close while any refund
   allocation from that shift is pending.
10. Closing a shift calculates expected cash from opening float + cash collected - completed cash
   refunds, then records counted cash and variance.

### Pharmacy review from POS

Counter pharmacy review deliberately reuses the same gate as every other channel: `checkPharmacySaleInTx()`
still decides whether a basket is sellable, needs a pharmacist review, needs a short safety check,
or is forbidden outright. POS does not gain a bypass.

What POS adds is the operational handoff:

- The cashier can turn a `PHARMACY_REVIEW_REQUIRED` or `PHARMACY_SAFETY_CHECK_REQUIRED` failure into a
  pharmacy assessment without leaving the counter screen.
- The parked-bill snapshot now carries customer/coupon/points/extra-line context plus the linked
  assessment id/case code in `bms_pos_parked_sales.cart`, so resuming the bill restores the same
  commercial context without trusting the browser as authority for the eventual sale.
- Resume is blocked until the linked assessment is approved. An unapproved case stays visible in the
  parked list instead of being deleted and lost.
- The eventual sale still goes through `createOrder()` with
  `pharmacyApprovedAssessmentId`, so approval is re-checked inside the server transaction that takes
  money and stock.

## Per-size sale prices

The product price is the fallback price. A sized BASE pack may override it for one inventory size;
leaving that override empty restores the fallback without deleting inventory or pack history. POS,
order creation, stock/AI results, and the public shop all resolve price in the same order: sized BASE
price, shared BASE price, then product price. A fixed wholesale tier can target one size, so M and XL
may have the same minimum quantity but different unit prices; a legacy/shared fixed tier with no size
continues to apply one price to every size. Both qualify from the quantity of that SKU + size only.
If a size-specific and shared rule have the same minimum, the size-specific rule wins. Cross-size
percentage tiers qualify from the SKU's quantity across every size, then discount each size from its
own base price so two sizes with different prices never collapse to one unit price. Promotions remain
per SKU + size.

## Membership, tier discounts, and loyalty points

Added by migration `7.96`. Before it, POS sales were always anonymous — `createOrder` received
`channel='pos'` with no `customerRef`, so `bms_orders.customer_id` was `NULL` on every counter bill.
A side effect was that coupon `per_customer_limit` never applied at the counter. Attaching a
customer fixes that too.

Four independent discount layers can stack on one bill, applied in a fixed order:

| Layer | Source | Reversible |
| --- | --- | --- |
| 1. Tier discount | `bms_membership_tiers` via `bms_customers.tier_id`, auto-applied | yes |
| 2. Coupon | existing `bms_coupons` (unchanged) | hard — redemption count already incremented |
| 3. Points redemption | `bms_loyalty_ledger`, at the shop's configured rate | yes |
| 4. Manual discount | keyed at the counter, needs supervisor approval (below) | yes — trimmed first when the cap binds |

### Manual discount approval

`composeDiscounts()` has carried a `manualDiscount` layer since `7.96`, but nothing reached it —
`/api/pos/sale` hardcoded `discountApprovedBy`/`discountReason` to `null` because there was no
server-side approval flow to trust. There is one now.

The counter sends `manualDiscount`, `discountReason`, `discountApproverUserId`, and
`discountApproverPin`. The route verifies that PIN against the database with `verifyCashierPin` and
requires `pos.discount.approve` (already seeded to Manager by `7.87` — no new permission, no
migration). Only then does it pass an amount to `createOrder`. The approver's PIN is a **separate
entry from the selling cashier's PIN** even when the same person holds both, so a cashier who
happens to carry the permission still has to make a deliberate second action that lands in the audit
trail. The PIN is memory-only on the browser and is stripped from the pending-sale recovery record;
a bill recovered after a reload has to be re-approved rather than silently replaying an approval.

`createOrder` rejects the bill outright (`DISCOUNT_UNAPPROVED`) in two cases: an amount with no
approver/reason attached, and an amount that the per-bill cap would trim. The second one matters —
`composeDiscounts` trims the manual layer *first* because it is the most reversible, so a silent
trim would charge the customer more than the counter quoted. Failing loudly and making staff re-key
is the correct outcome.

Approval is per-bill, never per-shift: `clearBillCustomerState()` drops it after every sale.

`composeDiscounts()` in [loyaltyMath.ts](../../apps/web/lib/bms/loyaltyMath.ts) is the single place
that combines them, enforces the per-bill cap (`bms_loyalty_settings.max_discount_pct`), and trims
layers from the most-reversible end when the cap binds. It is a pure function so the counter preview
(`POST /api/pos/member/preview`) and the committing path (`createOrder`) cannot disagree — if they
did, the payment rows would not match the server total and the bill would be voided as
`PAYMENT_MISMATCH`. That module imports nothing so it can be exercised directly by
Point redemption always rounds down to a whole configured redemption unit. For example, at
100 points per unit a 3,045-point balance can redeem 3,000 points and leaves 45 in both the grant
ledger and the cached balance. The POS "all" action displays and submits the 3,000 points actually
used rather than presenting the full 3,045 as if the remainder would be lost.

`scripts/loyalty-contract.test.mts` (17 tests, no database):

```bash
node --experimental-strip-types --test scripts/loyalty-contract.test.mts
```

The transaction behaviour — FIFO consume, the unique indexes behind POS replay, the revision-trigger
skip, and what points do on cancel/return/merge/delete — needs a real database, and is covered by
`scripts/loyalty-db-contract.test.mts` (23 tests). It writes to whatever database it is pointed at,
so run it against dev only; see CLAUDE.local.md for the exact command.

**The total of all layers still lands in `bms_orders.discount_amount`.** VAT base and the
abbreviated tax invoice read that column (`computeVat({ discountAmount })`), so a member discount
must never be deducted at cash-collection time. `bms_order_discounts` only records *where* that
total came from, one row per source, and its rows always sum to `discount_amount`.

### Points rules as implemented

- **Earning** happens inside the same transaction that marks the bill `PAID`, on every channel — see
  "Where points are earned" below. Base is the amount after all discounts by default (`earn_base`),
  so discounts cannot inflate points. Only customers with a `member_no` earn — a bare CRM record
  does not.
- **Idempotency**: `UNIQUE (tenant_id, order_id, kind)` for `EARN`/`REDEEM`. A register replaying the
  same `idempotencyKey` gets the original bill and no second grant.
- **A redemption that cannot be honoured in full is rejected, not trimmed.** Asking to redeem more
  points than the member holds (or more than the bill can absorb) fails the order with
  `POINTS_INVALID`. Quietly redeeming a smaller number would hand the customer a smaller discount
  than the amount they were quoted and tendered against. The POS screen sends the already-clamped
  figure from its preview, so it only meets this when the balance changed between preview and
  payment — at which point the cashier does need to re-quote.
- **Redeeming** deducts points when the order is created, not at a separate "reserved" state.
  `cancelOrder` calls `releasePointsForOrdersInTx` to return them, so an abandoned `PENDING` bill
  never holds points hostage.
- **Returns** call `reversePointsForReturnInTx` with `ratio = this refund ÷ original net total`. It
  claws back earned points and gives back redeemed points proportionally. Without this, buy → earn →
  return is a free points generator. Cumulative ratios cannot exceed 1 because `processPosReturn`
  already refuses to refund more than was paid.
- **Balances can go negative** when a customer returns goods after spending the points. This is
  deliberate; clamping to zero would make return-after-redeem profitable. The next grant covers the
  deficit first (`consumedToCoverDeficit`).
- **Expiry** is FIFO over grant rows via `consumed_points`, driven by
  `POST /api/bms/loyalty/maintenance`. `.github/workflows/bms-cron.yml` calls it daily, but only once
  `BMS_APP_BASE_URL` and `BMS_CRON_SECRET` are set as Actions secrets — without them every job in
  that workflow skips itself, and points do not expire until someone presses the button on
  `/admin/loyalty`. Check `/admin/operations-schedule` to see whether it has actually run.
- **`bms_customers.points_balance` is a cache** of `SUM(points)`. `bmsLoyaltyOutstanding` reports
  `balanceMismatchCount`, which must always be 0; `/admin/loyalty` shows a red banner if it isn't.

### Accounting

Outstanding usable points are a liability (deferred revenue under IFRS 15), reported by
`bmsLoyaltyOutstanding` as both a point count and a baht value at the current redemption rate. Give
the accountant this figure at period end; it is not an optional dashboard number.

### Where points are earned

Earning is hooked to every path that moves an order to `PAID` — `payOrder()`, `confirmPayment()`, the
split-payment confirm, and `finalizePosSale()` — not just the counter, so a customer who orders over
LINE and transfers the money earns the same as one who walks in. Redemption and tier discount already
worked everywhere because they live in `createOrder()`.

Returns differ by path: POS uses `processPosReturn`, which reverses proportionally because partial
returns exist; the non-POS `returnOrder()` is a full return, so it reverses the whole thing.
`cancelOrder()` releases points the same way.

### What is deliberately not built

- **No automatic messaging to customers.** Nothing tells a customer their points are about to expire or that they
  moved up a tier. `/admin/loyalty` lists members with points expiring in 30 days so the shop can
  contact them; that list is the whole mechanism.
- **No loyalty report export.** The report engine's types are `SALES`, `INVENTORY`, `PROFIT`. Loyalty
  numbers are on-screen queries (`bmsLoyaltyOutstanding`, `bmsLoyaltyActivity`, `bmsSalesByTier`),
  not XLSX/CSV/PDF.
- **Points cannot be redeemed for goods**, only for a bill discount. Redeeming for a product would
  have to move stock, which is a different feature.
- **AI can read a balance (`get_loyalty_points`) but never redeems.** Redemption only happens when a
  bill is created.

### Permissions

`member.view`, `member.manage`, `loyalty.adjust`, `loyalty.settings` — seeded to
Manager/Sales/Cashier by `7.96` (Administrator is super). `loyalty.adjust` is deliberately separate:
a manual adjustment creates value for the customer directly, so it demands a mandatory reason and
writes to `bms_audit_log`.

## Deposits / layaway (9.0)

The POS requires payment rows to equal the bill exactly or the bill is voided as `PAYMENT_MISMATCH`.
That rule is correct for a sale finishing at the counter and **is not relaxed here** — it is what stops
money collected from diverging from what the system computed.

A deposit is a different kind of bill instead. Goods are reserved but not deducted, the order stays
`PENDING`, and when the customer returns and pays the balance the bill walks the **ordinary completion
path**: stock, FEFO lots, tax document, points, audit. That reuse is the design; a second settlement
path would be a second thing that has to be equally correct and gets tested half as much.

Consequences that fall out of it, all intended:

- **The tax invoice is issued at collection, not when the deposit is taken** — which is where title
  actually passes.
- **The sale belongs to the collecting shift.** Settlement re-stamps the order's device, shift and
  cashier, so takings and commission land with whoever handed the goods over, not whoever took the
  deposit days earlier. The re-stamp, balance payment, stock/lot deduction, tax document, loyalty
  ledger and deposit `COMPLETED` transition commit in one transaction.
- **Collection stays at the branch that reserved the goods.** The counter list is location-scoped
  and settlement re-checks the location while holding the deposit lock. Moving collection to a
  different branch requires the stock-transfer workflow first.
- A deposit equal to the bill is refused: that is a completed sale and must go the normal way, or it
  sits in the deposit list fully paid with nobody closing it. The same rule applies when a later
  instalment equals the remaining balance: use `settle`, not `add`.
- Paying the wrong balance is refused rather than accepted, the same reasoning as `PAYMENT_MISMATCH`.
- Taking and adding deposit payments require a stable client idempotency key. Retrying after a lost
  response returns the existing result and never inserts the same payment twice.
- If the reserved order contains serial-tracked goods, the collecting cashier scans the physical
  items and their serials into the cart before settlement. The server derives the required count
  from the reserved order, and serial writes commit with payment, stock, tax and deposit completion.

Two guards inside `finalizePosSale` needed adjusting rather than bypassing. It rejects a pending bill
that already has payment rows — a sensible defence against collecting twice — and a deposit bill has
them by design. It now takes an expected already-paid amount, turning "there must be none" into "there
must be exactly this much", which still catches an unplanned payment. And it compares the bill total
against the amount being settled, so settlement passes the **full** total (the deposit is already a
payment row) rather than the balance.

**Closing a deposit does not move money by itself.** Whether an unclaimed deposit is refunded or
forfeited is an agreement between shop and customer — some forfeit after a deadline, some refund in
full. The system records the decision with a mandatory reason and leaves the payout to the ordinary
refund path. Deciding for the shop would be deciding about somebody else's money.
Closing does cancel the pending order and release its reserved stock in the same transaction as the
deposit status change; otherwise goods can remain unavailable after the `OPEN` row disappears.

Open deposits carry a due date and are listed with an `overdue` flag, because **reserved goods are
goods nobody else can buy.** Without that visibility a shop accumulates stock that exists but cannot be
sold, and nobody notices.

For a walk-in customer, the deposit screen can create the order directly from the current POS cart.
The request goes through the same server-side catalog, cross-variant wholesale, promotion, member,
coupon, points and approved-manual-discount rules as a full POS sale. It creates a `PENDING` order,
reserves stock, and records the first deposit; serial numbers are intentionally deferred until the
goods are collected. The cart-deposit request has its own persisted idempotency key, so a browser or
network retry recovers the same order and payment.

For an order already created by Inbox / Customer 360, the screen lists eligible branch-local
`PENDING` orders (no existing deposit and no active payment) and sends the selected internal
`bms_orders.id` UUID. The cashier never types that UUID. A barcode or product code is rejected at the
route boundary before it reaches a UUID column in PostgreSQL.

## Gift cards and store credit (8.9)

Migration `9.4` is the idempotent repair path for long-lived deployments that skipped `8.9`–`9.2`.
It restores both store-credit tables, the deposit table, payment idempotency, RLS/grants, indexes and
role permissions in one transaction, then checks every application-facing column before committing.
This is intentionally a schema repair rather than a runtime fallback: checkout must never continue
with only part of its payment ledger available.

Closes two gaps at once: gift cards could not be sold at all, and a return could only go back as cash
or to the original payment method — never as store credit, which is what shops prefer because the money
stays in the shop.

Same ledger shape as loyalty points: the balance is `SUM` of the ledger and the column is a cache. A
column updated without a ledger entry drifts silently the moment some write path forgets it, and
nothing then reveals when the drift started. `balanceMismatchCount` must always be 0.

**One deliberate difference from points: credit cannot go negative.** Points are allowed to, because
clamping would make return-after-redeem profitable. Credit is money, and a negative balance is the shop
owing a customer with nobody having approved it — enforced by a `CHECK` on the table, not only in code.

Redemption happens **inside the sale transaction**, with `FOR UPDATE` on the card row: one card can be
scanned at two registers at once (someone buys a card as a gift and both people use it), and without
the lock both would read the old balance and overspend. Validation happens *before* `createOrder`, so a
bad code or a short balance costs no stock, no points, no coupon.

`STORE_CREDIT` is a payment method but **not cash** — the shop took the money when the card was sold,
so it must never reach the drawer total or the expected-cash formula at close.

Returns put the credit back on the **same card**, proportionally to what was refunded. The POS return
path does not go through `cancelOrder`, so it needed its own hook; without it a customer who paid by
card and returned goods simply lost the money.

That proportional reversal forced the uniqueness design apart. A single
`UNIQUE (tenant_id, credit_id, order_id, kind)` looks right and is wrong: partial returns happen several
times per bill and each one must reverse its own share, but that constraint allows only the first — the
second is silently swallowed and the customer loses the balance. It is now three partial unique
indexes: redemption keyed by order, cancel-reversal keyed by order, return-reversal keyed by
`pos_return_id`.

Card codes come from `crypto.getRandomValues`, not a sequence. A gift card is money that whoever holds
it can spend, so sequential codes (`GC-0001`, `GC-0002`) mean anyone who buys one can guess the rest.
Visually ambiguous characters (`I`, `O`, `0`, `1`) are excluded so a code can be read over the phone.

Outstanding credit is a **liability** (deferred revenue) exactly like outstanding points. Give the
accountant `getStoreCreditOutstanding()` at period end.

`storecredit.issue` and `storecredit.adjust` are Manager-only because issuing a card creates money in
the system; `storecredit.redeem` goes to everyone who sells, since taking a gift card is ordinary work.

## Promotions: buy-X-get-Y and N-for-a-price (8.7)

Coupons need a code the customer knows. Wholesale steps change the per-unit price. Neither answers
*"buy 3 get 1 free"* or *"3 for ฿100"*, which are the offers Thai retail runs most.

**A promotion is not a fifth discount layer.** There are already four (tier → coupon → points →
manual) under one per-bill cap (`max_discount_pct`), and putting promotions there breaks two things at
once. A promotion the shop advertised on a shelf could get **trimmed** because that bill happened to
hit the cap — the shop breaking its word to a customer because of its own internal rule, which is
unexplainable at the counter. And the receipt would show full prices with a large discount at the
bottom, when the customer's understanding is that "3 for ฿100" *is* the price of those three.

So it is a line-pricing mechanism like `8.1`: computed from the SKU's total quantity on the bill, and
never subject to the discount cap.

Both forms leave a remainder at full price rather than averaging across every unit, because the
customer can count what they got free. Buy 3 get 1 with 7 units means one complete group and 3 at full
price — 6 units paid.

**Quantity spans sizes and the offer is charged once per SKU per bill.** Two 60ml plus two 150ml is
four of that product, so it earns the offer; charging per line would either miss it (two lines of two,
neither complete) or bill it twice. There is a test for both wrong answers.

**A promotion that costs more than buying loose is not applied.** A shop that cuts the normal price
below its own bundle price — or leaves a stale promotion running — would otherwise have the system
overcharge customers in the name of an offer, which is damage the shop cannot explain. The lower total
always wins.

Only one promotion can be active per product (a partial unique index enforces it). Two would require
answering which one wins, and there is no answer staff can give a customer. Date windows mean an
expired offer stops applying on its own, without anyone remembering to edit the product — a stale
promotion is how a shop keeps selling at a loss without noticing.

Named packs are excluded, same as wholesale steps: the pack row already states what the box costs.
Their underlying pieces do not enter the promotion quantity and are not charged again as loose units.

**Not covered:** cross-product offers ("buy A, get B free"). Those cannot be expressed as one SKU's
group price and need their own mechanism.

## Charges that are not stock (8.6)

Bag fees, service fees, gift wrapping: collecting money for something that is not in `bms_products`
previously meant inventing a fake SKU, which puts phantom goods in the warehouse and corrupts stock
reporting.

`bms_order_extra_lines` is a separate table rather than a relaxation of `bms_order_items`, because
product rows still require a real product, stock row, and one row per selling unit:

```
UNIQUE (order_id, product_sku, size, normalized pack)  → one row per real selling unit
FK (tenant_id, product_sku) → bms_products              → needs a real SKU first
FK (tenant_id, location_id, product_sku, size)
                            → bms_inventory             → needs a stock row first
```

Loosening that product-line model would make the table **every channel shares** — POS, online, LINE, TikTok,
Lazada/Shopee — weaker in order to carry rows that are not goods. A bag fee genuinely is not an
inventory line; it is a service charge attached to a bill, so a separate table matches the meaning and
leaves the working paths untouched.

**Charges are inside the VAT base.** A service fee charged by a VAT-registered business is taxable, so
the tax document's line loader unions them in. Adding the amount to the total *after* VAT is computed
would make every invoice report a base smaller than the money taken — under-declaring by the sum of
every service fee the shop ever charged.

They are **not discountable**. Tier discounts, coupons, redeemed points, and manual discounts use the
product subtotal; charges are added afterwards. They remain inside the VAT base at their full amount,
so the tax calculation marks extra lines as non-discountable instead of proportionally spreading the
order discount onto them.

Rows that are incomplete — no label, no amount — are dropped rather than failing the bill, because the
counter adds a row before typing in it. `pos.sell` is enough: charging ฿3 for a bag is routine work,
the money lands in the drawer that gets counted at close, and the label prints on the receipt, so the
customer sees every line charged. That visibility is a tighter control than a permission gate.

The same drop-not-fail rule now covers quantity: a row must have a positive whole-number quantity or
it is dropped. It used to clamp anything else (`0`, a negative number, `1.5`) up to `1`, which silently
undercharged a "3 bags" row typed as a decimal, or overcharged a `0`-quantity row a customer changed
their mind about, rather than telling the cashier the row didn't make it onto the bill.

## Wholesale steps (8.1)

The system had two pricing mechanisms and neither answered *"buy ten, get the wholesale price"*.
`bms_product_packs` (`7.86`) prices a **container** — a box of ten strips at ฿230 — which is about
packaging, not quantity; a customer buying ten loose strips got nothing. Membership tiers (`7.96`)
take a percentage off the **whole bill** and are not tied to any product.

`bms_product_price_tiers` fills the gap: a per-unit price that changes with how many are bought.
The step with the highest `min_qty` not exceeding the quantity wins, and it applies to every unit,
not only the ones past the threshold.

Two decisions worth stating:

Each step chooses one explicit scope. **Fixed price by size** combines repeated lines of the same
SKU + size and applies either that size's configured unit price or the shared all-size fallback. This
supports, for example, five M units at ฿80 each and five XL units at ฿120 each under separate rules
with the same minimum. **Combine sizes: percentage** sums every size of the SKU to qualify, then
applies the configured percentage to each variant's own base price. For
example S ฿10 × 4, M ฿12 × 3, and L ฿15 × 3 qualify together at ten units; 20% off produces ฿8,
฿9.60, and ฿12 respectively, for ฿96.80 total. The form also permits an explicit "all sizes" fixed
price for shops that intentionally want one wholesale price across variants; it is never inferred
from a size-specific row.

**A line sold as a pack keeps the pack's price.** The pack row is the shop stating outright what the
box costs; letting two mechanisms compete for the same line produces a bill nobody can explain. The
pack's units still count toward the same SKU + size threshold, but the pack line itself keeps its
configured pack price.

Steps are not required to get cheaper as they climb, and nothing corrects them if they do not. A shop
charging more for a full case because it needs special packing means it. The function's job is to do
what was configured, predictably — not to infer intent and quietly pick the lowest price.

`unitPriceForQty()` in [pricing.ts](../../apps/web/lib/bms/pricing.ts) is a pure function for the same
reason `composeDiscounts()` is: the counter screen previews the price and `createOrder` commits it,
and if the two disagree by one satang the register's payment rows no longer match the server total and
the bill is thrown out as `PAYMENT_MISMATCH` in front of a customer. `resolvePosScan()` therefore
returns the steps with the scan result, and both sides call the same function. The screen previews;
the server still decides.

Staff quotations use this same quantity calculation. A wholesale inquiry that qualifies across
sizes therefore shows the same per-size unit prices that a later order will use; the quotation is
still ephemeral, reserves no stock, and can change if the catalogue is edited before ordering.

The cart refreshes each existing line's server-owned price, wholesale steps, pack metadata, and
promotion immediately before a new payment attempt. If an administrator changed any of them after
the product entered the cart, payment stops before writing an order, the latest total replaces the
stale preview, and the cashier must review and receive payment again. Wholesale steps and promotions
are SKU-wide, so scanning any size replaces that pricing snapshot for every size of the same SKU
already in the cart; this prevents one size using an older policy than another. Re-scanning an
existing line also replaces its cached pricing metadata instead of only incrementing its quantity.
Member, coupon, and points previews are tied to the exact subtotal that produced them, so an older
asynchronous preview cannot authorize payment after the cart total changes.

A recovered attempt must first replay its original body and idempotency key because the previous
response may have been lost after a successful commit. If that replay returns `PAYMENT_MISMATCH`,
the server has cancelled the rejected order, so the POS then refreshes the whole cart automatically,
clears the stale payment and discount preview, and asks the cashier to verify the new amount once.

Steps are edited on the product form and saved with the product. Neither the price nor the percentage
box forces a decimal shape on what the shop types: a 3% step reads as `3`, not `3.0000`. The stored
scale is still fixed — `unit_price` at two decimals, `discount_pct` at four — and `upsertProduct()`
rounds to those before writing, so the display change cannot widen what a shop can actually store.
A fixed-price row explicitly selects
one existing size or "all sizes (same price)"; cross-size percentage rows intentionally have no size.
Sending the field replaces the whole
set, omitting it leaves the existing steps alone — the same rule as `vat_category`, and for the same
reason: a bulk import that does not know about the field must not wipe a shop's wholesale pricing.

## Parking a bill

A customer forgets something or cannot find their card while a queue builds. `bms_pos_parked_sales`
(`7.97`) stores that cart against the open shift so the register can serve the next person.

Parked carts **do not reserve stock**, and they do not lock in prices. Both are deliberate: a
reservation held by a customer who never comes back stays held until somebody clears it by hand,
which in practice means never; and a cart parked in the morning would otherwise sell at the morning's
price after an afternoon price change. Resuming re-reads the catalogue, so a sold-out item fails at
`createOrder` with `INSUFFICIENT` the same as any other bill.

Resume is a single `DELETE ... RETURNING`, not a read followed by a delete, because two registers
sharing one shift would otherwise both pull the same cart and sell it twice. Parked carts die with
the shift (`ON DELETE CASCADE`) rather than surviving into the next day. Twenty per shift is the cap.

## Cash in and out of the drawer

Money moves in and out of a till without a sale: a mid-shift bank drop, change borrowed from the
next register, petty cash for ice. Before `7.97` none of it could be recorded, so every one of those
shifts closed short with nowhere to explain why — and a real shortage looked exactly like a bank drop.

A completed cash sale is already included in expected drawer cash from its confirmed payment. Staff
must not enter that money again as drawer cash-in: doing so describes a second, external inflow and
therefore doubles the expected cash. Standalone cash-in is only for money entering from outside the
sale flow, such as owner-funded change or a transfer from another register. The counter requires an
explicit acknowledgement of that distinction before recording a standalone cash-in.

`bms_pos_cash_movements` records each one with a mandatory reason. Expected cash at close is now

```
opening float + cash taken in − cash refunds paid out + drawer cash in − drawer cash out
```

Each standalone drawer cash-in/cash-out request also carries a stable client idempotency key (`9.5`).
If the database commits but the response is lost, retrying returns the original movement instead of
subtracting or adding the same cash twice.

Cash **out** needs a second person: the staff member enters their own PIN, and an approver with
`pos.cash.movement` enters theirs. Cash **in** does not — adding money to a drawer is not the fraud
path, and requiring a supervisor to walk over every time someone fetches coins is how you end up with
nobody recording anything and the close-of-shift numbers broken again.

A movement that would drive expected cash below zero is refused (`WOULD_OVERDRAW`). The system does
not know how much cash is physically present, but it does know that an amount larger than everything
the drawer could hold is a typo — ฿99,999 keyed for ฿999 — and letting it through poisons the
arithmetic for the rest of the shift.

## Petty-cash expenses

Migration `9.7` separates a real shop expense from a generic drawer movement. Paying an ice supplier
or buying sugar is an expense; dropping cash at the bank or moving change to another register is not.
Drawer-funded expenses move physical cash through `bms_pos_cash_movements`, while a personal-funded
expense does not; both create a `bms_pos_expenses` business document and reach the expense total in
the shift report.

The counter supports four flows:

- **Direct** — pay the supplier now. The expense is settled immediately for the amount removed from
  the drawer.
- **Advance** — take cash to buy something, then return and enter the actual cost. If the actual cost
  is lower, the difference creates a drawer `IN`; if it is higher, the difference creates another
  drawer `OUT`. The expense total is the actual cost, never the amount originally advanced.
- **Sole owner / personal funds (`9.8`)** — an Administrator with `pos.expense.personal` can record a
  direct expense paid from their own money. A receipt or evidence reference is mandatory. This flow
  creates the expense and audit row but deliberately creates no drawer movement, so it needs no
  second PIN and does not change expected cash. It is not a way to self-approve cash taken from the
  drawer; direct/advance drawer spending still follows dual control.
- **Branch petty-cash wallet (`9.9`)** — an Administrator with `pos.petty_cash.manage` funds a
  per-branch wallet from owner cash or a business account and records a mandatory evidence reference.
  A cashier with `pos.expense.create` can then pay a direct expense from the available wallet balance
  with evidence, without a second PIN. Funding and spending are an append-only ledger outside the
  register drawer: neither changes expected cash, and a spend that would make the wallet negative is
  refused. This gives a one-person shop a reusable shop-funded float without pretending the same
  person approved cash out of the till.

Create and settle requests are retry-safe and write the expense row, any drawer movement(s), and
audit rows in one tenant transaction. The acting cashier needs `pos.expense.create`; drawer-funded
create/settle actions additionally need a distinct second person with `pos.cash.movement`. A
personal-funded expense instead needs the actor's `pos.expense.personal`. An open advance blocks
shift close, because closing a drawer while the actual cost and change are still unknown would make
the expense report permanently ambiguous.

The original shift id travels with create/settle retries; after current authentication, permission,
and PIN checks, the service resolves an already-committed idempotency key before requiring the shift
or branch to remain open. This handles the narrow but important case where the commit succeeds, the
response is lost, and the shift closes before the register retries. Reusing the key with changed input
is still a conflict, and tenant-wide advisory locking prevents two branches racing the same key into a
database error.

The shift report includes personal- and petty-cash-funded expenses in the shop expense total and also
shows their count/amount separately so a manager knows which costs did not leave that shift's drawer.
The feature records the expense, not a reimbursement payable; returning the owner's money remains a
separate drawer-out action with a distinct approver.

Categories are intentionally operational rather than an accounting chart of accounts:
ingredients, packaging, delivery, transport, cleaning, repairs, utilities, and other. `receipt_ref`
is optional for drawer-funded expenses and mandatory for personal- or petty-cash-funded expenses; it stores a
receipt/invoice or evidence reference, and file upload is not implied by that field.

## Voiding a bill

A void and a return end in the same place — goods back in stock, money back to the customer, points
clawed back — but they mean different things, and `7.97` keeps them apart.

A return is a completed sale the customer changed their mind about; it belongs in the returns report.
A void is a bill that should never have existed: a double scan, the wrong customer, a change of mind
before anyone left the counter. Forcing voids down the returns path meant a cashier who fumbles twice
a day tripped the "unusual return frequency" alert on `/admin/reports` (fed by
`/api/bms/reports/pos-return-audit`) every week, until nobody believed that alert any more.

`voidPosSale()` reuses the return machinery wholesale — stock, lots, points, refund settlement — and
then flags the row `bms_pos_returns.is_void`. All five return-report queries filter it out. Writing a
second reversal path for voids would mean a second path that has to be equally correct and is tested
half as much.

The scope is deliberately narrow, so that void is this minute's eraser and not a back door for
deleting old sales:

- only bills in a shift that is still open — once the cash has been counted and handed over, the
  correction is a return
- only bills with no prior return against them
- two people: the cashier's PIN plus an approver holding `pos.void`
- a mandatory reason, stored on `bms_orders.void_reason`

The tax document is **cancelled, not deleted** (`cancelled_at`). A number missing from the sequence is
the first thing an auditor asks about, and there is no good answer.

Voided bills leave `salesTotal` and `billCount` and appear on their own line of the shift report.
They already leave revenue reporting for free, because a full return moves the order to `RETURNED`
and revenue counts only `PAID`/`PACKING`/`SHIPPED`/`COMPLETED`.

## Customer display and receipt delivery (8.6)

### The customer-facing screen

`/pos/display` is a read-only page for a second monitor turned toward the customer: the lines as they
are scanned, the running total, the discount, and after payment the change due in the largest type on
the screen. It has no buttons and talks to no API, because customers reach out and touch it.

It syncs over **`BroadcastChannel`, not a WebSocket**. The second screen is another window of the same
browser on the same machine, hanging off the HDMI port, so messages never leave the device. That
matters for one specific failure: if the shop's internet drops, a WebSocket-driven display freezes
showing a stale total — the worst possible moment for the customer-facing number to be wrong. Nothing
needs configuring; if no display window is open, the broadcast simply has no listener.

Only the last eight lines are shown. A customer is watching what was just scanned, and auto-scrolling
a screen nobody can touch reads worse than truncating.

### Sending a receipt

Receipts previously left the shop on paper only, despite the mailer and LINE integration already
existing. `sendReceipt()` composes a copy and sends it by email or LINE.

**The figures come from the issued tax document, never from a fresh calculation.** The abbreviated
invoice stores its own base, VAT and exempt amounts (`7.88`); recomputing `total × 7/107` breaks the
moment a bill mixes VAT-exempt goods, and the customer would then hold evidence contradicting what the
shop filed. No document, no VAT block.

**A failed send never damages the sale.** The sale completed when the money was taken; a bounced email
is a failed copy, so the caller gets a result to display rather than an exception.

An address typed at the counter beats whatever is on the customer record — staff ask for an email out
loud all the time, and the bill may have no customer attached at all. That address is **not** written
back to the customer profile: typing an email to get one receipt is not consent to be stored.

LINE identities live in `bms_customer_identities` (`7.74`), not on `bms_customers`. Reading the wrong
table would tell customers who *have* linked LINE that they have not, so there is a test pinning it.

## Sales commission (8.5)

The system already knew who sold each bill (`bms_orders.cashier_user_id` since `7.87`); what was
missing was a rate, so shops paying commission calculated it entirely outside the system.

`bms_commission_rules` stores rates **with an effective date**, and the report picks the rule in force
on the date of each bill. This is the whole design, and it exists to avoid one specific failure: with a
single current rate, the day a shop moves 2% to 3% every already-paid month silently restates. Staff
open the report, see figures that do not match the payslips they were given, and nobody can explain or
audit it. Changing a rate here means adding a row, not overwriting one, so history stays fixed without
storing commission amounts on order rows.

Specificity resolves product → category → default, each within the dates in force.

Two correctness rules the report enforces:

**Returned goods take their commission back.** Without that, "sell it, have the customer return it
tomorrow" farms commission — and it is among the hardest frauds to notice, because every individual
step looks correct. Voided bills earn nothing at all.

**Bill-level discounts are spread across lines.** Commission is computed per line, since rates depend
on product and category, so a bill with a large coupon would otherwise pay commission on money the
shop never received.

`commission.view` and `commission.manage` are separate: a team lead should be able to read their team's
figures without being able to raise their own rate. Both are seeded to Manager.

One trap worth recording, found by the test suite: `pg` returns a `DATE` as a `Date` at local midnight,
so `toISOString().slice(0, 10)` shifts every date back a day in UTC+7. The effective date is now cast to
text in SQL and never passed through a JS `Date`. A rate starting on the 1st would otherwise have been
applied from the previous month.

## Serial numbers (8.3)

Lots (`7.85`) answer *which batch did this come from*. Serials answer *who bought **this** unit, and
when* — the question asked when someone arrives with a warranty claim and no receipt. A lot is a
group; a serial is a piece.

Set `serial_tracked` on a product and the counter must supply one serial per base unit before the sale
will go through: two boxes of ten is twenty serials, not two. Validation happens **before**
`createOrder`, so a short entry costs nothing — no stock reserved, no points deducted, no coupon
counted. Validating afterwards would mean unwinding all of it, which is the easier thing to get wrong.

Duplicates are refused across the whole bill (including two separate lines), and a serial already
marked `SOLD` is refused. The second matters more than it looks. Staff pick up the wrong box
regularly, and letting it through points the warranty history at the previous customer — a mistake
that only surfaces at the claim, when it is too late to reconstruct.

Serials are written inside the transaction that closes the sale, so a committed bill can never lack
them. The conflict write only transitions `RETURNED` back to `SOLD`; it cannot overwrite another
concurrent sale that won the same serial first.

**Serials are captured at the sale, not at goods-in.** A small shop is not going to scan fifty handsets
into the system when a delivery arrives, but it does pick up the box at the counter. The trade-off is
that the serial count and the stock count do not match until stock sells through, which is accurate to
how the shop actually works.

A full return frees the serials to be sold again (`RETURNED` → `SOLD` on the next sale), which is
ordinary for exchanges and second-hand goods. **A partial return does not**, because nothing records
which physical unit came back — serials are captured per line, not bound to individual pieces.
Guessing the first serial in the set would point the warranty history at the wrong unit, which is worse
than leaving it alone.

**Only the POS enforces this.** An online order cannot: at checkout nobody knows which unit will be
picked, and the packer does. Enforcing it there would block online sales of every tracked product.

## Returning goods with no receipt (8.2)

`7.91` handled returns against a bill and required an `orderId`, so a customer who lost the receipt
could not be served at all and there was no override. `bms_pos_blind_returns` adds the path.

This is the most direct fraud route a shop has — bring in goods that were never bought, walk out with
cash — so three controls apply at once: an approver with `pos.return.noreceipt` (seeded to Manager
only) enters their own PIN, a reason is mandatory, and the refund per unit **cannot exceed today's
shelf price**. Without that cap the amount is whatever someone types.

It is a separate table rather than a nullable `order_id` on `bms_pos_returns`. Every row in that table
resolves back to real prices, lots and payments; a receiptless return has nothing to resolve to. And
the five return-report queries in `reports.ts` all join through the order — making the column nullable
would mean complicating five correct queries to carry rows that mean something else.

**The cash goes out through `bms_pos_cash_movements`,** the same table ordinary drawer movements use.
Expected cash at close has exactly one formula, and a second source of cash leaving that does not feed
into it means every shift closes short by exactly the refunds with nobody able to explain the gap. The
drawer must also actually hold the money: a refund larger than the drawer is refused, because you
cannot hand over cash that is not there.

The return audit at `/admin/reports/pos-return-audit` counts these **separately** from ordinary
returns and raises a signal whenever there is even one. Folding them into the same number would bury
the loudest signal in the report under routine activity.

**No credit note is issued.** There is no source tax invoice to reference, so the row is internal
evidence for the accountant, not a tax document.

The counter still tries to recover the original bill first. In the Returns tab, a cashier can now
search by receipt number, order id, member number, customer phone, SKU/product text, or even by
scanning the product barcode itself. When a search query is present, POS widens the lookup across
the tenant's POS bills instead of only the current device's last few receipts, so "which register
sold this?" stops blocking the review. Opening the no-receipt flow also makes the scanner add the
returned item to the blind-return cart **and** search for matching historical bills at the same time;
only if none of those candidates is usable does the manager-approved blind return remain the final
path.

That wider lookup created two extra counter rules. First, a bill found from another POS device is
still useful evidence — the row now shows its real branch/register origin and can be reprinted —
but the return/exchange actions stay closed because `processPosReturn()` still binds receipt-based
returns to the original device. Second, the no-receipt flow must not share an active sale cart: if
the cashier leaves blind-return mode or decides to continue with a real receipt instead, POS now
forces an explicit discard of the blind-return draft before any sale/exchange/receipt-return action
can continue, so returned goods cannot be accidentally sold or parked as a normal bill.

## Blind close and no-sale (8.0)

Two internal controls the shift work in `7.97` left open.

### Blind close

`closePosShift()` always computed expected cash on the server, but the shift report added in `7.97`
would happily show it *before* the count — so whoever counted the drawer could read the answer and
type it back, and variance was zero forever. A control that cannot be failed is not a control.

With `bms_store_profile.pos_blind_close` on (**the default**), `getPosShiftReport()` returns
`expectedCash: null` for a shift that is still open, with `expectedCashHidden: true` so the screen can
say *why* the number is missing rather than looking broken. After the shift closes, everything shows.

It hides the number from everyone, managers included. A blind close with exceptions is not blind: a
number on a screen cannot be stopped from being repeated to the person doing the counting.

The obvious leak was closed with it. `recordCashMovement()` returned `drawerAfter` — the expected
total, exactly — so a cashier could pay ฿1 into the drawer and read the answer off the confirmation.
Under blind close that field and the `WOULD_OVERDRAW` amount both come back `null`. Over-withdrawal
is still refused; the refusal just stops naming the figure.

Facts that are not the answer stay visible: opening float, cash in, cash out, refunds. Without those
the report explains nothing.

**This changes behaviour for existing shops on upgrade** — the column defaults to `TRUE`. A shop that
wants the old behaviour turns it off at `/admin/pos-readiness`.

### No-sale

Opening the drawer to break a note for a customer is routine, and it cannot be forbidden: every till
drawer has a manual release underneath, so a system that refuses just moves the action somewhere with
no record at all. `bms_pos_no_sales` records each one with a mandatory reason, and the count appears
on the shift report — a spike in no-sales is one of the oldest signals in retail.

`pos.nosale` is seeded to Manager, Sales and Cashier. No approver, deliberately: requiring a
supervisor for every roll of coins is what pushes staff to the manual release. The control is the
record, not the gate.

The POS settings tab used to carry a bare "open drawer" button that fired the ESC/POS pulse with
nothing written down — the exact hole this feature exists to close. It now points at the shift tab,
where a reason and a PIN are required and the drawer opens as part of recording the event.

## Shift report (X / Z)

`GET /api/pos/shift-report` returns the sheet a manager signs when taking cash from a cashier: net
sales, bill count, discounts, voids, returns, a breakdown by payment method and by cashier, drawer
movements, expected cash, counted cash, and variance. Reading it mid-shift is an X report; reading it
after close is a Z report — same code, and the only difference is whether the shift is closed.

It is reachable from the counter itself (`pos.shift.report`, seeded to Manager/Sales/Cashier) rather
than only from the back office, for the same reason opening a shift moved to the counter: needing a
second computer to close the till means it does not happen.

A closed shift reports the `expected_cash` **stored at close**, not a fresh calculation. Recomputing
would let a backdated data change make today's printout disagree with the paper signed yesterday.
The DB contract suite asserts that the report and `closePosShift()` produce the same expected cash;
two formulas drifting apart is exactly the failure that makes the signed sheet disagree with the till.

**A device can only read its own shift's report.** `GET /api/pos/shift-report` passes the requesting
device's id into `getPosShiftReport()`, which returns nothing if the shift belongs to a different
device — knowing another register's shift UUID is not enough to read its numbers, even inside the
same store.

**Sales and bill count come straight from the order statuses that count as revenue.** The query
filters to `COMPLETED`/`RETURNED` orders with `voided_at IS NULL` directly, rather than summing every
order sharing the shift and subtracting voids afterward — a still-open deposit (`PENDING`) or a
cancelled bill sharing the shift id can no longer add itself into `salesTotal`/`billCount`.

**A split-payment refund counts once.** A return refunded partly in cash and partly to a card writes
two rows to `bms_pos_refund_allocations`. The return-count and refund-total queries read that table
through a subquery instead of joining it onto the per-return aggregate — joining multiplied both
numbers by the allocation count on any split refund.

## Counter screen layout

A till is typically 768px tall, so vertical space is the scarce axis. Work that happens a few times
a shift sits on a 68px icon rail down the left — sell, returns, shift, settings — and only the left
column of the screen changes with it. The totals, cash pad, and pay button stay on the right at all
times, because queues overlap: the first customer is still paying when the next one hands over a
bill to return. Below 768px wide the rail becomes a bottom bar.

The page itself never scrolls; each column scrolls inside its own box, so the pay button cannot be
pushed off screen by a long cart. Three things stay outside the rail on purpose: the "can't sell
yet" checklist, the cashier selector with the PIN field (memory-only, so it is needed again after
every reload), and the name of whoever is currently selling. Leaving the sell tab and coming back
returns focus to the scan box — a scanner typing into the wrong field is the worst failure this
screen has.

### Keyboard-wedge Scan Manager (`9.6`)

A Bluetooth HID scanner is still a keyboard to the browser. The POS therefore does not infer a
scanner merely from the focused field or from fast typing. Every register has one of two device
settings:

- `FOCUS` preserves the original scan box for unconfigured hardware. It is compatible, but the
  operator must keep the correct field focused.
- `PREFIX` is the production-safe mode. Program the physical scanner to send the configured prefix
  function key (`F1`–`F24`, normally `F9`) before its payload and the configured suffix (`Enter` or
  `Tab`, normally `Enter`) afterward. Printable prefix characters are rejected because ordinary
  typing could otherwise arm global capture.
  Once the prefix arrives, the page captures the whole payload before any member, PIN, payment,
  coupon, or free-text input can receive it. A malformed/timed-out frame is discarded through its
  suffix rather than allowing the tail to leak into the focused field.

Keyboard wedge, camera, and manual code entry enter one serial queue and are routed from explicit
screen state: Sell adds to the cart, product lookup reads without adding, Returns searches a receipt
(or adds a blind-return item when that workflow is explicitly open), and Receive adds to the
selected PO draft. Shift, Settings, sensitive overlays, busy writes, and an unresolved sale disable
scanning. The scan context shown in the header is the routing authority; DOM focus is not.

### Receiving a purchase order at the register (`9.6`)

The Receive tab is a thin POS workflow over the existing purchase service. A cashier selects an
`OPEN`/`PARTIAL` PO, scans items into a draft, reviews quantities plus optional lot/expiry fields,
and explicitly confirms once. Nothing moves during scanning. Confirmation re-verifies the cashier
PIN and `purchase.receive`, derives tenant and branch from the POS device, and calls
`receivePurchaseOrder()`; inventory, lot, movement, PO status, audit, and the POS retry receipt
commit together. The stable device idempotency key replays a committed result if the HTTP response
was lost instead of receiving the same goods twice.

## Tax settings

VAT registration, rate, VAT rounding method, document calendar era, abbreviated-invoice approval,
and cash rounding live on the store profile row and are edited at `/admin/pos-readiness`
(permission `tax.setting.manage`, every change audited with before/after). They apply to new bills
only — an issued document keeps the rate and amounts stored on its own row.

Cash rounding applies solely to bills paid entirely in cash. The rounded difference is its own line
on the bill and on the receipt; it is not a discount and does not change the VAT base. The counter
screen reads the same setting through `/api/pos/session` and charges the rounded amount, so the
amount it sends matches what the server computes — a mismatch would cancel the bill outright.

## Product VAT category

`7.88` added `bms_products.vat_category` (`V` taxable / `N` exempt / `UNKNOWN`) defaulting to
`UNKNOWN`, and four places read it: the order line snapshot, the tax invoice's taxable/exempt split,
the e-Tax XML, and the go-live blocker on `/admin/pos-readiness`. Nothing wrote it. `upsertProduct()`
listed thirteen columns and this was not one of them, there was no mutation and no form field, so a
VAT-registered shop hit *"สินค้าที่เปิดขายยังไม่ระบุประเภท VAT N รายการ"* with no way to clear it
short of hand-written SQL.

It is now editable per product on `/admin/products`, and settable in one shot from
`/admin/pos-readiness` when any active product is still unset.

Three rules the write path enforces:

- **Omitting the field keeps the stored value.** The upsert uses
  `COALESCE($14, bms_products.vat_category)` rather than `EXCLUDED`, because bulk import and any
  caller that predates the field would otherwise reset every product to `UNKNOWN` on the next save —
  wiping a shop's tax classification silently. An unrecognised value is treated as *not supplied*
  for the same reason, rather than throwing and failing a whole import over one bad cell.
- **A new product is `UNKNOWN`, never guessed.** Defaulting to `V` would be right most of the time
  and wrong invisibly the rest, on a field that ends up on filed tax documents.
- **The bulk setter touches only `UNKNOWN` rows**, and only active ones by default. A shop that has
  already separated `V` from `N` correctly must not lose that to one button press.

The bulk mutation requires `tax.setting.manage`, not `product.edit`: classifying the whole shop's
goods for tax is not the same decision as editing a product's name or price.

## e-Tax submission queue

Issuing a tax document at the counter never talks to the Revenue Department by itself — it only
writes the local document row described above. Submitting that document as e-Tax XML is a separate
background queue (`bms_etax_submissions`, migration `7.94`), gated off by default via
`ETAX_ENABLED`/`bms_store_profile.etax_enabled`. When enabled, `processEtaxQueue()` drives each
submission through `PENDING → BUILT → SIGNED → SENT → ACCEPTED/REJECTED/FAILED` with bounded
retry/backoff; `POST /api/bms/jobs/etax` runs one pass. That route authenticates with
`x-job-token`/`BMS_JOB_TOKEN` (not the `x-cron-secret` the other cron routes use — see
[api.md](../architecture/api.md)) and does not yet record into `bms_job_runs`, so it has no run
history on `/admin/operations-schedule` today. Until a real signing/submission provider is wired up
and verified, leave `ETAX_ENABLED` off and rely on locally generated documents plus the accountant's
own filing process.

## Receipt preview

The preview dialog is one card: a header stating the outcome (document number, amount, payment
method, change), the receipt paper, and the action bar. `Enter` prints, `Esc` closes, and the cash
drawer button appears only when an ESC/POS printer is connected over WebUSB — the browser print
dialog cannot open a drawer.

Paper content for a VAT-registered tenant carries the shop's tax id, the split between net amount,
VAT, VAT-exempt goods, and cash rounding, and a Code 39 barcode of the document number for scanning
the bill back at return time. Those tax figures are read from the abbreviated tax document that was
issued with the sale; the browser never derives them from the bill total, because a bill mixing
exempt goods would then print numbers that disagree with the filed document. Return and exchange
slips omit the VAT block — a credit note is a separate document.

The shop tax id comes from the store profile (`/admin/settings`); leaving it blank prints a receipt
without the `TAX#` line, which is not a valid abbreviated tax invoice.

### Line prices on a reprint (9.22)

A line prints at its **shelf price**, and any wholesale step or promotion appears as its own
`ส่วนลดราคาส่ง/โปรโมชั่น` line, so the printed lines always add up to the net total the customer
paid. That price is snapshotted onto the order line at sale time (`bms_order_items.receipt_unit_price`),
separately from `unit_price`, which is the effective price the order arithmetic uses.

The two columns exist because they answer different questions, and collapsing them breaks one of the
answers. Reprinting from `unit_price` alone makes a 1,000 size sold under a 10% step reprint as 900 —
indistinguishable from someone having edited the product price after the sale. Storing only the
charged price instead removes the discount from the paper entirely, so the customer can no longer see
what they saved. Keeping both means a reprint months later reproduces the original paper exactly,
without reading any current product record.

Rows created before `9.22` were backfilled once from the best evidence available at migration time
(pack price → per-size base pack → shared base pack → product price → the historical `unit_price`).
Those legacy values are a reconstruction, not a snapshot; the shelf price at the moment of an old
sale was never recorded anywhere.

### A sale receipt is never rewritten by a later return

Returning goods does not reduce the quantities or the total on the original sale receipt. That
document is the abbreviated tax invoice that was issued and filed; the return produces its own credit
note. What the counter gets instead is disclosure, so a full-value reprint is never mistaken for a
return that failed to record:

- the recent-sales row shows `ยอดขายเดิม` with the returned and remaining amounts beside it, and its
  button reads **ดูใบขายเดิม** rather than `ดู/พิมพ์`
- the preview dialog puts a notice above the paper: this is the original sale, the printed total is
  still the amount charged at the time, followed by the returned and remaining totals (and any refund
  still awaiting cash settlement)
- the returned-sales row offers **ดูใบรับคืนล่าสุด**, while `BillHistoryPanel` lists the sale and
  every return in the order they happened and can reopen the slip for each individual return
- a return slip labels its item amounts as the actual refunded value after allocating the original
  bill's discounts; it does not present that amount as a new shelf price, and it never carries the
  original sale's tendered cash, change, or cash-rounding line
- the slip labels the separately issued credit-note number, but its barcode contains the original
  sale document number so scanning it returns to the searchable bill rather than a CN number that the
  receipt search does not treat as sale authority

### Partial returns recheck quantity pricing (9.23)

The immutable original receipt does not mean the customer keeps a wholesale price after returning
below its minimum. Every partial return rebuilds the retained basket with the wholesale tiers and
promotion snapshotted at sale time. For example, five units at a 90 wholesale price cost 450; returning
one leaves four units at the 100 shelf price, so the refund is 50 and the retained balance is 400 — not
a 90 refund that leaves the four retained units at wholesale price.

Sale-time rules are used deliberately. Reading today's product rules would let a later admin edit
change the refund on an old receipt. Order-level member/coupon/points/manual discounts keep their
original proportional treatment; only quantity pricing is re-evaluated. The return row stores both
the pricing adjustment and the net balance afterward, and Bill history discloses them. If repricing
would make the requested return require collecting additional money instead of paying a refund, the
refund-only flow is refused rather than silently accepting goods with an unexplained zero payout.

Rows created before `9.23` do not contain a provable sale-time rule set. They deliberately keep the
old proportional-refund behavior: a migration-time reconstruction is useful evidence for support,
but is never trusted to alter a legacy customer's real refund. New rows carry `source: "SALE"` in
their pricing snapshot and are the only rows eligible for retained-basket repricing.

### Clinical evidence for a pharmacy case (9.25)

Once a bill has been sent to the pharmacist queue, the counter can attach what makes the hand-over
defensible: a photo or PDF of the prescription, the prescriber's reference number, or a note of what
was advised. Attaching is never required — the pharmacist decides whether a case needs it, and no
policy blocks a sale for lacking it.

The register writes but cannot read. `/api/pos/pharmacy-evidence` takes the device token plus the
cashier's PIN and `pos.sell`, and answers with an id only, so a cashier can capture the prescription
a customer hands over without being able to browse anyone else's. Reading and deleting need
`pharmacy.evidence.read` / `pharmacy.evidence.manage`, seeded to Pharmacist alone (Administrator
holds every permission as a super-role) — a manager who can read the case still cannot open the
prescription image. Details, including why images never travel through `/api/files/[id]`, are in
[the pharmacy README](../../apps/web/lib/bms/pharmacy/README.md).

### The pharmacist authorises at the register (9.29)

A pharmacy counter does not queue every restricted item for a remote review. The pharmacist
is standing there, so the register asks for that pharmacist's PIN and the sale continues.

When a sale is refused by a pharmacy policy, the sell tab now offers the PIN panel beside
the existing "send the case to the pharmacist" button: pick the pharmacist (only users
recorded as licensed appear), enter their PIN — the cashier's own PIN counts when the
cashier is the pharmacist — optionally type what was advised or the prescription's number,
then press Pay again. The authorisation belongs to that bill only; clearing the cart or
finishing the sale drops it, and the PIN is never written to browser storage.

It clears an unreviewed product policy, a short safety check, a pharmacist-approval item, an
online-prohibited item, and a prescription item. (A prescription item can also go the other
route — the pharmacist queue now accepts it, so a shop whose pharmacist is not at the counter
is no longer stuck.) It does not clear a product's per-sale quantity cap — that number is the shop's own setting, so exceeding it means editing the
policy, not pressing a key at the counter.

Every authorisation writes a row naming the pharmacist, the item, the quantity, and the
policy that was cleared, in the same transaction as the bill, plus an audit entry. The
pharmacist is also recorded as the shift's pharmacist when none was recorded at open. Two
switches at `/admin/pos-readiness` control the behaviour: whether counter authorisation is
allowed at all (on by default), and whether an incomplete policy review blocks opening a
till (off by default now — an unreviewed product asks for a PIN instead of stopping the
queue). Details are in [the pharmacy README](../../apps/web/lib/bms/pharmacy/README.md).

## Failure and retry behavior

- Every sale has a UUID idempotency key. A lost response or network interruption leaves a recovery
  record in browser storage; pressing Pay again reuses the same key and cannot create a second bill.
- A `PENDING` or `PAID` sale can resume its settlement transaction. A completed key replays the
  original result. Keys tied to cancelled/returned terminal states cannot be reused as a new sale.
- Returns also require an idempotency key based on the receipt and cumulative returned quantities.
- This is not an offline POS. Search, sale, return, settlement, and shift actions require the BMS
  server and PostgreSQL to be reachable. Keep a documented manual outage procedure and enter those
  transactions only after connectivity returns.

## Go-live checklist

Treat every line below as a blocker unless explicitly marked as a warning:

- Apply migrations through `9.10__bms_pos_petty_cash_wallet_hardening.sql` on the target database
  (includes `7.92` cashier-only accounts, `7.93` per-size packs, `7.94` e-Tax submissions,
  `7.96` membership/tiers/points + `bms_order_discounts`, `7.97` parked bills + drawer
  movements + void, `7.98` branch transfers + stock counts, `9.0` deposits, `9.5` retry-safe
  drawer movements, `9.6` Scan Manager/PO receipts, `9.7` petty-cash expenses, `9.8`
  personal-funded sole-owner expenses, `9.9` the branch petty-cash wallet, and `9.10` its ledger
  integrity constraints). Also apply `9.21` (pack-aware line uniqueness), `9.22`
  (`receipt_unit_price` snapshot) — without `9.22` a receipt reprint shows the discounted price as if
  the product price had been edited after the sale, and its one-time backfill of existing rows only
  runs when the migration does. Apply `9.23` and its `9.24` provenance guard as well so partial
  returns recheck retained quantities against an exact sale-time wholesale/promotion snapshot
  instead of preserving a now-unqualified price or guessing from a legacy bill.
  `7.97` seeds `pos.void` and
  `pos.cash.movement` to Manager only, and `pos.shift.report` to Manager/Sales/Cashier —
  without it those buttons 403 silently. `9.7` seeds `pos.expense.create` to
  Manager/Sales/Cashier and adds the expense ledger; `9.8` seeds `pos.expense.personal` only to
  Administrator; `9.9` seeds `pos.petty_cash.manage` only to Administrator. Apply `7.98` with `psql -1`: a mid-file failure
  leaves half its tables behind, and they have to be dropped by hand before retrying.
- If the shop runs more than one branch, work through the branch-inventory checklist in
  [inventory.md](inventory.md#go-live-checklist-multi-branch-798) as well — `7.98` seeds
  `inventory.transfer`/`inventory.count` to Manager and Warehouse and `inventory.count.apply`
  to Manager only, and its two admin screens 403 silently without them.
- Decide who may approve a manual discount (`pos.discount.approve`), a void (`pos.void`), and
  cash out of the drawer (`pos.cash.movement`). All three are "money leaves the count" actions and
  all three demand a second person's PIN at the counter regardless of who is logged in. Petty-cash
  expenses also use `pos.cash.movement` for their second-person approval.
- If the loyalty program will be used: enable it at `/admin/loyalty`, set the earn/redeem rates, point
  lifetime, and per-bill discount cap, and review the three seeded tiers (Silver/Gold/Platinum are
  defaults, not a recommendation). Then schedule `POST /api/bms/loyalty/maintenance` daily —
  **nothing expires points or re-evaluates tiers on its own.** Run one rehearsal bill per layer:
  tier-only, coupon + tier, points redemption, and a partial return of a bill that both earned and
  redeemed points; confirm the ledger nets out and `balanceMismatchCount` stays 0.
- Create at least one active location, one active paired device per register, and confirm the device
  is attached to the intended branch.
- Set cashier PINs and verify role permissions: `pos.sell`, `pos.shift.open`, `pos.shift.close`,
  `order.return`, `pos.expense.create`; supervisors settling non-cash refunds need `payment.refund`.
- Confirm every active product has a SKU, sale price, inventory row at the device location, barcode
  where scanning is used, and correct pack conversion/pack price where packs are sold.
- If inventory lots are used, reconcile lot totals to inventory before opening; expired lots are
  skipped and a tracked SKU cannot sell more than its unexpired lots.
- For VAT-registered tenants, set the tax settings at `/admin/pos-readiness`, fill in the shop tax id
  at `/admin/settings`, and set the tax category on every sellable product. Verify numbering and receipt content with the business's accountant/tax adviser.
  BMS generates documents locally by default; e-Tax submission to the Revenue Department is a
  separate background queue (`bms_etax_submissions`, migration `7.94`), gated off unless
  `ETAX_ENABLED`/`bms_store_profile.etax_enabled` is turned on — see "e-Tax submission queue" below.
- A `pos_only` cashier account (migration `7.92`) is hard-blocked from `/admin` login by `loginAdmin`
  itself, not just a hidden menu item; it also cannot toggle its own `pos_only` flag or an
  Administrator's.
- Pair the actual scanner (keyboard-wedge input), receipt printer, paper size, cash drawer process,
  and payment terminals. Printing falls back to the browser print dialog; the ESC/POS path over
  WebUSB (receipt, barcode, drawer kick) is written but has never been run against real hardware, so
  test it per printer model before go-live. There is no EDC driver.
- Run a rehearsal on each register: cash sale/change, split payment, card/QR reference, reprint,
  partial return, full return, non-cash refund settlement, rejected unauthorized action, and shift
  close with a known cash variance. Add to that: a manual discount with supervisor PIN, a parked bill
  resumed from a second register, a drawer bank-drop, a void, and an X report read before close.
- Confirm backups, monitoring, stable network/power, and the manual outage/reconciliation procedure.

## Known operating boundaries

The implemented scope is a general-retail POS. It does not include restaurant table/floor plans,
kitchen display/printer routing, modifiers/toppings, queue numbers, reservations, or offline-first
sync. Hardware integrations are browser/OS driven. These are separate product modules, not hidden
configuration switches in the current POS.
