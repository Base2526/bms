/**
 * ราคาของตะกร้าบนเครื่องขายมือถือ — ต้องได้เลขเดียวกับที่ `createOrderInTx()` คิดตอน commit
 *
 * ⚠️ นี่คือกฎเดียวกับ `apps/web/lib/bms/pricing.ts` + `apps/web/lib/pos/cashRounding.ts`
 * ที่ต้องคัดลอกมา เพราะ Metro ของ `apps/mobile` มี projectRoot เป็นโฟลเดอร์ตัวเอง
 * (ไม่มี watchFolders) จึง import ข้ามแอปไม่ได้ · `scripts/mobile-cart-pricing-contract.test.mts`
 * ป้อนอินพุตชุดเดียวกันเข้าทั้งสองฝั่งแล้วบังคับให้ได้ผลตรงกัน — แก้ฝั่งเว็บแล้วไม่แก้ที่นี่ = แดง
 *
 * ทำไมต้องมี: `recordPosSale()` เทียบ "ผลรวมเงินที่เครื่องส่งมา" กับยอดที่ server คิดเอง
 * ถ้าต่างกันเกิน 1 สตางค์ **บิลถูกยกเลิกทิ้งทั้งใบ** (`PAYMENT_MISMATCH`) ต่อหน้าลูกค้า
 * ก่อนไฟล์นี้ แอปคิด `qty × unitPrice` ล้วน ๆ → ร้านที่ตั้งราคาส่ง (8.1) โปรโมชัน (8.7)
 * หรือเปิดปัดเศษเงินสด (7.95) **ขายจากมือถือไม่ได้เลยสักบิล**
 *
 * ไฟล์นี้ตั้งใจไม่ import อะไรเลย (แบบ cartLine.ts / shiftMath.ts) — เทสได้โดยไม่ต้องมี React
 */

export type PriceTier = {
  /** ซื้อครบกี่หน่วยฐานถึงได้ราคานี้ */
  minQty: number;
  /** ไม่ระบุ = แยกจำนวนต่อ SKU+ไซซ์ */
  scope?: 'PER_VARIANT_FIXED' | 'CROSS_VARIANT_PERCENT' | null;
  /** เฉพาะราคาคงที่: null = ใช้ราคาเดียวทุกไซซ์ */
  size?: string | null;
  unitPrice?: number | null;
  discountPct?: number | null;
};

export type Promotion =
  | { kind: 'BUY_X_GET_Y'; buyQty: number; getQty: number }
  | { kind: 'N_FOR_PRICE'; buyQty: number; bundlePrice: number };

export type CashRounding = 'NONE' | '0.25' | '0.50' | '1.00';

const round2 = (value: number) => Math.round(value * 100) / 100;

export function normalizePackCode(packCode: string | null | undefined): string {
  return String(packCode ?? 'BASE').trim().toUpperCase() || 'BASE';
}

/**
 * BASE คือหน่วยฐานของสินค้า ไม่ใช่แพ็กที่มีราคาของตัวเอง จึงยังเข้าราคาส่ง/โปรได้
 * ส่วน packCode ที่ตั้งชื่อแยกยึดราคาแพ็กคงที่ แม้ baseQty จะเป็น 1 ก็ตาม
 */
export function isFixedPricePack(packCode: string | null | undefined): boolean {
  return normalizePackCode(packCode) !== 'BASE';
}

