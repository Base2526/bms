# Mobile-first GraphQL and WebSocket architecture

> Status: server contract, database contract suites, multi-instance socket verification, browser
> named-subscription rollout, and the in-repository React Native retail/restaurant/shift callers are
> implemented (2026-09-12). REST compatibility routes and polling remain for browser/external-client
> rollout and recovery.
>
> Realtime security and delivery details: [production realtime audit](realtime-production-audit.md)
> and [ADR 001](decisions/001-transactional-realtime-invalidation.md)
>
> The surface was then made generatable — committed SDL, typed inputs/outputs, named actions, error
> codes: [graphql-client-readiness-brief.md](graphql-client-readiness-brief.md) and
> [`schema.graphql`](../../schema.graphql). It changed no service, no permission and no REST route.
>
> Migrations `9.70`–`9.74` have DB contract coverage. `9.73` records the first POS row-shape fix and
> `9.74` permanently splits device and shift trigger functions. Production rollout still follows
> [realtime-test-database.md](realtime-test-database.md) and must not infer migration state from this
> repository.

## Decision

React Native, Android, iOS, browser admin, and future POS clients use one application contract:

- GraphQL queries over HTTPS read authoritative snapshots;
- GraphQL mutations over HTTPS execute commands through `apps/web/lib/bms/*.ts` services;
- GraphQL subscriptions over WebSocket deliver small invalidation events;
- Redis provides cross-instance fan-out, with a PostgreSQL transactional outbox providing durable
  commit-to-publish handoff;
- clients deduplicate, batch, and refetch the existing authoritative GraphQL query after an event;
- REST remains for transports that are naturally HTTP-specific and as a compatibility surface while
  web/POS clients migrate.

This is not a custom WebSocket command bus. Money, stock, tax, order, pharmacy, and other business
mutations continue over authenticated HTTPS GraphQL mutations. `apps/ws` remains database-free and
contains no business logic.

```text
React Native / Web / POS
  -> HTTPS GraphQL query or mutation
  -> thin resolver -> BMS service -> PostgreSQL transaction
                              \-> transactional outbox row
  -> authoritative response

outbox dispatcher -> Redis -> GraphQL WS subscription -> invalidate/refetch GraphQL snapshot
```

## Phase 1 repository inventory

The inventory covers every route under `app/api/bms/**` and `app/api/pos/**`, the GraphQL schema,
subscription publishers/consumers, and direct REST calls from React surfaces at revision `a3898e82`.

| Surface | Count | Current state |
| --- | ---: | --- |
| `/api/bms/**/route.ts` | 76 | Mixed admin compatibility, public/signed flows, webhooks, jobs, files, and exports |
| `/api/pos/**/route.ts` | 41 | Device-token + cashier-PIN contract; all normal counter workflows currently use REST |
| GraphQL queries | 218 | Broad admin/community read coverage; no POS-device GraphQL context |
| GraphQL mutations | 247 | Broad admin/community command coverage; no transport-equivalent POS-device contract |
| GraphQL subscriptions | 15 | Inbox plus legacy community sync; security gaps and full matrix are in the realtime audit |

### REST that remains REST permanently

These paths are HTTP-native. Some may also gain a GraphQL metadata/query operation, but bytes,
callbacks, public signed flows, and scheduler triggers remain REST.

