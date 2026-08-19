// =============================================================
// BMS requested-items parser — ONE list splitter for the whole codebase
// -------------------------------------------------------------
// **This module imports nothing, on purpose** — same reason as loyaltyMath.ts.
// Two constraints force it:
//   1. pharmacy/trigger.ts documents itself as side-effect free, so whatever
//      it imports must not reach Postgres. nlu.ts cannot host this parser
//      because nlu.ts pulls in stock.ts.
//   2. `node --experimental-strip-types` (how the pure contract suites run)
//      does not guess file extensions, so any extensionless import here would
//      make this module untestable without a bundler.
// Anything that needs "how many things did the customer ask for in this
// message" imports from here — do NOT write a second splitter.
//
// What this module does NOT do, on purpose:
//   * It never resolves a SKU. Choosing which product a vague phrase means is
//     a catalog lookup, and for medicine it is a clinical decision.
//   * It never converts a pack unit into a piece count. "1 แผง" stays qty 1
//     unit "แผง"; how many tablets that is lives in bms_product_packs (7.86).
//   * It never defaults a missing quantity to 1. qty === null means the
//     customer did not say, and the caller must ask.
// =============================================================

/** Generic "pieces" units — apparel, general retail. */
export const COUNT_UNIT_WORDS = ["ชิ้น", "คู่", "อัน", "ตัว", "ชุด"] as const;

/**
 * Retail pack shapes — pharmacy, grocery. A pack is a sellable unit, not a size.
 *
 * Dose-form words (เม็ด, แคปซูล) are deliberately absent. In "พารา 500mg 10 เม็ด"
 * the "10 เม็ด" identifies WHICH product (the blister content), it is not the
 * quantity requested; reading it as a quantity turns "1 แผง of the 10-tablet
 * pack" into "10 of something unknown". normalizePharmacyProductSearchText()
 * relies on the same distinction — it strips counted units from the search text
 * but keeps dose-form and strength descriptors.
 */
export const PACK_UNIT_WORDS = [
  "แผง",
  "ขวด",
  "ซอง",
  "กล่อง",
  "หลอด",
  "ตลับ",
  "กระปุก",
  "แพ็ค",
  "แพ็ก",
  "pack",
  "boxes",
  "box",
  "bottles",
  "bottle",
  "blisters",
  "blister",
  "sachets",
  "sachet",
  "tubes",
  "tube",
  "ห่อ",
  "ถุง",
  "กระป๋อง",
  "ม้วน",
] as const;

/** Regex alternation for every unit a quantity may be counted in. */
export const ALL_UNIT_PATTERN = [...COUNT_UNIT_WORDS, ...PACK_UNIT_WORDS].join("|");

/** Regex alternation for generic piece units only (no pack shapes). */
export const COUNT_UNIT_PATTERN = COUNT_UNIT_WORDS.join("|");

/**
 * Remove markdown emphasis asterisks a customer pasted back from a chat reply.
 *
 * Real case (production, 2026-08-19): the bot wrote its own example wrapped in
 * `**…**`, the customer copied it verbatim, and `**พาราเซตามอล …` went on to be
 * used as a `search_products` keyword — which matches nothing.
 *
 * **A bare `*` between two non-space characters is left alone on purpose.**
 * Thai retail writes sizes as "ผ้าก๊อซ 3*3 นิ้ว"; stripping that would silently
 * change which product the customer asked for. Only runs of 2+ asterisks and
 * asterisks touching whitespace or a string edge are emphasis markers.
 */
