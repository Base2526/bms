# Current BMS contract matrix

This matrix describes contracts that exist now. Proposed Delivery contracts are deliberately listed
separately so no proposed operation is mistaken for implemented behavior. Each row's Evidence label
applies to the whole row.

## Existing callable contracts

| Contract | Direction / caller | Auth and scope | Input / authority | Output / side effect | Evidence | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `bmsOrders`, `bmsOrder`, `bmsOrderJourney` | Admin client -> BMS GraphQL | Admin session, permissions, tenant and location scope | Search/filter/id; server context is authority | Bounded operational reads; legacy money is `Float` | `VERIFIED` | `apps/web/graphql/bmsOrders.ts`; `schema.graphql` |
| `bmsPayOrder` / payment submit-confirm-reject-refund | Admin -> BMS GraphQL | Exact payment/order permissions and location scope | Server derives tenant; service locks/revalidates order/payment | BMS payment and order mutations, audit; payment confirmation makes order paid | `VERIFIED` | `apps/web/graphql/bmsPayments.ts`; `apps/web/lib/bms/payments.ts` |
| pack/ship/complete/cancel/return order | Admin -> BMS GraphQL/REST | Exact order permission and branch scope | Order id is untrusted until tenant/location validation | Calls BMS service; stock/money/tax rules stay in BMS | `VERIFIED` | `apps/web/graphql/bmsOrders.ts`; `apps/web/app/api/bms/order/`; `apps/web/lib/bms/orders.ts` |
| create/update shipment and carrier sync | Admin -> BMS GraphQL/REST | Shipping permission, tenant and location | BMS order/shipment ids validated server-side | Shipment state; carrier calls occur after commit | `VERIFIED` | `apps/web/graphql/bmsShipping.ts`; `apps/web/lib/bms/shipping.ts` |
| checkout GET/PATCH | Customer bearer -> BMS REST | Signed tenant/order token; no admin session | Token is tenant/order authority; body can update allowed customer checkout fields | No-store checkout projection and audited address/contact update | `VERIFIED` | `apps/web/app/api/bms/checkout/route.ts`; `apps/web/lib/bms/checkout.ts` |
| checkout payment upload | Customer bearer -> BMS REST | Signed token, configured payment method | Expected amount is calculated from locked BMS order | Private slip file and `PENDING` payment; never confirms payment | `VERIFIED` | `apps/web/app/api/bms/checkout/payment/route.ts`; `apps/web/lib/bms/payments.ts` |
| realtime ticket/subscriptions | Admin/web/android/POS -> BMS/WS | Short-lived audience-scoped ticket plus event audience/permission | Server builds allowed event set; subscription id is not authority | Invalidation hint; client refetches authoritative GraphQL | `VERIFIED` | `apps/web/app/api/bms/realtime/ticket/route.ts`; `packages/realtime/`; `apps/ws/` |
| generic private file read | User/admin -> BMS REST | Session plus tenant comparison | File id; server checks file visibility/tenant | Streams stored file | `VERIFIED` | `apps/web/app/api/files/[id]/route.ts`; `apps/web/lib/storage.ts` |
| platform delivery webhook/inbox/outbox | Provider/system -> BMS REST/workers | Provider signature or cron auth; verified integration mapping | Provider refs map to tenant/branch server-side | Third-party order integration only | `VERIFIED` | `apps/web/app/api/bms/delivery/`; `apps/web/lib/bms/deliveryPlatforms/` |

## Existing contract limitations relevant to Delivery

| Limitation | Evidence | Consequence |
| --- | --- | --- |
| No `service` or `driver` GraphQL context | `VERIFIED` | A new principal and a narrow adapter are required; do not send admin/POS credentials. |
| Tenant helper has a default-tenant fallback | `VERIFIED` | Service routes must use a fail-closed resolver that never defaults. |
| Legacy money fields are `Float` | `VERIFIED` | Add exact decimal-string/satang contract fields; retain legacy fields for compatibility. |
| Checkout token has one broad checkout purpose and no revocation handle | `VERIFIED` | It must not authorize tracking, cancellation or POD. |
| Realtime payloads are intentionally minimal and not replayable business truth | `VERIFIED` | Build a separate integration outbox/inbox and reconciliation path. |
| Current order/payment/shipment list contracts are not a fleet event stream | `VERIFIED` | Delivery cannot poll them as the only consistency mechanism. |
| Current shipment `DELIVERED` may complete the BMS order without first-party POD semantics | `VERIFIED` | New mapping needs explicit preconditions and evidence/reference checks. |
| Current public checkout endpoints lack an explicit shared rate-limit invocation | `VERIFIED` | New customer Delivery endpoints must be independently rate-limited. |

