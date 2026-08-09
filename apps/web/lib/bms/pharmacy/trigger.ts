// Deterministic boundary shared by the real customer pipeline and the
// standalone Pharmacy Intake Lab. Keep this module side-effect free so both
// entry points classify the same wording before any assessment is created.

import type { PharmacyTriggerDefinition } from "./protocols";

const LEGACY_TRIGGER_DEFINITIONS: PharmacyTriggerDefinition[] = [
  { protocolKey: "headache", displayLabel: "ปวดหัว", triggerTerms: ["ปวดหัว", "ปวดศีรษะ", "migraine", "headache"] },
  { protocolKey: "cough", displayLabel: "ไอ", triggerTerms: ["ไอ", "cough"] },
  { protocolKey: "diarrhea", displayLabel: "ท้องเสีย", triggerTerms: ["ท้องเสีย", "ถ่ายเหลว", "diarrhea"] },
];

const AMBIGUOUS_HEALTH_PRODUCT_PATTERN =
  /(?:(?:มี|ขาย|หา|ขอ|ซื้อ|สั่ง|เอา)\s*(?:ปวดหัว|ปวดศีรษะ|migraine|headache|ไอ(?!ศ)|cough|ท้องเสีย|ถ่ายเหลว|diarrhea)|(?:ปวดหัว|ปวดศีรษะ|migraine|headache|ไอ(?!ศ)|cough|ท้องเสีย|ถ่ายเหลว|diarrhea)\s*(?:มีไหม|มีมั้ย|ราคา(?:เท่าไร|เท่าไหร่)|กี่บาท))\s*(?:ไหม|มั้ย|ป่าว|หรือเปล่า)?$/i;
const MEDICINE_PRODUCT_PATTERN =
  /(มียา|ขายยา|ซื้อยา|หายา|ขอยา|สั่งยา|รับยา|ยา(?:แก้|สำหรับ|อะไร|ตัวไหน|ชนิดไหน|เม็ด|น้ำ)|ใช้ยา|ชื่อยา|แพ้ยา|ยาประจำ|แก้|บรรเทา|ลดอาการ|พารา|paracetamol|ibuprofen|ไอบู|aspirin|แอสไพริน|เม็ด|แผง|ขวด|ซอง)/i;
const CLINICAL_ADVICE_PATTERN =
  /(ทำไง|ทำอย่างไร|กินอะไร|ใช้ยาอะไร|ควรกิน|ควรทำ|เป็นอะไร|อาการ|เป็นมา|รุนแรง|มาก|ไม่หาย|มีไข้|เวียนหัว|คลื่นไส้|อาเจียน|ลูก|เด็ก|คนท้อง|ตั้งครรภ์|ให้นม|แพ้ยา|โรคประจำตัว|ยาประจำ)/i;
const EMERGENCY_PATTERN =
  /(หมดสติ|ชัก|หายใจไม่ออก|เจ็บหน้าอก|แน่นหน้าอก|หน้าเบี้ยว|ปากเบี้ยว|แขนชา|ขาชา|แขนขาอ่อนแรง|พูดไม่ชัด|คอแข็ง|ตามัว|มองไม่ชัด|ฉับพลัน|ปวดหัว(?:รุนแรง|ที่สุด|แบบไม่เคยเป็น)|ปวดศีรษะ(?:รุนแรง|ที่สุด|แบบไม่เคยเป็น))/i;
const PRODUCT_REQUEST_PATTERN =
  /(?:ขอซื้อ|ต้องการซื้อ|อยากซื้อ|ขอสั่ง|สั่งซื้อ|เอา|รับ|มี|ขาย|หา)\s*\S+/i;
const SPECIFIC_PHARMACY_PRODUCT_PATTERN =
  /(พารา(?:เซตามอล)?|paracetamol|acetaminophen|ibuprofen|ไอบูโพรเฟน|aspirin|แอสไพริน|loratadine|ลอราทาดีน|domperidone|โดมเพอริโดน|ors|เกลือแร่|ผ้าก๊อซ|ยาแดง|แอลกอฮอล์|พลาสเตอร์|สำลี|ปรอท|หน้ากาก)/i;
const PRODUCT_SPECIFICATION_PATTERN =
  /\d+(?:\.\d+)?\s*(?:มก\.?|mg|กรัม|g|มล\.?|ml|เม็ด|แคปซูล|แผง|ซอง|ขวด|กล่อง|ชิ้น|นิ้ว)/i;
const GENERIC_SYMPTOM_MEDICINE_PATTERN =
  /ยา\s*(?:แก้|สำหรับ)?\s*(?:ปวดหัว|ปวดศีรษะ|ไอ|ท้องเสีย|ถ่ายเหลว|ไข้|แพ้|คลื่นไส้|อาเจียน)(?!\s*\d)/i;

export type PharmacyIntakeTriggerIntent = "ambiguous" | "clinical_advice" | "medicine_product" | "emergency";

/**
 * Product requests with an identifiable product go straight to catalog/policy lookup.
 * Generic requests such as "ยาแก้ไอให้ลูก" deliberately stay ambiguous because the
 * customer may be asking for clinical assessment rather than naming a product.
 */
