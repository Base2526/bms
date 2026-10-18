# Risk register

Scores use likelihood (`L`) and impact (`I`) from 1–5; score is `L x I`. No high risk is accepted by
this document. Each Evidence label applies to the whole row.

| ID | Risk | L | I | Score | Mitigation / safe default | Owner | Gate | Evidence |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| R-01 | Cross-tenant/order IDOR through new adapter | 3 | 5 | 15 | Server mapping, object scope, fail-closed tenant resolver, denial matrix | Security + BMS | Phase 1/5 | `PROPOSED` |
| R-02 | Admin/POS token reused as service/driver credential | 3 | 5 | 15 | Separate principals and audience; negative tests | Security | Phase 1/3 | `VERIFIED` gap |
| R-03 | Legacy GraphQL `Float` corrupts exact boundary | 4 | 5 | 20 | Add satang/decimal-string contract; reject noncanonical input | Finance + BMS | Phase 1/2/5 | `VERIFIED` gap |
| R-04 | Realtime hint mistaken for durable event | 3 | 5 | 15 | Separate outbox/inbox/version/reconcile contract | Architecture | Phase 1/5 | `VERIFIED` gap |
| R-05 | Handoff advances Delivery but not BMS stock/order | 3 | 5 | 15 | BMS commit before physical handoff; same-key retry and reconciliation | BMS + Operations | Phase 5 | `PROPOSED` |
| R-06 | BMS shipped but Delivery misses pickup event | 3 | 4 | 12 | Durable BMS outbox, inbox replay, snapshot reconciliation | SRE + BMS | Phase 5 | `PROPOSED` |
| R-07 | Duplicate assignment under concurrent accepts | 4 | 4 | 16 | DB uniqueness/version lock; 100-way concurrency test | Delivery backend | Phase 3 | `VERIFIED` synthetic control |
| R-08 | Stale/forged GPS harms dispatch/customer trust | 4 | 4 | 16 | Freshness/accuracy/sequence, stale labels, plausibility, review | Safety + Security | Phase 3/4 | `VERIFIED` synthetic filter; real-device risk unresolved |
| R-09 | Checkout token reused or tracking link leaked | 3 | 5 | 15 | Separate purpose grant, revocation/rotation, no-store/rate limit | Security + Privacy | Phase 5 | `VERIFIED` gap |
| R-10 | POD/KYC/object storage leak | 3 | 5 | 15 | Private purpose route, short URL, evidence permission, audit | Security + DPO | Phase 4/8 | `PROPOSED` |
| R-11 | COD theft/shortage or unbounded driver debt | 4 | 5 | 20 | COD disabled until custody/debt/reconcile policy + ledger | Finance + Legal | Phase 6 | `UNRESOLVED` |
| R-12 | Duplicate/unauthorized payout | 3 | 5 | 15 | Ledger allocation uniqueness, prepare/approve/confirm SoD | Finance + Security | Phase 6 | `UNRESOLVED` |
| R-13 | Wrong VAT/withholding/MOR treatment | 4 | 5 | 20 | No real finance/tax docs until written tax approval | Tax counsel | Phase 6/launch | `UNRESOLVED` |
| R-14 | Driver employment/insurance/safety exposure | 4 | 5 | 20 | Synthetic pilot; no real onboarding/launch until legal approval | Legal + Operations | Phase 3/launch | `UNRESOLVED` |
| R-15 | Liability/refund disagreement after pickup | 4 | 5 | 20 | Return + human review; no automatic verdict/refund | Product + Legal | Phase 5/6 | `UNRESOLVED` |
| R-16 | Unbounded PII/GPS/evidence retention | 4 | 5 | 20 | Collection windows, partitions/deletion, legal hold, DPO schedule | DPO | Phase 4/8 | `UNRESOLVED` |
| R-17 | Google outage/cost creates fake fare/ETA | 3 | 4 | 12 | Adapter, quota/budget, `QUOTE_UNAVAILABLE`, no fallback claim | Product + SRE | Phase 2/8 | `PROPOSED` |
| R-18 | Queue grows while consumer disabled | 3 | 4 | 12 | Independent production/consumption switches, age alerts, drain plan | SRE | Phase 1/8 | `PROPOSED` |
| R-19 | Node/runtime/package mismatch in monorepo | 3 | 3 | 9 | Approve runtime baseline and contract package targets | Engineering | Phase 1 | `VERIFIED` gap |
| R-20 | PostGIS/Delivery infra accidentally shares BMS trust/data | 3 | 4 | 12 | Separate DB/Redis/storage roles/network/backup | DevOps + Security | Phase 1/8 | `PROPOSED` |
| R-21 | Existing `/api/bms/delivery/*` collision changes provider integration | 3 | 4 | 12 | Distinct `fleet-delivery` namespace and permission/event families | BMS architecture | Phase 1/5 | `VERIFIED` gap |
| R-22 | Missing `RTK.md` contains unobserved project rules | 2 | 4 | 8 | Restore/provide file and re-audit before Phase 1 edits | Repository owner | Phase 1 | `VERIFIED` gap |
| R-23 | No approved SLO/scale/RPO/RTO makes release untestable | 4 | 4 | 16 | Approve measurable targets and perform load/restore drills | SRE + Product | Phase 1/8 | `UNRESOLVED` |
| R-24 | Admin surface collapses tenant/platform/finance duties | 3 | 5 | 15 | Split merchant/fleet surfaces or prove scope + SoD | Product + Security | Phase 7 | `UNRESOLVED` |

## Escalation rule

- `PROPOSED`: score 15–25 blocks its owning phase unless mitigated and verified or explicitly
  accepted by the named business/security/legal owner with expiry and compensating controls.
- `PROPOSED`: new evidence updates likelihood/impact and links tests/incidents; risks are never closed
  solely because implementation exists.
- `UNRESOLVED`: Engineering leadership must name the risk-acceptance authority and review cadence.

**STOP — Awaiting approval.**
