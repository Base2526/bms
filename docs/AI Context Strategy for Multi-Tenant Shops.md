# **AI Context Strategy for Multi-Tenant Shops (v2 — เพิ่ม Accuracy Layers + เทียบกับโค้ดจริง)**

## **เป้าหมาย**

ทำให้ AI ตอบตามบริบทของแต่ละร้านได้จริง ไม่มั่ว ไม่หลุดหัวข้อ และยังประหยัด token แม้ระบบจะมีร้านจำนวนมาก เช่น 10,000+ ร้าน

- หลังจากการสนทนา chat เราควรสรุปเพื่อให้ chat ครั้งต่อไปเป็นข้อมูลในการ chat ครั้งถัดไป หรือจะสรุปตอนเริ่ม chat ครั้งใหม่เลย

---

## **หลักคิดสำคัญ**

- AI ควร "เข้าใจร้านนี้คือร้านอะไร" ก่อนตอบ
- แต่ไม่ควรโหลดข้อมูลสินค้าทั้งร้านเข้า prompt ทุกครั้ง
- ควรใช้แนวทาง `summary + retrieval + live verification`
- AI เป็นตัวช่วยสรุปและคุย
- Backend / tools เป็น source of truth สำหรับ fact สำคัญ

---

## **คำตอบสั้นที่สุด**

ควรทำแบบนี้:

1. มี `tenant summary` ต่อร้าน
2. มี `retrieval layer` สำหรับดึงเฉพาะข้อมูลที่เกี่ยว
3. มี `conversation state` ของลูกค้าแต่ละคน
4. มี `live tool verification` ตอนจะตอบ fact สำคัญ

ไม่ควร:

- โหลด product ทั้งร้านทุก request
- ให้ AI จำข้อมูลร้านแบบลอย ๆ เอง
- ให้ AI ตัดสินราคาหรือ stock เอง

---

# ควรให้ AI อ่านอะไรทุก Request

## 1) Tenant Summary

ข้อมูลสั้น ๆ ของร้าน ที่ควรโหลดทุกครั้ง

ตัวอย่าง:

- ร้านประเภทอะไร
- ขายแบบไหน
- ภาษาหลักอะไร
- ต้องถาม field อะไรบ้างก่อนสร้าง order
- มีนโยบาย fallback / handoff แบบไหน

ตัวอย่างข้อมูล:

```json
{
  "businessType": "fashion",
  "language": "th",
  "orderingStyle": "catalog_variant",
  "requiredFields": ["product", "size", "qty"],
  "interpretShortReplyFromContext": true,
  "handoffAfterFailedTurns": 2
}
```

> ✅ **Implemented (7.30)**: `bms_store_profile` เก็บ business type, language, ordering style,
> required fields, short-reply policy และ handoff threshold; Settings เป็นจุดแก้ไขและ pipeline สร้าง
> tenant summary แบบ deterministic จากค่าที่ backend validate แล้ว

---

## 2) Conversation State

ควรโหลดทุก request เช่นกัน

ตัวอย่าง:

- ตอนนี้กำลังคุยสินค้าตัวไหน
- draft order ตอนนี้มีอะไรแล้ว
- field อะไรยังขาด
- ล่าสุด AI ถามอะไรไว้

> ✅ **Implemented (7.30)**: recent history มาจาก `bms_messages`; slot/intent/last-asked state ที่ต้อง
> อยู่ข้าม compression window เก็บใน `bms_conversations.ai_state` และ merge กับ state ที่ derive สด

---

## 3) Relevant Retrieval

โหลดเฉพาะเมื่อเกี่ยวข้อง

ตัวอย่าง:

- product candidates ที่ใกล้กับข้อความล่าสุด
- coupon ของลูกค้าคนนี้
- order ล่าสุดของลูกค้า
- stock ของสินค้าที่กำลังคุย

> ของจริง: ทำผ่าน tool-calling อยู่แล้ว (`search_products`/`check_stock`/`list_customer_coupons`/
> `get_order_status` ใน `lib/bms/tools/catalog.ts`) — AI เรียกเองตามต้องการ ไม่ได้ retrieve ล่วงหน้าแบบ
> vector search ถือว่าตรงกับหลักการนี้แล้ว เพียงแต่ไม่มี re-ranker (ดู Layer 4)

---

## 4) Live Verification

ใช้ backend tools เช็กความจริงก่อนตอบเรื่องสำคัญ

เช่น:

- ราคา
- stock
- coupon ใช้ได้ไหม
- order state
- variant ใช้ได้จริงไหม

> ของจริง: ทำอยู่แล้วผ่าน tool-calling runtime — นี่คือส่วนที่ implement ได้ดีที่สุดในระบบตอนนี้

---

# สิ่งที่ไม่ควรทำ

## ไม่ควรโหลดข้อมูลทั้งร้านทุกครั้ง

เช่น:

- product ทั้งร้าน
- stock ทั้งร้าน
- coupon ทั้งระบบ
- order history ทั้งหมด

เหตุผล:

- token แพง
- ช้า
- AI สับสนง่าย
- scale ไม่ได้

## ไม่ควรให้ AI เป็น source of truth

AI ไม่ควรเป็นคนฟันธงเองเรื่อง:

- ราคา
- stock
- discount
- eligibility
- order status

---

# แนวทางที่ควรใช้กับร้านจำนวนมาก

## ใช้ Tenant-Aware Dynamic Context Retrieval

ความหมายคือ:

- ทุก request ต้องรู้ว่าเป็น tenant ไหน
- โหลด summary สั้น ๆ ของร้านนั้นก่อน
- โหลด state ของบทสนทนานั้น
- retrieve เฉพาะข้อมูลที่เกี่ยว
- ค่อยให้ AI ตอบหรือเรียก tool ต่อ

---

# ควรให้ AI สรุปข้อมูลร้านได้ไหม

## คำตอบ: ได้

แต่ควรให้ AI เป็น "ตัวช่วยสรุป" ไม่ใช่ "ตัวเก็บความจริงทั้งหมด"

AI สามารถช่วยสรุปข้อมูลร้านได้ เช่น:

- ร้านนี้เป็นร้านประเภทอะไร
- สินค้าส่วนใหญ่มี field อะไร
- คำเรียกสินค้ายอดฮิตคืออะไร
- ต้องถามอะไรเพิ่มก่อนสร้าง order
- ลูกค้ามักพิมพ์คำแบบไหน

---

# ควรสรุปเมื่อไหร่

## 1) ตอนร้านเริ่มใช้งานครั้งแรก

ควร generate initial summary เช่น:

- business type
- ordering style
- required fields
- optional fields
- synonym เบื้องต้น
- fallback policy
- handoff policy

## 2) เมื่อ catalog เปลี่ยนเยอะ

ควร refresh summary บางส่วน ตัวอย่าง:

