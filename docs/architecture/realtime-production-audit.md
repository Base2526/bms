# Production realtime audit and delivery plan

> Status: audit and design only (2026-09-10)
>
> Audited revision: `4e77c48d` on branch `audit/realtime-production-architecture`
>
> Decision record: [ADR 001 — transactional invalidation events](decisions/001-transactional-realtime-invalidation.md)

This document records the current WebSocket implementation, its security and reliability gaps, the
target event matrix, and the Phase 1 hardening plan. It does not claim that the target architecture
has been implemented. Database and backend services remain authoritative; realtime messages are
invalidation hints that cause clients to re-read the existing GraphQL or REST APIs.

## Executive finding

The current Redis-backed GraphQL subscription path is useful for Inbox invalidation and a handful of
community multi-device features, but it is not safe to expand to the rest of BMS yet. The highest-risk
findings are:

1. `bmsInboxChanged` falls back to the default BMS tenant and does not require `inbox.view`.
2. Chat subscriptions accept `chat_id` or `user_id` from the client without proving membership or
   binding the argument to the authenticated identity. `incomingMessage` can therefore be aimed at a
   different user's feed.
3. The gateway authenticates the JWT only when an operation starts. It does not check Redis session
   revocation, refresh role/account/tenant state, revalidate acting-tenant state, or disconnect at
   token expiry.
4. The socket schema permits query and mutation operations. The production schema includes the
   debug `Mutation.send`, so the gateway is not subscription-only.
5. `deleteMessage` publishes from inside its database transaction. Its subscription also listens on
   a different topic from the publisher and its filter calls `payload.asyncIterator`, so delivery is
   broken even when the transaction commits.
6. There is no origin allowlist, connection/subscription/message-size quota, idle timeout, health or
   readiness endpoint, graceful drain, or realtime delivery metrics.
7. Direct Redis Pub/Sub has no replay. Most events have no stable event ID, schema version, aggregate
   version, cursor, gap detection, or durable retry. Publish failure after a successful commit loses
   the invalidation until polling or focus-driven reconciliation happens.
8. Orders, payments, inventory, purchase receiving, shipping, restaurant operations, and pharmacy
   case status have no BMS domain subscriptions at all.

Polling must remain enabled while these gaps are closed. The first production milestone is a secure,
bounded gateway with the current fallbacks intact, followed by a shared event contract and
transactional outbox in shadow-publish mode.

## Current topology

```text
web mutation / webhook
  -> PostgreSQL write (sometimes a transaction, sometimes several autocommit statements)
  -> direct Redis Pub/Sub publish
  -> apps/ws GraphQL subscription resolver
  -> browser callback
  -> cache patch or authoritative GraphQL refetch

Recovery today
  -> page-specific polling, focus refresh, or manual refresh
```

`apps/web/lib/pubsub.ts` re-exports the singleton in `packages/realtime/src/pubsub.ts`, so web and the
gateway use the same Redis channels across instances. `apps/ws` has no PostgreSQL dependency and must
stay that way. The package currently centralizes only the RedisPubSub instance; most topics, payload
types, authorization rules, and logging behavior live elsewhere.

## Existing subscription inventory

The handshake requires some valid JWT, but that alone is not resource authorization. “None” in the
authorization column means no resolver-level ownership or permission check exists.

