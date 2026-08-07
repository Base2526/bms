# AI Business Management System (BMS)

BMS is an AI-first Business Management System that automates business operations from
customer conversations to order fulfillment. Unlike traditional ERP/CRM, it treats every customer
conversation as the starting point of a business workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

BMS is **not** a chatbot — it is an AI Business Operating System. AI never touches the database
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
| [docs/ui/customer-checkout-wireframe.md](docs/ui/customer-checkout-wireframe.md) | Public checkout/payment UX contract (implemented at `/checkout?t=…`) — what is real vs. must not be shown as real |
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
- **Live Dashboard (`/live-dashboard`, 2026-08)** — 🚧 **layout only; every number is mock data**:
  a public route (in `app/(main)/`, *not* `/admin/*`) for watching sales during a live-selling
  session without entering the admin shell — intended for a TV/second monitor in the shop. Reuses the
  existing session cookie: `report.view` sees the dashboard, signed-in-without-permission sees 403,
  signed-out gets a login prompt to `/admin/login?next=/live-dashboard` (that route now honors
  `?next=` instead of always redirecting to `/admin`). Sections: KPI + "เทียบเมื่อวาน" deltas ·
  งานค้าง tiles linking into Payment/Orders/Inbox · ออเดอร์ที่เพิ่งเข้า feed · GMV-by-channel donut ·
  sales trend vs. previous period · สินค้าขายดี · ออเดอร์ตามสถานะ + สินค้าใกล้หมด · sidebar channel
  rows with connection-status dots. Fullscreen uses `requestFullscreen()` with CSS `:fullscreen`
  scaling plus a `fullscreenchange` listener as the single source of truth for button state.
  **No query is wired yet** — the page holds `MOCK_*` constants, shows a standing warning banner,
  tags every figure with a "ตัวอย่าง" chip, and carries `// TODO(real):` comments naming the intended
  source (`bmsOperationalAlerts`, `bmsSalesSummary().byChannel`, `salesDaily[]`, `bmsOrders(limit)`,
  `bmsChannelHealth`, …). Do not remove those tags before the corresponding query is connected.
  ผู้ชมสด/Conversion/คอมเมนต์ are a separate category — BMS has **no data for them at all** and they
  need per-platform Live API integration, so they sit last on a dashed card. `?demo=1` renders the
  layout with no session for design review; it is safe only while the page has no real data.
  Full section: [docs/ui/dashboard.md](docs/ui/dashboard.md) § Live Dashboard.
- **Per-user theme preference (2026-08)**: `users.theme_preference` (migration
  `7.50__users_theme_preference.sql` — `system`/`light`/`dark`, `CHECK` constraint, default
  `'system'`) persists a signed-in user's UI theme across browsers/devices. `bmsMe`/`updateMe` read
  and write it (`themePreference` on both `GraphQL User` and `MeInput`); `/admin/profile` and the
  public `/settings` page each expose a theme `Select` and call `setTheme()` (`lib/useTheme`) after a
  successful save. `SessionLayer.tsx` applies the session's `themePreference` to the local
  cookie/localStorage theme on load (via `lib/theme.ts`'s `getThemeMode()`/`setThemeMode()`) so a
  freshly logged-in browser picks up the account's saved choice; `ThemeToggle` also pushes a manual
  toggle back to the server through the same `updateMe` mutation, swallowing the error on
  public/signed-out pages where the mutation can't succeed (local cookie/storage fallback still
  applies there). Public and signed-out pages are unaffected — they still use the pre-existing local
  cookie/localStorage theme with no account to sync to.
