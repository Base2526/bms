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
