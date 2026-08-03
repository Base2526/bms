// =============================================================
// BMS shipping rate engine — คิดค่าส่งจากปลายทาง + น้ำหนัก
// -------------------------------------------------------------
// ลำดับความสำคัญของแหล่งราคา (precedence):
//   1. carrier   — ถาม carrier API (ตอนนี้เป็น mock/seam เท่านั้น ดู carriers/)
//   2. zone      — เรตตามโซนปลายทางที่ร้านตั้งเอง + ค่าน้ำหนักส่วนเพิ่ม
//   3. flat      — ค่าส่งเหมาเดิม (shippingFlatRate) — พฤติกรรมก่อน 7.47
//   4. none      — ร้านยังไม่ตั้งค่าส่งเลย → fee = null (ห้ามเดาเป็น 0)
//
// กติกาที่ต้องไม่พัง:
//  · โซนไม่รู้ (ไม่มีจังหวัด/จำไม่ได้) → **ตกไป flat ไม่ใช่เดาโซน** เพราะเดาผิด
//    = เก็บเงินผิดแบบเงียบ ๆ
//  · สินค้าบางตัวไม่มีน้ำหนัก → **ไม่คิดค่าน้ำหนักเพิ่ม + ใส่ warning**
//    (ห้ามเดาน้ำหนักแทนร้าน)
//  · ส่งฟรีเมื่อยอด ≥ threshold ทับทุกแหล่งราคา (เป็นโปรของร้าน ไม่ใช่ต้นทุนจริง)
//  · ทุกผลลัพธ์คืน `source` + `breakdown` + `warnings` เพื่ออธิบายได้ว่าเลขนี้มาจากไหน
// =============================================================

import { query } from "@/lib/db";
import { getStoreProfile, type StoreProfile } from "./storeProfile";
import { getCarrierClient } from "./carriers";
import { isCarrier, type Carrier } from "./carriers/constants";
import {
  guessProvinceFromAddress,
  parseWeightTiers,
  parseZoneRates,
  zoneForProvince,
  type ShippingZone,
  type WeightTier,
} from "./shippingZones";

export type ShippingFeeSource = "carrier" | "zone" | "flat" | "none";

// Parsers live in shippingZones.ts (which imports nothing) so storeProfile.ts can
// validate with them without a circular import back through this module.
export { parseZoneRates, parseWeightTiers } from "./shippingZones";
export type { ZoneRate, WeightTier } from "./shippingZones";

export type ShippingQuote = {
  configured: boolean;
  fee: number | null;
  currency: string;
  source: ShippingFeeSource;
  zone: ShippingZone | null;
  province: string | null;
  /** true when province came from scanning the free-text address, not an explicit field. */
  provinceIsGuess: boolean;
  totalGrams: number | null;
  baseFee: number | null;
  weightSurcharge: number;
  freeThreshold: number | null;
  freeShippingApplied: boolean;
  estDaysMin: number | null;
  estDaysMax: number | null;
  /** Human-readable steps, safe to show staff (and to summarize for a customer). */
  breakdown: string[];
  /** Reasons the number may be less precise than it looks. Never hide these from staff. */
  warnings: string[];
  note: string;
};

