// =============================================================
// BMS Pharmacy Intake — conversational orchestrator
// -------------------------------------------------------------
// Deliberately does NOT enter runToolLoop()/customerTools() — this is a
// deterministic, protocol-driven multi-turn flow (ask field X, stop,
// escalate), not open-ended tool selection. lib/bms/pipeline.ts calls
// runPharmacyIntakeTurn() as an early return, mirroring the existing
// checkoutDetailsFromReply() early-return pattern, before the normal AI
// tool loop ever runs for that turn.
//
// This file NEVER writes `status` on bms_pharmacy_assessments directly —
// every transition goes through a named function in assessments.ts. Grep
// for `SET status` in this file to verify that invariant hasn't regressed.
//
// The rule engine (lib/bms/pharmacy/ruleEngine.ts), not the LLM, decides
// red flags/missing fields/completion — this file only calls into it and
// branches on its answer.
// =============================================================

import { query } from "@/lib/db";
import {
  getAssessment,
  appendRawMessage,
  updateAnswers,
  recordAiSummary,
  markNeedsManualIntake,
  closeAssessmentIfExpired,
  closeAssessment,
  confirmCustomerSummary,
  markWaitingForPharmacist,
  markPendingCustomerConfirmation,
  routeProtocolEscalation,
  createAssessmentOnce,
  recordConsent,
  reopenForCustomerCorrection,
  getLatestReusablePatientProfile,
  type CustomerConfirmationSummary,
  type PharmacyAssessmentRow,
  type RememberedPatientProfile,
} from "./assessments";
import { getActivePharmacyProtocolByKey, getPharmacyProtocol, toProtocolDefinition, type PharmacyProtocolRow } from "./protocols";
import {
  evaluateAnswer,
  computeMissingFields,
  GLOBAL_CONDITIONAL_QUESTIONS,
  GLOBAL_REQUIRED_FIELDS,
  getQuestionFieldDef,
  listAllQuestionFields,
  resolveCompletenessStatus,
  type KnownFields,
  type ProtocolDefinition,
} from "./ruleEngine";
import { AnthropicCompatiblePharmacyIntakeAI, type NextQuestionResult, type PharmacyIntakeAI } from "./ai";
import { recordPharmacyEvent } from "./events";
import { isPharmacyAiEnabled } from "./config";
import { reportBmsFailure } from "../failureAlert";
import type { Channel } from "../pipeline";
import {
  pharmacyRouterReply,
  routePharmacyConversationMessage,
} from "./conversationRouter";

const CONSENT_VERSION = "pharmacy-intake-v1";
const DEFAULT_AI: PharmacyIntakeAI = new AnthropicCompatiblePharmacyIntakeAI();

const TALK_TO_PHARMACIST_PATTERN = /(คุยกับเภสัชกร|ขอคุยกับเภสัชกร|ปรึกษาเภสัชกร|ปรึกษาอาการ|ขอคุยเภสัชกร)/i;
const RESTART_PATTERN = /(ไม่เอาแล้ว|ยกเลิก|หยุดซักอาการ|เริ่มใหม่|อาการเปลี่ยน|เปลี่ยนอาการ)/i;

// ---------------------------------------------------------------
// Conversation-level state (analogous to inbox.ts's getAiConversationState)
// ---------------------------------------------------------------
export type PharmacyIntakeConvState =
  | { stage: "NONE" }
  | { stage: "AWAITING_CONSENT"; caseId: string }
  | { stage: "ASKING"; caseId: string; status: PharmacyAssessmentRow["status"] }
  | { stage: "PENDING_CONFIRMATION"; caseId: string; status: PharmacyAssessmentRow["status"] }
  | { stage: "WAITING"; caseId: string; status: PharmacyAssessmentRow["status"] };

const OPEN_STATUSES = new Set([
  "DRAFT",
  "COLLECTING_INFORMATION",
  "PENDING_CONFIRMATION",
  "WAITING_FOR_PHARMACIST",
  "PHARMACIST_REVIEWING",
  "NEED_MORE_INFORMATION",
]);

export async function getPharmacyIntakeState(tenantId: string, convId: string | null): Promise<PharmacyIntakeConvState> {
  if (!convId) return { stage: "NONE" };
  const conv = await query<{ pharmacy_intake_case_id: string | null }>(
    `SELECT pharmacy_intake_case_id FROM bms_conversations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, convId]
  );
  const caseId = conv.rows[0]?.pharmacy_intake_case_id;
  if (!caseId) return { stage: "NONE" };
  const assessment = await getAssessment(tenantId, caseId);
  if (!assessment || !OPEN_STATUSES.has(assessment.status)) return { stage: "NONE" };
  if (assessment.consentStatus !== "GRANTED") return { stage: "AWAITING_CONSENT", caseId };
  if (assessment.status === "PENDING_CONFIRMATION") {
    return { stage: "PENDING_CONFIRMATION", caseId, status: assessment.status };
  }
  if (assessment.status === "WAITING_FOR_PHARMACIST" || assessment.status === "PHARMACIST_REVIEWING") {
    return { stage: "WAITING", caseId, status: assessment.status };
  }
  return { stage: "ASKING", caseId, status: assessment.status };
}

async function clearConversationLink(tenantId: string, convId: string): Promise<void> {
  await query(`UPDATE bms_conversations SET pharmacy_intake_case_id = NULL, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    convId,
  ]);
}

// ---------------------------------------------------------------
// knownFields assembly — flat map the rule engine / AI both read
// ---------------------------------------------------------------
function buildKnownFields(assessment: PharmacyAssessmentRow): KnownFields {
  const fields: KnownFields = { ...(assessment.structuredAnswers as KnownFields) };
  if (assessment.patientRelationship !== "UNKNOWN") fields.patient_relationship = assessment.patientRelationship;
  if (assessment.biologicalSex !== "UNKNOWN") fields.biological_sex = assessment.biologicalSex;
  if (assessment.pregnancyStatus !== "UNKNOWN") fields.pregnancy_status = assessment.pregnancyStatus;
  if (assessment.breastfeedingStatus !== "UNKNOWN") fields.breastfeeding_status = assessment.breastfeedingStatus;
  if (assessment.patientAgeYears != null) fields.patient_age_years = assessment.patientAgeYears;
  return fields;
}

const REMEMBERED_FIELD_KEYS = new Set([
  "patient_age_years",
  "biological_sex",
  "allergies",
  "chronic_diseases",
]);

function mergeRememberedFields(currentKnownFields: KnownFields, rememberedProfile: RememberedPatientProfile | null): KnownFields {
  if (!rememberedProfile) return currentKnownFields;
  const merged: KnownFields = { ...currentKnownFields };
  for (const [key, value] of Object.entries(rememberedProfile.fields)) {
    if (!REMEMBERED_FIELD_KEYS.has(key)) continue;
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = value;
    }
  }
  return merged;
}

