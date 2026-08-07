// =============================================================
// BMS Pharmacy Intake — state machine
// -------------------------------------------------------------
// No generic FSM engine exists in this codebase (lib/bms/orders.ts and
// lib/bms/payments.ts both hand-roll a guarded `UPDATE ... WHERE status =
// ANY($from)` per transition) — this file follows the same convention: a
// documentation/validation matrix here, real writes happen in
// assessments.ts's per-transition functions.
// =============================================================

export const ASSESSMENT_STATUSES = [
  "DRAFT",
  "COLLECTING_INFORMATION",
  "WAITING_FOR_PHARMACIST",
  "PHARMACIST_REVIEWING",
  "NEED_MORE_INFORMATION",
  "APPROVED",
  "REJECTED",
  "REFER_TO_DOCTOR",
  "EMERGENCY_REFERRAL",
  "CLOSED",
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export function isAssessmentStatus(value: unknown): value is AssessmentStatus {
  return typeof value === "string" && (ASSESSMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Documentation/validation matrix only. The real guard for each transition
 * lives in the corresponding function in assessments.ts, which additionally
 * enforces actor-type guards this matrix cannot express (e.g. "the
 * deterministic rule engine may drive this transition" vs "only a licensed
 * pharmacist may").
 *
 * - DRAFT → COLLECTING_INFORMATION → WAITING_FOR_PHARMACIST is the
 *   rule-engine-driven intake path.
 * - WAITING_FOR_PHARMACIST → PHARMACIST_REVIEWING requires an explicit
 *   claim/assign — separate from the actual decision.
 * - Only PHARMACIST_REVIEWING can reach APPROVED/REJECTED/REFER_TO_DOCTOR —
 *   a case can never be one-hop approved straight out of intake.
 * - EMERGENCY_REFERRAL is reachable from every open state because a red
 *   flag can be detected at any point and must short-circuit immediately.
 * - Terminal states only transition to CLOSED (archival close, e.g. by the
 *   TTL sweep or an explicit close action).
 */
export const ALLOWED_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  DRAFT: ["COLLECTING_INFORMATION", "CLOSED"],
  COLLECTING_INFORMATION: ["WAITING_FOR_PHARMACIST", "EMERGENCY_REFERRAL", "CLOSED"],
  WAITING_FOR_PHARMACIST: ["PHARMACIST_REVIEWING", "EMERGENCY_REFERRAL", "CLOSED"],
  PHARMACIST_REVIEWING: [
    "NEED_MORE_INFORMATION",
    "APPROVED",
    "REJECTED",
    "REFER_TO_DOCTOR",
    "EMERGENCY_REFERRAL",
  ],
  NEED_MORE_INFORMATION: ["COLLECTING_INFORMATION", "WAITING_FOR_PHARMACIST", "EMERGENCY_REFERRAL", "CLOSED"],
  APPROVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  REFER_TO_DOCTOR: ["CLOSED"],
  EMERGENCY_REFERRAL: ["CLOSED"],
  CLOSED: [],
};

/** Statuses that no longer accept new customer answers/pharmacist decisions. */
export const TERMINAL_STATUSES: readonly AssessmentStatus[] = [
  "APPROVED",
  "REJECTED",
  "REFER_TO_DOCTOR",
  "EMERGENCY_REFERRAL",
  "CLOSED",
];

export function isTerminalStatus(status: AssessmentStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransition(from: AssessmentStatus, to: AssessmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
