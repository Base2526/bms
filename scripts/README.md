# scripts/ — ชุดเทสและเครื่องมือตรวจของ repo นี้

ไฟล์ในนี้มีสองพวก และ **ชื่อไฟล์คือสัญญา**:

| รูปชื่อไฟล์ | คืออะไร | ต้องมี Postgres |
| --- | --- | --- |
| `*-db-contract.test.mts` | เทสที่ **เขียนจริงลงฐาน** | ต้องมี |
| `*.test.mts` อื่น ๆ (รวม `ai-eval/`) | เทส pure — อ่านซอร์ส/ตรรกะ/fake provider | ไม่ต้อง |
| `check-*.mts`, `rotate-*.mts` | เครื่องมือตรวจ/ซ่อมของจริง (อ่านอย่างเดียว ยกเว้น rotate) | แล้วแต่ตัว |

ตอนนี้: **119 ไฟล์เทส** = pure 83 ไฟล์ (925 เทส) + DB 36 ไฟล์ (424 เทส)
`scripts/run-contract-tests.mjs` เดินหาไฟล์เอง ไม่ต้องต่อชื่อไฟล์ด้วยมือ

> ทำไมต้องมีตัวรันกลาง: ก่อนหน้านี้ชุดเทสถูกรันด้วยคำสั่งยาว ๆ ที่จดไว้ใน `CLAUDE.local.md`
> แล้วต้องก็อปมาต่อชื่อไฟล์เอง ผลคือเทส DB หลายชุดไม่เคยถูกรันจริงในรอบที่แก้โค้ด —
> **เทสที่รันยากคือเทสที่ไม่ถูกรัน**

---

## ประตูเดียวที่ต้องจำ: `npm run gate`

```bash
cd apps/web && npm run gate
```

`gate` = `typecheck` → `test:pure` → `build` (นิยามอยู่ใน `apps/web/package.json`)
**รันก่อน merge ทุกครั้ง** · CI (`.github/workflows/gate.yml`) รันชุดเดียวกันนี้ต่อ PR
**ไม่มี job ของเทส DB ใน CI** เพราะสร้างฐานใหม่จาก `db/migrations` ไม่ได้ (ดู `CLAUDE.local.md`)

`gate` หยุดที่ขั้นแรกที่ล้ม — เห็น `tsc` แดงแปลว่าเทสยังไม่ได้รันเลย ไม่ใช่ว่าเทสผ่าน

---

## 1. `npm run test:pure` — ไม่ต้องมีฐานข้อมูล

```bash
cd apps/web && npm run test:pure
```

### ผ่าน (สิ่งที่จะได้เห็นบนจอ)

```
[gate] โหมด pure — 80 ไฟล์
...
✔ ทุก entry ในแคตตาล็อกมีคำถามที่คนถามจริง (5.3575ms)
ℹ tests 904
ℹ suites 0
ℹ pass 904
ℹ fail 0
ℹ duration_ms 28134.2541
[gate] ผลเต็มอยู่ที่ .test-output\pure.tap · สรุปรอบนี้ .test-output\pure.run.txt
```

**อ่านสามบรรทัดนี้พอ**: `ℹ tests` (จำนวนที่รัน) · `ℹ pass` · `ℹ fail` — ผ่านคือ `ℹ fail 0`
คู่กับ exit code `0` · ใช้เวลาราว 30 วินาที

> **บรรทัดที่ดูเหมือน error ไม่ใช่ความล้มเหลว** — ชุด `ai-eval` จงใจป้อน JSON เสียให้โมเดลปลอม
> เพื่อทดสอบเส้นทางล้มเหลว stderr ของมันจึงโผล่มาทั้งบนจอและเป็น comment ในไฟล์ TAP:
>
> ```
> [BMS] pharmacy AI extract validation exhausted for case case-eval: SyntaxError: ...
> ```
>
> **ตัวชี้ขาดคือ `ℹ fail` กับ exit code เท่านั้น** ไม่ใช่การมีคำว่า SyntaxError บนจอ

### ไม่ผ่าน (สิ่งที่จะได้เห็น)

**บนจอ** — spec ลิสต์เฉพาะตัวที่แดงไว้ท้ายรอบใน section ของตัวเอง:

```
✖ failing tests:

test at ../../scripts/restaurant-request-contract.test.mts
✖ chat has exactly one door to the write path, and reorder is not it (6.9ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(!customerTools('restaurant').some(tool=>tool.name==='reorder'))
```

**ในไฟล์ `.test-output/pure.tap`** — บล็อกเต็มของ TAP (ตัวอย่างจริง จากการถอดด่าน `reorder`
ของร้านอาหารออกแล้วรันใหม่):

