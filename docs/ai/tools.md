# AI Tool Catalog

> Entry point: [CLAUDE.md](../../CLAUDE.md) · AI pipeline: [workflow.md](workflow.md) · Prompts/guardrails: [prompts.md](prompts.md)

The **authoritative AI registry** is the snake_case matrix below and
[`lib/bms/tools/catalog.ts`](../../apps/web/lib/bms/tools/catalog.ts). Later camelCase sections also
document backend/service capabilities; a service listed there is not exposed to AI unless it is in
the authoritative registry. AI MUST call only registered tools.

## Wiring status (2026-07 — AI tool-calling)

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

## Authoritative runtime registry and gates

`—` means no staff RBAC permission is needed because the data is customer-safe/public or the tool
is a local deterministic helper. “Customer” is an explicit surface allowlist, not a staff role.

| Tools | Class | Customer | Staff permission | Execution |
| --- | --- | --- | --- | --- |
| `search_products`, `browse_catalog`, `list_new_arrivals`, `find_alternatives`, `get_product`, `check_stock`, `recommend_products` | A1 | yes | `product.view` | read |
| `list_customer_coupons`, `list_available_coupons`, `check_coupon` | A1 | yes | `coupon.view` | read / backend validation |
| `get_loyalty_points` | A1 | own `(channel, customer_ref)` only | `member.view` | read; never redeems |
| `get_order_status` | A1 | own `(channel, customer_ref)` only | `order.view` | read |
| `get_customer_checkout` | A1 | own `(channel, customer_ref)` only | — | completeness read; no raw PII |
| `get_store_info`, `get_payment_info`, `get_shipping_estimate`, `detect_language` | A1/helper | yes | — | read/deterministic |
| `list_low_stock`, `get_inventory_summary`, `get_sales_summary`, `get_top_products`, `get_dashboard`, `generate_report` | A1 | no | `report.view` | read / file export |
| `get_customer`, `list_customers`, `customer_orders` | A1 | no | `customer.view` | read |
| `list_shipments`, `get_shipment_label` | A1 | no | `shipping.view` | read |
| `list_payments` | A1 | no | `payment.view` | read |
| `list_purchase_orders`, `get_purchase_order`, `list_suppliers` | A1 | no | `purchase.view` | read |
| `generate_invoice`, `generate_quotation` | A1 | no | `order.view` | ephemeral document data |
| `forecast_demand`, `predict_stockout`, `suggest_purchase_order` | A1 | no | `report.view` | heuristic/read |
| `summarize_conversation` | A1 | no | `inbox.view` | read |
| `classify_intent` | helper | no | — | deterministic |
| `create_order`, `reorder` | A2 | own identity; customer `reorder` defaults to latest own order; pharmacy SKU must pass approved backend Product Policy | `order.create` | execute + domain audit + deterministic signed checkout link |
| `subscribe_restock_notification` | A2 | explicit opt-in for own channel identity | — | save waitlist entry; staff reviews before outbound |
| `save_customer_checkout_details` | A2 | own `(channel, customer_ref)` only | — | save only delivery fields explicitly supplied by that customer |
| `submit_payment` | A2 | own order only | `payment.submit` | create PENDING + domain audit |
| `create_shipment` | A2 | no | `shipping.create` | execute + domain audit |
| `update_tracking`, `set_shipment_status` | A2 | no | `shipping.update` | execute + domain audit |
| `create_purchase_order` | A2 | no | `purchase.edit` | execute + domain audit |
| `receive_purchase_order` | A2 | no | `purchase.receive` | execute + domain audit |
| `upsert_customer`, `set_customer_tags` | A2 | no | `customer.edit` | execute + domain audit |
| `assign_conversation` | A2 | no | `inbox.assign` | execute + domain audit |
| `set_conversation_status`, `set_conversation_tags`, `add_note` | A2 | no | `inbox.manage` | execute + domain audit |
| `verify_payment_slip` | advisory | no | `payment.confirm` | read/advisory only |
| `confirm_payment`, `reject_payment` | A3 | no | `payment.confirm` | proposal only |
| `refund_payment` | A3 | no | `payment.refund` | proposal only |
| `cancel_order` | A3 | no | `order.cancel` | proposal only |
| `return_order` | A3 | no | `order.return` | proposal only |
| `adjust_stock` | A3 | no | `stock.adjust` | proposal only |
| `merge_customers` | A3 | no | `customer.edit` | proposal only |
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

