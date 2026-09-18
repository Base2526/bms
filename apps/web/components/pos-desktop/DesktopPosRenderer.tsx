"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialPosClientFlow,
  transitionPosClientFlow,
  type PosClientEvent,
  type PosClientFlowState,
} from "@pos-core/flow";
import { createIdempotencyKey } from "@pos-core/operation";
import {
  calculateCashChange,
  paymentMethodLabel,
  quickCashAmounts,
  validatePayments,
  type PosPaymentInput,
  type PosPaymentMethod,
} from "@pos-core/payment";
import {
  cartLinePricingSignature,
  cartProductSubtotal,
  cashRoundingForPayments,
  isCashRounding,
  normalizePriceTiers,
  normalizePromotion,
  payableWithRounding,
  type PricedCartLine,
} from "@pos-core/cartPricing";
import { selectPosCatalogCardVariant } from "@pos-core/catalog";
import {
  POS_BOOTSTRAP_QUERY,
  POS_CATALOG_QUERY,
  POS_SALE_MUTATION,
  POS_SCAN_QUERY,
  POS_SHIFT_MUTATION,
  VERIFY_CASHIER_MUTATION,
  PosGraphqlError,
  posGraphqlRequest,
  type PosBootstrap,
  type PosCashier,
  type PosCatalogItem,
  type PosScanHit,
} from "@/lib/pos/mobileFlowGraphql";
import {
  clearPosDeviceToken,
  hasDesktopPosBridge,
  readPosDeviceToken,
} from "@/lib/pos/deviceTokenClient";
import PosPage from "@/app/(pos)/pos/page";
import { PosWorkspaceContext, type PosTab } from "@/components/pos/PosWorkspaceContext";
import styles from "./DesktopPosRenderer.module.css";

type CartLine = PricedCartLine & {
  key: string;
  name: string;
  unitName: string;
  modifierCodes: string[];
  serials: string[];
  serialTracked: boolean;
  imageUrl: string | null;
};

type SaleResult = {
  status: string;
  reason: string | null;
  orderId: string | null;
  receiptNo: string | null;
  billNo: string | null;
  subtotal: number | null;
  discount: number | null;
  total: number | null;
  cashTendered: number | null;
  cashChange: number | null;
  roundingAmount: number | null;
};

type SalePayload = Record<string, unknown>;

const primaryMethods: PosPaymentMethod[] = ["cash", "qr", "card", "wallet"];
const decidedCodes = new Set([
  "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED",
  "BAD_USER_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
]);

type DesktopModule = "mobile_sell" | "restaurant" | PosTab;

const money = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(value);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่";
}

function resolvedCartLine(hit: PosScanHit): CartLine {
  const size = String(hit.size ?? "");
  const packCode = String(hit.packCode ?? "BASE") || "BASE";
  const baseQty = Math.max(1, Number(hit.baseQty) || 1);
  const basePrice = Math.max(0, Number(hit.basePrice) || 0);
  const packBasePrice = Number.isFinite(Number(hit.packPrice))
    ? Math.max(0, Number(hit.packPrice))
    : basePrice * baseQty;
  return {
    key: `${hit.sku}\u0000${size}\u0000${packCode}`,
    sku: hit.sku,
    name: hit.receiptName || hit.productName,
    size,
    packCode,
    qty: 1,
    baseQty,
    basePrice,
    packBasePrice,
    modifierUnitPrice: 0,
    scaleBarcode: hit.scaleBarcode,
    unitPrice: packBasePrice,
    unitName: hit.unitName || "ชิ้น",
    priceTiers: normalizePriceTiers(hit.priceTiers),
    promotion: normalizePromotion(hit.promotion),
    modifierCodes: [],
    serials: [],
    serialTracked: Boolean(hit.serialTracked),
    imageUrl: hit.imageUrl,
  };
}

function NavIcon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    sell: "▥",
    restaurant: "◷",
    boardgame: "◫",
    returns: "↶",
    stock: "◇",
    deposits: "▤",
    shift: "▦",
    settings: "⚙",
  };
  return <span aria-hidden="true">{icons[name] ?? "•"}</span>;
}

