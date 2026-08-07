import { query } from "@/lib/db";
import { recordPharmacyEvent } from "./events";
import { getActivePharmacyProtocolByKey, toProtocolDefinition } from "./protocols";
import { computeMissingFields, evaluateAnswer, type KnownFields } from "./ruleEngine";
import type { AssessmentStatus } from "./stateMachine";

type DemoScenario = {
  status: AssessmentStatus;
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY";
  answers: Record<string, string | number | boolean>;
  redFlags?: Array<{ code: string; label: string; severity: "LOW" | "MODERATE" | "HIGH" | "EMERGENCY" }>;
  escalationReason?: string;
  summary?: string;
};

const DEMO_SCENARIOS: Record<string, DemoScenario[]> = {
  headache: [
    { status: "WAITING_FOR_PHARMACIST", riskLevel: "LOW", answers: { onset_days: 2, severity: 4, location: "ขมับซ้าย" }, summary: "ตัวอย่างเคสปวดหัวจากโหมดทดสอบ" },
    { status: "PHARMACIST_REVIEWING", riskLevel: "HIGH", answers: { onset_days: 1, severity: 8, location: "ท้ายทอย" }, summary: "ตัวอย่างเคสปวดหัวความเสี่ยงสูง" },
    { status: "EMERGENCY_REFERRAL", riskLevel: "EMERGENCY", answers: { onset_days: 0, severity: 10, neck_stiffness: "YES" }, redFlags: [{ code: "RF_HEADACHE_STIFF_NECK", label: "คอแข็ง ก้มหน้าไม่ได้", severity: "EMERGENCY" }], escalationReason: "คอแข็ง ก้มหน้าไม่ได้" },
  ],
  cough: [
    { status: "WAITING_FOR_PHARMACIST", riskLevel: "LOW", answers: { duration_days: 3, sputum: "ใส", has_fever: "NO" }, summary: "ตัวอย่างเคสไอจากโหมดทดสอบ" },
    { status: "PHARMACIST_REVIEWING", riskLevel: "HIGH", answers: { duration_days: 22, sputum: "เหลือง", has_fever: "YES" }, summary: "ตัวอย่างเคสไอเรื้อรัง" },
    { status: "EMERGENCY_REFERRAL", riskLevel: "EMERGENCY", answers: { duration_days: 1, blood_in_sputum: "YES" }, redFlags: [{ code: "RF_COUGH_BLOOD", label: "ไอมีเลือดปน", severity: "EMERGENCY" }], escalationReason: "ไอมีเลือดปน" },
  ],
  diarrhea: [
    { status: "WAITING_FOR_PHARMACIST", riskLevel: "LOW", answers: { duration_hours: 12, frequency_per_day: 3, hydration_status: "NO" }, summary: "ตัวอย่างเคสท้องเสียจากโหมดทดสอบ" },
    { status: "PHARMACIST_REVIEWING", riskLevel: "HIGH", answers: { duration_hours: 24, frequency_per_day: 7, hydration_status: "YES" }, summary: "ตัวอย่างเคสท้องเสียเสี่ยงขาดน้ำ" },
    { status: "EMERGENCY_REFERRAL", riskLevel: "EMERGENCY", answers: { duration_hours: 6, blood_in_stool: "YES" }, redFlags: [{ code: "RF_DIARRHEA_BLOOD", label: "ถ่ายมีเลือดปน", severity: "EMERGENCY" }], escalationReason: "ถ่ายมีเลือดปน" },
  ],
};

