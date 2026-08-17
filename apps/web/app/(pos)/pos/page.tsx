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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { code39Bars } from "@/lib/pos/barcode";
import { isCameraScanSupported, needsDecoderDownload, startCameraScan } from "@/lib/pos/cameraScan";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
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
  { key: "sell", label: "ขาย", icon: "▮▍▮" },
  { key: "returns", label: "คืน", icon: "↩" },
  { key: "shift", label: "กะ", icon: "▤" },
  { key: "settings", label: "ตั้งค่า", icon: "⚙" },
] as const;
type PosTab = (typeof POS_TABS)[number]["key"];

const TOKEN_KEY = "bms.pos.deviceToken";
const LAST_RECEIPT_KEY = "bms.pos.lastReceipt";
const PENDING_SALE_KEY = "bms.pos.pendingSale";

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
  available: number;
};

type CartLine = ScanHit & {
  packQty: number;
  key: string;
  orderItemId?: number;
  returnedPackQty?: number;
  refundablePackQty?: number;
};
type ReturnDraft = Record<number, number>;

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

type Session = {
  device: { id: string; code: string; name: string | null; registeredPosNo: string | null };
  location: { id: string; name: string; branchCode: string; pharmacistName: string | null } | null;
  shift: { id: string; openedAt: string; openingFloat: number } | null;
  shiftReturnSummary: { returnCount: number; returnTotal: number; settledTotal: number; pendingTotal: number; pendingCount: number };
  cashiers: Array<{ id: string; name: string | null; email: string | null; isPharmacist: boolean; hasPin: boolean }>;
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
  const [splitMode, setSplitMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
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
  // pending = คืนเงินจริงที่ยังไม่ยืนยัน ซึ่งบล็อกการปิดกะ — แท็บกะต้องบอกให้เห็น
  const [shiftReturnSummary, setShiftReturnSummary] = useState<{
    count: number; total: number; pendingCount: number; pendingTotal: number;
  }>({ count: 0, total: 0, pendingCount: 0, pendingTotal: 0 });
  const scanRef = useRef<HTMLInputElement>(null);

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

  const authHeaders = useMemo(() => ({ "x-pos-device-token": token }), [token]);

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

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.packPrice * l.packQty, 0),
    [cart]
  );
  const itemCount = useMemo(() => cart.reduce((sum, l) => sum + l.packQty, 0), [cart]);

  // ปัดเศษเงินสด: ต้องคิดให้ตรงกับ server เป๊ะ ๆ (pos.ts: ปัดเฉพาะบิลที่ทุกวิธี
  // จ่ายเป็นเงินสด) ไม่งั้นยอดที่ส่งไปไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH
  // และบิลถูกยกเลิกทิ้ง · ก่อนกรอกจำนวนเงิน ใช้ "วิธีจ่ายที่เลือกไว้" ตัดสินแทน
  const roundingDelta = useMemo(() => {
    const mode = session?.vat.cashRounding ?? "NONE";
    if (mode === "NONE" || total <= 0) return 0;
    const withAmount = payments.filter((p) => (Number(p.amount) || 0) > 0);
    const considered = withAmount.length > 0 ? withAmount : payments;
    if (considered.length === 0 || !considered.every((p) => p.method === "CASH")) return 0;
    return cashRoundingDelta(total, mode);
  }, [session?.vat.cashRounding, total, payments]);
  /** ยอดที่ต้องเก็บจริง = ยอดสินค้า + ปัดเศษ — ทุกที่ที่พูดถึง "ยอดที่ต้องจ่าย" ใช้ตัวนี้ */
  const amountDue = useMemo(
    () => Math.round((total + roundingDelta) * 100) / 100,
    [total, roundingDelta]
  );
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
    if (cart.length === 0) return "ยังไม่มีสินค้าในบิล";
    if (!session?.shift) return "ยังไม่ได้เปิดกะ";
    if (!cashierId) return "เลือกผู้ขายก่อน";
    if (!pin) return "ใส่ PIN ของผู้ขาย";
    if (paymentSummary.remaining > 0.01) return `ยังรับเงินไม่ครบ — ขาด ฿${baht(paymentSummary.remaining)}`;
    if (paymentSummary.remaining < -0.01) return `ยอดรับเกินไป ฿${baht(Math.abs(paymentSummary.remaining))}`;
    if (!canSell) return "ยังขายไม่ได้";
    return null;
  })();

  async function handleScan(code: string, size?: string | null) {
    if (hasPendingSale) {
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
      if (lookupMode) {
        setLookup(hit);
        setNotice(null);
        return;
      }
      const key = `${hit.sku}__${hit.size}__${hit.packCode}`;
      setCart((cur) => {
        const found = cur.find((l) => l.key === key);
        if (found) {
          return cur.map((l) => (l.key === key ? { ...l, packQty: l.packQty + 1 } : l));
        }
        return [...cur, { ...hit, packQty: 1, key }];
      });
      setNotice(null);
    } catch (e: any) {
      setNotice({ type: "error", text: String(e?.message ?? e) });
    } finally {
      scanRef.current?.focus();
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

  function changeQty(key: string, delta: number) {
    if (hasPendingSale) return;
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, packQty: l.packQty + delta } : l))
        .filter((l) => l.packQty > 0)
    );
  }

  function updatePayment(id: string, patch: Partial<PaymentDraft>) {
    if (hasPendingSale) return;
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
    if (hasPendingSale) return;
    // ออกจากฟอร์มย่อทันทีที่จะจ่ายผสม — ต้องเห็นยอดของแต่ละวิธี
    setSplitMode(true);
    setPayments((cur) =>
      cur.length === 1 && !cur[0].amount ? [{ ...cur[0], amount: String(total) }] : cur
    );
    setPayments((cur) => [
      ...cur,
      { id: `pay-${Date.now()}-${cur.length + 1}`, method: "QR", amount: "", tendered: "", ref: "" },
    ]);
  }

  function removePaymentRow(id: string) {
    if (hasPendingSale) return;
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

  // กลับมาแท็บขายเมื่อไหร่ ช่องยิงบาร์โค้ดต้องรับโฟกัสทันที — ไม่งั้นแคชเชียร์
  // ยิงของแล้วตัวอักษรหายเข้าไปในช่องอื่น เป็นบั๊กที่เจ็บที่สุดของจอขาย
  useEffect(() => {
    if (tab === "sell" && !receiptModalOpen) scanRef.current?.focus();
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
          void handleScan(code);
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

  async function pay() {
    if (!session?.shift || cart.length === 0 || !cashierId || !pin || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const savedAttempt = (() => {
        try { return JSON.parse(window.localStorage.getItem(PENDING_SALE_KEY) ?? "null"); } catch { return null; }
      })();
      const body = savedAttempt?.body ? { ...savedAttempt.body, cashierUserId: cashierId, pin } : {
        shiftId: session.shift.id,
        cashierUserId: cashierId,
        pin,
        idempotencyKey: `${session.device.code}-${session.shift.id.slice(0, 8)}-${crypto.randomUUID()}`,
        lines: cart.map((line) => ({
          sku: line.sku,
          size: line.size,
          packQty: line.packQty,
          packCode: line.packCode,
        })),
        payments: paymentSummary.normalized
          .filter((payment) => payment.numericAmount > 0)
          .map((payment) => ({
            method: payment.method,
            amount: payment.numericAmount,
            cashTendered: payment.method === "CASH" && payment.numericTendered > 0 ? payment.numericTendered : null,
            ref: payment.method !== "CASH" && payment.ref.trim() ? payment.ref.trim() : null,
          })),
      };
      window.localStorage.setItem(PENDING_SALE_KEY, JSON.stringify({ body: { ...body, pin: undefined }, cart, payments }));
      setHasPendingSale(true);
      const res = await fetch("/api/pos/sale", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
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
        if (data?.status !== "PAYMENT_FAILED") {
          window.localStorage.removeItem(PENDING_SALE_KEY);
          setHasPendingSale(false);
        }
        setNotice({ type: "error", text: describeFailure(data) });
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
    <div className="pos-page" style={{ display: "flex" }}>
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
        .pos-rail .pos-rail-icon { font-size: 17px; line-height: 1; }
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
            <span className="pos-rail-icon" aria-hidden="true">{item.icon}</span>
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
            style={{ fontSize: 13, minWidth: 170, padding: 8 }}
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
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            aria-label="PIN ของผู้ขาย"
            style={{ width: 96, fontSize: 15, padding: 8 }}
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
      {hasPendingSale && (
        <div style={{ background: "#fff7e6", color: "#874d00", padding: 12, borderRadius: 8, border: "1px solid #ffd591" }}>
          ล็อกรายการไว้เพื่อกู้บิลเดิม กรุณากด “ชำระเงิน” ซ้ำ ระบบจะตรวจคีย์เดิมก่อนและไม่สร้างบิลซ้ำ
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

      {tab === "shift" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 500 }}>กะขายของเครื่องนี้</div>
          {session?.shift ? (
            <>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.9 }}>
                <div>เปิดกะ {new Date(session.shift.openedAt).toLocaleString("th-TH")}</div>
                <div>เงินตั้งต้นในลิ้นชัก ฿{baht(session.shift.openingFloat)}</div>
                <div>
                  คืนสินค้าในกะนี้ {shiftReturnSummary.count} บิล · ฿{baht(shiftReturnSummary.total)}
                  {shiftReturnSummary.pendingCount > 0
                    ? ` · รอยืนยันคืนเงินจริง ${shiftReturnSummary.pendingCount} รายการ ฿${baht(shiftReturnSummary.pendingTotal)}`
                    : ""}
                </div>
              </div>
              {/* ปิดกะขณะมีของค้างในตะกร้าไม่ได้ — บิลที่ยังไม่จบจะหายไปกับกะ */}
              {cart.length > 0 ? (
                <div style={{ background: "#fff4e5", color: "#663c00", padding: 10, borderRadius: 8, fontSize: 13 }}>
                  ยังมีสินค้าค้างในตะกร้า — ปิดบิลให้จบหรือล้างบิลก่อนปิดกะ
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                    inputMode="decimal"
                    placeholder="เงินที่นับได้"
                    style={{ padding: 10, fontSize: 15, width: 180 }}
                  />
                  <button
                    disabled={busy || !cashierId || !pin || !countedCash}
                    onClick={() => void shiftAction("close")}
                    style={{ padding: "10px 18px" }}
                  >
                    ปิดกะ + นับเงิน
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                inputMode="decimal"
                placeholder="เงินตั้งต้นในลิ้นชัก"
                style={{ padding: 10, fontSize: 15, width: 200 }}
              />
              <button
                disabled={busy || !cashierId || !pin}
                onClick={() => void shiftAction("open")}
                style={{ padding: "10px 18px" }}
              >
                เปิดกะ
              </button>
              {(!cashierId || !pin) && (
                <span style={{ fontSize: 13, color: "#8a6100" }}>เลือกผู้ขายและใส่ PIN ก่อน</span>
              )}
            </div>
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
              {printerReady && (
                <button onClick={() => void openCashDrawer()} style={{ padding: "8px 14px", fontSize: 13 }}>
                  เปิดลิ้นชัก
                </button>
              )}
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
          {/* ช่องเดียวจบ: เดิมมี "ยิงบาร์โค้ด" กับ "ค้นชื่อสินค้า" แยกกัน ซึ่งทับกัน
              ตั้งแต่ช่องยิงรับ SKU ได้ด้วย — พนักงานใหม่ลังเลว่าพิมพ์ช่องไหน
              ตอนนี้: พิมพ์ไปก็ค้นชื่อให้ไปด้วย · Enter = ตีความเป็นบาร์โค้ด/รหัสตรง ๆ */}
          <div className="pos-scan">
          <span aria-hidden="true" style={{ fontSize: 18, color: "var(--pos-accent)" }}>▮▍▮▏▮</span>
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
                void handleScan(scanCode);
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
                      void handleScan(item.sku, sizes[0].size);
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
                          void handleScan(item.sku, variant.size);
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
                      setCart((cur) => {
                        const found = cur.find((l) => l.key === key);
                        if (found) return cur.map((l) => (l.key === key ? { ...l, packQty: l.packQty + 1 } : l));
                        return [...cur, { ...lookup, packQty: 1, key }];
                      });
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
                    ฿{baht(l.packPrice)} × {l.packQty} {l.unitName} · เหลือ {l.available}
                  </div>
                </div>
                <div className="pos-qty">
                  <button onClick={() => changeQty(l.key, -1)} aria-label="ลดจำนวน">−</button>
                  <span className="pos-qty-value">{l.packQty}</span>
                  <button onClick={() => changeQty(l.key, 1)} aria-label="เพิ่มจำนวน">+</button>
                </div>
                <div className="pos-line-amount">฿{baht(l.packPrice * l.packQty)}</div>
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
                                background: row.orderStatus === "RETURNED" ? "#fdecea" : "#edf7ed",
                                color: row.orderStatus === "RETURNED" ? "#611a15" : "#1e4620",
                              }}
                            >
                              {row.orderStatus === "RETURNED" ? "คืนแล้ว" : "สำเร็จ"}
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
                          {row.orderStatus === "RETURNED" ? "คืนแล้วทั้งบิล" : "คืนครบทุกรายการแล้ว"}
                        </span>
                      )}
                    </div>
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
            {/* ปัดเศษต้องเห็นบนจอ ไม่ใช่โผล่มาเฉพาะบนใบเสร็จ — ลูกค้าถามว่าทำไมไม่ตรงป้าย */}
            {roundingDelta !== 0 && (
              <div className="pos-total-break" style={{ borderTop: "1px solid var(--pos-line)", paddingTop: 7, marginTop: 8 }}>
                <span>ยอดสินค้า ฿{baht(total)} · ปัดเศษเงินสด {roundingDelta > 0 ? "+" : "−"}฿{baht(Math.abs(roundingDelta))}</span>
              </div>
            )}
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
            {busy ? "กำลังบันทึก…" : payBlockedReason ?? `ชำระเงิน ฿${baht(total)}`}
          </button>
          <button
            disabled={hasPendingSale}
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
          </>)}
        </section>
      </div>
      </div>
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
      return `ยอดไม่ตรง: ระบบคิด ฿${baht(data.expected)} แต่รับมา ฿${baht(data.received)} — ยิงรายการใหม่`;
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
    case "PAYMENT_FAILED":
      return `บันทึกการชำระเงินไม่สำเร็จ: ${data.reason}`;
    default:
      return data?.error ?? `ขายไม่สำเร็จ (${data?.status ?? "ไม่ทราบสาเหตุ"})`;
  }
}
