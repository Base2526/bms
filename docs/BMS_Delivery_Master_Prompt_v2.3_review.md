# Requirement review — BMS Delivery Master Prompt v2.3

Review date: 2026-10-18

Reviewed prompt: [`BMS_Delivery_Master_Prompt_v2.3.md`](BMS_Delivery_Master_Prompt_v2.3.md)

Review branch: `codex/analyze-delivery-master-prompt-v2-3`

Branch base at creation: `feat/master-data-phase-8`

Review scope: requirement gap analysis against the checked-in GraphQL/order/payment/realtime/RBAC/
delivery-platform/mobile/storage documentation and representative source. This is **not** the full
Phase 0 architecture audit requested by the master prompt, and no database or runtime behavior was
exercised. The repository `AGENTS.md` references `@RTK.md`, but that file was not present in the
checkout at review time; available repository instructions and domain docs were used instead.

Outcome: the requirement gaps and gates in this review were incorporated into
[`BMS_Delivery_Master_Prompt_v2.4.md`](BMS_Delivery_Master_Prompt_v2.4.md). This review remains as the
rationale and traceability record for the revision. The subsequent Phase 0 audit/design output is in
[`delivery/phase-0/README.md`](delivery/phase-0/README.md).

## Executive verdict

**ยังไม่ครบสำหรับเริ่ม implementation (Phase 1–8) หรือใช้คำว่า production-ready.**

เอกสาร v2.3 **ครบพอสำหรับสั่งให้ทำ Phase 0 audit** เพราะกำหนดขอบเขตระดับสูง, phase gate,
ข้อห้าม, state machine ตั้งต้น, financial ledger, concurrency, security และ test scenarios ไว้ดี
แต่ยังมี business decisions และ integration contracts ที่กระทบ schema, auth, money, inventory,
tenant isolation และ legal scope โดยตรง ถ้าข้ามไป Phase 1 จะต้องเดาเรื่องสำคัญหลายเรื่อง ซึ่งขัดกับ
กฎของ prompt เองที่ห้าม invent API/payment behavior และขัดกับ BMS invariants.

คำแนะนำคือให้ถือสถานะปัจจุบันเป็น **`PHASE_0_READY / IMPLEMENTATION_BLOCKED`** และออก v2.4
หลังปิด P0 blockers ในรายงานนี้ ก่อนอนุมัติ Phase 1.

## Coverage summary

| Area | Status | Assessment |
| --- | --- | --- |
| Product scope and MVP boundaries | PARTIAL | ระบุ merchant-to-customer, matching, COD, POD และ payout แล้ว แต่ยังไม่ชัดว่า driver pool เป็นของใครและสินค้าประเภทใดห้ามส่ง |
| Architecture and service boundaries | PARTIAL | แยก Delivery DB/backend ชัด แต่ยังไม่มี authoritative contract ระหว่าง BMS กับ Delivery |
| Order and dispatch lifecycle | PARTIAL | มี state ตั้งต้นและ concurrency rule ที่ดี แต่ยังไม่มี mapping กับ BMS order/stock/payment states |
| Pricing and finance | PARTIAL/BLOCKED | มีสูตรและ immutable ledger แต่ driver earning, COD custody, tax, refund/cancellation liability ยัง unresolved |
| Tenant, branch and RBAC | INCOMPLETE | ระบุ tenant isolation กว้าง ๆ แต่ยังไม่มี identity/mapping model และใช้ role list ที่ยังไม่ align กับ BMS permission catalog |
| Customer authorization | INCOMPLETE | บอก reuse BMS customer UI แต่ยังไม่กำหนด bearer/session contract สำหรับ quote, tracking และ cancel |
| Driver identity and operations | INCOMPLETE | มี app features แต่ยังไม่มี onboarding/KYC, account lifecycle, fleet ownership, device trust และ safety policy |
| Security, privacy and reliability | PARTIAL | threat categories ดี แต่ retention, consent, SLO, RPO/RTO, incident ownership และ concrete limits ยังไม่กำหนด |
| Test and delivery process | GOOD | phase gates, exact test reporting, concurrency/failure scenarios และ no-deploy rule ชัดเจน |
| Legal/compliance readiness | BLOCKED | PDPA ถูกกล่าวถึง แต่ transport, employment/contractor, tax/WHT/VAT, regulated goods และ insurance ยังไม่มี decision owner |

## What v2.3 already does well

1. **Stops at Phase 0 and forbids fabricated facts.** This is the right control for a repository whose
   current contracts must be audited before design.
2. **Separates commerce and delivery ownership.** The rule that Delivery must not write directly to
   the BMS database is correct.