function rememberedFieldKeysAdded(
  currentKnownFields: KnownFields,
  rememberedProfile: RememberedPatientProfile | null
): string[] {
  if (!rememberedProfile) return [];
  return Object.keys(rememberedProfile.fields).filter(
    (key) =>
      REMEMBERED_FIELD_KEYS.has(key) &&
      (currentKnownFields[key] === undefined || currentKnownFields[key] === null || currentKnownFields[key] === "")
  );
}

function normalizePatientRelationship(value: unknown): "SELF" | "CHILD" | "PARENT" | "OTHER" | null {
  const text = String(value ?? "").trim().replace(/(?:ค่ะ|คะ|ครับ)$/i, "").trim();
  if (!text) return null;
  if (/SELF|ตัวเอง|ตนเอง|ของฉัน|ของผม|^ฉัน$|^ผม$|^หนู$/i.test(text)) return "SELF";
  if (/CHILD|ลูกชาย|ลูกสาว|บุตร|^ลูก$|^เด็ก$/i.test(text)) return "CHILD";
  if (/PARENT|พ่อแม่|บิดา|มารดา|^พ่อ$|^แม่$/i.test(text)) return "PARENT";
  if (/OTHER|คนอื่น|บุคคลอื่น|ญาติ|แฟน|สามี|ภรรยา|เพื่อน/i.test(text)) return "OTHER";
  return null;
}

function normalizeExtractedPatientFields(
  fields: Record<string, string | number | null>,
  latestMessage: string,
  currentQuestionKey: string | null
): Record<string, string | number | null> {
  const normalized = { ...fields };
  if ("patient_relationship" in normalized || currentQuestionKey === "q_global_patient_relationship") {
    const relationship = normalizePatientRelationship(normalized.patient_relationship ?? latestMessage);
    if (relationship) normalized.patient_relationship = relationship;
    else delete normalized.patient_relationship;
  }
  return normalized;
}

function buildPriorAnswersForExtraction(knownFields: KnownFields): Array<{ fieldKey: string; rawText: string; askedAt: string }> {
  const askedAt = new Date().toISOString();
  return Object.entries(knownFields)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([fieldKey, value]) => ({ fieldKey, rawText: String(value), askedAt }));
}

const TYPED_PATIENT_KEYS = new Set([
  "patient_relationship",
  "biological_sex",
  "pregnancy_status",
  "breastfeeding_status",
  "patient_age_years",
]);

async function persistMergedFields(
  tenantId: string,
  assessmentId: string,
  knownFields: KnownFields,
  extra: {
    missingFields?: string[];
    conflictingFields?: string[];
    anomalies?: unknown[];
    completenessStatus?: "UNKNOWN" | "INCOMPLETE" | "CONFLICT" | "COMPLETE";
    customerConfirmationStatus?: "NOT_REQUESTED" | "PENDING" | "CONFIRMED";
    customerConfirmedAt?: string | null;
    detectedRedFlags?: unknown[];
    riskLevel?: string;
    currentQuestionKey?: string | null;
  }
): Promise<void> {
  const structuredAnswersPatch: Record<string, unknown> = {};
  const typed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(knownFields)) {
    if (TYPED_PATIENT_KEYS.has(key)) typed[key] = value;
    else structuredAnswersPatch[key] = value;
  }
  await updateAnswers(tenantId, assessmentId, {
    structuredAnswersPatch,
    missingFields: extra.missingFields,
    conflictingFields: extra.conflictingFields,
    anomalies: extra.anomalies,
    completenessStatus: extra.completenessStatus,
    customerConfirmationStatus: extra.customerConfirmationStatus,
    customerConfirmedAt: extra.customerConfirmedAt,
    detectedRedFlags: extra.detectedRedFlags,
    riskLevel: extra.riskLevel,
    currentQuestionKey: extra.currentQuestionKey,
    biologicalSex: typeof typed.biological_sex === "string" ? typed.biological_sex : undefined,
    pregnancyStatus: typeof typed.pregnancy_status === "string" ? typed.pregnancy_status : undefined,
    breastfeedingStatus: typeof typed.breastfeeding_status === "string" ? typed.breastfeeding_status : undefined,
    patientAgeYears: typeof typed.patient_age_years === "number" ? typed.patient_age_years : undefined,
    patientRelationship: typeof typed.patient_relationship === "string" ? typed.patient_relationship : undefined,
  });
}

// ---------------------------------------------------------------
// Question selection — AI first, deterministic fallback if AI is off/unavailable
// ---------------------------------------------------------------
async function askNextQuestion(
  tenantId: string,
  caseId: string,
  protocol: PharmacyProtocolRow,
  protocolDef: ProtocolDefinition,
  knownFields: KnownFields,
  missingFieldKeys: string[]
): Promise<NextQuestionResult> {
  if (missingFieldKeys.includes("patient_relationship")) {
    return {
      questionKey: "q_global_patient_relationship",
      questionText: "ขอเช็กก่อนนะคะ ผู้ที่มีอาการคือตัวคุณเอง ลูก พ่อแม่ หรือบุคคลอื่นคะ?",
      inputHint: "choice",
      choices: ["ตัวเอง", "ลูก", "พ่อแม่", "บุคคลอื่น"],
    };
  }
  const requiredFields = [...GLOBAL_REQUIRED_FIELDS, ...protocolDef.requiredFields].filter(
    (field, index, arr) => arr.findIndex((candidate) => candidate.key === field.key) === index
  );
  const conditionalQuestions = [...GLOBAL_CONDITIONAL_QUESTIONS, ...protocolDef.conditionalQuestions].filter(
    (field, index, arr) => arr.findIndex((candidate) => candidate.key === field.key) === index
  );
  if (isPharmacyAiEnabled()) {
    const result = await DEFAULT_AI.selectNextQuestion({
      tenantId,
      caseId,
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      requiredFields,
      conditionalQuestions,
      knownFields,
      missingFieldKeys,
      locale: "th",
    });
    if (result) return result;
    await markNeedsManualIntake(tenantId, caseId, "select_next_question_unavailable");
  }
  // Deterministic fallback — no AI call, no guessing: ask the field's own label.
  const key = missingFieldKeys[0];
  const field = getQuestionFieldDef(protocolDef, key);
  if (field) return { questionKey: field.questionKey, questionText: `รบกวนแจ้ง${field.label}ด้วยค่ะ`, inputHint: field.type };
  return { questionKey: "unknown", questionText: "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ", inputHint: "free_text" };
}