export function stripMarkdownEmphasis(text: string): string {
  return String(text || "")
    .replace(/\*{2,}/g, "")
    .replace(/(^|\s)\*+(?=\S)/g, "$1")
    .replace(/(?<=\S)\*+(?=\s|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type RequestedItem = {
  /** The customer's own wording for this item, untouched. Shown to a pharmacist. */
  rawText: string;
  /** rawText with request verbs, quantity, unit and politeness removed. */
  nameHint: string;
  /** null = the customer did not state a quantity. Never default this to 1. */
  qty: number | null;
  /** The unit counted in ("แผง", "ขวด", …). A hint for pack lookup, not a multiplier. */
  unit: string | null;
};

/**
 * List separators, in one place.
 *
 * `,` `;` and newline are strong list separators. `+` is trusted only when
 * both sides independently look like items because it also occurs in product
 * names such as "Vitamin C + Zinc". "กับ" / "และ" / "แล้วก็" / "กะ" / "and"
 * are ordinary words that also appear inside a single sentence
 * ("สั่งของและอยากถามว่าส่งฟรีไหม"), so a split on those alone is only trusted
 * when a segment carries a concrete quantity — see shouldTrustSplit().
 */
export const LIST_SEPARATOR_RE = /\s*(?:กับ|และ|แล้วก็|กะ|\band\b|,|;|；|\n)\s*/i;
const STRONG_SEPARATOR_RE = /[,;；\n]/;

const REQUEST_VERB_PATTERN =
  "อยากได้|อยากซื้อ|ต้องการซื้อ|ต้องการ|ขอซื้อ|ขอสั่ง|สั่งซื้อ|สั่ง|ซื้อ|ขอ|เอา|รับ|จอง|หา";

const NON_ITEM_SIDE_CLAUSE_RE =
  /^(?:ส่ง|จัดส่ง|ค่าส่ง|ส่งฟรี|ชำระ|จ่าย|โอน|ใช้คูปอง|รับของ).*(?:ไหม|มั้ย|ได้ไหม|เมื่อไหร่|พรุ่งนี้|กี่วัน|อย่างไร|ยังไง|หรือเปล่า)?$/i;

const QTY_WITH_UNIT_RE = new RegExp(`(\\d+)\\s*(?:${ALL_UNIT_PATTERN}|pcs?|pieces?)`, "i");
const THAI_QTY_WITH_UNIT_RE = new RegExp(
  `(?:ขอ|เอา|รับ|จำนวน)?\\s*(หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\\s*(?:${ALL_UNIT_PATTERN})`,
  "i"
);
const THAI_UNIT_THEN_ONE_RE = new RegExp(
  `(?:${ALL_UNIT_PATTERN})(?:หนึ่ง|นึง)(?:\\s|$|ค่ะ|คะ|ครับ|นะ)`,
  "i"
);
const QTY_AFTER_VERB_RE = new RegExp(
  `(?:ขอ|เอา|รับ|เปลี่ยน(?:จำนวน)?เป็น|เพิ่มเป็น|ลดเหลือ)\\s*(\\d+)\\s*(?:${COUNT_UNIT_PATTERN}|แทน|พอ|นะ|ค่ะ|คะ|ครับ|$)`,
  "i"
);

const THAI_NUMBER_WORDS: Record<string, number | undefined> = {
  หนึ่ง: 1,
  นึง: 1,
  สอง: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
  หก: 6,
  เจ็ด: 7,
  แปด: 8,
  เก้า: 9,
  สิบ: 10,
};

const THAI_DIGITS: Record<string, string> = {
  "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
  "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
};

function normalizeThaiDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit] ?? digit);
}

