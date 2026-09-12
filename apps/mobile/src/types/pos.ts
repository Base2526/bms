export interface PosMenuItem {
  sku: string;
  name: string;
  price: number;
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
  unitPrice: number;
  size: string;
  packCode: string;
  unitName: string;
  baseQty: number;
  modifierCodes: string[];
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