function clarificationForAnomaly(fieldKey: string, label: string): string {
  switch (fieldKey) {
    case "fever_temp":
      return `${label} รบกวนยืนยันอุณหภูมิอีกครั้งเป็นตัวเลขหน่อยนะคะ เช่น 38.5`;
    case "severity":
      return `${label} รบกวนให้คะแนนใหม่ตั้งแต่ 1 ถึง 10 นะคะ`;
    case "patient_age_years":
      return `${label} รบกวนยืนยันอายุเป็นจำนวนปีอีกครั้งนะคะ`;
    default:
      return `${label} รบกวนยืนยันข้อมูลส่วนนี้อีกครั้งนะคะ`;
  }
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

const CONFIRMATION_FIELD_LABELS: Record<string, string> = {
  patient_relationship: "ผู้มีอาการ",
  patient_age_years: "อายุ",
  biological_sex: "เพศกำเนิด",
  pregnancy_status: "ตั้งครรภ์",
  breastfeeding_status: "ให้นมบุตร",
  allergies: "ประวัติแพ้ยา",
  current_medications: "ยาที่ใช้อยู่",
  chronic_diseases: "โรคประจำตัว",
  onset_days: "ระยะเวลาที่ปวดหัว",
  duration_days: "ระยะเวลาที่ไอ",
  duration_hours: "ระยะเวลาที่ถ่ายเหลว",
  frequency_per_day: "ความถี่ต่อวัน",
  severity: "ความรุนแรง",
  location: "ตำแหน่งอาการ",
  sputum: "เสมหะ",
  has_fever: "มีไข้",
  fever_temp: "อุณหภูมิ",
  hydration_status: "อาการขาดน้ำ",
  neck_stiffness: "คอแข็ง",
  worst_ever: "ปวดหัวรุนแรงที่สุดที่เคยเป็น",
  neuro_symptoms: "อาการทางระบบประสาท",
  recent_head_injury: "ศีรษะได้รับบาดเจ็บ",
  blood_in_sputum: "เลือดปนเสมหะ",
  breathing_difficulty: "หายใจลำบาก",
  chest_pain: "เจ็บหน้าอก",
  blood_in_stool: "เลือดปนอุจจาระ",
  high_fever: "ไข้สูง",
};

function formatConfirmationValue(fieldKey: string, value: unknown): string {
  if (value == null || String(value).trim() === "") return "ไม่ได้ระบุ";
  if (typeof value === "number") {
    if (fieldKey === "patient_age_years") return `${value} ปี`;
    if (fieldKey === "fever_temp") return `${value} °C`;
    if (fieldKey === "duration_days" || fieldKey === "onset_days") return `${value} วัน`;
    if (fieldKey === "duration_hours") return `${value} ชั่วโมง`;
    if (fieldKey === "frequency_per_day") return `${value} ครั้ง/วัน`;
    return String(value);
  }
  const normalized = String(value).trim();
  switch (fieldKey) {
    case "patient_relationship":
      if (normalized === "SELF") return "ตัวลูกค้าเอง";
      if (normalized === "CHILD") return "ลูก";
      if (normalized === "PARENT") return "พ่อแม่";
      if (normalized === "OTHER") return "บุคคลอื่น";
      return normalized;
    case "biological_sex":
      if (normalized === "FEMALE") return "หญิง";
      if (normalized === "MALE") return "ชาย";
      return normalized;
    case "pregnancy_status":
    case "breastfeeding_status":
    case "has_fever":
    case "hydration_status":
    case "neck_stiffness":
    case "worst_ever":
    case "neuro_symptoms":
    case "recent_head_injury":
    case "blood_in_sputum":
    case "breathing_difficulty":
    case "chest_pain":
    case "blood_in_stool":
    case "high_fever":
      if (normalized === "YES") return "มี / ใช่";
      if (normalized === "NO") return "ไม่มี / ไม่ใช่";
      if (normalized === "NOT_APPLICABLE") return "ไม่เกี่ยวข้อง";
      if (normalized === "UNKNOWN") return "ไม่ทราบ";
      return normalized;
    case "allergies":
    case "current_medications":
    case "chronic_diseases":
      if (normalized === "NONE") return "ไม่มี";
      return normalized;
    default:
      return normalized;
  }
}

function uniqueOrderedFieldKeys(protocolDef: ProtocolDefinition, knownFields: KnownFields): string[] {
  const orderedKeys = [
    "patient_relationship",
    "patient_age_years",
    "biological_sex",
    "pregnancy_status",
    "breastfeeding_status",
    "allergies",
    "current_medications",
    "chronic_diseases",
    ...listAllQuestionFields(protocolDef).map((field) => field.key),
  ];
  return orderedKeys.filter((key, index) => key in knownFields && orderedKeys.indexOf(key) === index);
}

function buildCustomerConfirmationSummary(
  protocol: PharmacyProtocolRow,
  protocolDef: ProtocolDefinition,
  knownFields: KnownFields
): CustomerConfirmationSummary {
  const lines = uniqueOrderedFieldKeys(protocolDef, knownFields)
    .map((fieldKey) => {
      const value = knownFields[fieldKey];
      if (value == null || String(value).trim() === "") return null;
      return {
        fieldKey,
        label: CONFIRMATION_FIELD_LABELS[fieldKey] ?? getQuestionFieldDef(protocolDef, fieldKey)?.label ?? fieldKey,
        valueText: formatConfirmationValue(fieldKey, value),
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line));
  const summaryText = [
    `อาการหลัก: ${protocol.supportedSymptomGroup}`,
    ...lines.map((line) => `${line.label}: ${line.valueText}`),
  ].join("\n");
  return {
    protocolKey: protocol.protocolKey,
    symptomGroup: protocol.supportedSymptomGroup,
    lines,
    summaryText,
    generatedAt: new Date().toISOString(),
  };
}

function renderCustomerConfirmationPrompt(summary: CustomerConfirmationSummary): string {
  const bullets = summary.lines.map((line) => `- ${line.label}: ${line.valueText}`).join("\n");
  return [
    "รบกวนตรวจสอบข้อมูลก่อนส่งให้เภสัชกรนะคะ",
    `- อาการหลัก: ${summary.symptomGroup}`,
    bullets,
    "",
    "ถ้าข้อมูลถูกต้อง ตอบ “ข้อมูลถูกต้อง” หรือ “ยืนยัน” ได้เลยค่ะ",
    "ถ้าต้องการแก้ไข ตอบ “ขอแก้ไข” หรือพิมพ์ข้อมูลที่ถูกต้องกลับมาได้เลยค่ะ",
  ]
    .filter(Boolean)
    .join("\n");
}

function isConfirmationAccepted(text: string): boolean {
  return /(ข้อมูลถูกต้อง|ยืนยัน|ถูกต้อง|โอเค|ok|yes|ใช่)/i.test(text) && !/(ไม่ถูกต้อง|ไม่ใช่|ขอแก้ไข|แก้ไข)/i.test(text);
}

function isCorrectionIntent(text: string): boolean {
  return /(ขอแก้ไข|แก้ไข|ไม่ถูกต้อง|ไม่ครบ|เพิ่มเติม|เปลี่ยนข้อมูล)/i.test(text);
}

function isBareCorrectionRequest(text: string): boolean {
  const normalized = text.trim();
  return /^(ขอแก้ไข|แก้ไข|ไม่ถูกต้อง|เพิ่มเติม|ไม่|no)$/i.test(normalized);
}

// ---------------------------------------------------------------
// Fixed, backend-composed, non-AI-authored copy
// ---------------------------------------------------------------
const DISCLAIMER_TEXT =
  "ก่อนเริ่มค่ะ — ผู้ช่วยนี้เป็น AI ที่ช่วยเก็บข้อมูลอาการเบื้องต้นเท่านั้น ไม่ใช่เภสัชกร และจะไม่วินิจฉัยหรือแนะนำยาใดๆ " +
  "เภสัชกรของร้านจะเป็นผู้ตรวจสอบและให้คำแนะนำกับคุณเองในขั้นตอนสุดท้ายค่ะ";
const CONSENT_PROMPT_TEXT =
  "การตอบคำถามต่อไปนี้จะมีการเก็บข้อมูลสุขภาพเบื้องต้นของคุณไว้ในระบบเพื่อให้เภสัชกรตรวจสอบ ยินยอมให้เก็บข้อมูลนี้ไหมคะ? (ตอบ “ยินยอม” หรือ “ไม่ยินยอม”)";
const CONSENT_UNCLEAR_TEXT = "ขอความยืนยันอีกครั้งนะคะ พิมพ์ “ยินยอม” เพื่อดำเนินการต่อ หรือ “ไม่ยินยอม” หากไม่ต้องการค่ะ";
const CONSENT_REVOKED_TEXT = "เข้าใจค่ะ ระบบจะไม่เก็บข้อมูลอาการของคุณ หากเปลี่ยนใจสามารถแจ้งอาการใหม่ได้เสมอนะคะ";
const RED_FLAG_TEXT =
  "จากข้อมูลที่แจ้งมา ทางร้านขอส่งเรื่องให้เภสัชกรตรวจสอบโดยเร็วที่สุดค่ะ หากมีอาการรุนแรงหรือฉุกเฉิน กรุณาไปโรงพยาบาลหรือโทร 1669 ทันทีนะคะ";
const URGENT_MEDICAL_TEXT = "จากข้อมูลที่แจ้งมา มีสัญญาณที่ควรให้แพทย์ประเมินโดยเร็วค่ะ แนะนำไปสถานพยาบาลภายในวันนี้ หากอาการทรุดลงให้โทร 1669 ทันทีนะคะ";
const PHARMACIST_REVIEW_TEXT = "จากข้อมูลที่แจ้งมา ระบบหยุดการซักอัตโนมัติและส่งให้เภสัชกรตรวจสอบโดยตรงแล้วค่ะ กรุณารอเภสัชกรติดต่อกลับนะคะ";
const SUBMITTED_TEXT =
  "ได้รับข้อมูลครบแล้วค่ะ ขอบคุณที่ให้ข้อมูลนะคะ ตอนนี้ส่งเรื่องให้เภสัชกรตรวจสอบแล้ว เภสัชกรจะติดต่อกลับพร้อมคำแนะนำโดยเร็วที่สุดค่ะ";
const CONFIRMATION_REPROMPT_TEXT =
  "ถ้าข้อมูลด้านบนถูกต้อง ตอบ “ข้อมูลถูกต้อง” หรือ “ยืนยัน” ได้เลยค่ะ ถ้าต้องการแก้ไข พิมพ์ข้อมูลที่ถูกต้องกลับมาได้เลยนะคะ";
const CORRECTION_PROMPT_TEXT =
  "ได้เลยค่ะ รบกวนพิมพ์ข้อมูลที่ต้องการแก้ไขกลับมาได้เลย เช่น “อายุ 24 ปี” หรือ “ไม่มีไข้” แล้วระบบจะอัปเดตสรุปให้อีกครั้งค่ะ";
const WAITING_TEXT = "ขณะนี้เภสัชกรกำลังตรวจสอบข้อมูลของคุณอยู่ค่ะ ขออภัยในความล่าช้า จะติดต่อกลับโดยเร็วที่สุดนะคะ 🙏";
const CUSTOMER_REQUESTED_TEXT = "รับทราบค่ะ ส่งเรื่องให้เภสัชกรติดต่อคุณโดยตรงแล้วนะคะ";
const RESTART_TEXT = "เข้าใจค่ะ ปิดเคสเดิมแล้ว หากต้องการปรึกษาอาการใหม่ พิมพ์อาการที่มีได้เลยค่ะ";
const EXPIRED_TEXT = "ขออภัยค่ะ เคสก่อนหน้าหมดอายุจากการไม่มีการตอบกลับ กรุณาพิมพ์อาการอีกครั้งเพื่อเริ่มใหม่นะคะ";
const AI_UNAVAILABLE_TEXT =
  "ขออภัยค่ะ ระบบผู้ช่วยไม่พร้อมใช้งานชั่วคราว ทางร้านได้บันทึกอาการที่แจ้งไว้แล้ว เภสัชกรจะติดต่อกลับโดยตรงค่ะ";

export type PharmacyIntakeTurnResult = { reply: string; caseId: string | null };

async function reply(_tenantId: string, _convId: string, caseId: string | null, text: string): Promise<PharmacyIntakeTurnResult> {
  return { reply: text, caseId };
}

async function clinicalResumePrompt(
  tenantId: string,
  state: Exclude<PharmacyIntakeConvState, { stage: "NONE" }>
): Promise<string | null> {
  if (state.stage === "AWAITING_CONSENT") return CONSENT_PROMPT_TEXT;
  if (state.stage === "PENDING_CONFIRMATION") return CONFIRMATION_REPROMPT_TEXT;
  if (state.stage === "WAITING") return WAITING_TEXT;

  const assessment = await getAssessment(tenantId, state.caseId);
  if (!assessment?.protocolId || !assessment.currentQuestionKey) return null;
  const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
  if (!protocol) return null;
  const protocolDef = toProtocolDefinition(protocol);
  const field = listAllQuestionFields(protocolDef).find(
    (candidate) => candidate.questionKey === assessment.currentQuestionKey
  );
  if (!field) return null;
  if (field.key === "patient_relationship") {
    return "ผู้ที่มีอาการคือตัวคุณเอง ลูก พ่อแม่ หรือบุคคลอื่นคะ?";
  }
  return `รบกวนแจ้ง${field.label}ด้วยค่ะ`;
}

/** Called from lib/bms/pipeline.ts as an early-return, before the normal AI tool loop runs. */
export async function runPharmacyIntakeTurn(
  tenantId: string,
  _channel: Channel,
  _customerRef: string | null | undefined,
  convId: string,
  message: string,
  state: PharmacyIntakeConvState
): Promise<PharmacyIntakeTurnResult> {
  if (state.stage === "NONE") return { reply: "", caseId: null };

  // Expiry check first — mid-conversation, independent of the batch cron sweep.
  const expired = await closeAssessmentIfExpired(tenantId, state.caseId);
  if (expired) {
    await clearConversationLink(tenantId, convId);
    return reply(tenantId, convId, null, EXPIRED_TEXT);
  }

  const conversationRoute = routePharmacyConversationMessage(message);
  if (conversationRoute.intent === "EMERGENCY") {
    if (state.stage !== "AWAITING_CONSENT") {
      await appendRawMessage(tenantId, state.caseId, { role: "customer", text: message });
    }
    await recordPharmacyEvent({
      tenantId,
      assessmentId: state.caseId,
      actor: "system:conversation-router",
      action: "assessment.red_flag_detected",
      meta: { code: "ROUTER_EMERGENCY", severity: "EMERGENCY" },
    });
    await routeProtocolEscalation(
      tenantId,
      state.caseId,
      "EMERGENCY_REFERRAL",
      "พบข้อความฉุกเฉินระหว่างบทสนทนา",
      "EMERGENCY",
      undefined,
      false
    );
    return reply(tenantId, convId, state.caseId, RED_FLAG_TEXT);
  }

  if (["GREETING", "THANKS", "SMALL_TALK", "PRODUCT_SIDE_INTENT", "ORDER_STATUS"].includes(conversationRoute.intent)) {
    const routedReply = pharmacyRouterReply(conversationRoute, {
      activeClinicalWorkflow: true,
      resumePrompt: await clinicalResumePrompt(tenantId, state),
    });
    if (routedReply) {
      if (state.stage !== "AWAITING_CONSENT") {
        await appendRawMessage(tenantId, state.caseId, { role: "customer", text: message });
      }
      await recordPharmacyEvent({
        tenantId,
        assessmentId: state.caseId,
        actor: "system:conversation-router",
        action: "assessment.conversation_interrupted",
        meta: { intent: conversationRoute.intent, statePreserved: true },
      });
      return reply(tenantId, convId, state.caseId, routedReply);
    }
  }

  if (state.stage === "AWAITING_CONSENT") {
    return handleConsent(tenantId, convId, state.caseId, message);
  }

  if (state.stage === "PENDING_CONFIRMATION") {
    return handlePendingConfirmation(tenantId, convId, state.caseId, message);
  }

  if (state.stage === "WAITING") {
    await appendRawMessage(tenantId, state.caseId, { role: "customer", text: message });
    if (RESTART_PATTERN.test(message)) {
      await closeAssessment(tenantId, state.caseId, "customer_restart");
      await clearConversationLink(tenantId, convId);
      return reply(tenantId, convId, null, RESTART_TEXT);
    }
    return reply(tenantId, convId, state.caseId, WAITING_TEXT);
  }

  // stage === "ASKING"
  return handleAsking(tenantId, convId, state.caseId, message);
}

async function handleConsent(tenantId: string, convId: string, caseId: string, message: string): Promise<PharmacyIntakeTurnResult> {
  const text = message.trim();
  const isYes = /(ยินยอม|ตกลง|ใช่|ok|yes|ได้)/i.test(text) && !/(ไม่ยินยอม|ไม่ตกลง|ไม่ใช่|ไม่)/i.test(text);
  const isNo = /(ไม่ยินยอม|ไม่ตกลง|ไม่ใช่|no)/i.test(text) || (/^ไม่/i.test(text) && !isYes);

  if (isNo) {
    await recordConsent(tenantId, caseId, "REVOKED", CONSENT_VERSION);
    await closeAssessment(tenantId, caseId, "consent_revoked");
    await clearConversationLink(tenantId, convId);
    return reply(tenantId, convId, null, CONSENT_REVOKED_TEXT);
  }
  if (!isYes) {
    return reply(tenantId, convId, caseId, `${DISCLAIMER_TEXT}\n\n${CONSENT_UNCLEAR_TEXT}`);
  }

  await recordConsent(tenantId, caseId, "GRANTED", CONSENT_VERSION);
  const assessment = await getAssessment(tenantId, caseId);
  if (!assessment?.protocolId) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
  if (!protocol) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  const protocolDef = toProtocolDefinition(protocol);
  const rememberedProfile = await getLatestReusablePatientProfile(
    tenantId,
    assessment.customerId,
    assessment.patientRelationship,
    caseId
  );
  const rememberedKnownFields = mergeRememberedFields({}, rememberedProfile);
  const rememberedKeys = rememberedFieldKeysAdded({}, rememberedProfile);
  if (rememberedProfile && rememberedKeys.length > 0) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId: caseId,
      actor: "system:pharmacy-intake",
      action: "assessment.patient_memory_reused",
      meta: { sourceAssessmentId: rememberedProfile.sourceAssessmentId, fields: rememberedKeys },
    });
  }
  const missing = computeMissingFields(protocolDef, rememberedKnownFields);
  const question = await askNextQuestion(tenantId, caseId, protocol, protocolDef, rememberedKnownFields, missing);
  await updateAnswers(tenantId, caseId, {
    currentQuestionKey: question.questionKey,
    structuredAnswersPatch: Object.fromEntries(
      Object.entries(rememberedKnownFields).filter(([key]) => !TYPED_PATIENT_KEYS.has(key))
    ),
    patientAgeYears: typeof rememberedKnownFields.patient_age_years === "number" ? rememberedKnownFields.patient_age_years : undefined,
    biologicalSex: typeof rememberedKnownFields.biological_sex === "string" ? rememberedKnownFields.biological_sex : undefined,
    pregnancyStatus: typeof rememberedKnownFields.pregnancy_status === "string" ? rememberedKnownFields.pregnancy_status : undefined,
    breastfeedingStatus:
      typeof rememberedKnownFields.breastfeeding_status === "string" ? rememberedKnownFields.breastfeeding_status : undefined,
    missingFields: missing,
    conflictingFields: [],
    anomalies: [],
    completenessStatus: resolveCompletenessStatus(protocolDef, rememberedKnownFields),
  });
  return reply(tenantId, convId, caseId, question.questionText);
}

