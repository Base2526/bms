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

**Known limitation, by design for v1:** cancelling or returning an order does **not** release its
coupon's redemption count. This errs conservative (a wasted redemption on an abandoned order) rather
than permissive (which would let a create→cancel→recreate loop bypass `max_redemptions`). Per-customer
limits are enforced by counting matching `bms_orders` rows directly — there's no separate redemption
log table. `reorderFromOrder()` ("ซื้อซ้ำ") does not carry a coupon over to the new order; the
customer/staff must supply the code again.

**Usage history** — the "ใช้ไปแล้ว" count on each coupon's row at `/admin/coupons` is clickable and
opens a per-order breakdown (customer, channel, order status, discount, net total, timestamp) via
`bmsCouponRedemptions(couponId)`. This confirms the earlier design decision holds: no dedicated
redemption table was needed — the query reads `bms_orders` directly by `coupon_code`, the same
source used for the per-customer limit check.

## Reorder ("ซื้อซ้ำ")

Staff can recreate a past order in one click from the customer tab in Inbox or from
`/admin/customers` (see [../ui/customer360.md](../ui/customer360.md)). `reorderFromOrder()` reads
the channel/customer_ref/items of an old order and calls the normal `createOrder()` path — so the
new order gets **current** stock and pricing, not a historical snapshot. Gated by permission
`order.create` (seeded to Manager/Sales via migration `6.3__bms_order_create_perm.sql`).

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
