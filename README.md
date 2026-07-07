# 🤖 AI-BMS — AI Business Management System

> Every customer conversation should become an executable business workflow.
> **AI-BMS is not an AI chatbot — it is an AI Business Operating System.**

---

## 🌍 Language

- [🇬🇧 English](#-english)
- [🇹🇭 ภาษาไทย](#-ภาษาไทย)

---

## 🇬🇧 English

### 📌 Overview

**AI-BMS** is an AI-first Business Management System that automates business
operations from the very first customer message all the way to fulfillment.

Unlike traditional ERP/CRM, AI-BMS treats **the conversation** as the starting
point of every workflow:

```
Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard
```

**Supported channels:** LINE Official Account, TikTok Shop / TikTok Chat,
Facebook Messenger, Instagram, Website Live Chat.
_Roadmap:_ WhatsApp, Email, Voice AI.

> 📖 The product vision, modules, and rules live in
> [`CLAUDE.md`](./CLAUDE.md), [`AI_WORKFLOW.md`](./AI_WORKFLOW.md),
> [`BUSINESS_RULES.md`](./BUSINESS_RULES.md), and [`TOOLS.md`](./TOOLS.md).

---

### 🧠 Core Philosophy

**AI never touches the database directly.** The AI layer only:

- Understands user intent
- Selects the correct business tool
- Summarizes data & explains results

All business logic lives in backend **services**; database access happens only
through approved service/repository functions.

```
Message → Intent → Entities → Select Tool → Backend Service → DB → Response
```

AI must **never** write SQL, delete records, change prices, adjust inventory,
or refund orders. Sensitive actions require **human confirmation** or an
explicit **role permission**.

---

### 🏗️ Architecture

```
Customer
   ↓
Channel Integration      (LINE / TikTok / Facebook / IG / Web Chat)
   ↓
Omnichannel Inbox        (unified conversations)
   ↓
AI Orchestrator          (intent → entities → tool selection)
   ↓
Business Functions       (services / tools)
   ↓
Database                 (PostgreSQL)
   ↓
Response Generator       (Claude — phrasing only, facts from backend)
   ↓
Customer
```

The AI pipeline is channel-agnostic and returns a full trace of each step for
debugging (`apps/web/lib/bms/pipeline.ts`):

```
Receive → Detect Intent → Extract Entities → Select Tool
        → Call Backend → Receive Data → Generate Response → Reply
```

---

### 🧩 System Modules

| Module | Responsibility |
| --- | --- |
| **Channel Integration** ✅ | Per-tenant webhooks for LINE, TikTok, Facebook Messenger, Instagram DM + Website Live Chat — all normalized into one pipeline (signature-verified) |
| **Omnichannel Inbox** ✅ | Unified inbox: chat history, assign staff, internal notes, tags, customer timeline, search — every webhook message (+ AI reply) is logged; staff can reply (LINE push) |
| **AI Orchestrator** | Intent detection, entity extraction, tool selection |
| **CRM** | Customer profiles across channels, purchase history, LTV |
| **Product Management** | Products, variants, SKU, barcode, pricing, categories |
| **Inventory (IMS)** | Current / reserved / available stock — every change logs a movement |
| **Orders (OMS)** | Draft → Pending → Paid → Packing → Shipped → Completed / Cancelled / Refunded |
| **Purchase** ✅ | Supplier POs, receive / partial receive, supplier history — `OPEN → PARTIAL → RECEIVED` (stock-in on receive) |
| **Payment** ✅ | Bank transfer, QR, card, TikTok Pay, cash — payment records + confirm/reject/refund + AI slip verification (`verifyPaymentSlip`, advisory only) |
| **Shipping** ✅ | Flash, Kerry, DHL, Australia Post, NZ Post — shipments, tracking, status flow, label (`createShipment`/`updateTracking`); `DELIVERED → order COMPLETED` |
| **Reports** ✅ | Dashboard + date-range **sales summary** (by day/status/channel), **inventory summary** (stock value, low/out-of-stock), **top sellers** — `/admin/reports` |

> ⚠️ **Every stock change must create a Stock Movement record.** Never update
> stock without logging the movement.

---

### 🛠️ Tech Stack

| Layer | Technology |
| --- | --- |
| Web frontend | **Next.js 14** (App Router) + **Ant Design** + Zustand |
| API | **GraphQL Yoga** + Apollo Client (GraphQL over HTTP + WS) |
| Realtime | **WebSocket gateway** (`apps/ws`) + `graphql-ws` + Redis pub/sub |
| Database | **PostgreSQL 16** (`pg`) |
| Cache / Queue | **Redis 7** (cache, pub/sub, social publishing queue) |
| Background jobs | **social-worker** (`npm run worker:social`) |
| Auth | NextAuth, JWT, Google / Facebook OAuth, bcrypt |
| Reverse proxy / TLS | **Caddy** |
| AI | Anthropic Claude (`ANTHROPIC_API_KEY`) — optional; falls back to deterministic templates |
| Orchestration | **Docker Compose** |

The BMS business logic lives in [`apps/web/lib/bms/`](./apps/web/lib/bms/)
(`stock`, `orders`, `products`, `customers`, `nlu`, `ai`, `pipeline`,
`tenant`, `permissions`, `plans`, `channels`, `audit`, …), exposed via the API
routes under [`apps/web/app/api/bms/`](./apps/web/app/api/bms/).

---

### 🗂️ Repository Structure

```
/
├── apps/
│   ├── web/                     # Next.js app (UI + GraphQL API + BMS logic)
│   │   ├── app/
│   │   │   ├── (admin)/         # Admin console: orders, products, customers,
│   │   │   │                    #   inventory, billing, roles, permissions, audit
│   │   │   ├── (auth)/          # Login, register, shop signup, verify email
│   │   │   ├── (main)/          # Public / customer-facing pages
│   │   │   └── api/
│   │   │       └── bms/         # BMS endpoints:
│   │   │           ├── chat/                    # AI conversation pipeline
│   │   │           ├── line/webhook/[tenantId]/ # per-tenant LINE webhook
│   │   │           ├── tiktok/webhook/[tenantId]/
│   │   │           ├── facebook/webhook/[tenantId]/   # Messenger (Graph send)
│   │   │           ├── instagram/webhook/[tenantId]/  # IG DM (Messenger Platform)
│   │   │           ├── web/webhook/[tenantId]/        # Website Live Chat (public widget)
│   │   │           ├── order/[id]/{pay,pack,ship,complete,cancel,return}/
│   │   │           ├── purchase/[id]/{receive,cancel}/ # supplier PO lifecycle
│   │   │           ├── payment/[id]/{confirm,reject,refund,verify}/ # payments + AI slip verify
│   │   │           ├── shipment/[id]/{tracking,status,label}/ # carrier, tracking, label
│   │   │           ├── inbox/[id]/reply/        # omnichannel inbox (list + staff reply)
│   │   │           ├── reports/{sales,inventory,top-products}/ # report tools
│   │   │           ├── reserve/                 # stock reservation
│   │   │           └── orders/release-expired/  # release expired reservations
│   │   └── lib/bms/             # Services / tools (single source of truth)
│   └── ws/                      # WebSocket gateway (GraphQL subscriptions)
├── packages/                    # Shared libs: graphql-core, realtime, social-queue
├── db/                          # SQL: init, migrations/, triggers, helpers
├── storage/                     # Uploaded files / assets
├── docker-compose.yml           # Base stack
├── docker-compose.dev.yml       # Development override
├── docker-compose.prod.yml      # Production override
├── CLAUDE.md                    # Product vision & architecture
├── AI_WORKFLOW.md               # AI pipeline spec
├── BUSINESS_RULES.md            # Business rules & guardrails
└── TOOLS.md                     # Approved AI tool catalog
```

---

### 🏢 Multi-Tenancy

AI-BMS is **multi-tenant** (SaaS). Each shop (tenant) has:

- Self-serve signup that auto-creates a tenant + plan/billing
- Per-tenant webhooks for LINE, TikTok, **Facebook Messenger, Instagram DM**
  (`/api/bms/{channel}/webhook/{tenantId}`, signature-verified) + a public
  **Website Live Chat** endpoint (`/api/bms/web/webhook/{tenantId}`)
- Per-tenant channel credentials — replies go out with **that shop's** token
- Per-tenant roles / permissions, rate-limited webhooks, and audit logging

---

### 🚀 Development Setup

**Requirements:** Docker & Docker Compose (Node.js 20 optional for local runs).

1. **Configure environment** — copy/create `.env` at the repo root
   (Postgres, Redis, OAuth, SendGrid, and — optionally — `ANTHROPIC_API_KEY`).

2. **Start the stack:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

   This brings up **postgres**, **redis**, **web** (Next.js), **ws** (WebSocket
   gateway), **social-worker**, **caddy**, and **pgAdmin** (http://localhost:5050).

3. **Or run apps locally** (against Docker Postgres/Redis):

   ```bash
   cd apps/web && npm install && npm run dev        # http://localhost:3000
   cd apps/ws  && npm install && npm run dev        # WS gateway :8080
   npm run worker:social --prefix apps/web          # social publishing worker
   ```

> 🧪 Without `ANTHROPIC_API_KEY`, the AI layer returns deterministic Thai
> templates — handy for testing the pipeline offline.

---

### 📦 Deployment

Production notes live in [`README-prod.md`](./README-prod.md). In short:

1. Set production `.env` for each service.
2. Build production images.
3. Launch:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

Caddy terminates TLS and reverse-proxies **web** and **ws**.

> ⚠️ **Production safety:** back up the database before running migrations,
> prefer read-only `SELECT`/`SHOW` checks before schema changes, and roll out
> the smallest change first. Never restart production services casually.

---

## 🇹🇭 ภาษาไทย

### 📌 ภาพรวม

**AI-BMS** คือระบบบริหารธุรกิจแบบ AI-first ที่ทำให้งานตั้งแต่
"ข้อความแรกของลูกค้า" ไปจนถึงการจัดส่ง เป็นอัตโนมัติ

ต่างจาก ERP/CRM ทั่วไป ตรงที่ AI-BMS ถือว่า **บทสนทนา** คือจุดเริ่มต้นของ
ทุก workflow:

```
ลูกค้า → AI → CRM → ออร์เดอร์ → สต็อก → ชำระเงิน → จัดส่ง → Dashboard
```

**ช่องทางที่รองรับ:** LINE OA, TikTok Shop / TikTok Chat, Facebook Messenger,
Instagram, Live Chat หน้าเว็บ — _อนาคต:_ WhatsApp, Email, Voice AI

> 📖 วิสัยทัศน์ โมดูล และกฎต่าง ๆ อยู่ใน [`CLAUDE.md`](./CLAUDE.md),
> [`AI_WORKFLOW.md`](./AI_WORKFLOW.md), [`BUSINESS_RULES.md`](./BUSINESS_RULES.md)
> และ [`TOOLS.md`](./TOOLS.md)

---

### 🧠 ปรัชญาหลัก

**AI ห้ามแตะฐานข้อมูลโดยตรง** — หน้าที่ของ AI มีแค่:

- เข้าใจ intent ของลูกค้า
- เลือก business tool ให้ถูก
- สรุปข้อมูล / อธิบายผลลัพธ์

Business logic ทั้งหมดอยู่ใน **services** ฝั่ง backend และเข้าถึง DB ผ่าน
service/repository ที่อนุมัติแล้วเท่านั้น

```
ข้อความ → Intent → Entities → เลือก Tool → Backend Service → DB → คำตอบ
```

AI **ห้าม** เขียน SQL, ลบข้อมูล, แก้ราคา, ปรับสต็อก หรือคืนเงินเอง
การกระทำที่อ่อนไหวต้องมี **การยืนยันจากคน** หรือ **สิทธิ์ (role permission)**

---

### 🏗️ สถาปัตยกรรม

```
ลูกค้า
   ↓
Channel Integration      (LINE / TikTok / Facebook / IG / เว็บ)
   ↓
Omnichannel Inbox        (รวมทุกแชทไว้ที่เดียว)
   ↓
AI Orchestrator          (intent → entities → เลือก tool)
   ↓
Business Functions       (services / tools)
   ↓
Database                 (PostgreSQL)
   ↓
Response Generator       (Claude — แค่เรียบเรียงคำพูด ข้อมูลจริงมาจาก backend)
   ↓
ลูกค้า
```

Pipeline ของ AI ใช้ร่วมกันได้ทุกช่องทาง และคืน trace ของทุกขั้นเพื่อ debug
(`apps/web/lib/bms/pipeline.ts`)

---

### 🧩 โมดูลในระบบ

| โมดูล | หน้าที่ |
| --- | --- |
| **Channel Integration** ✅ | Webhook แยกต่อร้าน: LINE, TikTok, Facebook Messenger, Instagram DM + Website Live Chat — รวมเข้า pipeline เดียว (ตรวจ signature) |
| **Omnichannel Inbox** ✅ | อินบ็อกซ์รวม: ประวัติแชท, มอบหมายงาน, โน้ตภายใน, แท็ก, timeline, ค้นหา — ทุกข้อความจาก webhook (+คำตอบ AI) ถูกบันทึก, staff ตอบเองได้ (LINE push) |
| **AI Orchestrator** | ตรวจ intent, ดึง entity, เลือก tool |
| **CRM** | โปรไฟล์ลูกค้าข้ามช่องทาง, ประวัติซื้อ, มูลค่าตลอดชีพ |
| **Product Management** | สินค้า, variant, SKU, barcode, ราคา, หมวดหมู่ |
| **Inventory (IMS)** | สต็อก คงเหลือ / จอง / พร้อมขาย — ทุกการเปลี่ยนแปลงต้องบันทึก movement |
| **Orders (OMS)** | Draft → Pending → Paid → Packing → Shipped → Completed / Cancelled / Refunded |
| **Purchase** ✅ | ใบสั่งซื้อผู้ขาย, รับของ / รับบางส่วน, ประวัติซัพพลายเออร์ — `OPEN → PARTIAL → RECEIVED` (สต็อกเข้าตอนรับของ) |
| **Payment** ✅ | โอน, QR, บัตร, TikTok Pay, เงินสด — บันทึกการชำระ + ยืนยัน/ปฏิเสธ/คืนเงิน + ตรวจสลิปด้วย AI (`verifyPaymentSlip` แนะนำเท่านั้น) |
| **Shipping** ✅ | Flash, Kerry, DHL, Australia Post, NZ Post — จัดส่ง, tracking, สถานะ, label (`createShipment`/`updateTracking`); `DELIVERED → order COMPLETED` |
| **Reports** ✅ | Dashboard + รายงานยอดขายตามช่วงวันที่ (รายวัน/สถานะ/ช่องทาง), สรุปสต็อก (มูลค่า, ใกล้หมด/หมด), สินค้าขายดี — `/admin/reports` |

> ⚠️ **ทุกการเปลี่ยนสต็อกต้องสร้าง Stock Movement** ห้ามอัปเดตสต็อกโดยไม่บันทึก

---

### 🛠️ เทคโนโลยีที่ใช้

| เลเยอร์ | เทคโนโลยี |
| --- | --- |
| Web | **Next.js 14** (App Router) + **Ant Design** + Zustand |
| API | **GraphQL Yoga** + Apollo Client |
| Realtime | **WebSocket gateway** (`apps/ws`) + `graphql-ws` + Redis pub/sub |
| ฐานข้อมูล | **PostgreSQL 16** |
| Cache / Queue | **Redis 7** (cache, pub/sub, คิวโพสต์โซเชียล) |
| งานเบื้องหลัง | **social-worker** |
| Auth | NextAuth, JWT, Google / Facebook OAuth, bcrypt |
| Reverse proxy / TLS | **Caddy** |
| AI | Anthropic Claude (ตั้ง `ANTHROPIC_API_KEY`) — ถ้าไม่ตั้งจะใช้ template ภาษาไทยแทน |
| Orchestration | **Docker Compose** |

Business logic อยู่ใน [`apps/web/lib/bms/`](./apps/web/lib/bms/) และเปิดใช้ผ่าน
API routes ใน [`apps/web/app/api/bms/`](./apps/web/app/api/bms/)

---

### 🏢 Multi-Tenancy

AI-BMS เป็นระบบ **หลายผู้เช่า (SaaS)** — แต่ละร้าน (tenant) มี:

- สมัครเองแล้วสร้าง tenant + แพ็กเกจ/บิลลิ่งอัตโนมัติ
- Webhook แยกต่อร้าน: LINE, TikTok, **Facebook Messenger, Instagram DM**
  (`/api/bms/{channel}/webhook/{tenantId}` ตรวจ signature) + **Website Live Chat**
  แบบ public (`/api/bms/web/webhook/{tenantId}`)
- credential ของช่องทางแยกต่อร้าน — ตอบกลับด้วย **token ของร้านนั้น**
- roles / permissions แยกต่อร้าน, rate-limit webhook และ audit log

---

### 🚀 การเริ่มพัฒนา

**สิ่งที่ต้องมี:** Docker + Docker Compose (Node.js 20 ถ้าอยากรันนอก Docker)

1. **ตั้งค่า `.env`** ที่ root (Postgres, Redis, OAuth, SendGrid และ
   `ANTHROPIC_API_KEY` ถ้าต้องการใช้ AI จริง)

2. **รันทั้ง stack:**

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

   จะได้ **postgres**, **redis**, **web**, **ws**, **social-worker**,
   **caddy** และ **pgAdmin** (http://localhost:5050)

3. **หรือรันแอปในเครื่อง** (ต่อ Postgres/Redis ใน Docker):

   ```bash
   cd apps/web && npm install && npm run dev        # http://localhost:3000
   cd apps/ws  && npm install && npm run dev        # WS gateway :8080
   npm run worker:social --prefix apps/web          # worker โพสต์โซเชียล
   ```

> 🧪 ถ้าไม่ตั้ง `ANTHROPIC_API_KEY` AI จะตอบด้วย template ภาษาไทยแบบ
> deterministic เหมาะกับการทดสอบ pipeline แบบ offline

---

### 📦 การ Deploy

รายละเอียด production อยู่ใน [`README-prod.md`](./README-prod.md) โดยสรุป:

1. ตั้งค่า `.env` สำหรับ production
2. Build production image
3. รัน:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

Caddy จะจัดการ TLS และ reverse-proxy ไปยัง **web** และ **ws**

> ⚠️ **ความปลอดภัย production:** สำรอง DB ก่อนรัน migration, ตรวจด้วย
> `SELECT`/`SHOW` (read-only) ก่อนแก้ schema, ปล่อยการเปลี่ยนแปลงเล็กที่สุดก่อน
> และห้าม restart service บน production แบบไม่จำเป็น

---

### 🎯 หลักการออกแบบ

> ทุกอย่างเริ่มจากบทสนทนา
> **Conversation → Intent → Business Function → Business Data → Business Action → Customer Response**
>
> AI-BMS ไม่ใช่แชทบอท — แต่คือ **AI Business Operating System**
