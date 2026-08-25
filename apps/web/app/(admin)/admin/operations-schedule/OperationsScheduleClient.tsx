"use client";

import {
  Alert, Card, Col, Divider, List, Row, Space, Table, Tag, Typography,
} from "antd";
import {
  ApiOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, DatabaseOutlined, ExclamationCircleOutlined, GithubOutlined,
  InfoCircleOutlined, SyncOutlined,
} from "@ant-design/icons";
import type { OperationScheduleRow } from "@/lib/bms/operationsSchedule";
import type { JobRunRow } from "@/lib/bms/jobRuns";

const { Paragraph, Text, Title } = Typography;

// A 'running' row older than this is almost certainly a crashed/killed process
// that never reached finishJobRun() — treat it as stuck rather than in flight.
const STUCK_RUNNING_MINUTES = 30;

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isStuck(run: JobRunRow) {
  return run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > STUCK_RUNNING_MINUTES * 60_000;
}

function runStatusTag(run: JobRunRow | undefined) {
  if (!run) return <Tag>Never run yet</Tag>;
  if (isStuck(run)) return <Tag color="red" icon={<ExclamationCircleOutlined />}>Stuck (still "running")</Tag>;
  if (run.status === "running") return <Tag color="blue" icon={<SyncOutlined spin />}>Running</Tag>;
  if (run.status === "success") return <Tag color="green" icon={<CheckCircleOutlined />}>Success</Tag>;
  return <Tag color="red" icon={<CloseCircleOutlined />}>Error</Tag>;
}

function statusTag(status: OperationScheduleRow["status"]) {
  return status === "Scheduled" ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>Scheduled</Tag>
  ) : (
    <Tag color="gold" icon={<ClockCircleOutlined />}>Ready but unscheduled</Tag>
  );
}

function kindTag(kind: OperationScheduleRow["kind"]) {
  return kind === "GitHub Action" ? (
    <Tag color="geekblue" icon={<GithubOutlined />}>{kind}</Tag>
  ) : (
    <Tag color="purple" icon={<ApiOutlined />}>{kind}</Tag>
  );
}

function buildColumns(latestRunByKey: Record<string, JobRunRow | undefined>) {
  return [
    {
      title: "Job", key: "name", width: 220,
      render: (_: unknown, row: OperationScheduleRow) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.name}</Text>
          <Space size={6} wrap>{kindTag(row.kind)}{statusTag(row.status)}</Space>
        </Space>
      ),
    },
    { title: "When", dataIndex: "when", key: "when", width: 180, render: (value: string) => <Text>{value}</Text> },
    {
      title: "Last run", key: "lastRun", width: 190,
      render: (_: unknown, row: OperationScheduleRow) => {
        const run = latestRunByKey[row.key];
        return (
          <Space direction="vertical" size={2}>
            {runStatusTag(run)}
            {run ? <Text type="secondary" style={{ fontSize: 12 }}>{relativeTime(run.startedAt)}</Text> : null}
          </Space>
        );
      },
    },
    { title: "Trigger", dataIndex: "trigger", key: "trigger", width: 260, render: (value: string) => <Text code>{value}</Text> },
    { title: "Purpose", dataIndex: "purpose", key: "purpose", render: (value: string) => <Text>{value}</Text> },
  ];
}

function AiViewCard({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: string;
}) {
  return (
    <Card
      size="small"
      title={title}
      styles={{ header: { borderBottomColor: "#f0f0f0" }, body: { paddingBlock: 12 } }}
    >
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item style={{ border: "none", paddingBlock: 6 }}>
            <Space align="start">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: color,
                  marginTop: 8,
                  flex: "0 0 auto",
                }}
              />
              <Text>{item}</Text>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}

