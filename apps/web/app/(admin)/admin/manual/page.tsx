'use client';
import { Anchor, Card, Col, Row, Table, Tag, Typography, Alert, Steps } from "antd";
import Link from "next/link";

const { Title, Paragraph, Text } = Typography;

// ---------- ตารางอ้างอิง ----------
const orderFlow = [
  { k: 1, status: "PENDING", th: "รอชำระเงิน", action: "สร้าง order (สั่งซื้อ)", stock: "reserved += qty (จองสต็อก)" },
  { k: 2, status: "PAID", th: "จ่ายแล้ว", action: "จ่ายเงิน / ยืนยัน payment", stock: "— (ยังจองไว้)" },
  { k: 3, status: "PACKING", th: "กำลังแพ็ค", action: "แพ็ค", stock: "—" },
  { k: 4, status: "SHIPPED", th: "จัดส่งแล้ว", action: "จัดส่ง / สร้าง shipment", stock: "current −= qty, reserved −= qty (ตัดจริง)" },
  { k: 5, status: "COMPLETED", th: "สำเร็จ", action: "ปิดงาน / shipment = DELIVERED", stock: "—" },
  { k: 6, status: "CANCELLED", th: "ยกเลิก", action: "ยกเลิก (ก่อนส่ง)", stock: "reserved −= qty (คืนจอง)" },
  { k: 7, status: "RETURNED", th: "คืนสินค้า", action: "คืน (หลังส่ง)", stock: "current += qty (คืนเข้าคลัง)" },
];
const statusColor: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue", COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};

const perms = [
  { role: "Administrator", desc: "super — ทุกสิทธิ์ + จัดการ RBAC", perms: "ทั้งหมด (26 สิทธิ์)" },
  { role: "Manager", desc: "ผู้จัดการร้าน (เจ้าของร้านที่สมัครใหม่)", perms: "ทั้งหมด ยกเว้นแก้ RBAC ระบบ" },
  { role: "Sales", desc: "ฝ่ายขาย / แอดมินแชท", perms: "order.* , customer.* , inbox.* , payment.submit , product.view , report.view" },
  { role: "Warehouse", desc: "คลัง / จัดส่ง", perms: "product.view , stock.adjust , order.view/ship , purchase.* , shipping.*" },
  { role: "Finance", desc: "การเงิน (ตัวอย่าง role เพิ่มเอง)", perms: "payment.* , report.view , order.view" },
];

const endpoints = [
  { m: "POST", path: "/api/bms/chat", desc: "ทดสอบ pipeline (message, channel, customerRef, tenantId)" },
  { m: "POST", path: "/api/bms/{line|tiktok|facebook|instagram}/webhook/{tenantId}", desc: "webhook ต่อร้าน (verify signature)" },
  { m: "POST", path: "/api/bms/web/webhook/{tenantId}", desc: "Website Live Chat (public widget, ตอบใน response)" },
  { m: "POST", path: "/api/bms/order", desc: "สร้าง order (items[])" },
  { m: "POST", path: "/api/bms/order/{id}/pay|pack|ship|complete|cancel|return", desc: "เปลี่ยนสถานะ order" },
  { m: "POST", path: "/api/bms/purchase  ·  /{id}/receive|cancel", desc: "ใบสั่งซื้อ (PO) + รับของ" },
  { m: "POST", path: "/api/bms/payment  ·  /{id}/confirm|reject|refund|verify", desc: "การชำระเงิน + ตรวจสลิป" },
  { m: "POST", path: "/api/bms/shipment  ·  /{id}/tracking|status  ·  GET /label", desc: "จัดส่ง + tracking + label" },
  { m: "GET/POST", path: "/api/bms/inbox  ·  /{id}/reply", desc: "อินบ็อกซ์รวม + ตอบเอง" },
  { m: "GET", path: "/api/bms/reports/{sales|inventory|top-products}", desc: "รายงานตามช่วงวันที่" },
  { m: "POST", path: "/api/bms/orders/release-expired?minutes=N", desc: "cron ยกเลิก order PENDING ค้าง" },
];

