import {
  allocateMockRefundToOriginalPayments,
  calculateMockReturnTotal,
  exchangeSeedLines,
  refundPaymentOptions,
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

  it('สร้างบิลเปลี่ยนจากจำนวนที่เซิร์ฟเวอร์ยืนยันและผูกกับ order item เดิม', () => {
    const lines = [
      { orderItemId: 11, refundablePackQty: 2, sku: 'A', size: 'S' },
      { orderItemId: 12, refundablePackQty: 1, sku: 'A', size: 'L' },
    ];
    expect(
      exchangeSeedLines('order-1', lines, [
        { orderItemId: 11, packQty: 9 },
        { orderItemId: 999, packQty: 1 },
      ]),
    ).toEqual([
      {
        key: 'exchange-order-1-0-11',
        line: lines[0],
        qty: 2,
      },
    ]);
  });

  it('ช่องทางคืนเงินหัก allocation เดิมตาม payment id และรวมตามวิธีชำระ', () => {
    expect(
      refundPaymentOptions(
        [
          { id: 'cash-1', method: 'cash', amount: 100 },
          { id: 'cash-2', method: 'cash', amount: 50 },
          { id: 'qr-1', method: 'qr', amount: 200 },
        ],
        [
          {
            paymentId: 'cash-1',
            method: 'cash',
            amount: 100,
            status: 'COMPLETED',
          },
          {
            paymentId: 'qr-1',
            method: 'qr',
            amount: 40,
            status: 'PENDING',
          },
        ],
      ),
    ).toEqual([
      { method: 'cash', available: 50 },
      { method: 'qr', available: 160 },
    ]);
  });
});
