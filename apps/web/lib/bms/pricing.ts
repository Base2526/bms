// =============================================================
// BMS — ราคาตามจำนวน (8.1)
// -------------------------------------------------------------
// ไฟล์นี้ตั้งใจไม่ import อะไรเลย (เหมือน loyaltyMath.ts / barcode.ts)
//
// เหตุผลเดียวกับ composeDiscounts: จอ POS คิดราคาบรรทัดเพื่อโชว์ยอดให้ลูกค้าเห็น
// ก่อนรับเงิน แล้ว createOrder คิดใหม่อีกครั้งตอน commit · ถ้าสองทางได้เลขต่างกัน
// แม้สตางค์เดียว ยอดที่เครื่องส่งมาจะไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH
// แล้วบิลถูกยกเลิกทิ้งทั้งใบโดยหน้าเคาน์เตอร์ไม่รู้สาเหตุ
//
// จอไม่ได้ "ตัดสิน" ราคา — server ตัดสินเสมอตอน commit · จอแค่พรีวิวด้วยกฎเดียวกัน
// =============================================================

export type PriceTier = {
  /** ซื้อครบกี่หน่วยฐานถึงได้ราคานี้ */
  minQty: number;
  /** ไม่ระบุ = พฤติกรรมเดิม แยกจำนวนต่อ SKU+ไซซ์ */
  scope?: "PER_VARIANT_FIXED" | "CROSS_VARIANT_PERCENT";
  /** เฉพาะราคาคงที่: null = ใช้ราคาเดียวทุกไซซ์, ค่าอื่น = ใช้เฉพาะไซซ์นั้น */
  size?: string | null;
  unitPrice?: number | null;
  discountPct?: number | null;
};

export type PricingSnapshot = {
  priceTiers: PriceTier[];
  promotion: Promotion | null;
};

/**
 * กติกาที่ติดมากับบิลเป็นข้อมูลถาวร แต่แถว legacy/backfill อาจมีรูปไม่สมบูรณ์ได้
 * จึง normalize ก่อนนำไปคิดเงินจริงทุกครั้ง แทนการ cast JSON จากฐานแล้วเชื่อทันที
 */
export function normalizePricingSnapshot(raw: unknown): PricingSnapshot {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const priceTiers = Array.isArray(record.priceTiers)
    ? record.priceTiers.flatMap((candidate): PriceTier[] => {
        if (!candidate || typeof candidate !== "object") return [];
        const tier = candidate as Record<string, unknown>;
        const minQty = Number(tier.minQty);
        const scope = tier.scope === "CROSS_VARIANT_PERCENT"
          ? "CROSS_VARIANT_PERCENT" as const
          : "PER_VARIANT_FIXED" as const;
        const unitPrice = tier.unitPrice == null ? null : Number(tier.unitPrice);
        const discountPct = tier.discountPct == null ? null : Number(tier.discountPct);
        if (!Number.isInteger(minQty) || minQty < 2) return [];
        if (scope === "CROSS_VARIANT_PERCENT"
            && (!Number.isFinite(discountPct) || discountPct! <= 0 || discountPct! > 100)) return [];
        if (scope === "PER_VARIANT_FIXED"
            && (!Number.isFinite(unitPrice) || unitPrice! < 0)) return [];
        return [{
          minQty,
          scope,
          size: tier.size == null ? null : String(tier.size),
          unitPrice,
          discountPct,
        }];
      })
    : [];
  const promo = record.promotion && typeof record.promotion === "object"
    ? record.promotion as Record<string, unknown>
    : null;
  const promotion: Promotion | null = promo?.kind === "BUY_X_GET_Y"
    && Number.isInteger(Number(promo.buyQty)) && Number(promo.buyQty) >= 1
    && Number.isInteger(Number(promo.getQty)) && Number(promo.getQty) >= 1
      ? { kind: "BUY_X_GET_Y", buyQty: Number(promo.buyQty), getQty: Number(promo.getQty) }
      : promo?.kind === "N_FOR_PRICE"
        && Number.isInteger(Number(promo.buyQty)) && Number(promo.buyQty) >= 1
        && Number.isFinite(Number(promo.bundlePrice)) && Number(promo.bundlePrice) >= 0
          ? { kind: "N_FOR_PRICE", buyQty: Number(promo.buyQty), bundlePrice: Number(promo.bundlePrice) }
          : null;
  return { priceTiers: canonicalPriceTiers(priceTiers), promotion };
}

