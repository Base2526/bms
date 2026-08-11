'use client';
import { gql, useQuery, useLazyQuery } from "@apollo/client";
import { Table, Tag, Space, Alert, Button, Drawer, List, Typography, Empty } from "antd";
import { ReloadOutlined, HistoryOutlined, MailOutlined, SlackOutlined, LineOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";

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

const STATUS_COLOR: Record<string, string> = { SUCCESS: "green", PARTIAL: "orange", FAILED: "red" };

function freqLabels(t: (key: string) => string): Record<string, string> {
  return { DAILY: t("admin_report_schedule.freq_daily"), WEEKLY: t("admin_report_schedule.freq_weekly"), MONTHLY: t("admin_report_schedule.freq_monthly") };
}
function weekdayLabels(t: (key: string) => string): Record<number, string> {
  return {
    0: t("admin_report_schedule.weekday_0"), 1: t("admin_report_schedule.weekday_1"), 2: t("admin_report_schedule.weekday_2"),
    3: t("admin_report_schedule.weekday_3"), 4: t("admin_report_schedule.weekday_4"), 5: t("admin_report_schedule.weekday_5"),
    6: t("admin_report_schedule.weekday_6"),
  };
}
function channelLabels(t: (key: string) => string): Record<string, string> {
  return { EMAIL: t("admin_report_schedule.channel_email"), SLACK: t("admin_report_schedule.channel_slack"), LINE: t("admin_report_schedule.channel_line") };
}

function scheduleDetail(r: any, t: (key: string, vars?: Record<string, any>) => string, weekdayLabel: Record<number, string>) {
  const hour = t("admin_report_schedule.hour_suffix", { hour: String(r.sendHour).padStart(2, "0") });
  if (r.frequency === "WEEKLY") return t("admin_report_schedule.schedule_weekly", { weekday: weekdayLabel[r.sendWeekday] ?? "-", hour });
  if (r.frequency === "MONTHLY") return t("admin_report_schedule.schedule_monthly", { day: r.sendDayOfMonth ?? "-", hour });
  return t("admin_report_schedule.schedule_daily", { hour });
}

export default function ReportSchedulePage() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [openTenant, setOpenTenant] = useState<{ id: string; name: string } | null>(null);
  const [loadHistory, { data: histData, loading: histLoading }] = useLazyQuery(Q_HISTORY);

  const freqLabel = freqLabels(t);
  const weekdayLabel = weekdayLabels(t);
  const channelLabel = channelLabels(t);

  if (error) return <Alert type="error" showIcon message={t("admin_report_schedule.load_error")} description={error.message} />;
  if (data && data.bmsIsPlatformAdmin === false) {
    return <Alert type="warning" showIcon message={t("admin_report_schedule.platform_admin_only_title")} description={t("admin_report_schedule.platform_admin_only_desc")} />;
  }

  const rows = data?.bmsReportSubscriptions || [];

  const columns = [
    {
      title: t("admin_report_schedule.col_shop"), dataIndex: "tenantName", key: "tenantName",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{r.tenantName}</span>
          <span style={{ color: "var(--app-muted, #888)", fontSize: 12 }}>/{r.tenantSlug}</span>
        </Space>
      ),
    },
    {
      title: t("admin_report_schedule.col_status"), dataIndex: "enabled", key: "enabled", width: 100,
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? t("admin_report_schedule.status_enabled") : t("admin_report_schedule.status_disabled")}</Tag>,
    },
    {
      title: t("admin_report_schedule.col_schedule"), key: "schedule", width: 220,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Tag>{freqLabel[r.frequency] || r.frequency}</Tag>
          <span style={{ fontSize: 12, color: "var(--app-muted, #888)" }}>{scheduleDetail(r, t, weekdayLabel)}</span>
        </Space>
      ),
    },
    {
      title: t("admin_report_schedule.col_channels"), key: "channels", width: 200,
      render: (_: any, r: any) => (
        <Space wrap size={4}>
          {r.emailEnabled && <Tag icon={<MailOutlined />} color="blue">{r.recipientEmail || t("admin_report_schedule.email_fallback")}</Tag>}
          {r.slackEnabled && <Tag icon={<SlackOutlined />} color="purple">Slack</Tag>}
          {r.lineEnabled && <Tag icon={<LineOutlined />} color="green">LINE</Tag>}
          {!r.emailEnabled && !r.slackEnabled && !r.lineEnabled && <Tag>{t("admin_report_schedule.channels_unset")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("admin_report_schedule.col_last_sent"), key: "lastSent", width: 200,
      render: (_: any, r: any) => (
        r.lastSentAt ? (
          <Space direction="vertical" size={0}>
            <span style={{ fontSize: 12.5 }}>{new Date(r.lastSentAt).toLocaleString("th-TH")}</span>
            <Tag color={STATUS_COLOR[r.lastStatus] || "default"} style={{ width: "fit-content" }}>{r.lastStatus}</Tag>
          </Space>
        ) : <Text type="secondary" style={{ fontSize: 12.5 }}>{t("admin_report_schedule.never_sent")}</Text>
      ),
    },
    {
      title: "", key: "act", width: 110, fixed: "right" as const,
      render: (_: any, r: any) => (
        <Button
          size="small" icon={<HistoryOutlined />}
          onClick={() => { setOpenTenant({ id: r.tenantId, name: r.tenantName }); loadHistory({ variables: { tenantId: r.tenantId } }); }}
        >
          {t("admin_report_schedule.history")}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}><MailOutlined /> {t("admin_report_schedule.title")}</h2>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_report_schedule.refresh")}</Button>
        </Space>
      </div>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_report_schedule.platform_notice")}
      />

      <Table
        rowKey="tenantId" size="middle" loading={loading}
        dataSource={rows} columns={columns}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 1000 }}
      />

      <Drawer
        title={t("admin_report_schedule.history_title", { name: openTenant?.name || "" })}
        open={!!openTenant} onClose={() => setOpenTenant(null)} width={420}
      >
        {histLoading ? (
          <Text type="secondary">{t("admin_report_schedule.loading")}</Text>
        ) : (histData?.bmsReportDeliveriesForTenant?.length ? (
          <List
            dataSource={histData.bmsReportDeliveriesForTenant}
            renderItem={(d: any) => (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: "100%" }}>
                  <Space>
                    <Tag color={STATUS_COLOR[d.status] || "default"}>{d.status}</Tag>
                    <Text strong>{channelLabel[d.channel] || d.channel}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{freqLabel[d.frequency] || d.frequency}</Text>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleString("th-TH")}</Text>
                  {d.error && <Text type="danger" style={{ fontSize: 12 }}>{d.error}</Text>}
                </Space>
              </List.Item>
            )}
          />
        ) : <Empty description={t("admin_report_schedule.no_history")} />)}
      </Drawer>
    </div>
  );
}
