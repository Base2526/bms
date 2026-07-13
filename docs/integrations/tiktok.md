# TikTok Shop / TikTok Chat

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Other channels: [line.md](line.md) · [lazada.md](lazada.md) · Pipeline: [../ai/workflow.md](../ai/workflow.md)

**Status: ✅ webhook implemented — send API is roadmap.**

- Route: `POST /api/bms/tiktok/webhook/[tenantId]` — [`route.ts`](../../apps/web/app/api/bms/tiktok/webhook/%5BtenantId%5D/route.ts)
- Signature verification: inline `HMAC-SHA256` hex digest against the shop's `channel_secret`,
  checked against the `x-tiktok-signature` (or `x-signature`) header — implemented directly in the
  route rather than through a shared crypto helper (unlike LINE/Meta).
- Rate limit: 120 req/min per tenant, same pattern as every other channel.

## Message flow

Parses `body.messages[]` as `{ user_id, content: { text } }`. For each message with non-empty text:
`runPipeline(text, "tiktok", tenantId, userId)` → `logConversation()`. There is a `// TODO(prod)`
marker where the reply would be pushed back via TikTok's Business Messaging API — **this is not
implemented yet**, so TikTok customers never receive an automatic reply, only the shop's staff
sees the conversation logged in Inbox and must reply through TikTok's own app/console directly.

Because there's no send API, TikTok is **not** in `channelSupportsPush()`
(`lib/bms/inbox.ts`) — outbound messages logged from the admin Inbox are marked `SENT` as soon as
they're persisted (no delivery confirmation possible), the same pattern used for Web/Shopee/Lazada.

This is the reference pattern the Shopee and Lazada webhook scaffolds were modeled on — see
[lazada.md](lazada.md) for what's still unverified there.
