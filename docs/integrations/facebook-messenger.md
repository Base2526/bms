# Facebook Messenger

Facebook Messenger uses the same customer AI runtime and Inbox as LINE, but its credentials and
webhook authority are Meta-specific. The database/backend remains the source of truth; the Page
message supplies only the tenant-bound customer identity and untrusted message content.

## Required Meta configuration

1. Create a Meta Business app, add Messenger, and connect the Facebook Page.
2. Generate a Page Access Token with the permissions required by the current Messenger Platform.
3. In BMS Settings → Channels → Facebook Messenger, save the Page Access Token, App Secret, numeric
   Facebook Page ID, and a random Webhook Verify Token of at least 32 characters. The Verify Token
   must be distinct from the App Secret.
   Read the Page ID from the connected Page row in Meta Messenger API Settings. A public
   `profile.php?id=...` URL can show a different number for the same Page.
4. Copy `/api/bms/facebook/webhook/<tenant-id>` from Settings into Meta's Callback URL and paste
   the same Verify Token. Subscribe the Page to `messages`, `message_echoes`, `message_deliveries`,
   `message_reads` and, when using the starter buttons below, `messaging_postbacks`.
5. Test the channel in Settings, then send a message from a non-admin Facebook account. Development
   mode is restricted to app roles; public traffic requires the appropriate Live-mode review and
   advanced access from Meta.

Never paste the App Secret into Meta's Verify Token field. The handshake token and payload-signing
secret have different purposes and independent rotation.

## Runtime contract

The public route is rate-limited and accepts no tenant from the body. It resolves the tenant from
the path, verifies the exact raw body, requires `object=page`, binds `entry.id` to the saved Page ID,
and stores a minimized event in `bms_channel_inbound_jobs` under the unique `message.mid` before AI
or Graph API I/O. It then runs the shared customer pipeline and Inbox persistence and sends through
`/{page-id}/messages` with `messaging_type=RESPONSE` only when a server-recorded inbound customer
event was durably received within the standard 24-hour window. Recovery does not reopen that window
by inserting a new Inbox row. The saved account ID must still match when queued work starts.

After the verified message is persisted, BMS also makes a best-effort User Profile API read for the
Page-scoped sender ID and caches the returned first/last name and profile picture on
`bms_customer_identities`. Inbox renders that cache without making provider calls. The cache refreshes
at most once per 24 hours and never overwrites a staff-maintained CRM customer name. A timeout,
permission error, malformed response or cache-write failure must not reject the webhook, suppress the
Inbox message, fail the customer reply, or turn the durable inbound job into `DEAD`; diagnostics are
stored on the identity and a failed read is retried after a short backoff. Meta profile-photo URLs
expire, so a successful cache is refreshed daily. The same bounded maintenance job backfills stale
Facebook identities (20 per scheduled run) so existing conversations do not have to wait for another
customer message. Page name, username and picture are cached in channel `extra` for the Inbox source
header; neither cache overwrites CRM customer data.

Verified webhook context is split by purpose. Customer messages retain only bounded reply-target,
quick-reply and ad-referral identifiers in the durable job. Echoes from Meta Business Suite are stored
as outbound Inbox messages and never enter the AI pipeline. Delivery/read events advance matching
outbound message status from `SENT` to `DELIVERED` to `READ`. All signal writes are tenant-scoped and
idempotent by Meta message ID; raw webhook payloads are never stored.

New work is processed immediately for chat latency. The `meta-inbound-process` scheduled job is
crash recovery: it can reclaim a lease only before the business pipeline starts. The shared
`channel-profile-sync` scheduled job refreshes bounded Facebook and LINE profile batches. Once effects have
started, an expired lease or unexpected failure becomes `DEAD` for manual review instead of risking
a duplicate order/reservation. The queue stores bounded message fields, not the full signed payload.
Lease ownership is fenced by the attempt number before effects start. Messages for one customer
are processed in queue order; expired uncertain work raises a failure incident for review.

## Operations and rotation

- `active` is the operator switch; Channel Health is observed connectivity.
- The Test button calls `/me` with the Page token and refuses a token whose Page ID does not equal
  the configured Page ID.
- Meta's `/me` read probe also requires `pages_read_engagement`. A Page token with only
  `pages_messaging` can still receive and send messages; a missing read permission makes the Test
  button report that it cannot verify Page details without changing health established by actual
  inbound/outbound traffic. Test one real message from an app-role account before App Review.
