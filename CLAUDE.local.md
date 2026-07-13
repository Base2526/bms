# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

ไฟล์นี้ไว้จดบริบทการทำงานในเครื่อง/ทีม — สเปกจริงอยู่ที่ [CLAUDE.md](CLAUDE.md) (entry point) →
[docs/](docs/) (architecture / business / ai / integrations / ui)

## รันในเครื่อง (dev)

```bash
# ทั้ง stack ผ่าน docker (postgres + redis + web + ws + caddy + pgadmin)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# หรือรัน web อย่างเดียว (ต่อ postgres/redis ใน docker)
cd apps/web && npm install && npm run dev      # http://localhost:3000
cd apps/web && npx tsc --noEmit && npm run build   # ✅ ควรรันก่อน merge ทุกครั้ง
```

## โครงโค้ด BMS (จำง่าย)

- **business logic** → `apps/web/lib/bms/*.ts` (ที่เดียว ใช้ร่วม REST + GraphQL)
- **REST** → `apps/web/app/api/bms/*` (Phase 1 ใช้ `DEFAULT_TENANT_ID`)
- **GraphQL** → `apps/web/graphql/bms*.ts` (wire เข้า `graphql/resolvers.ts` + SDL ใน `graphql/typeDefs.ts`)
- **Admin UI** → `apps/web/app/(admin)/admin/*/page.tsx` + เมนูซ้าย `components/AdminSidebar.tsx`
  (`Sider` ย่อ/ขยายได้ จำสถานะใน `localStorage` — โปรไฟล์/Logout ปักล่างสุดของ sidebar ไม่มี header แถวบนแล้ว)
  · เลย์เอาต์รวม `components/AdminLayoutClient.tsx` (หน้าแรก `/admin` → redirect เข้า `/admin/dashboard`)
- **RBAC/tenant** → `lib/bms/{permissions,tenant,platform}.ts` · gate: `requirePermission()` (per-tenant) ·
  `requireUserAdmin()`/`requirePlatformOnly()` (จัดการ user/role ใน `resolvers.ts`) ·
  platform admin = `users.is_platform_admin` · drill-down = cookie `BMS_ACT_TENANT` (signed, ผูก admin.id) override tenant ใน `app/api/graphql/route.ts`
- **migrations** → `db/migrations/*.sql` (idempotent, apply ตามเลข) — ล่าสุด `5.6` (platform admin) · `5.7` (เติมสิทธิ์ operational ให้ Manager/Sales/Warehouse) · `5.8` (`bms_plans.max_users` — quota staff/plan: free=3, pro=10, business=ไม่จำกัด) · `5.9` (`bms_products`: image_url/description/cost_price/category/brand) · `6.0` (`bms_product_categories` — list หมวดหมู่ที่จัดการได้ + backfill จาก category เดิม) · `6.1` (seed permission ใหม่ `order.create` ให้ Manager/Sales — ใช้กับปุ่ม "ซื้อซ้ำ")
- **product category** → `category` บน `bms_products` ยังเป็น TEXT อิสระ (ไม่ใช่ FK กัน data เดิมพัง) · `bms_product_categories` คือ "list ที่ร้านจัดการ" ให้เลือกจาก dropdown เท่านั้น — เปลี่ยนชื่อ category จะ sync ไปสินค้าที่อ้างชื่อเดิมด้วย (`renameCategory` ทำใน tx เดียว), ลบ category ไม่ลบสินค้า (แค่หายจาก dropdown)
- **quota** → `lib/bms/plans.ts` (`enforceProductQuota`/`enforceUserQuota`) — เรียกก่อน INSERT เท่านั้น (ไม่ gate platform admin) · แพ็กเกจใหม่ที่มี limit ต้องเพิ่ม `enforce*Quota()` เอง ไม่มีมิดเดิลแวร์กลาง
- **role dropdown** → ต้อง query `roles` จาก DB เสมอ (`app/(admin)/admin/users/[id]/edit/page.tsx` ทำถูก) **ห้าม hardcode** ชื่อ role ในหน้า UI (เคยพลาดที่ `users/new/page.tsx` มี role ค้างจาก project เก่า ทำให้ Manager/Sales/Warehouse หายไปจาก dropdown)
- **แก้ Permissions ต้อง drill-down ก่อน** → หน้า `/admin/permissions` แก้สิทธิ์ตาม `getTenantId(ctx)` = ร้านที่แอดมินยืนอยู่ตอนนั้น platform admin ที่ไม่ได้ `/admin/tenants` → "เข้าดู" ร้านเป้าหมายก่อน จะแก้สิทธิ์ผิดร้านโดยไม่มี error ใดเตือน (เช็ค banner เหลืองว่าอยู่ร้านไหนก่อนกดบันทึกเสมอ)
- **Date จาก pg ต้อง `.toISOString()` ก่อนคืนใน resolver ที่ field เป็น `String!`** — `pg` คืนเป็น `Date` object, ถ้าไม่แปลง `GraphQLString.serialize` จะเรียก `.valueOf()` ได้ epoch number แล้วแปลงเป็น string ตัวเลข (ไม่ใช่ ISO) → frontend `new Date(...)` ได้ **Invalid Date** (ใช้ pattern `toISO()` ที่มีอยู่แล้วใน `bmsInbox.ts`/`bmsOrders.ts` เป็นตัวอย่าง — เคยพลาดใน `platform.ts`/`bmsSaas.ts`)
- **ops automation** → `.github/workflows/daily-log-triage.yml` + `scripts/bms-log-triage/*`
  (cron → อ่าน `system_logs` → Claude แก้ → draft PR → แจ้ง LINE) · secrets:
  `BMS_LOG_DATABASE_URL` (read-only), `ANTHROPIC_API_KEY`, `LINE_OPS_TOKEN`/`LINE_OPS_TO`
