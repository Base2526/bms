# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

เก็บเฉพาะสิ่งที่ต้องใช้ทุกครั้งที่ลงมือทำในเครื่องนี้ · สเปก: [CLAUDE.md](CLAUDE.md) ·
กฎ agent: [AGENTS.md](AGENTS.md) + [docs/agent-invariants.md](docs/agent-invariants.md) ·
ประวัติรายฟีเจอร์: [docs/status-log.md](docs/status-log.md)

> **กติกาของไฟล์นี้: ห้ามยาวเกิน ~250 บรรทัด** — ไฟล์นี้ถูกโหลดเข้า context ทุก session
> บันทึกงานรายรอบ (recheck/mutation test/ผลรัน gate) เมื่อจบงานแล้วให้ย้ายไป
> [docs/local-notes-archive.md](docs/local-notes-archive.md) ทันที แล้วเหลือแค่บรรทัดสรุปใน
> § ค้างอยู่ / § ก่อน production ด้านล่าง · 2026-11-02 ย้ายไปแล้ว 75 หัวข้อ (~7,600 บรรทัด,
> บันทึก 2026-08-17 → 2026-10-23) อยู่ใต้ "ชุดที่ 2" ของ archive — ค้นด้วยเลข migration เช่น
> `grep -n "9.66" docs/local-notes-archive.md`

## สถานะ working tree ล่าสุด (2026-11-14)

- **PR ทุกตัว merge เข้า `develop`** (`origin/main` ค้างอยู่ที่ #115) · `develop` ล่าสุด = `9d0c8a32` (#412,
  ภาษาไทย/อังกฤษของ POS/mobile/desktop) · branch `codex/bms-completion-core-20261113` = `develop` +
  public retail cart, branch price windows (`10.116`), shipment retry, lot shipping + งาน Inbox/Admin
  hardening, fish-dock (`10.119`–`10.120`) และอัปเดตเอกสารรอบ 2026-11-14
- **migration ล่าสุด `10.120`** (เลขว่างถัดไป `10.121` — ตรวจด้วยคำสั่งในกับดักข้อ 4 ก่อนตั้งเสมอ) ·
  ตรวจเลขซ้ำ 2026-11-14 แล้วว่าง · คิวรับของคือ `10.112`–`10.113` (ไม่ใช่ `10.111` = ใบอนุญาตเภสัชกร)
- หลักฐานรอบตรวจระบบ 2026-11-14 (Inbox/Desktop/Mobile/Admin) และสิ่งที่ยัง **ไม่** verify:
  [docs/architecture/system-recheck-2026-11-14.md](docs/architecture/system-recheck-2026-11-14.md)
