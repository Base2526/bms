// =============================================================
// BMS loyalty — เลขคณิตส่วนลดสมาชิก (pure, ไม่แตะ DB)  migration 7.96
// -------------------------------------------------------------
// แยกออกมาจาก membership.ts เพราะสองทางเรียกใช้ฟังก์ชันชุดนี้และ "ต้องได้เลข
// เดียวกันเป๊ะ ๆ":
//   1) จอ POS ตอน preview (POST /api/pos/member/preview)
//   2) createOrder() ตอน commit จริง
// ถ้าสองทางต่างกันแม้สตางค์เดียว ยอดที่เครื่องส่งมาจะไม่ตรงกับที่ server คิด
// แล้วบิลถูกยกเลิกทิ้งด้วย PAYMENT_MISMATCH ทั้งใบ
//
// ไฟล์นี้ห้าม import อะไรเลย เพื่อให้ scripts/loyalty-contract.test.mts รันได้
// โดยไม่ต้องมี DB/ตัว resolve path alias
// =============================================================

export type LoyaltyEarnMode = "SPEND" | "VISIT";
export type LoyaltyEarnBase = "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";
export type TierDiscountType = "NONE" | "PERCENT" | "FIXED";

export type LoyaltySettings = {
  enabled: boolean;
  earnMode: LoyaltyEarnMode;
  earnPointsPerBaht: number;
  visitPoints: number;
  earnMinSpend: number;
  earnBase: LoyaltyEarnBase;
  redeemPointsPerUnit: number;
  redeemBahtPerUnit: number;
  redeemMinPoints: number;
  maxDiscountPct: number;
  pointsExpireMonths: number;
};

export type MembershipTier = {
  id: string;
  code: string;
  name: string;
  discountType: TierDiscountType;
  discountValue: number;
  qualifySpend12m: number;
  qualifyPoints: number;
  sortOrder: number;
  active: boolean;
};

/** ร้านที่ยังไม่มีแถว settings ถือว่าปิดโปรแกรม (ไม่ throw — POS ต้องขายได้ต่อ) */
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  earnMode: "SPEND",
  earnPointsPerBaht: 1,
  visitPoints: 1,
  earnMinSpend: 0,
  earnBase: "AFTER_DISCOUNT",
  redeemPointsPerUnit: 100,
  redeemBahtPerUnit: 10,
  redeemMinPoints: 100,
  maxDiscountPct: 100,
  pointsExpireMonths: 24,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ส่วนลดของชั้น คิดจากค่าสินค้า — FIXED ไม่เกินยอดบิล, PERCENT ปัด 2 ตำแหน่ง */
export function tierDiscountAmount(tier: MembershipTier | null, subtotal: number): number {
  if (!tier || !tier.active || tier.discountType === "NONE" || subtotal <= 0) return 0;
  if (tier.discountType === "PERCENT") return round2(subtotal * (tier.discountValue / 100));
  return round2(Math.min(tier.discountValue, subtotal));
}

/** แต้ม → บาท ตามอัตราของร้าน (ปัดลงเป็นหน่วยแลก ไม่ให้เศษแต้มได้ส่วนลดฟรี) */
export function pointsToDiscount(settings: LoyaltySettings, points: number): { points: number; discount: number } {
  if (points <= 0 || !settings.enabled) return { points: 0, discount: 0 };
  const units = Math.floor(points / settings.redeemPointsPerUnit);
  if (units <= 0) return { points: 0, discount: 0 };
  return {
    points: units * settings.redeemPointsPerUnit,
    discount: round2(units * settings.redeemBahtPerUnit),
  };
}

/**
 * แถวที่ให้แต้มต้องกลบยอดติดลบก่อน — ลูกค้าที่ยอดเป็น −50 จากการคืนสินค้า
 * ได้แต้มใหม่ 83 ต้องเหลือใช้ได้ 33 ไม่ใช่ 83
 */
export function consumedToCoverDeficit(balanceBefore: number, granted: number): number {
  const deficit = Math.max(0, -balanceBefore);
  return Math.min(granted, deficit);
}

export type MemberDiscountBreakdown = {
  subtotal: number;
  tierDiscount: number;
  tierLabel: string | null;
  couponDiscount: number;
  pointsDiscount: number;
  pointsUsed: number;
  manualDiscount: number;
  /** ผลรวมหลังบังคับเพดาน max_discount_pct */
  totalDiscount: number;
  /** ยอดสุทธิที่ลูกค้าต้องจ่าย (ยังไม่รวมค่าส่ง/ปัดเศษเงินสด) */
  netTotal: number;
  /** true = ส่วนลดถูกตัดเพราะชนเพดาน — จอต้องบอกพนักงาน */
  capped: boolean;
  cappedAt: number;
};

/**
 * ประกอบส่วนลดทุกชั้นตามลำดับตายตัว tier → คูปอง → แต้ม → ส่วนลดมือ
 * แล้วบังคับเพดานรวมต่อบิล ถ้าชนเพดานจะตัดจาก "ชั้นท้ายสุดก่อน" เพราะแต้ม/
 * ส่วนลดมือย้อนคืนได้ ส่วนคูปองที่นับ redemption แล้วย้อนยาก
 */
