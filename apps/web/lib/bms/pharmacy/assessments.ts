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
import { checkPharmacistDraftPolicyInTx } from "./productPolicy";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { sendStaffMessage } from "../inbox";
import { getConversation, listMessages } from "../inbox";
import { recordPharmacyEvent } from "./events";
import {
  ALLOWED_TRANSITIONS,
  type AssessmentStatus,
} from "./stateMachine";
import {
  buildReusablePatientProfile,
  type RememberedPatientProfile,
  type ReusablePatientProfileCandidate,
} from "./patientMemory";
export type { RememberedPatientProfile } from "./patientMemory";
import { pharmacyAssessmentTtlMinutes } from "./config";
import type { CompletenessStatus, ProtocolEscalationAction } from "./ruleEngine";

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
  anomalies: unknown[];
  completenessStatus: CompletenessStatus;
  detectedRedFlags: unknown[];
  customerConfirmationStatus: CustomerConfirmationStatus;
  customerConfirmationSummary: CustomerConfirmationSummary | null;
  customerConfirmedAt: string | null;
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
  checkoutOrderDraft: PharmacyCheckoutOrderDraft | null;
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

export type CustomerConfirmationStatus = "NOT_REQUESTED" | "PENDING" | "CONFIRMED";

export type CustomerConfirmationSummary = {
  protocolKey: string;
  symptomGroup: string;
  lines: Array<{ fieldKey: string; label: string; valueText: string }>;
  summaryText: string;
  generatedAt: string;
};

export type PharmacyCheckoutDraftItem = {
  sku: string;
  size: string;
  qty: number;
  unitPrice: number;
  productName: string;
  drugName?: string | null;
  dosageInstruction?: string | null;
  pharmacistNote?: string | null;
};

export type PharmacyCheckoutOrderDraft = {
  status: "AWAITING_CUSTOMER_CONFIRMATION" | "ORDER_CREATED";
  items: PharmacyCheckoutDraftItem[];
  estimatedTotal: number;
  createdOrderId: string | null;
  approvedAt: string | null;
};

function normalizeCheckoutDraftItem(value: any): PharmacyCheckoutDraftItem | null {
  const sku = String(value?.sku || "").trim();
  const size = String(value?.size || "").trim();
  const qty = Number(value?.qty || 0);
  const unitPrice = Number(value?.unitPrice || 0);
  const productName = String(value?.productName || "").trim();
  if (!sku || !size || !productName || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return null;
  }
  return {
    sku,
    size,
    qty,
    unitPrice,
    productName,
    drugName: value?.drugName ? String(value.drugName) : null,
    dosageInstruction: value?.dosageInstruction ? String(value.dosageInstruction) : null,
    pharmacistNote: value?.pharmacistNote ? String(value.pharmacistNote) : null,
  };
}

function normalizeCheckoutOrderDraft(value: any): PharmacyCheckoutOrderDraft | null {
  const status = String(value?.status || "").trim();
  if (status !== "AWAITING_CUSTOMER_CONFIRMATION" && status !== "ORDER_CREATED") return null;
  const items = Array.isArray(value?.items)
    ? (value.items.map(normalizeCheckoutDraftItem).filter(Boolean) as PharmacyCheckoutDraftItem[])
    : [];
  if (items.length === 0) return null;
  const estimatedTotal = Number(
    value?.estimatedTotal ?? items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
  );
  return {
    status,
    items,
    estimatedTotal: Number.isFinite(estimatedTotal) ? estimatedTotal : 0,
    createdOrderId: value?.createdOrderId ? String(value.createdOrderId) : null,
    approvedAt: value?.approvedAt ? String(value.approvedAt) : null,
  };
}

