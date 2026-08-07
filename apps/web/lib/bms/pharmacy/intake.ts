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
import { getAssessment, appendRawMessage, updateAnswers, recordAiSummary, markNeedsManualIntake, closeAssessmentIfExpired, closeAssessment, markWaitingForPharmacist, escalateToEmergency, createAssessmentOnce, recordConsent, type PharmacyAssessmentRow } from "./assessments";
import { getActivePharmacyProtocolByKey, getPharmacyProtocol, toProtocolDefinition, type PharmacyProtocolRow } from "./protocols";
import { evaluateAnswer, computeMissingFields, type KnownFields, type ProtocolDefinition } from "./ruleEngine";
import { AnthropicCompatiblePharmacyIntakeAI, type NextQuestionResult, type PharmacyIntakeAI } from "./ai";
import { recordPharmacyEvent } from "./events";
import { sendPharmacyIntakeMessage } from "../inbox";
import { isPharmacyAiEnabled } from "./config";
import { reportBmsFailure } from "../failureAlert";
import type { Channel } from "../pipeline";

const CONSENT_VERSION = "pharmacy-intake-v1";
const DEFAULT_AI: PharmacyIntakeAI = new AnthropicCompatiblePharmacyIntakeAI();

// ---------------------------------------------------------------
// Entry-trigger detection (deterministic — AI never silently starts a case)
// ---------------------------------------------------------------
const PROTOCOL_TRIGGER_PATTERNS: Record<string, RegExp> = {
  headache: /(ปวดหัว|ปวดศีรษะ|migraine|headache)/i,
  cough: /(ไอ(?!ศ)|cough)/i,
  diarrhea: /(ท้องเสีย|ถ่ายเหลว|diarrhea)/i,
};

const TALK_TO_PHARMACIST_PATTERN = /(คุยกับเภสัชกร|ขอคุยกับเภสัชกร|ปรึกษาเภสัชกร|ปรึกษาอาการ|ขอคุยเภสัชกร)/i;
const RESTART_PATTERN = /(ไม่เอาแล้ว|ยกเลิก|เริ่มใหม่|อาการเปลี่ยน|เปลี่ยนอาการ)/i;

export function detectPharmacyIntakeTrigger(message: string): { protocolKey: string } | null {
  for (const [protocolKey, pattern] of Object.entries(PROTOCOL_TRIGGER_PATTERNS)) {
    if (pattern.test(message)) return { protocolKey };
  }
  return null;
}

// ---------------------------------------------------------------
// Conversation-level state (analogous to inbox.ts's getAiConversationState)
// ---------------------------------------------------------------
export type PharmacyIntakeConvState =
  | { stage: "NONE" }
  | { stage: "AWAITING_CONSENT"; caseId: string }
  | { stage: "ASKING"; caseId: string; status: PharmacyAssessmentRow["status"] }
  | { stage: "WAITING"; caseId: string; status: PharmacyAssessmentRow["status"] };

const OPEN_STATUSES = new Set(["DRAFT", "COLLECTING_INFORMATION", "WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"]);

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
  if (assessment.biologicalSex !== "UNKNOWN") fields.biological_sex = assessment.biologicalSex;
  if (assessment.pregnancyStatus !== "UNKNOWN") fields.pregnancy_status = assessment.pregnancyStatus;
  if (assessment.breastfeedingStatus !== "UNKNOWN") fields.breastfeeding_status = assessment.breastfeedingStatus;
  if (assessment.patientAgeYears != null) fields.patient_age_years = assessment.patientAgeYears;
  return fields;
}

const TYPED_PATIENT_KEYS = new Set(["biological_sex", "pregnancy_status", "breastfeeding_status", "patient_age_years"]);

