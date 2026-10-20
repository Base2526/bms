# Fleet Delivery Phase 0 decision register

Status: **AUTHORIZED FOR PHASE 1 FOUNDATION — 2026-10-18**

Audit date: 2026-10-18 (Asia/Bangkok)

Working bounded-context name: `fleet-delivery`

The user's explicit instruction `เริ่มทำได้เลย` on 2026-10-18 authorizes Phase 1 foundation work
under the safe defaults and exclusions in this register. It does not represent Legal, Tax, DPO,
Finance, Safety, or Operations approval for the later real-user/real-money capabilities; those
capabilities remain unreachable until their named owners approve them.

This directory is the Phase 0 output required by
[`BMS_Delivery_Master_Prompt_v2.4.md`](../../BMS_Delivery_Master_Prompt_v2.4.md). No application,
migration, credential, external resource, or production integration was created. In every table, the
`Evidence` value applies to the entire row.

## Gate summary

| Gate | Evidence | Result |
| --- | --- | --- |
| Repository and BMS contract audited | `VERIFIED` | Complete for the checked-in repository; external provider/legal facts remain outside repository evidence. |
| System-of-record has one writer per field/action | `VERIFIED` | Architecture accepted for Phase 1; later business writers remain gated. |
| Cross-system state and compensation has no ambiguous writer | `VERIFIED` | Architecture accepted for Phase 1; no cross-system business action exists yet. |
| Exact money, service auth, durable event, and customer token contracts approved | `VERIFIED` | ADRs accepted as architectural constraints; production parameters remain gated. |
| All 20 blocking decisions approved or excluded | `VERIFIED` | Safe defaults are accepted for Phase 1; unreachable later capabilities retain named-owner gates. |
| Pilot scale, SLO, retention, RPO/RTO measurable and approved | `PROPOSED` | Candidate values are accepted only as synthetic test inputs; production approval remains required. |

## Blocking decisions

| # | Decision | Evidence | Safe default / recommendation | Owner | Blocks |
| ---: | --- | --- | --- | --- | --- |
| 1 | Driver network ownership and tenancy | `UNRESOLVED` | Pilot with tenant-and-branch-authorized fleets only; one driver cannot serve another tenant in the same shift. | Product + Legal + Operations | Phase 3 |
| 2 | Canonical identity mapping | `PROPOSED` | BMS IDs are immutable external references; Delivery uses its own IDs and preserves merge/deactivation history. | BMS architecture + Delivery architecture | Phase 1 |
| 3 | Service authentication | `UNRESOLVED` | Dedicated short-lived asymmetric service JWT; BMS derives scope from server-side mapping. | Security + Platform | Phase 1 |
| 4 | Integration event/command contract | `UNRESOLVED` | Transactional outbox/inbox, at-least-once, aggregate versions, snapshot reconciliation. | BMS + Delivery architecture | Phase 1 |
| 5 | BMS lifecycle mapping | `UNRESOLVED` | Payment and commerce transitions remain BMS-owned; physical pickup cannot occur until the BMS handoff command commits. | Commerce + Operations | Phase 2/5 |
| 6 | Quote-to-order binding | `UNRESOLVED` | Delivery quote is authoritative for fare; BMS atomically validates/binds exact fee only while eligible and unpaid. | Commerce + Finance | Phase 2/5 |
| 7 | Customer tracking authorization | `UNRESOLVED` | New purpose-bound revocable tracking token; never reuse checkout token as tracking authority. | Security + Product + Privacy | Phase 5 |
| 8 | Driver identity and verification | `UNRESOLVED` | Separate driver identity, one active device session, manual document review, immediate suspension/revocation. | Operations + Security + Legal | Phase 3 |
| 9 | Driver commercial/legal status | `UNRESOLVED` | Exclude real drivers and public launch; synthetic pilot only until approved. | Legal + HR/Operations | Phase 3/launch |
| 10 | Driver earning formula | `UNRESOLVED` | Shadow ledger only; no payable earning or payout. | Finance + Legal + Product | Phase 6 |
| 11 | COD | `UNRESOLVED` | Excluded from Phases 1–5 and disabled at runtime. | Finance + Operations + Legal | Phase 6 |
| 12 | Merchant of record and tax | `UNRESOLVED` | No settlement or tax documents from Delivery; BMS remains merchandise authority. | Finance + Tax counsel | Phase 6 |
| 13 | Cancellation/failure liability | `UNRESOLVED` | Pre-pickup cancellations only; post-pickup failure always returns for human review, with no automatic refund/liability verdict. | Product + Legal + Operations | Phase 2/5 |
| 14 | Merchant readiness | `UNRESOLVED` | Explicit merchant-ready command while BMS order remains `PACKING`; bag/seal count required at handoff. | Retail + Restaurant Operations | Phase 2/5 |
| 15 | Proof and retention | `UNRESOLVED` | Private evidence; collect minimum data; no customer POD access; deletion is suspended by legal hold. | DPO/Legal + Security | Phase 4/8 |
| 16 | Support/contact policy | `UNRESOLVED` | No direct phone disclosure; in-app masked relay is not built until policy and escalation owner exist. | Support + Safety + Legal | Phase 4/7 |
| 17 | Service area and dispatch policy | `UNRESOLVED` | One approved pilot zone, one vehicle class, sequential offers, bounded radius expansion, manual fallback. | Operations + Product | Phase 2/3 |
| 18 | Production objectives | `UNRESOLVED` | Synthetic load only; candidate SLO/RPO/RTO must be measured and approved before production. | SRE/Operations + Product | Phase 1/8 |
| 19 | Repository/deployment ownership | `UNRESOLVED` | Same monorepo, separately deployable services and isolated data stores. | Engineering leadership + DevOps | Phase 1 |
| 20 | Admin placement | `UNRESOLVED` | BMS Admin for tenant merchant actions; separate fleet-ops surface for platform/driver/finance actions. | Product + Security + Operations | Phase 7 |

