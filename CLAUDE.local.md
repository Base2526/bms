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

### Frontend gotcha: CSS Modules ทำ route เป็นหน้าขาวได้

- ถ้า `*.module.css` ใช้ selector ที่เป็น `:global(...)` ทั้งหมด Next.js จะฟ้องว่า selector
  `is not pure` และ route ตอบ `500` แม้ไฟล์ `page.tsx` ไม่มี TypeScript error
- ถ้าต้องแตะ parent ที่เป็น global ให้มี local class อยู่ใน selector ด้วย เช่น
  `:global(.bms-auth-main):has(.page)` (`.page` มาจาก CSS Module) หรือย้าย rule global จริงไป
  `app/globals.css`
- เคยเกิดกับ `/shop-signup`: selector เดิม
  `:global(.bms-auth-main:has([data-shop-signup-page]))` ทำให้หน้า compile ไม่ผ่านและดูเหมือนหน้าขาว
- หลังแก้ page/layout/CSS Module ให้เปิด URL นั้นตรง ๆ ใน browser เสมอ อย่าตรวจเฉพาะ `tsc`

### Docker/host ห้ามใช้ `.next` และ `node_modules` ชุดเดียวกัน

- `docker-compose.dev.yml` ต้อง mount `web_next_cache` ที่ `/app/apps/web/.next` และ
  `web_node_modules` ที่ `/app/apps/web/node_modules` แยกจาก bind mount ของ source code
- ถ้า Docker Next dev กับ host Next dev เขียน `.next` ชุดเดียวกัน manifest ของ App Router จะปนกัน
  และทุก route อาจพังด้วย `Cannot read properties of undefined (reading 'clientModules')`
- `node_modules` ก็ห้ามแชร์ระหว่าง Linux container กับ macOS เพราะ native package เช่น `esbuild`
  จะเป็นคนละ platform
- วิธี recovery: หยุดเฉพาะ `web`, ล้าง build cache `.next`, แล้ว recreate `web` container; ไม่ต้องลบ
  PostgreSQL volume หรือข้อมูลธุรกิจ

## โครงโค้ด BMS (จำง่าย)

- **business logic** → `apps/web/lib/bms/*.ts` (ที่เดียว ใช้ร่วม REST + GraphQL)
- **REST** → `apps/web/app/api/bms/*` (Phase 1 ใช้ `DEFAULT_TENANT_ID`)
- **GraphQL** → `apps/web/graphql/bms*.ts` (wire เข้า `graphql/resolvers.ts` + SDL ใน `graphql/typeDefs.ts`)
- **Admin UI** → `apps/web/app/(admin)/admin/*/page.tsx` + เมนูซ้าย `components/AdminSidebar.tsx`
  (`Sider` ย่อ/ขยายได้ จำสถานะใน `localStorage` — โปรไฟล์/Logout ปักล่างสุดของ sidebar ไม่มี header แถวบนแล้ว)
  · เมนูจัดลำดับตามความถี่ใช้จริง: **Inbox เป็น top-level** (ไม่ฝังใน submenu ร้านค้าแล้ว) พร้อม badge unread
  (`bmsInboxUnreadCount`, poll 15s ที่ sidebar เอง เพราะติดทุกหน้า ไม่ใช่แค่หน้า Inbox — Sales เห็นแค่ของตัวเอง
  ตาม scope เดียวกับ `bmsConversations`) · Reports ย้ายลงมาหลังกลุ่มร้านค้า · คู่มือย้ายไปแถบล่างสุดคู่โปรไฟล์
  (ใช้ไม่บ่อย ไม่ควรแย่งที่ top-level)
  · `/admin/inbox/realtime-diagnostics` อยู่ในกลุ่ม SaaS และเปิดให้เฉพาะ Administrator/platform admin: `Emit`
  ทดสอบ Redis/WebSocket signal อย่างเดียว (ไม่เขียน DB, ไม่ควรเห็นแชทใหม่), `Create Msg` สร้างข้อความ diagnostic
  ใน Inbox จริง (`diagnostic:{channel}:{adminId}`) โดยไม่เรียก AI pipeline และไม่ส่งออก platform
  · **เมนูที่มี badge (`link(..., badge, collapsed)`) ต้องส่ง `collapsed` มาด้วยเสมอ** — ถ้าลืม (ค่า default
  เป็น `false`) label จะ render เป็น flex+pill layout เสมอ ซึ่งพอ sidebar ย่อจริงแล้วเปิดเป็น submenu flyout
  popup, span ข้อความจะยุบเหลือ 0 (overflow:hidden) → hover ไม่เห็นตัวหนังสือเลย (เจอที่เมนู Users เพราะลืมส่ง
  `collapsed` ตอนเพิ่ม badge=3 — ดู `AdminSidebar.tsx`, เทียบกับเมนู Inbox ที่ส่งถูก)
  · เลย์เอาต์รวม `components/AdminLayoutClient.tsx` (หน้าแรก `/admin` → redirect เข้า `/admin/dashboard`)
  · โควตา AI shared key มี indicator ปักเหนือคู่มือ/โปรไฟล์เหมือนกัน (poll 60s, ไม่ใช่ badge บนเมนู) — ดู § AI Free Tier + BYOK
- **RBAC/tenant** → `lib/bms/{permissions,tenant,platform}.ts` · gate: `requirePermission()` (per-tenant) ·
  `requireUserAdmin()`/`requirePlatformOnly()` (จัดการ user/role ใน `resolvers.ts`) ·
  platform admin = `users.is_platform_admin` · drill-down = cookie `BMS_ACT_TENANT` (signed, ผูก admin.id) override tenant ใน `app/api/graphql/route.ts`
- **migrations** → `db/migrations/*.sql` (idempotent, apply ตามเลข) — ล่าสุด `5.6` (platform admin) · `5.7` (เติมสิทธิ์ operational ให้ Manager/Sales/Warehouse) · `5.8` (`bms_plans.max_users` — quota staff/plan: free=3, pro=10, business=ไม่จำกัด) · `5.9` (`bms_products`: image_url/description/cost_price/category/brand) · `6.0` (`bms_product_categories` — list หมวดหมู่ที่จัดการได้ + backfill จาก category เดิม) ·
  `6.1__bms_inbox_assignment.sql` (`bms_conversations.assigned_to_user_id` FK จริง แทน `assigned_to` TEXT เดิม (ยังอยู่ในตารางแต่เลิกใช้แล้ว) + `bms_conversation_helpers` (คนช่วยตอบ) + `users.is_available` + permission ใหม่ `inbox.assign`) ·
  `6.2__bms_customer_360.sql` (ดู § Customer 360 ด้านล่าง) ·
  `6.3__bms_order_create_perm.sql` (seed permission ใหม่ `order.create` ให้ Manager/Sales — ใช้กับปุ่ม "ซื้อซ้ำ" —
  **renumber แล้วจาก `6.1` เดิม** ที่เคยชนกับ `6.1__bms_inbox_assignment.sql` เพราะมาจากคนละ branch ตั้งเลขซ้ำกัน) ·
  `6.4__bms_channel_health.sql` (สถานะเชื่อมต่อจริงต่อช่องทาง — ดู § Channel Health ด้านล่าง) ·
  `6.5__bms_product_images.sql` (gallery หลายรูปต่อสินค้า — `image_url` เดิมยังเป็น cover image เพื่อ backward compatibility) ·
  `6.8__bms_ai_config.sql` (`bms_plans.max_ai_messages_month` + BYOK ต่อร้าน — ดู § AI Free Tier + BYOK ด้านล่าง) ·
  `6.9__bms_store_profile.sql` (ข้อมูลร้าน + ค่าส่ง 1 แถว/ร้าน — ป้อน AI ตอบลูกค้า, ดู § ทูลชุด 2 ใน AI tool-calling) ·
  `7.0__bms_revision_helpers.sql` + `7.1`–`7.14` (revision snapshots สำหรับ records สำคัญ — helper
  สร้าง `<table>_revisions`, trigger, RLS, grants; หน้า `/admin/revisions` ใช้ list/detail/compare)
