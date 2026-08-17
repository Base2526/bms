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

Events with a stable platform id are atomically claimed in `bms_inbound_events` before
`runPipeline()`. Retries return success without repeating AI or writes. Web Chat accepts
`messageId` or `Idempotency-Key`; message text is intentionally never used as a dedup key.

Details per channel: [../integrations/](../integrations/).

## REST — cron endpoints

Protected by header `x-cron-secret` matching env `BMS_CRON_SECRET` (skipped if unset — fine for
dev, must be set in production). None has a schedule wired up yet; each expects an external cron
(GitHub Actions, system crontab, etc.) to `POST` them on an interval.

- `POST /api/bms/orders/release-expired?minutes=30` — cancels `RESERVED` orders older than N
  minutes, releasing their stock reservation. `lib/bms/orders.ts` `releaseExpiredOrders()`.
- `POST /api/bms/channels/check-health` — flags channels with no inbound webhook event in
  `NO_EVENTS_THRESHOLD_DAYS` (3) days as `no_events`. `lib/bms/channelHealth.ts` `detectStaleChannels()`.
  Doesn't need to run more than daily — the threshold is in days, not minutes.
- `POST /api/bms/ai/check-health` — actively probes each shared AI provider/purpose combo and writes
  the result to `bms_ai_provider_health`. `lib/bms/aiConfig.ts` `testPlatformAiKey()`. Recommended
  hourly; DeepSeek/Qwen checks make a real (small-cost) request, not a bare ping.
- `POST /api/bms/reports/send-digest` — sends the DAILY/WEEKLY/MONTHLY sales digest (email/Slack/
  LINE) to every enabled tenant subscription whose scheduled hour/weekday/day-of-month matches now
  and whose current period hasn't already been sent. `lib/bms/reportDigest.ts` `runScheduledDigests()`.
  Idempotency comes from `last_period_key`, not cron frequency — safe to invoke hourly or more often
  without double-sending; recommended schedule is hourly.
- `POST /api/bms/jobs/report-run` — lets a job that runs *outside* this app (currently only the
  `daily-log-triage` GitHub Action) record its own outcome into the same run-history table as the
  four endpoints above. Not itself a job to schedule — it's the write-back path for one.
- `POST /api/bms/shipping/sync-carriers` — polls active configured Flash/Kerry shipments whose
  tracking is at least 15 minutes stale, with a bounded batch/concurrency. Recommended every
  15 minutes; unavailable adapters are skipped.
- `POST /api/bms/jobs/etax` — drives one pass of the e-Tax submission queue
  (`processEtaxQueue()`, `lib/bms/etax/queue.ts`), gated off by default
  (`ETAX_ENABLED`/`bms_store_profile.etax_enabled`). **Inconsistent with every route above**: it
  authenticates with header `x-job-token` against `BMS_JOB_TOKEN`, not `x-cron-secret`/
  `BMS_CRON_SECRET`, and it does not call `recordJobRun()` — so it has no run history on
  `/admin/operations-schedule`. Known gap, not the pattern to copy into a new cron route.

Every scheduled-work endpoint above (2026-08) records each invocation into `bms_job_runs`
(migration `7.55__bms_job_runs.sql`, `lib/bms/jobRuns.ts` `recordJobRun()`/`recordExternalJobRun()`)
so `/admin/operations-schedule` (platform-admin only) can show real last-run status/history instead
of only the source-derived "what this job is supposed to do" text it showed before. A new cron route
should wrap its work in `recordJobRun(jobName, "cron", () => ...)` rather than skip it, or that job
silently has no run history on the ops page.

- `POST /api/bms/followups/run` — Follow-up Automation MVP core: schedules new jobs for idle
  conversations that match an enabled rule, then processes due jobs (re-checks stop conditions live,
  drafts an AI follow-up, sends it, logs the result). `lib/bms/followups.ts` `runDueFollowups()`.
  Scans every tenant when called with no argument (this cron path); the GraphQL "run now" mutation
  passes its own tenant id instead — see `bmsRunFollowupsNow` below. The route records each invocation
  into `bms_job_runs` under `followups`; per-message outcomes remain in `bms_followup_history`.