async function handlePendingConfirmation(
  tenantId: string,
  convId: string,
  caseId: string,
  message: string
): Promise<PharmacyIntakeTurnResult> {
  const text = message.trim();

  if (RESTART_PATTERN.test(text)) {
    await appendRawMessage(tenantId, caseId, { role: "customer", text });
    await closeAssessment(tenantId, caseId, "customer_restart");
    await clearConversationLink(tenantId, convId);
    return reply(tenantId, convId, null, RESTART_TEXT);
  }

  if (isConfirmationAccepted(text)) {
    await appendRawMessage(tenantId, caseId, { role: "customer", text });
    const confirmed = await confirmCustomerSummary(tenantId, caseId);
    if (!confirmed) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
    return reply(tenantId, convId, caseId, SUBMITTED_TEXT);
  }

  if (isBareCorrectionRequest(text)) {
    await appendRawMessage(tenantId, caseId, { role: "customer", text });
    const reopened = await reopenForCustomerCorrection(tenantId, caseId);
    if (!reopened) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
    return reply(tenantId, convId, caseId, CORRECTION_PROMPT_TEXT);
  }

  const reopened = await reopenForCustomerCorrection(tenantId, caseId);
  if (!reopened) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  if (isCorrectionIntent(text) || text.length > 0) {
    return handleAsking(tenantId, convId, caseId, text);
  }
  await appendRawMessage(tenantId, caseId, { role: "customer", text });
  return reply(tenantId, convId, caseId, CONFIRMATION_REPROMPT_TEXT);
}

