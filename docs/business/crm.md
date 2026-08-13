# CRM & Customer Conversations

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Tools: [../ai/tools.md](../ai/tools.md) · UI: [../ui/customer360.md](../ui/customer360.md) · Data: `bms_customers`, `bms_customer_identities`, `bms_customer_addresses`, `bms_conversations` ([../architecture/database.md](../architecture/database.md))

## Customer identity

General-shop and pharmacy-shop archetypes use the same tenant-scoped CRM source of truth:
`bms_customers` for the person and `bms_customer_identities` for their channel accounts. Orders,
addresses, conversations, restock subscriptions, coupon wallet rows, and pharmacy assessments all
reference that shared `customer_id`; there is no separate pharmacy-customer table. This sharing is
inside one tenant only. Two different shops/tenants must never share or resolve customer data across
the tenant boundary.

A customer may come from multiple channels (LINE, TikTok, Facebook, Website, ...) that should
resolve to the same person. **Implemented matching key:** `(tenant_id, channel, external_ref)` via
`bms_customer_identities` — this is narrower than the originally planned priority list
(customer ID → LINE ID → TikTok ID → Facebook ID → email → phone). There is **no automatic
cross-channel dedup** by phone or email: the same person messaging via two different channels
becomes two separate customer records until staff manually merges them
(`mergeCustomers()` — see [../ui/customer360.md](../ui/customer360.md)).

For every persisted customer channel, the pipeline establishes the identity before routing either
the general commerce flow or pharmacy intake rather than waiting for checkout. New identities claim
older unlinked orders, conversations, restock subscriptions, and assessments with the exact same
channel key; migration `7.74__bms_shared_customer_identity_backfill.sql` repairs historical rows for
identities that already existed. This makes purchase history, saved delivery details, and consented,
customer-confirmed patient memory discoverable on later visits. It does not weaken the cross-channel
rule above: identities from different channels are still joined only by an explicit staff merge,
not by an unverified matching name or phone number.

Every API route that invokes the customer pipeline also invokes the shared Inbox logger, including
the legacy default-tenant LINE/TikTok mock routes. The logger establishes a missing identity before
persisting its conversation as a final safety net, so early-return and fallback replies do not leave
a persistable conversation detached from CRM merely because specialized routing returned first.

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

The customer chat checkout reads delivery completeness through `getCustomerCheckoutStatus()`, scoped
to the channel identity. Its AI tool returns only booleans/counts, an optional address label, and
ordered missing-field names; raw CRM PII is not sent merely to decide whether a form is needed.
Complete saved details are reused automatically. Incomplete details are collected one field at a
time and saved by `saveCustomerCheckoutDetails()` only when the customer explicitly supplied them.
An identical shipping address is selected as default rather than inserted again.

Customer-safe own-order status, payment submission, and reorder resolve the channel identity to its
canonical `customer_id` first. After staff merges duplicate LINE/Facebook/etc. records, those reads
therefore see the combined cross-channel order history. Legacy orders with no `customer_id` remain
readable only through their exact server-established `(channel, customer_ref)` key. A customer
reorder creates the new order on the channel currently talking to BMS, even when its source order
came from another merged identity.

Payment auto-selection is deliberately narrower: it uses only the latest `PENDING` order whose
stored `(channel, customer_ref)` matches the current server-established identity. It never silently
selects a merged order from another channel, and Lazada/Shopee remain Seller Center-managed.
Repeated customer notices reuse an existing active payment instead of inserting another `PENDING`
payment row.

Manual merge preserves customer-level profile fields as well as linked rows: tags are unioned;
missing phone/email/note/language/timezone values are filled from the merged record; and follow-up
opt-out is combined conservatively with boolean OR so merging can never silently re-enable messages
for a customer who opted out on either identity.

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

