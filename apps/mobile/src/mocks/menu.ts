export interface MockMenuItem {
  sku: string;
  /** รหัสตัวอย่างสำหรับทดสอบ scanner; ของจริงต้อง resolve จาก catalog ฝั่ง server */
  barcode?: string;
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
  /** ภาพ fallback ตามโหมดเมื่อ backend ยังไม่มีรูปสินค้า */
  artKind?: 'food' | 'retail' | 'pharmacy';
}

export interface MockMenuCatalog {
  categories: string[];
  stations: string[];
  items: MockMenuItem[];
  searchPlaceholder: string;
  resultNoun: string;
  unavailableLabel: string;
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
    barcode: '8850000000011',
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
    barcode: '8850000000012',
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

export const restaurantMockCatalog: MockMenuCatalog = {
  categories: mockCategories,
  stations: mockMenuStations,
  items: mockMenuItems,
  searchPlaceholder: 'ค้นหาเมนู หรือรหัสสินค้า',
  resultNoun: 'เมนู',
  unavailableLabel: 'หมดวันนี้',
};

export const generalMockCatalog: MockMenuCatalog = {
  categories: ['สินค้าทั้งหมด', 'เครื่องดื่ม', 'ขนม', 'ของใช้'],
  stations: ['เครื่องดื่ม', 'ขนม', 'ของใช้'],
  searchPlaceholder: 'ค้นหาสินค้า บาร์โค้ด หรือ SKU',
  resultNoun: 'สินค้า',
  unavailableLabel: 'ขายไม่ได้',
  items: [
    {
      sku: 'GEN-WATER',
      barcode: '8851000000001',
      name: 'น้ำดื่ม 600 มล.',
      price: 10,
      category: 'เครื่องดื่ม',
      station: 'เครื่องดื่ม',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-JUICE',
      barcode: '8851000000002',
      name: 'น้ำส้ม 250 มล.',
      price: 25,
      category: 'เครื่องดื่ม',
      station: 'เครื่องดื่ม',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-CHIPS',
      barcode: '8851000000003',
      name: 'มันฝรั่งทอดกรอบ',
      price: 30,
      category: 'ขนม',
      station: 'ขนม',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-COOKIE',
      barcode: '8851000000004',
      name: 'คุกกี้เนย',
      price: 45,
      category: 'ขนม',
      station: 'ขนม',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-SOAP',
      barcode: '8851000000005',
      name: 'สบู่เหลวล้างมือ',
      price: 59,
      category: 'ของใช้',
      station: 'ของใช้',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-TISSUE',
      barcode: '8851000000006',
      name: 'กระดาษทิชชู',
      price: 39,
      category: 'ของใช้',
      station: 'ของใช้',
      sellable: true,
      artKind: 'retail',
    },
    {
      sku: 'GEN-BAG',
      barcode: '8851000000007',
      name: 'ถุงขยะ',
      price: 55,
      category: 'ของใช้',
      station: 'ของใช้',
      sellable: false,
      unavailableNote: 'สต็อกไม่พอ',
      artKind: 'retail',
    },
  ],
};

export const pharmacyMockCatalog: MockMenuCatalog = {
  categories: ['สินค้าทั้งหมด', 'ดูแลสุขภาพ', 'ปฐมพยาบาล', 'ของใช้'],
  stations: ['ดูแลสุขภาพ', 'ปฐมพยาบาล', 'ของใช้'],
  searchPlaceholder: 'ค้นหาสินค้า บาร์โค้ด หรือ SKU',
  resultNoun: 'สินค้า',
  unavailableLabel: 'รอตรวจสอบ',
  items: [
    {
      sku: 'PHA-MASK',
      barcode: '8852000000001',
      name: 'หน้ากากอนามัย 10 ชิ้น',
      price: 45,
      category: 'ดูแลสุขภาพ',
      station: 'ดูแลสุขภาพ',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-THERMO',
      barcode: '8852000000002',
      name: 'เครื่องวัดอุณหภูมิ',
      price: 159,
      category: 'ดูแลสุขภาพ',
      station: 'ดูแลสุขภาพ',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-SALINE',
      barcode: '8852000000003',
      name: 'น้ำเกลือล้างแผล',
      price: 35,
      category: 'ปฐมพยาบาล',
      station: 'ปฐมพยาบาล',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-GAUZE',
      barcode: '8852000000004',
      name: 'ผ้าก๊อซปลอดเชื้อ',
      price: 28,
      category: 'ปฐมพยาบาล',
      station: 'ปฐมพยาบาล',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-PLASTER',
      barcode: '8852000000005',
      name: 'พลาสเตอร์ปิดแผล',
      price: 42,
      category: 'ปฐมพยาบาล',
      station: 'ปฐมพยาบาล',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-GEL',
      barcode: '8852000000006',
      name: 'เจลล้างมือ',
      price: 69,
      category: 'ของใช้',
      station: 'ของใช้',
      sellable: true,
      artKind: 'pharmacy',
    },
    {
      sku: 'PHA-REVIEW',
      barcode: '8852000000007',
      name: 'สินค้าควบคุม (ตัวอย่าง)',
      price: 120,
      category: 'ดูแลสุขภาพ',
      station: 'ดูแลสุขภาพ',
      sellable: false,
      unavailableNote: 'ตัวอย่าง: รอเภสัชกรตรวจนโยบาย',
      artKind: 'pharmacy',
    },
  ],
};

export interface MockCartLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}
