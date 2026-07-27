# AI Pipeline Eval — 10 test cases

วัด "AI แม่นยำกี่ %" แบบ regression test ก่อน/หลังแก้ prompt/tool ตาม
[docs/AI Context Strategy for Multi-Tenant Shops.md](../../docs/AI%20Context%20Strategy%20for%20Multi-Tenant%20Shops.md)
— ยิงผ่าน `/api/bms/chat` (playground endpoint เดิม) ไม่ใช่ import `lib/bms/*` ตรง เพื่อไม่ต้องมี
ts-node/tsx แยกสำหรับ script เดียว

## ส่วนประกอบ
- [`run.mjs`](run.mjs) — 10 test case (บางเคสอาจถูกข้ามอัตโนมัติต่อร้าน ถ้า catalog ของร้านนั้นไม่พอ
  ให้ทดสอบ — ดู "Catalog ต่อร้าน" ด้านล่าง) ครอบคลุม P-0.5 (keyword alias), P0 (multi-turn history), P1
  (unverified-fact guard + turn/handoff counter), P2 (category injection + single-field prompt rule),
  coupon routing, order+payment happy path, order status lookup

## ก่อนรัน
1. เปิด dev server: `cd apps/web && npm run dev`
2. login แล้วเก็บ signed admin cookie เป็น Netscape cookie jar — **ใช้ GraphQL mutation `loginAdmin`
   ผ่าน `/api/graphql`** (path จริงที่หน้า `/admin/login` เรียก) **ห้ามใช้ `/api/login`** —
   นั่นเป็น REST route เก่าที่ไม่มีหน้าไหนเรียกแล้ว (`CLAUDE.local.md` § Admin session บันทึกไว้แล้วว่า
   dead code) ยังค้างอยู่ในโค้ดเฉยๆ และพังง่าย (เช่น `SyntaxError ... at position 39` ตอน parse body)
   **ใช้คำสั่งบรรทัดเดียว ห้ามใช้ `\` ต่อบรรทัด** (หลาย terminal/paste-mode ทำ line-continuation พังแล้ว
   flag `-H`/`-d` หลุดไปเป็นคนละคำสั่ง — เจอเคสนี้มาแล้วตอนพัฒนา):
   ```bash
   curl -c /tmp/bms-cookies.txt -X POST http://localhost:3000/api/graphql -H 'content-type: application/json' -d '{"query":"mutation($input: LoginInput!){ loginAdmin(input:$input){ ok message } }","variables":{"input":{"email":"admin@example.com","password":"anything"}}}'
   ```
   ตรวจว่า login สำเร็จจริง: response ต้องเป็น `{"data":{"loginAdmin":{"ok":true,"message":"Login success"}}}`
   ไม่ใช่ `{"errors":[...]}` — ถ้าเจอ `POST body missing, invalid Content-Type...` แปลว่า `-H`/`-d` หลุด
   ไปตามด้านบน ให้ตรวจว่าคำสั่งเป็นบรรทัดเดียวจริง ๆ ก่อนรันซ้ำ · ถ้าเจอ `Invalid credentials` แปลว่า
   `email` ที่ใส่ไม่ตรงกับแถวไหนใน `users` เลย (เช็คด้วย `SELECT email FROM users` ก่อน) — ต้องใช้
   **`email`** ใน `input` เท่านั้น (ใส่ `username` แทนจะหา user ไม่เจอ เพราะ resolver `loginAdmin` query
   จาก column `email` ตรงๆ ไม่ query `username` เลย ดู `graphql/resolvers.ts`) · dev ยังไม่ตรวจรหัสผ่าน
   จริง (`CLAUDE.local.md` § ก่อน production) ใส่ `password` อะไรก็ได้ที่ไม่ว่าง · เช็คว่า cookie ถูกเขียน
   จริงด้วย `cat /tmp/bms-cookies.txt` (ต้องไม่ว่างเปล่า) — บรรทัดของ `ADMIN_COOKIE` จะขึ้นต้นด้วย
   `#HttpOnly_localhost` (curl mark cookie ที่เป็น HttpOnly แบบนี้ ปกติ ไม่ใช่คอมเมนต์ที่ต้องลบทิ้ง —
   `run.mjs` parse บรรทัดนี้ถูกแล้ว) · ถ้ายังไม่ผ่าน ให้ login ผ่านหน้า `/admin/login` ในเบราว์เซอร์แล้ว
   export cookie เป็นไฟล์ Netscape format เองแทน (DevTools → Application → Cookies → copy ค่า cookie
   แอดมิน)
3. ร้านที่ทดสอบต้องมี AI credentials จริง (shared key/BYOK) ไม่งั้นจะตกไป path rule-based เดิมและหลาย
   assertion (เช่น tool `create_order` โดย AI) จะ fail เพราะคนละ path