- มีหมวดสินค้าใหม่
- เพิ่ม option ใหม่
- เปลี่ยนแนวทางการขาย
- มีสินค้าใหม่จำนวนมาก

## 3) เป็นรอบ เช่นทุกสัปดาห์

ทำ weekly refresh ได้ สิ่งที่ควร refresh:

- synonym ใหม่จากบทสนทนา
- คำถามที่ AI ตอบพลาดบ่อย
- สินค้าหลักที่คนถามบ่อย
- modifier ที่พบใหม่
- pattern fallback / handoff

## 4) ทุก request

ไม่ต้อง regenerate summary ใหม่ทุกครั้ง ให้โหลด summary เดิม + conversation state + retrieval เฉพาะที่เกี่ยวก็พอ

---

# สิ่งที่ควรให้ AI สรุป

## สรุประดับร้าน

- business type
- language
- ordering style
- required fields per category
- optional fields per category
- common synonyms
- common customer phrases
- fallback policy
- handoff policy

## สรุประดับ retrieval metadata

- product aliases
- keyword mapping
- modifier terms
- category hints
- common misspellings
- frequently requested variants

---

# สิ่งที่ไม่ควรให้ AI ตัดสินเองแม้จะมี summary

- ราคา
- stock
- coupon eligibility
- final order validation
- payment/shipping truth
- order creation success

สิ่งเหล่านี้ต้องตรวจจาก backend ตอน runtime

---

# Architecture ที่แนะนำ (v2 — พร้อม Accuracy Layers)

```
Incoming message
      │
      ▼
[Layer 1: Pre-AI Processing]  ← ใหม่
  Intent Pre-Classifier
  Entity Normalizer
  Short Reply Resolver
  Idempotency Check
      │
      ▼
Resolve tenant + customer
      │
      ├── Load tenant summary
      ├── Load conversation state
      └── Retrieve relevant data (re-ranked)
              │
              ▼
[Layer 2: Prompt Engineering]  ← ใหม่
  Structured output schema
  Slot-filling state machine
  Few-shot examples per business type
              │
              ▼
      AI Core (Claude)
              │
              ▼
[Layer 3: Post-AI Validation]  ← ใหม่
  Output schema validator
  Confidence gate
  Unverified fact detector
  Turn budget enforcer
              │
              ▼
[Layer 4: Context Quality]  ← ใหม่
  Conversation compressor (>10 turns)
              │
              ▼
Backend verifies truth before final action
              │
              ▼
Update state + Audit log
              │
              ▼
[Layer 5: Learning Loop]  ← ใหม่
  Failure logger
  Synonym discovery
  Per-tenant accuracy metrics
```

> ⚠️ **สำคัญที่สุด — อ่านก่อนเริ่ม implement**: diagram นี้วาดโดยสมมติว่า AI ตอบเป็น **JSON เดียวจบ**
> ทุกครั้ง (`intent/confidence/slots/action/toolCalls` อยู่ในก้อนเดียว) แต่ระบบจริงตอนนี้ใช้
> **Claude native tool-use** (`tool_use` blocks วนหลายรอบ ใน `lib/bms/tools/runtime.ts`) ซึ่งเป็นคนละ
> pattern กัน — Layer 2/3 ตามตัวอักษรของ diagram นี้ **ใช้ไม่ได้ตรงๆ กับของจริง** ต้องแปลความหมายใหม่
> ก่อนเอาไป implement ดูหัวข้อ "สถานะจริงเทียบกับโค้ด" ท้ายเอกสารสำหรับวิธีแปลงแต่ละ layer ให้เข้ากับ
> native tool-use แทนที่จะรื้อ architecture เดิมทิ้ง

---

# ประโยชน์ของแนวทางนี้

- ประหยัด token
- ตอบแม่นขึ้น
- scale ได้กับหลายร้าน
- แยกบริบทแต่ละร้านชัด
- ลด fallback มั่ว
- ลดการหลุดหัวข้อ
- update ได้เป็นรอบ
- backend ยังควบคุมความจริงได้

---

# ความเสี่ยงถ้าทำผิดวิธี

## ถ้าโหลดทุกอย่างทุกครั้ง

- prompt ใหญ่เกิน
- ช้าลง
- token แพง
- AI สับสน
- context noise สูง

## ถ้าไม่แยก tenant context

- ร้านเสื้อผ้ากับร้านกาแฟใช้ logic ปนกัน
- AI ถาม field ผิด
- fallback ไม่ตรงร้าน
- order flow มั่ว

## ถ้าให้ AI overwrite summary อัตโนมัติทั้งหมด

- summary อาจเพี้ยนทั้งร้าน
- behavior ของระบบอาจ drift
- ควรมี version / validation / merge strategy

## ถ้าไม่มี Confidence Gate (ใหม่)

- AI ทำ action ทั้งที่ตัวเองไม่มั่นใจ
- ลูกค้าได้รับราคาหรือสินค้าผิด
- สร้าง order ผิดโดยไม่รู้ตัว

> หมายเหตุ: native tool-use ของ Claude **ไม่มี field confidence ให้เช็ค** ต้อง approximate ด้วยวิธีอื่น
> (ดู 3.2 ฉบับแปลงสำหรับระบบนี้)

## ถ้าไม่มี Structured Output Schema (ใหม่)

- AI ตอบ free-form บางครั้ง บาง format ไม่ parse ได้
- ระบบ fallback ผิดพลาด
- debug ยาก ไม่มี reasoning trail

> หมายเหตุ: ของจริงไม่มีปัญหานี้อยู่แล้วในระดับ tool call เพราะ native tool-use บังคับ args ให้ตรง
> JSON schema ของแต่ละทูลอัตโนมัติ (validate ซ้ำอีกชั้นใน `validateKnownFields()`) ปัญหาที่เหลือจริงคือ
> **ข้อความ free-text ตอนไม่เรียกทูล** เท่านั้น (ดู Unverified Fact Detector)

---

# Layer 1 — Pre-AI Processing (ใหม่)

เพิ่มก่อน AI call ทุกครั้ง เพื่อลด ambiguity ที่ส่งเข้า prompt

---

## 1.1) Intent Pre-Classifier

จำแนก intent หยาบก่อน เพื่อเลือก prompt template ที่ถูกต้อง

Intent หลักที่ควรมี:

| Intent | Prompt Template ที่ใช้ |
|---|---|
| `ordering` | Slot-filling mode, เน้นเก็บ required fields |
| `inquiry` | Retrieval mode, เน้นตอบข้อมูลสินค้า |
| `cancel` | Order lookup mode, ดึง order ล่าสุดก่อน |
| `change_order` | Order lookup + diff mode |
| `complaint` | Handoff mode, escalate เร็ว |
| `greeting` | Lightweight response, ไม่ต้องโหลด retrieval |