## Proposed BMS adapter operations

Names are working names, not executable schema. All money crossing this boundary is canonical decimal
string or integer satang; every mutation uses a stable idempotency key and request fingerprint.

| Working operation | Direction / caller | Auth and derived scope | Proposed result | Audit / errors | Evidence |
| --- | --- | --- | --- | --- | --- |
| `fleetDeliveryOrderContext(orderRef)` | Delivery service -> BMS | Service principal; server mapping derives tenant/branch/order | Minimal order version, state, fulfillment, exact amount due/shipping fee, payment eligibility, readiness and item eligibility decision/version | Read audit sampling; 401/403/404 plus stable business codes | `PROPOSED` |
| `fleetDeliveryBindQuote(input)` | Delivery service -> BMS | Same; tenant/order never accepted as authority | Lock eligible `PENDING` order, verify quote expiry/body fingerprint, write exact fee + quote ref/version, increment order integration version | Same-transaction audit and outbox; stale/paid/payment-pending conflict | `PROPOSED` |
| `fleetDeliveryUnbindQuote(input)` | Delivery service -> BMS | Same | Remove only the same still-unpaid quote under version precondition | Same-transaction audit/outbox; mismatch conflict | `PROPOSED` |
| `fleetDeliveryMerchantReady(input)` | BMS merchant Admin -> BMS | Admin permission and location scope | Persist readiness snapshot/idempotency and produce durable event while order remains `PACKING` | Same-transaction audit/outbox | `PROPOSED` |
| `fleetDeliveryCommitHandoff(input)` | Delivery service + explicit merchant confirmation -> BMS | Service principal mapped to order plus merchant confirmation record | Reuse authoritative BMS handoff/stock service; return BMS order version and event id | Same-transaction order/stock/audit/outbox; physical handoff forbidden on rejection | `PROPOSED` |
| `fleetDeliveryRequestCompletion(input)` | Delivery service -> BMS | Service mapping, delivery aggregate/version, approved delivered evidence reference | Request BMS `SHIPPED -> COMPLETED` through service preconditions | Audit/outbox; result may reject without changing Delivery evidence | `PROPOSED` |
| `fleetDeliveryRequestReturn(input)` | Delivery service -> BMS | Service mapping plus reviewed return context | Start/complete only an approved BMS return path; no automatic refund | Human decision audit/outbox | `PROPOSED` |
| `fleetDeliveryReconciliationSnapshot(ref)` | Either reconciler -> BMS | Service principal, bounded exact reference | Minimal authoritative versions/states/amount references | Read audit; no raw CRM, slip, tax or full item details | `PROPOSED` |

## Proposed Delivery API contract classes

| Class | Caller | Authorization | Pagination / version | PII class | Evidence |
| --- | --- | --- | --- | --- | --- |
| Quote/create/status | BMS adapter | Service principal with allowlisted operation | Aggregate version; idempotent mutations | Operational address/contact snapshot only | `PROPOSED` |
| Customer tracking/cancel request | BMS customer UI | Purpose-bound tracking token; server resolves delivery | No-store projection; conditional version; rate-limited | Coarsened location and public-safe state | `PROPOSED` |
| Merchant ready/handoff/return receipt | BMS Admin | Federated narrow token or BMS adapter command; branch/object check | Expected version + idempotency | Minimum recipient/pickup data | `PROPOSED` |
| Driver lifecycle/location | Driver app | Separate driver/device/session principal | Cursor lists; expected version; server timestamp | Driver-self plus active-job data | `PROPOSED` |
| Fleet Admin | Approved fleet-ops surface | Permission + platform/tenant/branch/object scope | Cursor pagination and stable sort | Permission-specific private data | `PROPOSED` |
| Events/reconciliation | BMS and Delivery workers | Service principal, envelope signature/allowlist | Event/aggregate versions, replay cursor | Strict allowlist, normally no raw PII | `PROPOSED` |

## Compatibility ownership

- `VERIFIED`: BMS owns its executable GraphQL schema, service behavior and exported
  `schema.graphql`; approved changes require service, resolver/route and contract-test updates in the
  same change.
- `PROPOSED`: a versioned shared contract package owns wire envelopes and exact scalar formats; each
  producer owns provider tests and each consumer owns consumer tests.
- `PROPOSED`: additions are backward-compatible; removals require a measured deprecation window and
  consumer inventory.
- `UNRESOLVED`: final operation names, transport split, rate limits, retention and release owner need
  architecture/security approval.

**STOP — Awaiting approval.**