function buildApprovedCustomerMessage(baseResponse: string, orderDraft: PharmacyCheckoutOrderDraft | null): string {
  const trimmed = baseResponse.trim();
  if (!orderDraft || orderDraft.items.length === 0) return trimmed;
  return [
    trimmed,
    "",
    'หากต้องการสั่งซื้อตามรายการยานี้ ตอบว่า "ยืนยันสั่งซื้อ" ได้เลยค่ะ ระบบจะส่งลิงก์ checkout กลับให้อัตโนมัติ',
  ].join("\n");
}

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
    anomalies: r.anomalies ?? [],
    completenessStatus: r.completeness_status ?? "UNKNOWN",
    detectedRedFlags: r.detected_red_flags ?? [],
    customerConfirmationStatus: r.customer_confirmation_status ?? "NOT_REQUESTED",
    customerConfirmationSummary: r.customer_confirmation_summary ?? null,
    customerConfirmedAt: r.customer_confirmed_at ? new Date(r.customer_confirmed_at).toISOString() : null,
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
    checkoutOrderDraft: normalizeCheckoutOrderDraft(r.checkout_order_draft),
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

export async function getApprovedAssessmentCheckoutDraftByConversation(
  tenantId: string,
  conversationId: string
): Promise<{ assessmentId: string; draft: PharmacyCheckoutOrderDraft } | null> {
  const res = await query<{ id: string; checkout_order_draft: any }>(
    `SELECT id, checkout_order_draft
       FROM bms_pharmacy_assessments
      WHERE tenant_id = $1
        AND conversation_id = $2
        AND status = 'APPROVED'
        AND deleted_at IS NULL
      ORDER BY approved_at DESC NULLS LAST, updated_at DESC
      LIMIT 1`,
    [tenantId, conversationId]
  );
  if (!res.rowCount) return null;
  const draft = normalizeCheckoutOrderDraft(res.rows[0].checkout_order_draft);
  if (!draft) return null;
  return { assessmentId: res.rows[0].id, draft };
}

