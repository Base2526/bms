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
  "businessType": "clothing",
  "language": "th",
  "orderingStyle": "catalog_variant",
  "requiredFields": ["product", "color", "size", "qty"],
  "interpretShortReplyFromContext": true,
  "handoffAfterFailedTurns": 2
}
```

> ⚠️ **สถานะจริง**: field เหล่านี้ยังไม่มีตารางเก็บจริงในระบบ ของจริงมีแค่ `bms_store_profile`
> (hours/address/policies/payment/shipping — ดู migration `6.9`/`7.17`) ซึ่งไม่มี `orderingStyle`,
> `requiredFields`, `handoffAfterFailedTurns` เลย ถ้าจะทำจริงต้อง migration ใหม่ (ดูหัวข้อ
> "สถานะจริงเทียบกับโค้ด" ท้ายเอกสาร)

---

## 2) Conversation State

ควรโหลดทุก request เช่นกัน

ตัวอย่าง:

- ตอนนี้กำลังคุยสินค้าตัวไหน
- draft order ตอนนี้มีอะไรแล้ว
- field อะไรยังขาด
- ล่าสุด AI ถามอะไรไว้

> ⚠️ **สถานะจริง**: **ยังไม่มีเลย** — นี่คือช่องว่างที่ใหญ่ที่สุดในระบบตอนนี้ (ดูรายละเอียดท้ายเอกสาร)

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

> **สถานะจริง**: มีของใกล้เคียงอยู่แล้ว — `lib/bms/nlu.ts` (`understand()`) เป็น rule-based classifier
> คล้ายกันเป๊ะ (`CHECK_STOCK`/`CONFIRM_ORDER`/`GREETING`/`UNKNOWN`) แต่ **ใช้เป็น fallback path เท่านั้น**
> (เมื่อไม่มี AI credentials) ไม่ได้ใช้เพื่อเลือก prompt template ให้ AI path หลัก ถ้าจะเอา
> pre-classifier มาช่วยเลือก system prompt จริง ต้องต่อยอด `nlu.ts` ให้ผลลัพธ์ไหลเข้า
> `runPipeline()`/`pipeline.ts:180` ก่อนเรียก `runToolLoop()` ไม่ใช่สร้างไฟล์ใหม่ซ้ำ

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

> **สถานะจริง**: `tools/catalog.ts` (`search_products` ผ่าน `listProducts()`) ยังไม่มี alias/fuzzy
> matching เลย — เป็น match ตรงชื่อ/SKU เท่านั้น แนวทางที่เข้ากับ native tool-use ของระบบนี้ได้ดีกว่าเขียน
> regex normalizer แยกทั้ง layer คือ **ฝัง alias table เข้า system prompt ต่อ tenant**
> (`CUSTOMER_SYSTEM` ใน `pipeline.ts`) ให้ Claude ใช้ตอนเรียก `search_products` เอง — ไม่ต้องมี
> pre-processing step แยกก่อนเรียก AI ต้องมี migration ใหม่เก็บ alias ต่อ tenant (ยังไม่มีตารางนี้)
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

> **สถานะจริง**: ต้องพึ่ง `conversationState.lastAskedField` ซึ่ง**ยังไม่มีอยู่จริง** (ดู Layer เดียวกันนี้
> ในหัวข้อ Conversation State ด้านบน) — ทำก่อนไม่ได้จนกว่าจะมี conversation state layer ก่อน ดูลำดับ
> priority ท้ายเอกสาร
>
> ❌ **ยังไม่ implement**: หลังจาก P0 (conversation history) เสร็จแล้ว เงื่อนไข blocker เดิมหมดไปแล้ว
> เทคนิคนี้ทำได้จริงตอนนี้ — แต่ยังไม่ได้ implement เป็นทางเลือกที่เหลืออยู่ (ดูส่วน "สถานะล่าสุด" ท้าย
> เอกสาร) เพราะ native tool-use ให้ Claude เห็น history ทั้งหมดอยู่แล้วและตีความเองได้ในระดับที่ยอมรับได้
> ROI ของการเขียน resolver แยกจึงต่ำกว่ารายการอื่นที่ implement ไปแล้ว

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

---

# Layer 2 — Prompt Engineering (ใหม่)

## 2.1) Structured Output Schema

บังคับให้ AI ตอบเป็น JSON เสมอ ห้ามตอบ free-form text — schema ที่เสนอ:

```json
{
  "intent": "ordering",
  "confidence": 0.92,
  "slots": { "product": "Classic Tee", "color": "black", "size": null, "qty": 2 },
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

> **สถานะจริง**: idea นี้ **ทำได้ทันทีและควรทำ** โดยไม่ต้องมี structured output schema ข้างต้นเลย —
> เพราะเป็นแค่ข้อความเพิ่มเข้า system/user prompt (`CUSTOMER_SYSTEM` ใน `pipeline.ts:39`) แต่ต้องมี
> conversation state (Layer ที่ยังไม่มี) มาก่อนถึงจะรู้ว่า field ไหน "confirmed" แล้วบ้าง
>
> ✅ **Implemented (รูปแบบย่อ)**: ไม่ได้ทำ "slots ที่เก็บได้แล้ว" เป็น block คำนวณสดต่อ turn ตามตัวอย่าง
> ข้างบน (ต้องมี explicit slot-tracking ที่ระบบนี้ไม่มี เพราะใช้ native tool-use ไม่ใช่ JSON slots) — แต่
> เพิ่มกฎ "ถามทีละ 1 field เท่านั้น ห้ามถามหลาย field พร้อมกัน" เป็นบรรทัดตายตัวใน `buildCustomerSystem()`
> (`pipeline.ts`) แทน โดยอาศัย conversation history (P0) ที่ Claude เห็นแล้วให้ Claude เองเป็นคนดูว่า field
> ไหน confirmed แล้วจากบทสนทนาที่ผ่านมา — ได้ผลลัพธ์ใกล้เคียงกันโดยไม่ต้องสร้างระบบ track state แยก

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

> **สถานะจริง**: ทำได้ทันที — เพิ่มเข้า `CUSTOMER_SYSTEM` ตรงๆ แต่ระบบยังไม่มี field `businessType`
> ต่อ tenant เลย (ไม่มีใน `bms_store_profile`) ดังนั้นตอนนี้ทำได้แค่ few-shot กลาง (ทุกร้านเหมือนกัน)
> ถ้าจะแยกตาม business type ต้องเพิ่ม field/migration ก่อน
>
> ❌ **ยังไม่ implement** — ยังไม่มี field `businessType` และยังไม่ได้เพิ่ม few-shot examples เข้า prompt
> เลย (ทำสิ่งที่ใกล้เคียงกว่าไปแล้วคือฝัง category list จริงของร้าน — ดู 1.2 — แต่ไม่ใช่ few-shot ตัวอย่าง
> บทสนทนา) เหลือเป็น backlog

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

> **สถานะจริง**: ตรงกับปัญหาที่บันทึกไว้แล้วใน `CLAUDE.local.md` § AI tool-calling ("Haiku มัก
> conservative เรื่องปิดการขาย, ถามย้ำก่อน create_order") — แต่ field `handoffAfterFailedTurns` ยังไม่มี
> ที่เก็บจริง (ไม่มีใน `bms_store_profile`) และไม่มี field `action`/`missingSlots` เพราะไม่ได้ใช้
> structured output ฉบับนี้ วิธีที่เข้ากับระบบจริง: นับจาก **ai.tool_call audit** — ถ้า N ข้อความติดกัน
> จาก `(channel, customerRef)` เดียวกันไม่มี tool call ที่เป็น write action (`create_order`,
> `submit_payment`) สำเร็จเลย → เพิ่ม counter ผูกกับ `bms_conversations` (มี `assigned_to_user_id`/
> status column อยู่แล้ว) แล้ว force handoff เมื่อถึง threshold
>
> ✅ **Implemented** — migration
> [`7.28__bms_conversations_ai_turns.sql`](../db/migrations/7.28__bms_conversations_ai_turns.sql) เพิ่ม
> `bms_conversations.ai_consecutive_askbacks` · `resolveConversationId()`/`bumpAiTurnCounter()` ใน
> [`lib/bms/inbox.ts`](../apps/web/lib/bms/inbox.ts) · logic ใน `pipeline.ts`: ไม่มี tool ใน
> `CUSTOMER_PROGRESS_TOOLS` ที่ ok=true ติดกันครบ
> `TURN_BUDGET_MAX_FAILED = 3` ครั้ง → override reply เป็นข้อความ handoff + เขียน internal note
> (`addNote(..., author: "AI")`, staff เห็นในแท็บโน้ตของ Inbox ที่มีอยู่แล้ว) แล้ว reset counter กันแจ้งซ้ำ
> ทุกข้อความถัดไป — threshold เป็น constant กลาง ยังไม่มี fieldต่อ tenant ให้ตั้งเอง (ตรงกับที่หมายเหตุ
> ไว้ข้างบนว่ายังไม่มีที่เก็บจริง)
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

> **สถานะจริง**: **ยังทำเรื่องนี้ไม่ได้เลย เพราะยังไม่มี conversation history เข้า AI ตั้งแต่ต้น**
> (ดูหัวข้อถัดไป) — layer นี้เป็นการ "บีบอัด history ที่ยาวเกิน" แต่ตอนนี้ history = 0 เสมอ ต้องทำ
> conversation-state layer (P0 ด้านล่าง) ให้เสร็จก่อน ถึงจะมี "ของที่ยาวเกิน" ให้บีบอัด
>
> ❌ **ยังไม่ implement** — P0 (conversation history) เสร็จแล้ว (`getRecentAiHistory()` ใน `inbox.ts`)
> แต่ตอนนี้แค่ "จำกัดจำนวน" (`HISTORY_MAX_MESSAGES = 20` ข้อความล่าสุด, ตัดทิ้งเฉยๆ ไม่บีบอัด) ยังไม่มี
> rolling summary ของ turns เก่ากว่านั้น — ตอนนี้เป็น backlog ที่ "ของที่ยาวเกิน" มีจริงแล้ว รอ implement
> จริง ถ้าบทสนทนายาวเกิน 20 ข้อความ ส่วนเก่าจะหายไปเฉยๆ ไม่ถูกสรุปเก็บไว้

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

> **สถานะจริง**: `search_products` (`tools/catalog.ts` → `listProducts()`) ยังเป็น match ตรงชื่อ/SKU
> เท่านั้น ไม่มี semantic score ให้ re-rank ด้วยซ้ำ — ทำก่อนอันดับต่ำ เพราะประโยชน์ต่ำถ้าจำนวนสินค้า
> ต่อร้านไม่เยอะมาก (ส่วนใหญ่เป็นร้านเดี่ยว ไม่ใช่ marketplace หมื่น SKU)
>
> ❌ **ยังไม่ implement** — ยังคง priority ต่ำเท่าเดิม; P-0.5 (keywords match) ช่วยลดความจำเป็นของ
> re-ranker ไปมากแล้ว เพราะ match เจอมากขึ้นตั้งแต่ต้นโดยไม่ต้อง rank

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
> ⚠️ **Implemented บางส่วน** — `getAiFailureSummary(tenantId, days)` ใน
> [`lib/bms/aiUsage.ts`](../apps/web/lib/bms/aiUsage.ts) query `bms_audit_log` (action=`ai.tool_call`,
> outcome error/denied) grouped by tool ตามที่แนะนำไว้ ไม่มีตารางใหม่เลย — **แต่ยังไม่มี GraphQL
> query/permission/admin UI มาเรียกใช้** เป็น service function พร้อมต่อยอด ไม่ใช่ dead code (ยังไม่มีใคร
> import ใช้จริง) ต้องต่อ GraphQL + หน้า admin ก่อนถึงจะเห็นผลจริงในมือ staff

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

> **สถานะจริง**: idea นี้เป็นของใหม่จริง ไม่ชนกับตารางเดิม — แต่ priority ต่ำ (long-term improvement)
> ควรทำหลัง entity normalizer (1.2) มีที่เก็บ alias จริงแล้ว เพราะ candidate ที่ approve แล้วต้องไปลง
> ตารางเดียวกับ alias ไม่ใช่คนละที่
>
> ❌ **ยังไม่ implement** — ยังคงเป็น backlog ต่ำสุด เนื่องจาก 1.2 เลือกใช้ `keywords[]`/category ที่มีอยู่
> แล้วแทนการสร้างตาราง alias ใหม่ (ดู 1.2) ทำให้ "ที่เก็บ" สำหรับ synonym ที่ approve แล้วยังไม่มีอยู่ดี —
> ถ้าจะทำ synonym discovery จริง ต้องตัดสินใจก่อนว่าจะ approve เข้า `bms_products.keywords` ของสินค้านั้น
> ตรงๆ หรือสร้างตารางแยก

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
> ⚠️ **Implemented บางส่วน** — ไม่ได้สร้าง `ai_tenant_metrics_daily` (ไม่มี daily snapshot table) แต่
> `getAiFailureSummary()` (ดู 5.1) คำนวณ `handoffCount` สดจาก `bms_conversation_notes` (นับ note ที่ turn
> budget enforcer เขียนตอน force handoff — ดู 3.4) และ `errorCalls`/`totalToolCalls` จาก audit log ในช่วง
> วันที่ระบุ (default 7 วัน) แทน "clarification rate"/"intent accuracy" เต็มรูปแบบ — ยังไม่มี alert rule
> อัตโนมัติ ("handoff rate > 20% → auto trigger refresh") และยังไม่มี GraphQL/UI เหมือน 5.1

---

# โครงสร้างข้อมูลที่ควรมี (v2)

## 1) Tenant Summary — `tenant_ai_summary`

business type / language / ordering style / required fields / optional fields / fallback policy /
handoff policy — **ยังไม่มีตารางนี้จริง** (ใกล้เคียงสุดคือ `bms_store_profile` แต่ field คนละชุด)

## 2) Retrieval Metadata — `tenant_ai_retrieval_terms`

aliases / category keywords / common phrases / modifier terms / typo patterns /
**normalization map** — **ยังไม่มีตารางนี้จริง**

## 3) Refresh Job — `tenant_ai_refresh_job`

weekly refresh / rebuild retrieval metadata / summarize catalog changes / detect new patterns /
**auto health trigger** — **ยังไม่มี** (มี pattern cron ใกล้เคียงอยู่แล้วที่
`.github/workflows/daily-log-triage.yml` และ `/api/bms/channels/check-health` — ใช้เป็นแม่แบบได้)

## 4) Live State (Conversation State)

current product / current draft order / missing fields / last asked question / recent intent /
**failedTurns** / **lastAskedField** / **rollingSummary** — **ยังไม่มีเลยแม้แต่ field เดียว** (ดูหัวข้อ
ถัดไป — นี่คือ P0)

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

## 2) ช่องโหว่ใหญ่ที่สุด (ยืนยันจากโค้ด) — ไม่มี conversation history เข้า AI เลย

ทุก webhook (`app/api/bms/{line,facebook,instagram,tiktok,shopee,lazada,web}/webhook/[tenantId]/route.ts`)
เรียก `runPipeline(text, channel, tenantId, userId)` ด้วยข้อความปัจจุบันข้อความเดียว แล้วใน
[`pipeline.ts:183`](../apps/web/lib/bms/pipeline.ts) ส่งเข้า `runToolLoop()` เป็น
`messages: [{ role: "user", content: message }]` — **ไม่มี turn ก่อนหน้าเลย**

หมายความว่า Claude tool-loop stateless ทุก request จริงๆ — ที่มาตัวจริงของปัญหาที่บันทึกไว้แล้วใน
`CLAUDE.local.md` § AI tool-calling ("Haiku conservative เรื่องปิดการขาย, ถามย้ำก่อน create_order")
ข้อมูลบทสนทนามีอยู่แล้วจริงใน `bms_messages` (`listMessages()` ที่ [`lib/bms/inbox.ts:390`](../apps/web/lib/bms/inbox.ts))
— **แค่ไม่เคยถูกดึงกลับมาป้อน prompt** ทุก layer ที่พึ่ง "conversation state" (short reply resolver,
turn budget, slot-filling state machine) ยังไม่มีฐานให้ยืนจนกว่าจะแก้จุดนี้ก่อน

> ✅ **แก้แล้ว (2026-07)** — `getRecentAiHistory()`/`resolveConversationId()` ใน `lib/bms/inbox.ts` +
> wiring ใน `pipeline.ts` (ดูแถว P0 ในตารางด้านล่าง) ตอนนี้ path หลักเห็น turn ก่อนหน้าแล้วจริง

## 3) Priority ที่ปรับใหม่ตามสภาพโค้ดจริง

| สถานะ | ลำดับ | งาน | เหตุผล | จุดที่แก้ |
|---|---|---|---|---|
| ✅ | **P-0.5** | แก้ `listProducts()` ให้ match `keywords[]` ด้วย | บั๊กจริงที่ยืนยันจากโค้ด: alias ที่ร้านตั้งไว้ใน `bms_products.keywords[]` ใช้ได้เฉพาะ path fallback (`resolveProduct()` ใน `stock.ts`) แต่ path หลัก (`search_products`/`get_product` ผ่าน `listProducts()`) ไม่ query column นี้เลย ทั้งที่ SELECT มาอยู่แล้ว ทำง่ายสุด ไม่มี dependency กับงานอื่น ควรทำก่อน P0 | `lib/bms/products.ts` — WHERE clause ของ `listProducts()` เพิ่ม `EXISTS (SELECT 1 FROM unnest(keywords) ...)` แล้ว |
| ✅ | **P0** | ป้อน conversation history เข้า tool loop | ทุก layer อื่นพึ่ง state นี้ทั้งหมด ตอนนี้ multi-turn slot-filling แทบไม่ทำงานจริง | `lib/bms/inbox.ts` (`resolveConversationId`/`getRecentAiHistory`) + `pipeline.ts` (ต่อท้าย `opts.messages` ก่อนเรียก `runToolLoop()`) — จำกัด 20 ข้อความล่าสุด |
| ✅ | **P1** | Unverified Fact Detector | ช่องโหว่จริงตอนนี้: ตอบราคา/สต็อกได้โดยไม่มี tool call verify เลย ไม่มีใครดักอยู่ | `pipeline.ts` (`hasUnverifiedFacts()`) เช็ค `loop.reply` เทียบ `loop.trace` ก่อน return |
| ✅ | **P1** | Turn/Handoff counter ต่อ conversation | ตรงกับปัญหาที่บันทึกไว้แล้วว่า Haiku ถามย้ำ | migration `7.28` (`bms_conversations.ai_consecutive_askbacks`) + `bumpAiTurnCounter()`/`addNote()` ใน `inbox.ts` + logic ใน `pipeline.ts` (threshold = 3, constant กลาง) |
| ✅* | **P2** | Entity/alias injection เข้า system prompt | `search_products` ยัง match ตรง ไม่มี alias เลย | **เปลี่ยนวิธี**: ไม่ได้สร้าง migration alias ใหม่ตามแผนเดิม — ใช้ `listCategories()` ที่มีอยู่แล้ว (จัดการได้ที่ `/admin/products`) ฝังเข้า `buildCustomerSystem()` แทน |
| ✅ | **P2** | Slot-filling state ใน prompt (2.2) | ทำได้เบาแค่แต่งข้อความ prompt เพิ่ม | **รูปแบบย่อ**: เพิ่มกฎ "ถามทีละ 1 field" คงที่ใน `buildCustomerSystem()` แทน slot-state block ที่คำนวณสด (ไม่มี explicit slot tracking ในระบบนี้) |
| ⚠️ | **P3** | Failure/synonym tracking | มี audit log อยู่แล้ว ไม่ต้องสร้างตารางใหม่ 3-4 ตัว | `getAiFailureSummary()` ใน `lib/bms/aiUsage.ts` — query `bms_audit_log`+`bms_conversation_notes` สำเร็จ แต่**ยังไม่มี GraphQL/permission/admin UI wiring** |
| ❌ | — | Short Reply Resolver (1.3) | blocker เดิม (ไม่มี conversation state) หมดไปแล้วหลัง P0 แต่ยังไม่ implement | ยังไม่ทำ — ROI ต่ำกว่ารายการอื่นเพราะ native tool-use ให้ Claude เห็น history ทั้งหมดแล้วตีความเองได้ |
| ❌ | — | Conversation Compressor (4.1) | history ยาวเกิน 20 ข้อความ ถูกตัดทิ้งเฉยๆ ไม่บีบอัด | ยังไม่ทำ — relevant มากขึ้นตอนนี้ที่ P0 เสร็จแล้ว |
| ❌ | — | Few-shot examples ต่อ business type (2.3) | ไม่มี field `businessType` ต่อ tenant | ยังไม่ทำ — ต้องมี migration ก่อน |
| ❌ | — | Retrieval Re-Ranker (4.2) | ไม่มี semantic score ให้ rank | ยังไม่ทำ — priority ต่ำลงอีกหลัง P-0.5 |
| ❌ | — | Synonym Discovery (5.2) | ยังไม่มี "ที่เก็บ" ที่ชัดเจนหลังเปลี่ยนแผน 1.2 | ยังไม่ทำ — ต้องตัดสินใจ approve เข้า `keywords[]` ตรงๆ หรือตารางแยกก่อน |
| ไม่แนะนำ | — | Structured JSON output schema แบบ v2, ตารางใหม่ `ai_message_log`/`ai_failure_log`/`ai_tenant_metrics_daily` | ขัดกับ native tool-use ที่มีอยู่ / ซ้ำซ้อนกับตารางเดิม | — |

`✅*` = implement เสร็จแล้วแต่วิธีต่างจากที่เอกสารเสนอเดิม (ดูรายละเอียดในหัวข้อ 1.2 ด้านบน)

## 4) สถานะล่าสุด (หลัง implement #1–#7, 2026-07) — ตอบคำถาม "ขาดอะไรบ้าง"

**เสร็จแล้ว**: P-0.5, P0, P1×2 (unverified fact detector + turn/handoff counter), P2×2 (category
injection แทน alias table + single-field prompt rule) — build ผ่าน `tsc --noEmit` สะอาด **ยังไม่ได้
ทดสอบ end-to-end จริงในเบราว์เซอร์/docker** (เครื่องนี้ไม่มี DB รันอยู่ตอน implement) ต้อง apply migration
`7.28` ก่อนใช้งานจริง

**ยังไม่ implement (เรียงตาม impact ที่เหลือ)**:

1. **P3 GraphQL/UI wiring** — `getAiFailureSummary()` มีแล้วแต่ไม่มีใครเรียกใช้ (ไม่ผูก permission/หน้า
   admin) — งานที่เหลือคือ GraphQL query + การ์ดในหน้า `/admin/dashboard` หรือหน้าใหม่
2. **Conversation Compressor (4.1)** — history ที่ยาวเกิน 20 ข้อความถูกตัดทิ้งเฉยๆ ไม่มี rolling summary
   (relevant มากขึ้นตอนนี้ที่ P0 เสร็จแล้ว)
3. **Short Reply Resolver (1.3)** — blocker เดิมหมดไปแล้ว แต่ยังไม่ implement (priority ต่ำ เพราะ native
   tool-use จัดการกรณีนี้ได้เองในระดับหนึ่งผ่าน conversation history แล้ว)
4. **Few-shot per business type (2.3)** — ต้องมี field `businessType` ก่อน (migration ใหม่)
5. **Retrieval Re-Ranker (4.2)** — priority ต่ำสุด ยังไม่จำเป็นถ้าจำนวนสินค้า/ร้านไม่เยอะมาก
6. **Synonym Discovery (5.2)** — รอการตัดสินใจเรื่อง "ที่เก็บ" alias ที่ approve แล้ว
7. **Intent Pre-Classifier (1.1) แบบเต็มรูปแบบ**, **Idempotency Check (1.4)** — ยังคงเป็น backlog เดิม
   ไม่มีอะไรเปลี่ยนจากรอบก่อน (ดูหมายเหตุในแต่ละหัวข้อ)

---

# ข้อสรุปสุดท้าย (v2)

แนวทางที่เหมาะที่สุดคือ:

- ใช้ AI สรุป "บริบทร้าน" แบบสั้น
- ใช้ retrieval ดึงเฉพาะข้อมูลที่เกี่ยว (re-ranked — ยังไม่ทำ, priority ต่ำ)
- ใช้ live tools ตรวจ fact สำคัญ (มีอยู่แล้วในระบบจริง — ส่วนที่ทำได้ดีที่สุด)
- ไม่โหลดสินค้าทั้งร้านทุก request
- ไม่ให้ AI จำเองหรือเดาเองทั้งหมด
- ✅ **แก้ keywords search gap แล้ว (P-0.5)** — `listProducts()` match `keywords[]` แล้ว
- ✅ **เพิ่ม conversation history เข้า tool loop แล้ว (P0)** — `getRecentAiHistory()`/
  `resolveConversationId()` ใน `inbox.ts`
- **บังคับ structured output แบบ native tool-use เดิม** (ทำอยู่แล้ว ไม่ต้องรื้อ)
- ✅ **เพิ่ม unverified-fact guard บน trace ที่มีอยู่แล้วสำเร็จ (P1)** และ ✅ **turn/handoff counter (P1)**
  แทน confidence gate ที่ native tool-use ไม่มีให้เช็ค
- ⚠️ **derive failure signal จาก audit log เดิมสำเร็จ (P3)** แต่ยังไม่มี GraphQL/UI wiring —
  ยังเห็นผลไม่ได้จริงในมือ staff จนกว่าจะต่องานนี้ให้จบ

ประโยคสรุป 1 บรรทัด:

> ใช้ `conversation history (✅ P0) + structured tool-calling (✅ มีแล้ว) + unverified-fact guard
> (✅ P1) + backend verification (✅ มีแล้ว)` แทนการยัด text เข้า AI แล้วหวังว่าจะตอบถูก — งานที่เหลือ
> (compressor, short-reply resolver, few-shot ต่อ business type, P3 UI wiring) ไม่ block ความแม่นยำ
> พื้นฐานอีกต่อไป เป็นแค่ layer เสริมที่ทำเมื่อพร้อม — และก่อน
> implement layer ไหนของเอกสารนี้ ให้เช็คตาราง Priority ท้ายเอกสารว่า "ของจริง" รองรับอยู่หรือยัง