- renumber merge แล้ว (#391): `10.106` = Retail Local lead erasure · Meta inbox enrichment = **`10.108`** ·
  environment ที่เคย apply ไฟล์เก่า `10.106__bms_meta_inbox_enrichment` ไปแล้ว รัน `10.108` ซ้ำได้โดยไม่เสียหาย
  (`ADD COLUMN IF NOT EXISTS`)
- **`10.107` (โอนสต็อกพร้อมล็อต) = commit แล้ว + verify บนฐาน clone แล้ว แต่ยังเป็น WIP ของการ rollout**
  (#391/#398 · 8 ชุด DB 81/81 บนฐาน clone 2026-11-05) — ห้ามอ้างว่าใช้ได้บน production · รายละเอียด
  [docs/business/inventory.md § Lot transfers](docs/business/inventory.md#lot-transfers-10107)

## รันในเครื่อง (dev)

```bash
# dev stack ผ่าน docker (postgres + redis + web + ws + pgadmin; Caddy ปิดไว้โดย default)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# เปิด Caddy เฉพาะเครื่องที่ไม่มี reverse proxy ตัวอื่นจับ 80/443 อยู่
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile with-caddy up --build

# หรือรัน web อย่างเดียว (ต่อ postgres/redis ใน docker)
cd apps/web && npm install && npm run dev            # http://localhost:3000
cd apps/web && npm run gate                          # ✅ ก่อน merge ทุกครั้ง (ขั้นตอนดู § ประตูก่อน merge/deploy)
```

- **ห้ามใช้ `pnpm`** — repo ลงด้วย npm การรัน pnpm อาจย้าย package ไป `node_modules/.ignored` แล้ว
  type checker ฟ้องว่าโมดูลหายทั้งโปรเจกต์ · `.pnpm-store/` ที่โผล่มาคือเศษ ไม่ใช่ของจริง
- **Docker กับ host ห้ามแชร์ `.next`/`node_modules`** — `docker-compose.dev.yml` mount
  `web_next_cache` ที่ `/app/apps/web/.next` และ `web_node_modules` ที่ `/app/apps/web/node_modules`
  แยกจาก bind mount ของ source **ห้ามถอด** ถ้าแชร์กัน manifest ของ App Router ปนกันจนทุก route พัง
  ด้วย `Cannot read properties of undefined (reading 'clientModules')` และ native package (เช่น
  `esbuild`) จะคนละ platform · recovery: หยุดเฉพาะ `web` → ล้าง `.next` → recreate container `web`
  (ไม่ต้องแตะ volume ของ Postgres)
- dev compose รัน `npm ci` เฉพาะตอนยังไม่มี `node_modules/.package-lock.json` ใน volume — ถ้าเปลี่ยน
  dependency แล้ว container ไม่ตรง ให้ recreate เฉพาะ volume `web_node_modules` หรือ exec เข้าไปรัน `npm ci`
- **`NEXT_PUBLIC_GRAPHQL_HTTP` ของ container dev เคยชี้ production** (`https://jachoei.com/api/graphql`)
  หน้า `/admin` ใน container จึงยิงข้าม origin แล้ว permission ว่าง — ตรวจหน้าแอดมินด้วย host dev server
  (port แยก) หรือแก้ env ของเครื่องเองก่อนเชื่อผลในเบราว์เซอร์
- เนื้อที่ไม่พอ: `du -sh apps/web/.next apps/web/node_modules` + docker volumes — โปรเจกต์นี้จงใจมี
  cache สองชุด (host + docker)

## ประตูก่อน merge/deploy (gate)

วิธีรันทุกชุด, output จริงทั้งกรณีผ่าน/ไม่ผ่าน, exit code และจำนวนไฟล์ล่าสุด:
[scripts/README.md](scripts/README.md)

```bash
cd apps/web && npm run gate                              # release:features:check → regression:inventory → typecheck → pure → build
node scripts/run-contract-tests.mjs pure <name-filter>   # ไฟล์เดียว/กลุ่มเดียว (ไม่ตรงอะไรเลย = exit 2)
node scripts/run-contract-tests.mjs db <name-filter>     # ต้องมี POSTGRES_HOST/POSTGRES_DB ของเครื่องท้องถิ่น
```

- นับ 2026-11-14: **468 ไฟล์ที่ตัวรันหยิบ** = pure **365** (329 ชั้นบนของ `scripts/` รวม
  `retail-local-migration-checksum.test.mjs` + 35 ใน `ai-eval/` + 1 ใน `infra/`) + DB **103**
  (`-db-contract` ทั้งหมดอยู่ชั้นบนของ `scripts/`) · นับใหม่ด้วย
  `node scripts/run-contract-tests.mjs pure --list` (และ `db --list`) — พิมพ์รายชื่อเป็น JSON
- ผลรันจะถูกเขียนลง `.test-output/<mode>.tap` + `.test-output/<mode>.run.txt` — **ไฟล์ `.run.txt`
  ที่ไม่มีบรรทัด `exit=` = รอบนั้นยังไม่จบ ห้ามอ่านว่าเขียว**
- **`test:db` ปฏิเสธ host ที่ไม่ใช่เครื่องท้องถิ่น** (`BMS_TEST_ALLOW_REMOTE_DB=1` ถ้าจงใจ) — ชุดนี้เขียนจริงลงฐาน
- **CI** (`.github/workflows/gate.yml`) รันชุดเดียวกับ `npm run gate` (release features + regression
  inventory + typecheck + pure + build) **ไม่มีโหมด DB** — "pure เขียว" ไม่เท่ากับเส้นทางฐานข้อมูลถูกเดิน
  และ "อยู่ใน inventory/manifest" ไม่ได้แปลว่าเคยรันผ่านหรือเปิดใช้บน production
- **⚠️ `db/migrations` สร้างฐานใหม่ตามลำดับเลขไม่ได้** — `1.24__roles.sql` กับ
  `001_normalize_roles_phase1.sql` นิยาม `roles` คนละแบบ (เช่นเดียวกับ `scam_phones_summary` 1.20/1.27)
  ฐานสร้างเสร็จโดยไม่มี error แต่หน้า users/roles พัง · DB test ต้องใช้ฐานที่ restore จาก dump
  ([docs/architecture/realtime-test-database.md](docs/architecture/realtime-test-database.md))
- ก่อน deploy: `cd apps/web && npx tsx ../../scripts/preflight-deploy.mts` (read-only; exit 0/1/2 =
  พร้อม/บล็อก/ตรวจไม่ได้ — 2 ก็ห้าม deploy) และตรวจฐานเป้าหมายด้วย
  `psql ... -f - < db/checks/schema-readiness.sql` (เซิร์ฟเวอร์ไม่มี Node)

## เฉพาะเครื่อง/โปรเจกต์นี้

- **drill-down เข้าร้าน** = cookie `BMS_ACT_TENANT` (signed, ผูก `admin.id`) override tenant ใน
  `app/api/graphql/route.ts` · platform admin = `users.is_platform_admin`
- **fake data (dev)** — `/admin/dev/fake` + `app/api/dev/fake/*` (ปิดใน production, gate ด้วย
  `requirePlatformAdminSeeder()`) · กดตามลำดับ **Products → Customers → Orders → Conversations →
  Purchase → BMS Members + Points** · Cleanup ลบเฉพาะร้านที่ยืนอยู่ (marker `FAKE-`/tag `fake`)
- **ops automation** — `.github/workflows/daily-log-triage.yml` + `scripts/bms-log-triage/*`
  (secrets: `BMS_LOG_DATABASE_URL` read-only, `ANTHROPIC_API_KEY`, `LINE_OPS_TOKEN`/`LINE_OPS_TO`)
- **500 บน production ให้ query `system_logs` ก่อนเดา** (`action = 'api.route.unhandled'`) —
  `withRouteErrorLog` เก็บข้อความจริง + SQLSTATE ไว้ก่อน `errorResponse()` จะ redact

## กับดักที่เจอซ้ำ (นอกเหนือจากที่อยู่ใน AGENTS.md)

1. **`Date` จาก `pg` ต้อง `.toISOString()` ก่อนคืนใน resolver ที่ field เป็น `String!`** — ไม่งั้น
   `GraphQLString.serialize` ได้ epoch number → frontend ได้ **Invalid Date** (pattern `toISO()`)
   · `DATE` ของ pg ห้ามผ่าน JS `Date` แล้ว `.toISOString()` (ถอยหนึ่งวันในโซนไทย) — cast `::text` ใน SQL
2. **แก้ Permissions ต้อง drill-down เข้าร้านเป้าหมายก่อน** — `/admin/permissions` แก้ตามร้านที่ยืนอยู่
3. **role dropdown ต้อง query `roles` จาก DB ห้าม hardcode**
4. **เลขไมเกรชันชนกันข้าม branch บ่อยมาก** (ล่าสุด `10.106` ถูกใช้สองไฟล์ → renumber เป็น `10.108`) —
   `ls db/migrations | sort -V | tail` ก่อนตั้งเลขเสมอ · ตรวจซ้ำ:
   `ls db/migrations/*.sql | sed 's#.*/##' | grep -oE '^[0-9]+\.[0-9]+' | sort | uniq -d` (ต้องว่าง)
5. **`trg_generic_revision` เป็นชื่อฟังก์ชัน global** — `CREATE OR REPLACE` ทับของระบบเก่าได้ ·
   **ห้ามเปิด revision ให้ตาราง `users`** (`to_jsonb(OLD)` จะเก็บ `password_hash`)
6. **เมนู sidebar ที่มี badge ต้องส่ง `collapsed` เสมอ**
7. **JSX**: ห้ามวางคอมเมนต์ `/* ... */` เป็น child แรกทันทีหลัง `{cond && (`
8. **seeder/สคริปต์ใหม่ต้องผูก `tenant_id` เอง** และต้องประกาศ `bms_product_sales_surfaces`
   (สินค้าที่ INSERT ตรงโดยไม่ผ่าน `upsertProduct` = ฉบับร่างที่ขายไม่ได้ทุกช่องทาง)
9. **403 ไม่ทำให้ logout** — เพิ่ม permission ใหม่แล้วลืม seed ให้ role → หน้าโดน 403 เงียบ ๆ
10. **ไฟล์ปน CRLF/LF** — หลายไฟล์ในรีโปเป็น CRLF; แก้ด้วยสคริปต์แล้วต้องตรวจ lone LF/`\r\r` และ
    `git diff --stat` · heredoc ของ bash ยุบ `\\` เป็น `\` (เขียนโค้ดที่มี backslash ด้วย Edit/Write tool)
11. **mutation test: commit (หรือสำรอง) ก่อน mutate เสมอ** — `git checkout -- <file>` ลบงานที่ยังไม่
    commit ทิ้งทั้งไฟล์ และคืนไฟล์ untracked ไม่ได้ · ตรวจ `git status` + SHA-256 หลังจบทุกชุด
12. **เทสที่สแกนซอร์สต้องตัดคอมเมนต์ก่อน** (และ split ด้วย `/\r?\n/`) — คอมเมนต์ที่อธิบายกฎเดิมทำให้
    เทสแดง/เขียวผิดตัว · `indexOf()` ที่หา anchor ไม่เจอได้ `-1` แล้ว slice ว่าง = เทสเขียวลอย
13. **backtick ในคอมเมนต์ SQL/SDL ที่อยู่ใน template literal ปิด literal กลางคัน** (`typeDefs.ts`, SQL ใน service)
14. **ก่อนลบข้อมูลใด ๆ ในฐาน dev ให้ดู `bms_audit_log` ว่าใครทำ** — ผู้ใช้กดทดสอบบนเครื่องเดียวกันคู่ขนานได้

## การเพิ่มโมดูลใหม่ (checklist)

1. migration `db/migrations/N.N__bms_<mod>.sql` — `tenant_id` + RLS policy (copy `4.2`) + GRANT
   `bms_app` (copy `4.3`) · ตารางกลางของแพลตฟอร์ม (ไม่มี tenant) = SELECT-only + เขียนผ่าน
   `SECURITY DEFINER` function แคบ ๆ ตามแบบ `10.86`
2. service `lib/bms/<mod>.ts` — write ใช้ `getClient()` + `beginTenantTx()`; read ใช้ `query()` +
   `WHERE tenant_id`; audit อยู่ในทรานแซกชันเดียวกับการเขียน
3. GraphQL `graphql/bms<Mod>.ts` + wire `resolvers.ts`/`typeDefs.ts`; บังคับ `requirePermission()` +
   `audit()` · ถ้าแตะ mobile surface ให้ `npm run schema:export`
4. เพิ่ม permission ใน `BMS_PERMISSIONS` — **และ seed สิทธิ์ให้ role ที่ต้องใช้ทุก tenant** (แบบ `5.7`)
5. คอลัมน์ที่ `createOrderInTx()` เขียนทุกบิล → ประกาศใน `scripts/schemaReadiness.mts` +
   regenerate `db/checks/schema-readiness.sql` · ตารางที่เขียนจาก `lib/bms` → จัดประเภทใน
   `realtime-domain-coverage-contract`
6. REST routes (ถ้าต้องการ) + Admin page + เมนู + guide ใน `lib/bms/assistantKnowledge` + คำถามใน
   corpus + คู่มือ `/admin/manual` + เอกสาร (`CLAUDE.md` area index, `status-log.md`,
   `architecture/{system,database,api}.md`, business doc)
7. workflow ใหม่ที่ไม่อยู่ใน capability catalog → เพิ่ม ID ใน `scripts/release-feature-registry.json`
   ใน change เดียวกัน (ห้ามใช้ ID ซ้ำ) แล้วรัน `npm run release:features:check` ·
   ไฟล์เทส/สโมคใหม่ต้องถูกจัดกลุ่มใน `npm run regression:inventory` ไม่งั้น gate ล้ม

## ค้างอยู่ / ยังไม่ verify (สรุป — รายละเอียดอยู่ใน archive ตามเลข migration)

อัปเดต 2026-11-14 · บันทึกก่อน 2026-10-23 อยู่ใน [archive](docs/local-notes-archive.md) — หลายข้อแก้ไปแล้ว
(เช่น AI usage `7.82` แก้ 2026-09-08, `/live-dashboard` ต่อข้อมูลจริงแล้ว) **ตรวจซ้ำก่อนอ้างทุกครั้ง**

- **`10.107` โอนสต็อกพร้อมล็อต = WIP ของการ rollout** — ดู § สถานะ working tree ด้านบน
- **ของที่ยังไม่พร้อม production** = รายการ 🧪 ใน [CLAUDE.md § Current status](CLAUDE.md) (ไม่คัดลอกมาซ้ำที่นี่)
- **ราคา Retail Local ยังเป็นข้อเสนอ** (`retailLocalPricing.approved = false`) — หน้า `/retail-local` แสดง
  "รอเจ้าของอนุมัติ" · ห้ามอ้างเป็นราคาขายจริงก่อนเจ้าของอนุมัติ
- **release feature manifest = baseline ที่ยังไม่ครบ** (`scope: baseline-in-progress`, registry เพิ่มเติม 8 รายการ) —
  ยังไม่ได้ reconcile กับทุกแถวของ `docs/feature-inventory.md` ([release-feature-control.md](docs/release-feature-control.md))
- **`schema-readiness` ตรวจ `10.99`, `10.103`, `10.104`, `10.108`, `10.109` แล้ว (เพิ่ม 2026-11-09)** —
  Action Center/ข่าวกรองการสั่งซื้อ, สร้าง/รับ PO, ช่องทางแชททุกช่อง (`getChannel()`), คิวข้อความ Meta และ
  การอัปโหลด/อ่านไฟล์ใช้คอลัมน์/ตารางของไฟล์เหล่านี้ทุกครั้ง · ตั้งใจ **ไม่ใส่** `10.100` (FK), `10.101` (ข้อมูล),
  `10.102` (อ่านแบบมีค่า fallback), `10.110` (ปิดด้วย flag) และ `10.111` (ฟังก์ชันของฟอร์มใบอนุญาต fail closed)
  — ก่อนเปิด flag กระทบยอดธนาคารต้องตรวจตารางของ `10.110` บนฐานเป้าหมายเอง
- **route สาธารณะใต้ `/api/public`, `/api/retail-local`, `/api/geocode` ต้องมี `rateLimit()` ทุกตัว** (เทสใน
  `inventory-tenant-scope-contract` ตั้งแต่ 2026-11-09 — เจอ desktop-update, releases, download และ geocode
  ไม่มีเพดาน) · ไล่ตรวจ `/api/*` ทั้งหมดแล้ว 2026-11-09: `/api/pos` คุมโดย `pos-route-guard-contract`,
  ที่เหลือมีการ์ด · `/api/auth` เป็น NextAuth (social login) + logout ไม่มี `rateLimit` ที่ route — login ด้วย
  รหัสผ่านไปทาง GraphQL `loginAdmin` ซึ่งมี `enforceAuthRateLimit` อยู่แล้ว
- **ชุด DB ไม่อยู่ใน CI** — งานที่แตะ SQL ต้องรัน `db <filter>` บนฐานที่ restore จาก dump เองทุกครั้ง
- **cron ผ่าน GitHub Actions** (`.github/workflows/bms-cron.yml`) ต้องมี secret `BMS_APP_BASE_URL` +
  `BMS_CRON_SECRET` — ไม่มีบันทึกในรีโปว่าตั้งแล้ว ดูว่ายิงจริงไหมที่ `/admin/operations-schedule`
  (ทางเลือก: Docker scheduler ที่ [docs/architecture/scheduler.md](docs/architecture/scheduler.md))

## ก่อน production (สรุป)

- **บันทึก production ล่าสุดที่อยู่ในรีโป: `9.89`–`9.93` apply แล้ว 2026-09-16** (ผู้ใช้แจ้ง · ไม่ได้ verify
  จากเครื่องนี้) · **ตั้งแต่ `9.94` ขึ้นไปไม่มีบันทึกเลย** — ถือว่าไม่รู้ ตรวจฐานเป้าหมายก่อนทุกครั้งด้วย
  `preflight-deploy.mts` + `schema-readiness.sql` (§ ประตูก่อน merge/deploy)
- apply ทีละไฟล์เรียงเลขด้วย `psql -1` (ไฟล์ที่ล้มกลางทางจะไม่ค้างครึ่งเดียว) · deploy `apps/web` กับ
  `apps/ws` พร้อมกันเสมอ · migration อย่างเดียวไม่เปิดฟีเจอร์ ต้อง deploy โค้ดตาม
- ลำดับช่วงท้าย: `10.105` → `10.106` (lead erasure) → `10.107` → `10.108` → `10.109` → `10.110` → `10.111`
  → `10.112` → `10.113` → `10.114` → `10.115` → `10.116` → `10.117` → `10.118` → `10.119` → `10.120`
- **`10.107` ผูกกับโค้ด `develop` แล้ว** — `stockTransfers.ts` อ่าน `bms_stock_transfer_item_lots` และ
  readiness ระบุว่าการโอนทุกหน้าล้มถ้าไม่มีตาราง → deploy `develop` = ตัดสินใจ rollout `10.107` ไปด้วย
  ต้องได้การยืนยันก่อน
- **`10.106`** ลบข้อมูลติดต่อของ lead แบบย้อนไม่ได้ (PDPA) · **`10.109`** จัดไฟล์เก่าใหม่ (สื่อในแชทชุมชน
  เป็นส่วนตัว, ไฟล์ที่ดูเป็น key/config ไม่เปิดสาธารณะ) — หลัง apply เปิดดูรูปหน้าร้าน/โพสต์/avatar ว่ายังขึ้น ·
  rollback ได้หลังถอยโค้ดเท่านั้น
- **`10.110`** seed สิทธิ์ `bank_reconciliation.{view,import,review,close}` ให้ **Manager เท่านั้น** — role อื่น
  ต้องให้สิทธิ์เองที่หน้า permissions (ไม่งั้น 403 เงียบ ๆ) · statement เป็นหลักฐานล้วน ไม่ลงบัญชี/ไม่แก้ยอดขาย ·
  ฟีเจอร์ปิดไว้โดย default (`BMS_BANK_RECONCILIATION_ENABLED` + `NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED`
  = false) — เปิดเป็น pilot ตามขั้นใน [bank-reconciliation.md](docs/business/bank-reconciliation.md) · rollback = ปิดทั้งสอง flag
- **`10.111`** สร้างฟังก์ชัน `bms_set_pharmacist_license` — ต้องมี `7.57` และ `10.47` ก่อน · รันซ้ำได้
- **`10.112`/`10.113`/`10.116` อยู่ใน schema-readiness** (คิวรับของ, ตั้งค่าคิว/สไลด์จอลูกค้า, หน้าต่างราคาสาขา —
  ไม่มีตาราง = ครัว/void/ใบเสร็จ หรือแคตตาล็อก/สแกน/checkout ล้ม) · **`10.114`** (template อีเมลรับเอง) ต้อง apply
  ก่อน deploy `orderEmailTemplateKey()` · **`10.115`** (สื่อจอเรียกคิว) ไม่อยู่ใน readiness
- **`10.117`–`10.120` ยังไม่อยู่ใน schema-readiness — ตรวจฐานเป้าหมายเอง:** `10.117` เพิ่ม `publish_to_chat`
  (ค่าเริ่มต้น FALSE → แพ็ก/โปรเดิมหายจากแชทลูกค้าจนผู้จัดการเปิดทีละรายการ; โค้ด board game อ่านคอลัมน์นี้) ·
  `10.118` ฟังก์ชัน `bms_set_own_inbox_availability` (ไม่ให้ `bms_app` UPDATE `users` ตรง) — verify บนฐาน throwaway
  แล้ว 2026-11-14 · `10.119`–`10.120` ตาราง fish-dock (หลักฐาน/แผนส่ง ไม่ย้ายสต็อกเอง; ใช้สิทธิ์
  `purchase.*`/`inventory.count*`/`report.view` เดิม ไม่ต้อง seed) — rollback = ปิด route ก่อนแล้วเก็บแถวไว้
- 500 บน production → query `system_logs` ก่อนเดา (§ เฉพาะเครื่อง/โปรเจกต์นี้)