- **inbox: มอบหมาย staff** → `lib/bms/inbox.ts` (`pickAutoAssignee`/`autoAssignConversation`/`reassignStaffConversations`) — แชทใหม่ auto-assign ให้ Sales ที่ว่างและถือแชท OPEN/PENDING น้อยสุดก่อนเสมอ (fallback Manager → Administrator ถ้าร้านยังไม่มี Sales) · **ทุก conversation ต้องมี staff หลักเสมอ** — `deleteUser`/`deleteUsers` (`resolvers.ts`) เรียก `reassignStaffConversations()` โอนแชทค้างออกก่อนลบทุกครั้ง ห้ามลบ user ตรงๆ โดยข้ามขั้นตอนนี้ · ประวัติมอบหมาย/โอน/helper ใช้ `bms_audit_log` เดิม (target = conversation id, action `inbox.assign`/`inbox.helper_add`/`inbox.helper_remove`) ไม่ได้สร้างตาราง log ใหม่ · `inbox.assign` (โอน staff หลัก) แยกจาก `inbox.manage` (status/tags/notes) เพราะ Sales ต้องโอนแชทตัวเองได้โดยไม่ต้องมีสิทธิ์จัดการเต็ม · helper add/remove ใช้สิทธิ์ `inbox.reply` เดิม (ไม่ต้องสิทธิ์พิเศษ)
- **inbox: สายแชท + system event** → หน้าแชทรวม message + system event (`listSystemEvents` → `bmsConversation.systemEvents`) เรียงตามเวลาในสายเดียว: มอบหมาย/เพิ่ม-ถอดผู้ช่วยตอบ/เปลี่ยนสถานะ แสดงเป็นแถวกลางสีเทา + marker "เริ่มการสนทนา" หัวสาย (derive จาก `created_at`/ข้อความแรก ไม่ได้ log เพิ่ม) + date separator (วันนี้/เมื่อวาน/วันที่, timezone Asia/Bangkok) · `systemEvents` resolve ชื่อคนจาก UUID/email ใน `bms_audit_log` แล้ว (user ถูกลบ → "ผู้ใช้ที่ถูกลบ") · แท็บ Timeline เดิมเก็บไว้คู่กัน (รวม order history ที่ไม่ควรแทรกในแชท) · **Sales เห็นเฉพาะแชทของตัวเอง** (staff หลัก/ผู้ช่วยตอบ) — บังคับที่ `bmsConversations`/`bmsConversation` (`bmsInbox.ts`, `role === "Sales"`) · role อื่นเห็นทั้งร้าน
- **inbox realtime diagnostics** → `lib/bms/inbox.ts` มี `createDiagnosticInboxMessage()` สำหรับปุ่ม `Create Msg`
  เท่านั้น: เขียน `bms_conversations`/`bms_messages` sender=`diagnostic`, meta `{ diagnostic: true }`, publish
  `bmsInboxChanged`, audit `inbox.diagnostic_message`; ห้าม reuse สำหรับ webhook จริง/AI pipeline และห้ามเรียก
  `deliverToChannel()`. ปุ่ม `Emit` อยู่ที่ `bmsChannels.ts` (`bmsEmitInboxDiagnosticEvent`) และ audit
  `inbox.diagnostic_event`; ถ้าเห็น latency ใน Realtime Probe แปลว่า signal สำเร็จ แม้ Inbox ไม่มีแชทใหม่
- **order journey** → `getOrderJourney` (`lib/bms/orders.ts`) → `bmsOrderJourney(orderId)` — แถวขยายในหน้า Orders โชว์ ต้นทางแชท + stepper (PENDING→PAID→PACKING→SHIPPED→COMPLETED + กิ่ง CANCELLED/RETURNED) + timeline ละเอียด · **ไม่มี migration** — order↔conversation join 1:1 ด้วย `(tenant_id, channel, customer_ref)` (conversation dedupe ด้วย UNIQUE เดิม) · reuse `bms_audit_log` (order.pay/pack/ship/complete/cancel/return, target=orderId) + `listSystemEvents`/`listConversationHelpers` (event แชท) + `listShipments` (เลขพัสดุ) · COMPLETED แบบ auto (จัดส่งถึง) ไม่ได้ audit → fallback `updated_at` · ลิงก์ "เปิดดูแชท" ไป `/admin/inbox?c=<id>` (inbox อ่าน param `c` เปิดแชทนั้น)
- **product category** → `category` บน `bms_products` ยังเป็น TEXT อิสระ (ไม่ใช่ FK กัน data เดิมพัง) · `bms_product_categories` คือ "list ที่ร้านจัดการ" ให้เลือกจาก dropdown เท่านั้น — เปลี่ยนชื่อ category จะ sync ไปสินค้าที่อ้างชื่อเดิมด้วย (`renameCategory` ทำใน tx เดียว), ลบ category ไม่ลบสินค้า (แค่หายจาก dropdown)
- **product gallery (หลายรูป)** → service `lib/bms/products.ts` รองรับ `image_urls[]` + table `bms_product_images`
  (migration `6.5`) · GraphQL `BmsProduct.images` resolve gallery เต็ม, ส่วน `imageUrl` ยังเป็นรูปหลัก/cover เพื่อไม่พัง
  code เก่า · หน้า `/admin/products` อัปโหลดได้หลายรูป, เรียงตามลำดับที่เพิ่ม, ลบออกจาก draft ได้ก่อนบันทึก
- **admin profile** → `/admin/profile` ใช้ `bmsMe` + `updateMe` + `uploadAvatar` ให้ผู้ใช้แก้ชื่อ/เบอร์/ภาษา/รูปโปรไฟล์
  ตัวเองได้โดยไม่ต้องเข้าหน้า users ระดับแอดมินระบบ
- **LINE profile cache** → LINE webhook sync ชื่อ/รูปจาก Messaging API หลัง `logConversation()` + reply path แล้วเก็บที่
  `bms_customer_identities` (`display_name`, `picture_url`, `profile_synced_at`) เท่านั้น; อย่า fetch profile จากหน้า list/GraphQL read resolver
- **search หน้า operations** → `/admin/orders`, `/admin/purchase`, `/admin/payment`, `/admin/shipment`
  รองรับ search ฝั่ง backend แล้ว (`typeDefs` + resolver/service) และหน้า UI ใช้ live search แบบ debounce ~300ms;
  อย่า revert กลับไปเป็น filter ฝั่ง table อย่างเดียว เพราะจะค้นหาไม่ครบเมื่อมีข้อมูลมากกว่า page ปัจจุบัน
