import { getActivePharmacyProtocolByKey } from "./protocols";
import { computeMissingFields, evaluateAnswer, type KnownFields, type ProtocolDefinition } from "./ruleEngine";

export type PharmacyTestPhase = "NONE" | "AWAITING_CONSENT" | "ASKING" | "WAITING";

export type PharmacyTestSession = {
  protocolKey?: string;
  phase?: PharmacyTestPhase;
  protocolId?: string;
  answers?: Record<string, string>;
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
  if (protocol) return protocol as unknown as ProtocolDefinition;
  return buildFallbackProtocol(protocolKey);
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
  const label = "label" in next && typeof next.label === "string" && next.label ? next.label : next.questionKey;
  return {
    fieldKey: next.key,
    questionKey: next.questionKey,
    text: `รบกวนแจ้ง${label}ด้วยค่ะ`,
  };
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
    if (activeFieldKey) answers[activeFieldKey] = text;

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
    const label = field && "label" in field && typeof field.label === "string" && field.label ? field.label : nextKey;
    return {
      reply: `รบกวนแจ้ง${label}ด้วยค่ะ`,
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
