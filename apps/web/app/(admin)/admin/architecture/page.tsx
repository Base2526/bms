'use client';
import { Anchor, Card, Col, Row, Table, Tag, Typography, Alert, Steps, Divider } from "antd";

const { Title, Paragraph, Text } = Typography;

// ---------- data model ----------
const tables = [
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
  { t: "bms_customer_identities", pk: "id", cols: "tenant_id, customer_id, channel, external_ref", note: "map ช่องทาง→ลูกค้า · uniq(tenant,channel,ref)" },
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
];

const rels = [
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
];

const webhookSteps = [
  { title: "ลูกค้าส่งข้อความ", description: "LINE ยิง POST → /api/bms/line/webhook/{tenantId}" },
  { title: "โหลด channel ของร้าน", description: "getChannel(tenantId,'line') → decrypt token/secret · ถ้าไม่มี/ปิด → 200 skipped" },
  { title: "Verify signature", description: "HMAC-SHA256(channel_secret, rawBody) == X-Line-Signature? · ไม่ตรง → 401" },
  { title: "NLU + business logic", description: "runPipeline(text, 'line', tenantId, userId) → intent → checkStock/createOrder (RLS-scoped)" },
  { title: "ตอบกลับ", description: "LINE reply API ด้วย access_token ของร้านนั้น" },
];