export type RemainingPricingLine = {
  id: number;
  sku: string;
  size: string;
  /** จำนวนหน่วยฐานในบรรทัดเดิม */
  qty: number;
  /** จำนวนหน่วยขายในบรรทัดเดิม */
  packQty: number;
  returnedPackQty: number;
  receiptUnitPrice: number;
  packUnitPrice: number | null;
  pricingSnapshot: unknown;
};

/**
 * ประเมินตะกร้าที่ลูกค้า "เก็บไว้" หลังคืน ด้วยกติกา ณ ตอนขาย
 *
 * Named pack คงราคาแพ็กตามเดิม แต่จำนวนหน่วยฐานในแพ็กยังนับเข้า threshold ราคา
 * ส่งของ SKU เหมือนตอนสร้างออร์เดอร์ ส่วน BASE ต้องทดสอบราคาส่ง/โปรใหม่จากจำนวน
 * คงเหลือทั้งหมด ไม่ใช่รักษาราคาที่เคยผ่านขั้นต่ำไว้ตลอดอายุบิล
 */
export function priceRemainingLines(
  lines: RemainingPricingLine[],
  additionalReturns: ReadonlyMap<number, number> = new Map()
): {
  pricingSubtotal: number;
  shelfSubtotal: number;
  pricingDiscount: number;
  lines: Array<{ id: number; remainingPackQty: number; amount: number; shelfAmount: number }>;
} {
  const remaining = lines.map((line) => {
    const originalPackQty = Math.max(1, Math.trunc(Number(line.packQty)));
    const returned = Math.max(0, Math.trunc(Number(line.returnedPackQty) || 0));
    const extra = Math.max(0, Math.trunc(Number(additionalReturns.get(line.id) ?? 0)));
    const remainingPackQty = Math.max(0, originalPackQty - returned - extra);
    const baseQtyPerPack = Math.max(1, Math.round(Number(line.qty) / originalPackQty));
    return { ...line, remainingPackQty, remainingBaseQty: remainingPackQty * baseQtyPerPack };
  });
  const variantKey = (sku: string, size: string) => `${sku}\u0000${size}`;
  const qtyByVariant = new Map<string, number>();
  const qtyBySku = new Map<string, number>();
  for (const line of remaining) {
    const key = variantKey(line.sku, line.size);
    qtyByVariant.set(key, (qtyByVariant.get(key) ?? 0) + line.remainingBaseQty);
    qtyBySku.set(line.sku, (qtyBySku.get(line.sku) ?? 0) + line.remainingBaseQty);
  }

  const priced = remaining.map((line) => {
    const shelfAmount = round2(line.receiptUnitPrice * line.remainingPackQty);
    if (line.packUnitPrice != null) {
      return {
        id: line.id,
        remainingPackQty: line.remainingPackQty,
        amount: round2(line.packUnitPrice * line.remainingPackQty),
        shelfAmount,
      };
    }
    const snapshot = normalizePricingSnapshot(line.pricingSnapshot);
    const promo = snapshot.promotion;
    const amount = promo
      ? applyPromotion(line.receiptUnitPrice, line.remainingBaseQty, promo).amount
      : round2(unitPriceForQty(
          line.receiptUnitPrice,
          snapshot.priceTiers,
          qtyByVariant.get(variantKey(line.sku, line.size)) ?? line.remainingBaseQty,
          qtyBySku.get(line.sku) ?? line.remainingBaseQty,
          line.size
        ) * line.remainingBaseQty);
    return { id: line.id, remainingPackQty: line.remainingPackQty, amount, shelfAmount };
  });
  const pricingSubtotal = round2(priced.reduce((sum, line) => sum + line.amount, 0));
  const shelfSubtotal = round2(priced.reduce((sum, line) => sum + line.shelfAmount, 0));
  return {
    pricingSubtotal,
    shelfSubtotal,
    pricingDiscount: round2(Math.max(0, shelfSubtotal - pricingSubtotal)),
    lines: priced,
  };
}

