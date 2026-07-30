// =============================================================
// BMS AI — Generate Response  (AI_WORKFLOW ขั้น 7)
// -------------------------------------------------------------
//   ลำดับ: 1) ร้านมี API key ตัวเอง (BYOK) → ใช้เลย ไม่ติด quota กลาง
//          2) ไม่มี key ตัวเอง → ใช้ shared provider ตาม env (DeepSeek/Anthropic) → เช็ค quota
//             รายเดือนของแพ็กเกจก่อน (bms_plans.max_ai_messages_month)
//          3) ไม่มี key เลย หรือเกิน quota → template ภาษาไทย (mock)
//
// กฎ (ตาม BUSINESS_RULES): ห้ามให้ AI เดา/แต่งตัวเลขสต็อก-ราคาเอง
// สต็อกมาจาก Backend API (checkStock) เสมอ AI แค่เรียบเรียงคำพูด
// =============================================================

import type { StockResult } from "./stock";
import { getTenantAiConfig } from "./aiConfig";
import { finalizeAiUsageEvent, recordAiFallback, recordByokAiUsage, tryConsumeAiQuota, type AiUsageContext } from "./aiUsage";
import {
  callAnthropicCompatibleMessages,
  isSensitiveAiRoutingContext,
  resolveSharedAiProviderDecision,
  resolveTenantByokProvider,
  type AiProvider,
} from "./aiProvider";

type AiReply = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

function template(res: StockResult): string {
  const alternatives = "alternatives" in res
    ? (res.alternatives ?? [])
        .slice(0, 3)
        .map((item) => `${item.name} ราคา ${item.price.toLocaleString()} บาท`)
        .join(", ")
    : "";
  switch (res.status) {
    case "IN_STOCK":
      return `มีค่ะ ✅ ${res.name} ไซซ์ ${res.size} พร้อมส่ง ${res.available} ชิ้น ราคา ${res.price.toLocaleString()} บาท สนใจสั่งเลยไหมคะ?`;
    case "OUT_OF_STOCK":
      if ((res.availableSizes?.length ?? 0) > 0) {
        return `ขออภัยค่ะ ${res.name} ไซซ์ ${res.size} ตอนนี้ของหมดค่ะ แต่ยังมีไซซ์ ${(res.availableSizes ?? [])
          .map((item) => item.size)
          .join(", ")} สนใจรับไซซ์อื่นไหมคะ?`;
      }
      return alternatives
        ? `ขออภัยค่ะ ${res.name} ไซซ์ ${res.size} ตอนนี้ของหมดค่ะ รุ่นที่พร้อมขายใกล้เคียงมี ${alternatives} สนใจตัวไหนให้เช็กไซซ์ต่อไหมคะ?`
        : `ขออภัยค่ะ ${res.name} ไซซ์ ${res.size} ตอนนี้ของหมดค่ะ 🙏 ต้องการให้แอดมินช่วยหาแบบใกล้เคียงไหมคะ?`;
    case "SIZE_UNKNOWN": {
      const avail = res.sizes
        .filter((s) => s.available > 0)
        .map((s) => `${s.size} (${s.available})`)
        .join(", ");
      return `${res.name} ตอนนี้มีไซซ์: ${avail || "หมดทุกไซซ์ค่ะ"} รับไซซ์ไหนดีคะ?`;
    }
    case "NOT_FOUND":
    default:
      return alternatives
        ? `ขออภัยค่ะ ยังไม่พบสินค้าที่ระบุ ตอนนี้ร้านมีสินค้าพร้อมขาย เช่น ${alternatives} สนใจตัวไหนให้เช็กไซซ์ต่อไหมคะ?`
        : `ขออภัยค่ะ ยังไม่พบสินค้าที่ต้องการ ลองระบุชื่อ รุ่น สี หรือหมวดสินค้าเพิ่มได้เลยค่ะ 😊`;
  }
}

function facts(res: StockResult): string {
  switch (res.status) {
    case "IN_STOCK":
      return `${res.name} ไซซ์ ${res.size} available=${res.available} ราคา=${res.price}`;
    case "OUT_OF_STOCK":
      return `${res.name} ไซซ์ ${res.size} available=0 (หมด); ไซซ์อื่นที่มี=${(res.availableSizes ?? [])
        .map((item) => `${item.size}:${item.available}`)
        .join(",") || "ไม่มี"}; สินค้าทดแทน=${(res.alternatives ?? [])
        .map((item) => `${item.name}:${item.price}`)
        .join(",") || "ไม่มี"}`;
    case "SIZE_UNKNOWN":
      return `${res.name} สต็อก: ${res.sizes.map((s) => `${s.size}=${s.available}`).join(", ")}`;
    default:
      return `ไม่พบสินค้าในระบบ; สินค้าพร้อมขายที่เสนอได้=${(res.alternatives ?? [])
        .map((item) => `${item.name}:${item.price}`)
        .join(",") || "ไม่มี"}`;
  }
}

