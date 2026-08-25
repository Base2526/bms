'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { useI18n } from "@/lib/i18nContext";
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

const OUTCOME_KEYS = ["SUCCESS", "CLARIFICATION", "HANDOFF", "UNRESOLVED", "FAILURE"] as const;
const OUTCOME_LABEL_KEY: Record<string, string> = {
  SUCCESS: "outcome_success",
  CLARIFICATION: "outcome_clarification",
  HANDOFF: "outcome_handoff",
  UNRESOLVED: "outcome_unresolved",
  FAILURE: "outcome_failure",
};
const OUTCOME_COLOR: Record<string, string> = {
  SUCCESS: "green",
  CLARIFICATION: "blue",
  HANDOFF: "gold",
  UNRESOLVED: "orange",
  FAILURE: "red",
};
const REASON_LABEL_KEY: Record<string, string> = {
  FORCED_HANDOFF: "reason_forced_handoff",
  SAFE_GUARD_OR_RETRY: "reason_safe_guard_or_retry",
  ASKED_CLARIFICATION: "reason_asked_clarification",
  ORDER_CREATED: "reason_order_created",
  VERIFIED_TOOL_RESULT: "reason_verified_tool_result",
  DETERMINISTIC_REPLY: "reason_deterministic_reply",
  ANSWERED: "reason_answered",
};
// TOOL_ERROR is deliberately absent above: it renders as the literal "Tool error",
// which is already English and shared with the category list below.
const CATEGORY_KEYS: [string, string][] = [
  ["CORRECT", "cat_correct"],
  ["HALLUCINATION", "cat_hallucination"],
  ["WRONG_TOOL", "cat_wrong_tool"],
  ["TOOL_ERROR", "cat_tool_error"],
  ["MISUNDERSTOOD", "cat_misunderstood"],
  ["BAD_HANDOFF", "cat_bad_handoff"],
  ["POLICY", "cat_policy"],
  ["TONE", "cat_tone"],
  ["OTHER", "cat_other"],
];

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function OutcomeTag({ value }: { value: string }) {
  const { t } = useI18n();
  const labelKey = OUTCOME_LABEL_KEY[value];
  return <Tag color={OUTCOME_COLOR[value] || "default"}>{labelKey ? t(`admin_ai_quality.${labelKey}`) : value}</Tag>;
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
  const { t } = useI18n();
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
      message.success(t("admin_ai_quality.review_saved"));
      form.resetFields();
      await Promise.all([refetch(), refetchDetail()]);
    },
    onError: (mutationError) => message.error(mutationError.message),
  });
  const [dismiss, { loading: dismissing }] = useMutation(M_DISMISS, {
    onCompleted: async () => {
      message.success(t("admin_ai_quality.dismissed"));
      setActiveId(null);
      form.resetFields();
      await refetch();
    },
    onError: (mutationError) => message.error(mutationError.message),
  });

  if (permissionsLoading) return <Card loading />;
  if (!canView) {
    return <Alert closable type="error" showIcon message={t("admin_ai_quality.no_permission")} description={t("admin_ai_quality.no_permission_desc")} />;
  }
  if (error) {
    return <Alert closable type="error" showIcon message={t("admin_ai_quality.load_error")} description={error.message} />;
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
          {t("admin_ai_quality.hero_copy")}
        </p>
      </section>

      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <Space wrap>
          <Select
            value={days}
            onChange={setDays}
            style={{ width: 140 }}
            options={[
              { value: 7, label: t("admin_ai_quality.days_7") },
              { value: 30, label: t("admin_ai_quality.days_30") },
              { value: 90, label: t("admin_ai_quality.days_90") },
            ]}
          />
          <Text type="secondary">{t("admin_ai_quality.metrics_note")}</Text>
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
            note={t("admin_ai_quality.success_note", { count: metrics?.successCount ?? 0, total: metrics?.totalTurns ?? 0 })}
            icon={<CheckCircleOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="Handoff rate"
            value={metrics?.handoffRate ?? 0}
            suffix="%"
            color="#d97706"
            note={t("admin_ai_quality.handoff_note", { count: metrics?.handoffCount ?? 0 })}
            icon={<WarningOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title="Unresolved rate"
            value={metrics?.unresolvedRate ?? 0}
            suffix="%"
            color="#cf3f3f"
            note={t("admin_ai_quality.unresolved_note", { count: metrics?.unresolvedCount ?? 0 })}
            icon={<ExclamationCircleOutlined />}
          />
        </Col>
        <Col xs={12} lg={6}>
          <MetricCard
            title={t("admin_ai_quality.pending_qa_title")}
            value={metrics?.pendingReviews ?? 0}
            color="#315c9b"
            note={t("admin_ai_quality.pending_qa_note", { reviewed: metrics?.reviewedCount ?? 0, failed: metrics?.humanFailCount ?? 0 })}
            icon={<SafetyOutlined />}
          />
        </Col>
      </Row>

      <Card
        title={t("admin_ai_quality.daily_trend_title")}
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
          <Empty description={t("admin_ai_quality.trend_empty")} />
        )}
      </Card>

      <Card
        title="Review queue"
        style={{ marginTop: 16, borderRadius: 14 }}
        extra={<Text type="secondary">{t("admin_ai_quality.cases_count", { count: cases.length })}</Text>}
      >
        <Space wrap style={{ marginBottom: 14 }}>
          <Select
            allowClear
            placeholder={t("admin_ai_quality.filter_review_status")}
            value={status}
            onChange={setStatus}
            style={{ width: 160 }}
            options={[
              { value: "PENDING", label: t("admin_ai_quality.status_pending") },
              { value: "REVIEWED", label: t("admin_ai_quality.status_reviewed") },
              { value: "DISMISSED", label: t("admin_ai_quality.status_dismissed") },
            ]}
          />
          <Select
            allowClear
            placeholder={t("admin_ai_quality.filter_source")}
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
            placeholder={t("admin_ai_quality.filter_outcome")}
            value={outcome}
            onChange={setOutcome}
            style={{ width: 170 }}
            options={OUTCOME_KEYS.map((value) => ({ value, label: t(`admin_ai_quality.${OUTCOME_LABEL_KEY[value]}`) }))}
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
              title: t("admin_ai_quality.col_time"),
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
                  aria-label={t("admin_ai_quality.open_case")}
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
        title={t("admin_ai_quality.drawer_title")}
        destroyOnClose
      >
        {detailLoading || !detail ? (
          <Card loading />
        ) : (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert closable
              type="info"
              showIcon
              message={t("admin_ai_quality.redact_notice")}
            />
            <Descriptions size="small" column={isMobile ? 1 : 2} bordered>
              <Descriptions.Item label="Signal"><OutcomeTag value={detail.signalOutcome} /></Descriptions.Item>
              <Descriptions.Item label="Channel"><Tag>{detail.channel}</Tag></Descriptions.Item>
              <Descriptions.Item label={t("admin_ai_quality.label_reason")} span={2}>
                <Space wrap>
                  {(detail.reasonCodes || []).map((reason: string) => (
                    <Tag key={reason}>{REASON_LABEL_KEY[reason] ? t(`admin_ai_quality.${REASON_LABEL_KEY[reason]}`) : reason}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Review">{detail.verdict || t("admin_ai_quality.awaiting_review")}</Descriptions.Item>
              <Descriptions.Item label={t("admin_ai_quality.label_reviewer")}>{detail.reviewerName || "—"}</Descriptions.Item>
            </Descriptions>

            <div>
              <Text strong>{t("admin_ai_quality.context_title")}</Text>
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
              <Button>{t("admin_ai_quality.open_in_inbox")}</Button>
            </Link>

            {canReview ? (
              <Card size="small" title={detail.status === "REVIEWED" ? t("admin_ai_quality.edit_review_title") : t("admin_ai_quality.human_review_title")}>
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
                      <Form.Item name="verdict" label={t("admin_ai_quality.form_verdict")} rules={[{ required: true, message: t("admin_ai_quality.form_verdict_required") }]}>
                        <Select options={[
                          { value: "PASS", label: t("admin_ai_quality.verdict_pass") },
                          { value: "FAIL", label: t("admin_ai_quality.verdict_fail") },
                          { value: "UNCLEAR", label: t("admin_ai_quality.verdict_unclear") },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={14}>
                      <Form.Item name="category" label={t("admin_ai_quality.form_category")} rules={[{ required: true, message: t("admin_ai_quality.form_category_required") }]}>
                        <Select options={CATEGORY_KEYS.map(([value, k]) => ({ value, label: t(`admin_ai_quality.${k}`) }))} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="note" label={t("admin_ai_quality.form_note")}>
                    <Input.TextArea rows={3} maxLength={1000} showCount placeholder={t("admin_ai_quality.form_note_placeholder")} />
                  </Form.Item>
                  <Space wrap>
                    <Button type="primary" htmlType="submit" loading={reviewing}>{t("admin_ai_quality.btn_save_qa")}</Button>
                    <Popconfirm
                      title={t("admin_ai_quality.dismiss_confirm_title")}
                      description={t("admin_ai_quality.dismiss_confirm_desc")}
                      okText="Dismiss"
                      cancelText={t("admin_ai_quality.cancel")}
                      onConfirm={() => activeId && dismiss({ variables: { id: activeId } })}
                    >
                      <Button loading={dismissing}>Dismiss</Button>
                    </Popconfirm>
                  </Space>
                </Form>
              </Card>
            ) : (
              <Alert closable type="warning" showIcon message={t("admin_ai_quality.no_review_permission")} />
            )}

            {detail.reviewerNote && (
              <Paragraph type="secondary">{t("admin_ai_quality.previous_note", { note: detail.reviewerNote })}</Paragraph>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
