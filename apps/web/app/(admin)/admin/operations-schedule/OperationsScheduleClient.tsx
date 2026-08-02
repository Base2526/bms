"use client";

import {
  Alert, Card, Col, Divider, List, Row, Space, Table, Tag, Typography,
} from "antd";
import {
  ApiOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DatabaseOutlined, ExclamationCircleOutlined, GithubOutlined, InfoCircleOutlined,
} from "@ant-design/icons";
import type { OperationScheduleRow } from "@/lib/bms/operationsSchedule";

const { Paragraph, Text, Title } = Typography;

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

const columns = [
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
  { title: "Trigger", dataIndex: "trigger", key: "trigger", width: 260, render: (value: string) => <Text code>{value}</Text> },
  { title: "Purpose", dataIndex: "purpose", key: "purpose", render: (value: string) => <Text>{value}</Text> },
];

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

export default function OperationsScheduleClient({ rows }: { rows: OperationScheduleRow[] }) {
  const scheduledCount = rows.filter((row) => row.status === "Scheduled").length;
  const unscheduledCount = rows.length - scheduledCount;

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Title level={2} style={{ margin: 0 }}><CalendarOutlined /> Batch & Cron Overview</Title>
          <Text type="secondary">Overview of scheduled jobs and cron-ready endpoints.</Text>
        </div>
      </Space>

      <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Evidence-first view"
        description="The page inspects workflow and route source files when they are deployed, then safely falls back to the verified operations registry when source files are unavailable." />

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
            "Real 'last run' should appear only after we wire an actual execution source.",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><InfoCircleOutlined style={{ color: "#1677ff", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
        <Col xs={24} xl={10}><Card title="Next Data We Should Add"><List
          dataSource={[
            "Actual last run timestamp", "Latest result: success, failed, unknown",
            "Runtime owner: GitHub, system cron, Cloud Scheduler, or manual", "Linked source file or endpoint",
          ]}
          renderItem={(item) => <List.Item><Space align="start"><DatabaseOutlined style={{ color: "#722ed1", marginTop: 4 }} /><Text>{item}</Text></Space></List.Item>}
        /></Card></Col>
      </Row>

      <Alert type="warning" showIcon style={{ marginTop: 16 }} icon={<ExclamationCircleOutlined />}
        message="Important" description="For this mockup, 'last run' is intentionally omitted. We do not yet have a trustworthy run-history source for every batch path, and showing guessed timestamps would be misleading." />
    </div>
  );
}