- **Per-user language preference (2026-08)**: `users.language` (added long ago in
  `1.13__users_username-language.sql`, `TEXT NOT NULL DEFAULT 'en'`, but never read/written outside
  registration until now) now drives a real per-account UI language switcher, following the exact
  same shape as theme preference above. Migration `7.56__users_language_check.sql` adds a
  `CHECK (language IN ('th','en'))` constraint; `updateMe` now whitelist-validates `language` before
  writing (it previously accepted any string — the resolver-level guard `themePreference` already had
  but `language` didn't). `/admin/profile` and public `/settings` both expose a language `Select`
  that already posted to `updateMe`, but neither actually *applied* the change until now: on a
  successful save both pages take the server-confirmed `language` and call the new
  `lib/lang.ts`'s `setLangCookie()` + `router.refresh()` (language, unlike theme, is read
  server-side in `app/layout.tsx` to pick the i18n dictionary, so a fresh server render — not just a
  client-side DOM toggle — is required for it to visibly take effect). `SessionLayer.tsx` syncs a
  freshly loaded session's `language` into the local `lang` cookie the same way it does for
  `themePreference`, and `/api/auth/me`'s `withUserPreferences()` re-reads `language` fresh from
  Postgres on every call (not signed into the JWT) for the same staleness reasons. `HeaderBar.tsx`'s
  existing public-site language switcher was refactored to use the new shared `getLangCookie()`/
  `setLangCookie()` helpers instead of its own inline cookie regex, so there's one cookie
  read/write implementation, not two. **Scope note (updated 2026-08, see next bullet)**: this made
  the switch itself work end-to-end, but at the time the dictionary only covered public marketing/
  auth/nav chrome — the admin app (`/admin/**`) still has zero i18n plumbing and remains out of scope.
  See "i18n coverage" in [AGENTS.md](AGENTS.md) for the current breakdown of what's covered vs. not.
- **Public-page i18n coverage expanded (2026-08)**: a follow-up pass took the `apps/web/i18n/`
  dictionary from ~12 namespaces to 25 (new: `shopSignup`, `settingsPage`, `blockedPage`, `chatPage`,
  `couponWallet`, plus more keys added to `searchPage`/`notificationPage`/`verify`) and wired
  `useI18n()` into every public/auth page that was still Thai-only or partially migrated:
  `/verify-email` (finished the last 2 hardcoded strings), `/shop-signup`, `/settings` (Profile &
  Account/Security/My Posts/My Bookmarks panels — the dead `UsersPanel`/`Files`/`Logs` sub-views
  reachable only via a commented-out menu item were left English-only, not worth wiring), `/search`,
  `/blocked`, `/notification`, `/chat` (2 leaked strings — a delete-confirm dialog and a "typing…"
  indicator; the rest of that 3000-line legacy chat page was already English), and `/coupon/wallet`
  (rewritten as a server component reading the `lang` cookie via `getMessage()`, since it's a public
  bearer-link page with no client-side session). `/help` and `/demo` — both large prose/content pages
  with **no prior i18n scaffolding at all** — got full English translations via a page-local
  `resolveBilingual()` content object (same pattern as `/privacy`/`/terms`/etc., see below). `/demo`
  is the tricky one: it's an *interactive* simulated chat, not static prose, so its keyword-based
  intent detection (`inferFlowStep()`/`buildOrderState()` in that file) had to be extended to
  recognize **both** Thai and English phrasing — translating only the display strings would have left
  the demo's simulated "AI" blind to English input. **Verified already fine, not touched**: `/support`,
  `/privacy`, `/roadmap`, `/donate`, `/license`, `/open-source`, `/pdpa`, `/terms` (all already used
  `resolveBilingual()` correctly — an earlier raw-Thai-character grep had flagged their `th:` content
  values as false-positive "leaks") and the public product storefront `/shop/**` (already bilingual
  via an inline `lang === "en" ? ... : ...` ternary in each view component — a fourth, page-local
  pattern equivalent in effect to `resolveBilingual()` but not routed through the shared helper).
  **Deliberately left as-is**: `/live-dashboard` (still mock-data-only per the note above — translating
  copy that will likely be reworked once wired to real queries isn't worth it yet) and the legacy
  community pages `/my/posts`, `/my/profile`, `/post/**`, `/post/[id]/edit`, `/profile/[id]` (English-
  only, no Thai to leak, simply never localized — out of scope, these predate BMS). The admin app
  (`/admin/**`) is completely unaffected by this pass and still has zero i18n plumbing.
- **Tenant-scoped Users page**: `/admin/users` now respects the acting tenant when a platform admin
  drills into a shop. In Shop B mode the list/detail/delete/avatar paths are tenant-scoped, so the
  page no longer leaks cross-tenant users or opens a user from another shop by direct URL. The
  empty state now explicitly says when the current shop has no users yet.
- **Support tickets + comments**: `/support` now persists tickets to `support_tickets` and
  `/admin/support-tickets` lets platform admins review the queue, change status, and leave internal
  comments. `support_ticket_comments` keeps the status trail and note history; support topics were
  narrowed to BMS-relevant categories and a fake seed route exists for testing.
- **Batch & Cron ops view**: `/admin/operations-schedule` lists the batch/cron jobs, when they last
  ran, what each one does, and why it exists so operators don't have to guess whether a job already
  ran today.
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
- **Inbox mockup-driven redesign (2026-08)**: visual/UX polish only, no schema/permission/payload
  changes — every step was mocked up as an HTML artifact and approved before editing code (see
  `CLAUDE.local.md` for the per-change design rationale). Queue header's quick-filter row is split
  into a scrollable content-filter strip plus a pinned "ของฉัน" chip so it never wraps. The chat
  header's "ผู้ช่วยตอบ"/"แท็ก" controls are two independent `Popover` buttons instead of one toggle
  that expanded both together. The "AI แนะนำคำตอบ" suggestion card is a single-column grid so its
  button row can no longer squeeze the suggested text into a narrow ribbon on mobile. The Customer
  360 panel's own title bar is sticky within its own scroll container (the panel itself no longer
  sets a redundant `position: sticky` with nothing to stick to) and has an explicit background so
  scrolled content cannot show through the gap; its order-card and channel/status badges share one
  `Pill`/`OutlinePill` chip system with the rest of Inbox instead of raw antd `Tag` presets; Quick
  Actions render as icon-led rows with the primary action visually distinct, keeping the same
  permission/disabled/tooltip logic. The in-chat image viewer is a transparent, blurred lightbox
  (not an opaque white card) with icon-only close/download controls, same-styled prev/next arrows on
  every screen size, and no caption or thumbnail strip — sender/time is a small floating chip on the
  image itself. `chatImages`/`movePreview`/`imagePreviewIndex` are unchanged.
