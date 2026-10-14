"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Modal, Radio, Select, Space, Table } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import TaxControlDocument from "./TaxControlDocument";

async function call(body?: any, params = "") {
  const res = await fetch(`/api/bms/tax-controls${params}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Tax controls unavailable");
  return data;
}
export default function TaxDocumentControlsPanel({ month, locationId, establishments, documents, onChanged }: {
  month: string; locationId?: string; establishments: { locationId: string; name: string; branchCode: string }[];
  documents: any[]; onChanged: () => void;
}) {
  const { t } = useI18n(), { can } = useBmsPermissions();
  const [form] = Form.useForm();
  const [archive, setArchive] = useState<any>({ actions: [], periods: [] });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const [review, setReview] = useState<any>(null), [printed, setPrinted] = useState<any>(null);
  const action = Form.useWatch("action", form), vat = Form.useWatch(["buyer", "vatRegistered"], form);
  const query = `?month=${encodeURIComponent(month)}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""}`;
  const reload = async () => { try { setArchive(await call(undefined, query)); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { let active = true; setArchive({ actions: [], periods: [] }); call(undefined, query).then(data => { if (active) setArchive(data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [query]);
  const preview = async (values: any) => {
    setBusy(true); setError("");
    try { const input = { ...values, month }; const result = await call(input); if (result.status === "COMPLETED") { setPrinted(result.snapshot); setOpen(false); } else setReview({ ...result, input }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const result = await call({ ...review.input, confirmed: true, reviewHash: review.reviewHash });
      setPrinted(result.snapshot); setReview(null); setOpen(false); await reload(); onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const view = async (id: string, period = false) => {
    setPrinted(null); setBusy(true);
    try { setPrinted(await call(undefined, `?id=${id}&period=${period}`)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const options = [
    ...(can("tax.document.issue") ? [{ value: "SUBSTITUTE", label: t("tax_controls.substitute") }] : []),
    ...(can("tax.document.adjust") ? [{ value: "CORRECT", label: t("tax_controls.correct") }, { value: "CREDIT", label: t("tax_controls.credit") }, { value: "DEBIT", label: t("tax_controls.debit") }] : []),
    ...(can("tax.period.close") && can("expense.view") ? [{ value: "CLOSE", label: t("tax_controls.close") }] : []),
  ];
  return <Card title={t("tax_controls.title")} style={{ marginBottom: 20 }} extra={options.length ? <Button onClick={() => { form.resetFields(); form.setFieldsValue({ idempotencyKey: crypto.randomUUID(), action: options[0].value, locationId, base: 0, exempt: 0, buyer: { buyerType: "INDIVIDUAL", vatRegistered: false, branchCode: "00000" } }); setOpen(true); setError(""); }}>{t("tax_controls.create")}</Button> : null}>
    <Button onClick={() => void reload()} style={{ marginBottom: 12 }}>{t("tax_controls.reload")}</Button>
    <Alert closable showIcon type="info" message={t("tax_controls.scope")} style={{ marginBottom: 12 }} />
    {error && <Alert closable onClose={() => setError("")} showIcon type="error" message={error} />}
    <Table size="small" rowKey="id" dataSource={archive.actions ?? []} scroll={{ x: 650 }} pagination={{ pageSize: 10 }} columns={[
      { title: t("tax_controls.date"), dataIndex: "issue_date" }, { title: t("tax_controls.document"), dataIndex: "doc_no" },
      { title: t("tax_controls.action"), dataIndex: "action", render: (v: string) => ({ SUBSTITUTE: t("tax_controls.substitute"), CORRECT: t("tax_controls.correct"), CREDIT: t("tax_controls.credit"), DEBIT: t("tax_controls.debit") }[v] ?? v) },
      { title: t("tax_controls.reason"), dataIndex: "reason" }, { title: t("tax_controls.view"), render: (_: unknown, row: any) => <Button loading={busy} onClick={() => void view(row.id)}>{t("tax_controls.view")}</Button> },
    ]} />
    <Table size="small" rowKey="id" dataSource={archive.periods ?? []} scroll={{ x: 600 }} pagination={{ pageSize: 10 }} columns={[
      { title: t("tax_controls.month"), dataIndex: "tax_month" }, { title: t("tax_controls.version"), dataIndex: "version" },
      { title: t("tax_controls.reason"), dataIndex: "reason" }, { title: t("tax_controls.view"), render: (_: unknown, row: any) => <Space><Button onClick={() => void view(row.id, true)}>{t("tax_controls.view")}</Button><a target="_blank" rel="noreferrer" href={`/api/bms/tax-controls?id=${row.id}&period=true&format=print`}>{t("tax_controls.print")}</a><a href={`/api/bms/tax-controls?id=${row.id}&period=true&download=true`}>{t("tax_controls.download")}</a></Space> },
    ]} />
    <p>{t("tax_controls.archive_limit")}</p>
    <Modal destroyOnClose open={open} title={t("tax_controls.create")} width={720} onCancel={() => { if (!busy) setOpen(false); }} footer={null}>
      {error && <Alert closable onClose={() => setError("")} type="error" message={error} />}
      <Form form={form} layout="vertical" onFinish={preview} disabled={busy}>
        <Form.Item name="idempotencyKey" hidden><Input /></Form.Item>
        <Form.Item name="action" label={t("tax_controls.action")} rules={[{ required: true }]}><Select options={options} /></Form.Item>
        {action === "CLOSE" ? <><p>{t("tax_controls.month")}: {month}</p><Form.Item name="locationId" label={t("tax_controls.branch")} rules={[{ required: true }]}><Select options={establishments.map(e => ({ value: e.locationId, label: `${e.branchCode} · ${e.name}` }))} /></Form.Item></> : <>
          <Form.Item name="documentId" label={t("tax_controls.document")} rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={documents.filter(d => !d.cancelledAt && d.docType !== "ABBREVIATED" && (action === "SUBSTITUTE" || d.docType === "FULL")).map(d => ({ value: d.id, label: d.docNo }))} /></Form.Item>
          <p>{t("tax_controls.selection_hint")}</p>
          <Form.Item name="evidence" label={t("tax_controls.evidence")} rules={[{ required: true, whitespace: true }]}><Input maxLength={1000} /></Form.Item>
        </>}
        <Form.Item name="reason" label={t("tax_controls.reason")} rules={[{ required: true, whitespace: true }]}><Input maxLength={1000} /></Form.Item>
        {action === "CORRECT" && <>
          <Form.Item name="originalReturned" valuePropName="checked" rules={[{ validator: (_, v) => v ? Promise.resolve() : Promise.reject(new Error(t("tax_controls.return_original"))) }]}><Checkbox>{t("tax_controls.return_original")}</Checkbox></Form.Item>
          <Form.Item name={["buyer", "vatRegistered"]} label={t("admin_tax_documents.buyer_vat_registered")}><Radio.Group options={[{ label: t("admin_tax_documents.vat_yes"), value: true }, { label: t("admin_tax_documents.vat_no"), value: false }]} /></Form.Item>
          <Form.Item name={["buyer", "name"]} label={t("tax_controls.buyer_name")} rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name={["buyer", "address"]} label={t("tax_controls.address")} rules={[{ required: true }]}><Input.TextArea maxLength={1000} /></Form.Item>
          <Form.Item name={["buyer", "taxId"]} label={t("tax_controls.tax_id")} rules={[{ required: vat === true }]}><Input maxLength={13} /></Form.Item>
          {vat && <Form.Item name={["buyer", "branchCode"]} label={t("tax_controls.branch_code")} rules={[{ required: true, pattern: /^\d{5}$/ }]}><Input maxLength={5} /></Form.Item>}
        </>}
        {(action === "CREDIT" || action === "DEBIT") && <>
          <Alert closable type="warning" message={t("tax_controls.adjustment_warning")} />
          <Form.Item name="base" label={t("tax_controls.base")} rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="exempt" label={t("tax_controls.exempt")} rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="eventDate" label={t("tax_controls.event_date")} rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="delayedReason" label={t("tax_controls.delay_reason")}><Input maxLength={1000} /></Form.Item>
        </>}
        <Button htmlType="submit" type="primary" loading={busy}>{t("tax_controls.preview")}</Button>
      </Form>
    </Modal>
    <Modal destroyOnClose open={Boolean(review)} title={t("tax_controls.confirm_title")} width={800} onCancel={() => { if (!busy) setReview(null); }} onOk={() => void confirm()} okText={t("tax_controls.confirm")} confirmLoading={busy}>
      {error && <Alert closable onClose={() => setError("")} type="error" message={error} />}
      {review?.snapshot.evidence && <p>{t("tax_controls.evidence")}: {review.snapshot.evidence}</p>}
      {review?.snapshot.eventDate && <p>{t("tax_controls.event_date")}: {review.snapshot.eventDate} {review.snapshot.delayedReason}</p>}
      {review && <TaxControlDocument snapshot={review.snapshot} preview />}
    </Modal>
    <Modal destroyOnClose className="bms-tax-document-modal" open={Boolean(printed)} title={t("tax_controls.view")} width={800} onCancel={() => setPrinted(null)} footer={printed?.document ? <Button onClick={() => window.print()}>{t("tax_controls.print")}</Button> : null}>
      {printed?.drifted && <Alert closable type="warning" message={t("tax_controls.drift")} />}
      {printed && <TaxControlDocument snapshot={printed} />}
    </Modal>
  </Card>;
}
