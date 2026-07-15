'use client';
import { gql, useQuery } from "@apollo/client";
import { Card, Statistic, Row, Col, Table, Tag, Space, Button, Alert, Typography } from "antd";
import {
  DollarOutlined, ShoppingCartOutlined, TeamOutlined, WarningOutlined, ReloadOutlined,
} from "@ant-design/icons";
import Link from "next/link";

const { Text } = Typography;

const Q_DASH = gql`
  query {
    bmsDashboard {
      revenueTotal revenueToday orderCount lowStockCount customerCount
      ordersByStatus { status count }
      topProducts { sku name qty revenue }
      topCustomers { id name tags spent orders }
      salesDaily { day revenue orders }
    }
  }
`;

const Q_CHANNEL_HEALTH = gql`query { bmsChannelHealth { channel active status } }`;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const TAG_COLOR: Record<string, string> = { VIP: "gold", "ลูกค้าใหม่": "blue", "ลูกค้าประจำ": "green" };

const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE Official Account", tiktok: "TikTok", facebook: "Facebook Messenger",
  instagram: "Instagram DM", web: "Website Live Chat", shopee: "Shopee (beta)", lazada: "Lazada (beta)",
};
const HEALTH_TEXT: Record<string, string> = {
  token_expired: "Token หมดอายุ/ถูก revoke",
  webhook_failed: "Webhook verify ไม่ผ่าน",
  rate_limited: "โดน Rate Limit",
  no_events: "ไม่มีข้อความเข้านานผิดปกติ",
  send_failed: "รับข้อความได้ แต่ตอบกลับไม่ได้",
};

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q_DASH, { fetchPolicy: "cache-and-network" });
  const d = data?.bmsDashboard;
  const { data: healthData } = useQuery(Q_CHANNEL_HEALTH, { fetchPolicy: "cache-and-network", pollInterval: 30000 });
  const unhealthyChannels = (healthData?.bmsChannelHealth || []).filter((h: any) => h.active && h.status !== "connected");

  if (error) return <Alert type="error" message="โหลด dashboard ไม่ได้" description={error.message} showIcon />;

  const maxRev = Math.max(1, ...(d?.salesDaily || []).map((x: any) => x.revenue));

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      {/* KPI cards */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card><Statistic title="ยอดขายรวม (จ่ายแล้ว)" value={d?.revenueTotal ?? 0} precision={0} suffix="฿" prefix={<DollarOutlined />} valueStyle={{ color: "#389e0d" }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="ยอดขายวันนี้" value={d?.revenueToday ?? 0} precision={0} suffix="฿" prefix={<DollarOutlined />} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="ออเดอร์ทั้งหมด" value={d?.orderCount ?? 0} prefix={<ShoppingCartOutlined />} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="ลูกค้า" value={d?.customerCount ?? 0} prefix={<TeamOutlined />} /></Card>
        </Col>
      </Row>

      {d?.lowStockCount > 0 && (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon icon={<WarningOutlined />}
          message={<>สินค้าใกล้หมด/หมด <b>{d.lowStockCount}</b> รายการ — <Link href="/admin/products">ดูที่หน้า Products →</Link></>} />
      )}

      {unhealthyChannels.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
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
              <Link href="/admin/settings">ไปที่ Settings — เชื่อมช่องทาง →</Link>
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* 7-day sales bar */}
        <Col xs={24} md={14}>
          <Card title="ยอดขาย 7 วันล่าสุด" loading={loading}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 180, paddingTop: 8 }}>
              {(d?.salesDaily || []).map((x: any) => (
                <div key={x.day} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
                    {x.revenue > 0 ? `${(x.revenue / 1000).toFixed(1)}k` : ""}
                  </div>
                  <div
                    title={`${x.revenue.toLocaleString()} ฿ · ${x.orders} ออเดอร์`}
                    style={{
                      height: `${Math.round((x.revenue / maxRev) * 130)}px`,
                      minHeight: x.revenue > 0 ? 4 : 0,
                      background: "linear-gradient(180deg,#69b1ff,#1677ff)",
                      borderRadius: "4px 4px 0 0",
                    }}
                  />
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{x.day.slice(5)}</div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* orders by status */}
        <Col xs={24} md={10}>
          <Card title="ออเดอร์ตามสถานะ" loading={loading}>
            <Space wrap size={[8, 12]}>
              {(d?.ordersByStatus || []).length === 0 && <Text type="secondary">ยังไม่มีออเดอร์</Text>}
              {(d?.ordersByStatus || []).map((s: any) => (
                <Tag key={s.status} color={STATUS_COLOR[s.status] || "default"} style={{ fontSize: 14, padding: "4px 10px" }}>
                  {s.status}: <b>{s.count}</b>
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="🏆 สินค้าขายดี (Top 5)" loading={loading}>
            <Table rowKey="sku" size="small" pagination={false}
              dataSource={d?.topProducts || []}
              locale={{ emptyText: "ยังไม่มียอดขาย" }}
              columns={[
                { title: "สินค้า", dataIndex: "name", key: "name" },
                { title: "ขายได้", dataIndex: "qty", key: "qty", width: 90, align: "right", render: (v: number) => `${v} ชิ้น` },
                { title: "รายได้", dataIndex: "revenue", key: "rev", width: 120, align: "right", render: (v: number) => `${v.toLocaleString()} ฿` },
              ]} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="⭐ ลูกค้ายอดสูง (Top 5)" loading={loading}>
            <Table rowKey="id" size="small" pagination={false}
              dataSource={d?.topCustomers || []}
              locale={{ emptyText: "ยังไม่มีลูกค้า" }}
              columns={[
                { title: "ลูกค้า", dataIndex: "name", key: "name",
                  render: (n: string, r: any) => (
                    <Space>{n}{(r.tags || []).map((t: string) => <Tag key={t} color={TAG_COLOR[t] || "default"}>{t}</Tag>)}</Space>
                  ) },
                { title: "ออเดอร์", dataIndex: "orders", key: "o", width: 90, align: "right" },
                { title: "ยอดซื้อ", dataIndex: "spent", key: "s", width: 120, align: "right", render: (v: number) => `${v.toLocaleString()} ฿` },
              ]} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
