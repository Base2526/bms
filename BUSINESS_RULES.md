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

---

# Product

SKU must be unique.

Barcode should be unique.

Inactive products cannot be sold.

Product price cannot be negative.

Product stock cannot be negative unless AllowNegativeStock is enabled.

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
> (tenant, channel, customer_ref) · assign staff · status OPEN/PENDING/CLOSED · tags · โน้ตภายใน ·
> timeline (message + note + order) · staff ตอบเองได้ (`sendStaffMessage`) · permissions: `inbox.view/reply/manage`

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

---

# Permissions

> **Implemented — per-tenant RBAC (`bms_role_permissions`, PK = tenant_id+role_id+permission):**
> 26 สิทธิ์แบบ `resource.action` — `product.view/edit/delete` · `stock.adjust` · `order.view/pay/ship/cancel/return` ·
> `purchase.view/edit/receive/cancel` · `payment.view/submit/confirm/refund` · `shipping.view/create/update` ·
> `inbox.view/reply/manage` · `customer.view/edit` · `report.view`
> `Administrator` = super (bypass) · แต่ละร้านปรับสิทธิ์ role ของตัวเองได้ (เมนู Permissions) ·
> UI ซ่อนปุ่มตามสิทธิ์ + resolver `requirePermission()` ปฏิเสธ 403 ถ้าไม่มีสิทธิ์

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