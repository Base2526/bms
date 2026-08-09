// =============================================================
// BMS Pharmacy Intake — PharmacyIntakeAI abstraction
// -------------------------------------------------------------
// AI's core three jobs: extract structured fields from free text, pick
// which already-known question to ask next, and summarize. It never
// decides red flags/missing fields/completion (lib/bms/pharmacy/
// ruleEngine.ts owns that) and never writes to the assessment row directly
// (lib/bms/pharmacy/assessments.ts owns that). No zod/ajv anywhere in this
// codebase — validation here is hand-rolled, matching
// lib/bms/tools/types.ts's reqString/enumVal/ToolArgError style.
//
// A 4th, deliberately separate capability — suggestMedications() — lets AI
// propose specific drug/strength/dosage candidates. This is a SCOPE
// EXPANSION beyond the module's original "AI never recommends a drug"
// premise, decided explicitly with the user (see README § AI medication
// suggestions): the output is PHARMACIST-ONLY, never sent to the customer,
// never auto-applied to pharmacist_decision_notes — a pharmacist must
// explicitly copy/edit it into their own approval text before Approve
// (which is still the same single gated path in assessments.ts). It is
// staff-initiated only (an explicit button click), never run automatically
// during customer-facing intake, and is filtered through a deterministic
// allergy cross-check before the pharmacist ever sees it.
//
// Always uses the platform shared key — NEVER tenant BYOK. This is a
// deliberate deviation from lib/bms/ai.ts's resolveAiCredentials() default
// order (which tries tenant BYOK first); pharmacy intake is health-data
// adjacent and platform ops should control model/prompt quality
// end-to-end, not each tenant's own key.
// =============================================================

import {
  callAnthropicCompatibleMessages,
  normalizeAiProvider,
  resolveSharedAiProvider,
  resolveSharedAiProviderDecision,
  type AiProvider,
  type ResolvedAiProvider,
} from "../aiProvider";
import { recordAiFallback, tryConsumeAiQuota, type AiUsageContext } from "../aiUsage";
import { pharmacyAiModelOverride, pharmacyAiProviderOverride, MAX_AI_VALIDATION_RETRIES } from "./config";
import { recordPharmacyEvent } from "./events";
import type { ProtocolConditionalQuestion, ProtocolFieldDef } from "./ruleEngine";

// ---------------------------------------------------------------
// Credentials — shared key only, never tenant BYOK
// ---------------------------------------------------------------
export type PharmacyAiCredentials = ResolvedAiProvider & { usageEventId?: string };

export async function resolvePharmacyAiCredentials(
  tenantId: string,
  usageCtx: AiUsageContext
): Promise<PharmacyAiCredentials | null> {
  const providerOverride = normalizeAiProvider(pharmacyAiProviderOverride());
  let shared: ResolvedAiProvider | null;
  let routingReason: string;
  let configuredProvider: AiProvider;
  let fallbackFrom: AiProvider | null = null;

  if (providerOverride) {
    shared = resolveSharedAiProvider(providerOverride, false);
    configuredProvider = providerOverride;
    routingReason = "primary";
  } else {
    // feature:"pharmacy_intake" is added to isSensitiveAiRoutingContext() in
    // ../aiProvider.ts — health-data-adjacent calls get the same
    // sensitive-provider preference (BMS_AI_SENSITIVE_PROVIDER) as payment
    // confirmation, by default.
    const decision = resolveSharedAiProviderDecision({ ...usageCtx, feature: "pharmacy_intake" });
    shared = decision.resolved;
    configuredProvider = decision.configuredProvider;
    routingReason = decision.routingReason;
    fallbackFrom = decision.fallbackFrom;
  }

  const modelOverride = pharmacyAiModelOverride();
  if (shared && modelOverride) shared = { ...shared, model: modelOverride };

  if (!shared) {
    await recordAiFallback(tenantId, "no_credentials", usageCtx);
    return null;
  }

  const withinQuota = await tryConsumeAiQuota(tenantId, {
    surface: usageCtx.surface,
    feature: usageCtx.feature,
    channel: usageCtx.channel,
    provider: shared.provider,
    model: shared.model,
    meta: {
      ...(usageCtx.meta ?? {}),
      routing_reason: routingReason,
      configured_provider: configuredProvider,
      effective_provider: shared.provider,
      fallback_from: fallbackFrom,
      pharmacy_intake: true,
    },
  });
  if (!withinQuota.ok) return null;
  return { ...shared, usageEventId: withinQuota.eventId };
}

