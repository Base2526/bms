'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Button, Space, Alert, message, Typography, Tabs, Row, Col, Card, Statistic, Progress } from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const Q = gql`
  query {
    bmsFollowupQueue(limit: 100) {
      id status nextRunAt retryCount lastResult conversationId ruleId intent messageGoal
      priority maxRetry businessHoursOnly customerName lastMessageAt idleMinutes
      customerLifetimeValue totalOrders score scoreLabel scoreReasons updatedAt
    }
    bmsFollowupHistory(limit: 100) {
      id conversationId ruleId outcome reason messageBody goal createdAt
    }
    bmsFollowupAnalytics(windowDays: 30) {
      windowDays activeJobs pendingJobs sentJobs stoppedJobs failedJobs
      totalHistory sentHistory skippedHistory failedHistory
      repliedAfterFollowup orderedAfterFollowup replyRate orderRate
      avgRetryCount avgIdleMinutesAtSend
      byGoal { key sent replied ordered failed skipped }
      byIntent { key sent replied ordered failed skipped }
      daily { day sent replied ordered failed skipped }
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
  const analytics = data?.bmsFollowupAnalytics;
  const topGoals = (analytics?.byGoal || []).slice(0, 4);
  const topIntents = (analytics?.byIntent || []).slice(0, 4);
  const latestDaily = (analytics?.daily || []).slice(-7);

  const conversationLink = (id: string) => (
    <Link href={`/admin/inbox?c=${id}`} target="_blank">{id.slice(0, 8)}</Link>
  );

  const scoreColor = (label: string) => {
    if (label === "HOT") return "red";
    if (label === "WARM") return "gold";
    return "default";
  };

  const jobColumns = [
    {
      title: "แชท", dataIndex: "conversationId", key: "conversationId",
      render: (_: string, row: any) => (
        <Space direction="vertical" size={0}>
          {conversationLink(row.conversationId)}
          <Text type="secondary">{row.customerName || "ไม่ทราบชื่อลูกค้า"}</Text>
        </Space>
      ),
    },
    { title: "Intent", dataIndex: "intent", key: "intent" },
    { title: "เป้าหมาย", dataIndex: "messageGoal", key: "messageGoal" },
    {
      title: "Score", dataIndex: "score", key: "score",
      render: (v: number, row: any) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Tag color={scoreColor(row.scoreLabel)}>{row.scoreLabel}</Tag>
            <Text strong>{v}</Text>
          </Space>
          <Text type="secondary" style={{ maxWidth: 240 }} ellipsis={{ tooltip: (row.scoreReasons || []).join(" · ") }}>
            {(row.scoreReasons || []).join(" · ") || "—"}
          </Text>
        </Space>
      ),
    },
    {
      title: "สถานะ", dataIndex: "status", key: "status",
      render: (v: string) => <Tag color={JOB_STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    {
      title: "เงียบมา", dataIndex: "idleMinutes", key: "idleMinutes",
      render: (v: number | null) => v == null ? "—" : `${v} นาที`,
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
      {analytics && (
        <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 16 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Pending jobs" value={analytics.pendingJobs} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Reply rate" value={analytics.replyRate * 100} suffix="%" precision={1} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Order-after-follow-up" value={analytics.orderRate * 100} suffix="%" precision={1} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Avg idle before send" value={analytics.avgIdleMinutesAtSend ?? 0} suffix="min" precision={0} /></Card>
            </Col>
          </Row>
          <Row gutter={[12, 12]}>
            <Col xs={24} lg={10}>
              <Card title={`สรุป ${analytics.windowDays} วันล่าสุด`}>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Text>ส่งแล้ว {analytics.sentHistory} · ข้าม {analytics.skippedHistory} · ล้มเหลว {analytics.failedHistory}</Text>
                  <Progress percent={Math.round((analytics.replyRate || 0) * 100)} status="active" format={(p) => `Reply ${p}%`} />
                  <Progress percent={Math.round((analytics.orderRate || 0) * 100)} strokeColor="#52c41a" format={(p) => `Order ${p}%`} />
                  <Text type="secondary">ลูกค้าตอบกลับหลัง follow-up: {analytics.repliedAfterFollowup} ครั้ง · มีออร์เดอร์ตามมา: {analytics.orderedAfterFollowup} ครั้ง</Text>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={7}>
              <Card title="Top goals">
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {topGoals.length ? topGoals.map((row: any) => (
                    <div key={row.key}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Text>{row.key}</Text>
                        <Text type="secondary">ส่ง {row.sent} · ตอบ {row.replied}</Text>
                      </Space>
                    </div>
                  )) : <Text type="secondary">ยังไม่มีข้อมูล</Text>}
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={7}>
              <Card title="Top intents">
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {topIntents.length ? topIntents.map((row: any) => (
                    <div key={row.key}>
                      <Space style={{ width: "100%", justifyContent: "space-between" }}>
                        <Text>{row.key}</Text>
                        <Text type="secondary">ส่ง {row.sent} · order {row.ordered}</Text>
                      </Space>
                    </div>
                  )) : <Text type="secondary">ยังไม่มีข้อมูล</Text>}
                </Space>
              </Card>
            </Col>
          </Row>
          {!!latestDaily.length && (
            <Card title="7 วันล่าสุด">
              <Table
                rowKey="day"
                size="small"
                pagination={false}
                dataSource={latestDaily}
                columns={[
                  { title: "วัน", dataIndex: "day", key: "day" },
                  { title: "ส่ง", dataIndex: "sent", key: "sent", align: "right" as const },
                  { title: "ตอบกลับ", dataIndex: "replied", key: "replied", align: "right" as const },
                  { title: "เกิดออร์เดอร์", dataIndex: "ordered", key: "ordered", align: "right" as const },
                  { title: "ล้มเหลว", dataIndex: "failed", key: "failed", align: "right" as const },
                ]}
              />
            </Card>
          )}
        </Space>
      )}
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
