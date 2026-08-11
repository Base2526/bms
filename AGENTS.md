# AGENTS.md

This file defines how coding agents should work in the BMS repository. It applies to the
entire repository unless a more specific `AGENTS.md` exists in a subdirectory.

## Product context

BMS is an AI-first business operating system that turns customer conversations into business
workflows:

```text
Customer -> AI -> CRM -> Order -> Inventory -> Payment -> Shipping -> Dashboard
```

It is not a general-purpose chatbot. The database and backend services are the source of truth;
AI interprets intent, selects approved tools, and explains verified results.

Read [AI_GUIDELINES.md](docs/AI_GUIDELINES.md) before changing prompts, AI orchestration, AI tools,
payment-slip analysis, or any AI-generated customer response.

## Architecture boundaries

- Put business logic and database access in `apps/web/lib/bms/*.ts`.
- REST routes in `apps/web/app/api/bms/*` and GraphQL resolvers in `apps/web/graphql/*` must remain
  thin adapters that authenticate, authorize, validate, call a service, and format the result.
- Frontend components must not implement authoritative business rules or access the database.
- AI code must never query the database or generate SQL. It may use only approved backend tools.
- Every tenant-owned operation must be scoped by tenant and protected by RLS.
- Sensitive mutations require both RBAC permission and explicit human confirmation.
- A backend service in `lib/bms/*.ts` is not automatically an AI tool — it must be wrapped as one in
  `apps/web/lib/bms/tools/catalog.ts` (arg validation, server-derived tenant, permission, audit)
  before a model can call it. See "AI tool-calling" below.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web/lib/bms/` | Shared business services and the only BMS application layer allowed to run SQL |
| `apps/web/lib/bms/tools/` | AI tool catalog + Claude tool-calling runtime (`types.ts`/`runtime.ts`/`catalog.ts`) shared by the customer pipeline and the staff assistant |
| `apps/web/app/api/bms/` | REST endpoints, webhooks, cron, and test routes |
| `apps/web/graphql/` | GraphQL schema and resolvers used by the admin UI (`bmsAssistant.ts` = staff AI assistant) |
| `apps/web/app/(admin)/admin/` | Admin UI |
| `apps/web/app/(admin)/admin/assistant/` | Staff AI assistant chat UI (proposal cards for sensitive actions) |
| `apps/web/app/(admin)/admin/revisions/` | Revision History UI: list/detail/compare snapshots for products, orders, payments, shipments, and purchase orders (header + line items) |
| `apps/web/app/(main)/` | Public landing page, interactive product overview, pricing, and `/live-dashboard` (session-gated live sales monitor; layout only, mock data) |
| `apps/web/app/(auth)/` | Public authentication and shop-signup pages |
| `apps/web/app/(checkout)/` | Public signed-link customer checkout (`/checkout?t=<token>`); no admin session, no login |
| `apps/web/app/(admin)/admin/manual/` | In-app operator manual for shop staff/admins |
| `apps/ws/` | WebSocket gateway |
| `packages/` | Shared GraphQL and realtime (Redis pub/sub) packages |
| `db/migrations/` | Ordered, idempotent database migrations |
| `docs/` | Architecture, business rules, integrations, AI, and UI documentation |
| `scripts/bms-log-triage/` | Daily redacted-log analysis and draft-PR workflow |

## Source-of-truth documentation

Consult the relevant document before changing a domain:

- [System architecture](docs/architecture/system.md)
- [Database, tenant scoping, and RLS](docs/architecture/database.md)
- [REST, GraphQL, and auth](docs/architecture/api.md)
- [Orders](docs/business/order.md), [inventory](docs/business/inventory.md),
  [payments](docs/business/payment.md), and [CRM](docs/business/crm.md)
- [AI workflow](docs/ai/workflow.md), [approved tools](docs/ai/tools.md), and
  [prompts](docs/ai/prompts.md)
- Channel-specific behavior in `docs/integrations/`
- Public product sharing in `docs/ui/public-products.md`
- Machine-local commands and known development issues in `CLAUDE.local.md`

When documentation and code disagree, inspect migrations and the service implementation before
changing behavior. Update the affected documentation in the same change.

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
then update [docs/ai/tools.md](docs/ai/tools.md). Never let a tool description promise a capability the
backend does not implement. Any new customer-facing product/catalog tool should reuse
`listSellableProducts()`/`resolveSellableProduct()`/`findAlternativeProducts()` in
`lib/bms/products.ts` instead of writing a parallel product query — they already scope to
active + in-stock and are the only bounded reads covered by the `pg_trgm` indexes added in
migration `7.33__bms_product_discovery_indexes.sql`; an unindexed `ILIKE` scan on `bms_products`
will not use them. See § "AI tool-calling — example usage" in
[CLAUDE.local.md](CLAUDE.local.md) for runnable `curl`/GraphQL examples against both surfaces.
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
- Auth rate limiting currently reuses the bounded in-memory limiter with IP and hashed-identity keys.
  It is per instance and fail-local; move it to Redis before treating it as distributed production
  protection. Never put raw email, username, token, or password into a rate-limit key/log.
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

## Redis usage (pub/sub, cache, sessions, job runs)

Redis backs four distinct things in this app — do not conflate them or add a fifth ad hoc client:

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

Redis has no password/TLS configured in any compose file as of 2026-08 — acceptable while it only held
pub/sub, more of a real gap now that it also holds session ids and (transiently) store payment-account
data via the cache. Treat "add Redis auth" as outstanding before a production deployment that doesn't
already isolate Redis at the network layer.

## Working method

1. Inspect the service, API adapters, UI caller, schema/migration, and relevant docs before editing.
2. Make the smallest coherent change that preserves existing public behavior unless the task
   explicitly changes that behavior.
3. Reuse existing services, permission helpers, transaction helpers, and UI patterns.
4. Validate at the boundary: treat webhook payloads, API inputs, model output, and JSON fields as
   untrusted data.
5. Verify the narrowest affected surface first, then run the broader available build/type checks.
6. Report what changed, what was verified, and any remaining risk or unverified dependency.

Do not modify unrelated user changes, secrets, local environment files, generated artifacts, or
database dumps. Never commit `.env*`, access tokens, customer data, or credentials.

## i18n coverage (what "bilingual" actually means today)

There are **four i18n mechanisms in this codebase; treat the first three as real, the fourth as dead**:

- **`apps/web/i18n/` + `apps/web/lib/i18nContext.tsx`** (`I18nProvider`/`useI18n()`) — the main shared
  dictionary. `app/layout.tsx` reads a `lang` cookie server-side (default `"th"`) and passes it into
  `ClientProviders.tsx`'s `I18nProvider`, which wraps the whole app including admin. As of 2026-08 the
  dictionaries in `apps/web/i18n/{th,en}.ts` have **30 namespaces** (`common, login, register, forgot,
  reset, shopSignup, verify, header, landing, footer, notificationPage, searchPage, blockedPage,
  chatPage, couponWallet, postPage, roadmap, checkout, admin, admin_dashboard, admin_orders,
  admin_reports, settingsPage, admin_settings, admin_store_profile, admin_report_subscription,
  admin_inbox_mentions, admin_inbox_diagnostics, admin_inbox_customer360, admin_inbox`) — up from ~12
  before an initial 2026-08 pass (see CLAUDE.md's "Public-page i18n coverage expanded" entry) and up
  from 25 after a second, admin-focused pass added `admin_inbox` and picked up 3 admin-Inbox namespaces
  (`admin_inbox_mentions`/`admin_inbox_diagnostics`/`admin_inbox_customer360`) that had been added in an
  earlier untracked change without this doc being updated — **always grep the actual file for the
  current list**, this doc's namespace count is a snapshot, not a live value, and has already been
  wrong once. This is what a per-user language preference (see CLAUDE.md's "Per-user language
  preference") actually switches.
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
`/help`, and `/demo`. **The admin app is ~13% converted as of 2026-08, not 0% anymore, but the nav
shell and the vast majority of pages are still untouched** — of 78 `.tsx` files under
`apps/web/app/(admin)/admin/**`, exactly **10** call `useI18n()` and have no remaining literal-Thai UI
copy: `admin/dashboard/page.tsx`, `admin/orders/page.tsx`, `admin/reports/page.tsx`,
`admin/settings/page.tsx`, `admin/settings/StoreProfileCard.tsx`,
`admin/settings/ReportSubscriptionCard.tsx`, `admin/inbox/page.tsx`,
`admin/inbox/Customer360Panel.tsx`, `admin/inbox/mentions/page.tsx`, and
`admin/inbox/realtime-diagnostics/page.tsx`. The other **68 files, including the admin nav shell itself
(`AdminSidebar.tsx`, `AdminLayoutClient.tsx`) and `admin/login/page.tsx`**, have no `useI18n()` call and
contain literal Thai (or, for `admin/login/page.tsx`, a mix of hardcoded English and Thai with no
switching mechanism at all — flagged as the top remaining priority since it's the one page every admin
sees pre-authentication). Before starting any new admin i18n work, re-run
`grep -rl "useI18n" apps/web/app/\(admin\)` to get the current file list — this count moves every time
someone converts another page and this doc is not updated automatically. **Deliberately still
Thai-only, not a gap to silently fix**:
`/live-dashboard` (still mock-data-only; its copy will likely be reworked once wired to real queries,
so translating now is wasted effort — see CLAUDE.md's "Live Dashboard" section). **English-only by
age, not a Thai leak**: the legacy pre-BMS community pages `/my/posts`, `/my/profile`, `/post/**`,
`/profile/[id]` — never localized either direction, out of scope. Generated report files
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

## Database and migration rules

- Add a new numbered migration; never rewrite a migration that may already have been applied.
- Migrations must be safe to re-run and follow the guarded/idempotent style already in
  `db/migrations/`.
- Every new tenant-owned `bms_*` table needs `tenant_id`, RLS policy, and the correct `bms_app`
  grants. Follow migrations `4.2__bms_rls.sql` and `4.3__bms_rls_role.sql`.
- Use `beginTenantTx()` for tenant writes and keep multi-step stock/order/payment changes atomic.
- When a tenant write should be attributable in revision history, pass the logged-in admin/user id to
  `beginTenantTx(client, tenantId, { editorId })`; the revision trigger reads `app.editor_id` and
  `app.revision_id` from the transaction.
- Use parameterized queries. Never interpolate user input into SQL.
- Preserve append-only audit/history semantics where applicable.
- Document new tables, states, constraints, and migration dependencies in
  `docs/architecture/database.md` and the relevant business document.
- If a change affects operator-facing workflows, update the in-app manual at
  `apps/web/app/(admin)/admin/manual/page.tsx` in the same change as the code/docs update.
- Inbox diagnostics are intentionally split: `Emit` only publishes a tenant-scoped realtime
  invalidation event and must not create rows or contact external platforms; `Create Msg` creates
  diagnostic Inbox rows but must still avoid the AI pipeline and any external channel send.

## Authentication, tenancy, and RBAC

- Resolve tenant context with the established helpers; do not accept an arbitrary tenant ID from
  an authenticated client as authority.
- GraphQL mutations normally follow: permission check -> tenant resolution -> service call ->
  audit.
- Add new permissions to `BMS_PERMISSIONS` in `apps/web/lib/bms/permissions.ts`; do not maintain a
  separate frontend permission catalog.
- Platform-admin access and tenant-role access are separate. Cross-tenant data must only be viewed
  through the established drill-down/impersonation flow.
- Return `401` for missing or invalid authentication and `403` for an authenticated user without
  permission. Do not turn a permission failure into a logout.
- Hiding a menu item is not authorization; enforce access on the server.

## API and integration rules

- REST and GraphQL must call the same service functions so business behavior cannot diverge.
- Verify webhook signatures before processing events. Keep the Shopee/Lazada implementation
  explicitly marked beta until verified against official platform documentation.
- Make webhook handlers idempotent where platforms can retry delivery.
- Do not log raw tokens, secrets, payment details, or unnecessary customer PII.
- Preserve channel-health semantics: `active` is an admin switch; `status` describes observed
  connection health.
- External channel profile data (for example LINE display name/avatar) is cached on
  `bms_customer_identities` for display fallback only. Do not call profile APIs from list renders or
  GraphQL read resolvers, and do not overwrite staff-maintained CRM customer fields from a
  background profile sync.
- Realtime diagnostic routes/mutations must be Administrator/platform-admin only, tenant-scoped,
  audited, and safe to run in production without messaging real customers.
- If adding a channel, update every duplicated channel type/allowlist and the integration docs.

## Testing and verification

There is no repository-wide test script. Use checks proportional to the change:

```bash
cd apps/web && npx tsc --noEmit
cd apps/web && npm run build
cd apps/ws && npm run build
cd packages/graphql-core && npm run build
cd packages/realtime && npm run build
```

- Do not claim a check passed unless it was run successfully.
- For schema changes, validate migration ordering, idempotency, RLS, grants, and tenant isolation.
- For API changes, test authentication, permission denial, invalid input, and the success path.
- For order/inventory/payment changes, test state transitions, transaction rollback, duplicate
  requests, and stock invariants.
- For AI changes, test verified facts, missing facts, malformed model output, provider failure, and
  deterministic fallback behavior.
- For signed-link/checkout changes, run the deterministic contract suites from `apps/web` (see
  [scripts/ai-eval/README.md](scripts/ai-eval/README.md)); they need no network or database:

```bash
cd apps/web && npx tsx --test ../../scripts/ai-eval/archetype-policy-contract.test.mts
cd apps/web && npx tsx --test ../../scripts/ai-eval/restock-lifecycle-contract.test.mts
cd apps/web && npx tsx --test ../../scripts/ai-eval/checkout-token-contract.test.mts
```

## Definition of done

A change is complete when architecture boundaries remain intact, tenant/RBAC rules are enforced,
sensitive actions remain human-controlled, relevant checks pass, and documentation reflects the
implemented behavior.
