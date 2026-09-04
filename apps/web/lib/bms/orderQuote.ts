// =============================================================
// BMS order quote — สรุปรายการให้ลูกค้ายืนยันก่อนสร้างบิล
// -------------------------------------------------------------
// **โมดูลนี้ไม่ import อะไรเลย** เหตุผลเดียวกับ loyaltyMath.ts / requestedItems.ts:
// ลายนิ้วมือของตะกร้าต้องคิดได้เหมือนกันเป๊ะทั้งใน tool (catalog.ts) และใน pipeline
// ถ้าสองฝั่งคิดต่างกัน ลูกค้าจะกดยืนยันแล้วถูกถามซ้ำไม่จบ
//
// ทำไมต้องมีขั้นยืนยัน: ก่อนหน้านี้ "ให้ลูกค้ายืนยันก่อนสั่ง" เป็นแค่ข้อความใน
// description ของทูล create_order ไม่มีอะไรบังคับ โมเดลจึงสร้างบิลได้ทันทีที่มันคิดว่า
// ข้อมูลครบ ลูกค้าอาจไม่เคยเห็นรายการทั้งชุดเลยก่อนที่สต็อกจะถูกจอง
//
// สิ่งที่โมดูลนี้ **ไม่** ทำ:
//   * ไม่คิดยอดสุทธิ ส่วนลด ค่าส่ง แต้ม หรือโปรโมชัน — เลขเหล่านั้นมีเจ้าของอยู่แล้วใน
//     createOrder (+ 8.1 price tiers, 8.7 promotions, coupons, loyalty) การคิดซ้ำที่นี่
//     คือการสร้างสูตรที่สองสำหรับเงิน ซึ่งจะ drift แล้วลูกค้าเห็นเลขไม่ตรงกับที่เก็บจริง
//     ยอดจริงมาจาก orderCheckoutChatReply หลังบิลถูกสร้างเสมอ
//   * ไม่เลือกสินค้า ไม่เลือกหน่วยขาย ไม่เติมจำนวน — รับมาเป็นข้อมูลที่ resolve แล้วเท่านั้น
// =============================================================

export type OrderQuoteLine = {
  sku: string;
  /** ชื่อสินค้าที่ลูกค้าอ่านรู้เรื่อง — SKU เพียว ๆ ลูกค้าตรวจไม่ได้ว่าถูกตัวไหม */
  name: string;
  size: string;
  /** จำนวนหน่วยขายที่ลูกค้าขอ (ถ้าขายยกแผง/กล่อง) ไม่ใช่จำนวนหน่วยฐาน */
  displayQty: number;
  /** "แผง" / "กล่อง" — เว้นไว้เมื่อขายเป็นหน่วยฐาน */
  packUnitName?: string | null;
  /** ราคาต่อหนึ่งหน่วยที่แสดง (ราคาป้าย ไม่ใช่ราคาหลังส่วนลด) · null = ยังไม่รู้ */
  unitPrice?: number | null;
  /** ตัวเลือกที่ฝั่ง server resolve แล้ว เพื่อให้ลูกค้าเห็นสิ่งที่จะเข้าครัวจริง */
  modifiers?: Array<{ code: string; name: string; priceDelta: number }>;
};

export type OrderQuoteFingerprintLine = {
  sku: string;
  size: string;
  qty: number;
  packCode?: string | null;
  modifierCodes?: string[] | null;
};

/**
 * ลายนิ้วมือของ "ตะกร้าชุดนี้เป๊ะ ๆ"
 *
 * ใช้ผูกคำว่า "ยืนยัน" ของลูกค้าไว้กับรายการที่ลูกค้า **เห็น** จริง ๆ ถ้าโมเดลเปลี่ยนจำนวน
 * เปลี่ยนหน่วยขาย หรือแอบเพิ่มรายการหลังจากที่ลูกค้ายืนยันแล้ว ลายนิ้วมือจะไม่ตรงและบิลจะ
 * ไม่ถูกสร้าง — ต้องกลับไปให้ลูกค้ายืนยันชุดใหม่
 *
 * เรียงรายการก่อน hash เพราะลำดับที่โมเดลส่งมาไม่ใช่ข้อมูล (ตะกร้าเดียวกันสลับบรรทัดได้)
 * แต่จำนวนและหน่วยขายคือข้อมูล จึงอยู่ในลายนิ้วมือทั้งคู่
 */
