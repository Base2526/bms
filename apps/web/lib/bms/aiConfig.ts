// =============================================================
// BMS AI config — ร้านตั้ง API key ของตัวเองได้ (BYOK) + ทดสอบ key
// (เข้ารหัส api_key เหมือน channel_secret ใน lib/bms/channels.ts)
// =============================================================

import { query } from "@/lib/db";
import {
  callAnthropicCompatibleMessages,
  DEFAULT_DEEPSEEK_MODEL,
  normalizeAiProvider,
  resolveSharedAiProvider,
  resolveTenantByokProvider,
  type AiProvider,
} from "./aiProvider";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";
import {
  DEFAULT_QWEN_BASE_URL,
  DEFAULT_QWEN_SLIP_MODEL,
} from "./slipReaders/qwen";
import {
  recordProviderError,
  recordProviderSuccess,
  setAiProviderStatus,
} from "./aiProviderHealth";
import {
  finalizeAiUsageEvent,
  recordAiProviderAttempt,
  recordByokAiUsage,
} from "./aiUsage";

export const DEFAULT_AI_MODEL = "claude-haiku-4-5-20251001";

export type TenantAiConfig = {
  apiKey: string | null;
  model: string | null;
  provider: AiProvider;
};

/** ดึง config (decrypted) — ใช้ฝั่ง server เท่านั้น (generateResponse/testTenantAiKey) */
export async function getTenantAiConfig(tenantId: string): Promise<TenantAiConfig | null> {
  const res = await query<any>(
    `SELECT api_key_encrypted, model, provider
       FROM bms_tenant_ai_config
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    apiKey: decryptSecret(r.api_key_encrypted),
    model: r.model,
    provider: normalizeAiProvider(r.provider) ?? "anthropic",
  };
}

/** ดึง config สำหรับ UI (mask key) */
export async function getTenantAiConfigMasked(tenantId: string) {
  const cfg = await getTenantAiConfig(tenantId);
  return {
    has_key: !!cfg?.apiKey,
    api_key_masked: maskSecret(cfg?.apiKey),
    model: cfg?.model ?? null,
    provider: cfg?.provider ?? "anthropic",
  };
}

export async function setTenantAiKey(
  tenantId: string,
  input: { apiKey?: string | null; model?: string | null; provider?: string | null }
): Promise<boolean> {
  const cur = await query<any>(
    `SELECT api_key_encrypted, model, provider
       FROM bms_tenant_ai_config
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const prev = cur.rows[0];

  const hasNew = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (input.provider != null && !normalizeAiProvider(input.provider)) {
    throw new Error("รองรับ AI provider เฉพาะ anthropic หรือ deepseek");
  }
  const provider = normalizeAiProvider(input.provider ?? prev?.provider) ?? "anthropic";
  const previousProvider = normalizeAiProvider(prev?.provider) ?? "anthropic";
  if (prev?.api_key_encrypted && provider !== previousProvider && !hasNew(input.apiKey)) {
    throw new Error("เมื่อเปลี่ยน AI provider ต้องกรอก API Key ของ provider ใหม่");
  }
  const apiKey = hasNew(input.apiKey) ? encryptSecret(input.apiKey as string) : prev?.api_key_encrypted ?? null;
  const model = input.model !== undefined ? input.model : prev?.model ?? null;

  await query(
    `INSERT INTO bms_tenant_ai_config (tenant_id, api_key_encrypted, model, provider)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE SET
       api_key_encrypted = EXCLUDED.api_key_encrypted,
       model             = EXCLUDED.model,
       provider          = EXCLUDED.provider,
       updated_at        = now()`,
    [tenantId, apiKey, model, provider]
  );
  return true;
}

export async function removeTenantAiKey(tenantId: string): Promise<boolean> {
  await query(`DELETE FROM bms_tenant_ai_config WHERE tenant_id = $1`, [tenantId]);
  return true;
}

export type TestAiKeyResult = { ok: boolean; message: string };
export type PlatformAiProvider = "anthropic" | "deepseek" | "qwen";
// Qwen OCR ปฏิเสธรูปที่ด้านใดด้านหนึ่ง <= 10px ("height/width must be larger than 10")
// จึงใช้ภาพเปล่า 16x16 แทนภาพ 1x1 เดิม
const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR42mP4TyJgGNUwqmH4agAAr639H23ooMoAAAAASUVORK5CYII=";

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
  if (!cfg?.apiKey) {
    return { ok: false, message: "ยังไม่ได้ตั้งค่า API Key — กรอกแล้วบันทึกก่อนทดสอบ" };
  }
  if (cfg.provider === "anthropic") return testAiKey(cfg.apiKey, cfg.model);

  const provider = resolveTenantByokProvider(
    cfg.apiKey,
    cfg.model || DEFAULT_DEEPSEEK_MODEL,
    cfg.provider
  );
  const usageEventId = await recordByokAiUsage(tenantId, {
    surface: "staff",
    feature: "ai_key_test",
    provider: provider.provider,
    model: provider.model,
    meta: {
      routing_reason: "byok_key_test",
      configured_provider: provider.provider,
      effective_provider: provider.provider,
      fallback_from: null,
    },
  });
  try {
    await recordAiProviderAttempt(usageEventId);
    const resp = await callAnthropicCompatibleMessages(provider, {
      model: provider.model,
      max_tokens: 1,
      system: "Reply with OK only.",
      messages: [{ role: "user", content: "OK" }],
    });
    if (!resp.ok) {
      await finalizeAiUsageEvent(usageEventId, {
        status: "failed",
        providerCalls: 1,
        errorMessage: `DeepSeek API ${resp.status}`,
      });
      return {
        ok: false,
        message: `เชื่อมต่อ DeepSeek ไม่สำเร็จ (HTTP ${resp.status})`,
      };
    }
    const payload = (await resp.json().catch(() => ({}))) as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    await finalizeAiUsageEvent(usageEventId, {
      status: "completed",
      providerCalls: 1,
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
    });
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ — DeepSeek model "${provider.model}" ใช้งานได้`,
    };
  } catch (e: any) {
    await finalizeAiUsageEvent(usageEventId, {
      status: "failed",
      providerCalls: 1,
      errorMessage: e?.message || "DeepSeek key test failed",
    });
    return {
      ok: false,
      message: `เรียก DeepSeek API ไม่สำเร็จ: ${e?.message || "unknown error"}`,
    };
  }
}

async function testAnthropicCompatibleSharedProvider(
  provider: "anthropic" | "deepseek"
): Promise<TestAiKeyResult> {
  const shared = resolveSharedAiProvider(provider, false);
  if (!shared) {
    const envKey =
      provider === "anthropic" ? "ANTHROPIC_API_KEY" : "DEEPSEEK_API_KEY";
    await setAiProviderStatus(
      provider,
      "chat",
      "unconfigured",
      `${envKey} is not configured`
    );
    return {
      ok: false,
      message: `ยังไม่ได้ตั้งค่า ${envKey} ใน .env`,
    };
  }
  if (shared.provider === "anthropic") {
    const result = await testAiKey(shared.apiKey, shared.model);
    if (result.ok) await recordProviderSuccess("anthropic", "chat");
    else await recordProviderError("anthropic", "chat", result.message);
    return result;
  }
  try {
    const resp = await callAnthropicCompatibleMessages(shared, {
      model: shared.model,
      max_tokens: 1,
      system: "Reply with OK only.",
      messages: [{ role: "user", content: "OK" }],
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      const message = `เชื่อมต่อ ${shared.provider} ไม่สำเร็จ (HTTP ${resp.status}) ${bodyText.slice(0, 200)}`;
      await recordProviderError("deepseek", "chat", `API ${resp.status} ${bodyText.slice(0, 200)}`);
      return { ok: false, message };
    }
    await recordProviderSuccess("deepseek", "chat");
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ — ${shared.provider} model "${shared.model}" ใช้งานได้`,
    };
  } catch (e: any) {
    await recordProviderError("deepseek", "chat", e?.message || "unknown error");
    return {
      ok: false,
      message: `เรียก ${shared.provider} API ไม่สำเร็จ: ${e?.message || "unknown error"}`,
    };
  }
}

