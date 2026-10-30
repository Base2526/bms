"use client";
import { useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, Select, Typography } from "antd";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import { retailLocalPricing as p, retailLocalPrice } from "@/lib/bms/retailLocalPricing";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import styles from "./pricing.module.css";

export default function RetailLocalPricing() {
  const { lang } = useI18n(); const th = lang === "th";
  const L = (a: string, b: string) => th ? a : b;
  const price = (n: number) => retailLocalPrice(n, th ? "th" : "en");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"ok" | "error" | null>(null);
  const [form] = Form.useForm();
  const submit = async (values: Record<string, unknown>) => {
    setBusy(true); setResult(null);
    try {
      const response = await fetch("/api/public/retail-local/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, locale: th ? "th" : "en" }) });
      if (!response.ok) throw new Error("failed");
      setResult("ok"); form.resetFields();
    } catch { setResult("error"); } finally { setBusy(false); }
  };
  return <section id="pricing" className={styles.section}>
    <Typography.Title level={2}>{L("แพ็กเกจ Retail Local · รุ่นนำร่อง", "Retail Local plans · Technical pilot")}</Typography.Title>
    <Alert closable showIcon type="info" message={L("ราคาข้อเสนอ รอเจ้าของอนุมัติ — ขอใบเสนอราคายืนยันก่อนซื้อ", "Proposed prices pending owner approval — request a confirmed quotation before purchase")} />
    <div className={styles.grid}>
      <Card className={styles.plan} title={L("ฟรี", "Free")}>
        <Typography.Title level={3}>{L("0 บาท", "0 THB")}</Typography.Title>
        <p className={styles.sub}>{L("ไม่มีวันหมดอายุ", "No expiry")}</p>
        <ul className={styles.rows}>
          <li className={styles.yes}>{L("ขายได้ครบ ไม่ล็อกฟีเจอร์ขาย", "Full selling features, nothing locked")}</li>
          <li className={styles.yes}>{L(`${p.freeDevices} เครื่อง · 1 ร้าน · 1 สาขา`, `${p.freeDevices} device · one shop · one branch`)}</li>
          <li className={styles.no}>{L("ซัพพอร์ต (มีคู่มือและผู้ช่วย AI)", "Support (guides and AI assistance only)")}</li>
          <li className={styles.no}>{L("ย้าย License เมื่อเครื่องเสีย", "License transfer after host failure")}</li>
        </ul>
        <div className={styles.next}><strong>{L("อยากได้ซัพพอร์ต?", "Need support?")}</strong> {L("อัปเกรดเป็น Local Plus", "Upgrade to Local Plus")}</div>
        <Button href="#downloads">{L("ดาวน์โหลดฟรี", "Download free")}</Button>
      </Card>
      <Card className={styles.plan} title="Local Plus">
        <Typography.Title level={3}>{price(p.plus)}</Typography.Title>
        <p className={styles.sub}>{L(`จ่ายครั้งเดียว · นำร่อง ${p.pilotShops} ร้านแรก ${price(p.pilotPlus)}`, `One-time · first ${p.pilotShops} pilot shops ${price(p.pilotPlus)}`)}</p>
        <ul className={styles.rows}>
          <li className={styles.yes}>{L("ขายได้ครบ ไม่ล็อกฟีเจอร์ขาย", "Full selling features, nothing locked")}</li>
          <li className={styles.yes}>{L("ใช้ได้ไม่มีวันหมดอายุ", "No expiry")}</li>
          <li className={styles.yes}>{L(`ซัพพอร์ต ${p.supportMonths} เดือน`, `${p.supportMonths} months of support`)}</li>
          <li className={styles.yes}>{L("ย้าย License เมื่อเครื่องเสีย", "License transfer after host failure")}</li>
        </ul>
        <div className={styles.next}><strong>{L(`หลัง ${p.supportMonths} เดือน:`, `After ${p.supportMonths} months:`)}</strong> {L(`ใช้ต่อได้ตลอดโดยไม่ต้องจ่าย หรือต่อซัพพอร์ต ${price(p.annualSupport)}/ปี (ไม่บังคับ)`, `keep using it at no cost, or renew support for ${price(p.annualSupport)}/year (optional)`)}</div>
        <Button href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{L("สอบถามทาง LINE", "Ask on LINE")}</Button>
      </Card>
    </div>
    <p>{L(`บริการเพิ่มเติม: เครื่องเพิ่ม ${price(p.extraDevice)}/เครื่อง · ตั้ง backup USB/NAS + ทดสอบ restore ${price(p.backupSetup)} ครั้งเดียว · ติดตั้งถึงร้านเริ่ม ${price(p.onsiteFrom)}`, `Add-ons: extra device ${price(p.extraDevice)} per device · USB/NAS backup setup + restore test ${price(p.backupSetup)} once · onsite installation from ${price(p.onsiteFrom)}`)}</p>
    <p>{L(`ทุกราคายังไม่รวม VAT ${p.vatPercent}% · ขอบเขต MA และรุ่นใหญ่ของการต่อซัพพอร์ตรออนุมัติ`, `All prices exclude ${p.vatPercent}% VAT · MA and major-version terms for support renewal await approval`)}</p>
    <table className={styles.table}><caption>{L("ขอบเขตแพ็กเกจฟรี", "Free plan scope")}</caption><tbody>
      <tr><th>{L("ระบบในร้าน", "In-store system")}</th><td>{L("POS สต็อก รายงาน และข้อมูลอยู่ที่ร้าน", "POS, inventory, reports and locally stored data")}</td></tr>
      <tr><th>{L("ออนไลน์", "Online services")}</th><td>{L("ไม่รวมบริการเชื่อม LINE/แชท/ออเดอร์ออนไลน์ที่ BMS ดูแลให้", "BMS-managed LINE/chat/online-order services are not included")}</td></tr>
      <tr><th>Backup</th><td>{L("ร้านเก็บที่ USB/NAS เอง BMS ไม่ host backup", "Use your own USB/NAS. BMS does not host backups.")}</td></tr>
      <tr><th>Local → Cloud</th><td>{L("ยังไม่มีเครื่องมือย้ายข้อมูล", "Data migration tooling is not available")}</td></tr>
    </tbody></table>
    <Card className={styles.lead} title={p.leadOffer[th ? "th" : "en"]}>
      <p>{L("ฝากข้อมูลได้ตามสมัครใจ การดาวน์โหลดไม่ต้องกรอกฟอร์มหรือลงทะเบียน ข้อเสนอความช่วยเหลือรอเจ้าของอนุมัติ", "Leaving contact details is optional. Downloads require no form or registration. The assistance offer awaits owner approval.")}</p>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ platform: "windows" }}>
        <div className={styles.fields}>
          <Form.Item name="shopName" label={L("ชื่อร้าน", "Shop name")}><Input maxLength={120} /></Form.Item>
          <Form.Item name="contactName" label={L("ชื่อผู้ติดต่อ", "Contact name")}><Input maxLength={120} /></Form.Item>
          <Form.Item name="phone" label={L("เบอร์โทรไทย (กรอกเบอร์หรือ LINE อย่างน้อยหนึ่งช่อง)", "Thai phone (phone or LINE is required)")} dependencies={["lineId"]} rules={[({ getFieldValue }) => ({ validator(_, v) { return v?.trim() || getFieldValue("lineId")?.trim() ? Promise.resolve() : Promise.reject(new Error(L("กรอกเบอร์หรือ LINE", "Enter phone or LINE"))); } })]}><Input maxLength={24} autoComplete="tel" /></Form.Item>
          <Form.Item name="lineId" label="LINE ID"><Input maxLength={50} /></Form.Item>
          <Form.Item name="businessType" label={L("ประเภทร้าน", "Business type")}><Input maxLength={80} /></Form.Item>
          <Form.Item name="platform" label={L("ระบบปฏิบัติการ", "Operating system")} rules={[{ required: true }]}><Select options={["windows", "ubuntu", "macos"].map(value => ({ value, label: value }))} /></Form.Item>
        </div>
        <Form.Item name="consent" valuePropName="checked" rules={[{ validator: (_, v) => v === true ? Promise.resolve() : Promise.reject(new Error(L("กรุณายืนยันความยินยอม", "Consent is required"))) }]}><Checkbox>{L("ยินยอมให้ BMS เก็บและใช้ข้อมูลที่กรอกเพื่อติดต่อเรื่องการติดตั้งและข้อเสนอ Retail Local ตาม", "I consent to BMS storing and using these details to contact me about Retail Local installation and offers under the")} <Link href="/privacy" target="_blank">{L("นโยบายความเป็นส่วนตัว", "privacy policy")}</Link></Checkbox></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>{L("ส่งข้อมูลติดต่อ", "Submit contact details")}</Button>
      </Form>
      {result && <Alert closable showIcon type={result === "ok" ? "success" : "error"} message={result === "ok" ? L("บันทึกข้อมูลแล้ว", "Details saved") : L("ส่งไม่สำเร็จ ตรวจเบอร์/LINE และลองใหม่ภายหลัง คุณยังดาวน์โหลดได้", "Could not submit. Check phone/LINE and retry later. Downloads remain available.")} />}
    </Card>
  </section>;
}