ตัวอย่าง implementation:

```javascript
async function classifyIntent(text, conversationState) {
  const patterns = {
    cancel:       /ยกเลิก|cancel|ไม่เอาแล้ว/i,
    change_order: /เปลี่ยน|แก้ไข|ขอเปลี่ยน/i,
    complaint:    /ไม่พอใจ|ปัญหา|ผิด|เสีย/i,
    greeting:     /^(สวัสดี|หวัดดี|ดี|hello|hi)[\s!]*$/i,
  };

  for (const [intent, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) return intent;
  }

  if (conversationState?.currentProduct) return 'ordering';

  return 'inquiry'; // default
}
```

> ✅ **Implemented**: `classifyCustomerIntent()` แยก intent ก่อน provider call; intent ที่ชัดเจน
> server-route ผ่าน approved tool, greeting ตอบ deterministic โดยไม่เรียก model และ intent guidance
> อยู่ใน volatile block จึงไม่ invalidate prompt cache

---

## 1.2) Entity Normalizer

Normalize ค่าที่ลูกค้าพิมพ์มาก่อนส่งให้ AI เพื่อให้ค่าใน slot สม่ำเสมอ

ตัวอย่าง normalization map:

```json
{
  "color": {
    "ดำ": "black", "สีดำ": "black", "ดำๆ": "black",
    "ขาว": "white", "สีขาว": "white",
    "แดง": "red", "ชมพู": "pink", "ฟ้า": "blue", "น้ำเงิน": "navy"
  },
  "size": {
    "เล็ก": "S", "กลาง": "M", "ใหญ่": "L", "ใหญ่มาก": "XL",
    "xs": "XS", "s": "S", "m": "M", "l": "L", "xl": "XL", "xxl": "XXL"
  }
}
```

ตัวอย่าง implementation (PHP):

```php
function normalizeEntities(string $text, array $normMap): array {
    $found = [];
    foreach ($normMap as $field => $aliases) {
        foreach ($aliases as $alias => $canonical) {
            if (mb_stripos($text, $alias) !== false) {
                $found[$field] = $canonical;
                break;
            }
        }
    }
    return $found;
}
```

> **สถานะจริงหลัง 7.30**: search ครอบคลุม name/SKU/barcode/category/brand/`keywords[]` และมี
> human-reviewed synonym discovery; ยังตั้งใจไม่ทำ fuzzy/vector matching เพื่อให้ผลลัพธ์อธิบายได้
>
> ⚡ **Quick-win ก่อน Entity Normalizer เต็มรูปแบบ (P-0.5)**: ที่จริงมี alias mechanism อยู่แล้วในระบบ
> **โดยไม่ต้อง migration ใหม่เลย** — คอลัมน์ `bms_products.keywords[]` มีอยู่แล้ว และ `resolveProduct()`
> ([lib/bms/stock.ts:42](../apps/web/lib/bms/stock.ts)) ก็ query ผ่าน `unnest(keywords)` เต็มรูปแบบ แต่
> เป็น path fallback เก่าเท่านั้น (ใช้ตอนไม่มี AI credentials) ส่วน `listProducts()`
> ([lib/bms/products.ts](../apps/web/lib/bms/products.ts)) ที่ `search_products`/`get_product`
> เรียกใช้จริงตอนนี้ — WHERE clause match แค่ `name ILIKE / sku ILIKE / barcode ILIKE` **ไม่แตะ
> `keywords[]` เลย** ทั้งที่ column ถูก SELECT มาด้วยอยู่แล้ว (`ProductRowFull.keywords`) แปลว่า alias
> ที่ร้านตั้งไว้ใช้ไม่ได้เลยกับ AI tool-calling ที่ลูกค้าคุยด้วยจริง — แก้แค่เพิ่มเงื่อนไข keywords เข้า
> WHERE clause ของ `listProducts()` (pattern เดียวกับ `stock.ts:48-51`) ก็ได้ accuracy กลับมาทันที ไม่ต้อง
> รอ migration/alias table ใหม่เลย
>
> ✅ **Implemented (P-0.5)**: แก้แล้วใน [`lib/bms/products.ts`](../apps/web/lib/bms/products.ts) — WHERE
> clause ของ `listProducts()` เพิ่ม `EXISTS (SELECT 1 FROM unnest(keywords) AS k WHERE k ILIKE ...)` แล้ว
>
> ✅ **Implemented (P2, แทนที่แผน "migration ใหม่เก็บ alias ต่อ tenant" เดิม)**: ไม่ได้สร้างตาราง alias
> ใหม่ (จะกลายเป็น schema ที่ไม่มี UI จัดการ = half-finished) — ใช้ `listCategories(tenantId)`
> ([`lib/bms/productCategories.ts`](../apps/web/lib/bms/productCategories.ts), มีอยู่แล้ว จัดการได้ที่
> `/admin/products`) ฝังรายชื่อหมวดหมู่จริงของร้านเข้า system prompt แทน (`buildCustomerSystem()` ใน
> [`lib/bms/pipeline.ts`](../apps/web/lib/bms/pipeline.ts)) — ปิด gap เดิมโดยไม่ต้องมี schema ใหม่

---

## 1.3) Short Reply Resolver

เมื่อลูกค้าตอบสั้น ๆ ควร resolve ด้วย rule-based ก่อน ไม่ส่งให้ AI ตีความเอง

```javascript
function resolveShortReply(text, conversationState) {
  const wordCount = text.trim().split(/\s+/).length;
  const { lastAskedField, currentProduct } = conversationState;

  if (wordCount > 3 || !lastAskedField) return null;

  const normalized = normalizeEntities(text, tenantNormMap);

  if (normalized[lastAskedField]) {
    return { resolvedField: lastAskedField, resolvedValue: normalized[lastAskedField], skipAI: true };
  }

  if (/^(เอา|ได้|โอเค|ok|ตกลง|ใช่)$/i.test(text.trim()) && currentProduct) {
    return { resolvedField: 'confirm_product', resolvedValue: currentProduct, skipAI: false };
  }

  return null;
}
```

> ✅ **Implemented**: `normalizeShortReplyMessage()` resolve size, quantity, payment method และ
> confirmation จากคำถามล่าสุดก่อนเข้า classifier/tool loop; เปิด/ปิดต่อ tenant ได้

---

## 1.4) Idempotency Check

ป้องกัน webhook replay หรือ duplicate request

```sql
CREATE TABLE ai_message_log (
  message_id  VARCHAR(128) NOT NULL,
  tenant_id   INT          NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, tenant_id),
  INDEX idx_created (created_at)
);
```

