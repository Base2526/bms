'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Checkbox, Form, Input, Modal, Select, Spin, Table, Typography, Button } from "antd";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";

const PREVIEW = gql`query CustomerMergePreview($keepId: ID!, $mergeId: ID!) {
  bmsCustomerMergePreview(keepId: $keepId, mergeId: $mergeId) {
    previewToken expiresAt
    keep { id name phoneHint memberNo channels orders addresses conversations pharmacyCases points coupons storeCredit openDeposits depositPaid passes renewals restaurantRequests gameRequests }
    source { id name phoneHint memberNo channels orders addresses conversations pharmacyCases points coupons storeCredit openDeposits depositPaid passes renewals restaurantRequests gameRequests }
  }
}`;
const MERGE = gql`mutation ReviewedCustomerMerge($keepId: ID!, $mergeId: ID!, $review: BmsCustomerMergeReviewInput!) {
  bmsMergeCustomers(keepId: $keepId, mergeId: $mergeId, review: $review)
}`;

/** Shared by Customers, the assistant page and the global assistant drawer.
 * Render only while open, keyed by the pair, to discard old review/evidence. */
export default function CustomerMergeReviewModal({ keepId, mergeId, onCancel, onMerged }: {
  keepId: string; mergeId: string; onCancel: () => void; onMerged: () => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { data, loading, error, refetch } = useQuery(PREVIEW, {
    variables: { keepId, mergeId }, fetchPolicy: "no-cache", notifyOnNetworkStatusChange: true,
  });
  const [merge, { loading: merging }] = useMutation(MERGE);
  const preview = data?.bmsCustomerMergePreview;
  const refresh = async () => {
    setConfirmed(false);
    setFailure(null);
    try { await refetch(); } catch { /* useQuery displays the error */ }
  };
  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !preview || !confirmed || loading || merging) return;
    try {
      await merge({ variables: { keepId, mergeId, review: {
        ...values, confirmed, previewToken: preview.previewToken,
      } } });
      onMerged();
    } catch (err: any) {
      setConfirmed(false);
      setFailure(err.message);
    }
  };
  const metrics = ["orders", "addresses", "conversations", "pharmacyCases", "points", "coupons", "storeCredit",
    "openDeposits", "depositPaid", "passes", "renewals", "restaurantRequests", "gameRequests"];
  const heading = (side: "keep" | "source") => preview && <>
    <div>{t(`customer_merge.${side}`)}</div>
    <div>{preview[side].name}</div>
    <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{preview[side].id}</Typography.Text>
    <div>{preview[side].phoneHint || "—"} · {preview[side].memberNo || "—"}</div>
    <div>{preview[side].channels.join(", ") || "—"}</div>
  </>;
  return <Modal open title={t("customer_merge.title")} width={760} onCancel={merging ? undefined : onCancel}
    closable={!merging} maskClosable={!merging} keyboard={!merging} onOk={submit} confirmLoading={merging}
    okText={t("customer_merge.confirm_button")} cancelText={t("customer_merge.cancel")}
    cancelButtonProps={{ disabled: merging }} okButtonProps={{ danger: true, disabled: !confirmed || !preview || loading || !!error }}>
    <Alert closable type="warning" showIcon message={t("customer_merge.warning")} description={t("customer_merge.consequences")} />
    {(error || failure) && <Alert closable type="error" showIcon message={error?.message || failure} />}
    <Button onClick={refresh} disabled={merging || loading}>{t("customer_merge.refresh")}</Button>
    {loading ? <Spin /> : preview && <Table size="small" pagination={false} scroll={{ x: 560 }} rowKey="key" tableLayout="fixed"
      columns={[{ title: t("customer_merge.impact"), dataIndex: "label", width: 220 },
        { title: heading("keep"), dataIndex: "keep", width: 170 }, { title: heading("source"), dataIndex: "source", width: 170 }]}
      dataSource={metrics.map(key => ({ key, label: t(`customer_merge.${key}`), keep: preview.keep[key], source: preview.source[key] }))} />}
    <Form form={form} layout="vertical" disabled={merging}>
      <Form.Item name="reason" label={t("customer_merge.reason")} rules={[{ required: true }]}>
        <Select options={["DUPLICATE_CHANNELS", "DUPLICATE_ENTRY"].map(value => ({ value, label: t(`customer_merge.${value}`) }))} />
      </Form.Item>
      <Form.Item name="verificationMethod" label={t("customer_merge.verification")} rules={[{ required: true }]}>
        <Select options={["BOTH_CHANNELS", "IN_PERSON", "SUPPORT_CASE"].map(value => ({ value, label: t(`customer_merge.${value}`) }))} />
      </Form.Item>
      <Form.Item name="evidenceReference" label={t("customer_merge.evidence")} extra={t("customer_merge.evidence_hint")}
        rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9_:#./-]{2,119}$/, message: t("customer_merge.evidence_invalid") }]}>
        <Input maxLength={120} autoComplete="off" />
      </Form.Item>
    </Form>
    <Checkbox checked={confirmed} disabled={loading || merging || !preview || !!error} onChange={e => setConfirmed(e.target.checked)}>
      {t("customer_merge.attestation")}
    </Checkbox>
  </Modal>;
}
