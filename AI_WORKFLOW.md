# AI_WORKFLOW.md — AI Pipeline (AI-BMS)

ทุกช่องทางไหลเข้า pipeline เดียวกัน (channel-agnostic)
Implemented: [`apps/web/lib/bms/pipeline.ts`](apps/web/lib/bms/pipeline.ts)

```
Customer
    │
    ▼
Receive Message        ← webhook ต่อร้าน (LINE / TikTok / Facebook / Instagram / Web)
    │
    ▼
Detect Intent          ← understand()  [lib/bms/nlu.ts]  (rule-based NLU)
    │
    ▼
Extract Entities       ← product / size / qty / หลายรายการต่อข้อความ
    │
    ▼
Select Tool            ← ตาม intent
    │
    ▼
Call Backend Service   ← checkStock() / createOrder()  (RLS-scoped, atomic)
    │
    ▼
Receive Data           ← ข้อเท็จจริงสต็อก/ราคา/ผลออเดอร์ จาก DB
    │
    ▼
Generate Response      ← generateResponse()  [lib/bms/ai.ts]
    │                     • มี ANTHROPIC_API_KEY → Claude เรียบเรียง (ยัดข้อเท็จจริงเข้า prompt)
    │                     • ไม่มี key → template ภาษาไทย (deterministic)
    ▼
Reply Customer         ← ส่งกลับช่องทาง + บันทึกลง Inbox (logConversation)
```

---

## Intents (nlu.ts)

| Intent | ตัวอย่างข้อความ | Tool | ผลลัพธ์ |
| --- | --- | --- | --- |
| `CHECK_STOCK` | "Nike XL มีไหม" | `checkStock()` | เช็คสต็อก/ราคา แล้วตอบ |
| `CONFIRM_ORDER` | "สั่ง Nike XL 2 ชิ้น" | `createOrder()` | สร้าง order + reserve สต็อก (atomic) — ถามกลับถ้าข้อมูลไม่ครบ |
| `GREETING` | "สวัสดี" | — | ทักทาย + ชวนแจ้งรุ่น/ไซซ์ |
| อื่น ๆ | — | — | ตอบด้วย generateResponse (fallback) |

`CONFIRM_ORDER` รองรับหลายรายการต่อข้อความ เช่น "สั่ง Nike XL 1 ชิ้น กับ Adidas M 1 ชิ้น"
ถ้ารายการใดไม่ครบ (ไม่มีไซซ์/จำนวน/ไม่พบสินค้า) → ถามกลับ ไม่สร้าง order

---

## Channels → pipeline

| Channel | Webhook | Verify | ตอบกลับ (deliverToChannel) |
| --- | --- | --- | --- |
| LINE | `/api/bms/line/webhook/{tenantId}` | X-Line-Signature | reply API / push |
| TikTok | `/api/bms/tiktok/webhook/{tenantId}` | HMAC hex header | (ยังไม่ผูก send API) |
| Facebook | `/api/bms/facebook/webhook/{tenantId}` | X-Hub-Signature-256 | Graph Send API |
| Instagram | `/api/bms/instagram/webhook/{tenantId}` | X-Hub-Signature-256 | Graph Send API |
| Website | `/api/bms/web/webhook/{tenantId}` | public (rate-limit + CORS) | ตอบใน HTTP response |
| Playground | `/api/bms/chat` (channel=test) | — | คืน trace เต็ม (ไม่ log inbox) |

ทุกช่องทาง (ยกเว้น test) เรียก `logConversation()` → ข้อความเข้า+คำตอบ AI ถูกบันทึกใน **Omnichannel Inbox** อัตโนมัติ

---

## กฎเหล็ก (ดู BUSINESS_RULES.md)

- AI **ไม่แตะ DB โดยตรง / ไม่เขียน SQL** — เรียกผ่าน service ที่อนุมัติเท่านั้น
- AI **ห้ามเดา/แต่งตัวเลขสต็อก-ราคา** — ข้อเท็จจริงมาจาก backend เสมอ AI แค่เรียบเรียง
- การกระทำอ่อนไหว (ยืนยันเงิน/คืนเงิน/ยกเลิก/ปรับสต็อก) ต้องมี **คนยืนยัน + สิทธิ์ (RBAC)**
  เช่น `verifyPaymentSlip()` เป็นแค่คำแนะนำ — คนต้องกด confirm เอง

---

## AI Workflow #2 — Daily Log Triage (ops, ไม่ใช่ลูกค้า)

workflow AI แยกอีกตัวสำหรับดูแลระบบ (GitHub Actions รายวัน) —
Implemented: [`.github/workflows/daily-log-triage.yml`](.github/workflows/daily-log-triage.yml) + [`scripts/bms-log-triage/`](scripts/bms-log-triage/)

```
Cron (รายวัน)
    │
    ▼
Collect + Redact       ← ดึง error 24 ชม.จาก system_logs · ปิดบัง email/phone/token/PII
    │
    ▼
Claude Analyze/Patch   ← หา root cause ใน apps/web → แก้เฉพาะที่มั่นใจ (minimal) → npx tsc
    │
    ▼
Open Draft PR          ← base main · คนรีวิว/merge เอง (ห้าม auto-merge)
    │
    ▼
Notify LINE            ← push ลิงก์ PR (Messaging API; LINE Notify ปิดแล้ว)
```

หลักการเดียวกับ pipeline ลูกค้า: **AI เสนอ ไม่ตัดสินใจเอง** — คนยืนยันก่อนเข้า production เสมอ

---

## ทดสอบ pipeline / หน้าจอ

- **Playground** (`/api/bms/chat`, channel=test) — ยิงข้อความจำลองดู trace เต็ม (intent/tool/reply) โดยไม่ log inbox
- **Fake Data Seeder** (`/admin/dev/fake`) — สร้าง products/customers/orders/conversations/purchase ทีละมากๆ
  เพื่อเติม Dashboard/Reports/Inbox/Payment/Shipping/Purchase (dev only, marker `FAKE-`, cleanup ได้)
  · **seed ลง tenant ของผู้ล็อกอิน** — platform admin ต้อง drill-down เข้าร้าน (`bmsEnterTenant`) ก่อน จึงจะเห็น pipeline/ข้อมูลของร้านนั้น

> ทุก tool ใน pipeline วิ่งผ่าน service ที่ scope ด้วย `getTenantId(ctx)` — context ของ webhook มาจาก `{tenantId}` ใน URL,
> ของ admin มาจาก session (หรือร้านที่ platform admin กำลัง drill-down อยู่)
