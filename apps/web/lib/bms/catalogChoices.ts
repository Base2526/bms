export type CatalogChoiceCandidate = {
  choiceCode: string;
  sku: string;
  name: string;
};

export type PendingCatalogChoiceLine = {
  lineCode: string;
  product: string;
  size: string;
  qty: number;
  unit: string | null;
  candidates: CatalogChoiceCandidate[];
};

export type PendingCatalogChoices = {
  version: 1;
  lines: PendingCatalogChoiceLine[];
};

export function normalizeCatalogRequestedLine(
  productText: string,
  existingSize: string | null,
  cleanProduct: (value: string) => string
): { product: string; size: string | null } {
  const explicit = productText.match(
    /(?:ไซซ์|size|ขนาด)\s*[:=-]?\s*([A-Za-z0-9.-]{1,24}(?:\s*(?:เม็ด|แคปซูล|ชิ้น))?)/i
  )?.[1];
  const product = cleanProduct(productText)
    .replace(/(?:ไซซ์|size|ขนาด)\s*[:=-]?\s*[A-Za-z0-9.-]{1,24}(?:\s*(?:เม็ด|แคปซูล|ชิ้น))?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { product, size: existingSize ?? explicit?.toUpperCase() ?? null };
}

export function catalogLineCode(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 20) {
    throw new Error("catalog choice line index out of range");
  }
  return String.fromCharCode(65 + index);
}

export function composeCatalogChoiceReply(
  pending: PendingCatalogChoices,
  language: "th" | "en" = "th",
  invalidSelection = false
): string {
  const lines: string[] = [];
  if (language === "en") {
    lines.push(
      invalidSelection
        ? "That choice format does not identify one product for each item."
        : "Several catalog products match your request. Please choose one for each item:"
    );
  } else {
    lines.push(
      invalidSelection
        ? "ตัวเลขที่ส่งมายังระบุสินค้าแต่ละรายการไม่ได้ค่ะ"
        : "ชื่อที่ส่งมาตรงกับสินค้าหลายตัวในแคตตาล็อก กรุณาเลือกอย่างละ 1 ตัวค่ะ"
    );
  }

  for (const line of pending.lines) {
    const requestedUnit = line.unit ? ` ${line.qty} ${line.unit}` : ` ${line.qty}`;
    lines.push(`\n${line.lineCode}. ${line.product} · ${line.size} ·${requestedUnit}`);
    for (const candidate of line.candidates) {
      lines.push(`- ${candidate.choiceCode} — ${candidate.name} (${candidate.sku})`);
    }
  }

  const requiredCodes = pending.lines
    .filter((line) => line.candidates.length > 1)
    .map((line) => `${line.lineCode}1`)
    .join(" ");
  lines.push(
    language === "en"
      ? `\nReply with one code per item, for example: ${requiredCodes}. The system will show the complete basket again before placing the order.`
      : `\nตอบรหัสอย่างละ 1 ตัว เช่น ${requiredCodes} ค่ะ ระบบจะสรุปตะกร้าทั้งชุดให้ตรวจอีกครั้งก่อนสร้างออร์เดอร์`
  );
  return lines.join("\n");
}

export type CatalogChoiceParseResult =
  | { kind: "not_selection" }
  | { kind: "invalid" }
  | { kind: "complete"; selected: CatalogChoiceCandidate[] };

export function parseCatalogChoiceSelection(
  pending: PendingCatalogChoices,
  text: string
): CatalogChoiceParseResult {
  const normalized = text.toUpperCase();
  const suppliedCodes = normalized.match(/\b[A-T]\d{1,2}\b/g) ?? [];
  const hasNakedChoiceNumbers = /(?:^|[\s,/])\d+(?=[\s,/]|$)/.test(normalized);
  const nakedNumberReply =
    hasNakedChoiceNumbers &&
    normalized
      .replace(/\d+/g, " ")
      .replace(/(?:ยืนยัน(?:เลย)?|ตกลง|CONFIRM|เลือก|เอา|ครับ|ค่ะ|คะ|นะ|เลย)/gi, " ")
      .replace(/[,/+.\-🙏]/g, " ")
      .trim().length === 0;
  const looksLikeSelection =
    suppliedCodes.length > 0 ||
    nakedNumberReply ||
    /(?:เลือก(?:รหัส|ตัวเลือก)?|ยืนยัน|confirm|choice)/i.test(text);
  if (!looksLikeSelection) return { kind: "not_selection" };

  const uniqueCodes = [...new Set(suppliedCodes)];
  const selected: CatalogChoiceCandidate[] = [];
  for (const line of pending.lines) {
    if (line.candidates.length === 1) {
      selected.push(line.candidates[0]);
      continue;
    }
    const matches = line.candidates.filter((candidate) =>
      uniqueCodes.includes(candidate.choiceCode.toUpperCase())
    );
    if (matches.length !== 1) return { kind: "invalid" };
    selected.push(matches[0]);
  }

  const knownCodes = new Set(
    pending.lines.flatMap((line) => line.candidates.map((candidate) => candidate.choiceCode.toUpperCase()))
  );
  if (uniqueCodes.some((code) => !knownCodes.has(code))) return { kind: "invalid" };
  return { kind: "complete", selected };
}