const movements = [
  { t: "STOCK_IN", when: "แอดมินปรับสต็อก (+) หรือรับของจาก PO (receive)" },
  { t: "STOCK_OUT", when: "แอดมินปรับสต็อก (−)" },
  { t: "RESERVE", when: "สร้าง order (จอง)" },
  { t: "SHIP", when: "จัดส่ง / สร้าง shipment (ตัดของออก)" },
  { t: "RETURN", when: "คืนสินค้า (คืนของเข้า)" },
  { t: "RELEASE", when: "ยกเลิก/auto-release (คืนจอง)" },
];

function Sec({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={id} style={{ scrollMarginTop: 80, marginBottom: 32 }}>{children}</div>;
}

const codeBlock: React.CSSProperties = {
  background: "var(--app-surface-2, rgba(127,127,127,0.12))",
  border: "1px solid var(--app-border, rgba(127,127,127,0.25))",
  borderRadius: 6, padding: 12, margin: "8px 0 16px",
  fontSize: 12, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre",
};

export default function Page() {
  const anchorItems = [
    { key: "overview", href: "#overview", title: "1. ภาพรวมระบบ" },
    { key: "getstart", href: "#getstart", title: "2. เริ่มต้นใช้งาน" },
    { key: "playground", href: "#playground", title: "3. Playground (ทดสอบแชต)" },
    { key: "inbox", href: "#inbox", title: "4. Inbox (Omnichannel)" },
    { key: "products", href: "#products", title: "5. Products & Inventory (IMS)" },
    { key: "orders", href: "#orders", title: "6. Orders (OMS)" },
    { key: "purchase", href: "#purchase", title: "7. Purchase (PO)" },
    { key: "payment", href: "#payment", title: "8. Payment" },
    { key: "shipping", href: "#shipping", title: "9. Shipping" },
    { key: "customers", href: "#customers", title: "10. Customers (CRM)" },
    { key: "reports", href: "#reports", title: "11. Dashboard & Reports" },
    { key: "permissions", href: "#permissions", title: "12. Users / Roles / Permissions" },
    { key: "settings", href: "#settings", title: "13. Settings (เชื่อมช่องทาง)" },
    { key: "billing", href: "#billing", title: "14. Billing & แพ็กเกจ" },
    { key: "saas", href: "#saas", title: "15. SaaS multi-tenant" },
    { key: "api", href: "#api", title: "16. API / Webhook reference" },
    { key: "testai", href: "#testai", title: "17. ทดสอบ AI (Postman/webhook)" },
  ];

  return (
    <div>
      <Title level={2}>📖 คู่มือการใช้งาน AI-BMS</Title>
      <Paragraph type="secondary">
        ระบบจัดการร้านค้าอัตโนมัติผ่านแชตหลายช่องทาง (LINE / TikTok / Facebook / Instagram / เว็บ) — ปิดครบวงจรตั้งแต่ลูกค้าทัก → ขาย → จัดซื้อ → ชำระเงิน → จัดส่ง → รายงาน แบบ SaaS หลายร้าน
      </Paragraph>

      <Row gutter={24}>
        <Col xs={24} md={17}>
          <Sec id="overview">
            <Title level={4}>1. ภาพรวมระบบ</Title>
            <Paragraph>AI-BMS เปลี่ยน "บทสนทนาลูกค้า" ให้กลายเป็น workflow ธุรกิจอัตโนมัติ:</Paragraph>
            <Alert type="info" showIcon message="ลูกค้าทัก → AI เข้าใจ (NLU) → เช็คสต็อก → สร้างออเดอร์ → ชำระเงิน → จัดส่ง → รายงาน · ทุกแชทถูกเก็บใน Inbox" style={{ marginBottom: 12 }} />
            <Paragraph>
              โมดูล: <Tag>Inbox รวมแชท</Tag><Tag>IMS สินค้า/สต็อก</Tag><Tag>OMS ออเดอร์</Tag><Tag>Purchase จัดซื้อ</Tag><Tag>Payment</Tag><Tag>Shipping</Tag><Tag>CRM ลูกค้า</Tag><Tag>Reports</Tag><Tag>RBAC สิทธิ์</Tag><Tag>Channels LINE/TikTok/FB/IG/Web</Tag><Tag>Billing</Tag>
            </Paragraph>
          </Sec>

          <Sec id="getstart">
            <Title level={4}>2. เริ่มต้นใช้งาน (แนะนำตามลำดับ)</Title>
            <Steps direction="vertical" size="small" current={-1} items={[
              { title: "เพิ่มสินค้า", description: <>ไปที่ <Link href="/admin/products">Products</Link> → เพิ่มสินค้า + ราคา + keywords + สต็อกแต่ละไซซ์ (หรือรับเข้าผ่าน <Link href="/admin/purchase">Purchase</Link>)</> },
              { title: "ทดสอบการขาย", description: <>ไปที่ <Link href="/admin/playground">Playground</Link> พิมพ์ "สั่ง Nike XL 2 ชิ้น" ดู order + สต็อกเปลี่ยนสด</> },
              { title: "เดินครบวงจร", description: <><Link href="/admin/orders">Orders</Link> → <Link href="/admin/payment">Payment</Link> (ยืนยันสลิป) → <Link href="/admin/shipment">Shipping</Link> (ออกเลขพัสดุ) → ปิดงาน</> },
              { title: "เชื่อมช่องทางจริง", description: <>ไปที่ <Link href="/admin/settings">Settings</Link> วาง token + เอา Webhook URL ไปตั้งใน console ของแต่ละแพลตฟอร์ม แล้วดูแชตเข้าที่ <Link href="/admin/inbox">Inbox</Link></> },
            ]} />
          </Sec>

          <Sec id="playground">
            <Title level={4}>3. Playground — ทดสอบแชต</Title>
            <Paragraph>จำลองลูกค้าทักเข้ามาโดยไม่ต้องต่อช่องทางจริง ใช้ดูภาพการทำงานทั้ง flow</Paragraph>
            <ul>
              <li>เลือกช่องทาง + ใส่ customerRef (จำลอง user id)</li>
              <li>พิมพ์ เช่น <Text code>Nike XL มีไหม</Text> (เช็คสต็อก) หรือ <Text code>สั่ง Nike XL 2 ชิ้น</Text> (สร้างออเดอร์)</li>
              <li>สั่งหลายรายการต่อข้อความ: <Text code>สั่ง Nike XL 1 ชิ้น กับ Adidas M 1 ชิ้น</Text></li>
              <li>เห็น trace: intent, สต็อก, order ที่เกิด + สต็อกด้านขวาอัปเดตทันที</li>
            </ul>
            <Alert type="info" showIcon message="Playground (channel=test) ไม่ถูกบันทึกลง Inbox — ใช้ทดสอบล้วน ๆ" />
          </Sec>

          <Sec id="inbox">
            <Title level={4}>4. Inbox — กล่องข้อความรวมทุกช่องทาง (Omnichannel)</Title>
            <Paragraph>เมนู <Link href="/admin/inbox">Inbox</Link> — ทุกข้อความจาก LINE/TikTok/FB/IG/เว็บ (พร้อมคำตอบ AI) ถูกบันทึกอัตโนมัติมารวมที่นี่</Paragraph>
            <ul>
              <li><b>ซ้าย:</b> รายการบทสนทนา — filter สถานะ (OPEN/PENDING/CLOSED), ค้นหา, ตัวเลขข้อความที่ยังไม่อ่าน</li>
              <li><b>แชท:</b> ดูประวัติเข้า-ออก · แอดมินพิมพ์ตอบเองได้ (LINE ส่งจริงผ่าน push, FB/IG ผ่าน Graph API)</li>
              <li><b>จัดการ:</b> มอบหมาย staff (assign), เปลี่ยนสถานะ, ใส่แท็ก</li>
              <li><b>โน้ตภายใน:</b> บันทึกให้ทีมเห็น (ลูกค้าไม่เห็น)</li>
              <li><b>Timeline:</b> รวม ข้อความ + โน้ต + ออเดอร์ของลูกค้า เรียงตามเวลา</li>
            </ul>
            <Alert type="info" showIcon message="Website Live Chat: ฝังวิดเจ็ตให้ POST ไปที่ /api/bms/web/webhook/{tenantId} (มี CORS) — ระบบตอบกลับใน response ทันที" />
          </Sec>

          <Sec id="products">
            <Title level={4}>5. Products & Inventory (IMS)</Title>
            <Paragraph>จัดการสินค้า + สต็อก (เมนู <Link href="/admin/products">Products</Link>)</Paragraph>
            <ul>
              <li><b>เพิ่ม/แก้สินค้า:</b> SKU, Barcode, ราคา, Keywords, เปิด/ปิดขาย</li>
              <li><b>สต็อกต่อไซซ์:</b> ปรับ +10/+1/−1 (บันทึกประวัติทุกครั้ง), เพิ่มไซซ์ใหม่</li>
              <li><b>Available = Current − Reserved</b> (reserved = ของที่จองในออเดอร์ที่ยังไม่ส่ง — แก้มือไม่ได้)</li>
              <li><b>reorder point:</b> ตั้งต่อไซซ์ → เตือนเมื่อ available ≤ จุดเตือน</li>
              <li><b>ของเข้าคลัง:</b> รับผ่าน <Link href="/admin/purchase">Purchase (PO)</Link> → บันทึก STOCK_IN อัตโนมัติ</li>
            </ul>
            <Table size="small" pagination={false} rowKey="t" dataSource={movements}
              columns={[{ title: "ประเภท movement", dataIndex: "t", render: (t) => <Tag>{t}</Tag> }, { title: "เกิดเมื่อ", dataIndex: "when" }]} />
          </Sec>

          <Sec id="orders">
            <Title level={4}>6. Orders (OMS) — สถานะออเดอร์</Title>
            <Paragraph>เมนู <Link href="/admin/orders">Orders</Link> — ปุ่ม action ปรับตามสถานะและสิทธิ์</Paragraph>
            <Table size="small" pagination={false} rowKey="k" dataSource={orderFlow}
              columns={[
                { title: "สถานะ", dataIndex: "status", render: (s) => <Tag color={statusColor[s]}>{s}</Tag> },
                { title: "ความหมาย", dataIndex: "th" },
                { title: "ปุ่ม/action", dataIndex: "action" },
                { title: "ผลต่อสต็อก", dataIndex: "stock" },
              ]} />
            <Alert style={{ marginTop: 12 }} type="success" showIcon
              message="ทุกการเปลี่ยนสถานะเป็น atomic — กัน oversell และตัดสต็อกซ้ำ · จ่ายเงินทำผ่าน Payment, จัดส่งทำผ่าน Shipping ก็ได้ (เดินสถานะ order ให้เอง)" />
          </Sec>

          <Sec id="purchase">
            <Title level={4}>7. Purchase (PO) — ใบสั่งซื้อ/รับของ</Title>
            <Paragraph>เมนู <Link href="/admin/purchase">Purchase</Link> — สั่งซื้อจาก supplier แล้วรับของเข้าสต็อก</Paragraph>
            <ul>
              <li><b>สร้าง PO:</b> เลือก supplier (พิมพ์ชื่อสร้างใหม่ได้), รายการสินค้า + จำนวน + ทุน/หน่วย — สถานะเริ่ม <Tag color="orange">OPEN</Tag> (ยังไม่ขยับสต็อก)</li>
              <li><b>รับของ (บางส่วน/ครบ):</b> ใส่จำนวนที่รับจริง → สต็อกเข้า (STOCK_IN) → สถานะเป็น <Tag color="blue">PARTIAL</Tag> หรือ <Tag color="green">RECEIVED</Tag></li>
              <li><b>ยกเลิก:</b> ได้เฉพาะก่อนรับครบ — ของที่รับไปแล้วไม่ถูกดึงออก (ตามหลักบัญชีสินค้า)</li>
            </ul>
          </Sec>

          <Sec id="payment">
            <Title level={4}>8. Payment — การชำระเงิน</Title>
            <Paragraph>เมนู <Link href="/admin/payment">Payment</Link> — วิธีจ่าย: โอน / QR / บัตร / TikTok Pay / เงินสด</Paragraph>
            <ul>
              <li><b>บันทึกการชำระ:</b> เลือกออเดอร์ (PENDING) + วิธี + ยอด + สลิป/เลขอ้างอิง — สถานะ <Tag color="orange">PENDING</Tag></li>
              <li><b>ตรวจสลิป (AI):</b> ถ้าแนบรูปสลิป + ตั้ง <Text code>ANTHROPIC_API_KEY</Text> → AI อ่านยอดเทียบกับที่ต้องจ่าย (แนะนำเท่านั้น <b>ไม่ยืนยันเอง</b>)</li>
              <li><b>ยืนยัน:</b> <Tag color="green">CONFIRMED</Tag> + ออเดอร์เป็น PAID อัตโนมัติ · <b>ปฏิเสธ:</b> REJECTED · <b>คืนเงิน:</b> REFUNDED (สิทธิ์ manager)</li>
            </ul>
            <Alert type="warning" showIcon message="ตามกฎธุรกิจ: AI ห้ามยืนยันการรับเงินเอง — คนต้องกดยืนยันเสมอ" />
          </Sec>

          <Sec id="shipping">
            <Title level={4}>9. Shipping — จัดส่ง</Title>
            <Paragraph>เมนู <Link href="/admin/shipment">Shipping</Link> — ขนส่ง: Flash / Kerry / DHL / Australia Post / NZ Post</Paragraph>
            <ul>
              <li><b>สร้างการจัดส่ง:</b> เลือกออเดอร์ (PACKING) + ขนส่ง + เลขพัสดุ → ตัดสต็อกจริง + ออเดอร์เป็น SHIPPED</li>
              <li><b>เดินสถานะ:</b> SHIPPED → กำลังส่ง (IN_TRANSIT) → ถึงแล้ว (DELIVERED) → ปิดออเดอร์เป็น COMPLETED อัตโนมัติ</li>
              <li><b>แก้ tracking / พิมพ์ label:</b> label รวมผู้รับ + ที่อยู่ + รายการ (ยังไม่ต่อ API ขนส่งจริง — พิมพ์/คัดลอกเอง)</li>
            </ul>
          </Sec>

          <Sec id="customers">
            <Title level={4}>10. Customers (CRM)</Title>
            <Paragraph>เมนู <Link href="/admin/customers">Customers</Link></Paragraph>
            <ul>
              <li>ลูกค้าถูก<b>สร้างอัตโนมัติ</b>เมื่อมีออเดอร์ (ผูกจาก channel + user id)</li>
              <li>เก็บ ชื่อ, เบอร์, ที่อยู่ (หลายที่อยู่), Tags · <b>ยอดซื้อสะสม</b> = ผลรวมออเดอร์ที่จ่ายแล้ว</li>
              <li>1 ลูกค้าเชื่อมได้หลายช่องทาง (LINE + TikTok + FB = คนเดียวกัน)</li>
              <li>ที่อยู่: กางแถวลูกค้า → <b>แก้ไข / ตั้งเป็นค่าเริ่มต้น / ลบ</b> ได้ต่อรายการ (ตั้งค่าเริ่มต้นใหม่จะยกเลิกค่าเริ่มต้นเดิมอัตโนมัติ)</li>
            </ul>
          </Sec>

          <Sec id="reports">
            <Title level={4}>11. Dashboard & Reports</Title>
            <ul>
              <li><b><Link href="/admin/dashboard">Dashboard</Link>:</b> ภาพรวมวันนี้ — ยอดขายรวม/วันนี้, ออเดอร์แยกสถานะ, กราฟ 7 วัน, สินค้าขายดี, ลูกค้ายอดสูง</li>
              <li><b><Link href="/admin/reports">Reports</Link>:</b> เลือกช่วงวันที่ (RangePicker) → ยอดขายรายวัน/ตามสถานะ/ตามช่องทาง, สินค้าขายดี, สรุปสต็อก (มูลค่า/ใกล้หมด/หมด)</li>
              <li>รายได้ทุกที่นับเฉพาะออเดอร์ที่จ่ายแล้ว (PAID ขึ้นไป)</li>
            </ul>
          </Sec>

          <Sec id="permissions">
            <Title level={4}>12. Users / Roles / Permissions (RBAC)</Title>
            <Paragraph>กำหนดว่าใครทำอะไรได้ — เมนู <Link href="/admin/permissions">Permissions</Link> (เฉพาะ Administrator แก้ได้)</Paragraph>
            <Table size="small" pagination={false} rowKey="role" dataSource={perms}
              columns={[
                { title: "Role", dataIndex: "role", render: (r) => <Tag color="blue">{r}</Tag> },
                { title: "หน้าที่", dataIndex: "desc" },
                { title: "สิทธิ์ (ตัวอย่าง)", dataIndex: "perms" },
              ]} />
            <Paragraph style={{ marginTop: 8 }}>
              สิทธิ์เป็นแบบ <Text code>resource.action</Text> 26 ตัว: product.* · stock.adjust · order.* · purchase.* · payment.* · shipping.* · inbox.* · customer.* · report.view · ปุ่มในแต่ละหน้าจะซ่อน/disable ตามสิทธิ์ และ API ปฏิเสธ (403) ถ้าไม่มีสิทธิ์
            </Paragraph>
          </Sec>

          <Sec id="settings">
            <Title level={4}>13. Settings — เชื่อมช่องทาง</Title>
            <Paragraph>เมนู <Link href="/admin/settings">Settings</Link> — LINE / TikTok / Facebook Messenger / Instagram DM / Website Live Chat</Paragraph>
            <Steps direction="vertical" size="small" current={-1} items={[
              { title: "คัดลอก Webhook URL", description: <Text code>{`{origin}/api/bms/{channel}/webhook/{tenantId}`}</Text> },
              { title: "ตั้งใน console ของแพลตฟอร์ม", description: "LINE Developers / TikTok / Meta App → วาง Webhook URL + เปิด webhook" },
              { title: "วาง Access Token + Secret", description: "LINE=channel token+secret · FB/IG=Page token + App Secret (ใช้เป็น verify token+signature) · เก็บเข้ารหัส AES-256-GCM" },
              { title: "เสร็จ!", description: "ลูกค้าทัก → verify signature → AI ตอบด้วย token ของร้าน → โผล่ใน Inbox" },
            ]} />
            <Alert type="warning" showIcon message="ทุก webhook ตรวจ signature — request ที่ signature ไม่ตรงถูกปฏิเสธ (401) · Website chat เป็น public (rate-limit + CORS)" />
          </Sec>

          <Sec id="billing">
            <Title level={4}>14. Billing & แพ็กเกจ</Title>
            <Paragraph>เมนู <Link href="/admin/billing">Billing</Link> — Free / Pro / Business (จำกัดสินค้า/ช่องทาง/ออเดอร์ต่อเดือน) ดู usage + อัปเกรดได้ (โหมดสาธิต ยังไม่ตัดเงินจริง) · quota สินค้าบังคับตอนสร้างสินค้าใหม่</Paragraph>
          </Sec>

          <Sec id="saas">
            <Title level={4}>15. SaaS multi-tenant</Title>
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
            <Title level={4}>16. API / Webhook reference</Title>
            <Table size="small" pagination={false} rowKey="path" dataSource={endpoints}
              columns={[
                { title: "Method", dataIndex: "m", width: 90, render: (m) => <Tag color="purple">{m}</Tag> },
                { title: "Endpoint", dataIndex: "path", render: (p) => <Text code>{p}</Text> },
                { title: "หน้าที่", dataIndex: "desc" },
              ]} />
            <Paragraph style={{ marginTop: 8 }} type="secondary">
              GraphQL (admin) ที่ <Text code>/api/graphql</Text>: bmsProducts, bmsOrders, bmsPurchaseOrders, bmsPayments, bmsShipments, bmsConversations, bmsCustomers, bmsDashboard, bmsSalesSummary, bmsChannels, bmsBilling, bmsSignup ฯลฯ
            </Paragraph>
            <Alert style={{ marginTop: 12 }} type="info" showIcon
              message="ระบบตรวจ error อัตโนมัติรายวัน + แจ้งเตือน LINE"
              description={<>ทุกวันมี GitHub Actions ดึง error จาก <Text code>system_logs</Text> ให้ AI วิเคราะห์แล้วเปิด draft PR เสนอการแก้ให้ทีมรีวิว (ไม่ merge เอง) แล้ว<b>แจ้งเตือนทีมผ่าน LINE</b>พร้อมลิงก์ PR — รายละเอียดที่หน้า Architecture §8 และ <Text code>scripts/bms-log-triage/</Text></>}
            />
          </Sec>

          <Sec id="testai">
            <Title level={4}>17. ทดสอบ AI ด้วย Postman / webhook</Title>
            <Paragraph>
              อยากรู้ว่า AI ตอบลูกค้าได้ดีแค่ไหน — ยิงข้อความเข้าไปตรง ๆ ได้เลยโดยไม่ต้องต่อ LINE/FB จริง.
              ทั้ง 2 endpoint เป็น <b>public</b> (ไม่ต้อง login/signature) เหมาะกับ Postman/curl.
            </Paragraph>
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={<>ใช้ <Text code>tenantId</Text> ของร้านคุณ (แทน <Text code>{`{tenantId}`}</Text> ด้านล่าง)</>}
              description={<>ดู tenant id ของร้านตัวเองได้ที่ <Link href="/admin/profile">โปรไฟล์ของฉัน</Link> · base URL: dev = <Text code>http://localhost:3000</Text>, ใช้งานจริง = โดเมนร้านคุณ</>} />

            <Title level={5}>A) Playground — ดูคำตอบ + เหตุผล (แนะนำเวลาประเมินคุณภาพ)</Title>
            <Paragraph type="secondary">คืน trace เต็ม (intent / entity / tool ที่เลือก / reply) · ไม่บันทึกลง Inbox</Paragraph>
            <pre style={codeBlock}>{`POST {origin}/api/bms/chat
Content-Type: application/json

{
  "message": "มีเสื้อ Nike ไซซ์ XL ไหม ราคาเท่าไหร่",
  "channel": "web",
  "tenantId": "{tenantId}",
  "customerRef": "postman-01"
}`}</pre>

            <Title level={5}>B) Web Live Chat webhook — เหมือนลูกค้าจริง (ขึ้นใน Inbox)</Title>
            <Paragraph type="secondary">คืน <Text code>{`{ reply, sessionId }`}</Text> และบันทึกลง <Link href="/admin/inbox">Inbox</Link> ของร้าน · ยิงซ้ำ sessionId เดิม = คุยต่อเนื่อง (rate limit 120/นาที/ร้าน)</Paragraph>
            <pre style={codeBlock}>{`POST {origin}/api/bms/web/webhook/{tenantId}
Content-Type: application/json

{
  "message": "สวัสดีครับ มีเสื้อ Nike ไซซ์ XL ไหม",
  "sessionId": "postman-001"
}`}</pre>

            <Title level={5}>ตัวอย่างข้อความตาม intent</Title>
            <ul>
              <li><Text code>สวัสดีครับ</Text> → ทักทาย (GREETING)</li>
              <li><Text code>Nike XL มีไหม</Text> / <Text code>มีไซซ์ M ไหม</Text> → เช็คสต็อก+ราคา (CHECK_STOCK)</li>
              <li><Text code>เสื้อ Nike ราคาเท่าไหร่</Text> → ค้นสินค้า+ราคา</li>
              <li><Text code>สั่ง Nike 2 ตัว</Text> → สร้าง draft order (CONFIRM_ORDER)</li>
            </ul>

            <Alert type="warning" showIcon style={{ marginTop: 8 }}
              message="เตรียมก่อนเทส ไม่งั้น AI จะตอบว่า “ไม่พบสินค้า”"
              description={<ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>ร้านต้องมีสินค้าก่อน — เพิ่มเองที่ <Link href="/admin/products">Products</Link> หรือ seed เร็ว ๆ ที่ <Link href="/admin/dev/fake">Fake data</Link> (ตั้งชื่อให้มีคำที่จะถาม เช่น “Nike” จะเทสตรงกว่า)</li>
                <li>ต้องตั้ง env <Text code>ANTHROPIC_API_KEY</Text> — ไม่งั้นคำตอบเป็น rule-based/fallback (ไม่ใช่คำตอบจาก Claude จริง)</li>
              </ul>} />
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
