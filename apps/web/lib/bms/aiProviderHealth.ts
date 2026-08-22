// =============================================================
// BMS AI Provider Health — สถานะเชื่อมต่อจริงของ shared AI provider
// (Anthropic/DeepSeek/Qwen OCR) — platform-wide ไม่ผูก tenant
// -------------------------------------------------------------
// เจตนาเดียวกับ channelHealth.ts แต่สำหรับ provider กลางแทนช่องทางแชท:
//   active/configured = มี key ตั้งไว้ใน env
//   status            = เชื่อมต่อได้จริงหลังตั้งค่าแล้ว (token หมดอายุ/rate limit/
//                        error อื่น) — คำนวณจาก error จริงที่เจอตอนเรียก provider
//                        เท่านั้น ไม่เดา, ไม่ track BYOK ของแต่ละร้าน (นั่นเป็นความ
//                        รับผิดชอบของร้านเอง ไม่ใช่ของแพลตฟอร์ม)
//
// เขียนผ่าน setAiProviderStatus() เท่านั้น (single entrypoint) — กัน log กระจาย
// ไม่ตรงกับ status จริงบนตาราง และกัน spam log ซ้ำถ้า status ไม่เปลี่ยน
//
// wire เข้าจุดจริงแล้ว (ดู docs/local-notes-archive.md § AI Provider Health):
//   - ทุก shared-provider call จริงที่จบงาน (finalizeAiUsageEvent ใน aiUsage.ts)
//     → recordProviderSuccess()/recordProviderError() อัตโนมัติ (ครอบคลุมทั้ง
//       ai.ts generateResponse, tools/runtime.ts tool loop, payments.ts slip OCR)
//   - ปุ่ม "ทดสอบ"/"ตรวจสอบทั้งหมดตอนนี้" ในหน้า /admin/env (testPlatformAiKey()/
//     bmsCheckAllAiProviderHealth ใน aiConfig.ts — ทั้งคู่เขียนผลลง status จริง)
//   - cron ทดสอบเป็นระยะ POST /api/bms/ai/check-health (เรียก testPlatformAiKey()
//     ตรงๆ ต่อ provider เหมือนปุ่มด้านบน ไม่มีฟังก์ชันแยกชื่อ checkAiProviderHealthNow())
//
// status 'connected' ที่ไม่ถูกเช็คมานาน (last_checked_at เกิน BMS_AI_HEALTH_STALE_MINUTES,
// default 60 นาที) จะถูก derive เป็น 'stale' ตอนอ่านใน listAiProviderHealth() เท่านั้น —
// คอลัมน์ status ในตารางจริงไม่เคยเก็บค่า 'stale' เลย (ดู CHECK constraint ใน 7.34)
// =============================================================

import { query } from "@/lib/db";

export type AiProviderName = "anthropic" | "deepseek" | "qwen";
export type AiProviderPurpose = "chat" | "ocr";
export type AiProviderHealthStatus =
  | "connected"
  | "token_expired"
  | "rate_limited"
  | "send_failed"
  | "stale"
  | "unconfigured";

export type AiProviderHealth = {
  provider: AiProviderName;
  purpose: AiProviderPurpose;
  status: AiProviderHealthStatus;
  status_detail: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  last_checked_at: string | null;
};

/**
 * ตั้ง status ใหม่ — เขียน log เฉพาะตอน status เปลี่ยนจริง (กัน spam ทุก request)
 */
export async function setAiProviderStatus(
  provider: AiProviderName,
  purpose: AiProviderPurpose,
  status: AiProviderHealthStatus,
  detail?: string | null
): Promise<void> {
  const cur = await query<{ status: AiProviderHealthStatus }>(
    `SELECT status FROM bms_ai_provider_health WHERE provider = $1 AND purpose = $2`,
    [provider, purpose]
  );
  const prevStatus = cur.rows[0]?.status;

  await query(
    `INSERT INTO bms_ai_provider_health (provider, purpose, status, status_detail, last_checked_at, last_error_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), CASE WHEN $3 <> 'connected' THEN now() ELSE NULL END, now())
     ON CONFLICT (provider, purpose) DO UPDATE SET
       status = $3,
       status_detail = $4,
       last_checked_at = now(),
       last_error_at = CASE WHEN $3 <> 'connected' THEN now() ELSE bms_ai_provider_health.last_error_at END,
       updated_at = now()`,
    [provider, purpose, status, detail ?? null]
  );

  if (prevStatus !== undefined && prevStatus !== status) {
    await query(
      `INSERT INTO bms_ai_provider_health_log (provider, purpose, status, detail) VALUES ($1, $2, $3, $4)`,
      [provider, purpose, status, detail ?? null]
    );
  }
}