```
not ok 24 - chat has exactly one door to the write path, and reorder is not it
  ---
  duration_ms: 6.9695
  type: 'test'
  location: '...\scripts\restaurant-request-contract.test.mts:1:11062'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:

      assert.ok(!customerTools('restaurant').some(tool=>tool.name==='reorder'))

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
...
# tests 30
# pass 29
# fail 1
```

สิ่งที่ได้จากบล็อกนี้ 4 อย่าง: **ชื่อการันตีที่พัง** (ข้อความหลัง `not ok`) ·
**ไฟล์เทส** (`location`) · **บรรทัด assert ที่ล้มจริง** · **ค่าที่คาดกับค่าที่ได้**
· exit code `1`

### ผลเต็มอยู่ในไฟล์ทุกรอบ — ไม่ต้องพึ่ง scrollback

ทุกรอบเขียนสองไฟล์ (โหมดละชุด · เขียนทับทุกครั้ง · อยู่ใน `.gitignore` แล้ว):

```
.test-output/pure.tap        ← TAP เต็มทุกบรรทัด ไม่มีรหัสสี จึง grep/diff ได้
.test-output/pure.run.txt    ← รอบนั้นรันอะไร กับฐานไหน จบยังไง
```

`pure.run.txt` ของรอบที่จบแล้ว:

```
mode=pure
filter=-
files=80
commit=a4abc8c6
database=-
started=2026-09-07T08:30:13.929Z
tap=.test-output\pure.tap
files:
  admin-navigation-contract.test.mts
  ...
finished=2026-09-07T08:30:15.989Z
duration_ms=2060
exit=0
```

> **⚠️ ไม่มีบรรทัด `exit=` = รอบนั้นยังไม่จบ ห้ามอ่านว่าเขียว**
> บรรทัดนั้นถูกเขียน *หลัง* กระบวนการลูกจบเท่านั้น · process ที่ถูกฆ่ากลางทางทิ้งไฟล์ TAP
> ครึ่งเดียวที่ไม่มี `not ok` อยู่ในนั้นเลย ซึ่งอ่านเหมือนผ่าน
>
> และ `database=` มีไว้เพราะ **ไฟล์ผลที่ไม่รู้ว่าเป็นของฐานไหนตอบอะไรไม่ได้** (โหมด DB)
> ส่วน `files:` ทำให้จับได้ทันทีว่ามีไฟล์แปลกปลอมเข้ามาในรอบ

สามงานที่ต้องใช้ไฟล์นี้ (ทำอยู่แล้วด้วยมือ):

```bash
grep '^not ok' .test-output/pure.tap                      # ไล่ตัวแดง
grep '^not ok' .test-output/pure.tap | sort > /tmp/after   # diff ก่อน/หลังว่าไม่มี regression
diff /tmp/before /tmp/after
```

เปลี่ยนที่เก็บได้ด้วย `BMS_TEST_OUTPUT_DIR` (CI ใช้เป็น artifact ได้เลย)

---

## 2. `npm run test:db` — เขียนจริงลงฐาน ห้ามรันกับ production

ชุดนี้สร้าง/ลบข้อมูลจริง และบางชุด **แก้ค่าของร้านจริงแล้วคืนตอน teardown**
(เช่น `product-vat-category` ที่แก้ประเภทภาษีของสินค้าทั้งร้าน) รันผิดฐาน = แก้ข้อมูลลูกค้า

```bash
cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
  POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' ../../.env.dev | cut -d= -f2-)" \
  REDIS_URL=redis://127.0.0.1:6379 npm run test:db
```

`POSTGRES_HOST=localhost` เพราะ `.env.dev` ชี้ host ชื่อ `postgres` (ชื่อใน docker network)

### ด่านกันรันผิดฐาน — ทั้งสองแบบออก exit `2` และ **ยังไม่รันเทสสักตัว**

ไม่ตั้ง env:

```
เทส DB ต้องมี POSTGRES_HOST + POSTGRES_DB (และ POSTGRES_USER/POSTGRES_PASSWORD)
ดูคำสั่งเต็มใน CLAUDE.local.md § ก่อน production
```

ชี้ไปเครื่องที่ไม่ใช่ท้องถิ่น:

```
ปฏิเสธการรันเทส DB กับ host "db.example.com" ซึ่งไม่ใช่เครื่องท้องถิ่น
ชุดนี้เขียนจริงลงฐาน ห้ามรันกับ production
ถ้าเป็น staging ที่ตั้งใจจริง ตั้ง BMS_TEST_ALLOW_REMOTE_DB=1
```

