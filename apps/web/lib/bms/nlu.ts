// =============================================================
// BMS NLU — deterministic fallback parser
// -------------------------------------------------------------
// ทางหลักอยู่ที่ pipeline.ts → tools/runtime.ts: Claude เลือกและเรียก approved tools
// ไฟล์นี้จงใจคง rule-based understand() ไว้เฉพาะกรณีไม่มี AI credentials/โควตาหมด
// และเป็น deterministic helper ของ classify_intent เท่านั้น ไม่ใช่ NLU ทางหลักแล้ว
// =============================================================

import { findSize } from "./stock";
import { extractQty, parseRequestedItems } from "./requestedItems";

export type Intent = "CHECK_STOCK" | "CONFIRM_ORDER" | "GREETING" | "UNKNOWN";

export type OrderLine = {
  productText: string;
  size: string | null;
  qty: number | null;
  /**
   * The unit word the customer counted in ("แผง", "ขวด", …), or null when they
   * gave a bare number. This is a HINT for resolving a pack in
   * bms_product_packs — never a piece count. How many pieces a pack holds is
   * per-product data, so this string must not be turned into a multiplier.
   */
  unit: string | null;
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
  "อยากได้",
  "ต้องการ",
  "เปลี่ยนจำนวน",
  "เพิ่มเป็น",
  "ลดเหลือ",
];
const GREETING_HINTS = ["สวัสดี", "hello", "hi", "หวัดดี"];

/**
 * แยกหลายรายการต่อข้อความ — ตัวแยกจริงอยู่ที่ requestedItems.ts (โมดูลเดียวของทั้งระบบ)
 * ที่นี่แค่เติม `size` ซึ่งต้องใช้ findSize() จาก stock.ts เข้าไป
 *
 * เช่น "สั่ง Nike XL 2 ชิ้น กับ Adidas M 1 ชิ้น" → 2 รายการ
 * เช่น "อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด" → 3 รายการ (รายการที่ 3 qty = null)
 */
export function parseOrderItems(text: string): OrderLine[] {
  // ส่ง findSize เป็น salience test เพื่อคงพฤติกรรมเดิมของร้านเสื้อผ้า:
  // ข้อความที่ระบุไซซ์แต่ไม่ระบุจำนวนต้องยังแยกรายการได้เหมือนก่อน
  return parseRequestedItems(text, { isSalientSegment: (seg) => Boolean(findSize(seg)) }).map(
    (item) => ({
      productText: item.rawText,
      size: findSize(item.rawText),
      qty: item.qty,
      unit: item.unit,
    })
  );
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