// ---------------------------------------------------------------
// PharmacyIntakeAI contract types
// ---------------------------------------------------------------
export type IntakeAnswer = { fieldKey: string; rawText: string; askedAt: string };

export type IntakeAIInput = {
  tenantId: string;
  caseId: string;
  protocolId: string;
  protocolVersion: number;
  symptomGroup: string;
  priorAnswers: IntakeAnswer[];
  latestCustomerMessage: string;
  currentQuestionKey: string | null;
  knownFieldKeys: string[];
  locale: "th" | "en";
};

/** AI's ONLY job here: turn free text into structured fields. No judgement calls. */
export type IntakeExtraction = {
  extractedFields: Record<string, string | number | null>;
  fieldConfidence: Record<string, "high" | "medium" | "low">;
  unmappedText: string | null;
  extractionFailed: boolean;
};

export type NextQuestionInput = {
  tenantId: string;
  caseId: string;
  protocolId: string;
  protocolVersion: number;
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  knownFields: Record<string, unknown>;
  missingFieldKeys: string[];
  locale: "th" | "en";
};

export type NextQuestionResult = {
  questionKey: string;
  questionText: string;
  inputHint: "free_text" | "yes_no" | "choice" | "number" | "duration";
  choices?: string[];
};

export type SummaryInput = {
  tenantId: string;
  caseId: string;
  protocolId: string;
  symptomGroup: string;
  allAnswers: Record<string, unknown>;
  locale: "th" | "en";
};

/** AI produces a SUMMARY only — never a recommendation/diagnosis/drug name. */
export type AssessmentSummary = {
  summaryText: string;
  keySymptoms: string[];
  allergiesNoted: string[];
  currentMedsNoted: string[];
  timelineNote: string | null;
  aiCaveat: string;
};

export type MedicationSuggestionInput = {
  tenantId: string;
  caseId: string;
  symptomGroup: string;
  allAnswers: Record<string, unknown>;
  /** free-text allergy/current-medication strings, passed separately so the prompt can lead with them */
  allergiesText: string;
  currentMedicationsText: string;
  pregnancyStatus: string;
  breastfeedingStatus: string;
  patientAgeYears: number | null;
  locale: "th" | "en";
};

export type MedicationSuggestion = {
  drugName: string;
  strength: string;
  dosageInstruction: string;
  rationale: string;
  warnings: string[];
};

export type MedicationSuggestionResult = {
  suggestions: MedicationSuggestion[];
  /** fixed, non-model-authored — always shown with every suggestion set */
  disclaimer: string;
};

export interface PharmacyIntakeAI {
  extractStructuredData(input: IntakeAIInput): Promise<IntakeExtraction | null>;
  selectNextQuestion(input: NextQuestionInput): Promise<NextQuestionResult | null>;
  summarizeAssessment(input: SummaryInput): Promise<AssessmentSummary | null>;
  /** Pharmacist-only, staff-initiated. See the file header for the full risk boundary. */
  suggestMedications(input: MedicationSuggestionInput): Promise<MedicationSuggestionResult | null>;
}

// ---------------------------------------------------------------
// Validation (hand-rolled — no schema library, matching tools/types.ts)
// ---------------------------------------------------------------
export class AiOutputValidationError extends Error {}

const AI_CAVEAT_TEXT =
  "สรุปนี้สร้างโดย AI จากข้อมูลที่ลูกค้าให้ไว้ ไม่ใช่การวินิจฉัยหรือคำแนะนำยา เภสัชกรต้องตรวจสอบและตัดสินใจเองทั้งหมด";

// Heuristic denylist so an AI "summary" can never leak a drug recommendation
// — dosage-shaped tokens (mg/mcg/ml/tablet counts) or common Thai OTC drug
// names. A match is treated as a validation failure, retried with a
// stricter reminder, never silently passed through.
const DOSAGE_PATTERN = /\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|tablet|tab|เม็ด|มก\.?|มล\.?)\b/i;
const DRUG_NAME_DENYLIST = [
  "paracetamol",
  "ibuprofen",
  "amoxicillin",
  "cetirizine",
  "loratadine",
  "domperidone",
  "พาราเซตามอล",
  "ไอบูโพรเฟน",
  "อะม็อกซี",
  "ยาแก้",
  "ควรกิน",
  "ควรทาน",
  "แนะนำให้ใช้ยา",
];

