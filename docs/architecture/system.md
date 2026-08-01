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
| 11 | Reports | Dashboard, sales, inventory, customer, financial |
| 12 | Public Marketing & Onboarding | Landing infographic, pricing, self-serve signup, session-aware CTA routing |

Full per-domain rules: [../business/order.md](../business/order.md) ·
[../business/inventory.md](../business/inventory.md) · [../business/payment.md](../business/payment.md) ·
[../business/crm.md](../business/crm.md)

## Build status (2026-07)

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
| CRM | ✅ | `lib/bms/customers.ts` · `3.6__bms_crm.sql` · cross-channel merge — see [../ui/customer360.md](../ui/customer360.md) |
| Product Management | ✅ | `lib/bms/products.ts` · `3.2` / `5.9` / `6.0` / `6.5` (multi-image gallery) |
| Product Bulk Import (CSV/XLSX) | ✅ | `lib/bms/productImport.ts` · `graphql/bmsProducts.ts` (`bmsImportProducts`) · `/admin/products` `ImportModal.tsx` — see [../business/inventory.md](../business/inventory.md) |
| Inventory (IMS) | ✅ | `lib/bms/{stock,movements}.ts` · `3.2` / `3.4` |
| Orders (OMS) | ✅ | `lib/bms/orders.ts` · `3.3` / `3.5` · staff create/reorder + invoice preview — see [../business/order.md](../business/order.md) |
| Purchase | ✅ | `lib/bms/purchase.ts` · `5.2__bms_purchase.sql` |
| Payment | ✅ | `lib/bms/payments.ts` · `5.3__bms_payments.sql` (+ AI slip verify) |
| Public Customer Checkout (signed link) | ✅ | `lib/bms/{checkout,checkoutToken}.ts` · `app/api/bms/checkout/*` · `app/(checkout)/checkout` — no migration; slip upload creates `PENDING` only, human confirms — see [../ui/customer-checkout-wireframe.md](../ui/customer-checkout-wireframe.md) |
| Shipping | ✅ | `lib/bms/shipping.ts` · `5.4__bms_shipments.sql` |
| Reports | ✅ | `lib/bms/{dashboard,reports}.ts` — see [../ui/dashboard.md](../ui/dashboard.md) |
| Sales Digest Reports (email/Slack/LINE) | ✅ | `lib/bms/reportDigest.ts` · `7.37__bms_report_subscriptions.sql` · `/admin/settings` card + platform-admin `/admin/report-schedule` + `POST /api/bms/reports/send-digest` cron (not yet scheduled) — see [../ui/dashboard.md](../ui/dashboard.md) |
| Multi-tenant · RLS · RBAC · Plans · Audit | ✅ | `lib/bms/{tenant,permissions,plans,audit}.ts` · `4.0–5.1` / `5.7` / `5.8` |
| SaaS: Self-serve Signup | ✅ | `lib/bms/signup.ts` · `/shop-signup` |
| Public Landing / Interactive Infographic | ✅ | `app/(main)/page.tsx` · bilingual/session-aware CTA flow |
| Self Profile & Avatar | ✅ | `/admin/profile` · `bmsMe` / `updateMe` / `uploadAvatar` |
| Platform Admin (cross-tenant) | ✅ | `lib/bms/platform.ts` · `/admin/tenants` · `5.6__bms_platform_admin.sql` |
| Tenant Drill-down (impersonate) | ✅ | `bmsEnterTenant`/`bmsExitTenant` · signed cookie `BMS_ACT_TENANT` |
| Ops: Daily AI Log Triage | ✅ | `.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/*` |
| Dev: Fake Data Seeder | ✅ | `/admin/dev/fake` · `app/api/dev/fake/*` |

**Roadmap remaining:** TikTok send API · real carrier API (label PDF/auto-tracking) ·
AI OCR / forecasting (beyond payment-slip verify) · WhatsApp / Email / Voice AI ·
letting shop owners (Manager role) manage their own staff (currently Administrator/platform only) ·
Shopee/Lazada signature verification against real Open Platform docs ·
proactive external notification for Channel Health (e.g. LINE alert to the shop owner) — needs an
admin-to-LINE-user-id binding that doesn't exist yet, separate from the shop's own LINE OA channel ·
failure-incident coverage beyond the LINE webhook (Facebook/Instagram/TikTok/Shopee/Lazada webhooks do
not report yet) and an admin page listing incidents (today they surface only as alerts/Slack/SQL) ·
an actual cron schedule for the three ready-but-unscheduled endpoints (`channels/check-health`,
`ai/check-health`, `reports/send-digest`) — all three just need an external scheduler pointed at them.

## RBAC model (two tiers)

- **Platform admin** (`users.is_platform_admin`) — manages the whole platform (every shop / plan /
  role). Views shop-level data only via **drill-down** (impersonation), never mixed across tenants.
- **Tenant role** (Administrator / Manager / Sales / Warehouse) — manages only their own shop.
  Every resolver scopes with `getTenantId(ctx)` + `requirePermission()`.

Users list/CRUD is gated to Administrator/platform (scoped by shop). Role CRUD is platform-only.
Platform-level pages (Architecture, ENV/Logs/Posts/Files/Queue) are gated server-side in
`layout.tsx` via `requirePlatformAdminPage()` — not just a hidden menu item.

401 vs 403: 401 = not logged in / bad token → forced logout. 403 = logged in but lacking
permission → shows an error, does **not** log out (`apollo.ts` errorLink only logs out on 401).

## Folder structure

```
apps/
  web/
    app/api/bms/*        REST endpoints + per-channel webhooks
    app/(admin)/admin/*  Admin UI (Next.js app router)
    graphql/*            GraphQL SDL + resolvers (bms* modules)
    lib/bms/*            Business logic — the ONLY place with SQL
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