export function orderQuoteFingerprint(lines: OrderQuoteFingerprintLine[]): string {
  const normalized = lines
    .map((line) =>
      [
        String(line.sku ?? "").trim().toUpperCase(),
        String(line.size ?? "").trim().toUpperCase(),
        String(Number(line.qty) || 0),
        String(line.packCode ?? "").trim().toUpperCase(),
        Array.from(new Set((line.modifierCodes ?? []).map((code) =>
          String(code).trim().toUpperCase()
        ).filter(Boolean))).sort().join(","),
      ].join("|")
    )
    .sort();
  return normalized.join("~");
}

function formatMoney(value: number, english: boolean): string {
  return value.toLocaleString(english ? "en-US" : "th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * ประกอบข้อความสรุปรายการ **ฝั่ง server** ไม่ใช่ให้โมเดลเขียน
 *
 * สองเหตุผล ไม่ใช่เหตุผลเดียว:
 *   1. โมเดลตัดรายการทิ้งหรือเขียนจำนวนผิดไม่ได้ ถ้าข้อความไม่ได้ออกจากปากมัน
 *   2. output ของโมเดลสั้นลงมาก — ซึ่งสำคัญ เพราะการบังคับ "ลิสต์ทุกรายการทุกครั้ง"
 *      ถ้าให้โมเดลเขียนเอง จะไปชนเพดาน max_tokens แล้วเทิร์นนั้นพังทั้งเทิร์น
 *      (เคสจริง 2026-08-19) ยิ่งบิลใหญ่ยิ่งพังบ่อย ซึ่งกลับหัวกลับหางกับที่ควรเป็น
 */
export function composeOrderQuoteSummary(
  lines: OrderQuoteLine[],
  language: "th" | "en" = "th"
): string {
  const english = language === "en";
  const itemLines = lines.map((line) => {
    const unit = line.packUnitName ? ` ${line.packUnitName}` : "";
    const head = english
      ? `• ${line.name}, size ${line.size} × ${line.displayQty}${unit}`
      : `• ${line.name} ไซซ์ ${line.size} × ${line.displayQty}${unit}`;
    const modifierText = (line.modifiers ?? []).length
      ? ` (${(line.modifiers ?? []).map((modifier) => modifier.name).join(", ")})`
      : "";
    const describedHead = `${head}${modifierText}`;
    if (line.unitPrice == null) return describedHead;
    const lineTotal = line.unitPrice * line.displayQty;
    return english
      ? `${describedHead} — ${formatMoney(lineTotal, true)} THB`
      : `${describedHead} — ${formatMoney(lineTotal, false)} บาท`;
  });

  const known = lines.filter((line) => line.unitPrice != null);
  const provisional =
    known.length === lines.length && lines.length > 0
      ? known.reduce((sum, line) => sum + (line.unitPrice as number) * line.displayQty, 0)
      : null;

  const parts = [
    english
      ? "Please confirm your order:"
      : "ขอสรุปรายการให้ตรวจสอบก่อนนะคะ",
    itemLines.join("\n"),
  ];

  if (provisional != null) {
    // ต้องบอกตรง ๆ ว่านี่ยังไม่ใช่ยอดสุทธิ ไม่งั้นลูกค้าจะยึดเลขนี้แล้วรู้สึกว่าถูกเก็บเกิน
    // ตอนเห็นยอดจริงที่รวมค่าส่ง/หักส่วนลดแล้ว
    parts.push(
      english
        ? `Items subtotal ${formatMoney(provisional, true)} THB (before any discount, shipping or points)`
        : `รวมค่าสินค้า ${formatMoney(provisional, false)} บาท (ยังไม่รวมค่าส่ง/ส่วนลด/แต้ม)`
    );
  }

  parts.push(
    english
      ? 'Reply "confirm" and I will place this order for you.'
      : 'ถ้าถูกต้องแล้วพิมพ์ "ยืนยัน" เพื่อสั่งเลยนะคะ'
  );
  return parts.join("\n");
}

/**
 * ตัวอย่างรูปแบบที่บอทใช้สอนลูกค้าเมื่อถูกถามว่าสั่งหลายรายการยังไง
 *
 * **ต้องเป็นสตริงคงที่ฝั่ง server ห้ามให้โมเดลแต่งสด** — เคสจริง 2026-08-19: ลูกค้าถาม
 * "ขอตัวอย่างการสั่งทีละเยอะๆ" โมเดลแต่งตัวอย่างขึ้นมาเอง (ครอบด้วย `**` แบบ markdown
 * และไม่มีคำกริยาสั่งซื้อ) ลูกค้าก็อปตามเป๊ะ แล้วระบบรับไม่ได้ทั้งข้อความ ตัวอย่างที่สอน
 * จึงต้องเป็นรูปแบบเดียวกับที่ parseRequestedItems/looksLikeRequestedItemList รับได้จริง
 * ตามนิยาม ไม่ใช่ตามความจำของโมเดล
 */
export function multiItemOrderExample(language: "th" | "en" = "th"): string {
  return language === "en"
    ? [
        "You can send everything in one message — one item per comma, each with a quantity and a unit:",
        "paracetamol 500mg 10-tab 5 blisters, ORS 3 sachets, gauze 3*3 inch 2 packs",
        "Product name + quantity + unit for every item, separated by commas.",
      ].join("\n")
    : [
        "พิมพ์รวมในข้อความเดียวได้เลยค่ะ คั่นแต่ละรายการด้วยจุลภาค (,) และใส่จำนวนกับหน่วยให้ครบทุกรายการ",
        "พาราเซตามอล 500 มก. 10 เม็ด 5 แผง, เกลือแร่ 3 ซอง, ผ้าก๊อซ 3*3 นิ้ว 2 ห่อ",
        "รูปแบบคือ ชื่อสินค้า + จำนวน + หน่วย ของทุกรายการค่ะ",
      ].join("\n");
}

/**
 * ถามจำนวนของรายการที่ลูกค้าไม่ได้บอกมา — ประกอบฝั่ง server
 *
 * ทำไมไม่ปล่อยให้โมเดลถาม: โมเดลมีแนวโน้มถามรายการเดียวแล้วลืมที่เหลือ หรือเดาจำนวนให้เอง
 * ซึ่งผิด invariant ของ requestedItems.ts (`qty === null` = ลูกค้าไม่ได้บอก ห้ามเติมให้)
 * ข้อความนี้ยกทุกรายการที่ลูกค้าพิมพ์มากลับไปให้เห็น แล้วชี้เฉพาะตัวที่ยังขาดจำนวน
 * ลูกค้าจึงตรวจได้ว่าไม่มีรายการไหนหายไป ซึ่งเป็นสิ่งที่ตอบทีละคำถามให้ไม่ได้
 */
export function composeMissingQuantityQuestion(
  items: Array<{ nameHint: string; qty: number | null; unit: string | null }>,
  language: "th" | "en" = "th"
): string {
  const english = language === "en";
  const lines = items.map((item) => {
    const name = item.nameHint.trim() || (english ? "(unnamed item)" : "(ไม่ระบุชื่อ)");
    if (item.qty == null) {
      return english
        ? `• ${name} — how many?`
        : `• ${name} — รับกี่${item.unit || "ชิ้น"}คะ?`;
    }
    const unit = item.unit ? ` ${item.unit}` : "";
    return english ? `• ${name} × ${item.qty}${unit}` : `• ${name} × ${item.qty}${unit}`;
  });
  const missing = items.filter((item) => item.qty == null).length;
  return [
    english
      ? "I have these items from your message:"
      : "ทางร้านได้รายการตามนี้นะคะ",
    lines.join("\n"),
    missing === 1
      ? english
        ? "Could you tell me the quantity for the item above?"
        : "รบกวนแจ้งจำนวนของรายการที่ยังไม่ได้ระบุด้วยนะคะ"
      : english
        ? `Could you tell me the quantities for the ${missing} items above?`
        : `รบกวนแจ้งจำนวนของ ${missing} รายการที่ยังไม่ได้ระบุด้วยนะคะ`,
  ].join("\n");
}