function containsDrugRecommendation(text: string): boolean {
  const lower = text.toLowerCase();
  if (DOSAGE_PATTERN.test(lower)) return true;
  return DRUG_NAME_DENYLIST.some((term) => lower.includes(term.toLowerCase()));
}

function validateIntakeExtraction(raw: unknown, knownFieldKeys: string[]): IntakeExtraction {
  if (!raw || typeof raw !== "object") throw new AiOutputValidationError("extraction: not an object");
  const obj = raw as Record<string, unknown>;
  const extractedFieldsRaw = obj.extractedFields;
  if (extractedFieldsRaw != null && (typeof extractedFieldsRaw !== "object" || Array.isArray(extractedFieldsRaw))) {
    throw new AiOutputValidationError("extraction: extractedFields must be an object");
  }
  const extractedFields: Record<string, string | number | null> = {};
  const fieldConfidence: Record<string, "high" | "medium" | "low"> = {};
  const allowed = new Set(knownFieldKeys);
  for (const [key, value] of Object.entries((extractedFieldsRaw as Record<string, unknown>) ?? {})) {
    if (!allowed.has(key)) continue; // AI may only fill fields the protocol actually defines
    if (value === null || typeof value === "string" || typeof value === "number") {
      extractedFields[key] = value;
    }
  }
  const confidenceRaw = obj.fieldConfidence;
  if (confidenceRaw && typeof confidenceRaw === "object") {
    for (const [key, value] of Object.entries(confidenceRaw as Record<string, unknown>)) {
      if (allowed.has(key) && (value === "high" || value === "medium" || value === "low")) {
        fieldConfidence[key] = value;
      }
    }
  }
  return {
    extractedFields,
    fieldConfidence,
    unmappedText: typeof obj.unmappedText === "string" ? obj.unmappedText : null,
    extractionFailed: obj.extractionFailed === true,
  };
}

const INPUT_HINTS = ["free_text", "yes_no", "choice", "number", "duration"] as const;

function validateNextQuestionResult(raw: unknown, allowedQuestionKeys: Set<string>): NextQuestionResult {
  if (!raw || typeof raw !== "object") throw new AiOutputValidationError("next_question: not an object");
  const obj = raw as Record<string, unknown>;
  const questionKey = obj.questionKey;
  if (typeof questionKey !== "string" || !allowedQuestionKeys.has(questionKey)) {
    throw new AiOutputValidationError(`next_question: questionKey "${String(questionKey)}" not in protocol registry`);
  }
  const questionText = obj.questionText;
  if (typeof questionText !== "string" || !questionText.trim()) {
    throw new AiOutputValidationError("next_question: questionText missing");
  }
  const inputHint = obj.inputHint;
  if (typeof inputHint !== "string" || !(INPUT_HINTS as readonly string[]).includes(inputHint)) {
    throw new AiOutputValidationError("next_question: bad inputHint");
  }
  const choices = Array.isArray(obj.choices) ? obj.choices.filter((c) => typeof c === "string") : undefined;
  return { questionKey, questionText: questionText.trim(), inputHint: inputHint as NextQuestionResult["inputHint"], choices };
}

function validateAssessmentSummary(raw: unknown): AssessmentSummary {
  if (!raw || typeof raw !== "object") throw new AiOutputValidationError("summary: not an object");
  const obj = raw as Record<string, unknown>;
  const summaryText = obj.summaryText;
  if (typeof summaryText !== "string" || !summaryText.trim()) {
    throw new AiOutputValidationError("summary: summaryText missing");
  }
  if (containsDrugRecommendation(summaryText)) {
    throw new AiOutputValidationError("summary: looks like it contains a drug/dosage recommendation — not allowed");
  }
  const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    summaryText: summaryText.trim(),
    keySymptoms: asStringArray(obj.keySymptoms),
    allergiesNoted: asStringArray(obj.allergiesNoted),
    currentMedsNoted: asStringArray(obj.currentMedsNoted),
    timelineNote: typeof obj.timelineNote === "string" ? obj.timelineNote : null,
    aiCaveat: AI_CAVEAT_TEXT,
  };
}

