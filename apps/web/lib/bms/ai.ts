// =============================================================
// BMS AI — Generate Response  (AI_WORKFLOW ขั้น 7)
// -------------------------------------------------------------
//   ลำดับ: 1) ร้านมี API key ตัวเอง (BYOK) → ใช้เลย ไม่ติด quota กลาง
//          2) ไม่มี key ตัวเอง แต่มี ANTHROPIC_API_KEY กลาง → เช็ค quota
//             รายเดือนของแพ็กเกจก่อน (bms_plans.max_ai_messages_month)
//          3) ไม่มี key เลย หรือเกิน quota → template ภาษาไทย (mock)
//
// กฎ (ตาม BUSINESS_RULES): ห้ามให้ AI เดา/แต่งตัวเลขสต็อก-ราคาเอง
// สต็อกมาจาก Backend API (checkStock) เสมอ AI แค่เรียบเรียงคำพูด
// =============================================================

import type { StockResult } from "./stock";
import { getTenantAiConfig, DEFAULT_AI_MODEL } from "./aiConfig";
import { tryConsumeAiQuota } from "./aiUsage";

function template(res: StockResult): string {
  switch (res.status) {
    case "IN_STOCK":
      return `มีค่ะ ✅ ${res.name} ไซซ์ ${res.size} พร้อมส่ง ${res.available} ชิ้น ราคา ${res.price.toLocaleString()} บาท สนใจสั่งเลยไหมคะ?`;
    case "OUT_OF_STOCK":
      return `ขออภัยค่ะ ${res.name} ไซซ์ ${res.size} ตอนนี้ของหมดค่ะ 🙏 รับไซซ์อื่นแทนได้ไหมคะ?`;
    case "SIZE_UNKNOWN": {
      const avail = res.sizes
        .filter((s) => s.available > 0)
        .map((s) => `${s.size} (${s.available})`)
        .join(", ");
      return `${res.name} ตอนนี้มีไซซ์: ${avail || "หมดทุกไซซ์ค่ะ"} รับไซซ์ไหนดีคะ?`;
    }
    case "NOT_FOUND":
    default:
      return `ขออภัยค่ะ ยังไม่พบสินค้าที่ต้องการ ลองพิมพ์ชื่อรุ่น เช่น "Nike XL มีไหม" ได้เลยค่ะ 😊`;
  }
}

function facts(res: StockResult): string {
  switch (res.status) {
    case "IN_STOCK":
      return `${res.name} ไซซ์ ${res.size} available=${res.available} ราคา=${res.price}`;
    case "OUT_OF_STOCK":
      return `${res.name} ไซซ์ ${res.size} available=0 (หมด)`;
    case "SIZE_UNKNOWN":
      return `${res.name} สต็อก: ${res.sizes.map((s) => `${s.size}=${s.available}`).join(", ")}`;
    default:
      return "ไม่พบสินค้าในระบบ";
  }
}

async function claude(apiKey: string, model: string, message: string, res: StockResult): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
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
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const json = (await resp.json()) as { content?: Array<{ text?: string }> };
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error("Claude empty reply");
  return text;
}

export async function generateResponse(
  tenantId: string,
  message: string,
  res: StockResult
): Promise<string> {
  // 1) ร้านตั้ง API key ของตัวเอง (BYOK) — ใช้ก่อนเสมอ ไม่ติด quota กลาง
  const own = await getTenantAiConfig(tenantId);
  if (own?.apiKey) {
    try {
      return await claude(own.apiKey, own.model || DEFAULT_AI_MODEL, message, res);
    } catch (err) {
      console.error("[BMS] Claude (tenant key) failed, fallback to template:", err);
      return template(res);
    }
  }

  // 2) shared key ของแพลตฟอร์ม — ต้องเช็ค quota รายเดือนก่อนเรียกจริง
  if (process.env.ANTHROPIC_API_KEY) {
    const withinQuota = await tryConsumeAiQuota(tenantId);
    if (withinQuota) {
      try {
        return await claude(
          process.env.ANTHROPIC_API_KEY,
          process.env.BMS_AI_MODEL || DEFAULT_AI_MODEL,
          message,
          res
        );
      } catch (err) {
        console.error("[BMS] Claude (shared key) failed, fallback to template:", err);
        return template(res);
      }
    }
  }

  // 3) ไม่มี key เลย หรือเกิน quota — template
  return template(res);
}
