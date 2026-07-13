# AI Business Management System (AI-BMS)

## Overview

AI-BMS is an AI-first Business Management System designed to automate business operations from customer conversations to order fulfillment.

Unlike traditional ERP or CRM systems, AI-BMS treats customer conversations as the starting point of every business workflow.

Supported channels:

- LINE Official Account ✅ (webhook + reply/push)
- TikTok Shop / TikTok Chat ✅ (webhook; send API = roadmap)
- Facebook Messenger ✅ (webhook + Graph Send)
- Instagram ✅ (DM via Messenger Platform)
- Website Live Chat ✅ (public widget endpoint)
- Shopee 🧪 (beta — webhook scaffold รับข้อความได้ แต่ signature scheme + payload mapping ยังไม่ยืนยันกับเอกสาร Shopee Open Platform จริง; send API = roadmap)
- Lazada 🧪 (beta — webhook scaffold รับข้อความได้ แต่ signature scheme + payload mapping ยังไม่ยืนยันกับเอกสาร Lazada Open Platform จริง; send API = roadmap)
- Future:
  - WhatsApp
  - Email
  - Voice AI

---

# Build Status (2026-07)

โมดูลเชิงปฏิบัติการตามสเปกนี้ **สร้างครบแล้ว** — order lifecycle ปิดครบวงจร
(order → payment → shipping → delivered/completed) + omnichannel capture ทุกช่องทางหลัก

| Module | สถานะ | ที่อยู่ (service · migration) |
| --- | --- | --- |
| Channel Integration | ✅ | `app/api/bms/{line,tiktok,facebook,instagram,web}/webhook` · `lib/bms/meta.ts` |
| Channel Integration — Shopee/Lazada | 🧪 beta | `app/api/bms/{shopee,lazada}/webhook` — config/UI/type ต่อครบเหมือน channel อื่น แต่ signature verify + payload parsing เป็น **placeholder ที่ยังไม่ยืนยันกับเอกสาร API จริง** (ดู TODO(prod) ในไฟล์) · ยังไม่มี send API (ตอบกลับอัตโนมัติไม่ได้) |
| Omnichannel Inbox | ✅ | `lib/bms/inbox.ts` · `5.5__bms_inbox.sql` · แนบรูป/ไฟล์ (`/api/bms/inbox/upload` → `meta.attachment`) · สถานะข้อความ SENT/FAILED + retry (capability-gated ตามช่องทาง) · แท็บ **"ลูกค้า"** ในหน้าแชท auto-load ประวัติซื้อ/ยอดสะสม/แท็ก-โน้ตของลูกค้าเมื่อเปิดบทสนทนา (`bmsCustomer(id)` ผ่าน `conv.customerId`, gate ด้วย `customer.view`) |
| AI Orchestrator | ✅ | `lib/bms/{nlu,pipeline,ai}.ts` (rule-based NLU + Claude) |
| CRM | ✅ | `lib/bms/customers.ts` · `3.6__bms_crm.sql` (แก้ไข/ตั้งค่าเริ่มต้น/ลบที่อยู่ได้) · ผสานลูกค้าซ้ำข้ามช่องทาง (`mergeCustomers` — ปุ่ม "ผสาน" ที่ `/admin/customers`) |
| Product Management | ✅ | `lib/bms/products.ts` · `3.2` / `5.9` (image/description/cost_price/category/brand) · upload รูป `/api/bms/products/upload` · ค้นหา+paging server-side · หมวดหมู่เป็น list จัดการได้ (`lib/bms/productCategories.ts` · `6.0`) |
| Inventory (IMS) | ✅ | `lib/bms/{stock,movements}.ts` · `3.2` / `3.4` |
| Orders (OMS) | ✅ | `lib/bms/orders.ts` · `3.3` / `3.5` · "ซื้อซ้ำ" จากประวัติซื้อ (`reorderFromOrder` — ปุ่มใน inbox/customers, permission ใหม่ `order.create` seed ที่ `6.1`) |
| Purchase | ✅ | `lib/bms/purchase.ts` · `5.2__bms_purchase.sql` |
| Payment | ✅ | `lib/bms/payments.ts` · `5.3__bms_payments.sql` (+ AI slip verify) |
| Shipping | ✅ | `lib/bms/shipping.ts` · `5.4__bms_shipments.sql` |
| Reports | ✅ | `lib/bms/{dashboard,reports}.ts` |
| Multi-tenant · RLS · RBAC · Plans · Audit | ✅ | `lib/bms/{tenant,permissions,plans,audit}.ts` · `4.0–5.1` / `5.7` (operational perms) / `5.8` (`max_users` quota staff/plan) |
| SaaS: Self-serve Signup | ✅ | `lib/bms/signup.ts` · `/shop-signup` (สร้าง tenant + owner role Manager) |
| Platform Admin (ข้ามร้าน) | ✅ | `lib/bms/platform.ts` · `/admin/tenants` · `5.6__bms_platform_admin.sql` (`users.is_platform_admin`) — list ทุกร้าน · เปิด/ปิด · เปลี่ยน plan |
| Tenant Drill-down (impersonate) | ✅ | `bmsEnterTenant`/`bmsExitTenant` · cookie `BMS_ACT_TENANT` (signed) → override tenant ใน context · banner ใน `AdminLayoutClient` |
| Current-user Profile | ✅ | `bmsMe` · `/admin/profile` + chip ผู้ล็อกอิน/Logout ปักล่างสุดของ `AdminSidebar` |
| Ops: Daily AI Log Triage | ✅ | `.github/workflows/daily-log-triage.yml` · `scripts/bms-log-triage/*` |
| Dev: Fake Data Seeder | ✅ | `/admin/dev/fake` · `app/api/dev/fake/*` — seed ลง **tenant ของผู้ล็อกอิน** · cleanup scope ตามร้าน · "BMS Staff (users)" ผูก tenant + role Sales/Warehouse (ก่อนหน้าไม่ผูก tenant เลยไม่โผล่ที่ `/admin/users`) · ถอด "Posts" ออกจาก dropdown (fixture project เก่า) |

