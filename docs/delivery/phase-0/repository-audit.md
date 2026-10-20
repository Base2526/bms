# Repository audit

Audit date: 2026-10-18. Each row's Evidence label applies to the whole row.

## Repository and runtime

| Area | Evidence | Finding | Source |
| --- | --- | --- | --- |
| Repository instructions | `VERIFIED` | `AGENTS.md` applies repo-wide and imports `@RTK.md`, but `RTK.md` is absent from the checkout. The missing file is an evidence gap; no requirements were inferred from it. | `AGENTS.md`; `find . -name AGENTS.md` |
| Web runtime | `VERIFIED` | Next.js 14.2, React 18.2, TypeScript 5.4, GraphQL 16.9, PostgreSQL client 8.11 and ioredis 5.8 are used by `apps/web`. | `apps/web/package.json` |
| Node versions | `VERIFIED` | CI uses Node 22; the web Docker build/runner uses Node 20 while the scheduler target uses Node 22. Compatibility must be resolved before sharing new packages. | `.github/workflows/gate.yml`; `apps/web/Dockerfile` |
| Existing applications | `VERIFIED` | Web, POS mobile, desktop POS shell, WS gateway, retail-local agent and scheduler exist. `apps/mobile` is POS, not a driver application. | `AGENTS.md`; `apps/mobile/package.json` |
| Database infrastructure | `VERIFIED` | Current Compose uses PostgreSQL 16 and Redis 7; PostGIS is not configured. Dev/prod topology includes web, WS and scheduler. | `docker-compose.yml`; `docker-compose.dev.yml`; `docker-compose.prod.yml` |
| Test gate | `VERIFIED` | Web gate is typecheck, DB-free contract tests, and production build. DB tests and mobile/desktop suites are separate. | `apps/web/package.json`; `.github/workflows/gate.yml`; `scripts/README.md` |

## Commerce and data authority

| Area | Evidence | Finding | Source |
| --- | --- | --- | --- |
| Tenant writes | `VERIFIED` | Tenant writes must use `beginTenantTx()`, set role `bms_app`, set the tenant GUC and optionally editor/revision metadata. Direct statements outside that transaction weaken RLS protection. | `apps/web/lib/bms/tenant.ts`; `db/migrations/4.2__bms_rls.sql`; `db/migrations/4.3__bms_rls_role.sql` |
| Tenant fallback | `VERIFIED` | Generic `getTenantId()` falls back to a fixed default tenant. This must never be used by a service-to-service Delivery surface. | `apps/web/lib/bms/tenant.ts` |
| Order lifecycle | `VERIFIED` | BMS states are `PENDING`, `PAID`, `PACKING`, `SHIPPED`, `COMPLETED`, `CANCELLED`, `RETURNED`. | `schema.graphql`; `db/migrations/3.5__bms_oms_states.sql` |
| Money authority | `VERIFIED` | Amount due is merchandise total plus `shipping_fee` and rounding. Order item `line_amount` is authoritative. Database money is exact `numeric`; exposed legacy GraphQL money fields are `Float`. | `apps/web/lib/bms/payments.ts`; `apps/web/lib/bms/orders.ts`; `db/migrations/7.47__bms_shipping_fee_zone_weight.sql`; `schema.graphql` |
| Payment submission | `VERIFIED` | Public checkout derives the expected full amount from the locked order and creates a `PENDING` payment only. Confirmation is a permissioned BMS action. | `apps/web/lib/bms/payments.ts`; `apps/web/app/api/bms/checkout/payment/route.ts`; `apps/web/graphql/bmsPayments.ts` |
| Handoff and stock | `VERIFIED` | `PACKING -> SHIPPED`, stock decrement, reservation consumption, stock movement and audit occur inside the BMS transaction. | `apps/web/lib/bms/orders.ts`; `apps/web/lib/bms/shipping.ts` |
| Completion | `VERIFIED` | Shipment status `DELIVERED` can cause BMS `SHIPPED -> COMPLETED`; current shipment flow does not require first-party Delivery POD. It cannot be reused unchanged. | `apps/web/lib/bms/shipping.ts` |
| Cancellation/return | `VERIFIED` | Cancellation is limited to pre-shipment states and releases reserved effects; return uses the authoritative return path and tax-document checks. | `apps/web/lib/bms/orders.ts` |
| Shipping quote behavior | `VERIFIED` | Existing shipping recalculation is for BMS shipping modes and can represent unavailable estimates with no authoritative first-party route/fare. It is not a Delivery quote contract. | `apps/web/lib/bms/checkout.ts`; `apps/web/lib/bms/shippingRates.ts` |

## Interfaces, identity, and files