## หลายร้านค้า (multi-tenant) — ยิงร้านเดียวหรือทุกร้าน?

**ค่า default ยิงแค่ "ร้านเดียว"** — ร้านที่ session/cookie ปัจจุบัน resolve ไป เหมือนกับที่
`/api/bms/chat` เองใช้ (`verifyAdminSession()` + `ACT_TENANT_COOKIE` ถ้ามีการ drill-down อยู่) **ไม่ได้
วนทุกร้านอัตโนมัติ**

ถ้าต้องการยิงทุกร้าน (หรือบางร้าน) ตั้ง `BMS_EVAL_ALL_TENANTS=true` — ใช้กลไก drill-down เดียวกับที่หน้า
`/admin/tenants` ใช้ปุ่ม "เข้าดู" (`bmsIsPlatformAdmin`/`bmsTenants`/`bmsEnterTenant`/`bmsExitTenant`
ใน `graphql/bmsSaas.ts`) วนเข้าแต่ละร้านแล้วยิง 10 test case ซ้ำทุกร้าน:

```bash
BMS_EVAL_ALL_TENANTS=true node scripts/ai-eval/run.mjs
```

- **ต้อง login เป็น platform admin เท่านั้น** — ถ้าไม่ใช่ จะ fallback เป็นรันร้านเดียวอัตโนมัติ พร้อม
  print warning ให้เห็นชัด (ไม่ error/ไม่หยุดรัน)
- กรองบางร้านด้วย `BMS_EVAL_TENANT_SLUGS` (comma-separated):
  ```bash
  BMS_EVAL_ALL_TENANTS=true BMS_EVAL_TENANT_SLUGS=shop-a,shop-b node scripts/ai-eval/run.mjs
  ```
- ผลลัพธ์พิมพ์แยกต่อร้าน (`[ชื่อร้าน (slug)] ผลรวม: X/Y ...`) แล้วสรุปรวมทุกร้านท้ายสุด
- ✅ แต่ละร้านใช้ **catalog จริงของร้านนั้น** (auto-discovery — ดูหัวข้อถัดไป) ไม่ใช่ keyword ตายตัวชุด
  เดียวข้ามร้านอีกต่อไป
- ⚠️ เขียนข้อมูลจริง**ทุกร้านที่วนถึง** (ดู "ข้อจำกัด" ด้านล่าง) — ถ้ามีร้านจำนวนมากจะสร้าง order/
  conversation ทดสอบกระจายไปทุกร้าน ระวังเวลารันจริง

## Catalog ต่อร้าน (auto-discovery)

**ค่า default ไม่ hardcode สินค้าอีกต่อไป** — ก่อนรันแต่ละร้าน `run.mjs` ยิง GraphQL query `bmsProducts`
(ตัวเดียวกับที่ `/admin/products` ใช้ list, ต้องมีสิทธิ์ `product.view` ในร้านนั้น) แล้วเลือกสินค้าจริงของ
ร้านนั้นเองมาใช้:

- **productKeyword/productSize** — เลือกสินค้า `active` ที่มี variant ไหนก็ได้ `available > 0` จริง
  (กันไปสั่งสินค้าที่ของหมด/ปิดขายอยู่ ซึ่งจะทำให้ assertion ล้มเหลวแบบไม่มีความหมาย)
- **aliasKeyword** (ใช้ทดสอบ P-0.5) — เลือกสินค้าที่ตั้ง `keywords[]` ไว้จริง (ไม่ว่าง) แล้วหยิบคำที่ไม่ใช่
  substring ของชื่อสินค้าเอง เพื่อให้เป็นการทดสอบ alias ที่มีความหมายจริง (ไม่ใช่แค่ค้นชื่อตรง ๆ)
- ถ้าร้านไหน**ไม่มีสินค้า active ที่มีสต็อก**เลย → ข้าม test case ที่ต้องสั่งซื้อจริงทั้งหมด (`p0-multi-turn-slot-fill`,
  `single-field-ask-back`, `order-then-payment-happy-path`) พร้อม log เหตุผล ไม่ fail แบบเงียบ ๆ
- ถ้าร้านไหน**ไม่มีสินค้าไหนตั้ง `keywords[]` ไว้เลย** → ข้าม `p05-alias-search`/`alias-order-single-message`
  พร้อม log แนะนำให้ไปตั้งที่ `/admin/products` (field นี้แก้ได้ในฟอร์มสินค้าอยู่แล้ว)
- test case ที่ไม่พึ่ง catalog เลย (`p2-category-browse`, `order-status-lookup`, `coupon-question-routing`,
  `turn-budget-handoff`, `greeting-safety`) รันทุกร้านเสมอ ไม่ขึ้นกับผลลัพธ์ discovery