| Reason | Routes |
| --- | --- |
| External webhooks/callbacks | `/api/bms/facebook/webhook/[tenantId]`, `/instagram/webhook/[tenantId]`, `/lazada/webhook/[tenantId]`, `/line/webhook/[tenantId]`, `/line/webhook`, `/shopee/webhook/[tenantId]`, `/tiktok/webhook/[tenantId]`, `/tiktok/webhook`, `/web/webhook/[tenantId]` |
| Cron/job triggers | `/api/bms/ai/check-health`, `/channels/check-health`, `/followups/run`, `/jobs/etax`, `/jobs/report-run`, `/loyalty/maintenance`, `/menu-availability/reset`, `/orders/release-expired`, `/pharmacy/assessments/expire-stale`, `/realtime/dispatch`, `/reports/send-digest`, `/shipping/sync-carriers`, `/support-diagnostics/purge-expired` |
| Upload/download/binary/export | `/api/bms/inbox/upload`, `/pharmacy/evidence/[id]/file`, `/pharmacy/evidence/upload`, `/pos-shifts/export`, `/products/upload`, `/reports/download/[id]`, `/shipment/[id]/label`, `/support-diagnostics/bundles/[id]/download`, `/support-diagnostics/export`, `/api/pos/pharmacy-evidence`, `/api/pos/shift-report/export` |
| Signed/public browser flow | `/api/bms/checkout`, `/checkout/payment`, `/restaurant-qr/[token]`, `/restaurant-qr/menu`, `/restaurant-qr/menu-item`, `/restaurant-qr/service-calls`, `/restaurant-qr/submissions` |
| Diagnostics/stream-oriented compatibility | `/api/bms/chat`, `/demo-chat`, `/support-diagnostics/events`, `/support-diagnostics/send`, `/api/pos/support-diagnostics` |

Every state-changing route in this group must still call the same service and enqueue the same outbox
event as its GraphQL equivalent. Keeping REST does not exempt it from authorization, idempotency,
audit, or realtime rules.

### Existing REST with an established GraphQL equivalent

These REST routes stay compatible while clients move to the named GraphQL operations.

| REST routes | Existing GraphQL contract |
| --- | --- |
| `/api/bms/inbox`, `/inbox/[id]/reply` | `bmsConversations`, `bmsConversation`, `bmsSendMessage` and related Inbox mutations |
| `/api/bms/order`, `/order/[id]/{pay,pack,ship,complete,cancel,return}` | `bmsCreateOrder`, `bmsPayOrder`, `bmsPackOrder`, `bmsShipOrder`, `bmsCompleteOrder`, `bmsCancelOrder`, `bmsReturnOrder` |
| `/api/bms/payment`, `/payment/[id]/{confirm,reject,refund,verify}` | `bmsPayments`, `bmsPayment`, `bmsSubmitPayment`, `bmsConfirmPayment`, `bmsRejectPayment`, `bmsRefundPayment`, `bmsVerifyPaymentSlip` |
| `/api/bms/purchase`, `/purchase/[id]`, `/purchase/[id]/{receive,cancel}` | `bmsPurchaseOrders`, `bmsPurchaseOrder`, `bmsCreatePurchaseOrder`, `bmsReceivePurchaseOrder`, `bmsCancelPurchaseOrder` |
| `/api/bms/shipment`, `/shipment/[id]/{status,tracking}` | `bmsShipments`, `bmsShipment`, `bmsCreateShipment`, `bmsSetShipmentStatus`, `bmsUpdateTracking` |
| `/api/bms/reports/{generate,inventory,sales,top-products}` | `bmsGenerateReport`, `bmsInventorySummary`, `bmsSalesSummary`, `bmsTopSellingProducts` |
| `/api/bms/pos-shifts` | existing admin POS shift queries/mutations (`bmsPosOpenShift`, `bmsOpenPosShift`, `bmsClosePosShift`) |
| `/api/bms/onboarding/sample-data` | compatibility-only setup command; not a normal mobile workflow |

The existence of a similarly named operation does not yet prove response-shape parity. Phase 9 adds
fixture-driven REST-versus-GraphQL contract tests before moving each caller.

### BMS REST gaps and implemented GraphQL equivalents

