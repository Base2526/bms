import {
  calculateMockDiscounts,
  couponEligibilityError,
} from '../src/lib/checkoutMath';
import { mockCoupons, mockMembers } from '../src/mocks/checkout';

describe('mock checkout discounts', () => {
  test('composes tier, coupon, then approved manual discount', () => {
    expect(
      calculateMockDiscounts({
        subtotal: 400,
        member: mockMembers[0],
        coupon: mockCoupons[1],
        manualDiscount: {
          amount: 20,
          reason: 'สินค้ามีตำหนิ',
          approverName: 'ผู้จัดการทดสอบ',
        },
      }),
    ).toEqual({
      tierDiscount: 20,
      couponDiscount: 38,
      manualDiscount: 20,
      discountTotal: 78,
      netTotal: 322,
    });
  });

  test('caps the manual layer instead of producing a negative total', () => {
    const result = calculateMockDiscounts({
      subtotal: 100,
      member: mockMembers[0],
      coupon: mockCoupons[0],
      manualDiscount: {
        amount: 99,
        reason: 'ทดสอบเพดาน',
        approverName: 'ผู้จัดการทดสอบ',
      },
    });
    expect(result.discountTotal).toBe(30);
    expect(result.manualDiscount).toBe(5);
    expect(result.netTotal).toBe(70);
  });

  test('explains member and minimum-spend coupon failures', () => {
    expect(couponEligibilityError(mockCoupons[1], 400, false)).toBe(
      'คูปองนี้ใช้ได้เฉพาะสมาชิก',
    );
    expect(couponEligibilityError(mockCoupons[0], 50, true)).toBe(
      'ยอดสินค้าต้องครบ ฿100.00',
    );
  });
});
