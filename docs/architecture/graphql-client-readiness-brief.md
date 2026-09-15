# Brief: ทำ GraphQL ให้พร้อมที่ application ดึงไปใช้จริง

> สถาปัตยกรรม: [mobile-graphql-ws-realtime.md](mobile-graphql-ws-realtime.md) ·
> สัญญาฝั่ง client: [react-native-graphql-client.md](react-native-graphql-client.md) ·
> กฎ agent: [AGENTS.md](../../AGENTS.md) + [agent-invariants.md](../agent-invariants.md)

## 0. โจทย์

สคีมามีครบแล้ว แต่ **ส่วนที่แอปจะใช้จริงยังเขียน client แบบ typed ไม่ได้** งานนี้คือทำให้
React Native / mobile ดึงไปใช้ได้โดยมี type safety จริง ไม่ใช่ `any`

**ไม่ใช่งานนี้:** เพิ่ม operation ใหม่ · เปลี่ยน business logic · แตะ REST · แตะ migration

---

## 1. สภาพปัจจุบัน (วัดจากสคีมาที่ประกอบได้จริง ไม่ใช่เดา)

| | typed | `JSON` |
| --- | --- | --- |
| Query 254 | 219 | **35** |
| Mutation 280 | 248 | **32** |
| Subscription | 33 | — |

ของเดิมฝั่ง admin เป็น GraphQL ที่ดีอยู่แล้ว · **67 ตัวที่เป็น `JSON` คือชุดที่เพิ่งทำเพื่อ
mobile/POS พอดี** อยู่ใน 2 ไฟล์:

- `apps/web/graphql/bmsPosDevice.ts` — 27 query + 27 mutation (device token + PIN)
- `apps/web/graphql/bmsMobileOperations.ts` — 8 query + 5 mutation (staff Bearer)

รูปทรงวันนี้คือ `bmsPosSale(input: JSON!): JSON!` ทั้งหมด

### ทำไมรูปนี้ยังไม่พร้อม

1. **codegen ได้ `any`** — เสียเหตุผลหลักที่เลือก GraphQL แทน REST ตั้งแต่แรก
2. **เลือก field ไม่ได้** ต้องรับทั้งก้อนทุกครั้ง — แท็บเล็ตหน้าร้านใช้เน็ตร้าน
3. **server ลบ/เปลี่ยนชื่อ field แล้วไม่มีอะไรเตือน client** ไปพังตอนรันที่เคาน์เตอร์
4. **input ไม่ถูก validate ที่ schema** — พิมพ์ชื่อฟิลด์ผิดได้ `undefined` เงียบ ๆ ไม่ error
   (นี่คือบั๊กคลาสเดียวกับที่รีโปนี้เคยเจอ: เทสส่ง `priceTiers` ขณะที่โค้ดอ่าน `price_tiers`
   แล้วบล็อกทั้งก้อนถูกข้ามโดยไม่มีใครรู้)
5. **ไม่มี `@deprecated`** — เลิกใช้ field ไหนไม่ได้อย่างปลอดภัย
6. **introspection ปิดบน production** (`introspection: NODE_ENV !== "production"`) และ
   **ไม่มีไฟล์ SDL ในรีโปเลย** → client ไม่มีอะไรให้ gen type
7. **return shape ไม่มีเอกสาร** — คนเขียน client ต้องอ่าน `bmsPosDevice.ts` 1,713 บรรทัดเอง

---

## 2. กฎที่ห้ามละเมิด (invariant ของรีโปนี้)

อ่าน [agent-invariants.md](../agent-invariants.md) ก่อนเริ่ม · ที่เกี่ยวกับงานนี้โดยตรง:

- **ห้ามย้าย business logic เข้า resolver** — resolver เป็น thin adapter ตรรกะอยู่ที่
  `apps/web/lib/bms/*.ts` · งานนี้แตะ **ชั้น type เท่านั้น**
- **ห้ามรับ `tenantId` / `locationId` / `deviceId` / `actingTenantId` / `shiftId` เป็น field
  ใน input type** — ต้อง derive ฝั่ง server เสมอ · POS อ่านจาก `device.*` (วันนี้ 164 จุด),
  staff อ่านจาก `getTenantId(ctx)` · **`scripts/mobile-graphql-contract.test.mts` บังคับอยู่แล้ว
  และจะแดงถ้าเผลอ** (ข้อยกเว้นเดียวที่มีอยู่คือ `input.locationId` ฝั่ง staff ซึ่งเท่ากับ REST เดิม)
