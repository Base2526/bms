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
- Lazada 🚧 (designed, not yet built — OAuth + Channel Sync Service, no live chat; see § SaaS Architecture)
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
| Omnichannel Inbox | ✅ | `lib/bms/inbox.ts` · `5.5__bms_inbox.sql` · แนบรูป/ไฟล์ (`/api/bms/inbox/upload` → `meta.attachment`) · สถานะข้อความ SENT/FAILED + retry (capability-gated ตามช่องทาง) · มอบหมาย staff หลัก + คนช่วยตอบ (helpers) + auto-assign แชทใหม่ (`6.1__bms_inbox_assignment.sql`, ดู [TOOLS.md](TOOLS.md)) |
| AI Orchestrator | ✅ | `lib/bms/{nlu,pipeline,ai}.ts` (rule-based NLU + Claude) |
| CRM | ✅ | `lib/bms/customers.ts` · `3.6__bms_crm.sql` (แก้ไข/ตั้งค่าเริ่มต้น/ลบที่อยู่ได้) |
| Product Management | ✅ | `lib/bms/products.ts` · `3.2` / `5.9` (image/description/cost_price/category/brand) · upload รูป `/api/bms/products/upload` · ค้นหา+paging server-side · หมวดหมู่เป็น list จัดการได้ (`lib/bms/productCategories.ts` · `6.0`) |
| Inventory (IMS) | ✅ | `lib/bms/{stock,movements}.ts` · `3.2` / `3.4` |
| Orders (OMS) | ✅ | `lib/bms/orders.ts` · `3.3` / `3.5` · เส้นทางออเดอร์ (`getOrderJourney` → `bmsOrderJourney`) — ต้นทางแชท + stepper + timeline (แถวขยายในหน้า Orders, ลิงก์ไปแชทต้นทาง) |
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
| Channel OAuth + Sync Service (Lazada) | 🚧 ออกแบบแล้ว | ยังไม่ implement — สเปกเต็มใน [BUSINESS_RULES.md](BUSINESS_RULES.md) § Channels & Commerce Sync, [TOOLS.md](TOOLS.md) § Channel Sync, phase build order + ไฟล์ที่วางแผนไว้ใน [CLAUDE.local.md](CLAUDE.local.md) |
| Customer 360 (Inbox right panel) | ✅ | `lib/bms/customer360.ts` · `6.2__bms_customer_360.sql` · GraphQL `bmsCustomer360`/`bmsCustomerTimeline`/`bmsCustomerInsights` · UI `Customer360Panel.tsx` — Inbox ตอนนี้เป็น 3 คอลัมน์จริง (list · แชท · Customer 360) ดู § Customer 360 ด้านล่าง |

**Ops automation:** ทุกวัน GitHub Actions อ่าน error จาก `system_logs` → Claude วิเคราะห์+เสนอแพตช์
→ เปิด **draft PR** (คนรีวิว) → แจ้ง **LINE** (Messaging API push) · log ถูก redact ก่อนส่งออก

**RBAC model (2 ชั้น):** *platform admin* (`is_platform_admin`) ดูแลทั้งแพลตฟอร์ม (ทุกร้าน/plan/role) · *tenant Administrator/Manager/staff* จัดการเฉพาะร้านตัวเอง (ทุก resolver scope ด้วย `getTenantId(ctx)` + `requirePermission()`). platform admin ดูข้อมูลร้านผ่าน **drill-down** เท่านั้น (ไม่ยำข้ามร้าน). Users list/CRUD + role CRUD ถูก gate: Users = Administrator/platform (scope ตามร้าน) · Role CRUD = platform เท่านั้น. หน้าระดับแพลตฟอร์ม (Architecture · ระบบ: ENV/Logs/Posts/Files/Queue) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side). Fake data เปิดให้ shop operator (สิทธิ์ `product.edit`) เทส seed มุมร้านตัวเองได้.

**Roadmap ที่เหลือ:** **ถัดไป (ออกแบบแล้ว):** Lazada channel (OAuth) + Channel Sync Service
(products/orders/payments/shipments) + Unified Customer Timeline (§ SaaS Architecture ด้านล่าง) ·
หลังจากนั้น: TikTok send API · carrier API จริง (label PDF/auto-tracking) ·
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

# SaaS Architecture (2026-07 — design finalized, build in progress)

AI-BMS is multi-tenant by design. Every business record already belongs to one shop
(`tenant_id` on every `bms_*` table, enforced by Postgres RLS — see `apps/web/lib/bms/tenant.ts`).

**Terminology:** "Workspace" is what users see in the UI and docs. The schema, RLS policies,
Postgres role (`bms_app`), and every function (`getTenantId()`, `beginTenantTx()`) keep the name
`tenant`/`tenant_id` — this is a naming choice for humans, not a rename of the database.

**Channel plugin model:** each channel (LINE, TikTok, Facebook, Instagram, Website, and the
planned Lazada) implements the same shape — verify signature → parse into a normalized
`{ customerRef, text }` event → `runPipeline()` → `logConversation()` → optionally push a reply
back. New channels plug in without touching AI/business logic. Channels connect/disconnect
per-workspace from **Settings → Channels** (already built, `/admin/settings`); credentials are
encrypted at rest (`lib/bms/crypto.ts`). OAuth-based connection (authorize → callback → token
exchange) extends the existing manual-token model for channels that need it (Lazada first).