| Subscription | Redis topic | Publisher / transaction boundary | Client consumer | Intended scope | Resolver authorization | Finding |
| --- | --- | --- | --- | --- | --- | --- |
| `time` | `TIME_TICK` | No active publisher; only commented code | None found | debug/public | None beyond handshake | Dead debug field; remove from production schema. |
| `messageAdded(chat_id)` | `MSG_CHAT_{chat_id}` | `sendMessage`; after `runInTransaction` resolves | `/chat` | chat members | None; topic comes directly from client `chat_id` | Critical resource-membership gap; payload is the full message and may include user/contact/file metadata. |
| `userMessageAdded(user_id)` | `MSG_USER_{user_id}` | No publisher found | `GlobalChatListener` | one user | None; topic comes directly from client `user_id` | Dead today, but immediately unsafe if a publisher is added. Replace with a server-derived user topic. |
| `messageDeleted(chat_id)` | Subscribes `MSG_USER_{chat_id}`; publisher uses `MSG_CHAT_{chat_id}` | `deleteMessage`; **inside** `runInTransaction` before commit | `/chat` | chat members | None; client controls `chat_id` | Broken topic and filter; can publish a deletion that later rolls back. |
| `notificationCreated` | global `NOTIFICATION_CREATED` | `createNotification`; after its own autocommit insert, but parent workflow boundary can differ | global failure/order/mention notifiers | one user | Payload `user_id` compared with JWT identity | Scope check exists, but every socket wakes; payload carries title/message/data and has no envelope/dedup cursor. |
| `commentAdded(post_id)` | global `COMMENT_ADDED` | add/reply comment; after autocommit insert | `CommentsSection` | viewers of a post | Client `post_id` only; no post visibility check | Content is broadcast through a global topic and filtered without access control. |
| `commentUpdated(post_id)` | global `COMMENT_UPDATED` | update comment; after autocommit update | None found | viewers of a post | Client `post_id` only | Unused and lacks visibility authorization. |
| `commentDeleted(post_id)` | global `COMMENT_DELETED` | delete comment; after autocommit delete | None found | viewers of a post | Filter always returns true; payload has no `post_id` | Every authenticated subscriber can receive every deletion ID. |
| `incomingMessage(user_id)` | global `INCOMING_MESSAGE` | `sendMessage`; after commit | `GlobalChatListener` | sender and recipients | Uses client `user_id`; never compares it with JWT identity | Critical cross-user subscription gap; the publisher's `targetUserIds` is not used by the filter. |
| `myPhoneBlockStatusChanged` | `MY_PHONE_BLOCK_{JWT user}` | block/unblock; after transaction commit | `GlobalChatListener` | one user | Topic and payload user are bound to JWT identity | Best current pattern, but payload exposes a phone value and lacks event ID/version/replay. |
| `myBankBlockStatusChanged` | `MY_BANK_BLOCK_{JWT user}` | report/unreport; after transaction commit | `GlobalChatListener` | one user | Topic and payload user are bound to JWT identity | Same strengths and gaps as phone sync; account data should not be logged. |
| `myBookmarkStatusChanged` | `MY_BOOKMARK_{JWT user}` | bookmark/unbookmark; after transaction commit | `GlobalChatListener` | one user | Topic and payload user are bound to JWT identity | Cache patch plus debounced refetch; no reconnect reconciliation owned by a shared layer. |
| `myContactSpamMarkChanged` | `MY_CONTACT_SPAM_MARK_{JWT user}` | mark/unmark; after transaction commit | None found | one user | Topic and payload user are bound to JWT identity | Safe topic derivation, currently unused; payload contains a phone key. |
| `myContactSpamSettingsChanged` | `MY_CONTACT_SPAM_SETTINGS_{JWT user}` | settings update; after transaction commit | None found | one user | Topic and payload user are bound to JWT identity | Safe topic derivation, currently unused. |
| `bmsInboxChanged` | `BMS_INBOX_CHANGED:{tenant}` | Inbox services and diagnostics; generally after the last successful statement, but many workflows use multiple autocommit statements | admin Inbox and global Inbox notifier | tenant, then conversation visibility on refetch | Requires admin-shaped scope/id only; no `inbox.view`; default tenant fallback | Payload is appropriately small, but tenant and permission enforcement are not production-safe and delivery is not atomic with the write set. |

### Publisher call-site groups

| Publisher group | Current behavior | Boundary assessment |
| --- | --- | --- |
| Community `sendMessage` | Publishes `messageAdded` and `incomingMessage` after `runInTransaction` returns | After commit, but publish failure can fail an already-committed mutation response and there is no retry. |
| Community `deleteMessage` | Publishes inside the transaction callback | Before commit; must be removed from the transaction and eventually replaced by an outbox row. |
| Comment mutations | Each write is an autocommit query followed by publish | After the individual write, no durable retry; parent notification and comment writes are not one transaction. |
| Notifications | Inserts and then publishes a full notification | After its own insert; callers may have a separate parent workflow. Global topic causes unnecessary fan-out. |
| Phone/bank/bookmark/contact-spam sync | Publishes after transaction helper resolves | Correct relative ordering, but best-effort/lost-on-failure and no standard envelope. |
| Inbox capture/assignment/status/read/reply/retry | Calls `publishInboxChanged` after successful statements | Usually after commit, but several logical operations span multiple autocommit statements, so the event does not prove one atomic aggregate transition. Fire-and-forget publishing is observable only through a rate-limited error log. |
| Inbox diagnostic emit | Publishes without a business write by design | Acceptable only as an explicitly gated diagnostic signal; it must remain unavailable in production schemas unless the diagnostic contract is retained securely. |