export async function markAssessmentOrderCreated(
  tenantId: string,
  assessmentId: string,
  orderId: string,
  actor = "system:pharmacy-order"
): Promise<void> {
  const current = await getAssessment(tenantId, assessmentId);
  if (!current?.checkoutOrderDraft) return;
  const nextDraft: PharmacyCheckoutOrderDraft = {
    ...current.checkoutOrderDraft,
    status: "ORDER_CREATED",
    createdOrderId: orderId,
  };
  await query(
    `UPDATE bms_pharmacy_assessments
        SET checkout_order_draft = $3::jsonb,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId, JSON.stringify(nextDraft)]
  );
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor,
    action: "assessment.checkout_order_created",
    meta: { orderId },
  });
}

export async function getLatestReusablePatientProfile(
  tenantId: string,
  customerId: string | null,
  patientRelationship: string,
  excludeAssessmentId?: string | null
): Promise<RememberedPatientProfile | null> {
  // A single channel account may represent several patients. Until dependent
  // profiles have their own stable ids, reuse is safe only for the account
  // owner. Never borrow a child's/parent's fields for another case.
  if (!customerId || patientRelationship !== "SELF") return null;
  const params: any[] = [tenantId, customerId];
  let excludeSql = "";
  if (excludeAssessmentId) {
    params.push(excludeAssessmentId);
    excludeSql = `AND id <> $${params.length}`;
  }
  const res = await query<{
    id: string;
    patient_age_years: number | null;
    biological_sex: string;
    structured_answers: Record<string, unknown> | null;
    customer_confirmed_at: Date | string | null;
    consent_at: Date | string | null;
    updated_at: Date | string;
  }>(
    `SELECT id, patient_age_years, biological_sex, structured_answers,
            customer_confirmed_at, consent_at, updated_at
       FROM bms_pharmacy_assessments
      WHERE tenant_id = $1
        AND customer_id = $2
        AND patient_relationship = 'SELF'
        AND consent_status = 'GRANTED'
        AND customer_confirmation_status = 'CONFIRMED'
        AND deleted_at IS NULL
        ${excludeSql}
      ORDER BY customer_confirmed_at DESC NULLS LAST, updated_at DESC
      `,
    params
  );
  if (!res.rowCount) return null;
  const candidates: ReusablePatientProfileCandidate[] = res.rows.map((row) => ({
    id: String(row.id),
    patientAgeYears: row.patient_age_years == null ? null : Number(row.patient_age_years),
    biologicalSex: row.biological_sex,
    structuredAnswers: row.structured_answers ?? {},
    customerConfirmedAt: row.customer_confirmed_at ? new Date(row.customer_confirmed_at).toISOString() : null,
    consentAt: row.consent_at ? new Date(row.consent_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  return buildReusablePatientProfile(candidates);
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
  patientRelationship?: "UNKNOWN" | "SELF" | "CHILD" | "PARENT" | "OTHER";
};

export type CreateAssessmentResult =
  | { status: "CREATED"; assessmentId: string }
  | { status: "ALREADY_EXISTS"; assessmentId: string; assessmentStatus: AssessmentStatus };

export async function createProductReviewAssessmentOnce(input: {
  tenantId: string;
  channelId: string;
  conversationId: string;
  items: Array<{ sku: string; size: string; qty: number }>;
  requiresSafetyCheck?: boolean;
}): Promise<CreateAssessmentResult> {
  const merged = new Map<string, { sku: string; size: string; qty: number }>();
  for (const item of input.items) {
    if (!item.sku || !item.size || !Number.isInteger(item.qty) || item.qty <= 0) continue;
    const key = `${item.sku}\u0000${item.size}`;
    const current = merged.get(key);
    if (current) current.qty += item.qty;
    else merged.set(key, { ...item });
  }
  const items = [...merged.values()];
  if (items.length === 0) throw new Error("ไม่มีรายการสินค้าสำหรับส่งเภสัชกรตรวจ");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);
    const conversation = await client.query<{ customer_id: string | null }>(
      `SELECT customer_id FROM bms_conversations
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.conversationId]
    );
    if (!conversation.rowCount) throw new Error("ไม่พบบทสนทนาสำหรับสร้างเคส Product Review");
    const active = await client.query<{ id: string; status: AssessmentStatus }>(
      `SELECT id, status FROM bms_pharmacy_assessments
        WHERE tenant_id = $1 AND conversation_id = $2
          AND status IN (
            'DRAFT','COLLECTING_INFORMATION','PENDING_CONFIRMATION',
            'WAITING_FOR_PHARMACIST','PHARMACIST_REVIEWING','NEED_MORE_INFORMATION'
          ) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [input.tenantId, input.conversationId]
    );
    if (active.rows[0]) {
      await client.query("COMMIT");
      return { status: "ALREADY_EXISTS", assessmentId: active.rows[0].id, assessmentStatus: active.rows[0].status };
    }

    const skus = [...new Set(items.map((item) => item.sku))];
    const products = await client.query<{ sku: string; name: string; price: string }>(
      `SELECT sku, name, price FROM bms_products
        WHERE tenant_id = $1 AND sku = ANY($2::text[]) AND active = TRUE`,
      [input.tenantId, skus]
    );
    const bySku = new Map(products.rows.map((product) => [product.sku, product]));
    for (const item of items) {
      const inventory = await client.query<{ available: number }>(
        `SELECT (current_stock - reserved_stock) AS available
           FROM bms_inventory
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3`,
        [input.tenantId, item.sku, item.size]
      );
      if (!inventory.rowCount) throw new Error(`ไม่พบสินค้า ${item.sku} ขนาด ${item.size}`);
      if (Number(inventory.rows[0].available) < item.qty) {
        throw new Error(`สินค้า ${item.sku} ขนาด ${item.size} มีจำนวนไม่พอสำหรับส่งตรวจ`);
      }
    }
    const draftItems = items.map((item) => {
      const product = bySku.get(item.sku);
      if (!product) throw new Error(`ไม่พบสินค้า ${item.sku} หรือสินค้าไม่พร้อมขาย`);
      return {
        sku: item.sku,
        size: item.size,
        qty: item.qty,
        unitPrice: Number(product.price),
        productName: product.name,
        drugName: null,
        dosageInstruction: null,
        pharmacistNote: null,
      };
    });
    const estimatedTotal = draftItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const checkoutDraft: PharmacyCheckoutOrderDraft = {
      status: "AWAITING_CUSTOMER_CONFIRMATION",
      items: draftItems,
      estimatedTotal,
      createdOrderId: null,
      approvedAt: null,
    };
    const summary = {
      protocolKey: "product_purchase",
      symptomGroup: "product_purchase",
      lines: draftItems.map((item) => ({
        fieldKey: `product:${item.sku}:${item.size}`,
        label: "สินค้าที่ต้องการซื้อ",
        valueText: `${item.productName} (${item.sku}) / ${item.size} × ${item.qty}`,
      })),
      summaryText: draftItems.map((item) => `${item.productName} (${item.sku}) / ${item.size} × ${item.qty}`).join("\n"),
      generatedAt: new Date().toISOString(),
    };
    const ttlMinutes = pharmacyAssessmentTtlMinutes();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, customer_id, channel_id, conversation_id, protocol_id,
          patient_relationship, consent_status, status, needs_manual_intake, risk_level,
          complaint, structured_answers, missing_fields, conflicting_fields,
          completeness_status, customer_confirmation_status, customer_confirmation_summary,
          customer_confirmed_at, checkout_order_draft, expires_at)
       VALUES ($1,$2,$3,$4,NULL,'UNKNOWN','PENDING','WAITING_FOR_PHARMACIST',TRUE,'UNKNOWN',
               $5::jsonb,'{}'::jsonb,$6::text[],'{}'::text[],
               $7,'CONFIRMED',$8::jsonb,now(),$9::jsonb,
               now() + make_interval(mins => $10))
       RETURNING id`,
      [
        input.tenantId,
        conversation.rows[0].customer_id,
        input.channelId,
        input.conversationId,
        JSON.stringify({ requestType: "PRODUCT_PURCHASE", requiresSafetyCheck: input.requiresSafetyCheck === true }),
        input.requiresSafetyCheck ? ["patient_relationship", "patient_age_years", "allergies", "current_medications"] : [],
        input.requiresSafetyCheck ? "INCOMPLETE" : "COMPLETE",
        JSON.stringify(summary),
        JSON.stringify(checkoutDraft),
        ttlMinutes,
      ]
    );
    const assessmentId = inserted.rows[0].id;
    await client.query(
      `UPDATE bms_conversations SET pharmacy_intake_case_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.conversationId, assessmentId]
    );
    await client.query("COMMIT");
    await recordPharmacyEvent({
      tenantId: input.tenantId,
      assessmentId,
      actor: "system:pharmacy-product-gate",
      action: "assessment.product_review_requested",
      previousState: null,
      nextState: "WAITING_FOR_PHARMACIST",
      meta: { itemCount: draftItems.length, requiresSafetyCheck: input.requiresSafetyCheck === true },
    });
    return { status: "CREATED", assessmentId };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

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
            AND status IN (
              'DRAFT','COLLECTING_INFORMATION','PENDING_CONFIRMATION',
              'WAITING_FOR_PHARMACIST','PHARMACIST_REVIEWING','NEED_MORE_INFORMATION'
            ) AND deleted_at IS NULL
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
        input.patientRelationship ?? "UNKNOWN",
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
      meta: { protocolId: input.protocolId, patientRelationship: input.patientRelationship ?? "UNKNOWN" },
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
  anomalies?: unknown[];
  completenessStatus?: CompletenessStatus;
  customerConfirmationStatus?: CustomerConfirmationStatus;
  customerConfirmationSummary?: CustomerConfirmationSummary | null;
  customerConfirmedAt?: string | null;
  detectedRedFlags?: unknown[];
  riskLevel?: string;
  currentQuestionKey?: string | null;
  patientAgeYears?: number | null;
  biologicalSex?: string;
  pregnancyStatus?: string;
  breastfeedingStatus?: string;
  patientRelationship?: string;
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
  if (patch.anomalies) push("anomalies", JSON.stringify(patch.anomalies));
  if (patch.completenessStatus) push("completeness_status", patch.completenessStatus);
  if (patch.customerConfirmationStatus) push("customer_confirmation_status", patch.customerConfirmationStatus);
  if (patch.customerConfirmationSummary !== undefined) push("customer_confirmation_summary", JSON.stringify(patch.customerConfirmationSummary));
  if (patch.customerConfirmedAt !== undefined) push("customer_confirmed_at", patch.customerConfirmedAt);
  if (patch.detectedRedFlags) push("detected_red_flags", JSON.stringify(patch.detectedRedFlags));
  if (patch.riskLevel) push("risk_level", patch.riskLevel);
  if (patch.currentQuestionKey !== undefined) push("current_question_key", patch.currentQuestionKey);
  if (patch.patientAgeYears !== undefined) push("patient_age_years", patch.patientAgeYears);
  if (patch.biologicalSex) push("biological_sex", patch.biologicalSex);
  if (patch.pregnancyStatus) push("pregnancy_status", patch.pregnancyStatus);
  if (patch.breastfeedingStatus) push("breastfeeding_status", patch.breastfeedingStatus);
  if (patch.patientRelationship) push("patient_relationship", patch.patientRelationship);

  // JSONB columns need explicit cast — build the SET clause with casts for the JSON ones.
  const jsonCols = new Set([
    "complaint",
    "medical_info",
    "structured_answers",
    "anomalies",
    "customer_confirmation_summary",
    "detected_red_flags",
  ]);
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

export type EditPharmacistDecisionNotesResult = {
  status: "OK" | "NOT_FOUND" | "INVALID_STATE" | "STALE_VERSION";
  current?: AssessmentStatus;
};

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
 * Saves the pharmacist-authored response draft before the final decision.
 * The text is sensitive clinical/customer content, so the audit event records
 * only that the field changed. Optimistic version matching prevents one
 * reviewer from silently overwriting another reviewer's draft.
 */
export async function editPharmacistDecisionNotes(
  tenantId: string,
  assessmentId: string,
  expectedVersion: number,
  decisionNotes: string,
  actorUserId: string,
  ctx?: any
): Promise<EditPharmacistDecisionNotesResult> {
  const updated = await query(
    `UPDATE bms_pharmacy_assessments
        SET pharmacist_decision_notes = $4,
            version = version + 1,
            updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND version = $3
        AND status = 'PHARMACIST_REVIEWING'
        AND deleted_at IS NULL
      RETURNING id`,
    [tenantId, assessmentId, expectedVersion, decisionNotes.trim()]
  );
  if (updated.rowCount) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
      action: "assessment.pharmacist_summary_edited",
      meta: {},
      ctx,
    });
    return { status: "OK" };
  }

  const current = await query<{ status: AssessmentStatus; version: number }>(
    `SELECT status, version
       FROM bms_pharmacy_assessments
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, assessmentId]
  );
  if (!current.rowCount) return { status: "NOT_FOUND" };
  if (current.rows[0].status !== "PHARMACIST_REVIEWING") {
    return { status: "INVALID_STATE", current: current.rows[0].status };
  }
  return { status: "STALE_VERSION" };
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

