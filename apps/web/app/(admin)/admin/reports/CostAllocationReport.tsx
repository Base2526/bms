"use client";
import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Typography, message } from "antd";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const SNAPSHOT = gql`fragment AllocationSnapshot on BmsCostAllocationSnapshot {
  version month sourceKey amount fingerprint currency salesBasis
  rule { method reason targets { locationId channel weight } }
  allocations { locationId channel basisWeight amount }
}`;
const REPORT = gql`query CostAllocations($month: String!) {
  bmsCostAllocations(month: $month) { status errorCode month currency complete truncated unresolvedCount knownAllocated allocatedTotal reviewedTotal
    locations { id name } groups { locationId channel amount }
    rows { sourceKey reference classification amount state issue version snapshot { ...AllocationSnapshot } }
  }
} ${SNAPSHOT}`;
const PREVIEW = gql`query PreviewCostAllocation($input: BmsCostAllocationPreviewInput!) {
  bmsPreviewCostAllocation(input: $input) { status errorCode expectedVersion snapshot { ...AllocationSnapshot } }
} ${SNAPSHOT}`;
const SAVE = gql`mutation SaveCostAllocation($input: BmsCostAllocationSaveInput!) {
  bmsSaveCostAllocation(input: $input) { status errorCode version replayed }
}`;

