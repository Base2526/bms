export type TableStatus = 'EMPTY' | 'OCCUPIED' | 'CLOSING';

export interface MockTable {
  id: string;
  code: string;
  seats: number;
  /** สถานะตั้งต้นของ mock — สถานะจริงบนจอคำนวณจากบิลใน ChecksContext
   *  (โต๊ะที่มีรายการ = มีลูกค้า) ยกเว้น CLOSING ที่เป็นสถานะชั่วคราวของการคิดเงิน */
  status: TableStatus;
  openMinutes?: number;
}

export const mockTables: MockTable[] = [
  { id: 't1', code: 'T01', seats: 4, status: 'OCCUPIED', openMinutes: 22 },
  { id: 't2', code: 'T02', seats: 2, status: 'EMPTY' },
  { id: 't3', code: 'T03', seats: 4, status: 'OCCUPIED', openMinutes: 8 },
  { id: 't4', code: 'T04', seats: 6, status: 'CLOSING', openMinutes: 41 },
  { id: 't5', code: 'T05', seats: 2, status: 'EMPTY' },
  { id: 't6', code: 'T06', seats: 4, status: 'OCCUPIED', openMinutes: 15 },
];

export type CheckLineStatus = 'NEW' | 'SENT' | 'SERVED';

export interface MockCheckLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  status: CheckLineStatus;
}

// ⚠️ ราคาต่อหน่วยอยู่บนบรรทัดของบิล ไม่ได้ไปอ่านจากแคตตาล็อกตอนแสดงผล — ล้อกฎของฝั่งเว็บที่
// ราคาบนบิลเป็น snapshot ตอนสั่ง ไม่ใช่ราคาป้ายวันนี้ (ถ้าอ่านสด ราคาที่ลูกค้าตกลงจะเปลี่ยน
// ย้อนหลังเมื่อร้านแก้ราคาระหว่างที่โต๊ะยังนั่งอยู่)
export const mockCheckLinesByTable: Record<string, MockCheckLine[]> = {
  t1: [
    {
      sku: 'MENU-PADTHAI',
      name: 'ผัดไทยกุ้งสด',
      qty: 2,
      unitPrice: 89,
      status: 'SERVED',
    },
    {
      sku: 'MENU-LIME-TEA',
      name: 'ชามะนาวเย็น',
      qty: 2,
      unitPrice: 45,
      status: 'SENT',
    },
    {
      sku: 'MENU-BROWNIE',
      name: 'บราวนี่ไอศกรีม',
      qty: 1,
      unitPrice: 79,
      status: 'NEW',
    },
  ],
  t3: [
    {
      sku: 'MENU-SOMTAM',
      name: 'ส้มตำไทย',
      qty: 3,
      unitPrice: 69,
      status: 'SENT',
    },
  ],
  t4: [
    {
      sku: 'MENU-TOMYUM',
      name: 'ต้มยำกุ้งน้ำข้น',
      qty: 2,
      unitPrice: 149,
      status: 'SERVED',
    },
    {
      sku: 'MENU-THAI-TEA',
      name: 'ชาไทยเย็น',
      qty: 4,
      unitPrice: 45,
      status: 'SERVED',
    },
  ],
  t6: [
    {
      sku: 'MENU-PADTHAI',
      name: 'ผัดไทยกุ้งสด',
      qty: 1,
      unitPrice: 89,
      status: 'SENT',
    },
  ],
};
