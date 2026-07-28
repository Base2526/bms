'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  Popconfirm,
} from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  SafetyOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import styles from "./page.module.css";

const { Text, Paragraph } = Typography;

const Q_QUALITY = gql`
  query AiQuality($days: Int!, $status: String, $source: String, $outcome: String) {
    bmsAiQualityMetrics(days: $days) {
      days totalTurns successCount clarificationCount handoffCount unresolvedCount
      successRate handoffRate unresolvedRate pendingReviews reviewedCount humanFailCount
      daily { day totalTurns successCount handoffCount unresolvedCount }
    }
    bmsAiQualityCases(
      days: $days
      status: $status
      source: $source
      outcome: $outcome
      limit: 100
    ) {
      id conversationId messageId channel conversationStatus source signalOutcome
      reasonCodes severity status verdict category customerPreview aiPreview
      reviewerName reviewedAt createdAt updatedAt
    }
  }
`;

const Q_CASE = gql`
  query AiQualityCase($id: ID!) {
    bmsAiQualityCase(id: $id) {
      id conversationId messageId channel conversationStatus source signalOutcome
      reasonCodes severity status verdict category customerPreview aiPreview
      reviewerNote reviewerName reviewedAt createdAt updatedAt
      messages { id direction sender body createdAt }
    }
  }
`;

const M_REVIEW = gql`
  mutation ReviewAiQualityCase($id: ID!, $verdict: String!, $category: String!, $note: String) {
    bmsReviewAiQualityCase(id: $id, verdict: $verdict, category: $category, note: $note) {
      id status verdict category reviewerNote reviewerName reviewedAt
    }
  }
`;

const M_DISMISS = gql`
  mutation DismissAiQualityCase($id: ID!) {
    bmsDismissAiQualityCase(id: $id) { id status reviewerName reviewedAt }
  }
`;

const OUTCOME_LABEL: Record<string, string> = {
  SUCCESS: "สำเร็จ",
  CLARIFICATION: "ถามเพิ่ม",
  HANDOFF: "ส่งต่อคน",
  UNRESOLVED: "ยังไม่จบ",
  FAILURE: "ผิดพลาด",
};
const OUTCOME_COLOR: Record<string, string> = {
  SUCCESS: "green",
  CLARIFICATION: "blue",
  HANDOFF: "gold",
  UNRESOLVED: "orange",
  FAILURE: "red",
};
const REASON_LABEL: Record<string, string> = {
  FORCED_HANDOFF: "บังคับส่งต่อ",
  TOOL_ERROR: "Tool error",
  SAFE_GUARD_OR_RETRY: "ตอบแบบ safe/retry",
  ASKED_CLARIFICATION: "ถามข้อมูลเพิ่ม",
  ORDER_CREATED: "สร้างออเดอร์",
  VERIFIED_TOOL_RESULT: "มีข้อมูลจาก tool",
  DETERMINISTIC_REPLY: "คำตอบ deterministic",
  ANSWERED: "ตอบแล้ว",
};
const CATEGORY_OPTIONS = [
  ["CORRECT", "ถูกต้อง"],
  ["HALLUCINATION", "แต่งข้อมูล / Hallucination"],
  ["WRONG_TOOL", "เลือก tool ผิด"],
  ["TOOL_ERROR", "Tool ทำงานผิดพลาด"],
  ["MISUNDERSTOOD", "เข้าใจลูกค้าผิด"],
  ["BAD_HANDOFF", "ส่งต่อไม่เหมาะสม"],
  ["POLICY", "ผิด policy / ความปลอดภัย"],
  ["TONE", "ภาษาและน้ำเสียง"],
  ["OTHER", "อื่น ๆ"],
].map(([value, label]) => ({ value, label }));

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function OutcomeTag({ value }: { value: string }) {
  return <Tag color={OUTCOME_COLOR[value] || "default"}>{OUTCOME_LABEL[value] || value}</Tag>;
}

