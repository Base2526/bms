# BMS feature log

Detailed implementation notes for features already built, moved out of `CLAUDE.md` so that file
stays small enough to load into every session. Nothing here is a rule — for rules see
[../AGENTS.md](../AGENTS.md); for the current build status see
[architecture/system.md](architecture/system.md).

Entries are historical: each records what a change did and why at the time it landed. Counts, file
lists, and "not yet applied" notes are snapshots — verify against the code before relying on them.

---

## Shop archetype lock + bilingual labels (9.43, 2026-08-31)

- Added shared `shop_archetypes.*` labels in both `en` and `th` for the shop archetype dropdown and
  related admin/profile screens, so the UI can show the same stable ids with localized labels.
- Locked `business_archetype` after the tenant's first real order. Demo rows marked with `FAKE-*`
  remain editable, but real order history now freezes the preset so onboarding, checklist, and AI
  defaults cannot drift away from the business record.

---

## POS shift reconciliation export (9.32, 2026-08-29)

- Added device-scoped recent shift history and a PIN + `pos.shift.report` protected XLSX download.
  The workbook includes the server X/Z summary and source sheets for bills, payments, drawer
  movements, return/refund allocations, expenses, no-sales and credit activity; it omits customer PII.
- Added explicit event-shift attribution: `bms_pos_returns.shift_id` records where goods were accepted
  and immediate cash left the drawer, while refund allocations record the shift that confirmed their
  external settlement. Shift close/report formulas prefer those event shifts and retain the original
  order shift only as a legacy fallback.
- Kept blind close intact in downloads: an open shift exports the contributing facts but not the
  expected-cash answer. Closed reports continue to use the expected/count/variance snapshot stored at close.

## Global AI Work Assistant V1 (2026-08)

- Added a server-safe bilingual capability/guide catalog with deterministic Unicode-normalized
  retrieval, implementation status (`AVAILABLE`/`CONDITIONAL`/`BETA`/`MOCK`/`UNAVAILABLE`), routes,
  prerequisites, warnings, and required permissions.
- Added additive `bmsWorkAssistant`, reusing the staff runtime, quota, audit, RBAC re-check, and
  propose-only confirmation path while returning structured citations and accessible deep links.
- Mounted a global admin Drawer and shared its existing confirmation mutations with the full-page
  assistant. Added tenant-scoped staff access lookup and tenant loyalty-program status tools.
- Kept POS-only accounts outside `/admin`: `/pos` receives deterministic shared POS guide search
  with no GraphQL/AI call and cannot read sales data or perform actions.

**Recheck pass (2026-08-28)** — the first cut shipped four claims it could not keep, all fixed here.
Page proximity added a larger bonus than any relevance floor, so *every* guide on the current page
scored as an answer to *any* question: the register's "no verified guide matched" branch was
unreachable and every message got page guides as "citations". Results now carry `matchedQuery`, and
only query-matched entries become citations or links. Retrieval was always Thai because
`users.language` is deliberately not a session claim, so `ctx.admin.language` is always undefined —
the clients now send `locale` (presentation only, never authorization) and the dead `sectionId`
input was removed. `get_my_access` reported `displayName: null` and `posOnly: false` from session
fields that do not exist; both are read from `users` now. The Drawer's Confirm button showed only
model prose, while the full-page assistant shows the mutation and its server-composed arguments and
gates an emailed report on a reviewed recipient — the Drawer now does both. The register assistant
served `/admin/pos-devices` and `/admin/pos-readiness` (they share the `pos.` id prefix) to cashiers
who cannot open `/admin` at all; it is now restricted to `pageId === "pos"`. `platform.edit-post`
linked to `/admin/post`, which has no index page and 404s. Capability status was corrected to match
the real build state: shipping is `AVAILABLE` with a separate `MOCK` carrier-integration entry
(one entry cannot say both), and e-Tax, Shopee/Lazada, and ESC/POS printing are `BETA` — written but
never verified end to end. Four register workflows with live `/api/pos/*` routes had no guide at all
(credit sale/collection, no-receipt return, store credit, pharmacist counter authorization); a
cashier asking about them got an unrelated guide presented as the answer. Both contract suites moved
into `npm run test:pure` — they lived in `scripts/ai-eval/`, which the gate's directory walk never
entered, so they would only ever have run by hand.


**REST surface hardening + reserved-stock attribution (2026-08-24)** — ✅ implemented, no migration.
`middleware.ts` matches `/api/:path*` but only guards paths under `/admin`, so every REST route needs
its own check; twenty-four written for a single-tenant BMS had none. `/api/bms/reserve` was the worst:
`reserveStock()` filtered on `product_sku` + `size` with no `tenant_id` and no `location_id`, so one
unauthenticated call reserved stock in every shop and branch stocking that SKU (`NIKE-AIR/XL` exists
in two dev tenants) and wrote no stock movement, against this module's own rule. It now runs in
`beginTenantTx`, reserves one branch, writes a `RESERVE` movement in the same transaction, and takes
its tenant from the session. The order/payment/purchase/shipment/report/inbox routes moved to
`authorizeAdminRoute(<permission>)` using the same permission as the equivalent resolver; eight routes
that had hand-inlined the session + acting-tenant + permission sequence now share that helper (which
grew a `ctx` return and a `null` permission for the playground); the two upload endpoints stopped
accepting "any logged-in user" and require `product.edit`/`inbox.reply`. The single-tenant webhook
mocks return 404 in production — they ran the AI pipeline for anyone who posted — and the public demo
endpoint gained a 20/min/IP ceiling.