## Authorization and authentication audit

### HTTP versus WebSocket

HTTP admin GraphQL currently performs these checks on each request:

- verifies the admin cookie and JWT expiry;
- checks the Redis admin-session `jti` registry;
- reloads role, tenant, account existence, tenant activity, platform-admin status, and
  `admin_session_version` from PostgreSQL;
- validates the signed acting-tenant cookie and binds it to the current admin ID;
- loads tenant RBAC permissions on demand.

The WebSocket gateway instead verifies the JWT locally in `onSubscribe`, optionally applies the
signed acting-tenant cookie, and stores every decoded token under `contextValue.user`, including an
admin token. It does not create HTTP's `{ admin, user }` context shape. Consequences:

- logout/revocation does not close or block an existing socket;
- a demoted/deleted user or deactivated tenant keeps the JWT's old claims until expiry;
- an acting-tenant connection keeps receiving the old tenant after the browser changes drill-down;
- permission helpers cannot be reused as-is because admin identity is placed in `ctx.user`;
- token expiry is checked only when another subscription operation begins, not while an existing
  operation remains active;
- `x-scope` is supplied by the client and selects which cookie/bearer source the gateway reads.

The HTTP path itself still has a legacy default-tenant fallback in `getTenantId()` and
`authorizeAdminRoute()`. Phase 1 is scoped to removing fallback from WS authorization. A separate,
careful HTTP migration is required before changing those helpers because older admin flows may still
depend on them.

### Client-supplied resource identifiers

These fields create an iterator before proving the caller may see the requested resource:

- `messageAdded(chat_id)` and `messageDeleted(chat_id)` — no `chat_members` check;
- `userMessageAdded(user_id)` and `incomingMessage(user_id)` — argument is not bound to the JWT user;
- `commentAdded/Updated/Deleted(post_id)` — no post visibility check;
- `bmsInboxChanged` — no client resource argument, but tenant falls back and `inbox.view` is absent.

Because `apps/ws` must not query PostgreSQL, Phase 1 must not add database lookups to these
resolvers. User events should use topics derived only from authenticated context. Resource-scoped
subscriptions need a short-lived capability minted by HTTP after membership is checked, or should be
replaced by safe user/tenant invalidations whose authoritative refetch performs the resource check.

### Data exposure and logging

- `messageAdded` and `incomingMessage` carry full community messages, sender fields, images, audio,
  receipts, and file identifiers. They require strict chat membership before delivery.
- notification events can contain names, message excerpts, and arbitrary `data`; a global topic wakes
  every subscriber even though `withFilter` later selects one user.
- phone, bank, and contact-spam payloads contain sensitive identifiers. Current debug hooks can
  stringify the entire payload when `PUBSUB_DEBUG=1`.
- `messageAdded` and `incomingMessage` filters log payload/context. Invalid JWT logging also prints the
  error object. These logs are unsuitable for production.
- Inbox invalidation is the safest existing BMS payload: tenant ID, conversation ID, kind, source,
  optional message ID, and time. It contains no message text or customer PII.
- No pharmacy subscription exists today. Future pharmacy events must contain only case ID, safe
  status, time, and routing scope. Clinical notes, structured answers, evidence IDs, prescription
  images, medication suggestions, and free-text reasons are prohibited.

## Gateway and infrastructure gaps