- **public landing / signup refresh** → `/` เป็น interactive infographic 2 ภาษา (ใช้ i18n key จริง ไม่ hardcode copy ลง page ตรง ๆ)
  และ CTA เปลี่ยนตาม session (`/admin/dashboard` ถ้าล็อกอินแล้ว, `/shop-signup` ถ้ายังไม่ล็อกอิน) · `/shop-signup`
  ต้องอยู่ใน `isAuthPath()` เสมอ ไม่งั้นจะเผลอโหลด session/chat wires แล้ว layout สับสน
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
> **SaaS redesign (Lazada OAuth + Channel Sync Service) — แผนนี้เลิกทำแล้ว, ไม่ใช่ค้าง:** เดิมออกแบบไว้เป็น
> OAuth + background sync worker (`lib/bms/channelAdapter.ts`/`sync.ts`/`lazadaClient.ts`, `packages/bms-queue`,
> migration `6.3`/`6.4`, permission `channel.connect`/`sync.view` ฯลฯ) แต่ของจริงที่ build ไปคนละทาง — เดินสาย
> **webhook scaffold** แบบเดียวกับ TikTok ไปแล้ว (`app/api/bms/{lazada,shopee}/webhook/[tenantId]`, HMAC ผ่าน
> `channel_secret` เดิมใน `bms_tenant_channels`, ไม่มี OAuth/sync worker) — ดู [docs/integrations/lazada.md](docs/integrations/lazada.md)
> สำหรับสถานะจริง (🧪 beta, signature ยังไม่ยืนยันกับเอกสาร Lazada/Shopee Open Platum ตัวจริง) ก่อนจะกลับไปทำแผน
> OAuth+Sync ต้องตัดสินใจใหม่ก่อนว่าจะเปลี่ยนทางจริงหรือแค่ปรับปรุง webhook scaffold ที่มีอยู่

## Customer 360 (Inbox right panel)

**Current implementation (✅ ทำเสร็จแล้ว, ไม่ใช่แผนงาน):** หน้า `/admin/inbox` (`app/(admin)/admin/inbox/page.tsx`)
เดิมเป็น 2 คอลัมน์ (list + แชท พร้อมแท็บ แชท/โน้ต/Timeline ของแชทเดียว) — **ไม่เคยมีคอลัมน์ขวาจริงมาก่อน** แม้
เอกสารสเปกเดิมจะพูดถึง "3-column layout" ก็ตาม เพิ่มคอลัมน์ที่ 3 จริงตอนนี้ (`Customer360Panel.tsx`) แสดงเมื่อ
เลือกแชท (`conv.customerId` — field ที่มีอยู่แล้วใน schema แต่หน้านี้ไม่เคย select มาก่อน ต้องเพิ่มใน `Q_CONV`)

**New APIs** (อ่านอย่างเดียว ไม่มี mutation, gate ด้วย permission `customer.view` เดิม — ไม่ได้เพิ่ม permission ใหม่):
- `bmsCustomer360(customerId)` — eager, โหลดทันทีตอนเลือกแชท (summary/contact/connected accounts/stats/
  recent orders ทุกช่องทาง/products purchased/current cart/notes) → `getCustomer360()` ใน `lib/bms/customer360.ts`
- `bmsCustomerTimeline(customerId)` — lazy, โหลดตอนกาง Collapse panel "Timeline" ครั้งแรกเท่านั้น (หนักสุด
  — merge ทุกแชท+ออเดอร์+shipment+refund+note ของลูกค้าข้ามช่องทาง) → `getCustomerTimeline()`
- `bmsCustomerInsights(customerId)` — lazy เหมือนกัน, เรียก Claude (หรือ template ถ้าไม่มี `ANTHROPIC_API_KEY`)
  จาก "facts bundle" ที่คำนวณแล้วเท่านั้น ห้ามเดา — แคชผลใน `bms_customer_ai_summary` (คีย์ด้วย hash ของ facts,
  regenerate เฉพาะตอนตัวเลขเปลี่ยนจริง) → `getCustomerInsights()`
- resolver ทั้งหมดอยู่ที่ `graphql/bmsCustomer360.ts` (ตาม pattern `bmsOrderJourney` ใน `bmsOrders.ts` — resolver
  บาง แค่ requirePermission + เรียก service), wire เข้า `resolvers.ts` (`bmsCustomer360Resolvers.Query`)

**Schema เพิ่ม (migration `6.2__bms_customer_360.sql`):** `bms_customers.email/preferred_language/timezone`
(ของเดิมไม่มี email เลย ทั้งที่ BUSINESS_RULES ใช้ email เป็น matching criterion) · `bms_customer_addresses.address_type`
(shipping/billing, default `'shipping'` ให้แถวเก่าไม่พัง) · ตารางใหม่ `bms_customer_ai_summary` (cache ผล AI ต่อ
customer, PK = `customer_id` เฉยๆ เหมือน `bms_customers.id` เพราะ UUID unique อยู่แล้วข้ามร้าน) — RLS/grant
copy จาก `6.1` (per-table style ไม่ใช่ loop แบบ `4.2`)

**Component structure:** `Customer360Panel.tsx` เดียว export default, แตกเป็น sub-component ในไฟล์เดียวกันต่อ
1 section (`SummarySection`/`ContactSection`/`StatsSection`/`RecentOrdersSection`/`ProductsSection`/`CartSection`/
`NotesSection`/`TimelineSection`/`InsightsSection`/`QuickActionsSection`) ประกอบเป็น Ant `Collapse` (`items` prop,
ไม่ใช้ `Collapse.Panel` แบบเก่า) — Section 1–7 (`defaultActiveKey`) ได้ data จาก query เดียว (`bmsCustomer360`,
`fetchPolicy: cache-and-network`) ที่โหลดพร้อมกันเสมอ, Timeline/AI Insights (Section 8–9) เป็น `useLazyQuery`
ของตัวเอง — ยิงจริงเฉพาะครั้งแรกที่ Collapse panel นั้นถูกกางขึ้นมา (อาศัย behavior เดิมของ antd Collapse ที่ไม่ mount
children ของ panel ที่ยังไม่เคย active — **นี่คือกลไก lazy-load หลักของ feature นี้ ไม่ใช่ debounce/cache เพิ่มเติม**)
ย่อ/ขยายทั้ง panel ได้ (ไอคอนมุมขวาบน, จำสถานะ `localStorage` คีย์ `bms_inbox_customer360_collapsed`
— แพทเทิร์นเดียวกับ `listCollapsed` ของคอลัมน์ซ้าย)

**การตีความ "Current Shopping Cart":** สคีมาไม่มีสถานะ DRAFT แยก (`orders.ts`/`CLAUDE.local.md` เดิมยืนยันแล้ว) —
"ตะกร้า" = order `PENDING` ล่าสุดของลูกค้าที่ยังไม่มี payment ผูกอยู่เลย (`NOT EXISTS ... bms_payments`)

**Quick Actions ที่เป็นปุ่ม disabled ("coming soon") เพราะ subsystem จริงยังไม่มีในโค้ดเลย:** สร้างออเดอร์จากแอดมิน
(ตอนนี้สร้างผ่านแชทลูกค้าเท่านั้น), Generate Invoice, Send Payment Link, Support Ticket — **ตัดสินใจร่วมกับ user
ไว้แล้วว่าไม่ build subsystem ใหม่รอบนี้** ห้ามเข้าใจผิดว่าเป็นบั๊ก/ลืมทำ ปุ่ม "มอบหมาย staff" ก็ disabled เช่นกัน
(ชี้ไปที่ตัวเลือก staff หลักที่หัวแชทด้านบนแทน — ไม่ duplicate logic assign ที่มีอยู่แล้วใน `ConversationPane`)

