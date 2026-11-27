"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";

type Release = {
  id: string; version: string; channel: "pilot" | "stable"; status: "DRAFT" | "PUBLISHED" | "HIDDEN";
  filename: string; sizeBytes: number; sha256: string; signatureStatus: "VALID" | "INVALID" | "UNAVAILABLE";
  signerThumbprint: string | null;
  minimumOs: string; releaseNotes: string; publishedAt: string | null;
};

export default function KioskDesktopInstall({ locationId, lang }: {
  locationId: string | null; lang: "th" | "en";
}) {
  const en = lang === "en";
  const [release, setRelease] = useState<Release | null>(null);
  const [publisherReleases, setPublisherReleases] = useState<Release[]>([]);
  const [canPublish, setCanPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [sha256, setSha256] = useState("");
  const [minimumOs, setMinimumOs] = useState("Windows 10 x64");
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState<"pilot" | "stable">("pilot");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!locationId) { setRelease(null); setPublisherReleases([]); setCanPublish(false); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/bms/kiosk-desktop-releases?locationId=${encodeURIComponent(locationId)}`,
        { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 403
        ? (en ? "You cannot view installers for this branch." : "ไม่มีสิทธิ์ดูไฟล์ติดตั้งของสาขานี้")
        : (en ? "Installer status is unavailable. Ask your manager to check." : "อ่านสถานะไฟล์ติดตั้งไม่ได้ กรุณาให้ผู้จัดการตรวจสอบ"));
      const body = await response.json();
      if (signal?.aborted) return;
      setRelease(body.release ?? null);
      setCanPublish(body.canPublish === true);
      if (body.canPublish === true) {
        const admin = await fetch("/api/admin/kiosk-desktop-releases", { cache: "no-store", signal });
        if (!admin.ok) throw new Error(en ? "Could not load release drafts." : "อ่านรายการ release draft ไม่สำเร็จ");
        const adminBody = await admin.json();
        if (!signal?.aborted) setPublisherReleases(adminBody.releases ?? []);
      } else setPublisherReleases([]);
    } catch (cause) {
      if (!signal?.aborted) {
        setRelease(null);
        setPublisherReleases([]);
        setError(cause instanceof Error ? cause.message :
          (en ? "Could not load installer." : "อ่านข้อมูลไฟล์ติดตั้งไม่ได้"));
      }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [locationId, en]);

  useEffect(() => {
    const controller = new AbortController();
    setRelease(null); setPublisherReleases([]); setFile(null); setError("");
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function download() {
    if (!locationId || !release || busy) return;
    setBusy(true); setError("");
    const href = `/api/bms/kiosk-desktop-releases/${encodeURIComponent(release.id)}/download?locationId=${encodeURIComponent(locationId)}`;
    try {
      const response = await fetch(href, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429
        ? (en ? "Too many downloads. Wait and try again." : "ดาวน์โหลดถี่เกินไป กรุณารอแล้วลองใหม่")
        : response.status === 503
          ? (en ? "Installer verification is unavailable. Ask staff to check the release." : "ตรวจไฟล์ติดตั้งไม่ได้ กรุณาให้ผู้ดูแลตรวจ release")
          : (en ? "This installer is no longer available. Refresh the list." : "ไฟล์นี้ไม่พร้อมให้ดาวน์โหลดแล้ว กรุณารีเฟรชรายการ"));
      const link = document.createElement("a");
      link.href = href;
      link.download = release.filename;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (cause) { setError(cause instanceof Error ? cause.message :
      (en ? "Download failed. Ask staff to check." : "ดาวน์โหลดไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจสอบ")); }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file || !/^[0-9a-f]{64}$/i.test(sha256) || !version || !minimumOs || busy) return;
    setBusy(true); setError("");
    const form = new FormData();
    form.append("version", version.trim()); form.append("channel", channel);
    form.append("sha256", sha256.trim().toLowerCase()); form.append("minOs", minimumOs.trim());
    form.append("releaseNotes", notes.trim()); form.append("file", file);
    try {
      const response = await fetch("/api/admin/kiosk-desktop-releases-upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(en ? `Upload rejected (${body.code || response.status}). Check filename, checksum and version.`
        : `อัปโหลดไม่ผ่าน (${body.code || response.status}) กรุณาตรวจชื่อไฟล์ SHA-256 และเวอร์ชัน`);
      setFile(null); setVersion(""); setSha256(""); setNotes("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message :
      (en ? "Upload failed." : "อัปโหลดไม่สำเร็จ")); }
    finally { setBusy(false); }
  }

  async function manage(action: "publish" | "hide", target: Release) {
    if (!locationId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/kiosk-desktop-releases", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, releaseId: target.id, locationId, confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code === "SIGNER_NOT_APPROVED"
        ? (en ? "The installer signer is not approved by the platform. Ask IT to verify the certificate and configure the approved thumbprint."
          : "ผู้ลงนามไฟล์ติดตั้งยังไม่ได้รับอนุมัติจากแพลตฟอร์ม ให้ IT ตรวจใบรับรองและตั้งค่าลายนิ้วมือที่อนุมัติ")
        : (en ? `Release change rejected (${body.code || response.status}). Check signature, branch and stored file.`
          : `เปลี่ยนสถานะ release ไม่สำเร็จ (${body.code || response.status}) กรุณาตรวจลายเซ็น สาขา และไฟล์`));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message :
      (en ? "Could not change release." : "เปลี่ยนสถานะ release ไม่สำเร็จ")); }
    finally { setBusy(false); }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) { setFile(event.currentTarget.files?.[0] ?? null); }

  return <Card size="small" title={en ? "Install BMS Kiosk" : "ติดตั้ง BMS Kiosk"} loading={loading && !release}
    style={{ marginTop: 20 }}>
    <Typography.Paragraph>{en
      ? "BMS Kiosk is a separate customer screen, not Desktop POS. It does not take payment. Its maintenance PIN is separate from the cashier PIN."
      : "BMS Kiosk เป็นจอลูกค้าแยกจาก Desktop POS จอนี้ไม่รับเงิน และ PIN ดูแลจอแยกจาก PIN พนักงาน"}</Typography.Paragraph>
    <Typography.Paragraph>{en
      ? "1. Register the screen → 2. Set the maintenance PIN → 3. Download and install → 4. Enter the branch URL issued in Restaurant POS → 5. Test before customers use it."
      : "1. ลงทะเบียนเครื่อง → 2. ตั้ง PIN ดูแลจอ → 3. ดาวน์โหลดและติดตั้ง → 4. นำ URL ของสาขาจาก Restaurant POS ไปตั้งค่าที่เครื่อง → 5. ทดสอบก่อนให้ลูกค้าใช้"}</Typography.Paragraph>
    <Typography.Paragraph><a href="/admin/manual">{en ? "Installation guide and pilot requirements" : "คู่มือติดตั้งและข้อกำหนดเครื่อง pilot"}</a></Typography.Paragraph>
    {error && <Alert type="error" showIcon closable onClose={() => setError("")} message={error} style={{ marginBottom: 12 }} />}
    {!loading && !error && !release && <Alert type="info" showIcon closable message={en
      ? "No installer has been published for this branch. Contact the BMS release administrator."
      : "ยังไม่มีไฟล์ติดตั้งที่เผยแพร่สำหรับสาขานี้ กรุณาติดต่อผู้ดูแลการเผยแพร่ BMS"} />}
    {release && <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Space wrap><Tag color="red">Windows x64</Tag><Tag>{release.channel}</Tag>
        <Typography.Text strong>{release.version}</Typography.Text>
        <Typography.Text type="secondary">{release.publishedAt && new Date(release.publishedAt).toLocaleDateString(en ? "en-US" : "th-TH")}</Typography.Text></Space>
      <Typography.Text>{release.filename} · {(release.sizeBytes / 1024 / 1024).toFixed(1)} MB</Typography.Text>
      <Typography.Text>{en ? "Minimum OS" : "ระบบขั้นต่ำ"}: {release.minimumOs}</Typography.Text>
      <Typography.Text copyable={{ text: release.sha256 }}>SHA-256: {release.sha256}</Typography.Text>
      {release.releaseNotes && <Typography.Paragraph style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{release.releaseNotes}</Typography.Paragraph>}
      <Button type="primary" icon={<DownloadOutlined />} loading={busy} onClick={() => void download()}>
        {en ? "Download BMS Kiosk for Windows x64" : "ดาวน์โหลด BMS Kiosk สำหรับ Windows x64"}</Button>
    </Space>}
    {canPublish && <Card type="inner" title={en ? "Platform release management" : "จัดการ release โดยผู้ดูแลแพลตฟอร์ม"}
      style={{ marginTop: 20 }}>
      <Alert type="warning" showIcon closable style={{ marginBottom: 12 }} message={en
        ? "An unsigned or unverified installer stays in draft. Publishing rechecks the stored bytes, Authenticode signature and approved signer certificate."
        : "ไฟล์ที่ไม่มีลายเซ็นหรือยังตรวจไม่ได้จะคงเป็น draft ก่อนเผยแพร่ระบบตรวจไฟล์ ลายเซ็น Authenticode และใบรับรองผู้ลงนามที่อนุมัติซ้ำ"} />
      <Space direction="vertical" style={{ width: "100%" }}>
        <label htmlFor="kiosk-release-file">{en ? "Windows x64 NSIS installer" : "ไฟล์ติดตั้ง NSIS สำหรับ Windows x64"}</label>
        <input id="kiosk-release-file" type="file" accept=".exe" onChange={chooseFile} />
        <label htmlFor="kiosk-release-version">{en ? "Version matching filename" : "เวอร์ชันที่ตรงกับชื่อไฟล์"}</label>
        <Input id="kiosk-release-version" value={version} maxLength={80} onChange={(event) => setVersion(event.target.value)} placeholder="0.1.0-pilot.2" />
        <label htmlFor="kiosk-release-sha">SHA-256</label>
        <Input id="kiosk-release-sha" value={sha256} maxLength={64} onChange={(event) => setSha256(event.target.value)} />
        <label htmlFor="kiosk-release-min-os">{en ? "Minimum OS" : "ระบบปฏิบัติการขั้นต่ำ"}</label>
        <Input id="kiosk-release-min-os" value={minimumOs} maxLength={200} onChange={(event) => setMinimumOs(event.target.value)} />
        <label htmlFor="kiosk-release-channel">{en ? "Channel" : "ช่องทางเผยแพร่"}</label>
        <Select id="kiosk-release-channel" value={channel} onChange={setChannel} options={[
          { value: "pilot", label: "Pilot" }, { value: "stable", label: "Stable" }]} />
        <label htmlFor="kiosk-release-notes">{en ? "Release notes" : "รายละเอียดรุ่น"}</label>
        <Input.TextArea id="kiosk-release-notes" value={notes} maxLength={5000} rows={3}
          onChange={(event) => setNotes(event.target.value)} />
        <Button icon={<UploadOutlined />} disabled={!file || !version || !/^[0-9a-f]{64}$/i.test(sha256) || busy}
          loading={busy} onClick={() => void upload()}>{en ? "Upload as draft" : "อัปโหลดเป็น draft"}</Button>
        {publisherReleases.map((item) => <Space key={item.id} wrap>
          <Typography.Text>{item.version} · {item.channel}</Typography.Text>
          <Tag color={item.signatureStatus === "VALID" ? "green" : "orange"}>{item.signatureStatus}</Tag>
          {item.signerThumbprint && <Typography.Text type="secondary" copyable={{ text: item.signerThumbprint }}>
            {en ? "Signer" : "ผู้ลงนาม"}: {item.signerThumbprint}
          </Typography.Text>}
          <Tag>{item.status}</Tag>
          {item.status !== "HIDDEN" && <Popconfirm title={en ? "Publish this verified release for the selected branch?" : "เผยแพร่รุ่นที่ตรวจแล้วให้สาขาที่เลือก?"}
            onConfirm={() => void manage("publish", item)}><Button size="small" disabled={item.signatureStatus !== "VALID" || busy}>
              {en ? "Publish to branch" : "เผยแพร่ให้สาขา"}</Button></Popconfirm>}
          {item.status !== "HIDDEN" && <Popconfirm title={en ? "Hide this release from every branch?" : "ซ่อนรุ่นนี้จากทุกสาขา?"}
            onConfirm={() => void manage("hide", item)}><Button size="small" danger disabled={busy}>
              {en ? "Hide" : "ซ่อน"}</Button></Popconfirm>}
        </Space>)}
      </Space>
    </Card>}
  </Card>;
}
