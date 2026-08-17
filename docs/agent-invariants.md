# Agent invariants (domain detail)

Detailed, per-domain rules moved out of [../AGENTS.md](../AGENTS.md) so that file stays small enough
to load into every session. **AGENTS.md carries the short version of each rule; this file carries the
reasoning, the file/migration references, and the failure mode each rule prevents.**

Read the matching section here before changing code in that domain. If a rule here and the code
disagree, inspect the migration and the service implementation before changing behavior — then fix
whichever is wrong, in the same change.

## Contents

- [AI tool-calling (two surfaces)](#ai-tool-calling-two-surfaces)
- [Authentication identity and registration](#authentication-identity-and-registration)
- [Public customer checkout (signed link)](#public-customer-checkout-signed-link)
- [Carrier booking and tracking sync](#carrier-booking-and-tracking-sync)
- [POS and tax](#pos-and-tax)
- [AI provider selection, BYOK, and health](#ai-provider-selection-byok-and-health)
- [Follow-up automation scheduler](#follow-up-automation-scheduler)
- [Redis usage (pub/sub, cache, sessions, job runs, request metrics)](#redis-usage-pubsub-cache-sessions-job-runs-request-metrics)
- [Observability (`/admin/system-health`)](#observability-adminsystem-health)
- [i18n coverage](#i18n-coverage-what-bilingual-actually-means-today)
- [Frontend and CSS Modules](#frontend-and-css-modules)

## AI tool-calling (two surfaces)

Since 2026-07, Claude drives two separate tool-calling surfaces over the same runtime
(`apps/web/lib/bms/tools/runtime.ts`) and catalog (`apps/web/lib/bms/tools/catalog.ts`):

- **Customer** (`lib/bms/pipeline.ts`, reached from every channel webhook + the chat playground) —
  only customer-safe tools (`customerTools()`): live-catalog discovery (`search_products`,
  `browse_catalog`, `list_new_arrivals`, `find_alternatives`) backed by
  `listSellableProducts()`/`resolveSellableProduct()`/`findAlternativeProducts()` in
  `lib/bms/products.ts` — always active + in-stock, queried fresh on every call with no cache to
  invalidate — plus read product/stock/own-order-status and `create_order`/`submit_payment`/
  `reorder`/`subscribe_restock_notification`. No sensitive tool is ever exposed here.
  Out-of-stock/not-found replies must offer a verified alternative size or product from these tools
  rather than ending at "not found", and the model may create a restock subscription only after the
  customer explicitly opts in. AI-first; falls back to the old deterministic rule-based path only
  when the tenant has no AI credentials or has exhausted its shared-key quota — never mid-loop, to
  avoid duplicate writes.
  Post-order delivery collection is **identity-first and PII-minimizing**: `get_customer_checkout` /
  `save_customer_checkout_details` resolve the customer only from the server-established
  `(tenant_id, channel, customer_ref)` identity — never from an id the model supplies — and the read
  tool returns completeness only (booleans, an address count, ordered `missingFields`, and an address
  label solely when it matches a generic allowlist). **Do not "helpfully" widen it to return the raw
  recipient name, phone, or address**: the model needs to know only whether to ask, and returning the
  values would ship CRM PII into a prompt and a provider log for no behavioral gain. The write tool
  persists only the fields the customer explicitly sent in that message, keeps omitted fields, and must
  not be called merely to reconfirm existing data. When a shop has no configured receiving account, the
  customer surface must not name a payment channel at all — see `lib/bms/paymentConfiguration.ts`; do
  not reintroduce a hardcoded bank/PromptPay/QR example anywhere on this surface.
  General-shop and pharmacy conversations share one tenant-scoped CRM identity: normalize the
  server-established `(channel, customer_ref)` through `customerIdentity.ts`/`customers.ts` and keep
  orders, conversations, restock subscriptions, and pharmacy assessments linked to that canonical
  `customer_id` (migration `7.74`). Canonical own-order history and reorder may span channels, but
  `submit_payment` must select only a `PENDING` order on the current channel and must use
  `submitPaymentOnce()`; never reuse broad canonical history for payment selection. Pharmacy patient
  memory is server-side only and may reuse only consented, customer-confirmed, relationship-matched
  safe fields. Current-message values win, stale age is dropped, and none of identity lookup,
  payable-order selection, or patient-memory retrieval belongs in the model tool registry.
- **Staff** (`graphql/bmsAssistant.ts`, UI `/admin/assistant`) — `staffTools(perms)` filtered by the
  calling admin's own RBAC permissions; `runtime.ts` calls `requirePermission()` again immediately
  before execution. Read tools and non-sensitive writes execute directly; sensitive tools (refund,
  cancel order/PO/shipment, adjust stock, merge customers,
  confirm/reject payment, email a generated report to an address) are **propose-only** — the tool returns a proposal object instead of
  executing, and the UI's Confirm button fires the pre-existing permission-gated GraphQL mutation
  (e.g. `bmsRefundPayment`). The model never executes a sensitive action itself.

Every tool attempt is centrally audited as `ai.tool_call` (success/error/denied/proposal) without raw
arguments or prompt content. Successful A2 writes also keep their domain audit action, and confirmed
A3 actions are audited by the existing mutation. Shared-key quota is consumed once before a loop,
not once per Claude round-trip.

The catalog also covers store profile (`lib/bms/storeProfile.ts`, migrations `6.9`/`7.17__bms_store_profile*`
— `get_store_info`/`get_payment_info`/`get_shipping_estimate`; contact/branding/locale fields). Shop name
is a single source: `bms_tenants.name` via `getTenantName()` (the `store_name` column is deprecated — do
not reintroduce it), and a shop Administrator renames their own tenant name through
`bmsUpdateMyTenant` (`updateTenantIdentity()` in `platform.ts`, slug validated + unique); `bms_tenants`
has no revision trigger so the rename is safe, while plan/active stay platform-admin only. Slug is
read-only in the Settings UI and is now the stable public-shop handle used by
`/shop/[tenantSlug]/products/[sku]`; the mutation still accepts it for controlled future changes.
Also documents (`lib/bms/documents.ts` —
`generate_invoice`/`generate_quotation`), heuristic forecasting (`lib/bms/forecast.ts` —
`forecast_demand`/`predict_stockout`/`suggest_purchase_order`, every result tagged with its
`method`/`disclaimer` per the forecasting rules in AI_GUIDELINES), AI-native helpers
(`detect_language`/`classify_intent`/`summarize_conversation`/`recommend_products`), and propose-only
outbound (`send_customer_message` → `bmsSendMessage`, LINE/Meta only — TikTok send and email have no
real API yet, so they are intentionally not implemented rather than stubbed).

Generated report exports (`lib/bms/reportEngine.ts`, `lib/bms/documentGenerator.ts`, migration
`7.53__bms_generated_reports.sql`) are also shared across three entry points: staff AI tool
`generate_report`, GraphQL `bmsGenerateReport`/`bmsGeneratedReports`, and REST
`POST /api/bms/reports/generate` + `GET /api/bms/reports/download/[id]`. Preserve that single-service
shape: date-range validation, report assembly, optional AI executive summary, file persistence, DB row,
and audit all belong in `generateReport()`, while API layers stay thin. Downloaded files must go through
the tenant-gated `/api/bms/reports/download/[id]` route, never the bare `/api/files/[id]` path, because
generated reports may contain revenue/profit/customer data. Current PDF output deliberately uses English
labels only: `pdfkit`'s built-in fonts do not render Thai glyphs correctly until a Thai-capable TTF is
embedded, so do not "translate" PDF headings into Thai without adding font embedding in the generator.
Report field completeness is a two-step contract, not one: a summary query (e.g. `getSalesSummary()`,
`listLowStock()` in `lib/bms/reports.ts`/`products.ts`) can return a field that never reaches any
output, because each `build*ReportDoc()` function in `documentGenerator.ts` explicitly lists which
columns go into which sheet. Adding a field to the query is not sufficient — add it to the matching
sheet's `columns` array too, or it is silently dropped from every format. Also remember `buildCsv()`
has no native multi-sheet concept; it now iterates every sheet in `doc.sheets` (each preceded by a
`# <sheet name>` line) — do not reduce it back to `doc.sheets[0]`, which previously dropped every
sheet but the first from CSV exports while XLSX/PDF stayed correct.

The staff assistant can also email a generated report (`email_report` tool, `lib/bms/reportEmail.ts`,
`bmsEmailReport` mutation, permission `report.email`). It generates the file the same non-sensitive way
as `generate_report`, but the *send* is always a proposal (`sensitive: true`) because the recipient is
free text from the chat message and is never independently verified — a human must review/edit the
address and press Confirm in `/admin/assistant` before anything is emailed. `lib/mailer.ts`'s
`sendEmail()` gained optional `attachments` support for this; do not add a second, parallel way to send
an outbound email with a file attached. See § "ส่งรายงานเป็นอีเมล" in `CLAUDE.local.md`.

Adding a new AI tool: wrap the existing `lib/bms/*.ts` function in `tools/catalog.ts` (validate
model-supplied args, derive `tenantId` from `ExecCtx`, add a domain `audit()` for writes, and assign
the surface + staff permission. If it is refund/cancel/delete/adjust-inventory/merge-like, mark it
`sensitive: true` and return a proposal instead of executing),
then update [docs/ai/tools.md](ai/tools.md). Never let a tool description promise a capability the
backend does not implement. Any new customer-facing product/catalog tool should reuse
`listSellableProducts()`/`resolveSellableProduct()`/`findAlternativeProducts()` in
`lib/bms/products.ts` instead of writing a parallel product query — they already scope to
active + in-stock and are the only bounded reads covered by the `pg_trgm` indexes added in
migration `7.33__bms_product_discovery_indexes.sql`; an unindexed `ILIKE` scan on `bms_products`
will not use them. See § "AI tool-calling — example usage" in
[CLAUDE.local.md](../CLAUDE.local.md) for runnable `curl`/GraphQL examples against both surfaces.
`ALL_TOOLS` is validated at module startup by `assertValidToolRegistry()`; do not remove that guard.
It enforces unique snake_case names, valid surfaces, staff-only sensitive tools, and declared required
schema fields. Registry-only metadata (`whenToUse`/`whenNotToUse`/`commonMistakes`/`example`) stays out
of provider payloads and should be added only for a real observed ambiguity, not mechanically to every
tool. The current snapshot is 66 tools total / 21 customer tools; verify the source rather than
trusting this count after any catalog change.

## Authentication identity and registration

- `apps/web/lib/auth/identity.ts` is the shared normalization/validation source for public login and
  registration. Username and email identity is trim + Unicode NFKC + lowercase; never add a new auth
  path that queries raw `email = $1` / `username = $1` or duplicates frontend-only validation.
- Migration `7.75__users_case_insensitive_identity.sql` adds unique indexes over
  `lower(btrim(email))` and `lower(btrim(username))`. It must abort on historical case-only duplicates;
  never auto-merge user security principals or silently rename one during a migration. Resolve those
  records explicitly, then rerun.
- Public registration reserves system handles (`admin`, `administrator`, `root`, `system`, `support`,
  etc.), validates phone/password on the backend, and does not issue `USER_COOKIE` before email
  verification. A public Subscriber must never receive `ADMIN_COOKIE`; admin login requires a
  platform admin or a non-Subscriber tenant user.
- Password comparisons must use the dummy bcrypt hash when an account is absent to reduce timing
  enumeration. Keep the 72-byte bcrypt input limit for newly registered/reset passwords. Verification
  and reset tokens are single-use via atomic SQL, not a SELECT followed by a later mark-used UPDATE.
- Auth rate limiting uses the same `lib/bms/rateLimit.ts` with IP and hashed-identity keys, counted in
  Redis so it holds across every `web` instance (see § Multi-instance readiness below) — it degrades to
  the old per-instance in-memory window if Redis is unreachable, it does not fail open. Never put raw
  email, username, token, or password into a rate-limit key/log.
- Google login must call `google-auth-library.verifyIdToken()` with the configured audience and require
  a verified email. Decoding claims without signature/issuer/expiry/audience validation is an account
  takeover. Facebook login must verify debug-token `app_id`, `user_id`, and `/me`; keep
  `FACEBOOK_APP_SECRET` server-only. Every provider knob must remain in all three Compose web-service
  environments, and secrets must never use a `NEXT_PUBLIC_*` runtime name.

## Public customer checkout (signed link)

A successful customer `create_order`/`reorder` no longer ends in chat prose. The tool stores the
verified order id on the server-only `ExecCtx.createdOrderId` (`tools/types.ts`), and `pipeline.ts`
replaces the model's closing sentence with `orderCheckoutChatReply()` — a backend-built order
summary plus a signed `/checkout?t=<token>` link. Keep that ordering: the link must be derived from
the persisted order, never composed by the model.

Invariants to preserve when touching `lib/bms/checkout.ts`, `lib/bms/checkoutToken.ts`, or
`app/api/bms/checkout/*`:

- **The token is the only authority.** The HMAC binds `tenantId + orderId + exp` (7 days default,
  30 max) and is signed with `BMS_CHECKOUT_SECRET` (falls back to `JWT_SECRET`; production throws
  when neither is set). Never accept a tenant id, order id, order total, or customer identity from
  the request body — a bearer link that trusts client input is a cross-tenant read.
- **The page is a public bearer link, not an authenticated surface.** Responses stay `no-store`, the
  route stays `noindex`/`no-referrer`, and `/checkout` is listed in `skipsSessionLayer()` in
  `ClientProviders.tsx` so it never mounts admin session/chat/notification wires. Do not "fix" this
  by adding it to `isAuthPath()` — those are two different exclusions.
- **Amount comes from the order, never the browser.** `submitCheckoutPaymentByToken()` passes
  `amount: null` so `submitPayment*` derives it from `bms_orders.total_amount`.
- **Payment submission is idempotent by design.** `submitPaymentOnce()` locks the order row
  (`SELECT ... FOR UPDATE`) and returns an existing `PENDING`/`CONFIRMED` payment as
  `ALREADY_SUBMITTED` instead of creating a duplicate. A `REJECTED` payment is deliberately *not*
  active, so a customer can upload a replacement slip. Keep `submitPayment()` (staff path)
  non-reusing; the two behaviors share `submitPaymentInternal()` via overloads.
- **Uploads stay untrusted.** Slips are limited to JPG/PNG/WEBP, 8 MB, and a pixel bound, and are
  re-validated by decoding with `sharp` — MIME type alone is not proof of an image.
- **Only configured receiving accounts are offered.** The method must be `BANK_TRANSFER`/`QR` *and*
  backed by a currently configured BANK/PromptPay account (`paymentConfiguration.ts`). This matches
  the chat-surface rule: never surface a payment channel the shop cannot actually receive money on.
- **The checkout never confirms payment.** It creates `PENDING` only; a human still clicks Confirm
  before the order becomes `PAID`. Do not add auto-confirm, a payment gateway, or card fields.
- **Lazada/Shopee are rejected, not re-asked.** Those channels report `marketplaceManaged` and keep
  delivery + payment in Seller Center.
- Delivery edits reuse `saveCustomerCheckoutDetails()`, so omitted fields are preserved rather than
  cleared, and customer actions are audited as `customer:checkout`.

## Carrier booking and tracking sync

`lib/bms/carriers/` holds the provider adapters and `lib/bms/shipping.ts` owns every rule around them
(migrations `7.76`/`7.77`). Flash and Kerry are **mock-ready scaffolds, not verified live adapters** —
`getStatus()` returns `not_implemented` even when a key is set, because no merchant contract has been
obtained. Do not "finish" an adapter by guessing endpoints, payload fields, or status codes; follow
[docs/integrations/carriers.md](integrations/carriers.md) instead. Invariants to preserve:

- **A carrier call never runs inside the fulfillment transaction.** `createShipment()` commits the
  local order/stock/movement work and releases its locks first, then books. A network call holding a
  `bms_orders`/`bms_inventory` row lock is the failure mode this design exists to prevent.
- **The shipment UUID is the idempotency key.** It is passed as
  `CarrierCreateShipmentRequest.idempotencyKey` and must stay stable across retries; a live adapter
  must forward it through the carrier's own idempotency/reference mechanism so a retry returns the
  same parcel. `uq_bms_shipments_external_shipment_id` enforces the one-parcel-per-shipment result.
- **A failed carrier call must stay visible, never degrade silently into "manual".**
  `carrier_booking_status` keeps `failed`/`unconfigured`/`not_implemented` with a bounded error, the
  Shipping page shows it, and `bmsBookShipmentLive` retries. Do not swallow the failure just because
  the local shipment row already exists.
- **Sync re-locks before it writes.** `syncShipmentLive()` calls the carrier, then re-locks the
  shipment and re-checks carrier/tracking number before persisting status plus events in one tenant
  transaction. It must not regress a status and must not touch a terminal `DELIVERED`/`RETURNED`/
  `CANCELLED` shipment — a concurrent edit cannot be overwritten by an in-flight lookup.
- **`source: "live" | "mock"` stays on every carrier result type and on
  `bms_shipment_tracking_events.source`.** It is the only thing preventing mock data from being read
  back as real carrier history, and mock mode is blocked in production regardless of env flags.
- **Adapters return typed results and never throw.** External calls go through
  `runCarrierCall()` (`carriers/safeCall.ts`, 10-second bound); errors are normalized, not propagated.
- **Skip booking when BMS is not the one creating the parcel**: a staff-supplied tracking number means
  the parcel already exists externally, and Lazada/Shopee stay marketplace-managed in Seller Center.
- Only HTTPS carrier label URLs are retained (`normalizeCarrierLabelUrl()`); the printable BMS label
  remains the fallback. `bmsBookShipmentLive`/`bmsSyncShipmentLive` require `shipping.update` and
  `bmsShipmentTrackingEvents` requires `shipping.view`, with the tenant derived from the session —
  never from an argument.
- `POST /api/bms/shipping/sync-carriers` is the cron-secret-gated cross-tenant poller (bounded batch
  and concurrency, skips unconfigured/`not_implemented` adapters) and records into `bms_job_runs` as
  `carrier-tracking-sync`. It is ready but unscheduled; recommended cadence is every 15 minutes.

## POS and tax

`lib/bms/pos.ts` (migrations `7.84`–`7.93`) owns the counter sale/return/refund model;
`lib/bms/{taxDocuments,vat}.ts` (`7.88`, `7.89`, `7.95`) own Thai tax-invoice issuance and credit
notes; `lib/bms/etax/*` (`7.94`) owns the e-Tax submission queue. Full operator/business detail:
[../docs/business/pos.md](business/pos.md).

- **A device token is not a user.** `/api/pos/*` resolves tenant/location from the hashed active
  device row (`x-pos-device-token`), never from a client-supplied value. Every *mutating* route
  additionally verifies the selected cashier's PIN and an action-specific permission (`pos.sell`,
  `pos.shift.open`/`pos.shift.close`, `order.return`, `payment.refund`). Read routes are
  device-scoped operational reads with no PIN check.
- **`users.pos_only` (`7.92`) is a hard login gate, not a hidden menu item.** `loginAdmin` rejects a
  `pos_only` account outright; a `pos_only` account cannot toggle its own flag or an
  Administrator's.
- **Settlement is one atomic transaction.** Order → `COMPLETED`, stock consumption, FEFO lot
  assignment (`bms_order_item_lots`), movement rows, and tax document issuance commit together or
  not at all.
- **Idempotency keys gate every write path** (sale, return, refund settlement). A key tied to a
  cancelled/returned terminal state cannot be reused as a new sale; a `PENDING`/`PAID` sale can
  resume its own settlement transaction; a completed key replays its stored result rather than
  re-running the write.
- **Refunds split receiving goods from returning money.** `bms_pos_refund_allocations`: cash
  finishes immediately, non-cash stays `PENDING` until a user with `payment.refund` records the
  external reference. A shift cannot close while any refund allocation from it is pending.
- **Tax documents are immutable snapshots.** Rate and amounts are stored on the document row at
  issue time; changing tax settings (`tax.setting.manage`) only affects bills issued afterward.
  Cash rounding (`7.95`) applies only to fully-cash bills, is its own receipt line, and never
  changes the VAT base.
- **e-Tax submission (`7.94`) is a separate, gated background queue** — issuing a tax document does
  not submit it to the Revenue Department by itself. `processEtaxQueue()` drives
  `PENDING → BUILT → SIGNED → SENT → ACCEPTED/REJECTED/FAILED` with bounded retry/backoff, gated by
  `ETAX_ENABLED`/`bms_store_profile.etax_enabled`. `POST /api/bms/jobs/etax` runs it, but — unlike
  every other cron endpoint — auths with `x-job-token`/`BMS_JOB_TOKEN` (not `x-cron-secret`) and does
  **not** call `recordJobRun()`, so it has no run history on `/admin/operations-schedule`. Don't copy
  that inconsistency into a new cron route; treat it as a known gap.
- **ESC/POS printing (`lib/pos/{escpos,printerClient}.ts`) is unverified against real hardware** —
  written over WebUSB for receipt/barcode/drawer-kick, with the browser print dialog as fallback.
  Treat it as untested per printer model until run against one.

## AI provider selection, BYOK, and health

The runtime is multi-provider, not Anthropic-only, and chat/tool-calling and slip OCR each resolve
their provider independently:

- **Chat/tool-calling** (`resolveAiCredentials()` in `lib/bms/ai.ts`, shared by `pipeline.ts` and
  `tools/runtime.ts`): tenant BYOK first (`bms_tenant_ai_config`, migration `7.35` — `anthropic` or
  `deepseek` only, never `qwen`; changing provider requires re-entering that provider's key), then the
  shared provider decided by `resolveSharedAiProviderDecision()` in `lib/bms/aiProvider.ts`
  (`BMS_AI_PROVIDER` picks the default; a detected **sensitive** staff intent — refund/cancel/
  adjust-stock-like tool names, see `hasSensitiveStaffIntent()` in `tools/runtime.ts` — is forced onto
  `BMS_AI_SENSITIVE_PROVIDER` instead, overriding both the tenant's own BYOK provider and the default
  shared one), then the deterministic template fallback. Every branch tags its usage event's `meta`
  with `routingReason`/`configuredProvider`/`effectiveProvider`/`fallbackFrom` so `bmsAiUsageEvents`
  (tenant-scoped, `ai_quality.view` permission) and the platform `/admin/env` page can show *why* a
  call used the provider it did.
- **Slip OCR** is a completely separate registry: `lib/bms/slipReaders/{index,anthropic,qwen}.ts`
  behind the provider-neutral `SlipReader` contract in `lib/bms/slipReader.ts`. `resolveSlipReader()`
  picks `BMS_SLIP_READER_PROVIDER` (default Qwen) with a lazy one-shot fallback to
  `BMS_SLIP_READER_FALLBACK_PROVIDER` (default Anthropic) on timeout/error, using its own
  routing-reason vocabulary (`ocr_primary`/`ocr_fallback_unconfigured`/`ocr_runtime_fallback`/…) —
  distinct from the chat one but written into the same usage-event `meta` shape. A tenant's own chat
  BYOK provider choice has no effect on OCR; OCR always uses the platform-wide shared provider.
- **Usage accounting keeps three dimensions separate** (`lib/bms/aiUsage.ts`, migration `7.82`) and an
  agent must not collapse them again: `billable_credits` = what the tenant was charged (one credit per
  *logical* request on a finite plan, **zero** on an unlimited plan), `provider_calls` = actual provider
  attempts, `actual_cost_usd` = metered cost attributed from provider-reported tokens against the
  configured rate card. Rules that are load-bearing:
  - **A retry or provider fallback is not a second sale.** Attempts belonging to one logical request
    share `meta.usage_group_id`, and `requests` counts `DISTINCT usage_group_id` — so a shared-key
    Qwen→Anthropic OCR fallback bills one credit while reporting two provider attempts. Reuse the
    existing group id when you add a retry path; do not mint a new event id and call it a new request.
  - **Unknown cost is `NULL`, never `0`.** If no attempt reported usage, leave `actual_cost_usd` null;
    if only some did, keep the known cost and count the rest in `unpriced_provider_calls`. Every
    summary surfaces `unpricedProviderCalls` so partial knowledge is never rendered as a complete
    total. `actual_cost_usd` is cost *attribution*, not a provider invoice — do not label it as one in
    UI or docs, and do not fold platform health probes into a tenant's total.
  - **Finalization is one-shot and refunds are atomic.** `finalizeAiUsageEvent()` may run from
    overlapping cleanup paths, so it must stay idempotent per event. A reservation that ends with
    `provider_calls = 0` refunds its credits and writes a `refund` ledger row in the same transaction;
    `reconcileStaleAiReservations()` applies the same rule to reservations left `started` for more than
    15 minutes (a process that died mid-request). Shared-key deduction and adjustment balances are
    serialized on the monthly row.
  - **A real inference call is an event even when it is free.** Tenant BYOK key tests are recorded as
    zero-credit `ai_key_test` events rather than being skipped.
- **AI Provider Health** (`lib/bms/aiProviderHealth.ts`, migration `7.34`, platform-wide — no
  `tenant_id`, not RLS-scoped, and deliberately does not track tenant BYOK failures) tracks each
  `(provider, purpose)` combo's real connectivity. It is written through exactly one choke point,
  `finalizeAiUsageEvent()` in `lib/bms/aiUsage.ts`, which every shared-key chat and OCR call already
  passes through — **if you add a new shared-provider call site, route its completion through
  `finalizeAiUsageEvent()` (or extend it) rather than adding a parallel success/error path**, or this
  monitoring silently stops covering it. A `connected` row not re-checked within
  `BMS_AI_HEALTH_STALE_MINUTES` (default 60) is reclassified as `stale` at read time only — the DB
  column itself never stores `'stale'`. Visible on `/admin/env` (platform-admin only): a status table,
  a one-click "ตรวจสอบทั้งหมดตอนนี้" re-test, and a cron `POST /api/bms/ai/check-health` (no schedule
  configured yet — see CLAUDE.local.md).
- **Failure incidents** (`lib/bms/failureAlert.ts`, migration `7.36`, tenant-scoped) record and alert
  on failures that actually reached a customer or degraded a reply — a different dimension from the two
  health tables above, which only record *connection status*. Report through `reportBmsFailure()` only;
  it never throws, and callers must keep it out of the transaction that produced the failure. Three
  rules an agent must not get wrong:
  - **Never hook alerting off a tool's audit `outcome`.** `auditAttempt()` in `tools/runtime.ts` looks
    like the perfect choke point, but its `outcome === "error"` merges a genuine thrown exception, a
    `ToolArgError` the model can retry itself, and a business-level `{ ok: false }` such as
    "ไม่พบสินค้า". Alerting there pages the shop every time a customer asks for a product it does not
    stock. Report next to the existing `console.error` sites, which already filter correctly.
  - **Choose the tier by who can act on it, not by severity.** Tier A (customer saw an error or got no
    reply) alerts the shop *and* platform admins; Tier B (degraded but answered) alerts platform admins
    only. A Tier A code raised on a `staff` surface is auto-downgraded to B, since the admin already
    sees the error on their own screen. New codes go in `FAILURE_CATALOG` with an explicit tier.
  - **Keep the notification step time-bounded.** It is `await`ed so an alert is not lost when a
    serverless request ends, which puts `createNotification()` → Redis pubsub on the customer-reply
    critical path. Each recipient phase has its own `try` and a timeout; on timeout the incident row is
    still written and `notified_*_at` is left NULL, so the alert retries later rather than starting a
    silent cooldown. Preserve that ordering if you extend the delivery paths.
- Every new provider knob (a key, a model override, a base URL, a per-model cost rate) needs a
  matching entry in every compose file's `web` service `environment:` block
  (`docker-compose.yml`/`docker-compose.dev.yml`/`docker-compose.prod.yml`) — `--env-file` only makes
  `${VAR}` substitution available inside the compose YAML itself, it does not automatically inject the
  variable into the container. A key present in `.env*` but missing from all three compose files will
  silently read as `undefined` at runtime with no error.

## Follow-up automation scheduler

`lib/bms/followups.ts` (migration `7.52`) decides whether to re-engage a customer whose conversation
went idle, via a configurable Rule Engine + Scheduler rather than a fixed timer. This is an **MVP
core** pass — the multi-step Workflow Engine, the numeric Follow-up Scoring model, and the full
Analytics dashboard are intentionally not built yet (see `CLAUDE.local.md` § Follow-up Automation).

- The scheduler (`runDueFollowups()`, called from `POST /api/bms/followups/run`) re-checks every
  stop condition live at send time — customer/staff replied since scheduling, conversation closed,
  max retry exceeded, customer opted out, rule disabled. These six are **unconditionally enforced**,
  not something a rule can opt out of; `bms_followup_rules.stop_conditions` is validated and stored
  only for a future workflow engine and must not be read as a gate today.
- `bms_conversation_intents` uses its own 10-value intent set (`ASK_PRICE`/`PRODUCT_INFORMATION`/…).
  Do not reuse or extend `nlu.ts`'s `Intent` type for this — that type is load-bearing for the live
  chat pipeline's deterministic fallback and has a different shape (`CHECK_STOCK`/`CONFIRM_ORDER`/
  `GREETING`/`UNKNOWN`).
- `runDueFollowups(tenantId?)` scans every tenant when called with no argument (the cron path). Any
  UI-triggered "run now" mutation **must** pass the caller's own `tenantId` — a tenant-scoped
  `followup.manage` grant firing a cross-tenant background job (even one whose data it can't read
  back) is a tenancy leak. This is the general rule, not just this feature: a manual trigger over an
  otherwise cross-tenant cron/service function must always be scoped to the caller's tenant.
- AI-drafted follow-up text is generated by a direct `resolveAiCredentials()`/provider call in
  `followups.ts`, the same pattern `generateResponse()` in `ai.ts` already uses for the customer
  stock-reply template — this is a system-initiated text generation, not a model-selected tool call,
  so it does not go through `tools/runtime.ts`/`ExecCtx`/RBAC the way the customer/staff AI
  tool-calling surfaces do.

## Redis usage (pub/sub, cache, sessions, job runs, request metrics)

Redis backs five distinct things in this app — do not conflate them or add a sixth ad hoc client
(there are already three connections: `lib/cache.ts`, `lib/bms/rateLimit.ts`, `lib/redisSession.ts`;
reuse `sharedRedisClient` exported from `lib/cache.ts` and namespace your own keys):

- **Realtime pub/sub** (`packages/realtime/src/pubsub.ts`) — the one `RedisPubSub` instance shared by
  `apps/web` and `apps/ws` for GraphQL subscriptions (messages, notifications, `bmsInboxChanged`, the
  admin "Emit" diagnostics). `apps/web/lib/pubsub.ts` re-exports this same instance rather than
  opening a second publisher/subscriber pair — do not revert that to its own `new Redis(...)` calls.
- **Read-through cache** (`apps/web/lib/cache.ts`, `getOrSetCache()`/`invalidateCache()`) — fail-open
  by design: a Redis error is logged and treated as a cache miss, never thrown. Used today for
  `getStoreProfile()` (`lib/bms/storeProfile.ts`); call `invalidateCache()` in the same function that
  writes the row, immediately after commit. **Do not cache product/catalog reads** —
  `listSellableProducts()`/`browse_catalog`/`list_new_arrivals` are intentionally always-fresh so a
  newly created product is visible on the very next AI tool call; adding a cache there reintroduces
  exactly the staleness that design avoids.
- **Admin session revocation** (`apps/web/lib/redisSession.ts`) — the admin JWT (`ADMIN_COOKIE`) is
  still stateless and still carries its own `exp`; this only adds the ability to revoke it *before*
  `exp` (logout). Enforced once, in `createContext()` in `app/api/graphql/route.ts`, which is the
  choke point nearly every admin action goes through. Fail-open on Redis error (trust the JWT alone,
  same behavior as before this existed) rather than locking out every admin during a Redis outage.
  **Not yet extended to the community/`USER_COOKIE` login paths** (`loginUser`/`loginWithSocial`/
  `registerUser` in `resolvers.ts`) — those remain fully stateless JWT; extend using the same
  `jti` + Redis-key pattern if that's ever asked for, don't invent a second mechanism.
- **Job run history** (`apps/web/lib/bms/jobRuns.ts`, migration `7.55`) — see `docs/architecture/api.md`'s
  cron section. Every cron-secret-gated route must wrap
  its real work in `recordJobRun(jobName, "cron", () => ...)`, not call the underlying function
  directly, or that job has no run history on `/admin/operations-schedule`.
- **Request metrics** (`apps/web/lib/bms/requestMetrics.ts`, 2026-08) — latency histograms + error
  counts per GraphQL operation, read by `/admin/system-health`. Deliberately **not** a Postgres table:
  one row per request would add write load to the very database the page exists to diagnose. Stored as
  fixed-width histogram buckets (not raw samples) so memory is bounded and counters merge across
  instances for free via `HINCRBY` — an in-process `Map` would report per-instance numbers the moment
  a replica exists. Fail-open like the cache: `recordRequestMetric()` never throws and is never awaited
  on the request path (it fires after the response, so it does not count itself). Percentiles are
  therefore **approximations** interpolated from bucket boundaries, and all of it is lost on a Redis
  restart (TTL 4h, no cron cleanup) — this is monitoring data, not a system of record. The one Apollo
  plugin registered for this (`graphql/metricsPlugin.ts`, wired once in `app/api/graphql/route.ts`)
  covers admin UI, AI assistant, and eval traffic — `uploadProcess` multipart requests included, since
  they route through `server.executeOperation()` — but not REST routes; see § Observability below for
  what to do when instrumenting one.

Redis auth is opt-in as of 2026-08: set `REDIS_PASSWORD` and the compose redis service starts with
`requirepass` (leave it unset and nothing changes) — `REDIS_URL` must then carry the credential as
`redis://:<password>@redis:6379`. Turn it on before Redis leaves the host it shares with `web`, since
it holds session ids, rate-limit counters, and (transiently) store payment-account data via the cache.
TLS is still not configured anywhere; use `rediss://` for any cross-host hop.

Redis is also now load-bearing for rate limiting (`lib/bms/rateLimit.ts`), not just pub/sub, cache and
session revocation. That path is deliberately **not** fail-open the way `lib/cache.ts` is: a Redis
outage drops it back to a per-instance in-memory window, which still refuses traffic over the limit.
Do not "simplify" it into the cache's fail-open shape — that would disable login brute-force
protection exactly when Redis is unhealthy.

**Multi-instance readiness (2026-08)**: `web` and `ws` can now run as more than one container with
every default unchanged from single-instance behavior. If you add a new per-request file write, a
new rate-limited endpoint, or a new cron/scheduled job, check these invariants before assuming they
hold:
- File bytes go through `lib/storageDrivers/` (`readStoredFile`/`statStoredFile`/
  `openStoredFileStream`/`persistWebFile`/`persistUploadStream`/`persistBuffer` — all re-exported from
  `lib/storage.ts`). Never build a path from `STORAGE_DIR`/`relpath` yourself; a path built outside
  the driver is invisible to every instance except the one that wrote it.
- Anything that must be enforced fleet-wide (a rate limit, a lock, a "has this already run") goes
  through Redis or Postgres, not a module-level `Map`/counter — that state is per-process, not
  per-request.
- A cron/scheduled job that reads rows and later acts on them must claim its batch first
  (`FOR UPDATE SKIP LOCKED`, or a compare-and-set on the idempotency column) rather than
  read-then-act, or two schedulers/instances double-fire it. See `runDueFollowups()`
  (`lib/bms/followups.ts`) and `runScheduledDigests()` (`lib/bms/reportDigest.ts`) for the pattern —
  `releaseExpiredOrders()` (`lib/bms/orders.ts`) already did this correctly and is the reference
  example.
- `apps/ws` has no database connection at all (it only speaks to Redis pub/sub) — do not add one back
  without a real reason; it is what lets `ws` scale horizontally with zero extra config today.

Full history/rationale of what was found and fixed: § Multi-instance readiness in
[CLAUDE.local.md](../CLAUDE.local.md).

## Observability (`/admin/system-health`)

Platform-admin-only page (`requirePlatformAdminPage()` in its own `layout.tsx`, same gate as
`/admin/env`) that answers "how is the system doing right now" in one place instead of across four.
It is **read-only** — it must never gain a button that writes, restarts, or mutates anything.

`lib/bms/systemHealth.ts` is a **composition layer, not a new subsystem**. Two rules for extending it:

- Reuse the existing service if one exists (`listAiProviderHealth()`, `listLatestJobRunPerJob()`,
  `listOperationSchedules()` are consumed as-is). Only add a query here when the read genuinely does
  not exist yet — today that means Postgres/Redis vitals, the cross-tenant view of Channel Health
  (`channelHealth.ts` is tenant-scoped only), and `bms_failure_incidents` (which had no list page at
  all, only bell/Slack notifications).
- Every read returns `{ok:false, error}` instead of throwing. Migrations `7.36`/`7.55` are not applied
  everywhere, and one missing table must degrade to a single warning card, not a 500 on the whole page.

What it does **not** answer yet, so don't assume it does:

- **Which SQL query is slow.** That needs `pg_stat_statements`, which is preloaded in
  `docker-compose.yml` but requires a Postgres restart plus `CREATE EXTENSION` per database before any
  data exists. Until both are done there is no slow-query card.
- **REST route latency/errors.** Only GraphQL is instrumented (see the Request metrics item above).
  Next App Router has no central place to time a route handler, so REST needs per-route wrapping. Pass
  `rest:/api/bms/...` as the metric name when that happens; the prefix is the namespace, and
  `recordRequestMetric()` needs no change.
- **CPU/memory of the container.** Deliberately skipped: reading it would mean giving the app access
  to the Docker socket, which is a real privilege escalation surface. That is a decision to take
  explicitly, not a feature to add quietly.

Rank operations by *total* time (calls × avg), not p95 — a fast query called constantly usually costs
the database more than a slow one called rarely. The table defaults to that sort for this reason.

Full history/rationale, including the percentile-math test approach and what still isn't verified in a
live browser: § System Health + request metrics in [CLAUDE.local.md](../CLAUDE.local.md).

## i18n coverage (what "bilingual" actually means today)

There are **four i18n mechanisms in this codebase; treat the first three as real, the fourth as dead**:

- **`apps/web/i18n/` + `apps/web/lib/i18nContext.tsx`** (`I18nProvider`/`useI18n()`) — the main shared
  dictionary. `app/layout.tsx` reads a `lang` cookie server-side (default `"th"`) and passes it into
  `ClientProviders.tsx`'s `I18nProvider`, which wraps the whole app including admin. As of 2026-08-15
  the dictionaries in `apps/web/i18n/{th,en}.ts` hold **68 namespaces / 3,552 leaf keys per language**,
  at exact th↔en parity — up from ~12 before an initial 2026-08 public-page pass (see CLAUDE.md's
  "Public-page i18n coverage expanded" entry), 25 after it, 30 after the first admin batch, and the rest
  added by admin batches 2–17 (one `admin_*` namespace per page or page group, e.g. `admin_login`,
  `admin_billing`, `admin_products`, `admin_pharmacy_queue`, `admin_followup_queue`, `admin_audit`).
  **Always grep the actual file for the current list** — this doc's counts are a snapshot, not a live
  value, and have been wrong before. This is what a per-user language preference (see CLAUDE.md's
  "Per-user language preference") actually switches.
- **`apps/web/lib/static-page-i18n.ts`**'s `resolveBilingual()` — a page-local pattern, each page
  hand-rolling its own `{ en: T, th: T }` content object read via `resolveBilingual(CONTENT, lang)`.
  Used by the static/legal pages (`terms`, `privacy`, `pdpa`, `license`, `open-source`, `donate`,
  `roadmap`) plus `/support`, `/help`, and `/demo` (added 2026-08 — `/demo` additionally needed its
  keyword-based intent matcher extended to recognize both languages, since it's an interactive
  simulated chat, not static prose, and the customer's raw typed/starter text drives its logic
  regardless of UI language). Reach for this pattern for any new prose-heavy public page; it is *not*
  a shared dictionary, so don't expect keys to be visible to other pages.
- **Inline `lang === "en" ? {...} : {...}"` ternary** — functionally identical to `resolveBilingual()`
  but not routed through the shared helper. Used by the public product storefront
  (`app/(main)/shop/**`, all 8 files: `ShopDirectoryView.tsx`, `PublicProductCard.tsx`,
  `ShopLandingView.tsx`, `ShopProductsView.tsx`, `PublicProductView.tsx`, and the 3 route `page.tsx`
  metadata builders) and `/checkout`'s layout metadata. Fine as-is; prefer `resolveBilingual()` for
  *new* pages so there's one less pattern to remember, but don't "fix" these into it — they work.
- **`apps/web/lib/i18n.ts` + `lib/useTranslation.ts` + `apps/web/locales/`** — dead code. `grep` for
  `useTranslation(` outside its own definition returns zero hits anywhere in the app. Do not extend
  this; if you're touching it, delete it instead.

**Real coverage, as of 2026-08**: every public marketing/legal page, every auth form (login/register/
forgot/reset/verify-email — verify-email is now fully migrated, not partial), `/checkout`, the public
product storefront (`/shop/**`), and a long tail of previously-Thai-only public utility pages —
`/shop-signup`, `/settings` (the reachable Profile & Account/Security/My Posts/My Bookmarks panels;
its dead `UsersPanel`/`Files`/`Logs` sub-views, reachable only by manually setting React state since
their menu entries are commented out, were left English-only on purpose — not worth wiring dead UI),
`/search`, `/blocked`, `/notification`, `/chat` (the chat page itself is a ~3000-line legacy
English-only community feature; only 2 genuinely leaked Thai strings — a delete-confirm dialog and a
"typing…" indicator — needed fixing), `/coupon/wallet` (a public bearer-link page with no client
session, so it reads the `lang` cookie server-side via `getMessage()` rather than `useI18n()`),
`/help`, and `/demo`. **The admin app is ~62% converted as of 2026-08-13** (it was ~13% when this
paragraph was first written; batches 1–17 landed since) — of 78 `.tsx` files under
`apps/web/app/(admin)/admin/**`, **48** now carry a bilingual mechanism (`useI18n()`, or
`resolveBilingual()` for the two prose-heavy pages `admin/manual` and `admin/architecture`), and the
nav shell (`AdminSidebar.tsx`, `AdminLayoutClient.tsx`) and `admin/login/page.tsx` are converted too —
those are no longer the gap this paragraph used to flag. The remaining **30** files split into two
groups, neither of which is a Thai leak: trivial `layout.tsx`/`loading.tsx` guards with no user-visible
copy, and the **English-only legacy platform-admin pages** — `admin/roles`, `admin/logs` (×3),
`admin/files`, `admin/posts` + `admin/post/**`, `admin/operations-schedule`, `admin/dev/sql-console`.
Those predate BMS, contain no Thai at all, and would need translating *into* Thai rather than out of
it. Verified 2026-08-15 by dictionary audit: `i18n/th.ts` and `i18n/en.ts` are at exact key parity
(3,552 = 3,552 across 68 namespaces) and every `t("ns.key")` call site in `app`/`components`/`lib`
resolves to a real key — so there are currently **zero** raw-key-rendering bugs of the kind commit
`5832eb23` fixed. Re-run that audit rather than trusting these numbers; the useful one-liners are
`grep -rl "useI18n\|resolveBilingual" apps/web/app/\(admin\)` for the file list, plus a script that
flattens both dictionaries and diffs the key sets against the `t()` calls in the tree. **Deliberately still
Thai-only, not a gap to silently fix**:
`/live-dashboard` (still mock-data-only; its copy will likely be reworked once wired to real queries,
so translating now is wasted effort — see CLAUDE.md's "Live Dashboard" section). **English-only by
age, not a Thai leak**: the legacy pre-BMS community pages `/my/posts`, `/my/profile`, `/post/**`,
`/profile/[id]` — never localized either direction, out of scope. **Thai that a grep will flag but that
must NOT be "fixed"**: customer-facing brand-voice copy (the Inbox suggested-reply templates, the
restock notification body) stays Thai regardless of the staff member's UI language, same rule as
`applyGenderParticle()`; regexes that match a *customer's* raw typed Thai (`/สลิป|โอน|ชำระ/` in
`admin/inbox/page.tsx`) detect what a customer wrote, not UI copy; CRM tag **values**
(`ลูกค้าใหม่`/`ลูกค้าประจำ` in `admin/customers` and `admin/dashboard`) are stored data, not labels;
the Thai column headers in `admin/products/ImportModal.tsx` are the CSV/XLSX template's header-matching
map; `admin/playground`'s sample prompts are Thai test input for the Thai NLU pipeline; the `฿` suffix
is a currency symbol; and `admin/pharmacy-review-mockup`'s Thai is mock case data (only its chrome was
converted, on purpose). Separately, `components/AppLayout.tsx` has **zero importers anywhere in the
repo** — it is dead code carrying its own untranslated PDPA bar and app-download section; the live
footer/consent bar is `components/footer/AppFooter.tsx`, which is already bilingual via a page-local
`COPY.th/en`. Delete `AppLayout.tsx` rather than translating it. Generated report files
(`lib/bms/documentGenerator.ts`) have no language parameter and are English-label-only regardless of
the viewer's language (deliberate for PDF, due to `pdfkit`'s font gap; not deliberate for XLSX/CSV,
just not done).

If you're asked to "make X bilingual," check which of the mechanisms above (if any) the file already
uses before adding translated strings — most *admin* files use none, and adding real 2-language
support to the admin app is a from-scratch, many-file effort (extract strings into new dictionary
namespaces, not just add keys to existing ones), not a small addition to what's already there. Before
trusting any specific file/namespace/line claim in this section, verify it against the current code —
this section gets updated per-pass, not continuously, so treat counts as "true as of the date given,"
not as live. The DB-backed email template system (`getLatestEmailTemplate(key, locale)`, real
`th`/`en` rows with genuinely distinct translated copy, `en`-fallback if a locale is missing) is the
one subsystem that's already done well and needs no rework — model any future per-locale content
store on it, not on the admin UI's current state.

**Per-user preference pattern** (theme, language — reuse this shape for any future one): store it as
a plain `NOT NULL` column on `users` with a `CHECK` constraint and a sane default; expose it on both
`bmsMe`/`User` (GraphQL) and accept it on `MeInput`; whitelist-validate the incoming value inside
`updateMe` before it reaches the `UPDATE` (do not rely on the DB `CHECK` alone — the resolver must
reject bad values so a bad request never round-trips to a constraint-violation error); re-read it
fresh from Postgres in `/api/auth/me`'s `withUserPreferences()` rather than signing it into the JWT,
so a change on one device shows up on others without waiting for token expiry; and sync it onto the
device in `SessionLayer.tsx` only when it actually differs from the current local value (compare
before writing, or you risk redundant renders/loops). Theme applies purely client-side
(`lib/theme.ts`'s cookie+localStorage+DOM class, no server round-trip needed); language is read
server-side to pick a dictionary, so applying a change requires `router.refresh()` after writing the
`lang` cookie (`lib/lang.ts`), not just a client-side toggle — check which category a new preference
falls into before copying one pattern verbatim.

## Frontend and CSS Modules

- Keep public authentication routes synchronized with `isAuthPath()` in
  `apps/web/app/ClientProviders.tsx`. Public signup/login pages must not load the global session,
  chat, or notification wires unless they explicitly need them. `skipsSessionLayer()` in the same
  file is the wider gate that also covers non-auth public standalone routes such as `/checkout`; add
  new customer-facing pages there rather than widening `isAuthPath()`.
- The public checkout is a single responsive page on purpose. The wireframe in
  `docs/ui/customer-checkout-wireframe.md` is written as separate screens, but a multi-page flow
  loses the signed token in LINE/Messenger in-app browsers; keep each section's rules and acceptance
  criteria while rendering them in one page.
- Public marketing/auth surfaces are bilingual (`th`/`en`) and session-aware. If an admin session
  already exists, public CTAs should prefer "go to dashboard / manage store" over "sign up / log in"
  rather than presenting redundant entry points.
- A selector in `*.module.css` must contain at least one local class or ID. A selector made only
  from `:global(...)` fails Next.js compilation and can turn the route into a blank/500 page.
- When a CSS Module needs to target a global ancestor, combine it with a local class, for example
  `:global(.bms-auth-main):has(.page)`, or move a truly global rule to `app/globals.css`.
- Scope language-specific typography with the document language, such as
  `:global(html[lang="th"]) .heroTitle`; do not change English metrics to compensate for Thai
  stacked vowels and tone marks.
- After changing a route, layout, provider boundary, or CSS Module, open the exact route in the
  browser and verify that it compiles, renders, and remains usable at desktop and mobile widths.
- Large admin list pages must prefer server-backed search/filter arguments over client-only table
  filtering. Current patterns on Orders / Purchase / Payment / Shipping use debounced query-driven
  search so results stay correct even when the dataset exceeds the current page of rows.
- Product media is now a gallery, not just a single image. Preserve backward compatibility by
  keeping `bms_products.image_url` as the cover image while the full ordered gallery lives in
  `bms_product_images` and GraphQL `BmsProduct.images`.
- Inbox replies currently support a text body plus one attachment. Keep image/file/product sharing
  in the composer draft so staff can review before sending, and do not send `/admin/*` links to
  customers. Product links sent to customers must use the active-only public route
  `/shop/[tenantSlug]/products/[sku]`. The staff conversation may present saved text/image/file/
  public-product messages as different cards, but this presentation must not fork the underlying
  cross-channel `body + one attachment` payload contract.
- Customer 360 Quick Actions must reuse `createOrder()` for staff-created orders so price snapshots,
  CRM identity resolution, stock reservation, and rollback behavior stay identical to customer/AI
  orders. `bmsGenerateInvoice` is read-only and ephemeral; it must continue to use order-item price
  snapshots and must not create a parallel invoice source of truth.
- Bulk product import (`bmsImportProducts`, `lib/bms/productImport.ts`) must reuse the single-item
  `upsertProduct()` for the actual write and the shared `validateProductFields()` for validation, so
  quota, revision, and audit behavior stay identical to the manual product form. Preview
  (`commit:false`) and commit (`commit:true`) are the same mutation toggled by a flag — do not split
  preview into a separate query, and do not let the client's preview result be trusted as
  authoritative (the commit path re-validates server-side). Images are intentionally never imported.
- Shipping-address eligibility is a backend invariant, not only a disabled UI button. Both
  `shipOrder()` and `createShipment()` must reject `PACKING` orders without a CRM shipping address
  for LINE/Facebook/Instagram/Web/TikTok Chat. Only Lazada/Shopee are exempt because fulfillment
  addresses remain in Seller Center; TikTok in this codebase is chat commerce, not TikTok Shop.
- Profile editing should reuse the existing `bmsMe`, `updateMe`, and `uploadAvatar` flows rather
  than introducing parallel account-profile endpoints.
- Per-user UI theme (`users.theme_preference`, migration `7.50`) is read/written through `bmsMe`/
  `updateMe` like every other profile field, then applied to the browser via `lib/theme.ts`'s
  `getThemeMode()`/`setThemeMode()` — do not write the theme cookie/localStorage directly from a
  page component. `SessionLayer.tsx` is the one place that syncs a freshly loaded session's
  `themePreference` onto the local theme; `ThemeToggle` is the one place that pushes a manual toggle
  back to the server. Public/signed-out pages have no account to sync to and keep using the
  pre-existing local-only fallback.
- Inbox's `bmsConversations`/`bmsConversation` GraphQL fields take bounded `limit`/`messageLimit`/
  `eventLimit`/`noteLimit` arguments (`lib/bms/inbox.ts`, migration
  `7.51__bms_inbox_read_path_indexes.sql`). Do not reintroduce an unbounded read on either the list
  or the detail view — a busy tenant's conversation history is unbounded by nature.
- Thai polite particles in staff-facing text: an admin's own particle (ครับ vs ค่ะ) comes from
  `users.gender` (`'male'` → ครับ, `'female'`/null → ค่ะ), carried through `bmsMe.gender`. The Inbox
  "AI แนะนำคำตอบ" templates convert via `applyGenderParticle()` in the inbox page. This is only for
  text the admin sends as themselves — the customer-facing AI brand voice (`lib/bms/pipeline.ts`,
  `ai.ts`) stays ค่ะ and is not tied to any one admin's gender.
- Grid columns in shared chrome must be able to shrink. `.jachoei-header-shell` in
  `components/HeaderBar.tsx` uses `minmax(0, 1fr)` for its centre column because that column is
  **empty while signed in** (header search is disabled via `SHOW_HEADER_SEARCH`, and the product nav
  only renders for signed-out visitors). It previously reserved a hard `minmax(500px, 1fr)`, so
  adding one more right-hand quick-action button pushed the right column past the viewport, gave the
  whole document a horizontal scrollbar, and clipped the last header button on **every** page. When
  adding a header action, re-check the total width of `.jachoei-header-right` and prefer collapsing a
  label to an icon (with `Tooltip` + `aria-label`) over letting the row grow.
- A page-level `<style>{...}</style>` block in a client component is plain CSS, not a CSS Module and
  not styled-jsx. `:global(...)` inside it is invalid and silently dropped — target third-party
  classes (e.g. `.ant-alert-description`) with ordinary descendant selectors instead.
- Screens whose only purpose is watching numbers (currently `/live-dashboard`) must keep the primary
  figures reachable without scrolling on a phone. Wide children — channel strips, tables — scroll
  inside their own `overflow-x: auto` container; they must never widen the document. Explanatory
  banners get trimmed on small screens rather than pushing the data below the fold.
- When a comparison chart draws two series, normalise every series against one shared maximum.
  Scaling each line by its own maximum makes both peak at the same height and silently destroys the
  comparison the chart exists to show.
- Placeholder figures on an operator-facing screen must be unmistakable and self-documenting: a
  standing banner, a per-figure "ตัวอย่าง" tag explaining why, and a `// TODO(real):` comment naming
  the query that will replace it. Distinguish "not wired yet" (the data exists — e.g.
  `bmsOperationalAlerts`, `bmsSalesSummary().byChannel`) from "no data source exists" (live-stream
  viewers/comments/conversion, which need per-platform Live API work); never let the second kind
  imply the shop can already see it. A `?demo=1`-style bypass of the permission gate is acceptable
  only while a page has no real data to expose, and must be revisited when queries are connected.
- The Docker development stack owns its own `apps/web/.next` and `apps/web/node_modules` volumes.
  Do not remove those volume mounts or share the same Next.js output directory between host and
  container dev servers; mixed manifests cause App Router `clientModules` failures across routes.