export default function DesktopPosRenderer() {
  const [token, setToken] = useState("");
  const [flow, setFlow] = useState<PosClientFlowState>(() => initialPosClientFlow(true));
  const [bootstrap, setBootstrap] = useState<PosBootstrap | null>(null);
  const [cashier, setCashier] = useState<PosCashier | null>(null);
  const [cashierId, setCashierId] = useState("");
  const [pin, setPin] = useState("");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PosPaymentInput[]>([
    { id: "payment-1", method: "cash", amount: 0, tendered: 0 },
  ]);
  const [receipt, setReceipt] = useState<SaleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingProductKey, setAddingProductKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"checking" | "online" | "offline">("checking");
  const [activeModule, setActiveModule] = useState<DesktopModule>("mobile_sell");
  const saleAttemptRef = useRef<{ key: string; payload: SalePayload } | null>(null);
  const addProductPendingRef = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendFlow = useCallback((event: PosClientEvent) => {
    setFlow((current) => transitionPosClientFlow(current, event));
  }, []);

  const bootstrapDevice = useCallback(async () => {
    setConnection("checking");
    setError("");
    const nextToken = await readPosDeviceToken();
    if (!nextToken) {
      setToken("");
      setFlow(initialPosClientFlow(false));
      return;
    }
    setToken(nextToken);
    try {
      const data = await posGraphqlRequest<{ bmsPosSession: PosBootstrap }>(
        nextToken,
        POS_BOOTSTRAP_QUERY,
      );
      setBootstrap(data.bmsPosSession);
      const first = data.bmsPosSession.cashiers.find((item) => item.hasPin);
      setCashierId(first?.id ?? "");
      setFlow((current) => {
        let next = transitionPosClientFlow(current, "DEVICE_VERIFIED");
        if (data.bmsPosSession.shift?.status === "OPEN") {
          next = transitionPosClientFlow(next, "SHIFT_STATUS_OPEN");
        }
        return next;
      });
      setConnection("online");
    } catch (cause) {
      setConnection("offline");
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void bootstrapDevice();
  }, [bootstrapDevice]);

  const loadCatalog = useCallback(
    async (q: string) => {
      if (!token) return;
      try {
        const data = await posGraphqlRequest<{
          bmsPosCatalogSearch: { items: PosCatalogItem[] };
        }>(token, POS_CATALOG_QUERY, { q });
        setCatalog(data.bmsPosCatalogSearch.items);
        setConnection("online");
      } catch (cause) {
        setConnection("offline");
        setError(messageOf(cause));
      }
    },
    [token],
  );

  useEffect(() => {
    if (flow.stage !== "CATALOG") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadCatalog(query), 180);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [flow.stage, loadCatalog, query]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!cashierId || !pin || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await posGraphqlRequest<{ bmsPosVerifyCashier: PosCashier }>(
        token,
        VERIFY_CASHIER_MUTATION,
        { input: { cashierUserId: cashierId, pin } },
      );
      setCashier(data.bmsPosVerifyCashier);
      sendFlow("CASHIER_VERIFIED");
    } catch (cause) {
      setPin("");
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const openShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!cashier || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await posGraphqlRequest<{
        bmsPosShift: { status: string; reason: string | null; shift: PosBootstrap["shift"] };
      }>(token, POS_SHIFT_MUTATION, {
        input: {
          action: "OPEN",
          cashierUserId: cashier.id,
          pin,
          openingFloat: Math.max(0, Number(openingFloat) || 0),
          countedCash: null,
          note: null,
          userId: null,
        },
      });
      if (data.bmsPosShift.status !== "OPENED" || !data.bmsPosShift.shift) {
        throw new Error(data.bmsPosShift.reason ?? "เปิดกะไม่สำเร็จ");
      }
      setBootstrap((current) => (current ? { ...current, shift: data.bmsPosShift.shift } : current));
      sendFlow("SHIFT_OPENED");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const legacy = (tab: string) => {
    window.location.assign(tab === "restaurant" ? "/pos/restaurant" : `/pos?tab=${tab}`);
  };

  const openModule = useCallback((module: DesktopModule) => {
    if (module === "mobile_sell") sendFlow("BACK_TO_CATALOG");
    setActiveModule(module);
    setError("");
    setNotice("");
  }, [sendFlow]);

  const followWorkspaceTab = useCallback((tab: PosTab) => {
    setActiveModule(tab);
  }, []);

  const unpair = useCallback(async () => {
    await clearPosDeviceToken();
    setToken("");
    setBootstrap(null);
    setCashier(null);
    setPin("");
    sendFlow("UNPAIR");
  }, [sendFlow]);

  const followWorkspaceShift = useCallback((open: boolean) => {
    if (open) return;
    setBootstrap((current) => current ? { ...current, shift: null } : current);
    setCart([]);
    setActiveModule("mobile_sell");
    setFlow((current) => ({
      ...current,
      shiftOpen: false,
      stage: current.cashierAuthenticated ? "SHIFT_REQUIRED" : "CASHIER_LOGIN",
    }));
  }, []);

  const addProduct = async (code: string, size?: string | null) => {
    const clean = code.trim();
    if (!clean || busy || addProductPendingRef.current) return;
    addProductPendingRef.current = true;
    setAddingProductKey(`${clean}\u0000${size ?? ""}`);
    setError("");
    setNotice("");
    try {
      const data = await posGraphqlRequest<{ bmsPosScan: PosScanHit | null }>(
        token,
        POS_SCAN_QUERY,
        { code: clean, size: size || null, packCode: null, surface: "RETAIL_POS" },
      );
      const hit = data.bmsPosScan;
      if (!hit) throw new Error("ไม่พบสินค้านี้");
      if (hit.serialTracked || hit.scaleBarcode || hit.modifiers.length > 0) {
        setNotice(
          "สินค้านี้ต้องกรอก serial / น้ำหนัก / ตัวเลือกเพิ่มเติม จึงเปิดในหน้าขายแบบเต็มเพื่อไม่ข้ามการตรวจสอบ",
        );
        return;
      }
      if (Number(hit.available) <= 0) throw new Error("สินค้านี้ไม่มีสต็อกพร้อมขาย");
      const incoming = resolvedCartLine(hit);
      setCart((current) => {
        // ราคาส่งและโปรโมชันบางแบบนับรวมทุกไซซ์ของ SKU เดียวกัน กฎจาก scan ล่าสุด
        // จึงต้องอัปเดตทุกบรรทัดของ SKU นั้นเหมือน mobile client ก่อนคิดยอดใหม่
        const synced = current.map((line) =>
          line.sku === incoming.sku
            ? {
                ...line,
                priceTiers: incoming.priceTiers,
                promotion: incoming.promotion,
              }
            : line,
        );
        const existing = synced.find((line) => line.key === incoming.key);
        if (!existing) return [...synced, incoming];
        if ((existing.qty + 1) * existing.baseQty > Number(hit.available)) return synced;
        return synced.map((line) =>
          line.key === incoming.key ? { ...line, qty: line.qty + 1 } : line,
        );
      });
      setScanCode("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      addProductPendingRef.current = false;
      setAddingProductKey("");
    }
  };

  const changeQty = (key: string, delta: number) => {
    if (saleAttemptRef.current) return;
    setCart((current) =>
      current.flatMap((line) => {
        if (line.key !== key) return [line];
        const qty = line.qty + delta;
        return qty > 0 ? [{ ...line, qty }] : [];
      }),
    );
  };

  const subtotal = useMemo(() => cartProductSubtotal(cart), [cart]);
  const listSubtotal = useMemo(
    () => Math.round(cart.reduce((sum, line) => {
      const packPrice = Number(line.packBasePrice ?? line.unitPrice ?? 0);
      const modifierPrice = Number(line.modifierUnitPrice ?? 0);
      return sum + (Number.isFinite(packPrice) ? packPrice : 0) * line.qty
        + (Number.isFinite(modifierPrice) ? modifierPrice : 0) * line.qty;
    }, 0) * 100) / 100,
    [cart],
  );
  const pricingSavings = Math.max(0, Math.round((listSubtotal - subtotal) * 100) / 100);
  const cashMode = isCashRounding(bootstrap?.vat.cashRounding)
    ? bootstrap.vat.cashRounding
    : "NONE";
  const rounding = cashRoundingForPayments(subtotal, cashMode, payments);
  const total = payableWithRounding(subtotal, rounding);

  useEffect(() => {
    setPayments((current) => {
      if (current.length !== 1) return current;
      const payment = current[0];
      return [
        {
          ...payment,
          amount: total,
          tendered: payment.method === "cash" ? Math.max(payment.tendered ?? 0, total) : undefined,
        },
      ];
    });
  }, [total]);

  const validation = useMemo(() => validatePayments(total, payments), [payments, total]);
  const itemCount = cart.reduce((sum, line) => sum + line.qty, 0);

  const chooseMethod = (method: PosPaymentMethod) => {
    if (saleAttemptRef.current) return;
    setPayments([
      {
        id: "payment-1",
        method,
        amount: total,
        tendered: method === "cash" ? total : undefined,
        reference: method === "cash" ? undefined : "",
      },
    ]);
  };

  const updatePayment = (id: string, patch: Partial<PosPaymentInput>) => {
    if (saleAttemptRef.current) return;
    setPayments((current) =>
      current.map((payment) => (payment.id === id ? { ...payment, ...patch } : payment)),
    );
  };

  const addSplitPayment = () => {
    if (saleAttemptRef.current) return;
    setPayments((current) => [
      ...current,
      {
        id: `payment-${Date.now()}`,
        method: "qr",
        amount: Math.max(0, validation.remaining),
        reference: "",
      },
    ]);
  };

  const recheckCartPricing = async (): Promise<boolean> => {
    const refreshed: CartLine[] = [];
    for (const line of cart) {
      const data = await posGraphqlRequest<{ bmsPosScan: PosScanHit | null }>(
        token,
        POS_SCAN_QUERY,
        { code: line.sku, size: line.size || null, packCode: line.packCode || null, surface: "RETAIL_POS" },
      );
      if (!data.bmsPosScan) throw new Error(`ไม่พบ ${line.name} ในแคตตาล็อกล่าสุด`);
      const next = { ...resolvedCartLine(data.bmsPosScan), qty: line.qty };
      if (cartLinePricingSignature(next) !== cartLinePricingSignature(line)) {
        setCart((current) => current.map((item) => (item.key === line.key ? next : item)));
        setNotice("ราคา ขั้นราคาส่ง หรือโปรโมชันเปลี่ยนแล้ว กรุณาตรวจยอดและรับเงินใหม่");
        return false;
      }
      refreshed.push(next);
    }
    setCart(refreshed);
    return true;
  };

  const buildSalePayload = (key: string): SalePayload => ({
    input: {
      cashierUserId: cashier?.id,
      pin,
      idempotencyKey: key,
      offlineTenderedAt: null,
      mode: "SALE",
      boardGameBillingGroupId: null,
      lines: cart.map((line) => ({
        sku: line.sku,
        size: line.size,
        packCode: line.packCode || null,
        packQty: line.qty,
        baseQty: line.baseQty,
        packPrice: null,
        unitName: line.unitName || null,
        modifierCodes: line.modifierCodes,
        scaleBarcode: line.scaleBarcode ?? null,
        serials: line.serials,
      })),
      payments: payments.map((payment) => ({
        method: payment.method.toUpperCase(),
        amount: payment.amount,
        cashTendered: payment.method === "cash" ? payment.tendered ?? payment.amount : null,
        ref: payment.reference?.trim() || null,
      })),
      customerId: null,
      couponCode: null,
      pointsToRedeem: 0,
      manualDiscount: null,
      discountReason: null,
      discountApproverUserId: null,
      discountApproverPin: null,
      extraLines: null,
      pharmacyApprovedAssessmentId: null,
      pharmacyReviewAssessmentId: null,
      pharmacistAuthorizerUserId: null,
      pharmacistAuthorizerPin: null,
      pharmacistAuthorizationNote: null,
      creditApproverUserId: null,
      creditApproverPin: null,
      depositCustomerNote: null,
      depositDueAt: null,
    },
  });

  const submitSale = async () => {
    if (!cashier || busy || !validation.canConfirm || cart.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!saleAttemptRef.current) {
        const current = await recheckCartPricing();
        if (!current) return;
        const key = createIdempotencyKey("desktop-sale");
        saleAttemptRef.current = { key, payload: buildSalePayload(key) };
      }
      const data = await posGraphqlRequest<{ bmsPosSale: SaleResult }>(
        token,
        POS_SALE_MUTATION,
        saleAttemptRef.current.payload,
      );
      if (data.bmsPosSale.status !== "SOLD" || !data.bmsPosSale.orderId) {
        saleAttemptRef.current = null;
        throw new Error(data.bmsPosSale.reason ?? `ขายไม่สำเร็จ (${data.bmsPosSale.status})`);
      }
      setReceipt(data.bmsPosSale);
      saleAttemptRef.current = null;
      sendFlow("SALE_COMPLETED");
      setConnection("online");
    } catch (cause) {
      const decided =
        cause instanceof PosGraphqlError &&
        ((cause.code != null && decidedCodes.has(cause.code)) ||
          (cause.httpStatus != null && cause.httpStatus >= 400 && cause.httpStatus < 500));
      if (decided) saleAttemptRef.current = null;
      setError(
        decided
          ? messageOf(cause)
          : `${messageOf(cause)} · ยังไม่ทราบผล กรุณากดลองซ้ำ ระบบจะใช้รหัสรายการเดิม`,
      );
      setConnection("offline");
    } finally {
      setBusy(false);
    }
  };

  const newSale = () => {
    setCart([]);
    setReceipt(null);
    setPayments([{ id: "payment-1", method: "cash", amount: 0, tendered: 0 }]);
    setError("");
    setNotice("");
    saleAttemptRef.current = null;
    sendFlow("NEW_SALE");
  };

  if (flow.stage === "PAIRING") {
    return (
      <main className={styles.centerPage}>
        <section className={styles.gateCard}>
          <div className={styles.brandMark}>B</div>
          <p className={styles.eyebrow}>BMS POS DESKTOP</p>
          <h1>ยังไม่ได้เลือกเซิร์ฟเวอร์</h1>
          <p>กลับไปหน้าตั้งค่า Electron เพื่อเลือกเซิร์ฟเวอร์และจับคู่เครื่องนี้ก่อน</p>
          <button className={styles.primaryButton} onClick={() => void unpair()}>
            เปิดหน้าจับคู่เครื่อง
          </button>
        </section>
      </main>
    );
  }

  if (flow.stage === "VERIFYING_DEVICE" || !bootstrap) {
    return (
      <main className={styles.centerPage}>
        <section className={styles.gateCard}>
          <div className={styles.spinner} />
          <h1>กำลังเชื่อมต่อเครื่องขาย</h1>
          <p>{error || "ตรวจสอบเซิร์ฟเวอร์และสิทธิ์ของอุปกรณ์…"}</p>
          {error ? (
            <div className={styles.gateActions}>
              <button className={styles.primaryButton} onClick={() => void bootstrapDevice()}>ลองอีกครั้ง</button>
              <button onClick={() => void unpair()}>เปลี่ยนเซิร์ฟเวอร์</button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  if (flow.stage === "CASHIER_LOGIN") {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginAside}>
          <div className={styles.logoLockup}><span>B</span><strong>BMS POS</strong></div>
          <div>
            <p className={styles.eyebrow}>เครื่องขายพร้อมใช้งาน</p>
            <h1>{bootstrap.location?.name ?? "สาขาหลัก"}</h1>
            <p>{bootstrap.device.name ?? bootstrap.device.code} · {bootstrap.device.registeredPosNo ?? "POS"}</p>
          </div>
          <div className={styles.securityNote}>PIN อยู่เฉพาะในหน่วยความจำของหน้าจอนี้ และทุกการขายยังตรวจสิทธิ์กับเซิร์ฟเวอร์</div>
        </section>
        <section className={styles.loginPanel}>
          <form className={styles.loginForm} onSubmit={signIn}>
            <p className={styles.eyebrow}>เข้าสู่กะทำงาน</p>
            <h2>ใส่ PIN พนักงาน</h2>
            <label>พนักงาน
              <select value={cashierId} onChange={(event) => setCashierId(event.target.value)}>
                {bootstrap.cashiers.filter((item) => item.hasPin).map((item) => (
                  <option key={item.id} value={item.id}>{item.name || item.email || item.id}</option>
                ))}
              </select>
            </label>
            <input
              className={styles.pinInput}
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={12}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              aria-label="PIN พนักงาน"
            />
            <div className={styles.pinDots}>{Array.from({ length: 6 }, (_, index) => <i key={index} data-filled={index < pin.length} />)}</div>
            {error ? <p className={styles.errorBox}>{error}</p> : null}
            <button className={styles.primaryButton} disabled={!cashierId || pin.length < 4 || busy}>
              {busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
            </button>
            <button type="button" className={styles.textButton} onClick={() => void unpair()}>เปลี่ยนเซิร์ฟเวอร์ / จับคู่ใหม่</button>
          </form>
        </section>
      </main>
    );
  }

  if (flow.stage === "SHIFT_REQUIRED") {
    return (
      <main className={styles.centerPage}>
        <form className={styles.shiftCard} onSubmit={openShift}>
          <div className={styles.stepBadge}>2</div>
          <p className={styles.eyebrow}>ก่อนเริ่มขาย</p>
          <h1>เปิดกะเงินสด</h1>
          <p>สวัสดี {cashier?.name || cashier?.email} · ระบุเงินทอนตั้งต้นในลิ้นชัก</p>
          <label>เงินสดตั้งต้น
            <div className={styles.moneyInput}><span>฿</span><input inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></div>
          </label>
          {error ? <p className={styles.errorBox}>{error}</p> : null}
          <button className={styles.primaryButton} disabled={busy}>{busy ? "กำลังเปิดกะ…" : "เปิดกะและเริ่มขาย"}</button>
          <button type="button" className={styles.textButton} onClick={() => { setCashier(null); setPin(""); sendFlow("SIGN_OUT"); }}>เปลี่ยนพนักงาน</button>
        </form>
      </main>
    );
  }

  if (flow.stage === "RECEIPT" && receipt) {
    return (
      <main className={styles.centerPage}>
        <section className={styles.receiptCard}>
          <div className={styles.successMark}>✓</div>
          <p className={styles.eyebrow}>ชำระเงินสำเร็จ</p>
          <h1>{money(receipt.total ?? total)}</h1>
          <dl>
            <div><dt>เลขที่ใบเสร็จ</dt><dd>{receipt.receiptNo || receipt.billNo || receipt.orderId}</dd></div>
            <div><dt>รับเงิน</dt><dd>{money(receipt.cashTendered ?? validation.paidTotal)}</dd></div>
            <div className={styles.changeRow}><dt>เงินทอน</dt><dd>{money(receipt.cashChange ?? 0)}</dd></div>
          </dl>
          <div className={styles.receiptActions}>
            <button onClick={() => window.print()}>พิมพ์ใบเสร็จ</button>
            <button className={styles.primaryButton} onClick={newSale}>ขายรายการใหม่</button>
          </div>
        </section>
      </main>
    );
  }

  const checkout = flow.stage === "CHECKOUT";
  const navItems = ([
    { key: "mobile_sell", label: "ขาย", enabled: true },
    { key: "restaurant", label: "โต๊ะ", enabled: bootstrap.businessArchetype === "restaurant" },
    { key: "boardgame", label: "บอร์ดเกม", enabled: bootstrap.businessArchetype === "board_game_cafe" },
    { key: "returns", label: "คืน", enabled: true },
    { key: "stock", label: "รับของ", enabled: true },
    { key: "deposits", label: "มัดจำ", enabled: true },
    { key: "shift", label: "กะ", enabled: true },
    { key: "settings", label: "ตั้งค่า", enabled: true },
  ] satisfies Array<{ key: DesktopModule; label: string; enabled: boolean }>).filter((item) => item.enabled);

  return (
    <main className={`pos-desktop-app ${styles.shell}`}>
      <aside className={styles.rail}>
        <div className={styles.railLogo}>B</div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.key}
              className={activeModule === item.key || (item.key === "mobile_sell" && activeModule === "sell") ? styles.navActive : ""}
              onClick={() => item.key === "restaurant" ? legacy("restaurant") : openModule(item.key)}
              title={item.label}
            >
              <NavIcon name={item.key === "mobile_sell" ? "sell" : item.key} />
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
        <button className={styles.signOut} onClick={() => { setCashier(null); setPin(""); setCart([]); sendFlow("SIGN_OUT"); }}>ออก</button>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.storeIdentity}>
            <div className={styles.storeMark}>{(bootstrap.location?.name || "B").slice(0, 1)}</div>
            <div><strong>{bootstrap.location?.name ?? "สาขาหลัก"}</strong><span>{bootstrap.device.registeredPosNo ?? bootstrap.device.code} · กะเปิดอยู่</span></div>
          </div>
          <div className={styles.topMeta}>
            <span className={`${styles.connection} ${styles[connection]}`}><i />{connection === "online" ? "ออนไลน์" : connection === "checking" ? "กำลังเชื่อมต่อ" : "การเชื่อมต่อมีปัญหา"}</span>
            <button onClick={() => openModule("sell")}>ฟังก์ชันขายทั้งหมด</button>
            <button onClick={() => openModule("shift")}>{cashier?.name || cashier?.email}</button>
          </div>
        </header>

        {activeModule !== "mobile_sell" && activeModule !== "restaurant" ? (
          <div className={`${styles.content} ${styles.moduleContent}`}>
            <section className={styles.moduleHost}>
              <PosWorkspaceContext.Provider value={{
                embedded: true,
                initialTab: activeModule,
                initialToken: token,
                initialCashierId: cashier?.id ?? cashierId,
                initialPin: pin,
                onTabChange: followWorkspaceTab,
                onShiftChange: followWorkspaceShift,
                onUnpair: unpair,
              }}>
                <PosPage />
              </PosWorkspaceContext.Provider>
            </section>
          </div>
        ) : (
        <div className={styles.content}>
          <section className={styles.catalogPane}>
            {checkout ? (
              <>
                <div className={styles.sectionHead}>
                  <button className={styles.backButton} onClick={() => sendFlow("BACK_TO_CATALOG")}>← กลับไปแก้รายการ</button>
                  <div><p className={styles.eyebrow}>ตรวจสอบก่อนรับเงิน</p><h1>สรุปรายการขาย</h1></div>
                </div>
                <div className={styles.orderSummary}>
                  {cart.map((line) => (
                    <article key={line.key}>
                      <div className={styles.productThumb}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : line.name.slice(0, 1)}</div>
                      <div><strong>{line.name}</strong><span>{line.sku}{line.size ? ` · ${line.size}` : ""}</span></div>
                      <span>{line.qty} × {money(Number(line.packBasePrice ?? line.unitPrice ?? 0))}</span>
                    </article>
                  ))}
                </div>
                <div className={styles.summaryTotals}>
                  <div><span>ยอดสินค้าราคาป้าย</span><strong>{money(listSubtotal)}</strong></div>
                  {pricingSavings > 0 ? <div className={styles.savingsRow}><span>ราคาส่ง / โปรโมชัน</span><strong>−{money(pricingSavings)}</strong></div> : null}
                  {rounding !== 0 ? <div><span>ปัดเศษเงินสด</span><strong>{money(rounding)}</strong></div> : null}
                  <div className={styles.grandTotal}><span>ยอดสุทธิ</span><strong>{money(total)}</strong></div>
                </div>
              </>
            ) : (
              <>
                <form className={styles.scanBar} onSubmit={(event) => { event.preventDefault(); void addProduct(scanCode); }}>
                  <span className={styles.barcode}>▥</span>
                  <input autoFocus value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder="ยิงบาร์โค้ด หรือพิมพ์รหัสสินค้า แล้วกด Enter" />
                  <kbd>F12</kbd>
                  <button disabled={!scanCode.trim() || busy || Boolean(addingProductKey)}>เพิ่ม</button>
                </form>
                <div className={styles.catalogHeader}>
                  <div><p className={styles.eyebrow}>แคตตาล็อกสินค้า</p><h1>เลือกสินค้า</h1></div>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือ SKU" />
                </div>
                {(error || notice) ? <div className={error ? styles.errorBox : styles.noticeBox}>{error || notice}{notice ? <button onClick={() => openModule("sell")}>เปิดหน้าขายแบบเต็ม</button> : null}</div> : null}
                <div className={styles.productGrid}>
                  {catalog.map((item) => {
                    const selection = selectPosCatalogCardVariant(item);
                    const selectedVariant = selection.variant;
                    const addingKey = `${item.sku}\u0000${selectedVariant?.size ?? ""}`;
                    return (
                    <button
                      key={item.sku}
                      className={styles.productCard}
                      disabled={item.availableTotal <= 0 || busy}
                      aria-busy={addingProductKey === addingKey}
                      data-adding={addingProductKey === addingKey}
                      onClick={() => void addProduct(item.sku, selectedVariant?.size)}
                    >
                      <div className={styles.productImage}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>{item.name.slice(0, 1)}</span>}</div>
                      <strong>{item.name}</strong><small>{item.sku}</small>
                      <div>
                        <b>{money(selection.price)}</b>
                        <span className={selection.available > 0 ? styles.stockOk : styles.stockOut}>
                          {selection.available > 0
                            ? `เหลือ ${selection.available}${selectedVariant?.size ? ` · ${selectedVariant.size}` : ""}`
                            : "หมด"}
                        </span>
                      </div>
                    </button>
                    );
                  })}
                  {!catalog.length && !busy ? <div className={styles.emptyCatalog}>ไม่พบสินค้า ลองค้นด้วยชื่อหรือยิงบาร์โค้ด</div> : null}
                </div>
              </>
            )}
          </section>

          <aside className={styles.checkoutPane}>
            <div className={styles.billHeader}>
              <div><span>{checkout ? "ยอดชำระ" : "บิลปัจจุบัน"}</span><small>{itemCount} ชิ้น</small></div>
              <strong>{money(total)}</strong>
            </div>

            {!checkout ? (
              <>
                <div className={styles.cartLines}>
                  {cart.map((line) => (
                    <article key={line.key}>
                      <div className={styles.cartName}><strong>{line.name}</strong><span>{line.sku}{line.size ? ` · ${line.size}` : ""}</span></div>
                      <div className={styles.stepper}><button onClick={() => changeQty(line.key, -1)}>−</button><b>{line.qty}</b><button onClick={() => changeQty(line.key, 1)}>+</button></div>
                      <strong>{money(Number(line.packBasePrice ?? line.unitPrice ?? 0) * line.qty)}</strong>
                    </article>
                  ))}
                  {!cart.length ? <div className={styles.emptyCart}><span>▥</span><strong>ยังไม่มีสินค้าในบิล</strong><p>ยิงบาร์โค้ดหรือเลือกสินค้าจากด้านซ้าย</p></div> : null}
                </div>
                <div className={styles.cartFooter}>
                  {pricingSavings > 0 ? <div className={styles.savingsRow}><span>ส่วนลดราคาส่ง / โปรโมชัน</span><strong>−{money(pricingSavings)}</strong></div> : null}
                  <div><span>ยอดสุทธิ</span><strong>{money(total)}</strong></div>
                  <button className={styles.payButton} disabled={!cart.length} onClick={() => sendFlow("START_CHECKOUT")}>ไปชำระเงิน <span>→</span></button>
                </div>
              </>
            ) : (
              <div className={styles.paymentArea}>
                <div className={styles.paymentTitle}><div><h2>วิธีชำระเงิน</h2><p>เลือกหนึ่งวิธี หรือแบ่งชำระหลายช่องทาง</p></div><button onClick={addSplitPayment}>＋ จ่ายผสม</button></div>
                <div className={styles.methodGrid}>
                  {primaryMethods.map((method) => (
                    <button key={method} className={payments.length === 1 && payments[0].method === method ? styles.methodActive : ""} onClick={() => chooseMethod(method)}>
                      <span>{method === "cash" ? "▣" : method === "qr" ? "▦" : method === "card" ? "▤" : "▱"}</span>{paymentMethodLabel(method)}
                    </button>
                  ))}
                </div>
                <div className={styles.paymentRows}>
                  {payments.map((payment, index) => (
                    <section key={payment.id}>
                      <div className={styles.paymentRowHead}>
                        <select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PosPaymentMethod, reference: event.target.value === "cash" ? undefined : "", tendered: event.target.value === "cash" ? payment.amount : undefined })}>
                          {[...primaryMethods, "bank_transfer" as const].map((method) => <option key={method} value={method}>{paymentMethodLabel(method)}</option>)}
                        </select>
                        <label>ยอดช่องทางนี้<input inputMode="decimal" value={payment.amount || ""} onChange={(event) => updatePayment(payment.id, { amount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                        {payments.length > 1 ? <button className={styles.removePayment} onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}>ลบ</button> : null}
                      </div>
                      {payment.method === "cash" ? (
                        <>
                          <label className={styles.receivedInput}>รับเงินมา<input inputMode="decimal" value={payment.tendered ?? ""} onChange={(event) => updatePayment(payment.id, { tendered: Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <div className={styles.quickCash}>{quickCashAmounts(payment.amount).map((amount) => <button key={amount} onClick={() => updatePayment(payment.id, { tendered: amount })}>{amount === payment.amount ? "พอดี" : `฿${amount}`}</button>)}</div>
                          <div className={styles.change}><span>เงินทอน</span><strong>{money(calculateCashChange(payment.amount, payment.tendered ?? 0))}</strong></div>
                        </>
                      ) : (
                        <label className={styles.referenceInput}>เลขอ้างอิง<input value={payment.reference ?? ""} onChange={(event) => updatePayment(payment.id, { reference: event.target.value })} placeholder="เลขท้าย / Transaction ID" /></label>
                      )}
                      {index < payments.length - 1 ? <hr /> : null}
                    </section>
                  ))}
                </div>
                {(error || notice || validation.errors.length > 0) ? <div className={error ? styles.errorBox : styles.noticeBox}>{error || notice || validation.errors[0]?.replace("ทดสอบ", "")}</div> : null}
                <div className={styles.paymentFooter}>
                  <div><span>{validation.remaining > 0 ? "ยังขาด" : "พร้อมรับชำระ"}</span><strong>{validation.remaining > 0 ? money(validation.remaining) : money(total)}</strong></div>
                  <button className={styles.payButton} disabled={!validation.canConfirm || busy} onClick={() => void submitSale()}>{busy ? "กำลังบันทึก…" : saleAttemptRef.current ? "ลองบันทึกซ้ำด้วยรหัสเดิม" : `ยืนยันรับชำระ ${money(total)}`}</button>
                </div>
              </div>
            )}
          </aside>
        </div>
        )}
      </section>
      {!hasDesktopPosBridge() ? <div className={styles.browserBadge}>Browser preview · Electron จะเก็บ device token ใน OS keychain</div> : null}
    </main>
  );
}