| REST routes | GraphQL capability |
| --- | --- |
| `/api/bms/inventory/transfers` | `bmsStockTransfers`, `bmsStockTransfer` use the existing stock-transfer service |
| `/api/bms/inventory/counts` | `bmsStockCounts`, `bmsStockCount` use the existing stock-count service and retain separate apply permission |
| `/api/bms/restaurant-requests` | `bmsMobileRestaurantRequests`, `bmsReviewRestaurantRequest` |
| `/api/bms/store-credit` | `bmsStoreCredit`, `bmsIssueStoreCredit` |
| `/api/bms/commission` | `bmsCommissionRules`, `bmsCommissionReport`, `bmsCommissionRule` |
| `/api/bms/reports/pos-returns`, `/reports/pos-return-audit` | `bmsPosReturnSummary`, `bmsPosReturnAuditSummary`; exported files remain REST |
| `/api/bms/reserve` | retain as legacy compatibility until its caller and idempotency contract are identified; do not expose a second reservation command blindly |

### POS device REST migration inventory

All routes below authenticate a device separately from the acting cashier. Normal mobile workflows
need GraphQL equivalents, but REST remains until parity tests and client rollout pass.

| Workflow | Current REST routes | GraphQL status |
| --- | --- | --- |
| Device/session and shifts | `/api/pos/session`, `/shift`, `/shifts`, `/shift-report` | implemented in `bmsPosSession`, `bmsPosShift`, `bmsPosShiftHistory`, `bmsPosShiftReport` |
| Catalog/search/barcode | `/api/pos/search`, `/scan`, `/restaurant/menu` | implemented in `bmsPosCatalogSearch`, `bmsPosScan`, `bmsPosRestaurantMenu` |
| Sale lifecycle | `/api/pos/sale`, `/last-sale`, `/recent-sales`, `/park`, `/return`, `/blind-return`, `/void` | implemented as named POS-device queries/mutations |
| Drawer/deposit/expenses | `/api/pos/cash-movement`, `/deposit`, `/expense`, `/no-sale` | implemented as named POS-device queries/mutations |
| Payments/refunds/receipts | `/api/pos/refund-settlement`, `/send-receipt` | implemented in `bmsPosCompleteRefund`, `bmsPosSendReceipt` |
| Members/AR/store credit | `/api/pos/member`, `/member/preview`, `/ar`, `/ar/collect`, `/store-credit` | implemented as named POS-device queries/mutations |
| Purchase receiving | `/api/pos/purchase` | implemented in `bmsPosPurchaseOrders`, `bmsPosPurchaseOrder`, `bmsPosReceivePurchase` |
| Pharmacy handoff | `/api/pos/pharmacy-review` | implemented in `bmsPosRequestPharmacyReview`; evidence upload remains REST |
| Kitchen | `/api/pos/kitchen/tickets`, `/kitchen/tickets/[id]/status`, `/kitchen/tickets/status` | implemented as device-scoped query/mutations |
| Restaurant checks/floor | `/api/pos/restaurant/checks`, `/restaurant/checks/[id]`, `/restaurant/floor` | implemented as device-scoped query/mutations |
| Incoming/QR/service/waitlist | `/api/pos/restaurant/incoming`, `/restaurant/qr-orders`, `/restaurant/requests`, `/restaurant/service-calls`, `/restaurant/waitlist` | implemented as device-scoped query/mutations |

`/api/pos/pharmacy-evidence`, `/api/pos/shift-report/export`, and
`/api/pos/support-diagnostics` remain REST for upload/export/diagnostic transport.

### Direct React REST consumers

The retail POS page is the largest migration target and directly calls nearly every `/api/pos/*`
route above. Restaurant POS calls the restaurant routes through local helpers/components and uses
`useLiveRefresh` polling. Admin direct REST callers remain for stock transfers/counts, commission,
POS shift reporting, support diagnostics, uploads, and pharmacy evidence. Checkout, public QR, demo,
and webhook-facing clients correctly remain on REST.

Client migration order is therefore:

1. introduce POS-device GraphQL context without changing any service;
2. add read-only session/catalog/floor/ticket queries;
3. add idempotent mutations one workflow at a time with REST parity fixtures;
4. subscribe to scoped invalidations while retaining current polling;
5. move the React POS caller, then publish the same contract for React Native;
6. retire a REST route only after telemetry proves no compatibility caller remains.

