# Customer 360 (Inbox right panel + customer tab + CRM merge/reorder)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Business rules: [../business/crm.md](../business/crm.md) · [../business/order.md](../business/order.md)

Goal: when a staff member opens a chat, they should immediately see who this customer is and what
they've bought — no tab-switching to a separate CRM page.

## Right-hand Customer 360 panel (`/admin/inbox`)

On desktop, `Customer360Panel.tsx` is the third Inbox column. It loads
`bmsCustomer360(customerId)` with `customer.view` and shows the linked CRM profile, channel
identities, addresses, customer statistics, current cart (the latest unpaid `PENDING` order),
recent cross-channel orders, purchased products, and internal notes. Summary, cart, recent orders,
and Quick Actions are expanded by default. The whole panel can be collapsed and remembers that
preference in `localStorage`.

The expensive sections stay lazy:

- `bmsCustomerTimeline(customerId)` merges conversation, order, shipment, refund, and note events
  only when Timeline is opened.
- `bmsCustomerInsights(customerId)` generates a summary from a verified facts bundle and caches it
  by facts hash; it must not invent customer facts.

Quick Actions reuse existing services and permissions:

- **สร้างออเดอร์** requires `order.create`, loads active products/available variants, and calls
  `bmsCreateOrder`. The service resolves the active conversation identity, snapshots current prices,
  reserves stock atomically, and creates the order directly as `PENDING`. A successful create
  refetches Customer 360.
- **ออกใบแจ้งหนี้** requires `order.view` and calls `bmsGenerateInvoice` for a selected recent order.
  It uses the stored order-item prices and the current store profile for preview/printing. The
  document is ephemeral and is not an invoice record or payment confirmation.
- Stock, refundable payments, and the full customer record continue to link to their authoritative
  admin pages. Staff assignment remains in the conversation header.

Recent-order links preserve the operator's place in the conversation. **เปิดออเดอร์** opens a
right-side preview drawer inside Inbox; **เปิดหน้า Orders เต็มจอ** opens `/admin/orders` in a new tab
for deeper work. Closing the drawer returns to the same chat and draft.

## Compact chat workspace and product sharing

The queue filters and active-chat header intentionally use smaller typography and tighter spacing
so the message history and composer get most of the available height. The channel tag follows the
customer name; the old Chat Focus control is not part of this layout.

The composer keeps the existing cross-channel message contract: a text body and at most one
attachment. Selecting **รูป** or **ไฟล์** uploads it into the draft, shows a removable preview, and
waits for the staff member to press Send. The two buttons have independent loading indicators, but
choosing another attachment replaces the current draft attachment because the backend supports one.

The **สินค้า** picker lists products and their cover image, SKU, current price, and available
variants. Inactive products remain visible for search clarity but are labelled **ปิดขาย** and cannot
be inserted. Staff can choose:

- **ข้อความ + ลิงก์** — stage product name, SKU, price, a stock summary, and its customer-safe
  public URL as editable text.
- **ข้อความ + รูป + ลิงก์** — stage the same text and URL plus the product cover image as the one
  attachment. The remaining gallery images stay on the public page instead of flooding the chat.
- **ดูหน้า Public** — preview the same no-login page the customer will receive.
- **เปิดหน้า Products เต็มจอ** — open the internal product admin page in a new tab.

Nothing is sent until staff reviews the draft and presses Send. The internal `/admin/products` URL
is never inserted into a customer message. Customer links use
`/shop/[tenantSlug]/products/[sku]`, which returns only active products from active shops and exposes
sale-safe fields. See [public-products.md](public-products.md).

## Message presentation

The Inbox keeps the cross-channel payload unchanged (`body` plus at most one attachment), but renders
each saved message according to its content:

- plain text uses the compact sender-colored bubble;
- images use a light preview card with caption, zoom, and download actions;
- non-image files use a compact type/name/download card;
- a body containing the customer-safe public-product URL uses a product card with cover, name, SKU,
  price, stock summary, and **ดูสินค้า** instead of exposing the raw URL in the staff conversation.

This is a presentation-only enhancement. Customers still receive channel-compatible text/link and
the optional single cover attachment, so LINE/Meta/Web/TikTok behavior does not diverge.

`BmsOrder.hasShippingAddress` is also exposed on the Orders admin list. LINE/Facebook/Instagram/
Web/TikTok Chat orders cannot move from `PACKING` to `SHIPPED` until the linked CRM customer has an
address with `address_type = 'shipping'`; both direct order shipping and shipment creation enforce
this in backend services. Lazada/Shopee are exempt because their fulfillment address is held in
Seller Center. The disabled Orders button and Customers link are guidance, not the security boundary.