/**
 * BASE คือหน่วยฐานของสินค้า ไม่ใช่แพ็กที่มีราคาคงที่ของตัวเอง จึงยังเข้า
 * ราคาส่งและโปรโมชันได้ตามปกติ ส่วน packCode อื่นต้องคงราคาแพ็กและไม่ให้
 * กลไกราคาต่อชิ้นเข้ามาทับ แม้แพ็กนั้นจะมี baseQty = 1 ก็ตาม
 */
export function normalizePackCode(packCode: string | null | undefined): string {
  return String(packCode ?? "BASE").trim().toUpperCase() || "BASE";
}

export function isFixedPricePack(packCode: string | null | undefined): boolean {
  return normalizePackCode(packCode) !== "BASE";
}

/** เรียงกฎให้ signature/cache คงที่ แม้ DB คืนแถวขั้นต่ำเดียวกันคนละลำดับ */
export function canonicalPriceTiers(tiers: PriceTier[]): PriceTier[] {
  const text = (value: unknown) => value == null ? "" : String(value);
  return [...tiers].sort((a, b) => (
    a.minQty - b.minQty
    || text(a.scope ?? "PER_VARIANT_FIXED").localeCompare(text(b.scope ?? "PER_VARIANT_FIXED"))
    || text(a.size).localeCompare(text(b.size))
    || text(a.unitPrice).localeCompare(text(b.unitPrice))
    || text(a.discountPct).localeCompare(text(b.discountPct))
  ));
}

/**
 * ราคาต่อหน่วยฐานสำหรับจำนวนที่ซื้อ
 *
 * ขั้นที่ minQty สูงสุดที่ "ไม่เกิน" จำนวนที่ซื้อชนะ · ไม่มีขั้นไหนเข้าเงื่อนไข = ราคาปกติ
 *
 * ไม่บังคับว่าขั้นที่สูงกว่าต้องถูกกว่า และไม่แก้ให้เอง — ร้านที่ตั้งราคาขั้นสูงแพงกว่า
 * ขั้นต่ำอาจตั้งใจจริง (เช่นชาร์จเพิ่มเมื่อซื้อยกลัง เพราะต้องแพ็กพิเศษ) หน้าที่ของ
 * ฟังก์ชันนี้คือทำตามที่ตั้งไว้อย่างคาดเดาได้ ไม่ใช่เดาเจตนา
 */
export function unitPriceForQty(
  basePrice: number,
  tiers: PriceTier[],
  variantQty: number,
  skuQty: number = variantQty,
  size: string | null = null
): number {
  if (!Number.isFinite(variantQty) || variantQty <= 0) return basePrice;

  let best: PriceTier | null = null;
  let bestPriority = -1;
  for (const tier of tiers) {
    if (!Number.isFinite(tier.minQty) || tier.minQty < 2) continue;
    const scope = tier.scope ?? "PER_VARIANT_FIXED";
    const targetSize = tier.size == null ? null : String(tier.size);
    if (scope === "PER_VARIANT_FIXED" && targetSize != null && targetSize !== size) continue;
    if (scope === "CROSS_VARIANT_PERCENT" && targetSize != null) continue;
    const qualifyingQty = tier.scope === "CROSS_VARIANT_PERCENT" ? skuQty : variantQty;
    if (!Number.isFinite(qualifyingQty) || tier.minQty > qualifyingQty) continue;
    // เมื่อขั้นต่ำเท่ากัน กฎเฉพาะไซซ์ชนะ cross-size และกฎเก่าที่ใช้ร่วมทุกไซซ์
    // เพื่อให้ผลไม่ขึ้นกับลำดับแถวจากฐานข้อมูล
    const priority = scope === "PER_VARIANT_FIXED" && targetSize != null
      ? 2
      : scope === "CROSS_VARIANT_PERCENT"
        ? 1
        : 0;
    if (!best || tier.minQty > best.minQty || (tier.minQty === best.minQty && priority > bestPriority)) {
      best = tier;
      bestPriority = priority;
    }
  }
  if (!best) return basePrice;
  if (best.scope === "CROSS_VARIANT_PERCENT") {
    const discountPct = Number(best.discountPct);
    if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct > 100) return basePrice;
    return round2(basePrice * (1 - discountPct / 100));
  }
  const unitPrice = Number(best.unitPrice);
  return Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : basePrice;
}

