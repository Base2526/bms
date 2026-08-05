'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Button, Space, Alert, message, Typography, Tabs } from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const Q = gql`
  query {
    bmsFollowupQueue(limit: 100) {
      id status nextRunAt retryCount lastResult conversationId ruleId intent messageGoal updatedAt
    }
    bmsFollowupHistory(limit: 100) {
      id conversationId ruleId outcome reason messageBody goal createdAt
    }
  }
`;
const M_RUN_NOW = gql`mutation { bmsRunFollowupsNow { scanned sent skipped failed } }`;

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", SENT: "green", STOPPED: "default", FAILED: "red",
};
const HISTORY_OUTCOME_COLOR: Record<string, string> = {
  SENT: "green", SKIPPED: "default", FAILED: "red",
};

export default function FollowupQueuePage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("followup.manage");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("followup.view"),
    fetchPolicy: "cache-and-network",
    pollInterval: 15000,
  });
  const [runNow, { loading: running }] = useMutation(M_RUN_NOW, {
    onCompleted: (d) => {
      const r = d?.bmsRunFollowupsNow;
      message.success(`สแกนแล้ว ${r?.scanned ?? 0} รายการ — ส่ง ${r?.sent ?? 0} · ข้าม ${r?.skipped ?? 0} · ล้มเหลว ${r?.failed ?? 0}`);
      refetch();
    },
    onError: (e) => message.error(e?.message || "รันไม่สำเร็จ"),
  });

  if (!permsLoading && !can("followup.view")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดคิว follow-up ไม่ได้" description={error.message} />;

  const jobs = data?.bmsFollowupQueue || [];
  const history = data?.bmsFollowupHistory || [];

  const conversationLink = (id: string) => (
    <Link href={`/admin/inbox?c=${id}`} target="_blank">{id.slice(0, 8)}</Link>
  );

  const jobColumns = [
    { title: "แชท", dataIndex: "conversationId", key: "conversationId", render: conversationLink },
    { title: "Intent", dataIndex: "intent", key: "intent" },
    { title: "เป้าหมาย", dataIndex: "messageGoal", key: "messageGoal" },
    {
      title: "สถานะ", dataIndex: "status", key: "status",
      render: (v: string) => <Tag color={JOB_STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: "รันครั้งถัดไป", dataIndex: "nextRunAt", key: "nextRunAt", render: (v: string) => new Date(v).toLocaleString() },
    { title: "ลองแล้ว", dataIndex: "retryCount", key: "retryCount", align: "right" as const },
    { title: "ผลล่าสุด", dataIndex: "lastResult", key: "lastResult", render: (v: string | null) => v || "—" },
  ];

  const historyColumns = [
    { title: "แชท", dataIndex: "conversationId", key: "conversationId", render: conversationLink },
    {
      title: "ผลลัพธ์", dataIndex: "outcome", key: "outcome",
      render: (v: string) => <Tag color={HISTORY_OUTCOME_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: "เป้าหมาย", dataIndex: "goal", key: "goal" },
    { title: "เหตุผล", dataIndex: "reason", key: "reason", render: (v: string | null) => v || "—" },
    {
      title: "ข้อความที่ส่ง", dataIndex: "messageBody", key: "messageBody",
      render: (v: string | null) => v ? <Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: v }}>{v}</Text> : "—",
    },
    { title: "เมื่อ", dataIndex: "createdAt", key: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>Follow-up Queue</Typography.Title>}>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>รีเฟรช</Button>
          {canManage && (
            <Button type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={() => runNow()}>
              รันตอนนี้
            </Button>
          )}
        </Space>
      </AdminPageHeader>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="รายการนี้อ่านจาก bms_followup_jobs/bms_followup_history — cron ยังไม่ได้ตั้ง schedule จริง ใช้ปุ่ม “รันตอนนี้” เพื่อทดสอบ"
      />
      <Tabs
        items={[
          {
            key: "queue",
            label: `กำลังรอ/ล่าสุด (${jobs.length})`,
            children: <Table rowKey="id" loading={loading} dataSource={jobs} columns={jobColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          },
          {
            key: "history",
            label: `ประวัติ (${history.length})`,
            children: <Table rowKey="id" loading={loading} dataSource={history} columns={historyColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          },
        ]}
      />
    </div>
  );
}
