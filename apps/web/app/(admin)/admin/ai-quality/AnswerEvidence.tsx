'use client';

import { gql, useQuery } from "@apollo/client";
import { Alert, Card, Collapse, Empty, Input, Space, Spin, Tag, Typography } from "antd";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";

const QUERY = gql`query AnswerEvidence($messageId: ID!) { bmsAiAnswerEvidence(messageId: $messageId) }`;
const COVERAGE = gql`query AnswerEvidenceCoverage($days: Int!) { bmsAiAnswerEvidenceCoverage(days: $days) }`;
const jsonStyle = { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const, maxHeight: 280, overflow: "auto", fontSize: 12 };

export function AnswerEvidence({ messageId }: { messageId: string }) {
  const { t } = useI18n();
  const { data, loading, error } = useQuery(QUERY, { variables: { messageId }, fetchPolicy: "network-only" });
  const evidence = data?.bmsAiAnswerEvidence;
  if (loading) return <Spin />;
  if (error) return <Alert closable type="error" message={t("admin_ai_quality.evidence_error")} />;
  if (!evidence) return <Empty description={t("admin_ai_quality.evidence_not_found")} />;
  return <Card size="small" title={`${t("admin_ai_quality.evidence_title")} · #${messageId}`} style={{ minWidth: 0 }}>
    <Space wrap>
      <Tag color={evidence.status === "COMPLETE" ? "green" : evidence.status === "FAILED" ? "red" : "gold"}>
        {t(`admin_ai_quality.evidence_${String(evidence.status).toLowerCase()}`)}
      </Tag>
      <Typography.Text type="secondary">{evidence.turn?.origin ?? "—"}</Typography.Text>
    </Space>
    <Typography.Paragraph type="secondary">{t("admin_ai_quality.evidence_notice")}</Typography.Paragraph>
    {evidence.replyMatches === false && <Alert closable type="warning" message={t("admin_ai_quality.evidence_mismatch")} />}
    <Typography.Text strong>{t("admin_ai_quality.evidence_question")} · #{evidence.inputMessageId ?? "—"}</Typography.Text>
    <pre style={jsonStyle}>{evidence.question || t("admin_ai_quality.evidence_no_pair")}</pre>
    <Typography.Text strong>{t("admin_ai_quality.evidence_reply")}</Typography.Text>
    <pre style={jsonStyle}>{evidence.reply}</pre>
    <Typography.Paragraph type="secondary">
      {t("admin_ai_quality.evidence_calls", { captured: evidence.turn?.captured_calls ?? 0, attempted: evidence.turn?.attempted_calls ?? 0 })}
      {" · "}{t("admin_ai_quality.evidence_delivery_unknown")}
    </Typography.Paragraph>
    {evidence.reasons?.length > 0 && <pre style={jsonStyle}>{evidence.reasons.join("\n")}</pre>}
    <Collapse items={(evidence.calls ?? []).map((call: any) => ({
      key: call.call_id,
      label: `${call.sequence}. ${call.tool} · ${call.outcome}`,
      children: <>
        <Typography.Paragraph type="secondary">{call.source} · v{call.projection_version}<br />{call.started_at} → {call.finished_at}</Typography.Paragraph>
        <Typography.Text strong>{t("admin_ai_quality.evidence_input")}</Typography.Text>
        <pre style={jsonStyle}>{JSON.stringify(call.safe_input, null, 2)}</pre>
        <Typography.Text strong>{t("admin_ai_quality.evidence_output")}</Typography.Text>
        <pre style={jsonStyle}>{JSON.stringify(call.safe_output, null, 2)}</pre>
        <pre style={jsonStyle}>{call.reasons?.join("\n")}</pre>
        {call.omissions && <pre style={jsonStyle}>{JSON.stringify({ payloadBytes: call.payload_bytes, omissions: call.omissions }, null, 2)}</pre>}
      </>,
    }))} />
  </Card>;
}

export function AnswerEvidenceSearch({ days }: { days: number }) {
  const { t } = useI18n();
  const [messageId, setMessageId] = useState("");
  const { data, error } = useQuery(COVERAGE, { variables: { days }, fetchPolicy: "cache-and-network" });
  const coverage = data?.bmsAiAnswerEvidenceCoverage;
  return <Card size="small" style={{ marginBottom: 16 }} title={t("admin_ai_quality.evidence_title")}>
    <Typography.Paragraph>{t("admin_ai_quality.evidence_coverage_notice")}</Typography.Paragraph>
    {error && <Alert closable type="error" message={t("admin_ai_quality.evidence_error")} />}
    {coverage && <Space wrap style={{ marginBottom: 12 }}>
      <Tag>{t("admin_ai_quality.evidence_total")}: {coverage.total}</Tag>
      {["complete", "partial", "failed", "not_captured"].map(status =>
        <Tag key={status}>{t(`admin_ai_quality.evidence_${status}`)}: {coverage[status]}</Tag>)}
    </Space>}
    <Input.Search aria-label={t("admin_ai_quality.evidence_search")} placeholder={t("admin_ai_quality.evidence_search")}
      enterButton={t("admin_ai_quality.evidence_open")} maxLength={19}
      onSearch={value => setMessageId(/^[1-9]\d{0,18}$/.test(value.trim()) ? value.trim() : "")} />
    {messageId && <div style={{ marginTop: 12 }}><AnswerEvidence key={messageId} messageId={messageId} /></div>}
  </Card>;
}
