import {
  cashRefundsOf,
  cashSalesOf,
  cashVariance,
  drawerExpectedFrom,
  parseAmountInput,
  summarizeMovements,
  validateCashOut,
} from '../src/lib/shiftMath';

describe('shiftMath', () => {
  it('รวมเงินเข้า/ออกแยกทางกัน และไม่รับยอดติดลบ', () => {
    const { movementIn, movementOut } = summarizeMovements([
      { type: 'IN', amount: 500 },
      { type: 'OUT', amount: 200 },
      { type: 'IN', amount: -50 },
    ]);
    expect(movementIn).toBe(500);
    expect(movementOut).toBe(200);
  });

  it('นับเฉพาะเงินสดเป็นยอดขายที่เข้าลิ้นชัก', () => {
    const sales = [
      {
        createdAt: '2026-09-11T10:00:00.000Z',
        payments: [
          { method: 'cash', amount: 300 },
          { method: 'qr', amount: 200 },
        ],
        returns: [],
      },
      {
        createdAt: '2026-09-11T10:01:00.000Z',
        payments: [{ method: 'card', amount: 1000 }],
        returns: [],
      },
    ];
    expect(cashSalesOf(sales)).toBe(300);
  });

  it('การคืนที่ยังรอยืนยันไม่ใช่เงินที่ออกจากลิ้นชัก — ทั้งช่องทางและสถานะต้องตรง', () => {
    const sales = [
      {
        createdAt: '2026-09-11T10:00:00.000Z',
        payments: [{ method: 'cash', amount: 300 }],
        returns: [
          {
            createdAt: '2026-09-11T10:30:00.000Z',
            allocations: [
              { method: 'cash', amount: 100, status: 'COMPLETED' },
              // คนละช่องทาง: ไม่เคยอยู่ในลิ้นชัก
              { method: 'qr', amount: 50, status: 'PENDING' },
              // ⚠️ เงินสดแต่ยังไม่จ่ายออก — เงินยังอยู่ในลิ้นชัก ห้ามหัก
              // (ถ้ากรองแค่ช่องทางโดยไม่ดูสถานะ นับปิดกะจะเกินทุกครั้งที่มีการคืนค้างอยู่)
              { method: 'cash', amount: 70, status: 'PENDING' },
            ],
          },
        ],
      },
    ];
    expect(cashRefundsOf(sales)).toBe(100);
  });

  it('บิลที่ถูก void หักล้างตัวเองผ่านขาคืน ไม่ต้องกรองขาเข้าทิ้ง', () => {
    const voided = [
      {
        createdAt: '2026-09-11T10:00:00.000Z',
        payments: [{ method: 'cash', amount: 250 }],
        returns: [
          {
            createdAt: '2026-09-11T10:05:00.000Z',
            allocations: [{ method: 'cash', amount: 250, status: 'COMPLETED' }],
          },
        ],
      },
    ];
    expect(cashSalesOf(voided) - cashRefundsOf(voided)).toBe(0);
  });

  it('เงินที่ควรมี = ตั้งต้น + ขายเงินสด − คืนเงินสด + เข้า − ออก', () => {
    // เคสของหน้ากะเริ่มต้น: 2000 + 4560 + 500 − 200 = 6860
    // (ของเดิม mock ประกาศไว้ตายตัวที่ 6560 ซึ่งไม่นับรายการที่แสดงอยู่บนจอเดียวกัน)
    expect(
      drawerExpectedFrom({
        openingFloat: 2000,
        cashSales: 4560,
        cashRefunds: 0,
        movementIn: 500,
        movementOut: 200,
      }),
    ).toBe(6860);
  });

  it('คืนเงินสดทำให้เงินที่ควรมีลดลง', () => {
    expect(
      drawerExpectedFrom({
        openingFloat: 1000,
        cashSales: 500,
        cashRefunds: 120.5,
        movementIn: 0,
        movementOut: 0,
      }),
    ).toBe(1379.5);
  });

  it('ผลต่างการนับบอกทั้งขาดและเกิน', () => {
    expect(cashVariance(6800, 6860)).toBe(-60);
    expect(cashVariance(6900, 6860)).toBe(40);
    expect(cashVariance(6860, 6860)).toBe(0);
  });

  it('ยอดที่อ่านไม่ออกถูกปฏิเสธ ไม่ใช่ปัดเป็น 0 เงียบ ๆ', () => {
    expect(parseAmountInput('').ok).toBe(false);
    expect(parseAmountInput('abc').ok).toBe(false);
    expect(parseAmountInput('0').ok).toBe(false);
    expect(parseAmountInput('-5').ok).toBe(false);
    expect(parseAmountInput('120.505')).toEqual({ ok: true, amount: 120.51 });
  });

  it('เบิกเงินเกินที่มีในลิ้นชักไม่ได้', () => {
    expect(validateCashOut(100, 500)).toBeNull();
    expect(validateCashOut(500, 500)).toBeNull();
    expect(validateCashOut(501, 500)).toMatch(/ไม่เกิน/);
  });

  it('เปิดกะใหม่แล้วเงินของกะก่อนต้องไม่ถูกนับซ้ำ', () => {
    const sales = [
      {
        createdAt: '2026-09-11T09:30:00.000Z',
        payments: [{ method: 'cash', amount: 400 }],
        returns: [],
      },
      {
        createdAt: '2026-09-11T14:30:00.000Z',
        payments: [{ method: 'cash', amount: 250 }],
        returns: [],
      },
    ];
    const shiftStart = Date.parse('2026-09-11T14:00:00.000Z');
    expect(cashSalesOf(sales)).toBe(650);
    expect(cashSalesOf(sales, shiftStart)).toBe(250);
  });

  it('เงินคืนเข้ากะที่จ่ายคืน ไม่ใช่กะที่ขาย', () => {
    const sales = [
      {
        createdAt: '2026-09-11T09:30:00.000Z',
        payments: [{ method: 'cash', amount: 400 }],
        returns: [
          {
            // ขายกะเช้า แต่มาคืนเงินในกะบ่าย — เงินออกจากลิ้นชักของกะบ่าย
            createdAt: '2026-09-11T15:00:00.000Z',
            allocations: [{ method: 'cash', amount: 400, status: 'COMPLETED' }],
          },
        ],
      },
    ];
    const shiftStart = Date.parse('2026-09-11T14:00:00.000Z');
    expect(cashSalesOf(sales, shiftStart)).toBe(0);
    expect(cashRefundsOf(sales, shiftStart)).toBe(400);
  });
});
