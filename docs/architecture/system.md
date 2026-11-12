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

## Build status (2026-11)

Operational modules per this spec are **fully built** — order lifecycle closes end-to-end
(order → payment → shipping → delivered/completed) with omnichannel capture on every major channel.

| Module | Status | Location (service · migration) |
| --- | --- | --- |
| Channel Integration | ✅ | `app/api/bms/{line,tiktok,facebook,instagram,web}/webhook` · `lib/bms/meta.ts` |
| Facebook/Instagram durable inbound + profile/signal enrichment | ✅ code | `lib/bms/{meta,metaInboundJobs,metaInboxSignals,facebookProfile,lineProfile}.ts` · `10.104` (`bms_channel_inbound_jobs`, Meta account columns), `10.108` (bounded `event_meta`; renumbered from a duplicate `10.106`) · crons `POST /api/bms/meta/inbound/process` + `POST /api/bms/channels/sync-profiles` — verified events are stored under the unique Meta `message.mid` before AI or Graph I/O; work whose effects started is never replayed (`DEAD` for review). Reply-target/quick-reply/ad-referral ids only, never the raw payload; Business Suite echoes are timeline-only; delivery/read events advance `SENT → DELIVERED → READ`. Facebook/LINE display profiles are a cache that Inbox reads without provider calls; Facebook profiles for non-role users need Meta Advanced Access (App Review). Apply `10.104` and `10.108` before deploying — see [../integrations/facebook-messenger.md](../integrations/facebook-messenger.md) |
| Channel Integration — Shopee/Lazada | 🧪 beta | `app/api/bms/{shopee,lazada}/webhook` — see [../integrations/lazada.md](../integrations/lazada.md) |
| Channel Health Status | ✅ | `lib/bms/channelHealth.ts` · `6.4__bms_channel_health.sql` · badges on `/admin/settings` + sidebar/dashboard alerts + `POST /api/bms/channels/check-health` cron |
| AI Provider Health | ✅ | `lib/bms/aiProviderHealth.ts` · `7.34__bms_ai_provider_health.sql` · platform-wide table/badge on `/admin/env` + `POST /api/bms/ai/check-health` cron |
| Failure Incident Alerting | ✅ | `lib/bms/failureAlert.ts` · `7.36__bms_failure_incidents.sql` · tier-split in-app/browser alerts to shop + platform admins (`GlobalFailureNotifier`) |
| Omnichannel Inbox | ✅ | `lib/bms/inbox.ts` · `5.5__bms_inbox.sql` · LINE/Meta AI replies are saved `PENDING` and become `SENT`/`FAILED` after the channel call; "ส่งใหม่" (`bmsRetryMessage`) is server-gated to `FAILED` push rows under a row lock, and channel-health telemetry after provider acceptance cannot relabel a reply `FAILED`. Meta messages with attachments (with or without a caption) go to staff without the text-only AI pipeline (no migration) · see [../ui/customer360.md](../ui/customer360.md) and [../business/crm.md](../business/crm.md) |
| Inbox Realtime Diagnostics | ✅ | `/admin/inbox/realtime-diagnostics` · see [../ui/inbox-diagnostics.md](../ui/inbox-diagnostics.md) |
| AI Orchestrator | ✅ | `lib/bms/{nlu,pipeline,ai}.ts` — see [../ai/workflow.md](../ai/workflow.md) |
| AI Tool-Calling (customer + global staff assistant) | ✅ | `lib/bms/tools/{types,runtime,catalog}.ts` · `lib/bms/assistantKnowledge/` · `graphql/bmsAssistant.ts` · global admin Drawer + `/admin/assistant`; POS-only gets deterministic guide search — see [../ai/workflow.md](../ai/workflow.md) and [../ai/tools.md](../ai/tools.md) |
| Admin knowledge search + public feature search | ✅ | `lib/bms/assistantKnowledge/search.ts` · `/admin/search` + shared header search (`components/HeaderBar.tsx`); `lib/bms/publicFeatureSearch.ts` · public `/features` — no migration, no API route, no AI call. The header sends an admin session to `/admin/search` and everyone else to the public `/learn` search; admin search ranks the deterministic capability/guide catalog with the caller's permissions and platform-admin flag as context; `/features` answers from reviewed presales knowledge, shows limits for conditional/pilot items, says "no verified answer" instead of "not supported", and sends Cloud pricing to the current packages and Retail Local pricing to the team. Guarded by `header-search-contract` and `ai-eval/bms-presales-contract` |
| AI Usage, Credits & Cost Accounting | ✅ | `lib/bms/{aiUsage,aiConfig,aiLimitNotices,aiLimitStatus,aiMetering}.ts` · `6.8` / `7.27` / `7.35` / `7.82` / `10.54`–`10.56` · `/admin/billing` — billable credits (shown as **AI points**), provider calls, and attributed USD cost are three separate dimensions. `10.56` sets monthly points per plan (Free 100, Pro 1,000, Growth 2,500, Business 5,000 after the `10.73` rollout-month grace, Enterprise 10,000 — `10.101`/`10.102` catalogue; reset 00:00 Asia/Bangkok on the first) and removes the per-shop USD admission cap that `10.54` introduced; `10.55` adds owner limit notices at 80%/90%/exhausted/recovered. Plan changes and point adjustments are platform-admin only. Retail Local reports `LOCAL_OWN_KEY`/`LOCAL_UNCONFIGURED` and charges no points — see [../ai/workflow.md](../ai/workflow.md) and [../ai/usage-cost-audit.md](../ai/usage-cost-audit.md) |
| AI Quality Review | ✅ | `7.31` / `7.32` · `/admin/ai-quality` — see [../ai/quality.md](../ai/quality.md) |
| Customer AI answer evidence | ✅ | `lib/bms/answerEvidenceStore.ts` · `10.53` · `bmsAiAnswerEvidence`/`bmsAiAnswerEvidenceCoverage` (`ai_quality.view`) + cron `POST /api/bms/ai/evidence/purge-expired` — bounded, tenant-RLS provenance of each customer AI turn (tool inputs/outputs projected, never raw prompts or clinical text); capture failure never blocks the reply; payloads expire after 90 days. Coverage counts capture status, not accuracy — see [api.md](./api.md) and [database.md](./database.md) |
| Customer chat assistance (restaurant · pharmacy · board game · branch facts) | ✅ | `lib/bms/{restaurantCustomer,pharmacyCustomer,productFoodSafety,productMedicineLabel,locationParking,emergencyFacilities}.ts` · `lib/bms/boardGame{ChatActions,ChatActionPolicy,ReservationPolicy,CustomerGuard,CustomerInfo}.ts` · `10.43`, `10.44`, `10.46`, `10.48`–`10.52` — customer tools read shop-maintained allergen/dietary declarations (empty and unreviewed means unknown; cross-contact never guaranteed), transcribed medicine label facts (no dosing or equivalence), published branch parking, opt-in area/capacity table summaries, and aggregate table/queue counts with no invented wait estimate. Chat may submit a restaurant table request (`REQUESTED`, accepted only by a PIN-authenticated `pos.sell` operator) or a no-deposit board-game booking that is staff-confirmed or, when the branch opts in (`10.49`), auto-confirmed onto a free table; cancel/reschedule of the customer's own chat booking needs a fresh server summary and consent. Clinical questions get a fixed handoff, an emergency message with the bounded `10.46` facility directory, or a pharmacist-approved template (`10.45`/`10.47`) — see [../business/board-game-cafe.md](../business/board-game-cafe.md), [../business/pos.md](../business/pos.md) and [`lib/bms/pharmacy/README.md`](../../apps/web/lib/bms/pharmacy/README.md) |
| AI Pharmacy Intake Assistant | 🧪 flag-gated, off by default | `lib/bms/pharmacy/*` · `7.57`–`7.73` + `7.83` (+ `10.45`/`10.47` guidance templates, which work with intake disabled; `10.111` narrow SECURITY DEFINER helper behind the Administrator licence form at `/admin/pharmacy-protocols/licenses`, which needs an explicit confirmation and commits with its audit) · `/admin/pharmacy-queue`, `/admin/pharmacy-protocols`, `/admin/pharmacy-intake-lab`, `/admin/pharmacy-guidance` — AI takes the intake, a **licensed pharmacist** makes every clinical decision; protocol and Product Policy draft/submit/review/enable writes audit in the same tenant transaction and reviews hold the `10.47` licence lock through commit. The licence flag/number is shop-recorded evidence, not a registry check; see [`lib/bms/pharmacy/README.md`](../../apps/web/lib/bms/pharmacy/README.md) and the [QA script](../testing/pharmacy-protocol-workflow-and-test-cases.md) |
| Product promotions (buy-X-get-Y, N-for-a-price) — per branch | ✅ | `lib/bms/{productPromotions,pricing}.ts` · `graphql/bmsProductPromotions.ts` · `8.7` + `9.61__bms_product_promotions_branch_scope.sql` + `10.41` (cross-SKU `BUY_A_GET_B` gifts, `lib/bms/crossSkuPromotions.ts`; the gift is a normal stock-backed line and partial returns use frozen gift evidence) · `/admin/promotions` — `location_id IS NULL` is the store-wide offer and a branch row overrides it for that branch; `pickPromotionForLocation()` is the single rule both the register preview and `createOrder()` call, so the screen and the server cannot price a line differently. Reuses `product.edit`, so no permission seeding — see [../business/pos.md](../business/pos.md#each-branch-runs-its-own-offer-961) |
| Coupons / Discount Codes | ✅ | `lib/bms/coupons.ts` · `7.21` / `7.23` / `7.25` · `/admin/coupons` + customer coupon wallet — see [../business/order.md](../business/order.md) |
| Restock Notifications | ✅ | `bms_restock_subscriptions` / `bms_restock_deliveries` · `7.41` · `/admin/restock-subscriptions` — customer opt-in requires explicit consent |
| Revision History | ✅ | `graphql/bmsRevisions.ts` · `7.0`–`7.14`, `7.22` · `/admin/revisions` — before-UPDATE snapshots for products/orders/payments/shipments/purchase/coupons |
| Shop Archetype & Onboarding | ✅ | `7.42`–`7.44`, `10.26`, `10.30` · `lib/bms/{sampleData,onboardingSampleData}.ts` · `/shop-signup` capture → sample-data seeding → runtime commerce policy. Sample data is removed by the `bms_sample_runs`/`bms_sample_records` ledger, never by a `FAKE-`/`SAMPLE-` prefix; `/api/bms/onboarding/sample-data` needs `product.edit` and DELETE needs the typed `DELETE SAMPLE`; onboarding seeds accept every archetype — see [../ui/shop-signup-archetype-spec.md](../ui/shop-signup-archetype-spec.md) |
| CRM | ✅ | `lib/bms/{customers,customerMergeReview,customerSecurityToken,webChatSession}.ts` · `3.6__bms_crm.sql` · cross-channel merge, now staff-reviewed: a signed ten-minute impact preview plus reason, verification method and evidence reference, re-checked in a serializable transaction with the audit before commit. Web-chat `sessionId` is a signed, tenant-bound 30-day token; unsigned legacy ids start a fresh visitor. No migration — see [../business/crm.md](../business/crm.md) and [../ui/customer360.md](../ui/customer360.md) |
| Product Management | ✅ | `lib/bms/products.ts` · `3.2` / `5.9` / `6.0` / `6.5` (multi-image gallery) |
| Product Bulk Import (CSV/XLSX) | ✅ | `lib/bms/productImport.ts` · `graphql/bmsProducts.ts` (`bmsImportProducts`) · `/admin/products` `ImportModal.tsx` — see [../business/inventory.md](../business/inventory.md) |
| Inventory (IMS) | ✅ | `lib/bms/{stock,movements}.ts` · `3.2` / `3.4` · `adjustStock()` takes an optional `locationId` (omitted = default branch) and verifies the branch belongs to the shop · `reserveStock()` is tenant- and branch-scoped and writes a `RESERVE` movement in the same transaction · `listVariantReservations()` / `bmsVariantReservations` rebuilds "which bills hold this reserved stock" for the `/admin/products` drill-down (needs `order.view`) — see [../business/inventory.md](../business/inventory.md) |
| Inventory — branch transfers & stock counts | ✅ | `lib/bms/{stockTransfers,stockCounts,dailyDocNo,inventoryIdempotency}.ts` · migrations `7.98` + `9.88` · REST compatibility in `app/api/bms/inventory/{transfers,counts}` · admin GraphQL in `graphql/bmsMobileOperations.ts` · device-scoped native POS GraphQL in `graphql/bmsPosDevice.ts` · `/admin/stock-transfers` + `/admin/stock-counts` + `apps/mobile` — send/receive in two steps so goods in transit belong to no branch; counts apply a difference against a snapshot, never an absolute; `10.10` records each `COUNT_ADJUST` movement's `direction` (IN/OUT) so the stock ledger reads a signed history. See [../business/inventory.md](../business/inventory.md) |
| Branch requisitions (request → approve → transfer/PO) | ✅ code, not piloted | `lib/bms/{branchRequisitions,branchRequisitionMath,branchRequisitionNotify}.ts` · `graphql/bmsBranchRequisitions.ts` (typed `bmsBranchRequisitionCommand` with `confirmed` + version + idempotency key) · `10.87`–`10.88` · `/admin/branch-requisitions` · AI read tool `get_branch_requisitions` — a requisition is a planning document: it never moves, reserves or values stock; real movement only happens through Stock Transfers or a PO created in the same transaction as the allocation; PO receipts never count as destination receipts — see [../business/branch-requisitions-plan.md](../business/branch-requisitions-plan.md) |
| Branch inventory intelligence (per-branch forecast/transfer proposals) | ✅ advisory | `lib/bms/inventoryIntelligence.ts` · `10.99` (branch policy overrides, forecast runs/items, PO idempotency, `bms_inventory_demand_events.location_id`), `10.100` (FK keeps `tenant_id` when a branch is deleted) · dashboard + daily cron `POST /api/bms/inventory-intelligence/maintain` · AI tools `get_inventory_intelligence`, `explain_inventory_risk`, `find_inventory_transfer_opportunities`, `propose_stock_transfer` (propose-only) — unattributed demand is never copied into every branch; forecasts never write stock; signals are not fraud verdicts — see [../business/inventory.md](../business/inventory.md) |
| Inventory — lot identity through transfers | 🚧 WIP for rollout (`10.107`, clone-DB verified; production deployment unverified) | `lib/bms/{lots,stockTransfers}.ts` · `bms_stock_transfer_item_lots` — SEND allocates usable FEFO lots, RECEIVE recreates the same lot at the destination. Code and migration are committed, but do not describe lot transfers as available in production before confirming the target database and rollout |
| Product catalog foundation (variants, sales surfaces, capabilities) | ✅ | `lib/bms/{shopArchetypes,storeCapabilities,products}.ts` · `9.40`–`9.43`, `9.51`, `9.52` · `/admin/stock-models` — `bms_product_variants` is the serving/size-option truth independent of branch stock; `bms_product_sales_surfaces` makes per-channel visibility explicit and separate from `active`; a new/imported product is a draft until published; `NON_STOCK` sells with zero ingredient tracking. Only 5 of 13 capability flags gate real behavior — see [../business/inventory.md](../business/inventory.md) §§ Multi-store stock policies / Catalog lifecycle |
| Orders (OMS) | ✅ | `lib/bms/orders.ts` · `3.3` / `3.5` · staff create/reorder + invoice preview — see [../business/order.md](../business/order.md) |
| Purchase | ✅ | `lib/bms/purchase.ts` · `5.2__bms_purchase.sql` · stock-integrity pass (no migration): staff receipts take an optional `idempotencyKey` in the `9.88` inventory operation ledger (`purchase.receive`), replay before branch-availability checks, and require lot/expiry evidence for tracked products even on the first receipt into a branch; quantities must be JSON integers; cancellation audits in its transaction; native Mobile PO receiving keeps one immutable pending receipt in OS secure storage for same-key retry. Counts require an explicit non-negative integer, and back-office full returns that cannot reconcile lot evidence roll back with `STOCK_REVIEW_REQUIRED` — see [../business/inventory.md](../business/inventory.md) |
| Payment | ✅ | `lib/bms/payments.ts` · `5.3__bms_payments.sql` (+ AI slip verify) |
| Credit sales & accounts receivable | ✅ | `lib/bms/{pos,arCredit}.ts` · `9.30__bms_ar_credit_sales.sql` · `/admin/receivables` — `CREDIT` completes the sale and opens an AR invoice in the same settlement transaction rather than counting as drawer cash; limits checked before order creation and again under the account lock; a return reduces debt immediately and an over-collection ledger-transfers to the oldest open invoice — see [../agent-invariants.md](../agent-invariants.md#pos-and-tax) |
| POS (counter sale/return/refund) | ✅ | `lib/bms/{pos,locations,lots,productPacks}.ts` · `graphql/bmsPos.ts` · `app/(pos)/pos` · `app/api/pos/*` · migrations `7.84`–`7.93` — see [../business/pos.md](../business/pos.md) |
| POS — parked bills, drawer cash, void, shift report | ✅ | `lib/bms/pos.ts` · `7.97__bms_pos_park_cash_void.sql` · `app/api/pos/{park,cash-movement,void,shift-report}` — a manual discount, a void, and cash out each need a second person's PIN; a void reuses the return machinery under `isVoid` and stamps the bill inside that same transaction |
| POS — customer display branding | ✅ | `10.90` (`bms_store_profile.customer_display_background_url`) · upload `POST /api/bms/store-profile/customer-display-background/upload` · `/pos/display` + desktop/native customer display — optional idle background only; the sale view stays server-composed. A QR tender renders a per-tender Dynamic PromptPay QR (Tag 54 amount, recomputed CRC) only from a verified amount-free static QR stored in Settings → Receiving accounts — never synthesized from a PromptPay ID, no static fallback, and the cashier still confirms funds manually — see [../business/pos.md](../business/pos.md) |
| POS — restaurant dine-in (floor, checks, kitchen rounds) | ✅ | `lib/bms/restaurantPos.ts` · `app/(pos)/pos/restaurant` · `app/api/pos/{restaurant,kitchen}/*` · `/admin/kitchen` · migrations `9.44`–`9.45` — a check reserves stock when a kitchen round is sent and settles through the one `recordPosSale()` path; modifier surcharges are server-owned catalog data; floor/kitchen/cancel use `restaurant.*` permissions — see [../business/pos.md](../business/pos.md) |
| Board game cafe operations | ✅ | `lib/bms/{boardGameCafe,boardGameWaitlist,boardGameOffers,boardGamePassRenewals}.ts` · `/admin/board-game` · `/board-game` · `app/api/{bms,pos}/board-game/*` · `app/api/board-game/bookings/*` · `apps/mobile` · migrations `9.79`–`9.83`, `9.89`–`9.94`, `9.96`, `9.98`–`10.7`, `10.40` (per-player `TIME_BUY_GET` paid/free cycles), `10.42` (title artwork), `10.48`–`10.50` (chat reservation requests/actions, opt-in auto-confirm, opt-in public table details) — timed participants with independent purchased-time boundaries, explicit capacity overrides, per-group tabs, group merge/detach and one-at-a-time settlement while others keep playing, table moves and merges, member passes with branch scope and store-credit renewal, server-chosen play-time offers, encrypted identity holds, guest service calls, waitlists/reservations/deposits, game-copy loans, atomic POS handoff/receipt lines, opt-in aggregate public discovery, and removable dev fixtures — see [../business/board-game-cafe.md](../business/board-game-cafe.md) |
| Native POS mobile client | ✅ core + Q6B workflows | `apps/mobile/` — bare React Native POS with secure device pairing, cashier PIN/RBAC, generated GraphQL retail/restaurant/board-game/branch-inventory/shift commands and named WS invalidation; one-shot camera plus explicitly focused Bluetooth/USB HID scanning are live with an on-device mode preference. Emergency Offline Mode (`10.5`) is an encrypted on-device queue for plain retail cash sales only, replayed through `recordPosSale()` with the original idempotency key; unresolved rows block shift close, unpair and re-pair — see [../business/cloud-hybrid-pos.md](../business/cloud-hybrid-pos.md). Wi-Fi/LAN ESC/POS raster receipt printing (private IPv4 printer, status-checked, manual print from the receipt preview) is built; Bluetooth/USB/AirPrint printing, cash-drawer kick, customer display, push, global key capture, physical-hardware certification and pharmacy-review integrations remain. Admin QR pairing (no migration): `/admin/pos-devices` shows the freshly issued credential plus an HTTPS origin as a locally generated QR that Device Settings scans and verifies; replacing a credential needs confirmation, pending offline cash still blocks it, and sale/stock scanners refuse pairing QRs. The 2026-11-03 iOS/Android audit is a code and automated-test audit (Jest, contracts, Android debug build), not real-device certification; Android release builds stay unsigned without the external upload key, and no iOS native build was run — see [../../apps/mobile/README.md](../../apps/mobile/README.md) |
| Windows/Linux/macOS POS client | 🧪 MVP shell | `apps/desktop/` — Electron shell for the existing authoritative `/pos` surface, packaged as Windows NSIS, Linux AppImage/DEB and unsigned macOS DMG for Intel/Apple Silicon, with first-run server pairing, OS-keystore-backed token storage (Linux fails closed unless Secret Service/KWallet is available), origin-restricted IPC/navigation, and realtime token integration. The pairing record is restored from the OS keystore on upgrade; an unreadable record opens a recovery screen instead of first-run setup, and unpair/window lifecycle are serialized so a late write or stale window cannot restore a removed pairing. Release signing/notarization, auto-update, direct ESC/POS/LAN printer and drawer support, offline tender, and production hardware verification remain — see [../../apps/desktop/README.md](../../apps/desktop/README.md) |
| Kitchen stations (registered work areas, SLA) | ✅ | `lib/bms/kitchenStations.ts` · `9.53`–`9.54` · `/admin/kitchen`, register KDS — a station is a registered row (id, active flag, sort order, optional branch) matched id-first then by a name snapshot, never a free-text label; per-station SLA colors the board; deactivating a station never blocks tickets already routed to it — see [../business/pos.md](../business/pos.md) § Kitchen stations |
| Store operations (checklists, team duties, production, standards, materials, quality) | ✅ code, not piloted | `lib/bms/operation*.ts`, `lotQuality.ts` · `graphql/bmsOperation{Checklists,Team,Production,Improvement,Materials,Quality}.ts` · `10.91`–`10.98` · one admin page `/admin/operations` + evidence routes `/api/bms/operations/evidence[/id]` + cron `POST /api/bms/operations/run` (scheduler registry) · 20 `operations.*` permissions — Releases A–D (checklists/food-safety evidence, follow-up, rosters/handover/manager summary) write no stock or money; E (production batch) posts `PRODUCTION_IN`/`PRODUCTION_OUT` only on an explicit post, one DIRECT output SKU per batch; G (materials) is planning, `purchase.ts` stays the stock authority; H (quality) holds restrict lot availability for POS/menu/transfers, never move quantity/value. Rosters are not POS cash shifts, payroll or proof of presence — see [../business/operation-checklists.md](../business/operation-checklists.md), [operation-production.md](../business/operation-production.md), [operation-improvement.md](../business/operation-improvement.md) |
| Restaurant chat ordering + delivery | ✅ | `lib/bms/{menuAvailability,restaurantOrdering}.ts` · `9.55`–`9.57` · `app/api/pos/restaurant/{menu,incoming}` — branch-scoped "sold out today" flag with dual-signal reset (cron + shift-open, both keyed off `resets_at`); an online order needs an explicit branch and `DELIVERY`/`PICKUP` before payment creates any kitchen work; line cancellation reuses the POS return engine with an immutable cause and merchant-absorbed repricing — see [../business/restaurant-chat-delivery.md](../business/restaurant-chat-delivery.md) |
| Membership, tiers & loyalty points | ✅ | `lib/bms/{membership,loyaltyMath}.ts` · `graphql/bmsMembership.ts` · `7.96__bms_membership_and_loyalty.sql` · `/admin/loyalty` — points are a ledger, not a balance column, and reverse proportionally on a return; outstanding points are an accounting liability (`bmsLoyaltyOutstanding`) — see [../business/pos.md](../business/pos.md) |
| Tax (VAT invoices, credit notes) | ✅ | `lib/bms/{taxDocuments,taxDocumentNumber,taxReports,vat}.ts` · migrations `7.88`, `7.89`, `7.95`, `10.8`, `10.13`, `10.24` — abbreviated/full tax invoices, credit notes, cash rounding; documents are immutable once issued. `10.8` stores the Bangkok issue date; `10.13` makes `bms_order_items.line_amount` the per-line money authority (promotion allocated in satang), issues a full invoice only for a completed, never-voided, never-returned bill, and makes back-office cancel/return/refund refuse a taxed bill; `10.24` snapshots the seller at issue. `10.13` is not yet verified against a database |
| Cloud receipt QR → full tax-invoice request | ✅ flag-gated (`BMS_TAX_REQUESTS_ENABLED`) | `lib/bms/{taxInvoiceRequests,taxRequestPolicy,taxRequestToken,taxRequestEmail}.ts` · `10.38`, `10.39`, `10.58` · public `/tax-invoice/request` + `POST /api/bms/tax-invoice-request` (rate-limited, signed receipt token) · staff panel on `/admin/tax-documents` via `/api/bms/tax-invoice-requests` (`tax.document.view` / `tax.document.issue`, branch-scoped) · cron `POST /api/bms/tax-invoice-requests/send-pending` — the abbreviated receipt's QR lets the buyer request a full invoice within 168 hours (max three submissions, each an immutable snapshot); staff issue it through the normal tax-document path, and the PDF email is a durable outbox (`SENT` = provider accepted; stale `SENDING` becomes `UNKNOWN`, never auto-resent). Never enabled on Retail Local — see [../business/pos.md](../business/pos.md) |
| Expense documents, input VAT, withholding tax | ✅ | `lib/bms/{expenseDocuments,expenseAdjustments,thaiTaxId,taxReportPrint}.ts` · `10.11`, `10.23`, `10.37` · `/admin/expenses` — `10.37` adds supplier credit/debit notes (evidence only; VAT claimed in the month received, credit notes reduce input VAT); printable VAT reports at `GET /api/bms/reports/tax-print`; `expense.view`/`expense.manage` (Manager); input VAT only from a `TAX_INVOICE` with a document number and checksum-valid payee tax id, duplicate key on the normalised number + branch, correction by `VOID` with a reason, never a delete; `VAT_PURCHASE` report gated by `expense.view` |
| Bank reconciliation (statement import, matching, month close) | 🧪 flag-gated, off by default; no pilot evidence recorded | `lib/bms/{bankReconciliation,bankStatementFormat,bankReconciliationFeature}.ts` · `graphql/bmsBankReconciliation.ts` · `10.110` (five forced-RLS sidecar tables + revisions; `bms_app` may update workflow columns only) · `/admin/bank-reconciliation` + REST `app/api/bms/bank-reconciliation/{imports/preview,imports/[id]/file,export}` · permissions `bank_reconciliation.view`/`.import`/`.review`/`.close` (seeded to Manager) — requires `BMS_BANK_RECONCILIATION_ENABLED` (+ public UI flag). An evidence sidecar, not a ledger: CSV/XLS/XLSX up to 10 MB / 50,000 rows, formula cells rejected, SHA-256 dedupe, explicit commit; deterministic candidates against confirmed payments, AR receipts, paid expense documents, completed refunds, delivery settlements and opposite bank entries; only a human confirm creates a link and no source row is ever changed. Month close/reopen is versioned; Open Banking reports `NOT_CONFIGURED`. Matching is THB-only. Pure contract only (`bank-reconciliation-contract`); no DB contract yet — see [../business/bank-reconciliation.md](../business/bank-reconciliation.md) |
| Tax — e-Tax submission queue | 🧪 flag-gated, off by default | `lib/bms/etax/*` · `7.94__bms_etax_submissions.sql` · `POST /api/bms/jobs/etax` uses the shared cron-secret guard and records enabled invocations under `etax` in `/admin/operations-schedule`; it is intentionally unscheduled pending a verified provider. Issuing a tax document does not submit it by itself. `10.25` turns an unsent row of a cancelled document into `CANCELLED` and leaves SENT/ACCEPTED rows untouched |
| Public Customer Checkout (signed link) | ✅ | `lib/bms/{checkout,checkoutToken}.ts` · `app/api/bms/checkout/*` · `app/(checkout)/checkout` — no migration; slip upload creates `PENDING` only, human confirms — see [../ui/customer-checkout-wireframe.md](../ui/customer-checkout-wireframe.md) |
| Shipping | ✅ | `lib/bms/shipping.ts` · migrations `5.4`, `7.76`, `7.77` · idempotent carrier booking, event history, manual/cron sync seam for Flash/Kerry (mock-ready, live merchant docs still pending) · [carrier integration checklist](../integrations/carriers.md) |
| Reports | ✅ | `lib/bms/{dashboard,reports,boardGameAnalytics}.ts` · `9.97__bms_sale_cost_report_foundation.sql` + `10.89__bms_board_game_profit_utilization.sql` — historical profit reads immutable sale evidence; board-game analytics adds effective branch hours, occupancy-ledger utilization, RevPATH and XLSX without fixed-cost/forecast claims — see [../ui/dashboard.md](../ui/dashboard.md) and [../business/board-game-cafe.md](../business/board-game-cafe.md) |
| Generated Reports & Document Export | ✅ | `lib/bms/{reportEngine,documentGenerator}.ts` · `7.53__bms_generated_reports.sql` + `9.95`, `10.9`, `10.11`, `10.23`, `10.89` (the persisted `report_type` CHECK covers every export the engine produces, including `VAT_SALES`, `VAT_PURCHASE`, `STOCK_LEDGER` and XLSX-only `BOARD_GAME_ANALYTICS`) · `/admin/reports` AI Report Generator + GraphQL/REST/AI tool entry points — see [../ui/dashboard.md](../ui/dashboard.md) |
| Sales Digest Reports (email/Slack/LINE) | ✅ | `lib/bms/reportDigest.ts` · `7.37__bms_report_subscriptions.sql` · `/admin/settings` card + platform-admin `/admin/report-schedule` + `POST /api/bms/reports/send-digest` cron, dispatched hourly by the selected Docker or GitHub scheduler so each shop's configured local send hour can match; actual delivery still needs provider verification — see [../ui/dashboard.md](../ui/dashboard.md) |
| Follow-up Automation | ✅ | `lib/bms/followups.ts` · `7.52__bms_followups.sql` · `/admin/followup-rules` + `/admin/followup-queue` + `POST /api/bms/followups/run` — queue includes heuristic score + 30-day analytics summary |
| Phase 1 — Action Center + Inventory Intelligence | ✅ | `lib/bms/{actionCenter,dashboard}.ts` · `9.12`–`9.13` · `/admin/dashboard` — daily evidence-backed actions, lifecycle metrics, stock-out/reorder/slow/dead/FEFO recommendations, observed-demand feedback; advisory only |
| Phase 2 — Customer Retention Engine | ✅ | `lib/bms/retention.ts` · `9.14` · `/admin/followup-queue` Retention tab — RFM/risk/return window, verified basket next-product, propose-only treatment, holdout and 30-day conversion attribution |
| Global AI Work Assistant | ✅ | `lib/bms/assistantKnowledge/` · `graphql/bmsAssistant.ts` (`bmsWorkAssistant`) · `components/work-assistant/` — no migration, no new permission. A deterministic bilingual catalog (51 capabilities, 119 guides, 20 FAQ answers, 24 limit groups; counted 2026-10-02; no DB/network) grounds a Drawer on every admin page and `/admin/assistant`; `/pos` reuses the catalog as offline guide search with no GraphQL/AI call. Capability status is per capability, not per module (`AVAILABLE`/`CONDITIONAL`/`BETA`/`MOCK`), page context re-ranks but never fabricates a match, and a Confirm button shows the mutation and its server-composed arguments — see [../ai/work-assistant-coverage.md](../ai/work-assistant-coverage.md) |
| Multi-tenant · RLS · RBAC · Plans · Audit | ✅ | `lib/bms/{tenant,permissions,audit}.ts` · plan/entitlement authority `lib/bms/entitlements.ts` (`plans.ts`/`featureAccess.ts` only re-export it) · `4.0–5.1` / `5.7` / `5.8` |
| SaaS packages, feature access & capacity limits | ✅ | `lib/bms/{entitlements,featurePolicy,planPolicy,packageMetrics}.ts` · `10.73`–`10.75`, `10.101`–`10.102` (catalogue data + `update_bms_plan_catalog` from `10.83`) · `/admin/billing`, platform `/admin/tenants` (package metrics) + `/admin/master-data` → Plans (preview token + confirm) · public `GET /api/public/packages/pdf` — five plans (Free/Pro/Growth/Business/Enterprise; Enterprise is sales-led). Enforced: product quota, user quota (owner counts), branch/device/channel capacity for `capacity_policy_version = 2` shops (inactive rows count; existing rows stay editable), `REPORT_SCHEDULE`/`RETENTION_ENGINE` features for `feature_policy_version = 2` shops (version 1 = legacy, kept permanently). Never gated: checkout, POS sales, webhooks, order volume, Retail Local. Prices are quote evidence; no recurring billing |
| Platform master data (reference data) | ✅ code (pilot data review pending) | `lib/bms/{masterData,thaiAddress,shippingMaster,taxMaster,starterMasterData,barcodeMaster,platformSettings}.ts` · `graphql/bmsMasterData.ts` · `10.76`–`10.86` · platform `/admin/master-data` (tabs: platform, plans, AI rates, banks, units, addresses, carriers, barcodes, drugs, tax) · public rate-limited `GET /api/public/thai-addresses` — global tables have no `tenant_id`/RLS, `bms_app` reads only and every write goes through a platform-admin service plus a narrow `SECURITY DEFINER` function (`10.86`) with audit + revision in one transaction; rows retire with `active = false`; tenant rows (addresses, tax buyers, shipments, pharmacy policies) keep their own snapshots and printing never joins master data. Master drugs are suggestions only — a tenant pharmacist still approves the policy, and only the inactive `SAMPLE-DO-NOT-USE` row is seeded. AU/GB locality tables stay empty until a licence/residency review |
| REST route authentication | ✅ | `lib/bms/adminRouteAuth.ts` — every `/api/bms/*` staff route runs `authorizeAdminRoute(<permission>)` with the tenant derived from the signed session (`middleware.ts` guards `/admin/**` only, so a route has no protection it does not apply itself); webhooks verify signatures fail-closed, cron uses a token, and the two by-design public endpoints carry rate limits. Since the file-security hardening `authorizeAdminRoute()` also checks Redis session revocation, re-reads identity from Postgres like the GraphQL context, and honours the drill-down cookie only for a database-verified platform admin and an existing tenant. Guarded by `scripts/inventory-tenant-scope-contract.test.mts` and `graphql-request-security-contract` — see [api.md](./api.md) |
| Stored files, community chat & GraphQL request limits | ✅ code | `app/api/files/*` · `lib/storage.ts` · `graphql/{resolvers,requestLimits}.ts` · `10.109` (`files.owner_user_id`; chat media backfilled private; legacy key/database/config/script/installer artifacts reclassified private) — `/api/files/[id]` serves anonymously only `public` rows; private files need current chat membership, the exact owner, the owning tenant's admin (generated reports re-check `report.view` and scope) or, for ownerless legacy rows, a platform admin; files with dedicated routes (clinical, operation evidence, support bundles, release assets, bank statements) always 404 there. The global file inventory and its GraphQL list/rename/delete are platform-admin only; ordinary users see only unreferenced files they own. Chat send/list/manage resolvers require current membership. `/api/graphql` enables CSRF prevention, refuses cross-origin browser POSTs, bounds JSON/multipart bodies and rejects operations over depth 30 / 2,500 fields / 200 aliases. Guarded by `file-visibility-contract`, `community-chat-security-contract`, `graphql-request-security-contract`, `web-security-hardening-contract` — see [api.md](./api.md) and [database.md](./database.md) |
| SaaS: Self-serve Signup | ✅ | `lib/bms/signup.ts` · `/shop-signup` |
| Social Login (Google / Facebook) | ✅ | `lib/auth/{social,socialAccountPolicy}.ts` · `lib/bms/socialAuthSettings.ts` · `10.22` · platform-admin `/admin/auth-settings` — per-surface switch (`PUBLIC_LOGIN`/`ADMIN_LOGIN`/`SHOP_SIGNUP`, all off by default) AND runtime config readiness; client ids/secrets in env only; one `(provider, provider_id)` per user |
| Delivery platforms (foodpanda / GrabFood / LINE MAN) | 🧪 foodpanda sandbox/shadow; others contract-blocked | `lib/bms/deliveryPlatforms/*` · `lib/bms/{deliveryIntegrations,deliveryProviderSettings}.ts` · `10.12`, `10.14`, `10.21` · `/admin/delivery-platforms` (tenant) + `/admin/delivery-provider-settings` (platform) · `app/api/bms/delivery/*` — durable webhook inbox, atomic order/payment/reservation, post-commit command outbox, verified mappings only, OAuth client credentials for foodpanda; no provider is live-ready — see [../integrations/delivery-platforms.md](../integrations/delivery-platforms.md) |
| Retail Local (single-shop self-hosted) | 🧪 technical pilot, not Commercial/GA | `deploy/retail-local/` · `apps/retail-local-agent/` · `lib/bms/{deploymentMode,localProvisioning}.ts` · `10.15`, `10.19`–`10.20`, `10.27`, `10.29`, `10.32`–`10.34` · public `/retail-local` downloads + platform `/admin/retail-local-releases` — same Web/WS/POS stack on one local PostgreSQL, atomic first-run provisioning, checksummed migration ledger, loopback-only services, operator-initiated signed updates with backup and rollback; Server on Windows x64/Ubuntu x64, Windows x86 legacy is POS-only, macOS experimental; installers unsigned. Platform admins can delete one published Managed Runtime version/target under the publish lock and irreversibly purge the stored installer of a `hidden`, non-`latest` release (typed confirmation, same-origin, audited, tombstone kept); pilot rounds through `0.2.14-pilot.7` — see [../business/retail-local.md](../business/retail-local.md) and [../business/retail-local-ga-readiness.md](../business/retail-local-ga-readiness.md) |
| Retail Local licensing & installation registry | 🧪 candidate | `lib/bms/{retailLocalLicensing,localLicense,retailLocalInstallations}.ts` · `10.16`–`10.18`, `10.28`, `10.35`, `10.36` · platform `/admin/retail-local-licenses` + shop `/admin/retail-local-license` (`retail_local.license.view`/`.manage`, seeded to no role) — evidence-only and fail-open: setup never redeems a code, installing creates no licence or trial, nothing may stop a running shop; the registry counts instances by random UUID with no hardware identity or source IP |
| Retail Local consented leads + PDPA erasure | 🧪 Cloud-only, privacy text pending legal review | `lib/bms/retailLocalLeads.ts` · `10.105` (`bms_retail_local_leads`, revisions/events, `bms_submit_retail_local_lead()`), `10.106` (`bms_erase_retail_local_lead()`) · public `POST /api/public/retail-local/lead` (explicit consent, 5/IP/hour, 404 on a Retail Local install) + Leads tab of platform `/admin/retail-local-licenses` — an optional sales contact, never licence authority; downloads never require it. Erasure clears contact fields and every earlier snapshot in one transaction, keeps consent proof and freezes the row. Re-apply `10.106` after any re-run of `10.105`. The linked privacy policy does not yet describe these leads — see [../business/retail-local.md](../business/retail-local.md) |
| Installer error reports | ✅ opt-in | `lib/bms/{installerReports,installerReportFormat,installerReportUpload}.ts` · `10.31` · public `/installer-report` + `pages/api/installer-reports.ts` · platform `/admin/installer-reports` — consent header required, `BMS_INSTALLER_REPORTS_ENABLED=true`, 64 KiB/10 per source per hour/1000 per day, allow-listed JSON only, 90-day expiry |
| Homepage app download links | ✅ | `lib/bms/{appDownloadSettings,appDownloadValidation}.ts` · `10.57` · platform `/admin/app-downloads` (`GET`/`PUT /api/admin/app-downloads`, platform admin) + rate-limited `GET /api/public/app-downloads` — global HTTPS Android/App Store links; an empty link leaves the homepage badge inert — see [../business/app-downloads.md](../business/app-downloads.md) |
| Outbound email providers & Mail Log | ✅ | `lib/mailer.ts` · `lib/bms/mailLog.ts` · `7.40`, `10.59` · platform `/admin/mail-log` — `MAIL_PROVIDER` selects SendGrid (default), Gmail SMTP, or a generic TLS-only SMTP relay (`smtp`: Resend/SES/Postmark-style, `SMTP_*` + `MAIL_FROM`); receipts and order-status mail set the shop's `contact_email` as a validated reply-to. Apply `10.59` before using `smtp`, or those sends go unlogged |
| Public Landing / Interactive Infographic | ✅ | `app/(main)/page.tsx` · bilingual/session-aware CTA flow · interactive BMS flow diagram at `/how-it-works` (compact on `/`) from `components/marketing/flow/`, frontend-only, guarded by `bms-flow-data-contract` |
| Self Profile & Avatar | ✅ | `/admin/profile` · `bmsMe` / `updateMe` / `uploadAvatar` · per-user `theme_preference` / `language` · display name/username/avatar are re-read from Postgres by `refreshAdminIdentity()` (never trusted from the JWT), so a change reaches the admin sidebar/header without signing in again (no migration) |
| Support Tickets | ✅ | `support_tickets` / `support_ticket_comments` · `/support` · `/admin/support-tickets` |
| Support Diagnostics | ✅ | `lib/bms/supportDiagnostics.ts` · `POST /api/pos/diagnostics/events` (device token, no cashier PIN, rate-limited per device) · `bmsPosDeviceDiagnostics` on `/admin/pos-devices` gated by `support.logs.view` — append-only, tenant-scoped, context allowlisted; a tenant is never read from the body |
| Batch & Cron Ops View | ✅ | `lib/bms/operationsSchedule.ts` · `/admin/operations-schedule` |
| Cron/Batch Run History | ✅ | `lib/bms/{jobRuns,scheduledJobTrace}.ts` · `7.55__bms_job_runs.sql` · cron endpoints record status/duration/output; `POST /api/bms/jobs/report-run` lets external jobs report back. The opt-in Docker `scheduler` service (`apps/web` Dockerfile `scheduler` target, registry `apps/web/scheduler/jobs.json`) dispatches the 22 scheduled APIs (16 every 15 minutes, 6 daily) with Redis slot claims; choose Docker or GitHub as the single owner. See [scheduler.md](scheduler.md). |
| System Health (`/admin/system-health`) | ✅ | `lib/bms/systemHealth.ts` · no migration, no new permission — reuses AI Provider Health/job-run/operations-schedule services, adds Postgres/Redis vitals, cross-tenant Channel Health, and a `bms_failure_incidents` list; GraphQL latency/error-rate via `lib/bms/requestMetrics.ts` (Redis histograms, `graphql/metricsPlugin.ts`) — not yet verified against a live browser/DB |
| Staff Management by Shop Owner (Manager) | ✅ | `lib/bms/{userAdmin,staffRoles}.ts` · `7.78__bms_user_management_perms.sql` · `/admin/users` — `user.view`/`user.manage` opens the module, a code-level role rank decides which rows may be touched; a "Super Admin" tag marks `is_platform_admin` rows before the shop role (display only); see [api.md](./api.md) § RBAC |
| Per-user Language & Theme Preference | ✅ | `users.language` / `users.theme_preference` · `7.50` / `7.56` / `7.81` (new accounts default to Thai) · `/admin/profile` + public `/settings` |
| Live Dashboard (`/live-dashboard`) | ✅ phase 1 real data | `app/(main)/live-dashboard/page.tsx` · `bmsLiveDashboard` — public route reusing the session cookie + `report.view`, with real KPIs, trend, channel, order and stock signals; see [../ui/dashboard.md](../ui/dashboard.md) |
| Platform Admin (cross-tenant) | ✅ | `lib/bms/platform.ts` · `/admin/tenants` · `5.6__bms_platform_admin.sql` |
| Tenant Drill-down (impersonate) | ✅ | `bmsEnterTenant`/`bmsExitTenant` · signed cookie `BMS_ACT_TENANT` |
| Ops: Daily AI Log Triage | ✅ | `.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/*` |
| Dev: Fake Data Seeder | ✅ | `/admin/dev/fake` · `app/api/dev/fake/*` — includes one-click `board_game_cafe` members/floor/rates/sessions/library/loan/discovery fixtures and FK-ordered cleanup |

### Realtime architecture status (2026-09-10)

The GraphQL WebSocket path now carries centrally validated BMS invalidations for admin and
device-authenticated POS clients. Polling, focus refresh, mutation responses, and manual refresh
remain required recovery paths while bounded replay and production recovery/load proof are pending.

The repository audit found authorization, lifecycle, transaction-boundary, replay, and operational
gaps that must be closed before expanding subscription coverage. The accepted direction is a
short-lived HTTP-minted WS ticket, scoped safe invalidation events, and a PostgreSQL transactional
outbox dispatched to Redis while `apps/ws` remains database-free. Migration `9.70`, the event
contract, dispatcher, continuous multi-instance-safe web pump, short-lived HTTP-minted admin/POS WS
tickets, gateway limits/lifecycle, and migration `9.71` domain triggers are implemented. The client
deduplicates and version-checks events, batches targeted active-query refetches, reconciles on
  reconnect/focus, and exposes degraded state. The DB contract and multi-instance Redis/WS live
  smoke pass; production soak/load monitoring remains.
See the [full audit](realtime-production-audit.md) and
[ADR 001](decisions/001-transactional-realtime-invalidation.md).

The mobile transport decision is implemented server-side: normal React Native/POS reads and commands
use HTTPS GraphQL, while GraphQL WS carries invalidations. Device-scoped GraphQL context and named
operations now cover the normal POS workflows, and the in-repository RN client calls the core
retail/restaurant/board-game/branch-inventory/shift workflows. The 41 POS REST routes remain compatibility APIs until browser and
external-client rollout completes. See the
[mobile GraphQL/WS architecture and route inventory](mobile-graphql-ws-realtime.md).

**Roadmap remaining:** TikTok send API · live
Flash/Kerry carrier adapters — the booking/tracking/label
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
 finishing admin i18n (57 of 99 admin `.tsx` files are bilingual — see [AGENTS.md](../../AGENTS.md)
§ i18n coverage for what is deliberately *not* a gap) ·
Follow-up Automation's Workflow Engine and decision-driving scoring model ·
**POS Mobile native integrations (iOS/Android)** — the bare React Native counter client is built for
staff and uses GraphQL with a device token plus cashier PIN. One-shot camera scanning and an
explicitly opened, focused Bluetooth/USB HID modal are implemented; the app remembers that local
choice in Keychain, falls back to camera when it cannot read it, and keeps catalog modifier/pack
selection authoritative. Global native key capture outside the modal, physical camera/HID model
certification, ESC/POS printing and cash-drawer kick over Bluetooth/USB (ties into the WebUSB gap
above), and the customer-facing display (`/pos/display` uses a same-browser `BroadcastChannel`,
which does not reach a second device) remain native rollout work. Every environment must include
`9.5__bms_pos_cash_movement_idempotency.sql`; the RN cash-movement caller keeps one key across an
unknown network result ·
**Insurance Sales Inbox (planned, new BMS module)** — policy/premium/claim domain sold primarily
through LINE chat, built as a tenant module (not a separate product) so it inherits multi-tenant
RLS/RBAC, the Omnichannel Inbox (`lib/bms/inbox.ts`, LINE webhook/reply/push already built), and the
customer/staff AI pipeline's existing confirm-before-write pattern (`CONFIRMATION_REQUIRED` +
server-composed summary — the same shape a quote/coverage explanation needs, since AI must never
bind coverage on its own). New surface needed end-to-end: schema + migration + service +
GraphQL module + permissions, following the standard checklist in
[CLAUDE.local.md § การเพิ่มโมดูลใหม่](../../CLAUDE.local.md). Two existing gaps become higher-stakes
here and are worth closing early rather than as a later cleanup: customer identity has no
auto cross-channel dedup today (phone/LINE stay separate records until a human merges them — risky
when one person holds multiple policies), and Follow-up Automation (`7.52`, renewal reminders'
natural home) is still only `tsc`-checked, never DB-verified. Sensitive documents (ID card, health
info) should reuse the `9.25` pharmacy clinical-evidence pattern (private per-file serving with its
own permission, not the general file store). Regulatory scope (OIC/คปภ. rules on digital sales,
licensed-agent sign-off, e-policy documents) needs legal review before the AI-assisted quote flow
goes live — this is not a code gap the checklist above resolves ·
a password/TLS for Redis before a real production deploy ·
one configured scheduler owner. The opt-in Docker `scheduler` service and
`.github/workflows/bms-cron.yml` cover the same 22 APIs. Docker uses the Web cron secret
and Redis slot claims; automatic GitHub runs require repository variable `BMS_CRON_RUNNER=github`
plus `BMS_APP_BASE_URL` and `BMS_CRON_SECRET` secrets. Enabled GitHub jobs now fail visibly when
these secrets are missing. See [scheduler setup and ownership](scheduler.md), and confirm real
execution at `/admin/operations-schedule`, which reads `bms_job_runs`.

**Production migration state:** the last production apply recorded in the repository is
`9.89`–`9.93` (user-reported, 2026-09-16); nothing after `9.93` has a recorded production apply.
The older 2026-08-13 list (`7.33`, `7.52`, `7.54`, `7.55`, `7.56`, `7.78`, `7.81`, `7.82` not yet
applied) is historical only. Always check the target database with `scripts/preflight-deploy.mts`
and `db/checks/schema-readiness.sql` — see [CLAUDE.local.md](../../CLAUDE.local.md) § ก่อน production. `7.96`–`7.98` each seed new
permissions; skip one and its admin screen returns 403 with nothing in the UI to explain why.

**Clean-room replay does not work.** Applying `db/init.sql` plus every migration in order against an
empty database fails (verified 2026-08-18): `init.sql` ends with a seed referencing a column a later
migration adds, and 19 of the 175 migrations error out, leaving `roles` and `bms_role_permissions`
incomplete. These files are applied by hand against a database that grew with them. Disaster recovery
means restoring a dump, not replaying migrations.

## RBAC model (two tiers)

- **Platform admin** (`users.is_platform_admin`) — manages the whole platform (every shop / plan /
  role). Views shop-level data only via **drill-down** (impersonation), never mixed across tenants.
- **Tenant role** (Administrator / Manager / Sales / Warehouse) — manages only their own shop.
  Every resolver scopes with `getTenantId(ctx)` + `requirePermission()`.

Users list/CRUD is gated to Administrator/platform, but platform admins in drill-down mode are
treated as tenant-scoped so `/admin/users` only shows the current shop. Role CRUD is platform-only.
Platform-level pages (Architecture, ENV/Logs/Posts/Files/Queue) are gated server-side in
`layout.tsx` via `requirePlatformAdminPage()` — not just a hidden menu item.

Newest tenant permission group (2026-11): `bank_reconciliation.view` / `.import` / `.review` /
`.close` (`10.110`, seeded to Manager only; Administrator holds every catalog permission implicitly).
The `10.111` pharmacist-licence form is gated by the tenant `Administrator` role itself
(`requireAdministrator()`), not by a catalog permission. Surfaces made platform-admin-only between
2026-10-30 and 2026-11-07: global file inventory (REST + GraphQL), Retail Local lead review/erasure,
Retail Local release-file purge and Managed Runtime release deletion.

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
  mobile/                Bare React Native POS client (generated GraphQL operations)
  desktop/               Electron POS shell — Windows/Linux/macOS; hosts /pos, owns no business rule
  ws/                    Subscription-only GraphQL WebSocket gateway — never connects to PostgreSQL
packages/
  realtime/              Event union, audience/permission rules, topics, ticket claims
  graphql-core/          typeDefs/resolvers shared by web and ws
db/
  migrations/*.sql        Idempotent, applied in numeric order
docs/                      This documentation tree
schema.graphql             Committed SDL artifact (`npm run schema:export`)
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
- `/features` is a public, server-rendered product search over reviewed presales knowledge; it
  never searches shop data or starts an AI chat. Signed-in admins searching from the header land on
  `/admin/search`, a deterministic knowledge page (no AI call); other visitors go to `/learn`.
- `/admin/bank-reconciliation` is in the Finance menu only when
  `NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED=true` and the user holds `bank_reconciliation.view`;
  the server flag still gates every read/write. See
  [../business/bank-reconciliation.md](../business/bank-reconciliation.md).
- `/data-deletion` is a static bilingual public page explaining how a shop, staff member or end
  customer requests deletion through the support page or support email, and which records (orders,
  payments, tax documents, audit/security logs) may be retained by law. It performs no deletion and
  has no API of its own; requests are handled manually through support.
- `/tax-invoice/request` is the public page behind the cloud receipt QR; it talks only to the
  rate-limited `POST /api/bms/tax-invoice-request` with a signed receipt token or private tracking
  secret and never starts an admin session.
- The homepage download band reads `GET /api/public/app-downloads` on each load; unset links keep
  the badge as an inert button.
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
