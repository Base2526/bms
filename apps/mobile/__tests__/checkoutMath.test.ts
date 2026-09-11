import {
  calculateMockDiscounts,
  couponEligibilityError,
} from '../src/lib/checkoutMath';
import { mockCoupons, mockMembers } from '../src/mocks/checkout';
import {
  calculateCashChange,
  validateMockPayments,
} from '../src/lib/paymentMath';
import {
  allocateMockRefundToOriginalPayments,
  calculateMockReturnTotal,
} from '../src/lib/returnMath';

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

describe('mock split payments', () => {
  test('requires payment rows to match the net total exactly', () => {
    expect(
      validateMockPayments(300, [
        { id: 'cash', method: 'cash', amount: 100, tendered: 100 },
        { id: 'card', method: 'card', amount: 200, reference: 'APPROVED-1' },
      ]).canConfirm,
    ).toBe(true);

    const short = validateMockPayments(300, [
      { id: 'cash', method: 'cash', amount: 100, tendered: 100 },
    ]);
    expect(short.canConfirm).toBe(false);
    expect(short.remaining).toBe(200);
  });

  test('validates cash tender and non-cash references', () => {
    const result = validateMockPayments(100, [
      { id: 'cash', method: 'cash', amount: 60, tendered: 50 },
      { id: 'qr', method: 'qr', amount: 40, reference: '' },
    ]);
    expect(result.canConfirm).toBe(false);
    expect(result.errors).toContain('เงินสดที่รับต้องไม่น้อยกว่ายอดเงินสด');
    expect(result.errors).toContain('QR ต้องมีเลขอ้างอิงทดสอบ');
    expect(calculateCashChange(60, 100)).toBe(40);
  });
});

describe('mock returns', () => {
  test('rejects quantities over the sold amount', () => {
    const result = calculateMockReturnTotal([
      { sku: 'A', soldQty: 1, returnQty: 2, unitPrice: 25 },
    ]);
    expect(result.errors).toEqual(['A จำนวนคืนมากกว่าที่ขาย']);
  });

  test('allocates refunds back to original payment methods', () => {
    expect(
      allocateMockRefundToOriginalPayments(150, [
        { id: 'cash', method: 'cash', amount: 100, tendered: 100 },
        { id: 'card', method: 'card', amount: 200, reference: 'CARD-1' },
      ]),
    ).toEqual([
      { method: 'cash', amount: 100, status: 'COMPLETED' },
      { method: 'card', amount: 50, status: 'PENDING' },
    ]);
  });
});
