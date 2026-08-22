// =============================================================
// BMS Pharmacy Intake — deterministic rule engine
// -------------------------------------------------------------
// Pure functions, ZERO AI/network calls. This is the single place that
// decides missing fields, red flags, and "is intake complete" — never the
// LLM. lib/bms/pharmacy/intake.ts calls into this and only this to decide
// what happens next; it never makes that judgment call itself.
//
// Protocol rule shapes are versioned JSON (db/migrations/7.58) so a
// pharmacist can review/tune them without a deploy — this file only knows
// how to walk the shapes, it never hardcodes a specific protocol's rules.
// =============================================================

export type FieldInputType = "free_text" | "yes_no" | "number" | "choice" | "duration";

export type ProtocolFieldDef = {
  key: string;
  label: string;
  type: FieldInputType;
  questionKey: string;
};

export type ProtocolConditionalQuestion = {
  key: string;
  questionKey: string;
  unlockWhen: { field: string; equals: string };
  /** optional — used for the deterministic no-AI fallback question text */
  label?: string;
  type?: FieldInputType;
};

export type ProtocolRedFlagRule = {
  code: string;
  field?: string;
  label: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY";
  equals?: string;
  greaterThan?: number;
  lessThan?: number;
  condition?: ProtocolCondition;
};

export type ProtocolCondition =
  | { field: string; equals?: string | number | boolean; notEquals?: string | number | boolean; greaterThan?: number; greaterThanOrEqual?: number; lessThan?: number; lessThanOrEqual?: number; in?: Array<string | number | boolean>; exists?: boolean }
  | { allOf: ProtocolCondition[] }
  | { anyOf: ProtocolCondition[] }
  | { not: ProtocolCondition };

export type ProtocolEscalationAction = "CONTINUE" | "PHARMACIST_REVIEW" | "URGENT_MEDICAL_REVIEW" | "EMERGENCY_REFERRAL";

export type ProtocolCompletionRules = {
  requireAllOf: string[];
};

export type ProtocolEscalationRules = {
  onRedFlag?: string;
  onUnresolvedConflict?: string;
  bySeverity?: Partial<Record<ProtocolRedFlagRule["severity"], ProtocolEscalationAction>>;
};

export type ProtocolDefinition = {
  id: string;
  protocolKey: string;
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  redFlagRules: ProtocolRedFlagRule[];
  completionRules: ProtocolCompletionRules;
  escalationRules: ProtocolEscalationRules;
};

/**
 * `null`/`undefined` = the field was never asked. `"UNKNOWN"` = asked but the
 * customer didn't give a usable answer. These are NOT the same thing —
 * `computeMissingFields()` treats only the former as missing; a field the
 * customer answered "UNKNOWN" to counts as answered (present) and is
 * surfaced to the pharmacist as-is, never silently turned into "NO".
 */
export type KnownFields = Record<string, string | number | boolean | null | undefined>;

export type RedFlagMatch = {
  code: string;
  label: string;
  severity: ProtocolRedFlagRule["severity"];
  action: ProtocolEscalationAction;
};

export type IntakeAnomaly = {
  code: string;
  fieldKey: string;
  label: string;
};

export type CompletenessStatus = "UNKNOWN" | "INCOMPLETE" | "CONFLICT" | "COMPLETE";

export type EvaluateAnswerResult =
  | { decision: "RED_FLAG"; flag: RedFlagMatch }
  | { decision: "ANOMALY"; anomalies: IntakeAnomaly[]; missingFieldKeys: string[] }
  | { decision: "MISSING_FIELDS"; missingFieldKeys: string[] }
  | { decision: "CONFLICT"; conflictingFieldKeys: string[] }
  | { decision: "COMPLETE" };