- **ห้ามเปลี่ยนผลลัพธ์ที่ operation คืนวันนี้** — งานนี้คือ "ประกาศรูปทรงที่มันคืนอยู่แล้ว"
  ไม่ใช่เปลี่ยนว่ามันคืนอะไร · ถ้าเจอว่ารูปทรงจริงแย่ **ให้จดไว้ อย่าแก้ในงานนี้**
- **ห้ามแตะ REST** — ต้องอยู่ครบจนกว่า caller จะย้าย (`mobile-transport-compat-contract` บังคับ)
- **ห้ามลบ/เปลี่ยนชื่อ field ที่ประกาศไปแล้ว** โดยไม่ `@deprecated` ก่อน
- **ห้าม apply migration หรือเปิดธง `REALTIME_*`** — งานนี้ไม่ต้องใช้ DB เลย
- PIN / RBAC / idempotency / audit ในทรานแซกชัน ต้องเหมือนเดิมทุกประการ

---

## 3. งานเป็นเฟส

### Phase 1 — SDL artifact + ด่านกัน schema drift (ทำก่อน เล็กสุด ได้ผลทันที)

1. เพิ่มสคริปต์ export SDL จาก `buildBmsGraphqlSchema()` (`apps/web/graphql/schema.ts`)
   ออกเป็นไฟล์ `schema.graphql` แล้ว **commit ลงรีโป**
2. เพิ่มเทสว่าไฟล์ที่ commit ตรงกับสคีมาที่ประกอบได้ — **ลอกรูปแบบจาก
   `scripts/schema-readiness-contract.test.mts`** ที่เทียบ `db/checks/schema-readiness.sql`
   กับตัวเรนเดอร์ (ห้ามแก้ไฟล์ด้วยมือ · ไม่ตรง = แดง)
3. ผลพลอยได้ที่ตั้งใจ: **การเปลี่ยนสคีมาจะโผล่เป็น diff ใน PR** ซึ่งวันนี้มองไม่เห็นเลย

> ทำไมต้องเป็นไฟล์: introspection ปิดบน production และเราไม่ควรเปิด · client ต้อง gen type
> จาก artifact ไม่ใช่จาก endpoint

### Phase 2 — typed input (ก่อน output เพราะได้ validation ฟรี)

แปลง `input: JSON!` เป็น `input` type จริงทีละ operation

- ชื่อ type ตามที่รีโปใช้อยู่: `input BmsPosSaleInput { … }` (ดูแบบที่
  `input BmsPosDeviceInput`, `input BmsLocationInput` ใน `apps/web/graphql/typeDefs.ts`)
- **ฟิลด์ที่ต้องมีทุก mutation ที่ขยับเงิน/สต็อก/เอกสาร**: `idempotencyKey: String!`
- **ฟิลด์ PIN**: `cashierUserId: ID!` + `pin: String!` และผู้อนุมัติคนที่สองเมื่อ workflow ต้องการ
- **ห้ามมี** tenant/location/device/shift ใน input type (ดูข้อ 2)
- resolver ยังเรียก service ตัวเดิมด้วยอาร์กิวเมนต์ชุดเดิม — เปลี่ยนแค่ทางที่ค่าเดินทางเข้ามา

**⚠️ กับดัก:** โค้ดปัจจุบันอ่าน input แบบ `inputRecord(args.input).foo` และหลายที่ใช้
snake_case ปนกับ camelCase · ตอนแปลงต้อง **ไล่ดูของจริงว่า resolver อ่านชื่ออะไร** ไม่ใช่เดา
จากชื่อใน service · ถ้า SDL ประกาศชื่อไม่ตรงกับที่ resolver อ่าน ฟิลด์นั้นจะกลายเป็น
`undefined` เงียบ ๆ ซึ่งคือบั๊กที่งานนี้ตั้งใจมากำจัด

### Phase 3 — typed output

แปลง `: JSON!` เป็น type จริง · **เรียงตามที่แอปใช้บ่อยสุดก่อน ไม่ต้องครบ 67 ตัวรวดเดียว**

ชุดแรกที่แนะนำ (จอหลักของ RN):

```
bmsPosSession · bmsPosScan · bmsPosCatalogSearch · bmsPosRestaurantMenu
bmsPosRestaurantFloor · bmsPosRestaurantCheck · bmsPosKitchenTickets
bmsPosSale · bmsPosRestaurantOpenCheck · bmsPosShift
```

