// =============================================================
// Thai shipping zones — province normalization + zone mapping
// -------------------------------------------------------------
// Imports nothing (no @/lib/db) so client components can use the labels/options.
//
// 3 zones only. Real Thai carriers (Kerry/Flash) price by destination zone +
// weight, and the zone split that matters is Bangkok / the 5 perimeter
// provinces / everywhere else — so we recognize those by name and default the
// rest to UPCOUNTRY. We deliberately do NOT ship a 77-province table: a long
// hand-typed list is a typo farm, and nothing here needs to enumerate every
// province to pick the right zone.
//
// Unknown/blank province => zoneForProvince() returns null. Callers must treat
// null as "cannot determine zone" and fall back to the flat rate rather than
// guessing a zone (guessing would overcharge or undercharge silently).
// =============================================================

export const SHIPPING_ZONES = ["BANGKOK", "PERIMETER", "UPCOUNTRY"] as const;
export type ShippingZone = (typeof SHIPPING_ZONES)[number];

export const SHIPPING_ZONE_LABELS: Record<ShippingZone, string> = {
  BANGKOK: "กรุงเทพฯ",
  PERIMETER: "ปริมณฑล",
  UPCOUNTRY: "ต่างจังหวัด",
};

export function isShippingZone(value: unknown): value is ShippingZone {
  return typeof value === "string" && (SHIPPING_ZONES as readonly string[]).includes(value);
}

/** Canonical Bangkok name + the spellings customers actually type. */
const BANGKOK_ALIASES = [
  "กรุงเทพมหานคร",
  "กรุงเทพ",
  "กรุงเทพฯ",
  "กทม",
  "กทม.",
  "bangkok",
  "krung thep",
  "bkk",
];

/** The 5 provinces bordering Bangkok — carriers price these between BKK and upcountry. */
const PERIMETER_PROVINCES: Record<string, string[]> = {
  นนทบุรี: ["นนทบุรี", "nonthaburi"],
  ปทุมธานี: ["ปทุมธานี", "pathum thani", "pathumthani"],
  สมุทรปราการ: ["สมุทรปราการ", "samut prakan", "samutprakan"],
  สมุทรสาคร: ["สมุทรสาคร", "samut sakhon", "samutsakhon"],
  นครปฐม: ["นครปฐม", "nakhon pathom", "nakhonpathom"],
};

function baseNormalize(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // strip the Thai province prefixes people type inconsistently
    .replace(/^จังหวัด\s*/, "")
    .replace(/^จ\.\s*/, "")
    .replace(/^province\s+of\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a free-typed province into its canonical Thai name.
 * Returns null when we don't recognize it — callers must NOT assume a zone from null.
 */
export function normalizeProvince(raw?: string | null): string | null {
  if (!raw) return null;
  const v = baseNormalize(raw);
  if (!v) return null;

  if (BANGKOK_ALIASES.some((a) => baseNormalize(a) === v)) return "กรุงเทพมหานคร";
  for (const [canonical, aliases] of Object.entries(PERIMETER_PROVINCES)) {
    if (aliases.some((a) => baseNormalize(a) === v)) return canonical;
  }
  // Recognized shape but not a province we special-case: keep the cleaned Thai text.
  // zoneForProvince() will classify it as UPCOUNTRY, which is correct for every
  // other Thai province.
  return raw.trim();
}

export function zoneForProvince(province?: string | null): ShippingZone | null {
  const canonical = normalizeProvince(province);
  if (!canonical) return null;
  if (canonical === "กรุงเทพมหานคร") return "BANGKOK";
  if (PERIMETER_PROVINCES[canonical]) return "PERIMETER";
  return "UPCOUNTRY";
}

/**
 * Best-effort province detection from a single free-text address line, for the
 * addresses saved before 7.47 added a province column. Only matches the names we
 * special-case (Bangkok + perimeter) — anything else returns null so the caller
 * falls back to the flat rate instead of mislabelling the zone.
 *
 * Explicit province data always wins over this; treat the result as a hint.
 */
export type ZoneRate = { zone: ShippingZone; fee: number };
export type WeightTier = { maxGrams: number; surcharge: number };

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse the shop's stored zone-rate JSON. Silently drops malformed/duplicate rows —
 * upsertStoreProfile() runs the same parser before writing, so what is stored is
 * always exactly what the rate engine will honour (no dead rows in the DB).
 */
export function parseZoneRates(raw: unknown): ZoneRate[] {
  if (!Array.isArray(raw)) return [];
  const out: ZoneRate[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const zone = (row as any)?.zone;
    const fee = toNum((row as any)?.fee);
    if (!isShippingZone(zone) || fee === null || fee < 0 || seen.has(zone)) continue;
    seen.add(zone);
    out.push({ zone, fee });
  }
  return out;
}

export function parseWeightTiers(raw: unknown): WeightTier[] {
  if (!Array.isArray(raw)) return [];
  const out: WeightTier[] = [];
  for (const row of raw) {
    const maxGrams = toNum((row as any)?.maxGrams);
    const surcharge = toNum((row as any)?.surcharge);
    if (maxGrams === null || surcharge === null) continue;
    if (maxGrams <= 0 || surcharge < 0) continue;
    out.push({ maxGrams: Math.trunc(maxGrams), surcharge });
  }
  // เรียงจากขั้นน้ำหนักน้อยไปมาก เพื่อให้เลือกขั้นแรกที่ครอบน้ำหนักจริงได้
  return out.sort((a, b) => a.maxGrams - b.maxGrams);
}

export function guessProvinceFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const hay = baseNormalize(address);
  if (!hay) return null;

  for (const alias of BANGKOK_ALIASES) {
    const needle = baseNormalize(alias);
    // "กทม" is short enough to appear inside unrelated words, so require a boundary-ish hit
    if (needle.length >= 3 && hay.includes(needle)) return "กรุงเทพมหานคร";
  }
  for (const [canonical, aliases] of Object.entries(PERIMETER_PROVINCES)) {
    if (aliases.some((a) => hay.includes(baseNormalize(a)))) return canonical;
  }
  return null;
}
