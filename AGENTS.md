# AGENTS.md

This file defines how coding agents should work in the AI-BMS repository. It applies to the
entire repository unless a more specific `AGENTS.md` exists in a subdirectory.

## Product context

AI-BMS is an AI-first business operating system that turns customer conversations into business
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
| `apps/web/app/(admin)/admin/revisions/` | Revision History UI: list/detail/compare snapshots for products, orders, payments, and shipments |
| `apps/web/app/(main)/` | Public landing page, interactive product overview, and pricing |
| `apps/web/app/(auth)/` | Public authentication and shop-signup pages |
| `apps/web/app/(admin)/admin/manual/` | In-app operator manual for shop staff/admins |
| `apps/ws/` | WebSocket gateway |
| `packages/` | Shared GraphQL, realtime, and queue packages |
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
  only customer-safe tools (`customerTools()`): read product/stock/own-order-status, plus
  `create_order`/`submit_payment`/`reorder`. No sensitive tool is ever exposed here. AI-first; falls
  back to the old deterministic rule-based path only when the tenant has no AI credentials or has
  exhausted its shared-key quota — never mid-loop, to avoid duplicate writes.
- **Staff** (`graphql/bmsAssistant.ts`, UI `/admin/assistant`) — `staffTools(perms)` filtered by the
  calling admin's own RBAC permissions; `runtime.ts` calls `requirePermission()` again immediately
  before execution. Read tools and non-sensitive writes execute directly; sensitive tools (refund,
  cancel order/PO/shipment, adjust stock, merge customers,
  confirm/reject payment) are **propose-only** — the tool returns a proposal object instead of
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

Adding a new AI tool: wrap the existing `lib/bms/*.ts` function in `tools/catalog.ts` (validate
model-supplied args, derive `tenantId` from `ExecCtx`, add a domain `audit()` for writes, and assign
the surface + staff permission. If it is refund/cancel/delete/adjust-inventory/merge-like, mark it
`sensitive: true` and return a proposal instead of executing),
then update [docs/ai/tools.md](docs/ai/tools.md). Never let a tool description promise a capability the
backend does not implement. See § "AI tool-calling — example usage" in
[CLAUDE.local.md](CLAUDE.local.md) for runnable `curl`/GraphQL examples against both surfaces.

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

## Frontend and CSS Modules

- Keep public authentication routes synchronized with `isAuthPath()` in
  `apps/web/app/ClientProviders.tsx`. Public signup/login pages must not load the global session,
  chat, or notification wires unless they explicitly need them.
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
- Shipping-address eligibility is a backend invariant, not only a disabled UI button. Both
  `shipOrder()` and `createShipment()` must reject `PACKING` orders without a CRM shipping address
  for LINE/Facebook/Instagram/Web/TikTok Chat. Only Lazada/Shopee are exempt because fulfillment
  addresses remain in Seller Center; TikTok in this codebase is chat commerce, not TikTok Shop.
- Profile editing should reuse the existing `bmsMe`, `updateMe`, and `uploadAvatar` flows rather
  than introducing parallel account-profile endpoints.
- Thai polite particles in staff-facing text: an admin's own particle (ครับ vs ค่ะ) comes from
  `users.gender` (`'male'` → ครับ, `'female'`/null → ค่ะ), carried through `bmsMe.gender`. The Inbox
  "AI แนะนำคำตอบ" templates convert via `applyGenderParticle()` in the inbox page. This is only for
  text the admin sends as themselves — the customer-facing AI brand voice (`lib/bms/pipeline.ts`,
  `ai.ts`) stays ค่ะ and is not tied to any one admin's gender.
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

## Definition of done

A change is complete when architecture boundaries remain intact, tenant/RBAC rules are enforced,
sensitive actions remain human-controlled, relevant checks pass, and documentation reflects the
implemented behavior.