export const GLOBAL_REQUIRED_FIELDS: ProtocolFieldDef[] = [
  { key: "patient_relationship", label: "ผู้มีอาการเป็นตัวคุณเอง ลูก พ่อแม่ หรือบุคคลอื่น", type: "choice", questionKey: "q_global_patient_relationship" },
  { key: "patient_age_years", label: "อายุของผู้ที่มีอาการ", type: "number", questionKey: "q_global_patient_age_years" },
  { key: "biological_sex", label: "เพศกำเนิดของผู้ที่มีอาการ", type: "choice", questionKey: "q_global_biological_sex" },
  { key: "allergies", label: "ประวัติแพ้ยา", type: "free_text", questionKey: "q_global_allergies" },
  { key: "current_medications", label: "ยาหรืออาหารเสริมที่ใช้อยู่ปัจจุบัน", type: "free_text", questionKey: "q_global_current_medications" },
];

export const GLOBAL_CONDITIONAL_QUESTIONS: ProtocolConditionalQuestion[] = [
  {
    key: "pregnancy_status",
    questionKey: "q_global_pregnancy_status",
    unlockWhen: { field: "biological_sex", equals: "FEMALE" },
    label: "ขณะนี้ตั้งครรภ์หรือมีโอกาสตั้งครรภ์ไหมคะ",
    type: "yes_no",
  },
  {
    key: "breastfeeding_status",
    questionKey: "q_global_breastfeeding_status",
    unlockWhen: { field: "biological_sex", equals: "FEMALE" },
    label: "ขณะนี้ให้นมบุตรอยู่ไหมคะ",
    type: "yes_no",
  },
];

function uniqKeys(items: string[]): string[] {
  return [...new Set(items)];
}

export function listAllQuestionFields(protocol: ProtocolDefinition): ProtocolFieldDef[] {
  return [
    ...GLOBAL_REQUIRED_FIELDS,
    ...protocol.requiredFields,
    ...GLOBAL_CONDITIONAL_QUESTIONS.map((q) => ({
      key: q.key,
      label: q.label ?? q.key,
      type: q.type ?? "free_text",
      questionKey: q.questionKey,
    })),
    ...protocol.conditionalQuestions.map((q) => ({
      key: q.key,
      label: q.label ?? q.key,
      type: q.type ?? "free_text",
      questionKey: q.questionKey,
    })),
  ].filter((field, index, arr) => arr.findIndex((candidate) => candidate.key === field.key) === index);
}

export function getQuestionFieldDef(protocol: ProtocolDefinition, key: string): ProtocolFieldDef | null {
  return listAllQuestionFields(protocol).find((field) => field.key === key) ?? null;
}

function conditionMatches(knownFields: KnownFields, condition: ProtocolCondition): boolean {
  if ("allOf" in condition) return condition.allOf.length > 0 && condition.allOf.every((item) => conditionMatches(knownFields, item));
  if ("anyOf" in condition) return condition.anyOf.length > 0 && condition.anyOf.some((item) => conditionMatches(knownFields, item));
  if ("not" in condition) return !conditionMatches(knownFields, condition.not);
  const value = knownFields[condition.field];
  if (condition.exists !== undefined) return condition.exists ? value !== null && value !== undefined && value !== "" : value === null || value === undefined || value === "";
  if (value === null || value === undefined) return false;
  if (condition.equals !== undefined) return String(value) === String(condition.equals);
  if (condition.notEquals !== undefined) return String(value) !== String(condition.notEquals);
  if (condition.in !== undefined) return condition.in.some((item) => String(item) === String(value));
  if (condition.greaterThan !== undefined) return typeof value === "number" && value > condition.greaterThan;
  if (condition.greaterThanOrEqual !== undefined) return typeof value === "number" && value >= condition.greaterThanOrEqual;
  if (condition.lessThan !== undefined) return typeof value === "number" && value < condition.lessThan;
  if (condition.lessThanOrEqual !== undefined) return typeof value === "number" && value <= condition.lessThanOrEqual;
  return false;
}

function ruleMatches(knownFields: KnownFields, rule: ProtocolRedFlagRule): boolean {
  if (rule.condition) return conditionMatches(knownFields, rule.condition);
  if (!rule.field) return false;
  const value = knownFields[rule.field];
  if (value === null || value === undefined) return false;
  if (rule.equals !== undefined) return String(value) === rule.equals;
  if (rule.greaterThan !== undefined) return typeof value === "number" && value > rule.greaterThan;
  if (rule.lessThan !== undefined) return typeof value === "number" && value < rule.lessThan;
  return false;
}

