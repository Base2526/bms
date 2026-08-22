# Lazada (and Shopee) — beta scaffold

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Other channels: [line.md](line.md) · [tiktok.md](tiktok.md) · Pipeline: [../ai/workflow.md](../ai/workflow.md)

**Status: 🧪 beta — config/UI/type layer works today; webhook parsing is an unverified placeholder.**

Lazada and Shopee were added as new channels in the same session, following the exact same pattern,
so this doc covers both.

## What's fully wired (usable now)

- `Channel` type includes `"lazada"` / `"shopee"` — [`lib/bms/pipeline.ts`](../../apps/web/lib/bms/pipeline.ts), [`lib/bms/channels.ts`](../../apps/web/lib/bms/channels.ts)
- Settings UI (`/admin/settings`) has connect cards for both, storing encrypted access
  token/channel secret in `bms_tenant_channels` exactly like every other channel.
- Channel color tags, GraphQL `ALLOWED` allowlist, dev fake-data seeders, and the debug
  `/api/bms/chat` and `/api/bms/order` endpoints all recognize both channel values.

## What is NOT verified (do not treat as production-ready)

- Routes: `POST /api/bms/lazada/webhook/[tenantId]` and `POST /api/bms/shopee/webhook/[tenantId]`
  ([`lazada/route.ts`](../../apps/web/app/api/bms/lazada/webhook/%5BtenantId%5D/route.ts),
  [`shopee/route.ts`](../../apps/web/app/api/bms/shopee/webhook/%5BtenantId%5D/route.ts)) are
  modeled on the TikTok pattern — HMAC-SHA256 over the shop's `channel_secret` — but **real Lazada
  Open Platform and Shopee Open Platform webhooks use OAuth + `partner_key`/`app_secret` with their
  own parameter-ordering signature scheme, not this**. Every `TODO(prod)` comment in these two files
  marks a guess that needs checking against the real API docs before going live.
- `parseLazadaMessages()` / `parseShopeeMessages()` guess field names (`content.text`,
  `buyer_id`/`from_id`) — never verified against a real payload.
- No send API — replies logged from the admin Inbox are never actually pushed to the customer on
  Lazada/Shopee (same limitation as TikTok, see [tiktok.md](tiktok.md)). Neither channel is in
  `channelSupportsPush()` (`lib/bms/inbox.ts`), so outbound messages are marked `SENT` immediately
  on persist with no delivery confirmation possible.

## Channel Health status caveat

Both webhook routes now report into the shared Channel Health system
([`lib/bms/channelHealth.ts`](../../apps/web/lib/bms/channelHealth.ts)) — a `webhook_failed` badge on
Shopee/Lazada in `/admin/settings` most likely means the **placeholder HMAC scheme rejected a real
platform payload** (see above — real signature scheme is unverified), not necessarily that the shop
owner typed the wrong secret. Don't treat that badge as a config error the way you would for
LINE/Facebook/Instagram until the signature verification is rewritten against real docs. Neither
channel reports `send_failed` (no send API exists yet to fail).

## Diagnostics

`/admin/inbox/realtime-diagnostics` supports `shopee` and `lazada` rows so admins can test the
shared Inbox realtime path. `Emit` validates only the internal PubSub/WebSocket signal. `Create
Msg` creates diagnostic Inbox rows for the selected channel, but it does not validate Shopee/Lazada
payload parsing, signature verification, OAuth behavior, or chat send APIs. The beta caveats above
still apply.

## Before using in production

1. Get the real Lazada Open Platform / Shopee Open Platform webhook + signature documentation.
2. Rewrite the signature verification block in both route files to match the real OAuth/HMAC scheme.
3. Rewrite `parseLazadaMessages()` / `parseShopeeMessages()` against real payload samples.
4. Implement a send API for at least one direction of reply, then add the channel to
   `channelSupportsPush()`.