export async function markPendingCustomerConfirmation(
  tenantId: string,
  assessmentId: string,
  summary: CustomerConfirmationSummary
): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["COLLECTING_INFORMATION", "NEED_MORE_INFORMATION"],
    "PENDING_CONFIRMATION",
    ", customer_confirmation_status = $5, customer_confirmation_summary = $6::jsonb, customer_confirmed_at = NULL, current_question_key = NULL",
    ["PENDING", JSON.stringify(summary)]
  );
  if (!ok) return false;
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: "system:pharmacy-intake",
    action: "assessment.confirmation_requested",
    previousState,
    nextState: "PENDING_CONFIRMATION",
    meta: { lineCount: summary.lines.length, protocolKey: summary.protocolKey },
  });
  return true;
}

export async function reopenForCustomerCorrection(tenantId: string, assessmentId: string): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["PENDING_CONFIRMATION"],
    "COLLECTING_INFORMATION",
    ", customer_confirmation_status = 'NOT_REQUESTED', customer_confirmed_at = NULL, current_question_key = NULL"
  );
  if (!ok) return false;
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: "customer:pharmacy-intake",
    action: "assessment.reopened_for_customer_correction",
    previousState,
    nextState: "COLLECTING_INFORMATION",
    meta: {},
  });
  return true;
}