**@mention in internal notes (2026-07):** typing `@name` while writing a note opens a picker over
`bmsAssignableStaff` (Sales/Manager/Administrator only, same list used for assign/helper); selecting
a name inserts `@Name` into the note body for display and separately records the mentioned user's id
— the mutation (`bmsAddConversationNote(id, body, mentionedUserIds)`) never parses `@name` out of
free text, so a duplicate/misspelled name can't misfire. Each valid mention is both logged in
`bms_conversation_note_mentions` (tenant/note/conversation/user, with a `read_at` column reserved for
a future "my mentions" view) and pushed through the existing generic `notifications` table/
`notificationCreated` subscription — no new realtime channel. `GlobalMentionNotifier` (mounted
alongside `GlobalInboxNotifier`) turns that into a browser notification deep-linking to
`/admin/inbox?c=<id>`. Gated by the existing `inbox.manage` permission (creating a mention) and
`inbox.view` (reading your own); no new permission was added. A sidebar badge next to a dedicated
"เมนชันของฉัน" page (`/admin/inbox/mentions`, `bmsMyMentionsUnreadCount`/`bmsMyMentions`) lists a
user's own mentions, filterable by unread, with mark-read/mark-all-read actions
(`bmsMarkMentionRead`/`bmsMarkAllMentionsRead`) that use the `read_at` column reserved when the
mentions table was first created.

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

**Follow-up Automation (MVP core, `lib/bms/followups.ts`, migration `7.52`):** rather than a fixed
timer, a configurable Rule Engine decides whether a customer whose conversation went idle should be
re-engaged. `bms_conversations.last_sender_type` tracks who sent the most recent message
(`customer`/`staff`/`ai`) so the scheduler can tell "the customer already replied" without joining
`bms_messages`; a per-customer `followup_opt_out` flag (`bms_customers`) suppresses future
follow-ups entirely. Every AI-drafted follow-up records why it was sent (`message_goal`, e.g. Close
Sale/Recover Abandoned Cart) and is stored in `bms_messages` like a normal AI reply, tagged
`meta.followup`, so it appears in the same conversation thread. Six stop conditions — customer/staff
already replied, conversation closed, retry limit reached, customer opted out, rule disabled — are
**always enforced by the scheduler**, not something a rule can turn off. Managed at
`/admin/followup-rules` (`followup.manage`) and observed at `/admin/followup-queue`
(`followup.view`, seeded to Sales as read-only). As of 2026-08-11, the queue page also includes a
**heuristic opportunity score** (`HOT/WARM/COOL`) per job plus a lightweight analytics summary for
the last 30 days: sent/skipped/failed counts, reply rate after follow-up, order-after-follow-up
rate, top goals/intents, and a 7-day trend. These v2 metrics are intentionally heuristic and
observational: they help operators prioritize and review rule quality, but they do not yet replace
the scheduler's rule matching with a separate numeric scoring engine. See `CLAUDE.local.md` §
Follow-up Automation for what is still deliberately not implemented (multi-step workflow branching
and a full scoring/workflow model).

## Self profile

Separate from CRM customer records, staff/admin users now have a self-service profile page at
`/admin/profile` backed by `bmsMe`, `updateMe`, and `uploadAvatar`. This is for the logged-in
operator's own account metadata (name, phone, language, avatar, and UI theme preference) and does
not change customer records or tenant-wide user-role assignments. The UI theme is stored on
`users.theme_preference` as `system`, `light`, or `dark`, so it follows the user across devices
after login while public/signed-out pages continue to use the local cookie/storage fallback.
UI language works the same way via `users.language` (`th`/`en`), synced into the browser's `lang`
cookie on login and re-applied with a page refresh (language, unlike theme, is resolved
server-side to pick an i18n dictionary, so it needs that refresh rather than a client-only toggle).
The setting only changes pages wired to the i18n dictionary. As of 2026-08-13 that is every public
marketing/auth page, the storefront, the checkout, the nav chrome, and 48 of 78 admin pages; the
remaining admin files are layout/loading guards and English-only legacy platform pages rather than
untranslated Thai. See [AGENTS.md](../../AGENTS.md) § i18n coverage for the current breakdown, and
re-run the audit there instead of trusting a percentage written in prose. New accounts default to
Thai (migration `7.81`).