## Mobile GraphQL authentication contract

Three principals are distinct:

| Principal | HTTPS GraphQL authentication | Authority |
| --- | --- | --- |
| Admin/staff browser or RN | admin/mobile Bearer token or secure browser cookie | fresh user, tenant, RBAC, allowed locations, optional acting tenant |
| POS device | device Bearer token on HTTPS GraphQL; exchanged for a short-lived ticket only for WS | tenant, location, device only; never user authority |
| Acting cashier/approver | PIN fields on the sensitive mutation, verified server-side | named action permission and evidence for that operation only |

The client never supplies tenant, location, device, shift, cashier, or acting-tenant IDs as
authority. It supplies the selected cashier ID with the PIN only as identity evidence. A POS
mutation derives device/location/tenant from its authenticated context, finds the current shift
server-side (except a bounded prior-shift retry hint), verifies the cashier PIN, and keeps every
existing second-person approval rule.
Every money/stock/document mutation has a stable `idempotencyKey`.

WS uses a shorter-lived, audience-bound ticket minted over authenticated HTTPS after the same fresh
identity checks. `x-scope: android` selects the credential class but is never itself authorization.
Logout, revocation, expiry, or acting-tenant change closes the old subscription context.

## Target GraphQL surface by workflow

Names are provisional until each service signature is mapped; they are grouped here to prevent a
resolver from inventing a parallel behavior.

| Workflow | Query snapshot | Mutation command | Realtime invalidation |
| --- | --- | --- | --- |
| Session/device | `bmsMobileSession`, `bmsPosSession` | token exchange/refresh over HTTPS | `bmsDeviceSessionChanged` |
| Shift/drawer | current shift/report | open/close shift, cash movement, no-sale, deposit/expense | `bmsShiftChanged` |
| Product/menu | search/scan/menu snapshot | sold-out/back-on-sale | `bmsMenuAvailabilityChanged`, `bmsInventoryChanged` |
| Retail sale | cart lookup/recent sale | sale/park/return/void/refund settlement | `bmsPosOrderChanged`, `bmsPaymentChanged` |
| Restaurant floor/check | floor/check snapshots | open/move/add/remove/send/settle/cancel | `bmsRestaurantFloorChanged`, `bmsRestaurantCheckChanged` |
| Kitchen | branch ticket list | ticket status transition | `bmsKitchenTicketChanged` |
| Online/QR/waitlist | incoming/QR/waitlist lists | accept/reject/call/seat/cancel/no-show | matching scoped domain subscription |
| Members/credit | lookup/preview/account | enroll/collect/redeem as permitted | order/customer invalidation where a real workflow needs it |
| Inventory operations | summary/transfer/count | transfer/count/receive | inventory/transfer/count invalidations |
| Inbox/notifications | existing BMS queries | existing BMS mutations | hardened Inbox plus user notification events |
| Pharmacy | case-safe operational metadata | existing permission-gated handoff/review operations | case ID + safe status + time only |

## REST compatibility policy

- GraphQL equivalent first; caller migration second; removal last.
- REST and GraphQL adapters call the same service and produce the same outbox event.
- No resolver calls a REST route and no REST route calls GraphQL internally.
- File bytes, exports, callbacks, webhooks, and cron triggers remain HTTP endpoints.
- Public/signed routes keep their dedicated rate limit and token contract.
- Compatibility routes receive a deprecation owner and telemetry before any removal date is set.

## Phase boundaries

1. **Audit and architecture:** this document plus the existing realtime audit/ADR.
2. **Shared event contract:** central envelope, event union, topic builders, validation, redaction,
   fixtures, and contract tests.
3. **Transactional outbox:** new migration, tenant transaction helper, dispatcher, retry/retention,
   and multi-instance tests.