No row above is a business approval. An owner must record approval, exclusion, approver, date, and
the applicable ADR/matrix change before its gate can close.

Every subordinate `UNRESOLVED` item in the Phase 0 documents maps to the closest numbered decision
above and inherits its owner and blocking phase unless a stricter owner/gate is stated locally.

## Decision options and principal risks

| # | Options considered | Principal risk if chosen incorrectly | Evidence |
| ---: | --- | --- | --- |
| 1 | Platform pool / merchant fleet / branch fleet / hybrid | Cross-tenant disclosure, unclear employer/liability and wrong dispatch scope | `UNRESOLVED` |
| 2 | BMS ids as Delivery primary keys / internal ids plus immutable external refs | Merge/deactivation can corrupt history or orphan jobs | `PROPOSED` internal ids + refs |
| 3 | Static key / symmetric JWT / asymmetric JWT / mTLS plus token | Credential reuse, weak rotation, caller-controlled scope | `PROPOSED` asymmetric JWT; mTLS unresolved |
| 4 | Realtime / HTTP outbox-inbox / managed broker | Lost/duplicated/out-of-order facts or coupled releases | `PROPOSED` transport-neutral outbox/inbox |
| 5 | Delivery drives BMS / BMS drives all / mapped dual state | Double stock/payment transitions and ambiguous compensation | `PROPOSED` mapped ownership |
| 6 | Client fee / BMS-calculated fee / Delivery quote bound by BMS | Paid order amount drift and non-reproducible pricing | `PROPOSED` Delivery quote + atomic BMS bind |
| 7 | Checkout bearer / authenticated session / new tracking grant | Leaked link gains excess authority or cannot be revoked | `PROPOSED` new purpose grant |
| 8 | Reuse BMS identity / Delivery identity with manual or vendor KYC | Account takeover, unverified/expired driver and unsafe device recovery | `UNRESOLVED` |
| 9 | Employee / contractor / merchant-employed fleet | Labour, insurance, tax and accident responsibility | `UNRESOLVED`; no real launch |
| 10 | Fixed / distance / time / composite earning | Under/overpayment, tax and historical recalculation | `UNRESOLVED`; shadow only |
| 11 | No COD / merchandise / fee / both | Theft, shortage, refund and unbounded driver debt | `UNRESOLVED`; disabled |
| 12 | Merchant / Delivery / split merchant of record | Wrong VAT, withholding, invoice and credit-note issuer | `UNRESOLVED`; Delivery issues nothing |
| 13 | Automated fee table / human review / insurance process | Wrong cancellation/refund/liability result | `UNRESOLVED`; human return review |
| 14 | BMS pack implies ready / explicit ready / driver arrival implies ready | Premature dispatch/handoff and restaurant delay | `PROPOSED` explicit ready |
| 15 | Short operational / statutory / indefinite retention | PDPA breach or destroyed legal evidence | `UNRESOLVED`; minimum private collection |
| 16 | Direct phone / masked relay / in-app support only | Harassment, PII exposure, no emergency response | `UNRESOLVED`; no direct disclosure |
| 17 | Fixed zone / geofence / route-based and sequential / batch offers | Unsafe route, unfair dispatch, cost/latency spiral | `UNRESOLVED`; one pilot zone/sequential |
| 18 | Best effort / explicit pilot and target objectives | Untestable reliability and unknown capacity/recovery | `UNRESOLVED`; synthetic candidate targets |
| 19 | Same repo / separate repo; shared / isolated infrastructure | Release coupling, trust-boundary and runtime mismatch | `PROPOSED` same repo + isolated deploy/data |
| 20 | BMS Admin / Delivery Admin / split surfaces | Tenant/platform privilege escalation and finance SoD failure | `PROPOSED` split merchant/fleet surfaces |

