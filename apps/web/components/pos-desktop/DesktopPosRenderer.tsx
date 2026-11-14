"use client";

import { usePosText, thaiPosText, type PosTranslator } from "@/lib/pos/usePosText";

import { PosLanguageSetting } from "@/components/pos/PosLanguageProvider";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoCircleOutlined, ReloadOutlined, PrinterOutlined, CheckCircleOutlined, ShopOutlined, SettingOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import ProductDetailsModal from "./ProductDetailsModal";
import ScannedProductPanel, { type ScannedProductResult } from "./ScannedProductPanel";
import { editCheckoutPayment, syncSingleCheckoutPayment, type CheckoutPayment } from "./checkoutPayment";
import { ConfigProvider, Modal, theme as antdTheme } from "antd";
import CheckoutBenefits, { benefitsPayable, useCheckoutBenefits } from "./CheckoutBenefits";
import {
  initialPosClientFlow,
  transitionPosClientFlow,
  type PosClientEvent,
  type PosClientFlowState,
} from "@pos-core/flow";
import { createIdempotencyKey, posErrorConnectionStatus } from "@pos-core/operation";
import { PosSaleResultError } from "@pos-core/saleRetry";
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
  cartProductPricing,
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
  POS_LAST_SALE_QUERY,
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
  openDesktopAdmin,
  readDesktopAppInfo,
  readPosDeviceToken,
  type DesktopAppInfo,
} from "@/lib/pos/deviceTokenClient";
import {
  CUSTOMER_DISPLAY_CHANNEL,
  displayBrand, displayMemberName,
  EMPTY_CUSTOMER_DISPLAY,
  type CustomerDisplayPayload,
} from "@/lib/pos/customerDisplay";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import OrderAlertSettingsModal from "@/components/pos/OrderAlertSettingsModal";
import {
  PosWorkspaceContext,
  type PosServiceCallNotice,
  type PosTab,
} from "@/components/pos/PosWorkspaceContext";
import { usePosOperatorSession } from "@/components/pos/PosOperatorSession";
import { usePosStartupPreparation } from "@/components/pos/PosStartupPreparation";
import PosDismissibleAlert from "@/components/pos/PosDismissibleAlert";
import {
  PosConnectionStatus,
  useRealtimeInvalidation,
  useRealtimeStatus,
} from "@/components/realtime/RealtimeProvider";
import { ALERT_KINDS, newAlertIds } from "@/lib/pos/orderAlertSound";
import { copyTextToClipboard } from "@/lib/pos/clipboard";
import ReceiptPaper from "@/components/pos/ReceiptPaper";
import { hasDesktopPrinterBridge, printDesktopReceipt } from "@/lib/pos/desktopPrinterClient";
import ReceiptPrinterSettings from "./ReceiptPrinterSettings";
import ReceiptPrinterStatus from "./ReceiptPrinterStatus";
import DesktopUpdateMenu from "./DesktopUpdateMenu";
import GiftPromotionSummary from "@/components/pos/GiftPromotionSummary";
import { useReceiptPrinter } from "./useReceiptPrinter";
import type { ReceiptPayload } from "@/lib/pos/escpos";
import { isReceiptLanguageMode } from "@/lib/pos/receiptI18n";
import { receiptPayloadFromPosSale, type PosSaleReceiptRow } from "@/lib/pos/posSaleReceipt";
import styles from "./DesktopPosRenderer.module.css";

const loadAdvancedPosModule = () => import("@/app/(pos)/pos/page");
const loadBoardGameModule = () => import("@/components/pos/BoardGamePanel");
const PosPage = dynamic(loadAdvancedPosModule, {
  loading: () => <DesktopModuleLoading label="กำลังเปิดเครื่องมือขาย…" />,
});
const BoardGamePanel = dynamic(loadBoardGameModule, {
  loading: () => <DesktopModuleLoading label="กำลังเปิดพื้นที่บอร์ดเกม…" />,
});

function DesktopModuleLoading({ label }: { label: string }) {
  const posText = usePosText();
  return (
    <div className={styles.moduleLoading} role="status">
      <span className={styles.catalogSpinner} aria-hidden="true" />
      <strong>{posText(label)}</strong>
    </div>
  );
}

type CartLine = PricedCartLine & {
  key: string;
  name: string;
  unitName: string;
  modifierCodes: string[];
  serials: string[];
  serialTracked: boolean;
  imageUrl: string | null;
  /** Branch stock from the last scan; a ceiling only when `stockTracked`. */
  available: number;
  stockTracked: boolean;
};

/**
 * Items the compact screen cannot collect (serial, weight, options) go to the full sell workspace.
 * The button that opens it is offered only with this notice: the compact cart does not move with
 * it, so offering it beside an unrelated notice sends the cashier away from a bill in progress.
 */
// Stable notice identity keeps the full-workspace action available across language changes.
const ADVANCED_ITEM_NOTICE = "ADVANCED_ITEM_NOTICE";

