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

A customer can have multiple shipping addresses (add/edit/set-default/delete from the Customers
page; deleting an address never affects the customer or their orders). Customers are **never hard
deleted** — only soft-deleted (`deleted_at`).

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

**Outbound message status (Phase 1):** capability-gated per channel. LINE/Facebook/Instagram can
actually push and actually fail (`SENT`/`FAILED` + a "ส่งใหม่" retry button); Web/TikTok/Shopee/Lazada
don't push at all yet, so they're just marked `SENT` once persisted (no fake failure state). Read
receipts are not implemented on channels that can't genuinely report them (LINE, TikTok).

Permissions: `inbox.view` / `inbox.reply` / `inbox.manage` · `customer.view` / `customer.edit`.

## Self profile

Separate from CRM customer records, staff/admin users now have a self-service profile page at
`/admin/profile` backed by `bmsMe`, `updateMe`, and `uploadAvatar`. This is for the logged-in
operator's own account metadata (name, phone, language, avatar) and does not change customer
records or tenant-wide user-role assignments.
