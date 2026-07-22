'use client';

import { useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Col,
  Divider,
  List,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import {
  ApiOutlined,
  CreditCardOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  InboxOutlined,
  RobotOutlined,
  RocketOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TruckOutlined,
  UserOutlined,
} from "@ant-design/icons";

const { Title, Paragraph, Text } = Typography;

type PersonaKey = "owner" | "staff" | "ops";
type FlowKey = "products" | "orders" | "payment" | "shipping";

const personaCards: Record<
  PersonaKey,
  {
    title: string;
    subtitle: string;
    items: string[];
    ctaLabel: string;
    ctaHref: string;
  }
> = {
  owner: {
    title: "เจ้าของร้านควรเริ่มจากอะไร",
    subtitle: "เหมาะกับวันแรกที่เริ่มเปิดระบบหรือเซ็ตร้านใหม่",
    items: [
      "เพิ่มสินค้า + รูปสินค้า + ราคา + stock ต่อไซซ์",
      "ลองจำลองออเดอร์ผ่าน Playground ให้เห็น flow จริง",
      "เชื่อมช่องทางขายจริงที่หน้า Settings",
      "เปิด Dashboard ดูภาพรวมร้านและแจ้งเตือน",
    ],
    ctaLabel: "เริ่มที่ Products",
    ctaHref: "/admin/products",
  },
  staff: {
    title: "พนักงานหน้าร้านใช้อะไรบ่อยสุด",
    subtitle: "เหมาะกับคนตอบแชท รับออเดอร์ และตามงานประจำวัน",
    items: [
      "เปิด Inbox ดูแชทใหม่และลูกค้าที่ต้องตอบก่อน",
      "ใช้ Customer 360 เพื่อดูประวัติลูกค้าแบบไม่สลับหน้า",
      "เช็ก Orders / Payment / Shipping ต่อเนื่องเป็นชุดเดียว",
      "ใช้ช่องค้นหาบนแต่ละหน้าเพื่อหา order / payment / tracking เร็วขึ้น",
    ],
    ctaLabel: "ไปที่ Inbox",
    ctaHref: "/admin/inbox",
  },
  ops: {
    title: "แอดมินระบบควรดูอะไรบ้าง",
    subtitle: "เหมาะกับคนดูสิทธิ์ผู้ใช้ เชื่อมช่องทาง และดูแล tenant",
    items: [
      "ตั้งค่า Roles / Permissions ให้ตรงหน้าที่",
      "เช็ก Channel Health และ webhook status",
      "ดู Billing, package, usage และ tenant setting",
      "ใช้คู่มือ API / webhook เมื่อต้อง debug หรือเชื่อมระบบเพิ่ม",
    ],
    ctaLabel: "ไปที่ Settings",
    ctaHref: "/admin/settings",
  },
};

const flowCards: Record<
  FlowKey,
  {
    title: string;
    path: string;
    summary: string;
    checks: string[];
    tags: string[];
  }
> = {
  products: {
    title: "1) เตรียมสินค้าให้พร้อมขาย",
    path: "Products → เพิ่มสินค้า → รูปหลายรูป → ราคา → stock ต่อไซซ์",
    summary: "เริ่มจากการเพิ่มสินค้าให้ครบก่อน โดยรูปแรกเป็น cover และรูปถัดไปเป็น gallery ของสินค้า",
    checks: [
      "กรอก SKU / Barcode / ราคา ให้ครบ",
      "อัปโหลดรูปสินค้าได้หลายรูป",
      "ตั้ง stock และ reorder point ต่อไซซ์",
      "ถ้ายังไม่มีของเข้า ใช้ Purchase รับเข้าคลังภายหลังได้",
    ],
    tags: ["Products", "Gallery", "Stock", "Category"],
  },
  orders: {
    title: "2) รับแชทและสร้างออเดอร์",
    path: "Inbox → Customer 360 → Orders",
    summary: "เมื่อมีแชทเข้า ให้ดูข้อมูลลูกค้าและสถานะงานต่อจาก Inbox ได้เลย แล้วค่อยตามต่อที่ Orders",
    checks: [
      "ดูแชทใหม่จาก Inbox ก่อน",
      "ใช้ Customer 360 ดูประวัติและข้อมูลลูกค้า",
      "เปิด Orders เพื่อตามสถานะ PENDING / PAID / PACKING",
      "ค้นหา order / customer / channel ได้จากช่องค้นหาด้านบน",
    ],
    tags: ["Inbox", "Orders", "Customer 360", "Search"],
  },
  payment: {
    title: "3) ยืนยันการชำระเงิน",
    path: "Payment → ตรวจสลิป → Confirm / Reject / Refund",
    summary: "หน้า Payment คือจุดที่ตามสถานะเงินทั้งหมด โดย AI ช่วยตรวจสลิปได้ แต่คนยังต้องกดยืนยันเอง",
    checks: [
      "ค้นหา payment id / order id / slip ref ได้",
      "ตรวจสลิปด้วย AI เป็นคำแนะนำเท่านั้น",
      "Confirm แล้วออเดอร์จะเป็น PAID",
      "Refund ใช้เมื่อรายการอยู่ในสถานะที่คืนเงินได้เท่านั้น",
    ],
    tags: ["Payment", "Slip", "Confirm", "Refund"],
  },
  shipping: {
    title: "4) จัดส่งและปิดงาน",
    path: "Shipping → Tracking → DELIVERED → Dashboard",
    summary: "เมื่อแพ็คของแล้ว ให้สร้าง shipment ใส่เลขพัสดุ และเดินสถานะจนปิดงานครบ",
    checks: [
      "สร้าง shipment จาก order ที่พร้อมส่ง",
      "บันทึก carrier และ tracking number",
      "ค้นหา shipment / order / tracking ได้จากช่องค้นหา",
      "DELIVERED จะช่วยปิด flow งานให้ครบ",
    ],
    tags: ["Shipping", "Tracking", "Carrier", "Dashboard"],
  },
};

const menuCards = [
  {
    key: "inbox",
    icon: <InboxOutlined />,
    title: "Inbox",
    desc: "รับแชท, ดู Customer 360, assign staff, ตามงานต่อจากแชท",
    bullets: ["เริ่มงานจากแชทใหม่", "มือถือใช้ flow รายชื่อ → แชทเต็มจอ พร้อมปุ่มย้อนกลับ", "แชทที่เปิดอยู่จะอ่านและล้าง badge อัตโนมัติเมื่อข้อความเข้า", "อยู่ท้ายแชทจะเลื่อนตามอัตโนมัติ; ถ้าอ่านย้อนหลังให้กดปุ่มข้อความใหม่เพื่อลงด้านล่าง", "ดูข้อมูลลูกค้าไม่ต้องสลับหน้า", "เหมาะกับทีมขาย/แอดมินหน้าร้าน"],
    href: "/admin/inbox",
  },
  {
    key: "products",
    icon: <DatabaseOutlined />,
    title: "Products & Purchase",
    desc: "เพิ่มสินค้า, รูปหลายรูป, stock, reorder point, รับของเข้าคลัง",
    bullets: ["รูปแรกเป็น cover", "รับของผ่าน Purchase", "กรองหมวดหมู่และค้นหา SKU ได้"],
    href: "/admin/products",
  },
  {
    key: "ops",
    icon: <ShoppingCartOutlined />,
    title: "Orders / Payment / Shipping",
    desc: "3 หน้านี้ควรถูกใช้ต่อเนื่องกันเป็น flow เดียว",
    bullets: ["มี search บนทุกหน้า", "ตามสถานะงานได้ชัด", "เหมาะกับงานปฏิบัติการรายวัน"],
    href: "/admin/orders",
  },
  {
    key: "revisions",
    icon: <HistoryOutlined />,
    title: "Revision History",
    desc: "ดู snapshot ก่อนแก้ไข, เปิด detail, และ compare 2 version สำหรับ records สำคัญ",
    bullets: ["รองรับ Products / Orders / Payment / Shipping", "ค้นหาด้วย SKU, ID, status, reference หรือ tracking", "Editor แสดง user login สำหรับ revision ใหม่หลังระบบส่ง editor context แล้ว"],
    href: "/admin/revisions",
  },
  {
    key: "crm",
    icon: <UserOutlined />,
    title: "Customers / CRM",
    desc: "ดูข้อมูลลูกค้า, ที่อยู่, ประวัติซื้อ, merge และค้นหาชื่อ/เบอร์",
    bullets: ["ที่อยู่หลายรายการ", "ค้นหาเร็วจากชื่อ/เบอร์", "ใช้คู่กับ Customer 360"],
    href: "/admin/customers",
  },
  {
    key: "assistant",
    icon: <RobotOutlined />,
    title: "ผู้ช่วย AI",
    desc: "ถาม/สั่งงานหลังบ้านด้วยภาษาพูด — AI ดึงข้อมูลจริงและทำงานได้ตามสิทธิ์ของบัญชีคุณ",
    bullets: [
      "ถามรายงาน/สต็อก/ออร์เดอร์ลูกค้า ได้คำตอบจากข้อมูลจริงทันที",
      "ขอ ใบเสนอราคา/ใบแจ้งหนี้ · ให้ช่วย คาดการณ์ของใกล้หมด/เสนอจำนวนสั่งซื้อ (ประมาณการ ต้องรีวิวก่อนใช้จริง)",
      "งานที่กระทบเงิน/สต็อก/ลบข้อมูล (คืนเงิน, ปรับสต็อก, ยกเลิกออร์เดอร์, ผสานลูกค้า, ส่งข้อความหาลูกค้า) AI จะเตรียม “คำขอ” ให้เท่านั้น",
      "ต้องกดปุ่ม ยืนยัน เองเสมอ ก่อนระบบจะทำจริง — เหมือนกดปุ่มเดิมในหน้า Payment/Orders",
      "เห็นเฉพาะทูลที่ตรงกับสิทธิ์ (role) ของบัญชีคุณเท่านั้น",
      "ทุกครั้งที่ AI เรียกทูล ระบบบันทึก audit ไว้โดยไม่เก็บข้อความหรือข้อมูลส่วนตัวในรายการ audit กลาง",
    ],
    href: "/admin/assistant",
  },
];

const helpRows = [
  {
    title: "AI แนะนำคำตอบลงท้าย “ค่ะ” แต่ฉันเป็นผู้ชาย อยากได้ “ครับ”",
    answer:
      "ไปที่ โปรไฟล์ (/admin/profile) ตั้งช่อง “คำลงท้าย” เป็น ผู้ชาย — ครับ แล้วบันทึก · คำตอบแนะนำในหน้า Inbox (รวมปุ่ม ขอตรวจสอบ/ขอบคุณ) จะเปลี่ยนเป็น ครับ ให้อัตโนมัติ · ถ้าไม่ตั้ง ระบบใช้ ค่ะ เป็นค่าเริ่มต้น",
  },
  {
    title: "เพิ่มสินค้าแล้ว แต่ยังขายไม่ได้",
    answer: "เช็กว่าตั้งราคา, เปิด active, และมี stock ในไซซ์ที่ต้องขายแล้วหรือยัง",
  },
  {
    title: "ค้นหา order / payment / shipment ไม่เจอ",
    answer: "ใช้ช่องค้นหาบนหน้า Orders / Payment / Shipping ได้โดยตรง ระบบค้นหาแบบพิมพ์แล้วทำงานเอง",
  },
  {
    title: "ลูกค้าทักมา แต่ไม่รู้ต้องเปิดหน้าไหนต่อ",
    answer: "เริ่มจาก Inbox แล้วดู Customer 360 ก่อน จากนั้นค่อยตามงานต่อที่ Orders / Payment / Shipping",
  },
  {
    title: "อยากเชื่อม LINE / Facebook / Website",
    answer: "ไปที่ Settings แล้วทำตาม webhook/token guide ของแต่ละช่องทาง; LINE OA จะดึงชื่อ/รูปโปรไฟล์แบบ cache หลังข้อความเข้า ถ้ามีสิทธิ์และลูกค้ายังไม่บล็อก OA",
  },
  {
    title: "อยากทดสอบว่าแชทเข้า Inbox ทันทีไหม",
    answer: "เปิด Realtime Diagnostics: กด Emit เพื่อเช็กสัญญาณ realtime อย่างเดียว หรือกด Create Msg เพื่อสร้างข้อความทดสอบให้เห็นใน Inbox จริง",
  },
  {
    title: "ใช้ ผู้ช่วย AI สั่งคืนเงิน/ปรับสต็อก/ยกเลิกออร์เดอร์แล้วทำไมยังไม่เกิดผล",
    answer:
      "ปกติแล้วครับ — งานกลุ่มนี้ AI จะเตรียม “คำขอ” เป็นการ์ดในแชทเท่านั้น ต้องกดปุ่ม ยืนยัน บนการ์ดนั้นก่อนระบบถึงจะทำจริง (เหมือนกดยืนยันในหน้า Payment/Orders ปกติ) ถ้าไม่เห็นปุ่มยืนยันหรือกดแล้วไม่ผ่าน ให้เช็กว่าบัญชีมีสิทธิ์ (permission) ของงานนั้นหรือไม่",
  },
  {
    title: "อยากดูว่าใครแก้สินค้า/ออเดอร์ และเปลี่ยนอะไรบ้าง",
    answer: "เปิด Revision History แล้วเลือกชนิดข้อมูล จากนั้นค้นหา SKU หรือ record id ได้เลย เลือก 2 แถวแล้วกด Compare เพื่อดู field ที่เปลี่ยน",
  },
];

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 88 }}>
      <Card style={{ borderRadius: 18 }}>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle ? (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              {subtitle}
            </Paragraph>
          ) : null}
          <Divider style={{ margin: "8px 0 0" }} />
          <div style={{ paddingTop: 8 }}>{children}</div>
        </Space>
      </Card>
    </section>
  );
}