const MEDICATION_DISCLAIMER_TEXT =
  "คำแนะนำนี้เป็นข้อเสนอจาก AI สำหรับเภสัชกรพิจารณาเท่านั้น ยังไม่ผ่านการตรวจสอบทางคลินิก — เภสัชกรต้องตรวจสอบประวัติแพ้ยา/ยาที่ใช้อยู่/" +
  "ข้อห้ามใช้ด้วยตนเองทุกครั้งก่อนใช้เป็นคำแนะนำจริง ห้ามส่งข้อความนี้ต่อให้ลูกค้าโดยตรงโดยไม่ตรวจสอบ";

function validateMedicationSuggestion(raw: unknown): MedicationSuggestion {
  if (!raw || typeof raw !== "object") throw new AiOutputValidationError("medication: suggestion is not an object");
  const obj = raw as Record<string, unknown>;
  const drugName = obj.drugName;
  if (typeof drugName !== "string" || !drugName.trim()) throw new AiOutputValidationError("medication: drugName missing");
  const strength = typeof obj.strength === "string" ? obj.strength.trim() : "";
  const dosageInstruction = obj.dosageInstruction;
  if (typeof dosageInstruction !== "string" || !dosageInstruction.trim()) {
    throw new AiOutputValidationError("medication: dosageInstruction missing");
  }
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  const warnings = Array.isArray(obj.warnings) ? obj.warnings.filter((w) => typeof w === "string") : [];
  return { drugName: drugName.trim(), strength, dosageInstruction: dosageInstruction.trim(), rationale, warnings };
}

function validateMedicationSuggestionResult(raw: unknown): MedicationSuggestionResult {
  if (!raw || typeof raw !== "object") throw new AiOutputValidationError("medication: not an object");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.suggestions) || obj.suggestions.length === 0) {
    throw new AiOutputValidationError("medication: suggestions must be a non-empty array");
  }
  return {
    suggestions: obj.suggestions.map(validateMedicationSuggestion),
    disclaimer: MEDICATION_DISCLAIMER_TEXT,
  };
}

/**
 * Deterministic defense-in-depth, NOT a substitute for the pharmacist's own
 * check — runs after AI validation, before the pharmacist ever sees the
 * list. Anything textually matching the patient's own reported allergy
 * string is dropped rather than trusting the model's own judgement alone
 * (the model already saw the allergy text in its prompt, but a second,
 * independent, non-AI check is cheap and catches a model that ignores its
 * own context). Excluded items are kept (not silently discarded) so the
 * pharmacist can see AI proposed something that got filtered and why.
 */