/** ดึงจำนวนจากข้อความ เช่น "2 ชิ้น", "1 แผง", "x2", "จำนวน 3" → number | null */
export function extractQty(text: string): number | null {
  text = normalizeThaiDigits(String(text || ""));
  const m =
    text.match(QTY_WITH_UNIT_RE) ||
    text.match(/x\s*(\d+)/i) ||
    text.match(/จำนวน\s*(\d+)/i) ||
    text.match(QTY_AFTER_VERB_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  const thaiNumber = text.match(THAI_QTY_WITH_UNIT_RE)?.[1];
  if (!thaiNumber && THAI_UNIT_THEN_ONE_RE.test(text)) return 1;
  return THAI_NUMBER_WORDS[thaiNumber ?? ""] ?? null;
}

const UNIT_AFTER_NUMBER_RE = new RegExp(`\\d+\\s*(${ALL_UNIT_PATTERN})`, "i");
const UNIT_AFTER_THAI_NUMBER_RE = new RegExp(
  `(?:หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\\s*(${ALL_UNIT_PATTERN})`,
  "i"
);

/** ดึงหน่วยที่ลูกค้านับ เช่น "1 แผง" → "แผง" (ใบ้ให้หา pack ไม่ใช่ตัวคูณจำนวนเม็ด) */
export function extractUnit(text: string): string | null {
  text = normalizeThaiDigits(String(text || ""));
  const m = text.match(UNIT_AFTER_NUMBER_RE) || text.match(UNIT_AFTER_THAI_NUMBER_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Strip request verbs, quantity+unit and politeness so what remains is the
 * customer's product wording. Strength/volume descriptors are kept on purpose
 * ("พารา 500mg" must survive) — only counted units are removed.
 */
export function stripRequestNoise(text: string): string {
  return normalizeThaiDigits(String(text || ""))
    .replace(/^\s*(?:\d+|[ก-ฮ])[.)]\s*/, " ")
    .replace(new RegExp(`(?:${REQUEST_VERB_PATTERN})`, "gi"), " ")
    .replace(/(?:เปลี่ยน(?:ไซซ์|size|ขนาด|จำนวน)?(?:เป็น)?|เพิ่มเป็น|ลดเหลือ|แทน)/gi, " ")
    .replace(new RegExp(`\\d+\\s*(?:${ALL_UNIT_PATTERN}|pcs?|pieces?)`, "gi"), " ")
    .replace(new RegExp(`(?:หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\\s*(?:${ALL_UNIT_PATTERN})`, "gi"), " ")
    .replace(new RegExp(`(?:${ALL_UNIT_PATTERN})(?:หนึ่ง|นึง)`, "gi"), " ")
    .replace(/(?:จำนวน)\s*\d+/gi, " ")
    .replace(/(?:ค่ะ|คะ|ครับ|นะคะ|นะครับ|นะ|หน่อย|ด้วย|ที)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ParseRequestedItemsOptions = {
  /**
   * Extra "this segment is really an item" test supplied by the caller.
   *
   * nlu.ts passes findSize() so an apparel message that lists sizes but no
   * quantities ("สั่ง Nike XL กับ Adidas M") still splits the way it always
   * has. This module cannot call findSize() itself — it lives in stock.ts,
   * which reaches Postgres, and this module must stay importable from the
   * side-effect-free pharmacy trigger boundary.
   */
  isSalientSegment?: (segment: string) => boolean;
};

function shouldTrustSplit(
  text: string,
  segments: string[],
  qtys: Array<number | null>,
  isSalientSegment?: (segment: string) => boolean
): boolean {
  if (segments.length < 2) return false;
  // (a) a segment stated a concrete quantity — the historical rule
  if (qtys.some((q) => q !== null)) return true;
  // (b) caller-supplied salience (e.g. an apparel size token) — also historical
  if (isSalientSegment && segments.some((seg) => isSalientSegment(seg))) return true;
  // (c) the customer used an unambiguous list separator. Needed for pharmacy:
  // "พารา, ยาแดง, ยาแก้ปวด" carries no quantity at all, and collapsing it into
  // one garbled item silently loses two of the three things they asked for.
  return STRONG_SEPARATOR_RE.test(text);
}

function normalizePlusSeparators(
  text: string,
  isSalientSegment?: (segment: string) => boolean
): string {
  // `+` is also part of real product names ("Vitamin C + Zinc"). Convert it
  // to a list separator only when both adjacent clauses independently carry a
  // quantity or caller-supplied salience. Work one strong-delimited chunk at a
  // time so "Vitamin C + Zinc 1 กล่อง, พารา 1 แผง" keeps the first product intact.
  return text
    .split(/([,;；\n])/)
    .map((chunk) => {
      if (/^[,;；\n]$/.test(chunk) || !chunk.includes("+")) return chunk;
      const parts = chunk.split(/\s*\+\s*/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return chunk;
      const allItemShaped = parts.every(
        (part) => extractQty(part) !== null || Boolean(isSalientSegment?.(part))
      );
      return allItemShaped ? parts.join(", ") : chunk;
    })
    .join("");
}

/**
 * Split one customer message into the items they asked for.
 *
 * "อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด"
 *   → [ {พารา, 1, แผง}, {ยาแดง, 1, ขวด}, {ยาแก้ปวด, null, null} ]
 *
 * Returns a single item when the message does not read as a list, so callers
 * that only ever handled one product keep working unchanged.
 */
export function parseRequestedItems(
  text: string,
  opts: ParseRequestedItemsOptions = {}
): RequestedItem[] {
  const source = stripMarkdownEmphasis(String(text || "")).trim();
  if (!source) return [];
  const splitSource = normalizePlusSeparators(source, opts.isSalientSegment);

  const rawSegments = splitSource
    .split(LIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const rawQtys = rawSegments.map((segment) => extractQty(segment));
  const hasItemShapedSegment = rawSegments.some(
    (segment, index) => rawQtys[index] !== null || Boolean(opts.isSalientSegment?.(segment))
  );
  const segments = hasItemShapedSegment
    ? rawSegments.filter((segment) => !NON_ITEM_SIDE_CLAUSE_RE.test(segment))
    : rawSegments;
  const qtys = segments.map((seg) => extractQty(seg));

  const removedSideClause = segments.length > 0 && segments.length < rawSegments.length;
  if (!removedSideClause && !shouldTrustSplit(source, segments, qtys, opts.isSalientSegment)) {
    return [
      {
        rawText: source,
        nameHint: stripRequestNoise(source),
        qty: extractQty(source),
        unit: extractUnit(source),
      },
    ];
  }

  return segments.map((seg, index) => ({
    rawText: seg,
    nameHint: stripRequestNoise(seg),
    qty: qtys[index],
    unit: extractUnit(seg),
  }));
}

/**
 * Does this message read as a bare list of things to buy, with no request verb?
 *
 * Thai customers routinely write a basket as "ชื่อ + จำนวน + หน่วย" separated by
 * commas and nothing else — and it is exactly the shape our own bot teaches when
 * a customer asks how to order several items at once. Without a verb, both
 * `understand()` (which needs an ORDER_HINT word) and
 * `isExplicitPharmacyProductRequest()` (which needs a PRODUCT_REQUEST verb)
 * classify it as a passive enquiry, so no deterministic route claims it.
 *
 * Deliberately strict: **every** segment must carry both a quantity and a unit,
 * and there must be more than one of them. One item with a quantity is already
 * handled by the existing single-product paths, and requiring all segments to
 * qualify keeps prose containing one incidental "2 ขวด" from being read as a
 * basket. This never says WHICH products these are — that is still a catalog
 * lookup, and for medicine a clinical decision.
 */
export function looksLikeRequestedItemList(text: string): boolean {
  const items = parseRequestedItems(text);
  if (items.length < 2) return false;
  return items.every((item) => item.qty !== null && item.unit !== null);
}

/** Locate the existing line a one-line correction refers to. */
export function requestedItemTargetIndex(items: RequestedItem[], text: string): number | null {
  const ordinal = String(text || "").match(/(?:ตัว|รายการ|อัน|ข้อ)\s*ที่\s*(\d+)/i)?.[1];
  if (ordinal) {
    const index = Number(ordinal) - 1;
    return index >= 0 && index < items.length ? index : null;
  }

  const hint = stripRequestNoise(
    String(text || "")
      .replace(/(?:ไม่เอา|เอาออก|ตัด|ลบ)(?:รายการ)?/gi, " ")
      .replace(/(?:แล้ว|ออก|ด้วย)$/gi, " ")
  ).toLowerCase();
  if (!hint) return null;
  const matches = items
    .map((item, index) => ({ index, name: item.nameHint.toLowerCase() }))
    .filter(({ name }) => hint.includes(name) || name.includes(hint));
  return matches.length === 1 ? matches[0].index : null;
}

/**
 * Apply a later quantity/unit correction to a previously parsed multi-item list.
 * Product resolution still belongs to catalog tools; this only preserves the
 * customer's own slots so one correction cannot erase the other basket lines.
 */
export function updateRequestedItems(
  existing: RequestedItem[],
  text: string
): RequestedItem[] {
  if (existing.length < 2) return existing;
  const source = String(text || "").trim();
  if (!source) return existing;

  const eachQty = extractQty(source);
  if (/อย่างละ/i.test(source) && eachQty !== null) {
    const eachUnit = extractUnit(source);
    return existing.map((item) => ({
      ...item,
      qty: eachQty,
      unit: eachUnit ?? item.unit,
    }));
  }

  const target = requestedItemTargetIndex(existing, source);
  if (target === null) return existing;
  if (/(?:ไม่เอา|เอาออก|ตัดออก|ลบ)/i.test(source)) {
    return existing.filter((_, index) => index !== target);
  }

  const qty = extractQty(source);
  const unit = extractUnit(source);
  if (qty === null && unit === null) return existing;
  return existing.map((item, index) =>
    index === target
      ? { ...item, qty: qty ?? item.qty, unit: unit ?? item.unit }
      : item
  );
}