/**
 * ราคาของทั้งบิล: ราคาคงที่แยก SKU+ไซซ์ หรือเปอร์เซ็นต์รวมจำนวนทั้ง SKU
 *
 * โหมดรวมข้ามไซซ์ใช้ได้เฉพาะเปอร์เซ็นต์ เพื่อให้แต่ละไซซ์ยังลดจากราคาฐานของตัวเอง
 * และไม่เกิดราคาเดียวที่ลดไซซ์แพงลึกกว่าไซซ์ถูกโดยไม่ตั้งใจ
 *
 * บรรทัดที่ขายเป็นหน่วยขาย (pack) ไม่ถูกแตะ — ราคา pack คือการบอกตรง ๆ ว่ากล่องนี้
 * ราคาเท่านี้ ให้สองกลไกแย่งกันตัดสินราคาจะอธิบายบิลไม่ได้ · แต่จำนวนของ pack
 * ยังนับรวมใน threshold ของ SKU+ไซซ์เดียวกัน แต่บรรทัด pack เองคงราคา pack ไว้
 */
export function priceLinesByQty<T extends { sku: string; size?: string; qty: number; packUnitPrice?: number | null }>(
  lines: T[],
  basePriceBySku: Map<string, number>,
  tiersBySku: Map<string, PriceTier[]>
): Array<T & { unitPrice: number; tierApplied: boolean }> {
  const keyOf = (line: T) => line.size == null ? line.sku : `${line.sku}\u0000${line.size}`;
  const totalByVariant = new Map<string, number>();
  const totalBySku = new Map<string, number>();
  for (const line of lines) {
    const key = keyOf(line);
    totalByVariant.set(key, (totalByVariant.get(key) ?? 0) + Math.max(0, line.qty));
    totalBySku.set(line.sku, (totalBySku.get(line.sku) ?? 0) + Math.max(0, line.qty));
  }

  return lines.map((line) => {
    const key = keyOf(line);
    const basePrice = basePriceBySku.get(key) ?? basePriceBySku.get(line.sku) ?? 0;
    if (line.packUnitPrice != null) {
      return { ...line, unitPrice: basePrice, tierApplied: false };
    }
    const unitPrice = unitPriceForQty(
      basePrice,
      tiersBySku.get(line.sku) ?? [],
      totalByVariant.get(key) ?? 0,
      totalBySku.get(line.sku) ?? 0,
      line.size ?? null
    );
    return { ...line, unitPrice, tierApplied: unitPrice !== basePrice };
  });
}


// =============================================================
// โปรโมชัน: ซื้อ X แถม Y / N ชิ้นราคาเดียว (8.7)
// -------------------------------------------------------------
// ทำเป็นกลไก "ราคาของกลุ่มชิ้น" ไม่ใช่ส่วนลดอีกชั้น เพราะโปรที่ร้านประกาศไว้ต้องไม่
// ถูกตัดด้วยเพดาน max_discount_pct ของบิลนั้น (ร้านจะผิดคำพูดกับลูกค้าเพราะกฎภายใน
// ของตัวเอง) และเพราะลูกค้าเข้าใจว่า "3 ชิ้น 100" คือราคาของสามชิ้นนั้น ไม่ใช่
// ส่วนลดก้อนท้ายบิล
// =============================================================

export type Promotion =
  | { kind: "BUY_X_GET_Y"; buyQty: number; getQty: number }
  | { kind: "N_FOR_PRICE"; buyQty: number; bundlePrice: number };

export type SkuPricingSnapshot = {
  sku: string;
  priceTiers?: PriceTier[];
  promotion?: Promotion | null;
  serialTracked?: boolean;
};

/**
 * ขั้นราคาส่งและโปรโมชันมีขอบเขตระดับ SKU ไม่ใช่ระดับ SKU+ไซซ์ จึงต้องเปลี่ยน
 * snapshot ของทุกไซซ์พร้อมกันเมื่อ scan ล่าสุดได้กฎชุดใหม่ มิฉะนั้นตะกร้าเดียวกัน
 * อาจเอาไซซ์ M คิดด้วยกฎเก่า แต่ XL คิดด้วยกฎใหม่ก่อนถึงขั้น server ตรวจยอด
 */
