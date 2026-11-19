# AI Business Management System (BMS)

`Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard`. Not a chatbot: AI only
calls approved backend tools; business logic lives in `apps/web/lib/bms/*.ts`, shared by REST and
GraphQL. This file = navigation index + AI rules. Agent working rules: [AGENTS.md](AGENTS.md) ·
full per-domain rules: [docs/agent-invariants.md](docs/agent-invariants.md) · per-feature history:
[docs/status-log.md](docs/status-log.md) · machine-local notes: [CLAUDE.local.md](CLAUDE.local.md).

## Documentation map

| Doc | Covers |
| --- | --- |
| [architecture/system.md](docs/architecture/system.md) · [database.md](docs/architecture/database.md) · [api.md](docs/architecture/api.md) | Build status/RBAC/roadmap · tables, RLS, migrations · REST/GraphQL + auth gates |
| [realtime-production-audit.md](docs/architecture/realtime-production-audit.md) · [ADR 001](docs/architecture/decisions/001-transactional-realtime-invalidation.md) · [realtime-test-database.md](docs/architecture/realtime-test-database.md) | Realtime outbox/invalidation audit, design, and the throwaway-DB runbook for `9.70`–`9.74`/`9.84`–`9.86` |
| [mobile-graphql-ws-realtime.md](docs/architecture/mobile-graphql-ws-realtime.md) · [react-native-graphql-client.md](docs/architecture/react-native-graphql-client.md) · [graphql-client-readiness-brief.md](docs/architecture/graphql-client-readiness-brief.md) · [`schema.graphql`](schema.graphql) | Mobile GraphQL/WS, RN client contract, committed SDL (`npm run schema:export`) |
| [multi-instance-readiness.md](docs/architecture/multi-instance-readiness.md) · [admin-scale-readiness.md](docs/architecture/admin-scale-readiness.md) · [scheduler.md](docs/architecture/scheduler.md) · [logging-and-triage.md](docs/architecture/logging-and-triage.md) | >1 instance · admin load · opt-in Docker cron scheduler (one owner via `BMS_CRON_RUNNER`) · error-log interpretation |
| [business/order.md](docs/business/order.md) · [inventory.md](docs/business/inventory.md) · [payment.md](docs/business/payment.md) · [pos.md](docs/business/pos.md) · [board-game-cafe.md](docs/business/board-game-cafe.md) · [crm.md](docs/business/crm.md) · [restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) · [bank-reconciliation.md](docs/business/bank-reconciliation.md) | Domain specs |
| [cloud-hybrid-pos.md](docs/business/cloud-hybrid-pos.md) · [retail-local.md](docs/business/retail-local.md) · [install manual](docs/business/retail-local-install-manual.md) · [managed runtime](docs/business/retail-local-managed-runtime.md) · [GA readiness](docs/business/retail-local-ga-readiness.md) · [BUILD.md](deploy/retail-local/BUILD.md) | Emergency Offline boundary · Retail Local pilot (**not GA**) |
| [integrations/](docs/integrations/) · [delivery-platforms.md](docs/integrations/delivery-platforms.md) · [ui/](docs/ui/) | LINE/TikTok/Lazada/carriers/delivery platforms · UI specs |
| [support-diagnostics.md](docs/business/support-diagnostics.md) · [app-downloads.md](docs/business/app-downloads.md) · [product-barcode-autofill.md](docs/business/product-barcode-autofill.md) | Diagnostics to Support · homepage app links · barcode lookup |
| [product-overview-th.md](docs/business/product-overview-th.md) · [feature-inventory.md](docs/feature-inventory.md) · [feature-log.md](docs/feature-log.md) · [release-feature-control.md](docs/release-feature-control.md) | Thai sales overview + allowed claims · what is proven · why features work as they do · commit-bound release inventory |
| [factory-twine-straw-pilot-th.md](docs/business/factory-twine-straw-pilot-th.md) · [operation-production.md](docs/business/operation-production.md) | Thai factory demo, unit/SKU choices, controlled-pilot workflow and production limits |
| [twenty-baht-shop-pilot-th.md](docs/business/twenty-baht-shop-pilot-th.md) | One-branch twenty-baht-shop pilot scope, code evidence, plan fit and external Go/No-Go gates |
| [feature-completion-plan.md](docs/feature-completion-plan.md) · [system-recheck-2026-11-14.md](docs/architecture/system-recheck-2026-11-14.md) | Ordered completion backlog, release evidence and external rollout gates · Inbox/Desktop/Mobile/Admin evidence ledger and what stays unverified |
| [AI_GUIDELINES.md](docs/AI_GUIDELINES.md) · [ai/](docs/ai/) ([workflow](docs/ai/workflow.md) · [tools](docs/ai/tools.md) · [prompts](docs/ai/prompts.md) · [quality](docs/ai/quality.md) · [usage-cost-audit](docs/ai/usage-cost-audit.md) · [work-assistant-coverage](docs/ai/work-assistant-coverage.md) · [customer-inbox coverage audit](docs/ai/customer-inbox-coverage-audit-th.md) · [question bank](docs/ai/customer-inbox-question-bank-th.md)) | AI rules, pipeline, tools, evidence, AI points, staff assistant catalog, customer-inbox question coverage |
| [pharmacy/README.md](apps/web/lib/bms/pharmacy/README.md) | Pharmacy intake, guidance (`10.45`/`10.47`), emergency directory (`10.46`) — read before touching `lib/bms/pharmacy/` |
| [apps/mobile/README.md](apps/mobile/README.md) · [apps/desktop/README.md](apps/desktop/README.md) | Native RN POS (scanner, Wi-Fi printing) · Electron POS shell |
| [scripts/README.md](scripts/README.md) · [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | How to run every suite, exit codes, live-model evals |
| Thai manuals: [inbox](docs/manual/inbox.md) · [restaurant POS](docs/restaurant-pos-guide.md) · [ร้านอาหาร](docs/คู่มือร้านอาหาร.md) · [ร้านยา](docs/คู่มือร้านขายยา.md) · [ร้านวัสดุก่อสร้าง (pilot)](docs/คู่มือร้านวัสดุก่อสร้าง.md) · [product examples](docs/shop-product-examples.md) | Operator guides |
| [Public learning center](docs/ui/learning-center.md) · [public POS guides](docs/public-pos-guides/README.md) | `/learn`: bilingual public learning paths including the building-materials pilot and `/learn/getting-started`, searchable lessons, narrated flows and reading checklists · source and regeneration of the five Thai Word/PDF POS handbooks in `apps/web/public/guides/pos/` |

## Current status (2026-11)

**Not production-ready (🧪):** Shopee/Lazada (signatures unverified) · Flash/Kerry (await merchant
contract) · AI Pharmacy Intake (flag off) · e-Tax submission (no verified provider) · ESC/POS and
cash drawer, browser and native Wi-Fi printing (never certified on real hardware) · desktop POS
(unsigned, no auto-update/offline tender) · delivery platforms (foodpanda sandbox only;
GrabFood/LINE MAN contract-blocked) · Retail Local (technical pilot) · tax-invoice PDF email and
SMTP relay (not sent through a real provider) · automated AI plan billing (none) · bank
reconciliation (`10.110`, flags off by default, controlled pilot) · Q4 profit/growth simulation
(planned). Pharmacy guidance texts are not clinically reviewed.

Everything else is built unless the row below is explicitly marked WIP/pilot. Area index (narrative
per entry in [status-log.md](docs/status-log.md)):

| Area | Migrations | Doc |
| --- | --- | --- |
| POS sale/return/tax, loyalty, shifts, transfers/counts, Scan Manager | `7.84`–`7.98`, `8.0`–`9.6` | [pos.md](docs/business/pos.md) · [inventory.md](docs/business/inventory.md) |
| Retail cash sale of an uncatalogued physical item (Web/Desktop/Mobile POS; append-only sale/return evidence, no stock movement) | `10.129`–`10.130` — **branch implementation; throwaway-DB and browser verified, production deployment unverified** | [pos.md § สินค้าชั่วคราว](docs/business/pos.md) · [database.md](docs/architecture/database.md) |
| Credit sales / AR | `9.30` | [agent-invariants § POS and tax](docs/agent-invariants.md#pos-and-tax) |
| Decision intelligence (Action Center, purchasing, retention) | `9.12`–`9.14` | [dashboard.md](docs/ui/dashboard.md) · [retention-engine.md](docs/ui/retention-engine.md) |
| Catalog variants, sales surfaces, stock policies, archetypes | `9.40`–`9.43`, `9.51`–`9.52` | [inventory.md](docs/business/inventory.md) |
| Restaurant POS, kitchen stations, chat delivery, floor editor, table QR | `9.44`–`9.62` | [pos.md](docs/business/pos.md) · [restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) |
| Realtime outbox + typed GraphQL surface | `9.70`–`9.74`, `9.84`–`9.86` | [realtime audit](docs/architecture/realtime-production-audit.md) |
| Board game cafe (sessions, groups, passes, holds, queue, reservations, offers, chat booking; per-row chat publication of passes/offers) | `9.79`–`10.7`, `10.40`, `10.42`, `10.48`–`10.50`, `10.117` | [board-game-cafe.md](docs/business/board-game-cafe.md) |
| Profit snapshots, persisted reports | `9.95`, `9.97` | [database.md](docs/architecture/database.md) |
| Emergency Offline (mobile cash queue) | `10.5` | [cloud-hybrid-pos.md](docs/business/cloud-hybrid-pos.md) |
| Thai tax evidence, expenses, supplier notes, receipt-QR invoice requests + PDF email | `10.8`–`10.13`, `10.23`–`10.25`, `10.37`–`10.39`, `10.58` | [pos.md](docs/business/pos.md#cloud-receipt-qr--full-tax-invoice-request-1038) |
| Delivery platforms | `10.12`, `10.14`, `10.21` | [delivery-platforms.md](docs/integrations/delivery-platforms.md) |
| Retail Local (licence fail-open, registry, installer reports) | `10.15`–`10.20`, `10.27`–`10.36` | [retail-local.md](docs/business/retail-local.md) |
| Social Login · sample-data ledger · verified shop owner = Administrator (repair of email-signup owners left on Manager) | `10.22` · `10.26`, `10.30` · `10.121`, `10.128` | [agent-invariants](docs/agent-invariants.md) · [owner-repair rollout](docs/architecture/owner-repair-rollout.md) |
| Cross-SKU buy-A-get-B gifts | `10.41` | [pos.md](docs/business/pos.md) |
| Customer chat facts: restaurant/pharmacy assistance, table details, parking, answer evidence | `10.43`–`10.44`, `10.51`–`10.53` | [ai/quality.md](docs/ai/quality.md) |
| Pharmacist-approved guidance, emergency directory, Administrator-only pharmacist licence write | `10.45`–`10.47`, `10.111` | [pharmacy README](apps/web/lib/bms/pharmacy/README.md) |
| AI monthly points (cost = reporting) | `10.54`–`10.56` | [usage-cost-audit.md](docs/ai/usage-cost-audit.md) |
| Homepage app links · SMTP mail provider | `10.57` · `10.59` | [app-downloads.md](docs/business/app-downloads.md) |
| Costing, valuation, branch pricing, promotions · scheduled branch price windows | `10.60`–`10.72` · `10.116` — **source candidate, not deployed** | [database.md](docs/architecture/database.md) · [inventory.md](docs/business/inventory.md) |
| SaaS packages, feature/capacity policy, platform master data | `10.73`–`10.86`, `10.101`–`10.102` | [system.md](docs/architecture/system.md) · [database.md](docs/architecture/database.md) |
| Branch requisitions, operations, production, materials, quality | `10.87`–`10.98` | [agent-invariants.md](docs/agent-invariants.md) · [system.md](docs/architecture/system.md) |
| Branch inventory intelligence · purchase landed cost | `10.99`–`10.100`, `10.103` | [inventory.md](docs/business/inventory.md) |
| Meta inbound hardening/enrichment · Retail Local consented leads/erasure | `10.104`–`10.106`, `10.108` | [database.md](docs/architecture/database.md) · [facebook-messenger.md](docs/integrations/facebook-messenger.md) |
| Pickup queue numbers + call screen (`/pos/queue-board`), queue experience/promo slides, pickup status emails, branch queue-board media; Desktop sell-screen queue strip and one managed queue window per selected external monitor (no migration; multi-monitor hardware/audio unverified) | `10.112`–`10.115` — **new; not yet applied to production** | [pos.md](docs/business/pos.md#pickup-queue-numbers-and-the-call-screen-10111) · [order.md](docs/business/order.md) · [desktop README](apps/desktop/README.md#external-displays) |
| Inbox scope/transaction hardening (Sales owner/helper scope, atomic audit, private media capability) · self-availability | `10.118` | [system-recheck-2026-11-14.md](docs/architecture/system-recheck-2026-11-14.md) · [crm.md](docs/business/crm.md#omnichannel-inbox) |
| Fish-dock intake (live/opening receipts, historical Excel evidence) · owner day view, storage counts, delivery plans | `10.119`–`10.120` — **new; not yet applied to production** | [inventory.md](docs/business/inventory.md) · [database.md](docs/architecture/database.md) · [api.md](docs/architecture/api.md) |
| Factory BOM, opt-in output QC hold, production demand, machine evidence | `10.122`–`10.127` — **branch implementation; not applied to production** | [factory-twine-straw-pilot-th.md](docs/business/factory-twine-straw-pilot-th.md) · [operation-production.md](docs/business/operation-production.md) · [database.md](docs/architecture/database.md) |
| Building-material shop pilot: versioned sales quotations, quote site/pickup on orders, sourced technical specs, per-kg weighed prices, supplier-unit PO snapshots | `10.133`–`10.137` — **PILOT / INCOMPLETE; not applied to production** | [building-materials-readiness.md](docs/business/building-materials-readiness.md) · [release evidence](docs/business/building-materials-release-evidence-2026-11-19.md) · [คู่มือร้านวัสดุก่อสร้าง](docs/คู่มือร้านวัสดุก่อสร้าง.md) |
| Twenty-baht shop pilot guide (`/learn/twenty-baht-shop`, `noindex`), product-import `ประเภท VAT` column, mobile return/void original-body retry | no migration — **pilot guide; real-shop evidence pending** | [twenty-baht-shop-pilot-th.md](docs/business/twenty-baht-shop-pilot-th.md) · [learning-center.md](docs/ui/learning-center.md) |
| Lot identity through branch transfers | `10.107` — **WIP for rollout; committed and clone-DB verified, production deployment unverified** | [system.md](docs/architecture/system.md) · [inventory.md](docs/business/inventory.md) |
| File ownership + private community-chat media (personal uploads bound to a user; chat media needs membership) | `10.109` | [database.md](docs/architecture/database.md) · [files API README](apps/web/app/api/files/README.md) |
| Bank reconciliation (imported statements are evidence only; a match exists only after a reviewer confirms it) | `10.110` | [bank-reconciliation.md](docs/business/bank-reconciliation.md) |
| Reviewed customer merges, signed web-chat sessions, Work Assistant, desktop shell, native printing, mobile QR pairing, stock integrity (receiving/counts/lots), admin knowledge search + public feature search, Inbox AI reply delivery status, release feature manifest, server-reviewed public retail cart (published packs), retry-safe shipment creation, tenant-settings Administrator gate, Thai/English POS/mobile/desktop language switching, operator error messages, admin-session live gates, log redaction ([logging-and-triage.md](docs/architecture/logging-and-triage.md)), HTTPS-only pairing links, same-shift offline replay, all-or-nothing partial-return lines with replay matching, Inbox list/detail split and race-safe mark-read | no migration | [crm.md](docs/business/crm.md) · [work-assistant-coverage.md](docs/ai/work-assistant-coverage.md) · [pos.md](docs/business/pos.md) · [inventory.md](docs/business/inventory.md) · [release-feature-control.md](docs/release-feature-control.md) |

Migrations not yet applied to production: [CLAUDE.local.md](CLAUDE.local.md) § ก่อน production —
check the target DB; several features need their migration first.
The open-item POS build needs `10.129` and `10.130` applied in order before rollout. Audit
traceability now uses `10.131`/`10.132`; the factory migrations retain `10.122`–`10.127`. See
[audit traceability rollout](docs/architecture/audit-traceability.md#verification-and-rollout)
for handling environments that ran the old audit filenames. The building-material pilot needs
`10.133`–`10.137` before its code is deployed: `10.134`, `10.136` and `10.137` are read by every
order insert, POS price check and PO create/receipt (declared in schema-readiness). `npm run gate` passed on 2026-11-17;
this does not establish production deployment or DB migration verification.

## AI rules (non-negotiable)

- AI **never** writes SQL or touches the DB — only approved tools ([ai/tools.md](docs/ai/tools.md)).
  It never fabricates stock/price/order numbers, and never sets a price, pack size or
  pieces-per-unit (a pack code reaches `create_order` as a name; size/price come from
  `bms_product_packs` server-side).
- Sensitive actions (delete, refund, cancel, change price, adjust stock) need **human confirmation
  + RBAC**. Every AI tool attempt is audited without raw args/PII; sensitive writes audit **inside
  the same transaction** as the money/stock they move; revisions hold before/after snapshots.
- **No customer order before the customer saw every line and said yes.** First `create_order`
  writes nothing (`CONFIRMATION_REQUIRED`); the pipeline shows a server-composed summary; only a
  call matching the affirmed fingerprint writes. The signal is server-only (`ExecCtx`). Ambiguous
  pharmacy matches use server line codes (`A1/B2`) and still need that second confirmation.
- **Chat table bookings follow the same rule:** preview writes nothing; only a short affirmative
  to the latest server summary (15-min fingerprint, consumed by any other message) creates a
  request; only branch policy or PIN-authenticated staff confirm a table. `REQUESTED`/`WAITING` is
  never "reserved".
- **Customer chat states what the shop published, never an inference.** Unknown = "not provided",
  never "none"; capacity ≠ vacancy; a truncated list never proves absence. Clinical questions get
  approved guidance or the fixed pharmacist handoff; emergency wording is checked before any
  context read.
- **No empty turn.** A text-less model turn is a failure (`ai.empty_reply`): tell the customer the
  system failed and alert a human; never ask them to retype.
- **Staff assistant catalog states capability, never tenant state.** `AVAILABLE`/`CONDITIONAL`/
  `BETA`/`MOCK` per capability; anything not proven end to end (e-Tax, Shopee/Lazada, ESC/POS) is
  `BETA`. Page context re-ranks but never answers or grants permission (`matchedQuery` gates
  citations); guide routes must render. FAQ/limit text is payload, never scored. Every question
  shipped or verified is pinned in `scripts/ai-eval/work-assistant-question-corpus.mts` to the
  entry that must rank **first**; every entry needs one. `/pos` uses register-only guides
  (`pageId === "pos"`), no AI call.
- **Licensing never sanctions a shop.** Retail Local licence/trial/review state never blocks POS,
  payment, stock, tax, backup, restore, updates or data access; no kill switch.
- **`/api` is not protected by location.** `middleware.ts` guards `/admin/**` only. Every route
  authenticates itself (`authorizeAdminRoute(perm)`, verified webhook signature, cron token) and
  derives the tenant server-side; public routes need a rate limit. Enforced by
  `inventory-tenant-scope-contract`.
- **POS/branch ops:** device Bearer + `x-scope: pos`; server derives tenant/location/device; every
  mutation re-checks cashier PIN + permission. REST and GraphQL call the same service, neither is an
  AI tool; a future tool needs a `tools/catalog.ts` wrapper. Never call one adapter from another.
- **Realtime is a hint sharing the business transaction.** Outbox row in the same tenant tx,
  published after commit; `apps/ws` never touches Postgres. A trigger bug rolls back the business
  write: touch only its own table's columns, grant the `SECURITY DEFINER` owner explicitly, and
  emit allowlisted scalars only (no PII/bodies/payments/clinical). See
  [agent-invariants § Realtime](docs/agent-invariants.md#realtime-invalidation-architecture).
- **A column `createOrderInTx()` always writes is a deploy blocker.** Declare it in
  `scripts/schemaReadiness.mts` and regenerate `db/checks/schema-readiness.sql` in the same change
  (`schema-readiness-coverage-contract`).
- **`schema.graphql` is the client contract.** Regenerate with `npm run schema:export` in the same
  change; mobile ops never take tenant/location/device/shift from the caller; money/stock/document
  mutations carry `idempotencyKey`; old fields stay `@deprecated`.