export default function OperationsScheduleClient({
  rows,
  runsByJob,
}: {
  rows: OperationScheduleRow[];
  runsByJob: Record<string, JobRunRow[]>;
}) {
  const scheduledCount = rows.filter((row) => row.status === "Scheduled").length;
  const unscheduledCount = rows.length - scheduledCount;
  const latestRunByKey: Record<string, JobRunRow | undefined> = {};
  for (const row of rows) latestRunByKey[row.key] = runsByJob[row.key]?.[0];
  const columns = buildColumns(latestRunByKey);
  const stuckCount = Object.values(latestRunByKey).filter((r) => r && isStuck(r)).length;
  const errorCount = Object.values(latestRunByKey).filter((r) => r && !isStuck(r) && r.status === "error").length;

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}><CalendarOutlined /> Batch & Cron Overview</Title>
          <Text type="secondary">Overview of scheduled jobs and cron-ready endpoints.</Text>
        </div>
      </Space>

      <Alert closable type="info" showIcon style={{ marginBottom: 16 }} message="Evidence-first view"
        description="The page inspects workflow and route source files when they are deployed, then safely falls back to the verified operations registry when source files are unavailable." />

      {(stuckCount > 0 || errorCount > 0) && (
        <Alert closable
          type="error" showIcon style={{ marginBottom: 16 }}
          message="A job's most recent run needs attention"
          description={
            [
              errorCount > 0 ? `${errorCount} job(s) errored on their last run.` : null,
              stuckCount > 0 ? `${stuckCount} job(s) have been stuck in "running" for over ${STUCK_RUNNING_MINUTES} minutes — likely a crashed process that never reported back.` : null,
            ].filter(Boolean).join(" ")
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">Jobs found</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{rows.length}</Text>
          <Text type="secondary">Across GitHub Actions and cron endpoints</Text>
        </Space></Card></Col>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">Scheduled now</Text><Text style={{ fontSize: 28, fontWeight: 700, color: "#389e0d" }}>{scheduledCount}</Text>
          <Text type="secondary">Has schedule evidence in repo</Text>
        </Space></Card></Col>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">Need scheduler</Text><Text style={{ fontSize: 28, fontWeight: 700, color: "#d48806" }}>{unscheduledCount}</Text>
          <Text type="secondary">Ready endpoint, but no wired schedule found</Text>
        </Space></Card></Col>
      </Row>

      <Card><Table rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1100 }}
        expandable={{ expandedRowRender: (row: OperationScheduleRow) => (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div><Text strong>Evidence</Text><Paragraph style={{ margin: "4px 0 0" }}>{row.evidence}</Paragraph></div>
            <div><Text strong>Source</Text><Paragraph style={{ margin: "4px 0 0" }}>
              <Text code>{row.sourcePath}</Text>{row.docsPath ? <>{" · "}<Text code>{row.docsPath}</Text></> : null}
            </Paragraph></div>
            <div>
              <Text strong>Recent runs</Text>
              {runsByJob[row.key]?.length ? (
                <List
                  size="small"
                  style={{ marginTop: 4 }}
                  dataSource={runsByJob[row.key]}
                  renderItem={(run) => (
                    <List.Item style={{ paddingBlock: 6 }}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Space wrap>
                          {runStatusTag(run)}
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(run.startedAt).toLocaleString()} · {relativeTime(run.startedAt)}
                            {run.durationMs != null ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}
                            {run.triggeredBy ? ` · ${run.triggeredBy}` : ""}
                          </Text>
                        </Space>
                        {run.error ? <Text type="danger" style={{ fontSize: 12 }}>{run.error}</Text> : null}
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                  No recorded runs yet — either this job hasn't fired since 7.55__bms_job_runs.sql was applied, or (for release-expired/channel-health/ai-health/report-digest) no external scheduler is calling it yet.
                </Paragraph>
              )}
            </div>
            {row.aiView ? (
              <div>
                <Text strong>What AI receives</Text>
                <Paragraph type="secondary" style={{ margin: "4px 0 12px" }}>
                  This job does not send raw logs blindly. It prepares a bounded report first, then hands that report to AI.
                </Paragraph>
                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={8}>
                    <AiViewCard title="AI sees" items={row.aiView.input} color="#1677ff" />
                  </Col>
                  <Col xs={24} xl={8}>
                    <AiViewCard title="Safeguards" items={row.aiView.safeguards} color="#fa8c16" />
                  </Col>
                  <Col xs={24} xl={8}>
                    <AiViewCard title="Expected outcome" items={row.aiView.outcome} color="#389e0d" />
                  </Col>
                </Row>
              </div>
            ) : null}
            <div><Text strong>Why this matters</Text><Paragraph style={{ margin: "4px 0 0" }}>
              {row.status === "Scheduled"
                ? "Operators can trust that this job has an actual timer in the repository and can follow up with real run history next."
                : "Operators should not assume this job is running today. The code is ready, but an external scheduler still needs to call it."}
            </Paragraph></div>
          </Space>
        ) }} />
      </Card>

      <Divider />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}><Card title="Design Notes"><List
          dataSource={[
            "Separate 'Scheduled' from 'Ready but unscheduled' so ops never has to guess.",
            "Show evidence, not assumptions: workflow cron, route comment, and supporting docs note.",
            "Keep the purpose line short so non-dev admins can understand why the job exists.",
            "For AI-driven jobs, show the bounded input and safety rails so admins know what actually leaves the system.",
            "'Last run' and 'Recent runs' (expand a row) now come from real bms_job_runs rows — see the note below for what's still required to see any data there.",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><InfoCircleOutlined style={{ color: "#1677ff", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
        <Col xs={24} xl={10}><Card title="Still Open"><List
          dataSource={[
            "None of the 4 cron endpoints have an external scheduler wired yet (see Status column) — a route only gets a run logged when something actually calls it.",
            "daily-log-triage only reports back if BMS_APP_BASE_URL + BMS_CRON_SECRET are set as GitHub Actions secrets.",
            "A 'running' row that crashed before finishing is flagged 'Stuck' after 30 minutes, but is never auto-corrected — that's a real signal something needs manual attention.",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><DatabaseOutlined style={{ color: "#722ed1", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
      </Row>

      <Alert closable type="info" showIcon style={{ marginTop: 16 }} icon={<InfoCircleOutlined />}
        message="Requires migration 7.55" description="Run history is read from bms_job_runs (db/migrations/7.55__bms_job_runs.sql). Until that migration is applied, every job on this page will show 'Never run yet' even if its cron endpoint is being called." />
    </div>
  );
}
