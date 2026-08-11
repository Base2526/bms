# Orders & Shipping

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_orders`, `bms_order_items`, `bms_shipments`, `bms_coupons` ([../architecture/database.md](../architecture/database.md))

AI must never delete orders, refund payments, or change prices without explicit human
confirmation or role permission (see [../ai/prompts.md](../ai/prompts.md)).

## Order lifecycle

**Implemented statuses** (`bms_orders.status`):

```
PENDING → PAID → PACKING → SHIPPED → COMPLETED
        ↘ CANCELLED (returns reserved stock)
                              SHIPPED/COMPLETED → RETURNED (returns stock to inventory)
```

There is **no separate Draft status** in the implementation — an order is created directly at
`PENDING` with stock already reserved. (Earlier planning docs described a Draft stage with no
stock deduction; that was never built this way — every order reserves stock immediately.)

| Status | Stock effect |
| --- | --- |
| PENDING | Stock reserved at creation |
| PAID | Stock stays reserved |
| PACKING | Stock stays reserved |
| SHIPPED | Stock deducted permanently (`current_stock -= qty`, `reserved_stock -= qty`) |
| COMPLETED | No further stock change |
| CANCELLED | Reserved stock released |
| RETURNED | Stock returned to inventory (`current_stock += qty`) — refund handled separately at Payment (`REFUNDED`) |

Every transition is **atomic** (single DB transaction) to prevent oversell or double-deduction —
see `lib/bms/orders.ts`.

**Order status emails (2026-07):** every status transition — `payOrder`/`packOrder`/`shipOrder`/
`completeOrder`/`cancelOrder`/`returnOrder` in `lib/bms/orders.ts`, plus the two other places an
order can reach `PAID`/`SHIPPED`/`COMPLETED` outside those functions (`confirmPayment()` in
`lib/bms/payments.ts`, and `createShipment()`/`setShipmentStatus()` in `lib/bms/shipping.ts`) —
fires `notifyOrderStatusEmail()` (`lib/bms/orderNotify.ts`) after its `COMMIT`. The hook lives in the
shared service layer, not at each GraphQL/REST/AI-tool call site, so every caller gets it for free
and none can forget to wire it. It is fire-and-forget and swallows all its own errors (missing
`bms_customers.email` is the common case — most customers come from chat channels and never provide
one — and is treated as a normal skip, not a failure); an email/SendGrid outage can never block or
roll back an order-status change. Templates live in the existing global `email_templates` table
(keys `order.paid`/`order.packing`/`order.shipped`/`order.completed`/`order.cancelled`/
`order.returned`, seeded in both `th`/`en` locale by migration `7.19`), personalized per tenant at
render time via `getStoreProfile()`/`getTenantName()`.

Two branding fields on the store profile (migration `7.20`) let a shop make these emails
recognizable as their own without a full per-tenant template editor (the `email_templates` table has
no `tenant_id` — a real editor would need a schema change plus a safe HTML-editing UI, judged not
worth it yet): `emailThemeColor` (`#RRGGBB`, validated in `upsertStoreProfile()`, used for a header
bar + store name) and `emailFooterText` (free text, optional — omitted entirely from the email when
unset). Edited from the "อีเมลแจ้งสถานะออร์เดอร์" section of the store profile card in
`/admin/settings`.

## Staff-created orders and invoices

Inbox Customer 360 exposes a **สร้างออเดอร์** Quick Action for staff with `order.create`.
`bmsCreateOrder(channel, customerRef, items)` derives the tenant from the authenticated context and
calls the same `createOrder()` service used by the customer/AI pipeline. It resolves the CRM identity,
uses current active-product prices, reserves every requested variant atomically, and creates the order
directly as `PENDING`; any missing product or insufficient-stock result rolls back the whole order.

Staff with `order.view` can call `bmsGenerateInvoice(orderId)` from the same panel. The invoice is a
read-only projection of the real order: line prices are the snapshots captured at order creation and
the store header comes from the current store profile/tenant name. It is rendered for preview/print
only and is not persisted as a separate invoice, payment, or tax-document record. If a coupon was
applied, the invoice shows the discount line and code alongside the item subtotal.

The admin order surfaces read the same coupon snapshot. `/admin/orders`, Customer 360 current cart,
and the Inbox recent-order preview all show subtotal → coupon discount/code → net total, while
`bms_orders.total_amount` remains the post-discount amount owed.
Inbox Customer 360 and the expandable row on `/admin/customers` also show a dedicated
"คูปองของลูกค้า" section backed by `bms_customer_coupon_wallet`, so staff can see which coupons
belong to that customer, whether each code is still available, near expiry, reserved on an in-flight
order, or already redeemed.

For chat-created orders, the post-order reply is also deterministic about the next step: it reuses
complete CRM delivery details without asking the customer to enter them again, asks only the first
missing delivery field when incomplete, and waits until those details are complete before listing
payment accounts. It lists only accounts the store has actually configured; a store with no
receiving account gets no proactive bank/PromptPay/QR suggestion.
This does not change the order lifecycle: the order is still `PENDING`, and a submitted payment
remains `PENDING` until a human confirms it.