```php
function isDuplicateMessage(string $messageId, int $tenantId): bool {
    $sql = "SELECT 1 FROM ai_message_log
            WHERE message_id = ? AND tenant_id = ?
            AND created_at > NOW() - INTERVAL 10 MINUTE
            LIMIT 1";
    $row = $db->fetchOne($sql, [$messageId, $tenantId]);
    if ($row) return true;
    $db->execute("INSERT IGNORE INTO ai_message_log (message_id, tenant_id) VALUES (?, ?)", [$messageId, $tenantId]);
    return false;
}
```

> **สถานะจริง**: ก่อนสร้างตารางใหม่ ต้อง grep เช็คทุก webhook route ก่อน (`app/api/bms/*/webhook/*`)
> ว่ามี dedup อยู่แล้วหรือยัง (หลายช่องทางมักเช็ค message id/reply token ของ platform เองอยู่แล้วในชั้น
> parsing) — ตาม convention ของโปรเจกต์นี้ (เคยพลาดเรื่อง channel array กระจายหลายจุดมาแล้ว ดู
> `CLAUDE.local.md` § Shopee/Lazada) ถ้ามี logic ซ้ำอยู่แล้วบางช่องทาง ให้รวมเป็นจุดเดียวแทนสร้างตารางใหม่
> ซ้อนทับ
>
> ✅ **Implemented (7.30)**: `bms_inbound_events` ใช้ primary key
> `(tenant_id, channel, external_event_id)` พร้อม RLS/grants; webhook claim ก่อนเข้า pipeline.
> Web Chat รับ `messageId`/`Idempotency-Key` และไม่เดา key จากข้อความ

---

# Layer 2 — Prompt Engineering (ใหม่)

## 2.1) Structured Output Schema

บังคับให้ AI ตอบเป็น JSON เสมอ ห้ามตอบ free-form text — schema ที่เสนอ:

```json
{
  "intent": "ordering",
  "confidence": 0.92,
  "slots": { "product": "Classic Tee", "size": null, "qty": 2 },
  "missingSlots": ["size"],
  "action": "ask_back",
  "responseText": "ต้องการไซส์อะไรคะ มี S / M / L / XL",
  "toolCalls": [],
  "reasoning": "ลูกค้าระบุสินค้า สี และจำนวนแล้ว แต่ยังไม่ได้บอกไซส์"
}
```

> ⚠️ **ตัดสินใจแล้ว: ไม่ทำแบบนี้ตรงๆ** — schema นี้ชนกับ native tool-use ของ `runtime.ts` โดยตรง
> (`toolCalls` เป็น array ข้อมูล ไม่ใช่ mechanism จริงที่ยิง tool) ถ้าบังคับให้ AI ตอบ JSON แบบนี้แทน
> จะต้อง**รื้อ tool-use protocol ทิ้งทั้งหมด** (multi-round loop, permission gate ต่อทูล, proposal flow
> ของ sensitive action ที่ทำไว้แล้วใน `runToolLoop()`) แล้วเขียน parser JSON เองใหม่ — เสี่ยงสูง ได้ไม่คุ้มเสีย
>
> สิ่งที่ยังหยิบมาใช้ได้จาก idea นี้โดยไม่รื้อของเดิม: เพิ่มทูลเฉพาะ `ask_clarification(question,
> missingSlot)` เข้า `customerTools()` ให้ Claude เรียกแทนการตอบ text ตรงๆ เวลาจะถามกลับ — ได้ trace
> ที่ structured (`missingSlot` เป็น arg จริง) โดยไม่ต้องเปลี่ยน protocol หลัก

## 2.2) Slot-Filling State Machine in Prompt

ระบุ state ปัจจุบันชัดเจนใน prompt เพื่อให้ AI ถามทีละ 1 field เท่านั้น

```
## สถานะการสนทนาตอนนี้
Required fields สำหรับสร้าง order: product, color, size, qty
Slots ที่เก็บได้แล้ว:
  - product: "Classic Tee" (confirmed)
  - color: "black" (confirmed)
  - size: (ยังไม่ได้)
  - qty: 2 (confirmed)
Field ที่ขาด: ["size"]
Field ที่ AI ถามล่าสุด: "size"
กฎ: ถามทีละ 1 field เท่านั้น ห้ามถามหลาย field พร้อมกัน
```

> **สถานะจริง**: ใช้ native tool-use ต่อได้โดยไม่ต้องเปลี่ยนเป็น single-shot JSON
>
> ✅ **Implemented (native-tool form)**: required fields มาจาก tenant policy; slot state อยู่ใน
> `bms_conversations.ai_state`, merge กับ recent history และส่งเป็น volatile order-memory block
> `create_order` ยังรับ `sku + size + qty` ตาม stock invariant เดิม; ถ้า policy ไม่บังคับถาม size
> โมเดลใช้ variant จากผล tool ได้เฉพาะกรณีมีตัวเลือกเดียว ถ้ามีหลายตัวเลือกต้องถามลูกค้า

## 2.3) Few-Shot Examples per Business Type

เพิ่ม 2–3 ตัวอย่างใน prompt ตาม `businessType` ของ tenant:

```
ตัวอย่าง 1 — ลูกค้าพูดกำกวม:
  ลูกค้า: "เสื้อสีดำ"
  AI: ถาม "สนใจเสื้อรุ่นไหนคะ? มี Classic Tee, Oversized Tee หรือ Polo"

ตัวอย่าง 2 — ลูกค้าเปลี่ยนใจ:
  ลูกค้า: "เปลี่ยนเป็น L แทนนะ"
  AI: เรียก update_draft_order({size: "L"})
```

> ✅ **Implemented**: `businessType` ตั้งจาก Settings และมีตัวอย่าง 2 กรณีต่อ
> `fashion/beauty/food/electronics/home/general`

---

# Layer 3 — Post-AI Validation (ใหม่)

## 3.1) Output Schema Validator

> **สถานะจริง**: ไม่จำเป็นในรูปแบบเดิม เพราะ native tool-use ของ Claude validate args เข้ากับ
> `input_schema` ของแต่ละทูลอัตโนมัติอยู่แล้ว (และ `validateKnownFields()` ใน `runtime.ts:48` reject
> field แปลกซ้ำอีกชั้น) — ส่วนที่ validator แบบนี้ยังช่วยได้จริงคือ **การ retry เมื่อ tool args ผิด
> format ซ้ำๆ ใน loop เดียวกัน** ซึ่งยังไม่มี logic เฉพาะ (ตอนนี้ error แค่ถูกส่งกลับเป็น tool_result
> ให้ Claude เห็นแล้วให้ Claude ตัดสินใจเอง — ใช้งานได้อยู่แล้วในทางปฏิบัติ)

## 3.2) Confidence Gate (แปลงสำหรับ native tool-use)

