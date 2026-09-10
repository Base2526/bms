export interface MockMenuItem {
  sku: string;
  name: string;
  price: number;
  category: string;
  /** สถานีครัว — ใช้วนสีพื้นช่องรูปบนการ์ด (เหมือน /pos/restaurant บนเว็บ) */
  station: string;
  sellable: boolean;
  /** รูปจริงของสินค้า ถ้ามีจะชนะภาพวาด SVG เสมอ — mock ยังไม่มีรูปจริงสักตัว */
  imageUrl?: string | null;
  /** เหตุผลที่ขายไม่ได้ (แสดงใต้ชื่อบนการ์ดที่ปิดขาย) */
  unavailableNote?: string;
}

export const mockCategories = [
  'ยอดนิยม',
  'อาหารจานหลัก',
  'เครื่องดื่ม',
  'ของหวาน',
];

/** ลำดับสถานีที่เจอในเมนู — index ของสถานีคือ index ของสีพื้นช่องรูป */
export const mockMenuStations = [
  'ครัวร้อน',
  'ครัวเย็น',
  'บาร์เครื่องดื่ม',
  'ของหวาน',
];

export const mockMenuItems: MockMenuItem[] = [
  {
    sku: 'MENU-PADTHAI',
    name: 'ผัดไทยกุ้งสด',
    price: 89,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: true,
  },
  {
    sku: 'MENU-TOMYUM',
    name: 'ต้มยำกุ้งน้ำข้น',
    price: 149,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: true,
  },
  {
    sku: 'MENU-SOMTAM',
    name: 'ส้มตำไทย',
    price: 69,
    category: 'อาหารจานหลัก',
    station: 'ครัวเย็น',
    sellable: true,
  },
  {
    sku: 'MENU-LARB',
    name: 'ลาบหมูอีสาน',
    price: 79,
    category: 'อาหารจานหลัก',
    station: 'ครัวเย็น',
    sellable: true,
  },
  {
    sku: 'MENU-KAPRAO',
    name: 'ข้าวกะเพราหมูสับไข่ดาว',
    price: 75,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: true,
  },
  {
    sku: 'MENU-KHAOMANKAI',
    name: 'ข้าวมันไก่ต้ม',
    price: 65,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: true,
  },
  {
    sku: 'MENU-GAENGKEAW',
    name: 'แกงเขียวหวานไก่',
    price: 95,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: true,
  },
  {
    sku: 'MENU-RADNA',
    name: 'ราดหน้าหมูหมัก',
    price: 85,
    category: 'อาหารจานหลัก',
    station: 'ครัวร้อน',
    sellable: false,
    unavailableNote: 'เส้นหมด รอของรอบบ่าย',
  },
  {
    sku: 'MENU-LIME-TEA',
    name: 'ชามะนาวเย็น',
    price: 45,
    category: 'เครื่องดื่ม',
    station: 'บาร์เครื่องดื่ม',
    sellable: true,
  },
  {
    sku: 'MENU-THAI-TEA',
    name: 'ชาไทยเย็น',
    price: 45,
    category: 'เครื่องดื่ม',
    station: 'บาร์เครื่องดื่ม',
    sellable: true,
  },
  {
    sku: 'MENU-COFFEE',
    name: 'กาแฟเย็น',
    price: 55,
    category: 'เครื่องดื่ม',
    station: 'บาร์เครื่องดื่ม',
    sellable: true,
  },
  {
    sku: 'MENU-SODA-LIME',
    name: 'โซดามะนาว',
    price: 40,
    category: 'เครื่องดื่ม',
    station: 'บาร์เครื่องดื่ม',
    sellable: true,
  },
  {
    sku: 'MENU-MANGO-STICKY',
    name: 'ข้าวเหนียวมะม่วง',
    price: 99,
    category: 'ของหวาน',
    station: 'ของหวาน',
    sellable: true,
  },
  {
    sku: 'MENU-BROWNIE',
    name: 'บราวนี่ไอศกรีม',
    price: 79,
    category: 'ของหวาน',
    station: 'ของหวาน',
    sellable: false,
    unavailableNote: 'หมดวันนี้',
  },
];

export interface MockCartLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}
