// =============================================================
// BMS AI config — ร้านตั้ง API key ของตัวเองได้ (BYOK) + ทดสอบ key
// (เข้ารหัส api_key เหมือน channel_secret ใน lib/bms/channels.ts)
// =============================================================

import { query } from "@/lib/db";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";

export const DEFAULT_AI_MODEL = "claude-haiku-4-5-20251001";

export type TenantAiConfig = { apiKey: string | null; model: string | null };

/** ดึง config (decrypted) — ใช้ฝั่ง server เท่านั้น (generateResponse/testTenantAiKey) */
export async function getTenantAiConfig(tenantId: string): Promise<TenantAiConfig | null> {
  const res = await query<any>(
    `SELECT api_key_encrypted, model FROM bms_tenant_ai_config WHERE tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return { apiKey: decryptSecret(r.api_key_encrypted), model: r.model };
}

/** ดึง config สำหรับ UI (mask key) */
export async function getTenantAiConfigMasked(tenantId: string) {
  const cfg = await getTenantAiConfig(tenantId);
  return {
    has_key: !!cfg?.apiKey,
    api_key_masked: maskSecret(cfg?.apiKey),
    model: cfg?.model ?? null,
  };
}

export async function setTenantAiKey(
  tenantId: string,
  input: { apiKey?: string | null; model?: string | null }
): Promise<boolean> {
  const cur = await query<any>(
    `SELECT api_key_encrypted, model FROM bms_tenant_ai_config WHERE tenant_id = $1`,
    [tenantId]
  );
  const prev = cur.rows[0];

  const hasNew = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const apiKey = hasNew(input.apiKey) ? encryptSecret(input.apiKey as string) : prev?.api_key_encrypted ?? null;
  const model = input.model !== undefined ? input.model : prev?.model ?? null;

  await query(
    `INSERT INTO bms_tenant_ai_config (tenant_id, api_key_encrypted, model)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       model             = EXCLUDED.model,
       updated_at        = now()`,
    [tenantId, apiKey, model]
  );
  return true;
}

export async function removeTenantAiKey(tenantId: string): Promise<boolean> {
  await query(`DELETE FROM bms_tenant_ai_config WHERE tenant_id = $1`, [tenantId]);
  return true;
}

export type TestAiKeyResult = { ok: boolean; message: string };

/** เช็ค key ด้วย GET /v1/models/{id} — ไม่เสียเงิน (ไม่ใช่ inference) */
export async function testAiKey(apiKey: string | null | undefined, model?: string | null): Promise<TestAiKeyResult> {
  if (!apiKey) return { ok: false, message: "ยังไม่ได้ตั้งค่า API Key — กรอกแล้วบันทึกก่อนทดสอบ" };
  const m = model || DEFAULT_AI_MODEL;
  try {
    const resp = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(m)}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (resp.ok) {
      const info = (await resp.json().catch(() => ({}))) as { display_name?: string };
      return { ok: true, message: `เชื่อมต่อสำเร็จ — model "${info.display_name || m}" ใช้งานได้` };
    }
    if (resp.status === 401) return { ok: false, message: "API Key ไม่ถูกต้องหรือถูกยกเลิกแล้ว" };
    if (resp.status === 404) return { ok: false, message: `ไม่พบ model "${m}" — ตรวจสอบชื่อ model อีกครั้ง` };
    const bodyText = await resp.text().catch(() => "");
    return { ok: false, message: `เชื่อมต่อไม่สำเร็จ (HTTP ${resp.status}) ${bodyText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, message: `เรียก Anthropic API ไม่สำเร็จ: ${e?.message || "unknown error"}` };
  }
}

export async function testTenantAiKey(tenantId: string): Promise<TestAiKeyResult> {
  const cfg = await getTenantAiConfig(tenantId);
  return testAiKey(cfg?.apiKey, cfg?.model);
}

export async function testPlatformAiKey(): Promise<TestAiKeyResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน .env" };
  return testAiKey(key, process.env.BMS_AI_MODEL);
}