/** เรียก provider สำเร็จ — เคลียร์ token_expired/rate_limited/send_failed กลับเป็นปกติ */
export async function recordProviderSuccess(
  provider: AiProviderName,
  purpose: AiProviderPurpose
): Promise<void> {
  await query(
    `UPDATE bms_ai_provider_health SET last_success_at = now() WHERE provider = $1 AND purpose = $2`,
    [provider, purpose]
  );
  await setAiProviderStatus(provider, purpose, "connected", null);
}

/** ดึง HTTP status จาก error message ที่มีรูปแบบ "... API 401" หรือ "... (HTTP 429)" */
function extractHttpStatus(message: string | null | undefined): number | null {
  if (!message) return null;
  const m = message.match(/(?:API|HTTP)[^\d]{0,10}(\d{3})\b/i);
  return m ? Number(m[1]) : null;
}

/** เรียก provider แล้วโดน error — map httpStatus (ถ้าแกะได้จาก message) เป็น status ที่เหมาะสม */
export async function recordProviderError(
  provider: AiProviderName,
  purpose: AiProviderPurpose,
  message?: string | null
): Promise<void> {
  const httpStatus = extractHttpStatus(message);
  const status: AiProviderHealthStatus =
    httpStatus === 401 || httpStatus === 403
      ? "token_expired"
      : httpStatus === 429
        ? "rate_limited"
        : "send_failed";
  await setAiProviderStatus(provider, purpose, status, message ?? "unspecified error");
}

function toISO(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function staleAfterMinutes(): number {
  const value = Number(process.env.BMS_AI_HEALTH_STALE_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

function isStale(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return true;
  const checkedAt = new Date(lastCheckedAt).getTime();
  return (
    !Number.isFinite(checkedAt) ||
    Date.now() - checkedAt > staleAfterMinutes() * 60_000
  );
}

/**
 * list สถานะทุก provider/purpose — เรียกตรงจาก page.tsx (server component) และจาก
 * GraphQL resolver (bmsAiProviderHealth) ทั้งคู่ จึงแปลง timestamp เป็น ISO string ที่นี่
 * ที่เดียว (pg คืน Date object ซึ่งข้าม RSC boundary ได้ แต่ GraphQL field เป็น String!)
 */
export async function listAiProviderHealth(): Promise<AiProviderHealth[]> {
  const res = await query<AiProviderHealth>(
    `SELECT provider, purpose, status, status_detail, last_error_at, last_success_at, last_checked_at
       FROM bms_ai_provider_health ORDER BY provider, purpose`
  );
  return res.rows.map((r) => {
    const lastCheckedAt = toISO(r.last_checked_at);
    const stale = r.status === "connected" && isStale(lastCheckedAt);
    return {
      ...r,
      status: stale ? "stale" : r.status,
      status_detail: stale
        ? `ผลตรวจเก่ากว่า ${staleAfterMinutes()} นาที — กรุณาตรวจใหม่`
        : r.status_detail,
      last_error_at: toISO(r.last_error_at),
      last_success_at: toISO(r.last_success_at),
      last_checked_at: lastCheckedAt,
    };
  });
}

/** จำนวน provider/purpose ที่ configured แล้วแต่สถานะไม่ปกติ — ใช้กับ badge sidebar */
export async function countUnhealthyAiProviders(): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)
       FROM bms_ai_provider_health
      WHERE status NOT IN ('connected', 'unconfigured')
         OR (
           status = 'connected'
           AND (
             last_checked_at IS NULL
             OR last_checked_at < now() - ($1::text || ' minutes')::interval
           )
         )`,
    [staleAfterMinutes()]
  );
  return Number(res.rows[0]?.count ?? 0);
}
