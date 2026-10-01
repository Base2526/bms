"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { DownloadOutlined, ReloadOutlined, SearchOutlined, SaveOutlined, LinkOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

type Row = { id: string; received_at: string; platform: string; architecture: string; product: string; installer_version: string; os_version: string; stage: string; status: string; message: string; fingerprint: string };
type Detail = Row & { report: Record<string, any>; note: string; revision: number; updated_at: string };
type Results = { reports: Row[]; counts: { total: number; new: number; investigating: number; resolved: number }; groups: { fingerprint: string; platform: string; installer_version: string; stage: string; count: number }[]; facets: { installer_version: string; os_version: string; stage: string }[] };
const statuses = ["NEW", "INVESTIGATING", "RESOLVED"];
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "unauthorized" : data.error || "reports_unavailable");
  return data;
}

export default function InstallerReports() {
  const { t } = useI18n(); const tr = (key: string) => t(`installer_reports.${key}`);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(""); const [status, setStatus] = useState("NEW");
  const detailSequence = useRef(0);
  const listSequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++listSequence.current;
    setBusy(true); setError("");
    try { const result = await request(`/api/admin/installer-reports?${new URLSearchParams({ ...filters, page: String(page) })}`, { signal }); if (!signal?.aborted && sequence === listSequence.current) setData(result); }
    catch (e) { if (!signal?.aborted && sequence === listSequence.current) { setData(null); setError(e instanceof Error ? e.message : "reports_unavailable"); } }
    finally { if (!signal?.aborted && sequence === listSequence.current) setBusy(false); }
  }, [filters, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const filter = (key: string, value?: string) => { setPage(1); setFilters(previous => ({ ...previous, [key]: value || "" })); };
  async function open(id: string) {
    const sequence = ++detailSequence.current;
    setDetail(null); setDetailBusy(true); setError("");
    try { const result = await request(`/api/admin/installer-reports/${id}`); if (sequence === detailSequence.current) { setDetail(result); setNote(result.note); setStatus(result.status); } }
    catch (e) { setError(e instanceof Error ? e.message : "reports_unavailable"); }
    finally { if (sequence === detailSequence.current) setDetailBusy(false); }
  }
  async function save() {
    if (!detail) return;
    setSaving(true); setError("");
    try {
      const result = await request(`/api/admin/installer-reports/${detail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note, revision: detail.revision }) });
      setDetail(result); setNote(result.note); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "reports_unavailable"); }
    finally { setSaving(false); }
  }
  function download() {
    if (!detail) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `bms-report-${detail.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const options = (values: string[]) => [...new Set(values)].map(value => ({ value, label: value }));
  const columns = [
    { title: tr("received"), dataIndex: "received_at", width: 170, render: (value: string) => new Date(value).toLocaleString() },
    { title: tr("platform"), key: "platform", width: 130, render: (_: unknown, row: Row) => `${row.platform} / ${row.architecture}` },
    { title: tr("product"), dataIndex: "product", width: 120 },
    { title: tr("version"), dataIndex: "installer_version", width: 150 },
    { title: tr("os_version"), dataIndex: "os_version", width: 120 },
    { title: tr("stage"), dataIndex: "stage", width: 170 },
    { title: tr("error"), key: "message", width: 300, render: (_: unknown, row: Row) => <Button type="link" style={{ padding: 0, height: "auto", textAlign: "left" }} onClick={() => void open(row.id)}><span style={{ display: "block", maxWidth: 280, whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.message}</span></Button> },
    { title: tr("status"), dataIndex: "status", width: 130, render: (value: string) => <Tag color={value === "RESOLVED" ? "green" : value === "INVESTIGATING" ? "gold" : "red"}>{tr(value)}</Tag> },
  ];
  return <div style={{ padding: 24, minWidth: 0 }}>
    <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>{tr("title")}</Typography.Title>
      <Space><Button href="/installer-report" target="_blank" icon={<LinkOutlined />}>{tr("submit_title")}</Button><Tooltip title={tr("refresh")}><Button aria-label={tr("refresh")} icon={<ReloadOutlined />} onClick={() => void load()} loading={busy} /></Tooltip></Space>
    </Space>
    {error && <Alert closable onClose={() => setError("")} type="error" showIcon message={tr(["unauthorized", "invalid_date", "report_changed_reload"].includes(error) ? error : "reports_unavailable")} style={{ marginBottom: 16 }} />}
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label={tr("platform")} placeholder={tr("platform")} style={{ width: 150 }} allowClear options={options(["windows", "linux", "macos", "unknown"])} onChange={value => filter("platform", value)} />
      <Select aria-label={tr("architecture")} placeholder={tr("architecture")} style={{ width: 140 }} allowClear options={options(["x64", "x86", "arm64", "unknown"])} onChange={value => filter("architecture", value)} />
      <Select aria-label={tr("product")} placeholder={tr("product")} style={{ width: 140 }} allowClear options={options(["pos", "server-pos"])} onChange={value => filter("product", value)} />
      <Select aria-label={tr("version")} placeholder={tr("version")} style={{ width: 190 }} allowClear showSearch options={options(data?.facets.map(v => v.installer_version) || [])} onChange={value => filter("version", value)} />
      <Select aria-label={tr("os_version")} placeholder={tr("os_version")} style={{ width: 150 }} allowClear showSearch options={options(data?.facets.map(v => v.os_version) || [])} onChange={value => filter("osVersion", value)} />
      <Select aria-label={tr("stage")} placeholder={tr("stage")} style={{ width: 200 }} allowClear showSearch options={options(data?.facets.map(v => v.stage) || [])} onChange={value => filter("stage", value)} />
      <Select aria-label={tr("status")} placeholder={tr("status")} style={{ width: 180 }} allowClear options={statuses.map(value => ({ value, label: tr(value) }))} onChange={value => filter("status", value)} />
      <Input.Search aria-label={tr("search")} placeholder={tr("search")} style={{ width: 260, maxWidth: "100%" }} enterButton={<SearchOutlined />} onSearch={value => filter("q", value)} allowClear />
      <label>{tr("from")} <Input type="date" aria-label={tr("from")} style={{ width: 160 }} onChange={e => filter("from", e.target.value)} /></label>
      <label>{tr("to")} <Input type="date" aria-label={tr("to")} style={{ width: 160 }} onChange={e => filter("to", e.target.value)} /></label>
    </Space>
    {filters.fingerprint && <Tag closable onClose={() => filter("fingerprint", "")}>{tr("group_filter")}</Tag>}
    {data && <Space wrap style={{ marginBottom: 16 }}><Typography.Text strong>{tr("total")}: {data.counts.total}</Typography.Text>{statuses.map(s => <Tag key={s}>{tr(s)}: {data.counts[s.toLowerCase() as "new" | "investigating" | "resolved"]}</Tag>)}</Space>}
    <Table<Row> rowKey="id" loading={busy} columns={columns} dataSource={data?.reports || []} scroll={{ x: 1290 }} size="small"
      pagination={{ current: page, pageSize: 25, total: data?.counts.total || 0, showSizeChanger: false, onChange: setPage }} />
    <Typography.Title level={4}>{tr("groups")}</Typography.Title>
    <Table rowKey="fingerprint" size="small" pagination={false} scroll={{ x: 700 }} dataSource={data?.groups || []} columns={[
      { title: tr("platform"), dataIndex: "platform" }, { title: tr("version"), dataIndex: "installer_version" }, { title: tr("stage"), dataIndex: "stage" },
      { title: tr("total"), key: "count", render: (_, row) => <Button type="link" onClick={() => filter("fingerprint", row.fingerprint)}>{row.count}</Button> },
    ]} />
    <Drawer width="min(680px, 100vw)" title={tr("detail")} open={!!detail || detailBusy} onClose={() => { if (!saving) { detailSequence.current++; setDetail(null); setDetailBusy(false); } }}>
      {error && <Alert closable onClose={() => setError("")} type="error" showIcon message={tr(error === "report_changed_reload" ? error : "reports_unavailable")} style={{ marginBottom: 16 }} />}
      {detailBusy && <Typography.Text>{tr("loading")}</Typography.Text>}
      {detail && <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Alert closable type="info" message={tr("unverified")} />
        <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{detail.id}</Typography.Text>
        <Descriptions column={1} size="small" bordered items={[
          { key: "version", label: tr("version"), children: detail.installer_version },
          { key: "os", label: tr("platform"), children: `${detail.report.osName} ${detail.os_version} (${detail.report.osBuild}) / ${detail.architecture}` },
          { key: "stage", label: tr("stage"), children: detail.stage },
          { key: "time", label: tr("received"), children: new Date(detail.received_at).toLocaleString() },
          { key: "error", label: tr("error"), children: <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{detail.report.failure?.message}</span> },
        ]} />
        <Tooltip title={tr("download")}><Button icon={<DownloadOutlined />} onClick={download}>{tr("download")}</Button></Tooltip>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 420, overflowY: "auto", fontSize: 12 }}>{JSON.stringify(detail.report, null, 2)}</pre>
        <label>{tr("status")}<Select value={status} disabled={saving} style={{ width: "100%" }} onChange={setStatus} options={statuses.map(value => ({ value, label: tr(value) }))} /></label>
        <label style={{ width: "100%" }}>{tr("note")}<Input.TextArea value={note} disabled={saving} maxLength={2048} rows={4} onChange={e => setNote(e.target.value)} /></label>
        <Button type="primary" aria-label={tr("save")} icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>{tr("save")}</Button>
      </Space>}
    </Drawer>
  </div>;
}