**Pending improvements (ยังไม่ทำ):**
- Lazada/Shopee ยังไม่โผล่ใน recent orders ของ panel นี้จริง — ไม่ใช่เพราะรอ ChannelAdapter refactor (แผนนั้นเลิกทำแล้ว
  ดู note ด้านบน) แต่เพราะ webhook parsing ของสองช่องทางนี้ยังเป็น unverified placeholder (`parseLazadaMessages()`/
  `parseShopeeMessages()` เดา field name, ไม่มี order จริงไหลเข้ามา) — ดู [docs/integrations/lazada.md](docs/integrations/lazada.md);
  query ของ panel รองรับ channel เป็น free text อยู่แล้ว ไม่ต้องแก้เพิ่มฝั่งนี้
- "Open Marketplace" ปุ่มใน Recent Orders ยัง disabled ทุกช่องทาง (ไม่มี deep-link ไป LINE OA Manager/TikTok
  Seller Center/Lazada Seller Center จริง) — รอ design ต่างหาก ไม่ใช่ scope ของรอบนี้
- ยังไม่มี unit/integration test สำหรับ `lib/bms/customer360.ts` (โปรเจกต์นี้ยังไม่มี test suite ที่ใช้งานอยู่โดยรวม)
- avg response time query สมมติ 1 แถว "IN แล้ว OUT ถัดไปในแชทเดียวกัน" เป็น 1 การตอบ — ยังไม่หัก เวลาที่แชทปิด/เปิดใหม่
  ข้ามวันออก (edge case ที่อาจทำให้ตัวเลขเพี้ยนถ้าลูกค้าทิ้งแชทค้างไว้ข้ามคืนแล้วมาต่อ)
- ยังไม่มีเอกสารใน `docs/ui/` สำหรับ panel นี้เลย (`docs/ui/customer360.md` คุมแค่แท็บ "ลูกค้า"/merge/reorder ด้านล่าง) —
  ควรเพิ่มหน้าแยกหรือรวมเข้าไฟล์เดิม

## Inbox customer tab / merge / reorder / Shopee/Lazada (beta/scaffold)

- **แท็บ "ลูกค้า" + merge + reorder** (`mergeCustomers()`, `reorderFromOrder()`) → รายละเอียดเต็มอยู่ที่ [docs/ui/customer360.md](docs/ui/customer360.md) และ [docs/business/order.md](docs/business/order.md) — คนละอย่างกับ Customer 360 panel ด้านบน (ดู note ในไฟล์นั้น)
- **Shopee/Lazada (beta/scaffold)** → รายละเอียดเต็ม (signature ยังไม่ยืนยัน, channel array กระจายหลายจุด, checklist ก่อน production) อยู่ที่ [docs/integrations/lazada.md](docs/integrations/lazada.md) — **บทเรียนสำคัญที่ยังต้องจำ:** เพิ่ม channel ใหม่ทีไร ต้อง `grep -rn '"line".*"tiktok"' apps/web` ด้วย เพราะมี array enumerate channel กระจายหลายจุด ไม่ได้ derive จาก `Channel` type เดียวกันทั้งหมด (เคยพลาดที่ debug endpoint + fake seeder + playground มาแล้ว)

## Channel Health (สถานะเชื่อมต่อจริงต่อช่องทาง)

**เสร็จแล้ว (2026-07)** — แยก "สุขภาพจริง" ของแต่ละช่องทางออกจาก `active` (สวิตช์ admin กดเปิด/ปิดเอง) เดิมที่มีแค่
เขียว/เทา ไม่บอกว่า token หมดอายุ/webhook fail/rate limit/ไม่มี event เข้าจริงหรือเปล่า:

- **Schema** → migration `6.4__bms_channel_health.sql` เติมคอลัมน์ `status`/`status_detail`/`last_error_at`/
  `last_inbound_event_at`/`last_outbound_success_at`/`last_checked_at` ลง `bms_tenant_channels` เดิม (ไม่สร้างตารางคู่ขนาน)
  + ตารางใหม่ `bms_channel_health_log` (ประวัติเปลี่ยนสถานะ, เขียนเฉพาะตอน status เปลี่ยนจริง กัน spam)
  · **แก้เลข migration ชนกันไปด้วย**: `6.1__bms_order_create_perm.sql` เดิม renumber เป็น `6.3` (ชนกับ
  `6.1__bms_inbox_assignment.sql` จากคนละ branch — ดูหมายเหตุเดิมด้านบน)
- **Service** → `lib/bms/channelHealth.ts` — entrypoint เดียวคือ `setChannelStatus()` (log เฉพาะตอนเปลี่ยน) +
  helper เฉพาะทาง `recordInboundEvent()`/`recordWebhookVerifyFailed()`/`recordOutboundSuccess()`/
  `recordOutboundError(httpStatus)` (map 401/403→`token_expired`, 429→`rate_limited`, อื่นๆ→`send_failed`) +
  `detectStaleChannels()` (cron หา channel active+connected ที่ไม่มี event เข้าเกิน `NO_EVENTS_THRESHOLD_DAYS`
  = 3 วัน → ตั้ง `no_events`, ไม่ downgrade error status อื่นทับ)
- **Wire เข้าจุดจริงแล้ว** (ไม่ใช่แค่ service เฉยๆ):
  - webhook LINE/Facebook/Instagram/TikTok/Shopee/Lazada ทุกตัว → signature verify fail เรียก
    `recordWebhookVerifyFailed()`, มี event เข้าจริงเรียก `recordInboundEvent()` (Website Live Chat **ไม่ wire**
    เพราะไม่มี signature/ไม่มี async send ให้ fail แบบเดียวกัน)
  - `deliverToChannel()` (`lib/bms/inbox.ts`, ใช้โดย LINE/Facebook/Instagram) + `pushLineReply()`
    (`line/webhook/[tenantId]/route.ts`, reply-token path ของ pipeline) → capture HTTP status จริงจาก
    fetch แล้วเรียก `recordOutboundSuccess()`/`recordOutboundError()` (TikTok/Shopee/Lazada ยังไม่มี send API
    จริง เลยไม่มีจุด wire ฝั่ง outbound)
  - cron endpoint `POST /api/bms/channels/check-health` (header `x-cron-secret` = `BMS_CRON_SECRET`
    เหมือน `/api/bms/orders/release-expired`) เรียก `detectStaleChannels()` — **ยังไม่ได้ตั้ง cron schedule จริง**
    (ต้องเพิ่มเอง เช่น GitHub Actions cron รายวัน เหมือน `daily-log-triage.yml`)
- **GraphQL** → `bmsChannelHealth`/`bmsChannelHealthCount` ใน `graphql/bmsChannels.ts` (ต่อยอดไฟล์เดิม ไม่สร้างใหม่)
  gate ด้วย `requireTenantAdmin()` เดียวกับ `bmsChannels`/`bmsUpsertChannel` — **ไม่มี permission ใหม่** (ตั้งใจ
  ไม่ seed migration สิทธิ์เพิ่ม เพราะ domain เดียวกับ channel config เดิมที่ไม่เคย gate ด้วย `BMS_PERMISSIONS`)