const DEFAULT_ACTION_BY_SEVERITY: Record<ProtocolRedFlagRule["severity"], ProtocolEscalationAction> = {
  EMERGENCY: "EMERGENCY_REFERRAL",
  HIGH: "URGENT_MEDICAL_REVIEW",
  MODERATE: "PHARMACIST_REVIEW",
  LOW: "CONTINUE",
};

export function resolveEscalationAction(protocol: ProtocolDefinition, severity: ProtocolRedFlagRule["severity"]): ProtocolEscalationAction {
  const configured = protocol.escalationRules?.bySeverity?.[severity];
  if (configured) return configured;
  if (protocol.escalationRules?.onRedFlag === "EMERGENCY_REFERRAL") return "EMERGENCY_REFERRAL";
  return DEFAULT_ACTION_BY_SEVERITY[severity];
}

/** Walks red_flag_rules in order — first match wins (rules should be ordered by severity by convention). */
export function detectRedFlags(protocol: ProtocolDefinition, knownFields: KnownFields): RedFlagMatch[] {
  const matches: RedFlagMatch[] = [];
  for (const rule of protocol.redFlagRules) {
    if (ruleMatches(knownFields, rule)) {
      matches.push({ code: rule.code, label: rule.label, severity: rule.severity, action: resolveEscalationAction(protocol, rule.severity) });
    }
  }
  return matches;
}

/** Required fields that unlock conditionally are only "required" once their unlock condition is met. */
export function activeRequiredFieldKeys(protocol: ProtocolDefinition, knownFields: KnownFields): string[] {
  const base = uniqKeys([...(protocol.completionRules.requireAllOf ?? []), ...GLOBAL_REQUIRED_FIELDS.map((field) => field.key)]);
  const conditional = [...GLOBAL_CONDITIONAL_QUESTIONS, ...protocol.conditionalQuestions]
    .filter((q) => {
      const trigger = knownFields[q.unlockWhen.field];
      return trigger !== undefined && trigger !== null && String(trigger) === q.unlockWhen.equals;
    })
    .map((q) => q.key);
  return uniqKeys([...base, ...conditional]);
}

/** A key is "missing" only if it was never asked at all — never if the answer is "UNKNOWN". */
export function computeMissingFields(protocol: ProtocolDefinition, knownFields: KnownFields): string[] {
  return activeRequiredFieldKeys(protocol, knownFields).filter(
    (key) => knownFields[key] === undefined || knownFields[key] === null || (typeof knownFields[key] === "string" && !String(knownFields[key]).trim())
  );
}

/**
 * MVP conflict detection: a small built-in set of cross-field contradictions
 * that are unambiguous regardless of protocol (a male patient can't be
 * pregnant). This is deliberately not data-driven yet — extend with a
 * protocol-level `conflictRules` JSON column if/when more conflict types are
 * needed; the shape here is a starting point, not the final design.
 */
export function detectConflicts(knownFields: KnownFields): string[] {
  const conflicts: string[] = [];
  if (
    knownFields.biological_sex === "MALE" &&
    (knownFields.pregnancy_status === "YES" || knownFields.breastfeeding_status === "YES")
  ) {
    conflicts.push("pregnancy_status", "biological_sex");
  }
  if (
    knownFields.has_fever === "NO" &&
    typeof knownFields.fever_temp === "number" &&
    knownFields.fever_temp >= 37.5
  ) {
    conflicts.push("has_fever", "fever_temp");
  }
  return conflicts;
}