function Worksheet() {
  const { t } = useI18n(), { can } = useBmsPermissions(), client = useApolloClient();
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [selected, setSelected] = useState<any>(null), [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [form] = Form.useForm();
  const sequence = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  const invalidate = () => { sequence.current++; setPreview(null); setConfirmed(false); setBusy(false); };
  const query = useQuery(REPORT, { variables: { month }, fetchPolicy: "network-only", notifyOnNetworkStatusChange: true });
  const [save, saving] = useMutation(SAVE);
  const data = query.data?.bmsCostAllocations;
  const methods = [
    { value: "DIRECT", label: t("admin_reports.allocation_direct") }, { value: "EQUAL", label: t("admin_reports.allocation_equal") },
    { value: "WEIGHTED", label: t("admin_reports.allocation_weighted") }, { value: "SALES_GROSS", label: t("admin_reports.allocation_sales") },
    { value: "SALES_UNITS", label: t("admin_reports.allocation_units") },
  ];
  const states: Record<string, string> = { CURRENT: t("admin_reports.allocation_current"), STALE: t("admin_reports.allocation_stale"),
    UNALLOCATED: t("admin_reports.allocation_missing"), NOT_APPLICABLE: t("admin_reports.allocation_not_applicable"), INACTIVE: t("admin_reports.allocation_inactive") };
  const method = Form.useWatch("method", form);
  const money = (v: string | null | undefined) => v == null ? t("admin_reports.cost_unknown") : `฿${v}`;
  const location = (id: string) => data?.locations?.find((l: any) => l.id === id)?.name ?? id;
  const parts = (snapshot: any) => <Table size="small" pagination={false} scroll={{ x: 500 }}
    rowKey={(r: any) => JSON.stringify([r.locationId, r.channel])} dataSource={snapshot.allocations} columns={[
      { title: t("admin_reports.allocation_branch"), dataIndex: "locationId", render: location },
      { title: t("admin_reports.allocation_channel"), dataIndex: "channel", render: (v: string | null) => v ?? t("admin_reports.allocation_all_channels") },
      { title: t("admin_reports.allocation_basis_weight"), dataIndex: "basisWeight" },
      { title: t("admin_reports.cost_recognized"), dataIndex: "amount", render: money },
    ]} />;
  function open(row: any) {
    invalidate(); setSelected(row); form.resetFields();
    const rule = row.snapshot?.rule;
    form.setFieldsValue(rule ? { method: rule.method, reason: rule.reason,
      targets: rule.targets.map((p: any) => ({ locationId: p.locationId, channel: p.channel ?? "", weight: p.weight ?? undefined })) }
      : { method: "DIRECT", reason: "", targets: [{ locationId: data.locations[0]?.id, channel: "" }] });
  }
  async function calculate() {
    invalidate();
    const validationRequest = sequence.current;
    const values = await form.validateFields().catch(() => null);
    if (!values || !selected || !mounted.current || validationRequest !== sequence.current) return;
    const formKey = JSON.stringify(form.getFieldsValue(true));
    const input = { month, sourceKey: selected.sourceKey, rule: { method: values.method, reason: values.reason,
      targets: values.targets.map((p: any) => ({ locationId: p.locationId, channel: p.channel?.trim() || null,
        weight: values.method === "WEIGHTED" ? String(p.weight ?? "") : null })) } };
    const request = ++sequence.current; setBusy(true);
    try {
      const response = await client.query({ query: PREVIEW, variables: { input }, fetchPolicy: "no-cache" });
      if (!mounted.current || sequence.current !== request || formKey !== JSON.stringify(form.getFieldsValue(true))) return;
      const result = response.data?.bmsPreviewCostAllocation;
      if (result?.status !== "READY") throw new Error(result?.errorCode ?? "COST_ALLOCATION_PREVIEW_FAILED");
      setPreview({ ...result, input, formKey });
    } catch (error) {
      if (mounted.current && sequence.current === request && formKey === JSON.stringify(form.getFieldsValue(true))) message.error(String(error));
    } finally { if (mounted.current && sequence.current === request) setBusy(false); }
  }
  async function submit() {
    if (!confirmed || !preview || preview.formKey !== JSON.stringify(form.getFieldsValue(true))) { invalidate(); return; }
    const request = ++sequence.current;
    try {
      const response = await save({ variables: { input: { ...preview.input, confirmed: true, expectedVersion: preview.expectedVersion,
        previewFingerprint: preview.snapshot.fingerprint } } });
      if (!mounted.current || sequence.current !== request) return;
      const result = response.data?.bmsSaveCostAllocation;
      if (result?.status !== "SAVED") throw new Error(result?.errorCode ?? "COST_ALLOCATION_SAVE_FAILED");
      setSelected(null); invalidate(); await query.refetch(); message.success(t("admin_reports.cost_saved"));
    } catch (error) { if (mounted.current && sequence.current === request) { invalidate(); message.error(String(error)); } }
  }
  return <>
    <Alert closable type="info" showIcon message={t("admin_reports.allocation_scope")} description={t("admin_reports.allocation_basis")} />
    <Space wrap style={{ marginBlock: 16 }}>
      <DatePicker picker="month" allowClear={false} value={dayjs(`${month}-01`)} aria-label={t("admin_reports.cost_month")}
        disabled={saving.loading} onChange={v => { if (v) { invalidate(); setSelected(null); setMonth(v.format("YYYY-MM")); } }} />
      <Button loading={query.loading} disabled={saving.loading} onClick={() => { invalidate(); setSelected(null); void query.refetch().catch(() => undefined); }}>{t("admin_reports.refresh")}</Button>
    </Space>
    {query.loading ? <Spin /> : query.error || data?.status === "REJECTED" ? <Alert closable type="error" message={t("admin_reports.cost_load_error")}
      description={query.error?.message ?? data.errorCode} /> : data?.status === "OK" && <>
      <Alert closable type={data.complete ? "success" : "warning"} message={data.complete ? t("admin_reports.allocation_complete") : t("admin_reports.allocation_incomplete")} />
      <Typography.Paragraph>{t("admin_reports.allocation_known")}: {money(data.knownAllocated)} · {t("admin_reports.allocation_total")}: {money(data.allocatedTotal)}</Typography.Paragraph>
      <Table rowKey="sourceKey" size="small" scroll={{ x: 700 }} pagination={{ pageSize: 20 }} dataSource={data.rows} columns={[
        { title: t("admin_reports.cost_source"), dataIndex: "reference" }, { title: t("admin_reports.cost_recognized"), dataIndex: "amount", render: money },
        { title: t("admin_reports.cost_state"), render: (_: any, row: any) => <span>{states[row.state] ?? row.state}<br />{row.issue}</span> },
        { title: t("admin_reports.allocation_version"), dataIndex: "version" },
        { title: "", render: (_: any, row: any) => <Button onClick={() => open(row)}>{t("admin_reports.cost_details")}</Button> },
      ]} />
      {data.groups?.length > 0 && <>{t("admin_reports.allocation_groups")}{parts({ allocations: data.groups.map((g: any) => ({ ...g, basisWeight: "—" })) })}</>}
    </>}
    <Modal open={!!selected} destroyOnClose width={760} title={t("admin_reports.allocation_title")} footer={null}
      maskClosable={!saving.loading} closable={!saving.loading} keyboard={!saving.loading} onCancel={() => { invalidate(); setSelected(null); }}>
      {selected && <>
        <Typography.Paragraph>{selected.reference} · {money(selected.amount)} · v{selected.version}</Typography.Paragraph>
        {selected.snapshot && <details><summary>{t("admin_reports.allocation_saved_snapshot")}</summary>{parts(selected.snapshot)}</details>}
        {selected.amount == null ? <Alert closable type="warning" message={t("admin_reports.allocation_review_first")} /> : <>
          <Form form={form} layout="vertical" disabled={!can("expense.manage") || busy || saving.loading} onValuesChange={invalidate}>
            <Form.Item name="method" label={t("admin_reports.allocation_method")} rules={[{ required: true }]}><Select options={methods} /></Form.Item>
            <Form.List name="targets">{(fields, { add, remove }) => <>
              {fields.map(field => <Card size="small" key={field.key} style={{ marginBottom: 8 }}>
                <Form.Item name={[field.name, "locationId"]} label={t("admin_reports.allocation_branch")} rules={[{ required: true }]}>
                  <Select options={data?.locations?.map((l: any) => ({ value: l.id, label: l.name }))} /></Form.Item>
                <Form.Item name={[field.name, "channel"]} label={t("admin_reports.allocation_channel")} extra={t("admin_reports.allocation_channel_hint")}><Input maxLength={64} /></Form.Item>
                {method === "WEIGHTED" && <Form.Item name={[field.name, "weight"]} label={t("admin_reports.allocation_weight")} rules={[{ required: true }]}>
                  <InputNumber stringMode min="0" max="999999999" precision={0} /></Form.Item>}
                <Button disabled={fields.length <= 1 || busy || saving.loading || !can("expense.manage")} onClick={() => { remove(field.name); invalidate(); }}>{t("admin_reports.allocation_remove")}</Button>
              </Card>)}
              <Button disabled={fields.length >= 100 || busy || saving.loading || !can("expense.manage")} onClick={() => { add({ channel: "" }); invalidate(); }}>{t("admin_reports.allocation_add")}</Button>
            </>}</Form.List>
            <Form.Item name="reason" label={t("admin_reports.cost_reason")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
          </Form>
          {can("expense.manage") && <Button onClick={() => void calculate()} loading={busy} disabled={saving.loading}>{t("admin_reports.allocation_preview")}</Button>}
          {preview && <div style={{ marginTop: 16 }}>
            <Typography.Paragraph>{t("admin_reports.allocation_preview_total")}: {money(preview.snapshot.amount)}</Typography.Paragraph>
            {parts(preview.snapshot)}
            <Checkbox checked={confirmed} disabled={saving.loading} onChange={e => setConfirmed(e.target.checked)}>{t("admin_reports.allocation_confirm")}</Checkbox>
            <Button type="primary" loading={saving.loading} disabled={!confirmed || !can("expense.manage")} onClick={() => void submit()}>{t("admin_reports.allocation_save")}</Button>
          </div>}
        </>}
      </>}
    </Modal>
  </>;
}

export default function CostAllocationReport() {
  const { t } = useI18n(), { can } = useBmsPermissions();
  const [open, setOpen] = useState(false);
  if (!(["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"] as const).every(can)) return null;
  return <Card title={t("admin_reports.allocation_title")} style={{ marginTop: 16 }}>
    <Typography.Paragraph>{t("admin_reports.allocation_intro")}</Typography.Paragraph>
    <Button onClick={() => setOpen(true)}>{t("admin_reports.allocation_open")}</Button>
    <Modal open={open} destroyOnClose footer={null} width={1100} title={t("admin_reports.allocation_title")} onCancel={() => setOpen(false)}>
      {open && <Worksheet />}
    </Modal>
  </Card>;
}
