'use client';
import { gql, useQuery, useLazyQuery } from "@apollo/client";
import { Table, Tag, Space, Alert, Button, Drawer, List, Typography, Empty } from "antd";
import { ReloadOutlined, HistoryOutlined, MailOutlined, SlackOutlined, LineOutlined } from "@ant-design/icons";
import { useState } from "react";

const { Text } = Typography;

const Q = gql`
  query {
    bmsIsPlatformAdmin
    bmsReportSubscriptions {
      tenantId tenantName tenantSlug
      frequency sendHour sendWeekday sendDayOfMonth
      emailEnabled recipientEmail
      slackEnabled hasSlackWebhook
      lineEnabled lineUserId
      enabled lastSentAt lastStatus lastPeriodKey
    }
  }
`;
const Q_HISTORY = gql`
  query ($tenantId: ID!) {
    bmsReportDeliveriesForTenant(tenantId: $tenantId, limit: 30) {
      id frequency channel status error createdAt
    }
  }
`;

const FREQ_LABEL: Record<string, string> = { DAILY: "รายวัน", WEEKLY: "รายสัปดาห์", MONTHLY: "รายเดือน" };
const WEEKDAY_LABEL: Record<number, string> = { 0: "อาทิตย์", 1: "จันทร์", 2: "อังคาร", 3: "พุธ", 4: "พฤหัสบดี", 5: "ศุกร์", 6: "เสาร์" };
const STATUS_COLOR: Record<string, string> = { SUCCESS: "green", PARTIAL: "orange", FAILED: "red" };
const CHANNEL_LABEL: Record<string, string> = { EMAIL: "อีเมล", SLACK: "Slack", LINE: "LINE" };

function scheduleDetail(r: any) {
  const hour = `${String(r.sendHour).padStart(2, "0")}:00 น.`;
  if (r.frequency === "WEEKLY") return `ทุกวัน${WEEKDAY_LABEL[r.sendWeekday] ?? "-"} ${hour}`;
  if (r.frequency === "MONTHLY") return `วันที่ ${r.sendDayOfMonth ?? "-"} ของเดือน ${hour}`;
  return `ทุกวัน ${hour}`;
}

export default function ReportSchedulePage() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [openTenant, setOpenTenant] = useState<{ id: string; name: string } | null>(null);
  const [loadHistory, { data: histData, loading: histLoading }] = useLazyQuery(Q_HISTORY);

  if (error) return <Alert type="error" showIcon message="โหลดข้อมูลไม่ได้" description={error.message} />;
  if (data && data.bmsIsPlatformAdmin === false) {
    return <Alert type="warning" showIcon message="เฉพาะแอดมินแพลตฟอร์ม" description="บัญชีนี้ไม่มีสิทธิ์ดูตารางส่งรายงานของทุกร้าน" />;
  }

  const rows = data?.bmsReportSubscriptions || [];

  const columns = [
    {
      title: "ร้าน", dataIndex: "tenantName", key: "tenantName",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{r.tenantName}</span>
          <span style={{ color: "var(--app-muted, #888)", fontSize: 12 }}>/{r.tenantSlug}</span>
        </Space>
      ),
    },
    {
      title: "สถานะ", dataIndex: "enabled", key: "enabled", width: 100,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "เปิดใช้งาน" : "ปิดอยู่"}</Tag>,
    },
    {
      title: "ตารางส่ง", key: "schedule", width: 220,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Tag>{FREQ_LABEL[r.frequency] || r.frequency}</Tag>
          <span style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>{scheduleDetail(r)}</span>
        </Space>
      ),
    },
    {
      title: "ช่องทาง", key: "channels", width: 200,
      render: (_: any, r: any) => (
        <Space wrap size={4}>
          {r.emailEnabled && <Tag icon={<MailOutlined />} color="blue">{r.recipientEmail || "อีเมล"}</Tag>}
          {r.slackEnabled && <Tag icon={<SlackOutlined />} color="purple">Slack</Tag>}
          {r.lineEnabled && <Tag icon={<LineOutlined />} color="green">LINE</Tag>}
          {!r.emailEnabled && !r.slackEnabled && !r.lineEnabled && <Tag>ยังไม่ได้ตั้งค่า</Tag>}
        </Space>
      ),
    },
    {
      title: "ส่งล่าสุด", key: "lastSent", width: 200,
      render: (_: any, r: any) => (
        r.lastSentAt ? (
          <Space direction="vertical" size={0}>
            <span style={{ fontSize: 12.5 }}>{new Date(r.lastSentAt).toLocaleString("th-TH")}</span>
            <Tag color={STATUS_COLOR[r.lastStatus] || "default"} style={{ width: "fit-content" }}>{r.lastStatus}</Tag>
          </Space>
        ) : <Text type="secondary" style={{ fontSize: 12.5 }}>ยังไม่เคยส่ง</Text>
      ),
    },
    {
      title: "", key: "act", width: 110, fixed: "right" as const,
      render: (_: any, r: any) => (
        <Button
          size="small" icon={<HistoryOutlined />}
          onClick={() => { setOpenTenant({ id: r.tenantId, name: r.tenantName }); loadHistory({ variables: { tenantId: r.tenantId } }); }}
        >
          ประวัติ
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><MailOutlined /> ตารางส่งรายงานยอดขาย</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message="มุมมองแอดมินแพลตฟอร์ม — เช็คได้ว่าร้านไหนตั้งค่าส่งสรุปยอดขายไว้เมื่อไหร่ ผ่านช่องทางไหนบ้าง และส่งสำเร็จล่าสุดเมื่อไหร่"
      />

      <Table
        rowKey="tenantId" size="middle" loading={loading}
        dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 1000 }}
      />

      <Drawer
        title={`ประวัติการส่ง — ${openTenant?.name || ""}`}
        open={!!openTenant} onClose={() => setOpenTenant(null)} width={420}
      >
        {histLoading ? (
          <Text type="secondary">กำลังโหลด...</Text>
        ) : (histData?.bmsReportDeliveriesForTenant?.length ? (
          <List
            dataSource={histData.bmsReportDeliveriesForTenant}
            renderItem={(d: any) => (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: "100%" }}>
                  <Space>
                    <Tag color={STATUS_COLOR[d.status] || "default"}>{d.status}</Tag>
                    <Text strong>{CHANNEL_LABEL[d.channel] || d.channel}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{FREQ_LABEL[d.frequency] || d.frequency}</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString("th-TH")}</Text>
                  {d.error && <Text type="danger" style={{ fontSize: 12 }}>{d.error}</Text>}
                </Space>
              </List.Item>
            )}
          />
        ) : <Empty description="ยังไม่มีประวัติการส่ง" />)}
      </Drawer>
    </div>
  );
}
