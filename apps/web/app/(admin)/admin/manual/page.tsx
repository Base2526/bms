'use client';
import { Anchor, Card, Col, Row, Table, Tag, Typography, Alert, Divider, Steps } from "antd";
import Link from "next/link";

const { Title, Paragraph, Text } = Typography;

// ---------- ตารางอ้างอิง ----------
const orderFlow = [
  { k: 1, status: "PENDING", th: "รอชำระเงิน", action: "สร้าง order (สั่งซื้อ)", stock: "reserved += qty (จองสต็อก)" },
  { k: 2, status: "PAID", th: "จ่ายแล้ว", action: "จ่ายเงิน", stock: "— (ยังจองไว้)" },
  { k: 3, status: "PACKING", th: "กำลังแพ็ค", action: "แพ็ค", stock: "—" },
  { k: 4, status: "SHIPPED", th: "จัดส่งแล้ว", action: "จัดส่ง", stock: "current −= qty, reserved −= qty (ตัดจริง)" },
  { k: 5, status: "COMPLETED", th: "สำเร็จ", action: "ปิดงาน", stock: "—" },
  { k: 6, status: "CANCELLED", th: "ยกเลิก", action: "ยกเลิก (ก่อนส่ง)", stock: "reserved −= qty (คืนจอง)" },
  { k: 7, status: "RETURNED", th: "คืนสินค้า", action: "คืน (หลังส่ง)", stock: "current += qty (คืนเข้าคลัง)" },
];
const statusColor: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue", COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};

const perms = [
  { role: "Administrator", desc: "super — ทุกสิทธิ์ + จัดการ RBAC", perms: "ทั้งหมด" },
  { role: "Manager", desc: "ผู้จัดการร้าน (เจ้าของร้านที่สมัครใหม่)", perms: "ทั้งหมด ยกเว้นแก้ RBAC ระบบ" },
  { role: "Sales", desc: "ฝ่ายขาย", perms: "order.* , customer.* , product.view , report.view (แก้/ลบสินค้าไม่ได้, จัดส่งไม่ได้)" },
  { role: "Warehouse", desc: "คลังสินค้า", perms: "product.view , stock.adjust , order.view , order.ship (ดูรายงานการเงินไม่ได้)" },
];

const endpoints = [
  { m: "POST", path: "/api/bms/chat", desc: "ทดสอบ pipeline (message, channel, customerRef, tenantId)" },
  { m: "POST", path: "/api/bms/line/webhook/{tenantId}", desc: "LINE webhook ต่อร้าน (verify X-Line-Signature)" },
  { m: "POST", path: "/api/bms/tiktok/webhook/{tenantId}", desc: "TikTok webhook ต่อร้าน" },
  { m: "POST", path: "/api/bms/order", desc: "สร้าง order (items[])" },
  { m: "POST", path: "/api/bms/order/{id}/pay|pack|ship|complete|cancel|return", desc: "เปลี่ยนสถานะ order" },
  { m: "POST", path: "/api/bms/orders/release-expired?minutes=N", desc: "cron ยกเลิก order PENDING ค้าง" },
];

const movements = [
  { t: "STOCK_IN / STOCK_OUT", when: "แอดมินปรับสต็อก (+/−)" },
  { t: "RESERVE", when: "สร้าง order (จอง)" },
  { t: "SHIP", when: "จัดส่ง (ตัดของออก)" },
  { t: "RETURN", when: "คืนสินค้า (คืนของเข้า)" },
  { t: "RELEASE", when: "ยกเลิก/auto-release (คืนจอง)" },
];

function Sec({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} style={{ scrollMarginTop: 80, marginBottom: 32 }}>{children}</div>;
}

