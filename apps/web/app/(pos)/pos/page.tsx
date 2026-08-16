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
  vat: { registered: boolean; priceIncludesVat: boolean; rate: number; calendarEra: string };
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
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSalesQuery, setRecentSalesQuery] = useState("");
  const [recentReceipts, setRecentReceipts] = useState<Receipt[]>([]);
  const [returnDrafts, setReturnDrafts] = useState<Record<string, ReturnDraft>>({});
  const [returnNotes, setReturnNotes] = useState<Record<string, string>>({});
  const [returnReasonCodes, setReturnReasonCodes] = useState<Record<string, string>>({});
  const [approvalUserId, setApprovalUserId] = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [settlementRefs, setSettlementRefs] = useState<Record<string, string>>({});
  const [hasPendingSale, setHasPendingSale] = useState(false);
  const [shiftReturnSummary, setShiftReturnSummary] = useState<{ count: number; total: number }>({ count: 0, total: 0 });
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
    const remaining = Math.round((total - paid) * 100) / 100;
    return { normalized, paid, remaining };
  }, [payments, total]);

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

  function addPaymentRow() {
    if (hasPendingSale) return;
    setPayments((cur) => [
      ...cur,
      { id: `pay-${Date.now()}-${cur.length + 1}`, method: "QR", amount: "", tendered: "", ref: "" },
    ]);
  }

  function removePaymentRow(id: string) {
    if (hasPendingSale) return;
    setPayments((cur) => (cur.length <= 1 ? cur : cur.filter((payment) => payment.id !== id)));
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
        const nextReceipt: Receipt = {
          orderId: data.orderId ?? null,
          docNo: data.docNo ?? null,
          lines: cart,
          total,
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
          paymentLabel: receiptPayments.length > 1 ? "จ่ายหลายวิธี" : receiptPayments[0]?.label ?? "ไม่ระบุ",
          paymentRef: receiptPayments.length === 1 ? receiptPayments[0]?.ref ?? null : null,
          payments: receiptPayments,
          refunds: [],
        };
        setReceipt(nextReceipt);
        window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(nextReceipt));
        setNotice({
          type: "ok",
          text: `ขายสำเร็จ${data.docNo ? ` · ใบเสร็จ ${data.docNo}` : ""}${
            data.cashChange != null ? ` · เงินทอน ฿${baht(data.cashChange)}` : ""
          }${data.replayed ? " (บิลเดิม ไม่ได้ขายซ้ำ)" : ""}`,
        });
        setCart([]);
        window.localStorage.removeItem(PENDING_SALE_KEY);
        setHasPendingSale(false);
        setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
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

  return (
    <div className="pos-page" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: "100vh" }}>
      <style>{`
        .pos-page, .pos-page * { box-sizing: border-box; }
        @media (max-width: 767px) {
          .pos-header { align-items: flex-start !important; flex-direction: column; }
          .pos-header-actions { width: 100%; flex-wrap: wrap; }
          .pos-header-actions select { flex: 1 1 160px; min-width: 0 !important; }
          .pos-main-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .pos-payment-row, .pos-refund-row { grid-template-columns: minmax(0, 1fr) !important; }
          .pos-payment-row > *, .pos-refund-row > * { width: 100%; min-width: 0 !important; }
        }
      `}</style>
      <header
        className="pos-header"
        style={{
          background: "#fff", borderRadius: 12, padding: "10px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 500 }}>
            {loadingSession && !session ? "กำลังเชื่อมต่อ…" : session?.location?.name ?? "ยังไม่ทราบสาขา"}
            {session?.location && (
              <span style={{ color: "#888", fontWeight: 400 }}> (สาขา {session.location.branchCode})</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {session ? (
              <>
                {session.device.code}
                {session.device.registeredPosNo ? ` · POS#${session.device.registeredPosNo}` : ""}
                {session.shift ? " · กะเปิดอยู่" : " · ยังไม่เปิดกะ"}
              </>
            ) : (
              "ยังไม่ได้เชื่อมต่อกับระบบ"
            )}
          </div>
        </div>
        <div className="pos-header-actions" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {receipt && (
            <button onClick={() => window.print()} style={{ padding: "8px 10px", fontSize: 12 }}>
              พิมพ์บิลล่าสุด
            </button>
          )}
          <button onClick={() => void loadLastReceiptFromServer()} style={{ padding: "8px 10px", fontSize: 12 }}>
            โหลดบิลล่าสุด
          </button>
          <select
            value={cashierId}
            onChange={(e) => { setCashierId(e.target.value); setPin(""); }}
            style={{ padding: 8, fontSize: 14, minWidth: 160 }}
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
            style={{ padding: 8, fontSize: 14, width: 90 }}
          />
          <button onClick={unpair} title="เลิกจับคู่เครื่องนี้" style={{ padding: "8px 10px", fontSize: 12 }}>
            เลิกจับคู่
          </button>
        </div>
      </header>

      {sessionError && !tokenRejected && (
        <div style={{ background: "#fdecea", color: "#611a15", padding: 12, borderRadius: 8 }}>
          เชื่อมต่อไม่ได้: {sessionError} — ตรวจอินเทอร์เน็ตแล้วลอง{" "}
          <button onClick={() => void loadSession()} style={{ padding: "2px 10px" }}>เชื่อมต่อใหม่</button>
        </div>
      )}

      {/* บอกให้ชัดว่าขาดอะไรถึงยังขายไม่ได้ — เดิมจอเงียบ คนหน้าร้านเดาเองไม่ถูก */}
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
            {anyCashierHasPin && !cashierId && <li>เลือกผู้ขายมุมขวาบน</li>}
            {anyCashierHasPin && cashierId && !pin && <li>ใส่ PIN ของผู้ขาย</li>}
            {!session.shift && <li>เปิดกะ พร้อมระบุเงินตั้งต้นในลิ้นชัก</li>}
          </ol>
        </div>
      )}
      {session && !session.shift && (
        <div style={{ background: "#fff4e5", color: "#663c00", padding: 12, borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>ยังไม่ได้เปิดกะ</span>
          <input
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            inputMode="decimal"
            placeholder="เงินตั้งต้นในลิ้นชัก"
            style={{ padding: 8, fontSize: 14, width: 180 }}
          />
          <button disabled={busy || !cashierId || !pin} onClick={() => void shiftAction("open")} style={{ padding: "8px 16px" }}>
            เปิดกะ
          </button>
        </div>
      )}
      {session?.shift && cart.length === 0 && (
        <div style={{ background: "#fff", padding: 10, borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ color: "#666" }}>ปิดกะ:</span>
          <input
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            inputMode="decimal"
            placeholder="เงินที่นับได้"
            style={{ padding: 8, fontSize: 14, width: 160 }}
          />
          <button disabled={busy || !cashierId || !pin || !countedCash} onClick={() => void shiftAction("close")} style={{ padding: "8px 16px" }}>
            ปิดกะ + นับเงิน
          </button>
        </div>
      )}
      {notice && (
        <div
          style={{
            background: notice.type === "ok" ? "#edf7ed" : "#fdecea",
            color: notice.type === "ok" ? "#1e4620" : "#611a15",
            padding: 12, borderRadius: 8,
          }}
        >
          {notice.text}
        </div>
      )}
      {hasPendingSale && (
        <div style={{ background: "#fff7e6", color: "#874d00", padding: 12, borderRadius: 8, border: "1px solid #ffd591" }}>
          ล็อกรายการไว้เพื่อกู้บิลเดิม กรุณากด “ชำระเงิน” ซ้ำ ระบบจะตรวจคีย์เดิมก่อนและไม่สร้างบิลซ้ำ
        </div>
      )}
      {session?.shift && (
        <div style={{ background: "#fff", padding: 10, borderRadius: 8, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ color: "#666" }}>สรุปคืนสินค้าในกะนี้ (จากฐานข้อมูลทั้งหมด)</span>
          <span>คืนแล้ว {shiftReturnSummary.count} บิล</span>
          <span>ยอดคืนรวมประมาณ ฿{baht(shiftReturnSummary.total)}</span>
        </div>
      )}
      <div style={{ background: "#fff", padding: 10, borderRadius: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#666" }}>ผู้อนุมัติคืนสินค้า (ใช้เมื่อระบบร้องขอ):</span>
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
          คืนตั้งแต่ ฿500 ขึ้นไปจะเริ่มมี approval flow · ตั้งแต่ ฿2,000 ขึ้นไปถือเป็น high-value return
        </span>
      </div>

      <div className="pos-main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 10, flex: 1 }}>
        <section style={{ background: "#fff", borderRadius: 12, padding: 12 }}>
          <input
            ref={scanRef}
            autoFocus
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            onKeyDown={(e) => {
              // เครื่องสแกนเป็นคีย์บอร์ด: ยิงเสร็จมันเคาะ Enter ให้เอง
              if (e.key === "Enter") void handleScan(scanCode);
            }}
            placeholder={lookupMode ? "เช็คของ — ยิงบาร์โค้ด/พิมพ์รหัสแล้วกด Enter" : "ยิงบาร์โค้ด หรือพิมพ์รหัสแล้วกด Enter"}
            style={{ width: "100%", padding: 14, fontSize: 16 }}
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นชื่อสินค้า / SKU / alias"
            style={{ width: "100%", padding: 12, fontSize: 14, marginTop: 8 }}
          />
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
                {lookup.sku} · {lookup.unitName}
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
              <div
                key={l.key}
                style={{
                  border: "1px solid #eee", borderRadius: 8, padding: "8px 10px",
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{l.receiptName}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {l.packQty} {l.unitName} × ฿{baht(l.packPrice)} · คงเหลือ {l.available}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => changeQty(l.key, -1)} style={{ padding: "6px 12px", fontSize: 16 }}>−</button>
                  <button onClick={() => changeQty(l.key, 1)} style={{ padding: "6px 12px", fontSize: 16 }}>+</button>
                  <div style={{ minWidth: 84, textAlign: "right", fontWeight: 500 }}>
                    ฿{baht(l.packPrice * l.packQty)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {recentReceipts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: "#666" }}>บิลล่าสุดของเครื่องนี้</div>
                <input
                  value={recentSalesQuery}
                  onChange={(e) => setRecentSalesQuery(e.target.value)}
                  placeholder="ค้นเลขบิล / order id"
                  style={{ padding: "8px 10px", fontSize: 13, width: 200 }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentReceipts.map((row, idx) => (
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
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                          {row.at} · {row.paymentLabel}{row.paymentRef ? ` · ${row.paymentRef}` : ""}
                        </div>
                      </div>
                      <strong>฿{baht(row.total)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                      {row.lines.slice(0, 3).map((line) => `${line.packQty}× ${line.receiptName}`).join(" · ")}
                      {row.lines.length > 3 ? ` · +${row.lines.length - 3} รายการ` : ""}
                    </div>
                    {row.orderId && row.orderStatus !== "RETURNED" && row.lines.some((line) => (line.refundablePackQty ?? 0) > 0) && (
                      <div style={{ marginTop: 8, borderTop: "1px dashed #ddd", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontSize: 12, color: "#666" }}>คืนบางรายการ</div>
                        <select
                          value={returnReasonCodes[row.orderId] ?? ""}
                          onChange={(e) => setReturnReasonCodes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                          style={{ padding: 8, fontSize: 12 }}
                        >
                          <option value="">เลือกประเภทเหตุผล</option>
                          {RETURN_REASON_OPTIONS.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                        </select>
                        <textarea
                          value={returnNotes[row.orderId] ?? ""}
                          onChange={(e) => setReturnNotes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                          placeholder="เหตุผลในการคืน (บังคับ)"
                          style={{ width: "100%", minHeight: 64, padding: 8, fontSize: 12, resize: "vertical" }}
                        />
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
                                  style={{ padding: "4px 8px", fontSize: 12 }}
                                >
                                  −
                                </button>
                                <div style={{ minWidth: 24, textAlign: "center", fontSize: 12 }}>{selected}</div>
                                <button
                                  onClick={() => updateReturnDraft(row.orderId!, line.orderItemId!, selected + 1, maxQty)}
                                  style={{ padding: "4px 8px", fontSize: 12 }}
                                >
                                  +
                                </button>
                              </div>
                            );
                          })}
                        <div style={{ fontSize: 12, color: "#8a6100" }}>
                          ยอดคืนประมาณ ฿{baht(getPartialRefundPreview(row))}
                        </div>
                        <div>
                          <button
                            onClick={() => void partialReturnReceipt(row)}
                            disabled={busy || getPartialRefundPreview(row) <= 0}
                            style={{ padding: "6px 10px", fontSize: 12 }}
                          >
                            คืนบางรายการ
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
                          window.localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(row));
                        }}
                        style={{ padding: "6px 10px", fontSize: 12 }}
                      >
                        ดู/พิมพ์
                      </button>
                      <button
                        onClick={() => startExchangeFromReceipt(row)}
                        style={{ padding: "6px 10px", fontSize: 12 }}
                      >
                        ทำบิลเปลี่ยนสินค้า
                      </button>
                      {row.orderId && (
                        <>
                          {row.orderStatus !== "RETURNED" && (
                            <>
                              <select
                                value={returnReasonCodes[row.orderId] ?? ""}
                                onChange={(e) => setReturnReasonCodes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                                style={{ padding: 8, fontSize: 12, minWidth: 160 }}
                              >
                                <option value="">ประเภทเหตุผล</option>
                                {RETURN_REASON_OPTIONS.map((opt) => (
                                  <option key={`full-${opt.key}`} value={opt.key}>{opt.label}</option>
                                ))}
                              </select>
                              <textarea
                                value={returnNotes[row.orderId] ?? ""}
                                onChange={(e) => setReturnNotes((cur) => ({ ...cur, [row.orderId!]: e.target.value }))}
                                placeholder="เหตุผลในการคืนทั้งบิล (บังคับ)"
                                style={{ minWidth: 220, minHeight: 38, padding: 8, fontSize: 12, resize: "vertical" }}
                              />
                            </>
                          )}
                          <button
                            onClick={() => void returnReceipt(row.orderId!)}
                            disabled={busy || row.orderStatus === "RETURNED"}
                            style={{ padding: "6px 10px", fontSize: 12 }}
                          >
                            {row.orderStatus === "RETURNED" ? "คืนแล้ว" : "คืนบิล"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {recentReceipts.length === 0 && recentSalesQuery.trim().length > 0 && (
            <div style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
              ไม่พบบิลที่ตรงกับคำค้นนี้
            </div>
          )}
        </section>

        <section style={{ background: "#fff", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 14, color: "#666" }}>{itemCount} ชิ้น</span>
            <span style={{ fontSize: 28, fontWeight: 500 }}>฿{baht(total)}</span>
          </div>
          {session?.vat.registered && (
            <div style={{ fontSize: 12, color: "#666", textAlign: "right" }}>
              ราคารวม VAT {session.vat.rate}% แล้ว
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {payments.map((payment, index) => {
              const normalized = paymentSummary.normalized[index];
              return (
                <div
                  key={payment.id}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}
                >
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
              <button onClick={addPaymentRow} style={{ padding: "8px 12px", fontSize: 13 }}>
                + เพิ่มวิธีจ่าย
              </button>
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
          <button
            disabled={busy || cart.length === 0 || !canSell || Math.abs(paymentSummary.remaining) > 0.01}
            onClick={() => void pay()}
            style={{
              marginTop: 12, padding: "16px 0", fontSize: 18, borderRadius: 8,
              border: "none", color: "#fff",
              background: busy || cart.length === 0 || !canSell || Math.abs(paymentSummary.remaining) > 0.01 ? "#bbb" : "#237804",
            }}
          >
            {busy ? "กำลังบันทึก…" : `ชำระเงิน ฿${baht(total)}`}
          </button>
          <button
            disabled={hasPendingSale}
            onClick={() => {
              setCart([]);
              setPayments([{ id: "pay-1", method: "CASH", amount: "", tendered: "", ref: "" }]);
              setSearchTerm("");
              setSearchResults([]);
              setNotice(null);
              scanRef.current?.focus();
            }}
            style={{ marginTop: 6, padding: "10px 0", fontSize: 14 }}
          >
            ล้างบิล
          </button>
        </section>
      </div>
      {receipt && (
        <>
          {/* ใบเสร็จ: พิมพ์ผ่าน print dialog ของเบราว์เซอร์ก่อน — ใช้ได้กับเครื่องพิมพ์
              ที่ลง driver ไว้แล้วโดยไม่ต้องเขียน ESC/POS · ESC/POS ผ่าน WebUSB
              (พร้อมคำสั่งเปิดลิ้นชัก) ค่อยทำเมื่อได้เครื่องจริงมาทดสอบ */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #pos-receipt, #pos-receipt * { visibility: visible; }
              #pos-receipt { position: absolute; left: 0; top: 0; width: 72mm; }
            }
          `}</style>
          <div
            id="pos-receipt"
            style={{
              background: "#fff", borderRadius: 12, padding: 16, maxWidth: 320,
              fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.55,
            }}
          >
            <div style={{ textAlign: "center" }}>{receipt.storeName}</div>
            <div style={{ textAlign: "center" }}>
              (สาขา {receipt.branchCode ?? "—"})
            </div>
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
            <div style={{ display: "flex", justifyContent: "space-between" }}>
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
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ padding: "10px 20px" }}>พิมพ์ใบเสร็จ</button>
            <button onClick={() => setReceipt(null)} style={{ padding: "10px 20px" }}>ปิด</button>
          </div>
        </>
      )}
    </div>
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
