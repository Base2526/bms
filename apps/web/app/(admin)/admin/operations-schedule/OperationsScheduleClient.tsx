"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";

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

function relativeTime(iso: string, uiText: UiTranslator) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return uiText("admin_ui.time_just_now");
  if (mins < 60) return uiText("admin_restock.rel_minutes_ago", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return uiText("admin_restock.rel_hours_ago", { n: hrs });
  return uiText("admin_restock.rel_days_ago", { n: Math.floor(hrs / 24) });
}

function isStuck(run: JobRunRow) {
  return run.status === "running" && Date.now() - new Date(run.startedAt).getTime() > STUCK_RUNNING_MINUTES * 60_000;
}

function runStatusTag(run: JobRunRow | undefined, uiText: UiTranslator = thaiUiText) {
  if (!run) return <Tag>{uiText("admin_ui.en_never_run_yet_e51f8")}</Tag>;
  if (isStuck(run)) return <Tag color="red" icon={<ExclamationCircleOutlined />}>{uiText("admin_ui.en_stuck_still_running_fd163")}</Tag>;
  if (run.status === "running") return <Tag color="blue" icon={<SyncOutlined spin />}>{uiText("admin_ui.en_running_73989")}</Tag>;
  if (run.status === "success") return <Tag color="green" icon={<CheckCircleOutlined />}>{uiText("admin_ui.en_success_42a8f")}</Tag>;
  return <Tag color="red" icon={<CloseCircleOutlined />}>{uiText("admin_ui.en_error_7f2f6")}</Tag>;
}

function statusTag(status: OperationScheduleRow["status"], uiText: UiTranslator = thaiUiText) {
  return status === "Scheduled" ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>{uiText("admin_ui.en_scheduled_1cd1b")}</Tag>
  ) : (
    <Tag color="gold" icon={<ClockCircleOutlined />}>{uiText("admin_ui.en_ready_but_unscheduled_77acb")}</Tag>
  );
}

function kindTag(kind: OperationScheduleRow["kind"]) {
  return kind === "GitHub Action" ? (
    <Tag color="geekblue" icon={<GithubOutlined />}>{kind}</Tag>
  ) : (
    <Tag color="purple" icon={<ApiOutlined />}>{kind}</Tag>
  );
}