async function handleAsking(tenantId: string, convId: string, caseId: string, message: string): Promise<PharmacyIntakeTurnResult> {
  if (RESTART_PATTERN.test(message)) {
    await appendRawMessage(tenantId, caseId, { role: "customer", text: message });
    await closeAssessment(tenantId, caseId, "customer_restart");
    await clearConversationLink(tenantId, convId);
    return reply(tenantId, convId, null, RESTART_TEXT);
  }
  if (TALK_TO_PHARMACIST_PATTERN.test(message)) {
    await appendRawMessage(tenantId, caseId, { role: "customer", text: message });
    await markWaitingForPharmacist(tenantId, caseId, "customer_requested");
    return reply(tenantId, convId, caseId, CUSTOMER_REQUESTED_TEXT);
  }

  const assessment = await getAssessment(tenantId, caseId);
  if (!assessment || !assessment.protocolId) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
  if (!protocol) return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  const protocolDef = toProtocolDefinition(protocol);
  let rememberedProfile = await getLatestReusablePatientProfile(
    tenantId,
    assessment.customerId,
    assessment.patientRelationship,
    caseId
  );

  await appendRawMessage(tenantId, caseId, { role: "customer", text: message, questionKey: assessment.currentQuestionKey });

  if (!isPharmacyAiEnabled()) {
    // No AI at all → hand off to a human immediately. Never fabricate a structured answer.
    await markNeedsManualIntake(tenantId, caseId, "ai_disabled");
    await markWaitingForPharmacist(tenantId, caseId, "ai_unavailable");
    return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  }

  const knownFieldKeys = listAllQuestionFields(protocolDef).map((field) => field.key);
  const extraction = await DEFAULT_AI.extractStructuredData({
    tenantId,
    caseId,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    symptomGroup: protocol.supportedSymptomGroup,
    priorAnswers: buildPriorAnswersForExtraction(mergeRememberedFields(buildKnownFields(assessment), rememberedProfile)),
    latestCustomerMessage: message,
    currentQuestionKey: assessment.currentQuestionKey,
    knownFieldKeys,
    locale: "th",
  });

  if (!extraction || extraction.extractionFailed) {
    await markNeedsManualIntake(tenantId, caseId, "extraction_unavailable");
    await markWaitingForPharmacist(tenantId, caseId, "ai_unavailable");
    await reportBmsFailure({
      tenantId,
      code: "pharmacy_ai.unavailable",
      error: "extractStructuredData returned null/extractionFailed",
      surface: "customer",
      channel: undefined,
      conversationId: convId,
      meta: { assessmentId: caseId, step: "extract" },
    });
    return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  }

  const newlyExtracted = normalizeExtractedPatientFields(
    extraction.extractedFields,
    message,
    assessment.currentQuestionKey
  );
  const extractedRelationship = normalizePatientRelationship(newlyExtracted.patient_relationship);
  if (!rememberedProfile && extractedRelationship === "SELF") {
    rememberedProfile = await getLatestReusablePatientProfile(
      tenantId,
      assessment.customerId,
      extractedRelationship,
      caseId
    );
  }
  const assessmentKnownFields = buildKnownFields(assessment);
  const rememberedKeys = rememberedFieldKeysAdded(assessmentKnownFields, rememberedProfile);
  if (rememberedProfile && rememberedKeys.length > 0) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId: caseId,
      actor: "system:pharmacy-intake",
      action: "assessment.patient_memory_reused",
      meta: { sourceAssessmentId: rememberedProfile.sourceAssessmentId, fields: rememberedKeys },
    });
  }
  const priorKnownFields = mergeRememberedFields(assessmentKnownFields, rememberedProfile);
  const knownFields: KnownFields = { ...priorKnownFields, ...newlyExtracted };

  if (Object.keys(newlyExtracted).length > 0) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId: caseId,
      actor: "ai:pharmacy-intake",
      action: Object.keys(priorKnownFields).some((k) => k in newlyExtracted) ? "assessment.answer_changed" : "assessment.answer_added",
      meta: { fields: Object.keys(newlyExtracted).join(", ") },
    });
  }

  const decision = evaluateAnswer(protocolDef, knownFields);

  if (decision.decision === "RED_FLAG") {
    if (decision.flag.action === "CONTINUE") {
      throw new Error("RED_FLAG decision cannot use CONTINUE escalation");
    }
    await recordPharmacyEvent({
      tenantId,
      assessmentId: caseId,
      actor: "system:pharmacy-intake",
      action: "assessment.red_flag_detected",
      meta: { code: decision.flag.code, severity: decision.flag.severity },
    });
    await recordPharmacyEvent({
      tenantId,
      assessmentId: caseId,
      actor: "system:pharmacy-intake",
      action: "assessment.risk_level_changed",
      meta: { from: assessment.riskLevel, to: decision.flag.severity },
    });
    await persistMergedFields(tenantId, caseId, knownFields, {
      anomalies: [],
      completenessStatus: "CONFLICT",
      detectedRedFlags: [{ code: decision.flag.code, label: decision.flag.label, severity: decision.flag.severity }],
      riskLevel: decision.flag.severity,
    });
    await routeProtocolEscalation(tenantId, caseId, decision.flag.action, decision.flag.label, decision.flag.severity, undefined, false);
    const escalationText = decision.flag.action === "EMERGENCY_REFERRAL"
      ? RED_FLAG_TEXT
      : decision.flag.action === "URGENT_MEDICAL_REVIEW"
        ? URGENT_MEDICAL_TEXT
        : PHARMACIST_REVIEW_TEXT;
    return reply(tenantId, convId, caseId, escalationText);
  }

  if (decision.decision === "ANOMALY") {
    const first = decision.anomalies[0];
    const anomalyQuestion = getQuestionFieldDef(protocolDef, first.fieldKey);
    await persistMergedFields(tenantId, caseId, knownFields, {
      missingFields: decision.missingFieldKeys,
      conflictingFields: [],
      anomalies: decision.anomalies,
      completenessStatus: "INCOMPLETE",
      currentQuestionKey: anomalyQuestion?.questionKey ?? assessment.currentQuestionKey,
    });
    return reply(tenantId, convId, caseId, clarificationForAnomaly(first.fieldKey, first.label));
  }

  if (decision.decision === "MISSING_FIELDS") {
    await persistMergedFields(tenantId, caseId, knownFields, {
      missingFields: decision.missingFieldKeys,
      conflictingFields: [],
      anomalies: [],
      completenessStatus: "INCOMPLETE",
    });
    const question = await askNextQuestion(tenantId, caseId, protocol, protocolDef, knownFields, decision.missingFieldKeys);
    await updateAnswers(tenantId, caseId, { currentQuestionKey: question.questionKey });
    return reply(tenantId, convId, caseId, question.questionText);
  }

  if (decision.decision === "CONFLICT") {
    await persistMergedFields(tenantId, caseId, knownFields, {
      conflictingFields: decision.conflictingFieldKeys,
      missingFields: [],
      anomalies: [],
      completenessStatus: "CONFLICT",
      currentQuestionKey: getQuestionFieldDef(protocolDef, decision.conflictingFieldKeys[0])?.questionKey ?? assessment.currentQuestionKey,
    });
    return reply(tenantId, convId, caseId, clarificationForConflict(decision.conflictingFieldKeys[0]));
  }

  // COMPLETE
  await persistMergedFields(tenantId, caseId, knownFields, {
    missingFields: [],
    conflictingFields: [],
    anomalies: [],
    completenessStatus: "COMPLETE",
    customerConfirmationStatus: "NOT_REQUESTED",
    customerConfirmedAt: null,
  });
  const summary = await DEFAULT_AI.summarizeAssessment({
    tenantId,
    caseId,
    protocolId: protocol.id,
    symptomGroup: protocol.supportedSymptomGroup,
    allAnswers: knownFields,
    locale: "th",
  });
  if (summary) {
    await recordAiSummary(tenantId, caseId, {
      summaryText: `${summary.summaryText}\n\n[${summary.aiCaveat}]`,
      promptVersion: "pharmacy-summary-v1",
      modelVersion: "shared",
    });
  } else {
    await markNeedsManualIntake(tenantId, caseId, "summary_unavailable");
    await recordAiSummary(tenantId, caseId, {
      summaryText: "AI สรุปไม่สำเร็จ — กรุณาอ่านบทสนทนาต้นฉบับ (raw conversation) โดยตรง",
      promptVersion: "pharmacy-summary-v1",
      modelVersion: "manual-fallback",
    });
    await reportBmsFailure({
      tenantId,
      code: "pharmacy_ai.unavailable",
      error: "summarizeAssessment returned null",
      surface: "customer",
      conversationId: convId,
      meta: { assessmentId: caseId, step: "summarize" },
    });
  }
  const confirmationSummary = buildCustomerConfirmationSummary(protocol, protocolDef, knownFields);
  await markPendingCustomerConfirmation(tenantId, caseId, confirmationSummary);
  return reply(tenantId, convId, caseId, renderCustomerConfirmationPrompt(confirmationSummary));
}

