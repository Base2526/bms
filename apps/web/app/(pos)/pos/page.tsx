'use client';
// จอขายหน้าร้าน
// -------------------------------------------------------------
// กฎที่ยึดตลอดทั้งไฟล์: เครื่องหน้าร้านห้ามคิดเลขเอง
//   • ราคา/สต็อก มาจาก /api/pos/scan เท่านั้น
//   • ยอดที่ส่งไปกับการชำระเงินเป็นยอดที่ "เครื่องเห็น" แต่ฝั่ง server คิดใหม่
//     และปฏิเสธถ้าไม่ตรง (PAYMENT_MISMATCH) — เครื่องไม่ใช่ผู้ตัดสิน
//   • ไม่มีโหมดออฟไลน์ตามที่ตกลงกันไว้: เน็ตหลุด = ขายไม่ได้ ไม่ใช่ขายแล้วค้างคิว
//
// idempotencyKey สร้างที่เครื่อง {device}-{shift}-{seq} — ยิงซ้ำเพราะ response
// หายกลางทางต้องได้บิลเดิม จำเป็นแม้จะไม่ทำโหมดออฟไลน์
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { code39Bars } from "@/lib/pos/barcode";
import {
  applyPromotion,
  canonicalPriceTiers,
  isFixedPricePack,
  priceLinesByQty,
  syncSkuPricingSnapshot,
} from "@/lib/bms/pricing";
import { isCameraScanSupported, needsDecoderDownload, startCameraScan } from "@/lib/pos/cameraScan";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
import {
  consumeKeyboardWedgeKey,
  DEFAULT_KEYBOARD_WEDGE_CONFIG,
  IDLE_KEYBOARD_WEDGE_STATE,
  resolveScanContext,
  SCAN_CONTEXT_LABEL_TH,
  type KeyboardWedgeState,
  type ScanContext,
  type ScanSource,
} from "@/lib/pos/scanManager";
import { buildDrawerKick, buildReceipt, type ReceiptLine } from "@/lib/pos/escpos";
import {
  findRememberedPrinter,
  isWebUsbSupported,
  requestPrinter,
  sendToPrinter,
} from "@/lib/pos/printerClient";

/**
 * แถบงานด้านซ้าย — จอ POS สูง 768px เป็นมาตรฐาน แกนตั้งจึงเป็นของหายาก
 * ของที่ใช้วันละไม่กี่ครั้ง (กะ/ตั้งค่า/คืนของ) ย้ายมาอยู่แกนนอนที่เหลือเฟือ
 * เหลือแกนตั้งไว้ให้ตะกร้ากับปุ่มจ่ายซึ่งใช้วันละร้อยครั้ง
 *
 * สลับเฉพาะคอลัมน์ซ้าย — คอลัมน์ยอดเงิน/ปุ่มชำระอยู่ขวาตลอด เพราะคิวหน้าร้าน
 * ซ้อนกันได้: คนแรกยังจ่ายไม่จบ คนถัดไปยื่นบิลมาขอคืนของ
 */
const POS_TABS = [
  { key: "sell", label: "ขาย" },
  { key: "returns", label: "คืน" },
  { key: "stock", label: "รับของ" },
  { key: "deposits", label: "มัดจำ" },
  { key: "shift", label: "กะ" },
  { key: "settings", label: "ตั้งค่า" },
] as const;
type PosTab = (typeof POS_TABS)[number]["key"];

/**
 * ไอคอนต้องเป็น SVG ห้ามใช้ตัวอักษร
 * เคยใช้ "↩" (U+21A9) กับ "⚙" (U+2699) ซึ่งมี emoji variant อยู่ในมาตรฐาน Unicode
 * → iOS เลือกเรนเดอร์เป็นภาพสีให้เอง แถบล่างบน iPhone จึงมีไอคอนสีโผล่มาสองตัว
 * ส่วน "▮▍▮"/"▤" เป็นอักขระเรขาคณิตที่รูปร่าง/ความกว้างเปลี่ยนไปตามฟอนต์ที่แต่ละ
 * เครื่องมี และบางเครื่องไม่มี glyph เลยต้องยืมฟอนต์อื่นมาแทน
 * SVG คุมขนาด เส้น และสีได้เอง และได้หน้าตาเดียวกันทุกเครื่อง
 */
function PosTabIcon({ tab }: { tab: PosTab }) {
  if (tab === "sell") {
    // บาร์โค้ด = ขาย (ยิงของ)
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="5" width="3.4" height="14" rx="1" />
        <rect x="8.6" y="5" width="2" height="14" rx="1" />
        <rect x="12" y="5" width="3.4" height="14" rx="1" />
        <rect x="17.6" y="5" width="3.4" height="14" rx="1" />
      </svg>
    );
  }
  if (tab === "returns") {
    // ลูกศรย้อนกลับ = คืนของ
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h11a5 5 0 010 10h-3" />
      </svg>
    );
  }
  if (tab === "stock") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8l8-4 8 4-8 4z" />
        <path d="M4 8v8l8 4 8-4V8M12 12v8" />
        <path d="M8 6l8 4" />
      </svg>
    );
  }
  if (tab === "deposits") {
    // ใบรับเงิน = มัดจำ/ยอดค้าง
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 12h6" />
      </svg>
    );
  }
  if (tab === "shift") {
    // สมุดบันทึก = กะ/ลิ้นชักเงินสด
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
           strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M3.5 9h17M3.5 13h17M3.5 16.5h17" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.6 1.6 0 00.33 1.77l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.77-.33 1.6 1.6 0 00-1 1.47V21a2 2 0 01-4 0v-.1A1.6 1.6 0 008.1 19.4a1.6 1.6 0 00-1.77.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.6 1.6 0 003.83 15a1.6 1.6 0 00-1.47-1H2a2 2 0 010-4h.1a1.6 1.6 0 001.47-1 1.6 1.6 0 00-.33-1.77l-.06-.06a2 2 0 012.83-2.83l.06.06A1.6 1.6 0 009 3.83 1.6 1.6 0 0010 2.36V2a2 2 0 014 0v.1a1.6 1.6 0 001 1.47 1.6 1.6 0 001.77-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.6 1.6 0 0020.17 9v.05a1.6 1.6 0 001.47 1H22a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </svg>
  );
}

/** ไอคอนบาร์โค้ดหน้าช่องยิง — เหตุผลเดียวกับ PosTabIcon: ห้ามใช้อักขระ ▮▍▮▏▮ */
function ScanBarcodeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
         style={{ width: 22, height: 22, flex: "none", color: "var(--pos-accent)" }}>
      <rect x="2.5" y="5" width="2.2" height="14" rx=".6" />
      <rect x="6" y="5" width="1.1" height="14" rx=".4" />
      <rect x="8.6" y="5" width="2.8" height="14" rx=".6" />
      <rect x="12.7" y="5" width="1.1" height="14" rx=".4" />
      <rect x="15.2" y="5" width="2.2" height="14" rx=".6" />
      <rect x="18.8" y="5" width="2.7" height="14" rx=".6" />
    </svg>
  );
}

const TOKEN_KEY = "bms.pos.deviceToken";
const LAST_RECEIPT_KEY = "bms.pos.lastReceipt";
const PENDING_SALE_KEY = "bms.pos.pendingSale";
const PENDING_DEPOSIT_SALE_KEY = "bms.pos.pendingDepositSale";

type ScanHit = {
  sku: string;
  productName: string;
  receiptName: string;
  size: string;
  packCode: string;
  unitName: string;
  baseQty: number;
  packPrice: number;
  basePrice: number;
  /** ขั้นราคาส่ง (8.1) — จอคิดด้วย unitPriceForQty ตัวเดียวกับ createOrder */
  priceTiers?: Array<{
    minQty: number;
    scope?: "PER_VARIANT_FIXED" | "CROSS_VARIANT_PERCENT";
    size?: string | null;
    unitPrice?: number | null;
    discountPct?: number | null;
  }>;
  /** true = สินค้านี้ต้องระบุเลขเครื่องครบทุกชิ้นก่อนขาย (8.3) */
  serialTracked?: boolean;
  /** โปรที่ใช้งานอยู่ (8.7) — จอคิดด้วย applyPromotion ตัวเดียวกับ createOrder */
  promotion?:
    | { kind: "BUY_X_GET_Y"; buyQty: number; getQty: number }
    | { kind: "N_FOR_PRICE"; buyQty: number; bundlePrice: number }
    | null;
  available: number;
};

type CartLine = ScanHit & {
  packQty: number;
  key: string;
  /** เลขเครื่องที่พนักงานยิง/พิมพ์ไว้สำหรับบรรทัดนี้ (8.3) */
  serials?: string[];
  orderItemId?: number;
  returnedPackQty?: number;
  refundablePackQty?: number;
};

function cartPricingSignature(line: ScanHit): string {
  return JSON.stringify({
    sku: line.sku,
    size: line.size,
    packCode: line.packCode,
    baseQty: line.baseQty,
    packPrice: line.packPrice,
    basePrice: line.basePrice,
    priceTiers: canonicalPriceTiers(line.priceTiers ?? []),
    promotion: line.promotion ?? null,
    serialTracked: line.serialTracked === true,
  });
}
const variantPricingKey = (sku: string, size: string) => `${sku}\u0000${size}`;

function addScanHitToCart(cart: CartLine[], hit: ScanHit, key: string): CartLine[] {
  // price tiers / promotion are SKU-wide. A scan of another size is the newest
  // snapshot for every size already in the cart, not only for the scanned line.
  const synced = syncSkuPricingSnapshot(cart, hit);
  const found = synced.find((line) => line.key === key);
  if (found) {
    return synced.map((line) => line.key === key
      ? { ...line, ...hit, packQty: line.packQty + 1, key: line.key, serials: line.serials }
      : line);
  }
  return [...synced, { ...hit, packQty: 1, key }];
}
type ReturnDraft = Record<number, number>;

/** สมาชิกที่ค้นเจอจาก /api/pos/member (7.96) */
type PosMember = {
  customerId: string;
  name: string;
  phone: string | null;
  memberNo: string | null;
  pointsBalance: number;
  pointsUsable: number;
  tier: { code: string; name: string; discountType: string; discountValue: number } | null;
};

/** ผลคิดส่วนลดจาก server — จอห้ามคิดเลขนี้เอง (ต้องตรงกับตอน commit) */
type ParkedSale = {
  id: string;
  label: string;
  itemCount: number;
  subtotalHint: number;
  cart: CartLine[];
  parkedByName: string | null;
  createdAt: string;
};

type CashMovement = {
  id: string;
  direction: "IN" | "OUT";
  amount: number;
  reason: string;
  actorName: string | null;
  approvedByName: string | null;
  createdAt: string;
};

type PosExpenseKind = "DIRECT" | "ADVANCE";
type PosExpenseEntryMode = PosExpenseKind | "PERSONAL" | "PETTY_CASH";
type PosExpenseCategory = "INGREDIENTS" | "PACKAGING" | "DELIVERY" | "TRANSPORT"
  | "CLEANING" | "REPAIRS" | "UTILITIES" | "OTHER";
type PosExpense = {
  id: string;
  kind: PosExpenseKind;
  fundingSource: "DRAWER" | "PERSONAL" | "PETTY_CASH";
  category: PosExpenseCategory;
  description: string;
  payee: string | null;
  status: "OPEN" | "SETTLED";
  advancedAmount: number;
  actualAmount: number | null;
  returnedAmount: number;
  extraCashOut: number;
  receiptRef: string | null;
  actorName: string | null;
  approvedByName: string | null;
  settledByName: string | null;
  settlementApprovedByName: string | null;
  pettyCashBalanceAfter: number | null;
  createdAt: string;
  settledAt: string | null;
};

type PosPettyCashLedgerEntry = {
  id: string;
  direction: "IN" | "OUT";
  source: "OWNER_PERSONAL" | "BUSINESS_ACCOUNT" | "EXPENSE";
  amount: number;
  balanceAfter: number;
  reason: string;
  evidenceRef: string;
  actorName: string | null;
  createdAt: string;
};

const POS_EXPENSE_CATEGORY_LABELS: Record<PosExpenseCategory, string> = {
  INGREDIENTS: "วัตถุดิบ/ของใช้ในการขาย",
  PACKAGING: "ถุง/บรรจุภัณฑ์",
  DELIVERY: "ค่าส่ง/ค่าขนส่งสินค้า",
  TRANSPORT: "ค่าเดินทาง",
  CLEANING: "ทำความสะอาด",
  REPAIRS: "ซ่อมแซม",
  UTILITIES: "ค่าน้ำ/ไฟ/สาธารณูปโภค",
  OTHER: "อื่น ๆ",
};

type PosDeposit = {
  id: string;
  orderId: string;
  locationId: string;
  customerNote: string | null;
  totalAmount: number;
  depositPaid: number;
  balanceDue: number;
  dueAt: string | null;
  overdue: boolean;
};

type PosDepositCandidateOrder = {
  orderId: string;
  channel: string;
  totalAmount: number;
  itemCount: number;
  createdAt: string;
};

type ShiftReport = {
  shiftId: string;
  deviceCode: string;
  locationName: string | null;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  openingFloat: number;
  salesTotal: number;
  billCount: number;
  voidCount: number;
  voidTotal: number;
  returnCount: number;
  returnTotal: number;
  discountTotal: number;
  byMethod: Array<{ method: string; count: number; amount: number }>;
  byCashier: Array<{ cashier: string; billCount: number; amount: number }>;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  expenseCount: number;
  expenseTotal: number;
  personalExpenseCount: number;
  personalExpenseTotal: number;
  pettyCashExpenseCount: number;
  pettyCashExpenseTotal: number;
  openExpenseCount: number;
  openExpenseAmount: number;
  noSaleCount: number;
  expectedCash: number | null;
  expectedCashHidden: boolean;
  countedCash: number | null;
  cashVariance: number | null;
};

type MemberPreview = {
  subtotal: number;
  tierDiscount: number;
  tierLabel: string | null;
  couponDiscount: number;
  pointsDiscount: number;
  pointsUsed: number;
  manualDiscount: number;
  totalDiscount: number;
  netTotal: number;
  capped: boolean;
  /** อัตราแลกของร้าน — จอใช้บอกมูลค่าล่วงหน้าและปรับจำนวนเป็นก้าวละหน่วยแลก */
  redeemPointsPerUnit: number;
  redeemBahtPerUnit: number;
  redeemMinPoints: number;
  /** เหตุผลที่ใช้โค้ดนี้ไม่ได้ — null = ใช้ได้ (หรือไม่ได้กรอกโค้ด) */
  couponError: string | null;
};

type ReceiptVat = {
  rate: number;
  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
  netBeforeVat: number;
  roundingAmount: number;
};

type Receipt = {
  orderId?: string | null;
  docNo: string | null;
  orderStatus?: string | null;
  /** 7.97 — บิลที่ถูกยกเลิก แสดงป้ายต่างจาก "คืนแล้ว" */
  voidedAt?: string | null;
  /** กะที่บิลนี้เกิด — void ได้เฉพาะบิลในกะที่ยังเปิดอยู่ */
  shiftId?: string | null;
  receiptType?: "sale" | "return" | "exchange";
  returnReason?: string | null;
  refundTotal?: number | null;
  lines: CartLine[];
  total: number;
  tendered: number | null;
  change: number | null;
  at: string;
  cashier: string;
  storeName: string | null;
  branchCode: string | null;
  posLabel: string | null;
  vatRegistered: boolean;
  /** เลขผู้เสียภาษีของร้าน — มากับ session ไม่ใช่รายบิล */
  taxId: string | null;
  /** ตัวเลขจากใบกำกับที่ออกจริง · null = บิลนี้ไม่มีใบกำกับ (ร้านยังไม่จด VAT) */
  vat: ReceiptVat | null;
  /** ปัดเศษเงินสดที่บวกอยู่ใน total แล้ว — ร้านที่ไม่ได้จด VAT ก็ปัดได้ */
  roundingAmount?: number | null;
  /** สมาชิก + แต้ม (7.96) — null ทั้งชุดเมื่อบิลนี้ไม่ผูกสมาชิก */
  memberName?: string | null;
  memberNo?: string | null;
  pointsEarned?: number | null;
  pointsBalance?: number | null;
  /** ส่วนลดแยกบรรทัดตามที่มา (tier / คูปอง / แต้ม) — ยอดรวมมาจาก server */
  discountLines?: Array<{ source: string; label: string; amount: number; pointsUsed: number }>;
  paymentLabel: string;
  paymentRef: string | null;
  payments: Array<{
    method: string;
    label: string;
    amount: number;
    ref: string | null;
    tendered: number | null;
    change: number | null;
  }>;
  refunds?: Array<{
    id: string;
    paymentId: string;
    method: string;
    amount: number;
    status: "PENDING" | "COMPLETED";
    externalRef: string | null;
    posReturnId: string;
    returnMode: "FULL" | "PARTIAL";
    returnNote: string | null;
    returnedAt: string;
  }>;
};

type PaymentDraft = {
  id: string;
  method: string;
  amount: string;
  tendered: string;
  ref: string;
};

type SearchItem = {
  sku: string;
  name: string;
  price: number;
  availableTotal: number;
  availableSizes: Array<{ size: string; available: number }>;
};

type PosPurchaseHeader = {
  id: string;
  status: "OPEN" | "PARTIAL";
  note: string | null;
  supplier: { id: string; name: string } | null;
  qtyOrdered: number;
  qtyReceived: number;
  createdAt: string;
};

type PosPurchaseDetail = Omit<PosPurchaseHeader, "qtyOrdered" | "qtyReceived"> & {
  items: Array<{
    sku: string;
    size: string;
    qtyOrdered: number;
    qtyReceived: number;
    unitCost: number;
  }>;
};

type StockReceiveDraft = Record<string, { qty: number; lotNo: string; expiryDate: string }>;

type Session = {
  device: {
    id: string;
    code: string;
    name: string | null;
    registeredPosNo: string | null;
    scanner: { mode: "FOCUS" | "PREFIX"; prefixKey: string; suffixKey: string; maxGapMs: number };
  };
  location: { id: string; name: string; branchCode: string; pharmacistName: string | null } | null;
  shift: { id: string; openedAt: string; openingFloat: number } | null;
  shiftReturnSummary: { returnCount: number; returnTotal: number; settledTotal: number; pendingTotal: number; pendingCount: number };
  cashiers: Array<{ id: string; name: string | null; email: string | null; isPharmacist: boolean; hasPin: boolean }>;
  purchaseReceivers: Array<{ id: string; name: string | null; email: string | null; role: string | null; hasPin: boolean }>;
  store?: { taxId: string | null };
  vat: {
    registered: boolean;
    priceIncludesVat: boolean;
    rate: number;
    calendarEra: string;
    cashRounding?: CashRounding;
  };
};

const METHODS = [
  { key: "CASH", label: "เงินสด" },
  { key: "QR", label: "QR" },
  { key: "CARD", label: "บัตร" },
  { key: "WALLET", label: "วอลเล็ท" },
] as const;

const RETURN_REASON_OPTIONS = [
  { key: "DAMAGED", label: "สินค้าเสียหาย" },
  { key: "WRONG_ITEM", label: "หยิบ/ขายผิดรายการ" },
  { key: "CUSTOMER_CHANGE", label: "ลูกค้าเปลี่ยนใจ" },
  { key: "PRICE_ERROR", label: "ราคาผิด" },
  { key: "QUALITY_ISSUE", label: "คุณภาพสินค้า" },
  { key: "OTHER", label: "อื่น ๆ" },
] as const;

function baht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ปุ่ม "ทั้งหมด" หมายถึงแต้มที่แลกได้จริง เศษที่ไม่ครบหน่วยต้องคงอยู่ในบัญชี */
function maxWholeRedeemPoints(pointsUsable: number, pointsPerUnit: number): number {
  const usable = Math.max(0, Math.floor(pointsUsable));
  const unit = Math.max(1, Math.floor(pointsPerUnit));
  return Math.floor(usable / unit) * unit;
}

function stockLineKey(sku: string, size: string) {
  return JSON.stringify([sku, size]);
}

/** ตัวเลข VAT ที่ server ส่งมาจากใบกำกับจริง — ไม่มีก็คือไม่มี ห้ามคิดเองจากยอดรวม */
function parseReceiptVat(raw: any): ReceiptVat | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    rate: Number(raw.rate ?? 0),
    taxableAmount: Number(raw.taxableAmount ?? 0),
    exemptAmount: Number(raw.exemptAmount ?? 0),
    vatAmount: Number(raw.vatAmount ?? 0),
    netBeforeVat: Number(raw.netBeforeVat ?? 0),
    roundingAmount: Number(raw.roundingAmount ?? 0),
  };
}

