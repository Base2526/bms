import { getActivePharmacyProtocolByKey } from "./protocols";
import { computeMissingFields, evaluateAnswer, type KnownFields, type ProtocolDefinition } from "./ruleEngine";

export type PharmacyTestPhase = "NONE" | "AWAITING_CONSENT" | "ASKING" | "WAITING";

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

const PROTOCOL_TRIGGER_PATTERNS: Record<string, RegExp> = {
  headache: /(ปวดหัว|ปวดศีรษะ|migraine|headache)/i,
  cough: /(ไอ(?!ศ)|cough)/i,
  diarrhea: /(ท้องเสีย|ถ่ายเหลว|diarrhea)/i,
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
  const safetyKeys = [...new Set([...(SAFETY_FIELDS_BY_PROTOCOL[protocol.protocolKey] ?? []), "patient_age_years", "biological_sex"])];
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
const CONFLICT_TEXT = "ขอบคุณสำหรับข้อมูลค่ะ มีบางส่วนที่ทางร้านขอให้เภสัชกรตรวจสอบเพิ่มเติมก่อน จะรีบติดต่อกลับนะคะ";
const SUBMITTED_TEXT =
  "ได้รับข้อมูลครบแล้วค่ะ ขอบคุณที่ให้ข้อมูลนะคะ ตอนนี้ส่งเรื่องให้เภสัชกรตรวจสอบแล้ว เภสัชกรจะติดต่อกลับพร้อมคำแนะนำโดยเร็วที่สุดค่ะ";
const CUSTOMER_REQUESTED_TEXT = "รับทราบค่ะ ส่งเรื่องให้เภสัชกรติดต่อคุณโดยตรงแล้วนะคะ";

function detectTrigger(message: string): string | null {
  for (const [protocolKey, pattern] of Object.entries(PROTOCOL_TRIGGER_PATTERNS)) {
    if (pattern.test(message)) return protocolKey;
  }
  return null;
}

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
  if (fieldKey === "fever_temp") return "รบกวนตรวจสอบอุณหภูมิอีกครั้งค่ะ ค่าที่รับได้อยู่ระหว่าง 30-45°C";
  if (fieldKey === "severity") return "รบกวนตอบเป็นคะแนนตั้งแต่ 1 ถึง 10 ค่ะ";
  if (type === "number" || type === "duration") return "รบกวนตอบเป็นตัวเลข พร้อมหน่วยถ้ามี เช่น 3 วัน หรือ 6 ชั่วโมงค่ะ";
  return "ขอรายละเอียดเพิ่มเติมอีกนิดนะคะ";
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

  if (/(ไม่เอาแล้ว|ยกเลิก|เริ่มใหม่|เปลี่ยนอาการ)/i.test(text)) {
    return { reply: RESTART_TEXT, session: { phase: "NONE", answers: {} } };
  }

  if (session.phase === "NONE") {
    const protocolKey = detectTrigger(text) || session.protocolKey;
    if (!protocolKey) {
      return {
        reply: "ลองพิมพ์อาการ เช่น ปวดหัว, ไอ, ท้องเสีย ได้เลยค่ะ",
        session: { phase: "NONE", answers: {} },
      };
    }
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
      return { reply: RED_FLAG_TEXT, session: { ...session, phase: "WAITING", answers } };
    }
    if (decision.decision === "CONFLICT") {
      return { reply: CONFLICT_TEXT, session: { ...session, phase: "WAITING", answers } };
    }
    if (decision.decision === "COMPLETE") {
      return { reply: SUBMITTED_TEXT, session: { ...session, phase: "WAITING", answers } };
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

  return { reply: CUSTOMER_REQUESTED_TEXT, session };
}