- **UI**:
  - `/admin/settings` — badge สถานะต่อการ์ดช่องทาง (ลำดับความสำคัญ: ยังไม่ตั้งค่า > ปิดใช้งานเอง > สุขภาพจริง —
    เช็ค `has_token`/`active` ก่อนเสมอ ไม่ใช้ `health.status` ตรงๆ เพราะ default DB คือ `'connected'` แม้ยังไม่เคยตั้งค่า)
    + Alert แจ้ง action ตาม status + เวลา event เข้า/ส่งสำเร็จล่าสุด
  - Sidebar (`AdminSidebar.tsx`) — badge แดงที่เมนู "Settings (เชื่อมช่องทาง)" poll `bmsChannelHealthCount` ทุก 15s
    แบบเดียวกับ `bmsInboxUnreadCount` (ส่ง `collapsed` เสมอ กัน bug เดิมที่เจอกับเมนู Users)
  - Dashboard (`/admin/dashboard`) — Alert แดงเมื่อมีช่องทาง active ที่ status ≠ `connected` พร้อม deep-link ไป Settings
    (pattern เดียวกับ alert สินค้าใกล้หมดที่มีอยู่แล้ว)
  - Realtime Diagnostics (`/admin/inbox/realtime-diagnostics`) — matrix ทุก channel + `Emit`/`Create Msg`
    สำหรับแยกทดสอบ realtime signal กับ DB→Inbox end-to-end; gate ซ้ำทั้ง layout server-side
    (`requireTenantAdministratorPage`) และ GraphQL resolver (Administrator/platform admin)
  - ปุ่ม **"ทดสอบ"** ในหน้า Settings (เฉพาะ LINE/Facebook/Instagram ที่มี API ตรวจสอบ token โดยไม่ต้องส่งข้อความหาลูกค้าจริง
    — `GET /v2/bot/info` ของ LINE, `GET /me` ของ Graph API) → `testChannelConnection()` (`channelHealth.ts`) +
    `bmsTestChannel` mutation แสดงเฉพาะตอน badge เป็น "เชื่อมต่อสำเร็จ" เท่านั้น (ตามตารางสถานะเดิม) — กดแล้วอัปเดต
    `status` จริงไปในตัวผ่าน `recordOutboundSuccess()`/`recordOutboundError()` เดิม (ไม่ใช่แค่ mock ผลลัพธ์)
    · TikTok/Shopee/Lazada/Web ไม่มีปุ่มนี้ (ไม่มี API แบบนี้ให้เรียก — ดู `docs/integrations/lazada.md`)
  - `recordOutboundError()` แนบ header `Retry-After` ของ platform เข้า `status_detail` ด้วยถ้ามี (ผ่าน
    `formatOutboundErrorDetail()`) — เดิมมีแค่ status code/body เฉยๆ ไม่ตรงกับตารางสถานะต้นฉบับที่ต้องการเห็นค่านี้
- **ยังไม่ทำ (ต้องตัดสินใจ scope ก่อน)**: proactive notification นอกหน้าเว็บ (เช่น LINE แจ้งเจ้าของร้านทันทีที่ channel fail
  โดยไม่ต้องเปิดแอพ) — ต้องมี LINE user id ของ admin ผูกไว้ก่อน (ยังไม่มี field นี้ในระบบ, คนละเรื่องกับ LINE OA ของร้านที่ใช้
  รับแชทลูกค้า) เป็น feature ใหม่ที่ยังไม่ได้ตัดสินใจร่วมกับ user

## AI Free Tier + BYOK (2026-07)

**เสร็จแล้ว** — เดิม AI ใช้ `ANTHROPIC_API_KEY` เดียวจาก env ทั้งแพลตฟอร์ม ไม่มี quota, ไม่มีทางให้ร้านใช้ key
ตัวเอง ตอนนี้แยกเป็น shared key (ฟรี มี quota รายเดือนตามแพ็กเกจ) + BYOK (ร้านใส่ key ตัวเอง ไม่จำกัด):

- **Schema** → migration `6.8__bms_ai_config.sql`: เพิ่ม `bms_plans.max_ai_messages_month`
  (free=400, pro=4000, business=-1 ไม่จำกัด — ตาม convention `-1` เดิมของ `bms_plans`) + ตารางใหม่
  `bms_tenant_ai_config` (เก็บ `api_key_encrypted` เข้ารหัสแบบเดียวกับ `channel_secret` เดิม + `model`
  override) + `bms_ai_usage_monthly` (นับครั้งต่อ `(tenant_id, year_month)` — **ไม่มี cron reset**
  เดือนใหม่ = แถวใหม่ที่ count เริ่มจาก 0 เอง)
- **Service** → `lib/bms/aiConfig.ts` (get/set/remove key ของร้าน, `testAiKey()`/`testTenantAiKey()`/
  `testPlatformAiKey()` เรียก `GET /v1/models/{id}` — ไม่เสียเงิน ไม่ใช่ inference) +
  `lib/bms/aiUsage.ts` (`getAiUsage()`, `tryConsumeAiQuota()` — atomic `UPDATE ... WHERE count < limit`
  ใน query เดียว กัน race condition โดยไม่ต้อง lock เอง)
- **`generateResponse()`** (`lib/bms/ai.ts`) รับ `tenantId` เพิ่ม ลำดับ: key ของร้าน (ไม่ติด quota) →
  shared key (เช็ค quota ก่อนเรียกทุกครั้ง) → template — เกิน quota ไม่ error แค่ fallback เป็น template
  เหมือน pattern เดิมตอนไม่มี key เลย
- **GraphQL** → `bmsAiConfig`/`bmsAiUsage` (query) + `bmsSetAiKey`/`bmsRemoveAiKey`/`bmsTestAiKey`
  (`graphql/bmsAiConfig.ts`) gate ด้วย `requireTenantAdmin()` เดียวกับ `bmsChannels` — **ไม่ได้เพิ่ม
  permission ใหม่ใน `BMS_PERMISSIONS`** เหตุผลเดียวกับ Channel Health (เป็น config ของร้าน ไม่ใช่ operational
  action) จึงไม่ต้อง seed สิทธิ์ให้ role ไหนเพิ่ม · `bmsTestPlatformAiKey` แยกต่างหาก gate ด้วย
  `requirePlatformAdmin()` (ทดสอบ shared key ระดับแพลตฟอร์ม)
- **UI** — การ์ด "AI (Claude)" ใน `/admin/settings` (คู่กับการ์ด channel เดิม: ใส่/ทดสอบ/ลบ key, แสดง usage
  banner ตอนยังใช้ shared key) · Dashboard alert ตอน usage ใกล้/เกิน quota (`/admin/dashboard`, ลิงก์ไป
  Settings) · ปุ่ม "ทดสอบ Shared AI Key" ในหน้า platform admin `/admin/env` (เพิ่ม prefix `ANTHROPIC_`/
  `BMS_AI_MODEL` เข้า allowlist ของหน้านั้นด้วย)
  · **Sidebar indicator** (`AdminSidebar.tsx`, poll 60s แบบเดียวกับ `bmsChannelHealthCount` แต่ห่างกว่าเพราะ
  โควตานับเป็นเดือนไม่ใช่วินาที) — ปักเหนือคู่มือ/โปรไฟล์ คล้าย balance strip ของ Claude Console: โชว์ทันทีที่
  เริ่มมี usage (`count > 0`, ไม่ใช่แค่ตอนใกล้/เกิน quota) เป็น pill ไอคอน `RobotOutlined` + จุดสีบอกระดับ
  (ฟ้า=ใช้งานปกติ, เหลือง=ใกล้เกิน ≤20% ของ limit, แดง=เกินแล้ว) กด link ไป `/admin/settings` — ซ่อนถ้า
  ร้านตั้ง key ตัวเอง (`has_key`) หรือ plan ไม่จำกัด (`unlimited`) เพราะไม่มี quota ให้เตือน
