"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Card, Row, Col, Statistic, Table, Tag, Alert, Button, Typography, Space, Empty } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type {
  DbHealth,
  RedisHealth,
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
      text: `Postgres connections ใกล้เต็ม (${db.total}/${db.maxConnections})`,
    });
  if (!redis.ok) overallAlerts.push({ type: "error", text: `Redis: ${redis.error}` });
  if (channelHealth.ok && channelHealth.unhealthyCount > 0)
    overallAlerts.push({ type: "warning", text: `${channelHealth.unhealthyCount} ช่องทางไม่ปกติ (ข้ามทุกร้าน)` });
  if (failureIncidents.ok && failureIncidents.last24hByTier.A > 0)
    overallAlerts.push({
      type: "error",
      text: `${failureIncidents.last24hByTier.A} เหตุการณ์ tier A ใน 24 ชม.ล่าสุด — ลูกค้าได้รับผลกระทบจริง`,
    });
  if (erroredJobRuns.length > 0)
    overallAlerts.push({ type: "warning", text: `Cron/batch job ล่าสุดที่ error: ${erroredJobRuns.length} งาน` });
  if (stuckJobRuns.length > 0)
    overallAlerts.push({ type: "error", text: `${stuckJobRuns.length} job ค้างสถานะ running เกิน 30 นาที` });
  if (requestMetrics.ok && requestMetrics.totalRequests > 0 && requestMetrics.errorRatePct >= 5)
    overallAlerts.push({
      type: "error",
      text: `Error rate ของ GraphQL อยู่ที่ ${requestMetrics.errorRatePct}% ใน ${requestMetrics.windowMinutes} นาทีล่าสุด`,
    });

  return (
    <div style={{ padding: 24, maxWidth: 1280 }}>
      <Space align="center" style={{ marginBottom: 16, justifyContent: "space-between", width: "100%" }}>
        <div>
          <Title level={3} style={{ marginBottom: 0 }}>
            System Health
          </Title>
          <Text type="secondary">
            รวมสถานะ DB / Redis / AI Provider / Channel / Cron ข้ามทุกร้าน — อ่านอย่างเดียว ไม่มีการเขียนข้อมูล
          </Text>
        </div>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            อัปเดตล่าสุด: {new Date(generatedAt).toLocaleString()}
          </Text>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refresh}>
            รีเฟรช
          </Button>
        </Space>
      </Space>

      {overallAlerts.length > 0 && (
        <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
          {overallAlerts.map((a, i) => (
            <Alert key={i} type={a.type} message={a.text} showIcon />
          ))}
        </Space>
      )}
      {overallAlerts.length === 0 && (
        <Alert type="success" message="ทุกจุดที่เช็คได้ตอนนี้ปกติ" showIcon style={{ marginBottom: 16 }} />
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="Database (Postgres)" size="small">
            {db.ok ? (
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="Connections" value={`${db.total} / ${db.maxConnections}`} />
                </Col>
                <Col span={8}>
                  <Statistic title="Active queries" value={db.active} />
                </Col>
                <Col span={8}>
                  <Statistic title="Idle in tx" value={db.idleInTransaction} />
                </Col>
                <Col span={8} style={{ marginTop: 12 }}>
                  <Statistic title="Longest active query" value={`${db.longestActiveQuerySec}s`} />
                </Col>
                <Col span={8} style={{ marginTop: 12 }}>
                  <Statistic title="DB size" value={formatBytes(db.dbSizeBytes)} />
                </Col>
              </Row>
            ) : (
              <Alert type="error" message="อ่านสถานะ DB ไม่ได้" description={db.error} showIcon />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Redis" size="small">
            {redis.ok ? (
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="Ping latency" value={`${redis.latencyMs} ms`} />
                </Col>
                <Col span={8}>
                  <Statistic title="Connected clients" value={redis.connectedClients ?? "-"} />
                </Col>
                <Col span={8}>
                  <Statistic title="Used memory" value={redis.usedMemoryHuman ?? "-"} />
                </Col>
              </Row>
            ) : (
              <Alert type="error" message="ต่อ Redis ไม่ได้" description={redis.error} showIcon />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Request Latency & Error Rate (GraphQL)"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Space size={4}>
            {windowOptions.map((w) => (
              <Link key={w} href={`/admin/system-health?window=${w}`} scroll={false}>
                <Button size="small" type={w === windowMinutes ? "primary" : "default"}>
                  {w >= 60 ? `${w / 60} ชม.` : `${w} นาที`}
                </Button>
              </Link>
            ))}
          </Space>
        }
      >
        {!requestMetrics.ok ? (
          <Alert type="error" message="อ่าน metric ไม่ได้ (Redis)" description={requestMetrics.error} showIcon />
        ) : requestMetrics.totalRequests === 0 ? (
          <Empty description="ยังไม่มี request ในช่วงเวลานี้ — metric เริ่มเก็บหลัง deploy โค้ดนี้เท่านั้น ไม่มีข้อมูลย้อนหลัง" />
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={6}>
                <Statistic title="Requests" value={requestMetrics.totalRequests} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="Error rate"
                  value={`${requestMetrics.errorRatePct}%`}
                  valueStyle={requestMetrics.errorRatePct >= 5 ? { color: "#cf1322" } : undefined}
                />
              </Col>
              <Col span={6}>
                <Statistic title="Errors" value={requestMetrics.totalErrors} />
              </Col>
              <Col span={6}>
                <Statistic title="p95 รวมทุก operation" value={`${requestMetrics.overallP95Ms} ms`} />
              </Col>
            </Row>

            {requestMetrics.errorCodes.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ marginRight: 8 }}>
                  Error codes:
                </Text>
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
                { title: "Operation", dataIndex: "name", ellipsis: true },
                { title: "Calls", dataIndex: "count", width: 80, sorter: (a, b) => a.count - b.count },
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
                  title: "เวลารวม",
                  dataIndex: "totalMs",
                  width: 110,
                  defaultSortOrder: "descend",
                  render: (v: number) => `${(v / 1000).toFixed(1)} s`,
                  sorter: (a, b) => a.totalMs - b.totalMs,
                },
                {
                  title: "Error",
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
              เรียงตาม &quot;เวลารวม&quot; (calls × avg) เป็นค่าเริ่มต้น — operation ที่เร็วแต่ถูกเรียกบ่อยมากอาจกินเวลา
              DB รวมมากกว่า operation ที่ช้าแต่นานๆ เรียกที · percentile คำนวณจาก histogram bucket จึงเป็นค่าประมาณ ·
              เก็บใน Redis เท่านั้น (TTL 4 ชม.) — restart Redis แล้วข้อมูลหาย
            </Text>
          </>
        )}
      </Card>

      <Card
        title="AI Provider Health"
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Link href="/admin/env">ดูรายละเอียด / ทดสอบ →</Link>}
      >
        {aiProvidersError ? (
          <Alert type="error" message="อ่านไม่ได้" description={aiProvidersError} showIcon />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => `${r.provider}-${r.purpose}`}
            dataSource={aiProviders ?? []}
            locale={{ emptyText: <Empty description="ไม่มีข้อมูล" /> }}
            columns={[
              { title: "Provider", dataIndex: "provider" },
              { title: "Purpose", dataIndex: "purpose" },
              {
                title: "Status",
                dataIndex: "status",
                render: (s: string) => <Tag color={AI_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              { title: "Detail", dataIndex: "status_detail", ellipsis: true },
              {
                title: "Last checked",
                dataIndex: "last_checked_at",
                render: (v: string | null) => (v ? new Date(v).toLocaleString() : "-"),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title="Cron / Batch Job Runs (last run per job)"
        size="small"
        style={{ marginBottom: 16 }}
        extra={<Link href="/admin/operations-schedule">ดูรายละเอียด / ประวัติ →</Link>}
      >
        {jobRunsError ? (
          <Alert
            type="warning"
            message="อ่านไม่ได้ (อาจยังไม่ apply migration 7.55)"
            description={jobRunsError}
            showIcon
          />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={jobRuns ?? []}
            locale={{ emptyText: <Empty description="ยังไม่มี run เลย" /> }}
            columns={[
              {
                title: "Job",
                dataIndex: "jobName",
                render: (k: string) => jobNameByKey[k] ?? k,
              },
              {
                title: "Status",
                dataIndex: "status",
                render: (s: string) => <Tag color={JOB_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              {
                title: "Started",
                dataIndex: "startedAt",
                render: (v: string) => new Date(v).toLocaleString(),
              },
              {
                title: "Duration",
                dataIndex: "durationMs",
                render: (v: number | null) => (v != null ? `${v} ms` : "-"),
              },
              { title: "Error", dataIndex: "error", ellipsis: true },
            ]}
          />
        )}
      </Card>

      <Card
        title={`Channel Health — ไม่ปกติข้ามทุกร้าน (${channelHealth.ok ? channelHealth.unhealthyCount : "?"})`}
        size="small"
        style={{ marginBottom: 16 }}
      >
        {!channelHealth.ok ? (
          <Alert type="error" message="อ่านไม่ได้" description={channelHealth.error} showIcon />
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => `${r.tenantId}-${r.channel}`}
            dataSource={channelHealth.rows}
            locale={{ emptyText: <Empty description="ไม่มีช่องทางที่ผิดปกติตอนนี้" /> }}
            columns={[
              { title: "ร้าน", dataIndex: "tenantName" },
              { title: "ช่องทาง", dataIndex: "channel" },
              {
                title: "Status",
                dataIndex: "status",
                render: (s: string) => <Tag color={CHANNEL_STATUS_COLOR[s] ?? "default"}>{s}</Tag>,
              },
              { title: "Detail", dataIndex: "statusDetail", ellipsis: true },
              {
                title: "Last checked",
                dataIndex: "lastCheckedAt",
                render: (v: string | null) => (v ? new Date(v).toLocaleString() : "-"),
              },
            ]}
          />
        )}
      </Card>

      <Card
        title={
          failureIncidents.ok
            ? `Failure Incidents — 24 ชม.ล่าสุด (Tier A: ${failureIncidents.last24hByTier.A} · Tier B: ${failureIncidents.last24hByTier.B})`
            : "Failure Incidents"
        }
        size="small"
      >
        {!failureIncidents.ok ? (
          <Alert
            type="warning"
            message="อ่านไม่ได้ (อาจยังไม่ apply migration 7.36)"
            description={failureIncidents.error}
            showIcon
          />
        ) : (
          <Table
            size="small"
            pagination={{ pageSize: 10 }}
            rowKey="id"
            dataSource={failureIncidents.rows}
            locale={{ emptyText: <Empty description="ไม่มีเหตุการณ์ล่าสุด" /> }}
            columns={[
              {
                title: "Tier",
                dataIndex: "tier",
                render: (t: string) => <Tag color={TIER_COLOR[t] ?? "default"}>{t}</Tag>,
              },
              { title: "ร้าน", dataIndex: "tenantName" },
              { title: "Code", dataIndex: "code" },
              { title: "Surface", dataIndex: "surface" },
              { title: "Channel", dataIndex: "channel", render: (v: string | null) => v ?? "-" },
              { title: "Error", dataIndex: "errorMessage", ellipsis: true },
              {
                title: "เวลา",
                dataIndex: "createdAt",
                render: (v: string) => new Date(v).toLocaleString(),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
