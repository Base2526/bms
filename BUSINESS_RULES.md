# BUSINESS_RULES.md

# AI Business Management System (AI-BMS)

This document defines all business rules.

AI MUST follow these rules.

Business logic belongs here.

Never duplicate business logic inside AI prompts.

> **Implementation status (2026-07):** โมดูลเชิงปฏิบัติการทั้งหมดสร้างเสร็จแล้ว —
> Products/IMS, Orders (OMS), Purchase (PO), Payment, Shipping, CRM, Omnichannel Inbox,
> Reports, Channels (LINE/TikTok/Facebook/Instagram/Web), Multi-tenant + RLS + RBAC + Billing.
> business logic อยู่ใน `apps/web/lib/bms/*` (ที่เดียว ใช้ร่วม REST + GraphQL) — ดู mapping ใน TOOLS.md
> ค่า enum จริงในโค้ดระบุไว้ในแต่ละหัวข้อด้านล่างด้วย (บางชื่อกระชับกว่าในสเปกเดิม)

---

# Customer

A customer may come from multiple channels.

Example

LINE

TikTok

Facebook

Website

may belong to the same customer.

Customer matching priority:

1. Customer ID
2. LINE User ID
3. TikTok User ID
4. Facebook ID
5. Email
6. Phone Number

One customer can have multiple shipping addresses.

Customer must never be deleted.

Use Soft Delete only.

