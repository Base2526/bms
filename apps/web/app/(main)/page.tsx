"use client";

import { gql, useQuery } from "@apollo/client";
import { Row, Col, Card, Button, Typography, Space, Tag, Skeleton, Alert } from "antd";
import Link from "next/link";
import {
  RocketOutlined,
  MessageOutlined,
  ShoppingCartOutlined,
  InboxOutlined,
  RobotOutlined,
  ShopOutlined,
  CheckCircleFilled,
  ArrowRightOutlined,
  TikTokFilled,
  FacebookFilled,
  InstagramFilled,
  GlobalOutlined,
  SafetyOutlined,
  LockOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useSessionCtx } from "@/lib/session-context";

const { Title, Paragraph, Text } = Typography;

const Q_PLANS = gql`
  query {
    bmsPublicPlans {
      code
      name
      price_monthly
      max_products
      max_channels
      max_orders_month
      max_users
    }
  }
`;

const CHANNELS = [
  { label: "LINE", color: "#06C755", icon: <MessageOutlined /> },
  { label: "TikTok", color: "#000000", icon: <TikTokFilled /> },
  { label: "Facebook", color: "#1877F2", icon: <FacebookFilled /> },
  { label: "Instagram", color: "#C13584", icon: <InstagramFilled /> },
  { label: "Website", color: "#1677ff", icon: <GlobalOutlined /> },
];

const TRUST_POINTS = [
  {
    icon: <SafetyOutlined />,
    title: "แยกข้อมูลแต่ละร้านเด็ดขาด",
    desc: "บังคับแยกข้อมูลระดับฐานข้อมูล (Row-Level Security) ร้านหนึ่งไม่สามารถเห็นข้อมูลสินค้า ออเดอร์ หรือลูกค้าของอีกร้านได้ แม้แต่ตอนแก้บั๊ก",
  },
  {
    icon: <LockOutlined />,
    title: "Token ช่องทางถูกเข้ารหัส",
    desc: "รหัสผ่านถูก hash ส่วน token เชื่อมต่อ LINE/Facebook/Instagram/TikTok ของร้านถูกเข้ารหัสก่อนจัดเก็บเสมอ",
  },
  {
    icon: <TeamOutlined />,
    title: "กำหนดสิทธิ์พนักงานได้ละเอียด",
    desc: "แบ่งบทบาท Manager/Sales/Warehouse พร้อม audit log บันทึกทุกการกระทำสำคัญของแอดมิน ตรวจสอบย้อนหลังได้",
  },
];

const FEATURES = [
  {
    icon: <MessageOutlined />,
    title: "Omnichannel Inbox",
    desc: "รวมแชทจาก LINE, TikTok, Facebook, Instagram และ Website ไว้ที่เดียว ตอบลูกค้าไม่พลาดแม้แอดมินไม่ว่าง",
  },
  {
    icon: <RobotOutlined />,
    title: "AI ตอบลูกค้าอัตโนมัติ",
    desc: "เช็คสต็อก บอกราคา สร้างออเดอร์ให้ลูกค้าได้ทันทีจากการแชท ไม่ต้องรอแอดมินตอบทีละคน",
  },
  {
    icon: <ShoppingCartOutlined />,
    title: "จัดการสินค้า/ออเดอร์ครบวงจร",
    desc: "สต็อกเรียลไทม์ ออเดอร์ครบวงจรตั้งแต่สั่งซื้อจนจัดส่ง พร้อมระบบแจ้งเตือนสินค้าใกล้หมด",
  },
  {
    icon: <InboxOutlined />,
    title: "จัดซื้อ + การเงิน + จัดส่ง",
    desc: "ออกใบสั่งซื้อ รับสินค้าเข้าคลัง ตรวจสลิปด้วย AI และติดตามสถานะจัดส่งในระบบเดียว",
  },
];

const lim = (v: number) => (v < 0 ? "ไม่จำกัด" : v.toLocaleString());

