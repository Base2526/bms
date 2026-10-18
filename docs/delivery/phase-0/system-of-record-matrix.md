# System-of-record matrix

Every row has one authoritative writer. Replicas are purpose-limited snapshots with source id,
source version/observed time, retention and reconciliation metadata. Each Evidence label applies to
the whole row.

| Data or action | Authority / only writer | Other system may retain or request | Forbidden shortcut | Evidence |
| --- | --- | --- | --- | --- |
| Tenant, merchant and branch identity/status | BMS | Delivery external reference plus operational snapshot | Client-selected tenant; Delivery creating BMS branches | `VERIFIED` |
| Branch pickup address/hours | BMS | Delivery versioned pickup snapshot for active jobs | Treating stale snapshot as current without label/reconcile | `PROPOSED` |
| Customer CRM identity and merge | BMS | Opaque customer ref and minimum recipient snapshot | Copying full CRM or Delivery merging customers | `VERIFIED` |
| Recipient name/contact/drop-off instructions | BMS at order bind; correction policy pending | Delivery encrypted purpose-bound snapshot | Writing changes back to CRM without BMS service; indefinite reuse | `PROPOSED` |
| Catalog/item/regulated-product eligibility | BMS | Eligibility verdict, version and safe reason code | Delivery inspecting SKU text or silently dropping an item | `PROPOSED` |
| Merchandise lines, prices, discount and tax | BMS | Exact read-only references/snapshot needed for reconciliation | Delivery repricing merchandise or issuing tax docs | `VERIFIED` |
| BMS order lifecycle and version | BMS | Delivery observes version and requests approved commands | Delivery direct SQL or local invented BMS state | `VERIFIED` |
| Inventory/reservation/movement | BMS | Delivery observes handoff result/version only | Parallel stock ledger or decrement on driver action alone | `VERIFIED` |
| BMS payment/refund/tax-document state | BMS | Delivery observes minimal status/version | Driver/customer asserting paid/refunded; Delivery tax docs | `VERIFIED` |
| Shipping fee field on BMS order | BMS | Delivery submits one approved exact quote to bind | Delivery direct write or client-calculated fee | `PROPOSED` |
| Route and Delivery quote/fare snapshot | Delivery | BMS stores bound quote id/version/exact amount/source | BMS recalculating historical fare from current rules | `PROPOSED` |
| Delivery aggregate and last-mile state | Delivery | BMS observes projection/version | BMS UI locally advancing Delivery state | `PROPOSED` |
| Dispatch offers/assignment/policy evidence | Delivery | BMS receives public operational projection if needed | Redis-only assignment or client-won race | `PROPOSED` |
| Driver identity/profile/verification/device/session | Delivery | BMS stores opaque driver/assignment display refs only | Reusing BMS admin, customer or POS identity | `PROPOSED` |
| Driver availability and location | Delivery | BMS receives coarsened active-job projection only if approved | BMS storing raw continuous GPS; client timestamp as truth | `PROPOSED` |
| POD/failed-delivery/return evidence | Delivery | BMS stores private evidence reference/status | Public URL; image as automatic verdict | `PROPOSED` |
| Customer tracking projection | Delivery | BMS UI renders signed response | Raw driver GPS/contact, cross-tenant lookup | `PROPOSED` |
| Delivery notifications and delivery attempts | Delivery | BMS may retain correlation/result reference | Generic realtime hint as send receipt | `PROPOSED` |
| Merchandise notification/email | BMS | Delivery observes safe status when relevant | Delivery emailing BMS commerce claims | `VERIFIED` |
| Delivery commission, earnings, COD, settlement and payout journals | Delivery | BMS stores reconciled summary/reference after policy approval | Mutable balance totals without posted journal | `PROPOSED` |
| Merchant merchandise revenue, receivable and tax | BMS | Delivery stores reference needed for split reconciliation | Delivery acting as merchant ledger | `VERIFIED` |
| Service credentials/key metadata | Issuing security platform | Each service stores verifier configuration/key id only | Shared admin JWT or long-lived literal secret | `PROPOSED` |
| Durable producer event | Producing aggregate's system | Consumer inbox retains envelope/hash/result | Consumer editing producer history | `PROPOSED` |
| Reconciliation result | Reconciler records comparison; source systems keep truth | Both systems retain correlation and outcome | Silent overwrite to make totals match | `PROPOSED` |
| Audit for a local mutation | System performing mutation | Other system stores correlation/reference | Cross-service audit row replacing local atomic audit | `PROPOSED` |

## Replication contract

- `PROPOSED`: every snapshot records `source_system`, `source_id`, `source_version` or
  `observed_at`, `purpose`, `retain_until`/policy key, and `last_reconciled_at`.
- `PROPOSED`: missing or out-of-order data becomes `UNKNOWN`/`RECONCILIATION_REQUIRED`; it never
  implies cancellation, refund, readiness, payment or delivery.
- `PROPOSED`: a customer merge changes future BMS resolution; historical Delivery records retain the
  original opaque source reference and receive a merge/supersession link, not destructive rewrite.
- `PROPOSED`: branch deactivation prevents new quotes/jobs but does not erase or reassign accepted
  deliveries; Operations must drain or explicitly transfer them.
- `UNRESOLVED`: Legal must approve which identity snapshots survive data-subject deletion versus
  finance/audit/legal-hold obligations.

**STOP — Awaiting approval.**
