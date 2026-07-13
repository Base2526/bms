# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

ไฟล์นี้ไว้จดบริบทการทำงานในเครื่อง/ทีม — สเปกจริงอยู่ที่ [CLAUDE.md](CLAUDE.md),
[BUSINESS_RULES.md](BUSINESS_RULES.md), [TOOLS.md](TOOLS.md), [AI_WORKFLOW.md](AI_WORKFLOW.md)

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
  · เมนูจัดลำดับตามความถี่ใช้จริง: **Inbox เป็น top-level** (ไม่ฝังใน submenu ร้านค้าแล้ว) พร้อม badge unread
  (`bmsInboxUnreadCount`, poll 15s ที่ sidebar เอง เพราะติดทุกหน้า ไม่ใช่แค่หน้า Inbox — Sales เห็นแค่ของตัวเอง
  ตาม scope เดียวกับ `bmsConversations`) · Reports ย้ายลงมาหลังกลุ่มร้านค้า · คู่มือย้ายไปแถบล่างสุดคู่โปรไฟล์
  (ใช้ไม่บ่อย ไม่ควรแย่งที่ top-level)
  · **เมนูที่มี badge (`link(..., badge, collapsed)`) ต้องส่ง `collapsed` มาด้วยเสมอ** — ถ้าลืม (ค่า default
  เป็น `false`) label จะ render เป็น flex+pill layout เสมอ ซึ่งพอ sidebar ย่อจริงแล้วเปิดเป็น submenu flyout
  popup, span ข้อความจะยุบเหลือ 0 (overflow:hidden) → hover ไม่เห็นตัวหนังสือเลย (เจอที่เมนู Users เพราะลืมส่ง
  `collapsed` ตอนเพิ่ม badge=3 — ดู `AdminSidebar.tsx`, เทียบกับเมนู Inbox ที่ส่งถูก)
  · เลย์เอาต์รวม `components/AdminLayoutClient.tsx` (หน้าแรก `/admin` → redirect เข้า `/admin/dashboard`)
- **RBAC/tenant** → `lib/bms/{permissions,tenant,platform}.ts` · gate: `requirePermission()` (per-tenant) ·
  `requireUserAdmin()`/`requirePlatformOnly()` (จัดการ user/role ใน `resolvers.ts`) ·
  platform admin = `users.is_platform_admin` · drill-down = cookie `BMS_ACT_TENANT` (signed, ผูก admin.id) override tenant ใน `app/api/graphql/route.ts`