function PlanCard({ plan, highlight }: { plan: any; highlight?: boolean }) {
  return (
    <Card
      style={{
        height: "100%",
        borderColor: highlight ? "#1677ff" : undefined,
        borderWidth: highlight ? 2 : 1,
        position: "relative",
      }}
    >
      {highlight && (
        <Tag color="blue" style={{ position: "absolute", top: -12, left: 20 }}>แนะนำ</Tag>
      )}
      <Title level={4} style={{ marginTop: highlight ? 8 : 0 }}>{plan.name}</Title>
      <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
        {plan.price_monthly > 0 ? (
          <>{Number(plan.price_monthly).toLocaleString()} <Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>฿ / เดือน</Text></>
        ) : (
          "ฟรี"
        )}
      </div>
      <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 20 }}>
        <div><CheckCircleFilled style={{ color: "#52c41a", marginInlineEnd: 8 }} />สินค้าได้สูงสุด {lim(plan.max_products)}</div>
        <div><CheckCircleFilled style={{ color: "#52c41a", marginInlineEnd: 8 }} />เชื่อมช่องทางได้ {lim(plan.max_channels)}</div>
        <div><CheckCircleFilled style={{ color: "#52c41a", marginInlineEnd: 8 }} />ออเดอร์/เดือน {lim(plan.max_orders_month)}</div>
        <div><CheckCircleFilled style={{ color: "#52c41a", marginInlineEnd: 8 }} />ทีมงานได้สูงสุด {lim(plan.max_users)} คน</div>
      </Space>
      <Link href="/shop-signup">
        <Button type={highlight ? "primary" : "default"} block size="large">เริ่มใช้งาน</Button>
      </Link>
    </Card>
  );
}

