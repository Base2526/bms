import { describeMobileSaleFailure } from '../src/lib/saleFailureMessage';

describe('describeMobileSaleFailure', () => {
  it('turns SHIFT_NOT_OPEN into an actionable cashier message', () => {
    expect(describeMobileSaleFailure({ status: 'SHIFT_NOT_OPEN' })).toBe(
      'ยังไม่ได้เปิดกะของเครื่องนี้ กรุณาเปิดกะก่อนขาย',
    );
  });

  it('prefers the server reason for other business rejections', () => {
    expect(
      describeMobileSaleFailure({
        status: 'PAYMENT_MISMATCH',
        reason: 'ยอดรับชำระไม่ตรงกับยอดขาย',
      }),
    ).toBe('ยอดรับชำระไม่ตรงกับยอดขาย');
  });

  it('keeps an unknown status visible with context', () => {
    expect(describeMobileSaleFailure({ status: 'NEW_STATUS' })).toBe(
      'บันทึกการขายไม่สำเร็จ (NEW_STATUS)',
    );
  });
});