host ที่ถือว่าท้องถิ่น: `localhost` · `127.0.0.1` · `::1` · `postgres` · `db`

### ผ่านด่านแล้วจะพิมพ์ว่ากำลังรันกับฐานไหน

```
[gate] เทส DB จะรันกับ localhost/bms
[gate] โหมด db — 36 ไฟล์
```

**อ่านบรรทัดนี้ก่อนปล่อยให้รันต่อทุกครั้ง**

### ต่อฐานไม่ได้ = เทสแดง (ไม่ใช่ข้าม)

```
not ok 1 - restaurant intake -> callback -> atomic order; original demand, retries and tenant isolation
  code: 'ECONNREFUSED'
# tests 1
# pass 0
# fail 1
```

**แยกให้ออก**: exit `2` = ด่านปฏิเสธ ยังไม่ได้แตะฐาน · exit `1` = รันแล้วมีอะไรแดง
(รวมกรณีต่อฐานไม่ได้) — อย่างหลังไม่ได้แปลว่าโค้ดผิด ให้ดูว่า Postgres ขึ้นอยู่หรือยัง

### `npm run test:all` = pure + db (114 ไฟล์) ใช้ด่านและ env ชุดเดียวกับ `test:db`

---

## 3. รันไฟล์เดียวตอนกำลังแก้

ส่ง **ชื่อไฟล์บางส่วน** เป็นอาร์กิวเมนต์ที่สามให้ตัวรันกลาง:

```bash
node scripts/run-contract-tests.mjs pure restaurant-request
node scripts/run-contract-tests.mjs db   restaurant-request
```

บอกด้วยว่ากรองเหลือกี่ไฟล์ จึงเห็นทันทีถ้าพิมพ์ชื่อผิดแล้วรันไม่ตรงไฟล์:

```
[gate] โหมด pure — 1 ไฟล์ (กรองด้วย "restaurant-request" จาก 80)
# tests 30
# pass 30
# fail 0
```

กรองไม่ตรงอะไรเลย = exit `2` **ไม่ใช่ "ผ่าน 0 ไฟล์"** (ซึ่งอ่านเหมือนเขียว —
`contract-runner-contract` ตรึงข้อนี้ไว้ด้วยการรันตัวรันจริง):

```
ตัวกรอง "nope-nothing" ไม่ตรงไฟล์ไหนในโหมด pure (80 ไฟล์)
ตัวอย่างชื่อที่มี: admin-navigation-contract, ai-eval/archetype-policy-contract, ...
```

> **ทำไมต้องใช้ทางนี้กับชุด DB**: `npx tsx --test <ไฟล์>` ตรง ๆ **ข้ามด่านตรวจ host ทั้งหมด**
> และ **34 จาก 36 ไฟล์ของชุด DB ไม่มีด่านของตัวเอง** (มีแค่ `restaurant-request-db-contract`
> ที่ assert `local test DB required`) — ชุดนี้เขียนจริงลงฐาน · ผ่านตัวรันกลางแล้วได้ทั้ง
> ด่าน host และ shim ครบ:
>
> ```
> ปฏิเสธการรันเทส DB กับ host "db.example.com" ซึ่งไม่ใช่เครื่องท้องถิ่น
> ```
> (ทดสอบแล้วว่าด่านยังทำงานเมื่อกรองไฟล์เดียว — exit `2`)

### ถ้าจะรันมือด้วย `npx tsx` จริง ๆ ต้องใส่ shim เอง

```bash
cd apps/web && npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
  --test ../../scripts/restaurant-request-contract.test.mts
```

ลืม `--import` แล้วได้ error ที่ไม่เกี่ยวกับเทสเลย:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'server-only' imported from
  .../apps/web/lib/log/log.server.ts
