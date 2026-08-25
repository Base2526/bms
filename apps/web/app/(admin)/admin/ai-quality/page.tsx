'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { useI18n } from "@/lib/i18nContext";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
  Popconfirm,
} from "antd";
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SafetyOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import styles from "./page.module.css";

const { Text, Paragraph } = Typography;
const { CheckableTag } = Tag;

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
// severity stripe on the queue row — state has to read at a glance, not only as text
const OUTCOME_STRIPE: Record<string, string> = {
  SUCCESS: styles.stripeSuccess,
  CLARIFICATION: styles.stripeNeutral,
  HANDOFF: styles.stripeHandoff,
  UNRESOLVED: styles.stripeFail,
  FAILURE: styles.stripeFail,
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

/**
 * Category as chips, not a dropdown: picking a reason used to cost two clicks
 * inside a Select. Form.Item passes value/onChange down, so this stays a plain
 * controlled field.
 */
function CategoryChips({
  value,
  onChange,
  options,
}: {
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Space wrap size={[6, 6]}>
      {options.map((option) => (
        <CheckableTag
          key={option.value}
          checked={value === option.value}
          onChange={() => onChange?.(option.value)}
        >
          {option.label}
        </CheckableTag>
      ))}
    </Space>
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
  const queueRef = useRef<HTMLDivElement | null>(null);

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

  const metrics = data?.bmsAiQualityMetrics;
  const cases = useMemo(() => data?.bmsAiQualityCases ?? [], [data]);
  const detail = detailData?.bmsAiQualityCase;
  const daily = metrics?.daily ?? [];
  const maxDaily = Math.max(
    1,
    ...daily.map((row: any) => row.successCount + row.handoffCount + row.unresolvedCount)
  );

  const activeIndex = cases.findIndex((row: any) => row.id === activeId);
  const remaining = activeIndex >= 0 ? cases.length - activeIndex - 1 : cases.length;

  /** move to the case after the one just judged, so the queue keeps flowing */
  const goToNext = useCallback(() => {
    if (activeIndex < 0) return;
    const next = cases[activeIndex + 1];
    setActiveId(next ? next.id : null);
  }, [activeIndex, cases]);

  const [review, { loading: reviewing }] = useMutation(M_REVIEW, {
    onCompleted: async () => {
      message.success(t("admin_ai_quality.review_saved"));
      goToNext();
      await Promise.all([refetch(), refetchDetail()]);
    },
    onError: (mutationError) => message.error(mutationError.message),
  });
  const [dismiss, { loading: dismissing }] = useMutation(M_DISMISS, {
    onCompleted: async () => {
      message.success(t("admin_ai_quality.dismissed"));
      goToNext();
      await refetch();
    },
    onError: (mutationError) => message.error(mutationError.message),
  });

  // on a wide screen the first case opens itself — an empty right pane next to a
  // full queue is a click everyone has to make anyway
  useEffect(() => {
    if (isMobile || activeId || cases.length === 0) return;
    setActiveId(cases[0].id);
  }, [isMobile, activeId, cases]);

  // the form lives next to the queue now instead of inside a destroyed drawer,
  // so it has to be refilled whenever the open case changes
  useEffect(() => {
    if (!detail) return;
    form.setFieldsValue({
      verdict: detail.verdict || undefined,
      category: detail.category || undefined,
      note: detail.reviewerNote || "",
    });
  }, [detail, form]);

  const moveSelection = useCallback(
    (step: number) => {
      if (cases.length === 0) return;
      const nextIndex = Math.min(cases.length - 1, Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + step));
      setActiveId(cases[nextIndex].id);
    },
    [activeIndex, cases]
  );

  const submitReview = (values: { verdict: string; category: string; note?: string }) => {
    if (!activeId) return;
    review({ variables: { id: activeId, ...values } });
  };

  // J/K to walk the queue, P/F/U to judge, Enter to save — seven cases without
  // reaching for the mouse. Dismiss stays mouse-only: it needs its confirmation.
  useEffect(() => {
    if (!canView) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (!canReview || !detail) return;
      const verdict = key === "p" ? "PASS" : key === "f" ? "FAIL" : key === "u" ? "UNCLEAR" : null;
      if (verdict) {
        event.preventDefault();
        form.setFieldValue("verdict", verdict);
        if (verdict === "PASS") form.setFieldValue("category", "CORRECT");
        return;
      }
      // Enter on a focused button belongs to that button (Dismiss, Open in Inbox,
      // the queue row that still holds focus after a click) — not to the form
      if (event.key === "Enter" && target?.tagName !== "BUTTON" && target?.tagName !== "A") {
        event.preventDefault();
        form.submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canView, canReview, detail, form, moveSelection]);

  if (permissionsLoading) return <Card loading />;
  if (!canView) {
    return <Alert closable type="error" showIcon message={t("admin_ai_quality.no_permission")} description={t("admin_ai_quality.no_permission_desc")} />;
  }
  if (error) {
    return <Alert closable type="error" showIcon message={t("admin_ai_quality.load_error")} description={error.message} />;
  }

  const queue = (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("admin_ai_quality.queue_title")}</h2>
        <Text type="secondary" style={{ fontSize: 12 }}>{t("admin_ai_quality.cases_count", { count: cases.length })}</Text>
        <span className={styles.barSpacer} />
        <span className={styles.hint}>
          <span className={styles.key}>J</span> <span className={styles.key}>K</span> {t("admin_ai_quality.shortcut_move")}
        </span>
      </div>

      <div className={styles.filters}>
        <Select
          allowClear
          size="small"
          placeholder={t("admin_ai_quality.filter_review_status")}
          value={status}
          onChange={setStatus}
          style={{ width: 150 }}
          options={[
            { value: "PENDING", label: t("admin_ai_quality.status_pending") },
            { value: "REVIEWED", label: t("admin_ai_quality.status_reviewed") },
            { value: "DISMISSED", label: t("admin_ai_quality.status_dismissed") },
          ]}
        />
        <Select
          allowClear
          size="small"
          placeholder={t("admin_ai_quality.filter_source")}
          value={source}
          onChange={setSource}
          style={{ width: 165 }}
          options={[
            { value: "AUTO_FAILURE", label: "Failure cases" },
            { value: "AUTO_SAMPLE", label: "Sampled QA (5%)" },
          ]}
        />
        <Select
          allowClear
          size="small"
          placeholder={t("admin_ai_quality.filter_outcome")}
          value={outcome}
          onChange={setOutcome}
          style={{ width: 155 }}
          options={OUTCOME_KEYS.map((value) => ({ value, label: t(`admin_ai_quality.${OUTCOME_LABEL_KEY[value]}`) }))}
        />
      </div>

      <div className={styles.queue} ref={queueRef}>
        {loading && cases.length === 0 ? (
          <div className={styles.empty}><Card loading style={{ width: "100%", border: 0 }} /></div>
        ) : cases.length === 0 ? (
          <div className={styles.empty}><Empty description={t("admin_ai_quality.queue_empty")} /></div>
        ) : (
          cases.map((row: any) => (
            <button
              type="button"
              key={row.id}
              className={`${styles.row} ${row.id === activeId ? styles.rowActive : ""}`}
              aria-current={row.id === activeId}
              aria-label={t("admin_ai_quality.open_case")}
              onClick={() => setActiveId(row.id)}
            >
              <span className={`${styles.stripe} ${OUTCOME_STRIPE[row.signalOutcome] || styles.stripeNeutral}`} />
              <span className={styles.rowBody}>
                <span className={styles.rowTop}>
                  <OutcomeTag value={row.signalOutcome} />
                  <Tag>{row.channel}</Tag>
                  <Tag>{row.source === "AUTO_SAMPLE" ? "sample" : row.severity}</Tag>
                  {row.status === "REVIEWED" ? (
                    <Tag color={row.verdict === "FAIL" ? "red" : row.verdict === "PASS" ? "green" : "blue"}>{row.verdict}</Tag>
                  ) : null}
                </span>
                <p className={styles.rowText}>{row.customerPreview || "—"}</p>
                <span className={styles.rowMeta}>
                  <span>{fmt(row.createdAt)}</span>
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  const caseBody = !activeId ? (
    <div className={styles.empty}>
      <Empty description={t("admin_ai_quality.case_empty")} />
    </div>
  ) : detailLoading || !detail ? (
    <Card loading />
  ) : (
    <>
      <div className={styles.caseHead}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <span className={styles.caseId}>{fmt(detail.createdAt)}</span>
          <div className={styles.caseFacts}>
            <OutcomeTag value={detail.signalOutcome} />
            <Tag>{detail.channel}</Tag>
            {(detail.reasonCodes || []).map((reason: string) => (
              <Tag key={reason}>{REASON_LABEL_KEY[reason] ? t(`admin_ai_quality.${REASON_LABEL_KEY[reason]}`) : reason}</Tag>
            ))}
            <Tag>{detail.severity}</Tag>
          </div>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("admin_ai_quality.label_reviewer")}: {detail.reviewerName || "—"} · {detail.verdict || t("admin_ai_quality.awaiting_review")}
            </Text>
          </div>
        </div>
        <Link href={`/admin/inbox?c=${detail.conversationId}`}>
          <Button size="small">{t("admin_ai_quality.open_in_inbox")}</Button>
        </Link>
      </div>

      <div style={{ padding: "10px 16px 0" }}>
        <Alert closable type="info" showIcon message={t("admin_ai_quality.redact_notice")} style={{ fontSize: 12 }} />
      </div>

      <div className={styles.thread}>
        {(detail.messages || []).map((item: any) => {
          const flagged = item.id === detail.messageId;
          return (
            <div
              key={item.id}
              className={`${item.direction === "IN" ? styles.messageCustomer : styles.messageAi} ${flagged ? styles.messageFlagged : ""}`}
            >
              <Text type="secondary" style={{ fontSize: 11 }}>
                {item.direction === "IN" ? "Customer" : item.sender === "ai" ? "AI" : item.sender || "Staff"} · {fmt(item.createdAt)}
              </Text>
              <div>{item.body}</div>
            </div>
          );
        })}
        {(detail.messages || []).some((item: any) => item.id === detail.messageId) ? (
          <span className={styles.flagNote}>{t("admin_ai_quality.flagged_turn")}</span>
        ) : null}
      </div>

      {canReview ? (
        <Form
          form={form}
          className={styles.verdict}
          layout="vertical"
          onFinish={submitReview}
          onValuesChange={(changed) => {
            if (changed.verdict === "PASS") form.setFieldValue("category", "CORRECT");
            if (changed.verdict === "FAIL" && form.getFieldValue("category") === "CORRECT") {
              form.setFieldValue("category", undefined);
            }
          }}
        >
          <Text strong style={{ fontSize: 13 }}>
            {detail.status === "REVIEWED" ? t("admin_ai_quality.edit_review_title") : t("admin_ai_quality.human_review_title")}
          </Text>

          <Form.Item
            name="verdict"
            label={<span className={styles.verdictLabel}>{t("admin_ai_quality.form_verdict")}</span>}
            rules={[{ required: true, message: t("admin_ai_quality.form_verdict_required") }]}
            style={{ marginBottom: 0 }}
          >
            <Segmented
              options={[
                { value: "PASS", label: `${t("admin_ai_quality.verdict_pass")}  (P)` },
                { value: "FAIL", label: `${t("admin_ai_quality.verdict_fail")}  (F)` },
                { value: "UNCLEAR", label: `${t("admin_ai_quality.verdict_unclear")}  (U)` },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="category"
            label={<span className={styles.verdictLabel}>{t("admin_ai_quality.form_category")}</span>}
            rules={[{ required: true, message: t("admin_ai_quality.form_category_required") }]}
            style={{ marginBottom: 0 }}
          >
            <CategoryChips options={CATEGORY_KEYS.map(([value, k]) => ({ value, label: t(`admin_ai_quality.${k}`) }))} />
          </Form.Item>

          <Form.Item
            name="note"
            label={<span className={styles.verdictLabel}>{t("admin_ai_quality.form_note")}</span>}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={2} maxLength={1000} showCount placeholder={t("admin_ai_quality.form_note_placeholder")} />
          </Form.Item>

          <Space wrap>
            <Button type="primary" htmlType="submit" loading={reviewing}>
              {t("admin_ai_quality.btn_save_qa")}
            </Button>
            <Popconfirm
              title={t("admin_ai_quality.dismiss_confirm_title")}
              description={t("admin_ai_quality.dismiss_confirm_desc")}
              okText="Dismiss"
              cancelText={t("admin_ai_quality.cancel")}
              onConfirm={() => activeId && dismiss({ variables: { id: activeId } })}
            >
              <Button loading={dismissing}>Dismiss</Button>
            </Popconfirm>
            <span className={styles.hint}>{t("admin_ai_quality.save_and_next", { count: remaining })}</span>
          </Space>
        </Form>
      ) : (
        <div className={styles.verdict}>
          <Alert closable type="warning" showIcon message={t("admin_ai_quality.no_review_permission")} />
        </div>
      )}

      {detail.reviewerNote && (
        <Paragraph type="secondary" style={{ padding: "10px 16px", margin: 0 }}>
          {t("admin_ai_quality.previous_note", { note: detail.reviewerNote })}
        </Paragraph>
      )}
    </>
  );

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div>
          <h1 className={styles.barTitle}>AI Quality Control</h1>
          <p className={styles.barCopy}>{t("admin_ai_quality.hero_copy")}</p>
        </div>
        <span className={styles.barSpacer} />
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
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </div>

      <div className={styles.rail}>
        <div className={`${styles.cell} ${styles.cellLead}`}>
          <span className={styles.cellKey}><SafetyOutlined /> {t("admin_ai_quality.pending_qa_title")}</span>
          <span className={`${styles.cellValue} ${styles.valueLead}`}>{metrics?.pendingReviews ?? 0}</span>
          <span className={styles.cellNote}>
            {t("admin_ai_quality.pending_qa_note", { reviewed: metrics?.reviewedCount ?? 0, failed: metrics?.humanFailCount ?? 0 })}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellKey}><CheckCircleOutlined /> Success rate</span>
          <span className={`${styles.cellValue} ${styles.valuePass}`}>{metrics?.successRate ?? 0}%</span>
          <span className={styles.cellNote}>
            {t("admin_ai_quality.success_note", { count: metrics?.successCount ?? 0, total: metrics?.totalTurns ?? 0 })}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellKey}><WarningOutlined /> Handoff rate</span>
          <span className={`${styles.cellValue} ${styles.valueHandoff}`}>{metrics?.handoffRate ?? 0}%</span>
          <span className={styles.cellNote}>{t("admin_ai_quality.handoff_note", { count: metrics?.handoffCount ?? 0 })}</span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellKey}><ExclamationCircleOutlined /> Unresolved rate</span>
          <span className={`${styles.cellValue} ${styles.valueFail}`}>{metrics?.unresolvedRate ?? 0}%</span>
          <span className={styles.cellNote}>{t("admin_ai_quality.unresolved_note", { count: metrics?.unresolvedCount ?? 0 })}</span>
        </div>
        <div className={styles.cell}>
          <span className={styles.cellKey}>{t("admin_ai_quality.daily_trend_title")}</span>
          {daily.some((row: any) => row.totalTurns > 0) ? (
            <>
              <div className={styles.spark}>
                {daily.map((row: any) => (
                  <div
                    className={styles.sparkDay}
                    key={row.day}
                    title={`${row.day}: success ${row.successCount}, handoff ${row.handoffCount}, unresolved ${row.unresolvedCount}`}
                  >
                    <div className={styles.trendUnresolved} style={{ height: `${(row.unresolvedCount / maxDaily) * 44}px` }} />
                    <div className={styles.trendHandoff} style={{ height: `${(row.handoffCount / maxDaily) * 44}px` }} />
                    <div className={styles.trendSuccess} style={{ height: `${(row.successCount / maxDaily) * 44}px` }} />
                  </div>
                ))}
              </div>
              <div className={styles.legend}>
                <span style={{ color: "#30a46c" }}>■ Success</span>
                <span style={{ color: "#f0a020" }}>■ Handoff</span>
                <span style={{ color: "#d84a4a" }}>■ Unresolved</span>
              </div>
            </>
          ) : (
            <span className={styles.cellNote}>{t("admin_ai_quality.trend_empty")}</span>
          )}
        </div>
      </div>

      {isMobile ? (
        <>
          {queue}
          <Drawer
            open={Boolean(activeId)}
            onClose={() => setActiveId(null)}
            width="100%"
            title={t("admin_ai_quality.drawer_title")}
            destroyOnClose
          >
            {caseBody}
          </Drawer>
        </>
      ) : (
        <div className={styles.work}>
          {queue}
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{t("admin_ai_quality.drawer_title")}</h2>
              <span className={styles.barSpacer} />
              <span className={styles.hint}>{t("admin_ai_quality.context_title")}</span>
            </div>
            {caseBody}
          </div>
        </div>
      )}
    </div>
  );
}