export function detectAnomalies(knownFields: KnownFields): IntakeAnomaly[] {
  const anomalies: IntakeAnomaly[] = [];
  const add = (code: string, fieldKey: string, label: string) => {
    anomalies.push({ code, fieldKey, label });
  };

  if (typeof knownFields.patient_age_years === "number") {
    if (knownFields.patient_age_years < 0) add("AGE_NEGATIVE", "patient_age_years", "อายุไม่ควรติดลบ");
    if (knownFields.patient_age_years > 120) add("AGE_IMPLAUSIBLE", "patient_age_years", "อายุดูสูงผิดปกติ รบกวนยืนยันอีกครั้ง");
  }
  if (typeof knownFields.fever_temp === "number") {
    if (knownFields.fever_temp < 34) add("FEVER_TEMP_TOO_LOW", "fever_temp", "อุณหภูมิต่ำผิดปกติ รบกวนยืนยันอีกครั้ง");
    if (knownFields.fever_temp > 43) add("FEVER_TEMP_TOO_HIGH", "fever_temp", "อุณหภูมิสูงผิดปกติมาก รบกวนยืนยันอีกครั้ง");
  }
  if (typeof knownFields.severity === "number" && (knownFields.severity < 1 || knownFields.severity > 10)) {
    add("SEVERITY_OUT_OF_RANGE", "severity", "คะแนนความรุนแรงควรอยู่ระหว่าง 1 ถึง 10");
  }
  for (const fieldKey of ["onset_days", "duration_days", "duration_hours", "frequency_per_day"] as const) {
    const value = knownFields[fieldKey];
    if (typeof value === "number" && value < 0) {
      add("NEGATIVE_DURATION", fieldKey, "ค่าระยะเวลา/ความถี่ไม่ควรติดลบ");
    }
  }
  return anomalies;
}

export function resolveCompletenessStatus(protocol: ProtocolDefinition, knownFields: KnownFields): CompletenessStatus {
  if (detectRedFlags(protocol, knownFields).some((flag) => flag.action !== "CONTINUE")) return "CONFLICT";
  if (detectAnomalies(knownFields).length > 0) return "INCOMPLETE";
  if (computeMissingFields(protocol, knownFields).length > 0) return "INCOMPLETE";
  if (detectConflicts(knownFields).length > 0) return "CONFLICT";
  return "COMPLETE";
}

/**
 * The single decision function lib/bms/pharmacy/intake.ts calls after every
 * customer answer. Order matters: red flags short-circuit everything else
 * (a case can be simultaneously "missing fields" and "has a red flag" — the
 * red flag always wins, per the "stop normal questions immediately" rule).
 */
export function evaluateAnswer(protocol: ProtocolDefinition, knownFields: KnownFields): EvaluateAnswerResult {
  const redFlags = detectRedFlags(protocol, knownFields);
  if (redFlags.length > 0) {
    // Most severe first: EMERGENCY > HIGH > MODERATE > LOW.
    const order = { EMERGENCY: 3, HIGH: 2, MODERATE: 1, LOW: 0 } as const;
    const actionOrder: Record<ProtocolEscalationAction, number> = { CONTINUE: 0, PHARMACIST_REVIEW: 1, URGENT_MEDICAL_REVIEW: 2, EMERGENCY_REFERRAL: 3 };
    const worst = [...redFlags].sort((a, b) => actionOrder[b.action] - actionOrder[a.action] || order[b.severity] - order[a.severity])[0];
    if (worst.action === "CONTINUE") {
      // LOW informational rules may match without interrupting intake.
    } else {
      return { decision: "RED_FLAG", flag: worst };
    }
  }

  const anomalies = detectAnomalies(knownFields);
  if (anomalies.length > 0) {
    return { decision: "ANOMALY", anomalies, missingFieldKeys: computeMissingFields(protocol, knownFields) };
  }

  const missingFieldKeys = computeMissingFields(protocol, knownFields);
  if (missingFieldKeys.length > 0) {
    return { decision: "MISSING_FIELDS", missingFieldKeys };
  }

  const conflictingFieldKeys = detectConflicts(knownFields);
  if (conflictingFieldKeys.length > 0) {
    return { decision: "CONFLICT", conflictingFieldKeys };
  }

  return { decision: "COMPLETE" };
}
