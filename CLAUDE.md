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
| [docs/ui/public-products.md](docs/ui/public-products.md) | Public product detail/gallery URLs shared from Inbox |
| [docs/ui/inbox-diagnostics.md](docs/ui/inbox-diagnostics.md) | Admin-only realtime diagnostics: `Emit` vs `Create Msg` |
| [docs/ui/dashboard.md](docs/ui/dashboard.md) | Dashboard & Reports |
| [docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md) | Rules for AI features, AI-generated content, and approval boundaries |
| [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | How to run the deterministic runtime-contract and live-model AI evals |
| [CLAUDE.local.md](CLAUDE.local.md) | Machine-local dev notes (not a spec — run commands, gotchas, lessons learned) |

## Current status (2026-07)

Every module is **fully built** except Shopee/Lazada (🧪 beta scaffold — see
[docs/integrations/lazada.md](docs/integrations/lazada.md)) and the roadmap items below. Full
build-status table: [docs/architecture/system.md](docs/architecture/system.md#build-status-2026-07).

**Customer 360 (Inbox right panel)** — ✅ implemented and documented in
[docs/ui/customer360.md](docs/ui/customer360.md): `lib/bms/customer360.ts` · migration
`6.2__bms_customer_360.sql` · GraphQL `bmsCustomer360`/`bmsCustomerTimeline`/
`bmsCustomerInsights` · UI `Customer360Panel.tsx`. Inbox (`/admin/inbox`) is a real 3-column
layout — conversation list · message thread · customer panel — showing summary/contact/stats/recent
orders/products/cart/notes (eager) plus a lazy cross-channel timeline and fact-grounded AI insights.
Staff with `order.create` can create a `PENDING` order for the active customer directly from Quick
Actions; stock is reserved atomically at current prices. Staff with `order.view` can render and print
an ephemeral invoice from an existing order (snapshot prices; no document row is persisted).

**Recent frontend/admin additions (2026-07)** — ✅ implemented:

- **Public landing + signup refresh**: `/` is now an interactive bilingual infographic with
  session-aware CTAs (logged-in admins are sent toward `/admin/dashboard`, logged-out users toward
  `/shop-signup`). `/shop-signup` was rebuilt with auth-safe provider boundaries and pure CSS Module
  selectors to avoid the blank/500 page failure mode.
- **Product gallery**: products support multiple images through migration
  `6.5__bms_product_images.sql`; `image_url` remains the cover image for backward compatibility and
  `images[]` is the ordered gallery used by the Products page.
- **Public product pages**: `/shop/[tenantSlug]/products/[sku]` exposes active products from active
  shops without login, including the gallery, price, description, and available stock by size. Inbox
  product sharing stages this customer-safe URL in the editable draft and optionally attaches only
  the cover image; `/admin/products` remains staff-only.
- **Admin profile editing**: `/admin/profile` now supports avatar upload plus self-editing of
  name/phone/language/gender via `bmsMe`, `uploadAvatar`, and `updateMe`.
- **Bulk product import (CSV/XLSX)**: `/admin/products` "นำเข้า" button opens `ImportModal.tsx`,
  which parses the file client-side (`xlsx`) and drives a preview-then-commit flow over one
  mutation, `bmsImportProducts(items, commit)` — `commit:false` validates only, `commit:true` writes
  by looping the existing single-item `upsertProduct()`. No images in the file (added afterward via
  the normal edit form); duplicate SKUs in-file and quota-exceeding imports are rejected as a whole
  rather than partially applied. See
  [docs/business/inventory.md](docs/business/inventory.md#bulk-product-import-csvxlsx) and
  [docs/architecture/api.md](docs/architecture/api.md) for the full rules.
- **Gender-aware Inbox suggested replies**: admins set their gender in `/admin/profile`
  (migration `7.15__bms_users_gender.sql` → `users.gender`, exposed on `bmsMe.gender`); the Inbox
  "AI แนะนำคำตอบ" templates then end with ครับ for male admins and ค่ะ for female/unset (via
  `applyGenderParticle()`). Customer-facing AI brand voice stays ค่ะ and is unaffected.
- **Compact Inbox workspace**: the conversation queue and active-chat header use compact controls
  to preserve message space. Recent orders open in an in-context preview first, with the full Orders
  page available in a new tab. The composer stages one image/file attachment with the text draft;
  the product picker can stage product text alone or product text plus its cover image. The internal
  Products link opens in a new tab for staff, while the public product link is included in the
  editable customer draft. Saved messages render as four compact types: sender-colored text bubbles,
  light image cards, file cards, and public-product cards with cover/price/stock/`ดูสินค้า`; the
  cross-channel `body + one attachment` contract remains unchanged.
- **Operational search on admin pages**: Orders / Purchase / Payment / Shipping now use server-side
  search arguments with debounced live search, while Customers keeps its existing search by
  name/phone.
- **Fulfillment address guard**: LINE/Facebook/Instagram/Web/TikTok Chat orders must have a CRM
  shipping address before either `shipOrder()` or `createShipment()` can move them from `PACKING`
  to `SHIPPED`. Lazada/Shopee are exempt because their address remains in Seller Center. The Orders
  page exposes `hasShippingAddress` and links operators to Customers when the address is missing.
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
- **Deterministic AI routing + eval suites**: unambiguous customer intents (own-order status, payment
  submission, reorder, coupon wallet, and a fully confirmed single-item order) are routed by the
  server through `runApprovedTool()` — the same authorization, argument-validation, and audit boundary
  as model-selected calls, minus provider tool-selection variance. Within one provider loop, a
  repeated successful tool call replays its earlier result instead of writing twice, and every
  customer reply passes one sanitizer that shortens UUIDs and keeps the shop's `ค่ะ` brand voice.
  Verification lives in [`scripts/ai-eval/`](scripts/ai-eval/README.md): a deterministic runtime
  contract suite (no network/DB) plus a live-model end-to-end suite that asserts backend state — see
  [docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md#evaluation-checklist). Live evals write real data, so
  they run against development/sandbox tenants only.
- **AI tool catalog — batch 2 (store / documents / forecast / AI-native / outbound)**: the catalog now
  also covers **store profile** (migrations `6.9`/`7.17__bms_store_profile*` — hours/address/policies/
  receiving accounts/shipping config, plus contact email/website/logo/tax id/timezone/country/currency,
  edited at `/admin/settings`; tools `get_store_info`/`get_payment_info`/`get_shipping_estimate` let AI
  answer the shop-info questions customers ask most). **Shop name is a single source** — `bms_tenants.name`
  (the store-profile `store_name` column is deprecated); a shop **Administrator can now rename their own
  tenant name + slug** via `bmsUpdateMyTenant` (self-service, gated `requireTenantAdmin`; plan/active
  remain platform-admin only; **slug is read-only in the UI** — it is now the stable handle in public
  product URLs, while the `bmsUpdateMyTenant` mutation remains available for controlled changes and
  the Settings card sends only the name). Also **documents**
  (`generate_invoice`/`generate_quotation`, `lib/bms/documents.ts`), **forecasting**
  (`forecast_demand`/`predict_stockout`/`suggest_purchase_order`, `lib/bms/forecast.ts` — heuristic
  velocity, always tagged with uncertainty), **AI-native helpers** (`detect_language`, `classify_intent`,
  `summarize_conversation`, `recommend_products`), and **propose-only outbound**
  (`send_customer_message` → `bmsSendMessage`, LINE/Meta only). See [docs/ai/tools.md](docs/ai/tools.md).
- **AI catalog discovery + sales recovery (customer surface)**: three new customer/staff tools —
  `browse_catalog` (broad "what do you sell?" questions), `list_new_arrivals` (reads `created_at`
  fresh on every call, no cache to invalidate), and `find_alternatives` (2–5 verified substitutes when
  an exact product/size is unavailable) — backed by a new sellable-catalog service in
  `lib/bms/products.ts` (`listSellableProducts()`/`resolveSellableProduct()`/
  `findAlternativeProducts()`) that always searches the tenant's active + in-stock catalog by
  name/SKU/barcode/alias/category/brand instead of relying on chat history or the old
  `keywords[]`-substring lookup. Migration `7.33__bms_product_discovery_indexes.sql` adds `pg_trgm`
  GIN indexes (name/sku/category/brand) plus an active/`created_at` index so these reads stay bounded
  without a parallel search store. Out-of-stock/not-found replies (`ai.ts` templates, `pipeline.ts`,
  and the deterministic no-credential fallback) now offer a verified alternative size or product
  instead of ending the conversation at "ไม่มี". `nlu.ts`/`pipeline.ts`'s order-slot memory also
  understands Thai colloquial quantities (`อันนึง`, `สองชิ้น`), in-place corrections (`ขอ 2 แทน`,
  `เปลี่ยนเป็น XL`) that update only the intended slot, and an explicit draft-cancellation phrase
  (`ไม่เอาแล้ว`/`ไว้ก่อน`/`ยกเลิก`) that clears stored slots and stops older turns from being revived.
  See [docs/ai/workflow.md](docs/ai/workflow.md), [docs/ai/tools.md](docs/ai/tools.md), and the new
  `BMS_EVAL_MODE=natural` suite in [`scripts/ai-eval/`](scripts/ai-eval/README.md).
- **Revision History**: BMS now has tenant-scoped revision snapshots via migrations `7.0`–`7.14`.
  The `/admin/revisions` page can list recent revisions, inspect a snapshot, and compare two
  versions for products, orders, payments, shipments, and purchase orders (header + line items,
  kinds `purchase`/`purchaseItems`). Product/inventory writes — and now purchase receive/cancel —
  pass the logged-in admin id into `beginTenantTx()`, so new revision rows show the editor label
  instead of `system`.

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