> เดิมเสนอ: ถ้า AI ส่ง `confidence < 0.7` → force ask_back
>
> **ปัญหา**: native tool-use ไม่มี field confidence ให้เช็ค Claude จะ "ตัดสินใจ" ผ่านการเลือกเรียกทูล
> หรือตอบ text ตรงๆ เท่านั้น ไม่มีตัวเลขความมั่นใจแนบมาด้วย
>
> **ทางเลือกที่ใช้ได้จริงกับระบบนี้**: ใช้ **Turn/Handoff counter** แทน (ดู 3.4) — วัด "ความไม่มั่นใจ"
> ทางอ้อมจากพฤติกรรม (ถามซ้ำ field เดิม, ไม่เรียกทูลเขียนสำเร็จหลายรอบติด) แทนตัวเลข confidence ตรงๆ
>
> ✅ **Implemented (ผ่าน 3.4)** — ดูรายละเอียดที่ 3.4 ด้านล่าง

## 3.3) Unverified Fact Detector

ตรวจว่า responseText มีตัวเลขราคาหรือ stock แต่ไม่มี tool call ที่ verify มาก่อน:

```javascript
const PRICE_PATTERN = /(\d{1,3}(,\d{3})*|\d+)\s*(บาท|฿|baht)/i;
const STOCK_PATTERN = /มี\s*(\d+)\s*(ชิ้น|ตัว|อัน|คู่)/i;
const VERIFIED_TOOLS = ['search_products', 'check_stock', 'get_store_info'];

function detectUnverifiedFacts(replyText, trace) {
  const verifiedOk = trace.some(t => VERIFIED_TOOLS.includes(t.tool) && t.ok);
  if ((PRICE_PATTERN.test(replyText) || STOCK_PATTERN.test(replyText)) && !verifiedOk) {
    return true; // block / re-prompt แทนการส่งไปให้ลูกค้า
  }
  return false;
}
```

> ✅ **สถานะจริง**: นี่คือช่องโหว่จริงและ**ทำได้ทันทีโดยไม่ต้องแตะ tool-use protocol เลย** —
> `runToolLoop()` คืน `loop.trace` (`ToolTraceEntry[]`) มาอยู่แล้ว (`runtime.ts:17`) แค่เพิ่ม guard นี้
> ใน `pipeline.ts` หลังบรรทัด `if (loop.usedAi) { ... }` (บรรทัด 187) ก่อน return — เช็คจาก `loop.reply`
> เทียบกับ `loop.trace` ที่มีอยู่แล้ว ถือเป็น**งานที่ ROI สูงและเสี่ยงต่ำที่สุดในเอกสารทั้งหมด**
>
> ✅ **Implemented** — `hasUnverifiedFacts()` ใน [`lib/bms/pipeline.ts`](../apps/web/lib/bms/pipeline.ts)
> เช็ค `PRICE_PATTERN`/`STOCK_PATTERN` เทียบกับ `loop.trace` (ทูลที่นับเป็น verified:
> `search_products`/`get_product`/`check_stock`/`get_store_info`/`get_payment_info`/
> `get_shipping_estimate`/`check_coupon`/`list_available_coupons`/`list_customer_coupons`) ถ้าไม่เจอ
> tool call ที่ ok=true รองรับ → แทนที่ reply ด้วยข้อความขอเช็คใหม่แทนการส่งเลขที่ไม่ verify ไปให้ลูกค้า

## 3.4) Turn Budget Enforcer

```javascript
function enforceTurnBudget(aiResponse, conversationState, tenantSummary) {
  const maxFailed = tenantSummary.handoffAfterFailedTurns ?? 3;
  const isRepeatedAskBack = (
    aiResponse.action === 'ask_back' &&
    conversationState.lastAskedField &&
    aiResponse.missingSlots?.includes(conversationState.lastAskedField)
  );
  const newFailedCount = isRepeatedAskBack ? (conversationState.failedTurns ?? 0) + 1 : 0;
  if (newFailedCount >= maxFailed) {
    return { ...aiResponse, action: 'handoff', responseText: 'ขอโทษนะคะ ขอให้เจ้าหน้าที่ช่วยต่อได้เลยค่ะ' };
  }
  conversationState.failedTurns = newFailedCount;
  return aiResponse;
}
```

> **สถานะจริง**: ตรงกับปัญหาที่บันทึกไว้แล้วใน `CLAUDE.local.md` § AI tool-calling จึงใช้วิธีที่เข้ากับ
> native tool-use: ถ้า N ข้อความติดกัน
> จาก `(channel, customerRef)` เดียวกันไม่มี tool call ที่เป็น write action (`create_order`,
> `submit_payment`) สำเร็จเลย → เพิ่ม counter ผูกกับ `bms_conversations` (มี `assigned_to_user_id`/
> status column อยู่แล้ว) แล้ว force handoff เมื่อถึง threshold
>
> ✅ **Implemented** — migration
> [`7.28__bms_conversations_ai_turns.sql`](../db/migrations/7.28__bms_conversations_ai_turns.sql) เพิ่ม
> `bms_conversations.ai_consecutive_askbacks` · `resolveConversationId()`/`bumpAiTurnCounter()` ใน
> [`lib/bms/inbox.ts`](../apps/web/lib/bms/inbox.ts) · logic ใน `pipeline.ts`: ไม่มี tool ใน
> `CUSTOMER_PROGRESS_TOOLS` ที่ ok=true ติดกันครบ
> ครบ threshold จาก `bms_store_profile.ai_handoff_after_failed_turns` → override reply เป็น handoff + เขียน internal note
> (`addNote(..., author: "AI")`, staff เห็นในแท็บโน้ตของ Inbox ที่มีอยู่แล้ว) แล้ว reset counter กันแจ้งซ้ำ
> ทุกข้อความถัดไป
>
> **แก้เพิ่ม (2026-07)**: เดิมนับความคืบหน้าจากทูล write เท่านั้น (`create_order`/`submit_payment`/
> `reorder`) ลูกค้าที่ถามสินค้า/สต็อกสามข้อความติดจึงถูก force handoff ทั้งที่ AI เรียกทูลถูกทุกครั้ง ·
> ตอนนี้ `CUSTOMER_PROGRESS_TOOLS` = ทูลทั้งชุดของ `customerTools()` และคำถามกลับที่เป็น business
> clarification (ถามไซซ์/จำนวน/ช่องทางที่โอน) ก็นับเป็นความคืบหน้าด้วย — handoff จึงเหลือไว้สำหรับบทสนทนา
> ที่ไม่คืบจริง ๆ เท่านั้น

---

# Layer 4 — Context Quality (ใหม่)

## 4.1) Conversation Compressor

```javascript
const COMPRESS_THRESHOLD = 10; // turns

async function buildConversationContext(turns, currentState) {
  if (turns.length <= COMPRESS_THRESHOLD) return { type: 'full', turns };
  const oldTurns = turns.slice(0, -3);
  const recentTurns = turns.slice(-3);
  const summary = currentState.rollingSummary ?? await generateRollingSummary(oldTurns);
  return { type: 'compressed', summary, recentTurns, currentState };
}
```

