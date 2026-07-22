# CRM & Customer Conversations

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · UI: [../ui/customer360.md](../ui/customer360.md) · Data: `bms_customers`, `bms_customer_identities`, `bms_customer_addresses`, `bms_conversations` ([../architecture/database.md](../architecture/database.md))

## Customer identity

A customer may come from multiple channels (LINE, TikTok, Facebook, Website, ...) that should
resolve to the same person. **Implemented matching key:** `(tenant_id, channel, external_ref)` via
`bms_customer_identities` — this is narrower than the originally planned priority list
(customer ID → LINE ID → TikTok ID → Facebook ID → email → phone). There is **no automatic
cross-channel dedup** by phone or email: the same person messaging via two different channels
becomes two separate customer records until staff manually merges them
(`mergeCustomers()` — see [../ui/customer360.md](../ui/customer360.md)).

Channel identities may also cache platform display metadata. LINE OA currently syncs
`display_name`, `picture_url`, `status_message`, `language`, `profile_synced_at`, and any sync
error fields on `bms_customer_identities`. This metadata is a display fallback for Inbox only:
staff-maintained `bms_customers` data remains authoritative and must not be overwritten by a
background platform sync. GraphQL/UI reads must use the cache; they must not call external profile
APIs during list rendering.

A customer can have multiple shipping addresses (add/edit/set-default/delete from the Customers
page; deleting an address never affects the customer or their orders). For LINE/Facebook/Instagram/
Web/TikTok Chat orders, at least one address with `address_type = 'shipping'` is required before an
order can move from `PACKING` to `SHIPPED`; `shipOrder()` and `createShipment()` both enforce this.
Lazada/Shopee are exempt because the shipping address stays in Seller Center. Customers are **never
hard deleted** — only soft-deleted (`deleted_at`).

## Omnichannel Inbox

Every conversation belongs to exactly one customer and is **never deleted**. Internal notes are
never visible to the customer.

**Implemented** (`bms_conversations` / `bms_messages` / `bms_conversation_notes`): every message
from every channel — plus the AI's replies — is logged automatically via `logConversation()`.
One conversation = `(tenant, channel, customer_ref)`. Staff can assign conversations, set status
(`OPEN`/`PENDING`/`CLOSED`), tag, add internal notes (`inbox.manage` only), reply directly
(`sendStaffMessage`, with image/file attachments), and view a merged timeline of
messages + notes + orders. Since this session, a dedicated "ลูกค้า" tab also surfaces purchase
history, lifetime spend, tags, and notes the moment a conversation is opened — see
[../ui/customer360.md](../ui/customer360.md).

The desktop right-hand Customer 360 panel also provides permission-gated Quick Actions: staff can
create a `PENDING` order for the active identity through the shared order service and can preview/
print an ephemeral invoice from an existing order. These actions do not move CRM or order business
rules into the frontend.

**Outbound message status (Phase 1):** capability-gated per channel. LINE/Facebook/Instagram can
actually push and actually fail (`SENT`/`FAILED` + a "ส่งใหม่" retry button); Web/TikTok/Shopee/Lazada
don't push at all yet, so they're just marked `SENT` once persisted (no fake failure state). Read
receipts are not implemented on channels that can't genuinely report them (LINE, TikTok).

**Diagnostics:** `/admin/inbox/realtime-diagnostics` is not a customer channel. `Emit` proves only
that realtime invalidation reaches the browser; it does not create a conversation. `Create Msg`
creates a tenant-scoped diagnostic conversation/message with `customer_ref =
diagnostic:{channel}:{adminId}` and `sender = diagnostic` so staff can verify that the Inbox list
updates immediately. It does not call the AI pipeline and does not send anything to external
platforms.

Permissions: `inbox.view` / `inbox.reply` / `inbox.manage` · `customer.view` / `customer.edit`.

## Self profile

Separate from CRM customer records, staff/admin users now have a self-service profile page at
`/admin/profile` backed by `bmsMe`, `updateMe`, and `uploadAvatar`. This is for the logged-in
operator's own account metadata (name, phone, language, avatar) and does not change customer
records or tenant-wide user-role assignments.
