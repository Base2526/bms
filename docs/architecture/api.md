# API Surface

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Architecture overview: [system.md](system.md)

Two API layers exist side by side, both calling into the same `lib/bms/*.ts` services:

- **REST** (`apps/web/app/api/bms/*`) — channel webhooks (public, per-tenant), a couple of
  debug/curl-testable endpoints, and legacy per-status order-transition routes.
- **GraphQL** (`apps/web/graphql/bms*.ts`, wired into `graphql/resolvers.ts` + `graphql/typeDefs.ts`)
  — the primary API the admin UI (`/admin/*`) talks to.

## REST — channel webhooks

One route per channel, all shaped `POST /api/bms/{channel}/webhook/[tenantId]`:

| Channel | Route | Signature verification |
| --- | --- | --- |
| LINE | `line/webhook/[tenantId]` | `X-Line-Signature` (`verifyLineSignature`) |
| TikTok | `tiktok/webhook/[tenantId]` | inline HMAC-SHA256 hex header |
| Facebook | `facebook/webhook/[tenantId]` | `X-Hub-Signature-256` (`verifyMetaSignature`) + `GET` challenge |
| Instagram | `instagram/webhook/[tenantId]` | `X-Hub-Signature-256` (`verifyMetaSignature`) + `GET` challenge |
| Web | `web/webhook/[tenantId]` | none (public widget) — rate-limit + CORS only |
| Shopee 🧪 | `shopee/webhook/[tenantId]` | placeholder HMAC — **not verified against real API docs** |
| Lazada 🧪 | `lazada/webhook/[tenantId]` | placeholder HMAC — **not verified against real API docs** |

Details per channel: [../integrations/](../integrations/).

## REST — cron endpoints

Protected by header `x-cron-secret` matching env `BMS_CRON_SECRET` (skipped if unset — fine for
dev, must be set in production). Neither has a schedule wired up yet; both expect an external cron
(GitHub Actions, system crontab, etc.) to `POST` them on an interval.

- `POST /api/bms/orders/release-expired?minutes=30` — cancels `RESERVED` orders older than N
  minutes, releasing their stock reservation. `lib/bms/orders.ts` `releaseExpiredOrders()`.
- `POST /api/bms/channels/check-health` — flags channels with no inbound webhook event in
  `NO_EVENTS_THRESHOLD_DAYS` (3) days as `no_events`. `lib/bms/channelHealth.ts` `detectStaleChannels()`.
  Doesn't need to run more than daily — the threshold is in days, not minutes.

## REST — debug / test endpoints

- `POST /api/bms/chat` — run the AI pipeline on a message and return the full trace (intent,
  tool, reply) without logging to inbox. Used by the Playground admin page.
- `POST /api/bms/order` — create an order directly via curl, bypassing chat. Both endpoints
  validate `channel` against a local allowlist that must be kept in sync with `lib/bms/pipeline.ts`'s
  `Channel` type (see the lesson recorded in [CLAUDE.local.md](../../CLAUDE.local.md) about channel
  arrays being duplicated in several places).
- `POST /api/bms/products/upload` — product image upload endpoint used by `/admin/products`
  before saving the product form. It stores files first, then the product save mutation decides
  which uploaded image becomes `image_url` (cover) and which remain in the gallery.

## REST — order/payment/purchase/shipment transition routes

Thin per-action routes (`order/[id]/pay`, `/pack`, `/ship`, `/complete`, `/cancel`, `/return`;
`payment/[id]/confirm|reject|refund|verify`; `purchase/[id]/receive|cancel`;
`shipment/[id]/status|tracking|label`) — these predate the GraphQL admin UI and call the exact
same `lib/bms/*.ts` functions the GraphQL mutations use. `reports/*` and `inbox/*` similarly expose
read/write REST equivalents of their GraphQL counterparts.

## GraphQL modules

| File | Covers |
| --- | --- |
| `bmsProducts.ts` | products, categories, stock adjustments |
| `bmsOrders.ts` | order lifecycle transitions, reorder |
| `bmsCustomers.ts` | CRM: profile, addresses, tags, merge |
| `bmsInbox.ts` | conversations, messages, notes, timeline |
| `bmsChannels.ts` | per-tenant channel credentials (settings page) + Channel Health status/test (`bmsChannelHealth`, `bmsChannelHealthCount`, `bmsTestChannel`) |
| `bmsPurchase.ts` | supplier purchase orders |
| `bmsPayments.ts` | payment submission/confirmation/refund |
| `bmsShipping.ts` | shipments, tracking, labels |
| `bmsReports.ts` / `bmsDashboard.ts` | read-only analytics |
| `bmsSaas.ts` | platform admin: tenants, plans, signup, drill-down |

Most resolvers follow the same shape: `requirePermission(ctx, "<resource>.<action>")` →
`getTenantId(ctx)` → call the matching `lib/bms/*.ts` function → optionally `audit(ctx, ...)`.
The permission catalog lives in `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) and is read
dynamically by the `/admin/permissions` UI — adding a permission there does not require touching
any frontend permission list. `bmsChannels.ts` is a deliberate exception: it gates with a plain
`requireTenantAdmin(ctx)` (any admin role in the tenant) instead of a `BMS_PERMISSIONS` entry — no
permission was ever added for channel config, so Channel Health reuses the same gate rather than
introducing one just for itself.

## Auth scopes

`requireAuth(ctx)` (`lib/auth.ts`) recognizes three scopes carried via the `x-scope` header on the
GraphQL endpoint (`app/api/graphql/route.ts`): `admin` (cookie session, the BMS admin panel),
`web`, and `android` (Bearer token — pre-existing infra for a consumer-facing mobile app from the
base template, distinct from the BMS admin/staff RBAC model). See
[system.md](system.md) for how tenant/RBAC context is derived once authenticated.

## Operational list search

The admin UI now relies on server-backed search for the main operational tables:

- `bmsOrders(search, status, limit, offset)`
- `bmsPurchaseOrders(search, limit, offset)`
- `bmsPayments(search, orderId, status, limit, offset)`
- `bmsShipments(search, orderId, status, limit, offset)`
- `bmsCustomers(search, limit, offset)` (existing)

UI callers debounce the input, then re-run the GraphQL query. Search is intentionally implemented
at the resolver/service layer rather than as a client-only table filter so results remain correct
when the dataset is larger than the currently loaded page.

## Public/self-service GraphQL surfaces

- `bmsPublicPlans` powers the public landing page pricing cards.
- `bmsSignup` powers `/shop-signup`.
- `bmsMe`, `updateMe`, and `uploadAvatar` power `/admin/profile` and other self-profile surfaces.