export function syncSkuPricingSnapshot<T extends SkuPricingSnapshot>(
  lines: T[],
  latest: SkuPricingSnapshot
): T[] {
  return lines.map((line) => line.sku !== latest.sku ? line : ({
    ...line,
    priceTiers: latest.priceTiers,
    promotion: latest.promotion,
    serialTracked: latest.serialTracked,
  } as T));
}

export type PromotionOutcome = {
  /** ยอดที่ต้องจ่ายสำหรับสินค้านั้นทั้งหมดในบิล */
  amount: number;
  /** จำนวนชิ้นที่ได้ฟรี (BUY_X_GET_Y) — พิมพ์บนใบเสร็จให้ลูกค้าเห็นว่าได้อะไร */
  freeQty: number;
  /** ส่วนต่างจากราคาเต็ม — ใช้โชว์ว่า "ประหยัด ฿x" ไม่ได้เข้า discount_amount */
  saved: number;
};

/**
 * ยอดที่ต้องจ่ายของสินค้าหนึ่งตัวเมื่อมีโปร
 *
 * ทั้งสองแบบคิดจากจำนวนรวมของ SKU+ไซซ์นั้นในบิล เหมือนขั้นราคาส่ง (8.1)
 * เพื่อให้ราคาฐานของคนละไซซ์ไม่ถูกนำมาคิดรวมกัน
 *
 * BUY_X_GET_Y: ทุก (buy + get) ชิ้น จ่ายแค่ buy ชิ้น
 *   ซื้อ 3 แถม 1 · หยิบ 4 → จ่าย 3 · หยิบ 7 → จ่าย 6 (ครบชุดเดียว เหลือเศษ 3 จ่ายเต็ม)
 *   หยิบ 8 → จ่าย 6 (ครบสองชุด)
 *   เศษที่ไม่ครบชุดจ่ายราคาเต็ม — ไม่ใช่เฉลี่ยลงทุกชิ้น เพราะลูกค้านับเองได้ว่าได้ฟรีกี่ชิ้น
 *
 * N_FOR_PRICE: ทุก buy ชิ้นคิด bundlePrice · เศษจ่ายราคาเต็มต่อชิ้น
 *   3 ชิ้น 100 (ราคาปกติ 40) · หยิบ 4 → 100 + 40 = 140
 *   ถ้าราคาชุดแพงกว่าซื้อแยก จะไม่ใช้โปรให้ (ดูด้านล่าง)
 */
export function applyPromotion(basePrice: number, qty: number, promo: Promotion | null): PromotionOutcome {
  const full = round2(Math.max(0, basePrice) * Math.max(0, qty));
  if (!promo || qty <= 0 || basePrice < 0) return { amount: full, freeQty: 0, saved: 0 };

  if (promo.kind === "BUY_X_GET_Y") {
    const groupSize = promo.buyQty + promo.getQty;
    if (groupSize <= 0) return { amount: full, freeQty: 0, saved: 0 };
    const groups = Math.floor(qty / groupSize);
    const freeQty = groups * promo.getQty;
    const amount = round2(basePrice * (qty - freeQty));
    return { amount, freeQty, saved: round2(full - amount) };
  }

  if (promo.buyQty <= 0) return { amount: full, freeQty: 0, saved: 0 };
  const bundles = Math.floor(qty / promo.buyQty);
  const remainder = qty - bundles * promo.buyQty;
  const amount = round2(bundles * promo.bundlePrice + remainder * basePrice);

  // โปรที่แพงกว่าซื้อแยกต้องไม่ถูกบังคับใช้ — ร้านตั้งราคาชุดผิด (หรือลดราคาปกติ
  // ลงมาต่ำกว่าราคาชุดทีหลัง) เป็นเรื่องที่เกิดจริง และการเก็บเงินลูกค้าแพงขึ้น
  // เพราะ "โปร" คือความเสียหายที่ร้านอธิบายไม่ได้ · เลือกยอดที่ต่ำกว่าเสมอ
  if (amount >= full) return { amount: full, freeQty: 0, saved: 0 };
  return { amount, freeQty: 0, saved: round2(full - amount) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