- **migrations** → `db/migrations/*.sql` (idempotent, apply ตามเลข) — ล่าสุด `5.6` (platform admin) · `5.7` (เติมสิทธิ์ operational ให้ Manager/Sales/Warehouse) · `5.8` (`bms_plans.max_users` — quota staff/plan: free=3, pro=10, business=ไม่จำกัด) · `5.9` (`bms_products`: image_url/description/cost_price/category/brand) · `6.0` (`bms_product_categories` — list หมวดหมู่ที่จัดการได้ + backfill จาก category เดิม) · `6.1` (`bms_conversations.assigned_to_user_id` FK จริง แทน `assigned_to` TEXT เดิม (ยังอยู่ในตารางแต่เลิกใช้แล้ว) + `bms_conversation_helpers` (คนช่วยตอบ) + `users.is_available` + permission ใหม่ `inbox.assign`)
- **inbox: มอบหมาย staff** → `lib/bms/inbox.ts` (`pickAutoAssignee`/`autoAssignConversation`/`reassignStaffConversations`) — แชทใหม่ auto-assign ให้ Sales ที่ว่างและถือแชท OPEN/PENDING น้อยสุดก่อนเสมอ (fallback Manager → Administrator ถ้าร้านยังไม่มี Sales) · **ทุก conversation ต้องมี staff หลักเสมอ** — `deleteUser`/`deleteUsers` (`resolvers.ts`) เรียก `reassignStaffConversations()` โอนแชทค้างออกก่อนลบทุกครั้ง ห้ามลบ user ตรงๆ โดยข้ามขั้นตอนนี้ · ประวัติมอบหมาย/โอน/helper ใช้ `bms_audit_log` เดิม (target = conversation id, action `inbox.assign`/`inbox.helper_add`/`inbox.helper_remove`) ไม่ได้สร้างตาราง log ใหม่ · `inbox.assign` (โอน staff หลัก) แยกจาก `inbox.manage` (status/tags/notes) เพราะ Sales ต้องโอนแชทตัวเองได้โดยไม่ต้องมีสิทธิ์จัดการเต็ม · helper add/remove ใช้สิทธิ์ `inbox.reply` เดิม (ไม่ต้องสิทธิ์พิเศษ)
- **inbox: สายแชท + system event** → หน้าแชทรวม message + system event (`listSystemEvents` → `bmsConversation.systemEvents`) เรียงตามเวลาในสายเดียว: มอบหมาย/เพิ่ม-ถอดผู้ช่วยตอบ/เปลี่ยนสถานะ แสดงเป็นแถวกลางสีเทา + marker "เริ่มการสนทนา" หัวสาย (derive จาก `created_at`/ข้อความแรก ไม่ได้ log เพิ่ม) + date separator (วันนี้/เมื่อวาน/วันที่, timezone Asia/Bangkok) · `systemEvents` resolve ชื่อคนจาก UUID/email ใน `bms_audit_log` แล้ว (user ถูกลบ → "ผู้ใช้ที่ถูกลบ") · แท็บ Timeline เดิมเก็บไว้คู่กัน (รวม order history ที่ไม่ควรแทรกในแชท) · **Sales เห็นเฉพาะแชทของตัวเอง** (staff หลัก/ผู้ช่วยตอบ) — บังคับที่ `bmsConversations`/`bmsConversation` (`bmsInbox.ts`, `role === "Sales"`) · role อื่นเห็นทั้งร้าน
- **order journey** → `getOrderJourney` (`lib/bms/orders.ts`) → `bmsOrderJourney(orderId)` — แถวขยายในหน้า Orders โชว์ ต้นทางแชท + stepper (PENDING→PAID→PACKING→SHIPPED→COMPLETED + กิ่ง CANCELLED/RETURNED) + timeline ละเอียด · **ไม่มี migration** — order↔conversation join 1:1 ด้วย `(tenant_id, channel, customer_ref)` (conversation dedupe ด้วย UNIQUE เดิม) · reuse `bms_audit_log` (order.pay/pack/ship/complete/cancel/return, target=orderId) + `listSystemEvents`/`listConversationHelpers` (event แชท) + `listShipments` (เลขพัสดุ) · COMPLETED แบบ auto (จัดส่งถึง) ไม่ได้ audit → fallback `updated_at` · ลิงก์ "เปิดดูแชท" ไป `/admin/inbox?c=<id>` (inbox อ่าน param `c` เปิดแชทนั้น)
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
- **SaaS redesign (Lazada/OAuth/Sync) — ยังไม่มีไฟล์พวกนี้ เป็นแผนงาน ไม่ใช่ของที่มีอยู่แล้ว:**
  `lib/bms/channelAdapter.ts` (interface กลางที่ LINE/TikTok/Meta/Web/Lazada implement ร่วมกัน — refactor แบบ non-breaking จากโค้ด webhook ที่มีอยู่, ไม่ใช่เขียนใหม่) ·
  `lib/bms/sync.ts` (sync function ต่อ resource: product/order/payment/shipment) ·
  `lib/bms/lazadaClient.ts` (เรียก Lazada API แบบ signed request + OAuth token exchange) ·
  `packages/bms-queue/` — **ก็อปแพทเทิร์นจาก `packages/social-queue/queue.server.ts` แต่ทำเป็น package ใหม่แยก
  ไม่ใช้ตัวเดิม** เพราะ `apps/web/scripts/social-worker.mjs` (worker ของ `social-queue`) hardcode
  `platform !== "facebook"` → DLQ ทันที (เป็น pipeline publish "Posts" เก่า ไม่เกี่ยว BMS) ·
  `apps/web/scripts/bms-sync-worker.mjs` + docker-compose service ใหม่ `bms-sync-worker` (sibling ของ `social-worker`) ·
  migration **`6.3__bms_channel_oauth.sql`** (`bms_tenant_channels.auth_type/refresh_token/expires_at/external_account_id`)
  + **`6.4__bms_channel_sync.sql`** (`bms_channel_sync_state`, `bms_channel_product_map`, `bms_orders.external_order_id`)
  — ⚠️ เลขขยับจาก 6.2/6.3 เดิมที่เคยร่างไว้ เพราะ **`6.2` ถูกใช้ไปแล้วโดย Customer 360** (ดูหัวข้อถัดไป) ·
  permission ใหม่ `channel.connect`/`channel.oauth`/`sync.view`/`sync.trigger` ·
  ดูสเปกเต็มที่ [BUSINESS_RULES.md](BUSINESS_RULES.md) § Channels & Commerce Sync + [CLAUDE.md](CLAUDE.md) § SaaS Architecture

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
- `ChannelAdapter` refactor (Phase D ของ SaaS redesign) จะทำให้ Lazada โผล่ใน recent orders ของ panel นี้ได้จริง
  — ตอนนี้ query รองรับ Lazada อยู่แล้ว (channel เป็น free text) แต่ยังไม่มี order จากช่องทางนั้นจริงจนกว่า Phase A/B จะเสร็จ