For customer chat orders, a successful `create_order`/`reorder` always produces a deterministic
signed `/checkout?t=...` link from the persisted order; the AI model cannot replace this with a
generic admin handoff. The checkout is read-only for order lines, prices, discount, and total. It
reuses existing CRM delivery data without requiring re-entry, and shows shipment/tracking data only
when those records exist. See [Customer Checkout & Payment Wireframe](../ui/customer-checkout-wireframe.md).

## Coupons (discount codes)

**Implemented** (`bms_coupons`, migration `7.21`) — `PERCENT` (capped at 100) or `FIXED` discount
codes, managed at `/admin/coupons` (`coupon.manage`, seeded to Manager + Administrator only — pricing
is margin-sensitive, so Sales/Warehouse don't get it by default). A coupon can optionally set a
minimum order amount, a total redemption cap, a per-customer redemption cap, and a start/expiry
window; `active` is a manual on/off switch independent of those.

A coupon is applied by passing `couponCode` into `createOrder()` (`lib/bms/orders.ts`) — the same
entry point used by the customer/AI chat pipeline, `bmsCreateOrder` (admin/staff), the AI tool
catalog's `create_order` tool (both customer and staff surfaces — Claude can pass through a code the
customer mentions in chat without any NLU changes, since tool-calling already extracts structured
arguments from free text), and the REST `POST /api/bms/order` endpoint. Validation and redemption
(`applyCouponInTx()`, `lib/bms/coupons.ts`) run **inside the same transaction** as stock
reservation, locking the coupon row `FOR UPDATE` before incrementing `redemptions_count` — an invalid
or exhausted code rolls back the whole order (a new `COUPON_INVALID` result status, alongside the
existing `INSUFFICIENT`/`NOT_FOUND`/`EMPTY`), the same way insufficient stock does. The resulting
discount and code are snapshotted onto the order (`bms_orders.discount_amount`/`coupon_code`) so
historical totals stay correct even if the coupon is edited or deleted afterward.

**Customer coupon discovery / wallet link** — the customer AI surface exposes read-only
`list_customer_coupons`, `list_available_coupons`, and `check_coupon` tools. AI can answer
"มีคูปองอะไรบ้าง", "อะไรใกล้หมดอายุ", typed codes, or discount questions only after those tools
return backend-verified eligibility. AI must not infer coupon use from free-form chat text such as
`ใช้ SAVE10`, `use SAVE10`, or localized variants; when staff sends a coupon, the backend assigns it
to the customer's wallet automatically and sends a signed wallet link (`/coupon/wallet?t=...`).
`list_customer_coupons` reads the
customer's wallet assignment rows
(`bms_customer_coupon_wallet`, `7.25`) when the shop has explicitly given them a coupon;
`list_available_coupons` still works as a discovery fallback for shop-wide active coupons when no
wallet rows exist. The tools evaluate active/start/expiry/total quota/per-customer quota/
minimum-order rules and may return alternative coupons if the requested code is unavailable. This is
intentionally an "auto-validate" flow, not an AI override: opening the wallet only shows coupons;
actual discount and redemption still happen later inside `createOrder()` in the same transaction as
stock reservation. Once an order is created the wallet row becomes `RESERVED`, then `REDEEMED` when
the order reaches the paid path, and returns to `ASSIGNED` if the order is cancelled before the sale
really completes.

**Release policy** — coupon quota is released only when the sale never really happened. Staff/manual
cancel (`cancelOrder()`) and the unpaid-order cron (`releaseExpiredOrders()`) return both reserved
stock and the coupon's operational `redemptions_count` in the same transaction. Rejecting a payment
slip alone does **not** release the coupon because the order remains open for a corrected slip; the
coupon is released if that order is later cancelled or auto-released. Post-sale returns/refunds do
not automatically release coupon quota because the coupon was already used on a real transaction.
Per-customer limits are enforced by counting non-cancelled matching `bms_orders` rows directly —
there's no separate redemption log table. `reorderFromOrder()` ("ซื้อซ้ำ") does not carry a coupon
over to the new order; the customer/staff must supply the code again.

**Deletion/editing guard** — once a coupon has ever been attached to an order, it cannot be deleted
or renamed, even if a cancellation later returns its redemption count to zero. Operators should
set `active=false` to stop future use while preserving order history and usage traceability.

**Operator workflow**

1. Create the master coupon at `/admin/coupons`: code, percent/fixed amount, minimum order amount,
   total redemption cap, per-customer cap, start date, expiry date, and `active`.
2. Give the coupon to a customer from Inbox by using the coupon composer or the Customer 360
   "แจกคูปอง" action. This creates or updates the customer's `bms_customer_coupon_wallet` row.
3. Check a customer's wallet from Inbox Customer 360 or by expanding the row in `/admin/customers`.
   These views show the code, state, expiry, remaining entitlement, reason it cannot be used, and
   any reserved/redeemed order id.
4. If the customer asks "มีคูปองอะไรบ้าง", asks for expiring coupons, or types a code like `SAVE10`,
   the AI must call coupon tools before replying. It can explain eligibility, but it must not
   activate or redeem a coupon from chat text.
