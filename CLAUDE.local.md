# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

เก็บเฉพาะสิ่งที่ต้องใช้ทุกครั้งที่ลงมือทำในเครื่องนี้ · สเปก: [CLAUDE.md](CLAUDE.md) ·
กฎ agent: [AGENTS.md](AGENTS.md) + [docs/agent-invariants.md](docs/agent-invariants.md)

## Restaurant chat delivery — 2026-09-04

- งานเฟส 1–5 ลงครบแล้ว; สถานะ migration และสิ่งที่ยัง verify ไม่ได้ดูหัวข้อ
  “Restaurant chat delivery rollout” ด้านล่าง (อย่าตีความว่า apply DB แล้ว)

**ประวัติงานเก่าทั้งหมด (ทุก § ที่เคยอยู่ในไฟล์นี้) ย้ายไป
[docs/local-notes-archive.md](docs/local-notes-archive.md)** — ยกไปครบไม่ได้ลบ ก่อนแก้ฟีเจอร์ไหนให้
เปิดหัวข้อนั้นก่อน (Channel Health, AI Provider Health, Failure Incidents, AI tool-calling, Coupons,
Follow-up Automation, Redis, Live Dashboard ฯลฯ)

## รันในเครื่อง (dev)

```bash
# dev stack ผ่าน docker (postgres + redis + web + ws + pgadmin; Caddy ปิดไว้โดย default)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# เปิด Caddy เฉพาะเครื่องที่ไม่มี reverse proxy ตัวอื่นจับ 80/443 อยู่
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile with-caddy up --build

# หรือรัน web อย่างเดียว (ต่อ postgres/redis ใน docker)
cd apps/web && npm install && npm run dev            # http://localhost:3000
cd apps/web && npx tsc --noEmit && npm run build     # ✅ รันก่อน merge ทุกครั้ง
```

- **ห้ามใช้ `pnpm`** — repo ลงด้วย npm การรัน pnpm อาจย้าย package ไป `node_modules/.ignored` แล้ว
  type checker ฟ้องว่าโมดูลหายทั้งโปรเจกต์ · `.pnpm-store/` ที่โผล่มาคือเศษ ไม่ใช่ของจริง
- **Docker กับ host ห้ามแชร์ `.next`/`node_modules`** — `docker-compose.dev.yml` mount
  `web_next_cache` ที่ `/app/apps/web/.next` และ `web_node_modules` ที่ `/app/apps/web/node_modules`
  แยกจาก bind mount ของ source **ห้ามถอด** ถ้าแชร์กัน manifest ของ App Router ปนกันจนทุก route พัง
  ด้วย `Cannot read properties of undefined (reading 'clientModules')` และ native package (เช่น
  `esbuild`) จะคนละ platform · recovery: หยุดเฉพาะ `web` → ล้าง `.next` → recreate container `web`
  (ไม่ต้องแตะ volume ของ Postgres)
- dev compose รัน `npm ci` เฉพาะตอนยังไม่มี `node_modules/.package-lock.json` ใน volume (ให้ start
  รอบถัดไปเร็ว) — ถ้าเปลี่ยน dependency แล้ว container ไม่ตรง ให้ recreate เฉพาะ volume
  `web_node_modules` หรือ exec เข้าไปรัน `npm ci` ใหม่
- เนื้อที่ไม่พอ: `du -sh apps/web/.next apps/web/node_modules` + docker volumes — โปรเจกต์นี้จงใจมี
  cache สองชุด (host + docker)

## ประตูก่อน merge/deploy (gate) — 2026-08-27

```bash
cd apps/web && npm run gate      # typecheck → เทส pure 226 ตัว (~6 วิ) → production build
```

- **`npm run test:pure`** รันเทส 22 ไฟล์ที่ไม่ต้องมี DB · **`npm run test:db`** รันชุด `-db-contract`
  25 ไฟล์ · **`npm run test:all`** ทั้งหมด — ทั้งสามผ่าน `scripts/run-contract-tests.mjs` ตัวเดียว
  (ค้นไฟล์เอง ไม่ต้องต่อชื่อไฟล์ด้วยมือเหมือนคำสั่งยาว ๆ ที่จดไว้ใน § ก่อน production)
- **`test:db` ปฏิเสธ host ที่ไม่ใช่เครื่องท้องถิ่น** (ต้องตั้ง `BMS_TEST_ALLOW_REMOTE_DB=1` ถ้าจงใจ)
  — ชุดนี้เขียนจริงลงฐานและบางตัวแก้ค่าของร้านจริง การกันไว้ในโค้ดดีกว่าพึ่งคนพิมพ์คำสั่ง
- **CI**: `.github/workflows/gate.yml` รัน typecheck + pure + build ทุก PR และทุก push เข้า
  `main`/`develop` · **ยังไม่มี job สำหรับเทส DB** เพราะสร้างฐานใหม่จาก `db/migrations` ไม่ได้ (ดูข้อ
  ถัดไป) — จงใจไม่เพิ่ม job ที่รู้อยู่แล้วว่าแดง
- **⚠️ `db/migrations` สร้างฐานใหม่ตามลำดับเลขไม่ได้** — `1.24__roles.sql` กับ
  `001_normalize_roles_phase1.sql` นิยามตาราง `roles` คนละแบบที่อยู่ร่วมกันไม่ได้
  (`key`/`is_system` กับ `is_active`/`updated_at`) แอปใช้ของ `001` (ดู `graphql/resolvers.ts`)
  แต่ `1.24` มีเลขน้อยกว่าจึงรันก่อน แล้ว `001` เป็น `IF NOT EXISTS` จึงข้ามตัวเองเงียบ ๆ →
  **ฐานสร้างเสร็จโดยไม่มี error แต่หน้า users/roles พังทั้งหมด** · `scam_phones_summary` (1.20 vs
  1.27) เป็นแบบเดียวกันในฟีเจอร์ชุมชนยุคก่อน BMS · **ยังไม่ได้ตัดสินใจว่าจะจัดการยังไง**
- `scripts/migration-order-contract.test.mts` (3 เทส ไม่ต้องมี DB) กัน 3 อย่าง: เลขซ้ำ ·
  ไฟล์ `.sql` ที่ไม่มีเลขต้องถูกประกาศว่ารันหรือข้าม (ตอนนี้ 4 ไฟล์ — `001`, `001 ROLLBACK`, `002`,
  `tenant+cough+diarrhea.sql` ซึ่งเป็น template ที่ยังมี `YOUR_TENANT_ID` ค้าง) · และตารางที่ถูก
  นิยามด้วยคอลัมน์ที่ขัดกันจากสองไฟล์ (เทียบกับลิสต์ที่รู้แล้วแบบ **ตรงเป๊ะ** ไม่ใช่ allowlist —
  แก้ต้นเหตุจบแล้วต้องลบบรรทัดออกด้วย) · ยืนยันแล้วว่า **แดงจริง** เมื่อใส่ไฟล์ทดสอบเข้าไป
- **ตอนตั้ง gate ครั้งแรกพบว่าชุด pure แดงอยู่ 2 ตัวโดยไม่มีใครรู้** — แก้ไปพร้อมกัน:
  1. `inventory-tenant-scope-contract` เทียบ path จาก `path.relative()` (`\` บน Windows) กับ
     allowlist ที่เขียนด้วย `/` → แดงทุกครั้งบนเครื่องนี้ ตอนนี้ normalize ด้วย `relPosix()`
  2. `data-integrity-contract` ยัง assert `verifyAdminSession()` ในสาม route ของ payment ที่ย้ายไป
     ใช้ `authorizeAdminRoute()` ตั้งแต่ 2026-08-24 → เปลี่ยนเป็นตรวจว่า route เรียก helper ด้วย
     สิทธิ์ที่ถูก **และตรวจที่ตัว helper เองว่ายังทำ verifyAdminSession + verifyActTenant +
     requirePermission จริง** (การันตีเดิมย้ายที่ ไม่ได้หายไป)

### เทสเส้นเงิน (audit 2026-08-27)

ไล่ทุกโมดูลที่ตัดสิน "เงินเท่าไร" เทียบกับเทสที่มีจริง — ราคา/ส่วนลด/แต้ม ครอบดีอยู่แล้ว
(`pricing-contract` 25 · `loyalty-contract` 21 · `pos-contract` 12) แต่ **สามจุดไม่มีเทส pure เลย**
เพิ่มแล้วในคอมมิต `92c53de1`:

- **`vat-contract.test.mts` (25 เทส)** — `lib/bms/vat.ts` เป็นที่เดียวที่ตัดสิน VAT ที่ยื่นสรรพากร
  แต่เดิมถูกเรียกผ่านชุด DB เท่านั้น จึงไม่เคยรันในรอบที่ไม่มี Postgres ต่ออยู่ (= เกือบทุกรอบ)
  · เลขอ้างอิง 2 ใบในหัวไฟล์ `vat.ts` (วราภรณ์ 134.00 BASE_FIRST · Makro 354.00 VAT_FIRST_TRUNCATE)
  ถูกตรึงเป็น golden **คำนวณมือ ไม่ได้ก็อปจาก output** เพราะเหตุผลทั้งหมดที่ `vat_rounding` ต้องมี
  คือสองใบนี้ต่างกัน 1 สตางค์ · มีเทสไล่ 216 ชุด (โหมดปัด × รวม/ไม่รวม VAT × ส่วนลด × ค่าส่ง)
  ยืนยัน `taxable + exempt + rounding = ยอดที่ลูกค้าจ่าย` และ `ฐาน + VAT = ยอดก่อนปัดเศษ` เสมอ
- **`coupon-contract.test.mts` (19 เทส)** — `lib/bms/coupons.ts` 885 บรรทัด **ไม่เคยมีเทสสักตัว**
  (ที่ชุด loyalty แตะคำว่า coupon คือการป้อน `couponDiscount` ที่คำนวณเสร็จแล้วเข้าไป ไม่ได้ตรวจว่า
  เลขนั้นมาถูก) · ป้อน client จำลองให้ `applyCouponInTx` จึงตรวจ "กติกา" ได้โดยไม่ต้องมี DB
  (หมดอายุ/ขั้นต่ำ/โควตา/เพดานต่อคน/%/จำนวนเงิน) · **เทสสำคัญ: โค้ดที่ถูกปฏิเสธต้องไม่นับ redemption**
  ไม่งั้นโค้ดจำกัด 100 ครั้งถูกเผาทิ้งโดยคนที่ยังไม่ได้ซื้ออะไร
- **`shipping-fee-contract.test.mts` (11 เทส)** — `shippingZones.ts` เป็น pure และตัดสินค่าส่ง
  ซึ่ง **เข้าฐาน VAT** ต่อ · parser ทั้งสองทิ้งแถวผิดรูปเงียบ ๆ โดยตั้งใจ และ **ลำดับขั้นน้ำหนักคือเงิน**
  (`shippingRates.ts` เลือกขั้นแรกที่ครอบน้ำหนัก ไม่เรียง = ของหนักได้ค่าส่งของขั้นเบา)

**ทุกชุดผ่าน mutation test ไม่ใช่แค่เขียว** — ทดลองทำโค้ดพัง 7 แบบแล้วดูว่าเทสแดงถูกตัว:
truncate→round · ค่าบริการกลายเป็นของที่ลดได้ · FIXED ไม่ cap · โควตา off-by-one · ข้ามวันหมดอายุ ·
ไม่เรียงขั้นน้ำหนัก · ยอมรับค่าส่งติดลบ
· **เคสค่าบริการรอบแรกไม่แดง** — assert ที่เขียนไว้แยกสองพฤติกรรมไม่ออก (ส่วนลดกองเดียวเฉลี่ยแล้วได้
เลขเท่ากัน) ต้องเพิ่มเคสที่ส่วนลดเกินยอดสินค้า และเคสที่มีของยกเว้นปนถึงจะแยกได้

**ยังไม่ครอบ (ต้องมี DB)**: บิลใบเดียวเดินครบเส้น ราคาส่ง→โปร→เซ็ต→ค่าบริการ→ส่วนลดบิล→แต้ม→
เครดิต→VAT→ปัดเศษ→คืนบางส่วน · และ **`bms_orders.discount_amount` เป็นช่องเดียวที่ป้อนส่วนลดเข้า
`computeVat()`** — ต้องยืนยันกับบัญชีว่าแต้มที่แลก (`pointsDiscount`) ควรลดฐาน VAT ด้วยหรือเป็นวิธีชำระ
เงิน สองคำตอบให้ตัวเลขที่ยื่นต่างกัน

## เฉพาะเครื่อง/โปรเจกต์นี้

- **drill-down เข้าร้าน** = cookie `BMS_ACT_TENANT` (signed, ผูก `admin.id`) override tenant ใน
  `app/api/graphql/route.ts` · platform admin = `users.is_platform_admin`
- **fake data (dev)** — `/admin/dev/fake` + `app/api/dev/fake/*` (ปิดใน production, gate ด้วย
  `requirePlatformAdminSeeder()`) · กดตามลำดับ **Products → Customers → Orders → Conversations →
  Purchase → BMS Members + Points** แล้วดู Dashboard/Reports/Inbox/Loyalty · Cleanup ลบเฉพาะร้านที่ยืนอยู่ (marker `FAKE-`/tag `fake`)
- **ops automation** — `.github/workflows/daily-log-triage.yml` + `scripts/bms-log-triage/*`
  (secrets: `BMS_LOG_DATABASE_URL` read-only, `ANTHROPIC_API_KEY`, `LINE_OPS_TOKEN`/`LINE_OPS_TO`)

## กับดักที่เจอซ้ำ (นอกเหนือจากที่อยู่ใน AGENTS.md)

1. **`Date` จาก `pg` ต้อง `.toISOString()` ก่อนคืนใน resolver ที่ field เป็น `String!`** — ไม่งั้น
   `GraphQLString.serialize` เรียก `.valueOf()` ได้ epoch number → frontend ได้ **Invalid Date**
   (ดู pattern `toISO()` ใน `bmsInbox.ts`/`bmsOrders.ts`)
2. **แก้ Permissions ต้อง drill-down เข้าร้านเป้าหมายก่อน** — `/admin/permissions` แก้ตาม
   `getTenantId(ctx)` = ร้านที่ยืนอยู่ ถ้าไม่ได้เข้าร้านจะแก้ผิดร้านโดยไม่มี error เตือน (ดู banner
   เหลืองก่อนกดบันทึกเสมอ)
3. **role dropdown ต้อง query `roles` จาก DB ห้าม hardcode** — เคยพลาดที่ `users/new/page.tsx`
   ทำให้ Manager/Sales/Warehouse หายจาก dropdown
4. **เลขไมเกรชันชนกันข้าม branch บ่อยมาก** — `ls db/migrations | sort -V | tail` ก่อนตั้งเลขเสมอ
   (เคยต้อง renumber `6.1`→`6.3`, `7.53`→`7.55`, `7.55`→`7.56`, และ `7.74`→`7.83`) · เช็คซ้ำได้ด้วย
   `ls db/migrations/*.sql | sed 's#.*/##' | grep -oE '^[0-9]+\.[0-9]+' | sort | uniq -d`
   (ควรได้ผลว่าง) — เคยหลุดมาแล้ว 2 ไฟล์ถือเลข `7.74` พร้อมกันโดยไม่มีใครรู้ ซึ่งอันตรายเพราะ repo นี้
   apply ด้วยมือตามเลข คนไล่ apply เห็น `7.74` ผ่านแล้วก็ข้ามไป `7.75` → อีกไฟล์ไม่เคยถูกรัน เงียบ ๆ
5. **`trg_generic_revision` เป็นชื่อฟังก์ชัน global** — `CREATE OR REPLACE` ทับของระบบเก่าได้ (เคยทำให้
   บันทึกโปรไฟล์/แก้ post พังทั้งระบบ) · **ห้ามเปิด revision ให้ตาราง `users`** เพราะ `to_jsonb(OLD)`
   จะ snapshot `password_hash` ลงตาราง revision
6. **เมนู sidebar ที่มี badge ต้องส่ง `collapsed` เสมอ** — ลืมแล้ว label ยุบเหลือ 0 ตอน sidebar ย่อ
   (hover ไม่เห็นตัวหนังสือ — เคยเกิดที่เมนู Users)
7. **JSX**: ห้ามวางคอมเมนต์ `/* ... */` เป็น child แรกทันทีหลัง `{cond && (` — parser งงกับ `"` ใน
   คอมเมนต์ (TS1109/TS1381) ให้ย้ายไปไว้เหนือบรรทัดนั้น
8. **seeder/สคริปต์ใหม่ต้องผูก `tenant_id` เอง** — ไม่มี default ให้ ถ้าลืม แถวที่สร้างจะไม่โผล่ในหน้า
   admin ที่กรองตาม tenant
9. **403 ไม่ทำให้ logout** — `apollo.ts` errorLink เตะออกเฉพาะ 401 · เพิ่ม permission ใหม่แล้วลืม seed
   ให้ role → หน้าโดน 403 เงียบ ๆ แต่ไม่เด้งออก

## ยืนยันรายการก่อนสร้างบิล (customer surface) — 2026-08-19

ไม่มี migration (ใช้ `ai_state` JSONB ที่มีอยู่) · verify กับ DB จริงแล้ว 5 เทส

- **`create_order` ครั้งแรกของตะกร้าไม่เขียนอะไรเลย** คืน `CONFIRMATION_REQUIRED` + รายการที่
  resolve แล้ว → pipeline ประกอบสรุป **ฝั่ง server** (`composeOrderQuoteSummary`) ไม่ใช่ให้โมเดลเขียน
  · เหตุผลที่ไม่ให้โมเดลเขียน: โมเดลตัดรายการทิ้งไม่ได้ **และ** output สั้นลง ถ้าให้โมเดลเขียนลิสต์เอง
  บิลยิ่งใหญ่ยิ่งชนเพดาน `max_tokens` = กลับหัวกับที่ควรเป็น
- **ธงยืนยันเป็น server-only ใน `ExecCtx`** (`customerConfirmedQuote`) ตั้งจาก pipeline เท่านั้น
  โดยดู `orderMemory.confirmed` (คำว่า ยืนยัน/สั่งเลย/ตกลง ในข้อความลูกค้า) คู่กับ
  `pendingQuoteFingerprint` ใน `ai_state` — โมเดลส่งค่านี้เองไม่ได้
- **ลายนิ้วมือครอบจำนวน + หน่วยขาย** (`orderQuoteFingerprint`, ไม่ขึ้นกับลำดับบรรทัด) เปลี่ยนจำนวน
  หรือแอบเพิ่มรายการหลังลูกค้ายืนยัน = ไม่ตรง → วนกลับไปถามใหม่ (มีเทสคุม)
- **ไม่มีออร์เดอร์ไหนหายจากกฎนี้** ครั้งแรกกลายเป็นคำถามยืนยัน ครั้งที่สองเดินเส้นทางเขียนเดิม
  · **staff surface ไม่ถูกแตะ** (แอดมินเห็นหน้าจอที่ตัวเองกรอกอยู่แล้ว)
- **สรุปไม่คิดยอดสุทธิ** แสดงราคาป้าย × จำนวน + กำกับว่า "ยังไม่รวมค่าส่ง/ส่วนลด/แต้ม" ยอดจริงยังมาจาก
  `orderCheckoutChatReply` หลังบิลถูกสร้าง — ห้ามคิดส่วนลด/โปร/แต้มซ้ำที่นี่ เพราะจะเป็นสูตรที่สองของเงิน
  แล้ว drift (กฎเดียวกับ `unitPriceForQty` ของ `8.1`)
- **ตัวอย่างที่บอทสอนลูกค้าเป็นสตริงคงที่** (`multiItemOrderExample`) ห้ามให้โมเดลแต่งสด — เคสจริง
  2026-08-19: โมเดลแต่งตัวอย่างที่ตัวเองรับไม่ได้ (ครอบ `**`, ไม่มีคำกริยา) ลูกค้าก็อปตามแล้วถูกปฏิเสธ
  · มีเทสป้อนตัวอย่างกลับเข้า `looksLikeRequestedItemList` เพื่อกันสองฝั่ง drift กันอีก
- **`stripMarkdownEmphasis` ตั้งใจไม่แตะ `*` ที่อยู่ระหว่างอักขระไม่ใช่ช่องว่าง** — "ผ้าก๊อซ 3*3 นิ้ว"
  คือขนาดสินค้า ตัดทิ้ง = เปลี่ยนสินค้าที่ลูกค้าขอ (มีเทสคุม ห้ามมาแก้ให้ strip ทั้งหมด)
- เทส: `scripts/order-confirmation-db-contract.test.mts` (5 เทส · เขียนจริงลงฐาน **ห้ามรันกับ
  production** · ลบข้อมูลตัวเองครบ) + `scripts/ai-eval/order-confirmation-contract.test.mts` (11 เทส
  ไม่ต้องมี DB) · ต้องลบ `bms_stock_movements` ก่อน `bms_products` ตอน teardown (FK composite)

## การเพิ่มโมดูลใหม่ (checklist)

1. migration `db/migrations/N.N__bms_<mod>.sql` — `tenant_id` + RLS policy (copy `4.2`) + GRANT
   `bms_app` (copy `4.3`)
2. service `lib/bms/<mod>.ts` — write ใช้ `getClient()` + `beginTenantTx()`; read ใช้ `query()` +
   `WHERE tenant_id`
3. GraphQL `graphql/bms<Mod>.ts` + wire `resolvers.ts`/`typeDefs.ts`; บังคับ `requirePermission()` +
   `audit()`
4. เพิ่ม permission ใน `BMS_PERMISSIONS` — **และ seed สิทธิ์ให้ role Manager/Sales/Warehouse ทุก
   tenant** (migration แบบ `5.7`) ไม่งั้นร้านจะโดน 403
5. REST routes (ถ้าต้องการ) + Admin page + เมนู (gate ด้วย `useBmsPermissions`) + เอกสาร

## ค้างอยู่จริงในเครื่องนี้

- ฟีเจอร์ที่ผ่านแค่ `tsc` ยังไม่เคย verify กับ DB จริง: Follow-up Automation (`7.52`),
  `email_report` (`7.54`), Cron run history (`7.55`), Manager staff management (`7.78`)
- **⚠️ AI usage accounting (`7.82`) ไม่ทำงานจริงบน BMS-LIVE — ยืนยันด้วยข้อมูลจริง 2026-08-19**
  `bms_ai_usage_events` ทุกแถวค้างที่ `status='started'` และ `input_tokens`/`output_tokens` เป็น NULL
  แถวเก่าที่เห็นเป็น `failed` มาจากตัวกวาด stale (`idx_bms_ai_usage_events_stale_started`) ไม่ใช่จากลูป
  · ต้นเหตุ: `finalizeAiUsageEvent` ห่อ try/catch แล้ว `return` เงียบ ๆ เหลือแค่ `console.error`
  · แก้แล้วให้แจ้ง `ai.usage_finalize_failed` (tier B) แต่ **ยังไม่รู้ว่า transaction ล้มเพราะอะไร**
    — ต้องดู log บนเซิร์ฟเวอร์จริง: `docker compose logs web | grep "failed to finalize AI usage event"`
  · **ผลข้างเคียงที่สำคัญ: quota/cost/รายงาน AI ทั้งชุดตาบอด และไล่ปัญหา AI ไม่มีข้อมูลตั้งต้น**
    (เสียเวลาสืบไป 1 รอบเต็มเพราะเชื่อ `output_tokens` ที่ไม่มีอยู่)
  · หลัง deploy ให้เช็กว่า `output_tokens` เริ่มไม่เป็น NULL ถ้ายังเป็น NULL = ต้นเหตุยังอยู่
- `/live-dashboard` ยังเป็น mock ทั้งหน้า (ต่อ query จริงแล้วต้องทบทวน `?demo=1` ด้วย)
- cron endpoint ทั้ง 7 ตัวมี workflow ยิงแล้ว (`.github/workflows/bms-cron.yml`) — **ค้างที่ต้องตั้ง
  secret `BMS_APP_BASE_URL` + `BMS_CRON_SECRET` ใน GitHub repo** ยังไม่ตั้ง = ยังไม่มีอะไรถูกยิงจริง
- `/admin/system-health` (ดู § System Health + request metrics ใน
  [docs/local-notes-archive.md](docs/local-notes-archive.md)) ยังไม่เคยเปิดดูจริงในเบราว์เซอร์ ·
  `pg_stat_statements` preload ไว้แล้วแต่ยังไม่ restart Postgres/`CREATE EXTENSION` เลยยังไม่มีการ์ด
  slow-query · REST route latency ยังไม่ instrument (มีแค่ GraphQL) · CPU/memory ตั้งใจไม่ทำเพราะต้องใช้
  Docker socket

## ก่อน production (สำคัญ)

- **migration ที่ยังไม่ได้ apply เข้า production (ณ 2026-08-13)**: `7.33` (product discovery
  indexes), `7.52` (follow-up automation), `7.54` (`report.email`), `7.55` (`bms_job_runs`),
  `7.56` (`users.language` CHECK), `7.78` (user management perms), `7.81` (default ภาษา = th),
  `7.82` (AI usage accounting) — **ตรวจกับ DB จริงก่อนเชื่อรายการนี้** · และ `5.6`/`5.7` ต้องมีก่อน
  (platform admin + operational perms; seed platform admin ชุดแรก = Administrator ของร้าน default)
- **`7.96__bms_membership_and_loyalty.sql` (สมาชิก + tier + แต้มสะสม + `bms_order_discounts`)
  apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production ·
  seed permission ใหม่ 4 ตัว (`member.view`, `member.manage`, `loyalty.adjust`, `loyalty.settings`)
  ให้ Manager/Sales/Cashier ถ้าไม่ apply หน้า `/admin/loyalty` จะโดน 403 เงียบ ๆ
  · cron: `.github/workflows/bms-cron.yml` ยิงให้แล้ว (frequent ทุก 15 นาที / daily 20:00 UTC)
    **แต่ต้องตั้ง secret `BMS_APP_BASE_URL` + `BMS_CRON_SECRET` ใน GitHub ก่อน** ไม่ตั้ง = ทุก job
    ข้ามตัวเองเงียบ ๆ (workflow ไม่แดง) แล้วแต้มไม่หมดอายุเหมือนเดิม · ดูว่ายิงจริงหรือยังที่
    `/admin/operations-schedule` (อ่านจาก `bms_job_runs`)
  · **เทส 2 ชุด — รันทั้งคู่ก่อน merge ทุกครั้งที่แตะ loyalty**

    ```bash
    # 1) เลขคณิตส่วนลด (13 เทส, ไม่ต้องมี DB — loyaltyMath.ts ตั้งใจไม่ import อะไรเลย)
    node --experimental-strip-types --test scripts/loyalty-contract.test.mts

    # 2) ledger + POS ครบ flow กับ Postgres จริง (22 + 10 เทส) — รันจาก apps/web เพราะ tsx อยู่ที่นั่น
    #    POSTGRES_HOST=localhost เพราะ .env.dev ชี้ host `postgres` (ชื่อใน docker network)
    #    --import shim: lib/mailer.ts มี `import "server-only"` ซึ่งมีแค่ตอน Next build
    #    --test-concurrency=1 บังคับ: สองชุดใช้ร้านแรกร่วมกัน รันขนานกันแล้วเหยียบกันเอง
    cd apps/web && POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
      POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' ../../.env.dev | cut -d= -f2-)" \
      REDIS_URL=redis://127.0.0.1:6379 \
      npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
        --test --test-concurrency=1 --test-force-exit \
        ../../scripts/loyalty-db-contract.test.mts \
        ../../scripts/pos-loyalty-db-contract.test.mts
    ```

    ชุดที่ 2 สร้าง/ลบข้อมูลของตัวเองครบ (รันซ้ำได้ ยืนยันแล้ว) แต่ **เขียนจริงลงฐาน — ห้ามรันกับ
    production** · มันตั้ง `bms_loyalty_settings` ของร้านแรกเป็นค่าที่เทสต้องใช้ (เปิดโปรแกรม,
    100 แต้ม = 10 บาท) แล้วไม่คืนค่าเดิม
  · **แต้มค้างเป็นหนี้สินทางบัญชี** — ก่อนปิดงบต้องส่งตัวเลขจาก `bmsLoyaltyOutstanding`
    (การ์ด "มูลค่าแต้มค้าง" ที่ `/admin/loyalty`) ให้บัญชี · `balanceMismatchCount` ต้องเป็น 0 เสมอ
  · fake data: กด **Customers → Orders → BMS Members + Points** ตามลำดับที่ `/admin/dev/fake`
    (ปุ่มสมาชิกยกลูกค้าปลอมที่มีอยู่ขึ้นเป็นสมาชิก ไม่สร้างใหม่ — ไม่มีลูกค้าปลอม = ไม่มีอะไรเกิด)
  · กับดักที่เจอตอน verify: `upsertMembershipTier` แปลง `code` เป็นตัวพิมพ์ใหญ่เสมอ ถ้าสคริปต์ไหน
    ลบชั้นทดสอบด้วย `LIKE 'ตัวเล็ก-%'` จะลบไม่โดน แล้วชั้นทดสอบที่ค้างอยู่จะไป **เปลี่ยนชั้นของ
    สมาชิกจริง** ในรอบทบทวนถัดไป (เจอมาแล้ว — สมาชิก 6 คนย้ายไปชั้นทดสอบ)
- **`7.97__bms_pos_park_cash_void.sql` (พักบิล + เงินเข้า-ออกลิ้นชัก + ยกเลิกบิล) apply เข้า dev DB
  แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission
  ใหม่ 3 ตัว (`pos.void`, `pos.cash.movement` → Manager · `pos.shift.report` → Manager/Sales/Cashier)
  ไม่ apply = ปุ่มใหม่ที่หน้า POS โดน 403 เงียบ ๆ
  · เทสชุดที่ 3 (13 เทส) รันแบบเดียวกับสองชุดเดิม เพิ่มไฟล์ท้ายคำสั่ง:
    `../../scripts/pos-shift-ops-db-contract.test.mts` — รวมสามชุด 45 เทส ผ่านทั้งหมด
  · **ส่วนลดมือ ยกเลิกบิล และเงินออกจากลิ้นชัก ต้องกด PIN คนที่สองทุกครั้ง** แม้คนขายจะมีสิทธิ์เอง
    (ตั้งใจ — การมีสิทธิ์กับการใช้สิทธิ์ต้องเป็นคนละการกระทำในหลักฐาน)
- **`7.98__bms_stock_transfers_and_counts.sql` (โอนย้ายระหว่างสาขา + นับสต็อก) apply เข้า dev DB
  แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission
  ใหม่ 3 ตัว (`inventory.transfer`, `inventory.count` → Manager/Warehouse ·
  `inventory.count.apply` → Manager เท่านั้น)
  · **apply ด้วย `psql -1`** — รอบแรกล้มกลางไฟล์เพราะ FK ผิด แล้วตารางค้างครึ่งเดียวใน DB
    (ต้อง DROP มือ) · `bms_products` มี PK `(tenant_id, sku)` FK จึงต้องเป็น composite
  · **`bms_locations.branch_code` default `'00000'` + unique `(tenant_id, branch_code)`** — สร้าง
    สาขาใหม่โดยไม่ตั้ง branch_code = ชนกับสำนักงานใหญ่ทันที (เจอตอนเขียนเทส) · **คอลัมน์นี้มาจาก
    `7.84__bms_locations.sql` ไม่ใช่ `7.98`** (เคยจดไว้ผิดที่ — แก้ 2026-08-18) กับดักมาโผล่ตอน
    ทำ `7.98` เพราะเพิ่งมีคนสร้างสาขาที่สองเป็นครั้งแรก
  · `7.98` แก้ตารางเดิมด้วย: drop/recreate `bms_stock_movements_type_check` เพื่อเพิ่ม
    `TRANSFER_IN`/`TRANSFER_OUT`/`COUNT_ADJUST`
  · เทสชุดที่ 4 (10 เทส): `../../scripts/inventory-multilocation-db-contract.test.mts`
    — รวมสี่ชุด 55 เทส ผ่านทั้งหมด
  · **หน้า UI: `/admin/stock-transfers` + `/admin/stock-counts`** (เมนูอยู่กลุ่มร้านค้า ถัดจาก
    Purchase (PO)) — ยังไม่เคยเปิดดูจริงในเบราว์เซอร์ ผ่านแค่ `tsc` · ทั้งสองหน้าเรียก REST
    ไม่ใช่ GraphQL (ตั้งใจ — เหตุผลอยู่ใน [docs/business/inventory.md](docs/business/inventory.md)
    § Why this module is REST) แปลว่า **AI tool catalogue มองไม่เห็นสองโมดูลนี้**
  · checklist ก่อน go-live ของ 7.98 อยู่ใน
    [docs/business/inventory.md § Go-live checklist (multi-branch, 7.98)](docs/business/inventory.md#go-live-checklist-multi-branch-798)
    (ไม่ได้อยู่ใน pos.md — ของ pos.md ครอบคลุมถึง `7.97` แล้วลิงก์ต่อมาที่นี่)
- **`vat_category` เขียนได้แล้ว (ไม่ต้อง migration — คอลัมน์มีตั้งแต่ `7.88`)** — ก่อนหน้านี้ไม่มีที่ไหน
  เขียนเลย ร้านที่จด VAT จึงติด blocker ที่ `/admin/pos-readiness` ตลอดโดยไม่มีปุ่มแก้ · ตอนนี้แก้รายตัวที่
  `/admin/products` และตั้งทีเดียวทั้งร้านที่ `/admin/pos-readiness` (mutation
  `bmsSetVatCategoryForUnknown` ใช้สิทธิ์ `tax.setting.manage`)
  · **กับดัก: ไม่ส่ง `vat_category` มาต้องคงค่าเดิม** — upsert ใช้ `COALESCE($14, bms_products.vat_category)`
    ห้ามเปลี่ยนไปใช้ `EXCLUDED` เด็ดขาด ไม่งั้น bulk import ล้างประเภทภาษีทั้งร้านเงียบ ๆ (มีเทสคุมไว้)
  · เทสชุดที่ 5 (7 เทส): `../../scripts/product-vat-category-db-contract.test.mts`
    — รวมห้าชุด 62 เทส ผ่านทั้งหมด · **ชุดนี้แก้สินค้าจริงของร้านแรกตอนทดสอบปุ่ม bulk แล้วคืนค่าให้ตอน
    teardown** (ปุ่มแก้ทั้งร้านตามดีไซน์) — ถ้า teardown ไม่ทำงาน สินค้าจริงจะค้างเป็น `V`
- **`7.99__bms_product_barcode_per_tenant.sql` (barcode unique ต่อร้าน ไม่ใช่ทั้งแพลตฟอร์ม) apply เข้า
  dev DB แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี
  permission ใหม่
  · **ต้นเหตุ**: `3.4` สร้าง `uq_bms_products_barcode` เป็น `UNIQUE (barcode)` เฉย ๆ (ยุคร้านเดียว)
    → สองร้านที่ขายสินค้าตัวเดียวกันบันทึก EAN-13 จริงได้แค่ร้านเดียว ร้านที่มาทีหลังเจอ duplicate key
    ของค่าที่มองไม่เห็น · `bms_product_packs` (`7.86`) ทำถูกอยู่แล้วที่ `(tenant_id, barcode)`
  · migration นี้ล้มไม่ได้ (index เดิมบังคับ unique ทั้งฐาน จึงไม่มีทางมีซ้ำค้าง) แต่ **ล็อกตาราง
    `bms_products` สั้น ๆ ตอน DROP/CREATE INDEX** — รันตอนไม่มีคนขายถ้าฐาน production ใหญ่
  · **ปุ่มสร้างบาร์โค้ด** = EAN-13 ช่วง 20–29 (GS1 กันไว้ให้ร้านใช้ภายใน) + check digit ถูก ·
    เดินลำดับ ไม่สุ่ม · **ปุ่มไม่เขียนฐาน** คืนเลขให้ฟอร์มแล้วผู้ใช้กดบันทึกเอง
  · **ยังไม่มีหน้าพิมพ์สติกเกอร์บาร์โค้ด** — เลขที่สร้างมาต้องมีทางพิมพ์แปะเองก่อนจะใช้จริง
  · เทส 2 ชุดใหม่: `scripts/barcode-contract.test.mts` (7 เทส ไม่ต้องมี DB) +
    `scripts/product-barcode-db-contract.test.mts` (7 เทส) — รวม pure 22 · DB 69 ผ่านทั้งหมด
- **`8.0__bms_pos_blind_close_and_no_sale.sql` (นับเงินปิดตา + เปิดลิ้นชักโดยไม่ขาย) apply เข้า dev DB
  แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission
  ใหม่ 1 ตัว (`pos.nosale` → Manager/Sales/Cashier)
  · **`pos_blind_close` DEFAULT TRUE = เปลี่ยนพฤติกรรมร้านที่มีอยู่ทันทีที่ apply** — ยอดเงินที่ควรมี
    จะหายไปจากสรุปกะระหว่างกะเปิด ร้านที่ไม่ต้องการปิดเองที่ `/admin/pos-readiness`
  · **กับดักตอนเขียนเทส**: เทสชุด `pos-shift-ops` ตรวจ "ยอดที่ควรมี" ตรง ๆ หลายตัว พอ default
    เป็น TRUE เลยพังทันที 5 ตัว — setup ต้องตั้ง `pos_blind_close = FALSE` เอง (แบบเดียวกับที่ตั้ง
    `cash_rounding = 'NONE'`) และเทสที่ตรวจตัวโหมดเองเปิด-ปิดเองในเทสนั้น
  · **เทสที่เพิ่มต้องอยู่ก่อนเทสปิดกะ** — ชุดนี้ปิดกะจริงที่เทสท้าย ๆ ถ้าแทรกทีหลังจะได้
    `SHIFT_NOT_OPEN` ทั้งหมด
  · ช่องรั่วที่ปิดไปด้วย: `recordCashMovement` เคยคืน `drawerAfter` = ยอดที่ควรมีตรง ๆ (นำเงินเข้า
    ฿1 แล้วอ่านคำตอบได้) · และปุ่ม "เปิดลิ้นชัก" เปล่า ๆ ที่แท็บตั้งค่าของหน้า POS
  · เทสชุดที่ 3 เพิ่มเป็น 15 เทส — รวม pure 27 · DB 71 ผ่านทั้งหมด
- **`8.1__bms_product_price_tiers.sql` (ราคาส่งตามจำนวน) apply เข้า dev DB แล้วและ verify กับ DB
  จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี permission ใหม่ (ใช้ `product.edit`)
  · **จำนวนนับรวมทั้งบิลต่อ SKU ไม่ใช่ต่อบรรทัด** — 60ml 5 ขวด + 150ml 5 ขวด = 10 ชิ้น
  · **บรรทัดที่ขายเป็น pack ไม่ถูกแตะ** ราคา pack ชนะเสมอ (แต่จำนวนยังนับรวม)
  · **`unitPriceForQty` ต้องเป็นตัวเดียวกันทั้งจอและ server** — `resolvePosScan` ส่งขั้นราคาไปให้จอ
    ถ้าสองฝั่งคิดต่างกันแม้สตางค์เดียว = `PAYMENT_MISMATCH` บิลถูกทิ้งหน้าลูกค้า
  · `price_tiers` ใน `upsertProduct`: ส่ง = แทนที่ทั้งชุด · ไม่ส่ง = ไม่แตะ (กฎเดียวกับ `vat_category`)
  · เทส 2 ชุดใหม่: `scripts/pricing-contract.test.mts` (8 เทส ไม่ต้องมี DB) +
    `scripts/price-tiers-db-contract.test.mts` (8 เทส) — รวม pure 35 · DB 79 ผ่านทั้งหมด
- **`8.2__bms_pos_blind_returns.sql` (คืนสินค้าไม่มีใบเสร็จ) apply เข้า dev DB แล้วและ verify กับ DB
  จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission ใหม่ 1 ตัว
  (`pos.return.noreceipt` → **Manager เท่านั้น**)
  · **เงินที่จ่ายคืนลงตาราง `bms_pos_cash_movements`** ไม่ใช่แหล่งเงินออกที่สอง — ยอดเงินที่ควรมี
    ตอนปิดกะมีสูตรเดียว ถ้าไม่เข้าสูตรนี้ ปิดกะจะเงินขาดเท่ายอดคืนทุกครั้งโดยอธิบายไม่ได้
  · เพดานราคาคืน = ราคาป้ายวันนี้ (ไม่มีบิลต้นทางให้ยึด) · เงินในลิ้นชักไม่พอ = ปฏิเสธ
  · **ไม่ออกใบลดหนี้** เพราะไม่มีใบกำกับต้นทางให้อ้าง — เป็นหลักฐานภายในให้บัญชี
  · รายงาน `pos-return-audit` นับแยกจากการคืนปกติ และเตือนทันทีที่มีแม้รายการเดียว
  · เทสชุดใหม่: `scripts/pos-blind-return-db-contract.test.mts` (8 เทส) — รวม DB 87 ผ่านทั้งหมด
- **`8.3__bms_product_serials.sql` (เลขเครื่อง/IMEI) + `8.4__grant_bms_app_read_users_roles.sql`
  apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production
- **⚠️ `8.4` คือการแก้บั๊ก production ของโค้ดที่ปล่อยไปแล้วตั้งแต่ `7.91` — apply ก่อนใครเพื่อนได้เลย**
  · `beginTenantTx` ทำ `SET LOCAL ROLE bms_app` ทุกครั้ง แต่ **`bms_app` ไม่มีสิทธิ์บน `users`
    และ `roles` เลย** (`(none)` ทั้งคู่)
  · `processPosReturn` → `cashierHasPermissionInTx` อ่าน `users JOIN roles` เมื่อยอดคืนถึงเกณฑ์
    ต้องมีผู้อนุมัติ (**ตั้งแต่ ฿500**) → `permission denied for table users` กลางการคืนของ
  · **แปลว่าการคืนสินค้ายอดตั้งแต่ ฿500 ล้มทุกครั้ง** ยอดต่ำกว่านั้นผ่านเพราะไม่เข้าเงื่อนไข
    — ไม่มีใครเจอเพราะเทสเก่าใช้บิลเล็กทั้งหมด (เจอตอนเขียนเทส `8.3` ด้วยบิล ฿2,000)
  · แก้ด้วย **GRANT ระดับคอลัมน์** บน `users` (ไม่รวม `password_hash`) + `GRANT SELECT ON roles`
  · เทสกันย้อนกลับ: `scripts/db-role-grants-db-contract.test.mts` (3 เทส · read-only รันกับ
    production ได้) — ตรวจทั้ง "อ่านคอลัมน์ที่ต้องใช้ได้", "`password_hash` ยังอ่านไม่ได้",
    "เขียน `users` ไม่ได้"
  · serial: เก็บตอนขาย ไม่ใช่ตอนรับเข้า · บังคับเฉพาะ POS (ออนไลน์บังคับไม่ได้ ตอนสั่งไม่มีใครรู้ว่า
    จะหยิบเครื่องไหน) · คืนทั้งบิลปลด serial ได้ · **คืนบางส่วนปลดไม่ได้** เพราะไม่รู้ว่าคืนเครื่องไหน
  · เทสชุดใหม่: `scripts/pos-serial-db-contract.test.mts` (9 เทส) — รวม DB 99 ผ่านทั้งหมด
- **`8.5__bms_commission_rules.sql` (ค่าคอมพนักงาน) apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว
  2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission ใหม่ 2 ตัว
  (`commission.view`, `commission.manage` → Manager)
  · **อัตราคอมมี `effective_from` เสมอ** — รายงานใช้กฎที่มีผล ณ วันที่ของบิล ไม่ใช่อัตราปัจจุบัน
    ถ้าใช้อัตราปัจจุบัน วันที่ร้านขึ้นอัตรา ยอดคอมของเดือนที่จ่ายไปแล้วจะเปลี่ยนย้อนหลังทั้งหมด
  · แก้อัตรา = เพิ่มแถวใหม่ ไม่ใช่ทับแถวเดิม (ทับได้เฉพาะกรณีวันเริ่มใช้เดียวกัน)
  · ลำดับความเจาะจง: `PRODUCT` > `CATEGORY` > `DEFAULT`
  · **ของที่ถูกคืนต้องหักคอมออก** และบิลที่ void ไม่นับเลย — ไม่ทำ = ขายแล้วให้ลูกค้าคืนวันถัดไป
    กลายเป็นวิธีปั๊มคอมฟรี · ส่วนลดทั้งบิลถูกเกลี่ยตามสัดส่วนรายการ
  · **กับดักที่เจอ (คนละตัวกับที่จดไว้ข้อ 1)**: `pg` คืน `DATE` เป็น `Date` ที่เที่ยงคืน "เวลาท้องถิ่น"
    → `.toISOString().slice(0,10)` **ถอยไป 1 วันในโซนไทย** · แก้ด้วยการ cast `::text` ใน SQL
    แล้วไม่ให้ค่าผ่าน JS `Date` เลย (มีเทสคุม) — อัตราที่เริ่มวันที่ 1 จะถูกใช้ตั้งแต่สิ้นเดือนก่อน
  · เทสชุดใหม่: `scripts/commission-db-contract.test.mts` (10 เทส) — รวม DB 109 ผ่านทั้งหมด
  · หน้า `/admin/commission` (เมนูใต้ Reports) — ยังไม่เคยเปิดดูจริงในเบราว์เซอร์
- **จอลูกค้า + ส่งใบเสร็จอีเมล/LINE (ไม่มี migration — ใช้ของที่มีอยู่แล้วทั้งหมด) verify กับ DB จริงแล้ว
  2026-08-18**
  · **จอลูกค้า `/pos/display` ใช้ `BroadcastChannel` ไม่ใช่ WebSocket** — จอที่สองคือหน้าต่างของ
    เบราว์เซอร์เดียวกันบนเครื่องเดียวกัน (ต่อ HDMI) ข้อความไม่วิ่งผ่านเซิร์ฟเวอร์ → เน็ตร้านหลุด
    ยอดบนจอลูกค้าไม่ค้าง · **ต้องเป็นเบราว์เซอร์เดียวกัน ใช้เครื่องอื่นไม่ได้**
  · **`bms_customers` ไม่มีคอลัมน์ `line_user_id`** — LINE id อยู่ที่ `bms_customer_identities`
    (`channel='line'`, `external_ref`) ตั้งแต่ `7.74` · ผมเขียนผิดรอบแรกแล้วเทสจับได้
    (เขียนผิดที่ = ลูกค้าที่ผูก LINE ไว้แล้วถูกบอกว่าไม่ได้ผูก)
  · ใบเสร็จอ่านตัวเลขจาก `bms_tax_documents` ที่ออกไปแล้วเท่านั้น ห้ามคิด `total × 7/107` ใหม่
    (บิลที่มีสินค้ายกเว้น VAT ปนจะได้เลขไม่ตรงกับที่ยื่นสรรพากร)
  · อีเมลที่พนักงานพิมพ์หน้าเคาน์เตอร์ **ไม่ถูกบันทึกกลับเข้าโปรไฟล์ลูกค้า** โดยตั้งใจ
  · เทสชุดใหม่: `scripts/receipt-delivery-db-contract.test.mts` (7 เทส) — **ไม่ทดสอบการส่งจริง**
    (ไม่มี mail provider/LINE token ในเทส) ตรวจการประกอบใบเสร็จ + การหาผู้รับ + การปฏิเสธที่อ่านรู้เรื่อง
    — รวม DB 116 ผ่านทั้งหมด
- **`8.6__bms_order_extra_lines.sql` (ค่าถุง/ค่าบริการ ที่ไม่ใช่สินค้าในคลัง) apply เข้า dev DB แล้วและ
  verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี permission ใหม่
  (ใช้ `pos.sell`)
  · **ตารางแยก ไม่ได้แตะ `bms_order_items`** — ตารางนั้นมี `UNIQUE (order_id, product_sku, size)`
    + FK ไป `bms_products` + FK ไป `bms_inventory` ซึ่งขัดกับรายการแบบนี้ทั้งสามข้อ · การคลายทั้งสาม
    คือทำให้ตารางที่ทุกช่องทางใช้ร่วมกันหลวมลงเพื่อรองรับของที่ไม่ใช่สินค้า ไม่คุ้มความเสี่ยง
  · **⚠️ ค่าบริการอยู่ในฐาน VAT** — `loadOrderLinesInTx` ใน `taxDocuments.ts` ต้อง UNION ตารางนี้เข้ามา
    ถ้าลืม ใบกำกับจะแสดงฐานน้อยกว่าเงินที่รับจริง = ยื่นภาษีต่ำกว่าความจริงเท่าค่าบริการทั้งหมด
    ที่เคยเก็บ (มีเทสคุม)
  · บวกเข้ายอด **ก่อน** คิดส่วนลด เพราะส่วนลด % คิดบนยอดที่ลูกค้าจ่ายจริง
  · เทสชุดใหม่: `scripts/order-extra-lines-db-contract.test.mts` (7 เทส) — รวม DB 123 ผ่านทั้งหมด
- **`8.7__bms_product_promotions.sql` (ซื้อ X แถม Y / N ชิ้นราคาเดียว) apply เข้า dev DB แล้วและ
  verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี permission ใหม่
  · **โปรไม่ใช่ส่วนลดชั้นที่ 5** — เป็นกลไกราคาต่อบรรทัดแบบเดียวกับ `8.1` จึง **ไม่อยู่ใต้เพดาน
    `max_discount_pct`** · ถ้าทำเป็นชั้นส่วนลด โปรที่ร้านประกาศไว้จะถูกตัดเมื่อบิลชนเพดาน
    = ร้านผิดคำพูดกับลูกค้าเพราะกฎภายในตัวเอง อธิบายที่เคาน์เตอร์ไม่ได้
  · **คิดครั้งเดียวต่อ SKU ต่อบิล** จากจำนวนรวมทุกไซซ์ — คิดต่อบรรทัดจะพลาดโปร (สองบรรทัดละ 2 ชิ้น
    ไม่ครบชุด) หรือเก็บเงินซ้ำสองเท่า (มีเทสคุมทั้งสองแบบ)
  · **โปรที่แพงกว่าซื้อแยกไม่ถูกบังคับใช้** — ร้านลดราคาปกติลงต่ำกว่าราคาชุด หรือมีโปรค้าง
    เป็นเรื่องเกิดจริง · เลือกยอดที่ต่ำกว่าเสมอ
  · `uq_bms_promotions_active_sku` (partial unique) = สินค้าหนึ่งตัวมีโปร active ได้ทีละหนึ่ง
  · **ยังไม่รองรับ "ซื้อ A แถม B" ข้ามสินค้า**
  · เทสชุดใหม่: `scripts/promotions-db-contract.test.mts` (8 เทส) + เพิ่มใน
    `pricing-contract.test.mts` (5 เทส) — รวม pure 40 · DB 131 ผ่านทั้งหมด
- **`8.8__bms_product_bundles.sql` (สินค้าชุด + view `bms_order_stock_lines`) apply เข้า dev DB แล้วและ
  verify กับ DB จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี permission ใหม่
  · **⚠️ ทุกที่ที่ขยับสต็อกต้องอ่านจาก view `bms_order_stock_lines` ไม่ใช่ `bms_order_items`** —
    มี 4 จุด (ตัดสต็อกตอนจบบิล · คืนของ · ปล่อย reserved · ตัดล็อต FEFO) ถ้าเพิ่มจุดใหม่ต้องใช้ view
  · เซ็ตมีแถว `bms_inventory` ของตัวเองค้างที่ **0 ตลอด** (FK ของ order_items บังคับ) และ
    `createOrder` สร้างให้เองตอนขายครั้งแรก · การอ่านตารางตรง ๆ จะลดสต็อกเซ็ตให้ติดลบแล้วชน
    `CHECK (current_stock >= 0)` กลางการปิดบิล
  · view มี `order_item_id` เพราะการตัดล็อต FEFO ต้องผูกล็อตกลับไปที่บรรทัดที่ขาย
  · **`CREATE OR REPLACE VIEW` เปลี่ยน "ชื่อ" คอลัมน์ไม่ได้** ต้อง `DROP VIEW` ก่อน (เจอตอน apply)
  · เซ็ตที่ไม่มีส่วนประกอบ = `BUNDLE_INCOMPLETE` ขายไม่ได้ · ส่วนประกอบขาด = error บอกชื่อ
    **ส่วนประกอบ** ไม่ใช่ "เซ็ตหมด"
  · **บาร์โค้ดเครื่องชั่ง: แกะได้แล้ว (`parseScaleBarcode`) แต่ยังไม่ต่อเข้าเส้นทางขาย** — การขาย
    ของชั่งต้องให้ server คิดราคาจากบาร์โค้ดใหม่ตอน commit ไม่ใช่เชื่อราคาจากจอ (ขัด invariant
    ของ POS ทั้งระบบ) · prefix: `20` = เลขที่ร้านสร้าง · `21` = ฝังราคา(สตางค์) · `22` = ฝังน้ำหนัก(กรัม)
  · เทสชุดใหม่: `scripts/bundles-db-contract.test.mts` (7 เทส · รันซ้ำได้ ยืนยัน 2 รอบ) +
    เพิ่มใน `barcode-contract.test.mts` (5 เทส) — รวม pure 45 · DB 138 ผ่านทั้งหมด
- **`8.9__bms_store_credit.sql` (บัตรของขวัญ + เครดิตร้าน) apply เข้า dev DB แล้วและ verify กับ DB
  จริงแล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission ใหม่ 3 ตัว
  (`storecredit.issue`, `storecredit.adjust` → Manager · `storecredit.redeem` → Manager/Sales/Cashier)
  · **เพิ่ม `STORE_CREDIT` ใน CHECK ของ `bms_payments.method` และ
    `bms_pos_refund_allocations.method` ทั้งสองที่** — ลืมที่สองคือคืนเป็นเครดิตไม่ได้
  · **เครดิตติดลบไม่ได้** (ต่างจากแต้มที่ยอมให้ติดลบโดยตั้งใจ) — บังคับด้วย CHECK ที่ตาราง
  · **`STORE_CREDIT` ไม่ใช่เงินสด** ต้องไม่เข้าสูตรเงินในลิ้นชัก/ปิดกะ (ร้านรับเงินไปแล้วตอนขายบัตร)
  · หักเครดิตอยู่ในทรานแซกชันที่ปิดการขาย + `FOR UPDATE` บนแถวบัตร (บัตรใบเดียวยิงสองเครื่อง
    พร้อมกันได้) · ตรวจบัตรก่อนเรียก `createOrder` เพื่อให้ล้มก่อนตัดสต็อก
  · **กับดักที่เทสจับได้ 2 อย่าง**:
    1. การคืนของทาง POS ใช้ `processPosReturn` **ไม่ผ่าน `cancelOrder`** — ต้องมี hook ของตัวเอง
       ไม่งั้นลูกค้าที่จ่ายด้วยบัตรแล้วคืนของ เสียเงินบนบัตรไปเปล่า ๆ
    2. `UNIQUE (tenant_id, credit_id, order_id, kind)` ก้อนเดียว **ผิด** — คืนบางส่วนเกิดหลายครั้ง
       ต่อบิล ก้อนเดียวยอมให้คืนได้ครั้งแรกเท่านั้น · แยกเป็น partial unique 3 ตัว
       (REDEEM keyed by order · REVERSE-cancel keyed by order · REVERSE-return keyed by pos_return_id)
  · **`ON CONFLICT ON CONSTRAINT` ใช้กับ unique *index* ไม่ได้** ต้องใช้ `ON CONFLICT (cols) WHERE ...`
  · โค้ดบัตรสุ่มจาก `crypto.getRandomValues` ไม่ใช่ running number (บัตรเรียงเลข = ซื้อใบเดียวเดาใบอื่นได้)
    · ตัด `I O 0 1` ออกให้อ่านทางโทรศัพท์ได้
  · **ยอดเครดิตค้าง = หนี้สินในงบดุล** ส่งตัวเลขจาก `getStoreCreditOutstanding()` ให้บัญชีก่อนปิดงบ
    · `balanceMismatchCount` ต้องเป็น 0 เสมอ
  · เทสชุดใหม่: `scripts/store-credit-db-contract.test.mts` (11 เทส)
- **`9.0__bms_pos_deposits.sql` (มัดจำ/ค้างชำระ) apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว
  2026-08-18** — ยังไม่ได้ apply เข้า production · seed permission ใหม่ 2 ตัว
  (`pos.deposit.take` → Manager/Sales/Cashier · `pos.deposit.cancel` → Manager)
  · **กฎ "ยอดชำระต้องตรงเป๊ะ" ของ POS ไม่ได้ถูกคลาย** — มัดจำเป็นบิลอีกชนิด: ของถูกจอง
    (reserved) บิลค้างที่ `PENDING` แล้วตอนลูกค้ามารับของจึงเดินเส้นทางปิดการขายเดิมทั้งเส้น
  · **ใบกำกับออกตอนรับของ ไม่ใช่ตอนวางมัดจำ** (ตรงกับจุดที่กรรมสิทธิ์โอน)
  · **การขายเป็นของกะที่รับของ** — `settleDepositSale` ประทับ `pos_device_id/pos_shift_id/
    cashier_user_id` ใหม่ ยอดขายและค่าคอมจึงไปที่คนส่งของจริง
  · **กับดัก 3 อย่างที่เจอตอนต่อกับ `finalizePosSale`**:
    1. ล็อกบิลด้วย เครื่อง/กะ/คนขาย → บิลมัดจำที่สร้างไว้ตอนอื่นไม่ผ่าน (แก้ด้วยการประทับใหม่)
    2. ตรวจ `total_amount` เทียบกับ `amountDue` → ต้องส่ง **ยอดเต็ม** ไม่ใช่ยอดคงเหลือ
    3. ปฏิเสธบิลค้างที่มี payment เดิม → เปลี่ยนเป็นรับ `alreadyPaid` แล้วตรวจว่า "ต้องมีเท่านี้พอดี"
       (ยังจับรายการที่เกินมาได้เหมือนเดิม) · และ `FOR UPDATE` อยู่กับ aggregate ไม่ได้
  · **ปิดมัดจำไม่คืนเงินให้เอง** — คืนหรือยึดเป็นข้อตกลงร้านกับลูกค้า ระบบบันทึกการตัดสินใจ
  · ของที่จองค้างมีวันครบกำหนด + ธง `overdue` — ไม่มีสองอย่างนี้ ร้านจะมีสต็อกที่ "มีอยู่แต่ขายไม่ได้"
    เพิ่มขึ้นเรื่อย ๆ
  · เทสชุดใหม่: `scripts/deposits-db-contract.test.mts` (9 เทส) — **รวมทั้งหมด pure 45 · DB 158**
- **`9.1__bms_location_manage_permission.sql` (สิทธิ์ `location.manage` — สร้าง/แก้สาขาจากแอปได้แล้ว)
  apply เข้า dev DB แล้ว 2026-08-18** — ยังไม่ได้ apply เข้า production · ไม่มี schema เปลี่ยน
  (ตาราง `bms_locations` มีมาตั้งแต่ `7.84`) แค่เพิ่ม permission ใหม่ 1 ตัวให้ Manager
  · **ก่อนหน้านี้ตาราง `bms_locations` มีมาตั้งแต่ 7.84 แต่ไม่มีทาง "สร้างสาขาใหม่" จากแอปเลยสักจุด**
    มีแต่ query อ่าน (`bmsLocations`) ไปประกอบ dropdown ที่อื่น หน้า `/admin/locations` (เมนูใหม่ในกลุ่ม
    ร้านค้า ก่อน Stock Transfers) + mutation `bmsUpsertLocation` คือทางแรกที่ทำได้จริง
  · **สาขาที่สร้างผ่านหน้านี้ตั้งเป็น `is_head_office = FALSE` เสมอ ห้ามแก้** — คอลัมน์นี้ default
    เป็น `TRUE` ในตาราง (ออกแบบไว้ตอนร้านมีสาขาเดียว) ถ้าไม่บังคับ FALSE ในโค้ด สาขาที่สองจะกลายเป็น
    สำนักงานใหญ่คู่ขนานไปด้วยเงียบ ๆ — สำนักงานใหญ่จริงมีอยู่แล้วจาก seed ตอน 7.84 หน้านี้ไม่มีทาง
    เปลี่ยนธงนั้นได้เลย (ต้องแก้ตรง DB เท่านั้น)
  · **`branch_code = '00000'` สงวนไว้ให้สำนักงานใหญ่** — `upsertLocation` ปฏิเสธค่านี้ตอนสร้างใหม่
    ก่อนถึงชั้น DB (กับดักเดิมที่จดไว้ใน `7.98` ข้างบน ตอนนี้กันไว้ที่ชั้นแอปแล้วไม่ต้องพึ่ง unique
    index อย่างเดียว)
  · รหัสสาขา (`code`) แก้ไม่ได้หลังสร้าง เหมือน `bmsUpsertPosDevice` — ฟอร์ม disable ช่องนี้ตอนแก้ไข
    เพราะ mutation ใช้ `ON CONFLICT (tenant_id, code)` จับคู่แถวเดิม เปลี่ยน code กลางทาง = สร้างแถวใหม่
  · **สาขาใหม่เริ่มด้วยสต็อกว่าง** — ต้องโอนย้ายเข้าไปเองผ่าน `/admin/stock-transfers` (7.98) การตัดสต็อก
    ข้ามสาขาต่อเข้ากับของจริงแล้วตั้งแต่ 7.98 ไม่ต้องแก้อะไรเพิ่มฝั่งนั้น — ดู checklist ที่
    [docs/business/inventory.md § Go-live checklist (multi-branch, 7.98)](docs/business/inventory.md#go-live-checklist-multi-branch-798)
    ก่อนเปิดสาขาที่สองของร้านไหนก็ตาม
  · verify แล้ว: สร้าง/แก้/reject รหัสซ้ำ/reject `00000`/permission gate (Manager ผ่าน, Sales ไม่ผ่าน)/
    audit log เขียนถูกต้อง — ยังไม่ได้เขียนเป็นเทสอัตโนมัติ (verify มือผ่าน service function ตรง ๆ)
- **`9.5__bms_pos_cash_movement_idempotency.sql` (idempotency key ให้เงินเข้า/ออกลิ้นชักแบบเดี่ยว)
  เขียนแล้วบน branch `codex/fix-pos-recheck-findings` (2026-08-20) — ⚠️ **ยังไม่ได้ apply เข้า dev DB
  หรือรันเทสจริงในรอบนี้** (เครื่องที่แก้ไม่มี Postgres/`.env.dev` ต่ออยู่) ต้อง apply +
  รัน `scripts/pos-shift-ops-db-contract.test.mts` ให้ผ่านก่อนเชื่อว่าใช้ได้จริง ก่อน apply เข้า
  production ตามปกติ
  · **ต้นเหตุ**: `recordCashMovement()` ไม่มี idempotency key เลย ต่างจากการขาย/คืน/มัดจำที่มีมาตั้งแต่
    ต้น — กดปุ่มซ้ำเพราะเน็ตช้าบันทึกเงินเข้า/ออกซ้ำสองรอบ สูตร "ยอดที่ควรมีในลิ้นชัก" จึงผิดโดยไม่มีใคร
    รู้จนนับปิดกะไม่ตรง · แก้ด้วยคอลัมน์ `idempotency_key` + unique index ต่อร้าน (คู่กับ path เดิมที่มี
    `bms_pos_deposits`/`bms_pos_blind_returns` ทำไว้แล้ว) แคชเชียร์ฝั่ง POS UI (`app/(pos)/pos/page.tsx`)
    สร้าง UUID ใหม่ต่อการกดหนึ่งครั้ง ไม่ใช่ต่อ signature ของคำขอ
  · **แก้ร่วมในคอมมิตเดียวกัน (recheck findings อื่นที่ไม่ต้อง migration ใหม่)**:
    1. เลขเครื่อง (`8.3`) เดิมตรวจซ้ำแค่ในบรรทัดเดียว ตอนนี้ตรวจซ้ำทั้งบิล (สอง SKU/บรรทัดยิง serial
       เดียวกันจับได้) และจำนวนที่ต้องมีอ่านจาก pack/base_qty ในฐานข้อมูลเสมอ ไม่เชื่อ `baseQty` ที่
       browser ส่งมา (ปลอมเป็น 1 เพื่อข้าม `SERIAL_REQUIRED` ได้เดิม)
    2. เขียน serial `SOLD` ในทรานแซกชันขายเปลี่ยนจาก `ON CONFLICT DO UPDATE` เฉย ๆ เป็นมีเงื่อนไข
       `WHERE status = 'RETURNED'` — สอง request ที่แข่งกันขาย serial เดียวกันพร้อมกันเคยผ่านทั้งคู่
       ได้ (precheck เห็นว่าง) ตอนนี้ผู้แพ้ได้ `SERIAL_ALREADY_SOLD` แล้ว `recordPosSale` ยกเลิกบิลที่จอง
       สต็อกไว้แทนทิ้งค้าง
    3. `settleDepositSale` (บิลมัดจำ) ไม่เคยตรวจ serial เลย — ปิดมัดจำสินค้าบังคับเลขเครื่องได้โดยไม่มี
       serial บันทึก ตอนนี้อ่านจำนวนที่ต้องมีจาก order item ของบิลจองเองก่อนอนุญาตให้ settle
    4. รายงานกะ (`getPosShiftReport`) 3 บั๊ก: (ก) ไม่ scope ตาม device — เครื่องอื่นที่รู้ shift UUID
       อ่านรายงานเครื่องอื่นในร้านเดียวกันได้ (ข) ยอดขาย/จำนวนบิลรวมทุก status แล้วหักลบ void ทีหลัง
       ทำให้บิล `PENDING`/`CANCELLED` ที่ผูก shift เดียวกันหลุดเข้ายอดขาย (ค) การคืนที่ refund แบบ
       split (เงินสด+บัตร) ถูกนับซ้ำตามจำนวนแถว allocation เพราะ JOIN ตรงเข้ากับ aggregate
    5. `parsePosExtraLines`/`createOrder` extra line (`8.6`) เดิม clamp qty เพี้ยน (`0`, ลบ, ทศนิยม)
       ขึ้นเป็น 1 เงียบ ๆ ตอนนี้ทิ้งแถวนั้นแทนเหมือนแถวไม่มี label/amount
    6. `setCashierPin`/`clearCashierPin`/`setCashierAccountMode` ย้าย audit log จาก GraphQL resolver
       (หลัง commit) เข้าไปเขียนในทรานแซกชันเดียวกับการเขียน `users` ตรงกับกฎ "audit ต้องอยู่ใน
       transaction เดียวกับการเขียนที่สำคัญ" ใน [CLAUDE.md](CLAUDE.md)
  · เทสที่แก้/เพิ่มคู่กัน: `scripts/pos-contract.test.mts`, `scripts/pos-serial-db-contract.test.mts`,
    `scripts/pos-shift-ops-db-contract.test.mts`, `scripts/pos-blind-return-db-contract.test.mts` —
    **ยังไม่ได้รันจริงในรอบนี้ ต้องรันตามคำสั่งชุดเดียวกับ loyalty/pos ข้างบนก่อน merge**
- **`9.6__bms_pos_scan_manager_and_purchase_receipts.sql` (คีย์ครุภัณฑ์สแกนเนอร์ไร้สาย +
  รับของ PO จากหน้าเคาน์เตอร์แบบ retry-safe) เขียนแล้วบน branch `codex/pos-scan-manager`
  (2026-08-20) — เทส pure (`scripts/pos-scan-manager-contract.test.mts`, 6 เทส) รันผ่านแล้ว
  แต่ **⚠️ เทส DB (`scripts/pos-scan-manager-db-contract.test.mts`, 7 เทส) ยังไม่ได้รันจริงในรอบนี้**
  (เครื่องที่แก้ไม่มี Postgres/`.env.dev` ต่ออยู่) ต้อง apply migration เข้า dev DB + รันเทสชุดนี้ให้ผ่าน
  ก่อนเชื่อว่าใช้ได้จริง ก่อน apply เข้า production ตามปกติ
  · **ต้นเหตุ**: เครื่องสแกน Bluetooth HID เป็นคีย์บอร์ดสำหรับเบราว์เซอร์ หน้า POS เดิมเดา
    "นี่คือการสแกน" จาก field ที่ focus อยู่/ความเร็วในการพิมพ์ ซึ่งไม่ใช่หลักฐานจริง (โฟกัสหลุดหรือ
    scanner พิมพ์ช้าเท่าคนพิมพ์ก็เดาผิดได้) — เพิ่มโหมด `PREFIX` ที่ต้องโปรแกรมสแกนเนอร์จริงให้ส่งคีย์
    ฟังก์ชัน (`F1`–`F24`, ปกติ `F9`) นำหน้าก่อน payload แล้วเบราว์เซอร์ถึงจะ capture คีย์ทั้งหมดแบบ
    global ไปจนถึง suffix (`Enter`/`Tab`) ปฏิเสธ prefix ที่เป็นตัวอักษรพิมพ์ได้เพื่อกันการพิมพ์ปกติ
    มาติดอาวุธโหมด global โดยไม่ตั้งใจ · โหมด `FOCUS` (default) คงพฤติกรรมเดิมไว้ให้ร้านที่ยังไม่ตั้งค่า
    สแกนเนอร์
  · **scan context เป็นตัวกำหนดเส้นทาง ไม่ใช่ DOM focus** — คิว payload เดียวกันจากกล้อง/สแกนเนอร์/พิมพ์มือ
    ถูก route ตามสถานะหน้าจอที่ระบุชัดเจน (Sell เติมตะกร้า, ค้นสินค้าอ่านอย่างเดียวไม่เติม, Returns ค้นบิล/
    เติมรายการคืนแบบไม่มีใบเสร็จเฉพาะตอนเปิดโหมดนั้น, Receive เติม draft ของ PO ที่เลือกอยู่) · Shift/
    Settings/overlay ที่มีความอ่อนไหว/กำลังเขียนอยู่/บิลที่ยังไม่จบ ปิดการสแกนทั้งหมด
  · **รับของ PO จากเคาน์เตอร์เป็นชั้นบาง ๆ ทับ service เดิม ไม่ใช่เส้นทางใหม่** — สแกนสร้างแค่ draft
    ไม่ขยับสต็อกจนกว่าจะกดยืนยันชัดเจนหนึ่งครั้ง ตอนยืนยัน route ตรวจ PIN + `purchase.receive` ซ้ำ
    (device token ไม่ใช่ user) ดึง tenant/location จากอุปกรณ์ที่ authenticate ไว้เท่านั้น (**ห้ามรับค่า
    location จาก client**) แล้วเรียก `receivePurchaseOrder()` ตัวเดียวกับที่ admin ใช้ — inventory, lot,
    movement, สถานะ PO, audit, และแถว `bms_pos_purchase_receipts.result` (retry ledger) อยู่ใน
    ทรานแซกชันเดียวกันทั้งหมด · คีย์เดิมกับ input ที่ normalize แล้วตรงกัน = replay ผลเดิม, คีย์เดิมกับ
    input ต่างกัน = `409` (กันเอา key เก่ามาสวมรับของอย่างอื่น)
  · เทส: `scripts/pos-scan-manager-contract.test.mts` (6 เทส, pure) + จุด DB ที่ยังไม่ verify:
    device-scoped listing, PIN/permission re-check, idempotency replay vs conflict, และ
    tenant/location isolation ของ `bms_pos_purchase_receipts`
- **ใครจองของอยู่ (drill-down ที่คอลัมน์ จอง ของ `/admin/products`) — ไม่มี migration verify กับ DB จริงแล้ว
  2026-08-24** · query ใหม่ `bmsVariantReservations` gate ด้วย **`order.view` ไม่ใช่ `product.view`**
  (คำตอบมีเลขบิล ชื่อ+เบอร์ลูกค้า) — role ที่ดูแลแค่แคตาล็อกจะไม่เห็นปุ่ม ไม่ต้อง seed permission ใหม่
  · **ต้องอ่านจาก view `bms_order_stock_lines` เท่านั้น** เพราะเซ็ตจองที่ส่วนประกอบ (8.8) ถ้าเผลอไปอ่าน
    `bms_order_items` บิลที่ซื้อเซ็ตจะหายไปจากรายการของส่วนประกอบทั้งที่ยังถือของอยู่ (มีเทสคุม)
  · **ยอด "อธิบายไม่ได้" (`unattributed`) ต้องแสดงเสมอ ห้ามปัดทิ้ง** — `/api/bms/reserve` จองได้โดยไม่ผูกบิล
    และ **route นั้นไม่กรอง `tenant_id` เลย** (`reserveStock()` ใน `lib/bms/stock.ts` ยิงข้ามร้านได้ถ้ารู้
    SKU+size) ยังไม่ได้แก้ — ตัวเลขนี้คือทางเดียวที่ร้านจะเห็นว่ามีของถูกล็อกโดยไม่มีเจ้าของ
  · ยอดรวมคิดจากทุกบิล แต่รายการตัดที่ 200 บิล (`RESERVATION_LIST_LIMIT`) และหน้าจอบอกเมื่อตัด
  · **`viaBundleSkus` เป็นลิสต์ไม่ใช่ค่าเดียว** — บิลเดียวถือส่วนประกอบตัวเดียวกันผ่านสองเซ็ตได้
    (ร้านจัดกระเช้าหลายแบบจากของชิ้นเดิม) บอกเซ็ตแรกเซ็ตเดียว = พนักงานหาของไม่เจออีกครึ่ง
  · **query นี้พึ่ง migration `8.8`/`9.3` (view), `7.84` (`bms_locations`) และ `9.0` (`bms_pos_deposits`)**
    — ฐานที่ยังไม่ apply จะได้ error ที่หน้าจอ (ตั้งใจ ไม่กลืน) ตามสไตล์ repo นี้ที่ไม่มี schema probe
    ที่ไหนเลย · ถ้าลูกค้ารายไหนยังไม่มี POS ให้ apply ชุดนั้นก่อนเปิดใช้ปุ่มนี้
  · **index ที่ query ใช้มีอยู่แล้ว ไม่ต้องเพิ่ม** — ยืนยันด้วย `EXPLAIN`:
    `idx_bms_order_items_tenant_sku_order` ใช้ทั้งสองสาขาของ view (สาขาเซ็ตวิ่งจาก
    `idx_bms_bundle_items_component` เข้า order_items ด้วย bundle_sku)
  · เทสชุดใหม่: `scripts/variant-reservations-db-contract.test.mts` (12 เทส · รันซ้ำได้ ยืนยัน 2 รอบ ·
    เขียนจริงลงฐาน **ห้ามรันกับ production**) — teardown ต้องลบที่อยู่ปลอม (`label = 'FAKE resv-test'`)
    ด้วย เพราะเทส `shipOrder` ต้องมีที่อยู่จัดส่งไม่งั้น shipOrder คืน false เงียบ ๆ
- **⚠️ `/api/bms/reserve` + `reserveStock()` เคยจองสต็อกข้ามร้านได้โดยไม่ต้องล็อกอิน — แก้แล้ว
  2026-08-24 (ไม่มี migration)**
  · **ต้นเหตุ 3 ชั้นซ้อนกัน**: (ก) `reserveStock()` กรองแค่ `product_sku` + `size` **ไม่มี `tenant_id`
    และไม่มี `location_id`** → `UPDATE` โดนทุกแถวที่ตรง = ทุกร้าน/ทุกสาขาที่ขาย SKU นั้น
    (ยืนยันกับ dev DB: `NIKE-AIR/XL` มีอยู่ 2 ร้าน) (ข) `middleware.ts` กันแค่ `/admin/**` — `/api/**`
    ที่ไม่ใช่ /admin ผ่านฟรี route นี้จึงเปิดโล่ง (ค) ไม่เคยเขียน `bms_stock_movements` เลย ผิดกฎ
    ของโมดูลเองที่ว่า "ทุกการขยับสต็อกต้องมี movement" → ของที่ขายไม่ได้ไม่มีร่องรอยว่าใครกันไว้
  · **แก้เป็น**: `reserveStock({tenantId, sku, size, qty, locationId?, note?, actor?})` ทำใน
    `beginTenantTx` + เขียน movement `RESERVE` ในทรานแซกชันเดียวกัน · route เรียก
    `authorizeAdminRoute("stock.adjust")` และ **tenant มาจาก session/คุกกี้ drill-down เท่านั้น
    ห้ามรับจาก body** (สาขารับจาก body ได้ ถ้าเป็นสาขาคนละร้านจะได้ `NOT_FOUND` เพราะไม่มีแถว)
  · ยืนยันจริง: ยิงแบบไม่ล็อกอินได้ `401` และ `reserved_stock` ของทั้งสองร้านยังเป็น 0
  · เทส 2 ชุดใหม่:
    - `scripts/inventory-tenant-scope-contract.test.mts` (2 เทส ไม่ต้องมี DB) — สแกนทุก statement ที่
      แตะ `bms_inventory`/`bms_product_price_tiers`/`bms_product_packs` ว่ามี `tenant_id` ครบ
      (ก่อนแก้: 16 statement มี 1 ตัวที่ไม่มี = ตัวนี้) + เช็คว่า route ไม่รับ tenant จาก body ·
      ยืนยันแล้วว่า **แดงจริง** เมื่อใส่ statement ที่ลืม tenant กลับเข้าไป
    - `scripts/reserve-stock-db-contract.test.mts` (9 เทส · สร้างสาขาที่สองของตัวเองแล้วลบทิ้ง
      **ห้ามรันกับ production**) — ครอบข้ามร้าน/ข้ามสาขา/ยืม location ของร้านอื่น/ledger/ROLLBACK
  · **แก้ต่อจนจบแล้ว 2026-08-24** — ดูหัวข้อถัดไป
- **⚠️ REST route ยุคร้านเดียว 22 ตัวไม่ยืนยันตัวตนเลย — แก้แล้ว 2026-08-24 (ไม่มี migration)**
  · **ต้นเหตุร่วม**: `middleware.ts` กันแค่ `/admin/**` (ดูเงื่อนไข `!pathname.startsWith("/admin")`
    → `NextResponse.next()`) ทุกอย่างใต้ `/api/**` ที่ไม่ใช่หน้า admin **ผ่านฟรี** · route ชุดนี้เขียน
    ตอนระบบมีร้านเดียว จึงไม่เช็คอะไรและอ่าน tenant จาก `DEFAULT_TENANT_ID` ตายตัว
  · **ผลจริงก่อนแก้**: ใครก็ยิงได้ว่า `order/[id]/pay` (ปิดบิลว่าจ่ายแล้ว), `purchase/[id]/receive`
    (รับของเข้าคลัง = สต็อกเพิ่มลอย ๆ), `payment/[id]/verify`, `shipment/[id]/status`,
    `inbox/[id]/reply` (ส่งข้อความออกในนามร้าน), `reports/{sales,inventory,top-products}`
    (อ่านยอดขายทั้งร้าน) — ทั้งหมดบนร้าน default
  · **แก้เป็น** `authorizeAdminRoute(<permission>)` ทุกตัว โดยใช้ permission **ตัวเดียวกับ resolver
    GraphQL ที่ทำงานเดียวกัน** (`order.pay`, `order.ship`, `order.cancel`, `order.return`,
    `order.create`, `payment.view/submit/confirm`, `purchase.view/edit/receive/cancel`,
    `shipping.view/create/update`, `report.view`, `inbox.view/reply`) และ tenant มาจาก session/คุกกี้
    drill-down · ยืนยันจริงด้วย curl: ทั้ง 22 endpoint คืน `401` ตอนไม่ล็อกอิน
  · **webhook mock ยุคร้านเดียว 2 ตัว** (`line/webhook`, `tiktok/webhook` — ตัวที่ไม่มี `[tenantId]`)
    แก้ด้วย session ไม่ได้ (webhook ไม่มี cookie) และมันเรียก `runPipeline` = **จ่ายค่า AI ให้คนที่ยิง
    ฟรี** + เขียนแชทปลอมเข้ากล่องข้อความร้าน default → ตอนนี้คืน `404` เมื่อ `NODE_ENV=production`
    (dev ยังใช้ curl ได้เหมือนเดิม) ทางจริงคือ webhook ต่อร้านที่ verify ลายเซ็นแบบ fail-closed
  · **`/api/bms/demo-chat` เปิดสาธารณะโดยตั้งใจ (เดโมหน้าขายของ) แต่ไม่มีเพดานเลย** — เติม
    `rateLimit(demo-chat:<ip>, 20, 60_000)` แบบเดียวกับ web widget webhook (ซึ่งมี 120/นาที อยู่แล้ว)
    ยืนยันแล้ว: ยิง 22 ครั้ง → 20 ผ่าน 2 ตัวท้ายได้ 429
  · **ที่ไม่แตะ (มีการ์ดอยู่แล้ว)**: `payment/[id]/{confirm,refund,reject}`, `chat`, `reports/{generate,
    download,pos-returns,pos-return-audit}`, `onboarding/sample-data` ใช้ `verifyAdminSession` +
    `requirePermission` เขียนมือ (pattern เดียวกับที่ `adminRouteAuth` ถูกแยกออกมา — ยัง refactor ให้ใช้
    helper ได้ถ้าจะลดโค้ดซ้ำ) · `products/upload`, `inbox/upload` ใช้ `requireAdminOrInternal`
    (ล็อกอินแล้วแต่ **ยังไม่เช็ค permission** — ความเสี่ยงต่ำเพราะแค่เก็บไฟล์) · webhook ต่อร้าน
    ทุกช่องทาง verify ลายเซ็น fail-closed · job/cron ใช้ `CRON_SECRET`/`BMS_JOB_TOKEN` ·
    `checkout/*` ใช้ token ที่เซ็นไว้ (ลูกค้าเปิดเอง ไม่มี session)
  · **ตามเก็บต่อจนหมด 2026-08-24 (รอบเดียวกัน)**:
    - `products/upload`, `inbox/upload` เดิม gate ด้วย `requireAdminOrInternal()` = "ล็อกอินแล้วผ่าน"
      ไม่ดูสิทธิ์เลย → เปลี่ยนเป็น `product.edit` / `inbox.reply` ให้ตรงกับขั้นที่เอาไฟล์ไปใช้จริง
      · **`requireAdminOrInternal` ไม่มี route ไหนใช้แล้ว** และถูกถอดออกจาก allowlist ของเทสด้วย
      (ยังเหลืออยู่ใน `lib/dev-guards.ts` + README ของ fake seeder เท่านั้น)
    - route ที่เขียน `verifyAdminSession` + acting-tenant + `requirePermission` ด้วยมือ 8 ตัว
      (`payment/[id]/{confirm,refund,reject}`, `reports/{generate,download,pos-returns,
      pos-return-audit}`, `chat`) ย้ายมาใช้ `authorizeAdminRoute()` แล้ว — ลดโค้ดซ้ำ ~79 บรรทัด
      และตัดโอกาสที่บางตัวจะลืมส่วน acting-tenant ตอนแก้ครั้งถัดไป
    - **`authorizeAdminRoute()` คืน `admin` + `ctx` เพิ่ม** (`ctx` = รูปเดียวกับที่ resolver ส่งให้
      `requirePermission()`/`audit()`) เพราะ `generateReport()` รับ ctx · และรับ `permission = null`
      ได้สำหรับ route ที่ต้องการแค่ "ล็อกอินแล้ว" (playground `chat` — ไม่มีสิทธิ์ตรงตัวใน catalog)
    - **`onboarding/sample-data` จงใจไม่แตะ** — มัน gate ด้วย *role* (`Administrator`/`Manager`
      อ่านจาก DB) ไม่ใช่ permission ย้ายมาใช้ helper = เปลี่ยนความหมายการอนุญาต
  · **กันย้อนกลับ**: `scripts/inventory-tenant-scope-contract.test.mts` เพิ่มเทสที่ 2 — สแกน route ทุกตัว
    ใต้ `app/api/bms` ว่ามีการ์ดอย่างน้อยหนึ่งอย่างจาก allowlist และ route ที่ "เปิดสาธารณะโดยตั้งใจ"
    ต้องมี `rateLimit()` · route ใหม่ที่ลืมการ์ดจะทำให้เทสแดงทันที (ก่อนหน้านี้ 26 ไฟล์หลุดพร้อมกัน
    โดยไม่มีอะไรฟ้อง)
- **key i18n วางผิด section = โชว์ชื่อ key ดิบบนหน้าจอร้าน (เจอ 2 ครั้งใน 2 คอมมิต)** — `getMessage()`
  คืน key ตัวเองเมื่อหาไม่เจอ จึงไม่พังตอน build และ `tsc` ไม่จับ · `9.20` วางคีย์ราคาแยกไซซ์ 4 ตัวไว้ใน
  `admin_restock` (th) และ `admin_dashboard` (en) — ย้ายเข้า `admin_products` แล้ว
  · กันย้อนกลับ: `scripts/i18n-keys-contract.test.mts` (2 เทส ไม่ต้องมี DB — ตรวจ literal `t("...")`
    ทุกตัวในแอปว่า resolve ได้ทั้ง th/en + คีย์ทุก section ต้องมีครบทั้งสองภาษา) · ยืนยันแล้วว่าเทสนี้
    **แดงจริง** เมื่อจงใจย้ายคีย์ออก · คีย์ที่ประกอบตอนรัน (template string) ตรวจไม่ได้ ต้องระวังเอง

    ```bash
    cd apps/web && npx tsx --test ../../scripts/i18n-keys-contract.test.mts
    ```
- **`9.22__bms_order_item_receipt_price_snapshot.sql` (ราคาบนใบเสร็จเป็น snapshot แยกจากราคาที่ใช้คิดยอด)
  apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว 2026-08-26** — ยังไม่ได้ apply เข้า production ·
  ไม่มี permission ใหม่
  · **อาการที่เจอจากหน้าร้านจริง (bms.jachoei.com, บิล `06908250024`)** — สินค้ามีราคาส่ง "ซื้อครบ 5
    ลด 10%" ตะกร้า S1+M1+XL3: จอแสดง 540/720/900 (ราคาส่ง) แต่ใบเสร็จที่พิมพ์ทันทีแสดง 600/800/3000
    (ราคาป้าย) แล้วผลรวมรายการบนกระดาษ 4,400 ไม่เท่ายอดสุทธิ 3,960 · พอกด "ดู/พิมพ์" ใบเดิมซ้ำ กลับได้
    720/540/2700 ซึ่ง **คนละชุดกับใบแรกของบิลเดียวกัน**
  · **ต้นเหตุ**: `bms_order_items` มีแต่ `unit_price` = ราคาที่คิดจริง (ผ่านราคาส่งแล้ว) ตอนพิมพ์ซ้ำจึง
    อ่านค่านั้นมาโชว์ = เหมือนราคาสินค้าเปลี่ยนย้อนหลัง ส่วนใบแรกประกอบจาก `cart` ฝั่งจอซึ่งถือราคาป้าย
    → **บิลเดียวพิมพ์สองครั้งได้เลขคนละชุด**
  · **ทางที่เลือก**: เพิ่มคอลัมน์ `receipt_unit_price` เป็น snapshot ของ **ราคาป้ายก่อนหักราคาส่ง/โปร
    และก่อนส่วนลดระดับบิล** (ไม่ใช่ราคาที่คิดจริง) แล้วให้ส่วนต่างไปโชว์เป็นบรรทัด "ส่วนลดราคาส่ง/
    โปรโมชั่น" จาก `loadPosReceiptDiscountLines()` — ผลรวมรายการบนกระดาษจึงบวกลงตัวกับยอดสุทธิ และ
    ลูกค้าเห็นว่าตัวเองได้ส่วนลดเท่าไร (ถ้าเก็บราคาที่คิดจริงลงไปแทน ส่วนลดจะหายไปจากกระดาษทั้งก้อน)
  · **ห้ามเปลี่ยนไปเก็บราคาที่คิดจริง** — เคยแก้ผิดทางมาแล้วรอบหนึ่ง (2026-08-26) เพราะดูจากภาพหน้าจอ
    แล้วเข้าใจว่า "ใบเสร็จโชว์ราคาป้าย = บั๊ก" ทั้งที่เป็นดีไซน์ · comment ในไฟล์ migration อธิบายไว้แล้ว
    ให้อ่านก่อนแก้
  · **backfill แถวเก่าเดาจากหลักฐานที่ดีที่สุด ณ เวลา migrate** (pack_unit_price → per-size base pack →
    shared base pack → `bms_products.price` → `unit_price`) แล้วบังคับ `NOT NULL` — แถวเก่าจึงไม่แม่น
    100% แต่ไม่มีทางแม่นกว่านี้ได้ เพราะราคาป้ายตอนขายไม่เคยถูกเก็บไว้เลย
  · **การคืนของไม่ลดเลขบนใบขายเดิม โดยตั้งใจ** — เป็นใบกำกับภาษีอย่างย่อที่ออกไปแล้ว การคืนออกใบลดหนี้
    แยก · แต่ก่อนหน้านี้ใบเสร็จเงียบสนิทเรื่องการคืน คนพิมพ์ซ้ำจึงคิดว่าการคืนไม่ถูกบันทึก ตอนนี้เพิ่ม:
    การ์ดเตือนเหนือสลิปในหน้าจอ (`ใบนี้คือใบขายเดิม ยอดสุทธิบนกระดาษยังเป็นยอดตอนขายจริง` + คืนแล้ว/
    คงเหลือ), ปุ่มเปลี่ยนชื่อเป็น **"ดูใบขายเดิม"** เมื่อบิลมีการคืน, และ `BillHistoryPanel` ไล่ไทม์ไลน์
    ขาย→คืนทีละรายการ
  · เทส: `scripts/pos-loyalty-db-contract.test.mts` + `scripts/pos-shift-ops-db-contract.test.mts`
    (34 เทส รวมเทสใหม่ `bill history follows a non-cash refund from pending to completed` และ
    `split-payment return is counted once…`) · รันคู่กับ `price-tiers`/`receipt-delivery`/
    `pos-blind-return` (28 เทส) ผ่านทั้งหมด 2026-08-26
- **`9.23__bms_pos_return_pricing_snapshot.sql` (คืนบางรายการแล้วประเมินราคาตามจำนวนใหม่)
  apply เข้า dev DB และ verify แล้ว 2026-08-26** — ยังไม่ได้ apply production · บิลเดิม/ใบกำกับเดิม
  ไม่ถูกแก้ แต่ `pricing_snapshot` บน order item เก็บราคาส่ง+โปรตอนขายไว้ เมื่อของคงเหลือต่ำกว่า
  threshold ยอดคืนจะเป็นยอดที่จ่ายเดิมลบมูลค่าของคงเหลือที่ประเมินใหม่ เช่น 5×90=450 คืน 1 แล้ว
  เหลือ 4×100=400 จึงคืน 50 ไม่ใช่ 90 · ทำเฉพาะ snapshot ที่สร้างพร้อมบิลใหม่ (`source: SALE`)
  ส่วนบิล legacy ยังคงคืนตามสัดส่วนเดิม ไม่ใช้กฎปัจจุบันเดาย้อนหลัง · เพิ่ม `9.24` บังคับ provenance
  นี้ใน DB · ผ่าน pure pricing 25 + POS parser 12 และ DB POS loyalty 12 + blind return 9 + shift ops 23,
  `tsc --noEmit` และ production build (Redis hostname ใน host test ใช้ไม่ได้ แต่ cache fail-open ตาม design)
- **ความลับห้าม fallback ไปค่าในซอร์สเมื่อรัน production — แก้แล้ว 2026-08-27 (ไม่มี migration)**
  · **ต้นเหตุ**: `export const JWT_SECRET = process.env.JWT_SECRET || "changeme_secret"` อยู่ 2 ที่
    (`lib/auth/token.ts`, `lib/auth/jwt.ts`) + `apps/ws/src/ws.ts` อีกตัว และ `lib/bms/crypto.ts`
    fallback ไปคีย์ที่ derive จากสตริง `"bms-dev-secret-key"` · instance ที่ลืมตั้ง env จึงเซ็น session
    (และเข้ารหัส token ของร้านใน DB) ด้วยค่าที่ใครอ่าน repo ก็คำนวณได้
  · **ยืนยันว่าเกิดจริง ไม่ใช่ทฤษฎี**: container dev รันโดยไม่มี `JWT_SECRET` — ผมปั้น token แอดมิน
    ของร้าน `11111111...` เองแล้วยิงผ่าน (ใช้ทดสอบ cross-tenant ของ `9.27`)
  · **แก้เป็นฟังก์ชัน ไม่ใช่ const โดยตั้งใจ** — `const` ถูก evaluate ตอน import ถ้า throw ที่นั่น
    `next build` จะล้มบนเครื่องที่ยังไม่มี runtime env · ต้องล้มตอน "มีคนใช้จริง" ไม่ใช่ตอนคอมไพล์
    · และ **เลิก export ค่าความลับตรง ๆ** (เดิม `JWT_SECRET` export ออกไป ผู้เรียกได้ค่า fallback
    โดยไม่ผ่านการตรวจ) → ผู้เรียกใน `graphql/resolvers.ts` 5 จุดเปลี่ยนเป็น `jwtSecret()`
  · **`BMS_SECRET_KEY` ที่ตั้งมาผิดรูป (ไม่ใช่ hex 64) ก็ throw** — อันตรายกว่าไม่ตั้งเลย เพราะดู
    เหมือนตั้งแล้วแต่จริง ๆ ใช้คีย์ dev
  · verify พฤติกรรมจริง 4 กรณี: dev+ไม่มี env → ผ่าน · prod+ไม่มี env → throw · prod+คีย์ผิดรูป →
    throw · prod+env ครบ → ผ่าน · และ container dev ยังใช้งานได้ปกติ (หน้าแรก/ไฟล์/session → 200)
  · เทสชุดใหม่: `scripts/secret-fallback-contract.test.mts` (7 เทส ไม่ต้องมี DB) — สแกนทั้ง `apps/`
    ห้ามมี `const X = process.env.SECRET || "literal"` ที่ระดับโมดูลอีก
  · **⚠️ ยังเหลือให้คนทำ: ตั้ง `JWT_SECRET` + `BMS_SECRET_KEY` บน production ให้ครบ**
    ก่อนหน้านี้ไม่ตั้งก็รันได้ (เงียบ ๆ ไม่ปลอดภัย) ตอนนี้ไม่ตั้ง = แอปล้ม ซึ่งคือเจตนา
    · `POSTGRES_PASSWORD` ใน `lib/db.ts` ยังมี fallback `"app"` — ยังไม่แตะ เพราะการล้มตอนต่อ DB
      ทำให้ dev ที่ใช้ค่า default พังทันที ต้องดูให้แน่ก่อนว่าไม่มีใครพึ่งค่านั้น
- **`9.27__bms_files_tenant_ownership.sql` (ไฟล์ private เป็นของร้านเดียว) apply เข้า dev DB และ
  **apply เข้า production แล้ว 2026-08-26** (ผู้ใช้ยืนยัน) · verify กับ HTTP จริงแล้ว · ไม่มี permission ใหม่
  · **ต้นเหตุที่ `9.26` ยังไม่ปิด**: ตาราง `files` ไม่มี `tenant_id` เลย → ล็อกอินร้าน A แล้วเดา id
    เปิดไฟล์ private ของร้าน B ได้
  · **เจ้าของเป็นค่าที่ derive ไม่ใช่ประกาศ** — 4 ตาราง BMS ที่อ้างถึงไฟล์มี `tenant_id` อยู่แล้ว
    (`bms_product_images`, `bms_generated_reports`, `bms_pharmacy_clinical_evidence`,
    `bms_payments.slip_url`) จึงยกมาใช้ · **3 ตารางของฟีเจอร์ชุมชนเดิมไม่มี tenant เลย**
    (`message_images`, `messages.audio_file_id`, `post_images`) ไฟล์พวกนี้เป็น `NULL` = "ไม่มีร้านเป็นเจ้าของ"
    แล้ว route ขอแค่ "ล็อกอินแล้ว" เท่าเดิม · บังคับ NOT NULL = ต้องกุเจ้าของให้ข้อมูลยุคก่อน BMS
  · **ร้านไม่ตรงตอบ `404` ไม่ใช่ `403`** — 403 เท่ากับยืนยันให้คนนอกร้านรู้ว่า id นั้นมีไฟล์อยู่จริง
  · acting tenant มาจาก `authorizeAdminRoute(null)` ไม่ใช่ `admin.tenant_id` ตรง ๆ เพื่อให้คุกกี้
    drill-down ที่เซ็นแล้วใช้งานได้ (platform admin เข้าไปดูร้านลูกค้า)
  · ทุกจุดที่อัปโหลดผูกเจ้าของจากแหล่งที่เชื่อได้: session / เครื่องที่ authenticate แล้ว /
    token checkout ที่เซ็นไว้ — **ไม่เคยรับ tenant จาก body**
  · verify ด้วย curl จริง: ไม่มี session → `401` · ไฟล์ร้านตัวเอง → `200` · ไฟล์ร้านอื่น → `404`
  · เทสเดิม `scripts/file-visibility-contract.test.mts` ขยายเป็น 7 เทส (เพิ่มการตรวจ tenant + การผูกเจ้าของ)
  · **⚠️ เจอตอน verify: container `bms-web-1` รันโดยไม่มี `JWT_SECRET` ตั้งไว้** →
    fallback ไปใช้ `"changeme_secret"` ที่ hardcode · **แก้แล้ว 2026-08-27 ให้ production throw**
    (ดูหัวข้อ "ความลับห้าม fallback" ด้านล่าง) แต่ **ยังต้องไปตั้ง env บนเซิร์ฟเวอร์จริงเอง**
    เพราะตอนนี้ถ้าไม่ตั้ง production จะล้มดัง ๆ แทนที่จะเงียบ (agent แก้ `.env*` ไม่ได้):
    `docker compose ... exec web printenv JWT_SECRET BMS_SECRET_KEY`
- **`9.26__bms_files_visibility.sql` (ไฟล์อ่อนไหวไม่ถูกเสิร์ฟให้คนที่ไม่ได้ล็อกอิน) apply เข้า dev DB และ
  **apply เข้า production แล้ว 2026-08-26** (ผู้ใช้ยืนยัน) · verify กับ HTTP จริงแล้ว · ไม่มี permission ใหม่
  · **ต้นเหตุ**: `/api/files/[id]` ไม่ตรวจอะไรเลย และ `files.id` เป็น integer เรียงลำดับ = ไล่นับขึ้นไป
    โหลดไฟล์ของใครก็ได้ · ที่หนักคือ **สลิปโอนเงิน** (มีชื่อ+เลขบัญชีผู้โอน) และ **ไฟล์แนบ Inbox**
    · ซ้ำร้าย `GET /api/files` คืนรายชื่อไฟล์ทั้งระบบพร้อม `relpath` และ `POST /api/files` อัปโหลดได้
      **โดยไม่ต้องล็อกอินทั้งคู่** (สองตัวนี้เสิร์ฟ Files panel ที่ `/settings` ซึ่งเมนูถูกคอมเมนต์ปิดไปแล้ว
      = UI ตาย แต่ route ยังเปิด)
  · **แถวเก่าทั้ง 7,532 ถูก backfill เป็น `public` โดยตั้งใจ** — ไม่มีคอลัมน์ไหนบอกได้ว่าอันไหนอ่อนไหว
    ถ้าเหมาเป็น private ทีเดียว รูปสินค้า/avatar/รูปโพสต์เดิมพังหมดโดยกู้ไม่ถูก · แล้วค่อยดึงกลับเป็น
    private เฉพาะกลุ่มที่ระบุตัวได้: สลิป (`bms_payments.slip_url`), รายงาน (`bms_generated_reports`),
    รูปใบสั่งยา (`bms_pharmacy_clinical_evidence`)
  · **ค่าปริยายของคอลัมน์คือ `private`** — โค้ดใหม่ที่ลืมระบุจะได้ของที่ปลอดภัยกว่า ไม่ใช่หลุด ·
    `persistWebFile`/`persistBuffer` ปริยาย private · **`persistUploadStream` ปริยาย public โดยตั้งใจ**
    (GraphQL upload ของฟีเจอร์ชุมชนเดิม: avatar/รูปโพสต์/ไฟล์แชท ซึ่งหน้าเว็บโหลดตรงโดยไม่มี session)
  · verify ด้วย curl จริงบน dev: public ที่มีอยู่ → `200` · private → `401` · `GET/POST /api/files` → `401`
  · เทสชุดใหม่: `scripts/file-visibility-contract.test.mts` (5 เทส ไม่ต้องมี DB — อ่านซอร์ส) ·
    **ยืนยันแล้วว่าแดงจริง** เมื่อจงใจเปลี่ยน fail-closed เป็น fail-open
  · ช่อง cross-tenant ที่เคยจดว่า "ยังเหลือ" **แก้แล้วที่ `9.27`** (ดูหัวข้อถัดไป)
- **`/admin/env` เคยซ่อน env ที่สำคัญที่สุดทั้งหมด — แก้แล้ว 2026-08-27**
  · `pickEnv()` กรองด้วย **allowlist ของ prefix** (`NODE_ NEXT_ DATABASE_ REDIS_ … BMS_AI_ BMS_SLIP_`)
    ผลคือ **ไม่มีตัวไหนใน 11 ตัวนี้โผล่เลย**: `BMS_SECRET_KEY`, `BMS_JOB_TOKEN`, `BMS_CRON_SECRET`,
    `JWT_SECRET`, `BMS_CHECKOUT_SECRET`, `ADMIN_TOKEN`, `POSTGRES_*` (allowlist มีแค่ `DATABASE_`
    แต่แอปใช้ `POSTGRES_*`), `BMS_ALLOW_FAKE_SEED`, `ETAX_ENABLED`, `PHARMACY_*_ENABLED`
  · **อาการที่เจอ**: เปิดหน้านี้เพื่อเช็คว่าตั้ง `BMS_SECRET_KEY` แล้วยัง → ไม่เห็นเลย → เข้าใจว่า
    "ยังไม่ตั้ง" ทั้งที่ตั้งไว้ใน `.env` แล้ว · **หน้าที่บอกไม่ครบแต่ดูเหมือนครบ แย่กว่าไม่มีหน้านี้**
  · แก้เป็น: **ถอด allowlist ทิ้งทั้งหมด แสดง env ทุกตัวที่โปรเซสเห็น** (74 แถวจาก 69 ตัวใน
    container + `allowExact` ที่ยังไม่ได้ตั้ง) · `allowExact` คงไว้สำหรับตัวที่ต้องขึ้น**แม้ค่าจะว่าง**
    ("ไม่ได้ตั้ง" คือคำตอบที่คนมาหา ไม่ใช่ซ่อนแถวทิ้ง)
  · **ปิดบังจาก "ค่า" ด้วย ไม่ใช่แค่ "ชื่อ"** (`valueLooksSensitive`) — DSN แบบ
    `scheme://user:pass@host` ถูก mask แม้ชื่อจะไม่มีคำว่า SECRET/KEY · เคสจริงที่รออยู่คือ
    `REDIS_URL` ซึ่งวันนี้ไม่มีรหัส แต่โน้ตข้อ Redis ระบุว่าต้องใส่ password ก่อน production
    ถ้าดูแต่ชื่อ วันนั้นรหัสจะโผล่บนหน้านี้
  · **ความลับสำคัญแสดงแค่ "ตั้งไว้ · N ตัว" ไม่โชว์เสี้ยวไหนของค่า** (`PRESENCE_ONLY`) —
    `maskValue()` เดิมโชว์ 3 ตัวแรก+3 ตัวท้าย ซึ่งพอรับได้กับ API key แต่ไม่มีเหตุผลกับคีย์ที่เซ็น
    session/เข้ารหัสความลับทุกร้าน · `BMS_SECRET_KEY` ตรวจรูปแบบให้ด้วย (hex 64 → เตือนถ้าผิดรูป)
  · สตริงทั้งหมดผ่าน `t()` (หน้านี้ใช้ `t()` 28 ครั้งอยู่แล้ว) เพิ่มคีย์ 4 ตัวใน `admin_env` ทั้ง th/en
  · verify: เรนเดอร์หน้าจริงด้วย platform admin → `200` และเห็น `BMS_SECRET_KEY` · ทดสอบ `pickEnv`
    กับค่าจริงทั้งกรณีถูกรูป/ผิดรูป/ไม่ได้ตั้ง
- **⚠️ POS ร้านยา — recheck 2026-08-27 (branch `fix/pharmacy-pos-approval-gaps`, ไม่มี migration,
  ไม่มี permission ใหม่)** เจอ 3 จุดในด่าน "ใบอนุมัติของเภสัชกร" · **แก้แล้วและ `tsc --noEmit` ผ่าน
  แต่เทส DB ยังไม่ได้รันในรอบนี้ (เครื่องนี้ไม่มี Postgres/docker ของ BMS รันอยู่)** ต้องรัน
  `scripts/pharmacy-approval-reuse-db-contract.test.mts` (เพิ่มเทสใหม่ 2 ตัว) ให้ผ่านก่อนเชื่อว่าใช้ได้จริง
  1. **จำนวนที่อนุมัติเคยเป็นเพดานต่อบรรทัด ไม่ใช่ต่อบิล → จ่ายยาเกินใบอนุมัติได้** ตั้งแต่ `9.21`
     บิลใบเดียวถือ SKU+ไซซ์เดียวกันได้สองหน่วยขาย ("1 กล่อง + 3 เม็ด") โค้ดเดิมเทียบแต่ละบรรทัดกับ
     draft item ตัวแรกที่เจอ → อนุมัติ 10 เม็ด แต่บิลที่มี 10 + 10 ผ่านทั้งสองบรรทัด (พิสูจน์ด้วยการ
     รันอัลกอริทึมเดิมซ้ำ = ผ่านจริง) · แก้ด้วยฟังก์ชัน pure `approvedSkusFromCheckoutDraft()`
     ใน `productPolicyDecision.ts` ที่รวมจำนวนต่อ (sku, size) ทั้งสองฝั่งก่อนเทียบ ·
     เทส `pharmacy-policy-decision-contract.test.mts` เพิ่ม 8 ตัว (รวม 22) **รันผ่านแล้ว**
  2. **`approveAssessment()` ลบ `checkout_order_draft` ทิ้งเมื่อผู้เรียกไม่ส่ง draft มา** เคสจาก
     เคาน์เตอร์เกิดมาพร้อมตะกร้าที่แคชเชียร์สแกนอยู่ใน draft และ draft นั้นคือสิ่งเดียวที่ปลดบิลที่พักไว้ได้
     → เคสกลายเป็น APPROVED แต่บิลจบไม่ได้ และ **ย้อนไม่ได้** (เคสที่ APPROVED แล้ว approve ซ้ำไม่ได้)
     · แก้เป็น "ไม่ส่ง draft = คง draft เดิมที่ยัง `AWAITING_CUSTOMER_CONFIRMATION`" · ส่ง draft มา
     ยังชนะเหมือนเดิม (เภสัชกรตัดรายการได้) · UI เดิมส่ง draft เดิมกลับมาให้อยู่แล้ว จึงพังเฉพาะทาง
     service/ผู้เรียกอื่น — แต่ service คือด่านจริง ไม่ควรพึ่ง UI
     · ผลพลอยได้ที่ต้องแก้คู่กัน: `checkPharmacistDraftPolicyInTx()` รับ `channel` แล้ว และ approve
       ส่ง `"counter"` เมื่อ `complaint.sourceMeta.source === 'pos'` ไม่งั้นสินค้า `ONLINE_SALE_PROHIBITED`
       ที่ส่งตรวจจากหน้าร้านจะ **อนุมัติไม่ได้เลย** (ถูกตัดสินด้วยกฎของช่องทางออนไลน์)
  3. **ใบอนุมัติที่ระบุตัวคนไข้ ใช้กับคนไข้อื่นได้** ถ้าตะกร้าเหมือนกัน — การซักถามของเภสัชกรเป็นเรื่องของคน
     ไม่ใช่ของตะกร้า · แก้: `checkPharmacySaleInTx()` รับ `saleCustomerId` (POS ส่งให้อยู่แล้วผ่าน
     `createOrder`) และปฏิเสธเมื่อ **ทั้งสองฝั่งมีลูกค้าแล้วไม่ตรงกัน** · บิลที่ไม่ผูกลูกค้า (walk-in)
     ไม่ถือว่าไม่ตรง — ไม่งั้นจะไปปิดการขายที่ถูกต้องของหน้าร้าน · ทางออนไลน์ไม่กระทบ (pipeline ส่งแต่
     `customerRef` ไม่ส่ง `customerId`)
  · **ยังค้าง ต้องให้คนตัดสิน (ไม่ได้แก้ในรอบนี้)**:
    - **ยาที่ต้องมีใบสั่งแพทย์ (`PRESCRIPTION_REQUIRED`) ขายหน้าร้านไม่ได้เลย** — ไม่ใช่แค่บล็อก:
      `requestPosPharmacyReview()` ไม่ยอมเปิดเคสให้ด้วย และหน้าคิวก็เลือกสินค้ากลุ่มนี้เข้า draft ไม่ได้
      (`pharmacy-queue/[caseId]/page.tsx`) · `9.25` มีที่เก็บรูป/เลขใบสั่งยาแล้ว ชิ้นที่ขาดคือ "ใบสั่งยา +
      เภสัชกรอนุมัติ = ปลดล็อกที่เคาน์เตอร์" ซึ่งเป็นการตัดสินใจเชิงข้อกำกับ ไม่ใช่บั๊ก
    - **ไม่มีที่ไหนบังคับว่าต้องมีเภสัชกรอยู่หน้าร้านตอนจ่ายยา** — `bms_pos_shifts.pharmacist_user_id`
      ถูกบันทึกเฉพาะเมื่อคนเปิดกะเป็นเภสัชกรเอง (`app/api/pos/shift/route.ts`) และ **ไม่มีเส้นทางขายไหน
      อ่านค่านี้เลย**
    - **การคืนยาเข้าสต็อกไม่มีด่านของร้านยา** — `processPosReturn`/คืนแบบไม่มีใบเสร็จ คืนของขึ้นชั้นขายได้ทันที
    - เคสจากเคาน์เตอร์หมดอายุใน 60 นาที (`PHARMACY_ASSESSMENT_TTL_MINUTES`) — คิวยาวกว่านั้น บิลที่พักไว้
      ต้องเริ่มใหม่
    - เภสัชกรตัดรายการออกจาก draft แล้ว หน้าเคาน์เตอร์เห็นแค่ `PHARMACY_REVIEW_REQUIRED` ไม่รู้ว่าตัดตัวไหน
- **`9.29__bms_pos_pharmacist_counter_authorization.sql` (เภสัชกรกด PIN อนุมัติจ่ายยาที่เครื่องขาย —
  แบบร้านยาทั่วไป) เขียนแล้วบน branch `fix/pharmacy-pos-approval-gaps` (2026-08-27) · **⚠️ ยังไม่ได้
  apply เข้า dev DB และยังไม่ได้รันเทส DB** (เครื่องนี้ไม่มี Postgres ของ BMS รันอยู่) ต้อง apply +
  รัน `scripts/pharmacy-counter-authorization-db-contract.test.mts` ให้ผ่านก่อนเชื่อว่าใช้ได้จริง
  · seed permission ใหม่: **ไม่มี** (ใช้ `pharmacy.policy.review` สำหรับสวิตช์ตั้งค่า และใช้
    **ข้อเท็จจริงเรื่องใบอนุญาต** `is_licensed_pharmacist` เป็นด่านของการอนุมัติ ไม่ใช่ permission)
  · **ต้นเหตุ**: โมดูลร้านยาทั้งชุดออกแบบจาก flow ออนไลน์ (ซักประวัติเป็นข้อความ → เภสัชกรอนุมัติ
    ในคิวทีหลัง) ซึ่งไม่ใช่วิธีทำงานของร้านยาหน้าร้าน ผลคือมี **ทางตัน 2 จุดที่ขายไม่ได้เลย**:
    (ก) `PRESCRIPTION_REQUIRED` ไม่มีเส้นทางไหนจ่ายได้ (คิวก็เปิดเคสให้ไม่ได้)
    (ข) `PHARMACY_POLICY_UNKNOWN` — SKU ที่ยังไม่มีใครรีวิว ขายไม่ได้กลางคิวลูกค้า ซึ่งร้านที่มีของ
        หลายพันตัวเจอทุกวัน · และ `assertPharmacyPolicyReadyToOpenShift()` บล็อกการ **เปิดกะ** ทั้งร้าน
  · **สิ่งที่เพิ่ม**: `/api/pos/sale` รับ `pharmacistAuthorizerUserId` + `...Pin` (+ note) ตรวจแบบ
    เดียวกับผู้อนุมัติส่วนลด แล้ว `evaluatePharmacySale()` รับชุด SKU ที่เภสัชกรอนุมัติเป็นพารามิเตอร์
    ที่ 5 (มีผล **เฉพาะ** `channel === "counter"`)
  · **ต่างจากผู้อนุมัติส่วนลด 2 ข้อโดยตั้งใจ**:
    1. **ผู้อนุมัติเป็นคนขายเองได้** — ร้านยาเล็กมีเภสัชกรคนเดียวที่ยืนขายเอง บังคับสองคน = บังคับให้
       ร้านหาทางเลี่ยงระบบตัวเอง (ถ้าเป็นคนเดียวกัน ใช้ PIN ที่ตรวจไปแล้ว ไม่ต้องพิมพ์ซ้ำ)
    2. **ด่านคือใบอนุญาต ไม่ใช่ permission** — Administrator ไม่ได้มาฟรีเหมือน permission อื่น
       (`bms_is_licensed_pharmacist` ตรวจซ้ำ **ในทรานแซกชันที่ขยับสต็อก** ไม่ใช่แค่ที่ route)
  · **ปลดอะไรได้**: policy ที่ยังไม่ APPROVED, `SHORT_SAFETY_CHECK`, `PHARMACIST_APPROVAL`,
    `ONLINE_SALE_PROHIBITED`, `PRESCRIPTION_REQUIRED` · **ปลดไม่ได้**:
    `PHARMACY_QUANTITY_LIMIT_EXCEEDED` (เพดานเป็นค่าที่ร้านตั้งเอง ขายเกิน = ไปแก้ policy ไม่ใช่กด PIN)
  · **หลักฐาน**: `bms_pos_pharmacist_authorizations` 1 แถวต่อ (บิล, sku, ไซซ์) เก็บจำนวน + เภสัชกร +
    note + **snapshot ของ policy ที่ถูกปลด** (แก้ policy ทีหลังต้องไม่เปลี่ยนความหมายของหลักฐานเดิม)
    · เขียนในทรานแซกชันเดียวกับบิล พร้อม audit `pharmacy.counter_authorization`
    · `checkPharmacySaleInTx()` ประเมิน **รอบแรกโดยไม่มีการอนุมัติ** เพื่อรู้ว่ารายการไหนต้องใช้จริง →
      ตะกร้าที่ผ่านอยู่แล้วไม่มีแถวหลักฐานงอกมา
    · ประทับ `bms_pos_shifts.pharmacist_user_id` ให้ด้วยเมื่อยังว่าง (กะที่แคชเชียร์เปิดเดิมไม่มีใครบันทึก)
  · **สองสวิตช์ระดับร้าน** ที่ `/admin/pos-readiness` (สิทธิ์ `pharmacy.policy.review`):
    `pharmacy_counter_authorization` (ค่าปริยาย **เปิด**) · `pharmacy_block_shift_on_unreviewed_policy`
    (ค่าปริยาย **ปิด** = **เปลี่ยนพฤติกรรมเดิมของร้านนำร่อง** ที่เคยบล็อกการเปิดกะเสมอ — ร้านที่อยาก
    ได้พฤติกรรมเดิมต้องไปเปิดสวิตช์นี้เอง)
  · เทส pure `scripts/pharmacy-policy-decision-contract.test.mts` เพิ่ม 8 ตัว (รวม **30 ตัว รันผ่านแล้ว**)
  · **แก้เทสที่แดงเสมอบน Windows ไปด้วย** — `inventory-tenant-scope-contract` เทียบ path ที่ได้จาก
    `path.relative()` (ใช้ `\`) กับ allowlist ที่เขียนด้วย `/` → แดงทุกครั้งบนเครื่องนี้ทั้งที่ route
    ถูกต้อง (เทสที่แดงเสมอ = เทสที่เลิกมีคนอ่าน) ตอนนี้ผ่าน 4/4
  · **ยังไม่ได้ทำ (จงใจ)**: การคืนยาเข้าสต็อกยังไม่มีด่านของร้านยา · ไม่มีการบังคับว่าต้องมีเภสัชกร
    อยู่เวรสำหรับยาสามัญ (ประทับว่าใครอยู่ ไม่ได้บังคับ)
- **ยาที่ต้องมีใบสั่งแพทย์ผ่านคิวเภสัชกรได้แล้ว (ไม่มี migration, ไม่มี permission ใหม่) — 2026-08-27
  commit เดียวกับ branch `fix/pharmacy-pos-approval-gaps`** · `tsc` + production build + เทส pure ผ่าน
  · **เทส DB ยังไม่ได้รัน** (เครื่องนี้ไม่มี Postgres ของ BMS) — มีเทสใหม่รออยู่ใน
    `pharmacy-approval-reuse-db-contract.test.mts` ("ยาที่ต้องมีใบสั่ง: ... ขายออนไลน์ได้")
  · **ต้นเหตุที่หายากกว่าที่คิด**: `evaluatePharmacySale()` ยอมให้เคสที่ approve แล้วปลดได้อยู่แล้ว
    ถ้าเราเพิ่มสถานะนี้เข้าไป **แต่ไม่มีใครเปิดเคสให้ตั้งแต่แรก** เพราะ 3 จุด (`pipeline.ts`,
    `tools/catalog.ts`, `pos.ts`) เขียนรายการ "สถานะที่ส่งเข้าคิวได้" ของตัวเองแยกกันคนละชุด
    → ด่านเข้าถึงได้ แต่ทางแก้เข้าไม่ถึง
  · **แก้เป็น**: `PHARMACIST_REVIEWABLE_BLOCK_STATUSES` + `isPharmacistReviewableBasket()` ใน
    `productPolicyDecision.ts` เป็นชุดเดียวของทั้งระบบ (REVIEW_REQUIRED · SAFETY_CHECK ·
    **PRESCRIPTION_REQUIRED**) และทั้ง 3 จุดเรียกตัวนี้ · เกณฑ์เป็น **all-or-nothing**: ตะกร้าที่มี
    ตัวที่เภสัชกรตัดสินไม่ได้ปนอยู่ ต้องไม่เปิดเคส ไม่งั้นได้ใบอนุมัติที่ใช้จริงไม่ได้
  · **ไม่อยู่ในชุดโดยตั้งใจ**: `PHARMACY_POLICY_UNKNOWN` (ยังไม่มีใครจัดประเภทสินค้า จึงไม่มีอะไรให้
    เคสตัดสิน — แก้ที่การรีวิว policy หรือ PIN หน้าร้าน) · `PHARMACY_ONLINE_SALE_PROHIBITED` ฝั่ง
    ออนไลน์ (ป้ายนี้พูดถึง *ช่องทาง* ไม่ใช่ว่าใครรับรอง) · เพดานจำนวน
  · หน้าคิว: เลือกยาที่ต้องมีใบสั่งเข้า draft ได้ · มีป้าย "ต้องมีใบสั่งแพทย์" ในตัวเลือก ·
    **เตือนแบบไม่บล็อก** เมื่อเคสยังไม่มีรูป/เลขใบสั่งแนบไว้ (9.25) — "หลักฐานพอหรือยัง" เป็น
    วิจารณญาณของเภสัชกร ไม่ใช่กฎที่โค้ดตัดสินแทน · `ONLINE_SALE_PROHIBITED` เลือกได้เฉพาะเคสที่มาจาก
    เครื่องขาย (`complaint.sourceMeta.source === 'pos'`)
  · เทส pure `pharmacy-policy-decision-contract.test.mts` เพิ่มอีก 6 ตัว (รวม **36 ตัว รันผ่านแล้ว**)
- **recheck ผลข้างเคียงของ 9.29 เอง — เจอ 5 จุด แก้แล้วในคอมมิตเดียวกัน (2026-08-27)**
  1. **⚠️ รัศมีความเสียหายก่อน apply migration**: `checkPharmacySaleInTx()` เดิม (ที่ผมเพิ่งเขียน)
     อ่าน `pharmacy_counter_authorization` ในคำสั่ง SELECT ตัวเดียวกับ `business_archetype` ซึ่ง
     **รันกับทุกบิลของทุกร้าน** → ฐานที่ยังไม่ apply `9.29` จะทำให้ **ร้านที่ไม่ใช่ร้านยาขายไม่ได้
     ทั้งหมด** (เหมือนกันที่ `getPharmacyPolicyReadiness`) · แยกเป็นสองคำสั่งแล้ว: อ่าน archetype
     ก่อน แล้วอ่านคอลัมน์ใหม่เฉพาะร้านยา/เฉพาะตอนมีคนใช้การอนุมัติจริง — ร้านยาจะยัง error ดัง ๆ
     ถ้าไม่ apply (ถูกต้อง เพราะเป็นฟีเจอร์ของมันเอง) แต่ร้านอื่นไม่โดนลูกหลง
  2. **การอนุมัติค้างข้ามตะกร้า**: เภสัชกรกด PIN แล้วเดินไป แคชเชียร์เพิ่มยาอีกตัว → server อนุมัติ
     ทุก SKU ที่ติดกฎในบิลที่ยิงมา = หลักฐานจะบันทึกชื่อเภสัชกรกับยาที่เขาไม่เคยเห็น · ตอนนี้
     **ตะกร้าเปลี่ยน = การอนุมัติหมดอายุ** (ใช้ cart key เดียวกับที่ล้าง `pharmacyReviewOffer`)
     พร้อมข้อความบอกให้กด PIN ใหม่
  3. **บิลที่ส่งเข้าคิวไปแล้วกดจ่ายไม่ได้** แม้เภสัชกรจะเดินมาอนุมัติที่เครื่อง เพราะ
     `payBlockedReason` (และเงื่อนไขของบิลมัดจำ) บล็อกเมื่อมีเคสที่ยังไม่ APPROVED · ยกเว้นให้เมื่อมี
     การอนุมัติที่เครื่องแล้ว
  4. **เคสในคิวค้างหลังขายด้วย PIN** — ถ้ามีคนไปกดอนุมัติเคสนั้นทีหลัง จะได้ใบอนุมัติที่ใช้ขายได้
     **อีกใบ** ของตะกร้าที่ของออกไปแล้ว · `recordPosSale` ปิดเคสให้ (best-effort หลังบิล commit,
     reason `dispensed_at_counter_with_pharmacist_authorization`) เมื่อขายด้วยการอนุมัติที่เคาน์เตอร์
  5. **บิลค้าง (recovery) ส่ง id เภสัชกรคนเดิมคู่ PIN ใหม่** → 403 ที่อ่านไม่รู้เรื่องถ้าคนมาอนุมัติ
     ซ้ำเป็นคนละคน · ตอนนี้ผู้อนุมัติรอบล่าสุดชนะทั้ง id/PIN/บันทึก
  · ตรวจแล้วว่า**ไม่มีปัญหา**: `bms_app` มี INSERT บน `bms_audit_log` (5.1) · `bmsCreateOrder`
    (GraphQL) ระบุฟิลด์ทีละตัวไม่ spread จึงฉีด `pharmacistCounterAuthorization` เข้ามาไม่ได้ และ
    channel ของมันไม่เคยเป็น `pos` · `clearBillCustomerState()` ล้างการอนุมัติหลังขายจบทุกบิล ·
    `bms_store_profile` ไม่มีคอลัมน์ NOT NULL ที่ไม่มี default (INSERT ของ `setPharmacyCounterSettings`
    ปลอดภัย) · เทสที่ assert "บิลที่ถูกปฏิเสธไม่ทิ้งหลักฐาน" ยังถูก เพราะทั้งทรานแซกชัน rollback
  · **ยังไม่ได้เปิดดูหน้าจอจริงในเบราว์เซอร์** (เครื่องนี้ไม่มี DB/dev server ของ BMS รันอยู่) —
    การ์ด PIN ที่หน้า POS, สวิตช์ที่ `/admin/pos-readiness`, ป้าย/คำเตือนที่หน้าคิว ผ่านแค่ `tsc`+build
- **recheck รอบสองของ 9.29 — เจอ 7 จุด แก้ครบแล้ว (2026-08-27, ไม่มี migration ใหม่,
  ไม่มี permission ใหม่)** · `tsc --noEmit` ผ่าน · เทส pure 133 ตัวจาก 9 ชุดผ่านทั้งหมด ·
  **เทส DB ยังไม่ได้รันในรอบนี้** (เครื่องนี้ไม่มี Postgres ของ BMS) — type-check ผ่านแล้วเท่านั้น
  1. **⚠️ บิลมัดจำค้างที่มีการอนุมัติของเภสัชกร กดซ้ำไม่ได้ และคีย์กันบิลซ้ำหายไป = เสี่ยงรับเงินสองรอบ**
     · เส้นทางกู้บิลของ **มัดจำ** (`createDepositFromCart`) ไม่มีการ์ดที่เส้นทางขายมี · body ที่เซฟไว้
       เก็บ `pharmacistAuthorizerUserId` แต่ถอด `...Pin` (ตั้งใจ) → ยิงซ้ำได้ `400 ต้องกด PIN` ซึ่งไม่มี
       ฟิลด์ `status` → เข้าเงื่อนไข `data?.status !== "SERVER_ERROR"` แล้ว **ลบ `PENDING_DEPOSIT_SALE_KEY`**
       → กดครั้งถัดไปสร้าง `idempotencyKey` ใหม่ ถ้ารอบแรก commit ไปแล้ว = บิล+เงินมัดจำซ้ำ
     · แก้: ยกการ์ด + การทับค่าผู้อนุมัติจากเส้นทางขายมาใส่ (คนที่มาอนุมัติซ้ำเป็นคนละคนได้)
  2. **ลำดับการล็อกกลับหัวกับ `finalizePosSale` (deadlock 40P01)** — `createOrder` ประทับ
     `bms_pos_shifts.pharmacist_user_id` **หลัง** ล็อกแถว `bms_inventory` แต่ `finalizePosSale`
     ล็อกกะก่อนแล้วค่อยตัดสต็อก · ย้ายการประทับกะ **และการปิดเคสที่ถูกแทนที่** ขึ้นไปก่อนแตะสต็อก
     (`checkPharmacySaleInTx` ก็ล็อกแถวเคสก่อนสต็อกอยู่แล้ว → ลำดับเดียวกันทุกเส้นทาง)
     · ผลข้างเคียงที่ต้องรู้: แถว event `assessment.closed` **ไม่มี `orderId`** เพราะตอนนั้นบิลยัง
       ไม่ถูกสร้าง — ทางไล่กลับอยู่ที่ audit `pharmacy.counter_authorization` ของบิล
       (`meta.supersededAssessmentId`)
  3. **ยาที่ต้องมีใบสั่งแพทย์ = เรื่องของเคาน์เตอร์เท่านั้น (กลับทิศจาก commit `b817d401`)**
     · `sale_policy` มีค่าเดียวต่อสินค้า พอ `PRESCRIPTION_REQUIRED` ถูกปลดด้วยใบอนุมัติจากคิว
       **ทั้งสองช่องทาง** ร้านจึงเขียน "ต้องมีใบสั่ง **และ** ห้ามออนไลน์" ไม่ได้เลย — และร้านขายยาจริง
       ไม่ได้อนุมัติใบสั่งจากห้องแชทแล้วส่งของออกไป
     · แก้เป็น: `PHARMACIST_REVIEWABLE_BLOCK_STATUSES_BY_CHANNEL` (online = 2 สถานะ ·
       counter = +`PHARMACY_PRESCRIPTION_REQUIRED`) และ `evaluatePharmacySale` ปลดด้วยใบอนุมัติ
       เฉพาะ `channel === "counter"` · **ค่าปริยายของทั้งสองฟังก์ชันคือ online (เข้มกว่า)** ผู้เรียก
       ที่ยังไม่รู้เรื่องช่องทางจะไม่ได้สิทธิ์ของเคาน์เตอร์มาฟรี
     · ฝั่งออนไลน์จึง **ไม่เปิดเคสให้ยากลุ่มนี้ตั้งแต่แรก** = ไม่มีใบอนุมัติที่อนุมัติแล้วใช้ไม่ได้ค้างในระบบ
     · หน้าคิว: ยาใบสั่ง + `ONLINE_SALE_PROHIBITED` เลือกเข้า draft ได้เฉพาะเคสที่มาจากเครื่องขาย
  4. **หน้า POS ไม่เคยยื่นปุ่ม "ส่งเข้าคิว" ให้ยาใบสั่ง แต่ข้อความบอกว่าทำได้** — `notePharmacyBlock`
     เขียนรายการสถานะเองแค่ 2 ตัว · ตอนนี้เรียก `isPharmacistReviewableBlock(status, "counter")`
     ตัวเดียวกับ server → เภสัชกรไม่อยู่หน้าร้านก็ยังส่งเข้าคิวได้ ไม่ใช่ทางตัน
  5. **ตารางหลักฐานเป็น write-only** — ไม่มีที่ไหนในแอปอ่าน `bms_pos_pharmacist_authorizations`
     เลย (มีแต่เทส) ทั้งที่เหตุผลของตารางคือตอบว่า "ใครจ่ายยาอะไรให้บิลไหน"
     · เพิ่ม `lib/bms/pharmacy/counterAuthorizations.ts` (อ่านอย่างเดียว) + query
       `bmsPharmacistCounterAuthorizations` สิทธิ์ **`pharmacy.audit.read`** (Pharmacist + Manager
       มีอยู่แล้วตั้งแต่ `7.57` — ไม่ต้อง seed อะไรใหม่) + การ์ด "บันทึกการจ่ายยาที่เคาน์เตอร์"
       ท้ายหน้า `/admin/pharmacy-queue` ใช้ตัวกรองเวลาเดียวกับคิว
     · เลขใบกำกับอ่านด้วย **subquery ไม่ใช่ JOIN** — JOIN ที่ได้เอกสารมากกว่าหนึ่งใบต่อบิลจะคูณแถว
       แล้ว `COUNT(*) OVER()` เพี้ยนไปด้วย
  6. **ช่องแข่งของการปิดเคส: คิวอนุมัติคาบเกี่ยวกับการขาย → ใบอนุมัติค้างที่ยังใช้ขายได้อีกใบ**
     · เดิม `recordPosSale` ยิง `closeAssessment()` แบบ best-effort **หลัง commit** และฟังก์ชันนั้น
       **ไม่รับสถานะ `APPROVED`** → ถ้าคิวเพิ่งกดอนุมัติไปพร้อมกัน จะปิดไม่ได้แล้วเงียบ
     · แก้: `closeAssessmentSupersededByCounterInTx()` ใน `assessments.ts` ปิด **ในทรานแซกชันของบิล**
       และรับ `APPROVED` ด้วย · ไม่ปิดใบที่ถูกใช้สร้างบิลไปแล้ว (`ORDER_CREATED`) เพราะนั่นเป็นหลักฐาน
       ของบิลอื่น
  7. **`pharmacyReviewAssessmentId` เชื่อจาก body ตรง ๆ** — มี PIN เภสัชกรที่ถูกต้องหนึ่งใบ = ปิดเคส
     ที่ยังเปิดอยู่ **ตัวไหนก็ได้ในร้าน** (เคสของลูกค้าคนอื่นบนกะเดียวกันคือเคสที่เกิดจริง)
     · ตอนนี้ตรวจ 3 ชั้นก่อนแตะแถว: (ก) `channel_id = 'pos'` (ข) `complaint.sourceMeta.shiftId`
       ตรงกับกะที่กำลังขาย (ค) ทุกบรรทัดใน draft ของเคสต้องอยู่ในตะกร้าใบนี้ครบ (ต่อ sku+ไซซ์)
     · ผลที่ไม่ใช่ `CLOSED` แค่ log ไม่ล้มบิล — ของถูกจ่ายตามการตัดสินของเภสัชกรไปแล้ว
  · **จุดเล็กที่แก้ไปด้วย**:
    - `pharmacistAuthOffer` ไม่ถูกล้างตอนตะกร้าเปลี่ยน (การ์ด PIN ค้างพูดถึงของในตะกร้าใบก่อน)
    - `setPharmacyCounterSettings` ย้ายไปเขียนใน `beginTenantTx` + **audit ในทรานแซกชันเดียวกัน**
      (เดิม `audit()` ยิงต่อท้ายที่ resolver) และ **ปฏิเสธร้านที่ `business_archetype` ไม่ใช่
      `pharmacy`** · เป็น UPDATE ล้วนแล้ว (ร้านยาต้องมีแถวโปรไฟล์อยู่แล้ว) จึงไม่ต้องพึ่ง
      `ON CONFLICT` ที่เคยยอมสร้างแถวให้ร้านที่ไม่ใช่ร้านยา
    - **การตัดสินช่องทางของเคสอ่านจาก `channel_id` ไม่ใช่ `complaint.sourceMeta.source` แล้ว**
      (ทั้ง `approveAssessment` และหน้าคิว) — `updateAnswers()` เขียนทับคอลัมน์ `complaint`
      **ทั้งก้อน** (full-replace ตามดีไซน์) วันไหนมีคนส่ง `complaintPatch` เคสหน้าร้านจะกลายเป็น
      เคสออนไลน์เงียบ ๆ แล้วอนุมัติรายการของตัวเองไม่ได้ · วันนี้ยังไม่มีผู้เรียกไหนส่ง แต่เป็นกับดัก
      ที่ไม่ควรพึ่ง
    - คอมเมนต์ในไฟล์ `9.29` อธิบายว่าทำไม `order_id` เป็น `ON DELETE CASCADE` (**ห้ามเปลี่ยนเป็น
      SET NULL** — หลักฐานที่ไม่รู้ว่าเป็นของบิลไหนตอบอะไรไม่ได้) และว่ายาใบสั่งเป็นเรื่องของเคาน์เตอร์
  · **เทสที่แก้/เพิ่ม**:
    - `pharmacy-policy-decision-contract.test.mts` → **38 เทส (รันผ่านแล้ว)** เพิ่ม/แก้เรื่องช่องทาง:
      ออนไลน์บล็อกยาใบสั่งแม้มีใบอนุมัติ · ค่าปริยายเป็นชุดออนไลน์ · ช่องทางที่ไม่รู้จักตกไปที่ชุดเข้ม
    - `pharmacy-counter-authorization-db-contract.test.mts` → **16 เทส** (จาก 11) เพิ่มเครื่อง+กะจริง
      ในเทส แล้วคุม: ปิดเคสในทรานแซกชันเดียวกับบิล · เคส `APPROVED` (ช่องแข่ง) ก็ถูกปิด · เคสของกะอื่น
      ปิดไม่ได้ · เคสของตะกร้าอื่นปิดไม่ได้ · การประทับเภสัชกรประจำกะไม่ทับคนแรก · เส้นทางอ่านบันทึก
    - `pharmacy-approval-reuse-db-contract.test.mts` → เทสยาใบสั่งเปลี่ยนทิศ: ออนไลน์บล็อกแม้มี
      ใบอนุมัติ · เคาน์เตอร์จ่ายได้ด้วยใบอนุมัติเดียวกัน · ใบเดียวใช้ครั้งเดียวยังคุมอยู่
  · **ยังไม่ได้ทำ (จงใจ)**: การคืนยาเข้าสต็อกยังไม่มีด่านของร้านยา · ไม่มีการบังคับว่าต้องมีเภสัชกร
    อยู่เวรสำหรับยาสามัญ (ประทับว่าใครอยู่ ไม่ได้บังคับ) · เส้นทางกู้บิลของหน้า POS ไม่มีเทสอัตโนมัติ
    (repo นี้ไม่มี harness ทดสอบ React component) — ต้องลองด้วยมือที่หน้าจอ
- **"ใครอนุมัติได้" ที่หน้า POS (2026-08-31, ไม่มี migration, ไม่มี permission ใหม่)**
  · `tsc` ผ่าน · pure 571 · build ผ่าน · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์**
  · **ต้นเหตุ**: กล่องเลือกผู้อนุมัติทั้ง 8 จุดกรองแค่ `hasPin` (บางจุดไม่ตัดตัวเองออกด้วยซ้ำ)
    **ไม่เคยกรองว่าคนนั้นอนุมัติงานนี้ได้จริงไหม** → แคชเชียร์เลือกชื่อ → เดินไปตาม → หัวหน้ามากด
    PIN ต่อหน้าลูกค้า → เพิ่งรู้ว่าไม่มีสิทธิ์ → เดินไปตามคนใหม่ · ระบบรู้คำตอบตั้งแต่ก่อนเลือกอยู่แล้ว
  · **`approvers` เป็นคนละชุดกับ `cashiers` โดยตั้งใจ** — `listPosCashiers()` คัดเฉพาะคนที่มี
    `pos.sell` ซึ่งถูกสำหรับ "ใครกำลังขาย" แต่ผิดสำหรับผู้อนุมัติ: **ผู้จัดการที่ไม่เคยยืนขายเอง
    ไม่มี `pos.sell` แล้วหายจากลิสต์ทั้งที่เป็นคนเดียวในร้านที่อนุมัติได้**
  · คนที่มีสิทธิ์แต่ยังไม่ตั้ง PIN **ยังขึ้นในลิสต์แบบเลือกไม่ได้พร้อมบอกเหตุผล** (กฎเดียวกับ
    dropdown คนขาย) — หายไปเฉย ๆ แล้วให้เดาว่าทำไมคนที่ควรอนุมัติได้ไม่อยู่ในลิสต์ แย่กว่า
  · **สิทธิ์ที่ใช้จริงไม่ตรงกับที่เดา 1 จุด**: การคืนตั้งแต่ ฿500 ใช้ **`payment.refund`**
    (`approvalRuleForRefundAmount`) ไม่ใช่ `order.return` — dropdown เดิมยื่นพนักงานขายทุกคนให้เลือก
  · ข้อความ 403 ทั้ง **25 จุด** ผ่าน `posPermissionDeniedMessage()` แล้ว: บอกชื่องานภาษาคน +
    **role ที่ทำได้ในร้านนี้จริง** + ทางไปต่อ (ให้คนมากด PIN / ไปเพิ่มสิทธิ์ที่ `/admin/permissions`)
    · **ไม่โชว์ชื่อ permission ดิบ** เพราะ `pos.return.noreceipt` ไม่มีความหมายกับคนหน้าเคาน์เตอร์
  · **⚠️ กฎที่พลาดง่ายสุด: `Administrator` ได้ทุกสิทธิ์โดยปริยายและ *ไม่มีแถวใน*
    `bms_role_permissions`** — ลืมใส่ชื่อเข้าไปเอง เจ้าของร้านหายจากคำตอบทั้งที่อนุมัติได้
    (มีเทส DB คุม · ยืนยันแดงจริงด้วยการถอดเงื่อนไขออก)
  · **ด่านของเภสัชกรเป็นใบอนุญาต ไม่ใช่ permission** จึงไม่อยู่ในชุดนี้และข้อความแยกต่างหาก —
    เขียนรวมจะกลายเป็นบอกความจริงผิดว่า "ขอสิทธิ์แล้วจ่ายยาได้"
  · **รายการที่กรองแล้วเป็น UX ไม่ใช่ด่าน** — ทุก route ยังตรวจสิทธิ์ผู้อนุมัติซ้ำฝั่ง server เหมือนเดิม
  · เทสใหม่ 2 ชุด: `scripts/pos-approvals-contract.test.mts` (4 เทส pure — กันไม่ให้ dropdown ไหน
    กลับไปกรองแค่ PIN, สิทธิ์ที่จอกรองต้องเป็นตัวที่เคาน์เตอร์ตรวจจริง, และไม่มีข้อความ 403 ตัวไหน
    บอกแค่ว่าล้มเหลว) + `scripts/pos-approvals-db-contract.test.mts` (5 เทส DB)
  · **⚠️ บทเรียนตอนแก้: อย่าใช้ regex ที่มี `.*?` ข้ามบรรทัดแก้ JSX** — รอบแรกใช้ `re.subn` แล้ว
    group ที่ไม่ผูกปลายทางไปกลืน `<option>` ของคอมโพเนนต์ตัวเองและกล่อง "เลือกประเภทเหตุผล"
    ที่ไม่เกี่ยวกันเลย · ต้องแทนที่ด้วยสตริงตรง ๆ ทีละจุด แล้วให้ `tsc` เป็นตัวจับ (จับได้ครบทั้ง 5 จุด)

- **รอบหก — เก็บของค้างให้จบ (2026-08-31, ไม่มี migration ใหม่)** · `tsc` ผ่าน · pure 567 ·
  build ผ่าน · **DB สีเขียวทั้งชุดเป็นครั้งแรก** (เดิมแดง 2 ตัวมาตั้งแต่ก่อนเริ่มงานนี้)
  1. **⚠️ สองบิลที่ขายพร้อมกันบนกะเดียวกัน deadlock (`40P01`) — บั๊กจริงของเส้นทางขาย ไม่ใช่เทสเปราะ**
     · ต้นเหตุคือ **ลำดับล็อกกลับหัวกันระหว่างสองทรานแซกชัน**:
       `finalizePosSale()` ล็อกแถวกะด้วย `FOR UPDATE` เป็นคำสั่งแรก แล้วค่อยตัดสต็อก ·
       `createOrder()` จองสต็อกก่อน แล้วเพิ่งแตะแถวกะตอน `INSERT bms_orders` ซึ่ง **FK
       `pos_shift_id` บังคับ `FOR KEY SHARE` ให้เอง** → บิล B ถือสต็อกรอ KEY SHARE ของกะ
       ที่บิล A ถือ FOR UPDATE อยู่ ส่วน A รอสต็อกที่ B ถือ = วน
     · **เกิดจริงทุกครั้งที่เครื่องเดียวยิงสองคำขอพร้อมกัน** (retry ซ้อนคำขอเดิม) ไม่ใช่แค่ในเทส
     · แก้ด้วยการขอล็อกกะ **โหมดเดียวกับที่ FK จะขอ** (`FOR KEY SHARE`) ตั้งแต่ต้นทรานแซกชันของ
       `createOrder` เมื่อมี `posShiftId` → ทั้งสองเส้นทางเรียงเหมือนกัน: กะ → สต็อก
     · ไม่ตรวจ `status` ตรงนั้นโดยตั้งใจ — การตัดสินว่ากะเปิดอยู่ไหมยังเป็นหน้าที่ของ
       `finalizePosSale` ตามเดิม ที่เพิ่มคือลำดับล็อกอย่างเดียว
     · ยืนยัน: เทส `two simultaneous bills cannot both claim the same serial` จาก **แดง (1022ms
       = รอจน deadlock detector ตัด)** เป็น **เขียว 92ms**
  2. **teardown ของ `pharmacy-counter-authorization-db-contract` ลบ `bms_pos_shifts` ก่อน
     `bms_orders`** ซึ่ง FK เป็น NO ACTION → แดงทุกครั้งและ **ทิ้งข้อมูลทดสอบค้างในฐาน dev ทุกรอบ**
     · สลับลำดับแล้ว · ยืนยัน `bms_tenants WHERE slug LIKE 'fake-%'` เหลือ 0
  3. **⚠️ cron `orders/release-expired` เป็นทรานแซกชันเดียวครอบทุก tenant** → บิลใบเดียวที่ปล่อยไม่ได้
     ทำให้ **ไม่มีร้านไหนถูกปล่อยเลย และเป็นแบบนั้นตลอดไป** (รอบถัดไปเจอใบเดิมอีก) · endpoint ตอบ
     500 เงียบ ๆ ไม่มีใครรู้ว่ามันหยุดทำงาน — ฐาน dev มีบิลค้าง 21 ใบและ job นี้ throw ทุกครั้ง
     · แก้เป็น **ทรานแซกชันต่อบิล**: ใบที่ล้ม rollback เฉพาะใบนั้นและถูกรายงานใน `failed`
       (route spread ผลลัพธ์อยู่แล้ว ตัวเลขจึงโผล่ใน response เอง) ใบที่เหลือปล่อยตามปกติ
     · เพิ่มพารามิเตอร์ `tenantId` (ไม่บังคับ) — cron ยังกวาดทั้งแพลตฟอร์มเหมือนเดิม แต่เทส/งานซ่อม
       รายร้านทำได้โดยไม่แตะบิลของร้านอื่นในฐานเดียวกัน **(นี่คือเหตุผลที่เทสรอบก่อนทำเรื่องนี้ไม่ได้)**
     · เทสใหม่ใน `multi-store-stock-db-contract`: บิลดี 1 + บิลที่ reserved drift 1 → ปล่อยใบดีสำเร็จ
       ใบเสียอยู่ใน `failed` และ **ยังเป็น PENDING รอคนมาดู** ไม่ถูกยกเลิกทิ้ง
  4. ข้อความตอนความสามารถยังไม่เปิด บอกที่ไปเปิดแล้ว (`— เปิดที่ /admin/stock-models`) ทั้ง 4 จุด
  · **แก้โน้ตที่ผมเขียนไว้เกินจริงรอบก่อน**: การ "แลกเปลี่ยนสินค้า" ของของชั่งขาย **ไม่ได้พัง** —
    ตัวสร้างตะกร้าจากบิลเดิมคำนวณ `baseQty = qty / packQty` ซึ่งของชั่งได้ 1 และ `packQty` เป็นกรัม
    บรรทัดจึงกลับมาเป็น "750 หน่วยฐาน × ราคาต่อกรัม" ซึ่งถูกต้อง · เสียแค่ป้ายกำกับว่าเป็นบรรทัดชั่ง
- **recheck รอบเจ็ด — เจอของจริง 4 จุด แก้ครบแล้ว (2026-08-31, ไม่มี migration ใหม่, ไม่มี permission ใหม่)**
  · `tsc` ผ่าน · **pure 573** · production build ผ่าน · **DB 311 เทส เขียวทั้งหมด**
  · ทั้งสี่จุดผ่าน mutation test แล้ว (ย้อนโค้ดกลับทีละจุด → แดงถูกตัวทุกครั้ง)
  1. **⚠️ กระดานครัวตาบอดถาวรหลังมีตั๋วครบเพดาน** — `listKitchenTickets()` เรียง `created_at` **ขึ้น**
     แล้ว LIMIT และหน้าจอถามแบบไม่กรองสถานะ (`limit: 200`) → ร้านอาหารที่ผ่านตั๋วเกิน 200 ใบ
     (ไม่กี่วัน) จะได้ตั๋ว 200 ใบ **แรกของร้าน** ซึ่งเสิร์ฟไปหมดแล้วตลอดไป **ตั๋วใหม่ไม่มีวันขึ้น
     กระดานอีกเลย** ครัวอ่านว่า "เครื่องขายไม่ส่งออร์เดอร์มา" ทั้งที่ขายอยู่
     · แก้เป็น: ตั๋วที่ยังไม่จบ (NEW/PREPARING/READY) เห็นเสมอ · ตั๋วที่เสิร์ฟแล้วเห็นเฉพาะ 12 ชม.
       ล่าสุด · **ตั๋วที่ถูกยกเลิกไม่ขึ้นกระดานเลย** (กระดานไม่มีช่องให้มัน การให้กินโควตาเพดาน
       คือการเบียดงานจริงออก) · ตัดด้วยใหม่สุดก่อนแล้วเรียงกลับเป็นเก่าก่อนสำหรับลำดับทำอาหาร
       — เพดานจึงทิ้งของเก่า ไม่ใช่ทิ้งของใหม่ · การกรองด้วย `status` ตรง ๆ ยังเข้าถึงของเก่าได้เหมือนเดิม
  2. **⚠️ ยกเลิก/void บิลแล้วตั๋วครัวค้างเปิด** — void เดินผ่าน `processPosReturn` และ `cancelOrder`
     ไม่เคยแตะ `bms_kitchen_tickets` เลย (FK เป็น CASCADE แต่บิลไม่ได้ถูกลบ) → เงินคืนไปแล้วแต่ครัว
     ยังทำอาหารต่อแล้วทิ้ง โดยกระดานไม่บอกเหตุผล · เพิ่ม `cancelKitchenTicketsForOrderInTx()` แล้วเรียก
     **ในทรานแซกชันเดียวกัน** ทั้งที่ตราประทับ void (`pos.ts`) และ `cancelOrderInTx()` (`orders.ts`)
     · ตั๋วที่เสิร์ฟไปแล้วไม่ถูกย้อน (อาหารออกจากครัวจริง) · ยิงซ้ำได้ (รอบสองคืน 0)
  3. **⚠️ ตัดของเสียทำ invariant ของล็อตพัง** — `recordInventoryWastage()` ลด `bms_inventory`
     อย่างเดียว ไม่แตะ `bms_inventory_lots` ทั้งที่ `lots.ts` ประกาศไว้เองว่า
     `SUM(lots.qty) = current_stock` และบังคับได้ด้วย "ทุก write ต้องผ่านไฟล์นี้" เท่านั้น ·
     **ของเสียคือทางหลักที่ของหมดอายุออกจากชั้น** → ล็อตที่เพิ่งทิ้งยังถือจำนวนอยู่ FEFO หยิบไปจ่าย
     รอบถัดไป (หรือชน "lot ที่ขายได้ไม่พอ" กลางบิลลูกค้า) และ `reconcileLotTotals()` ขึ้นแดงโดยหา
     ต้นเหตุไม่เจอ · เพิ่ม `consumeLotsForWastageInTx()` ใน `lots.ts` (ให้ทุก write ยังอยู่ไฟล์เดียว)
     · **ตัดล็อตที่หมดอายุก่อนและไม่ข้ามของหมดอายุ — กลับทางกับเส้นทางขายโดยตั้งใจ** เพราะของที่ทิ้ง
       คือของหมดอายุ ถ้าข้ามไปตัดล็อตดี ของหมดอายุจะอยู่ในระบบตลอดไป · สินค้าที่ไม่ได้ตามล็อตผ่านไปเฉย ๆ
     · ล็อตน้อยกว่ายอดรวม (drift ที่มีอยู่ก่อน) = **ปฏิเสธทั้งรายการและ rollback ยอดรวมด้วย**
       ไม่ใช่ทำครึ่งเดียวแล้วทำให้ drift ลึกลง (มีเทสคุม)
  4. **⚠️ สวิตช์ความสามารถของร้านไม่มีด่านสิทธิ์ที่ server** — `bmsUpsertStoreCapability`/
     `bmsResetStoreCapability` ตรวจแค่ "เป็น admin scope" ทั้งที่หน้าจอซ่อนปุ่มไว้หลัง `product.edit`
     และ mutation อื่นทุกตัวในโมดูลเดียวกันเรียก `requirePermission` · **การซ่อนปุ่มฝั่ง client ไม่ใช่ด่าน**
     — สวิตช์พวกนี้เปลี่ยนพฤติกรรมการขายทั้งร้าน (ปิดชั่งขาย/เปิดสูตร/เปิดคิวครัว) · ใส่ `product.edit`
     ให้ทั้งสองตัว และ `product.view` ให้ query `bmsStoreCapabilities` (ผู้เรียกมีที่เดียวคือหน้า
     `/admin/stock-models` ซึ่ง gate ด้วย `product.view` อยู่แล้ว · sidebar ใช้
     `bmsKitchenBoardEnabled` คนละตัว จึงไม่กระทบ)
  · เทสที่เพิ่ม: `multi-store-stock-db-contract` เป็น 12 เทส (ของเสียตัดล็อตหมดอายุก่อน + ยอดล็อต
    ยังเท่ายอดรวม · ล็อตไม่พอต้อง rollback ยอดรวม · เพดานกระดานต้องทิ้งตั๋วเก่าไม่ใช่ตั๋วใหม่ ·
    ตั๋วเสิร์ฟเมื่อ 2 วันก่อนไม่อยู่บนกระดานแต่กรองด้วย status ยังเจอ · void/ยกเลิกปิดตั๋วที่เปิดอยู่)
    · `store-capability-gates-contract` เป็น 4 เทส (สแกนซอร์ส: ทุก mutation ในโมดูลต้องเรียก
    `requirePermission` · `cancelOrderInTx` และบล็อก void ต้องปิดตั๋วครัว)
  · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** เหมือนเดิม (ยืนยันได้แค่ระดับ service/GraphQL + เทส)
  · **ยังไม่ได้แก้ (คนละเรื่อง มีมาก่อน 9.40)**: การปรับยอดจากการนับสต็อก (`COUNT_ADJUST`, 7.98)
    ก็ไม่แตะ `bms_inventory_lots` เหมือนกัน — ร้านที่ตามล็อตแล้วนับสต็อกจะได้ drift แบบเดียวกับ
    ที่ของเสียเพิ่งแก้ไป ต้องตัดสินใจว่าจะให้คนนับระบุล็อตหรือให้ระบบเฉลี่ยตาม FEFO

- **`9.44__bms_restaurant_pos.sql` (POS ร้านอาหาร: ผังโต๊ะ + บิลเปิด + รอบครัว) — งานของ codex บน
  branch `codex/restaurant-pos-split` แล้ว recheck/แก้ต่อ 2026-09-01** · **apply เข้า dev DB แล้ว
  (ยืนยัน 5 ตาราง + 4 revision trigger + RLS/GRANT + `bms_orders.restaurant_check_id` ด้วย
  `to_regclass`/`pg_constraint` จริง)** — ยังไม่ได้ apply เข้า production · **ไม่มี permission ใหม่**
  (`pos.sell` สำหรับทุก action ของบิลโต๊ะ · `pos.device.manage` สำหรับปุ่มสร้างผังเริ่มต้น ·
  `order.ship` สำหรับเดินสถานะตั๋วครัว)
  · ผลรันจริงรอบนี้: `tsc` ผ่าน · **pure 587 เทสผ่าน** · production build ผ่าน ·
    **DB 326 เทสผ่านทั้งหมด** (รวมชุดใหม่ `scripts/restaurant-pos-db-contract.test.mts` 13 เทส
    ที่สร้าง tenant ร้านอาหารของตัวเองแล้วลบทิ้ง — รันซ้ำได้ ยืนยัน 2 รอบ ไม่มีข้อมูลค้าง)
  · **เปิดดูจริงในเบราว์เซอร์แล้ว 2026-09-01** (dev บน localhost:3000 · สร้างร้านทดสอบ
    `fake-browser-check-*` + เครื่อง + กะ แล้วลบทิ้งครบ) — เดินครบเส้น: สร้างผังเริ่มต้น 12 โต๊ะ ·
    เปิดโต๊ะ · ค้นเมนู · เพิ่มรายการพร้อมโน้ตถึงครัว · ส่งครัว (ยอดขึ้นเป็น ฿240 · รอบ 1 · ส่งแล้ว) ·
    จอครัวขึ้นตั๋ว "โต๊ะ 11 · รอบ 1" แล้วกด "เริ่มทำ" ผ่าน · คิดเงิน → toast "ปิดบิลแล้ว ฿240.00"
    · ยืนยันในฐานหลังจบ: order `COMPLETED` ผูก `restaurant_check_id`, บิลโต๊ะ `PAID`,
    สต็อก 200→198, `reserved_stock` = 0, **`bms_kitchen_tickets` = 0 แถว** (ไม่มีตั๋วซ้ำตอนปิดการขาย)
    · ไม่มีใบกำกับเพราะร้านทดสอบไม่ได้จด VAT (ถูกต้อง ไม่ใช่บั๊ก)
  · **⚠️ `/admin/kitchen` เปิดดูใน dev container นี้ไม่ได้ และไม่ใช่เพราะโค้ดชุดนี้** —
    `NEXT_PUBLIC_*` ของ container ชี้ไป **`https://jachoei.com/api/graphql` (production)**
    หน้า admin ทุกหน้าในเครื่องนี้จึงยิง GraphQL ข้ามไปโปรดักชันแล้วโดน CORS บล็อก →
    `myBmsPermissions` ว่าง → ขึ้น "บทบาทของคุณดูออร์เดอร์ไม่ได้" · **เป็นปัญหาการตั้งค่า dev
    ที่มีอยู่ก่อน และควรแก้แยกต่างหาก** (เบราว์เซอร์ dev ไม่ควรคุยกับ production)
    · แทนที่จะข้ามการตรวจ ยิง **เอกสาร query ตัวเดียวกับที่หน้านั้นใช้** ไปที่ API ในเครื่อง
      แล้วได้ `orderId: null` + `tableCode/tableName/roundNo/kitchenNote` ครบโดยไม่มี
      non-null error — ซึ่งคือจุดที่กระดานเคยพังพอดี
  · **สถาปัตยกรรม**: ส่งครัว = สร้าง/รีเฟรช order `PENDING` หนึ่งใบต่อบิลโต๊ะ (จองวัตถุดิบก่อนครัวเริ่มทำ)
    · คิดเงิน = ปิด order ใบเดิมผ่าน `recordPosSale()` (เจอ 23505 ของคีย์เดิมแล้วเดินเส้นทาง replay)
    ดังนั้นเงิน/สต็อก/FEFO/ลิ้นชัก/ใบกำกับยังมีสูตรเดียวเหมือนบิลค้าปลีก
  · **บั๊กที่เจอตอน recheck และแก้แล้ว (เรียงตามความแรง)**:
    1. **⚠️ `withCheckLock` ยึด client ของ pool ไว้ระหว่างรอ** — ใช้ `pg_advisory_lock()` แบบ session
       ซึ่งต้องยืม connection มาถือตลอดงาน แล้วงานข้างในยืมอีกใบเพื่อเปิดทรานแซกชัน · `POSTGRES_POOL_MAX`
       ค่าปริยาย 10 → **5 โต๊ะกดพร้อมกันทำให้ทุก query ของทั้ง instance ล้มด้วย connection timeout**
       ไม่ใช่แค่ร้านอาหาร · เปลี่ยนเป็น mutex ในโปรเซส (เรียงคำขอของบิลเดียวกัน) + `pg_advisory_xact_lock()`
       **ในทรานแซกชันของงานเอง** (ข้าม instance โดยไม่ยืม connection เพิ่ม) · ความถูกต้องข้าม instance
       ไม่ได้พึ่ง mutex: `status='OPEN'`+`FOR UPDATE`, `version = $n` ตอนผูกออร์เดอร์, unique index
       โต๊ะที่เปิดอยู่, และคีย์กันบิลซ้ำต่อ (บิล, version)
    2. **⚠️ บิลโต๊ะถูกล่ามไว้กับเครื่อง/กะ/คนที่เปิดโต๊ะ** — `finalizePosSale()` ล็อกบิลด้วย
       `cashier_user_id` ด้วย · ผลจริง: **เด็กเสิร์ฟเปิดโต๊ะ แคชเชียร์คิดเงิน = "บิลไม่ตรงกับเครื่อง กะ
       หรือพนักงานผู้ขาย" ต่อหน้าลูกค้า** และโต๊ะที่นั่งคาบเกี่ยวการเปลี่ยนกะ **คิดเงินไม่ได้ตลอดไป
       พร้อมสต็อกที่จองค้าง** · ตอนนี้เงื่อนไขเหลือ "สาขาเดียวกัน" (มาจากตัวเครื่อง) แล้วประทับ
       เครื่อง/กะ/คนขายใหม่ทั้งบน order และบนบิลโต๊ะ — ยอดขายเป็นของกะที่รับเงิน (กฎเดียวกับมัดจำ 9.0)
    3. **⚠️ `orderId` ของ `BmsKitchenTicket` เป็น `ID!`** ขณะที่ตั๋วบิลโต๊ะเกิด **ก่อน** มีออร์เดอร์
       → GraphQL non-null violation + `ticket.orderId.slice()` ที่ `/admin/kitchen`
       = **กระดานครัวพังทั้งหน้าทันทีที่ร้านอาหารส่งครัวใบแรก** (พังกับร้านที่ฟีเจอร์นี้ทำมาให้พอดี)
       · แก้เป็น nullable + เพิ่ม `source/checkId/tableCode/tableName/roundNo/kitchenNote`
       แล้วกระดานแสดง "โต๊ะ · รอบ N" แทนเลขบิล (คีย์ i18n ใหม่ `dine_in`/`round`/`note` ทั้ง th/en)
    4. **⚠️ `cancelRestaurantCheck()` ล้มทุกครั้ง 100%** — `concat_ws(E'\n', note, $4)` ทำให้ Postgres
       เดาชนิดของ `$4` ไม่ได้ (`42P18`) · **ปุ่มยกเลิกบิลไม่เคยทำงานเลย** · เจอเพราะเทส DB ชุดใหม่
       เป็นตัวแรกที่เรียกเส้นทางนี้ (เทสของ codex เป็น source-scan ทั้งชุด) · แก้ด้วย `$4::text`
    5. **คีย์กันบิลซ้ำค้างแล้วเก็บเงินสองรอบ** — settle เดิมอ่าน `settlement_idempotency_key` ที่เก็บไว้
       ก่อน · ถ้ากดคิดเงินล้มไปครั้งหนึ่ง (ยอดไม่ตรง) แล้วลูกค้าสั่งเพิ่ม → version ขยับ → ส่งครัวใหม่
       = ออร์เดอร์จองใบใหม่คีย์ใหม่ · คีย์เก่าไม่ชนอะไรแล้ว `recordPosSale` จึง **สร้างออร์เดอร์ใบที่สอง
       จองสต็อกซ้ำ และใบจองเดิมค้าง PENDING ตลอดไป** · ตอนนี้อ่านคีย์จากแถวออร์เดอร์จองตรง ๆ
       (`RETURNING idempotency_key`) จึง drift ไม่ได้โดยโครงสร้าง
    6. **ออร์เดอร์จองที่ถูกทิ้งยังถือคีย์เดิม** → ส่งครัวซ้ำที่ version เดิมชน `uq_bms_orders_idempotency`
       เป็น error ดิบของ Postgres (createOrder ไม่ดัก 23505) และ **โต๊ะนั้นส่งครัวไม่ได้อีกจนกว่าจะมีคน
       เพิ่ม/ลบรายการ** · `releaseReservationOrder()` ยกเลิกแล้วล้างคีย์ (unique index ไม่นับ NULL)
    7. **บิลค้างที่ `CLOSING` เป็นทางตัน** — แก้รายการไม่ได้ ยกเลิกไม่ได้ · การเก็บเงินที่ throw ไม่เคย
       คืนสถานะ = **โต๊ะหายไปทั้งคืน** · ตอนนี้คืนเป็น `OPEN` ทุกทางออกที่ไม่ใช่ SOLD (รวมกรณี throw)
       และยกเลิกได้จาก `CLOSING` ด้วย แต่ห้ามยกเลิกบิลที่มีออร์เดอร์สถานะอื่นนอกจาก PENDING/CANCELLED
    8. **ตั๋วครัวขึ้นเฉพาะเมนูที่ผูกสูตร (`stock_policy='RECIPE'`) และไม่ดูความสามารถของร้าน** —
       ร้านที่ยังไม่ได้ผูกสูตรให้เมนูไหนเลย (สภาพจริงของร้านที่เพิ่งเริ่ม) เห็น **จอครัวว่างทั้งที่
       ออร์เดอร์วิ่งอยู่** และน้ำ/ของหวานไม่มีวันขึ้นจอ · บิลโต๊ะทุกบรรทัดคือของที่ต้องมีคนยกไปเสิร์ฟ
       จึงออกตั๋วทุกบรรทัดที่ส่ง โดย gate ด้วย `KITCHEN_WORKFLOW` (เส้นทาง retail ยังกรอง RECIPE ตามเดิม
       เพราะบิลค้าปลีกมี SKU ที่ไม่ใช่อาหารปนอยู่)
    9. **ร้านอาหารเข้าหน้าค้าปลีกไม่ได้เลย** — `/pos` redirect ทิ้งแบบไม่มีทางกลับ ทั้งที่ **คืนสินค้า /
       รับของเข้าคลัง / มัดจำ / บัตรของขวัญ / ขายเชื่อ อยู่ที่หน้านั้นเท่านั้น** · เพิ่ม `?surface=retail`
       เป็นทางกลับ + ปุ่ม "โหมดค้าปลีก" ที่หน้าโต๊ะ
   11. **คำเตือน "มีรายการที่ยังไม่ส่งครัว" ขึ้นตั้งแต่โต๊ะยังว่างเปล่า และป้ายยอดเงินโกหก** (เจอตอน
       เปิดดูจริง) — จอเทียบ `version !== reservedVersion` ตรง ๆ แต่บิลที่เพิ่งเปิดมี version 0 กับ
       reservedVersion `null` เสมอ · และป้าย "ยอดบิลปัจจุบัน ฿0.00" ขณะที่มีอาหารรออยู่ในบิลแล้ว
       (`amount_due` ขยับตอนส่งครัวเท่านั้น) · ตอนนี้ใช้เกณฑ์เดียวคือ "มีบรรทัดสถานะ NEW ไหม"
       (`hasUnsent`) ทั้งคำเตือน ปุ่มส่งครัว ปุ่มคิดเงิน และป้ายที่สลับเป็น "ยอดที่ส่งครัวแล้ว"
       · **ยอดที่แสดงยังมาจาก server เสมอ ห้ามรวมเองที่จอ** (จะกลายเป็นสูตรเงินชุดที่สอง — มีเทสคุม)
   10. **จอครัวและการเดินสถานะตั๋วไม่กรองสาขา** — ครัวสาขา A เห็นและกด "เสิร์ฟแล้ว" ให้อาหารของสาขา B ได้
       · `listKitchenTickets()` และ `updateKitchenTicketStatus()` รับ location (เครื่องส่งของตัวเองเสมอ)
       · กระดานหลังบ้านยังดูทั้งร้านตามเดิม · `removeRestaurantCheckItem`/`cancelRestaurantCheck`
       ก็ไม่เคยกรองสาขา แก้แล้วเช่นกัน
  · **แก้เทสที่แดงตามเวลาของวัน (คนละโมดูล เจอตอนรันชุด DB)** — `commission-db-contract` คำนวณ "วันนี้"
    จาก `toISOString()` (UTC) ขณะที่ `getCommissionReport()` ตัดช่วงวันด้วย `AT TIME ZONE 'Asia/Bangkok'`
    → **แดง 6 ตัวทุกคืนระหว่าง 00:00–07:00 เวลาไทย** โดยที่โค้ดไม่ผิด (เจอตอนรัน 01:06 +07) ·
    เปลี่ยนไปใช้ `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" })`
  · **แคตตาล็อกผู้ช่วย**: เพิ่ม capability `restaurant.dine-in` + guide 3 ตัว (เปิดโต๊ะ · ส่งครัว/จอครัว ·
    ย้ายโต๊ะ/ยกเลิก/เก็บเงิน) → **46 capability · 97 guide** และปักคำถาม 8 ข้อในคอร์ปัส (รวม 59)
    · `/pos/restaurant` อยู่ใต้ `app/(pos)/pos/layout.tsx` จึงได้ `PosGuideAssistant` มาแล้วโดยไม่ต้องแก้
    · **ย้ายคำถาม "ระบบรองรับร้านอาหารไหม" จาก `inventory.stock-model` มาที่ `restaurant.dine-in`**
      (ก่อน 9.44 stock-model เป็นคำตอบจริงข้อเดียว ตอนนี้คนที่ถามหมายถึงบริการหน้าร้าน) แล้วให้
      stock-model ถือคำถามของตัวเองแทน — สองรายการปักคำถามข้อความเดียวกันคนละคำตอบไม่ได้
    · **เพดานผลค้นของ `searchAssistantKnowledge` ขยับ 20 → 32** เพราะหน้าเครื่องขายแตะ **21 ไกด์**
      แล้วเทส "current-page retrieval returns the complete declared guide set" แดง (ตัวที่หลุดคือ
      `pos.void-return`) · ผู้เรียกจริงสองตัวใน `tools/catalog.ts` ขยับ 20 → 24 ให้ครอบหน้าที่ใหญ่สุด
  · **หน้า `/pos/restaurant` เป็นภาษาไทย hardcode ทั้งหน้า — ตั้งใจ ไม่ใช่ของค้าง** เพราะ
    `/pos/page.tsx` (9,800 บรรทัด) ก็ไม่ได้ใช้ `t()` เลย จอเครื่องขายทั้งสองหน้าจึงเป็นไทยเหมือนกัน
    (`i18n-keys-contract` จับ hardcode ไม่ได้ ต้องดูด้วยตา — ของ `/admin/kitchen` ที่เพิ่มรอบนี้ผ่าน `t()` ครบ)
  · **เทส 2 ชุด — รันทั้งคู่ก่อน merge ทุกครั้งที่แตะร้านอาหาร**: `scripts/restaurant-pos-contract.test.mts`
    (13 เทส pure · **เขียนใหม่ทั้งไฟล์** เพราะของเดิม `assert.match(src, /pg_advisory_lock/)` เขียวจาก
    **คอมเมนต์** ที่ผมเขียนอธิบายรูปแบบเก่า — ทุก assertion ตอนนี้อ่านซอร์สที่ตัดคอมเมนต์ออกแล้ว) +
    `scripts/restaurant-pos-db-contract.test.mts` (13 เทส DB) · **ทั้งสองชุดผ่าน mutation test แล้ว
    14 แบบ** (8 pure + 6 DB) แดงถูกตัวทุกครั้ง
  · **ยังไม่ได้ทำ (จงใจ)**: แยกบิล/รวมบิลข้ามโต๊ะ · ลูกค้าสั่งเองผ่าน QR · จองโต๊ะ/บัตรคิว ·
    printer routing แยกสถานี · offline-first · ยกเลิกตั๋วบนจอครัว **ไม่** ลบรายการออกจากบิลและไม่คืนสต็อก
    (เป็นการแก้บิล ต้อง void) · ถ้าจองสต็อกใหม่ไม่สำเร็จตอนส่งรอบถัดไป (เครื่องอื่นแย่งของไประหว่างนั้น)
    รายการที่ครัวทำอยู่จะไม่มีสต็อกจองและคิดเงินไม่ได้จนกว่าจะส่งครัวสำเร็จ — จึง `console.error` ไว้
    ไม่ใช่คืนเป็นรหัสสถานะเงียบ ๆ

- **`9.51__bms_product_catalog_foundation.sql` (แคตตาล็อกสินค้า: ตัวเลือกแยกจากสต็อก + ช่องทางขาย
  ที่ต้องประกาศ + กลุ่ม Modifier) — งานของ codex บน branch `codex/product-catalog-foundation`
  แล้ว recheck/แก้ต่อ 2026-09-02** · **⚠️ ยังไม่ได้ apply เข้า dev DB และยังไม่ได้รันเทส DB ในรอบนี้**
  (เครื่องนี้ Docker ไม่ได้รัน — `docker ps` ต่อ daemon ไม่ได้เลย) ต้อง apply แล้วรันชุด DB ที่แตะ
  แคตตาล็อก/POS/ร้านอาหารให้ผ่านก่อนเชื่อว่าใช้ได้จริง · ไม่มี permission ใหม่
  · **⚠️ createOrder / resolvePosScan / recordPosSale / listSellableProducts / หน้าร้านออนไลน์
    อ่าน `bms_product_sales_surfaces` กับทุกบิลของทุกร้าน** — ฐานที่ยังไม่ apply `9.51`
    **ขายไม่ได้ทั้งระบบ** (กฎเดียวกับ `9.40`) ต้อง apply migration ก่อน deploy โค้ดชุดนี้เสมอ
  · ผลรันจริงรอบนี้: `npm run gate` ผ่านทั้งชุด — `tsc --noEmit` · **pure 629 เทส** (จาก 623) ·
    production build
  · **บั๊กที่เจอตอน recheck และแก้แล้ว (เรียงตามความแรง)**:
    1. **⚠️ บิลโต๊ะเก็บเงินไม่ได้ทั้งใบ ถ้าเมนูไม่ได้เปิด Retail POS** — `canonicalizePosSaleLines()`
       ตรึงเงื่อนไขไว้ที่ `surface = 'RETAIL_POS'` แต่การเก็บเงินบิลโต๊ะเดินผ่าน `recordPosSale()`
       ตัวเดียวกับบิลค้าปลีก · เทมเพลต **PREPARED_MENU** (ค่าปริยายของปุ่มเพิ่มสินค้าในร้านอาหาร)
       ตั้งช่องทางขายเป็น `RESTAURANT_POS` **ตัวเดียว** → สั่งได้ ครัวทำเสร็จ แล้ว
       **คิดเงินไม่ได้** โดยขึ้นเป็น `INVALID_PACK` ที่ไม่ได้พูดถึงช่องทางขายเลย = ล้มกลางโต๊ะ
       หลังอาหารออกไปแล้ว · แก้ให้รับ surface ของบิลใบนั้น (`restaurantCheckId` → RESTAURANT_POS)
       ส่วนเส้นทางพักบิลค้าปลีกยังเป็น RETAIL_POS ตามเดิม
    2. **⚠️ ข้อมูลตัวอย่างกลายเป็นสินค้าที่มองไม่เห็นและขายไม่ได้ทุกช่องทาง** —
       `seedFakeProducts()` เขียน `bms_products` ด้วย INSERT ตรง (ไม่ผ่าน `upsertProduct`) จึงไม่มี
       ใครใส่แถว `bms_product_sales_surfaces` ให้ · เส้นทางนี้**ไม่ใช่แค่เครื่องมือ dev**:
       `createOnboardingSampleData()` (ปุ่ม "สร้างข้อมูลตัวอย่าง" ของร้านใหม่) เรียกตัวเดียวกัน →
       ร้านที่เพิ่งสมัครกดปุ่มนี้จะได้สินค้าที่ดู active ในหน้าแคตตาล็อกแต่ยิงที่ POS ไม่เจอ
       หน้าร้านออนไลน์ว่าง และ AI หาไม่เจอ · แก้ให้ seeder ใส่ช่องทางขายเอง
       (ร้าน archetype `restaurant` ได้ `RESTAURANT_POS` เพิ่ม) · ลบสินค้าแล้วแถวหายเองด้วย
       FK `ON DELETE CASCADE` จึงไม่ต้องแก้ cleanup
    3. **⚠️ เปิดสินค้าเดิมมากดบันทึกเฉย ๆ ก็ล้ม หรือได้ตัวเลือกงอกใบที่สอง** —
       `normalizeProductVariantCode()` บังคับ `A-Z0-9` + uppercase + แปลงช่องว่างเป็น `_`
       แต่รหัสตัวเลือกอยู่ใน namespace เดียวกับ `bms_inventory.size` ที่เป็น free text มาตลอด
       และไมเกรชันก็ยกค่าเดิมมาแบบตรงตัว · seed ของ repo เองมีทั้ง `"60ml"`, `"100 ml"`,
       `"10 เม็ด"`, `"1 ชุด"` → ฟอร์มสินค้าเติม `variantCodes` จากค่าเดิมกลับมาตอนบันทึก
       ไซซ์ไทยถูก **ปฏิเสธทั้งก้อน** ส่วน `"60ml"` กลายเป็น `"60ML"` = ตัวเลือกใบใหม่ที่ไม่มี pack
       ผูกไว้ (readiness join ด้วย code ตรงตัว) แล้วติด blocker ของตัวเอง · แก้ให้เก็บสะกด
       ตามที่ร้านพิมพ์ (trim + ยุบช่องว่าง, กันอักขระควบคุม, ยาวไม่เกิน 64) และเพิ่ม
       `resolveStoredVariantCodeInTx()` ให้ code ที่ต่างกันแค่ตัวพิมพ์ลงแถวเดิม ไม่งอกซ้ำ
    4. **⚠️ backfill ถอดช่องทางขายของเมนูที่ตั้งราคาผ่าน base pack** — เงื่อนไขเดิมเทียบแต่
       `p.price > 0` ทั้งที่ราคาหน่วยฐานอยู่ที่ `bms_product_packs.price` ได้ (`8.1`/`9.22`)
       และ `bms_products.price` ค้างที่ 0 ได้ตามดีไซน์ → ร้านอาหารที่ทำแบบนั้นจะเสีย
       `RESTAURANT_POS` + ช่องทางลูกค้าทั้งชุดตอน migrate · แก้ให้ทดสอบ "ราคาที่ใช้ขายจริง"
       (product price **หรือ** base pack price ที่ active) ทั้งสองบล็อก
    5. **⚠️ ตัวเลือกยาของเภสัชกรตามช่องทางของเคสไม่ได้** — `bmsPharmacyCatalog` (หน้า
       `/admin/pharmacy-queue`, สิทธิ์ `pharmacy.assessment.review`) และการค้นยาใน
       `bmsGenerateMedicationSuggestions` ตกลงค่าปริยาย `CUSTOMER_AI` + บังคับ `ONLINE_ORDER`
       → ยาที่ร้านขายเฉพาะหน้าร้าน **หายจากตัวเลือกของเคสที่มาจากเครื่องขาย** (เคาน์เตอร์จ่ายยา
       ที่เพิ่งซักถามไปแล้วไม่ได้) และเคสออนไลน์ก็เสี่ยงได้ใบอนุมัติที่ `createOrder` ปฏิเสธทีหลัง
       · แก้ให้เลือก surface จาก **`channel_id`** ของเคส (`pos` → RETAIL_POS ไม่ใช่ CUSTOMER_AI)
       ตามกฎเดียวกับ `approveAssessment` และหน้าคิวส่ง `assessmentId` มาให้
    6. **คอลัมน์ "เปิดขาย" ในไฟล์นำเข้ากลายเป็นคอลัมน์ที่กรอกแล้วไม่มีผล** — `upsertProduct`
       ไม่สนใจค่า `active` ที่ส่งมาแล้ว (ของใหม่ = ฉบับร่างเสมอ, ของเดิม = คงค่าเดิม) แต่เทมเพลต
       ยังมีคอลัมน์นี้ให้กรอกพร้อม TRUE/FALSE parser · ถอดคอลัมน์ออกจากเทมเพลต/HEADER_MAP
       แล้วบอกในหน้านำเข้าตรง ๆ ว่ารายการใหม่เป็นฉบับร่างต้องไปกดเปิดขายเอง
       (คีย์ `admin_product_import.draft_only_desc` ทั้ง th/en)
    7. `bmsSetProductActive` ไม่ได้ห่อ `publishProduct` ด้วย `toGqlError` → readiness ที่ไม่ผ่าน
       ออกเป็น 500 และ **ไม่มีบรรทัด log ที่มี SQLSTATE** ซึ่งเป็นสิ่งที่คอมเมนต์ของ helper ตัวนั้น
       บอกเองว่าจำเป็นตอนฐานยังไม่ apply migration (42P01)
  · **กฎชุดใหม่เข้าแคตตาล็อกผู้ช่วยแล้ว** — 9.51 เขียนกฎ (ฉบับร่าง/ช่องทางขาย/ตัวเลือก/สำเนา)
    ไว้ใน `admin/manual/page.tsx` เท่านั้น ซึ่งกลับไปเป็น "สองสำเนา" แบบที่ย้ายออกไปแล้วเมื่อ
    2026-08-28 และผู้ช่วยตอบคำถาม "เพิ่มสินค้าแล้วขายไม่ได้" ไม่ได้ · ย้ายเป็นกลุ่ม
    `limits.product-catalog` (7 ข้อ th/en) ผูกกับไกด์ `products.create` ·
    `inventory.stock-sale-blockers` · `inventory.stock-models` · `pos.restaurant-open-check`
    แล้วปักคำถาม 2 ข้อในคอร์ปัส (**61 ข้อ** จาก 59) — ปักไว้ที่ `inventory.stock-sale-blockers`
    เพราะการค้นจริงพามาที่นั่นก่อน และนั่นคือคำตอบที่ถูกสำหรับ "ทำไมขายไม่ได้"
    (`products.create` อยู่ใน `expectAlso`)
  · เทส: `scripts/product-catalog-foundation-contract.test.mts` **13 เทส** (จาก 7 · pure) ·
    **ทั้ง 6 จุดผ่าน mutation test แล้ว** (ย้อนโค้ดกลับทีละจุด → แดงถูกตัวทุกครั้ง) · เทสสแกนซอร์ส
    ตัดคอมเมนต์ก่อนเทียบ (`withoutComments`) เพราะรอบแรกคอมเมนต์ที่ผมเขียนอธิบายกฎเก่าเอง
    ทำให้ assertion แดงผิดตัว — กับดักเดิมของเทสแบบสแกนซอร์สในไฟล์นี้
  · **ยังไม่ได้แก้ / ต้องรู้ก่อนใช้จริง**:
    - **readiness ถูกตรวจตอน "บันทึก" ของสินค้าที่เปิดขายอยู่ ไม่ใช่แค่ตอนเปิดขาย** —
      `upsertProduct`/`upsertProductStockPolicy`/`upsertProductRecipe` throw ถ้าสินค้า active
      แล้ว readiness ไม่ผ่าน · ร้านที่จด VAT แล้วมีสินค้า `vat_category = 'UNKNOWN'` จะแก้ชื่อ
      สินค้าไม่ได้จนตั้งประเภท VAT (แก้ได้ในฟอร์มเดียวกัน) แต่ blocker ที่แก้จากฟอร์มไม่ได้
      (เช่นยังไม่มีสูตรของบางไซซ์) จะล็อกการแก้ข้อมูลอื่นไว้ทั้งหมด — ยังไม่ตัดสินใจว่าจะผ่อนไหม
      · ผลข้างเคียงที่ตามมาด้วย: อนุมัติ synonym ของ AI (`aiSynonyms.reviewSynonymCandidate`)
      เรียก `upsertProduct` จึงล้มด้วย blocker ที่ไม่เกี่ยวกับ synonym
    - **นำเข้า 500 แถวที่เป็นสินค้า active เดิม = readiness 500 รอบ** (~10 query ต่อแถว) ยังไม่วัด
      เวลาจริง
    - **ยังไม่มีปุ่มเปิดขายแบบหลายรายการ** — นำเข้าเมนู 200 รายการแล้วต้องกดสวิตช์ทีละตัว
      · `bmsPublishProduct` มี resolver แล้วแต่ **ไม่มีผู้เรียกใน UI** (หน้า Products ใช้สวิตช์
      `bmsSetProductActive` ซึ่งวิ่งเข้า `publishProduct` อยู่แล้ว)
    - **กลุ่ม Modifier ถูกเขียนทับผ่าน modifier ทีละตัว** — `upsertProductModifier` upsert แถวกลุ่ม
      ด้วยค่าที่ส่งมาพร้อม modifier นั้น ตัวสุดท้ายที่บันทึกชนะทั้งกลุ่ม
    - **กลุ่มที่ `min_select >= 1` ทำให้สั่งจากช่องทางที่ไม่มี UI เลือกตัวเลือกไม่ได้เลย**
      (AI/ออนไลน์/ค้าปลีก) → `INVALID_ITEM MODIFIER_GROUP_MIN` ยังไม่มีทางออกนอกจากไม่ตั้งขั้นต่ำ
    - **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** ทั้งฟอร์มสินค้าใหม่ (template/variant/surface),
      การ์ด readiness, ปุ่มทำสำเนา และหน้า `/admin/stock-models` ที่เพิ่ม quick-create วัตถุดิบ
- **`9.52__bms_product_non_stock_policy.sql` (stock policy `NON_STOCK` — เมนูขายเร็วที่ไม่คุมวัตถุดิบ)
  บน branch `feat/non-stock-policy` (2026-09-02) · **apply เข้า dev DB แล้วและ verify กับ DB จริงแล้ว**
  — ยังไม่ได้ apply เข้า production · ไม่มี permission/capability/ตารางใหม่
  · **ต้นเหตุ**: เมนูร้านอาหารต้องเป็น `RECIPE` ซึ่งบังคับสร้างวัตถุดิบทีละตัว + กรอกสูตรทุกไซซ์ก่อน
    publish (`RECIPE_REQUIRED`) ร้านเล็กจึงเปิดขายเมนูแรกไม่ได้ · `NON_STOCK` ขายได้ทันที ไม่ตัดสต็อก
    ต้นทุนต่อจานอ่านจาก `bms_products.cost_price` (รายงานกำไรขั้นต้นใน `reports.ts` ใช้ค่านี้อยู่แล้ว)
    · เลื่อนขึ้นเป็น `RECIPE` ทีหลังได้ที่ `/admin/stock-models` (มีเทสคุม)
  · **⚠️ ต้อง apply migration ก่อน deploy โค้ดชุดนี้เสมอ** — `resolveStockConsumptionInTx`
    อ่าน `stock_policy` กับทุกบิลของทุกร้าน (กฎเดียวกับ `9.40`/`9.51`)
  · **หัวใจของ migration คือ view ไม่ใช่ CHECK** — `NON_STOCK` คืน `lines: []` จึงไม่มีแถว snapshot
    เลย ถ้าไม่ตัดมันออกจากกิ่ง legacy ของ `bms_order_stock_lines` view จะอ่าน "ไม่มี snapshot" ว่าเป็น
    บิลยุคก่อน `9.40` แล้วแปลเมนูเป็น "กินสต็อกตัวเอง 1 หน่วย" ทั้งที่แถวสต็อกค้างที่ 0 →
    **ขายไม่ได้เลยสักบิล** · มีเทส DB ที่ **สลับ view เป็นตัวที่ไม่มีเงื่อนไขนี้แล้วพิสูจน์ว่าพัง**
    จริงในเทสเดียว (คืน view เดิมใน `finally`)
  · **กับดักที่เจอตอนทำ (ทั้งสามเป็นบั๊กจริง ไม่ใช่เรื่องสไตล์)**:
    1. **`DROP VIEW` ทิ้ง GRANT ไปด้วย** — ลืม `GRANT SELECT ON bms_order_stock_lines TO bms_app`
       แล้วทุกเส้นทางที่เขียนของภายใต้ `SET LOCAL ROLE bms_app` ล้มด้วย `42501` (`8.8`/`9.3`/`9.40`
       ต่างก็ re-grant ทุกครั้ง — **ทุกครั้งที่ DROP/CREATE view นี้ต้อง GRANT ใหม่**)
    2. **การหาชื่อ CHECK ด้วย `pg_constraint` ต้องแคบพอ** — `bms_product_stock_policies` มี CHECK
       อีกตัว (`scale_mapping_check`) ที่อ้าง `stock_policy` ด้วย · ถ้า `LIMIT 1` เฉย ๆ จะ DROP ตัวผิด
       เงียบ ๆ · ต้องกรอง `array_length(conkey,1) = 1` + ตรวจว่า def มีค่าในลิสต์
    3. **`canonicalizePosSaleLines` ปฏิเสธเมนูที่ยังไม่เคยขาย** — เงื่อนไขเดิมคือ "มีแถว
       `bms_inventory` **หรือ** เป็นเซ็ต **หรือ** เป็น RECIPE" แต่แถวศูนย์ของ `NON_STOCK`
       เพิ่งถูกสร้างตอน `createOrder` ครั้งแรก → **บิลแรกของทุกเมนูใหม่ล้มด้วย `INVALID_PACK`**
       ทั้งที่หน้าจอไม่ได้บอกว่าเกี่ยวกับช่องทางขาย · แก้เป็น `IN ('RECIPE','NON_STOCK')`
  · **`resolvePosScan` แกะไซซ์จาก `bms_inventory`/pack เท่านั้น** สินค้าที่ยังไม่มีแถวสต็อกจึงได้
    `size = NULL` = สแกนแล้วเพิ่มลงบิลไม่ได้ · เพิ่มกิ่งที่ 4 ให้ตกไปอ่าน `bms_product_variants`
    (ความจริงของไซซ์ตาม `9.51`) — **กิ่งนี้ทำงานเฉพาะตอนสามกิ่งบนได้ NULL ซึ่งวันนี้แปลว่าพังอยู่แล้ว
    จึงไม่มีทาง regress** · ผลพลอยได้: เมนู `RECIPE` ที่ยังไม่เคยขายก็สแกนได้ด้วย
  · **ช่องทางขายเริ่มต้นจำกัดที่ `RESTAURANT_POS` ตามที่ตกลง แต่เหตุผลเดิมไม่จริงแล้ว** —
    ตอนตั้งโจทย์เชื่อว่า `createShipment()`/`releaseExpiredOrders()` ยังอ่าน `bms_order_items` ตรง ๆ
    · ตรวจแล้วทั้งคู่อ่าน view (แก้ไปตั้งแต่ recheck รอบสองของ `9.40`) ที่เหลืออ่าน order_items
    จริงมีแค่ **น้ำหนักค่าส่ง + รายการบนใบปะหน้า** ซึ่งต้องเป็นของที่ลูกค้าซื้อ ไม่ใช่สต็อก ·
    แปลว่า **เปิดช่องทางออนไลน์ให้ `NON_STOCK` ได้อย่างปลอดภัยเมื่อไหร่ก็ได้** ถ้าตัดสินใจใหม่
  · **Modifier ยังบล็อก `NON_STOCK`** เหมือน DIRECT/PACK (ตั้งใจ — modifier คือส่วนต่างวัตถุดิบของสูตร)
  · เทส: `scripts/non-stock-policy-contract.test.mts` (11 เทส pure · mutation test แล้ว) +
    7 เทสใน `multi-store-stock-db-contract` · **ชุด DB นั้นกลับมาเขียวครบ 18/18**
  · **⚠️ ของค้างที่ไม่ได้แก้ (คนละเรื่อง มีมาก่อน 9.52): `9.51` ไม่เคย verify กับ DB จริง แล้วทำให้
    ชุดเทส DB พังครึ่งชุด** — `9.51` บังคับว่าต้องมีแถว `bms_product_sales_surfaces` ถึงจะขายได้ แต่
    fixture ของเทสเขียน `bms_products` ตรง ๆ จึงไม่มีใครประกาศช่องทางให้ → `NOT_FOUND`/`INVALID_PACK`
    · baseline บน `d99bac86` = **176 ผ่าน / 159 แดง** · แก้ fixture ให้ 5 ชุดที่อยู่ในรัศมีของงานนี้แล้ว
    (multi-store-stock, restaurant-pos, bundles, promotions, price-tiers) → **209 ผ่าน / 127 แดง**
    และ **ยืนยันด้วยการ diff ชื่อเทสที่แดงว่าไม่มี regression สักตัว** · **ยังเหลืออีก 17 ชุด**
    (ar, commission, deposits, order-extra-lines, pharmacy-*, pos-loyalty, pos-serial, pos-shift-ops,
    product-barcode, product-vat-category, receipt-delivery, shop-archetype, store-credit,
    variant-reservations, loyalty, order-confirmation, pos-cross-branch-return) ที่เป็นสาเหตุเดียวกัน

- **`9.53__bms_kitchen_station_sla.sql` (เกณฑ์เวลาจอครัวแยกตามสถานี) + เสียงเตือน + ปุ่มย้อนสถานะ +
  ยก `/admin/kitchen` มาใช้โมดูลเดียวกัน — 2026-09-02** · **apply เข้า dev DB แล้ว** (ยืนยัน RLS +
  GRANT `bms_app` จริง) ยังไม่ได้ apply เข้า production · **ไม่มี permission ใหม่**
  (อ่านใช้ `product.view` แก้ใช้ `product.edit` = สิทธิ์เดียวกับหน้า `/admin/stock-models`)
  · `tsc` ผ่าน · pure **660** · build ผ่าน · DB ชุดร้านอาหาร+multi-store **37/37**
  · **เกณฑ์ 5/10 เดียวทั้งร้านใช้ไม่ได้จริง** — บาร์ชงชาเย็นเสร็จใน 2 นาที ครัวร้อนผัด 8-12 นาที
    เป็นปกติ · เกณฑ์เดียวจึงทำให้ครัวร้อนแดงตลอดเวลา (สีเลิกมีความหมาย) หรือบาร์ไม่เคยเตือนเลย
    · ยืนยันบนจอจริง: ตั๋วสามใบรอเท่ากัน 5:20 ได้ **คนละสี** ตามสถานี (บาร์แดง · ครัวร้อนปกติ ·
    ครัวเย็นเหลืองด้วยค่าปริยาย)
  · **สถานีเป็นข้อความอิสระบน `bms_product_stock_policies.kitchen_station` ไม่มีตารางของตัวเอง**
    ตาราง SLA จึง key ด้วยชื่อสถานี แถวของสถานีที่เลิกใช้ก็แค่ไม่มีใครอ่าน (ไม่ต้องตามลบ) ·
    หน้าตั้งค่าแสดงสถานีที่ **ยังไม่เคยตั้ง** ด้วย ไม่งั้นร้านต้องเดาว่าต้องพิมพ์ชื่อให้ตรงเป๊ะเอง
  · **ค่าที่ใช้ไม่ได้ต้องตกกลับค่าปริยาย ไม่ใช่ทำให้ทุกใบสีเดียว** (`slaForStation` ตรวจ
    เหลือง<แดง และตัวเลขที่อ่านไม่ออก) · ชั้นแอปตรวจซ้ำก่อนถึง CHECK ของฐาน เพราะข้อความ
    ของ Postgres อ่านไม่รู้เรื่องสำหรับคนตั้งค่าหน้าร้าน
  · **ปุ่มย้อนสถานะ: ถอยได้ทีละขั้น (`PREPARING→NEW`, `READY→PREPARING`, `SERVED→READY`)**
    เพราะกดผิดที่จอครัวเกิดจริงและบ่อย · **`CANCELLED` เป็นปลายทางถาวร ห้ามเพิ่มทางกลับ** —
    การยกเลิกตัดบรรทัดออกจากบิลไปแล้วในทรานแซกชันเดียวกัน การย้อนคือการ *แก้บิล* ต้องเอาบรรทัด
    กลับเข้าบิลพร้อมจองสต็อกใหม่ (ทางที่ถูกคือสั่งรอบใหม่) · มีเทส DB คุมทั้งสองทิศ
  · **`PREVIOUS_KITCHEN_STATUS` อยู่ใน `kitchenBoard.ts` ไม่ใช่ `kitchen.ts`** — หน้าจอเป็น client
    component ถ้าประกาศไว้ใน `kitchen.ts` (ซึ่ง import ตัวต่อฐานข้อมูล) การ import จากจอจะลาก `pg`
    เข้า bundle ของเบราว์เซอร์
  · **เสียงเตือนสังเคราะห์เอง (WebAudio) ไม่โหลดไฟล์** — จอครัวออฟไลน์ได้และไม่ต้องเปิด CSP ให้
    ไฟล์เสียงจากที่อื่น · **ต้องให้คนกดเปิดเอง** (เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ และครัว
    บางร้านเปิดเพลงอยู่แล้ว) · จำค่าไว้ใน `localStorage` · ดังเฉพาะตั๋วที่ **เพิ่งโผล่เทียบกับรอบก่อน**
    ไม่ใช่ทุกใบที่สถานะ NEW ไม่งั้นจะดังทุก 5 วินาทีตราบใดที่ยังมีงานค้าง · รอบแรกหลังเปิดจอถือเป็น
    การตั้งต้น · ยืนยันบนจอจริงด้วยการนับ oscillator: เงียบเมื่อไม่มีอะไรใหม่ · ดังเมื่อมีตั๋วใหม่ ·
    ไม่ดังซ้ำตอน poll รอบถัดไป
  · **`/admin/kitchen` ใช้ `kitchenBoard.ts` ตัวเดียวกับเครื่องขายแล้ว** (รวมใบ + ตัวนับ + เกณฑ์ตาม
    สถานี + ปุ่มย้อนกลับ) และเรียก mutation ใหม่ `bmsUpdateKitchenTicketsStatus(ids, status)` ซึ่ง
    วิ่งเข้า service เดียวกับ REST ของเครื่องขาย — ทรานแซกชันเดียว ทั้งหมดหรือไม่เลื่อนเลย
    · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** เพราะ `NEXT_PUBLIC_*` ของ container dev ชี้ GraphQL ไป
      production (ปัญหาที่มีมาก่อน จดไว้ตั้งแต่ `9.44`) — ผ่าน `tsc` + build + เทสสแกนซอร์สเท่านั้น
  · **เทสสแกนซอร์สสองตัวใน `restaurant-pos-contract` ถูกเล็งใหม่** เพราะการรับตั๋วที่ไม่มี `orderId`
    ย้ายจากหน้าจอไปอยู่ใน `kitchenGroupLabel()` — assertion เดิม (`ticket.orderId ? …`) เขียวไม่ได้อีก
    และถ้าปล่อยไว้จะกลายเป็นเทสที่บังคับให้โค้ดกลับไปทำแบบเดิม
  · เทส: `kitchen-board-contract` **16 เทส** (จาก 13) + 2 เทสใหม่ใน `restaurant-pos-db-contract`
    (ย้อนสถานะ · SLA เก็บ/ลบ/ปฏิเสธค่าผิด)
  · **ยังไม่ได้ทำ (จงใจ)**: แยกจอตามสถานีจริง (ใช้ตัวกรอง) · เสียงต่างกันตามความเร่ง ·
    ให้ร้านตั้งเกณฑ์ต่อ "เมนู" ไม่ใช่แค่ต่อสถานี

- **จอครัวใหม่ (`/pos/restaurant` แท็บครัว) — ไม่มี migration, ไม่มี permission ใหม่ (2026-09-02)**
  · `tsc` ผ่าน · pure **657** · build ผ่าน · **เปิดดูจริงในเบราว์เซอร์แล้ว** (ป้อนตั๋วปลอมผ่าน
    `window.fetch` แล้วให้ React เรนเดอร์เอง — ยืนยันการรวมใบ ตัวนับ ตัวกรอง เมนู ⋯ และการเลื่อนในเลน)
  · **1 ใบ = (โต๊ะ/บิล + รอบ + สถานี) ไม่ใช่ 1 รายการ** — ตรรกะอยู่ใน `lib/bms/kitchenBoard.ts`
    ซึ่ง **ตั้งใจไม่ import อะไรเลย** (เทสได้โดยไม่ต้องมี DB แบบ `loyaltyMath.ts`) · ฐานข้อมูลยังเก็บ
    1 แถวต่อรายการเหมือนเดิม การรวมเกิดที่จอเท่านั้น
    - **ตัวเลือกต่างกันห้ามยุบรวม** ("หวานน้อย" กับแก้วธรรมดาชงคนละแบบ) โน้ตถึงครัวก็เช่นกัน
    - **สถานีอยู่ในคีย์การจัดกลุ่ม** — ครัวร้อนกับบาร์เป็นคนละคน ถ้ารวมข้ามสถานี ปุ่มของคนหนึ่ง
      จะไปขยับงานของอีกคน
  · **⚠️ ป้ายบนหัวเลนและข้างชื่อสถานีนับ "จาน" ไม่ใช่จำนวนใบ** — ถ้านับใบ ชามะนาว 3 แก้วที่ยุบ
    เป็นใบเดียวจะขึ้นเป็น 1 แล้วครัวประเมินงานผิด ซึ่งกลับหัวกับเหตุผลที่รวมใบตั้งแต่แรก
    (เจอตอนเปิดดูจริง: ป้ายขึ้น 4 ทั้งที่มีอาหารค้าง 8 จาน) · ข้อความ toast ใช้เกณฑ์เดียวกัน
  · **ตัวนับเวลาของเลน "พร้อมเสิร์ฟ" นับจาก `updated_at` ไม่ใช่ `created_at`** — คำถามของช่องนั้น
    คือ "อาหารวางรอนานแค่ไหน" ไม่ใช่ "สั่งมานานเท่าไร" · ถ้านับจากตอนสั่ง ทุกใบจะแดงค้างตลอดเวลา
    แล้วสีเลิกมีความหมาย · เกณฑ์ 5/10 นาทีเป็นค่าคงที่ชุดเดียว **ยังไม่แยกตามสถานี** (บาร์ควรเร็ว
    กว่าครัวร้อน — ต้องมีที่ให้ร้านตั้งค่าก่อน)
  · **`updateKitchenTicketsStatus` เลื่อนทั้งใบในทรานแซกชันเดียว "ทั้งหมดหรือไม่เลื่อนเลย"**
    (route ใหม่ `POST /api/pos/kitchen/tickets/status` · auth เหมือน route ทีละใบทุกประการ ·
    เพดาน `KITCHEN_BULK_LIMIT = 50`) · **แกนของการเลื่อนถูกแยกเป็น
    `updateKitchenTicketStatusInTx()` แล้วทั้งทางเดี่ยวและทางกลุ่มเรียกตัวเดียวกัน** — สองสูตรจะ
    drift แล้วการตัดบรรทัดออกจากบิลตอนยกเลิก (กับ audit ในทรานแซกชันเดียวกัน) จะหลุดไปทางใดทางหนึ่ง
    · ยิงทีละใบจากเบราว์เซอร์ทำไม่ได้: ใบที่ล้มกลางชุดทิ้งงานเดียวกันคาไว้สองช่องบนกระดาน
  · "ยกเลิก" ย้ายไปหลังปุ่ม ⋯ (ของเดิมปุ่มทำลายอยู่ติดปุ่มที่กดบ่อยสุดด้วยขนาดเท่ากัน) · เมนูนั้น
    ถือ **การเลื่อน/ยกเลิกทีละรายการ** ไว้ด้วย สำหรับรอบที่ครัวทำเสร็จไม่พร้อมกัน
  · หัวจอเดิม (ชื่อ + คำอธิบาย + ปุ่มรีเฟรชเต็มขนาด ~72px) เปลี่ยนเป็นแถวเดียว 34px ที่เป็น
    **ตัวกรองสถานี** + สถานะอัปเดตอัตโนมัติ · สถานีที่เลือกไว้หมดงานแล้วจะรีเซ็ตตัวกรองให้เอง
    ไม่ให้ค้างอยู่กับช่องว่างจนครัวอ่านว่าไม่มีออร์เดอร์
  · เทส: `scripts/kitchen-board-contract.test.mts` (13 เทส pure) + เทสใหม่ใน
    `restaurant-pos-db-contract` (**ผ่าน mutation test แล้ว**: เปลี่ยนลูปให้ commit ทีละใบ → แดงถูกตัว)
  · **ยังไม่ได้ทำ (จงใจ)**: เสียงเตือนตั๋วใหม่ · ปุ่มย้อนสถานะกลับ · แยกจอตามสถานีจริง (ใช้ตัวกรอง
    แทน) · **หน้า `/admin/kitchen` ยังเป็นของเดิม** (คนละหน้า ใช้ `t()` i18n ครบ) — ถ้าจะให้เหมือนกัน
    ต้องยกโมดูล `kitchenBoard.ts` ไปใช้ที่นั่นด้วย

- **`9.54__bms_kitchen_station_master.sql` (สถานีครัวเป็น entity: ทะเบียน + ผูกสาขา + เปิด/ปิด +
  ลำดับ) เขียนแล้วบน branch `feat/kitchen-station-master` (2026-09-03)** · `tsc --noEmit` ผ่าน ·
  **pure 724 เทสผ่านทั้งหมด** · production build ผ่าน · **⚠️ ยังไม่ได้ apply เข้า dev DB และยังไม่ได้
  รันเทส DB ในรอบนี้** (เครื่องนี้ Docker ไม่ได้รัน — `docker ps` ต่อ daemon ไม่ได้เลย) ต้อง apply
  แล้วรัน `scripts/kitchen-station-db-contract.test.mts` (18 เทส) + ชุดร้านอาหาร/multi-store ให้ผ่าน
  ก่อนเชื่อว่าใช้ได้จริง · ไม่มี permission ใหม่ (อ่าน `product.view` · จัดการ `product.edit`)
  · **⚠️ ต้อง apply migration ก่อน deploy โค้ดชุดนี้เสมอ** (กฎเดียวกับ `9.40`/`9.51`) — แต่รัศมี
    ไม่เท่ากับสองตัวนั้น ไล่แล้วได้ดังนี้:
    - **กว้างสุดคือ readiness ของสินค้า**: `getProductReadinessInTx()` LEFT JOIN ตารางใหม่ และถูก
      เรียกทุกครั้งที่บันทึกสินค้าที่เปิดขายอยู่ **ของทุกร้าน ไม่ใช่แค่ร้านอาหาร** → ฐานที่ยังไม่
      apply จะบันทึกสินค้าไม่ได้ทั้งระบบ
    - **เส้นทางครัวแตะเฉพาะร้านที่เปิดคิวครัว**: `enqueueKitchenTicketsInTx()` ออกก่อนด้วย
      `isCapabilityEnabledInTx(KITCHEN_WORKFLOW)` และ `sendRestaurantKitchenRound()`/
      `listRestaurantMenu()` เป็นของร้านอาหารเท่านั้น → **การขายของร้านทั่วไปไม่ถูกกระทบ**
    - **จอครัวของเครื่องขายไม่ดับ**: `/api/pos/kitchen/tickets` กลืน error ของทะเบียนสถานีแล้ว
      ตกกลับไปใช้ปุ่มกรองจากตั๋วจริง (= พฤติกรรมก่อน 9.54)
  · **ต้นเหตุ**: สถานีครัวมีอยู่แค่เป็นสตริงบน `bms_product_stock_policies.kitchen_station` ทุกอย่าง
    ที่อ้างถึงสถานีจึงอ้างด้วย "ชื่อที่พิมพ์ตรงกันเป๊ะ" — เกณฑ์เวลา (`9.53`) คีย์ด้วยชื่อ · ตั๋วเก็บชื่อ ·
    ตัวกรองบนจอครัวสร้างจากชื่อที่บังเอิญมีงานค้างอยู่ · พิมพ์เกินมาหนึ่งช่องว่าง = สถานีใหม่ทั้งสถานี
    และ **เปลี่ยนชื่อสถานีไม่ได้เลย** เพราะชื่อคือ identity
  · **สามข้อที่เป็นแกนของงานนี้**:
    1. **สถานีไม่ใช่สาขา และไม่แยกสต็อก** — สต็อกยังตัดตาม `location_id` ของบิลเหมือนเดิม
       มีเทสสแกน `9.54` ว่าไม่แตะ `bms_inventory`/`bms_orders`/`bms_payments`/`bms_order_items` เลย
    2. **`location_id NULL` = ใช้ได้ทุกสาขา** · มีค่า = สาขานั้นสาขาเดียว และบิลของสาขาอื่นได้
       `station_id = NULL` → ตั๋วไปช่อง "ไม่ระบุสถานี" ซึ่งยังเห็นและยังกดได้ · ทางเลือกอื่นคือส่งตั๋ว
       ไปครัวที่สาขานั้นไม่มีอยู่จริง = อาหารไม่มีใครทำโดยไม่มีใครรู้
    3. **ตั๋วเก็บทั้ง `station_id` และชื่อ (snapshot)** — เปลี่ยนชื่อวันนี้ต้องไม่เขียนประวัติเมื่อวานใหม่
       · จอ/เกณฑ์เวลาจึงจับคู่ด้วย id ก่อน ชื่อทีหลัง (`slaForStationRef`, `ticketMatchesStation`)
  · **นิพจน์เลือกสถานีมีชุดเดียว** `kitchenStationColumnsSql()` — ผู้เรียก 3 ที่ (คิวครัวบิลค้าปลีก ·
    รอบครัวบิลโต๊ะ · **จอสั่งอาหาร**) · สองสูตรจะ drift แล้ววันหนึ่งเส้นทางหนึ่งยอมส่งตั๋วข้ามสาขา
    · เจอตอน recheck: จอสั่งอาหารเคยกรองสาขาที่ `ON` ของ JOIN แล้ว `COALESCE` ไปหาชื่อเดิม →
    เมนูที่ผูกกับสถานีของ **อีกสาขา** โผล่เป็นหมวดหมู่บนจอสาขานี้ แต่พอกดส่งครัวจริง ตั๋วไปช่อง
    "ไม่ระบุสถานี" (จอบอกอย่าง ครัวได้อีกอย่าง)
  · **การเขียนสถานีลงสินค้าก็มีชุดเดียว** `resolveKitchenStationForProductInTx()` — ฟอร์มสินค้ากับ
    หน้ารูปแบบสต็อกเคยถือสำเนาของกฎ "id ชนะชื่อ + ยกชื่อขึ้นเป็นแถวหลัก + id ต้องเป็นของร้านนี้"
    คนละชุด (รอบแรกเขียนไว้สองที่จริง ๆ) · ตอนนี้เหลือที่เดียวและมีเทสห้ามผู้เรียกหาชื่อสถานีเอง
  · **ชื่อสถานีต้องไม่ซ้ำทั้งร้าน (ข้ามสาขา ข้ามสถานะ)** เพราะเกณฑ์เวลายังคีย์ด้วยชื่อ — สองสถานีชื่อ
    "บาร์" = ตั๋วใบเดียวมีเกณฑ์สองชุด · เปลี่ยนชื่อสถานีจึงย้ายคีย์ของแถวเกณฑ์เวลาให้ในทรานแซกชัน
    เดียวกัน (ลบแถวกำพร้าที่ถือชื่อใหม่อยู่ก่อน ไม่งั้น UPDATE ชนคีย์หลัก)
  · **`UNIQUE (tenant_id, location_id, code)` เฉย ๆ ใช้ไม่ได้** — NULL ไม่ชนกับ NULL สถานีระดับร้าน
    จึงซ้ำได้ไม่จำกัด · ต้องเป็นดัชนีบางส่วนสองตัว (`WHERE location_id IS NULL` / `IS NOT NULL`)
  · **ชื่อล้วนที่มาทางเส้นทางเก่าถูกยกขึ้นเป็นแถวหลักอัตโนมัติ** (`ensureKitchenStationByNameInTx`)
    — ผู้เรียกทางนี้คือฟอร์มสินค้าและ `devSeed` · **ไฟล์นำเข้าสินค้ายังไม่มีคอลัมน์สถานีเลย**
    (ตรวจ HEADER_MAP ใน `ImportModal.tsx` ก่อนเชื่อคอมเมนต์ไหนที่อ้างถึงมัน — ถ้าจะเพิ่มคอลัมน์
    ต้องตัดสินใจแยกเพราะมันคือ "สัญญารูปแบบไฟล์") · ไม่ยกขึ้นเป็นแถวหลัก = สถานีกำพร้างอกขึ้น
    เรื่อย ๆ ซึ่งเปิด/ปิดไม่ได้ เรียงไม่ได้ และตั้งเกณฑ์เวลาให้ได้ต่อเมื่อพิมพ์ชื่อตรงเป๊ะ
    (= อาการที่งานนี้ทำมาเพื่อเลิก)
  · **สถานีที่ปิดใช้งานแล้วยังรับตั๋วโดยตั้งใจ** — ทำให้อาหารหายจากกระดานเพราะการตั้งค่า แย่กว่ามีตั๋ว
    บนสถานีที่กำลังจะเลิกใช้ · readiness เตือน `KITCHEN_STATION_INACTIVE` /
    `KITCHEN_STATION_BRANCH_SCOPED` **เป็น warning ไม่ใช่ blocker** (บล็อก = ร้านขายไม่ได้เพราะการ
    ตั้งค่าที่แก้ทีหลังได้) · ปิดสถานีที่ยังมีเมนูเปิดขายผูกอยู่ต้องยืนยัน (`force`) ก่อน
  · **⚠️ กับดักที่เทสจับได้ (ไม่ใช่ตา): `\p{L}` ไม่ครอบสระ/วรรณยุกต์ไทย** — "ครัวร้อน" กลายเป็น
    "คร_วร_อน" เพราะ ั และ ้ เป็น `\p{Mn}` · ต้องใส่ `\p{M}` ด้วย · ฝั่ง SQL `[[:alnum:]]` จะนับ
    อักขระพวกนี้หรือไม่ **ขึ้นกับ locale ของเซิร์ฟเวอร์** จึงระบุช่วง `ก-๙` ตรง ๆ ในไมเกรชัน
    · รหัสสองฝั่งไม่จำเป็นต้องตรงกันแบบไบต์ต่อไบต์ (จับคู่สถานีใช้ "ชื่อ") แต่ต้องผ่าน CHECK เดียวกัน
  · **`printer_profile_id` เป็นช่องว่างเผื่ออนาคต ไม่มีตาราง ไม่มีผู้อ่าน ไม่มีผู้เขียน** — ห้ามเดา
    การต่อเครื่องพิมพ์จากคอลัมน์นี้ · per-station printer routing **ยังไม่ได้ทำ**
  · UI: การ์ด "สถานีครัว" ที่ `/admin/stock-models` (สร้าง/แก้/ปิด/ลำดับ/ขอบเขต/จำนวนเมนูที่ผูก) ·
    ช่อง Kitchen station ในฟอร์มรูปแบบสต็อกเปลี่ยนเป็น Select จากทะเบียน (ส่ง `kitchenStationId`) ·
    ฟอร์มสินค้ายังเป็น AutoComplete แต่ตัวเลือกมาจากทะเบียน · ตัวกรองบน `/admin/kitchen` และแท็บครัว
    ของ `/pos/restaurant` มาจากทะเบียน + สถานีที่มีตั๋วจริง เรียงตาม `sort_order`
    · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** (ผ่านแค่ `tsc` + build + เทส)
  · i18n: เพิ่ม `admin_stock.*` 27 คีย์ทั้ง th/en (`i18n-keys-contract` ผ่าน)
  · แคตตาล็อกผู้ช่วย: กลุ่มกฎใหม่ `limits.kitchen-stations` (7 ข้อ th/en) ผูกกับ
    `inventory.stock-models` · `kitchen.board` · `pos.restaurant-kitchen-round` + ปักคำถาม 2 ข้อ
    ("หลายครัวในสาขาเดียวตั้งยังไง" / อังกฤษ) ที่ `inventory.stock-models`
  · **สิ่งที่เจอเพิ่มตอน recheck รอบสอง (แก้ครบแล้ว)**:
    1. **ตั๋วยุคก่อน `9.54` (มีชื่อ ไม่มี id) หลุดจากปุ่มของครัวตัวเอง** — `ticketMatchesStation`
       เทียบ id อย่างเดียว · ตั๋วที่โค้ดรุ่นเก่าเขียนไว้ระหว่าง deploy จึงไปกองที่ปุ่มตกค้าง
       ทั้งที่เป็นครัวเดียวกัน · ตอนนี้ตั๋วที่ไม่มี id จับคู่ด้วยชื่อได้ และ
       `kitchenBoardStationFilters` ไม่งอกปุ่มที่สองที่เขียนชื่อซ้ำกับสถานีในทะเบียน
    2. **`resolveKitchenStationForProductInTx` เป็นโค้ดที่ไม่มีใครเรียก** ขณะที่ผู้เขียนจริงสองที่
       ถือสำเนาของกฎเดียวกันคนละชุด — ยุบเหลือชุดเดียวแล้ว (ดูด้านบน)
    3. **จอสั่งอาหารตอบไม่ตรงกับตั๋ว** เรื่องสถานีเฉพาะสาขา (ดูด้านบน)
    4. **`normalizeKitchenStationCode` สร้างรหัสที่ตัวตรวจของตัวเองปฏิเสธ** เมื่อชื่อขึ้นต้นด้วย
       สระ/วรรณยุกต์ลอย — ผู้ใช้ที่พิมพ์แต่ "ชื่อ" เจอ error เรื่องรูปแบบ "รหัส" ที่ไม่เคยกรอก
    5. `/api/pos/kitchen/tickets` เคยล้มทั้งจอถ้าทะเบียนสถานีอ่านไม่ได้ → กลืน error แล้วตกกลับไป
       ใช้ปุ่มกรองจากตั๋วจริง
    6. หน้า Stock models อ่านค่าฟอร์มระหว่าง render (`policyForm.getFieldValue`) ซึ่ง antd เตือน
       ว่าฟอร์มยังไม่ผูก — เปลี่ยนไปอ่านจากผลของ query
    7. `storeCapabilities` ตรวจ `KITCHEN_WORKFLOW` จาก `kitchen_station` อย่างเดียว → เพิ่ม
       `kitchen_station_id` ด้วย เพราะ id คือความจริงตั้งแต่ `9.54`
  · เทส: `scripts/kitchen-station-contract.test.mts` (15 เทส pure) + 6 เทสใหม่ใน
    `kitchen-board-contract` (รวม 22) + `scripts/kitchen-station-db-contract.test.mts` (18 เทส DB
    **ยังไม่ได้รัน**) · **ผ่าน mutation test แล้ว 5 แบบ** (ถอดการกรองสาขา · จับคู่ด้วยชื่ออย่างเดียว ·
    ลดสิทธิ์ mutation เป็น product.view · เลิกยกชื่อขึ้นเป็นแถวหลัก · จัดกลุ่มด้วยชื่อแทน id) แดงถูกตัว
    ทุกครั้ง · และ mutation ที่คอร์ปัสผู้ช่วย (ย้าย expectTop ไป `kitchen.board`) ก็แดงจริง
  · **⚠️ บทเรียนตอนแก้: `io.open(path,'w')` ของ Python บน Windows แปลง `\n` เป็น CRLF** — ไฟล์ในรีโป
    นี้บางไฟล์เป็น LF (เช่น `kitchenBoard.ts` ที่มีไบต์ NUL อยู่ในสตริง จึงถูก git มองว่า binary และ
    ไม่โดน autocrlf) การแก้ด้วยสคริปต์จึงทำให้ diff บวมจาก 96 เป็น 598 บรรทัดโดยไม่มีการเปลี่ยนเนื้อหา
    · ตรวจด้วย `git diff --stat` ทุกครั้งหลังแก้ด้วยสคริปต์ แล้วคืน EOL ให้ตรงกับ `git show HEAD:<path>`

- **`9.30__bms_ar_credit_sales.sql` (ขายเชื่อ + ลูกหนี้การค้า) เขียนแล้วบน branch `feat/ar-credit-sales`
  (2026-08-27)** — `tsc --noEmit` ผ่าน · production build ผ่าน · เทส pure **268 ตัวผ่านทั้งหมด**
  (ชุด `scripts/ar-contract.test.mts` ตอนนี้ 19 ตัว) · **⚠️ ยังไม่ได้ apply migration เข้า dev DB และ
  ยังไม่ได้รันเทส DB** (`scripts/ar-db-contract.test.mts` ตอนนี้ 25 ตัว) เพราะเครื่องนี้ไม่มี Postgres ของ BMS
  รันอยู่ — ต้อง apply + รันชุดนั้นให้ผ่านก่อนเชื่อว่าใช้ได้จริง แล้วค่อย apply เข้า production
  · seed permission ใหม่ 5 ตัว: `ar.view`/`ar.collect` (Manager/Sales/Cashier) · `ar.sell`
    (Manager/Sales) · `ar.manage`/`ar.writeoff` (Manager) — ไม่ apply = เมนู "ลูกหนี้การค้า" ไม่ขึ้น
    และปุ่มขายเชื่อที่หน้า POS ไม่โผล่ (เงียบ ๆ ตามดีไซน์ ไม่ใช่ 403)
  · **ต้นเหตุ**: `bms_payments.method` มี 7 ค่าแต่ไม่มีค่าไหนแปลว่า "ยังไม่ได้เงิน" ร้านค้าส่ง/ร้านที่มี
    ลูกค้าประจำเปิดบิลเชื่อจึงใช้ POS ตัวนี้ไม่ได้เลย (ไม่ใช่ไม่สะดวก — ทำไม่ได้)
  · **ขายเชื่อกลับด้านกับมัดจำ (9.0) คนละเรื่อง อย่าเอามาแทนกัน**: มัดจำ = ได้เงินบางส่วน ของยังอยู่
    กับร้าน บิลค้าง `PENDING` · ขายเชื่อ = ของออกไปแล้ว บิลปิดครบเส้น (ตัดสต็อก ออกใบกำกับ ให้แต้ม)
    แต่เงินยังไม่เข้า → เกิด **ลูกหนี้ซึ่งเป็นสินทรัพย์** ไม่ใช่บิลค้าง
  · **ทำเป็น "วิธีชำระเงิน" (`method = 'CREDIT'`) ไม่ใช่บิลที่ยังไม่จ่าย** เพื่อให้เส้นทางเดิมใช้ได้ทั้งเส้น
    โดยเฉพาะ **เส้นทางคืนของ** ซึ่งจัดสรรยอดคืนกลับไปที่ "แถวชำระเงินที่จ่ายมา" อยู่แล้ว → คืนของบิลเชื่อ
    จึงไปลดหนี้เองโดยไม่ต้องเขียนกฎใหม่ · ทำเป็นบิลค้างแทน = ต้องเขียนเส้นทางคืน/void/ใบกำกับใหม่ทั้งชุด
    · ผลพลอยได้ที่ได้มาฟรี: **จ่ายสดบางส่วน ค้างบางส่วน** ในบิลเดียว
  · **⚠️ สองตัวเลขที่ห้ามปนกัน**:
    1. `CREDIT` **ไม่ใช่เงินสด** — `drawerExpectedInTx()` กรอง `method = 'CASH'` อยู่แล้วจึงปลอดภัย
       โดยโครงสร้าง (กฎเดียวกับ `STORE_CREDIT` ที่ 8.9) · **มีเทส pure อ่านซอร์สคุมไว้** เพราะถ้าวันหนึ่ง
       มีคนแก้ให้รวมทุกวิธีชำระ ทุกร้านที่ขายเชื่อจะนับปิดกะเกินจริงเท่ายอดเชื่อทุกวันโดยที่บิลก็ถูก เงินก็ถูก
    2. **เงินที่เก็บได้ทีหลังเข้าลิ้นชักของกะที่รับ ไม่ใช่กะที่ขาย** — ลงเป็น `bms_pos_cash_movements`
       (IN) ในทรานแซกชันเดียวกับใบรับเงิน · ถ้าลง `bms_payments` ของบิลเดิม เงินจะไปโผล่ในกะที่ปิดไปแล้ว
  · **วงเงินถูกตรวจสองครั้งด้วยฟังก์ชันตัวเดียว** (`evaluateArCharge` ใน `lib/bms/arCredit.ts` ซึ่ง
    **ตั้งใจไม่ import อะไรเลย** แบบ `loyaltyMath.ts` เพื่อให้เทสได้โดยไม่ต้องมี DB): ก่อนสร้างบิล
    (ล้มแล้วไม่มีสต็อกถูกจอง) และในทรานแซกชันที่ตัดสต็อกพร้อม `FOR UPDATE` (สองเครื่องขายให้ลูกค้า
    คนเดียวกันพร้อมกันได้) · สองสูตรที่ตัดสินเรื่องเดียวกันจะ drift แล้วจอจะบอกว่าขายได้ทั้งที่ server ปฏิเสธ
  · **`round2` ในการเทียบวงเงินไม่ใช่การจัดหน้าตัวเลข มันคือด่าน** — 259.30 + 55.29 =
    314.59000000000003 ในเลขทศนิยมของ JS ทั้งที่ทั้งสองก้อนเป็นสตางค์ลงตัว ถ้าเทียบตรง ๆ บิลที่พอดีเป๊ะ
    จะถูกตีตกแบบสุ่มตามคู่ตัวเลข (มีเทสใช้เลขคู่นี้เป็น golden · ยืนยันด้วย mutation test 4 แบบ:
    ถอด round2 / ปฏิเสธที่ขอบวงเงิน / แถมวงเงิน 5 สตางค์ / ไม่นับยอดค้างเดิม — แดงถูกตัวทั้งหมด)
  · **`ar.sell` ไม่ให้ Cashier แต่แคชเชียร์ยังขายเชื่อได้ด้วย PIN ของคนที่มีสิทธิ์** และ **ผู้อนุมัติ
    เป็นคนขายเองได้** (แบบ 9.29 ไม่ใช่แบบส่วนลดมือ) — ร้านค้าส่งที่เปิดบิลเชื่อสิบใบต่อวันถ้าต้องตาม
    คนที่สองทุกใบจะเลิกใช้ระบบแล้วกลับไปจดสมุด
  · **ยอดบัญชีติดลบได้โดยตั้งใจ** (ต่างจากเครดิตร้าน 8.9 ที่ห้าม) = ร้านค้างลูกค้าจากการคืนของหลังจ่ายครบ
    · ใส่ `CHECK (balance >= 0)` = การคืนของที่ถูกต้องจะล้มกลางเคาน์เตอร์ ซึ่งแย่กว่ายอดติดลบ ·
    ยอดติดลบถูกย้ายใน ledger ไปหักใบค้างเก่าสุด/บิลเชื่อถัดไปภายใต้ account lock; ไม่เช่นนั้น account
    จะบอกว่าร้านค้างลูกค้าแต่ aging ยังบอกให้ไปตามหนี้จากลูกค้าคนเดียวกันพร้อมกัน
  · **รับเกินยอดค้างถูกปฏิเสธ ไม่ใช่เก็บเป็นเงินล่วงหน้าเงียบ ๆ** — เงินที่จ่ายเกินที่เคาน์เตอร์เกือบทั้งหมด
    คือพิมพ์ผิด · คนที่ตั้งใจจ่ายล่วงหน้าจริงให้ลงมัดจำ (9.0) หรือซื้อเครดิตร้าน (8.9)
  · **receipt idempotency ผูกกับ payload แล้ว** — ล็อกคีย์ tenant-wide ก่อนแตะ account/shift และเก็บ
    `request_hash`; retry คำขอเดิม replay แต่คีย์เดิมกับยอด/บัญชี/วิธีคนละก้อนตอบ
    `IDEMPOTENCY_CONFLICT` แทนการคืนใบรับเงินเก่าให้รายการใหม่หรือชน unique constraint เป็น 500
  · **ตัดใบเก่าก่อน (FIFO ตามวันครบกำหนด)** ไม่ใช่หักยอดรวม — อายุหนี้คือเครื่องมือเดียวที่บอกว่าหนี้
    ก้อนไหนค้างนาน หักยอดรวมเฉย ๆ จะทำให้ทุกใบดูค้างเท่ากันตลอดไป
  · **cache ทุกตัวคำนวณใหม่จาก ledger ไม่ใช่ `+=`** (`balance`, `settled_amount`, `credited_amount`)
    · `balanceMismatchCount` ต้องเป็น 0 เสมอ — ไม่ 0 คือมีทางเขียนที่ลืมคำนวณใหม่ **ห้ามปิดงบ**
  · **ยอดลูกหนี้คงค้างเป็นสินทรัพย์** (กลับข้างกับแต้ม/เครดิตร้านที่เป็นหนี้สิน) ส่งตัวเลขจาก
    `getArOutstanding()` ให้บัญชีก่อนปิดงบ
  · **หน้า UI: `/admin/receivables`** (เมนูกลุ่มร้านค้า ถัดจากการชำระเงิน) + การ์ดเครดิตลูกค้า/ปุ่ม
    "ขายเชื่อ"/ฟอร์มรับชำระที่หน้า POS — **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์ ผ่านแค่ `tsc` + build**
  · **ยังไม่ได้ทำ (จงใจ)**: ใบแจ้งหนี้/ใบวางบิลส่งลูกค้า · ดอกเบี้ย/ค่าปรับล่าช้า · ตารางผ่อนชำระ
    (มีวันครบกำหนดใบละหนึ่งวัน) · workflow ขออนุมัติวงเงิน (ผู้จัดการตั้งตัวเลขเอง)

- **`9.40__bms_multi_store_stock_capabilities.sql` + `9.41__bms_weighted_product_scale_mapping.sql`
  (ความสามารถสต็อกตามประเภทร้าน + สูตร/ตัวเลือก/คิวครัว/ของเสีย + บาร์โค้ดเครื่องชั่ง)
  **apply เข้า dev DB แล้ว ยืนยันด้วย `to_regclass` และคอลัมน์จริงแล้ว 2026-08-31** — ยังไม่ได้ apply
  เข้า production · **ไม่มี permission ใหม่** (อ่านใช้ `product.view`/`order.view` · แก้รูปแบบสต็อกใช้
  `product.edit` · เลื่อนรายการครัวใช้ `order.ship` · ตัดของเสียใช้ `stock.adjust`)
  · **⚠️ createOrder / resolvePosScan / recordPosSale อ่านตารางของ 9.40 กับทุกบิลของทุกร้าน**
    (`bms_product_stock_policies`, `bms_store_capabilities`) — ฐานที่ยังไม่ apply **ขายไม่ได้ทั้งระบบ
    ไม่ใช่แค่ร้านอาหาร** · repo นี้ไม่มี schema probe ที่ไหนเลยจึงไม่ได้เพิ่ม แต่แปลว่า
    **ต้อง apply migration ก่อน deploy โค้ดชุดนี้เสมอ** (บทเรียนเดียวกับ 9.29 ข้อ 1)
  · **แก้ต่อจากงาน codex 2026-08-31 (รอบนี้)** — ของที่ codex ทำค้างไว้แล้วทำให้ gate แดง/ฟีเจอร์เข้าไม่ถึง:
    1. **หน้าใหม่ 3 หน้าไม่มีคีย์ i18n สักตัว** (`admin_stock` 84 คีย์ · `admin_wastage` 22 ·
       `admin_kitchen` 17 รวมคีย์ที่ประกอบตอนรัน `status_*`/`move_*`) → `getMessage()` คืนชื่อ key ดิบ
       ทั้งหน้า และ `i18n-keys-contract` แดง 180 รายการ · เติมครบทั้ง th/en แล้ว
    2. **`CAPABILITY_COPY` ในหน้า stock-models เป็นภาษาไทย hardcode 13 ตัว** (คำอธิบายความสามารถ)
       เทส i18n จับไม่ได้เพราะไม่ได้ผ่าน `t()` → ผู้ใช้ที่ตั้งภาษาอังกฤษเห็นไทยล้วน · ย้ายเข้า
       `admin_stock.cap_<code>_title/_desc` แล้ว (เช่นเดียวกับ fallback `"ทำรายการไม่สำเร็จ"`)
    3. **สามหน้าใหม่ไม่มีเมนูใน sidebar เลย** — เข้าได้ทาง URL อย่างเดียว · เพิ่มแล้ว:
       Stock Models + Wastage อยู่ในกลุ่มร้านค้าต่อจาก Stock Counts (gate `product.view`) ·
       **กระดานครัวขึ้นเฉพาะร้านที่ `business_archetype = 'restaurant'`** (แบบเดียวกับ `isPharmacyShop`)
       เพราะ preset ของร้านอาหารเป็นประเภทเดียวที่เปิด `KITCHEN_WORKFLOW` · **ร้านประเภทอื่นที่ไปเปิด
       ความสามารถนี้เองยังไม่มีเมนู** (จงใจ — bootstrap query ของ sidebar อ่าน `bmsStoreCapabilities`
       ไม่ได้โดยไม่บังคับสิทธิ์ `product.view` ให้ทุกคน และ query นั้นแตะตารางของ 9.40 ซึ่งจะทำให้
       sidebar ของฐานที่ยังไม่ apply พังทั้งอัน)
    4. **แคตตาล็อกผู้ช่วยไม่รู้จักหน้าใหม่** → `work-assistant-knowledge-contract` แดงที่
       "Admin page has no guide: /admin/kitchen" · เพิ่ม guide 3 (`inventory.stock-models`,
       `inventory.wastage`, `kitchen.board`) + capability 3 (`inventory.stock-model`,
       `inventory.wastage-ledger`, `kitchen.workflow`) + **ปักคำถาม 9 ข้อในคอร์ปัส** (ไทย/อังกฤษ
       อย่างละชุด + คำถามแบบ "ระบบมี…ไหม") · แคตตาล็อกขึ้นเป็น **45 capability · 94 guide**
       (แก้ตัวเลขใน CLAUDE.md และ `docs/ai/work-assistant-coverage.md` ให้ตรงแล้ว)
    5. `docs/architecture/api.md` ไม่มีแถวของ `bmsStockCapabilities.ts` — เพิ่มแล้ว
  · **ผลรันจริงรอบนี้ (2026-08-31)**: `tsc --noEmit` ผ่าน · **pure 557 เทสผ่านทั้งหมด** (จาก 503) ·
    production build ผ่าน · **DB 291 เทส ผ่าน 289**
  · **⚠️ เทส DB ที่แดง 2 ตัวเป็นของเดิมบน `main` ไม่ใช่ของงานชุดนี้** — ยืนยันด้วยการ `git stash` แล้ว
    รันบน HEAD ได้ผลแดงเหมือนกันเป๊ะ · **ยังไม่ได้แก้ (คนละเรื่องกับงานนี้)**:
    1. `pos-serial-db-contract` → *two simultaneous bills cannot both claim the same serial* ล้มด้วย
       **deadlock `40P01` ที่ `bms_pos_shifts`** (FK KEY SHARE ตอน INSERT `bms_orders`) — สองบิลที่แข่งกัน
       ล็อกสต็อกคนละลำดับแล้วมาชนกันที่แถวกะ · เป็นบั๊กจริงของเส้นทางขายพร้อมกัน ไม่ใช่เทสเปราะ
    2. `pharmacy-counter-authorization-db-contract` → teardown ลบ `bms_pos_shifts` ไม่ได้เพราะ
       `bms_orders_pos_shift_id_fkey` ยังอ้างอยู่ (ลำดับลบใน teardown ผิด) → **ทิ้งข้อมูลทดสอบค้างใน
       dev DB ทุกรอบ**
  · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** — ยืนยันได้แค่ว่าทั้งสามหน้าตอบ `307` ไป `/admin/login`
    (route มีจริงและ middleware กันถูก) แต่ตัวหน้าไม่เคยเรนเดอร์ให้คนดู เพราะเข้าระบบไม่ได้จากที่นี่
  · **recheck รอบสอง (2026-08-31, คำสั่งเดียวกัน) — เจอของจริงอีก 3 จุด แก้ครบแล้ว**:
    1. **⚠️ `9.42__bms_stock_movement_wastage_type.sql` — การตัดของเสียล้มทุกครั้ง 100%**
       `movements.ts` เพิ่ม `WASTAGE` เข้า `MovementType` แต่ **ไม่มีใครขยาย
       `bms_stock_movements_type_check`** ซึ่งยังเป็น 11 ค่าจาก `7.98` → `recordInventoryWastage()`
       ล้มที่บรรทัดเขียน movement ทุกครั้ง (`23514`) = ทั้งหน้า `/admin/wastage` เขียนอะไรไม่ได้เลย
       · **apply เข้า dev DB แล้วและ reproduce ยืนยันทั้งก่อน/หลังแก้** · ยังไม่ได้ apply production
       · เหตุที่หลุด: เทส DB ของ `9.40` **ไม่เคยเรียกเส้นทางเขียนของเสียเลยสักครั้ง**
       · กันย้อนกลับ: เทียบ `MovementType` กับ CHECK จริงในฐานได้ด้วย
         `select pg_get_constraintdef(oid) from pg_constraint where conname='bms_stock_movements_type_check'`
         — **เพิ่มชนิด movement ใหม่เมื่อไหร่ต้องมี migration คู่เสมอ**
    2. **⚠️ `createShipment()` ตัดสต็อกจาก `bms_order_items` ตรง ๆ ไม่ใช่จาก view** — เป็น
       "จุดที่ห้า" ที่ขยับสต็อก ซึ่งเอกสารนับไว้แค่สี่ · บิลที่มีสินค้าชุด (8.8) หรือเมนูที่มีสูตร (9.40)
       จะไปลด `current_stock` ของ SKU แม่ที่คาอยู่ที่ 0 → ชน `CHECK (current_stock >= 0)`
       = **ส่งของบิลนั้นไม่ได้เลย** และส่วนประกอบที่จองไว้จริงไม่เคยถูกตัด · **บั๊กนี้มีมาตั้งแต่ `8.8`**
       ไม่ใช่ของใหม่ แต่ `9.40` ทำให้โดนทุกบิลของร้านอาหาร
    3. **⚠️ `releaseExpiredOrders()` (cron `orders/release-expired`) ปล่อยของจาก `bms_order_items`
       ตรง ๆ เหมือนกัน** — และร้ายกว่า เพราะมันทำ **ทุก tenant ในทรานแซกชันเดียว**: บิลที่มีเซ็ต/เมนู
       ใบเดียวในชุด ทำให้ `reserved_stock` ของ SKU แม่ติดลบ → ชน `CHECK (reserved_stock >= 0)` →
       **ทั้ง batch rollback = ไม่มีบิลหมดอายุของร้านไหนถูกปล่อยเลย เงียบ ๆ**
       · ตอนเขียนเทสพบว่า **dev DB มีบิล PENDING ค้างเกิน 30 นาทีอยู่ 21 ใบ** และการเรียก
         `releaseExpiredOrders()` บนฐานนี้ยัง throw อยู่ (`ADIDAS-RUN/M` reserved จะติดลบ) —
         **นั่นคือ data drift ของ dev เอง ไม่ใช่ผลจากงานชุดนี้** แต่แปลว่า cron ตัวนี้พังอยู่บนฐานนี้
         และ **ยังไม่ได้แก้**: ออกแบบให้ทั้ง batch อยู่ใน transaction เดียว ร้านเดียวข้อมูลเพี้ยน
         จึงบล็อกทุกร้านตลอดไป (ควรแยกต่อบิล/ต่อร้าน — เป็นการตัดสินใจเชิงออกแบบ ไม่ใช่บั๊กบรรทัดเดียว)
    · **กันย้อนกลับด้วยเทส pure ตัวใหม่ `scripts/order-stock-lines-contract.test.mts` (2 เทส)** —
      สแกนทุก statement ใน `lib/bms` ที่เขียน `bms_inventory` แล้วเอ่ยถึง `bms_order_items`
      (ตัดคอมเมนต์ `--` ออกก่อน ไม่งั้นคอมเมนต์ที่อธิบายกฎถูกจับเป็นของจริง — กับดักเดิมกับตอนทำ
      เทส cron fail-open) + ตรวจฝั่งกลับว่า 4 ไฟล์ที่ขยับสต็อกต้องยังเอ่ยถึง view จริง ·
      **ยืนยันว่าแดงจริง** ด้วยการย้อนทั้งสองแพตช์กลับไป (แดงถูก 2 เทส ชี้ `orders.ts` + `shipping.ts`)
    · **เทส DB ของ `9.40` ขยายเป็น 9 เทส** เพิ่ม: ตัดของเสียจริง (สต็อกลด + movement + audit +
      ประวัติ) · ตัดของเสียเกินของที่ไม่ถูกจองต้องถูกปฏิเสธและไม่แตะการจอง · คิวครัวสร้างซ้ำไม่ได้
      และเลื่อนสถานะข้ามขั้นไม่ได้ · **ส่งของบิลเมนูต้องตัดวัตถุดิบ ไม่ใช่แถว 0 ของเมนู**
    · **ตรวจแล้วว่าไม่มีปัญหา**: `business_archetype` CHECK ครอบ 3 ประเภทใหม่แล้วใน `9.40` ·
      `normalizeShopArchetype` อ่านจากลิสต์เดียวกับ dropdown · เอกสาร GraphQL 13 ตัวใหม่มี resolver
      ครบทุกตัว · เอกสาร gql ทั้ง 13 ชุดในหน้าใหม่+POS validate ผ่าน schema จริง · RLS/GRANT ของ
      ตารางใหม่ครบใน `9.40` · เส้นทางคืนของ POS อ่าน view อยู่แล้ว
    · `MOVE_COLOR` ที่ `/admin/products` เพิ่ม `WASTAGE` (ของเดิมไม่มีสีก็แค่ tag สีเทา ไม่ใช่บั๊ก)
  · **recheck รอบสาม — เจาะเฉพาะหน้า POS (2026-08-31) เจอของจริงอีก 4 จุด แก้ครบแล้ว**:
    1. **⚠️ `parsePosSaleLines()` ทิ้ง `modifierCodes` และ `scaleBarcode` ทั้งคู่** — ตัวแยกนี้เป็น
       **allowlist** ฟิลด์ที่ไม่ได้เขียนไว้จะหายเงียบระหว่างจอกับ `recordPosSale` · ผลจริง 2 อย่าง:
       (ก) **เมนูที่ลูกค้าสั่งพร้อมตัวเลือกถูกตัดวัตถุดิบตามสูตรเปล่า เงียบสนิท** และคิวครัวไม่มีตัวเลือก
       (ข) **สินค้าชั่งขายถูกคิดเป็น 1 หน่วยฐานแทนน้ำหนักจริง** (`qty = packQty × base_qty` = 1)
       แล้วยอดไม่ตรงกับที่จอคิด → `PAYMENT_MISMATCH` **บิลถูกทิ้งทั้งใบหน้าลูกค้า** = ขายของชั่งไม่ได้เลย
       · **เหตุที่หลุด: เทส DB ของ 9.40 เรียก `createOrder()` ตรง ๆ ไม่เคยผ่าน route จริง**
       · เทสใหม่ 2 ตัวใน `scripts/pos-contract.test.mts` ปักไว้แล้ว (normalize + เพดาน 20 ตัวเลือก)
    2. **⚠️ `resolvePosScan()` กลืนบาร์โค้ดที่ขึ้นต้น 21/22 ทุกตัวแล้วคืน null** — `checkBarcode()`
       ตั้งใจ "เตือน ไม่บล็อก" ร้านจึงมีสินค้าที่บาร์โค้ดขึ้นต้นด้วยเลขพวกนี้ได้จริง และปุ่มสร้างเลขของร้าน
       ก็ครอบ 20–29 ทั้งช่วง → **สินค้าพวกนั้นยิงไม่ขึ้นที่เคาน์เตอร์** โดยขึ้นแค่ "ไม่พบสินค้า"
       · แก้เป็น: ป้ายที่แกะแล้ว **map ไม่ได้ ตกลงไปค้นแบบบาร์โค้ดปกติ** (ไม่ใช่คืน null) ·
         **การันตีเดิมยังอยู่**: มีแต่กิ่ง prefix 22 ที่ map สำเร็จเท่านั้นที่ตั้ง `embeddedBaseQty`
         ป้ายราคา (21) จึงไม่มีทางกลายเป็นน้ำหนักได้เหมือนเดิม (เทส pure ตรวจลำดับกิ่งนี้ไว้แล้ว)
    3. **`inStoreBarcode()` ออกเลข prefix 21/22 ได้** ซึ่งชนกับป้ายเครื่องชั่ง — เลข 5 หลักกลาง
       อาจไปตรงกับรหัสสินค้าบนเครื่องชั่ง แล้วสินค้าชิ้นถูกอ่านเป็นของชั่งขายพร้อมน้ำหนักจากบาร์โค้ด
       ของตัวเอง · ตอนนี้ปฏิเสธสอง prefix นี้ที่ต้นทาง (เทสใน `barcode-contract` คุมไว้)
    4. **จอบอกคนละเลขกันเองสำหรับของชั่งขาย** — ยอดรวมบิลคิดเต็มน้ำหนัก แต่บรรทัดคำอธิบายเขียนว่า
       `฿ราคา × 1 กรัม` และ **ยอดท้ายบรรทัด (กับจอลูกค้า) คิด `ราคาต่อกรัม × 1`** เมื่อสินค้านั้นติด
       ราคาส่ง → ป้าย 750 กรัมโชว์ ฿0.05 ท้ายบรรทัดขณะยอดรวมเป็น ฿37.50
       · รวมกฎไว้ที่ `cartLineCharge()` ตัวเดียว แล้วให้ยอดรวม/บรรทัด/ท้ายบรรทัด/จอลูกค้าอ่านจากที่นั่น
  · **ตรวจแล้วว่าไม่มีปัญหาในหน้า POS**: ฝั่งจอคิดจำนวนขั้นราคาส่ง/โปรเป็น **หน่วยฐาน**
    (`packQty × baseQty`) ตรงกับ `createOrder` ที่ใช้ `it.qty` แล้ว — ของเดิมก่อน 9.40 นับ pack เป็น
    1 ชิ้นซึ่ง **ไม่ตรงกับ server อยู่ก่อนแล้ว** งานชุดนี้แก้ให้ตรงไปด้วย · ป้ายเครื่องชั่งถูก server
    แกะใหม่ตอน `canonicalizePosSaleLines` ไม่เชื่อ `baseQty` จาก browser · กล่องเลือกตัวเลือกเรนเดอร์จริง
    และปิดการสแกนระหว่างเปิด (`blockingOverlayOpen`) · พักบิล/กู้บิลเก็บทั้ง `modifierCodes` และ
    `scaleBarcode` เพราะ snapshot เก็บ CartLine ทั้งก้อน · `refreshCartPricing` ยิงป้ายเดิมซ้ำ
    (`line.scaleBarcode ?? line.sku`) และปฏิเสธเมื่อ modifier ถูกปิดไปแล้ว
  · **รอบสี่ — ตามผลวิเคราะห์ "ร้านคนละประเภท POS เหมือนกันไหม" (2026-08-31) แก้ 3 เรื่อง**:
    1. **⚠️ สวิตช์ความสามารถ 13 ตัว มีผลจริงแค่ 5** — ไล่ `isCapabilityEnabledInTx` ทั้ง repo เจอ
       แค่ `RECIPE` `MODIFIER` `WEIGHTED_PRODUCT` `WASTAGE` (+`KITCHEN_WORKFLOW` ที่เพิ่งเพิ่ม) ·
       อีก 8 ตัวไม่มีใครอ่านเลย เพราะของจริงตัดสินจาก **การมีข้อมูล**: มีแถวใน
       `bms_product_packs` → ยิงแพ็กได้ · มีแถวใน `bms_inventory_lots` → กันของหมดอายุ + FEFO ·
       `bms_products.serial_tracked` → บังคับเลขเครื่อง · `business_archetype='pharmacy'` → ด่านยา
       · **สวิตช์ที่กดแล้วไม่เกิดอะไรแย่กว่าไม่มีสวิตช์** เพราะคนอ่านว่า "ปิดไปแล้ว" ทั้งที่ยังทำงานอยู่
       (ร้านปิด `LOT_TRACKING` แล้วยังขายล็อตหมดอายุไม่ได้อยู่ดี)
       · แก้เป็น: `GATING_CAPABILITIES` เป็นลิสต์เดียวที่ UI แสดงเป็นสวิตช์และที่
         `upsertStoreCapability()` ยอมเขียน · ที่เหลือแสดงเป็น **"ระบบตรวจพบจากข้อมูล"** อ่านอย่างเดียว
         และเขียนไม่ได้ (override ที่ไม่มีความหมายคือคำโกหกชั้นเดียวกัน แค่ลึกกว่า)
       · **จงใจไม่ทำให้เป็นสวิตช์จริง**: ปิด `LOT_TRACKING`/`EXPIRY_TRACKING`/`FEFO` = ปุ่มขายของ
         หมดอายุ · ปิด `PACK` = ร้านอาหารยิงแพ็กไม่ได้ทันที (preset ของร้านอาหารไม่มี `PACK` เลย
         แต่สินค้ายังตั้งแพ็กไว้ได้)
       · กันย้อนกลับ: `scripts/store-capability-gates-contract.test.mts` (2 เทส) บังคับให้ลิสต์สวิตช์
         **เท่ากันเป๊ะ** กับชุดที่ซอร์สเรียก `isCapabilityEnabledInTx` จริง ทั้งสองทิศ (สวิตช์ที่ไม่มีคนอ่าน
         = แดง · gate ที่ไม่มีสวิตช์ = แดง) · **ยืนยันแดงจริง** ด้วยการใส่ `FEFO` เข้าลิสต์
    2. **ตั๋วครัวงอกในร้านที่ไม่มีครัว** — `enqueueKitchenTicketsInTx` ดูแค่ `stock_policy='RECIPE'`
       ไม่ดูความสามารถ · preset ของ `food_beverage` มี `RECIPE` แต่**ไม่มี** `KITCHEN_WORKFLOW`
       ร้านที่ใช้สูตรเพื่อตัดวัตถุดิบอย่างเดียวจึงมีตั๋วสะสมทุกบิลโดยไม่มีหน้าจอไหนแสดงและไม่มีใครปิดได้
       · ตอนนี้ gate ด้วย `KITCHEN_WORKFLOW` · **station ยังเป็น NULL ได้ตามเดิม** (กระดานมีช่อง
       "ไม่ระบุ station" อยู่แล้ว — กระดานว่างอ่านได้ว่าระบบพัง แย่กว่าตั๋วที่ยังไม่ระบุ station)
       · **เมนู sidebar เปลี่ยนไปตามความสามารถ ไม่ใช่ตามประเภทร้าน** ผ่าน query เบา ๆ ตัวใหม่
         `bmsKitchenBoardEnabled` (gate = admin scope ไม่ใช่ permission · **ล้มแล้วตอบ false ไม่ throw**
         เพราะ sidebar พังทั้งอันแปลว่าเปิดหลังบ้านไม่ได้เลยสักหน้า) — เมนูกับตั๋วจึงมาพร้อมกันเสมอ
    3. **หน้าขายไม่เคยบอกว่าออร์เดอร์เข้าครัวแล้ว** (ไม่มีคำว่า kitchen ในหน้านั้นสักที่) แคชเชียร์
       ร้านอาหารต้องเดินไปถามครัวเอง · `fulfilPosOrderInTx` คืนจำนวนตั๋วขึ้นมาถึงผลการขาย →
       ขึ้นทั้งใน toast และการ์ด "ขายสำเร็จ" · บิลที่ยิงซ้ำ (replay) ไม่ส่งค่านี้กลับมา
       (`?? 0`) เพราะครัวรับไปตั้งแต่รอบแรกแล้ว
  · **แก้ความเข้าใจผิดของผมเองในรอบวิเคราะห์**: preset ของ `building_materials` **มี**
    `WEIGHTED_PRODUCT` อยู่แล้ว (ผมอ่านตกไปหนึ่งคอลัมน์) — ตัวที่ไม่มีจริง ๆ คือ preset ของ
    `restaurant` ซึ่งไม่มี `WEIGHTED_PRODUCT` ร้านอาหารที่ขายของชั่งด้วยต้องไปเปิดเอง (ตั้งใจ)
  · **รอบห้า — recheck ประเภทร้านใหม่ 3 ตัว + พิสูจน์ว่าไม่กระทบร้านเก่า (2026-08-31)**
    · **ไล่ทุกจุดที่อ่าน archetype แล้ว** (25 ไฟล์): CHECK ทั้งสองตาราง (`bms_store_profile`,
      `bms_pending_shop_signups`) ครอบ 3 ค่าใหม่แล้ว ยืนยันกับ DB จริง · dropdown ทั้งหน้าสมัคร
      และหน้า Settings อ่านจาก `SHOP_ARCHETYPE_OPTIONS` ตัวเดียว จึงขึ้นเองอัตโนมัติ ·
      `normalizeShopArchetype`/`isValidShopArchetype` อ่านจากลิสต์เดียวกัน ·
      `archetypeToBusinessType` map ครบ (restaurant→food · building_materials→home ·
      pet_supply→general) · `devSeed` ตกลง default "General" ซึ่งใช้ได้ (เครื่องมือ dev เท่านั้น)
    · **เจอ 3 จุดที่ประเภทใหม่ "อยู่ในลิสต์แต่ยังไม่ถูกต่อสาย" — แก้แล้ว**:
      1. `buildBusinessArchetypeExamples()` ใน `pipeline.ts` ไม่มี case ของทั้ง 3 ตัว → default
         คืน `[]` = AI ไม่ได้ตัวอย่างเฉพาะทางเลย (ไม่ error แค่เงียบ) · เพิ่มครบแล้ว
      2. `onboardingChecklistKeysForArchetype()` ไม่มี case ของทั้ง 3 ตัว → ร้านใหม่ได้ checklist
         กลาง ๆ ทั้งที่เหตุผลที่ประเภทพวกนี้มีอยู่คือรูปแบบสต็อกที่ต่าง · เพิ่ม 3 ชุด × 4 ข้อ × 2 ภาษา
      3. **ของเดิมที่พังอยู่ก่อนแล้ว 2 อย่าง เจอตอนเขียนเทส**: `b2b_wholesale` **มีข้อความ
         checklist ครบ 4 ข้อทั้งสองภาษาแต่ฟังก์ชันไม่มี case ให้** → ไม่มีใครเคยเห็นข้อความชุดนั้นเลย
         · และ `pharmacy` ซึ่งเป็นประเภทที่เฉพาะทางที่สุดในระบบ **ไม่มี checklist ของตัวเอง**
         ได้ของกลาง ๆ มาตลอด · เพิ่มทั้งสองแล้ว
    · **เทสใหม่ 2 ชุด**:
      - `scripts/shop-archetype-coverage-contract.test.mts` (4 เทส · pure) เดินจาก dropdown เอง
        บังคับว่าทุกประเภทต้องมี checklist ที่ resolve ได้ **ทั้ง th และ en** (คีย์พวกนี้ประกอบตอนรัน
        `t(\`admin_getting_started.${key}\`)` ซึ่ง `i18n-keys-contract` เขียนไว้เองว่าตรวจไม่ได้)
        + ต้องไม่มี copy ที่เขียนแล้วไม่มีใครเรียก + ต้องไม่ตกลง default เงียบ ๆ
        · **ยืนยันแดงจริง** ด้วยการปิด case ของ restaurant (แดง 2 เทส)
      - `scripts/shop-archetype-db-contract.test.mts` (8 เทส · DB) สร้างร้าน 2 ร้านของตัวเองแล้วลบทิ้ง:
        ร้านยุคก่อน 9.40 (archetype เก่า **ไม่มีแถว policy/capability เลย**) กับร้านที่ไม่เคยเลือกประเภท
        · พิสูจน์ว่า: ขายปกติได้ · snapshot ออกมาเป็น `DIRECT` หนึ่งบรรทัด · view คืนบรรทัดเดียว ·
        ยกเลิกแล้วคืนของครบ · **แพ็ก 1 กล่อง = 12 หน่วยฐาน แม้ไม่มีใครเปิดธง PACK** ·
        ร้านที่ไม่มี archetype ทุก gate ปิดหมดแต่ยังขายได้ · **เปลี่ยนประเภทร้านไม่แตะ policy/สต็อก
        และไม่ทำให้สินค้าเดิมถูกตีความใหม่** · ร้านธรรมดาไม่มีตั๋วครัวงอก
    · **ห้ามยืมร้านจริงมาสลับ `business_archetype` ในเทส** — โน้ตข้อ "บทเรียนตอนเขียนเทส" ข้างบน
      บันทึกไว้แล้วว่าเคยทำร้านจริงค้างเป็นร้านยาจนชุดเทส POS แดง 10 ตัว
    · **ตรวจแล้วว่าไม่กระทบของเดิม**: preset ของ archetype เก่าเปิดเฉพาะธงที่ **ไม่มีใครอ่าน**
      (PACK/MULTI_BARCODE/LOT/EXPIRY/FEFO/SERIAL/PHARMACY_POLICY) ยกเว้น `food_beverage` ที่ได้
      `RECIPE`+`MODIFIER`+`WASTAGE` — ซึ่งไม่เปลี่ยนอะไรจนกว่าจะมีสินค้าตั้ง `stock_policy='RECIPE'`
      จริง · ผลข้างเคียงเดียวที่วัดได้คือ `resolvePosScan` ยิง query ตัวเลือกเพิ่ม 1 ครั้งต่อการสแกน
      ในร้านที่ `MODIFIER` เปิด (index ตรง ๆ ไม่ใช่ query หนัก)
    · **จุดที่เปลี่ยนพฤติกรรมของเดิมจริง 1 อย่าง (ยอมรับได้)**: สินค้าที่ถูกปิดการขาย (`active=false`)
      เดิมได้ `NOT_FOUND` ตอนนี้ได้ `INVALID_ITEM` พร้อมข้อความ "ไม่พบสินค้าที่ขายได้: <sku>"
      ซึ่งอ่านรู้เรื่องกว่า · เส้นทาง POS ไม่กระทบเพราะ `canonicalizePosSaleLines` กรอง `p.active`
      ไปก่อนอยู่แล้ว
  · **ยังไม่ได้ทำ (จงใจ)**: ร้านที่ archetype เป็น `other`/ยังไม่เลือก ได้ preset ว่าง → ตั้งสินค้าเป็น
    `RECIPE` แล้วขายไม่ได้จนกว่าจะไปเปิดความสามารถเอง (ข้อความบอกชัดแล้ว แต่ยังต้องรู้ว่าไปเปิดที่ไหน)
  · **ยังไม่ได้ทำ (จงใจ)**: การ "แลกเปลี่ยนสินค้า" (สร้างตะกร้าจากบิลเดิม) ไม่ยก `scaleBarcode` มาด้วย
    ของชั่งขายจึงกลับเข้าตะกร้าเป็นบรรทัดธรรมดา — ยังไม่มีร้านไหนใช้ทั้งสองฟีเจอร์พร้อมกัน ·
    และ **ยังไม่มีเทส DB ที่เดินผ่าน `recordPosSale` จริงสำหรับของชั่งขาย/ตัวเลือก** (ต้องตั้งเครื่อง+กะ
    ในเทส) — ตัวที่ปักไว้ตอนนี้คือเทส pure ที่ระดับ route parser ซึ่งเป็นจุดที่บั๊กเกิดจริง

- **Global AI Work Assistant — recheck ของงาน codex (2026-08-28, branch
  `codex/global-work-assistant-foundation`, ไม่มี migration, ไม่มี permission ใหม่)** ·
  `tsc --noEmit` ผ่าน · production build ผ่าน · **`npm run test:pure` = 39 ไฟล์ 493 เทส ผ่านทั้งหมด**
  · **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** (เครื่องนี้ไม่มี Postgres/dev server ของ BMS รันอยู่) —
  Drawer ที่ทุกหน้าหลังบ้าน, การ์ด PIN/ข้อเสนอ, และผู้ช่วยคู่มือที่หน้า POS ผ่านแค่ `tsc` + build
  · **⚠️ เทสสองชุดของฟีเจอร์นี้อยู่ใน `scripts/ai-eval/` ซึ่ง gate เดินไม่ถึง** — `run-contract-tests.mjs`
    อ่านเฉพาะชั้นบนสุดของ `scripts/` ทั้งโฟลเดอร์ ai-eval (13 ไฟล์ 215 เทส) จึงไม่เคยถูกรันใน CI เลย
    และ README ของมันบอกให้ "รันมือทีละไฟล์" = ไม่มีใครรัน · แก้ให้เดินเข้า `ai-eval` ในโหมด pure แล้ว
    (ยืนยันก่อนว่าเขียวทั้งชุดและใช้เวลา ~6 วิ) → pure ขึ้นจาก 22 ไฟล์/226 เทส เป็น 39/493
  · **บั๊กที่เจอและแก้ (เรียงตามความแรง)**:
    1. **ปุ่มยืนยันใน Drawer โชว์แต่ข้อความที่โมเดลแต่ง ไม่โชว์ว่าอะไรจะถูกสั่งจริง** — หน้าเต็ม
       `/admin/assistant` โชว์ `mutation(args…)` และมีช่องแก้อีเมลผู้รับ + คำเตือน "ไม่เคยรับรายงาน
       ของร้านนี้" + ตรวจรูปแบบอีเมลก่อนปล่อยให้กดส่ง · Drawer ไม่มีสักอย่าง = กดคืนเงิน/ปรับสต็อก/
       ส่งรายงานออกไปยังอีเมลที่โมเดลเลือกโดยไม่เห็นค่าอะไรเลย ตอนนี้ยกทั้งชุดมาที่ Drawer
    2. **บริบทหน้าปัจจุบันสร้าง "คำตอบ" ขึ้นมาเอง** — โบนัส +10 (currentPath) และ +10 (pageId) มากกว่า
       เพดานความเกี่ยวข้องของ resolver (`score >= 4`) แปลว่า **ทุกไกด์ของหน้าที่ยืนอยู่ ตอบทุกคำถาม**
       · ผลจริง 2 อย่าง: กิ่ง "ไม่พบคู่มือที่ยืนยันได้" ที่หน้า POS **ไม่มีทางถูกเรียกเลย** (พิมพ์ "xyzzy"
       ก็ได้คู่มือขายของมาเต็มหน้า) และทุกข้อความได้ citation ของหน้านั้นติดมาด้วยแม้พิมพ์ว่า "สวัสดี"
       · แก้ด้วยธง `matchedQuery` (textScore > 0) — proximity ใช้จัดอันดับ ห้ามสร้าง match ·
       citation/link ใช้เฉพาะตัวที่ match จริง · ฝั่ง fallback ตอนไม่มี AI ยังโชว์คู่มือของหน้าได้
       แต่เปลี่ยนหัวข้อเป็น "คู่มือของหน้าที่คุณเปิดอยู่" ไม่ใช่ "คำตอบ"
    3. **ผู้ช่วยที่หน้า POS ยื่นคู่มือหลังบ้านให้แคชเชียร์** — กรองด้วย `id.startsWith("pos.")` ซึ่งกิน
       `pos.configure-devices` (`/admin/pos-devices`) และ `pos.review-readiness` (`/admin/pos-readiness`)
       เข้ามาด้วย · ถาม "PIN" ที่เครื่องขายแล้วได้ขั้นตอน "เปิด POS Devices" ซึ่งบัญชี `pos_only`
       เข้า `/admin` ไม่ได้ตั้งแต่ระดับ login · ตอนนี้กรองด้วย `pageId === "pos"` (= ทำที่เครื่องขาย)
    4. **ตอบเป็นภาษาไทยเสมอไม่ว่าผู้ใช้ตั้งภาษาอะไร** — `ctx.admin.language` เป็น `undefined` เสมอ
       เพราะ `language` **ไม่ได้ถูกเซ็นลง JWT โดยตั้งใจ** (คอมเมนต์ใน `lib/auth/token.ts` เขียนไว้ว่า
       อ่านสดที่ `/api/auth/me` เท่านั้น) · เพิ่ม `locale` ใน input ให้ client ส่ง (เป็น presentation
       ไม่ใช่ authorization) · และถอด `sectionId` ที่ประกาศไว้ใน schema + type + เอกสาร แต่ไม่มีใครเขียน
       ไม่มีใครอ่าน ทิ้งไป
    5. **`get_my_access` ตอบฟิลด์ที่ไม่เคยอ่าน** — `displayName` มาจาก `ctx.admin.name/username`
       และ `posOnly` มาจาก `ctx.admin.pos_only` ซึ่ง**ไม่มีอยู่ใน session ทั้งคู่** → ได้ `null`/`false`
       เสมอ แล้วโมเดลเอาไปพูดต่อ · ตอนนี้อ่านจาก `users` (`getAssistantSelfProfile`)
    6. **`platform.edit-post` ลิงก์ไป `/admin/post` ซึ่ง 404** — โฟลเดอร์นั้นมีแต่ `[id]`/`new` ไม่มี
       `page.tsx` · เทสเดิมเช็คแค่ว่า "โฟลเดอร์มีอยู่" จึงมองไม่เห็น · เปลี่ยนเป็นเช็ค `page.tsx`
       และ guide ที่ครอบ subtree ที่ลิงก์ไม่ได้ต้องประกาศ `coversRoutePrefixes`
    7. **สถานะความสามารถบอกไม่ตรงของจริง** — `shipping.fulfillment` เป็น `MOCK` ทั้งก้อนทั้งที่โมดูล
       จัดส่งใช้งานจริงอยู่ (แค่ adapter ของ Flash/Kerry ที่ยังไม่ live) → แยกเป็น `AVAILABLE` +
       `shipping.carrier-integrations` (MOCK) · และ**ไม่มี capability ไหนเป็น `BETA` เลยสักตัว**
       ทั้งที่ type กับเอกสารมีสถานะนี้ → e-Tax, Shopee/Lazada, และการพิมพ์ ESC/POS (เขียนแล้วแต่
       ไม่เคยยิงกับของจริง ตามตารางสถานะใน CLAUDE.md) เป็น `BETA` แล้ว
    8. **งานหน้าเคาน์เตอร์ 4 อย่างที่มี route `/api/pos/*` จริงแต่ไม่มีคู่มือเลย** — ขายเชื่อ/เก็บเงิน
       ลูกหนี้ (9.30), คืนของไม่มีใบเสร็จ (8.2), บัตรของขวัญ/เครดิตร้าน (8.9), และการให้เภสัชกรกด PIN
       อนุมัติที่เครื่องขาย (9.29) · ก่อนแก้ ถาม "ขายเชื่อ" แล้วได้คู่มือขายของทั่วไปมาเป็นคำตอบ
       (เพราะบั๊กข้อ 2) · เพิ่มคู่มือ 4 ตัว + ขยาย alias ของคู่มือเดิมให้ครอบ serial/ใบกำกับภาษี/
       no-sale/ราคาส่ง/โปร/เซ็ต/ค่าบริการ/สแกนบาร์โค้ด/ส่งใบเสร็จอีเมล
    9. จุดเล็ก: `searchTenantStaffUsers` ไม่ escape `%`/`_` ของ LIKE (ถาม "%" = ได้รายชื่อพนักงานทั้งร้าน)
       · `getTenantStaffUserAccess` ส่ง id ที่โมเดลแต่งเข้า `WHERE id = $1` ของคอลัมน์ uuid → `22P02`
       กลางทูล แล้วขึ้นเป็น `bms_failure_incidents` ทั้งที่เป็นแค่โมเดลเดาผิด · `username` เป็น NULL ได้
       (มาจาก `1.13`) แต่ type ประกาศเป็น `string`
  · **ปุ่มตัวเลือกที่หน้า POS ย้ายมาอยู่ใน `POS_REGISTER_SUGGESTIONS`** (export จาก knowledge module)
    เพราะมีเทสคุมว่าทุกปุ่มต้อง resolve เป็นคู่มือของเครื่องขายได้ทั้งไทยและอังกฤษ — ปุ่มที่กดแล้วได้
    "ไม่พบคู่มือ" แย่กว่าไม่มีปุ่ม เพราะแคชเชียร์อ่านว่า "ระบบทำเรื่องนี้ไม่ได้"
  · เทสที่ทำ mutation test แล้วว่า**แดงจริง**: `matchedQuery` (ทำให้เป็น `true` เสมอ → เทส 14 แดง)
    และ route ที่ลิงก์ไม่ได้ (เอา `/admin/post` กลับมา → เทส 2 แดง)
  · **ยังไม่ได้ทำ (จงใจ)**: `bmsWorkAssistant` ไม่มี rate limit ของตัวเอง (ใช้ quota เดิมของ AI) ·
    Drawer เก็บประวัติแชตลง `localStorage` ต่อ (tenant, user) ซึ่งรวมข้อความที่มีตัวเลขของร้าน ·
    citation ยังมาจากการค้นคำถาม ไม่ใช่จากสิ่งที่โมเดลอ่านจริงในลูป

- **ปักคำตอบของคำถามทั้ง 51 ข้อ + ย้าย FAQ จาก Manual เข้าแคตตาล็อก (2026-08-28, ไม่มี migration,
  ไม่มี permission ใหม่)** · `tsc --noEmit` ผ่าน · `npm run gate` ผ่าน (pure **40 ไฟล์ 499 เทส**) ·
  production build ผ่าน · **ยังไม่ได้เปิดดูจริงในเบราว์เซอร์** (เครื่องนี้ไม่มี Postgres/Redis ของ BMS
  รันอยู่ — `docker ps` มีแต่ container ของโปรเจกต์อื่น) หน้า `/admin/manual` และ Drawer ผ่านแค่ tsc+build
  · **ต้นเหตุที่ต้องปัก**: เทสเดิมเขียนว่า `assert.ok(results.some(r => r.id === X))` = "เจอที่ไหนก็ผ่าน"
    ไกด์ที่ถูกต้องตกไปอันดับ 6 ใต้ของไม่เกี่ยว 5 ตัวก็ยังเขียว ซึ่งเป็นวิธีที่คุณภาพการค้นเสื่อมโดยไม่มีใครเห็น
    · ตอนนี้ `scripts/ai-eval/work-assistant-question-corpus.mts` ปักคำถาม **51 ข้อ + guard 2 ข้อ**
      (คำถามที่ต้องตอบว่าไม่รู้) ว่าต้องได้ entry ไหน **มาเป็นอันดับหนึ่ง** และคำถามที่ตอบได้เฉพาะจาก
      ข้อมูลจริง 11 ข้อ ปักชื่อทูล + สิทธิ์ที่คุมทูลนั้น (ทูลถูกเปลี่ยน gate = เทสแดง)
    · **ลิสต์คำถามอยู่ที่เดียว** — ย้ายลิสต์เดิม 5 ชุดออกจาก `work-assistant-knowledge-contract`
      (ไฟล์นั้นเหลือหน้าที่ตรวจรูปทรงแคตตาล็อก/ความครอบคลุมของหน้า) ไม่งั้นมีสองลิสต์ให้ drift
    · **ปุ่มตัวอย่างที่ UI ต้องเป็นคำถามที่ปักไว้** — เพิ่มปุ่มใหม่แล้วไม่ปักคำตอบ = แดงทันที
  · **บั๊กที่เจอระหว่างทาง (แก้แล้ว)**:
    1. **ปุ่มตัวอย่างของ Drawer เอง 2 ปุ่มไม่มีคำตอบ** — "บัญชีฉันทำอะไรได้บ้าง" / "What can my account
       access?" ค้นแล้ว **ไม่ match อะไรเลย** (ภาษาอังกฤษได้ `account.update-profile` มาเป็นอันดับหนึ่ง
       ซึ่งผิดคน) เพราะไกด์เรื่องสิทธิ์มีแต่ "ตั้ง role" (แอดมินเท่านั้น) กับ "ทำไมปุ่มกดไม่ได้" ·
       เพิ่มไกด์ `permissions.my-access` (route `/admin/assistant`, ไม่ต้องมีสิทธิ์อะไร) ให้ตรงกับทูล
       `get_my_access` ที่มีอยู่แล้ว
    2. **คำถามที่มีแต่คำเชื่อมไป match ของมั่ว** — "What can I do on this page?" ได้
       `pos.device-settings` เป็น "คำตอบ" เพราะ token ทุกตัว ("what/can/do/on/this/page") ไปเจอใน body
       ของไกด์สักตัว · เพิ่ม STOPWORDS (เฉพาะอังกฤษ — ไทยไม่มีช่องว่างจึงมาเป็น token เดียวและ match
       ด้วย alias containment อยู่แล้ว) ตอนนี้ตกไปกิ่ง "ไม่พบข้อมูลที่ยืนยันได้" หรือกิ่ง "คู่มือของหน้าที่เปิดอยู่"
       ตามที่ควรเป็น
    3. **สองคำถามเสมอกันที่ 12 คะแนนแล้วตัดสินด้วยลำดับตัวอักษร** ("ระบบมีสะสมแต้มไหม" /
       "ตอนนี้มีคูปองอะไรใช้ได้บ้าง") — คำตอบที่ถูกจึงขึ้นอยู่กับชื่อ id โดยบังเอิญ · ใส่ alias ตรงตัวให้ฝั่งที่
       ควรนำ (capability สำหรับคำถาม "ระบบมี…ไหม" · guide สำหรับคูปองเพราะคำตอบคือการแยกคูปองร้าน
       ออกจากสิทธิ์ของลูกค้าคนหนึ่ง)
  · **FAQ ย้ายบ้าน**: `lib/bms/assistantKnowledge/faq.ts` (20 ข้อ ไทย/อังกฤษ) แต่ละข้อผูกกับไกด์เจ้าของ
    · `/admin/manual` เรนเดอร์จากอาร์เรย์เดียวกันนี้ (เดิมเป็นสองอาร์เรย์ในหน้านั้น ผู้ช่วยจึงตอบ FAQ ไม่ได้เลย
      — ถาม "กดจัดส่งไม่ได้ ขึ้นว่าไม่มีที่อยู่" ได้ไกด์กว้าง ๆ ทั้งที่คำตอบตรงตัวอยู่ในหน้าที่ไม่มีใครเปิด)
    · **คำถาม + alias ของ FAQ ถูกพับเข้า alias pool ของไกด์ แต่ "คำตอบ" ไม่ถูกให้คะแนน** — คำตอบเป็น
      ข้อความยาว ถ้าให้คะแนนด้วย ทุกคำตอบจะกลายเป็น match อ่อน ๆ ของทุกคำถาม (= อาการเดิมที่กำลังแก้)
    · `search_system_guides` คืน `faqs` ให้โมเดลยกคำตอบที่ยืนยันแล้วไปใช้ · ตอนไม่มี AI provider
      คำตอบ FAQ ที่ match ขึ้นนำในคำตอบ deterministic
    · **หน้าขายไม่ถูกแตะ** — FAQ ทั้ง 20 ข้อเป็นของไกด์หลังบ้าน ถ้าปล่อยเข้าหน้าขายจะเป็นการยื่นงาน
      หลังบ้านให้แคชเชียร์ที่เข้า `/admin` ไม่ได้
    · alias เขียนด้วยคำที่คนพิมพ์จริง ("ปุ่มหาย", "เครดิตหมด", "แชทไม่เด้ง") ไม่ใช่ชื่อฟีเจอร์ ·
      มีเทสว่า **ทุก alias ต้องพาไปที่ FAQ ของตัวเอง** (alias ที่ไปตอบคำถามอื่นแย่กว่าไม่มี alias)
  · **mutation test ยืนยันว่าแดงจริง 4 แบบ**: ถอดการพับ FAQ เข้า alias (FAQ 20 ข้อหาไกด์ตัวเองไม่เจอ) ·
    ถอด STOPWORDS (คำถามกว้างกลับมา match มั่ว) · เปลี่ยน gate ของ `get_variant_reservations` เป็น
    `product.view` (ทูลตอบคำถามเดิมให้คนผิดกลุ่ม) · ย้าย alias "ขายเชื่อ" ไปไกด์ขายทั่วไป
    (**ไกด์ที่ถูกยังอยู่ในผลอันดับ 2 — เทสแบบเดิมจะเขียว เทสใหม่แดง** ซึ่งคือทั้งหมดของงานรอบนี้)
  · **รอบที่สอง (2026-08-28, คอมมิตถัดมา) — ปิดช่องที่เหลือ**: ปักคำถามให้ **ทุก entry ในแคตตาล็อก**
    (corpus 133 ข้อ = 51 เดิม + 80 coverage + 2 guard) และ **ย้ายกฎ/กับดัก 19 กลุ่ม 97 ข้อ**
    (`LIMIT_GROUPS` เดิมในหน้า Manual) เข้า `lib/bms/assistantKnowledge/limits.ts`
    · **เทสใหม่บังคับว่าไกด์และ capability ทุกตัวต้องมีคำถามอย่างน้อยหนึ่งข้อ** — เพิ่มหน้าใหม่แล้วไม่เขียน
      คำถามที่ควรพามาเจอ = แดงทันที (entry ที่ไม่มีใครถามถึง = ข้อความผิดอยู่ได้ตลอดโดยไม่มีอะไรค้าน)
    · **กว่าจะเขียวต้องแก้ของจริง 33 จุด** — พอเขียนคำถามแบบที่คนพิมพ์จริง ปรากฏว่าไกด์จำนวนมาก
      (โดยเฉพาะกลุ่ม platform ที่ generate จากตารางย่อ) **มี alias แค่ชื่อหน้าตัวเอง** เช่นถาม
      "อีเมลส่งออกไม่ถึงต้องดูที่ไหน" ไม่เจอ Mail log เพราะต้องพิมพ์คำว่า "mail log" เท่านั้น ·
      เติม alias จริงให้ 15 ไกด์ + 12 capability และเพิ่ม 2 คอลัมน์ alias เข้าไปในตารางของกลุ่ม platform
    · **แก้กติกาการให้คะแนน 2 ข้อ (ต้นเหตุของ tie ที่ตัดสินด้วยลำดับตัวอักษร)**:
      (ก) alias ที่ยาวกว่าและอยู่ในคำถามจริงได้แต้มบวกแบบมีเพดาน (+12 → +12..20) — "ระบบโอนสต็อกข้าม
      สาขาได้ไหม" เคยเสมอกันระหว่าง `inventory.branch` (จับคำว่า "โอนสาขา") กับ `inventory.transfers`
      (จับ "โอนสต็อกข้ามสาขา") แล้วชนะกันด้วยชื่อ id · ไทยไม่มีช่องว่าง ความยาวจึงเป็นสัญญาณหลัก
      (ข) **คำถามที่อยู่ "ข้างใน" alias นับเป็น match ต่อเมื่อยาวอย่างน้อยครึ่งหนึ่งของ alias** —
      ไม่งั้น "ทำยังไง" ไป match "คิวเภสัชกรทำยังไง" (เจอตอนเทสเก่าแดง ซึ่งเป็นเทสที่คุมกิ่ง
      "ไม่พบข้อมูลที่ยืนยันได้" อยู่พอดี)
    · เทส corpus จำลอง **การกรองของหน้าขาย** (`pageId === "pos"` → เหลือเฉพาะไกด์ที่ทำที่เครื่องขาย)
      ให้ตรงกับ `PosGuideAssistant` ไม่งั้นคำถาม "รับชำระ" จะไปแพ้ให้ไกด์ลูกหนี้ที่แคชเชียร์เปิดไม่ได้
    · **limits ส่งให้โมเดลเฉพาะ 2 ไกด์อันดับแรก** — 97 ข้อทั้งชุดจะกลบคำตอบที่มันมีไว้ปกป้อง
    · mutation test เพิ่มอีก 3: ถอดการพับ alias ของ limits · ลบกฎภาษาอังกฤษของกลุ่มหนึ่ง ·
      เพิ่มไกด์ใหม่ที่ไม่มีคำถามปัก — แดงถูกตัวทั้งหมด
    · gate: pure **40 ไฟล์ 503 เทส** + typecheck + production build ผ่าน
  · **ยังไม่ได้ทำ (จงใจ)**: POS ยังไม่มี FAQ ของตัวเอง (20 ข้อเป็นของหลังบ้านทั้งหมด) ·
    citation ยังมาจากการค้นคำถามเหมือนเดิม · `bmsWorkAssistant` ยังไม่มี rate limit ของตัวเอง ·
    ยังไม่เคยเปิดดูจริงในเบราว์เซอร์

- **ตรวจว่า `BMS_SECRET_KEY` ทำงานจริงไหม: `scripts/check-bms-secret-key.mts`** (read-only ไม่เขียนอะไร
  ไม่พิมพ์ค่าความลับ · exit code 1 เมื่อยังมีเรื่องต้องจัดการ ใช้ใน CI ได้)
  · ตรวจ 4 ชั้น: (1) คีย์ถูกส่งถึงโปรเซสไหมและรูปแบบถูกไหม (2) เป็นคีย์ dev ที่คำนวณจากซอร์สได้ไหม
    (3) เส้นทาง encrypt→decrypt ในโค้ดจริงใช้งานได้ไหม (4) ข้อมูลที่เก็บไว้จริงถอดด้วยคีย์นี้ได้กี่ค่า
  · **รันในคอนเทนเนอร์เพื่อดูของที่แอปเห็นจริง** (ไม่ต้องส่ง env เอง):
    `docker compose ... exec web npx tsx scripts/check-bms-secret-key.mts`
  · **"ใช้งานได้" ไม่เท่ากับ "ปลอดภัย"** — สรุปแยก 4 แบบ: ใช้งานไม่ได้ / ใช้งานได้บางส่วน (มีข้อมูล
    ที่ถอดไม่ออก = ช่องทางตายเงียบ) / ตรวจข้อมูลจริงไม่สำเร็จ / ใช้ได้และเป็นคีย์ของเราเอง
  · กับดักที่เจอตอนเขียน: เวอร์ชันแรกรายงาน "ไม่มีค่าที่เข้ารหัสไว้เลย" ตอนที่ **ต่อฐานข้อมูลไม่ได้**
    ซึ่งอ่านแล้วเข้าใจว่าปลอดภัย · แยก "ตรวจไม่ได้" ออกจาก "ไม่มีปัญหา" แล้ว
  · ทดสอบครบ 4 สถานการณ์: คีย์ถูก / ไม่ตั้ง / รูปแบบผิด / ถูกรูปแต่ข้อมูลเข้ารหัสด้วยคีย์อื่น
- **⚠️ ถ้า production เคยรันโดยไม่ตั้ง `BMS_SECRET_KEY` — ต้องหมุนคีย์ก่อน ไม่ใช่ตั้งแล้วจบ**
  · ค่าที่ขึ้นต้น `enc:` ที่ถูกเข้ารหัสตอนยังไม่มี env ใช้คีย์ `sha256("bms-dev-secret-key")`
    พอตั้งคีย์จริงแล้ว **ถอดไม่ออก** → `decryptSecret()` คืน `null` → ช่องทางของร้านดูเหมือน
    "ไม่มี token" แล้วตายเงียบ ๆ (webhook verify ไม่ผ่าน / ส่งข้อความไม่ได้)
  · **ข้อมูลไม่หาย** เพราะคีย์ dev เดิมคำนวณได้ · ใช้ `scripts/rotate-bms-secret-key.mts`
    (ค่าปริยายเป็น dry-run ไม่เขียนอะไร · เติม `--apply` เพื่อเขียนจริง · รันซ้ำได้)
    ครอบ `bms_tenant_channels.{access_token,channel_secret}` และ
    `bms_tenant_ai_config.api_key_encrypted` — **มีที่เก็บ `enc:` ใหม่ต้องเพิ่มใน TARGETS**
  · **แก้ที่ทำให้ปัญหานี้เงียบด้วย**: `getKey()` เคยถูกเรียก *ใน* try ของ `decryptSecret`
    ตั้งค่าผิดจึงกลายเป็น `null` เงียบ ๆ แทนที่จะ throw · ย้ายออกมานอก try แล้ว → ตั้งค่าผิด =
    throw ดัง ๆ · ถอดค่าที่คีย์ไม่ตรงไม่ได้ = `null` ตามเดิม (แยกสองกรณีออกจากกัน)
  · ทดสอบสคริปต์กับข้อมูลจริงใน dev แล้ว: dry-run → apply → รันซ้ำ (บอกว่าย้ายแล้ว) → ยืนยันว่า
    `decryptSecret()` อ่านได้ด้วยคีย์ใหม่ → **คืนค่า dev กลับเป็นคีย์ dev เดิม** เพราะ container dev
    ไม่ตั้ง env (ถ้าลืมคืน dev จะใช้ช่องทางนั้นไม่ได้)
- **การ์ดของ cron/job ที่ "ข้ามได้เมื่อไม่ตั้ง env" — แก้แล้ว 2026-08-27 (ไม่มี migration)**
  · **ต้นเหตุ**: ทุก route เขียน `if (secret && req.headers.get("x-cron-secret") !== secret)` ซึ่ง
    `secret &&` = **ไม่ตั้ง env ก็ไม่ตรวจอะไรเลย** และโน้ตในไฟล์นี้เองบันทึกว่า `BMS_CRON_SECRET`
    ยังไม่ได้ตั้ง → endpoint 9 ตัวเปิดให้ใครก็ยิงได้: `reports/send-digest` (**ส่งอีเมลออกจริง**),
    `followups/run` (**ส่งข้อความถึงลูกค้า**), `ai/check-health` + `channels/check-health`
    (**จ่ายค่า AI / ยิง provider**), `orders/release-expired` (ปล่อยสต็อกที่จองไว้),
    `loyalty/maintenance` (ทำแต้มหมดอายุ), `pharmacy/assessments/expire-stale`,
    `shipping/sync-carriers`, `jobs/report-run` · `admin/queue/db` ก็รูปแบบเดียวกัน (`ADMIN_TOKEN`)
  · **`jobs/etax` ไม่ได้เป็นแบบนี้** — มันเขียน `if (!expected || ...)` fail-closed อยู่แล้ว
    (ผมเข้าใจผิดตอนสแกนรอบแรกเพราะเห็นแค่บรรทัดประกาศตัวแปร)
  · **helper กลางใหม่ `lib/bms/cronRouteAuth.ts`** (แบบเดียวกับที่ repo แยก `adminRouteAuth.ts`):
    ไม่ตั้ง env → **503** (เป็นการตั้งค่าที่ยังไม่เสร็จ ไม่ใช่ผู้เรียกผิด) · header ผิด → **401**
    · เทียบด้วย `timingSafeEqual`
  · **ผลข้างเคียงที่ตั้งใจ**: ถ้ายังไม่ตั้ง `BMS_CRON_SECRET` งานตั้งเวลาจะ **ไม่ทำงานและเห็นชัดว่าไม่ทำงาน**
    ดีกว่าเปิดให้ใครก็ยิงได้เงียบ ๆ · ต้องตั้ง secret พร้อม deploy ไม่งั้น job ทั้งชุดหยุด
  · verify จริง: ยิงตอนไม่มี env → `503` พร้อมข้อความบอกสาเหตุ · ทดสอบ helper 6 กรณี
    (ไม่ตั้ง/ตั้งแล้วไม่มี header/ผิด/ถูก/ยาวกว่า) ถูกครบ
  · **อุดช่องโหว่ในเทสตัวเองด้วย** — `inventory-tenant-scope-contract` เดิมนับว่า "มีคำว่า
    CRON_SECRET ในไฟล์" = มีการ์ด จึงมองไม่เห็น fail-open · เพิ่มเทสที่สแกน `if (<secretVar> &&`
    ทั่ว `app/api` (ตัดคอมเมนต์ออกก่อน ไม่งั้นเอกสารที่อธิบายรูปแบบเก่าถูกจับเป็นของจริง — เจอมาแล้ว)
    · ยืนยันว่าแดงจริงเมื่อเอา fail-open กลับมาที่ `reports/send-digest`
- **`9.28__bms_pharmacy_evidence_erased_file.sql` (แก้ constraint ของ `9.25` ที่ขัดกันเอง + ถอน GRANT
  ที่ไม่จำเป็น) apply เข้า dev DB และ verify แล้ว 2026-08-27** — ยังไม่ได้ apply เข้า production
  · **บั๊กที่ `9.25` ทิ้งไว้ (ผมเขียนเอง เจอตอน recheck)**: FK เป็น `ON DELETE SET NULL` แต่ CHECK
    บังคับว่าแถว `PRESCRIPTION_IMAGE` ต้องมี `file_id` → **ลบแถวใน `files` ไม่ได้เลย** error ออกมาเป็น
    `shape_check` ที่อ่านไม่รู้เรื่องเพราะพูดถึง `UPDATE` ที่ไม่มีใครสั่ง · ผลจริง: storage sweep,
    `deleteFile` เดิม และ **คำขอลบข้อมูลตาม PDPA** ทำไม่ได้ทั้งหมด
  · **แก้ CHECK ไม่ใช่แก้ FK** เพราะ SET NULL คือพฤติกรรมที่ต้องการ — ลบตัวไฟล์ได้ แต่ไม่ลบร่องรอยว่า
    เคยมีหลักฐานและใครแนบ · `kind='PRESCRIPTION_IMAGE' AND file_id IS NULL` = tombstone "ไฟล์ถูกลบแล้ว"
    · สตรีมจะได้ 404 เองเพราะ `getEvidenceFileForStreaming` join กับ `file_id`
  · **ถอน `GRANT SELECT ON files TO bms_app` ที่ `9.25` ใส่ไว้เกินจำเป็น** — โค้ดในโมดูลนี้อ่าน `files`
    ผ่าน `query()` (role `app`) ไม่ใช่ใน `beginTenantTx` (ที่ `SET LOCAL ROLE bms_app`) จึงไม่เคยต้องใช้
    · `files` ปิด RLS อยู่ ดังนั้น GRANT นั้นทำให้ role ที่ตั้งใจให้ถูก RLS คุมอ่านไฟล์ได้ทุกร้าน
  · เทสเพิ่ม 2 ตัวใน `scripts/pharmacy-clinical-evidence-db-contract.test.mts` (เป็น 10 เทส):
    ลบไฟล์แล้วเหลือ tombstone · CHECK ที่คลายแล้วยังกันรูปแบบผิดครบ 3 แบบ
- **`9.25__bms_pharmacy_clinical_evidence.sql` (หลักฐานทางคลินิกของเคสหน้าร้าน) apply เข้า dev DB และ
  **apply เข้า production แล้ว 2026-08-26** (ผู้ใช้ยืนยัน) · seed permission ใหม่ 2 ตัว
  (`pharmacy.evidence.read`, `pharmacy.evidence.manage` → **Pharmacist เท่านั้น**)
  · เก็บ 3 อย่างต่อเคส: รูปใบสั่งยา / เลขอ้างอิงใบสั่งยา / บันทึกคำแนะนำ · **เก็บจนกว่าจะลบเอง ไม่มีตัวหมดอายุ**
    (ตกลงกับผู้ใช้) · ลบเป็น soft delete เพื่อให้ยังตรวจได้ว่าใครลบหลักฐานอะไรออกไป
  · **ไม่บังคับแนบ** — เภสัชกรเป็นคนตัดสิน ไม่มี policy ไหนบล็อกบิลเพราะไม่มีหลักฐาน
  · **ไม่ seed ให้ Manager โดยตั้งใจ** — Administrator ได้อัตโนมัติเพราะเป็น super role ผลคือผู้ชม =
    admin + เภสัชกร ตรงตามที่ตกลง · Manager อ่านเคสได้แต่เปิดรูปใบสั่งยาไม่ได้
  · **⚠️ กับดักที่เจอตอนทำ: `/api/files/[id]` ไม่มี auth เลย และ id เป็น integer เรียงลำดับ**
    ใครก็ไล่เดาโหลดไฟล์ของคนอื่นได้ · รูปใบสั่งยาจึงต้องออกทาง
    `/api/bms/pharmacy/evidence/[id]/file` ที่ตรวจ session + `pharmacy.evidence.read` + tenant ของแถว
    และตั้ง `Cache-Control: private, no-store` · **`file_id` ไม่เคยถูกส่งออกไปฝั่ง client เลย** (มีเทสคุม)
    · ถ้าจะเก็บไฟล์อ่อนไหวอย่างอื่นในอนาคต ห้ามใช้ `/api/files/:id` ซ้ำ
  · เคาน์เตอร์ **เขียนได้ อ่านไม่ได้** — `/api/pos/pharmacy-evidence` ใช้ device token + PIN + `pos.sell`
    คืนแค่ id ไม่คืนตัวหลักฐาน (แคชเชียร์ถ่ายใบสั่งยาเข้าระบบได้ แต่เปิดดูของคนอื่นไม่ได้)
  · รับไฟล์เฉพาะ PNG/JPEG/WebP/GIF/PDF ไม่เกิน 10MB — **ไม่รับ SVG** เพราะแสดง inline แล้วรัน script
    ในโดเมนเราได้
  · ร่องรอย (`assessment.clinical_evidence_added/_deleted`) เขียนในทรานแซกชันเดียวกับแถว และ
    **เก็บแต่ metadata ไม่เก็บเนื้อความ/เลขใบสั่งยา** (มีเทสคุมว่าไม่มีเนื้อความหลุดลง event)
  · UI: การ์ด "หลักฐานทางคลินิก" ที่ `/admin/pharmacy-queue/[caseId]` (ก่อน Audit Timeline) +
    แถบแนบหลักฐานใต้กล่องเคสเภสัชที่หน้า POS — **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์ ผ่านแค่ `tsc`**
  · เทสชุดใหม่: `scripts/pharmacy-clinical-evidence-db-contract.test.mts` (8 เทส · สร้าง tenant
    ของตัวเอง 2 ร้านแล้วลบทิ้ง ไม่ยืมร้านจริง)
- **⚠️ บทเรียนตอนเขียนเทสที่ต้องตั้ง `business_archetype = 'pharmacy'`** — เทสที่ยืมร้านแรกแล้ว
  "จำค่าเดิมไว้คืนตอน teardown" **อันตราย**: รอบที่ teardown ล้ม ร้านจริงค้างเป็นร้านยา แล้วรอบถัดไป
  จับ `pharmacy` เป็น "ค่าเดิม" จนติดถาวร → ชุดเทส POS แดง 10 ตัวด้วย `POLICY_NOT_READY`
  (เกิดจริง 2026-08-26 แก้ด้วยการ `UPDATE bms_store_profile SET business_archetype = NULL`)
  · **เทสที่ต้องสลับ archetype ให้สร้าง tenant ของตัวเองเสมอ** — คอลัมน์นี้เปลี่ยนการกันบิลของ
    **ทุกสินค้า** ในร้านนั้น ไม่ใช่แค่ของที่เทสสร้าง
- **รายการข้างบนหยุดที่ `7.82` — ยังไม่เคยเช็ค `7.84`–`7.96` (ฟีเจอร์ POS/tax ทั้งชุด: location/lot/pack,
  POS device/shift, cashier PIN, return/refund settlement, cashier-only accounts, per-size pack,
  e-Tax queue, credit note/cash rounding) กับ production เลย** — ต้อง `ls db/migrations` เทียบกับ DB
  จริงก่อน go-live ของ POS ทุกครั้ง ดู checklist เต็มใน
  [docs/business/pos.md § Go-live checklist](docs/business/pos.md#go-live-checklist)
- **`7.83` = ไฟล์เดิมที่เคยชื่อ `7.74__bms_pharmacy_seed_protocol_safety_fields.sql`** (renumber
  2026-08-13 เพราะเลข `7.74` ถูกใช้ซ้ำกับ `7.74__bms_shared_customer_identity_backfill.sql`) — เป็น
  `UPDATE ... WHERE NOT EXISTS` รันซ้ำได้ปลอดภัย **environment ที่ apply ไปแล้วตอนยังเป็น `7.74`
  ไม่ต้องทำอะไรเพิ่ม** ส่วนที่ยังไม่เคย apply ให้รันเป็น `7.83` ตามลำดับปกติ
- env ที่ต้องตั้ง: `BMS_SECRET_KEY` (hex 64 — ไม่งั้นใช้ dev key เข้ารหัส token) · `JWT_SECRET`
  (เซ็นทั้ง session token + cookie `BMS_ACT_TENANT`) · `BMS_CHECKOUT_SECRET` (ไม่ตั้งจะ fallback ไป
  `JWT_SECRET`; ไม่มีทั้งคู่ production จะ throw — **หมุนค่านี้เมื่อไหร่ ลิงก์ checkout ที่ส่งลูกค้าไป
  แล้วใช้ไม่ได้ทันทีทั้งหมด**) · `NEXT_PUBLIC_BASE_URL` ให้ตรงโดเมนจริง (`createCheckoutUrl()` ใช้ค่านี้
  ประกอบลิงก์ที่ส่งหาลูกค้า, default hardcode `https://bms.jachoei.com`) · `META_GRAPH_VERSION`
  (default v21.0) สำหรับ FB/IG send
- ให้ app ต่อ DB ด้วย role **non-superuser** เพื่อให้ RLS มีผลกับ read
- เพิ่ม password/TLS ให้ Redis — ตอนนี้เก็บ session id, rate-limit counter และ (ชั่วคราว) เลขบัญชี
  รับเงินของร้านผ่าน cache · ตั้ง `REDIS_PASSWORD` แล้ว `REDIS_URL` ต้องพ่วง credential ด้วย · ข้าม
  host เมื่อไหร่ใช้ `rediss://`
- Lazada/Shopee webhook signature ต้อง verify กับเอกสาร Open Platform ตัวจริงก่อนใช้จริง (ตอนนี้
  HMAC-SHA256 แบบ TikTok เป็น placeholder — ดู [docs/integrations/lazada.md](docs/integrations/lazada.md))
- **fake seeder ต้องปิดใน production** — `.env.prod`/`.env`/`.env.dev` ในเครื่องนี้ตั้ง
  `BMS_ALLOW_FAKE_SEED=1` ทั้ง 3 ไฟล์ ต้องไปเช็ค/ปิดบนเซิร์ฟเวอร์จริงเอง (agent แก้ `.env*` ไม่ได้):
  `docker compose ... exec web printenv BMS_ALLOW_FAKE_SEED NODE_ENV`
- หน้าระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Architecture) gate ด้วย `layout.tsx` →
  `requirePlatformAdminPage()` (server-side กัน shop user เข้าตรงผ่าน URL)

## ⚠️ แทรก CSS กลาง selector list แล้วเมนูทั้งแถบกลายเป็นพื้นม่วงบน production — 2026-09-04

**เกิดจริงบน `jachoei.com` หลัง deploy คอมมิตก่อนหน้า** (ผู้ใช้ส่งภาพมา) · แก้แล้วในคอมมิตถัดมา ·
`tsc` ผ่าน · **pure 794 เทสผ่าน** · build ผ่าน

- **ต้นเหตุ**: `globals.css` มีกฎ layout ของแถบเมนูที่เขียนเป็น selector list สองบรรทัด

  ```css
  .bms-admin-sidebar-menu:not(.ant-menu-inline-collapsed) .ant-menu-item,
  .bms-admin-sidebar-menu:not(.ant-menu-inline-collapsed) .ant-menu-submenu-title {
    height: auto; ...
  }
  ```

  ผม anchor การแทรกบล็อกใหม่ไว้ที่ **บรรทัดที่สอง** ของ list นี้ → บรรทัดแรก
  (`.ant-menu-item,`) ไปเกาะกฎใหม่ของผมแทน ผลคือ **ทุกแถวเมนูได้
  `background: var(--purple-6)` + `color: #fff`** = พื้นม่วงทั้งแถบ · และกฎ layout เดิม
  ก็เสีย `.ant-menu-item` ไปด้วย (แถวเมนูสูงผิดตอนแถบขยาย)
- **CSS ไม่มี error ให้เห็นเลย** — `tsc`/build/เทสทั้งหมดเขียว เพราะไม่มีอะไรผิดไวยากรณ์
  · จับได้ก็ต่อเมื่อมีคนเปิดดูจริง ซึ่งรอบนั้นผมทำไม่ได้ (แถบเมนูอยู่หลัง login ของแอดมิน)
- **กฎที่ได้: ก่อน anchor การแทรก CSS ต้องดูว่าบรรทัดก่อนหน้าลงท้ายด้วย `,` หรือไม่** —
  ถ้าใช่ แปลว่ากำลังจะแทรกกลาง selector list · วางบล็อกใหม่ท้ายกลุ่มเสมอ ไม่ใช่ก่อนบรรทัดที่
  "ดูเหมือนเป็นจุดเริ่มของกฎ"
- **เทสกันย้อนกลับ** ใน `admin-navigation-contract` (รวม 25): แยกกฎทั้งไฟล์ (ตัดคอมเมนต์ก่อน)
  แล้วบังคับสองข้อ — ① ทุกกฎที่พูดถึงโหมดแพลตฟอร์มต้องมีแต่ selector ของโหมดนั้น ไม่ปนของอื่น
  ② กฎ `height: auto` ของแถบต้องยังครอบ `.ant-menu-item` อยู่ · **ยืนยันด้วย mutation ที่จำลอง
  การแทรกผิดแบบเดิมเป๊ะ ๆ → แดงถูกตัว**
- **แก้การตัดคำเพิ่มด้วย** — ป้าย "แพลตฟอร์ม" ยังถูกตัดเป็น "แพลตฟ…" แม้ย่อคำแล้ว เพราะ
  `Segmented block` แบ่งครึ่งเท่ากันและมีไอคอน + `padding-inline: 11px` ของ antd กินที่
  · ถอดไอคอนออกเฉพาะโหมดเต็ม (โหมดย่อยังเป็นไอคอนล้วน) + ลด padding/ขนาดฟอนต์ของป้าย
- **ยังไม่ได้เปิดดูจริงในเบราว์เซอร์เหมือนเดิม** (เข้าหลัง login ไม่ได้) — ต้องให้ผู้ใช้ยืนยัน
  ว่าพื้นม่วงหายแล้วและป้ายอ่านจบทั้งสองปุ่ม

## สวิตช์ "ดูแลร้าน / ดูแลแพลตฟอร์ม" บนแถบเมนูแอดมิน — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 793 เทสผ่าน** · build ผ่าน ·
**⚠️ ยังไม่ได้เปิดดูจริงในเบราว์เซอร์** — แถบนี้อยู่หลังหน้า login ของแอดมินซึ่งผมเข้าไม่ได้
(กรอกรหัสผ่านแทนผู้ใช้ไม่ได้) และ `NEXT_PUBLIC_*` ของ container dev ยังชี้ GraphQL ไป
production อยู่ (ปัญหาที่จดไว้ตั้งแต่ `9.44`) · ยืนยันได้แค่ระดับ typecheck + build + เทสสแกนซอร์ส

- **สวิตช์นี้เลือก "ชุดเครื่องมือ" ไม่ใช่ "ร้านที่กำลังดู"** — เห็นเฉพาะคนที่
  `hasPlatformWorkspace()` เป็นจริง ซึ่งวันนี้เท่ากับ `users.is_platform_admin` เพราะเมนูฝั่ง
  PLATFORM ทั้ง 11 รายการ gate ด้วย `ctx.isPlatformAdmin` เหมือนกันหมด · เจ้าของร้านธรรมดา
  (แม้เป็น Administrator) ไม่เห็นแถบนี้เลยและถูกบังคับเป็น `'SHOP'`
- **ปัญหาที่ผู้ใช้ถามมา ("ทำไมมี 2 tab") มีต้นเหตุที่หน้าตา ไม่ใช่ที่แนวคิด**:
  1. ป้าย "ดูแลแพลตฟอร์ม" ยาวเกินครึ่งของแถบ 264px จึงถูกตัดเป็น **"ดูแลแพ…"** — ปุ่มที่อ่านไม่จบ
  2. สองปุ่มน้ำหนักเท่ากัน ตัวที่เลือกต่างแค่พื้นขาว/เทา (ตระกูลเดียวกับตัวกรองสถานีบนจอครัว)
  3. อยู่ตำแหน่งเด่นสุดใต้ช่องค้นหา ทั้งที่กดวันละไม่กี่ครั้ง
  4. จึงอ่านเหมือน "สลับร้าน/สลับบัญชี" ซึ่งเป็นคนละเรื่องกับ drill-down ที่มีแถบสีส้มของตัวเอง
- **แก้แบบเล็กที่สุด (ไม่แตะ state/logic เลย)**: ป้ายสั้นเป็น **"ร้าน" / "แพลตฟอร์ม"**
  (`Shop` / `Platform`) · ความหมายเต็มย้ายไป `workspace_shop_full`/`workspace_platform_full`
  ที่ tooltip + aria **ทั้งสองโหมด** ไม่ใช่เฉพาะตอนแถบย่อ · เพิ่ม **สีม่วงประจำโหมดแพลตฟอร์ม**
  ที่ทั้งตัวสวิตช์และแถวเมนูที่เลือก (`bms-workspace-platform`, `bms-admin-sidebar-menu-platform`
  ใน `globals.css`) — รู้จากหางตาว่าอยู่โหมดไหนโดยไม่ต้องอ่านป้าย
- **สีม่วง = "โหมดของเครื่องมือ" ห้ามสับสนกับสีส้ม = "ร้านที่ drill-down เข้าไป"** — สองสถานะนี้
  ตั้งฉากกัน (ดูร้าน A ด้วยเครื่องมือแพลตฟอร์มก็ได้) คอมเมนต์ใน CSS เขียนกำกับไว้แล้ว
- เทส `admin-navigation-contract` +1 (รวม 24): ป้ายต้องไม่ยาวเกิน 12 ตัวอักษรทั้ง th/en ·
  ต้องมีคีย์ `_full` · tooltip ต้องมีทั้งสองโหมด (นับ 2 ครั้งต่อคีย์) · สีประจำโหมดต้องลามถึงเมนู
  · **ผ่าน mutation test 3 แบบ** — และรอบแรก **มี 1 ตัวไม่แดง** เพราะ assert จับบล็อก
  `[data-theme="dark"]` ที่ยังเหลืออยู่ ต้องบังคับให้ตรงกฎของโหมดสว่างด้วย `^...$/m`
- **ยังไม่ได้ทำ (จงใจ)**: ไม่ย้ายสวิตช์ไปท้ายแถบ และไม่ยุบเป็นเมนูเดียว — สองทางนั้นต้องแก้
  `adminNavigation.ts`/ลำดับข้อมูล ไม่ใช่แค่ชั้นเรนเดอร์ · mockup ที่เทียบทั้งสี่แบบ:
  https://claude.ai/code/artifact/d775c45f-70b3-4ea2-a947-e5118d321165

## กล่องเพิ่มเมนูลงบิล + `9.58` ชื่อกลุ่มตัวเลือกเป็นไทย — 2026-09-04

`tsc` ผ่าน · **pure 792 เทสผ่าน** · build ผ่าน · **เปิดดูจริงในเบราว์เซอร์แล้ว** ·
`9.58__bms_modifier_group_default_name_th.sql` **apply เข้า dev DB แล้ว** (ยังไม่ได้ apply production)

- **⚠️ บั๊กจริงข้อ 1 — ปุ่ม "Cancel" ภาษาอังกฤษทุก Modal ทั้งแอป** ไม่ใช่ข้อความที่ใครพิมพ์
  แต่เป็นค่าปริยายของ antd เพราะ `ConfigProvider` ใน `AntdThemeProvider.tsx` **ตั้งแต่ธีม
  ไม่เคยตั้ง `locale`** · แก้ให้ผูกกับ `lang` (`th_TH`/`en_US`) และ **ต้องสลับลำดับ provider**
  ให้ `I18nProvider` ห่อ `AntdThemeProvider` ใน `ClientProviders.tsx` ไม่งั้น `useI18n()`
  คืนค่า default ของ context (`"th"`) แทนภาษาที่ผู้ใช้เลือกจริง — คนที่ตั้งอังกฤษจะได้ปุ่มไทย
- **⚠️ บั๊กจริงข้อ 2 — หัวข้อ "Options" มาจากข้อมูล ไม่ใช่โค้ด** · `9.51` backfill modifier
  ยุคก่อนเข้ากลุ่มโดยตั้งชื่อว่า `'Options'` (บรรทัด `INSERT ... SELECT DISTINCT ... 'OPTIONS',
  'Options'`) · `9.58` เปลี่ยนเป็น "ตัวเลือก" **เฉพาะแถวที่ยังเป็นค่า backfill เป๊ะ ๆ**
  (`code='OPTIONS' AND name='Options'`) ร้านที่เปลี่ยนชื่อเองไปแล้วไม่ถูกแตะ ·
  และ `productRecipes.ts` เปลี่ยนค่าปริยายของกลุ่มที่สร้างใหม่เป็น "ตัวเลือก"
  · หมายเหตุ: seeder ร้านอาหารรุ่นใหม่ (`restaurantCatalogSeed.ts`) ตั้งชื่อไทยถูกอยู่แล้ว
    ("ระดับความเผ็ด"/"เพิ่มไข่") — ปัญหาอยู่ที่ backfill ของ 9.51 เท่านั้น
- **กล่องเพิ่มเมนูเปลี่ยนเป็นจอสัมผัส**: จำนวนเป็น **stepper 48px** + ชิป 1/2/3/5 (เดิมเป็น
  `type="number"` ซึ่งเรียกคีย์บอร์ดขึ้นมาบังครึ่งจอเพื่อพิมพ์เลขตัวเดียว) · ตัวเลือกเป็น **ชิป
  สูง 40px ที่ตัดบรรทัดเอง** (เดิมกล่องเต็มแถวสูง ~56px ต่อหนึ่งตัวเลือก) · **ส่วนต่างราคาอยู่บน
  ชิป** (`+฿15.00`) ไม่ใช่ในวงเล็บท้ายชื่อ · ชิปโน้ตด่วน 4 คำ + textarea เหลือ 2 บรรทัด ·
  **ยอดรวมอยู่บนปุ่ม** ("เพิ่มในบิล · ฿270.00") และมีบรรทัดบอกที่มา ("฿135.00 × 2 (รวมตัวเลือก)")
- **ชิปยังเป็น `radio`/`checkbox` จริงข้างใน** (input ซ่อนด้วย opacity+ขนาด 1px ไม่ใช่
  `display:none`) จึงยังคุมด้วยคีย์บอร์ดและอ่านด้วย screen reader ได้ · `:focus-within`
  บนชิปเป็นตัวแทน focus ring
- **กติกากลุ่มบอกครบแล้ว** — เดิมโชว์แค่ `minSelect` · ตอนนี้ "เลือกได้ 1" / "เลือกได้ไม่เกิน N" /
  "ต้องเลือกอย่างน้อย N" · (ข้อมูลของ shop-b เป็น `MULTIPLE` ไม่มีเพดาน เผ็ดน้อย+เผ็ดมากจึงติ๊ก
  พร้อมกันได้ — เป็นการตั้งค่าของร้าน ไม่ใช่บั๊ก)
- **สูตรราคาต่อหน่วยเหลือที่เดียว** (`menuHitUnitPrice`) เดิมเขียนซ้ำสองรอบในข้อความ Alert
  บรรทัดเดียว · มีเทสนับจำนวนครั้งที่สูตรปรากฏ
- เทส `restaurant-pos-contract` +3 (รวม 41) · **ผ่าน mutation test 5 แบบ** (กลับไปใช้ช่องพิมพ์ ·
  ยอดหายจากปุ่ม · ไม่บอกกติกาสูงสุด · ถอด locale · สลับลำดับ provider กลับ)
- **⚠️ บทเรียนสำคัญของรอบนี้ — ผมลบข้อมูลของผู้ใช้โดยเข้าใจผิดว่าเป็นเศษของตัวเอง**
  ระหว่างวันมีแถว `bms_product_menu_unavailability` และบรรทัด NEW ในบิลเดโมโผล่ขึ้นมาเรื่อย ๆ
  ผมเดาว่าเป็นผลจากการคลิกทดสอบของตัวเองแล้วลบทิ้ง · **audit log บอกว่าไม่ใช่**: แถวที่ผมสร้าง
  จากสคริปต์ actor เป็น `ABC` (คนแรกของร้านที่ `LIMIT 1` เจอ) ส่วนแถว `MENU-PADTHAI-SHRIMP`
  ที่ 15:36 และ 15:50 actor เป็น **`A`** = ผู้ใช้กำลังกดทดสอบบนเครื่อง dev คู่ขนานไปกับผม
  · **กฎที่ได้: ก่อนลบอะไรในฐาน dev ให้ดู `bms_audit_log` ว่าใครเป็นคนทำก่อนเสมอ** —
  ตอนนี้เหลือแถวของผู้ใช้ไว้ 1 แถวโดยไม่แตะ และคืนเฉพาะสิ่งที่ผมแก้เอง (กลุ่ม SOMTAM กลับเป็น
  MULTIPLE/ไม่มีเพดาน, `SPICE_MORE` price_delta กลับเป็น 0, token เครื่อง POS-01)
- mockup ที่ใช้ตัดสินใจ: https://claude.ai/code/artifact/82e1482c-770d-4f03-b2aa-50b2757780c6

## การ์ดเมนูที่ปิดขายเปลี่ยนเป็น "การ์ดเงียบ · แตะเพื่อเปิดขาย" — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 789 เทสผ่าน** · build ผ่าน · **วัดจริงในเบราว์เซอร์**
· กลับคำจากดีไซน์ที่ผมทำเองเมื่อเช้า (แถบแดง + ปุ่มเต็มความกว้าง) หลังเห็นในกริดจริง

- **ต้นเหตุ**: แถบแดงทึบ + ปุ่มเขียวเต็มความกว้างทำให้ **ของที่ขายไม่ได้ ดังกว่าของที่ขายได้**
  ซึ่งกลับหัวกับงานของกริดนี้ (มีไว้สั่งอาหาร) · แถบยังทับรูปอาหารซึ่งเป็นตัวช่วยจำเมนูของ
  พนักงาน และปุ่มด้านล่างทำให้การ์ดสูงกว่าเพื่อนในแถวเดียวกัน
- **ดีไซน์ใหม่**: รูปขาวดำ + พื้น `--panel-2` + ชื่อ/ราคาเทา · ชิปแดงเล็ก "หมดวันนี้" **แทนป้าย
  สถานี** (ตอนสั่งไม่ได้ สถานีไม่ใช่ข้อมูลที่ต้องรู้) · เหตุผล + เวลาเปิดเองเป็นบรรทัดเล็กใต้ชื่อ
- **"แตะการ์ด = เปิดแผ่นเปิดขาย"** — การ์ดนี้สั่งอาหารไม่ได้อยู่แล้ว การแตะจึงว่าง ใช้ให้เป็น
  ประโยชน์แทนการเพิ่มปุ่มและความสูง · ปุ่ม ⋯ เปิดแผ่นเดียวกัน = มีทางเดียวให้จำ
  · **ของที่สต็อกหมดจริงยังกดไม่ได้** เพราะไม่มีอะไรให้ "เปิด"
- **แผ่นเดียวใช้สองทิศ**: ปิดอยู่ → ปุ่มเขียว "เปิดขายเดี๋ยวนี้" + บรรทัดบอกว่าปิดเพราะอะไร/เปิดเองกี่โมง
  · ยังขายอยู่ → สามปุ่มเลือกสาเหตุเหมือนเดิม
- **การ์ดสูงเท่ากันเป๊ะ** — บรรทัดสถานะกินที่ของบรรทัดที่สองของชื่อ (`-webkit-line-clamp: 1`
  เฉพาะการ์ดที่ปิดขาย) · วัดจริง: การ์ดปกติ 184px (ชื่อ 36 + ไม่มีโน้ต) การ์ดปิดขาย 184px
  (ชื่อ 18 + โน้ต 14) — **ก่อนแก้บรรทัดนี้ การ์ดปิดขายสูง 203px แล้วดันทั้งแถว**
- เทสใหม่ใน `menu-availability-contract` (รวม 12): ห้าม `dishRibbon`/`dishReopen` กลับมา
  ทั้งใน JSX และ CSS · ต้องมี `dishOutChip`/`dishOutNote` · การ์ดที่ปิดขายต้องกดได้
  (`disabled={!item.sellable && !soldOutToday}`) และแตะแล้วเปิดแผ่น · แผ่นต้องมีทางเปิดขาย ·
  รูปต้องจางด้วย `grayscale` ไม่ใช่เอาอะไรไปทับ · **ผ่าน mutation test 4 แบบ**
- **⚠️ ระหว่าง verify มีข้อมูลทดสอบค้าง 3 รายการ ลบครบแล้ว**: แถว `bms_product_menu_unavailability`
  2 แถว (PADTHAI + SOMTAM) และบรรทัด NEW ในบิลเดโม 1 บรรทัด · ยืนยันหลังลบ: 0 แถว ·
  บิล 4 บรรทัด `amount_due` 200.00 OPEN · token เครื่องคืนแล้ว
- **ตรวจแล้วว่าด่าน PIN ไม่รั่ว** — กด "ปิดขายวันนี้" ตอนยังไม่เลือกผู้ปฏิบัติงาน ได้
  "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน" และไม่มีอะไรถูกเขียน (ทดสอบสด)
- mockup ที่ใช้ตัดสินใจ (4 แบบ + วัดความสูงการ์ด):
  https://claude.ai/code/artifact/ff97e88f-4454-4914-9367-7b835fbe8d20

## ปุ่มลบบรรทัดที่ยังไม่ส่งครัวเป็นข้อความ + คอลัมน์กว้างเท่ากัน — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 788 เทสผ่าน** · build ผ่าน · **วัดจริงในเบราว์เซอร์**

- **ต้นเหตุ**: หลังเปลี่ยนปุ่มสั่งซ้ำเป็นข้อความ คอลัมน์ขวาของบิลมี **สองภาษาปนกัน** —
  สี่บรรทัดบนเป็นคำ บรรทัดที่ยังไม่ส่งครัวยังเป็นไอคอน `⊗` · ตำแหน่งเดียวกัน หน้าที่เดียวกัน
  แต่ตาต้องสลับวิธีอ่านกลางคอลัมน์ และ `⊗` อ่านได้ทั้ง "ลบบรรทัด" และ "ยกเลิกบิล"
- **สีบอกทิศทางของคอลัมน์**: เขียว = เพิ่มของ (สั่งซ้ำ/สั่งใหม่) · แดง = เอาออก (ลบ)
- **`min-width: 62px` ทั้งสองปุ่ม** — "ลบ" สั้นกว่า "สั่งใหม่" ~18px ถ้าไม่บังคับ ขอบซ้ายของปุ่ม
  จะเยื้องกันทุกบรรทัด แล้วนิ้วต้องเล็งใหม่ทีละครั้ง · วัดจริงหลังแก้: ทั้ง 5 ปุ่ม **62×30 px
  และขอบซ้ายตรงกันหมด (left = 1195)**
- **`aria-label` ต้องบอกชื่อเมนู** (`ลบ <ชื่อ> ออกจากบิล`) ไม่ใช่ "ลบรายการ" เฉย ๆ —
  บิลใบเดียวมีเมนูซ้ำกันได้สามบรรทัด (เคสจริงของโต๊ะ 1: ชามะนาวเย็น 3 บรรทัด)
- **ไม่ถามยืนยันโดยตั้งใจ** — บรรทัด `NEW` ยังไม่มีตั๋วครัว ไม่มีการจองวัตถุดิบ ไม่มีเงินขยับ
  และเผลอลบแล้วแตะการ์ดเมนูใบเดิมก็กลับมา · ต่างจาก "ยกเลิกบิล" ที่อยู่หลังปุ่ม ⋯ พร้อมเหตุผล
  + PIN ผู้อนุมัติ และต่างจากบรรทัดที่ส่งครัวแล้วซึ่งลบไม่ได้เลย (ต้องให้ครัวยกเลิกจากจอครัว)
- เทส: `restaurant-pos-contract` (38) ขยายเทสปุ่มสั่งซ้ำให้ครอบปุ่มลบด้วย — ห้ามเป็นไอคอนเปล่า ·
  `aria-label` ต้องมีชื่อเมนู · ทั้งสองปุ่มต้องมี `min-width` เท่ากัน · **ผ่าน mutation test 3 แบบ**
- **วิธี verify บรรทัด NEW โดยไม่มี PIN**: `insert` แถว `bms_restaurant_check_items` สถานะ NEW
  ตรง ๆ (id คงที่ `ffffffff-…ffff`) แล้วลบทิ้งหลังดูเสร็จ — บรรทัด NEW ไม่เคยส่งครัวจึงไม่มีตั๋ว
  ไม่มีออร์เดอร์ ไม่มีสต็อกจอง · ยืนยันหลังลบ: 4 บรรทัด `amount_due` 200.00 OPEN เท่าเดิม
  · mockup ที่ใช้ตัดสินใจ: https://claude.ai/code/artifact/88c3bc87-3a7f-45e2-a13d-2c7b6860c499

## ⚠️ ปุ่มไอคอนถูก `min-height: 44px` ของ pos.css ยืดเป็นสี่เหลี่ยมผืนผ้า — 2026-09-04

`tsc` ผ่าน · **pure 788 เทสผ่าน** · build ผ่าน · **วัดจริงในเบราว์เซอร์** (ผู้ใช้รายงาน:
"icon ให้อยู่ตรงกลาง")

- **ต้นเหตุคนละกลไกกับสองรอบก่อน ไม่ใช่ specificity** — `pos.css` ตั้ง
  `.pos-root button { min-height: 44px; padding: 10px 14px }` · คุณสมบัติที่กฎของเรา
  **"ไม่ได้ประกาศ"** จะตกมาจากตรงนั้นเสมอ ไม่ว่าคลาสจะเจาะจงแค่ไหน · ปุ่ม ⋯ ของการ์ดเมนู
  เขียน `width: 34px; height: 34px` แต่ไม่เขียน `min-height` → กล่องจริง **34×44**
  (สูงกว่ากว้าง) ไอคอนเลยดูไม่อยู่กลางมุมการ์ด
- **วัดก่อนแก้ (ไม่ได้เดาจากตา)**: `dishKebab` 34×44 · `itemRemove` 30×44 · `btnIcon` 40×44 ·
  `dishSwitch` (สวิตช์ในโหมดแจ้งของหมด) 40×23 ที่ประกาศไว้ก็จะโดนยืดเช่นกัน
  · หลังแก้: 34×34 / 30×30 / 40×40 / 40×23 และไอคอนใน ⋯ ห่างขอบ **9px เท่ากันทั้งสี่ด้าน**
- **ปุ่มที่ "ของจริงคือ 44px อยู่แล้ว" ไม่หดตามเลขที่เขียนไว้** — `.btn` (เขียน 40),
  `.areaButton` (เขียน 36), `.ticketGo` (44) ทั้งหมดเรนเดอร์ 44 มาตลอดเพราะ min-height
  · 44px เป็นเป้าแตะที่ดีบนจอสัมผัส จึง **แก้ตัวเลขที่เขียนให้ตรงกับของจริง** (44 + min-height 44)
  ไม่ใช่หดจอให้เท่าเลขเดิมที่ไม่เคยมีผล — ไม่มีพิกเซลไหนขยับ
- เทสด่านที่สามใน `restaurant-pos-contract`: **ปุ่มที่ตั้ง `height` ต้องตั้ง `min-height` ด้วย**
  · ผ่าน mutation test (ถอด `min-height` ของ `dishKebab` → แดงถูกตัว)
- **สรุปกฎครบสามข้อของไฟล์นี้ (เทสบังคับทั้งหมดแล้ว)**: ทุกกฎที่แต่งปุ่มต้อง ① มี `.page` นำหน้า
  ② ถ้าพื้นทึบ+ตัวหนังสือสีอ่อน ต้องมี `:hover` ของตัวเอง ③ ถ้าตั้ง `height` ต้องตั้ง `min-height`
- **⚠️ ระหว่าง verify มีรายการ NEW งอกในบิลเดโม (`MENU-LIME-TEA` 1 บรรทัด)** จากการคลิกทดสอบ ·
  ลบออกด้วย SQL แล้ว (บรรทัด NEW ไม่เคยส่งครัว = ไม่มีออร์เดอร์/สต็อกจอง) · ยืนยันหลังลบ:
  4 บรรทัดเท่าเดิม `amount_due` ยัง 200.00 สถานะ OPEN · `version` ของบิลขยับขึ้นซึ่งไม่มีผล
  (ใช้กันชนกันเท่านั้น) · **บทเรียน: การ verify ด้วยการคลิกบนบิลจริงต้องเช็ครายการก่อน-หลังทุกครั้ง**

## ปุ่มสั่งซ้ำบนบิลโต๊ะเป็นข้อความ ไม่ใช่ไอคอน — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 788 เทสผ่าน** · build ผ่าน · **เปิดดูจริงในเบราว์เซอร์แล้ว** (บิลโต๊ะ 1
ของ shop-b ที่มีทั้งบรรทัดปกติและบรรทัดที่ครัวยกเลิก)

- **ต้นเหตุ**: ปุ่มเป็นไอคอน `⟳` 30×30 อยู่ในช่องเดียวกับราคา · `⟳` อ่านได้หลายอย่าง
  (รีเฟรช/ย้อนกลับ/กำลังโหลด) และ **บนจอเดียวกันนี้ `⟳` ที่หัวจอคือปุ่มรีเฟรชจริง ๆ อยู่แล้ว**
  · tooltip ที่เขียนไว้ครบช่วยไม่ได้เลยเพราะจอสัมผัสไม่มี hover ให้อ่าน
- **คำบนปุ่มเปลี่ยนตามสถานะบรรทัด ไม่ใช่คำเดียวทุกกรณี** — บรรทัดที่ครัวยกเลิก (`dropped`
  หรือ `stillCharged`) อาหารไม่เคยถึงลูกค้า สิ่งที่คนกดกำลังทำคือ **"สั่งใหม่"** ไม่ใช่
  **"สั่งซ้ำ"** (เอาเพิ่มอีกที่) · ไอคอนตัวเดียวพูดสองเรื่องนี้ไม่ได้ ซึ่งเป็นเหตุผลที่แท้จริง
  ที่ต้องเปลี่ยน ไม่ใช่แค่ "ไอคอนไม่สวย"
- `aria-label`/`title` ยังเป็นประโยคเต็ม ("สั่ง <ชื่อ> ใหม่/ซ้ำพร้อมตัวเลือกเดิม") — คำบนปุ่มสั้น
  เพื่อไม่กินที่ ส่วนคนที่ใช้ screen reader ต้องได้ความหมายครบเหมือนเดิม
- **ที่กว้างขึ้น ~34px มาจากคอลัมน์ชื่อเมนู ไม่ใช่ราคา** (ราคาไม่ยอมหด) · วัดจริงบนจอ:
  ปุ่ม 59×30 px และชื่อเมนูทั้งสี่บรรทัดยังอยู่บรรทัดเดียว · แผงบิลแคบสุดบนแท็บเล็ตแนวตั้ง
  ~320px ชื่อยาว ๆ จะขึ้นสองบรรทัด (แบบไอคอนก็ขึ้นอยู่แล้ว แต่ช้ากว่า)
- CSS ตามกฎที่โดนมาสามรอบ: `.page` นำหน้า + `:hover:not(:disabled)` ของตัวเอง
  (เดิม `.page .itemAgain:hover` ไม่มี `:not(:disabled)` จึงทับปุ่มที่กดไม่ได้ด้วย)
- เทส: `restaurant-pos-contract` (รวม 38) — ห้ามกลับไปเป็นไอคอนเปล่า · คำต้องเปลี่ยนตามสถานะ ·
  `aria-label` ต้องยังเป็นประโยคเต็ม · **ผ่าน mutation test 2 แบบ**
- mockup ที่ใช้ตัดสินใจ (4 แบบ + ทดสอบความกว้าง 320/360/420):
  https://claude.ai/code/artifact/78fb3f8f-7020-47d9-9bd7-4dea1f9823e9

## ⚠️ แท็บที่เปิดอยู่บนแถบซ้ายหายไปตอน hover — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 787 เทสผ่าน** · build ผ่าน · **เปิดดูจริงในเบราว์เซอร์แล้ว**
(ผู้ใช้รายงานจาก production: "เมนู เวลา hover font ไม่มองไม่เห็น")

- **ต้นเหตุ**: `.page .railBtn:hover:not(.railBtnActive)` เขียน `:not()` ไว้เพื่อกัน **กฎของเราเอง**
  ไม่ให้ทาทับแท็บที่เลือกอยู่ — แต่ไม่ได้กัน `.pos-root button:hover:not(:disabled)` ของ `pos.css`
  (0,3,1) ซึ่งเปลี่ยนพื้นเป็น `--pos-sunken` ขณะที่ `color: white` ของ `.railBtnActive` ยังอยู่
  → **แท็บที่เปิดอยู่กลายเป็นปุ่มว่างเปล่า** · บนจอสัมผัส `:hover` ค้างกับปุ่มที่แตะล่าสุด
  แปลว่าที่หน้าร้านเห็นแบบนี้เป็นปกติหลังกดสลับแท็บทุกครั้ง ไม่ใช่แค่ตอนเอาเมาส์ไปชี้
- แก้ด้วย `.page .railBtnActive:hover:not(:disabled)` (0,4,0) ทาพื้น accent กลับ + `brightness(1.12)`
  · แท็บที่ไม่ได้เลือกยังได้ hover สีอ่อนเหมือนเดิม (ยืนยันแล้ว: `--panel-2` + ตัวอักษรสีเข้ม)
- **เทสรอบก่อนจับตัวนี้ไม่ได้** เพราะมันตรวจแค่ "มี `.page` นำหน้าไหม" ซึ่งกฎนี้มีอยู่แล้ว ·
  เพิ่มด่านที่สองใน `restaurant-pos-contract`: **ปุ่มที่ทาพื้นทึบแล้วใช้ตัวหนังสือสีอ่อน
  (`color: white/#fff/var(--panel)`) ต้องมีกฎ `:hover` ของตัวเองที่ทาพื้นด้วย** ·
  ผ่าน mutation test 2 แบบ (ลบ hover ของ `.railBtnActive` และของ `.btnPrimary`)
- **⚠️ กับดักตอนเขียนเทส (รอบที่สองแล้วที่เจอแนวนี้)**: ตัวตรวจ "กฎนี้เป็นของปุ่มไหน" ต้อง
  **ตัด `:not(...)` ออกก่อน** ไม่งั้น `.railBtn:hover:not(.railBtnActive)` ถูกนับว่าเป็นกฎ hover
  *ของ* `railBtnActive` ทั้งที่มันเอ่ยถึงเพื่อ **ยกเว้น** → เทสเขียวทั้งที่บั๊กอยู่ตรงหน้า
- **สรุปกฎของไฟล์นี้ (โดนมาสามรอบแล้ว)**: ทุกกฎที่ทาสีปุ่มต้อง (1) มี `.page` นำหน้า และ
  (2) ถ้าพื้นทึบ+ตัวหนังสือสีอ่อน ต้องประกาศ `:hover` ของตัวเองด้วย · เทสสองด่านนี้บังคับให้แล้ว

## ปุ่มล้างคำค้นในช่องกรองเมนู (`/pos/restaurant`) — 2026-09-04 (ไม่มี migration)

`tsc` ผ่าน · **pure 787 เทสผ่าน** · build ผ่าน · **เปิดดูจริงในเบราว์เซอร์แล้ว**

- คนหน้าร้านพิมพ์ด้วยนิ้วบนแท็บเล็ต การลบทีละตัวช้ากว่าแตะครั้งเดียวมาก และคำค้นที่ค้างอยู่
  ทำให้กริดเมนูดู "ของหาย" ทั้งที่แค่ยังกรองอยู่ (เจอจากหน้าจอจริง)
- **ปุ่มขึ้นเฉพาะตอนมีข้อความ** — ปุ่มที่ลอยอยู่ตลอดแม้ช่องว่างคือปุ่มที่กดแล้วไม่เกิดอะไร
  ซึ่งสอนให้คนเลิกเชื่อปุ่มบนแถบนั้น · **คืนโฟกัสให้ช่องหลังล้าง** ไม่งั้นต้องแตะช่องอีกครั้ง
  ก่อนพิมพ์คำใหม่ · **Escape ล้างได้ด้วย** สำหรับเครื่องที่ต่อคีย์บอร์ด/สแกนเนอร์
- ขนาด 36×34 px วางทับมุมขวาของช่อง และช่องเพิ่ม `padding-inline-end: 42px` เฉพาะตอนมีปุ่ม
  (ตัวหนังสือจะได้ไม่ลอดใต้ปุ่ม)
- `.page .searchClear` มี `.page` นำหน้าตามกฎที่เพิ่งโดนไปสองรอบ — และเทสตัวสแกนปุ่มก็บังคับอยู่แล้ว
- เทส: `restaurant-pos-contract` (รวม 37) · ผ่าน mutation test 2 แบบ (ปุ่มขึ้นตลอดเวลา · ไม่คืนโฟกัส)
- verify จริง: พิมพ์ "ต้ม" → เหลือเมนูเดียว · กด ✕ → ข้อความหาย เมนูกลับมา 5 ใบ **โฟกัสอยู่ในช่อง**
  ปุ่มหายไปเอง · กด Escape ก็ล้างได้เหมือนกัน

## ⚠️ ตัวกรองสถานีบนจอครัวไม่เคยแสดงว่า "เลือกอยู่" เลย — 2026-09-04 (ไม่มี migration)

branch `feat/menu-availability-ux` · `tsc` ผ่าน · **pure 786 เทสผ่าน** · build ผ่าน ·
**เปิดดูจริงในเบราว์เซอร์แล้ว** (ผู้ใช้รายงานจากหน้าจอจริง: "เลือกแล้วไม่รู้ว่าเลือกอะไร")

- **ต้นเหตุคือกับดักเดิมอีกครั้ง แต่คราวนี้ที่ *สถานะปกติ* ไม่ใช่แค่ `:hover`** —
  `pos.css` ตั้ง `.pos-root button { background; color; border; font; padding }` = **(0,1,1)**
  ซึ่ง **เจาะจงกว่าคลาสเดี่ยว ๆ ของ CSS module (0,1,0)** · `.kitchenFilterOn` เขียนไว้แบบไม่มี
  `.page` นำหน้า → **ไม่เคยมีผลเลยสักครั้งตั้งแต่เขียนมา** ตัวกรองที่เลือกอยู่จึงหน้าตาเหมือน
  ตัวที่ไม่ได้เลือก · ที่เห็นเขียวบ้างคือตอนเอาเมาส์ไปชี้ เพราะกฎ `:hover` ที่ผมเพิ่งเพิ่มเมื่อวาน
  บังเอิญมี `.page` นำหน้า — **อาการ "เขียวตอนชี้ ไม่เขียวตอนเลือก" คือลายเซ็นของบั๊กชนิดนี้**
- **แก้แล้ว 4 กฎ**: `.kitchenFilter` (ความสูง/padding/เส้นขอบก็แพ้ไปด้วย ปุ่มจึงสูงตาม pos.css
  ไม่ใช่ 34px ตามที่ตั้งใจ) · `.kitchenFilter:hover` · `.kitchenFilterOn` ·
  `.kitchenChimeOn` (ปุ่มเสียงเตือน "เปิดอยู่" ก็ไม่เคยขึ้นสีเหมือนกัน) ·
  **และ `.ticketGo`** (ปุ่ม "เริ่มทำ/เสิร์ฟแล้ว" ที่ใหญ่ที่สุดบนจอครัว — `font-size: 15px`
  แพ้ `font: inherit` ของ pos.css มาตลอด ตัวหนังสือเล็กกว่าที่ออกแบบไว้)
- **`.ticketGo` เจอเพราะเทส ไม่ใช่เพราะตา** — ตอนเขียนเทสกันย้อนกลับ มันชี้ตัวนี้ขึ้นมาเอง
- **สถานะ "เลือกอยู่" ไม่ควรต่างกันแค่เฉดสี** — เพิ่มตัวหนา + วงแหวน 3px (`--green-bg`) รอบปุ่ม
  เพราะสีเขียวเข้มอย่างเดียวยังแยกจาก focus ring สีน้ำเงินของเบราว์เซอร์ไม่ออกตอนเพิ่งกดเสร็จ
  (ภาพที่ผู้ใช้ส่งมาคือเคสนี้พอดี) · เพิ่ม `aria-pressed` ให้ปุ่มกรองทั้ง 3 แบบด้วย
- **เทสกันย้อนกลับ (ตัวสำคัญของรอบนี้)**:
  `scripts/restaurant-pos-contract.test.mts` (รวม 36) สแกน **ทุกกฎใน `restaurant.module.css`
  ที่ทาสี/ตีกรอบ/ตั้งขนาด แล้วเทียบกับรายชื่อคลาสที่อยู่บน `<button>` จริงในหน้า** —
  ถ้ากฎไหนไม่มี `.page` นำหน้า = แดง · เดินตัวอักษรหาปลาย tag เอง (นับ `{}`) เพราะ
  `className` เป็น template literal ที่มี `${...}` ซ้อน regex สั้น ๆ ตัดกลางทางแล้วมองไม่เห็นคลาส
  · **ผ่าน mutation test 2 แบบ** (ถอด `.page` ออกจาก `.kitchenFilterOn` · เพิ่มกฎปุ่มใหม่ที่ลืม `.page`)
- **⚠️ บทเรียนเรื่องเทสเอง**: รอบแรกเทสนี้ **เขียวทั้งที่ควรแดง** เพราะ destructure ผลของ
  `matchAll` ผิดช่อง (`[, selector, body]` ได้กลุ่ม `(^|\n)` มาเป็น selector) — เทสสแกนซอร์ส
  ที่ "ไม่เคยเห็นของจริง" จะเขียวเสมอโดยไม่มีใครรู้ · **ทุกเทสแนวนี้ต้องพิสูจน์ด้วย mutation
  ก่อนเชื่อ** ไม่ใช่ดูว่าเขียวแล้วผ่าน
- **ยังไม่ได้ทำ**: ไม่ได้ไล่ไฟล์ CSS ของหน้าอื่นในกลุ่ม `(pos)` ด้วยกฎเดียวกัน — เทสตัวนี้ครอบ
  เฉพาะ `restaurant.module.css` ถ้าจะขยายให้ครอบทุกหน้าใต้ `.pos-root` ต้องทำเป็นงานแยก

## จำจอ/โต๊ะที่เปิดอยู่ข้ามการรีเฟรช (`/pos/restaurant`) — 2026-09-04 (ไม่มี migration)

branch `feat/menu-availability-ux` · `tsc` ผ่าน · **pure 785 เทสผ่าน** · build ผ่าน ·
**เปิดดูจริงในเบราว์เซอร์แล้ว** (dev shop-b · ยืนยัน 6 กรณี รวมเคสขอบ)

- **ต้นเหตุที่ไม่ใช่แค่ความสะดวก**: interval 5 วินาทีของจอครัวอยู่ใต้เงื่อนไข
  `screen !== "KITCHEN" → return` และ `playKitchenChime()` ถูกเรียกจาก `loadTickets()` ของ
  interval นั้น → แท็บเล็ตติดผนังที่หลับแล้วตื่นมารีโหลด (หรือถูกเบราว์เซอร์ดีดจาก memory —
  หน้าค้าปลีกจดไว้เองว่า "พบบ่อยบนแท็บเล็ตหน้าร้าน") เด้งกลับจอสั่งอาหารแล้ว **หยุดดึงตั๋ว
  และหยุดส่งเสียงทั้งกะ** โดยไม่มีอะไรบนจอบอก · `pos_only` เปิด `/admin/kitchen` แทนไม่ได้
- **ยกรูปแบบจากหน้าค้าปลีกมาทั้งชุด ไม่ได้คิดใหม่** — `bms.pos.localTab.<token>` มีอยู่แล้ว
  ที่ `/pos` · ของใหม่คือ `bms.pos.restaurantScreen.<token>` + `bms.pos.restaurantCheck.<token>`
  (ผูกกับ device token เครื่องอื่นที่ใช้เบราว์เซอร์เดียวกันไม่เห็นของกัน)
- **จำแค่ "ยืนอยู่ไหน" ไม่จำ "กรองอะไรไว้" และไม่จำ "ใครทำงาน"** — โหมดแจ้งของหมด/ตัวกรอง
  หมดวันนี้/หมวดหมู่/สถานีบนจอครัว **ห้ามจำ** เพราะตัวกรองที่ค้างข้ามรีเฟรชคือการซ่อนงานจริง
  และกลับมาอยู่ในโหมดแจ้งของหมด = แตะการ์ดแล้วปิดเมนูแทนสั่งอาหาร · PIN/ผู้ปฏิบัติงานไม่จำ
  ตามกฎเดิมของ repo
- **บิลที่ทำอยู่**: เก็บแค่ `{id, savedAt}` (ยอดเงินมาจาก server เสมอ) · TTL 8 ชม. นับจาก
  **การแตะครั้งล่าสุด** (เท่ากับ `LOCAL_CART_DRAFT_MAX_AGE_MS`) · คืนค่าแล้ว **ยืนยันกับ
  server ทุกครั้ง** และรับเฉพาะสถานะ `OPEN`/`CLOSING`
- **`?screen=kitchen` ปักหมุดจอครัวได้** (รับ order/floor/kitchen/kds/…) ชนะค่าที่จำไว้ →
  จอครัวติดผนังเปิดลิงก์เดียวจบ แม้ล้าง site data หรือใช้โหมดส่วนตัว
- **⚠️ บั๊กที่ตัวเองสร้างแล้วจับได้เพราะเปิดดูจริง (เทส+tsc เขียวสนิท)**: รอบแรกทำ
  `replaceState` เขียนจอที่เปิดอยู่กลับลง URL ("กด F5 แล้วอยู่จอเดิมแม้ localStorage ใช้ไม่ได้")
  ผลคือ **ทุกการโหลดถัดไปกลายเป็น "ลิงก์ที่คนตั้งใจปักหมุด"** แล้วโค้ดที่ `return` ทิ้งหลัง
  อ่าน URL ก็ **ข้ามการคืนบิลไปเงียบ ๆ** — อาการคือแท็บจำได้แต่โต๊ะไม่กลับมา และไม่มี error
  ที่ไหนเลย · **กฎที่ได้: พารามิเตอร์ที่แปลว่า "คนตั้งใจสั่ง" ห้ามให้โปรแกรมเขียนเอง**
  (มีเทสห้าม `searchParams.set("screen")` / `history.replaceState` แล้ว)
- **กับดักที่สอง (async restore)**: ธง "คืนค่าเสร็จแล้ว" ต้องเป็น **state ไม่ใช่ ref** และปัก
  ใน `.finally()` — การคืนบิลเป็น async ถ้า effect ที่เขียนดูแค่ "เริ่มคืนค่าแล้ว" มันจะวิ่งไป
  ลบคีย์ตั้งแต่ตอน `check` ยัง null · และ **`viewRestored` ต้องอยู่ใน deps ด้วย** ไม่ใช่แค่ใน
  เงื่อนไข ไม่งั้นคีย์ของบิลที่คืนไม่สำเร็จค้างตลอดไปและเสีย GET ทิ้งทุกครั้งที่เปิดจอ
- **แก้ของเดิมไปด้วย 1 จุด**: `refresh()` เคยรับบิลกลับมาโดยไม่ดูสถานะ → บิลที่ถูกเก็บเงิน/
  ยกเลิกที่เครื่องอื่นค้างบนจอให้กดต่อแล้วไปล้มที่ server ตอนนี้หลุดจากจอทันที
- **verify จริงในเบราว์เซอร์ 6 กรณี**: อยู่จอครัว→รีเฟรช→ยังอยู่จอครัวและ **poll เดินต่อ**
  (นับได้ 10 request) · เปิดโต๊ะ→รีเฟรช→บิลกลับมาครบ (โต๊ะ 1 · ฿200) · `?screen=kitchen`
  ชนะค่าที่จำไว้ **และยังคืนบิลให้ด้วย** · บิลที่ `CANCELLED` ไม่ถูกคืนและคีย์ถูกล้าง ·
  บิลที่ค้างเกิน 8 ชม. ไม่ถูกคืน · URL ไม่ถูกเขียนเอง
- **เทส**: `scripts/restaurant-pos-contract.test.mts` +3 (รวม 35) — จำจอ/URL ชนะ/ห้ามเขียน URL ·
  บิลต้องมี TTL + ยืนยันกับ server · **ตัวห้าม**: สแกนว่ามีคีย์ localStorage ได้แค่ 4 ตัวใน
  allowlist และ PIN/โหมด/ตัวกรองต้องไม่ถูกเก็บ · **ผ่าน mutation test 6 แบบ** — และรอบแรก
  **มี 1 เทสที่ไม่แดง** (assert guard แบบทั้งไฟล์ เขียวได้ด้วย guard ของ effect อื่น) แก้เป็น
  ตรวจทีละจุดเขียนแล้วถึงแดงจริง
- **ยังไม่ได้ทำ (จงใจ)**: ไม่จำโซนที่เลือกบนผังโต๊ะ (`activeArea` เป็นตัวกรอง) · ไม่ล้างคีย์
  ตอนเลิก pair ที่ `/pos` (คีย์ผูกกับ token ที่ตายแล้ว เข้าถึงไม่ได้อีก) · หน้า `/pos` (ค้าปลีก)
  ไม่ถูกแตะ

## ปุ่ม "หมดวันนี้" ที่จอสั่งอาหาร — 2026-09-04 (ไม่มี migration, ไม่มี permission ใหม่)

branch `feat/menu-availability-ux` · `tsc` ผ่าน · **pure 782 เทสผ่าน** · production build ผ่าน ·
**เปิดดูจริงในเบราว์เซอร์แล้ว** (dev localhost:3000 ร้าน shop-b เดินครบทั้ง 5 สถานะ)

- **ต้นเหตุ (รายงานจากหน้าร้านจริง)**: แถบแดงเต็มความกว้างใต้ *ทุก* การ์ดเขียนว่า "หมดวันนี้" ซึ่งเป็น
  **ปุ่มสั่งงาน** แต่อ่านเป็น **ป้ายสถานะ** → พนักงานเข้าใจว่าเมนูปิดอยู่ทั้งที่ยังขายได้ (ยืนยันด้วย
  `bms_product_menu_unavailability` = 0 แถวทั้งฐาน) · ซ้ำร้ายปุ่มที่ย้อนคืนยากไปนั่งติดปุ่มที่กดบ่อยสุด
  ของจอด้วยขนาดเท่ากัน และสถานะจริงกลับเบากว่า (การ์ดจาง `opacity:.52` + ป้ายเล็ก)
- **แก้เป็น**: การ์ดปกติเหลือปุ่มเดียว (แตะ = สั่ง) + ปุ่ม ⋯ 34px มุมขวาบนเปิดแผ่นยืนยันที่ให้เลือก
  **สาเหตุจริง** (`MENU_SOLD_OUT_REASONS`: วัตถุดิบหมด / เตา-เครื่องไม่พร้อม / งดขายรอบนี้) ·
  การ์ดที่ปิดอยู่ได้ริบบิ้นแดงพาดหน้าการ์ด + **เวลาที่จะกลับมาขายเอง** และปุ่มเต็มความกว้างเปลี่ยนเป็น
  **เปิดขาย** สีเขียว (ตอนนั้นคือสิ่งที่คนอยากทำจริง) · กติกาเดียวกับที่ `.sheetActions` ยุบงานทั้งบิล
  (ย้ายโต๊ะ/ยกเลิก) ไป Modal เมื่อ `9.44`
- **โหมด "แจ้งของหมด"** บนแถบเครื่องมือ (ครัวเดินมาบอกทีเดียว 5 อย่าง) → ทุกการ์ดกลายเป็นสวิตช์
  กดเสร็จแล้วการ์ดกลับมาสะอาด · **ตัวนับ "หมดวันนี้ N"** สีน้ำตาลกดกรองได้ และ **ปลดตัวกรองเอง**
  เมื่อเปิดขายครบ (กติกาเดียวกับตัวกรองสถานีบนจอครัว — ตัวกรองค้างกับกริดว่างอ่านว่า "ระบบพัง")
- **เวลาที่เมนูจะกลับมาขายเองมาจาก server เท่านั้น** — `listRestaurantMenu` เปลี่ยนจาก
  `EXISTS(...)` เป็น LEFT JOIN แล้วคืน `unavailableResetsAt` + `unavailableReason` (คอลัมน์มีอยู่แล้ว
  ตั้งแต่ `9.55` ไม่ต้อง migration) · จอห้าม hardcode 04:00 เพราะเวลารีเซ็ตวันบริการตั้งได้รายร้าน
  (`menu_availability_reset_time` + timezone) — เลขที่ผิดคือเลขที่พนักงานเอาไปบอกลูกค้า
- **⚠️ บั๊กที่เจอเฉพาะตอนเปิดดูจริง (เทส/tsc จับไม่ได้เลย)**: `pos.css` มี
  `.pos-root button:hover:not(:disabled) { background: var(--pos-sunken) }` ซึ่ง **เจาะจงกว่า
  `.page .<class>` ของ CSS module** → ปุ่มที่ทาสีเองทุกตัวกลายเป็น **สีขาวพร้อมตัวหนังสือสีขาว
  = อ่านไม่ออก** ตอน hover · และ **บนจอสัมผัส `:hover` ค้างอยู่กับปุ่มที่แตะล่าสุดจนไปแตะที่อื่น**
  แปลว่าที่เคาน์เตอร์จะเห็นปุ่มว่างเปล่าเป็นปกติ ไม่ใช่แค่ตอนเอาเมาส์ไปชี้
  · `.btnPrimary` เคยเจอและแก้ไว้แล้วด้วย `:hover:not(:disabled)` — **ปุ่มใหม่ทุกตัวต้องประกาศ
  hover ของตัวเองเสมอ** · แก้ให้ของใหม่ทั้งชุด และ **ของเดิมที่มีบั๊กเดียวกันอยู่ก่อน 3 ตัว**:
  ชิปหมวดหมู่ที่เลือกอยู่ (`.catCardActive`) · ตัวกรองสถานีบนจอครัว (`.kitchenFilterOn`) ·
  แท็บโซนบนผังโต๊ะ (`.areaButtonActive`) — สามตัวนี้คือปุ่มที่แตะบ่อยที่สุดของสองจอ
- **กับดักเล็กที่แก้คู่กัน**: ตัวเลขจำนวนในบิล (`.dishQty`) กับปุ่ม ⋯ อยู่มุมขวาบนเดียวกัน →
  เพิ่มคลาส `.dishCardKebab` เลื่อนตัวเลขไป `right: 44px` เฉพาะการ์ดที่มีปุ่ม ⋯ จริง
- **เทส**: `scripts/menu-availability-contract.test.mts` เพิ่ม 2 ตัว (รวม 11) — ห้ามคืนแถบปิดขาย
  เต็มความกว้างใต้การ์ดที่ยังขายได้ · ปุ่ม ⋯ ต้องเปิดแผ่นยืนยันก่อน ไม่ใช่ปิดทันที · เวลาเปิดอีกครั้ง
  ต้องมาจาก server · **ผ่าน mutation test แล้ว 3 แบบ** (กดปุ่มแล้วปิดทันที · จอ hardcode 04:00 ·
  service คืน `unavailableResetsAt: null`) แดงถูกตัวทุกครั้ง
- **verify กับ DB จริง**: เรียก `setMenuTemporarilyUnavailable` + `listRestaurantMenu` ตรง ๆ บน dev DB
  → ปิด: `SOLD_OUT_TODAY` + เหตุผล + `resetsAt` = 04:00 กรุงเทพของวันถัดไป · เปิด: กลับเป็น
  `AVAILABLE` ทุกฟิลด์เป็น null · ตารางเหลือ 0 แถว ไม่มีข้อมูลค้าง
  · **ตอน verify ต้องยืมเครื่อง POS-01 ของ shop-b ชั่วคราว** (สำรอง `token_hash` เดิม → ตั้งของตัวเอง
  → คืนค่าเดิมหลังเสร็จ ยืนยันแล้วว่าคืนตรง) เพราะ token เก็บเป็น sha256 กู้ค่าเดิมจากแฮชไม่ได้ —
  **ห้ามทับ token ทิ้งโดยไม่สำรอง** ไม่งั้นเครื่องที่ pair ไว้ต้อง pair ใหม่
- **ยังไม่ได้ทำ (จงใจ)**: การ์ดที่ปิดขายอยู่สูงกว่าเพื่อนในแถวเดียวกันเล็กน้อย (มีปุ่มเปิดขายเพิ่ม) ·
  ยังไม่มีปุ่ม "ปิดหลายเมนูรวดเดียว" ในโหมดแจ้งของหมด (สลับทีละตัว ยิง API ต่อครั้ง) ·
  ยังไม่ได้ยกดีไซน์นี้ไปหน้า `/admin/kitchen` (คนละหน้า ใช้ `t()` ครบ)

## Restaurant chat delivery rollout (2026-09-04)

- `9.55` เพิ่มสถานะหมดชั่วคราวรายเมนู/สาขา และใช้ availability policy เดียวกันทุกช่องทาง
- `9.56` เพิ่มสาขา ประเภทรับของ เวลาสัญญา เวลารับออร์เดอร์ และ human-accept ก่อนยิงตั๋วครัว
- `9.57` ใช้ POS return engine เดิมเพื่อตัดเมนูออนไลน์รายรายการ, เก็บต้นเหตุถาวร, คืนเงินเข้าคิว และบันทึกส่วนต่างที่ร้านรับ
- เฟส 5 ใช้ค่าส่ง `flat`, prepaid-only, carrier `OTHER`; เปลี่ยน checklist/seed default เป็นเมนูไม่บังคับสูตร และเพิ่มไกด์ผู้ช่วย 3 เรื่องพร้อมคอร์ปัส
- cron หลักยิงรีเซ็ตเมนูทุก 15 นาทีเพื่อเคารพ `resets_at` ของแต่ละ timezone/เวลาที่ร้านตั้ง ไม่ผูกกับ 04:00 กรุงเทพอย่างเดียว
- ผ่าน typecheck และ pure contract ของเฟส 1–5; migration/DB contract และ browser QA ยังไม่ได้รันเพราะเครื่องนี้ไม่มี local DB/server

### recheck ต่อจาก codex — เจอของจริง 10 จุด แก้ครบแล้ว (2026-09-04)

`tsc --noEmit` ผ่าน · **pure 785 เทสผ่านทั้งหมด** (ก่อน recheck **แดง 2 ตัว**) · production build ผ่าน
· **เทส DB ยังไม่ได้รันในรอบนี้** (เครื่องนี้ไม่มี Postgres ของ BMS — `docker ps` มีแต่ container
ของโปรเจกต์อื่น) ต้อง apply `9.55`–`9.57` เข้า dev DB แล้วรันชุด DB ให้ผ่านก่อนเชื่อว่าใช้ได้จริง
· **ทั้ง 10 จุดผ่าน mutation test แล้ว** (ย้อนโค้ดกลับทีละจุด → แดงถูกตัวทุกครั้ง)

1. **⚠️ `bms_locations` ไม่มีคอลัมน์ `is_default` — ออร์เดอร์ร้านอาหารออนไลน์สร้างไม่ได้เลยสักใบ**
   · `createOrderInTx()` และ `listRestaurantOrderLocations()` ทั้งคู่ `ORDER BY is_default DESC, name`
   · ตาราง `bms_locations` (7.84) มีแค่ `code` / `is_head_office` — `is_default` เป็นคอลัมน์ของ
   `bms_customer_addresses` (3.6) → ทุกการเรียกล้มด้วย **42703** แปลว่าเส้นทางสั่งอาหารทางแชท
   **พังทั้งเส้น** และทูล `list_restaurant_order_locations` ล้มทุกครั้งที่ลูกค้าถามเรื่องสาขา
   · แก้เป็นลำดับเดียวกับ `resolveDefaultLocationIdInTx()` (`(code = 'MAIN') DESC,
   is_head_office DESC, created_at`) เพื่อให้ fallback ของร้านสาขาเดียวได้สาขาเดียวกับที่เส้นสต็อก
   ทั้งระบบเรียกว่า default · **กันย้อนกลับด้วยเทสที่สแกน template literal ทุกก้อนที่เอ่ยถึง
   `bms_locations` แล้วห้ามมีคำว่า `is_default`** (ไม่ใช่แค่จับสองบรรทัดที่เจอ)
2. **⚠️ `9.57` DROP CHECK ผิดตัวได้ 50%** — `bms_order_discounts` (7.96) มี check ที่เอ่ยคำว่า
   `source` **สองตัว**: ลิสต์ค่าที่ต้องขยาย และ `CHECK (points_used = 0 OR source = 'POINTS')`
   · เดิมหาด้วย `pg_get_constraintdef(oid) LIKE '%source%'` + `SELECT INTO` ซึ่งได้ตัวไหนก็ได้
   → ถ้าได้ตัว points_used: ลิสต์ 4 ค่าเดิมยังอยู่ **ทุก insert `MERCHANT_ABSORBED` ล้มด้วย
   check violation** และการ์ด points_used หายเงียบ ๆ · เป็นกับดักตัวเดียวกับที่ `9.52` จดไว้แล้ว
   ("ต้องกรอง `array_length(conkey,1) = 1`") · แก้เป็น FOR loop ที่กรอง single-column check บน
   คอลัมน์ `source` ที่ def มีคำว่า `TIER`
3. **⚠️ เปิดกะล้างธง "หมดวันนี้" ทั้งสาขา** — `resetMenuAvailabilityForLocationInTx()` ลบทุกแถวของ
   สาขา · กะเป็นของ **เครื่อง x คนขาย** ไม่ใช่ของ **วันบริการ**: ร้านสองเครื่อง หรือร้านที่เปลี่ยนกะ
   กลางวัน เปิดกะหลายรอบต่อวัน → เครื่องที่สองเปิดกะตอน 11:00 เอาเมนูที่ครัวเพิ่งบอกว่าหมดตอน 10:30
   **กลับขึ้นเมนูทันที** โดยไม่มีอะไรบนจอบอกว่าใครยกเลิกการตัดสินใจนั้น
   · นี่คือความเสียหายเดียวกับที่เหตุผลของ "รีเซ็ต 04:00 ไม่ใช่เที่ยงคืน" กันไว้ แค่มาจากการเปิดกะ
   แทนเที่ยงคืน · แก้เป็นล้างแค่แถวที่ `resets_at <= now()` — **เจตนาเดิม (เปิดร้านแล้วเมนูของเมื่อวาน
   กลับมาขายเองแม้ยังไม่ได้ตั้ง cron) ยังอยู่ครบ** เปลี่ยนแค่ขอบเขต
4. **⚠️ `restaurantOrderingStateInTx()` อ่านคอลัมน์ของ `9.56` ในคำสั่งเดียวกับ `business_archetype`**
   — ฟังก์ชันนี้รันกับ **ทุกออร์เดอร์ที่ไม่ใช่ POS ของทุกร้าน** ฐานที่ยังไม่ apply `9.56` จึง
   **ขายไม่ได้ทั้งแพลตฟอร์ม ไม่ใช่แค่ร้านอาหาร** · กับดักเดียวกับ recheck ข้อ 1 ของ `9.29`
   · แยกเป็นสองคำสั่ง: อ่าน archetype ก่อน แล้วอ่านคอลัมน์ใหม่เฉพาะร้านอาหาร
   · **ยังเหลือรัศมีกว้างที่ไม่ได้แก้ (จงใจ)**: `listSellableProducts()`/`checkStock()` อ่าน
   `bms_product_menu_unavailability` (9.55) ให้ทุกร้าน → **ต้อง apply `9.55` ก่อน deploy โค้ดชุดนี้เสมอ**
   (repo นี้ไม่มี schema probe ที่ไหนเลย — กฎเดียวกับ `9.40`/`9.51`/`9.52`)
5. **การ์ดออร์เดอร์เข้าโชว์รายการที่ตัดไปแล้ว และส่งจำนวนผิดหน่วยให้ปุ่มตัดรายการ** —
   `listIncomingRestaurantOrders()` คืน `oi.qty` ตรง ๆ · ผลสองอย่าง: (ก) เมนูที่ตัดไปแล้ว
   (ตั๋วครัวยกเลิกแล้ว เงินเข้าคิวคืนแล้ว) ยังอยู่บนการ์ดให้ครัวทำต่อ (ข) `cancelRestaurantOrderLines()`
   อ่าน `packQty` เป็น **จำนวน pack** (`pack_qty`) ไม่ใช่หน่วยฐาน → บรรทัดที่ขายเป็นแพ็ก
   **ตัดไม่ได้เลย ตอบ `RETURN_QTY_EXCEEDED` ทุกครั้ง** · แก้ให้คืน "จำนวนที่ยังเหลือจริง" ในหน่วยเดียวกับ
   ที่ปุ่มตัดต้องใช้ + ซ่อนบรรทัดที่ตัดครบแล้ว (นิพจน์ returned เดียวกับเส้นทางคืนของใน `pos.ts`)
6. **`cancel_lines` ตัดบางบรรทัดเงียบ ๆ เมื่อ payload บางบรรทัดผิดรูป** — route ใช้ `.filter()`
   แล้วเดินต่อ · ตัดอาหารออกจากบิลลูกค้าและคืนเงินคนละยอดกับที่เครื่องสั่ง โดยไม่มีที่ไหนบอกว่ามีบรรทัดหาย
   · แก้เป็นปฏิเสธทั้งคำขอ 400 (กฎเดียวกับที่ `9.5` ทำกับ `parsePosExtraLines`)
7. **cron รีเซ็ตเมนู throw ออกจากลูป** — ร้านเดียวที่ล้มทำให้ร้านที่เหลือ **ไม่ถูกกวาดเลย** และรอบถัดไป
   เจอแถวเดิมแล้วหยุดอีก = เมนูปิดค้างตลอดไป (รูปเดียวกับบั๊ก `orders/release-expired`)
   · แก้เป็นเก็บ `failed[]` แล้วเดินต่อ + คืน `failedCount` ออกไปที่คำตอบของ endpoint
8. **`checkStock()` throw `Error` เปล่าเมื่อ locationId ไม่ใช่สาขาจริง** → โมเดลได้ข้อความ
   "ดึงข้อมูลไม่สำเร็จ" **พร้อมเปิด incident `ai.tool_failed`** ทั้งที่เป็นแค่โมเดลเดา UUID ผิด
   · ห่อด้วย `checkStockForBranch()` ใน catalog ให้เป็น `ToolArgError` ที่บอกให้เรียก
   `list_restaurant_order_locations` ก่อน (โมเดลแก้เองได้ ไม่กินโควตา incident)
9. **⚠️ `checkStock()` อ่านไซซ์เมนูจาก `bms_inventory` แต่ความจริงของไซซ์อยู่ที่
   `bms_product_variants` (9.51)** — `9.51` ประกาศไว้เองว่า "A recipe menu may have a variant while
   its own inventory remains zero" และติด trigger ให้การเขียน inventory/pack/recipe **ซิงก์เข้า**
   ตาราง variant **ทางเดียว** · `upsertProduct()` เขียนแถว variant แต่ **ไม่เคยสร้างแถว
   `bms_inventory`** → เมนูที่ร้านเพิ่งพิมพ์เข้าไปเองได้ `MENU_SIZE_REQUIRED` พร้อม `sizes: []`
   และ `create_order` บังคับ `size` **โมเดลจึงไปต่อไม่ได้เลย** = อาการเดียวกับที่เฟส 2 ทำมาเพื่อแก้
   แค่ย้ายไปโผล่ช้าลงหนึ่งขั้น
   · **ร้ายที่สุดคือมันดูเหมือนใช้ได้**: seeder เขียน `bms_inventory` ให้ (จึงผ่านตอนกดข้อมูลตัวอย่าง)
   และ backfill ของ `9.51` ยกไซซ์เดิมของร้านที่มีอยู่แล้วมาให้ → **เขียวใน demo, พังกับเมนูใหม่ของ
   ร้านจริง** · แก้ให้กิ่ง NON_STOCK/RECIPE อ่านจาก `bms_product_variants` เหมือน
   `listRestaurantMenu()` (9.44) และ `resolvePosScan()` (9.52) — สามจอตอบคำถามเดียวกันด้วยแหล่งเดียว
   · กิ่ง DIRECT/PACK ยังอ่าน inventory ตามเดิมโดยตั้งใจ (ของนับได้ที่ไม่มีแถวสาขา = ไม่มีของจริง)
10. **ปล่อย reserved ตอนตัดรายการไม่ตรวจว่าลงตัว** — `bms_inventory.reserved_stock` เป็น `INTEGER`
   (3.2) เศษทศนิยมจะถูก Postgres ปัดเงียบ ๆ แล้วเหลือ drift ที่ไล่ต้นเหตุไม่ได้ · กิ่งคืนของหน้าเคาน์เตอร์
   ในฟังก์ชันเดียวกันตรวจอยู่แล้ว กิ่งตัดรายการออนไลน์ไม่ตรวจ · ทุก policy หารลงตัวโดยโครงสร้าง
   ดังนั้นเศษ = snapshot เพี้ยน → ปฏิเสธการตัดรายการ ตรงกับที่กิ่งข้างล่างทำ

**ยังไม่ได้แก้ (ตั้งใจ — เสี่ยง regression เกินขอบเขต recheck)**:
`listSellableProducts()` (`search_products`) ยังคืน `availableSizes` จาก `bms_inventory` ล้วน เมนูใหม่
จึงโผล่ในผลค้นหาโดยไม่มีไซซ์ · เส้นทางที่บังคับคือ `check_stock` ซึ่งแก้แล้ว แต่ถ้าโมเดลข้ามไป
`create_order` ตรง ๆ จะได้ `INVALID_ITEM` แล้ววนถาม · การเปลี่ยนแหล่งของ `availableSizes` กระทบ
หน้าร้านออนไลน์/แอดมิน/AI พร้อมกัน 5 จุด และ `availableTotal`/`inStockOnly` ผูกกับตัวเลขเดียวกัน —
ควรทำเป็นงานแยกที่มีเทสของตัวเอง

**เทสที่แดงอยู่ก่อน recheck 2 ตัว (แก้แล้ว — เป็นเทสค้าง ไม่ใช่โค้ดผิด)**:
`restaurant-delivery-readiness` ยัง assert `status = 'PAID' RETURNING id … enqueueKitchenTicketsInTx`
ซึ่ง **บังคับให้ `packOrder()` กลับไปยิงตั๋วครัวให้บิลค้าปลีกทุกใบ** ที่สินค้าบังเอิญมีสถานี ·
`restaurant-online-order` assert ternary ของแท็บ POS แบบต้องอยู่บรรทัดเดียว

**ยังไม่ได้แก้ / ต้องรู้ก่อนใช้จริง**:
- **ยอด `amountDue` บนการ์ดออร์เดอร์เข้ายังเป็นยอดตอนสั่ง** ไม่หักยอดที่คืนไปแล้ว (ตั้งใจ — บิล/ใบกำกับ
  ที่ออกไปแล้วไม่ถูกเขียนใหม่ ตามกฎเดียวกับ `9.22`) ยอดคืนอยู่ในคิวคืนเงินแยก
- `restaurantCancellationLossReport()` เกลี่ย `merchant_absorbed_amount` ตามมูลค่าของ **ทุกบรรทัด**
  ที่ถูกตัดในใบนั้น ไม่ได้แยกว่าบรรทัดไหนเป็น `MERCHANT_OUT_OF_STOCK`
- การเลือกผู้จัดการยืนยันส่วนต่างที่หน้า POS ใช้ `window.prompt` (ไม่มี harness ทดสอบ React
  component ใน repo นี้) — ต้องลองด้วยมือที่หน้าจอ
- **ยังไม่เคยเปิดดูจริงในเบราว์เซอร์** ทั้งแท็บ "รับออร์เดอร์", คิวคืนเงิน, ปุ่มปิดเมนูหมดวันนี้

> `loginAdmin` ตรวจรหัสผ่านจริงทุก environment แล้ว (`passwordMatches()`, ยืนยัน 2026-08-13) — โน้ตเก่า
> ที่เขียนว่า "dev ยังไม่ตรวจ" ไม่ตรงกับโค้ดปัจจุบัน
