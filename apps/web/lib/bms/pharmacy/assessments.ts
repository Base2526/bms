// =============================================================
// BMS Pharmacy Intake — assessment CRUD + state machine writes
// -------------------------------------------------------------
// Mirrors lib/bms/orders.ts's guarded `UPDATE ... WHERE status = ANY($from)`
// transition style and lib/bms/payments.ts's `SELECT ... FOR UPDATE` +
// re-check-before-write concurrency pattern — no new patterns invented.
//
// ⚠️ Mechanical invariant (do not "helpfully" refactor away):
//   `approveAssessment()` is the ONLY function in this codebase that writes
//   status = 'APPROVED'. It checks `users.is_licensed_pharmacist`
//   UNCONDITIONALLY — no `role === 'Administrator'` shortcut — because
//   loadPermissions() in lib/bms/permissions.ts gives Administrator every
//   BMS_PERMISSIONS string automatically, and that bypass must never extend
//   to "is this person actually a licensed pharmacist," which is a fact
//   about the human, not a role/permission.
//
// No function here that is reachable from the AI/rule-engine layer
// (lib/bms/pharmacy/intake.ts) ever writes `status`. That layer only calls
// updateAnswers()/appendRawMessage()/recordAiSummary(), plus the
// rule-engine-driven transitions (markWaitingForPharmacist/
// escalateToEmergency) — never the pharmacist-decision transitions.
// =============================================================

import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { sendStaffMessage } from "../inbox";
import { getConversation, listMessages } from "../inbox";
import { recordPharmacyEvent } from "./events";
import {
  ALLOWED_TRANSITIONS,
  type AssessmentStatus,
} from "./stateMachine";
import { pharmacyAssessmentTtlMinutes } from "./config";

// ---------------------------------------------------------------
// Delivering a pharmacist's decision back to the customer's chat
// -------------------------------------------------------------
// "เมื่อเภสัชกรอนุมัติ จึงส่งคำแนะนำของเภสัชกรกลับไปให้ลูกค้า" — approve sends the
// pharmacist's own verbatim text (never AI-authored/paraphrased); reject/
// refer/emergency send a fixed, safe, non-clinical-detail notice (the
// pharmacist's internal reason is not customer-facing copy). Delivered via
// sendStaffMessage() so it's attributed `staff:<email>` in the transcript,
// exactly like an admin typing in Inbox — not `sender:'ai'`.
// ---------------------------------------------------------------
const REJECTED_CUSTOMER_MESSAGE =
  "ขออภัยค่ะ เภสัชกรพิจารณาแล้วว่ายังไม่สามารถให้คำแนะนำสำหรับอาการนี้ผ่านช่องทางแชทได้ กรุณาปรึกษาเภสัชกรที่หน้าร้านหรือแพทย์โดยตรงนะคะ";
const REFERRED_CUSTOMER_MESSAGE = "เภสัชกรแนะนำให้คุณไปพบแพทย์เพื่อตรวจเพิ่มเติมนะคะ";
const EMERGENCY_CUSTOMER_MESSAGE =
  "เภสัชกรพิจารณาว่าอาการนี้ควรได้รับการดูแลฉุกเฉินค่ะ กรุณาไปโรงพยาบาลหรือโทร 1669 ทันทีนะคะ";