✅ Implemented — service `lib/bms/purchase.ts`, migration `5.2__bms_purchase.sql`,
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
        unitCost?       // ทุน/หน่วย (snapshot)
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

## getPurchaseOrder() / listPurchaseOrders() / listSuppliers()

อ่านใบสั่งซื้อ + ประวัติ supplier (Supplier History)

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
`mergeCustomers(tenantId, keepId, mergeId)` ใช้ยุบ record ซ้ำเข้าด้วยกันด้วยมือ:

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

UI: `/admin/customers` → ปุ่ม **"ผสาน"** ต่อแถว → ค้นหา record ซ้ำ → เลือก → ยืนยัน

Input

{
    keepId,   # ลูกค้าหลักที่จะเก็บไว้
    mergeId   # ลูกค้าซ้ำที่จะยุบเข้ามาแล้วลบ
}

Permission: customer.edit · บันทึก audit action `customer.merge`

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
    reportType,         // SALES | INVENTORY | PROFIT
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

- `PROFIT` เป็น **ค่าประมาณ** เพราะ cost มาจาก `bms_products.cost_price` ปัจจุบัน ไม่ใช่ snapshot ณ วันขาย
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
- `get_payment_info` — บัญชีรับเงินของร้านที่กรอกข้อมูลใช้งานได้จริง (ธนาคาร/พร้อมเพย์) พร้อม
  `configured`; แถวว่างถูกตัดออก และเมื่อ `configured=false` AI ห้ามยกตัวอย่างช่องทางเอง
- `get_shipping_estimate` — ประเมินค่าส่ง/ระยะเวลา (flat rate + ส่งฟรีเมื่อถึงยอดขั้นต่ำ)

ข้อมูลมาจาก migration `6.9__bms_store_profile.sql` (1 แถวต่อร้าน) กรอกที่ `/admin/settings` (การ์ด
"ข้อมูลร้าน") ผ่าน `bmsStoreProfile`/`bmsUpsertStoreProfile` (gate `requireTenantAdmin`, ไม่มี permission ใหม่)

## Documents (staff) — `lib/bms/documents.ts`

- `generate_invoice(orderId)` — ใบแจ้งหนี้จากออร์เดอร์จริง (ราคา snapshot, ผลลัพธ์ชั่วคราวไม่ persist)
- `generate_quotation(items[])` — ใบเสนอราคา (ตีราคาปัจจุบัน + ค่าส่งประเมิน ยังไม่ผูกออร์เดอร์)

## Forecast (staff, `report.view`) — `lib/bms/forecast.ts` · **heuristic เท่านั้น ต้องบอก uncertainty**

- `forecast_demand(windowDays?, horizonDays?)` — คาดการณ์ยอดต่อ sku จากค่าเฉลี่ยยอดขายย้อนหลัง
- `predict_stockout(windowDays?)` — ประเมินวันที่จะหมดสต็อกต่อไซซ์ จาก velocity
- `suggest_purchase_order(windowDays?, coverageDays?)` — เสนอจำนวนสั่งซื้อให้พอขาย N วัน

Every forecast response includes `generatedAt` and `dataQuality` (paid-order count, distinct Bangkok
sales days, and the required floor). Fewer than seven paid orders or three distinct sales days
returns `INSUFFICIENT`, no items, and an explicit reason. The model must relay that limitation and
must not turn absence of history into a demand prediction.

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
free=3 · pro=10 · business=ไม่จำกัด (`-1`). **platform admin ไม่ถูกจำกัด**. ดู `lib/bms/plans.ts` (`enforceProductQuota` ทำงานแบบเดียวกันฝั่งสินค้า)

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