function buildColumns(latestRunByKey: Record<string, JobRunRow | undefined>, uiText: UiTranslator = thaiUiText) {
  return [
    {
      title: uiText("admin_ui.en_job_30c8c"), key: "name", width: 220,
      render: (_: unknown, row: OperationScheduleRow) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.name}</Text>
          <Space size={6} wrap>{kindTag(row.kind)}{statusTag(row.status, uiText)}</Space>
        </Space>
      ),
    },
    { title: uiText("admin_ui.en_when_769bb"), dataIndex: "when", key: "when", width: 180, render: (value: string) => <Text>{value}</Text> },
    {
      title: uiText("admin_ui.en_last_run_333c6"), key: "lastRun", width: 190,
      render: (_: unknown, row: OperationScheduleRow) => {
        const run = latestRunByKey[row.key];
        return (
          <Space direction="vertical" size={2}>
            {runStatusTag(run, uiText)}
            {run ? <Text type="secondary" style={{ fontSize: 12 }}>{relativeTime(run.startedAt, uiText)}</Text> : null}
          </Space>
        );
      },
    },
    { title: uiText("admin_ui.en_trigger_d3f06"), dataIndex: "trigger", key: "trigger", width: 260, render: (value: string) => <Text code>{value}</Text> },
    { title: uiText("admin_ui.en_purpose_a0fb8"), dataIndex: "purpose", key: "purpose", render: (value: string) => <Text>{value}</Text> },
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
  const uiText = useUiText();
  const scheduledCount = rows.filter((row) => row.status === "Scheduled").length;
  const unscheduledCount = rows.length - scheduledCount;
  const latestRunByKey: Record<string, JobRunRow | undefined> = {};
  for (const row of rows) latestRunByKey[row.key] = runsByJob[row.key]?.[0];
  const columns = buildColumns(latestRunByKey, uiText);
  const stuckCount = Object.values(latestRunByKey).filter((r) => r && isStuck(r)).length;
  const errorCount = Object.values(latestRunByKey).filter((r) => r && !isStuck(r) && r.status === "error").length;

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}><CalendarOutlined />  {uiText("admin_ui.en_batch_cron_overview_ab63f")}</Title>
          <Text type="secondary">{uiText("admin_ui.en_overview_of_scheduled_jobs_and_cron_ready_endpoints_da55e")}</Text>
        </div>
      </Space>

      <Alert closable type="info" showIcon style={{ marginBottom: 16 }} message={uiText("admin_ui.en_evidence_first_view_1a8fa")}
        description={uiText("admin_ui.en_the_page_inspects_workflow_and_route_source_files_5ce94")} />

      {(stuckCount > 0 || errorCount > 0) && (
        <Alert closable
          type="error" showIcon style={{ marginBottom: 16 }}
          message={uiText("admin_ui.en_a_job_s_most_recent_run_needs_attention_97864")}
          description={
            [
              errorCount > 0 ? uiText("admin_ui.jobs_last_run_error", { count: errorCount }) : null,
              stuckCount > 0 ? uiText("admin_ui.jobs_stuck_running", { count: stuckCount, minutes: STUCK_RUNNING_MINUTES }) : null,
            ].filter(Boolean).join(" ")
          }
        />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">{uiText("admin_ui.en_jobs_found_55842")}</Text><Text style={{ fontSize: 28, fontWeight: 700 }}>{rows.length}</Text>
          <Text type="secondary">{uiText("admin_ui.en_across_github_actions_and_cron_endpoints_985b3")}</Text>
        </Space></Card></Col>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">{uiText("admin_ui.en_scheduled_now_9b368")}</Text><Text style={{ fontSize: 28, fontWeight: 700, color: "#389e0d" }}>{scheduledCount}</Text>
          <Text type="secondary">{uiText("admin_ui.en_has_schedule_evidence_in_repo_ada8d")}</Text>
        </Space></Card></Col>
        <Col xs={24} md={8}><Card><Space direction="vertical" size={6}>
          <Text type="secondary">{uiText("admin_ui.en_need_scheduler_c2e96")}</Text><Text style={{ fontSize: 28, fontWeight: 700, color: "#d48806" }}>{unscheduledCount}</Text>
          <Text type="secondary">{uiText("admin_ui.en_ready_endpoint_but_no_wired_schedule_found_63ad7")}</Text>
        </Space></Card></Col>
      </Row>

      <Card><Table rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1100 }}
        expandable={{ expandedRowRender: (row: OperationScheduleRow) => (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div><Text strong>{uiText("admin_ui.en_evidence_7ea01")}</Text><Paragraph style={{ margin: "4px 0 0" }}>{row.evidence}</Paragraph></div>
            <div><Text strong>{uiText("admin_ui.en_source_6da13")}</Text><Paragraph style={{ margin: "4px 0 0" }}>
              <Text code>{row.sourcePath}</Text>{row.docsPath ? <>{" · "}<Text code>{row.docsPath}</Text></> : null}
            </Paragraph></div>
            <div>
              <Text strong>{uiText("admin_ui.en_recent_runs_af705")}</Text>
              {runsByJob[row.key]?.length ? (
                <List
                  size="small"
                  style={{ marginTop: 4 }}
                  dataSource={runsByJob[row.key]}
                  renderItem={(run) => (
                    <List.Item style={{ paddingBlock: 6 }}>
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Space wrap>
                          {runStatusTag(run, uiText)}
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {new Date(run.startedAt).toLocaleString(uiText.locale)} · {relativeTime(run.startedAt, uiText)}
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
                  {uiText("admin_ui.en_no_recorded_runs_yet_the_job_may_not_483d8")}</Paragraph>
              )}
            </div>
            {row.aiView ? (
              <div>
                <Text strong>{uiText("admin_ui.en_what_ai_receives_8bcd1")}</Text>
                <Paragraph type="secondary" style={{ margin: "4px 0 12px" }}>
                  {uiText("admin_ui.en_this_job_does_not_send_raw_logs_blindly_afe7f")}</Paragraph>
                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={8}>
                    <AiViewCard title={uiText("admin_ui.en_ai_sees_a155a")} items={row.aiView.input} color="#1677ff" />
                  </Col>
                  <Col xs={24} xl={8}>
                    <AiViewCard title={uiText("admin_ui.en_safeguards_a51ac")} items={row.aiView.safeguards} color="#fa8c16" />
                  </Col>
                  <Col xs={24} xl={8}>
                    <AiViewCard title={uiText("admin_ui.en_expected_outcome_03e42")} items={row.aiView.outcome} color="#389e0d" />
                  </Col>
                </Row>
              </div>
            ) : null}
            <div><Text strong>{uiText("admin_ui.en_why_this_matters_76ff2")}</Text><Paragraph style={{ margin: "4px 0 0" }}>
              {row.status === "Scheduled"
                ? uiText("admin_ui.en_operators_can_trust_that_this_job_has_an_abb86")
                : uiText("admin_ui.en_operators_should_not_assume_this_job_is_running_581d9")}
            </Paragraph></div>
          </Space>
        ) }} />
      </Card>

      <Divider />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}><Card title={uiText("admin_ui.en_design_notes_5966d")}><List
          dataSource={[
            "Separate 'Scheduled' from 'Ready but unscheduled' so ops never has to guess.",
            "Show evidence, not assumptions: workflow cron, route comment, and supporting docs note.",
            "Keep the purpose line short so non-dev admins can understand why the job exists.",
            "For AI-driven jobs, show the bounded input and safety rails so admins know what actually leaves the system.",
            "'Last run' and 'Recent runs' (expand a row) now come from real bms_job_runs rows — see the note below for what's still required to see any data there.",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><InfoCircleOutlined style={{ color: "#1677ff", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
        <Col xs={24} xl={10}><Card title={uiText("admin_ui.en_still_open_5de28")}><List
          dataSource={[
            "Scheduled endpoint jobs run only when BMS_APP_BASE_URL + BMS_CRON_SECRET are configured as GitHub Actions secrets; verify this against Recent runs.",
            "A route shown as Ready but unscheduled still needs an external scheduler before operators can rely on it.",
            "A 'running' row that crashed before finishing is flagged 'Stuck' after 30 minutes, but is never auto-corrected — that's a real signal something needs manual attention.",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><DatabaseOutlined style={{ color: "#722ed1", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
      </Row>

      <Alert closable type="info" showIcon style={{ marginTop: 16 }} icon={<InfoCircleOutlined />}
        message={uiText("admin_ui.en_requires_migration_7_55_35c95")} description={uiText("admin_ui.en_run_history_is_read_from_bms_job_runs_ddd3f")} />
    </div>
  );
}