| Control | Current state | Production requirement |
| --- | --- | --- |
| Origin validation | None | Exact allowlist; reject missing/foreign browser origins. Non-browser clients need an explicit client class, not an origin bypass guessed from User-Agent. |
| Operation type | Queries and mutations accepted | Parse once and accept exactly one `subscription` operation. Disable introspection/debug operations in production. |
| Connection init | 10-second timeout | Keep configurable; validate connection params and reject oversized/unknown auth shapes. |
| Connection quotas | None | Per IP, authenticated user, and tenant counters with bounded TTL/lease in shared Redis. |
| Subscription quota | None | Per-connection maximum and per-operation cost/field allowlist. |
| Message size | None | Enforce at HTTP upgrade/WebSocket frame and GraphQL document/variables boundaries. |
| Token lifetime | Checked when subscribing | Schedule close at ticket expiry and periodically recheck session/context version. |
| Keepalive/idle | Library defaults only | Explicit protocol ping/pong, pong deadline, and idle close. |
| Shutdown | None | Stop accepting upgrades, close/drain operations with a deadline, dispose GraphQL server, then close Redis clients. |
| Health | No endpoint/healthcheck | Liveness for process; readiness must fail when Redis cannot publish/subscribe because WS has no useful degraded mode without Redis. |
| Metrics | Connection logs only | Bounded counters/histograms for connection/auth/subscription/delivery/drop/reconnect/replay/latency/slow-consumer outcomes. |
| Container secret handling | `JWT_SECRET` is passed as Docker build ARG and ENV | Remove secret build ARG/ENV; inject only at runtime. Image history must not contain the signing key. |
| Redis replay | Pub/Sub only | Keep polling. Add bounded Redis Streams replay only after outbox and recovery tests exist. |

## Client coverage and recovery inventory

### Screens already using WS

- `/admin/inbox` subscribes to `bmsInboxChanged`, coalesces list refetches, refreshes the active
  conversation, and retains a 20-second list poll.
- `GlobalInboxNotifier` subscribes to the same event, deduplicates a bounded set in memory, then
  performs an authoritative `bmsConversation` lookup before alerting.
- `GlobalOrderNotifier`, `GlobalFailureNotifier`, and `GlobalMentionNotifier` subscribe to
  `notificationCreated`; this is notification delivery, not order/failure/mention domain-state
  invalidation.
- `/chat` consumes `messageAdded` and attempts to consume `messageDeleted` (currently broken).
- `GlobalChatListener` consumes `incomingMessage`, the unused `userMessageAdded`, and phone/bank/
  bookmark sync events. It batches some refetches and reconciles bookmarks on window focus.
- `CommentsSection` consumes only `commentAdded`; update/delete subscriptions have no client found.

### Explicit polling

| Surface | Current interval |
| --- | --- |
| Admin orders | 15 seconds |
| Admin Inbox list | 20 seconds |
| Pharmacy queue | 20 seconds |
| Follow-up queue | 15 seconds; retention 30 seconds |
| Dashboard widgets | 60–120 seconds |
| Admin/sidebar Inbox and mention badges | 30 seconds |
| Admin/sidebar channel/other health badges | 60–300 seconds |
| Header notification badge | 15 seconds |
| Public live dashboard widgets | 30 seconds |
| Inbox realtime diagnostics | 30 seconds |
| Mail-log stats | 60 seconds |
| Restaurant POS/KDS/floor/waitlist/QR/service calls | `useLiveRefresh` with visible/focused intervals; authoritative polling and visibility reconciliation |
| Retail POS parked bills | 20 seconds |
| Admin kitchen board | `useLiveRefresh`; bounded polling plus visible-tab recovery |

Products, payments, purchases, shipping, transfers/counts, restaurant floor configuration, reports,
users, roles, and many settings pages primarily update from their own mutation response and explicit
`refetch()` calls; they also expose manual refresh controls. They do not receive cross-device domain
invalidations today.

## Target BMS event matrix

The names below are accepted design names only where a matching workflow exists in the repository.
`approval.requested` and `approval.resolved` from the initial proposal are deferred: the codebase has
inline two-person POS authorization and assistant propose/confirm flows, but no durable generic
approval-request aggregate to emit those events truthfully.

All payloads use the shared envelope, carry identifiers/status enums only, and trigger an
authoritative refetch. Free-text notes, addresses, customer identity, payment details, clinical data,
and attachment/evidence IDs stay out of events.