The same change answers a question the products page could not: `reserved_stock` is a running total
and nothing records which bill owns which unit, so clicking the reserved figure now lists the bills
holding it (`listVariantReservations()`, `bmsVariantReservations`, gated on `order.view` because the
answer carries customer contact). It counts `PENDING`/`PAID`/`PACKING` only, reads the
`bms_order_stock_lines` view so a bundle's components are attributed to the bill that bought the set,
and reports the part no bill explains rather than rounding it away. Also fixed in passing: four i18n
keys filed under the wrong namespace rendered as raw key strings on screen, and the wholesale form
forced `3.0000`/`600.00` into boxes where the shop had typed `3` and `600`. Contracts:
`scripts/variant-reservations-db-contract.test.mts`, `scripts/reserve-stock-db-contract.test.mts`,
`scripts/inventory-tenant-scope-contract.test.mts`, `scripts/i18n-keys-contract.test.mts` — the last
two are static scans that fail on the *class* of mistake, since both classes had already recurred.

**Data-integrity edge cases (2026-08-23)** — ✅ implemented in migration `9.15` and shared services.
Order/payment lifecycle events now retain their own timestamps and report on Bangkok business days;
payment confirmation cannot commit without the locked order moving `PENDING -> PAID`; POS partial
refunds report by settled allocation, and legacy payment REST mutations now enforce signed
tenant-scoped RBAC with in-transaction audit. Malformed order quantities fail the whole basket, missing cost
no longer becomes zero profit cost, Action Center exposes missing/duplicate/conflict/outlier evidence,
customer merge carries newer customer-owned modules, live catalog/stock results expose verification
time, and cold-start forecasts return insufficient-data evidence instead of confident advice.
Contracts: `scripts/data-integrity-contract.test.mts` and
`scripts/data-integrity-db-contract.test.mts`.

**Commercial intelligence Q1-Q3 (2026-08-22)** — ✅ implemented. Phase 1 combines a Bangkok-day
Action Center with advisory inventory intelligence (`9.12`–`9.13`): evidence, priority, expected
impact, confidence, owner/due date, audited lifecycle and measured outcomes sit beside stock-out
horizon, reorder quantity, incoming PO supply, lost-sale/restock feedback, slow/dead stock and FEFO
expiry actions. Phase 2 adds the tenant-scoped retention engine (`9.14`): monthly RFM/value/return
rhythm and risk, verified basket-derived next product, safe bilingual comeback proposals, explicit
treatment acceptance/contact, deterministic holdout, attributed revenue and estimated incremental
lift. Attribution is capped at 30 days and stale cases expire. UI lives on `/admin/dashboard` and the
permission-independent Retention tab in `/admin/followup-queue`; Q4 profit/growth remains planned.
Contract suites: `scripts/phase1-action-center-contract.test.mts` and
`scripts/retention-engine-contract.test.mts`.

**Customer 360 (Inbox right panel)** — ✅ implemented and documented in
[docs/ui/customer360.md](ui/customer360.md): `lib/bms/customer360.ts` · migration
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
  Full section: [docs/ui/dashboard.md](ui/dashboard.md) § Live Dashboard.
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
  read/write implementation, not two. **Scope note (updated 2026-08, see next bullets)**: this made
  the switch itself work end-to-end, but at the time the dictionary only covered public marketing/
  auth/nav chrome and the admin app had zero i18n plumbing; both have since been expanded.
  See "i18n coverage" in [AGENTS.md](../AGENTS.md) for the current breakdown of what's covered vs. not.
- **New accounts default to Thai (2026-08-13, migration `7.81`)**: every anonymous/logged-out surface
  already defaulted to Thai (`cookie === "en" ? "en" : "th"`, repeated in ~10 entry points), but
  `users.language` carried `DEFAULT 'en'` from `1.13__users_username-language.sql`, and none of the
  three `INSERT INTO users` paths (community register, social login, admin-created BMS staff) set the
  column — so `SessionLayer.tsx`'s language sync flipped a Thai visitor's UI to English the moment a
  brand-new account logged in for the first time. `7.81` changes only the column default to `'th'`.
  Existing `'en'` rows are deliberately **not** backfilled: an explicit English choice is
  indistinguishable from an untouched default, and flipping the wrong ones is worse than leaving them.
  Verified against the dev docker Postgres (default changed, migration re-runs idempotently, a real
  `INSERT` omitting the column lands `'th'`); **not applied to production yet**.
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
  (`/admin/**`) was completely unaffected by this pass and had zero i18n plumbing *at that point* —
  see the two bullets below for what changed since.
- **Admin app i18n — batches 1–17 done, ~62% of the admin app (2026-08)**: a series of follow-up passes
  converted `/admin/**` from 0% (no file called `useI18n()`) to **48 of 78** admin `.tsx` files carrying
  a bilingual mechanism, with the shared dictionary now at **70 namespaces / 4,000 keys per language at
  exact th↔en parity** (verified 2026-08-31 after the shop-archetype label pass). The nav shell (`AdminSidebar.tsx`/`AdminLayoutClient.tsx`)
  and `admin/login/page.tsx` — both previously flagged here as priority gaps — are converted. The
  remaining 30 files are **not Thai leaks**: they are trivial `layout.tsx`/`loading.tsx` guards with no
  user-visible copy, plus the English-only legacy platform-admin pages (`admin/roles`, `admin/logs`,
  `admin/files`, `admin/posts`/`admin/post/**`, `admin/operations-schedule`, `admin/dev/sql-console`)
  that predate BMS and would need translating *into* Thai rather than out of it. Treat
  [AGENTS.md](../AGENTS.md) § i18n coverage as authoritative for the file-by-file breakdown and for the
  list of Thai strings that a grep flags but that must **not** be "fixed" (brand voice, customer-input
  regexes, CRM tag values, CSV template headers, mock case data); re-run the audit rather than trusting
  any count written down here. The paragraph below records what the first pass did and why.