const migrations = [
  "3.2 products+inventory", "3.3 orders", "3.4 IMS (barcode/reorder/ledger)",
  "3.5 OMS states", "3.6 CRM", "3.7 RBAC",
  "4.0 multi-tenant (tenant_id + re-key)", "4.1 users.tenant_id",
  "4.2 RLS policies", "4.3 RLS role (bms_app)", "5.0 plans",
  "5.1 per-tenant RBAC + audit log", "5.2 purchase (suppliers/PO)",
  "5.3 payments", "5.4 shipments", "5.5 inbox (conversations/messages/notes)",
  "5.6 platform admin", "5.7 operational perms", "5.8 max_users quota",
  "5.9 product detail (image/cost/category/brand)", "6.0 product categories",
  "6.1 inbox assignment (helpers)", "6.2 customer 360 (email/timezone/address_type + AI summary cache)",
];
// วางแผนไว้ (ยังไม่ implement — ดู CLAUDE.local.md § SaaS redesign):
// 6.3 channel oauth (Lazada) · 6.4 channel sync state/product map

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
  const anchorItems = [
    { key: "a-overview", href: "#a-overview", title: "1. ภาพรวมสถาปัตยกรรม" },
    { key: "a-data", href: "#a-data", title: "2. Data model (ERD)" },
    { key: "a-webhook", href: "#a-webhook", title: "3. Webhook sequence" },
    { key: "a-security", href: "#a-security", title: "4. Multi-tenancy & Security" },
    { key: "a-rbac", href: "#a-rbac", title: "5. RBAC model" },
    { key: "a-billing", href: "#a-billing", title: "6. Billing & Quota" },
    { key: "a-mig", href: "#a-mig", title: "7. Migrations" },
    { key: "a-obs", href: "#a-obs", title: "8. Observability & Log Triage" },
    { key: "a-prod", href: "#a-prod", title: "9. Production checklist" },
    { key: "a-c360", href: "#a-c360", title: "10. Customer 360 & SaaS roadmap" },
  ];

  return (
    <div>
      <Title level={2}>🏗️ Architecture & Requirements</Title>
      <Paragraph type="secondary">เอกสารสถาปัตยกรรมสำหรับนักพัฒนา — data model, webhook flow, security model, billing</Paragraph>

      <Row gutter={24}>
        <Col xs={24} md={17}>
          <Sec id="a-overview">
            <Title level={4}>1. ภาพรวมสถาปัตยกรรม</Title>
            <Paragraph>
              Stack: <Tag>Next.js (App Router)</Tag><Tag>GraphQL (Apollo/yoga)</Tag><Tag>PostgreSQL (pg)</Tag><Tag>Redis pub/sub</Tag> — โครง BMS ทั้งหมดเป็น layer บนโปรเจกต์เดิม
            </Paragraph>
            <Paragraph>เลเยอร์:</Paragraph>
            <ul>
              <li><b>Channel/Webhook</b> (route ต่อ tenant: LINE/TikTok/FB/IG/Web) → <b>Pipeline/NLU</b> (lib/bms/pipeline) → <b>Domain services</b> → <b>Postgres</b> · ทุกแชทถูก log ลง Inbox</li>
              <li><b>Domain services</b> (lib/bms/*): products, orders, purchase, payments, shipping, inbox, customers, reports, plans — ที่เดียวใช้ร่วมทั้ง REST + GraphQL (ไม่ซ้ำตรรกะ)</li>
              <li><b>Admin UI</b> (antd + Apollo) → <b>GraphQL resolvers</b> (graphql/bms*) → domain services เดียวกัน</li>
              <li>ทุก service รับ <Text code>tenantId</Text> + scope query · write-tx เพิ่ม RLS (role bms_app)</li>
            </ul>
            <Alert type="info" showIcon style={{ marginTop: 8 }}
              message="order lifecycle ครบวงจร: order → payment (confirm) → shipping (create → delivered) โดยแต่ละ service เดินสถานะ order ให้เอง (atomic) และบันทึก stock movement ทุกครั้งที่สต็อกขยับ" />

          </Sec>

          <Sec id="a-data">
            <Title level={4}>2. Data model</Title>
            <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 16 }}>
              <svg viewBox="0 0 760 300" width="760" style={{ maxWidth: "100%", background: "#fafafa" }}>
                {/* tenant root */}
                {box(300, 10, 160, "bms_tenants", "root (ร้าน)", "#e6f4ff")}
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
              แผนภาพแสดง<b>ตารางแกน</b> (tenant + สินค้า/ออเดอร์/ลูกค้า) · โมดูลเชิงปฏิบัติการ (purchase / payment / shipping / inbox) ผูกกับ orders/customers ตามตารางด้านล่าง
            </Paragraph>
            <Table size="small" pagination={false} rowKey="t" dataSource={tables}
              columns={[
                { title: "Table", dataIndex: "t", render: (t) => <Text code>{t}</Text> },
                { title: "PK", dataIndex: "pk" },
                { title: "คอลัมน์หลัก", dataIndex: "cols" },
                { title: "หมายเหตุ", dataIndex: "note" },
              ]} />
            <Divider orientation="left" plain>ความสัมพันธ์ (FK)</Divider>
            <Table size="small" pagination={false} rowKey="c" dataSource={rels}
              columns={[
                { title: "Parent", dataIndex: "p" },
                { title: "Child", dataIndex: "c" },
                { title: "Key", dataIndex: "k", render: (k) => <Text code>{k}</Text> },
              ]} />
          </Sec>

          <Sec id="a-webhook">
            <Title level={4}>3. Webhook sequence (LINE)</Title>
            <Steps direction="vertical" size="small" current={-1} items={webhookSteps} />
            <Alert style={{ marginTop: 8 }} type="warning" showIcon
              message="Failure paths: signature ไม่ตรง → 401 · channel ยังไม่เชื่อม → 200 skipped (กัน LINE retry) · order oversell → rollback"
            />
            <Paragraph style={{ marginTop: 8 }} type="secondary">
              ช่องทางอื่นใช้โครงเดียวกัน: <b>TikTok</b> (HMAC hex header) · <b>Facebook/Instagram</b> (GET verify hub.challenge + POST verify X-Hub-Signature-256, ตอบผ่าน Graph Send API) · <b>Website Live Chat</b> (public + CORS, ตอบใน HTTP response ทันที). ทุกช่องทางเรียก <Text code>runPipeline</Text> + <Text code>logConversation</Text> เดียวกัน → เข้า Inbox อัตโนมัติ · reply ออกจริงผ่าน <Text code>deliverToChannel()</Text> (LINE push / FB-IG Graph; TikTok ยัง persist-only)
            </Paragraph>
          </Sec>

          <Sec id="a-security">
            <Title level={4}>4. Multi-tenancy & Security</Title>
            <ul>
              <li><b>Isolation ชั้น 1 (app):</b> ทุก query filter <Text code>tenant_id</Text>; tenantId มาจาก JWT ของ admin (<Text code>getTenantId(ctx)</Text>) หรือ webhook path</li>
              <li><b>Isolation ชั้น 2 (RLS):</b> write-transaction ทำ <Text code>SET LOCAL ROLE bms_app; set_config('bms.tenant_id',...)</Text> → policy บังคับ tenant_id ตรง → เขียนข้ามร้านไม่ได้แม้ WHERE พลาด</li>
              <li><b>Secret encryption:</b> token/secret เข้ารหัส AES-256-GCM ก่อนเก็บ (<Text code>lib/bms/crypto</Text>)</li>
              <li><b>Webhook auth:</b> verify signature (HMAC + timingSafeEqual) ต่อร้าน</li>
              <li><b>RBAC:</b> ทุก resolver <Text code>requirePermission(ctx, perm)</Text> (per-tenant) + UI ซ่อนปุ่มตามสิทธิ์</li>
              <li><b>Rate limit:</b> webhook จำกัด 120 req/นาที ต่อร้าน (fixed-window; prod → Redis) → เกิน = 429</li>
              <li><b>Audit log:</b> ทุก mutation สำคัญ (order/product/stock/channel/plan/rbac) บันทึกใน <Text code>bms_audit_log</Text> (ใคร/ทำอะไร/เมื่อไร) — ดูที่เมนู Audit log</li>
            </ul>
          </Sec>

          <Sec id="a-rbac">
            <Title level={4}>5. RBAC model</Title>
            <Paragraph>
              Permission แบบ <Text code>resource.action</Text> (26 ตัว: product.* · stock.adjust · order.* · purchase.* · payment.* · shipping.* · inbox.* · customer.* · report.view)
              → เก็บใน <Text code>bms_role_permissions</Text> <b>per-tenant</b> (PK = tenant_id+role_id+permission)
              · <b>Administrator</b> = super (bypass) · โหลดสิทธิ์ cache ต่อ request · signup คัดลอก template ให้ร้านใหม่
              · เพิ่ม/แก้ permission ในโค้ดที่ <Text code>BMS_PERMISSIONS</Text> (lib/bms/permissions.ts) แล้วโผล่ในเมนู Permissions อัตโนมัติ
            </Paragraph>
            <Alert type="success" showIcon message="Per-tenant RBAC: แต่ละร้านปรับสิทธิ์ role ของตัวเองได้อิสระ ไม่กระทบร้านอื่น (เมนู Permissions)" />
          </Sec>

          <Sec id="a-billing">
            <Title level={4}>6. Billing & Quota</Title>
            <ul>
              <li><Text code>bms_plans</Text>: free/pro/business + limit (สินค้า/ช่องทาง/ออเดอร์ต่อเดือน; -1 = ไม่จำกัด)</li>
              <li><Text code>bms_tenants.plan</Text> อ้าง plan code · <Text code>enforceProductQuota()</Text> เช็คตอนสร้างสินค้าใหม่ → เกิน = error</li>
              <li>Billing เป็น <b>mock</b> (เปลี่ยนแพ็กเกจได้ทันที ยังไม่ต่อ payment gateway) — ต่อ Stripe/Omise ภายหลังที่ <Text code>changePlan()</Text></li>
            </ul>
          </Sec>

          <Sec id="a-mig">
            <Title level={4}>7. Migrations (db/migrations)</Title>
            <div>{migrations.map((m) => <Tag key={m} style={{ marginBottom: 6 }}>{m}</Tag>)}</div>
            <Paragraph style={{ marginTop: 8 }} type="secondary">apply ตามลำดับ · 4.0 เป็น idempotent (รันซ้ำได้)</Paragraph>
          </Sec>

          <Sec id="a-obs">
            <Title level={4}>8. Observability & Daily Log Triage</Title>
            <Paragraph>
              log แบบ structured เก็บใน <Text code>system_logs</Text> (level/category/message/error_message/stack/status/route_name/created_at)
              เขียนผ่าน <Text code>lib/logger.ts</Text> — ใช้เป็นแหล่งให้ระบบ triage อัตโนมัติ
            </Paragraph>
            <Steps direction="vertical" size="small" current={-1} items={[
              { title: "Cron รายวัน (GitHub Actions)", description: <><Text code>.github/workflows/daily-log-triage.yml</Text> — 22:00 UTC (~09:00 AEST) หรือกด Run เอง</> },
              { title: "ดึง + redact log", description: <><Text code>scripts/bms-log-triage/collect-error-logs.mjs</Text> — error 24 ชม.ล่าสุด, จัดกลุ่ม/dedupe, ปิดบัง email/phone/token/api-key/enc/hex/ip → <Text code>bms-log-report.md</Text></> },
              { title: "Claude วิเคราะห์ + เสนอแพตช์", description: "อ่าน report → หา root cause ใน apps/web → แก้เฉพาะที่มั่นใจ (minimal) → npx tsc เช็ค" },
              { title: "เปิด draft PR", description: "branch bot/log-triage-<วันที่> → base main → คนรีวิว/merge เอง" },
              { title: "แจ้งเตือน LINE", description: <>push ผ่าน LINE Messaging API (<Text code>scripts/bms-log-triage/notify-line.mjs</Text>) พร้อมลิงก์ PR — LINE Notify ปิดบริการแล้ว จึงใช้ push ของ OA ทีม ops (ไม่ตั้ง secret = ข้าม)</> },
            ]} />
            <Alert type="warning" showIcon style={{ marginTop: 8 }}
              message="Guardrails: draft PR เสมอ (ไม่ auto-merge/deploy) · redact ก่อนส่งออก (data residency AU/UK) · AI ห้ามแตะ migration/secret/config · secrets: BMS_LOG_DATABASE_URL (READ-ONLY), ANTHROPIC_API_KEY + (ทางเลือก) LINE_OPS_TOKEN, LINE_OPS_TO"
            />
            <Paragraph style={{ marginTop: 8 }} type="secondary">
              ไม่อยากส่ง log ออก cloud → ใช้ self-hosted runner ในวงเน็ตเวิร์ก (แก้ <Text code>runs-on</Text>) · ดู <Text code>scripts/bms-log-triage/README.md</Text>
            </Paragraph>
          </Sec>

          <Sec id="a-prod">
            <Title level={4}>9. Production checklist</Title>
            <Alert type="error" showIcon message="ต้องทำก่อนขายจริง" description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>เปิด <Text code>bcrypt.compare</Text> ใน loginAdmin (ตอนนี้ dev ไม่ตรวจรหัสผ่าน)</li>
                <li>ตั้ง env <Text code>BMS_SECRET_KEY</Text> (hex 64) — ไม่งั้นใช้ dev key</li>
                <li>ให้ app เชื่อม DB ด้วย role non-superuser (หรือ GRANT bms_app TO app) เพื่อให้ RLS มีผลกับ read</li>
                <li>ต่อ payment gateway จริงใน <Text code>changePlan</Text> + enforce order/message quota</li>
                <li>ย้าย rate-limit ไป Redis (ตอนนี้ in-memory ต่อ instance) · เพิ่ม audit ให้ครบทุก mutation</li>
              </ul>
            } />
          </Sec>

          <Sec id="a-c360">
            <Title level={4}>10. Customer 360 & SaaS roadmap</Title>
            <Paragraph>
              Inbox (<Text code>/admin/inbox</Text>) เป็น <b>3 คอลัมน์จริง</b>: รายการแชท · แชท · <b>Customer 360 panel</b> (<Text code>Customer360Panel.tsx</Text>).
              เลือกแชท → resolve <Text code>customerId</Text> (nullable — บางแชทยังไม่ผูกลูกค้า) → eager query <Text code>bmsCustomer360</Text> (7 ส่วนแรก, เบา)
              + lazy query <Text code>bmsCustomerTimeline</Text>/<Text code>bmsCustomerInsights</Text> (โหลดตอนกาง section เท่านั้น) — service ทั้งหมดอยู่ที่ <Text code>lib/bms/customer360.ts</Text>, gate ด้วยสิทธิ์ <Text code>customer.view</Text> เดิม (ไม่มีสิทธิ์ใหม่)
            </Paragraph>
            <ul>
              <li><b>AI Insights:</b> Claude สรุปจาก "facts bundle" ที่ backend คำนวณแล้วเท่านั้น (จำนวนออเดอร์/มูลค่า/สินค้ายอดนิยม ฯลฯ) — ห้ามเดา/แต่งตัวเลขหรือคำแนะนำที่ไม่มีข้อมูลรองรับ (แพทเทิร์นเดียวกับ <Text code>verifyPaymentSlip()</Text>) แคชผลใน <Text code>bms_customer_ai_summary</Text> ด้วย hash ของ facts กัน re-generate ทุกครั้งที่เปิดแชท</li>
              <li><b>"ตะกร้าปัจจุบัน":</b> สคีมาไม่มีสถานะ DRAFT แยก — คือ order <Text code>PENDING</Text> ล่าสุดที่ยังไม่มี payment ผูกอยู่</li>
              <li><b>Quick Actions ที่ยัง disable:</b> Generate Invoice / Send Payment Link / Support Ticket — subsystem จริงยังไม่มีในระบบ (ตัดสินใจไว้แล้วว่าไม่ build รอบนี้) ไม่ใช่บั๊ก</li>
            </ul>
            <Alert type="info" showIcon style={{ marginTop: 8 }}
              message="SaaS roadmap ถัดไป (ออกแบบแล้ว ยังไม่ implement): Lazada channel + OAuth connection + Channel Sync Service (ดึง product/order/payment/shipment เข้า DB เป็นระยะ แทน webhook สด) + Unified Customer Timeline ข้ามช่องทาง"
              description={<>รายละเอียดเต็ม: <Text code>BUSINESS_RULES.md</Text> § Channels &amp; Commerce Sync · <Text code>CLAUDE.md</Text> § SaaS Architecture · phase build order + ไฟล์ที่วางแผนไว้ใน <Text code>CLAUDE.local.md</Text> (migration ที่วางแผนไว้เลื่อนเป็น 6.3/6.4 เพราะ 6.2 ถูกใช้โดย Customer 360 ไปแล้ว)</>}
            />
          </Sec>
        </Col>

        <Col xs={0} md={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Card size="small" title="สารบัญ">
              <Anchor affix={false} items={anchorItems} />
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
}