3. **Treats assignment as a database concurrency problem.** One accepted driver must be protected by
   transaction/unique/CAS, not only a Redis lock.
4. **Separates delivery evidence from verdict.** A photo is evidence, not automatic proof.
5. **Treats money as ledger state.** Commission, COD liability, driver payable, refunds and payout
   approval are separated; approval is not confused with an external bank transfer.
6. **Includes failure and replay testing.** Duplicate creation, outbox replay, simultaneous accepts,
   stale GPS, worker restart, upload failure, duplicate payout and restore testing are explicitly named.
7. **Uses approval gates.** Each phase requires actual commands/results and a stop for approval.

## Verified BMS constraints that the requirement must absorb

These are not optional implementation details; they change the required contracts.

### 1. `delivery` already names another BMS bounded context

BMS already uses `apps/web/lib/bms/deliveryPlatforms/`, `/api/bms/delivery/*`,
`/admin/delivery-platforms`, and permissions such as `delivery.integration.*`,
`delivery.settlement.*`, and `delivery.dispute.manage` for GrabFood/LINE MAN/foodpanda integration.
The new first-party last-mile network therefore needs a distinct bounded-context and route name, for
example `lastMile`, `fleetDelivery`, or another approved term. Reusing generic `delivery` risks route,
permission, navigation, event and operator-language collisions.

### 2. BMS order state is much smaller than the proposed delivery state

The committed GraphQL contract currently exposes BMS order states:
`PENDING`, `PAID`, `PACKING`, `SHIPPED`, `COMPLETED`, `CANCELLED`, `RETURNED`.
Restaurant handoff already treats `PACKING -> SHIPPED` plus stock movement and audit as one BMS
transaction, while provider delivery confirmation is a separate fact. The new requirement must define
an explicit mapping and ownership table instead of letting Delivery infer or write arbitrary BMS
transitions.

At minimum the matrix must decide:

| Business event | BMS state/action owner | Delivery state/action owner | Retry/reconciliation rule |
| --- | --- | --- | --- |
| Payment becomes eligible | BMS | observes eligibility | What event/read proves it and what happens on reversal |
| Merchant accepts / starts preparation | BMS | observes readiness | Exact meaning for retail vs restaurant |
| Merchant handoff | BMS authoritative stock boundary | records pickup evidence | Whether `shipOrder`/existing handoff service is reused |
| Driver delivered | BMS completion policy to approve | authoritative delivery evidence | Whether BMS auto-completes or requires merchant/admin confirmation |
| Cancellation/return/refund | Split by lifecycle stage | executes delivery/return operations | Compensating actions and conflict resolution |

### 3. The existing BMS GraphQL surface is not yet a Delivery service contract

Current order/payment resolvers are primarily admin-session + tenant-permission operations. The prompt
asks for authenticated GraphQL integration but does not define a service principal, token audience,
tenant/branch claims, revocation/rotation, allowed operation set, network boundary or object-level
authorization. No suitable service-to-service contract was verified in the inspected surface; Phase 0
must not treat ordinary admin JWTs as service credentials.

Required decision: whether to add a purpose-built BMS service-auth scope and narrow GraphQL operations,
or a signed event/command adapter. In either design the Delivery service must not accept a caller-sent
tenant as authority.

### 4. BMS realtime is an invalidation channel, not the durable business integration feed

The current realtime architecture says subscriptions are scoped invalidation hints; clients refetch
authoritative GraphQL snapshots. Its events intentionally exclude PII, payment details, attachments and
business payloads. Although BMS writes a transactional realtime outbox, that contract is not sufficient
by itself for Delivery to reconstruct orders or money state.

The phrase “Authenticated GraphQL and durable events” therefore needs a separate, explicit integration
event contract: event schema/version, producer transaction, consumer identity, replay cursor,
retention, poison-message handling, ordering/version rule, snapshot/refetch recovery and backfill.
Do not consume Redis/WebSocket invalidations as a finance/order event bus.

### 5. Quote/payment authority is not defined end to end

BMS currently derives customer amount due from the locked order and existing `shipping_fee`; public
checkout is a tenant/order-bound signed bearer link and payment submission creates `PENDING` only.
The current GraphQL schema also exposes several monetary values as `Float`, while v2.3 correctly requires
satang or exact decimal for the Delivery ledger.

Before Phase 1, define:

- which system creates and owns the final delivery-fee snapshot;
- how quote id, expiry, route version, fee, subsidy and currency are bound to a specific BMS order;
- which BMS service atomically updates/validates `shipping_fee` and amount due without trusting Delivery
  client input;