- **fake data (dev)** → `/admin/dev/fake` + `app/api/dev/fake/*` (users/bms-products/
  bms-customers/bms-orders/bms-conversations/bms-purchase + cleanup) · ปิดใน production ·
  **ทุก seeder ใหม่ต้องผูก `tenant_id = guard.actor?.tenant_id` เอง** (ไม่มี default ให้) ไม่งั้นแถวที่สร้างจะไม่โผล่ในหน้า admin ที่กรองตาม tenant (เคยพลาดที่ `fake/users/route.ts` — เป็นไฟล์ project เก่าที่ไม่ผูก tenant เลย)
- **Inbox customer tab / merge / reorder** (แท็บ "ลูกค้า", `mergeCustomers()`, `reorderFromOrder()`) → รายละเอียดเต็มอยู่ที่ [docs/ui/customer360.md](docs/ui/customer360.md) และ [docs/business/order.md](docs/business/order.md)
- **Shopee/Lazada (beta/scaffold)** → รายละเอียดเต็ม (signature ยังไม่ยืนยัน, channel array กระจายหลายจุด, checklist ก่อน production) อยู่ที่ [docs/integrations/lazada.md](docs/integrations/lazada.md) — **บทเรียนสำคัญที่ยังต้องจำ:** เพิ่ม channel ใหม่ทีไร ต้อง `grep -rn '"line".*"tiktok"' apps/web` ด้วย เพราะมี array enumerate channel กระจายหลายจุด ไม่ได้ derive จาก `Channel` type เดียวกันทั้งหมด (เคยพลาดที่ debug endpoint + fake seeder + playground มาแล้ว)

## เติมข้อมูลทดสอบเร็ว ๆ

ที่ `/admin/dev/fake` กดสร้างตามลำดับ **Products → Customers → Orders → Conversations → Purchase**
แล้วดู Dashboard/Reports/Inbox/Payment/Shipping/Purchase · กด **Cleanup** ลบ fake ทั้งหมด (marker `FAKE-`/tag `fake`, ลบตามลำดับ FK)
**seed ลง tenant ของ user ที่ล็อกอิน** (ร้านค้าเทสเองแล้วเห็นในร้านตัวเอง) · cleanup ก็ scope ตามร้าน · platform admin อยากเทสร้านไหนให้ drill-down เข้าร้านนั้นก่อน

## การเพิ่มโมดูลใหม่ (checklist)

1. migration `db/migrations/N.N__bms_<mod>.sql` — tenant_id + RLS policy (copy 4.2) + GRANT bms_app (copy 4.3)
2. service `lib/bms/<mod>.ts` — write ใช้ `getClient()` + `beginTenantTx()`; read ใช้ `query()` + `WHERE tenant_id`
3. GraphQL `graphql/bms<Mod>.ts` + wire resolvers + typeDefs; enforce `requirePermission()` + `audit()`
4. เพิ่ม permission ใน `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) — **และ seed สิทธิ์ให้ role Manager/Sales/Warehouse ทุก tenant** (migration แบบ `5.7`) ไม่งั้นร้านจะโดน 403
5. REST routes (ถ้าต้องการ) + Admin page + เมนู (gate ด้วย `useBmsPermissions`) + เอกสาร (`docs/ai/tools.md`/README.md)

> ⚠️ 403 = ไม่มีสิทธิ์ (ไม่ใช่ session หมด) → `apollo.ts` errorLink **ไม่ logout** เมื่อ 403 (logout เฉพาะ 401). ถ้าเพิ่ม permission ใหม่แล้วลืม seed ให้ role → หน้าโดน 403 แต่จะไม่เตะออก

## สถานะปัจจุบัน

โมดูลเชิงปฏิบัติการครบแล้ว (ดูตาราง Build Status ใน CLAUDE.md).
**เหลือ:** TikTok send API · carrier API จริง · AI tool-calling/OCR/forecasting (Phase 3–4).

## ก่อน production (สำคัญ)

- เปิดตรวจรหัสผ่านใน loginAdmin (dev ยังไม่ตรวจ)
- ตั้ง env `BMS_SECRET_KEY` (hex 64) — ไม่งั้นใช้ dev key เข้ารหัส token
- ตั้ง `JWT_SECRET` ให้แน่น — ใช้เซ็นทั้ง session token + cookie drill-down `BMS_ACT_TENANT`
- ให้ app ต่อ DB ด้วย role non-superuser เพื่อให้ RLS มีผลกับ read
- apply migration `5.6` (platform admin) + `5.7` (operational perms) · seed platform admin ชุดแรก = Administrator ของร้าน default
- ย้าย rate-limit webhook ไป Redis (ตอนนี้ in-memory ต่อ instance)
- `META_GRAPH_VERSION` (default v21.0) สำหรับ FB/IG send
- fake seeder ปิดใน production · เปิดเฉพาะเครื่อง demo ด้วย `BMS_ALLOW_FAKE_SEED=1` (ร้านเทส seed มุมตัวเองได้)
- หน้าระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Queue/Architecture) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side, กัน shop user เข้าตรงผ่าน URL)
