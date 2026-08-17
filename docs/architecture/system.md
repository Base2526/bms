# System Architecture

> Entry point: [CLAUDE.md](../../CLAUDE.md) · Business rules: [../business/](../business/) · AI: [../ai/](../ai/)

## Vision

Every customer conversation should become an executable business workflow.

```
Traditional:  Customer → Human → Excel → ERP
BMS:       Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

BMS is **not** a chatbot — it is an AI Business Operating System. AI orchestrates; it never
becomes the source of truth (the database is).

## Core philosophy

AI never accesses the database directly and never writes SQL. AI only:

- Understands user intent
- Selects the correct business tool
- Summarizes data
- Explains results

Business logic lives in backend services (`apps/web/lib/bms/*.ts`). Database access is only
allowed through those approved service functions. See [../ai/prompts.md](../ai/prompts.md) for
the concrete guardrails enforced in the actual Claude prompt.

## High-level flow

```
Customer → Channel Integration → Omnichannel Inbox → AI Orchestrator
         → Business Functions → Database → Response Generator → Customer
```

## System modules

| # | Module | Responsibility |
| - | --- | --- |
| 1 | Channel Integration | Normalize LINE/TikTok/Facebook/Instagram/Web/Shopee/Lazada into one internal message format |
| 2 | Omnichannel Inbox | Unified chat history, assignment, notes, tags, customer 360 view, attachments, search |
| 3 | AI Orchestrator | Intent detection → entity extraction → tool selection → response generation |
| 4 | CRM | Customer profile across channels, addresses, purchase history, merge |
| 5 | Product Management | Products, variants, SKU, pricing, categories, brands |
| 6 | Inventory (IMS) | Current/reserved/available stock, movements |
| 7 | Orders (OMS) | Order lifecycle, staff create/reorder, invoice preview, fulfillment address guard |
| 8 | Purchase | Supplier purchase orders, receiving |
| 9 | Payment | Bank transfer/QR/card/cash/TikTok, public signed-link checkout, AI slip verification (advisory only) |
| 10 | Shipping | Carrier tracking, packing, labels |
| 11 | Reports | Dashboard, sales, inventory, profit estimate, generated XLSX/CSV/PDF exports |
| 12 | Public Marketing & Onboarding | Landing infographic, pricing, self-serve signup, session-aware CTA routing |

Full per-domain rules: [../business/order.md](../business/order.md) ·
[../business/inventory.md](../business/inventory.md) · [../business/payment.md](../business/payment.md) ·
[../business/crm.md](../business/crm.md)

Scale planning for admin workloads: [admin-scale-readiness.md](./admin-scale-readiness.md)

## Build status (2026-08)

Operational modules per this spec are **fully built** — order lifecycle closes end-to-end
(order → payment → shipping → delivered/completed) with omnichannel capture on every major channel.

| Module | Status | Location (service · migration) |
| --- | --- | --- |
| Channel Integration | ✅ | `app/api/bms/{line,tiktok,facebook,instagram,web}/webhook` · `lib/bms/meta.ts` |
| Channel Integration — Shopee/Lazada | 🧪 beta | `app/api/bms/{shopee,lazada}/webhook` — see [../integrations/lazada.md](../integrations/lazada.md) |
| Channel Health Status | ✅ | `lib/bms/channelHealth.ts` · `6.4__bms_channel_health.sql` · badges on `/admin/settings` + sidebar/dashboard alerts + `POST /api/bms/channels/check-health` cron |
| AI Provider Health | ✅ | `lib/bms/aiProviderHealth.ts` · `7.34__bms_ai_provider_health.sql` · platform-wide table/badge on `/admin/env` + `POST /api/bms/ai/check-health` cron |
| Failure Incident Alerting | ✅ | `lib/bms/failureAlert.ts` · `7.36__bms_failure_incidents.sql` · tier-split in-app/browser alerts to shop + platform admins (`GlobalFailureNotifier`) |
| Omnichannel Inbox | ✅ | `lib/bms/inbox.ts` · `5.5__bms_inbox.sql` · see [../ui/customer360.md](../ui/customer360.md) |
| Inbox Realtime Diagnostics | ✅ | `/admin/inbox/realtime-diagnostics` · see [../ui/inbox-diagnostics.md](../ui/inbox-diagnostics.md) |
| AI Orchestrator | ✅ | `lib/bms/{nlu,pipeline,ai}.ts` — see [../ai/workflow.md](../ai/workflow.md) |
| AI Tool-Calling (customer + staff assistant) | ✅ | `lib/bms/tools/{types,runtime,catalog}.ts` · `graphql/bmsAssistant.ts` · `/admin/assistant` — see [../ai/workflow.md](../ai/workflow.md) and [../ai/tools.md](../ai/tools.md) |
| AI Usage, Credits & Cost Accounting | ✅ | `lib/bms/{aiUsage,aiConfig}.ts` · `6.8` / `7.27` / `7.35` / `7.82` · `/admin/billing` — billable credits, provider calls, and attributed USD cost are three separate dimensions; see [../ai/workflow.md](../ai/workflow.md) |
| AI Quality Review | ✅ | `7.31` / `7.32` · `/admin/ai-quality` — see [../ai/quality.md](../ai/quality.md) |
| AI Pharmacy Intake Assistant | 🧪 flag-gated, off by default | `lib/bms/pharmacy/*` · `7.57`–`7.73` + `7.83` · `/admin/pharmacy-queue`, `/admin/pharmacy-protocols`, `/admin/pharmacy-intake-lab` — AI takes the intake, a **licensed pharmacist** makes every clinical decision; see [`lib/bms/pharmacy/README.md`](../../apps/web/lib/bms/pharmacy/README.md) and the [QA script](../testing/pharmacy-protocol-workflow-and-test-cases.md) |
| Coupons / Discount Codes | ✅ | `lib/bms/coupons.ts` · `7.21` / `7.23` / `7.25` · `/admin/coupons` + customer coupon wallet — see [../business/order.md](../business/order.md) |
| Restock Notifications | ✅ | `bms_restock_subscriptions` / `bms_restock_deliveries` · `7.41` · `/admin/restock-subscriptions` — customer opt-in requires explicit consent |
| Revision History | ✅ | `graphql/bmsRevisions.ts` · `7.0`–`7.14`, `7.22` · `/admin/revisions` — before-UPDATE snapshots for products/orders/payments/shipments/purchase/coupons |
| Shop Archetype & Onboarding | ✅ | `7.42`–`7.44` · `/shop-signup` capture → sample-data seeding → runtime commerce policy — see [../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md) |
| CRM | ✅ | `lib/bms/customers.ts` · `3.6__bms_crm.sql` · cross-channel merge — see [../ui/customer360.md](../ui/customer360.md) |
| Product Management | ✅ | `lib/bms/products.ts` · `3.2` / `5.9` / `6.0` / `6.5` (multi-image gallery) |
| Product Bulk Import (CSV/XLSX) | ✅ | `lib/bms/productImport.ts` · `graphql/bmsProducts.ts` (`bmsImportProducts`) · `/admin/products` `ImportModal.tsx` — see [../business/inventory.md](../business/inventory.md) |
| Inventory (IMS) | ✅ | `lib/bms/{stock,movements}.ts` · `3.2` / `3.4` |
| Orders (OMS) | ✅ | `lib/bms/orders.ts` · `3.3` / `3.5` · staff create/reorder + invoice preview — see [../business/order.md](../business/order.md) |
| Purchase | ✅ | `lib/bms/purchase.ts` · `5.2__bms_purchase.sql` |
| Payment | ✅ | `lib/bms/payments.ts` · `5.3__bms_payments.sql` (+ AI slip verify) |
| POS (counter sale/return/refund) | ✅ | `lib/bms/{pos,locations,lots,productPacks}.ts` · `graphql/bmsPos.ts` · `app/(pos)/pos` · `app/api/pos/*` · migrations `7.84`–`7.96` — see [../business/pos.md](../business/pos.md) |
| Tax (VAT invoices, credit notes) | ✅ | `lib/bms/{taxDocuments,vat}.ts` · migrations `7.88`, `7.89`, `7.95` — abbreviated/full tax invoices, credit notes, cash rounding; documents are immutable once issued |
| Tax — e-Tax submission queue | 🧪 flag-gated, off by default | `lib/bms/etax/*` · `7.94__bms_etax_submissions.sql` · `POST /api/bms/jobs/etax` — background XML submission to the Revenue Department; issuing a tax document does not submit it by itself |
| Public Customer Checkout (signed link) | ✅ | `lib/bms/{checkout,checkoutToken}.ts` · `app/api/bms/checkout/*` · `app/(checkout)/checkout` — no migration; slip upload creates `PENDING` only, human confirms — see [../ui/customer-checkout-wireframe.md](../ui/customer-checkout-wireframe.md) |
| Shipping | ✅ | `lib/bms/shipping.ts` · migrations `5.4`, `7.76`, `7.77` · idempotent carrier booking, event history, manual/cron sync seam for Flash/Kerry (mock-ready, live merchant docs still pending) · [carrier integration checklist](../integrations/carriers.md) |
| Reports | ✅ | `lib/bms/{dashboard,reports}.ts` — see [../ui/dashboard.md](../ui/dashboard.md) |
| Generated Reports & Document Export | ✅ | `lib/bms/{reportEngine,documentGenerator}.ts` · `7.53__bms_generated_reports.sql` · `/admin/reports` AI Report Generator + GraphQL/REST/AI tool entry points — see [../ui/dashboard.md](../ui/dashboard.md) |
| Sales Digest Reports (email/Slack/LINE) | ✅ | `lib/bms/reportDigest.ts` · `7.37__bms_report_subscriptions.sql` · `/admin/settings` card + platform-admin `/admin/report-schedule` + `POST /api/bms/reports/send-digest` cron (not yet scheduled) — see [../ui/dashboard.md](../ui/dashboard.md) |
| Follow-up Automation | ✅ | `lib/bms/followups.ts` · `7.52__bms_followups.sql` · `/admin/followup-rules` + `/admin/followup-queue` + `POST /api/bms/followups/run` — queue includes heuristic score + 30-day analytics summary |
| Multi-tenant · RLS · RBAC · Plans · Audit | ✅ | `lib/bms/{tenant,permissions,plans,audit}.ts` · `4.0–5.1` / `5.7` / `5.8` |
| SaaS: Self-serve Signup | ✅ | `lib/bms/signup.ts` · `/shop-signup` |
| Public Landing / Interactive Infographic | ✅ | `app/(main)/page.tsx` · bilingual/session-aware CTA flow |
| Self Profile & Avatar | ✅ | `/admin/profile` · `bmsMe` / `updateMe` / `uploadAvatar` · per-user `theme_preference` / `language` |
| Support Tickets | ✅ | `support_tickets` / `support_ticket_comments` · `/support` · `/admin/support-tickets` |
| Batch & Cron Ops View | ✅ | `lib/bms/operationsSchedule.ts` · `/admin/operations-schedule` |
| Cron/Batch Run History | ✅ | `lib/bms/jobRuns.ts` · `7.55__bms_job_runs.sql` · every cron endpoint records status/duration/output; `POST /api/bms/jobs/report-run` lets the GitHub Action report back |
| System Health (`/admin/system-health`) | ✅ | `lib/bms/systemHealth.ts` · no migration, no new permission — reuses AI Provider Health/job-run/operations-schedule services, adds Postgres/Redis vitals, cross-tenant Channel Health, and a `bms_failure_incidents` list; GraphQL latency/error-rate via `lib/bms/requestMetrics.ts` (Redis histograms, `graphql/metricsPlugin.ts`) — not yet verified against a live browser/DB |
| Staff Management by Shop Owner (Manager) | ✅ | `lib/bms/{userAdmin,staffRoles}.ts` · `7.78__bms_user_management_perms.sql` · `/admin/users` — `user.view`/`user.manage` opens the module, a code-level role rank decides which rows may be touched; see [api.md](./api.md) § RBAC |
| Per-user Language & Theme Preference | ✅ | `users.language` / `users.theme_preference` · `7.50` / `7.56` / `7.81` (new accounts default to Thai) · `/admin/profile` + public `/settings` |
| Live Dashboard (`/live-dashboard`) | 🚧 layout only — every number is mock | `app/(main)/live-dashboard/page.tsx` — public route reusing the session cookie + `report.view`; no query is wired yet, see [../ui/dashboard.md](../ui/dashboard.md) |
| Platform Admin (cross-tenant) | ✅ | `lib/bms/platform.ts` · `/admin/tenants` · `5.6__bms_platform_admin.sql` |
| Tenant Drill-down (impersonate) | ✅ | `bmsEnterTenant`/`bmsExitTenant` · signed cookie `BMS_ACT_TENANT` |
| Ops: Daily AI Log Triage | ✅ | `.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/*` |
| Dev: Fake Data Seeder | ✅ | `/admin/dev/fake` · `app/api/dev/fake/*` |

**Roadmap remaining:** TikTok send API · live Flash/Kerry carrier adapters — the booking/tracking/label
plumbing and its safety contract are built (`7.76`/`7.77`), what is missing is the carrier-issued
merchant contract and credentials, then the [carrier checklist](../integrations/carriers.md) ·
e-Tax XML submission to the Revenue Department (`lib/bms/etax/*`, `7.94`) is built and flag-gated off
by default — no real signing/submission provider has been wired up or verified yet, and its cron
route (`POST /api/bms/jobs/etax`) doesn't yet record into `bms_job_runs` like the others do ·
ESC/POS printing/cash-drawer kick over WebUSB (`lib/pos/escpos.ts`) is written but has never been
run against real printer hardware ·
AI OCR / forecasting (beyond payment-slip verify; forecasting is heuristic, not ML) ·
WhatsApp / Email / Voice AI ·
Shopee/Lazada signature verification against real Open Platform docs ·
proactive external notification for Channel Health and AI Provider Health (e.g. LINE alert to the shop
owner) — needs an admin-to-LINE-user-id binding that doesn't exist yet, separate from the shop's own
LINE OA channel ·
failure-incident coverage beyond the LINE webhook (Facebook/Instagram/TikTok/Shopee/Lazada webhooks do
not report yet) and an admin page listing incidents (today they surface only as alerts/Slack/SQL) ·
wiring `/live-dashboard` to real queries (and re-reviewing its `?demo=1` bypass at that point) ·
finishing admin i18n (48 of 78 admin `.tsx` files are bilingual — see [AGENTS.md](../../AGENTS.md)
§ i18n coverage for what is deliberately *not* a gap) ·
Follow-up Automation's Workflow Engine and decision-driving scoring model ·
a password/TLS for Redis before a real production deploy ·
an actual cron schedule for the six ready-but-unscheduled endpoints (`orders/release-expired`,
`channels/check-health`, `ai/check-health`, `reports/send-digest`, `followups/run`,
`shipping/sync-carriers`) — all six already record their own run history in `bms_job_runs`, they just
need an external scheduler pointed at them.

**Migrations not yet applied to production (2026-08-13):** `7.33`, `7.52`, `7.54`, `7.55`, `7.56`,
`7.78`, `7.81`, `7.82`. This list predates the POS/tax feature set (`7.84`–`7.96`) and does not
cover it — check the target database and [CLAUDE.local.md](../../CLAUDE.local.md) rather than
trusting this list.

## RBAC model (two tiers)

- **Platform admin** (`users.is_platform_admin`) — manages the whole platform (every shop / plan /
  role). Views shop-level data only via **drill-down** (impersonation), never mixed across tenants.
- **Tenant role** (Administrator / Manager / Sales / Warehouse) — manages only their own shop.
  Every resolver scopes with `getTenantId(ctx)` + `requirePermission()`.

Users list/CRUD is gated to Administrator/platform, but platform admins in drill-down mode are
treated as tenant-scoped so `/admin/users` only shows the current shop. Role CRUD is platform-only.
Platform-level pages (Architecture, ENV/Logs/Posts/Files/Queue) are gated server-side in
`layout.tsx` via `requirePlatformAdminPage()` — not just a hidden menu item.

401 vs 403: 401 = not logged in / bad token → forced logout. 403 = logged in but lacking
permission → shows an error, does **not** log out (`apollo.ts` errorLink only logs out on 401).

## Folder structure

```
apps/
  web/
    app/api/bms/*        REST endpoints + per-channel webhooks
    app/api/pos/*        POS device REST surface (x-pos-device-token, not admin session)
    app/(admin)/admin/*  Admin UI (Next.js app router)
    app/(pos)/pos        Counter POS screen — separate route group, no admin chrome
    graphql/*            GraphQL SDL + resolvers (bms* modules)
    lib/bms/*            Business logic — the ONLY place with SQL
    lib/pos/*            Device-side helpers (ESC/POS printing, barcode) — not business logic
db/
  migrations/*.sql        Idempotent, applied in numeric order
docs/                      This documentation tree
```

## Current UI notes

- `/` is a bilingual marketing surface, not just a static hero. It includes an interactive
  infographic of the message → order → payment → shipping → dashboard flow and must remain
  aligned with the actual implemented workflow.
- `/shop-signup` is a public auth-safe route. It must stay in the auth-route allowlist so it
  doesn't initialize admin session/chat providers unnecessarily. Signup remains pending until the
  owner verifies the emailed link; only then are the tenant and Manager account created.
- `/shop-signup` offers an optional shop archetype selector that survives the pending-verification
  flow and seeds the initial store profile / onboarding tips without restricting features. This is
  especially useful for demo/sample-data flows and for emphasizing revenue-recovery patterns such as
  `restock subscriptions`. See
  [../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md).
- `/shop/[tenantSlug]/products/[sku]` is the no-login product detail/gallery shared from Inbox. It
  resolves active shops/products through `lib/bms/products.ts`, exposes sale-safe fields only, and
  treats the tenant slug as a stable public routing handle.
- `/admin/orders`, `/admin/purchase`, `/admin/payment`, and `/admin/shipment` now use backend
  search args with debounced live search. This is the expected pattern for large operational lists.
- `/admin/profile` is the self-service account surface for avatar/name/phone/language updates.
- `/admin/inbox/realtime-diagnostics` is an Administrator/platform-admin tool. `Emit` proves the
  Redis/WebSocket invalidation path; `Create Msg` creates a diagnostic Inbox message for the
  current tenant without contacting external platforms.

## Coding rules

```
Business Logic → Services (lib/bms/*)
Database       → accessed only through those services
AI             → never contains SQL, never touches the DB directly
Frontend       → never contains business logic
```
