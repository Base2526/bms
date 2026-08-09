import { getActivePharmacyProtocolByKey, listActivePharmacyTriggerDefinitions } from "./protocols";
import { computeMissingFields, evaluateAnswer, type KnownFields, type ProtocolDefinition } from "./ruleEngine";
import {
  detectPharmacyIntakeTrigger,
  isExplicitPharmacyProductRequest,
  normalizePharmacyProductSearchText,
  pharmacyAmbiguousClarificationReply,
  pharmacyEmergencyReply,
} from "./trigger";
import { listSellableProducts } from "../products";
import { listPharmacyProductPolicies } from "./productPolicy";
import {
  pharmacyRouterReply,
  routePharmacyConversationMessage,
} from "./conversationRouter";

function resolvedTriggerDefinitions(definitions: Awaited<ReturnType<typeof listActivePharmacyTriggerDefinitions>>) {
  return definitions.length > 0 ? definitions : undefined;
}

export type PharmacyTestPhase =
  | "NONE"
  | "AWAITING_INTENT_CLARIFICATION"
  | "PRODUCT_PURCHASE"
  | "AWAITING_CONSENT"
  | "ASKING"
  | "PENDING_CONFIRMATION"
  | "WAITING";

export type PharmacyTestSession = {
  protocolKey?: string;
  phase?: PharmacyTestPhase;
  protocolId?: string;
  answers?: Record<string, string | number>;
  currentQuestionKey?: string | null;
  currentFieldKey?: string | null;
};

export type PharmacyTestResult = {
  reply: string;
  session: PharmacyTestSession;
};

const PRODUCT_SESSION_KEYS = {
  sku: "__product_sku",
  name: "__product_name",
  qty: "__product_qty",
  price: "__product_price",
  salePolicy: "__product_sale_policy",
  cart: "__product_cart",
  options: "__product_options",
  size: "__product_size",
  sizeOptions: "__product_size_options",
} as const;

type ProductCartItem = {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  salePolicy: string;
  size?: string;
};

type ProductSelectionOption = {
  sku: string;
  name: string;
};

type ProductSizeOption = {
  size: string;
  available: number;
};

function normalizeCartMatchText(text: string): string {
  return text.trim().toLowerCase();
}

function parseProductCart(answers: Record<string, string | number>): ProductCartItem[] {
  const raw = answers[PRODUCT_SESSION_KEYS.cart];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ProductCartItem[] => {
      const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const qty = Number(item?.qty);
      const unitPrice = Number(item?.unitPrice);
      const salePolicy = typeof item?.salePolicy === "string" ? item.salePolicy : "UNKNOWN";
      const size = typeof item?.size === "string" ? item.size.trim() : "";
      if (!sku || !name || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return [];
      return [{ sku, name, qty, unitPrice, salePolicy, ...(size ? { size } : {}) }];
    });
  } catch {
    return [];
  }
}

function saveProductCart(
  answers: Record<string, string | number>,
  cart: ProductCartItem[]
): Record<string, string | number> {
  return { ...answers, [PRODUCT_SESSION_KEYS.cart]: JSON.stringify(cart) };
}

function parseProductSelectionOptions(
  answers: Record<string, string | number>
): ProductSelectionOption[] {
  const raw = answers[PRODUCT_SESSION_KEYS.options];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ProductSelectionOption[] => {
      const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      return sku && name ? [{ sku, name }] : [];
    });
  } catch {
    return [];
  }
}

function saveProductSelectionOptions(
  answers: Record<string, string | number>,
  options: ProductSelectionOption[]
): Record<string, string | number> {
  return { ...answers, [PRODUCT_SESSION_KEYS.options]: JSON.stringify(options) };
}

function parseProductSizeOptions(
  answers: Record<string, string | number>
): ProductSizeOption[] {
  const raw = answers[PRODUCT_SESSION_KEYS.sizeOptions];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ProductSizeOption[] => {
      const size = typeof item?.size === "string" ? item.size.trim() : "";
      const available = Number(item?.available);
      return size && Number.isFinite(available) && available > 0 ? [{ size, available }] : [];
    });
  } catch {
    return [];
  }
}

function saveProductSizeOptions(
  answers: Record<string, string | number>,
  options: ProductSizeOption[]
): Record<string, string | number> {
  return { ...answers, [PRODUCT_SESSION_KEYS.sizeOptions]: JSON.stringify(options) };
}

function resolveProductSelectionOption(
  answers: Record<string, string | number>,
  text: string
): ProductSelectionOption | null {
  const options = parseProductSelectionOptions(answers);
  if (options.length === 0) return null;
  const normalized = text.trim().toLowerCase();
  const numericChoice = Number(toArabicDigits(normalized));
  if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= options.length) {
    return options[numericChoice - 1];
  }
  return options.find((item) => item.sku.toLowerCase() === normalized) ?? null;
}

function resolveProductSizeOption(
  answers: Record<string, string | number>,
  text: string
): ProductSizeOption | null {
  const options = parseProductSizeOptions(answers);
  if (options.length === 0) return null;
  const normalized = text.trim().toLowerCase();
  const numericChoice = Number(toArabicDigits(normalized));
  if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= options.length) {
    return options[numericChoice - 1];
  }
  return options.find((item) => item.size.toLowerCase() === normalized) ?? null;
}

