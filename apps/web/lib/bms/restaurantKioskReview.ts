export type KioskPriceEvidenceLine = {
  sku: string; productName: string; size: string; packCode: string | null; packQty: number;
  basePrice: number; unitPrice: number; lineAmount: number;
  modifierCatalogFingerprint: string;
  modifiers: Array<{ code: string; name: string; priceDelta: number }>;
};

/** JSONB changes object key order, so compare typed price evidence rather than serialized objects. */
export function kioskQuoteChanged(submitted: unknown[], current: { lines: KioskPriceEvidenceLine[] }) {
  return current.lines.some((line, index) => {
    const old = submitted[index] as Partial<KioskPriceEvidenceLine> | null;
    return !old || old.sku !== line.sku || old.productName !== line.productName
      || old.size !== line.size || old.packCode !== line.packCode
      || Number(old.packQty) !== line.packQty
      || old.modifierCatalogFingerprint !== line.modifierCatalogFingerprint
      || Number(old.basePrice) !== line.basePrice
      || Number(old.unitPrice) !== line.unitPrice
      || Number(old.lineAmount) !== line.lineAmount
      || JSON.stringify((old.modifiers ?? []).map((option) => `${option.code}:${option.name}:${option.priceDelta}`))
        !== JSON.stringify(line.modifiers.map((option) => `${option.code}:${option.name}:${option.priceDelta}`));
  });
}

export function normalizeKioskRequestCode(input: string) {
  const code = input.trim().toLowerCase();
  if (code && !/^[0-9a-f]{8}[0-9a-f-]{0,28}$/.test(code)) {
    throw new Error("รหัสคำขอไม่ถูกต้อง");
  }
  return code;
}