async function persistMergedFields(
  tenantId: string,
  assessmentId: string,
  knownFields: KnownFields,
  extra: { missingFields?: string[]; conflictingFields?: string[]; detectedRedFlags?: unknown[]; riskLevel?: string; currentQuestionKey?: string | null }
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
    detectedRedFlags: extra.detectedRedFlags,
    riskLevel: extra.riskLevel,
    currentQuestionKey: extra.currentQuestionKey,
    biologicalSex: typeof typed.biological_sex === "string" ? typed.biological_sex : undefined,
    pregnancyStatus: typeof typed.pregnancy_status === "string" ? typed.pregnancy_status : undefined,
    breastfeedingStatus: typeof typed.breastfeeding_status === "string" ? typed.breastfeeding_status : undefined,
    patientAgeYears: typeof typed.patient_age_years === "number" ? typed.patient_age_years : undefined,
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
  if (isPharmacyAiEnabled()) {
    const result = await DEFAULT_AI.selectNextQuestion({
      tenantId,
      caseId,
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      requiredFields: protocolDef.requiredFields,
      conditionalQuestions: protocolDef.conditionalQuestions,
      knownFields,
      missingFieldKeys,
      locale: "th",
    });
    if (result) return result;
    await markNeedsManualIntake(tenantId, caseId, "select_next_question_unavailable");
  }
  // Deterministic fallback — no AI call, no guessing: ask the field's own label.
  const key = missingFieldKeys[0];
  const field = protocolDef.requiredFields.find((f) => f.key === key);
  if (field) return { questionKey: field.questionKey, questionText: `รบกวนแจ้ง${field.label}ด้วยค่ะ`, inputHint: field.type };
  const conditional = protocolDef.conditionalQuestions.find((q) => q.key === key);
  if (conditional) {
    return {
      questionKey: conditional.questionKey,
      questionText: conditional.label ? `รบกวนแจ้ง${conditional.label}ด้วยค่ะ` : "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ",
      inputHint: conditional.type ?? "free_text",
    };
  }
  return { questionKey: "unknown", questionText: "รบกวนแจ้งข้อมูลเพิ่มเติมด้วยค่ะ", inputHint: "free_text" };
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
const CONFLICT_TEXT = "ขอบคุณสำหรับข้อมูลค่ะ มีบางส่วนที่ทางร้านขอให้เภสัชกรตรวจสอบเพิ่มเติมก่อน จะรีบติดต่อกลับนะคะ";
const SUBMITTED_TEXT =
  "ได้รับข้อมูลครบแล้วค่ะ ขอบคุณที่ให้ข้อมูลนะคะ ตอนนี้ส่งเรื่องให้เภสัชกรตรวจสอบแล้ว เภสัชกรจะติดต่อกลับพร้อมคำแนะนำโดยเร็วที่สุดค่ะ";
const WAITING_TEXT = "ขณะนี้เภสัชกรกำลังตรวจสอบข้อมูลของคุณอยู่ค่ะ ขออภัยในความล่าช้า จะติดต่อกลับโดยเร็วที่สุดนะคะ 🙏";
const CUSTOMER_REQUESTED_TEXT = "รับทราบค่ะ ส่งเรื่องให้เภสัชกรติดต่อคุณโดยตรงแล้วนะคะ";
const RESTART_TEXT = "เข้าใจค่ะ ปิดเคสเดิมแล้ว หากต้องการปรึกษาอาการใหม่ พิมพ์อาการที่มีได้เลยค่ะ";
const EXPIRED_TEXT = "ขออภัยค่ะ เคสก่อนหน้าหมดอายุจากการไม่มีการตอบกลับ กรุณาพิมพ์อาการอีกครั้งเพื่อเริ่มใหม่นะคะ";
const AI_UNAVAILABLE_TEXT =
  "ขออภัยค่ะ ระบบผู้ช่วยไม่พร้อมใช้งานชั่วคราว ทางร้านได้บันทึกอาการที่แจ้งไว้แล้ว เภสัชกรจะติดต่อกลับโดยตรงค่ะ";

export type PharmacyIntakeTurnResult = { reply: string; caseId: string | null };

async function reply(tenantId: string, convId: string, caseId: string | null, text: string): Promise<PharmacyIntakeTurnResult> {
  await sendPharmacyIntakeMessage(tenantId, convId, text, {
    kind: "text",
    caseId,
  });
  return { reply: text, caseId };
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

  if (state.stage === "AWAITING_CONSENT") {
    return handleConsent(tenantId, convId, state.caseId, message);
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
  const missing = computeMissingFields(protocolDef, {});
  const question = await askNextQuestion(tenantId, caseId, protocol, protocolDef, {}, missing);
  await updateAnswers(tenantId, caseId, { currentQuestionKey: question.questionKey, missingFields: missing });
  return reply(tenantId, convId, caseId, question.questionText);
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

  await appendRawMessage(tenantId, caseId, { role: "customer", text: message, questionKey: assessment.currentQuestionKey });

  if (!isPharmacyAiEnabled()) {
    // No AI at all → hand off to a human immediately. Never fabricate a structured answer.
    await markNeedsManualIntake(tenantId, caseId, "ai_disabled");
    await markWaitingForPharmacist(tenantId, caseId);
    return reply(tenantId, convId, caseId, AI_UNAVAILABLE_TEXT);
  }

  const knownFieldKeys = [
    ...protocolDef.requiredFields.map((f) => f.key),
    ...protocolDef.conditionalQuestions.map((q) => q.key),
  ];
  const extraction = await DEFAULT_AI.extractStructuredData({
    tenantId,
    caseId,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    symptomGroup: protocol.supportedSymptomGroup,
    priorAnswers: [],
    latestCustomerMessage: message,
    currentQuestionKey: assessment.currentQuestionKey,
    knownFieldKeys,
    locale: "th",
  });

  if (!extraction || extraction.extractionFailed) {
    await markNeedsManualIntake(tenantId, caseId, "extraction_unavailable");
    await markWaitingForPharmacist(tenantId, caseId);
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

  const priorKnownFields = buildKnownFields(assessment);
  const newlyExtracted = extraction.extractedFields;
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
      detectedRedFlags: [{ code: decision.flag.code, label: decision.flag.label, severity: decision.flag.severity }],
      riskLevel: decision.flag.severity,
    });
    await escalateToEmergency(tenantId, caseId, decision.flag.label);
    return reply(tenantId, convId, caseId, RED_FLAG_TEXT);
  }

  if (decision.decision === "MISSING_FIELDS") {
    await persistMergedFields(tenantId, caseId, knownFields, { missingFields: decision.missingFieldKeys, conflictingFields: [] });
    const question = await askNextQuestion(tenantId, caseId, protocol, protocolDef, knownFields, decision.missingFieldKeys);
    await updateAnswers(tenantId, caseId, { currentQuestionKey: question.questionKey });
    return reply(tenantId, convId, caseId, question.questionText);
  }

  if (decision.decision === "CONFLICT") {
    await persistMergedFields(tenantId, caseId, knownFields, { conflictingFields: decision.conflictingFieldKeys, missingFields: [] });
    await markWaitingForPharmacist(tenantId, caseId);
    return reply(tenantId, convId, caseId, CONFLICT_TEXT);
  }

  // COMPLETE
  await persistMergedFields(tenantId, caseId, knownFields, { missingFields: [], conflictingFields: [] });
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
  await markWaitingForPharmacist(tenantId, caseId);
  return reply(tenantId, convId, caseId, SUBMITTED_TEXT);
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
export type ManualFillResult = { decision: "RED_FLAG" | "MISSING_FIELDS" | "CONFLICT" | "COMPLETE" };

export async function applyManualAnswers(
  tenantId: string,
  assessmentId: string,
  answers: Record<string, string | number>,
  actorUserId: string,
  ctx?: any
): Promise<ManualFillResult> {
  const assessment = await getAssessment(tenantId, assessmentId);
  if (!assessment || !assessment.protocolId) throw new Error("ไม่พบเคสหรือยังไม่มี protocol ผูกอยู่");
  const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
  if (!protocol) throw new Error("ไม่พบ protocol ของเคสนี้");
  const protocolDef = toProtocolDefinition(protocol);

  const knownFields: KnownFields = { ...buildKnownFields(assessment), ...answers };
  const actor = ctx?.admin?.email || ctx?.admin?.id || actorUserId;

  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor,
    action: "assessment.answer_changed",
    meta: { fields: Object.keys(answers).join(", "), source: "manual_pharmacist_entry" },
    ctx,
  });

  const decision = evaluateAnswer(protocolDef, knownFields);
  if (decision.decision === "RED_FLAG") {
    await persistMergedFields(tenantId, assessmentId, knownFields, {
      detectedRedFlags: [{ code: decision.flag.code, label: decision.flag.label, severity: decision.flag.severity }],
      riskLevel: decision.flag.severity,
    });
    await escalateToEmergency(tenantId, assessmentId, decision.flag.label, ctx);
  } else if (decision.decision === "MISSING_FIELDS") {
    await persistMergedFields(tenantId, assessmentId, knownFields, { missingFields: decision.missingFieldKeys, conflictingFields: [] });
  } else if (decision.decision === "CONFLICT") {
    await persistMergedFields(tenantId, assessmentId, knownFields, { conflictingFields: decision.conflictingFieldKeys, missingFields: [] });
  } else {
    await persistMergedFields(tenantId, assessmentId, knownFields, { missingFields: [], conflictingFields: [] });
  }
  return { decision: decision.decision };
}
