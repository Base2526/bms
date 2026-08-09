import { query } from "@/lib/db";
import { recordPharmacyEvent } from "./events";
import { getActivePharmacyProtocolByKey, toProtocolDefinition } from "./protocols";
import { computeMissingFields, evaluateAnswer, type KnownFields, type ProtocolCondition } from "./ruleEngine";
import type { AssessmentStatus } from "./stateMachine";
import { buildCustomerConfirmationLinesFromAnswers } from "./customerConfirmation";

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

function conditionFieldKeys(condition: ProtocolCondition | undefined): string[] {
  if (!condition) return [];
  if ("allOf" in condition) return condition.allOf.flatMap(conditionFieldKeys);
  if ("anyOf" in condition) return condition.anyOf.flatMap(conditionFieldKeys);
  if ("not" in condition) return conditionFieldKeys(condition.not);
  return [condition.field];
}

export async function seedPharmacyQueueDemo(
  tenantId: string,
  requestedProtocolKey: string | null | undefined,
  requestedAnswers: Record<string, unknown> | null | undefined,
  requestedTranscript: Array<{ role?: unknown; text?: unknown; createdAt?: unknown }> | null | undefined,
  ctx?: any
): Promise<{ createdCount: number; assessmentIds: string[] }> {
  const desiredKeys = requestedProtocolKey ? [requestedProtocolKey] : ["headache", "cough", "diarrhea"];
  const protocol = (await Promise.all(desiredKeys.map((key) => getActivePharmacyProtocolByKey(tenantId, key)))).find(Boolean);
  if (!protocol) return { createdCount: 0, assessmentIds: [] };

  const protocolDef = toProtocolDefinition(protocol);
  const allowedKeys = new Set([
    ...protocolDef.requiredFields.map((field) => field.key),
    ...protocolDef.conditionalQuestions.map((field) => field.key),
    ...protocolDef.redFlagRules.flatMap((rule) => rule.field ? [rule.field] : conditionFieldKeys(rule.condition)),
    "patient_relationship",
    "patient_age_years",
    "biological_sex",
    "pregnancy_status",
    "breastfeeding_status",
  ]);
  const answers: KnownFields = {};
  for (const [key, value] of Object.entries(requestedAnswers ?? {})) {
    if (allowedKeys.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      if (key === "patient_relationship" && !["SELF", "CHILD", "PARENT", "OTHER"].includes(String(value))) continue;
      answers[key] = value;
    }
  }
  const hasRequestedScenario = requestedAnswers !== null && requestedAnswers !== undefined;
  const decision = hasRequestedScenario ? evaluateAnswer(protocolDef, answers) : null;
  const liveScenario: DemoScenario | null = decision
    ? {
        status: decision.decision === "RED_FLAG"
          ? decision.flag.action === "EMERGENCY_REFERRAL"
            ? "EMERGENCY_REFERRAL"
            : decision.flag.action === "URGENT_MEDICAL_REVIEW"
              ? "REFER_TO_DOCTOR"
              : "WAITING_FOR_PHARMACIST"
          : "WAITING_FOR_PHARMACIST",
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
  const assessmentIds: string[] = [];
  const transcriptPreview = rawMessages[rawMessages.length - 1]?.text || `Pharmacy lab ${protocol.protocolKey}`;
  for (const scenario of scenarios) {
    const missingFields = computeMissingFields(protocolDef, scenario.answers);
    const completenessStatus = missingFields.length === 0 ? "COMPLETE" : "INCOMPLETE";
    const customerConfirmationStatus =
      completenessStatus === "COMPLETE" && scenario.status === "WAITING_FOR_PHARMACIST"
        ? "CONFIRMED"
        : "NOT_REQUESTED";
    const confirmationLines = buildCustomerConfirmationLinesFromAnswers(scenario.answers);
    const customerConfirmationSummary = {
      protocolKey: protocol.protocolKey,
      symptomGroup: protocol.supportedSymptomGroup,
      lines: confirmationLines,
      summaryText: [
        `อาการหลัก: ${protocol.supportedSymptomGroup}`,
        ...confirmationLines.map((line) => `${line.label}: ${line.valueText}`),
      ].join("\n"),
      generatedAt: new Date().toISOString(),
    };
    const conversationRes = await query<{ id: string }>(
      `INSERT INTO bms_conversations
         (tenant_id, channel, customer_ref, customer_id, status, unread, last_message, last_message_at, last_sender_type)
       VALUES
         ($1, 'test', $2, NULL, 'OPEN', 0, $3, now(), $4)
       RETURNING id`,
      [
        tenantId,
        `pharmacy-lab:${protocol.protocolKey}:${Date.now()}:${created + 1}`,
        transcriptPreview.slice(0, 500),
        rawMessages[rawMessages.length - 1]?.role === "customer" ? "customer" : "ai",
      ]
    );
    const conversationId = conversationRes.rows[0]?.id ?? null;

    const result = await query<{ id: string; status: AssessmentStatus }>(
      `INSERT INTO bms_pharmacy_assessments
         (tenant_id, customer_id, channel_id, conversation_id, protocol_id, patient_relationship,
          status, risk_level, consent_status, consent_at, consent_version,
          patient_age_years, biological_sex, pregnancy_status, breastfeeding_status,
          structured_answers, raw_messages, missing_fields, detected_red_flags, escalation_reason,
          ai_summary, ai_summary_version, completeness_status, customer_confirmation_status,
          customer_confirmation_summary, customer_confirmed_at)
       VALUES
         ($1, NULL, 'TEST-LAB', $2, $3, $20,
          $4, $5, 'GRANTED', now(), 'assistant-test-mode',
          $6, $7, $8, $9,
          $10::jsonb, $11::jsonb, $12, $13::jsonb, $14, $15, $16, $17, $18,
          $19::jsonb, CASE WHEN $18 = 'CONFIRMED' THEN now() ELSE NULL END)
       RETURNING id, status`,
      [
        tenantId,
        conversationId,
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
        missingFields,
        JSON.stringify(scenario.redFlags ?? []),
        scenario.escalationReason ?? null,
        scenario.summary ?? null,
        scenario.summary ? 1 : 0,
        completenessStatus,
        customerConfirmationStatus,
        JSON.stringify(customerConfirmationSummary),
        ["SELF", "CHILD", "PARENT", "OTHER"].includes(String(scenario.answers.patient_relationship))
          ? String(scenario.answers.patient_relationship)
          : "UNKNOWN",
      ]
    );
    const row = result.rows[0];
    if (!row) continue;
    if (conversationId) {
      await query(
        `UPDATE bms_conversations
            SET pharmacy_intake_case_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, conversationId, row.id]
      );
      if (rawMessages.length > 0) {
        for (const entry of rawMessages) {
          await query(
            `INSERT INTO bms_messages (tenant_id, conversation_id, direction, body, sender, meta, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
            [
              tenantId,
              conversationId,
              entry.role === "customer" ? "IN" : "OUT",
              entry.text,
              entry.role === "customer" ? "customer" : "ai",
              JSON.stringify({ pharmacyIntakeLab: true, assessmentId: row.id }),
              entry.at,
            ]
          );
        }
      }
    }
    created += 1;
    assessmentIds.push(row.id);
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
  return { createdCount: created, assessmentIds };
}