## REST — signed customer checkout

- `GET /api/bms/checkout?t=<token>` returns the tenant/order-scoped checkout projection.
- `PATCH /api/bms/checkout` saves explicit recipient/phone/address changes without clearing omitted
  CRM fields.
- `POST /api/bms/checkout/payment` validates the signed token, configured receiving method, order
  state, and slip image before recording a `PENDING` payment.

These routes are intentionally public bearer-link endpoints, not admin APIs. The HMAC token binds
`tenantId`, `orderId`, and expiry; the browser cannot select a tenant, order total, or another
customer. Responses use `no-store`, the page uses `no-referrer`/`noindex`, and Lazada/Shopee writes
are rejected because Seller Center remains authoritative. Runtime signing uses
`BMS_CHECKOUT_SECRET` (all compose files inject it, defaulting to the deployment's `JWT_SECRET`);
production refuses to create or verify links when no secret is configured.

## REST — POS device surface

`/api/pos/*` uses `x-pos-device-token`; tenant and location always come from the hashed active-device
record. Read routes expose session, scan/search, and device-local recent/last sales. Mutating routes
also verify the selected cashier PIN and the action-specific RBAC permission:

- `POST /api/pos/shift` — open/close the device drawer; close is blocked by pending refund settlement.
- `POST /api/pos/sale` — server-resolved product/pack prices, multi-payment, idempotent atomic close.
- `POST /api/pos/return` — explicit `FULL`/`PARTIAL`, mandatory structured reason and idempotency key.
- `POST /api/pos/refund-settlement` — authorized confirmation of a pending non-cash refund reference.
- `GET /api/pos/scan|search|recent-sales|last-sale|session` — device-scoped operational reads.

The admin POS return reports use the signed admin cookie, derive the active tenant (including signed
platform drill-down), and require `report.view`; they never accept a tenant id in query parameters.
See [../business/pos.md](../business/pos.md) for the operator flow and go-live checklist.

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
- `POST /api/bms/reports/generate` — signed-admin, tenant-derived, curl-testable report export that
  calls `generateReport()` directly. Accepts `reportType`, `format`, optional `dateFrom`/`dateTo`,
  and `includeSummary`; requires `report.view`; used for scripting and debugging without going
  through GraphQL or AI tool-calling.
- `GET /api/bms/reports/download/[id]` — signed-admin, tenant-gated report download. It verifies the
  current tenant owns a `bms_generated_reports` row for the requested `file_id` before streaming the
  underlying `files` row from `STORAGE_DIR`; deliberately not interchangeable with `/api/files/[id]`.

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
| `bmsProducts.ts` | products, categories, stock adjustments, bulk CSV/XLSX product import (`bmsImportProducts`) |
| `bmsOrders.ts` | order lifecycle transitions, staff create/reorder, invoice projection, shipping-address eligibility |
| `bmsCustomers.ts` | CRM: profile, addresses, tags, merge |
| `bmsInbox.ts` | conversations, messages, notes, timeline, diagnostic Inbox message creation (`bmsCreateInboxDiagnosticMessage`) |
| `bmsChannels.ts` | per-tenant channel credentials (settings page) + Channel Health status/test (`bmsChannelHealth`, `bmsChannelHealthCount`, `bmsTestChannel`) + realtime signal probe (`bmsEmitInboxDiagnosticEvent`) |
| `bmsPurchase.ts` | supplier purchase orders |
| `bmsPayments.ts` | payment submission/confirmation/refund |
| `bmsShipping.ts` | shipments, tracking, carrier sync (`bmsSyncShipmentLive`), labels |
| `bmsCoupons.ts` | discount code CRUD + usage history (`bmsCoupons`, `bmsCouponRedemptions`) |
| `bmsRevisions.ts` | revision history list/detail/compare for products, orders, payments, shipments, and purchase orders (header + line items) |
| `bmsReports.ts` / `bmsDashboard.ts` | read-only analytics |
| `bmsReportEngine.ts` | generated report export history + on-demand XLSX/CSV/PDF generation (`bmsGeneratedReports`, `bmsGenerateReport`) |
| `bmsReportSchedule.ts` | sales digest subscription config + delivery history (own tenant: `bmsReportSubscription`/`bmsReportDeliveries`/`bmsUpsertReportSubscription`/`bmsSendTestReportNow`; platform-wide: `bmsReportSubscriptions`/`bmsReportDeliveriesForTenant`) |
| `graphql/resolvers.ts` (`createSupportTicket`, `bmsSupportTickets`, `bmsUpdateSupportTicket`) | public support intake + platform ticket review/status/comments |
| `bmsAiConfig.ts` | tenant BYOK key config + key tests (`bmsAiConfig`, `bmsSetAiKey`, `bmsRemoveAiKey`, `bmsTestAiKey`), AI usage/credit reporting (`bmsAiUsage`, `bmsAiUsageBreakdown`, `bmsAiUsageEvents`, `bmsAiCreditLedger`, `bmsAdjustAiCredits`), and platform-only provider health (`bmsAiProviderHealth`, `bmsAiProviderHealthCount`, `bmsCheckAllAiProviderHealth`, `bmsTestPlatformAiKey`) |
| `bmsSaas.ts` | platform admin: tenants, plans, signup, drill-down |
| `bmsAssistant.ts` | staff AI assistant (`bmsAssistant` mutation) — Claude tool-calling over `lib/bms/tools/catalog.ts`, filtered by the caller's RBAC; sensitive tools return a proposal instead of executing |
| `bmsPos.ts` | POS back-office: locations, devices/pairing tokens, cashier PIN/account-mode management, shift open/close, lot listing/reconciliation, VAT settings, tax document issuance, e-Tax queue status, product pack/barcode setup. Actual counter selling never goes through GraphQL — see `/api/pos/*` above |

Most resolvers follow the same shape: `requirePermission(ctx, "<resource>.<action>")` →
`getTenantId(ctx)` → call the matching `lib/bms/*.ts` function → optionally `audit(ctx, ...)`.
The permission catalog lives in `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) and is read
dynamically by the `/admin/permissions` UI — adding a permission there does not require touching
any frontend permission list. `bmsChannels.ts` is a deliberate exception: it gates with a plain
`requireTenantAdmin(ctx)` (any admin role in the tenant) instead of a `BMS_PERMISSIONS` entry — no
permission was ever added for channel config, so Channel Health reuses the same gate rather than
introducing one just for itself.

**User/staff management is a two-layer gate**, not a plain `requirePermission`. `requireUserAdmin()`
(`graphql/resolvers.ts`) fronts `users`/`user`/`upsertUser`/`uploadAvatar`/`deleteUser`/`deleteUsers`
and answers only "may this caller open the Users module?" — platform admin or tenant `Administrator`
short-circuit through, any other role needs `user.view` (reads) / `user.manage` (writes), seeded to
`Manager` for every tenant by migration `7.78`. *Which rows* the caller may touch and *which roles*
they may assign is a second, independent layer: `lib/bms/staffRoles.ts` defines a role rank
(`Administrator` 100 · `Manager` 60 · `Sales`/`Warehouse`/`Staff` 20 · `Subscriber` 0) and
`lib/bms/userAdmin.ts` enforces it server-side — a caller may only manage a role **strictly below**
its own. Three rules there are load-bearing and must not be relaxed:

1. the target's role is always re-read from Postgres, never taken from the request;
2. a row with `is_platform_admin` is untouchable regardless of rank (a platform admin is an ordinary
   `users` row carrying a `tenant_id`, so a low-ranked one sitting in the shop would otherwise be a
   password-reset takeover path);
3. the requested role is resolved against `roles` **before** any write and an unknown name is
   rejected — the DB trigger `trg_users_sync_role_and_role_id`
   (`db/migrations/001_normalize_roles_phase1.sql`) silently `INSERT`s a new global role row for
   unrecognized `users.role` text, so `upsertUser` writes `role_id` only and never raw role text.

Tenant-scoped callers cannot list or open platform-admin identities, even when such a row carries
their `tenant_id`. Mutations re-check and lock target rows, role rows, and the tenant quota inside
the same transaction as the write; batch deletes lock targets in stable UUID order and never choose
another member of the deletion batch as a conversation assignee. These checks close both cross-tenant
visibility and role/quota time-of-check-to-time-of-use gaps.

Because `/admin/permissions` itself stays behind `requireSuper` (`bmsDashboard.ts`), a `Manager`
can never grant `user.manage` to anyone — only the shop `Administrator` can, which also makes
unticking it the kill switch for this feature.

### Orders and Customer 360 Quick Actions

- `bmsCreateOrder(channel, customerRef, items)` requires `order.create`, derives the tenant and
  editor from the authenticated admin context, and delegates to `createOrder()` for atomic stock
  reservation and order creation.
- `bmsGenerateInvoice(orderId)` requires `order.view` and delegates to `generateInvoice()`. The
  result is computed from tenant-scoped order snapshots and is not persisted.
- `BmsOrder.hasShippingAddress` is a tenant-scoped eligibility field used by the Orders UI. It is
  not the only gate: `shipOrder()` and `createShipment()` independently enforce the same rule before
  moving non-marketplace orders from `PACKING` to `SHIPPED`. Lazada/Shopee are the only marketplace
  exemptions; TikTok is treated as TikTok Chat.

### Shipping carrier sync

`bmsBookShipmentLive(id)` and `bmsSyncShipmentLive(id)` require `shipping.update` and derive the
tenant from the authenticated admin context. Booking uses the shipment UUID as its idempotency key,
runs outside the inventory transaction, persists a retryable `carrier_booking_status`, and never
hides an unavailable/error result behind a successful manual fallback. Sync calls the registered
adapter with a 10-second boundary timeout, then re-locks the shipment and atomically stores normalized
events/status/source without status regression. `bmsShipmentTrackingEvents` requires `shipping.view`.

`POST /api/bms/shipping/sync-carriers` is the cross-tenant polling entrypoint, protected by
`x-cron-secret` and wrapped in `recordJobRun("carrier-tracking-sync", ...)`. Missing credentials and
unverified live adapters are typed/skipped rather than throwing or pretending the carrier accepted
the request. The endpoint is ready but unscheduled; recommended cadence is every 15 minutes.

### Membership & loyalty (`7.96`)

Reads (`bmsLoyaltySettings`, `bmsMembershipTiers`, `bmsMembers`, `bmsMember`, `bmsLoyaltyLedger`,
`bmsMembersExpiringPoints`, `bmsMemberDiscountPreview`) require `member.view`; enrolment and tier
review require `member.manage`; program settings and tiers require `loyalty.settings`; manual point
adjustment requires `loyalty.adjust` and a mandatory reason. The three report queries
(`bmsLoyaltyOutstanding`, `bmsLoyaltyActivity`, `bmsSalesByTier`) sit behind `report.view` because
outstanding points are an accounting liability, not a marketing statistic. All four permissions are
seeded by `7.96` to Manager, and `member.*` also to Sales and Cashier.

Like coupon redemption, earning and redeeming points are not resolver-level concerns. Redemption
happens inside `createOrder()` alongside `applyCouponInTx()`, and earning happens wherever an order
reaches `PAID` — `payOrder()`, `confirmPayment()`, the split-payment confirm, and
`finalizePosSale()` — so every caller gets it without opting in. Tier is re-evaluated after each of
those, outside the transaction, because a failed review must not undo a payment that already happened.

POS uses device-token routes rather than GraphQL: `GET /api/pos/member` (search, three-character
minimum so a till left open cannot page through the customer list), `POST /api/pos/member` (enrol,
requires cashier PIN plus `member.manage`), and `POST /api/pos/member/preview` (read-only discount
preview). The preview must agree with `createOrder()` to the satang or the register's payment rows
will not match the server total and the bill is voided — which is why the arithmetic lives in the
import-free `lib/bms/loyaltyMath.ts` and is covered by `scripts/loyalty-contract.test.mts`.

`POST /api/bms/loyalty/maintenance` (cron secret) expires points FIFO and re-reviews tiers for every
shop with the program on. It is idempotent, and `.github/workflows/bms-cron.yml` now calls it daily
along with the other cron endpoints that previously had no caller at all. That workflow needs
`BMS_APP_BASE_URL` and `BMS_CRON_SECRET` as Actions secrets; without them each job logs a notice and
exits 0, so CI stays green before the app is deployed. `/admin/operations-schedule` reads
`bms_job_runs` and is the place to confirm a job really ran.

### Coupons

`bmsUpsertCoupon`/`bmsDeleteCoupon` require `coupon.manage`; `bmsCoupons`/`bmsCouponRedemptions`
require the lighter `coupon.view` — both seeded only to Manager and Administrator (pricing/margin
impact), not Sales/Warehouse. Redemption is not a resolver-level concern: it happens inside
`createOrder()` (`lib/bms/orders.ts`) itself via `applyCouponInTx()`, in the same DB transaction as
stock reservation, so every caller of `createOrder()` — `bmsCreateOrder`, the customer/AI pipeline,
the `create_order` AI tool, the REST order endpoint, — gets validated, atomic coupon redemption for
free. See [../business/order.md](../business/order.md#coupons-discount-codes) for the full
validation order and the `COUPON_INVALID` result status. `bmsCouponRedemptions(couponId)` has no
backing table of its own; it reads `bms_orders` directly by `coupon_code`.

### Follow-up Automation (MVP core)

`graphql/bmsFollowups.ts` gates every field with real `BMS_PERMISSIONS` entries (not a local
`requireTenantAdmin`, unlike the Coupons/Sales-digest modules above), the same shape as
`bmsCoupons.ts`: `bmsFollowupRules` / `bmsFollowupQueue` / `bmsFollowupHistory` require
`followup.view`; `bmsFollowupAnalytics(windowDays)` also requires `followup.view`; and
`bmsUpsertFollowupRule` / `bmsDeleteFollowupRule` / `bmsRunFollowupsNow` require `followup.manage`.
`bmsRunFollowupsNow` is a manual test trigger (same idea as
`bmsSendTestReportNow`) but calls `runDueFollowups(getTenantId(ctx))` — **always pass the caller's
own tenant id here**; calling the bare cron function would let a tenant-scoped `followup.manage`
grant fire (and be attributed to) every tenant's conversations, not just the caller's own. See
[../business/crm.md](../business/crm.md) and `CLAUDE.local.md` § Follow-up Automation for the rule
engine/stop-condition/scheduler design. The queue query now also returns queue-level heuristics
(`score`, `scoreLabel`, `scoreReasons`, idle minutes, simple customer value context) so the admin
UI can sort and explain which pending jobs look most promising without embedding business logic in
React. The analytics query summarizes 30-day history by goal/intent/day using the same underlying
tenant-scoped tables (`bms_followup_jobs`, `bms_followup_history`, `bms_messages`, `bms_orders`).
See the § "Follow-up automation scheduler" note in [AGENTS.md](../../AGENTS.md) for the durable
invariants.

### Bulk product import (preview + commit over one mutation)

`bmsImportProducts(items: [BmsProductImportRowInput!]!, commit: Boolean = false): BmsProductImportResult!`
requires `product.edit` (same permission as `bmsUpsertProduct`) and establishes this codebase's first
bulk-operation-with-structured-per-row-result pattern: a single mutation toggled by a `commit` flag
rather than a separate preview query, so preview and commit share one validation path
(`lib/bms/productImport.ts` `runImport()` → `validateProductFields()`) and can never drift apart.
`commit: false` (default) validates only; `commit: true` writes by looping the existing
`upsertProduct()` per row. Row count is capped at `PRODUCT_IMPORT_MAX_ROWS` (500), enforced in the
resolver even though the client also checks it before calling the mutation at all. See
[../business/inventory.md](../business/inventory.md) for the full field mapping, quota, and
duplicate-SKU rules. If a future feature needs a similar "review before you commit" bulk mutation,
follow this same shape rather than inventing a separate preview-only query/REST endpoint.

### Sales digest report subscriptions

`bmsReportSchedule.ts` splits into a tenant-facing half and a platform-admin half, both backed by
`lib/bms/reportDigest.ts`:

- `bmsReportSubscription` / `bmsUpsertReportSubscription` / `bmsSendTestReportNow` /
  `bmsReportDeliveries` gate with the module's own `requireTenantAdmin(ctx)` (checks
  `auth.scope === "admin"` only) — the same config-domain pattern as `bmsChannels`/`bmsStoreProfile`/
  `bmsAiConfig`, deliberately with no new `BMS_PERMISSIONS` entry, since this is shop configuration
  rather than an operational action.
- `bmsReportSubscriptions` / `bmsReportDeliveriesForTenant` gate with `requirePlatformAdmin(ctx)`
  (cross-tenant, like `bmsTenants` in `bmsSaas.ts`) and back the platform-only `/admin/report-schedule`
  audit page.
- `bmsSendTestReportNow` calls `sendTestDigest()`, which computes the last 24h as an ad-hoc period
  and writes to `bms_report_deliveries` without mutating the subscription's real
  `last_sent_at`/`last_period_key` — testing configuration never desyncs the real schedule.

### On-demand generated report exports

`bmsReportEngine.ts` is the read/write GraphQL layer for the export flow behind `/admin/reports`,
backed by `lib/bms/reportEngine.ts`:

- `bmsGeneratedReports(limit)` requires `report.view` and returns the tenant's own append-only export
  history, newest first, capped server-side.
- `bmsGenerateReport(input)` also requires `report.view` and calls `generateReport()`, which validates
  `reportType` (`SALES` / `INVENTORY` / `PROFIT`) and `format` (`XLSX` / `CSV` / `PDF`), reads the
  existing report services, optionally drafts a short AI executive summary from those exact facts,
  persists the file to the shared storage/files system, writes a `bms_generated_reports` row, and
  audits `report.generate`.
- The staff AI tool `generate_report` and REST `POST /api/bms/reports/generate` both call the same
  service function. Keep validation, file generation, persistence, and audit inside the service so
  the three entry points cannot drift apart.

### AI usage, credits, and cost reporting

`bmsAiUsage`, `bmsAiUsageBreakdown`, and `bmsAiUsageEvents` expose three deliberately separate
dimensions (migration `7.82`), and a client must not add them together or substitute one for another:

| Field | Means | Not |
| --- | --- | --- |
| `billableCredits` | what the tenant was charged — one credit per *logical* request on a finite plan | not a count of provider calls; it is `0` for every request on an unlimited plan |
| `providerCalls` | actual provider attempts, including tool-loop rounds, validation retries, and OCR fallbacks | not something the customer is charged per-unit |
| `actualCostUsd` | metered cost attributed from provider-reported tokens against the configured rate card | **not a provider invoice**, and it excludes platform-wide health probes |
| `unpricedProviderCalls` | attempts that returned no usage, so their cost is unknown | not zero-cost calls |

`requests` counts `DISTINCT meta.usage_group_id`, so a Qwen→Anthropic slip-OCR fallback is one
request with two provider calls. `actualCostUsd` is nullable on `BmsAiUsageEvent` — when nothing
reported usage, the API returns `null` rather than `0`. Any surface that shows a cost total must also
show `unpricedProviderCalls`, otherwise partially-known cost reads as a complete figure.
`bmsAiCreditLedger` is the append-only credit trail (grant / usage / refund / adjustment) and is where
an automatic refund appears when a reservation ends without a provider call, including the 15-minute
stale-reservation sweep. `bmsAdjustAiCredits` is the manual adjustment path; the monthly row is locked
so two adjustments cannot be computed from the same balance. Tenant reads are gated by
`ai_quality.view`; the platform-wide provider-health operations require platform admin.

### Support tickets

`createSupportTicket` powers the public `/support` form. It persists the ticket row, best-effort
emails the support inbox, and returns a ticket code the user can keep for follow-up. Platform
admins review tickets through `bmsSupportTickets`, change status and leave internal notes through
`bmsUpdateSupportTicket`, and the resolver appends those notes to `support_ticket_comments` so the
status trail stays visible. The UI is intentionally BMS-specific rather than a generic contact page.

### Revision history GraphQL

`bmsRevisions.ts` exposes the read-only revision browser used by `/admin/revisions`:

- `bmsRevisionHistory(kind, entityId, limit)` lists recent snapshots. `kind` is one of `products`,
  `orders`, `payments`, `shipments`, `purchase` (PO header), or `purchaseItems` (PO line items).
  `entityId` is a search string, not only an exact ID: products search `sku/name/barcode`;
  orders/payments/shipments search their id/status/reference fields; `purchase` searches
  `id/status/note`; `purchaseItems` searches `po_id/product_sku/size` (line-item history is grouped
  by its parent PO id, since the line-item's own id is an internal bigserial).
- `bmsRevisionDetail(kind, revisionId)` returns one snapshot and its editor label.
- `bmsRevisionCompare(kind, fromRevisionId, toRevisionId)` returns field-level JSON diffs between
  two snapshots.

Each query gates through the matching read permission (`product.view`, `order.view`, `payment.view`,
`shipping.view`, or `purchase.view`) and tenant id from the authenticated admin context. The purchase
snapshots are populated by the revision trigger on every `receivePurchaseOrder()`/
`cancelPurchaseOrder()` write; both now thread the acting admin id into `beginTenantTx()` so the
Editor column shows who received/cancelled rather than `system`.

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

**Login identity (migration `7.75`):** usernames and email addresses are canonicalized with trim +
lowercase before lookup or persistence. Application input also uses Unicode NFKC normalization, so
case/full-width variants of the same public username resolve to one identity. Postgres unique
expression indexes on `lower(btrim(email))` and `lower(btrim(username))` close concurrent-register
and direct-SQL races; the migration refuses to guess if historical case-only duplicates already
exist and requires those accounts to be resolved first. Public registration validates username,
email, phone, and bcrypt's 72-byte password boundary on the backend, reserves system-like handles,
and does not issue a login cookie until email verification. `loginUser`, `loginAdmin`, legacy
`login`, social login, mobile login, and password-reset lookup all use the same canonical identity.
Auth attempts use bounded in-memory IP + hashed-identity rate limits; this is per app instance and
must move to Redis before relying on it as a distributed production limit.

Google social login verifies the ID token signature, issuer, expiry, audience, subject, and verified
email through `google-auth-library`; decoding JWT claims without verification is forbidden. Facebook
login accepts only a valid debug-token response whose `app_id` and `user_id` match the configured app
and `/me` response. `FACEBOOK_APP_SECRET` is server-only; the old
`NEXT_PUBLIC_FACEBOOK_APP_SECRET` name is accepted only by Compose as a temporary environment-value
fallback and is never injected under a public runtime name.

Email verification and password-reset consumption are single atomic SQL statements, so one token
cannot succeed twice under concurrent requests. Admin login additionally rejects public Subscriber
accounts rather than issuing them an admin cookie.

Password-reset tokens are stored as SHA-256 hashes (`password_reset_tokens.token_hash`), expire after
15 minutes, and are invalidated when email delivery fails. Production reset URLs require an explicit
HTTP(S) `NEXT_PUBLIC_BASE_URL`; they must not silently fall back to localhost. Resetting a password
increments the user's admin session version so existing admin JWTs stop working on their next request.

**Admin session lifetime (2026-07):** `loginAdmin` (`graphql/resolvers.ts`) signs the JWT and sets
`ADMIN_COOKIE`'s `maxAge` from the same `sessionMaxAgeSec` value, so the two can't drift apart —
Administrator (full RBAC permissions) gets a 1-day session; Manager/Sales/Warehouse get 7 days.
Admin session ids are stored in Redis, so logout can revoke an admin token before JWT expiry;
Redis failures deliberately fail open and trust the still-valid JWT. Expiry itself is enforced only
when the *next* request is made: `verifyTokenString()`
(`lib/auth/token.ts`) swallows `jwt.verify()`'s `TokenExpiredError` and returns `null`, `requireAuth()`
(`lib/auth.ts`) then throws `UNAUTHENTICATED`/`reason: "backend_admin"`, and the Apollo `errorLink`
(`lib/apollo.ts`) catches that to clear the cookie and redirect to `/admin/login`. There is no
client-side timer — an idle tab with no polling keeps showing stale UI until it makes a request, but
in practice the admin sidebar's own polling (unread count/channel health every 15s, AI usage every
60s) triggers the redirect within about a minute of real expiry.

Every admin GraphQL request and `/api/auth/me` also refreshes role, tenant, platform-admin status,
tenant activity, and `admin_session_version` from Postgres. Role/password changes increment that
version, and deletion or tenant deactivation makes refresh fail, so stale JWT claims cannot retain
permissions for the rest of their nominal lifetime. The Redis check remains an additional explicit
logout mechanism rather than the source of role truth.

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
- `bmsSignup` powers `/shop-signup`. It stores an expiring pending request and emails a verification
  link; it does not create a tenant or user yet. `bmsVerifyShopSignup` consumes that link atomically,
  then creates the free tenant and Manager account. Repeated unverified requests keep independent
  tokens, so an attacker cannot invalidate the real owner's link; the first valid verification creates
  the account and consumes the remaining requests for that email.
- `/shop-signup` also accepts an **optional** `businessArchetype` field and persists it on the
  pending signup row until verification. The verified flow initializes the tenant's first
  store-profile archetype/business-type defaults in the same transaction. This is for onboarding,
  sample-data, and AI-context defaults only; it does not restrict features. See
  [../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md).
- `bmsOnboardingProgress` and `bmsUpdateOnboardingProgress` persist completed, skipped, dismissed,
  and last-seen onboarding state for the current tenant. The service validates the fixed step
  allowlist before storing it.
- `bmsRestockMetrics` includes recovered subscriptions, customers, orders, and revenue. Revenue
  comes from the linked order-item price snapshot, never from a client-supplied amount.
- `POST /api/bms/onboarding/sample-data` is an authenticated Administrator/Manager onboarding
  action, available in production for an empty tenant. A tenant-scoped seed-run ledger prevents
  concurrent runs and resumes failed runs stage by stage; unlike `/api/dev/fake/*`, it does not use
  the development fake-seed feature flag.
- `bmsMe`, `updateMe`, and `uploadAvatar` power `/admin/profile` and other self-profile surfaces.
