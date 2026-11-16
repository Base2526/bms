# TikTok Shop / TikTok Chat

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Other channels: [line.md](line.md) · [lazada.md](lazada.md) · Pipeline: [../ai/workflow.md](../ai/workflow.md)

**Status: inbound-only webhook path implemented; outbound send API and automatic AI replies are not implemented.**

- Route: `POST /api/bms/tiktok/webhook/[tenantId]` — [`route.ts`](../../apps/web/app/api/bms/tiktok/webhook/%5BtenantId%5D/route.ts)
- Signature verification: inline `HMAC-SHA256` hex digest against the shop's `channel_secret`,
  checked against the `x-tiktok-signature` (or `x-signature`) header — implemented directly in the
  route rather than through a shared crypto helper (unlike LINE/Meta).
- Rate limit: 120 req/min per tenant, same pattern as every other channel.
- The signed request body has a 1 MiB streaming limit. Malformed UTF-8/JSON or a missing
  `messages[]` returns a client error before claiming an event.

## Message flow

Parses `body.messages[]` as `{ user_id, content: { text } }`. Text and media are saved as inbound
Inbox messages for staff. The route does not run the AI pipeline or perform business actions:
there is no send API to return an AI answer or ask the customer to confirm a proposed order.
Staff must answer through TikTok's own app/console. If Inbox persistence fails, the event claim
is released before any business effect so a provider retry can save the message.
The unsigned `/api/bms/tiktok/webhook` dev mock is disabled in production and follows the same
staff-only, no-AI behavior in development.

Because there's no send API, TikTok is **not** in `channelSupportsPush()`
(`lib/bms/inbox.ts`) — outbound messages logged from the admin Inbox are marked `SENT` as soon as
they're persisted (a saved Inbox record, not customer delivery), the same pattern used for
Web/Shopee/Lazada. The Inbox composer labels this action **Save in Inbox**.

This is the reference pattern the Shopee and Lazada webhook scaffolds were modeled on — see
[lazada.md](lazada.md) for what's still unverified there.

## Diagnostics

`/admin/inbox/realtime-diagnostics` can create a TikTok diagnostic Inbox message with `Create Msg`
so operators can confirm the Inbox realtime path. This does not prove TikTok platform delivery and
does not add a TikTok send API; TikTok remains inbound-only until the real Business Messaging send
integration is implemented.