async function notifyCustomerOfDecision(
  tenantId: string,
  assessmentId: string,
  text: string,
  via: "approved" | "rejected" | "referred_to_doctor" | "emergency_referral",
  staffActor: string | null = null
): Promise<void> {
  try {
    const row = await query<{ conversation_id: string | null }>(
      `SELECT conversation_id FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assessmentId]
    );
    const conversationId = row.rows[0]?.conversation_id;
    if (!conversationId) return; // no chat conversation to deliver into (e.g. a staff-created case)
    await sendStaffMessage(tenantId, conversationId, text, staffActor);
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: staffActor || "system:pharmacy-intake",
      action: "message.sent_to_customer",
      meta: { via },
    });
  } catch (err) {
    // Best-effort — a delivery failure must not undo the decision that was
    // already committed. It IS reported so ops can see it, same as every
    // other best-effort delivery in this codebase (e.g. deliverToChannel()).
    console.error("[BMS] pharmacy decision notify-customer failed:", err);
  }
}

export type PharmacyAssessmentRow = {
  id: string;
  tenantId: string;
  customerId: string | null;
  channelId: string | null;
  conversationId: string | null;
  protocolId: string | null;
  patientRelationship: string;
  consentStatus: string;
  consentAt: string | null;
  consentVersion: string | null;
  status: AssessmentStatus;
  needsManualIntake: boolean;
  riskLevel: string;
  assignedPharmacistId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionReason: string | null;
  patientDob: string | null;
  patientAgeYears: number | null;
  biologicalSex: string;
  weightKg: number | null;
  heightCm: number | null;
  pregnancyStatus: string;
  breastfeedingStatus: string;
  complaint: Record<string, unknown>;
  medicalInfo: Record<string, unknown>;
  currentQuestionKey: string | null;
  missingFields: string[];
  conflictingFields: string[];
  detectedRedFlags: unknown[];
  outOfScopeReason: string | null;
  escalationReason: string | null;
  rawMessages: unknown[];
  structuredAnswers: Record<string, unknown>;
  aiSummary: string | null;
  aiSummaryVersion: number;
  aiPromptVersion: string | null;
  aiModelVersion: string | null;
  pharmacistEdits: unknown[];
  pharmacistDecisionNotes: string | null;
  medicationSuggestions: unknown[];
  version: number;
  expiresAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PharmacyAssessmentConversationHistory = {
  conversationId: string;
  channel: string;
  customerName: string | null;
  customerRef: string | null;
  status: string;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    sender: string | null;
    createdAt: string;
    status: string | null;
  }>;
};

function mapRow(r: any): PharmacyAssessmentRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id ?? null,
    channelId: r.channel_id ?? null,
    conversationId: r.conversation_id ?? null,
    protocolId: r.protocol_id ?? null,
    patientRelationship: r.patient_relationship,
    consentStatus: r.consent_status,
    consentAt: r.consent_at ? new Date(r.consent_at).toISOString() : null,
    consentVersion: r.consent_version ?? null,
    status: r.status,
    needsManualIntake: r.needs_manual_intake,
    riskLevel: r.risk_level,
    assignedPharmacistId: r.assigned_pharmacist_id ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    decisionReason: r.decision_reason ?? null,
    patientDob: r.patient_dob ? new Date(r.patient_dob).toISOString().slice(0, 10) : null,
    patientAgeYears: r.patient_age_years ?? null,
    biologicalSex: r.biological_sex,
    weightKg: r.weight_kg != null ? Number(r.weight_kg) : null,
    heightCm: r.height_cm != null ? Number(r.height_cm) : null,
    pregnancyStatus: r.pregnancy_status,
    breastfeedingStatus: r.breastfeeding_status,
    complaint: r.complaint ?? {},
    medicalInfo: r.medical_info ?? {},
    currentQuestionKey: r.current_question_key ?? null,
    missingFields: r.missing_fields ?? [],
    conflictingFields: r.conflicting_fields ?? [],
    detectedRedFlags: r.detected_red_flags ?? [],
    outOfScopeReason: r.out_of_scope_reason ?? null,
    escalationReason: r.escalation_reason ?? null,
    rawMessages: r.raw_messages ?? [],
    structuredAnswers: r.structured_answers ?? {},
    aiSummary: r.ai_summary ?? null,
    aiSummaryVersion: r.ai_summary_version,
    aiPromptVersion: r.ai_prompt_version ?? null,
    aiModelVersion: r.ai_model_version ?? null,
    pharmacistEdits: r.pharmacist_edits ?? [],
    pharmacistDecisionNotes: r.pharmacist_decision_notes ?? null,
    medicationSuggestions: r.medication_suggestions ?? [],
    version: r.version,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function getAssessment(tenantId: string, id: string): Promise<PharmacyAssessmentRow | null> {
  const res = await query(
    `SELECT * FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, id]
  );
  return res.rowCount ? mapRow(res.rows[0]) : null;
}

export async function getAssessmentConversationHistory(
  tenantId: string,
  assessmentId: string,
  limit = 100
): Promise<PharmacyAssessmentConversationHistory | null> {
  const assessment = await getAssessment(tenantId, assessmentId);
  const conversationId = assessment?.conversationId;
  if (!conversationId) return null;

  const [conversation, messages] = await Promise.all([
    getConversation(tenantId, conversationId),
    listMessages(tenantId, conversationId, limit),
  ]);
  if (!conversation) return null;

  return {
    conversationId,
    channel: String(conversation.channel || ""),
    customerName: conversation.customer_name ?? null,
    customerRef: conversation.customer_ref ?? null,
    status: String(conversation.status || ""),
    messages: (messages || []).map((message: any) => ({
      id: String(message.id),
      direction: String(message.direction || ""),
      body: String(message.body || ""),
      sender: message.sender ?? null,
      createdAt: new Date(message.created_at).toISOString(),
      status: message.meta?.status ?? null,
    })),
  };
}

