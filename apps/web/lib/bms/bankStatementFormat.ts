import crypto from "crypto";
import * as XLSX from "xlsx";

export const BANK_STATEMENT_MAX_BYTES = 10 * 1024 * 1024;
export const BANK_STATEMENT_MAX_ROWS = 50_000;

export type BankStatementRow = {
  lineNo: number;
  postedOn: string;
  transactionAt: string | null;
  direction: "IN" | "OUT";
  amount: string;
  balanceAfter: string | null;
  reference: string | null;
  description: string;
  counterpartyMasked: string | null;
  fingerprint: string;
};

export type ParsedBankStatement = {
  parserKey: "GENERIC_TABULAR";
  parserVersion: 2;
  periodStart: string;
  periodEnd: string;
  openingBalance: string | null;
  closingBalance: string | null;
  rows: BankStatementRow[];
  warnings: string[];
};

const HEADER_ALIASES = {
  date: [
    "date",
    "transaction date",
    "posted date",
    "วันที่",
    "วันทำรายการ",
    "วันที่ทำรายการ",
  ],
  time: ["time", "transaction time", "เวลา"],
  description: [
    "description",
    "details",
    "memo",
    "รายการ",
    "รายละเอียด",
    "คำอธิบาย",
  ],
  reference: ["reference", "ref", "transaction id", "เลขอ้างอิง", "อ้างอิง"],
  debit: ["debit", "withdrawal", "money out", "จ่ายออก", "ถอน", "เดบิต"],
  credit: ["credit", "deposit", "money in", "รับเข้า", "ฝาก", "เครดิต"],
  amount: ["amount", "จำนวนเงิน", "ยอดเงิน"],
  direction: ["direction", "type", "dr/cr", "ประเภท", "ทิศทาง"],
  balance: ["balance", "running balance", "ยอดคงเหลือ", "คงเหลือ"],
  counterparty: ["counterparty", "account", "คู่รายการ", "บัญชีคู่โอน"],
} as const;

function normalizedHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeader(headers: unknown[], aliases: readonly string[]): number {
  const normalized = headers.map(normalizedHeader);
  return normalized.findIndex((h) => aliases.includes(h));
}

function plainText(value: unknown, max = 500): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function decimal(value: unknown): string | null {
  if (value == null || value === "") return null;
  const cleaned = String(value)
    .trim()
    .replace(/[,\s฿$]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  const match = cleaned.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, "");
  if (integer.length > 16) return null;
  const fraction = (match[3] || "").padEnd(2, "0");
  const negative = match[1] === "-" && (integer !== "0" || fraction !== "00");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

function decimalCents(value: string): bigint {
  const negative = value.startsWith("-");
  const [integer, fraction] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(integer) * 100n + BigInt(fraction);
  return negative ? -result : result;
}

function centsDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

const nonZero = (value: string | null): value is string =>
  value !== null && decimalCents(value) !== 0n;
const absoluteDecimal = (value: string): string =>
  value.startsWith("-") ? value.slice(1) : value;

function calendarDate(year: number, month: number, day: number): string | null {
  if (year > 2400) year -= 543;
  if (
    year < 1900 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return calendarDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return calendarDate(parsed.y, parsed.m, parsed.d);
  }
  const raw = plainText(value, 40);
  if (!raw) return null;
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match)
    return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    return calendarDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  return null;
}

