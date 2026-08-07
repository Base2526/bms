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
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  redFlagRules: ProtocolRedFlagRule[];
  completionRules: ProtocolCompletionRules;
  escalationRules: ProtocolEscalationRules;
  status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "RETIRED";
  clinicallyApproved: boolean;
  enabled: boolean;
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
    requiredFields: r.required_fields ?? [],
    conditionalQuestions: r.conditional_questions ?? [],
    redFlagRules: r.red_flag_rules ?? [],
    completionRules: r.completion_rules ?? { requireAllOf: [] },
    escalationRules: r.escalation_rules ?? {},
    status: r.status,
    clinicallyApproved: r.clinically_approved,
    enabled: r.enabled,
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
    `SELECT DISTINCT protocol_key FROM bms_pharmacy_protocols WHERE tenant_id = $1 AND enabled = TRUE`,
    [tenantId]
  );
  return res.rows.map((r) => r.protocol_key).filter((key) => allowlist.has(key));
}

export type UpsertPharmacyProtocolInput = {
  id?: string;
  protocolKey: string;
  name: string;
  version?: number;
  supportedSymptomGroup: string;
  requiredFields: ProtocolFieldDef[];
  conditionalQuestions: ProtocolConditionalQuestion[];
  redFlagRules: ProtocolRedFlagRule[];
  completionRules: ProtocolCompletionRules;
  escalationRules: ProtocolEscalationRules;
};

export async function upsertPharmacyProtocol(
  tenantId: string,
  input: UpsertPharmacyProtocolInput
): Promise<PharmacyProtocolRow> {
  if (input.id) {
    const res = await query(
      `UPDATE bms_pharmacy_protocols
          SET name = $3, supported_symptom_group = $4, required_fields = $5::jsonb,
              conditional_questions = $6::jsonb, red_flag_rules = $7::jsonb,
              completion_rules = $8::jsonb, escalation_rules = $9::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [
        tenantId,
        input.id,
        input.name,
        input.supportedSymptomGroup,
        JSON.stringify(input.requiredFields),
        JSON.stringify(input.conditionalQuestions),
        JSON.stringify(input.redFlagRules),
        JSON.stringify(input.completionRules),
        JSON.stringify(input.escalationRules),
      ]
    );
    if (!res.rowCount) throw new Error("ไม่พบ protocol ที่จะแก้ไข");
    return mapRow(res.rows[0]);
  }
  const res = await query(
    `INSERT INTO bms_pharmacy_protocols
       (tenant_id, protocol_key, name, version, supported_symptom_group,
        required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules,
        status, clinically_approved, enabled)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 'DRAFT', FALSE, FALSE)
     RETURNING *`,
    [
      tenantId,
      input.protocolKey,
      input.name,
      input.version ?? 1,
      input.supportedSymptomGroup,
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
  if (enabled) {
    const current = await getPharmacyProtocol(tenantId, id);
    if (!current) throw new Error("ไม่พบ protocol");
    if (!current.clinicallyApproved) {
      throw new Error("Protocol นี้ยังไม่ผ่านการรับรองทางคลินิก (clinically_approved=false) เปิดใช้งานไม่ได้");
    }
  }
  const res = await query(
    `UPDATE bms_pharmacy_protocols SET enabled = $3, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, enabled]
  );
  if (!res.rowCount) throw new Error("ไม่พบ protocol");
  return mapRow(res.rows[0]);
}