- "Open Marketplace" ปุ่มใน Recent Orders ยัง disabled ทุกช่องทาง (ไม่มี deep-link ไป LINE OA Manager/TikTok
  Seller Center/Lazada Seller Center จริง) — รอ design ต่างหาก ไม่ใช่ scope ของรอบนี้
- ยังไม่มี unit/integration test สำหรับ `lib/bms/customer360.ts` (โปรเจกต์นี้ยังไม่มี test suite ที่ใช้งานอยู่โดยรวม)
- avg response time query สมมติ 1 แถว "IN แล้ว OUT ถัดไปในแชทเดียวกัน" เป็น 1 การตอบ — ยังไม่หัก เวลาที่แชทปิด/เปิดใหม่
  ข้ามวันออก (edge case ที่อาจทำให้ตัวเลขเพี้ยนถ้าลูกค้าทิ้งแชทค้างไว้ข้ามคืนแล้วมาต่อ)

## เติมข้อมูลทดสอบเร็ว ๆ

ที่ `/admin/dev/fake` กดสร้างตามลำดับ **Products → Customers → Orders → Conversations → Purchase**
แล้วดู Dashboard/Reports/Inbox/Payment/Shipping/Purchase · กด **Cleanup** ลบ fake ทั้งหมด (marker `FAKE-`/tag `fake`, ลบตามลำดับ FK)
**seed ลง tenant ของ user ที่ล็อกอิน** (ร้านค้าเทสเองแล้วเห็นในร้านตัวเอง) · cleanup ก็ scope ตามร้าน · platform admin อยากเทสร้านไหนให้ drill-down เข้าร้านนั้นก่อน

## การเพิ่มโมดูลใหม่ (checklist)

1. migration `db/migrations/N.N__bms_<mod>.sql` — tenant_id + RLS policy (copy 4.2) + GRANT bms_app (copy 4.3)
2. service `lib/bms/<mod>.ts` — write ใช้ `getClient()` + `beginTenantTx()`; read ใช้ `query()` + `WHERE tenant_id`
3. GraphQL `graphql/bms<Mod>.ts` + wire resolvers + typeDefs; enforce `requirePermission()` + `audit()`
4. เพิ่ม permission ใน `lib/bms/permissions.ts` (`BMS_PERMISSIONS`) — **และ seed สิทธิ์ให้ role Manager/Sales/Warehouse ทุก tenant** (migration แบบ `5.7`) ไม่งั้นร้านจะโดน 403
5. REST routes (ถ้าต้องการ) + Admin page + เมนู (gate ด้วย `useBmsPermissions`) + เอกสาร (TOOLS.md/README.md)

> ⚠️ 403 = ไม่มีสิทธิ์ (ไม่ใช่ session หมด) → `apollo.ts` errorLink **ไม่ logout** เมื่อ 403 (logout เฉพาะ 401). ถ้าเพิ่ม permission ใหม่แล้วลืม seed ให้ role → หน้าโดน 403 แต่จะไม่เตะออก

## SaaS redesign: Lazada + OAuth + Sync Service (ลำดับ implement)

ออกแบบไว้แล้ว (session 2026-07) ยังไม่เริ่ม implement — ทำตาม checklist ด้านบน (docs → migration → service → GraphQL/REST → UI) ทีละ phase:

- **Phase A — OAuth + Lazada product sync (foundation):** migration `6.2`/`6.3` · `channels.ts` เพิ่ม field OAuth ·
  `lazadaClient.ts` · OAuth route (`/api/bms/lazada/oauth/{authorize,callback}`) · permission `channel.connect`/`channel.oauth` ·
  Settings page เพิ่มการ์ด Lazada (ปุ่ม OAuth แทน paste token) · `packages/bms-queue` + `bms-sync-worker.mjs` +
  docker-compose service ใหม่ — เดินแค่ `syncLazadaProducts()` ก่อน (เสี่ยงน้อยสุด)
