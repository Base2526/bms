"use client";

import { useUiText } from "@/lib/useUiText";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Card, Row, Col, Statistic, Table, Tag, Alert, Button, Typography, Space, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type {
  DbHealth,
  RedisHealth,
  RealtimeOutboxHealth,
  ChannelHealthOverview,
  FailureIncidentsOverview,
} from "@/lib/bms/systemHealth";
import type { AiProviderHealth } from "@/lib/bms/aiProviderHealth";
import type { JobRunRow } from "@/lib/bms/jobRuns";
import type { RequestMetricsSummary } from "@/lib/bms/requestMetrics";

const { Title, Text } = Typography;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const AI_STATUS_COLOR: Record<string, string> = {
  connected: "green",
  unconfigured: "default",
  stale: "gold",
  token_expired: "red",
  rate_limited: "orange",
  send_failed: "red",
};

const CHANNEL_STATUS_COLOR: Record<string, string> = {
  token_expired: "red",
  webhook_failed: "red",
  rate_limited: "orange",
  no_events: "gold",
  send_failed: "red",
};

const JOB_STATUS_COLOR: Record<string, string> = {
  success: "green",
  error: "red",
  running: "blue",
};

const TIER_COLOR: Record<string, string> = { A: "red", B: "orange" };

type Props = {
  generatedAt: string;
  db: DbHealth;
  redis: RedisHealth;
  realtimeOutbox: RealtimeOutboxHealth;
  aiProviders: AiProviderHealth[] | null;
  aiProvidersError: string | null;
  jobRuns: JobRunRow[] | null;
  jobRunsError: string | null;
  jobNameByKey: Record<string, string>;
  channelHealth: ChannelHealthOverview;
  failureIncidents: FailureIncidentsOverview;
  requestMetrics: RequestMetricsSummary;
  windowMinutes: number;
  windowOptions: number[];
};