| Domain events | Existing source-of-truth workflow | Scope | Subscriber authorization | Initial client invalidation |
| --- | --- | --- | --- | --- |
| `restaurant.check.created`, `restaurant.check.updated`, `restaurant.round.sent`, `restaurant.check.paid`, `restaurant.check.cancelled` | `restaurantPos.ts` open/add/send/settle/cancel transaction paths | branch | POS device ticket bound to branch; admin `order.view` plus allowed-location scope | floor, open check, order list, dashboard |
| `restaurant.ticket.created`, `restaurant.ticket.status_changed` | `restaurantPos.ts` ticket creation and `kitchen.ts` status transitions | branch | POS device + branch; admin `order.view` to read and `restaurant.kitchen.update` to mutate | POS KDS and admin kitchen queries |
| `restaurant.customer_request.created`, `restaurant.customer_request.accepted` | `restaurantRequests.ts` request creation and accept/reject flow | branch | POS device + branch; admin/order reader only where a matching reader exists | incoming-order queue, floor/order views |
| `restaurant.qr_submission.created`, `restaurant.qr_submission.status_changed` | `restaurantQrOrdering.ts` submit/accept/reject | branch | POS device + branch; customer never subscribes to staff queue | QR queue and floor/check |
| `restaurant.table_call.created`, `restaurant.table_call.status_changed` | `restaurantServiceCalls.ts` create/acknowledge/complete | branch | POS device + branch; restaurant operational reader | service-call badge/list |
| `order.created`, `order.status_changed`, `order.paid`, `order.cancelled`, `order.fulfillment_changed`, `order.line_cancelled` | `orders.ts`, `restaurantOrdering.ts`, `pos.ts` | tenant plus branch when `location_id` exists | `order.view` and allowed-location scope | order list/detail, customer 360, dashboard, KDS when applicable |
| `payment.submitted`, `payment.confirmed`, `payment.rejected`, `payment.refund_pending`, `payment.refunded` | `payments.ts` and POS refund allocation/settlement | tenant plus branch when payment belongs to a POS order | `payment.view`; branch scope inherited from order where present | payment list/detail, order detail, dashboard |
| `inventory.changed`, `inventory.reservation_changed`, `product.availability_changed` | order reservation/release/ship/return, POS settlement, adjustments, wastage | branch | `product.view` and allowed-location scope | product/stock lists, POS menu/search, dashboard |
| `inventory.transfer.sent`, `inventory.transfer.received` | `stockTransfers.ts` send/receive transactions | source and destination branches | `inventory.transfer` plus access to the relevant branch | transfer list and both branch inventories |
| `inventory.count.applied` | `stockCounts.ts` apply transaction | branch | `inventory.count` for readers; `inventory.count.apply` remains mutation-only | count detail and branch inventory |
| `purchase.received` | `purchase.ts` receiving transaction | branch | `purchase.view` plus branch scope | PO detail/list and branch inventory |
| `menu.unavailability_changed` | `menuAvailability.ts` manual/reset paths | branch | restaurant POS device + branch; admin `product.view` where exposed | restaurant menu and sold-out badges |
| `inbox.conversation_changed`, `inbox.message_created`, `inbox.assignment_changed`, `inbox.status_changed` | `inbox.ts` | tenant; optional target user for assignment/mention wake-up | `inbox.view`; authoritative query continues enforcing Sales ownership/helper visibility | Inbox list/detail, badges, alert lookup |
| `shipment.created`, `shipment.status_changed`, `shipment.booking_failed` | `shipping.ts` create/status/book/sync paths | tenant | `shipping.view` | shipment list/detail, order detail, dashboard |
| `pharmacy.case.created`, `pharmacy.case.status_changed`, `pharmacy.case.assigned` | `pharmacy/assessments.ts` transaction/state-machine paths | tenant; assigned user hint where applicable | `pharmacy.assessment.read`; assignment recipients still refetch through case visibility rules | pharmacy queue/detail and narrow badge |
| `notification.created` | `notifications/service.ts` | user | server-derived authenticated user only | notification badge/list and optional alert |
| `dashboard.invalidated` | coalesced derivative of committed order/payment/inventory/shipping/inbox events | tenant | permission of the dashboard query/widget being refreshed | only affected dashboard operations, debounced/throttled |

One business transaction may affect several aggregates. It may enqueue more than one event, but the
dispatcher and clients must tolerate duplicates. Inventory changes should be aggregated per
transaction/branch/product where practical so a 100-line sale does not create a refetch storm.

