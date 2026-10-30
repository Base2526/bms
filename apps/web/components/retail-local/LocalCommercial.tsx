"use client";
import { Alert, Button, Card } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useRetailLocalMode } from "./RetailLocalMode";
import { retailLocalPricing as p, retailLocalPrice, shouldShowExtraDeviceNotice } from "@/lib/bms/retailLocalPricing";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import { localPlanLabel, type LocalLicenseView } from "@/lib/bms/localLicenseView";

export function LocalPlanCard({ view }: { view?: LocalLicenseView }) {
  const local = useRetailLocalMode(); const { lang } = useI18n(); const th = lang === "th";
  if (!local) return null;
  const paid = view?.available === true && view.registered && view.commercialStatus === "PAID_ACTIVE";
  return <Card title={th ? "แพ็กเกจปัจจุบัน · รุ่นนำร่อง" : "Current plan · Technical pilot"}>
    <strong>{localPlanLabel(view, th)}</strong>
    <p>{paid
      ? (th ? "ติดต่อทีม BMS ได้ทาง LINE สำหรับซัพพอร์ตและการย้ายเครื่อง" : "Reach the BMS team on LINE for support and machine transfer")
      : (th ? "ไม่ซื้อก็ใช้งานต่อได้" : "Keep operating without purchasing")}</p>
    <Button href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">
      {paid ? (th ? "ติดต่อทีม BMS ทาง LINE" : "Contact BMS on LINE") : (th ? "ขอ Activation Code ทาง LINE" : "Request an Activation Code on LINE")}
    </Button>
  </Card>;
}

// Informational only — licensing never blocks adding a device or selling.
export function LocalExtraDeviceNotice({ count, adding = false }: { count: number; adding?: boolean }) {
  const local = useRetailLocalMode(); const { lang } = useI18n(); const th = lang === "th";
  if (!local || !shouldShowExtraDeviceNotice(count, adding)) return null;
  const extra = retailLocalPrice(p.extraDevice, th ? "th" : "en");
  const message = adding
    ? (th
      ? `เครื่องที่ ${count + 1} เกินแพ็กเกจฟรี (${p.freeDevices} เครื่อง) — ข้อเสนอรุ่นนำร่อง ${extra}/เครื่อง กรุณาติดต่อ BMS เพื่อรับสิทธิ์ · เพิ่มและขายได้ทันที`
      : `Device ${count + 1} is beyond the free plan (${p.freeDevices} device). Pilot proposal: ${extra} per device — contact BMS for licensing. You can add it and sell right away.`)
    : (th
      ? `ร้านมีเครื่องขาย ${count} เครื่อง แพ็กเกจฟรีครอบคลุม ${p.freeDevices} เครื่อง — ข้อเสนอรุ่นนำร่อง ${extra}/เครื่อง กรุณาติดต่อ BMS เพื่อรับสิทธิ์ · ขายได้ตามปกติ`
      : `This shop has ${count} devices; the free plan covers ${p.freeDevices}. Pilot proposal: ${extra} per device — contact BMS for licensing. Selling continues as normal.`);
  return <Alert closable showIcon type="info" style={{ marginBottom: 16 }} message={message}
    description={<a href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">{th ? "ติดต่อทาง LINE" : "Contact on LINE"}</a>} />;
}
