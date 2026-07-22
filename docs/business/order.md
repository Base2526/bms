# Orders & Shipping

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · Data: `bms_orders`, `bms_order_items`, `bms_shipments` ([../architecture/database.md](../architecture/database.md))

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

## Staff-created orders and invoices

Inbox Customer 360 exposes a **สร้างออเดอร์** Quick Action for staff with `order.create`.
`bmsCreateOrder(channel, customerRef, items)` derives the tenant from the authenticated context and
calls the same `createOrder()` service used by the customer/AI pipeline. It resolves the CRM identity,
uses current active-product prices, reserves every requested variant atomically, and creates the order
directly as `PENDING`; any missing product or insufficient-stock result rolls back the whole order.

Staff with `order.view` can call `bmsGenerateInvoice(orderId)` from the same panel. The invoice is a
read-only projection of the real order: line prices are the snapshots captured at order creation and
the store header comes from the current store profile/tenant name. It is rendered for preview/print
only and is not persisted as a separate invoice, payment, or tax-document record.

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