export async function listAssessments(
  tenantId: string,
  filters: {
    status?: string;
    riskLevel?: string;
    assignedPharmacistId?: string;
    channelId?: string;
    createdAfter?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<PharmacyAssessmentRow[]> {
  const conditions = ["tenant_id = $1", "deleted_at IS NULL"];
  const params: any[] = [tenantId];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.riskLevel) {
    params.push(filters.riskLevel);
    conditions.push(`risk_level = $${params.length}`);
  }
  if (filters.assignedPharmacistId) {
    params.push(filters.assignedPharmacistId);
    conditions.push(`assigned_pharmacist_id = $${params.length}`);
  }
  if (filters.channelId) {
    params.push(filters.channelId);
    conditions.push(`channel_id = $${params.length}`);
  }
  if (filters.createdAfter) {
    params.push(filters.createdAfter);
    conditions.push(`created_at >= $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  params.push(limit, offset);
  const res = await query(
    `SELECT * FROM bms_pharmacy_assessments
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE risk_level WHEN 'EMERGENCY' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MODERATE' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.rows.map(mapRow);
}

// ---------------------------------------------------------------
// Creation (idempotent per conversation, mirrors submitPaymentOnce())
// ---------------------------------------------------------------
export type CreateAssessmentInput = {
  tenantId: string;
  customerId?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  protocolId: string;
  patientRelationship?: "SELF" | "CHILD" | "PARENT" | "OTHER";
};

export type CreateAssessmentResult =
  | { status: "CREATED"; assessmentId: string }
  | { status: "ALREADY_EXISTS"; assessmentId: string; assessmentStatus: AssessmentStatus };

export async function createAssessmentOnce(input: CreateAssessmentInput): Promise<CreateAssessmentResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);

    if (input.conversationId) {
      // Lock the parent conversation row as the serialization point — same
      // idea as submitPaymentOnce() locking bms_orders before checking for
      // an existing active payment.
      await client.query(`SELECT id FROM bms_conversations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
        input.tenantId,
        input.conversationId,
      ]);
      const active = await client.query<{ id: string; status: AssessmentStatus }>(
        `SELECT id, status FROM bms_pharmacy_assessments
          WHERE tenant_id = $1 AND conversation_id = $2
            AND status NOT IN ('CLOSED', 'REJECTED') AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [input.tenantId, input.conversationId]
      );
      if (active.rows[0]) {
        await client.query("COMMIT");
        return { status: "ALREADY_EXISTS", assessmentId: active.rows[0].id, assessmentStatus: active.rows[0].status };
      }
    }

    const ttlMinutes = pharmacyAssessmentTtlMinutes();
    const ins = await client.query<{ id: string }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, customer_id, channel_id, conversation_id, protocol_id, patient_relationship,
          status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', now() + make_interval(mins => $7))
       RETURNING id`,
      [
        input.tenantId,
        input.customerId ?? null,
        input.channelId ?? null,
        input.conversationId ?? null,
        input.protocolId,
        input.patientRelationship ?? "SELF",
        ttlMinutes,
      ]
    );
    const assessmentId = ins.rows[0].id;

    if (input.conversationId) {
      await client.query(
        `UPDATE bms_conversations SET pharmacy_intake_case_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.conversationId, assessmentId]
      );
    }

    await client.query("COMMIT");
    await recordPharmacyEvent({
      tenantId: input.tenantId,
      assessmentId,
      actor: "system:pharmacy-intake",
      action: "assessment.created",
      previousState: null,
      nextState: "DRAFT",
      meta: { protocolId: input.protocolId, patientRelationship: input.patientRelationship ?? "SELF" },
    });
    return { status: "CREATED", assessmentId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// Consent
// ---------------------------------------------------------------
export async function recordConsent(
  tenantId: string,
  assessmentId: string,
  status: "GRANTED" | "REVOKED",
  consentVersion: string
): Promise<boolean> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const cur = await client.query<{ status: AssessmentStatus }>(
      `SELECT status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, assessmentId]
    );
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const previousState = cur.rows[0].status;
    // Consent granted while still DRAFT is what actually kicks off intake.
    const nextState: AssessmentStatus =
      status === "GRANTED" && previousState === "DRAFT" ? "COLLECTING_INFORMATION" : previousState;
    await client.query(
      `UPDATE bms_pharmacy_assessments
          SET consent_status = $3, consent_at = now(), consent_version = $4,
              status = $5, version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assessmentId, status, consentVersion, nextState]
    );
    await client.query("COMMIT");
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: "customer:pharmacy-intake",
      action: status === "GRANTED" ? "consent.granted" : "consent.revoked",
      previousState,
      nextState,
      meta: { consentVersion },
    });
    return true;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// Data-only updates (no `status` in the SET clause — reachable from the AI layer)
// ---------------------------------------------------------------
export type AnswerUpdate = {
  complaintPatch?: Record<string, unknown>;
  medicalInfoPatch?: Record<string, unknown>;
  structuredAnswersPatch?: Record<string, unknown>;
  missingFields?: string[];
  conflictingFields?: string[];
  detectedRedFlags?: unknown[];
  riskLevel?: string;
  currentQuestionKey?: string | null;
  patientAgeYears?: number | null;
  biologicalSex?: string;
  pregnancyStatus?: string;
  breastfeedingStatus?: string;
};

