import type { PriceTier, Promotion } from '../lib/cartPricing';

export interface PosMenuItem {
  sku: string;
  name: string;
  /** ราคาต่อหน่วยขายที่จะเขียนลงบรรทัด = packBasePrice + ส่วนเพิ่มของตัวเลือกที่เลือก */
  price: number;
  /** ราคาป้ายต่อหน่วยฐาน (ไม่รวมตัวเลือก) — ฐานของราคาส่ง/โปร */
  basePrice?: number;
  /** ราคาต่อหน่วยขาย ก่อนบวกตัวเลือก */
  packBasePrice?: number;
  /** ส่วนเพิ่มของตัวเลือกที่เลือกไว้ ต่อหน่วยขาย */
  modifierUnitPrice?: number;
  priceTiers?: PriceTier[];
  promotion?: Promotion | null;
  category: string;
  station: string;
  sellable: boolean;
  imageUrl?: string | null;
  unavailableNote?: string | null;
  artKind?: 'food' | 'retail' | 'pharmacy';
  size: string;
  packCode: string;
  unitName: string;
  baseQty: number;
  /** False for bundles/recipes whose component stock is checked only by the server. */
  stockTracked?: boolean;
  serialTracked?: boolean;
  scaleBarcode?: string | null;
  modifiers?: PosModifier[];
  selectedModifierCodes?: string[];
  packs?: PosPackOption[];
  availableSizes?: Array<{
    size: string;
    available: number;
    price?: number | null;
  }>;
}

export interface PosPackOption {
  code: string;
  unitName: string;
  baseQty: number;
  price: number;
}

export interface PosModifier {
  code: string;
  name: string;
  priceDelta: number;
  groupCode: string;
  groupName: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  minSelect: number;
  maxSelect: number | null;
  defaultSelected: boolean;
}

export interface PosMenuCatalog {
  categories: string[];
  stations: string[];
  items: PosMenuItem[];
  searchPlaceholder: string;
  resultNoun: string;
  unavailableLabel: string;
}

export interface PosCartLine {
  key: string;
  sku: string;
  name: string;
  qty: number;
  /** ราคาที่โชว์ต่อหน่วยขาย = packBasePrice + modifierUnitPrice */
  unitPrice: number;
  /**
   * snapshot ของกติกาที่ตัดสินราคา — ต้องติดมากับบรรทัด ไม่ใช่ไปถาม catalog ตอนคิดยอด
   * (สินค้าตัวเดียวกันคนละไซซ์ใช้ขั้นราคาส่งชุดเดียวกัน แต่ราคาป้ายคนละตัว)
   * ไม่มีค่า = บรรทัดยุคก่อน snapshot ซึ่งตกไปคิดแบบ `qty × unitPrice` ตามเดิม
   */
  basePrice?: number;
  packBasePrice?: number;
  modifierUnitPrice?: number;
  priceTiers?: PriceTier[];
  promotion?: Promotion | null;
  size: string;
  packCode: string;
  unitName: string;
  baseQty: number;
  modifierCodes: string[];
  /** ชื่อตัวเลือกที่เลือกไว้ — เก็บตอนเพิ่มเพราะบรรทัดในตะกร้าไม่มีทางย้อนไปถาม catalog ได้อีก
   *  และแคชเชียร์ต้องอ่านออกว่าบรรทัดไหนคือ "หวานน้อย" โดยไม่ต้องแปลรหัสเอง */
  modifierNames?: string[];
  serialTracked?: boolean;
  scaleBarcode?: string | null;
  serials: string[];
  imageUrl?: string | null;
}

export interface PosMember {
  id: string;
  memberNo: string | null;
  name: string;
  phone: string | null;
  tier: string | null;
  tierDiscountPct: number;
  points: number;
  pointsUsable: number;
}

export interface PosCoupon {
  code: string;
}

export interface PosManualDiscount {
  amount: number;
  reason: string;
  approverUserId: string;
  approverName: string;
  approverPin: string;
}

export interface PosExtraLine {
  id: string;
  label: string;
  qty: number;
  unitAmount: number;
}

export interface PosTable {
  id: string;
  code: string;
  name: string;
  seats: number;
  status: string;
  active: boolean;
  blocked: boolean;
  checkId: string | null;
  amountDue: number;
  itemCount: number;
  unsentCount: number;
  openedAt: string | null;
}

export interface PosCheckLine {
  id: string;
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  status: string;
  size: string;
  modifierCodes: string[];
}

export interface PosIncomingOrder {
  id: string;
  channel: string;
  customerName: string;
  fulfillmentType: string;
  amountDue: number;
  receivedAt: string;
  promisedAt: string | null;
  status: string;
  lines: Array<{
    orderItemId: number;
    sku: string;
    name: string;
    qty: number;
    size: string;
    unitName: string | null;
    modifierCodes: string[];
  }>;
}