export default function PosPage() {
  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string>("");
  // token ที่เก็บไว้ใช้ไม่ได้แล้ว (เครื่องถูกปิด/ออก token ใหม่/ใส่ผิด)
  const [tokenRejected, setTokenRejected] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [cashierId, setCashierId] = useState<string>("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanCode, setScanCode] = useState("");
  const [hidCapturing, setHidCapturing] = useState(false);
  const keyboardWedgeStateRef = useRef<KeyboardWedgeState>(IDLE_KEYBOARD_WEDGE_STATE);
  const scanTaskQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scanHandlerRef = useRef<(code: string, source: ScanSource, size?: string | null) => Promise<void>>(async () => {});
  const enqueueScan = useCallback((code: string, source: ScanSource, size?: string | null) => {
    // Bind the context-aware handler at arrival time. A slow preceding lookup
    // must not reroute this scan into another tab if the operator switches tabs
    // while the queue is draining.
    const handlerAtArrival = scanHandlerRef.current;
    const run = () => handlerAtArrival(code, source, size);
    scanTaskQueueRef.current = scanTaskQueueRef.current.then(run, run);
  }, []);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" },
  ]);
  // PIN อยู่ในหน่วยความจำเท่านั้น — ไม่ลง localStorage เพราะเครื่องหน้าร้าน
  // เปิดค้างทั้งวันและใครก็เปิด devtools ดูได้
  const [pin, setPin] = useState<string>("");
  const [openingFloat, setOpeningFloat] = useState<string>("");
  const [countedCash, setCountedCash] = useState<string>("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // โหมดเช็คของ: ยิงแล้วดูราคา/ยอดคงเหลือ โดยไม่เพิ่มลงตะกร้า
  // แคชเชียร์ต้องตอบลูกค้าได้ว่า "ของหมดไหม" โดยไม่ต้องเข้าหลังบ้าน และไม่ต้อง
  // แกล้งเพิ่มลงตะกร้าแล้วลบทิ้ง ซึ่งเสี่ยงขายพลาด
  const [lookupMode, setLookupMode] = useState(false);
  const [lookup, setLookup] = useState<ScanHit | null>(null);
  const [returnPanelOpen, setReturnPanelOpen] = useState(false);
  const [tab, setTab] = useState<PosTab>("sell");
  // ทุกบิลผูกกับคนนี้ — ต้องเห็นบนแถบบนตลอด ไม่ใช่ซ่อนอยู่ในแท็บตั้งค่า
  const currentCashierName = useMemo(() => {
    const found = (session?.cashiers ?? []).find((c) => c.id === cashierId);
    return found ? found.name || found.email || "" : "";
  }, [session?.cashiers, cashierId]);
  const [recentOpen, setRecentOpen] = useState(false);
  // เครื่องพิมพ์ ESC/POS: จำที่เลือกไว้ ไม่ต้องเลือกใหม่ทุกเช้า
  // ถ้าไม่มี/เบราว์เซอร์ไม่รองรับ → กลับไปใช้ print dialog เหมือนเดิม
  const [printerReady, setPrinterReady] = useState(false);
  // สแกนด้วยกล้องมือถือ — โหมดเทส/เดโมที่ยังไม่มีเครื่องสแกนจริง
  // เช็คการรองรับหลัง mount เท่านั้น (ไม่เช็คตอน SSR) กันปุ่มโผล่มาแล้วหายตอน hydrate
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  // เบราว์เซอร์ที่ไม่มี BarcodeDetector ต้องโหลดตัวถอดรหัสก่อนเริ่มสแกน —
  // บอกให้เห็นว่ากำลังเตรียมอยู่ ไม่ใช่กล้องค้าง
  const [cameraPreparing, setCameraPreparing] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void findRememberedPrinter().then((d) => setPrinterReady(Boolean(d)));
    setCameraSupported(isCameraScanSupported());
  }, []);
  // ใบเสร็จตัวเต็มเป็น "เอกสารสำหรับพิมพ์" ไม่ใช่ของที่ต้องอ่านบนจอ →
  // อยู่ใน modal เปิดเมื่อกดดู/พิมพ์บิลเก่าเท่านั้น
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  // บิลที่เพิ่งขายจบ — แสดงผลในคอลัมน์ขวาแทนแผงจ่ายเงิน (จุดที่เพิ่งกดปุ่ม)
  // ไม่ใช้ modal เพราะต้องกดปิดทุกบิล = เพิ่ม 1 แตะต่อลูกค้า 1 คน
  const [justSold, setJustSold] = useState<{ docNo: string | null; change: number | null; total: number } | null>(null);
  // true = บิลนี้จ่ายเงินสดล้วนวิธีเดียว → ใช้ฟอร์มย่อ (ช่องเดียว + ปุ่มเงินด่วน)
  // ---- สมาชิก + แต้ม (7.96) ----
  const [member, setMember] = useState<PosMember | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<PosMember[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState<string>("");
  // แผงปรับจำนวนแต้มโผล่หลังพนักงานกด "ใช้แต้ม" เท่านั้น — บิลส่วนใหญ่ไม่แลกแต้ม
  // การโชว์ช่องกรอกไว้ตลอดทำให้แถวรุงรังและกดผิดตอนรีบ
  const [redeemOpen, setRedeemOpen] = useState(false);
  // คูปองใช้ร่วมกับส่วนลดสมาชิกได้ — server เป็นคนตรวจกฎของโค้ด (ยอดขั้นต่ำ/
  // จำนวนครั้ง/ต่อคน) จอแค่ส่งโค้ดไปแล้วแสดงผล
  const [couponCode, setCouponCode] = useState("");
  // ---- ส่วนลดมือ ----
  // เก็บ "ที่ขอ" แยกจาก "ที่อนุมัติแล้ว" โดยตั้งใจ: พนักงานพิมพ์จำนวนได้ตลอด แต่ยอด
  // จะเข้าไปคิดในพรีวิว/บิลก็ต่อเมื่อหัวหน้ากด PIN ผ่านแล้วเท่านั้น ถ้าใช้ตัวแปรเดียว
  // จอจะโชว์ยอดลดให้ลูกค้าเห็นตั้งแต่ยังไม่มีใครอนุมัติ
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountDraft, setDiscountDraft] = useState("");
  const [discountReasonDraft, setDiscountReasonDraft] = useState("");
  const [discountApproverId, setDiscountApproverId] = useState("");
  const [discountApproverPin, setDiscountApproverPin] = useState("");
  const [discountError, setDiscountError] = useState<string | null>(null);
  // PIN ผู้อนุมัติอยู่ในหน่วยความจำอย่างเดียวเหมือน PIN คนขาย — ไม่เขียนลง
  // localStorage เด็ดขาด (recovery record ของบิลค้างก็ตัด pin ออกด้วย)
  const [approvedDiscount, setApprovedDiscount] = useState<
    { amount: number; reason: string; approverId: string; approverPin: string; approverName: string } | null
  >(null);
  const [memberPreview, setMemberPreview] = useState<MemberPreview | null>(null);
  const [memberPreviewAppliedKey, setMemberPreviewAppliedKey] = useState<string | null>(null);
  // ---- พักบิล / เงินลิ้นชัก / ยกเลิกบิล / สรุปกะ (7.97) ----
  const [parked, setParked] = useState<ParkedSale[]>([]);
  const [parkLabel, setParkLabel] = useState("");
  const [parkOpen, setParkOpen] = useState(false);
  const [cashMoves, setCashMoves] = useState<CashMovement[]>([]);
  const [cashMoveDir, setCashMoveDir] = useState<"IN" | "OUT">("OUT");
  const [cashMoveAmount, setCashMoveAmount] = useState("");
  const [cashMoveReason, setCashMoveReason] = useState("");
  const [cashMoveExternalConfirmed, setCashMoveExternalConfirmed] = useState(false);
  const [cashApproverId, setCashApproverId] = useState("");
  const [cashApproverPin, setCashApproverPin] = useState("");
  // ค่าใช้จ่ายเงินสดย่อยแยกจาก movement ทั่วไป เพื่อไม่เอาการนำฝากธนาคาร
  // หรือย้ายเงินทอนมานับเป็นต้นทุนของร้าน
  const [expenses, setExpenses] = useState<PosExpense[]>([]);
  const [expenseMode, setExpenseMode] = useState<PosExpenseEntryMode>("DIRECT");
  const [canUsePersonalFunds, setCanUsePersonalFunds] = useState(false);
  const [canManagePettyCash, setCanManagePettyCash] = useState(false);
  const [expenseAccessError, setExpenseAccessError] = useState<string | null>(null);
  const [pettyCashBalance, setPettyCashBalance] = useState(0);
  const [pettyCashEntries, setPettyCashEntries] = useState<PosPettyCashLedgerEntry[]>([]);
  const [pettyFundSource, setPettyFundSource] = useState<"OWNER_PERSONAL" | "BUSINESS_ACCOUNT">("OWNER_PERSONAL");
  const [pettyFundAmount, setPettyFundAmount] = useState("");
  const [pettyFundReason, setPettyFundReason] = useState("");
  const [pettyFundEvidence, setPettyFundEvidence] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<PosExpenseCategory>("INGREDIENTS");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expensePayee, setExpensePayee] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseReceiptRef, setExpenseReceiptRef] = useState("");
  const [expenseApproverId, setExpenseApproverId] = useState("");
  const [expenseApproverPin, setExpenseApproverPin] = useState("");
  const [settleExpenseId, setSettleExpenseId] = useState<string | null>(null);
  const [settleActualAmount, setSettleActualAmount] = useState("");
  const [settleReceiptRef, setSettleReceiptRef] = useState("");
  const [settleApproverId, setSettleApproverId] = useState("");
  const [settleApproverPin, setSettleApproverPin] = useState("");
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidApproverId, setVoidApproverId] = useState("");
  const [voidApproverPin, setVoidApproverPin] = useState("");
  const [shiftReport, setShiftReport] = useState<ShiftReport | null>(null);
  const [noSaleReason, setNoSaleReason] = useState("");
  // ---- มัดจำ / ค้างชำระ (9.0) ----
  const [deposits, setDeposits] = useState<PosDeposit[]>([]);
  const [depositCandidateOrders, setDepositCandidateOrders] = useState<PosDepositCandidateOrder[]>([]);
  const [depositOrderId, setDepositOrderId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState("CASH");
  const [depositReason, setDepositReason] = useState("");
  const [depositOutcome, setDepositOutcome] = useState<"CANCELLED" | "FORFEITED">("CANCELLED");
  const depositRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const cashMovementRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const expenseCreateRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const expenseSettleRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const pettyFundRequestRef = useRef<{ signature: string; key: string } | null>(null);
  // กัน response ของพนักงานคนก่อนกลับมาทับสิทธิ์/ยอดหลังเปลี่ยนผู้ขาย
  const expenseRefreshSeqRef = useRef(0);
  const openingFloatRef = useRef<HTMLInputElement>(null);
  const countedCashRef = useRef<HTMLInputElement>(null);
  const cashMoveAmountRef = useRef<HTMLInputElement>(null);
  const cashMoveReasonRef = useRef<HTMLInputElement>(null);
  const cashApproverSelectRef = useRef<HTMLSelectElement>(null);
  const cashApproverPinRef = useRef<HTMLInputElement>(null);
  const expenseDescriptionRef = useRef<HTMLInputElement>(null);
  const expenseAmountRef = useRef<HTMLInputElement>(null);
  const expenseReceiptRefRef = useRef<HTMLInputElement>(null);
  const expenseApproverSelectRef = useRef<HTMLSelectElement>(null);
  const expenseApproverPinRef = useRef<HTMLInputElement>(null);
  const pettyFundAmountRef = useRef<HTMLInputElement>(null);
  const pettyFundReasonRef = useRef<HTMLInputElement>(null);
  const pettyFundEvidenceRef = useRef<HTMLInputElement>(null);
  const settleActualAmountRef = useRef<HTMLInputElement>(null);
  const settleReceiptRefRef = useRef<HTMLInputElement>(null);
  const settleApproverSelectRef = useRef<HTMLSelectElement>(null);
  const settleApproverPinRef = useRef<HTMLInputElement>(null);
  const noSaleReasonRef = useRef<HTMLInputElement>(null);
  // ---- ส่งใบเสร็จ (8.6) ----
  // ---- ค่าบริการ/ค่าถุง (8.6) ----
  // ไม่ใช่สินค้าในคลัง จึงไม่อยู่ในตะกร้า แต่ต้องรวมในยอดที่ลูกค้าจ่าย
  const [extraLines, setExtraLines] = useState<Array<{ label: string; unitAmount: string }>>([]);
  const [receiptTo, setReceiptTo] = useState("");
  const [sendingReceipt, setSendingReceipt] = useState(false);
  // ---- คืนไม่มีใบเสร็จ (8.2) ----
  const [blindOpen, setBlindOpen] = useState(false);
  const [blindReason, setBlindReason] = useState("");
  const [blindApproverId, setBlindApproverId] = useState("");
  const [blindApproverPin, setBlindApproverPin] = useState("");
  const blindReturnRequestRef = useRef<{ signature: string; key: string } | null>(null);
  // สมัครสมาชิกเป็นงานนาน ๆ ครั้ง จึงยอมให้เป็นกล่องเต็มจอ + numpad ได้
  // (ต่างจากการค้นที่เกิดทุกบิล ซึ่งอยู่ในแผงชำระเงินเลย)
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<"phone" | "name">("phone");
  const [enrollPhone, setEnrollPhone] = useState("");
  const [enrollName, setEnrollName] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  // ---- รับสินค้าเข้าโดย Scanner (9.6) ----
  const [receivableOrders, setReceivableOrders] = useState<PosPurchaseHeader[]>([]);
  const [stockOrder, setStockOrder] = useState<PosPurchaseDetail | null>(null);
  const [stockDraft, setStockDraft] = useState<StockReceiveDraft>({});
  const stockDraftRef = useRef<StockReceiveDraft>({});
  const [stockScanCode, setStockScanCode] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockReceiving, setStockReceiving] = useState(false);
  const [stockReceiverId, setStockReceiverId] = useState("");
  const [stockReceiverPin, setStockReceiverPin] = useState("");
  const stockReceiveRequestRef = useRef<{ signature: string; key: string } | null>(null);
  const [recentSalesQuery, setRecentSalesQuery] = useState("");
  const [recentReceipts, setRecentReceipts] = useState<Receipt[]>([]);
  // เปิดฟอร์มคืนได้ทีละบิล — หน้าร้านทำทีละใบอยู่แล้ว และการกางทุกใบพร้อมกัน
  // ทำให้เลื่อนหาบิลที่ต้องการไม่เจอ
  const [returnPanelOrderId, setReturnPanelOrderId] = useState<string | null>(null);
  const [returnDrafts, setReturnDrafts] = useState<Record<string, ReturnDraft>>({});
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({});
  const [returnReasonCodes, setReturnReasonCodes] = useState<Record<string, string>>({});
  const [approvalUserId, setApprovalUserId] = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [settlementRefs, setSettlementRefs] = useState<Record<string, string>>({});
  const [hasPendingSale, setHasPendingSale] = useState(false);
  const [hasPendingDepositSale, setHasPendingDepositSale] = useState(false);
  // pending = คืนเงินจริงที่ยังไม่ยืนยัน ซึ่งบล็อกการปิดกะ — แท็บกะต้องบอกให้เห็น
  const [shiftReturnSummary, setShiftReturnSummary] = useState<{
    count: number; total: number; pendingCount: number; pendingTotal: number;
  }>({ count: 0, total: 0, pendingCount: 0, pendingTotal: 0 });
  const scanRef = useRef<HTMLInputElement>(null);
  const stockScanRef = useRef<HTMLInputElement>(null);
  const hasPendingOrderWrite = hasPendingSale || hasPendingDepositSale;
  const currentScanContext = resolveScanContext({
    tab,
    lookupMode,
    blindReturnOpen: blindOpen,
    hasPendingSale: hasPendingOrderWrite,
    busy: busy || stockReceiving,
    blockingOverlayOpen: receiptModalOpen || enrollOpen,
  });

  function replaceStockDraft(next: StockReceiveDraft) {
    stockDraftRef.current = next;
    setStockDraft(next);
  }

  useEffect(() => {
    // จับคู่ผ่านลิงก์ได้: /pos?t=<token>
    // หน้าแอดมินให้ลิงก์เต็มไปเลย เพราะการก๊อป token เปล่า ๆ แล้วเอาไปวางในช่อง URL
    // เป็นสิ่งที่เกิดขึ้นจริง (เจอมาแล้ว) — วางลิงก์ในช่อง URL แล้วต้องทำงานเลย
    const url = new URL(window.location.href);
    const fromUrl = (url.searchParams.get("t") ?? url.searchParams.get("token") ?? "").trim();
    if (fromUrl) {
      window.localStorage.setItem(TOKEN_KEY, fromUrl);
      setToken(fromUrl);
      // ล้าง token ออกจาก URL ทันที — ไม่ให้ค้างใน history/แถบที่อยู่ให้ใครเห็น
      url.searchParams.delete("t");
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search);
      return;
    }
    setToken(window.localStorage.getItem(TOKEN_KEY) ?? "");
    try {
      const savedReceipt = window.localStorage.getItem(LAST_RECEIPT_KEY);
      if (savedReceipt) setReceipt(JSON.parse(savedReceipt) as Receipt);
    } catch {}
  }, []);

  useEffect(() => {
    if (!session?.shift) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(PENDING_SALE_KEY) ?? "null");
      if (!saved?.body || saved.body.shiftId !== session.shift.id || !Array.isArray(saved.cart) || !Array.isArray(saved.payments)) return;
      setCart(saved.cart);
      setPayments(saved.payments);
      setHasPendingSale(true);
      setNotice({ type: "error", text: "พบบิลที่ผลลัพธ์ยังไม่แน่ชัดจากครั้งก่อน — กดชำระเงินอีกครั้งเพื่อเช็ค/ทำรายการต่อด้วยคีย์เดิม" });
    } catch {}
  }, [session?.shift?.id]);

  useEffect(() => {
    if (!session?.shift) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(PENDING_DEPOSIT_SALE_KEY) ?? "null");
      if (!saved?.body || saved.body.shiftId !== session.shift.id || !Array.isArray(saved.cart)) return;
      setCart(saved.cart);
      setDepositAmount(String(saved.body.payments?.[0]?.amount ?? ""));
      setDepositMethod(String(saved.body.payments?.[0]?.method ?? "CASH"));
      setHasPendingDepositSale(true);
      setTab("deposits");
      setNotice({
        type: "error",
        text: "พบรายการสร้างบิลมัดจำที่ผลลัพธ์ยังไม่แน่ชัด — กด “สร้างบิล + รับมัดจำ” ซ้ำ ระบบจะใช้คีย์เดิมและไม่รับเงินซ้ำ",
      });
    } catch {}
  }, [session?.shift?.id]);

  const authHeaders = useMemo(() => ({ "x-pos-device-token": token }), [token]);

  async function postPosPurchase(payload: Record<string, unknown>) {
    const res = await fetch("/api/pos/purchase", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ...payload, cashierUserId: stockReceiverId, pin: stockReceiverPin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? data?.status ?? `HTTP ${res.status}`);
    return data;
  }

  async function loadReceivableOrders(preferPoId?: string | null) {
    if (!token || !stockReceiverId || !stockReceiverPin) {
      setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อนโหลดใบสั่งซื้อ" });
      return;
    }
    setStockLoading(true);
    try {
      const data = await postPosPurchase({ action: "list" });
      const rows = Array.isArray(data?.orders) ? data.orders as PosPurchaseHeader[] : [];
      setReceivableOrders(rows);
      const target = preferPoId && rows.some((row) => row.id === preferPoId)
        ? preferPoId
        : stockOrder && rows.some((row) => row.id === stockOrder.id)
          ? stockOrder.id
          : null;
      if (target) await loadStockOrder(target, false);
      else if (stockOrder && !rows.some((row) => row.id === stockOrder.id)) {
        setStockOrder(null);
        replaceStockDraft({});
      }
    } catch (e: any) {
      setNotice({ type: "error", text: `โหลดใบสั่งซื้อไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setStockLoading(false);
    }
  }

  async function loadStockOrder(poId: string, clearDraft = true) {
    if (!poId) {
      setStockOrder(null);
      replaceStockDraft({});
      return;
    }
    setStockLoading(true);
    try {
      const data = await postPosPurchase({ action: "detail", poId });
      setStockOrder(data.order as PosPurchaseDetail);
      if (clearDraft) {
        replaceStockDraft({});
        stockReceiveRequestRef.current = null;
      }
      setNotice(null);
    } catch (e: any) {
      setNotice({ type: "error", text: `เปิดใบสั่งซื้อไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setStockLoading(false);
    }
  }

  const loadSession = useCallback(async () => {
    if (!token) {
      setLoadingSession(false);
      return;
    }
    setLoadingSession(true);
    try {
      let res = await fetch("/api/pos/session", { headers: authHeaders, cache: "no-store" });
      // 401 ครั้งเดียวยังไม่ตัดสินว่า token ตาย — ลองซ้ำก่อน เพราะการไล่คนหน้าร้าน
      // ไปจับคู่ใหม่ทั้งที่ token ยังดีอยู่ แพงกว่าการยิงซ้ำหนึ่งครั้งมาก
      if (res.status === 401) {
        await new Promise((r) => setTimeout(r, 400));
        res = await fetch("/api/pos/session", { headers: authHeaders, cache: "no-store" });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSessionError(body?.error ?? `HTTP ${res.status}`);
        setTokenRejected(res.status === 401);
        setSession(null);
        return;
      }
      const data: Session = await res.json();
      setSession(data);
      setShiftReturnSummary({
        count: Number(data.shiftReturnSummary?.returnCount ?? 0),
        total: Number(data.shiftReturnSummary?.returnTotal ?? 0),
        pendingCount: Number(data.shiftReturnSummary?.pendingCount ?? 0),
        pendingTotal: Number(data.shiftReturnSummary?.pendingTotal ?? 0),
      });
      setSessionError("");
      setTokenRejected(false);
      setCashierId((cur) => cur || data.cashiers.find((c) => c.hasPin)?.id || "");
    } catch (e: any) {
      // เน็ตหลุด ≠ token ผิด — อย่าไล่ให้ไปจับคู่ใหม่ทั้งที่แค่เน็ตสะดุด
      setSessionError(String(e?.message ?? e));
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, [token, authHeaders]);

  function unpair() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setSession(null);
    setTokenRejected(false);
    setSessionError("");
  }

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!token) return;
    void loadRecentReceipts();
  }, [token, session?.device.id]);

  const anyCashierHasPin = (session?.cashiers ?? []).some((c) => c.hasPin);
  // ขายได้ก็ต่อเมื่อครบทั้ง 4: เชื่อมต่อได้ / มีคนตั้ง PIN / เลือกคน+ใส่ PIN / เปิดกะแล้ว
  const canSell = Boolean(session?.shift && cashierId && pin && anyCashierHasPin);

  /**
   * ราคาส่งตามจำนวน (8.1)
   *
   * ขั้นราคาคงที่ดูจำนวน SKU+ไซซ์ ส่วนขั้นเปอร์เซ็นต์ดูจำนวนรวม SKU — ต้องตรงกับที่
   * createOrder คิด ไม่งั้นยอดที่ส่งไปไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH
   * แล้วบิลถูกยกเลิกทิ้งทั้งใบ · ทั้งสองฝั่งเรียก unitPriceForQty ตัวเดียวกัน
   *
   * บรรทัด pack ที่มี packCode แยกจาก BASE ไม่ถูกแตะ เหมือนฝั่ง server
   */
  const tierPriceByKey = useMemo(() => {
    const basePriceByVariant = new Map<string, number>();
    const tiersBySku = new Map<string, NonNullable<ScanHit["priceTiers"]>>();
    for (const line of cart) {
      basePriceByVariant.set(variantPricingKey(line.sku, line.size), line.basePrice);
      tiersBySku.set(line.sku, line.priceTiers ?? []);
    }

    const priced = priceLinesByQty(
      cart.map((line) => ({
        key: line.key,
        sku: line.sku,
        size: line.size,
        qty: line.packQty * line.baseQty,
        packUnitPrice: isFixedPricePack(line.packCode) ? line.packPrice : null,
      })),
      basePriceByVariant,
      tiersBySku
    );
    const out = new Map<string, number>();
    for (let index = 0; index < cart.length; index += 1) {
      const line = cart[index];
      if (isFixedPricePack(line.packCode) || !line.priceTiers?.length) continue;
      const unit = priced[index].unitPrice;
      if (unit !== line.packPrice) out.set(line.key, unit);
    }
    return out;
  }, [cart]);

  /** ค่าบริการที่กรอกครบแล้วเท่านั้น — แถวที่ยังกรอกไม่เสร็จต้องไม่ขยับยอด */
  const extraTotal = useMemo(
    () => extraLines.reduce((sum, x) => {
      const amount = Number(x.unitAmount);
      return sum + (x.label.trim() && Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0),
    [extraLines]
  );

  /**
   * โปรโมชัน (8.7) — คิดต่อ SKU+ไซซ์จากจำนวนรวมทั้งตะกร้า
   * บรรทัดที่ขายเป็น pack ไม่เข้าโปร เหมือนฝั่ง server
   */
  const promoBySku = useMemo(() => {
    const qtyByVariant = new Map<string, number>();
    const promoOf = new Map<string, NonNullable<CartLine["promotion"]>>();
    const priceOf = new Map<string, number>();
    for (const line of cart) {
      if (isFixedPricePack(line.packCode) || !line.promotion) continue;
      const key = variantPricingKey(line.sku, line.size);
      qtyByVariant.set(key, (qtyByVariant.get(key) ?? 0) + line.packQty);
      promoOf.set(key, line.promotion);
      priceOf.set(key, line.basePrice);
    }
    const out = new Map<string, { amount: number; freeQty: number; saved: number }>();
    for (const [key, promo] of promoOf) {
      out.set(key, applyPromotion(priceOf.get(key) ?? 0, qtyByVariant.get(key) ?? 0, promo));
    }
    return out;
  }, [cart]);

  const total = useMemo(() => {
    const chargedPromo = new Set<string>();
    let sum = 0;
    for (const line of cart) {
      const key = variantPricingKey(line.sku, line.size);
      const promo = isFixedPricePack(line.packCode) ? null : promoBySku.get(key);
      if (promo) {
        if (!chargedPromo.has(key)) { chargedPromo.add(key); sum += promo.amount; }
        continue;
      }
      sum += (tierPriceByKey.get(line.key) ?? line.packPrice) * line.packQty;
    }
    return Math.round(sum * 100) / 100;
  }, [cart, tierPriceByKey, promoBySku]);
  const itemCount = useMemo(() => cart.reduce((sum, l) => sum + l.packQty, 0), [cart]);

  // ---- สมาชิก + แต้ม (7.96) ----------------------------------------
  // ส่วนลดทุกชั้นคิดที่ server เท่านั้น (/api/pos/member/preview) จอแค่แสดงผล
  // ถ้าจอคิดเองแล้วต่างจาก server แม้สตางค์เดียว บิลจะโดน PAYMENT_MISMATCH
  // แล้วถูกยกเลิกทิ้งทั้งใบ
  const discountTotal = memberPreview?.totalDiscount ?? 0;
  const redeemPointsPerUnit = memberPreview?.redeemPointsPerUnit ?? 100;
  const maxRedeemPoints = member
    ? maxWholeRedeemPoints(member.pointsUsable, redeemPointsPerUnit)
    : 0;
  /** ส่วนลดทุกชนิดใช้ฐานสินค้าเท่านั้น ค่าถุง/ค่าบริการบวกหลังหักส่วนลด */
  const netTotal = Math.round(Math.max(0, total - discountTotal) * 100) / 100;
  const payableBeforeRounding = Math.round((netTotal + extraTotal) * 100) / 100;
  const memberPreviewRequestKey = JSON.stringify({
    customerId: member?.customerId ?? null,
    subtotal: total,
    pointsToRedeem: Number(pointsToRedeem) || 0,
    couponCode: couponCode.trim().toUpperCase() || null,
    manualDiscount: approvedDiscount?.amount ?? 0,
  });

  async function searchMember(term: string) {
    const q = term.trim();
    if (q.length < 3) { setMemberResults([]); return; }
    setMemberSearching(true);
    try {
      const res = await fetch(`/api/pos/member?q=${encodeURIComponent(q)}`, { headers: authHeaders, cache: "no-store" });
      const data = await res.json();
      setMemberResults(Array.isArray(data.members) ? data.members : []);
    } catch {
      setMemberResults([]);
    } finally {
      setMemberSearching(false);
    }
  }

  /** เปิดกล่องสมัคร โดยยกเบอร์ที่พนักงานพิมพ์ค้นไว้มาต่อ ไม่ต้องพิมพ์ซ้ำ */
  function openEnroll(prefill: string) {
    setEnrollPhone(prefill.replace(/[^0-9+]/g, ""));
    setEnrollName("");
    setEnrollStep("phone");
    setEnrollOpen(true);
  }

  async function enrollMemberFromPos() {
    const phone = enrollPhone.trim();
    if (!phone || !cashierId || !pin) {
      setNotice({ type: "error", text: "ต้องเลือกพนักงาน + ใส่ PIN ก่อนสมัครสมาชิก" });
      return;
    }
    try {
      const res = await fetch("/api/pos/member", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ phone, name: enrollName.trim() || null, cashierUserId: cashierId, pin }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "INVALID") {
        setNotice({ type: "error", text: data.reason || data.error || "สมัครสมาชิกไม่สำเร็จ" });
        return;
      }
      // สมัครแล้วผูกเข้าบิลที่กำลังขายทันที — พนักงานไม่ต้องกลับไปค้นซ้ำ
      setMember(data.member);
      setEnrollOpen(false);
      setEnrollName("");
      setEnrollPhone("");
      setMemberQuery("");
      setMemberResults([]);
      setNotice({
        type: "ok",
        text: data.status === "ALREADY_MEMBER"
          ? `เบอร์นี้เป็นสมาชิกอยู่แล้ว · ${data.member?.memberNo ?? ""}`
          : `สมัครสมาชิกแล้ว · ${data.member?.memberNo ?? ""}`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  function clearMember() {
    setMember(null);
    setPointsToRedeem("");
    setRedeemOpen(false);
    setMemberPreview(null);
    setMemberPreviewAppliedKey(null);
    setMemberResults([]);
    setMemberQuery("");
  }

  /** ล้างทุกอย่างที่ผูกกับ "ลูกค้าคนนี้บิลนี้" — เรียกหลังขายจบทุกครั้ง */
  function clearBillCustomerState() {
    clearMember();
    setCouponCode("");
    clearManualDiscount();
    // ค่าบริการผูกกับบิลใบนี้ ไม่ใช่ค่าตั้งของเครื่อง — ขายจบต้องล้าง
    setExtraLines([]);
  }

  /** ส่วนลดมืออนุมัติเป็นราย "บิล" ไม่ใช่รายกะ — ขายจบต้องล้างทุกครั้ง ไม่งั้นบิล
      ถัดไปได้ส่วนลดที่หัวหน้าไม่เคยอนุมัติ */
  function clearManualDiscount() {
    setApprovedDiscount(null);
    setDiscountDraft("");
    setDiscountReasonDraft("");
    setDiscountApproverPin("");
    setDiscountError(null);
    setDiscountOpen(false);
  }

  // ---- พักบิล (7.97) ------------------------------------------------
  // ตะกร้าที่พักไม่จองสต็อก จึงไม่มีอะไรต้องคืนตอนทิ้ง และของอาจหมดตอนเรียกกลับ
  // ซึ่ง createOrder จะปฏิเสธเองด้วย INSUFFICIENT — จอไม่ต้องเดาแทน

  async function refreshParked() {
    if (!token) return;
    try {
      const res = await fetch("/api/pos/park", { headers: authHeaders });
      if (res.ok) setParked((await res.json()).parked ?? []);
    } catch { /* รายการบิลพักหายชั่วคราวไม่ควรทำให้จอขายพัง */ }
  }

  async function doParkSale() {
    if (cart.length === 0) { setNotice({ type: "error", text: "ตะกร้าว่าง" }); return; }
    if (!parkLabel.trim()) {
      setNotice({ type: "error", text: "ตั้งชื่อบิลก่อน เช่น ชื่อลูกค้า" });
      return;
    }
    if (!cashierId) { setNotice({ type: "error", text: "เลือกผู้ขายก่อน" }); return; }
    try {
      const res = await fetch("/api/pos/park", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action: "park", cashierUserId: cashierId, label: parkLabel.trim(),
          cart, itemCount: itemCount, subtotalHint: total,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.status === "TOO_MANY"
          ? `พักได้สูงสุด ${data.limit} บิลต่อกะ — เคลียร์บิลเก่าก่อน`
          : data.error ?? "พักบิลไม่สำเร็จ" });
        return;
      }
      // ล้างตะกร้าและบริบทลูกค้าทั้งหมด — บิลถัดไปต้องเริ่มจากศูนย์จริง ๆ
      setCart([]);
      clearBillCustomerState();
      setParkLabel("");
      setParkOpen(false);
      void refreshParked();
      setNotice({ type: "ok", text: "พักบิลแล้ว" });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  async function doResumeParked(parkedId: string) {
    if (cart.length > 0) {
      setNotice({ type: "error", text: "ตะกร้ายังมีของ — ปิดบิลหรือพักบิลปัจจุบันก่อน" });
      return;
    }
    try {
      const res = await fetch("/api/pos/park", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", parkedId }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: "ไม่พบบิลพักใบนี้ (อาจถูกเรียกไปแล้วจากอีกเครื่อง)" }); return; }
      setCart(data.cart ?? []);
      void refreshParked();
      setNotice({ type: "ok", text: `เรียกบิล "${data.label}" กลับมาแล้ว — ราคาคิดใหม่ตอนกดรับเงิน` });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  async function doDropParked(parkedId: string) {
    try {
      await fetch("/api/pos/park", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ action: "drop", parkedId }),
      });
      void refreshParked();
    } catch { /* ทิ้งไม่สำเร็จก็แค่ยังอยู่ในรายการ ไม่ต้องรบกวนพนักงาน */ }
  }

  // ---- เงินเข้า-ออกลิ้นชัก (7.97) ------------------------------------

  async function refreshCashMoves() {
    if (!token) return;
    try {
      const res = await fetch("/api/pos/cash-movement", { headers: authHeaders });
      if (res.ok) setCashMoves((await res.json()).movements ?? []);
    } catch { /* ไม่สำคัญพอจะขัดจังหวะการขาย */ }
  }

  async function doCashMovement() {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกผู้ทำรายการและใส่ PIN ก่อน" }); return; }
    if (!cashMoveAmount) { setNotice({ type: "error", text: "ใส่จำนวนเงิน" }); focusLater(cashMoveAmountRef); return; }
    if (!cashMoveReason.trim()) { setNotice({ type: "error", text: "ใส่เหตุผล" }); focusLater(cashMoveReasonRef); return; }
    if (cashMoveDir === "IN" && !cashMoveExternalConfirmed) {
      setNotice({
        type: "error",
        text: "ยอดขายเงินสดถูกนับเข้าลิ้นชักอัตโนมัติแล้ว · ยืนยันก่อนว่าเงินก้อนนี้มาจากนอกยอดขาย",
      });
      return;
    }
    if (cashMoveDir === "OUT" && (!cashApproverId || !cashApproverPin)) {
      setNotice({ type: "error", text: "เงินออกจากลิ้นชักต้องมีหัวหน้าอนุมัติ" });
      if (!cashApproverId) focusLater(cashApproverSelectRef);
      else focusLater(cashApproverPinRef);
      return;
    }
    try {
      const signature = JSON.stringify({
        shiftId: session?.shift?.id ?? null,
        direction: cashMoveDir,
        amount: Number(cashMoveAmount),
        reason: cashMoveReason.trim(),
        cashierUserId: cashierId,
        approverUserId: cashMoveDir === "OUT" ? cashApproverId : null,
      });
      if (cashMovementRequestRef.current?.signature !== signature) {
        cashMovementRequestRef.current = { signature, key: `cash-move-${crypto.randomUUID()}` };
      }
      const res = await fetch("/api/pos/cash-movement", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          direction: cashMoveDir, amount: Number(cashMoveAmount), reason: cashMoveReason.trim(),
          cashierUserId: cashierId, pin,
          approverUserId: cashMoveDir === "OUT" ? cashApproverId : null,
          approverPin: cashMoveDir === "OUT" ? cashApproverPin : null,
          idempotencyKey: cashMovementRequestRef.current.key,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.status === "WOULD_OVERDRAW"
          ? (data.available == null
              ? "จำนวนเงินมากกว่าที่ควรมีในลิ้นชัก — ตรวจตัวเลขอีกครั้ง"
              : `เงินในลิ้นชักที่ควรมีอยู่ ฿${baht(data.available)} — ถอนมากกว่านี้ไม่ได้`)
          : data.error ?? data.reason ?? "บันทึกไม่สำเร็จ" });
        return;
      }
      cashMovementRequestRef.current = null;
      setCashMoveAmount(""); setCashMoveReason(""); setCashMoveExternalConfirmed(false); setCashApproverPin("");
      void refreshCashMoves();
      setNotice({
        type: "ok",
        text: data.drawerAfter == null
          ? "บันทึกแล้ว (ร้านนี้เปิดโหมดนับปิดตา — ไม่แสดงยอดที่ควรมีจนกว่าจะปิดกะ)"
          : `บันทึกแล้ว · เงินในลิ้นชักที่ควรมีตอนนี้ ฿${baht(data.drawerAfter)}`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  // ---- ค่าใช้จ่ายเงินสดย่อย (9.7) ----------------------------------

  async function refreshExpenses() {
    if (!token || !cashierId || !pin) return;
    const requestSeq = ++expenseRefreshSeqRef.current;
    try {
      const res = await fetch("/api/pos/expense", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ action: "list", cashierUserId: cashierId, pin }),
        cache: "no-store",
      });
      if (requestSeq !== expenseRefreshSeqRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (requestSeq !== expenseRefreshSeqRef.current) return;
        setExpenseAccessError(null);
        setExpenses(data.expenses ?? []);
        setCanUsePersonalFunds(Boolean(data.canUsePersonalFunds));
        setCanManagePettyCash(Boolean(data.canManagePettyCash));
        setPettyCashBalance(Number(data.pettyCashWallet?.balance ?? 0));
        setPettyCashEntries(data.pettyCashWallet?.entries ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        setExpenseAccessError(data?.error ?? "โหลดสิทธิ์และยอดเงินสดย่อยไม่สำเร็จ");
        setExpenses([]);
        setCanUsePersonalFunds(false);
        setCanManagePettyCash(false);
        setPettyCashBalance(0);
        setPettyCashEntries([]);
      }
    } catch {
      if (requestSeq !== expenseRefreshSeqRef.current) return;
      setExpenseAccessError("เชื่อมต่อเพื่อโหลดสิทธิ์และยอดเงินสดย่อยไม่ได้");
    }
  }

  function expenseRequestError(data: any): string {
    if (data?.status === "WOULD_OVERDRAW") {
      return data.available == null
        ? "จำนวนเงินมากกว่าที่ควรมีในลิ้นชัก — ตรวจตัวเลขอีกครั้ง"
        : `เงินในลิ้นชักที่ควรมีอยู่ ฿${baht(Number(data.available))} — จ่ายมากกว่านี้ไม่ได้`;
    }
    if (data?.status === "IDEMPOTENCY_CONFLICT") return "คำขอซ้ำแต่รายละเอียดเปลี่ยน — กรุณากดใหม่อีกครั้ง";
    if (data?.status === "PETTY_CASH_INSUFFICIENT") {
      return `เงินสดย่อยคงเหลือ ฿${baht(Number(data.available ?? 0))} — จ่ายมากกว่านี้ไม่ได้`;
    }
    return data?.error ?? data?.reason ?? "บันทึกค่าใช้จ่ายไม่สำเร็จ";
  }

  async function createExpense() {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกผู้ทำรายการและใส่ PIN ก่อน" }); return; }
    if (!expenseDescription.trim()) {
      setNotice({ type: "error", text: "ใส่รายละเอียด" }); focusLater(expenseDescriptionRef); return;
    }
    if (!expenseAmount) {
      setNotice({ type: "error", text: "ใส่จำนวนเงิน" }); focusLater(expenseAmountRef); return;
    }
    const personalFunds = expenseMode === "PERSONAL";
    const pettyCash = expenseMode === "PETTY_CASH";
    const outsideDrawer = personalFunds || pettyCash;
    if (outsideDrawer && !expenseReceiptRef.trim()) {
      setNotice({ type: "error", text: "รายการนอกลิ้นชักต้องระบุเลขที่ใบเสร็จหรือหลักฐาน" });
      focusLater(expenseReceiptRefRef);
      return;
    }
    if (!outsideDrawer && (!expenseApproverId || !expenseApproverPin)) {
      setNotice({ type: "error", text: "ค่าใช้จ่ายต้องมีหัวหน้าอนุมัติ" });
      if (!expenseApproverId) focusLater(expenseApproverSelectRef);
      else focusLater(expenseApproverPinRef);
      return;
    }
    const signature = JSON.stringify({
      shiftId: session?.shift?.id ?? null,
      kind: outsideDrawer ? "DIRECT" : expenseMode,
      fundingSource: personalFunds ? "PERSONAL" : pettyCash ? "PETTY_CASH" : "DRAWER",
      category: expenseCategory,
      description: expenseDescription.trim(),
      payee: expensePayee.trim() || null,
      amount: Number(expenseAmount),
      receiptRef: expenseReceiptRef.trim() || null,
      cashierUserId: cashierId,
      approverUserId: outsideDrawer ? null : expenseApproverId,
    });
    if (expenseCreateRequestRef.current?.signature !== signature) {
      expenseCreateRequestRef.current = { signature, key: `expense-${crypto.randomUUID()}` };
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pos/expense", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          shiftId: session?.shift?.id,
          kind: outsideDrawer ? "DIRECT" : expenseMode,
          fundingSource: personalFunds ? "PERSONAL" : pettyCash ? "PETTY_CASH" : "DRAWER",
          category: expenseCategory,
          description: expenseDescription.trim(),
          payee: expensePayee.trim() || null,
          amount: Number(expenseAmount),
          receiptRef: expenseReceiptRef.trim() || null,
          cashierUserId: cashierId,
          pin,
          approverUserId: outsideDrawer ? null : expenseApproverId,
          approverPin: outsideDrawer ? null : expenseApproverPin,
          idempotencyKey: expenseCreateRequestRef.current.key,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: expenseRequestError(data) }); return; }
      expenseCreateRequestRef.current = null;
      setExpenseDescription(""); setExpensePayee(""); setExpenseAmount(""); setExpenseReceiptRef("");
      setExpenseApproverPin("");
      await Promise.all([refreshExpenses(), refreshCashMoves()]);
      setNotice({
        type: "ok",
        text: personalFunds
          ? `บันทึกเงินส่วนตัวแล้ว ฿${baht(data.expense.actualAmount)} — ยอดลิ้นชักไม่เปลี่ยน`
          : pettyCash
            ? `จ่ายจากเงินสดย่อยแล้ว ฿${baht(data.expense.actualAmount)} · คงเหลือ ฿${baht(data.pettyCashAfter)} — ยอดลิ้นชักไม่เปลี่ยน`
          : expenseMode === "DIRECT"
            ? `บันทึกค่าใช้จ่ายแล้ว ฿${baht(data.expense.actualAmount)}`
            : `เบิกเงินแล้ว ฿${baht(data.expense.advancedAmount)} — ต้องกลับมาปิดยอดก่อนปิดกะ`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function fundPettyCash() {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกเจ้าของร้านและใส่ PIN ก่อน" }); return; }
    if (!pettyFundAmount) { setNotice({ type: "error", text: "เติมจำนวนเงิน" }); focusLater(pettyFundAmountRef); return; }
    if (!pettyFundReason.trim()) { setNotice({ type: "error", text: "ระบุเหตุผล" }); focusLater(pettyFundReasonRef); return; }
    if (!pettyFundEvidence.trim()) { setNotice({ type: "error", text: "ระบุหลักฐาน" }); focusLater(pettyFundEvidenceRef); return; }
    const signature = JSON.stringify({
      shiftId: session?.shift?.id ?? null,
      source: pettyFundSource,
      amount: Number(pettyFundAmount),
      reason: pettyFundReason.trim(),
      evidenceRef: pettyFundEvidence.trim(),
      cashierUserId: cashierId,
    });
    if (pettyFundRequestRef.current?.signature !== signature) {
      pettyFundRequestRef.current = { signature, key: `petty-fund-${crypto.randomUUID()}` };
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pos/expense", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action: "fund",
          source: pettyFundSource,
          amount: Number(pettyFundAmount),
          reason: pettyFundReason.trim(),
          evidenceRef: pettyFundEvidence.trim(),
          cashierUserId: cashierId,
          pin,
          idempotencyKey: pettyFundRequestRef.current.key,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: expenseRequestError(data) }); return; }
      pettyFundRequestRef.current = null;
      setPettyFundAmount(""); setPettyFundReason(""); setPettyFundEvidence("");
      await refreshExpenses();
      setNotice({
        type: "ok",
        text: `เติมเงินสดย่อยแล้ว ฿${baht(data.entry.amount)} · คงเหลือ ฿${baht(data.balanceAfter)} — ยอดลิ้นชักไม่เปลี่ยน`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  function openExpenseSettlement(expense: PosExpense) {
    setSettleExpenseId(expense.id);
    setSettleActualAmount(String(expense.advancedAmount));
    setSettleReceiptRef(expense.receiptRef ?? "");
    setSettleApproverPin("");
    expenseSettleRequestRef.current = null;
  }

  async function settleExpense() {
    if (!settleExpenseId || !cashierId || !pin) return;
    if (settleActualAmount === "") { setNotice({ type: "error", text: "ใส่ยอดซื้อจริง" }); focusLater(settleActualAmountRef); return; }
    if (!settleApproverId || !settleApproverPin) {
      setNotice({ type: "error", text: "การปิดยอดต้องมีหัวหน้าอนุมัติ" });
      if (!settleApproverId) focusLater(settleApproverSelectRef);
      else focusLater(settleApproverPinRef);
      return;
    }
    const signature = JSON.stringify({
      shiftId: session?.shift?.id ?? null,
      expenseId: settleExpenseId,
      actualAmount: Number(settleActualAmount),
      receiptRef: settleReceiptRef.trim() || null,
      cashierUserId: cashierId,
      approverUserId: settleApproverId,
    });
    if (expenseSettleRequestRef.current?.signature !== signature) {
      expenseSettleRequestRef.current = { signature, key: `expense-settle-${crypto.randomUUID()}` };
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pos/expense", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action: "settle",
          shiftId: session?.shift?.id,
          expenseId: settleExpenseId,
          actualAmount: Number(settleActualAmount),
          receiptRef: settleReceiptRef.trim() || null,
          cashierUserId: cashierId,
          pin,
          approverUserId: settleApproverId,
          approverPin: settleApproverPin,
          idempotencyKey: expenseSettleRequestRef.current.key,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: expenseRequestError(data) }); return; }
      expenseSettleRequestRef.current = null;
      setSettleExpenseId(null); setSettleActualAmount(""); setSettleReceiptRef(""); setSettleApproverPin("");
      await Promise.all([refreshExpenses(), refreshCashMoves()]);
      const expense = data.expense as PosExpense;
      setNotice({
        type: "ok",
        text: expense.returnedAmount > 0
          ? `ปิดยอดแล้ว · ค่าใช้จ่าย ฿${baht(expense.actualAmount ?? 0)} · คืนลิ้นชัก ฿${baht(expense.returnedAmount)}`
          : expense.extraCashOut > 0
            ? `ปิดยอดแล้ว · ค่าใช้จ่าย ฿${baht(expense.actualAmount ?? 0)} · จ่ายเพิ่ม ฿${baht(expense.extraCashOut)}`
            : `ปิดยอดแล้ว · ค่าใช้จ่าย ฿${baht(expense.actualAmount ?? 0)}`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  // ---- มัดจำ / ค้างชำระ (9.0) --------------------------------------

  async function refreshDeposits() {
    if (!token) return;
    try {
      const res = await fetch("/api/pos/deposit", { headers: authHeaders, cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setDeposits(data.deposits ?? []);
        setDepositCandidateOrders(data.candidateOrders ?? []);
      }
    } catch { /* รายการโหลดใหม่ได้ ไม่ขัดจังหวะงานขาย */ }
  }

  async function createDepositFromCart() {
    if (!session?.shift || cart.length === 0 || !cashierId || !pin || busy || hasPendingSale) return;
    const amount = Math.round(Number(depositAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: "error", text: "ระบุยอดมัดจำให้ถูกต้อง" });
      return;
    }
    if (!hasPendingDepositSale && amount >= amountDue) {
      setNotice({ type: "error", text: "ยอดมัดจำต้องน้อยกว่ายอดบิล ถ้ารับเต็มยอดให้ใช้ปุ่มชำระเงินในหน้าขาย" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const savedAttempt = (() => {
        try { return JSON.parse(window.localStorage.getItem(PENDING_DEPOSIT_SALE_KEY) ?? "null"); } catch { return null; }
      })();
      if (!savedAttempt?.body && await refreshCartPricingBeforePay()) return;

      const needsDiscountPreview = Boolean(member || pointsToRedeem || couponCode.trim() || approvedDiscount);
      if (!savedAttempt?.body && needsDiscountPreview && (
        !memberPreview
        || memberPreviewAppliedKey !== memberPreviewRequestKey
        || Math.abs(Number(memberPreview.subtotal) - total) > 0.001
      )) {
        setNotice({ type: "error", text: "รอระบบตรวจราคาสมาชิก คูปอง และแต้มล่าสุดก่อนรับมัดจำ" });
        return;
      }
      if (savedAttempt?.body?.manualDiscount > 0 && !approvedDiscount) {
        setNotice({ type: "error", text: "รายการมัดจำค้างมีส่วนลดหน้าร้าน — ให้หัวหน้ากดอนุมัติใหม่ก่อน" });
        setDiscountOpen(true);
        return;
      }

      const body = savedAttempt?.body
        ? {
            ...savedAttempt.body,
            cashierUserId: cashierId,
            pin,
            discountApproverPin: approvedDiscount?.approverPin ?? null,
          }
        : {
            mode: "DEPOSIT",
            shiftId: session.shift.id,
            cashierUserId: cashierId,
            pin,
            idempotencyKey: `deposit-cart-${session.device.code}-${session.shift.id.slice(0, 8)}-${crypto.randomUUID()}`,
            customerId: member?.customerId ?? null,
            pointsToRedeem: memberPreview?.pointsUsed ?? 0,
            couponCode: couponCode.trim() || null,
            manualDiscount: approvedDiscount?.amount ?? 0,
            discountReason: approvedDiscount?.reason ?? null,
            discountApproverUserId: approvedDiscount?.approverId ?? null,
            discountApproverPin: approvedDiscount?.approverPin ?? null,
            lines: cart.map((line) => ({
              sku: line.sku,
              size: line.size,
              packQty: line.packQty,
              packCode: line.packCode,
            })),
            extraLines: extraLines
              .map((line) => ({ label: line.label.trim(), unitAmount: Number(line.unitAmount) }))
              .filter((line) => line.label && Number.isFinite(line.unitAmount) && line.unitAmount > 0),
            payments: [{
              method: depositMethod,
              amount,
              cashTendered: depositMethod === "CASH" ? amount : null,
            }],
          };

      window.localStorage.setItem(
        PENDING_DEPOSIT_SALE_KEY,
        JSON.stringify({ body: { ...body, pin: undefined, discountApproverPin: undefined }, cart })
      );
      setHasPendingDepositSale(true);

      const res = await fetch("/api/pos/sale", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const rawBody = await res.text();
      let data: any = null;
      try { data = rawBody ? JSON.parse(rawBody) : null; } catch {}
      if (data == null) throw new Error(`เซิร์ฟเวอร์ตอบกลับไม่ครบ (HTTP ${res.status})`);

      if (res.ok && data.status === "DEPOSIT_TAKEN") {
        const orderRef = String(data.orderId ?? "").slice(0, 8).toUpperCase();
        setDepositOrderId(data.orderId ?? "");
        setDepositAmount("");
        setCart([]);
        clearBillCustomerState();
        window.localStorage.removeItem(PENDING_DEPOSIT_SALE_KEY);
        setHasPendingDepositSale(false);
        setNotice({
          type: "ok",
          text: `สร้างบิล #${orderRef} และรับมัดจำ ฿${baht(Number(data.deposit?.depositPaid ?? amount))} แล้ว${
            data.replayed ? " (รายการเดิม ไม่ได้รับเงินซ้ำ)" : ""
          }`,
        });
        void refreshDeposits();
        return;
      }

      if (data?.status !== "SERVER_ERROR") {
        window.localStorage.removeItem(PENDING_DEPOSIT_SALE_KEY);
        setHasPendingDepositSale(false);
      }
      setNotice({ type: "error", text: data?.reason ?? describeFailure(data) });
    } catch (error: any) {
      setNotice({
        type: "error",
        text: `ส่งไม่สำเร็จ (${String(error?.message ?? error)}) — กด “สร้างบิล + รับมัดจำ” ซ้ำ ระบบจะใช้คีย์เดิมและไม่รับเงินซ้ำ`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function doDepositAction(action: "take" | "add" | "settle" | "close") {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อน" }); return; }
    if (!depositOrderId.trim()) { setNotice({ type: "error", text: "เลือกบิลที่ต้องการทำรายการมัดจำ" }); return; }
    const amount = Number(depositAmount);
    if (action !== "close" && (!Number.isFinite(amount) || amount <= 0)) {
      setNotice({ type: "error", text: "ระบุจำนวนเงินให้ถูกต้อง" }); return;
    }
    if (action === "close" && !depositReason.trim()) {
      setNotice({ type: "error", text: "ระบุเหตุผลที่ปิดมัดจำ" }); return;
    }
    setBusy(true);
    try {
      const signature = JSON.stringify({ action, orderId: depositOrderId.trim(), amount, method: depositMethod });
      if (depositRequestRef.current?.signature !== signature) {
        depositRequestRef.current = {
          signature,
          key: `deposit-${action}-${depositOrderId}-${crypto.randomUUID()}`,
        };
      }
      const requestKey = depositRequestRef.current.key;
      const res = await fetch("/api/pos/deposit", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action,
          orderId: depositOrderId.trim(),
          cashierUserId: cashierId,
          pin,
          amount,
          method: depositMethod,
          payments: action === "settle" ? [{
            method: depositMethod,
            amount,
            cashTendered: depositMethod === "CASH" ? amount : null,
          }] : undefined,
          // ถ้าบิลมัดจำมีสินค้าที่ติดตาม serial พนักงานยิงของจริงใส่ตะกร้า
          // ก่อน settle แล้ว server เทียบจำนวนกับ order item จากฐานข้อมูลอีกชั้น
          lines: action === "settle" ? cart.map((line) => ({
            sku: line.sku,
            size: line.size,
            serials: line.serials?.length ? line.serials : undefined,
          })) : undefined,
          outcome: depositOutcome,
          reason: depositReason.trim(),
          idempotencyKey: requestKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.error ?? data.reason ?? `ทำรายการมัดจำไม่สำเร็จ (${data.status ?? res.status})` });
        return;
      }
      setNotice({
        type: "ok",
        text: action === "settle" ? "รับยอดคงเหลือและปิดการขายแล้ว"
          : action === "close" ? `ปิดมัดจำเป็น ${depositOutcome === "FORFEITED" ? "ยึดมัดจำ" : "คืนมัดจำ"} แล้ว`
          : action === "take" ? "รับมัดจำแล้ว" : "รับเงินมัดจำเพิ่มแล้ว",
      });
      setDepositAmount("");
      setDepositReason("");
      if (action === "settle") {
        // ตะกร้านี้ใช้ยืนยันของจริง/serial ที่ส่งมอบให้บิลมัดจำแล้ว
        // เก็บไว้ต่อจะเสี่ยงกดขายซ้ำเป็นบิลใหม่โดยไม่ตั้งใจ
        setCart([]);
        clearBillCustomerState();
      }
      depositRequestRef.current = null;
      void refreshDeposits();
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  // ---- ยกเลิกบิล (7.97) ----------------------------------------------

  async function doVoidSale(orderId: string) {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกผู้ขายและใส่ PIN ก่อน" }); return; }
    if (!voidReason.trim()) { setNotice({ type: "error", text: "ต้องระบุเหตุผลที่ยกเลิก" }); return; }
    if (!voidApproverId || !voidApproverPin) { setNotice({ type: "error", text: "ยกเลิกบิลต้องมีหัวหน้าอนุมัติ" }); return; }
    try {
      const res = await fetch("/api/pos/void", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          orderId, reason: voidReason.trim(),
          cashierUserId: cashierId, pin,
          approverUserId: voidApproverId, approverPin: voidApproverPin,
          idempotencyKey: `void-${orderId}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text:
          data.status === "SHIFT_CLOSED" ? "บิลนี้อยู่ในกะที่ปิดไปแล้ว — ต้องทำเป็นการคืนสินค้าแทน"
          : data.status === "ALREADY_RETURNED" ? "บิลนี้เคยคืนสินค้าไปแล้ว — เดินทางการคืนให้จบแทน"
          : data.error ?? data.reason ?? "ยกเลิกไม่สำเร็จ" });
        return;
      }
      setVoidTarget(null); setVoidReason(""); setVoidApproverPin("");
      void loadRecentReceipts(recentSalesQuery);
      setNotice({ type: "ok", text: `ยกเลิกบิลแล้ว · คืนเงิน ฿${baht(data.refundAmount)}` });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  // ---- ส่งสำเนาใบเสร็จ (8.6) -----------------------------------------
  // ไม่สร้างเอกสารภาษีใบใหม่ — อ่านตัวเลขจากใบกำกับที่ออกไปแล้ว
  // ส่งไม่สำเร็จไม่กระทบการขายที่จบไปแล้ว จอแค่บอกว่าส่งไม่ได้
  async function doSendReceipt(orderId: string, channel: "email" | "line") {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อน" }); return; }
    setSendingReceipt(true);
    try {
      const res = await fetch("/api/pos/send-receipt", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          orderId, channel, cashierUserId: cashierId, pin,
          to: receiptTo.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data.reason ?? data.error ?? "ส่งไม่สำเร็จ" });
        return;
      }
      setReceiptTo("");
      setNotice({ type: "ok", text: `ส่งใบเสร็จไปที่ ${data.to} แล้ว` });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setSendingReceipt(false);
    }
  }

  // ---- คืนไม่มีใบเสร็จ (8.2) -----------------------------------------
  // ใช้ตะกร้าปัจจุบันเป็นรายการของที่ลูกค้าเอามาคืน — พนักงานยิงของที่ถืออยู่ตามปกติ
  // ไม่ต้องมีจอกรอกแยก · ราคาที่คืนใช้ราคาป้ายวันนี้ ซึ่ง server บังคับเป็นเพดานอีกชั้น
  async function doBlindReturn() {
    if (cart.length === 0) { setNotice({ type: "error", text: "ยิงของที่ลูกค้าเอามาคืนใส่ตะกร้าก่อน" }); return; }
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อน" }); return; }
    if (!blindReason.trim()) { setNotice({ type: "error", text: "ต้องระบุเหตุผล" }); return; }
    if (!blindApproverId || !blindApproverPin) { setNotice({ type: "error", text: "ต้องมีหัวหน้าอนุมัติ" }); return; }
    try {
      const signature = JSON.stringify({
        shiftId: session?.shift?.id ?? null,
        cashierUserId: cashierId,
        approverUserId: blindApproverId,
        reason: blindReason.trim(),
        customerId: member?.customerId ?? null,
        lines: cart.map((line) => ({
          sku: line.sku, size: line.size,
          qty: line.packQty * line.baseQty, unitRefund: line.basePrice,
        })),
      });
      if (blindReturnRequestRef.current?.signature !== signature) {
        blindReturnRequestRef.current = { signature, key: `blind-${crypto.randomUUID()}` };
      }
      const res = await fetch("/api/pos/blind-return", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          cashierUserId: cashierId, pin,
          approverUserId: blindApproverId, approverPin: blindApproverPin,
          reason: blindReason.trim(),
          customerId: member?.customerId ?? null,
          // UUID นี้คงเดิมเฉพาะ retry ของ attempt เดียวกัน รายการใหม่ที่ตะกร้าเหมือนกัน
          // ต้องได้ UUID ใหม่ ไม่งั้นลูกค้าคนถัดไปจะ replay รายการของคนก่อน
          idempotencyKey: blindReturnRequestRef.current.key,
          lines: cart.map((line) => ({
            sku: line.sku,
            size: line.size,
            qty: line.packQty * line.baseQty,
            unitRefund: line.basePrice,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text:
          data.status === "PRICE_TOO_HIGH" ? `${data.sku}: คืนได้ไม่เกินชิ้นละ ฿${baht(data.maxUnitRefund)}`
          : data.status === "NOT_ENOUGH_CASH" ? (data.available == null
              ? "เงินในลิ้นชักไม่พอจ่ายคืน"
              : `เงินในลิ้นชักมี ฿${baht(data.available)} จ่ายคืนไม่พอ`)
          : data.error ?? data.reason ?? "คืนไม่สำเร็จ" });
        return;
      }
      blindReturnRequestRef.current = null;
      setCart([]);
      clearBillCustomerState();
      setBlindReason(""); setBlindApproverPin(""); setBlindOpen(false);
      setNotice({
        type: "ok",
        text: data.replayed
          ? "รายการนี้บันทึกไว้แล้ว (ไม่ได้จ่ายเงินซ้ำ)"
          : `คืนแล้ว · จ่ายเงินสด ฿${baht(data.refundAmount)}`,
      });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  // ---- เปิดลิ้นชักโดยไม่ขาย (8.0) ------------------------------------
  // ปุ่มนี้ "ไม่ได้" เปิดลิ้นชักด้วยตัวเอง — มันบันทึกว่ามีการเปิด แล้วสั่งเปิดผ่าน
  // ESC/POS ถ้าต่อเครื่องพิมพ์ไว้ · ต่อให้สั่งไม่ได้ บันทึกก็ต้องเกิด เพราะพนักงาน
  // จะเปิดด้วยคันโยกใต้ลิ้นชักอยู่ดี และเราต้องการร่องรอยมากกว่าต้องการการควบคุม
  async function doNoSale() {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อน" }); return; }
    if (!noSaleReason.trim()) {
      setNotice({ type: "error", text: "ต้องระบุเหตุผลที่เปิดลิ้นชัก" });
      focusLater(noSaleReasonRef);
      return;
    }
    try {
      const res = await fetch("/api/pos/no-sale", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ cashierUserId: cashierId, pin, reason: noSaleReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: data.error ?? data.reason ?? "บันทึกไม่สำเร็จ" }); return; }
      setNoSaleReason("");
      // สั่งเปิดลิ้นชักจริงถ้าต่อเครื่องพิมพ์ไว้ · ล้มได้ไม่กระทบบันทึกที่ลงไปแล้ว
      try { await openCashDrawer(); } catch { /* ไม่มีเครื่องพิมพ์ = เปิดมือเอา */ }
      setNotice({ type: "ok", text: "บันทึกการเปิดลิ้นชักแล้ว" });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  // ---- สรุปกะ X/Z (7.97) ---------------------------------------------

  async function loadShiftReport() {
    if (!cashierId || !pin) { setNotice({ type: "error", text: "เลือกพนักงานและใส่ PIN ก่อน" }); return; }
    try {
      const qs = new URLSearchParams({ cashierUserId: cashierId, pin });
      const res = await fetch(`/api/pos/shift-report?${qs}`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { setNotice({ type: "error", text: data.error ?? "ดูสรุปกะไม่ได้" }); return; }
      setShiftReport(data.report);
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  /**
   * รับส่วนลดมือเข้าบิล — ตรวจแค่รูปแบบที่จอ ส่วนสิทธิ์/PIN/เพดานตรวจจริงที่ server
   * ตอนกดรับเงิน จอไม่ยิง API ตรงนี้เพราะการอนุมัติต้องผูกกับบิลใบที่ขายจริง
   * ไม่ใช่ token ลอย ๆ ที่เอาไปใช้กับบิลอื่นได้
   */
  function applyManualDiscount() {
    const amount = Math.round(Number(discountDraft) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) { setDiscountError("จำนวนเงินไม่ถูกต้อง"); return; }
    if (amount > total) { setDiscountError("ส่วนลดเกินยอดสินค้า"); return; }
    if (!discountReasonDraft.trim()) { setDiscountError("ต้องระบุเหตุผล"); return; }
    if (!discountApproverId) { setDiscountError("เลือกผู้อนุมัติก่อน"); return; }
    if (!discountApproverPin) { setDiscountError("ใส่ PIN ผู้อนุมัติ"); return; }
    const approver = (session?.cashiers ?? []).find((c) => c.id === discountApproverId);
    setApprovedDiscount({
      amount,
      reason: discountReasonDraft.trim(),
      approverId: discountApproverId,
      approverPin: discountApproverPin,
      approverName: approver?.name ?? approver?.email ?? "—",
    });
    setDiscountOpen(false);
    setDiscountError(null);
  }

  /** ปรับจำนวนแต้มเป็นก้าวละ 1 หน่วยแลก — เศษแต้มไม่แปลงเป็นส่วนลดอยู่แล้ว */
  function stepPoints(direction: 1 | -1) {
    if (!member) return;
    const step = redeemPointsPerUnit;
    // normalize ค่าค้างจากเวอร์ชันเดิมก่อนขยับ เพื่อไม่พาเศษแต้มไปกับปุ่ม +/-
    const cur = maxWholeRedeemPoints(Number(pointsToRedeem) || 0, step);
    const next = Math.max(0, Math.min(maxRedeemPoints, cur + direction * step));
    setPointsToRedeem(next === 0 ? "" : String(next));
  }

  function normalizeTypedPoints() {
    const typed = Math.max(0, Math.floor(Number(pointsToRedeem) || 0));
    const normalized = Math.min(maxRedeemPoints, maxWholeRedeemPoints(typed, redeemPointsPerUnit));
    setPointsToRedeem(normalized > 0 ? String(normalized) : "");
  }

  /**
   * จอแสดงผลฝั่งลูกค้า (8.6) — ส่งสถานะตะกร้าไปหน้าต่างที่สอง
   *
   * BroadcastChannel ไม่ใช่ WebSocket โดยตั้งใจ: จอที่สองคือหน้าต่างของเบราว์เซอร์
   * ตัวเดียวกันบนเครื่องเดียวกัน (ต่อ HDMI) ข้อความจึงไม่ต้องวิ่งผ่านเซิร์ฟเวอร์เลย
   * — ยอดบนจอลูกค้าไม่มีทางค้างเพราะเน็ตร้านหลุด ซึ่งเป็นตอนที่ค้างแล้วแย่ที่สุด
   *
   * เปิด/ปิดจอลูกค้าไม่ต้องตั้งค่าอะไร: ถ้าไม่มีใครฟัง postMessage ก็ไม่มีผลอะไร
   */
  const displayChannel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("bms-pos-display");
    displayChannel.current = ch;
    return () => { ch.close(); displayChannel.current = null; };
  }, []);

  // บิลพักโหลดตอนเข้าแท็บขาย · เงินลิ้นชัก/ค่าใช้จ่ายตอนเข้าแท็บกะ · มัดจำตอนเข้าแท็บมัดจำ
  // โหลดตามแท็บ ไม่ใช่ polling — จอนี้เปิดค้างทั้งวัน การ poll ทุกสองสามวินาที
  // ตลอดกะคือ request หลายพันครั้งต่อวันต่อเครื่องเพื่อข้อมูลที่เปลี่ยนวันละไม่กี่ครั้ง
  useEffect(() => {
    if (!token || !session?.shift) return;
    if (tab === "sell") void refreshParked();
    if (tab === "shift") {
      void refreshCashMoves();
      void refreshExpenses();
    }
    if (tab === "deposits") void refreshDeposits();
  }, [token, tab, session?.shift?.id]);

  // สิทธิ์ใช้เงินส่วนตัวผูกกับคนที่กด PIN ไม่ใช่เครื่องขาย เปลี่ยนคนแล้วต้อง
  // โหลดสิทธิ์ใหม่ก่อนแสดงโหมดเจ้าของคนเดียว
  useEffect(() => {
    expenseRefreshSeqRef.current += 1;
    setCanUsePersonalFunds(false);
    setCanManagePettyCash(false);
    setExpenseAccessError(null);
    setExpenses([]);
    setPettyCashBalance(0);
    setPettyCashEntries([]);
    setExpenseApproverId("");
    setExpenseApproverPin("");
    setSettleApproverId("");
    setSettleApproverPin("");
    setSettleExpenseId(null);
    setExpenseMode((current) => current === "PERSONAL" || current === "PETTY_CASH" ? "DIRECT" : current);
  }, [cashierId]);

  // ส่วนลดสมาชิก/แต้ม คิดใหม่ทุกครั้งที่ตะกร้าหรือแต้มที่ขอแลกเปลี่ยน
  // debounce สั้น ๆ กันยิงถี่ตอนพนักงานพิมพ์จำนวนแต้ม
  useEffect(() => {
    if (!token || total <= 0) {
      setMemberPreview(null);
      setMemberPreviewAppliedKey(null);
      return;
    }
    if (!member && !pointsToRedeem && !couponCode.trim() && !approvedDiscount) {
      setMemberPreview(null);
      setMemberPreviewAppliedKey(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/pos/member/preview", {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            customerId: member?.customerId ?? null,
            subtotal: total,
            pointsToRedeem: Number(pointsToRedeem) || 0,
            couponCode: couponCode.trim() || null,
            manualDiscount: approvedDiscount?.amount ?? 0,
          }),
        });
        if (!res.ok) {
          setMemberPreview(null);
          setMemberPreviewAppliedKey(null);
          return;
        }
        const preview = await res.json();
        if (!controller.signal.aborted) {
          setMemberPreview(preview);
          setMemberPreviewAppliedKey(memberPreviewRequestKey);
          // Server อาจตัดเศษหน่วยหรือชนเพดานส่วนลด ให้ตัวเลขที่พนักงานเห็นตรงกับ
          // pointsUsed ที่จะส่งไปตัดจริง ไม่แสดง 3,045 ขณะที่กำลังใช้เพียง 3,000
          const requested = Math.max(0, Math.floor(Number(pointsToRedeem) || 0));
          const used = Math.max(0, Math.floor(Number(preview.pointsUsed) || 0));
          // ระหว่างกำลังพิมพ์อาจมีค่า 3 หรือ 30 ชั่วคราว อย่ารีบล้างช่องก่อนครบ
          // หน่วยแรก; เมื่อออกจากช่อง normalizeTypedPoints จะจัดการค่าที่ไม่ครบเอง
          if (requested >= redeemPointsPerUnit && used !== requested) {
            setPointsToRedeem(used > 0 ? String(used) : "");
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setMemberPreview(null);
          setMemberPreviewAppliedKey(null);
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [token, authHeaders, member, total, pointsToRedeem, couponCode, approvedDiscount, memberPreviewRequestKey]);

  // ปัดเศษเงินสด: ต้องคิดให้ตรงกับ server เป๊ะ ๆ (pos.ts: ปัดเฉพาะบิลที่ทุกวิธี
  // จ่ายเป็นเงินสด) ไม่งั้นยอดที่ส่งไปไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH
  // และบิลถูกยกเลิกทิ้ง · ก่อนกรอกจำนวนเงิน ใช้ "วิธีจ่ายที่เลือกไว้" ตัดสินแทน
  const roundingDelta = useMemo(() => {
    const mode = session?.vat.cashRounding ?? "NONE";
    if (mode === "NONE" || payableBeforeRounding <= 0) return 0;
    const withAmount = payments.filter((p) => (Number(p.amount) || 0) > 0);
    const considered = withAmount.length > 0 ? withAmount : payments;
    if (considered.length === 0 || !considered.every((p) => p.method === "CASH")) return 0;
    // server ปัดเศษจากยอด "สินค้าหลังหักส่วนลด + ค่าบริการ" (createOrder คืน
    // amountDue = finalTotal) ไม่ใช่จากฐานส่วนลดอย่างเดียว
    // ปัดจากยอดก่อนส่วนลดจะได้เลขคนละตัวแล้วบิลถูกยกเลิกทิ้ง
    return cashRoundingDelta(payableBeforeRounding, mode);
  }, [session?.vat.cashRounding, payableBeforeRounding, payments]);
  /** ยอดที่ต้องเก็บจริง = ยอดสินค้า − ส่วนลด + ค่าบริการ + ปัดเศษ */
  const amountDue = useMemo(
    () => Math.round((payableBeforeRounding + roundingDelta) * 100) / 100,
    [payableBeforeRounding, roundingDelta]
  );
  useEffect(() => {
    const ch = displayChannel.current;
    if (!ch) return;
    ch.postMessage({
      lines: [
        ...cart.map((l) => ({
          name: l.receiptName,
          size: l.size && l.size !== "-" ? l.size : null,
          qty: l.packQty,
          unitName: l.unitName,
          amount: (tierPriceByKey.get(l.key) ?? l.packPrice) * l.packQty,
        })),
        ...extraLines
          .filter((x) => x.label.trim() && Number(x.unitAmount) > 0)
          .map((x) => ({
            name: x.label.trim(), size: null, qty: 1, unitName: "", amount: Number(x.unitAmount),
          })),
      ],
      itemCount,
      total,
      discountTotal,
      amountDue,
      memberName: member?.name ?? null,
      pointsEarned: null,
      // บิลที่ปิดแล้วค้างบนจอให้ลูกค้านับเงินทอนตาม จนกว่าจะเริ่มยิงบิลถัดไป
      finished: cart.length === 0 && justSold
        ? { total: justSold.total, tendered: null, change: justSold.change }
        : null,
    });
  }, [cart, extraLines, itemCount, total, discountTotal, amountDue, member, justSold, tierPriceByKey]);

  // ฟอร์มย่อใช้ได้เมื่อ: ยังไม่กดจ่ายผสม + มีรายการเดียว + เป็นเงินสด
  const simpleCash = !splitMode && payments.length === 1 && payments[0]?.method === "CASH";
  const cashChangePreview = (() => {
    if (!simpleCash) return null;
    const t = Number(payments[0]?.tendered);
    if (!Number.isFinite(t) || t <= 0 || amountDue <= 0) return null;
    return Math.max(0, Math.round((t - amountDue) * 100) / 100);
  })();

  const paymentSummary = useMemo(() => {
    const normalized = payments.map((payment) => {
      const amount = Number(payment.amount);
      const tendered = payment.method === "CASH" ? Number(payment.tendered) : NaN;
      const safeAmount = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
      const safeTendered =
        payment.method === "CASH" && Number.isFinite(tendered) && tendered > 0 ? Math.round(tendered * 100) / 100 : 0;
      return {
        ...payment,
        numericAmount: safeAmount,
        numericTendered: safeTendered,
        numericChange:
          payment.method === "CASH" && safeTendered > 0
            ? Math.max(0, Math.round((safeTendered - safeAmount) * 100) / 100)
            : 0,
      };
    });
    const paid = Math.round(normalized.reduce((sum, payment) => sum + payment.numericAmount, 0) * 100) / 100;
    const remaining = Math.round((amountDue - paid) * 100) / 100;
    return { normalized, paid, remaining };
  }, [payments, amountDue]);

  /**
   * เหตุผลที่ยังกดชำระเงินไม่ได้ — เรียงตามลำดับที่พนักงานต้องลงมือทำ
   * null = กดได้
   */
  const payBlockedReason: string | null = (() => {
    if (hasPendingDepositSale) return "มีรายการมัดจำรอตรวจสอบ — ไปแท็บมัดจำและกดตรวจรายการเดิม";
    if (cart.length === 0) return "ยังไม่มีสินค้าในบิล";
    if (!session?.shift) return "ยังไม่ได้เปิดกะ";
    if (!cashierId) return "เลือกผู้ขายก่อน";
    if (!pin) return "ใส่ PIN ของผู้ขาย";
    const needsDiscountPreview = Boolean(member || pointsToRedeem || couponCode.trim() || approvedDiscount);
    if (needsDiscountPreview && (
      !memberPreview
      || memberPreviewAppliedKey !== memberPreviewRequestKey
      || Math.abs(Number(memberPreview.subtotal) - total) > 0.001
    )) return "กำลังตรวจราคาสมาชิก คูปอง และแต้มล่าสุด";
    if (paymentSummary.remaining > 0.01) return `ยังรับเงินไม่ครบ — ขาด ฿${baht(paymentSummary.remaining)}`;
    if (paymentSummary.remaining < -0.01) return `ยอดรับเกินไป ฿${baht(Math.abs(paymentSummary.remaining))}`;
    if (!canSell) return "ยังขายไม่ได้";
    return null;
  })();

  async function handleScan(
    code: string,
    size?: string | null,
    mode: "sale" | "lookup" = lookupMode ? "lookup" : "sale",
    restoreFocus = true
  ) {
    if (hasPendingOrderWrite) {
      setNotice({ type: "error", text: "มีบิลรอตรวจสอบอยู่ กรุณากดชำระเงินซ้ำให้จบก่อนแก้รายการ" });
      return;
    }
    const trimmed = code.trim();
    if (!trimmed || !token) return;
    setScanCode("");
    try {
      const params = new URLSearchParams({ code: trimmed });
      if (size?.trim()) params.set("size", size.trim().toUpperCase());
      const res = await fetch(`/api/pos/scan?${params.toString()}`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", text: data?.error ?? "ยิงไม่สำเร็จ" });
        return;
      }
      const hit: ScanHit = data;
      // ยิงของชิ้นถัดไปคือสัญญาณว่าลูกค้าคนใหม่มาแล้ว — เก็บผลบิลก่อนให้เอง
      // รวมถึงใบเสร็จที่เปิดค้างไว้ ไม่งั้นบิลของลูกค้าคนก่อนบังจอคนถัดไป
      if (justSold) setJustSold(null);
      if (receiptModalOpen) setReceiptModalOpen(false);
      if (mode === "lookup") {
        setLookup(hit);
        setNotice(null);
        return;
      }
      const key = `${hit.sku}__${hit.size}__${hit.packCode}`;
      setCart((cur) => addScanHitToCart(cur, hit, key));
      setNotice(null);
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      if (restoreFocus) scanRef.current?.focus();
    }
  }

  async function handleStockScan(code: string) {
    const order = stockOrder;
    if (!order) {
      setNotice({ type: "error", text: "เลือกใบสั่งซื้อก่อนยิงสินค้าเข้าสต็อก" });
      return;
    }
    const trimmed = code.trim();
    if (!trimmed || !token) return;
    try {
      const res = await fetch(`/api/pos/scan?${new URLSearchParams({ code: trimmed })}`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "ไม่พบสินค้าจากรหัสนี้");
      const hit = data as ScanHit;
      const pending = order.items.filter((line) => line.qtyReceived < line.qtyOrdered);
      const exact = pending.find((line) =>
        line.sku === hit.sku && line.size.localeCompare(hit.size, undefined, { sensitivity: "accent" }) === 0
      );
      const sameSku = pending.filter((line) => line.sku === hit.sku);
      const line = exact ?? (sameSku.length === 1 ? sameSku[0] : null);
      if (!line) {
        setNotice({
          type: "error",
          text: sameSku.length > 1
            ? `${hit.sku} มีหลายขนาดใน PO — เลือกเพิ่มจำนวนที่บรรทัดให้ตรงก่อน`
            : `${hit.sku} · ${hit.size} ไม่อยู่ในรายการค้างรับของ PO นี้`,
        });
        return;
      }
      const key = stockLineKey(line.sku, line.size);
      const increment = Math.max(1, Number(hit.baseQty) || 1);
      const remaining = line.qtyOrdered - line.qtyReceived;
      const currentDraft = stockDraftRef.current;
      const current = currentDraft[key]?.qty ?? 0;
      if (current + increment > remaining) {
        setNotice({ type: "error", text: `${line.sku} · ${line.size} รับเกิน PO — เหลือรับได้ ${remaining - current}` });
        return;
      }
      replaceStockDraft({
        ...currentDraft,
        [key]: {
          qty: current + increment,
          lotNo: currentDraft[key]?.lotNo ?? "",
          expiryDate: currentDraft[key]?.expiryDate ?? "",
        },
      });
      stockReceiveRequestRef.current = null;
      setNotice({ type: "ok", text: `สแกน ${line.sku} · ${line.size} +${increment} หน่วย` });
    } catch (e: any) {
      setNotice({ type: "error", text: `ยิงรับสินค้าไม่สำเร็จ: ${String(e?.message ?? e)}` });
    }
  }

  function updateStockDraft(
    line: PosPurchaseDetail["items"][number],
    patch: Partial<{ qty: number; lotNo: string; expiryDate: string }>
  ) {
    const key = stockLineKey(line.sku, line.size);
    const remaining = Math.max(0, line.qtyOrdered - line.qtyReceived);
    const currentDraft = stockDraftRef.current;
    const current = currentDraft[key] ?? { qty: 0, lotNo: "", expiryDate: "" };
    const qty = patch.qty == null ? current.qty : Math.min(remaining, Math.max(0, Math.trunc(patch.qty)));
    const next = { ...currentDraft };
    if (qty === 0 && patch.lotNo == null && patch.expiryDate == null) delete next[key];
    else next[key] = { ...current, ...patch, qty };
    replaceStockDraft(next);
    stockReceiveRequestRef.current = null;
  }

  async function submitStockReceive() {
    if (!stockOrder) return;
    const items = stockOrder.items.flatMap((line) => {
      const draft = stockDraft[stockLineKey(line.sku, line.size)];
      return draft?.qty > 0 ? [{
        sku: line.sku,
        size: line.size,
        qty: draft.qty,
        lotNo: draft.lotNo.trim() || null,
        expiryDate: draft.expiryDate || null,
      }] : [];
    });
    if (!items.length) {
      setNotice({ type: "error", text: "ยังไม่มีสินค้าที่สแกนหรือระบุจำนวนรับ" });
      return;
    }
    const signature = JSON.stringify({ poId: stockOrder.id, items });
    if (!stockReceiveRequestRef.current || stockReceiveRequestRef.current.signature !== signature) {
      stockReceiveRequestRef.current = {
        signature,
        key: `${session?.device.code ?? "POS"}-receive-${crypto.randomUUID()}`,
      };
    }
    setStockReceiving(true);
    try {
      const data = await postPosPurchase({
        action: "receive",
        poId: stockOrder.id,
        items,
        idempotencyKey: stockReceiveRequestRef.current.key,
      });
      const receivedUnits = items.reduce((sum, line) => sum + line.qty, 0);
      setNotice({
        type: "ok",
        text: `${data.replayed ? "ตรวจพบรายการเดิม — " : ""}รับสินค้า ${receivedUnits} หน่วยแล้ว (${data.status})`,
      });
      replaceStockDraft({});
      stockReceiveRequestRef.current = null;
      await loadReceivableOrders(data.status === "PARTIAL" ? stockOrder.id : null);
      if (data.status === "RECEIVED") setStockOrder(null);
    } catch (e: any) {
      setNotice({ type: "error", text: `รับสินค้าไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setStockReceiving(false);
    }
  }

  async function loadLastReceiptFromServer() {
    if (!token) return;
    try {
      const res = await fetch("/api/pos/last-sale", { headers: authHeaders, cache: "no-store" });
      const data = await res.json().catch(() => ({ sale: null }));
      if (!res.ok) {
        setNotice({ type: "error", text: data?.error ?? `โหลดบิลล่าสุดไม่สำเร็จ (HTTP ${res.status})` });
        return;
      }
      if (!data?.sale) {
        setNotice({ type: "error", text: "ยังไม่มีบิลล่าสุดของเครื่องนี้ให้พิมพ์ซ้ำ" });
        return;
      }
      const serverReceipt: Receipt = {
        orderId: data.sale.orderId ?? null,
        docNo: data.sale.docNo ?? null,
        orderStatus: data.sale.orderStatus ?? null,
        lines: (data.sale.lines ?? []).map((line: any, idx: number) => ({
          orderItemId: Number(line.orderItemId ?? 0) || undefined,
          sku: String(line.sku ?? ""),
          productName: String(line.receiptName ?? ""),
          receiptName: String(line.receiptName ?? ""),
          size: String(line.size ?? ""),
          packCode: String(line.packCode ?? "BASE"),
          unitName: String(line.unitName ?? "ชิ้น"),
          baseQty: Number(line.baseQty ?? 1),
          packPrice: Number(line.packPrice ?? 0),
          basePrice: Number(line.basePrice ?? 0),
          priceTiers: line.priceTiers ?? [],
          serialTracked: line.serialTracked === true,
          promotion: line.promotion ?? null,
          available: 0,
          packQty: Number(line.packQty ?? 1),
          key: `last-${idx}-${String(line.sku ?? "")}`,
          returnedPackQty: Number(line.returnedPackQty ?? 0),
          refundablePackQty: Number(line.refundablePackQty ?? 0),
        })),
        total: Number(data.sale.total ?? 0),
        tendered: data.sale.cashTendered == null ? null : Number(data.sale.cashTendered),
        change: data.sale.cashChange == null ? null : Number(data.sale.cashChange),
        at: new Date(String(data.sale.soldAt ?? "")).toLocaleString("th-TH"),
        cashier: String(data.sale.cashierName ?? ""),
        storeName: data.sale.storeName ?? null,
        branchCode: data.sale.branchCode ?? null,
        posLabel: data.sale.posLabel ?? null,
        vatRegistered: Boolean(data.sale.vatRegistered),
        taxId: data.sale.taxId ?? session?.store?.taxId ?? null,
        vat: parseReceiptVat(data.sale.vat),
        roundingAmount: Number(data.sale.roundingAmount ?? 0),
        paymentLabel: Array.isArray(data.sale.payments) && data.sale.payments.length > 1
          ? "จ่ายหลายวิธี"
          : data.sale.paymentMethod ?? "ไม่ระบุ",
        paymentRef: data.sale.paymentRef ?? null,
        payments: Array.isArray(data.sale.payments)
          ? data.sale.payments.map((payment: any) => {
              const method = String(payment.method ?? "");
              return {
                method,
                label: METHODS.find((item) => item.key === method)?.label ?? method,
                amount: Number(payment.amount ?? 0),
                ref: payment.ref ?? null,
                tendered: payment.cashTendered == null ? null : Number(payment.cashTendered),
                change: payment.cashChange == null ? null : Number(payment.cashChange),
              };
            })
          : [],
        refunds: Array.isArray(data.sale.refunds) ? data.sale.refunds : [],
      };
      setReceipt(serverReceipt);
      window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(serverReceipt));
      setNotice({ type: "ok", text: "โหลดบิลล่าสุดแล้ว พร้อมพิมพ์ซ้ำ" });
    } catch (e: any) {
      setNotice({ type: "error", text: `โหลดบิลล่าสุดไม่สำเร็จ: ${String(e?.message ?? e)}` });
    }
  }

  async function loadRecentReceipts(query = recentSalesQuery) {
    if (!token) return;
    try {
      const params = new URLSearchParams({ limit: query.trim() ? "20" : "5" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/pos/recent-sales?${params.toString()}`, { headers: authHeaders, cache: "no-store" });
      const data = await res.json().catch(() => ({ sales: [] }));
      if (!res.ok) return;
      const sales = Array.isArray(data?.sales) ? data.sales : [];
      setRecentReceipts(
        sales.map((sale: any, saleIndex: number) => ({
          orderId: sale.orderId ?? null,
          docNo: sale.docNo ?? null,
          orderStatus: sale.orderStatus ?? null,
          voidedAt: sale.voidedAt ?? null,
          shiftId: sale.shiftId ?? null,
          lines: (sale.lines ?? []).map((line: any, idx: number) => ({
            orderItemId: Number(line.orderItemId ?? 0) || undefined,
            sku: String(line.sku ?? ""),
            productName: String(line.receiptName ?? ""),
            receiptName: String(line.receiptName ?? ""),
            size: String(line.size ?? ""),
            packCode: String(line.packCode ?? "BASE"),
            unitName: String(line.unitName ?? "ชิ้น"),
            baseQty: Number(line.baseQty ?? 1),
            packPrice: Number(line.packPrice ?? 0),
            basePrice: Number(line.basePrice ?? 0),
            available: 0,
            packQty: Number(line.packQty ?? 1),
            key: `recent-${saleIndex}-${idx}-${String(line.sku ?? "")}`,
            returnedPackQty: Number(line.returnedPackQty ?? 0),
            refundablePackQty: Number(line.refundablePackQty ?? 0),
          })),
          total: Number(sale.total ?? 0),
          tendered: sale.cashTendered == null ? null : Number(sale.cashTendered),
          change: sale.cashChange == null ? null : Number(sale.cashChange),
          at: new Date(String(sale.soldAt ?? "")).toLocaleString("th-TH"),
          cashier: String(sale.cashierName ?? ""),
          storeName: session?.location?.name ?? null,
          branchCode: session?.location?.branchCode ?? null,
          posLabel: session?.device.registeredPosNo ?? session?.device.code ?? null,
          vatRegistered: Boolean(session?.vat.registered),
          taxId: session?.store?.taxId ?? null,
          vat: parseReceiptVat(sale.vat),
          roundingAmount: Number(sale.roundingAmount ?? 0),
          paymentLabel:
            Array.isArray(sale.payments) && sale.payments.length > 1 ? "จ่ายหลายวิธี" : sale.paymentMethod ?? "ไม่ระบุ",
          paymentRef: sale.paymentRef ?? null,
          payments: Array.isArray(sale.payments)
            ? sale.payments.map((payment: any) => {
                const method = String(payment.method ?? "");
                return {
                  method,
                  label: METHODS.find((item) => item.key === method)?.label ?? method,
                  amount: Number(payment.amount ?? 0),
                  ref: payment.ref ?? null,
                  tendered: payment.cashTendered == null ? null : Number(payment.cashTendered),
                  change: payment.cashChange == null ? null : Number(payment.cashChange),
                };
              })
            : [],
          refunds: Array.isArray(sale.refunds) ? sale.refunds : [],
        }))
      );
    } catch {}
  }

  async function dispatchScan(code: string, source: ScanSource, size?: string | null) {
    const context = resolveScanContext({
      tab,
      lookupMode,
      blindReturnOpen: blindOpen,
      hasPendingSale: hasPendingOrderWrite,
      busy: busy || stockReceiving,
      blockingOverlayOpen: receiptModalOpen || enrollOpen || (source === "hid" && cameraModalOpen),
    });
    const trimmed = code.trim();
    if (!trimmed) return;
    if (context === "DISABLED") {
      setNotice({ type: "error", text: "พักการสแกนระหว่างทำรายการสำคัญ/เปิดหน้าต่างซ้อน กรุณาปิดให้เรียบร้อยก่อน" });
      return;
    }
    if (context === "RETURN_RECEIPT") {
      setRecentSalesQuery(trimmed);
      setRecentOpen(true);
      await loadRecentReceipts(trimmed);
      return;
    }
    if (context === "STOCK_RECEIVE") {
      await handleStockScan(trimmed);
      return;
    }
    const mode = context === "PRODUCT_LOOKUP" ? "lookup" : "sale";
    await handleScan(trimmed, size, mode, source === "manual");
  }
  scanHandlerRef.current = dispatchScan;

  useEffect(() => {
    const scanner = session?.device.scanner;
    const config = {
      ...DEFAULT_KEYBOARD_WEDGE_CONFIG,
      mode: scanner?.mode ?? "FOCUS",
      prefixKey: scanner?.prefixKey ?? "F9",
      suffixKey: scanner?.suffixKey ?? "Enter",
      maxGapMs: scanner?.maxGapMs ?? 80,
    };
    keyboardWedgeStateRef.current = IDLE_KEYBOARD_WEDGE_STATE;
    setHidCapturing(false);
    if (config.mode !== "PREFIX") return;

    function onScannerKey(event: KeyboardEvent) {
      const result = consumeKeyboardWedgeKey(
        keyboardWedgeStateRef.current,
        event,
        config,
        performance.now()
      );
      keyboardWedgeStateRef.current = result.state;
      setHidCapturing(result.state.phase !== "IDLE");
      if (result.capture) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (result.completedCode) enqueueScan(result.completedCode, "hid");
    }
    window.addEventListener("keydown", onScannerKey, true);
    return () => window.removeEventListener("keydown", onScannerKey, true);
  }, [
    enqueueScan,
    session?.device.scanner?.mode,
    session?.device.scanner?.prefixKey,
    session?.device.scanner?.suffixKey,
    session?.device.scanner?.maxGapMs,
  ]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      void loadRecentReceipts(recentSalesQuery);
    }, recentSalesQuery.trim() ? 160 : 0);
    return () => window.clearTimeout(timer);
  }, [recentSalesQuery, token]);

  useEffect(() => {
    if (!token) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/pos/search?q=${encodeURIComponent(q)}`, {
            headers: authHeaders,
            cache: "no-store",
          });
          const data = await res.json().catch(() => ({ items: [] }));
          if (cancelled) return;
          setSearchResults(Array.isArray(data?.items) ? data.items : []);
        } catch {
          if (!cancelled) setSearchResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm, token, authHeaders]);

  function resetToSimpleCash() {
    setSplitMode(false);
  }

  function focusLater<T extends HTMLElement>(ref: { current: T | null }) {
    window.requestAnimationFrame(() => {
      const field = ref.current;
      if (!field) return;
      field.setAttribute("aria-invalid", "true");
      field.focus();
    });
  }

  function clearInvalidField(event: { target: EventTarget }) {
    if (event.target instanceof HTMLElement) {
      event.target.removeAttribute("aria-invalid");
    }
  }

  function changeQty(key: string, delta: number) {
    if (hasPendingOrderWrite) return;
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, packQty: l.packQty + delta } : l))
        .filter((l) => l.packQty > 0)
    );
  }

  function updatePayment(id: string, patch: Partial<PaymentDraft>) {
    if (hasPendingOrderWrite) return;
    setPayments((cur) => cur.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)));
  }

  // จ่ายวิธีเดียวที่ไม่ใช่เงินสด: ยอดต้องเท่ายอดบิลเสมอ และยอดบิลขยับได้ตลอด
  // (ยิงของเพิ่ม/ปัดเศษเปลี่ยน) — ปล่อยให้ค้างค่าเก่าคือบิลโดน PAYMENT_MISMATCH
  useEffect(() => {
    if (payments.length !== 1) return;
    const only = payments[0];
    if (only.method === "CASH") return;
    const want = amountDue > 0 ? String(amountDue) : "";
    if (only.amount !== want) updatePayment(only.id, { amount: want });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountDue, payments]);

  function addPaymentRow() {
    if (hasPendingOrderWrite) return;
    // ออกจากฟอร์มย่อทันทีที่จะจ่ายผสม — ต้องเห็นยอดของแต่ละวิธี
    setSplitMode(true);
    setPayments((cur) =>
      cur.length === 1 && !cur[0].amount ? [{ ...cur[0], amount: String(amountDue) }] : cur
    );
    setPayments((cur) => [
      ...cur,
      { id: `pay-${Date.now()}-${cur.length + 1}`, method: "QR", amount: "", tendered: "", ref: "" },
    ]);
  }

  function removePaymentRow(id: string) {
    if (hasPendingOrderWrite) return;
    setPayments((cur) => {
      if (cur.length <= 1) return cur;
      const next = cur.filter((payment) => payment.id !== id);
      // ลบจนเหลือวิธีเดียว = เลิกจ่ายผสม แป้นเงินสดกลับมาเองถ้าเหลือเงินสด
      if (next.length === 1) setSplitMode(false);
      return next;
    });
  }

  function updateReturnDraft(orderId: string, orderItemId: number, qty: number, maxQty: number) {
    setReturnDrafts((cur) => ({
      ...cur,
      [orderId]: {
        ...(cur[orderId] ?? {}),
        [orderItemId]: Math.max(0, Math.min(maxQty, qty)),
      },
    }));
  }

  function getPartialRefundPreview(row: Receipt): number {
    const draft = row.orderId ? returnDrafts[row.orderId] ?? {} : {};
    const gross = row.lines.reduce((sum, line) => sum + line.packQty * line.packPrice, 0);
    const netRatio = gross > 0 ? Math.min(1, row.total / gross) : 0;
    return row.lines.reduce((sum, line) => {
      const qty = line.orderItemId ? Number(draft[line.orderItemId] ?? 0) : 0;
      const unit = line.packQty > 0 ? line.packPrice : 0;
      return sum + qty * unit * netRatio;
    }, 0);
  }

  function buildReturnNote(orderId: string): string | null {
    const reasonCode = (returnReasonCodes[orderId] ?? "").trim();
    const note = (returnNotes[orderId] ?? "").trim();
    if (!reasonCode || !note) return null;
    return `[${reasonCode}] ${note}`;
  }

  function returnIdempotencyKey(row: Receipt, mode: "FULL" | "PARTIAL", lines: Array<{ orderItemId: number; packQty: number }> = []) {
    const baseline = row.lines.map((line) => `${line.orderItemId ?? 0}:${line.returnedPackQty ?? 0}`).join(",");
    const payload = `${row.orderId}:${mode}:${baseline}:${lines.map((line) => `${line.orderItemId}:${line.packQty}`).join(",")}`;
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i += 1) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `pos-return-${row.orderId}-${mode}-${(hash >>> 0).toString(36)}`;
  }

  /** ประกอบใบเสร็จเป็นไบต์ ESC/POS จาก receipt ที่ค้างอยู่บนจอ */
  function receiptToEscPos(r: Receipt) {
    const lines: ReceiptLine[] = r.lines.map((l) => ({
      name: l.receiptName + (l.size && l.size !== "-" ? ` (${l.size})` : ""),
      qty: l.packQty,
      amount: l.packPrice * l.packQty,
    }));
    return buildReceipt({
      storeName: r.storeName ?? session?.location?.name ?? "",
      branchCode: r.branchCode ?? session?.location?.branchCode ?? null,
      taxId: r.taxId ?? session?.store?.taxId ?? null,
      posNo: session?.device.registeredPosNo ?? session?.device.code ?? null,
      vatIncluded: Boolean(session?.vat.registered),
      docTitle: session?.vat.registered ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน",
      docNo: r.docNo,
      at: r.at,
      cashier: r.cashier,
      lines,
      itemCount: r.lines.reduce((n, l) => n + l.packQty, 0),
      total: r.refundTotal ?? r.total,
      tendered: r.tendered,
      change: r.change,
      paymentLabel: null,
      // ใบรับคืน/ใบเตรียมเปลี่ยนไม่ใช่ใบกำกับของบิลนี้ — ยอด VAT ของบิลเดิมจะทำให้
      // เอกสารอ่านเหมือนเก็บ VAT ซ้ำ (ใบลดหนี้ออกแยกจาก taxDocuments.ts อยู่แล้ว)
      vat:
        r.receiptType && r.receiptType !== "sale"
          ? null
          : r.vat
            ? { ...r.vat, roundingAmount: Number(r.roundingAmount ?? r.vat.roundingAmount ?? 0) }
            : null,
      // ส่วนลด/แต้มพิมพ์เฉพาะใบขาย — ใบรับคืนมีใบลดหนี้ของตัวเองอยู่แล้ว
      discountLines: r.receiptType && r.receiptType !== "sale" ? null : (r.discountLines ?? null),
      member:
        (r.receiptType && r.receiptType !== "sale") || !r.memberNo
          ? null
          : {
              name: r.memberName ?? null,
              memberNo: r.memberNo ?? null,
              pointsEarned: r.pointsEarned ?? null,
              pointsBalance: r.pointsBalance ?? null,
            },
    });
  }

  /** พิมพ์จริง: ลอง ESC/POS ก่อน ถ้าไม่ได้ค่อยตกไป print dialog */
  async function printReceipt(openDrawer = true) {
    if (!receipt || !isWebUsbSupported() || !printerReady) {
      window.print();
      return;
    }
    try {
      await sendToPrinter(receiptToEscPos(receipt));
      if (openDrawer) await sendToPrinter(buildDrawerKick());
    } catch (e: any) {
      // เครื่องพิมพ์มีปัญหาไม่ควรทำให้ขายไม่ได้ — บอกแล้วเปิด dialog ให้แทน
      setNotice({ type: "error", text: `พิมพ์ผ่านเครื่องไม่สำเร็จ: ${String(e?.message ?? e)}` });
      window.print();
    }
  }

  // FOCUS mode ยังต้องมีช่องรับโดยตรง; PREFIX mode ไม่พึ่ง focus แต่คงพฤติกรรม
  // นี้ไว้ให้เครื่องเดิมและการพิมพ์รหัสด้วยมือ
  useEffect(() => {
    if (tab === "sell" && !receiptModalOpen) scanRef.current?.focus();
    if (tab === "stock" && !receiptModalOpen) stockScanRef.current?.focus();
  }, [tab, receiptModalOpen]);

  // แคชเชียร์คุมจอด้วยคีย์บอร์ดมือเดียว — Enter พิมพ์ / Esc ปิด
  // ดักแบบ capture เพราะช่องยิงบาร์โค้ดอาจยังโฟกัสค้างอยู่หลังบิล ถ้าปล่อยผ่าน
  // การยิงของชิ้นถัดไปตอน modal เปิดอยู่จะทั้งเพิ่มลงตะกร้าและสั่งพิมพ์พร้อมกัน
  useEffect(() => {
    if (!receiptModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") setReceiptModalOpen(false);
      else void printReceipt(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptModalOpen, receipt, printerReady]);

  // Esc ปิดกล่องสมัครสมาชิก — ทางเดียวคู่กับปุ่ม ✕ (แตะฉากหลังปิดไม่ได้โดยตั้งใจ:
  // จอทัชโดนขอบง่ายมาก และการปิดจะทิ้งเบอร์ที่พิมพ์ค้างไว้ทั้งหมด)
  // ดักแบบ capture เหมือนกล่องใบเสร็จ เพราะช่องยิงบาร์โค้ดอาจโฟกัสค้างอยู่
  useEffect(() => {
    if (!enrollOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setEnrollOpen(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enrollOpen]);

  // เปิด/ปิดกล้องตาม modal — เจอโค้ดแรกแล้วปิด modal + ยิงเข้า handleScan
  // เหมือนพิมพ์เอง ไม่มีทางพิเศษ ไม่งั้นราคา/สต็อกจะหลุด "server เป็นคนคิดเท่านั้น"
  useEffect(() => {
    if (!cameraModalOpen) return;
    let cancelled = false;
    let handle: { stop: () => void } | null = null;
    setCameraPreparing(needsDecoderDownload());
    (async () => {
      if (!cameraVideoRef.current) return;
      const h = await startCameraScan({
        video: cameraVideoRef.current,
        onDetect: (code) => {
          if (cancelled) return;
          cancelled = true; // กันเฟรมถัดไปยิงซ้ำก่อน modal จะปิดจริง
          setCameraModalOpen(false);
          enqueueScan(code, "camera");
        },
        onError: (message) => {
          if (!cancelled) setCameraError(message);
        },
      });
      if (!cancelled) setCameraPreparing(false);
      if (cancelled) h.stop();
      else handle = h;
    })();
    return () => {
      cancelled = true;
      handle?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraModalOpen]);

  /** เปิดลิ้นชักโดยไม่พิมพ์ซ้ำ — ใช้ตอนหยิบเงินทอนเพิ่มหลังปิดบิลไปแล้ว */
  async function openCashDrawer() {
    try {
      await sendToPrinter(buildDrawerKick());
    } catch (e: any) {
      setNotice({ type: "error", text: `เปิดลิ้นชักไม่สำเร็จ: ${String(e?.message ?? e)}` });
    }
  }

  async function setupPrinter() {
    try {
      const d = await requestPrinter();
      setPrinterReady(Boolean(d));
      if (d) setNotice({ type: "ok", text: `เชื่อมเครื่องพิมพ์แล้ว: ${d.productName ?? "USB printer"}` });
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    }
  }

  async function shiftAction(action: "open" | "close") {
    if (!cashierId || !pin || busy) return;
    if (action === "open" && !openingFloat.trim()) {
      setNotice({ type: "error", text: "ใส่เงินตั้งต้นในลิ้นชัก" });
      focusLater(openingFloatRef);
      return;
    }
    if (action === "close" && !countedCash.trim()) {
      setNotice({ type: "error", text: "ใส่จำนวนเงินที่นับได้" });
      focusLater(countedCashRef);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pos/shift", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          action,
          userId: cashierId,
          pin,
          openingFloat: action === "open" ? Number(openingFloat || 0) : undefined,
          countedCash: action === "close" ? Number(countedCash || 0) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({
          type: "error",
          text: data?.status === "PENDING_REFUNDS"
            ? `ยังปิดกะไม่ได้: มีรายการคืนเงินจริงค้าง ${data.count} รายการ รวม ฿${baht(Number(data.amount ?? 0))}`
            : data?.status === "PENDING_EXPENSES"
              ? `ยังปิดกะไม่ได้: มีเงินเบิกซื้อที่ยังไม่ปิดยอด ${data.count} รายการ รวม ฿${baht(Number(data.amount ?? 0))}`
            : data?.error ?? data?.reason ?? `HTTP ${res.status}`,
        });
      } else if (action === "close" && data.status === "CLOSED") {
        const v = data.shift?.cashVariance ?? 0;
        setNotice({
          type: v === 0 ? "ok" : "error",
          text: `ปิดกะแล้ว · ควรมี ฿${baht(data.shift.expectedCash)} นับได้ ฿${baht(data.shift.countedCash)} · ${
            v === 0 ? "ตรงพอดี" : v > 0 ? `เกิน ฿${baht(v)}` : `ขาด ฿${baht(Math.abs(v))}`
          }`,
        });
        setCountedCash("");
      } else {
        setNotice({ type: "ok", text: action === "open" ? "เปิดกะแล้ว" : "ปิดกะแล้ว" });
        setOpeningFloat("");
      }
      await loadSession();
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  async function refreshCartPricingBeforePay(options: { announce?: boolean } = {}): Promise<boolean> {
    const refreshed = await Promise.all(cart.map(async (line): Promise<CartLine> => {
      const params = new URLSearchParams({
        code: line.sku,
        size: line.size,
        packCode: line.packCode,
      });
      const res = await fetch(`/api/pos/scan?${params.toString()}`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `ตรวจราคาล่าสุดของ ${line.receiptName} ไม่สำเร็จ`);
      }
      const latest = data as ScanHit;
      return {
        ...line,
        ...latest,
        packQty: line.packQty,
        key: line.key,
        serials: line.serials,
      };
    }));

    const pricingChanged = refreshed.some(
      (line, index) => cartPricingSignature(line) !== cartPricingSignature(cart[index])
    );
    if (!pricingChanged) return false;

    setCart(refreshed);
    setMemberPreview(null);
    setMemberPreviewAppliedKey(null);
    setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
    resetToSimpleCash();
    if (options.announce !== false) {
      setNotice({
        type: "error",
        text: "ราคา ขั้นราคาส่ง หรือโปรโมชันมีการเปลี่ยนแปลง · อัปเดตยอดล่าสุดแล้ว กรุณาตรวจและรับเงินใหม่",
      });
    }
    return true;
  }

  async function pay() {
    if (!session?.shift || cart.length === 0 || !cashierId || !pin || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const savedAttempt = (() => {
        try { return JSON.parse(window.localStorage.getItem(PENDING_SALE_KEY) ?? "null"); } catch { return null; }
      })();
      // บิลใหม่ต้องอ่านราคา/ขั้นราคา/โปรล่าสุดก่อนรับเงิน ส่วนบิล recovery ต้องยิง
      // body+idempotency key เดิมเท่านั้นเพื่อถามผลของรายการเดิม ห้ามเปลี่ยนตะกร้ากลางทาง
      if (!savedAttempt?.body && await refreshCartPricingBeforePay()) return;
      // บิลค้างที่มีส่วนลดมือ: PIN ผู้อนุมัติไม่ได้ถูกเก็บไว้ (โดยตั้งใจ) ถ้ารีโหลดจอไป
      // แล้วต้องให้หัวหน้ากดอนุมัติใหม่ ไม่ใช่ปล่อยให้ยิงไปโดน 400 ที่อ่านไม่รู้เรื่อง
      if (savedAttempt?.body?.manualDiscount > 0 && !approvedDiscount) {
        setNotice({ type: "error", text: "บิลค้างใบนี้มีส่วนลดหน้าร้าน — ให้หัวหน้ากดอนุมัติใหม่ก่อนกดรับเงิน" });
        setDiscountOpen(true);
        return;
      }
      const body = savedAttempt?.body
        ? { ...savedAttempt.body, cashierUserId: cashierId, pin, discountApproverPin: approvedDiscount?.approverPin ?? null }
        : {
        shiftId: session.shift.id,
        cashierUserId: cashierId,
        pin,
        idempotencyKey: `${session.device.code}-${session.shift.id.slice(0, 8)}-${crypto.randomUUID()}`,
        // สมาชิก (7.96) — server ตรวจซ้ำว่า id นี้เป็นลูกค้าของร้านนี้ และล็อกยอดแต้มใน tx
        customerId: member?.customerId ?? null,
        pointsToRedeem: memberPreview?.pointsUsed ?? 0,
        couponCode: couponCode.trim() || null,
        // ส่วนลดมือ: server ตรวจ PIN + สิทธิ์ pos.discount.approve ซ้ำอีกชั้นเสมอ
        manualDiscount: approvedDiscount?.amount ?? 0,
        discountReason: approvedDiscount?.reason ?? null,
        discountApproverUserId: approvedDiscount?.approverId ?? null,
        discountApproverPin: approvedDiscount?.approverPin ?? null,
        lines: cart.map((line) => ({
          sku: line.sku,
          size: line.size,
          packQty: line.packQty,
          packCode: line.packCode,
          // เลขเครื่อง (8.3) — ส่งเฉพาะที่กรอกไว้ server บังคับความครบเอง
          serials: line.serials?.length ? line.serials : undefined,
        })),
        // ค่าบริการ/ค่าถุง (8.6) — ส่งเฉพาะแถวที่กรอกครบ
        extraLines: extraLines
          .map((x) => ({ label: x.label.trim(), unitAmount: Number(x.unitAmount) }))
          .filter((x) => x.label && Number.isFinite(x.unitAmount) && x.unitAmount > 0),
        payments: paymentSummary.normalized
          .filter((payment) => payment.numericAmount > 0)
          .map((payment) => ({
            method: payment.method,
            amount: payment.numericAmount,
            cashTendered: payment.method === "CASH" && payment.numericTendered > 0 ? payment.numericTendered : null,
            ref: payment.method !== "CASH" && payment.ref.trim() ? payment.ref.trim() : null,
          })),
      };
      // PIN ทั้งคนขายและผู้อนุมัติห้ามลง localStorage — เครื่องหน้าร้านเปิดค้างทั้งวัน
      // และ recovery record นี้อยู่ข้ามการรีโหลด
      window.localStorage.setItem(
        PENDING_SALE_KEY,
        JSON.stringify({ body: { ...body, pin: undefined, discountApproverPin: undefined }, cart, payments })
      );
      setHasPendingSale(true);
      const res = await fetch("/api/pos/sale", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // body ว่าง/ไม่ใช่ JSON = เซิร์ฟเวอร์ไม่ได้ตอบให้จบ (route โยน error, proxy ตัด
      // กลางทาง, container ตาย) · res.json() ตรง ๆ จะโยน "Unexpected end of JSON
      // input" ซึ่งอ่านแล้วเข้าใจผิดว่าเป็นเน็ตของร้านเอง
      const rawBody = await res.text();
      let data: any = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        data = null;
      }
      if (data == null) {
        // โยนต่อให้ catch ข้างล่างจัดการ: ไม่รู้ว่าบิลถูกสร้างหรือยัง → ต้องคงคีย์เดิมไว้
        throw new Error(`เซิร์ฟเวอร์ตอบกลับไม่ครบ (HTTP ${res.status})`);
      }
      if (res.ok && data.status === "SOLD") {
        const receiptPayments = paymentSummary.normalized
          .filter((payment) => payment.numericAmount > 0)
          .map((payment) => ({
            method: payment.method,
            label: METHODS.find((m) => m.key === payment.method)?.label ?? payment.method,
            amount: payment.numericAmount,
            ref: payment.method !== "CASH" && payment.ref.trim() ? payment.ref.trim() : null,
            tendered: payment.method === "CASH" && payment.numericTendered > 0 ? payment.numericTendered : null,
            change: payment.method === "CASH" ? payment.numericChange : null,
          }));
        // ยอดบนใบเสร็จต้องเป็นยอดที่ server บันทึกไว้ (รวมปัดเศษแล้ว) ไม่ใช่ยอดที่จอบวกเอง
        const soldTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : amountDue;
        const nextReceipt: Receipt = {
          orderId: data.orderId ?? null,
          docNo: data.docNo ?? null,
          lines: cart,
          total: soldTotal,
          tendered: data.cashTendered ?? null,
          change: data.cashChange ?? null,
          at: new Date().toLocaleString("th-TH"),
          cashier:
            session.cashiers.find((c) => c.id === cashierId)?.name ??
            session.cashiers.find((c) => c.id === cashierId)?.email ??
            "",
          storeName: session.location?.name ?? null,
          branchCode: session.location?.branchCode ?? null,
          posLabel: session.device.registeredPosNo ?? session.device.code,
          vatRegistered: session.vat.registered,
          taxId: session.store?.taxId ?? null,
          vat: parseReceiptVat(data.vat),
          roundingAmount: Number(data.roundingAmount ?? roundingDelta),
          paymentLabel: receiptPayments.length > 1 ? "จ่ายหลายวิธี" : receiptPayments[0]?.label ?? "ไม่ระบุ",
          paymentRef: receiptPayments.length === 1 ? receiptPayments[0]?.ref ?? null : null,
          payments: receiptPayments,
          refunds: [],
          memberName: member?.name ?? null,
          memberNo: member?.memberNo ?? null,
          pointsEarned: data.pointsEarned ?? null,
          pointsBalance: data.pointsBalance ?? null,
          discountLines: Array.isArray(data.discountLines) ? data.discountLines : [],
        };
        setReceipt(nextReceipt);
        setJustSold({
          docNo: data.docNo ?? null,
          change: data.cashChange ?? null,
          total: soldTotal,
        });
        window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(nextReceipt));
        setNotice({
          type: "ok",
          // จ่ายพอดีไม่ต้องประกาศว่าทอน 0 — บอกยอดที่รับไปแทน
          text: `ขายสำเร็จ${data.docNo ? ` · ใบเสร็จ ${data.docNo}` : ""}${
            data.cashChange != null && Number(data.cashChange) > 0
              ? ` · เงินทอน ฿${baht(Number(data.cashChange))}`
              : ` · รับ ฿${baht(soldTotal)}`
          }${data.replayed ? " (บิลเดิม ไม่ได้ขายซ้ำ)" : ""}`,
        });
        setCart([]);
        // สมาชิก/คูปองผูกกับบิล ไม่ใช่กับเครื่อง — ต้องล้างทุกบิล ไม่งั้นลูกค้า
        // คนถัดไปได้ส่วนลด/แต้มของคนก่อน
        clearBillCustomerState();
        window.localStorage.removeItem(PENDING_SALE_KEY);
        setHasPendingSale(false);
        setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
        // บิลถัดไปเริ่มที่ฟอร์มเงินสดง่ายเสมอ ไม่ค้างโหมดจ่ายผสมจากบิลก่อน
        resetToSimpleCash();
        setScanCode("");
        setSearchTerm("");
        setSearchResults([]);
        setRecentSalesQuery("");
        void loadRecentReceipts("");
      } else {
        // PAYMENT_FAILED = จ่ายไม่ผ่านแต่บิลอาจค้างอยู่ · SERVER_ERROR = ไม่รู้ผลเลย
        // สองอันนี้ห้ามล้างคีย์ ไม่งั้นกดขายใหม่แล้วได้บิลซ้ำแทนที่จะกู้บิลเดิม
        if (data?.status !== "PAYMENT_FAILED" && data?.status !== "SERVER_ERROR") {
          window.localStorage.removeItem(PENDING_SALE_KEY);
          setHasPendingSale(false);
        }
        let failureText = describeFailure(data);
        if (data?.status === "PAYMENT_MISMATCH") {
          // บิลถูกยกเลิกแล้ว ต้องทิ้งยอดรับเงินเดิมและ preview ส่วนลดเดิมทั้งหมด
          // ไม่เช่นนั้นกดซ้ำก็ส่งยอดเก่าแล้วชน mismatch วนซ้ำ
          setMemberPreview(null);
          setMemberPreviewAppliedKey(null);
          setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
          resetToSimpleCash();
          // recovery ต้องส่ง body เดิมก่อนเพื่อกันบิลซ้ำ จึง refresh ล่วงหน้าไม่ได้
          // เมื่อ server ยืนยันแล้วว่าบิลถูกยกเลิก ค่อยดึงกฎราคาล่าสุดให้ทันที
          // แคชเชียร์ไม่ควรต้องกดชำระอีกครั้งเพียงเพื่อให้ระบบรู้ว่าราคาค้าง
          try {
            const pricingUpdated = await refreshCartPricingBeforePay({ announce: false });
            if (pricingUpdated) {
              failureText += " · อัปเดตราคาในตะกร้าเป็นยอดล่าสุดแล้ว กรุณาตรวจและรับเงินใหม่";
            }
          } catch (refreshError: any) {
            failureText += ` · ตรวจราคาล่าสุดอัตโนมัติไม่สำเร็จ (${String(refreshError?.message ?? refreshError)})`;
          }
        }
        setNotice({ type: "error", text: failureText });
      }
    } catch (e: any) {
      // เน็ตหลุดกลางคำขอ: บิลอาจสร้างไปแล้ว → ห้ามให้พนักงานกดขายใหม่ทันที
      setNotice({
        type: "error",
        text: `ส่งไม่สำเร็จ (${String(e?.message ?? e)}) — กดชำระเงินอีกครั้ง ระบบจะใช้คีย์เดิมและไม่สร้างบิลซ้ำ`,
      });
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  async function returnReceipt(orderId: string) {
    if (!cashierId || !pin || busy) return;
    const note = buildReturnNote(orderId);
    if (!note) {
      setNotice({ type: "error", text: "กรุณาเลือกประเภทเหตุผลและระบุรายละเอียดก่อนคืนบิล" });
      return;
    }
    const matched = recentReceipts.find((row) => row.orderId === orderId);
    if (!matched) return;
    if (!window.confirm("ยืนยันคืนสินค้าที่เหลือทั้งบิล? เงินสดจะถือว่าคืนแล้ว ส่วนบัตร/QR/วอลเล็ทต้องยืนยัน settlement อีกครั้ง")) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/pos/return", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          mode: "FULL",
          orderId,
          cashierUserId: cashierId,
          pin,
          note,
          approvalUserId,
          approvalPin,
          idempotencyKey: returnIdempotencyKey(matched, "FULL"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "RETURNED") {
        setNotice({
          type: "ok",
          text: data.settlementStatus === "COMPLETED"
            ? `รับคืนและคืนเงินจริงครบแล้ว · ยอด ฿${baht(Number(data.refundAmount ?? 0))}`
            : `รับคืนสินค้าแล้ว · ยอด ฿${baht(Number(data.refundAmount ?? 0))} · ยังมีช่องทางที่ต้องยืนยันคืนเงินจริง`,
        });
        if (matched) {
          const returnReceipt: Receipt = {
            ...matched,
            receiptType: "return",
            returnReason: note,
            refundTotal: Number(data.refundAmount ?? matched.total),
            refunds: Array.isArray(data.refunds) ? data.refunds : matched.refunds,
          };
          setReceipt(returnReceipt);
          window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(returnReceipt));
        }
        if (receipt?.orderId === orderId) setReceipt(null);
        setReturnNotes((cur) => ({ ...cur, [orderId]: "" }));
        setReturnReasonCodes((cur) => ({ ...cur, [orderId]: "" }));
        setReturnPanelOrderId(null);
        void loadRecentReceipts(recentSalesQuery);
        return;
      }
      const message =
        data?.status === "APPROVAL_REQUIRED" ? `${data.reason} — ระบุผู้อนุมัติและ PIN ผู้อนุมัติด้านบน`
        :
        data?.status === "INVALID_ORDER_STATUS" ? `คืนบิลไม่ได้: สถานะปัจจุบันคือ ${data.current}`
        : data?.status === "NO_CONFIRMED_PAYMENTS" ? "คืนบิลไม่ได้: ไม่พบ payment ที่ยืนยันแล้ว"
        : data?.error ?? `คืนบิลไม่สำเร็จ (${data?.status ?? `HTTP ${res.status}`})`;
      setNotice({ type: "error", text: message });
    } catch (e: any) {
      setNotice({ type: "error", text: `คืนบิลไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function partialReturnReceipt(row: Receipt) {
    if (!cashierId || !pin || busy || !row.orderId) return;
    const note = buildReturnNote(row.orderId);
    if (!note) {
      setNotice({ type: "error", text: "กรุณาเลือกประเภทเหตุผลและระบุรายละเอียดก่อนคืนรายการ" });
      return;
    }
    const draft = returnDrafts[row.orderId] ?? {};
    const lines = row.lines
      .filter((line) => line.orderItemId && Number(draft[line.orderItemId] ?? 0) > 0)
      .map((line) => ({ orderItemId: line.orderItemId!, packQty: Number(draft[line.orderItemId!] ?? 0) }));
    if (lines.length === 0) {
      setNotice({ type: "error", text: "ยังไม่ได้เลือกรายการที่จะคืน" });
      return;
    }
    if (!window.confirm(`ยืนยันคืนบางรายการ? ระบบจะคืนสต็อกตามจำนวนที่เลือก และบันทึกยอดคืนเงินตามบิลเดิม`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/pos/return", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          mode: "PARTIAL",
          orderId: row.orderId,
          cashierUserId: cashierId,
          pin,
          lines,
          note,
          approvalUserId,
          approvalPin,
          idempotencyKey: returnIdempotencyKey(row, "PARTIAL", lines),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "PARTIAL_RETURNED") {
        setNotice({
          type: "ok",
          text: data.settlementStatus === "COMPLETED"
            ? `คืนบางรายการและคืนเงินจริงครบแล้ว · ฿${baht(Number(data.refundAmount ?? 0))}`
            : `รับคืนบางรายการแล้ว · ฿${baht(Number(data.refundAmount ?? 0))} · ยังมีช่องทางที่ต้องยืนยันคืนเงินจริง`,
        });
        const returnedIds = new Set((data.returnedItems ?? []).map((item: any) => Number(item.orderItemId)));
        const returnReceipt: Receipt = {
          ...row,
          receiptType: "return",
          returnReason: note,
          refundTotal: Number(data.refundAmount ?? 0),
          lines: row.lines
            .filter((line) => line.orderItemId && returnedIds.has(Number(line.orderItemId)))
            .map((line) => ({
              ...line,
              packQty: Number((data.returnedItems ?? []).find((item: any) => Number(item.orderItemId) === Number(line.orderItemId))?.packQty ?? 0),
            })),
          refunds: Array.isArray(data.refunds) ? data.refunds : row.refunds,
        };
        setReceipt(returnReceipt);
        window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(returnReceipt));
        setReturnDrafts((cur) => ({ ...cur, [row.orderId!]: {} }));
        setReturnNotes((cur) => ({ ...cur, [row.orderId!]: "" }));
        setReturnReasonCodes((cur) => ({ ...cur, [row.orderId!]: "" }));
        setReturnPanelOrderId(null);
        void loadRecentReceipts(recentSalesQuery);
        return;
      }
      const message =
        data?.status === "APPROVAL_REQUIRED" ? `${data.reason} — ระบุผู้อนุมัติและ PIN ผู้อนุมัติด้านบน`
        :
        data?.status === "RETURN_QTY_EXCEEDED" ? "จำนวนที่คืนเกินกว่าที่ยังคืนได้"
        : data?.status === "ITEM_NOT_FOUND" ? "ไม่พบรายการสินค้าที่ต้องการคืน"
        : data?.status === "INVALID_ORDER_STATUS" ? `คืนบางรายการไม่ได้: สถานะปัจจุบันคือ ${data.current}`
        : data?.error ?? `คืนบางรายการไม่สำเร็จ (${data?.status ?? `HTTP ${res.status}`})`;
      setNotice({ type: "error", text: message });
    } catch (e: any) {
      setNotice({ type: "error", text: `คืนบางรายการไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function completeRefundSettlement(row: Receipt, allocation: NonNullable<Receipt["refunds"]>[number]) {
    if (busy) return;
    const approverId = approvalUserId || cashierId;
    const approverPin = approvalUserId ? approvalPin : pin;
    if (!approverId || !approverPin) {
      setNotice({ type: "error", text: "กรุณาระบุผู้มีสิทธิ์คืนเงินและ PIN" });
      return;
    }
    const externalRef = (settlementRefs[allocation.id] ?? "").trim();
    if (allocation.method !== "CASH" && !externalRef) {
      setNotice({ type: "error", text: "กรุณากรอกเลขอ้างอิงจากธนาคาร/เครื่องบัตร/วอลเล็ทก่อนยืนยัน" });
      return;
    }
    if (!window.confirm(`ยืนยันว่าคืนเงินจริง ฿${baht(allocation.amount)} ผ่าน ${allocation.method} สำเร็จแล้ว?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/pos/refund-settlement", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          allocationId: allocation.id,
          userId: approverId,
          pin: approverPin,
          externalRef,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.status === "APPROVAL_REQUIRED"
          ? "ผู้ยืนยันไม่มีสิทธิ์ payment.refund"
          : data?.status === "REFERENCE_REQUIRED"
            ? "ต้องมีเลขอ้างอิงการคืนเงินจริง"
            : data?.error ?? `ยืนยันคืนเงินไม่สำเร็จ (HTTP ${res.status})`;
        setNotice({ type: "error", text: message });
        return;
      }
      setNotice({ type: "ok", text: `ยืนยันคืนเงินจริง ฿${baht(allocation.amount)} สำเร็จแล้ว` });
      setSettlementRefs((cur) => ({ ...cur, [allocation.id]: "" }));
      await loadRecentReceipts(recentSalesQuery);
      if (receipt?.orderId === row.orderId) await loadLastReceiptFromServer();
    } catch (e: any) {
      setNotice({ type: "error", text: `ยืนยันคืนเงินไม่สำเร็จ: ${String(e?.message ?? e)}` });
    } finally {
      setBusy(false);
    }
  }

  function startExchangeFromReceipt(row: Receipt) {
    const nextCart = row.lines
      .filter((line) => (line.refundablePackQty ?? line.packQty) > 0)
      .map((line, idx) => ({
        sku: line.sku,
        productName: line.productName,
        receiptName: line.receiptName,
        size: line.size,
        packCode: line.packCode,
        unitName: line.unitName,
        baseQty: line.baseQty,
        packPrice: line.packPrice,
        basePrice: line.basePrice,
        available: 0,
        packQty: Math.max(1, line.refundablePackQty ?? line.packQty),
        key: `exchange-${row.orderId ?? "receipt"}-${idx}-${line.sku}`,
      }));
    setCart(nextCart);
    setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
    // ยกสมาชิกของบิลเดิมมาที่บิลใหม่ (7.96) — ลูกค้าคนเดิมยืนอยู่ตรงหน้า ถ้าไม่ยกมา
    // พนักงานต้องค้นซ้ำและมักลืม แล้วลูกค้าเสียส่วนลด/แต้มของการเปลี่ยนสินค้า
    // ดึงข้อมูลสดใหม่แทนที่จะใช้ค่าบนใบเสร็จ เพราะแต้ม/ชั้นเปลี่ยนไปแล้วได้
    clearMember();
    if (row.memberNo) {
      void (async () => {
        try {
          const res = await fetch(`/api/pos/member?q=${encodeURIComponent(row.memberNo!)}`, {
            headers: authHeaders, cache: "no-store",
          });
          const data = await res.json();
          const hit = (Array.isArray(data.members) ? data.members : [])
            .find((m: PosMember) => m.memberNo === row.memberNo);
          if (hit) setMember(hit);
        } catch { /* ยกสมาชิกไม่สำเร็จต้องไม่ขัดการเปลี่ยนสินค้า — ค้นเองได้ */ }
      })();
    }
    // งานย้ายไปที่ตะกร้าแล้ว — ปล่อยฟอร์มคืนกางค้างไว้จะบังบิลอื่นเปล่า ๆ
    setReturnPanelOrderId(null);
    setReceipt({
      ...row,
      receiptType: "exchange",
      returnReason: null,
      refundTotal: null,
    });
    setNotice({ type: "ok", text: "ดึงรายการเดิมมาเป็นบิลใหม่แล้ว — ปรับจำนวน/สแกนสินค้าใหม่ต่อได้เลย" });
    scanRef.current?.focus();
  }

  if (!token || tokenRejected) {
    return (
      <div style={{ maxWidth: 460, margin: "0 auto", padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>ตั้งค่าเครื่องขาย</h1>
        <div style={{ background: "#e6f4ff", color: "#003a8c", padding: 12, borderRadius: 8, margin: "12px 0", fontSize: 14 }}>
          <b>ผู้จัดการทำครั้งเดียวตอนตั้งเครื่อง</b> — เหมือนต่อ Wi-Fi ให้แท็บเล็ต
          <br />
          พนักงานขาย <b>ไม่ต้องใช้ลิงก์หรือ token นี้เลย</b> เปิดเครื่องมาก็เลือกชื่อตัวเองแล้วใส่ PIN ได้ทันที
        </div>
        {tokenRejected && (
          <div style={{ background: "#fdecea", color: "#611a15", padding: 12, borderRadius: 8, margin: "12px 0" }}>
            <div style={{ fontWeight: 500 }}>ระบบไม่รับ token ของเครื่องนี้</div>
            <div style={{ marginTop: 4 }}>
              สาเหตุที่พบบ่อยที่สุดคือมีการกด &quot;ออก token&quot; ใหม่ให้เครื่องนี้ระหว่างที่จอขายเปิดอยู่ —
              ตัวเก่าจะใช้ไม่ได้ทันที
            </div>
            {token && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                เครื่องยังจำ token เดิมไว้ (ลงท้าย …{token.slice(-6)})
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {token && (
                <button
                  onClick={() => { setTokenRejected(false); void loadSession(); }}
                  style={{ padding: "8px 16px" }}
                >
                  ลองใหม่ด้วย token เดิม
                </button>
              )}
              <a href="/admin/pos-devices" style={{ padding: "8px 16px" }}>ไปออก token ใหม่</a>
            </div>
          </div>
        )}
        <p style={{ color: "#666", fontSize: 14 }}>
          {tokenRejected
            ? "ถ้าออก token ใหม่มาแล้ว วางลิงก์หรือ token ตัวใหม่ที่นี่"
            : "ใส่ token ที่ออกจากหน้าแอดมิน (ออกให้ครั้งเดียว ถ้าหายต้องออกใหม่)"}
        </p>
        <input
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="pos_... หรือวางลิงก์จับคู่ทั้งลิงก์"
          style={{ width: "100%", padding: 12, fontSize: 16, marginTop: 12 }}
        />
        <button
          disabled={!tokenInput.trim()}
          onClick={() => {
            // ก๊อปมาทั้งลิงก์ก็รับ — ดึงเฉพาะค่า token ออกมาให้เอง
            const raw = tokenInput.trim();
            let t = raw;
            const m = raw.match(/[?&](?:t|token)=([^&\s]+)/);
            if (m) t = decodeURIComponent(m[1]);
            else if (raw.includes("/")) t = raw.split("/").pop() ?? raw;
            window.localStorage.setItem(TOKEN_KEY, t);
            setToken(t);
            setTokenRejected(false);
            setSessionError("");
          }}
          style={{ width: "100%", padding: 14, fontSize: 16, marginTop: 12 }}
        >
          จับคู่
        </button>
        <p style={{ color: "#888", fontSize: 12, marginTop: 16 }}>
          เครื่องนี้จะจำ token ไว้จนกว่าจะกดเลิกจับคู่ — ไม่ต้องใส่ใหม่ทุกวัน
        </p>
      </div>
    );
  }

  // height/overflow อยู่ใน CSS ด้านล่าง ไม่ใช่ inline — inline ชนะ media query เสมอ
  // และต้องประกาศ 100vh ก่อน 100dvh เพื่อให้เบราว์เซอร์เก่าที่ไม่รู้จัก dvh ตกมาใช้ vh
  return (
    <div
      className="pos-page"
      style={{ display: "flex" }}
      onInputCapture={clearInvalidField}
      onChangeCapture={clearInvalidField}
    >
      <style>{`
        .pos-page, .pos-page * { box-sizing: border-box; }
        /* 100vh บนมือถือ = ความสูงตอนแถบ URL ยุบ ไม่หดตามตอนแถบโผล่ → ท้ายหน้า
           (แถบงานด้านล่าง) ถูกดันต่ำกว่าพื้นที่ที่มองเห็นจนตัวหนังสือโดนตัด
           dvh หดตามจริง จึงเป็นค่าที่ถูกสำหรับ app-shell ที่มีแถบติดขอบล่าง */
        .pos-page { height: 100vh; height: 100dvh; overflow: hidden; }
        /* หน้าไม่เลื่อนทั้งหน้า — ให้แต่ละคอลัมน์เลื่อนของตัวเอง ปุ่มชำระเงิน
           จึงอยู่ที่เดิมเสมอแม้ตะกร้าจะยาว */
        .pos-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden; }
        .pos-rail { width: 68px; flex: none; display: flex; flex-direction: column; gap: 4px; padding: 10px 6px;
                    background: #fff; border-right: 1px solid var(--pos-line, #eee); }
        .pos-rail button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
                           height: 56px; width: 100%; border-radius: 10px; font-size: 11px; white-space: nowrap;
                           border: 1px solid transparent; background: transparent; color: #555; cursor: pointer; }
        .pos-rail button[aria-current="true"] { background: #e8f0fe; color: #14509a; border-color: #b5d4f4; font-weight: 500; }
        /* ไอคอนเป็น SVG แล้ว — font-size คุมขนาดไม่ได้ ต้องกำหนดที่ตัว svg เอง
           display:block กัน baseline gap ที่ทำให้ไอคอนกับ label ห่างไม่เท่ากันทุกแท็บ */
        .pos-rail .pos-rail-icon { line-height: 1; display: flex; }
        .pos-rail .pos-rail-icon svg { width: 19px; height: 19px; display: block; }
        .pos-pane { flex: 1; min-height: 0; overflow-y: auto; }
        @media (max-width: 767px) {
          /* คงโครง app-shell เหมือนจอใหญ่ (height/overflow ตั้งไว้แล้วด้านบน) —
             สลับแค่ทิศ: แถบงานลงไปอยู่ล่างให้นิ้วโป้งถึง */
          .pos-page { flex-direction: column-reverse; }
          /* มือถือเลื่อนทีเดียวจบทั้งก้อน (หัวร้าน + ตะกร้า + ช่องจ่ายเงิน) เหลือแถบงาน
             ตรึงล่างสุดอย่างเดียว — บนจอแคบสองคอลัมน์จะวางซ้อนกัน ถ้าให้แต่ละคอลัมน์
             เลื่อนในตัวเองจะได้แถบเลื่อนซ้อนสองอันในจอเดียว ซึ่งหาของยากกว่ามาก
             และหัวร้าน/ช่อง PIN ที่ตรึงไว้ก็กินความสูงที่มีน้อยอยู่แล้วไปเปล่า ๆ */
          .pos-body { overflow-y: auto; -webkit-overflow-scrolling: touch; }
          /* จอเล็ก = แท็บเล็ต/มือถือ ย้ายแถบไปล่างให้นิ้วโป้งถึง
             ต้องเผื่อ safe-area: บนมือถือจริงแถบระบบ/ปุ่มย้อนกลับทับพื้นที่ล่างของ
             viewport อยู่ ถ้าชิด bottom:0 เฉย ๆ ตัวหนังสือใต้ไอคอนจะโดนกินหายไปครึ่ง */
          .pos-rail { width: 100%; flex-direction: row; border-right: none; border-top: 1px solid var(--pos-line, #eee);
                      position: sticky; bottom: 0; z-index: 20;
                      padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
          /* ปล่อยให้สูงตามเนื้อหา — ความสูงตายตัว 56px เหลือที่ให้บรรทัดล่างแค่ 2px
             ซึ่งไม่พอสำหรับสระ/วรรณยุกต์ไทย (เช่น "ตั้งค่า") */
          .pos-rail button { flex: 1; height: auto; min-height: 52px; padding: 6px 2px; }
          .pos-header { align-items: flex-start !important; flex-direction: column; }
          .pos-header-actions { width: 100%; flex-wrap: wrap; }
          .pos-header-actions select { flex: 1 1 160px; min-width: 0 !important; }
          /* !important เพราะ grid นี้ตั้ง flex/gridTemplateColumns เป็น inline style
             ซึ่งชนะ stylesheet ตามปกติ · flex:none ให้สูงตามเนื้อหา ไม่ยัดลงพื้นที่ที่เหลือ */
          .pos-main-grid { grid-template-columns: minmax(0, 1fr) !important; flex: none !important; }
          /* คอลัมน์ไม่เลื่อนเองแล้ว — ปล่อยให้ยาวไปตามเนื้อหา แล้วให้ .pos-body เลื่อนทีเดียว */
          .pos-pane { overflow: visible; }
          .pos-payment-row, .pos-refund-row { grid-template-columns: minmax(0, 1fr) !important; }
          .pos-payment-row > *, .pos-refund-row > * { width: 100%; min-width: 0 !important; }
        }
      `}</style>

      <nav className="pos-rail" aria-label="งานในจอขาย">
        {POS_TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key}
            title={item.label}
          >
            <span className="pos-rail-icon" aria-hidden="true"><PosTabIcon tab={item.key} /></span>
            <span>{item.label}</span>
            {item.key === "returns" && shiftReturnSummary.count > 0 && (
              <span style={{ fontSize: 10, color: "#8a6100" }}>{shiftReturnSummary.count}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="pos-body">
      <header className="pos-card pos-topbar">
        <div className="pos-shop">
          <div className="pos-shop-mark">
            {(session?.location?.name ?? "?").trim().charAt(0) || "?"}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="pos-shop-name">
              {loadingSession && !session ? "กำลังเชื่อมต่อ…" : session?.location?.name ?? "ยังไม่ทราบสาขา"}
            </div>
            <div className="pos-chips">
              {session?.location && <span className="pos-chip">สาขา {session.location.branchCode}</span>}
              {session && <span className="pos-chip">{session.device.code}</span>}
              {session && (
                <span className={`pos-chip${currentScanContext === "DISABLED" ? "" : " pos-chip--ok"}`}>
                  Scanner: {hidCapturing ? "กำลังรับข้อมูล…" : SCAN_CONTEXT_LABEL_TH[currentScanContext]}
                  {session.device.scanner.mode === "PREFIX" ? ` · ${session.device.scanner.prefixKey}` : " · ตาม Focus"}
                </span>
              )}
              {session?.device.registeredPosNo && (
                <span className="pos-chip">POS#{session.device.registeredPosNo}</span>
              )}
              {session?.shift ? (
                <span className="pos-chip pos-chip--ok">กะเปิดอยู่</span>
              ) : (
                <span className="pos-chip pos-chip--warn">ยังไม่เปิดกะ</span>
              )}
            </div>
          </div>
        </div>

        {/* ผู้ขาย + PIN ต้องอยู่ตรงนี้ ติดจอตลอด ห้ามอยู่ในบล็อกที่ซ่อนตัวเองตาม
            สถานะ: canSell เป็นจริงทันทีที่ pin มีตัวอักษรตัวแรก ถ้าช่องอยู่ในบล็อก
            แบบนั้น มันจะหายไปตั้งแต่พิมพ์ตัวแรก โฟกัสหลุด แล้ว PIN ที่ส่งไปเหลือ
            ตัวเดียว → server ตอบ "PIN ไม่ถูกต้อง" ทั้งที่พนักงานพิมพ์ถูก */}
        <div className="pos-header-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={cashierId}
            onChange={(e) => { setCashierId(e.target.value); setPin(""); }}
            /* 16px ไม่ใช่ 13px — iOS Safari ซูมหน้าจอเข้าเองตอนโฟกัสช่องที่ฟอนต์เล็กกว่า
               16px แล้วเลย์เอาต์เพี้ยนทั้งหน้า · ลดขนาดที่ความสูงแทน (44px = เป้ากดขั้นต่ำ)
               flex:1 + minWidth:0 ให้ชื่อยาวตัดด้วย … แทนที่จะดันช่อง PIN ตกบรรทัด */
            style={{ flex: 1, minWidth: 0, height: 44, fontSize: 16, padding: "0 10px" }}
            aria-label="ผู้ขาย"
          >
            <option value="">เลือกผู้ขาย</option>
            {(session?.cashiers ?? []).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.hasPin}>
                {c.name || c.email}
                {c.isPharmacist ? " (ภก.)" : ""}
                {c.hasPin ? "" : " — ยังไม่ตั้ง PIN"}
              </option>
            ))}
          </select>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => { if (tab === "shift") void refreshExpenses(); }}
            maxLength={8}
            placeholder="PIN"
            aria-label="PIN ของผู้ขาย"
            /* 78px พอสำหรับ 4 หลัก · fontSize 16 บังคับด้วยเหตุผลเดียวกับ select ด้านบน */
            style={{ width: 78, flex: "none", height: 44, fontSize: 16, padding: "0 10px", textAlign: "center" }}
          />
          {receipt && (
            <button onClick={() => void printReceipt(false)} style={{ padding: "8px 12px", fontSize: 12 }}>
              พิมพ์บิลล่าสุด
            </button>
          )}
        </div>
      </header>

      {sessionError && !tokenRejected && (
        <div style={{ background: "#fdecea", color: "#611a15", padding: 12, borderRadius: 8 }}>
          เชื่อมต่อไม่ได้: {sessionError} — ตรวจอินเทอร์เน็ตแล้วลอง{" "}
          <button onClick={() => void loadSession()} style={{ padding: "2px 10px" }}>เชื่อมต่อใหม่</button>
        </div>
      )}

      {/* บอกให้ชัดว่าขาดอะไรถึงยังขายไม่ได้ — เดิมจอเงียบ คนหน้าร้านเดาเองไม่ถูก
          ช่องเลือกผู้ขาย/PIN อยู่ในนี้เลย เพราะรีเฟรชหน้าทีไร PIN หายจากหน่วยความจำ
          ถ้าให้ไปหาในแท็บตั้งค่าคือเพิ่มคลิกให้กับสิ่งที่ต้องทำบ่อยที่สุดหลังรีเฟรช */}
      {session && !canSell && (
        <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>ยังขายไม่ได้ — เหลืออีก:</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.9 }}>
            {!anyCashierHasPin && (
              <li>
                ยังไม่มีพนักงานคนไหนตั้ง PIN — ตั้งที่{" "}
                <a href="/admin/pos-devices">แอดมิน → เครื่องขาย + PIN</a>
              </li>
            )}
            {anyCashierHasPin && (!cashierId || !pin) && <li>เลือกผู้ขายและใส่ PIN ที่แถบด้านบน</li>}
            {!session.shift && (
              <li>
                เปิดกะ พร้อมระบุเงินตั้งต้นในลิ้นชัก —{" "}
                <button onClick={() => setTab("shift")} style={{ padding: "2px 10px", fontSize: 13 }}>ไปที่แท็บกะ</button>
              </li>
            )}
          </ol>
        </div>
      )}
      {notice && (
        <div className={`pos-note ${notice.type === "ok" ? "pos-note--ok" : "pos-note--err"}`}>
          {notice.text}
        </div>
      )}
      {hasPendingOrderWrite && (
        <div style={{ background: "#fff7e6", color: "#874d00", padding: 12, borderRadius: 8, border: "1px solid #ffd591" }}>
          ล็อกรายการไว้เพื่อกู้รายการเดิม กรุณากด {hasPendingDepositSale ? "“สร้างบิล + รับมัดจำ”" : "“ชำระเงิน”"} ซ้ำ
          ระบบจะตรวจคีย์เดิมก่อนและไม่สร้างบิลหรือรับเงินซ้ำ
        </div>
      )}
      <div className="pos-main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 10, flex: 1, minHeight: 0 }}>
      <section className="pos-card pos-pane">
      {tab === "returns" && (<>
      <div style={{ fontSize: 13 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500 }}>คืนสินค้า</span>
          {session?.shift && (
            <span style={{ color: "#666" }}>
              กะนี้คืนแล้ว {shiftReturnSummary.count} บิล · ฿{baht(shiftReturnSummary.total)}
            </span>
          )}
          <button
            onClick={() => setReturnPanelOpen((v) => !v)}
            style={{ padding: "4px 12px", fontSize: 13, marginLeft: "auto" }}
          >
            {returnPanelOpen ? "▾" : "▸"} ผู้อนุมัติ
          </button>
          {approvalUserId && approvalPin && !returnPanelOpen && (
            <span style={{ color: "#237804" }}>ตั้งผู้อนุมัติไว้แล้ว</span>
          )}
        </div>

        {/* คืนไม่มีใบเสร็จ (8.2) — ยุบไว้เสมอ เพราะทางปกติคือค้นบิลเดิมให้เจอ
            ทางนี้คือทางออกสุดท้ายเมื่อใบเสร็จหายจริง และเป็นช่องจ่ายเงินออกที่
            เสี่ยงที่สุด จึงไม่ควรอยู่ในระยะที่กดพลาดได้ */}
        <div style={{ marginTop: 10, borderTop: "1px solid var(--pos-line)", paddingTop: 10 }}>
          {!blindOpen ? (
            <button
              type="button"
              className="pos-btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setBlindOpen(true)}
            >
              + คืนโดยไม่มีใบเสร็จ (ต้องมีหัวหน้าอนุมัติ)
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#8a6100" }}>
                ยิงของที่ลูกค้าเอามาคืนได้จากหน้านี้ หรือใส่ตะกร้าที่แท็บขายแล้วกลับมายืนยัน ·
                คืนตามราคาป้ายวันนี้ ({cart.length} รายการในตะกร้า) · จ่ายเป็นเงินสดจากลิ้นชัก ·
                ไม่มีใบกำกับต้นทางให้อ้าง จึงออกใบลดหนี้ไม่ได้
              </div>
              <input
                value={blindReason}
                onChange={(e) => setBlindReason(e.target.value)}
                maxLength={300}
                placeholder="เหตุผล เช่น ใบเสร็จหาย ของอยู่ในสภาพเดิม ซื้อเมื่อวาน"
                style={{ padding: 9, fontSize: 13 }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={blindApproverId}
                  onChange={(e) => setBlindApproverId(e.target.value)}
                  style={{ padding: 9, fontSize: 13, minWidth: 170 }}
                >
                  <option value="">— ผู้อนุมัติ —</option>
                  {(session?.cashiers ?? []).filter((c) => c.hasPin).map((c) => (
                    <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                  ))}
                </select>
                <input
                  type="password"
                  inputMode="numeric"
                  value={blindApproverPin}
                  onChange={(e) => setBlindApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="PIN หัวหน้า"
                  style={{ padding: 9, fontSize: 13, width: 120 }}
                />
                <button onClick={() => void doBlindReturn()} disabled={busy || cart.length === 0}
                        style={{ padding: "9px 16px", fontSize: 13 }}>
                  ยืนยันคืน + จ่ายเงินสด
                </button>
                <button type="button" className="pos-btn-ghost" onClick={() => { setBlindOpen(false); setBlindApproverPin(""); }}>
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>

        {returnPanelOpen && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <span style={{ color: "#666" }}>ผู้อนุมัติ (ใช้เมื่อระบบร้องขอ):</span>
            <select
              value={approvalUserId}
              onChange={(e) => setApprovalUserId(e.target.value)}
              style={{ padding: 8, fontSize: 13, minWidth: 160 }}
            >
              <option value="">เลือกผู้อนุมัติ</option>
              {(session?.cashiers ?? []).map((c) => (
                <option key={`approval-${c.id}`} value={c.id} disabled={!c.hasPin}>
                  {c.name || c.email}
                  {c.hasPin ? "" : " — ยังไม่ตั้ง PIN"}
                </option>
              ))}
            </select>
            <input
              type="password"
              inputMode="numeric"
              value={approvalPin}
              onChange={(e) => setApprovalPin(e.target.value)}
              placeholder="PIN ผู้อนุมัติ"
              style={{ padding: 8, fontSize: 13, width: 130 }}
            />
            <span style={{ fontSize: 12, color: "#888" }}>
              คืนตั้งแต่ ฿500 ขึ้นไปเริ่มมี approval flow · ตั้งแต่ ฿2,000 ถือเป็น high-value return
            </span>
          </div>
        )}
      </div>
      </>)}

      {tab === "stock" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="pos-shift-head">
            <div>
              <div className="pos-block-title" style={{ marginBottom: 2 }}>รับสินค้าจากใบสั่งซื้อ</div>
              <div className="pos-block-hint">
                รับเข้าที่สาขา {session?.location?.name ?? "ของเครื่องนี้"} · สแกนเป็นรายการร่างก่อน ยืนยันครั้งเดียวจึงขยับสต็อก
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadReceivableOrders(stockOrder?.id)}
              disabled={stockLoading || !stockReceiverId || !stockReceiverPin}
              style={{ padding: "8px 12px", fontSize: 13 }}
            >
              {stockLoading ? "กำลังโหลด…" : "โหลด PO ค้างรับ"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={stockReceiverId}
              onChange={(event) => {
                setStockReceiverId(event.target.value);
                setStockReceiverPin("");
                setReceivableOrders([]);
                setStockOrder(null);
                replaceStockDraft({});
                stockReceiveRequestRef.current = null;
              }}
              style={{ flex: "1 1 220px", minWidth: 0, padding: 10, fontSize: 13 }}
            >
              <option value="">— ผู้รับสินค้า —</option>
              {(session?.purchaseReceivers ?? []).map((receiver) => (
                <option key={receiver.id} value={receiver.id} disabled={!receiver.hasPin}>
                  {receiver.name || receiver.email} · {receiver.role ?? "ไม่ระบุ role"}
                  {receiver.hasPin ? "" : " — ยังไม่ตั้ง PIN"}
                </option>
              ))}
            </select>
            <input
              type="password"
              inputMode="numeric"
              value={stockReceiverPin}
              onChange={(event) => setStockReceiverPin(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="PIN ผู้รับสินค้า"
              style={{ flex: "0 1 170px", minWidth: 130, padding: 10, fontSize: 13 }}
            />
          </div>
          {(!stockReceiverId || !stockReceiverPin) && (
            <div className="pos-note pos-note--err">เลือกผู้รับสินค้าและใส่ PIN — ระบบตรวจสิทธิ์ purchase.receive ทุกครั้ง</div>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            ใบสั่งซื้อที่รับของ
            <select
              value={stockOrder?.id ?? ""}
              onChange={(event) => void loadStockOrder(event.target.value)}
              disabled={stockLoading || receivableOrders.length === 0}
              style={{ padding: 10, fontSize: 14 }}
            >
              <option value="">— เลือก PO —</option>
              {receivableOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id.slice(0, 8)} · {order.supplier?.name ?? "ไม่ระบุ supplier"} · ค้าง {order.qtyOrdered - order.qtyReceived}
                </option>
              ))}
            </select>
          </label>
          {!stockLoading && receivableOrders.length === 0 && stockReceiverId && stockReceiverPin && (
            <div style={{ fontSize: 12, color: "var(--pos-muted)" }}>
              กด “โหลด PO ค้างรับ” — ถ้าไม่พบ แปลว่าไม่มี PO สถานะ OPEN/PARTIAL ที่รับต่อได้
            </div>
          )}

          <div className="pos-scan">
            <ScanBarcodeIcon />
            <input
              ref={stockScanRef}
              value={stockScanCode}
              disabled={!stockOrder || stockReceiving}
              onChange={(event) => setStockScanCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  enqueueScan(stockScanCode, "manual");
                  setStockScanCode("");
                }
              }}
              placeholder={stockOrder ? "ยิงบาร์โค้ดสินค้าใน PO แล้วกด Enter" : "เลือก PO ก่อนยิงสินค้า"}
            />
          </div>

          {stockOrder && (() => {
            const draftUnits = stockOrder.items.reduce(
              (sum, line) => sum + (stockDraft[stockLineKey(line.sku, line.size)]?.qty ?? 0),
              0
            );
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <strong>PO {stockOrder.id.slice(0, 8)} · {stockOrder.supplier?.name ?? "ไม่ระบุ supplier"}</strong>
                  <span style={{ color: "var(--pos-muted)" }}>สถานะ {stockOrder.status}</span>
                </div>
                {stockOrder.note && <div style={{ fontSize: 12, color: "var(--pos-muted)" }}>หมายเหตุ: {stockOrder.note}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stockOrder.items.map((line) => {
                    const key = stockLineKey(line.sku, line.size);
                    const draft = stockDraft[key] ?? { qty: 0, lotNo: "", expiryDate: "" };
                    const remaining = Math.max(0, line.qtyOrdered - line.qtyReceived);
                    return (
                      <div key={key} style={{ border: "1px solid var(--pos-line)", borderRadius: 8, padding: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center" }}>
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ fontSize: 13 }}>{line.sku} · {line.size}</strong>
                            <div style={{ fontSize: 11, color: "var(--pos-muted)" }}>
                              สั่ง {line.qtyOrdered} · รับแล้ว {line.qtyReceived} · เหลือ {remaining}
                            </div>
                          </div>
                          <div className="pos-qty">
                            <button type="button" onClick={() => updateStockDraft(line, { qty: draft.qty - 1 })} disabled={draft.qty <= 0}>−</button>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={draft.qty}
                              onChange={(event) => updateStockDraft(line, { qty: Number(event.target.value) || 0 })}
                              aria-label={`จำนวนรับ ${line.sku} ${line.size}`}
                              style={{ width: 62, textAlign: "center", padding: 7 }}
                            />
                            <button type="button" onClick={() => updateStockDraft(line, { qty: draft.qty + 1 })} disabled={draft.qty >= remaining}>+</button>
                          </div>
                        </div>
                        {draft.qty > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(140px,1fr)", gap: 8, marginTop: 8 }}>
                            <input
                              value={draft.lotNo}
                              maxLength={100}
                              onChange={(event) => updateStockDraft(line, { lotNo: event.target.value })}
                              placeholder="Lot ผู้ผลิต (ถ้ามี)"
                              style={{ padding: 8, fontSize: 12 }}
                            />
                            <input
                              type="date"
                              value={draft.expiryDate}
                              onChange={(event) => updateStockDraft(line, { expiryDate: event.target.value })}
                              aria-label={`วันหมดอายุ ${line.sku} ${line.size}`}
                              style={{ padding: 8, fontSize: 12 }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={draftUnits === 0 || stockReceiving || !stockReceiverId || !stockReceiverPin}
                  onClick={() => {
                    if (window.confirm(`ยืนยันรับสินค้า ${draftUnits} หน่วยเข้าสต็อกสาขานี้? รายการนี้ขยับสต็อกจริงและย้อนกลับจากหน้านี้ไม่ได้`)) {
                      void submitStockReceive();
                    }
                  }}
                  style={{ padding: "11px 14px", fontSize: 14, fontWeight: 600 }}
                >
                  {stockReceiving ? "กำลังบันทึก…" : `ยืนยันรับเข้า ${draftUnits} หน่วย`}
                </button>
              </>
            );
          })()}
        </div>
      )}

      {tab === "deposits" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="pos-shift-head">
            <div>
              <div className="pos-block-title" style={{ marginBottom: 2 }}>มัดจำ / ยอดค้างรับ</div>
              <div className="pos-block-hint">แสดงเฉพาะบิลที่จองสินค้าของสาขาเครื่องนี้</div>
            </div>
            <button onClick={() => void refreshDeposits()} style={{ padding: "7px 12px" }}>โหลดใหม่</button>
          </div>

          <div className="pos-block">
            <div className="pos-block-title">ทำรายการ</div>
            <div style={{ background: "#f0f7ff", border: "1px solid #91caff", borderRadius: 8, padding: 10, marginBottom: 10 }}>
              <b>ลูกค้าหน้าร้าน:</b> ใส่สินค้าในตะกร้าตามปกติ ระบุยอดมัดจำด้านล่าง แล้วกดสร้างบิล
              ระบบจะสร้าง Order ID, คำนวณราคาล่าสุด และจองสต็อกให้อัตโนมัติ
              <div style={{ marginTop: 8 }}>
                <button
                  className="pos-shift-btn-primary"
                  disabled={busy || hasPendingSale || cart.length === 0}
                  onClick={() => void createDepositFromCart()}
                >
                  {busy ? "กำลังบันทึก…" : hasPendingDepositSale ? "ตรวจรายการมัดจำเดิม" : `สร้างบิล + รับมัดจำ (${cart.length} รายการ)`}
                </button>
              </div>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>บิลที่ต้องการทำรายการ</span>
              <select value={depositOrderId} onChange={(event) => {
                const orderId = event.target.value;
                const openDeposit = deposits.find((deposit) => deposit.orderId === orderId);
                setDepositOrderId(orderId);
                setDepositAmount(openDeposit ? String(openDeposit.balanceDue) : "");
              }}>
                <option value="">— เลือกบิลในระบบ —</option>
                {depositCandidateOrders.length > 0 && (
                  <optgroup label="บิล PENDING ที่รับมัดจำครั้งแรกได้">
                    {depositCandidateOrders.map((order) => (
                      <option key={order.orderId} value={order.orderId}>
                        #{order.orderId.slice(0, 8).toUpperCase()} · {order.channel.toUpperCase()} · {order.itemCount} ชิ้น · ฿{baht(order.totalAmount)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {deposits.length > 0 && (
                  <optgroup label="รายการมัดจำที่เปิดอยู่">
                    {deposits.map((deposit) => (
                      <option key={deposit.orderId} value={deposit.orderId}>
                        {deposit.customerNote || `#${deposit.orderId.slice(0, 8).toUpperCase()}`} · ค้าง ฿{baht(deposit.balanceDue)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="pos-block-hint">
                กรณีมีออเดอร์จาก Inbox / Customer 360 อยู่แล้ว ให้เลือกบิลจากรายการนี้เพื่อรับมัดจำ
                ไม่ต้องพิมพ์ UUID หรือบาร์โค้ดสินค้าเอง
              </span>
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>จำนวนเงิน</span>
                <input className="pos-num" inputMode="decimal" value={depositAmount}
                       onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                       placeholder="0.00" style={{ width: 150, textAlign: "right" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>วิธีรับเงิน</span>
                <select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)}>
                  <option value="CASH">เงินสด</option>
                  <option value="QR">QR</option>
                  <option value="CARD">บัตร</option>
                  <option value="BANK_TRANSFER">โอนเงิน</option>
                  <option value="WALLET">Wallet</option>
                </select>
              </label>
              <button disabled={busy || !depositCandidateOrders.some((order) => order.orderId === depositOrderId)}
                      onClick={() => void doDepositAction("take")}>รับมัดจำครั้งแรก</button>
              <button disabled={busy || !deposits.some((deposit) => deposit.orderId === depositOrderId)}
                      onClick={() => void doDepositAction("add")}>รับเพิ่ม (ยังไม่ครบ)</button>
              <button className="pos-shift-btn-primary"
                      disabled={busy || !deposits.some((deposit) => deposit.orderId === depositOrderId)}
                      onClick={() => void doDepositAction("settle")}>รับยอดคงเหลือ + ส่งของ</button>
            </div>
            <div style={{ borderTop: "1px solid var(--pos-line)", marginTop: 12, paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={depositOutcome}
                        onChange={(e) => setDepositOutcome(e.target.value as "CANCELLED" | "FORFEITED")}>
                  <option value="CANCELLED">ยกเลิกและต้องคืนมัดจำ</option>
                  <option value="FORFEITED">ยึดมัดจำ</option>
                </select>
                <input value={depositReason} onChange={(e) => setDepositReason(e.target.value)}
                       maxLength={300} placeholder="เหตุผลที่ปิดมัดจำ" style={{ flex: 1, minWidth: 220 }} />
                <button disabled={busy || !deposits.some((deposit) => deposit.orderId === depositOrderId)}
                        onClick={() => void doDepositAction("close")}>ปิดมัดจำ</button>
              </div>
              <div className="pos-block-hint">
                การปิดจะคืนสินค้าที่จองไว้ทันที ส่วนการจ่ายเงินคืนลูกค้าให้ทำผ่าน refund ตามวิธีเดิม
              </div>
            </div>
          </div>

          <div className="pos-block">
            <div className="pos-block-title">รายการที่ยังเปิดอยู่ ({deposits.length})</div>
            {deposits.length === 0 ? (
              <div className="pos-block-hint">ไม่มีมัดจำค้างของสาขานี้</div>
            ) : deposits.map((deposit) => (
              <button key={deposit.id} type="button" className="pos-move-row"
                      onClick={() => {
                        setDepositOrderId(deposit.orderId);
                        setDepositAmount(String(deposit.balanceDue));
                      }}
                      style={{ width: "100%", textAlign: "left", background: "transparent", border: 0 }}>
                <span>
                  <b>{deposit.customerNote || deposit.orderId.slice(0, 8)}</b>
                  <span style={{ color: deposit.overdue ? "var(--pos-danger)" : "var(--pos-muted)", marginLeft: 8 }}>
                    {deposit.overdue ? "เลยกำหนด" : deposit.dueAt ? `รับภายใน ${new Date(deposit.dueAt).toLocaleDateString("th-TH")}` : "ไม่กำหนดวันรับ"}
                  </span>
                </span>
                <span className="pos-num">จ่ายแล้ว ฿{baht(deposit.depositPaid)} · ค้าง ฿{baht(deposit.balanceDue)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "shift" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {session?.shift ? (
            <>
              <div className="pos-shift-head">
                <div className="pos-block-title" style={{ marginBottom: 0 }}>กะขายของเครื่องนี้</div>
                <span className="pos-chip pos-chip--ok">
                  กะเปิดอยู่{session.device.code ? ` · ${session.device.code}` : ""}
                </span>
              </div>

              {/* ข้อมูลหัวกะเป็นการ์ดตัวเลข ไม่ใช่สามบรรทัดเรียงกัน — แคชเชียร์
                  อ่านจากระยะยืนขาย ไม่ได้ก้มอ่านเหมือนอ่านเอกสาร */}
              <div className="pos-stats">
                <div className="pos-stat">
                  <div className="pos-stat-label">เปิดกะ</div>
                  <div className="pos-stat-value">
                    {new Date(session.shift.openedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="pos-stat-hint">{new Date(session.shift.openedAt).toLocaleDateString("th-TH")}</div>
                </div>
                <div className="pos-stat">
                  <div className="pos-stat-label">เงินตั้งต้นในลิ้นชัก</div>
                  <div className="pos-stat-value">฿{baht(session.shift.openingFloat)}</div>
                  <div className="pos-stat-hint">รับจากผู้จัดการตอนเปิดกะ</div>
                </div>
                <div className="pos-stat">
                  <div className="pos-stat-label">คืนสินค้าในกะนี้</div>
                  <div className="pos-stat-value">
                    {shiftReturnSummary.count} บิล · ฿{baht(shiftReturnSummary.total)}
                  </div>
                  {shiftReturnSummary.pendingCount > 0 ? (
                    <div className="pos-stat-hint pos-stat-hint--warn">
                      รอยืนยันคืนเงินจริง {shiftReturnSummary.pendingCount} รายการ ฿{baht(shiftReturnSummary.pendingTotal)}
                    </div>
                  ) : (
                    <div className="pos-stat-hint">ไม่มีรายการรอยืนยัน</div>
                  )}
                </div>
              </div>

              {/* ปิดกะขณะมีของค้างในตะกร้าไม่ได้ — บิลที่ยังไม่จบจะหายไปกับกะ */}
              {cart.length > 0 ? (
                <div className="pos-note pos-note--warn">
                  ยังมีสินค้าค้างในตะกร้า — ปิดบิลให้จบหรือล้างบิลก่อนปิดกะ
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>เงินที่นับได้ในลิ้นชัก</span>
                    <input
                      ref={countedCashRef}
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="pos-num"
                      style={{ fontSize: 15, width: 170, textAlign: "right" }}
                    />
                  </label>
                  <button
                    className="pos-shift-btn-primary"
                    disabled={busy || !cashierId || !pin || !countedCash}
                    onClick={() => void shiftAction("close")}
                    style={{ padding: "10px 18px" }}
                  >
                    ปิดกะ + นับเงิน
                  </button>
                  {shiftReport?.expectedCashHidden && (
                    <span style={{ fontSize: 12, color: "var(--pos-muted)", paddingBottom: 12 }}>
                      โหมดนับปิดตา — ยอดที่ควรมีจะแสดงหลังกดปิดกะ
                    </span>
                  )}
                </div>
              )}

              {/* ---- ค่าใช้จ่ายเงินสดย่อย (9.7) -----------------------
                  แยกออกจาก drawer movement เพราะนำฝากธนาคาร/ย้ายเงินทอน
                  ไม่ใช่ต้นทุน ส่วนเงินที่เข้าออกจริงยังลง movement ให้สูตรปิดกะ */}
              <div className="pos-block">
                <div className="pos-shift-head" style={{ marginBottom: 8 }}>
                  <div className="pos-block-title" style={{ marginBottom: 0, flex: 1 }}>ค่าใช้จ่ายหน้าร้าน</div>
                  <button type="button" onClick={() => void refreshExpenses()}
                          style={{ padding: "6px 12px", fontSize: 12, minHeight: 34 }}>
                    โหลดรายการ
                  </button>
                </div>
                <div className="pos-block-hint" style={{ marginBottom: 8 }}>
                  ใช้สำหรับค่าน้ำแข็ง วัตถุดิบ ถุง หรือเบิกเงินไปซื้อของ · นำฝากธนาคารให้ใช้ “เงินเข้า–ออกลิ้นชัก” ด้านล่าง
                </div>
                <div className="pos-expense-grid">
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>วิธีจ่าย</span>
                    <select value={expenseMode} onChange={(e) => setExpenseMode(e.target.value as PosExpenseEntryMode)}>
                      <option value="DIRECT">จ่ายให้ผู้ขายทันที</option>
                      <option value="ADVANCE">เบิกเงินไปซื้อก่อน</option>
                      <option value="PETTY_CASH" disabled={pettyCashBalance <= 0}>
                        เงินสดย่อยร้าน · คงเหลือ ฿{baht(pettyCashBalance)}
                      </option>
                      {canUsePersonalFunds && (
                        <option value="PERSONAL">เจ้าของคนเดียว · สำรองจ่ายส่วนตัว</option>
                      )}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>หมวด</span>
                    <select value={expenseCategory}
                            onChange={(e) => setExpenseCategory(e.target.value as PosExpenseCategory)}>
                      {(Object.entries(POS_EXPENSE_CATEGORY_LABELS) as Array<[PosExpenseCategory, string]>).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                      {expenseMode === "ADVANCE" ? "ยอดที่เบิก"
                        : expenseMode === "PETTY_CASH" ? "ยอดที่จ่ายจากเงินสดย่อย"
                        : expenseMode === "PERSONAL" ? "ยอดที่สำรองจ่าย" : "ยอดที่จ่าย"}
                    </span>
                    <input ref={expenseAmountRef} className="pos-num" inputMode="decimal" value={expenseAmount}
                           onChange={(e) => setExpenseAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                           placeholder="0.00" style={{ textAlign: "right" }} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <input ref={expenseDescriptionRef} value={expenseDescription} onChange={(e) => setExpenseDescription(e.target.value)}
                         maxLength={200} placeholder="รายละเอียด เช่น ค่าน้ำแข็ง 5 กระสอบ"
                         style={{ minWidth: 240, flex: 2 }} />
                  <input value={expensePayee} onChange={(e) => setExpensePayee(e.target.value)}
                         maxLength={160} placeholder="ผู้รับเงิน/ร้านค้า (ถ้ามี)"
                         style={{ minWidth: 180, flex: 1 }} />
                  <input ref={expenseReceiptRefRef} value={expenseReceiptRef} onChange={(e) => setExpenseReceiptRef(e.target.value)}
                         maxLength={300} placeholder={expenseMode === "PERSONAL" || expenseMode === "PETTY_CASH"
                           ? "เลขที่ใบเสร็จ/หลักฐาน (จำเป็น)"
                           : "เลขที่ใบเสร็จ/หลักฐาน (ถ้ามี)"}
                         style={{ minWidth: 190, flex: 1 }} />
                </div>
                {expenseMode === "PERSONAL" ? (
                  <div className="pos-approve pos-approve--personal">
                    <div className="pos-approve-why">
                      โหมดเจ้าของคนเดียว · บันทึกค่าใช้จ่ายจากเงินส่วนตัวโดยไม่หักเงินในลิ้นชัก
                      และต้องระบุเลขที่ใบเสร็จหรือหลักฐาน
                    </div>
                    <button type="button" disabled={busy} onClick={() => void createExpense()}>
                      บันทึกเงินส่วนตัว
                    </button>
                  </div>
                ) : expenseMode === "PETTY_CASH" ? (
                  <div className="pos-approve pos-approve--petty">
                    <div className="pos-approve-why">
                      จ่ายจากกระเป๋าเงินสดย่อยของสาขา · คงเหลือ ฿{baht(pettyCashBalance)}
                      · ไม่หักเงินในลิ้นชัก และต้องมีหลักฐาน
                    </div>
                    <button type="button" disabled={busy || pettyCashBalance <= 0} onClick={() => void createExpense()}>
                      จ่ายจากเงินสดย่อย
                    </button>
                  </div>
                ) : (
                  <div className="pos-approve">
                    <div className="pos-approve-why">
                      {expenseMode === "DIRECT"
                        ? "จ่ายเงินออกต้องมีหัวหน้ากด PIN ทุกครั้ง"
                        : "เบิกเงินออกต้องมีหัวหน้ากด PIN และต้องกลับมาปิดยอดก่อนปิดกะ"}
                    </div>
                    <div className="pos-approve-row">
                      <select ref={expenseApproverSelectRef} value={expenseApproverId} onChange={(e) => setExpenseApproverId(e.target.value)}>
                        <option value="">— ผู้อนุมัติ —</option>
                        {(session?.cashiers ?? []).filter((c) => c.hasPin && c.id !== cashierId).map((c) => (
                          <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                        ))}
                      </select>
                      <input ref={expenseApproverPinRef} type="password" inputMode="numeric" value={expenseApproverPin}
                             onChange={(e) => setExpenseApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                             placeholder="PIN หัวหน้า" style={{ textAlign: "center" }} />
                      <button type="button" disabled={busy} onClick={() => void createExpense()}>
                        {expenseMode === "DIRECT" ? "บันทึกค่าใช้จ่าย" : "เบิกเงิน"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="pos-petty-wallet">
                  <div className="pos-petty-wallet-head">
                    <span>
                      <b>กระเป๋าเงินสดย่อยสาขา</b>
                      <small>อยู่นอกลิ้นชัก POS</small>
                    </span>
                    <strong>฿{baht(pettyCashBalance)}</strong>
                  </div>
                  {canManagePettyCash && (
                    <div className="pos-petty-fund-grid">
                      <select value={pettyFundSource}
                              onChange={(e) => setPettyFundSource(e.target.value as "OWNER_PERSONAL" | "BUSINESS_ACCOUNT")}>
                        <option value="OWNER_PERSONAL">เติมจากเงินเจ้าของ</option>
                        <option value="BUSINESS_ACCOUNT">เติมจากบัญชีร้าน</option>
                      </select>
                      <input ref={pettyFundAmountRef} className="pos-num" inputMode="decimal" value={pettyFundAmount}
                             onChange={(e) => setPettyFundAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                             placeholder="จำนวนเงิน" style={{ textAlign: "right" }} />
                      <input ref={pettyFundReasonRef} value={pettyFundReason} onChange={(e) => setPettyFundReason(e.target.value)}
                             maxLength={200} placeholder="เหตุผล เช่น เงินสดย่อยประจำสัปดาห์" />
                      <input ref={pettyFundEvidenceRef} value={pettyFundEvidence} onChange={(e) => setPettyFundEvidence(e.target.value)}
                             maxLength={300} placeholder="หลักฐาน/เลขอ้างอิง (จำเป็น)" />
                      <button type="button" disabled={busy} onClick={() => void fundPettyCash()}>เติมเงินสดย่อย</button>
                    </div>
                  )}
                  {!canManagePettyCash && (
                    <div className="pos-approve pos-approve--petty" style={{ marginTop: 8 }}>
                      <div className="pos-approve-why">
                        {expenseAccessError
                          ? `ยังใช้งานไม่ได้: ${expenseAccessError}`
                          : pettyCashBalance <= 0
                            ? "ยอดเป็น ฿0.00 และบัญชีนี้ไม่มีสิทธิ์เติมเงินสดย่อย"
                            : "บัญชีนี้ใช้ยอดที่มีจ่ายค่าใช้จ่ายได้ แต่ไม่มีสิทธิ์เติมเงินเพิ่ม"}
                        <br />
                        วิธีเติม: เลือกบัญชี Administrator ด้านบน ใส่ PIN แล้วกด “ตรวจสิทธิ์/ยอดใหม่”
                        จากนั้นระบุแหล่งเงิน จำนวน เหตุผล และหลักฐาน
                      </div>
                      <button type="button" disabled={busy || !cashierId || !pin} onClick={() => void refreshExpenses()}>
                        ตรวจสิทธิ์/ยอดใหม่
                      </button>
                    </div>
                  )}
                  {pettyCashEntries.length > 0 && (
                    <div className="pos-petty-history">
                      {pettyCashEntries.slice(0, 5).map((entry) => (
                        <div key={entry.id} className="pos-move-row">
                          <span>
                            <span className={entry.direction === "IN" ? "pos-move-dir--in" : "pos-move-dir--out"}>
                              {entry.direction === "IN" ? "เติม" : "จ่าย"}
                            </span>
                            {" · "}{entry.reason} · หลักฐาน {entry.evidenceRef}
                          </span>
                          <span className="pos-num">{entry.direction === "IN" ? "+" : "−"}฿{baht(entry.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {expenses.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--pos-line)", paddingTop: 6 }}>
                    {expenses.map((expense) => (
                      <div key={expense.id} className="pos-move-row" style={{ alignItems: "center" }}>
                        <span style={{ minWidth: 0 }}>
                          <span className={expense.status === "OPEN" ? "pos-chip pos-chip--warn" : "pos-chip pos-chip--ok"}>
                            {expense.status === "OPEN" ? "รอปิดยอด" : "ปิดยอดแล้ว"}
                          </span>{" "}
                          {expense.fundingSource === "PERSONAL" && (
                            <><span className="pos-chip pos-chip--personal">เงินส่วนตัว</span>{" "}</>
                          )}
                          {expense.fundingSource === "PETTY_CASH" && (
                            <><span className="pos-chip pos-chip--petty">เงินสดย่อย</span>{" "}</>
                          )}
                          <b>{POS_EXPENSE_CATEGORY_LABELS[expense.category]}</b> · {expense.description}
                          {expense.payee ? ` · ${expense.payee}` : ""}
                          <span style={{ display: "block", color: "var(--pos-muted)", fontSize: 12, marginTop: 3 }}>
                            {expense.kind === "ADVANCE"
                              ? `เบิก ฿${baht(expense.advancedAmount)}${expense.actualAmount == null ? "" : ` · ใช้จริง ฿${baht(expense.actualAmount)}`}`
                              : `จ่าย ฿${baht(expense.actualAmount ?? expense.advancedAmount)}`}
                            {expense.returnedAmount > 0 ? ` · คืน ฿${baht(expense.returnedAmount)}` : ""}
                            {expense.extraCashOut > 0 ? ` · จ่ายเพิ่ม ฿${baht(expense.extraCashOut)}` : ""}
                            {expense.receiptRef ? ` · หลักฐาน ${expense.receiptRef}` : ""}
                            {expense.fundingSource === "PERSONAL" || expense.fundingSource === "PETTY_CASH"
                              ? " · ไม่กระทบยอดลิ้นชัก" : ""}
                            {expense.approvedByName ? ` · อนุมัติ ${expense.approvedByName}` : ""}
                          </span>
                        </span>
                        {expense.status === "OPEN" ? (
                          <button type="button" disabled={busy} onClick={() => openExpenseSettlement(expense)}
                                  style={{ padding: "6px 12px", fontSize: 12, flex: "none" }}>
                            ปิดยอด
                          </button>
                        ) : (
                          <span className="pos-num" style={{ flex: "none" }}>฿{baht(expense.actualAmount ?? 0)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {settleExpenseId && (() => {
                  const target = expenses.find((expense) => expense.id === settleExpenseId);
                  if (!target) return null;
                  const actual = Number(settleActualAmount || 0);
                  const difference = Math.round((target.advancedAmount - actual) * 100) / 100;
                  return (
                    <div className="pos-approve" style={{ marginTop: 10 }}>
                      <div className="pos-approve-why">
                        ปิดยอดเบิก “{target.description}” · เบิกไว้ ฿{baht(target.advancedAmount)}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <input ref={settleActualAmountRef} className="pos-num" inputMode="decimal" value={settleActualAmount}
                               onChange={(e) => setSettleActualAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                               placeholder="ยอดซื้อจริง" style={{ width: 150, textAlign: "right" }} />
                        <input ref={settleReceiptRefRef} value={settleReceiptRef} onChange={(e) => setSettleReceiptRef(e.target.value)}
                               maxLength={300} placeholder="เลขที่ใบเสร็จ/หลักฐาน"
                               style={{ minWidth: 200, flex: 1 }} />
                        <span style={{ alignSelf: "center", fontSize: 12, color: difference >= 0 ? "var(--pos-money)" : "var(--pos-warn)" }}>
                          {difference > 0 ? `ต้องคืนลิ้นชัก ฿${baht(difference)}`
                            : difference < 0 ? `ต้องจ่ายเพิ่ม ฿${baht(Math.abs(difference))}` : "ยอดพอดีกับที่เบิก"}
                        </span>
                      </div>
                      <div className="pos-approve-row">
                        <select ref={settleApproverSelectRef} value={settleApproverId} onChange={(e) => setSettleApproverId(e.target.value)}>
                          <option value="">— ผู้อนุมัติปิดยอด —</option>
                          {(session?.cashiers ?? []).filter((c) => c.hasPin && c.id !== cashierId).map((c) => (
                            <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                          ))}
                        </select>
                        <input ref={settleApproverPinRef} type="password" inputMode="numeric" value={settleApproverPin}
                               onChange={(e) => setSettleApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                               placeholder="PIN หัวหน้า" style={{ textAlign: "center" }} />
                        <button type="button" disabled={busy} onClick={() => void settleExpense()}>ยืนยันปิดยอด</button>
                        <button type="button" disabled={busy} className="pos-btn-ghost"
                                onClick={() => setSettleExpenseId(null)}>ยกเลิก</button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ---- เงินเข้า-ออกลิ้นชัก (7.97) ------------------------
                  ก่อนมีส่วนนี้ การถอนเงินไปฝากกลางกะทำให้ปิดกะขึ้นเงินขาดทุกครั้ง
                  โดยไม่มีที่ให้อธิบาย · เงินออกต้องมีหัวหน้ากด PIN เงินเข้าไม่ต้อง */}
              <div className="pos-block">
                <div className="pos-block-title">เงินเข้า–ออกลิ้นชัก</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select value={cashMoveDir} onChange={(e) => {
                    setCashMoveDir(e.target.value as "IN" | "OUT");
                    setCashMoveExternalConfirmed(false);
                  }}
                          style={{ fontSize: 14, minWidth: 140 }}>
                    <option value="OUT">นำเงินออก</option>
                    <option value="IN">เติมเงินจากภายนอก (ไม่ใช่ยอดขาย)</option>
                  </select>
                  <input ref={cashMoveAmountRef} value={cashMoveAmount} onChange={(e) => setCashMoveAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                         inputMode="decimal" placeholder="จำนวนเงิน" className="pos-num"
                         style={{ fontSize: 14, width: 130, textAlign: "right" }} />
                  <input ref={cashMoveReasonRef} value={cashMoveReason} onChange={(e) => setCashMoveReason(e.target.value)} maxLength={200}
                         placeholder={cashMoveDir === "IN" ? "ที่มา เช่น เติมเงินทอนจากเงินเจ้าของ" : "เหตุผล เช่น นำส่งธนาคาร"}
                         style={{ fontSize: 14, minWidth: 200, flex: 1 }} />
                </div>
                {cashMoveDir === "IN" && (
                  <div className="pos-approve">
                    <div className="pos-approve-why">
                      ยอดขายเงินสดเข้ายอดลิ้นชักอัตโนมัติทันทีเมื่อขายสำเร็จ ห้ามนำยอดขายมาบันทึกซ้ำที่นี่
                    </div>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={cashMoveExternalConfirmed}
                        onChange={(e) => setCashMoveExternalConfirmed(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span>ยืนยันว่าเงินนี้มาจากนอกยอดขาย เช่น เงินทอนเพิ่มจากเจ้าของหรือรับโอนจากลิ้นชักอื่น</span>
                    </label>
                  </div>
                )}
                {cashMoveDir === "OUT" && (
                  <div className="pos-approve">
                    <div className="pos-approve-why">เงินออกจากลิ้นชักต้องมีหัวหน้ากด PIN ทุกครั้ง</div>
                    <div className="pos-approve-row">
                      <select ref={cashApproverSelectRef} value={cashApproverId} onChange={(e) => setCashApproverId(e.target.value)}
                              style={{ fontSize: 14 }}>
                        <option value="">— ผู้อนุมัติ —</option>
                        {(session?.cashiers ?? []).filter((c) => c.hasPin).map((c) => (
                          <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                        ))}
                      </select>
                      <input ref={cashApproverPinRef} type="password" inputMode="numeric" value={cashApproverPin}
                             onChange={(e) => setCashApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                             placeholder="PIN หัวหน้า" style={{ fontSize: 14, textAlign: "center" }} />
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => void doCashMovement()} disabled={busy} style={{ padding: "9px 16px" }}>
                    บันทึกรายการ
                  </button>
                  <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                    ใช้เฉพาะเงินที่เข้า/ออกนอกการขาย · ทุกรายการเข้าสูตรเงินในลิ้นชักของกะนี้
                  </span>
                </div>
                {cashMoves.length > 0 && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--pos-line)", paddingTop: 6 }}>
                    {cashMoves.map((m) => (
                      <div key={m.id} className="pos-move-row">
                        <span>
                          <span className={m.direction === "IN" ? "pos-move-dir--in" : "pos-move-dir--out"}>
                            {m.direction === "IN" ? "เงินนอกยอดขายเข้า" : "ออก"}
                          </span>{" "}
                          · {m.reason}
                          {m.approvedByName ? ` · อนุมัติ ${m.approvedByName}` : ""}
                        </span>
                        <span className="pos-num">฿{baht(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ---- เปิดลิ้นชักโดยไม่ขาย (8.0) ------------------------
                  ห้ามไม่ได้จริง (ทุกลิ้นชักมีคันโยกฉุกเฉินใต้เครื่อง) จึงทำให้ทางที่
                  ถูกต้องสะดวกกว่าทางลัด: กดปุ่มนี้แล้วลิ้นชักเปิดให้เลยถ้าต่อเครื่องพิมพ์ไว้ */}
              <div className="pos-block">
                <div className="pos-shift-head" style={{ marginBottom: 8 }}>
                  <div className="pos-block-title" style={{ marginBottom: 0 }}>เปิดลิ้นชักโดยไม่ขาย</div>
                  {shiftReport && (
                    <span className="pos-chip">กะนี้ {shiftReport.noSaleCount} ครั้ง</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    ref={noSaleReasonRef}
                    value={noSaleReason}
                    onChange={(e) => setNoSaleReason(e.target.value)}
                    maxLength={200}
                    placeholder="เหตุผล เช่น แลกแบงก์ย่อยให้ลูกค้า"
                    style={{ fontSize: 14, minWidth: 240, flex: 1 }}
                  />
                  <button onClick={() => void doNoSale()} disabled={busy} style={{ padding: "9px 16px" }}>
                    บันทึก + เปิดลิ้นชัก
                  </button>
                </div>
                <div className="pos-block-hint">ทุกครั้งที่เปิดจะถูกบันทึกและนับรวมในสรุปกะ</div>
              </div>

              {/* ---- สรุปกะ X-report (7.97) ---------------------------
                  กระดาษที่ผู้จัดการเซ็นรับเงินจากแคชเชียร์ทุกกะ */}
              <div className="pos-block">
                <div className="pos-shift-head" style={{ marginBottom: 8 }}>
                  <div className="pos-block-title" style={{ marginBottom: 0, flex: 1 }}>สรุปกะ</div>
                  <button onClick={() => void loadShiftReport()} style={{ padding: "6px 14px", fontSize: 13, minHeight: 36 }}>
                    ดูสรุปกะ
                  </button>
                  {shiftReport && (
                    <button onClick={() => window.print()} style={{ padding: "6px 14px", fontSize: 13, minHeight: 36 }}>
                      พิมพ์
                    </button>
                  )}
                </div>
                {shiftReport && (
                  <div className="pos-report">
                    <div className="pos-report-meta">
                      เครื่อง {shiftReport.deviceCode}{shiftReport.locationName ? ` · ${shiftReport.locationName}` : ""}
                    </div>
                    <div className="pos-report-grid">
                      <span>ยอดขายสุทธิ · {shiftReport.billCount} บิล</span><span>฿{baht(shiftReport.salesTotal)}</span>
                      <span>ส่วนลดรวม</span><span>฿{baht(shiftReport.discountTotal)}</span>
                      <span>ยกเลิกบิล {shiftReport.voidCount} ใบ</span><span>฿{baht(shiftReport.voidTotal)}</span>
                      <span>คืนสินค้า {shiftReport.returnCount} บิล</span><span>฿{baht(shiftReport.returnTotal)}</span>
                    </div>
                    <div className="pos-report-sep pos-report-grid">
                      {shiftReport.byMethod.map((m) => (
                        <Fragment key={m.method}>
                          <span>{m.method} · {m.count} รายการ</span><span>฿{baht(m.amount)}</span>
                        </Fragment>
                      ))}
                    </div>
                    <div className="pos-report-sep pos-report-grid">
                      {shiftReport.byCashier.map((c) => (
                        <Fragment key={c.cashier}>
                          <span>{c.cashier} · {c.billCount} บิล</span><span>฿{baht(c.amount)}</span>
                        </Fragment>
                      ))}
                    </div>
                    <div className="pos-report-sep pos-report-grid">
                      <span>เงินตั้งต้น</span><span>฿{baht(shiftReport.openingFloat)}</span>
                      <span>เงินนอกยอดขายเข้าลิ้นชัก</span><span>฿{baht(shiftReport.cashIn)}</span>
                      <span>เงินออกจากลิ้นชัก</span><span>฿{baht(shiftReport.cashOut)}</span>
                      <span>คืนเงินสด</span><span>฿{baht(shiftReport.cashRefunds)}</span>
                      <span>ค่าใช้จ่ายหน้าร้าน · {shiftReport.expenseCount} รายการ</span>
                      <span>฿{baht(shiftReport.expenseTotal)}</span>
                      {shiftReport.personalExpenseCount > 0 && (
                        <>
                          <span style={{ color: "var(--pos-accent)" }}>
                            ในจำนวนนี้เจ้าของสำรองจ่าย · {shiftReport.personalExpenseCount} รายการ
                          </span>
                          <span style={{ color: "var(--pos-accent)" }}>฿{baht(shiftReport.personalExpenseTotal)}</span>
                        </>
                      )}
                      {shiftReport.pettyCashExpenseCount > 0 && (
                        <>
                          <span style={{ color: "var(--pos-money)" }}>
                            ในจำนวนนี้จ่ายจากเงินสดย่อย · {shiftReport.pettyCashExpenseCount} รายการ
                          </span>
                          <span style={{ color: "var(--pos-money)" }}>฿{baht(shiftReport.pettyCashExpenseTotal)}</span>
                        </>
                      )}
                      {shiftReport.openExpenseCount > 0 && (
                        <>
                          <span style={{ color: "var(--pos-warn)" }}>เงินเบิกยังไม่ปิดยอด · {shiftReport.openExpenseCount} รายการ</span>
                          <span style={{ color: "var(--pos-warn)" }}>฿{baht(shiftReport.openExpenseAmount)}</span>
                        </>
                      )}
                      <span>เปิดลิ้นชักโดยไม่ขาย</span><span>{shiftReport.noSaleCount} ครั้ง</span>
                    </div>
                    <div className="pos-report-sep">
                      {shiftReport.expectedCashHidden ? (
                        <div style={{ color: "var(--pos-muted)" }}>
                          เงินสดที่ควรมี — ซ่อนไว้จนกว่าจะปิดกะ (โหมดนับปิดตา)
                        </div>
                      ) : (
                        <div className="pos-report-grid pos-report-total">
                          <span>เงินสดที่ควรมี</span><span>฿{baht(shiftReport.expectedCash ?? 0)}</span>
                        </div>
                      )}
                      {shiftReport.countedCash != null && (
                        <div className="pos-report-grid" style={{ marginTop: 3 }}>
                          <span>นับได้</span><span>฿{baht(shiftReport.countedCash)}</span>
                          <span>ส่วนต่าง</span>
                          <span style={{ color: (shiftReport.cashVariance ?? 0) < 0 ? "var(--pos-danger)" : "var(--pos-money)" }}>
                            ฿{baht(shiftReport.cashVariance ?? 0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="pos-block-title">กะขายของเครื่องนี้</div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>เงินตั้งต้นในลิ้นชัก</span>
                  <input
                    ref={openingFloatRef}
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pos-num"
                    style={{ fontSize: 15, width: 200, textAlign: "right" }}
                  />
                </label>
                <button
                  className="pos-shift-btn-primary"
                  disabled={busy || !cashierId || !pin}
                  onClick={() => void shiftAction("open")}
                  style={{ padding: "10px 18px" }}
                >
                  เปิดกะ
                </button>
                {(!cashierId || !pin) && (
                  <span style={{ fontSize: 13, color: "var(--pos-warn)", paddingBottom: 12 }}>
                    เลือกผู้ขายและใส่ PIN ก่อน
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>ผู้ขายที่เครื่องนี้</div>
            {/* ช่องจริงอยู่แถบบนช่องเดียว — มีสองที่แล้วสับสนว่าต้องกรอกอันไหน */}
            <div style={{ fontSize: 13, color: "#555" }}>
              {currentCashierName ? `กำลังขายในชื่อ ${currentCashierName}` : "ยังไม่ได้เลือกผู้ขาย"}
              {currentCashierName && !pin ? " · ยังไม่ใส่ PIN" : ""}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
              เปลี่ยนผู้ขาย/ใส่ PIN ได้ที่แถบด้านบน · PIN เก็บในหน่วยความจำเท่านั้น รีเฟรชหน้าแล้วต้องใส่ใหม่
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>เครื่องพิมพ์และลิ้นชัก</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isWebUsbSupported() ? (
                <button onClick={() => void setupPrinter()} style={{ padding: "8px 14px", fontSize: 13 }}>
                  {printerReady ? "เครื่องพิมพ์ ✓ — เปลี่ยนเครื่อง" : "ตั้งค่าเครื่องพิมพ์"}
                </button>
              ) : (
                <span style={{ fontSize: 13, color: "#888" }}>
                  เบราว์เซอร์นี้ไม่รองรับ WebUSB — จะพิมพ์ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์แทน
                </span>
              )}
              {/* เดิมตรงนี้เป็นปุ่มเปิดลิ้นชักเปล่า ๆ ซึ่งเปิดได้โดยไม่มีบันทึกอะไรเลย —
                  เป็นรูที่ทำให้การนับปิดตากับบันทึก no-sale ไร้ความหมาย
                  ย้ายไปแท็บกะ ซึ่งบังคับเหตุผล + PIN ก่อนเปิด (8.0) */}
              {printerReady && (
                <button onClick={() => setTab("shift")} style={{ padding: "8px 14px", fontSize: 13 }}>
                  เปิดลิ้นชัก → ไปที่แท็บกะ
                </button>
              )}
              {/* จอลูกค้า (8.6) — เปิดเป็นหน้าต่างใหม่แล้วลากไปจอที่สอง
                  ใช้ BroadcastChannel จึงต้องเป็นเบราว์เซอร์เดียวกัน ไม่ใช่เครื่องอื่น */}
              <button
                onClick={() => window.open("/pos/display", "bms-pos-display", "width=1024,height=768")}
                style={{ padding: "8px 14px", fontSize: 13 }}
                title="เปิดหน้าต่างสำหรับจอที่หันไปทางลูกค้า"
              >
                เปิดจอลูกค้า
              </button>
              <button onClick={() => void loadLastReceiptFromServer()} style={{ padding: "8px 14px", fontSize: 13 }}>
                โหลดบิลล่าสุดจากเซิร์ฟเวอร์
              </button>
              {receipt && (
                <button onClick={() => setReceiptModalOpen(true)} style={{ padding: "8px 14px", fontSize: 13 }}>
                  ดูใบเสร็จล่าสุด
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>เครื่องขาย</div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.9 }}>
              <div>{session?.location?.name ?? "—"} · สาขา {session?.location?.branchCode ?? "—"}</div>
              <div>{session?.device.code}{session?.device.registeredPosNo ? ` · POS#${session.device.registeredPosNo}` : ""}</div>
            </div>
            <button onClick={unpair} style={{ padding: "8px 14px", fontSize: 13, marginTop: 8 }}>
              เลิกจับคู่เครื่องนี้
            </button>
          </div>
        </div>
      )}

      {tab === "sell" && (<>
          {/* บิลที่พักไว้ (7.97) — โผล่เฉพาะตอนมีจริง ไม่กินที่ตอนไม่มี
              แถวเดียวต่อบิล กดที่ชื่อ = เรียกกลับ ปุ่ม ✕ = ทิ้ง */}
          {parked.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--pos-muted)" }}>บิลที่พักไว้ ({parked.length})</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {parked.map((row) => (
                  <div key={row.id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    border: "1px solid var(--pos-line)", borderRadius: 8, padding: "4px 6px 4px 10px",
                  }}>
                    <button
                      type="button"
                      onClick={() => void doResumeParked(row.id)}
                      style={{ background: "none", border: "none", padding: 0, fontSize: 13, cursor: "pointer" }}
                    >
                      {row.label} · {row.itemCount} ชิ้น · ฿{baht(row.subtotalHint)}
                    </button>
                    <button
                      type="button"
                      aria-label={`ทิ้งบิลพัก ${row.label}`}
                      onClick={() => void doDropParked(row.id)}
                      className="pos-btn-ghost"
                      style={{ padding: "2px 8px" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* ช่องเดียวจบ: เดิมมี "ยิงบาร์โค้ด" กับ "ค้นชื่อสินค้า" แยกกัน ซึ่งทับกัน
              ตั้งแต่ช่องยิงรับ SKU ได้ด้วย — พนักงานใหม่ลังเลว่าพิมพ์ช่องไหน
              ตอนนี้: พิมพ์ไปก็ค้นชื่อให้ไปด้วย · Enter = ตีความเป็นบาร์โค้ด/รหัสตรง ๆ */}
          <div className="pos-scan">
          <ScanBarcodeIcon />
          <input
            ref={scanRef}
            autoFocus
            value={scanCode}
            onChange={(e) => {
              setScanCode(e.target.value);
              setSearchTerm(e.target.value);
            }}
            onKeyDown={(e) => {
              // เครื่องสแกนเป็นคีย์บอร์ด: ยิงเสร็จมันเคาะ Enter ให้เอง
              if (e.key === "Enter") {
                enqueueScan(scanCode, "manual");
                setSearchTerm("");
              }
            }}
            placeholder={
              lookupMode
                ? "เช็คของ — ยิงบาร์โค้ด หรือพิมพ์ชื่อ/รหัสสินค้า"
                : "ยิงบาร์โค้ด หรือพิมพ์ชื่อ/รหัสสินค้า แล้วกด Enter"
            }
          />
          {/* โหมดเทส — ไม่มีเครื่องสแกนจริงก็ยังทดสอบขายได้ด้วยกล้องมือถือ
              โผล่เฉพาะเบราว์เซอร์ที่รองรับจริง (เช็คหลัง mount ใน cameraScan.ts)
              ไอคอนล้วนทรงกลม: แยกจากกรอบสี่เหลี่ยมของช่องยิงให้อ่านเป็นปุ่มคนละหน้าที่
              จุดส้มมุมบน = ยังเป็นของทดลอง (ส้ม = ต้องดู ตามสีสื่อความหมายของจอนี้) */}
          {cameraSupported && (
            <button
              type="button"
              onClick={() => {
                setCameraError("");
                setCameraModalOpen(true);
              }}
              title="สแกนด้วยกล้องมือถือ (โหมดเทส)"
              aria-label="สแกนด้วยกล้องมือถือ (โหมดเทส)"
              className="pos-cam-btn"
            >
              <span aria-hidden="true" className="pos-cam-dot" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
                <circle cx="12" cy="13" r="3.2" />
              </svg>
            </button>
          )}
          </div>
          {(searching || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {searching && <div style={{ fontSize: 12, color: "#666" }}>กำลังค้นสินค้า…</div>}
              {!searching && searchResults.length === 0 && searchTerm.trim().length >= 2 && (
                <div style={{ fontSize: 12, color: "#999" }}>ไม่พบสินค้าที่พร้อมขายจากคำค้นนี้</div>
              )}
              {searchResults.map((item) => (
                <button
                  key={item.sku}
                  onClick={() => {
                    const sizes = item.availableSizes.filter((v) => v.available > 0);
                    if (sizes.length === 1) {
                      enqueueScan(item.sku, "manual", sizes[0].size);
                      setScanCode("");
                      setSearchTerm("");
                      setSearchResults([]);
                    }
                  }}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 8,
                    background: "#fafafa",
                    padding: "10px 12px",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {item.sku} · ฿{baht(item.price)} · เหลือ {item.availableTotal}
                    {item.availableSizes.length > 0
                      ? ` · ${item.availableSizes.map((v) => `${v.size}:${v.available}`).join(" / ")}`
                      : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {item.availableSizes.filter((v) => v.available > 0).map((variant) => (
                      <span
                        key={`${item.sku}-${variant.size}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          enqueueScan(item.sku, "manual", variant.size);
                          setScanCode("");
                          setSearchTerm("");
                          setSearchResults([]);
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid #d9d9d9",
                          fontSize: 12,
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        {variant.size} ({variant.available})
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => { setLookupMode((v) => !v); setLookup(null); scanRef.current?.focus(); }}
              style={{
                padding: "6px 14px", fontSize: 13, borderRadius: 6,
                background: lookupMode ? "#faad14" : "#fff",
                color: lookupMode ? "#fff" : "#000",
                border: "1px solid #d9d9d9",
              }}
            >
              {lookupMode ? "โหมดเช็คของ (ยิงแล้วไม่เข้าตะกร้า)" : "เช็คของ"}
            </button>
            <span style={{ fontSize: 13, color: "#666" }}>
              {cart.length === 0 ? "ยังไม่มีรายการ" : `${cart.length} รายการในตะกร้า`}
            </span>
          </div>

          {lookup && (
            <div style={{ marginTop: 10, border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{lookup.productName}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                {lookup.sku}
                {lookup.size && lookup.size !== "-" ? ` · ไซซ์ ${lookup.size}` : ""} · {lookup.unitName}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 20, alignItems: "baseline" }}>
                <span style={{ fontSize: 20, fontWeight: 500 }}>฿{baht(lookup.packPrice)}</span>
                <span style={{ fontSize: 15, color: lookup.available > 0 ? "#237804" : "#a8071a" }}>
                  {lookup.available > 0 ? `เหลือ ${lookup.available}` : "หมด"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {lookup.available > 0 && (
                  <button
                    onClick={() => {
                      const key = `${lookup.sku}__${lookup.size}__${lookup.packCode}`;
                      setCart((cur) => addScanHitToCart(cur, lookup, key));
                      setLookup(null);
                      setLookupMode(false);
                      scanRef.current?.focus();
                    }}
                    style={{ padding: "8px 16px" }}
                  >
                    เพิ่มลงตะกร้า
                  </button>
                )}
                <button onClick={() => setLookup(null)} style={{ padding: "8px 16px" }}>ปิด</button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {cart.map((l) => (
              <div key={l.key} className="pos-line-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pos-line-name">
                    <span>{l.receiptName}</span>
                    {/* ไซซ์ต้องเห็นเสมอ: สินค้าตัวเดียวกันคนละไซซ์ (10 เม็ด / 100 เม็ด)
                        เคยแสดงเหมือนกันทุกอย่างจนดูเป็นรายการซ้ำ และหยิบผิดขวดได้ */}
                    {l.size && l.size !== "-" && (
                      /* ไซซ์สลับสีตาม sku+size ให้สองไซซ์ของยาตัวเดียวกันไม่ซ้ำสี */
                      <span className={`pos-badge${l.size.length % 2 === 0 ? " pos-badge--alt" : ""}`}>
                        {l.size}
                      </span>
                    )}
                  </div>
                  <div className="pos-line-meta">
                    {promoBySku.has(variantPricingKey(l.sku, l.size)) && l.baseQty <= 1 ? (
                    <>
                      โปรโมชัน · {promoBySku.get(variantPricingKey(l.sku, l.size))!.freeQty > 0
                        ? `ได้ฟรี ${promoBySku.get(variantPricingKey(l.sku, l.size))!.freeQty} ${l.unitName}`
                        : `ประหยัด ฿${baht(promoBySku.get(variantPricingKey(l.sku, l.size))!.saved)}`}
                      {promoBySku.get(variantPricingKey(l.sku, l.size))!.saved === 0 && " (ยังไม่ครบเงื่อนไข)"}
                    </>
                  ) : tierPriceByKey.has(l.key) ? (
                      <>
                        <span style={{ textDecoration: "line-through", opacity: 0.6 }}>฿{baht(l.packPrice)}</span>{" "}
                        ฿{baht(tierPriceByKey.get(l.key)!)} × {l.packQty} {l.unitName} · ราคาส่ง
                      </>
                    ) : (
                      <>฿{baht(l.packPrice)} × {l.packQty} {l.unitName} · เหลือ {l.available}</>
                    )}
                  </div>
                  {/* เลขเครื่อง (8.3) — กางเฉพาะสินค้าที่เปิดโหมดนี้
                      หนึ่งช่องต่อหนึ่งชิ้น เพราะพนักงานยิงกล่องทีละใบ ไม่ใช่พิมพ์รวมกัน
                      ช่องที่ยังว่างเห็นได้ทันทีว่าเหลืออีกกี่กล่องต้องยิง */}
                  {l.serialTracked && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                      {Array.from({ length: l.packQty * l.baseQty }).map((_, i) => (
                        <input
                          key={i}
                          value={l.serials?.[i] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value.trim();
                            setCart((cur) => cur.map((row) => {
                              if (row.key !== l.key) return row;
                              const next = [...(row.serials ?? [])];
                              next[i] = value;
                              return { ...row, serials: next };
                            }));
                          }}
                          placeholder={`เลขเครื่องชิ้นที่ ${i + 1}`}
                          style={{ padding: "6px 8px", fontSize: 12 }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="pos-qty">
                  <button onClick={() => changeQty(l.key, -1)} aria-label="ลดจำนวน">−</button>
                  <span className="pos-qty-value">{l.packQty}</span>
                  <button onClick={() => changeQty(l.key, 1)} aria-label="เพิ่มจำนวน">+</button>
                </div>
                <div className="pos-line-amount">
                  {/* โปรแสดงยอดรวมครั้งเดียวต่อ SKU+ไซซ์ */}
                  {promoBySku.has(variantPricingKey(l.sku, l.size)) && l.baseQty <= 1
                    ? (cart.findIndex((x) => x.sku === l.sku && x.size === l.size) === cart.indexOf(l)
                        ? `฿${baht(promoBySku.get(variantPricingKey(l.sku, l.size))!.amount)}`
                        : "—")
                    : `฿${baht((tierPriceByKey.get(l.key) ?? l.packPrice) * l.packQty)}`}
                </div>
              </div>
            ))}
          </div>
      </>)}

      {/* บิลเก่าอยู่แท็บ "คืน" — ตะกร้าที่กำลังขายไม่ถูกดันหาย และคอลัมน์ขวา
          (ยอด + ปุ่มชำระ) ยังอยู่ที่เดิม กดจ่ายให้ลูกค้าคนแรกได้ระหว่างค้นบิลคืนของ */}
      {tab === "returns" && (<>
          {recentReceipts.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--pos-line)", paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <button
                  onClick={() => setRecentOpen((v) => !v)}
                  style={{ padding: "6px 12px", fontSize: 12, minHeight: 36 }}
                >
                  {recentOpen ? "▾" : "▸"} บิลล่าสุด ({recentReceipts.length})
                </button>
                <input
                  value={recentSalesQuery}
                  onChange={(e) => setRecentSalesQuery(e.target.value)}
                  placeholder="ค้นเลขบิล / order id"
                  style={{ padding: "8px 10px", fontSize: 13, width: 200 }}
                />
              </div>
              <div style={{ display: recentOpen ? "flex" : "none", flexDirection: "column", gap: 6 }}>
                {recentReceipts.map((row, idx) => {
                  // บิลที่คืนครบทุกชิ้นแล้วแต่สถานะยังเป็น COMPLETED ก็ไม่มีอะไรให้คืนต่อ
                  const canReturn =
                    Boolean(row.orderId) &&
                    row.orderStatus !== "RETURNED" &&
                    row.lines.some((line) => (line.refundablePackQty ?? 0) > 0);
                  const panelOpen = canReturn && returnPanelOrderId === row.orderId;
                  // void = ยางลบของกะนี้ ไม่ใช่ประตูลบยอดขายย้อนหลัง (server บังคับซ้ำอีกชั้น)
                  const canVoid =
                    Boolean(row.orderId) &&
                    !row.voidedAt &&
                    row.orderStatus !== "RETURNED" &&
                    Boolean(session?.shift) &&
                    row.shiftId === session?.shift?.id;
                  return (
                  <div
                    key={row.orderId ?? `recent-${idx}`}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 8,
                      background: "#fafafa",
                      padding: "10px 12px",
                      textAlign: "left"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 500, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span>{row.docNo ?? row.orderId ?? "บิล POS"}</span>
                          {row.orderStatus && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: row.voidedAt ? "#f0f0f0" : row.orderStatus === "RETURNED" ? "#fdecea" : "#edf7ed",
                                color: row.voidedAt ? "#555" : row.orderStatus === "RETURNED" ? "#611a15" : "#1e4620",
                              }}
                            >
                              {/* ยกเลิก ≠ คืนแล้ว — คนอ่านรายงานต้องแยกออกตั้งแต่ตรงนี้ */}
                              {row.voidedAt ? "ยกเลิกแล้ว" : row.orderStatus === "RETURNED" ? "คืนแล้ว" : "สำเร็จ"}
                            </span>
                          )}
                        </div>
                        {/* ย่อเหลือบรรทัดเดียว — รายการบิลมีไว้ให้ "หาบิลเจอ" ไม่ใช่ให้อ่านทั้งใบ
                            เลขอ้างอิงการชำระเงินอ่านได้ในใบเสร็จ ไม่ต้องกินที่ตรงนี้ */}
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.at} · {row.paymentLabel} · {row.lines.slice(0, 2).map((line) => `${line.packQty}× ${line.receiptName}`).join(" · ")}
                          {row.lines.length > 2 ? ` · +${row.lines.length - 2}` : ""}
                        </div>
                      </div>
                      <strong>฿{baht(row.total)}</strong>
                    </div>
                    {/* ฟอร์มคืนสินค้ากางเฉพาะบิลที่กดเปิด และเปิดได้ทีละใบ
                        เดิมกางทุกใบตลอดเวลา — 3 บิลก็เลื่อนจอหาไม่เจอแล้ว */}
                    {panelOpen && (
                      <div style={{ marginTop: 8, borderTop: "1px dashed #ddd", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) minmax(0, 1fr)", gap: 6 }}>
                          <select
                            value={returnReasonCodes[row.orderId!] ?? ""}
                            onChange={(e) => setReturnReasonCodes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                            style={{ padding: 8, fontSize: 12, minHeight: 38 }}
                          >
                            <option value="">เลือกประเภทเหตุผล</option>
                            {RETURN_REASON_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                          </select>
                          <input
                            value={returnNotes[row.orderId!] ?? ""}
                            onChange={(e) => setReturnNotes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                            placeholder="รายละเอียดเหตุผล (บังคับ)"
                            style={{ width: "100%", padding: 8, fontSize: 12, minHeight: 38 }}
                          />
                        </div>
                        {row.lines
                          .filter((line) => (line.refundablePackQty ?? 0) > 0 && line.orderItemId)
                          .map((line) => {
                            const selected = Number(returnDrafts[row.orderId!]?.[line.orderItemId!] ?? 0);
                            const maxQty = Number(line.refundablePackQty ?? 0);
                            return (
                              <div
                                key={`${row.orderId}-${line.orderItemId}`}
                                style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", gap: 8, alignItems: "center" }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12 }}>{line.receiptName}</div>
                                  <div style={{ fontSize: 11, color: "#777" }}>
                                    คืนได้อีก {maxQty} / คืนแล้ว {line.returnedPackQty ?? 0}
                                  </div>
                                </div>
                                <button
                                  onClick={() => updateReturnDraft(row.orderId!, line.orderItemId!, selected - 1, maxQty)}
                                  style={{ padding: "6px 12px", fontSize: 14, minHeight: 34 }}
                                  aria-label={`ลดจำนวนคืน ${line.receiptName}`}
                                >
                                  −
                                </button>
                                <div style={{ minWidth: 24, textAlign: "center", fontSize: 13, fontWeight: 500 }}>{selected}</div>
                                <button
                                  onClick={() => updateReturnDraft(row.orderId!, line.orderItemId!, selected + 1, maxQty)}
                                  style={{ padding: "6px 12px", fontSize: 14, minHeight: 34 }}
                                  aria-label={`เพิ่มจำนวนคืน ${line.receiptName}`}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        <div style={{ fontSize: 12, color: "#8a6100" }}>
                          ยอดคืนประมาณ ฿{baht(getPartialRefundPreview(row))}
                        </div>
                        {/* เหตุผล/หมายเหตุใช้ช่องเดียวกันทั้งคืนบางรายการและคืนทั้งบิล
                            (เป็น state ตัวเดียวกันมาแต่แรก — เดิมวาดซ้ำสองชุดโดยไม่จำเป็น) */}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            onClick={() => void partialReturnReceipt(row)}
                            disabled={busy || getPartialRefundPreview(row) <= 0}
                            style={{ padding: "8px 12px", fontSize: 12, minHeight: 38 }}
                          >
                            คืนบางรายการ
                          </button>
                          <button
                            onClick={() => void returnReceipt(row.orderId!)}
                            disabled={busy}
                            style={{ padding: "8px 12px", fontSize: 12, minHeight: 38 }}
                          >
                            คืนทั้งบิล
                          </button>
                          <button
                            onClick={() => startExchangeFromReceipt(row)}
                            style={{ padding: "8px 12px", fontSize: 12, minHeight: 38 }}
                          >
                            ทำบิลเปลี่ยนสินค้า
                          </button>
                        </div>
                      </div>
                    )}
                    {(row.refunds ?? []).some((refund) => refund.status === "PENDING") && (
                      <div style={{ marginTop: 8, borderTop: "1px dashed #d48806", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#8a6100" }}>
                          รอยืนยันคืนเงินจริง
                        </div>
                        {(row.refunds ?? []).filter((refund) => refund.status === "PENDING").map((refund) => (
                          <div className="pos-refund-row" key={refund.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(120px,1fr) auto", gap: 8, alignItems: "center" }}>
                            <div style={{ fontSize: 12 }}>
                              {METHODS.find((method) => method.key === refund.method)?.label ?? refund.method} · ฿{baht(refund.amount)}
                            </div>
                            <input
                              value={settlementRefs[refund.id] ?? ""}
                              onChange={(event) => setSettlementRefs((cur) => ({ ...cur, [refund.id]: event.target.value }))}
                              placeholder="เลขอ้างอิงการคืนเงินจริง"
                              style={{ padding: 7, fontSize: 12 }}
                            />
                            <button
                              onClick={() => void completeRefundSettlement(row, refund)}
                              disabled={busy}
                              style={{ padding: "7px 10px", fontSize: 12 }}
                            >
                              ยืนยันคืนแล้ว
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={() => {
                          setReceipt(row);
                          setReceiptModalOpen(true);
                          window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(row));
                        }}
                        style={{ padding: "8px 12px", fontSize: 12, minHeight: 38 }}
                      >
                        ดู/พิมพ์
                      </button>
                      {canReturn && (
                        <button
                          onClick={() =>
                            setReturnPanelOrderId((cur) => (cur === row.orderId ? null : row.orderId ?? null))
                          }
                          style={{ padding: "8px 12px", fontSize: 12, minHeight: 38 }}
                        >
                          {panelOpen ? "▾ คืน/เปลี่ยนสินค้า" : "▸ คืน/เปลี่ยนสินค้า"}
                        </button>
                      )}
                      {!canReturn && (
                        <span style={{ fontSize: 12, color: "#999", alignSelf: "center" }}>
                          {row.voidedAt ? "ยกเลิกบิลแล้ว"
                            : row.orderStatus === "RETURNED" ? "คืนแล้วทั้งบิล"
                            : "คืนครบทุกรายการแล้ว"}
                        </span>
                      )}
                      {/* ยกเลิกบิล (7.97) — เฉพาะบิลในกะที่ยังเปิดและยังไม่เคยคืน/ยกเลิก
                          บิลของกะที่ปิดไปแล้วต้องเดินทางการคืนสินค้าแทน เพราะเงินถูกนับส่งไปแล้ว */}
                      {canVoid && (
                        <button
                          onClick={() => setVoidTarget((cur) => (cur === row.orderId ? null : row.orderId ?? null))}
                          style={{ padding: "8px 12px", fontSize: 12, minHeight: 38, color: "#c9455a" }}
                        >
                          ยกเลิกบิล
                        </button>
                      )}
                    </div>
                    {canVoid && voidTarget === row.orderId && (
                      <div style={{
                        marginTop: 8, padding: 10, borderRadius: 8,
                        background: "#fff4f5", border: "1px solid #f2d0d4",
                        display: "flex", flexDirection: "column", gap: 8,
                      }}>
                        <div style={{ fontSize: 12, color: "#611a15" }}>
                          ยกเลิกบิลนี้: ของกลับเข้าสต็อก เงินคืนลูกค้า แต้มถูกดึงคืน และใบกำกับถูกยกเลิก
                          (เลขใบยังอยู่ในลำดับ ไม่ได้ถูกลบ)
                        </div>
                        <input
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          maxLength={200}
                          placeholder="เหตุผล เช่น สแกนซ้ำ / กดผิดคน"
                          style={{ padding: 9, fontSize: 13 }}
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <select value={voidApproverId} onChange={(e) => setVoidApproverId(e.target.value)}
                                  style={{ padding: 9, fontSize: 13, minWidth: 170 }}>
                            <option value="">— ผู้อนุมัติ —</option>
                            {(session?.cashiers ?? []).filter((c) => c.hasPin).map((c) => (
                              <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                            ))}
                          </select>
                          <input type="password" inputMode="numeric" value={voidApproverPin}
                                 onChange={(e) => setVoidApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                                 placeholder="PIN หัวหน้า" style={{ padding: 9, fontSize: 13, width: 120 }} />
                          <button onClick={() => void doVoidSale(row.orderId!)} disabled={busy}
                                  style={{ padding: "9px 16px", fontSize: 13 }}>
                            ยืนยันยกเลิก
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {recentReceipts.length === 0 && recentSalesQuery.trim().length > 0 && (
            <div style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
              ไม่พบบิลที่ตรงกับคำค้นนี้
            </div>
          )}
          {recentReceipts.length === 0 && recentSalesQuery.trim().length === 0 && (
            <div style={{ marginTop: 16, fontSize: 13, color: "#999" }}>
              ยังไม่มีบิลของเครื่องนี้ในกะนี้
            </div>
          )}
      </>)}
        </section>

        <section className="pos-card pos-pane" style={{ display: "flex", flexDirection: "column" }}>
          <div className="pos-total">
            <div className="pos-total-row">
              <span style={{ fontSize: 13, color: "var(--pos-muted)" }}>ยอดชำระ · {itemCount} ชิ้น</span>
              <span className="pos-total-value">฿{baht(amountDue)}</span>
            </div>
            {/* ค่าบริการต้องเห็นแยกบรรทัด ไม่ใช่กลืนไปในยอดรวม — ลูกค้าถามได้ว่าคิดอะไรเพิ่ม */}
            {extraTotal > 0 && (
              <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
                {extraLines
                  .filter((x) => x.label.trim() && Number(x.unitAmount) > 0)
                  .map((x, i) => (
                    <div key={i}>{x.label.trim()} +฿{baht(Number(x.unitAmount))}</div>
                  ))}
              </div>
            )}
            {/* ส่วนลดต้องเห็นแยกบรรทัดที่จอ ลูกค้าถามได้ว่าลดจากอะไร (7.96) */}
            {discountTotal > 0 && (
              <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
                <span>ยอดสินค้า ฿{baht(total)}</span>
                {memberPreview?.tierDiscount ? (
                  <div>{memberPreview.tierLabel ?? "ส่วนลดสมาชิก"} −฿{baht(memberPreview.tierDiscount)}</div>
                ) : null}
                {memberPreview?.couponDiscount ? (
                  <div>คูปอง {couponCode.trim().toUpperCase()} −฿{baht(memberPreview.couponDiscount)}</div>
                ) : null}
                {memberPreview?.pointsDiscount ? (
                  <div>แลก {memberPreview.pointsUsed} แต้ม −฿{baht(memberPreview.pointsDiscount)}</div>
                ) : null}
                {memberPreview?.manualDiscount ? (
                  <div>
                    ส่วนลดหน้าร้าน −฿{baht(memberPreview.manualDiscount)}
                    <span style={{ color: "var(--pos-muted)" }}> · อนุมัติโดย {approvedDiscount?.approverName ?? "—"}</span>
                  </div>
                ) : null}
                {memberPreview?.capped && <div style={{ color: "#c9455a" }}>ส่วนลดถูกตัดเพราะชนเพดานของร้าน</div>}
              </div>
            )}
            {/* ปัดเศษต้องเห็นบนจอ ไม่ใช่โผล่มาเฉพาะบนใบเสร็จ — ลูกค้าถามว่าทำไมไม่ตรงป้าย */}
            {roundingDelta !== 0 && (
              <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
                <span>ยอดก่อนปัดเศษ ฿{baht(payableBeforeRounding)} · ปัดเศษเงินสด {roundingDelta > 0 ? "+" : "−"}฿{baht(Math.abs(roundingDelta))}</span>
              </div>
            )}
            {/* คูปอง — แยกจากแถบสมาชิกเพราะใช้ได้ทั้งลูกค้าทั่วไปและสมาชิก
                กฎของโค้ดตรวจที่ server ทั้งหมด จอไม่คิด % เอง */}
            <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  placeholder="โค้ดส่วนลด"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}
                />
                {couponCode !== "" && (
                  <button type="button" className="pos-btn-ghost" onClick={() => setCouponCode("")}>
                    ล้าง
                  </button>
                )}
              </div>
              {couponCode.trim() !== "" && memberPreview?.couponError && (
                <span style={{ fontSize: 12, color: "#c9455a" }}>{memberPreview.couponError}</span>
              )}
              {couponCode.trim() !== "" && !memberPreview?.couponError && (memberPreview?.couponDiscount ?? 0) > 0 && (
                <span style={{ fontSize: 12, color: "#12805c" }}>
                  ใช้โค้ดได้ −฿{baht(memberPreview!.couponDiscount)}
                </span>
              )}
            </div>
            {/* ส่วนลดหน้าร้าน — ชั้นที่ 4 ต่อจาก tier/คูปอง/แต้ม ทุกบาทต้องมีหัวหน้ากด PIN
                ปุ่มยุบไว้เพราะบิลส่วนใหญ่ไม่มีส่วนลดมือ กางเฉพาะตอนจะใช้ */}
            <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
              {approvedDiscount ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                  <span style={{ fontSize: 12 }}>
                    ส่วนลดหน้าร้าน ฿{baht(approvedDiscount.amount)} · {approvedDiscount.reason}
                  </span>
                  <button
                    type="button"
                    className="pos-btn-ghost"
                    style={{ marginLeft: "auto" }}
                    onClick={clearManualDiscount}
                  >
                    เอาออก
                  </button>
                </div>
              ) : !discountOpen ? (
                <button
                  type="button"
                  className="pos-btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => { setDiscountOpen(true); setDiscountError(null); }}
                >
                  + ส่วนลดหน้าร้าน (ต้องมีหัวหน้าอนุมัติ)
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      inputMode="decimal"
                      placeholder="จำนวนเงิน"
                      value={discountDraft}
                      onChange={(e) => setDiscountDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                      style={{ width: 110 }}
                    />
                    <input
                      placeholder="เหตุผล (บังคับ)"
                      value={discountReasonDraft}
                      maxLength={200}
                      onChange={(e) => setDiscountReasonDraft(e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {/* เฉพาะคนที่ตั้ง PIN แล้ว — คนที่ไม่มี PIN อนุมัติไม่ได้อยู่แล้วที่ server */}
                    <select
                      value={discountApproverId}
                      onChange={(e) => setDiscountApproverId(e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <option value="">— ผู้อนุมัติ —</option>
                      {(session?.cashiers ?? []).filter((c) => c.hasPin).map((c) => (
                        <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.id}</option>
                      ))}
                    </select>
                    <input
                      type="password"
                      inputMode="numeric"
                      placeholder="PIN หัวหน้า"
                      value={discountApproverPin}
                      onChange={(e) => setDiscountApproverPin(e.target.value.replace(/[^0-9]/g, ""))}
                      style={{ width: 110 }}
                    />
                  </div>
                  {discountError && <span style={{ fontSize: 12, color: "#c9455a" }}>{discountError}</span>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="pos-btn-primary" style={{ flex: 1 }} onClick={applyManualDiscount}>
                      ใช้ส่วนลด
                    </button>
                    <button type="button" className="pos-btn-ghost" onClick={clearManualDiscount}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* แถบสมาชิก — วางบนแผงชำระเงินเพราะพนักงานถามลูกค้าตอนกำลังจะรับเงิน */}
            <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
              {member ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* ชั้นสมาชิกเป็น badge — อ่านแวบเดียวได้ ไม่ต้องอ่านทั้งบรรทัด
                      "เอาออก" ชิดขวาด้วย margin-left:auto ไม่ใช่ space-between เพราะ
                      .pos-total-break เป็น flex อยู่แล้ว div ลูกจึงไม่กว้างเต็มแถว */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {member.tier && (
                      <span
                        style={{
                          flex: "none", border: "1px solid var(--pos-line)", borderRadius: 6,
                          padding: "2px 8px", fontSize: 12, color: "var(--pos-muted)",
                        }}
                      >
                        {member.tier.name}
                      </span>
                    )}
                    <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {member.name}
                    </strong>
                    {member.memberNo && (
                      <span style={{ flex: "none", fontSize: 12, color: "var(--pos-muted)" }}>{member.memberNo}</span>
                    )}
                    <button
                      type="button"
                      onClick={clearMember}
                      style={{
                        marginLeft: "auto", flex: "none", background: "none", border: "none",
                        borderBottom: "1px solid var(--pos-line)", color: "var(--pos-muted)",
                        fontSize: 12, padding: "2px 0", cursor: "pointer",
                      }}
                    >
                      เอาออก
                    </button>
                  </div>

                  {member.pointsUsable <= 0 ? (
                    /* 0 แต้ม = ไม่มีอะไรให้กด — บอกแค่ว่าบิลนี้จะได้แต้ม */
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                      ยังไม่มีแต้มสะสม · บิลนี้จะได้แต้ม
                    </span>
                  ) : total <= 0 ? (
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                      แต้ม {member.pointsUsable} · เพิ่มสินค้าก่อนจึงแลกได้
                    </span>
                  ) : !redeemOpen ? (
                    /* ปุ่มเดียวที่ต้องตัดสินใจ + บอกมูลค่าล่วงหน้า พนักงานถามลูกค้าได้เลย */
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        แต้ม {member.pointsUsable}
                        {memberPreview && (
                          <span style={{ color: "var(--pos-muted)" }}>
                            {" = ลดได้ ฿"}
                            {baht(
                              Math.floor(member.pointsUsable / memberPreview.redeemPointsPerUnit)
                              * memberPreview.redeemBahtPerUnit
                            )}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="pos-btn-ghost"
                        style={{ flex: "none", padding: "9px 16px" }}
                        onClick={() => {
                          setRedeemOpen(true);
                          setPointsToRedeem(maxRedeemPoints > 0 ? String(maxRedeemPoints) : "");
                        }}
                      >
                        ใช้แต้ม
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* ปรับด้วยปุ่ม 40×40 ไม่ใช่ spinner ของ input type=number
                          ลูกศร spinner เล็กเกินกดด้วยนิ้วบนจอทัช */}
                      <button
                        type="button"
                        aria-label="ลดจำนวนแต้ม"
                        onClick={() => stepPoints(-1)}
                        style={{
                          flex: "none", width: 40, height: 40, borderRadius: 8,
                          border: "1px solid var(--pos-line)", background: "none",
                          color: "inherit", fontSize: 18, cursor: "pointer",
                        }}
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label="จำนวนแต้มที่ต้องการแลก"
                        value={pointsToRedeem}
                        placeholder="0"
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const digits = e.currentTarget.value.replace(/\D/g, "");
                          if (!digits) {
                            setPointsToRedeem("");
                            return;
                          }
                          const typed = Math.min(maxRedeemPoints, Number(digits));
                          setPointsToRedeem(String(typed));
                        }}
                        onBlur={normalizeTypedPoints}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        aria-live="polite"
                        style={{
                          flex: "none", minWidth: 96, textAlign: "center", padding: "9px 0",
                          borderRadius: 8, border: "1px solid var(--pos-accent)",
                          background: "var(--pos-surface)", color: "inherit",
                          fontSize: 17, fontVariantNumeric: "tabular-nums",
                        }}
                      />
                      <button
                        type="button"
                        aria-label="เพิ่มจำนวนแต้ม"
                        onClick={() => stepPoints(1)}
                        style={{
                          flex: "none", width: 40, height: 40, borderRadius: 8,
                          border: "1px solid var(--pos-line)", background: "none",
                          color: "inherit", fontSize: 18, cursor: "pointer",
                        }}
                      >
                        +
                      </button>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--pos-muted)" }}>
                        จาก {member.pointsUsable} แต้ม
                        {memberPreview?.pointsDiscount ? ` · ลด ฿${baht(memberPreview.pointsDiscount)}` : ""}
                        {(memberPreview?.pointsUsed ?? 0) > 0
                          ? ` · คงเหลือ ${Math.max(0, member.pointsUsable - memberPreview!.pointsUsed)} แต้ม`
                          : ""}
                      </span>
                      <button
                        type="button"
                        className="pos-btn-ghost"
                        style={{ flex: "none", padding: "9px 13px", fontSize: 13 }}
                        onClick={() => setPointsToRedeem(maxRedeemPoints > 0 ? String(maxRedeemPoints) : "")}
                      >
                        ทั้งหมด
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRedeemOpen(false); setPointsToRedeem(""); }}
                        style={{
                          flex: "none", background: "none", border: "none",
                          borderBottom: "1px solid var(--pos-line)", color: "var(--pos-muted)",
                          fontSize: 13, padding: "2px 0", cursor: "pointer",
                        }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}

                  {member.pointsBalance < 0 && (
                    <span style={{ fontSize: 12, color: "#c9455a" }}>
                      แต้มติดลบ {member.pointsBalance} (จากการคืนสินค้า) — แต้มที่ได้ครั้งถัดไปจะกลบยอดนี้ก่อน
                    </span>
                  )}
                </div>
              ) : (
                /* ค้นสมาชิกอยู่ในแผงนี้ตรง ๆ ไม่ใช่ modal — พนักงานต้องเห็นยอดบิล
                   ตลอดเวลาที่คุยกับลูกค้า และการค้นเกิดขึ้นทุกบิล ต้องไม่มีขั้นเปิด/ปิด */
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      placeholder="เบอร์โทร / เลขสมาชิก"
                      value={memberQuery}
                      onChange={(e) => { setMemberQuery(e.target.value); void searchMember(e.target.value); }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button
                      type="button"
                      className="pos-btn-ghost"
                      onClick={() => openEnroll(memberQuery)}
                    >
                      สมัคร
                    </button>
                  </div>
                  {memberSearching && <span style={{ color: "var(--pos-muted)" }}>กำลังค้น…</span>}
                  {memberResults.map((hit) => (
                    <button
                      key={hit.customerId}
                      type="button"
                      onClick={() => { setMember(hit); setPointsToRedeem(""); setMemberResults([]); setMemberQuery(""); }}
                      style={{
                        textAlign: "left", padding: "6px 8px", borderRadius: 8,
                        border: "1px solid var(--pos-line)", background: "transparent",
                        color: "inherit", cursor: "pointer",
                      }}
                    >
                      <strong>{hit.name}</strong>
                      {hit.tier ? ` · ${hit.tier.name}` : ""}
                      <div style={{ color: "var(--pos-muted)" }}>
                        {hit.memberNo} · {hit.phone ?? "ไม่มีเบอร์"} · {hit.pointsUsable} แต้ม
                      </div>
                    </button>
                  ))}
                  {memberQuery.trim().length >= 3 && memberResults.length === 0 && !memberSearching && (
                    <span style={{ color: "var(--pos-muted)" }}>ไม่พบสมาชิก — กด “สมัคร” เพื่อเปิดสมาชิกใหม่</span>
                  )}
                </div>
              )}
            </div>
            {session?.vat.registered && (
              <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
                <span>ราคารวม VAT {session.vat.rate}% แล้ว</span>
              </div>
            )}
          </div>

          {justSold && (
            <div className="pos-success" style={{ marginTop: 12 }}>
              <div className="pos-success-head">
                <span aria-hidden="true">✓</span>
                <span>ขายสำเร็จ{justSold.docNo ? ` · ${justSold.docNo}` : ""}</span>
              </div>

              {/* จ่ายพอดี (เงินทอน 0) ต้องไม่ขึ้นเลข 0 ตัวเบ้อเร่อ — ตะกร้าเพิ่งถูกล้าง
                  ยอดข้างบนก็เป็น 0 อยู่แล้ว ทั้งจอเลยอ่านเหมือนขายไม่สำเร็จ
                  เลขใหญ่ต้องเป็นสิ่งที่แคชเชียร์ต้องทำต่อ: ทอนเท่านี้ หรือรับครบแล้ว */}
              {justSold.change != null && justSold.change > 0 ? (
                <>
                  <div className="pos-success-label">ทอนเงินให้ลูกค้า</div>
                  <div className="pos-success-value">฿{baht(justSold.change)}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>ยอดบิล ฿{baht(justSold.total)}</div>
                </>
              ) : (
                <>
                  <div className="pos-success-label">รับเงินครบพอดี ไม่ต้องทอน</div>
                  <div className="pos-success-value">฿{baht(justSold.total)}</div>
                </>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                <button onClick={() => void printReceipt(true)} style={{ flex: 1 }}>พิมพ์ใบเสร็จ</button>
                <button onClick={() => setReceiptModalOpen(true)} style={{ flex: 1 }}>ดูใบเสร็จ</button>
                <button onClick={() => setJustSold(null)} aria-label="ปิด" style={{ width: 52 }}>✕</button>
              </div>

              <div className="pos-success-hint">ยิงสินค้าชิ้นถัดไปได้เลย — หน้าจอนี้จะหายเอง</div>
            </div>
          )}

          {/* วิธีจ่ายต้องเห็นตลอด — เดิมมีแต่ dropdown ที่อยู่ในฟอร์มเต็ม ซึ่งถูกซ่อน
              ตอนเป็นบิลเงินสดรายการเดียว (ค่าเริ่มต้นของทุกบิล) และปุ่มเดียวที่เปิด
              ฟอร์มนั้นได้ก็อยู่ในกล่องที่ถูกซ่อนเอง = QR/บัตร/วอลเล็ท กดไม่ถึงเลย */}
          {!justSold && payments.length === 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {METHODS.map((m) => {
                const active = payments[0]?.method === m.key;
                return (
                  <button
                    key={m.key}
                    aria-pressed={active}
                    onClick={() => {
                      setSplitMode(false);
                      updatePayment(payments[0].id, {
                        method: m.key,
                        tendered: "",
                        ref: "",
                        // เงินสดปล่อยว่างไว้ให้แป้นเงินเติมตอนกดรับเงิน
                        amount: m.key === "CASH" ? "" : amountDue > 0 ? String(amountDue) : "",
                      });
                    }}
                    style={{
                      flex: "1 1 0", minWidth: 78, minHeight: 44, padding: "8px 10px", fontSize: 14,
                      background: active ? "#e8f0fe" : undefined,
                      borderColor: active ? "#b5d4f4" : undefined,
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
              <button onClick={addPaymentRow} style={{ flex: "1 1 0", minWidth: 90, minHeight: 44, fontSize: 13 }}>
                + จ่ายผสม
              </button>
            </div>
          )}

          {/* บิลเงินสดล้วนคือ 95% ของบิล — ให้พิมพ์ช่องเดียวจบ
              ปุ่มเงินด่วนสำคัญบนจอสัมผัส: กดทีเดียวเร็วกว่าพิมพ์ตัวเลขมาก */}
          {simpleCash && !justSold && (
            <div style={{ marginTop: 12 }}>
              <div className="pos-cash-field">
                <label htmlFor="pos-cash-input">รับเงินมา</label>
                <input
                  id="pos-cash-input"
                  value={payments[0]?.tendered ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updatePayment(payments[0].id, { tendered: v, amount: amountDue > 0 ? String(amountDue) : "" });
                  }}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              <div className="pos-quick" style={{ marginTop: 8 }}>
                <button
                  onClick={() => updatePayment(payments[0].id, { tendered: String(amountDue), amount: String(amountDue) })}
                  disabled={amountDue <= 0}
                  className="pos-exact"
                >
                  พอดี
                </button>
                {[20, 50, 100, 500, 1000].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      const cur = Number(payments[0]?.tendered) || 0;
                      const next = cur + n;
                      updatePayment(payments[0].id, { tendered: String(next), amount: amountDue > 0 ? String(amountDue) : "" });
                    }}
                  >
                    +{n}
                  </button>
                ))}
                <button
                  onClick={() => updatePayment(payments[0].id, { tendered: "" })}
                  className="pos-clear"
                >
                  ล้าง
                </button>
              </div>
              {cashChangePreview != null && (
                <div className="pos-change" style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 14, color: "var(--pos-muted)" }}>เงินทอน</span>
                  <span className="pos-change-value">฿{baht(cashChangePreview)}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: simpleCash || justSold ? "none" : "flex", flexDirection: "column", gap: 8 }}>
            {payments.map((payment, index) => {
              const normalized = paymentSummary.normalized[index];
              return (
                <div
                  key={payment.id}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {/* จ่ายวิธีเดียว: วิธีเลือกจากแถบปุ่มด้านบนแล้ว และยอดต้องเท่ายอดบิล
                      เสมอ (server ปฏิเสธถ้าไม่ตรง) — ไม่ต้องมีช่องให้พิมพ์ผิด */}
                  {payments.length === 1 ? (
                    <div style={{ fontSize: 14 }}>
                      รับด้วย <strong>{METHODS.find((m) => m.key === payment.method)?.label ?? payment.method}</strong>
                      {" · "}ยอด <strong>฿{baht(amountDue)}</strong>
                    </div>
                  ) : (
                  <div className="pos-payment-row" style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) auto", gap: 8, alignItems: "center" }}>
                    <select
                      value={payment.method}
                      onChange={(e) => updatePayment(payment.id, { method: e.target.value, tendered: "", ref: "" })}
                      style={{ padding: 10, fontSize: 14 }}
                    >
                      {METHODS.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </select>
                    <input
                      value={payment.amount}
                      onChange={(e) => updatePayment(payment.id, { amount: e.target.value })}
                      inputMode="decimal"
                      placeholder="ยอดรับด้วยวิธีนี้"
                      style={{ width: "100%", padding: 10, fontSize: 14 }}
                    />
                    <button
                      onClick={() => removePaymentRow(payment.id)}
                      disabled={payments.length <= 1}
                      style={{ padding: "10px 12px", fontSize: 12 }}
                    >
                      ลบ
                    </button>
                  </div>
                  )}
                  {payment.method === "CASH" ? (
                    <div>
                      <input
                        value={payment.tendered}
                        onChange={(e) => updatePayment(payment.id, { tendered: e.target.value })}
                        inputMode="decimal"
                        placeholder="รับเงินสดมา"
                        style={{ width: "100%", padding: 10, fontSize: 14 }}
                      />
                      {normalized?.numericTendered > 0 && (
                        <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
                          เงินทอนรายการนี้ <strong>฿{baht(normalized.numericChange)}</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      value={payment.ref}
                      onChange={(e) => updatePayment(payment.id, { ref: e.target.value })}
                      placeholder="เลขอ้างอิง / approval code (ถ้ามี)"
                      style={{ width: "100%", padding: 10, fontSize: 14 }}
                    />
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {/* ตอนมีวิธีเดียว ปุ่มนี้ซ้ำกับ "+ จ่ายผสม" บนแถบด้านบนแล้ว */}
              {payments.length > 1 && (
                <button onClick={addPaymentRow} style={{ padding: "8px 12px", fontSize: 13 }}>
                  + เพิ่มวิธีจ่าย
                </button>
              )}
              <div style={{ fontSize: 13, textAlign: "right", color: paymentSummary.remaining === 0 ? "#1e4620" : "#8a6100" }}>
                รับแล้ว ฿{baht(paymentSummary.paid)} ·
                {paymentSummary.remaining > 0
                  ? ` คงเหลือ ฿${baht(paymentSummary.remaining)}`
                  : paymentSummary.remaining < 0
                    ? ` เกิน ฿${baht(Math.abs(paymentSummary.remaining))}`
                    : " ครบพอดี"}
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />
          {!justSold && (<>
          {/* ปุ่มเทาที่ยังโชว์ยอดเงินอ่านไม่ออกว่าติดอะไร — ให้มันบอกเหตุผลบนตัวเอง
              เหตุผลจริงเคยอยู่ในข้อความตัวเล็กมุมขวาซึ่งไม่มีใครมอง */}
          <button
            className="pos-pay"
            disabled={payBlockedReason !== null || busy}
            onClick={() => void pay()}
            style={{ marginTop: 12 }}
          >
            {busy ? "กำลังบันทึก…" : payBlockedReason ?? `ชำระเงิน ฿${baht(amountDue)}`}
          </button>
          <button
            disabled={hasPendingOrderWrite}
            onClick={() => {
              setCart([]);
              setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
              resetToSimpleCash();
              setScanCode("");
              setSearchTerm("");
              setSearchResults([]);
              setNotice(null);
              scanRef.current?.focus();
            }}
            style={{ marginTop: 6, padding: "10px 0", fontSize: 14 }}
          >
            ล้างบิล
          </button>
          {/* พักบิล (7.97) — ลูกค้าลืมของ/หาเงินไม่ทัน แล้วคิวข้างหลังรอ
              วางคู่กับ "ล้างบิล" เพราะเป็นทางเลือกของกันและกันตอนต้องเคลียร์เคาน์เตอร์ */}
          <button
            disabled={hasPendingOrderWrite || cart.length === 0}
            onClick={() => setParkOpen(true)}
            style={{ marginTop: 6, padding: "10px 0", fontSize: 14 }}
          >
            พักบิล
          </button>
          {/* ค่าบริการ/ค่าถุง (8.6) — ไม่ใช่สินค้าในคลัง จึงไม่อยู่ในตะกร้า
              แต่รวมในยอดที่ลูกค้าจ่ายและอยู่ในฐาน VAT เหมือนบรรทัดสินค้า
              ป้ายที่พิมพ์โผล่บนใบเสร็จ ลูกค้าจึงเห็นทุกบรรทัดที่ถูกคิด */}
          {extraLines.map((row, idx) => (
            <div key={idx} style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                value={row.label}
                onChange={(e) => setExtraLines((cur) =>
                  cur.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                placeholder="เช่น ค่าถุง"
                style={{ flex: 1, minWidth: 0, padding: "8px 10px", fontSize: 13 }}
              />
              <input
                value={row.unitAmount}
                inputMode="decimal"
                onChange={(e) => setExtraLines((cur) =>
                  cur.map((x, i) => (i === idx ? { ...x, unitAmount: e.target.value.replace(/[^0-9.]/g, "") } : x)))}
                placeholder="บาท"
                style={{ width: 78, padding: "8px 10px", fontSize: 13 }}
              />
              <button
                type="button"
                aria-label="ลบรายการค่าบริการ"
                onClick={() => setExtraLines((cur) => cur.filter((_, i) => i !== idx))}
                className="pos-btn-ghost"
                style={{ padding: "0 10px" }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            disabled={hasPendingOrderWrite}
            onClick={() => setExtraLines((cur) => [...cur, { label: "", unitAmount: "" }])}
            style={{ marginTop: 6, padding: "10px 0", fontSize: 14 }}
          >
            + ค่าบริการ / ค่าถุง
          </button>
          </>)}
        </section>
      </div>
      </div>
      {/* สมัครสมาชิก (7.96) — การค้นอยู่ในแผงชำระเงินแล้ว กล่องนี้ทำแค่การสมัคร
          ซึ่งเกิดนาน ๆ ครั้ง จึงคุ้มที่จะกินพื้นที่และมี numpad ให้กดด้วยนิ้ว
          สองขั้น (เบอร์ → ชื่อ) เพราะฟอร์มสองช่องพร้อมกันบนจอทัชกดผิดช่องบ่อย */}
      {enrollOpen && (
        <div
          // ห้ามปิดด้วยการแตะฉากหลัง — จอทัชโดนขอบง่ายมาก และการปิดจะทิ้งเบอร์ที่
          // พิมพ์ค้างไว้ทั้งหมด · ปิดได้ทางปุ่ม ✕ กับ Esc เท่านั้น
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, zIndex: 60,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="สมัครสมาชิกใหม่"
            style={{ background: "var(--pos-surface)", color: "var(--pos-text)", borderRadius: 12, width: 520, maxWidth: "100%", overflow: "hidden" }}
          >
            <div
              style={{
                padding: "10px 14px", fontSize: 13, fontWeight: 600,
                borderBottom: "1px solid var(--pos-line)",
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              }}
            >
              <span>สมัครสมาชิก · {enrollStep === "phone" ? "1/2 เบอร์โทร" : "2/2 ชื่อลูกค้า"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* บอกสถานะ PIN ตั้งแต่หัวกล่อง ไม่ให้กรอกจนจบแล้วเจอ 403 */}
                <span style={{ fontSize: 12, color: cashierId && pin ? "#12805c" : "#c9455a" }}>
                  {cashierId && pin ? "PIN พร้อม" : "ยังไม่ได้ใส่ PIN"}
                </span>
                <button
                  type="button"
                  onClick={() => setEnrollOpen(false)}
                  aria-label="ปิด"
                  style={{ background: "none", border: "none", color: "var(--pos-text)", fontSize: 16, padding: 4, lineHeight: 1 }}
                >
                  ✕
                </button>
              </span>
            </div>

            {enrollStep === "phone" ? (
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,200px)", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                  <div
                    aria-live="polite"
                    style={{
                      background: "var(--pos-sunken)", border: "1px solid #5dcaa5", borderRadius: 8,
                      padding: "10px 12px", fontSize: 22, letterSpacing: 1, minHeight: 46,
                      fontVariantNumeric: "tabular-nums", wordBreak: "break-all",
                    }}
                  >
                    {enrollPhone || <span style={{ color: "var(--pos-muted)", fontSize: 15 }}>เบอร์โทรลูกค้า</span>}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                    เบอร์นี้ใช้ค้นสมาชิกครั้งต่อไป · ลูกค้าที่เคยคุยผ่าน LINE จะถูกผูกกับข้อมูลเดิม ไม่สร้างซ้ำ
                  </span>
                  {cart.length > 0 && (
                    <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                      ค้างอยู่ในตะกร้า · {itemCount} ชิ้น ฿{baht(amountDue)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="pos-btn-ghost"
                    disabled={!/^[0-9+]{8,20}$/.test(enrollPhone)}
                    onClick={() => setEnrollStep("name")}
                    style={{ marginTop: "auto", padding: "10px 0", fontSize: 14 }}
                  >
                    ถัดไป →
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7, minWidth: 0 }}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => setEnrollPhone((cur) => (cur.length >= 20 ? cur : cur + digit))}
                      style={{
                        background: "var(--pos-surface)", border: "1px solid var(--pos-line-strong)",
                        borderRadius: 8, color: "var(--pos-text)", padding: "13px 0", fontSize: 19, cursor: "pointer",
                      }}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEnrollPhone("")}
                    style={{ background: "var(--pos-sunken)", border: "1px solid var(--pos-line)", borderRadius: 8, color: "var(--pos-muted)", padding: "13px 0", fontSize: 13, cursor: "pointer" }}
                  >
                    ล้าง
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnrollPhone((cur) => (cur.length >= 20 ? cur : cur + "0"))}
                    style={{ background: "var(--pos-surface)", border: "1px solid var(--pos-line-strong)", borderRadius: 8, color: "var(--pos-text)", padding: "13px 0", fontSize: 19, cursor: "pointer" }}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    aria-label="ลบตัวท้าย"
                    onClick={() => setEnrollPhone((cur) => cur.slice(0, -1))}
                    style={{ background: "var(--pos-sunken)", border: "1px solid var(--pos-line)", borderRadius: 8, color: "var(--pos-text)", padding: "13px 0", fontSize: 17, cursor: "pointer" }}
                  >
                    ⌫
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--pos-muted)" }}>เบอร์ {enrollPhone}</span>
                <input
                  autoFocus
                  placeholder="ชื่อลูกค้า"
                  value={enrollName}
                  onChange={(e) => setEnrollName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && cashierId && pin) void enrollMemberFromPos(); }}
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: 12, color: "var(--pos-muted)" }}>
                  เบอร์ที่มีลูกค้าเดิมอยู่แล้วจะใช้ชื่อเดิม ไม่ทับด้วยชื่อนี้
                </span>
                {/* สมัครสมาชิก = เขียน CRM จริง ต้องมีคนรับผิดชอบ (PIN) เสมอ */}
                {(!cashierId || !pin) && (
                  <span style={{ fontSize: 12, color: "#c9455a" }}>
                    เลือกผู้ขายและใส่ PIN ที่แถบด้านบนก่อน จึงสมัครสมาชิกได้
                  </span>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="pos-btn-ghost"
                    onClick={() => setEnrollStep("phone")}
                    style={{ padding: "10px 16px", fontSize: 14 }}
                  >
                    ← ย้อนกลับ
                  </button>
                  <button
                    type="button"
                    className="pos-btn-ghost"
                    onClick={() => void enrollMemberFromPos()}
                    disabled={!cashierId || !pin}
                    style={{ flex: 1, padding: "10px 0", fontSize: 14 }}
                  >
                    สมัครสมาชิก
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {cameraModalOpen && (
        <div
          onClick={() => setCameraModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="สแกนด้วยกล้องมือถือ"
            style={{
              background: "#111", color: "#fff", borderRadius: 12, width: 340, maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 14px", fontSize: 13, fontWeight: 600,
                borderBottom: "1px solid rgba(255,255,255,0.14)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <span>สแกนด้วยกล้อง (โหมดเทส)</span>
              <button
                type="button"
                onClick={() => setCameraModalOpen(false)}
                aria-label="ปิด"
                style={{ background: "none", border: "none", color: "#fff", fontSize: 16, padding: 4, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ position: "relative", background: "#000", lineHeight: 0 }}>
              {/* muted+playsInline บังคับสำหรับ autoplay บนมือถือ — ขาดตัวใดตัวหนึ่งแล้ว
                  Safari/Chrome บนมือถือจะไม่เล่นวิดีโอให้เอง */}
              <video
                ref={cameraVideoRef}
                playsInline
                muted
                style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block" }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", inset: 0, display: "flex",
                  alignItems: "center", justifyContent: "center", pointerEvents: "none",
                }}
              >
                <div style={{ width: 160, height: 160, border: "2px solid #f0a468", borderRadius: 10 }} />
              </div>
            </div>
            <div style={{ padding: "10px 14px", fontSize: 12, color: cameraError ? "#ffb4a3" : "#c7cdc3" }}>
              {cameraError
                || (cameraPreparing ? "กำลังเตรียมตัวอ่านบาร์โค้ดสำหรับเบราว์เซอร์นี้…" : null)
                || "ส่องกล้องให้เห็นบาร์โค้ด/QR ชัด ๆ — เจอแล้วเพิ่มลงตะกร้าให้อัตโนมัติ"}
            </div>
          </div>
        </div>
      )}
      {receipt && (
        <div
          onClick={() => setReceiptModalOpen(false)}
          style={
            receiptModalOpen
              ? {
                  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 16, zIndex: 50,
                }
              : // ยังต้องอยู่ใน DOM ให้ window.print() ใช้ได้ แต่ไม่กินพื้นที่จอ
                { position: "absolute", left: -10000, top: 0, width: 1, height: 1, overflow: "hidden" }
          }
        >
          {/* การ์ดเดียวจบ: หัวเรื่อง (ผลของบิล) → กระดาษ → แถบปุ่ม
              ปุ่มเคยลอยอยู่นอกกระดาษบนพื้น overlay ซึ่งอ่านเหมือนหน้ายังโหลดไม่เสร็จ */}
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="ใบเสร็จ"
            style={{
              background: "#fff", color: "#111", borderRadius: 12, width: 380, maxWidth: "100%",
              maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
            }}
          >
          {/* ใบเสร็จ: พิมพ์ผ่าน print dialog ของเบราว์เซอร์ก่อน — ใช้ได้กับเครื่องพิมพ์
              ที่ลง driver ไว้แล้วโดยไม่ต้องเขียน ESC/POS · ESC/POS ผ่าน WebUSB
              (พร้อมคำสั่งเปิดลิ้นชัก) ค่อยทำเมื่อได้เครื่องจริงมาทดสอบ */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #pos-receipt, #pos-receipt * { visibility: visible; }
              #pos-receipt { position: absolute !important; left: 0 !important; top: 0 !important; width: 72mm; }
            }
          `}</style>

          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", borderBottom: "1px solid #e5e5e5",
          }}>
            <span style={{
              fontSize: 12, padding: "3px 10px", borderRadius: 8, whiteSpace: "nowrap",
              background: receipt.receiptType === "return" ? "#fdecec" : "#e7f6ec",
              color: receipt.receiptType === "return" ? "#a32d2d" : "#1a6b3c",
            }}>
              {receipt.receiptType === "return" ? "รับคืน" : receipt.receiptType === "exchange" ? "เปลี่ยนสินค้า" : "สำเร็จ"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {receipt.docNo ?? "(ไม่มีเลขใบกำกับ)"}
              </div>
              <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ฿{baht(receipt.refundTotal ?? receipt.total)} · {receipt.paymentLabel}
                {receipt.change != null ? ` · เงินทอน ฿${baht(receipt.change)}` : ""}
              </div>
            </div>
            <button
              onClick={() => setReceiptModalOpen(false)}
              aria-label="ปิด"
              style={{ padding: "6px 12px", fontSize: 16, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>

          <div style={{
            overflowY: "auto", background: "#f4f4f4",
            padding: 14, display: "flex", justifyContent: "center",
          }}>
          <div
            id="pos-receipt"
            style={{
              background: "#fff", borderRadius: 4, padding: "14px 16px", width: 280, maxWidth: "100%",
              fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.55,
            }}
          >
            <div style={{ textAlign: "center" }}>{receipt.storeName}</div>
            <div style={{ textAlign: "center" }}>
              (สาขา {receipt.branchCode ?? "—"})
            </div>
            {/* ใบกำกับภาษีอย่างย่อต้องมีเลขประจำตัวผู้เสียภาษีของผู้ออก
                ร้านที่ยังไม่กรอกในโปรไฟล์จะไม่มีบรรทัดนี้ — เห็นแล้วรู้ว่าต้องไปตั้งค่า */}
            {receipt.taxId && (
              <div style={{ textAlign: "center" }}>TAX# {receipt.taxId}</div>
            )}
            {receipt.vatRegistered && (
              <div style={{ textAlign: "center" }}>(VAT Included)</div>
            )}
            <div style={{ textAlign: "center" }}>
              POS#{receipt.posLabel ?? "—"}
            </div>
            <div style={{ textAlign: "center", margin: "6px 0" }}>
              {receipt.receiptType === "return"
                ? "ใบรับคืนสินค้า"
                : receipt.receiptType === "exchange"
                  ? "ใบเตรียมเปลี่ยนสินค้า"
                  : receipt.vatRegistered ? "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" : "ใบเสร็จรับเงิน"}
            </div>
            <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
            {receipt.lines.map((l) => (
              <div key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.packQty} {l.receiptName}
                </span>
                <span>{baht(l.packPrice * l.packQty)}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px dashed #999", margin: "6px 0" }} />
            {/* ส่วนลดแยกที่มา (7.96) — รวมอยู่ในยอดสุทธิด้านล่างแล้ว */}
            {(!receipt.receiptType || receipt.receiptType === "sale") &&
              (receipt.discountLines ?? []).map((d, i) => (
                <div key={`${d.source}-${i}`} style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                  <span>{d.label}</span>
                  <span>-{baht(d.amount)}</span>
                </div>
              ))}
            {/* ตัวเลขชุดนี้มาจากใบกำกับที่ออกจริง ไม่ได้ถอด 7/107 จากยอดรวมที่จอ
                — บิลที่มีสินค้ายกเว้น VAT ปนจะได้คนละตัวเลขกับเอกสารที่ยื่น
                ใบรับคืน/ใบเปลี่ยนไม่แสดง เพราะใบลดหนี้เป็นเอกสารคนละใบ */}
            {receipt.vat && (!receipt.receiptType || receipt.receiptType === "sale") && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                  <span>มูลค่าก่อน VAT</span>
                  <span>{baht(receipt.vat.netBeforeVat)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                  <span>VAT {receipt.vat.rate}%</span>
                  <span>{baht(receipt.vat.vatAmount)}</span>
                </div>
                {receipt.vat.exemptAmount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                    <span>ยกเว้น VAT (N)</span>
                    <span>{baht(receipt.vat.exemptAmount)}</span>
                  </div>
                )}
              </>
            )}
            {/* ปัดเศษเงินสดแยกจากบล็อก VAT — ร้านที่ไม่ได้จด VAT ก็ตั้งปัดเศษได้
                ถ้าไม่พิมพ์บรรทัดนี้ ผลรวมรายการจะไม่เท่ายอดสุทธิโดยไม่มีคำอธิบาย */}
            {Number(receipt.roundingAmount ?? receipt.vat?.roundingAmount ?? 0) !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#555" }}>
                <span>ปัดเศษเงินสด</span>
                <span>{baht(Number(receipt.roundingAmount ?? receipt.vat?.roundingAmount ?? 0))}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
              <span>ยอดสุทธิ {receipt.lines.reduce((n, l) => n + l.packQty, 0)} ชิ้น</span>
              <span>{baht(receipt.refundTotal ?? receipt.total)}</span>
            </div>
            {receipt.returnReason && (
              <div style={{ marginTop: 4 }}>
                เหตุผล: {receipt.returnReason}
              </div>
            )}
            {/* แต้มท้ายบิล — ลูกค้าตรวจเองได้ว่าได้แต้มครบ (7.96) */}
            {receipt.memberNo && (!receipt.receiptType || receipt.receiptType === "sale") && (
              <div style={{ marginTop: 6, borderTop: "1px dashed #999", paddingTop: 6 }}>
                <div>สมาชิก {receipt.memberNo} {receipt.memberName ?? ""}</div>
                {receipt.pointsEarned != null && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>แต้มที่ได้บิลนี้</span><span>+{receipt.pointsEarned}</span>
                  </div>
                )}
                {receipt.pointsBalance != null && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>แต้มคงเหลือ</span><span>{receipt.pointsBalance}</span>
                  </div>
                )}
              </div>
            )}
            {(receipt.payments.length > 0 ? receipt.payments : [{
              method: "UNKNOWN",
              label: receipt.paymentLabel,
              amount: receipt.total,
              ref: receipt.paymentRef,
              tendered: receipt.tendered,
              change: receipt.change,
            }]).map((payment, idx) => (
              <div key={`${payment.method}-${idx}`}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>ชำระโดย {payment.label}</span>
                  <span>{baht(payment.amount)}</span>
                </div>
                {payment.tendered != null && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>รับเงิน/เงินทอน</span>
                    <span>{baht(payment.tendered)} / {baht(payment.change ?? 0)}</span>
                  </div>
                )}
                {payment.ref && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>เลขอ้างอิง</span>
                    <span>{payment.ref}</span>
                  </div>
                )}
              </div>
            ))}
            <div style={{ marginTop: 6 }}>{receipt.docNo ?? "(ไม่มีเลขใบกำกับ)"} · {receipt.at}</div>
            <div>แคชเชียร์ {receipt.cashier}</div>
            {/* สแกนเลขบิลตอนลูกค้าเอาบิลมาคืนของ แทนการพิมพ์เลขด้วยมือ */}
            {receipt.docNo && (
              <div style={{ marginTop: 8, textAlign: "center" }}>
                <ReceiptBarcode value={receipt.docNo} />
                <div>{receipt.docNo}</div>
              </div>
            )}
          </div>
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "12px 14px", borderTop: "1px solid #e5e5e5",
          }}>
            <button onClick={() => void printReceipt(false)} style={{ flex: 1, padding: "10px 16px" }}>
              พิมพ์ใบเสร็จ <span style={{ fontSize: 11, color: "#888" }}>Enter</span>
            </button>
            {/* ปุ่มลิ้นชักโผล่เฉพาะตอนต่อเครื่องพิมพ์ ESC/POS ได้จริง — print dialog เปิดลิ้นชักไม่ได้ */}
            {printerReady && (
              <button onClick={() => void openCashDrawer()} style={{ padding: "10px 14px" }} title="เปิดลิ้นชักเงินสด">
                ลิ้นชัก
              </button>
            )}
            {/* ส่งสำเนาให้ลูกค้า (8.6) — ไม่ใช่เอกสารภาษีใบใหม่ อ่านเลขจากใบที่ออกแล้ว
                ช่องกรอกชนะข้อมูลในระบบ เพราะพนักงานถามอีเมลปากเปล่าเป็นเรื่องปกติ
                และบิลอาจไม่ผูกลูกค้าเลย */}
            {receipt?.orderId && (
              <>
                <input
                  value={receiptTo}
                  onChange={(e) => setReceiptTo(e.target.value)}
                  placeholder="อีเมลลูกค้า (เว้นว่าง = ใช้ของในระบบ)"
                  style={{ flex: 1, minWidth: 150, padding: "10px 12px", fontSize: 13 }}
                />
                <button
                  disabled={sendingReceipt}
                  onClick={() => void doSendReceipt(receipt.orderId!, "email")}
                  style={{ padding: "10px 14px" }}
                  title="ส่งใบเสร็จทางอีเมล"
                >
                  ส่งอีเมล
                </button>
                <button
                  disabled={sendingReceipt}
                  onClick={() => void doSendReceipt(receipt.orderId!, "line")}
                  style={{ padding: "10px 14px" }}
                  title="ส่งใบเสร็จทาง LINE (ลูกค้าต้องผูก LINE กับร้านไว้)"
                >
                  ส่ง LINE
                </button>
              </>
            )}
            <button onClick={() => setReceiptModalOpen(false)} style={{ padding: "10px 16px" }}>
              ปิด <span style={{ fontSize: 11, color: "#888" }}>Esc</span>
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * บาร์โค้ดเลขบิลบนจอและใน print dialog
 * (ทาง ESC/POS ใช้คำสั่งบาร์โค้ดของเครื่องพิมพ์เอง ไม่ได้ส่งภาพนี้ไป)
 */
function ReceiptBarcode({ value }: { value: string }) {
  const code = code39Bars(value);
  if (!code) return null;
  const height = 36;
  return (
    <svg
      viewBox={`0 0 ${code.width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`บาร์โค้ดเลขบิล ${value}`}
      style={{ display: "block" }}
    >
      {code.bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}

/** แปลสถานะที่ server ปฏิเสธให้เป็นภาษาที่แคชเชียร์ทำอะไรต่อได้ */
function describeFailure(data: any): string {
  switch (data?.status) {
    case "SHIFT_NOT_OPEN":
      return "กะปิดไปแล้ว — เปิดกะใหม่ก่อน";
    case "PAYMENT_MISMATCH":
      return data.subtotal != null && data.discount != null
        ? `ยอดไม่ตรง: ระบบคิดสินค้า ฿${baht(data.subtotal)} − ส่วนลดรวม ฿${baht(data.discount)} = ต้องรับ ฿${baht(data.expected)} แต่จอส่ง ฿${baht(data.received)}${Number(data.pointsUsed) > 0 ? ` (ใช้ ${Number(data.pointsUsed).toLocaleString()} แต้มแล้ว)` : ""} — ระบบล้างยอดรับเงินให้แล้ว กรุณาตรวจราคาและรับเงินใหม่`
        : `ยอดไม่ตรง: ระบบคิด ฿${baht(data.expected)} แต่จอส่ง ฿${baht(data.received)} — ระบบล้างยอดรับเงินให้แล้ว กรุณารีเฟรชราคาและรับเงินใหม่`;
    case "LOT_EXPIRED_OR_SHORT":
      return `${data.sku}: ของที่ยังไม่หมดอายุเหลือ ${data.sellable} ต้องการ ${data.requested} — หยิบกล่องใหม่`;
    case "INSUFFICIENT":
      return `${data.sku} เหลือ ${data.available} ต้องการ ${data.requested}`;
    case "NOT_FOUND":
      return `ไม่พบสินค้า ${data.sku ?? ""}`;
    case "INVALID_PACK":
      return `${data.sku}: ไม่พบหน่วยขาย ${data.packCode || "ที่เลือก"} — โหลดสินค้าใหม่แล้วลองอีกครั้ง`;
    case "PHARMACY_POLICY_UNKNOWN":
      return `${data.sku}: เภสัชกรยังไม่ได้อนุมัตินโยบายการขายของสินค้านี้`;
    case "PHARMACY_PRESCRIPTION_REQUIRED":
      return `${data.sku}: ต้องมีใบสั่งแพทย์ — ขายผ่านระบบไม่ได้`;
    case "PHARMACY_ONLINE_SALE_PROHIBITED":
      return `${data.sku}: สินค้านี้ถูกตั้งเป็นห้ามขายผ่านช่องทางนี้`;
    case "PHARMACY_REVIEW_REQUIRED":
    case "PHARMACY_SAFETY_CHECK_REQUIRED":
      return `${data.sku}: ต้องให้เภสัชกรซักประวัติและอนุมัติก่อน`;
    case "PHARMACY_QUANTITY_LIMIT_EXCEEDED":
      return `${data.sku}: เกินจำนวนสูงสุดต่อครั้ง (${data.maxQuantity})`;
    case "COUPON_INVALID":
      return `คูปองใช้ไม่ได้: ${data.reason}`;
    // สองตัวนี้เดิมตกไปที่ default แล้วโชว์ "ขายไม่สำเร็จ (POINTS_INVALID)" ซึ่งบอก
    // แคชเชียร์ไม่ได้ว่าต้องทำอะไรต่อ ทั้งที่ server ส่ง reason ที่อ่านรู้เรื่องมาให้แล้ว
    case "POINTS_INVALID":
      return `แลกแต้มไม่ได้: ${data.reason}`;
    case "DISCOUNT_UNAPPROVED":
      return `ส่วนลดหน้าร้านใช้ไม่ได้: ${data.reason} — ให้หัวหน้าอนุมัติใหม่`;
    case "SERIAL_REQUIRED":
      return `${data.sku}: ต้องระบุเลขเครื่องให้ครบ ${data.expected} เลข (ใส่แล้ว ${data.received})`;
    case "SERIAL_ALREADY_SOLD":
      return `เลขเครื่อง ${data.serial} เคยขายไปแล้ว — หยิบกล่องผิดใบหรือยิงซ้ำ`;
    case "PAYMENT_FAILED":
      return `บันทึกการชำระเงินไม่สำเร็จ: ${data.reason}`;
    // เซิร์ฟเวอร์พังกลางคำขอ — บิลอาจถูกสร้างไปแล้ว ห้ามบอกให้ "ยิงใหม่" ลอย ๆ
    case "SERVER_ERROR":
      return `เซิร์ฟเวอร์ผิดพลาด (${data.error ?? "ไม่ทราบสาเหตุ"}) — กดชำระเงินอีกครั้ง ระบบจะใช้คีย์เดิมและไม่สร้างบิลซ้ำ`;
    default:
      return data?.error ?? `ขายไม่สำเร็จ (${data?.status ?? "ไม่ทราบสาเหตุ"})`;
  }
}