**Override**: ตั้ง `EVAL_PRODUCT_KEYWORD` (ENV) เพื่อบังคับใช้ค่าที่ระบุแทนการ auto-discover — จะใช้
"ค่าเดียวกันทุกร้าน" เหมือนพฤติกรรมเดิม เหมาะเวลาต้องการชี้สินค้าเจาะจงตัวใดตัวหนึ่งข้ามร้าน (เช่น
demo scenario ที่ทุกร้าน seed สินค้าชื่อเดียวกันไว้)

## รัน
```bash
node scripts/ai-eval/run.mjs
```

| ENV | ค่า default | ใช้ทำอะไร |
|---|---|---|
| `BMS_EVAL_BASE_URL` | `http://localhost:3000` | base URL ของ dev server |
| `BMS_EVAL_COOKIE_JAR` | `/tmp/bms-cookies.txt` | path cookie jar (Netscape format) |
| `BMS_EVAL_ALL_TENANTS` | `false` | `true` = วนทุกร้าน (ต้อง platform admin — ดูหัวข้อด้านบน) |
| `BMS_EVAL_TENANT_SLUGS` | (ว่าง = ทุกร้าน) | comma-separated slug กรองเฉพาะบางร้านเมื่อ `BMS_EVAL_ALL_TENANTS=true` |
| `EVAL_PRODUCT_KEYWORD` | (ว่าง = auto-discover) | ตั้งเพื่อ **บังคับ override** การ auto-discover — ใช้ค่าเดียวกันทุกร้าน |
| `EVAL_PRODUCT_SIZE` | `M` (เฉพาะตอน override) | ไซซ์ที่มีสต็อกจริงของสินค้าตัวนั้น (ไม่ใช้ถ้าไม่ตั้ง `EVAL_PRODUCT_KEYWORD`) |
| `EVAL_PRODUCT_QTY` | `1` | จำนวนที่สั่ง (เล็กพอไม่ชนสต็อก) |
| `EVAL_ALIAS_KEYWORD` | (ว่าง = auto-discover) | ตั้งเพื่อบังคับ alias keyword แทนการ auto-discover จาก `keywords[]` |

ตัวอย่างการ override (บรรทัดเดียว กัน `\` line-continuation หลุดเหมือน login ด้านบน):
```bash
EVAL_PRODUCT_KEYWORD="เสื้อยืดสีดำ" EVAL_PRODUCT_SIZE="L" EVAL_ALIAS_KEYWORD="เสื้อคอกลม" node scripts/ai-eval/run.mjs
```

## อ่านผล
- พิมพ์ ✅/❌ ต่อ assertion ทุก turn ของทุก test case
- สรุปท้าย: `X/Y assertions ผ่าน (Z%)` — นี่คือ "% ความแม่นยำ" ที่ใช้เทียบข้าม run/ข้ามเวอร์ชัน prompt
- แยกรายงาน **unverified-fact guard** และ **unverified-action-claim guard** (global invariant เช็คทุก
  turn ของทุกเคส ไม่ใช่แค่เคสเดียว)
- โหมด multi-tenant พิมพ์แยกต่อร้าน (`[ชื่อร้าน (slug)] ...`) แล้วสรุปรวมทุกร้านท้ายสุด
- exit code `1` ถ้ามี assertion ไหน fail ในร้านไหนก็ตาม (ใช้เป็น CI gate ได้ในอนาคต ถ้าต่อเข้า workflow)

## ข้อจำกัดที่ต้องรู้ก่อนเชื่อผลลัพธ์
- **LLM ไม่ deterministic** — เคสที่ fail บางรอบ/ผ่านบางรอบ = flaky ไม่ใช่ regression จริง รันซ้ำ 2-3 รอบ
  ก่อนสรุป
- **เขียนข้อมูลจริง**: ทุก test case ใช้ `channel:"web"` (ไม่ใช่ `"test"`) เพื่อให้ `logConversation()`
  persist ข้อความจริง (จำเป็นสำหรับทดสอบ P0/P1 ที่อ่าน/เขียน `bms_conversations`/`bms_messages`) —
  `customerRef` ขึ้นต้นด้วย `EVAL-` เสมอกันชนกับลูกค้าจริง แต่จะโผล่ใน `/admin/inbox` จริงของ tenant ที่
  login อยู่ (ลบเองได้ทีหลังถ้าต้องการ ไม่มี cleanup script อัตโนมัติให้ตอนนี้)
- **ราคา/สต็อกต้องตรงจริง** — เคส `order-then-payment-happy-path`/`alias-order-single-message` เรียก
  `create_order` จริง (จองสต็อกจริง) ไม่ใช่แค่ preview — รันบน dev DB เท่านั้น ห้ามรันชี้ไป production
  connection string เด็ดขาด
- เป็น eval harness ตัวแรกของโปรเจกต์นี้ (ไม่มี test suite อื่นอยู่ก่อน) — ยังไม่ได้ต่อเข้า CI/GitHub
  Actions ตอนนี้
