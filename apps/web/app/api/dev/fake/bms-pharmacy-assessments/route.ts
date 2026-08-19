// apps/web/app/api/dev/fake/bms-pharmacy-assessments/route.ts
// สร้างเคส AI Pharmacy Intake ตัวอย่าง 5 สถานการณ์ตามที่ระบุไว้ (ปกติ/ข้อมูลไม่ครบ/แพ้ยา/
// กลุ่มเสี่ยง/Red Flag ฉุกเฉิน) เพื่อทดสอบหน้า /admin/pharmacy-queue โดยไม่ต้องเดินสายแชทจริง
// marker: channel_id = 'FAKE-DEMO' → cleanup ลบได้ (bms_pharmacy_assessment_events cascade)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAKE_MARKER = "FAKE-DEMO";

async function protocolId(tenantId: string, protocolKey: string): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT id FROM bms_pharmacy_protocols WHERE tenant_id = $1 AND protocol_key = $2 ORDER BY version DESC LIMIT 1`,
    [tenantId, protocolKey]
  );
  return res.rows[0]?.id ?? null;
}

async function handlePOST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);

    const headacheId = await protocolId(tenantId, "headache");
    const coughId = await protocolId(tenantId, "cough");
    const diarrheaId = await protocolId(tenantId, "diarrhea");
    if (!headacheId || !coughId || !diarrheaId) {
      return NextResponse.json(
        { error: "ไม่พบ protocol ตัวอย่าง (headache/cough/diarrhea) — apply migration 7.58 ก่อน" },
        { status: 400 }
      );
    }

    const scenarios = [
      {
        label: "normal-complete",
        protocolId: headacheId,
        status: "WAITING_FOR_PHARMACIST",
        riskLevel: "LOW",
        structuredAnswers: { onset_days: 2, severity: 4, location: "ขมับซ้าย", allergies: "UNKNOWN", current_medications: "UNKNOWN" },
        aiSummary: "ลูกค้าปวดหัวบริเวณขมับซ้ายมา 2 วัน ความรุนแรงระดับ 4/10 ไม่มีประวัติแพ้ยา ไม่มียาที่ใช้อยู่",
        missingFields: [],
      },
      {
        label: "incomplete",
        protocolId: coughId,
        status: "COLLECTING_INFORMATION",
        riskLevel: "UNKNOWN",
        structuredAnswers: { duration_days: 5, sputum: "เสมหะขาว", has_fever: "NO" },
        aiSummary: null,
        missingFields: ["allergies", "current_medications"],
      },
      {
        label: "allergy-history",
        protocolId: diarrheaId,
        status: "WAITING_FOR_PHARMACIST",
        riskLevel: "MODERATE",
        structuredAnswers: {
          duration_hours: 12,
          frequency_per_day: 4,
          hydration_status: "NO",
          allergies: "Penicillin — เคยแพ้รุนแรง (anaphylaxis)",
          current_medications: "UNKNOWN",
        },
        aiSummary: "ลูกค้าถ่ายเหลว 12 ชั่วโมง 4 ครั้ง/วัน ไม่มีอาการขาดน้ำชัดเจน มีประวัติแพ้ยา Penicillin รุนแรง — ต้องระวังเป็นพิเศษ",
        missingFields: [],
      },
      {
        label: "high-risk-group",
        protocolId: headacheId,
        status: "PHARMACIST_REVIEWING",
        riskLevel: "MODERATE",
        biologicalSex: "FEMALE",
        pregnancyStatus: "YES",
        structuredAnswers: { onset_days: 1, severity: 6, location: "ท้ายศีรษะ", allergies: "UNKNOWN", current_medications: "วิตามินก่อนคลอด" },
        aiSummary: "ลูกค้าปวดหัวมา 1 วัน กำลังตั้งครรภ์ — กลุ่มเสี่ยงที่ต้องให้เภสัชกรพิจารณาเป็นพิเศษ ห้ามแนะนำยาทั่วไปโดยไม่ตรวจสอบ",
        missingFields: [],
      },
      {
        label: "emergency-red-flag",
        protocolId: headacheId,
        status: "EMERGENCY_REFERRAL",
        riskLevel: "EMERGENCY",
        structuredAnswers: { onset_days: 0, severity: 10, location: "ทั่วศีรษะ", neck_stiffness: "YES" },
        detectedRedFlags: [{ code: "RF_HEADACHE_STIFF_NECK", label: "คอแข็ง ก้มหน้าไม่ได้", severity: "EMERGENCY" }],
        escalationReason: "คอแข็ง ก้มหน้าไม่ได้",
        aiSummary: null,
        missingFields: [],
      },
    ];

    const created: string[] = [];
    for (const s of scenarios) {
      const res = await query<{ id: string }>(
        `INSERT INTO bms_pharmacy_assessments
           (tenant_id, protocol_id, channel_id, patient_relationship, consent_status, consent_at, consent_version,
            status, risk_level, biological_sex, pregnancy_status, structured_answers, missing_fields,
            detected_red_flags, escalation_reason, ai_summary, ai_summary_version)
         VALUES
           ($1, $2, $3, 'SELF', 'GRANTED', now(), 'pharmacy-intake-v1',
            $4, $5, $6, $7, $8::jsonb, $9,
            $10::jsonb, $11, $12, $13)
         RETURNING id`,
        [
          tenantId,
          s.protocolId,
          FAKE_MARKER,
          s.status,
          s.riskLevel,
          (s as any).biologicalSex ?? "UNKNOWN",
          (s as any).pregnancyStatus ?? "UNKNOWN",
          JSON.stringify(s.structuredAnswers),
          s.missingFields,
          JSON.stringify((s as any).detectedRedFlags ?? []),
          (s as any).escalationReason ?? null,
          s.aiSummary,
          s.aiSummary ? 1 : 0,
        ]
      );
      created.push(res.rows[0].id);
    }

    return NextResponse.json({ ok: true, created, summary: `สร้างเคสตัวอย่าง ${created.length} เคส (${scenarios.map((s) => s.label).join(", ")})` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

async function handleDELETE(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const res = await query(`DELETE FROM bms_pharmacy_assessments WHERE tenant_id = $1 AND channel_id = $2`, [tenantId, FAKE_MARKER]);
    return NextResponse.json({ ok: true, deleted: res.rowCount ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/dev/fake/bms-pharmacy-assessments", handlePOST);
export const DELETE = withRouteErrorLog("DELETE /api/dev/fake/bms-pharmacy-assessments", handleDELETE);