export async function seedPharmacyQueueDemo(
  tenantId: string,
  requestedProtocolKey: string | null | undefined,
  requestedAnswers: Record<string, unknown> | null | undefined,
  requestedTranscript: Array<{ role?: unknown; text?: unknown; createdAt?: unknown }> | null | undefined,
  ctx?: any
): Promise<number> {
  const desiredKeys = requestedProtocolKey ? [requestedProtocolKey] : ["headache", "cough", "diarrhea"];
  const protocol = (await Promise.all(desiredKeys.map((key) => getActivePharmacyProtocolByKey(tenantId, key)))).find(Boolean);
  if (!protocol) return 0;

  const protocolDef = toProtocolDefinition(protocol);
  const allowedKeys = new Set([
    ...protocolDef.requiredFields.map((field) => field.key),
    ...protocolDef.conditionalQuestions.map((field) => field.key),
    ...protocolDef.redFlagRules.map((rule) => rule.field),
    "patient_age_years",
    "biological_sex",
    "pregnancy_status",
    "breastfeeding_status",
  ]);
  const answers: KnownFields = {};
  for (const [key, value] of Object.entries(requestedAnswers ?? {})) {
    if (allowedKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      answers[key] = value;
    }
  }
  const decision = Object.keys(answers).length > 0 ? evaluateAnswer(protocolDef, answers) : null;
  const liveScenario: DemoScenario | null = decision
    ? {
        status: decision.decision === "RED_FLAG" ? "EMERGENCY_REFERRAL" : "WAITING_FOR_PHARMACIST",
        riskLevel: decision.decision === "RED_FLAG" ? decision.flag.severity : "LOW",
        answers: answers as Record<string, string | number | boolean>,
        redFlags:
          decision.decision === "RED_FLAG"
            ? [{ code: decision.flag.code, label: decision.flag.label, severity: decision.flag.severity }]
            : undefined,
        escalationReason: decision.decision === "RED_FLAG" ? decision.flag.label : undefined,
        summary: decision.decision === "RED_FLAG" ? undefined : "เคสจากบทสนทนา Pharmacy test mode",
      }
    : null;
  const rawMessages = Array.isArray(requestedTranscript)
    ? requestedTranscript
        .map((entry) => ({
          role:
            entry?.role === "user"
              ? "customer"
              : entry?.role === "assistant"
                ? "ai"
                : null,
          text: typeof entry?.text === "string" ? entry.text.trim() : "",
          at:
            typeof entry?.createdAt === "string" && entry.createdAt.trim()
              ? entry.createdAt
              : new Date().toISOString(),
        }))
        .filter((entry) => entry.role && entry.text)
    : [];
  const scenarios = liveScenario ? [liveScenario] : (DEMO_SCENARIOS[protocol.protocolKey] ?? DEMO_SCENARIOS.headache);
  let created = 0;
  for (const scenario of scenarios) {
    const result = await query<{ id: string; status: AssessmentStatus }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, customer_id, channel_id, conversation_id, protocol_id, patient_relationship,
          status, risk_level, consent_status, consent_at, consent_version,
          patient_age_years, biological_sex, pregnancy_status, breastfeeding_status,
          structured_answers, raw_messages, missing_fields, detected_red_flags, escalation_reason,
          ai_summary, ai_summary_version)
       VALUES
         ($1, NULL, 'FAKE-ASSISTANT', NULL, $2, 'SELF',
          $3, $4, 'GRANTED', now(), 'assistant-test-mode',
          $5, $6, $7, $8,
          $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, $14, $15)
       RETURNING id, status`,
      [
        tenantId,
        protocol.id,
        scenario.status,
        scenario.riskLevel,
        typeof scenario.answers.patient_age_years === "number" ? scenario.answers.patient_age_years : null,
        scenario.answers.biological_sex === "MALE" || scenario.answers.biological_sex === "FEMALE"
          ? scenario.answers.biological_sex
          : "UNKNOWN",
        scenario.answers.pregnancy_status === "YES" || scenario.answers.pregnancy_status === "NO"
          ? scenario.answers.pregnancy_status
          : "UNKNOWN",
        scenario.answers.breastfeeding_status === "YES" || scenario.answers.breastfeeding_status === "NO"
          ? scenario.answers.breastfeeding_status
          : "UNKNOWN",
        JSON.stringify(scenario.answers),
        JSON.stringify(rawMessages),
        computeMissingFields(protocolDef, scenario.answers),
        JSON.stringify(scenario.redFlags ?? []),
        scenario.escalationReason ?? null,
        scenario.summary ?? null,
        scenario.summary ? 1 : 0,
      ]
    );
    const row = result.rows[0];
    if (!row) continue;
    created += 1;
    await recordPharmacyEvent({
      tenantId,
      assessmentId: row.id,
      actor: "staff:assistant-test",
      action: "assessment.created",
      nextState: row.status,
      meta: { protocolKey: protocol.protocolKey, assistantTest: true, seeded: true },
      ctx,
    });
  }
  return created;
}
