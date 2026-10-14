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
| [multi-instance-readiness.md](docs/architecture/multi-instance-readiness.md) · [admin-scale-readiness.md](docs/architecture/admin-scale-readiness.md) · [scheduler.md](docs/architecture/scheduler.md) | >1 instance · admin load · opt-in Docker cron scheduler (one owner via `BMS_CRON_RUNNER`) |
| [business/order.md](docs/business/order.md) · [inventory.md](docs/business/inventory.md) · [payment.md](docs/business/payment.md) · [pos.md](docs/business/pos.md) · [board-game-cafe.md](docs/business/board-game-cafe.md) · [crm.md](docs/business/crm.md) · [restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) | Domain specs |
| [cloud-hybrid-pos.md](docs/business/cloud-hybrid-pos.md) · [retail-local.md](docs/business/retail-local.md) · [install manual](docs/business/retail-local-install-manual.md) · [managed runtime](docs/business/retail-local-managed-runtime.md) · [GA readiness](docs/business/retail-local-ga-readiness.md) · [BUILD.md](deploy/retail-local/BUILD.md) | Emergency Offline boundary · Retail Local pilot (**not GA**) |
| [integrations/](docs/integrations/) · [delivery-platforms.md](docs/integrations/delivery-platforms.md) · [ui/](docs/ui/) | LINE/TikTok/Lazada/carriers/delivery platforms · UI specs |
| [support-diagnostics.md](docs/business/support-diagnostics.md) · [app-downloads.md](docs/business/app-downloads.md) · [product-barcode-autofill.md](docs/business/product-barcode-autofill.md) | Diagnostics to Support · homepage app links · barcode lookup |
| [product-overview-th.md](docs/business/product-overview-th.md) · [feature-inventory.md](docs/feature-inventory.md) · [feature-log.md](docs/feature-log.md) | Thai sales overview + allowed claims · what is proven · why features work as they do |
| [AI_GUIDELINES.md](docs/AI_GUIDELINES.md) · [ai/](docs/ai/) ([workflow](docs/ai/workflow.md) · [tools](docs/ai/tools.md) · [prompts](docs/ai/prompts.md) · [quality](docs/ai/quality.md) · [usage-cost-audit](docs/ai/usage-cost-audit.md) · [work-assistant-coverage](docs/ai/work-assistant-coverage.md)) | AI rules, pipeline, tools, evidence, AI points, staff assistant catalog |
| [pharmacy/README.md](apps/web/lib/bms/pharmacy/README.md) | Pharmacy intake, guidance (`10.45`/`10.47`), emergency directory (`10.46`) — read before touching `lib/bms/pharmacy/` |
| [apps/mobile/README.md](apps/mobile/README.md) · [apps/desktop/README.md](apps/desktop/README.md) | Native RN POS (scanner, Wi-Fi printing) · Electron POS shell |
| [scripts/README.md](scripts/README.md) · [scripts/ai-eval/README.md](scripts/ai-eval/README.md) | How to run every suite, exit codes, live-model evals |
| Thai manuals: [inbox](docs/manual/inbox.md) · [restaurant POS](docs/restaurant-pos-guide.md) · [ร้านอาหาร](docs/คู่มือร้านอาหาร.md) · [ร้านยา](docs/คู่มือร้านขายยา.md) · [product examples](docs/shop-product-examples.md) | Operator guides |

## Current status (2026-10)

**Not production-ready (🧪):** Shopee/Lazada (signatures unverified) · Flash/Kerry (await merchant
contract) · AI Pharmacy Intake (flag off) · e-Tax submission (no verified provider) · ESC/POS and
cash drawer, browser and native Wi-Fi printing (never certified on real hardware) · desktop POS
(unsigned, no auto-update/offline tender) · delivery platforms (foodpanda sandbox only;
GrabFood/LINE MAN contract-blocked) · Retail Local (technical pilot) · tax-invoice PDF email and
SMTP relay (not sent through a real provider) · automated AI plan billing (none) · Q4
profit/growth simulation (planned). Pharmacy guidance texts are not clinically reviewed.

