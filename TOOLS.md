# TOOLS.md

This file defines every tool available to AI.

AI MUST only call tools defined here.

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

---

## verifyPaymentSlip()

OCR / AI Validation → **แนะนำเท่านั้น** (ไม่เปลี่ยนสถานะ ตาม BUSINESS_RULES: AI ห้ามยืนยันเงินเอง)

- ไม่มี ANTHROPIC_API_KEY หรือไม่มีรูปสลิป → heuristic (ให้ตรวจเอง)
- มี key + slipUrl เป็นรูป → Claude vision สกัด amount/date/ref แล้วเทียบยอด

Input

{
    paymentId
}

Output

{
    method,             // ai | heuristic
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

✅ Implemented — service `lib/bms/shipping.ts`, migration `5.4__bms_shipments.sql`,
REST `/api/bms/shipment*`, GraphQL `bmsShipment*`, admin UI `/admin/shipment`.

carriers: FLASH / KERRY / DHL / AUSPOST / NZPOST / OTHER
flow: PENDING → SHIPPED → IN_TRANSIT → DELIVERED (└→ RETURNED / CANCELLED)

## createShipment()

ผูก carrier/tracking + ship จริง: order PACKING → SHIPPED + ตัดสต็อก + SHIP movement (atomic)
ถ้า order = SHIPPED อยู่แล้ว จะแค่แนบ shipment (ไม่ตัดสต็อกซ้ำ)

Input

{
    orderId,
    carrier,            // FLASH | KERRY | DHL | AUSPOST | NZPOST | OTHER
    trackingNo?,
    note?
}

Output

{
    status,             // CREATED
    shipmentId,
    orderShipped        // true = ตัดสต็อก/ship ในครั้งนี้
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

## getShipmentLabel()

ข้อมูลสำหรับพิมพ์ใบปะหน้า (order + ผู้รับ + ที่อยู่ + รายการ)
ยังไม่ผูก carrier API จริง — สำหรับพิมพ์/คัดลอกด้วยตนเอง

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

โน้ตภายใน (ลูกค้าไม่เห็น) · timeline รวม message + note + order เรียงตามเวลา

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

---

## mergeCustomers() — ผสานลูกค้าซ้ำข้ามช่องทาง

ลูกค้าคนเดียวกันทักมาคนละช่องทาง (เช่น LINE แล้วก็ FB) จะถูก `resolveOrCreateCustomer`
สร้างเป็นคนละ `bms_customers` record เพราะจับคู่ตาม `(tenant_id, channel, external_ref)` เท่านั้น —
`mergeCustomers(tenantId, keepId, mergeId)` ใช้ยุบ record ซ้ำเข้าด้วยกันด้วยมือ:

- ย้าย `bms_customer_identities` / `bms_orders` / `bms_customer_addresses` / `bms_conversations`
  ทั้งหมดจาก `mergeId` ไป `keepId` (ปลอดภัย ไม่ชนกัน เพราะ identity unique ต่อ tenant+channel+ref อยู่แล้ว)
- รวม tags (union), เติม phone/note ที่ `keepId` ไม่มีจาก `mergeId`
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

- อ่าน channel/customer_ref + รายการสินค้า (sku, size, qty) จากออร์เดอร์ต้นทาง
- เรียก `createOrder()` เดิมทั้งชุด (จองสต็อกแบบ atomic + ตัดราคาปัจจุบันของสินค้าใหม่ — **ไม่ใช่ราคาย้อนหลัง**)
- **ไม่มีสถานะ "Draft" แยก** — ออร์เดอร์ใหม่เริ่มที่ `PENDING` พร้อมจองสต็อกทันที เหมือนออร์เดอร์ปกติทุกใบ

Input

{
    id   # orderId ของออร์เดอร์เก่าที่จะสั่งซ้ำ
}

Output: `{ status, orderId, total, message }` — `status` หนึ่งใน
`CREATED` / `INSUFFICIENT` (สต็อกไม่พอ) / `NOT_FOUND` (สินค้าถูกลบ/ปิด active ไปแล้ว) /
`EMPTY` (ออร์เดอร์ต้นทางไม่มีรายการ) / `SOURCE_NOT_FOUND`

Permission: **order.create** (permission ใหม่ — เดิม order ถูกสร้างจาก AI/REST เท่านั้นไม่เคยผ่าน
permission gate มาก่อน · seed ให้ Manager/Sales ที่ migration `6.1__bms_order_create_perm.sql`)

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

ยอดขายตามช่วงวันที่ (default = 30 วันล่าสุด) — revenue นับเฉพาะ PAID ขึ้นไป

Input

{
    from,               // YYYY-MM-DD (เว้นได้)
    to
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

Input

{
    from, to,               // YYYY-MM-DD (เว้นได้)
    limit                   // default 10
}

Output

[ { sku, name, qty, revenue } ]

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

# Future Tools

forecastDemand()

predictStockOut()

suggestPurchaseOrder()

generateInvoice()

generateQuotation()

sendLINEMessage()

sendTikTokMessage()

sendEmail()

voiceCall()

OCRInvoice()

AIForecast()

BusinessAnalytics()

FraudDetection()

DemandPrediction()

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

✅ **Platform-only admin pages** — ENV/Logs/Posts/Files/Social Queue/Architecture gate ที่ `layout.tsx`
ด้วย `requirePlatformAdminPage()` (`lib/auth/platform-page.ts`) — non-platform เข้าตรงผ่าน URL ก็ถูก redirect

---

# SaaS / Platform Admin (ข้ามร้าน — ไม่ใช่ AI tool)

เครื่องมือระดับแพลตฟอร์ม ใช้โดย **platform admin** (`users.is_platform_admin = true`) เท่านั้น —
ต่างจาก tenant tools ด้านบนที่ scope ต่อร้าน. gate ด้วย `requirePlatformAdmin()` (`lib/bms/platform.ts`).

## bmsSignup() — public
สมัครใช้งานเอง → สร้าง tenant (plan free) + owner (role Manager). ไม่ต้อง auth. (`lib/bms/signup.ts`)

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
คืนโปรไฟล์เต็มของ admin ปัจจุบัน (ชื่อ/อีเมล/role/ภาษา/ร้านที่สังกัด+plan/สิทธิ์/is_platform_admin) อ่านสดจาก DB.
Permission: admin ที่ล็อกอิน

> **Users/Roles management** (ใน `resolvers.ts`): `users`/`upsertUser`/`deleteUser(s)` gate ด้วย `requireUserAdmin()`
> (platform = ทุกร้าน · Administrator = ร้านตัวเอง) · `createRole`/`updateRole`/`deleteRole` = `requirePlatformOnly()` ·
> role dropdown ในหน้า UI ต้อง query `roles` จาก DB เสมอ (ห้าม hardcode ชื่อ role)

## Quota staff ต่อแพ็กเกจ (`enforceUserQuota()`)
เช็คก่อนสร้าง user ใหม่ (`upsertUser` ตอน INSERT) — เกิน `bms_plans.max_users` ของร้านนั้น → throw พร้อมข้อความแนะนำอัปเกรด
free=3 · pro=10 · business=ไม่จำกัด (`-1`). **platform admin ไม่ถูกจำกัด**. ดู `lib/bms/plans.ts` (`enforceProductQuota` ทำงานแบบเดียวกันฝั่งสินค้า)