export default function SystemHealthClient({
  generatedAt,
  db,
  redis,
  realtimeOutbox,
  aiProviders,
  aiProvidersError,
  jobRuns,
  jobRunsError,
  jobNameByKey,
  channelHealth,
  failureIncidents,
  requestMetrics,
  windowMinutes,
  windowOptions,
}: Props) {
  const uiText = useUiText();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const stuckJobRuns = (jobRuns ?? []).filter(
    (r) => r.status === "running" && Date.now() - new Date(r.startedAt).getTime() > 30 * 60_000
  );
  const erroredJobRuns = (jobRuns ?? []).filter((r) => r.status === "error");

  const overallAlerts: { type: "error" | "warning"; text: string }[] = [];
  if (!db.ok) overallAlerts.push({ type: "error", text: `Database: ${db.error}` });
  else if (db.total > db.maxConnections * 0.8)
    overallAlerts.push({
      type: "warning",
      text: uiText("admin_ui.postgres_connections_nearly_full_de708", { v0: db.total, v1: db.maxConnections }),
    });
  if (!redis.ok) overallAlerts.push({ type: "error", text: `Redis: ${redis.error}` });
  if (!realtimeOutbox.ok) overallAlerts.push({ type: "error", text: `Realtime outbox: ${realtimeOutbox.error}` });
  else if (realtimeOutbox.failed > 0 || realtimeOutbox.oldestUnpublishedSeconds > 60)
    overallAlerts.push({
      type: realtimeOutbox.failed > 0 ? "error" : "warning",
      text: uiText("admin_ui.realtime_outbox_backlog_events_oldest_s_failed_bed4f", { v0: realtimeOutbox.pending + realtimeOutbox.processing, v1: realtimeOutbox.oldestUnpublishedSeconds, v2: realtimeOutbox.failed }),
    });
  if (channelHealth.ok && channelHealth.unhealthyCount > 0)
    overallAlerts.push({ type: "warning", text: uiText("admin_ui.unhealthy_channels_across_all_stores_71083", { v0: channelHealth.unhealthyCount }) });
  if (failureIncidents.ok && failureIncidents.last24hByTier.A > 0)
    overallAlerts.push({
      type: "error",
      text: uiText("admin_ui.tier_a_incidents_in_the_last_24_hours_da31a", { v0: failureIncidents.last24hByTier.A }),
    });
  if (erroredJobRuns.length > 0)
    overallAlerts.push({ type: "warning", text: uiText("admin_ui.latest_cron_batch_runs_with_errors_a25c8", { v0: erroredJobRuns.length }) });
  if (stuckJobRuns.length > 0)
    overallAlerts.push({ type: "error", text: uiText("admin_ui.jobs_have_been_running_for_more_than_30_a9695", { v0: stuckJobRuns.length }) });
  if (requestMetrics.ok && requestMetrics.totalRequests > 0 && requestMetrics.errorRatePct >= 5)
    overallAlerts.push({
      type: "error",
      text: uiText("admin_ui.recorded_request_error_rate_is_over_the_last_a2459", { v0: requestMetrics.errorRatePct, v1: requestMetrics.windowMinutes }),
    });

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <Space align="center" style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <div>
          <Title level={3} style={{ marginBottom: 0 }}>
            {uiText("admin_ui.en_system_health_bd51a")}</Title>
          <Text type="secondary">
            {uiText("admin_ui.db_redis_ai_provider_channel_cron_status_across_3e0ec")}</Text>
        </div>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {uiText("admin_ui.last_updated_188d8")} {new Date(generatedAt).toLocaleString(uiText.locale)}
          </Text>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>
            {uiText("admin_ui.refresh_78a47")}</Button>
        </Space>
      </Space>

      {overallAlerts.length > 0 && (
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          {overallAlerts.map((a, i) => (
            <Alert closable key={i} type={a.type} message={a.text} showIcon />
          ))}
        </Space>
      )}
      {overallAlerts.length === 0 && (
        <Alert closable type="success" message={uiText("admin_ui.all_currently_available_checks_are_healthy_fad30")} showIcon style={{ marginBottom: 16 }} />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title={uiText("admin_ui.en_database_postgres_b41cc")} size="small">
            {db.ok ? (
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_connections_8f350")} value={`${db.total} / ${db.maxConnections}`} />
                </Col>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_active_queries_c3e9f")} value={db.active} />
                </Col>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_idle_in_tx_fd05f")} value={db.idleInTransaction} />
                </Col>
                <Col span={8} style={{ marginTop: 12 }}>
                  <Statistic title={uiText("admin_ui.en_longest_active_query_a01b7")} value={`${db.longestActiveQuerySec}s`} />
                </Col>
                <Col span={8} style={{ marginTop: 12 }}>
                  <Statistic title={uiText("admin_ui.en_db_size_cf442")} value={formatBytes(db.dbSizeBytes)} />
                </Col>
              </Row>
            ) : (
              <Alert closable type="error" message={uiText("admin_ui.could_not_read_db_status_97d01")} description={db.error} showIcon />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Redis" size="small">
            {redis.ok ? (
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_ping_latency_810f5")} value={`${redis.latencyMs} ms`} />
                </Col>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_connected_clients_9feff")} value={redis.connectedClients ?? "-"} />
                </Col>
                <Col span={8}>
                  <Statistic title={uiText("admin_ui.en_used_memory_a5d88")} value={redis.usedMemoryHuman ?? "-"} />
                </Col>
              </Row>
            ) : (
              <Alert closable type="error" message={uiText("admin_ui.could_not_connect_to_redis_1caed")} description={redis.error} showIcon />
            )}
          </Card>
        </Col>
      </Row>

      <Card title={uiText("admin_ui.en_realtime_outbox_4b90b")} size="small" style={{ marginBottom: 16 }}>
        {realtimeOutbox.ok ? (
          <Row gutter={16}>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_pending_96f60")} value={realtimeOutbox.pending} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_processing_e6345")} value={realtimeOutbox.processing} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_published_483bf")} value={realtimeOutbox.published} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_failed_09fef")} value={realtimeOutbox.failed} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_oldest_lag_0ef6d")} value={`${realtimeOutbox.oldestUnpublishedSeconds}s`} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title={uiText("admin_ui.en_retries_13093")} value={realtimeOutbox.retryAttempts} /></Col>
          </Row>
        ) : (
          <Alert closable type="error" message={uiText("admin_ui.could_not_read_the_realtime_outbox_990d2")} description={realtimeOutbox.error} showIcon />
        )}
      </Card>

      <Card
        title={uiText("admin_ui.en_request_latency_error_rate_831ab")}
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space size={4}>
            {windowOptions.map((w) => (
              <Link key={w} href={`/admin/system-health?window=${w}`} scroll={false}>
                <Button size="small" type={w === windowMinutes ? "primary" : "default"}>
                  {w >= 60 ? uiText("admin_ui.hr_a5ebf", { v0: w / 60 }) : uiText("admin_ui.min_1f44d", { v0: w })}
                </Button>
              </Link>
            ))}
          </Space>
        }
      >
        <Alert closable
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={uiText("admin_ui.this_page_currently_displays_graphql_operations_gql_only_80b74")}
          description={uiText("admin_ui.the_recorder_supports_namespaces_gql_rest_but_each_286f7")}
        />
        {!requestMetrics.ok ? (
          <Alert closable type="error" message={uiText("admin_ui.could_not_read_metrics_redis_77a7a")} description={requestMetrics.error} showIcon />
        ) : requestMetrics.totalRequests === 0 ? (
          <Empty description={uiText("admin_ui.no_requests_in_this_period_metrics_start_after_767ff")} />
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={6}>
                <Statistic title={uiText("admin_ui.en_requests_f7194")} value={requestMetrics.totalRequests} />
              </Col>
              <Col span={6}>
                <Statistic
                  title={uiText("admin_ui.en_error_rate_5329d")}
                  value={`${requestMetrics.errorRatePct}%`}
                  valueStyle={requestMetrics.errorRatePct >= 5 ? { color: "#cf1322" } : undefined}
                />
              </Col>
              <Col span={6}>
                <Statistic title={uiText("admin_ui.en_errors_805e8")} value={requestMetrics.totalErrors} />
              </Col>
              <Col span={6}>
                <Statistic title={uiText("admin_ui.p95_across_all_operations_5f032")} value={`${requestMetrics.overallP95Ms} ms`} />
              </Col>
            </Row>

            {requestMetrics.errorCodes.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ marginRight: 8 }}>
                  {uiText("admin_ui.en_error_codes_11671")}</Text>
                {requestMetrics.errorCodes.slice(0, 8).map((e) => (
                  <Tag key={e.code} color="red">
                    {e.code} × {e.count}
                  </Tag>
                ))}
              </div>
            )}

            <Table
              size="small"
              pagination={{ pageSize: 15 }}
              rowKey="name"
              dataSource={requestMetrics.operations}
              columns={[
                { title: uiText("admin_ui.en_operation_430d3"), dataIndex: "name", ellipsis: true },
                { title: uiText("admin_ui.en_calls_0a19b"), dataIndex: "count", width: 80, sorter: (a, b) => a.count - b.count },
                {
                  title: "p50",
                  dataIndex: "p50Ms",
                  width: 90,
                  render: (v: number) => `${v} ms`,
                  sorter: (a, b) => a.p50Ms - b.p50Ms,
                },
                {
                  title: "p95",
                  dataIndex: "p95Ms",
                  width: 90,
                  render: (v: number) => (
                    <Text type={v >= 1000 ? "danger" : undefined}>{v} ms</Text>
                  ),
                  sorter: (a, b) => a.p95Ms - b.p95Ms,
                },
                {
                  title: "p99",
                  dataIndex: "p99Ms",
                  width: 90,
                  render: (v: number) => `${v} ms`,
                  sorter: (a, b) => a.p99Ms - b.p99Ms,
                },
                {
                  title: uiText("admin_ui.total_time_a9c57"),
                  dataIndex: "totalMs",
                  width: 110,
                  defaultSortOrder: "descend",
                  render: (v: number) => `${(v / 1000).toFixed(1)} s`,
                  sorter: (a, b) => a.totalMs - b.totalMs,
                },
                {
                  title: uiText("admin_ui.en_error_7f2f6"),
                  dataIndex: "errorRatePct",
                  width: 100,
                  render: (v: number, row) =>
                    row.errors > 0 ? (
                      <Text type="danger">
                        {v}% ({row.errors})
                      </Text>
                    ) : (
                      "-"
                    ),
                  sorter: (a, b) => a.errorRatePct - b.errorRatePct,
                },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {uiText("admin_ui.sorted_by_total_time_calls_average_by_default_6379b")}</Text>
          </>
        )}
      </Card>

      <Card
        title={uiText("admin_ui.en_ai_provider_health_e40f3")}
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Link href="/admin/env">{uiText("admin_ui.details_test_27152")}</Link>}
      >
        {aiProvidersError ? (
          <Alert closable type="error" message={uiText("admin_ui.unavailable_f31b3")} description={aiProvidersError} showIcon />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => `${r.provider}-${r.purpose}`}
            dataSource={aiProviders ?? []}
            locale={{ emptyText: <Empty description={uiText("admin_ui.no_data_2056d")} /> }}
            columns={[
              { title: uiText("admin_ui.en_provider_7ceee"), dataIndex: "provider" },
              { title: uiText("admin_ui.en_purpose_a0fb8"), dataIndex: "purpose" },
              {
                title: uiText("admin_ui.en_status_bae7d"),
                dataIndex: "status",
                render: (s: string) => <Tag color={AI_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              { title: uiText("admin_ui.en_detail_7c9a7"), dataIndex: "status_detail", ellipsis: true },
              {
                title: uiText("admin_ui.en_last_checked_ada1b"),
                dataIndex: "last_checked_at",
                render: (v: string | null) => (v ? new Date(v).toLocaleString(uiText.locale) : "-"),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title={uiText("admin_ui.en_cron_batch_job_runs_last_run_per_job_ad2ba")}
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Link href="/admin/operations-schedule">{uiText("admin_ui.details_history_875ad")}</Link>}
      >
        {jobRunsError ? (
          <Alert closable
            type="warning"
            message={uiText("admin_ui.unavailable_migration_7_55_may_not_be_applied_9cfc4")}
            description={jobRunsError}
            showIcon
          />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={jobRuns ?? []}
            locale={{ emptyText: <Empty description={uiText("admin_ui.no_runs_yet_a6786")} /> }}
            columns={[
              {
                title: uiText("admin_ui.en_job_30c8c"),
                dataIndex: "jobName",
                render: (k: string) => jobNameByKey[k] ?? k,
              },
              {
                title: uiText("admin_ui.en_status_bae7d"),
                dataIndex: "status",
                render: (s: string) => <Tag color={JOB_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              {
                title: uiText("admin_ui.en_started_faa9e"),
                dataIndex: "startedAt",
                render: (v: string) => new Date(v).toLocaleString(uiText.locale),
              },
              {
                title: uiText("admin_ui.en_duration_13700"),
                dataIndex: "durationMs",
                render: (v: number | null) => (v != null ? `${v} ms` : "-"),
              },
              { title: uiText("admin_ui.en_error_7f2f6"), dataIndex: "error", ellipsis: true },
            ]}
          />
        )}
      </Card>

      <Card
        title={uiText("admin_ui.channel_health_unhealthy_across_all_stores_bea91", { v0: channelHealth.ok ? channelHealth.unhealthyCount : "?" })}
        size="small"
        style={{ marginBottom: 16 }}
      >
        {!channelHealth.ok ? (
          <Alert closable type="error" message={uiText("admin_ui.unavailable_f31b3")} description={channelHealth.error} showIcon />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => `${r.tenantId}-${r.channel}`}
            dataSource={channelHealth.rows}
            locale={{ emptyText: <Empty description={uiText("admin_ui.no_unhealthy_channels_currently_aeda0")} /> }}
            columns={[
              { title: uiText("admin_ui.shop_0ff21"), dataIndex: "tenantName" },
              { title: uiText("admin_ui.channel_c0fcc"), dataIndex: "channel" },
              {
                title: uiText("admin_ui.en_status_bae7d"),
                dataIndex: "status",
                render: (s: string) => <Tag color={CHANNEL_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              { title: uiText("admin_ui.en_detail_7c9a7"), dataIndex: "statusDetail", ellipsis: true },
              {
                title: uiText("admin_ui.en_last_checked_ada1b"),
                dataIndex: "lastCheckedAt",
                render: (v: string | null) => (v ? new Date(v).toLocaleString(uiText.locale) : "-"),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title={
          failureIncidents.ok
            ? uiText("admin_ui.failure_incidents_last_24_hours_tier_a_tier_1db5d", { v0: failureIncidents.last24hByTier.A, v1: failureIncidents.last24hByTier.B })
            : uiText("admin_ui.en_failure_incidents_848a9")
        }
        size="small"
      >
        {!failureIncidents.ok ? (
          <Alert closable
            type="warning"
            message={uiText("admin_ui.unavailable_migration_7_36_may_not_be_applied_4e207")}
            description={failureIncidents.error}
            showIcon
          />
        ) : (
          <Table
            size="small"
            pagination={{ pageSize: 10 }}
            rowKey="id"
            dataSource={failureIncidents.rows}
            locale={{ emptyText: <Empty description={uiText("admin_ui.no_recent_incidents_ccb0b")} /> }}
            columns={[
              {
                title: uiText("admin_ui.en_tier_5bd44"),
                dataIndex: "tier",
                render: (t: string) => <Tag color={TIER_COLOR[t] ?? "default"}>{t}</Tag>,
              },
              { title: uiText("admin_ui.shop_0ff21"), dataIndex: "tenantName" },
              { title: uiText("admin_ui.en_code_adac6"), dataIndex: "code" },
              { title: uiText("admin_ui.en_surface_cda05"), dataIndex: "surface" },
              { title: uiText("admin_ui.en_channel_879f0"), dataIndex: "channel", render: (v: string | null) => v ?? "-" },
              { title: uiText("admin_ui.en_error_7f2f6"), dataIndex: "errorMessage", ellipsis: true },
              {
                title: uiText("admin_ui.time_7a229"),
                dataIndex: "createdAt",
                render: (v: string) => new Date(v).toLocaleString(uiText.locale),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