/**
 * Full-replace semantics for the JSONB columns (caller passes the complete
 * next object, e.g. the whole accumulated knownFields map — same
 * convention as inbox.ts's setAiConversationState(), not a partial diff).
 * Never touches `status`.
 */
export async function updateAnswers(tenantId: string, assessmentId: string, patch: AnswerUpdate): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const params: any[] = [tenantId, assessmentId];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} = $${params.length}`);
  };

  if (patch.complaintPatch) push("complaint", JSON.stringify({ ...patch.complaintPatch }));
  if (patch.medicalInfoPatch) push("medical_info", JSON.stringify({ ...patch.medicalInfoPatch }));
  if (patch.structuredAnswersPatch) push("structured_answers", JSON.stringify({ ...patch.structuredAnswersPatch }));
  if (patch.missingFields) push("missing_fields", patch.missingFields);
  if (patch.conflictingFields) push("conflicting_fields", patch.conflictingFields);
  if (patch.detectedRedFlags) push("detected_red_flags", JSON.stringify(patch.detectedRedFlags));
  if (patch.riskLevel) push("risk_level", patch.riskLevel);
  if (patch.currentQuestionKey !== undefined) push("current_question_key", patch.currentQuestionKey);
  if (patch.patientAgeYears !== undefined) push("patient_age_years", patch.patientAgeYears);
  if (patch.biologicalSex) push("biological_sex", patch.biologicalSex);
  if (patch.pregnancyStatus) push("pregnancy_status", patch.pregnancyStatus);
  if (patch.breastfeedingStatus) push("breastfeeding_status", patch.breastfeedingStatus);

  // JSONB columns need explicit cast — build the SET clause with casts for the JSON ones.
  const jsonCols = new Set(["complaint", "medical_info", "structured_answers", "detected_red_flags"]);
  const setClause = sets
    .map((s) => {
      const [col] = s.split(" = ");
      return jsonCols.has(col.trim()) ? `${s}::jsonb` : s;
    })
    .join(", ");

  await query(
    `UPDATE bms_pharmacy_assessments SET ${setClause} WHERE tenant_id = $1 AND id = $2`,
    params
  );
}

/** Append-only: never overwrites prior raw text (raw conversation must never be rewritten by summary regeneration). */
export async function appendRawMessage(
  tenantId: string,
  assessmentId: string,
  entry: { role: "customer" | "ai" | "pharmacist"; text: string; questionKey?: string | null; at?: string }
): Promise<void> {
  const payload = { ...entry, at: entry.at ?? new Date().toISOString() };
  await query(
    `UPDATE bms_pharmacy_assessments
        SET raw_messages = raw_messages || $3::jsonb, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId, JSON.stringify([payload])]
  );
}

export async function recordAiSummary(
  tenantId: string,
  assessmentId: string,
  input: { summaryText: string; promptVersion: string; modelVersion: string }
): Promise<void> {
  await query(
    `UPDATE bms_pharmacy_assessments
        SET ai_summary = $3, ai_summary_version = ai_summary_version + 1,
            ai_prompt_version = $4, ai_model_version = $5, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId, input.summaryText, input.promptVersion, input.modelVersion]
  );
  const nextVersion = await query<{ ai_summary_version: number }>(
    `SELECT ai_summary_version FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: `ai:${input.modelVersion}`,
    action: nextVersion.rows[0]?.ai_summary_version === 1 ? "assessment.summary_generated" : "assessment.summary_regenerated",
    meta: { promptVersion: input.promptVersion, modelVersion: input.modelVersion },
  });
}

export type EditSummaryResult = { status: "OK" | "NOT_FOUND" | "INVALID_STATE"; current?: AssessmentStatus };

/**
 * The pharmacist's own edit to the AI-drafted summary — kept distinct from
 * recordAiSummary() (which is the AI-authored path and bumps
 * ai_summary_version/records "generated"/"regenerated"). Only allowed while
 * a pharmacist actually has the case open for review. The edit itself is
 * appended to `pharmacist_edits` (a field on the case record, which already
 * legitimately holds health-adjacent text, same as ai_summary) — the AUDIT
 * event only carries the field name, never the before/after text.
 */
export async function editAssessmentSummary(
  tenantId: string,
  assessmentId: string,
  newSummaryText: string,
  actorUserId: string,
  ctx?: any
): Promise<EditSummaryResult> {
  const cur = await query<{ status: AssessmentStatus }>(
    `SELECT status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId]
  );
  if (!cur.rowCount) return { status: "NOT_FOUND" };
  if (cur.rows[0].status !== "PHARMACIST_REVIEWING") {
    return { status: "INVALID_STATE", current: cur.rows[0].status };
  }
  const editEntry = { field: "ai_summary", editedBy: actorUserId, editedAt: new Date().toISOString() };
  await query(
    `UPDATE bms_pharmacy_assessments
        SET ai_summary = $3, pharmacist_edits = pharmacist_edits || $4::jsonb, version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId, newSummaryText, JSON.stringify([editEntry])]
  );
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
    action: "assessment.summary_edited",
    meta: {},
    ctx,
  });
  return { status: "OK" };
}

