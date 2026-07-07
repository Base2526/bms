'use client';
import { gql, useQuery } from "@apollo/client";
import { Table, Tag, Typography, Alert, Button, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

const Q = gql`
  query { bmsAuditLog(limit: 200) { id actor action target meta created_at } }
`;

const ACTION_COLOR: Record<string, string> = {
  "order.pay": "blue", "order.pack": "cyan", "order.ship": "geekblue",
  "order.complete": "green", "order.cancel": "default", "order.return": "red",
  "product.upsert": "orange", "product.active": "gold", "stock.adjust": "volcano",
  "channel.upsert": "purple", "plan.change": "magenta", "rbac.set": "red",
};

export default function Page() {
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  if (error) return <Alert type="error" message="โหลด audit log ไม่ได้" description={error.message} showIcon />;

  const rows = data?.bmsAuditLog || [];
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Audit Log</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
        </Space>
      </div>
      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="บันทึกการกระทำของผู้ดูแล (เฉพาะร้านนี้) — ใครทำอะไร เมื่อไร · เฉพาะ Administrator ดูได้" />
      <Table
        rowKey="id" loading={loading} dataSource={rows}
        columns={[
          { title: "เวลา", dataIndex: "created_at", width: 170, render: (d: string) => new Date(d).toLocaleString() },
          { title: "ผู้ทำ", dataIndex: "actor", width: 200 },
          { title: "การกระทำ", dataIndex: "action", width: 150, render: (a: string) => <Tag color={ACTION_COLOR[a] || "default"}>{a}</Tag> },
          { title: "เป้าหมาย", dataIndex: "target", width: 160, render: (t: string) => t ? <Text code>{t.length > 12 ? t.slice(0,8) : t}</Text> : "—" },
          { title: "รายละเอียด", dataIndex: "meta", render: (m: any) => m && Object.keys(m).length ? <Text type="secondary" style={{ fontSize: 12 }}>{JSON.stringify(m)}</Text> : "—" },
        ]}
        pagination={{ pageSize: 25, showTotal: (t) => `Total ${t} entries` }}
      />
    </div>
  );
}