// ---------------------------------------------------------------
// Entry point — called from pipeline.ts when no case is in flight yet
// ---------------------------------------------------------------
export async function startPharmacyIntake(
  tenantId: string,
  convId: string,
  customerId: string | null,
  channel: string,
  protocolKey: string
): Promise<PharmacyIntakeTurnResult> {
  const protocol = await getActivePharmacyProtocolByKey(tenantId, protocolKey);
  if (!protocol) {
    // Protocol disabled/not clinically approved/not enabled — do not start a case.
    return { reply: "", caseId: null };
  }
  const created = await createAssessmentOnce({ tenantId, customerId, channelId: channel, conversationId: convId, protocolId: protocol.id });
  const caseId = created.status === "CREATED" ? created.assessmentId : created.assessmentId;
  return reply(tenantId, convId, caseId, `${DISCLAIMER_TEXT}\n\n${CONSENT_PROMPT_TEXT}`);
}

// ---------------------------------------------------------------
// Manual data entry — closes the "AI degraded mid-conversation" dead end
// -------------------------------------------------------------
// Without this, a case that hit needs_manual_intake with stale
// missing_fields is stuck: approveAssessment() blocks on non-empty
// missing_fields, and "request more information" just sends the customer
// back into the same broken AI extraction loop. This lets a pharmacist type
// the answers in themselves — re-running the SAME deterministic rule engine
// as if AI had extracted them (never a separate, looser check) — per the
// spec's explicit "AI unavailable → hand off to human, no data loss"
// requirement. Reachable while a pharmacist has visibility on the case
// (WAITING_FOR_PHARMACIST / PHARMACIST_REVIEWING / NEED_MORE_INFORMATION);
// never changes `status` except the same RED_FLAG → EMERGENCY_REFERRAL
// escalation the AI-driven path would also take.
// ---------------------------------------------------------------
export type ManualFillResult = { decision: "RED_FLAG" | "ANOMALY" | "MISSING_FIELDS" | "CONFLICT" | "COMPLETE" };

