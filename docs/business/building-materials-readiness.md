# Building-material shop readiness — 2026-11-19

Observed local checks and external gates: [release evidence](building-materials-release-evidence-2026-11-19.md).

This is a source and test inventory, not a production availability claim. The starter
`building_materials` archetype only changes guidance and navigation emphasis.

The public Learning Center pilot is `/learn/building-materials`, with bilingual lessons and a
narrated flow. The operator source is [คู่มือร้านวัสดุก่อสร้าง](../คู่มือร้านวัสดุก่อสร้าง.md), with a
matching Word copy and an in-app summary at `/admin/manual/building-materials`. These are
instructions for the current working tree, not evidence that the missing workflows or
production migrations are complete.

| Scope | Current evidence | Gap / release decision |
| --- | --- | --- |
| A. Catalog, units, stock | `productPacks.ts`, `orders.ts`, `9.51` variants/surfaces, `10.135` technical specs, `bms_inventory` integer base units; `price-tiers-db-contract`, `product-technical-specs-db-contract` | Bag/pallet conversions are explicit packs. Physically distinct paint sizes require separate variants/SKUs and separate counted stock; do not invent breakable packs. Published sourced length/grade/standard/usage facts are a pilot; spec import, unit model across all channels and return coverage remain unverified. |
| B. Weighed and cut | `pos.ts` handles verified prefix 22 scale labels; `10.136` and `weightedKgPricing.ts` add exact VAT-inclusive per-kg rates for gram-counted retail labels, per-label satang rounding, snapshot and frozen return allocation; DB/preview contracts pass on throwaway. | Per-meter price and source-roll cut ledger, kept scrap/waste, lot cost, actual POS return and hardware cycle are missing. Web/customer AI sales of configured rates are refused. Do not accept fractional `bms_inventory` units through UI. |
| C. Quotation and customer price | `documents.ts` rejects invalid whole estimates; migration `10.133`, `salesQuotations.ts`, REST, admin UI, `sales-quotations-db-contract` | Persisted versioned VAT-inclusive quote and price-preserving order conversion are a pilot. Actual customer delivery of the document, PDF layout, formal acceptance proof format and accountant review are external gates. |
| D. POS, credit, VAT | `pos.ts`, `ar.ts`, `taxDocuments.ts`; `getArStatement()` reads invoice balances, overdue amounts, recent ledger activity and mismatch evidence in one SQL snapshot for staff, with no customer send. | Existing catalog price contract is VAT-inclusive. No complete VAT-exclusive B2B contract across every channel. Dunning/customer delivery of statements and the full matrix of new measured/cut units still need implementation and test. |
| E. Heavy multi-trip delivery | `10.134`, `orders.ts`, `shipping.ts`: quote site snapshot and separate retail pickup handover | Delivery still ships the whole order; line-level reservation/delivery/return ledger, vehicle/driver/load constraints and proof of delivery are not implemented. Free-text quote sites are rejected by carrier booking. No carrier/provider is claimed live. |
| F. Procurement/AP | `purchase.ts` supports PO and partial receiving; `10.137` freezes sourced supplier-package factors on a PO and rechecks integer package/base counts at receipt; supplier mapping and landed cost exist | Supplier invoice-priced fractional base cost, supplier return and AP three-way match/payment ledger are missing. Expense evidence is not AP. |
| G. AI, chat, web | `tools/catalog.ts`, `pipeline.ts`, signed checkout and server cart | Staff quote tool remains a provisional estimate; customer AI cannot approve quotes or promise engineering safety, lifting or delivery slots. New quote workflow has no AI tool yet. Web/new-unit end-to-end test remains outstanding. |

## Quote slice contract and safe defaults

- **State:** Draft does not hold goods; independent approval freezes VAT-inclusive prices;
  staff records sent and accepted states; acceptance stores an evidence reference. A revision
  supersedes but does not overwrite prior evidence. Expiry rejects approval/acceptance/conversion.
- **Money and tax:** Each quote line stores an exact satang `line_amount`; shipping unknown makes
  total unknown. Approval snapshots the shop's VAT settings and rejects unknown product VAT
  categories. Conversion requires the same tax settings and exact payable total. The order's
  `line_amount` remains monetary authority; tax documents issue only through existing services.
- **Stock:** Quote writes no inventory or movement. Conversion invokes the existing order service
  in one tenant transaction, which rechecks available stock and reserves integer base units.
- **Fulfillment:** Delivery requires a nonempty site before approval and snapshots it to the order;
  it never silently falls back to the customer's default address. Retail pickup has a distinct
  confirmed handover that consumes stock once and creates no kitchen ticket. Quote sites cannot
  book an automated carrier with unstructured address data. Both flows remain whole-order only.
- **Permissions:** Separate `quotation.view/create/approve/send/accept/convert`; branch access
  checked by the service. The preparer cannot approve the same revision. UI confirms the
  server-fetched document before every state transition.
- **Failure and retry:** Draft request key plus hash rejects changed retries. State repeats return
  the same result. Conversion locks the quote, rolls back failed stock/pricing checks and returns
  the same order id on retry. No customer messages or provider calls occur in this flow.

## Weighed-kilogram pilot contract (`10.136`)

- **Units:** Stock and returns remain integer grams. A physical prefix-22 label is one selling
  unit; the price basis is 1,000 grams (one kilogram). The current register shows grams as the
  quantity. Prefix-21 price labels remain unsupported.
