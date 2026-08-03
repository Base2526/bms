'use client';
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CreditCardOutlined,
  DollarOutlined,
  FileTextOutlined,
  InboxOutlined,
  MessageOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  TruckOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import styles from "./dashboard.module.css";

const { Text, Title } = Typography;

const Q_DASH = gql`
  query {
    bmsDashboard {
      revenueTotal revenueToday orderCount lowStockCount customerCount
      ordersByStatus { status count }
      topProducts { sku name qty revenue }
      topCustomers { id name tags spent orders }
      salesDaily { day revenue orders }
      couponSummary {
        discountThisMonth
        redemptionsThisMonth
        topCoupons {
          code
          redemptions
          discount
          usages { orderId customerId customerName channel status discountAmount totalAmount createdAt }
        }
      }
    }
  }
`;

// เพิ่ม bmsChannels (has_token/active) คู่กับ bmsChannelHealth เพราะ status บน DB เป็นค่า
// default 'connected' เสมอแม้ยังไม่เคยตั้งค่าเลย — ต้องเช็ค has_token ก่อนถึงจะรู้ว่า "ยังไม่ตั้งค่า"
// หรือ "ตั้งค่าแล้วแต่เชื่อมต่อมีปัญหาจริง" (ลำดับความสำคัญเดียวกับหน้า /admin/settings)
const Q_CHANNELS = gql`
  query {
    bmsChannels { channel active has_token }
    bmsChannelHealth { channel active status status_detail }
  }
`;
const Q_AI = gql`query { bmsAiConfig { has_key } bmsAiUsage { count limit remaining unlimited planName } }`;
const Q_ALERTS = gql`
  query { bmsOperationalAlerts { packingOverdueCount slipPendingCount reservationExpiringCount chatWaitingCount } }
`;
const Q_AI_FAILURES = gql`
  query {
    bmsAiFailureSummary(days: 7) {
      days
      totalToolCalls
      errorCalls
      handoffCount
      topFailingTools { tool outcome count }
    }
  }
`;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange",
  PAID: "blue",
  PACKING: "cyan",
  SHIPPED: "geekblue",
  COMPLETED: "green",
  CANCELLED: "default",
  RETURNED: "red",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "รอชำระ",
  PAID: "จ่ายแล้ว",
  PACKING: "พร้อมส่ง",
  SHIPPED: "จัดส่งแล้ว",
  COMPLETED: "สำเร็จ",
  CANCELLED: "ยกเลิก",
  RETURNED: "คืนสินค้า",
};
const TAG_COLOR: Record<string, string> = { VIP: "gold", "ลูกค้าใหม่": "blue", "ลูกค้าประจำ": "green" };

// เรียง "แชท-ตอบสด" ก่อน ตามด้วยช่องทางที่ต้อง token จริง — ตั้งใจไม่รวม "web" (Live Chat หน้าเว็บ)
// เพราะ has_token ของ web เป็น false เสมอโดยดีไซน์ (ไม่ใช้ token เลย) ถ้าเอามาขึ้น chip ด้วย
// ตรรกะเดียวกับ /admin/settings จะโชว์ "ยังไม่ตั้งค่า" ผิดๆ แม้ร้านเปิดใช้งานอยู่จริง
const CHANNEL_ORDER = ["line", "facebook", "instagram", "tiktok", "shopee", "lazada"];
const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok Chat",
  web: "Web Live Chat",
  shopee: "Shopee",
  lazada: "Lazada",
};
const HEALTH_TEXT: Record<string, string> = {
  token_expired: "Token หมดอายุ/ถูก revoke",
  webhook_failed: "Webhook verify ไม่ผ่าน",
  rate_limited: "โดน Rate Limit",
  no_events: "ไม่มีข้อความเข้านานผิดปกติ",
  send_failed: "รับข้อความได้ แต่ตอบกลับไม่ได้",
};

const baht = (value: number | null | undefined) => `${Number(value ?? 0).toLocaleString()} ฿`;
const countOf = (rows: any[] = [], status: string) => Number(rows.find((r) => r.status === status)?.count ?? 0);

