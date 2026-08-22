// =============================================================
// BMS Pharmacy Intake — protocol registry (read + manage)
// -------------------------------------------------------------
// bms_pharmacy_protocols (db/migrations/7.58) is the data-driven source of
// truth for the question/red-flag/completion/escalation rules
// lib/bms/pharmacy/ruleEngine.ts walks. This file is plain CRUD over that
// table — no clinical logic lives here.
// =============================================================

import { query } from "@/lib/db";
import { enabledPharmacyProtocolKeys } from "./config";
import type {
  ProtocolCompletionRules,
  ProtocolConditionalQuestion,
  ProtocolDefinition,
  ProtocolEscalationRules,
  ProtocolFieldDef,
  ProtocolRedFlagRule,
} from "./ruleEngine";

export type PharmacyProtocolRow = {
  id: string;
  tenantId: string;
  protocolKey: string;
  name: string;
  version: number;
  supportedSymptomGroup: string;
  displayLabel: string;
  triggerTerms: string[];
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  redFlagRules: ProtocolRedFlagRule[];
  completionRules: ProtocolCompletionRules;
  escalationRules: ProtocolEscalationRules;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "RETIRED";
  clinicallyApproved: boolean;
  enabled: boolean;
  platformAllowed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRow(r: any): PharmacyProtocolRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    protocolKey: r.protocol_key,
    name: r.name,
    version: r.version,
    supportedSymptomGroup: r.supported_symptom_group,
    displayLabel: r.display_label ?? r.supported_symptom_group ?? r.protocol_key,
    triggerTerms: Array.isArray(r.trigger_terms) ? r.trigger_terms : [],
    requiredFields: r.required_fields ?? [],
    conditionalQuestions: r.conditional_questions ?? [],
    redFlagRules: r.red_flag_rules ?? [],
    completionRules: r.completion_rules ?? { requireAllOf: [] },
    escalationRules: r.escalation_rules ?? {},
    status: r.status,
    clinicallyApproved: r.clinically_approved,
    enabled: r.enabled,
    platformAllowed: enabledPharmacyProtocolKeys().includes(String(r.protocol_key).toLowerCase()),
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function toProtocolDefinition(row: PharmacyProtocolRow): ProtocolDefinition {
  return {
    id: row.id,
    protocolKey: row.protocolKey,
    requiredFields: row.requiredFields,
    conditionalQuestions: row.conditionalQuestions,
    redFlagRules: row.redFlagRules,
    completionRules: row.completionRules,
    escalationRules: row.escalationRules,
  };
}

export async function listPharmacyProtocols(tenantId: string): Promise<PharmacyProtocolRow[]> {
  const res = await query(
    `SELECT * FROM bms_pharmacy_protocols WHERE tenant_id = $1 ORDER BY name, version DESC`,
    [tenantId]
  );
  return res.rows.map(mapRow);
}

export async function getPharmacyProtocol(tenantId: string, id: string): Promise<PharmacyProtocolRow | null> {
  const res = await query(`SELECT * FROM bms_pharmacy_protocols WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return res.rowCount ? mapRow(res.rows[0]) : null;
}

/**
 * The row a live intake case should use: DB `enabled = true` AND the
 * platform-wide PHARMACY_PROTOCOLS_ENABLED env allowlist both agree — either
 * one can disable a protocol, matching the "kill switch without a DB write"
 * requirement for ops incident response.
 */
export async function getActivePharmacyProtocolByKey(
  tenantId: string,
  protocolKey: string
): Promise<PharmacyProtocolRow | null> {
  const allowlist = enabledPharmacyProtocolKeys();
  if (!allowlist.includes(protocolKey.toLowerCase())) return null;
  const res = await query(
    `SELECT * FROM bms_pharmacy_protocols
       WHERE tenant_id = $1 AND protocol_key = $2 AND enabled = TRUE
         AND clinically_approved = TRUE AND status = 'APPROVED'
       ORDER BY version DESC LIMIT 1`,
    [tenantId, protocolKey]
  );
  return res.rowCount ? mapRow(res.rows[0]) : null;
}

/** All protocol_keys currently live for this tenant (DB enabled AND env-allowlisted) — used to detect intake-trigger intent. */
export async function listActivePharmacyProtocolKeys(tenantId: string): Promise<string[]> {
  const allowlist = new Set(enabledPharmacyProtocolKeys());
  if (allowlist.size === 0) return [];
  const res = await query<{ protocol_key: string }>(
    `SELECT DISTINCT protocol_key FROM bms_pharmacy_protocols
      WHERE tenant_id = $1 AND enabled = TRUE
        AND clinically_approved = TRUE AND status = 'APPROVED'`,
    [tenantId]
  );
  return res.rows.map((r: { protocol_key: string }) => r.protocol_key).filter((key: string) => allowlist.has(key));
}

export type UpsertPharmacyProtocolInput = {
  id?: string;
  protocolKey: string;
  name: string;
  version?: number;
  supportedSymptomGroup: string;
  displayLabel: string;
  triggerTerms: string[];
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  redFlagRules: ProtocolRedFlagRule[];
  completionRules: ProtocolCompletionRules;
  escalationRules: ProtocolEscalationRules;
};

const PROTOCOL_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;
const FIELD_TYPES = new Set(["free_text", "yes_no", "number", "choice", "duration"]);
const RED_FLAG_SEVERITIES = new Set(["LOW", "MODERATE", "HIGH", "EMERGENCY"]);
const ESCALATION_ACTIONS = new Set(["CONTINUE", "PHARMACIST_REVIEW", "URGENT_MEDICAL_REVIEW", "EMERGENCY_REFERRAL"]);

function nonEmpty(value: unknown, label: string, max = 200): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`ต้องระบุ ${label}`);
  if (text.length > max) throw new Error(`${label} ยาวเกิน ${max} ตัวอักษร`);
  return text;
}

function validateCondition(condition: any, knownKeys: Set<string>, depth = 0): number {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error("condition ต้องเป็น object");
  if (depth > 5) throw new Error("condition ซ้อนลึกเกิน 5 ระดับ");
  if (Array.isArray(condition.allOf) || Array.isArray(condition.anyOf)) {
    const children = condition.allOf ?? condition.anyOf;
    if (children.length === 0 || children.length > 20) throw new Error("allOf/anyOf ต้องมี 1–20 เงื่อนไข");
    return children.reduce((sum: number, child: any) => sum + validateCondition(child, knownKeys, depth + 1), 0);
  }
  if (condition.not) return validateCondition(condition.not, knownKeys, depth + 1);
  if (!knownKeys.has(String(condition.field || ""))) throw new Error(`condition อ้าง field ที่ไม่มี: ${condition.field ?? ""}`);
  const operators = ["equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "in", "exists"]
    .filter((key) => condition[key] !== undefined);
  if (operators.length !== 1) throw new Error(`condition ของ ${condition.field} ต้องมี operator เพียงหนึ่งชนิด`);
  if (condition.in !== undefined && (!Array.isArray(condition.in) || condition.in.length === 0 || condition.in.length > 50)) {
    throw new Error(`condition.in ของ ${condition.field} ต้องมี 1–50 ค่า`);
  }
  return 1;
}

export function validatePharmacyProtocolInput(input: UpsertPharmacyProtocolInput): UpsertPharmacyProtocolInput {
  const protocolKey = nonEmpty(input.protocolKey, "protocolKey", 64).toLowerCase();
  if (!PROTOCOL_KEY_RE.test(protocolKey)) throw new Error("protocolKey ต้องเป็น a-z, 0-9 หรือ _ และขึ้นต้นด้วยตัวอักษร");
  const requiredFields = Array.isArray(input.requiredFields) ? input.requiredFields : [];
  const conditionalQuestions = Array.isArray(input.conditionalQuestions) ? input.conditionalQuestions : [];
  const redFlagRules = Array.isArray(input.redFlagRules) ? input.redFlagRules : [];
  const seen = new Set<string>();
  for (const field of requiredFields) {
    if (!FIELD_KEY_RE.test(String(field?.key || ""))) throw new Error(`field key ไม่ถูกต้อง: ${field?.key ?? ""}`);
    if (seen.has(field.key)) throw new Error(`field key ซ้ำ: ${field.key}`);
    seen.add(field.key);
    nonEmpty(field.label, `label ของ ${field.key}`, 300);
    nonEmpty(field.questionKey, `questionKey ของ ${field.key}`, 100);
    if (!FIELD_TYPES.has(field.type)) throw new Error(`field type ไม่รองรับ: ${field.type}`);
  }
  for (const field of conditionalQuestions) {
    if (!FIELD_KEY_RE.test(String(field?.key || ""))) throw new Error(`conditional field key ไม่ถูกต้อง: ${field?.key ?? ""}`);
    if (seen.has(field.key)) throw new Error(`field key ซ้ำ: ${field.key}`);
    seen.add(field.key);
    nonEmpty(field.questionKey, `questionKey ของ ${field.key}`, 100);
    if (!field.unlockWhen || !FIELD_KEY_RE.test(String(field.unlockWhen.field || ""))) {
      throw new Error(`unlockWhen ของ ${field.key} ไม่ถูกต้อง`);
    }
    if (field.type && !FIELD_TYPES.has(field.type)) throw new Error(`field type ไม่รองรับ: ${field.type}`);
  }
  const globalKeys = new Set(["patient_relationship", "patient_age_years", "biological_sex", "allergies", "current_medications", "pregnancy_status", "breastfeeding_status"]);
  const knownKeys = new Set([...globalKeys, ...seen]);
  for (const field of conditionalQuestions) {
    if (!knownKeys.has(field.unlockWhen.field)) throw new Error(`unlockWhen อ้าง field ที่ไม่มี: ${field.unlockWhen.field}`);
  }
  for (const rule of redFlagRules) {
    nonEmpty(rule.code, "red flag code", 100);
    nonEmpty(rule.label, `label ของ ${rule.code}`, 300);
    if (!RED_FLAG_SEVERITIES.has(rule.severity)) throw new Error(`severity ไม่ถูกต้อง: ${rule.severity}`);
    if (rule.condition) {
      if (validateCondition(rule.condition, knownKeys) > 100) throw new Error(`red flag ${rule.code} มีเงื่อนไขมากเกิน 100 ข้อ`);
    } else {
      if (!rule.field || !knownKeys.has(rule.field)) throw new Error(`red flag อ้าง field ที่ไม่มี: ${rule.field ?? ""}`);
      const operators = [rule.equals !== undefined, rule.greaterThan !== undefined, rule.lessThan !== undefined].filter(Boolean).length;
      if (operators !== 1) throw new Error(`red flag ${rule.code} ต้องมี operator เพียงหนึ่งชนิด`);
    }
  }
  const requireAllOf = input.completionRules?.requireAllOf;
  if (!Array.isArray(requireAllOf)) throw new Error("completionRules.requireAllOf ต้องเป็น array");
  for (const key of requireAllOf) if (!knownKeys.has(key)) throw new Error(`completion rule อ้าง field ที่ไม่มี: ${key}`);
  const bySeverity = input.escalationRules?.bySeverity;
  if (bySeverity && (typeof bySeverity !== "object" || Array.isArray(bySeverity))) throw new Error("escalationRules.bySeverity ต้องเป็น object");
  for (const [severity, action] of Object.entries(bySeverity ?? {})) {
    if (!RED_FLAG_SEVERITIES.has(severity) || !ESCALATION_ACTIONS.has(String(action))) throw new Error(`escalation mapping ไม่ถูกต้อง: ${severity}=${action}`);
  }
  const triggerTerms = [...new Set((Array.isArray(input.triggerTerms) ? input.triggerTerms : []).map((term) => String(term).trim().toLowerCase()).filter(Boolean))];
  if (triggerTerms.length === 0) throw new Error("ต้องระบุ triggerTerms อย่างน้อย 1 คำ");
  if (triggerTerms.length > 50 || triggerTerms.some((term) => term.length > 100)) throw new Error("triggerTerms มากหรือยาวเกินกำหนด");
  return {
    ...input,
    protocolKey,
    name: nonEmpty(input.name, "name"),
    supportedSymptomGroup: nonEmpty(input.supportedSymptomGroup, "supportedSymptomGroup"),
    displayLabel: nonEmpty(input.displayLabel, "displayLabel", 100),
    triggerTerms,
    requiredFields,
    conditionalQuestions,
    redFlagRules,
  };
}

export async function upsertPharmacyProtocol(
  tenantId: string,
  input: UpsertPharmacyProtocolInput
): Promise<PharmacyProtocolRow> {
  input = validatePharmacyProtocolInput(input);
  if (input.id) {
    const res = await query(
      `UPDATE bms_pharmacy_protocols
          SET name = $3, supported_symptom_group = $4, display_label = $5, trigger_terms = $6,
              required_fields = $7::jsonb, conditional_questions = $8::jsonb, red_flag_rules = $9::jsonb,
              completion_rules = $10::jsonb, escalation_rules = $11::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' AND enabled = FALSE
        RETURNING *`,
      [
        tenantId,
        input.id,
        input.name,
        input.supportedSymptomGroup,
        input.displayLabel,
        input.triggerTerms,
        JSON.stringify(input.requiredFields),
        JSON.stringify(input.conditionalQuestions),
        JSON.stringify(input.redFlagRules),
        JSON.stringify(input.completionRules),
        JSON.stringify(input.escalationRules),
      ]
    );
    if (!res.rowCount) throw new Error("แก้ไขได้เฉพาะ protocol สถานะ DRAFT ที่ยังไม่เปิดใช้");
    return mapRow(res.rows[0]);
  }
  const res = await query(
    `INSERT INTO bms_pharmacy_protocols
       (tenant_id, protocol_key, name, version, supported_symptom_group, display_label, trigger_terms,
        required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules,
        status, clinically_approved, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, 'DRAFT', FALSE, FALSE)
     RETURNING *`,
    [
      tenantId,
      input.protocolKey,
      input.name,
      input.version ?? 1,
      input.supportedSymptomGroup,
      input.displayLabel,
      input.triggerTerms,
      JSON.stringify(input.requiredFields),
      JSON.stringify(input.conditionalQuestions),
      JSON.stringify(input.redFlagRules),
      JSON.stringify(input.completionRules),
      JSON.stringify(input.escalationRules),
    ]
  );
  return mapRow(res.rows[0]);
}

/**
 * Enabling a protocol that hasn't been clinically approved is rejected
 * server-side — a pharmacist can review/toggle, but cannot flip a DRAFT
 * sample protocol "live" by accident. `clinically_approved` itself is not
 * settable through this function on purpose (see § MVP scope: no path sets
 * it true yet — that's a deliberate future review workflow, not this pass).
 */
export async function setPharmacyProtocolEnabled(
  tenantId: string,
  id: string,
  enabled: boolean
): Promise<PharmacyProtocolRow> {
  let current: PharmacyProtocolRow | null = null;
  if (enabled) {
    current = await getPharmacyProtocol(tenantId, id);
    if (!current) throw new Error("ไม่พบ protocol");
    if (!current.clinicallyApproved || current.status !== "APPROVED") {
      throw new Error("Protocol นี้ยังไม่ผ่านการรับรองทางคลินิก (clinically_approved=false) เปิดใช้งานไม่ได้");
    }
  }
  const res = enabled && current
    ? await query(
        `WITH disabled AS (
           UPDATE bms_pharmacy_protocols SET enabled = FALSE, updated_at = now()
            WHERE tenant_id = $1 AND protocol_key = $3 AND id <> $2
         )
         UPDATE bms_pharmacy_protocols SET enabled = TRUE, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, id, current.protocolKey]
      )
    : await query(
        `UPDATE bms_pharmacy_protocols SET enabled = FALSE, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [tenantId, id]
      );
  if (!res.rowCount) throw new Error("ไม่พบ protocol");
  return mapRow(res.rows[0]);
}

export async function submitPharmacyProtocolForReview(tenantId: string, id: string): Promise<PharmacyProtocolRow> {
  const current = await getPharmacyProtocol(tenantId, id);
  if (!current || current.status !== "DRAFT") throw new Error("ส่งตรวจได้เฉพาะ protocol สถานะ DRAFT");
  validatePharmacyProtocolInput({
    id: current.id,
    protocolKey: current.protocolKey,
    name: current.name,
    version: current.version,
    supportedSymptomGroup: current.supportedSymptomGroup,
    displayLabel: current.displayLabel,
    triggerTerms: current.triggerTerms,
    requiredFields: current.requiredFields,
    conditionalQuestions: current.conditionalQuestions,
    redFlagRules: current.redFlagRules,
    completionRules: current.completionRules,
    escalationRules: current.escalationRules,
  });
  const collision = await query<{ protocol_key: string }>(
    `SELECT protocol_key FROM bms_pharmacy_protocols
      WHERE tenant_id = $1 AND id <> $2 AND protocol_key <> $4 AND status <> 'RETIRED'
        AND trigger_terms && $3::text[] LIMIT 1`,
    [tenantId, id, current.triggerTerms, current.protocolKey]
  );
  if (collision.rows[0]) throw new Error(`triggerTerms ซ้ำกับ protocol: ${collision.rows[0].protocol_key}`);
  const res = await query(
    `UPDATE bms_pharmacy_protocols SET status = 'PENDING_REVIEW', enabled = FALSE, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' RETURNING *`,
    [tenantId, id]
  );
  if (!res.rowCount) throw new Error("ส่งตรวจได้เฉพาะ protocol สถานะ DRAFT");
  return mapRow(res.rows[0]);
}