> ✅ **Implemented (bounded deterministic compressor)**: โหลดได้สูงสุด 48 messages; เมื่อเกิน 12
> จะเก็บ 8 ล่าสุดเต็มและสรุป slot/payment/coupon/ช่วงท้ายจากส่วนเก่าเป็น volatile block. Durable
> `ai_state` กัน slot สำคัญหายเมื่อพ้น fetch window และไม่เสีย model call เพิ่มเพื่อสร้าง summary

## 4.2) Retrieval Re-Ranker

```php
function rerankProducts(array $candidates, string $query, array $normalizedEntities): array {
    foreach ($candidates as &$product) {
        $score = $product['semantic_score'];
        if (mb_stripos($product['name'], $query) !== false) $score += 0.3;
        foreach ($normalizedEntities as $field => $value) {
            if (isset($product['variants'][$field][$value])) $score += 0.2;
        }
        $product['final_score'] = min($score, 1.0);
    }
    usort($candidates, fn($a, $b) => $b['final_score'] <=> $a['final_score']);
    return array_slice($candidates, 0, 3);
}
```

> ✅* **Implemented แบบ heuristic**: rank exact SKU/name/barcode/keyword ก่อน prefix และ
> category/brand แล้วจึงเรียงชื่อ; ไม่อ้างว่าเป็น semantic/vector score

## 4.3) Turn Budget Enforcer

ย้ายไปรวมกับ 3.4 แล้ว (เป็นเรื่องเดียวกัน วางไว้ที่ post-validation จะตรงกว่า)

---

# Layer 5 — Learning Loop (ใหม่)

## 5.1) Failure Logger

```sql
CREATE TABLE ai_failure_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  input_text TEXT NOT NULL,
  ai_intent VARCHAR(32),
  confused_field VARCHAR(64),
  action_taken VARCHAR(32),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_date (tenant_id, created_at)
);
```

> **สถานะจริง**: ก่อนสร้างตารางใหม่ — ระบบมี `bms_audit_log` เก็บ `ai.tool_call` อยู่แล้ว (ทุก tool
> attempt, ไม่เก็บ raw args, ดู `runtime.ts:79` `auditToolCall()`) ตาม convention ของโปรเจกต์นี้ที่เน้น
> reuse ตารางเดิมเสมอ (ดู `CLAUDE.local.md` เกือบทุกหัวข้อ) ควร derive "failure signal" จาก query บน
> `bms_audit_log` ที่มีอยู่แล้ว (เช่น outcome=`error`/`denied` ติดกันหลายครั้ง) แทนสร้าง
> `ai_failure_log` แยก
>
> ✅ **Implemented** — `getAiFailureSummary(tenantId, days)` ใน
> [`lib/bms/aiUsage.ts`](../apps/web/lib/bms/aiUsage.ts) query `bms_audit_log` (action=`ai.tool_call`,
> outcome error/denied) grouped by tool ตามที่แนะนำไว้ ไม่มีตารางใหม่ และต่อ GraphQL
> `bmsAiFailureSummary` (`report.view`) + การ์ด AI health บน Dashboard แล้ว
>
> ✅ **Extended (7.31)** — signal ราย AI turn ถูกเก็บเป็น enum/count ที่
> `bms_messages.meta.aiQuality` และ queue `bms_ai_quality_reviews` อ้าง message/conversation เดิม
> โดยไม่ copy raw text. ทุก `FAILURE`/`HANDOFF`/`UNRESOLVED` เข้า Failure Cases และสุ่ม turn ปกติ
> ประมาณ 5% เข้า QA; หน้า `/admin/ai-quality` redact PII ก่อนแสดงและให้มนุษย์บันทึก
> `PASS`/`FAIL`/`UNCLEAR`

## 5.2) Synonym Discovery

```sql
CREATE TABLE ai_synonym_candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  original VARCHAR(128) NOT NULL,
  corrected VARCHAR(128) NOT NULL,
  field VARCHAR(64),
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant_status (tenant_id, status)
);
```

> ✅ **Implemented with human review**: คำค้น customer ที่ไม่พบผลและผ่าน PII-like filter ถูกนับใน
> `bms_ai_synonym_candidates`; หน้า Products ให้ผู้มี `product.edit` ผูก SKU แล้ว approve/reject.
> การ approve reuse `upsertProduct()` เพื่อเพิ่มลง `keywords[]` พร้อม revision attribution

## 5.3) Per-Tenant Accuracy Metrics

```sql
CREATE TABLE ai_tenant_metrics_daily (
  tenant_id INT NOT NULL,
  metric_date DATE NOT NULL,
  total_sessions INT DEFAULT 0,
  handoff_count INT DEFAULT 0,
  clarification_count INT DEFAULT 0,
  PRIMARY KEY (tenant_id, metric_date)
);
```

> **สถานะจริง**: ระบบมี `bms_ai_usage_monthly`/`ai_message_log`-style tracking อยู่แล้วสำหรับ quota
> (`lib/bms/aiUsage.ts`) — ควรพิจารณาต่อยอดตารางนั้นเพิ่ม column แทนสร้างตารางใหม่คู่ขนาน ถ้า field ที่
> ต้องการ (handoff/clarification count) ใกล้เคียงกับที่ track อยู่แล้ว
>
> ✅ **Implemented แบบ live-window metrics** — ไม่สร้าง daily snapshot ซ้ำ แต่
> `getAiFailureSummary()` (ดู 5.1) คำนวณ `handoffCount` สดจาก `bms_conversation_notes` (นับ note ที่ turn
> budget enforcer เขียนตอน force handoff — ดู 3.4) และ `errorCalls`/`totalToolCalls` จาก audit log ในช่วง
> วันที่ระบุ (default 7 วัน) และแสดงบน Dashboard. Usage event เก็บ intent, history fetch/send count,
> compression flag/summary chars, business type และ cache-token breakdown โดยไม่เก็บ prompt/PII
>
> ✅ **Extended (7.31)** — `getAiQualityMetrics()` คำนวณ success/handoff/unresolved rate และกราฟรายวัน
> สดจาก AI message signal โดยใช้ AI turn เป็น denominator (ไม่ใช่ conversation ที่อยู่ยาวข้ามหลายเรื่อง)
> พร้อมจำนวน pending/reviewed/human-fail จาก review queue; ไม่สร้าง aggregate snapshot ซ้ำ

---

# โครงสร้างข้อมูลที่ควรมี (v2)

## 1) Tenant Summary — `tenant_ai_summary`

ใช้ `bms_store_profile` เป็น source of truth โดยตรง ไม่สร้าง summary table ซ้ำ: business type /
language / ordering style / required fields / short-reply policy / handoff policy

## 2) Retrieval Metadata — `tenant_ai_retrieval_terms`