## The "ลูกค้า" tab (`/admin/inbox`)

`ConversationPane` in [`inbox/page.tsx`](../../apps/web/app/(admin)/admin/inbox/page.tsx) auto-loads
`bmsCustomer(conv.customerId)` the instant a conversation is opened (a `useEffect` keyed on
`conv.customerId` — no button click needed, unlike the older "Timeline" tab which still requires a
manual load). It shows:

- Lifetime spend (`total_spent`) and order count (`order_count`)
- Customer tags and internal note
- Full order history (`orders[]`) with channel, status, amount, date

No new backend was needed — it reuses the existing `bmsCustomer` GraphQL query and
`getCustomer()`/`customerOrders()` (`lib/bms/customers.ts`). Gated by permission `customer.view`;
without it, the tab shows an empty state rather than an error.

The Inbox list/header may show cached channel profile metadata before staff opens Customer 360. For
LINE OA, the webhook syncs `display_name` and `picture_url` into `bms_customer_identities`; GraphQL
exposes these as `customerName` fallback and `customerAvatar`. The Customer 360 tab still uses the
linked `bms_customers` record as the authoritative CRM profile.

The same header also shows the receiving shop/channel source when available. For LINE OA, cached
bot info from `bms_tenant_channels.extra` is exposed as `sourceDisplayName`, `sourceHandle`, and
`sourceAvatar`, so operators can see `ทักจาก: LINE OA “...”` directly in the Inbox header and a
compact `ร้าน: ...` line on the conversation list.

Responsive layout keeps the same data path but changes the visible panes:

- Desktop keeps the sales desk layout: navigation rail, conversation list, active chat, and the
  right-hand Customer 360 panel when there is enough width.
- Tablet collapses the conversation list to an avatar rail and hides the right-hand Customer 360
  panel; the same customer data remains available through the `ลูกค้า` tab inside the chat.
- Mobile uses a two-screen flow: conversation list first, then a full-screen chat with a back
  button. This avoids squeezing the message composer and chat history into a narrow split view.

Diagnostic conversations created from
[`/admin/inbox/realtime-diagnostics`](inbox-diagnostics.md) use `customer_ref =
diagnostic:{channel}:{adminId}` and may not have a linked `customerId`. They are for verifying
Inbox realtime behavior, not for testing Customer 360 merge/history logic.

**Known limitation:** since customer identity only matches on `(tenant, channel, external_ref)`
(see [../business/crm.md](../business/crm.md)), a customer who messages via two different channels
shows up as two separate records with two separate (incomplete) purchase histories — until merged.

## Merging duplicate customers

`mergeCustomers(tenantId, keepId, mergeId)` — [`lib/bms/customers.ts`](../../apps/web/lib/bms/customers.ts)
— consolidates a duplicate record into the one being kept:

- Moves `bms_customer_identities`, `bms_orders`, `bms_customer_addresses`, and `bms_conversations`
  from `mergeId` to `keepId` (safe with no conflicts, since an identity can only ever belong to one
  customer per tenant+channel+ref).
- Unions tags; fills in `phone`/`note` on `keepId` if missing, from `mergeId`.
- Soft-deletes `mergeId` (`deleted_at`) — **not reversible**.
- All in a single transaction (`beginTenantTx`).

UI: `/admin/customers` → **"ผสาน"** button per row → search for the duplicate → confirm.
GraphQL: `bmsMergeCustomers(keepId, mergeId)`, permission `customer.edit`, audited as
`customer.merge`.

## Reorder ("ซื้อซ้ำ")

A "ซื้อซ้ำ" button appears both in the customer tab's order list (Inbox) and in the order-history
table on `/admin/customers`. It calls `reorderFromOrder(tenantId, orderId)`
([`lib/bms/orders.ts`](../../apps/web/lib/bms/orders.ts)), which reads the old order's
channel/customer_ref/items and re-runs the normal `createOrder()` path — so pricing and stock
availability reflect **today**, not the historical order. See
[../business/order.md](../business/order.md) for the full lifecycle detail. Permission:
`order.create` (seeded to Manager/Sales via migration `6.3__bms_order_create_perm.sql`).

## What's still missing

- No automatic cross-channel dedup (merge is manual-only today).
- No marketplace deep links from recent orders, payment-link generation, or support-ticket system.
- Fake-data seeders don't create `bms_customer_identities` rows, so testing the merge flow with
  seeded data alone won't show anything to merge — seed real conversations too, or create
  identities by hand.
