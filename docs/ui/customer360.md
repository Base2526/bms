# Customer 360 (Inbox "ลูกค้า" tab + CRM merge/reorder)

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Business rules: [../business/crm.md](../business/crm.md) · [../business/order.md](../business/order.md)

Goal: when a staff member opens a chat, they should immediately see who this customer is and what
they've bought — no tab-switching to a separate CRM page.

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
`order.create` (new — seeded to Manager/Sales via migration `6.1`).

## What's still missing

- No automatic cross-channel dedup (merge is manual-only today).
- Fake-data seeders don't create `bms_customer_identities` rows, so testing the merge flow with
  seeded data alone won't show anything to merge — seed real conversations too, or create
  identities by hand.