ใช้ `bms_products.keywords[]`, categories และ `bms_ai_synonym_candidates` ที่ต้อง human review

## 3) Refresh Job — `tenant_ai_refresh_job`

ไม่ต้องมี refresh job สำหรับ summary เพราะ derive จาก config/catalog สด; synonym candidates เก็บ
incrementally ตอน search miss และ failure metrics คำนวณจาก audit window

## 4) Live State (Conversation State)

current product / size / qty / confirmation / last asked field / recent intent อยู่ใน
`bms_conversations.ai_state`; failed turns อยู่ใน `ai_consecutive_askbacks`

## 5) ตารางใหม่ที่ "เสนอ" ในเอกสาร v2

| ตาราง | ใช้สำหรับ | คำแนะนำ |
|---|---|---|
| `ai_message_log` | Idempotency check | grep เช็ค dedup ต่อ channel ก่อนสร้างซ้ำ |
| `ai_failure_log` | Failure logger | reuse `bms_audit_log` (`ai.tool_call`) แทน |
| `ai_synonym_candidates` | Synonym discovery | ทำได้ ไม่ชนของเดิม แต่ priority ต่ำ |
| `ai_tenant_metrics_daily` | Per-tenant accuracy metrics | พิจารณาต่อยอด `bms_ai_usage_monthly` แทน |

---

# ความเสี่ยงถ้าทำผิดวิธี

## ถ้าโหลดทุกอย่างทุกครั้ง

prompt ใหญ่เกิน / ช้าลง / token แพง / AI สับสน / context noise สูง

## ถ้าไม่แยก tenant context

ร้านเสื้อผ้ากับร้านกาแฟใช้ logic ปนกัน / AI ถาม field ผิด / fallback ไม่ตรงร้าน / order flow มั่ว

## ถ้าให้ AI overwrite summary อัตโนมัติทั้งหมด

summary อาจเพี้ยนทั้งร้าน / behavior ของระบบอาจ drift / ควรมี version / validation / merge strategy

---

# วิธีที่แนะนำในการอัปเดต Summary

AI generate proposal summary → backend validate → merge เฉพาะ field ที่ปลอดภัย → เก็บ version →
ถ้าเปลี่ยนเยอะ อาจให้ admin review

---

# Cadence ที่แนะนำ (v2)

**ครั้งแรก**: generate initial tenant summary + สร้าง normalization map เบื้องต้น

**ทุก request**: load summary เดิม → load conversation state (พร้อม failedTurns, lastAskedField) →
retrieve เฉพาะข้อมูลที่เกี่ยว → run pre-AI processing → build prompt → validate AI output

**ทุกสัปดาห์**: refresh synonym / retrieval metadata / failure patterns → merge approved synonym
candidates → review ร้านที่มี handoff rate สูง

**เมื่อ catalog เปลี่ยนใหญ่**: regenerate summary บางส่วน + rebuild normalization map

**เมื่อ handoff rate > 20%**: auto trigger summary refresh + alert dev team

---

# สถานะจริงเทียบกับโค้ด — สิ่งที่ต้องอ่านก่อนเริ่ม implement

เอกสาร v1/v2 ด้านบนเขียนในระดับ "ควรมีอะไร" แต่ยังไม่ได้เทียบกับ implementation จริงใน
`apps/web/lib/bms/*` — ส่วนนี้คือผลตรวจโค้ดจริง (2026-07) ที่ต้องอ่านก่อนตัดสินใจ scope งานถัดไป

## 1) Architecture mismatch ที่ต้องตัดสินใจ

Diagram/Layer 2-3 ของ v2 สมมติว่า AI ตอบ **JSON เดียวจบ** (`intent/confidence/slots/action/
toolCalls`) แต่ระบบจริงใช้ **Claude native tool-use** ([`lib/bms/tools/runtime.ts`](../apps/web/lib/bms/tools/runtime.ts))
— วน `tool_use` block สูงสุด 5 รอบ ทูลแต่ละตัวมี JSON schema ของตัวเอง + permission gate +
propose-only flow สำหรับ sensitive action ครบแล้ว

**ตัดสินใจแล้ว**: ไม่รื้อ native tool-use ไปทำ single-shot JSON protocol ตามเอกสาร — ของเดิมทำงานได้ดี
กว่าและปลอดภัยกว่าอยู่แล้ว ให้แปลงเป้าหมายแต่ละ layer ให้เข้ากับ native tool-use แทน (ดูหมายเหตุใน
แต่ละ layer ด้านบน)

## 2) ช่องโหว่เดิมที่ปิดแล้ว — conversation history/state

ทุก webhook (`app/api/bms/{line,facebook,instagram,tiktok,shopee,lazada,web}/webhook/[tenantId]/route.ts`)
เรียก `runPipeline(text, channel, tenantId, userId)` ด้วยข้อความปัจจุบันข้อความเดียว แล้วใน
[`pipeline.ts:183`](../apps/web/lib/bms/pipeline.ts) ส่งเข้า `runToolLoop()` เป็น
`messages: [{ role: "user", content: message }]` — **ไม่มี turn ก่อนหน้าเลย**