// ลำดับความสำคัญเดียวกับ /admin/settings: ยังไม่ตั้งค่า > ปิดใช้งานเอง > สุขภาพจริง
function channelState(cfg: any, health: any): { tone: "ok" | "bad" | "unset"; text: string } {
  if (!cfg?.has_token) return { tone: "unset", text: "ยังไม่ตั้งค่า" };
  if (cfg?.active === false) return { tone: "unset", text: "ปิดใช้งานเอง" };
  const status = health?.status || "connected";
  if (status === "connected") return { tone: "ok", text: "พร้อมใช้งาน" };
  return { tone: "bad", text: HEALTH_TEXT[status] || status };
}

function KpiCard({ title, value, hint, icon }: { title: string; value: string | number; hint: string; icon: React.ReactNode }) {
  return (
    <Card style={{ height: "100%", borderRadius: 10 }} styles={{ body: { padding: "10px 12px" } }}>
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
        <Space style={{ justifyContent: "space-between", width: "100%" }} align="center">
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
          <span style={{ color: "#1677ff", fontSize: 13, flexShrink: 0 }}>{icon}</span>
        </Space>
        <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{value}</div>
        <Text type="secondary" style={{ fontSize: 10.5 }}>{hint}</Text>
      </Space>
    </Card>
  );
}

type Tier = "crit" | "warn" | "info";
const TIER_STYLE: Record<Tier, { color: string; bg: string; border: string }> = {
  crit: { color: "#b3261e", bg: "#fdecea", border: "rgba(179,38,30,0.28)" },
  warn: { color: "#92620a", bg: "#fff4e0", border: "rgba(146,98,10,0.28)" },
  info: { color: "#0958d9", bg: "#e8f2ff", border: "rgba(9,88,217,0.24)" },
};

