"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Tag, Typography } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { localLicenseBadge, type LocalLicenseView } from "@/lib/bms/localLicenseView";

const endpoint = "/api/admin/retail-local/local-license";
function useLocalLicense() {
  const { can } = useBmsPermissions();
  const result = useSWR<LocalLicenseView>(can("retail_local.license.view") ? endpoint : null,
    async url => { const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new Error("unavailable"); return response.json(); },
    { refreshInterval: 10_000, dedupingInterval: 5_000, shouldRetryOnError: false });
  return { ...result, canManage: can("retail_local.license.manage"), canView: can("retail_local.license.view") };
}
export function LocalLicenseBadge() {
  const { data, error, canView } = useLocalLicense();
  const { lang } = useI18n();
  if (!canView) return null;
  const badge = data ? localLicenseBadge(error ? { ...data, available: false } : data, lang === "th") : { color: "default", label: lang === "th" ? "สถานะ License" : "License status" };
  return <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
    <Link href="/admin/retail-local-license" aria-label={lang === "th" ? "ดูการลงทะเบียน License" : "View license registration"}>
      <Tag icon={<SafetyCertificateOutlined />} color={badge.color}>{badge.label}</Tag>
    </Link>
  </div>;
}
export default function LocalLicensePage() {
  const { data, error, mutate, canManage, canView } = useLocalLicense();
  const { lang } = useI18n(); const th = lang === "th";
  const L = (thai: string, english: string) => th ? thai : english;
  const [form] = Form.useForm(); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<string | null>(null);
  const retry = useRef<{ code: string; id: string } | null>(null);
  const badge = data ? localLicenseBadge(error ? { ...data, available: false } : data, th) : null;
  const pending = data?.requestStatus === "PENDING";
  const date = (value?: string | null) => value ? new Date(value).toLocaleString(th ? "th-TH" : "en-GB") : "—";
  const submit = ({ code }: { code: string }) => {
    const trimmed = code.trim();
    Modal.confirm({
      title: L("ยืนยันลงทะเบียนเครื่องนี้", "Register this installation?"),
      content: <Space direction="vertical">
        <span>{L("ลงทะเบียนเครื่องและร้านปัจจุบันด้วย Activation Code ลงท้าย", "Register the current shop and installation using the code ending in")} …{trimmed.slice(-4)}</span>
        {data?.registered && <span>{L("ใช้ Code ของ License เดิมเท่านั้น หากกู้คืนร้านมายังเครื่องใหม่ ระบบจะส่งคำขอย้ายให้ BMS ตรวจสอบ การเปลี่ยน Trial เป็น Paid ทำผ่าน BMS โดยไม่ต้องกรอก Code ใหม่", "Use a code for the same license. A restored shop on a new computer requests transfer review. BMS converts Trial to Paid without another code.")}</span>}
      </Space>,
      okText: L("ยืนยันลงทะเบียน", "Confirm registration"), cancelText: L("ยกเลิก", "Cancel"),
      onOk: async () => {
        setBusy(true); setFailure(null);
        if (retry.current?.code !== trimmed) retry.current = { code: trimmed, id: crypto.randomUUID() };
        try {
          const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activationCode: trimmed, requestId: retry.current.id, confirmation: "REGISTER-LOCAL-LICENSE" }) });
          if (!response.ok) {
            const result = await response.json();
            throw new Error(result.error === "activation_in_progress" ? L("มีการลงทะเบียนที่กำลังดำเนินการอยู่", "An activation is already in progress") : L("ส่งคำขอไม่สำเร็จ ตรวจว่า runtime ทำงานแล้วลองอีกครั้ง", "Could not submit. Check the runtime and try again."));
          }
          form.resetFields(); retry.current = null; await mutate();
        } catch (cause) { setFailure(cause instanceof Error ? cause.message : L("ส่งคำขอไม่สำเร็จ", "Request failed")); }
        finally { setBusy(false); }
      },
    });
  };
  if (!canView) return <Alert closable type="warning" message={L("ไม่มีสิทธิ์ดู License", "License access is not permitted")} />;
  return <div style={{ maxWidth: 960, margin: "0 auto" }}>
    <Typography.Title level={2}>{L("การลงทะเบียน Retail Local", "Retail Local registration")}</Typography.Title>
    <Typography.Paragraph>{L("ดูสถานะ License และลงทะเบียนเครื่องนี้เมื่อได้รับ Activation Code จาก BMS", "View the license status and register this installation with an Activation Code from BMS.")}</Typography.Paragraph>
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "center", padding: "12px 0", whiteSpace: "normal" }}>
        <span>{L("License ของเครื่องนี้", "This installation’s license")}</span>
        {badge && <Tag color={badge.color} style={{ whiteSpace: "normal", marginInlineEnd: 0 }}>{badge.label}</Tag>}
      </div>} loading={!data && !error}>
        {data && <Descriptions column={1} size="small">
          <Descriptions.Item label="License">{data.licenseCode ? `LIC-••••${data.licenseCode.slice(-6)}` : "—"}</Descriptions.Item>
          <Descriptions.Item label={L("ประเภท", "Type")}>{data.licenseType ?? "—"}</Descriptions.Item>
          <Descriptions.Item label={L("วันหมดอายุ Trial", "Trial expiry")}>{date(data.trialExpiresAt)}</Descriptions.Item>
          <Descriptions.Item label={L("ตรวจสอบกับ BMS ล่าสุด", "Last checked with BMS")}>{date(data.checkedAt)}</Descriptions.Item>
          {!data.online && data.commercialStatus && <Descriptions.Item label={L("สถานะที่ยืนยันล่าสุด", "Last confirmed status")}>{localLicenseBadge({ ...data, available: true, online: true }, th).label}</Descriptions.Item>}
        </Descriptions>}
        {(error || data && !data.available) && <Alert closable showIcon type="warning" message={L("ติดต่อระบบลงทะเบียนบนเครื่องไม่ได้", "Registration service is unavailable")} description={L("เปิด Retail Local และตรวจว่าใช้ runtime รุ่นที่รองรับหน้านี้ จากนั้นลองใหม่ ร้านยังใช้งานได้ตามปกติ", "Start Retail Local and check that the runtime supports this page, then retry. The shop remains available.")} />}
        {data?.registered && !data.online && data.available && <Alert closable showIcon type="info" message={L("ยังตรวจสอบสถานะล่าสุดกับ BMS ไม่ได้ ข้อมูลด้านบนเป็นผลตรวจครั้งก่อน", "BMS is unavailable. The details above are the last confirmed result.")} />}
        <Button onClick={() => void mutate()} style={{ marginTop: 16 }}>{L("โหลดสถานะอีกครั้ง", "Reload status")}</Button>
      </Card>
      <Alert closable showIcon type="info" message={L("ร้านยังใช้งานได้ แม้ยังไม่ลงทะเบียนหรือ Trial หมดอายุ", "The shop remains available before registration and after trial expiry")} description={L("การติดตั้งไม่ได้เริ่ม Trial 30 วัน ระยะ Trial เริ่มเมื่อ BMS ออก Trial License ให้", "Installation does not start a 30-day trial. The trial begins when BMS issues a trial license.")} />
      {pending && <Alert closable showIcon type="info" message={L("กำลังลงทะเบียน", "Registration in progress")} description={L("ระบบจะรับคำขอภายในประมาณ 1 นาที หากอินเทอร์เน็ตขัดข้องจะลองต่อให้อัตโนมัติ ไม่ต้องกรอก Code ซ้ำ", "The runtime normally picks up the request within one minute. Connection failures are retried automatically; do not re-enter the code.")} />}
      {data?.requestStatus === "FAILED" && <Alert closable showIcon type="warning" message={L("ลงทะเบียนไม่สำเร็จ", "Registration failed")} description={data.errorCode === "LICENSE_MISMATCH" ? L("Code เป็นของ License อื่น จึงไม่ได้เปลี่ยนการลงทะเบียนเดิม กรุณาขอ Code ของ License เดิมจาก BMS", "This code belongs to another license. The existing registration was kept. Request a code for the original license from BMS.") : data.errorCode === "REQUEST_EXPIRED" ? L("คำขอรอระบบบนเครื่องนานเกินไป กรุณาตรวจว่า runtime ทำงานแล้วกรอก Code อีกครั้ง", "The request waited too long for the host runtime. Check that it is running and enter the code again.") : L("Code ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาขอ Code ใหม่จาก BMS", "The code is invalid, expired, or already used. Request a new code from BMS.")} />}
      {data?.requestStatus === "SUCCEEDED" && <Alert closable showIcon type="success" message={L("บันทึกการลงทะเบียนบนเครื่องแล้ว", "Registration saved on this installation")} description={L("สถานะ Trial / Licensed แสดงด้านบนเมื่อ BMS ยืนยันข้อมูลแล้ว", "Trial / Licensed is shown above once BMS confirms the status.")} />}
      {canManage && <Card title={data?.registered ? L("ลงทะเบียน License เดิม / กู้คืนเครื่อง", "Re-register / restore installation") : L("ลงทะเบียน License", "Register license")}>
        <Typography.Paragraph>{L("กรอก Activation Code ที่ขึ้นต้นด้วย bmsla_ เลข LIC- เป็นเลขอ้างอิงและใช้กรอกแทนไม่ได้", "Enter the Activation Code beginning with bmsla_. A LIC- reference cannot be used as an activation code.")}</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="code" label="Activation Code" rules={[{ required: true, message: L("กรุณากรอก Code", "Enter a code") }, { pattern: /^\s*bmsla_[A-Za-z0-9_-]{43}\s*$/, message: L("รูปแบบ Activation Code ไม่ถูกต้อง", "Invalid Activation Code format") }]}>
            <Input.Password autoComplete="off" disabled={busy || pending || !!error || !data?.available} placeholder="bmsla_…" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} disabled={pending || !!error || !data?.available}>{L("ลงทะเบียน License", "Register license")}</Button>
        </Form>
        {failure && <Alert closable showIcon type="error" message={failure} style={{ marginTop: 16 }} />}
      </Card>}
    </Space>
  </div>;
}