function maskCounterparty(value: unknown): string | null {
  const text = plainText(value, 100);
  if (!text) return null;
  return text.replace(/\d(?=\d{4})/g, "•");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseBankStatementBuffer(
  buffer: Buffer,
  filename: string,
): ParsedBankStatement {
  if (!buffer.length) throw new Error("ไฟล์ว่างเปล่า");
  if (buffer.length > BANK_STATEMENT_MAX_BYTES)
    throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 10 MB");
  const ext = filename.toLowerCase().split(".").pop();
  if (!ext || !["csv", "xlsx", "xls"].includes(ext))
    throw new Error("รองรับเฉพาะไฟล์ CSV, XLSX และ XLS");

  const workbook = XLSX.read(ext === "csv" ? buffer.toString("utf8") : buffer, {
    type: ext === "csv" ? "string" : "buffer",
    raw: true,
    cellDates: true,
    dense: false,
    WTF: false,
    sheetRows: BANK_STATEMENT_MAX_ROWS + 1000,
    bookVBA: false,
  });
  if (!workbook.SheetNames.length) throw new Error("ไม่พบชีตในไฟล์");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  for (const cell of Object.values(sheet)) {
    if (cell && typeof cell === "object" && "f" in cell && cell.f) {
      throw new Error("ไฟล์รายการเดินบัญชีต้องไม่มีสูตรคำนวณ");
    }
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerIndex = matrix.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const normalized = row.map(normalizedHeader);
    const has = (aliases: readonly string[]) =>
      normalized.some((value) => aliases.includes(value));
    return (
      has(HEADER_ALIASES.date) &&
      (has(HEADER_ALIASES.debit) ||
        has(HEADER_ALIASES.credit) ||
        has(HEADER_ALIASES.amount))
    );
  });
  if (headerIndex < 0)
    throw new Error("ไม่พบคอลัมน์วันที่ กรุณาใช้หัวตารางมาตรฐาน");
  const headers = matrix[headerIndex];
  const idx = {
    date: findHeader(headers, HEADER_ALIASES.date),
    time: findHeader(headers, HEADER_ALIASES.time),
    description: findHeader(headers, HEADER_ALIASES.description),
    reference: findHeader(headers, HEADER_ALIASES.reference),
    debit: findHeader(headers, HEADER_ALIASES.debit),
    credit: findHeader(headers, HEADER_ALIASES.credit),
    amount: findHeader(headers, HEADER_ALIASES.amount),
    direction: findHeader(headers, HEADER_ALIASES.direction),
    balance: findHeader(headers, HEADER_ALIASES.balance),
    counterparty: findHeader(headers, HEADER_ALIASES.counterparty),
  };
  if (idx.debit < 0 && idx.credit < 0 && idx.amount < 0)
    throw new Error("ไม่พบคอลัมน์ยอดเงิน (debit/credit/amount)");

  const rows: BankStatementRow[] = [];
  const warnings: string[] = [];
  const fingerprintOccurrences = new Map<string, number>();
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const values = matrix[i];
    if (
      !Array.isArray(values) ||
      values.every((v) => v == null || String(v).trim() === "")
    )
      continue;
    if (rows.length >= BANK_STATEMENT_MAX_ROWS)
      throw new Error("ไฟล์มีรายการเกิน 50,000 แถว");
    const postedOn = isoDate(values[idx.date]);
    if (!postedOn) {
      warnings.push(`ข้ามแถว ${i + 1}: วันที่ไม่ถูกต้อง`);
      continue;
    }

    const debit = idx.debit >= 0 ? decimal(values[idx.debit]) : null;
    const credit = idx.credit >= 0 ? decimal(values[idx.credit]) : null;
    const rawAmount = idx.amount >= 0 ? decimal(values[idx.amount]) : null;
    if (nonZero(debit) && nonZero(credit)) {
      warnings.push(`ข้ามแถว ${i + 1}: มีทั้งยอดเดบิตและเครดิต`);
      continue;
    }
    let direction: "IN" | "OUT";
    let amount: string | null;
    if (nonZero(credit)) {
      direction = "IN";
      amount = absoluteDecimal(credit);
    } else if (nonZero(debit)) {
      direction = "OUT";
      amount = absoluteDecimal(debit);
    } else if (nonZero(rawAmount)) {
      const marker =
        idx.direction >= 0 ? normalizedHeader(values[idx.direction]) : "";
      direction =
        marker.includes("out") ||
        marker.includes("debit") ||
        marker === "dr" ||
        marker.includes("ถอน") ||
        marker.includes("จ่าย") ||
        marker === "ออก" ||
        rawAmount.startsWith("-")
          ? "OUT"
          : "IN";
      amount = absoluteDecimal(rawAmount);
    } else {
      warnings.push(`ข้ามแถว ${i + 1}: ยอดเงินเป็นศูนย์หรืออ่านไม่ได้`);
      continue;
    }

    const reference =
      idx.reference >= 0 ? plainText(values[idx.reference], 160) || null : null;
    const description =
      idx.description >= 0 ? plainText(values[idx.description]) : "";
    const balanceAfter = idx.balance >= 0 ? decimal(values[idx.balance]) : null;
    const time = idx.time >= 0 ? plainText(values[idx.time], 20) : "";
    const transactionAt =
      time && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time)
        ? `${postedOn}T${time.length === 5 ? `${time}:00` : time}+07:00`
        : null;
    const fingerprintBase = [
      postedOn,
      time,
      direction,
      amount,
      balanceAfter ?? "",
      reference ?? "",
      description,
    ].join("|");
    const occurrence = (fingerprintOccurrences.get(fingerprintBase) || 0) + 1;
    fingerprintOccurrences.set(fingerprintBase, occurrence);
    // An occurrence suffix keeps two legitimate identical rows distinct while
    // remaining deterministic when the same statement is imported again.
    const fingerprint = sha256(`${fingerprintBase}|${occurrence}`);
    rows.push({
      lineNo: i + 1,
      postedOn,
      transactionAt,
      direction,
      amount,
      balanceAfter,
      reference,
      description,
      counterpartyMasked:
        idx.counterparty >= 0
          ? maskCounterparty(values[idx.counterparty])
          : null,
      fingerprint,
    });
  }
  if (!rows.length) throw new Error("ไม่พบรายการที่นำเข้าได้");
  rows.sort(
    (a, b) => a.postedOn.localeCompare(b.postedOn) || a.lineNo - b.lineNo,
  );
  const firstBalance = rows[0].balanceAfter;
  const signedFirst =
    decimalCents(rows[0].amount) * (rows[0].direction === "IN" ? 1n : -1n);
  const openingBalance =
    firstBalance == null
      ? null
      : centsDecimal(decimalCents(firstBalance) - signedFirst);
  return {
    parserKey: "GENERIC_TABULAR",
    parserVersion: 2,
    periodStart: rows[0].postedOn,
    periodEnd: rows[rows.length - 1].postedOn,
    openingBalance,
    closingBalance: rows[rows.length - 1].balanceAfter,
    rows,
    warnings: warnings.slice(0, 100),
  };
}
