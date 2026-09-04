"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Segmented, Space, Typography, message } from "antd";
import { DownloadOutlined, CustomerServiceOutlined } from "@ant-design/icons";
import { flushSupportActivity, localSupportEventCount, recordSupportActivity } from "@/lib/supportActivity";
import { useI18n } from "@/lib/i18nContext";
import { useSessionCtx } from "@/lib/session-context";

const { Paragraph, Text, Title } = Typography;
type WindowKey = "1h" | "24h" | "7d";
function rangeOf(key: WindowKey) {
  const to = new Date();
  const hours = key === "1h" ? 1 : key === "24h" ? 24 : 168;
  return { from: new Date(to.getTime() - hours * 3_600_000).toISOString(), to: to.toISOString() };
}

export default function Page() {
  const { t } = useI18n();
  const { admin } = useSessionCtx();
  const activityScope = admin?.id && !admin.is_platform_admin
    ? `admin-${admin.tenant_id ?? "default"}-${admin.id}`
    : "";
  const [range, setRange] = useState<WindowKey>("1h");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState<"export" | "send" | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  useEffect(() => setLocalCount(localSupportEventCount(activityScope)), [activityScope]);

  async function flush() { const count = await flushSupportActivity(activityScope); setLocalCount(localSupportEventCount(activityScope)); return count; }
  async function exportBundle() {
    setWorking("export");
    try {
      await flush();
      const window = rangeOf(range);
      const response = await fetch(`/api/bms/support-diagnostics/export?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      const truncated = response.headers.get("x-support-truncated");
      const blob = await response.blob();
      const filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "support-diagnostics.ndjson.gz";
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
      if (truncated) message.warning(t("admin_support_diagnostics.truncated_warning", { sources: truncated }));
      else message.success(t("admin_support_diagnostics.export_success"));
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setWorking(null); }
  }
  async function sendBundle() {
    if (!confirmed) return message.warning(t("admin_support_diagnostics.confirm_required"));
    if (!description.trim()) return message.warning(t("admin_support_diagnostics.description_required"));
    setWorking("send");
    try {
      recordSupportActivity(activityScope, { category: "support", action: "support.bundle_send_confirmed", status: "success", context: { route: "/admin/support-diagnostics" } });
      await flush();
      const response = await fetch("/api/bms/support-diagnostics/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...rangeOf(range), description: description.trim(), confirmed: true }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setTicket(body.ticketCode); setConfirmed(false);
      const truncated = Object.entries(body.truncated ?? {}).filter(([, value]) => value).map(([key]) => key).join(",");
      if (truncated) message.warning(t("admin_support_diagnostics.truncated_warning", { sources: truncated }));
      else message.success(t("admin_support_diagnostics.send_success"));
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setWorking(null); }
  }
  return <Space direction="vertical" size={16} style={{ width: "100%", maxWidth: 900 }}>
    <div><Title level={2}>{t("admin_support_diagnostics.title")}</Title><Paragraph>{t("admin_support_diagnostics.intro")}</Paragraph></div>
    <Alert closable type="info" showIcon message={t("admin_support_diagnostics.privacy_title")} description={t("admin_support_diagnostics.privacy_desc")} />
    {ticket && <Alert closable type="success" showIcon message={t("admin_support_diagnostics.ticket_created", { ticket })} />}
    <Card title={t("admin_support_diagnostics.range_title")}><Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Segmented value={range} onChange={(value) => setRange(value as WindowKey)} options={[
        { value: "1h", label: t("admin_support_diagnostics.range_1h") }, { value: "24h", label: t("admin_support_diagnostics.range_24h") }, { value: "7d", label: t("admin_support_diagnostics.range_7d") },
      ]} />
      <Text type="secondary">{t("admin_support_diagnostics.local_count", { count: localCount })}</Text>
      <Input.TextArea rows={5} maxLength={2000} showCount value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("admin_support_diagnostics.description_placeholder")} />
      <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>{t("admin_support_diagnostics.confirm_text")}</Checkbox>
      <Space wrap><Button icon={<DownloadOutlined />} loading={working === "export"} disabled={working !== null} onClick={() => void exportBundle()}>{t("admin_support_diagnostics.export")}</Button>
        <Button type="primary" icon={<CustomerServiceOutlined />} loading={working === "send"} disabled={working !== null || !confirmed} onClick={() => void sendBundle()}>{t("admin_support_diagnostics.send")}</Button></Space>
    </Space></Card>
  </Space>;
}
