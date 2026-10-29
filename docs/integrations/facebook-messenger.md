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
4. Copy `/api/bms/facebook/webhook/<tenant-id>` from Settings into Meta's Callback URL and paste
   the same Verify Token. Subscribe the Page to `messages`. Enable only additional fields the
   application actually handles.
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

New work is processed immediately for chat latency. The `meta-inbound-process` scheduled job is
crash recovery: it can reclaim a lease only before the business pipeline starts. Once effects have
started, an expired lease or unexpected failure becomes `DEAD` for manual review instead of risking
a duplicate order/reservation. The queue stores bounded message fields, not the full signed payload.
Lease ownership is fenced by the attempt number before effects start. Messages for one customer
are processed in queue order; expired uncertain work raises a failure incident for review.

## Operations and rotation

- `active` is the operator switch; Channel Health is observed connectivity.
- The Test button calls `/me` with the Page token and refuses a token whose Page ID does not equal
  the configured Page ID.
- `META_GRAPH_VERSION` defaults to `v26.0` in every Web compose environment. Upgrade it deliberately
  with contract and live sandbox tests before Meta sunsets it.
- Rotate a Page token or App Secret in Settings. Rotate the Verify Token in both BMS and Meta.
- Sends outside Meta's customer-service window fail closed. The application does not invent consent
  or use an unsupported message tag.

## Current boundary

This is manual per-tenant credential onboarding. A future shared-app OAuth flow must still persist
and verify the Page ID per tenant; a shared App Secret must never make the callback URL authoritative.
Meta Business Suite handover/echo synchronization is not an implemented source of BMS staff state,
so operators should reply from BMS Inbox when AI and human ownership must remain in one timeline.

## Rollout and Instagram compatibility

Apply migration 10.104 before deploying: the shared channel service reads its new columns for LINE
and other channels too. Existing Meta configurations require a separate Verify Token and account ID;
plan this configuration change alongside deployment. LINE credentials and identity routing are unchanged.
Instagram uses the Professional Account ID from the linked Page's `instagram_business_account.id`,
not the Facebook Page ID. Its Page-token connection test checks that linked account. This integration
uses Facebook Login / graph.facebook.com, not Instagram Login tokens.
