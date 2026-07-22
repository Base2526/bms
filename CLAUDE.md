# AI Business Management System (AI-BMS)

AI-BMS is an AI-first Business Management System that automates business operations from
customer conversations to order fulfillment. Unlike traditional ERP/CRM, it treats every customer
conversation as the starting point of a business workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

AI-BMS is **not** a chatbot — it is an AI Business Operating System. AI never touches the database
directly; it only calls approved backend tools. Business logic always lives in
`apps/web/lib/bms/*.ts` (shared by REST and GraphQL) — see [docs/architecture/system.md](docs/architecture/system.md)
for the full philosophy and module breakdown.

## Documentation map

| Doc | Covers |
| --- | --- |
| [docs/architecture/system.md](docs/architecture/system.md) | Vision, modules, build status, RBAC model, folder structure |
| [docs/architecture/database.md](docs/architecture/database.md) | Tables per module, RLS/tenant scoping, migration notes |
| [docs/architecture/api.md](docs/architecture/api.md) | REST routes, GraphQL modules, auth scopes |
| [docs/business/order.md](docs/business/order.md) | Order lifecycle, reorder, shipping |
| [docs/business/inventory.md](docs/business/inventory.md) | Stock rules, movement types, purchase orders |
| [docs/business/payment.md](docs/business/payment.md) | Payment methods, lifecycle, AI slip verification |
| [docs/business/crm.md](docs/business/crm.md) | Customer identity, addresses, omnichannel inbox rules |
| [docs/ai/workflow.md](docs/ai/workflow.md) | The AI pipeline (intent → tool → backend → reply) |
| [docs/ai/tools.md](docs/ai/tools.md) | Every tool AI is allowed to call |
| [docs/ai/prompts.md](docs/ai/prompts.md) | The actual Claude system prompt + guardrails |
| [docs/integrations/line.md](docs/integrations/line.md) | LINE webhook/reply |
| [docs/integrations/tiktok.md](docs/integrations/tiktok.md) | TikTok webhook (send API = roadmap) |
| [docs/integrations/lazada.md](docs/integrations/lazada.md) | Lazada + Shopee beta scaffold — what's real vs. placeholder |
| [docs/ui/customer360.md](docs/ui/customer360.md) | Inbox "ลูกค้า" purchase-history tab, cross-channel merge, reorder |
| [docs/ui/inbox-diagnostics.md](docs/ui/inbox-diagnostics.md) | Admin-only realtime diagnostics: `Emit` vs `Create Msg` |
| [docs/ui/dashboard.md](docs/ui/dashboard.md) | Dashboard & Reports |
| [docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md) | Rules for AI features, AI-generated content, and approval boundaries |
| [CLAUDE.local.md](CLAUDE.local.md) | Machine-local dev notes (not a spec — run commands, gotchas, lessons learned) |

## Current status (2026-07)