function normalizeManualAnswer(
  fieldKey: string,
  rawValue: unknown,
  protocolDef: ProtocolDefinition
): string | number {
  const field = getQuestionFieldDef(protocolDef, fieldKey);
  if (!field) throw new Error(`ไม่รู้จัก field: ${fieldKey}`);
  const text = String(rawValue ?? "").trim();
  if (!text) throw new Error(`ต้องระบุค่า ${fieldKey}`);

  if (fieldKey === "patient_relationship") {
    const relationship = normalizePatientRelationship(text);
    if (!relationship) throw new Error("ผู้มีอาการต้องเป็น ตัวเอง, ลูก, พ่อแม่ หรือบุคคลอื่น");
    return relationship;
  }
  if (fieldKey === "biological_sex") {
    if (/^(MALE|ชาย)$/i.test(text)) return "MALE";
    if (/^(FEMALE|หญิง)$/i.test(text)) return "FEMALE";
    if (/^UNKNOWN$/i.test(text)) return "UNKNOWN";
    throw new Error("เพศกำเนิดต้องเป็น ชาย, หญิง หรือไม่ทราบ");
  }
  if (field.type === "yes_no") {
    if (/^(YES|มี|ใช่|เป็น)$/i.test(text)) return "YES";
    if (/^(NO|ไม่มี|ไม่|ไม่ใช่|ไม่เป็น)$/i.test(text)) return "NO";
    if (/^UNKNOWN$/i.test(text)) return "UNKNOWN";
    throw new Error(`${field.label} ต้องตอบ มี/ไม่มี หรือ YES/NO`);
  }
  if (field.type === "number" || field.type === "duration") {
    const value = typeof rawValue === "number" ? rawValue : Number(text);
    if (!Number.isFinite(value)) throw new Error(`${field.label} ต้องเป็นตัวเลข`);
    return value;
  }
  if (text.length > 2_000) throw new Error(`${field.label} ยาวเกิน 2,000 ตัวอักษร`);
  return text;
}

