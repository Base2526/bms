export type CustomerConfirmationLine = {
  fieldKey: string;
  label: string;
  valueText: string;
};

export const CUSTOMER_CONFIRMATION_LABELS: Record<string, string> = {
  patient_relationship: "ผู้มีอาการ",
  patient_age_years: "อายุ",
  biological_sex: "เพศกำเนิด",
  pregnancy_status: "ตั้งครรภ์",
  breastfeeding_status: "ให้นมบุตร",
  duration_days: "ระยะเวลา (วัน)",
  duration_hours: "ระยะเวลา (ชั่วโมง)",
  severity: "ความรุนแรง",
  has_fever: "มีไข้",
  fever_temp: "อุณหภูมิ",
  sputum: "เสมหะ",
  breathing_difficulty: "หายใจลำบาก",
  chest_pain: "เจ็บ/แน่นหน้าอก",
  hydration_status: "ขาดน้ำ",
  frequency_per_day: "ความถี่ต่อวัน",
  allergies: "ประวัติแพ้ยา",
  current_medications: "ยาที่ใช้อยู่",
  chronic_diseases: "โรคประจำตัว",
  blood_in_stool: "เลือดปนในอุจจาระ",
  blood_in_sputum: "เลือดปนในเสมหะ",
  high_fever: "ไข้สูง",
  neck_stiffness: "คอแข็ง",
};

export function formatCustomerConfirmationValue(value: string | number | boolean | null | undefined) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่ใช่";
  const labels: Record<string, string> = {
    SELF: "ตัวเอง",
    CHILD: "ลูก",
    PARENT: "พ่อแม่",
    OTHER: "บุคคลอื่น",
    MALE: "ชาย",
    FEMALE: "หญิง",
    YES: "มี / ใช่",
    NO: "ไม่มี / ไม่ใช่",
    NONE: "ไม่มี",
    UNKNOWN: "ไม่ทราบ",
    NOT_APPLICABLE: "ไม่เกี่ยวข้อง",
  };
  if (typeof value === "string" && labels[value.trim().toUpperCase()]) {
    return labels[value.trim().toUpperCase()];
  }
  return String(value);
}

export function buildCustomerConfirmationLinesFromAnswers(
  answers: Record<string, string | number | boolean | null | undefined> | null | undefined
): CustomerConfirmationLine[] {
  return Object.entries(answers || {})
    // Keys prefixed with __ are server/session bookkeeping (for example the
    // product cart JSON) and must never leak into a customer-facing summary.
    .filter(([fieldKey]) => !fieldKey.startsWith("__"))
    .map(([fieldKey, value]) => ({
      fieldKey,
      label: CUSTOMER_CONFIRMATION_LABELS[fieldKey] || fieldKey,
      valueText: formatCustomerConfirmationValue(value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
}

export function normalizeCustomerConfirmationLines(
  lines: Array<{ fieldKey?: string | null; label?: string | null; valueText?: string | null }> | null | undefined
): CustomerConfirmationLine[] {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      fieldKey: String(line?.fieldKey || ""),
      label: String(line?.label || line?.fieldKey || "unknown"),
      valueText: String(line?.valueText || "—"),
    }))
    .filter((line) => line.fieldKey || line.label);
}

export function getCompletenessTagMeta(completenessStatus?: string | null) {
  if (completenessStatus === "COMPLETE") return { color: "green", text: "COMPLETE" };
  if (completenessStatus === "CONFLICT") return { color: "red", text: "CONFLICT" };
  if (completenessStatus === "INCOMPLETE") return { color: "gold", text: "INCOMPLETE" };
  return { color: "default", text: completenessStatus || "UNKNOWN" };
}

export function getCustomerConfirmationTagMeta(status?: string | null) {
  if (status === "CONFIRMED") return { color: "green", text: "CONFIRMED" };
  if (status === "PENDING") return { color: "gold", text: "PENDING" };
  return { color: "default", text: status || "NOT_REQUESTED" };
}

export function formatCustomerConfirmationClipboardText(
  lines: CustomerConfirmationLine[],
  options?: { protocolKey?: string | null; completenessStatus?: string | null; confirmationStatus?: string | null }
) {
  const header = [
    options?.protocolKey ? `Protocol: ${options.protocolKey}` : null,
    options?.completenessStatus ? `Completeness: ${options.completenessStatus}` : null,
    options?.confirmationStatus ? `Confirmation: ${options.confirmationStatus}` : null,
  ].filter(Boolean);

  const body = lines.map((line) => `- ${line.label}: ${line.valueText}`);
  return [...header, ...body].join("\n");
}