/**
 * Persists the AI's drug/dosage suggestions (already validated + allergy-
 * filtered by the caller) onto the case record for audit/traceability —
 * this column is PHARMACIST-ONLY data: never read by the customer pipeline,
 * never copied automatically into pharmacist_decision_notes, never sent by
 * notifyCustomerOfDecision(). A pharmacist must explicitly use it.
 */
export async function recordMedicationSuggestions(
  tenantId: string,
  assessmentId: string,
  suggestions: unknown[],
  actorUserId: string,
  ctx?: any
): Promise<void> {
  await query(
    `UPDATE bms_pharmacy_assessments SET medication_suggestions = $3::jsonb, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId, JSON.stringify(suggestions)]
  );
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
    action: "assessment.medication_suggested",
    meta: { count: suggestions.length },
    ctx,
  });
}

export async function markNeedsManualIntake(tenantId: string, assessmentId: string, reason: string): Promise<void> {
  await query(
    `UPDATE bms_pharmacy_assessments SET needs_manual_intake = TRUE, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: "system:pharmacy-intake",
    action: "ai.fallback",
    meta: { reason },
  });
}

// ---------------------------------------------------------------
// Rule-engine-driven transitions (still no pharmacist decision involved)
// ---------------------------------------------------------------
async function transition(
  tenantId: string,
  assessmentId: string,
  from: AssessmentStatus[],
  to: AssessmentStatus,
  extraSetClause = "",
  extraParams: any[] = []
): Promise<{ ok: boolean; previousState?: AssessmentStatus }> {
  const cur = await query<{ status: AssessmentStatus }>(
    `SELECT status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  if (!cur.rowCount) return { ok: false };
  const previousState = cur.rows[0].status;
  const res = await query(
    `UPDATE bms_pharmacy_assessments
        SET status = $4, version = version + 1, updated_at = now() ${extraSetClause}
      WHERE tenant_id = $1 AND id = $2 AND status = ANY($3)`,
    [tenantId, assessmentId, from, to, ...extraParams]
  );
  return { ok: (res.rowCount ?? 0) > 0, previousState };
}

export async function markWaitingForPharmacist(
  tenantId: string,
  assessmentId: string,
  reason?: "customer_requested"
): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["COLLECTING_INFORMATION", "NEED_MORE_INFORMATION"],
    "WAITING_FOR_PHARMACIST",
    reason ? ", escalation_reason = $5" : "",
    reason ? [reason] : []
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: reason === "customer_requested" ? "customer:pharmacy-intake" : "system:pharmacy-intake",
      action: reason === "customer_requested" ? "assessment.customer_requested_pharmacist" : "assessment.submitted_for_review",
      previousState,
      nextState: "WAITING_FOR_PHARMACIST",
      meta: reason ? { reason } : {},
    });
  }
  return ok;
}

/** Closes a still-open case (e.g. the customer explicitly restarted with new symptoms). */
export async function closeAssessment(tenantId: string, assessmentId: string, reason: string): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["DRAFT", "COLLECTING_INFORMATION", "WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"],
    "CLOSED",
    ", decision_reason = $5, closed_at = now()",
    [reason]
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: "system:pharmacy-intake",
      action: "assessment.closed",
      previousState,
      nextState: "CLOSED",
      meta: { reason },
    });
  }
  return ok;
}

/** Single-case expiry check used mid-conversation (as opposed to the batch cron sweep below). */
export async function closeAssessmentIfExpired(tenantId: string, assessmentId: string): Promise<boolean> {
  const cur = await query<{ expires_at: Date | null; status: AssessmentStatus }>(
    `SELECT expires_at, status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  const row = cur.rows[0];
  if (!row || !row.expires_at || row.expires_at.getTime() >= Date.now()) return false;
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["DRAFT", "COLLECTING_INFORMATION", "WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"],
    "CLOSED",
    ", decision_reason = 'expired_no_action', closed_at = now()"
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: "system:pharmacy-intake",
      action: "assessment.expired",
      previousState,
      nextState: "CLOSED",
      meta: {},
    });
  }
  return ok;
}

/**
 * Reachable both from the deterministic rule engine (system actor, mid-intake
 * red flag) AND from a pharmacist reviewing a case who decides — on their own
 * clinical judgement — that this needs emergency care right now. Both are
 * legitimate per the state matrix (ALLOWED_TRANSITIONS lets every open state,
 * including PHARMACIST_REVIEWING, reach EMERGENCY_REFERRAL) — this is a
 * "become more conservative" action, not an authorization to dispense, so it
 * does not require the is_licensed_pharmacist check that approve/reject/refer
 * do; pharmacy.assessment.review permission is the gate at the resolver.
 */
