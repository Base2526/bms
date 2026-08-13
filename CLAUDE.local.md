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
  Purchase** แล้วดู Dashboard/Reports/Inbox · Cleanup ลบเฉพาะร้านที่ยืนอยู่ (marker `FAKE-`/tag `fake`)
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
   (เคยต้อง renumber `6.1`→`6.3`, `7.53`→`7.55`, `7.55`→`7.56`)
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
- ยังไม่มี cron schedule จริงให้ 6 endpoint ที่พร้อมแล้ว (บันทึกลง `bms_job_runs` ได้แล้ว แค่ยังไม่มี
  ตัวยิงอัตโนมัติ)

## ก่อน production (สำคัญ)

- **migration ที่ยังไม่ได้ apply เข้า production (ณ 2026-08-13)**: `7.33` (product discovery
  indexes), `7.52` (follow-up automation), `7.54` (`report.email`), `7.55` (`bms_job_runs`),
  `7.56` (`users.language` CHECK), `7.78` (user management perms), `7.81` (default ภาษา = th),
  `7.82` (AI usage accounting) — **ตรวจกับ DB จริงก่อนเชื่อรายการนี้** · และ `5.6`/`5.7` ต้องมีก่อน
  (platform admin + operational perms; seed platform admin ชุดแรก = Administrator ของร้าน default)
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
