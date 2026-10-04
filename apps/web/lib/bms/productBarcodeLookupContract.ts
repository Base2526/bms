import { eanCheckDigit } from "./barcode";

export type BarcodeProductMatch = {
  sku: string;
  name: string;
  imageUrl: string | null;
  active: boolean;
};
export type BarcodeSuggestion = {
  name: string;
  brand: string | null;
  size: string | null;
  description: string | null;
  imageUrl: string | null;
  source: "Barcode Lookup";
  sourceUrl: string;
};
export type BarcodeLookupResult = {
  code: string;
  status: "LOCAL" | "EXTERNAL" | "NOT_FOUND" | "NOT_CONFIGURED" | "UNSUPPORTED" | "UNAVAILABLE";
  matches: BarcodeProductMatch[];
  suggestion?: BarcodeSuggestion;
};

export function isProductGtin(code: string): boolean {
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)
    && eanCheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/** Read a Digital Link identifier, never navigate to or fetch a scanned URL. */
export function parseProductBarcode(raw: string): { code: string; external: boolean } | null {
  const value = raw.trim();
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let code = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return null;
      const match = url.pathname.match(/^\/01\/(\d{14})(?:\/|$)/);
      if (!match || !isProductGtin(match[1])) return null;
      // Digital Link pads unit GTINs to 14 digits. Store their ordinary EAN/UPC spelling so
      // the existing POS's exact barcode scan still finds the newly created product.
      code = productBarcodeAliases(match[1]).sort((a, b) => a.length - b.length)[0];
    } catch { return null; }
  } else if (code.length > 128 || /^[a-z][a-z0-9+.-]*:\/\//i.test(code) || /^(?:javascript|data):/i.test(code)) {
    return null;
  }
  // Restricted-circulation / scale labels must not leave the shop.
  const external = isProductGtin(code) && !/^2\d{12}$/.test(code)
    && !/^02\d{12}$/.test(code);
  return { code, external };
}

/** Only pad equivalent GTIN representations; a case-level indicator is not a unit barcode. */
export function productBarcodeAliases(code: string): string[] {
  if (!isProductGtin(code)) return [code];
  const full = code.padStart(14, "0");
  return Array.from(new Set([code, full, ...[13, 12, 8].flatMap((length) => {
    const prefix = full.slice(0, 14 - length);
    const candidate = full.slice(-length);
    return /^0+$/.test(prefix) && isProductGtin(candidate) ? [candidate] : [];
  })]));
}

/** Presentation-only suggestions; money, stock, tax and pack ratios never enter this patch. */
export function barcodeAutofillPatch(
  suggestion: BarcodeSuggestion,
  current: Record<string, unknown>,
  sizeTouched: boolean,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "brand", "description"] as const) {
    if (!String(current[key] ?? "").trim() && suggestion[key]) patch[key] = suggestion[key];
  }
  const sizes = current.variantCodes;
  if (suggestion.size && !sizeTouched && (!Array.isArray(sizes) || sizes.length === 0
    || (sizes.length === 1 && sizes[0] === "STD"))) {
    patch.variantCodes = [suggestion.size];
  }
  return patch;
}

export type BarcodeAutofillField = { name: string; before: unknown; filled: unknown; touched: boolean };

/** Undo only our unchanged suggestions, never a field the operator has subsequently edited. */
export function barcodeAutofillRestore(fields: BarcodeAutofillField[], current: Record<string, unknown>) {
  return fields.filter((field) => JSON.stringify(current[field.name]) === JSON.stringify(field.filled))
    .map((field) => ({ name: field.name, value: field.before ?? (field.name === "variantCodes" ? [] : ""), touched: field.touched }));
}

export function sameProductBarcode(a: string, b: string): boolean {
  const left = parseProductBarcode(a)?.code;
  const right = parseProductBarcode(b)?.code;
  return Boolean(left && right && productBarcodeAliases(left).includes(right));
}
