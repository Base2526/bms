import type { StockResult } from "./stock";
import type { CreateOrderResult } from "./orders";
import { renderConversationChoices, type ConversationChoiceOption } from "./conversationChoices";

export type CustomerStockMenu = { reply: string; options: ConversationChoiceOption[] };
export type CustomerStockItem = { sku: string; name: string; price: number };
export type CustomerOrderLine = { sku: string; size: string; qty: number; packCode?: string };

function menu(question: string, options: Omit<ConversationChoiceOption, "code">[], english: boolean): CustomerStockMenu {
  const numbered: ConversationChoiceOption[] = options.map((option, index) => ({ ...option, code: String(index + 1) }));
  numbered.push({ code: String(numbered.length + 1), value: "KEEP", label: english ? "Not now" : "ยังไม่เลือก" });
  return { reply: renderConversationChoices(question, numbered), options: numbered };
}

export function catalogStockMenu(products: CustomerStockItem[], english = false, heading?: string): CustomerStockMenu | null {
  const unique = products.filter((product, index) => products.findIndex(other => other.sku === product.sku) === index).slice(0, 8);
  if (!unique.length) return null;
  return menu(heading ?? (english ? "Choose a product to check:" : "เลือกสินค้าที่ต้องการตรวจสอบค่ะ"), unique.map(product => ({
    value: "INPUT", label: `${product.name} (${product.sku}) - ${product.price.toLocaleString(english ? "en-US" : "th-TH")} ${english ? "THB" : "บาท"}`,
    stockAction: { action: "CHECK", sku: product.sku },
  })), english);
}

/** Options come from verified variants, never from numbers parsed out of response prose. */
export function stockResultMenu(result: StockResult, english = false, restock = false, offset = 0, offerQuantity = true): CustomerStockMenu | null {
  if (offerQuantity && (result.status === "IN_STOCK" || result.status === "AVAILABLE_TO_ORDER")) {
    return menu(english ? `${result.name}, ${result.size}: ${result.price.toLocaleString("en-US")} THB.`
      : `${result.name} ไซซ์ ${result.size} ราคา ${result.price.toLocaleString()} บาทค่ะ`,
    [{ value: "INPUT", label: english ? "Enter quantity to review an order" : "ระบุจำนวนเพื่อดูสรุปออร์เดอร์",
      stockAction: { action: "CHECK", sku: result.sku, size: result.size } }], english);
  }
  const sizes = result.status === "MENU_SIZE_REQUIRED" ? result.sizes
    : result.status === "SIZE_UNKNOWN" ? result.sizes.filter(size => size.available > 0)
    : result.status === "OUT_OF_STOCK" ? (result.availableSizes ?? []).filter(size => size.available > 0) : [];
  if (sizes.length && "sku" in result) {
    const start = Number.isInteger(offset) && offset >= 0 && offset < sizes.length ? offset : 0;
    const page = sizes.slice(start, start + 7);
    const options: Omit<ConversationChoiceOption, "code">[] = page.map(size => ({
      value: "INPUT", label: size.size, stockAction: { action: "CHECK", sku: result.sku, size: size.size },
    }));
    if (sizes.length > 7) options.push({ value: "INPUT", label: english ? "More options" : "ตัวเลือกเพิ่มเติม",
      stockAction: { action: "CHECK", sku: result.sku, ...(result.status === "OUT_OF_STOCK" ? { size: result.size } : {}), offset: start + 7 < sizes.length ? start + 7 : 0 } });
    return menu(english ? `Choose an available option for ${result.name}:` : `เลือกตัวเลือกที่มีของ ${result.name} ค่ะ`, options, english);
  }
  if (result.status === "NOT_FOUND" || result.status === "OUT_OF_STOCK") {
    const alternatives = catalogStockMenu(result.alternatives ?? [], english,
      english ? "The requested option is unavailable. Choose a catalog item to check:" : "รายการที่ขอไม่พร้อมขาย เลือกสินค้าในแคตตาล็อกเพื่อตรวจสอบค่ะ");
    if (alternatives) return alternatives;
    if (result.status === "OUT_OF_STOCK" && restock) return menu(
      english ? `${result.name}, ${result.size} is out of stock. Request a restock notification?`
        : `${result.name} ไซซ์ ${result.size} หมด ต้องการฝากคำขอแจ้งเมื่อของเข้าหรือไม่คะ`,
      [{ value: "INPUT", label: english ? "Request a notification" : "ฝากคำขอแจ้งเมื่อของเข้า",
        stockAction: { action: "RESTOCK", sku: result.sku, size: result.size } }], english);
  }
  return null;
}

export function insufficientStockMenu(result: CreateOrderResult, items: CustomerOrderLine[], english = false): CustomerStockMenu | null {
  if (result.status !== "INSUFFICIENT") return null;
  const matches = items.filter(item => item.sku === result.sku && item.size === result.size);
  const options: Omit<ConversationChoiceOption, "code">[] = [];
  // available is in base units; never silently treat it as a pack count.
  if (matches.length === 1 && !matches[0].packCode && Number.isInteger(result.available) && result.available > 0 && result.available < matches[0].qty) {
    options.push({ value: "INPUT", label: english ? `Review basket with ${result.available} units` : `ดูสรุปใหม่โดยรับ ${result.available} ชิ้น`,
      stockAction: { action: "REVISE", items: items.map(item => item === matches[0] ? { ...item, qty: result.available } : { ...item }) } });
  }
  options.push({ value: "INPUT", label: english ? "Check other options" : "ตรวจตัวเลือกอื่น",
    stockAction: { action: "CHECK", sku: result.sku } });
  return menu(english ? `${result.sku}, ${result.size}: requested ${result.requested}, available ${result.available} base units. No order was placed.`
    : `${result.sku} ไซซ์ ${result.size} ขอ ${result.requested} มี ${result.available} หน่วยฐาน ยังไม่ได้สร้างออร์เดอร์ค่ะ`, options, english);
}
