"use client";

import { CheckCircleFilled, CloseCircleOutlined, DownloadOutlined, MessageOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Tag, Typography } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import { RETAIL_LOCAL_PRICING as P, formatRetailLocalBaht } from "@/lib/bms/retailLocalPricing";
import styles from "./pricing.module.css";

const { Title, Paragraph, Text } = Typography;

// Prices come from RETAIL_LOCAL_PRICING only. What a plan buys is support and
// services: the free install keeps selling, updating, backing up and restoring
// forever, and nothing on this page may suggest otherwise.
export default function RetailLocalPricing() {
  const { lang } = useI18n();
  const th = lang !== "en";
  const L = (thText: string, enText: string) => (th ? thText : enText);
  const baht = (amount: number) => formatRetailLocalBaht(amount, th ? "th" : "en");

  const plans = [
    {
      key: "free",
      name: L("ฟรี", "Free"),
      price: baht(P.free.amount),
      unit: L("ใช้ได้ไม่มีวันหมดอายุ", "No expiry"),
      points: [
        L(`Server + POS ${P.free.posDevices} เครื่อง`, `Server + POS on ${P.free.posDevices} device`),
        L("ขาย สต็อก สมาชิก ใบกำกับภาษี", "Sales, stock, members, tax invoices"),
        L("อัปเดตและ backup ได้ตามปกติ", "Updates and backups as normal"),
        L("ช่วยเหลือผ่านคู่มือและผู้ช่วยในระบบ", "Help from the manual and built-in assistant"),
      ],
      action: <Button size="large" block href="#downloads" icon={<DownloadOutlined />}>{L("ดาวน์โหลดฟรี", "Download free")}</Button>,
    },
    {
      key: "plus",
      name: "Local Plus",
      featured: true,
      price: baht(P.plus.amount),
      unit: L("ซื้อครั้งเดียว", "One-time"),
      note: L(`ร้านนำร่อง ${P.pilot.shops} ร้านแรก ${baht(P.pilot.amount)}`, `First ${P.pilot.shops} pilot shops: ${baht(P.pilot.amount)}`),
      points: [
        L("ทุกอย่างในแพ็กเกจฟรี", "Everything in Free"),
        L(`ซัพพอร์ต LINE + รีโมต ${P.plus.supportMonths} เดือน`, `${P.plus.supportMonths} months of LINE and remote support`),
        L("ย้าย License เมื่อเครื่องเสีย", "License transfer when a machine fails"),
        L("ช่วยกู้ข้อมูลจาก backup", "Help restoring from backup"),
      ],
      action: (
        <Button type="primary" size="large" block href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer" icon={<MessageOutlined />}>
          {L("ขอ Activation Code ทาง LINE", "Request an Activation Code on LINE")}
        </Button>
      ),
    },
    {
      key: "renewal",
      name: L("ต่อซัพพอร์ตรายปี", "Yearly support renewal"),
      price: baht(P.supportRenewal.amount),
      unit: L("ต่อปี · ไม่บังคับ", "per year · optional"),
      points: [
        L("ไม่ต่อก็ขายได้ตามปกติ", "Not renewing never stops your shop"),
        L("ซัพพอร์ตและการย้ายเครื่องต่อเนื่อง", "Continued support and machine transfer"),
        L("ได้รุ่นใหญ่ถัดไปเมื่อยังต่ออยู่", "Next major version while renewed"),
      ],
    },
  ];

  const addOns = [
    { label: L("เครื่องขายเพิ่ม", "Extra POS device"), value: `${baht(P.extraDevice.amount)} ${L("/ เครื่อง", "/ device")}` },
    { label: L("ตั้งค่า backup ลง USB/NAS + ทดสอบกู้ข้อมูล", "Backup to USB/NAS setup + restore test"), value: baht(P.backupSetup.amount) },
    { label: L("ติดตั้งให้ถึงร้าน", "On-site installation"), value: L(`เริ่ม ${baht(P.onSiteInstall.fromAmount)}`, `From ${baht(P.onSiteInstall.fromAmount)}`) },
  ];

  const notIncluded = [
    L("รับออร์เดอร์จาก LINE แชท หรือหน้าร้านออนไลน์", "Orders from LINE, chat or an online store"),
    L("หลายสาขา (รุ่นนี้มี 1 ร้าน 1 สาขา)", "Multiple branches (one shop, one branch)"),
    L("AI ต้องใช้คีย์ของร้านเอง", "AI needs your own provider key"),
    L("ย้ายข้อมูลไป BMS Cloud ภายหลัง (ยังไม่มีเครื่องมือ)", "Moving data to BMS Cloud later (no tool yet)"),
  ];

  return (
    <section className={styles.pricing} id="pricing" aria-labelledby="retail-local-pricing-title">
      <div className={styles.heading}>
        <Text className={styles.eyebrow}>{L("ราคา", "PRICING")}</Text>
        <Title level={2} id="retail-local-pricing-title">{L("ลองใช้ฟรีก่อน จ่ายเมื่ออยากได้ซัพพอร์ต", "Try it free. Pay when you want support.")}</Title>
        <Paragraph>
          {L(
            "ติดตั้งแล้วขายได้เลย ไม่ต้องลงทะเบียน ไม่มีวันหมดอายุ และไม่ล็อกเครื่องเมื่อไม่ต่ออายุ",
            "Install and start selling. No registration, no expiry, and nothing locks if you stop paying.",
          )}
        </Paragraph>
        <Text className={styles.vat}>{L("ราคายังไม่รวม VAT 7% · รุ่นนำร่อง (Technical pilot)", "Prices exclude 7% VAT · Technical pilot")}</Text>
      </div>

      <div className={styles.plans}>
        {plans.map((plan) => (
          <article key={plan.key} className={`${styles.plan} ${plan.featured ? styles.planFeatured : ""}`}>
            <div className={styles.planTop}>
              <strong>{plan.name}</strong>
              {plan.featured && <Tag color="blue">{L("แนะนำ", "Recommended")}</Tag>}
            </div>
            <div className={styles.price}>
              <span>{plan.price}</span>
              <small>{plan.unit}</small>
            </div>
            {plan.note && <Text className={styles.pilotNote}>{plan.note}</Text>}
            <ul>
              {plan.points.map((point) => <li key={point}><CheckCircleFilled aria-hidden="true" />{point}</li>)}
            </ul>
            {plan.action && <div className={styles.planAction}>{plan.action}</div>}
          </article>
        ))}
      </div>

      <div className={styles.details}>
        <div className={styles.addOns}>
          <strong>{L("บริการเสริม", "Add-ons")}</strong>
          <dl>
            {addOns.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
          </dl>
          <small>
            {L(
              "เครื่องขายเพิ่มเชื่อกับ Server เดิมได้ทันที กรุณาแจ้ง BMS เพื่อรับสิทธิ์",
              "Extra devices pair with your server right away; please tell BMS to license them.",
            )}
          </small>
        </div>
        <div className={styles.notIncluded}>
          <strong>{L("Retail Local ยังไม่รองรับ", "Not included in Retail Local")}</strong>
          <ul>
            {notIncluded.map((item) => <li key={item}><CloseCircleOutlined aria-hidden="true" />{item}</li>)}
          </ul>
          <a href="/#pricing">{L("ต้องการสิ่งเหล่านี้? ดูแพ็กเกจ BMS Cloud →", "Need these? See BMS Cloud plans →")}</a>
        </div>
      </div>

      <div className={styles.installNote}>
        <SafetyCertificateOutlined aria-hidden="true" />
        <span>
          {L(
            "ไฟล์ติดตั้งรุ่นนำร่องยังไม่ได้ลงลายเซ็นดิจิทัล Windows อาจขึ้น “Windows protected your PC” ให้กด “More info” แล้ว “Run anyway” · macOS อาจต้องอนุญาตใน System Settings › Privacy & Security ตรวจ SHA-256 ของไฟล์ก่อนติดตั้งทุกครั้ง",
            "Pilot installers are not code-signed yet. Windows may show “Windows protected your PC”: choose “More info”, then “Run anyway”. macOS may ask you to allow it in System Settings › Privacy & Security. Always check the file’s SHA-256 first.",
          )}
        </span>
      </div>
    </section>
  );
}
