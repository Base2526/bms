import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "./tenant";
import type { AssessmentStatus } from "./pharmacy/stateMachine";

export const FAKE_PHARMACY_ASSESSMENT_MARKER = "FAKE-DEMO";
export const FAKE_PHARMACY_PROTOCOL_KEYS = ["headache", "cough", "diarrhea"] as const;

type FakePharmacyProtocolKey = (typeof FAKE_PHARMACY_PROTOCOL_KEYS)[number];

type FakeAssessmentScenario = {
  label: string;
  protocolKey: FakePharmacyProtocolKey;
  status: AssessmentStatus;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY" | "UNKNOWN";
  structuredAnswers: Record<string, unknown>;
  aiSummary: string | null;
  missingFields: string[];
  biologicalSex?: string;
  pregnancyStatus?: string;
  detectedRedFlags?: Array<Record<string, unknown>>;
  escalationReason?: string;
};

async function lockFakePharmacyAssessmentsInTx(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('bms.fake_pharmacy_assessments'), hashtext($1::text))`,
    [tenantId]
  );
}

export const FAKE_PHARMACY_ASSESSMENT_SCENARIOS: readonly FakeAssessmentScenario[] = [
  {
    label: "normal-complete",
    protocolKey: "headache",
    status: "WAITING_FOR_PHARMACIST",
    riskLevel: "LOW",
    structuredAnswers: {
      onset_days: 2,
      severity: 4,
      location: "ขมับซ้าย",
      has_fever: "NO",
      neck_stiffness: "NO",
      worst_ever: "NO",
      neuro_symptoms: "NO",
      recent_head_injury: "NO",
      allergies: "UNKNOWN",
      current_medications: "UNKNOWN",
    },
    aiSummary: "ลูกค้าปวดหัวบริเวณขมับซ้ายมา 2 วัน ความรุนแรงระดับ 4/10 ไม่พบสัญญาณอันตรายจากคำตอบ และยังไม่ทราบประวัติแพ้ยาหรือยาที่ใช้อยู่",
    missingFields: [],
  },
  {
    label: "incomplete",
    protocolKey: "cough",
    status: "COLLECTING_INFORMATION",
    riskLevel: "UNKNOWN",
    structuredAnswers: { duration_days: 5, sputum: "เสมหะขาว", has_fever: "NO" },
    aiSummary: null,
    missingFields: [
      "allergies",
      "current_medications",
      "blood_in_sputum",
      "breathing_difficulty",
      "chest_pain",
    ],
  },
  {
    label: "allergy-history",
    protocolKey: "diarrhea",
    status: "WAITING_FOR_PHARMACIST",
    riskLevel: "MODERATE",
    structuredAnswers: {
      duration_hours: 12,
      frequency_per_day: 4,
      hydration_status: "NO",
      blood_in_stool: "NO",
      high_fever: "NO",
      allergies: "Penicillin — เคยแพ้รุนแรง (anaphylaxis)",
      current_medications: "UNKNOWN",
    },
    aiSummary: "ลูกค้าถ่ายเหลว 12 ชั่วโมง 4 ครั้ง/วัน ไม่มีอาการขาดน้ำชัดเจน มีประวัติแพ้ยา Penicillin รุนแรง — ต้องระวังเป็นพิเศษ",
    missingFields: [],
  },
  {
    label: "high-risk-group",
    protocolKey: "headache",
    status: "PHARMACIST_REVIEWING",
    riskLevel: "MODERATE",
    biologicalSex: "FEMALE",
    pregnancyStatus: "YES",
    structuredAnswers: {
      onset_days: 1,
      severity: 6,
      location: "ท้ายศีรษะ",
      has_fever: "NO",
      neck_stiffness: "NO",
      worst_ever: "NO",
      neuro_symptoms: "NO",
      recent_head_injury: "NO",
      allergies: "UNKNOWN",
      current_medications: "วิตามินก่อนคลอด",
    },
    aiSummary: "ลูกค้าปวดหัวมา 1 วัน กำลังตั้งครรภ์ — กลุ่มเสี่ยงที่ต้องให้เภสัชกรพิจารณาเป็นพิเศษ ห้ามแนะนำยาทั่วไปโดยไม่ตรวจสอบ",
    missingFields: [],
  },
  {
    label: "emergency-red-flag",
    protocolKey: "headache",
    status: "EMERGENCY_REFERRAL",
    riskLevel: "EMERGENCY",
    structuredAnswers: { onset_days: 0, severity: 10, location: "ทั่วศีรษะ", neck_stiffness: "YES" },
    detectedRedFlags: [
      { code: "RF_HEADACHE_STIFF_NECK", label: "คอแข็ง ก้มหน้าไม่ได้", severity: "EMERGENCY" },
    ],
    escalationReason: "คอแข็ง ก้มหน้าไม่ได้",
    aiSummary: null,
    missingFields: [],
  },
];

/**
 * Migration 7.58 populated protocol samples only for tenants that existed when the migration ran.
 * Demo/test tenants are created later, so copy the latest repaired templates from the system tenant.
 * The copy deliberately resets every clinical workflow flag and can never become a live protocol.
 */
export async function ensureFakePharmacyProtocolsInTx(
  client: PoolClient,
  tenantId: string
): Promise<{ created: number; protocolIds: Record<FakePharmacyProtocolKey, string> }> {
  const inserted = await client.query<{ protocol_key: FakePharmacyProtocolKey }>(
    `WITH source AS (
       SELECT DISTINCT ON (protocol_key)
              protocol_key, name, supported_symptom_group, display_label, trigger_terms,
              required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules
         FROM bms_pharmacy_protocols
        WHERE tenant_id = $2 AND protocol_key = ANY($3::text[])
        ORDER BY protocol_key, version DESC
     )
     INSERT INTO bms_pharmacy_protocols
       (tenant_id, protocol_key, name, version, supported_symptom_group, display_label, trigger_terms,
        required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules,
        status, clinically_approved, enabled, reviewed_by, reviewed_at)
     SELECT $1, source.protocol_key, source.name, 1, source.supported_symptom_group,
            source.display_label, source.trigger_terms, source.required_fields, source.conditional_questions,
            source.red_flag_rules, source.completion_rules, source.escalation_rules,
            'DRAFT', FALSE, FALSE, NULL, NULL
       FROM source
      WHERE $1 <> $2
        AND NOT EXISTS (
          SELECT 1 FROM bms_pharmacy_protocols target
           WHERE target.tenant_id = $1 AND target.protocol_key = source.protocol_key
        )
     ON CONFLICT (tenant_id, protocol_key, version) DO NOTHING
     RETURNING protocol_key`,
    [tenantId, DEFAULT_TENANT_ID, [...FAKE_PHARMACY_PROTOCOL_KEYS]]
  );

  const protocols = await client.query<{ id: string; protocol_key: FakePharmacyProtocolKey }>(
    `SELECT DISTINCT ON (protocol_key) id, protocol_key
       FROM bms_pharmacy_protocols
      WHERE tenant_id = $1 AND protocol_key = ANY($2::text[])
      ORDER BY protocol_key, version DESC`,
    [tenantId, [...FAKE_PHARMACY_PROTOCOL_KEYS]]
  );
  const protocolIds = Object.fromEntries(protocols.rows.map((row) => [row.protocol_key, row.id])) as Partial<
    Record<FakePharmacyProtocolKey, string>
  >;
  const missing = FAKE_PHARMACY_PROTOCOL_KEYS.filter((key) => !protocolIds[key]);
  if (missing.length > 0) {
    throw new Error(`ไม่พบ pharmacy protocol template ในร้านระบบ: ${missing.join(", ")}`);
  }

  return {
    created: inserted.rowCount ?? 0,
    protocolIds: protocolIds as Record<FakePharmacyProtocolKey, string>,
  };
}

export async function seedFakePharmacyAssessments(
  tenantId: string
): Promise<{ created: string[]; labels: string[]; protocolsCreated: number }> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    // Two fast clicks must replace one another, not both observe an empty marker and create ten cases.
    await lockFakePharmacyAssessmentsInTx(client, tenantId);
    const { created: protocolsCreated, protocolIds } = await ensureFakePharmacyProtocolsInTx(client, tenantId);
    const pharmacist = await client.query<{ id: string }>(
      `SELECT u.id
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1
          AND r.name = 'Pharmacist'
          AND u.is_licensed_pharmacist
          AND NULLIF(btrim(u.pharmacist_license_no), '') IS NOT NULL
        ORDER BY u.created_at, u.id
        LIMIT 1`,
      [tenantId]
    );
    const pharmacistId = pharmacist.rows[0]?.id;
    if (!pharmacistId) {
      throw new Error("ร้านนี้ยังไม่มีผู้ใช้ role Pharmacist ที่ตั้งสถานะเภสัชกรและเลขใบอนุญาต");
    }

    // Replace this seed's own marker so retries are deterministic and never accumulate duplicate cases.
    await client.query(
      `DELETE FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND channel_id = $2`,
      [tenantId, FAKE_PHARMACY_ASSESSMENT_MARKER]
    );

    const created: string[] = [];
    for (const scenario of FAKE_PHARMACY_ASSESSMENT_SCENARIOS) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO bms_pharmacy_assessments
           (tenant_id, protocol_id, channel_id, patient_relationship, consent_status, consent_at, consent_version,
            status, risk_level, assigned_pharmacist_id, biological_sex, pregnancy_status, structured_answers, missing_fields,
            detected_red_flags, escalation_reason, ai_summary, ai_summary_version)
         VALUES
           ($1, $2, $3, 'SELF', 'GRANTED', now(), 'pharmacy-intake-v1',
            $4, $5, $6, $7, $8, $9::jsonb, $10,
            $11::jsonb, $12, $13, $14)
         RETURNING id`,
        [
          tenantId,
          protocolIds[scenario.protocolKey],
          FAKE_PHARMACY_ASSESSMENT_MARKER,
          scenario.status,
          scenario.riskLevel,
          scenario.status === "COLLECTING_INFORMATION" ? null : pharmacistId,
          scenario.biologicalSex ?? "UNKNOWN",
          scenario.pregnancyStatus ?? "UNKNOWN",
          JSON.stringify(scenario.structuredAnswers),
          scenario.missingFields,
          JSON.stringify(scenario.detectedRedFlags ?? []),
          scenario.escalationReason ?? null,
          scenario.aiSummary,
          scenario.aiSummary ? 1 : 0,
        ]
      );
      created.push(result.rows[0].id);
    }

    await client.query("COMMIT");
    return {
      created,
      labels: FAKE_PHARMACY_ASSESSMENT_SCENARIOS.map((scenario) => scenario.label),
      protocolsCreated,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteFakePharmacyAssessments(tenantId: string): Promise<number> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await lockFakePharmacyAssessmentsInTx(client, tenantId);
    const result = await client.query(
      `DELETE FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND channel_id = $2`,
      [tenantId, FAKE_PHARMACY_ASSESSMENT_MARKER]
    );
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
