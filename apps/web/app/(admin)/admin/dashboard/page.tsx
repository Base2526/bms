'use client';
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from "antd";
import {
  CheckCircleOutlined,
  CreditCardOutlined,
  DollarOutlined,
  InboxOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  TruckOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Link from "next/link";

const { Text, Title } = Typography;

const Q_DASH = gql`
  query {
    bmsDashboard {
      revenueTotal revenueToday orderCount lowStockCount customerCount
      ordersByStatus { status count }
      topProducts { sku name qty revenue }
      topCustomers { id name tags spent orders }
      salesDaily { day revenue orders }
      couponSummary { discountThisMonth redemptionsThisMonth topCoupons { code redemptions discount } }
    }
  }
`;

const Q_CHANNEL_HEALTH = gql`query { bmsChannelHealth { channel active status } }`;
const Q_AI = gql`query { bmsAiConfig { has_key } bmsAiUsage { count limit remaining unlimited planName } }`;
const Q_ALERTS = gql`
  query { bmsOperationalAlerts { packingOverdueCount slipPendingCount reservationExpiringCount chatWaitingCount } }
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

const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE Official Account",
  tiktok: "TikTok",
  facebook: "Facebook Messenger",
  instagram: "Instagram DM",
  web: "Website Live Chat",
  shopee: "Shopee (beta)",
  lazada: "Lazada (beta)",
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

function KpiCard({
  title,
  value,
  hint,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  tone?: "green" | "blue" | "orange" | "red";
}) {
  const color =
    tone === "green" ? "#389e0d" :
    tone === "blue" ? "#1677ff" :
    tone === "orange" ? "#d48806" :
    tone === "red" ? "#cf1322" :
    undefined;

  return (
    <Card style={{ height: "100%", borderRadius: 8 }} bodyStyle={{ padding: 18 }}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Space style={{ justifyContent: "space-between", width: "100%" }} align="start">
          <Text type="secondary">{title}</Text>
          <span style={{ color, fontSize: 22 }}>{icon}</span>
        </Space>
        <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, color }}>{value}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>
      </Space>
    </Card>
  );
}

function ActionCard({
  title,
  value,
  hint,
  href,
  icon,
  danger,
}: {
  title: string;
  value: string;
  hint: string;
  href: string;
  icon: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Card style={{ height: "100%", borderRadius: 8 }} bodyStyle={{ padding: 16 }}>
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <Space style={{ justifyContent: "space-between", width: "100%" }} align="start">
          <Text strong>{title}</Text>
          <span style={{ color: danger ? "#cf1322" : "#1677ff", fontSize: 20 }}>{icon}</span>
        </Space>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>
        <Link href={href}>
          <Button block type={danger ? "primary" : "default"} danger={danger}>
            เปิดหน้า
          </Button>
        </Link>
      </Space>
    </Card>
  );
}

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q_DASH, { fetchPolicy: "cache-and-network" });
  const d = data?.bmsDashboard;
  const { data: healthData } = useQuery(Q_CHANNEL_HEALTH, { fetchPolicy: "cache-and-network", pollInterval: 30000 });
  const unhealthyChannels = (healthData?.bmsChannelHealth || []).filter((h: any) => h.active && h.status !== "connected");
  const { data: aiData } = useQuery(Q_AI, { fetchPolicy: "cache-and-network" });
  const aiUsage = aiData?.bmsAiUsage;
  const aiHasKey = aiData?.bmsAiConfig?.has_key;
  const aiOverLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.remaining === 0;
  const aiNearLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.limit > 0 && aiUsage.remaining > 0 && aiUsage.remaining <= aiUsage.limit * 0.2;
  const { data: alertsData } = useQuery(Q_ALERTS, { fetchPolicy: "cache-and-network", pollInterval: 60000 });
  const alerts = alertsData?.bmsOperationalAlerts;

  if (error) return <Alert type="error" message="โหลด dashboard ไม่ได้" description={error.message} showIcon />;

  const ordersByStatus = d?.ordersByStatus || [];
  const pending = countOf(ordersByStatus, "PENDING");
  const paid = countOf(ordersByStatus, "PAID");
  const packing = countOf(ordersByStatus, "PACKING");
  const shipped = countOf(ordersByStatus, "SHIPPED");
  const completed = countOf(ordersByStatus, "COMPLETED");
  const returned = countOf(ordersByStatus, "RETURNED");
  const cancelled = countOf(ordersByStatus, "CANCELLED");
  const actionCount = pending + paid + packing + unhealthyChannels.length;
  const maxRev = Math.max(1, ...(d?.salesDaily || []).map((x: any) => x.revenue));

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">ภาพรวมวันนี้และงานที่ควรจัดการก่อน</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </Space>

      {unhealthyChannels.length > 0 && (
        <Alert
          style={{ marginBottom: 16, borderRadius: 8 }}
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={<>ช่องทางเชื่อมต่อผิดปกติ <b>{unhealthyChannels.length}</b> ช่องทาง</>}
          description={
            <Space direction="vertical" size={2}>
              {unhealthyChannels.map((h: any) => (
                <div key={h.channel}>
                  <Tag color="red">{CHANNEL_LABEL[h.channel] || h.channel}</Tag> {HEALTH_TEXT[h.status] || h.status}
                </div>
              ))}
              <Link href="/admin/settings">ไปที่ Settings</Link>
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="ยอดขายวันนี้"
            value={baht(d?.revenueToday)}
            hint={`ยอดขายรวม ${baht(d?.revenueTotal)}`}
            icon={<DollarOutlined />}
            tone="green"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="งานที่ต้องดู"
            value={`${actionCount} งาน`}
            hint={`รอชำระ ${pending} · พร้อมส่ง ${packing} · ช่องทาง ${unhealthyChannels.length}`}
            icon={<WarningOutlined />}
            tone={actionCount > 0 ? "orange" : "blue"}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="ออเดอร์ทั้งหมด"
            value={d?.orderCount ?? 0}
            hint={`สำเร็จ ${completed} · ส่งแล้ว ${shipped}`}
            icon={<ShoppingCartOutlined />}
            tone="blue"
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <KpiCard
            title="สต็อกต้องเติม"
            value={`${d?.lowStockCount ?? 0} รายการ`}
            hint={`${d?.customerCount ?? 0} ลูกค้าในระบบ`}
            icon={<InboxOutlined />}
            tone={(d?.lowStockCount ?? 0) > 0 ? "red" : "green"}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="งานด่วนวันนี้" loading={loading} style={{ borderRadius: 8 }}>
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12} xl={6}>
                <ActionCard title="รอชำระ" value={`${pending} ออเดอร์`} hint="ติดตามลูกค้าหรือบันทึกการชำระ" href="/admin/orders" icon={<ShoppingCartOutlined />} danger={pending > 0} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <ActionCard title="เริ่มแพ็ค" value={`${paid} ออเดอร์`} hint="ออเดอร์จ่ายแล้ว รอเข้าสู่ขั้นแพ็ค" href="/admin/orders" icon={<CheckCircleOutlined />} danger={paid > 0} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <ActionCard title="พร้อมส่ง" value={`${packing} ออเดอร์`} hint="สร้าง shipment และเลขพัสดุ" href="/admin/shipment" icon={<TruckOutlined />} danger={packing > 0} />
              </Col>
              <Col xs={24} sm={12} xl={6}>
                <ActionCard title="ช่องทาง" value={`${unhealthyChannels.length} ผิดปกติ`} hint="เช็ก token/webhook ที่ Settings" href="/admin/settings" icon={<SettingOutlined />} danger={unhealthyChannels.length > 0} />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="สถานะออเดอร์ที่ควรโฟกัส" loading={loading} style={{ borderRadius: 8, height: "100%" }}>
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {[
                ["PENDING", pending],
                ["PAID", paid],
                ["PACKING", packing],
                ["SHIPPED", shipped],
                ["COMPLETED", completed],
                ["RETURNED", returned],
                ["CANCELLED", cancelled],
              ].map(([status, count]) => (
                <Space key={status} style={{ width: "100%", justifyContent: "space-between" }}>
                  <Tag color={STATUS_COLOR[String(status)] || "default"}>{STATUS_LABEL[String(status)] || status}</Tag>
                  <Text strong>{Number(count).toLocaleString()}</Text>
                </Space>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      {(aiOverLimit || aiNearLimit) && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type={aiOverLimit ? "error" : "warning"}
          showIcon
          icon={<WarningOutlined />}
          message={
            aiOverLimit
              ? <>AI ตอบลูกค้าอัตโนมัติ เกินโควตาฟรีเดือนนี้แล้ว <Tag>แพ็กเกจ {aiUsage.planName}</Tag></>
              : <>AI ตอบลูกค้าอัตโนมัติ ใกล้เต็มโควตาฟรี <Tag>แพ็กเกจ {aiUsage.planName}</Tag> — เหลือ <b>{aiUsage.remaining}</b>/{aiUsage.limit} ครั้ง</>
          }
          description={
            <>
              {aiOverLimit && "ตอนนี้ระบบตอบด้วยข้อความ template แทน AI จนกว่าจะขึ้นเดือนใหม่ "}
              <Link href="/admin/settings">ใส่ AI Key ของร้านเองเพื่อไม่จำกัด</Link>
            </>
          }
        />
      )}

      {d?.lowStockCount > 0 && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<>สินค้าใกล้หมด/หมด <b>{d.lowStockCount}</b> รายการ</>}
          description={<Link href="/admin/products">เปิดหน้า Products เพื่อตรวจสต็อก</Link>}
        />
      )}

      {alerts?.packingOverdueCount > 0 && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<>ออเดอร์ค้างแพ็คนานเกิน 24 ชม. <b>{alerts.packingOverdueCount}</b> ออเดอร์</>}
          description={<Link href="/admin/orders?status=PACKING">เปิดหน้า Orders เพื่อจัดการ</Link>}
        />
      )}

      {alerts?.slipPendingCount > 0 && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<>สลิปโอนรอตรวจนานเกิน 2 ชม. <b>{alerts.slipPendingCount}</b> รายการ</>}
          description={<Link href="/admin/payment?status=PENDING">เปิดหน้า Payment เพื่อตรวจสลิป</Link>}
        />
      )}

      {alerts?.reservationExpiringCount > 0 && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<>การจองสต็อกใกล้หมดอายุ <b>{alerts.reservationExpiringCount}</b> ออเดอร์</>}
          description={<Link href="/admin/orders?status=PENDING">เปิดหน้า Orders เพื่อติดตามลูกค้า</Link>}
        />
      )}

      {alerts?.chatWaitingCount > 0 && (
        <Alert
          style={{ marginTop: 16, borderRadius: 8 }}
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={<>แชทลูกค้ารอตอบนานเกิน 30 นาที <b>{alerts.chatWaitingCount}</b> แชท</>}
          description={<Link href="/admin/inbox">เปิดหน้า Inbox เพื่อตอบลูกค้า</Link>}
        />
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="ยอดขาย 7 วันล่าสุด" loading={loading} style={{ borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 190, paddingTop: 8 }}>
              {(d?.salesDaily || []).map((x: any) => (
                <div key={x.day} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4, minHeight: 16 }}>
                    {x.revenue > 0 ? `${(x.revenue / 1000).toFixed(1)}k` : ""}
                  </div>
                  <div
                    title={`${x.revenue.toLocaleString()} ฿ · ${x.orders} ออเดอร์`}
                    style={{
                      height: `${Math.round((x.revenue / maxRev) * 140)}px`,
                      minHeight: x.revenue > 0 ? 6 : 2,
                      background: x.revenue > 0 ? "linear-gradient(180deg,#69b1ff,#1677ff)" : "#f0f0f0",
                      borderRadius: "6px 6px 0 0",
                    }}
                  />
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{x.day.slice(5)}</div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="สรุปธุรกิจ" loading={loading} style={{ borderRadius: 8, height: "100%" }}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Text type="secondary">ยอดขายรวม</Text>
                <Text strong>{baht(d?.revenueTotal)}</Text>
              </Space>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Text type="secondary">ลูกค้า</Text>
                <Text strong><TeamOutlined /> {Number(d?.customerCount ?? 0).toLocaleString()}</Text>
              </Space>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <Text type="secondary">สินค้าใกล้หมด</Text>
                <Text strong>{Number(d?.lowStockCount ?? 0).toLocaleString()}</Text>
              </Space>
              <Space wrap>
                <Link href="/admin/reports"><Button>Reports</Button></Link>
                <Link href="/admin/products"><Button>Products</Button></Link>
                <Link href="/admin/customers"><Button>Customers</Button></Link>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="สินค้าขายดี" loading={loading} style={{ borderRadius: 8 }}>
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
          <Card title="ลูกค้ายอดสูง" loading={loading} style={{ borderRadius: 8 }}>
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

      {d?.couponSummary && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <Card
              title="โค้ดส่วนลด (เดือนนี้)"
              loading={loading}
              style={{ borderRadius: 8 }}
              extra={<Link href="/admin/coupons"><Button size="small">จัดการโค้ด</Button></Link>}
            >
              <Space size="large" wrap style={{ marginBottom: 12 }}>
                <Space direction="vertical" size={0}>
                  <Text type="secondary">ส่วนลดที่แจกไปแล้ว</Text>
                  <Text strong style={{ fontSize: 18 }}>{baht(d.couponSummary.discountThisMonth)}</Text>
                </Space>
                <Space direction="vertical" size={0}>
                  <Text type="secondary">จำนวนครั้งที่ใช้โค้ด</Text>
                  <Text strong style={{ fontSize: 18 }}>{Number(d.couponSummary.redemptionsThisMonth).toLocaleString()}</Text>
                </Space>
              </Space>
              <Table
                rowKey="code"
                size="small"
                pagination={false}
                dataSource={d.couponSummary.topCoupons || []}
                locale={{ emptyText: "ยังไม่มีการใช้โค้ดส่วนลดเดือนนี้" }}
                columns={[
                  { title: "โค้ด", dataIndex: "code", key: "code" },
                  { title: "ใช้ไปแล้ว", dataIndex: "redemptions", key: "redemptions", width: 100, align: "right" },
                  { title: "ส่วนลดรวม", dataIndex: "discount", key: "discount", width: 130, align: "right", render: (v: number) => baht(v) },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
