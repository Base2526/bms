export interface MockShift {
  openedAt: string;
  openedByName: string;
  openingFloat: number;
  /**
   * ยอดขายเงินสดที่ "เกิดก่อนเปิดแอปรอบนี้" — ของจำลองเพื่อให้หน้ากะไม่เริ่มจากศูนย์เปล่า ๆ
   *
   * ⚠️ ห้ามใส่ `expectedCash` กลับมาเป็นค่าคงที่ในไฟล์นี้อีก — เงินที่ควรมีในลิ้นชักต้องมาจาก
   * `drawerExpectedFrom()` ที่เดียว (ของเดิมประกาศ 6560 ไว้ตายตัวขณะที่รายการเงินเข้า/ออก
   * บนจอเดียวกันบวกได้ 6860 = จอขัดกันเอง)
   */
  seededCashSales: number;
}

export const mockShift: MockShift = {
  openedAt: '09:00',
  openedByName: 'สมชาย ใจดี',
  openingFloat: 2000,
  seededCashSales: 4560,
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