> **Implemented — Address management (`bms_customer_addresses`):** เพิ่ม/**แก้ไข**/**ตั้งเป็นค่าเริ่มต้น**/**ลบ**
> ได้ต่อรายการจากหน้า Customers (กางแถว) · ตั้งค่าเริ่มต้นใหม่จะยกเลิกค่าเริ่มต้นเดิมของลูกค้าคนนั้นอัตโนมัติ
> (permission: `customer.edit`) · ลบที่อยู่ไม่กระทบลูกค้า/ออเดอร์ (address เป็น record แยก ไม่ผูก FK จากออเดอร์)

---

# Product

SKU must be unique.

Barcode should be unique.

Inactive products cannot be sold.

Product price cannot be negative.

Product stock cannot be negative unless AllowNegativeStock is enabled.

> **Implemented — Product detail (`bms_products`, migration `5.9`):** `image_url` (upload ผ่าน
> `/api/bms/products/upload`, ≤10MB, image/* เท่านั้น) · `description` · `cost_price` (ต้นทุน — ใช้คำนวณกำไร
> `price − cost_price` ในหน้า Products, ยังไม่รวมใน Reports) · `category` / `brand` (ข้อความอิสระ ไม่ใช่ FK,
> autocomplete จากค่าที่เคยใช้ในร้าน). ทุก field เป็น optional ยกเว้น sku/name/price เดิม

---

# Inventory

Inventory is the source of truth.

Current Stock

=

Available Stock

+

Reserved Stock

Available Stock

=

Current Stock

-

Reserved Stock

Every stock change MUST generate Stock Movement.

Never update inventory directly.

Always use Inventory Service.

Movement Types

> **Implemented (`bms_stock_movements.type`):** `STOCK_IN` · `STOCK_OUT` · `RESERVE` · `RELEASE` · `SHIP` · `RETURN`
> (TRANSFER / ADJUSTMENT / DAMAGED = roadmap; ADJUSTMENT ปัจจุบันบันทึกเป็น STOCK_IN/STOCK_OUT)

STOCK_IN — ปรับสต็อกเพิ่ม หรือรับของจาก Purchase Order (receive)

STOCK_OUT — ปรับสต็อกลด

RESERVE — สร้าง order (จองสต็อก)

RELEASE — ยกเลิก order / auto-release (คืนจอง)

SHIP — จัดส่ง (ตัดของออกถาวร: current − qty, reserved − qty)

RETURN — คืนสินค้า (คืนของเข้าคลัง)

---

# Orders

> **Implemented (`bms_orders.status`):** `PENDING` → `PAID` → `PACKING` → `SHIPPED` → `COMPLETED`
> · `CANCELLED` (คืน reserved ก่อนส่ง) · `RETURNED` (คืนสต็อกหลังส่ง)
> ระบบสร้าง order ที่ PENDING พร้อม reserve เลย (ไม่มีสถานะ Draft แยก) ·
> การคืนเงินจัดการที่ Payment (`REFUNDED`) คู่กับ order `RETURNED`
> ทุก transition เป็น **atomic** (กัน oversell / ตัดสต็อกซ้ำ)

Order lifecycle

Draft

↓

Pending Payment

↓

Paid

↓

Packing

↓

Shipped

↓

Completed

Cancelled

Refunded

Rules

Draft

No stock deducted.

Pending Payment

Reserve stock.

Paid

Keep stock reserved.

Packing

Stock already reserved.

Shipped

Deduct stock permanently.

Completed

No further changes.

Cancelled

Release reserved stock.

Refunded

Return stock only if goods received back.

---

# Payments

Payment Methods

Bank Transfer

QR Payment

Credit Card

Cash

TikTok Payment

Rules

Order cannot move to Paid without payment verification.

AI may verify payment slip.

Only backend confirms payment.

> **Implemented (`bms_payments`):** method = `BANK_TRANSFER` / `QR` / `CARD` / `TIKTOK` / `CASH` ·
> status = `PENDING` → `CONFIRMED` (→ order PAID, atomic) · `REJECTED` · `REFUNDED` (สิทธิ์ manager)
> `verifyPaymentSlip()` = Claude vision อ่านสลิปเทียบยอด → **แนะนำเท่านั้น ไม่เปลี่ยนสถานะ**
> (คนต้องกด confirm) · permissions: `payment.submit/confirm/refund/view`

---

# Shipping

Tracking Number required before Shipped.

Shipping Provider

Flash

Kerry

DHL

Australia Post

NZ Post

Order cannot be Completed before Shipped.

> **Implemented (`bms_shipments`):** carrier = `FLASH` / `KERRY` / `DHL` / `AUSPOST` / `NZPOST` / `OTHER` ·
> status = `PENDING` → `SHIPPED` → `IN_TRANSIT` → `DELIVERED` (└→ `RETURNED` / `CANCELLED`) ·
> `createShipment` จาก order PACKING → ตัดสต็อก + order SHIPPED · `DELIVERED` → order COMPLETED ·
> label เป็นข้อมูล (ยังไม่ต่อ carrier API) · permissions: `shipping.create/update/view`

---

# Purchase Orders

Status

> **Implemented (`bms_purchase_orders.status`):** `OPEN` → `PARTIAL` → `RECEIVED` (└→ `CANCELLED`)

Draft → OPEN

Ordered → OPEN

Partially Received → PARTIAL

Received → RECEIVED

Cancelled → CANCELLED

Receiving goods automatically increases inventory (STOCK_IN movement).

Cancelled PO cannot receive products. Cancel ได้เฉพาะก่อนรับครบ — ของที่รับไปแล้วไม่ถูกดึงออก.

permissions: `purchase.edit/receive/cancel/view`

---

# CRM

Every conversation belongs to one customer.

Conversation must never be deleted.

Internal notes are not visible to customers.

> **Implemented — Omnichannel Inbox (`bms_conversations` / `bms_messages` / `bms_conversation_notes`):**
> ทุกข้อความจากทุกช่องทาง (+ คำตอบ AI) ถูกบันทึกอัตโนมัติ (`logConversation`) · 1 บทสนทนา =
> (tenant, channel, customer_ref) · assign staff · status OPEN/PENDING/CLOSED · tags · โน้ตภายใน (`inbox.manage` เท่านั้นที่เพิ่มได้) ·
> timeline (message + note + order) · staff ตอบเองได้ (`sendStaffMessage`) · แนบรูป/ไฟล์ (`meta.attachment`) ·
> permissions: `inbox.view/reply/manage`
>
> **สถานะข้อความ (outbound, Phase 1):** `SENDING` (optimistic ฝั่ง client) → `SENT` / `FAILED` (เก็บใน `meta.status`) ·
> **capability-gated ตามช่องทาง** — LINE/FB/IG push ได้จริง → fail ได้จริง + ปุ่ม "ส่งใหม่" (`bmsRetryMessage`) ·
> web/TikTok ไม่ push (แค่บันทึก) → ไม่มีสถานะ fail หลอก, โชว์ "บันทึกแล้ว" แทน · **ไม่ทำ read receipt บนช่องที่รายงานไม่ได้จริง** (LINE/TikTok)

---

# AI Rules

AI NEVER accesses database directly.

AI NEVER writes SQL.

AI NEVER updates database directly.

AI ONLY calls approved tools.

AI should ask for confirmation before

Deleting

Refunding

Cancelling

Changing price

Adjusting inventory

---

# Security

All write operations require authenticated users.

Every write operation must be logged.

Audit Log includes

User

Timestamp

Action

Before

After

Reason

> **Implemented — Observability + Daily AI Log Triage:** log แบบ structured เก็บใน `system_logs` ·
> GitHub Actions รายวันอ่าน error → Claude เสนอแพตช์ → **draft PR** (คนรีวิว ไม่ auto-merge) → แจ้ง LINE ·
> log ถูก **redact** (email/phone/token/PII) ก่อนส่งออก external · AI ห้ามแตะ migration/secret/config
> (`.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/`)

---

# Permissions

> **Implemented — per-tenant RBAC (`bms_role_permissions`, PK = tenant_id+role_id+permission):**
> 26 สิทธิ์แบบ `resource.action` — `product.view/edit/delete` · `stock.adjust` · `order.view/pay/ship/cancel/return` ·
> `purchase.view/edit/receive/cancel` · `payment.view/submit/confirm/refund` · `shipping.view/create/update` ·
> `inbox.view/reply/manage` · `customer.view/edit` · `report.view`
> `Administrator` = super (bypass) · แต่ละร้านปรับสิทธิ์ role ของตัวเองได้ (เมนู Permissions) ·
> UI ซ่อนปุ่มตามสิทธิ์ + resolver `requirePermission()` ปฏิเสธ 403 ถ้าไม่มีสิทธิ์
>
> ⚠️ **หน้า Permissions แก้สิทธิ์ตาม "ร้านที่แอดมินยืนอยู่ตอนนั้น"** — platform admin ที่ไม่ได้ drill-down
> เข้าร้านเป้าหมายก่อน จะแก้สิทธิ์ผิดร้าน (มักไปลงร้าน default) ทั้งที่ backend/cache ทำงานถูกต้อง —
> ต้อง `/admin/tenants` → "เข้าดู" ร้านเป้าหมายก่อน (เห็น banner เหลืองยืนยัน) แล้วค่อยแก้ Permissions
>
> **RBAC 2 ชั้น:** *platform admin* (`users.is_platform_admin`) = ดูแลทั้งแพลตฟอร์ม (list/จัดการทุกร้าน, plan, role กลาง) ·
> *tenant role* (Administrator/Manager/Sales/Warehouse) = จัดการเฉพาะร้านตัวเอง.
> จัดการ **User** = Administrator/platform (scope ตามร้าน) · จัดการ **Role กลาง** = platform เท่านั้น.
> platform admin ดูข้อมูล operational ของร้าน (ลูกค้า/ออเดอร์) ผ่าน **drill-down** เท่านั้น — ไม่เห็นข้ามร้านปนกัน (privacy).
> หน้าระดับแพลตฟอร์ม (Architecture · ระบบ: ENV/Logs/Posts/Files/Queue) = **platform admin เท่านั้น** — gate server-side ที่ `layout.tsx` (`requirePlatformAdminPage()`) ไม่ใช่แค่ซ่อนเมนู.
>
> **401 vs 403:** 401 = ไม่ได้ล็อกอิน/token เสีย → บังคับ logout · 403 = ล็อกอินอยู่แต่ไม่มีสิทธิ์ → แสดง error, **ไม่ logout**.
> role ใหม่/permission ใหม่ต้อง seed ให้ Manager/Sales/Warehouse ทุก tenant (เช่น migration `5.7`) ไม่งั้นร้านโดน 403
>
> **Quota staff ต่อแพ็กเกจ (`bms_plans.max_users`):** free = 3 คน · pro = 10 คน · business = ไม่จำกัด ·
> บังคับใช้ตอนสร้าง user ใหม่ (`enforceUserQuota()`) — เกินโควตา throw error พร้อมข้อความแนะนำอัปเกรด ·
> **platform admin ไม่ถูกจำกัด** (เพิ่ม staff ให้ร้านไหนก็ได้ไม่ติด quota)

Admin

Full access.

Manager

Cannot modify system settings.

Sales

Can create orders.

Cannot modify inventory manually.

Warehouse

Can receive goods.

Can ship orders.

Cannot change prices.

Customer Support

Can view CRM.

Can reply chat.

Cannot modify inventory.

---

# Notifications

Low Stock

New Order

Payment Received

Shipment Created

Purchase Order Received

Inventory Adjustment

All notifications should be logged.

> **Implemented:** LINE ops alert เมื่อ Daily Log Triage เปิด draft PR (Messaging API push) ·
> business notifications อื่น (low stock / new order / payment / shipment) = roadmap

---

# Dev / Test Data

ข้อมูลทดสอบสร้างผ่าน `/admin/dev/fake` — mark ด้วย
`FAKE-` (SKU / customer_ref) หรือ tag `fake` เพื่อแยกออกจากข้อมูลจริงและ cleanup ได้
**ไม่ถือเป็นข้อมูลธุรกิจจริง** · fake orders/PO ไม่ขยับสต็อก (ใช้เติม analytics เท่านั้น) ·
seed/cleanup **scope ต่อ tenant ของผู้ล็อกอิน** (ร้านค้าเทสเอง เห็นในร้านตัวเอง — ไม่ปนข้ามร้าน) ·
ปิดใน production default (เปิดเครื่อง demo ด้วย `BMS_ALLOW_FAKE_SEED=1`)

ตัวเลือกใน dropdown: Products/Customers/Orders/Conversations/Purchase/**Staff (users)** —
"Posts" (fixture project เก่า ไม่เกี่ยว BMS) ถูกถอดออกแล้ว. Fake staff ได้ role **Sales/Warehouse**
สุ่ม (ไม่สุ่ม Administrator/Manager กันกระทบสิทธิ์จัดการร้านจริง) · ผูก tenant + hash รหัสผ่านด้วย
bcrypt เหมือน signup จริง

---

# Reports

Reports are read-only.

Reports never modify business data.

Reports must always use transactional data.

> **Implemented (`lib/bms/dashboard.ts` + `lib/bms/reports.ts`):** Dashboard (ภาพรวมวันนี้) ·
> `getSalesSummary(from,to)` (รายวัน/สถานะ/ช่องทาง) · `getInventorySummary` (มูลค่า/ใกล้หมด/หมด) ·
> `getTopSellingProducts` · รายได้นับเฉพาะ PAID ขึ้นไป · permission `report.view`

---

# AI Decision Rule

AI should determine intent first.

Intent

↓

Tool

↓

Backend

↓

Database

↓

Response

Never

Intent

↓

SQL

↓

Response

---

# Design Principle

Business logic belongs to Services.

Database belongs to Repositories.

AI only orchestrates workflows.

AI is not the source of truth.

Database is the source of truth.