async function generateAiReply(
  creds: AiCredentials,
  message: string,
  res: StockResult
): Promise<AiReply> {
  const resp = await callAnthropicCompatibleMessages(
    creds,
    {
      model: creds.model,
      max_tokens: 256,
      system:
        "คุณเป็นแอดมินร้านค้าออนไลน์ ตอบลูกค้าเป็นภาษาไทย สุภาพ กระชับ เป็นกันเอง " +
        "ใช้ข้อมูลสต็อกที่ให้เท่านั้น ห้ามเดา/แต่งตัวเลขสต็อกหรือราคาเอง " +
        "ถ้ามีของให้ชวนปิดการขาย ถ้าหมดให้เสนอไซซ์อื่น",
      messages: [
        {
          role: "user",
          content: `ข้อเท็จจริงสต็อก: ${facts(res)}\n\nลูกค้าถาม: "${message}"\n\nช่วยตอบลูกค้าให้หน่อยค่ะ`,
        },
      ],
    }
  );
  if (!resp.ok) throw new Error(`${creds.provider} API ${resp.status}`);
  const json = (await resp.json()) as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error(`${creds.provider} empty reply`);
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

export type AiCredentials = {
  apiKey: string;
  model: string;
  provider: AiProvider;
  baseUrl: string;
  /** byok = key ของร้าน (ไม่ติด quota) · shared = key กลาง (นับ quota ไปแล้ว 1 หน่วย) */
  source: "byok" | "shared";
  usageEventId?: string;
};

/**
 * เลือก credentials สำหรับเรียก AI: BYOK ของร้าน → shared routing policy → null
 * ยกเว้น sensitive DeepSeek BYOK ซึ่งให้ shared Anthropic baseline มีสิทธิ์ก่อน
 * เรียก "ครั้งเดียวต่อ 1 ข้อความลูกค้า" — shared key จะกิน quota 1 หน่วยตรงนี้ ไม่ใช่ต่อ tool-loop รอบ
 * reuse ได้ทั้ง generateResponse (fallback เดิม) และ tool-calling runtime (lib/bms/tools/runtime.ts)
 */
export async function resolveAiCredentials(tenantId: string, usageCtx?: AiUsageContext): Promise<AiCredentials | null> {
  // 1) ร้านตั้ง API key ของตัวเอง (BYOK) — ใช้ก่อนสำหรับงานทั่วไป;
  //    sensitive DeepSeek BYOK ให้ Anthropic baseline มีสิทธิ์ก่อน
  const own = await getTenantAiConfig(tenantId);
  const sensitive = isSensitiveAiRoutingContext(usageCtx);
  const useTenantByok = async (
    routingReason: "byok" | "byok_sensitive_fallback",
    configuredProvider = own?.provider ?? null,
    fallbackFrom: AiProvider | null = null
  ): Promise<AiCredentials | null> => {
    if (!own?.apiKey) return null;
    const byok = resolveTenantByokProvider(
      own.apiKey,
      own.model,
      own.provider
    );
    const eventId = await recordByokAiUsage(tenantId, {
      surface: usageCtx?.surface,
      feature: usageCtx?.feature,
      channel: usageCtx?.channel,
      provider: byok.provider,
      model: byok.model,
      meta: {
        ...(usageCtx?.meta ?? {}),
        routing_reason: routingReason,
        configured_provider: configuredProvider,
        effective_provider: byok.provider,
        fallback_from: fallbackFrom,
      },
    });
    return { ...byok, source: "byok", usageEventId: eventId };
  };
  if (own?.apiKey && (!sensitive || own.provider === "anthropic")) {
    return useTenantByok("byok");
  }

  // 2) shared provider ของแพลตฟอร์ม — งานทั่วไปใช้ BMS_AI_PROVIDER,
  //    งาน sensitive ใช้ BMS_AI_SENSITIVE_PROVIDER แล้ว fallback เฉพาะตอน provider ที่เลือกไม่มี key
  const decision = resolveSharedAiProviderDecision(usageCtx);
  const shared = decision.resolved;
  // ร้านเลือก DeepSeek BYOK แต่ request นี้ sensitivity สูง: ให้ Anthropic baseline มีสิทธิ์ก่อน
  // ถ้า Anthropic กลางไม่พร้อม ค่อยกลับมาใช้ key ของร้านแทน shared DeepSeek fallback.
  if (
    sensitive &&
    own?.apiKey &&
    own.provider === "deepseek" &&
    (!shared || decision.fallbackFrom === "anthropic")
  ) {
    return useTenantByok(
      "byok_sensitive_fallback",
      decision.configuredProvider,
      decision.configuredProvider
    );
  }
  if (shared) {
    const withinQuota = await tryConsumeAiQuota(tenantId, {
      surface: usageCtx?.surface,
      feature: usageCtx?.feature,
      channel: usageCtx?.channel,
      provider: shared.provider,
      model: shared.model,
      meta: {
        ...(usageCtx?.meta ?? {}),
        routing_reason: decision.routingReason,
        configured_provider: decision.configuredProvider,
        effective_provider: shared.provider,
        fallback_from: decision.fallbackFrom,
      },
    });
    if (withinQuota.ok) {
      return { ...shared, source: "shared", usageEventId: withinQuota.eventId };
    }
  }

  // 3) ไม่มี key เลย หรือเกิน quota
  if (!shared) {
    await recordAiFallback(tenantId, "no_credentials", usageCtx);
  }
  return null;
}

export async function generateResponse(
  tenantId: string,
  message: string,
  res: StockResult
): Promise<string> {
  const creds = await resolveAiCredentials(tenantId, {
    surface: "customer",
    feature: "stock_reply",
  });
  if (!creds) return template(res); // ไม่มี key เลย หรือเกิน quota — deterministic template

  try {
    const parsed = await generateAiReply(creds, message, res);
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: "completed",
        inputTokens: parsed.inputTokens ?? null,
        outputTokens: parsed.outputTokens ?? null,
      });
    }
    return parsed.text;
  } catch (err) {
    if (creds.usageEventId) {
      await finalizeAiUsageEvent(creds.usageEventId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : `${creds.provider} failed`,
      });
    }
    console.error(
      `[BMS] ${creds.provider} (${creds.source} key) failed, fallback to template:`,
      err
    );
    return template(res);
  }
}