- ที่มาของรูปทรงคือ **สิ่งที่ resolver คืนจริงวันนี้** — อ่านจากโค้ด อย่าออกแบบใหม่
- ฟิลด์ที่อาจเป็น null ต้องประกาศเป็น nullable จริง ๆ · **`Float!` ที่จริงเป็น null
  จะทำให้ทั้ง query พังแบบ non-null violation** (รีโปนี้เคยโดนมาแล้วกับ
  `BmsKitchenTicket.orderId: ID!` ที่ตั๋วบิลโต๊ะไม่มี orderId → **กระดานครัวพังทั้งหน้า**)
- **เงินเป็น `Float` ตามที่รีโปใช้อยู่** (`BmsOrder.total_amount: Float!`) อย่าเปลี่ยนเป็น String
  ในงานนี้ — การเปลี่ยนชนิดของเงินเป็นการตัดสินใจแยกที่กระทบทุกจอ
- วันที่เป็น `String` (ISO) ตามของเดิม · **`Date` จาก `pg` ต้อง `.toISOString()` ก่อนคืน**
  ไม่งั้น frontend ได้ `Invalid Date` (ดู `toISO()` ใน `bmsInbox.ts`)

### Phase 4 — แตก "action mutation" เป็น mutation จริง

วันนี้มีรูปแบบ REST-ism หลงเหลืออยู่:

```
bmsPosRestaurantCheckAction(input: JSON!)      # input.action = "move" | "cancel" | ...
bmsPosRestaurantIncomingAction · bmsPosRestaurantQrOrderAction
bmsPosRestaurantRequestAction · bmsPosRestaurantServiceCallAction
bmsPosRestaurantWaitlistAction · bmsStockTransfer · bmsStockCount
```

`action` ที่เป็นสตริงใน JSON คือสิ่งที่ GraphQL ควรแสดงเป็น field แยก — client จะได้รู้ว่า
แต่ละ action ต้องการอาร์กิวเมนต์อะไรและคืนอะไร

- **เพิ่ม mutation ใหม่ที่ตั้งชื่อชัด แล้ว `@deprecated` ตัวเดิม** ห้ามลบทันที
- ทั้งสองทางต้องเรียก service ตัวเดียวกัน — **ห้ามก็อป logic**
- ถ้า action ไหนมีผู้เรียกจริงอยู่แล้วให้คงไว้จนกว่าจะย้าย

### Phase 5 — error contract

client ต้องแยก "ลองใหม่ได้" ออกจาก "จบแล้ว" ได้

- ทุก error ต้องมี `extensions.code` ที่มีความหมาย (วันนี้มี `UNAUTHENTICATED`,
  `FORBIDDEN`, `BAD_USER_INPUT`, `CONFLICT` อยู่แล้วใน `posDeviceAuth.ts` — ใช้ชุดนี้ต่อ)
- **business failure ต้องไม่เป็น error** — `PAYMENT_MISMATCH`, `SHIFT_NOT_OPEN`,
  `OUT_OF_STOCK`, `SOLD_OUT_TODAY` ฯลฯ เป็น **สถานะที่คืนใน data** ไม่ใช่ throw
  (รีโปนี้ทำแบบนี้อยู่แล้วผ่าน `CreateOrderResult` / `describePosFailure()` — อย่าทำให้ต่างออกไป)
- เขียนตารางรหัส + ความหมาย + "client ควรทำอะไรต่อ" ลงเอกสาร

### Phase 6 — เอกสารให้คนเขียน client

- อัปเดต [react-native-graphql-client.md](react-native-graphql-client.md): ตัวอย่าง query/mutation
  จริงของแต่ละจอ พร้อม field selection ที่แนะนำ
- ตารางรหัส error จาก Phase 5
- **บอกชัดว่า operation ไหน typed แล้ว ไหนยังเป็น JSON** — ครึ่งทางเป็นเรื่องปกติ
  แต่คนเขียน client ต้องรู้ว่าตัวไหนเชื่อ type ได้

---

## 4. เทสที่ต้องมี

- **ขยาย `scripts/mobile-graphql-contract.test.mts`** (มีอยู่แล้ว 10 เทส) — มันอ่าน SDL ที่
  parse แล้วและจับคู่ field ↔ resolver สองทิศอยู่แล้ว · เพิ่ม: operation ที่แปลงแล้วต้อง
  **ไม่ใช่ `JSON`** และนับถอยหลังจำนวนที่เหลือ เพื่อให้เห็นความคืบหน้าและกันการถอยกลับ