- **ยังไม่ทำ**: ไม่มีการแจ้งเตือนเชิงรุก (เช่น LINE แจ้งร้านตอน quota ใกล้หมด) — ตอนนี้เห็นได้แค่ตอนเปิดแอพ
  (Sidebar/Dashboard/Settings) เท่านั้น

## Revision History (2026-07)

**เสร็จแล้ว** — `/admin/revisions` เป็นหน้าอ่านประวัติ snapshot แบบ list/detail/compare สำหรับ
`products`, `orders`, `payments`, `shipments`:

- รัน `7.0__bms_revision_helpers.sql` ก่อนเสมอ แล้วค่อยรันไฟล์ revision ราย batch/รายตารางที่ต้องการ
  (`7.1`–`7.14`) — helper จะสร้าง `<table>_revisions`, trigger, RLS policy, และ grant ให้ `bms_app`
- revision เก็บ snapshot ของแถว **ก่อน UPDATE** เท่านั้น; แถวเก่าก่อนเปิด trigger จะไม่มี revision ย้อนหลัง
- `beginTenantTx(client, tenantId, { editorId })` จะ set `bms.tenant_id`, `app.editor_id`, และ
  `app.revision_id`; ถ้าไม่ส่ง `editorId` หน้า Revision History จะแสดง editor เป็น `system`
- ตอนนี้ product/inventory mutations ส่ง `auth.author_id` แล้ว จึงเห็น email/name ของ admin login ในคอลัมน์
  Editor ผ่าน GraphQL `bmsRevisionHistory`/`bmsRevisionDetail`
- Search ในหน้า Revision History ไม่ต้อง exact id เสมอ: products ค้น `sku/name/barcode`; orders/payments/
  shipments ค้น id/status/reference/tracking ตาม kind
- Compare 2 version คือ compare snapshot กับ snapshot; ถ้าต้องการ compare revision ล่าสุดกับ row ปัจจุบัน
  ต้องเพิ่ม API อีกตัวภายหลัง

## AI tool-calling (2026-07) — ต่อ backend เข้ากับ AI จริง

**เสร็จแล้ว** — เดิม AI conversation เรียกได้แค่ `checkStock()`/`createOrder()` ผ่าน NLU keyword (`nlu.ts`)
ตอนนี้เป็น **Claude tool-use จริง** ผ่าน runtime กลาง + tool catalog ที่ห่อ service เดิมทุกตัว (ไม่ทำ logic ซ้ำ):

- **โครง** → `lib/bms/tools/{types,runtime,catalog}.ts`
  - `types.ts` — `BmsTool` + `ExecCtx` (`{tenantId, surface, actor, channel?, customerRef?, ctx?}`) + arg validator (`reqString`/`reqInt`/`enumVal`/`reqItems` — model args = untrusted)
  - `runtime.ts` — `runToolLoop()` วน tool_use→execute→tool_result (bounded MAX_ROUNDS=5 + timeout 20s) · **catch error เอง คืน `usedAi:true` เสมอเมื่อมี creds** (กัน caller ไป rule-based สร้างออร์เดอร์ซ้ำหลัง create_order รันไปแล้ว) · gate surface + `requirePermission()` ซ้ำก่อน execute · reject field แปลก · audit ทุก attempt เป็น `ai.tool_call` โดยไม่เก็บ raw args · A3 คืน proposal ป้อนกลับว่า "รอมนุษย์ยืนยัน"
  - `catalog.ts` — ทูล A1(read)/A2(write+audit)/A3(propose-only) + `customerTools()`/`staffTools(perms)` · ชื่อ tool เป็น snake_case
- **credential** → `resolveAiCredentials(tenantId)` แยกออกจาก `generateResponse` ใน `ai.ts` (BYOK→shared+`tryConsumeAiQuota`→null) เรียก **ครั้งเดียวต่อข้อความ** (tool-loop หลายรอบ = 1 quota)
- **2 surface**:
  - **customer** = `pipeline.ts` (`runPipeline`) — AI-first ด้วย `customerTools()`; **rule-based เดิมเป็น fallback เฉพาะตอน `usedAi:false`** (ไม่มี key/เกิน quota) เท่านั้น · read/write ของ order scope ด้วย `(channel, customer_ref)` ของแชทนั้น (กันเดา orderId คนอื่น) · **ไม่มี A3/A2-staff ใน registry ฝั่งนี้เลย**
  - **staff** = `graphql/bmsAssistant.ts` (Mutation `bmsAssistant(message, history)`) + UI `/admin/assistant` (เมนู top-level "ผู้ช่วย AI" ใน `AdminSidebar.tsx`) · gate `loadPermissions(ctx)` → `staffTools(perms)` (ทูลที่ role ไม่มีสิทธิ์ **ไม่ถูกเสนอให้ AI**) และ runtime เช็กสิทธิ์ซ้ำอีกครั้งก่อน execute · A3 → proposal, ปุ่ม Confirm ยิง **mutation เดิม** (`bmsRefundPayment`/`bmsAdjustStock`/… — map ในหน้า page.tsx) ไม่มี execution path ใหม่
- **ไม่มี migration** (ใช้ตาราง/สิทธิ์/mutation เดิม, proposal ephemeral)
- **RBAC ฝั่ง customer**: ไม่ใช่ per-permission — ปลอดภัยเพราะ registry เปิดเฉพาะทูลที่ลูกค้าทำเองได้ + tenant มาจาก server
- **⚠️ ยังต้องจูน**: ตอนใช้ shared key model = haiku-4-5 มัก conservative เรื่องปิดการขาย (บางทีใส่ไซซ์ลงใน keyword ของ search_products, หรือถามย้ำก่อน create_order) — ของเดิม rule-based ปิดออร์เดอร์ deterministic ได้เลย. ทางเลือกถ้าเจอ regression: (ก) จูน `CUSTOMER_SYSTEM` prompt ใน `pipeline.ts` เพิ่ม (ข) ใช้ model แรงกว่าผ่าน BYOK (ค) กลับมาใส่ deterministic CONFIRM_ORDER fast-path ก่อน AI loop (ต้องระวัง double-create — ให้ mutually exclusive กับ AI path)
- verify: playground `POST /api/bms/chat {channel:"test"}` ดู `tool:"ai:tool-calling"` + `trace[]` · staff ต้อง login เปิด `/admin/assistant`

### ทูลชุด 2 (B1–B3, 2026-07) — store/docs/forecast/AI-native/outbound

