// ข้อมูลจำลองทั้งไฟล์นี้ — ยังไม่ต่อ backend จริง (รอ schema/auth นิ่งตามแผนที่ตกลงกันไว้)
// รูปทรงข้อมูลตั้งใจให้ใกล้เคียงกับสิ่งที่ GraphQL น่าจะคืนจริงในอนาคต เพื่อลดของที่ต้องแก้ตอนเดินสาย

export interface MockBranch {
  id: string;
  name: string;
  code: string;
}

export interface MockCashier {
  id: string;
  name: string;
  // แนวเดียวกับ users.pos_only ของฝั่งเว็บ — ไว้แสดงป้ายเฉย ๆ ในโครงนี้
  role: 'Administrator' | 'Manager' | 'Sales' | 'Cashier';
}

export const mockBranches: MockBranch[] = [
  { id: 'branch-1', name: 'สาขาสยาม', code: 'MAIN' },
  { id: 'branch-2', name: 'สาขาทองหล่อ', code: 'TL01' },
];

export const mockCashiers: MockCashier[] = [
  { id: 'user-1', name: 'สมชาย ใจดี', role: 'Cashier' },
  { id: 'user-2', name: 'สมหญิง ขยัน', role: 'Manager' },
  { id: 'user-3', name: 'วิชัย รอบคอบ', role: 'Sales' },
];