4. **WS/auth hardening:** Android/admin/device tickets, authorization, lifecycle and operational
   bounds before wider subscriptions.
5. **Mobile/POS GraphQL:** read operations first, then idempotent mutations with REST parity tests.
6. **Domain subscriptions and publishers:** install by workflow after its actual transaction boundary.
7. **Client migration and rollout:** React POS first, RN guide/fixtures, shadow/canary flags, polling
   retained until replay and recovery/load tests pass.

No later phase may claim completion merely because a schema field exists. Completion requires the
service path, authorization, idempotency, audit/outbox boundary, subscription, client reconciliation,
and tests to agree.

## Implementation status

| Phase | Status | Evidence |
| --- | --- | --- |
| 1. Audit and architecture | Complete | 117 REST routes classified above; GraphQL and subscription inventory linked |
| 2. Shared event contract | Complete | `packages/realtime/src/{events,topics,transport,fixtures}.ts`; central event/rule union, scoped topic builders, validation, safe logging, publish/subscribe helpers and bounded deduplication |
| 3. Transactional outbox | Implemented and DB-verified | migrations `9.70`–`9.74`, in-transaction helper, leased claim/ack/nack/cleanup functions, dispatcher service, guarded recovery endpoint, and pure/DB contract suites. `enqueueRealtimeEventInTx` is unguarded by design, so a missing outbox rolls back the owning write rather than silently losing realtime |
| 4. WS/auth hardening | Implemented and multi-instance verified | HTTP-minted short-lived tickets, strict admin revocation/fresh identity/acting tenant, scoped permissions/locations, subscription-only gateway, native-client classification, origin/size/quota/expiry/ping/drain/health controls, and Redis fan-out across multiple WS instances |
| 5. Mobile/POS GraphQL | Server contract complete | `graphql/{bmsPosDevice,posDeviceAuth,bmsMobileOperations}.ts`; normal POS routes and listed BMS gaps have named operations, server-derived scope, PIN/RBAC enforcement, shared services. `scripts/mobile-graphql-contract.test.mts` asserts operations against the parsed SDL, pairs every field with a resolver both ways, builds the merged schema through `graphql/schema.ts`, and rejects any authority read that is not `device.*` (POS) or `getTenantId(ctx)` (staff) |
| 6. Named subscriptions | Implemented and called | all 17 named views are declared in `packages/graphql-core`; each filters the one invalidation stream through `NAMED_REALTIME_SUBSCRIPTIONS`. Browser POS and React Native now mount the views relevant to their principal and current surface |
| 6b. Domain events | Implemented and DB-verified | migrations `9.71`–`9.74`, domain event contract/fixtures, exact POS device/shift payload assertions, and transactional publisher pure/DB suites |
| 6c. Coverage guard | Implemented | `scripts/realtime-domain-coverage-contract.test.mts` walks every table `lib/bms` writes and fails unless each is covered by a trigger or classified with a reason, so a forgotten domain cannot stay silent. Twenty tables are recorded there as known gaps that deserve an event and do not have one yet |
| 7. Client rollout | RN core complete; browser/external rollout remains | `apps/mobile` uses generated Apollo operations for catalog, sale/return/void, parked bills, shift/cash, restaurant checks/incoming orders and kitchen tickets; runtime screens/state import no mock data. It also has native socket classification, PIN verification, surface-scoped named subscriptions, bounded deduplication, batched active-query refetch, foreground recovery and degraded polling. Browser POS retains REST and polling while using named invalidation views; native hardware/pharmacy-review UI remain separate rollout work |
| 8. Typed client contract | Generated and compiled | `schema.graphql` is pinned to the executable schema; all 100 mobile/POS operations have named inputs and typed output trees, stable `extensions.code`, and generated typed documents in `apps/mobile/src/graphql/generated.ts`. The remaining rollout gate is per-workflow REST-versus-GraphQL parity, not client generation |
