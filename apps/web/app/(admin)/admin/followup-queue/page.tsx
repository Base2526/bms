'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Table, Tag, Button, Space, Alert, message, Typography, Tabs } from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
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
  const { t } = useI18n();
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
      message.success(t("admin_followup_queue.run_result", {
        scanned: r?.scanned ?? 0, sent: r?.sent ?? 0, skipped: r?.skipped ?? 0, failed: r?.failed ?? 0,
      }));
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_followup_queue.run_error")),
  });

  if (!permsLoading && !can("followup.view")) {
    return <Alert type="warning" showIcon message={t("admin_followup_queue.no_permission")} />;
  }
  if (error) return <Alert type="error" showIcon message={t("admin_followup_queue.load_error")} description={error.message} />;

  const jobs = data?.bmsFollowupQueue || [];
  const history = data?.bmsFollowupHistory || [];

  const conversationLink = (id: string) => (
    <Link href={`/admin/inbox?c=${id}`} target="_blank">{id.slice(0, 8)}</Link>
  );

  const jobColumns = [
    { title: t("admin_followup_queue.col_conversation"), dataIndex: "conversationId", key: "conversationId", render: conversationLink },
    { title: t("admin_followup_queue.col_intent"), dataIndex: "intent", key: "intent" },
    { title: t("admin_followup_queue.col_goal"), dataIndex: "messageGoal", key: "messageGoal" },
    {
      title: t("admin_followup_queue.col_status"), dataIndex: "status", key: "status",
      render: (v: string) => <Tag color={JOB_STATUS_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: t("admin_followup_queue.col_next_run"), dataIndex: "nextRunAt", key: "nextRunAt", render: (v: string) => new Date(v).toLocaleString() },
    { title: t("admin_followup_queue.col_retry_count"), dataIndex: "retryCount", key: "retryCount", align: "right" as const },
    { title: t("admin_followup_queue.col_last_result"), dataIndex: "lastResult", key: "lastResult", render: (v: string | null) => v || "—" },
  ];

  const historyColumns = [
    { title: t("admin_followup_queue.col_conversation"), dataIndex: "conversationId", key: "conversationId", render: conversationLink },
    {
      title: t("admin_followup_queue.col_outcome"), dataIndex: "outcome", key: "outcome",
      render: (v: string) => <Tag color={HISTORY_OUTCOME_COLOR[v] || "default"}>{v}</Tag>,
    },
    { title: t("admin_followup_queue.col_goal"), dataIndex: "goal", key: "goal" },
    { title: t("admin_followup_queue.col_reason"), dataIndex: "reason", key: "reason", render: (v: string | null) => v || "—" },
    {
      title: t("admin_followup_queue.col_message_body"), dataIndex: "messageBody", key: "messageBody",
      render: (v: string | null) => v ? <Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: v }}>{v}</Text> : "—",
    },
    { title: t("admin_followup_queue.col_created_at"), dataIndex: "createdAt", key: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_followup_queue.title")}</Typography.Title>}>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>{t("admin_followup_queue.refresh")}</Button>
          {canManage && (
            <Button type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={() => runNow()}>
              {t("admin_followup_queue.run_now")}
            </Button>
          )}
        </Space>
      </AdminPageHeader>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t("admin_followup_queue.schedule_notice")}
      />
      <Tabs
        items={[
          {
            key: "queue",
            label: t("admin_followup_queue.tab_queue", { count: jobs.length }),
            children: <Table rowKey="id" loading={loading} dataSource={jobs} columns={jobColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          },
          {
            key: "history",
            label: t("admin_followup_queue.tab_history", { count: history.length }),
            children: <Table rowKey="id" loading={loading} dataSource={history} columns={historyColumns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />,
          },
        ]}
      />
    </div>
  );
}