## Production gates versus deferrable work

### Required before any wider production subscription rollout

- remove default tenant behavior from WS and reject missing trustworthy tenant context;
- replace raw JWT-only admin sockets with HTTP-minted, short-lived WS tickets that contain freshly
  checked identity, permissions, location scope, session ID, and acting-tenant context;
- check revocation/context version during connection life and close at ticket expiry;
- bind user topics to authenticated identity and enforce permission/scope metadata before opening an
  iterator;
- disable unsafe legacy resource subscriptions or add a capability that proves resource membership;
- allow only subscription operations and remove debug `time`/`send` production exposure;
- add origin, connection, subscription, init-timeout, message-size, ping/pong, idle, health,
  readiness, redacted logging, and graceful-drain controls;
- retain all polling/focus/manual reconciliation;
- add deterministic security tests for cross-user, cross-tenant, branch, permission, revocation,
  expiry, acting-tenant, operation type, size, and pharmacy payload redaction.

### Required before claiming durable “realtime coverage”

- shared event envelope/type/topic/validation/permission package;
- tenant-owned transactional outbox, multi-instance-safe dispatcher, retry/dead-letter visibility,
  and observable lag;
- domain call-site installation after each real transaction boundary is understood;
- shared client provider with bounded dedup, stale-version handling, batched invalidation,
  reconnect/focus reconciliation, and tenant-change cleanup;
- shadow-publish comparison against authoritative query state;
- Redis/WS restart, dispatcher crash, rollback, duplicate/out-of-order, slow-consumer, and
  multi-instance integration tests.

### Can wait until after secure shadow publishing

- Redis Streams replay and cursor-resume UX;
- reducing polling frequency;
- domain-by-domain production enablement beyond internal/demo tenants;
- advanced per-event latency dashboards and large fan-out/load tuning;
- removal of legacy community subscriptions after their clients migrate.

Polling may be reduced only after replay/gap detection and recovery/load tests pass. Exactly-once
delivery is not a goal; the contract is at-least-once delivery with idempotent consumers and
authoritative reconciliation.

## Phase and commit plan

Each numbered item is intended to be a reviewable commit or small commit set that leaves the system
buildable and keeps current polling behavior.

### Phase 1 — secure the existing gateway (implemented 2026-09-10)

1. **Security contract tests first.** Add source-level and socket integration tests for operation
   type, unauthenticated access, user/topic binding, tenant fallback, `inbox.view`, revocation,
   expiry, acting-tenant switch, origin, limits, log redaction, and safe pharmacy fixture rejection.
2. **Shared WS ticket contract.** Add a Next-independent package/helper for ticket claims,
   validation, cookie/scope-independent identity, permission/location snapshots, `jti`, context
   version, audience, issued/expiry time, and safe error codes. HTTP adapters mint tickets only after
   the same fresh identity/revocation/acting-tenant checks used by GraphQL HTTP. Do not put raw
   session cookies into browser-readable storage.
3. **Gateway context and lifecycle.** Accept only a short-lived ticket, reject missing tenant claims
   for tenant events, schedule expiry close, recheck Redis session/context version, dispose the old
   connection on logout or acting-tenant change, and keep `apps/ws` database-free.
4. **Subscription authorization.** Centralize field-to-scope/permission metadata. Bind user topics to
   ticket user; require `inbox.view`; enforce allowed branch IDs. Disable insecure chat/comment/debug
   fields in production until membership-safe replacements exist. Move `messageDeleted` publish out
   of its transaction even during the transition.
5. **Protocol and network bounds.** Subscription-only validation, exact origin allowlist, IP/user/
   tenant connection quotas, subscriptions per connection, max frame/document/variables size,
   configurable init/idle/ping/pong deadlines, and slow-consumer close policy.
6. **Operations.** Redacted structured logs, liveness/readiness endpoint, Redis readiness probe,
   SIGTERM/SIGINT drain, metrics, container healthcheck, and all new environment keys in base/dev/prod
   compose blocks for every service that reads them. Remove `JWT_SECRET` from Docker build args.
7. **Browser and recovery verification.** Exercise community chat, notifications, Inbox desktop and
   mobile, logout, acting-tenant change, offline/reconnect, and Redis/WS restart. Polling remains on.

