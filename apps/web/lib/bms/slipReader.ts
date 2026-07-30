// =============================================================
// Payment slip reader contract
// -------------------------------------------------------------
// Provider adapters extract untrusted facts from an image only.
// Payment comparison and human confirmation remain in payments.ts.
// =============================================================

export type SlipExtract = {
  amount: number | null;
  date: string | null;
  ref: string | null;
  bank: string | null;
};

export type SlipReaderCredentials = {
  apiKey: string;
  model: string;
  baseUrl?: string | null;
};

export type SlipReadRequest = {
  base64: string;
  mediaType: string;
  credentials: SlipReaderCredentials;
};

export type SlipReadResult = {
  provider: string;
  model: string;
  extracted: SlipExtract;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type SlipImagePolicy = {
  maxImagePixels: number;
  safeRawBytes: number;
  resizePatchPx?: number | null;
  passThroughMediaTypes?: readonly string[];
};

export interface SlipReader {
  readonly provider: string;
  readonly imagePolicy?: SlipImagePolicy;
  read(request: SlipReadRequest): Promise<SlipReadResult>;
}

export class SlipReaderError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "PROVIDER_ERROR"
      | "PROVIDER_TIMEOUT"
      | "MALFORMED_OUTPUT",
    message: string
  ) {
    super(message);
    this.name = "SlipReaderError";
  }
}

const OUTPUT_FIELDS = new Set(["amount", "date", "ref", "bank"]);
const MAX_TEXT_FIELD_LENGTH = 256;

function parseTextField(value: unknown, field: "date" | "ref" | "bank"): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new SlipReaderError("MALFORMED_OUTPUT", `Slip OCR field "${field}" must be a string or null`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_TEXT_FIELD_LENGTH) {
    throw new SlipReaderError("MALFORMED_OUTPUT", `Slip OCR field "${field}" is too long`);
  }
  return normalized;
}

/**
 * Parse provider output without retaining or echoing the raw slip content in an error.
 * Unknown fields are rejected so a provider cannot silently expand the trusted contract.
 */
export function parseSlipExtract(text: string): SlipExtract {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!jsonText) {
    throw new SlipReaderError("MALFORMED_OUTPUT", "Slip OCR returned an empty response");
  }

  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw new SlipReaderError("MALFORMED_OUTPUT", "Slip OCR returned invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SlipReaderError("MALFORMED_OUTPUT", "Slip OCR response must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!OUTPUT_FIELDS.has(key)) {
      throw new SlipReaderError("MALFORMED_OUTPUT", "Slip OCR returned an unknown field");
    }
  }
  for (const field of OUTPUT_FIELDS) {
    if (!(field in record)) {
      throw new SlipReaderError("MALFORMED_OUTPUT", `Slip OCR response is missing "${field}"`);
    }
  }

  const amount = record.amount;
  if (
    amount !== null &&
    (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)
  ) {
    throw new SlipReaderError("MALFORMED_OUTPUT", "Slip OCR amount must be a non-negative number or null");
  }

  return {
    amount,
    date: parseTextField(record.date, "date"),
    ref: parseTextField(record.ref, "ref"),
    bank: parseTextField(record.bank, "bank"),
  };
}

export function slipAmountMatches(extractedAmount: number | null, expectedAmount: number): boolean {
  return (
    extractedAmount !== null &&
    Number.isFinite(expectedAmount) &&
    expectedAmount >= 0 &&
    Math.abs(extractedAmount - expectedAmount) < 0.01
  );
}