export async function confirmCustomerSummary(tenantId: string, assessmentId: string): Promise<boolean> {
  const current = await query<{ completeness_status: CompletenessStatus }>(
    `SELECT completeness_status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, assessmentId]
  );
  if (!current.rowCount || current.rows[0].completeness_status !== "COMPLETE") return false;
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["PENDING_CONFIRMATION"],
    "WAITING_FOR_PHARMACIST",
    ", customer_confirmation_status = 'CONFIRMED', customer_confirmed_at = now()"
  );
  if (!ok) return false;
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: "customer:pharmacy-intake",
    action: "assessment.confirmed_by_customer",
    previousState,
    nextState: "WAITING_FOR_PHARMACIST",
    meta: {},
  });
  return true;
}

export async function markWaitingForPharmacist(
  tenantId: string,
  assessmentId: string,
  reason?: "customer_requested" | "ai_unavailable"
): Promise<boolean> {
  if (!reason) {
    const current = await query<{ completeness_status: CompletenessStatus }>(
      `SELECT completeness_status FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND id = $2`,
      [tenantId, assessmentId]
    );
    if (!current.rowCount || current.rows[0].completeness_status !== "COMPLETE") return false;
  }
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    reason === "customer_requested"
      ? ["DRAFT", "COLLECTING_INFORMATION", "NEED_MORE_INFORMATION", "PENDING_CONFIRMATION"]
      : ["COLLECTING_INFORMATION", "NEED_MORE_INFORMATION", "PENDING_CONFIRMATION"],
    "WAITING_FOR_PHARMACIST",
    reason ? ", escalation_reason = $5" : "",
    reason ? [reason] : []
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: reason === "customer_requested" ? "customer:pharmacy-intake" : "system:pharmacy-intake",
      action:
        reason === "customer_requested"
          ? "assessment.customer_requested_pharmacist"
          : reason === "ai_unavailable"
            ? "assessment.submitted_for_manual_intake"
            : "assessment.submitted_for_review",
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
    ["DRAFT", "COLLECTING_INFORMATION", "PENDING_CONFIRMATION", "WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"],
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
    ["DRAFT", "COLLECTING_INFORMATION", "PENDING_CONFIRMATION", "WAITING_FOR_PHARMACIST", "PHARMACIST_REVIEWING", "NEED_MORE_INFORMATION"],
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
  ctx?: any,
  deliverCustomerMessage = true
): Promise<boolean> {
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["DRAFT", "COLLECTING_INFORMATION", "PENDING_CONFIRMATION", "WAITING_FOR_PHARMACIST", "NEED_MORE_INFORMATION", "PHARMACIST_REVIEWING"],
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
    if (deliverCustomerMessage) {
      await notifyCustomerOfDecision(tenantId, assessmentId, EMERGENCY_CUSTOMER_MESSAGE, "emergency_referral");
    }
  }
  return ok;
}

export async function routeProtocolEscalation(
  tenantId: string,
  assessmentId: string,
  action: Exclude<ProtocolEscalationAction, "CONTINUE">,
  reason: string,
  severity: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY",
  ctx?: any,
  deliverCustomerMessage = true
): Promise<boolean> {
  if (action === "EMERGENCY_REFERRAL") return escalateToEmergency(tenantId, assessmentId, reason, ctx, deliverCustomerMessage);
  const nextState: AssessmentStatus = action === "URGENT_MEDICAL_REVIEW" ? "REFER_TO_DOCTOR" : "WAITING_FOR_PHARMACIST";
  const { ok, previousState } = await transition(
    tenantId,
    assessmentId,
    ["DRAFT", "COLLECTING_INFORMATION", "PENDING_CONFIRMATION", "NEED_MORE_INFORMATION"],
    nextState,
    `, escalation_reason = $5, risk_level = $6${nextState === "REFER_TO_DOCTOR" ? ", closed_at = now()" : ""}`,
    [reason, severity]
  );
  if (ok) {
    await recordPharmacyEvent({
      tenantId,
      assessmentId,
      actor: ctx?.admin?.email || ctx?.admin?.id || "system:pharmacy-intake",
      action: action === "URGENT_MEDICAL_REVIEW" ? "assessment.protocol_urgent_medical_review" : "assessment.protocol_pharmacist_review",
      previousState,
      nextState,
      meta: { reason, severity },
      ctx,
    });
    if (action === "URGENT_MEDICAL_REVIEW" && deliverCustomerMessage) {
      await notifyCustomerOfDecision(tenantId, assessmentId, REFERRED_CUSTOMER_MESSAGE, "referred_to_doctor");
    }
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
  const currentStatus = row.status as AssessmentStatus;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes("PHARMACIST_REVIEWING")) {
    return { status: "INVALID_STATE", current: currentStatus };
  }
  const res = await query(
    `UPDATE bms_pharmacy_assessments
        SET status = 'PHARMACIST_REVIEWING', version = version + 1, updated_at = now(),
            assigned_pharmacist_id = COALESCE(assigned_pharmacist_id, $3)
      WHERE tenant_id = $1 AND id = $2 AND status = $4`,
    [tenantId, assessmentId, actorUserId, currentStatus]
  );
  if ((res.rowCount ?? 0) === 0) return { status: "INVALID_STATE", current: currentStatus };
  await recordPharmacyEvent({
    tenantId,
    assessmentId,
    actor: ctx?.admin?.email || ctx?.admin?.id || actorUserId,
    action: "assessment.pharmacist_assigned",
    previousState: currentStatus,
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
  | { status: "CUSTOMER_CONFIRMATION_REQUIRED" }
  | { status: "PRODUCT_POLICY_BLOCKED"; fields: string[] }
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
  orderDraft: PharmacyCheckoutOrderDraft | null = null,
  ctx?: any
): Promise<PharmacistDecisionResult> {
  const trimmedResponse = (pharmacistResponse || "").trim();
  const normalizedOrderDraft = normalizeCheckoutOrderDraft(orderDraft);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    const cur = await client.query<{
      status: AssessmentStatus;
      version: number;
      expires_at: Date | null;
      missing_fields: string[];
      conflicting_fields: string[];
      anomalies: unknown[];
      completeness_status: CompletenessStatus;
      customer_confirmation_status: CustomerConfirmationStatus;
      has_manual_override: boolean;
    }>(
      `SELECT a.status, a.version, a.expires_at, a.missing_fields, a.conflicting_fields,
              a.anomalies, a.completeness_status, a.customer_confirmation_status,
              EXISTS (
                SELECT 1 FROM bms_pharmacy_assessment_events e
                 WHERE e.tenant_id = a.tenant_id AND e.assessment_id = a.id
                   AND (
                     e.action = 'assessment.manual_answer_recorded'
                     OR (e.action = 'assessment.answer_changed' AND e.meta->>'source' = 'manual_pharmacist_entry')
                   )
              ) AS has_manual_override
         FROM bms_pharmacy_assessments a
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL FOR UPDATE`,
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
    if (row.completeness_status !== "COMPLETE") {
      await client.query("ROLLBACK");
      return { status: "MISSING_REQUIRED_FIELDS", fields: ["completeness_status"] };
    }
    if ((row.conflicting_fields?.length ?? 0) > 0 || (Array.isArray(row.anomalies) && row.anomalies.length > 0)) {
      await client.query("ROLLBACK");
      return { status: "MISSING_REQUIRED_FIELDS", fields: [
        ...(row.conflicting_fields ?? []),
        ...(Array.isArray(row.anomalies) && row.anomalies.length > 0 ? ["anomalies"] : []),
      ] };
    }
    if (row.customer_confirmation_status !== "CONFIRMED" && !row.has_manual_override) {
      await client.query("ROLLBACK");
      return { status: "CUSTOMER_CONFIRMATION_REQUIRED" };
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

    if (normalizedOrderDraft) {
      const productPolicy = await checkPharmacistDraftPolicyInTx(
        client,
        tenantId,
        normalizedOrderDraft.items.map((item) => ({ sku: item.sku, qty: item.qty }))
      );
      if (!productPolicy.allowed) {
        await client.query("ROLLBACK");
        return {
          status: "PRODUCT_POLICY_BLOCKED",
          fields: [`${productPolicy.sku}:${productPolicy.status}`],
        };
      }
    }

    await client.query(
      `UPDATE bms_pharmacy_assessments
          SET status = 'APPROVED', approved_by = $3, approved_at = now(),
              pharmacist_decision_notes = $4,
              checkout_order_draft = $5::jsonb,
              version = version + 1, updated_at = now(), closed_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PHARMACIST_REVIEWING'`,
      [tenantId, assessmentId, actorUserId, trimmedResponse, JSON.stringify(normalizedOrderDraft)]
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
      meta: normalizedOrderDraft ? { checkoutDraftItems: normalizedOrderDraft.items.length } : {},
      ctx,
    });
    // The pharmacist's own verbatim text — never AI-authored/paraphrased.
    await notifyCustomerOfDecision(
      tenantId,
      assessmentId,
      buildApprovedCustomerMessage(trimmedResponse, normalizedOrderDraft),
      "approved",
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
