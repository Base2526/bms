# CLAUDE.local.md — โน้ตเฉพาะเครื่อง (ไม่ใช่สเปกกลาง)

ไฟล์นี้ไว้จดบริบทการทำงานในเครื่อง/ทีม — สเปกจริงอยู่ที่ [CLAUDE.md](CLAUDE.md) (entry point) →
[docs/](docs/) (architecture / business / ai / integrations / ui)

## รันในเครื่อง (dev)

```bash
# dev stack ผ่าน docker (postgres + redis + web + ws + pgadmin; Caddy ปิดไว้โดย default)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# เปิด Caddy เฉพาะเครื่องที่ไม่มี reverse proxy ตัวอื่นจับ 80/443 อยู่
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile with-caddy up --build

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
- dev compose จะรัน `npm ci` เฉพาะตอน `node_modules/.package-lock.json` ยังไม่มีใน volume เพื่อให้ start
  รอบถัดไปเร็วขึ้น; ถ้าเปลี่ยน dependency/package-lock แล้ว dependency ใน container ไม่ตรง ให้ recreate
  เฉพาะ node_modules volume หรือ exec เข้า container ไปรัน `npm ci` ใหม่
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
  (`bmsInboxUnreadCount`, poll 30s ที่ sidebar เอง เพราะติดทุกหน้า ไม่ใช่แค่หน้า Inbox — Sales เห็นแค่ของตัวเอง
  ตาม scope เดียวกับ `bmsConversations`) · Reports ย้ายลงมาหลังกลุ่มร้านค้า · คู่มือย้ายไปแถบล่างสุดคู่โปรไฟล์
  (ใช้ไม่บ่อย ไม่ควรแย่งที่ top-level)
  · `/admin/inbox/realtime-diagnostics` อยู่ในกลุ่ม SaaS และเปิดให้เฉพาะ Administrator/platform admin: `Emit`
  ทดสอบ Redis/WebSocket signal อย่างเดียว (ไม่เขียน DB, ไม่ควรเห็นแชทใหม่), `Create Msg` สร้างข้อความ diagnostic
  ใน Inbox จริง (`diagnostic:{channel}:{adminId}`) โดยไม่เรียก AI pipeline และไม่ส่งออก platform
- ถ้า admin local ยังรู้สึกหน่วง ให้เช็ค 3 ชั้นนี้ก่อน: (1) Network tab ว่า `/graphql` ยิงซ้ำจาก shell หรือไม่,
  (2) WebSocket tab ว่าหน้า `/admin/*` ไม่ควรเปิด `GlobalChatListener` ของ chat หลัก, และ (3) Postgres slow
  query จาก dashboard/badge read path. Migration `7.49__bms_admin_read_path_indexes.sql` เพิ่ม index สำหรับ
  dashboard, unread badge, AI failure summary, และ payment/order alerts แล้ว.
- บนเครื่องพื้นที่เหลือน้อย ให้ดูขนาด `apps/web/.next`, `apps/web/node_modules`, และ Docker volumes ด้วย
  (`df -h .`, `du -sh apps/web/.next apps/web/node_modules`). โปรเจกต์นี้จงใจแยก host cache กับ Docker cache
  เพื่อกัน native package/Next manifest ปนกัน จึงใช้พื้นที่มากกว่าหนึ่งชุดเป็นปกติ.
  · **เมนูที่มี badge (`link(..., badge, collapsed)`) ต้องส่ง `collapsed` มาด้วยเสมอ** — ถ้าลืม (ค่า default
  เป็น `false`) label จะ render เป็น flex+pill layout เสมอ ซึ่งพอ sidebar ย่อจริงแล้วเปิดเป็น submenu flyout
  popup, span ข้อความจะยุบเหลือ 0 (overflow:hidden) → hover ไม่เห็นตัวหนังสือเลย (เจอที่เมนู Users เพราะลืมส่ง
  `collapsed` ตอนเพิ่ม badge=3 — ดู `AdminSidebar.tsx`, เทียบกับเมนู Inbox ที่ส่งถูก)
  · เลย์เอาต์รวม `components/AdminLayoutClient.tsx` (หน้าแรก `/admin` → redirect เข้า `/admin/dashboard`)
  · โควตา AI shared key มี indicator ปักเหนือคู่มือ/โปรไฟล์เหมือนกัน (poll 60s, ไม่ใช่ badge บนเมนู) — ดู § AI Free Tier + BYOK
- **RBAC/tenant** → `lib/bms/{permissions,tenant,platform}.ts` · gate: `requirePermission()` (per-tenant) ·
  `requireUserAdmin()`/`requirePlatformOnly()` (จัดการ user/role ใน `resolvers.ts`) ·
  platform admin = `users.is_platform_admin` · drill-down = cookie `BMS_ACT_TENANT` (signed, ผูก admin.id) override tenant ใน `app/api/graphql/route.ts`
  · เมื่อ platform admin อยู่ในมุมร้าน ให้ treat หน้า `/admin/users` เป็น tenant-scoped จริง ๆ
  (list/detail/delete/avatar ต้องไม่หลุดข้ามร้าน) แม้บัญชี session จะยังเป็น platform admin อยู่
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
  สร้าง `<table>_revisions`, trigger, RLS, grants; หน้า `/admin/revisions` ใช้ list/detail/compare) ·
  `7.15__bms_users_gender.sql` (`users.gender` — คำลงท้าย ครับ/ค่ะ ใน AI แนะนำคำตอบ; ดู § Gender particle) ·
  `7.16__drop_legacy_revision_triggers.sql` (ลบ trigger revision ระบบเก่าที่ชนกับ BMS revision — ดู § Revision trigger collision) ·
  `7.17__bms_store_profile_extend.sql` (เพิ่ม contact/branding/locale ใน store profile — ดู § ทูลชุด 2) ·
  `7.36__bms_failure_incidents.sql` (log เหตุการณ์ระบบขัดข้องที่กระทบลูกค้า + แจ้งร้าน/platform admin —
  ดู § Failure Incidents)
- **inbox: มอบหมาย staff** → `lib/bms/inbox.ts` (`pickAutoAssignee`/`autoAssignConversation`/`reassignStaffConversations`) — แชทใหม่ auto-assign ให้ Sales ที่ว่างและถือแชท OPEN/PENDING น้อยสุดก่อนเสมอ (fallback Manager → Administrator ถ้าร้านยังไม่มี Sales) · **ทุก conversation ต้องมี staff หลักเสมอ** — `deleteUser`/`deleteUsers` (`resolvers.ts`) เรียก `reassignStaffConversations()` โอนแชทค้างออกก่อนลบทุกครั้ง ห้ามลบ user ตรงๆ โดยข้ามขั้นตอนนี้ · ประวัติมอบหมาย/โอน/helper ใช้ `bms_audit_log` เดิม (target = conversation id, action `inbox.assign`/`inbox.helper_add`/`inbox.helper_remove`) ไม่ได้สร้างตาราง log ใหม่ · `inbox.assign` (โอน staff หลัก) แยกจาก `inbox.manage` (status/tags/notes) เพราะ Sales ต้องโอนแชทตัวเองได้โดยไม่ต้องมีสิทธิ์จัดการเต็ม · helper add/remove ใช้สิทธิ์ `inbox.reply` เดิม (ไม่ต้องสิทธิ์พิเศษ)
- **inbox: สายแชท + system event** → หน้าแชทรวม message + system event (`listSystemEvents` → `bmsConversation.systemEvents`) เรียงตามเวลาในสายเดียว: มอบหมาย/เพิ่ม-ถอดผู้ช่วยตอบ/เปลี่ยนสถานะ แสดงเป็นแถวกลางสีเทา + marker "เริ่มการสนทนา" หัวสาย (derive จาก `created_at`/ข้อความแรก ไม่ได้ log เพิ่ม) + date separator (วันนี้/เมื่อวาน/วันที่, timezone Asia/Bangkok) · `systemEvents` resolve ชื่อคนจาก UUID/email ใน `bms_audit_log` แล้ว (user ถูกลบ → "ผู้ใช้ที่ถูกลบ") · แท็บ Timeline เดิมเก็บไว้คู่กัน (รวม order history ที่ไม่ควรแทรกในแชท) — ดู § แท็บ Timeline ด้านล่าง · **Sales เห็นเฉพาะแชทของตัวเอง** (staff หลัก/ผู้ช่วยตอบ) — บังคับที่ `bmsConversations`/`bmsConversation` (`bmsInbox.ts`, `role === "Sales"`) · role อื่นเห็นทั้งร้าน
- **inbox: compact workspace + composer draft** → queue/header ลด font และ spacing เพื่อคืนพื้นที่ให้สายแชท, ตัด Chat Focus ออก, channel tag อยู่หลังชื่อลูกค้า ·
  **รอบ mockup "compact cards" (2026-08)**: คิวแชทเป็น *แถวเรียบคั่นด้วยเส้น* ไม่ใช่การ์ดมีขอบ/เงารายใบ
  (คอลัมน์ `padding: 0` ตอนกางอยู่ ส่วนหัวคิวถือ padding เอง เพื่อให้เส้นคั่นกินเต็มความกว้าง) · ลำดับใน
  หัวคิวคือ ค้นหา → แท็บสถานะ → chip ตัวกรอง · **ช่องค้นหาไม่มีปุ่มแล้ว** เป็น `Input` เดียวเต็มความกว้าง
  พร้อม debounce 300ms (`searchInput` → `search`) เพราะ `search` เป็น arg ของ `bmsConversations`
  ไม่ใช่ filter ฝั่ง table · **สวิตช์ "ของฉันเท่านั้น" กลายเป็น chip "ของฉัน"** ในแถวตัวกรองเดียวกับ
  ด่วนก่อน/มีสลิป/ถามสินค้า (เดิมเบียดช่องค้นหาให้เหลือครึ่งแถว) และ role Sales เห็น chip นี้แบบ disabled ·
  ช่องทางใช้ `CHANNEL_CHIP_STYLE` ชุดเดียวทั้งในคิวและหัวแชท (เลิกใช้ `Tag color={CHANNEL_COLOR}` สีทึบ
  ที่หัวแชท) · chip ใต้หัวแชทใช้ `TOOL_CHIP_BASE` เป็นเส้นขอบจางหมด ยกเว้น AI (ฟ้า) และ "ยังไม่ผูก CRM"
  (ส้ม) ที่ยังต้องเด่นเพราะต้องลงมือแก้ · พื้นสายแชทเป็น `--app-bg` (จมกว่าหัวแชท/composer ที่เป็น
  `--app-surface`) จึงเปลี่ยน bubble ลูกค้าเป็นพื้นการ์ด + เส้นขอบ แทนพื้นเทาทึบ ·
  **การ์ด "คำตอบแนะนำ" + placeholder (มือถือ, 2026-08)**: การ์ดเป็น `display:grid` คอลัมน์เดียว
  (หัว / ข้อความ / ปุ่ม) — **ห้ามกลับไปเป็น flex row ที่วางข้อความไว้ข้างกลุ่มปุ่ม** เพราะคอลัมน์ข้อความ
  เป็น `flex:1; min-width:0` (ยุบได้) แต่กลุ่มปุ่ม 3 อันยุบไม่ได้ → บนจอ ~360px ปุ่มไม่ตกบรรทัด ข้อความ
  ถูกบีบเป็นริบบิ้นแคบและหัวข้อตัด 2 บรรทัด (เคสจริงที่ผู้ใช้แคปมา) · ป้าย "AI แนะนำคำตอบ" + ปุ่มตา
  ยุบเข้ามาเป็นหัวการ์ดแล้ว (ประหยัด 1 แถว) เหลือแถบ `AI ถูกซ่อนอยู่` แยกไว้เฉพาะตอนปิด suggestion ·
  "ขอตรวจสอบ/ขอบคุณ" เป็น chip ขอบมน แยกน้ำหนักจากปุ่มหลัก เพราะเป็น template ของระบบ ไม่ใช่ข้อความ
  ที่ AI แนะนำ · placeholder ช่องพิมพ์: มือถือ `พิมพ์ตอบลูกค้า…` / เดสก์ท็อป `พิมพ์ตอบลูกค้า · Enter ส่ง`
  โดยคำอธิบายเต็มอยู่ใน **native `title`** ของ textarea (ไม่ใช้ antd `Tooltip` เพราะจะเด้งค้างระหว่างพิมพ์) ·
  **แถวตัวกรองด่วน/สลิป/สินค้า/ของฉัน แยกเป็น 2 กลุ่ม (2026-08)**: เดิม 4 chip อยู่ใน `Space wrap`
  เดียวกัน พอเพิ่ม "ของฉัน" เข้าไปทีหลัง (แทน Switch เดิม) ความกว้างรวมเกิน 320px ของคอลัมน์เสมอ →
  "ของฉัน" ตกไปแถวใหม่ลอยตัวเดียว. แก้โดยแยกเป็นสองกลุ่มคั่นเส้นบาง — กลุ่มซ้าย (ด่วนก่อน/มีสลิป/
  ถามสินค้า) เป็น `.bms-inbox-filter-strip` (`overflow-x:auto`, `flex-wrap` ไม่ใช้เลย, scrollbar ซ่อนด้วย
  CSS ใน `globals.css`) ส่วน "ของฉัน" ปักขวาสุดเสมอ ไม่อยู่ใน strip เดียวกัน เพราะเป็นคนละมิติ (กรอง
  เนื้อหาแชท vs. กรองเจ้าของแชท) ไม่ควรแย่งพื้นที่กัน · **บทเรียน JSX**: อย่าวางคอมเมนต์บล็อก `/* ... */`
  เป็น child แรกทันทีหลัง `{cond && (` — parser จะงงกับ `"` ในคอมเมนต์ (TS1109/TS1381) ต้องย้าย
  คอมเมนต์ไปไว้เหนือ `{cond && (` แทน ·
  **แยกปุ่ม "ผู้ช่วยตอบ" กับ "แท็ก" ออกจากกัน (2026-08)**: เดิม chip `{n} ผู้ช่วย` เป็น toggle เดียวเปิด
  แถวขยาย 1 แถวที่ยัดทั้งการจัดการผู้ช่วยตอบ (คน, สิทธิ์ `inbox.reply`) กับแก้แท็ก (ป้ายกำกับ, สิทธิ์
  `inbox.manage`) ปนกันไม่มีขอบเขต และดันความสูง header อยู่เสมอตอนกดขยาย. แก้เป็น **2 ปุ่ม chip แยก
  คนละ `Popover`** (`{helpers.length} ผู้ช่วย` กับ `{tags.length} แท็ก`, ปุ่มหลังโชว์เฉพาะ `canManage`
  เหมือน parity เดิม) — เนื้อหาใน popover เป็นโค้ดเดิมทั้งหมด ย้ายที่อยู่เฉยๆ ไม่แก้ mutation
  (`addHelper`/`removeHelper`/`saveTags`) · ลบ state `showHelperTags` ทิ้ง ใช้ `open` ของ Popover เอง
  (uncontrolled) แทน — ปิดอัตโนมัติเมื่อคลิกที่อื่น ไม่ต้อง state เพิ่มฝั่งเรา · ตอนปิดอยู่ไม่ดันความสูง
  header เลย (ต่างจากแถวขยายเดิม) ·
  **Customer 360 panel — หัวข้อค้าง/ชิปออเดอร์/Quick Actions (2026-08)**: 3 จุดใน
  `Customer360Panel.tsx`. (1) หัวข้อ "ข้อมูลลูกค้า (Customer 360)" + ปุ่มแจกคูปอง/ย่อแผง เดิมเป็น div
  ธรรมดาเลื่อนหายไปพร้อมเนื้อหา → เพิ่ม `position:"sticky", top:0, zIndex:2` + พื้น/เส้นขอบล่าง ปักไว้บน
  สุดของ scroll container เดิม (panel เดิม `overflowY:"auto"` อยู่แล้ว ไม่ต้องเพิ่ม container ใหม่)
  (2) ชิปช่องทาง/สถานะในการ์ด "ออเดอร์ล่าสุด" เดิมใช้ antd `<Tag color="...">` preset (ขอบ 4px, พื้น
  อิ่มสี) คนละสไตล์จากชิปที่ปรับใหม่ในหัวแชท → สร้าง `Pill`/`OutlinePill` component + `CHANNEL_PILL`/
  `STATUS_PILL` (rgba พื้นจาง 10-12%, rounded-999 เหมือน `TOOL_CHIP_BASE`ใน `page.tsx`) แทน
  `CHANNEL_COLOR`/`STATUS_COLOR` เดิม — ใช้ร่วมกัน 3 จุดในไฟล์นี้ (การ์ดออเดอร์ในลิสต์, ช่องทางปัจจุบันใน
  สรุปลูกค้า, บัญชีที่เชื่อมต่อใน contact, `OrderPreviewDrawer`) ไม่ทิ้งจุดใดจุดหนึ่งไว้ไม่ตรงกัน · การ์ด
  ออเดอร์พื้นเปลี่ยนจาก `#fff` ตรง ๆ → `var(--app-surface-2)` ให้เห็นขอบเขตการ์ดชัดโดยไม่ต้องมีเงา
  (3) `QuickActionsSection` เดิม 5 ปุ่ม `<Button block>` ทรงเดียวกันหมด ไม่มีลำดับความสำคัญ → สร้าง
  `QaButton` (icon วงกลม + label + chevron `RightOutlined`, ปุ่มแรก "สร้างออเดอร์" ได้ prop `primary`
  ยกพื้น/ตัวหนังสือให้เด่น) — logic สิทธิ์/`disabled`/`Tooltip` เดิมทั้งหมดยังอยู่ครบ (`can()` check,
  `hasRefundable`, `orders?.length`) แค่ย้าย `Tooltip` มาห่อ `QaButton` ตัวเดียวแทนสร้าง `Button disabled`
  คู่ขนาน 2 ทาง · **แก้รอยฉีก/เงาระหว่างเลื่อน (2026-08)**: panel ทั้งใบมี `position:"sticky", top:0`
  ของตัวเองอยู่แล้วก่อนหน้านี้ (ไม่เกี่ยวกับ sticky header ที่เพิ่มใหม่) แต่ parent (`.columns` ใน
  `page.tsx`) เป็น `overflow:"hidden"` ไม่มี scroll ให้ sticky นั้นยึดจริงเลย — พอซ้อนกับ sticky header
  ตัวใหม่ที่ยึดกับ panel เอง (ตัวที่ scroll จริง) กลายเป็น sticky ซ้อน sticky ผิดชั้น ทำให้ browser
  คำนวณ compositing layer พลาดจนเห็นรอยฉีก/ภาพซ้อนตอนเลื่อน. **แก้โดยลบ sticky ของ panel ทิ้ง** เหลือ
  แค่ sticky ของ header ตัวเดียว (เหตุผลเดียวกับที่มันไม่มีผลอะไรอยู่แล้วตั้งแต่แรก) — บทเรียน: ก่อนเพิ่ม
  `position:"sticky"` ให้ลูก ต้องเช็คว่า parent ไม่มี `position:"sticky"` ซ้อนอยู่แบบไม่มี scroll
  ancestor จริงด้วย · **แก้ "พื้นหลังไม่เต็ม" รอบ 2**: panel ทั้งใบไม่เคยมี `background` ของตัวเองเลย
  (พึ่งพื้นของ card/section ย่อยแต่ละอันเอาเอง) ช่องว่างระหว่าง section (เช่น margin ใต้ sticky header)
  จึงโปร่งใส เห็นสิ่งข้างหลังทะลุมาตอนเลื่อน → เพิ่ม `backgroundColor: var(--app-surface)` ให้ตัว panel
  เอง · sticky header เปลี่ยนจาก "sticky ในกรอบ padding 8 เดิม" (มีช่องเล็กๆที่มุมโค้งของ panel ไม่ถูก
  คลุมเพราะ header เป็นสี่เหลี่ยมมุมตรง) → ใช้ negative-margin trick มาตรฐาน (`margin:"-8px -8px 5px"`,
  `padding:"8px 8px 6px"`, `top:-8`) ให้ header คลุมเต็มถึงขอบ panel จริง ๆ + `borderRadius:"10px 10px 0 0"`
  ให้มุมบนโค้งตรงกับ panel ไม่มีช่องมุมโผล่ ·
  **ดูรูปในแชท — lightbox โปร่งแสง (2026-08)**: Modal เดิมเป็นการ์ดขาว/ไล่เฉดทึบเต็มพื้นที่ ปิดบังสายแชท
  ทั้งหมด, ปุ่มก่อนหน้า/ถัดไปเป็นวงกลมนอกภาพมีแค่เดสก์ท็อป (มือถือมีอีกชุดซ้อนในเงื่อนไข `isMobile`),
  และมีปุ่มปิดซ้ำกัน 2 อัน (native ✕ ของ antd `Modal` + ปุ่ม "ปิด" ที่สร้างเอง เพราะไม่ได้ตั้ง
  `closable={false}` ไว้). แก้เป็น scrim เข้มโปร่งแสง + เบลอ (`background:"rgba(8,13,24,0.72)"`,
  `backdropFilter:"blur(6px)"` ที่ `styles.content`) ให้เห็นสายแชทเลือน ๆ อยู่ข้างหลัง ·
  `closable={false}` เหลือปุ่มปิดทางเดียวเป็นไอคอน ✕ ลอย (ไม่ใช่ปุ่มข้อความ "ปิด" แบบเดิม — Esc/คลิกนอก
  modal ยังปิดได้เหมือนเดิมผ่าน `onCancel`) · ปุ่มก่อนหน้า/ถัดไปลอยข้างรูปแบบเดียวกันทุกขนาดจอแล้ว
  (ตัดโค้ดซ้อนที่เคยแยก `isMobile`/ไม่ใช่ `isMobile` ทิ้ง) · **ตัด caption/thumbnail ทิ้งตามที่ขอ** —
  ไม่โชว์ `body`/ข้อความประกอบรูปอีก เหลือผู้ส่ง+เวลาเป็น chip เล็กลอยมุมล่างซ้ายของรูปพอ (ไม่ใช่การ์ด
  แยกเหมือนเดิม) ปุ่ม "เปิดไฟล์" ก็เหลือแค่ไอคอนไม่มี label ข้อความ · `chatImages`/`movePreview`/
  `imagePreviewIndex` ใช้ของเดิมทั้งหมด ไม่เพิ่ม state ใหม่ ·
  ปุ่ม "เปิดออเดอร์" ใน Customer 360 เปิด `OrderPreviewDrawer` โดยไม่ออกจากแชท และ "เปิดหน้า Orders เต็มจอ" เปิดแท็บใหม่ · composer ยังคง data model เดิม (`body` + attachment เดียว) แต่รูป/ไฟล์ที่อัปโหลดจะเข้า draft ก่อนส่งและมี preview/ปุ่มนำออก; loading ของรูปกับไฟล์แยกกัน · message renderer แยก 4 แบบ: text = bubble สีตาม sender, image = light preview card, file = icon/name/type/download card, product = cover/name/SKU/ราคา/สต็อก/`ดูสินค้า` card; attachment/product card เป็น rounded rectangle ไม่มีหางหรือ pseudo-element ยื่นออกนอกกรอบ ใช้ accent border ด้านข้างบอกทิศทางแทน · product ตรวจจาก public URL ใน body จึง render ข้อความเดิมได้โดยไม่เปลี่ยน channel payload · product picker ใช้ `bmsProducts` และให้เลือก "ข้อความ + ลิงก์" หรือ "ข้อความ + รูป + ลิงก์" โดยใส่ชื่อ/SKU/ราคา/ไซซ์+สต็อกและ public URL `/shop/{tenantSlug}/products/{sku}` ลง draft; แบบมีรูปใช้ cover `imageUrl` เป็น attachment เดียว ส่วน gallery ทั้งหมดอยู่หน้า public · ลิงก์ `/admin/products` ยังเป็น internal link เปิดแท็บใหม่เท่านั้นและห้ามใส่ลงข้อความลูกค้า
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
- **support tickets** → `/support` เป็นฟอร์มสาธารณะที่เขียนลง `support_tickets` แล้ว และ
  `/admin/support-tickets` เป็นมุมของ platform admin สำหรับอ่าน/เปลี่ยนสถานะ/ใส่ internal comment
  โดย `support_ticket_comments` เก็บ status trail + note history; fake seed route อยู่ที่
  `/api/dev/fake/support-tickets`
- **batch & cron ops** → `/admin/operations-schedule` ใช้ดู batch/cron ทุกตัวแบบอ่านง่ายว่ารันเมื่อไร
  ทำอะไร และมีไว้เพื่ออะไร เพื่อไม่ต้องเดาว่ารันวันนี้แล้วหรือยัง
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

## แท็บ Timeline ของแชท — แก้ข้อมูลให้ตรงความจริง (2026-07)

**แก้แล้ว** — แท็บ Timeline (`bmsConversationTimeline` → `getTimeline()` ใน `lib/bms/inbox.ts`) เคย
แสดงข้อมูลที่ "อ่านได้แต่ไม่จริง" หลายจุด:

- **บั๊กหลัก: แถว ORDER ใช้ `created_at` เป็นเวลา แต่พิมพ์ `status` ปัจจุบันในข้อความเดียวกัน** →
  อ่านออกมาเป็น "ออร์เดอร์ SHIPPED เวลา 21:26" ซึ่งเวลานั้นคือตอน **สร้าง** ออร์เดอร์ (ยัง `PENDING`).
  แก้เป็น text = `สร้างออร์เดอร์ · ยอดเงิน` และแยกสถานะปัจจุบันไป field ใหม่ `status`/`statusAt`
  (`updated_at` ของแถว) ให้ UI ติดป้ายว่า "สถานะปัจจุบัน" · **ถ้าต้องการเส้นเวลาการเปลี่ยนสถานะจริง
  ให้ใช้ `getOrderJourney()` ที่อ่าน `bms_audit_log` อยู่แล้ว ไม่ต้องเขียนใหม่ใน timeline**
- **ออร์เดอร์ join ด้วย `customer_id` ไม่ใช่ `conversation_id`** (ต่างจาก message/note) → ออร์เดอร์
  ช่องทางอื่นของลูกค้าคนเดียวกันโผล่ในแชทนี้ด้วยโดยไม่มีอะไรบอก. ไม่เปลี่ยน scope (ตั้งใจให้เห็นข้ามช่องทาง)
  แต่คืน `channel` มาให้ UI ติดแท็ก + เขียน "(ช่องทางอื่น)" เมื่อ `t.channel !== conv.channel`
- **ข้อความรูป/ไฟล์ล้วนเคยเป็นแถวว่าง** (`body` ว่างได้จริงตามคอมเมนต์ที่ `sendStaffMessage`) →
  แยก `messagePreview(body, attachment)` ออกมาเป็น export ใน `inbox.ts` ใช้ร่วมกันทั้ง preview คิวแชท
  (จุดเดิมที่มี logic นี้ inline) และ timeline
- **ASSIGN เคยโชว์ actor ดิบ (UUID/email)** ทั้งที่ `listSystemEvents()` resolve ชื่อให้แล้ว →
  เลิก query `bms_audit_log` ซ้ำใน `getTimeline` แล้วเรียก `listSystemEvents()` ตรง ๆ (ได้ event
  `inbox.status` ติดมาด้วยเป็นของแถม → type ใหม่ `STATUS`)
- **query ไม่มีเพดาน** → `TIMELINE_MAX_PER_SOURCE = 200` ต่อแหล่ง (ORDER BY DESC LIMIT = เอาใหม่สุด
  แล้วค่อย sort ขึ้น) + arg `limit` ที่ resolver (clamp ไม่ให้เกินเพดาน)
- **sort ไม่เสถียร** (เทียบ `at` เดี่ยว ๆ) → tie-break ด้วย `type` แล้ว `ref`
- **UI ใช้ `toLocaleString()` เปล่า ๆ** → ได้ "7/22/2026, 1:23:08 AM" ตาม locale เบราว์เซอร์ ขณะที่คิวแชท
  ข้าง ๆ เป็น `22 ก.ค. 2569 · 01:25`. เปลี่ยนมาใช้ `dayKey`/`dayLabel`/`timeLabel` (Asia/Bangkok) ที่ไฟล์
  นี้มีอยู่แล้ว + date separator วันนี้/เมื่อวาน แบบเดียวกับสายแชท + map ป้ายไทย `TIMELINE_TYPE`
- **ไม่มี migration** (ใช้คอลัมน์เดิมทั้งหมด: `bms_orders.channel/status/updated_at`,
  `bms_messages.meta.attachment`) และ **ไม่มี permission ใหม่** (`inbox.view` เดิม)
- order id ในแถว ORDER เป็น `Typography.Text code copyable` (คืน `entityId` เต็มมาให้ copy) — **ไม่ได้ทำ
  deep link** เพราะ `/admin/orders` ยังไม่อ่าน query param ของ order เลย และ `OrderPreviewDrawer` เป็น
  component ภายใน `Customer360Panel.tsx` (ไม่ได้ export) — ถ้าจะทำลิงก์จริงต้องแตะสองไฟล์นั้นก่อน
- **ยังไม่มี**: payment/shipment event ในแท็บนี้ (ลูกค้าพิมพ์ "โอนเงินแล้ว" แต่ timeline ไม่มีแถว payment
  เลย) — ของแบบนั้นอยู่ใน `getCustomerTimeline()` ของ Customer 360 panel คนละตัวกัน ถ้าจะเพิ่มควร reuse
  service เดิมไม่ query ใหม่

**รอบ 2 (2026-07) — ทำให้ "อ่านเป็นเส้นเวลา" จริง (UI-only + text ของแถว ORDER):**

- **ข้อความแถว ORDER ซ้ำกับป้าย** — เดิม `text` = `สร้างออร์เดอร์ · 1,200 ฿` ขณะที่ tag ข้าง ๆ ก็เขียน
  "สร้างออร์เดอร์" อยู่แล้ว → เหลือแค่ยอดเงิน (`toLocaleString("th-TH")`, เป็นยอด**สุทธิหลังหักส่วนลด**
  ตาม `total_amount`) ป้ายชนิดเหตุการณ์ทำหน้าที่บอกว่าเป็นการสร้างออร์เดอร์เอง
- **เปลี่ยนจาก `List` เป็นเส้นเวลาจริง** — rail เส้นเดียว + จุดต่อเหตุการณ์: `TIMELINE_DOT` ตามชนิด แต่แถว
  ORDER ใช้ `ORDER_STATUS_DOT` ตามสถานะปัจจุบัน (รอ=เหลือง, กำลังดำเนินการ=เขียว, สำเร็จ=teal, ยกเลิก=แดง)
  → กวาดตาเห็นได้ทันทีว่าออร์เดอร์ไหนค้าง · ป้าย "สถานะปัจจุบัน:" ยาวเกินไปในบรรทัดเดียว เปลี่ยนคำเป็น
  "ตอนนี้:" (ความหมายเดิม — ยังไม่ใช่เวลาในคอลัมน์ `at`)
- **ตัวกรอง `ทุกเหตุการณ์ / แชทนี้เท่านั้น`** (Segmented, state ในคอมโพเนนต์) — "แชทนี้เท่านั้น" = ซ่อนแถว
  ORDER ที่ `channel` ต่างจากแชทนี้ (ออร์เดอร์ scope ตามลูกค้า ไม่ใช่ตามแชท) · **filter ฝั่ง client จาก data
  ชุดเดิม ไม่ยิง query ใหม่** และไม่แตะ resolver — สลับกลับไปกลับมาได้ฟรี
- **`key` ของแถว** — เดิม map ด้วย `<>` ไม่มี key (React warning + reconcile เพี้ยนตอน filter) → ใช้
  `type`-`at`-`ref` · เพิ่ม `Empty` ตอนโหลดแล้วไม่มีเหตุการณ์ (เดิมเป็นพื้นที่ว่างเปล่า แยกไม่ออกจาก
  "ยังไม่ได้โหลด")
- **แถบท้าย** บอกจำนวนเหตุการณ์ที่แสดง + จำนวนที่ซ่อน (โหมด "แชทนี้เท่านั้น") + เตือน "ถึงเพดานการแสดงผล"
  และมีปุ่มรีเฟรช (โหลดซ้ำ query เดิม) · `TIMELINE_MAX_PER_SOURCE = 200` ถูก **hardcode ซ้ำในหน้า
  page.tsx** เพราะ `lib/bms/inbox.ts` import `@/lib/db` — client component ดึงค่าตรงไม่ได้ · แก้เพดาน
  ต้องแก้สองที่

## Customer 360 (Inbox right panel)

รายละเอียดเต็ม (read APIs, Quick Actions APIs, schema `6.2`, component structure, "ตะกร้า" interpretation,
fulfillment address guard, pending improvements) อยู่ที่ [docs/ui/customer360.md](docs/ui/customer360.md)

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

## AI Provider Health (2026-07)

**เสร็จแล้ว** — ก่อนหน้านี้ถ้า `ANTHROPIC_API_KEY`/`DEEPSEEK_API_KEY`/`QWEN_OCR_API_KEY` ใช้ไม่ได้ไม่ว่า
กรณีไหน (key หมดอายุ/rate limit/quota เกิน/network ล่ม/model ถูก deprecate) ระบบจะ **fail แบบเงียบ ๆ
เสมอ** — แชทลูกค้าตกไปเป็น template ตายตัว ([ai.ts](../apps/web/lib/bms/ai.ts)), OCR สลิปตกไปเป็น
"ต้องตรวจสอบด้วยมือ" ([payments.ts](../apps/web/lib/bms/payments.ts)) — ทีมงานจะรู้ก็ต่อเมื่อลูกค้าบ่น
หรือบังเอิญเปิด `/admin/env` เอง ไม่มีระบบแจ้งเตือนอัตโนมัติเลย แก้โดยสร้างระบบแบบเดียวกับ
§ Channel Health ด้านบนแต่สำหรับ shared AI provider แทนช่องทางแชท:

- **schema** → migration `7.34__bms_ai_provider_health.sql`: ตารางใหม่ `bms_ai_provider_health`
  (composite PK `(provider, purpose)` เพราะ provider เดียวรับใช้ได้มากกว่า 1 purpose เป็นอิสระต่อกัน —
  เช่น Anthropic ใช้ได้ทั้ง `chat` tool-calling และ `ocr` ถ้า `BMS_SLIP_READER_PROVIDER=anthropic`)
  seed ไว้ 4 แถวเริ่มต้น (`anthropic/chat`, `deepseek/chat`, `anthropic/ocr`, `qwen/ocr`) สถานะ
  `unconfigured` + `bms_ai_provider_health_log` (ประวัติเปลี่ยนสถานะ, เขียนเฉพาะตอนเปลี่ยนจริง) ·
  **ไม่มี `tenant_id`/RLS** (ตาม convention เดียวกับ `bms_plans`) เพราะเป็นสถานะ key กลางของแพลตฟอร์ม
  ไม่ใช่ข้อมูลของร้านใดร้านหนึ่ง — **ไม่ track BYOK ของแต่ละร้านเลย** (ตั้งใจ, เพราะ key ของร้านเองพังเป็น
  ปัญหาของร้านนั้น ไม่ใช่สัญญาณว่า "Claude/DeepSeek ล่ม" ระดับแพลตฟอร์ม)
- **service** → `lib/bms/aiProviderHealth.ts` — entrypoint เดียวคือ `setAiProviderStatus()` (log เฉพาะ
  ตอนเปลี่ยน) + `recordProviderSuccess()`/`recordProviderError()` (แกะ HTTP status จาก error message
  ด้วย regex `/(?:API|HTTP)[^\d]{0,10}(\d{3})/i` เพราะ error message ที่มีอยู่แล้วทั้ง 3 จุด format
  เป็น `"<provider> API <status>"` หรือ `"... (HTTP <status>)"` อยู่แล้ว ไม่ต้องแก้ error object เดิม
  ให้มี field `httpStatus` แยก — map 401/403→`token_expired`, 429→`rate_limited`, อื่นๆ→`send_failed`) +
  `listAiProviderHealth()`/`countUnhealthyAiProviders()`
- **จุดเดียวที่ wire เข้าจริง คือ `finalizeAiUsageEvent()`** (`aiUsage.ts`) — เพราะทุก shared-key call
  ทั้งแชท (`ai.ts` generateResponse, `tools/runtime.ts` tool loop) และ OCR (`payments.ts`
  verifyPaymentSlip) **จบงานผ่านฟังก์ชันนี้อยู่แล้วทั้งหมด** จึง hook จุดเดียวพอ ไม่ต้องกระจายไปแก้ 3
  catch block แยก (ต่างจาก feature "order status email" ก่อนหน้าที่ order เปลี่ยนสถานะได้จากหลายจุดจริง
  — เคสนี้ทุกอย่างไหลผ่านจุดเดียวจริง ๆ จึง hook แบบรวมศูนย์ได้) · เช็ค `source = 'shared'` ก่อนเสมอ (ข้าม
  BYOK) และข้าม status `'fallback'` (ใช้กับเหตุผลอื่นที่ไม่ใช่ provider ล่ม เช่น `quota_exhausted`/
  `no_credentials`/`max_rounds_exceeded`/`slip image unavailable`) · purpose derive จาก
  `feature === 'payment_slip_ocr' ? 'ocr' : 'chat'` (ยังมี OCR feature เดียวในระบบตอนนี้)
- **ปุ่ม "ทดสอบ" เดิมใน `/admin/env` ก็เขียนสถานะจริงไปในตัว** — แก้
  `testAnthropicCompatibleSharedProvider()`/`testQwenOcrKey()` ใน `aiConfig.ts` ให้เรียก
  `recordProviderSuccess()`/`recordProviderError()` เป็น side effect (เหมือน `testChannelConnection()`
  เดิมของ Channel Health) — ไม่ต้องเขียน test logic ซ้ำสำหรับ cron เพราะ reuse ฟังก์ชันเดิมได้เลย
- **`anthropic-ocr` เป็นแค่ test-selector string ไม่ใช่ identity แยกใน DB** — `testPlatformAiKey()`
  (`aiConfig.ts`) รับ 4 ค่า: `anthropic`/`deepseek` → `testAnthropicCompatibleSharedProvider()`,
  `qwen` → `testQwenOcrKey()`, และ `anthropic-ocr` (ใหม่) → `testAnthropicOcrKey()` — แต่ทั้ง
  `testAnthropicOcrKey()` ก็ยังเรียก `recordProviderSuccess/Error("anthropic", "ocr", ...)` เหมือนเดิม
  ไม่มีแถวใหม่ใน `bms_ai_provider_health`, `AiProviderName` ยังเป็น 3 ค่า (`anthropic`/`deepseek`/`qwen`)
  ตารางยังมีแค่ 4 แถวเดิมจาก `7.34` (ทำแบบนี้เพราะ Anthropic ทำหน้าที่ `chat` กับ `ocr` เป็นคนละ endpoint/
  system prompt กัน จึงอยากมีปุ่มทดสอบแยกให้ตรงกับ path จริงที่ `BMS_SLIP_READER_FALLBACK_PROVIDER`
  ใช้ แต่ไม่คุ้มจะเพิ่ม provider identity ใหม่ใน schema แค่เพื่อปุ่มทดสอบ)
- **`stale` status ใหม่ — derive ตอนอ่านเท่านั้น ไม่เขียนลง DB** (`aiProviderHealth.ts`) —
  `listAiProviderHealth()` เช็ค `status === 'connected' && isStale(last_checked_at)` แล้ว override
  เป็น `'stale'` ก่อนคืนออกไป (CHECK constraint ของ `7.34` ไม่มี `'stale'` เลยด้วยซ้ำ ยืนยันว่าคอลัมน์จริง
  ไม่เคยเก็บค่านี้) ควบคุมด้วย env `BMS_AI_HEALTH_STALE_MINUTES` (default 60 นาที ถ้าไม่ตั้ง/ตั้งค่าไม่ถูก)
  ผ่าน `staleAfterMinutes()`/`isStale()` — เหตุผลที่ต้องมี: แถวที่เคย `connected` แต่ไม่มีทั้ง traffic จริง
  และไม่มีใครกดปุ่มทดสอบมานานจะค้างโชว์ "เชื่อมต่อสำเร็จ" ทั้งที่ไม่รู้จริงว่ายังใช้ได้อยู่ไหม —
  `countUnhealthyAiProviders()` นับ `stale` รวมเป็น unhealthy ด้วย (query เช็ค `last_checked_at` เกิน
  threshold ตรงๆ ไม่ได้พึ่งค่าที่ derive จาก `listAiProviderHealth()`)
- **cron ใหม่ `POST /api/bms/ai/check-health`** (gate `x-cron-secret` = `BMS_CRON_SECRET` แบบเดียวกับ
  `/api/bms/channels/check-health`) เรียก `testPlatformAiKey()` ครบทั้ง 4 test-selector
  (`anthropic`/`anthropic-ocr`/`deepseek`/`qwen`) — **ต่างจาก Channel Health ตรงที่ AI provider ไม่มี
  traffic สม่ำเสมอพอจะรู้ว่าล่มจาก event จริงได้เร็ว จึง "ยิงทดสอบจริง" เป็นระยะแทนที่จะรอ** (DeepSeek/Qwen
  ทดสอบด้วย request จริงมี usage เล็กน้อยจริง ไม่ใช่ ping เปล่า ๆ แบบ Anthropic `/v1/models` — แนะนำตั้ง
  cron รายชั่วโมงพอ ไม่ต้องถี่กว่านั้น) — **ยังไม่ได้ตั้ง cron schedule จริง** (เหมือน Channel Health เดิม
  ที่ก็ยังไม่ได้ตั้ง — endpoint พร้อมแล้วแค่ยังไม่มีตัวยิงอัตโนมัติ) · comment เดิมใน `aiProviderHealth.ts`
  ที่อ้าง `checkAiProviderHealthNow()` เป็นชื่อฟังก์ชันที่ไม่มีจริง (ของจริงคือ cron เรียก
  `testPlatformAiKey()` ตรงๆ ต่อ provider) — แก้ comment ให้ตรงกับโค้ดจริงแล้ว
- **GraphQL** → `bmsAiProviderHealth`/`bmsAiProviderHealthCount` ใน `graphql/bmsAiConfig.ts` gate ด้วย
  `requirePlatformAdmin()` (platform-wide ไม่ใช่ tenant-wide จึงไม่ใช้ `requireTenantAdmin()` แบบ
  Channel Health) · **UI**: การ์ด "AI Provider Health" ใหม่ในหน้า `/admin/env` (ตาราง status/detail/
  last success/last error/last checked) + badge sidebar ที่เมนู "ENV" (poll
  `bmsAiProviderHealthCount` ทุก 60s, `skip` ถ้าไม่ใช่ platform admin, ส่ง `effectiveCollapsed` เสมอกัน
  บั๊กเดิมที่เจอกับเมนู Users)
- **ปุ่ม "ตรวจสอบทั้งหมดตอนนี้" (มือถือแทน cron ที่ยังไม่ได้ตั้ง schedule)** — mutation ใหม่
  `bmsCheckAllAiProviderHealth` (`bmsAiConfig.ts`) เรียก `testPlatformAiKey()` ครบทั้ง 4 test-selector
  พร้อมกันด้วย `Promise.allSettled` (ตัวหนึ่งพังไม่ทำให้ตัวอื่นไม่ถูกทดสอบ) แล้วคืน
  `listAiProviderHealth()` ล่าสุดให้ client เอาไปอัปเดต state ของตารางตรง ๆ — **แก้ gap ที่เคยมีว่าตาราง
  ไม่ auto-refresh หลังกดทดสอบ** โดยไม่ต้องแปลงทั้งหน้าเป็น client-side polling query, แค่จุดเดียวนี้พอ ·
  ปุ่มนี้ยิง request จริงไปหา provider ทุกครั้งที่กด (มี usage เล็กน้อยจริง ไม่ใช่ read-only refresh — เขียน
  เตือนไว้ในข้อความใต้การ์ดด้วย)
- **verify แล้วจริงกับ DB/API จริงบนเครื่องนี้** (ไม่ใช่แค่ `tsc`/`build` ผ่าน) — apply migration `7.34`
  เข้า docker postgres จริง, เรียก `testPlatformAiKey()` ด้วย credential จริงใน `.env.dev` สำเร็จหมด
  (`anthropic/chat`→connected, `deepseek/chat`→connected, `qwen/ocr`→connected, `anthropic/ocr` ยังคง
  `unconfigured` ถูกต้องเพราะ `BMS_SLIP_READER_PROVIDER=qwen`), ทดสอบ error classification ด้วย message
  สังเคราะห์ (401→`token_expired`, 429→`rate_limited`) ก่อน restore กลับเป็น `connected` จริง, และจำลอง
  resolver logic ของ `bmsCheckAllAiProviderHealth` ตรง ๆ (ยิงทุก provider พร้อมกันแล้วอ่าน health กลับ)
  ยืนยันผลถูกต้องครบ — **ยังไม่ได้ทดสอบผ่านเบราว์เซอร์จริง** (ไม่มี credential ล็อกอิน platform admin
  ของเครื่องนี้ให้ทดสอบ UI/ปุ่ม/badge ตรง ๆ แต่ query/mutation/service ที่ UI เรียกใช้ตรวจสอบแล้วว่าทำงาน
  ถูกต้องทั้งหมด) — **`anthropic-ocr`/staleness ยังไม่ได้ verify กับ DB/API จริงแบบเดียวกัน** (เขียนโค้ด/
  แก้ doc รอบนี้เท่านั้น ยังไม่ได้รันซ้ำแบบตอน `7.34`)
- **ยังไม่ทำ**: ไม่ track BYOK ของแต่ละร้าน (ตั้งใจ, ดูเหตุผลด้านบน) · ไม่มี proactive notification
  ออกนอกแอพ (LINE/Slack) เมื่อ provider ล่ม — เหมือน Channel Health เดิม เห็นได้แค่ตอนเปิด `/admin/env`
  หรือดู badge sidebar เท่านั้น · ยังไม่ได้ตั้ง cron schedule จริงให้ endpoint ยิงอัตโนมัติ (ปุ่ม
  "ตรวจสอบทั้งหมดตอนนี้" เป็นทางเลือกมือถือเท่านั้น ไม่ใช่ automation จริง)

## Failure Incidents — แจ้งร้าน + platform admin เมื่อระบบขัดข้อง (2026-07)

**เสร็จแล้ว** — ต้นเรื่อง: ลูกค้าจริงในร้านลุงโตได้ `"ขออภัยค่ะ ระบบขัดข้องชั่วคราว"` 3 ครั้ง
ข้ามวัน (11:29 น. และ 18:46 น.) โดย **ไม่มีใครรู้เลย** — ต้นเหตุจริงคือ production DB ยังไม่ได้
apply migration `7.35` (`column "provider" does not exist` ตอนอ่าน `bms_tenant_ai_config`) ซึ่ง
**AI Provider Health จับไม่ได้ตามการออกแบบ** เพราะเป็น Postgres schema error ไม่ใช่ provider ล่ม
(ตาราง `bms_ai_provider_health` ขึ้น CONNECTED ครบทั้ง 4 แถวในเวลาไล่เลี่ยกัน):

- **schema** → migration `7.36__bms_failure_incidents.sql` — `bms_failure_incidents` เป็น log
  **ราย occurrence (append-only แบบ `bms_audit_log`)** ไม่ใช่ตารางสถานะ 1 แถวต่อ provider แบบ `7.34`
  เพราะคำถามที่ต้องตอบคือ "แชทไหนได้รับผลกระทบ" (ร้านต้องตามลูกค้ากลับทีละราย) ไม่ใช่ "ตอนนี้พังอยู่ไหม"
  · `conversation_id` **ไม่ผูก FK โดยเจตนา** — incident ต้องบันทึกได้แม้ resolve conversation ไม่สำเร็จ
  (ซึ่งตัวมันเองก็เป็นสาเหตุความล้มเหลวที่จะแจ้ง) และแม้แชทถูกลบไปแล้ว · RLS/grant copy จาก `6.1`/`7.18`
- **service** → `lib/bms/failureAlert.ts` (`reportBmsFailure()`) — ไม่ throw ทุกกรณี
- **tier แยกผู้รับ**: `A` = ลูกค้าได้รับผลกระทบจริง (เห็น error **หรือไม่ได้รับคำตอบเลย**) → ร้าน
  (Administrator/Manager + staff หลักของแชทนั้น) + platform admin · `B` = ระบบยังตอบได้แต่คุณภาพลด →
  platform admin เท่านั้น (ร้านแก้เองไม่ได้ แจ้งไปเป็น noise) · **tier A ที่เกิดบน staff surface ถูก
  ลดเป็น B อัตโนมัติ** (`resolveTier`) เพราะแอดมินเห็น error ในหน้า `/admin/assistant` ของตัวเองอยู่แล้ว
- **⚠️ ห้าม hook จาก `outcome` ของ `auditAttempt()`** แม้จะเป็นจุดที่ทูลทุกตัว (ทั้ง model-selected และ
  `runApprovedTool`) ไหลผ่านจริง — เพราะ `outcome === "error"` **รวม 3 กรณีที่ต่างกันสิ้นเชิง**: ทูล throw
  exception จริง / `ToolArgError` จาก args ที่ model ส่งผิด (model retry เองได้) / ทูลคืน `{ok:false}`
  ตามเหตุผลทางธุรกิจ เช่น `"ไม่พบสินค้า"` → ถ้า hook จาก outcome จะแจ้งเตือนทุกครั้งที่ลูกค้าถามหาสินค้าที่
  ร้านไม่มี. จุดที่ถูกคือ **ข้าง `console.error` เดิม** ซึ่งมีเงื่อนไข
  `if (!(err instanceof ToolArgError) && !denied)` กรองไว้ถูกแล้ว
- **ไม่ hook `!executed.result.ok` ใน `pipeline.ts`** (5 จุด deterministic route) เพราะ
  `runApprovedTool` catch แล้วแบน exception เป็น `{ok:false}` ไปแล้ว → รายงานที่ runtime layer จุดเดียว
  ครบกว่า และไม่ double-report/ไม่แจ้ง business error
- **cooldown ต่อ `(tenant_id, code)` ไม่ใช่ threshold** — `maybeAlertSlackForLog()`
  (`lib/log/alertSlackServer.ts`, ของแอป legacy ไม่มี `tenant_id` เลย จึงแจ้งร้านไม่ได้) ใช้ "3 ครั้งใน
  10 นาที" ซึ่ง **จับเคสจริงนี้ไม่ได้เลย** เพราะ error ห่างกัน 7 ชั่วโมง · default 30 นาที ปรับด้วย
  `BMS_FAILURE_ALERT_COOLDOWN_MINUTES` · อ่าน cooldown จากตารางเดิม (`MAX(notified_*_at)` + bound
  `created_at` ที่มี index) จึงไม่ต้องมีตาราง dedupe แยกแบบ `slack_alert_dedupe`
- **`withTimeout()` 5 วิ ครอบขั้นตอนแจ้งเตือน — จำเป็นจริง ไม่ใช่กันไว้เฉย ๆ**: ตัวเรียก `await`
  (กันการแจ้งเตือนหลุดตอน request จบ) ซึ่งลาก `createNotification()` → `pubsub.publish` → **Redis**
  เข้ามาอยู่บน critical path ของการตอบลูกค้า · เจอจริงตอน verify: รันสคริปต์จาก host ที่ต่อ Redis ไม่ได้
  → **ค้างค้างยาวจนต้อง kill** (แถว incident ถูกเขียนไปแล้ว) · หลังใส่ timeout: จบใน ~30 วิ, log
  `shop/platform notification timed out after 5000ms`, **แถว incident ยังถูกบันทึกครบ** และ
  `notified_*_at` ยังเป็น NULL → ไม่ไปเริ่ม cooldown ทับ (fail ไปทาง "แจ้งซ้ำ" ดีกว่า "เงียบ")
  · แยก `try` ต่อผู้รับ: ฝั่งหนึ่งพัง อีกฝั่งยังได้รับแจ้ง
- **`reportFailure` อยู่ใน `ToolLoopTestDeps` seam ด้วย** — ไม่งั้น `runtime-contract.test.mts` ที่ระบุว่า
  "ไม่ต่อ network/DB" จะแอบเขียน `bms_failure_incidents` จริงทุกครั้งที่ทดสอบ path ความล้มเหลว
- **UI** → `components/GlobalFailureNotifier.tsx` (mount ใน `app/SessionLayer.tsx` คู่กับ
  `GlobalMentionNotifier`) — **ไม่เช็ค `can("inbox.view")` ต่างจาก GlobalMentionNotifier** เพราะผู้รับถูก
  เลือกไว้แล้วตอนสร้าง notification ถ้าเช็คซ้ำ platform admin ที่ไม่มีสิทธิ์ในร้านนั้นจะไม่ได้รับแจ้ง ·
  ฝั่งร้านคลิกไป `/admin/inbox?c=<id>`, platform admin ไป `/admin/env` (ไป Inbox ร้านอื่นตรง ๆ ไม่ได้
  เพราะยังไม่ได้ drill-down `BMS_ACT_TENANT`)
- **verify กับ DB จริงบนเครื่องนี้แล้ว** (ไม่ใช่แค่ `tsc`): apply `7.36` เข้า docker postgres + รันซ้ำ
  ยืนยัน idempotent · รัน `reportBmsFailure()` จริงในคอนเทนเนอร์ ยืนยันครบ 4 พฤติกรรม — tier A ได้ทั้ง
  `bms_failure` (ร้าน) + `bms_failure_platform`, ยิง code เดิมซ้ำทันทีถูก cooldown กรอง, tier B ไม่แจ้งร้าน,
  tier A บน staff surface ถูกลดเป็น B · `runtime-contract.test.mts` ผ่าน 33/33 และไม่เขียน incident row
  · **ยังไม่ได้ทดสอบผ่านเบราว์เซอร์จริง** (browser notification/คลิก deep-link)
- **ยังไม่ทำ**: ไม่มีหน้า list incident (`/admin/env` ยังไม่มีการ์ดนี้) — ตอนนี้เห็นผ่าน browser/bell
  notification + Slack + query DB ตรงเท่านั้น · ไม่ส่งอีเมล (`store_profile.contact_email`) และไม่ส่ง LINE
  หาเจ้าของร้าน (ยังไม่มี field admin LINE user id — gap เดิมเดียวกับ § Channel Health) · Slack ใช้
  `SLACK_WEBHOOK_URL` เดิม ถ้าไม่ตั้งก็ข้ามเงียบ ๆ · **ยังไม่ครอบ webhook ช่องทางอื่น** (wire แล้วเฉพาะ
  LINE — Facebook/Instagram/TikTok/Shopee/Lazada ยังไม่เรียก `reportBmsFailure`) · ไม่ได้แทนที่
  § Channel Health / § AI Provider Health (คนละมิติ: ตารางนั้นคือ "สถานะการเชื่อมต่อ" ตารางนี้คือ
  "เหตุการณ์ที่กระทบลูกค้าไปแล้ว") — proactive notification ของ *status transition* ยังไม่ได้ทำ

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
`products`, `orders`, `payments`, `shipments`, `purchase` (หัว PO), `purchaseItems` (รายการใน PO):

- รัน `7.0__bms_revision_helpers.sql` ก่อนเสมอ แล้วค่อยรันไฟล์ revision ราย batch/รายตารางที่ต้องการ
  (`7.1`–`7.14`) — helper จะสร้าง `<table>_revisions`, trigger, RLS policy, และ grant ให้ `bms_app`
- revision เก็บ snapshot ของแถว **ก่อน UPDATE** เท่านั้น; แถวเก่าก่อนเปิด trigger จะไม่มี revision ย้อนหลัง
- `beginTenantTx(client, tenantId, { editorId })` จะ set `bms.tenant_id`, `app.editor_id`, และ
  `app.revision_id`; ถ้าไม่ส่ง `editorId` หน้า Revision History จะแสดง editor เป็น `system`
- ตอนนี้ product/inventory mutations ส่ง `auth.author_id` แล้ว จึงเห็น email/name ของ admin login ในคอลัมน์
  Editor ผ่าน GraphQL `bmsRevisionHistory`/`bmsRevisionDetail`
- **Purchase (ซื้อ) — เพิ่ม kind ให้ดูได้แล้ว (2026-07)**: trigger ของ `bms_purchase_orders`/
  `bms_purchase_order_items` มีมาตั้งแต่ `7.2`/`7.9`/`7.10` (บันทึกจริงทุกครั้งที่ `receivePurchaseOrder()`/
  `cancelPurchaseOrder()` ทำ UPDATE) แต่เดิม `bmsRevisions.ts` **ไม่มี kind** ให้เลือก → ข้อมูลถูกเก็บแต่
  admin เปิดดูไม่ได้เลย. แก้แล้วโดยเพิ่ม `purchase`/`purchaseItems` เข้า `REVISION_CONFIG` (`bmsRevisions.ts`)
  + enum `BmsRevisionKind` (`typeDefs.ts`) + dropdown `KIND_OPTIONS` (หน้า `/admin/revisions`) + เพิ่ม
  `purchase.view` เข้า guard สิทธิ์ของหน้า. `purchaseItems` ใช้ **`po_id` เป็น entity** (จัดกลุ่มตาม PO)
  เพราะ item id เป็น bigserial ที่ผู้ใช้ไม่ได้อ้างตรง ๆ
- **editor attribution ของ purchase** เดิมเป็น `system` เพราะ `receivePurchaseOrder()` เรียก
  `beginTenantTx(client, tenantId)` ไม่ส่ง editorId และ `cancelPurchaseOrder()` ใช้ `query()` ธรรมดา
  (ไม่ผ่าน tenant tx เลย trigger เลยไม่เห็น `app.editor_id`). แก้แล้ว: ทั้งสองฟังก์ชันรับ `editorId` param
  เพิ่ม, `cancelPurchaseOrder()` เปลี่ยนมาใช้ `getClient()` + `beginTenantTx()`, และ resolver
  (`bmsPurchase.ts`) ส่ง `requireAuth(ctx).author_id` เข้าไป — ตอนนี้เห็นชื่อคนรับของ/ยกเลิก PO จริง
  · REST route ของ purchase (ถ้ามี) ไม่ได้ส่ง editorId แต่ param เป็น optional จึงไม่พัง (แค่ path นั้นจะได้
  editor เป็น system เหมือนเดิม — path หลักคือ GraphQL admin UI)
- Search ในหน้า Revision History ไม่ต้อง exact id เสมอ: products ค้น `sku/name/barcode`; orders/payments/
  shipments ค้น id/status/reference/tracking ตาม kind; purchase ค้น `id/status/note`; purchaseItems ค้น
  `po_id/product_sku/size`
- Compare 2 version คือ compare snapshot กับ snapshot; ถ้าต้องการ compare revision ล่าสุดกับ row ปัจจุบัน
  ต้องเพิ่ม API อีกตัวภายหลัง
- **suppliers ตั้งใจไม่เพิ่ม kind**: trigger `bms_suppliers` มี (`7.8`) แต่ยังไม่มี code path ไหน UPDATE
  supplier เลย → ถ้าเพิ่ม kind จะเป็นตัวเลือกที่ไม่มีข้อมูล (dead option) รอจนมีหน้าจอแก้ supplier จริงก่อน
- **Coupons — เพิ่ม kind แล้ว (2026-07)**: migration `7.22__bms_coupons_revisions.sql`
  (`create_revision_trigger('bms_coupons')`) + `coupons` เข้า `REVISION_CONFIG` (`bmsRevisions.ts`,
  **parentIdField = `id` (UUID)** — ไม่ใช่ `code` เพราะ code เปลี่ยนได้ (rename โค้ด) ถ้า group ด้วย code
  ประวัติของคูปองตัวเดียวจะแตกเป็นคนละ entity ตอน rename และ compare ข้ามชื่อไม่ได้; searchFields ยังเป็น
  `code`/`note` ให้ค้นด้วยโค้ดได้ (คนละเรื่องกับ parentIdField), perm `coupon.view`) + enum `BmsRevisionKind`
  + `KIND_OPTIONS`/placeholder ในหน้า `/admin/revisions` + `coupon.view` เข้า guard ของหน้า.
  **editor attribution**: `upsertCoupon()` เดิมใช้ `query()` ธรรมดา (editor = system) — เปลี่ยนมาใช้
  `getClient()` + `beginTenantTx(client, tenantId, { editorId })` แล้ว, resolver `bmsUpsertCoupon` ส่ง
  `requireAuth(ctx).author_id`. เหตุผลที่ทำ: audit log เก็บแค่ who/when (`meta:{code}`) ไม่บอกว่าค่าเปลี่ยน
  จากอะไร (10%→5%) — revision snapshot เก็บแถวก่อน UPDATE จึงตอบได้. trigger fire เฉพาะ UPDATE (สร้างโค้ด
  ใหม่ = INSERT ไม่มี revision, เหมือน products SKU ใหม่) · `bms_coupons` ไม่มี PII/secret จึง snapshot ทั้ง
  แถวได้ (ไม่เข้าข่ายเคส `users`/password_hash ที่ 7.16 ห้าม)
- **Compare guard (ทุก kind, 2026-07)**: หน้า `/admin/revisions` เดิมเลือก 2 แถวไหนก็ compare ได้ แม้เป็น
  คนละ entity (เช่นคูปองคนละโค้ด) → diff ไม่มีความหมาย. แก้ที่ `page.tsx`: `getCheckboxProps` disable แถวที่
  entityId ต่างจากแถวที่เลือกไว้แล้ว + `onCompare` เช็คซ้ำก่อนยิง `bmsRevisionCompare` (fail-open เฉพาะตอน
  ยืนยัน entity ไม่ได้ เช่นแถวหลุด pagination). ใช้ `entityId` ที่ resolver คืนมาจาก `parentIdField` ต่อ kind
- **Grouped view ราย entity (ทุก kind, 2026-07)**: เดิม flat list เอา revision ทุก entity มาปนกันเรียงเวลา
  → สับสนว่าแถวไหนของใคร. เปลี่ยนเป็น tree ใน `page.tsx` (frontend-only, ไม่แตะ resolver): `grouped` useMemo
  จับ `rows` เป็นกลุ่มตาม `entityId` (rows มาเรียง DESC อยู่แล้ว กลุ่มบนสุด = แก้ล่าสุด, children ใหม่→เก่า) ·
  parent row (`id: "group:<entityId>"`, `isGroup:true`) โชว์ label (จาก `entityLabel(kind, newest.snapshot)`
  — coupons→code, products→name/sku, …) + จำนวนเวอร์ชัน + แก้ล่าสุดเมื่อไหร่/ใคร · antd `expandable`
  `defaultExpandAllRows` + `Table key={kind:search}` เพื่อ re-expand ตอนเปลี่ยน kind/search · `rowSelection`
  `checkStrictly` + group row `disabled` (เลือกได้เฉพาะ revision row) + `onChange` filter คีย์ `group:` ทิ้ง ·
  columns render แยก `row.isGroup` · **label ใช้ snapshot ล่าสุดของกลุ่ม ไม่ใช่สถานะ live** (สถานะปัจจุบันดูที่
  หน้า kind นั้น) — ยอมรับได้เพราะ snapshot = ก่อน update ล่าสุด ยังใช้ระบุตัว entity ได้

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
- **conversion regression บน shared key (haiku-4-5) — แก้แล้วด้วยทางเลือก (ก)+(ค) ที่จดไว้เดิม**:
  โมเดลเคย conservative เรื่องปิดการขาย (ใส่ไซซ์ลงใน keyword ของ search_products, ถามย้ำก่อน
  create_order) ตอนนี้จูน prompt เพิ่ม **และ** ใส่ deterministic route ก่อน AI loop แล้ว (ดู
  § deterministic route ด้านล่าง) · ทางเลือก (ข) ใช้ model แรงกว่าผ่าน BYOK ยังใช้ได้เหมือนเดิม
- verify: playground `POST /api/bms/chat {channel:"test"}` ดู `tool:"ai:tool-calling"` + `trace[]` ·
  intent ที่ถูก route ตรงจะได้ `tool:"deterministic:<tool_name>"` (มี `trace[]` เหมือนกัน) · staff ต้อง
  login เปิด `/admin/assistant`

### deterministic route ก่อน AI loop + runtime hardening (2026-07)

- **`runApprovedTool()`** (`tools/runtime.ts`) = execution boundary เดียวกับ tool loop (authorize
  surface/permission → validate args → execute → audit `ai.tool_call`) แต่ **server เลือกทูลเอง ไม่ผ่าน
  provider** · `pipeline.ts` ใช้เฉพาะ intent ที่เป้าหมายไม่กำกวม: สถานะออร์เดอร์ตัวเอง, แจ้งโอนเงิน
  (ต้องรู้ method ก่อน ไม่รู้ = ถาม 1 คำถาม), สั่งซ้ำ, กระเป๋าคูปองของตัวเอง, และ **ออร์เดอร์ที่ slot ครบ
  + ลูกค้ายืนยันแล้ว** (สินค้า+ไซซ์+จำนวน) โดยยังต้อง `search_products` ก่อน และสร้างออร์เดอร์เฉพาะตอน
  match ได้ตัวเดียวชัดเจน ไม่งั้นตกไป AI loop ตามปกติ
- **double-create ที่เคยกลัวไว้ ป้องกันด้วยการ return ทันที** — route เหล่านี้ `return customerSafe(...)`
  ก่อนถึง `runToolLoop()` เสมอ (mutually exclusive จริง ไม่ใช่ flag) · ยังใช้ทูลใน `customerTools()`
  ตัวเดียวกับที่ AI เรียก ไม่มี logic โดเมนซ้ำ
- **order slot memory** — `buildOrderMemory()` สรุป turn ล่าสุด (ตัดที่ออร์เดอร์ล่าสุดที่ปิดไปแล้ว) เป็น
  slot สินค้า/ไซซ์/จำนวน/ยืนยัน ส่งเข้า system prompt เป็น **customer claims ไม่ใช่ข้อเท็จจริง** (กันถามซ้ำ)
  — ตัวสินค้า/สต็อก/ราคายังต้องมาจากทูลเสมอ
- **duplicate tool call suppression** (`runtime.ts`) — provider retry/ส่ง `tool_use` เดิมซ้ำใน loop เดียวกัน
  หลัง write สำเร็จ = replay `tool_result` เดิม (key = ชื่อทูล + args ที่ canonicalize แล้ว) ไม่ execute ซ้ำ ·
  **cache เฉพาะผลสำเร็จ** — error ไม่ cache เพื่อให้ model แก้ args/retry transient ได้ · audit ทุก attempt
  เหมือนเดิม (เห็น `duplicate suppressed: ...` ใน trace)
- **`customerSafe()`/`sanitizeCustomerReply()`** — ทุก reply ฝั่งลูกค้า (AI, deterministic, rule-based)
  ออกทางเดียว: ตัด UUID เต็มเหลือ 8 ตัวแรก + บังคับ brand voice (`ครับ`→`ค่ะ`, `ผม` เดี่ยว ๆ →`ทางร้าน`) ·
  **คนละเรื่องกับ `applyGenderParticle()`** ของ "AI แนะนำคำตอบ" (นั่นคือเสียงของแอดมินแต่ละคน ดู § Gender particle)
- **turn budget นับความคืบหน้ากว้างขึ้น** — เดิมนับเฉพาะ write (`create_order`/`submit_payment`/`reorder`)
  ทำให้ลูกค้าถามสินค้า 3 turn แล้วถูก force handoff ทั้งที่ AI เรียกทูลถูกทุกครั้ง · ตอนนี้ทูล
  `customerTools()` ตัวไหนสำเร็จก็นับ + คำถามกลับที่เป็น business clarification (ถามไซซ์/จำนวน/ช่องทางโอน)
  ก็นับเป็นคืบหน้า
- **`reorder` ฝั่งลูกค้าไม่ต้องส่ง `orderId`** — เว้นว่างได้ ระบบ resolve ออร์เดอร์ล่าสุดของ
  `(channel, customer_ref)` เอง (ฝั่ง staff ยังต้องระบุ) — เดิม required ทำให้ AI ต้องถามเลขออร์เดอร์จากลูกค้า
- **`__toolLoopTest` seam** — `runToolLoopInternal`/`runApprovedToolInternal` รับ deps (credential resolver /
  provider / usage finalizer / audit) ให้ eval inject ได้ · **production ใช้ `runToolLoop()`/`runApprovedTool()`
  ซึ่งผูกของจริงตายตัวเสมอ** และไม่มี test HTTP endpoint ให้เรียกจากภายนอก — อย่าเผลอ export seam นี้ออกไป
  ใช้ที่อื่น

### Registry-only tool metadata (2026-08)

`BmsTool` (`tools/types.ts`) มี field เสริม 4 ตัว — `whenToUse`/`whenNotToUse`/`commonMistakes`/
`example` — สำหรับ docs/human เท่านั้น **ไม่ถูกส่งเข้า Anthropic tool schema** (`tools/runtime.ts`
~L370 ส่งแค่ `name`/`description`/`input_schema`) จึงไม่กิน token ต่อ turn เลยจนกว่าจะมีคนตั้งใจย้าย
เนื้อหาไปต่อท้าย `description` เอง — ใส่ไว้แล้ว 8 ทูล (5 ทูล product-discovery ที่ทับซ้อนกัน +
`create_order`/`reorder` + `generate_report` ที่ `feat/report-generation` เพิ่มเข้ามาทีหลังแยกกัน)
เพราะเป็นกลุ่มที่เคยถูกเรียกผิดจริง ไม่ได้ตั้งใจทำครบทุกทูล — **จำนวนนี้ไม่นิ่ง** อย่าเชื่อเลขในเอกสาร
ให้ดู `catalog.ts` จริงก่อนเสมอ — รายละเอียดเต็มอยู่ที่
[docs/ai/tools.md](docs/ai/tools.md#registry-only-tool-metadata-disambiguation-not-schema)
(ตารางเดียวกับ § Authoritative runtime registry and gates)

### AI eval suites (`scripts/ai-eval/`)

- **deterministic contract test** (`runtime-contract.test.mts`, node:test + tsx) — ไม่ต่อ network/DB
  บังคับ path ที่ทดสอบด้วยมือไม่ได้: ไม่มี credential, malformed provider output/usage, unknown tool,
  arg validation, customer เรียก staff/sensitive tool, staff RBAC ถูกเช็คซ้ำตอน execute, sensitive ต้องเป็น
  proposal, provider ล้ม**หลัง** write (ต้องไม่ write ซ้ำและไม่ตกไป rule-based), duplicate tool call,
  loop bound 5 รอบ, tenant mismatch, audit ไม่มี raw args/PII · รันจาก `apps/web`:
  `npx tsx ../../scripts/ai-eval/runtime-contract.test.mts`
- **live-model eval** (`run.mjs`) — ยิง `/api/bms/chat` จริงแล้วอ่าน state กลับทาง GraphQL (order/payment/
  items/status/restock subscription) ไม่เชื่อแค่ trace · **เขียนข้อมูลจริง** (conversation `EVAL-*`, order,
  payment PENDING, `ACTIVE` restock subscription, audit) และ **ไม่มี cleanup** → ใช้กับ tenant dev/sandbox
  เท่านั้น · localhost ผ่านเอง, remote ต้องตั้ง `BMS_EVAL_ALLOW_REMOTE_WRITES=true` (ห้ามใช้กับ production)
  · แยกผล functional/safety/system — safety ที่ fail แบบ intermittent นับเป็นบั๊ก
- **fixture ไม่พอ = SKIP ไม่ใช่ pass** — runner discover product/variant/alias/category/coupon จากร้านจริง
  และวาง stock budget ล่วงหน้าไม่ให้ write case แย่ง variant กันเอง · `BMS_EVAL_REQUIRE_FULL_COVERAGE=true`
  บังคับให้ skip หรือทูล customer ที่ไม่ถูกเรียกเลยทำให้ run fail (ใช้กับ tenant ที่เตรียม fixture ครบ) ·
  `BMS_EVAL_JSON_OUTPUT=<path>` เก็บรายงานไว้เทียบ pass rate ระหว่างรอบ (รันซ้ำ reserve stock เพิ่มจริงทุกครั้ง
  ต้อง refresh fixture ก่อนเทียบ) · `BMS_EVAL_ALL_TENANTS=true`/`BMS_EVAL_TENANT_SLUGS=` ต้องเป็น platform admin
- **archetype policy case แยกต่อ businessArchetype แล้ว** — live suite สร้าง case id แบบ
  `archetype-commerce-policy-mini_mart`, `...-fashion`, `...-food_beverage` ฯลฯ และจะรันเฉพาะ case ที่ตรงกับ
  `bmsStoreProfile.businessArchetype` ของ tenant นั้น ส่วน `BMS_EVAL_CASES=archetype-commerce-policy` ยังใช้
  เป็น selector รวมได้เหมือนเดิมสำหรับเรียกทั้งกลุ่ม
- login สำหรับ eval ใช้ mutation `loginAdmin` ผ่าน `/api/graphql` เท่านั้น (`/api/login` REST route เดิม
  ถูกลบไปแล้ว 2026-08 — ดู § Admin session) · รายละเอียดครบใน [`scripts/ai-eval/README.md`](scripts/ai-eval/README.md)

### ทูลชุด 2 (B1–B3, 2026-07) — store/docs/forecast/AI-native/outbound

เพิ่มทูลเข้า `catalog.ts` อีกชุด (ยังห่อ service เดิม ไม่มี logic ซ้ำ):
- **store profile (B1)** → `lib/bms/storeProfile.ts` + **migration `6.9__bms_store_profile.sql`** (1 แถว/ร้าน,
  ตารางใหม่แรกของงาน AI นี้) **+ `7.17__bms_store_profile_extend.sql`** (เพิ่ม contact_email/logo_url/tax_id/
  timezone/country/currency/website) · tools `get_store_info`/`get_payment_info`/`get_shipping_estimate`
  (customer+staff, read) · GraphQL `bmsStoreProfile`/`bmsUpsertStoreProfile` (`graphql/bmsStoreProfile.ts`,
  gate `requireTenantAdmin` — ไม่มี permission ใหม่) · UI การ์ด `StoreProfileCard.tsx` ใน `/admin/settings`
  · `payment_accounts` = บัญชี "ของร้านเอง" ตั้งใจให้ลูกค้าเห็น (ไม่ใช่ PII บุคคลที่สาม) · `estimateShipping()`
  = flat rate + ส่งฟรีเมื่อยอด ≥ threshold (ยังไม่ผูก carrier API จริง)
  · **ชื่อร้าน = `bms_tenants.name` ชื่อเดียวทั้งระบบ** (คอลัมน์ `store_name` เดิม **เลิกใช้** — โค้ด/AI/เอกสาร
  ใช้ `getTenantName(tenantId)` [`platform.ts`] แทน) · **Administrator แก้ชื่อร้านเองได้** ผ่าน
  `bmsUpdateMyTenant(name, slug)` (`bmsStoreProfile.ts` → `updateTenantIdentity()` ใน `platform.ts`,
  validate slug format+unique, audit `tenant.identity_update`) · การ์ด StoreProfileCard save = ยิง 2 mutation
  (`bmsUpdateMyTenant` + `bmsUpsertStoreProfile`) · **slug ปิดไม่ให้แก้ใน UI** (Input disabled + card ส่ง
  `slug:null`) เพราะ slug เป็น stable public handle ของ route `/shop/{tenantSlug}/products/{sku}` แล้ว — mutation
  ยังรับ slug ได้สำหรับการเปลี่ยนแบบควบคุม แต่การเปลี่ยนค่าจะทำให้ลิงก์เดิมเสีย · plan/active ยังเป็น platform-admin เท่านั้น
  · **revision**: `bms_tenants` ไม่มี revision trigger (rename ปลอดภัย); `bms_store_profile` มี trigger
  (snapshot jsonb) เพิ่มคอลัมน์ใหม่ได้เลย + upsert ส่ง `editorId` แล้ว (editor ไม่เป็น system)
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
# login ก่อนและเก็บ signed admin cookie (เปลี่ยนค่า placeholder เป็นบัญชี dev ของคุณ) — ผ่าน GraphQL
# mutation loginAdmin เท่านั้น ('/api/login' REST route เดิมถูกลบไปแล้ว 2026-08, ไม่มีหน้าไหนเรียกจริง)
curl -s -c /tmp/bms-cookies.txt -X POST http://localhost:3000/api/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation($input: LoginInput!) { loginAdmin(input: $input) { ok message } }","variables":{"input":{"email":"admin@example.com","password":"YOUR_DEV_PASSWORD"}}}'

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

## AI catalog discovery + sales recovery (2026-07)

**เสร็จแล้ว** — ปัญหาเดิม: ลูกค้าถามกว้าง ("มีอะไรขาย"), ถามของใหม่, หรือเจอสินค้า/ไซซ์หมด แล้ว AI จบบทสนทนา
ด้วย "ไม่มี"/"ของหมด" ทั้งที่ร้านมีสินค้าขายจริงใกล้เคียงอยู่ — เพราะ `search_products` เดิมพึ่ง `listProducts()`
(list ทั่วไป ไม่ได้ derive availability) และไม่มีทูลสำหรับ "เรียกดู"/"ของใหม่"/"หาสินค้าแทน" เลย โมเดลเลย
ตอบจากความจำแชทหรือหยุดคุยแทนที่จะค้น catalog ต่อ:

- **service ใหม่ (`lib/bms/products.ts`)** — `listSellableProducts()` (ค้น catalog ที่ active+derive
  available ต่อไซซ์จาก `bms_inventory` จริง ตาม name/sku/barcode/alias/category/brand, sort
  relevance/newest/availability), `resolveSellableProduct()` (แทนที่ query แบบ `keywords[]` substring
  เดิมใน `stock.ts`'s `resolveProduct()` — ตอนนี้เรียก service กลางตัวนี้แทน), และ
  `findAlternativeProducts()` (จัดอันดับ same category > same brand > ราคาใกล้ต้นทาง > สต็อกเยอะสุด)
  — **ไม่มี cache/embedding**: สินค้าที่เพิ่ง insert เป็น active เห็นได้ทันทีในทูลถัดไป แม้เป็นหมวดใหม่
- **ทูลใหม่ 3 ตัวใน `customerTools()`** (`tools/catalog.ts`, permission `product.view` เดิม, customer+staff):
  `browse_catalog` (คำถามกว้าง), `list_new_arrivals` (sort `created_at DESC`, อ่านสดทุกครั้ง), และ
  `find_alternatives` (sku/keyword/category/size → 2–5 ตัวเลือกจริง) — ทั้งหมดคืน `publicPath`/`publicUrl`
  (`/shop/{tenantSlug}/products/{sku}`) ผ่าน `safeCatalogProduct()` ให้ AI ส่งลิงก์ลูกค้าได้โดยไม่ต้องประกอบ
  URL เอง หรือหลุดไปส่ง `/admin/*` · `search_products`/`recommend_products`/`get_product` เดิมก็ปรับมาใช้
  service ใหม่นี้ด้วย (ไม่มี logic ค้นสินค้าคู่ขนาน 2 ชุด)
- **migration `7.33__bms_product_discovery_indexes.sql`** — เปิด extension `pg_trgm` +
  GIN trigram index บน `lower(name/sku/category/brand)` และ index
  `(tenant_id, created_at DESC) WHERE active` สำหรับ new-arrivals — ยังอ่านจาก `bms_products` ตรง ๆ
  ไม่มี parallel search store ตัวใหม่ (**ยังไม่ได้ apply เข้า docker/production จริงบนเครื่องนี้**)
- **ตอบของหมด/ไม่พบแบบมีทางไปต่อ** — `checkStock()` (`stock.ts`) คืน `availableSizes`/`alternatives` เพิ่ม,
  template ฝั่ง `ai.ts` และ AI system prompt ฝั่ง `pipeline.ts` (`buildCustomerSystem`) เปลี่ยนจากจบด้วย
  "ของหมด"/"ไม่พบ" เป็นเสนอไซซ์อื่นของรุ่นเดิมหรือสินค้าทดแทนจริงก่อนเสมอ · deterministic no-credential
  fallback (`pipeline.ts`, ไม่มี AI key/เกิน quota) เรียก service เดียวกันนี้ ไม่ได้เขียน fallback แยก
- **Thai NLU ภาษาพูดเพิ่มเติม** (`nlu.ts`/`pipeline.ts`'s `buildOrderMemory`/`productHintFromCustomerText`)
  — จำนวนเป็นคำ (`อันนึง`/`นึง`→1 ... `ห้า`→5), รูปแก้ไข slot ระหว่างทาง (`ขอ 2 แทน`, `เปลี่ยนเป็น XL`,
  `เพิ่มเป็น 3`, `ลดเหลือ 1`) แก้เฉพาะ slot ที่ตั้งใจโดยไม่ทำสินค้าที่คุยอยู่หาย และไม่เอาตัวเลขจำนวนไปตีความ
  เป็นชื่อสินค้า · วลียกเลิก draft ชัดเจน (`ไม่เอาแล้ว`/`ไว้ก่อน`/`ยกเลิก`/`พอก่อน`) เคลียร์
  `AiConversationState` (`setAiConversationState(tenantId, convId, {})`) และตั้ง history boundary ใน
  `buildOrderMemory()` กันไม่ให้ข้อความก่อนยกเลิกถูกดึงกลับมาสร้างออร์เดอร์โดยไม่ตั้งใจ
- **eval suite ใหม่**: `BMS_EVAL_MODE=natural` (13 case เน้นภาษาพูด/ความจำ/เปลี่ยนใจ/ต่อรอง/product link/
  ordinal reference `ตัวที่ 2` — ดู `scripts/ai-eval/README.md`) และ smoke suite ขยายเป็น 14 case ครอบคลุม
  `category-browse`/`new-arrivals-live-catalog`/`natural-colloquial-stock`/`restock-explicit-consent`/
  `archetype-commerce-policy` · customer tool registry ที่ eval คุม coverage ขยายจาก 15→18 ตัว
- **ยังไม่ทำ**: ยังไม่ได้ apply migration `7.33` เข้า docker/production เครื่องนี้ และยังไม่ได้รัน
  `BMS_EVAL_MODE=natural` กับ live model เพื่อดู pass rate จริง (โค้ด + eval case เขียนไว้แล้วเท่านั้น)

## Public checkout `/checkout?t=<token>` (2026-07)

**เสร็จแล้ว (โค้ด + `tsc` ผ่าน + contract test 3/3 ผ่าน — ยังไม่ได้ทดสอบ end-to-end ในเบราว์เซอร์จริง
เพราะ docker stack ไม่ได้รันตอนพัฒนา)** — เดิมลูกค้าสั่งของจบในแชทแล้ว AI มักปิดท้ายว่า "รอแอดมิน
ติดต่อกลับ" ซึ่งเป็นคำพูดของโมเดลล้วน ๆ ไม่ผูกกับออร์เดอร์จริง ตอนนี้ทุกออร์เดอร์ที่สร้างสำเร็จจะได้
ลิงก์ checkout ของออร์เดอร์นั้นจริงเสมอ:

- **จุดที่ทำให้ deterministic คือ `ExecCtx.createdOrderId`** (`tools/types.ts`) — `create_order`/
  `reorder` ใน `catalog.ts` เซ็ตค่านี้เฉพาะ `surface === "customer"` แล้ว `pipeline.ts` เช็ค
  `execCtx.createdOrderId` **ก่อน** `hasUnverifiedFacts()`/`hasUnverifiedActionClaim()` แล้วเขียนคำตอบ
  ปิดท้ายใหม่จาก `orderCheckoutChatReply()` ทั้งหมด (ไม่ใช่ต่อท้ายข้อความโมเดล) — **ห้ามให้โมเดลประกอบ
  URL เอง** และห้ามย้ายลำดับนี้ ไม่งั้นจะกลับไปได้ข้อความ "รอแอดมิน" ทับลิงก์จริง · เป็น server-only
  field โมเดลส่งเข้ามาเองไม่ได้
- **token = HMAC ไม่ใช่ JWT** (`checkoutToken.ts`) — `base64url(payload).signature`, ผูก
  `tenantId + orderId + exp` (default 7 วัน, clamp 60 วิ–30 วัน) · secret จาก `BMS_CHECKOUT_SECRET` →
  `NEXTAUTH_SECRET` → `AUTH_SECRET` → `JWT_SECRET`, ถ้าไม่มีเลยและ `NODE_ENV=production` จะ **throw**
  (dev ใช้ค่า dev-only) · เทียบ signature ด้วย `timingSafeEqual` และเช็คความยาวก่อนเสมอ (`timingSafeEqual`
  โยน error ถ้าความยาวไม่เท่ากัน)
- **⚠️ เพิ่ม `BMS_CHECKOUT_SECRET` เข้า compose ครบ 3 ไฟล์แล้ว** (`docker-compose.yml`/`.dev`/`.prod`,
  default `${JWT_SECRET}`) — ตามบทเรียนเดิมว่า `--env-file` ไม่ inject ตัวแปรเข้า container ให้อัตโนมัติ
  ถ้าลืมไฟล์ใดไฟล์หนึ่งจะกลายเป็น `undefined` เงียบ ๆ แล้วลิงก์ที่ออกจากคนละ instance จะ verify ไม่ผ่าน
- **`/checkout` ต้องอยู่ใน `skipsSessionLayer()` ไม่ใช่ `isAuthPath()`** (`ClientProviders.tsx`) —
  แยกสองอย่างนี้ไว้เพราะ `isAuthPath()` มีความหมายว่า "หน้า auth" ซึ่ง `/checkout` ไม่ใช่ (ลูกค้าไม่ต้อง
  login เลย) แต่ทั้งคู่ต้องไม่โหลด `SessionLayer` (session/chat/notification wires) · หน้าใหม่ที่เป็น
  public standalone ในอนาคตให้เติมที่ `skipsSessionLayer()`
- **`submitPaymentOnce()` vs `submitPayment()`** (`payments.ts`) — แชร์ `submitPaymentInternal()`
  ผ่าน overload, ต่างกันแค่ flag `reuseActive` · public checkout ใช้ตัว `Once`: `SELECT ... FOR UPDATE`
  บนแถว order เป็นตัว serialize แล้วถ้ามี payment `PENDING`/`CONFIRMED` อยู่แล้วจะคืน
  `ALREADY_SUBMITTED` (ไม่สร้างซ้ำ) · **`REJECTED` ตั้งใจไม่นับเป็น active** เพื่อให้ลูกค้าอัปสลิปใหม่ได้
  หลังโดน reject · staff path (`submitPayment()`) พฤติกรรมเดิมทุกอย่าง อย่าเผลอเปลี่ยนให้ reuse ด้วย
- **ยอดเงินมาจากออร์เดอร์เสมอ** — `submitCheckoutPaymentByToken()` ส่ง `amount: null` ตั้งใจ ไม่รับยอด
  จาก browser
- **ตรวจไฟล์สลิปด้วยการ decode จริง** (`sharp` + `limitInputPixels`) ไม่เชื่อ `file.type` อย่างเดียว —
  จำกัด JPG/PNG/WEBP, 8 MB, 24MP · เช็ค `content-length` ก่อนอ่าน form เพื่อกันไฟล์ใหญ่ตั้งแต่ต้น
- **route เป็น public bearer link** — ทุก response ใส่ `Cache-Control: no-store`, หน้าเว็บ
  `noindex`/`no-referrer` · audit ฝั่งลูกค้าใช้ actor `customer:checkout` (`payment.submit` /
  `customer.checkout_update`) เพื่อแยกจากการกระทำของแอดมิน
- **ไม่มี migration** — ใช้ `bms_orders`/`bms_payments`/`bms_customer_addresses`/`bms_store_profile`
  เดิมทั้งหมด และไม่มี permission ใหม่ (ลูกค้าไม่มี RBAC อยู่แล้ว)
- **ทดสอบ**: `cd apps/web && npx tsx --test ../../scripts/ai-eval/checkout-token-contract.test.mts`
  (round-trip / payload+signature ที่ถูกแก้ / หมดอายุ) — ไม่ต่อ network/DB
- **ยังไม่ทำ / ห้ามแสดงว่าใช้ได้**: payment gateway, บัตรออนไลน์, auto-confirm payment, carrier
  checkout API, marketplace checkout ใน BMS · รูปสินค้าใน checkout ยัง `imageUrl: null` ทุกแถว
  (`checkout.ts` map จาก `invoice.lines` ซึ่งไม่มีรูป) · ยังไม่มี rate limit เฉพาะทางบน endpoint นี้

## Revision trigger collision — แก้ users/posts อัปเดตไม่ได้ (2026-07)

**เจอ + แก้แล้ว** — บันทึกโปรไฟล์ `/admin/profile` (และแก้ post/comment) พังด้วย
`column "tenant_id" of relation "users_revisions" does not exist`:

- **สาเหตุราก**: `7.0__bms_revision_helpers.sql` ทำ `CREATE OR REPLACE FUNCTION trg_generic_revision()`
  **ทับฟังก์ชันชื่อเดียวกันของ revision ระบบเก่า** · ฟังก์ชันใหม่ INSERT `(id, tenant_id, editor_id,
  revision_id, snapshot, ...)` แต่ตาราง `*_revisions` ระบบเก่า (`users`/`posts`/`comments`/
  `post_seller_accounts`/`post_tel_numbers`) มีสคีมาคนละแบบ (`<table>_id, editor_id, snapshot` — ไม่มี tenant_id)
  → trigger `*_rev_trg` บนตารางเหล่านั้น error ทุกครั้งที่ UPDATE
- **แก้**: `7.16__drop_legacy_revision_triggers.sql` drop trigger legacy 5 ตัวทิ้ง (ตอนนี้มีแต่ทำให้พัง
  ไม่ได้ revision ได้จริงตั้งแต่ 7.0) · **ไม่แตะ** trigger ของ bms_* (revision จริงยังทำงานครบ 15 ตัว)
- **สำคัญ (อย่าเผลอกลับไปเปิด)**: ห้าม revision ตาราง `users` — เพราะ `to_jsonb(OLD)` จะ snapshot
  **password_hash** ลง `*_revisions` = ช่องโหว่ · ถ้าจะทำ revision ตาราง legacy จริงต้องออกแบบใหม่แยก
- **บทเรียน**: `trg_generic_revision` เป็นชื่อฟังก์ชัน global — ระวังชนกับของเดิม; เพิ่มตาราง revision ใหม่
  ต้องเช็ก `pg_trigger` ว่าไม่ไปผูก trigger เข้ากับตาราง `_revisions` ที่สคีมาไม่ตรง

## Admin session (JWT/cookie) expiry — แก้ mismatch แล้ว (2026-07)

**แก้แล้ว** — `loginAdmin` (`graphql/resolvers.ts`, mutation จริงที่ `/admin/login` เรียก — **ไม่ใช่**
`lib/auth/jwt.ts` ซึ่งเป็นโค้ด dead ที่ import ไว้แต่คอมเมนต์ทิ้ง; ตอนจดโน้ตนี้ครั้งแรกมี
`app/api/login/route.ts` เป็น REST route เก่าที่ไม่มีหน้าไหนเรียกอีกไฟล์ที่ทำให้สับสน — **ลบไปแล้ว 2026-08**
พร้อมย้าย `scripts/load-test/run.mts` ให้เรียก `loginAdmin` ผ่าน `/api/graphql` แทน — สองไฟล์นี้เคยทำให้
เข้าใจผิดว่า JWT อายุ 30 วันชนกับ cookie 7 วัน ทั้งที่ไม่มีผลจริงเลย) เดิม sign JWT ด้วย `expiresIn: "1d"`
แต่ `cookies().set(ADMIN_COOKIE, ...)`
**ไม่ได้ใส่ `maxAge`** เลย → cookie กลายเป็น session cookie (อยู่จนกว่าจะปิดเบราว์เซอร์) คนละ clock กับ JWT
ที่หมดอายุจริงใน 1 วันตาม `exp` ฝั่ง server:

- **แก้**: ผูก `sessionMaxAgeSec` ตัวเดียวเข้าทั้ง `jwt.sign({expiresIn})` และ `cookies().set({maxAge})` กัน
  สองค่านี้เพี้ยนจากกันอีก · **แยกตาม role ณ ตอนออก token** (มี `user.role` อยู่แล้วตอน sign) — Administrator
  (สิทธิ์ RBAC เต็ม) = 1 วัน, Manager/Sales/Warehouse = 7 วัน (`loginAdmin` เป็น mutation เดียวที่ใช้ล็อกอิน
  ทุก role ของฝั่ง admin ไม่ได้แยก endpoint ตาม role)
- **ข้อจำกัดที่ตั้งใจไม่แก้ตอนนี้**: ระบบนี้ไม่มี session table ใน DB (JWT stateless ล้วน) — **revoke session
  ก่อนหมดอายุไม่ได้เลย** แม้เปลี่ยนรหัสผ่าน token เดิมก็ยังใช้ได้จนกว่าจะหมดอายุตาม `exp`; ทางเดียวที่ revoke
  ได้คือหมุน `JWT_SECRET` ซึ่งเตะทุกคนออกพร้อมกันทั้งระบบ — เป็นเหตุผลที่ตั้งใจให้อายุสั้น ไม่ใช่ตั้งยาวๆ เพื่อ
  ความสะดวก
- **auto-logout เป็นแบบ reactive ไม่ใช่ proactive**: `verifyTokenString()` (`lib/auth/token.ts`) กลืน
  `TokenExpiredError` จาก `jwt.verify()` แล้วคืน `null` เฉยๆ → `requireAuth()` (`lib/auth.ts`) throw
  `UNAUTHENTICATED`/`reason:"backend_admin"` → `errorLink` ใน `lib/apollo.ts` เช็ค `reason.startsWith("backend")`
  แล้วเรียก `backendLogout()` (ล้าง cookie + redirect `/admin/login`) — **เกิดเฉพาะตอนมี request ออกไปจริง**
  ไม่มี client-side timer บังคับออกทันทีที่ token หมดอายุ ถ้าแท็บ idle ไม่มี request เลยจะยังไม่ถูกเตะจนกว่าจะมี
  action หรือ poll ถัดไป — แต่ในทางปฏิบัติ sidebar poll เดิมอยู่แล้ว (unread count/channel health ทุก 15s, AI
  usage ทุก 60s) ทำให้แท็บที่เปิดค้างไว้โดน redirect ภายใน ~1 นาทีหลังหมดอายุจริง
- **บทเรียน**: โปรเจกต์นี้เคยมี auth/login code เก่าที่ไม่ได้ลบทิ้งหลายชุด (`app/api/login/route.ts` —
  ลบแล้ว 2026-08, `lib/auth/jwt.ts` — ยังเป็น dead code อยู่, comment ทิ้งใน `resolvers.ts`) ก่อนจะแก้
  auth/session ใดๆ ต้อง grep หา endpoint/mutation ที่หน้า UI จริงเรียกก่อนเสมอ (เช็คที่ `page.tsx` ของ
  หน้า login) ไม่งั้นแก้ผิดไฟล์ที่ไม่มีผลอะไรเลย

## @mention ใน "โน้ตภายใน" ของ Inbox (2026-07)

**เสร็จแล้ว (โค้ด + `tsc` ผ่าน — ยังไม่ได้ทดสอบ end-to-end ในเบราว์เซอร์จริง เพราะเครื่องนี้ไม่มี
`.env`/docker stack รันอยู่ตอนพัฒนา)** — พิมพ์ `@` ในโน้ตภายในของแชท (`notesTab`,
`app/(admin)/admin/inbox/page.tsx`) จะเด้ง dropdown รายชื่อ staff ให้เลือก (ใช้ query
`bmsAssignableStaff` เดิมที่ assign dropdown ใช้อยู่แล้ว):

- **mention เป็น explicit picker ไม่ regex-parse ข้อความ** — mutation
  `bmsAddConversationNote(id, body, mentionedUserIds)` รับ id ของคนที่ถูก mention แยกจาก `body`
  ตรงๆ (client เก็บ `{id, name}` คู่กันตอนเลือกจาก dropdown แล้ว filter ก่อน submit ว่า `@ชื่อ` ยังอยู่
  ใน body จริงไหม กันกรณีลบข้อความทิ้งก่อนกดส่ง) — กันปัญหาชื่อซ้ำ/สะกดผิดที่ parse จากข้อความเอง
- **schema ใหม่** `7.18__bms_conversation_note_mentions.sql` — ตารางแยกจาก `bms_conversation_notes`
  เดิม (ไม่เติมคอลัมน์ลง note) เก็บ `note_id`/`conversation_id`/`mentioned_user_id`/`read_at`
  (`read_at` ยังไม่ใช้จริง เตรียมไว้สำหรับ "mention ของฉัน"/unread badge ในอนาคต)
- **server เช็คซ้ำเสมอ** — `notifyMentionedStaff()` (`lib/bms/inbox.ts`) กรอง `mentionedUserIds` ที่
  client ส่งมาให้เหลือแค่ user ใน tenant เดียวกัน + role Sales/Manager/Administrator ก่อน insert เสมอ
  (เหมือน `listAssignableStaff`) ไม่เชื่อค่าที่ client ส่งมาตรงๆ
- **ไม่สร้าง pubsub/notification ระบบใหม่** — reuse ตาราง `notifications` + `createNotification()`
  เดิม (`lib/notifications/service.ts`, เดิมใช้แค่ฝั่ง community chat/post) กับ subscription
  `notificationCreated` เดิม (`packages/graphql-core/src/resolvers.ts`, filter `user_id` ตรงกับ
  `ctx.user.id` ที่ WS ถอดจาก JWT — ใช้ได้กับ admin scope เลยเพราะ `apps/ws/src/ws.ts` set `ctx.user`
  เดียวกันทุก scope ไม่ได้แยก field) — เพิ่ม `GlobalMentionNotifier.tsx` (คู่กับ `GlobalInboxNotifier`
  เดิม) mount ใน `SessionLayer.tsx` เพื่อ filter `entity_type === "bms_conversation_note_mention"`
  แล้วเด้ง browser notification deep-link ไป `/admin/inbox?c=<id>`
- **`entity_id` ของตาราง `notifications` เป็น UUID** — ใช้ `conversationId` (UUID) เป็น `entity_id`
  ไม่ใช่ note id (note id เป็น bigint จาก `bms_conversation_notes`, ใส่ตรงไม่ได้) — เก็บ `noteId` ไว้ใน
  `data` JSONB แทน

**ปรับ UX ช่องโน้ต (2026-07):** ตัดปุ่ม `@` และปุ่ม "เพิ่ม" ออก เหลือ input เดียวเต็มความกว้าง — **Enter
บันทึกโน้ต**, พิมพ์ `@` ในข้อความเพื่อเปิด dropdown เหมือนเดิม (placeholder บอกทั้งสองอย่าง):

- **ลำดับความสำคัญของ Enter สำคัญ** — ถ้า dropdown เมนชันเปิดอยู่ **และมีคนให้เลือก** Enter = เติมชื่อคนแรก
  (ไม่ใช่บันทึก) ไม่งั้นจะเซฟตอน `@Det` ยังพิมพ์ไม่จบ → `mentionedUserIds` ว่าง = ไม่มีใครได้แจ้งเตือน ·
  `Escape` = ปิด dropdown · `Shift+Enter` ไม่ submit (เผื่อเปลี่ยนเป็น textarea ในอนาคต)
- **กันโน้ตว่าง/กดรัวซ้อน mutation ที่ `submitNote()` เอง** (`!note.trim() || noting` → return) เพราะไม่มีปุ่ม
  ที่ `disabled` คุมให้อีกแล้ว + `disabled={noting}` ที่ input ระหว่างบันทึก
- dropdown ขยายเต็มความกว้าง (`right: 0`) เพราะไม่ต้องเว้นที่ให้ปุ่มสองตัวที่ถอดออกไปแล้ว
- เวลาบนโน้ตเปลี่ยนจาก `toLocaleString()` เป็น `dayLabel`/`timeLabel` (Asia/Bangkok) ให้ตรงกับสายแชท/timeline
  — ปัญหาเดิมแบบเดียวกับที่แก้ในแท็บ Timeline
- **ไม่มี permission ใหม่** — ยังใช้ `inbox.manage` เดิมสำหรับสร้างโน้ต/mention (อ่าน mention ของ
  ตัวเองใช้ `inbox.view` เดิม เพราะเป็นข้อมูลของตัวเองอยู่แล้ว ไม่ต้องสิทธิ์เพิ่ม)

**ต่อยอดแล้ว (เสร็จเช่นกัน, 2026-07)** — badge unread + หน้า "เมนชันของฉัน":
- **Badge** — เมนู sidebar ใหม่ `/admin/inbox/mentions` (`AdminSidebar.tsx`) วางถัดจาก Inbox, poll
  `bmsMyMentionsUnreadCount` ทุก 15s แบบเดียวกับ `bmsInboxUnreadCount` แต่เป็นคนละ badge/คนละความหมาย
  (ข้อความลูกค้ายังไม่อ่าน vs ถูกกล่าวถึง) — นับจาก `bms_conversation_note_mentions.read_at IS NULL`
- **หน้ารวม** `/admin/inbox/mentions/page.tsx` — list มาจาก query `bmsMyMentions(unreadOnly, limit)`
  (join note+conversation+customer แสดงชื่อลูกค้า/ช่องทาง/ข้อความ), toggle "ยังไม่อ่าน/ทั้งหมด", ปุ่ม
  "อ่านทั้งหมดแล้ว" (`bmsMarkAllMentionsRead`) — คลิกแต่ละแถวจะ mark read (`bmsMarkMentionRead`) แล้ว
  พาไป `/admin/inbox?c=<id>` เลย
- **`read_at` ที่เตรียมไว้ตอนทำ mention v1 ถูกใช้จริงแล้ว** ไม่ต้อง migration เพิ่ม — เป็นเหตุผลที่ตอน
  ออกแบบ schema แยกตารางแทนที่จะเติมคอลัมน์ลง note โดยตรง
- ผู้ใช้เห็นได้แค่ mention ของตัวเอง (`ctx.admin.id` เท่านั้น ไม่มี arg ให้เลือกดูของคนอื่น) — ไม่มี
  ความเสี่ยง IDOR ในทูลนี้

## Order status notification emails (2026-07)

**เสร็จแล้ว (โค้ด + `tsc` ผ่าน — ยังไม่ได้ทดสอบ end-to-end จริงเพราะเครื่องนี้ไม่มี `.env`/docker/
SendGrid key ตอนพัฒนา)** — เดิม `sendEmail()` ใช้แค่ตอน verify สมัครสมาชิก ไม่มีในโดเมน order เลย
ลูกค้าที่ไม่ได้แชททาง LINE/FB/IG จะไม่รู้เลยว่าออร์เดอร์ไปถึงไหนแล้ว:

- **จุดที่แก้ไม่ใช่ตรง resolver แต่เป็น service layer ตรงๆ** (`lib/bms/orders.ts`/`payments.ts`/
  `shipping.ts`) — เดิมตั้งใจจะ hook ที่ resolver เหมือน `audit()` แต่เจอว่า order เปลี่ยนสถานะได้จาก
  **หลายทางที่ไม่ผ่าน resolver เดียวกัน**: `confirmPayment()` เขียน SQL ตรงเปลี่ยน order เป็น `PAID`
  เอง (ไม่เรียก `payOrder()`), และ `createShipment()`/`setShipmentStatus()` ใน `shipping.ts` ก็เปลี่ยน
  order เป็น `SHIPPED`/`COMPLETED` เองอีกทาง (ไม่เรียก `shipOrder()`/`completeOrder()`) — ถ้า hook แค่
  ที่ `graphql/bmsOrders.ts` (6 mutation) จะพลาดเคสที่พบบ่อยที่สุดจริงๆคือ "ยืนยันสลิปแล้ว PAID" กับ
  "สร้าง shipment แล้ว SHIPPED" ไปเลย — เคยลองทำแบบ hook ที่ resolver/REST ก่อน (13 call site) แล้ว
  ต้อง revert ทั้งหมดพอเจอจุดนี้ (ดู commit นี้ — ไม่มี "ของค้าง" จาก draft แรกทิ้งไว้ในโค้ดจริง)
  · ข้อดีของการ hook ใน service layer: ครอบคลุมทุกทาง (GraphQL/REST/AI tool catalog) โดย caller
  ใหม่ในอนาคตก็ได้ฟรีอัตโนมัติ ไม่ต้องจำไปเพิ่มทุกจุด
- **`notifyOrderStatusEmail()`** (`lib/bms/orderNotify.ts`) เป็น best-effort เต็มรูปแบบ — catch ทุก
  error เอง ไม่ throw ออกไปเด็ดขาด (อีเมล/SendGrid ล้มต้องไม่ทำให้ order transition ที่ commit ไปแล้ว
  ดูเหมือนพัง) เรียกแบบ fire-and-forget (`void notifyOrderStatusEmail(...)`) หลัง `COMMIT` เสมอ ไม่ใช่
  ก่อน · ไม่มีอีเมล (`bms_customers.email IS NULL`) = ข้ามเงียบๆ เป็นเคสปกติมาก (ลูกค้าส่วนใหญ่มาจาก
  LINE/chat ไม่เคยให้อีเมลเลย) ไม่ใช่ error
- **`setShipmentStatus()` ต้องเช็ค rowCount ของ UPDATE ภายในเอง** — เดิม comment บอกว่า "DELIVERED →
  COMPLETED แบบ best-effort" แต่โค้ดไม่เคยเช็คว่า UPDATE นั้น match แถวจริงไหม (เผื่อ order ไม่ใช่
  `SHIPPED` แล้วตอนนั้น) เพิ่ม `orderCompleted` ตัวแปรจาก `rowCount` เพื่อรู้ว่าควรส่งอีเมล completed
  จริงไหม ไม่ใช่ยิงทุกครั้งที่เรียก `setShipmentStatus(..., "DELIVERED")`
- **schema** ใช้ตาราง `email_templates` เดิม (1.21) ไม่สร้างตารางใหม่ — key ใหม่ 6 ตัว
  (`order.paid`/`packing`/`shipped`/`completed`/`cancelled`/`returned`) seed ทั้ง locale `th`/`en`
  ด้วย migration `7.19` (fallback ของ `getLatestEmailTemplate()` จะไป `en` เสมอถ้า locale ที่ขอไม่มี
  ไม่ใช่ tenant default — seed สอง locale กันพลาดกรณี `customer.preferred_language === "en"`)
- **ไม่มี tenant_id ในตาราง `email_templates`** (global ทั้งระบบ) — personalize ต่อร้านด้วยตัวแปร
  `{{store_name}}`/`{{store_logo_url}}` ที่ query จาก `getStoreProfile()`/`getTenantName()` ตอน render
  เท่านั้น ไม่ได้แยก template ต่อร้าน

**ต่อยอดแล้ว (เสร็จเช่นกัน, 2026-07) — email branding ต่อร้าน (สีธีม + ข้อความท้ายอีเมล):**
ตัดสินใจแล้วว่า**ไม่ทำ** UI ให้แก้ HTML template เต็มรูปต่อร้าน (ต้องรื้อ `email_templates` ให้มี
`tenant_id` + สร้างหน้า editor ที่ validate/preview/test-send ปลอดภัย — ไม่คุ้มกับ scale ปัจจุบัน) เลือก
เพิ่มแค่ 2 field ที่ template ดึงไปใช้แทน:
- **schema** → migration `7.20` เพิ่ม `bms_store_profile.email_theme_color`/`email_footer_text` (ไม่ใช่
  ตารางใหม่) + **แก้ html_tpl/text_tpl ของ 12 แถวจาก 7.19 แบบ full-replace ต่อแถว** (ไม่ใช้
  `regexp_replace`/`replace` แบบ patch เนื้อหาเดิม) เพื่อให้ idempotent ตรงไปตรงมา — เคยลอง
  `regexp_replace` มาก่อนแล้วเปลี่ยนใจกลางทาง เพราะ `replace()` ตัวที่สองจะ insert ซ้ำถ้ารัน migration
  ซ้ำ (ไม่มี guard `NOT LIKE`) ส่วน full-replace รันซ้ำได้ผลเดิมเสมอโดยไม่ต้องเช็คอะไรเพิ่ม
- **validate hex color ที่ service layer** (`upsertStoreProfile()` ใน `storeProfile.ts`, ไม่ใช่แค่
  resolver) — `throw new Error(...)` ถ้าไม่ตรง `^#[0-9a-fA-F]{6}$` ตาม convention เดิมของไฟล์นี้
  (`platform.ts` validate slug ก็ throw plain Error แบบเดียวกัน) · `bmsUpsertStoreProfile` resolver
  (`bmsStoreProfile.ts`) ห่อ try/catch แปลงเป็น `GraphQLError` code `BAD_USER_INPUT` ให้ client เห็น
  ข้อความจริง (pattern เดียวกับ `bmsUpdateMyTenant`) · Mustache auto-escape เป็นชั้นป้องกัน XSS ที่สอง
  (escape `"`/`'` กัน breakout จาก `style="color:{{theme_color}}"`)
- **`orderNotify.ts`** ส่ง `theme_color: profile.emailThemeColor || DEFAULT_EMAIL_THEME_COLOR` (export
  จาก `storeProfile.ts`, ค่าเดียวกับ default ที่ UI ใช้ตอนยังไม่ตั้งค่า) + `email_footer_text` (ไม่ตั้ง
  = ไม่มี paragraph นั้นเลยเพราะเป็น Mustache section `{{#email_footer_text}}`)
- **UI** → การ์ด "อีเมลแจ้งสถานะออร์เดอร์" ใน `StoreProfileCard.tsx` ใช้ `<Input type="color">` (HTML5
  native) ไม่ใช่ antd `ColorPicker` — เหตุผล: `ColorPicker` คืนค่าเป็น `Color` object ไม่ใช่ string ตรงๆ
  ต้องเขียน wrapper แปลงใน `onChange`/`getValueFromEvent` เพิ่ม ในขณะที่ native color input คืน hex
  string ตรงกับที่ backend ต้องการเลย ง่ายกว่าและพอสำหรับ use case นี้

## Coupons — โค้ดส่วนลด (2026-07)

**เสร็จแล้ว (โค้ด + `tsc` ผ่าน — ยังไม่ได้ทดสอบ end-to-end จริงเพราะเครื่องนี้ไม่มี `.env`/docker
ตอนพัฒนา)** — สร้างระบบโค้ดส่วนลด (`bms_coupons`, migration `7.21`) ผูกเข้ากับ `createOrder()`
(`lib/bms/orders.ts`) ซึ่งเป็นจุดเดียวที่ order ทุกเส้นทาง (customer/AI pipeline, `bmsCreateOrder`
admin, AI tool catalog, REST `POST /api/bms/order`, `reorderFromOrder`) ใช้ร่วมกันอยู่แล้ว — ต่างจาก
feature "order status email" ก่อนหน้านี้ที่ order เปลี่ยน**สถานะ**ได้จากหลายจุดที่ไม่ผ่านฟังก์ชันเดียวกัน
แต่ order ถูก**สร้าง**จากจุดเดียวเท่านั้น (`createOrder()`) จึง hook ที่นี่จุดเดียวพอ ไม่ต้องกระจายเหมือนตอนนั้น:

- **ใช้โค้ดในทรานแซกชันเดียวกับการจองสต็อก** — `applyCouponInTx()` (`lib/bms/coupons.ts`) รับ
  `PoolClient` ของ `createOrder()` เข้ามาตรงๆ (pattern เดียวกับ `recordOrderMovements(client, ...)`)
  ล็อกแถว coupon ด้วย `FOR UPDATE` ก่อนเพิ่ม `redemptions_count` กัน race condition ตอนมีคนใช้โค้ด
  เดียวกันพร้อมกันเกิน `max_redemptions` — โค้ดใช้ไม่ได้ = `ROLLBACK` ทั้งออร์เดอร์ (คืนสต็อกที่จองไว้
  ด้วย) เหมือน `INSUFFICIENT` ของสต็อกเดิม ไม่ใช่ error แยกที่ปล่อยให้ order สร้างต่อแบบไม่มีส่วนลด
- **permission ใหม่ `coupon.view`/`coupon.manage`** — seed ให้ Manager + Administrator เท่านั้น
  (ไม่ให้ Sales/Warehouse เพราะกระทบราคา/margin ตรง) — Administrator เป็น super ในโค้ดอยู่แล้วไม่ต้อง
  seed (ตาม pattern `order.create`/`inbox.assign` เดิม)
- **AI tool `create_order` รับ `couponCode` ได้ฟรีโดยไม่ต้องแก้ NLU** — เพราะ customer surface ใช้
  Claude tool-calling จริงอยู่แล้ว (ไม่ใช่ regex/keyword NLU) การเพิ่ม `couponCode` ใน `inputSchema`
  พอแล้ว Claude จะดึงโค้ดจากข้อความลูกค้ามาใส่ arg เองได้เลย — ต่างจาก `pipeline.ts`'s deterministic
  rule-based fallback (ใช้ตอนไม่มี AI credential/เกิน quota เท่านั้น) ที่**ไม่ได้ผูก coupon เพิ่ม**
  เพราะ NLU เดิม (`nlu.ts`) เป็น regex/entity-extraction ธรรมดา ไม่มี slot สำหรับ coupon — เป็น known
  gap เฉพาะ fallback path (rare case)
- **snapshot ผลลัพธ์ลง order เสมอ** (`discount_amount`/`coupon_code` บน `bms_orders`) แบบเดียวกับ
  `unit_price` ของ `bms_order_items` — เพื่อให้ยอดเงินย้อนหลังถูกต้องแม้ coupon จะถูกลบ/แก้ค่าไปแล้ว ·
  `generateInvoice()`/`generateQuotation()` (`lib/bms/documents.ts`) ก็โชว์ discount/couponCode ต่อ
- **ตั้งใจไม่ทำ**: คืน `redemptions_count` ตอน order ถูก cancel/return (อนุรักษ์ไว้กัน
  create-cancel-recreate วนใช้โค้ดเกิน limit — ดูรายละเอียดใน
  [docs/business/order.md](docs/business/order.md#coupons-discount-codes)), จำกัดโค้ดต่อสินค้า/
  หมวดหมู่, carry coupon ผ่าน `reorderFromOrder()` ("ซื้อซ้ำ"), เงื่อนไข eligibility ก่อนใช้โค้ด (เช่น
  ลูกค้าใหม่เท่านั้น/ผูกกับลูกค้าคนเดียว) — ยังเป็นแค่ shared string ใครมีโค้ดใช้ได้หมด (โอนกันได้โดย
  ไม่ตั้งใจ เพราะไม่มี field ผูกกับลูกค้าคนเดียว)
- **พิจารณาแล้วว่ายังไม่คุ้ม**: gen โค้ด unique หลายใบพร้อมกัน (แคมเปญ "แจกคนละโค้ด ใช้ได้ครั้งเดียว"
  เช่น ส่งอีเมลลูกค้า 100 คนคนละโค้ด) — เหตุผลที่ไม่ทำตอนนี้ไม่ใช่แค่ยังไม่มี demand แต่เพราะ**ประโยชน์
  ครึ่งเดียวถ้าไม่มีของอีกชิ้นด้วย**: ระบบยังไม่มีช่องทาง broadcast/ส่งข้อความหาลูกค้าจำนวนมาก (gap ที่
  เจอตอนสแกน feature รอบก่อน) ถ้า gen โค้ดได้ 100 ใบแต่ยังต้อง copy ไปส่งเองทีละคน ก็ไม่ต่างจากสร้างที
  ละแถวมากนัก — ควรทำคู่กับ broadcast feature พร้อมกัน ไม่ใช่ทำแยกก่อน

**ต่อยอดแล้ว (เสร็จเช่นกัน, 2026-07) — log การใช้งานโค้ด**: คอลัมน์ "ใช้ไปแล้ว" ในตาราง
`/admin/coupons` กดได้ เปิด modal โชว์ประวัติราย order (`bmsCouponRedemptions(couponId)` →
`listCouponRedemptions()` ใน `lib/bms/coupons.ts`) — ไม่ต้องมีตาราง redemption log แยก, query ตรงจาก
`bms_orders` (join customer name แบบเดียวกับ `COALESCE(NULLIF(cu.name, ...), ci.display_name)` ใน `inbox.ts`)

**ล็อกโค้ดหลังมีคนใช้ (แก้ 2026-07)**: ต้นเหตุความสับสน rename/history/display ทั้งหมดคือ "เปลี่ยน code
ของคูปองที่ถูกใช้ไปแล้ว" (ป้ายบนออเดอร์เก่าค้าง + ชื่อไปชนคูปองอื่นที่มาใช้ชื่อเดิม). แก้ที่ `upsertCoupon()`
(`coupons.ts`) — UPDATE path `SELECT ... FOR UPDATE` อ่าน `code`+`redemptions_count` ก่อน, ถ้า
`redemptions_count > 0 && code !== newCode` → `throw` (field อื่น value/วันหมดอายุ/สถานะยังแก้ได้). UI
(`/admin/coupons`) disable Input ช่อง "โค้ด" + `extra` hint ตอน `editing.redemptionsCount > 0` (disabled input
antd ยัง submit ค่าเดิม → ผ่าน guard). อยากได้โค้ดใหม่ = สร้างใหม่ (code เป็น identity ที่ลูกค้าพิมพ์/ออเดอร์
snapshot ไว้). code ยัง rename ได้อิสระถ้ายังไม่เคยถูกใช้ (count=0) — revision-by-id เดิมยังรองรับเคสนั้น

**สำคัญ — join ด้วย `coupon_id` ไม่ใช่ `coupon_code` (แก้ 2026-07, migration `7.23`)**: เดิม order เก็บแค่
`coupon_code` (string) แล้ว history join ด้วย code → พอ **rename โค้ด** (เช่น SAVE10→SAVE20) `redemptions_count`
(ผูก `coupon.id` นิ่ง) จะไม่ตรงกับประวัติ (count=1 แต่ modal ว่าง) และออเดอร์อาจไปโผล่ผิดคูปองที่บังเอิญมาใช้
ชื่อเก่า. แก้โดยเพิ่ม `bms_orders.coupon_id UUID` (FK `ON DELETE SET NULL`, index `idx_bms_orders_coupon_id`)
— `createOrder()` เก็บ `couponResult.couponId` ลงไปพร้อม `coupon_code` (code = snapshot ชื่อ ณ ตอนสั่ง ไว้ display
แม้คูปองถูกลบ) · `listCouponRedemptions()` match `o.coupon_id = $id OR (o.coupon_id IS NULL AND o.coupon_code = $currentCode)`
(clause หลัง = fallback เฉพาะออเดอร์เก่าก่อน 7.23 ที่ยังไม่มี coupon_id) · **ไม่ backfill อัตโนมัติจาก code** ใน
migration เพราะ rename-แล้ว-เอาชื่อไปใช้ซ้ำจะ match ผิดตัว (ปล่อยเก่าเป็น NULL → ใช้ fallback code) — dev data
ที่ rename ไปแล้วต้อง backfill `coupon_id` เองถ้าอยากให้ตรง (เทียบจาก `redemptions_count`)

**ต่อยอดแล้ว (เสร็จเช่นกัน, 2026-07) — สรุปโค้ดส่วนลดใน Dashboard**: `/admin/dashboard` มีการ์ด
"โค้ดส่วนลด (เดือนนี้)" โชว์ยอดส่วนลดรวม + จำนวนครั้งที่ใช้ + top 5 โค้ด (`getDashboard()` เพิ่ม
`couponSummary` ใน `lib/bms/dashboard.ts`, query 2 อันเพิ่มจาก `bms_orders` กรอง
`created_at >= date_trunc('month', current_date)`) — **ไม่กรองตาม order status** (นับ CANCELLED/
RETURNED ด้วย) เพื่อให้เลขตรงกับ "ใช้ไปแล้ว" ที่โชว์อยู่แล้วในหน้า `/admin/coupons` (ตัวเลขเดียวกัน
ต้องตรงกันทุกที่ที่โชว์ ไม่งั้นสับสน):
- **mask เป็น `null` ที่ field resolver ไม่ใช่ที่ query gate** — `bmsDashboard` ทั้ง query gate ด้วย
  `report.view` เดิม (Sales มีสิทธิ์นี้ด้วย) แต่ `coupon.view` seed ให้แค่ Manager/Administrator
  (margin-sensitive) ถ้า gate ทั้ง query จะทำให้ Sales เห็น dashboard ไม่ได้เลยทั้งหน้า ทั้งที่ควรเห็น
  ส่วนอื่นได้ปกติ — แก้โดยเปลี่ยน schema `couponSummary` เป็น nullable แล้วเพิ่ม field resolver
  `BmsDashboard.couponSummary` ใน `bmsDashboard.ts` เช็ค `loadPermissions(ctx).has("coupon.view")`
  เอง คืน `null` เฉยๆถ้าไม่มีสิทธิ์ (ไม่ throw) — field เดียวถูกซ่อน ส่วนที่เหลือของ dashboard ยังใช้ได้
- **ฝั่ง UI เช็คแค่ `d?.couponSummary` เป็น null ไหมพอ** ไม่ต้องเรียก `useBmsPermissions` เพิ่มในหน้า
  dashboard เพราะ server มาสก์ให้แล้ว — การ์ดหายไปเองสำหรับ role ที่ไม่มีสิทธิ์โดยไม่ต้องเขียน gate ซ้ำ

## Gender particle — คำลงท้าย ครับ/ค่ะ ใน "AI แนะนำคำตอบ" (2026-07)

**เสร็จแล้ว** — เดิม suggested-reply ในหน้า Inbox ฮาร์ดโค้ด "ค่ะ/นะคะ" เสมอ ตอนนี้ผูกกับเพศแอดมิน:

- **field ใหม่**: `users.gender` (migration `7.15__bms_users_gender.sql`) ค่า `'male'`/`'female'`/`NULL`
  (ไม่ระบุ) · **ไม่มี CHECK** — validate ที่ `updateMe` (รับเฉพาะ male/female ไม่งั้น null)
- **plumbing**: `bmsMe.gender` + `MeInput.gender` (`typeDefs.ts`) · `bmsMe` resolver (`bmsSaas.ts` SELECT+return) ·
  `updateMe` resolver (`resolvers.ts` UPDATE+RETURNING) · หน้า `/admin/profile` (Select ครับ/ค่ะ/ไม่ระบุ)
- **ฟีเจอร์จริง**: `app/(admin)/admin/inbox/page.tsx` — `applyGenderParticle(text, gender)` แปลง
  `นะคะ→นะครับ`, `ค่ะ→ครับ`, `คะ→ครับ` (**ลำดับ replace สำคัญ**: นะคะ ก่อน ค่ะ ก่อน คะ) เฉพาะ
  `gender==="male"` · `female`/null คงเดิม (ค่ะ) · ใช้กับ template ของระบบเท่านั้น (ไม่ใช่ input ลูกค้า)
  · `Inbox()` มี `me` จาก `Q_ME` (เพิ่ม `gender`) แล้วส่ง prop `gender` → `ConversationPane` (คนละ component) →
  `suggestedReply(conv, gender)` (4 ข้อความ) + ปุ่ม quick reply "ขอตรวจสอบ"/"ขอบคุณ" (2 ข้อความ)
- **สำคัญ**: นี่คือข้อความที่ "แอดมินส่งในนามตัวเอง" เท่านั้น — **AI ตอบลูกค้าในนามร้าน** (`pipeline.ts`/`ai.ts`,
  30 จุดที่ใช้ ค่ะ) เป็น brand voice ของร้าน **ไม่ได้ผูกเพศ** และตั้งใจไม่แตะ (คนละเรื่อง)

## Bulk product import — CSV/XLSX (2026-07)

**เสร็จแล้ว** — `/admin/products` เพิ่มปุ่ม "นำเข้า" เปิด `ImportModal.tsx` (ไฟล์ใหม่ในโฟลเดอร์เดียวกับ
`page.tsx`) สำหรับ import สินค้าจาก CSV/XLSX แบบ preview ก่อน commit จริง:

- **parse ฝั่ง browser ทั้งหมด** ด้วย lib `xlsx` (SheetJS, `^0.18.5` — เวอร์ชันล่าสุดที่ยังอยู่บน npm
  registry ปกติ, เวอร์ชันใหม่กว่านี้ SheetJS แจกผ่าน CDN ของตัวเองแทน) — parse `.csv`/`.xlsx` ด้วย API
  เดียวกัน ไม่ต้องมี REST upload route ใหม่ (ข้อมูลส่งเป็น JSON rows ผ่าน GraphQL ตรงๆ ไม่เก็บไฟล์)
- **1 mutation, 2 โหมดด้วย flag `commit`** (ไม่ใช่ query แยกสำหรับ preview) —
  `bmsImportProducts(items: [BmsProductImportRowInput!]!, commit: Boolean = false): BmsProductImportResult!`
  (`graphql/typeDefs.ts` + resolver ใน `graphql/bmsProducts.ts`) · `commit:false` (preview, ค่า default)
  validate อย่างเดียวไม่เขียน DB, `commit:true` เขียนจริง — ใช้ validate เส้นทางเดียวกันทั้ง 2 โหมดกัน
  preview กับ commit ผลไม่ตรงกัน (ดู bullet ถัดไป) — **ตั้งใจไม่ทำ preview เป็น query แยก** เพราะ codebase
  นี้ไม่เคยมี pattern bulk-op ที่คืนผลลัพธ์รายแถวมาก่อนเลย ถือเป็น pattern แรกที่วางไว้ ถ้าจะทำ bulk
  import/preview อื่นในอนาคต ให้ใช้ shape เดียวกันนี้ (flag บน mutation เดียว) แทนที่จะคิด query-simulate-
  mutation ใหม่
- **service** → `lib/bms/productImport.ts` (`runImport()`) + `lib/bms/productImport.constants.ts`
  (`PRODUCT_IMPORT_MAX_ROWS = 500` แยกไฟล์เพราะไม่แตะ `@/lib/db` — client component import ตรงได้)
  · ไม่ทำ logic การเขียนสินค้าซ้ำ — เขียนจริงด้วย `upsertProduct()` เดิมทีละแถว (`lib/bms/products.ts`)
  · `validateProductFields()` แยกออกมาจาก `upsertProduct()` (ของเดิม ไม่ใช่ copy) ให้ preview/commit
  เรียกใช้ตัวเดียวกัน
- **กติกาที่ต้องจำ**:
  - **ไม่ import รูปภาพ** — เทมเพลตไม่มีคอลัมน์รูป ถ้าไฟล์มีคอลัมน์แปลกมาก็แค่เมิน ไม่ error ทั้งไฟล์
  - **SKU ซ้ำในไฟล์เดียวกัน** → แถวแรกชนะ แถวหลังๆ ที่ SKU ซ้ำถูก flag เป็น `ERROR` ("SKU ซ้ำกับแถวที่ N")
    ไม่ silently skip และไม่ silently overwrite
  - **โควตาเป็น all-or-nothing ทั้ง batch** ไม่ใช่ "เอา N แถวแรกที่พอดีโควตา" — ถ้า
    `currentCount + newSkuCount > max_products` บล็อกทั้ง commit (`quotaExceeded:true` + ข้อความสรุป)
    · preview เช็คแบบ point-in-time เท่านั้น (advisory) — commit ยังเรียก `upsertProduct()` จริงซึ่งเช็ค
    `enforceProductQuota()` ซ้ำเสมอ ถ้ามีการแข่งกันสร้างสินค้าระหว่าง preview กับกด "ยืนยัน Import" แถวที่
    เกินจะ error ที่ commit แม้ preview ตอนนั้นจะผ่านก็ตาม
  - **จำกัด 500 แถว/ครั้ง** (`PRODUCT_IMPORT_MAX_ROWS`) เช็คทั้งฝั่ง client (ก่อนเรียก mutation เลย) และ
    ฝั่ง resolver (กันเรียก GraphQL ตรงๆ ข้าม UI) + client เช็คขนาดไฟล์ไม่เกิน 5MB ก่อน parse ด้วย (กัน
    browser jank จากไฟล์ใหญ่ก่อนจะรู้ว่าแถวเกินหรือไม่)
  - **ไม่มี permission ใหม่** — ใช้ `product.edit` เดิม (ตัวเดียวกับ `bmsUpsertProduct`)
  - **revision**: generate `revisionId` เดียวต่อการ import 1 ครั้ง ส่งเข้า `upsertProduct()` ทุกแถวตอน
    commit (ตาราง revision จะ group แถว UPDATE ที่มาจาก batch เดียวกันได้) — แต่ trigger revision fire
    เฉพาะ `UPDATE` ไม่ใช่ `INSERT` (ยืนยันจาก `7.0__bms_revision_helpers.sql`) ดังนั้น import ที่เป็น SKU
    ใหม่ล้วนจะไม่มี revision row เกิดขึ้นเลย (ไม่ใช่บั๊ก)
  - **audit** 1 ครั้งต่อการ commit (`product.import`, มี count ใน meta) ไม่ log ทีละแถว — ไม่ audit ตอน
    preview (`commit:false`)
- **เทมเพลต**: หัวคอลัมน์ภาษาไทย (SKU / บาร์โค้ด / ชื่อสินค้า / รายละเอียด / ราคาขาย / ต้นทุน / หมวดหมู่ /
  ยี่ห้อ / คีย์เวิร์ด / เปิดขาย) match ด้วยข้อความ trim+lowercase ไม่ match ตำแหน่งคอลัมน์ — SKU/ชื่อสินค้า/
  ราคาขายจำเป็น ถ้าไม่เจอคอลัมน์จำเป็นแม้แต่ตัวเดียว reject ทั้งไฟล์ทันที (บอกให้โหลดเทมเพลตใหม่)
- ยังไม่ทดสอบ end-to-end จริงในเบราว์เซอร์ (docker ไม่ได้รันตอนพัฒนา feature นี้) — `npx tsc --noEmit`
  ผ่านสะอาดแล้วเท่านั้น ก่อนใช้งานจริงควรทดสอบผ่าน `/admin/products` เต็ม flow (โหลดเทมเพลต → กรอก →
  อัปโหลด → preview → ยืนยัน) อย่างน้อย 1 รอบ

## Sales digest reports — สรุปยอดขายรายวัน/สัปดาห์/เดือน (2026-07)

**เสร็จแล้ว (verify กับ dev instance จริงแล้ว — เห็น EMAIL ส่งสำเร็จผ่าน SendGrid, SLACK fail ต่อ
webhook ปลอมได้ 404 ตามคาด, ทุกแถวถูก log, ลบข้อมูลทดสอบออกหมดแล้ว)** — เดิมร้านต้องเข้า
`/admin/dashboard` เองถึงจะเห็นยอดขาย ตอนนี้แต่ละร้านตั้งค่าให้ระบบส่งสรุปยอดขาย (รายได้/จำนวนออร์เดอร์/
สินค้าขายดี/แยกตามช่องทาง) อัตโนมัติแบบรายวัน/สัปดาห์/เดือน ผ่านอีเมล/Slack/LINE ได้เอง:

- **schema** → migration `7.37__bms_report_subscriptions.sql` — `bms_report_subscriptions`
  1 แถวต่อร้าน (แบบเดียวกับ `bms_store_profile`): ความถี่ + ชั่วโมงที่ส่ง (+ วันในสัปดาห์ถ้า WEEKLY /
  วันที่ในเดือนถ้า MONTHLY) + enable flag/ผู้รับต่อช่องทาง (อีเมล, Slack webhook URL — เข้ารหัสแบบเดียวกับ
  `channel_secret`, LINE user id ของแอดมิน) + `last_sent_at`/`last_period_key`/`last_status` และ
  `bms_report_deliveries` แบบ append-only (เหมือน `bms_audit_log`) 1 แถวต่อ 1 ช่องทางต่อการส่ง 1 ครั้ง
  ให้หน้า platform admin เห็นประวัติส่งจริงแทนที่จะมีแค่ status ล่าสุดแถวเดียว · RLS/grant มาตรฐานเดียวกับ
  `6.1`/`7.18` · **ไม่มี permission ใหม่** — ฝั่งร้านใช้ `requireTenantAdmin()` เดิม (pattern เดียวกับ
  `bmsChannels`/`bmsStoreProfile`/`bmsAiConfig` — เป็น config ของร้าน ไม่ใช่ operational action)
- **เวลา/period คำนวณเป็นเลขคณิต UTC+7 ตรงๆ ไม่ใช้ timezone library** (`lib/bms/reportDigest.ts`,
  `bkkNow()`/`bkkMidnightUtc()`) เพราะ Asia/Bangkok ไม่มี DST — สอดคล้องกับ convention เดิมของโปรเจกต์ที่
  ใช้ `Intl.DateTimeFormat` เป็นหลักไม่เพิ่ม dependency ใหม่
- **`runScheduledDigests()` (cron entrypoint) กันส่งซ้ำด้วย `last_period_key` ไม่ใช่ความถี่ cron** —
  วนทุก subscription ที่ `enabled`, เช็ค `shouldSendNow()` (ชั่วโมง/วันตรงตามตั้งไว้) แล้วข้ามร้านที่
  `last_period_key` ตรงกับ period ปัจจุบันอยู่แล้ว → เรียก cron ถี่แค่ไหนก็ได้ (แนะนำรายชั่วโมง) โดยไม่มีวัน
  ส่งซ้ำ
- **`sendTestDigest()` (ปุ่ม "ส่งทดสอบตอนนี้") ตั้งใจไม่แตะ `last_sent_at`/`last_period_key` ของจริง** —
  ใช้ 24 ชม.ล่าสุดเป็น period ชั่วคราว, log ลง `bms_report_deliveries` เหมือนส่งจริง แต่ไม่กระทบ schedule
  จริงเลย ทดสอบซ้ำกี่ครั้งก็ไม่ทำให้ระบบข้ามรอบส่งจริงไป
- **LINE ใช้ access_token ของ LINE OA ร้านเอง push หา LINE user id ของแอดมินที่กรอกไว้** — ไม่มี
  LINE-to-owner integration แยกต่างหาก (บอทของร้านที่รับแชทลูกค้าอยู่แล้วก็ push ข้อความนี้ไปด้วยเลย)
- **GraphQL** → `graphql/bmsReportSchedule.ts` แยก 2 ฝั่ง: ฝั่งร้าน (`bmsReportSubscription`/
  `bmsReportDeliveries`/`bmsUpsertReportSubscription`/`bmsSendTestReportNow`, `requireTenantAdmin()`
  แบบ local ในไฟล์เดียวกับ `bmsChannels.ts`/`bmsStoreProfile.ts` — เช็คแค่ `auth.scope === "admin"`)
  กับฝั่ง platform admin ข้ามร้าน (`bmsReportSubscriptions`/`bmsReportDeliveriesForTenant`,
  `requirePlatformAdmin()` แบบเดียวกับ `bmsTenants` ใน `bmsSaas.ts`)
- **UI** — การ์ด "รายงานสรุปยอดขาย" (`ReportSubscriptionCard.tsx`) ใน `/admin/settings`: ตั้งความถี่/เวลา/
  ช่องทาง, บันทึก, ปุ่มส่งทดสอบ, ประวัติส่งล่าสุด · หน้าใหม่ `/admin/report-schedule` (platform-admin เท่านั้น,
  gate ด้วย `layout.tsx` แบบเดียวกับ `/admin/tenants`) — ตารางทุกร้าน + สถานะส่งล่าสุด + ช่องทางที่เปิด
  พร้อม drawer ดูประวัติส่งเต็มรายร้าน
- **cron ใหม่ `POST /api/bms/reports/send-digest`** (gate `x-cron-secret` = `BMS_CRON_SECRET` แบบเดียวกับ
  `channels/check-health`/`ai/check-health`) — **ยังไม่ได้ตั้ง cron schedule จริง** เหมือนอีก 2 endpoint
  เดิม (พร้อมแล้วแค่ยังไม่มีตัวยิงอัตโนมัติ)
- **verify แล้วกับ dev instance จริง** (tenant ที่มีข้อมูลออร์เดอร์ seed จริงราว 45 วัน): `computePeriod`/
  `shouldSendNow` ถูกต้องครบทั้ง 3 ความถี่, guard validation ของ upsert ครบ, `computeSalesSummary` ตรงกับ
  ออร์เดอร์จริง (revenue/top-products/by-channel ไม่เป็นศูนย์), ส่งจริง 1 ครั้ง — EMAIL ส่งสำเร็จผ่าน
  SendGrid ไปที่ `test@example.com`, SLACK ยิงไป webhook ปลอมได้ 404 ตามคาด (error handling ทำงานถูก) —
  ทุกการส่ง log ครบ, `sendTestDigest` ยืนยันแล้วว่าไม่แตะ `last_period_key`, และ `runScheduledDigests`
  ยืนยัน idempotent (รันซ้ำ period เดิมถูกข้าม) · ลบแถวทดสอบออกหมดแล้ว ไม่มีข้อมูลค้างในร้านที่ใช้ verify

## Generated reports / AI Report Generator (2026-08)

ฟีเจอร์นี้คือ **รายงานแบบกดสร้างไฟล์ทันที** คนละอย่างกับ sales digest subscription:

- จุดเข้าใช้มี 3 ทางแต่ **ต้องรวมที่ service เดียวเสมอ**: หน้า `/admin/reports` (การ์ด **AI Report Generator**),
  GraphQL `bmsGenerateReport`/`bmsGeneratedReports`, REST `POST /api/bms/reports/generate`, และ AI tool
  `generate_report` ล้วนต้องเรียก `lib/bms/reportEngine.ts` — ห้ามแยก validate/assemble/persist/audit กันคนละที่
- ไฟล์ถูกเก็บผ่าน `persistBuffer()` → ตาราง `files` เดิม + `STORAGE_DIR` เดิม แล้วเขียนประวัติ append-only
  ลง `bms_generated_reports` (`7.53__bms_generated_reports.sql`)
- **ดาวน์โหลดห้ามใช้ `/api/files/[id]`** แม้จะสะดวกกว่า เพราะ route นั้นไม่มี auth/tenant gate;
  report export ต้องผ่าน `/api/bms/reports/download/[id]` ที่เช็คก่อนว่า tenant ปัจจุบันมีแถวใน
  `bms_generated_reports` ของ `file_id` นี้จริง ไม่งั้น enumerate file id ข้ามร้านได้
- `PROFIT` เป็น **ค่าประมาณเท่านั้น**: revenue มาจาก `bms_order_items.unit_price` snapshot จริง แต่ cost ใช้
  `bms_products.cost_price` **ปัจจุบัน** เพราะ order item ไม่มี cost snapshot ณ วันขาย ห้ามเขียน docs/UI/AI ให้ดู
  เหมือนกำไรบัญชีที่แม่นย้อนหลัง
- PDF ตอนนี้ใช้ `pdfkit` ฟอนต์มาตรฐาน → **Thai glyph ยังไม่ขึ้นถูกต้อง** จึงตั้งใจให้ title/label ใน generator
  เป็น English ก่อน; XLSX/CSV เป็น UTF-8 ใช้ภาษาไทยในข้อมูลได้ปกติ ถ้าจะทำ PDF ภาษาไทยจริงต้อง embed ฟอนต์ไทย
  (เช่น Noto Sans Thai) ใน `documentGenerator.ts` ก่อน ไม่ใช่แค่แปล string
- `draftSummary()` ให้ AI เขียน executive summary จาก facts ที่ collect มาแล้วเท่านั้น; ไม่มี credentials/quota
  หรือ provider fail → คืน `null` เฉย ๆ **ไม่ fallback เป็นข้อความเดาเอง**

**บั๊ก field หายจากไฟล์ — เจอ+แก้แล้ว (2026-08):** user รายงานว่าออกรายงานแล้ว field ไม่ครบ ตรวจแล้วพบว่า
query ดึงข้อมูลมาครบตั้งแต่ต้น แต่ตอนประกอบไฟล์ output ทิ้งบาง field ไปเงียบๆ 3 จุด:

- **`buildCsv()` เดิมเขียนแค่ `doc.sheets[0]`** — รายงาน Sales มี 3 sheet (By day/Top products/By
  channel) แต่ CSV ได้แค่ sheet แรก สินค้าขายดี+แยกช่องทางหายไปทั้งหมดถ้า export เป็น CSV (XLSX/PDF ไม่
  กระทบ เพราะ `buildXlsx`/`buildPdf` ไล่ทุก sheet อยู่แล้ว) แก้โดยให้ `buildCsv()` ไล่ทุก sheet เหมือนกัน
  คั่นด้วยบรรทัด `# ชื่อ sheet`
- **`getSalesSummary()` ดึง `byStatus` (ยอดแยกตามสถานะออร์เดอร์) มาจริงแต่ไม่เคยถูก map ลง sheet ไหนเลย**
  ทั้ง 3 format — เพิ่ม sheet "By status" ใหม่ใน `buildSalesReportDoc()`
- **`listLowStock()` select `reorder_point` มาแล้วแต่ `buildInventoryReportDoc()` ไม่เอาใส่ column list**
  — field นี้มีประโยชน์สุดสำหรับอธิบายว่าทำไมแถวนั้นถึงถูก flag ว่าใกล้หมด เพิ่มเข้าคอลัมน์ "Reorder point"
  ใน sheet "Low / out of stock" แล้ว
- **บทเรียน**: "query ได้ข้อมูลมา" กับ "field โผล่ในไฟล์" เป็นคนละ step กันเสมอในไฟล์นี้ — ทุก
  `build*ReportDoc()` ต้อง list column/sheet เองแยกจาก query เพิ่ม field ใหม่ในบทสรุป (`reports.ts`/
  `products.ts`) แล้วต้องไปเพิ่มใน `documentGenerator.ts` ด้วยเสมอ ไม่งั้นข้อมูลจะถูก query มาแล้วทิ้งแบบ
  เงียบๆไม่มี error ใดเตือน — ยังไม่ได้ทดสอบ export ไฟล์จริงในเบราว์เซอร์ (แก้แล้ว + `tsc --noEmit` ผ่าน
  เท่านั้น)

## ส่งรายงานเป็นอีเมล — email_report (A3, 2026-08)

**เสร็จแล้ว (โค้ด + `tsc` ผ่าน — ยังไม่ได้ apply migration `7.54`/ทดสอบ end-to-end จริง เพราะเครื่องนี้
ไม่มี docker stack รันอยู่ตอนพัฒนา)** — ต่อยอดจาก generate_report (§ ด้านบน) ให้สั่งด้วยประโยคเดียว เช่น
"ขอรายงานยอดขายเดือนนี้เป็นไฟล์ Excel แล้วส่ง email sss@gmail.com" ได้ แต่ **ต้องกดยืนยันก่อนส่งจริงเสมอ**
เพราะปลายทางเป็น free text ที่ไม่ผ่านการยืนยันตัวตนใดๆ (วิเคราะห์ไว้ก่อนเริ่มโค้ดในบทสนทนานี้ — สรุป: ตรงกับ
กฎ AI ของโปรเจกต์เองที่ sensitive action ต้อง human confirm + RBAC, และเป็น data-exfiltration vector ที่
irreversible กว่า refund/adjust stock ด้วยซ้ำ):

- **permission ใหม่ `report.email`** แยกจาก `report.view` เดิม (migration `7.54`, seed ให้ Manager เท่านั้น
  — Administrator เป็น super อยู่แล้ว, **ไม่ให้ Sales/Warehouse** ต่างจาก `report.view` ที่ Sales มีด้วย
  เพราะส่งข้อมูลออกนอกระบบเสี่ยงกว่าดู/ดาวน์โหลดภายใน)
- **`lib/mailer.ts`'s `sendEmail()` รองรับ `attachments` แล้ว** (ก่อนหน้านี้ไม่รองรับเลยแม้ตัว SDK
  ทั้ง `@sendgrid/mail`/nodemailer จะรองรับอยู่แล้วก็ตาม) — SendGrid path แปลง Buffer → base64,
  Gmail SMTP path ส่ง Buffer ตรงๆ ผ่าน nodemailer ได้เลย ไม่ต้อง encode เอง
- **`lib/bms/reportEmail.ts` (ใหม่)** — `emailGeneratedReport()` คือจุดเดียวที่ทั้งทูล AI และมิวเทชัน
  Confirm ต้องเรียก (ไม่ generate ไฟล์ซ้ำ — รับแค่ `fileId` ของรายงานที่ `generateReport()` สร้างไว้แล้ว,
  ยืนยัน tenant ownership ด้วย `findGeneratedReportByFileId()` เดียวกับ route ดาวน์โหลด กัน enumerate
  fileId ข้ามร้าน) · `isKnownReportRecipient()` เทียบปลายทางกับ `store_profile.contactEmail` เท่านั้น
  (ยังไม่เทียบ `bms_customers.email` เพราะทูลนี้เป็นของ staff ไม่ใช่ customer surface) — ใช้แค่เตือน UI
  ก่อนกดยืนยัน **ไม่ block การส่ง** ปลายทางถูกต้องหรือไม่ยังเป็นดุลพินิจของแอดมิน
- **`email_report` tool (`tools/catalog.ts`) ไม่ใช้ `proposalTool()` helper** เหมือน A3 ตัวอื่น (ที่
  `execute()` แค่ transform args ล้วนๆ ไม่มี side effect) เพราะทูลนี้ต้อง **สร้างไฟล์จริงก่อน** (เรียก
  `generateReport()` เดิมตรงๆ ไม่ sensitive) แล้วค่อยประกอบ proposal สำหรับ "ส่ง" เท่านั้น — ไฟล์ที่สร้าง
  ระหว่างทางยังดาวน์โหลดเองได้ปกติแม้แอดมินจะกด "ยกเลิกคำขอ" ทีหลัง (เหมือน `generate_report` เดิมทุกจุด
  ต่างกันแค่มี proposal ต่อท้าย)
- **`/admin/assistant` มี UI เฉพาะของ proposal นี้** (ไม่ใช้การ์ด generic แบบ A3 ตัวอื่น) — ช่องแก้ไข
  ปลายทางได้ก่อนกดยืนยัน (state แยกต่างหาก `emailEdits`, key ต่อ bubble+proposal index) + แถบเตือนแดงเมื่อ
  `isKnownRecipient === false` + ปุ่ม "ยืนยันส่ง" disabled ถ้ารูปแบบอีเมลไม่ถูกต้อง — mockup ที่อนุมัติไว้
  ก่อนเริ่มโค้ดคือ artifact `email_report confirm mockup` ในบทสนทนานี้
- **audit** เขียนที่ 2 จุด: `report.generate` (ตอน generate ไฟล์, ของเดิม) + `report.email` (ตอนส่งจริง
  ผ่าน `emailGeneratedReport()`, เก็บ `to`/`reportType`/`format` — ไม่เก็บเนื้อไฟล์)
- **mail log category ใช้ `"other"` ชั่วคราว** (ไม่ได้เพิ่ม `"report"` เข้า `MailLogCategory`/CHECK
  constraint ของ `bms_mail_log` เพราะเป็น migration แยกที่ไม่คุ้มทำแค่เพื่อ label — แยกด้วย
  `triggeredBy: "ai:email_report"` แทน) ถ้าต้องกรองอีเมลกลุ่มนี้ในหน้า mail log จริงจัง ค่อยพิจารณาเพิ่ม
  category ทีหลัง
- **ยังไม่ทำ**: apply migration `7.54` เข้า docker/production จริง · ทดสอบส่งอีเมลจริงผ่าน SendGrid/Gmail
  พร้อม attachment (โค้ด mailer.ts ที่ขยายยังไม่เคย exercise จริง) · ไม่ได้เทียบปลายทางกับ
  `bms_customers.email` (เฉพาะ contact email ร้านเท่านั้น) · ไม่มี rate limit เฉพาะทางบนทูลนี้ (พึ่ง AI
  quota เดิม + ต้องกดยืนยันทุกครั้งเป็นตัวกันสแปมหลัก)

## Carrier scaffold + shipping fee (โครง carrier + ให้ลูกค้าเลือกขนส่ง + ค่าส่งจริงตามโซน/น้ำหนัก)

รายละเอียดเต็ม (mock mode, carrier booking hardening, customer carrier preference migration `7.46`,
shipping fee engine `quoteShipping()`/migration `7.47`, "ไม่รู้ ≠ เดา" rules, verify results) ย้ายไปที่
[docs/integrations/carriers.md](docs/integrations/carriers.md) (adapter/mock/booking) และ
[docs/business/order.md § Shipping](docs/business/order.md#shipping) (customer carrier preference +
shipping fee calculation) แล้ว

- ⚠️ **หมายเหตุที่เจอตอน verify feature นี้**: `loginAdmin` ตรวจรหัสผ่านจริงแล้ว — โน้ตเก่าที่เคยเขียนไว้
  ตรงนี้ว่า "dev ยังไม่ตรวจ" (ดู § ก่อน production ท้ายไฟล์) **ไม่ตรงกับโค้ดปัจจุบัน** ถ้าจะทดสอบผ่าน HTTP
  ต้องมีรหัสจริง หรือทดสอบที่ service layer แทน

## Follow-up Automation — MVP core (2026-08)

**เสร็จแล้วเฉพาะ MVP core — ยังไม่ได้ verify กับ DB จริงบนเครื่องนี้** (ไม่มี BMS postgres container
รันอยู่ตอน build feature นี้ — มีแค่ docker stack ของโปรเจกต์อื่นรันอยู่ เลย apply migration/curl cron
endpoint จริงไม่ได้ในรอบนี้ `npx tsc --noEmit` ผ่านสะอาดเท่านั้น) — ต้นเรื่อง: อยากให้ AI ตัดสินใจว่า
"ควร follow-up ลูกค้าที่เงียบไปไหม" แทนที่จะตั้ง timer คงที่ ทำตามแผนที่ตกลงไว้ล่วงหน้าใน plan mode
(บันทึกไว้ที่ `C:\Users\somkid_voovadigital\.claude\plans\jolly-exploring-seahorse.md`) โดยตัด scope
ให้เหลือแค่ MVP core ตามที่ user เลือก — ไม่ทำ Workflow Engine, Follow-up Scoring, และ Analytics
dashboard เต็มรูปในรอบนี้:

- **schema** → migration `7.52__bms_followups.sql`:
  - `bms_conversations.last_sender_type` (`customer`/`staff`/`ai`) — คอลัมน์ที่ **ไม่มีมาก่อนเลย**
    (ของเดิมมีแค่ `last_message`/`last_message_at` ไม่รู้ว่าใครส่งล่าสุด) เซ็ตที่ 3 จุดใน `inbox.ts`:
    `logConversation()` (เซ็ต `'ai'` เสมอ เพราะฟังก์ชันนี้ insert คู่ IN(customer)+OUT(ai) พร้อมกันอยู่แล้ว
    — `'ai'` คือข้อความล่าสุดจริงตามเวลา), `sendStaffMessage()` (เซ็ต `'staff'`), และ
    `sendFollowupMessage()` ใหม่ (เซ็ต `'ai'`) — เป็น signal ราคาถูกที่ scheduler ใช้เช็ค "ลูกค้า/staff
    ตอบไปแล้วหรือยัง" โดยไม่ต้อง join `bms_messages` ทุกรอบ poll
  - `bms_customers.followup_opt_out` — เก็บระดับลูกค้า (ไม่ใช่ระดับแชท) เพราะการปฏิเสธรับข้อความควรติด
    ตัวลูกค้าข้ามช่องทาง/แชทตลอดไป
  - ตารางใหม่ 4 ตัว: `bms_conversation_intents` (append-only แบบ `bms_audit_log`, intent 10 ค่า
    ASK_PRICE/PRODUCT_INFORMATION/ORDER/BOOKING/SUPPORT/COMPLAINT/PAYMENT/DELIVERY/GENERAL_QUESTION/
    OTHER — **คนละชุดกับ `Intent` ใน `nlu.ts`** (CHECK_STOCK/CONFIRM_ORDER/GREETING/UNKNOWN) ห้ามเอาไป
    รวมกันเพราะ `nlu.ts` เป็น deterministic fallback ของ live chat pipeline อยู่แล้ว แก้ shape จะกระทบ
    ทันที) · `bms_followup_rules` (rule engine จริง — priority/delay_minutes/max_retry/message_goal/
    business_hours_only/template, scheduler ไม่ hardcode อะไรเลย อ่านจากตารางนี้ล้วน) ·
    `bms_followup_jobs` (1 แถวต่อ conversation+rule ที่ยังไม่จบ, unique partial index กัน schedule ซ้ำ) ·
    `bms_followup_history` (append-only log ผลลัพธ์ SENT/SKIPPED/FAILED, เหมือน `bms_audit_log`)
  - permission ใหม่ `followup.view`/`followup.manage` seed ให้ Manager (ทั้งคู่) + Sales (view เท่านั้น)
    ตาม pattern เดียวกับ `6.1`
- **service** → `lib/bms/followups.ts` — entrypoint คือ `runDueFollowups(tenantId?)`:
  1. `scheduleNewJobs()` หาแชท `OPEN`/`PENDING` ที่ `last_sender_type != 'staff'` และยังไม่มี job
     `PENDING` ค้าง → classify intent (AI-first ผ่าน `resolveAiCredentials`/`callAnthropicCompatibleMessages`
     ขอ JSON ตรงๆ, deterministic keyword fallback แยกชุดคำจาก `nlu.ts`) → `matchRule()` (priority สูงสุด
     ที่ enabled) → ไม่มี rule ตรง = ไม่ทำอะไรเลย (**ไม่ invent rule เอง**) → สร้าง job
  2. `processDueJobs()` หา job ที่ `next_run_at <= now()` แล้ว **เช็ค stop condition สดทุกครั้ง** (ไม่เชื่อ
     สถานะตอน schedule): ลูกค้า/staff ตอบไปแล้ว (`last_sender_type` เทียบกับเวลา job ถูกสร้าง),
     แชทปิด, เกิน `max_retry`, ลูกค้า opt-out, rule ถูกปิดไปแล้ว — **6 เงื่อนไขนี้ enforce เสมอ ไม่ใช่
     ให้ rule เลือกได้** (คอลัมน์ `stop_conditions` ของ `bms_followup_rules` แค่ validate/เก็บไว้เผื่อ
     workflow engine อนาคต **scheduler ไม่อ่านค่านี้เลยในรอบนี้** — ตัดสินใจแบบนี้เพราะสเปคเดิมเขียนเป็น
     "never follow up if..." แบบไม่มีเงื่อนไข ถ้าให้ rule เลือกได้จริงจะเสี่ยงเปิดสแปมซ้ำลูกค้าที่ตอบไปแล้ว
     โดยไม่ตั้งใจ) · `business_hours_only` เช็คแบบ **ประมาณเท่านั้น** (fix 09:00–18:00 Asia/Bangkok ผ่าน
     `Intl.DateTimeFormat` แบบเดียวกับ `reportDigest.ts`'s `bkkNow()`) เพราะ `getStoreProfile().businessHours`
     เป็น free text ล้วน ไม่มี schema เปิด/ปิดจริงให้ parse (known gap เดียวกับที่เจอตอนทำ ค่าส่งจริง)
  3. generate ข้อความ (`generateFollowupMessage()`) — มี goal→guidance map 8 goal (Close Sale/Collect
     Missing Info/.../Support Follow-up) บังคับ "ห้ามถามลอยๆ ว่ายังสนใจอยู่ไหม ต้องให้คุณค่าจริง" ตามสเปค
     ป้อน context ให้ครบ (ประวัติแชท จาก `listMessages`, stats จาก `getCustomer360()` ถ้ามี `customer_id`,
     store profile, follow-up ที่เคยส่งไปแล้วจาก `bms_followup_history` กันพูดซ้ำ, retry count, เวลาปัจจุบัน)
     — ไม่มี AI credentials/quota → fallback `rule.template` ถ้ามี ไม่งั้น fallback text ต่อ goal (Thai,
     brand voice ค่ะ) เหมือน pattern `generateResponse()`/template ของ `ai.ts` เดิม
  4. ส่งจริงผ่าน `sendFollowupMessage()` ใหม่ใน `inbox.ts` (เหมือน `sendStaffMessage()` แต่ sender='ai'
     + meta.followup={ruleId,jobId,goal}, reuse `deliverToChannel()`/`publishInboxChanged()` เดิม)
  5. log ผลเข้า `bms_followup_history` + audit `followup.sent`/`followup.skipped`/`followup.failed`
     (ใช้ synthetic ctx `{tenant_id, admin:{email:"system:followup-scheduler"}}` เพราะ cron ไม่มี GraphQL
     ctx จริง — audit()/getTenantId() อ่านได้จาก field พวกนี้พอ ไม่ต้องผ่าน `runApprovedTool()`/RBAC เพราะ
     นี่คือ system job ไม่ใช่ AI tool call ที่ model เลือกเอง)
  - **`runDueFollowups(tenantId?)` scope ได้** — ไม่ส่ง tenantId = สแกนทุกร้าน (path cron จริง, เหมือน
    `detectStaleChannels()`/`runScheduledDigests()`) ส่ง tenantId = สแกนแค่ร้านนั้น (path "รันตอนนี้" จาก
    GraphQL) **แก้บั๊กที่เจอตอน build**: ตอนแรก resolver `bmsRunFollowupsNow` เรียก `runDueFollowups()`
    เฉยๆ ทำให้ role ที่มีแค่ `followup.manage` ของร้านตัวเอง (Manager) กดปุ่มแล้วไป trigger follow-up ของ
    **ทุกร้านในระบบ** ได้ — เป็น tenancy leak ทั้งที่ resolver gate ด้วย permission ระดับร้านอยู่แล้ว
    แก้โดยส่ง `getTenantId(ctx)` เข้า `runDueFollowups()` เสมอฝั่ง manual trigger (บทเรียนทั่วไป: ปุ่ม
    manual trigger ทับ cron/service ที่ scan ข้ามร้านได้ ต้อง scope ตาม tenant ของผู้กดเสมอ)
- **cron** → `POST /api/bms/followups/run` (`x-cron-secret` = `BMS_CRON_SECRET` แบบเดียวกับ
  `channels/check-health`/`reports/send-digest`) — **ยังไม่ได้ตั้ง cron schedule จริง** (เหมือนอีก 2
  endpoint เดิมที่ก็ยังไม่ได้ตั้ง)
- **GraphQL** → `graphql/bmsFollowups.ts` gate ด้วย `requirePermission(ctx, "followup.view"|"followup.manage")`
  เหมือน `bmsCoupons.ts` (ไม่ใช่ `requireTenantAdmin` local แบบ `bmsReportSchedule.ts` เพราะ feature นี้มี
  permission จริงของตัวเอง ไม่ใช่ config ระดับร้านที่ Administrator เท่านั้นแก้ได้) · wire เข้า
  `resolvers.ts`/`typeDefs.ts` ตาม merge point เดียวกับโมดูลอื่นทุกตัว
- **UI** → `/admin/followup-rules` (CRUD กฎ, `followup.manage` แก้/`followup.view` ดู, pattern เดียวกับ
  `/admin/coupons`) และ `/admin/followup-queue` (อ่าน `bms_followup_jobs`/`bms_followup_history`, ปุ่ม
  "รันตอนนี้" เรียก `bmsRunFollowupsNow` สำหรับทดสอบโดยไม่ต้องรอ cron, deep-link ไป `/admin/inbox?c=<id>`)
  · เมนู sidebar 2 อันใหม่ในกลุ่ม "ร้านค้า" ถัดจาก Coupons, gate ด้วย `can('followup.view')`
- **ยังไม่ทำ (ตัดออกตั้งใจ ดูเหตุผลใน plan file)**: Workflow Engine + Workflow Builder UI แบบ branching
  tree (รอ 30 นาที → รอ 1 วัน → เสนอโปรโมชัน → หยุด ตามสเปค) — MVP นี้ทำได้แค่ retry ซ้ำ rule เดิมที่
  delay เท่ากันจนครบ `max_retry` ไม่ใช่ branch ไปกฎอื่น · Follow-up Scoring (คำนวณคะแนนจากหลายปัจจัยเทียบ
  threshold) — ใช้ `priority` + stop condition ที่ enforce ตายตัวแทน, ถ้าจะทำ scoring จริงในอนาคตให้สลับ
  `matchRule()` เป็น `scoreAndSelectRule()` โดยไม่ต้องแก้ loop หลักของ scheduler · Analytics dashboard เต็ม
  (Intent Statistics/Success Rate/Conversion Rate/Retry Statistics) — รอ `bms_followup_history` มีข้อมูล
  จริงสะสมก่อนจะมีอะไรให้กราฟ · ยังไม่ได้ apply migration `7.52` เข้า docker/production จริงบนเครื่องนี้
  และยังไม่ได้ทดสอบ end-to-end (สร้างแชทค้าง → ตั้งกฎ → curl cron → ดูข้อความจริงใน Inbox) ตามที่ระบุไว้ใน
  plan file — ต้องทำก่อนใช้งานจริง

## Redis: เอา queue โซเชียลออก + เพิ่ม cache/session/persistence (2026-08)

**เสร็จแล้ว (branch `feat/redis-infra-improvements`, `tsc --noEmit` ผ่านสะอาดทุกจุด)** — จุดเริ่มคือ
สำรวจว่า Redis ใช้ทำอะไรอยู่บ้างจริงๆ (ไม่ใช่แค่ตามเอกสาร) แล้วพบว่ามี job queue เก่าที่ไม่เกี่ยวกับ
BMS เลย + client ซ้ำกัน 3 ชุด + ไม่มี cache/session/persistence ทั้งที่ Redis ตัวเองพร้อมอยู่แล้ว:

- **เอาออกทั้งชุด: job queue โพสต์โซเชียลอัตโนมัติ** (`packages/social-queue`, `packages/events`,
  `apps/web/scripts/social-worker.mjs`, หน้า/route `/admin/queue` ทั้งหมด, service `social-worker`
  ใน docker-compose ทั้ง 3 ไฟล์, sidebar link, path alias `@social`/`@events`) — เดิมเป็นของ feature
  "โพสต์บทความ/community แล้วยิงขึ้น Facebook อัตโนมัติ" คนละเรื่องกับ BMS เลย และไม่มี consumer อะไร
  เหลือให้เก็บไว้ · **ก่อน deploy ของจริงต้องเช็ค `LLEN social:publish:queue` ใน production ก่อนเสมอ**
  ว่ามีงานค้างอยู่ไหม เพราะลบ producer+consumer พร้อมกัน งานที่ค้างจะหายไปเงียบๆไม่มี error — ถ้ามีค้าง
  ต้องรอให้รันจนหมดคิวก่อน หรือยอมรับว่าจะไม่โพสต์ให้โพสต์เหล่านั้น
  · เจอ dead code ที่ตกหล่นจากการลบรอบแรกอีก 2 จุด: env var `FB_PAGE_ID`/`FB_PAGE_ACCESS_TOKEN`/
  `SOCIAL_QUEUE_KEY`/`SOCIAL_DLQ_KEY`/`SOCIAL_DELAYED_KEY` ยังถูกส่งเข้า service `web` (ไม่ใช่แค่
  `social-worker`) ทั้งใน `docker-compose.prod.yml` และ `apps/web/Dockerfile` (ARG+ENV) ทั้งที่ไม่มี
  โค้ดอ่านค่าพวกนี้แล้ว — ลบตามไปด้วย · และ `apps/web/app/api/logout/route.ts` เป็น route ซ้ำที่ไม่มีใคร
  เรียก (ของจริงคือ `/api/auth/logout-admin`) hardcode ชื่อ cookie เองแทน import จาก `token.ts` — ลบทิ้ง
  **บทเรียน**: หลังลบ feature ใหญ่ ต้อง grep เผื่อ env var/route ซ้ำที่ผูกกับ service อื่นที่ไม่ใช่ตัวหลัก
  ของ feature นั้นด้วย ไม่ใช่ลบแค่ที่เจอจากการอ่าน entrypoint เดียว
- **Redis client ซ้ำ 3 ชุด → เหลือ 1 ชุดต่อ process** — `apps/web/lib/pubsub.ts` เดิมเปิด
  publisher+subscriber ของตัวเองอีกคู่ (คนละ object กับที่ `packages/realtime/src/pubsub.ts` ใช้ ซึ่ง
  `apps/ws` ก็ import ตัวนั้นเหมือนกัน) ทั้งที่ยิงไป Redis instance/channel เดียวกัน — ใช้งานได้เพราะ
  Redis pub/sub เป็น broker กลาง ไม่จำเป็นต้องเป็น object เดียวกันในโค้ด แต่เปิด connection เกินจำเป็น
  แก้โดยให้ `lib/pubsub.ts` แค่ `export { pubsub } from "../../../packages/realtime/src/pubsub.js"` ไม่
  สร้าง client ใหม่เอง (import ข้าม package boundary แบบ relative path ได้เพราะ `packages/graphql-core`
  ก็ import `packages/realtime` แบบเดียวกันอยู่แล้ว ไม่ใช่ pattern ใหม่) · client ตัวที่ 3
  (`packages/social-queue/pubsub.server.ts`) เป็น dead code อยู่แล้วตั้งแต่ก่อนหน้านี้ หายไปพร้อมข้อบน
- **Cache layer ใหม่** → `lib/cache.ts` (`getOrSetCache()`/`invalidateCache()`/`invalidateCachePrefix()`)
  **fail-open เสมอ** (Redis error = log แล้วถือเป็น cache miss ไม่ throw) เพราะระบบนี้ไม่เคยพึ่ง Redis
  เพื่อความถูกต้องมาก่อน จะให้ cache กลายเป็นจุดพังใหม่ไม่ได้ · ใช้จริงจุดแรกคือ `getStoreProfile()`
  (`lib/bms/storeProfile.ts`) เพราะเป็น read ที่หนักสุด (ทุก AI tool call ที่ถาม store info/payment/
  shipping + ทุกครั้งที่เปิด public checkout) แต่เปลี่ยนน้อยที่สุด — TTL 60 วิ + `invalidateCache()`
  ทันทีหลัง `upsertStoreProfile()` COMMIT สำเร็จ · **ตั้งใจไม่แคช catalog/product read**
  (`listSellableProducts()`/`browse_catalog`/`list_new_arrivals`) เพราะเอกสารเดิมยืนยันไว้ชัดว่าต้อง
  อ่านสดทุกครั้งไม่มี cache (สินค้าใหม่ insert แล้วต้องเห็นทันทีในทูลถัดไป) — แคชจุดนั้นจะพังของเดิมที่
  ตั้งใจออกแบบไว้แล้ว
- **Session revocation ผ่าน Redis** → `lib/redisSession.ts` (`createAdminSession()`/
  `isAdminSessionActive()`/`revokeAdminSession()`) เดิม `ADMIN_COOKIE` เป็น JWT stateless ล้วน
  (บันทึกไว้แล้วก่อนหน้านี้ว่า "revoke ก่อนหมดอายุไม่ได้เลย") ตอนนี้ `loginAdmin` (`resolvers.ts`) มินต์
  `jti` ใหม่ทุกครั้งใส่ลง JWT + เก็บ `session:admin:<jti> = userId` ใน Redis (TTL เท่า session) ·
  `/api/auth/logout-admin` decode cookie เดิมก่อนเคลียร์ แล้วเรียก `revokeAdminSession(jti)` จริง (ไม่ใช่
  แค่เคลียร์ cookie ฝั่ง browser เหมือนเดิม) · จุดตรวจจริงอยู่ที่ `createContext()`
  (`app/api/graphql/route.ts`) — เช็ค Redis ก่อนเชื่อ token ทุก request ของ scope admin เพราะเป็น choke
  point ที่ action จริงแทบทั้งหมดผ่าน (ตาม CLAUDE.md ที่บอกว่า business logic อยู่ที่ GraphQL/lib/bms)
  · **fail-open เหมือนกัน**: Redis ล่ม = เชื่อ JWT อย่างเดียวเหมือนก่อนมีฟีเจอร์นี้ ไม่ล็อกแอดมินทุกคน
  ออกเพราะ infra บั๊ก — แลกมาด้วย latency: `isAdminSessionActive()` เป็น await ต่อ request เสมอ ถ้า
  Redis เอื้อมไม่ถึงจะหน่วงก่อน fail-open ทุกครั้ง ไม่ใช่ fail-open แบบไม่มีต้นทุนเลย
  **ยังไม่ทำ (gap ที่รู้ตัว)**: ครอบคลุมแค่ฝั่ง Admin (`ADMIN_COOKIE`) — ฝั่ง user/community app
  (`USER_COOKIE`: `loginUser`/`loginWithSocial`/`registerUser`) ยังเป็น JWT stateless ล้วน 100% ไม่มี
  `jti`/ไม่มี Redis session เลย ถ้าจะทำต่อให้ใช้ pattern เดียวกัน (prefix `session:user:` แยกจาก admin)
  ไม่ต้องคิดกลไกใหม่ · ไม่มี "revoke ทุก session ของ user คนเดียว" (เช่น ตอนเปลี่ยนรหัสผ่านให้ตัดทุก
  เครื่องที่ล็อกอินอยู่) ต้องเก็บ set ของ jti ต่อ user เพิ่มถ้าต้องการ
- **Redis persistence** → `docker-compose.yml` เปิด `--appendonly yes --appendfsync everysec` + named
  volume `redis_data:/data` — dev/prod compose ไม่มี override ของ redis service เองอยู่แล้ว จึงได้ผลนี้
  ไปอัตโนมัติทั้ง 3 environment โดยไม่ต้องแก้ไฟล์อื่น
- **ยังไม่ทำ (ต้องปิดก่อน production จริง)**: Redis **ไม่มี password/TLS เลย** ในทุก compose file —
  เดิมรับได้เพราะมีแค่ pub/sub (ข้อมูลชั่วคราว) แต่ตอนนี้เก็บ session id + แคช `payment_accounts`
  (เลขบัญชีธนาคาร/PromptPay ของร้าน) ด้วย ถ้า network isolation หลุดจะเห็นข้อมูลพวกนี้เป็น plaintext
  ตรงๆ — ต้องเพิ่ม `requirepass` (ผ่าน env ที่ user ต้องเติมเองใน `.env`, agent ห้ามแก้ `.env` ไฟล์จริง)
  ก่อนขึ้น production จริง, และถ้า Redis อยู่ข้าม host/node จริงควรใช้ `rediss://` ไม่ใช่ `redis://`

## Cron/batch run history จริง (2026-08)

**เสร็จแล้ว** — `/admin/operations-schedule` (gate `requirePlatformAdminPage()` = super admin/platform
admin เท่านั้นอยู่แล้วเดิม) เดิมเป็นแค่หน้า**เดาว่า cron job ควรทำอะไร** โดยอ่าน source file/comment มา
scrape (`lib/bms/operationsSchedule.ts`) — ในโค้ดมี banner เขียนตรงๆว่า "ยังไม่มี trustworthy
run-history source" และไม่มีตารางบันทึกการรันจริงเลยสักที่:

- **schema ใหม่** → `db/migrations/7.55__bms_job_runs.sql` (renumber จาก `7.53` เดิมตอน merge
  `feat/redis-infra-improvements` เข้า `feat/report-generation` — `7.53` ถูก
  `7.53__bms_generated_reports.sql` ใช้ไปแล้วบน branch นี้, `7.54` คือ
  `7.54__bms_report_email_permission.sql`) — `bms_job_runs` platform-wide (ไม่มี
  `tenant_id`/RLS เหมือน `bms_ai_provider_health`) เพราะ cron run ไม่ใช่ข้อมูลของร้านไหนร้านหนึ่ง ·
  1 แถวต่อการรัน 1 ครั้ง (`job_name`, `status` running/success/error, `started_at`/`finished_at`,
  `duration_ms`, `output` jsonb, `error`, `triggered_by`)
- **service** → `lib/bms/jobRuns.ts` — entrypoint หลักคือ `recordJobRun(jobName, triggeredBy, fn)`:
  insert แถว `running` ก่อนเรียก `fn()` แล้ว update เป็น `success`/`error` เสมอไม่ว่าผลจะเป็นยังไง
  (ห่อ try/catch ไว้ในฟังก์ชันเดียว กันเผลอลืมปิดแถวถ้าไปเขียน start/finish แยกกันเอง) + re-throw error
  เดิมออกไปให้ route จัดการ response เองเหมือนก่อนมีฟีเจอร์นี้ — ไม่เปลี่ยนพฤติกรรม response ของ route
  เลย แค่เพิ่มการบันทึกคู่ขนาน · `recordExternalJobRun()` สำหรับงานที่รันนอกแอป (รายงานผลย้อนหลังเป็น
  แถวที่ปิดแล้วทันที ไม่ใช่ insert running ก่อน)
- **เสียบเข้าจริงทั้ง 4 cron endpoint** (`orders/release-expired`, `channels/check-health`,
  `ai/check-health`, `reports/send-digest`) — ห่อ `recordJobRun()` รอบฟังก์ชันเดิมที่เรียกอยู่แล้ว ไม่ได้
  เขียน logic ธุรกิจซ้ำ, response ของ route เหมือนเดิมทุกจุด (แค่ error path ต้อง try/catch เพิ่มเพราะ
  `recordJobRun` re-throw)
- **`daily-log-triage` (GitHub Action) ก็ได้ด้วย** ทั้งที่รันนอกแอปเราเลย — เพิ่ม endpoint ใหม่
  `POST /api/bms/jobs/report-run` (gate `x-cron-secret` แบบเดียวกับ cron endpoint อื่น) ให้ workflow
  ยิงกลับมารายงานผลตอนจบ step ด้วย `if: always()` + `${{ job.status }}` — **ต้องตั้ง 2 secret ใหม่ใน
  GitHub repo ก่อนถึงจะเห็นผล**: `BMS_APP_BASE_URL` (URL deployment จริง) กับ `BMS_CRON_SECRET` — ถ้า
  ไม่ตั้ง step นี้ข้ามเงียบๆ ไม่ทำให้ workflow fail (เจตนา ไม่อยากให้ฟีเจอร์ observability เสริมไปทำให้
  งานหลักพัง)
- **UI** → `OperationsScheduleClient.tsx` เพิ่มคอลัมน์ "Last run" (success/error/running/never-run) +
  กางแถวดู "Recent runs" ล่าสุด 15 ครั้งพร้อม error message ถ้ามี + alert แดงอัตโนมัติเมื่อมี job error
  หรือ "ค้าง" (`STUCK_RUNNING_MINUTES = 30` — แถว `running` ที่เก่ากว่านี้ถือว่า process ตายแบบไม่ได้ปิด
  งาน ไม่ auto-correct ให้ เป็นสัญญาณให้คนไปเช็คเอง) · banner เดิมที่บอกว่า "ยังไม่มี run-history" ถูก
  แทนที่ด้วย alert บอกว่าต้อง apply migration 7.55 ก่อนถึงจะเห็นข้อมูล (กันสับสนถ้า deploy แล้วยังโชว์
  "Never run yet" อยู่ทั้งที่ endpoint ถูกเรียกจริง)
- **`job_name` ผูกกับ `key` ใน `DEFINITIONS`array ของ `operationsSchedule.ts` ด้วยชื่อ ไม่ใช่ FK** —
  ตั้งใจ เพราะสองอันนี้เป็น registry คนละงาน (อันหนึ่งบอก "job นี้ควรทำอะไร" อีกอันบอก "เกิดอะไรขึ้นจริง")
  join กันแค่ตอน render UI เท่านั้น
- **ยังไม่ทำ**: ต้อง apply migration `7.55` เข้า DB จริงก่อนถึงจะเห็นผล (หน้าเว็บเตือนไว้แล้ว) · ยังไม่ได้
  ตั้ง cron schedule จริงให้ทั้ง 4 endpoint (เหมือนเดิมก่อนหน้านี้ — ฟีเจอร์นี้แค่ทำให้ "เห็นได้" ว่ารันไป
  แล้วผลเป็นยังไง ไม่ได้ทำให้มันถูกยิงอัตโนมัติ) · ยังไม่ได้ verify กับ DB จริงบนเครื่องนี้ (ไม่มี docker
  postgres รันอยู่ตอนพัฒนา รอบนี้ `tsc --noEmit` ผ่านสะอาดเท่านั้น)

## Per-user language switcher (2026-08)

**เสร็จแล้ว (branch `multi-language`, `tsc --noEmit` ผ่านสะอาด ไม่มี error ใหม่ — error เดิมที่เจอใน
`packages/social-queue` ของ branch นี้ไม่เกี่ยวข้อง)** — ต้นเรื่องมาจากการสำรวจว่าระบบ 2 ภาษาตอนนี้
ครอบคลุมแค่ไหน (พบว่าครอบคลุมแค่ ~15% ของแอป — public/auth/nav เท่านั้น admin ทั้งหมด Thai-only) แล้ว
เลือกทำ per-user switcher ก่อนเป็นจุดเริ่ม โดย copy โครงจาก `theme_preference` ที่มีอยู่แล้วให้เหมือน
ที่สุด ไม่คิด pattern ใหม่:

- **`users.language` มีมานานแล้วจริง** (migration `1.13__users_username-language.sql`,
  `TEXT NOT NULL DEFAULT 'en'`) แต่ไม่มี CHECK constraint และไม่มีใครอ่าน/เขียนมันจริงนอกจากตอน
  register — เพิ่ม `7.56__users_language_check.sql` (renumber จาก `7.55` เดิมตอน merge
  `multi-language` เข้า `develop` — `7.55` ถูก `7.55__bms_job_runs.sql` ใช้ไปแล้วจาก
  `feat/report-generation`) ให้ `CHECK (language IN ('th','en'))` ตาม pattern
  เดียวกับ `7.50` (idempotent existence-check ผ่าน `pg_constraint`, coerce แถวนอก whitelist เป็น 'en'
  ก่อนเพิ่ม constraint กันพัง)
- **`updateMe` resolver ไม่เคย validate `language` เลย** (รับ string อะไรก็ได้ตรงเข้า DB) ต่างจาก
  `themePreference` ที่ whitelist ไว้อยู่แล้ว — แก้ให้เข้มเท่ากัน (`language === "th" || language ===
  "en" ? language : null` ก่อนเข้า `COALESCE`)
- **`lib/lang.ts` ใหม่** — `getLangCookie()`/`setLangCookie()`/`isLang()` มาแทน regex parse cookie ที่
  เคย inline อยู่ใน `HeaderBar.tsx` (2 จุด: read effect ตอน mount + `changeLang()`) — รวมเป็น
  implementation เดียว ไม่ใช่ copy ซ้ำที่ 3 (SessionLayer, profile page, settings page)
- **`/api/auth/me`'s `withUserPreferences()` เพิ่ม `language`** อ่านสดจาก Postgres ทุกครั้งเหมือน
  `theme_preference` (ไม่ฝังลง JWT) — เหตุผลเดียวกัน: เปลี่ยนเครื่องนี้แล้วอีกเครื่องต้องเห็นทันที ไม่ต้อง
  รอ token หมดอายุ · เพิ่ม `language?: "th" | "en"` เป็น field เสริมใน `JWTPayload` type (comment บอกว่า
  ไม่ได้ sign เข้า token จริง เผื่อคนงงว่าทำไมมี field แต่ไม่เห็นใน `jwt.sign()`)
- **`SessionLayer.tsx` เพิ่ม effect sync ภาษา** คู่กับ theme — ต่างกันจุดสำคัญ 1 จุด: **theme ไม่ต้อง
  `router.refresh()`** (เปลี่ยน DOM class/cookie/localStorage ฝั่ง client พอ) แต่ **language ต้อง
  refresh** เพราะ `lang` ถูกอ่านฝั่ง server ใน `app/layout.tsx` เพื่อเลือก dictionary — ถ้าไม่ refresh
  หน้าที่ mount ไปแล้วจะไม่เปลี่ยนภาษาเลยแม้ cookie เปลี่ยนแล้วก็ตาม
- **gap ที่แท้จริงที่แก้คือ "form มีอยู่แล้วแต่กดบันทึกแล้วไม่มีผลกับหน้าจอ"** — ทั้ง `/admin/profile`
  และ public `/settings` มี `Select` ภาษาอยู่แล้วเดิม ส่ง `language` ไป `updateMe` ได้แล้ว แต่ไม่มีขั้นตอน
  "เอาผลลัพธ์ที่ server ยืนยันกลับมา ไปเขียน cookie + refresh" เหมือนที่ theme ทำ (`setTheme(nextTheme)`)
  เลย — เพิ่มบล็อกคู่กันในทั้ง 2 หน้า ใช้ `res.data.updateMe.language` (ค่าที่ server confirm แล้ว ไม่ใช่
  ค่าดิบจาก form) เหมือน pattern ของ theme เป๊ะ
- **เช็คแล้วว่า admin ไม่มีปุ่มสวิตช์เร็วๆที่ topbar เลย ทั้ง theme และ language** — `ThemeToggle.tsx`
  ใช้อยู่แค่ใน `HeaderBar.tsx` (หน้า public) เท่านั้น ไม่ได้เอาไปใส่ใน admin shell — เป็น pattern เดิมของ
  ระบบที่สม่ำเสมออยู่แล้ว (ต้องเข้า `/admin/profile` ไปเปลี่ยนทั้งสองอย่าง) ไม่ใช่ gap ที่เพิ่งเกิดจากงานนี้
- **ยังไม่ทำ/gap ที่รู้ตัว**: ยัง apply migration `7.56` เข้า DB จริงไม่ได้ (ไม่มี docker/postgres รันอยู่
  ตอนพัฒนา) และยังไม่ได้ทดสอบสลับภาษาจริงในเบราว์เซอร์ · switcher นี้เปลี่ยนภาษาได้จริงแค่ ~15% ของแอป
  (หน้าที่ผ่าน `useI18n()` อยู่แล้ว) ส่วน admin 61 ไฟล์ยัง hardcode ไทยเหมือนเดิมจนกว่าจะแปลง string เข้า
  i18n dictionary (ดู § i18n coverage ใน [AGENTS.md](AGENTS.md)) · ~~user ใหม่ที่ register ยังได้
  `language = 'en'` เสมอ~~ **แก้แล้ว (2026-08-13)** — ดู § Default language = Thai for new accounts ด้านล่าง

**ต่อยอดแล้ว — ขยาย coverage หน้า public (2026-08)**: ตัวเลข "~15%"/"admin 61 ไฟล์" ด้านบนเป็นสถานะ ณ
ตอนทำ switcher เท่านั้น ตอนนี้ล้าสมัยแล้ว — รอบถัดมาไล่แปลงหน้า public/auth ที่ยัง Thai-only หรือแปลครึ่งๆ
กลางๆ จนครบ (`/verify-email` ที่ค้าง 2 ข้อความ, `/shop-signup`, `/settings` เฉพาะ panel ที่กดถึงได้จริง,
`/search`, `/blocked`, `/notification`, `/chat` เฉพาะ 2 จุดที่หลุด, `/coupon/wallet`, และ `/help`/`/demo`
ที่เดิมไม่มี i18n เลยเพราะเป็นหน้า prose/เดโมแบบโต้ตอบ) ตรวจซ้ำแล้วว่า `/support`/`/privacy`/`/roadmap`/
`/donate`/`/license`/`/open-source`/`/pdpa`/`/terms` และ storefront สาธารณะ `/shop/**` เป็น 2 ภาษาอยู่แล้ว
ตั้งแต่ก่อนรอบนี้ (ใช้ `resolveBilingual()`/ternary `lang==="en"?...` ของตัวเอง ไม่ใช่ gap) — ดู
"Public-page i18n coverage expanded" ใน [CLAUDE.md](CLAUDE.md) และ § i18n coverage ใน
[AGENTS.md](AGENTS.md) สำหรับรายละเอียดครบ (namespace ปัจจุบันในดิกชันนารีกลางคือ 25 ตัว ไม่ใช่ ~12) ·
**ยังจริงอยู่**: admin (`/admin/**`) ทั้งหมดยัง 0% i18n เหมือนเดิม ไม่ถูกแตะในรอบนี้ · `/live-dashboard`
ตั้งใจไม่แปล (รอข้อมูลจริง) · ยังไม่ได้ apply migration `7.56`/ทดสอบสลับภาษาจริงในเบราว์เซอร์ (ค้างจากเดิม)

## Default language = Thai for new accounts (2026-08-13)

**เสร็จแล้ว, verify กับ docker postgres จริงบนเครื่องนี้แล้ว** — ทุกหน้า public/anonymous (ไม่มี session)
เป็นไทย default อยู่แล้วอย่างสม่ำเสมอทุกจุดตั้งแต่แรก (pattern `cookie === "en" ? "en" : "th"` ซ้ำอยู่ใน
10 ไฟล์: `app/layout.tsx`, `app/(main)/layout.tsx` ทั้ง `generateMetadata`+render, `/checkout`,
`/shop/**`, `/coupon/wallet`, `/admin/env`, รวมถึง `HeaderBar.tsx`'s `initialLang="th"` และ
`i18nContext.tsx`'s context default `lang:"th"`) — ไม่มี `next.config`/`middleware` ที่ detect จาก
`Accept-Language`/browser locale มาแทรกด้วย จุดนี้ไม่มีอะไรต้องแก้

**บั๊กจริงอยู่ที่บัญชี user ทั่วไป (ไม่ใช่แค่ admin) ที่สมัคร/ล็อกอินครั้งแรก** — `users.language`
(`1.13__users_username-language.sql`) ตั้ง `DEFAULT 'en'` ไว้ และทั้ง 3 จุดที่ `INSERT INTO users`
(`registerUser`, `loginWithSocial`, admin สร้าง BMS staff — ทั้ง 3 อยู่ใน `graphql/resolvers.ts`)
ไม่ได้ระบุ `language` เอง เลยตกไปใช้ default นี้เสมอ แล้ว `SessionLayer.tsx`'s effect (บรรทัดที่ sync
`sessionLanguage` เข้า `lang` cookie + `router.refresh()`) จะ **ทับ cookie ไทยที่ผู้ใช้เห็นอยู่ก่อน
login ให้กลายเป็นอังกฤษทันทีที่บัญชีใหม่ล็อกอินครั้งแรก** ทั้งที่ไม่เคยเลือกอะไรเลย

**แก้**: migration `7.81__users_language_default_th.sql` — เปลี่ยนแค่ column `DEFAULT` จาก `'en'` →
`'th'` (1 บรรทัด) ไม่ต้องแก้ 3 จุด insert เพราะทุกจุดพึ่ง DB default อยู่แล้ว · **ตั้งใจไม่ backfill
แถวเก่าที่ `language='en'`** เพราะแยกไม่ออกว่าเคย "เลือก" อังกฤษจริงหรือแค่ไม่เคยแตะ — เปลี่ยนย้อนหลัง
เสี่ยงพลิกภาษาคนที่ตั้งใจเลือกอังกฤษไว้แล้ว มีผลแค่บัญชีที่สร้างใหม่นับจากนี้
- **verify แล้วบนเครื่องนี้**: apply เข้า `bms-postgres-1` จริง, เช็ค `\d users` เห็น default เปลี่ยนเป็น
  `'th'::text`, รัน migration ซ้ำ idempotent (แค่ `ALTER TABLE` เฉยๆ ไม่ error), และ `INSERT` จริงใน
  transaction ที่ `ROLLBACK` ทันที ยืนยันว่าแถวใหม่ได้ `language='th'` โดยไม่ต้องระบุคอลัมน์นี้เอง
- **ยังไม่ทำ**: apply migration `7.81` เข้า production จริง (ทำแค่ dev docker เครื่องนี้)

ที่ `/admin/dev/fake` กดสร้างตามลำดับ **Products → Customers → Orders → Conversations → Purchase**
แล้วดู Dashboard/Reports/Inbox/Payment/Shipping/Purchase · กด **Cleanup** ลบ fake ทั้งหมด (marker `FAKE-`/tag `fake`, ลบตามลำดับ FK)
**seed ลง tenant ของ user ที่ล็อกอิน** · cleanup ก็ scope ตามร้าน · อยากเทสร้านไหนให้ drill-down เข้าร้านนั้นก่อน

**gate (แก้ 2026-07 — เข้มขึ้น):** เดิม API guard เป็น `requireAdminOrInternal()` ซึ่ง**ผ่านทุก role
ที่ล็อกอิน** (Sales/Warehouse ก็ seed ได้) และหน้า `/admin/dev/fake` **ไม่มี `layout.tsx` กันเลย**
(ต่างจาก `/admin/env`, `/admin/logs`, `/admin/dev/sql-console`) — สิทธิ์ `can('product.edit')` ใน
`AdminSidebar.tsx` เป็นแค่การซ่อนเมนู ไม่ใช่ authorization เข้า URL ตรงได้ ตอนนี้:

- API ทั้ง 9 route ใช้ `requirePlatformAdminSeeder()` (`lib/dev-guards.ts`) — อ่าน
  `users.is_platform_admin` จาก DB ทุกครั้ง (JWT ไม่ได้พก flag นี้) + fail closed ถ้า query ไม่ได้
- **ห้ามแก้ `requireAdminOrInternal()` ให้เข้มขึ้นแทน** — ฟังก์ชันนั้นถูกใช้โดย route อัปโหลดไฟล์จริง
  (`api/bms/products/upload`, `api/bms/inbox/upload`) ที่ staff ทั่วไปต้องใช้ได้ ถ้าไปยกระดับตรงนั้น
  อัปรูปสินค้า/แชทจะพังทันที จึงต้องเป็นฟังก์ชันแยก
- เพิ่ม `app/(admin)/admin/dev/fake/layout.tsx` → `requirePlatformAdminPage()` และเปลี่ยน
  `canSeedFake` ใน sidebar เป็น `isPlatformAdmin` ให้ตรงกับ gate จริง (ไม่งั้นเมนูโผล่แล้วกดเข้าโดน redirect)
- `DELETE FROM posts WHERE fake_test = true` เดิม **ไม่มี tenant scope** (ลบข้ามร้านทุกครั้ง) เพราะตาราง
  `posts` ไม่มีคอลัมน์ `tenant_id` เลย มีแค่ `author_id` → scope ผ่าน `EXISTS (users u WHERE u.id =
  p.author_id AND u.tenant_id = $1)` แทน · **ต้องลบ posts ก่อน users เสมอ** (ลำดับเดิมถูกอยู่แล้ว) ไม่งั้น
  author หายก่อนแล้ว match ไม่เจอ · fake post ที่ `author_id IS NULL` จะเหลือไว้ (ระบุร้านไม่ได้)
- ปุ่ม Cleanup มี `Popconfirm` แล้ว (เดิมกดครั้งเดียวลบทันทีไม่มีถาม)

**⚠️ ยังไม่ได้แก้ (ต้องทำที่เครื่อง production เอง):** `.env.prod` / `.env` / `.env.dev` ในเครื่องนี้
ตั้ง `BMS_ALLOW_FAKE_SEED=1` ทั้ง 3 ไฟล์ ทั้งที่คอมเมนต์บรรทัดบนเขียนว่า "เฉพาะเครื่อง demo —
production จริงอย่าเปิด" · ไฟล์ `.env*` gitignore ไว้และห้ามแก้จาก agent จึงต้องไปเช็ค/ปิดบนเซิร์ฟเวอร์จริง:
`docker compose ... exec web printenv BMS_ALLOW_FAKE_SEED NODE_ENV`

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

## Live Dashboard `/live-dashboard` (2026-08) — เลย์เอาต์เสร็จ ยังเป็น mock ทั้งหมด

**ยังไม่ต่อข้อมูลจริงเลยแม้แต่ตัวเดียว — ตั้งใจ** (ผู้ใช้สั่ง "ยังไม่ต้องต่อข้อมูลจริง ใช้ fake ไปก่อน") ตัวเลขทุกตัวมาจาก
`MOCK_*` ใน `app/(main)/live-dashboard/page.tsx` + แบนเนอร์เตือนค้างบนหน้า + ป้าย "ตัวอย่าง" ทุก field (13 จุด) +
คอมเมนต์ `// TODO(real):` บอกว่าแต่ละก้อนจะดึงจาก query ไหน

- **route อยู่ `app/(main)/` ไม่ใช่ `/admin/*`** — ตั้งใจ เพราะโจทย์คือ "ดูยอดขายโดยไม่ต้องเข้าหลังบ้าน" (เอาไปเสียบจอทีวี
  ในร้านตอนไลฟ์) จึงได้ header/footer สาธารณะ ไม่ใช่ `AdminSidebar`/`AdminLayoutClient` · **ไม่ต้องเติมใน
  `skipsSessionLayer()`** เพราะหน้านี้ *ต้องใช้* session cookie จริง (ต่างจาก `/checkout` ที่เป็น bearer link ไม่มี session)
- **สิทธิ์**: ใช้ `report.view` เดิม ไม่เพิ่ม permission ใหม่ · signed-in ไม่มีสิทธิ์ → 403 · signed-out → ปุ่มไป
  `/admin/login?next=/live-dashboard`
- **แก้ `/admin/login` ให้ redirect ตาม `?next=` จริง** — เดิมอ่าน `sp.get("next")` มาเก็บใน `const next` แล้ว
  **hardcode `router.replace("/admin")` ทิ้ง** (ตัวแปรถูกอ่านแต่ไม่ถูกใช้) ทำให้ลิงก์ที่ส่ง `?next=` มาเด้งผิดที่ทุกครั้ง
- **`?demo=1`** = ข้าม session/permission ทั้งหมดเพื่อ preview เลย์เอาต์ — **ปลอดภัยเฉพาะตอนที่หน้ายังไม่มีข้อมูลจริง
  เท่านั้น ต้องกลับมาทบทวนตอนต่อ query จริง** (ไม่งั้นกลายเป็นช่องดูยอดขายร้านโดยไม่ต้องล็อกอิน)
- **ปุ่มเข้าหน้านี้** อยู่ใน `HeaderBar.tsx` — desktop quick actions + เมนู "..." ของ mobile/tablet, i18n key
  `header.liveDashboard` (th/en)
- **ผู้ชมสด/Conversion/คอมเมนต์ คนละเรื่องกับ field อื่นในหน้า** — ไม่ใช่ "ยังไม่ต่อ" แต่ **ไม่มีข้อมูลใน BMS ให้ต่อเลย**
  ต้องต่อ Live API รายแพลตฟอร์มก่อน (Facebook/TikTok/Shopee/Lazada Live) จึงวางไว้ล่างสุดบนการ์ดเส้นประ ·
  Conversion คำนวณไม่ได้จนกว่าจะมี viewer จริง

### บทเรียนจากรอบนี้ (สำคัญกว่าตัวฟีเจอร์)

- **⚠️ `.jachoei-header-shell` เคยจองคอลัมน์กลาง `minmax(500px, 1fr)` ไว้ทั้งที่มันว่างเปล่าตอน login แล้ว**
  (`SHOW_HEADER_SEARCH = false` และ product nav render เฉพาะตอนยังไม่ login) → พอเพิ่มปุ่ม Live Dashboard เป็นปุ่มที่ 3
  ในคอลัมน์ขวา ความกว้างรวมทะลุ viewport ทำให้ **ทั้งเอกสารเลื่อนแนวนอน** ลากเอา header (sticky, กว้างเท่าเอกสาร)
  ไปด้วย ปุ่มขวาสุดถูกตัดออกจอ **ทุกหน้าในเว็บ ไม่ใช่แค่หน้าใหม่** · แก้เป็น `minmax(0, 1fr)` ทั้ง 3 breakpoint +
  `min-width:0` ที่ `.jachoei-header-right` + ยุบ label ปุ่ม Live เป็นไอคอนเมื่อ ≤1399px (มี `Tooltip`/`aria-label`)
  · **เสียเวลาหลายรอบเพราะไปแก้ CSS ในหน้าใหม่ก่อน ทั้งที่ต้นเหตุอยู่ที่ header ที่ใช้ร่วมทุกหน้า** — คราวหน้าถ้าเห็น
  หน้าเลื่อนแนวนอน ให้วัด `document.documentElement.scrollWidth` เทียบ `innerWidth` แล้วไล่หา element ที่ `right`
  เกินขอบก่อน อย่าเดาจากภาพ
- **`<style>{...}</style>` ในไฟล์นี้เป็น CSS ธรรมดา ไม่ใช่ CSS Module/styled-jsx** → `:global(...)` ข้างในเป็น CSS
  ที่ถูกทิ้งเงียบ ๆ (เผลอเขียนไปแล้วจับได้ตอน verify) ต้อง target `.ant-alert-description` ตรง ๆ แบบ descendant selector
- **กราฟ 2 เส้นต้อง normalize ด้วย max ร่วมกัน** — ตอนแรกให้ `trendPath()` หา max จากชุดตัวเองทำให้เส้น "ช่วงก่อนหน้า"
  สูงเท่าเส้น "ช่วงนี้" ตลอดและทับกัน = การเทียบไม่มีความหมาย (ตอนนี้รับ `max` เป็น param บังคับ)
- **มือถือ: แบนเนอร์เตือนกิน ~370px จาก 812px** ดันตัวเลขจริงตกใต้ fold ทั้งหมด ซึ่งขัดกับเหตุผลของหน้า → ซ่อนเฉพาะ
  `.ant-alert-description` ที่ ≤640px เหลือ 61px (ป้าย "ตัวอย่าง" ยังอยู่ครบ ไม่ได้ลดความชัดเจน) · sidebar กลายเป็น
  **แถบการ์ดเลื่อนแนวนอน** (แพทเทิร์นเดียวกับ filter strip ของ Inbox) · ตารางห่อ `.ld-table-wrap` (`overflow-x:auto`)
  ให้เลื่อนในกรอบตัวเอง ไม่ดันหน้า
- **fullscreen**: สไตล์ผูกกับ CSS `:fullscreen` ไม่ใช่ class จาก React state (สไตล์จะขัดกับสถานะจริงของเบราว์เซอร์ไม่ได้)
  และ `fullscreenchange` เป็นแหล่งความจริงเดียวของ label ปุ่ม — เดิม `setIsFullscreen` อัปเดตแค่ใน `.then()` ของปุ่ม
  กด Esc ออกแล้ว label ค้างเป็น "ออกจากเต็มจอ" · **เบราว์เซอร์ใน Claude Code (in-app pane) บล็อก Fullscreen API เงียบ ๆ
  ไม่มี error** — verify ของจริงไม่ได้จากที่นี่ ต้องกดที่เครื่องผู้ใช้เอง (รอบนี้ทดสอบโดย mirror กฎ `:fullscreen` ลง
  class ทดสอบแล้ววัดค่าแทน: panel ยืดเต็ม 900px, dead space = 0, ฟอนต์ขยายตามที่ตั้ง)
- **ทริคเวลาต้องเปิดเบราว์เซอร์ตรวจแต่ docker dev ยึดพอร์ต 3000 อยู่**: เพิ่ม config `web-inspect` (`next dev -p 3001`)
  ใน `.claude/launch.json` ชั่วคราว แล้ว **ลบออกให้ `launch.json` กลับสภาพเดิมทุกครั้งหลังตรวจเสร็จ**

## สถานะปัจจุบัน

โมดูลเชิงปฏิบัติการครบแล้ว (ดูตาราง Build Status ใน CLAUDE.md) + **Customer 360 panel ใน Inbox เสร็จแล้ว** (ดูหัวข้อด้านบน)
+ **แท็บ "ลูกค้า"/merge/reorder เสร็จแล้ว** + **Shopee/Lazada beta scaffold เสร็จแล้ว** (ดู [docs/integrations/lazada.md](docs/integrations/lazada.md))
+ **Channel Health status เสร็จแล้ว** (ดูหัวข้อ § Channel Health ด้านบน — schema/service/webhook wiring/GraphQL/UI ครบ
เฉพาะ proactive external notification ที่ยังไม่ทำ).
+ **AI Provider Health เสร็จแล้ว** (ดูหัวข้อ § AI Provider Health ด้านบน — schema/service/GraphQL/UI ครบ
และ verify กับ DB/API จริงแล้ว เฉพาะ cron schedule จริงและ proactive external notification ที่ยังไม่ทำ).
+ **Realtime Diagnostics เสร็จแล้ว** (`/admin/inbox/realtime-diagnostics`) — `Emit` ทดสอบ PubSub/WS signal,
`Create Msg` สร้างข้อความ diagnostic ให้เห็นใน Inbox จริงโดยไม่ส่งออก platform.
+ **AI Free Tier + BYOK เสร็จแล้ว** (ดูหัวข้อ § AI Free Tier + BYOK ด้านบน — schema/service/GraphQL/UI ครบ
เฉพาะ proactive notification ตอน quota ใกล้หมดที่ยังไม่ทำ).
+ **AI tool-calling เสร็จแล้ว** (ดูหัวข้อ § AI tool-calling ด้านบน — customer surface (pipeline) +
staff assistant (`/admin/assistant`) ครบ A1/A2/A3, A3 เป็น propose-only ยิง mutation เดิม; conversion
บน shared key model แก้แล้วด้วยการจูน prompt + deterministic route ก่อน AI loop และมี eval suite
(`scripts/ai-eval/`) คุมไว้ — ดู § deterministic route และ § AI eval suites).
+ **Bulk product import (CSV/XLSX) เสร็จแล้ว** (ดูหัวข้อ § Bulk product import ด้านบน — `/admin/products`
ปุ่ม "นำเข้า", 1 mutation `bmsImportProducts` flag `commit` สำหรับ preview→commit, ห่อ `upsertProduct()` เดิม;
ยังไม่ได้ทดสอบ end-to-end ในเบราว์เซอร์จริง).
+ **AI catalog discovery + sales recovery เสร็จแล้ว** (ดูหัวข้อ § AI catalog discovery + sales recovery
ด้านบน — `browse_catalog`/`list_new_arrivals`/`find_alternatives` + service `listSellableProducts()`/
`findAlternativeProducts()`, ของหมด/ไม่พบตอบพร้อมทางเลือกจริงแล้ว, Thai NLU ภาษาพูด + ยกเลิก draft ชัดเจน,
eval `BMS_EVAL_MODE=natural`; ยังไม่ได้ apply migration `7.33` เข้า docker/production จริงและยังไม่ได้รัน
natural suite กับ live model).
+ **Public checkout เสร็จแล้ว** (ดูหัวข้อ § Public checkout ด้านบน — ออร์เดอร์จากแชททุกใบได้ signed link
`/checkout?t=...` แบบ deterministic, reuse ข้อมูลจัดส่งเดิม, อัปสลิปเป็น `PENDING` แล้วให้คนกด Confirm;
ไม่มี migration ใหม่ แต่ต้องตั้ง `BMS_CHECKOUT_SECRET` ก่อน production และยังไม่ได้ทดสอบในเบราว์เซอร์จริง).
+ **Sales digest reports เสร็จแล้ว** (ดูหัวข้อ § Sales digest reports ด้านบน — subscription ต่อร้าน
ส่งสรุปยอดขายรายวัน/สัปดาห์/เดือนผ่านอีเมล/Slack/LINE, กันส่งซ้ำด้วย `last_period_key`, การ์ดตั้งค่าที่
`/admin/settings` + หน้า audit ข้ามร้าน `/admin/report-schedule`; verify กับ dev instance จริงแล้วรวมถึง
ส่ง EMAIL จริงสำเร็จ 1 ครั้ง — ยังไม่ได้ตั้ง cron schedule จริง).
+ **Redis infra hardening + Cron/batch run history เสร็จแล้ว** (ดูหัวข้อ § Redis: เอา queue โซเชียลออก...
และ § Cron/batch run history จริง ด้านบน — เอา job queue โซเชียลที่ไม่เกี่ยว BMS ออกทั้งชุด, Redis client
ซ้ำ 3→1, เพิ่ม cache layer (`lib/cache.ts`) + admin session revocation (`lib/redisSession.ts`) + AOF
persistence, และ `bms_job_runs` (migration `7.53`) ให้ `/admin/operations-schedule` เห็น run history จริง
ของทั้ง 4 cron endpoint + `daily-log-triage`; ยังไม่ verify กับ DB จริงบนเครื่องนี้ (`tsc` ผ่านสะอาดเท่านั้น),
Redis ยังไม่มี password/TLS, session revocation ครอบคลุมแค่ฝั่ง admin).
+ **Live Dashboard เลย์เอาต์เสร็จแล้ว แต่ยังเป็น mock ทั้งหมด** (ดูหัวข้อ § Live Dashboard ด้านบน — `/live-dashboard`
เป็น public route ที่ใช้ session เดิม, ปุ่มเข้าอยู่ใน HeaderBar, มี fullscreen + responsive มือถือ; **ยังไม่ต่อ query
จริงเลยแม้แต่ตัวเดียว** ทุกตัวเลขเป็น `MOCK_*` + ป้าย "ตัวอย่าง" + `// TODO(real):`).
+ **Follow-up Automation MVP core เสร็จแล้ว แต่ยังไม่ verify กับ DB จริง** (ดูหัวข้อ § Follow-up Automation
ด้านบน — migration `7.52`, `lib/bms/followups.ts` (rule engine + scheduler + AI message generation),
cron `/api/bms/followups/run`, `/admin/followup-rules` + `/admin/followup-queue`; **ตัด scope เหลือแค่
MVP core ตามที่ user เลือก** — ไม่มี Workflow Engine/Scoring model/Analytics dashboard ในรอบนี้ ดูเหตุผล
เต็มในหัวข้อนั้น. ยังไม่ได้ apply migration เข้า docker/production จริงและยังไม่ได้ทดสอบ end-to-end).
+ **Carrier booking/tracking sync (โครงความปลอดภัย) เสร็จแล้ว แต่ adapter จริงยังไม่มี** (ดู bullet
carrier booking hardening ใน § Carrier scaffold ด้านบน + [docs/integrations/carriers.md](docs/integrations/carriers.md)
— migration `7.76`/`7.77`, ยิง carrier นอก transaction, shipment UUID เป็น idempotency key,
booking ที่ล้มเหลวเห็นได้/retry ได้จาก `/admin/shipment`, tracking sync re-lock + เก็บ event history,
cron `POST /api/bms/shipping/sync-carriers`; **Flash/Kerry ยังเป็น mock-ready scaffold** —
`getStatus()` = `not_implemented` แม้ใส่ key เพราะยังไม่มีเอกสาร merchant จริง).

**เหลือ:** ต่อข้อมูลจริงให้ `/live-dashboard` (query มีพร้อมหมดแล้ว: `bmsOperationalAlerts`,
`bmsSalesSummary().byChannel`, `salesDaily[]`, `bmsOrders(limit)`, `bmsChannelHealth` — ยกเว้นผู้ชม/Conversion/
คอมเมนต์ที่ต้องต่อ Live API รายแพลตฟอร์มก่อน) และทบทวน `?demo=1` ตอนนั้น ·
TikTok send API · live adapter ของ Flash/Kerry (โครง booking/tracking/label + migration `7.76`/`7.77`
พร้อมแล้ว เหลือแค่สัญญา/เอกสาร merchant จริง แล้วทำตาม checklist ใน
[docs/integrations/carriers.md](docs/integrations/carriers.md)) ·
AI OCR/forecasting (นอกเหนือจาก payment-slip verify) ·
WhatsApp/Email/Voice AI ·
Shopee/Lazada signature verification กับเอกสาร Open Platform ตัวจริง (ยังไม่ผลิตจริงได้) ·
Customer 360 pending items ที่เหลือ (ดู "Pending improvements" ในหัวข้อ Customer 360)
· ตั้ง cron schedule จริงให้ `/api/bms/orders/release-expired`, `/api/bms/channels/check-health`,
`/api/bms/ai/check-health`, `/api/bms/reports/send-digest`, `/api/bms/followups/run`, และ
`/api/bms/shipping/sync-carriers` (แนะนำทุก 15 นาที) — ทั้ง 6 endpoint พร้อมแล้วและบันทึก run history
จริงลง `bms_job_runs` ทุกครั้งที่ถูกเรียก (ดู § Cron/batch run history จริง) แค่ยังไม่มีตัวยิงอัตโนมัติ ·
เพิ่ม password/TLS ให้ Redis ก่อน production จริง (ดู § Redis ด้านบน)
· proactive external notification สำหรับ Channel Health และ AI Provider Health (ต้องออกแบบ LINE user id
ผูก admin ก่อน — ดู § Channel Health และ § AI Provider Health)
· apply migration `7.33` เข้า docker/production จริง + รัน `BMS_EVAL_MODE=natural` กับ live model
· apply migration `7.52` เข้า docker/production จริง + ทดสอบ Follow-up Automation end-to-end ·
Follow-up Automation's Workflow Engine, Scoring model, Analytics dashboard (ดู § Follow-up Automation)

## Multi-instance readiness — เตรียมแยก server (2026-08)

รายละเอียดเต็ม (pg pool ceiling, Redis-backed rate limit, storage driver abstraction, cron
claim-before-act fixes, `ws` Postgres removal, verification results, known gaps) ย้ายไปที่
[docs/architecture/multi-instance-readiness.md](docs/architecture/multi-instance-readiness.md)

## ก่อน production (สำคัญ)

- เปิดตรวจรหัสผ่านใน loginAdmin (dev ยังไม่ตรวจ)
- ตั้ง env `BMS_SECRET_KEY` (hex 64) — ไม่งั้นใช้ dev key เข้ารหัส token
- ตั้ง `JWT_SECRET` ให้แน่น — ใช้เซ็นทั้ง session token + cookie drill-down `BMS_ACT_TENANT`
- ตั้ง `BMS_CHECKOUT_SECRET` (ถ้าไม่ตั้งจะ fallback ไป `JWT_SECRET` ตาม compose; ถ้าไม่มีทั้งคู่
  production จะ throw ตอนสร้าง/verify ลิงก์ checkout) — หมุนค่านี้เมื่อไหร่ ลิงก์ที่ส่งให้ลูกค้าไปแล้ว
  จะใช้ไม่ได้ทันทีทั้งหมด
- ตั้ง `NEXT_PUBLIC_BASE_URL` ให้ตรงโดเมนจริง — `createCheckoutUrl()` ใช้ค่านี้ประกอบลิงก์ที่ส่งหาลูกค้า
  (default hardcode `https://bms.jachoei.com`)
- ให้ app ต่อ DB ด้วย role non-superuser เพื่อให้ RLS มีผลกับ read
- apply migration `5.6` (platform admin) + `5.7` (operational perms) · seed platform admin ชุดแรก = Administrator ของร้าน default
- ~~ย้าย rate-limit webhook ไป Redis~~ ✅ ทำแล้ว (ดู § Multi-instance readiness ด้านล่าง)
- `META_GRAPH_VERSION` (default v21.0) สำหรับ FB/IG send
- Lazada/Shopee webhook signature ต้อง verify กับเอกสาร Open Platform ตัวจริงก่อนใช้จริง (ตอนนี้ HMAC-SHA256 แบบ TikTok เป็นแค่ placeholder ที่ยังไม่ยืนยัน — ดู [docs/integrations/lazada.md](docs/integrations/lazada.md))
- fake seeder ปิดใน production · เปิดเฉพาะเครื่อง demo ด้วย `BMS_ALLOW_FAKE_SEED=1` (ร้านเทส seed มุมตัวเองได้)
- หน้าระดับแพลตฟอร์ม (ENV/Logs/Posts/Files/Queue/Architecture) gate ด้วย `layout.tsx` → `requirePlatformAdminPage()` (server-side, กัน shop user เข้าตรงผ่าน URL)
