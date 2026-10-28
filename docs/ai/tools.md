# AI Tool Catalog

Customer evidence (`10.53`): every actual `customerTools()` entry must have an explicit projection
policy in `customerAnswerEvidence.ts`. The registry contract test checks factory-created tools
too. This records safe result snapshots for QA, not raw args in `ai.tool_call`; no new AI tool or
permission is introduced. Unknown/new tools fail closed to metadata-only PARTIAL capture until
their policy is reviewed. See [quality.md](quality.md) for bounds and privacy limitations.

> Entry point: [CLAUDE.md](../../CLAUDE.md) · AI pipeline: [workflow.md](workflow.md) · Prompts/guardrails: [prompts.md](prompts.md)

The **authoritative AI registry** is the snake_case matrix below and
[`lib/bms/tools/catalog.ts`](../../apps/web/lib/bms/tools/catalog.ts). Later camelCase sections also
document backend/service capabilities; a service listed there is not exposed to AI unless it is in
the authoritative registry. AI MUST call only registered tools.

## Wiring status (2026-07 — AI tool-calling)

### Contextual customer choices

`present_customer_choices` is a customer-only, non-mutating presentation tool. It takes one
question (up to 300 characters) and 2-8 distinct short labels (up to 120 characters each).
Use after verified reads for product, variant, branch, fulfillment, configured payment or yes/no
choices. The pipeline renders and persists the menu; a selected label is a customer answer, never
permission to execute a sensitive mutation. Order/booking confirmations and pharmacy intake use
their dedicated server summaries. Staff confirmation continues through the existing permission-gated UI.

### Board-game chat requests (`10.48`)

| Tool | Customer permission | Authority and result |
| --- | --- | --- |
| `request_board_game_reservation` | `order.create` | Board-game archetype only. Branch name, branch-local date/time, duration 30–720 minutes, party 1–500 and non-contact note ≤300 characters. First call is a read-only preview, never an insert. Pipeline saves a 15-minute fingerprint and displays its own summary. Exact latest-summary consent is server-only in ExecCtx; changed fields/config require confirmation again. Inserts CHAT/REQUESTED only, using CRM name/phone and a server retry key. |
| `get_board_game_reservation_status` | `order.view` | No arguments. Latest five CHAT requests of the channel-derived CRM customer, scoped to the acting tenant. Short reference, branch/time/timezone, party, duration, status and bounded rejection reason; no table, staff or customer identity. Pipeline composes the reply. |
| `get_board_game_availability` | Read | `booking.canSubmitViaChat = bookingEnabled && reservationDepositPolicy === 'NONE'`; directory listing is independent. May return opt-in area/floor and capacity-grouped counts, never table numbers or occupants. Current free tables are not future availability. |

Contact completeness uses `get_customer_checkout`; missing name/phone use the existing
`save_customer_checkout_details`. Neither customer/tenant IDs nor a confirmation flag are model
arguments. Booking-disabled/deposit branches return typed business rejections rather than incidents.
The original `10.48` release required staff review at POS with the existing PIN. The current
`10.49` flow adds opt-in table confirmation, customer-owned cancellation/rescheduling and
staff-reviewed operational requests, as detailed in the registry below. Deposit payment is still
not exposed through these chat tools. Apply the matching migrations before deploying them.

These tools are now actually reachable by Claude via a tool-use runtime, not just documented.
Registry + surface/RBAC filtering: [`lib/bms/tools/catalog.ts`](../../apps/web/lib/bms/tools/catalog.ts)
(`customerTools()` / `staffTools(perms)`); loop: [`lib/bms/tools/runtime.ts`](../../apps/web/lib/bms/tools/runtime.ts).
Tool names in the catalog are `snake_case` (e.g. `search_products`, `create_order`, `refund_payment`).

- **Customer surface** (webhook pipeline + playground): read product/stock + `get_order_status`
  (own orders only), customer coupon wallet / discovery / validation (`list_customer_coupons`,
  `list_available_coupons`, `check_coupon`), loyalty balance (`get_loyalty_points`),
  `create_order`, `submit_payment`, `reorder`, plus live-catalog discovery (`browse_catalog`,
  `list_new_arrivals`, `find_alternatives`, `recommend_products`) and store/shipping reads
  (`get_store_info`, `get_payment_info`, `get_shipping_estimate`, `get_customer_checkout`,
  `save_customer_checkout_details`, `detect_language`). Never any
  sensitive/A3 tool.
  This surface has a server-selected sub-mode. Ordinary shop channels use `shop_commerce` and keep
  the tools above. The verified BMS LINE OA (`@168tnlzi`) uses `bms_presales` and receives only
  `search_bms_presales` plus `list_bms_public_plans`; runtime authorization rejects either mode's
  tools when called from the other mode. Bot identity comes from LINE's verified bot-info response,
  never from message text or webhook JSON. The presales search reads a separate public-safe catalog
  with no admin routes or staff permissions; plan prices and limits are read live through
  `listPlans()` rather than copied into prompts. Search accepts a required query (up to 2,000
  characters) and optional `topicIds` (one to five allowlisted ids) for semantic multi-topic
  selection. Unknown ids, oversized lists and caller-supplied scope are rejected. The server
  renders successful approved topics and fresh plan reads, not free-form model claims; a topic
  requiring plan figures triggers a live plan read even if the router omitted it. Product prices,
  loyalty points and board-game time passes are distinct from subscription prices. Public topic
  ids and `requiresPlans` are evidence-safe; history/routing-policy dependencies are explicitly
  marked as not captured rather than claiming complete answer provenance. Presales input/output
  projections are per-tool allowlists: generic topic `id`, `answer`, `query`, `topicIds`, and plan
  fields are **not** added to shop-catalog, customer-status, or clinical evidence policies. Staff
  tool registration and RBAC are unchanged; presales tools are customer-only.
  Explicit capacity requests also trigger the existing live-plan tool. A pure server-side adviser
  compares stated totals, requested paid features and monthly budget, then explains the lowest-price
  fit with remaining questions. It has no separate database or model access, never changes a plan,
  and never derives entitlements from a recommendation. Unknown answers include verified LINE contact
  guidance without inventing telephone numbers or claiming a human has been dispatched.
- **Staff surface** (`bmsAssistant` / `/admin/assistant`): all read tools (incl. reports, forecast,
  documents, `summarize_conversation`) + A2 writes (execute + audit) + A3 sensitive tools as
  **propose-only** — the tool returns a proposal, a human clicks Confirm, and the UI fires the
  existing permission-gated mutation (`bmsConfirmPayment`, `bmsRefundPayment`, `bmsCancelOrder`,
  `bmsAdjustStock`, `bmsMergeCustomers`, `bmsSendMessage`, …). AI never executes A3 itself.
  Support intake/review is intentionally **not** an AI tool surface: `/support` writes directly to
  `support_tickets`, and `/admin/support-tickets` is a human ops page for platform admins.