export async function escalateToEmergency(
  tenantId: string,
  assessmentId: string,
  reason: string,
  ctx?: any
): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["DRAFT", "COLLECTING_INFORMATION", "WAITING_FOR_PHARMACIST", "NEED_MORE_INFORMATION", "PHARMACIST_REVIEWING"],
    "EMERGENCY_REFERRAL",
    ", escalation_reason = $5, risk_level = 'EMERGENCY', closed_at = now()",
    [reason]
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || "system:pharmacy-intake",
      action: "assessment.emergency_referral",
      previousState,
      nextState: "EMERGENCY_REFERRAL",
      meta: { reason },
      ctx,
    });
    await notifyCustomerOfDecision(tenantId, assessmentId, EMERGENCY_CUSTOMER_MESSAGE, "emergency_referral");
  }
  return ok;
}

// ---------------------------------------------------------------
// Pharmacist-triggered transitions
// ---------------------------------------------------------------
export async function assignPharmacist(
  tenantId: string,
  assessmentId: string,
  pharmacistUserId: string,
  ctx?: any
): Promise<boolean> {
  const res = await query(
    `UPDATE bms_pharmacy_assessments SET assigned_pharmacist_id = $3, version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId, pharmacistUserId]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || pharmacistUserId,
      action: "assessment.pharmacist_assigned",
      meta: { pharmacistUserId },
      ctx,
    });
  }
  return ok;
}

export type StartReviewResult = { status: "OK" | "NOT_FOUND" | "INVALID_STATE"; current?: AssessmentStatus };

/** Claiming a case: WAITING_FOR_PHARMACIST → PHARMACIST_REVIEWING, auto-assigns if unclaimed. */
export async function startReview(
  tenantId: string,
  assessmentId: string,
  actorUserId: string,
  ctx?: any
): Promise<StartReviewResult> {
  const cur = await query<{ status: AssessmentStatus; assigned_pharmacist_id: string | null }>(
    `SELECT status, assigned_pharmacist_id FROM bms_pharmacy_assessments
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId]
  );
  if (!cur.rowCount) return { status: "NOT_FOUND" };
  const row = cur.rows[0];
  if (!ALLOWED_TRANSITIONS[row.status]?.includes("PHARMACIST_REVIEWING")) {
    return { status: "INVALID_STATE", current: row.status };
  }
  const res = await query(
    `UPDATE bms_pharmacy_assessments
        SET status = 'PHARMACIST_REVIEWING', version = version + 1, updated_at = now(),
            assigned_pharmacist_id = COALESCE(assigned_pharmacist_id, $3)
      WHERE tenant_id = $1 AND id = $2 AND status = $4`,
    [tenantId, assessmentId, actorUserId, row.status]
  );
  if ((res.rowCount ?? 0) === 0) return { status: "INVALID_STATE", current: row.status };
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
    action: "assessment.pharmacist_assigned",
    previousState: row.status,
    nextState: "PHARMACIST_REVIEWING",
    meta: { claimedBy: actorUserId },
    ctx,
  });
  return { status: "OK" };
}

export type RequestMoreInfoResult = { status: "OK" | "NOT_FOUND" | "INVALID_STATE" | "STALE_VERSION"; current?: AssessmentStatus };

export async function requestMoreInformation(
  tenantId: string,
  assessmentId: string,
  expectedVersion: number,
  fields: string[],
  note: string | null,
  actorUserId: string,
  ctx?: any
): Promise<RequestMoreInfoResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const cur = await client.query<{ status: AssessmentStatus; version: number }>(
      `SELECT status, version FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, assessmentId]
    );
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const row = cur.rows[0];
    if (row.status !== "PHARMACIST_REVIEWING") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: row.status };
    }
    if (row.version !== expectedVersion) {
      await client.query("ROLLBACK");
      return { status: "STALE_VERSION" };
    }
    await client.query(
      `UPDATE bms_pharmacy_assessments
          SET status = 'NEED_MORE_INFORMATION', missing_fields = $3, pharmacist_decision_notes = $4,
              version = version + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assessmentId, fields, note ?? null]
    );
    await client.query("COMMIT");
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
      action: "assessment.more_information_requested",
      previousState: "PHARMACIST_REVIEWING",
      nextState: "NEED_MORE_INFORMATION",
      meta: { fields: fields.join(", "), note },
      ctx,
    });
    return { status: "OK" };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// The three clinical decisions