- **Phase B — Order/payment/shipment sync:** `syncLazadaOrders()`/`syncLazadaPaymentStatus()`/`syncLazadaShipmentStatus()`
  ใน `sync.ts` เรียก `confirmPayment()`/`setShipmentStatus()` ตรงๆ (ของเดิม ไม่สร้าง event bus ใหม่) ·
  หน้า `/admin/sync` (permission `sync.view`/`sync.trigger`) · เทส idempotency (ยิง payload Lazada order ซ้ำ ต้องได้แถวเดียว)
- **Phase C — Unified Customer Timeline:** `getCustomerTimeline()` (ไม่มี migration) · หน้า `/admin/customers/[id]/timeline`
  (permission `customer.view`)
- **Phase D — ChannelAdapter refactor + polish:** แตก `ChannelAdapter` จากโค้ด LINE/TikTok/Meta ที่มีอยู่ (behavior-preserving,
  รันเทส webhook เดิมก่อน/หลัง) · ทำ TikTok send API (ตอนนี้เป็น `// TODO(prod)` stub) ให้เสร็จภายใต้ shape เดียวกัน

**Open questions (บล็อกแค่ตอน implement Phase A จริง ไม่บล็อก docs pass นี้):**
- ยังไม่ยืนยันว่ามี Lazada Open Platform app (key/secret) แล้วหรือยัง และประเทศไหนบ้าง (TH/SG/MY/...) — ถ้ายังไม่มี Phase A ต้องทำแบบ stub/feature-flag ไปก่อน
- `bmsUpsertChannel` ตอนนี้เช็คแค่ `requireTenantAdmin()` (ไม่ใช้ `requirePermission()`) — เปลี่ยนมาใช้ `channel.connect`/`channel.oauth`
  ต้องคิดว่า seed สิทธิ์ให้ role ไหนบ้างเพื่อไม่ให้ admin เดิมโดน 403 กะทันหัน (แนะนำ: seed ให้ทุก role ที่ผ่าน `requireTenantAdmin` ได้อยู่แล้วในปัจจุบัน)

## สถานะปัจจุบัน

โมดูลเชิงปฏิบัติการครบแล้ว (ดูตาราง Build Status ใน CLAUDE.md) + **Customer 360 panel ใน Inbox เสร็จแล้ว** (ดูหัวข้อด้านบน).
**เหลือ:** Lazada + OAuth + Sync Service (ออกแบบแล้ว ดู phase ด้านบน — migration เลื่อนเป็น `6.3`/`6.4`) ·
TikTok send API · carrier API จริง · AI tool-calling/OCR/forecasting (Phase 3–4) ·
Customer 360 pending items (ดู "Pending improvements" ในหัวข้อ Customer 360).

## ก่อน production (สำคัญ)

- เปิดตรวจรหัสผ่านใน loginAdmin (dev ยังไม่ตรวจ)
- ตั้ง env `BMS_SECRET_KEY` (hex 64) — ไม่งั้นใช้ dev key เข้ารหัส token
- ตั้ง `JWT_SECRET` ให้แน่น — ใช้เซ็นทั้ง session token + cookie drill-down `BMS_ACT_TENANT`
- ให้ app ต่อ DB ด้วย role non-superuser เพื่อให้ RLS มีผลกับ read
- apply migration `5.6` (platform admin) + `5.7` (operational perms) · seed platform admin ชุดแรก = Administrator ของร้าน default
- ย้าย rate-limit webhook ไป Redis (ตอนนี้ in-memory ต่อ instance)
- `META_GRAPH_VERSION` (default v21.0) สำหรับ FB/IG send
- Lazada OAuth ต้องมี app key/secret ของ Lazada Open Platform เป็น env แยก (ยังไม่ได้ตั้ง — รอ Phase A)
- fake seeder ปิดใน production · เปิดเฉพาะเครื่อง demo ด้วย `BMS_ALLOW_FAKE_SEED=1` (ร้านเทส seed มุมตัวเองได้)
- หน้าระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Queue/Architecture) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side, กัน shop user เข้าตรงผ่าน URL)