ก่อน P0 Claude tool-loop stateless ทุก request — ที่มาตัวจริงของปัญหาที่บันทึกไว้แล้วใน
`CLAUDE.local.md` § AI tool-calling ("Haiku conservative เรื่องปิดการขาย, ถามย้ำก่อน create_order")
ข้อมูลบทสนทนามีอยู่แล้วจริงใน `bms_messages` (`listMessages()` ที่ [`lib/bms/inbox.ts:390`](../apps/web/lib/bms/inbox.ts))
— **แค่ไม่เคยถูกดึงกลับมาป้อน prompt** ทุก layer ที่พึ่ง "conversation state" (short reply resolver,
turn budget และ slot-filling state machine เคยไม่มีฐานให้ยืนก่อนแก้ P0/7.30

> ✅ **แก้แล้ว (2026-07)** — `getRecentAiHistory()`/`resolveConversationId()` ใน `lib/bms/inbox.ts` +
> wiring ใน `pipeline.ts` (ดูแถว P0 ในตารางด้านล่าง) ตอนนี้ path หลักเห็น turn ก่อนหน้าแล้วจริง

## 3) Priority ที่ปรับใหม่ตามสภาพโค้ดจริง

| สถานะ | ลำดับ | งาน | เหตุผล | จุดที่แก้ |
|---|---|---|---|---|
| ✅ | **P-0.5** | แก้ `listProducts()` ให้ match `keywords[]` ด้วย | บั๊กจริงที่ยืนยันจากโค้ด: alias ที่ร้านตั้งไว้ใน `bms_products.keywords[]` ใช้ได้เฉพาะ path fallback (`resolveProduct()` ใน `stock.ts`) แต่ path หลัก (`search_products`/`get_product` ผ่าน `listProducts()`) ไม่ query column นี้เลย ทั้งที่ SELECT มาอยู่แล้ว ทำง่ายสุด ไม่มี dependency กับงานอื่น ควรทำก่อน P0 | `lib/bms/products.ts` — WHERE clause ของ `listProducts()` เพิ่ม `EXISTS (SELECT 1 FROM unnest(keywords) ...)` แล้ว |
| ✅ | **P0** | Conversation history + durable state | multi-turn ต้องไม่หายเมื่อ compress | `getRecentAiHistory()` + `bms_conversations.ai_state`; fetch 48, ส่ง 8 ล่าสุดเมื่อ compressed |
| ✅ | **P1** | Unverified Fact Detector | ช่องโหว่จริงตอนนี้: ตอบราคา/สต็อกได้โดยไม่มี tool call verify เลย ไม่มีใครดักอยู่ | `pipeline.ts` (`hasUnverifiedFacts()`) เช็ค `loop.reply` เทียบ `loop.trace` ก่อน return |
| ✅ | **P1** | Turn/Handoff counter ต่อ conversation | ตรงกับปัญหาที่บันทึกไว้แล้วว่า Haiku ถามย้ำ | migration `7.28` + threshold ต่อ tenant ใน `bms_store_profile` |
| ✅* | **P2** | Entity/alias injection เข้า system prompt | `search_products` ยัง match ตรง ไม่มี alias เลย | **เปลี่ยนวิธี**: ไม่ได้สร้าง migration alias ใหม่ตามแผนเดิม — ใช้ `listCategories()` ที่มีอยู่แล้ว (จัดการได้ที่ `/admin/products`) ฝังเข้า `buildCustomerSystem()` แทน |
| ✅ | **P2** | Slot-filling state ใน prompt (2.2) | รักษา state ข้าม compression | required fields ต่อ tenant + `ai_state` + volatile order-memory block |
| ✅ | **P3** | Failure tracking + admin visibility | มี audit log อยู่แล้ว ไม่ต้องสร้างตารางใหม่ 3-4 ตัว | `getAiFailureSummary()` ใน `lib/bms/aiUsage.ts` + GraphQL `bmsAiFailureSummary` + การ์ด AI health บน `/admin/dashboard` |
| ✅ | — | Short Reply Resolver (1.3) | blocker เดิม (ไม่มี conversation state) หมดไปแล้วหลัง P0 | `pipeline.ts` ขยาย reply สั้น เช่น `XL`, `2`, `พร้อมเพย์`, `เอาเลย` ให้ผูกกับคำถามก่อนหน้าก่อนเข้า intent/tool loop |
| ✅ | — | Conversation Compressor (4.1) | history ยาวเกิน 20 ข้อความ ถูกตัดทิ้งเฉยๆ ไม่บีบอัด | `pipeline.ts` โหลด history ได้ยาวขึ้น, เก็บ recent turns ไว้เต็ม, และสรุปส่วนเก่าเป็น `volatileSystem` block |
| ✅ | — | Few-shot examples ต่อ business type (2.3) | prompt ต้องตรงประเภทร้าน | migration `7.30` + Settings + ตัวอย่าง 2 กรณีต่อ business type |
| ✅* | — | Retrieval Re-Ranker (4.2) | ไม่มี semantic score ให้ rank | **เปลี่ยนวิธี**: ไม่ทำ semantic ranker เต็มรูปแบบ แต่เพิ่ม heuristic ranking ใน `listProducts()` จาก exact/prefix/category/brand/keyword match |
| ✅ | — | Intent pre-classifier + webhook idempotency | ลด model variance และ duplicate writes | `classifyCustomerIntent()` + `bms_inbound_events` ทุก webhook |
| ✅ | — | Synonym Discovery (5.2) | เพิ่ม recall โดยไม่ให้ AI แก้ catalog เอง | candidate table + Products review UI + approve ผ่าน `upsertProduct()` |
| ไม่แนะนำ | — | Structured JSON output schema แบบ v2, `ai_failure_log`/`ai_tenant_metrics_daily` | ขัดกับ native tool-use หรือซ้ำข้อมูลเดิม | ใช้ native schemas + live-window metrics |

`✅*` = implement เสร็จแล้วแต่วิธีต่างจากที่เอกสารเสนอเดิม (ดูรายละเอียดในหัวข้อ 1.2 ด้านบน)

## 4) สถานะล่าสุด (หลัง migration 7.30, 2026-07)

Layer ที่เหมาะกับ native tool-use ในเอกสารนี้ implement ครบแล้ว: tenant policy, durable state,
retrieval/live verification, intent preprocessing, short replies, inbound idempotency, slot memory,
few-shot, relevant-fact guard, tenant handoff threshold, compressor, heuristic rerank, failure
dashboard, synonym review และ live-window metrics

รายการที่ตั้งใจไม่ทำตามตัวอย่างเดิมคือ single-shot JSON protocol, semantic/vector ranker และตาราง
daily/failure ซ้ำ เพราะ architecture ปัจจุบันใช้ native tool schemas, heuristic catalog rank และ derive
metrics จาก usage/audit source of truth

---

# ข้อสรุปสุดท้าย (v2)

แนวทางที่เหมาะที่สุดคือ:

- ใช้ AI สรุป "บริบทร้าน" แบบสั้น
- ใช้ retrieval ดึงเฉพาะข้อมูลที่เกี่ยวและ heuristic re-rank
- ใช้ live tools ตรวจ fact สำคัญ (มีอยู่แล้วในระบบจริง — ส่วนที่ทำได้ดีที่สุด)
- ไม่โหลดสินค้าทั้งร้านทุก request
- ไม่ให้ AI จำเองหรือเดาเองทั้งหมด
- ✅ **แก้ keywords search gap แล้ว (P-0.5)** — `listProducts()` match `keywords[]` แล้ว
- ✅ **เพิ่ม conversation history เข้า tool loop แล้ว (P0)** — `getRecentAiHistory()`/
  `resolveConversationId()` ใน `inbox.ts`
- **บังคับ structured output แบบ native tool-use เดิม** (ทำอยู่แล้ว ไม่ต้องรื้อ)
- ✅ **เพิ่ม unverified-fact guard บน trace ที่มีอยู่แล้วสำเร็จ (P1)** และ ✅ **turn/handoff counter (P1)**
  แทน confidence gate ที่ native tool-use ไม่มีให้เช็ค
- ✅ **failure signal + Dashboard**, synonym review และ usage diagnostics พร้อมใช้งาน

ประโยคสรุป 1 บรรทัด:

> ใช้ `tenant policy + durable state + compressed history + native tool schemas + relevant-fact guard
> + backend verification + human-reviewed learning loop`; วัด cache/compression จาก usage event
> metadata แทนการคาดเดาจาก prompt size