- what happens when payment is already pending/confirmed and the quote changes or expires;
- whether cross-service money uses integer satang or a decimal string (never binary GraphQL Float as
  the ledger authority);
- how cancellation/refund splits merchandise, delivery fee, subsidy, commission and COD.

### 6. BMS RBAC is permission-based and branch-scoped

The proposed role names are useful personas, but BMS authorization is enforced through
`BMS_PERMISSIONS`, server-derived tenant, and per-user allowed locations. A new fixed role enum must not
become a parallel authorization catalog. Phase 0 must produce a permission matrix (read, dispatch,
driver review, pricing, finance preparation, finance approval, transfer confirmation, dispute, audit)
and then map personas/roles onto those permissions. Branch and platform-wide scopes must be explicit.

### 7. “Reuse BMS customer UI” is not an authorization specification

BMS customer checkout currently uses a signed, expiring, tenant/order-bound bearer token. The new flow
needs an explicit customer contract for quote creation, delivery creation, tracking, cancellation,
photo visibility and support contact. It must decide whether the checkout token is extended,
a purpose-specific delivery token is issued, or an authenticated customer session is introduced.
Customer-supplied order/tenant ids cannot authorize access.

### 8. The existing React Native app is a POS app

`apps/mobile` uses POS device pairing, cashier PIN/RBAC and server-derived device/location scope. Those
credentials do not identify a delivery driver. The driver app should remain a separate app/package as
v2.3 suggests, with its own identity, device registration, revocation, session, attestation/risk and
offline command model. It must not reuse a POS device token as driver identity.

## P0 blockers to add to the Phase 0 question list

The current Phase 0 questions cover several financial topics, but the following must also be explicit
blocking decisions.

### DLV-P0-01 — Driver network ownership and tenancy

Decide whether drivers are platform-wide, tenant-owned fleet, branch-owned fleet, or a hybrid. Define
who may see/offer/assign each driver and whether a driver may serve multiple tenants in one shift. This
determines RLS, admin scope, pricing, settlement, liability and dispatch fairness.

### DLV-P0-02 — Merchant/tenant/branch/order identity mapping

Define canonical immutable references and lifecycle for BMS `tenant`, `location`, `order`, customer and
Delivery merchant/pickup records. Decide how moved/deactivated branches and deleted/merged customer
identities are represented. Specify whether one delivery can ever contain multiple BMS orders or
multiple merchants; safe MVP default should be one tenant + one branch + one BMS order per delivery.

### DLV-P0-03 — BMS service authentication and authorization

Approve service-principal issuance, audience, operation allowlist, tenant/branch derivation, secret/key
rotation, revocation, rate limits, audit identity, network policy and incident procedure. Admin user
sessions and POS tokens are not acceptable substitutes.

### DLV-P0-04 — Integration event/command contract

Define the authoritative producer and consumer for order-paid, merchant-ready, handoff, cancellation,
refund and delivery-complete signals. Include aggregate version, idempotency identity, body fingerprint,
at-least-once handling, out-of-order policy, replay/backfill, retention and reconciliation source.

### DLV-P0-05 — BMS order/payment/stock transition mapping

Approve the cross-system state matrix, including who may invoke existing BMS services and at which
delivery states. A delivery action must never fork stock, refund or payment rules already owned by BMS.

### DLV-P0-06 — Quote-to-order and money representation contract

Approve quote binding, expiry behavior, shipping-fee mutation path, subsidy accounting, currency,
rounding and exact cross-service serialization. Resolve already-paid repricing before implementation.

### DLV-P0-07 — Customer tracking authority

Approve token/session model, expiry, rotation, cancellation authorization, rate limits, cache headers,
location precision shown to the customer, photo visibility and recovery when a bearer link leaks.

### DLV-P0-08 — Driver identity, verification and account lifecycle

Define minimum verification, legal name/contact handling, licence/vehicle documents, expiry/review,
suspension/deactivation/appeal, device replacement, concurrent sessions and offboarding. Also decide
employment/contractor status, insurance and incident ownership; these cannot be postponed to UI work.

### DLV-P0-09 — Prohibited and regulated goods

Define an allow/deny policy for pharmacy/controlled products, alcohol, tobacco, age-restricted items,
hazardous goods, high-value goods, temperature-controlled food/medicine and oversized items. The BMS
repository contains pharmacy and food workflows, so generic “product eligibility” is insufficient.
Safe MVP default: explicitly exclude every regulated/special-handling class until legal and operational
controls are approved.

### DLV-P0-10 — Legal, tax and accounting ownership