export type ShippingQuoteInput = {
  tenantId: string;
  subtotal?: number | null;
  /** Explicit destination province (preferred). */
  province?: string | null;
  /** Free-text address used only to guess the province when none was given. */
  addressText?: string | null;
  /** Total parcel weight if already known; otherwise pass items to have it summed. */
  totalGrams?: number | null;
  items?: { sku: string; qty: number }[] | null;
  /** Carrier to ask for a live rate (only used when shippingMode = 'carrier'). */
  carrier?: string | null;
  /** Override the shop's configured mode (used by the estimate tool for what-ifs). */
  mode?: StoreProfile["shippingMode"] | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * รวมน้ำหนักของรายการสินค้า — คืน null ถ้ามีสินค้าตัวใดตัวหนึ่งยังไม่กรอกน้ำหนัก
 * (ตั้งใจให้ "ไม่รู้" ต่างจาก "หนัก 0 กรัม" ชัดเจน)
 */
export async function sumItemWeightGrams(
  tenantId: string,
  items: { sku: string; qty: number }[]
): Promise<{ totalGrams: number | null; missingSkus: string[] }> {
  const skus = Array.from(new Set(items.map((i) => i.sku).filter(Boolean)));
  if (skus.length === 0) return { totalGrams: null, missingSkus: [] };

  const res = await query<{ sku: string; weight_grams: number | null }>(
    `SELECT sku, weight_grams FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`,
    [tenantId, skus]
  );
  const weightBySku = new Map(res.rows.map((r) => [r.sku, r.weight_grams]));

  let total = 0;
  const missingSkus: string[] = [];
  for (const item of items) {
    const w = weightBySku.get(item.sku);
    if (w === null || w === undefined) {
      missingSkus.push(item.sku);
      continue;
    }
    total += Number(w) * Math.max(1, Number(item.qty) || 1);
  }
  // น้ำหนักไม่ครบ = ไม่รู้น้ำหนักรวมจริง ห้ามเอาผลบวกบางส่วนไปคิดเงิน
  if (missingSkus.length > 0) return { totalGrams: null, missingSkus };
  return { totalGrams: total, missingSkus: [] };
}

function weightSurchargeFor(tiers: WeightTier[], totalGrams: number | null): number {
  if (!tiers.length || totalGrams === null) return 0;
  for (const tier of tiers) {
    if (totalGrams <= tier.maxGrams) return tier.surcharge;
  }
  // หนักเกินทุกขั้นที่ตั้งไว้ → ใช้ขั้นสูงสุด (ปลอดภัยกว่าคิด 0)
  return tiers[tiers.length - 1].surcharge;
}

/** คิดค่าส่งจริง — จุดเดียวที่ทุก caller (order/checkout/AI tool/invoice) ต้องใช้ */
export async function quoteShipping(input: ShippingQuoteInput): Promise<ShippingQuote> {
  const p = await getStoreProfile(input.tenantId);
  const mode = input.mode ?? p.shippingMode;
  const currency = p.currency || "THB";
  const warnings: string[] = [];
  const breakdown: string[] = [];

  // ---- ปลายทาง ----
  let province = input.province?.trim() || null;
  let provinceIsGuess = false;
  if (!province && input.addressText) {
    const guessed = guessProvinceFromAddress(input.addressText);
    if (guessed) {
      province = guessed;
      provinceIsGuess = true;
      warnings.push(`เดาจังหวัดจากที่อยู่ว่า "${guessed}" (ไม่ได้กรอกจังหวัดแยก) — ควรยืนยันก่อนเก็บเงิน`);
    }
  }
  const zone = zoneForProvince(province);

  // ---- น้ำหนัก ----
  let totalGrams = num(input.totalGrams);
  if (totalGrams === null && input.items?.length) {
    const summed = await sumItemWeightGrams(input.tenantId, input.items);
    totalGrams = summed.totalGrams;
    if (summed.missingSkus.length) {
      warnings.push(`ยังไม่ได้กรอกน้ำหนักสินค้า: ${summed.missingSkus.join(", ")} — ไม่ได้คิดค่าน้ำหนักส่วนเพิ่ม`);
    }
  }

  const zoneRates = parseZoneRates(p.shippingZoneRates);
  const weightTiers = parseWeightTiers(p.shippingWeightTiers);

  let source: ShippingFeeSource = "none";
  let baseFee: number | null = null;
  let weightSurcharge = 0;

  // ---- 1) carrier API (mock/seam เท่านั้นตอนนี้) ----
  if (mode === "carrier") {
    const carrier = isCarrier(input.carrier) ? (input.carrier as Carrier) : null;
    const client = carrier ? getCarrierClient(carrier) : null;
    const live = client?.quoteRate
      ? await client.quoteRate({
          originProvince: p.shippingOriginProvince,
          destProvince: province,
          totalGrams,
          subtotal: num(input.subtotal),
        })
      : null;

    if (live?.ok) {
      source = "carrier";
      baseFee = live.fee;
      breakdown.push(
        `${carrier}: ค่าส่ง ${live.fee.toLocaleString()} ${currency}` +
          (live.source === "mock" ? " (ข้อมูลจำลอง ไม่ใช่เรตจริง)" : "")
      );
      if (live.source === "mock") {
        warnings.push("ค่าส่งนี้มาจาก carrier mock mode ไม่ใช่เรตจริงจากขนส่ง — อย่าใช้เก็บเงินลูกค้าจริง");
      }
    } else {
      const why =
        live && !live.ok
          ? live.reason === "unconfigured"
            ? "ยังไม่ได้ตั้งค่า API ของขนส่ง"
            : "ยังไม่ได้เชื่อม API เรตค่าส่งของขนส่ง"
          : carrier
            ? "ขนส่งนี้ยังไม่มีตัวเชื่อม API"
            : "ยังไม่ได้เลือกขนส่ง";
      warnings.push(`${why} — คิดค่าส่งด้วยเรตของร้านแทน`);
    }
  }

  // ---- 2) zone ----
  if (source === "none" && (mode === "zone" || mode === "carrier") && zoneRates.length) {
    if (zone) {
      const match = zoneRates.find((r) => r.zone === zone);
      if (match) {
        source = "zone";
        baseFee = match.fee;
        breakdown.push(`โซนปลายทาง ${zone}: ${match.fee.toLocaleString()} ${currency}`);
      } else {
        warnings.push(`ร้านยังไม่ได้ตั้งเรตของโซน ${zone} — ใช้ค่าส่งเหมาแทน`);
      }
    } else {
      warnings.push("ไม่รู้จังหวัดปลายทาง — ใช้ค่าส่งเหมาแทน (ยังไม่คิดตามโซน)");
    }
  }

  // ---- 3) flat ----
  if (source === "none" && p.shippingFlatRate != null) {
    source = "flat";
    baseFee = p.shippingFlatRate;
    breakdown.push(`ค่าส่งเหมา: ${p.shippingFlatRate.toLocaleString()} ${currency}`);
  }

  // ---- ค่าน้ำหนักส่วนเพิ่ม (ใช้กับ zone/flat เท่านั้น — carrier คิดน้ำหนักมาให้แล้ว) ----
  if (source === "zone" || source === "flat") {
    weightSurcharge = weightSurchargeFor(weightTiers, totalGrams);
    if (weightSurcharge > 0 && totalGrams !== null) {
      breakdown.push(`น้ำหนัก ${totalGrams.toLocaleString()} ก.: +${weightSurcharge.toLocaleString()} ${currency}`);
    }
  }

  let fee = baseFee === null ? null : baseFee + weightSurcharge;

  // ---- ส่งฟรีเมื่อยอดถึงเกณฑ์ (ทับทุกแหล่งราคา) ----
  const threshold = p.shippingFreeThreshold;
  const subtotal = num(input.subtotal);
  let freeShippingApplied = false;
  if (threshold != null && subtotal != null && subtotal >= threshold && fee !== null && fee > 0) {
    freeShippingApplied = true;
    fee = 0;
    breakdown.push(`ยอดซื้อถึง ${threshold.toLocaleString()} ${currency} → ส่งฟรี`);
  }

  const configured = source !== "none";
  return {
    configured,
    fee,
    currency,
    source,
    zone,
    province,
    provinceIsGuess,
    totalGrams,
    baseFee,
    weightSurcharge,
    freeThreshold: threshold,
    freeShippingApplied,
    estDaysMin: p.shippingEstDaysMin,
    estDaysMax: p.shippingEstDaysMax,
    breakdown,
    warnings,
    note: configured
      ? source === "carrier"
        ? "ค่าส่งจากตัวเชื่อมขนส่ง"
        : source === "zone"
          ? "คิดตามโซนปลายทางที่ร้านตั้งไว้"
          : "ค่าส่งเหมาที่ร้านตั้งไว้ (ยังไม่คิดตามปลายทาง)"
      : "ร้านยังไม่ได้ตั้งค่าส่ง",
  };
}