async function testQwenOcrKey(): Promise<TestAiKeyResult> {
  const apiKey = process.env.QWEN_OCR_API_KEY;
  const model = process.env.QWEN_OCR_MODEL || DEFAULT_QWEN_SLIP_MODEL;
  const baseUrl = process.env.QWEN_OCR_BASE_URL || DEFAULT_QWEN_BASE_URL;
  if (!apiKey) {
    await setAiProviderStatus(
      "qwen",
      "ocr",
      "unconfigured",
      "QWEN_OCR_API_KEY is not configured"
    );
    return { ok: false, message: "ยังไม่ได้ตั้งค่า QWEN_OCR_API_KEY ใน .env" };
  }
  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        temperature: 0.01,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "ทดสอบการเชื่อมต่อ OCR เท่านั้น ให้ตอบ JSON รูปแบบนี้เท่านั้น " +
                  '{"amount":null,"date":null,"ref":null,"bank":null}',
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${BLANK_PNG_BASE64}`,
                },
                // ต้อง >= 3072 (ข้อจำกัดของ API) — ใช้ค่าเดียวกับ slipReaders/qwen.ts เพื่อให้ผลทดสอบ
                // สะท้อนพารามิเตอร์ที่ path การอ่านสลิปจริงใช้จริง
                min_pixels: 32 * 32 * 3,
                max_pixels: 32 * 32 * 8192,
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      await recordProviderError("qwen", "ocr", `API ${resp.status} ${bodyText.slice(0, 200)}`);
      return {
        ok: false,
        message: `เชื่อมต่อ qwen OCR ไม่สำเร็จ (HTTP ${resp.status}) ${bodyText.slice(0, 200)}`,
      };
    }
    await recordProviderSuccess("qwen", "ocr");
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ — qwen OCR model "${model}" ใช้งานได้`,
    };
  } catch (e: any) {
    await recordProviderError("qwen", "ocr", e?.message || "unknown error");
    return {
      ok: false,
      message: `เรียก qwen OCR API ไม่สำเร็จ: ${e?.message || "unknown error"}`,
    };
  }
}