เพิ่มทูลเข้า `catalog.ts` อีกชุด (ยังห่อ service เดิม ไม่มี logic ซ้ำ):
- **store profile (B1)** → `lib/bms/storeProfile.ts` + **migration `6.9__bms_store_profile.sql`** (1 แถว/ร้าน,
  ตารางใหม่แรกของงาน AI นี้) · tools `get_store_info`/`get_payment_info`/`get_shipping_estimate`
  (customer+staff, read) · GraphQL `bmsStoreProfile`/`bmsUpsertStoreProfile` (`graphql/bmsStoreProfile.ts`,
  gate `requireTenantAdmin` — ไม่มี permission ใหม่) · UI การ์ด `StoreProfileCard.tsx` ใน `/admin/settings`
  · `payment_accounts` = บัญชี "ของร้านเอง" ตั้งใจให้ลูกค้าเห็น (ไม่ใช่ PII บุคคลที่สาม) · `estimateShipping()`
  = flat rate + ส่งฟรีเมื่อยอด ≥ threshold (ยังไม่ผูก carrier API จริง)
- **documents (B2)** → `lib/bms/documents.ts` · `generate_invoice(orderId)` (จาก order จริง, ราคา snapshot),
  `generate_quotation(items[])` (ตีราคาปัจจุบัน + ค่าส่งประเมิน) — ephemeral ไม่ persist, staff `order.view`
- **forecast (B3)** → `lib/bms/forecast.ts` · `forecast_demand`/`predict_stockout`/`suggest_purchase_order`
  — **heuristic (moving-average velocity) เท่านั้น** นับจาก order ที่ชำระแล้ว (PAID+) ทุกผลลัพธ์แนบ
  `method:"heuristic"` + `disclaimer` (ตาม AI_GUIDELINES: forecast ต้องบอก uncertainty + ให้คนรีวิว), staff `report.view`
- **AI-native (B3)** → `detect_language`/`classify_intent` (deterministic ไม่เรียก Claude ซ้ำ),
  `summarize_conversation`/`recommend_products` (data provider ให้ผู้ช่วยสรุป/แนะนำต่อ)
- **outbound (25, propose-only)** → `send_customer_message(conversationId, body)` = proposal → Confirm ยิง
  `bmsSendMessage` เดิม (push จริงเฉพาะ LINE/FB/IG) · **TikTok send/email ยังไม่ทำ (ไม่มี API จริง)**
- verify แล้ว: apply `6.9` เข้า docker postgres (db=`bms` user=`app`), seed store profile ให้ default tenant,
  ถาม playground "ร้านเปิดกี่โมง/โอนบัญชีไหน/ค่าส่งเท่าไหร่ซื้อ 1200 ส่งฟรีไหม" → tool `get_store_info`/
  `get_payment_info`/`get_shipping_estimate` ตอบจากข้อมูลจริง + คำนวณส่งฟรีถูก

### AI tool-calling — ตัวอย่างวิธีใช้งาน

**1) ฝั่งลูกค้า (admin playground, ต้อง login, ไม่ log เข้า inbox จริง):**

```bash
# login ก่อนและเก็บ signed admin cookie (เปลี่ยนค่า placeholder เป็นบัญชี dev ของคุณ)
curl -s -c /tmp/bms-cookies.txt -X POST http://localhost:3000/api/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin@example.com","password":"YOUR_DEV_PASSWORD"}'

# ถามสต็อก/ราคา — AI เรียก search_products/check_stock เอง ตอบจากข้อมูลจริง
curl -s -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Nike XL ราคาเท่าไหร่ เหลือกี่ชิ้น","channel":"test"}'

# ดู trace ว่าเรียกทูลไหนบ้าง (field "trace" มีเฉพาะตอน tool:"ai:tool-calling")
# {"tool":"ai:tool-calling","trace":[{"tool":"search_products","ok":true,...},{"tool":"check_stock","ok":true,...}],"reply":"..."}

# สั่งซื้อจริง (จองสต็อก atomic ผ่าน create_order) — ใส่ customerRef คงที่เพื่อให้ get_order_status/reorder เห็นออร์เดอร์เดิม
curl -s -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/chat \
  -H 'content-type: application/json' \
  -d '{"message":"สั่ง Nike Air ไซซ์ XL 1 ชิ้น ยืนยันสั่งเลย","channel":"test","customerRef":"Utest_001"}'

# ถามสถานะออร์เดอร์ของตัวเอง (scope ด้วย channel+customerRef เดียวกัน กันเดา orderId คนอื่น)
curl -s -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/chat \
  -H 'content-type: application/json' \
  -d '{"message":"ออร์เดอร์ล่าสุดของฉันถึงไหนแล้ว","channel":"test","customerRef":"Utest_001"}'
```

ถ้าไม่มี `ANTHROPIC_API_KEY`/BYOK หรือ shared quota หมด → `tool` จะไม่ใช่ `"ai:tool-calling"` (กลับไป
path rule-based เดิม `checkStock`/`createOrder`, ไม่มี field `trace`) — ใช้เทียบพฤติกรรม fallback ได้

**2) ฝั่งแอดมิน (`/admin/assistant`, ต้อง login + มีสิทธิ์ตาม role):**

พิมพ์ในช่องแชท เช่น:
- อ่านอย่างเดียว (ไม่ต้องยืนยัน): `"ยอดขาย 7 วันล่าสุดเป็นยังไง"`, `"สินค้าอะไรใกล้หมดบ้าง"`,
  `"ลูกค้าเบอร์ 08x... เคยซื้ออะไรบ้าง"`
- เขียวไม่ sensitive (execute ทันที + audit): `"สร้างใบสั่งซื้อจาก supplier ก. สินค้า sku NIKE-001 ไซซ์ XL 10 ชิ้น"`
- sensitive (ได้แค่ **คำขอ** ต้องกด "ยืนยัน" ในการ์ดที่ขึ้นมา): `"คืนเงินการชำระ #payment-id"`,
  `"ปรับสต็อก NIKE-001 ไซซ์ XL ลบ 2 ชิ้น เพราะของเสีย"`, `"ยกเลิกออร์เดอร์ #order-id"`

ทดสอบผ่าน GraphQL ตรง ๆ (ต้องมี session cookie ของแอดมินที่ login แล้ว):

```graphql
mutation {
  bmsAssistant(message: "ยอดขายเดือนนี้เท่าไหร่") {
    reply
    trace { tool ok summary }
    proposals { tool mutation args summary }
  }
}
```

`proposals[]` จะว่างเปล่าถ้าไม่มีการเรียกทูล sensitive · role ที่ไม่มีสิทธิ์ของทูลนั้น (เช่น Sales ไม่มี
`payment.refund`) จะไม่เห็นทูลนั้นถูกเสนอให้ AI เลยตั้งแต่ต้น (กรองที่ `staffTools(perms)`) และถึงมี
provider output ผิดปกติก็จะถูก runtime ปฏิเสธซ้ำก่อน execute

## เติมข้อมูลทดสอบเร็ว ๆ

ที่ `/admin/dev/fake` กดสร้างตามลำดับ **Products → Customers → Orders → Conversations → Purchase**
แล้วดู Dashboard/Reports/Inbox/Payment/Shipping/Purchase · กด **Cleanup** ลบ fake ทั้งหมด (marker `FAKE-`/tag `fake`, ลบตามลำดับ FK)
**seed ลง tenant ของ user ที่ล็อกอิน** (ร้านค้าเทสเองแล้วเห็นในร้านตัวเอง) · cleanup ก็ scope ตามร้าน · platform admin อยากเทสร้านไหนให้ drill-down เข้าร้านนั้นก่อน