Everything else is built. Area index (narrative per entry in [status-log.md](docs/status-log.md)):

| Area | Migrations | Doc |
| --- | --- | --- |
| POS sale/return/tax, loyalty, shifts, transfers/counts, Scan Manager | `7.84`–`7.98`, `8.0`–`9.6` | [pos.md](docs/business/pos.md) · [inventory.md](docs/business/inventory.md) |
| Credit sales / AR | `9.30` | [agent-invariants § POS and tax](docs/agent-invariants.md#pos-and-tax) |
| Decision intelligence (Action Center, purchasing, retention) | `9.12`–`9.14` | [dashboard.md](docs/ui/dashboard.md) · [retention-engine.md](docs/ui/retention-engine.md) |
| Catalog variants, sales surfaces, stock policies, archetypes | `9.40`–`9.43`, `9.51`–`9.52` | [inventory.md](docs/business/inventory.md) |
| Restaurant POS, kitchen stations, chat delivery, floor editor, table QR | `9.44`–`9.62` | [pos.md](docs/business/pos.md) · [restaurant-chat-delivery.md](docs/business/restaurant-chat-delivery.md) |
| Realtime outbox + typed GraphQL surface | `9.70`–`9.74`, `9.84`–`9.86` | [realtime audit](docs/architecture/realtime-production-audit.md) |
| Board game cafe (sessions, groups, passes, holds, queue, reservations, offers, chat booking) | `9.79`–`10.7`, `10.40`, `10.42`, `10.48`–`10.50` | [board-game-cafe.md](docs/business/board-game-cafe.md) |
| Profit snapshots, persisted reports | `9.95`, `9.97` | [database.md](docs/architecture/database.md) |
| Emergency Offline (mobile cash queue) | `10.5` | [cloud-hybrid-pos.md](docs/business/cloud-hybrid-pos.md) |
| Thai tax evidence, expenses, supplier notes, receipt-QR invoice requests + PDF email | `10.8`–`10.13`, `10.23`–`10.25`, `10.37`–`10.39`, `10.58` | [pos.md](docs/business/pos.md#cloud-receipt-qr--full-tax-invoice-request-1038) |
| Delivery platforms | `10.12`, `10.14`, `10.21` | [delivery-platforms.md](docs/integrations/delivery-platforms.md) |
| Retail Local (licence fail-open, registry, installer reports) | `10.15`–`10.20`, `10.27`–`10.36` | [retail-local.md](docs/business/retail-local.md) |
| Social Login · sample-data ledger | `10.22` · `10.26`, `10.30` | [agent-invariants](docs/agent-invariants.md) |
| Cross-SKU buy-A-get-B gifts | `10.41` | [pos.md](docs/business/pos.md) |
| Customer chat facts: restaurant/pharmacy assistance, table details, parking, answer evidence | `10.43`–`10.44`, `10.51`–`10.53` | [ai/quality.md](docs/ai/quality.md) |
| Pharmacist-approved guidance, emergency directory | `10.45`–`10.47` | [pharmacy README](apps/web/lib/bms/pharmacy/README.md) |
| AI monthly points (cost = reporting) | `10.54`–`10.56` | [usage-cost-audit.md](docs/ai/usage-cost-audit.md) |
| Homepage app links · SMTP mail provider | `10.57` · `10.59` | [app-downloads.md](docs/business/app-downloads.md) |
| Reviewed customer merges, signed web-chat sessions, Work Assistant, desktop shell, native printing | no migration | [crm.md](docs/business/crm.md) · [work-assistant-coverage.md](docs/ai/work-assistant-coverage.md) |

Migrations not yet applied to production: [CLAUDE.local.md](CLAUDE.local.md) § ก่อน production —
check the target DB; several features need their migration first.

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