export function filterMedicationSuggestionsAgainstAllergies(
  result: MedicationSuggestionResult,
  allergiesText: string
): { kept: MedicationSuggestion[]; excluded: Array<{ suggestion: MedicationSuggestion; reason: string }> } {
  const allergyTokens = allergiesText
    .toLowerCase()
    .split(/[,\/;、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3); // avoid matching on trivially short tokens
  const kept: MedicationSuggestion[] = [];
  const excluded: Array<{ suggestion: MedicationSuggestion; reason: string }> = [];
  for (const suggestion of result.suggestions) {
    const nameLower = suggestion.drugName.toLowerCase();
    const hit = allergyTokens.find((token) => nameLower.includes(token) || token.includes(nameLower));
    if (hit) {
      excluded.push({ suggestion, reason: `ตรงกับประวัติแพ้ยาที่แจ้งไว้ ("${hit}")` });
    } else {
      kept.push(suggestion);
    }
  }
  return { kept, excluded };
}

// ---------------------------------------------------------------
// Test seam — mirrors tools/runtime.ts's __toolLoopTest
// ---------------------------------------------------------------
export type PharmacyAiTestDeps = {
  callProvider?: typeof callAnthropicCompatibleMessages;
  resolveCredentials?: typeof resolvePharmacyAiCredentials;
  /** defaults to recordPharmacyEvent() — injectable so tests never touch Postgres */
  logValidationExhausted?: (input: { tenantId: string; caseId: string; step: string; error: unknown }) => Promise<void>;
};

async function defaultLogValidationExhausted(input: { tenantId: string; caseId: string; step: string; error: unknown }): Promise<void> {
  await recordPharmacyEvent({
    tenantId: input.tenantId,
    assessmentId: input.caseId,
    actor: "system:pharmacy-ai",
    action: "ai.validation_exhausted",
    meta: { step: input.step, error: input.error instanceof Error ? input.error.message : String(input.error) },
  });
}

async function callWithValidation<T>(
  tenantId: string,
  caseId: string,
  step: "extract" | "next_question" | "summarize" | "suggest_medications",
  system: string,
  userText: string,
  validate: (raw: unknown) => T,
  deps: PharmacyAiTestDeps,
  surface: "customer" | "staff" = "customer"
): Promise<T | null> {
  const resolveCredentials = deps.resolveCredentials ?? resolvePharmacyAiCredentials;
  const callProvider = deps.callProvider ?? callAnthropicCompatibleMessages;
  const logValidationExhausted = deps.logValidationExhausted ?? defaultLogValidationExhausted;

  const creds = await resolveCredentials(tenantId, { surface, feature: "pharmacy_intake", meta: { step, caseId } });
  if (!creds) return null;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_AI_VALIDATION_RETRIES; attempt++) {
    try {
      const resp = await callProvider(creds, {
        model: creds.model,
        // Medication drafts contain several dosage/warning fields and were
        // being truncated mid-JSON at the generic 512-token limit.
        max_tokens: step === "suggest_medications" ? 1400 : 512,
        system,
        messages: [{ role: "user", content: userText }],
      });
      if (!resp.ok) throw new Error(`${creds.provider} API ${resp.status}`);
      const json = (await resp.json()) as { content?: Array<{ text?: string }> };
      const responseText = (json.content ?? [])
        .map((block) => (typeof block?.text === "string" ? block.text : ""))
        .join("")
        .trim();
      if (!responseText) throw new AiOutputValidationError(`${step}: empty reply`);
      const parsed = JSON.parse(responseText.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
      return validate(parsed);
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  console.error(`[BMS] pharmacy AI ${step} validation exhausted for case ${caseId}:`, lastErr);
  await logValidationExhausted({ tenantId, caseId, step, error: lastErr });
  return null;
}

// ---------------------------------------------------------------
// Concrete implementation
// ---------------------------------------------------------------
export class AnthropicCompatiblePharmacyIntakeAI implements PharmacyIntakeAI {
  constructor(private readonly deps: PharmacyAiTestDeps = {}) {}

  async extractStructuredData(input: IntakeAIInput): Promise<IntakeExtraction | null> {
    const system =
      "You extract structured intake fields from a Thai pharmacy customer's message. " +
      "You NEVER diagnose, recommend medication, or judge severity — you only map the customer's own words to " +
      "the known field keys provided. Respond with ONLY a JSON object: " +
      '{"extractedFields": {"<fieldKey>": <string|number|null>, ...}, ' +
      '"fieldConfidence": {"<fieldKey>": "high"|"medium"|"low"}, "unmappedText": string|null, "extractionFailed": boolean}. ' +
      `Known field keys: ${input.knownFieldKeys.join(", ")}. ` +
      'If the customer did not give a usable answer, do not guess a value — omit the field or leave it null; never invent "no"/"none".';
    const userText = [
      `Symptom group: ${input.symptomGroup}`,
      `Currently asking: ${input.currentQuestionKey ?? "(opening question)"}`,
      `Prior answers: ${input.priorAnswers.map((a) => `${a.fieldKey}=${a.rawText}`).join("; ") || "(none)"}`,
      `Customer's latest message: "${input.latestCustomerMessage}"`,
    ].join("\n");
    return callWithValidation(
      input.tenantId,
      input.caseId,
      "extract",
      system,
      userText,
      (raw) => validateIntakeExtraction(raw, input.knownFieldKeys),
      this.deps
    );
  }

  async selectNextQuestion(input: NextQuestionInput): Promise<NextQuestionResult | null> {
    const candidates = [...input.requiredFields, ...input.conditionalQuestions.map((q) => ({ key: q.key, questionKey: q.questionKey }))];
    const byKey = new Map(input.requiredFields.map((f) => [f.key, f] as const));
    const allowedQuestionKeys = new Set(candidates.map((c) => c.questionKey));
    const missing = candidates.filter((c) => input.missingFieldKeys.includes(c.key));
    const system =
      "You choose which ONE already-defined intake question to ask a Thai pharmacy customer next. " +
      "You do not invent new questions or fields — pick the single best questionKey from the list given, " +
      "in a natural, empathetic Thai sentence (one question only, no medical advice). " +
      'Respond with ONLY a JSON object: {"questionKey": string, "questionText": string, "inputHint": ' +
      '"free_text"|"yes_no"|"choice"|"number"|"duration", "choices"?: string[]}.';
    const userText = [
      `Missing fields (pick one questionKey from these): ${missing
        .map((c) => `${c.key} -> ${c.questionKey}${byKey.get(c.key) ? ` (${byKey.get(c.key)!.label}, type=${byKey.get(c.key)!.type})` : ""}`)
        .join("; ")}`,
      `Known so far: ${JSON.stringify(input.knownFields)}`,
    ].join("\n");
    return callWithValidation(
      input.tenantId,
      input.caseId,
      "next_question",
      system,
      userText,
      (raw) => validateNextQuestionResult(raw, allowedQuestionKeys),
      this.deps
    );
  }

  async summarizeAssessment(input: SummaryInput): Promise<AssessmentSummary | null> {
    const system =
      "You write a short, factual, Thai-language handoff summary for a licensed pharmacist reviewing a " +
      "pharmacy intake case. You MUST NOT recommend, name, or dose any medication, and you MUST NOT diagnose " +
      "— only restate what the customer reported. " +
      'Respond with ONLY a JSON object: {"summaryText": string, "keySymptoms": string[], "allergiesNoted": ' +
      'string[], "currentMedsNoted": string[], "timelineNote": string|null}.';
    const userText = `Symptom group: ${input.symptomGroup}\nAll collected answers: ${JSON.stringify(input.allAnswers)}`;
    return callWithValidation(
      input.tenantId,
      input.caseId,
      "summarize",
      system,
      userText,
      (raw) => validateAssessmentSummary(raw),
      this.deps
    );
  }

  /**
   * Pharmacist-only, staff-initiated (never called from the customer
   * pipeline). Leads with allergy/current-medication/pregnancy context so
   * the model has every reason to self-exclude an unsafe option — the
   * deterministic allergy filter (filterMedicationSuggestionsAgainstAllergies)
   * is a second, independent check applied by the caller after this
   * returns, not a substitute for prompting the model with this context.
   */
  async suggestMedications(input: MedicationSuggestionInput): Promise<MedicationSuggestionResult | null> {
    const system =
      "You are assisting a LICENSED PHARMACIST (not the patient) who will independently review, edit, and " +
      "decide before anything reaches the customer. Suggest 1-3 over-the-counter medication options appropriate " +
      "for the reported symptom group, in Thai. You MUST take the reported allergies, current medications, " +
      "pregnancy/breastfeeding status, and age into account and exclude anything contraindicated — explain why " +
      "in `warnings` if a normally-common option is being excluded for this patient. Do not suggest controlled " +
      "or prescription-only drugs. " +
      'Respond with ONLY a JSON object: {"suggestions": [{"drugName": string, "strength": string, ' +
      '"dosageInstruction": string, "rationale": string, "warnings": string[]}]}.';
    const userText = [
      `Symptom group: ${input.symptomGroup}`,
      `Reported allergies: ${input.allergiesText || "UNKNOWN"}`,
      `Current medications: ${input.currentMedicationsText || "UNKNOWN"}`,
      `Pregnancy status: ${input.pregnancyStatus} · Breastfeeding: ${input.breastfeedingStatus} · Age: ${input.patientAgeYears ?? "UNKNOWN"}`,
      `All collected answers: ${JSON.stringify(input.allAnswers)}`,
    ].join("\n");
    return callWithValidation(
      input.tenantId,
      input.caseId,
      "suggest_medications",
      system,
      userText,
      (raw) => validateMedicationSuggestionResult(raw),
      this.deps,
      "staff"
    );
  }
}

export const __pharmacyAiTest = {
  callWithValidation,
  validateIntakeExtraction,
  validateNextQuestionResult,
  validateAssessmentSummary,
  validateMedicationSuggestionResult,
};