Every module is **fully built** except Shopee/Lazada (🧪 beta scaffold — see
[docs/integrations/lazada.md](docs/integrations/lazada.md)) and the roadmap items below. Full
build-status table: [docs/architecture/system.md](docs/architecture/system.md#build-status-2026-07).

**Customer 360 (Inbox right panel)** — ✅ implemented, not yet folded into the docs/ tree above
(built on a parallel branch to the docs restructure — see [CLAUDE.local.md](CLAUDE.local.md) §
Customer 360 for full detail pending a proper `docs/ui/` page): `lib/bms/customer360.ts` ·
migration `6.2__bms_customer_360.sql` · GraphQL `bmsCustomer360`/`bmsCustomerTimeline`/
`bmsCustomerInsights` · UI `Customer360Panel.tsx`. Inbox (`/admin/inbox`) is a real 3-column
layout — conversation list · message thread · this panel — showing summary/contact/stats/recent
orders/products/cart/notes (eager) plus a lazy cross-channel timeline and AI-generated insights
(computed from a real facts bundle only, never invented — same discipline as `verifyPaymentSlip()`).
This is a different, richer view than the "ลูกค้า" purchase-history tab documented in
[docs/ui/customer360.md](docs/ui/customer360.md); both coexist.

**Recent frontend/admin additions (2026-07)** — ✅ implemented:

- **Public landing + signup refresh**: `/` is now an interactive bilingual infographic with
  session-aware CTAs (logged-in admins are sent toward `/admin/dashboard`, logged-out users toward
  `/shop-signup`). `/shop-signup` was rebuilt with auth-safe provider boundaries and pure CSS Module
  selectors to avoid the blank/500 page failure mode.
- **Product gallery**: products support multiple images through migration
  `6.5__bms_product_images.sql`; `image_url` remains the cover image for backward compatibility and
  `images[]` is the ordered gallery used by the Products page.
- **Admin profile editing**: `/admin/profile` now supports avatar upload plus self-editing of
  name/phone/language/gender via `bmsMe`, `uploadAvatar`, and `updateMe`.
- **Gender-aware Inbox suggested replies**: admins set their gender in `/admin/profile`
  (migration `7.15__bms_users_gender.sql` → `users.gender`, exposed on `bmsMe.gender`); the Inbox
  "AI แนะนำคำตอบ" templates then end with ครับ for male admins and ค่ะ for female/unset (via
  `applyGenderParticle()`). Customer-facing AI brand voice stays ค่ะ and is unaffected.
- **Operational search on admin pages**: Orders / Purchase / Payment / Shipping now use server-side
  search arguments with debounced live search, while Customers keeps its existing search by
  name/phone.
- **Inbox realtime diagnostics**: `/admin/inbox/realtime-diagnostics` is Administrator/platform-admin
  only. `Emit` verifies Redis/WebSocket delivery without writing DB rows; `Create Msg` creates a
  diagnostic Inbox message for the current tenant without sending anything to external platforms.
- **LINE profile display cache**: LINE webhooks now best-effort sync `displayName`/`pictureUrl`
  into `bms_customer_identities` after the critical Inbox write/reply path. Inbox may display the
  cached profile as fallback, but staff-maintained CRM fields stay authoritative.
  See [docs/ui/inbox-diagnostics.md](docs/ui/inbox-diagnostics.md).
- **AI tool-calling (customer + staff assistant)**: Claude now calls real backend tools instead of
  keyword-matching NLU. Customer-facing pipeline (`lib/bms/pipeline.ts`) tries AI tool-calling first
  (falls back to the old deterministic rule-based path only when no AI credentials/quota exist).
  Staff get a separate `/admin/assistant` page (`bmsAssistant` mutation) with the full read/write
  tool catalog, filtered by their own RBAC and re-checked at execution time; every tool attempt is
  recorded as redacted `ai.tool_call` audit metadata. Sensitive actions (refund, cancel, adjust stock, merge
  customers, …) are **propose-only** — the AI prepares a request, a human clicks Confirm, and that
  fires the same permission-gated mutation the admin UI already used. See
  [docs/ai/workflow.md](docs/ai/workflow.md) and [docs/ai/tools.md](docs/ai/tools.md) for the full
  design, and § AI tool-calling in [CLAUDE.local.md](CLAUDE.local.md) for gotchas/example usage.
- **AI tool catalog — batch 2 (store / documents / forecast / AI-native / outbound)**: the catalog now
  also covers **store profile** (migrations `6.9`/`7.17__bms_store_profile*` — hours/address/policies/
  receiving accounts/shipping config, plus contact email/website/logo/tax id/timezone/country/currency,
  edited at `/admin/settings`; tools `get_store_info`/`get_payment_info`/`get_shipping_estimate` let AI
  answer the shop-info questions customers ask most). **Shop name is a single source** — `bms_tenants.name`
  (the store-profile `store_name` column is deprecated); a shop **Administrator can now rename their own
  tenant name + slug** via `bmsUpdateMyTenant` (self-service, gated `requireTenantAdmin`; plan/active
  remain platform-admin only; **slug is read-only in the UI** — the `bmsUpdateMyTenant` mutation still
  accepts it but the Settings card sends only the name, since no route/webhook uses slug yet, it's a
  reserved handle). Also **documents**
  (`generate_invoice`/`generate_quotation`, `lib/bms/documents.ts`), **forecasting**
  (`forecast_demand`/`predict_stockout`/`suggest_purchase_order`, `lib/bms/forecast.ts` — heuristic
  velocity, always tagged with uncertainty), **AI-native helpers** (`detect_language`, `classify_intent`,
  `summarize_conversation`, `recommend_products`), and **propose-only outbound**
  (`send_customer_message` → `bmsSendMessage`, LINE/Meta only). See [docs/ai/tools.md](docs/ai/tools.md).
- **Revision History**: BMS now has tenant-scoped revision snapshots via migrations `7.0`–`7.14`.
  The `/admin/revisions` page can list recent revisions, inspect a snapshot, and compare two
  versions for products, orders, payments, and shipments. Product/inventory writes pass the logged-in
  admin id into `beginTenantTx()`, so new revision rows show the editor label instead of `system`.

**Roadmap remaining:** TikTok send API · email/voice outbound · real carrier API (label PDF/auto-tracking) ·
AI OCR (beyond payment-slip verify) · ML-grade forecasting (current is heuristic) · WhatsApp AI ·
Shopee/Lazada signature verification against real Open Platform docs · letting shop owners
(Manager role) manage their own staff.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the database directly — only approved tools in
  [docs/ai/tools.md](docs/ai/tools.md).
- AI **never** fabricates stock/price/order numbers — facts always come from the backend.
- Sensitive actions (delete, refund, cancel, change price, adjust inventory) require **human
  confirmation + RBAC permission**.
- Every AI tool attempt is audited without raw arguments/PII; successful writes and confirmed
  proposals retain their normal domain audit entries as well.
- High-impact BMS records use revision history for before/after snapshots; audit log remains the
  source for who/when/action events.

Full rules and enum values actually enforced in code: [docs/business/](docs/business/).

## Frontend conventions

- Public product pages live in `apps/web/app/(main)/`; public login, verification, and shop
  creation pages live in `apps/web/app/(auth)/`.
- Keep every public auth route, including `/shop-signup`, synchronized with `isAuthPath()` in
  `apps/web/app/ClientProviders.tsx` so it does not initialize session/chat wires unnecessarily.
- CSS Modules use pure selectors: every selector in `*.module.css` must include a local class or
  ID. Global-only selectors such as `:global(.parent:has(...))` fail the Next.js build. Use a local
  class in the selector (`:global(.parent):has(.localClass)`) or place the rule in `app/globals.css`.
- The landing page uses the shared `I18nProvider` and the `lang` cookie for Thai/English content.
  Thai-only typography adjustments must be scoped through `html[lang="th"]` so English layout is
  unchanged.
- Public CTAs should react to session state. When a valid admin session already exists, prefer
  taking the user back into operations (`/admin/dashboard`) instead of showing redundant
  "start free" / "log in" entry points.
- Search-heavy admin pages should use GraphQL args and backend filtering, not just in-memory table
  filtering. This is now the expected pattern for Orders / Purchase / Payment / Shipping.
- Verify the exact public route in a browser after changing its page, layout, provider boundary,
  or CSS Module; a TypeScript check alone does not catch CSS selector compilation errors.
- `docker-compose.dev.yml` isolates `/app/apps/web/.next` and `/app/apps/web/node_modules` in Docker
  volumes. Keep this isolation: host macOS and container Linux must not write the same Next.js
  manifests or native dependencies.