/** แปลงค่าที่ `bmsPosScan` ส่งมาให้เป็นรูปที่คิดเงินได้ — รูปที่อ่านไม่ออกทิ้ง ไม่เดาแทน */
export function normalizePriceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((candidate): PriceTier[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const tier = candidate as Record<string, unknown>;
    const minQty = Number(tier.minQty);
    if (!Number.isInteger(minQty) || minQty < 2) return [];
    const scope =
      tier.scope === 'CROSS_VARIANT_PERCENT'
        ? ('CROSS_VARIANT_PERCENT' as const)
        : ('PER_VARIANT_FIXED' as const);
    const unitPrice = tier.unitPrice == null ? null : Number(tier.unitPrice);
    const discountPct =
      tier.discountPct == null ? null : Number(tier.discountPct);
    if (
      scope === 'CROSS_VARIANT_PERCENT' &&
      (!Number.isFinite(discountPct) || discountPct! <= 0 || discountPct! > 100)
    ) {
      return [];
    }
    if (
      scope === 'PER_VARIANT_FIXED' &&
      (!Number.isFinite(unitPrice) || unitPrice! < 0)
    ) {
      return [];
    }
    return [
      {
        minQty,
        scope,
        size: tier.size == null ? null : String(tier.size),
        unitPrice,
        discountPct,
      },
    ];
  });
}

export function normalizePromotion(raw: unknown): Promotion | null {
  if (!raw || typeof raw !== 'object') return null;
  const promo = raw as Record<string, unknown>;
  const buyQty = Number(promo.buyQty);
  if (!Number.isInteger(buyQty) || buyQty < 1) return null;
  if (promo.kind === 'BUY_X_GET_Y') {
    const getQty = Number(promo.getQty);
    if (!Number.isInteger(getQty) || getQty < 1) return null;
    return { kind: 'BUY_X_GET_Y', buyQty, getQty };
  }
  if (promo.kind === 'N_FOR_PRICE') {
    const bundlePrice = Number(promo.bundlePrice);
    if (!Number.isFinite(bundlePrice) || bundlePrice < 0) return null;
    return { kind: 'N_FOR_PRICE', buyQty, bundlePrice };
  }
  return null;
}

/**
 * ราคาต่อหน่วยฐานสำหรับจำนวนที่ซื้อ — ขั้นที่ minQty สูงสุดที่ไม่เกินจำนวนที่ซื้อชนะ
 * ขั้นต่ำเท่ากัน: กฎเฉพาะไซซ์ชนะ cross-size และกฎที่ใช้ร่วมทุกไซซ์ เพื่อไม่ให้ผลขึ้นกับลำดับแถว
 */
export function unitPriceForQty(
  basePrice: number,
  tiers: readonly PriceTier[],
  variantQty: number,
  skuQty: number = variantQty,
  size: string | null = null,
): number {
  if (!Number.isFinite(variantQty) || variantQty <= 0) return basePrice;

  let best: PriceTier | null = null;
  let bestPriority = -1;
  for (const tier of tiers) {
    if (!Number.isFinite(tier.minQty) || tier.minQty < 2) continue;
    const scope = tier.scope ?? 'PER_VARIANT_FIXED';
    const targetSize = tier.size == null ? null : String(tier.size);
    if (
      scope === 'PER_VARIANT_FIXED' &&
      targetSize != null &&
      targetSize !== size
    ) {
      continue;
    }
    if (scope === 'CROSS_VARIANT_PERCENT' && targetSize != null) continue;
    const qualifyingQty =
      tier.scope === 'CROSS_VARIANT_PERCENT' ? skuQty : variantQty;
    if (!Number.isFinite(qualifyingQty) || tier.minQty > qualifyingQty) continue;
    const priority =
      scope === 'PER_VARIANT_FIXED' && targetSize != null
        ? 2
        : scope === 'CROSS_VARIANT_PERCENT'
        ? 1
        : 0;
    if (
      !best ||
      tier.minQty > best.minQty ||
      (tier.minQty === best.minQty && priority > bestPriority)
    ) {
      best = tier;
      bestPriority = priority;
    }
  }
  if (!best) return basePrice;
  if (best.scope === 'CROSS_VARIANT_PERCENT') {
    const discountPct = Number(best.discountPct);
    if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct > 100) {
      return basePrice;
    }
    return round2(basePrice * (1 - discountPct / 100));
  }
  const unitPrice = Number(best.unitPrice);
  return Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : basePrice;
}

export type PromotionOutcome = {
  amount: number;
  freeQty: number;
  saved: number;
};

