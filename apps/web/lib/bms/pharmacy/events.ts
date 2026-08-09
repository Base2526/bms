// =============================================================
// BMS Pharmacy Intake — event log (audit + clinical event trail)
// -------------------------------------------------------------
// recordPharmacyEvent() is the ONLY place allowed to write either the
// shared bms_audit_log (actor/action/target, same convention as
// inbox.assign/ai.tool_call/followup.sent) or the pharmacy-specific
// bms_pharmacy_assessment_events (previous_state/next_state, queryable
// per-case timeline). Both are always written together.
//
// minimizeForAudit() is the single choke point allowed to build `meta` for
// either log — resolvers/services must call it instead of hand-building a
// meta object, so nobody can accidentally dump raw_messages/
// structured_answers/medical_info/complaint/ai_summary (or model
// reasoning, which has nowhere to be stored in the first place — see
// db/migrations/7.59) into a log.
// =============================================================

import { query } from "@/lib/db";
import { audit } from "../audit";
import type { AssessmentStatus } from "./stateMachine";

/** Fixed vocabulary — keep in sync with the events this module actually emits. */
export type PharmacyEventAction =
  | "consent.granted"
  | "consent.revoked"
  | "assessment.created"
  | "assessment.answer_added"
  | "assessment.answer_changed"
  | "assessment.manual_answer_recorded"
  | "assessment.patient_memory_reused"
  | "assessment.red_flag_detected"
  | "assessment.risk_level_changed"
  | "assessment.pharmacist_assigned"
  | "assessment.submitted_for_review"
  | "assessment.submitted_for_manual_intake"
  | "assessment.more_information_requested"
  | "assessment.customer_requested_pharmacist"
  | "assessment.conversation_interrupted"
  | "assessment.confirmation_requested"
  | "assessment.confirmed_by_customer"
  | "assessment.reopened_for_customer_correction"
  | "assessment.summary_generated"
  | "assessment.summary_regenerated"
  | "assessment.summary_edited"
  | "assessment.pharmacist_summary_edited"
  | "assessment.approved"
  | "assessment.rejected"
  | "assessment.referred_to_doctor"
  | "assessment.emergency_referral"
  | "assessment.protocol_urgent_medical_review"
  | "assessment.protocol_pharmacist_review"
  | "assessment.closed"
  | "assessment.reopened_after_expiry"
  | "assessment.expired"
  | "assessment.manual_fields_filled"
  | "assessment.medication_suggested"
  | "assessment.checkout_order_created"
  | "assessment.product_review_requested"
  | "assessment.soft_deleted"
  | "message.sent_to_customer"
  | "ai.fallback"
  | "ai.validation_retry"
  | "ai.validation_exhausted";

export type MinimizedMeta = Record<string, string | number | boolean | null>;

/**
 * Whitelists what may appear in a pharmacy audit/event meta object: status
 * transitions, risk level, red-flag rule *names* (not raw answer values),
 * protocol id/version, missing-field *names* (not values), retry counts,
 * etc. Never accepts raw_messages/structured_answers/medical_info/
 * complaint/ai_summary — those keys are explicitly stripped if present.
 */
const DENYLIST_KEYS = new Set([
  "raw_messages",
  "rawMessages",
  "structured_answers",
  "structuredAnswers",
  "medical_info",
  "medicalInfo",
  "complaint",
  "ai_summary",
  "aiSummary",
  "pharmacist_decision_notes",
  "pharmacistDecisionNotes",
  "medication_suggestions",
  "medicationSuggestions",
]);

export function minimizeForAudit(input: Record<string, unknown>): MinimizedMeta {
  const out: MinimizedMeta = {};
  for (const [key, value] of Object.entries(input)) {
    if (DENYLIST_KEYS.has(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      // arrays of primitives only (e.g. missing-field names) — anything else is dropped, not stringified
      const allPrimitive = value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
      if (allPrimitive) out[key] = value.join(", ");
    }
  }
  return out;
}

export type RecordPharmacyEventInput = {
  tenantId: string;
  assessmentId: string;
  actor: string;
  action: PharmacyEventAction;
  previousState?: AssessmentStatus | null;
  nextState?: AssessmentStatus | null;
  meta?: Record<string, unknown>;
  /** GraphQL ctx, if this event was raised inside a resolver — used to also write bms_audit_log. */
  ctx?: any;
};

/** Never throws — logging must not break the mutation that triggered it. */
export async function recordPharmacyEvent(input: RecordPharmacyEventInput): Promise<void> {
  const meta = minimizeForAudit(input.meta ?? {});
  try {
    await query(
      `INSERT INTO bms_pharmacy_assessment_events
         (tenant_id, assessment_id, actor, action, previous_state, next_state, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.tenantId,
        input.assessmentId,
        input.actor,
        input.action,
        input.previousState ?? null,
        input.nextState ?? null,
        JSON.stringify(meta),
      ]
    );
  } catch (err) {
    console.error("[BMS] pharmacy event log failed:", err);
  }

  if (input.ctx) {
    await audit(input.ctx, `pharmacy.${input.action}`, input.assessmentId, meta);
  }
}