export async function applyManualAnswers(
  tenantId: string,
  assessmentId: string,
  answers: Record<string, string | number>,
  actorUserId: string,
  ctx?: any
): Promise<ManualFillResult> {
  const assessment = await getAssessment(tenantId, assessmentId);
  if (!assessment) throw new Error("ไม่พบเคส");
  if (!["WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"].includes(assessment.status)) {
    throw new Error(`สถานะ ${assessment.status} ไม่อนุญาตให้กรอกข้อมูลที่ขาดเอง`);
  }
  if (!assessment.protocolId && assessment.complaint?.requestType === "PRODUCT_PURCHASE") {
    const normalizedAnswers: Record<string, string | number> = {};
    for (const [fieldKey, rawValue] of Object.entries(answers)) {
      if (!assessment.missingFields.includes(fieldKey)) throw new Error(`${fieldKey} ไม่ใช่ข้อมูลที่ขาดของเคสนี้`);
      const text = String(rawValue ?? "").trim();
      if (!text) throw new Error(`ต้องระบุค่า ${fieldKey}`);
      if (fieldKey === "patient_relationship") {
        const relationship = normalizePatientRelationship(text);
        if (!relationship) throw new Error("ผู้ใช้สินค้าต้องเป็น ตัวเอง, ลูก, พ่อแม่ หรือบุคคลอื่น");
        normalizedAnswers[fieldKey] = relationship;
      } else if (fieldKey === "patient_age_years") {
        const age = Number(rawValue);
        if (!Number.isInteger(age) || age < 0 || age > 130) throw new Error("อายุต้องเป็นจำนวนเต็ม 0-130 ปี");
        normalizedAnswers[fieldKey] = age;
      } else if (fieldKey === "allergies" || fieldKey === "current_medications") {
        if (text.length > 2_000) throw new Error(`${fieldKey} ยาวเกิน 2,000 ตัวอักษร`);
        normalizedAnswers[fieldKey] = text;
      } else {
        throw new Error(`ไม่รู้จัก field: ${fieldKey}`);
      }
    }
    const knownFields: KnownFields = { ...buildKnownFields(assessment), ...normalizedAnswers };
    const remaining = assessment.missingFields.filter((field) => !(field in normalizedAnswers));
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      missingFields: remaining,
      conflictingFields: [],
      anomalies: [],
      completenessStatus: remaining.length === 0 ? "COMPLETE" : "INCOMPLETE",
    });
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
      action: "assessment.manual_answer_recorded",
      meta: { fields: Object.keys(normalizedAnswers).join(", "), source: "manual_pharmacist_entry" },
      ctx,
    });
    return { decision: remaining.length === 0 ? "COMPLETE" : "MISSING_FIELDS" };
  }
  if (!assessment.protocolId) throw new Error("เคสนี้ไม่มี protocol ผูกอยู่");
  const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
  if (!protocol) throw new Error("ไม่พบ protocol ของเคสนี้");
  const protocolDef = toProtocolDefinition(protocol);

  const normalizedAnswers: Record<string, string | number> = {};
  for (const [fieldKey, rawValue] of Object.entries(answers)) {
    if (!assessment.missingFields.includes(fieldKey)) {
      throw new Error(`${fieldKey} ไม่ใช่ข้อมูลที่ขาดของเคสนี้`);
    }
    normalizedAnswers[fieldKey] = normalizeManualAnswer(fieldKey, rawValue, protocolDef);
  }

  const knownFields: KnownFields = { ...buildKnownFields(assessment), ...normalizedAnswers };
  const actor = ctx?.admin?.email || ctx?.admin?.id || actorUserId;

  const decision = evaluateAnswer(protocolDef, knownFields);
  if (decision.decision === "RED_FLAG") {
    if (decision.flag.action === "CONTINUE") {
      throw new Error("RED_FLAG decision cannot use CONTINUE escalation");
    }
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      anomalies: [],
      completenessStatus: "CONFLICT",
      detectedRedFlags: [{ code: decision.flag.code, label: decision.flag.label, severity: decision.flag.severity }],
      riskLevel: decision.flag.severity,
    });
    await routeProtocolEscalation(tenantId, assessmentId, decision.flag.action, decision.flag.label, decision.flag.severity, ctx);
  } else if (decision.decision === "ANOMALY") {
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      missingFields: decision.missingFieldKeys,
      conflictingFields: [],
      anomalies: decision.anomalies,
      completenessStatus: "INCOMPLETE",
    });
  } else if (decision.decision === "MISSING_FIELDS") {
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      missingFields: decision.missingFieldKeys,
      conflictingFields: [],
      anomalies: [],
      completenessStatus: "INCOMPLETE",
    });
  } else if (decision.decision === "CONFLICT") {
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      conflictingFields: decision.conflictingFieldKeys,
      missingFields: [],
      anomalies: [],
      completenessStatus: "CONFLICT",
    });
  } else {
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      missingFields: [],
      conflictingFields: [],
      anomalies: [],
      completenessStatus: "COMPLETE",
    });
  }
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor,
    action: "assessment.manual_answer_recorded",
    meta: { fields: Object.keys(normalizedAnswers).join(", "), source: "manual_pharmacist_entry" },
    ctx,
  });
  return { decision: decision.decision };
}
