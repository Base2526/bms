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

Staff can also reply manually from the Inbox UI (`sendStaffMessage`) — this pushes via LINE the
same way, and is one of the few channels where outbound delivery status (`SENT`/`FAILED`) is
meaningful, since LINE actually reports push failures (see [../business/crm.md](../business/crm.md)).