// ---------------------------------------------------------------
export type PharmacistDecisionResult =
  | { status: "OK" }
  | { status: "NOT_FOUND" }
  | { status: "INVALID_STATE"; current: AssessmentStatus }
  | { status: "STALE_VERSION" }
  | { status: "NOT_A_LICENSED_PHARMACIST" }
  | { status: "EXPIRED_NEEDS_REEVALUATION" }
  | { status: "MISSING_REQUIRED_FIELDS"; fields: string[] };

async function isLicensedPharmacist(client: PoolClient, tenantId: string, userId: string): Promise<boolean> {
  const res = await client.query<{ is_licensed_pharmacist: boolean }>(
    `SELECT public.bms_is_licensed_pharmacist($1, $2) AS is_licensed_pharmacist`,
    [tenantId, userId]
  );
  return res.rows[0]?.is_licensed_pharmacist === true;
}

/**
 * Exclude "APPROVED" from `to` — reject/refer share this helper, approve
 * does not, so a grep for the literal 'APPROVED' string finds exactly one
 * write site (approveAssessment below).
 */
async function pharmacistDecisionTransition(params: {
  tenantId: string;
  assessmentId: string;
  actorUserId: string;
  expectedVersion: number;
  to: "REJECTED" | "REFER_TO_DOCTOR";
  reason: string;
  ctx?: any;
}): Promise<PharmacistDecisionResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, params.tenantId, { editorId: params.actorUserId });
    const cur = await client.query<{ status: AssessmentStatus; version: number; expires_at: Date | null }>(
      `SELECT status, version, expires_at FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [params.tenantId, params.assessmentId]
    );
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const row = cur.rows[0];
    if (row.status !== "PHARMACIST_REVIEWING") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: row.status };
    }
    if (row.version !== params.expectedVersion) {
      await client.query("ROLLBACK");
      return { status: "STALE_VERSION" };
    }
    if (!(await isLicensedPharmacist(client, params.tenantId, params.actorUserId))) {
      await client.query("ROLLBACK");
      return { status: "NOT_A_LICENSED_PHARMACIST" };
    }
    await client.query(
      `UPDATE bms_pharmacy_assessments
          SET status = $3, decision_reason = $4, version = version + 1, updated_at = now(), closed_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PHARMACIST_REVIEWING'`,
      [params.tenantId, params.assessmentId, params.to, params.reason]
    );
    await client.query("COMMIT");
    const staffActor = params.ctx?.admin?.email || params.ctx?.admin?.id || params.actorUserId;
    await recordPharmacyEvent({
      tenantId: params.tenantId,
      assessmentId: params.assessmentId,
      actor: staffActor,
      action: params.to === "REJECTED" ? "assessment.rejected" : "assessment.referred_to_doctor",
      previousState: "PHARMACIST_REVIEWING",
      nextState: params.to,
      meta: { reason: params.reason },
      ctx: params.ctx,
    });
    await notifyCustomerOfDecision(
      params.tenantId,
      params.assessmentId,
      params.to === "REJECTED" ? REJECTED_CUSTOMER_MESSAGE : REFERRED_CUSTOMER_MESSAGE,
      params.to === "REJECTED" ? "rejected" : "referred_to_doctor",
      staffActor
    );
    return { status: "OK" };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectAssessment(
  tenantId: string,
  assessmentId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string,
  ctx?: any
): Promise<PharmacistDecisionResult> {
  return pharmacistDecisionTransition({ tenantId, assessmentId, actorUserId, expectedVersion, to: "REJECTED", reason, ctx });
}

export async function referToDoctor(
  tenantId: string,
  assessmentId: string,
  actorUserId: string,
  expectedVersion: number,
  reason: string,
  ctx?: any
): Promise<PharmacistDecisionResult> {
  return pharmacistDecisionTransition({ tenantId, assessmentId, actorUserId, expectedVersion, to: "REFER_TO_DOCTOR", reason, ctx });
}

/**
 * The ONLY function in the codebase that writes status = 'APPROVED'.
 * `pharmacistResponse` is the pharmacist's own verbatim text — never
 * AI-authored — and is required (an empty string fails validation upstream
 * in the resolver, but this function re-checks non-emptiness too since it
 * is the actual authorization boundary, not the resolver's UI convenience).
 */