export function composeDiscounts(args: {
  settings: LoyaltySettings;
  subtotal: number;
  tier: MembershipTier | null;
  couponDiscount?: number;
  pointsRequested?: number;
  pointsAvailable?: number;
  manualDiscount?: number;
}): MemberDiscountBreakdown {
  const subtotal = round2(Math.max(0, args.subtotal));
  const cappedAt = round2(subtotal * (args.settings.maxDiscountPct / 100));

  const tierDiscount = tierDiscountAmount(args.tier, subtotal);
  const couponDiscount = round2(Math.max(0, args.couponDiscount ?? 0));
  const manualDiscount = round2(Math.max(0, args.manualDiscount ?? 0));

  // แลกได้ไม่เกินแต้มที่มี และไม่ต่ำกว่าขั้นต่ำที่ร้านกำหนด
  const requested = Math.max(0, Math.floor(args.pointsRequested ?? 0));
  const available = Math.max(0, Math.floor(args.pointsAvailable ?? 0));
  const redeemable = Math.min(requested, available);
  const points = args.settings.enabled && redeemable >= args.settings.redeemMinPoints
    ? pointsToDiscount(args.settings, redeemable)
    : { points: 0, discount: 0 };

  // ส่วนลดจากแต้มต้องไม่เกินยอดที่เหลือหลังหักชั้นอื่น — ลูกค้าจ่าย 0 ได้ แต่ห้ามติดลบ
  const beforePoints = round2(tierDiscount + couponDiscount + manualDiscount);
  const roomForPoints = Math.max(0, round2(Math.min(subtotal, cappedAt) - beforePoints));
  let pointsDiscount = Math.min(points.discount, roomForPoints);
  let pointsUsed = points.points;
  if (pointsDiscount < points.discount) {
    // ตัดจำนวนแต้มที่หักจริงลงตามส่วนลดที่ใช้ได้ ไม่หักแต้มที่ไม่ได้แปลงเป็นส่วนลด
    const units = Math.floor(pointsDiscount / args.settings.redeemBahtPerUnit);
    pointsUsed = units * args.settings.redeemPointsPerUnit;
    pointsDiscount = round2(units * args.settings.redeemBahtPerUnit);
  }

  const raw = round2(beforePoints + pointsDiscount);
  const totalDiscount = round2(Math.min(raw, cappedAt, subtotal));

  // ชนเพดานแล้วต้องตัดยอดของ "ชั้น" ให้ผลรวมเท่ากับ totalDiscount จริง ๆ
  // ไม่ใช่ปล่อยให้ตัวเลขต่อชั้นรวมกันเกิน — bms_order_discounts จะไม่ตรงกับ
  // discount_amount แล้วสืบย้อนใบกำกับไม่ได้ · ตัดจากชั้นที่ย้อนคืนง่ายที่สุดก่อน
  const trimmed = { tier: tierDiscount, coupon: couponDiscount, points: pointsDiscount, manual: manualDiscount };
  let over = round2(raw - totalDiscount);
  for (const key of ["manual", "points", "coupon", "tier"] as const) {
    if (over <= 0.001) break;
    const cut = Math.min(trimmed[key], over);
    trimmed[key] = round2(trimmed[key] - cut);
    over = round2(over - cut);
  }
  if (trimmed.points < pointsDiscount) {
    // ส่วนลดจากแต้มถูกตัด → จำนวนแต้มที่หักต้องลดตามด้วย ห้ามหักแต้มที่ไม่ได้เป็นส่วนลด
    const units = Math.floor(trimmed.points / args.settings.redeemBahtPerUnit);
    pointsUsed = units * args.settings.redeemPointsPerUnit;
    trimmed.points = round2(units * args.settings.redeemBahtPerUnit);
  }

  const finalTotal = round2(trimmed.tier + trimmed.coupon + trimmed.points + trimmed.manual);
  return {
    subtotal,
    tierDiscount: trimmed.tier,
    tierLabel: args.tier && trimmed.tier > 0
      ? `สมาชิก ${args.tier.name}${args.tier.discountType === "PERCENT" ? ` −${args.tier.discountValue}%` : ""}`
      : null,
    couponDiscount: trimmed.coupon,
    pointsDiscount: trimmed.points,
    pointsUsed,
    manualDiscount: trimmed.manual,
    totalDiscount: finalTotal,
    netTotal: round2(subtotal - finalTotal),
    capped: raw > totalDiscount + 0.001,
    cappedAt,
  };
}

/**
 * แต้มที่บิลนี้ได้ — ฐานคิดตาม earn_base (default หลังส่วนลด กันส่วนลดปั๊มแต้ม)
 * ปัดลงเสมอ: ครึ่งแต้มไม่มีอยู่จริง และปัดขึ้นทำให้ยอดขาย 0.5 บาทได้ 1 แต้ม
 */
export function pointsEarnedFor(
  settings: LoyaltySettings,
  args: { netTotal: number; discountAmount: number }
): number {
  if (!settings.enabled) return 0;
  const base = settings.earnBase === "BEFORE_DISCOUNT"
    ? round2(args.netTotal + args.discountAmount)
    : round2(args.netTotal);
  if (base < settings.earnMinSpend) return 0;
  const points = settings.earnMode === "VISIT"
    ? settings.visitPoints
    : Math.floor(base * settings.earnPointsPerBaht);
  return Math.max(0, points);
}