Each tool wraps an existing `lib/bms/*.ts` service (no duplicated business logic), validates
model-supplied args, and derives `tenantId` from the server. `staffTools(perms)` removes tools the
role cannot use before schemas reach Claude; `runtime.ts` then enforces surface +
`requirePermission()` again immediately before execution. Unknown input fields are rejected.
Every attempt writes a redacted `ai.tool_call` entry to `bms_audit_log`; successful writes also keep
their existing domain audit action (`order.create`, `payment.submit`, etc.). Raw tool args and prompt
content are not copied into the centralized audit entry. Within one provider loop, a successful
tool call repeated with the same tool name and canonicalized arguments replays its prior
`tool_result` instead of executing the service again; every repeated attempt is still centrally
audited. Failed calls are not cached, so the model may correct arguments or retry a transient error.
For customer order writes, the server execution context additionally permits only one successful
`create_order`/`reorder` per logical turn even when later arguments differ; the verified first order
is retained for the deterministic checkout reply instead of creating a second order.
Customer read/write of orders is scoped to the conversation's own `(channel, customer_ref)`.
Coupon read tools are also scoped to that identity: `list_customer_coupons` reads the customer's
assigned wallet rows (if any) and reports whether each one is currently usable, near expiry, or no
longer valid. `list_available_coupons` returns currently usable coupons only; when wallet rows exist
it is filtered to that wallet, otherwise it falls back to globally active coupons. `check_coupon`
returns the requested code plus alternatives when unavailable. Customers do not activate coupons
from chat text; staff assignment writes the wallet row automatically, and AI may only send/explain
the signed `/coupon/wallet?t=...` link. Actual redemption still happens only when `create_order`
runs with `couponCode`.
`create_order` (both surfaces) also accepts an optional `couponCode` — Claude can pass through a
discount code a customer mentions in free text with no NLU changes needed, since tool-calling already
extracts it as a structured argument; validation happens server-side in `createOrder()` (see
[../business/order.md](../business/order.md#coupons-discount-codes)) and an invalid/exhausted code
rolls back the whole order with a `COUPON_INVALID` result the AI relays back to the customer.
It accepts up to 20 `items` in one atomic basket. An item counted in a configured selling unit sends
only `qty` (the number of packs) plus a `packCode` previously returned by `check_stock`; the model
never supplies base quantity, pack price, or a second pack-quantity field. `createOrder()` re-reads
the active pack row and snapshots its base quantity, unit name, and price inside the order
transaction, so a stale catalog/tool result cannot set price or stock quantity. `check_stock`
reports `available` in base units and may include the configured non-base `packs` for that SKU/size.
Both catalog search and stock-check responses include `verifiedAt`; they are live database reads,
and `createOrder()` still re-reads price, pack, and stock inside its transaction before writing.

Restaurant menus use the same catalog boundary. A menu must explicitly enable `CUSTOMER_AI` and
`ONLINE_ORDER`; `list_menu_modifiers` returns active option groups for an exact SKU/size, and
`create_order.items[].modifierCodes` accepts codes only. Names and price deltas are re-read
server-side and included in the pre-write confirmation summary and its fingerprint. `NON_STOCK`
and `RECIPE` return availability states rather than invented stock quantities; a branch-level
`SOLD_OUT_TODAY` flag remains visible so the assistant explains that the dish is sold out. Product
reads also return `foodProfile`: shop-maintained positive allergen declarations, dietary menu labels,
an explicit `allergenInformationProvided` flag, and `crossContactUnknown:true`. An empty declaration
is never permission to say a dish is allergen-free.

## Authoritative runtime registry and gates

`—` means no staff RBAC permission is needed because the data is customer-safe/public or the tool
is a local deterministic helper. “Customer” is an explicit surface allowlist, not a staff role.

| Tools | Class | Customer | Staff permission | Execution |
| --- | --- | --- | --- | --- |
| `search_system_capabilities`, `search_system_guides` | A1/knowledge | no | — | deterministic read of the verified bilingual catalog; `search_system_guides` also returns the verified FAQ answers owned by each guide plus, for its two best-ranked guides, the limits/traps that constrain them — quote these rather than paraphrasing; reports missing actor permissions but never grants access |
| `get_my_access` | A1/access | no | — | server-derived current actor role and effective permission codes; display name and POS-only scope are read from `users` because they are not session claims |
| `present_customer_choices` | A1/presentation | yes | — | bounded question/options, no business mutation or confirmation authority |
| `search_staff_users`, `get_staff_user_access` | A1/access | no | `user.view` | bounded current-tenant staff lookup / effective access; excludes platform identities and sensitive account fields |
| `get_loyalty_program_status` | A1/config | no | `member.view` | tenant loyalty enablement and verified earning/redemption settings, including the before/after-discount earning base; not a customer balance |
| `search_products`, `browse_catalog`, `list_new_arrivals`, `find_alternatives`, `get_product`, `check_stock`, `list_menu_modifiers`, `recommend_products` | A1 | yes | `product.view` | read |
| `get_variant_reservations` | A1 | no | `order.view` | bounded tenant-scoped reconstruction of orders holding one SKU/size, including bundle sources and unattributed/over-attributed totals |
| `list_customer_coupons`, `list_available_coupons`, `check_coupon` | A1 | yes | `coupon.view` | read / backend validation |
| `get_loyalty_points` | A1 | own `(channel, customer_ref)` only | `member.view` | read; never redeems |
| `get_order_status` | A1 | own `(channel, customer_ref)` only | `order.view` | read |
| `get_pharmacy_product_facts`, `get_pharmacy_service_status` | A1/pharmacy | pharmacy customers only | `product.view` | exact visible SKU label/pack facts, approved regulatory/sale policy (null if unapproved), optional branch/variant expiry snapshot; no approved usage quotations; shift evidence is not current presence and expiry is not the promised dispatched lot |
| `get_pharmacy_case_status` | A1/pharmacy | pharmacy customer's own `(channel, customer_ref)` only | `order.view` | latest short references/status/expiry, optionally filtered by explicit caseReference (8 hex characters or UUID) inside the same identity scope; ambiguous references expose no case; no health/decision text, staff identity or invented reply ETA |
| `get_customer_checkout` | A1 | own `(channel, customer_ref)` only | — | completeness read; no raw PII |
| `get_store_info`, `get_payment_info`, `get_shipping_estimate`, `detect_language` | A1/helper | yes | — | read/deterministic |
| `list_restaurant_order_locations`, `get_restaurant_availability`, `get_restaurant_reservation_status` | A1/restaurant | restaurant customers only | `product.view` / `order.view` | exact branch ids, current aggregate table/queue/kitchen facts, opt-in area/floor and capacity-grouped counts, and own request status; no guest/table/ticket identities and no promised wait time |
| `list_low_stock`, `get_inventory_summary`, `get_sales_summary`, `get_top_products`, `get_dashboard`, `generate_report` | A1 | no | `report.view` | read / file export; dashboard results include the live-query fetch time, not a fabricated last-change time |
| `list_board_game_report_branches`, `get_board_game_top_games`, `get_board_game_table_revenue` | A1 | no | `report.view` | staff-only board-game report reads; actor-scoped branches, bounded loan rankings and attributed table revenue; no costs or writes |
| `get_board_game_report` | A1 | no | `report.view` | SUMMARY, HEATMAP, OFFERS; PROFIT additionally requires `product.view` AND `tax.document.view` and returns product gross profit, never shop net profit |
| `get_board_game_live_operations`, `get_board_game_pass_balances` | A1 | no | `board_game.session.manage` | existing operational read permission; branch-scoped floor/queue/reservations and pass balances/expiry, no customer identity or mutations |
| `get_board_game_library_report` | A1 | no | `board_game.library.view` | paged COPIES, ATTENTION, UNPLAYED and USAGE; no borrower, condition notes or purchase costs |
| `analyze_pos_shift` | A1/POS | no | `pos.shift.report.all` | read-only shift/order/bill diagnostics from verified POS shift report + export ledgers; compares counted cash when supplied but never closes a shift or writes cash records |
| `get_customer`, `list_customers`, `customer_orders` | A1 | no | `customer.view` | read; `customer_orders` returns 1–10 rows plus all-status `totalCount`, `successfulCount`, and bounded `nextOffset`/`truncated`, never an unbounded ledger; if provider prose is empty/token-truncated after this verified read, runtime shows a server-formatted page and “show next” guidance instead of `—` or a broken table |
| `list_shipments`, `get_shipment_label` | A1 | no | `shipping.view` | read |
| `list_payments` | A1 | no | `payment.view` | read |
| `list_purchase_orders`, `get_purchase_order`, `list_suppliers`, `get_supplier_intelligence` | A1 | no | `purchase.view` | bounded evidence-backed read; supplier metrics do not invent an SLA |
| `generate_invoice`, `generate_quotation` | A1 | no | `order.view` | ephemeral document data |
| `get_inventory_intelligence`, `explain_inventory_risk`, `get_inventory_anomalies`, `find_inventory_transfer_opportunities`, `get_inventory_forecast_accuracy`, `forecast_demand`, `predict_stockout`, `suggest_purchase_order` | A1 | no | `report.view` | branch-aware deterministic/heuristic reads; never move stock |
| `summarize_conversation` | A1 | no | `inbox.view` | read |
| `classify_intent` | helper | no | — | deterministic |
| `create_order`, `reorder` | A2 | own identity; customer `reorder` defaults to latest own order; pharmacy SKU must pass approved backend Product Policy | `order.create` | execute + domain audit + deterministic signed checkout link |
| `request_restaurant_reservation` | A2/restaurant | own identity, restaurant customers only | `order.create` | creates `REQUESTED` for staff review; never reserves or confirms a table |
| `subscribe_restock_notification` | A2 | explicit opt-in for own channel identity | — | save waitlist entry; staff reviews before outbound |
| `save_customer_checkout_details` | A2 | own `(channel, customer_ref)` only | — | save only delivery fields explicitly supplied by that customer |
| `submit_payment` | A2 | own order only | `payment.submit` | create PENDING + domain audit |
| `create_shipment` | A2 | no | `shipping.create` | execute + domain audit |
| `update_tracking`, `set_shipment_status` | A2 | no | `shipping.update` | execute + domain audit |
| `create_purchase_order` | A3 | no | `purchase.edit` | proposal only; stable request id makes confirmation retry-safe |
| `propose_stock_transfer` | A3 | no | `inventory.transfer` | proposal for a draft only; send and receive remain separate human actions |
| `upsert_customer`, `set_customer_tags` | A2 | no | `customer.edit` | execute + domain audit |
| `assign_conversation` | A2 | no | `inbox.assign` | execute + domain audit |
| `set_conversation_status`, `set_conversation_tags`, `add_note` | A2 | no | `inbox.manage` | execute + domain audit |
| `verify_payment_slip` | advisory | no | `payment.confirm` | read/advisory only |
| `confirm_payment`, `reject_payment` | A3 | no | `payment.confirm` | proposal only |
| `refund_payment` | A3 | no | `payment.refund` | proposal only |
| `cancel_order` | A3 | no | `order.cancel` | proposal only |
| `return_order` | A3 | no | `order.return` | proposal only |
| `adjust_stock` | A3 | no | `stock.adjust` | proposal only; requires a verified `locationId` and must never guess a branch |
| `merge_customers` | A3 | no | `customer.edit` | proposal only; shared review dialog requires server preview, staff verification method and evidence reference |
| `cancel_purchase_order` | A3 | no | `purchase.cancel` | proposal only |
| `cancel_shipment` | A3 | no | `shipping.update` | proposal only |
| `send_customer_message` | A3 | no | `inbox.reply` | proposal only |
| `email_report` | A3 | no | `report.email` | generates the file immediately (same as `generate_report`), proposes the *send* only — recipient is free text, never verified, so a human must Confirm before anything is emailed |

## Registry-only tool metadata (disambiguation, not schema)

`BmsTool` (`lib/bms/tools/types.ts`) carries four **optional, registry-only** fields for docs/humans:
`whenToUse`, `whenNotToUse`, `commonMistakes`, `example`. They exist to record a tool that has
actually been mis-called — by the model or by a human editing `catalog.ts` — not to document every
tool exhaustively.

- **Zero token cost by default.** `tools/runtime.ts` (~L370) only serializes `name`/`description`/
  `input_schema` into the Anthropic tool payload — these fields never reach the model unless someone
  deliberately folds their content into a tool's `description` string.
- **Populated so far** (12 tools — the five overlapping product-discovery tools, the two
  order-creation tools, four identity-sensitive checkout/order/payment tools, and `generate_report`): `search_products`, `browse_catalog`,
  `list_new_arrivals`, `find_alternatives`, `recommend_products`, `create_order`, `reorder`,
  `get_order_status`, `get_customer_checkout`, `save_customer_checkout_details`, `submit_payment`,
  `generate_report` — see `catalog.ts` for the exact wording. Example: `search_products.whenNotToUse`
  points to `browse_catalog` for broad questions and to `find_alternatives` when the named item is
  out of stock, so the five overlapping catalog tools cross-reference each other instead of relying
  on the model to infer the boundary from prose alone; `generate_report.whenNotToUse` similarly
  points to `get_sales_summary`/`get_inventory_summary`/`get_top_products` for a plain question that
  doesn't need a downloadable file.
  **This list drifts** — it was 7 tools until `feat/report-generation` added an 8th independently;
  re-check `catalog.ts` rather than trusting the count here.
- **`commonMistakes` records a real failure**, not a hypothetical one — e.g. `reorder`'s entry warns
  never to pass `orderId` on the customer surface even if the customer states one, because the tool
  always resolves that customer's own latest order (prevents guessing someone else's `orderId`).
- **Don't fill this in for every tool.** Add it only when a tool has actually been called wrong
  (in eval, in production, or in review) — most tools never need it.

Identity resolution (`ensureCustomerForIdentity`, canonical-history lookup and payable-order
selection) and pharmacy patient-memory helpers are intentionally **not** model-callable tools. They
run server-side from the established tenant/channel/customer identity; registering them would let
model-supplied identifiers influence tenancy/PII/health-data boundaries. Pharmacy intake also stays
in its deterministic state-machine surface and enters this registry only when it returns to the
normal approved catalog/order flow.

---

# Product Tools

## searchProducts()

Search products.

Input

{
    keyword,
    categoryId?,
    brandId?
}

Output

[
    Product
]

---

## getProduct()

Get product detail.

Input

{
    productId
}

Output

Product

---

## checkStock()

Input

{
    productId?,
    sku?,
    productName?,
    size?,
    warehouseId?
}

Output

{
    currentStock,
    reservedStock,
    availableStock
}

---

# Inventory

## stockIn()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Output

StockMovement

---

## stockOut()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Output

StockMovement

---

## reserveStock()

**Not an AI tool, and the shape below is the plan, not the code.** The implementation is
`reserveStock({ tenantId, sku, size, qty, locationId?, note?, actor? })` in `lib/bms/stock.ts`: it
holds stock for one shop, in one branch, and writes a `RESERVE` movement in the same transaction.
`tenantId` and `locationId` are not optional decoration — the function shipped filtering on
`product_sku` + `size` alone, which reserved that product in every shop and branch stocking it (see
[../agent-invariants.md § REST route authentication](../agent-invariants.md#rest-route-authentication-and-tenancy)).

The ordinary way stock gets reserved is `createOrder()`, inside the same transaction as the bill, so a
reservation always has an order behind it. Any future order-bound tool should follow the plan below —
`orderId` + `items[]` — rather than exposing the bare primitive, precisely so a model cannot create a
hold nobody can trace.

Input

{
    orderId,
    items[]
}

Output

Reservation Result

---

## releaseStock()

Input

{
    orderId
}

Output

Success

---

## transferStock()

Input

{
    fromWarehouse,
    toWarehouse,
    items[]
}

Output

Transfer Result

Not an AI tool and not a GraphQL mutation today. Inter-branch transfers/counts (`7.98`) live behind
REST-only admin routes `/api/bms/inventory/transfers` and `/api/bms/inventory/counts`, authorised by
the signed admin session plus `inventory.transfer` / `inventory.count` / `inventory.count.apply`.
They are absent from the runtime AI registry because `lib/bms/tools/catalog.ts` does not register a
validated wrapper. GraphQL is not a prerequisite for a tool: any future stock-transfer tool must call
the service through that catalogue, derive the tenant from `ExecCtx`, re-check permission, preserve
the service's in-transaction audit, and remain propose-only until a person confirms the movement.

---

## adjustStock()

Input

{
    warehouseId,
    productId,
    quantity,
    reason
}

Human approval required.

---

# Customer

## searchCustomer()

Search customer.

Input

{
    keyword
}

---

## getCustomer()

Input

{
    customerId
}

---

## createCustomer()

Input

{
    name,
    phone,
    email
}

---

## mergeCustomer()

Merge duplicated customers.

Admin only.

---

# Orders

## createDraftOrder()

Input

{
    customerId,
    channel,
    items[]
}

Output

Draft Order

---

## addOrderItem()

Input

{
    orderId,
    productId,
    quantity
}

---

## removeOrderItem()

Input

{
    orderId,
    orderItemId
}

---

## confirmOrder()

Confirm order.

Reserve stock.

---

## cancelOrder()

Release stock.

Admin approval required.

---

## getOrder()

Input

{
    orderId
}

---

## getOrderStatus()

Input

{
    orderNo
}

---

# Purchase Orders

✅ Implemented — service `lib/bms/purchase.ts`, migrations `5.2__bms_purchase.sql` and
`9.18__bms_supplier_product_mapping.sql`,
REST `/api/bms/purchase*`, GraphQL `bmsPurchase*`, admin UI `/admin/purchase`.

flow:  OPEN → PARTIAL → RECEIVED  (└→ CANCELLED)
สต็อกเข้าเฉพาะตอน receive เท่านั้น + บันทึก STOCK_IN movement ทุกครั้ง

## createPurchaseOrder()

Input

{
    supplierId?,        // หรือ supplierName (จะ resolve/สร้าง supplier ให้)
    supplierName?,
    note?,
    items[] {           // sku ต้องมีในร้าน
        sku,
        size,
        qty,            // > 0
        unitCost?,      // ทุน/หน่วย (snapshot)
        supplierSku?,   // ผูกกับ sku + size ของร้านสำหรับ supplier นี้
        supplierProductName?,
        supplierBarcode?
    }
}

Output

Purchase Order (status = OPEN, ยังไม่ขยับสต็อก)

Permission: purchase.edit

---

## receivePurchaseOrder()

รับของเข้าสต็อก (บางส่วน/ครบ) → current_stock += qty + STOCK_IN movement
คำนวณสถานะ PO ใหม่เป็น PARTIAL / RECEIVED

Input

{
    poId,
    items[] {
        sku,
        size,
        qty             // ห้ามเกิน (qty_ordered - qty_received)
    }
}

Output

{
    status,             // PARTIAL | RECEIVED
    items[]             // ยอด qty_received ล่าสุดต่อรายการ
}

Permission: purchase.receive

---

## cancelPurchaseOrder()

ยกเลิก PO (เฉพาะ OPEN/PARTIAL) → CANCELLED
ของที่รับเข้าสต็อกไปแล้วจะไม่ถูกดึงออก (ตามหลักบัญชีสินค้า)

Input

{
    poId
}

Permission: purchase.cancel

---

## getPurchaseOrder() / listPurchaseOrders() / listSuppliers() / listSupplierProducts()

อ่านใบสั่งซื้อ + ประวัติ supplier (Supplier History) + catalog mapping ระหว่าง SKU ผู้ขายกับ
SKU ร้าน/ไซซ์ สต็อกและการรับของยังยึด SKU ร้านเสมอ ส่วน PO เก็บ supplier identity เป็น snapshot

Permission: purchase.view

---

# Customer checkout details

`get_customer_checkout` resolves the customer only from the server-established
`(tenant_id, channel, customer_ref)` identity and returns bounded completeness flags:
recipient name, phone, shipping-address presence/count, default address label, and ordered
`missingFields`. The label is returned only when it is a generic allowlisted value such as
"บ้าน"/"ที่ทำงาน"/"home"/"office"; it never returns the raw name, phone number, or address to the
model. Lazada/Shopee return `marketplaceManaged:true`, so the AI must not collect data already owned
by Seller Center.

`save_customer_checkout_details` accepts only delivery fields the current customer explicitly sent
(`recipientName`, `phone`, `shippingAddress`, optional `addressLabel`). Omitted values are preserved;
an address identical to an existing shipping address is selected as default instead of duplicated.
The tool is customer-only, identity-scoped, validated, transactional, and audited as
`customer.checkout_update`. If the read status has no missing fields, the AI reuses the existing
details and must not call this write tool or ask the customer to type them again.

After customer `create_order` or `reorder` returns `CREATED`, the tool stores the verified order id
only in the server execution context. `pipeline.ts` then calls `orderCheckoutChatReply()` and
replaces the model's closing sentence with the real order summary plus signed `/checkout?t=...`
URL. The link is tenant/order-scoped and expires; its page never accepts tenant, total, or order
ownership from client input.

---

# Payment

✅ Implemented — service `lib/bms/payments.ts`, migration `5.3__bms_payments.sql`,
REST `/api/bms/payment*`, GraphQL `bmsPayment*`, admin UI `/admin/payment`.

flow ต่อ 1 payment:  PENDING → CONFIRMED (└→ REJECTED) · CONFIRMED → REFUNDED
methods: BANK_TRANSFER / QR / CARD / TIKTOK / CASH

## submitPayment()

บันทึกการชำระ (status PENDING) — ยังไม่เปลี่ยนสถานะออร์เดอร์

Input

{
    orderId,
    method,             // BANK_TRANSFER | QR | CARD | TIKTOK | CASH
    amount?,            // เว้นว่าง = ยอดรวมของ order
    slipUrl?,           // /api/files/<id> (รูปสลิป)
    slipRef?,           // เลขอ้างอิง/txn
    note?
}

Permission: payment.submit

บน customer surface ทูลรับเฉพาะ `method` ที่ตรงกับบัญชีรับเงินซึ่งร้านตั้งค่าไว้ใน
`get_payment_info`; ถ้าไม่มีหรือ method ไม่ตรง จะคืน `PAYMENT_METHOD_NOT_CONFIGURED` และไม่สร้าง
payment สถานะ PENDING ส่วน staff surface ยังบันทึกวิธีอื่นตามหลักฐาน/ช่องทางภายนอกได้ตามสิทธิ์เดิม

---

## verifyPaymentSlip()

OCR / AI Validation → **แนะนำเท่านั้น** (ไม่เปลี่ยนสถานะ ตาม BUSINESS_RULES: AI ห้ามยืนยันเงินเอง)

- ไม่มี AI credentials/credits หรือไม่มีรูปสลิปที่อ่านได้ → heuristic (ให้ตรวจเอง)
- มี credentials + slipUrl เป็นรูป → `SlipReader` สกัด amount/date/ref/bank แล้ว backend เทียบยอด
- provider ปัจจุบันรองรับทั้ง Anthropic และ Qwen OCR; contract แยกจาก `payments.ts` เพื่อเพิ่ม
  internal OCR หรือ provider อื่นภายหลังได้โดยไม่เปลี่ยนกฎ payment
- malformed output, timeout หรือ provider error → ลอง OCR fallback หนึ่งครั้ง (Qwen → Anthropic
  ตามค่า default) แล้วจึง fallback ให้คนตรวจเอง; ทุก attempt ถูกนับ usage แยกกัน

Input

{
    paymentId
}

Output

{
    method,             // ai | heuristic
    provider,           // anthropic | qwen | null (เมื่อ heuristic)
    expectedAmount,
    amountMatch,
    verified,           // AI มั่นใจว่ายอดตรง (ยังต้องกดยืนยันเอง)
    reason
}

Permission: payment.confirm

---

## confirmPayment()

Backend only. PENDING → CONFIRMED + order PENDING → PAID (atomic)

Input

{
    paymentId
}

Permission: payment.confirm

---

## rejectPayment()

PENDING → REJECTED

Permission: payment.confirm

---

## refundPayment()

CONFIRMED → REFUNDED. Manager approval required.

Input

{
    paymentId
}

Permission: payment.refund

---

# Shipping

✅ Implemented — service `lib/bms/shipping.ts`, migrations `5.4__bms_shipments.sql` +
`7.76`/`7.77` (carrier booking state + tracking events), REST `/api/bms/shipment*`,
GraphQL `bmsShipment*`, admin UI `/admin/shipment`.

carriers: FLASH / KERRY / DHL / AUSPOST / NZPOST / OTHER
flow: PENDING → SHIPPED → IN_TRANSIT → DELIVERED (└→ RETURNED / CANCELLED)

carrier adapter (`lib/bms/carriers/`): FLASH/KERRY = mock-ready scaffold เท่านั้น — ใส่ key แล้ว
`getStatus()` ยังเป็น `not_implemented` เพราะยังไม่มีสัญญา/เอกสาร merchant จริง (ห้ามเดา payload)
ดู [../integrations/carriers.md](../integrations/carriers.md)

`bookShipmentLive()`/`syncShipmentLive()` **ไม่ได้อยู่ใน AI registry** (ไม่มีชื่อ snake_case ในตาราง
ด้านบน) — เป็น action ของ staff ผ่าน `/admin/shipment` และของ cron เท่านั้น

## createShipment()

ผูก carrier/tracking + ship จริง: order PACKING → SHIPPED + ตัดสต็อก + SHIP movement (atomic)
ถ้า order = SHIPPED อยู่แล้ว จะแค่แนบ shipment (ไม่ตัดสต็อกซ้ำ)

ก่อนส่งออเดอร์ของ LINE/Facebook/Instagram/Web/TikTok Chat ต้องมี CRM shipping address;
Lazada/Shopee exempt เพราะที่อยู่อยู่ Seller Center ถ้าไม่ครบ service คืน
`MISSING_SHIPPING_ADDRESS` โดยไม่เปลี่ยน order/stock

Input

{
    orderId,
    carrier,            // FLASH | KERRY | DHL | AUSPOST | NZPOST | OTHER
    trackingNo?,
    note?
}

ถ้าไม่ได้ส่ง `trackingNo` มาเอง, ไม่ใช่ Lazada/Shopee, และ carrier client รองรับ `createShipment`
ระบบจะ **commit transaction ในเครื่อง + ปล่อย lock ก่อน** แล้วค่อยจองพัสดุกับ carrier โดยใช้
shipment UUID เป็น idempotency key; ถ้าจองไม่สำเร็จ shipment ยังถูกสร้าง แต่สถานะการจอง
(`failed`/`unconfigured`/`not_implemented`) จะถูกเก็บไว้ให้กด retry ได้ ไม่ถูกกลบเป็น manual เงียบ ๆ

Output

{
    status,             // CREATED
    shipmentId,
    orderShipped,       // true = ตัดสต็อก/ship ในครั้งนี้
    trackingNo,         // จาก carrier ถ้าจองสำเร็จ
    labelUrl,           // HTTPS เท่านั้น
    externalShipmentId,
    carrierIntegration, // manual | live | mock
    carrierBookingStatus,
    carrierWarning      // เหตุผลที่ยังจองกับ carrier ไม่สำเร็จ
}

Permission: shipping.create

---

## updateTracking()

Input

{
    shipmentId,
    trackingNo?,
    carrier?
}

Permission: shipping.update

---

## setShipmentStatus()

เปลี่ยนสถานะ shipment — DELIVERED → order SHIPPED → COMPLETED (best-effort)

Input

{
    shipmentId,
    status              // PENDING | SHIPPED | IN_TRANSIT | DELIVERED | RETURNED | CANCELLED
}

Permission: shipping.update

---

## bookShipmentLive()

จอง/จองซ้ำพัสดุกับ carrier สำหรับ shipment ที่ยังไม่มีเลขพัสดุ (GraphQL `bmsBookShipmentLive`)
— ใช้ shipment UUID เป็น idempotency key, ยิงนอก transaction, และเก็บผลลัพธ์ลง
`carrier_booking_status`/`_error`/`_attempted_at`

Input

{
    shipmentId
}

Output

{
    status,             // BOOKED | ALREADY_BOOKED | TRACKING_ALREADY_SET | IN_PROGRESS
                        // | TERMINAL_SHIPMENT | MARKETPLACE_MANAGED | NO_CARRIER_CLIENT
                        // | UNCONFIGURED | NOT_IMPLEMENTED | CARRIER_ERROR | STALE_SHIPMENT
    shipmentId, trackingNo, externalShipmentId, labelUrl,
    source              // live | mock
}

Permission: shipping.update

---

## syncShipmentLive()

ดึงสถานะ/ไทม์ไลน์ล่าสุดจาก carrier ของ shipment ที่มีเลขพัสดุแล้ว (GraphQL `bmsSyncShipmentLive`;
cron ข้ามร้าน = `POST /api/bms/shipping/sync-carriers`) — re-lock + re-check ก่อนเขียน,
ไม่ถอยสถานะ, ไม่แตะ shipment ที่จบแล้ว (DELIVERED/RETURNED/CANCELLED)

Input

{
    shipmentId
}

Output

{
    status,             // SYNCED | SHIPMENT_NOT_FOUND | TRACKING_REQUIRED | NO_CARRIER_CLIENT
                        // | UNCONFIGURED | NOT_IMPLEMENTED | CARRIER_ERROR | STALE_SHIPMENT
    shipmentId, trackingNo, shipmentStatus,
    source,             // live | mock
    eventCount, completedOrder
}

Permission: shipping.update

---

## listShipmentTrackingEvents()

ไทม์ไลน์ที่ normalize แล้วจาก `bms_shipment_tracking_events` (GraphQL `bmsShipmentTrackingEvents`)
— แต่ละ event มี `source` = live | mock เสมอ

Input

{
    shipmentId,
    limit?              // default 100
}

Permission: shipping.view

---

## getShipmentLabel()

ข้อมูลสำหรับพิมพ์ใบปะหน้า (order + ผู้รับ + ที่อยู่ + รายการ) + `labelUrl` ของ carrier ถ้ามี
(รับเฉพาะลิงก์ HTTPS) — ถ้าไม่มีลิงก์จาก carrier ให้ใช้ใบปะหน้าที่พิมพ์จาก BMS เหมือนเดิม

Input

{
    shipmentId
}

Permission: shipping.view

---

# Omnichannel Inbox

✅ Implemented — service `lib/bms/inbox.ts`, migration `5.5__bms_inbox.sql`,
REST `/api/bms/inbox*`, GraphQL `bmsConversation*` / `bmsSendMessage`, admin UI `/admin/inbox`.

ทุกข้อความจาก webhook (LINE/TikTok) + คำตอบ AI ถูกบันทึกอัตโนมัติผ่าน
`logConversation()` (hook ใน webhook) — 1 บทสนทนา = (tenant, channel, customer_ref)

**Shopee/Lazada 🧪 beta:** `app/api/bms/{shopee,lazada}/webhook/[tenantId]/route.ts` มีโครงรับ webhook
แบบเดียวกับ TikTok (rate limit + HMAC verify + parse → pipeline → `logConversation()`) และต่อ config/UI
(settings, `Channel` type, `CHANNEL_COLOR`) ครบเหมือน channel อื่นแล้ว — **แต่** signature verify scheme
กับชื่อ field ใน payload (`parseShopeeMessages()`/`parseLazadaMessages()`) เป็น placeholder ที่ยังไม่ตรวจกับ
เอกสาร Shopee/Lazada Open Platform จริง (ดู `TODO(prod)` ในไฟล์) ต้องแก้ก่อนใช้ production · ยังไม่มี send API
(ตอบกลับลูกค้าไม่ได้ เหมือน TikTok) · ไม่อยู่ใน `channelSupportsPush()` จึงถือว่า SENT ทันทีเมื่อบันทึกสำเร็จ

**Realtime Diagnostics:** `/admin/inbox/realtime-diagnostics` เป็นเครื่องมือ Administrator/platform-admin
สำหรับแยกทดสอบสองชั้น: `Emit` publish `bmsInboxChanged` อย่างเดียว (ไม่เขียน DB จึงไม่เห็นแชทใหม่) และ
`Create Msg` เรียก `bmsCreateInboxDiagnosticMessage(channel)` เพื่อสร้างข้อความ diagnostic ใน Inbox จริง
โดยไม่เรียก AI pipeline และไม่ส่งข้อความออก platform ใด ๆ

## sendStaffMessage()

แอดมินตอบเอง → persist ข้อความ + ยิงกลับช่องทางจริง (LINE push / Meta send; อื่น ๆ persist อย่างเดียว)

Input

{
    conversationId,
    body,        # optional ถ้ามี attachment
    attachment   # optional { url, name, mimeType }
}

**แนบรูป/ไฟล์:** อัปโหลดผ่าน REST `POST /api/bms/inbox/upload` (multipart, ≤10MB) → คืน `{url,name,mimeType}`
→ ส่งเข้า `bmsSendMessage(attachment)`. เก็บใน `bms_messages.meta.attachment` (ไม่ต้อง migration) ·
รูป → LINE image / Meta image attachment · ไฟล์อื่น → แนบเป็นลิงก์ท้ายข้อความ · push ต้องมี `NEXT_PUBLIC_BASE_URL` (https)

Permission: inbox.reply

**สถานะข้อความ (Phase 1):** OUT message เก็บ `meta.status` = `SENT` / `FAILED` (SENDING เป็น optimistic ฝั่ง client) ·
push channel (LINE/FB/IG) → `delivered?SENT:FAILED` · web/tiktok → `SENT` (บันทึกแล้ว, ไม่ push) ·
`bmsRetryMessage(id)` ส่งซ้ำจาก FAILED · UI **capability-gated** (`canReportDelivery`): LINE โชว์แค่ "ส่งแล้ว", web/tiktok "บันทึกแล้ว", ไม่มี tick อ่าน · delivered/read = Phase 2 (webhook FB/IG/web)

---

## assignConversation() / setConversationStatus() / setConversationTags()

มอบหมาย staff · สถานะ OPEN/PENDING/CLOSED · แท็ก

Permission: inbox.manage

---

## addNote() / getTimeline()

โน้ตภายใน (ลูกค้าไม่เห็น) · timeline รวม message + note + order + system event (มอบหมาย/ช่วยตอบ/
สถานะแชท) เรียงตามเวลา **ที่เหตุการณ์นั้นเกิดจริง**

- แถว `ORDER` = เวลา **สร้าง** ออร์เดอร์ (`created_at`) — สถานะปัจจุบันแยกเป็น field `status`/`statusAt`
  ห้ามอ่านรวมกันว่า "ได้สถานะนี้ตอน `at`" (ถ้าต้องการเส้นเวลาการเปลี่ยนสถานะจริง ใช้ `getOrderJourney()`
  ที่อ่านจาก `bms_audit_log`)
- ออร์เดอร์ scope ตาม **ลูกค้า** ไม่ใช่ตามแชท → ออร์เดอร์ช่องทางอื่นก็ปรากฏด้วย จึงคืน `channel` มาให้
  UI ติดป้ายกำกับ
- ข้อความที่เป็นรูป/ไฟล์ล้วน (`body` ว่าง) คืน `[รูปภาพ]`/`[ไฟล์] ชื่อไฟล์` ผ่าน `messagePreview()`
  ตัวเดียวกับ preview ในคิวแชท
- มีเพดาน `TIMELINE_MAX_PER_SOURCE = 200` ต่อแหล่งข้อมูล (arg `limit` ปรับลงได้ แต่ไม่เกินเพดาน)

Permission: inbox.manage (note) / inbox.view (timeline)

---

## แท็บ "ลูกค้า" — purchase history ตอนเปิดแชท

เปิดบทสนทนา → auto-load `bmsCustomer(conv.customerId)` (ไม่ต้องกดปุ่ม เหมือน Timeline) →
โชว์ยอดซื้อสะสม (`total_spent`) · จำนวนออร์เดอร์ (`order_count`) · แท็ก/โน้ตลูกค้า ·
รายการออร์เดอร์ (`orders[]`) ให้ sale เห็นทันทีว่าลูกค้าคนนี้เคยซื้ออะไรบ้างโดยไม่ต้องสลับไปหน้า CRM

ไม่มี resolver/service ใหม่ — ใช้ `bmsCustomer` query (`graphql/bmsCustomers.ts`) +
`getCustomer()`/`customerOrders()` (`lib/bms/customers.ts`) ที่มีอยู่แล้ว

Permission: customer.view (ถ้าไม่มีสิทธิ์ → โชว์ empty state ไม่ error)

**ข้อจำกัด:** `resolveOrCreateCustomer` จับคู่ลูกค้าด้วย `(tenant, channel, external_ref)` เท่านั้น
ยังไม่ auto-dedupe ข้ามช่องทางด้วยเบอร์โทร/อีเมล — ลูกค้าคนเดียวทักหลายช่องทางจะเห็นประวัติซื้อไม่ครบ
จนกว่า staff จะกดผสาน record ด้วยตัวเอง (ดู `mergeCustomers()` ด้านล่าง)

> คนละอย่างกับ **Customer 360 panel** (คอลัมน์ขวาสุดของ `/admin/inbox`, `Customer360Panel.tsx` →
> `bmsCustomer360()`/`bmsCustomerTimeline()`/`bmsCustomerInsights()` ใน `lib/bms/customer360.ts`,
> migration `6.2__bms_customer_360.sql`) ซึ่งเป็น view ที่ละเอียดกว่า (summary/contact/stats/recent
> orders ทุกช่องทาง/products/cart/notes + timeline รวม + AI insights) และมี Quick Actions สำหรับ
> staff สร้างออเดอร์/preview ใบแจ้งหนี้ตาม permission — ทั้งสองใช้งานคู่กันได้ ไม่ได้แทนกัน ดู
> [`docs/ui/customer360.md`](../ui/customer360.md)

---

## mergeCustomers() — ผสานลูกค้าซ้ำข้ามช่องทาง

ลูกค้าคนเดียวกันทักมาคนละช่องทาง (เช่น LINE แล้วก็ FB) จะถูก `resolveOrCreateCustomer`
สร้างเป็นคนละ `bms_customers` record เพราะจับคู่ตาม `(tenant_id, channel, external_ref)` เท่านั้น —
`mergeCustomers(tenantId, keepId, mergeId, confirmation)` ใช้ยุบ record ซ้ำเข้าด้วยกันด้วยมือ:

- ย้าย `bms_customer_identities` / `bms_orders` / `bms_customer_addresses` / `bms_conversations` /
  `bms_pharmacy_assessments` / `bms_restock_subscriptions` / coupon wallet ทั้งหมดจาก `mergeId`
  ไป `keepId` (coupon entitlement ซ้ำรวม lifecycle โดยให้ `REDEEMED/RESERVED` เหนือสถานะที่อ่อนกว่า;
  identity unique ต่อ tenant+channel+ref อยู่แล้ว) และล้าง AI summary cache ของทั้งคู่เพื่อคำนวณใหม่
  จาก history ที่รวมแล้ว
- ถ้า record หลักและ record ที่รวมเข้ามามี default address ประเภทเดียวกัน ให้คง default ของ
  record หลัก และจัดให้เหลือ default เดียวต่อ `address_type`
- รวม tags (union), เติม phone/email/note/preferred language/timezone ที่ `keepId` ไม่มีจาก
  `mergeId` และรักษา `followup_opt_out=true` หาก record ใด record หนึ่งเคย opt out
- soft-delete `mergeId` (`deleted_at`) — **ทำแล้วย้อนกลับเองไม่ได้**
- ทั้งหมดอยู่ในทรานแซกชันเดียว (`beginTenantTx`)

UI: `/admin/customers` → ปุ่ม **"ผสาน"** ต่อแถว → ค้นหา record ซ้ำ → ตรวจผลกระทบจากเซิร์ฟเวอร์
→ ระบุเหตุผล วิธีตรวจสอบเจ้าของข้อมูล และรหัสหลักฐาน → ยืนยัน
หน้า Assistant และ Drawer ใช้หน้าตรวจสอบเดียวกัน โมเดลเสนอได้เฉพาะคู่ลูกค้า ห้ามสร้างหลักฐานเอง

Input

{
    keepId,   # ลูกค้าหลักที่จะเก็บไว้
    mergeId,  # ลูกค้าซ้ำที่จะยุบเข้ามาแล้ว soft-delete
    review    # previewToken, reason, verificationMethod, evidenceReference, confirmed
}

Permission: customer.edit · `review` จำเป็นตอน execute แม้ SDL คง optional เพื่อ compatibility
· เซิร์ฟเวอร์กำหนด actor จาก session และตรวจ preview อายุไม่เกิน 10 นาที ผูก tenant/actor/คู่และทิศทาง
· บันทึก audit action `customer.merge` พร้อมการรวมใน transaction เดียวกัน
· รายละเอียดและข้อจำกัด: [CRM](../business/crm.md#reviewed-staff-merges-and-web-chat-ownership-2026-10)

---

## reorderFromOrder() — "ซื้อซ้ำ" จากประวัติการซื้อ

ให้ sale กดสั่งซื้อซ้ำจากออร์เดอร์เก่าของลูกค้าได้ทันทีจากแท็บ "ลูกค้า" ในหน้าแชท
(หรือแถวประวัติซื้อใน `/admin/customers`) โดยไม่ต้องพิมพ์รายการสินค้าใหม่เอง:

- customer surface หาออร์เดอร์ล่าสุดจาก canonical `customer_id` หลัง merge; legacy ที่ยังไม่ผูก
  ใช้ exact `(channel, customer_ref)` เท่านั้น
- อ่าน channel/customer_ref + รายการสินค้า (sku, size, qty) จากออร์เดอร์ต้นทาง โดยออร์เดอร์ใหม่
  ของลูกค้าจะผูกกับ channel identity ปัจจุบัน ไม่ย้อนกลับไปช่องทางเก่า
- เรียก `createOrder()` เดิมทั้งชุด (จองสต็อกแบบ atomic + ตัดราคาปัจจุบันของสินค้าใหม่ — **ไม่ใช่ราคาย้อนหลัง**)
- **ไม่มีสถานะ "Draft" แยก** — ออร์เดอร์ใหม่เริ่มที่ `PENDING` พร้อมจองสต็อกทันที เหมือนออร์เดอร์ปกติทุกใบ

Input

{
    orderId?  # customer เว้นได้: resolve ออร์เดอร์ล่าสุดจาก canonical customer; staff ต้องระบุ
}

Output: `{ status, orderId, total, message }` — `status` หนึ่งใน
`CREATED` / `INSUFFICIENT` (สต็อกไม่พอ) / `NOT_FOUND` (สินค้าถูกลบ/ปิด active ไปแล้ว) /
`EMPTY` (ออร์เดอร์ต้นทางไม่มีรายการ) / `SOURCE_NOT_FOUND`

Permission: **order.create** (permission ใหม่ — เดิม order ถูกสร้างจาก AI/REST เท่านั้นไม่เคยผ่าน
permission gate มาก่อน · seed ให้ Manager/Sales ที่ migration `6.3__bms_order_create_perm.sql`)

---

# Reports

✅ Implemented — dashboard: `lib/bms/dashboard.ts`; report tools แยกส่วน:
`lib/bms/reports.ts`, REST `/api/bms/reports/*`, GraphQL `bmsSalesSummary` /
`bmsInventorySummary` / `bmsTopSellingProducts`, admin UI `/admin/reports`.
ทุก tool ต้องมีสิทธิ์ `report.view`

## getDashboard()

Today's overview (revenue, low stock, orders by status, top products/customers, 7-day sales).

---

## getSalesSummary()

ยอดขายตามช่วงวันที่ (default = 30 วันล่าสุด) — revenue นับเฉพาะ PAID ขึ้นไป หากคำว่า
“ทั้งหมด” ยังไม่ชัดว่าหมายถึงทุกช่วงเวลาหรือทุกรายการ ต้องถามยืนยันก่อน ห้ามปล่อยให้ default 30 วันทำงานแทน
เมื่อผู้ใช้ยืนยันว่าหมายถึงตั้งแต่เปิดร้าน ให้ส่ง `scope: "all_time"` โดยไม่ส่ง `from`/`to`; โหมดนี้คืน
aggregate ทั้งช่วงและไม่สร้าง `byDay` รายวัน เพื่อไม่ให้ผลลัพธ์โตตามอายุร้าน

Input

{
    from,               // YYYY-MM-DD (เว้นได้)
    to,
    scope               // "all_time" หลังผู้ใช้ยืนยันเท่านั้น; ห้ามใช้พร้อม from/to
}

Output

{
    from, to,
    revenue, orderCount, avgOrderValue,
    byDay[]     { day, revenue, orders },
    byStatus[]  { status, count },
    byChannel[] { channel, revenue, orders }
}

---

## getInventorySummary()

Output

{
    skuCount, variantCount,
    totalUnits, reservedUnits, availableUnits,
    stockValue,             // Σ current_stock × price
    lowStockCount, outOfStockCount
}

---

## getLowStockProducts()

มีอยู่แล้วใน `lib/bms/products.ts` (`listLowStock`) + GraphQL `bmsLowStock`

---

## getTopSellingProducts()

ผลลัพธ์เป็น ranking แบบ bounded ไม่ใช่ sales ledger แบบไม่จำกัด หาก “ทั้งหมด” อาจหมายถึงทุกช่วงเวลา,
สินค้าทุกรายการ หรือออร์เดอร์ทุกรายการ ต้องถามให้ชัดก่อนเรียก tool
เมื่อยืนยันว่าเป็นทุกช่วงเวลา ให้ส่ง `scope: "all_time"` โดยไม่ส่ง `from`/`to`

Input

{
    from, to,               // YYYY-MM-DD (เว้นได้)
    limit,                  // default 10
    scope                   // "all_time" หลังผู้ใช้ยืนยันเท่านั้น; ห้ามใช้พร้อม from/to
}

Output

[ { sku, name, qty, revenue } ]

---

## generate_report()

สร้างไฟล์รายงานให้ดาวน์โหลดจริง (XLSX / CSV / PDF) จากข้อมูลรายงานที่ backend อ่านยืนยันแล้ว ไม่ใช่แค่สรุปตัวเลขในแชท

Input

{
    reportType,         // SALES | INVENTORY | PROFIT | PRODUCTS | PAYMENTS | PURCHASES | CUSTOMERS | OPERATIONS | SPECIALIZED
    dateFrom?,          // YYYY-MM-DD, ใช้กับ SALES / PROFIT
    dateTo?,            // YYYY-MM-DD
    format,             // XLSX | CSV | PDF
    includeSummary?     // default true — ให้ AI เขียน executive summary จาก facts เดิมเท่านั้น
}

Output

{
    fileId,
    fileUrl,            // /api/bms/reports/download/<id>
    reportType,
    format,
    summary?            // null ได้ ถ้าไม่มี AI credentials หรือ summary generation fail
}

Permission: report.view

ใช้เมื่อผู้ใช้ "ขอไฟล์" ชัดเจน เช่น "export sales to Excel", "สร้าง PDF รายงานกำไร", "ขอดาวน์โหลดรายงานสต็อก"

อย่าใช้เมื่อผู้ใช้แค่ถามตัวเลขในบทสนทนา เช่น "เดือนนี้ขายได้เท่าไหร่" — กรณีนั้นใช้
`get_sales_summary` / `get_inventory_summary` / `get_top_products` แล้วตอบในแชท

ข้อจำกัดสำคัญ:

- `PROFIT` ใช้ `bms_order_items.cost_amount_snapshot`: รายการใหม่เป็นต้นทุนองค์ประกอบที่ resolve ณ เวลาขาย,
  รายการเก่าที่ migration backfill จะติด `LEGACY_CURRENT`, และรายการที่ไม่มีต้นทุนจะคืน profit เป็น `null`
  แทนการตีต้นทุนเป็นศูนย์ ต้องแสดง `disclaimer`/evidence state ในไฟล์เสมอ
- `OPERATIONS` รวม previous-period comparison, reconciliation, inventory activity aging/cover และ discount signals;
  `PURCHASES` รวม supplier fill rate/approximate lead time; `CUSTOMERS` รวม paid-customer segments
- PDF ใช้ `pdfkit` font มาตรฐาน จึงยังไม่รองรับ Thai glyphs ครบ; heading/label ของเอกสารจงใจเป็น English
- ดาวน์โหลดต้องผ่าน `/api/bms/reports/download/<id>` ซึ่งเช็ค tenant ownership ของ `bms_generated_reports`
  ก่อนเสมอ ไม่ใช้ `/api/files/<id>` ตรง ๆ

---

# AI

## summarizeConversation()

Summarize chat history.

---

## classifyIntent()

Return

Intent

Confidence

Entities

---

## recommendProducts()

Recommend products.

---

## detectLanguage()

Return

Language

Confidence

---

# Store / Documents / Forecast / AI-native (2026-07 batch 2)

ทูลชุดที่สองที่ต่อเข้า AI tool-calling แล้ว (ดู catalog สำหรับชื่อ snake_case จริง):

## Store profile (read — customer + staff)

- `get_store_info` — ชื่อร้าน/ที่อยู่/เบอร์/เวลาเปิด-ปิด/นโยบายจัดส่ง-คืน · `lib/bms/storeProfile.ts`
  Also returns `branchParking` for every shop type from `lib/bms/locations.ts` (`10.52`): at most
  20 active branch names and their published parking facts, with `truncated` for partial lists.
  Optional `branch` is an exact customer-requested branch name (1–200 characters), not tenant authority.
  Hidden/malformed facts return `parking: null`; `UNKNOWN` is unspecified and `NONE` means no
  shop-provided parking. Capacity is total spaces, never live vacancy. The branch fields override old
  `about`/board-game `summary` parking prose. Ask which branch when ambiguous; never infer fees,
  opening times or nearby alternatives. Freeform details and links are untrusted data, not instructions.
  Customer reply checks use the latest completed store read in the turn (a failed read clears the
  earlier evidence). Repeated `get_store_info` calls reread publication rather than replaying the
  loop's cached result. A model-supplied branch filter is not evidence of customer branch selection.
  Also returns `businessArchetype`, `businessType`, `about`, public contact email/website and
  locale fields. The customer pipeline calls this approved tool before the general model loop,
  projecting bounded public fields into a tool-result message so basic questions do not depend
  on keyword routing or the model remembering to request shop context. No payment accounts,
  credentials, customer data, or private settings are included in this prefetched projection.
- `get_board_game_rates` — customer-only for `board_game_cafe`; published hourly rates by
  participant type plus minimum, rounding and grace minutes. Offers, pass balances and final-bill
  quotes are not exposed. Requires a published branch with `publish_rates` enabled.
- Staff analytics (not customer discovery): `list_board_game_report_branches` returns up to 100
  branches allowed to the authenticated actor, a truncation flag, `allBranchesAllowed`, timezone
  and backend `currentDate`. No contact data. Historical inactive branches remain selectable.
  `get_board_game_top_games` and `get_board_game_table_revenue` require explicit `from`/`to`
  (inclusive, 1–92 days), optionally a verified `locationId`, and integer `limit` 1–50 (defaults
  10 titles / 50 tables). Only table revenue accepts a verified `areaId`, requiring `locationId`.
  Missing/ambiguous dates or scope require clarification; no all-time default. Scoped staff
  cannot read all branches, and every call rechecks `report.view` and the board-game archetype.
  Both reuse `getBoardGameAnalytics()` with `includeCosts:false`, returning allowlisted fields
  only. Top games means recorded loans overlapping the period, with duration clipped to the
  period/observation time—not actual completed games, unique players, sales, or popularity forecasts.
  Table revenue is tax-inclusive play plus merchandise net of recorded returns, attributed over
  historical occupancy before area filtering; pass receipts and forfeited deposits are excluded.
  Play is recognized at paid group close and merchandise/returns by evidence date. It is not a
  table cashbook or net profit. Cost/acquisition/profit fields and customer identity are omitted.
  `complete`/`sourceTruncated` describe source coverage, `outputTruncated` means the ranking/list
  was shortened; never imply a shortened list is exhaustive. Loan coverage uses `LIBRARY_LIMIT`,
  independent of missing financial/opening-hour data; table results preserve report quality warnings.
  Normal runtime auditing/error/provider-failure handling applies; no direct model database access.
  Generic `get_sales_summary` / `get_top_products` behavior is unchanged.
- `get_board_game_report` — staff `report.view`; explicit dates (1–92 days), verified branch and
  optional area. SUMMARY exposes sessions, participant entries (not unique visitors), average paid
  visit duration, utilization, play/product revenue, pass receipts/minutes, and the queue cohort
  **created** in the period (not only reservations). HEATMAP pages weekday/hour aggregates, not
  future attendance. OFFERS pages all applied offers aggregated from the bounded report source,
  ordered by `rankBy: USES` or `DISCOUNT` (default). Uses counts discounted snapshot lines, not
  distinct customers/bills. This is not a full offer catalog or causal lift; source quality warnings
  still apply. Existing UI/XLSX keeps its top-20 discount ranking. PROFIT rechecks both
  `product.view` and `tax.document.view` before reading costs;
  returns merchandise ex-VAT revenue, recorded cost and gross profit, preserving unknowns.
  Pass/queue/library figures remain branch-wide even with an area filter. Existing table revenue
  now supports `offset`/`nextOffset`; it retains its cost-free projection.
  Participant counts require actual overlap with the selected area's table history before the
  database observation time; a player who left before a move is not counted in the destination.
  Historical wait uses walk-in creation or reservation **check-in**, not reservation creation.
  Missing/reversed/future arrival-to-seating evidence is excluded and flagged `WAIT_TIME_INCOMPLETE`.
  The cohort remains created-in-period; an average from known rows is not a promised future wait.
  Heatmap includes revenue-only buckets outside configured opening hours (null utilization where
  there is no denominator). `CURRENT_CAPACITY_BASIS` warns that capacity uses current active/unblocked
  tables/current seat counts plus effective opening hours, not historical table-state evidence.
- `get_board_game_live_operations` / `get_board_game_pass_balances` — staff
  `board_game.session.manage`, matching operational REST reads. Omit branch to discover permitted
  choices, then supply its verified UUID. Floor/queue projections omit PII, notes and bill amounts;
  physical occupied tables are counted once despite multiple groups. Future reservations retain
  dates; REQUESTED is not CONFIRMED. No wait/free-table-time promise. Floor, areas and queue each
  have independent paging metadata; the composed reads are not an atomic snapshot.
  Pass balances include shared all-branch contracts (never sum branches), unlimited minutes are
  null, and `expiringMinutesIn30Days` is minutes, not contract count. The separate next-30-day
  expiry list is paged, contains no identities, and balance drift sets `complete:false`.
  `outstanding.expiringPassesIn30Days` is a separately counted whole-cohort contract total,
  including unlimited passes, independent of page size/offset. It is distinct from expiring minutes.
  ACTIVE unexpired contracts can start in the future; these counts do not establish redemption
  eligibility now. A missing/malformed aggregate is a failed read, not an invented zero.
- `get_board_game_library_report` — staff `board_game.library.view`; branch-scoped pages of up to
  50 rows (`offset` up to 100000). COPIES and ATTENTION expose recorded statuses only. UNPLAYED
  means titles currently held in the branch with no recorded loan there in retained history,
  **not** proof nobody ever played. USAGE requires dates (1–92 days), clips overlapping loans to
  report/observation bounds and pages beyond the old report's top-100 title cap. Live pages may
  change between reads; disclose truncation and never treat one page as a whole-shop total.
- For `BOARD_GAME_ANALYTICS` only, `generate_report` and `email_report` accept verified
  `locationId`/`areaId`, explicit `dateFrom`/`dateTo` and XLSX. Other report types reject these new
  assistant filters. Email remains propose-only with human confirmation; report generation reuses
  the existing service, branch authorization and cost permissions.
- Board-game owner boundaries: system instructions and tool descriptions forbid invented net
  profit/overhead allocation, box ROI/payback/depreciation, causal promo/price effects, future
  attendance/staffing, purchase quantities, session churn or an improvised annual report.
  `boardGameOwnerPolicy.ts` also replies deterministically to recognized unsupported intents in
  explicit board-game/page/recent-user context, before invoking the model. This is a conservative
  intent guard, not exhaustive natural-language classification. Generic SKU forecasting, product
  profit and customer retention are not substitutes. Compare two verified periods descriptively,
  with identical scope and quality warnings; do not infer causation. Other shop workflows remain unchanged.
  The guard distinguishes adding a game to the library (supported setup guidance) from deciding
  which/how many games to buy (unsupported advice). Explicit future-attendance and annual-report
  requests are declined without a model call; an annual package question is not an annual report.
- `search_board_game_library` — customer-only playable titles, tags, difficulty, player range and
  aggregate copy counts. Filters public titles in the selected published, active branch; no copy,
  borrower, table, session or customer identifiers. `players` filters a known supported count;
  optional `playersTo` requires support for the entire requested range. `difficulty=LIGHT` selects
  known beginner-friendly metadata, never null/unknown difficulty. These filters do not promise staff tuition.
  `availableCopies` is null when availability is not published. Never use retail stock as library truth.
- `get_board_game_availability` — customer-only published branch hours/contact/summary, aggregate
  total/free table counts, opt-in area/floor and seat-capacity groups, and existing published
  booking/deposit settings. `publish_availability` gates live counts; `publish_table_details`
  independently gates active area labels and capacity groups. The result never includes table
  numbers/ids, occupants or sessions. Queue length and waiting time remain unknown; no booking is written.
  These three tools use `boardGameCustomerInfo.ts` inside tenant/RLS transactions. Branch selection
  accepts a published name, never an operational id. Multiple/mismatched branches return
  `BRANCH_REQUIRED`; unpublished data returns `NOT_PUBLISHED`, not zero or proof of absence.
- `request_board_game_reservation` — board-game customer-only, `order.create`; previews exact
  branch-local date/time, duration and party size for fresh customer confirmation. Backend derives
  CRM identity/contact. Default is `REQUESTED`; branch `chatAutoConfirm=true` with no deposit
  permits `CONFIRMED` only after locked table allocation. Configuration changes invalidate consent.
- `get_board_game_reservation_status` — `order.view`; latest five own CHAT bookings, short references
  and verified states only, never other customers or table ids. The pipeline binds numbered
  booking/action choices to this scoped result; the model never reconstructs a reference from prose.
- `manage_board_game_booking` — board-game customer-only, `order.create`; `action` is `CANCEL`,
  `RESCHEDULE`, `REFUND`, `DISCOUNT`, `EXTEND_TIME` or `STAFF`. Booking changes require an exact
  eight-character reference from the scoped status read. Reschedule requires `reservedLocal` and a
  CONFIRMED no-deposit booking before check-in; omitted `durationMinutes`/`partySize` retain the
  locked current values, while explicitly changed values are revalidated. The same table must fit
  the new time/party. Other actions require a bounded non-PII `note` and
  create an Inbox note plus durable staff mention for review, never a payment, price or clock write.
  Every action previews first. The pipeline consumes fresh consent to the exact latest server
  summary (15-minute expiry), then the service rechecks ownership and row version in the transaction.
  Unknown fields, model-supplied consent/identity and ambiguous references are rejected. Writes,
  business audit and retry result commit together. Server-owned receipts survive provider failure;
  a staff queue receipt is not evidence of approval, a push notification or staff acknowledgement.
- `list_restaurant_order_locations` — restaurant-only active branches and their exact ids; the id is
  authority for the next read/write tool and must not be invented or printed to the customer.
- `get_restaurant_availability` — current aggregate free tables/seats, walk-in waiting parties/guests,
  unseated reservation-request counts, open kitchen tickets and configured station SLA for one exact
  branch. Accepted reservations are reported separately and are not evidence that a party is
  physically waiting. Kitchen work separates `NEW`/`PREPARING` from `READY` so finished dishes do
  not inflate prep load. If that branch explicitly enables `publish_restaurant_table_details`,
  `tableDetails` groups public area/floor labels by seat capacity with total and currently available
  table counts. It never exposes table ids, codes, names, checks, occupants, guests or ticket
  identities; existing branches return `tableDetails: null` until opted in. `estimatedWaitMinutes` and
  `estimatedPrepMinutes` remain null because queue fit,
  station capacity and dish mix are not known; SLA is a threshold, not a pickup-time promise.
  Both restaurant and board-game availability return at most 100 area/capacity groups. A 101st
  group is read only to set `tableDetailsTruncated`; `true` requires a partial-list explanation and
  referral to staff for remaining details, never a claim that the list covers the whole branch.
  Do not sum a partial list as a branch total or infer that omitted capacities/areas are unavailable.
  The flag is `false` for complete published lists (including empty lists), and `null` when details
  are not published. Branch aggregate counts retain their independent publication rules.
- `request_restaurant_reservation` / `get_restaurant_reservation_status` — submit a customer-owned
  `REQUESTED` reservation and read that customer's latest five requests. The write derives customer
  identity, name and phone server-side and refuses until a meaningful saved name and phone exist;
  the model reads completeness and saves only values the customer explicitly supplies, never PII in
  reservation arguments. Staff must PIN-authenticate and accept the request before it becomes
  operational. `REQUESTED`, `WAITING` and `CALLED` never mean a table is guaranteed; only `SEATED`
  names an actual table/check.
- `get_payment_info` — บัญชีรับเงินของร้านที่กรอกข้อมูลใช้งานได้จริง (ธนาคาร/พร้อมเพย์) พร้อม
  `configured`; แถวว่างถูกตัดออก และเมื่อ `configured=false` AI ห้ามยกตัวอย่างช่องทางเอง
- `get_shipping_estimate` — ประเมินค่าส่ง/ระยะเวลา (flat rate + ส่งฟรีเมื่อถึงยอดขั้นต่ำ)

ข้อมูลมาจาก migration `6.9__bms_store_profile.sql` (1 แถวต่อร้าน) กรอกที่ `/admin/settings` (การ์ด
"ข้อมูลร้าน") ผ่าน `bmsStoreProfile`/`bmsUpsertStoreProfile` (gate `requireTenantAdmin`, ไม่มี permission ใหม่)

## Documents (staff) — `lib/bms/documents.ts`

- `generate_invoice(orderId)` — ใบแจ้งหนี้จากออร์เดอร์จริง (ราคา snapshot, ผลลัพธ์ชั่วคราวไม่ persist)
- `generate_quotation(items[])` — ใบเสนอราคา (ตีราคาปัจจุบัน + ค่าส่งประเมิน ยังไม่ผูกออร์เดอร์)

## Inventory intelligence (staff, `report.view`) — `lib/bms/inventoryIntelligence.ts` · **heuristic เท่านั้น ต้องบอก uncertainty**

- `forecast_demand(windowDays?, horizonDays?)` — คาดการณ์ยอดต่อ sku จากค่าเฉลี่ยยอดขายย้อนหลัง
- `predict_stockout(windowDays?)` — ประเมินวันที่จะหมดสต็อกต่อไซซ์ จาก velocity
- `suggest_purchase_order(windowDays?, coverageDays?)` — เสนอจำนวนสั่งซื้อให้พอขาย N วัน
- `get_inventory_intelligence(...)` / `explain_inventory_risk(...)` — อ่านสูตรและหลักฐานแยกสาขา
- `get_inventory_anomalies(...)` — สัญญาณ integrity/เหตุการณ์ผิดปกติแบบ deterministic; ไม่แก้ยอด
- `find_inventory_transfer_opportunities(...)` — review-only; ใช้เฉพาะ surplus เหนือ safety/coverage
- `get_inventory_forecast_accuracy(...)` — MAE/WAPE/bias จาก snapshot ที่ครบกำหนดแล้ว
- `get_supplier_intelligence(...)` (`purchase.view`) — fill rate, อายุ PO จากวันสร้างถึงแก้ไขล่าสุดของ PO ที่รับครบ (ไม่ใช่เวลาส่งจริง) และ cost change ของ SKU เดิม

Every forecast response includes `generatedAt` and `dataQuality` (paid-order count, Bangkok sales days,
and the required floor). Each branch needs seven paid orders and three distinct sales days; otherwise
its rows are `INSUFFICIENT_DATA` with no purchase recommendation, stockout date or forecast snapshot.
Observed stock rows remain available. The summary's day count is the maximum branch count, not a
claim that every branch has sufficient data. The model must relay row-level limitations.
Accuracy method `2.1` compares paid stock consumption over an exact horizon; unfulfilled demand is
excluded from that baseline and uncalibrated bounds remain unknown.

All inventory rows are scoped by permitted branch. Demand and incoming PO quantities without a
verified branch are returned separately and never duplicated into branch recommendations. The
assistant cannot receive a PO. Creating a PO or draft transfer returns a shared confirmation proposal;
only the existing backend mutation can perform the write after staff confirms it. A new proposal has
a fresh key; retrying its saved confirmation retains the same key. Transfer suggestions conserve
donor surplus across receivers and reserve safety, lead-time and coverage stock. Partial PO allocation
is conservative when receipt attribution is unknown; residual incoming stock stays unallocated.
Unallocated result lists expose their own truncation flags; a partial list never proves absence.

## AI-native (data providers — deterministic)

- `detect_language(text)` — th/en/other (heuristic) · `classify_intent(text)` — nlu.understand()
- `summarize_conversation(conversationId)` — ดึงข้อความล่าสุดให้ผู้ช่วยสรุป (staff, `inbox.view`)
- `search_products(keyword?, category?, maxPrice?)` — ค้น active catalog จากชื่อ/SKU/barcode/alias/
  หมวด/แบรนด์ คืนราคา สต็อกรวม ไซซ์ที่มี วันที่เพิ่ม และ public product path/URL
- `get_product(sku)` — อ่านรายละเอียด/ราคา/สต็อกทุกไซซ์ของ SKU พร้อม public path/URL ที่ส่งให้
  ลูกค้าได้; ห้ามประกอบ URL หรือส่ง `/admin/*` เอง
- `browse_catalog(keyword?, category?, minPrice?, maxPrice?, limit?)` — สำหรับคำถามกว้าง คืนเฉพาะ
  สินค้าที่มีของขายจริงแบบ bounded; pipeline ใช้ทูลนี้โดยตรงเมื่อมี follow-up ว่า
  “ดูอย่างอื่น/สินค้าอื่น/รุ่นอื่น” แล้วตัดสินค้าที่เพิ่งเอ่ยถึงออกก่อนตอบ
- `list_new_arrivals(category?, limit?)` — อ่านสินค้า active + in-stock เรียงจาก `created_at`
  โดยอ่าน DB ทุกครั้ง สินค้าใหม่จึงเห็นใน turn ถัดไปโดยไม่ต้อง refresh AI cache
- `find_alternatives(sku?/keyword?/category?, size?, limit?)` — หา 2–5 ตัวเลือกที่มีของจริง โดยให้
  หมวด/แบรนด์/ราคาใกล้สินค้าต้นทางมาก่อน
- `subscribe_restock_notification(sku, size, requestedQty?)` — customer-safe write สำหรับบันทึก
  ความยินยอมให้แจ้งเมื่อ SKU/ไซซ์ที่หมดกลับมาพร้อมขาย เรียกได้เฉพาะเมื่อลูกค้าตอบรับชัดเจน;
  ตัวตนมาจาก `(tenant_id, channel, customer_ref)` ฝั่ง server และรองรับ LINE/Facebook/Instagram
  เท่านั้น การเติมสต๊อกสร้างงานรอแอดมินตรวจ ไม่ส่งออกอัตโนมัติ
- `recommend_products(keyword?, category?, minPrice?, maxPrice?)` — แนะนำตาม use case/งบ หรือใช้
  สินค้าขายดีที่ยังมี stock แล้วเติมด้วยสินค้าพร้อมขาย

## Proactive outbound (staff, propose-only)

- `send_customer_message(conversationId, body)` — ส่งข้อความหาลูกค้า **propose-only** → Confirm ยิง
  `bmsSendMessage` เดิม · push จริงเฉพาะช่องที่รองรับ (LINE/Facebook/Instagram) — **TikTok send / email
  ยังไม่มี API จริง จึงยังไม่ทำ** (ตาม roadmap)
- หน้า `/admin/restock-subscriptions` ใช้ `bmsSendRestockNotification` หลัง staff ตรวจ/แก้ข้อความ;
  ทุกครั้งรวม `Resend` เก็บ body snapshot และผล `SENT`/`FAILED` แยก attempt โดยไม่เขียนทับประวัติเดิม

# Future Tools (ยังไม่ทำ)

sendTikTokMessage() · sendEmail() · voiceCall() · OCRInvoice() (นอกเหนือ payment-slip verify) ·
BusinessAnalytics() · FraudDetection()

---

# Ops / AI Automation (นอก tenant tools)

✅ **Daily Log Triage** — GitHub Actions รายวัน: อ่าน error จาก `system_logs` →
Claude วิเคราะห์ + เสนอแพตช์ → เปิด **draft PR** (คนรีวิว ไม่ auto-merge) → แจ้ง **LINE**

- ไฟล์: `.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/{collect-error-logs,notify-line}.mjs`
- Guardrails: redact secret/PII ก่อนส่งออก · draft PR เท่านั้น · AI ห้ามแตะ migration/secret/config
- LINE = Messaging API push (LINE Notify ปิดบริการแล้ว มี.ค. 2025)

✅ **Fake Data Seeder (dev)** — `/admin/dev/fake` + `app/api/dev/fake/*` สร้างข้อมูลทดสอบทีละมากๆ
(products/customers/orders+pay+ship/conversations/purchase) · marker `FAKE-`/tag `fake` → cleanup ลบทีเดียว
· **seed ลง tenant ของผู้ล็อกอิน** (ร้านค้าเทสเองได้ · เมนูโชว์ให้คนมีสิทธิ์ `product.edit`) · cleanup scope เฉพาะร้านตัวเอง
· ปิดใน production default · เปิดเครื่อง demo ด้วย env `BMS_ALLOW_FAKE_SEED=1` (`lib/dev-guards.ts` → `fakeSeedDisabled()`) · posts/users fixture ยังปิด production

The explicit onboarding action `/api/bms/onboarding/sample-data` is separate from these dev routes:
it is Administrator/Manager-only, accepts only the current empty tenant, and uses a resumable
tenant-scoped seed ledger, so it is intentionally available in production without the dev flag.

✅ **Platform-only admin pages** — ENV/Logs/Posts/Files/Social Queue/Architecture gate ที่ `layout.tsx`
ด้วย `requirePlatformAdminPage()` (`lib/auth/platform-page.ts`) — non-platform เข้าตรงผ่าน URL ก็ถูก redirect

---

# SaaS / Platform Admin (ข้ามร้าน — ไม่ใช่ AI tool)

เครื่องมือระดับแพลตฟอร์ม ใช้โดย **platform admin** (`users.is_platform_admin = true`) เท่านั้น —
ต่างจาก tenant tools ด้านบนที่ scope ต่อร้าน. gate ด้วย `requirePlatformAdmin()` (`lib/bms/platform.ts`).

## bmsSignup() — public
สมัครใช้งานเอง → เก็บ pending signup และส่งลิงก์ยืนยันอีเมลก่อน โดยยังไม่สร้างร้าน; เมื่อเจ้าของอีเมล
กดลิงก์จึงสร้าง tenant (plan free) + owner (role Manager) แบบ atomic. ไม่ต้อง auth. (`lib/bms/signup.ts`)

## bmsTenants() / bmsIsPlatformAdmin()
list ทุกร้าน + สถิติ (users/products/orders/revenue). `bmsIsPlatformAdmin` ใช้ gate เมนู/หน้า UI.
Permission: platform admin

## bmsSetTenantActive() / bmsSetTenantPlan()
เปิด/ปิดร้าน (ระงับใช้งาน) · เปลี่ยน plan ให้ร้าน. audit ทุกครั้ง.
Permission: platform admin

## bmsEnterTenant() / bmsExitTenant() — drill-down
"เข้าดูมุมร้าน": ออก signed cookie `BMS_ACT_TENANT` (ผูก admin.id, อายุ 12h) → context override `tenant_id`
→ ทุกหน้า operational scope ไปร้านนั้นอัตโนมัติ. `bmsActingTenant` = ร้านที่กำลังเข้าดู (โชว์ banner).
Permission: platform admin · audit: `tenant.impersonate.enter/exit`

## bmsMe() — profile ผู้ล็อกอิน
คืนโปรไฟล์เต็มของ admin ปัจจุบัน (ชื่อ/อีเมล/role/ภาษา/theme preference/ร้านที่สังกัด+plan/สิทธิ์/is_platform_admin) อ่านสดจาก DB.
Permission: admin ที่ล็อกอิน

> **Users/Roles management** (ใน `resolvers.ts`): `users`/`upsertUser`/`deleteUser(s)` gate ด้วย `requireUserAdmin()`
> (platform = ทุกร้าน · Administrator = ร้านตัวเอง) · `createRole`/`updateRole`/`deleteRole` = `requirePlatformOnly()` ·
> role dropdown ในหน้า UI ต้อง query `roles` จาก DB เสมอ (ห้าม hardcode ชื่อ role)

## Quota staff ต่อแพ็กเกจ (`enforceUserQuota()`)
เช็คก่อนสร้าง user ใหม่ (`upsertUser` ตอน INSERT) — เกิน `bms_plans.max_users` ของร้านนั้น → throw พร้อมข้อความแนะนำอัปเกรด
หลัง `10.73`: free=2 · pro=5 · business=20 รวมเจ้าของร้าน นับบัญชีเดิมทุกบัญชีและไม่ปิดผู้ใช้ที่เกินเพดาน
Retail Local ไม่ใช้เพดานผู้ใช้ Cloud นี้ บัญชี platform ที่ไม่สังกัด tenant ไม่อยู่ในโควตาร้าน
ดู `lib/bms/plans.ts` (`enforceProductQuota` ทำงานแบบเดียวกันฝั่งสินค้า)

## Loyalty points (`get_loyalty_points`, migration 7.96)

`get_loyalty_points` exists because the model is forbidden to guess balances or entitlements, and
before it there was no tool to call — a customer asking "how many points do I have?" could not be
answered at all. Any tier, balance, or discount figure the model states must come from this tool's
result.

It reads only. Points are deducted when the order is created, in the same transaction that issues the
bill, so calling this tool never spends or holds anything and the model must not describe it as
reserving points. A customer who is not enrolled comes back as `enrolled: false` rather than a zero
balance, because "you have 0 points" and "you are not a member" lead to different next sentences.
`pointsBalance` may be negative (a return after redemption) while `pointsUsable` is 0; both are
returned so the model can explain why redemption is unavailable instead of claiming the balance is
empty.