export default function Page() {
  const anchorItems = [
    { key: "overview", href: "#overview", title: "1. ภาพรวมระบบ" },
    { key: "getstart", href: "#getstart", title: "2. เริ่มต้นใช้งาน" },
    { key: "playground", href: "#playground", title: "3. Playground (ทดสอบแชต)" },
    { key: "products", href: "#products", title: "4. Products & Inventory (IMS)" },
    { key: "orders", href: "#orders", title: "5. Orders (OMS)" },
    { key: "customers", href: "#customers", title: "6. Customers (CRM)" },
    { key: "dashboard", href: "#dashboard", title: "7. Dashboard" },
    { key: "permissions", href: "#permissions", title: "8. Users / Roles / Permissions" },
    { key: "settings", href: "#settings", title: "9. Settings (เชื่อม LINE/TikTok)" },
    { key: "billing", href: "#billing", title: "10. Billing & แพ็กเกจ" },
    { key: "saas", href: "#saas", title: "11. SaaS multi-tenant" },
    { key: "api", href: "#api", title: "12. API / Webhook reference" },
  ];

  return (
    <div>
      <Title level={2}>📖 คู่มือการใช้งาน AI-BMS</Title>
      <Paragraph type="secondary">
        ระบบจัดการร้านค้าอัตโนมัติผ่านแชต (LINE/TikTok) — ขายของ, จัดการสต็อก, ออเดอร์, ลูกค้า, สิทธิ์ผู้ใช้ และเปิดให้หลายร้านใช้งานแบบ SaaS
      </Paragraph>

      <Row gutter={24}>
        <Col xs={24} md={17}>
          <Sec id="overview">
            <Title level={4}>1. ภาพรวมระบบ</Title>
            <Paragraph>AI-BMS เปลี่ยน "บทสนทนาลูกค้า" ให้กลายเป็น workflow ธุรกิจอัตโนมัติ:</Paragraph>
            <Alert type="info" showIcon message="ลูกค้าทัก → AI เข้าใจ (NLU) → เช็คสต็อก → สร้างออเดอร์ → จัดการสต็อก/ลูกค้า → รายงาน" style={{ marginBottom: 12 }} />
            <Paragraph>โมดูลหลัก: <Tag>IMS สินค้า/สต็อก</Tag><Tag>OMS ออเดอร์</Tag><Tag>CRM ลูกค้า</Tag><Tag>Dashboard</Tag><Tag>RBAC สิทธิ์</Tag><Tag>Channels LINE/TikTok</Tag><Tag>Billing</Tag></Paragraph>
          </Sec>

          <Sec id="getstart">
            <Title level={4}>2. เริ่มต้นใช้งาน (แนะนำตามลำดับ)</Title>
            <Steps direction="vertical" size="small" current={-1} items={[
              { title: "เพิ่มสินค้า", description: <>ไปที่ <Link href="/admin/products">Products</Link> → เพิ่มสินค้า + ตั้งราคา + keywords (คำที่ลูกค้าพิมพ์แล้ว match) + สต็อกแต่ละไซซ์</> },
              { title: "ทดสอบการขาย", description: <>ไปที่ <Link href="/admin/playground">Playground</Link> พิมพ์ "สั่ง Nike XL 2 ชิ้น" ดู order + สต็อกเปลี่ยนสด</> },
              { title: "จัดการออเดอร์", description: <>ไปที่ <Link href="/admin/orders">Orders</Link> เดินสถานะ จ่าย→แพ็ค→ส่ง→สำเร็จ</> },
              { title: "เชื่อมช่องทางจริง", description: <>ไปที่ <Link href="/admin/settings">Settings</Link> วาง token LINE/TikTok + เอา Webhook URL ไปตั้งใน console</> },
            ]} />
          </Sec>

          <Sec id="playground">
            <Title level={4}>3. Playground — ทดสอบแชต</Title>
            <Paragraph>จำลองลูกค้าทักเข้ามาโดยไม่ต้องต่อ LINE จริง ใช้ดูภาพการทำงานทั้ง flow</Paragraph>
            <ul>
              <li>เลือกช่องทาง (line/tiktok/...) + ใส่ customerRef (จำลอง user id)</li>
              <li>พิมพ์ข้อความ เช่น <Text code>Nike XL มีไหม</Text> (เช็คสต็อก) หรือ <Text code>สั่ง Nike XL 2 ชิ้น</Text> (สร้างออเดอร์)</li>
              <li>สั่งหลายรายการต่อข้อความ: <Text code>สั่ง Nike XL 1 ชิ้น กับ Adidas M 1 ชิ้น</Text></li>
              <li>เห็น trace: intent, สต็อก, order ที่เกิด + สต็อกด้านขวาอัปเดตทันที</li>
            </ul>
          </Sec>

          <Sec id="products">
            <Title level={4}>4. Products & Inventory (IMS)</Title>
            <Paragraph>จัดการสินค้า + สต็อก (เมนู <Link href="/admin/products">Products</Link>)</Paragraph>
            <ul>
              <li><b>เพิ่ม/แก้สินค้า:</b> SKU, Barcode, ราคา, Keywords, เปิด/ปิดขาย</li>
              <li><b>สต็อกต่อไซซ์:</b> กางแถว → ปรับ +10/+1/−1 (บันทึกประวัติทุกครั้ง), เพิ่มไซซ์ใหม่</li>
              <li><b>Available = Current − Reserved</b> (reserved = ของที่ถูกจองในออเดอร์ที่ยังไม่ส่ง — แก้มือไม่ได้)</li>
              <li><b>จุดแจ้งเตือนของใกล้หมด (reorder point):</b> ตั้งต่อไซซ์ → banner เตือนเมื่อ available ≤ จุดเตือน</li>
              <li><b>ประวัติการเคลื่อนไหว:</b> ทุกการขยับสต็อกถูกบันทึกใน ledger</li>
            </ul>
            <Table size="small" pagination={false} rowKey="t" dataSource={movements}
              columns={[{ title: "ประเภท", dataIndex: "t", render: (t) => <Tag>{t}</Tag> }, { title: "เกิดเมื่อ", dataIndex: "when" }]} />
          </Sec>

          <Sec id="orders">
            <Title level={4}>5. Orders (OMS) — สถานะออเดอร์</Title>
            <Paragraph>เมนู <Link href="/admin/orders">Orders</Link> — ปุ่ม action จะปรับตามสถานะและสิทธิ์</Paragraph>
            <Table size="small" pagination={false} rowKey="k" dataSource={orderFlow}
              columns={[
                { title: "สถานะ", dataIndex: "status", render: (s) => <Tag color={statusColor[s]}>{s}</Tag> },
                { title: "ความหมาย", dataIndex: "th" },
                { title: "ปุ่ม/action", dataIndex: "action" },
                { title: "ผลต่อสต็อก", dataIndex: "stock" },
              ]} />
            <Alert style={{ marginTop: 12 }} type="success" showIcon
              message="ทุกการเปลี่ยนสถานะเป็น atomic — กัน oversell และตัดสต็อกซ้ำ" />
          </Sec>

          <Sec id="customers">
            <Title level={4}>6. Customers (CRM)</Title>
            <Paragraph>เมนู <Link href="/admin/customers">Customers</Link></Paragraph>
            <ul>
              <li>ลูกค้าถูก<b>สร้างอัตโนมัติ</b>เมื่อมีออเดอร์เข้ามา (ผูกจาก channel + user id)</li>
              <li>เก็บ ชื่อ, เบอร์, ที่อยู่ (หลายที่อยู่), Tags (VIP/ลูกค้าใหม่/ประจำ)</li>
              <li><b>ยอดซื้อสะสม</b> = ผลรวมออเดอร์ที่จ่ายแล้ว · กางแถวดูประวัติการซื้อ</li>
              <li>1 ลูกค้าเชื่อมได้หลายช่องทาง (LINE + TikTok = คนเดียวกัน)</li>
            </ul>
          </Sec>

          <Sec id="dashboard">
            <Title level={4}>7. Dashboard</Title>
            <Paragraph>เมนู <Link href="/admin/dashboard">Dashboard</Link> — ยอดขายรวม/วันนี้, ออเดอร์แยกสถานะ, กราฟ 7 วัน, สินค้าขายดี, ลูกค้ายอดสูง, แจ้งเตือนของใกล้หมด (รายได้นับเฉพาะออเดอร์ที่จ่ายแล้ว)</Paragraph>
          </Sec>

          <Sec id="permissions">
            <Title level={4}>8. Users / Roles / Permissions (RBAC)</Title>
            <Paragraph>กำหนดว่าใครทำอะไรได้ — เมนู <Link href="/admin/permissions">Permissions</Link> (เฉพาะ Administrator แก้ได้)</Paragraph>
            <Table size="small" pagination={false} rowKey="role" dataSource={perms}
              columns={[
                { title: "Role", dataIndex: "role", render: (r) => <Tag color="blue">{r}</Tag> },
                { title: "หน้าที่", dataIndex: "desc" },
                { title: "สิทธิ์", dataIndex: "perms" },
              ]} />
            <Paragraph style={{ marginTop: 8 }}>ปุ่มในแต่ละหน้าจะซ่อน/disable ตามสิทธิ์ และ API จะปฏิเสธ (403) ถ้าไม่มีสิทธิ์</Paragraph>
          </Sec>

          <Sec id="settings">
            <Title level={4}>9. Settings — เชื่อม LINE / TikTok</Title>
            <Paragraph>เมนู <Link href="/admin/settings">Settings</Link></Paragraph>
            <Steps direction="vertical" size="small" current={-1} items={[
              { title: "คัดลอก Webhook URL", description: <Text code>{`{origin}/api/bms/line/webhook/{tenantId}`}</Text> },
              { title: "ตั้งใน LINE Developers Console", description: "Messaging API → Webhook URL → วาง URL ข้างบน + เปิด Use webhook" },
              { title: "วาง Access Token + Channel Secret", description: "ในหน้า Settings แล้วกดบันทึก (เก็บแบบเข้ารหัส AES-256-GCM)" },
              { title: "เสร็จ!", description: "ลูกค้าทักเข้า OA → verify signature → AI ตอบด้วย token ของร้าน" },
            ]} />
            <Alert type="warning" showIcon message="ทุก webhook ตรวจ signature — request ที่ signature ไม่ตรงจะถูกปฏิเสธ (401)" />
          </Sec>

          <Sec id="billing">
            <Title level={4}>10. Billing & แพ็กเกจ</Title>
            <Paragraph>เมนู <Link href="/admin/billing">Billing</Link> — Free / Pro / Business (จำกัดจำนวนสินค้า/ช่องทาง/ออเดอร์ต่อเดือน) ดู usage + อัปเกรดได้ (โหมดสาธิต ยังไม่ตัดเงินจริง) · quota สินค้าถูกบังคับใช้ตอนสร้างสินค้าใหม่</Paragraph>
          </Sec>

          <Sec id="saas">
            <Title level={4}>11. SaaS multi-tenant</Title>
            <ul>
              <li>เปิดร้านใหม่เองที่ <Link href="/shop-signup">/shop-signup</Link> → สร้างร้าน + เจ้าของ (role Manager) อัตโนมัติ</li>
              <li>ข้อมูลแยกกันสมบูรณ์ต่อร้าน (tenant_id ทุกตาราง + Row-Level Security ชั้น 2)</li>
              <li>SKU ซ้ำข้ามร้านได้ (แต่ละร้านมีแคตตาล็อกของตัวเอง)</li>
            </ul>
            <Alert type="error" showIcon style={{ marginTop: 8 }}
              message="ก่อนใช้งานจริง (production)"
              description={<ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>เปิดการตรวจรหัสผ่านใน loginAdmin (ตอนนี้ dev ยังไม่ตรวจ)</li>
                <li>ตั้ง env <Text code>BMS_SECRET_KEY</Text> (สำหรับเข้ารหัส token)</li>
                <li>ให้ app เชื่อม DB ด้วย role ที่ไม่ใช่ superuser เพื่อให้ RLS มีผลกับ read ด้วย</li>
              </ul>} />
          </Sec>

          <Sec id="api">
            <Title level={4}>12. API / Webhook reference</Title>
            <Table size="small" pagination={false} rowKey="path" dataSource={endpoints}
              columns={[
                { title: "Method", dataIndex: "m", width: 80, render: (m) => <Tag color="purple">{m}</Tag> },
                { title: "Endpoint", dataIndex: "path", render: (p) => <Text code>{p}</Text> },
                { title: "หน้าที่", dataIndex: "desc" },
              ]} />
            <Paragraph style={{ marginTop: 8 }} type="secondary">
              GraphQL (admin): bmsProducts, bmsOrders, bmsCustomers, bmsDashboard, bmsChannels, bmsBilling, bmsSignup ฯลฯ ที่ <Text code>/api/graphql</Text>
            </Paragraph>
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
