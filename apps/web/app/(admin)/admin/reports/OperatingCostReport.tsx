"use client";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import dayjs from "dayjs";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const REPORT = gql`query OperatingCosts($month: String!) {
  bmsOperatingCosts(month: $month) { month currency scope complete truncated unresolvedCount duplicateCount
    operatingAmount gpAmount depreciationAmount knownTotal reviewedTotal
    rows { key kind id month amount currency category reference eligible fingerprint state recognizedAmount
      review { version sourceFingerprint disposition reason duplicateKey startMonth lifeMonths residual } }
  }
}`;
const REVIEW = gql`mutation ReviewOperatingCost($input: BmsOperatingCostReviewInput!) {
  bmsReviewOperatingCost(input: $input) { version }
}`;

function CostWorksheet() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [selected, setSelected] = useState<any>(null);
  const [form] = Form.useForm();
  const disposition = Form.useWatch("disposition", form);
  const report = useQuery(REPORT, { variables: { month }, fetchPolicy: "network-only", notifyOnNetworkStatusChange: true });
  const [save, saving] = useMutation(REVIEW);
  const data = report.data?.bmsOperatingCosts;
  const amount = (value: number | null | undefined) => value == null ? t("admin_reports.cost_unknown") : `฿${value.toFixed(2)}`;
  const choices = [
    { value: "UNREVIEWED", label: t("admin_reports.cost_unreviewed") },
    { value: "OPERATING", label: t("admin_reports.cost_operating") },
    { value: "GP", label: t("admin_reports.cost_gp") },
    { value: "DEPRECIATION", label: t("admin_reports.cost_depreciation") },
    { value: "DUPLICATE", label: t("admin_reports.cost_duplicate") },
    { value: "EXCLUDED", label: t("admin_reports.cost_excluded") },
  ];
  const labels: Record<string, string> = Object.fromEntries(choices.map(c => [c.value, c.label]));
  labels.SOURCE_CHANGED = t("admin_reports.cost_source_changed");
  labels.REVIEW_REQUIRED = t("admin_reports.cost_review_required");
  labels.NOT_ELIGIBLE = t("admin_reports.cost_not_eligible");
  function open(row: any) {
    form.resetFields(); setSelected(row);
    form.setFieldsValue({ disposition: row.review?.disposition ?? "UNREVIEWED", reason: row.review?.reason ?? "",
      duplicateKey: row.review?.duplicateKey ?? undefined, startMonth: row.review?.startMonth ?? row.month,
      lifeMonths: row.review?.lifeMonths ?? 12, residual: row.review?.residual ?? 0, confirmed: false });
  }
  async function submit() {
    const values = await form.validateFields().catch(() => null);
    if (!values || !selected) return;
    try {
      await save({ variables: { input: { sourceKey: selected.key, sourceFingerprint: selected.fingerprint,
        expectedVersion: selected.review?.version ?? 0, disposition: values.disposition, reason: values.reason,
        duplicateKey: values.disposition === "DUPLICATE" ? values.duplicateKey : null,
        startMonth: values.disposition === "DEPRECIATION" ? values.startMonth : null,
        lifeMonths: values.disposition === "DEPRECIATION" ? values.lifeMonths : null,
        residual: values.disposition === "DEPRECIATION" ? values.residual : null, confirmed: values.confirmed === true } } });
      setSelected(null); await report.refetch(); message.success(t("admin_reports.cost_saved"));
    } catch (error) { message.error(`${t("admin_reports.cost_save_error")} ${error instanceof Error ? error.message : ""}`); }
  }
  return <>
    <Alert closable type="info" showIcon message={t("admin_reports.cost_scope")} description={t("admin_reports.cost_basis")} />
    <Space wrap style={{ marginBlock: 16 }}>
      <DatePicker picker="month" allowClear={false} value={dayjs(`${month}-01`)} aria-label={t("admin_reports.cost_month")}
        onChange={value => value && setMonth(value.format("YYYY-MM"))} />
      <Button onClick={() => void report.refetch().catch(() => undefined)} loading={report.loading}>{t("admin_reports.refresh")}</Button>
    </Space>
    {report.loading ? <Spin /> : report.error ? <Alert closable type="error" showIcon message={t("admin_reports.cost_load_error")}
      description={report.error.message} /> : data && <>
      <Tag color={data.complete ? "green" : "orange"}>{data.complete ? t("admin_reports.cost_reviewed") : t("admin_reports.cost_incomplete")}</Tag>
      {data.truncated && <Alert closable type="warning" showIcon message={t("admin_reports.cost_truncated")} />}
      <Typography.Paragraph>{t("admin_reports.cost_unreviewed")}: {data.unresolvedCount} · {t("admin_reports.cost_duplicate")}: {data.duplicateCount}</Typography.Paragraph>
      <Space wrap size="large">
        <span>{t("admin_reports.cost_operating")}: {amount(data.operatingAmount)}</span>
        <span>{t("admin_reports.cost_gp")}: {amount(data.gpAmount)}</span>
        <span>{t("admin_reports.cost_depreciation")}: {amount(data.depreciationAmount)}</span>
      </Space>
      <Typography.Paragraph>{t("admin_reports.cost_known")}: {amount(data.knownTotal)}<br />
        <strong>{t("admin_reports.cost_total")}: {amount(data.reviewedTotal)}</strong>
      </Typography.Paragraph>
      <Table rowKey="key" size="small" scroll={{ x: 850 }} dataSource={data.rows} pagination={{ pageSize: 20, showSizeChanger: false }} columns={[
        { title: t("admin_reports.cost_source"), render: (_: unknown, row: any) => <span>{row.kind}<br />{row.reference}<br />{row.category} · {row.month}</span> },
        { title: t("admin_reports.cost_source_amount"), render: (_: unknown, row: any) => `${row.amount ?? t("admin_reports.cost_unknown")} ${row.currency}` },
        { title: t("admin_reports.cost_state"), dataIndex: "state", render: (state: string) => labels[state] ?? state },
        { title: t("admin_reports.cost_recognized"), dataIndex: "recognizedAmount", render: amount },
        { title: "", render: (_: unknown, row: any) => <Button size="small" onClick={() => open(row)}>{t("admin_reports.cost_details")}</Button> },
      ]} />
    </>}
    <Modal destroyOnClose open={!!selected} title={t("admin_reports.cost_details")} onCancel={() => setSelected(null)}
      onOk={() => void submit()} confirmLoading={saving.loading} width={650}
      footer={can("expense.manage") ? undefined : null}>
      {selected && <>
        <Typography.Paragraph style={{ overflowWrap: "anywhere" }}><Typography.Text copyable>{selected.key}</Typography.Text><br />
          {selected.reference} · {selected.amount ?? t("admin_reports.cost_unknown")} {selected.currency} · {selected.month}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" disabled={!can("expense.manage")}>
          <Form.Item name="disposition" label={t("admin_reports.cost_state")} rules={[{ required: true }]}><Select options={choices} /></Form.Item>
          {disposition === "DUPLICATE" && <Form.Item name="duplicateKey" label={t("admin_reports.cost_canonical")} extra={t("admin_reports.cost_duplicate_hint")} rules={[{ required: true }]}><Input /></Form.Item>}
          {disposition === "DEPRECIATION" && <>
            <Alert closable type="info" message={t("admin_reports.cost_depreciation_hint")} style={{ marginBottom: 12 }} />
            <Form.Item name="startMonth" label={t("admin_reports.cost_start_month")} rules={[{ required: true, pattern: /^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/ }]}><Input placeholder="YYYY-MM" /></Form.Item>
            <Space wrap>
              <Form.Item name="lifeMonths" label={t("admin_reports.cost_life")} rules={[{ required: true }]}><InputNumber min={1} max={600} precision={0} /></Form.Item>
              <Form.Item name="residual" label={t("admin_reports.cost_residual")} rules={[{ required: true }]}><InputNumber min={0} precision={2} /></Form.Item>
            </Space>
          </>}
          <Form.Item name="reason" label={t("admin_reports.cost_reason")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
          {can("expense.manage") && <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error(t("admin_reports.cost_confirm"))) }]}>
            <Checkbox>{t("admin_reports.cost_confirm")}</Checkbox>
          </Form.Item>}
        </Form>
      </>}
    </Modal>
  </>;
}

export default function OperatingCostReport() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const [open, setOpen] = useState(false);
  if (!can("report.view") || !can("expense.view") || !can("delivery.settlement.view")) return null;
  return <Card title={t("admin_reports.cost_title")} style={{ marginTop: 16 }}>
    <Typography.Paragraph>{t("admin_reports.cost_intro")}</Typography.Paragraph>
    <Button onClick={() => setOpen(true)}>{t("admin_reports.cost_open")}</Button>
    <Modal destroyOnClose open={open} onCancel={() => setOpen(false)} title={t("admin_reports.cost_title")} footer={null} width={1100}>
      {open && <CostWorksheet />}
    </Modal>
  </Card>;
}