## หมายเหตุการเช็ก type/dependency บนเครื่องนี้

- `apps/web` ใช้ dependency ชุดที่มีอยู่ใน repo/container อยู่แล้ว; การรัน `pnpm` บนเครื่องที่เดิมลงด้วย npm
  อาจย้าย package ไป `node_modules/.ignored` และทำให้ type checker ฟ้องว่าโมดูลหายทั้งโปรเจ็กต์ได้
- ถ้าจะเช็ก TypeScript ในเครื่องนี้ ให้ระวังไม่ให้ตัวเช็กพยายาม install dependency ใหม่โดยไม่จำเป็น
- ถ้ามี `.pnpm-store/` โผล่ใน repo จากการเช็กพลาด มันเป็นเศษ local artifact ไม่ใช่ source-of-truth ของระบบ

## การเพิ่มโมดูลใหม่ (checklist)

1. migration `db/migrations/N.N__bms_<mod>.sql` — tenant_id + RLS policy (copy 4.2) + GRANT bms_app (copy 4.3)
2. service `lib/bms/<mod>.ts` — write ใช้ `getClient()` + `beginTenantTx()`; read ใช้ `query()` + `WHERE tenant_id`
3. GraphQL `graphql/bms<Mod>.ts` + wire resolvers + typeDefs; enforce `requirePermission()` + `audit()`
4. เพิ่ม permission ใน `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) — **และ seed สิทธิ์ให้ role Manager/Sales/Warehouse ทุก tenant** (migration แบบ `5.7`) ไม่งั้นร้านจะโดน 403
5. REST routes (ถ้าต้องการ) + Admin page + เมนู (gate ด้วย `useBmsPermissions`) + เอกสาร (`docs/ai/tools.md`/README.md)

> ⚠️ 403 = ไม่มีสิทธิ์ (ไม่ใช่ session หมด) → `apollo.ts` errorLink **ไม่ logout** เมื่อ 403 (logout เฉพาะ 401). ถ้าเพิ่ม permission ใหม่แล้วลืม seed ให้ role → หน้าโดน 403 แต่จะไม่เตะออก

## SaaS redesign: Lazada OAuth + Sync Service — เลิกทำแล้ว (superseded)

แผน Phase A–D เดิม (OAuth + background sync worker + `ChannelAdapter` refactor + migration `6.3`/`6.4`) **ไม่ได้ implement
ตามแผนนี้** — ของจริงไปทาง webhook scaffold แบบเดียวกับ TikTok แทน (ดู note ใน § Customer 360 ด้านบน และ
[docs/integrations/lazada.md](docs/integrations/lazada.md)) ถ้าจะกลับไปทำ OAuth+Sync จริงในอนาคต ต้องรีวิว/เขียนแผนใหม่
ไม่ใช่หยิบ Phase A–D เดิมมาทำต่อ (เลขไมเกรชัน `6.2`/`6.3`/`6.4` ที่แผนเดิมจะใช้ ตอนนี้ถูก customer_360/order_create_perm
(renumber จาก `6.1` เดิม)/channel_health ใช้ไปแล้วจริง — ดู § Channel Health ด้านบน)

## สถานะปัจจุบัน

โมดูลเชิงปฏิบัติการครบแล้ว (ดูตาราง Build Status ใน CLAUDE.md) + **Customer 360 panel ใน Inbox เสร็จแล้ว** (ดูหัวข้อด้านบน)
+ **แท็บ "ลูกค้า"/merge/reorder เสร็จแล้ว** + **Shopee/Lazada beta scaffold เสร็จแล้ว** (ดู [docs/integrations/lazada.md](docs/integrations/lazada.md))
+ **Channel Health status เสร็จแล้ว** (ดูหัวข้อ § Channel Health ด้านบน — schema/service/webhook wiring/GraphQL/UI ครบ
เฉพาะ proactive external notification ที่ยังไม่ทำ).
+ **Realtime Diagnostics เสร็จแล้ว** (`/admin/inbox/realtime-diagnostics`) — `Emit` ทดสอบ PubSub/WS signal,
`Create Msg` สร้างข้อความ diagnostic ให้เห็นใน Inbox จริงโดยไม่ส่งออก platform.
+ **AI Free Tier + BYOK เสร็จแล้ว** (ดูหัวข้อ § AI Free Tier + BYOK ด้านบน — schema/service/GraphQL/UI ครบ
เฉพาะ proactive notification ตอน quota ใกล้หมดที่ยังไม่ทำ).
+ **AI tool-calling เสร็จแล้ว** (ดูหัวข้อ § AI tool-calling ด้านบน — customer surface (pipeline) +
staff assistant (`/admin/assistant`) ครบ A1/A2/A3, A3 เป็น propose-only ยิง mutation เดิม; ยังต้องจูน
prompt/model เรื่อง conversion บน shared key model ตามที่บันทึกไว้).
**เหลือ:** TikTok send API · carrier API จริง · AI OCR/forecasting (นอกเหนือจาก payment-slip verify) ·
WhatsApp/Email/Voice AI ·
Shopee/Lazada signature verification กับเอกสาร Open Platform ตัวจริง (ยังไม่ผลิตจริงได้) ·
ให้ owner (role Manager) จัดการ staff ร้านตัวเองได้ · Customer 360 pending items (ดู "Pending improvements" ในหัวข้อ Customer 360)
· ตั้ง cron schedule จริงให้ `/api/bms/channels/check-health` (endpoint พร้อมแล้ว แค่ยังไม่มีตัวยิงอัตโนมัติ)
· proactive external notification สำหรับ Channel Health (ต้องออกแบบ LINE user id ผูก admin ก่อน — ดู § Channel Health)

## ก่อน production (สำคัญ)

- เปิดตรวจรหัสผ่านใน loginAdmin (dev ยังไม่ตรวจ)
- ตั้ง env `BMS_SECRET_KEY` (hex 64) — ไม่งั้นใช้ dev key เข้ารหัส token
- ตั้ง `JWT_SECRET` ให้แน่น — ใช้เซ็นทั้ง session token + cookie drill-down `BMS_ACT_TENANT`
- ให้ app ต่อ DB ด้วย role non-superuser เพื่อให้ RLS มีผลกับ read
- apply migration `5.6` (platform admin) + `5.7` (operational perms) · seed platform admin ชุดแรก = Administrator ของร้าน default
- ย้าย rate-limit webhook ไป Redis (ตอนนี้ in-memory ต่อ instance)
- `META_GRAPH_VERSION` (default v21.0) สำหรับ FB/IG send
- Lazada/Shopee webhook signature ต้อง verify กับเอกสาร Open Platform ตัวจริงก่อนใช้จริง (ตอนนี้ HMAC-SHA256 แบบ TikTok เป็นแค่ placeholder ที่ยังไม่ยืนยัน — ดู [docs/integrations/lazada.md](docs/integrations/lazada.md))
- fake seeder ปิดใน production · เปิดเฉพาะเครื่อง demo ด้วย `BMS_ALLOW_FAKE_SEED=1` (ร้านเทส seed มุมตัวเองได้)
- หน้าระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Queue/Architecture) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side, กัน shop user เข้าตรงผ่าน URL)