- **Inbox read-path performance (2026-08)**: `bmsConversations`/`bmsConversation` now take bounded
  `limit`/`messageLimit`/`eventLimit`/`noteLimit` args instead of returning every row — the list caps
  at `INBOX_CONVERSATION_LIST_LIMIT` (50) and a conversation's detail caps at `INBOX_DETAIL_*_LIMIT`
  (messages 80, events 30, notes 30), all clamped server-side in `lib/bms/inbox.ts`
  (`listSystemEvents()`/`listNotes()`; `listMessages()` already took a limit). Migration
  `7.51__bms_inbox_read_path_indexes.sql` adds tenant/status/recency indexes for the conversation
  list and message reads, plus `pg_trgm` GIN indexes so bounded `ILIKE` search stays indexed across
  conversation previews, customer refs, message bodies, CRM names, and cached channel display names.
  Do not reintroduce an unbounded read on the initial inbox view. The conversation-list row is also
  extracted into a memoized `ConversationListItem`, and the page wraps its derived lists/callbacks
  (`listVariables`, `convVariables`, `visibleConversations`, etc.) in `useMemo`/`useCallback` so a
  poll tick or unrelated state change doesn't re-render every row. The Customer 360 panel now mounts
  ~350ms after a conversation is opened (`customer360Ready`) instead of immediately, so rapidly
  clicking through the queue doesn't mount/query it for chats the operator is just passing through.
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
  [docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md#evaluation-checklist). Live evals write real data,
  including `ACTIVE` restock subscriptions from explicit-consent cases, so they run against
  development/sandbox tenants only. The live archetype-commerce-policy coverage is also split into
  per-`businessArchetype` case ids such as `archetype-commerce-policy-mini_mart` and
  `archetype-commerce-policy-fashion`, while `BMS_EVAL_CASES=archetype-commerce-policy` remains a
  selector for the whole group.
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
- **Multi-provider AI: DeepSeek chat + per-tenant BYOK provider choice**: the shared chat/tool-calling
  provider is no longer Anthropic-only — `BMS_AI_PROVIDER` picks the default (DeepSeek is the current
  primary for ordinary customer chat cost reasons), while `BMS_AI_SENSITIVE_PROVIDER` forces sensitive
  staff-assistant turns (refund/cancel/adjust-stock intents, detected by `tools/runtime.ts`) onto a
  fixed baseline regardless of the tenant's own BYOK choice. Migration `7.35` adds a `provider` column
  (`anthropic`/`deepseek` only — Qwen is never a BYOK option) to `bms_tenant_ai_config`; a shop admin
  picks their own BYOK provider on `/admin/settings`' "AI BYOK" card, and changing provider requires
  re-entering that provider's key. Slip OCR is unaffected by a tenant's BYOK choice — it always uses
  the platform-wide shared provider (`BMS_SLIP_READER_PROVIDER`, default Qwen, with an env-configured
  fallback `BMS_SLIP_READER_FALLBACK_PROVIDER`, default Anthropic). Every credential-resolution branch
  (chat and OCR, which use two separate routing-reason vocabularies) now tags its usage event with
  `routingReason`/`configuredProvider`/`effectiveProvider`/`fallbackFrom` so `bmsAiUsageEvents`
  (tenant-scoped, `ai_quality.view` permission) and the platform-wide `/admin/env` "Recent Actual
  Usage" table can show *why* a call used the provider it did, not just which one.
- **AI Provider Health**: shared AI providers (Anthropic/DeepSeek/Qwen OCR) used to fail silently —
  a broken key/quota/outage fell back to a template reply or "verify manually," with no alert.
  Migration `7.34` adds a platform-wide (no `tenant_id`) `bms_ai_provider_health` table tracking each
  `(provider, purpose)` combo's real connection status — `anthropic/chat`, `deepseek/chat`,
  `anthropic/ocr`, `qwen/ocr` — written through a single choke point (`finalizeAiUsageEvent()` in
  `lib/bms/aiUsage.ts`, which every shared-key chat/OCR call already passes through), the existing
  `/admin/env` "ทดสอบ" buttons (4 of them — Anthropic Chat, Anthropic OCR Fallback, DeepSeek, Qwen;
  "Anthropic OCR Fallback" is a UI/test-selector string only, not a stored identity — it still writes
  to the same `(anthropic, ocr)` row), a one-click "ตรวจสอบทั้งหมดตอนนี้" button
  (`bmsCheckAllAiProviderHealth`) that refreshes the on-page table without reloading, and a cron
  `POST /api/bms/ai/check-health`. A `connected` row that hasn't been checked within
  `BMS_AI_HEALTH_STALE_MINUTES` (default 60) is reclassified as `stale` at read time only — `'stale'`
  is never written to the DB column itself, and `stale` rows count toward the unhealthy badge same as
  a real error. Visible via a status table and sidebar badge on `/admin/env` (platform-admin only).
  Tenant BYOK keys are intentionally not tracked here. See § AI Provider Health in
  [CLAUDE.local.md](CLAUDE.local.md).
- **Failure incident alerting**: AI Provider Health only covers *provider connectivity*, so a real
  outage caused by anything else (a missing migration, a Postgres error, a broken reply push) still
  reached customers silently — a live shop's customer got "ขออภัยค่ะ ระบบขัดข้องชั่วคราว" three times
  across a day with the provider table showing all-green. Migration `7.36` adds tenant-scoped,
  append-only `bms_failure_incidents`, written only through `reportBmsFailure()`
  (`lib/bms/failureAlert.ts`). Incidents are classified into two tiers with **different recipients**:
  **Tier A** (the customer saw an error, or got no reply at all) notifies the shop
  (Administrator/Manager plus the conversation's assigned staff) *and* platform admins; **Tier B**
  (degraded quality, the customer still got an answer) notifies platform admins only, because the shop
  cannot act on it. A Tier A code raised on a staff surface is automatically downgraded to Tier B —
  the admin already sees the error on their own screen. Alerting fires on the **first** occurrence and
  is then suppressed by a per-`(tenant_id, code)` cooldown (`BMS_FAILURE_ALERT_COOLDOWN_MINUTES`,
  default 30) rather than the legacy "3 within 10 minutes" burst threshold, which structurally could
  not catch failures hours apart. Delivery reuses the existing `notifications` table + subscription
  (in-app bell and browser notification via `GlobalFailureNotifier`), plus Slack when
  `SLACK_WEBHOOK_URL` is set; there is deliberately no email or LINE-to-owner path yet. Wired at the
  AI tool runtime, the customer pipeline, and the LINE webhook. See § Failure Incidents in
  [CLAUDE.local.md](CLAUDE.local.md) for the two non-obvious rules (never hook the alert off a tool's
  audit `outcome`; the notification step must stay time-bounded because it is awaited on the
  customer-reply path).
- **Customer reply policy: contextual browsing + configuration-first payment guidance**: two
  small shared policy modules keep the customer surface from inventing things. `browse_catalog` is now
  server-routed for contextual follow-ups ("ดูอย่างอื่น", "สินค้าอื่น", "มีรุ่นอื่นไหม"), excluding the
  products named in the immediately previous reply and offering up to three different in-stock choices
  instead of asking the customer to repeat a product name or size
  (`lib/bms/customerReplyPolicy.ts`). Payment guidance is derived from the shop's actual configuration:
  `lib/bms/paymentConfiguration.ts` treats blank receiving-account rows as unconfigured, so
  `get_payment_info` returns `configured:false`, proactive bank/PromptPay/QR suggestions are stripped
  from the reply, and the customer-surface `submit_payment` tool refuses an unconfigured method
  (`PAYMENT_METHOD_NOT_CONFIGURED`) instead of creating a PENDING payment against a channel the shop
  cannot receive money on. Staff surfaces keep their existing latitude to record other methods.
  Covered by `scripts/ai-eval/customer-policy-contract.test.mts`.
- **Identity-first chat checkout**: after a chat order the AI no longer asks for delivery details the
  shop already has. `getCustomerCheckoutStatus()` (`lib/bms/customers.ts`) reports *completeness* for
  the server-established `(channel, customer_ref)` identity — booleans, an address count, ordered
  `missingFields`, and an address label only when it is a generic allowlisted one such as
  บ้าน/ที่ทำงาน. It deliberately never returns the raw recipient name, phone, or address, so deciding
  whether to ask does not ship CRM PII into a model prompt. Two customer-only tools expose it:
  `get_customer_checkout` (read; also embedded as `checkout` in a successful `create_order` result) and
  `save_customer_checkout_details` (writes only the fields the customer explicitly sent, preserves
  omitted ones, reuses an identical existing address as default instead of duplicating it, audited as
  `customer.checkout_update`). Complete details are reused automatically; incomplete details are
  collected **one field at a time** and payment channels are listed only once delivery is complete.
  Lazada/Shopee report `marketplaceManaged:true` and are never asked for Seller Center data. The
  customer's answer to the deterministic name/phone/address question is server-routed back through the
  same approved save tool, so the flow also completes with no AI credentials or quota.
- **Public customer checkout (`/checkout?t=<signed-token>`)** — ✅ implemented; the wireframe in
  [docs/ui/customer-checkout-wireframe.md](docs/ui/customer-checkout-wireframe.md) is now an
  implementation contract rather than a plan. A successful customer `create_order`/`reorder` sets a
  server-only `createdOrderId` on the tool exec context, and `pipeline.ts` replaces the model's closing
  prose with `orderCheckoutChatReply()` — a backend-built order summary plus the signed link — so the
  model can no longer end a successful order at "wait for an admin". `lib/bms/checkoutToken.ts` signs
  an HMAC binding `tenantId + orderId + exp` (7 days, 30 max) with `BMS_CHECKOUT_SECRET` (falls back to
  `JWT_SECRET`; production refuses to run unsigned), and `lib/bms/checkout.ts` builds a tenant/order
  scoped projection: order lines are read-only, existing CRM delivery details are reused, and only the
  missing fields are collected. `GET/PATCH /api/bms/checkout` reads and saves delivery details;
  `POST /api/bms/checkout/payment` validates token/method/order state and re-decodes the uploaded slip
  with `sharp` (JPG/PNG/WEBP, ≤8 MB) before recording a payment. Amount always comes from the order,
  never the browser. `submitPaymentOnce()` locks the order row and returns an existing
  `PENDING`/`CONFIRMED` payment as `ALREADY_SUBMITTED` instead of duplicating it, while a `REJECTED`
  payment may be replaced. Only `BANK_TRANSFER`/`QR` methods backed by a configured BANK/PromptPay
  account are offered, Lazada/Shopee are rejected as `marketplaceManaged`, and the page **never
  confirms payment** — it creates `PENDING` and a human still clicks Confirm. The route is a public
  bearer link, so it is excluded from the session layer via `skipsSessionLayer()` in
  `ClientProviders.tsx` (not `isAuthPath()`), and responses are `no-store`. Token scope/tamper/expiry
  is covered by `scripts/ai-eval/checkout-token-contract.test.mts`.
- **Revision History**: BMS now has tenant-scoped revision snapshots via migrations `7.0`–`7.14`.
  The `/admin/revisions` page can list recent revisions, inspect a snapshot, and compare two
  versions for products, orders, payments, shipments, and purchase orders (header + line items,
  kinds `purchase`/`purchaseItems`). Product/inventory writes — and now purchase receive/cancel —
  pass the logged-in admin id into `beginTenantTx()`, so new revision rows show the editor label
  instead of `system`.
- **Sales digest reports (email/Slack/LINE)**: each shop can subscribe to an automatic sales
  summary (revenue, order count, top products, breakdown by channel) sent DAILY/WEEKLY/MONTHLY.
  Migration `7.37` adds `bms_report_subscriptions` (one row per tenant, like `bms_store_profile`)
  and append-only `bms_report_deliveries` (one row per channel per send attempt, like
  `bms_audit_log`). `lib/bms/reportDigest.ts` computes all periods with direct UTC+7 arithmetic
  (Asia/Bangkok has no DST, consistent with the rest of the codebase's `Intl.DateTimeFormat`-based
  date handling — no timezone library dependency added); `runScheduledDigests()` is the cron
  entrypoint and is idempotent per `(tenant, period)` via `last_period_key`, so it can be invoked
  at any frequency (e.g. hourly) without double-sending. LINE delivery reuses the shop's own LINE
  OA `access_token` to push to an admin-supplied LINE user id — there is no separate LINE-to-owner
  integration. `sendTestDigest()` lets an admin trigger an immediate send (last 24h as the period)
  without touching the real schedule's `last_sent_at`/`last_period_key`. Configured on
  `/admin/settings` (`ReportSubscriptionCard.tsx`, `requireTenantAdmin` gate — same config-domain
  pattern as `bmsChannels`/`bmsStoreProfile`, no new permission); a platform-admin-only
  `/admin/report-schedule` page audits every tenant's subscription + delivery history. Cron
  `POST /api/bms/reports/send-digest` follows the same `x-cron-secret` pattern as the other two
  cron endpoints and is likewise **not yet scheduled**. See [docs/ui/dashboard.md](docs/ui/dashboard.md)
  and [docs/architecture/api.md](docs/architecture/api.md).
- **Generated reports & document export (2026-08)**: `/admin/reports` now includes an **AI Report
  Generator** card that produces real XLSX/CSV/PDF files for Sales / Inventory / Profit, stores an
  append-only audit row in `bms_generated_reports` (migration `7.53`), and lets staff re-download
  prior exports from the same page. The shared service is `lib/bms/reportEngine.ts`: GraphQL
  (`bmsGenerateReport` / `bmsGeneratedReports`), REST (`POST /api/bms/reports/generate`), and the
  staff AI tool `generate_report` all call the same function so export behavior cannot drift across
  surfaces. Files are persisted through the existing `files`/`STORAGE_DIR` mechanism via
  `persistBuffer()` (`lib/storage.ts`) but must be downloaded through the tenant-gated
  `/api/bms/reports/download/[id]` route rather than `/api/files/[id]`, because these exports may
  contain business-sensitive data. Profit reports are explicitly **estimated** from current
  `bms_products.cost_price` against historical `bms_order_items.unit_price` snapshots — no historical
  cost snapshot exists yet — so the export and the optional AI executive summary must keep that
  disclaimer. PDF output currently keeps headings in English because `pdfkit`'s default fonts do not
  render Thai glyphs correctly; XLSX/CSV remain UTF-8 and handle Thai data today.
  **Fixed (2026-08)** — three fields were queried but silently dropped before reaching the output
  file: CSV export only ever wrote `doc.sheets[0]`, so a Sales report's "Top products"/"By
  channel"/"By status" sheets were missing from CSV (XLSX/PDF were unaffected, they already
  iterated every sheet); `getSalesSummary()`'s `byStatus` breakdown was fetched from the DB but never
  mapped into any sheet in any format; and the Inventory report's low-stock sheet omitted
  `reorder_point` even though `listLowStock()` already selects it. All three are fixed in
  `lib/bms/documentGenerator.ts` (`buildCsv()` now iterates every sheet with a `# <sheet name>`
  marker line between sections; `buildSalesReportDoc()` adds a "By status" sheet; the inventory
  sheet's column list adds `reorder_point`). If you add a new field to a report's underlying summary
  query, it does not appear anywhere until you also add it to the corresponding `build*ReportDoc()`
  column/sheet list in the same file — the query and the file layout are two separate steps.
- **Email a generated report — `email_report` (2026-08, A3)**: the staff assistant can now do
  "generate this report and email it to X" in one command (e.g. "ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel
  แล้วส่ง email owner@example.com"). The file is generated immediately via the existing
  `generateReport()` (not sensitive), but sending it is always a **human-confirmed proposal** — the
  recipient is free text from the chat message and is never independently verified, so the tool only
  proposes; the admin reviews (and can edit) the address in `/admin/assistant` before pressing Confirm,
  which fires the new `bmsEmailReport` mutation. New permission `report.email` (migration `7.54`,
  Manager + Administrator only — deliberately narrower than `report.view`, since exporting data outside
  the system is riskier than viewing/downloading it inside). `lib/mailer.ts`'s `sendEmail()` gained
  optional `attachments` support (both SendGrid and Gmail SMTP paths) to make this possible — no other
  caller passes attachments yet. See § "ส่งรายงานเป็นอีเมล" in [CLAUDE.local.md](CLAUDE.local.md) for
  the full design and unverified items (migration not yet applied/exercised against a live mail
  provider).
- **Follow-up Automation (`lib/bms/followups.ts`, 2026-08)** — 🚧 **MVP core only**: a configurable
  Rule Engine + Scheduler decides whether to re-engage a customer whose conversation went quiet,
  instead of a fixed timer. Migration `7.52` adds `bms_conversations.last_sender_type` (set by
  `logConversation()`/`sendStaffMessage()`/`sendFollowupMessage()` in `inbox.ts` — the cheap indexed
  signal for "did the customer/staff reply since we scheduled this"), `bms_customers.followup_opt_out`,
  and 4 new tables: `bms_conversation_intents` (append-only intent+confidence log, AI-first with a
  deterministic keyword fallback — a separate 10-value intent set from `nlu.ts`'s customer-chat
  `Intent`, do not conflate them), `bms_followup_rules` (the config surface — intent/enabled/priority/
  delay/max_retry/`message_goal`/`business_hours_only`/template; the scheduler never hardcodes a
  delay or goal), `bms_followup_jobs` (one row per conversation+rule in flight), and
  `bms_followup_history` (append-only send/skip/fail log, like `bms_audit_log`). Cron
  `POST /api/bms/followups/run` (same `x-cron-secret` pattern, **not yet scheduled**) calls
  `runDueFollowups()`, which re-checks every stop condition live at send time (customer/staff replied
  since scheduling, conversation closed, max retry, opted out, rule disabled) — these six are
  **always enforced**, not opt-in per rule; `bms_followup_rules.stop_conditions` is stored/validated
  only for a future workflow engine and is not read by the scheduler yet. AI-drafted messages follow
  a goal → guidance map (Close Sale/Collect Missing Info/.../Support Follow-up — never a bare "are you
  still interested?") with a template/plain-text fallback when there's no AI credentials/quota, same
  AI-then-template shape as `generateResponse()`. `/admin/followup-rules` (CRUD, `followup.manage`)
  and `/admin/followup-queue` (read-only queue/history + manual "run now", `followup.view`) are
  gated by two new permissions, seeded to Manager (both) and Sales (view only). **Deferred on
  purpose** (see `CLAUDE.local.md` § Follow-up Automation for why): the multi-step branching
  Workflow Engine + visual Workflow Builder, the numeric Follow-up Scoring model, and the full
  Analytics dashboard (Intent Statistics/Success Rate/Conversion Rate/Retry Statistics) — rule
  `priority` stands in for scoring in this MVP. `business_hours_only` is a fixed 09:00–18:00
  Asia/Bangkok approximation, not a parse of the shop's free-text `businessHours` (no structured
  open/close schema exists yet). **Not verified against a live DB in the session that built it** —
  `tsc` passed but the migration was never applied/exercised end-to-end; verify before relying on it.
- **Redis infrastructure hardening (2026-08)**: the legacy social-media auto-publish job queue
  (`packages/social-queue`, `packages/events`, `apps/web/scripts/social-worker.mjs`, `/admin/queue`)
  was removed entirely — it published blog/community posts to Facebook, was unrelated to BMS, and had
  no consumer left worth keeping. What's new instead: `apps/web/lib/cache.ts` (generic fail-open
  read-through Redis cache, applied to `getStoreProfile()`), `apps/web/lib/redisSession.ts`
  (Redis-backed revocation for the admin `ADMIN_COOKIE` JWT — logout now actually invalidates a
  session instead of only clearing the browser cookie; enforced once in `createContext()` in
  `app/api/graphql/route.ts`), and Redis persistence (`--appendonly yes` + a named volume in
  `docker-compose.yml`, inherited by dev/prod). `apps/web/lib/pubsub.ts` now re-exports the single
  shared `RedisPubSub` instance from `packages/realtime` instead of opening a second one. See "Redis
  usage" in [AGENTS.md](AGENTS.md) for the invariants (what's cached vs. never cached, fail-open
  design, what's *not* covered — community/`USER_COOKIE` logins are still stateless JWT with no
  revocation). **Not done**: Redis has no password/TLS in any compose file yet — treat as required
  before a production deploy that doesn't already isolate Redis at the network layer.
- **Cron/batch run history (2026-08)**: `/admin/operations-schedule` (platform-admin only) used to
  only describe what a job is *supposed* to do by reading source files — it explicitly said it had no
  real run history. Migration `7.55__bms_job_runs.sql` + `lib/bms/jobRuns.ts` (`recordJobRun()`/
  `recordExternalJobRun()`) now record every invocation (status, duration, output/error) of the
  cron-secret-gated endpoints (`orders/release-expired`, `channels/check-health`, `ai/check-health`,
  `reports/send-digest`) and, via a new `POST /api/bms/jobs/report-run` write-back endpoint, the
  `daily-log-triage` GitHub Action too (only if `BMS_APP_BASE_URL`/`BMS_CRON_SECRET` are set as repo
  secrets — otherwise that one step just skips itself). The page now shows a real "Last run"
  status/history per job and flags a `running` row stuck past 30 minutes as needing attention. Still
  requires applying migration `7.55` before any run shows up, and still doesn't give any of those
  endpoints an actual external scheduler — this only makes existing/future invocations observable, it
  doesn't schedule them (see the unchanged "ตั้ง cron schedule จริง" item in Roadmap remaining below).
  Note: this migration was renumbered from `7.53` to `7.55` while merging `feat/redis-infra-improvements`
  into `feat/report-generation`, because `7.53` was already taken by
  `7.53__bms_generated_reports.sql` on this branch; `7.54` is `7.54__bms_report_email_permission.sql`.

**Roadmap remaining:** TikTok send API · email/voice outbound · real carrier API (label PDF/auto-tracking) ·
AI OCR (beyond payment-slip verify) · ML-grade forecasting (current is heuristic) · WhatsApp AI ·
Shopee/Lazada signature verification against real Open Platform docs · letting shop owners
(Manager role) manage their own staff · wiring an actual cron schedule for the ready-but-unscheduled
endpoints (`orders/release-expired`, `channels/check-health`, `ai/check-health`, `reports/send-digest`,
`followups/run`) — each of the first four now records its own run history (see "Cron/batch run history"
above), it just isn't triggered automatically yet · adding a password/TLS to Redis before a real
production deploy (see "Redis infrastructure hardening" above) · Follow-up Automation's Workflow Engine,
Scoring model, and Analytics dashboard (see above).

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
