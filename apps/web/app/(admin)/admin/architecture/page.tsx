'use client';
import { Anchor, Card, Col, Row, Table, Tag, Typography, Alert, Steps, Divider } from "antd";
import { resolveBilingual } from "@/lib/static-page-i18n";
import { useI18n } from "@/lib/i18nContext";

const { Title, Paragraph, Text } = Typography;

// เอกสารหน้านี้เป็น dev reference ล้วน (platform admin เท่านั้น, ข้อความหนาแน่นเชิงเทคนิค) — ใช้
// resolveBilingual() แบบ page-local content object ต่างจากหน้าอื่นที่ใช้ i18n dictionary กลาง
// เพราะเนื้อหาเป็นก้อนใหญ่ต่อหัวข้อ ไม่ใช่ label สั้น ๆ ที่ควรแยก key ละเอียด
const CONTENT = {
  th: {
    pageTitle: "🏗️ Architecture & Requirements",
    pageSubtitle: "เอกสารสถาปัตยกรรมสำหรับนักพัฒนา — data model, webhook flow, security model, billing",
    anchors: [
      "1. ภาพรวมสถาปัตยกรรม", "2. Data model (ERD)", "3. Webhook sequence",
      "4. Multi-tenancy & Security", "5. RBAC model", "6. Billing & Quota",
      "7. Migrations", "8. Observability & Log Triage", "9. Production checklist",
      "10. Customer 360 & SaaS roadmap",
    ],
    tocTitle: "สารบัญ",
    tables: [
      { t: "bms_tenants", pk: "id (uuid)", cols: "name, slug (uniq), plan, active", note: "ร้าน/องค์กร (root ของ SaaS)" },
      { t: "bms_tenant_channels", pk: "id", cols: "tenant_id, channel, access_token🔒, channel_secret🔒, active", note: "creds LINE/TikTok ต่อร้าน (เข้ารหัส)" },
      { t: "bms_plans", pk: "code", cols: "name, price_monthly, max_products, max_channels, max_orders_month", note: "แพ็กเกจ + limit" },
      { t: "users", pk: "id", cols: "email, password_hash, role, role_id, tenant_id", note: "ผู้ใช้ (สังกัด 1 tenant)" },
      { t: "roles", pk: "id", cols: "name (global)", note: "ชื่อ role (แชร์ระบบ)" },
      { t: "bms_role_permissions", pk: "(tenant_id, role_id, permission)", cols: "tenant_id, role_id, permission", note: "RBAC per-tenant (แต่ละร้านกำหนดเอง)" },
      { t: "bms_audit_log", pk: "id", cols: "tenant_id, actor, action, target, meta", note: "บันทึกการกระทำ admin" },
      { t: "bms_products", pk: "(tenant_id, sku)", cols: "name, price, keywords[], barcode, active", note: "สินค้า (sku ซ้ำข้ามร้านได้)" },
      { t: "bms_inventory", pk: "(tenant_id, product_sku, size)", cols: "current_stock, reserved_stock, reorder_point", note: "สต็อกต่อไซซ์ · FK→products" },
      { t: "bms_orders", pk: "id (uuid)", cols: "tenant_id, channel, customer_id, customer_ref, status, total_amount", note: "ออเดอร์ · FK→customers" },
      { t: "bms_order_items", pk: "id", cols: "tenant_id, order_id, product_sku, size, qty, unit_price", note: "FK→orders, →products, →inventory" },
      { t: "bms_stock_movements", pk: "id", cols: "tenant_id, product_sku, size, type, qty, ref_order_id, actor", note: "ledger การเคลื่อนไหวสต็อก" },
      { t: "bms_customers", pk: "id (uuid)", cols: "tenant_id, name, phone, email, preferred_language, timezone, tags[], deleted_at", note: "ลูกค้า (soft delete) · email/language/timezone เพิ่มใน 6.2" },
      { t: "bms_customer_identities", pk: "id", cols: "tenant_id, customer_id, channel, external_ref, display_name, picture_url", note: "map ช่องทาง→ลูกค้า + cache profile ช่องทาง · uniq(tenant,channel,ref)" },
      { t: "bms_customer_addresses", pk: "id", cols: "tenant_id, customer_id, label, address, address_type, is_default", note: "หลายที่อยู่/คน · address_type=shipping/billing (6.2)" },
      { t: "bms_customer_ai_summary", pk: "customer_id", cols: "tenant_id, customer_id, summary(jsonb), facts_hash, generated_at", note: "แคชสรุป AI Insights ต่อลูกค้า (6.2) — regenerate เฉพาะ facts_hash เปลี่ยน" },
      { t: "bms_suppliers", pk: "id (uuid)", cols: "tenant_id, name, phone, email · uniq(tenant,name)", note: "ผู้ขาย (Purchase)" },
      { t: "bms_purchase_orders", pk: "id (uuid)", cols: "tenant_id, supplier_id, status, total_amount", note: "PO · OPEN→PARTIAL→RECEIVED" },
      { t: "bms_purchase_order_items", pk: "id", cols: "tenant_id, po_id, product_sku, size, qty_ordered, qty_received, unit_cost", note: "รายการ PO · FK→products" },
      { t: "bms_payments", pk: "id (uuid)", cols: "tenant_id, order_id, method, amount, status, slip_url, verify_result(jsonb)", note: "การชำระ · FK→orders" },
      { t: "bms_shipments", pk: "id (uuid)", cols: "tenant_id, order_id, carrier, tracking_no, status, label_url", note: "จัดส่ง · FK→orders" },
      { t: "bms_conversations", pk: "id (uuid)", cols: "tenant_id, channel, customer_ref, customer_id, status, assigned_to, tags[], unread", note: "Inbox · uniq(tenant,channel,ref)" },
      { t: "bms_messages", pk: "id", cols: "tenant_id, conversation_id, direction(IN/OUT), body, sender", note: "ข้อความ · FK→conversations" },
      { t: "bms_conversation_notes", pk: "id", cols: "tenant_id, conversation_id, author, body", note: "โน้ตภายใน · FK→conversations" },
    ],
    tableColTable: "Table", tableColPk: "PK", tableColCols: "คอลัมน์หลัก", tableColNote: "หมายเหตุ",
    rels: [
      { p: "bms_tenants", c: "ทุกตาราง BMS", k: "tenant_id" },
      { p: "bms_products (tenant_id, sku)", c: "bms_inventory / bms_order_items / bms_stock_movements", k: "(tenant_id, product_sku)" },
      { p: "bms_inventory", c: "bms_order_items", k: "(tenant_id, product_sku, size)" },
      { p: "bms_orders", c: "bms_order_items", k: "order_id" },
      { p: "bms_customers", c: "bms_orders / identities / addresses / conversations", k: "customer_id" },
      { p: "bms_orders", c: "bms_payments / bms_shipments", k: "order_id" },
      { p: "bms_suppliers", c: "bms_purchase_orders", k: "supplier_id" },
      { p: "bms_purchase_orders", c: "bms_purchase_order_items", k: "po_id" },
      { p: "bms_conversations", c: "bms_messages / bms_conversation_notes", k: "conversation_id" },
      { p: "bms_plans (code)", c: "bms_tenants.plan", k: "plan code" },
      { p: "bms_customers", c: "bms_customer_ai_summary", k: "customer_id (PK ตรง, ไม่ FK tenant ซ้ำ)" },
    ],
    relsHeading: "ความสัมพันธ์ (FK)",
    relColParent: "Parent", relColChild: "Child", relColKey: "Key",
    erdCaption: <>แผนภาพแสดง<b>ตารางแกน</b> (tenant + สินค้า/ออเดอร์/ลูกค้า) · โมดูลเชิงปฏิบัติการ (purchase / payment / shipping / inbox) ผูกกับ orders/customers ตามตารางด้านล่าง</>,
    erdRootSub: "root (ร้าน)",
    webhookSteps: [
      { title: "ลูกค้าส่งข้อความ", description: "LINE ยิง POST → /api/bms/line/webhook/{tenantId}" },
      { title: "โหลด channel ของร้าน", description: "getChannel(tenantId,'line') → decrypt token/secret · ถ้าไม่มี/ปิด → 200 skipped" },
      { title: "Verify signature", description: "HMAC-SHA256(channel_secret, rawBody) == X-Line-Signature? · ไม่ตรง → 401" },
      { title: "NLU + business logic", description: "runPipeline(text, 'line', tenantId, userId) → intent → checkStock/createOrder (RLS-scoped)" },
      { title: "ตอบกลับ", description: "LINE reply API ด้วย access_token ของร้านนั้น" },
    ],
    migrations: [
      "3.2 products+inventory", "3.3 orders", "3.4 IMS (barcode/reorder/ledger)",
      "3.5 OMS states", "3.6 CRM", "3.7 RBAC",
      "4.0 multi-tenant (tenant_id + re-key)", "4.1 users.tenant_id",
      "4.2 RLS policies", "4.3 RLS role (bms_app)", "5.0 plans",
      "5.1 per-tenant RBAC + audit log", "5.2 purchase (suppliers/PO)",
      "5.3 payments", "5.4 shipments", "5.5 inbox (conversations/messages/notes)",
      "5.6 platform admin", "5.7 operational perms", "5.8 max_users quota",
      "5.9 product detail (image/cost/category/brand)", "6.0 product categories",
      "6.1 inbox assignment (helpers)", "6.2 customer 360 (email/timezone/address_type + AI summary cache)",
    ],
    s1Title: "1. ภาพรวมสถาปัตยกรรม",
    s1StackIntro: <>Stack: <Tag>Next.js (App Router)</Tag><Tag>GraphQL (Apollo/yoga)</Tag><Tag>PostgreSQL (pg)</Tag><Tag>Redis pub/sub</Tag> — โครง BMS ทั้งหมดเป็น layer บนโปรเจกต์เดิม</>,
    s1LayersIntro: "เลเยอร์:",
    s1Layer1: <><b>Channel/Webhook</b> (route ต่อ tenant: LINE/TikTok/FB/IG/Web) → <b>Pipeline/NLU</b> (lib/bms/pipeline) → <b>Domain services</b> → <b>Postgres</b> · ทุกแชทถูก log ลง Inbox</>,
    s1Layer2: <><b>Domain services</b> (lib/bms/*): products, orders, purchase, payments, shipping, inbox, customers, reports, plans — ที่เดียวใช้ร่วมทั้ง REST + GraphQL (ไม่ซ้ำตรรกะ)</>,
    s1Layer3: <><b>Admin UI</b> (antd + Apollo) → <b>GraphQL resolvers</b> (graphql/bms*) → domain services เดียวกัน</>,
    s1Layer4: <>ทุก service รับ <Text code>tenantId</Text> + scope query · write-tx เพิ่ม RLS (role bms_app)</>,
    s1Alert: "order lifecycle ครบวงจร: order → payment (confirm) → shipping (create → delivered) โดยแต่ละ service เดินสถานะ order ให้เอง (atomic) และบันทึก stock movement ทุกครั้งที่สต็อกขยับ",
    s2Title: "2. Data model",
    s3Title: "3. Webhook sequence (LINE)",
    s3Warning: "Failure paths: signature ไม่ตรง → 401 · channel ยังไม่เชื่อม → 200 skipped (กัน LINE retry) · order oversell → rollback",
    s3Other: <>ช่องทางอื่นใช้โครงเดียวกัน: <b>TikTok</b> (HMAC hex header) · <b>Facebook/Instagram</b> (GET verify hub.challenge + POST verify X-Hub-Signature-256, ตอบผ่าน Graph Send API) · <b>Website Live Chat</b> (public + CORS, ตอบใน HTTP response ทันที). ทุกช่องทางเรียก <Text code>runPipeline</Text> + <Text code>logConversation</Text> เดียวกัน → เข้า Inbox อัตโนมัติ · reply ออกจริงผ่าน <Text code>deliverToChannel()</Text> (LINE push / FB-IG Graph; TikTok ยัง persist-only)</>,
    s3Diag: <><Text code>/admin/inbox/realtime-diagnostics</Text> ใช้แยกทดสอบสองชั้น: <Text code>Emit</Text> ตรวจ Redis/WebSocket signal
      โดยไม่เขียน DB และ <Text code>Create Msg</Text> สร้างข้อความ diagnostic ใน Inbox จริงโดยไม่ยิงออกแพลตฟอร์ม.</>,
    s4Title: "4. Multi-tenancy & Security",
    s4Items: [
      <><b>Isolation ชั้น 1 (app):</b> ทุก query filter <Text code>tenant_id</Text>; tenantId มาจาก JWT ของ admin (<Text code>getTenantId(ctx)</Text>) หรือ webhook path</>,
      <><b>Isolation ชั้น 2 (RLS):</b> write-transaction ทำ <Text code>SET LOCAL ROLE bms_app; set_config('bms.tenant_id',...)</Text> → policy บังคับ tenant_id ตรง → เขียนข้ามร้านไม่ได้แม้ WHERE พลาด</>,
      <><b>Secret encryption:</b> token/secret เข้ารหัส AES-256-GCM ก่อนเก็บ (<Text code>lib/bms/crypto</Text>)</>,
      <><b>Webhook auth:</b> verify signature (HMAC + timingSafeEqual) ต่อร้าน</>,
      <><b>RBAC:</b> ทุก resolver <Text code>requirePermission(ctx, perm)</Text> (per-tenant) + UI ซ่อนปุ่มตามสิทธิ์</>,
      <><b>Rate limit:</b> webhook จำกัด 120 req/นาที ต่อร้าน (fixed-window; prod → Redis) → เกิน = 429</>,
      <><b>Audit log:</b> ทุก mutation สำคัญ (order/product/stock/channel/plan/rbac) บันทึกใน <Text code>bms_audit_log</Text> (ใคร/ทำอะไร/เมื่อไร) — ดูที่เมนู Audit log</>,
    ],
    s5Title: "5. RBAC model",
    s5Body: <>Permission แบบ <Text code>resource.action</Text> (26 ตัว: product.* · stock.adjust · order.* · purchase.* · payment.* · shipping.* · inbox.* · customer.* · report.view)
      → เก็บใน <Text code>bms_role_permissions</Text> <b>per-tenant</b> (PK = tenant_id+role_id+permission)
      · <b>Administrator</b> = super (bypass) · โหลดสิทธิ์ cache ต่อ request · signup คัดลอก template ให้ร้านใหม่
      · เพิ่ม/แก้ permission ในโค้ดที่ <Text code>BMS_PERMISSIONS</Text> (lib/bms/permissions.ts) แล้วโผล่ในเมนู Permissions อัตโนมัติ</>,
    s5Alert: "Per-tenant RBAC: แต่ละร้านปรับสิทธิ์ role ของตัวเองได้อิสระ ไม่กระทบร้านอื่น (เมนู Permissions)",
    s6Title: "6. Billing & Quota",
    s6Items: [
      <><Text code>bms_plans</Text>: free/pro/business + limit (สินค้า/ช่องทาง/ออเดอร์ต่อเดือน; -1 = ไม่จำกัด)</>,
      <><Text code>bms_tenants.plan</Text> อ้าง plan code · <Text code>enforceProductQuota()</Text> เช็คตอนสร้างสินค้าใหม่ → เกิน = error</>,
      <>Billing เป็น <b>mock</b> (เปลี่ยนแพ็กเกจได้ทันที ยังไม่ต่อ payment gateway) — ต่อ Stripe/Omise ภายหลังที่ <Text code>changePlan()</Text></>,
    ],
    s7Title: "7. Migrations (db/migrations)",
    s7Note: "apply ตามลำดับ · 4.0 เป็น idempotent (รันซ้ำได้)",
    s8Title: "8. Observability & Daily Log Triage",
    s8Body: <>log แบบ structured เก็บใน <Text code>system_logs</Text> (level/category/message/error_message/stack/status/route_name/created_at)
      เขียนผ่าน <Text code>lib/logger.ts</Text> — ใช้เป็นแหล่งให้ระบบ triage อัตโนมัติ</>,
    s8Steps: [
      { title: "Cron รายวัน (GitHub Actions)", description: <><Text code>.github/workflows/daily-log-triage.yml</Text> — 22:00 UTC (~09:00 AEST) หรือกด Run เอง</> },
      { title: "ดึง + redact log", description: <><Text code>scripts/bms-log-triage/collect-error-logs.mjs</Text> — error 24 ชม.ล่าสุด, จัดกลุ่ม/dedupe, ปิดบัง email/phone/token/api-key/enc/hex/ip → <Text code>bms-log-report.md</Text></> },
      { title: "Claude วิเคราะห์ + เสนอแพตช์", description: "อ่าน report → หา root cause ใน apps/web → แก้เฉพาะที่มั่นใจ (minimal) → npx tsc เช็ค" },
      { title: "เปิด draft PR", description: "branch bot/log-triage-<วันที่> → base main → คนรีวิว/merge เอง" },
      { title: "แจ้งเตือน LINE", description: <>push ผ่าน LINE Messaging API (<Text code>scripts/bms-log-triage/notify-line.mjs</Text>) พร้อมลิงก์ PR — LINE Notify ปิดบริการแล้ว จึงใช้ push ของ OA ทีม ops (ไม่ตั้ง secret = ข้าม)</> },
    ],
    s8Warning: "Guardrails: draft PR เสมอ (ไม่ auto-merge/deploy) · redact ก่อนส่งออก (data residency AU/UK) · AI ห้ามแตะ migration/secret/config · secrets: BMS_LOG_DATABASE_URL (READ-ONLY), ANTHROPIC_API_KEY + (ทางเลือก) LINE_OPS_TOKEN, LINE_OPS_TO",
    s8Note: <>ไม่อยากส่ง log ออก cloud → ใช้ self-hosted runner ในวงเน็ตเวิร์ก (แก้ <Text code>runs-on</Text>) · ดู <Text code>scripts/bms-log-triage/README.md</Text></>,
    s9Title: "9. Production checklist",
    s9AlertMsg: "ต้องทำก่อนขายจริง",
    s9Items: [
      <>เปิด <Text code>bcrypt.compare</Text> ใน loginAdmin (ตอนนี้ dev ไม่ตรวจรหัสผ่าน)</>,
      <>ตั้ง env <Text code>BMS_SECRET_KEY</Text> (hex 64) — ไม่งั้นใช้ dev key</>,
      <>ให้ app เชื่อม DB ด้วย role non-superuser (หรือ GRANT bms_app TO app) เพื่อให้ RLS มีผลกับ read</>,
      <>ต่อ payment gateway จริงใน <Text code>changePlan</Text> + enforce order/message quota</>,
      <>ย้าย rate-limit ไป Redis (ตอนนี้ in-memory ต่อ instance) · เพิ่ม audit ให้ครบทุก mutation</>,
    ],
    s10Title: "10. Customer 360 & SaaS roadmap",
    s10Body: <>Inbox (<Text code>/admin/inbox</Text>) เป็น <b>3 คอลัมน์จริง</b>: รายการแชท · แชท · <b>Customer 360 panel</b> (<Text code>Customer360Panel.tsx</Text>).
      เลือกแชท → resolve <Text code>customerId</Text> (nullable — บางแชทยังไม่ผูกลูกค้า) → eager query <Text code>bmsCustomer360</Text> (7 ส่วนแรก, เบา)
      + lazy query <Text code>bmsCustomerTimeline</Text>/<Text code>bmsCustomerInsights</Text> (โหลดตอนกาง section เท่านั้น) — service ทั้งหมดอยู่ที่ <Text code>lib/bms/customer360.ts</Text>, gate ด้วยสิทธิ์ <Text code>customer.view</Text> เดิม (ไม่มีสิทธิ์ใหม่)</>,
    s10Items: [
      <><b>AI Insights:</b> Claude สรุปจาก "facts bundle" ที่ backend คำนวณแล้วเท่านั้น (จำนวนออเดอร์/มูลค่า/สินค้ายอดนิยม ฯลฯ) — ห้ามเดา/แต่งตัวเลขหรือคำแนะนำที่ไม่มีข้อมูลรองรับ (แพทเทิร์นเดียวกับ <Text code>verifyPaymentSlip()</Text>) แคชผลใน <Text code>bms_customer_ai_summary</Text> ด้วย hash ของ facts กัน re-generate ทุกครั้งที่เปิดแชท</>,
      <><b>"ตะกร้าปัจจุบัน":</b> สคีมาไม่มีสถานะ DRAFT แยก — คือ order <Text code>PENDING</Text> ล่าสุดที่ยังไม่มี payment ผูกอยู่</>,
      <><b>Quick Actions ที่ยัง disable:</b> Generate Invoice / Send Payment Link / Support Ticket — subsystem จริงยังไม่มีในระบบ (ตัดสินใจไว้แล้วว่าไม่ build รอบนี้) ไม่ใช่บั๊ก</>,
    ],
    s10AlertMsg: "Shopee/Lazada ปัจจุบันเป็น webhook beta scaffold ไม่ใช่ OAuth sync worker",
    s10AlertDesc: <>รายละเอียดเต็ม: <Text code>docs/integrations/lazada.md</Text> และ <Text code>docs/local-notes-archive.md</Text> § SaaS redesign — แผน OAuth/Channel Sync เดิมถูก supersede แล้ว ต้องออกแบบใหม่ก่อนหยิบกลับมาทำ</>,
  },
  en: {
    pageTitle: "🏗️ Architecture & Requirements",
    pageSubtitle: "Architecture reference for developers — data model, webhook flow, security model, billing",
    anchors: [
      "1. Architecture overview", "2. Data model (ERD)", "3. Webhook sequence",
      "4. Multi-tenancy & Security", "5. RBAC model", "6. Billing & Quota",
      "7. Migrations", "8. Observability & Log Triage", "9. Production checklist",
      "10. Customer 360 & SaaS roadmap",
    ],
    tocTitle: "Contents",
    tables: [
      { t: "bms_tenants", pk: "id (uuid)", cols: "name, slug (uniq), plan, active", note: "Shop/org (SaaS root)" },
      { t: "bms_tenant_channels", pk: "id", cols: "tenant_id, channel, access_token🔒, channel_secret🔒, active", note: "LINE/TikTok creds per shop (encrypted)" },
      { t: "bms_plans", pk: "code", cols: "name, price_monthly, max_products, max_channels, max_orders_month", note: "Plans + limits" },
      { t: "users", pk: "id", cols: "email, password_hash, role, role_id, tenant_id", note: "Users (belong to 1 tenant)" },
      { t: "roles", pk: "id", cols: "name (global)", note: "Role names (system-wide)" },
      { t: "bms_role_permissions", pk: "(tenant_id, role_id, permission)", cols: "tenant_id, role_id, permission", note: "Per-tenant RBAC (each shop sets its own)" },
      { t: "bms_audit_log", pk: "id", cols: "tenant_id, actor, action, target, meta", note: "Admin action log" },
      { t: "bms_products", pk: "(tenant_id, sku)", cols: "name, price, keywords[], barcode, active", note: "Products (SKU can repeat across shops)" },
      { t: "bms_inventory", pk: "(tenant_id, product_sku, size)", cols: "current_stock, reserved_stock, reorder_point", note: "Stock per size · FK→products" },
      { t: "bms_orders", pk: "id (uuid)", cols: "tenant_id, channel, customer_id, customer_ref, status, total_amount", note: "Orders · FK→customers" },
      { t: "bms_order_items", pk: "id", cols: "tenant_id, order_id, product_sku, size, qty, unit_price", note: "FK→orders, →products, →inventory" },
      { t: "bms_stock_movements", pk: "id", cols: "tenant_id, product_sku, size, type, qty, ref_order_id, actor", note: "Stock movement ledger" },
      { t: "bms_customers", pk: "id (uuid)", cols: "tenant_id, name, phone, email, preferred_language, timezone, tags[], deleted_at", note: "Customers (soft delete) · email/language/timezone added in 6.2" },
      { t: "bms_customer_identities", pk: "id", cols: "tenant_id, customer_id, channel, external_ref, display_name, picture_url", note: "Channel→customer map + cached channel profile · uniq(tenant,channel,ref)" },
      { t: "bms_customer_addresses", pk: "id", cols: "tenant_id, customer_id, label, address, address_type, is_default", note: "Multiple addresses per person · address_type=shipping/billing (6.2)" },
      { t: "bms_customer_ai_summary", pk: "customer_id", cols: "tenant_id, customer_id, summary(jsonb), facts_hash, generated_at", note: "AI Insights cache per customer (6.2) — regenerates only when facts_hash changes" },
      { t: "bms_suppliers", pk: "id (uuid)", cols: "tenant_id, name, phone, email · uniq(tenant,name)", note: "Suppliers (Purchase)" },
      { t: "bms_purchase_orders", pk: "id (uuid)", cols: "tenant_id, supplier_id, status, total_amount", note: "PO · OPEN→PARTIAL→RECEIVED" },
      { t: "bms_purchase_order_items", pk: "id", cols: "tenant_id, po_id, product_sku, size, qty_ordered, qty_received, unit_cost", note: "PO line items · FK→products" },
      { t: "bms_payments", pk: "id (uuid)", cols: "tenant_id, order_id, method, amount, status, slip_url, verify_result(jsonb)", note: "Payments · FK→orders" },
      { t: "bms_shipments", pk: "id (uuid)", cols: "tenant_id, order_id, carrier, tracking_no, status, label_url", note: "Shipments · FK→orders" },
      { t: "bms_conversations", pk: "id (uuid)", cols: "tenant_id, channel, customer_ref, customer_id, status, assigned_to, tags[], unread", note: "Inbox · uniq(tenant,channel,ref)" },
      { t: "bms_messages", pk: "id", cols: "tenant_id, conversation_id, direction(IN/OUT), body, sender", note: "Messages · FK→conversations" },
      { t: "bms_conversation_notes", pk: "id", cols: "tenant_id, conversation_id, author, body", note: "Internal notes · FK→conversations" },
    ],
    tableColTable: "Table", tableColPk: "PK", tableColCols: "Main columns", tableColNote: "Note",
    rels: [
      { p: "bms_tenants", c: "Every BMS table", k: "tenant_id" },
      { p: "bms_products (tenant_id, sku)", c: "bms_inventory / bms_order_items / bms_stock_movements", k: "(tenant_id, product_sku)" },
      { p: "bms_inventory", c: "bms_order_items", k: "(tenant_id, product_sku, size)" },
      { p: "bms_orders", c: "bms_order_items", k: "order_id" },
      { p: "bms_customers", c: "bms_orders / identities / addresses / conversations", k: "customer_id" },
      { p: "bms_orders", c: "bms_payments / bms_shipments", k: "order_id" },
      { p: "bms_suppliers", c: "bms_purchase_orders", k: "supplier_id" },
      { p: "bms_purchase_orders", c: "bms_purchase_order_items", k: "po_id" },
      { p: "bms_conversations", c: "bms_messages / bms_conversation_notes", k: "conversation_id" },
      { p: "bms_plans (code)", c: "bms_tenants.plan", k: "plan code" },
      { p: "bms_customers", c: "bms_customer_ai_summary", k: "customer_id (direct PK, no separate tenant FK)" },
    ],
    relsHeading: "Relationships (FK)",
    relColParent: "Parent", relColChild: "Child", relColKey: "Key",
    erdCaption: <>Diagram shows the <b>core tables</b> (tenant + products/orders/customers) · operational modules (purchase / payment / shipping / inbox) attach to orders/customers per the table below</>,
    erdRootSub: "root (shop)",
    webhookSteps: [
      { title: "Customer sends a message", description: "LINE POSTs to → /api/bms/line/webhook/{tenantId}" },
      { title: "Load the shop's channel", description: "getChannel(tenantId,'line') → decrypt token/secret · missing/disabled → 200 skipped" },
      { title: "Verify signature", description: "HMAC-SHA256(channel_secret, rawBody) == X-Line-Signature? · mismatch → 401" },
      { title: "NLU + business logic", description: "runPipeline(text, 'line', tenantId, userId) → intent → checkStock/createOrder (RLS-scoped)" },
      { title: "Reply", description: "LINE reply API using that shop's access_token" },
    ],
    migrations: [
      "3.2 products+inventory", "3.3 orders", "3.4 IMS (barcode/reorder/ledger)",
      "3.5 OMS states", "3.6 CRM", "3.7 RBAC",
      "4.0 multi-tenant (tenant_id + re-key)", "4.1 users.tenant_id",
      "4.2 RLS policies", "4.3 RLS role (bms_app)", "5.0 plans",
      "5.1 per-tenant RBAC + audit log", "5.2 purchase (suppliers/PO)",
      "5.3 payments", "5.4 shipments", "5.5 inbox (conversations/messages/notes)",
      "5.6 platform admin", "5.7 operational perms", "5.8 max_users quota",
      "5.9 product detail (image/cost/category/brand)", "6.0 product categories",
      "6.1 inbox assignment (helpers)", "6.2 customer 360 (email/timezone/address_type + AI summary cache)",
    ],
    s1Title: "1. Architecture overview",
    s1StackIntro: <>Stack: <Tag>Next.js (App Router)</Tag><Tag>GraphQL (Apollo/yoga)</Tag><Tag>PostgreSQL (pg)</Tag><Tag>Redis pub/sub</Tag> — the whole BMS layer sits on top of the original project</>,
    s1LayersIntro: "Layers:",
    s1Layer1: <><b>Channel/Webhook</b> (per-tenant route: LINE/TikTok/FB/IG/Web) → <b>Pipeline/NLU</b> (lib/bms/pipeline) → <b>Domain services</b> → <b>Postgres</b> · every chat is logged into Inbox</>,
    s1Layer2: <><b>Domain services</b> (lib/bms/*): products, orders, purchase, payments, shipping, inbox, customers, reports, plans — one place shared by REST + GraphQL (no duplicated logic)</>,
    s1Layer3: <><b>Admin UI</b> (antd + Apollo) → <b>GraphQL resolvers</b> (graphql/bms*) → the same domain services</>,
    s1Layer4: <>Every service takes <Text code>tenantId</Text> and scopes its query · write transactions add RLS (role bms_app)</>,
    s1Alert: "Full order lifecycle: order → payment (confirm) → shipping (create → delivered), with each service advancing order status itself (atomically) and recording a stock movement every time stock changes.",
    s2Title: "2. Data model",
    s3Title: "3. Webhook sequence (LINE)",
    s3Warning: "Failure paths: signature mismatch → 401 · channel not connected → 200 skipped (prevents LINE retry) · order oversell → rollback",
    s3Other: <>Other channels use the same shape: <b>TikTok</b> (HMAC hex header) · <b>Facebook/Instagram</b> (GET verify hub.challenge + POST verify X-Hub-Signature-256, replies via the Graph Send API) · <b>Website Live Chat</b> (public + CORS, replies directly in the HTTP response). Every channel calls the same <Text code>runPipeline</Text> + <Text code>logConversation</Text> → lands in Inbox automatically · outbound replies go through <Text code>deliverToChannel()</Text> (LINE push / FB-IG Graph; TikTok is still persist-only)</>,
    s3Diag: <><Text code>/admin/inbox/realtime-diagnostics</Text> tests two layers separately: <Text code>Emit</Text> checks the Redis/WebSocket signal
      without writing to the DB, and <Text code>Create Msg</Text> creates a real diagnostic message in Inbox without sending it out to any platform.</>,
    s4Title: "4. Multi-tenancy & Security",
    s4Items: [
      <><b>Isolation layer 1 (app):</b> every query filters on <Text code>tenant_id</Text>; tenantId comes from the admin's JWT (<Text code>getTenantId(ctx)</Text>) or the webhook path</>,
      <><b>Isolation layer 2 (RLS):</b> write transactions run <Text code>SET LOCAL ROLE bms_app; set_config('bms.tenant_id',...)</Text> → the policy enforces the matching tenant_id → cross-tenant writes are impossible even if a WHERE clause is missed</>,
      <><b>Secret encryption:</b> tokens/secrets are AES-256-GCM encrypted before storage (<Text code>lib/bms/crypto</Text>)</>,
      <><b>Webhook auth:</b> per-shop signature verification (HMAC + timingSafeEqual)</>,
      <><b>RBAC:</b> every resolver calls <Text code>requirePermission(ctx, perm)</Text> (per-tenant) + the UI hides buttons based on permission</>,
      <><b>Rate limit:</b> webhooks are capped at 120 req/min per shop (fixed-window; Redis-backed in production) → over the limit = 429</>,
      <><b>Audit log:</b> every important mutation (order/product/stock/channel/plan/rbac) is recorded in <Text code>bms_audit_log</Text> (who/what/when) — see the Audit log menu</>,
    ],
    s5Title: "5. RBAC model",
    s5Body: <>Permissions follow a <Text code>resource.action</Text> shape (26 total: product.* · stock.adjust · order.* · purchase.* · payment.* · shipping.* · inbox.* · customer.* · report.view)
      → stored in <Text code>bms_role_permissions</Text> <b>per-tenant</b> (PK = tenant_id+role_id+permission)
      · <b>Administrator</b> is a super role (bypasses checks) · permissions are cached per request · signup copies a template into the new shop
      · add/edit a permission in code at <Text code>BMS_PERMISSIONS</Text> (lib/bms/permissions.ts) and it appears in the Permissions menu automatically</>,
    s5Alert: "Per-tenant RBAC: each shop can adjust its own roles' permissions independently, with no effect on other shops (Permissions menu)",
    s6Title: "6. Billing & Quota",
    s6Items: [
      <><Text code>bms_plans</Text>: free/pro/business + limits (products/channels/orders per month; -1 = unlimited)</>,
      <><Text code>bms_tenants.plan</Text> references a plan code · <Text code>enforceProductQuota()</Text> checks on new-product creation → over limit = error</>,
      <>Billing is currently a <b>mock</b> (plan changes take effect immediately, no payment gateway wired yet) — connect Stripe/Omise later at <Text code>changePlan()</Text></>,
    ],
    s7Title: "7. Migrations (db/migrations)",
    s7Note: "Apply in order · 4.0 is idempotent (safe to re-run)",
    s8Title: "8. Observability & Daily Log Triage",
    s8Body: <>Structured logs live in <Text code>system_logs</Text> (level/category/message/error_message/stack/status/route_name/created_at)
      written via <Text code>lib/logger.ts</Text> — used as the source for automated triage</>,
    s8Steps: [
      { title: "Daily cron (GitHub Actions)", description: <><Text code>.github/workflows/daily-log-triage.yml</Text> — 22:00 UTC (~09:00 AEST), or triggered manually</> },
      { title: "Collect + redact logs", description: <><Text code>scripts/bms-log-triage/collect-error-logs.mjs</Text> — last 24h of errors, grouped/deduped, redacts email/phone/token/api-key/enc/hex/ip → <Text code>bms-log-report.md</Text></> },
      { title: "Claude analyzes + proposes a patch", description: "Reads the report → finds the root cause in apps/web → fixes only what it's confident about (minimal) → checks with npx tsc" },
      { title: "Opens a draft PR", description: "branch bot/log-triage-<date> → base main → a human reviews/merges" },
      { title: "LINE notification", description: <>pushed via the LINE Messaging API (<Text code>scripts/bms-log-triage/notify-line.mjs</Text>) with a link to the PR — LINE Notify has been discontinued, so this uses the ops team's own OA push instead (skipped if the secret isn't set)</> },
    ],
    s8Warning: "Guardrails: always a draft PR (never auto-merge/deploy) · redacted before leaving the system (AU/UK data residency) · AI must never touch migrations/secrets/config · secrets: BMS_LOG_DATABASE_URL (READ-ONLY), ANTHROPIC_API_KEY + (optional) LINE_OPS_TOKEN, LINE_OPS_TO",
    s8Note: <>Don't want logs leaving the cloud? Use a self-hosted runner on your own network (edit <Text code>runs-on</Text>) · see <Text code>scripts/bms-log-triage/README.md</Text></>,
    s9Title: "9. Production checklist",
    s9AlertMsg: "Must be done before going live",
    s9Items: [
      <>Enable <Text code>bcrypt.compare</Text> in loginAdmin (dev currently doesn't verify the password)</>,
      <>Set the <Text code>BMS_SECRET_KEY</Text> env var (64 hex chars) — otherwise a dev key is used</>,
      <>Connect the app to the DB with a non-superuser role (or GRANT bms_app TO app) so RLS actually applies to reads</>,
      <>Wire a real payment gateway into <Text code>changePlan</Text> + enforce order/message quota</>,
      <>Move rate limiting to Redis (currently in-memory per instance) · add audit coverage for every mutation</>,
    ],
    s10Title: "10. Customer 360 & SaaS roadmap",
    s10Body: <>Inbox (<Text code>/admin/inbox</Text>) is a real <b>3-column layout</b>: conversation list · chat · <b>Customer 360 panel</b> (<Text code>Customer360Panel.tsx</Text>).
      Selecting a chat resolves <Text code>customerId</Text> (nullable — some chats aren't linked to a customer yet) → an eager <Text code>bmsCustomer360</Text> query (the first 7 sections, lightweight)
      + lazy <Text code>bmsCustomerTimeline</Text>/<Text code>bmsCustomerInsights</Text> queries (loaded only when that section is expanded) — all backed by <Text code>lib/bms/customer360.ts</Text>, gated by the existing <Text code>customer.view</Text> permission (no new permission)</>,
    s10Items: [
      <><b>AI Insights:</b> Claude summarizes only from a "facts bundle" the backend has already computed (order count/value, top products, etc.) — it must never guess or invent numbers/advice with no data behind them (same pattern as <Text code>verifyPaymentSlip()</Text>); results are cached in <Text code>bms_customer_ai_summary</Text> keyed by a hash of the facts so it doesn't regenerate every time the chat is opened</>,
      <><b>"Current cart":</b> the schema has no separate DRAFT status — it's the customer's latest <Text code>PENDING</Text> order with no payment attached yet</>,
      <><b>Quick Actions still disabled:</b> Generate Invoice / Send Payment Link / Support Ticket — the real subsystem doesn't exist yet (already decided not to build this round) — not a bug</>,
    ],
    s10AlertMsg: "Shopee/Lazada are currently a webhook beta scaffold, not an OAuth sync worker",
    s10AlertDesc: <>Full details: <Text code>docs/integrations/lazada.md</Text> and <Text code>docs/local-notes-archive.md</Text> § SaaS redesign — the original OAuth/Channel Sync plan has been superseded and needs a fresh design before picking it back up</>,
  },
};

function Sec({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} style={{ scrollMarginTop: 80, marginBottom: 32 }}>{children}</div>;
}

// เส้นเชื่อม ERD
const box = (x: number, y: number, w: number, label: string, sub: string, fill: string) => (
  <g key={label}>
    <rect x={x} y={y} width={w} height={44} rx={6} fill={fill} stroke="#888" />
    <text x={x + w / 2} y={y + 19} textAnchor="middle" fontSize="12" fontWeight="600" fill="#111">{label}</text>
    <text x={x + w / 2} y={y + 34} textAnchor="middle" fontSize="9" fill="#444">{sub}</text>
  </g>
);

export default function Page() {
  const { lang } = useI18n();
  const c = resolveBilingual(CONTENT, lang);

  const anchorItems = c.anchors.map((title, i) => ({
    key: `a-${["overview", "data", "webhook", "security", "rbac", "billing", "mig", "obs", "prod", "c360"][i]}`,
    href: `#a-${["overview", "data", "webhook", "security", "rbac", "billing", "mig", "obs", "prod", "c360"][i]}`,
    title,
  }));

  return (
    <div>
      <Title level={2}>{c.pageTitle}</Title>
      <Paragraph type="secondary">{c.pageSubtitle}</Paragraph>

      <Row gutter={24}>
        <Col xs={24} md={17}>
          <Sec id="a-overview">
            <Title level={4}>{c.s1Title}</Title>
            <Paragraph>{c.s1StackIntro}</Paragraph>
            <Paragraph>{c.s1LayersIntro}</Paragraph>
            <ul>
              <li>{c.s1Layer1}</li>
              <li>{c.s1Layer2}</li>
              <li>{c.s1Layer3}</li>
              <li>{c.s1Layer4}</li>
            </ul>
            <Alert type="info" showIcon style={{ marginTop: 8 }} message={c.s1Alert} />
          </Sec>

          <Sec id="a-data">
            <Title level={4}>{c.s2Title}</Title>
            <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
              <svg viewBox="0 0 760 300" width="760" style={{ maxWidth: "100%", background: "#fafafa" }}>
                {/* tenant root */}
                {box(300, 10, 160, "bms_tenants", c.erdRootSub, "#e6f4ff")}
                {/* children row */}
                {box(20, 100, 120, "users", "tenant_id", "#f6ffed")}
                {box(160, 100, 130, "tenant_channels", "creds🔒", "#f6ffed")}
                {box(310, 100, 130, "products", "(tenant,sku)", "#fff7e6")}
                {box(460, 100, 120, "orders", "tenant_id", "#fff1f0")}
                {box(600, 100, 140, "customers", "tenant_id", "#f9f0ff")}
                {/* grandchildren */}
                {box(310, 200, 130, "inventory", "→products", "#fff7e6")}
                {box(460, 200, 120, "order_items", "→orders/prod", "#fff1f0")}
                {box(600, 200, 140, "identities/addr", "→customers", "#f9f0ff")}
                {/* lines from tenant */}
                {[80, 225, 375, 520, 670].map((cx, i) => (
                  <line key={i} x1={380} y1={54} x2={cx} y2={100} stroke="#bbb" />
                ))}
                <line x1={375} y1={144} x2={375} y2={200} stroke="#bbb" />
                <line x1={520} y1={144} x2={520} y2={200} stroke="#bbb" />
                <line x1={670} y1={144} x2={670} y2={200} stroke="#bbb" />
              </svg>
            </div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
              {c.erdCaption}
            </Paragraph>
            <Table size="small" pagination={false} rowKey="t" dataSource={c.tables}
              columns={[
                { title: c.tableColTable, dataIndex: "t", render: (v) => <Text code>{v}</Text> },
                { title: c.tableColPk, dataIndex: "pk" },
                { title: c.tableColCols, dataIndex: "cols" },
                { title: c.tableColNote, dataIndex: "note" },
              ]} />
            <Divider orientation="left" plain>{c.relsHeading}</Divider>
            <Table size="small" pagination={false} rowKey="c" dataSource={c.rels}
              columns={[
                { title: c.relColParent, dataIndex: "p" },
                { title: c.relColChild, dataIndex: "c" },
                { title: c.relColKey, dataIndex: "k", render: (v) => <Text code>{v}</Text> },
              ]} />
          </Sec>

          <Sec id="a-webhook">
            <Title level={4}>{c.s3Title}</Title>
            <Steps direction="vertical" size="small" current={-1} items={c.webhookSteps} />
            <Alert style={{ marginTop: 8 }} type="warning" showIcon message={c.s3Warning} />
            <Paragraph style={{ marginTop: 8 }} type="secondary">{c.s3Other}</Paragraph>
            <Paragraph type="secondary">{c.s3Diag}</Paragraph>
          </Sec>

          <Sec id="a-security">
            <Title level={4}>{c.s4Title}</Title>
            <ul>
              {c.s4Items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </Sec>

          <Sec id="a-rbac">
            <Title level={4}>{c.s5Title}</Title>
            <Paragraph>{c.s5Body}</Paragraph>
            <Alert type="success" showIcon message={c.s5Alert} />
          </Sec>

          <Sec id="a-billing">
            <Title level={4}>{c.s6Title}</Title>
            <ul>
              {c.s6Items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </Sec>

          <Sec id="a-mig">
            <Title level={4}>{c.s7Title}</Title>
            <div>{c.migrations.map((m) => <Tag key={m} style={{ marginBottom: 6 }}>{m}</Tag>)}</div>
            <Paragraph style={{ marginTop: 8 }} type="secondary">{c.s7Note}</Paragraph>
          </Sec>

          <Sec id="a-obs">
            <Title level={4}>{c.s8Title}</Title>
            <Paragraph>{c.s8Body}</Paragraph>
            <Steps direction="vertical" size="small" current={-1} items={c.s8Steps} />
            <Alert type="warning" showIcon style={{ marginTop: 8 }} message={c.s8Warning} />
            <Paragraph style={{ marginTop: 8 }} type="secondary">{c.s8Note}</Paragraph>
          </Sec>

          <Sec id="a-prod">
            <Title level={4}>{c.s9Title}</Title>
            <Alert type="error" showIcon message={c.s9AlertMsg} description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {c.s9Items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            } />
          </Sec>

          <Sec id="a-c360">
            <Title level={4}>{c.s10Title}</Title>
            <Paragraph>{c.s10Body}</Paragraph>
            <ul>
              {c.s10Items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
            <Alert type="info" showIcon style={{ marginTop: 8 }} message={c.s10AlertMsg} description={c.s10AlertDesc} />
          </Sec>
        </Col>

        <Col xs={0} md={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Card size="small" title={c.tocTitle}>
              <Anchor affix={false} items={anchorItems} />
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
}
