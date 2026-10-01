"use client";

import { useState } from "react";
import { Alert, Button, Checkbox, Space, Typography, Upload } from "antd";
import { UploadOutlined, SendOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

export default function InstallerReportSubmission() {
  const { t } = useI18n();
  const tr = (key: string) => t(`installer_reports.${key}`);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  async function send() {
    if (!file || !consent) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/installer-reports", { method: "POST", body: file,
        headers: { "Content-Type": "application/octet-stream", "X-BMS-Report-Consent": "1" }, signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "reports_unavailable");
      setReceipt(data.reportId); setFile(null); setConsent(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : "reports_unavailable";
      setError(tr(["invalid_report", "payload_too_large", "rate_limited", "consent_required"].includes(code) ? code : "reports_unavailable"));
    } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 720, margin: "32px auto", padding: 24 }}>
    <Typography.Title level={2}>{tr("submit_title")}</Typography.Title>
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {receipt && <Alert type="success" showIcon message={tr("sent")} description={<Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{receipt}</Typography.Text>} />}
      {error && <Alert type="error" showIcon message={error} />}
      <Upload accept=".zip,.gz,.json,.txt" maxCount={1} disabled={busy}
        fileList={file ? [{ uid: "report", name: file.name, status: "done" }] : []}
        onRemove={() => { setFile(null); setConsent(false); }}
        beforeUpload={candidate => {
          setError(""); setReceipt(""); setConsent(false);
          if (candidate.size > 65536) { setFile(null); setError(tr("payload_too_large")); return Upload.LIST_IGNORE; }
          setFile(candidate); return false;
        }}>
        <Button icon={<UploadOutlined />} disabled={busy}>{tr("choose_file")}</Button>
      </Upload>
      <Checkbox checked={consent} disabled={busy || !file} onChange={e => setConsent(e.target.checked)}>{tr("consent")}</Checkbox>
      <Button type="primary" aria-label={tr("send")} icon={<SendOutlined />} loading={busy} disabled={!file || !consent} onClick={() => void send()}>{tr("send")}</Button>
    </Space>
  </main>;
}