function TriageRow({
  tier, icon, title, sub, count, href, cta,
}: { tier: Tier; icon: React.ReactNode; title: string; sub: string; count: number; href: string; cta: string }) {
  const s = TIER_STYLE[tier];
  return (
    <Link
      href={href}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "13px 16px",
        borderBottom: "1px solid var(--app-border)", color: "inherit",
        background: tier === "crit" ? s.bg : undefined,
      }}
    >
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 3, background: s.color, flex: "none" }} />
      <span style={{ fontSize: 18, width: 22, textAlign: "center", flex: "none", color: s.color }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--app-muted)", marginTop: 2 }}>{sub}</div>
      </span>
      <span style={{ fontSize: 22, fontWeight: 600, color: s.color, minWidth: 46, textAlign: "right", flex: "none" }}>{count}</span>
      <span
        style={{
          flex: "none", fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 7, whiteSpace: "nowrap",
          border: `1px solid ${s.border}`,
          background: tier === "crit" ? s.color : "var(--app-surface-2)",
          color: tier === "crit" ? "#fff" : "var(--app-text)",
        }}
      >
        {cta}
      </span>
    </Link>
  );
}

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q_DASH, { fetchPolicy: "cache-first" });
  const d = data?.bmsDashboard;
  const { data: channelsData } = useQuery(Q_CHANNELS, { fetchPolicy: "cache-first", pollInterval: 60000 });
  const cfgByChannel: Record<string, any> = Object.fromEntries((channelsData?.bmsChannels || []).map((c: any) => [c.channel, c]));
  const healthByChannel: Record<string, any> = Object.fromEntries((channelsData?.bmsChannelHealth || []).map((h: any) => [h.channel, h]));
  const channelStates = CHANNEL_ORDER.map((key) => ({ key, ...channelState(cfgByChannel[key], healthByChannel[key]) }));
  const brokenChannels = channelStates.filter((c) => c.tone === "bad");

  const { data: aiData } = useQuery(Q_AI, { fetchPolicy: "cache-first" });
  const aiUsage = aiData?.bmsAiUsage;
  const aiHasKey = aiData?.bmsAiConfig?.has_key;
  const aiOverLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.remaining === 0;
  const aiNearLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.limit > 0 && aiUsage.remaining > 0 && aiUsage.remaining <= aiUsage.limit * 0.2;
  const { data: alertsData } = useQuery(Q_ALERTS, { fetchPolicy: "cache-first", pollInterval: 120000 });
  const alerts = alertsData?.bmsOperationalAlerts;
  const { data: aiFailureData } = useQuery(Q_AI_FAILURES, { fetchPolicy: "cache-first", pollInterval: 120000 });
  const aiFailure = aiFailureData?.bmsAiFailureSummary;
  const aiFailureRate = aiFailure?.totalToolCalls
    ? Math.round((aiFailure.errorCalls / aiFailure.totalToolCalls) * 1000) / 10
    : 0;

  if (error) return <Alert type="error" message="โหลด dashboard ไม่ได้" description={error.message} showIcon />;

  const ordersByStatus = d?.ordersByStatus || [];
  const pending = countOf(ordersByStatus, "PENDING");
  const paid = countOf(ordersByStatus, "PAID");
  const packing = countOf(ordersByStatus, "PACKING");
  const shipped = countOf(ordersByStatus, "SHIPPED");
  const completed = countOf(ordersByStatus, "COMPLETED");
  const maxRev = Math.max(1, ...(d?.salesDaily || []).map((x: any) => x.revenue));

  // ===== "ต้องทำตอนนี้" — รวม alert/action ที่เคยกระจายกัน 8 กล่องเป็นลิสต์เดียว เรียงตามความรุนแรงจริง
  // (ช่องทางพัง/แชทค้าง = วิกฤต เพราะกระทบลูกค้าตรงๆ, ของค้างในกระบวนการ = ต้องตาม, พร้อมส่ง/สต็อก = แจ้งเฉยๆ)
  const triage: Array<{ id: string; tier: Tier; icon: React.ReactNode; title: string; sub: string; count: number; href: string; cta: string }> = [];

  for (const ch of brokenChannels) {
    triage.push({
      id: `ch-${ch.key}`, tier: "crit", icon: <ApiOutlined />,
      title: `ช่องทาง ${CHANNEL_LABEL[ch.key]} เชื่อมต่อมีปัญหา`,
      sub: `${ch.text} — ข้อความลูกค้าอาจเข้าไม่ได้ตั้งแต่ตอนนี้`,
      count: 1, href: "/admin/settings", cta: "ไปที่ Settings",
    });
  }
  if (alerts?.chatWaitingCount > 0) {
    triage.push({
      id: "chat", tier: "crit", icon: <MessageOutlined />,
      title: "แชทลูกค้ารอตอบนานเกิน 30 นาที", sub: "ลูกค้าอาจรอไปหาที่อื่นแล้ว — เร่งด่วนที่สุดในตอนนี้",
      count: alerts.chatWaitingCount, href: "/admin/inbox", cta: "เปิด Inbox",
    });
  }
  if (alerts?.slipPendingCount > 0) {
    triage.push({
      id: "slip", tier: "warn", icon: <FileTextOutlined />,
      title: "สลิปโอนรอตรวจนานเกิน 2 ชั่วโมง", sub: "ลูกค้าโอนแล้วแต่ยังไม่ถูกยืนยัน",
      count: alerts.slipPendingCount, href: "/admin/payment?status=PENDING", cta: "ตรวจสลิป",
    });
  }
  if (pending > 0) {
    triage.push({
      id: "pending", tier: "warn", icon: <CreditCardOutlined />,
      title: "ออเดอร์รอลูกค้าชำระเงิน", sub: "สต็อกถูกจองไว้ระหว่างรอ — ติดตามลูกค้าถ้าเกินกำหนด",
      count: pending, href: "/admin/orders", cta: "ดูออเดอร์",
    });
  }
  if (alerts?.packingOverdueCount > 0) {
    triage.push({
      id: "packover", tier: "warn", icon: <InboxOutlined />,
      title: "ออเดอร์ค้างแพ็คนานเกิน 24 ชั่วโมง", sub: "จ่ายเงินแล้ว ค้างอยู่ในขั้นแพ็คนานผิดปกติ",
      count: alerts.packingOverdueCount, href: "/admin/orders?status=PACKING", cta: "ดูออเดอร์",
    });
  }
  if (paid > 0) {
    triage.push({
      id: "paid", tier: "warn", icon: <CheckCircleOutlined />,
      title: "ออเดอร์รอเริ่มแพ็ค", sub: "จ่ายเงินแล้ว รอเข้าสู่ขั้นแพ็ค",
      count: paid, href: "/admin/orders", cta: "ดูออเดอร์",
    });
  }
  if (alerts?.reservationExpiringCount > 0) {
    triage.push({
      id: "resv", tier: "warn", icon: <ClockCircleOutlined />,
      title: "การจองสต็อกใกล้หมดอายุ", sub: "ติดตามลูกค้าก่อนสต็อกที่จองไว้ถูกปล่อยคืน",
      count: alerts.reservationExpiringCount, href: "/admin/orders?status=PENDING", cta: "ติดตามลูกค้า",
    });
  }
  if (packing > 0) {
    triage.push({
      id: "ready", tier: "info", icon: <TruckOutlined />,
      title: "แพ็คเสร็จแล้ว พร้อมส่ง", sub: "รอสร้างพัสดุและอัปเดตเลขติดตาม",
      count: packing, href: "/admin/shipment", cta: "สร้างพัสดุ",
    });
  }
  if ((d?.lowStockCount ?? 0) > 0) {
    triage.push({
      id: "stock", tier: "info", icon: <ShoppingCartOutlined />,
      title: "สินค้าใกล้หมด/หมดสต็อก", sub: "อาจพลาดโอกาสขายถ้าไม่เติมทัน",
      count: d.lowStockCount, href: "/admin/products", cta: "ดูสินค้า",
    });
  }

  const systemOk = brokenChannels.length === 0;

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 20 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">ภาพรวมวันนี้และงานที่ควรจัดการก่อน</Text>
        </div>
        <Space size={10}>
          <span
            title={systemOk ? "" : `ช่องทางที่มีปัญหา: ${brokenChannels.map((c) => CHANNEL_LABEL[c.key]).join(", ")}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500,
              padding: "5px 11px", borderRadius: 999, border: "1px solid",
              color: systemOk ? "#0f7a4d" : "#b3261e",
              background: systemOk ? "#e7f7ef" : "#fdecea",
              borderColor: systemOk ? "rgba(15,122,77,0.28)" : "rgba(179,38,30,0.28)",
            }}
          >
            {systemOk ? <CheckCircleOutlined /> : <WarningOutlined />}
            {systemOk ? "ระบบพร้อมใช้งาน" : "มีปัญหาที่ต้องตรวจสอบ"}
          </span>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </Space>

      <Text strong style={{ display: "block", marginBottom: 4 }}>สถานะช่องทางเชื่อมต่อ</Text>
      <Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
        เฉพาะช่องทางที่ตั้งค่าไว้จะขึ้นสถานะจริง — ที่ยังไม่ตั้งค่ากดไปตั้งค่าได้เลย
      </Text>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        {channelStates.map((c) => {
          const clickable = c.tone !== "ok";
          const dotColor = c.tone === "ok" ? "#0f7a4d" : c.tone === "bad" ? "#b3261e" : "var(--app-muted)";
          const textColor = c.tone === "ok" ? "#0f7a4d" : c.tone === "bad" ? "#b3261e" : "var(--app-muted)";
          const content = (
            <>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flex: "none" }} />
              <span>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{CHANNEL_LABEL[c.key]}</div>
                <div style={{ fontSize: 11.5, color: textColor, marginTop: 1 }}>{c.text}</div>
              </span>
              {clickable && <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--app-muted)" }}>ไปที่ Settings →</span>}
            </>
          );
          const style: React.CSSProperties = {
            display: "flex", alignItems: "center", gap: 10, minWidth: 176, flex: "1 1 176px",
            background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 10,
            padding: "10px 14px", textDecoration: "none", color: "inherit",
            borderStyle: clickable ? "dashed" : "solid",
          };
          return clickable
            ? <Link key={c.key} href={`/admin/settings?focus=channel&channel=${c.key}`} style={style}>{content}</Link>
            : <div key={c.key} style={style}>{content}</div>;
        })}
      </div>

      <Text strong style={{ display: "block", marginBottom: 4 }}>ต้องทำตอนนี้</Text>
      <Text type="secondary" style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
        เรียงตามความรุนแรง — งานด่วนที่สุดอยู่บนสุด
      </Text>
      <div style={{ background: "var(--app-surface)", border: "1px solid var(--app-border)", borderRadius: 12, overflow: "hidden", marginBottom: 24 }}>
        {triage.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px", fontSize: 13, color: "#0f7a4d", background: "#e7f7ef" }}>
            <CheckCircleOutlined /> ไม่มีงานด่วนตอนนี้ — ทุกอย่างเรียบร้อย
          </div>
        ) : (
          triage.map((t) => <TriageRow key={t.id} {...t} />)
        )}
      </div>

      <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
        <Col xs={12} xl={6}>
          <KpiCard title="ยอดขายวันนี้" value={baht(d?.revenueToday)} hint={`ยอดขายรวม ${baht(d?.revenueTotal)}`} icon={<DollarOutlined />} />
        </Col>
        <Col xs={12} xl={6}>
          <KpiCard title="ออเดอร์ทั้งหมด" value={d?.orderCount ?? 0} hint={`สำเร็จ ${completed} · ส่งแล้ว ${shipped}`} icon={<ShoppingCartOutlined />} />
        </Col>
        <Col xs={12} xl={6}>
          <KpiCard title="ลูกค้าทั้งหมด" value={d?.customerCount ?? 0} hint="คน" icon={<TeamOutlined />} />
        </Col>
        <Col xs={12} xl={6}>
          <KpiCard title="สินค้าใกล้หมด" value={`${d?.lowStockCount ?? 0} รายการ`} hint="ดูรายละเอียดในลิสต์ด้านบน" icon={<InboxOutlined />} />
        </Col>
      </Row>

      {/* ===== ภาพรวมธุรกิจ — ดูเมื่อมีเวลา ไม่ใช่งานเร่งด่วน จึงลดน้ำหนักภาพลงด้วยพื้นหลังทึบกว่า ===== */}
      <div style={{ background: "var(--app-surface-2)", border: "1px solid var(--app-border)", borderRadius: 12, padding: 12, marginTop: 12 }}>
        <Text strong style={{ display: "block", marginBottom: 8, fontSize: 12.5 }}>ภาพรวมธุรกิจ</Text>

        <Row gutter={[8, 8]}>
          <Col xs={24} lg={16}>
            <Card title="ยอดขาย 7 วันล่าสุด" loading={loading} style={{ borderRadius: 10 }} className={styles.compactCard}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90, paddingTop: 4 }}>
                {(d?.salesDaily || []).map((x: any) => (
                  <div key={x.day} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                    <div style={{ fontSize: 9.5, color: "var(--app-muted)", marginBottom: 3, minHeight: 12 }}>
                      {x.revenue > 0 ? `${(x.revenue / 1000).toFixed(1)}k` : ""}
                    </div>
                    <div
                      title={`${x.revenue.toLocaleString()} ฿ · ${x.orders} ออเดอร์`}
                      style={{
                        height: `${Math.round((x.revenue / maxRev) * 66)}px`,
                        minHeight: x.revenue > 0 ? 4 : 2,
                        background: x.revenue > 0 ? "linear-gradient(180deg,#69b1ff,#1677ff)" : "var(--app-surface-2)",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                    <div style={{ fontSize: 9.5, color: "var(--app-muted)", marginTop: 4 }}>{x.day.slice(5)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Card title="สรุปธุรกิจ" loading={loading} style={{ borderRadius: 10, height: "100%" }} className={styles.compactCard}>
              <Space direction="vertical" size={4} style={{ width: "100%", fontSize: 12 }}>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>ยอดขายรวม</Text>
                  <Text strong style={{ fontSize: 12 }}>{baht(d?.revenueTotal)}</Text>
                </Space>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>ลูกค้า</Text>
                  <Text strong style={{ fontSize: 12 }}><TeamOutlined /> {Number(d?.customerCount ?? 0).toLocaleString()}</Text>
                </Space>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>สินค้าใกล้หมด</Text>
                  <Text strong style={{ fontSize: 12 }}>{Number(d?.lowStockCount ?? 0).toLocaleString()}</Text>
                </Space>
                <Space wrap size={6} style={{ marginTop: 2 }}>
                  <Link href="/admin/reports"><Button size="small">Reports</Button></Link>
                  <Link href="/admin/products"><Button size="small">Products</Button></Link>
                  <Link href="/admin/customers"><Button size="small">Customers</Button></Link>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
          <Col xs={24} lg={14}>
            <Card title="สินค้าขายดี" loading={loading} style={{ borderRadius: 10 }} className={styles.compactCard}>
              <Table
                rowKey="sku"
                size="small"
                pagination={false}
                dataSource={d?.topProducts || []}
                locale={{ emptyText: "ยังไม่มียอดขาย" }}
                columns={[
                  { title: "สินค้า", dataIndex: "name", key: "name" },
                  { title: "ขายได้", dataIndex: "qty", key: "qty", width: 90, align: "right", render: (v: number) => `${v} ชิ้น` },
                  { title: "รายได้", dataIndex: "revenue", key: "rev", width: 120, align: "right", render: (v: number) => baht(v) },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card title="ลูกค้ายอดสูง" loading={loading} style={{ borderRadius: 10 }} className={styles.compactCard}>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={d?.topCustomers || []}
                locale={{ emptyText: "ยังไม่มีลูกค้า" }}
                columns={[
                  {
                    title: "ลูกค้า",
                    dataIndex: "name",
                    key: "name",
                    render: (n: string, r: any) => (
                      <Space wrap>{n}{(r.tags || []).map((t: string) => <Tag key={t} color={TAG_COLOR[t] || "default"}>{t}</Tag>)}</Space>
                    ),
                  },
                  { title: "ออเดอร์", dataIndex: "orders", key: "o", width: 90, align: "right" },
                  { title: "ยอดซื้อ", dataIndex: "spent", key: "s", width: 120, align: "right", render: (v: number) => baht(v) },
                ]}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
          <Col xs={24} lg={10}>
            <Card
              title="AI health (7 วันล่าสุด)"
              style={{ borderRadius: 10 }}
              className={styles.compactCard}
              extra={<Link href="/admin/ai-quality">เปิด AI Quality</Link>}
            >
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {(aiOverLimit || aiNearLimit) && (
                  <Alert
                    type={aiOverLimit ? "error" : "warning"}
                    showIcon
                    style={{ padding: "6px 10px", borderRadius: 8, fontSize: 11.5, marginBottom: 4 }}
                    message={
                      aiOverLimit
                        ? <>เกินโควตาฟรีเดือนนี้แล้ว <Tag>แพ็กเกจ {aiUsage.planName}</Tag> — ตอบด้วย template แทน AI ชั่วคราว</>
                        : <>ใกล้เต็มโควตาฟรี <Tag>แพ็กเกจ {aiUsage.planName}</Tag> เหลือ <b>{aiUsage.remaining}</b>/{aiUsage.limit} ครั้ง</>
                    }
                    description={<Link href="/admin/settings" style={{ fontSize: 11 }}>ใส่ AI Key ของร้านเองเพื่อไม่จำกัด</Link>}
                  />
                )}
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Tool calls ทั้งหมด</Text>
                  <Text strong style={{ fontSize: 12 }}>{Number(aiFailure?.totalToolCalls ?? 0).toLocaleString()}</Text>
                </Space>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Error / denied</Text>
                  <Text strong style={{ fontSize: 12 }}>{Number(aiFailure?.errorCalls ?? 0).toLocaleString()} ({aiFailureRate}%)</Text>
                </Space>
                <Space style={{ width: "100%", justifyContent: "space-between" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Force handoff</Text>
                  <Text strong style={{ fontSize: 12 }}>{Number(aiFailure?.handoffCount ?? 0).toLocaleString()}</Text>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card title="AI tools ที่พลาดบ่อย" style={{ borderRadius: 10 }} className={styles.compactCard}>
              <Table
                rowKey="tool"
                size="small"
                pagination={false}
                dataSource={aiFailure?.topFailingTools || []}
                locale={{ emptyText: "ยังไม่พบ error/denied ในช่วง 7 วันล่าสุด" }}
                columns={[
                  { title: "Tool", dataIndex: "tool", key: "tool" },
                  { title: "Outcome", dataIndex: "outcome", key: "outcome", width: 120, render: (v: string) => <Tag color={v === "denied" ? "gold" : "red"}>{v}</Tag> },
                  { title: "ครั้ง", dataIndex: "count", key: "count", width: 100, align: "right" },
                ]}
              />
            </Card>
          </Col>
        </Row>

        {d?.couponSummary && (
          <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
            <Col xs={24}>
              <Card
                title="โค้ดส่วนลด (เดือนนี้)"
                loading={loading}
                style={{ borderRadius: 10 }}
                className={styles.compactCard}
                extra={<Link href="/admin/coupons"><Button size="small">จัดการโค้ด</Button></Link>}
              >
                <Space size="large" wrap style={{ marginBottom: 8 }}>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>ส่วนลดที่แจกไปแล้ว</Text>
                    <Text strong style={{ fontSize: 15 }}>{baht(d.couponSummary.discountThisMonth)}</Text>
                  </Space>
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 11 }}>จำนวนครั้งที่ใช้โค้ด</Text>
                    <Text strong style={{ fontSize: 15 }}>{Number(d.couponSummary.redemptionsThisMonth).toLocaleString()}</Text>
                  </Space>
                </Space>
                <Table
                  rowKey="code"
                  size="small"
                  pagination={false}
                  dataSource={d.couponSummary.topCoupons || []}
                  locale={{ emptyText: "ยังไม่มีการใช้โค้ดส่วนลดเดือนนี้" }}
                  expandable={{
                    rowExpandable: (r: any) => (r.usages || []).length > 0,
                    expandedRowRender: (r: any) => (
                      <Table
                        rowKey="orderId"
                        size="small"
                        pagination={false}
                        dataSource={r.usages || []}
                        locale={{ emptyText: "ยังไม่มีรายการใช้โค้ดนี้" }}
                        columns={[
                          {
                            title: "เวลาใช้",
                            dataIndex: "createdAt",
                            key: "createdAt",
                            width: 150,
                            render: (v: string) => new Date(v).toLocaleString("th-TH", {
                              timeZone: "Asia/Bangkok",
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          },
                          {
                            title: "ลูกค้า",
                            key: "customer",
                            render: (_: any, u: any) => (
                              <Space direction="vertical" size={0}>
                                <Text>{u.customerName || "—"}</Text>
                                {u.customerId && <Text type="secondary" style={{ fontSize: 12 }}>{u.customerId}</Text>}
                              </Space>
                            ),
                          },
                          { title: "ช่องทาง", dataIndex: "channel", key: "channel", width: 100, render: (c: string) => <Tag>{c}</Tag> },
                          {
                            title: "ออเดอร์",
                            dataIndex: "orderId",
                            key: "orderId",
                            width: 120,
                            render: (id: string) => <Link href={`/admin/orders?highlight=${id}`}>#{String(id).slice(0, 8)}</Link>,
                          },
                          {
                            title: "ยอดสินค้า",
                            key: "subtotal",
                            width: 120,
                            align: "right" as const,
                            render: (_: any, u: any) => baht(Number(u.totalAmount || 0) + Number(u.discountAmount || 0)),
                          },
                          { title: "ส่วนลด", dataIndex: "discountAmount", key: "discountAmount", width: 120, align: "right" as const, render: (v: number) => <Text type="danger">-{baht(v)}</Text> },
                          { title: "ยอดสุทธิ", dataIndex: "totalAmount", key: "totalAmount", width: 120, align: "right" as const, render: (v: number) => baht(v) },
                          { title: "สถานะ", dataIndex: "status", key: "status", width: 120, render: (s: string) => <Tag color={STATUS_COLOR[s] || "default"}>{s}</Tag> },
                        ]}
                      />
                    ),
                  }}
                  columns={[
                    { title: "โค้ด", dataIndex: "code", key: "code" },
                    { title: "ใช้ไปแล้ว", dataIndex: "redemptions", key: "redemptions", width: 100, align: "right" },
                    { title: "ส่วนลดรวม", dataIndex: "discount", key: "discount", width: 130, align: "right", render: (v: number) => baht(v) },
                    {
                      title: "ล่าสุด",
                      key: "latest",
                      render: (_: any, r: any) => {
                        const latest = r.usages?.[0];
                        return latest ? (
                          <Space wrap>
                            <Text>{latest.customerName || "—"}</Text>
                            <Link href={`/admin/orders?highlight=${latest.orderId}`}>#{String(latest.orderId).slice(0, 8)}</Link>
                          </Space>
                        ) : <Text type="secondary">—</Text>;
                      },
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        )}
      </div>
    </div>
  );
}
