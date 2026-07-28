'use client';
import { gql, useQuery } from "@apollo/client";
import { Card, Statistic, Row, Col, Table, Tag, Button, Alert, DatePicker, Typography } from "antd";
import { DollarOutlined, ShoppingCartOutlined, ReloadOutlined, InboxOutlined, WarningOutlined } from "@ant-design/icons";
import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { RangePicker } = DatePicker;

// ---- GraphQL ------------------------------------------------
const Q_REPORTS = gql`
  query ($from: String, $to: String) {
    bmsSalesSummary(from: $from, to: $to) {
      from to revenue orderCount avgOrderValue
      byDay { day revenue orders }
      byStatus { status count }
      byChannel { channel revenue orders }
    }
    bmsTopSellingProducts(from: $from, to: $to, limit: 10) { sku name qty revenue }
    bmsInventorySummary {
      skuCount variantCount totalUnits reservedUnits availableUnits stockValue lowStockCount outOfStockCount
    }
  }
`;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue",
  shopee: "orange", lazada: "purple", test: "default",
};
const baht = (v: number) => `${Number(v).toLocaleString()} ฿`;

export default function Page() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, "day"), dayjs()]);
  const from = range[0].format("YYYY-MM-DD");
  const to = range[1].format("YYYY-MM-DD");

  const { data, loading, error, refetch } = useQuery(Q_REPORTS, {
    variables: { from, to }, fetchPolicy: "cache-and-network",
  });

  if (error) return <Alert type="error" message="โหลดรายงานไม่ได้" description={error.message} showIcon />;

  const s = data?.bmsSalesSummary;
  const inv = data?.bmsInventorySummary;
  const top = data?.bmsTopSellingProducts || [];
  const maxRev = Math.max(1, ...(s?.byDay || []).map((x: any) => x.revenue));

  return (
    <div>
      <AdminPageHeader title="Reports">
        <RangePicker value={range} allowClear={false}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          presets={[
            { label: "7 วัน", value: [dayjs().subtract(6, "day"), dayjs()] },
            { label: "30 วัน", value: [dayjs().subtract(29, "day"), dayjs()] },
            { label: "เดือนนี้", value: [dayjs().startOf("month"), dayjs()] },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

      {/* ---- Sales KPIs ---- */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card><Statistic title={`ยอดขาย (${from} → ${to})`} value={s?.revenue ?? 0} precision={0} suffix="฿" prefix={<DollarOutlined />} valueStyle={{ color: "#389e0d" }} /></Card>
        </Col>
        <Col xs={12} sm={12} md={8}>
          <Card><Statistic title="จำนวนออเดอร์ (จ่ายแล้ว)" value={s?.orderCount ?? 0} prefix={<ShoppingCartOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={12} md={8}>
          <Card><Statistic title="ยอดเฉลี่ย/ออเดอร์" value={s?.avgOrderValue ?? 0} precision={0} suffix="฿" /></Card>
        </Col>
      </Row>

      {/* ---- Sales by day (mini bars) ---- */}
      <Card title="ยอดขายรายวัน" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140, overflowX: "auto" }}>
          {(s?.byDay || []).map((x: any) => (
            <div key={x.day} title={`${x.day}: ${baht(x.revenue)} (${x.orders} ออเดอร์)`}
              style={{ flex: "1 0 8px", minWidth: 8, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
              <div style={{ width: "100%", height: `${(x.revenue / maxRev) * 120}px`, background: "#52c41a", borderRadius: 2 }} />
            </div>
          ))}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>ชี้ที่แท่งเพื่อดูยอดรายวัน</Typography.Text>
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* ---- By channel ---- */}
        <Col xs={24} md={12}>
          <Card title="ยอดขายตามช่องทาง">
            <Table rowKey="channel" size="small" pagination={false} dataSource={s?.byChannel || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "ช่องทาง", dataIndex: "channel", render: (c: string) => <Tag color={CHANNEL_COLOR[c] || "default"}>{c}</Tag> },
                { title: "ออเดอร์", dataIndex: "orders", align: "right" as const },
                { title: "ยอดขาย", dataIndex: "revenue", align: "right" as const, render: baht },
              ]} />
          </Card>
        </Col>
        {/* ---- By status ---- */}
        <Col xs={24} md={12}>
          <Card title="ออเดอร์ตามสถานะ (ทุกสถานะในช่วง)">
            <Table rowKey="status" size="small" pagination={false} dataSource={s?.byStatus || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "สถานะ", dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag> },
                { title: "จำนวน", dataIndex: "count", align: "right" as const },
              ]} />
          </Card>
        </Col>
      </Row>

      {/* ---- Top selling ---- */}
      <Card title="สินค้าขายดี (ตามช่วงวันที่)" style={{ marginTop: 16 }}>
        <Table rowKey="sku" size="small" pagination={false} dataSource={top} loading={loading}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "SKU", dataIndex: "sku" },
            { title: "สินค้า", dataIndex: "name" },
            { title: "ขายได้ (ชิ้น)", dataIndex: "qty", align: "right" as const },
            { title: "ยอดขาย", dataIndex: "revenue", align: "right" as const, render: baht },
          ]} />
      </Card>

      {/* ---- Inventory summary ---- */}
      <Card title="สรุปสต็อก (ปัจจุบัน)" style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title="มูลค่าสต็อก" value={inv?.stockValue ?? 0} precision={0} suffix="฿" prefix={<InboxOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title="สินค้า (SKU)" value={inv?.skuCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title="คงเหลือรวม (ชิ้น)" value={inv?.totalUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title="พร้อมขาย (ชิ้น)" value={inv?.availableUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title="จองอยู่ (ชิ้น)" value={inv?.reservedUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title="ตัวเลือก (variant)" value={inv?.variantCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title="ใกล้หมด" value={inv?.lowStockCount ?? 0} valueStyle={{ color: "#d46b08" }} prefix={<WarningOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title="หมดสต็อก" value={inv?.outOfStockCount ?? 0} valueStyle={{ color: "#cf1322" }} /></Col>
        </Row>
      </Card>
    </div>
  );
}
