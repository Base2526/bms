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

## สถานะ working tree ล่าสุด (2026-11-02)

- branch `codex/renumber-10-106-migrations` — `10.106` ถูกใช้ซ้ำสองไฟล์หลัง merge #387/#389:
  `10.106__bms_retail_local_lead_erasure.sql` คงเลขเดิม ส่วน Meta inbox enrichment ย้ายเป็น
  **`10.108`** (ไฟล์ rename ยังไม่ commit) · environment ที่ apply `10.106__bms_meta_inbox_enrichment`
  ไปแล้วไม่ต้องรันซ้ำ (ADD COLUMN IF NOT EXISTS) ส่วนที่ยังไม่เคย apply ให้รัน `10.106` (lead erasure)
  แล้วค่อย `10.107`/`10.108` ตามลำดับ
- **`10.107__bms_stock_transfer_lots.sql` = WIP ยังไม่จบ** (commit `2ffa9437` "incomplete" + โค้ดใน
  `lots.ts`/`stockTransfers.ts`/`purchase.ts`/`wastage.ts`/`stockCounts.ts` ที่ยังไม่ commit) — ห้ามอ้างว่าโอน
  สต็อกแบบมีล็อตใช้ได้แล้ว และห้าม apply เข้า production จนกว่าจะผ่าน gate + DB contract

## รันในเครื่อง (dev)

```bash
# dev stack ผ่าน docker (postgres + redis + web + ws + pgadmin; Caddy ปิดไว้โดย default)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# เปิด Caddy เฉพาะเครื่องที่ไม่มี reverse proxy ตัวอื่นจับ 80/443 อยู่
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile with-caddy up --build

# หรือรัน web อย่างเดียว (ต่อ postgres/redis ใน docker)
cd apps/web && npm install && npm run dev            # http://localhost:3000
cd apps/web && npm run gate                          # ✅ typecheck → pure → build ก่อน merge ทุกครั้ง
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
cd apps/web && npm run gate                              # typecheck → pure ทั้งหมด → production build
node scripts/run-contract-tests.mjs pure <name-filter>   # ไฟล์เดียว/กลุ่มเดียว (ไม่ตรงอะไรเลย = exit 2)
node scripts/run-contract-tests.mjs db <name-filter>     # ต้องมี POSTGRES_HOST/POSTGRES_DB ของเครื่องท้องถิ่น
```

- นับ 2026-11-02: **404 ไฟล์เทส** = pure **305** (272 ใน `scripts/` + 33 ใน `scripts/ai-eval/`) +
  DB **99** (`-db-contract` ทั้งหมดอยู่ชั้นบนของ `scripts/`) · นับใหม่ด้วย
  `ls scripts/*.test.mts scripts/ai-eval/*.test.mts | wc -l`
- ผลรันจะถูกเขียนลง `.test-output/<mode>.tap` + `.test-output/<mode>.run.txt` — **ไฟล์ `.run.txt`
  ที่ไม่มีบรรทัด `exit=` = รอบนั้นยังไม่จบ ห้ามอ่านว่าเขียว**
- **`test:db` ปฏิเสธ host ที่ไม่ใช่เครื่องท้องถิ่น** (`BMS_TEST_ALLOW_REMOTE_DB=1` ถ้าจงใจ) — ชุดนี้เขียนจริงลงฐาน
- **CI** (`.github/workflows/gate.yml`) รัน typecheck + pure + build เท่านั้น **ไม่มีโหมด DB** —
  "pure เขียว" ไม่เท่ากับเส้นทางฐานข้อมูลถูกเดิน
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

## ค้างอยู่ / ยังไม่ verify (สรุป — รายละเอียดอยู่ใน archive ตามเลข migration)

PLACEHOLDER_PENDING

## ก่อน production (สรุป)

PLACEHOLDER_PRODUCTION