async function testAnthropicOcrKey(): Promise<TestAiKeyResult> {
  const shared = resolveSharedAiProvider("anthropic", false);
  if (!shared) {
    await setAiProviderStatus("anthropic", "ocr", "unconfigured", "ANTHROPIC_API_KEY is not configured");
    return { ok: false, message: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน .env" };
  }
  try {
    const resp = await callAnthropicCompatibleMessages(shared, {
      model: shared.model,
      max_tokens: 8,
      system: "Reply with OK only.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: BLANK_PNG_BASE64,
              },
            },
            { type: "text", text: "This is an OCR connectivity check. Reply OK only." },
          ],
        },
      ],
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      await recordProviderError("anthropic", "ocr", `API ${resp.status} ${bodyText.slice(0, 200)}`);
      return {
        ok: false,
        message: `เชื่อมต่อ Anthropic OCR ไม่สำเร็จ (HTTP ${resp.status}) ${bodyText.slice(0, 200)}`,
      };
    }
    await recordProviderSuccess("anthropic", "ocr");
    return {
      ok: true,
      message: `เชื่อมต่อสำเร็จ — Anthropic OCR fallback model "${shared.model}" ใช้งานได้`,
    };
  } catch (e: any) {
    await recordProviderError("anthropic", "ocr", e?.message || "unknown error");
    return {
      ok: false,
      message: `เรียก Anthropic OCR API ไม่สำเร็จ: ${e?.message || "unknown error"}`,
    };
  }
}

export async function testPlatformAiKey(
  provider?: string | null
): Promise<TestAiKeyResult> {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "anthropic" || normalized === "deepseek") {
    return testAnthropicCompatibleSharedProvider(normalized);
  }
  if (provider?.trim().toLowerCase() === "qwen") {
    return testQwenOcrKey();
  }
  if (provider?.trim().toLowerCase() === "anthropic-ocr") {
    return testAnthropicOcrKey();
  }

  const shared = resolveSharedAiProvider();
  if (!shared) {
    return {
      ok: false,
      message:
        "ยังไม่ได้ตั้งค่า shared AI provider ใน .env (เช่น ANTHROPIC_API_KEY, DEEPSEEK_API_KEY หรือ QWEN_OCR_API_KEY)",
    };
  }
  return testAnthropicCompatibleSharedProvider(shared.provider);
}
