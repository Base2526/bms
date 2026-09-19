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
  isPosPinValid,
  normalizePosPinInput,
  POS_PIN_MAX_LENGTH,
  visiblePosPinSlots,
} from "@pos-core/posPin";
import {
  POS_BOOTSTRAP_QUERY,
  POS_BOARD_GAME_CHECKOUT_QUERY,
  POS_CATALOG_QUERY,
  POS_SALE_MUTATION,
  POS_SCAN_QUERY,
  POS_SHIFT_MUTATION,
  VERIFY_CASHIER_MUTATION,
  PosGraphqlError,
  posGraphqlRequest,
  type PosBootstrap,
  type PosBoardGameCheckout,
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
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import OrderAlertSettingsModal from "@/components/pos/OrderAlertSettingsModal";
import {
  PosWorkspaceContext,
  type PosServiceCallNotice,
  type PosTab,
} from "@/components/pos/PosWorkspaceContext";
import PosDismissibleAlert from "@/components/pos/PosDismissibleAlert";
import { ALERT_KINDS, newAlertIds } from "@/lib/pos/orderAlertSound";
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

function serviceCallLabel(call: PosServiceCallNotice): string {
  const labels: Record<string, string> = {
    WATER: "ขอน้ำ",
    CUTLERY: "ขอช้อนส้อม",
    BILL: "เรียกเก็บเงิน",
    MENU_HELP: "ขอความช่วยเหลือเรื่องเมนู",
  };
  return labels[call.requestCode] ?? call.requestNote ?? "เรียกพนักงาน";
}

function serviceCallAge(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  return minutes < 1 ? "เมื่อสักครู่" : `${minutes} นาทีที่แล้ว`;
}

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
  // A timed-play bill is a frozen billing group, not a synthetic product. Keep it outside
  // the retail cart so collecting one group never consumes or discards a sale in progress.
  const [boardGameCheckout, setBoardGameCheckout] = useState<PosBoardGameCheckout | null>(null);
  const [payments, setPayments] = useState<PosPaymentInput[]>([
    { id: "payment-1", method: "cash", amount: 0, tendered: 0 },
  ]);
  const [receipt, setReceipt] = useState<SaleResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingProductKey, setAddingProductKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"checking" | "online" | "offline">("checking");
  // Reuse the established per-device alert store. The desktop shell exposes the control, but
  // notification rules and playback remain owned by the existing POS alert pipeline.
  const alerts = useOrderAlerts(Boolean(bootstrap && cashier));
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [serviceCalls, setServiceCalls] = useState<PosServiceCallNotice[]>([]);
  const [serviceCallsBusy, setServiceCallsBusy] = useState("");
  const knownServiceCallIds = useRef<Set<string> | null>(null);
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

  const acceptBoardGameServiceCalls = useCallback((calls: PosServiceCallNotice[]) => {
    setServiceCalls(calls.filter((call) => call.status === "PENDING"));
  }, []);

  // Restaurant calls must remain visible while the cashier works on another desktop module.
  // Board-game calls are pushed up by BoardGamePanel instead, avoiding a duplicate workspace poll.
  useEffect(() => {
    if (bootstrap?.businessArchetype !== "restaurant" || !token || !cashier || !pin) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/pos/restaurant/service-calls", {
          headers: { "x-pos-device-token": token },
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "โหลดคำเรียกไม่สำเร็จ");
        if (!stopped) {
          const rows = Array.isArray(data.calls) ? data.calls : [];
          setServiceCalls(rows
            .filter((call: PosServiceCallNotice) => call.status === "PENDING")
            .map((call: PosServiceCallNotice) => ({ ...call, source: "restaurant" })));
        }
      } catch (cause) {
        if (!stopped && !(cause instanceof DOMException && cause.name === "AbortError")) {
          // Keep the last known calls visible; a transient refresh error must not clear real work.
          console.error("[desktop-pos] service-call refresh failed", cause);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer); };
  }, [bootstrap?.businessArchetype, cashier, pin, token]);

  useEffect(() => {
    if (bootstrap?.businessArchetype !== "board_game_cafe" || activeModule === "boardgame" || !token || !cashier || !pin) return;
    let stopped = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/pos/board-game", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({ action: "service.calls", cashierUserId: cashier.id, pin }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "โหลดคำเรียกไม่สำเร็จ");
        if (!stopped) {
          const rows = Array.isArray(data.serviceCalls) ? data.serviceCalls : [];
          setServiceCalls(rows
            .filter((call: PosServiceCallNotice) => call.status === "PENDING")
            .map((call: PosServiceCallNotice) => ({ ...call, source: "boardgame" })));
        }
      } catch (cause) {
        if (!stopped && !(cause instanceof DOMException && cause.name === "AbortError")) {
          console.error("[desktop-pos] board-game service-call refresh failed", cause);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer); };
  }, [activeModule, bootstrap?.businessArchetype, cashier, pin, token]);

  useEffect(() => {
    const pendingIds = serviceCalls.map((call) => `${call.source}:${call.id}`);
    if (newAlertIds(knownServiceCallIds.current, pendingIds).length > 0) alerts.notify("QR_PENDING");
    knownServiceCallIds.current = new Set(pendingIds);
  }, [alerts, serviceCalls]);

  const acknowledgeServiceCall = useCallback(async (call: PosServiceCallNotice) => {
    if (!cashier || !pin || serviceCallsBusy) return;
    setServiceCallsBusy(call.id);
    try {
      const response = call.source === "restaurant"
        ? await fetch("/api/pos/restaurant/service-calls", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({ action: "acknowledge", callId: call.id, cashierUserId: cashier.id, cashierPin: pin }),
        })
        : await fetch("/api/pos/board-game", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({
            action: "service.acknowledge",
            callId: call.id,
            cashierUserId: cashier.id,
            pin,
            idempotencyKey: createIdempotencyKey("desktop-service-call"),
          }),
        });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "รับคำเรียกไม่สำเร็จ");
      setServiceCalls((current) => current.filter((item) => !(item.id === call.id && item.source === call.source)));
      setNotice(`รับทราบคำเรียกจาก ${call.tableName || call.tableCode} แล้ว`);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setServiceCallsBusy("");
    }
  }, [cashier, pin, serviceCallsBusy, token]);

  const openServiceCall = useCallback((call: PosServiceCallNotice) => {
    if (call.source === "restaurant") {
      legacy("restaurant");
      return;
    }
    openModule("boardgame");
  }, [openModule]);

  const unpair = useCallback(async () => {
    await clearPosDeviceToken();
    setToken("");
    setBootstrap(null);
    setCashier(null);
    setPin("");
    setBoardGameCheckout(null);
    setServiceCalls([]);
    sendFlow("UNPAIR");
  }, [sendFlow]);

  const followWorkspaceShift = useCallback((open: boolean) => {
    if (open) return;
    setBootstrap((current) => current ? { ...current, shift: null } : current);
    setCart([]);
    setBoardGameCheckout(null);
    setActiveModule("mobile_sell");
    setFlow((current) => ({
      ...current,
      shiftOpen: false,
      stage: current.cashierAuthenticated ? "SHIFT_REQUIRED" : "CASHIER_LOGIN",
    }));
  }, []);

  const signOutCashier = useCallback(() => {
    setCashier(null);
    setPin("");
    setCart([]);
    setBoardGameCheckout(null);
    setServiceCalls([]);
    sendFlow("SIGN_OUT");
  }, [sendFlow]);

  const openBoardGameCheckout = useCallback(async (billingGroupId: string) => {
    if (!cashier || !pin || busy) return;
    if (saleAttemptRef.current) {
      setError("มีรายการรับชำระที่ยังไม่ทราบผล กรุณาลองบันทึกรายการเดิมให้จบก่อน");
      setActiveModule("mobile_sell");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await posGraphqlRequest<{
        bmsPosBoardGameCheckout: PosBoardGameCheckout | null;
      }>(token, POS_BOARD_GAME_CHECKOUT_QUERY, {
        credentials: { cashierUserId: cashier.id, pin },
        id: billingGroupId,
      });
      if (!data.bmsPosBoardGameCheckout) {
        throw new Error("ไม่พบบิลกลุ่มนี้ หรือบิลถูกชำระจากเครื่องอื่นแล้ว");
      }
      const checkout = data.bmsPosBoardGameCheckout;
      const checkoutCashMode = isCashRounding(bootstrap?.vat.cashRounding)
        ? bootstrap.vat.cashRounding
        : "NONE";
      const checkoutPayment: PosPaymentInput = {
        id: "payment-1",
        method: "cash",
        amount: checkout.totalDue,
        tendered: checkout.totalDue,
      };
      const checkoutRounding = cashRoundingForPayments(
        checkout.totalDue,
        checkoutCashMode,
        [checkoutPayment],
      );
      const checkoutTotal = payableWithRounding(checkout.totalDue, checkoutRounding);
      setBoardGameCheckout(checkout);
      setReceipt(null);
      // Seed the authoritative amount before switching views. Waiting for the total-sync effect
      // would paint one invalid "cash amount is zero" frame and make the checkout visibly flash.
      setPayments([{ ...checkoutPayment, amount: checkoutTotal, tendered: checkoutTotal }]);
      setActiveModule("mobile_sell");
      sendFlow("START_CHECKOUT");
      setConnection("online");
    } catch (cause) {
      setError(messageOf(cause));
      setActiveModule("mobile_sell");
      sendFlow("BACK_TO_CATALOG");
      setConnection("offline");
    } finally {
      setBusy(false);
    }
  }, [bootstrap?.vat.cashRounding, busy, cashier, pin, sendFlow, token]);

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

  const retailSubtotal = useMemo(() => cartProductSubtotal(cart), [cart]);
  const retailListSubtotal = useMemo(
    () => Math.round(cart.reduce((sum, line) => {
      const packPrice = Number(line.packBasePrice ?? line.unitPrice ?? 0);
      const modifierPrice = Number(line.modifierUnitPrice ?? 0);
      return sum + (Number.isFinite(packPrice) ? packPrice : 0) * line.qty
        + (Number.isFinite(modifierPrice) ? modifierPrice : 0) * line.qty;
    }, 0) * 100) / 100,
    [cart],
  );
  const pricingSavings = Math.max(0, Math.round((retailListSubtotal - retailSubtotal) * 100) / 100);
  const payableBeforeRounding = boardGameCheckout?.totalDue ?? retailSubtotal;
  const cashMode = isCashRounding(bootstrap?.vat.cashRounding)
    ? bootstrap.vat.cashRounding
    : "NONE";
  const rounding = cashRoundingForPayments(payableBeforeRounding, cashMode, payments);
  const total = payableWithRounding(payableBeforeRounding, rounding);
  const paymentCount = payments.length;

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
  }, [paymentCount, total]);

  const validation = useMemo(() => validatePayments(total, payments), [payments, total]);
  const zeroDueBoardGameBill = Boolean(boardGameCheckout && total === 0);
  const canConfirmPayment = validation.canConfirm || zeroDueBoardGameBill;
  const itemCount = boardGameCheckout ? 0 : cart.reduce((sum, line) => sum + line.qty, 0);
  const billCountLabel = boardGameCheckout
    ? "ค่าบริการ 1 รายการ"
    : `${itemCount} ชิ้น`;
  const boardGameBenefitAmount = boardGameCheckout
    ? Math.max(0, boardGameCheckout.passCoveredAmount) + Math.max(0, boardGameCheckout.offerDiscountAmount)
    : 0;
  const boardGameGrossTime = boardGameCheckout
    ? boardGameCheckout.amountDue + boardGameBenefitAmount
    : 0;

  const backFromCheckout = () => {
    if (saleAttemptRef.current) return;
    if (boardGameCheckout) {
      setBoardGameCheckout(null);
      setPayments([{ id: "payment-1", method: "cash", amount: 0, tendered: 0 }]);
      setActiveModule("boardgame");
    }
    setError("");
    setNotice("");
    sendFlow("BACK_TO_CATALOG");
  };

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
      boardGameBillingGroupId: boardGameCheckout?.id ?? null,
      lines: (boardGameCheckout ? [] : cart).map((line) => ({
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
      payments: (zeroDueBoardGameBill ? [] : payments).map((payment) => ({
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
    if (!cashier || busy || !canConfirmPayment || (!boardGameCheckout && cart.length === 0)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!saleAttemptRef.current) {
        const current = boardGameCheckout ? true : await recheckCartPricing();
        if (!current) return;
        const key = createIdempotencyKey(boardGameCheckout ? "desktop-board-game-sale" : "desktop-sale");
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
    const completedBoardGameBill = Boolean(boardGameCheckout);
    if (!completedBoardGameBill) setCart([]);
    setBoardGameCheckout(null);
    setReceipt(null);
    setPayments([{ id: "payment-1", method: "cash", amount: 0, tendered: 0 }]);
    setError("");
    setNotice("");
    saleAttemptRef.current = null;
    setActiveModule(completedBoardGameBill ? "boardgame" : "mobile_sell");
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
          {error
            ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert>
            : <p>ตรวจสอบเซิร์ฟเวอร์และสิทธิ์ของอุปกรณ์…</p>}
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
            <label className={styles.pinLabel}>PIN 4–8 หลัก
              <span className={styles.pinEntry}>
                <input
                  className={styles.pinInput}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={POS_PIN_MAX_LENGTH}
                  value={pin}
                  onChange={(event) => setPin(normalizePosPinInput(event.target.value))}
                  aria-label="PIN พนักงาน 4–8 หลัก"
                />
                <span className={styles.pinDots} aria-hidden="true">
                  {Array.from({ length: visiblePosPinSlots(pin) }, (_, index) => (
                    <i key={index} data-filled={index < pin.length} />
                  ))}
                </span>
              </span>
            </label>
            {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
            <button className={styles.primaryButton} disabled={!cashierId || !isPosPinValid(pin) || busy}>
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
          {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
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
            <button className={styles.primaryButton} onClick={newSale}>
              {boardGameCheckout ? "กลับหน้าบอร์ดเกม" : "ขายรายการใหม่"}
            </button>
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
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.storeIdentity}>
            <div className={styles.storeMark}>{(bootstrap.location?.name || "B").slice(0, 1)}</div>
            <div><strong>{bootstrap.location?.name ?? "สาขาหลัก"}</strong><span>{bootstrap.device.registeredPosNo ?? bootstrap.device.code} · กะเปิดอยู่</span></div>
          </div>
          <div className={styles.topMeta}>
            <span className={`${styles.connection} ${styles[connection]}`}><i />{connection === "online" ? "ออนไลน์" : connection === "checking" ? "กำลังเชื่อมต่อ" : "การเชื่อมต่อมีปัญหา"}</span>
            <details className={styles.alertMenu}>
              <summary
                className={`${styles.alertBell}${alerts.settings.enabled ? ` ${styles.alertBellOn}` : ""}${alerts.blocked ? ` ${styles.alertBellBlocked}` : ""}`}
                aria-label={`การแจ้งเตือน${serviceCalls.length ? ` ${serviceCalls.length} รายการ` : ""}`}
                title={serviceCalls.length ? `มีลูกค้าเรียก ${serviceCalls.length} รายการ` : "การแจ้งเตือน"}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                </svg>
                {!alerts.settings.enabled ? <span className={styles.alertBellSlash} aria-hidden="true" /> : null}
                {serviceCalls.length > 0
                  ? <span className={styles.alertCount} aria-hidden="true">{serviceCalls.length > 99 ? "99+" : serviceCalls.length}</span>
                  : alerts.blocked ? <span className={styles.alertBellDot} aria-hidden="true" /> : null}
              </summary>
              <div className={styles.alertPopover}>
                <div className={styles.alertPopoverHead}>
                  <div><strong>การแจ้งเตือน</strong><small>{serviceCalls.length ? `ลูกค้าเรียก ${serviceCalls.length} รายการ` : "ไม่มีคำเรียกที่รอรับ"}</small></div>
                  <button type="button" onClick={() => setAlertSettingsOpen(true)} aria-label="ตั้งค่าเสียงแจ้งเตือน">⚙ ตั้งค่าเสียง</button>
                </div>
                <div className={styles.alertList}>
                  {serviceCalls.length === 0 ? (
                    <div className={styles.alertEmpty}><span aria-hidden="true">✓</span><p>รับคำเรียกครบแล้ว</p></div>
                  ) : serviceCalls.map((call) => (
                    <article className={styles.alertItem} key={`${call.source}:${call.id}`}>
                      <button type="button" className={styles.alertItemMain} onClick={() => openServiceCall(call)}>
                        <span className={styles.alertItemIcon} aria-hidden="true">🔔</span>
                        <span><strong>{call.tableName || call.tableCode}</strong><b>{serviceCallLabel(call)}</b><small>{serviceCallAge(call.createdAt)} · {call.source === "restaurant" ? "ร้านอาหาร" : "บอร์ดเกม"}</small></span>
                      </button>
                      <button type="button" className={styles.alertAccept} disabled={serviceCallsBusy === call.id} onClick={() => void acknowledgeServiceCall(call)}>
                        {serviceCallsBusy === call.id ? "กำลังรับ…" : "รับเรื่อง"}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </details>
            <details className={styles.accountMenu}>
              <summary aria-label={`เมนูพนักงาน ${cashier?.name || cashier?.email || ""}`}>
                <span className={styles.accountAvatar} aria-hidden="true">
                  {(cashier?.name || cashier?.email || "พ").slice(0, 1)}
                </span>
                <span className={styles.accountCopy}>
                  <strong>{cashier?.name || cashier?.email}</strong>
                  <small>พนักงานขาย</small>
                </span>
                <span className={styles.accountChevron} aria-hidden="true">⌄</span>
              </summary>
              <div className={styles.accountPopover}>
                <button className={styles.accountSignOut} onClick={signOutCashier}>
                  ล็อก / เปลี่ยนพนักงาน
                </button>
              </div>
            </details>
          </div>
        </header>

        {activeModule !== "mobile_sell" && activeModule !== "restaurant" ? (
          <div className={`${styles.content} ${styles.moduleContent}`}>
            <section
              className={`${styles.moduleHost}${activeModule === "boardgame" ? ` ${styles.boardGameModuleHost}` : ""}`}
            >
              <PosWorkspaceContext.Provider value={{
                embedded: true,
                initialTab: activeModule,
                initialToken: token,
                initialCashierId: cashier?.id ?? cashierId,
                initialPin: pin,
                onTabChange: followWorkspaceTab,
                onShiftChange: followWorkspaceShift,
                onUnpair: unpair,
                onBoardGameCheckout: openBoardGameCheckout,
                onServiceCallsChange: acceptBoardGameServiceCalls,
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
                  <button className={styles.backButton} onClick={backFromCheckout}>
                    ← {boardGameCheckout ? "กลับหน้าบอร์ดเกม" : "กลับไปแก้รายการ"}
                  </button>
                  <div>
                    <p className={styles.eyebrow}>ตรวจสอบก่อนรับเงิน</p>
                    <h1>{boardGameCheckout ? "สรุปบิลบอร์ดเกม" : "สรุปรายการขาย"}</h1>
                  </div>
                </div>
                <div className={styles.orderSummary}>
                  {boardGameCheckout ? (
                    <>
                      <article className={styles.serviceLine}>
                        <div className={`${styles.productThumb} ${styles.serviceThumb}`} aria-hidden="true">◷</div>
                        <div>
                          <strong>
                            ค่าเล่นบอร์ดเกม · {boardGameCheckout.tableName}
                            {boardGameCheckout.sessionGroupCount > 1 ? ` · กลุ่ม ${boardGameCheckout.groupNo}` : ""}
                          </strong>
                          <span>
                            {boardGameCheckout.chargeLineCount} คน · ปิดเวลา {new Date(boardGameCheckout.endedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <strong>{money(boardGameCheckout.amountDue)}</strong>
                      </article>
                      {boardGameCheckout.tabItemCount > 0 ? (
                        <article className={styles.serviceLine}>
                          <div className={`${styles.productThumb} ${styles.serviceThumb}`} aria-hidden="true">▤</div>
                          <div>
                            <strong>สินค้าที่สั่งเข้าบิล</strong>
                            <span>{boardGameCheckout.tabItemCount} รายการ · รวมจากแท็บของกลุ่มนี้</span>
                          </div>
                          <strong>{money(boardGameCheckout.tabAmount)}</strong>
                        </article>
                      ) : null}
                      {boardGameBenefitAmount > 0 ? (
                        <div className={styles.serviceBenefit}>
                          <strong>
                            {boardGameCheckout.offerDiscountAmount > 0
                              ? `โปรโมชัน ${boardGameCheckout.offerName ?? boardGameCheckout.offerCode ?? "ค่าเล่น"}`
                              : "ใช้แพ็กเกจสมาชิกแล้ว"}
                          </strong>
                          <span>
                            {boardGameCheckout.offerDiscountAmount > 0
                              ? `ลดค่าเล่น ${money(boardGameCheckout.offerDiscountAmount)}`
                              : `แพ็กเกจครอบคลุมค่าเล่น ${money(boardGameCheckout.passCoveredAmount)}`}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : cart.map((line) => (
                    <article key={line.key}>
                      <div className={styles.productThumb}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : line.name.slice(0, 1)}</div>
                      <div><strong>{line.name}</strong><span>{line.sku}{line.size ? ` · ${line.size}` : ""}</span></div>
                      <span>{line.qty} × {money(Number(line.packBasePrice ?? line.unitPrice ?? 0))}</span>
                    </article>
                  ))}
                </div>
                <div className={styles.summaryTotals}>
                  {boardGameCheckout ? (
                    <>
                      <div><span>ค่าเล่นก่อนสิทธิ์</span><strong>{money(boardGameGrossTime)}</strong></div>
                      {boardGameBenefitAmount > 0 ? (
                        <div className={styles.savingsRow}>
                          <span>{boardGameCheckout.offerDiscountAmount > 0 ? "โปรโมชันค่าเล่น" : "แพ็กเกจสมาชิก"}</span>
                          <strong>−{money(boardGameBenefitAmount)}</strong>
                        </div>
                      ) : null}
                      {boardGameCheckout.tabItemCount > 0 ? <div><span>สินค้าที่สั่งเข้าบิล</span><strong>{money(boardGameCheckout.tabAmount)}</strong></div> : null}
                    </>
                  ) : (
                    <>
                      <div><span>ยอดสินค้าราคาป้าย</span><strong>{money(retailListSubtotal)}</strong></div>
                      {pricingSavings > 0 ? <div className={styles.savingsRow}><span>ราคาส่ง / โปรโมชัน</span><strong>−{money(pricingSavings)}</strong></div> : null}
                    </>
                  )}
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
                {(error || notice) ? <PosDismissibleAlert key={error || notice} className={error ? styles.errorBox : styles.noticeBox} onClose={() => { setError(""); setNotice(""); }}>{error || notice}{notice ? <button onClick={() => openModule("sell")}>เปิดหน้าขายแบบเต็ม</button> : null}</PosDismissibleAlert> : null}
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
              <div><span>{checkout ? "ยอดชำระ" : "บิลปัจจุบัน"}</span><small>{billCountLabel}</small></div>
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
                {zeroDueBoardGameBill ? (
                  <PosDismissibleAlert className={styles.zeroDueNotice} role="status">
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>บิลนี้ไม่ต้องรับเงินเพิ่ม</strong>
                      <p>
                        {boardGameCheckout?.passCoveredAmount
                          ? `แพ็กเกจสมาชิกครอบคลุมค่าเล่น ${money(boardGameCheckout.passCoveredAmount)}`
                          : "ยอดสุทธิของกลุ่มนี้เป็นศูนย์"}
                      </p>
                    </div>
                  </PosDismissibleAlert>
                ) : (
                  <>
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
                      {payments.length > 1 ? (
                        <div className={styles.paymentRowHead}>
                          <label>ช่องทาง
                            <select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PosPaymentMethod, reference: event.target.value === "cash" ? undefined : "", tendered: event.target.value === "cash" ? payment.amount : undefined })}>
                              {[...primaryMethods, "bank_transfer" as const].map((method) => <option key={method} value={method}>{paymentMethodLabel(method)}</option>)}
                            </select>
                          </label>
                          <label>ยอดช่องทางนี้<input inputMode="decimal" value={payment.amount || ""} onChange={(event) => updatePayment(payment.id, { amount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <button className={styles.removePayment} onClick={() => setPayments((current) => current.filter((item) => item.id !== payment.id))}>ลบ</button>
                        </div>
                      ) : null}
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
                  </>
                )}
                {(error || notice || (!zeroDueBoardGameBill && validation.errors.length > 0)) ? <PosDismissibleAlert key={error || notice || validation.errors[0]} className={error ? styles.errorBox : styles.noticeBox} onClose={() => { setError(""); setNotice(""); }}>{error || notice || validation.errors[0]?.replace("ทดสอบ", "")}</PosDismissibleAlert> : null}
                <div className={styles.paymentFooter}>
                  <div><span>{validation.remaining > 0 && !zeroDueBoardGameBill ? "ยังขาด" : zeroDueBoardGameBill ? "พร้อมปิดบิล" : "พร้อมรับชำระ"}</span><strong>{validation.remaining > 0 && !zeroDueBoardGameBill ? money(validation.remaining) : money(total)}</strong></div>
                  <button className={styles.payButton} disabled={!canConfirmPayment || busy} onClick={() => void submitSale()}>{busy ? "กำลังบันทึก…" : saleAttemptRef.current ? "ลองบันทึกซ้ำด้วยรหัสเดิม" : zeroDueBoardGameBill ? "ยืนยันปิดบิล" : `ยืนยันรับชำระ ${money(total)}`}</button>
                </div>
              </div>
            )}
          </aside>
        </div>
        )}
      </section>
      <OrderAlertSettingsModal
        open={alertSettingsOpen}
        onClose={() => setAlertSettingsOpen(false)}
        alerts={alerts}
        kinds={ALERT_KINDS}
      />
      {!hasDesktopPosBridge() ? <div className={styles.browserBadge}>Browser preview · Electron จะเก็บ device token ใน OS keychain</div> : null}
    </main>
  );
}