**Commerce Sync Service (planned):** channels that don't push everything via webhook — Lazada's
products/orders/payments/shipments arrive via REST polling, not a live feed — are kept in sync by
a background worker that periodically pulls into the local database:

```
Platform (Lazada API)
  ↓
Sync Service (periodic pull, idempotent by external ID)
  ↓
Local Database (bms_products / bms_orders / bms_payments / bms_shipments)
  ↓
CRM / AI (reads local data only — never calls the external API live during a conversation)
```

LINE/Meta/Web conversations keep using the existing fast webhook path unchanged — Sync Service
only applies to channels/resources that have no real-time push.

**CRM/Inventory side effects stay synchronous, not event-bus:** when an order/payment/shipment
changes state (from a customer, staff, or the Sync Service), the resulting CRM/stock updates
happen via direct function calls in the same transaction (e.g. `confirmPayment()` already cascades
payment→order atomically). This is intentional — order/payment/shipping transitions must be atomic
to prevent oversell or double-shipping, which a fire-and-forget event bus cannot guarantee. `OrderCreated`/
`OrderPaid`/etc. are therefore *the direct function calls themselves*, not emitted messages; `bms_audit_log`
remains the write-only history those calls append to, read back by `getOrderJourney`/`listSystemEvents`.

**Unified customer timeline — ✅ implemented** (originally planned here, built as part of Customer 360,
see § Customer 360 below): one customer can hold several channel identities (`bms_customer_identities`);
`bmsCustomerTimeline` merges every conversation across every channel plus every order/payment/shipment/
refund/note into one chronological feed, surfaced in the Inbox right panel. AI summary is a separate
section (`bmsCustomerInsights`), not folded into the timeline feed itself.

> Full technical spec: [BUSINESS_RULES.md](BUSINESS_RULES.md) § Channels & Commerce Sync ·
> tool definitions: [TOOLS.md](TOOLS.md) § Channel Sync · phased build order + planned file
> layout: [CLAUDE.local.md](CLAUDE.local.md)

---

# Customer 360 (Conversation Intelligence Panel)

When staff select any conversation in the Inbox (`/admin/inbox`), the page is a real 3-column layout:
conversation list → message thread (with the existing แชท/โน้ต/Timeline tabs, unchanged) → a new
**Customer 360 panel** on the right. This is not an order-history sidebar — it's a full customer
intelligence view spanning every channel the customer has ever used (LINE/TikTok/Facebook/Instagram/
Web/Lazada), built on top of the existing `customer_id`-based cross-channel identity model
(`bms_customer_identities`) — no new identity/merge logic was needed, only new *reads* over it.

**Data flow:** selecting a conversation resolves its (nullable) `customerId` → the panel eager-loads
one combined query, `bmsCustomer360`, covering 7 of its 10 sections (summary, contact info, connected
accounts, statistics, recent orders across every channel, products purchased, current cart, internal
notes) — cheap aggregate SQL, safe to run on every conversation switch. The remaining two data-heavy
sections — **Timeline** (every conversation + order + shipment + refund + note, merged and sorted) and
**AI Insights** — run their own query (`bmsCustomerTimeline`, `bmsCustomerInsights`) lazily, firing only
the first time their Collapse section is expanded (same pattern the Inbox's own Timeline tab already
used before this feature existed). A conversation with no linked customer yet shows an explicit empty
state rather than an error.

**"Current shopping cart" mapping:** this schema has no separate DRAFT order status (orders go straight
to `PENDING` with stock already reserved — see § Orders). The panel's cart section is therefore the
customer's newest `PENDING` order that has no payment submitted yet, not a distinct entity.

**Quick Actions honesty rule:** buttons only do what the backend can actually do. Support Ticket /
Generate Invoice / Send Payment Link render as disabled "coming soon" buttons because none of those
subsystems exist yet anywhere in this codebase — the panel does not fake capabilities that aren't built.

## AI Insight Rules (Customer 360 § 9)

Same non-hallucination discipline as `verifyPaymentSlip()`'s slip-reading (§ Payments) — extended, not
reinvented: the backend first computes a small **facts bundle** from real aggregates (order counts,
lifetime value, top product, purchase cadence — never free text), then asks Claude to phrase a bullet
summary strictly from that bundle. The system prompt explicitly forbids inventing numbers or recommending
anything not backed by the given facts. Falls back to a deterministic templated bullet list (no AI call)
when `ANTHROPIC_API_KEY` is unset — identical fallback shape to `ai.ts`'s existing pattern. Results are
cached per customer in `bms_customer_ai_summary`, keyed by a hash of the facts bundle, so re-opening the
same customer's chat doesn't re-call Claude unless the underlying numbers actually changed.

> Full architecture/data-model notes, new files, and pending follow-ups:
> [CLAUDE.local.md](CLAUDE.local.md) § Customer 360.

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