function formatBaht(value: number): string {
  return `${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
}

function formatProductCart(cart: ProductCartItem[]): string {
  const lines = cart.map((item, index) => {
    const subtotal = item.unitPrice * item.qty;
    const itemLabel = item.size ? `${item.name} (${item.sku} · ${item.size})` : `${item.name} (${item.sku})`;
    return `${index + 1}. ${itemLabel}\n   ${item.qty} × ${formatBaht(item.unitPrice)} = ${formatBaht(subtotal)}`;
  });
  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  return [...lines, `รวม ${cart.reduce((sum, item) => sum + item.qty, 0)} ชิ้น จาก ${cart.length} รายการ`, `ยอดรวม: ${formatBaht(total)}`].join("\n");
}

function requestedProductQuantity(text: string): number {
  const normalized = toArabicDigits(text);
  const qtyMatch = normalized.match(/(\d+)\s*(?:ชิ้น|กล่อง|แพ็ค|แผง|ขวด|ซอง|หลอด|ชุด)/i);
  const parsed = qtyMatch ? Number(qtyMatch[1]) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function explicitProductQuantity(text: string): number | null {
  const match = toArabicDigits(text.trim()).match(/^(?:จำนวน\s*)?(\d+)\s*(?:ชิ้น|กล่อง|แพ็ค|แพ็ก|แผง|ขวด|ซอง|หลอด|ชุด)?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveCartRemovalTarget(
  cart: ProductCartItem[],
  text: string,
  selectedSku: string | null
): ProductCartItem | null {
  const normalized = normalizeCartMatchText(text);
  const explicitMatch = normalized.match(/^(?:ลบ|เอาออก|remove)\s+(.+)$/i);
  const targetText = explicitMatch?.[1]?.trim();
  if (targetText) {
    const targetNormalized = normalizeCartMatchText(targetText);
    const bySku = cart.find((item) => item.sku.toLowerCase() === targetNormalized);
    if (bySku) return bySku;
    const byName = cart.find((item) => item.name.toLowerCase() === targetNormalized);
    if (byName) return byName;
    const numericIndex = Number(targetText);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= cart.length) {
      return cart[numericIndex - 1];
    }
  }
  if (/^(?:ลบรายการล่าสุด|ลบสินค้าล่าสุด)$/i.test(text) && cart.length > 0) {
    return selectedSku
      ? cart.find((item) => item.sku === selectedSku) ?? cart[cart.length - 1]
      : cart[cart.length - 1];
  }
  return null;
}

export const __pharmacyProductCartTest = {
  parseProductCart,
  formatProductCart,
  requestedProductQuantity,
  explicitProductQuantity,
  resolveCartRemovalTarget,
  parseProductSelectionOptions,
  resolveProductSelectionOption,
  parseProductSizeOptions,
  resolveProductSizeOption,
};

const FIELD_META: Record<string, { label: string; type: "free_text" | "yes_no" | "number" | "duration" | "choice" }> = {
  onset_days: { label: "มีอาการปวดหัวมานานกี่วันแล้วคะ", type: "duration" },
  duration_days: { label: "มีอาการไอมานานกี่วันแล้วคะ", type: "duration" },
  duration_hours: { label: "เริ่มถ่ายเหลวมานานกี่ชั่วโมงแล้วคะ", type: "duration" },
  frequency_per_day: { label: "วันนี้ถ่ายเหลวประมาณกี่ครั้งคะ", type: "number" },
  severity: { label: "ถ้าให้คะแนนความปวดจาก 1-10 ตอนนี้อยู่ที่เท่าไรคะ", type: "number" },
  location: { label: "ปวดบริเวณไหนของศีรษะคะ เช่น ขมับ หน้าผาก หรือท้ายทอย", type: "free_text" },
  sputum: { label: "มีเสมหะไหมคะ ถ้ามีเป็นสีอะไร", type: "free_text" },
  has_fever: { label: "มีไข้ร่วมด้วยไหมคะ", type: "yes_no" },
  fever_temp: { label: "วัดอุณหภูมิได้เท่าไรคะ", type: "number" },
  hydration_status: { label: "มีอาการปากแห้ง ปัสสาวะน้อย หรือหน้ามืดไหมคะ", type: "yes_no" },
  allergies: { label: "มีประวัติแพ้ยาหรือไม่คะ ถ้ามี รบกวนระบุชื่อยา", type: "free_text" },
  current_medications: { label: "ขณะนี้มียาหรืออาหารเสริมที่ใช้อยู่ไหมคะ ถ้ามี รบกวนระบุชื่อ", type: "free_text" },
  neck_stiffness: { label: "มีคอแข็งหรือก้มหน้าไม่ได้ร่วมด้วยไหมคะ", type: "yes_no" },
  worst_ever: { label: "อาการนี้เกิดขึ้นฉับพลันและรุนแรงที่สุดเท่าที่เคยเป็นไหมคะ", type: "yes_no" },
  neuro_symptoms: { label: "มีแขนขาอ่อนแรง พูดไม่ชัด หรือมองเห็นผิดปกติไหมคะ", type: "yes_no" },
  recent_head_injury: { label: "ก่อนปวดหัวมีศีรษะกระแทกหรือได้รับบาดเจ็บไหมคะ", type: "yes_no" },
  blood_in_sputum: { label: "มีเลือดปนในเสมหะไหมคะ", type: "yes_no" },
  breathing_difficulty: { label: "มีหายใจลำบาก หอบเหนื่อย หรือหายใจไม่อิ่มไหมคะ", type: "yes_no" },
  chest_pain: { label: "มีเจ็บหรือแน่นหน้าอกร่วมด้วยไหมคะ", type: "yes_no" },
  blood_in_stool: { label: "มีเลือดปนในอุจจาระหรืออุจจาระดำไหมคะ", type: "yes_no" },
  high_fever: { label: "มีไข้สูงร่วมด้วยไหมคะ", type: "yes_no" },
  patient_relationship: { label: "ผู้ที่มีอาการคือตัวคุณเอง ลูก พ่อแม่ หรือบุคคลอื่นคะ", type: "choice" },
  patient_age_years: { label: "ผู้ที่มีอาการอายุเท่าไรคะ", type: "number" },
  biological_sex: { label: "เพศกำเนิดของผู้ที่มีอาการคือหญิงหรือชายคะ", type: "choice" },
  pregnancy_status: { label: "ขณะนี้ตั้งครรภ์หรือมีโอกาสตั้งครรภ์ไหมคะ", type: "yes_no" },
  breastfeeding_status: { label: "ขณะนี้ให้นมบุตรอยู่ไหมคะ", type: "yes_no" },
};

const SAFETY_FIELDS_BY_PROTOCOL: Record<string, string[]> = {
  headache: ["neck_stiffness", "worst_ever", "neuro_symptoms", "recent_head_injury"],
  cough: ["blood_in_sputum", "breathing_difficulty", "chest_pain"],
  diarrhea: ["blood_in_stool", "high_fever", "patient_age_years"],
};

function enrichProtocolForSafeTest(protocol: ProtocolDefinition): ProtocolDefinition {
  const existing = new Set(protocol.requiredFields.map((field) => field.key));
  const safetyKeys = [...new Set(["patient_relationship", "patient_age_years", "biological_sex", ...(SAFETY_FIELDS_BY_PROTOCOL[protocol.protocolKey] ?? [])])];
  const safetyFields: ProtocolDefinition["requiredFields"] = safetyKeys
    .filter((key) => !existing.has(key))
    .map((key) => ({
      key,
      label: FIELD_META[key]?.label ?? key,
      type: FIELD_META[key]?.type ?? "free_text",
      questionKey: `q_safety_${key}`,
    }));
  const existingConditional = new Set(protocol.conditionalQuestions.map((field) => field.key));
  const medicationSafetyConditional: ProtocolDefinition["conditionalQuestions"] = ["pregnancy_status", "breastfeeding_status"]
    .filter((key) => !existingConditional.has(key))
    .map((key) => ({
      key,
      label: FIELD_META[key].label,
      type: FIELD_META[key].type,
      questionKey: `q_safety_${key}`,
      unlockWhen: { field: "biological_sex", equals: "FEMALE" },
    }));
  const feverRuleExists = protocol.redFlagRules.some((rule) => rule.field === "fever_temp");
  return {
    ...protocol,
    requiredFields: [...safetyFields, ...protocol.requiredFields],
    conditionalQuestions: [...protocol.conditionalQuestions, ...medicationSafetyConditional],
    redFlagRules: feverRuleExists
      ? protocol.redFlagRules
      : [
          ...protocol.redFlagRules,
          {
            code: "RF_HIGH_FEVER_TEMPERATURE",
            field: "fever_temp",
            greaterThan: 39.9,
            severity: "HIGH",
            label: "วัดไข้ได้ตั้งแต่ 40°C ขึ้นไป",
          },
        ],
    completionRules: {
      ...protocol.completionRules,
      requireAllOf: [...safetyFields.map((field) => field.key), ...protocol.completionRules.requireAllOf],
    },
  };
}

function buildFallbackProtocol(protocolKey: string): ProtocolDefinition | null {
  switch (protocolKey) {
    case "headache":
      return {
        id: "fallback:headache",
        protocolKey: "headache",
        requiredFields: [
          { key: "onset_days", label: "ระยะเวลาที่ปวด (วัน)", type: "number", questionKey: "q_headache_onset" },
          { key: "severity", label: "ความรุนแรง (1-10)", type: "number", questionKey: "q_headache_severity" },
          { key: "location", label: "ตำแหน่งที่ปวด", type: "free_text", questionKey: "q_headache_location" },
          { key: "allergies", label: "ประวัติแพ้ยา", type: "free_text", questionKey: "q_allergies" },
          { key: "current_medications", label: "ยาที่ใช้อยู่ปัจจุบัน", type: "free_text", questionKey: "q_current_meds" },
        ],
        conditionalQuestions: [
          { key: "fever_temp", questionKey: "q_headache_fever_temp", unlockWhen: { field: "has_fever", equals: "YES" } },
        ],
        redFlagRules: [
          { code: "RF_HEADACHE_STIFF_NECK", field: "neck_stiffness", equals: "YES", severity: "EMERGENCY", label: "คอแข็ง ก้มหน้าไม่ได้" },
          {
            code: "RF_HEADACHE_WORST_EVER",
            field: "worst_ever",
            equals: "YES",
            severity: "EMERGENCY",
            label: "ปวดหัวรุนแรงที่สุดในชีวิตแบบเฉียบพลัน",
          },
          {
            code: "RF_HEADACHE_NEURO_DEFICIT",
            field: "neuro_symptoms",
            equals: "YES",
            severity: "EMERGENCY",
            label: "แขนขาอ่อนแรง พูดไม่ชัด ตามัวเฉียบพลัน",
          },
          {
            code: "RF_HEADACHE_HEAD_INJURY",
            field: "recent_head_injury",
            equals: "YES",
            severity: "HIGH",
            label: "ปวดหัวหลังศีรษะได้รับบาดเจ็บ",
          },
        ],
        completionRules: { requireAllOf: ["onset_days", "severity", "location", "allergies", "current_medications"] },
        escalationRules: { onRedFlag: "EMERGENCY_REFERRAL", onUnresolvedConflict: "WAITING_FOR_PHARMACIST" },
      };
    case "cough":
      return {
        id: "fallback:cough",
        protocolKey: "cough",
        requiredFields: [
          { key: "duration_days", label: "ระยะเวลาที่ไอ (วัน)", type: "number", questionKey: "q_cough_duration" },
          { key: "sputum", label: "มีเสมหะไหม/สีอะไร", type: "free_text", questionKey: "q_cough_sputum" },
          { key: "has_fever", label: "มีไข้ร่วมไหม", type: "yes_no", questionKey: "q_cough_fever" },
          { key: "allergies", label: "ประวัติแพ้ยา", type: "free_text", questionKey: "q_allergies" },
          { key: "current_medications", label: "ยาที่ใช้อยู่ปัจจุบัน", type: "free_text", questionKey: "q_current_meds" },
        ],
        conditionalQuestions: [
          { key: "fever_temp", questionKey: "q_cough_fever_temp", unlockWhen: { field: "has_fever", equals: "YES" } },
        ],
        redFlagRules: [
          { code: "RF_COUGH_BLOOD", field: "blood_in_sputum", equals: "YES", severity: "EMERGENCY", label: "ไอมีเลือดปน" },
          {
            code: "RF_COUGH_BREATHLESS",
            field: "breathing_difficulty",
            equals: "YES",
            severity: "EMERGENCY",
            label: "หายใจลำบาก/หอบเหนื่อยมาก",
          },
          { code: "RF_COUGH_CHEST_PAIN", field: "chest_pain", equals: "YES", severity: "HIGH", label: "เจ็บแน่นหน้าอกร่วมด้วย" },
          { code: "RF_COUGH_LONG_DURATION", field: "duration_days", greaterThan: 21, severity: "HIGH", label: "ไอเรื้อรังเกิน 3 สัปดาห์" },
        ],
        completionRules: { requireAllOf: ["duration_days", "sputum", "has_fever", "allergies", "current_medications"] },
        escalationRules: { onRedFlag: "EMERGENCY_REFERRAL", onUnresolvedConflict: "WAITING_FOR_PHARMACIST" },
      };
    case "diarrhea":
      return {
        id: "fallback:diarrhea",
        protocolKey: "diarrhea",
        requiredFields: [
          { key: "duration_hours", label: "ระยะเวลาที่ถ่ายเหลว (ชั่วโมง)", type: "number", questionKey: "q_diarrhea_duration" },
          { key: "frequency_per_day", label: "จำนวนครั้งต่อวัน", type: "number", questionKey: "q_diarrhea_frequency" },
          {
            key: "hydration_status",
            label: "อาการขาดน้ำ (ปากแห้ง/ปัสสาวะน้อย/หน้ามืด)",
            type: "yes_no",
            questionKey: "q_diarrhea_hydration",
          },
          { key: "allergies", label: "ประวัติแพ้ยา", type: "free_text", questionKey: "q_allergies" },
          { key: "current_medications", label: "ยาที่ใช้อยู่ปัจจุบัน", type: "free_text", questionKey: "q_current_meds" },
        ],
        conditionalQuestions: [],
        redFlagRules: [
          { code: "RF_DIARRHEA_BLOOD", field: "blood_in_stool", equals: "YES", severity: "EMERGENCY", label: "ถ่ายมีเลือดปน" },
          { code: "RF_DIARRHEA_SEVERE_DEHYDRATION", field: "hydration_status", equals: "YES", severity: "HIGH", label: "มีอาการขาดน้ำชัดเจน" },
          { code: "RF_DIARRHEA_HIGH_FEVER", field: "high_fever", equals: "YES", severity: "HIGH", label: "ไข้สูงร่วมด้วย" },
          { code: "RF_DIARRHEA_INFANT", field: "patient_age_years", lessThan: 2, severity: "HIGH", label: "ผู้ป่วยเป็นทารกอายุต่ำกว่า 2 ปี" },
        ],
        completionRules: { requireAllOf: ["duration_hours", "frequency_per_day", "hydration_status", "allergies", "current_medications"] },
        escalationRules: { onRedFlag: "EMERGENCY_REFERRAL", onUnresolvedConflict: "WAITING_FOR_PHARMACIST" },
      };
    default:
      return null;
  }
}

async function loadProtocolForTest(tenantId: string, protocolKey: string): Promise<ProtocolDefinition | null> {
  const protocol = await getActivePharmacyProtocolByKey(tenantId, protocolKey);
  const loaded = protocol ? (protocol as unknown as ProtocolDefinition) : buildFallbackProtocol(protocolKey);
  return loaded ? enrichProtocolForSafeTest(loaded) : null;
}

const DISCLAIMER_TEXT =
  "ก่อนเริ่มค่ะ — ผู้ช่วยนี้เป็น AI ที่ช่วยเก็บข้อมูลอาการเบื้องต้นเท่านั้น ไม่ใช่เภสัชกร และจะไม่วินิจฉัยหรือแนะนำยาใดๆ";
const CONSENT_PROMPT_TEXT =
  "การตอบคำถามต่อไปนี้จะมีการเก็บข้อมูลสุขภาพเบื้องต้นของคุณไว้ในระบบเพื่อให้เภสัชกรตรวจสอบ ยินยอมให้เก็บข้อมูลนี้ไหมคะ? (ตอบ “ยินยอม” หรือ “ไม่ยินยอม”)";
const CONSENT_REVOKED_TEXT = "เข้าใจค่ะ ระบบจะไม่เก็บข้อมูลอาการของคุณ หากเปลี่ยนใจสามารถแจ้งอาการใหม่ได้เสมอนะคะ";
const RESTART_TEXT = "เข้าใจค่ะ ปิดเคสเดิมแล้ว หากต้องการปรึกษาอาการใหม่ พิมพ์อาการที่มีได้เลยค่ะ";
const RED_FLAG_TEXT =
  "จากข้อมูลที่แจ้งมา ทางร้านขอส่งเรื่องให้เภสัชกรตรวจสอบโดยเร็วที่สุดค่ะ หากมีอาการรุนแรงหรือฉุกเฉิน กรุณาไปโรงพยาบาลหรือโทร 1669 ทันทีนะคะ";
const URGENT_MEDICAL_TEXT = "จากข้อมูลที่แจ้งมา มีสัญญาณที่ควรให้แพทย์ประเมินโดยเร็วค่ะ แนะนำไปสถานพยาบาลภายในวันนี้ หากอาการทรุดลงให้โทร 1669 ทันทีนะคะ";
const PHARMACIST_REVIEW_TEXT = "จากข้อมูลที่แจ้งมา ระบบหยุดการซักอัตโนมัติและส่งให้เภสัชกรตรวจสอบโดยตรงแล้วค่ะ";
const SUBMITTED_TEXT =
  "ได้รับข้อมูลครบแล้วค่ะ ขอบคุณที่ให้ข้อมูลนะคะ ตอนนี้ส่งเรื่องให้เภสัชกรตรวจสอบแล้ว เภสัชกรจะติดต่อกลับพร้อมคำแนะนำโดยเร็วที่สุดค่ะ";
const CORRECTION_PROMPT_TEXT =
  "ได้เลยค่ะ รบกวนพิมพ์ข้อมูลที่ต้องการแก้ไขกลับมาได้เลย เช่น “อายุ 24 ปี” หรือ “ไม่มีไข้” แล้วระบบจะอัปเดตสรุปให้อีกครั้งค่ะ";
const CUSTOMER_REQUESTED_TEXT = "รับทราบค่ะ ส่งเรื่องให้เภสัชกรติดต่อคุณโดยตรงแล้วนะคะ";
const INTENT_CLARIFICATION_CANCELLED_TEXT =
  "เข้าใจค่ะ ระบบจะยังไม่เริ่มคัดกรองอาการ หากต้องการสอบถามสินค้าอื่น พิมพ์ชื่อสินค้าได้เลยค่ะ";

function firstQuestion(protocol: ProtocolDefinition, knownFields: KnownFields): { fieldKey: string; questionKey: string; text: string } {
  const missing = computeMissingFields(protocol, knownFields);
  const next = protocol.requiredFields.find((f) => missing.includes(f.key)) || protocol.conditionalQuestions.find((q) => missing.includes(q.key));
  if (!next) return { fieldKey: "unknown", questionKey: "unknown", text: "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ" };
  const label = FIELD_META[next.key]?.label ?? ("label" in next && typeof next.label === "string" && next.label ? `รบกวนแจ้ง${next.label}ด้วยค่ะ` : "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ");
  return {
    fieldKey: next.key,
    questionKey: next.questionKey,
    text: label,
  };
}

function toArabicDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
}

function parseYesNo(text: string): "YES" | "NO" | null {
  const normalized = text.trim().toLowerCase();
  if (/(ไม่มี|ไม่เป็น|ไม่เคย|ไม่ได้|ไม่พบ|ปฏิเสธ|^ไม่$|^no$|^n$)/i.test(normalized)) return "NO";
  if (/(มี|เป็น|เคย|ใช่|^yes$|^y$)/i.test(normalized)) return "YES";
  return null;
}

function parseNumber(text: string): number | null {
  const normalized = toArabicDigits(text).replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function parseDuration(text: string, fieldKey: string): number | null {
  const value = parseNumber(text);
  if (value == null || value < 0) return null;
  const isHours = fieldKey === "duration_hours";
  if (/(สัปดาห์|week)/i.test(text)) return isHours ? value * 24 * 7 : value * 7;
  if (/(เดือน|month)/i.test(text)) return isHours ? value * 24 * 30 : value * 30;
  if (/(วัน|day)/i.test(text)) return isHours ? value * 24 : value;
  if (/(ชั่วโมง|ชม\.?|hour)/i.test(text)) return isHours ? value : Math.max(1, Math.ceil(value / 24));
  return value;
}

function normalizeAnswer(fieldKey: string, text: string): string | number | null {
  const type = FIELD_META[fieldKey]?.type ?? "free_text";
  if (type === "yes_no") return parseYesNo(text);
  if (fieldKey === "biological_sex") {
    if (/(หญิง|female|woman)/i.test(text)) return "FEMALE";
    if (/(ชาย|male|man)/i.test(text)) return "MALE";
    return null;
  }
  if (fieldKey === "patient_relationship") {
    if (/(ตัวเอง|ตนเอง|ของฉัน|ของผม|ฉัน|ผม|หนู|self)/i.test(text)) return "SELF";
    if (/(ลูกชาย|ลูกสาว|ลูก|บุตร|เด็ก|child)/i.test(text)) return "CHILD";
    if (/(พ่อแม่|พ่อ|แม่|บิดา|มารดา|parent)/i.test(text)) return "PARENT";
    if (/(คนอื่น|บุคคลอื่น|ญาติ|แฟน|สามี|ภรรยา|เพื่อน|other)/i.test(text)) return "OTHER";
    return null;
  }
  if (type === "number") {
    const value = parseNumber(text);
    if (value == null) return null;
    if (fieldKey === "severity" && (value < 1 || value > 10)) return null;
    if (fieldKey === "frequency_per_day" && value < 0) return null;
    if (fieldKey === "patient_age_years" && (value < 0 || value > 120)) return null;
    if (fieldKey === "fever_temp" && (value < 30 || value > 45)) return null;
    return value;
  }
  if (type === "duration") {
    const value = parseDuration(text, fieldKey);
    return value;
  }
  if (/^(ไม่มี(?:ค่ะ|ครับ)?|ไม่เคยแพ้ยา|ไม่แพ้ยา|ไม่ได้ใช้ยา(?:อยู่)?|ไม่กินยา|none|no)$/i.test(text.trim())) return "NONE";
  return text.trim() || null;
}

function clarificationFor(fieldKey: string): string {
  const type = FIELD_META[fieldKey]?.type;
  if (type === "yes_no") return "ขอยืนยันให้ชัดเจนอีกครั้งนะคะ กรุณาตอบ “มี” หรือ “ไม่มี” ค่ะ";
  if (fieldKey === "biological_sex") return "รบกวนเลือก “หญิง” หรือ “ชาย” เพื่อประเมินข้อควรระวังของยาให้ถูกต้องค่ะ";
  if (fieldKey === "patient_relationship") return "รบกวนเลือก “ตัวเอง”, “ลูก”, “พ่อแม่” หรือ “บุคคลอื่น” ค่ะ";
  if (fieldKey === "fever_temp") return "รบกวนตรวจสอบอุณหภูมิอีกครั้งค่ะ ค่าที่รับได้อยู่ระหว่าง 30-45°C";
  if (fieldKey === "severity") return "รบกวนตอบเป็นคะแนนตั้งแต่ 1 ถึง 10 ค่ะ";
  if (type === "number" || type === "duration") return "รบกวนตอบเป็นตัวเลข พร้อมหน่วยถ้ามี เช่น 3 วัน หรือ 6 ชั่วโมงค่ะ";
  return "ขอรายละเอียดเพิ่มเติมอีกนิดนะคะ";
}

function clarificationForConflict(fieldKey: string): string {
  switch (fieldKey) {
    case "has_fever":
    case "fever_temp":
      return "ข้อมูลเรื่องไข้ยังขัดกันอยู่ รบกวนยืนยันอีกครั้งนะคะว่ามีไข้ไหม และถ้าวัดได้กี่องศาคะ";
    case "pregnancy_status":
    case "biological_sex":
      return "ข้อมูลบางส่วนยังขัดกันอยู่ รบกวนยืนยันเพศกำเนิดและสถานะการตั้งครรภ์อีกครั้งนะคะ";
    default:
      return "ข้อมูลบางส่วนยังขัดกันอยู่ รบกวนยืนยันคำตอบอีกครั้งนะคะ";
  }
}

function formatSummaryValue(fieldKey: string, value: string | number): string {
  if (typeof value === "number") {
    if (fieldKey === "patient_age_years") return `${value} ปี`;
    if (fieldKey === "fever_temp") return `${value} °C`;
    if (fieldKey === "duration_hours") return `${value} ชั่วโมง`;
    if (fieldKey === "duration_days" || fieldKey === "onset_days") return `${value} วัน`;
    if (fieldKey === "frequency_per_day") return `${value} ครั้ง/วัน`;
    return String(value);
  }
  if (value === "YES") return "มี / ใช่";
  if (value === "NO") return "ไม่มี / ไม่ใช่";
  if (value === "NONE") return "ไม่มี";
  if (value === "FEMALE") return "หญิง";
  if (value === "MALE") return "ชาย";
  if (value === "SELF") return "ตัวเอง";
  if (value === "CHILD") return "ลูก";
  if (value === "PARENT") return "พ่อแม่";
  if (value === "OTHER") return "บุคคลอื่น";
  return value;
}

function buildConfirmationPrompt(protocol: ProtocolDefinition, protocolKey: string, answers: Record<string, string | number>): string {
  const protocolLabels = new Map([
    ...protocol.requiredFields.map((field) => [field.key, field.label] as const),
    ...protocol.conditionalQuestions.map((field) => [field.key, field.label || field.key] as const),
  ]);
  const orderedKeys = [
    "patient_relationship",
    "patient_age_years",
    "biological_sex",
    "pregnancy_status",
    "breastfeeding_status",
    "allergies",
    "current_medications",
    ...protocol.requiredFields.map((field) => field.key),
    ...protocol.conditionalQuestions.map((field) => field.key),
  ];
  const seen = new Set<string>();
  const lines = orderedKeys
    .filter((fieldKey) => fieldKey in answers && !seen.has(fieldKey) && seen.add(fieldKey))
    .map((fieldKey) => `- ${(protocolLabels.get(fieldKey) || FIELD_META[fieldKey]?.label || fieldKey).replace(/คะ$|ค่ะ$|ไหมคะ$|ด้วยค่ะ$/g, "").trim()}: ${formatSummaryValue(fieldKey, answers[fieldKey])}`);
  return [
    "รบกวนตรวจสอบข้อมูลก่อนส่งให้เภสัชกรนะคะ",
    `- อาการหลัก: ${protocolKey}`,
    ...lines,
    "",
    "ถ้าข้อมูลถูกต้อง ตอบ “ข้อมูลถูกต้อง” หรือ “ยืนยัน” ได้เลยค่ะ",
    "ถ้าต้องการแก้ไข ตอบ “ขอแก้ไข” หรือพิมพ์ข้อมูลที่ถูกต้องกลับมาได้เลยค่ะ",
  ].join("\n");
}

function isConfirmationAccepted(text: string): boolean {
  return /(ข้อมูลถูกต้อง|ยืนยัน|ถูกต้อง|โอเค|ok|yes|ใช่)/i.test(text) && !/(ไม่ถูกต้อง|ไม่ใช่|ขอแก้ไข|แก้ไข)/i.test(text);
}

function isBareCorrectionRequest(text: string): boolean {
  return /^(ขอแก้ไข|แก้ไข|ไม่ถูกต้อง|เพิ่มเติม|ไม่|no)$/i.test(text.trim());
}

function resolveFieldKey(protocol: ProtocolDefinition, session: PharmacyTestSession): string | null {
  if (session.currentFieldKey) return session.currentFieldKey;
  if (session.currentQuestionKey) {
    const field =
      protocol.requiredFields.find((f) => f.questionKey === session.currentQuestionKey) ||
      protocol.conditionalQuestions.find((q) => q.questionKey === session.currentQuestionKey);
    if (field) return field.key;
  }
  return null;
}

async function testHarnessResumePrompt(
  tenantId: string,
  session: PharmacyTestSession
): Promise<string | null> {
  if (session.phase === "AWAITING_CONSENT") return CONSENT_PROMPT_TEXT;
  if (session.phase === "PENDING_CONFIRMATION") {
    return "ถ้าข้อมูลถูกต้อง ตอบ “ข้อมูลถูกต้อง” หรือ “ยืนยัน” หากต้องการแก้ไข ตอบ “ขอแก้ไข” ค่ะ";
  }
  if (session.phase === "WAITING") return "ขณะนี้เภสัชกรกำลังตรวจสอบข้อมูลของคุณอยู่ค่ะ";
  if (session.phase !== "ASKING" || !session.protocolKey) return null;
  const protocol = await loadProtocolForTest(tenantId, session.protocolKey);
  if (!protocol) return null;
  const fieldKey = resolveFieldKey(protocol, session);
  if (!fieldKey) return null;
  return FIELD_META[fieldKey]?.label
    ?? protocol.requiredFields.find((field) => field.key === fieldKey)?.label
    ?? "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ";
}

async function beginConsentForProtocol(tenantId: string, protocolKey: string): Promise<PharmacyTestResult> {
  const protocol = await loadProtocolForTest(tenantId, protocolKey);
  if (!protocol) {
    return {
      reply: `ยังไม่มี protocol ที่เปิดใช้งานสำหรับ ${protocolKey} ค่ะ`,
      session: { phase: "NONE", answers: {} },
    };
  }
  const question = firstQuestion(protocol, {});
  return {
    reply: `${DISCLAIMER_TEXT}\n\n${CONSENT_PROMPT_TEXT}`,
    session: {
      protocolKey,
      protocolId: protocol.id,
      phase: "AWAITING_CONSENT",
      answers: {},
      currentQuestionKey: question.questionKey,
      currentFieldKey: question.fieldKey,
    },
  };
}

async function handleProductPurchase(
  tenantId: string,
  text: string,
  session: PharmacyTestSession
): Promise<PharmacyTestResult> {
  const existingAnswers = { ...(session.answers ?? {}) };
  const existingCart = parseProductCart(existingAnswers);
  const existingSizeOptions = parseProductSizeOptions(existingAnswers);
  const selectedSku = typeof existingAnswers[PRODUCT_SESSION_KEYS.sku] === "string"
    ? String(existingAnswers[PRODUCT_SESSION_KEYS.sku])
    : null;
  const productSession: PharmacyTestSession = { ...session, phase: "PRODUCT_PURCHASE", answers: existingAnswers };
  const triggerDefinitions = resolvedTriggerDefinitions(await listActivePharmacyTriggerDefinitions(tenantId));

  if (!isExplicitPharmacyProductRequest(text)) {
    const trigger = detectPharmacyIntakeTrigger(text, triggerDefinitions);
    if (trigger?.intent === "ambiguous" || trigger?.intent === "medicine_product") {
      return {
        reply: pharmacyAmbiguousClarificationReply(trigger.protocolKey, triggerDefinitions),
        session: {
          protocolKey: trigger.protocolKey,
          phase: "AWAITING_INTENT_CLARIFICATION",
          answers: existingAnswers,
        },
      };
    }
  }

  if (/^(?:เพิ่มสินค้า|เพิ่มรายการ|เลือกสินค้าเพิ่ม)$/i.test(text)) {
    return {
      reply: `กรุณาระบุชื่อ ยี่ห้อ หรือ SKU ของสินค้ารายการถัดไปค่ะ\n\nตะกร้าปัจจุบัน\n${formatProductCart(existingCart)}`,
      session: {
        ...productSession,
        answers: saveProductSizeOptions(saveProductSelectionOptions(saveProductCart({
          ...existingAnswers,
          [PRODUCT_SESSION_KEYS.sku]: "",
          [PRODUCT_SESSION_KEYS.name]: "",
          [PRODUCT_SESSION_KEYS.salePolicy]: "",
          [PRODUCT_SESSION_KEYS.size]: "",
        }, existingCart), []), []),
      },
    };
  }

  if (/^(?:ดูตะกร้า|ตะกร้า|สรุปรายการ)$/i.test(text)) {
    return {
      reply: existingCart.length > 0
        ? `ตะกร้าปัจจุบัน\n${formatProductCart(existingCart)}\n\nเลือก “เพิ่มสินค้า” หรือ “ยืนยันตะกร้า” ได้เลยค่ะ`
        : "ตะกร้ายังว่างอยู่ค่ะ กรุณาระบุชื่อ ยี่ห้อ หรือ SKU ของสินค้าที่ต้องการ",
      session: productSession,
    };
  }

  if (/^(?:ล้างตะกร้า|เอาออกทั้งหมด)$/i.test(text)) {
    return {
      reply: "ล้างตะกร้าแล้วค่ะ กรุณาระบุชื่อ ยี่ห้อ หรือ SKU ของสินค้าที่ต้องการใหม่",
      session: { phase: "PRODUCT_PURCHASE", answers: {} },
    };
  }

  const removed = resolveCartRemovalTarget(existingCart, text, selectedSku);
  if (removed) {
    const nextCart = existingCart.filter((item) => item.sku !== removed.sku);
    return {
      reply: nextCart.length > 0
        ? `ลบ ${removed.name} ออกจากตะกร้าแล้วค่ะ\n${formatProductCart(nextCart)}`
        : `ลบ ${removed.name} แล้ว ตอนนี้ตะกร้าว่างค่ะ กรุณาระบุสินค้าที่ต้องการใหม่`,
      session: {
        ...productSession,
        answers: saveProductSizeOptions(saveProductSelectionOptions(saveProductCart({
          ...existingAnswers,
          [PRODUCT_SESSION_KEYS.sku]: "",
          [PRODUCT_SESSION_KEYS.name]: "",
          [PRODUCT_SESSION_KEYS.salePolicy]: "",
          [PRODUCT_SESSION_KEYS.size]: "",
        }, nextCart), []), []),
      },
    };
  }

  const revisedQty = explicitProductQuantity(text);
  if (existingSizeOptions.length === 0 && selectedSku && existingCart.length > 0 && revisedQty != null) {
    const selectedItem = existingCart.find((item) => item.sku === selectedSku);
    if (selectedItem) {
      const { items } = await listSellableProducts(tenantId, {
        search: selectedSku,
        inStockOnly: true,
        sort: "relevance",
        limit: 5,
      });
      const product = items.find((candidate) => candidate.sku.toLowerCase() === selectedSku.toLowerCase());
      const policies = await listPharmacyProductPolicies(tenantId);
      const policy = policies.find((candidate) => candidate.productSku === selectedSku);
      if (!product) return { reply: `สินค้า ${selectedItem.name} ไม่มีสต็อกหรือปิดขายแล้วค่ะ`, session: productSession };
      if (revisedQty > product.availableTotal) {
        return { reply: `สินค้า ${product.name} มีพร้อมขาย ${product.availableTotal} ชิ้น กรุณาระบุจำนวนไม่เกินสต็อกค่ะ`, session: productSession };
      }
      if (policy?.maxQuantity != null && revisedQty > policy.maxQuantity) {
        return { reply: `สินค้า ${product.name} จำกัดสูงสุด ${policy.maxQuantity} ชิ้นต่อออเดอร์ค่ะ`, session: productSession };
      }
      const nextCart = existingCart.map((item) => item.sku === selectedSku
        ? { ...item, qty: revisedQty, name: product.name, unitPrice: product.price }
        : item);
      return {
        reply: `อัปเดตจำนวน ${product.name} เป็น ${revisedQty} ชิ้นแล้วค่ะ\n${formatProductCart(nextCart)}`,
        session: {
          ...productSession,
          answers: saveProductCart({ ...existingAnswers, [PRODUCT_SESSION_KEYS.qty]: revisedQty }, nextCart),
        },
      };
    }
  }

  if (existingCart.length > 0 && (isConfirmationAccepted(text) || /^(?:ยืนยันตะกร้า|สั่งซื้อ)$/i.test(text))) {
    const policies = await listPharmacyProductPolicies(tenantId);
    const refreshedCart: ProductCartItem[] = [];
    for (const item of existingCart) {
      const { items } = await listSellableProducts(tenantId, {
        search: item.sku,
        inStockOnly: true,
        sort: "relevance",
        limit: 5,
      });
      const product = items.find((candidate) => candidate.sku.toLowerCase() === item.sku.toLowerCase());
      if (!product) {
        return { reply: `สินค้า ${item.name} (${item.sku}) ไม่มีสต็อกหรือปิดขายแล้ว กรุณาตรวจสอบตะกร้าอีกครั้งค่ะ`, session: productSession };
      }
      const policy = policies.find((candidate) => candidate.productSku === item.sku);
      if (!policy || policy.status !== "APPROVED" || policy.salePolicy !== "DIRECT_SALE") {
        return {
          reply: `สินค้า ${item.name} (${item.sku}) ยังไม่พร้อมขายผ่านรายการสั่งซื้อนี้ค่ะ\nกรุณาให้เภสัชกรหรือแอดมินตรวจสอบการตั้งค่าสินค้าก่อน แล้วค่อยลองยืนยันตะกร้าอีกครั้ง`,
          session: productSession,
        };
      }
      if (item.qty > product.availableTotal) {
        return { reply: `สินค้า ${item.name} มีพร้อมขาย ${product.availableTotal} ชิ้น แต่มียอดในตะกร้า ${item.qty} ชิ้น กรุณาลดจำนวนค่ะ`, session: productSession };
      }
      if (policy.maxQuantity != null && item.qty > policy.maxQuantity) {
        return { reply: `สินค้า ${item.name} จำกัดสูงสุด ${policy.maxQuantity} ชิ้นต่อออเดอร์ กรุณาลดจำนวนค่ะ`, session: productSession };
      }
      refreshedCart.push({ ...item, name: product.name, unitPrice: product.price, salePolicy: policy.salePolicy });
    }
    return {
      reply: `ยืนยันตะกร้าแล้วค่ะ\n${formatProductCart(refreshedCart)}\nสถานะ: พร้อมส่งไปสร้าง Order จริงต่อได้`,
      session: {
        ...productSession,
        phase: "WAITING",
        answers: saveProductCart(existingAnswers, refreshedCart),
      },
    };
  }

  const selectedOption = resolveProductSelectionOption(existingAnswers, text);
  const selectedSize = resolveProductSizeOption(existingAnswers, text);
  const searchText = selectedOption?.sku ?? (selectedSize ? String(existingAnswers[PRODUCT_SESSION_KEYS.sku] ?? "") : (normalizePharmacyProductSearchText(text) || text));
  const { items } = await listSellableProducts(tenantId, {
    search: searchText,
    inStockOnly: true,
    sort: "relevance",
    limit: 5,
  });
  if (items.length === 0) {
    return {
      reply: `ไม่พบสินค้า "${searchText}" ที่ active และมีสต็อกในร้านค่ะ กรุณาระบุชื่อ ยี่ห้อ หรือ SKU เพิ่มเติม`,
      session: productSession,
    };
  }
  const normalized = searchText.toLowerCase();
  const exact = items.filter((item) =>
    item.sku.toLowerCase() === normalized ||
    item.name.toLowerCase() === normalized ||
    normalized.includes(item.sku.toLowerCase()) ||
    normalized.includes(item.name.toLowerCase())
  );
  if (exact.length !== 1 && items.length > 1) {
    const options = items.map((item) => ({ sku: item.sku, name: item.name }));
    return {
      reply: `พบหลายรายการค่ะ เลือกหมายเลขที่ต้องการได้เลย\n${items.map((item, index) => `${index + 1}. ${item.name} (${item.sku})`).join("\n")}\n\nพิมพ์แค่เลข เช่น 1 หรือ 2 ได้เลยค่ะ`,
      session: {
        ...productSession,
        answers: saveProductSelectionOptions(existingAnswers, options),
      },
    };
  }
  const product = exact[0] ?? items[0];
  const policies = await listPharmacyProductPolicies(tenantId);
  const policy = policies.find((item) => item.productSku === product.sku);
  const requestedQty = requestedProductQuantity(text);
  const availableSizeOptions = (product.availableSizes ?? []).filter((item) => Number(item.available) > 0);
  const policyText = !policy || policy.status !== "APPROVED"
    ? "ยังเพิ่มสินค้านี้เข้าตะกร้าไม่ได้\nเพราะร้านยังไม่ได้อนุมัติการขายสินค้านี้ในระบบ\nกรุณาเลือกสินค้าอื่น หรือให้แอดมิน/เภสัชกรตั้งค่าสินค้านี้ก่อนค่ะ"
    : policy.salePolicy === "DIRECT_SALE"
      ? "เพิ่มเข้าตะกร้าและไปต่อในขั้นยืนยันจำนวนได้เลยค่ะ"
      : policy.salePolicy === "SHORT_SAFETY_CHECK"
        ? "สินค้านี้ต้องเก็บข้อมูลความปลอดภัยเพิ่มเติมก่อน จึงจะไปขั้นถัดไปได้ค่ะ"
        : policy.salePolicy === "PHARMACIST_APPROVAL"
          ? "สินค้านี้ต้องให้เภสัชกรตรวจสอบก่อน จึงยังเพิ่มเข้าตะกร้าอัตโนมัติไม่ได้ค่ะ"
          : "สินค้านี้ยังไม่สามารถสั่งซื้ออัตโนมัติได้ค่ะ กรุณาให้เภสัชกรตรวจสอบก่อน";
  const canAddToCart = policy?.status === "APPROVED" && policy.salePolicy === "DIRECT_SALE";
  if (canAddToCart && requestedQty > product.availableTotal) {
    return {
      reply: `สินค้า ${product.name} มีพร้อมขาย ${product.availableTotal} ชิ้น แต่ขอมา ${requestedQty} ชิ้น กรุณาระบุจำนวนใหม่ค่ะ`,
      session: productSession,
    };
  }
  if (canAddToCart && policy.maxQuantity != null && requestedQty > policy.maxQuantity) {
    return {
      reply: `สินค้า ${product.name} จำกัดสูงสุด ${policy.maxQuantity} ชิ้นต่อออเดอร์ กรุณาระบุจำนวนใหม่ค่ะ`,
      session: productSession,
    };
  }
  if (canAddToCart && availableSizeOptions.length > 1 && !selectedSize) {
    return {
      reply: `สินค้านี้มีหลายขนาดในสต็อกค่ะ เลือกหมายเลขขนาดที่ต้องการได้เลย\n${availableSizeOptions.map((item, index) => `${index + 1}. ${item.size} (${item.available} ชิ้น)`).join("\n")}\n\nพิมพ์แค่เลข เช่น 1 หรือ 2 ได้เลยค่ะ`,
      session: {
        ...productSession,
        answers: saveProductSizeOptions(saveProductSelectionOptions({
          ...existingAnswers,
          [PRODUCT_SESSION_KEYS.sku]: product.sku,
          [PRODUCT_SESSION_KEYS.name]: product.name,
          [PRODUCT_SESSION_KEYS.qty]: requestedQty,
          [PRODUCT_SESSION_KEYS.price]: product.price,
          [PRODUCT_SESSION_KEYS.salePolicy]: policy.salePolicy,
          [PRODUCT_SESSION_KEYS.size]: "",
        }, []), availableSizeOptions),
      },
    };
  }
  const resolvedSize = canAddToCart
    ? (selectedSize?.size ?? (availableSizeOptions.length === 1 ? availableSizeOptions[0]?.size ?? "" : ""))
    : "";
  const nextCart = canAddToCart
    ? [...existingCart.filter((item) => item.sku !== product.sku), {
        sku: product.sku,
        name: product.name,
        qty: requestedQty,
        unitPrice: product.price,
        salePolicy: policy.salePolicy,
        ...(resolvedSize ? { size: resolvedSize } : {}),
      }]
    : existingCart;
  const cartReply = canAddToCart
    ? `\n\nเพิ่มลงตะกร้าแล้ว\n${formatProductCart(nextCart)}\n\nเลือก “เพิ่มสินค้า” หรือ “ยืนยันตะกร้า” ได้เลยค่ะ`
    : "";
  const productSummary = `ยืนยันสินค้าแล้ว: ${product.name} (${product.sku})\nราคา ${formatBaht(product.price)} / ชิ้น\nจำนวน ${requestedQty}`;
  return {
    reply: canAddToCart
      ? `${productSummary}\nสถานะ: ${policyText}${cartReply}`
      : `${productSummary}\nสถานะ: ${policyText}`,
    session: {
      ...productSession,
      answers: saveProductSizeOptions(saveProductSelectionOptions(saveProductCart({
        ...existingAnswers,
        [PRODUCT_SESSION_KEYS.sku]: product.sku,
        [PRODUCT_SESSION_KEYS.name]: product.name,
        [PRODUCT_SESSION_KEYS.qty]: requestedQty,
        [PRODUCT_SESSION_KEYS.price]: product.price,
        [PRODUCT_SESSION_KEYS.salePolicy]: policy?.salePolicy ?? "UNKNOWN",
        [PRODUCT_SESSION_KEYS.size]: resolvedSize,
      }, nextCart), []), []),
    },
  };
}

export async function runPharmacyTestHarness(
  tenantId: string,
  message: string,
  sessionInput: PharmacyTestSession | null | undefined
): Promise<PharmacyTestResult> {
  const session: PharmacyTestSession = {
    protocolKey: sessionInput?.protocolKey,
    phase: sessionInput?.phase ?? "NONE",
    protocolId: sessionInput?.protocolId,
    answers: { ...(sessionInput?.answers ?? {}) },
    currentQuestionKey: sessionInput?.currentQuestionKey ?? null,
    currentFieldKey: sessionInput?.currentFieldKey ?? null,
  };

  const text = String(message ?? "").trim();
  if (!text) return { reply: "พิมพ์อาการหรือคำตอบสั้นๆ ได้เลยค่ะ", session };
  const triggerDefinitions = resolvedTriggerDefinitions(await listActivePharmacyTriggerDefinitions(tenantId));
  const conversationRoute = routePharmacyConversationMessage(text);

  if (conversationRoute.intent === "EMERGENCY") {
    return {
      reply: pharmacyEmergencyReply(),
      session: session.phase === "NONE"
        ? { phase: "NONE", answers: {} }
        : { ...session, phase: "WAITING" },
    };
  }

  if (conversationRoute.intent === "HUMAN_HANDOFF" && session.phase !== "NONE") {
    return { reply: CUSTOMER_REQUESTED_TEXT, session: { ...session, phase: "WAITING" } };
  }

  if (["GREETING", "THANKS", "SMALL_TALK", "PRODUCT_SIDE_INTENT", "ORDER_STATUS"].includes(conversationRoute.intent)) {
    const routedReply = pharmacyRouterReply(conversationRoute, {
      activeClinicalWorkflow: session.phase !== "NONE" && session.phase !== "PRODUCT_PURCHASE",
      resumePrompt: await testHarnessResumePrompt(tenantId, session),
    });
    if (routedReply) return { reply: routedReply, session };
  }

  if (/(ไม่เอาแล้ว|ยกเลิก|หยุดซักอาการ|เริ่มใหม่|เปลี่ยนอาการ)/i.test(text)) {
    return { reply: RESTART_TEXT, session: { phase: "NONE", answers: {} } };
  }

  if (session.phase === "NONE") {
    if (/^(?:ซื้อสินค้า|ต้องการซื้อสินค้า|มีสินค้าที่ต้องการแล้ว|ซื้อยาสามัญประจำบ้าน|ซื้ออุปกรณ์การแพทย์)$/i.test(text)) {
      return {
        reply: "กรุณาระบุชื่อหรือยี่ห้อสินค้าที่ต้องการค่ะ ระบบต้องค้น SKU จริงก่อนและจะไม่เดาสินค้าให้",
        session: { phase: "PRODUCT_PURCHASE", answers: {} },
      };
    }
    if (isExplicitPharmacyProductRequest(text)) {
      return handleProductPurchase(tenantId, text, { phase: "PRODUCT_PURCHASE", answers: {} });
    }
    const trigger = detectPharmacyIntakeTrigger(text, triggerDefinitions);
    if (trigger?.intent === "emergency") {
      return { reply: pharmacyEmergencyReply(), session: { phase: "NONE", answers: {} } };
    }
    if (trigger?.intent === "ambiguous" || trigger?.intent === "medicine_product") {
      return {
        reply: pharmacyAmbiguousClarificationReply(trigger.protocolKey, triggerDefinitions),
        session: {
          protocolKey: trigger.protocolKey,
          phase: "AWAITING_INTENT_CLARIFICATION",
          answers: {},
        },
      };
    }
    const protocolKey = trigger?.protocolKey || session.protocolKey;
    if (!protocolKey) {
      return {
        reply: "ลองพิมพ์อาการ เช่น ปวดหัว, ไอ, ท้องเสีย ได้เลยค่ะ",
        session: { phase: "NONE", answers: {} },
      };
    }
    return beginConsentForProtocol(tenantId, protocolKey);
  }

  if (session.phase === "AWAITING_INTENT_CLARIFICATION") {
    const protocolKey = session.protocolKey;
    if (!protocolKey) {
      return { reply: "ไม่พบอาการที่รอยืนยัน กรุณาเริ่มใหม่ค่ะ", session: { phase: "NONE", answers: {} } };
    }
    if (/(ไม่ใช่|ไม่เอา|ผิดแชท|ถามสินค้าอื่น|ยกเลิก)/i.test(text)) {
      return { reply: INTENT_CLARIFICATION_CANCELLED_TEXT, session: { phase: "NONE", answers: {} } };
    }
    if (/(มีชื่อ|มียี่ห้อ|ซื้อสินค้า|ซื้อยา|ระบุสินค้า|อันแรก|อย่างแรก|ข้อแรก|แบบแรก)/i.test(text)) {
      return {
        reply: "กรุณาระบุชื่อหรือยี่ห้อสินค้าที่ต้องการค่ะ ระบบต้องค้น SKU จริงก่อนและจะไม่เดาสินค้าให้",
        session: { phase: "PRODUCT_PURCHASE", answers: {} },
      };
    }
    if (/(ให้เภสัชกร|คัดกรอง|เช็กอาการ|ตรวจอาการ|ปรึกษาอาการ|อันหลัง|อย่างหลัง|ข้อสอง|แบบสอง)/i.test(text)) {
      return beginConsentForProtocol(tenantId, protocolKey);
    }
    return { reply: pharmacyAmbiguousClarificationReply(protocolKey, triggerDefinitions), session };
  }

  if (session.phase === "PRODUCT_PURCHASE") {
    return handleProductPurchase(tenantId, text, session);
  }

  const protocolKey = session.protocolKey;
  if (!protocolKey) return { reply: "ไม่พบ protocol ของเคสนี้ กรุณาเริ่มใหม่", session: { phase: "NONE", answers: {} } };
  const protocol = await loadProtocolForTest(tenantId, protocolKey);
  if (!protocol) return { reply: `protocol ${protocolKey} ยังไม่เปิดใช้งาน`, session: { phase: "NONE", answers: {} } };

  if (session.phase === "AWAITING_CONSENT") {
    const isYes = /(ยินยอม|ตกลง|ใช่|ok|yes|ได้)/i.test(text) && !/(ไม่ยินยอม|ไม่ตกลง|ไม่ใช่|ไม่)/i.test(text);
    const isNo = /(ไม่ยินยอม|ไม่ตกลง|ไม่ใช่|no)/i.test(text) || (/^ไม่/i.test(text) && !isYes);
    if (isNo) return { reply: CONSENT_REVOKED_TEXT, session: { phase: "NONE", answers: {} } };
    if (!isYes) {
      return { reply: `${DISCLAIMER_TEXT}\n\nพิมพ์ “ยินยอม” เพื่อดำเนินการต่อ หรือ “ไม่ยินยอม” หากไม่ต้องการค่ะ`, session };
    }
    const question = firstQuestion(protocol, {});
    return {
      reply: question.text,
      session: { ...session, phase: "ASKING", currentQuestionKey: question.questionKey, currentFieldKey: question.fieldKey },
    };
  }

  if (session.phase === "ASKING") {
    const answers = { ...(session.answers ?? {}) };
    const activeFieldKey = resolveFieldKey(protocol, session);
    if (activeFieldKey) {
      const normalized = normalizeAnswer(activeFieldKey, text);
      if (normalized == null) {
        return { reply: clarificationFor(activeFieldKey), session };
      }
      answers[activeFieldKey] = normalized;
    }

    const protocolDef = protocol as unknown as ProtocolDefinition;
    const decision = evaluateAnswer(protocolDef, answers);
    if (decision.decision === "RED_FLAG") {
      const escalationText = decision.flag.action === "EMERGENCY_REFERRAL"
        ? RED_FLAG_TEXT
        : decision.flag.action === "URGENT_MEDICAL_REVIEW"
          ? URGENT_MEDICAL_TEXT
          : PHARMACIST_REVIEW_TEXT;
      return { reply: escalationText, session: { ...session, phase: "WAITING", answers } };
    }
    if (decision.decision === "ANOMALY") {
      const first = decision.anomalies[0];
      return {
        reply: `${first.label} รบกวนยืนยันอีกครั้งนะคะ`,
        session: { ...session, phase: "ASKING", answers, currentFieldKey: first.fieldKey },
      };
    }
    if (decision.decision === "CONFLICT") {
      return {
        reply: clarificationForConflict(decision.conflictingFieldKeys[0]),
        session: { ...session, phase: "ASKING", answers, currentFieldKey: decision.conflictingFieldKeys[0] },
      };
    }
    if (decision.decision === "COMPLETE") {
      return {
        reply: buildConfirmationPrompt(protocolDef, protocolKey, answers),
        session: { ...session, phase: "PENDING_CONFIRMATION", answers, currentFieldKey: null, currentQuestionKey: null },
      };
    }
    const nextKey = decision.missingFieldKeys[0];
    const field = protocol.requiredFields.find((f) => f.key === nextKey) || protocol.conditionalQuestions.find((q) => q.key === nextKey);
    const questionText = FIELD_META[nextKey]?.label ?? (field && "label" in field && typeof field.label === "string" && field.label
      ? `รบกวนแจ้ง${field.label}ด้วยค่ะ`
      : "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ");
    return {
      reply: questionText,
      session: {
        ...session,
        phase: "ASKING",
        answers,
        currentQuestionKey: field?.questionKey ?? session.currentQuestionKey ?? null,
        currentFieldKey: field?.key ?? session.currentFieldKey ?? null,
      },
    };
  }

  if (session.phase === "PENDING_CONFIRMATION") {
    if (isConfirmationAccepted(text)) {
      return { reply: SUBMITTED_TEXT, session: { ...session, phase: "WAITING" } };
    }
    if (isBareCorrectionRequest(text)) {
      return {
        reply: CORRECTION_PROMPT_TEXT,
        session: { ...session, phase: "ASKING", currentFieldKey: null, currentQuestionKey: null },
      };
    }
    return runPharmacyTestHarness(tenantId, text, {
      ...session,
      phase: "ASKING",
      currentFieldKey: null,
      currentQuestionKey: null,
    });
  }

  return { reply: CUSTOMER_REQUESTED_TEXT, session };
}