```

เทสที่ import โมดูลฝั่ง server (เช่น `lib/bms/tools/catalog.ts`) ต้องมี shim ตัวนี้
ส่วนเทสที่แตะแต่โมดูล pure รันได้โดยไม่มี — จึงพลาดง่ายและอาการไม่เหมือนเทสแดง

---

## 4. `check-schema-readiness.mts` — ฐานนี้ apply migration ครบไหม (อ่านอย่างเดียว)

repo นี้ apply migration ด้วยมือตามเลข และ **ไม่มี schema probe ที่ไหนในแอป** เส้นทางร้อน
(สร้างบิล/ขาย/ส่งครัว) อ้างคอลัมน์ใหม่แบบไม่มีเงื่อนไข ฐานที่ตกไปหนึ่งไฟล์จึงล้มด้วย 42703/42P01
แล้วโผล่หน้าจอเป็น "เซิร์ฟเวอร์ผิดพลาด" เฉย ๆ (production redact ข้อความจริงทิ้ง) —
ตัวนี้แปลอาการนั้นกลับเป็น **ชื่อไฟล์ที่ต้องรัน**

```bash
npx tsx scripts/check-schema-readiness.mts
```

อ่าน `.env` / `.env.prod` / `.env.dev` ที่รากโปรเจกต์ให้เอง (env ที่ส่งมาชนะไฟล์)
และ **พิมพ์เสมอว่ากำลังตรวจฐานไหน** เพราะตรวจผิดฐานแล้วรายงานว่าครบ อันตรายกว่าไม่ตรวจ

บรรทัดแรกที่ต้องอ่าน:

```
ฐานที่กำลังตรวจ: app@localhost:5432/appdb (จาก env ที่ส่งมา)
```

### ครบ (exit 0)

```
✅ 9.66__bms_restaurant_order_requests.sql
✅ 9.40__bms_multi_store_stock_capabilities.sql
...
สรุป: ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น
```

### ขาด (exit 1)

```
❌ 9.66__bms_restaurant_order_requests.sql
   ผลถ้าไม่รัน: แชทร้านอาหารรับคำขอก่อนตรวจสต็อกไม่ได้ และร้านเปิดคิวตรวจคำขอไม่ได้
   - ไม่มีตาราง bms_restaurant_order_requests
   - ไม่มีคอลัมน์ bms_orders.restaurant_request_instructions

สรุป: ขาด 1 ไฟล์ — รันตามลำดับเลขนี้ (psql -1 ทีละไฟล์):
```

### ต่อฐานไม่ได้ (exit 1) — แยกจาก "ไม่มีปัญหา" ชัดเจน

```
❌ ต่อฐานข้อมูลไม่ได้ — ยังไม่ได้ตรวจอะไรเลย
   ต่อ localhost:5432 ไม่ได้ (Postgres ไม่ได้รันอยู่ หรือพอร์ตไม่ตรง)
```

### บนเซิร์ฟเวอร์ที่ไม่มี Node

ใช้ไฟล์ SQL ที่ generate จาก **ลิสต์ตัวเดียวกัน**:

```bash
docker compose ... exec -T postgres psql -U <user> -d <db> < db/checks/schema-readiness.sql
```

ได้ตารางสองอัน: `ไฟล์ที่ยังไม่ได้รัน / ของที่ขาด / ผลถ้าไม่รัน` แล้วบรรทัด `สรุป`

> **`db/checks/schema-readiness.sql` เป็นไฟล์ที่ถูก generate — ห้ามแก้ด้วยมือ**
> แก้ที่ `scripts/schemaReadiness.mts` แล้ว regenerate:
> ```bash
> npx tsx scripts/check-schema-readiness.mts --sql > db/checks/schema-readiness.sql
> ```
> เทส `schema-readiness-contract` เทียบไฟล์กับตัวเรนเดอร์ ลืม regenerate แล้วชุด pure แดง
> (เกิดจริงกับ `9.66` — ของที่ commit ไว้ตกแถวคอลัมน์ไป ทำให้ตัวตรวจบนเซิร์ฟเวอร์
> มองไม่เห็นคอลัมน์ที่ทำให้จอครัวตาย)

---

## 5. `check-bms-secret-key.mts` — คีย์เข้ารหัสใช้งานได้จริงไหม (อ่านอย่างเดียว)

ไม่พิมพ์ค่าความลับออกมา · รันกับ production ได้ · ควรรัน **ในคอนเทนเนอร์** เพื่อดูของที่แอปเห็นจริง:

```bash
docker compose ... exec web npx tsx scripts/check-bms-secret-key.mts
```

พิมพ์เป็นหัวข้อสี่ข้อตามลำดับนี้: **1) คีย์มาถึงโปรเซสนี้** (ตั้งไว้ไหม รูปแบบ hex 64 ถูกไหม) ·
**2) คุณภาพของคีย์** (เป็นคีย์ dev ที่คำนวณจากซอร์สได้ไหม) · **3) เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริง** ·
**4) ข้อมูลที่เก็บไว้จริง** (ถอดได้กี่ค่า)

ตัวอย่างจริงจากเครื่องที่ไม่ได้ตั้งคีย์และไม่มีฐาน (exit 1):

```
1) คีย์มาถึงโปรเซสนี้
   ❌ ไม่มี BMS_SECRET_KEY เลย
      ถ้าตั้งใน .env แล้วยังเห็นข้อความนี้ = compose ไม่ได้ส่งต่อ
