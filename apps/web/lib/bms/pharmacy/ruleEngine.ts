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
  field: string;
  label: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY";
  equals?: string;
  greaterThan?: number;
  lessThan?: number;
};

export type ProtocolCompletionRules = {
  requireAllOf: string[];
};

export type ProtocolEscalationRules = {
  onRedFlag?: string;
  onUnresolvedConflict?: string;
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
};

export type EvaluateAnswerResult =
  | { decision: "RED_FLAG"; flag: RedFlagMatch }
  | { decision: "MISSING_FIELDS"; missingFieldKeys: string[] }
  | { decision: "CONFLICT"; conflictingFieldKeys: string[] }
  | { decision: "COMPLETE" };

function ruleMatches(knownFields: KnownFields, rule: ProtocolRedFlagRule): boolean {
  const value = knownFields[rule.field];
  if (value === null || value === undefined) return false;
  if (rule.equals !== undefined) return String(value) === rule.equals;
  if (rule.greaterThan !== undefined) return typeof value === "number" && value > rule.greaterThan;
  if (rule.lessThan !== undefined) return typeof value === "number" && value < rule.lessThan;
  return false;
}

/** Walks red_flag_rules in order — first match wins (rules should be ordered by severity by convention). */
export function detectRedFlags(protocol: ProtocolDefinition, knownFields: KnownFields): RedFlagMatch[] {
  const matches: RedFlagMatch[] = [];
  for (const rule of protocol.redFlagRules) {
    if (ruleMatches(knownFields, rule)) {
      matches.push({ code: rule.code, label: rule.label, severity: rule.severity });
    }
  }
  return matches;
}

/** Required fields that unlock conditionally are only "required" once their unlock condition is met. */
export function activeRequiredFieldKeys(protocol: ProtocolDefinition, knownFields: KnownFields): string[] {
  const base = protocol.completionRules.requireAllOf ?? [];
  const conditional = protocol.conditionalQuestions
    .filter((q) => {
      const trigger = knownFields[q.unlockWhen.field];
      return trigger !== undefined && trigger !== null && String(trigger) === q.unlockWhen.equals;
    })
    .map((q) => q.key);
  return [...new Set([...base, ...conditional])];
}

/** A key is "missing" only if it was never asked at all — never if the answer is "UNKNOWN". */
export function computeMissingFields(protocol: ProtocolDefinition, knownFields: KnownFields): string[] {
  return activeRequiredFieldKeys(protocol, knownFields).filter(
    (key) => knownFields[key] === undefined || knownFields[key] === null
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
  return conflicts;
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
    const worst = [...redFlags].sort((a, b) => order[b.severity] - order[a.severity])[0];
    return { decision: "RED_FLAG", flag: worst };
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