export async function reviewPharmacyProtocol(
  tenantId: string,
  id: string,
  reviewerId: string,
  decision: "APPROVE" | "REJECT"
): Promise<PharmacyProtocolRow> {
  const licensed = await query<{ ok: boolean }>(
    `SELECT public.bms_is_licensed_pharmacist($1, $2) AS ok`,
    [tenantId, reviewerId]
  );
  if (licensed.rows[0]?.ok !== true) throw new Error("ผู้อนุมัติต้องเป็นเภสัชกรที่มีใบประกอบวิชาชีพ");
  const approved = decision === "APPROVE";
  const res = await query(
    `UPDATE bms_pharmacy_protocols
        SET status = $4, clinically_approved = $5, enabled = FALSE,
            reviewed_by = $3, reviewed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING_REVIEW'
      RETURNING *`,
    [tenantId, id, reviewerId, approved ? "APPROVED" : "DRAFT", approved]
  );
  if (!res.rowCount) throw new Error("ตรวจได้เฉพาะ protocol สถานะ PENDING_REVIEW");
  return mapRow(res.rows[0]);
}

export type PharmacyTriggerDefinition = { protocolKey: string; displayLabel: string; triggerTerms: string[] };

export async function listActivePharmacyTriggerDefinitions(tenantId: string): Promise<PharmacyTriggerDefinition[]> {
  const allowlist = new Set(enabledPharmacyProtocolKeys());
  if (allowlist.size === 0) return [];
  const res = await query(
    `SELECT protocol_key, display_label, trigger_terms FROM bms_pharmacy_protocols
      WHERE tenant_id = $1 AND enabled = TRUE AND clinically_approved = TRUE AND status = 'APPROVED'
      ORDER BY protocol_key`,
    [tenantId]
  );
  return res.rows
    .filter((row: any) => allowlist.has(String(row.protocol_key).toLowerCase()))
    .map((row: any) => ({ protocolKey: row.protocol_key, displayLabel: row.display_label, triggerTerms: row.trigger_terms ?? [] }));
}