- Customer names and pictures come from the Messenger User Profile API using the Page-scoped sender
  ID and Page Access Token. Meta requires Advanced Access for the **Business Asset User Profile
  Access** feature for `id`, `name`, `first_name`, `last_name`, and `profile_pic`; add that feature to
  App Review before relying on profiles from non-role users. Receiving and replying successfully does
  not prove this separate profile read is permitted.
- `META_GRAPH_VERSION` defaults to `v26.0` in every Web compose environment. Upgrade it deliberately
  with contract and live sandbox tests before Meta sunsets it.
- Rotate a Page token or App Secret in Settings. Rotate the Verify Token in both BMS and Meta.
- Sends outside Meta's customer-service window fail closed. The application does not invent consent
  or use an unsupported message tag.

## Current boundary

This is manual per-tenant credential onboarding. A future shared-app OAuth flow must still persist
and verify the Page ID per tenant; a shared App Secret must never make the callback URL authoritative.
Business Suite message echoes are timeline evidence only: they do not assign a BMS staff owner,
invoke AI, create business actions or bypass the 24-hour response window. One tenant currently has
one Facebook channel row and therefore one configured Page; multi-Page shops require a separate
account-scoped channel model rather than overwriting this row.

## Rollout and Instagram compatibility

Apply migrations 10.104 and 10.106 before deploying: the shared channel service reads the Meta
account columns and the durable worker reads bounded `event_meta` context. The 10.106 application
code must not be deployed before that additive column exists. The shared 10.104 channel columns affect LINE
and other channels too. Existing Meta configurations require a separate Verify Token and account ID;
plan this configuration change alongside deployment. LINE credentials and identity routing are unchanged.
Instagram uses the Professional Account ID from the linked Page's `instagram_business_account.id`,
not the Facebook Page ID. Its Page-token connection test checks that linked account. This integration
uses Facebook Login / graph.facebook.com, not Instagram Login tokens.

## Two sales uses: BMS itself and each shop

Shop Pages default to `shop_commerce`: the existing customer pipeline reads only that shop's
catalog, prices, stock and permitted customer tools. The platform operator can designate BMS's own
Facebook Page using BOTH runtime values on Web:

- `BMS_FACEBOOK_PRESALES_TENANT_ID`: the BMS sales tenant that owns the Page connection.
- `BMS_FACEBOOK_PRESALES_PAGE_ID`: that Page's numeric ID, also saved in Channels.

Only an exact tenant + signed-webhook Page match selects `bms_presales`. Missing/invalid configuration
keeps commerce mode. Customer text, button titles, payloads and tenant-editable labels cannot select
the mode. The presales path reuses verified public BMS plans, capabilities and explicit sales-callback
intake; it does not create subscription payments or promise automatic activation. Do not put a shop
Page on the presales tenant. LINE routing remains unchanged; Instagram remains shop commerce.

## Ads with Send message and conversation starters

Create a Messenger-destination ad in Meta Ads Manager using the same connected Page. Configure its
greeting and starter questions in the ad's message template. This repository does not publish ads
or create their templates. Preview on Meta, send each starter and check BMS Inbox plus the Messenger
reply before publishing. A greeting shown when the chat opens does not itself trigger BMS AI.

For suggested questions/quick replies, send full text such as “ขอราคาแพ็กเกจ BMS” on the BMS Page,
or “ขอราคาสินค้า [ชื่อสินค้า]” on a shop Page. BMS preserves the actual message text. It does not yet
resolve an ad referral to a product: “ราคา” alone may require a clarifying question.

If configuring custom postback buttons, use only these supported payloads:

| Button | Payload | Meaning |
| --- | --- | --- |
| ราคา | `BMS_CHAT_PRICE` | Ask for prices |
| รายละเอียด | `BMS_CHAT_DETAILS` | Ask about products/services |
| สนใจซื้อ | `BMS_CHAT_INTERESTED` | Ask for steps and details before deciding |
| เริ่มสนทนา | `BMS_CHAT_START` | Ask for general information |

These payloads work for either Facebook purpose; the server-owned Page routing determines the AI.
They never confirm an order or payment. Unknown postbacks are ignored, not executed as commands.
Postbacks require a matching recipient and provider timestamp; a hash of Page, sender, timestamp and
payload deduplicates retries. Only Facebook postbacks are covered; Instagram retains message intake.
Avoid duplicate Meta instant/FAQ answers for the same prompts when BMS is responsible for the reply.