/**
 * ยอดที่ต้องจ่ายของสินค้าหนึ่งตัวเมื่อมีโปร — คิดจากจำนวนรวมของ SKU+ไซซ์นั้นในบิล
 * โปรที่แพงกว่าซื้อแยกไม่ถูกบังคับใช้ (เลือกยอดที่ต่ำกว่าเสมอ)
 */
export function applyPromotion(
  basePrice: number,
  qty: number,
  promo: Promotion | null,
): PromotionOutcome {
  const full = round2(Math.max(0, basePrice) * Math.max(0, qty));
  if (!promo || qty <= 0 || basePrice < 0) {
    return { amount: full, freeQty: 0, saved: 0 };
  }

  if (promo.kind === 'BUY_X_GET_Y') {
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
  if (amount >= full) return { amount: full, freeQty: 0, saved: 0 };
  return { amount, freeQty: 0, saved: round2(full - amount) };
}

/**
 * บรรทัดในตะกร้าเท่าที่การคิดราคาสนใจ
 *
 * ฟิลด์ราคาแยกเป็นสามตัวโดยตั้งใจ: ราคาส่ง/โปรคิดจาก **ราคาป้ายต่อหน่วยฐาน** ส่วนตัวเลือก
 * เป็นส่วนเพิ่มต่อหน่วยขายที่บวกทีหลัง (ตรงกับ `modifierTotal` ของ createOrderInTx)
 * ถ้ายุบเป็นราคาเดียว ตัวเลือกจะถูกลดราคาตามโปรไปด้วย ซึ่ง server ไม่ได้ทำ
 */
export interface PricedCartLine {
  sku: string;
  size: string;
  packCode: string;
  /** จำนวน "หน่วยขาย" ในตะกร้า */
  qty: number;
  /** 1 หน่วยขาย = กี่หน่วยฐาน */
  baseQty: number;
  /** ราคาป้ายต่อหน่วยฐาน ไม่รวมตัวเลือก */
  basePrice?: number | null;
  /** ราคาต่อหน่วยขาย ไม่รวมตัวเลือก */
  packBasePrice?: number | null;
  /** ส่วนเพิ่มของตัวเลือกต่อหน่วยขายที่คิดเงิน */
  modifierUnitPrice?: number | null;
  /** ป้ายเครื่องชั่ง — บรรทัดชั่งขายคิดเป็นหน่วยฐานทั้งบรรทัด */
  scaleBarcode?: string | null;
  priceTiers?: readonly PriceTier[] | null;
  promotion?: Promotion | null;
  /** ใช้เป็นราคาสำรองเมื่อบรรทัดยังไม่มี snapshot (บิลพักรุ่นเก่า/บิลเปลี่ยนสินค้า) */
  unitPrice?: number | null;
}

type ResolvedLine = {
  key: string;
  sku: string;
  size: string;
  listPrice: number;
  packBasePrice: number;
  modifierUnitPrice: number;
  packQty: number;
  baseUnits: number;
  soldUnits: number;
  fixedPack: boolean;
  tiers: PriceTier[];
  promotion: Promotion | null;
};

const variantKey = (sku: string, size: string) => `${sku} ${size}`;

function resolveLine(line: PricedCartLine): ResolvedLine {
  const packQty = Math.max(0, Number(line.qty) || 0);
  const perPack = Math.max(1, Number(line.baseQty) || 1);
  const scale = Boolean(line.scaleBarcode);
  const baseUnits = packQty * perPack;
  const rawPackPrice = Number(line.packBasePrice ?? line.unitPrice ?? 0);
  const packBasePrice = Number.isFinite(rawPackPrice) ? rawPackPrice : 0;
  const rawBasePrice = Number(line.basePrice);
  // ⚠️ ไม่มีราคาป้ายต่อหน่วยฐานติดมา (บรรทัดยุคก่อน snapshot) ต้องหารกลับจากราคาหน่วยขาย
  // ห้ามใช้ราคาหน่วยขายตรง ๆ — บรรทัดชั่งขายมี baseQty = จำนวนกรัม ถ้าใช้ตรง ๆ จะกลายเป็น
  // (ราคาทั้งถุง × จำนวนกรัม) ซึ่งเกินความจริงหลายร้อยเท่า
  const listPrice = Number.isFinite(rawBasePrice)
    ? rawBasePrice
    : packBasePrice / perPack;
  return {
    key: variantKey(line.sku, line.size),
    sku: line.sku,
    size: line.size,
    listPrice: Number.isFinite(listPrice) ? listPrice : 0,
    packBasePrice,
    modifierUnitPrice: Math.max(0, Number(line.modifierUnitPrice) || 0),
    packQty,
    baseUnits,
    // บรรทัดชั่งขายถูก canonicalize เป็น packCode BASE ที่ packQty = จำนวนหน่วยฐาน
    soldUnits: scale ? baseUnits : packQty,
    fixedPack: !scale && isFixedPricePack(line.packCode),
    tiers: normalizePriceTiers(line.priceTiers),
    promotion: line.promotion ?? null,
  };
}

/**
 * ยอดสินค้าก่อนส่วนลดทุกชั้น — ลำดับเดียวกับ `createOrderInTx()` เป๊ะ ๆ
 *
 * 1. ราคาส่งคิดจากจำนวนหน่วยฐานรวมทั้งบิล (ต่อ SKU+ไซซ์ และต่อ SKU สำหรับขั้นแบบเปอร์เซ็นต์)
 * 2. โปรคิด **ครั้งเดียวต่อ SKU+ไซซ์** จากราคาป้าย ไม่ใช่ต่อบรรทัด
 * 3. บรรทัดที่ขายเป็นหน่วยขายที่ตั้งราคาเอง (pack) ไม่เข้าทั้งราคาส่งและโปร
 *    แต่จำนวนยังนับเข้าขั้นราคาส่งของ SKU+ไซซ์เดียวกัน
 * 4. ตัวเลือกบวกท้ายสุดตามจำนวนหน่วยขายที่คิดเงิน
 */
export function cartProductSubtotal(lines: readonly PricedCartLine[]): number {
  const resolved = lines.map(resolveLine);

  const qtyByVariant = new Map<string, number>();
  const qtyBySku = new Map<string, number>();
  const promoQtyByVariant = new Map<string, number>();
  const tiersBySku = new Map<string, PriceTier[]>();
  const promoBySku = new Map<string, Promotion>();
  for (const line of resolved) {
    qtyByVariant.set(line.key, (qtyByVariant.get(line.key) ?? 0) + line.baseUnits);
    qtyBySku.set(line.sku, (qtyBySku.get(line.sku) ?? 0) + line.baseUnits);
    // หน่วยขายที่ตั้งราคาเองนับเข้าขั้นราคาส่งได้ แต่ต้องอยู่นอกโปรทั้งหมด
    // ไม่งั้นมันทั้งปลดโปรของหน่วยฐานและถูกคิดเงินซ้ำในยอดของโปร
    if (!line.fixedPack) {
      promoQtyByVariant.set(
        line.key,
        (promoQtyByVariant.get(line.key) ?? 0) + line.baseUnits,
      );
    }
    if (line.tiers.length) tiersBySku.set(line.sku, line.tiers);
    if (line.promotion) promoBySku.set(line.sku, line.promotion);
  }

  const promoCharged = new Set<string>();
  let total = 0;
  for (const line of resolved) {
    const baseUnitPrice = line.fixedPack
      ? line.listPrice
      : unitPriceForQty(
          line.listPrice,
          tiersBySku.get(line.sku) ?? [],
          qtyByVariant.get(line.key) ?? line.baseUnits,
          qtyBySku.get(line.sku) ?? line.baseUnits,
          line.size,
        );
    const promo = line.fixedPack ? null : promoBySku.get(line.sku) ?? null;
    if (promo && !promoCharged.has(line.key)) {
      promoCharged.add(line.key);
      total += applyPromotion(
        line.listPrice,
        promoQtyByVariant.get(line.key) ?? line.baseUnits,
        promo,
      ).amount;
    } else if (!promo) {
      total += line.fixedPack
        ? line.packBasePrice * line.packQty
        : baseUnitPrice * line.baseUnits;
    }
    total += line.modifierUnitPrice * line.soldUnits;
  }
  return round2(total);
}

/**
 * ลายนิ้วมือของ "กติกาที่ตัดสินราคาบรรทัดนี้" — ใช้ตอบคำถามเดียว: ราคาเปลี่ยนไปหรือยัง
 *
 * จำนวนที่แคชเชียร์กดไม่อยู่ในนี้โดยตั้งใจ — การกดเพิ่ม/ลดไม่ใช่ "ราคาเปลี่ยน"
 * ตัวเลือกอยู่ในนี้เพราะ `price_delta` เข้ายอดบิลเหมือนราคาป้าย
 */
export function cartLinePricingSignature(line: PricedCartLine): string {
  return JSON.stringify({
    sku: line.sku,
    size: line.size,
    packCode: normalizePackCode(line.packCode),
    scaleBarcode: line.scaleBarcode ?? null,
    baseQty: line.baseQty,
    basePrice: line.basePrice ?? null,
    packBasePrice: line.packBasePrice ?? line.unitPrice ?? null,
    modifierUnitPrice: line.modifierUnitPrice ?? 0,
    priceTiers: [...normalizePriceTiers(line.priceTiers)].sort((a, b) =>
      a.minQty - b.minQty ||
      String(a.scope).localeCompare(String(b.scope)) ||
      String(a.size).localeCompare(String(b.size)),
    ),
    promotion: line.promotion ?? null,
  });
}

/**
 * ส่วนต่างของการปัดเศษเงินสด (7.95) — ปัดเข้าหาค่าที่ใกล้ที่สุด เศษครึ่งพอดีปัดขึ้น
 * ยอดปัดไม่ใช่ส่วนลด จึงไม่แตะฐาน VAT และเป็นบรรทัดของตัวเองบนใบเสร็จ
 */
export function cashRoundingDelta(amount: number, mode: CashRounding): number {
  if (mode === 'NONE') return 0;
  const step = Number(mode);
  if (!Number.isFinite(step) || step <= 0) return 0;
  const rounded = Math.round(amount / step + Number.EPSILON) * step;
  return Math.round((rounded - amount) * 100) / 100;
}

export function isCashRounding(value: unknown): value is CashRounding {
  return (
    value === 'NONE' ||
    value === '0.25' ||
    value === '0.50' ||
    value === '1.00'
  );
}

/**
 * ปัดเศษได้เฉพาะบิลที่ **ทุกช่องทางเป็นเงินสด** — กฎเดียวกับ `recordPosSale()`
 * ก่อนกรอกจำนวนเงิน ใช้วิธีจ่ายที่เลือกไว้ตัดสินแทน (ไม่งั้นยอดกระพริบตอนเริ่มพิมพ์)
 */
export function cashRoundingForPayments(
  payableBeforeRounding: number,
  mode: CashRounding,
  payments: ReadonlyArray<{ method: string; amount: number }>,
): number {
  if (mode === 'NONE' || payableBeforeRounding <= 0) return 0;
  const withAmount = payments.filter(
    payment => (Number(payment.amount) || 0) > 0,
  );
  const considered = withAmount.length > 0 ? withAmount : payments;
  if (considered.length === 0) return 0;
  const allCash = considered.every(
    payment => String(payment.method).toUpperCase() === 'CASH',
  );
  if (!allCash) return 0;
  return cashRoundingDelta(payableBeforeRounding, mode);
}

/** ยอดที่ต้องเก็บจริง = ยอดสินค้าหลังส่วนลด + ค่าบริการ + ปัดเศษ */
export function payableWithRounding(
  payableBeforeRounding: number,
  roundingDelta: number,
): number {
  return round2(payableBeforeRounding + roundingDelta);
}