**Ops automation:** ทุกวัน GitHub Actions อ่าน error จาก `system_logs` → Claude วิเคราะห์+เสนอแพตช์
→ เปิด **draft PR** (คนรีวิว) → แจ้ง **LINE** (Messaging API push) · log ถูก redact ก่อนส่งออก

**RBAC model (2 ชั้น):** *platform admin* (`is_platform_admin`) ดูแลทั้งแพลตฟอร์ม (ทุกร้าน/plan/role) · *tenant Administrator/Manager/staff* จัดการเฉพาะร้านตัวเอง (ทุก resolver scope ด้วย `getTenantId(ctx)` + `requirePermission()`). platform admin ดูข้อมูลร้านผ่าน **drill-down** เท่านั้น (ไม่ยำข้ามร้าน). Users list/CRUD + role CRUD ถูก gate: Users = Administrator/platform (scope ตามร้าน) · Role CRUD = platform เท่านั้น. หน้าระดับแพลตฟอร์ม (Architecture · ระบบ: ENV/Logs/Posts/Files/Queue) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side). Fake data เปิดให้ shop operator (สิทธิ์ `product.edit`) เทส seed มุมร้านตัวเองได้.

**Roadmap ที่เหลือ:** TikTok send API · carrier API จริง (label PDF/auto-tracking) ·
AI tool-calling / OCR / forecasting (Phase 3–4) · WhatsApp / Email / Voice AI ·
ให้ owner (role Manager) จัดการ staff ร้านตัวเองได้ (ตอนนี้เฉพาะ Administrator/platform)

> รายละเอียด tool + permission ต่อโมดูล: ดู [TOOLS.md](TOOLS.md) ·
> flow AI: [AI_WORKFLOW.md](AI_WORKFLOW.md) · กฎธุรกิจ + enum จริง: [BUSINESS_RULES.md](BUSINESS_RULES.md)

---

# Vision

Every customer conversation should become an executable business workflow.

Instead of:

Customer
→ Human
→ Excel
→ ERP

AI-BMS should automate:

Customer
→ AI
→ CRM
→ Order
→ Inventory
→ Payment
→ Shipping
→ Dashboard

---

# Core Philosophy

AI should NEVER access the database directly.

AI is only responsible for:

- Understanding user intent
- Selecting the correct business tool
- Summarizing data
- Explaining results

Business logic always belongs to backend services.

Database access is ONLY allowed through approved service functions.

---

# High Level Architecture

Customer

↓

Channel Integration

↓

Omnichannel Inbox

↓

AI Orchestrator

↓

Business Functions

↓

Database

↓

Response Generator

↓

Customer

---

# System Modules

## 1. Channel Integration

Responsible for receiving messages/events from:

- LINE Messaging API
- TikTok APIs
- Facebook Graph API
- Instagram API
- Website Chat

Convert every platform into one internal message format.

Example:

{
  channel
  customerId
  conversationId
  message
  timestamp
}

---

## 2. Omnichannel Inbox

Unified inbox for all channels.

Features:

- Chat history
- Assign staff
- Internal notes
- Tags
- Customer timeline
- Attachments
- Search

---

## 3. AI Orchestrator

The AI layer.

Responsibilities:

- Intent detection
- Entity extraction
- Tool selection
- Context understanding
- Response generation

AI must NOT contain business logic.

Example:

Customer:

Nike XL available?

↓

Intent

check_stock

↓

Entity

{
    product: Nike
    size: XL
}

↓

Tool

checkStock()

---

## 4. CRM

Stores customer information.

Customer profile includes:

- Name
- Phone
- Email
- LINE User ID
- TikTok User ID
- Facebook ID
- Shipping addresses
- Purchase history
- Lifetime value
- Tags
- Notes

Multiple channels may belong to one customer.

---

## 5. Product Management

Responsible for:

- Products
- Variants
- SKU
- Barcode
- Images
- Pricing
- Categories
- Brands

---

## 6. Inventory Management System (IMS)

Handles stock.

Features:

- Current Stock
- Reserved Stock
- Available Stock
- Stock In
- Stock Out
- Transfer
- Adjustment
- Stock Movement

Every stock change MUST create a Stock Movement record.

Never update stock without logging movement.

---

## 7. Order Management System (OMS)

Responsible for customer orders.

Statuses:

Draft

Pending Payment

Paid

Packing

Shipped

Completed

Cancelled

Refunded

---

## 8. Purchase Management

Supplier purchase orders.

Features:

- Create PO
- Receive Items
- Partial Receive
- Cancel PO
- Supplier History

---

## 9. Payment

Supports:

- Bank Transfer
- QR Payment
- Credit Card
- TikTok Payment
- Cash

Future:

AI Slip Verification

OCR

---

## 10. Shipping

Supports:

- Flash
- Kerry
- DHL
- Australia Post
- NZ Post

Features:

Tracking Number

Packing

Label Printing

Shipping Status

---

## 11. Reports

Dashboard

Sales

Inventory

Customer

Supplier

Financial

AI Usage

Staff Performance

---

# AI Rules

AI must NEVER write SQL.

Incorrect:

AI

↓

SELECT * FROM products

Correct:

AI

↓

checkStock()

↓

Backend

↓

SQL

---

# Tool Calling

AI interacts ONLY through approved tools.

Examples:

checkStock()

searchProduct()

getProduct()

createDraftOrder()

confirmOrder()

cancelOrder()

reserveStock()

releaseStock()

getOrderStatus()

getCustomer()

searchCustomer()

createCustomer()

getSalesSummary()

getLowStockProducts()

getDashboard()

---

# AI Flow

Customer

↓

Message

↓

Intent Detection

↓

Entity Extraction

↓

Select Tool

↓

Backend Service

↓

Database

↓

Return Result

↓

Generate Human Response

---

# Example

Customer:

Do you have Nike XL?

AI

↓

Intent

check_stock

↓

Tool

checkStock()

↓

Backend

↓

Stock = 5

↓

AI

↓

We currently have 5 pairs available.

---

# Business Rules

AI must never:

Delete database records

Update prices

Adjust inventory

Refund orders

Delete customers

Without explicit approval.

Sensitive actions require:

Human Confirmation

or

Role Permission

---

# Folder Structure

/apps

/api

/services

/ai

/channels

/modules

inventory

orders

crm

payment

shipping

reports

/shared

/database

---

# Coding Rules

Business Logic

↓

Services

Database

↓

Repositories

AI

↓

Never contains SQL

Frontend

↓

Never contains business logic

---

# Future Roadmap

Phase 1

Inventory

Products

Orders

CRM

Phase 2

LINE Integration

TikTok Integration

Payments

Shipping

Phase 3

AI Tool Calling

AI Agent

OCR

Phase 4

Voice AI

Forecasting

Demand Prediction

Business Intelligence

---

# Design Principle

Everything starts from a conversation.

Conversation

↓

Intent

↓

Business Function

↓

Business Data

↓

Business Action

↓

Customer Response

AI-BMS is NOT an AI Chatbot.

AI-BMS is an AI Business Operating System.