- เทสใหม่: ไฟล์ SDL ที่ commit ต้องตรงกับสคีมาที่ประกอบได้ (Phase 1)
- เทสใหม่: ไม่มี input type ไหนมีฟิลด์ tenant/location/device/shift
- เทสใหม่: ทุก mutation ที่ขยับเงิน/สต็อก/เอกสารต้องมี `idempotencyKey` ใน input type
- **ต้อง mutation test ทุกข้อ** — รีโปนี้มีประวัติเทสสแกนซอร์สที่เขียวด้วยเหตุผลผิดหลายครั้ง
  (`bmsPosVoid` ถูกลบทั้ง operation แล้วเทสยังเขียวเพราะชื่อเหลือในคอมเมนต์) ·
  ทำโค้ดพังทีละแบบแล้วยืนยันว่าแดง **ถูก subtest** ไม่ใช่แค่แดง

---

## 5. Definition of done ของทุกเฟส

1. `cd apps/web && npm run gate` ผ่าน (typecheck · pure · production build)
2. `cd apps/ws && npx tsc --noEmit` ผ่าน — สคีมาใช้ร่วมกับ WS gateway
3. mutation test ของเทสใหม่ทุกตัว แดงถูกตัว
4. `git status` สะอาด · ไฟล์ที่ mutate คืนตรงทุกไบต์
5. **ไม่มี migration ใหม่ ไม่มี permission ใหม่ ไม่แตะ `db/`**
6. บันทึกลง [CLAUDE.local.md](../../CLAUDE.local.md) ตามธรรมเนียม: ทำอะไร เจอกับดักอะไร
   อะไรยังไม่ได้ทำ **และอะไรที่ยังไม่ได้ verify**

---

## 6. กับดักเฉพาะของรีโปนี้ (เคยทำให้เสียเวลามาแล้ว)

- **ไฟล์เป็น CRLF** — สคริปต์ที่เขียนด้วย `\n` จะทำให้ diff บวมหรือ patch ไม่ตรงเงียบ ๆ ·
  ตรวจ `git diff --stat` ทุกครั้งหลังแก้ด้วยสคริปต์
- **`typeDefs.ts` เป็น template literal** — backtick ในคอมเมนต์ SDL ปิด literal กลางคัน
  แล้วได้ `TS1005` ที่ชี้บรรทัดผิดที่
- **เทส pure ใน `scripts/` import แพ็กเกจอย่าง `graphql` ตรง ๆ ไม่ได้** (อยู่ที่
  `apps/web/node_modules` เท่านั้น) แต่ import **โมดูลใต้ `apps/web`** ได้ปกติ ·
  ถ้าต้องใช้ ให้ทำเป็น helper ใน `apps/web/graphql/` แล้ว import ตัวนั้น
  (แบบเดียวกับ `apps/web/graphql/schema.ts`)
- **`assert.match(src, /ชื่อ operation/)` ไม่ใช่การตรวจว่ามี operation** — ต้องอ่านจาก SDL
  ที่ parse แล้ว (มีตัวช่วยอยู่ใน `mobile-graphql-contract.test.mts` แล้ว ใช้ซ้ำ)
- **ตัดคอมเมนต์ก่อนสแกนซอร์สเสมอ** — คอมเมนต์ที่อธิบายกฎเองทำให้ assertion ผิดได้ทั้งสองทิศ

---

## 7. ลำดับที่แนะนำ

Phase 1 → 2 → 3 (ชุดแรก 10 ตัว) → 5 → 6 แล้วค่อย 4 และ Phase 3 ที่เหลือ

**Phase 1 ทำได้เลยทันที ไม่ต้องมี DB ไม่กระทบใคร และปลดล็อกให้คนเขียน client เริ่มได้**
ก่อนที่ Phase 2–3 จะเสร็จครบ

---

## 8. นอกขอบเขต (ห้ามทำในงานชุดนี้)

- เพิ่ม operation ใหม่ที่ยังไม่มี
- เปลี่ยนชนิดของเงินจาก `Float`
- แตะ subscription (18 ตัวเสร็จแล้ว) และ realtime/outbox
- apply migration `9.70`–`9.74` หรือเปิดธง `REALTIME_*`
- ย้าย caller ฝั่งเบราว์เซอร์จาก REST ไป GraphQL — เป็นงานคนละรอบที่ต้องมี flag ของตัวเอง
- ลบ REST ใด ๆ