- **Admin app i18n — first 10 files (2026-08, historical detail)**: the pass that started the work.
  `admin_dashboard`/`admin_orders`/`admin_reports`/
  `admin_settings`/`admin_store_profile`/`admin_report_subscription` namespaces already existed with
  most keys wired; this pass finished the one gap in `admin/dashboard/page.tsx` (the "no `report.view`
  permission" `Alert` was still two hardcoded Thai strings) and fully converted the Inbox surface —
  `admin/inbox/page.tsx` (2,261 lines; new `admin_inbox` namespace, ~150 keys), plus confirming
  `Customer360Panel.tsx`/`admin/inbox/mentions/page.tsx`/`admin/inbox/realtime-diagnostics/page.tsx`
  were already fully converted in an earlier untracked pass (they use `admin_inbox_customer360`/
  `admin_inbox_mentions`/`admin_inbox_diagnostics`, which is why an earlier Thai-character-density
  audit of this codebase mis-flagged them as untranslated — it counted raw Thai characters without
  excluding files that had already moved their copy into the dictionary). At the end of *that* pass the
  dictionary held 30 namespaces and 10 of 78 admin files called `useI18n()` — see the bullet above for
  current numbers.
  Two non-obvious fixes needed while converting `admin/inbox/page.tsx`: (1) several render closures
  reused the loop/prop variable name `t` (`rows.map((t) => ...)`, `tags.map((t) => ...)`) which shadowed
  the `t()` translate function pulled from `useI18n()` — renamed those to `row`/`tag`; (2) `nextAction()`
  returned a `value` string (e.g. `"เช็กสต็อก"`) that other code compared against with `===` to derive
  an AI-intent label — translating `value` directly would have silently broken that comparison, so the
  function now also returns a stable, untranslated `key` (`"confirm_slip"` / `"issue_tracking"` / …) for
  comparisons, keeping `label`/`value` as display-only. **Deliberately left in Thai on purpose, not a
  gap**: customer-facing message content — the AI suggested-reply templates, the composer's quick-reply
  buttons' canned text, and the coupon/product text a staff member inserts into a draft message — stays
  Thai regardless of the admin's UI language, same rule as `applyGenderParticle()`'s ครับ/ค่ะ elsewhere
  in this file (brand voice sent to a Thai-speaking customer must not silently become English just
  because the staff member's own UI is set to English). Regex patterns matching a *customer's* raw Thai
  chat text (e.g. `/สลิป|โอน|ชำระ/`) are correctly left untouched too — they detect words a customer
  typed, not UI copy. Update [AGENTS.md](../AGENTS.md) § i18n coverage (not just this file) after any
  future admin i18n pass, since that section carries the authoritative namespace/file counts.
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
  [docs/business/inventory.md](business/inventory.md#bulk-product-import-csvxlsx) and
  [docs/architecture/api.md](architecture/api.md) for the full rules.
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
  See [docs/ui/inbox-diagnostics.md](ui/inbox-diagnostics.md).
- **AI tool-calling (customer + staff assistant)**: Claude now calls real backend tools instead of
  keyword-matching NLU. Customer-facing pipeline (`lib/bms/pipeline.ts`) tries AI tool-calling first
  (falls back to the old deterministic rule-based path only when no AI credentials/quota exist).
  Staff get a separate `/admin/assistant` page (`bmsAssistant` mutation) with the full read/write
  tool catalog, filtered by their own RBAC and re-checked at execution time; every tool attempt is
  recorded as redacted `ai.tool_call` audit metadata. Sensitive actions (refund, cancel, adjust stock, merge
  customers, …) are **propose-only** — the AI prepares a request, a human clicks Confirm, and that
  fires the same permission-gated mutation the admin UI already used. See
  [docs/ai/workflow.md](ai/workflow.md) and [docs/ai/tools.md](ai/tools.md) for the full
  design, and § AI tool-calling in [CLAUDE.local.md](../CLAUDE.local.md) for gotchas/example usage.
- **Deterministic AI routing + eval suites**: unambiguous customer intents (own-order status, payment
  submission, reorder, coupon wallet, and a fully confirmed single-item order) are routed by the
  server through `runApprovedTool()` — the same authorization, argument-validation, and audit boundary
  as model-selected calls, minus provider tool-selection variance. Within one provider loop, a
  repeated successful tool call replays its earlier result instead of writing twice, and every
  customer reply passes one sanitizer that shortens UUIDs and keeps the shop's `ค่ะ` brand voice.
  Verification lives in [`scripts/ai-eval/`](../scripts/ai-eval/README.md): a deterministic runtime
  contract suite (no network/DB) plus a live-model end-to-end suite that asserts backend state — see
  [docs/AI_GUIDELINES.md](AI_GUIDELINES.md#evaluation-checklist). Live evals write real data,
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
  (`send_customer_message` → `bmsSendMessage`, LINE/Meta only). See [docs/ai/tools.md](ai/tools.md).
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
  See [docs/ai/workflow.md](ai/workflow.md), [docs/ai/tools.md](ai/tools.md), and the new
  `BMS_EVAL_MODE=natural` suite in [`scripts/ai-eval/`](../scripts/ai-eval/README.md).
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
- **Auditable AI usage accounting (2026-08-13, migration `7.82`)**: billing, provider activity, and
  metered cost used to be conflated in one `credits_used`/`estimated_cost` pair, so a multi-round tool
  loop, a validation retry, or an OCR provider fallback was indistinguishable from a customer doing
  more work — and `/admin/billing` filled the gap with client-side *mock* estimators (a hardcoded
  $0.35/credit and a `buildMockLedger()` fabricating grant/usage/top-up rows). `7.82` makes the three
  dimensions first-class columns on `bms_ai_usage_events`: **`billable_credits`** (what the tenant was
  charged — one credit per *logical* request on a finite plan, zero on an unlimited plan),
  **`provider_calls`** (actual provider attempts), and **`actual_cost_usd`** (metered cost attributed
  from provider-reported tokens against the configured rate card — **not a provider invoice**), plus
  `unpriced_provider_calls` for attempts that returned no usage. Cost widens to `NUMERIC(16,8)` so a
  small-but-real per-request cost is no longer rounded to a falsely authoritative `$0`; when *no*
  attempt reports usage, `actual_cost_usd` is `NULL` rather than `0`, and summaries surface
  `unpricedProviderCalls` so partial knowledge is never presented as complete. The backfill classifies
  legacy rows and stamps `meta.usage_accounting_version = '2'` so it is idempotent. Retries and
  fallbacks share one `meta.usage_group_id`, and `requests` counts `DISTINCT usage_group_id` — a
  shared-key Qwen→Anthropic OCR fallback is therefore one billed logical request with two provider
  attempts. Finalization (`finalizeAiUsageEvent()`) is one-shot, so overlapping cleanup paths cannot
  double-add cost; a reservation that ends with `provider_calls = 0` is refunded atomically with a
  `refund` ledger row, and `reconcileStaleAiReservations()` sweeps reservations left `started` for over
  15 minutes (a process that died mid-request) on the same terms. Tenant BYOK key tests are real
  inference calls and are recorded as zero-credit `ai_key_test` events; platform-wide health probes stay
  outside tenant billing entirely. `/admin/billing` now renders the real
  `bmsAiUsage`/`bmsAiUsageBreakdown` fields (`billableCredits`/`providerCalls`/`actualCostUsd`/
  `unpricedProviderCalls`) and the mock estimators are deleted. Wired across chat, pharmacy, follow-ups,
  report generation, BYOK tests, and slip OCR, with regression coverage in
  [`scripts/ai-eval/`](../scripts/ai-eval/README.md) for retries, partial usage, unknown models, and
  provider rate cards. Full contract: [docs/ai/workflow.md](ai/workflow.md). **Migration `7.82` has
  not been applied to production yet.**
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
  [CLAUDE.local.md](../CLAUDE.local.md).
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
  [CLAUDE.local.md](../CLAUDE.local.md) for the two non-obvious rules (never hook the alert off a tool's
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
- **Shared customer identity across general + pharmacy flows (2026-08)**: both surfaces now resolve
  the same tenant-scoped `bms_customers` record through normalized `(channel, customer_ref)` identities
  (`lib/bms/customerIdentity.ts` / `customers.ts`); there is no pharmacy-only customer table and no
  cross-tenant sharing. Migration `7.74` backfills historical orders, conversations, restock
  subscriptions, and pharmacy assessments onto that canonical customer. Own-order history/reorder may
  follow canonical `customer_id` across channels, but customer payment auto-selection is deliberately
  narrower: only a `PENDING` order on the current channel is payable, marketplace payment remains in
  Seller Center, and repeated notices use `submitPaymentOnce()` rather than creating duplicates.
  Pharmacy patient memory reuses only consented, customer-confirmed, relationship-matched safe fields;
  current-message values win and stale age is discarded. Inbox logging best-effort establishes the
  identity even on deterministic/mock/fallback routes so early exits do not leave CRM history unlinked.
- **AI function registry hardening (2026-08)**: `tools/catalog.ts` remains the authoritative registry
  (66 total tools, 21 customer tools at this snapshot). `assertValidToolRegistry()` now fails startup
  for duplicate/non-snake-case names, invalid/duplicate surfaces, sensitive tools exposed to customers,
  or required schema fields that were never declared. Registry-only disambiguation metadata now also
  covers `get_order_status`, `get_customer_checkout`, `save_customer_checkout_details`, and
  `submit_payment`, preserving the canonical-history vs. current-channel-payment boundary. Internal
  identity lookup, payable-order selection, and pharmacy patient-memory helpers are intentionally not
  model-callable tools because model-supplied customer/health identifiers must never become authority.
- **Public customer checkout (`/checkout?t=<signed-token>`)** — ✅ implemented; the wireframe in
  [docs/ui/customer-checkout-wireframe.md](ui/customer-checkout-wireframe.md) is now an
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
  cron endpoints and is likewise **not yet scheduled**. See [docs/ui/dashboard.md](ui/dashboard.md)
  and [docs/architecture/api.md](architecture/api.md).
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
  caller passes attachments yet. See § "ส่งรายงานเป็นอีเมล" in [CLAUDE.local.md](../CLAUDE.local.md) for
  the full design and unverified items (migration not yet applied/exercised against a live mail
  provider).
- **Follow-up Automation (`lib/bms/followups.ts`, 2026-08; v2 analytics/queue scoring update 2026-08-11)** — 🚧 **MVP core with v2 visibility**: a configurable
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
  gated by two new permissions, seeded to Manager (both) and Sales (view only). As of **August 11,
  2026**, the queue page also exposes **v2 operator visibility**: a heuristic per-job opportunity
  score (`HOT`/`WARM`/`COOL`) with human-readable reasons, plus 30-day analytics
  (`bmsFollowupAnalytics`) for reply rate, order-after-follow-up rate, top goals/intents, and a
  daily trend. The cron route `POST /api/bms/followups/run` now also records run history in
  `bms_job_runs` under the key `followups`, so `/admin/operations-schedule` can show actual
  scheduler invocations in addition to per-message outcomes from `bms_followup_history`.
  **Still deferred on purpose** (see `CLAUDE.local.md` § Follow-up Automation for why): the
  multi-step branching Workflow Engine + visual Workflow Builder, and a truly **decision-driving**
  numeric scoring model that replaces rule selection rather than merely helping operators prioritize
  the queue. `business_hours_only` is a fixed 09:00–18:00 Asia/Bangkok approximation, not a parse
  of the shop's free-text `businessHours` (no structured open/close schema exists yet). **Not
  verified against a live DB in the session that built it** — `tsc` passed but the migration was
  never applied/exercised end-to-end; verify before relying on it.
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
  usage" in [AGENTS.md](../AGENTS.md) for the invariants (what's cached vs. never cached, fail-open
  design, what's *not* covered — community/`USER_COOKIE` logins are still stateless JWT with no
  revocation). Redis auth is now **opt-in** rather than absent: setting `REDIS_PASSWORD` makes the
  compose redis service start with `requirepass` (unset = unchanged, no password), and `REDIS_URL`
  must carry the credential too. **Still not done**: TLS — use `rediss://` and terminate properly
  before Redis leaves the host it shares with `web`.
- **Multi-instance readiness (2026-08)** — ✅ every piece of per-instance state that would break
  running more than one `web` (or `ws`) container is gone, with every default preserving
  single-instance behavior — nothing here requires setting a new env var to keep working exactly as
  before. See § Multi-instance readiness in [CLAUDE.local.md](../CLAUDE.local.md) for the full list
  (pg pool sizing on both `web` and `ws`, Redis-backed rate limiting, the `lib/storageDrivers/`
  abstraction with a `local`/`s3` driver, two cron jobs that used to read-then-act and could
  double-send under concurrent schedulers, and removal of a second unused Postgres pool inside
  `apps/ws`). Verified against real Postgres/Redis/MinIO, not just `tsc` — see that section for what
  each test actually proved. Not yet done: an end-to-end run with `STORAGE_DRIVER=s3` through the
  app itself, and adding replicas/LB to any compose file (a topology decision, not a code change).
- **Authentication identity + social-login hardening (2026-08)**: `lib/auth/identity.ts` is the
  shared public-login/register contract: trim + Unicode NFKC + lowercase for username/email,
  server-side username/email/phone/password validation, reserved system handles, and bcrypt's
  72-byte effective password bound. Migration `7.75` canonicalizes stored values and adds unique
  indexes on `lower(btrim(email))` / `lower(btrim(username))`; it intentionally aborts if historical
  case-only duplicates exist rather than merging security principals. `Admin`/`admin`/`aDmin` are
  therefore one login identity, while public registration rejects `admin` entirely. Public
  registration no longer creates a session before email verification, public Subscribers cannot get
  an admin cookie, missing-account password checks use a dummy bcrypt hash, and auth endpoints have
  bounded IP + hashed-identity limits (Redis-backed since the multi-instance pass above, so the
  limit is fleet-wide; it degrades to the old per-instance window if Redis is unreachable rather
  than failing open). Mobile login is implemented; email verification/password reset consume tokens
  atomically. Google ID tokens must be verified with `google-auth-library` (never decoded-only), and
  Facebook debug-token `app_id`/`user_id` must match. `FACEBOOK_APP_SECRET` is server-only; Compose
  accepts the old public-named env only as a temporary value fallback without exposing that name to
  the app runtime. See [docs/architecture/api.md](architecture/api.md).
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
- **Carrier shipment booking + tracking sync (2026-08)** — 🧪 **safety layer complete, live Flash/Kerry
  request shapes still unverified**: `bms_shipments` now carries carrier-integration state (migrations
  `7.76`/`7.77` — `external_shipment_id`, `carrier_last_synced_at`, `carrier_tracking_source`,
  `carrier_booking_status`/`_error`/`_attempted_at`) plus a normalized event history in
  `bms_shipment_tracking_events`. `createShipment()` commits the local fulfillment transaction and
  releases its order/inventory locks **before** any carrier call, then books with the shipment UUID as
  a stable idempotency key; a failed/unconfigured/`not_implemented` carrier is persisted as a visible,
  retryable state (`bmsBookShipmentLive`) instead of silently looking like a successful manual
  shipment. `bmsSyncShipmentLive` (and cron `POST /api/bms/shipping/sync-carriers`, recommended every
  15 minutes, **not yet scheduled** — it does record its run into `bms_job_runs` as
  `carrier-tracking-sync`) re-locks and re-checks the shipment after the network call, writes
  status + events atomically, never regresses a status or touches a terminal
  `DELIVERED`/`RETURNED`/`CANCELLED` shipment, and keeps only HTTPS label URLs. Staff supplying a
  tracking number at creation, and Lazada/Shopee orders, skip carrier booking entirely (already
  created externally / marketplace-managed). Every carrier call is bounded by a 10-second timeout and
  normalized into a typed result — adapters never throw. **What is still not real**: Flash and Kerry
  remain mock-ready scaffolds; `getStatus()` reports `not_implemented` even with a key set, because
  neither merchant contract (base URLs, auth/signing, consignment rules, callbacks) has been obtained
  and this codebase does not guess payload shapes — same lesson as the Lazada/Shopee webhook
  placeholder. Mock mode is tagged `source: "mock"` end-to-end and refuses to run in production. See
  [docs/integrations/carriers.md](integrations/carriers.md) for the live-enablement checklist.

- **Shop owners (Manager role) manage their own staff (2026-08)** — ✅ implemented; previously only a
  tenant `Administrator` or a platform admin could touch users, because user CRUD predates the
  permission engine and gated on a hardcoded `ctx.admin.role === "Administrator"` string. Now a
  **two-layer** model: new permission keys `user.view`/`user.manage` (`BMS_PERMISSIONS`, seeded to
  `Manager` per-tenant by migration `7.78`) decide *whether* the Users module opens, and a separate
  code-level role rank (`lib/bms/staffRoles.ts`: Administrator 100 · Manager 60 ·
  Sales/Warehouse/Staff 20 · Subscriber 0, enforced by `lib/bms/userAdmin.ts`) decides *which rows*
  may be touched and *which roles* may be assigned — **strictly below the actor's own rank**, which
  in one rule blocks self-escalation, peer-Manager password resets, and peer demotion. `Administrator`
  and platform admins short-circuit permission/rank checks for non-platform targets. Three rules there
  are load-bearing: the target's role is always re-read from Postgres (never trusted from the request); a
  row with `is_platform_admin` is untouchable by another account regardless of rank (a platform admin is an ordinary
  `users` row carrying a `tenant_id`, so a low-ranked one inside the shop would otherwise be a
  password-reset takeover path); and the requested role is resolved against `roles` **before** any
  write with unknown names rejected — because the trigger `trg_users_sync_role_and_role_id`
  (`db/migrations/001_normalize_roles_phase1.sql`) silently `INSERT`s a *new global role row* for
  unrecognized `users.role` text, so `upsertUser` now writes `role_id` only and both raw-text write
  paths are deleted. `/admin/permissions` stays `requireSuper`, so a Manager can never grant itself
  `user.manage`; unticking it there is the kill switch. User CRUD also now writes `bms_audit_log`
  (`user.create`/`update`/`delete`/`delete_bulk`, plus `user.manage_denied` on refusals — never the
  password hash) so the shop Administrator can see what their Manager did; the previous `system_logs`
  entries are unchanged. User quota checks now lock the tenant row in the create transaction, while
  the mandatory `reassignStaffConversations()`-before-delete runs in the delete transaction and
  excludes every member of a bulk-delete set from reassignment. Full rules:
  [docs/architecture/api.md](architecture/api.md) § RBAC. **Not yet verified against a live DB** —
  `tsc` + `next build` pass, but migration `7.78` has not been applied or exercised end-to-end.

- **System Health page + request metrics (2026-08)** — ✅ implemented, **no migration, no new
  permission**: `/admin/system-health` (platform-admin only, gated by `requirePlatformAdminPage()` in
  its own `layout.tsx` like `/admin/env`) is a single read-only page answering "how is the system doing
  right now", which previously required visiting four separate pages. `lib/bms/systemHealth.ts` is a
  composition layer — it reuses `listAiProviderHealth()` and `listLatestJobRunPerJob()` unchanged, and
  only adds reads that genuinely did not exist: Postgres vitals (`pg_stat_activity` connections,
  longest running query, DB size), a Redis PING/INFO, a **cross-tenant** view of Channel Health
  (`channelHealth.ts` is tenant-scoped only), and a list of `bms_failure_incidents` — that table
  (migration `7.36`) had shipped with no list page at all, visible only through bell/Slack
  notifications. Every read returns `{ok:false, error}` rather than throwing, so an unapplied
  migration degrades to one warning card instead of a 500 on the whole page.
  **Latency/error-rate instrumentation** is the second half: `graphql/metricsPlugin.ts` (one Apollo
  plugin registered in `app/api/graphql/route.ts`) records duration + error code for every GraphQL
  operation into Redis via `lib/bms/requestMetrics.ts`, surfaced as a p50/p95/p99 + error-rate table
  with a 15min/1h/3h window selector. Storage is deliberately Redis histogram buckets, not a Postgres
  table: one row per request would add write load to the very database the page exists to diagnose,
  raw samples would be unbounded in memory, and an in-process `Map` would report per-instance numbers
  the moment a replica exists (`HINCRBY` merges across instances for free). Consequences to keep in
  mind: percentiles are **approximations** interpolated from bucket boundaries, and all metrics are
  lost on a Redis restart (TTL 4h). The table sorts by *total* time (calls × avg) by default, not p95,
  because a fast operation called constantly usually costs the database more than a slow one called
  rarely. **Not covered yet**: which SQL statement is slow (needs `pg_stat_statements` — now preloaded
  in `docker-compose.yml`, but requires a Postgres restart plus `CREATE EXTENSION` per database before
  any data exists), REST route timing (Next App Router has no central place to time a route handler;
  `recordRequestMetric()` already namespaces by name prefix so `rest:/api/bms/...` needs no code
  change), and container CPU/memory (skipped on purpose — it would require Docker socket access).
  **Not yet verified against a live browser** — `tsc` + `next build` pass and the percentile math has
  13 passing unit-style cases, but the docker stack wasn't running on the machine that built this, so
  the page itself, and the new cross-tenant channel-health/failure-incident queries, have never run
  against a real DB. See § Observability in [AGENTS.md](../AGENTS.md).

- **Point of Sale + Thai tax invoicing (2026-08)** — ✅ implemented, migrations `7.84`–`7.98`, fully
  documented in [docs/business/pos.md](business/pos.md): a device-token-paired counter screen
  (`/pos`) sells against a location/lot/pack-aware inventory model. Build order was locations → lots
  → product packs (`7.84`–`7.86`) → POS devices/shifts (`7.87`) → VAT/tax documents (`7.88`, `7.89`)
  → cashier PIN (`7.90`) → returns/refund settlement (`7.91`) → cashier-only accounts (`7.92`) →
  per-size pack barcodes (`7.93`) → e-Tax submission queue (`7.94`) → credit notes/cash rounding
  (`7.95`), then a side-rail layout pass restyled the till for a fixed 768px screen. A device token
  identifies tenant/location; a cashier PIN identifies every action, checked server-side per
  mutating route against its own permission (`pos.sell`, `pos.shift.open/close`, `order.return`,
  `payment.refund`). Settlement (stock, FEFO lot consumption, tax document issuance) is one atomic
  transaction; idempotency keys make sale/return/refund-settlement writes safe to retry. Refund
  allocations split cash (immediate) from non-cash (pending until confirmed), and a shift can't
  close with one pending. Tax documents are immutable snapshots — changing tax settings only affects
  bills issued afterward; cash rounding applies only to fully-cash bills and never touches the VAT
  base. e-Tax XML submission to the Revenue Department (`lib/bms/etax/*`, `7.94`) is a separate
  background queue, gated off by default, with no real signing/submission provider wired up yet —
  its cron route also authenticates differently (`x-job-token`) and doesn't yet record into
  `bms_job_runs` like the rest of the cron endpoints do. ESC/POS printing and cash-drawer kick over
  WebUSB (`lib/pos/escpos.ts`) are written but have never been run against real printer hardware.
  `7.96` adds membership tiers, a loyalty ledger, layered discounts, POS member lookup, and the daily
  expiry/tier-review job. `7.97` adds parked bills, audited drawer cash movements, two-person voids,
  and X/Z shift reports. `7.98` adds two-step inter-branch transfers and snapshot-difference stock
  counts, with separate permission to apply a variance. Operator details and go-live checks are in
  [docs/business/pos.md](business/pos.md) and [docs/business/inventory.md](business/inventory.md).
  Full invariants: [docs/agent-invariants.md § POS and tax](agent-invariants.md#pos-and-tax).
  `9.5` (2026-08-20) closed a retry gap the other write paths already had: standalone drawer cash
  in/out had no idempotency key, so a lost response could move the same cash twice. The same pass
  fixed four correctness bugs found on recheck: serial-number dedup now spans the whole bill instead
  of one line at a time, and the in-transaction write that marks a serial `SOLD` is race-safe against
  two bills claiming it at once; deposit settlement now requires the reserved order's own serials
  instead of accepting an empty list; the shift report is scoped to the requesting device and counts
  sales directly off `COMPLETED`/`RETURNED` orders instead of subtracting voids after summing every
  status; and a split cash+card refund on one return no longer doubles its count and total.

- **Multi-store stock capabilities (`9.40`–`9.41`, 2026-08-31)** — Added additive archetype presets
  for pet supply, building materials, and restaurants; tenant capability overrides; product stock
  policies; integer-base measured goods; versioned recipes/modifiers; immutable order consumption
  snapshots; kitchen tickets; and audited wastage. `createOrder()` now resolves and reserves actual
  component lines once, while every existing reserve/release/ship/return/FEFO/movement path continues
  through `bms_order_stock_lines`. POS prefix-22 scale labels are mapped and re-parsed server-side;
  price-embedded prefix-21 labels fail closed. Legacy direct/bundle orders keep their original view
  fallback. Migrations were applied twice against local Postgres; pure and DB contracts cover preset,
  snapshot, recipe/modifier reserve+cancel, and weighed-label mapping.
  Three Admin pages ship with it — `/admin/stock-models` (capabilities + per-product model + recipes
  and modifiers), `/admin/wastage`, and `/admin/kitchen` — all bilingual and reachable from the
  sidebar. Stock Models and Wastage sit in the shop group behind `product.view`; the kitchen board
  appears only for the restaurant archetype, the one preset that turns `KITCHEN_WORKFLOW` on. No new
  permission: model edits reuse `product.edit`, ticket moves `order.ship`, write-offs `stock.adjust`.
  A recheck then found three failures the feature tests had not touched: `9.42` widens
  `bms_stock_movements_type_check` for `WASTAGE` (without it every write-off rolled back), and both
  `createShipment()` and `releaseExpiredOrders()` were still moving stock straight from
  `bms_order_items` — broken for bundles since `8.8`, and for every menu bill after `9.40`. The
  view invariant is now enforced by `scripts/order-stock-lines-contract.test.mts` instead of prose.
  A POS-focused pass then found the register half had never worked end to end: `parsePosSaleLines()`
  is an allowlist and dropped both `modifierCodes` (options deducted nothing, silently) and
  `scaleBarcode` (weighed lines priced as one base unit, so every such bill died on
  `PAYMENT_MISMATCH`); a scale-shaped barcode that mapped to nothing made that product unscannable
  instead of falling through to the ordinary lookup; `inStoreBarcode()` could mint codes in the two
  prefixes the scale owns; and the cart line, the line amount and the customer display each computed
  a weighed line differently from the bill total.
  A follow-up pass on "does the register differ by shop type" answered mostly no — one code path,
  six fixed tabs, and only the pharmacy archetype changes the sale itself — and closed what that
  exposed: eight of the thirteen capability flags were switches nobody read (they now render as
  detected status and refuse to be written, with `store-capability-gates-contract` keeping the
  switch list equal to the real gates); kitchen tickets were created from `stock_policy` alone, so a
  shop using recipes only to deduct ingredients accumulated tickets no page showed, and the sidebar
  entry now follows the same `KITCHEN_WORKFLOW` flag that creates them; and the register now reports
  how many lines went to the kitchen instead of leaving the cashier to walk over and ask.
  A final audit of the three new shop types confirmed both database constraints, the signup and
  settings pickers, and the `businessType` mapping already covered them, and that pre-`9.40` shops
  are untouched — proven rather than argued, by a contract that builds a shop with an old archetype
  and no `9.40` rows, sells from it, and flips its archetype without its stock changing meaning. It
  also found three switch statements the new types had never been wired into (AI examples and the
  onboarding checklist), plus two older gaps of the same shape: `b2b_wholesale` had four translated
  checklist lines no case ever selected, and `pharmacy` had none of its own at all.
  Clearing the last outstanding items turned up two failures older than this work. Two sales rung on
  the same shift at the same moment deadlocked, because `createOrder()` reserved stock and only then
  touched the shift row through the `pos_shift_id` foreign key, while `finalizePosSale()` locks the
  shift first — opposite orders, so a retry racing its own original could take both down;
  `createOrder()` now takes the shift lock the key check will need before it reserves anything. And
  the unpaid-order cron ran as one transaction across every tenant, so a single unreleasable bill
  rolled back the whole sweep and met the same bill again next run — it now sweeps one bill per
  transaction and reports the ones a human has to look at.
  One more pass over the operational half found four faults nothing had exercised. The kitchen board
  asked for tickets oldest-first under a row cap, so a restaurant that had pushed more tickets than
  the cap was served the oldest — all long since eaten — and no new ticket could ever appear again:
  the board now shows open work plus the last 12 hours of served tickets, drops cancelled ones
  entirely, and lets the cap discard history rather than today. Voiding or cancelling a bill left its
  tickets open, so the kitchen cooked and binned food for a refunded bill with nothing on the board
  saying why; both paths now close their tickets in the same transaction as the refund. The write-off
  path moved `bms_inventory` without touching `bms_inventory_lots`, breaking the invariant `lots.ts`
  depends on for exactly the flow discarded stock uses — a binned expired lot kept its quantity, FEFO
  offered it again, and the reconcile job reported drift with nothing to trace it to; write-offs now
  consume the soonest-expiring lot first without skipping expired ones, and refuse outright when the
  lot rows are short of the summary row. Lastly the two capability mutations checked only for an
  admin session while the screen hid their switches behind `product.edit` — a hidden button is not a
  gate, and these switches change how every bill in the shop is deducted.
- **Atomic restaurant round replacement (2026-09-01, no migration)** — sending a later kitchen
  round no longer commits the release of the previous PENDING order before attempting its
  replacement. `createOrderInTx()` now exposes the existing order builder to a caller-owned tenant
  transaction, so the old order/key/reservation, the new whole-check reservation, new kitchen
  tickets and the check link commit or roll back together. An insufficient later round keeps the
  earlier reservation intact for food already being prepared. Whole-check cancellation now applies
  the same boundary to order cancellation, released stock, stopped tickets, the closed check and its
  audit. The public `createOrder()` contract and ordinary callers remain unchanged.
- **Restaurant core completion (`9.45`, 2026-09-01)** — modifiers now carry a server-owned,
  non-negative surcharge per menu unit. `createOrderInTx()` resolves it from the active tenant
  catalog and snapshots it into line pricing, preserving VAT/receipt/commission/return arithmetic;
  `/admin/stock-models` edits it and `/pos/restaurant` previews it. Restaurant checkout now accepts
  split tender through the existing POS payment settlement, and its KDS auto-refreshes the
  branch-scoped queue every five seconds. Floor setup, kitchen transitions and whole-check
  cancellation use new semantic permissions instead of borrowing `pos.device.manage`, `order.ship`
  and blanket `pos.sell`. A follow-up hardening pass locks the check and reservation order across
  instances during settlement, makes paid-response replay same-register-only, rejects stock
  modifiers outside RECIPE instead of ignoring their ingredient deltas, and makes commission use
  named-pack revenue rather than base-unit multiplication.
- **Approver visibility at the counter (2026-08-31, no migration, no new permission)** — every
  approver picker at `/pos` filtered the staff list on "has a PIN" alone, so a cashier could pick a
  colleague who could not approve and only found out after that person had typed their PIN in front
  of the customer. The session now carries `approvers` — everyone holding a counter-approval
  permission, with the set they hold — kept deliberately separate from `cashiers` (filtered to
  `pos.sell`), because a manager who never stands at a till would otherwise vanish from the one list
  where they matter. Holders without a PIN stay listed and disabled, saying why. All 25 permission
  refusals now name the job in words staff use plus the roles in that shop that hold it, never the
  raw permission id, and end with the way forward. The filtered list is UX only: every route still
  re-checks the approver server-side.

**Roadmap remaining:** TikTok send API · email/voice outbound · live Flash/Kerry carrier adapters
(booking/label/tracking plumbing is built and hardened — see "Carrier shipment booking + tracking
sync" above; what's missing is the carrier-issued merchant contract and credentials, then following
[docs/integrations/carriers.md](integrations/carriers.md)) ·
AI OCR (beyond payment-slip verify) · ML-grade forecasting (current is heuristic) · WhatsApp AI ·
Shopee/Lazada signature verification against real Open Platform docs · configuring
`BMS_APP_BASE_URL` and `BMS_CRON_SECRET` in GitHub so `.github/workflows/bms-cron.yml` can trigger
the seven scheduled endpoints (including `loyalty/maintenance`) instead of silently skipping them ·
adding a password/TLS
to Redis before a real
production deploy (see "Redis infrastructure hardening" above) · Follow-up Automation's Workflow Engine,
decision-driving scoring model, and deeper analytics/dashboarding beyond the current queue summary
(see above) · finishing admin i18n (48 of 78 admin `.tsx` files are bilingual; the remaining 30 are
layout/loading guards and English-only legacy platform pages — see [AGENTS.md](../AGENTS.md) § i18n
coverage before assuming any of them is a leak) · restarting Postgres to make the already-preloaded
`pg_stat_statements` take effect (plus `CREATE EXTENSION` per database) so `/admin/system-health` can
add a slow-query card · instrumenting REST route latency (`rest:` prefix, no recorder change needed)
· deciding whether container CPU/memory belongs on `/admin/system-health` given the Docker-socket
access it would require.