export default function Page() {
  const [persona, setPersona] = useState<PersonaKey>("owner");
  const [flow, setFlow] = useState<FlowKey>("products");

  const activePersona = personaCards[persona];
  const activeFlow = flowCards[flow];

  const anchorItems = useMemo(
    () => [
      { key: "hero", href: "#hero", title: "เริ่มต้นเร็ว" },
      { key: "quickstart", href: "#quickstart", title: "Quick start ตามบทบาท" },
      { key: "workflow", href: "#workflow", title: "Flow งานทั้งระบบ" },
      { key: "menus", href: "#menus", title: "คู่มือตามเมนู" },
      { key: "faq", href: "#faq", title: "คำถามที่เจอบ่อย" },
      { key: "links", href: "#links", title: "ลิงก์ไปหน้าที่ใช้บ่อย" },
    ],
    []
  );

  return (
    <div>
      <div id="hero" style={{ marginBottom: 20 }}>
        <Card
          style={{
            borderRadius: 24,
            background:
              "linear-gradient(135deg, rgba(24,144,255,0.08) 0%, rgba(82,196,26,0.08) 100%)",
          }}
        >
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Tag color="blue" style={{ width: "fit-content", paddingInline: 12, borderRadius: 999 }}>
              คู่มือใหม่แบบใช้งานจริง
            </Tag>
            <Title style={{ margin: 0 }}>📘 คู่มือการใช้งาน AI-BMS</Title>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 18 }}>
              ปรับจากเอกสารยาวแบบเดิม ให้เป็นคู่มือที่เริ่มงานได้เร็ว หาเมนูง่าย และสอนทีมใหม่ได้ง่ายกว่าเดิม
            </Paragraph>

            <Alert
              type="info"
              showIcon
              message="ลูกค้าทัก → Inbox → Orders → Payment → Shipping → Dashboard"
              description="อ่านคู่มือตาม flow งานจริง ไม่ต้องไล่อ่านทุกหัวข้อจากบนลงล่างก่อน"
              style={{ borderRadius: 16 }}
            />

            <Space wrap>
              <Button type="primary" size="large" href="#quickstart">
                เริ่มงานใน 3 นาที
              </Button>
              <Button size="large" href="#workflow">
                ดู flow ทั้งระบบ
              </Button>
              <Button size="large" href="#menus">
                ดูคู่มือตามเมนู
              </Button>
            </Space>

            <Space wrap>
              <Tag>Inbox</Tag>
              <Tag>Products</Tag>
              <Tag>Orders</Tag>
              <Tag>Purchase</Tag>
              <Tag>Payment</Tag>
              <Tag>Shipping</Tag>
              <Tag>Customers</Tag>
              <Tag>Reports</Tag>
              <Tag>ผู้ช่วย AI</Tag>
            </Space>
          </Space>
        </Card>
      </div>

      <Row gutter={[20, 20]} align="top">
        <Col xs={24} lg={17}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Section
              id="quickstart"
              title="⚡ Quick start ตามบทบาท"
              subtitle="เลือกจากสิ่งที่คุณกำลังทำอยู่ เพื่อให้คู่มือพาไปหน้าที่ถูกต้องเร็วที่สุด"
            >
              <Space wrap style={{ marginBottom: 16 }}>
                <Button type={persona === "owner" ? "primary" : "default"} onClick={() => setPersona("owner")}>
                  เจ้าของร้าน
                </Button>
                <Button type={persona === "staff" ? "primary" : "default"} onClick={() => setPersona("staff")}>
                  พนักงานหน้าร้าน
                </Button>
                <Button type={persona === "ops" ? "primary" : "default"} onClick={() => setPersona("ops")}>
                  แอดมินระบบ
                </Button>
              </Space>

              <Card style={{ borderRadius: 16, background: "#fafcff" }}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div>
                    <Title level={4} style={{ margin: 0 }}>
                      {activePersona.title}
                    </Title>
                    <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                      {activePersona.subtitle}
                    </Paragraph>
                  </div>

                  <List
                    size="small"
                    dataSource={activePersona.items}
                    renderItem={(item, index) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space align="start">
                          <Tag color="blue" style={{ marginTop: 2 }}>{index + 1}</Tag>
                          <span>{item}</span>
                        </Space>
                      </List.Item>
                    )}
                  />

                  <div>
                    <Link href={activePersona.ctaHref}>
                      <Button type="primary" icon={<RocketOutlined />}>
                        {activePersona.ctaLabel}
                      </Button>
                    </Link>
                  </div>
                </Space>
              </Card>
            </Section>

            <Section
              id="workflow"
              title="🧭 Flow งานทั้งระบบ"
              subtitle="ถ้าคุณยังไม่แน่ใจว่าควรทำอะไรก่อน-หลัง ให้กดดูทีละ step จาก flow นี้"
            >
              <Row gutter={[14, 14]}>
                <Col xs={24}>
                  <Space wrap>
                    <Button
                      type={flow === "products" ? "primary" : "default"}
                      icon={<DatabaseOutlined />}
                      onClick={() => setFlow("products")}
                    >
                      เพิ่มสินค้า
                    </Button>
                    <Button
                      type={flow === "orders" ? "primary" : "default"}
                      icon={<ShoppingCartOutlined />}
                      onClick={() => setFlow("orders")}
                    >
                      รับออเดอร์
                    </Button>
                    <Button
                      type={flow === "payment" ? "primary" : "default"}
                      icon={<CreditCardOutlined />}
                      onClick={() => setFlow("payment")}
                    >
                      ยืนยันเงิน
                    </Button>
                    <Button
                      type={flow === "shipping" ? "primary" : "default"}
                      icon={<TruckOutlined />}
                      onClick={() => setFlow("shipping")}
                    >
                      จัดส่งและปิดงาน
                    </Button>
                  </Space>
                </Col>

                <Col xs={24}>
                  <Card style={{ borderRadius: 16 }}>
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                      <div>
                        <Title level={4} style={{ margin: 0 }}>
                          {activeFlow.title}
                        </Title>
                        <Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                          {activeFlow.path}
                        </Paragraph>
                      </div>

                      <Alert type="success" showIcon message={activeFlow.summary} style={{ borderRadius: 14 }} />

                      <Space wrap>
                        {activeFlow.tags.map((tag) => (
                          <Tag key={tag} color="blue">
                            {tag}
                          </Tag>
                        ))}
                      </Space>

                      <List
                        size="small"
                        bordered
                        style={{ borderRadius: 14 }}
                        dataSource={activeFlow.checks}
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </Space>
                  </Card>
                </Col>
              </Row>
            </Section>

            <Section
              id="menus"
              title="🧩 คู่มือตามเมนู"
              subtitle="แยกเป็นการ์ดสั้น ๆ เพื่อให้คนสแกนแล้วรู้ทันทีว่าเมนูนี้เอาไว้ทำอะไร"
            >
              <Row gutter={[14, 14]}>
                {menuCards.map((item) => (
                  <Col xs={24} md={12} key={item.key}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Space>
                          <Tag color="blue" icon={item.icon}>
                            {item.title}
                          </Tag>
                        </Space>
                        <Paragraph style={{ margin: 0 }}>{item.desc}</Paragraph>
                        <List
                          size="small"
                          dataSource={item.bullets}
                          renderItem={(bullet) => (
                            <List.Item style={{ paddingInline: 0 }}>
                              <Text type="secondary">• {bullet}</Text>
                            </List.Item>
                          )}
                        />
                        <div>
                          <Link href={item.href}>
                            <Button>เปิดหน้า {item.title}</Button>
                          </Link>
                        </div>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>

              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 16, borderRadius: 14 }}
                message="คำแนะนำการจัดกลุ่ม"
                description="Orders / Payment / Shipping ควรอยู่ใกล้กันในคู่มือ เพราะผู้ใช้ทำงานต่อเนื่องเป็น flow เดียวกัน ส่วน Products ควรอยู่คู่กับ Purchase เพราะเกี่ยวกับการมีของพร้อมขาย"
              />
            </Section>

            <Section
              id="faq"
              title="❓ คำถามที่เจอบ่อย"
              subtitle="วางแบบถาม-ตอบสั้น ๆ เพื่อช่วยลดเวลาที่ต้องไล่อ่านเอกสารยาว"
            >
              <List
                itemLayout="vertical"
                dataSource={helpRows}
                renderItem={(row) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Card style={{ borderRadius: 14 }}>
                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                        <Text strong>{row.title}</Text>
                        <Text type="secondary">{row.answer}</Text>
                      </Space>
                    </Card>
                  </List.Item>
                )}
              />
            </Section>

            <Section
              id="links"
              title="🔗 ลิงก์ไปหน้าที่ใช้บ่อย"
              subtitle="ให้ผู้ใช้ข้ามไปทำงานจริงได้ทันที ไม่ต้องอ่านจบทั้งหน้า"
            >
              <Steps
                direction="vertical"
                current={-1}
                items={[
                  {
                    title: "เริ่มตอบลูกค้า",
                    description: (
                      <>
                        เปิด <Link href="/admin/inbox">Inbox</Link> เพื่อดูแชทใหม่และ Customer 360
                      </>
                    ),
                  },
                  {
                    title: "เพิ่มสินค้า / แก้รูปสินค้า",
                    description: (
                      <>
                        เปิด <Link href="/admin/products">Products</Link> แล้วเพิ่มสินค้า รูปหลายรูป ราคา และ stock
                      </>
                    ),
                  },
                  {
                    title: "รับของเข้าคลัง",
                    description: (
                      <>
                        เปิด <Link href="/admin/purchase">Purchase</Link> เพื่อสร้าง PO และรับของ
                      </>
                    ),
                  },
                  {
                    title: "ตาม order / payment / shipment",
                    description: (
                      <>
                        ใช้ <Link href="/admin/orders">Orders</Link>, <Link href="/admin/payment">Payment</Link>,{" "}
                        <Link href="/admin/shipment">Shipping</Link> เป็น flow เดียวกัน
                      </>
                    ),
                  },
                  {
                    title: "เชื่อมช่องทางจริง",
                    description: (
                      <>
                        ไปที่ <Link href="/admin/settings">Settings</Link> เพื่อวาง token และตั้ง webhook · ถ้าต้องทดสอบ Inbox realtime ให้เปิด{" "}
                        <Link href="/admin/inbox/realtime-diagnostics">Realtime Diagnostics</Link> แล้วกด Create Msg · LINE OA จริงจะ sync ชื่อ/รูปจาก LINE profile cache หลัง webhook เข้า
                      </>
                    ),
                  },
                  {
                    title: "ตั้งชื่อร้าน + กรอกข้อมูลร้าน (ให้ AI ตอบลูกค้าได้)",
                    description: (
                      <>
                        ในการ์ด <b>ข้อมูลร้าน</b> ที่ <Link href="/admin/settings">Settings</Link> แก้ <b>ชื่อร้าน</b> ได้เอง
                        (Administrator · slug เป็นตัวระบุภายใน ระบบกำหนดให้ แก้ไม่ได้) และกรอกเวลาเปิด-ปิด, ที่อยู่, อีเมล/เว็บไซต์, บัญชีรับเงิน (ธนาคาร/พร้อมเพย์), ค่าส่ง,
                        ประเทศ/สกุลเงิน — AI จะใช้ตอบลูกค้า เช่น “ร้านชื่ออะไร/เปิดกี่โมง” “โอนเข้าบัญชีไหน” “ค่าส่งเท่าไหร่” จากข้อมูลจริง ไม่เดา
                      </>
                    ),
                  },
                  {
                    title: "ดูภาพรวมร้าน",
                    description: (
                      <>
                        เปิด <Link href="/admin/dashboard">Dashboard</Link> หรือ <Link href="/admin/reports">Reports</Link>
                      </>
                    ),
                  },
                  {
                    title: "ถาม/สั่งงานด้วย AI",
                    description: (
                      <>
                        เปิด <Link href="/admin/assistant">ผู้ช่วย AI</Link> เพื่อถามรายงาน/สต็อก/ออร์เดอร์ด้วยภาษาพูด
                        — งานที่กระทบเงิน/สต็อกจะต้องกดยืนยันเองก่อนเสมอ
                      </>
                    ),
                  },
                ]}
              />

              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12, borderRadius: 14 }}
                message="แนวคิดของคู่มือใหม่นี้"
                description="เปิดมาแล้วควรตอบได้ทันทีว่า “ฉันควรเริ่มจากตรงไหน”, “เมนูนี้ใช้ทำอะไร”, และ “ถ้าติดปัญหาควรดูตรงไหนต่อ”"
              />
            </Section>
          </Space>
        </Col>

        <Col xs={24} lg={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Card title="สารบัญ" style={{ borderRadius: 18, marginBottom: 16 }}>
              <Anchor affix={false} items={anchorItems} />
            </Card>

            <Card title="ทางลัดแนะนำ" style={{ borderRadius: 18, marginBottom: 16 }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Link href="/admin/inbox">
                  <Button block icon={<InboxOutlined />}>
                    ไปที่ Inbox
                  </Button>
                </Link>
                <Link href="/admin/products">
                  <Button block icon={<DatabaseOutlined />}>
                    ไปที่ Products
                  </Button>
                </Link>
                <Link href="/admin/orders">
                  <Button block icon={<ShoppingCartOutlined />}>
                    ไปที่ Orders
                  </Button>
                </Link>
                <Link href="/admin/assistant">
                  <Button block icon={<RobotOutlined />}>
                    ไปที่ ผู้ช่วย AI
                  </Button>
                </Link>
                <Link href="/admin/settings">
                  <Button block icon={<CustomerServiceOutlined />}>
                    ไปที่ Settings
                  </Button>
                </Link>
                <Link href="/admin/inbox/realtime-diagnostics">
                  <Button block icon={<ApiOutlined />}>
                    ทดสอบ Realtime Inbox
                  </Button>
                </Link>
              </Space>
            </Card>

            <Card title="คู่มือที่ควรมีต่อ" style={{ borderRadius: 18 }}>
              <List
                size="small"
                dataSource={[
                  "search คู่มือจริงด้านบน",
                  "FAQ แยกตามเมนู",
                  "วิดีโอ/ภาพสั้นอธิบาย flow",
                  "ปุ่มเปิดหน้าจริงจากทุก section",
                  "คู่มือย่อสำหรับ onboarding พนักงานใหม่",
                ]}
                renderItem={(item) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Text type="secondary">• {item}</Text>
                  </List.Item>
                )}
              />
            </Card>
          </div>
        </Col>
      </Row>

      <Divider />

      <Card style={{ borderRadius: 18 }}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Title level={4} style={{ margin: 0 }}>
            หมายเหตุ
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            หน้านี้ถูกปรับให้เป็น “คู่มือใช้งานง่าย” ก่อน โดยเน้นการเริ่มงานไวและการมอง flow งานจริง ถ้าคุณชอบทิศทางนี้
            รอบถัดไปเราค่อยแตกลงรายละเอียดรายเมนูและเพิ่ม FAQ / search คู่มือจริงต่อได้
          </Paragraph>
          <Space wrap>
            <Tag icon={<ShopOutlined />}>เหมาะกับร้านใหม่</Tag>
            <Tag icon={<DashboardOutlined />}>เหมาะกับ onboarding ทีม</Tag>
            <Tag icon={<FileSearchOutlined />}>เหมาะกับงานปฏิบัติการรายวัน</Tag>
            <Tag icon={<ApiOutlined />}>ต่อยอดเป็นคู่มือ API ได้</Tag>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
