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

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web/lib/bms/` | Shared business services and the only BMS application layer allowed to run SQL |
| `apps/web/app/api/bms/` | REST endpoints, webhooks, cron, and test routes |
| `apps/web/graphql/` | GraphQL schema and resolvers used by the admin UI |
| `apps/web/app/(admin)/admin/` | Admin UI |
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
- Machine-local commands and known development issues in `CLAUDE.local.md`

When documentation and code disagree, inspect migrations and the service implementation before
changing behavior. Update the affected documentation in the same change.

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
- Profile editing should reuse the existing `bmsMe`, `updateMe`, and `uploadAvatar` flows rather
  than introducing parallel account-profile endpoints.
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