Proposed Phase 1 change set:

| File or area | Planned responsibility |
| --- | --- |
| `packages/realtime/src/wsTicket.ts` and package exports | Next-independent ticket claims, signing/verification, audience, expiry, safe error codes, and test fixtures |
| `apps/web/lib/bms/realtimeAuth.ts` and a guarded `app/api/bms/realtime/ticket/route.ts` | Reuse fresh HTTP admin identity, revocation, acting-tenant, permission, and allowed-location checks before minting a short-lived ticket |
| `apps/ws/src/ws.ts`, `shared.ts`, plus focused config/health modules | Ticket-only context, subscription-only validation, scope authorization, origin/size/quota/lifecycle controls, redacted logs, health/readiness, and graceful drain |
| `packages/graphql-core/src/typeDefs.ts`, `resolvers.ts`, `bmsInboxSync.ts` | Require the central subscription context, bind user/tenant topics to it, require `inbox.view`, and remove or production-disable unsafe debug/resource subscriptions |
| `apps/web/lib/apollo.ts` and session/tenant lifecycle callers | Fetch/refresh the ticket, use bounded retry with jitter, dispose on logout/acting-tenant change, and keep current query/poll recovery |
| `apps/ws/Dockerfile` and all three compose files | Runtime-only secrets, healthcheck, and every WS environment control in each service that reads it |
| `scripts/realtime-ws-security-contract.test.mts` plus socket integration fixtures | Cross-user/tenant/branch/permission, revocation/expiry, operation/size/origin, redaction, and reconnect assertions |

Exact module boundaries may be adjusted to reuse an existing helper cleanly, but Phase 1 must not add
PostgreSQL to `apps/ws`, change a business mutation to WS, or remove a polling path.

Implementation status: the HTTP ticket route now performs strict Redis session validation, fresh
admin identity, signed acting-tenant validation, current permissions, and location-scope loading.
The gateway accepts only that short-lived ticket, rechecks admin revocation, closes at expiry, and
enforces scoped connection leases, operation/message limits, production field restrictions, origin,
ping/pong, slow-consumer, health/readiness, metrics, and graceful drain. `bmsInboxChanged` has no
tenant fallback and requires `inbox.view`; user feed arguments are bound to the ticket subject. The
legacy chat/post resource subscriptions are production-disabled until an HTTP-minted membership
capability replaces their client-selected IDs. Polling remains unchanged.

### Phase 2 — central event contract

Create `packages/realtime` modules for the versioned envelope, closed event-type union, validation,
topic builders, safe log projection, event-to-permission metadata, fixtures, and publish APIs. Raw
`pubsub.publish("string", payload)` becomes forbidden outside the package.

### Phase 3 — transactional outbox

Add a new idempotent migration for `bms_realtime_outbox`. The proposed schema and dispatcher contract
are in ADR 001. Start with shadow publishing for one low-risk domain while existing direct Inbox and
community events continue unchanged.

The proposed implementation files are a newly numbered
`db/migrations/<next>__bms_realtime_outbox.sql`, `apps/web/lib/bms/realtimeOutbox.ts`, a web/worker-side
dispatcher module and cron-authorized adapter, shared envelope/topic modules in `packages/realtime`,
and focused migration/dispatcher contract tests under `scripts/`. The migration number is deliberately
unassigned until implementation so it cannot collide with work merged before Phase 3 begins.

### Phase 4 onward — domain coverage, shared client, observability, rollout

Install events one domain at a time, beginning with Inbox migration and restaurant KDS because both
already have bounded recovery polling. Add the shared client invalidation provider, then proceed
through shadow/internal/demo/canary/all-tenant rollout. Feature flags and a query-only kill switch
must exist before any production tenant opt-in.

## Verification checklist for this audit phase

- [x] Enumerated every subscription field in `packages/graphql-core`.
- [x] Located every executable `pubsub.publish` call under `apps/` and `packages/`.
- [x] Located current React subscription consumers.
- [x] Compared HTTP and WS authentication/context construction.
- [x] Reviewed explicit polling and operational reconciliation paths.
- [x] Reviewed Redis, multi-instance, POS/restaurant, tenancy/RBAC, and pharmacy invariants.
- [x] No implementation or migration is claimed by this document.