export function isExplicitPharmacyProductRequest(message: string): boolean {
  const text = String(message || "").trim();
  if (!text || !PRODUCT_REQUEST_PATTERN.test(text)) return false;
  const hasSpecificProduct = SPECIFIC_PHARMACY_PRODUCT_PATTERN.test(text);
  const hasSpecification = PRODUCT_SPECIFICATION_PATTERN.test(text);
  if (AMBIGUOUS_HEALTH_PRODUCT_PATTERN.test(text) && !hasSpecificProduct && !hasSpecification) return false;
  if (GENERIC_SYMPTOM_MEDICINE_PATTERN.test(text) && !hasSpecificProduct && !hasSpecification) return false;
  return true;
}

/** Keep strength/size descriptors, but remove chat verbs, requested pack count and politeness. */
export function normalizePharmacyProductSearchText(message: string): string {
  return String(message || "")
    .trim()
    .replace(/^(?:ขอซื้อ|ต้องการซื้อ|อยากซื้อ|ขอสั่ง|สั่งซื้อ|เอา|รับ|มี|ขาย|หา)\s*/i, "")
    .replace(/(?:ไหม|มั้ย|หรือเปล่า|ป่าว)?\s*(?:คะ|ค่ะ|ครับ|นะคะ|นะครับ)?\s*$/i, "")
    .replace(/\s+\d+\s*(?:แผง|กล่อง|ขวด|ซอง|ชิ้น|ชุด|แพ็ค|แพ็ก|pack)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPharmacyIntakeTrigger(
  message: string,
  definitions: PharmacyTriggerDefinition[] = LEGACY_TRIGGER_DEFINITIONS
): { protocolKey: string; intent: PharmacyIntakeTriggerIntent } | null {
  const text = String(message || "").trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const definition of definitions) {
    const matched = definition.triggerTerms.some((rawTerm) => {
      const term = String(rawTerm || "").trim().toLowerCase();
      if (!term) return false;
      if (term === "ไอ") return /ไอ(?!ศ)/i.test(text);
      return normalized.includes(term);
    });
    if (!matched) continue;
    if (EMERGENCY_PATTERN.test(text)) return { protocolKey: definition.protocolKey, intent: "emergency" };
    const productShaped =
      AMBIGUOUS_HEALTH_PRODUCT_PATTERN.test(text) ||
      /^(?:มี|ขาย|หา|ขอ|ซื้อ|สั่ง|เอา).*(?:ไหม|มั้ย|ป่าว|หรือเปล่า)$/i.test(text) ||
      /(?:ราคา(?:เท่าไร|เท่าไหร่)|กี่บาท)$/i.test(text);
    if (productShaped && !MEDICINE_PRODUCT_PATTERN.test(text)) {
      return { protocolKey: definition.protocolKey, intent: "ambiguous" };
    }
    if (MEDICINE_PRODUCT_PATTERN.test(text)) return { protocolKey: definition.protocolKey, intent: "medicine_product" };
    if (CLINICAL_ADVICE_PATTERN.test(text)) return { protocolKey: definition.protocolKey, intent: "clinical_advice" };
    return { protocolKey: definition.protocolKey, intent: "clinical_advice" };
  }
  return null;
}

export function pharmacyEmergencyReply(): string {
  return "จากอาการที่พิมพ์มาอาจมีสัญญาณที่ควรให้แพทย์ประเมินทันทีนะคะ แนะนำติดต่อฉุกเฉินหรือไปโรงพยาบาลใกล้ที่สุดก่อนค่ะ";
}

export function pharmacyAmbiguousClarificationReply(
  protocolKey: string,
  definitions: PharmacyTriggerDefinition[] = LEGACY_TRIGGER_DEFINITIONS
): string {
  const symptom = definitions.find((item) => item.protocolKey === protocolKey)?.displayLabel || "อาการนี้";
  return `ขอเช็กให้ชัดเจนนะคะ คุณมีชื่อหรือยี่ห้อสินค้าที่ต้องการซื้ออยู่แล้ว หรือกำลังมีอาการ${symptom}และต้องการให้เภสัชกรช่วยประเมินคะ?`;
}

export function normalizePharmacyClarificationReply(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  definitions: PharmacyTriggerDefinition[] = LEGACY_TRIGGER_DEFINITIONS
): string | null {
  const text = String(message || "").trim();
  if (!text || history.length === 0) return null;
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const definition = definitions.find((item) =>
    lastAssistant.includes("ชื่อหรือยี่ห้อสินค้าที่ต้องการซื้อ") &&
    lastAssistant.includes(`อาการ${item.displayLabel}`)
  );
  if (!definition) return null;
  const symptom = definition.displayLabel;

  if (/(?:มีชื่อ|มียี่ห้อ|ซื้อสินค้า|ซื้อยา|ระบุสินค้า|อันแรก|อย่างแรก|ข้อแรก|แบบแรก)/i.test(text)) {
    return "ต้องการซื้อสินค้าที่มีชื่อหรือยี่ห้ออยู่แล้ว";
  }
  if (/(?:ให้เภสัชกร|คัดกรอง|เช็กอาการ|ตรวจอาการ|ปรึกษาอาการ|อันหลัง|อย่างหลัง|ข้อสอง|แบบสอง)/i.test(text)) {
    return `${symptom} อยากคัดกรองอาการเบื้องต้น`;
  }
  return null;
}