- **Price and tax:** A Manager publishes a decimal-string, VAT-inclusive baht/kg rate for one
  active variant. Published revisions are preserved. The server re-parses every label at order
  commit, matches its five-digit code/variant and sums rounded satang per physical label.
  `bms_order_items.line_amount` is the authority; the rate, basis, labels and rounding rule are
  frozen in `pricing_snapshot`. Receipt history uses `line_amount`, not rounded unit price times
  grams. VAT document layout still requires accountant review.
- **Stock and money:** A sale uses exact label grams through existing POS stock, PIN, permission
  and payment machinery. A partial return allocates the original frozen line amount by grams
  with a final remainder; it never reads a new catalog rate. The full POS refund workflow still
  needs a real pilot.
- **Channel and failure:** Publication refuses every enabled non-retail sales surface, including
  restaurant POS, web/storefront and customer AI.
  Subsequent edits through both sales-surface services also refuse to enable those channels,
  and a published rate locks its weighted-gram scale mapping until a reviewed withdrawal
  workflow exists.
  Quotations refuse measured-rate lines. Online orders and unlabeled POS orders cannot use a
  published rate. A malformed/mismatched label fails the entire order. Publication uses a
  request key/hash, product lock, tenant transaction and audit; a changed retry conflicts.
- **Open gates:** No cut-to-length or per-meter workflow, weighing hardware test, authenticated
  POS browser test, multi-payment/credit/return/tax matrix or production deployment proof.

## Supplier package receiving pilot contract (`10.137`)

- **State and units:** A new PO line freezes supplier package name, ordered package count,
  integer base units per package and staff-entered source reference. The PO starts `OPEN`,
  becomes `PARTIAL` after an incomplete receipt and `RECEIVED` when all base units arrive.
  Legacy lines have no package snapshot. The source reference needs real
  supplier verification before a store uses the factor.
- **Money and tax:** Unit cost and any allocated inbound cost remain per base unit in the
  existing PO contract. An unknown cost rejects a converted line instead of becoming zero;
  an explicit zero remains a distinct staff input. The conversion changes quantities, not money or input VAT. It does
  not create an AP invoice, payable or tax claim.
- **Stock and permissions:** Creating a PO moves no stock. Receipt supplies both package
  count and base quantity; the service checks their product against the frozen factor while
  holding the PO lock. The existing receiving transaction writes inventory, lots, movements,
  audit and retry evidence together. POS receives into its device branch. Staff receiving checks
  the actor's allowed branches inside the same transaction. Admin lists only active permitted
  receiving branches, requires a selection when several are available, and binds the chosen
  branch to the retry payload. An unauthorized branch returns `BRANCH_FORBIDDEN` before stock.
  A package mismatch writes none.
- **Failure and retry:** Package evidence and a stable create key are required for a
  converted line. Every staff REST/GraphQL receipt requires a stable key before reaching the
  service, including legacy base-unit lines; converted lines also require it in the service.
  Those keys bind the package data,
  so a changed retry conflicts and a committed
  retry returns the same PO/receipt result. The web and mobile forms derive a base preview
  from the entered package count; only the server accepts a stock quantity. The web creator
  binds an unresolved request to the server-returned tenant and user and refuses a create
  when it cannot persist the retry key. Unknown supplier
  invoice cost, broken packages and supplier returns need separate workflows.

## Release gates still open

The quote workflow needs a browser pass at desktop/mobile widths, actual staff role/branch
review, accountant document review and a real-shop pilot. The broader building-material scope
needs the missing services and DB tests listed above. Neither a passing pure suite nor the
2026-11-17 clone check proves production deployment.

## Remaining implementation order

1. **Units and cut work:** Keep base stock integer. Freeze the selling unit, pricing basis,
   verified decimal rate and single satang-rounding rule per line. A cut job needs a locked
   source roll/lot, requested output, kept remnant and waste quantities whose integer sum
   exactly equals input. Post all source/output/waste movements and cost allocation in one
   tenant transaction with a stable key and actor audit. A returned cut piece goes to review,
   not available stock. Reject unknown source lots and unsupported cutter/barcode formats.
2. **Line-level delivery:** Introduce a tenant/branch-scoped fulfillment ledger before changing
   `shipOrder()` or `createShipment()`. Derive ordered/reserved/dispatched/delivered/returned
   quantities per line from committed records; a trip key can dispatch each quantity once.
   Vehicle, driver, load limits, site, appointment, approved lifting/forklift charges and POD
   belong to the trip, with failed delivery as an explicit state. Test cancellation, credit,
   tax, returns, reporting and retries while part of an order is still reserved. Keep carrier
   adapters pilot-only without real contracts.
3. **Procurement and payables:** The `10.137` PO snapshot and partial-receipt conversion need
   real supplier label/invoice and branch pilot validation. Add supplier return and an AP ledger
   with separate PO/receipt/invoice/payment evidence and
   inbound freight allocation. Do not infer a payable from expense evidence or claim input
   VAT without the valid tax invoice workflow. Run branch/tenant, duplicate and rollback DB
   tests before wiring screens.
4. **AI, web and release:** Add staff tools only after the services exist, through the approved
   catalog with permission, argument validation, server tenant and audit. Customer chat and
   checkout must read published rates/specs and explain unknown freight or compatibility.
   Run the cement/pallet, distinct paint sizes, serial tool, sand, cable cut, revised quote,
   contractor credit, partial PO, multi-trip, partial return and VAT scenarios end to end.
   Obtain shop, accountant, provider and hardware sign-off before changing PILOT status.