3) เส้นทางเข้ารหัส/ถอดรหัสในโค้ดจริง
   ✅ encrypt → decrypt กลับมาได้ค่าเดิม
4) ข้อมูลที่เก็บไว้จริง
   ⚠️  อ่าน bms_tenant_channels ไม่ได้
```

**"ใช้งานได้" ไม่เท่ากับ "ปลอดภัย"** — สรุปแยก 4 แบบ: ใช้งานไม่ได้ / ใช้งานได้บางส่วน
(มีข้อมูลที่ถอดไม่ออก = ช่องทางตายเงียบ) / **ตรวจข้อมูลจริงไม่สำเร็จ** / ใช้ได้และเป็นคีย์ของเราเอง
· ข้อที่สามมีแยกไว้เพราะเวอร์ชันแรกรายงานว่า "ไม่มีค่าที่เข้ารหัสไว้เลย" ตอนที่ต่อฐานไม่ได้
ซึ่งอ่านแล้วเข้าใจว่าปลอดภัย

## 6. `rotate-bms-secret-key.mts` — ย้ายค่าที่เข้ารหัสด้วยคีย์ dev ไปคีย์จริง

ใช้เมื่อ production เคยรันโดยไม่ตั้ง `BMS_SECRET_KEY` (ค่าเก่าถูกเข้ารหัสด้วยคีย์ที่คำนวณจากซอร์สได้
ตั้งคีย์จริงแล้วจะถอดไม่ออก → ช่องทางของร้านดูเหมือนไม่มี token แล้วตายเงียบ)

```bash
npx tsx scripts/rotate-bms-secret-key.mts            # dry-run (ค่าปริยาย ไม่เขียนอะไร)
npx tsx scripts/rotate-bms-secret-key.mts --apply    # เขียนจริง
```

รันซ้ำได้ · ครอบ `bms_tenant_channels.{access_token,channel_secret}` และ
`bms_tenant_ai_config.api_key_encrypted` — **มีที่เก็บค่า `enc:` ใหม่ต้องเพิ่มใน `TARGETS`**

---

## ตารางสรุป exit code

| exit | หมายความว่า |
| --- | --- |
| `0` | ผ่านทั้งหมด |
| `1` | มีเทสแดง / มี migration ขาด / ต่อฐานไม่ได้ — **รันแล้วและมีผลลัพธ์** |
| `2` | ตัวรันปฏิเสธก่อนเริ่ม (โหมดผิด, ไม่มี env ของ DB, host ไม่ใช่ท้องถิ่น) — **ยังไม่ได้รันอะไร** |

---

## เขียนเทสใหม่: เขียวไม่พอ ต้องพิสูจน์ว่ามันแดงได้

กฎของ repo นี้คือ **เทสที่ผ่าน mutation test ไม่ได้ = เทสที่ยังไม่จริง** วิธีพิสูจน์:
ย้อนโค้ดที่กำลังตรึงกลับไปทีละจุด แล้วดูว่า **เทสที่แดงคือตัวที่ควรแดง** จากนั้นคืนไฟล์

เจอมาแล้วหลายรอบว่าเขียวโดยไม่ตรวจอะไร:

- เทสสแกนซอร์สที่ไปเจอ **คอมเมนต์** ที่อธิบายกฎเก่า ไม่ใช่โค้ด → ตัดคอมเมนต์ก่อนเทียบทุกครั้ง
- `slice(indexOf(A), indexOf(B))` ที่ `B` ไม่มีอยู่จริง → `indexOf` คืน `-1` แล้วสไลซ์ไปท้ายไฟล์
  หรือได้ช่วงว่าง → assert ผ่านโดยไม่ได้อ่านของที่ตั้งใจ (ใส่ `assert.ok(slice.length > 0)` กันไว้)
- assert ที่ตรึง **รูปประโยคของโค้ด** ไม่ใช่การันตี → เขียนโค้ดใหม่แล้วแดงทั้งที่กฎยังอยู่
  ทางแก้คือเล็งที่พฤติกรรม (เรียกฟังก์ชันจริง) เมื่อทำได้
- เทสที่เลือกค่าตัวอย่างซึ่งบังเอิญผ่านทั้งสองทาง (เช่นขอไซซ์ที่เป็น `min()` อยู่แล้ว)

## เอกสารที่ลึกกว่านี้

- `scripts/ai-eval/README.md` — ชุด deterministic contract ของ AI pipeline + live-model eval
- `scripts/bms-log-triage/README.md` · `scripts/load-test/README.md`
- `CLAUDE.local.md` § ประตูก่อน merge/deploy — คำสั่งเต็มของเทส DB และของค้างต่อฟีเจอร์