## Phase 0 completion report

1. `VERIFIED`: objective completed was repository audit and Phase 0 design only. Checked-in BMS
   services/migrations/schema are the evidence baseline; no external policy/provider claim was
   treated as fact.
2. `VERIFIED`: eight ADRs record bounded context, repository/deploy, driver tenancy, service auth,
   durable integration, exact money, customer tracking and Admin placement. They were accepted as
   architecture/safe constraints by the explicit Phase 1 start instruction.
3. `VERIFIED`: changed files are the three master-prompt/review documents and the 21 files in this
   directory. No application, migration, schema, credential or infrastructure file was changed.
4. `PROPOSED`: required future BMS contracts are listed in
   `current-bms-contract-matrix.md`; compatibility is additive and requires schema export/tests.
5. `VERIFIED`: documentation checks run were `git diff --check`, required-file/decision inventory,
   repository-source citation existence, and local Markdown-link target validation. Application gate,
   DB, mobile, browser and live integration tests were not run because there is no implementation.
6. `VERIFIED`: tenant/auth/money/stock/privacy invariants were traced to current source; proposed
   controls prohibit client-selected authority, direct cross-DB writes and realtime-as-business-truth.
7. `UNRESOLVED`: the risk register identifies legal/tax/COD/liability/retention/SLO and technical
   blockers; `RTK.md` is missing from the checkout.
8. `VERIFIED`: safe defaults/exclusions authorize Phase 1. Named Legal/Tax/DPO/Finance/Safety/
   Operations approvals remain mandatory before their later capabilities become reachable.
9. `PROPOSED`: there is no Phase 0 rollout/rollback. Phase 1 remains disabled until its minimum ADRs/
   decisions are approved; its proposed scope is below.
10. **Phase 1 foundation authorized on 2026-10-18.**

## Phase 1 scope proposed after approval

- `PROPOSED`: create only the approved repository layout, contract packages, TypeScript build/test
  harness, Delivery PostgreSQL/PostGIS + Redis development infrastructure, API/worker liveness and
  readiness, migration runner, and synthetic fixtures.
- `PROPOSED`: implement the service-auth verifier skeleton and negative tests without minting a real
  production credential.
- `PROPOSED`: implement generic Delivery outbox/inbox/idempotency primitives and consumer/provider
  contract tests without connecting to live BMS, Google, storage, push, payments, or users.
- `PROPOSED`: keep COD, payouts, real commission, real notifications, customer tracking, BMS writes,
  driver onboarding, and production deployment disabled and out of Phase 1.

## Authorization applied to Phase 1

All eight ADRs and safe Phase 1 defaults were accepted by the explicit start instruction. Later
capabilities whose business/legal owner has not approved them are excluded from the executable
surface, and tests must continue to prove they cannot be reached; merely implementing scaffolding
does not authorize them.

**Phase 1 foundation authorized; later decision gates remain enforced.**
