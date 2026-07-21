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
  tool, reply) without logging to inbox. Used by the Playground admin page; it requires the signed
  admin cookie and derives tenant from the session (including signed platform-admin drill-down),
  never from request JSON. Since AI tool-calling
  landed, `tool` is `"ai:tool-calling"` and the response includes a `trace[]` of which tools Claude
  actually called whenever the tenant has AI credentials; it only falls back to the old
  intent/tool/checkStock shape when there's no AI key or the shared quota is exhausted.
- `POST /api/bms/order` — create an order directly via curl, bypassing chat. Both endpoints
  validate `channel` against a local allowlist that must be kept in sync with `lib/bms/pipeline.ts`'s
  `Channel` type (see the lesson recorded in [CLAUDE.local.md](../../CLAUDE.local.md) about channel
  arrays being duplicated in several places).
- `POST /api/bms/products/upload` — product image upload endpoint used by `/admin/products`
  before saving the product form. It stores files first, then the product save mutation decides
  which uploaded image becomes `image_url` (cover) and which remain in the gallery.

## Admin diagnostics

- `/admin/inbox/realtime-diagnostics` is Administrator/platform-admin only. `Emit` publishes a
  tenant-scoped `bmsInboxChanged` invalidation event without writing DB rows; success is measured
  by the Realtime Probe receiving the event and showing latency, not by a new Inbox row. `Create
  Msg` creates a diagnostic inbox conversation/message for the current tenant and publishes the
  same realtime event, without sending anything to LINE/Meta/TikTok/Shopee/Lazada. See
  [../ui/inbox-diagnostics.md](../ui/inbox-diagnostics.md).

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
| `bmsInbox.ts` | conversations, messages, notes, timeline, diagnostic Inbox message creation (`bmsCreateInboxDiagnosticMessage`) |
| `bmsChannels.ts` | per-tenant channel credentials (settings page) + Channel Health status/test (`bmsChannelHealth`, `bmsChannelHealthCount`, `bmsTestChannel`) + realtime signal probe (`bmsEmitInboxDiagnosticEvent`) |
| `bmsPurchase.ts` | supplier purchase orders |
| `bmsPayments.ts` | payment submission/confirmation/refund |
| `bmsShipping.ts` | shipments, tracking, labels |
| `bmsRevisions.ts` | revision history list/detail/compare for products, orders, payments, and shipments |
| `bmsReports.ts` / `bmsDashboard.ts` | read-only analytics |
| `bmsSaas.ts` | platform admin: tenants, plans, signup, drill-down |
| `bmsAssistant.ts` | staff AI assistant (`bmsAssistant` mutation) — Claude tool-calling over `lib/bms/tools/catalog.ts`, filtered by the caller's RBAC; sensitive tools return a proposal instead of executing |

Most resolvers follow the same shape: `requirePermission(ctx, "<resource>.<action>")` →
`getTenantId(ctx)` → call the matching `lib/bms/*.ts` function → optionally `audit(ctx, ...)`.
The permission catalog lives in `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) and is read
dynamically by the `/admin/permissions` UI — adding a permission there does not require touching
any frontend permission list. `bmsChannels.ts` is a deliberate exception: it gates with a plain
`requireTenantAdmin(ctx)` (any admin role in the tenant) instead of a `BMS_PERMISSIONS` entry — no
permission was ever added for channel config, so Channel Health reuses the same gate rather than
introducing one just for itself.

### Revision history GraphQL

`bmsRevisions.ts` exposes the read-only revision browser used by `/admin/revisions`:

- `bmsRevisionHistory(kind, entityId, limit)` lists recent snapshots. `entityId` is a search string,
  not only an exact ID: products search `sku/name/barcode`; orders/payments/shipments search their
  id/status/reference fields.
- `bmsRevisionDetail(kind, revisionId)` returns one snapshot and its editor label.
- `bmsRevisionCompare(kind, fromRevisionId, toRevisionId)` returns field-level JSON diffs between
  two snapshots.

Each query gates through the matching read permission (`product.view`, `order.view`, `payment.view`,
or `shipping.view`) and tenant id from the authenticated admin context.

### Inbox realtime

The admin Inbox subscribes to `bmsInboxChanged` over the WebSocket gateway. Webhook processing
publishes a small tenant-scoped invalidation event after the conversation and its messages are
committed. The event contains only the conversation ID, change kind, and timestamp; the UI then
refetches through the normal `bmsConversations` / `bmsConversation` queries so existing RBAC and
tenant scoping remain authoritative. The first event refreshes immediately; sustained bursts are
coalesced to at most two list queries per second with a guaranteed trailing refresh. The existing
20-second conversation-list poll remains a recovery path for a missed socket event.

When `MESSAGES_CHANGED` targets the conversation currently open in Inbox, the browser clears that
conversation's unread state optimistically and persists `bmsMarkConversationRead` before it
refetches the authoritative list. This ordering prevents an older `unread` value from restoring the
card badge. A rendered-message guard and the 20-second list poll cover delayed or missed socket
events. Because Apollo normalizes list/detail conversation objects, the active list item's
`unread > 0` state is also observed directly rather than relying only on timestamp differences.
An operator therefore does not need to click the already-open conversation again.

The active chat pane treats a position within 120 pixels of the bottom as pinned. New messages keep
a pinned pane at the bottom, while a pane scrolled into older history preserves its position and
shows a local `ข้อความใหม่ N` jump control. Staff-originated sends always return to the bottom.
Deferred content resizing (for example an image finishing loading) follows the same pinned-state
rule, preventing attachments from either hiding the newest message or pulling an operator away
from older history.

LINE profile sync is a second, non-critical invalidation source. After the Inbox write/reply path,
the LINE webhook best-effort fetches the user's LINE display profile, stores it on
`bms_customer_identities`, then publishes `CONVERSATION_CHANGED` for any affected conversation so
open Inbox screens can replace the raw LINE userId with cached display name/avatar. This sync must
remain cache-backed and short-timeout; GraphQL read resolvers and React list rendering must never
call external profile APIs.

The same LINE webhook path best-effort syncs the receiving LINE OA/bot info into
`bms_tenant_channels.extra`. Inbox GraphQL exposes this cached channel source as
`sourceDisplayName`, `sourceHandle`, and `sourceAvatar`, allowing operators to see which OA/shop the
customer messaged without extra API calls during page rendering.

Diagnostics use the same subscription path. `Emit` intentionally uses a `diag:{channel}:{probeId}`
conversation ID that does not exist in `bms_conversations`; it validates PubSub/WebSocket delivery
only. `Create Msg` writes a real diagnostic conversation/message first, then publishes
`MESSAGES_CHANGED`, so the normal Inbox list should update immediately. The diagnostics matrix
keeps `IN real`/`OUT real` from Channel Health separate from `IN diag`, which is read from the
latest diagnostic message rows.

## Auth scopes

`requireAuth(ctx)` (`lib/auth.ts`) recognizes three scopes carried via the `x-scope` header on the
GraphQL endpoint (`app/api/graphql/route.ts`): `admin` (cookie session, the BMS admin panel),
`web`, and `android` (Bearer token — pre-existing infra for a consumer-facing mobile app from the
base template, distinct from the BMS admin/staff RBAC model). See
[system.md](system.md) for how tenant/RBAC context is derived once authenticated.

Public web pages are intentionally session-aware: when a browser already has an admin cookie, the
`web` scope may reuse that existing admin identity instead of forcing a separate `/login` session.
This keeps landing/self-service surfaces aligned with the active admin session while preserving the
explicit `admin` scope for `/admin/*` routes and RBAC-gated admin operations.

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
