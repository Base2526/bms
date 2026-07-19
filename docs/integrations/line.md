# LINE Official Account

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Other channels: [tiktok.md](tiktok.md) · [lazada.md](lazada.md) · Pipeline: [../ai/workflow.md](../ai/workflow.md)

**Status: ✅ Implemented** — webhook receive + reply + push all work end-to-end.

- Route: `POST /api/bms/line/webhook/[tenantId]` — [`route.ts`](../../apps/web/app/api/bms/line/webhook/%5BtenantId%5D/route.ts)
- Setup: each shop pastes this URL into their own LINE Developers Console; credentials (channel
  access token + channel secret) are entered on `/admin/settings` and stored encrypted in
  `bms_tenant_channels`.
- Signature verification: `X-Line-Signature` header, verified with the shop's `channel_secret` via
  `verifyLineSignature()` (`lib/bms/crypto.ts`). Requests failing verification get `401`.
- Rate limit: 120 req/min per tenant (`rateLimit()`), returns `429` with `retry-after` when exceeded.
- If the channel isn't configured/active for a tenant, the webhook still returns `200 ok` (skipped)
  so LINE doesn't retry-storm an unconfigured shop.

## Message flow

Only `type: "message"` text events are processed. For each: `runPipeline(text, "line", tenantId,
userId)` → `logConversation()` (best-effort, records both the incoming message and the AI's reply
in the Omnichannel Inbox) → if the shop's `access_token` is set and the event had a `replyToken`,
reply immediately via LINE's `reply` API (`pushLineReply`).

After the sale-critical Inbox write/reply path, the route also performs a best-effort LINE profile
sync using `GET /v2/bot/profile/{userId}`. The response is cached on
`bms_customer_identities` (`display_name`, `picture_url`, `status_message`, `language`,
`profile_synced_at`) and is used only as Inbox display fallback. It must not overwrite
staff-maintained CRM fields. The sync is TTL-gated and short-timeout, so a LINE profile outage,
blocked user, missing consent/friendship, or rate limit never prevents the message from appearing
in Inbox.

The same post-write path also syncs LINE OA/bot metadata via `GET /v2/bot/info` and caches it on
`bms_tenant_channels.extra` (`botDisplayName`, `botBasicId`, `botPictureUrl`, `botChatMode`,
`botInfoSyncedAt`). Inbox uses this cache to show which LINE OA/shop received the message, for
example `ทักจาก: LINE OA “Jachoei Shoes” @jachoei`. This is also cache-backed; do not call LINE bot
info APIs from Inbox rendering.

After the inbox write succeeds, `logConversation()` publishes a tenant-scoped
`bmsInboxChanged` event. Operators with the Inbox open refetch the changed list and, when selected,
the active conversation immediately. The payload does not contain message text or customer data;
the authenticated GraphQL queries remain the source of truth. A slower list poll is retained only
as recovery if the WebSocket connection misses an event.

Staff can also reply manually from the Inbox UI (`sendStaffMessage`) — this pushes via LINE the
same way, and is one of the few channels where outbound delivery status (`SENT`/`FAILED`) is
meaningful, since LINE actually reports push failures (see [../business/crm.md](../business/crm.md)).

## Customer profile display

LINE webhooks provide `source.userId`; display metadata is fetched separately from LINE Messaging
API. The Inbox list/header resolves customer display as:

```text
staff-maintained bms_customers.name
→ cached LINE display_name
→ raw LINE userId
```

Avatar display uses cached `picture_url` when available. Do not call LINE profile APIs from list
rendering or GraphQL read resolvers; all UI reads must use the cached identity profile.

Source/shop display uses the cached bot info from `bms_tenant_channels.extra`:

```text
customer: LINE profile display_name / picture_url
source:   LINE OA botDisplayName / botBasicId / botPictureUrl
```

## Diagnostics

Administrators can use `/admin/inbox/realtime-diagnostics` to test the LINE lane without messaging
a real LINE user. `Emit` validates only the internal realtime signal. `Create Msg` creates a
diagnostic Inbox message for channel `line`, but it does not call LINE reply/push APIs; a real LINE
webhook test is still required to validate LINE signature, reply token, and platform delivery.
