"use client";
import { Alert, Button, Card } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useRetailLocalMode } from "./RetailLocalMode";
import { retailLocalPricing as p, retailLocalPrice } from "@/lib/bms/retailLocalPricing";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import type { LocalLicenseView } from "@/lib/bms/localLicenseView";
export function LocalPlanCard({ view }: { view?: LocalLicenseView }) {
  const local = useRetailLocalMode(); const { lang } = useI18n(); const th = lang === "th";
  if (!local) return null;
  const state = !view?.available ? (th ? "ตรวจสถานะไม่ได้" : "Status unavailable") : !view.registered ? (th ? "ฟรี" : "Free") : !view.online ? (th ? "ตรวจสถานะล่าสุดไม่ได้" : "Latest status unavailable") : view.commercialStatus === "PAID_ACTIVE" ? "Licensed" : view.licenseType === "TRIAL" ? "Trial" : (th ? "รอตรวจสอบ" : "Under review");
  return <Card title={th ? "แพ็กเกจปัจจุบัน · รุ่นนำร่อง" : "Current plan · Technical pilot"}>
    <strong>{state}</strong><p>{th ? "ไม่ซื้อก็ใช้งานต่อได้" : "Keep operating without purchasing"}</p>
    <Button href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{th ? "ขอ Activation Code ทาง LINE" : "Request an Activation Code on LINE"}</Button>
  </Card>;
}
export function LocalExtraDeviceNotice({ count }: { count: number }) {
  const local = useRetailLocalMode(); const { lang } = useI18n(); const th = lang === "th";
  if (!local || count < p.freeDevices) return null;
  return <Alert closable showIcon type="info" style={{ marginBottom: 16 }} message={th
    ? `ข้อเสนอรุ่นนำร่องรออนุมัติ: ฟรี ${p.freeDevices} เครื่อง เครื่องเพิ่ม ${retailLocalPrice(p.extraDevice)} กรุณาติดต่อ BMS เพื่อรับสิทธิ์ — เพิ่มและขายได้ทันที`
    : `Pilot proposal pending approval: ${p.freeDevices} device free; extra device ${retailLocalPrice(p.extraDevice, "en")}. Contact BMS for licensing — adding devices and selling remain available.`} />;
}