function MetricCard({
  title,
  value,
  suffix,
  color,
  note,
  icon,
}: {
  title: string;
  value: number;
  suffix?: string;
  color: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className={styles.metricCard}>
      <Statistic
        title={title}
        value={value}
        suffix={suffix}
        prefix={icon}
        valueStyle={{ color }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>
    </Card>
  );
}

export default function AiQualityPage() {
  const isMobile = useIsMobile();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canView = can("ai_quality.view");
  const canReview = can("ai_quality.review");
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState<string | undefined>("PENDING");
  const [source, setSource] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<string | undefined>();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const variables = { days, status, source, outcome };
  const { data, loading, error, refetch } = useQuery(Q_QUALITY, {
    variables,
    skip: !canView,
    fetchPolicy: "cache-and-network",
  });
  const {
    data: detailData,
    loading: detailLoading,
    refetch: refetchDetail,
  } = useQuery(Q_CASE, {
    variables: { id: activeId },
    skip: !activeId || !canView,
    fetchPolicy: "cache-and-network",
  });
  const [review, { loading: reviewing }] = useMutation(M_REVIEW, {
    onCompleted: async () => {
      message.success("บันทึกผล QA แล้ว");
      form.resetFields();
      await Promise.all([refetch(), refetchDetail()]);
    },
    onError: (mutationError) => message.error(mutationError.message),
  });
  const [dismiss, { loading: dismissing }] = useMutation(M_DISMISS, {
    onCompleted: async () => {
      message.success("นำเคสออกจากคิวตรวจแล้ว");
      setActiveId(null);
      form.resetFields();
      await refetch();
    },
    onError: (mutationError) => message.error(mutationError.message),
  });

  if (permissionsLoading) return <Card loading />;
  if (!canView) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดู AI Quality" description="ต้องมีสิทธิ์ ai_quality.view" />;
  }
  if (error) {
    return <Alert type="error" showIcon message="โหลด AI Quality ไม่ได้" description={error.message} />;
  }

  const metrics = data?.bmsAiQualityMetrics;
  const cases = data?.bmsAiQualityCases ?? [];
  const detail = detailData?.bmsAiQualityCase;
  const daily = metrics?.daily ?? [];
  const maxDaily = Math.max(
    1,
    ...daily.map((row: any) => row.successCount + row.handoffCount + row.unresolvedCount)
  );

  const submitReview = (values: { verdict: string; category: string; note?: string }) => {
    if (!activeId) return;
    review({ variables: { id: activeId, ...values } });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>AI Quality Control</h1>
        <p className={styles.heroCopy}>
          ดูสุขภาพคำตอบจาก signal ที่ไม่เก็บ prompt, ตรวจ failure cases และสุ่มบทสนทนาปกติประมาณ 5%
          เพื่อหา blind spot ก่อนกระทบลูกค้าจำนวนมาก
        </p>
      </section>

      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <Space wrap>
          <Select
            value={days}
            onChange={setDays}
            style={{ width: 140 }}
            options={[
              { value: 7, label: "7 วันล่าสุด" },
              { value: 30, label: "30 วันล่าสุด" },
              { value: 90, label: "90 วันล่าสุด" },
            ]}
          />
          <Text type="secondary">Metrics เริ่มนับจาก AI turn ที่มี quality signal หลัง migration 7.31</Text>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <MetricCard
            title="Success rate"
            value={metrics?.successRate ?? 0}
            suffix="%"
            color="#087f6b"
            note={`${metrics?.successCount ?? 0} จาก ${metrics?.totalTurns ?? 0} AI turns`}
            icon={<CheckCircleOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="Handoff rate"
            value={metrics?.handoffRate ?? 0}
            suffix="%"
            color="#d97706"
            note={`${metrics?.handoffCount ?? 0} ครั้งที่ส่งต่อให้คน`}
            icon={<WarningOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="Unresolved rate"
            value={metrics?.unresolvedRate ?? 0}
            suffix="%"
            color="#cf3f3f"
            note={`${metrics?.unresolvedCount ?? 0} safe retry / failure`}
            icon={<ExclamationCircleOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="รอตรวจ QA"
            value={metrics?.pendingReviews ?? 0}
            color="#315c9b"
            note={`ตรวจแล้ว ${metrics?.reviewedCount ?? 0} · คนยืนยันว่าพลาด ${metrics?.humanFailCount ?? 0}`}
            icon={<SafetyOutlined />}
          />
        </Col>
      </Row>

      <Card
        title="แนวโน้มรายวัน"
        style={{ marginTop: 16, borderRadius: 14 }}
        extra={
          <Space size={12} wrap>
            <Text style={{ color: "#30a46c" }}>■ Success</Text>
            <Text style={{ color: "#f0a020" }}>■ Handoff</Text>
            <Text style={{ color: "#d84a4a" }}>■ Unresolved</Text>
          </Space>
        }
      >
        {daily.some((row: any) => row.totalTurns > 0) ? (
          <div className={styles.trend}>
            {daily.map((row: any) => {
              const title = `${row.day}: success ${row.successCount}, handoff ${row.handoffCount}, unresolved ${row.unresolvedCount}`;
              return (
                <div className={styles.trendDay} key={row.day} title={title}>
                  <div className={styles.trendUnresolved} style={{ height: `${(row.unresolvedCount / maxDaily) * 130}px` }} />
                  <div className={styles.trendHandoff} style={{ height: `${(row.handoffCount / maxDaily) * 130}px` }} />
                  <div className={styles.trendSuccess} style={{ height: `${(row.successCount / maxDaily) * 130}px` }} />
                </div>
              );
            })}
          </div>
        ) : (
          <Empty description="ยังไม่มี AI turn ที่มี quality signal ในช่วงนี้" />
        )}
      </Card>

      <Card
        title="Review queue"
        style={{ marginTop: 16, borderRadius: 14 }}
        extra={<Text type="secondary">{cases.length} เคส</Text>}
      >
        <Space wrap style={{ marginBottom: 14 }}>
          <Select
            allowClear
            placeholder="สถานะ review"
            value={status}
            onChange={setStatus}
            style={{ width: 160 }}
            options={[
              { value: "PENDING", label: "รอตรวจ" },
              { value: "REVIEWED", label: "ตรวจแล้ว" },
              { value: "DISMISSED", label: "ไม่นำมาตรวจ" },
            ]}
          />
          <Select
            allowClear
            placeholder="แหล่งเคส"
            value={source}
            onChange={setSource}
            style={{ width: 180 }}
            options={[
              { value: "AUTO_FAILURE", label: "Failure cases" },
              { value: "AUTO_SAMPLE", label: "Sampled QA (5%)" },
            ]}
          />
          <Select
            allowClear
            placeholder="ผลจากระบบ"
            value={outcome}
            onChange={setOutcome}
            style={{ width: 170 }}
            options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={cases}
          scroll={{ x: 1040 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(row: any) => ({ onClick: () => setActiveId(row.id), style: { cursor: "pointer" } })}
          columns={[
            {
              title: "เวลา",
              dataIndex: "createdAt",
              width: 160,
              render: fmt,
            },
            {
              title: "Signal",
              dataIndex: "signalOutcome",
              width: 130,
              render: (value: string, row: any) => (
                <Space direction="vertical" size={3}>
                  <OutcomeTag value={value} />
                  <Text type="secondary" style={{ fontSize: 11 }}>{row.source === "AUTO_SAMPLE" ? "sample" : row.severity}</Text>
                </Space>
              ),
            },
            {
              title: "Customer",
              dataIndex: "customerPreview",
              render: (value: string) => <span className={styles.preview}>{value || "—"}</span>,
            },
            {
              title: "AI reply",
              dataIndex: "aiPreview",
              render: (value: string) => <span className={styles.preview}>{value || "—"}</span>,
            },
            {
              title: "Review",
              dataIndex: "status",
              width: 140,
              render: (value: string, row: any) =>
                value === "REVIEWED"
                  ? <Tag color={row.verdict === "FAIL" ? "red" : row.verdict === "PASS" ? "green" : "blue"}>{row.verdict}</Tag>
                  : <Tag>{value}</Tag>,
            },
            {
              title: "",
              width: 70,
              fixed: "right",
              render: (_: unknown, row: any) => (
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  aria-label="เปิดเคส"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveId(row.id);
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={Boolean(activeId)}
        onClose={() => {
          setActiveId(null);
          form.resetFields();
        }}
        width={isMobile ? "100%" : 680}
        title="ตรวจ AI response"
        destroyOnClose
      >
        {detailLoading || !detail ? (
          <Card loading />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="ข้อความในหน้านี้ถูก redact อีเมล เบอร์โทร URL และรหัสยาวแล้ว"
            />
            <Descriptions size="small" column={isMobile ? 1 : 2} bordered>
              <Descriptions.Item label="Signal"><OutcomeTag value={detail.signalOutcome} /></Descriptions.Item>
              <Descriptions.Item label="Channel"><Tag>{detail.channel}</Tag></Descriptions.Item>
              <Descriptions.Item label="เหตุผล" span={2}>
                <Space wrap>
                  {(detail.reasonCodes || []).map((reason: string) => (
                    <Tag key={reason}>{REASON_LABEL[reason] || reason}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Review">{detail.verdict || "รอตรวจ"}</Descriptions.Item>
              <Descriptions.Item label="ผู้ตรวจ">{detail.reviewerName || "—"}</Descriptions.Item>
            </Descriptions>

            <div>
              <Text strong>Context รอบ AI turn</Text>
              <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 10 }}>
                {(detail.messages || []).map((item: any) => (
                  <div
                    key={item.id}
                    className={item.direction === "IN" ? styles.messageCustomer : styles.messageAi}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {item.direction === "IN" ? "Customer" : item.sender === "ai" ? "AI" : item.sender || "Staff"} · {fmt(item.createdAt)}
                    </Text>
                    <div>{item.body}</div>
                  </div>
                ))}
              </Space>
            </div>

            <Link href={`/admin/inbox?c=${detail.conversationId}`}>
              <Button>เปิดบทสนทนาใน Inbox</Button>
            </Link>

            {canReview ? (
              <Card size="small" title={detail.status === "REVIEWED" ? "แก้ผลตรวจ" : "ผลตรวจของมนุษย์"}>
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={submitReview}
                  onValuesChange={(changed) => {
                    if (changed.verdict === "PASS") form.setFieldValue("category", "CORRECT");
                    if (changed.verdict === "FAIL" && form.getFieldValue("category") === "CORRECT") {
                      form.setFieldValue("category", undefined);
                    }
                  }}
                  initialValues={{
                    verdict: detail.verdict || undefined,
                    category: detail.category || undefined,
                    note: detail.reviewerNote || "",
                  }}
                >
                  <Row gutter={12}>
                    <Col xs={24} sm={10}>
                      <Form.Item name="verdict" label="AI ตอบได้ไหม" rules={[{ required: true, message: "เลือกผลตรวจ" }]}>
                        <Select options={[
                          { value: "PASS", label: "PASS — ใช้ได้" },
                          { value: "FAIL", label: "FAIL — ต้องแก้" },
                          { value: "UNCLEAR", label: "UNCLEAR — ยังตัดสินไม่ได้" },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={14}>
                      <Form.Item name="category" label="หมวด" rules={[{ required: true, message: "เลือกหมวด" }]}>
                        <Select options={CATEGORY_OPTIONS} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="note" label="หมายเหตุสำหรับทีม (ไม่บังคับ)">
                    <Input.TextArea rows={3} maxLength={1000} showCount placeholder="ระบุสิ่งที่ควรแก้ใน prompt / tool / rule" />
                  </Form.Item>
                  <Space wrap>
                    <Button type="primary" htmlType="submit" loading={reviewing}>บันทึกผล QA</Button>
                    <Popconfirm
                      title="นำเคสนี้ออกจากคิวตรวจ?"
                      description="ใช้เมื่อเป็น sample ที่ไม่เหมาะสำหรับ QA และเปิดดูย้อนหลังได้จาก filter DISMISSED"
                      okText="Dismiss"
                      cancelText="ยกเลิก"
                      onConfirm={() => activeId && dismiss({ variables: { id: activeId } })}
                    >
                      <Button loading={dismissing}>Dismiss</Button>
                    </Popconfirm>
                  </Space>
                </Form>
              </Card>
            ) : (
              <Alert type="warning" showIcon message="ดูเคสได้ แต่ไม่มีสิทธิ์ ai_quality.review" />
            )}

            {detail.reviewerNote && (
              <Paragraph type="secondary">หมายเหตุเดิม: {detail.reviewerNote}</Paragraph>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