Name decision owners for merchant of record, VAT on delivery/commission, withholding tax, COD receipt
evidence, driver payout evidence, invoice/credit-note ownership, PDPA controller/processor roles, GPS
consent, data subject requests, transport licensing and insurance. “PDPA/legal review” is a gate, not a
requirement with an acceptance result.

### DLV-P0-11 — Delivery failure and cancellation liability matrix

Define time windows and financial/operational effects for customer cancel, merchant cancel, driver
cancel, no driver found, merchant delay, driver no-show, customer unreachable, unsafe drop-off,
damaged/lost goods, partial handoff, post-pickup failure and failed return. Include wait/contact attempt
policy, evidence, stock ownership, refund type and who bears each fee.

### DLV-P0-12 — Production capacity and service objectives

Set pilot and target volumes: tenants, branches, drivers, concurrent jobs, GPS updates/second, quote
rate, dispatch latency, tracking freshness and retention volumes. Define SLOs, alert thresholds,
RPO/RTO, restore target and degraded-mode limits. “Monitor” and “provide RPO/RTO decisions” are not
testable acceptance criteria until values are approved.

## High-priority requirement gaps

These need to be closed before their owning implementation phase, though they need not all block the
first Phase 0 audit pass.

### Dispatch and geography

- Define service-zone precedence, boundary behavior, holes/multipolygons, coordinate system, and
  whether pricing distance uses route distance, billable rounded distance or another snapshot.
- Define offer TTL, sequential/batch sizes, radius steps, maximum search duration, fairness measure,
  driver cooldown and manual-override reason taxonomy.
- Define scheduled delivery, multi-stop, stacked orders and cross-tenant batching as explicitly in or
  out of scope. The safest MVP exclusion is no batching/multi-stop/scheduled delivery unless approved.
- Define pickup/drop-off geocoding confidence, manual pin correction, address-change policy after quote,
  Google data caching/retention constraints and behavior when routing is unavailable.

### Driver app and field safety

- Specify FCM/APNs ownership, token lifecycle, foreground/background/terminated behavior and polling
  fallback; push must be a hint, not assignment authority.
- Define stable idempotency keys and request-body fingerprints for every offline-capable mutation.
- Define lost/stolen device, rooted/jailbroken device policy, clock tampering, mock-location detection,
  impossible travel, GPS permission withdrawal and privacy outside an active delivery.
- Add incident/SOS escalation, crash/road-safety rules, unsafe pickup/drop-off refusal and support
  communication. Avoid exposing personal phone numbers; decide whether contact relay/masking is in MVP.

### Proof, files and privacy

- Define upload protocol (prefer purpose-bound upload grant), decoded-image validation, pixel/dimension
  limits, EXIF/GPS stripping, malware/content review, orphan cleanup and atomic attachment to delivery.
- Define retention periods separately for POD, disputes, KYC, GPS trails, audit and financial records;
  include legal hold and deletion exceptions.
- Define exactly who can view POD/return evidence and whether the customer ever sees the photo.
- Define proof recovery: photo uploaded but confirmation timed out, confirmation arrived before object
  registration, duplicate images, corrupted object and storage outage.

### Finance and settlement

- Define a chart-of-accounts and balanced journal templates for each lifecycle event, not only table
  names. Every entry needs currency, amount, effective/occurred time, source event and reversal link.
- Define payout batch cutoff/timezone, minimum balance, negative balance/COD offset policy, failed
  transfer recovery and uniqueness of external transfer reference.
- Define BMS refund ownership and exactly how Delivery records a reference without pretending an
  external refund succeeded.
- Define dispute/chargeback deadlines, evidence access, adjustment approval and accounting period rules.

### API and data contracts

- Specify idempotency key scope, retention, request fingerprint, response replay, conflict response and
  behavior when the original result is unknown.
- Specify cursor pagination and stable ordering for every large collection; avoid offset-only finance
  and event history.
- Specify error codes and retryability, optimistic version fields, aggregate sequencing and clock
  source. Never encode business rejection only in an English message.
- Add API deprecation/version compatibility policy and contract-test ownership on both sides.
- Define data minimization projections; Delivery should store BMS references and operational snapshots,
  not copy the CRM profile wholesale.

### Admin and operations

- Replace the role list as authorization authority with a permission/action/scope matrix, then map the
  named personas to it.
- Define four-eyes separation that is mandatory, not “where feasible,” for payout preparation,
  approval and transfer confirmation; decide emergency override and audit policy.
- Define support tooling for reconciliation, stuck workflows, replay, duplicate detection and data
  correction through compensating actions. System-health style pages must remain read-only.
