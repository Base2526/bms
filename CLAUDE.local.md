# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

เก็บเฉพาะสิ่งที่ต้องใช้ทุกครั้งที่ลงมือทำในเครื่องนี้ · สเปก: [CLAUDE.md](CLAUDE.md) ·
กฎ agent: [AGENTS.md](AGENTS.md) + [docs/agent-invariants.md](docs/agent-invariants.md)

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
  `email_report` (`7.54`), Cron run history (`7.55`), Manager staff management (`7.78`),
  AI usage accounting (`7.82`)
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

> `loginAdmin` ตรวจรหัสผ่านจริงทุก environment แล้ว (`passwordMatches()`, ยืนยัน 2026-08-13) — โน้ตเก่า
> ที่เขียนว่า "dev ยังไม่ตรวจ" ไม่ตรงกับโค้ดปัจจุบัน
