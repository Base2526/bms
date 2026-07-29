// =============================================================
// BMS NLU — deterministic fallback parser
// -------------------------------------------------------------
// ทางหลักอยู่ที่ pipeline.ts → tools/runtime.ts: Claude เลือกและเรียก approved tools
// ไฟล์นี้จงใจคง rule-based understand() ไว้เฉพาะกรณีไม่มี AI credentials/โควตาหมด
// และเป็น deterministic helper ของ classify_intent เท่านั้น ไม่ใช่ NLU ทางหลักแล้ว
// =============================================================

import { findSize } from "./stock";

export type Intent = "CHECK_STOCK" | "CONFIRM_ORDER" | "GREETING" | "UNKNOWN";

export type OrderLine = {
  productText: string;
  size: string | null;
  qty: number | null;
};

export type Entities = {
  productText: string | null;
  size: string | null;
  qty: number | null;
  items: OrderLine[]; // แยกหลายรายการต่อข้อความ (เฉพาะ CONFIRM_ORDER)
};

export type Understanding = {
  intent: Intent;
  entities: Entities;
};

const STOCK_HINTS = ["มีไหม", "มีมั้ย", "เหลือ", "สต็อก", "stock", "ราคา", "ไซซ์", "size", "size?"];
const ORDER_HINTS = [
  "สั่ง",
  "ซื้อ",
  "จอง",
  "order",
  "เอา",
  "รับ",
  "ขอ",
  "เปลี่ยนจำนวน",
  "เพิ่มเป็น",
  "ลดเหลือ",
];
const GREETING_HINTS = ["สวัสดี", "hello", "hi", "หวัดดี"];

/** ดึงจำนวนจากข้อความ เช่น "2 ชิ้น", "x2", "จำนวน 3" → number */
function extractQty(text: string): number | null {
  const m =
    text.match(/(\d+)\s*(?:ชิ้น|คู่|อัน|ตัว|pcs?|pieces?)/i) ||
    text.match(/x\s*(\d+)/i) ||
    text.match(/จำนวน\s*(\d+)/i) ||
    text.match(
      /(?:ขอ|เอา|รับ|เปลี่ยน(?:จำนวน)?เป็น|เพิ่มเป็น|ลดเหลือ)\s*(\d+)\s*(?:แทน|พอ|นะ|ค่ะ|คะ|ครับ|$)/i
    );
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  const thaiNumber = text.match(
    /(?:ขอ|เอา|รับ|จำนวน)?\s*(หนึ่ง|นึง|สอง|สาม|สี่|ห้า)\s*(?:ชิ้น|คู่|อัน|ตัว|ชุด)/i
  )?.[1];
  if (!thaiNumber && /(?:ชิ้น|คู่|อัน|ตัว|ชุด)(?:หนึ่ง|นึง)(?:\s|$|ค่ะ|คะ|ครับ|นะ)/i.test(text)) {
    return 1;
  }
  return (
    {
      หนึ่ง: 1,
      นึง: 1,
      สอง: 2,
      สาม: 3,
      สี่: 4,
      ห้า: 5,
    } as Record<string, number | undefined>
  )[thaiNumber ?? ""] ?? null;
}

/**
 * แยกหลายรายการต่อข้อความ ตามคำเชื่อม (กับ / และ / , / +)
 * เช่น "สั่ง Nike XL 2 ชิ้น กับ Adidas M 1 ชิ้น" → 2 รายการ
 */
function parseOrderItems(text: string): OrderLine[] {
  const segments = text
    .split(/\s*(?:กับ|และ|แล้วก็|กะ|,|\+)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = segments.map((seg) => ({
    productText: seg,
    size: findSize(seg),
    qty: extractQty(seg),
  }));

  // ถ้าแยกแล้วไม่มี segment ที่มีทั้ง size+qty เลย ให้ถือทั้งข้อความเป็น 1 รายการ
  return items.some((it) => it.size || it.qty)
    ? items
    : [{ productText: text, size: findSize(text), qty: extractQty(text) }];
}

function detectIntent(text: string, qty: number | null): Intent {
  const t = text.toLowerCase();
  if (GREETING_HINTS.some((h) => t.includes(h))) return "GREETING";

  // สั่งซื้อ: มีคำสั่งซื้อ + ระบุจำนวน (ต้องมาก่อน CHECK_STOCK)
  if (ORDER_HINTS.some((h) => t.includes(h)) && qty !== null) return "CONFIRM_ORDER";

  // ถามสต็อก / ราคา / ไซซ์ หรือมีไซซ์ในข้อความ
  if (STOCK_HINTS.some((h) => t.includes(h)) || findSize(text)) return "CHECK_STOCK";

  // มีคำที่ดูเหมือนชื่อสินค้า
  if (/[a-zA-Zก-๙]{2,}/.test(text)) return "CHECK_STOCK";
  return "UNKNOWN";
}

export function understand(text: string): Understanding {
  const qty = extractQty(text);
  const intent = detectIntent(text, qty);
  return {
    intent,
    entities: {
      // ช่วง mock ส่งข้อความดิบให้ checkStock ไป match keyword เอง
      productText: text,
      size: findSize(text),
      qty,
      items: intent === "CONFIRM_ORDER" ? parseOrderItems(text) : [],
    },
  };
}