- Define report timezone/cutoff, export authorization, row limits, asynchronous generation and retention.
- Define rollout/kill-switch semantics separately for intake, dispatch, GPS, notifications and finance;
  switches must not silently abandon accepted jobs or undrained queues.

### Infrastructure and release

- Decide whether Delivery lives in this repository and CI or a separate repository. The suggested
  `apps/api`/`apps/worker` names are too generic in this BMS repository; use unambiguous names.
- If BMS receives new environment variables, add them to the `web` environment blocks in all three
  BMS compose files as required by repository rules. A separate Delivery compose file does not remove
  that BMS deployment requirement.
- Define production database/Redis/storage topology, encryption/key management, backup ownership,
  migration order across services and rollback compatibility window.
- Add supply-chain scanning, mobile signing/release ownership, SBOM/dependency policy and secrets
  rotation drills to the release checklist.

## Internal inconsistencies or wording to tighten

1. **“Independent delivery MVP” vs “reuse BMS customer UI/Admin.”** Clarify deployment and release
   ownership: independent runtime/data store does not automatically mean independent repository/UI.
2. **“BMS GraphQL and durable events.”** Current BMS GraphQL/realtime does not constitute an approved
   durable integration contract. Mark both as PROPOSED until Phase 0 designs the adapter.
3. **“Admin Dashboard — complete.”** This section is broad feature inventory, not complete acceptance
   criteria. Each page still needs permission, scope, data source, limits, freshness and mutation
   confirmation rules.
4. **“where feasible” separation of duties.** For money movement, define mandatory separation or an
   explicitly approved single-operator pilot exception with limits and audit.
5. **Phase 1 before integration contract.** Phase 1 includes an auth/service skeleton, but Phase 5
   places BMS integration late. Contract and auth decisions must be completed in Phase 0; Phase 5 can
   implement customer/merchant UX after the skeleton is proven.
6. **Phase 6 finance after earlier paid/COD flows.** Phases 2–5 must not accept real COD or create
   money-affecting production states before the ledger and approved policy exist. Use synthetic/shadow
   mode until Phase 6 or move the minimal ledger earlier.
7. **Exact money vs GraphQL Float.** State explicitly that cross-service finance contracts use satang
   integer or decimal string even if existing BMS display fields remain Float for compatibility.

## Recommended Phase 0 deliverables

The prompt lists categories, but naming concrete artifacts makes the gate reviewable:

1. `docs/delivery/phase-0/repository-audit.md`
2. `docs/delivery/phase-0/current-bms-contract-matrix.md`
3. `docs/delivery/phase-0/system-of-record-matrix.md`
4. `docs/delivery/phase-0/cross-system-state-and-compensation-matrix.md`
5. `docs/delivery/phase-0/auth-and-tenant-model.md`
6. `docs/delivery/phase-0/integration-events-and-reconciliation.md`
7. `docs/delivery/phase-0/finance-policy-decisions.md`
8. `docs/delivery/phase-0/data-classification-retention-pdpa.md`
9. `docs/delivery/phase-0/threat-model.md`
10. `docs/delivery/phase-0/erd-proposal.md`
11. `docs/delivery/phase-0/risk-register.md`
12. `docs/delivery/phase-0/test-and-release-strategy.md`
13. ADRs for bounded-context name, deployment/repository layout, service auth, event integration,
    driver-pool tenancy, money representation and customer tracking authority.

Every artifact should label each statement `VERIFIED`, `PROPOSED`, `ASSUMED`, or `UNRESOLVED`, cite
the source file/contract it was derived from, and assign an owner plus due gate to each unresolved
decision.

## Definition of “requirement complete enough for Phase 1”

Approve Phase 1 only when all of the following are true:

- DLV-P0-01 through DLV-P0-12 have an approved decision or an explicit MVP exclusion.
- The system-of-record and cross-system state/compensation matrices have no ambiguous writer for
  order, stock, payment, delivery evidence, refund, ledger or payout state.
- Service authentication, tenant/branch derivation and customer tracking authorization are specified
  with negative authorization tests.
- Exact-money serialization and quote-to-order binding are approved.
- The integration event/reconciliation contract does not rely on BMS realtime invalidation payloads as
  business truth.
- Regulated goods, driver legal/verification scope and launch geography have approved safe boundaries.
- Pilot scale, SLO, retention, RPO/RTO and rollout/kill-switch behavior have measurable values.
- Phase 1 repository/deployment layout and CI ownership are approved.
- The BMS changes needed for the adapter are identified and separately approved before modification.

Until then, Phase 0 may proceed, but implementation should remain blocked.
