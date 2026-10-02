// Public display contract. Credentials and host paths never cross this boundary.
export type LocalLicenseView = {
  available: boolean; registered: boolean; online: boolean;
  licenseCode: string | null; licenseType: string | null; commercialStatus: string | null;
  trialExpiresAt: string | null; trialDaysRemaining: number | null;
  registrationStatus: string | null; reviewRequired: boolean; checkedAt: string | null;
  requestId: string | null; requestStatus: string | null; errorCode: string | null;
};
const states = ["TRIAL_ACTIVE", "TRIAL_EXPIRING", "TRIAL_EXPIRED", "PAID_ACTIVE", "PAYMENT_REVIEW", "CANCELLED"];
export function sanitizeLocalLicenseView(value: unknown, now = Date.now()): LocalLicenseView {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = (key: string, max = 128) => typeof v[key] === "string" && (v[key] as string).length <= max ? v[key] as string : null;
  const date = (key: string) => { const x = text(key); return x && Number.isFinite(Date.parse(x)) ? x : null; };
  const heartbeat = date("heartbeat");
  const available = v.available === true && !!heartbeat && Math.abs(now - Date.parse(heartbeat)) < 180_000;
  const checkedAt = date("checkedAt");
  return {
    available, registered: v.registered === true,
    online: available && v.online === true && !!checkedAt && Math.abs(now - Date.parse(checkedAt)) < 10 * 60_000,
    licenseCode: text("licenseCode"), licenseType: ["TRIAL", "PAID"].includes(String(v.licenseType)) ? String(v.licenseType) : null,
    commercialStatus: states.includes(String(v.commercialStatus)) ? String(v.commercialStatus) : null,
    trialExpiresAt: date("trialExpiresAt"), checkedAt,
    trialDaysRemaining: Number.isInteger(v.trialDaysRemaining) && Number(v.trialDaysRemaining) >= 0 ? Number(v.trialDaysRemaining) : null,
    registrationStatus: text("registrationStatus"), reviewRequired: v.reviewRequired === true,
    requestId: text("requestId"), requestStatus: ["PENDING", "FAILED", "SUCCEEDED"].includes(String(v.requestStatus)) ? String(v.requestStatus) : null,
    errorCode: ["CODE_REJECTED", "LICENSE_MISMATCH", "REQUEST_EXPIRED", "CONNECTION_UNAVAILABLE", "INVALID_RESPONSE", "RECORD_RETRY", "RECEIPT_RETRY"].includes(String(v.errorCode)) ? String(v.errorCode) : null,
  };
}
export function localLicenseBadge(view: LocalLicenseView, th: boolean) {
  if (!view.available) return { color: "default", label: th ? "ตรวจสถานะไม่ได้" : "Status unavailable" };
  if (!view.registered) return { color: "default", label: th ? "ยังไม่ได้ลงทะเบียน" : "Unregistered" };
  if (!view.online) return { color: "default", label: th ? "ตรวจสถานะออนไลน์ไม่ได้" : "Status unavailable" };
  if (view.reviewRequired) return { color: "orange", label: th ? "รอตรวจสอบ" : "Review required" };
  if (view.registrationStatus === "PENDING") return { color: "blue", label: th ? "รอยืนยันการลงทะเบียน" : "Registration pending" };
  switch (view.commercialStatus) {
    case "PAID_ACTIVE": return { color: "green", label: "Licensed" };
    case "TRIAL_ACTIVE": case "TRIAL_EXPIRING": return { color: view.commercialStatus === "TRIAL_EXPIRING" ? "orange" : "blue", label: th ? `Trial · เหลือ ${view.trialDaysRemaining ?? "—"} วัน` : `Trial · ${view.trialDaysRemaining ?? "—"} days left` };
    case "TRIAL_EXPIRED": return { color: "red", label: th ? "Trial หมดอายุ" : "Trial expired" };
    case "PAYMENT_REVIEW": return { color: "orange", label: th ? "รอตรวจสอบการชำระเงิน" : "Payment review" };
    case "CANCELLED": return { color: "default", label: th ? "License ถูกยกเลิก" : "License cancelled" };
    default: return { color: "default", label: th ? "ตรวจสถานะไม่ได้" : "Status unavailable" };
  }
}
