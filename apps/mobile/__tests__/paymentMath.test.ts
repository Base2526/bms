import {
  calculateCashChange,
  quickCashAmounts,
  validateMockPayments,
} from '../src/lib/paymentMath';

describe('paymentMath', () => {
  it('ยอดรวมทุกช่องทางต้องเท่ายอดสุทธิเป๊ะจึงยืนยันได้', () => {
    const exact = validateMockPayments(250, [
      { id: 'p1', method: 'cash', amount: 250, tendered: 300 },
    ]);
    expect(exact.isBalanced).toBe(true);
    expect(exact.canConfirm).toBe(true);
    expect(exact.remaining).toBe(0);
  });

  it('จ่ายขาดและจ่ายเกินถูกรายงานคนละอย่าง', () => {
    const short = validateMockPayments(250, [
      { id: 'p1', method: 'cash', amount: 200, tendered: 200 },
    ]);
    expect(short.remaining).toBe(50);
    expect(short.canConfirm).toBe(false);

    const over = validateMockPayments(250, [
      { id: 'p1', method: 'cash', amount: 300, tendered: 300 },
    ]);
    expect(over.overpaid).toBe(50);
    expect(over.canConfirm).toBe(false);
  });

  it('เงินสดที่รับต้องไม่น้อยกว่ายอดของช่องทางนั้น', () => {
    const result = validateMockPayments(250, [
      { id: 'p1', method: 'cash', amount: 250, tendered: 100 },
    ]);
    expect(result.canConfirm).toBe(false);
    expect(result.errors.join(' ')).toMatch(/เงินสดที่รับ/);
  });

  it('QR/บัตรต้องมีเลขอ้างอิง แต่เงินสดไม่ต้อง', () => {
    const missingRef = validateMockPayments(100, [
      { id: 'p1', method: 'qr', amount: 100 },
    ]);
    expect(missingRef.canConfirm).toBe(false);

    const withRef = validateMockPayments(100, [
      { id: 'p1', method: 'qr', amount: 100, reference: 'TEST-1' },
    ]);
    expect(withRef.canConfirm).toBe(true);
  });

  it('split payment ที่บวกกันพอดีผ่าน แม้มีสตางค์', () => {
    const result = validateMockPayments(259.3, [
      { id: 'p1', method: 'cash', amount: 200, tendered: 200 },
      { id: 'p2', method: 'card', amount: 59.3, reference: 'AUTH-9' },
    ]);
    expect(result.paidTotal).toBe(259.3);
    expect(result.canConfirm).toBe(true);
  });

  it('เงินทอนไม่ติดลบ', () => {
    expect(calculateCashChange(250, 500)).toBe(250);
    expect(calculateCashChange(250, 100)).toBe(0);
  });

  it('ปุ่มเงินด่วนไม่เสนอยอดที่น้อยกว่ายอดที่ต้องจ่าย', () => {
    const amounts = quickCashAmounts(250);
    expect(amounts[0]).toBe(250);
    expect(amounts.every(a => a >= 250)).toBe(true);
    expect(quickCashAmounts(0)).toEqual([]);
  });

  it('บิลใหญ่ยังได้ปุ่มปัดขึ้นของตัวเอง ไม่ใช่เหลือปุ่มเดียว', () => {
    // 1,234 ต้องได้อย่างน้อย "รับพอดี" กับยอดปัดขึ้นหลักร้อย
    const amounts = quickCashAmounts(1234);
    expect(amounts).toContain(1234);
    expect(amounts.length).toBeGreaterThan(1);
    expect(amounts.every(a => a >= 1234)).toBe(true);
  });
});