5. The discount is applied only when an order is created with `couponCode`. If validation fails,
   order creation returns `COUPON_INVALID` and rolls back like an insufficient-stock order.
6. Payment confirmation moves the wallet to `REDEEMED`; cancelling or auto-releasing an unpaid order
   returns the coupon quota and moves the wallet back to `ASSIGNED`.

**Condition examples**

- `SAVE10`: active, not expired, quota remains, customer has not exceeded per-customer limit, and the
  cart reaches the minimum amount → passes; the order snapshot shows subtotal, discount, code, and
  net total.
- `WELCOME50`: fixed 50 baht with no minimum and assigned to the customer wallet → appears when the
  customer asks what coupons they have.
- `FLASH100`: starts tomorrow → fails before the start time; AI/admin UI should explain that it is
  not usable yet.
- `VIP25`: minimum 1,000 baht but current cart is 850 baht → fails with a minimum-order reason and
  does not reserve or redeem the wallet row.
- `LAST1`: total redemption cap is exhausted → fails even if the customer has the coupon in their
  wallet.
- A reserved order gets cancelled or auto-released before payment → quota is returned and the wallet
  state rolls back from `RESERVED`.
- A payment slip is rejected but the order remains open → the coupon is not released yet, because the
  customer can still submit a corrected slip.
- A coupon has been used on any order → do not delete or rename it; turn `active` off to stop future
  use while keeping historical orders traceable.

**Usage history** — the "ใช้ไปแล้ว" count on each coupon's row at `/admin/coupons` is clickable and
opens a per-order breakdown (customer, channel, order status, discount, net total, timestamp) via
`bmsCouponRedemptions(couponId)`. This confirms the earlier design decision holds: no dedicated
redemption table was needed — the query reads `bms_orders` directly by `coupon_code`, the same
source used for the per-customer limit check.

**Dashboard summary** — `bmsDashboard.couponSummary` (`/admin/dashboard`) shows total discount given
and total redemptions for the current calendar month, plus the top 5 codes by redemption count. Each
top code carries recent usage rows so operators can expand it and see which customer/order/channel
used the code, including subtotal, discount, net total, and order status. All values are derived from
the same `bms_orders.coupon_code`/`discount_amount` columns (no separate redemption table). The field
is **masked to `null`** for roles without `coupon.view`
(e.g. Sales, who has `report.view` and can see the rest of the dashboard) via a field resolver in
`bmsDashboard.ts` rather than a schema-level permission — this keeps `bmsDashboard` itself usable by
every `report.view` role while still hiding margin-sensitive numbers from roles that can't open
`/admin/coupons` directly.

## Reorder ("ซื้อซ้ำ")

Staff can recreate a past order in one click from the customer tab in Inbox or from
`/admin/customers` (see [../ui/customer360.md](../ui/customer360.md)). `reorderFromOrder()` reads
the channel/customer_ref/items of an old order and calls the normal `createOrder()` path — so the
new order gets **current** stock and pricing, not a historical snapshot. Gated by permission
`order.create` (seeded to Manager/Sales via migration `6.3__bms_order_create_perm.sql`).

On the customer surface, latest-order lookup and ownership use the canonical CRM `customer_id`, not
only the current channel key. This lets an explicitly merged customer repeat an order from another
of their identities without exposing another customer's order. The new order is attributed to the
current channel identity; staff-initiated reorder keeps the source order's identity as before.
Staff can still reorder an internally created order whose `customer_ref` is null; canonical channel
override is applied only to customer-initiated reorder.

## Shipping

**Implemented** (`bms_shipments`): carrier = `FLASH` / `KERRY` / `DHL` / `AUSPOST` / `NZPOST` / `OTHER`.

```
PENDING → SHIPPED → IN_TRANSIT → DELIVERED
                                ↘ RETURNED / CANCELLED
```

`createShipment()` moves the order from `PACKING` → `SHIPPED`, deducts stock, and records a `SHIP`
movement — all atomic. If the order is already `SHIPPED`, it just attaches the shipment without
deducting stock again. A tracking number is optional at shipment creation and can be added later;
an order cannot reach `COMPLETED` before it's `SHIPPED`. Labels are informational only — no real
carrier API is wired up yet (roadmap item).

Before a `PACKING` order can become `SHIPPED`, both `shipOrder()` and `createShipment()` enforce the
same address rule:

- LINE, Facebook, Instagram, Web, and TikTok Chat require a linked CRM customer with at least one
  `bms_customer_addresses` row whose `address_type` is `shipping`.
- Lazada and Shopee are exempt because the fulfillment address remains in Seller Center. TikTok in
  this codebase is a chat-sales channel, not TikTok Shop checkout, so it is not exempt.

`BmsOrder.hasShippingAddress` lets `/admin/orders` disable the send action and link to Customers,
but the service checks are authoritative and also protect REST, GraphQL, Shipping UI, and AI-tool
call paths.

Permissions: `shipping.view` / `shipping.create` / `shipping.update`.

## Purchase Orders (supplier replenishment)

See [inventory.md](inventory.md) — Purchase Orders are documented there since receiving stock is
what actually moves inventory.