| Area | Evidence | Finding | Source |
| --- | --- | --- | --- |
| GraphQL contexts | `VERIFIED` | `/api/graphql` recognizes web, admin, Android user and POS device contexts. It has no service or driver principal. | `apps/web/app/api/graphql/route.ts`; `apps/web/lib/auth.ts` |
| Admin authority | `VERIFIED` | Admin routes refresh identity, resolve signed acting-tenant state, and enforce permission plus allowed-location scope. | `apps/web/lib/bms/adminRouteAuth.ts`; `apps/web/lib/bms/permissions.ts`; `apps/web/lib/bms/locations.ts` |
| Checkout token | `VERIFIED` | Checkout token is HMAC-signed and binds version, tenant, order and expiry, but has no action-level purpose, delivery id or revocation handle. | `apps/web/lib/bms/checkoutToken.ts` |
| Checkout rate limit | `VERIFIED` | The audited checkout GET/PATCH and payment routes do not invoke the shared `rateLimit()` guard. A new tracking surface must add an explicit policy. | `apps/web/app/api/bms/checkout/route.ts`; `apps/web/app/api/bms/checkout/payment/route.ts`; `apps/web/lib/bms/rateLimit.ts` |
| Storage | `VERIFIED` | Files can be private and tenant-bound, but generic retrieval is broader than a purpose-specific Delivery evidence contract. POD/KYC needs a dedicated authorization route. | `apps/web/lib/storage.ts`; `apps/web/app/api/files/[id]/route.ts`; `apps/web/app/api/bms/pharmacy/evidence/[id]/file/route.ts` |
| Notifications | `VERIFIED` | Existing user notifications write the generic notification table and publish a realtime hint. They are not an external delivery notification outbox. | `apps/web/lib/notifications/service.ts`; `db/migrations/1.16__notifications.sql` |

## Existing integration and operations patterns

| Area | Evidence | Finding | Source |
| --- | --- | --- | --- |
| Provider delivery context | `VERIFIED` | `deliveryPlatforms` and `/api/bms/delivery/*` already mean third-party food-platform integration. New first-party Delivery names/routes must not collide. | `apps/web/lib/bms/deliveryPlatforms/`; `docs/integrations/delivery-platforms.md`; `apps/web/app/api/bms/delivery/` |
| Durable integration pattern | `VERIFIED` | Delivery-platform code already demonstrates server-derived tenant/store mapping, inbox fingerprints, leased workers, outbox-after-commit commands and settlement evidence. It is a pattern, not a reusable first-party domain contract. | `apps/web/lib/bms/deliveryPlatforms/` |
| Realtime | `VERIFIED` | Realtime events are scoped invalidation hints, carry allowlisted scalar metadata, and are at-least-once. The WS gateway has no database. They are not a durable commerce feed. | `packages/realtime/`; `apps/ws/`; `docs/architecture/mobile-graphql-ws-realtime.md` |
| Job history | `VERIFIED` | `recordJobRun()` persists scheduled/manual execution status but is platform-wide and does not provide Delivery queue semantics. | `apps/web/lib/bms/jobRuns.ts` |
| System health | `VERIFIED` | `/admin/system-health` is read-only and composes fail-soft health reads. Delivery may contribute read-only status later but must not add recovery mutations there. | `apps/web/lib/bms/systemHealth.ts`; `docs/agent-invariants.md` |
| Admin UI | `VERIFIED` | Existing BMS Admin has tenant-aware orders, payments, shipments, system health and delivery-platform pages. No first-party fleet operations surface exists. | `apps/web/app/(admin)/admin/` |

## Required BMS changes — not implemented

| Change | Evidence | Why |
| --- | --- | --- |
| Purpose-built service principal and context | `PROPOSED` | Ordinary admin/POS/user credentials must not authorize Delivery. |
| Narrow order-context snapshot operation | `PROPOSED` | Delivery needs eligibility/payment/order versions without raw CRM/payment data. |
| Exact quote bind/unbind service | `PROPOSED` | BMS must own `shipping_fee` mutation and reject stale/paid orders atomically. |
| Merchant ready/handoff integration service | `PROPOSED` | Physical handoff must reuse the existing stock/order transaction. |
| Durable BMS integration outbox/inbox | `PROPOSED` | Realtime hints cannot provide replay, version gaps or reconciliation. |
| Delivery completion/return/refund request adapters | `PROPOSED` | Delivery may request, never directly assert BMS commerce state. |
| Purpose-bound customer tracking token | `PROPOSED` | Checkout bearer lacks tracking-specific scope/revocation. |
| Permission catalog additions and Admin navigation | `PROPOSED` | Only after Admin-placement approval; the server catalog remains authority. |
| Purpose-specific POD/return evidence access | `PROPOSED` | Private object existence and tenant/object permission must be checked. |
| Schema export and contract tests | `VERIFIED` | Any approved GraphQL change must regenerate `schema.graphql` and preserve adapter/test parity. |

## Conflicts and missing evidence

- `VERIFIED`: `AGENTS.md` references `RTK.md`, but the file is missing.
- `VERIFIED`: the master prompt calls for PostGIS and a separate driver app; neither exists today.
- `VERIFIED`: legacy GraphQL exposes money as `Float`, conflicting with the required exact
  cross-service boundary. Compatibility requires additive exact fields, not changing existing fields
  in place.
- `UNRESOLVED`: no checked-in legal, tax, insurance, driver-employment, COD-custody, retention, pilot
  volume, SLO, RPO or RTO approval was found. These cannot be inferred from code.
- `UNRESOLVED`: no Google Maps, push, KYC, masked-contact, bank-transfer or production infrastructure
  contract was audited; Phase 0 does not authorize creating them.

**STOP — Awaiting approval.**
