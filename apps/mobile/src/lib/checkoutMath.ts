interface DiscountMember {
  tierDiscountPct: number;
}

interface DiscountCoupon {
  discountType: 'fixed' | 'percent';
  discountValue: number;
  minimumSubtotal: number;
  maximumDiscount?: number;
  memberOnly?: boolean;
}

export interface ManualDiscount {
  amount: number;
  reason: string;
  approverName: string;
}

export interface CheckoutDiscounts {
  tierDiscount: number;
  couponDiscount: number;
  manualDiscount: number;
  discountTotal: number;
  netTotal: number;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * คณิตศาสตร์นี้มีไว้ให้ mock UI แสดงผลสอดคล้องกันเท่านั้น
 * ตอนต่อ backend ต้องแทนด้วย preview จาก composeDiscounts() ฝั่ง server ทั้งก้อน
 */
export function calculateMockDiscounts({
  subtotal,
  member,
  coupon,
  manualDiscount,
}: {
  subtotal: number;
  member: DiscountMember | null;
  coupon: DiscountCoupon | null;
  manualDiscount: ManualDiscount | null;
}): CheckoutDiscounts {
  const safeSubtotal = Math.max(0, subtotal);
  const tierDiscount = roundMoney(
    safeSubtotal * ((member?.tierDiscountPct ?? 0) / 100),
  );
  const afterTier = Math.max(0, safeSubtotal - tierDiscount);

  let couponDiscount = 0;
  if (
    coupon &&
    safeSubtotal >= coupon.minimumSubtotal &&
    (!coupon.memberOnly || member)
  ) {
    couponDiscount =
      coupon.discountType === 'fixed'
        ? coupon.discountValue
        : afterTier * (coupon.discountValue / 100);
    if (coupon.maximumDiscount !== undefined) {
      couponDiscount = Math.min(couponDiscount, coupon.maximumDiscount);
    }
    couponDiscount = roundMoney(Math.min(afterTier, couponDiscount));
  }

  const afterCoupon = Math.max(0, afterTier - couponDiscount);
  // เพดาน 30% เป็นค่า mock เพื่อไม่ให้หน้าทดสอบสร้างยอดติดลบ ไม่ใช่การตั้งค่าจริงของร้าน
  const mockCap = roundMoney(safeSubtotal * 0.3);
  const manualRoom = Math.max(0, mockCap - tierDiscount - couponDiscount);
  const appliedManual = roundMoney(
    Math.min(afterCoupon, manualRoom, manualDiscount?.amount ?? 0),
  );
  const discountTotal = roundMoney(
    tierDiscount + couponDiscount + appliedManual,
  );

  return {
    tierDiscount,
    couponDiscount,
    manualDiscount: appliedManual,
    discountTotal,
    netTotal: roundMoney(Math.max(0, safeSubtotal - discountTotal)),
  };
}

export function couponEligibilityError(
  coupon: DiscountCoupon,
  subtotal: number,
  hasMember: boolean,
): string | null {
  if (coupon.memberOnly && !hasMember) return 'คูปองนี้ใช้ได้เฉพาะสมาชิก';
  if (subtotal < coupon.minimumSubtotal) {
    return `ยอดสินค้าต้องครบ ฿${coupon.minimumSubtotal.toFixed(2)}`;
  }
  return null;
}
