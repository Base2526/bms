// =============================================================
// BMS AI — Generate Response  (AI_WORKFLOW ขั้น 7)
// -------------------------------------------------------------
//   • ไม่มี ANTHROPIC_API_KEY  → template ภาษาไทย (mock, deterministic)
//   • มี ANTHROPIC_API_KEY     → Claude โดย "ยัดข้อเท็จจริงสต็อก" เข้า prompt
//
// กฎ (ตาม BUSINESS_RULES): ห้ามให้ AI เดา/แต่งตัวเลขสต็อก-ราคาเอง
// สต็อกมาจาก Backend API (checkStock) เสมอ AI แค่เรียบเรียงคำพูด
// =============================================================

import type { StockResult } from "./stock";

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

async function claude(message: string, res: StockResult): Promise<string> {
  const model = process.env.BMS_AI_MODEL || "claude-haiku-4-5-20251001";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
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
  message: string,
  res: StockResult
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return template(res);
  try {
    return await claude(message, res);
  } catch (err) {
    console.error("[BMS] Claude failed, fallback to template:", err);
    return template(res);
  }
}