export async function approveAssessment(
  tenantId: string,
  assessmentId: string,
  actorUserId: string,
  expectedVersion: number,
  pharmacistResponse: string,
  ctx?: any
): Promise<PharmacistDecisionResult> {
  const trimmedResponse = (pharmacistResponse || "").trim();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const cur = await client.query<{
      status: AssessmentStatus;
      version: number;
      expires_at: Date | null;
      missing_fields: string[];
    }>(
      `SELECT status, version, expires_at, missing_fields FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, assessmentId]
    );
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" };
    }
    const row = cur.rows[0];

    // This is also what makes double-approval structurally impossible:
    // pharmacist B's locked read (after A's commit releases the lock) sees
    // the now-'APPROVED' status and gets INVALID_STATE, never a 2nd write.
    if (row.status !== "PHARMACIST_REVIEWING") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATE", current: row.status };
    }
    if (row.version !== expectedVersion) {
      await client.query("ROLLBACK");
      return { status: "STALE_VERSION" };
    }
    if (row.expires_at && row.expires_at.getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return { status: "EXPIRED_NEEDS_REEVALUATION" };
    }
    if ((row.missing_fields?.length ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { status: "MISSING_REQUIRED_FIELDS", fields: row.missing_fields };
    }
    if (!trimmedResponse) {
      await client.query("ROLLBACK");
      return { status: "MISSING_REQUIRED_FIELDS", fields: ["pharmacist_response"] };
    }
    // The fact check — unconditional, no Administrator super-role shortcut.
    if (!(await isLicensedPharmacist(client, tenantId, actorUserId))) {
      await client.query("ROLLBACK");
      return { status: "NOT_A_LICENSED_PHARMACIST" };
    }

    await client.query(
      `UPDATE bms_pharmacy_assessments
          SET status = 'APPROVED', approved_by = $3, approved_at = now(),
              pharmacist_decision_notes = $4, version = version + 1, updated_at = now(), closed_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PHARMACIST_REVIEWING'`,
      [tenantId, assessmentId, actorUserId, trimmedResponse]
    );
    await client.query("COMMIT");
    const staffActor = ctx?.admin?.email || ctx?.admin?.id || actorUserId;
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: staffActor,
      action: "assessment.approved",
      previousState: "PHARMACIST_REVIEWING",
      nextState: "APPROVED",
      meta: {},
      ctx,
    });
    // The pharmacist's own verbatim text — never AI-authored/paraphrased.
    await notifyCustomerOfDecision(tenantId, assessmentId, trimmedResponse, "approved", staffActor);
    return { status: "OK" };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------
// Reopen after expiry (the only path back from EXPIRED_NEEDS_REEVALUATION)
// ---------------------------------------------------------------
export async function reopenAfterExpiry(tenantId: string, assessmentId: string, actorUserId: string, ctx?: any): Promise<boolean> {
  const ttlMinutes = pharmacyAssessmentTtlMinutes();
  const res = await query(
    `UPDATE bms_pharmacy_assessments
        SET expires_at = now() + make_interval(mins => $3), version = version + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PHARMACIST_REVIEWING'`,
    [tenantId, assessmentId, ttlMinutes]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
      action: "assessment.reopened_after_expiry",
      meta: {},
      ctx,
    });
  }
  return ok;
}

// ---------------------------------------------------------------
// TTL sweep (cron) — closes stale OPEN cases, never touches terminal states
// ---------------------------------------------------------------
export async function expireStaleAssessments(): Promise<{ closed: number }> {
  const res = await query<{ id: string; tenant_id: string; status: AssessmentStatus }>(
    `UPDATE bms_pharmacy_assessments
        SET status = 'CLOSED', decision_reason = 'expired_no_action', closed_at = now(),
            version = version + 1, updated_at = now()
      WHERE expires_at IS NOT NULL AND expires_at < now()
        AND status NOT IN ('APPROVED','REJECTED','REFER_TO_DOCTOR','EMERGENCY_REFERRAL','CLOSED')
        AND deleted_at IS NULL
      RETURNING id, tenant_id, status`,
    []
  );
  for (const row of res.rows) {
    await recordPharmacyEvent({
      tenantId: row.tenant_id,
      assessmentId: row.id,
      actor: "system:pharmacy-expire-stale",
      action: "assessment.expired",
      nextState: "CLOSED",
      meta: {},
    });
  }
  return { closed: res.rowCount ?? 0 };
}

// ---------------------------------------------------------------
// Soft delete — required by spec ("ต้องรองรับ soft delete หรือ retention
// policy"). Deliberately restricted to already-terminal cases (never an
// active clinical case) and left as a manual, explicitly-gated action —
// no automatic hard-delete/retention-duration policy is implemented, since
// that duration is a legal/compliance decision this module does not make
// unilaterally (see README § Known limitations).
// ---------------------------------------------------------------
const TERMINAL_FOR_DELETE = ["APPROVED", "REJECTED", "REFER_TO_DOCTOR", "EMERGENCY_REFERRAL", "CLOSED"];

export async function softDeleteAssessment(tenantId: string, assessmentId: string, actorUserId: string, ctx?: any): Promise<boolean> {
  const res = await query(
    `UPDATE bms_pharmacy_assessments
        SET deleted_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND status = ANY($3)`,
    [tenantId, assessmentId, TERMINAL_FOR_DELETE]
  );
  const ok = (res.rowCount ?? 0) > 0;
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
      action: "assessment.soft_deleted",
      meta: {},
      ctx,
    });
  }
  return ok;
}
