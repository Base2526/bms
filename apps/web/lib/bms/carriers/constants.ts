// =============================================================
// Carrier codes + display labels — single source of truth
// -------------------------------------------------------------
// Deliberately imports nothing (no @/lib/db), so client components
// (/admin/settings, /admin/shipment) can import it directly — same reason
// productImport.constants.ts exists separately from productImport.ts.
// lib/bms/shipping.ts re-exports CARRIERS/Carrier from here, so existing
// `from "./shipping"` imports keep working unchanged.
// =============================================================

export const CARRIER_CODES = ["FLASH", "KERRY", "DHL", "AUSPOST", "NZPOST", "OTHER"] as const;
export type Carrier = (typeof CARRIER_CODES)[number];

export const CARRIER_LABELS: Record<Carrier, string> = {
  FLASH: "Flash",
  KERRY: "Kerry",
  DHL: "DHL",
  AUSPOST: "Australia Post",
  NZPOST: "NZ Post",
  OTHER: "อื่น ๆ",
};

export function isCarrier(value: unknown): value is Carrier {
  return typeof value === "string" && (CARRIER_CODES as readonly string[]).includes(value);
}
