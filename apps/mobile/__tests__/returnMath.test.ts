import {
  allocateMockRefundToOriginalPayments,
  calculateMockReturnTotal,
  wholeBillReturnLines,
} from '../src/lib/returnMath';

describe('returnMath', () => {
  it('คืนเกินจำนวนที่ขายไม่ได้', () => {
    const result = calculateMockReturnTotal([
      { sku: 'A', soldQty: 2, returnQty: 3, unitRefundPrice: 100 },
    ]);
    expect(result.errors.join(' ')).toMatch(/มากกว่าที่ขาย/);
  });

  it('คืนบางรายการคิดยอดตามจำนวนที่เลือก', () => {
    const result = calculateMockReturnTotal([
      { sku: 'A', soldQty: 3, returnQty: 1, unitRefundPrice: 89 },
      { sku: 'B', soldQty: 2, returnQty: 0, unitRefundPrice: 45 },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.total).toBe(89);
  });

  it('เงินคืนกลับไปที่ช่องทางเดิม และเงินสดสำเร็จทันทีส่วน QR/บัตรรอยืนยัน', () => {
    const allocations = allocateMockRefundToOriginalPayments(150, [
      { id: 'p1', method: 'cash', amount: 100 },
      { id: 'p2', method: 'qr', amount: 100, reference: 'R1' },
    ]);
    expect(allocations).toEqual([
      { method: 'cash', amount: 100, status: 'COMPLETED' },
      { method: 'qr', amount: 50, status: 'PENDING' },
    ]);
  });

  it('คืนรอบที่สองใช้วงเงินที่เหลือ ไม่ใช่เริ่มนับใหม่', () => {
    const payments = [
      { id: 'p1', method: 'cash' as const, amount: 100 },
      { id: 'p2', method: 'qr' as const, amount: 100, reference: 'R1' },
    ];
    const first = allocateMockRefundToOriginalPayments(60, payments);
    const second = allocateMockRefundToOriginalPayments(60, payments, first);
    const total = [...first, ...second].reduce((n, a) => n + a.amount, 0);
    expect(total).toBe(120);
    // เงินสดถูกใช้ไปจนหมดก่อน ส่วนที่เหลือจึงไปลงที่ QR
    expect(second).toEqual([
      { method: 'cash', amount: 40, status: 'COMPLETED' },
      { method: 'qr', amount: 20, status: 'PENDING' },
    ]);
  });

  it('คืนรวมกันทั้งหมดไม่เกินยอดที่ลูกค้าจ่ายมา', () => {
    const payments = [{ id: 'p1', method: 'cash' as const, amount: 100 }];
    const first = allocateMockRefundToOriginalPayments(100, payments);
    const second = allocateMockRefundToOriginalPayments(50, payments, first);
    expect(second).toEqual([]);
  });

  it('คืนทั้งบิลหยิบทุกบรรทัดเต็มจำนวน', () => {
    const lines = wholeBillReturnLines([
      { sku: 'A', name: 'A', qty: 2, unitPrice: 50 },
      { sku: 'B', name: 'B', qty: 1, unitPrice: 30 },
    ]);
    expect(lines).toEqual([
      { sku: 'A', soldQty: 2, returnQty: 2, unitRefundPrice: 50 },
      { sku: 'B', soldQty: 1, returnQty: 1, unitRefundPrice: 30 },
    ]);
  });
});