type SaleResult = {
  completedAt?: number;
  displayMember?: { attached: boolean; name: string | null };
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
  pointsEarned: number | null;
  pointsBalance: number | null;
  pickupQueue?: { id: string; queueNo: number; label: string } | null;
  pickupQueueError?: string | null;
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

const CATALOG_REALTIME_EVENTS = [
  "inventory.changed",
  "inventory.reservation_changed",
  "product.availability.changed",
  "menu.availability.changed",
] as const;

const SERVICE_CALL_REALTIME_EVENTS = [
  "restaurant.table_call.created",
  "restaurant.table_call.status_changed",
  "board_game.table_call.created",
  "board_game.table_call.status_changed",
] as const;

type DesktopModule = "mobile_sell" | "restaurant" | PosTab;
type DesktopInfoDialog = "help" | "about" | null;
type LoginPhase = "idle" | "verifying" | "preparing";

const money = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(value);

const BOARD_GAME_PARTICIPANT_LABEL = (posText: PosTranslator = thaiPosText): Record<string, string> => ({
  GENERAL: posText("ทั่วไป"),
  STUDENT: posText("นักเรียน/นักศึกษา"),
  MEMBER: posText("สมาชิก"),
  CHILD: posText("เด็ก"),
  GUARDIAN: posText("ผู้ปกครอง"),
  OBSERVER: posText("ผู้สังเกตการณ์"),
  FOOD_ONLY: posText("อาหารและเครื่องดื่มเท่านั้น"),
  CUSTOM: posText("อัตราพิเศษ"),
});

function boardGameTime(value: string | null, posText: PosTranslator = thaiPosText): string {
  if (!value) return "–";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "–";
  return date.toLocaleTimeString(posText.locale, { hour: "2-digit", minute: "2-digit" });
}

function boardGameDateTime(value: string | null, posText: PosTranslator = thaiPosText): string {
  if (!value) return "–";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "–";
  return date.toLocaleString(posText.locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function boardGameMinutes(value: number | null | undefined, posText: PosTranslator = thaiPosText): string {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  if (!hours) return posText("{v0} นาที", { v0: minutes });
  return minutes % 60 ? posText("{v0} ชม. {v1} นาที", { v0: hours, v1: minutes % 60 }) : posText("{v0} ชม.", { v0: hours });
}

const BOARD_GAME_OFFER_STATUS = (posText: PosTranslator = thaiPosText): Record<string, string> => ({
  NO_ACTIVE_OFFERS: posText("ไม่มีโปรค่าเล่นที่เปิดใช้สำหรับสาขานี้ ณ ตอนปิดบิล"),
  INELIGIBLE: posText("บิลนี้ไม่เข้าเงื่อนไขโปรค่าเล่น ณ ตอนปิดบิล"),
  NO_SAVING: posText("เข้าเงื่อนไขโปร แต่ยังไม่มีส่วนลดจากเวลาที่คิดในบิลนี้"),
  PASS_BETTER: posText("ใช้แพ็กเกจสมาชิก เพราะยอดถูกกว่าโปรค่าเล่น"),
  NO_CHARGE: posText("ไม่มีค่าเวลาที่ต้องนำมาลดด้วยโปร"),
});
const BOARD_GAME_OFFER_REASON = (posText: PosTranslator = thaiPosText): Record<string, string> => ({
  INACTIVE: posText("โปรไม่ได้เปิดใช้งาน"),
  MIN_PLAYERS: posText("จำนวนผู้เล่นที่คิดเงินไม่ถึงขั้นต่ำของโปร"),
  MAX_PLAYERS: posText("จำนวนผู้เล่นที่คิดเงินเกินจำนวนสูงสุดของโปร"),
  INVALID_TIME_RULE: posText("ข้อมูลโปรซื้อเวลาแถมเวลาหรือเรทเวลาไม่ครบถ้วน"),
  MINIMUM_MINUTES: posText("มีผู้เล่นที่เวลาคิดเงินยังไม่ถึงขั้นต่ำของโปร"),
  REQUIRED_PRODUCT: posText("ยังไม่มีสินค้าที่โปรกำหนดในรายการสั่งของกลุ่มบิลนี้"),
  NOT_STARTED: posText("โปรยังไม่เริ่ม ณ เวลาปิดบิล"),
  EXPIRED: posText("โปรหมดอายุ ณ เวลาปิดบิล"),
  WEEKDAY: posText("วันที่ปิดบิลไม่ใช่วันในสัปดาห์ที่โปรกำหนด"),
  TIME_WINDOW: posText("เวลาปิดบิลอยู่นอกช่วงเวลาของโปร"),
});

function BoardGameBillBreakdown({
  checkout,
  receipt = false,
}: {
  checkout: PosBoardGameCheckout;
  receipt?: boolean;
}) {
  const posText = usePosText();
  return (
    <div className={`${styles.boardGameBreakdown} ${receipt ? styles.boardGameBreakdownReceipt : ""}`.trim()}>
      <section className={styles.boardGameBreakdownSection}>
        <div className={styles.boardGameBreakdownHead}>
          <div>
            <strong>{posText("ค่าเวลาเล่น ·") + " "}{checkout.tableName}</strong>
            <span>
              {checkout.sessionGroupCount > 1 ? posText("กลุ่ม {v0} · ", { v0: checkout.groupNo }) : ""}
              {checkout.billingMode === "FIXED_DURATION" ? posText("ซื้อเวลาไว้ล่วงหน้า") : posText("คิดตามเวลาที่เล่นจริง")}
              {` · ${boardGameDateTime(checkout.startedAt, posText)}–${boardGameDateTime(checkout.endedAt, posText)}`}
            </span>
          </div>
          <strong>{money(checkout.amountDue)}</strong>
        </div>
        <div className={styles.boardGameBreakdownRows}>
          {checkout.chargeLines.map((line, index) => {
            const rateName = line.rateName
              || BOARD_GAME_PARTICIPANT_LABEL(posText)[line.participantType]
              || line.participantType;
            const hasDifferentChargedEnd = Boolean(
              line.chargedUntil && line.actualEndedAt
              && new Date(line.chargedUntil).getTime() !== new Date(line.actualEndedAt).getTime()
            );
            const benefit = Math.max(0, Number(line.grossAmount ?? line.amount) - Number(line.amount));
            return (
              <div key={line.participantId} className={styles.boardGameBreakdownRow}>
                <span className={styles.boardGamePersonIndex}>{index + 1}</span>
                <div>
                  <strong>{line.displayName || posText("ผู้เล่น {v0}", { v0: index + 1 })}</strong>
                  <span>
                    {boardGameTime(line.joinedAt, posText)}–{boardGameTime(line.actualEndedAt, posText)}
                    {posText(" · เล่นจริง ")}{boardGameMinutes(line.actualMinutes, posText)}
                  </span>
                  <span>
                    {rateName} · {money(line.hourlyRate)}{posText("/ชม.") + " "}{posText(" · เวลาก่อนสิทธิ์ ")}{boardGameMinutes(line.billableMinutes, posText)}
                    {hasDifferentChargedEnd ? posText(" ถึง {v0}", { v0: boardGameTime(line.chargedUntil, posText) }) : ""}
                  </span>
                  {line.offerPaidMinutes != null && line.offerFreeMinutes != null ? (
                    <span>
                      {posText("ตามโปร: จ่าย") + " "}{boardGameMinutes(line.offerPaidMinutes, posText)} {" " + posText("· ฟรี") + " "}{boardGameMinutes(line.offerFreeMinutes, posText)}
                    </span>
                  ) : null}
                  {benefit > 0 ? <em>{posText("สิทธิ์ช่วยลด") + " "}{money(benefit)}</em> : null}
                </div>
                <strong>{money(line.amount)}</strong>
              </div>
            );
          })}
        </div>
        {!receipt && checkout.offerEvaluation?.status !== "APPLIED" ? (
          <div className={styles.boardGameOfferEvaluation} role="status">
            {checkout.offerEvaluation ? (
              <>
                <strong>{BOARD_GAME_OFFER_STATUS(posText)[checkout.offerEvaluation.status] || posText("ไม่พบคำอธิบายผลโปรค่าเล่น")}</strong>
                {checkout.offerEvaluation.checks.length > 0 ? (
                  <details>
                    <summary>{posText("เหตุผลที่โปรไม่เข้า")}</summary>
                    <ul>
                      {checkout.offerEvaluation.checks.map((check) => (
                        <li key={check.offerCode}>
                          {check.offerName} ({check.offerCode}): {BOARD_GAME_OFFER_REASON(posText)[check.reason] || posText("ข้อมูลเงื่อนไขไม่ครบถ้วน")}
                        </li>
                      ))}
                    </ul>
                    {checkout.offerEvaluation.omittedCount > 0 ? <span>{posText("ยังมีอีก") + " "}{checkout.offerEvaluation.omittedCount} {" " + posText("โปรที่ไม่เข้าเงื่อนไข")}</span> : null}
                  </details>
                ) : null}
              </>
            ) : checkout.offerDiscountAmount <= 0 ? (
              <span>{posText("บิลนี้ไม่ได้บันทึกเหตุผลการเลือกโปรไว้ จึงตรวจย้อนหลังจากการตั้งค่าปัจจุบันไม่ได้")}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      {checkout.tabItems.length > 0 ? (
        <section className={styles.boardGameBreakdownSection}>
          <div className={styles.boardGameBreakdownHead}>
            <div>
              <strong>{posText("อาหารและเครื่องดื่ม")}</strong>
              <span>
                {checkout.tabItems.length} {" " + posText("บรรทัดในบิล") + " "}{checkout.tabItemCount !== checkout.tabItems.length
                  ? posText(" · รวมจาก {v0} รายการที่สั่ง", { v0: checkout.tabItemCount }) : ""}
              </span>
            </div>
            <strong>{money(checkout.tabAmount)}</strong>
          </div>
          <div className={styles.boardGameBreakdownRows}>
            {checkout.tabItems.map((item) => (
              <div key={item.id} className={styles.boardGameProductRow}>
                <div>
                  <strong>{item.productName}</strong>
                  <span>
                    {item.size ? `${item.size} · ` : ""}
                    {item.quantity} {item.unitName || posText("ชิ้น")} × {money(item.unitPrice)}
                  </span>
                </div>
                <strong>{money(item.amount)}</strong>
              </div>
            ))}
            {checkout.tabPricingDiscountAmount > 0 ? (
              <div className={`${styles.boardGameProductRow} ${styles.boardGameDiscountRow}`.trim()}>
                <div>
                  <strong>{posText("ส่วนลดสินค้า")}</strong>
                  <span>{posText("ราคาส่ง / โปรโมชันที่ระบบคำนวณให้")}</span>
                </div>
                <strong>−{money(checkout.tabPricingDiscountAmount)}</strong>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function serviceCallLabel(call: PosServiceCallNotice, posText: PosTranslator = thaiPosText): string {
  const labels: Record<string, string> = {
    WATER: posText("ขอน้ำ"),
    CUTLERY: posText("ขอช้อนส้อม"),
    BILL: posText("เรียกเก็บเงิน"),
    MENU_HELP: posText("ขอความช่วยเหลือเรื่องเมนู"),
    GAME_HELP: posText("ช่วยสอนหรืออธิบายเกม"),
    GAME_ISSUE: posText("ชิ้นส่วนขาด / เกมชำรุด"),
    FOOD_DRINK: posText("อาหารหรือเครื่องดื่ม"),
    EXTEND_TIME: posText("ขอต่อเวลา"),
    CLEANUP: posText("น้ำหก / ขอทำความสะอาด"),
    OTHER: posText("ขอความช่วยเหลืออื่น ๆ"),
  };
  const label = labels[call.requestCode];
  if (label && call.requestNote) return `${label} · ${call.requestNote}`;
  return label ?? call.requestNote ?? posText("เรียกพนักงาน");
}

function serviceCallAge(createdAt: string, posText: PosTranslator = thaiPosText): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  return minutes < 1 ? posText("เมื่อสักครู่") : posText("{v0} นาทีที่แล้ว", { v0: minutes });
}

function messageOf(error: unknown, posText: PosTranslator = thaiPosText): string {
  return error instanceof Error ? error.message : posText("เกิดข้อผิดพลาด กรุณาลองใหม่");
}

function cartVariantBaseQty(lines: readonly CartLine[], target: Pick<CartLine, "sku" | "size">): number {
  return lines.reduce((sum, line) => line.sku === target.sku && line.size === target.size
    ? sum + line.qty * line.baseQty : sum, 0);
}

function resolvedCartLine(hit: PosScanHit, posText: PosTranslator = thaiPosText): CartLine {
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
    unitName: hit.unitName || posText("ชิ้น"),
    priceTiers: normalizePriceTiers(hit.priceTiers),
    promotion: normalizePromotion(hit.promotion),
    modifierCodes: [],
    serials: [],
    serialTracked: Boolean(hit.serialTracked),
    imageUrl: hit.imageUrl,
    available: Math.max(0, Number(hit.available) || 0),
    // Older servers do not send the flag; keep their previous behaviour (treat stock as tracked).
    stockTracked: hit.stockTracked !== false,
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

  // This register has a light-only palette. Keep Ant controls and body-portalled
  // selects on that palette without changing the user's admin/restaurant theme.
  return <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}
    select={{ classNames: { popup: { root: styles.lightTheme } } }}
    modal={{ classNames: { wrapper: styles.lightTheme } }}>
    <DesktopPosContent />
  </ConfigProvider>;
}

function DesktopPosContent() {
  const posText = usePosText();
  const { t } = useI18n();
  const receiptPrinter = useReceiptPrinter();
  const router = useRouter();
  const { operator: rememberedOperator, rememberOperator, clearOperator } = usePosOperatorSession();
  const {
    prepareRestaurantWorkspace,
    prepareBoardGameWorkspace,
    clearPreparedWorkspaces,
  } = usePosStartupPreparation();
  const rememberedOperatorRef = useRef(rememberedOperator);
  rememberedOperatorRef.current = rememberedOperator;
  const desktopRootRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [token, setToken] = useState("");
  const tokenRef = useRef("");
  const [flow, setFlow] = useState<PosClientFlowState>(() => initialPosClientFlow(true));
  const [bootstrap, setBootstrap] = useState<PosBootstrap | null>(null);
  const [failedStoreLogoUrl, setFailedStoreLogoUrl] = useState<string | null>(null);
  const storeLogoUrl = bootstrap?.store.logoUrl?.trim() || null;
  const [cashier, setCashier] = useState<PosCashier | null>(null);
  const [cashierId, setCashierId] = useState("");
  const [pin, setPin] = useState("");
  const [loginPhase, setLoginPhase] = useState<LoginPhase>("idle");
  const [verifiedLogin, setVerifiedLogin] = useState<PosCashier | null>(null);
  const [openingFloat, setOpeningFloat] = useState("0");
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const scanDraftRevision = useRef(0);
  const [scannedProduct, setScannedProduct] = useState<ScannedProductResult | null>(null);
  const scanResultVersion = useRef(0);
  const clearScannedProduct = useCallback(() => {
    scanResultVersion.current += 1;
    setScannedProduct(null);
  }, []);
  const [inspectedProduct, setInspectedProduct] = useState<{ code: string; size?: string; packCode?: string } | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  // A timed-play bill is a frozen billing group, not a synthetic product. Keep it outside
  // the retail cart so collecting one group never consumes or discards a sale in progress.
  const [boardGameCheckout, setBoardGameCheckout] = useState<PosBoardGameCheckout | null>(null);
  const [payments, setPayments] = useState<CheckoutPayment[]>([
    { id: "payment-1", method: "cash", amount: 0, tendered: 0 },
  ]);
  const [receipt, setReceipt] = useState<SaleResult | null>(null);
  // The paper comes from the saved bill, never from the cart on screen: the sale result carries
  // no lines, discounts, tax-document number or VAT split. Null while it loads or when it failed.
  const [receiptPaper, setReceiptPaper] = useState<ReceiptPayload | null>(null);
  const [receiptPaperState, setReceiptPaperState] = useState<"idle" | "loading" | "failed">("idle");
  const [receiptPrinting, setReceiptPrinting] = useState(false);
  const receiptPrintingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [addingProductKey, setAddingProductKey] = useState("");
  const [notice, setNotice] = useState("");
  const noticeText = notice === ADVANCED_ITEM_NOTICE
    ? posText("สินค้านี้ต้องกรอก serial / น้ำหนัก / ตัวเลือกเพิ่มเติม จึงต้องขายในหน้าขายแบบเต็มเพื่อไม่ข้ามการตรวจสอบ") : notice;
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"checking" | "online" | "offline">("checking");
  const { status: realtimeStatus } = useRealtimeStatus();
  // Reuse the established per-device alert store. The desktop shell exposes the control, but
  // notification rules and playback remain owned by the existing POS alert pipeline.
  const alerts = useOrderAlerts(Boolean(bootstrap && cashier));
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const [deviceLanguageOpen, setDeviceLanguageOpen] = useState(false);
  const [serviceCalls, setServiceCalls] = useState<PosServiceCallNotice[]>([]);
  const [serviceCallsBusy, setServiceCallsBusy] = useState("");
  const [desktopInfoDialog, setDesktopInfoDialog] = useState<DesktopInfoDialog>(null);
  const [desktopAppInfo, setDesktopAppInfo] = useState<DesktopAppInfo | null>(null);
  const [desktopAppInfoLoaded, setDesktopAppInfoLoaded] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const pendingServiceCallCount = serviceCalls.filter((call) => call.status === "PENDING").length;
  const acknowledgedServiceCallCount = serviceCalls.length - pendingServiceCallCount;
  const knownServiceCallIds = useRef<Set<string> | null>(null);
  const [activeModule, setActiveModule] = useState<DesktopModule>("mobile_sell");
  // A pharmacy's sale gate (pharmacist review queue, pharmacist PIN at the counter, clinical
  // evidence) exists only in the full sell workspace. The compact desktop sell screen sends every
  // pharmacy field as null, so a regulated item would reach the server, be refused, and leave the
  // cashier with no way forward. Pharmacy registers therefore always sell in the full workspace;
  // every existing "go home" transition keeps writing "mobile_sell" and is mapped here once.
  const pharmacyRegister = bootstrap?.businessArchetype === "pharmacy";
  const shownModule: DesktopModule =
    pharmacyRegister && activeModule === "mobile_sell" ? "sell" : activeModule;
  useEffect(() => {
    if (shownModule !== "mobile_sell" || flow.stage !== "CATALOG") return;
    const focusScan = (event: KeyboardEvent) => {
      if (event.key !== "F12" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      // Do not pull focus out of a product, payment, or settings dialog.
      if (Array.from(document.querySelectorAll('[role="dialog"]')).some((dialog) => dialog.getClientRects().length > 0)) return;
      const input = scanInputRef.current;
      if (!input || input.disabled || !input.getClientRects().length) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", focusScan);
    return () => document.removeEventListener("keydown", focusScan);
  }, [flow.stage, shownModule]);
  // Whichever workspace is visibly selling owns the customer display. Two publishers on one
  // BroadcastChannel would let the empty desktop cart overwrite the bill the customer is paying.
  const desktopOwnsCustomerDisplay = shownModule !== "sell";
  const desktopOwnsCustomerDisplayRef = useRef(desktopOwnsCustomerDisplay);
  desktopOwnsCustomerDisplayRef.current = desktopOwnsCustomerDisplay;
  const [contentRefreshSignal, setContentRefreshSignal] = useState(0);
  const [contentRefreshing, setContentRefreshing] = useState(false);
  const contentRefreshingRef = useRef(false);
  const saleAttemptRef = useRef<{ key: string; payload: SalePayload; displayMember: { attached: boolean; name: string | null } } | null>(null);
  const saleSubmittingRef = useRef(false);
  const addProductPendingRef = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalogRequestVersion = useRef(0);
  const catalogLoadErrorRef = useRef("");
  const catalogRequestRef = useRef<{
    token: string;
    query: string;
    promise: Promise<void>;
  } | null>(null);
  const catalogPrimedRef = useRef<{ token: string; at: number } | null>(null);
  const customerDisplayChannelRef = useRef<BroadcastChannel | null>(null);
  const customerDisplayPayloadRef = useRef<CustomerDisplayPayload>(EMPTY_CUSTOMER_DISPLAY);
  const restaurantPreparedRef = useRef(false);

  useEffect(() => {
    // “งานอื่น” จากร้านอาหารต้องลงโมดูลที่พนักงานเลือกไว้ ไม่ใช่เปิดหน้าขายทุกครั้ง
    // query เป็นเพียง navigation hint; สิทธิ์และ PIN ยังตรวจที่ mutation เดิมทุกตัว
    const requested = new URLSearchParams(window.location.search).get("module");
    if (requested === "mobile_sell" || requested === "returns" || requested === "stock" || requested === "deposits") {
      setActiveModule(requested);
    }
  }, []);

  useEffect(() => {
    if (bootstrap?.businessArchetype !== "restaurant" || !cashier) return;
    // A restaurant register's home is the floor, not the blue retail shell. Keep explicit module
    // deep-links from the restaurant “other work” hub on this page; only a plain /pos/app entry
    // continues to the restaurant operating surface. Client navigation intentionally preserves the
    // in-memory verified operator, so the same human is not asked for the same PIN a second time.
    // This must not depend on the Electron bridge: signIn() leaves the login in "preparing" for a
    // restaurant and relies on this navigation to finish it, so a browser register would otherwise
    // wait on "กำลังเตรียมหน้าร้าน…" forever with the button disabled.
    const requested = new URLSearchParams(window.location.search).get("module");
    if (requested) return;
    let active = true;
    setLoginPhase("preparing");
    void (restaurantPreparedRef.current
      ? Promise.resolve()
      : prepareRestaurantWorkspace(token)
    ).then(() => {
      if (!active) return;
      restaurantPreparedRef.current = true;
      router.replace("/pos/restaurant");
    }).catch((cause) => {
      if (active) {
        setError(messageOf(cause, posText));
        setLoginPhase("idle");
      }
    });
    return () => { active = false; };
  }, [bootstrap?.businessArchetype, cashier, prepareRestaurantWorkspace, router, token]);

  // Native <details> gives the header popups keyboard semantics without another menu library, but
  // it does not dismiss itself when the operator taps elsewhere. Delegate once at the desktop-app
  // root so every present and future header popup follows the same rule while ordinary disclosures
  // inside the selling modules keep their own open/closed state.
  useEffect(() => {
    const openPopups = () => Array.from(
      desktopRootRef.current?.querySelectorAll<HTMLDetailsElement>(
        'details[data-desktop-popup][open]',
      ) ?? [],
    );
    const closePopups = (except?: HTMLDetailsElement) => {
      for (const popup of openPopups()) {
        if (popup !== except) popup.open = false;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const open = openPopups();
      if (open.some((popup) => popup.contains(target))) return;
      closePopups();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = openPopups();
      if (open.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      closePopups();
      open.at(-1)?.querySelector<HTMLElement>('summary')?.focus();
    };
    const onToggle = (event: Event) => {
      const popup = event.target;
      const root = desktopRootRef.current;
      if (!(popup instanceof HTMLDetailsElement)
        || !popup.open
        || !popup.matches('details[data-desktop-popup]')
        || !root?.contains(popup)) return;
      closePopups(popup);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('toggle', onToggle, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('toggle', onToggle, true);
    };
  }, []);

  useEffect(() => {
    if (!desktopInfoDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDesktopInfoDialog(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [desktopInfoDialog]);

  useEffect(() => {
    if (desktopInfoDialog !== "about" || desktopAppInfo) return;
    let active = true;
    void readDesktopAppInfo().then((info) => {
      if (active) {
        setDesktopAppInfo(info);
        setDesktopAppInfoLoaded(true);
      }
    });
    return () => { active = false; };
  }, [desktopAppInfo, desktopInfoDialog]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
    customerDisplayChannelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === "hello" && desktopOwnsCustomerDisplayRef.current) {
        channel.postMessage(customerDisplayPayloadRef.current);
      }
    };
    return () => {
      channel.close();
      customerDisplayChannelRef.current = null;
    };
  }, []);

  const sendFlow = useCallback((event: PosClientEvent) => {
    setFlow((current) => transitionPosClientFlow(current, event));
  }, []);

  const loadCatalog = useCallback(
    (q: string, tokenOverride?: string): Promise<void> => {
      const requestToken = tokenOverride ?? tokenRef.current;
      const normalizedQuery = q.trim();
      if (!requestToken) return Promise.resolve();

      // The device bootstrap starts the default catalogue while the cashier types their PIN.
      // Reuse that exact request when the catalogue screen opens instead of sending the same
      // always-fresh read twice. Search requests are not cached: a new query still reaches the
      // server, and the monotonically increasing version prevents a slower old response from
      // replacing a newer result.
      const activeRequest = catalogRequestRef.current;
      if (activeRequest
        && activeRequest.token === requestToken
        && activeRequest.query === normalizedQuery) {
        return activeRequest.promise;
      }

      const version = ++catalogRequestVersion.current;
      setCatalogLoading(true);
      setCatalogError("");
      catalogLoadErrorRef.current = "";
      const promise: Promise<void> = posGraphqlRequest<{
        bmsPosCatalogSearch: { items: PosCatalogItem[] };
      }>(requestToken, POS_CATALOG_QUERY, { q: normalizedQuery })
        .then((data) => {
          if (version !== catalogRequestVersion.current) return;
          setConnection("online");
          setCatalog(data.bmsPosCatalogSearch.items);
          if (!normalizedQuery) {
            catalogPrimedRef.current = { token: requestToken, at: Date.now() };
          }
        })
        .catch((cause) => {
          if (version !== catalogRequestVersion.current) return;
          const status = posErrorConnectionStatus(cause);
          if (status) setConnection(status);
          const text = messageOf(cause, posText);
          catalogLoadErrorRef.current = text;
          setCatalogError(text);
        })
        .finally(() => {
          if (catalogRequestRef.current?.promise === promise) {
            catalogRequestRef.current = null;
          }
          if (version === catalogRequestVersion.current) {
            setCatalogLoading(false);
          }
        });

      catalogRequestRef.current = { token: requestToken, query: normalizedQuery, promise };
      return promise;
    },
    [posText],
  );

  const bootstrapDevice = useCallback(async () => {
    setConnection("checking");
    setError("");
    const nextToken = await readPosDeviceToken();
    if (!nextToken) {
      tokenRef.current = "";
      setToken("");
      setFlow(initialPosClientFlow(false));
      return;
    }
    tokenRef.current = nextToken;
    setToken(nextToken);
    try {
      const data = await posGraphqlRequest<{ bmsPosSession: PosBootstrap }>(
        nextToken,
        POS_BOOTSTRAP_QUERY,
      );
      setConnection("online");
      setBootstrap(data.bmsPosSession);
      const first = data.bmsPosSession.cashiers.find((item) => item.hasPin);
      const remembered = rememberedOperatorRef.current;
      const restoredCashier = remembered
        ? data.bmsPosSession.cashiers.find((item) => item.id === remembered.cashier.id && item.hasPin) ?? null
        : null;
      setCashierId(restoredCashier?.id ?? first?.id ?? "");
      setCashier(restoredCashier);
      setPin(restoredCashier && remembered ? remembered.pin : "");
      setFlow((current) => {
        let next = transitionPosClientFlow(current, "DEVICE_VERIFIED");
        if (data.bmsPosSession.shift?.status === "OPEN") {
          next = transitionPosClientFlow(next, "SHIFT_STATUS_OPEN");
        }
        if (restoredCashier) {
          next = transitionPosClientFlow(next, "CASHIER_VERIFIED");
        }
        return next;
      });
      if (data.bmsPosSession.businessArchetype === "restaurant") {
        // Route code can warm while the operator types, but operational data is prepared only
        // after the PIN is verified so every store follows the same visible login contract.
        router.prefetch("/pos/restaurant");
      } else if (data.bmsPosSession.businessArchetype === "board_game_cafe") {
        void loadBoardGameModule();
      } else if (data.bmsPosSession.businessArchetype === "pharmacy") {
        // The full sell workspace is the pharmacy home; warm its chunk while the PIN is typed.
        void loadAdvancedPosModule();
      } else {
        // Retail catalogue reads require the paired device but not a cashier PIN. Starting this
        // after device verification overlaps network/DB time with PIN entry; submit still joins
        // and awaits this exact promise before revealing the first workspace.
        void loadCatalog("", nextToken);
      }
    } catch (cause) {
      const status = posErrorConnectionStatus(cause);
      if (status) setConnection(status);
      setError(messageOf(cause, posText));
    }
  }, [posText, loadCatalog, router]);

  useEffect(() => {
    void bootstrapDevice();
  }, [bootstrapDevice]);

  useEffect(() => {
    if (flow.stage !== "CATALOG") return;
    const normalizedQuery = query.trim();
    const primed = catalogPrimedRef.current;
    if (!normalizedQuery
      && primed?.token === token
      && Date.now() - primed.at < 15_000) {
      catalogPrimedRef.current = null;
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void loadCatalog(normalizedQuery).finally(() => {
        // If this joined the bootstrap request, consume its one-shot prime marker here so clearing
        // a later search always performs a fresh authoritative read.
        if (!normalizedQuery) catalogPrimedRef.current = null;
      });
    }, normalizedQuery ? 180 : 0);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [flow.stage, loadCatalog, query, token]);

  useEffect(() => {
    if (flow.stage !== "CATALOG") return;
    // Keep the first selling screen small, then warm the less common workspaces once the browser
    // has breathing room. This preserves fast board-game/module switching without making their
    // large UI dependencies part of the initial /pos/app execution path.
    const preloadModules = () => {
      void Promise.allSettled([loadAdvancedPosModule(), loadBoardGameModule()]);
    };
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(preloadModules, { timeout: 3_000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = window.setTimeout(preloadModules, 1_000);
    return () => window.clearTimeout(timer);
  }, [flow.stage]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!cashierId || !pin || busy) return;
    let verificationCompleted = verifiedLogin?.id === cashierId;
    let keepPreparingUntilNavigation = false;
    const restaurantHome = bootstrap?.businessArchetype === "restaurant"
      && !new URLSearchParams(window.location.search).get("module");
    setBusy(true);
    setError("");
    try {
      let verified = verifiedLogin?.id === cashierId ? verifiedLogin : null;
      if (!verified) {
        setLoginPhase("verifying");
        const data = await posGraphqlRequest<{ bmsPosVerifyCashier: PosCashier }>(
          token,
          VERIFY_CASHIER_MUTATION,
          { input: { cashierUserId: cashierId, pin } },
        );
        verified = data.bmsPosVerifyCashier;
        verificationCompleted = true;
        setVerifiedLogin(verified);
        rememberOperator(verified, pin);
      }

      setLoginPhase("preparing");
      if (restaurantHome) {
        await prepareRestaurantWorkspace(token);
        restaurantPreparedRef.current = true;
        keepPreparingUntilNavigation = true;
      } else if (bootstrap?.businessArchetype === "board_game_cafe") {
        await Promise.all([
          loadBoardGameModule(),
          prepareBoardGameWorkspace(token, verified.id, pin),
        ]);
        setActiveModule("boardgame");
      } else if (bootstrap?.businessArchetype === "pharmacy") {
        await loadAdvancedPosModule();
        setActiveModule("sell");
      } else {
        await loadCatalog("", token);
        if (catalogLoadErrorRef.current) throw new Error(catalogLoadErrorRef.current);
      }

      setCashier(verified);
      if (restaurantHome) return;
      sendFlow("CASHIER_VERIFIED");
    } catch (cause) {
      if (!verificationCompleted) setPin("");
      setError(messageOf(cause, posText));
    } finally {
      if (!keepPreparingUntilNavigation) {
        setLoginPhase("idle");
        setBusy(false);
      }
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
        throw new Error(data.bmsPosShift.reason ?? posText("เปิดกะไม่สำเร็จ"));
      }
      setBootstrap((current) => (current ? { ...current, shift: data.bmsPosShift.shift } : current));
      sendFlow("SHIFT_OPENED");
    } catch (cause) {
      setError(messageOf(cause, posText));
    } finally {
      setBusy(false);
    }
  };

  const paymentNavigationBlocked = useCallback(() => {
    if (!saleSubmittingRef.current && !saleAttemptRef.current && !receiptPrintingRef.current) return false;
    setError(posText("กำลังรับชำระหรือพิมพ์ใบเสร็จ กรุณาทำรายการเดิมให้ทราบผลก่อนเปลี่ยนหน้าหรือพนักงาน"));
    return true;
  }, [posText]);

  const legacy = (tab: string) => {
    if (paymentNavigationBlocked()) return;
    if (tab === "restaurant") {
      router.push("/pos/restaurant");
      return;
    }
    window.location.assign(`/pos?tab=${tab}`);
  };

  const openModule = useCallback((module: DesktopModule) => {
    if (paymentNavigationBlocked()) return;
    clearScannedProduct();
    if (module === "mobile_sell") sendFlow("BACK_TO_CATALOG");
    setActiveModule(module);
    setError("");
    setNotice("");
  }, [clearScannedProduct, paymentNavigationBlocked, sendFlow]);

  const followWorkspaceTab = useCallback((tab: PosTab) => {
    setActiveModule(tab);
  }, []);

  const acceptBoardGameServiceCalls = useCallback((calls: PosServiceCallNotice[]) => {
    setServiceCalls(calls);
  }, []);

  // One authoritative loader serves both the realtime event and the bounded polling fallback.
  // Previously the subscription received table-call events but only invalidated Apollo queries;
  // this fetch-backed bell therefore waited for its next 10-second tick before it changed.
  const refreshDesktopServiceCalls = useCallback(async (signal?: AbortSignal) => {
    if (!token || !cashier || !pin) return;
    try {
      if (bootstrap?.businessArchetype === "restaurant") {
        const response = await fetch("/api/pos/restaurant/service-calls", {
          headers: { "x-pos-device-token": token },
          cache: "no-store",
          signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : posText("โหลดคำเรียกไม่สำเร็จ"));
        }
        const rows = Array.isArray(data.calls) ? data.calls : [];
        setServiceCalls(rows.map((call: PosServiceCallNotice) => ({
          ...call,
          source: "restaurant",
        })));
        return;
      }
      if (bootstrap?.businessArchetype === "board_game_cafe") {
        const response = await fetch("/api/pos/board-game", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({ action: "service.calls", cashierUserId: cashier.id, pin }),
          cache: "no-store",
          signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.error === "string" ? data.error : posText("โหลดคำเรียกไม่สำเร็จ"));
        }
        const rows = Array.isArray(data.serviceCalls) ? data.serviceCalls : [];
        setServiceCalls(rows.map((call: PosServiceCallNotice) => ({
          ...call,
          source: "boardgame",
        })));
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        // Keep the last known calls visible; a transient refresh error must not clear real work.
        console.error("[desktop-pos] service-call refresh failed", cause);
      }
    }
  }, [posText, bootstrap?.businessArchetype, cashier, pin, token]);

  const refreshDesktopContent = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken || contentRefreshingRef.current) return;
    // A refresh must never race a money/stock write or turn an unknown payment result into a new
    // attempt. Keep the current screen intact and tell the operator why the shortcut was deferred.
    if (busy || saleSubmittingRef.current || saleAttemptRef.current) {
      setNotice(posText("กำลังบันทึกรายการอยู่ — ระบบจะไม่รีเฟรชจนกว่างานนี้จะทราบผล"));
      return;
    }
    contentRefreshingRef.current = true;
    setContentRefreshing(true);
    // Refresh progress is not a reconnect: retain the last observed connection state until
    // a response or transport failure provides new evidence. The header owns one progress label.
    try {
      const data = await posGraphqlRequest<{ bmsPosSession: PosBootstrap }>(
        currentToken,
        POS_BOOTSTRAP_QUERY,
      );
      setConnection("online");
      setBootstrap(data.bmsPosSession);
      await Promise.all([
        loadCatalog(query, currentToken),
        cashier && pin ? refreshDesktopServiceCalls() : Promise.resolve(),
      ]);
      setFailedStoreLogoUrl(null);
      // Child workspaces refresh their own authoritative source while keeping the desktop shell,
      // verified operator and current navigation context mounted.
      setContentRefreshSignal((value) => value + 1);
    } catch (cause) {
      const status = posErrorConnectionStatus(cause);
      if (status) setConnection(status);
      setError(posText("รีเฟรชข้อมูลไม่สำเร็จ: {v0}", { v0: messageOf(cause, posText) }));
    } finally {
      contentRefreshingRef.current = false;
      setContentRefreshing(false);
    }
  }, [posText, busy, cashier, loadCatalog, pin, query, refreshDesktopServiceCalls]);

  useEffect(() => {
    if (typeof window.bmsDesktop?.onRefreshRequested !== "function") return;
    return window.bmsDesktop.onRefreshRequested(() => { void refreshDesktopContent(); });
  }, [refreshDesktopContent]);

  useRealtimeInvalidation({
    eventTypes: CATALOG_REALTIME_EVENTS,
    onInvalidate: async () => {
      // Availability is server-owned; refresh the visible catalogue, never reset an active cart.
      if (token && flow.stage === "CATALOG" && shownModule === "mobile_sell") {
        await loadCatalog(query);
      }
    },
  });

  useRealtimeInvalidation({
    eventTypes: SERVICE_CALL_REALTIME_EVENTS,
    onInvalidate: () => refreshDesktopServiceCalls(),
    // A table call is a human waiting at the counter: refresh on the next task as soon as the WS
    // event arrives. The 10-second timer below is reconciliation only, never the normal path.
    debounceMs: 0,
  });

  useEffect(() => {
    if (!token || !cashier || !pin
      || (bootstrap?.businessArchetype !== "restaurant"
        && bootstrap?.businessArchetype !== "board_game_cafe")
      // BoardGamePanel owns the visible workspace refresh and feeds the same bell through
      // onServiceCallsChange. Keep realtime invalidation above active, but do not run a second
      // ten-second reconciliation loop beside the workspace while this module is open.
      || (bootstrap?.businessArchetype === "board_game_cafe" && activeModule === "boardgame")) return;
    let controller: AbortController | null = null;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      void refreshDesktopServiceCalls(controller.signal);
    };
    refresh();
    // Realtime is the fast path; this remains the fail-open reconciliation path.
    const timer = window.setInterval(refresh, 10_000);
    return () => { controller?.abort(); window.clearInterval(timer); };
  }, [activeModule, bootstrap?.businessArchetype, cashier, pin, refreshDesktopServiceCalls, token]);

  useEffect(() => {
    const pendingIds = serviceCalls
      .filter((call) => call.status === "PENDING")
      .map((call) => `${call.source}:${call.id}`);
    if (newAlertIds(knownServiceCallIds.current, pendingIds).length > 0) alerts.notify("QR_PENDING");
    knownServiceCallIds.current = new Set(pendingIds);
  }, [alerts, serviceCalls]);

  const updateServiceCall = useCallback(async (call: PosServiceCallNotice) => {
    if (!cashier || !pin || serviceCallsBusy) return;
    setServiceCallsBusy(call.id);
    const completing = call.status === "ACKNOWLEDGED";
    try {
      const response = call.source === "restaurant"
        ? await fetch("/api/pos/restaurant/service-calls", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({
            action: completing ? "complete" : "acknowledge",
            callId: call.id,
            cashierUserId: cashier.id,
            cashierPin: pin,
          }),
        })
        : await fetch("/api/pos/board-game", {
          method: "POST",
          headers: { "content-type": "application/json", "x-pos-device-token": token },
          body: JSON.stringify({
            action: completing ? "service.complete" : "service.acknowledge",
            callId: call.id,
            cashierUserId: cashier.id,
            pin,
            idempotencyKey: createIdempotencyKey("desktop-service-call"),
          }),
        });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.error === "string"
          ? data.error
          : completing ? posText("ปิดงานไม่สำเร็จ") : posText("รับคำเรียกไม่สำเร็จ"));
      }
      setServiceCalls((current) => completing
        ? current.filter((item) => !(item.id === call.id && item.source === call.source))
        : current.map((item) => item.id === call.id && item.source === call.source
          ? { ...item, status: "ACKNOWLEDGED" }
          : item));
      setNotice(completing
        ? posText("ปิดงานของ {v0} แล้ว", { v0: call.tableName || call.tableCode })
        : posText("รับเรื่องจาก {v0} แล้ว · กด “เสร็จสิ้น” หลังดูแลโต๊ะ", { v0: call.tableName || call.tableCode }));
    } catch (cause) {
      setError(messageOf(cause, posText));
    } finally {
      setServiceCallsBusy("");
    }
  }, [posText, cashier, pin, serviceCallsBusy, token]);

  const openServiceCall = useCallback((call: PosServiceCallNotice) => {
    if (call.source === "restaurant") {
      legacy("restaurant");
      return;
    }
    openModule("boardgame");
  }, [openModule]);

  const openDesktopInfoDialog = useCallback((dialog: Exclude<DesktopInfoDialog, null>) => {
    if (accountMenuRef.current) accountMenuRef.current.open = false;
    setDiagnosticsCopied(false);
    setDesktopInfoDialog(dialog);
  }, []);

  const openAdminBackoffice = useCallback(async () => {
    if (accountMenuRef.current) accountMenuRef.current.open = false;
    if (!await openDesktopAdmin()) {
      setError(posText("เปิดระบบหลังบ้านไม่สำเร็จ กรุณาลองใหม่จากเมนู BMS POS"));
    }
  }, [posText]);

  const unpair = useCallback(async () => {
    if (paymentNavigationBlocked()) return;
    try {
      await clearPosDeviceToken(() => {
        clearOperator();
        clearPreparedWorkspaces();
        catalogRequestVersion.current += 1;
        catalogRequestRef.current = null;
        catalogPrimedRef.current = null;
        catalogLoadErrorRef.current = "";
        tokenRef.current = "";
        setToken("");
        setBootstrap(null);
        setCashier(null);
        setVerifiedLogin(null);
        setLoginPhase("idle");
        setPin("");
        setCatalog([]);
        setCatalogLoading(false);
        setCatalogError("");
        setBoardGameCheckout(null);
        clearScannedProduct();
        setServiceCalls([]);
        sendFlow("UNPAIR");
      });
    } catch (error: any) {
      setError(error?.message || posText("เลิกจับคู่เครื่องไม่สำเร็จ กรุณาลองใหม่"));
      return;
    }
  }, [posText, clearOperator, clearPreparedWorkspaces, clearScannedProduct, paymentNavigationBlocked, sendFlow]);

  const followWorkspaceShift = useCallback((open: boolean) => {
    if (open) return;
    clearScannedProduct();
    setBootstrap((current) => current ? { ...current, shift: null } : current);
    setCart([]);
    setBoardGameCheckout(null);
    setActiveModule("mobile_sell");
    setFlow((current) => ({
      ...current,
      shiftOpen: false,
      stage: current.cashierAuthenticated ? "SHIFT_REQUIRED" : "CASHIER_LOGIN",
    }));
  }, [clearScannedProduct]);

  const signOutCashier = useCallback(() => {
    if (paymentNavigationBlocked()) return;
    clearScannedProduct();
    clearOperator();
    clearPreparedWorkspaces();
    setCashier(null);
    setVerifiedLogin(null);
    setLoginPhase("idle");
    setPin("");
    setCart([]);
    setBoardGameCheckout(null);
    setServiceCalls([]);
    sendFlow("SIGN_OUT");
  }, [clearOperator, clearPreparedWorkspaces, clearScannedProduct, paymentNavigationBlocked, sendFlow]);

  const openBoardGameCheckout = useCallback(async (billingGroupId: string) => {
    if (!cashier || !pin || busy) return;
    if (saleAttemptRef.current) {
      setError(posText("มีรายการรับชำระที่ยังไม่ทราบผล กรุณาลองบันทึกรายการเดิมให้จบก่อน"));
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
      setConnection("online");
      if (!data.bmsPosBoardGameCheckout) {
        throw new Error(posText("ไม่พบบิลกลุ่มนี้ หรือบิลถูกชำระจากเครื่องอื่นแล้ว"));
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
    } catch (cause) {
      setError(messageOf(cause, posText));
      setActiveModule("mobile_sell");
      sendFlow("BACK_TO_CATALOG");
      const status = posErrorConnectionStatus(cause);
      if (status) setConnection(status);
    } finally {
      setBusy(false);
    }
  }, [posText, bootstrap?.vat.cashRounding, busy, cashier, pin, sendFlow, token]);

  const addProduct = async (code: string, size?: string | null, fromScan = false) => {
    const clean = code.trim();
    if (!clean || busy || addProductPendingRef.current || saleAttemptRef.current) return;
    const submittedRevision = scanDraftRevision.current;
    const expectedSku = size && scannedProduct?.kind === "selection" && scannedProduct.selection.scanCode === clean
      ? scannedProduct.selection.sku : null;
    const requestVersion = ++scanResultVersion.current;
    if (!size) setScannedProduct(null);
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
      if (requestVersion !== scanResultVersion.current || tokenRef.current !== token) return;
      const hit = data.bmsPosScan;
      if (!hit) throw new Error(posText("ไม่พบสินค้านี้"));
      if ((size && hit.size.toLowerCase() !== size.trim().toLowerCase()) || (expectedSku && hit.sku !== expectedSku)) {
        throw new Error(posText("สินค้าหรือไซส์ที่ระบบตอบกลับไม่ตรงกับที่เลือก กรุณาสแกนใหม่"));
      }
      const showResult = !fromScan || scanDraftRevision.current === submittedRevision;
      if (showResult) setScannedProduct({ kind: "product", product: hit, added: false });
      if (hit.serialTracked || hit.scaleBarcode || hit.modifiers.length > 0) {
        setNotice(ADVANCED_ITEM_NOTICE);
        return;
      }
      const incoming = resolvedCartLine(hit, posText);
      // A bundle or a RECIPE/NON_STOCK menu keeps its own inventory row at 0 by design; the
      // server reserves its components/ingredients at commit. Only a tracked row is a ceiling.
      if (incoming.stockTracked && incoming.available <= 0) {
        throw new Error(posText("สินค้านี้ไม่มีสต็อกพร้อมขาย"));
      }
      if (
        incoming.stockTracked
        && cartVariantBaseQty(cart, incoming) + incoming.baseQty > incoming.available
      ) {
        throw new Error(posText("เพิ่มไม่ได้ สาขานี้เหลือ {v0} หน่วยฐาน", { v0: incoming.available }));
      }
      setCart((current) => {
        // ราคาส่งและโปรโมชันบางแบบนับรวมทุกไซซ์ของ SKU เดียวกัน กฎจาก scan ล่าสุด
        // จึงต้องอัปเดตทุกบรรทัดของ SKU นั้นเหมือน mobile client ก่อนคิดยอดใหม่
        const synced = current.map((line) =>
          line.sku === incoming.sku
            ? {
                ...line,
                priceTiers: incoming.priceTiers,
                promotion: incoming.promotion,
                ...(line.size === incoming.size ? { available: incoming.available } : {}),
              }
            : line,
        );
        if (incoming.stockTracked && cartVariantBaseQty(synced, incoming) + incoming.baseQty > incoming.available) {
          return synced;
        }
        const existing = synced.find((line) => line.key === incoming.key);
        if (!existing) return [...synced, incoming];
        return synced.map((line) =>
          line.key === incoming.key
            ? { ...line, ...incoming, qty: line.qty + 1, serials: line.serials }
            : line,
        );
      });
      if (showResult) setScannedProduct({ kind: "product", product: hit, added: true });
      // A delayed lookup must not erase the next code or an unrelated scan draft after a card click.
      if (fromScan && scanDraftRevision.current === submittedRevision) setScanCode("");
    } catch (cause) {
      if (requestVersion !== scanResultVersion.current || tokenRef.current !== token) return;
      if (cause instanceof PosGraphqlError && cause.variantSelection?.scanCode === clean
        && (!fromScan || scanDraftRevision.current === submittedRevision)) {
        setScannedProduct({ kind: "selection", selection: cause.variantSelection });
        if (fromScan) setScanCode("");
        return;
      }
      setError(messageOf(cause, posText));
    } finally {
      addProductPendingRef.current = false;
      setAddingProductKey("");
    }
  };

  const changeQty = (key: string, delta: number) => {
    if (saleAttemptRef.current || addProductPendingRef.current) return;
    const target = cart.find((line) => line.key === key);
    if (
      target
      && delta > 0
      && target.stockTracked
      && cartVariantBaseQty(cart, target) + delta * target.baseQty > target.available
    ) {
      // The server would refuse this at payment with OUT_OF_STOCK; say it while the line is in hand.
      setError(posText("เพิ่มไม่ได้ สาขานี้เหลือ {v0} หน่วยฐาน", { v0: target.available }));
      return;
    }
    setCart((current) =>
      current.flatMap((line) => {
        if (line.key !== key) return [line];
        const qty = line.qty + delta;
        return qty > 0 ? [{ ...line, qty }] : [];
      }),
    );
  };

  const retailPricing = useMemo(() => cartProductPricing(cart), [cart]);
  const retailSubtotal = retailPricing.subtotal;
  const retailListSubtotal = retailPricing.listSubtotal;
  const pricingSavings = Math.max(0, Math.round((retailListSubtotal - retailSubtotal) * 100) / 100);
  const benefits = useCheckoutBenefits(token, boardGameCheckout?.totalDue ?? retailSubtotal,
    boardGameCheckout?.id ?? null, flow.stage === "CHECKOUT", contentRefreshSignal);
  useEffect(() => {
    if (!cashier || !bootstrap?.shift) benefits.clear();
  }, [cashier?.id, bootstrap?.shift?.id]);
  const payableBeforeRounding = (benefits.ready ? benefitsPayable(benefits.preview) : null)
    ?? boardGameCheckout?.totalDue ?? retailSubtotal;
  const cashMode = isCashRounding(bootstrap?.vat.cashRounding)
    ? bootstrap.vat.cashRounding
    : "NONE";
  const rounding = cashRoundingForPayments(payableBeforeRounding, cashMode, payments);
  const total = payableWithRounding(payableBeforeRounding, rounding);
  const paymentCount = payments.length;

  useEffect(() => {
    setPayments((current) => syncSingleCheckoutPayment(
      current, total, saleSubmittingRef.current || Boolean(saleAttemptRef.current),
    ));
    // A preview may change while settlement is locked. Reconcile on unlock too;
    // an unknown result remains protected by saleAttemptRef until resolved.
  }, [paymentCount, total, busy]);

  const validation = useMemo(() => validatePayments(total, payments, posText), [payments, total, posText]);
  const zeroDueBoardGameBill = Boolean(boardGameCheckout && total === 0);
  const canConfirmPayment = Boolean(saleAttemptRef.current) || (benefits.ready && (validation.canConfirm || zeroDueBoardGameBill));
  const itemCount = boardGameCheckout ? 0 : cart.reduce((sum, line) => sum + line.qty, 0);
  const billCountLabel = boardGameCheckout
    ? posText("ค่าบริการ 1 รายการ")
    : posText("{v0} ชิ้น", { v0: itemCount });
  const boardGameBenefitAmount = boardGameCheckout
    ? Math.max(0, boardGameCheckout.passCoveredAmount) + Math.max(0, boardGameCheckout.offerDiscountAmount)
    : 0;
  const boardGameTabDiscountAmount = Math.max(0, boardGameCheckout?.tabPricingDiscountAmount ?? 0);
  const boardGameTotalDiscountAmount = boardGameBenefitAmount + boardGameTabDiscountAmount;
  const boardGameGrossTime = boardGameCheckout
    ? boardGameCheckout.amountDue + boardGameBenefitAmount
    : 0;

  useEffect(() => {
    const finished = receipt
      ? {
          id: receipt.orderId ?? receipt.receiptNo ?? undefined,
          completedAt: receipt.completedAt,
          taxRequestUrl: receiptPaper?.orderId === receipt.orderId ? receiptPaper?.taxRequestUrl : null,
          total: receipt.total ?? total,
          tendered: receipt.cashTendered,
          change: receipt.cashChange,
          pickupQueueLabel: receipt.pickupQueue?.label ?? receiptPaper?.pickupQueueLabel ?? null,
        }
      : null;
    const qrPaymentAmount = Math.round(payments
      .filter((payment) => payment.method === "qr")
      .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0) * 100) / 100;
    const configuredQr = bootstrap?.store.paymentQr ?? null;
    const boardGameDisplayLines = boardGameCheckout
      ? [
          ...boardGameCheckout.chargeLines.map((line, index) => ({
            name: posText("ค่าเล่น · {v0}", { v0: line.displayName || posText("ผู้เล่น {v0}", { v0: index + 1 }) }),
            size: `${boardGameMinutes(line.billableMinutes, posText)} · ${line.rateName || BOARD_GAME_PARTICIPANT_LABEL(posText)[line.participantType] || line.participantType}`,
            qty: 1,
            unitName: "",
            amount: Number(line.grossAmount ?? line.amount),
          })),
          ...boardGameCheckout.tabItems.map((item) => ({
            name: item.productName,
            size: item.size || null,
            qty: item.quantity,
            unitName: item.unitName || posText("ชิ้น"),
            amount: item.amount,
          })),
        ]
      : [];
    const displayActive = Boolean(token && cashier && bootstrap?.shift && (
      flow.stage === "RECEIPT" || flow.stage === "CHECKOUT"
      || (flow.stage === "CATALOG" && shownModule === "mobile_sell")
    ));
    const payload: CustomerDisplayPayload = !displayActive
      ? { ...EMPTY_CUSTOMER_DISPLAY, brand: displayBrand(bootstrap) } : {
      brand: displayBrand(bootstrap),
      checkout: flow.stage === "CHECKOUT",
      pendingPricing: flow.stage === "CHECKOUT" && !benefits.ready,
      lines: boardGameCheckout
        ? boardGameDisplayLines
        : cart.map((line) => ({
            name: line.name,
            size: line.size || null,
            qty: line.qty,
            unitName: line.unitName,
            amount: Math.round((
              Number(line.packBasePrice ?? line.unitPrice ?? 0)
              + Number(line.modifierUnitPrice ?? 0)
            ) * line.qty * 100) / 100,
          })),
      itemCount: boardGameCheckout ? boardGameDisplayLines.length : itemCount,
      total: boardGameCheckout
        ? Math.round((boardGameCheckout.totalDue + boardGameTotalDiscountAmount) * 100) / 100
        : retailListSubtotal,
      discountTotal: (boardGameCheckout ? boardGameTotalDiscountAmount : pricingSavings) + (benefits.ready ? benefits.preview?.totalDiscount ?? 0 : 0),
      amountDue: receipt?.total ?? total,
      memberAttached: receipt
        ? receipt.displayMember?.attached ?? (receiptPaper?.orderId === receipt.orderId ? Boolean(receiptPaper.member) : undefined)
        : Boolean(benefits.member),
      memberName: displayMemberName(receipt
        ? receiptPaper?.orderId === receipt.orderId ? receiptPaper?.member?.name : receipt.displayMember?.name
        : benefits.member?.name ?? null),
      pointsEarned: receipt ? receipt.pointsEarned ?? null : null,
      pointsWillEarn: !receipt && benefits.ready ? benefits.preview?.pointsWillEarn ?? null : null,
      pointsBalance: receipt ? receipt.pointsBalance ?? null : benefits.member?.pointsBalance ?? null,
      paymentQr: flow.stage === "CHECKOUT" && benefits.ready && validation.isBalanced && qrPaymentAmount > 0 && configuredQr
        ? { ...configuredQr, amount: qrPaymentAmount }
        : null,
      finished,
    };
    customerDisplayPayloadRef.current = payload;
    if (!desktopOwnsCustomerDisplay) return;
    customerDisplayChannelRef.current?.postMessage(payload);
  }, [
    desktopOwnsCustomerDisplay,
    token,
    cashier,
    shownModule,
    boardGameBenefitAmount,
    boardGameCheckout,
    boardGameTotalDiscountAmount,
    cart,
    bootstrap,
    flow.stage,
    itemCount,
    payments,
    payableBeforeRounding,
    pricingSavings,
    receipt,
    receiptPaper,
    retailListSubtotal,
    total,
    validation.isBalanced,
    benefits.ready, benefits.preview, benefits.member,
  ]);

  const backFromCheckout = () => {
    if (paymentNavigationBlocked()) return;
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
    if (saleSubmittingRef.current || saleAttemptRef.current) return;
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

  const updatePayment = (id: string, patch: Partial<PosPaymentInput>, exactCash = false) => {
    if (saleSubmittingRef.current || saleAttemptRef.current) return;
    setPayments((current) =>
      current.map((payment) => (payment.id === id ? editCheckoutPayment(payment, patch, exactCash) : payment)),
    );
  };

  const addSplitPayment = () => {
    if (saleSubmittingRef.current || saleAttemptRef.current) return;
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

  const removePayment = (id: string) => {
    if (saleSubmittingRef.current || saleAttemptRef.current) return;
    setPayments((current) => current.filter((payment) => payment.id !== id));
  };

  const recheckCartPricing = async (): Promise<boolean> => {
    const refreshed: CartLine[] = [];
    for (const line of cart) {
      const data = await posGraphqlRequest<{ bmsPosScan: PosScanHit | null }>(
        token,
        POS_SCAN_QUERY,
        { code: line.sku, size: line.size || null, packCode: line.packCode || null, surface: "RETAIL_POS" },
      );
      if (!data.bmsPosScan) throw new Error(posText("ไม่พบ {v0} ในแคตตาล็อกล่าสุด", { v0: line.name }));
      const next = { ...resolvedCartLine(data.bmsPosScan, posText), qty: line.qty };
      refreshed.push(next);
    }
    setCart(refreshed);
    if (refreshed.some((line, index) => cartLinePricingSignature(line) !== cartLinePricingSignature(cart[index]))) {
      setNotice(posText("ราคา ขั้นราคาส่ง หรือโปรโมชันเปลี่ยนแล้ว กรุณาตรวจยอดและรับเงินใหม่"));
      return false;
    }
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
      ...benefits.saleFields,
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

  const loadReceiptPaper = useCallback(async (sale: SaleResult) => {
    if (!sale.orderId) return;
    setReceiptPaper(null);
    setReceiptPaperState("loading");
    try {
      const data = await posGraphqlRequest<{ bmsPosLastSale: PosSaleReceiptRow | null }>(
        token,
        POS_LAST_SALE_QUERY,
      );
      const row = data.bmsPosLastSale;
      // The latest sale of this device must be the one just confirmed. Anything else would print
      // another customer's bill, so fail visibly instead.
      if (!row || row.orderId !== sale.orderId) throw new Error("receipt mismatch");
      const languageMode = isReceiptLanguageMode(bootstrap?.store.receiptLanguageMode)
        ? bootstrap.store.receiptLanguageMode
        : "th";
      setReceiptPaper(receiptPayloadFromPosSale(row, {
        languageMode,
        vatRegistered: Boolean(bootstrap?.vat.registered),
        taxId: bootstrap?.store.taxId ?? null,
        address: bootstrap?.store.address ?? null,
        phone: bootstrap?.store.phone ?? null,
        logoUrl: bootstrap?.store.logoUrl ?? null,
        fallbackStoreName: bootstrap?.location?.name ?? null,
        fallbackBranchCode: bootstrap?.location?.branchCode ?? null,
        fallbackPosNo: bootstrap?.device.registeredPosNo ?? bootstrap?.device.code ?? null,
      }, {
        pointsEarned: sale.pointsEarned ?? null,
        pointsBalance: sale.pointsBalance ?? null,
      }));
      setReceiptPaperState("idle");
    } catch {
      setReceiptPaperState("failed");
    }
  }, [bootstrap, token]);

  /**
   * globals.css hides the whole page while printing and reveals only #pos-receipt once the body
   * carries this marker. Printing without it produces a blank sheet. rAF alone never fires in a
   * hidden window, so a timeout races it and the dialog opens exactly once.
   */
  const printReceiptPaper = async () => {
    if (!receiptPaper || receiptPrintingRef.current || receiptPrinting || receiptPrinter.disabled) return;
    setError("");
    receiptPrintingRef.current = true;
    setReceiptPrinting(true);
    const releasePrint = () => {
      receiptPrintingRef.current = false;
      setReceiptPrinting(false);
    };
    try {
      if (await printDesktopReceipt()) {
        releasePrint();
        if (boardGameCheckout) newSale();
        return;
      }
    } catch (cause) {
      releasePrint();
      setError(cause instanceof Error ? cause.message : posText("พิมพ์ใบเสร็จไม่สำเร็จ"));
      return;
    }
    document.body.setAttribute("data-pos-print-target", "receipt");
    let fallbackTimer = 0;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.removeAttribute("data-pos-print-target");
      window.removeEventListener("afterprint", cleanup);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      releasePrint();
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    let printed = false;
    const fire = () => {
      if (printed) return;
      printed = true;
      try {
        window.print();
        if (!cleaned) fallbackTimer = window.setTimeout(cleanup, 1_000);
      } catch (cause) {
        cleanup();
        setError(cause instanceof Error ? cause.message : posText("เปิดหน้าพิมพ์ไม่สำเร็จ"));
      }
    };
    window.requestAnimationFrame(fire);
    window.setTimeout(fire, 120);
  };

  const submitSale = async () => {
    if (!cashier || busy || saleSubmittingRef.current || !canConfirmPayment || (!boardGameCheckout && cart.length === 0)) return;
    saleSubmittingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const retrying = Boolean(saleAttemptRef.current);
    try {
      if (!saleAttemptRef.current) {
        const current = boardGameCheckout ? true : await recheckCartPricing();
        if (!current) return;
        const key = createIdempotencyKey(boardGameCheckout ? "desktop-board-game-sale" : "desktop-sale");
        saleAttemptRef.current = { key, payload: buildSalePayload(key),
          displayMember: { attached: Boolean(benefits.member), name: displayMemberName(benefits.member?.name) } };
      }
      const data = await posGraphqlRequest<{ bmsPosSale: SaleResult }>(
        token,
        POS_SALE_MUTATION,
        saleAttemptRef.current.payload,
      );
      setConnection("online");
      if (!data.bmsPosSale?.status) throw new PosSaleResultError(posText("ผลรับชำระไม่ครบถ้วน"), data.bmsPosSale);
      if (data.bmsPosSale.status !== "SOLD") {
        throw new PosSaleResultError(data.bmsPosSale.reason ?? posText("ขายไม่สำเร็จ ({v0})", { v0: data.bmsPosSale.status }), data.bmsPosSale);
      }
      if (!data.bmsPosSale.orderId) throw new PosSaleResultError(posText("ผลรับชำระไม่ครบถ้วน"), data.bmsPosSale);
      setReceipt({ ...data.bmsPosSale, completedAt: Date.now(), displayMember: saleAttemptRef.current.displayMember });
      saleAttemptRef.current = null;
      sendFlow("SALE_COMPLETED");
      setConnection("online");
      void loadReceiptPaper(data.bmsPosSale);
    } catch (cause) {
      // A proxy timeout (including HTTP 408) cannot prove the transaction rolled back.
      const decided = cause instanceof PosSaleResultError ? cause.knownFailure : saleAttemptRef.current === null || (
        cause instanceof PosGraphqlError && cause.code != null && decidedCodes.has(cause.code)
      );
      // A refusal on a retry cannot erase an order reserved by the earlier request.
      if (!retrying && decided && !(cause instanceof PosSaleResultError && cause.retainAttempt)) saleAttemptRef.current = null;
      setError(
        decided
          ? `${messageOf(cause, posText)}${saleAttemptRef.current ? posText(" · แก้ไขสาเหตุแล้วลองบันทึกบิลเดิมอีกครั้ง") : ""}`
          : posText("{v0} · ยังไม่ทราบผล กรุณากดลองซ้ำ ระบบจะใช้รหัสรายการเดิม", { v0: messageOf(cause, posText) }),
      );
      const status = posErrorConnectionStatus(cause);
      if (status) setConnection(status);
    } finally {
      saleSubmittingRef.current = false;
      setBusy(false);
    }
  };

  const newSale = () => {
    clearScannedProduct();
    benefits.clear();
    const completedBoardGameBill = Boolean(boardGameCheckout);
    if (!completedBoardGameBill) setCart([]);
    setBoardGameCheckout(null);
    setReceipt(null);
    setReceiptPaper(null);
    setReceiptPaperState("idle");
    setPayments([{ id: "payment-1", method: "cash", amount: 0, tendered: 0 }]);
    setError("");
    setNotice("");
    saleAttemptRef.current = null;
    setActiveModule(completedBoardGameBill ? "boardgame" : "mobile_sell");
    sendFlow("NEW_SALE");
  };

  const deviceLanguageDialog = (
    <Modal open={deviceLanguageOpen} onCancel={() => setDeviceLanguageOpen(false)}
      title={posText("ตั้งค่าเครื่อง")} footer={null} width={480}>
      <PosLanguageSetting />
    </Modal>
  );

  if (flow.stage === "PAIRING") {
    return (
      <main className={`${styles.centerPage} ${styles.lightTheme}`}>
        {deviceLanguageDialog}
        <section className={styles.gateCard}>
          <div className={styles.brandMark}>B</div>
          <p className={styles.eyebrow}>BMS POS DESKTOP</p>
          <h1>{posText("ยังไม่ได้เลือกเซิร์ฟเวอร์")}</h1>
          {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
          <p>{posText("กลับไปหน้าตั้งค่า Electron เพื่อเลือกเซิร์ฟเวอร์และจับคู่เครื่องนี้ก่อน")}</p>
          <button className={styles.primaryButton} onClick={() => void unpair()}>
            {posText("เปิดหน้าจับคู่เครื่อง") + " "}</button>
          <button type="button" className={styles.languageSettingsButton} onClick={() => setDeviceLanguageOpen(true)}><SettingOutlined /> {posText("ตั้งค่าเครื่อง")}</button>
        </section>
      </main>
    );
  }

  if (flow.stage === "VERIFYING_DEVICE" || !bootstrap) {
    return (
      <main className={`${styles.centerPage} ${styles.lightTheme}`}>
        {deviceLanguageDialog}
        <section className={styles.gateCard}>
          {!error && <div className={styles.spinner} />}
          <h1>{error ? posText("โหลดข้อมูลเครื่องขายไม่สำเร็จ") : posText("กำลังโหลดแอปใหม่ทั้งหมด…")}</h1>
          {error
            ? <PosDismissibleAlert key={error} className={styles.errorBox}>{error}</PosDismissibleAlert>
            : <p>{posText("กำลังเชื่อมต่อเครื่องขายและตรวจสอบข้อมูลล่าสุด กรุณารอสักครู่")}</p>}
          {error ? (
            <div className={styles.gateActions}>
              <button className={styles.primaryButton} onClick={() => void bootstrapDevice()}>{posText("ลองอีกครั้ง")}</button>
              <button onClick={() => void unpair()}>{posText("เปลี่ยนเซิร์ฟเวอร์")}</button>
            </div>
          ) : null}
          {error ? <button type="button" className={styles.languageSettingsButton} onClick={() => setDeviceLanguageOpen(true)}><SettingOutlined /> {posText("ตั้งค่าเครื่อง")}</button> : null}
        </section>
      </main>
    );
  }

  if (flow.stage === "CASHIER_LOGIN") {
    return (
      <main className={`${styles.loginPage} ${styles.lightTheme}`}>
        {deviceLanguageDialog}
        <section className={styles.loginAside}>
          <div className={styles.logoLockup}><span>B</span><strong>BMS POS</strong></div>
          <div>
            <div className={styles.loginShopMark} aria-hidden="true">
              {storeLogoUrl && storeLogoUrl !== failedStoreLogoUrl ? (
                <img key={storeLogoUrl} src={storeLogoUrl} alt="" onError={() => setFailedStoreLogoUrl(storeLogoUrl)} />
              ) : (
                <ShopOutlined />
              )}
            </div>
            <p className={styles.eyebrow}>{posText("เครื่องขายพร้อมใช้งาน")}</p>
            <h1>{bootstrap.location?.name ?? posText("สาขาหลัก")}</h1>
            <p>{bootstrap.device.name ?? bootstrap.device.code} · {bootstrap.device.registeredPosNo ?? "POS"}</p>
          </div>
          <div className={styles.securityNote}>{posText("PIN อยู่เฉพาะในหน่วยความจำของหน้าจอนี้ และทุกการขายยังตรวจสิทธิ์กับเซิร์ฟเวอร์")}</div>
        </section>
        <section className={styles.loginPanel}>
          <button type="button" className={`${styles.languageSettingsButton} ${styles.loginDeviceSettings}`} onClick={() => setDeviceLanguageOpen(true)}><SettingOutlined /> {posText("ตั้งค่าเครื่อง")}</button>
          <form className={styles.loginForm} onSubmit={signIn}>
            <p className={styles.eyebrow}>{posText("เข้าสู่กะทำงาน")}</p>
            <h2>{posText("ใส่ PIN พนักงาน")}</h2>
            <label>{posText("พนักงาน") + " "}<select disabled={busy} value={cashierId} onChange={(event) => {
                setCashierId(event.target.value);
                setVerifiedLogin(null);
                clearOperator();
                clearPreparedWorkspaces();
                setError("");
              }}>
                {bootstrap.cashiers.filter((item) => item.hasPin).map((item) => (
                  <option key={item.id} value={item.id}>{item.name || item.email || item.id}</option>
                ))}
              </select>
            </label>
            <label className={styles.pinLabel}>{posText("PIN 4–8 หลัก") + " "}<span className={styles.pinEntry}>
                <input
                  className={styles.pinInput}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                  maxLength={POS_PIN_MAX_LENGTH}
                  value={pin}
                  onChange={(event) => {
                    const nextPin = normalizePosPinInput(event.target.value);
                    if (nextPin !== pin && verifiedLogin) {
                      setVerifiedLogin(null);
                      clearOperator();
                      clearPreparedWorkspaces();
                    }
                    setPin(nextPin);
                    setError("");
                  }}
                  aria-label={posText("PIN พนักงาน 4–8 หลัก")}
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
              {loginPhase === "verifying"
                ? posText("กำลังตรวจสอบ PIN…")
                : loginPhase === "preparing"
                  ? posText("กำลังเตรียมหน้าร้าน…")
                  : verifiedLogin && error
                    ? posText("ลองเตรียมหน้าร้านอีกครั้ง")
                    : posText("เข้าสู่ระบบ")}
            </button>
            <button type="button" className={styles.textButton} onClick={() => void unpair()}>{posText("เปลี่ยนเซิร์ฟเวอร์ / จับคู่ใหม่")}</button>
          </form>
        </section>
      </main>
    );
  }

  if (flow.stage === "SHIFT_REQUIRED") {
    return (
      <main className={`${styles.centerPage} ${styles.lightTheme}`}>
        {deviceLanguageDialog}
        <form className={styles.shiftCard} onSubmit={openShift}>
          <div className={styles.stepBadge}>2</div>
          <p className={styles.eyebrow}>{posText("ก่อนเริ่มขาย")}</p>
          <h1>{posText("เปิดกะเงินสด")}</h1>
          <p>{posText("สวัสดี") + " "}{cashier?.name || cashier?.email} {" " + posText("· ระบุเงินทอนตั้งต้นในลิ้นชัก")}</p>
          <label>{posText("เงินสดตั้งต้น") + " "}<div className={styles.moneyInput}><span>฿</span><input inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></div>
          </label>
          {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
          <button className={styles.primaryButton} disabled={busy}>{busy ? posText("กำลังเปิดกะ…") : posText("เปิดกะและเริ่มขาย")}</button>
          <button type="button" className={styles.textButton} onClick={signOutCashier}>{posText("เปลี่ยนพนักงาน")}</button>
          <button type="button" className={styles.languageSettingsButton} onClick={() => setDeviceLanguageOpen(true)}><SettingOutlined /> {posText("ตั้งค่าเครื่อง")}</button>
        </form>
      </main>
    );
  }

  const receiptDialog = flow.stage === "RECEIPT" && receipt ? (
      <Modal open centered width={900} title={posText("ชำระเงินสำเร็จ")} footer={null}
        maskClosable={false} keyboard={!receiptPrinting} closable={!receiptPrinting}
        onCancel={newSale} getContainer={false}
        className={styles.receiptDialog} rootClassName={styles.receiptDialogRoot}
        styles={{ mask: { backgroundColor: "rgba(20, 28, 40, 0.24)" } }}>
        <div className={styles.receiptDialogBody}>
          <section className={styles.receiptDialogSummary}>
          <CheckCircleOutlined className={styles.receiptSuccessIcon} />
          <h2>{money(receipt.total ?? total)}</h2>
          {boardGameCheckout ? <BoardGameBillBreakdown checkout={boardGameCheckout} receipt /> : null}
          <dl>
            <div><dt>{posText("เลขที่ใบเสร็จ")}</dt><dd>{receipt.receiptNo || receipt.billNo || receipt.orderId}</dd></div>
            <div><dt>{posText("รับเงิน")}</dt><dd>{money(receipt.cashTendered ?? validation.paidTotal)}</dd></div>
            <div className={styles.changeRow}><dt>{posText("เงินทอน")}</dt><dd>{money(receipt.cashChange ?? 0)}</dd></div>
          </dl>
          {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
          {hasDesktopPrinterBridge() && (
            <details style={{ textAlign: "left", marginBottom: 12 }}>
              <summary style={{ cursor: "pointer" }}>{posText("ตั้งค่าเครื่องพิมพ์")}</summary>
              <ReceiptPrinterSettings showStatus={false} />
            </details>
          )}
          <ReceiptPrinterStatus />
          {receiptPaper && !receiptPaper.taxRequestUrl && receiptPaper.taxRequestUnavailableReason ? (
            <p role="status" className={styles.receiptPaperStatus}>{receiptPaper.taxRequestUnavailableReason}</p>
          ) : null}
          <div className={styles.receiptActions}>
            <button disabled={!receiptPaper || receiptPrinting || receiptPrinter.disabled} onClick={printReceiptPaper}><PrinterOutlined /> {receiptPrinting ? posText("กำลังส่งพิมพ์…") : posText("พิมพ์ใบเสร็จ")}</button>
            <button className={styles.primaryButton} disabled={receiptPrinting} onClick={newSale}>
              {boardGameCheckout ? posText("กลับหน้าบอร์ดเกม") : posText("ขายรายการใหม่")}
            </button>
          </div>
          </section>
          <section className={styles.receiptDialogPreview} aria-label={posText("ตัวอย่างใบเสร็จ")}>
          {receiptPaper ? <ReceiptPaper payload={receiptPaper} /> : receiptPaperState === "failed" ? (
            <p className={styles.receiptPaperStatus} role="alert">
              {posText("บันทึกการขายสำเร็จแล้ว แต่ยังโหลดใบเสร็จไม่ได้") + " "}<button type="button" onClick={() => void loadReceiptPaper(receipt)}>{posText("ลองโหลดใบเสร็จอีกครั้ง")}</button>
            </p>
          ) : <p role="status">{posText("กำลังโหลดใบเสร็จ…")}</p>}
          </section>
        </div>
      </Modal>
  ) : null;

  const checkout = flow.stage === "CHECKOUT" || flow.stage === "RECEIPT";
  const connectionMode = connection === "offline" || realtimeStatus === "offline"
    ? "offline"
    : connection === "checking"
      ? "checking"
      : realtimeStatus === "connected"
        ? "online"
        : "fallback";
  const connectionLabel = connectionMode === "offline"
    ? posText("การเชื่อมต่อมีปัญหา")
    : connectionMode === "checking"
      ? posText("กำลังเชื่อมต่อ")
      : connectionMode === "online"
        ? posText("ออนไลน์")
        : posText("ออนไลน์ · อัปเดตอัตโนมัติ");
  const navItems = ([
    { key: "mobile_sell", label: posText("ขาย"), enabled: true },
    { key: "restaurant", label: posText("โต๊ะ"), enabled: bootstrap.businessArchetype === "restaurant" },
    { key: "boardgame", label: posText("บอร์ดเกม"), enabled: bootstrap.businessArchetype === "board_game_cafe" },
    { key: "returns", label: posText("คืน"), enabled: true },
    { key: "stock", label: posText("รับของ"), enabled: true },
    { key: "deposits", label: posText("มัดจำ"), enabled: true },
    { key: "shift", label: posText("กะ"), enabled: true },
    { key: "settings", label: posText("ตั้งค่า"), enabled: true },
  ] satisfies Array<{ key: DesktopModule; label: string; enabled: boolean }>).filter((item) => item.enabled);

  return (
    <main ref={desktopRootRef} className={`pos-desktop-app ${styles.shell} ${styles.lightTheme}${bootstrap.businessArchetype === "restaurant" ? ` ${styles.restaurantTheme}` : ""}`}>
      {receiptDialog}
      <aside className={styles.rail} ref={(element) => { if (element) element.inert = Boolean(receiptDialog); }} aria-hidden={receiptDialog ? true : undefined}>
        <div className={styles.railLogo}>B</div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.key}
              className={shownModule === item.key || (item.key === "mobile_sell" && shownModule === "sell") ? styles.navActive : ""}
              onClick={() => item.key === "restaurant" ? legacy("restaurant") : openModule(item.key)}
              title={item.label}
            >
              <NavIcon name={item.key === "mobile_sell" ? "sell" : item.key} />
              <small>{item.label}</small>
            </button>
          ))}
        </nav>
        <div className={styles.railFooter} aria-label={posText("ข้อมูลและความช่วยเหลือ")}>
          <button type="button" onClick={() => openDesktopInfoDialog("help")} title={posText("ช่วยเหลือ")}>
            <span aria-hidden="true">?</span>
            <small>{posText("ช่วยเหลือ")}</small>
          </button>
          <button type="button" onClick={() => openDesktopInfoDialog("about")} title={posText("เกี่ยวกับ BMS POS")}>
            <span aria-hidden="true">i</span>
            <small>{posText("เกี่ยวกับ")}</small>
          </button>
        </div>
      </aside>

      <section className={styles.workspace} ref={(element) => { if (element) element.inert = Boolean(receiptDialog); }} aria-hidden={receiptDialog ? true : undefined}>
        <header className={styles.topbar}>
          <div className={styles.storeIdentity}>
            <div className={styles.storeMark} aria-hidden="true">
              {storeLogoUrl && storeLogoUrl !== failedStoreLogoUrl ? (
                <img
                  key={storeLogoUrl}
                  src={storeLogoUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit", display: "block" }}
                  onError={() => setFailedStoreLogoUrl(storeLogoUrl)}
                />
              ) : (
                <ShopOutlined style={{ fontSize: 24, color: "inherit", marginTop: 0, display: "inline-flex" }} />
              )}
            </div>
            <div><strong>{bootstrap.location?.name ?? posText("สาขาหลัก")}</strong><span>{bootstrap.device.registeredPosNo ?? bootstrap.device.code} {" " + posText("· กะเปิดอยู่")}</span></div>
          </div>
          <div className={styles.topMeta}>
            <span className={styles.refreshStatus} role="status" aria-label={posText("สถานะการอัปเดตข้อมูล")} aria-live="polite" aria-atomic="true">
              {contentRefreshing ? posText("กำลังอัปเดตข้อมูล…") : ""}
            </span>
            <div className={styles.connectionSlot}><PosConnectionStatus apiStatus={connection} /></div>
            <button type="button" className={styles.alertBell} aria-label={posText("รีเฟรชข้อมูล")} title={posText("รีเฟรชข้อมูล")}
              disabled={contentRefreshing || busy || Boolean(saleAttemptRef.current)}
              onClick={() => void refreshDesktopContent()}><ReloadOutlined spin={contentRefreshing} /></button>
            <DesktopUpdateMenu />
            <details className={styles.alertMenu} data-desktop-popup>
              <summary
                className={`${styles.alertBell}${alerts.settings.enabled ? ` ${styles.alertBellOn}` : ""}${alerts.blocked ? ` ${styles.alertBellBlocked}` : ""}`}
                aria-label={posText("การแจ้งเตือน{v0}{v1}", { v0: pendingServiceCallCount ? posText(" รอรับ {v0} รายการ", { v0: pendingServiceCallCount }) : "", v1: acknowledgedServiceCallCount ? posText(" กำลังดำเนินการ {v0} รายการ", { v0: acknowledgedServiceCallCount }) : "" })}
                title={serviceCalls.length
                  ? posText("รอรับ {v0} · กำลังดำเนินการ {v1}", { v0: pendingServiceCallCount, v1: acknowledgedServiceCallCount })
                  : posText("การแจ้งเตือน")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                </svg>
                {!alerts.settings.enabled ? <span className={styles.alertBellSlash} aria-hidden="true" /> : null}
                {serviceCalls.length > 0
                  ? <span className={`${styles.alertCount}${pendingServiceCallCount === 0 ? ` ${styles.alertCountActive}` : ""}`} aria-hidden="true">{serviceCalls.length > 99 ? "99+" : serviceCalls.length}</span>
                  : alerts.blocked ? <span className={styles.alertBellDot} aria-hidden="true" /> : null}
              </summary>
              <div className={styles.alertPopover}>
                <div className={styles.alertPopoverHead}>
                  <div>
                    <strong>{posText("การแจ้งเตือน")}</strong>
                    <small>{serviceCalls.length
                      ? posText("รอรับ {v0} · กำลังดำเนินการ {v1}", { v0: pendingServiceCallCount, v1: acknowledgedServiceCallCount })
                      : posText("ไม่มีคำเรียกที่ต้องดำเนินการ")}</small>
                  </div>
                  <button type="button" onClick={() => setAlertSettingsOpen(true)} aria-label={posText("ตั้งค่าเสียงแจ้งเตือน")}>{posText("⚙ ตั้งค่าเสียง")}</button>
                </div>
                <div className={styles.alertList}>
                  {serviceCalls.length === 0 ? (
                    <div className={styles.alertEmpty}><span aria-hidden="true">✓</span><p>{posText("ไม่มีงานค้าง")}</p></div>
                  ) : serviceCalls.map((call) => (
                    <article className={styles.alertItem} data-status={call.status} key={`${call.source}:${call.id}`}>
                      <button type="button" className={styles.alertItemMain} onClick={() => openServiceCall(call)}>
                        <span className={styles.alertItemIcon} aria-hidden="true">{call.status === "PENDING" ? "🔔" : "✓"}</span>
                        <span>
                          <strong>{call.tableName || call.tableCode}</strong>
                          <b>{serviceCallLabel(call, posText)}</b>
                          <small>{call.status === "PENDING" ? posText("รอรับเรื่อง") : posText("กำลังดำเนินการ")} · {serviceCallAge(call.createdAt, posText)} · {call.source === "restaurant" ? posText("ร้านอาหาร") : posText("บอร์ดเกม")}</small>
                        </span>
                      </button>
                      <button type="button" className={`${styles.alertAccept}${call.status === "ACKNOWLEDGED" ? ` ${styles.alertComplete}` : ""}`} disabled={serviceCallsBusy === call.id} onClick={() => void updateServiceCall(call)}>
                        {serviceCallsBusy === call.id
                          ? call.status === "PENDING" ? posText("กำลังรับ…") : posText("กำลังปิด…")
                          : call.status === "PENDING" ? posText("รับเรื่อง") : posText("เสร็จสิ้น")}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </details>
            <details ref={accountMenuRef} className={styles.accountMenu} data-desktop-popup>
              <summary aria-label={posText("เมนูพนักงาน {v0}", { v0: cashier?.name || cashier?.email || "" })}>
                <span className={styles.accountAvatar} aria-hidden="true">
                  {(cashier?.name || cashier?.email || posText("พ")).slice(0, 1)}
                </span>
                <span className={styles.accountCopy}>
                  <strong>{cashier?.name || cashier?.email}</strong>
                  <small>{posText("พนักงานขาย")}</small>
                </span>
                <span className={styles.accountChevron} aria-hidden="true">⌄</span>
              </summary>
              <div className={styles.accountPopover}>
                {hasDesktopPosBridge() ? (
                  <>
                    <button className={styles.accountAdmin} onClick={() => void openAdminBackoffice()}>
                      {posText("เปิดระบบหลังบ้าน") + " "}<span aria-hidden="true">↗</span>
                    </button>
                    <div className={styles.accountDivider} />
                  </>
                ) : null}
                <button className={styles.accountSignOut} onClick={signOutCashier}>
                  {posText("ล็อก / เปลี่ยนพนักงาน") + " "}</button>
              </div>
            </details>
          </div>
          {contentRefreshing ? <div className={styles.refreshProgress} aria-hidden="true" /> : null}
        </header>

        {shownModule !== "mobile_sell" && shownModule !== "restaurant" ? (
          <div className={`${styles.content} ${styles.moduleContent}${error ? ` ${styles.moduleContentError}` : ""}`}>
            {error ? <PosDismissibleAlert key={error} className={styles.errorBox} onClose={() => setError("")}>{error}</PosDismissibleAlert> : null}
            <section
              className={`${styles.moduleHost}${shownModule === "boardgame" ? ` ${styles.boardGameModuleHost}` : ""}`}
            >
              {shownModule === "boardgame" ? (
                <BoardGamePanel
                  token={token}
                  cashierUserId={cashier?.id ?? cashierId}
                  pin={pin}
                  refreshSignal={contentRefreshSignal}
                  onCheckout={openBoardGameCheckout}
                  onServiceCallsChange={acceptBoardGameServiceCalls}
                />
              ) : (
                <PosWorkspaceContext.Provider value={{
                  embedded: true,
                  initialTab: shownModule,
                  initialToken: token,
                  initialCashierId: cashier?.id ?? cashierId,
                  initialPin: pin,
                  refreshSignal: contentRefreshSignal,
                  suppressCustomerDisplay: desktopOwnsCustomerDisplay,
                  onTabChange: followWorkspaceTab,
                  onShiftChange: followWorkspaceShift,
                  onUnpair: unpair,
                  onBoardGameCheckout: openBoardGameCheckout,
                  onServiceCallsChange: acceptBoardGameServiceCalls,
                }}>
                  <PosPage />
                </PosWorkspaceContext.Provider>
              )}
            </section>
          </div>
        ) : (
        <div className={styles.content}>
          <section className={styles.catalogPane}>
            {checkout ? (
              <>
                <div className={styles.sectionHead}>
                  <button className={styles.backButton} onClick={backFromCheckout}>
                    ← {boardGameCheckout ? posText("กลับหน้าบอร์ดเกม") : posText("กลับไปแก้รายการ")}
                  </button>
                  <div>
                    <p className={styles.eyebrow}>{posText("ตรวจสอบก่อนรับเงิน")}</p>
                    <h1>{boardGameCheckout ? posText("สรุปบิลบอร์ดเกม") : posText("สรุปรายการขาย")}</h1>
                  </div>
                </div>
                <div className={styles.orderSummary}>
                  {boardGameCheckout ? (
                    <>
                      <BoardGameBillBreakdown checkout={boardGameCheckout} />
                      {boardGameBenefitAmount > 0 ? (
                        <div className={styles.serviceBenefit}>
                          <strong>
                            {boardGameCheckout.offerDiscountAmount > 0
                              ? posText("โปรโมชัน {v0}", { v0: boardGameCheckout.offerName ?? boardGameCheckout.offerCode ?? posText("ค่าเล่น") })
                              : posText("ใช้แพ็กเกจสมาชิกแล้ว")}
                          </strong>
                          <span>
                            {boardGameCheckout.offerDiscountAmount > 0
                              ? posText("ลดค่าเล่น {v0}", { v0: money(boardGameCheckout.offerDiscountAmount) })
                              : posText("แพ็กเกจครอบคลุมค่าเล่น {v0}", { v0: money(boardGameCheckout.passCoveredAmount) })}
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : cart.map((line, index) => (
                    <article key={line.key}>
                      <div className={styles.productThumb}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : line.name.slice(0, 1)}</div>
                      <div><strong>{line.name}</strong><span>{line.sku}{line.size ? ` · ${line.size}` : ""}</span></div>
                      <div className={styles.summaryLinePrice}>
                        <span>{line.qty} {line.unitName} · {t("pos_gifts.shelf_amount")} {money(retailPricing.lines[index].listAmount)}</span>
                        {retailPricing.lines[index].discountAmount > 0 ? <span className={styles.savingsRow}>
                          {retailPricing.lines[index].freeQty > 0 ? t("pos_gifts.line_free_quantity").replace("{qty}", String(retailPricing.lines[index].freeQty)) : t("pos_gifts.pricing_discount")}
                          {` −${money(retailPricing.lines[index].discountAmount)}`}
                        </span> : null}
                        <strong>{t("pos_gifts.after_promotion")} {money(retailPricing.lines[index].amount)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
                <div className={styles.summaryTotals}>
                  {boardGameCheckout ? (
                    <>
                      <div><span>{posText("ค่าเล่นก่อนสิทธิ์")}</span><strong>{money(boardGameGrossTime)}</strong></div>
                      {boardGameBenefitAmount > 0 ? (
                        <div className={styles.savingsRow}>
                          <span>{boardGameCheckout.offerDiscountAmount > 0 ? posText("โปรโมชันค่าเล่น") : posText("แพ็กเกจสมาชิก")}</span>
                          <strong>−{money(boardGameBenefitAmount)}</strong>
                        </div>
                      ) : null}
                      {boardGameCheckout.tabItemCount > 0 ? (
                        <>
                          <div>
                            <span>{posText("สินค้าก่อนส่วนลด")}</span>
                            <strong>{money(boardGameCheckout.tabAmount + boardGameTabDiscountAmount)}</strong>
                          </div>
                          {boardGameTabDiscountAmount > 0 ? (
                            <div className={styles.savingsRow}>
                              <span>{posText("ราคาส่ง / โปรโมชันสินค้า")}</span>
                              <strong>−{money(boardGameTabDiscountAmount)}</strong>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div><span>{posText("ยอดสินค้าราคาป้าย")}</span><strong>{money(retailListSubtotal)}</strong></div>
                      {pricingSavings > 0 ? <div className={styles.savingsRow}><span>{posText("ราคาส่ง / โปรโมชัน")}</span><strong>−{money(pricingSavings)}</strong></div> : null}
                    </>
                  )}
                  {rounding !== 0 ? <div><span>{posText("ปัดเศษเงินสด")}</span><strong>{money(rounding)}</strong></div> : null}
                  {benefits.ready && Number(benefits.preview?.totalDiscount) > 0 ? <div className={styles.savingsRow}><span>{posText("สมาชิก / คูปอง / แต้ม")}</span><strong>−{money(benefits.preview!.totalDiscount)}</strong></div> : null}
                  <div className={styles.grandTotal}><span>{posText("ยอดสุทธิ")}</span><strong>{money(total)}</strong></div>
                </div>
              </>
            ) : (
              <>
                <form className={styles.scanBar} onSubmit={(event) => { event.preventDefault(); scanInputRef.current?.focus(); void addProduct(scanCode, undefined, true); }}>
                  <span className={styles.barcode}>▥</span>
                  <input ref={scanInputRef} autoFocus aria-label={posText("สแกนบาร์โค้ดหรือรหัสสินค้า")} value={scanCode} onChange={(event) => { scanDraftRevision.current += 1; setScanCode(event.target.value); }} placeholder={posText("ยิงบาร์โค้ด หรือพิมพ์รหัสสินค้า แล้วกด Enter")} />
                  <kbd>F12</kbd>
                </form>
                <div className={styles.catalogHeader}>
                  <div><p className={styles.eyebrow}>{posText("แคตตาล็อกสินค้า")}</p><h1>{posText("เลือกสินค้า")}</h1></div>
                  <input value={query} onChange={(event) => { clearScannedProduct(); setQuery(event.target.value); }} placeholder={posText("ค้นหาชื่อหรือ SKU")} />
                </div>
                {(error || notice) ? <PosDismissibleAlert key={error || notice} className={error ? styles.errorBox : styles.noticeBox} onClose={() => { setError(""); setNotice(""); }}>{error || noticeText}{!error && notice === ADVANCED_ITEM_NOTICE ? <button onClick={() => openModule("sell")}>{posText("เปิดหน้าขายแบบเต็ม")}</button> : null}</PosDismissibleAlert> : null}
                {catalog.length && catalogError ? (
                  <PosDismissibleAlert
                    key={catalogError}
                    className={styles.errorBox}
                    onClose={() => setCatalogError("")}
                  >
                    {posText("อัปเดตรายการสินค้าไม่สำเร็จ ·") + " "}{catalogError}
                    <button onClick={() => void loadCatalog(query)}>{posText("ลองใหม่")}</button>
                  </PosDismissibleAlert>
                ) : null}
                {scannedProduct ? <ScannedProductPanel result={scannedProduct} busy={busy || Boolean(addingProductKey)}
                  onSelect={(code, size) => { void addProduct(code, size); scanInputRef.current?.focus(); }}
                  onClose={() => { clearScannedProduct(); setError(""); setNotice(""); scanInputRef.current?.focus(); }} /> : null}
                <div className={styles.productGrid} aria-busy={catalogLoading} hidden={Boolean(scannedProduct)}>
                  {catalog.map((item) => {
                    const selection = selectPosCatalogCardVariant(item);
                    const selectedVariant = selection.variant;
                    const addingKey = `${item.sku}\u0000${selectedVariant?.size ?? ""}`;
                    // The server decides sellability (isMenuSellable): a RECIPE/NON_STOCK menu is
                    // AVAILABLE with a zero own-stock row, so availableTotal is not the gate.
                    const sellable = item.availability === "AVAILABLE";
                    const stockLabel = !sellable
                      ? item.availability === "SOLD_OUT_TODAY" ? posText("หมดวันนี้") : posText("หมด")
                      : item.availableSizes.length > 1 ? posText("เลือก {v0} ไซส์", { v0: item.availableSizes.length })
                      : selection.available > 0
                        ? posText("เหลือ {v0}{v1}", { v0: selection.available, v1: selectedVariant?.size ? ` · ${selectedVariant.size}` : "" })
                        : posText("พร้อมขาย");
                    return (
                    <div key={item.sku} className={styles.productCardWrap}>
                    <button
                      className={styles.productCard}
                      disabled={!sellable || busy}
                      aria-busy={addingProductKey === addingKey}
                      data-adding={addingProductKey === addingKey}
                      onClick={() => void addProduct(item.sku, item.availableSizes.length > 1 ? undefined : selectedVariant?.size)}
                    >
                      <div className={styles.productImage}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>{item.name.slice(0, 1)}</span>}</div>
                      <strong>{item.name}</strong><small>{item.sku}</small>
                      <div>
                        <b>{item.availableSizes.length > 1 ? posText("เริ่ม ") : ""}{money(selection.price)}</b>
                        <span className={sellable ? styles.stockOk : styles.stockOut}>
                          {stockLabel}
                        </span>
                      </div>
                    </button>
                    <button type="button" className={styles.productInfo} title={t("admin_board_game.product_details")} aria-label={t("admin_board_game.product_details")}
                      disabled={busy} onClick={() => setInspectedProduct({ code: item.sku, size: selectedVariant?.size, packCode: "BASE" })}><InfoCircleOutlined /></button>
                    </div>
                    );
                  })}
                  {!catalog.length && catalogLoading ? (
                    <div className={styles.catalogStatus} role="status">
                      <span className={styles.catalogSpinner} aria-hidden="true" />
                      <strong>{posText("กำลังโหลดสินค้า…")}</strong>
                      <span>{posText("กำลังตรวจราคาและสต็อกล่าสุดของสาขานี้")}</span>
                    </div>
                  ) : null}
                  {!catalog.length && !catalogLoading && catalogError ? (
                    <div className={`${styles.catalogStatus} ${styles.catalogStatusError}`} role="alert">
                      <strong>{posText("โหลดรายการสินค้าไม่สำเร็จ")}</strong>
                      <span>{catalogError}</span>
                      <button onClick={() => void loadCatalog(query)}>{posText("ลองใหม่")}</button>
                    </div>
                  ) : null}
                  {!catalog.length && !catalogLoading && !catalogError && !busy ? (
                    <div className={styles.emptyCatalog}>{posText("ไม่พบสินค้า ลองค้นด้วยชื่อหรือยิงบาร์โค้ด")}</div>
                  ) : null}
                </div>
              </>
            )}
          </section>

          <aside className={styles.checkoutPane}>
            <div className={styles.billHeader}>
              <div><span>{checkout ? posText("ยอดชำระ") : posText("บิลปัจจุบัน")}</span><small>{billCountLabel}</small></div>
              <strong>{money(total)}</strong>
            </div>

            {!checkout ? (
              <>
                <div className={styles.cartLines}>
                  <GiftPromotionSummary lines={cart} disabled={busy || Boolean(addingProductKey)} onAdd={(sku, size) => { void addProduct(sku, size); }} />
                  {cart.map((line) => (
                    <article key={line.key}>
                      <div className={styles.cartName}><strong>{line.name}</strong><span>{line.sku}{line.size ? ` · ${line.size}` : ""}</span></div>
                      <div className={styles.stepper}><button disabled={Boolean(addingProductKey)} onClick={() => changeQty(line.key, -1)}>−</button><b>{line.qty}</b><button disabled={Boolean(addingProductKey)} onClick={() => changeQty(line.key, 1)}>+</button></div>
                      <strong>{money(Number(line.packBasePrice ?? line.unitPrice ?? 0) * line.qty)}</strong>
                    </article>
                  ))}
                  {!cart.length ? <div className={styles.emptyCart}><span>▥</span><strong>{posText("ยังไม่มีสินค้าในบิล")}</strong><p>{posText("ยิงบาร์โค้ดหรือเลือกสินค้าจากด้านซ้าย")}</p></div> : null}
                </div>
                <div className={styles.cartFooter}>
                  {pricingSavings > 0 ? <div className={styles.savingsRow}><span>{posText("ส่วนลดราคาส่ง / โปรโมชัน")}</span><strong>−{money(pricingSavings)}</strong></div> : null}
                  <div><span>{posText("ยอดสุทธิ")}</span><strong>{money(total)}</strong></div>
                  <button className={styles.payButton} disabled={!cart.length || Boolean(addingProductKey) || scannedProduct?.kind === "selection"}
                    onClick={() => {
                      if (addProductPendingRef.current || scannedProduct?.kind === "selection") return;
                      setError(""); setNotice(""); sendFlow("START_CHECKOUT");
                    }}>{posText("ไปชำระเงิน") + " "}<span>→</span></button>
                </div>
              </>
            ) : (
              <div className={styles.paymentArea}>
                <GiftPromotionSummary lines={cart} />
                <CheckoutBenefits benefits={benefits} disabled={busy || Boolean(saleAttemptRef.current)} />
                {zeroDueBoardGameBill ? (
                  <PosDismissibleAlert className={styles.zeroDueNotice} role="status">
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>{posText("บิลนี้ไม่ต้องรับเงินเพิ่ม")}</strong>
                      <p>
                        {boardGameCheckout?.passCoveredAmount
                          ? posText("แพ็กเกจสมาชิกครอบคลุมค่าเล่น {v0}", { v0: money(boardGameCheckout.passCoveredAmount) })
                          : posText("ยอดสุทธิของกลุ่มนี้เป็นศูนย์")}
                      </p>
                    </div>
                  </PosDismissibleAlert>
                ) : (
                  <fieldset className={styles.paymentControls} disabled={busy || Boolean(saleAttemptRef.current)}>
                <div className={styles.paymentTitle}><div><h2>{posText("วิธีชำระเงิน")}</h2><p>{posText("เลือกหนึ่งวิธี หรือแบ่งชำระหลายช่องทาง")}</p></div><button onClick={addSplitPayment}>{posText("＋ จ่ายผสม")}</button></div>
                <div className={styles.methodGrid}>
                  {primaryMethods.map((method) => (
                    <button key={method} className={payments.length === 1 && payments[0].method === method ? styles.methodActive : ""} onClick={() => chooseMethod(method)}>
                      <span>{method === "cash" ? "▣" : method === "qr" ? "▦" : method === "card" ? "▤" : "▱"}</span>{paymentMethodLabel(method, posText)}
                    </button>
                  ))}
                </div>
                <div className={styles.paymentRows}>
                  {payments.map((payment, index) => (
                    <section key={payment.id}>
                      {payments.length > 1 ? (
                        <div className={styles.paymentRowHead}>
                          <label>{posText("ช่องทาง") + " "}<select value={payment.method} onChange={(event) => updatePayment(payment.id, { method: event.target.value as PosPaymentMethod, reference: event.target.value === "cash" ? undefined : "", tendered: event.target.value === "cash" ? payment.amount : undefined })}>
                              {[...primaryMethods, "bank_transfer" as const].map((method) => <option key={method} value={method}>{paymentMethodLabel(method, posText)}</option>)}
                            </select>
                          </label>
                          <label>{posText("ยอดช่องทางนี้")}<input inputMode="decimal" value={payment.amount || ""} onChange={(event) => updatePayment(payment.id, { amount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <button className={styles.removePayment} onClick={() => removePayment(payment.id)}>{posText("ลบ")}</button>
                        </div>
                      ) : null}
                      {payment.method === "cash" ? (
                        <>
                          <label className={styles.receivedInput}>{posText("รับเงินมา")}<input inputMode="decimal" value={payment.tendered ?? ""} onChange={(event) => updatePayment(payment.id, { tendered: Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <div className={styles.quickCash}>{quickCashAmounts(payment.amount).map((amount) => <button key={amount} onClick={() => updatePayment(payment.id, { tendered: amount }, amount === payment.amount)}>{amount === payment.amount ? posText("พอดี") : `฿${amount}`}</button>)}</div>
                          <div className={styles.change}><span>{posText("เงินทอน")}</span><strong>{money(calculateCashChange(payment.amount, payment.tendered ?? 0))}</strong></div>
                        </>
                      ) : (
                        <>
                          <label className={styles.referenceInput}>
                            {payment.method === "qr" ? posText("เลขอ้างอิง (ไม่บังคับ)") : posText("เลขอ้างอิง")}
                            <input
                              value={payment.reference ?? ""}
                              onChange={(event) => updatePayment(payment.id, { reference: event.target.value })}
                              placeholder={payment.method === "qr" ? posText("เว้นว่างได้") : posText("เลขท้าย / Transaction ID")}
                            />
                          </label>
                          {payment.method === "qr" ? <p className={styles.qrPaymentHint}>{posText("Dynamic QR ระบุยอดแล้ว กรุณาตรวจชื่อผู้รับ ยอด และรายการเงินเข้าก่อนกดยืนยัน")}</p> : null}
                        </>
                      )}
                      {index < payments.length - 1 ? <hr /> : null}
                    </section>
                  ))}
                </div>
                  </fieldset>
                )}
                {(error || notice || (!zeroDueBoardGameBill && validation.errors.length > 0)) ? <PosDismissibleAlert key={error || notice || validation.errors[0]} className={error ? styles.errorBox : styles.noticeBox} onClose={() => { setError(""); setNotice(""); }}>{error || notice || validation.errors[0]?.replace(posText("ทดสอบ"), "")}</PosDismissibleAlert> : null}
                <div className={styles.paymentFooter}>
                  <div><span>{validation.remaining > 0 && !zeroDueBoardGameBill ? posText("ยังขาด") : zeroDueBoardGameBill ? posText("พร้อมปิดบิล") : posText("พร้อมรับชำระ")}</span><strong>{validation.remaining > 0 && !zeroDueBoardGameBill ? money(validation.remaining) : money(total)}</strong></div>
                  <button className={styles.payButton} disabled={!canConfirmPayment || busy} onClick={() => void submitSale()}>{busy ? posText("กำลังบันทึก…") : saleAttemptRef.current ? posText("ลองบันทึกซ้ำด้วยรหัสเดิม") : zeroDueBoardGameBill ? posText("ยืนยันปิดบิล") : posText("ยืนยันรับชำระ {v0}", { v0: money(total) })}</button>
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
      {desktopInfoDialog ? (
        <div className={styles.infoBackdrop} onPointerDown={(event) => {
          if (event.target === event.currentTarget) setDesktopInfoDialog(null);
        }}>
          <section className={styles.infoDialog} role="dialog" aria-modal="true" aria-labelledby="desktop-info-title">
            <header className={styles.infoDialogHead}>
              <div className={styles.infoDialogMark} aria-hidden="true">{desktopInfoDialog === "help" ? "?" : "B"}</div>
              <div>
                <h2 id="desktop-info-title">{desktopInfoDialog === "help" ? posText("ศูนย์ช่วยเหลือ") : posText("เกี่ยวกับ BMS POS")}</h2>
                <p>{desktopInfoDialog === "help" ? posText("คำแนะนำสำหรับงานหน้าร้าน") : posText("ข้อมูลแอปและเครื่องที่กำลังใช้งาน")}</p>
              </div>
              <button autoFocus type="button" className={styles.infoDialogClose} aria-label={posText("ปิด")} onClick={() => setDesktopInfoDialog(null)}>×</button>
            </header>

            {desktopInfoDialog === "help" ? (
              <div className={styles.helpBody}>
                <section className={styles.helpQuickGrid}>
                  <article><span>▥</span><div><strong>{posText("ขายสินค้า")}</strong><p>{posText("ยิงบาร์โค้ดหรือกด F12 เพื่อกลับไปช่องค้นหา จากนั้นตรวจยอดก่อนรับชำระ")}</p></div></article>
                  <article><span>🔔</span><div><strong>{posText("ลูกค้าเรียก")}</strong><p>{posText("เปิดกระดิ่ง กด “รับเรื่อง” และกด “เสร็จสิ้น” หลังดูแลโต๊ะเรียบร้อย")}</p></div></article>
                  <article><span>●</span><div><strong>{posText("สถานะระบบ")}</strong><p>{posText("เขียวคือ realtime ปกติ เหลืองกำลังใช้การอัปเดตสำรอง แดงให้ตรวจอินเทอร์เน็ต")}</p></div></article>
                </section>
                <div className={styles.helpSafety}>
                  <strong>{posText("หากไม่ทราบผลหลังรับเงิน")}</strong>
                  <p>{posText("อย่ากดรับชำระซ้ำทันที ให้ตรวจใบเสร็จและรายการล่าสุดก่อน เพื่อป้องกันการบันทึกซ้ำ")}</p>
                </div>
                <div className={styles.helpShortcuts}>
                  <span><kbd>F12</kbd> {" " + posText("ค้นหา/ยิงสินค้า")}</span>
                  <span><kbd>Esc</kbd> {" " + posText("ปิดหน้าต่าง")}</span>
                  {hasDesktopPosBridge() ? <>
                    <span><kbd>Command/Ctrl + R</kbd> {" " + posText("รีเฟรชข้อมูลหน้าปัจจุบัน โดยไม่ออกจากพนักงาน")}</span>
                    <span><kbd>Command/Ctrl + Shift + R</kbd> {" " + posText("โหลดแอปใหม่ทั้งหมด ใช้เมื่อหน้าค้าง")}</span>
                  </> : null}
                </div>
                <button type="button" className={styles.infoPrimary} onClick={() => window.open("/pos/manual", "bms-pos-manual", "width=980,height=900")}>{posText("เปิดคู่มือฉบับเต็ม")}</button>
              </div>
            ) : (
              <div className={styles.aboutBody}>
                <div className={styles.aboutHero}>
                  <span>B</span>
                  <div><strong>BMS POS</strong><small>{desktopAppInfo
                    ? `Desktop v${desktopAppInfo.version}`
                    : hasDesktopPosBridge()
                      ? desktopAppInfoLoaded ? posText("ไม่พบข้อมูลเวอร์ชัน") : posText("กำลังอ่านเวอร์ชัน…")
                      : "Browser preview"}</small></div>
                </div>
                <dl className={styles.aboutFacts}>
                  <div><dt>{posText("ไคลเอนต์")}</dt><dd>{desktopAppInfo?.clientLabel ?? (hasDesktopPosBridge() ? "Desktop Client" : "Web Browser")}</dd></div>
                  <div><dt>{posText("เครื่องขาย")}</dt><dd>{bootstrap.device.registeredPosNo ?? bootstrap.device.code}</dd></div>
                  <div><dt>{posText("สาขา")}</dt><dd>{bootstrap.location?.name ?? posText("สาขาหลัก")}</dd></div>
                  <div><dt>{posText("การเชื่อมต่อ")}</dt><dd data-tone={connectionMode}>{connectionLabel}</dd></div>
                  <div><dt>{posText("เซิร์ฟเวอร์")}</dt><dd>{typeof window === "undefined" ? "-" : window.location.host}</dd></div>
                </dl>
                {desktopAppInfo?.securityNote ? <p className={styles.aboutSecurity}>⌾ {desktopAppInfo.securityNote}</p> : null}
                <p className={styles.aboutNote}>{posText("ข้อมูลเวอร์ชันนี้ใช้ประกอบการแจ้งปัญหา และไม่มี Device Token หรือข้อมูลการชำระเงิน")}</p>
                <button type="button" className={styles.infoPrimary} onClick={() => void (async () => {
                  const diagnostic = [
                    `BMS POS ${desktopAppInfo ? `Desktop v${desktopAppInfo.version}` : hasDesktopPosBridge() ? "Desktop (version unavailable)" : "Browser"}`,
                    `Client: ${desktopAppInfo?.clientLabel ?? "Web Browser"}`,
                    `Platform: ${desktopAppInfo?.platform ?? "browser"}`,
                    `Register: ${bootstrap.device.registeredPosNo ?? bootstrap.device.code}`,
                    `Branch: ${bootstrap.location?.name ?? posText("สาขาหลัก")}`,
                    `Connection: ${connectionLabel}`,
                    `Server: ${window.location.host}`,
                  ].join("\n");
                  setDiagnosticsCopied(await copyTextToClipboard(diagnostic));
                })()}>{diagnosticsCopied ? posText("คัดลอกข้อมูลแล้ว ✓") : posText("คัดลอกข้อมูลระบบ")}</button>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {inspectedProduct && <ProductDetailsModal token={token} target={inspectedProduct} onClose={() => setInspectedProduct(null)} />}
      {!hasDesktopPosBridge() ? <div className={styles.browserBadge}>{posText("Browser preview · Electron จะเก็บ device token ใน OS keychain")}</div> : null}
    </main>
  );
}