export default function HomePage() {
  const { admin, loading: sessionLoading } = useSessionCtx();
  const { data, loading, error } = useQuery(Q_PLANS, { fetchPolicy: "cache-and-network" });
  const plans: any[] = data?.bmsPublicPlans || [];

  const primaryCta = !sessionLoading && admin
    ? { href: "/admin/dashboard", label: "ไปที่ Dashboard ร้านของฉัน" }
    : { href: "/shop-signup", label: "สมัครใช้งานฟรี" };

  return (
    <div>
      {/* ---- Hero ---- */}
      <div
        style={{
          textAlign: "center",
          padding: "56px 16px 48px",
          borderRadius: 12,
          background: "linear-gradient(135deg, rgba(22,119,255,0.12), rgba(82,196,26,0.08))",
          marginBottom: 40,
        }}
      >
        <Tag color="blue" icon={<ShopOutlined />} style={{ marginBottom: 16 }}>AI Business Management System</Tag>
        <Title level={1} style={{ fontSize: "clamp(28px, 5vw, 44px)", marginBottom: 12 }}>
          ให้ AI ดูแลลูกค้าคุณ<br />ตั้งแต่แชทแรกจนของถึงมือ
        </Title>
        <Paragraph style={{ fontSize: 18, maxWidth: 640, margin: "0 auto 28px" }} type="secondary">
          AI-BMS รวมแชทจากทุกช่องทาง ให้ AI ตอบลูกค้า เช็คสต็อก สร้างออเดอร์ ตัดสต็อก และติดตามจัดส่ง
          — ระบบเดียวจบตั้งแต่บทสนทนาแรกจนถึงพัสดุถึงบ้านลูกค้า
        </Paragraph>
        <Space size={12} wrap>
          <Link href={primaryCta.href}>
            <Button type="primary" size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
          </Link>
          <Link href="#pricing">
            <Button size="large" icon={<ArrowRightOutlined />}>ดูแพ็กเกจราคา</Button>
          </Link>
        </Space>

        <div style={{ marginTop: 36 }}>
          <Text type="secondary" style={{ display: "block", marginBottom: 14, fontSize: 13 }}>
            เชื่อมต่อและตอบลูกค้าได้จากทุกช่องทาง
          </Text>
          <Space size={28} wrap style={{ justifyContent: "center", display: "flex" }}>
            {CHANNELS.map((c) => (
              <Space key={c.label} size={6} align="center">
                <span style={{ color: c.color, fontSize: 20, display: "inline-flex" }}>{c.icon}</span>
                <Text strong>{c.label}</Text>
              </Space>
            ))}
          </Space>
        </div>
      </div>

      {/* ---- Features ---- */}
      <div style={{ marginBottom: 48 }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 8 }}>ทำอะไรได้บ้าง</Title>
        <Paragraph style={{ textAlign: "center", marginBottom: 32 }} type="secondary">
          ครบทุกโมดูลที่ร้านค้าออนไลน์ต้องใช้ ในระบบเดียว
        </Paragraph>
        <Row gutter={[24, 24]}>
          {FEATURES.map((f) => (
            <Col xs={24} sm={12} lg={6} key={f.title}>
              <Card style={{ height: "100%" }}>
                <div style={{ fontSize: 28, color: "#1677ff", marginBottom: 12 }}>{f.icon}</div>
                <Title level={5}>{f.title}</Title>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>{f.desc}</Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* ---- Security & Trust ---- */}
      <div style={{ marginBottom: 48 }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 8 }}>ออกแบบมาให้ปลอดภัย</Title>
        <Paragraph style={{ textAlign: "center", marginBottom: 32 }} type="secondary">
          ข้อมูลร้านค้าและลูกค้าของคุณเป็นเรื่องสำคัญ เราออกแบบระบบให้ปลอดภัยตั้งแต่สถาปัตยกรรม
        </Paragraph>
        <Row gutter={[24, 24]}>
          {TRUST_POINTS.map((p) => (
            <Col xs={24} md={8} key={p.title}>
              <Card style={{ height: "100%", textAlign: "center" }}>
                <div style={{ fontSize: 32, color: "#1677ff", marginBottom: 12 }}>{p.icon}</div>
                <Title level={5}>{p.title}</Title>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>{p.desc}</Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      </div>

      {/* ---- Pricing ---- */}
      <div id="pricing" style={{ marginBottom: 32 }}>
        <Title level={2} style={{ textAlign: "center", marginBottom: 8 }}>แพ็กเกจราคา</Title>
        <Paragraph style={{ textAlign: "center", marginBottom: 32 }} type="secondary">
          เริ่มต้นฟรี อัปเกรดเมื่อร้านโตขึ้น ไม่มีสัญญาผูกมัด · ไม่ต้องใช้บัตรเครดิต
        </Paragraph>

        {error && (
          <Alert type="error" showIcon message="โหลดแพ็กเกจไม่ได้" description={error.message} style={{ marginBottom: 16 }} />
        )}

        {loading && !plans.length ? (
          <Row gutter={[24, 24]}>
            {[1, 2, 3].map((i) => (
              <Col xs={24} md={8} key={i}><Card><Skeleton active paragraph={{ rows: 5 }} /></Card></Col>
            ))}
          </Row>
        ) : (
          <Row gutter={[24, 24]}>
            {plans.map((p) => (
              <Col xs={24} md={8} key={p.code}>
                <PlanCard plan={p} highlight={p.code === "pro"} />
              </Col>
            ))}
          </Row>
        )}
      </div>

      {/* ---- Final CTA ---- */}
      <div style={{ textAlign: "center", padding: "40px 16px", borderRadius: 12, background: "var(--app-hover, rgba(22,119,255,0.06))" }}>
        <Title level={3}>พร้อมเปิดร้านกับ AI-BMS แล้วหรือยัง?</Title>
        <Paragraph type="secondary" style={{ marginBottom: 20 }}>สมัครฟรี ใช้งานได้ทันที ไม่ต้องใช้บัตรเครดิต</Paragraph>
        <Link href={primaryCta.href}>
          <Button type="primary" size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
        </Link>
      </div>
    </div>
  );
}
