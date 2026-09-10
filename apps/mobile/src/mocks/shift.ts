export interface MockShift {
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  cashSales: number;
  expectedCash: number;
}

export const mockShift: MockShift = {
  openedAt: '09:00',
  openedByName: 'สมชาย ใจดี',
  openingFloat: 2000,
  cashSales: 4560,
  expectedCash: 6560,
};

export interface MockCashMovement {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  at: string;
}

export const mockCashMovements: MockCashMovement[] = [
  {
    id: 'cm1',
    type: 'OUT',
    amount: 200,
    reason: 'ซื้อวัตถุดิบเพิ่ม',
    at: '10:30',
  },
  { id: 'cm2', type: 'IN', amount: 500, reason: 'เติมเงินทอน', at: '11:15' },
];
