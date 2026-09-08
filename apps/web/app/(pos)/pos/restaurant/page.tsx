"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, AudioMutedOutlined, ClockCircleOutlined, CloseCircleOutlined, CoffeeOutlined, CustomerServiceOutlined, DownloadOutlined, FileTextOutlined, MergeCellsOutlined, MoreOutlined, PrinterOutlined, QrcodeOutlined, ReloadOutlined, ScissorOutlined, SettingOutlined, ShopOutlined, SoundOutlined, SwapOutlined, TeamOutlined, WalletOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, Modal, Segmented, Spin, Tag, message } from "antd";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
import { appendSplitPaymentRow, checkoutBlockReason, rebalanceSplitPayments, type PosPaymentDraft } from "@/lib/pos/paymentDraft";
import { describePosFailure, describeTransportFailure } from "@/lib/pos/failureMessage";
import { describeUnmetModifierGroups, unmetModifierGroups } from "@/lib/pos/modifierSelection";
import { buildDrawerKick, buildReceipt, type ReceiptLine, type ReceiptPayload } from "@/lib/pos/escpos";
import { findRememberedPrinter, isWebUsbSupported, requestPrinter, sendToPrinter } from "@/lib/pos/printerClient";
import ReceiptPaper from "@/components/pos/ReceiptPaper";
import { posPaymentMethodLabel, receiptDocumentTitle, receiptLocale, type ReceiptLanguageMode } from "@/lib/pos/receiptI18n";
import { useI18n } from "@/lib/i18nContext";
import { flushSupportActivity, localSupportEventCount, recordSupportActivity } from "@/lib/supportActivity";
import PosGuideAssistant from "@/components/work-assistant/PosGuideAssistant";
import RestaurantTableChairs from "@/components/RestaurantTableChairs";
import {
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenBoardStationFilters,
  kitchenElapsedSeconds,
  pickReferenceAt,
  countKitchenDishes,
  kitchenUrgency,
  slaForStationRef,
  ticketMatchesStation,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenBoardGroup,
  type KitchenSla,
  type KitchenStationFilter,
} from "@/lib/bms/kitchenBoard";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import { useLiveRefresh, usePageVisible } from "@/app/hooks/useLiveRefresh";
import { useWakeLock } from "@/app/hooks/useWakeLock";
import OrderAlertSettingsModal from "@/components/pos/OrderAlertSettingsModal";
import {
  alertPollIntervalMs,
  describeAgo,
  evaluateAlertRepeat,
  feedHealth,
  newAlertIds,
  IDLE_ALERT_REPEAT,
  type AlertKind,
  type AlertRepeatState,
} from "@/lib/pos/orderAlertSound";
import styles from "./restaurant.module.css";

/** เหตุการณ์ที่จอนี้เห็นจริง — หน้าตั้งค่าแสดงเฉพาะชุดนี้ ไม่ยื่นตัวเลือกที่ตั้งแล้วไม่มีผล */
const RESTAURANT_ALERT_KINDS: readonly AlertKind[] = ["ORDER_NEW", "QR_PENDING", "FOOD_READY", "SLA_LATE"] as const;

const TOKEN_KEY = "bms.pos.deviceToken";
// จำ "ฉันยืนอยู่จอไหน / โต๊ะไหน" ไว้ข้ามการรีเฟรช — ต่อท้ายด้วย device token เพื่อผูกกับ
// เครื่องนี้เครื่องเดียว (แบบเดียวกับ bms.pos.localTab. ของหน้าค้าปลีก) เครื่องอื่นที่ใช้
// เบราว์เซอร์เดียวกัน — หรือเครื่องเดิมที่ถูก pair ใหม่ — จะไม่เห็นของกันและกัน
//
// **ตั้งใจจำแค่ "ยืนอยู่ไหน" ไม่จำ "กรองอะไรไว้" และไม่จำ "ใครกำลังทำงาน"**:
//   · โหมดแจ้งของหมด → กลับมาแล้วแตะการ์ดจะเป็นการปิดเมนู ไม่ใช่สั่งอาหาร
//   · ตัวกรองหมดวันนี้ / หมวดหมู่ / สถานีบนจอครัว → ตัวกรองที่ค้างข้ามรีเฟรชคือการซ่อนงานจริง
//     (โค้ดปัจจุบันปลดตัวกรองเองเมื่อไม่มีงานด้วยเหตุผลนี้)
//   · ผู้ปฏิบัติงาน + PIN → PIN ไม่ลง localStorage เด็ดขาด และชื่อคนที่ค้างบนหัวจอทำให้
//     เข้าใจผิดว่าใครกำลังทำงานอยู่
const LOCAL_SCREEN_KEY_PREFIX = "bms.pos.restaurantScreen.";
const LOCAL_CHECK_KEY_PREFIX = "bms.pos.restaurantCheck.";
// บิลที่ไม่มีใครแตะนานกว่านี้ไม่คืนให้ (นับจากการแตะครั้งล่าสุด ไม่ใช่ตอนเปิดโต๊ะ) —
// กันแท็บเล็ตที่ถูกหยิบมาเช้าวันถัดไปแล้วเปิดบิลค้างของเมื่อวานขึ้นมาเงียบ ๆ
// ค่าเท่ากับ LOCAL_CART_DRAFT_MAX_AGE_MS ของหน้าค้าปลีก (ครอบหนึ่งกะเต็ม)
const LOCAL_CHECK_MAX_AGE_MS = 8 * 60 * 60 * 1000;
type RestaurantScreen = "ORDER" | "FLOOR" | "QUEUE" | "QR" | "CALLS" | "KITCHEN" | "BILLS" | "SHIFT";
const RESTAURANT_SCREENS: RestaurantScreen[] = ["ORDER", "FLOOR", "QUEUE", "QR", "CALLS", "KITCHEN", "BILLS", "SHIFT"];
// จอครัวที่ติดผนังต้องปักหมุดลิงก์ได้ — ?screen=kitchen ชนะค่าที่จำไว้เสมอ จึงตรงแม้
// เครื่องนั้นล้าง site data หรือเปิดในโหมดส่วนตัว (ล้อรูปแบบ ?surface=retail ที่มีอยู่แล้ว)
//
// **ห้ามเขียนจอที่เปิดอยู่กลับลง URL** — เคยลองแล้วพัง: พอ replaceState ใส่ ?screen= ให้เอง
// ทุกครั้งที่สลับจอ การโหลดครั้งถัดไป *ทุกครั้ง* จะดูเหมือนลิงก์ที่คนตั้งใจปักหมุด แล้ว
// การคืนค่าอื่น (บิลที่ทำอยู่) ถูกข้ามไปเงียบ ๆ · พารามิเตอร์นี้ต้องมีเมื่อ "คนตั้งใจใส่" เท่านั้น
const SCREEN_FROM_URL: Record<string, RestaurantScreen> = {
  order: "ORDER", sell: "ORDER", floor: "FLOOR", table: "FLOOR", tables: "FLOOR", queue: "QUEUE", waitlist: "QUEUE", booking: "QUEUE", qr: "QR", qrorders: "QR", calls: "CALLS", service: "CALLS", kitchen: "KITCHEN", kds: "KITCHEN", bills: "BILLS", receipts: "BILLS", shift: "SHIFT",
};
const OPEN_CHECK_STATUSES = ["OPEN", "CLOSING"];
const isOpenCheckStatus = (status: string | null | undefined) => OPEN_CHECK_STATUSES.includes(status ?? "");
const queueStatusLabels = (t: Translate): Record<string, string> => ({
  WAITING: t("pos_restaurant.queue_waiting"), CALLED: t("pos_restaurant.queue_called"),
  SEATED: t("pos_restaurant.queue_seated"), CANCELLED: t("pos_restaurant.queue_cancelled"),
  NO_SHOW: t("pos_restaurant.queue_no_show"),
});
type Staff = { id: string; name: string | null; email: string | null; hasPin: boolean };
type Session = { device: { id: string; code: string; name: string | null; registeredPosNo?: string | null }; location: { id: string; name: string; branchCode: string } | null; shift: { id: string; openedAt: string; openingFloat: number } | null; cashiers: Staff[]; approvers: Array<Staff & { approvals: string[] }>; kitchenOperators: Staff[]; businessArchetype?: string | null; store?: { taxId: string | null; receiptLanguageMode: ReceiptLanguageMode }; vat: { registered?: boolean; priceIncludesVat?: boolean; rate?: number; cashRounding?: CashRounding } };
type FloorCheck = { id: string; status: string; guestCount: number; amountDue: number; openedAt: string; itemCount: number; unsentCount: number; version: number; reservedVersion: number | null; splitGroupNo: number };
type DiningTable = { id: string; areaId: string; code: string; name: string; seats: number; shape: "round" | "rect"; positionX: number; positionY: number; blocked: boolean; status: "AVAILABLE" | "OCCUPIED" | "BLOCKED"; check: FloorCheck | null; checks: FloorCheck[] };
type Floor = { areas: Array<{ id: string; name: string; sortOrder: number }>; tables: DiningTable[] };
type WaitlistEntry = { id: string; kind: "WALK_IN" | "RESERVATION"; status: string; serviceDate: string; queueNo: number | null; reservedFor: string | null; partySize: number; guestName: string | null; guestPhone: string | null; note: string | null; preferredTableId: string | null; preferredTableCode: string | null; seatedTableId: string | null; seatedTableCode: string | null; checkId: string | null; calledAt: string | null; seatedAt: string | null; closedAt: string | null; createdAt: string };
type WaitlistBoard = { entries: WaitlistEntry[]; waitingCount: number; calledCount: number; waitingGuests: number };
const FLOOR_TABLE_SIZE = {
  round: { width: 96, height: 96 },
  rect: { width: 128, height: 76 },
} as const;
type CheckItem = { id: string; sku: string; productName: string; size: string; packQty: number; packCode: string | null; unitName: string | null; packPrice: number | null; lineAmount: number | null; modifierCodes: string[]; modifierNames: string[]; kitchenNote: string | null; status: "NEW" | "SENT" | "CANCELLED"; roundNo: number | null; sentAt: string | null; kitchenStatus: string | null };
type RestaurantCheck = { id: string; tableId: string; tableCode: string; tableName: string; areaName: string; status: string; guestCount: number; amountDue: number; version: number; reservedVersion: number | null; hasCurrentOrder: boolean; reservationStatus: string | null; reservationLost: boolean; openedAt: string; splitGroupNo: number; splitFromCheckId: string | null; items: CheckItem[] };
type SearchItem = { sku: string; name: string; price: number; availableTotal: number; availableSizes: Array<{ size: string; available: number; price?: number }> };
type MenuItem = SearchItem & {
  kitchenStation: string | null;
  kitchenStationId: string | null;
  hasModifiers: boolean;
  imageUrl: string | null;
  sellable: boolean;
  availability: "AVAILABLE" | "SOLD_OUT_TODAY" | "OUT_OF_STOCK";
  unavailableResetsAt: string | null;
  unavailableReason: string | null;
};
type QrSubmissionItem = {
  id: string;
  sku: string;
  productName: string;
  size: string | null;
  packCode: string | null;
  packQty: number;
  modifierCodes: string[];
  modifierNames: string[];
  kitchenNote: string | null;
  estimatedUnitPrice: number;
};
type QrSubmission = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  checkId: string;
  tableId: string;
  tableCode: string;
  tableName: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  estimatedTotal: number;
  items: QrSubmissionItem[];
};
type ServiceCall = {
  id: string;
  requestCode: "WATER" | "CUTLERY" | "BILL" | "MENU_HELP" | "OTHER";
  requestNote: string | null;
  status: "PENDING" | "ACKNOWLEDGED";
  tableId: string;
  tableCode: string;
  tableName: string;
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
};
type PosMember = { customerId: string; name: string; phone: string | null; memberNo: string | null; pointsBalance: number; pointsUsable: number; tier: { code: string; name: string } | null };
/**
 * สถานะโปรแกรมสะสมแต้ม + แต้มที่บิลนี้จะได้ — server คิดมาให้แล้วทั้งคู่
 * (จอไม่ได้รับ "อัตรา" มาคูณเอง เพราะนั่นคือสูตรชุดที่สองที่จะ drift แล้วจอ
 * จะสัญญาแต้มที่ ledger ไม่ได้ให้)
 */
type PosLoyaltyStatus = {
  enabled: boolean;
  pointsForAmount: number | null;
  block: "PROGRAM_DISABLED" | "BELOW_MIN_SPEND" | "NO_VISIT_POINTS" | "RATE_TOO_LOW" | null;
};
type SettlementResult = {
  status: "SOLD"; orderId: string; total: number; cashTendered: number | null; cashChange: number | null;
  docNo: string | null; receiptNo: string | null; billNo: string | null;
  vat: { rate: number; vatAmount: number; netBeforeVat: number; exemptAmount?: number; roundingAmount?: number } | null;
  roundingAmount: number; discountLines: Array<{ source?: string; label: string; amount: number; pointsUsed?: number }>;
  pointsEarned: number | null; pointsBalance: number | null; kitchenTickets: number; replayed: boolean;
};
type SettlementReceipt = {
  result: SettlementResult; check: RestaurantCheck; member: PosMember | null; at: string;
  cashierName: string | null; shiftId: string | null;
  /**
   * วิธีชำระที่ส่งไปและ server รับไว้ในบิลนี้ (หนึ่งแถวต่อหนึ่ง `bms_payments`)
   * ไม่ใช่การคิดเงินซ้ำที่จอ — server ปฏิเสธบิลถ้าผลรวมไม่ตรงยอด จึงเป็นรายการเดียวกับที่เขียนลงฐาน
   */
  payments: Array<{ method: string; amount: number; ref: string | null; cashTendered: number | null; cashChange: number | null }>;
};
type RecentReceipt = {
  orderId: string; docNo: string | null; receiptNo: string | null; billNo: string | null;
  total: number; cashTendered: number | null; cashChange: number | null; soldAt: string;
  cashierName: string | null; locationName: string | null; branchCode: string | null; posLabel: string | null;
  posDeviceId: string | null; shiftId: string | null; orderStatus: string; voidedAt: string | null;
  vat: SettlementResult["vat"]; roundingAmount: number;
  memberName: string | null; memberNo: string | null; pointsEarned?: number | null; pointsBalance?: number | null;
  discountLines: SettlementResult["discountLines"];
  payments: Array<{ method: string; amount: number; ref: string | null; cashTendered: number | null; cashChange: number | null }>;
  lines: Array<{ receiptName: string; size: string; packQty: number; lineTotal: number; unitName: string }>;
};
type ReceiptSelection = SettlementReceipt | RecentReceipt;
/**
 * บิลเก่าที่ถูกยกเลิก/คืนของ ต้องบอกก่อนพิมพ์ซ้ำ ไม่ใช่พิมพ์ออกมาเหมือนบิลปกติ
 *
 * `9.22` เจอมาแล้วว่าใบเสร็จที่เงียบเรื่องการคืน ทำให้คนพิมพ์ซ้ำเข้าใจว่าการคืนไม่ถูกบันทึก
 * แล้วไปคืนซ้ำ · แท็บบิลของร้านอาหารดึงทั้ง COMPLETED และ RETURNED มาเหมือนกัน ถ้าไม่ติดป้าย
 * ก็เท่ากับพาปัญหาเดิมกลับมาที่หน้าใหม่ · ไม่แสดงยอดคงเหลือหลังคืนที่นี่โดยตั้งใจ — เลขนั้น
 * ต้องมาจากไทม์ไลน์การคืนของโหมดค้าปลีก ไม่ใช่จากการคำนวณใหม่ที่จอ
 */
/**
 * เวลาที่พิมพ์บนใบเสร็จ — ISO จาก server ต้องกลายเป็นเวลาท้องถิ่นก่อนถึงกระดาษเสมอ
 * ค่าที่แปลงไม่ได้คืนของเดิม ดีกว่าพิมพ์ "Invalid Date" ให้ลูกค้า
 */
function localReceiptTime(iso: string, mode: ReceiptLanguageMode): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(receiptLocale(mode));
}
type Translate = (key: string, vars?: Record<string, string | number>) => string;
function billHistoryNote(receipt: RecentReceipt, t: Translate): string {
  if (receipt.voidedAt) return t("pos_restaurant.bill_voided");
  if (receipt.orderStatus === "RETURNED") return t("pos_restaurant.bill_returned");
  return "";
}
type ShiftReport = { status: "OPEN" | "CLOSED"; openedAt: string; closedAt: string | null; salesTotal: number; billCount: number; returnCount: number; returnTotal: number; cashIn: number; cashOut: number; noSaleCount: number; expectedCash: number | null; expectedCashHidden: boolean; countedCash: number | null; cashVariance: number | null; byMethod: Array<{ method: string; count: number; amount: number }> };
type CustomerDisplayPayload = {
  lines: Array<{ name: string; size: string | null; qty: number; unitName: string; amount: number }>;
  itemCount: number;
  total: number;
  discountTotal: number;
  amountDue: number;
  memberName: string | null;
  pointsEarned: number | null;
  finished: { total: number; tendered: number | null; change: number | null } | null;
};
// เหตุผลที่ครัวบอกจริงตอนของหมด — เก็บลงหลักฐานว่าปิดเพราะอะไร ไม่ใช่คำว่า "หมดวันนี้"
// ซึ่งเป็นแค่การพูดซ้ำสิ่งที่สถานะบอกอยู่แล้ว
const menuSoldOutReasons = (t: Translate) => [
  t("pos_restaurant.sold_out_reason_ingredients"),
  t("pos_restaurant.sold_out_reason_equipment"),
  t("pos_restaurant.sold_out_reason_service"),
] as const;
const MENU_QTY_SHORTCUTS = [1, 2, 3, 5] as const;
const kitchenNoteShortcuts = (t: Translate) => [
  t("pos_restaurant.note_not_spicy"),
  t("pos_restaurant.note_separate_sauce"),
  t("pos_restaurant.note_no_vegetables"),
  t("pos_restaurant.note_no_nuts"),
] as const;
// สีการ์ดวนตาม station ตามลำดับที่เจอก่อน-หลัง ไม่ผูกกับชื่อ station ตายตัว
// เพราะแต่ละร้านตั้งชื่อ station เองอิสระ (ครัวร้อน/ครัวต้ม/HOT/COLD ฯลฯ)
const MENU_CARD_TINTS = [
  { bg: "var(--tint-1)", ink: "var(--accent)" },
  { bg: "var(--tint-2)", ink: "var(--red)" },
  { bg: "var(--tint-3)", ink: "var(--amber)" },
  { bg: "var(--tint-4)", ink: "var(--green)" },
];
// ภาพอาหารบนการ์ด — วาดด้วย SVG ในโค้ด ไม่โหลดจาก CDN ตามเหตุผลเดียวกับที่หน้านี้
// ไม่โหลดฟอนต์ภายนอก (จอนี้ต้องทำงานตอนเน็ตร้านหลุด) · ใช้เมื่อสินค้ายังไม่มีรูปจริง
// ถ้าร้านอัปโหลดรูปเมนูไว้ที่ /admin/products รูปจริงชนะเสมอ
const DISH_ART: Record<string, (a: string) => JSX.Element> = {
  RICE: (a) => <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <ellipse cx="50" cy="64" rx="34" ry="15" fill={a} opacity=".28" />
    <path d="M20 62c0-13 13-22 30-22s30 9 30 22z" fill={a} />
    <circle cx="40" cy="50" r="5" fill="#fff" opacity=".55" /><circle cx="57" cy="47" r="4" fill="#fff" opacity=".55" />
    <circle cx="65" cy="55" r="3.2" fill="#fff" opacity=".55" />
  </svg>,
  NOODLE: (a) => <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <ellipse cx="50" cy="64" rx="34" ry="15" fill={a} opacity=".28" />
    <path d="M19 60c6-17 18-25 31-25s25 8 31 25z" fill={a} />
    <path d="M28 55c8-4 16-4 24 0M32 46c8-4 18-4 26 1M38 39c6-3 14-3 20 1" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".6" />
  </svg>,
  SOUP: (a) => <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <path d="M16 48h68c0 20-15 31-34 31S16 68 16 48z" fill={a} />
    <ellipse cx="50" cy="48" rx="34" ry="9" fill={a} opacity=".45" />
    <circle cx="38" cy="47" r="4.6" fill="#fff" opacity=".6" /><circle cx="54" cy="45" r="4" fill="#fff" opacity=".6" />
    <path d="M40 30c0-5 5-6 5-11M58 30c0-5 5-6 5-11" stroke={a} strokeWidth="3.4" fill="none" strokeLinecap="round" opacity=".55" />
  </svg>,
  SALAD: (a) => <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <ellipse cx="50" cy="66" rx="34" ry="14" fill={a} opacity=".28" />
    <path d="M23 63c2-15 12-23 27-23s25 8 27 23z" fill={a} />
    <path d="M32 57c6-9 12-12 18-12M45 59c4-10 9-14 15-15" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" opacity=".6" />
  </svg>,
  DRINK: (a) => <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <path d="M33 26h34l-4 51a6 6 0 01-6 5H43a6 6 0 01-6-5z" fill={a} opacity=".32" />
    <path d="M35 43h30l-3 34a5 5 0 01-5 4H43a5 5 0 01-5-4z" fill={a} />
    <rect x="46" y="13" width="5" height="18" rx="2.5" fill={a} transform="rotate(14 48 22)" />
  </svg>,
};

// เลือกภาพจากคำในชื่อเมนูที่คนไทยใช้จริง — เมนูที่จับคำไม่ได้ตกไปที่จานข้าว
// ตั้งใจไม่สุ่ม เพราะการ์ดเดิมต้องได้ภาพเดิมทุกครั้งที่เปิดหน้า ไม่งั้นพนักงานจำตำแหน่งไม่ได้
const DISH_ART_WORDS: Array<[RegExp, keyof typeof DISH_ART]> = [
  [/ชา|กาแฟ|น้ำ|โอเลี้ยง|โซดา|นม|สมูทตี้|เบียร์|ปั่น/, "DRINK"],
  [/ต้ม|แกง|ซุป|โจ๊ก|ก๋วยเตี๋ยว/, "SOUP"],
  [/ตำ|ยำ|สลัด|ลาบ|น้ำตก/, "SALAD"],
  [/ผัดไทย|ผัดหมี่|เส้น|หมี่|สปาเก็ตตี้|พาสต้า|ราดหน้า/, "NOODLE"],
];
function dishArt(name: string, color: string) {
  for (const [words, key] of DISH_ART_WORDS) if (words.test(name)) return DISH_ART[key](color);
  return DISH_ART.RICE(color);
}

function menuCardTint(station: string | null, stations: string[]) {
  const idx = station ? stations.indexOf(station) : stations.length;
  return MENU_CARD_TINTS[((idx % MENU_CARD_TINTS.length) + MENU_CARD_TINTS.length) % MENU_CARD_TINTS.length];
}
type ScanModifier = { code: string; name: string; priceDelta: number; groupCode: string; groupName: string; selectionType: "SINGLE" | "MULTIPLE"; minSelect: number; maxSelect: number | null; defaultSelected: boolean };
type ScanHit = { sku: string; productName: string; size: string; packCode: string; unitName: string; baseQty: number; packPrice: number; available: number; modifiers: ScanModifier[] };

function MenuModifierGroups({ modifiers, selected, onChange }: {
  modifiers: ScanModifier[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const { t } = useI18n();
  const groups = Array.from(modifiers.reduce((map, modifier) => {
    const current = map.get(modifier.groupCode) ?? { meta: modifier, items: [] as ScanModifier[] };
    current.items.push(modifier);
    map.set(modifier.groupCode, current);
    return map;
  }, new Map<string, { meta: ScanModifier; items: ScanModifier[] }>()).values());
  return <div className={styles.modifierList}>{groups.map(({ meta, items }) => {
    const selectedInGroup = items.filter((item) => selected.includes(item.code));
    // บอกกติกาให้ครบ ไม่ใช่แค่ขั้นต่ำ — คนหน้าร้านต้องรู้ก่อนแตะว่าเลือกได้กี่อย่าง
    const single = meta.selectionType === "SINGLE";
    const rule = [
      single || meta.maxSelect === 1 ? t("pos_restaurant.modifier_pick_one")
        : meta.maxSelect != null ? t("pos_restaurant.modifier_pick_max", { max: meta.maxSelect })
        : t("pos_restaurant.modifier_pick_many"),
      meta.minSelect > 0 ? t("pos_restaurant.modifier_pick_min", { min: meta.minSelect }) : null,
    ].filter(Boolean).join(" · ");
    // กลุ่มที่ยังไม่ครบต้องบอกที่ตัวมันเอง — เมนูที่มีหลายกลุ่ม ข้อความรวมท้ายกล่องไม่ชี้ว่าอันไหน
    const needsPick = selectedInGroup.length < meta.minSelect;
    return <fieldset key={meta.groupCode} className={styles.modifierGroup}>
      <legend className={styles.fieldLabel}>{meta.groupName} <span className={styles.fieldRule}>· {rule}</span>
        {needsPick && <span className={styles.fieldNeeded}> · {t("pos_restaurant.modifier_not_chosen")}</span>}
      </legend>
      {/* ชิปแทนกล่องเต็มแถว — เมนูที่มี 4–5 ตัวเลือกไม่ต้องเลื่อนกล่องอีก · ยังเป็น
          radio/checkbox จริงข้างใน (ซ่อนไว้) จึงคุมด้วยคีย์บอร์ดและอ่านด้วย screen reader ได้ */}
      <div className={styles.modifierChips}>
        {items.map((modifier) => {
          const checked = selected.includes(modifier.code);
          // ⚠️ เพดานจำนวนใช้กับกลุ่มที่เลือกได้หลายอย่างเท่านั้น
          //
          // กลุ่มแบบเลือกได้อันเดียว (radio) การแตะตัวอื่นคือการ **แทนที่** ไม่ใช่การ **เพิ่ม**
          // จึงเกินเพดานไม่ได้อยู่แล้ว · เดิมกลุ่ม SINGLE ที่ตั้ง `max_select = 1` (ซึ่งเป็นค่า
          // ปกติของกลุ่มอย่าง "ระดับความเผ็ด") พอมีตัวถูกเลือกอยู่ — ไม่ว่าจะจาก default หรือ
          // จากการแตะครั้งแรก — ตัวที่เหลือจะถูก disabled ทั้งหมด **แล้วเปลี่ยนใจไม่ได้เลย**
          // (เจอจริงบน production: ต้มยำเลือกได้แต่ "เผ็ดปกติ" ที่ระบบติ๊กมาให้)
          // · โค้ดใน onChange เขียนการแทนที่ไว้ถูกแล้ว แต่ไม่มีวันถูกเรียกเพราะ input ถูกปิดก่อน
          const atLimit = !single && meta.maxSelect != null && selectedInGroup.length >= meta.maxSelect;
          return <label className={`${styles.modifierChip} ${checked ? styles.modifierChipOn : ""} ${!checked && atLimit ? styles.modifierChipOff : ""}`} key={modifier.code}>
            <input
              className={styles.modifierChipInput}
              type={single ? "radio" : "checkbox"}
              name={`modifier-${meta.groupCode}`}
              checked={checked}
              disabled={!checked && atLimit}
              onChange={(event) => {
                if (single) {
                  const groupCodes = new Set(items.map((item) => item.code));
                  onChange([...selected.filter((code) => !groupCodes.has(code)), modifier.code]);
                  return;
                }
                onChange(event.target.checked
                  ? [...selected, modifier.code]
                  : selected.filter((code) => code !== modifier.code));
              }}
            />
            <span>{modifier.name}</span>
            {/* ส่วนต่างราคาต้องเห็นก่อนกด ไม่ใช่ไปโผล่ตอนบิลออก */}
            {modifier.priceDelta > 0 && <small>+฿{money(modifier.priceDelta)}</small>}
          </label>;
        })}
      </div>
    </fieldset>;
  })}</div>;
}
type KitchenTicket = { id: string; orderId: string | null; checkId: string | null; tableCode: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; stationId: string | null; station: string | null; status: string; modifierCodes: string[]; productName: string; size: string; packQty: number | null; qty: number; createdAt: string };

// สีเลนอ้างตัวแปรของหน้า ไม่ใช่ค่าคงที่ — ค่าคงที่จะค้างสว่างในโหมดมืด และตัวเลขจำนวน
// บนตั๋ว (.ticketQty) ใช้สีนี้เป็น "ตัวหนังสือ" ซึ่งต้องอ่านออกจากอีกฝั่งครัว
// · ใช้ชุดสีสถานะเดียวกับผังโต๊ะ (tableState) เพื่อให้ "แดง=ยังไม่เริ่ม เขียว=พร้อม"
//   แปลเหมือนกันทั้งสองจอ — ของเดิมเป็นเฉดของตัวเองที่ใกล้กันแต่ไม่เท่ากัน และเฉด
//   อำพัน #e7a335 บนพื้นขาวมี contrast แค่ 2.17 (ต่ำกว่าเกณฑ์ตัวหนังสือใหญ่ด้วยซ้ำ)
const kitchenLanes = (t: Translate) => [
  { status: "NEW", label: t("pos_restaurant.lane_new"), color: "var(--red)", next: "PREPARING", nextLabel: t("pos_restaurant.lane_next_preparing") },
  { status: "PREPARING", label: t("pos_restaurant.lane_preparing"), color: "var(--amber)", next: "READY", nextLabel: t("pos_restaurant.lane_next_ready") },
  { status: "READY", label: t("pos_restaurant.lane_ready"), color: "var(--green)", next: "SERVED", nextLabel: t("pos_restaurant.lane_next_served") },
  { status: "SERVED", label: t("pos_restaurant.lane_served"), color: "var(--grey)", next: null, nextLabel: null },
] as const;
const timeOf = (iso: string | null, locale: string) => {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
};
/**
 * สถานะโต๊ะหนึ่งชุด ใช้ทั้งการ์ดบนผังและรายการบิลที่เปิดอยู่
 * `rank` = ลำดับที่ต้องไปก่อน (0 = ด่วนสุด) — ของที่ยังไม่ถึงครัวมาก่อนเสมอ
 * ตามด้วยของที่ครัวทำเสร็จแล้วรอคนยกไปเสิร์ฟ (ยิ่งช้ายิ่งเย็น)
 */
type TableStateKey = "unsent" | "ready" | "cooking" | "served" | "idle";
function tableState(
  table: DiningTable,
  kitchen: Map<string, { cooking: number; ready: number }>,
  t: Translate
): { key: TableStateKey; label: string; rank: number; color: string } {
  const check = table.check;
  const stats = check ? kitchen.get(check.id) : undefined;
  if (!check) return { key: "idle", label: "", rank: 99, color: "var(--grey)" };
  if (check.unsentCount > 0) return { key: "unsent", label: t("pos_restaurant.table_unsent", { count: check.unsentCount }), rank: 0, color: "var(--red)" };
  if ((stats?.ready ?? 0) > 0) return { key: "ready", label: t("pos_restaurant.table_ready", { count: stats!.ready }), rank: 1, color: "var(--green)" };
  if ((stats?.cooking ?? 0) > 0) return { key: "cooking", label: t("pos_restaurant.table_cooking", { count: stats!.cooking }), rank: 2, color: "var(--amber)" };
  if (check.itemCount > 0) return { key: "served", label: t("pos_restaurant.table_served"), rank: 3, color: "var(--green)" };
  return { key: "idle", label: t("pos_restaurant.table_no_order"), rank: 4, color: "var(--grey)" };
}
const money = (value: number) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

/**
 * สถานะของอาหารจานนั้นบนแผงบิล — อ่านจากตั๋วครัวของบรรทัดเดียวกัน
 *
 * ก่อนหน้านี้แผงบิลเงียบเรื่องนี้ทั้งหมด: ป้ายบนชิปโต๊ะบอกภาพรวม ("เสิร์ฟครบ") แต่รายบรรทัด
 * ไม่บอกอะไร เด็กเสิร์ฟจึงตอบไม่ได้ว่าจานไหนยังอยู่ในครัว ต้องสลับไปจอครัวแล้วจับคู่ด้วย
 * ชื่อโต๊ะเอง
 *
 * **คำต้องตรงกับ LANES ของจอครัว** — สองจอเรียกสถานะเดียวกันคนละชื่อคือทางที่ทำให้คนคุยกัน
 * ไม่รู้เรื่องหน้าเคาน์เตอร์
 *
 * `loud` = ตัวที่เรียกร้องให้คนถือจอนี้ลุกไปทำอะไร มีแค่ "พร้อมเสิร์ฟ" ตัวเดียว — "เสิร์ฟแล้ว"
 * คืองานที่จบแล้ว ต้องจางลง ไม่ใช่เด่นขึ้น
 */
const lineKitchenStates = (t: Translate): Record<string, { label: string; color: string; loud?: boolean }> => ({
  NEW: { label: t("pos_restaurant.line_new"), color: "var(--ink-3)" },
  PREPARING: { label: t("pos_restaurant.line_preparing"), color: "var(--amber)" },
  READY: { label: t("pos_restaurant.line_ready"), color: "var(--green)", loud: true },
  SERVED: { label: t("pos_restaurant.line_served"), color: "var(--ink-3)" },
});

export default function RestaurantPosPage() {
  const { lang, t } = useI18n();
  const uiLocale = lang === "en" ? "en-US" : "th-TH";
  // ชื่อเดิมทั้งสามตัวถูกสร้างต่อ render เพื่อให้จุดใช้งานที่เหลือไม่ต้องเปลี่ยน
  const LANES = useMemo(() => kitchenLanes(t), [t]);
  const LINE_KITCHEN_STATE = useMemo(() => lineKitchenStates(t), [t]);
  const QUEUE_STATUS_LABEL = useMemo(() => queueStatusLabels(t), [t]);
  const MENU_SOLD_OUT_REASONS = useMemo(() => menuSoldOutReasons(t), [t]);
  const KITCHEN_NOTE_SHORTCUTS = useMemo(() => kitchenNoteShortcuts(t), [t]);
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [floor, setFloor] = useState<Floor>({ areas: [], tables: [] });
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  // ตัวนับเวลาบนใบต้องเดินเอง ไม่ใช่ขยับตอน poll — ครัวมองจออยู่ตลอดและ 5 วินาทีของ
  // poll ทำให้ตัวเลขกระตุก · เก็บเป็น "เวลาที่จอเชื่อ" ก้อนเดียวเพื่อให้ทุกใบนับตรงกัน
  const [boardNow, setBoardNow] = useState(() => Date.now());
  // เก็บ "คีย์" ของสถานี ไม่ใช่ชื่อ (9.54) — ชื่อสถานีเปลี่ยนได้แล้ว ถ้าผูกตัวกรองไว้กับชื่อ
  // การแก้ชื่อระหว่างกะจะทำให้จอครัวที่กรองอยู่กลายเป็นจอว่างโดยไม่มีใครกดอะไร
  const [stationFilter, setStationFilter] = useState<string | null>(null);
  const [stationList, setStationList] = useState<Array<{ id: string; name: string; sortOrder: number }>>([]);
  const [groupMenu, setGroupMenu] = useState<KitchenBoardGroup | null>(null);
  const [stationSlas, setStationSlas] = useState<Record<string, KitchenSla>>({});
  // เสียงเตือนของ "เครื่องนี้" — ตัวตั้งค่าอยู่ที่ useOrderAlerts (localStorage ต่ออุปกรณ์)
  //
  // ⚠️ ต่างจาก 9.53 สองข้อ: ค่าเริ่มต้นคือ **เปิด** (เดิมปิด ทำให้แท็บเล็ตเครื่องใหม่ทุกเครื่อง
  // เงียบสนิทโดยไม่มีอะไรบอก) และเสียงที่ถูกเบราว์เซอร์บล็อกจะ **ขึ้นแถบเตือนบนจอ** แทนที่จะ
  // เงียบไปเฉย ๆ · ร้านที่เคยกดปิดไว้ยังถูกเคารพผ่านคีย์เดิม
  const alerts = useOrderAlerts();
  const [alertSettingsOpen, setAlertSettingsOpen] = useState(false);
  const knownTicketIds = useRef<Set<string> | null>(null);
  const knownReadyTicketIds = useRef<Set<string> | null>(null);
  const knownQrSubmissionIds = useRef<Set<string> | null>(null);
  const knownServiceCallIds = useRef<Set<string> | null>(null);
  // นาฬิกาย้ำเสียงของแต่ละกอง — เก็บใน ref เพราะมันเปลี่ยนทุกรอบ poll และไม่มีอะไรบนจอ
  // ที่ต้องวาดใหม่ตามมัน (state จะทำให้จอครัวรีเรนเดอร์เปล่า ๆ ทุก 5 วินาที)
  const ticketRepeatRef = useRef<AlertRepeatState>(IDLE_ALERT_REPEAT);
  const qrRepeatRef = useRef<AlertRepeatState>(IDLE_ALERT_REPEAT);
  const knownLateTicketIds = useRef<Set<string> | null>(null);
  const [activeArea, setActiveArea] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [check, setCheck] = useState<RestaurantCheck | null>(null);
  // ORDER = จอสั่งอาหาร (กริดเมนูเต็มพื้นที่) · FLOOR = ผังโต๊ะ · KITCHEN = จอครัว
  // กดโต๊ะแล้วเด้งเข้า ORDER เสมอ เพราะงานถัดไปของคนกดคือ "สั่งอาหาร" ไม่ใช่ดูผังต่อ
  const [screen, setScreen] = useState<RestaurantScreen>("ORDER");
  // ต้องอ่านค่าที่จำไว้ให้เสร็จก่อน effect ที่เขียนทับจะเริ่มทำงาน — สลับลำดับกันแล้วค่า
  // เริ่มต้น ("ORDER" / ไม่มีบิล) จะทับของที่จำไว้ตั้งแต่ก่อนที่ใครจะได้อ่านมัน
  // (กับดักเดียวกับ localDraftRestoredRef ของหน้าค้าปลีก)
  const localViewRestoredRef = useRef(false);
  // เป็น state ไม่ใช่ ref เพราะ effect ที่เขียนต้องรอ "คืนค่าเสร็จ" ไม่ใช่ "เริ่มคืนค่า" —
  // การคืนบิลเป็น async ถ้าไม่รอ effect ที่ลบบิลจะวิ่งไปก่อนแล้วลบค่าที่ยังไม่ได้อ่าน
  const [viewRestored, setViewRestored] = useState(false);
  const [actorUserId, setActorUserId] = useState("");
  const [actorPin, setActorPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [qrSubmissions, setQrSubmissions] = useState<QrSubmission[]>([]);
  const [serviceCalls, setServiceCalls] = useState<ServiceCall[]>([]);
  const [qrSelectedId, setQrSelectedId] = useState("");
  const [qrRejectOpen, setQrRejectOpen] = useState(false);
  const [qrRejectReason, setQrRejectReason] = useState("");
  const [menuCategory, setMenuCategory] = useState("");
  // โหมดแจ้งของหมด: ครัวเดินมาบอกทีเดียวหลายอย่าง — เปิดโหมดแล้วทุกการ์ดกลายเป็นสวิตช์
  // ปิดโหมดแล้วการ์ดกลับมาเป็นปุ่มสั่งอาหารล้วน ไม่มีปุ่มปิดขายค้างอยู่ใต้ทุกเมนูตลอดกะ
  const [menuManage, setMenuManage] = useState(false);
  const [menuOnlySoldOut, setMenuOnlySoldOut] = useState(false);
  const [soldOutSheet, setSoldOutSheet] = useState<MenuItem | null>(null);
  const [menuHit, setMenuHit] = useState<ScanHit | null>(null);
  /** การ์ดที่ถูกแตะ — `ScanHit` รู้จักไซซ์เดียว รายการไซซ์ทั้งหมดอยู่ที่การ์ดเท่านั้น */
  const [menuSource, setMenuSource] = useState<MenuItem | SearchItem | null>(null);
  const [modifierCodes, setModifierCodes] = useState<string[]>([]);
  const [kitchenNote, setKitchenNote] = useState("");
  const [menuQty, setMenuQty] = useState(1);
  const [openTable, setOpenTable] = useState<DiningTable | null>(null);
  // โต๊ะที่แยกบิลแล้วมีบิลเปิดอยู่หลายใบ — แตะโต๊ะต้องถามก่อนว่าจะเปิดใบไหน
  const [billPickerTable, setBillPickerTable] = useState<DiningTable | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistBoard>({ entries: [], waitingCount: 0, calledCount: 0, waitingGuests: 0 });
  const [queueFormOpen, setQueueFormOpen] = useState<"WALK_IN" | "RESERVATION" | null>(null);
  const [queueParty, setQueueParty] = useState(2);
  const [queueName, setQueueName] = useState("");
  const [queuePhone, setQueuePhone] = useState("");
  const [queueNote, setQueueNote] = useState("");
  const [queueReservedFor, setQueueReservedFor] = useState("");
  const [seatEntry, setSeatEntry] = useState<WaitlistEntry | null>(null);
  const [seatTableId, setSeatTableId] = useState("");
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitItemIds, setSplitItemIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [shiftModal, setShiftModal] = useState<"OPEN" | "CLOSE" | null>(null);
  const [cashAmount, setCashAmount] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState<PosPaymentDraft[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<PosMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<PosMember | null>(null);
  const [memberLoyalty, setMemberLoyalty] = useState<PosLoyaltyStatus | null>(null);
  const [settlementReceipt, setSettlementReceipt] = useState<SettlementReceipt | null>(null);
  const [recentReceipts, setRecentReceipts] = useState<RecentReceipt[]>([]);
  const [recentQuery, setRecentQuery] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptSelection | null>(null);
  const [cashMoveDirection, setCashMoveDirection] = useState<"IN" | "OUT">("IN");
  const [cashMoveAmount, setCashMoveAmount] = useState("");
  const [cashMoveReason, setCashMoveReason] = useState("");
  const [cashMoveApproverId, setCashMoveApproverId] = useState("");
  const [cashMoveApproverPin, setCashMoveApproverPin] = useState("");
  const [cashMoveExternalConfirmed, setCashMoveExternalConfirmed] = useState(false);
  const [noSaleReason, setNoSaleReason] = useState("");
  const [shiftReport, setShiftReport] = useState<ShiftReport | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetTableId, setTargetTableId] = useState("");
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportDescription, setSupportDescription] = useState("");
  const [supportConfirmed, setSupportConfirmed] = useState(false);
  const [supportWorking, setSupportWorking] = useState<"export" | "send" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelApproverId, setCancelApproverId] = useState("");
  const [cancelApproverPin, setCancelApproverPin] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestEdit, setGuestEdit] = useState("2");
  const [moreOpen, setMoreOpen] = useState(false);
  // Modal ของ antd portal ไป document.body โดยดีฟอลต์ ซึ่งอยู่นอก .page —
  // ตัวแปรสี/เส้นขอบทั้งหมด (--line, --panel, --ink, ...) ถูกประกาศไว้ที่ .page
  // เท่านั้น พอ modal portal ออกไปนอก scope นั้น border/background ของ input ในฟอร์ม
  // จะ resolve ไม่ได้แล้วหายไปเงียบ ๆ (เห็นแค่ตัวเลขลอยไม่มีกรอบ) — ต้องส่ง getContainer
  // ให้ modal render อยู่ใต้ .page แทนเพื่อให้ยังเห็นตัวแปรพวกนี้
  const rootRef = useRef<HTMLElement>(null);
  const workingRef = useRef(false);
  const displayChannel = useRef<BroadcastChannel | null>(null);
  const displayPayloadRef = useRef<CustomerDisplayPayload | null>(null);
  const memberCheckIdRef = useRef<string | null>(null);
  const cashMovementRequestRef = useRef<{ signature: string; key: string } | null>(null);
  // Member selection belongs to one check only. This synchronous guard prevents even one render
  // of a newly selected table from inheriting the previous table's customer before the cleanup
  // effect below runs.
  const checkMember = memberCheckIdRef.current === (check?.id ?? null) ? selectedMember : null;
  // ⚠️ ต้องเป็น reference เดิมทุก render — ถ้าสร้าง closure ใหม่ทุกครั้ง antd จะเห็นว่า
  // container เปลี่ยน แล้ว portal ใหม่ซ้ำ ๆ จน animation ค้างที่ `ant-zoom-appear-start`
  // (opacity 0) = กล่องอยู่ใน DOM ตำแหน่งถูก แต่มองไม่เห็นทั้งใบ
  const modalContainer = useCallback(() => rootRef.current ?? document.body, []);

  useEffect(() => { setToken(window.localStorage.getItem(TOKEN_KEY) ?? ""); setReady(true); }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("bms-pos-display");
    displayChannel.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === "hello" && displayPayloadRef.current) {
        channel.postMessage(displayPayloadRef.current);
      }
    };
    return () => { channel.close(); displayChannel.current = null; };
  }, []);
  useEffect(() => {
    if (!check) {
      if (settlementReceipt) return;
      const empty: CustomerDisplayPayload = {
        lines: [], itemCount: 0, total: 0, discountTotal: 0, amountDue: 0,
        memberName: null, pointsEarned: null, finished: null,
      };
      displayPayloadRef.current = empty;
      displayChannel.current?.postMessage(empty);
      return;
    }
    const sentItems = check.items.filter((item) => item.status === "SENT" && item.lineAmount != null);
    let itemCount = 0;
    for (const item of sentItems) itemCount += item.packQty;
    const payload: CustomerDisplayPayload = {
      lines: sentItems.map((item) => ({
        name: item.productName, size: item.size && item.size !== "-" ? item.size : null,
        qty: item.packQty, unitName: item.unitName ?? "", amount: item.lineAmount!,
      })),
      itemCount,
      total: check.amountDue,
      discountTotal: 0,
      amountDue: check.amountDue,
      memberName: checkMember?.name ?? null,
      pointsEarned: null,
      finished: null,
    };
    displayPayloadRef.current = payload;
    displayChannel.current?.postMessage(payload);
  }, [check, checkMember, settlementReceipt]);
  useEffect(() => {
    if (!settlementReceipt) return;
    const payload: CustomerDisplayPayload = {
      lines: [], itemCount: 0, total: settlementReceipt.result.total, discountTotal: 0,
      amountDue: settlementReceipt.result.total,
      memberName: settlementReceipt.member?.name ?? null,
      pointsEarned: settlementReceipt.result.pointsEarned,
      finished: {
        total: settlementReceipt.result.total,
        tendered: settlementReceipt.result.cashTendered,
        change: settlementReceipt.result.cashChange,
      },
    };
    displayPayloadRef.current = payload;
    displayChannel.current?.postMessage(payload);
  }, [settlementReceipt]);
  useEffect(() => {
    const checkId = check?.id ?? null;
    if (memberCheckIdRef.current === checkId) return;
    memberCheckIdRef.current = checkId;
    setSelectedMember(null);
    setMemberQuery("");
    setMemberResults([]);
  }, [check?.id]);
  const staff = useMemo(() => { const map = new Map<string, Staff>(); for (const person of [...(session?.cashiers ?? []), ...(session?.approvers ?? []), ...(session?.kitchenOperators ?? [])]) map.set(person.id, person); return [...map.values()]; }, [session]);
  const visibleTables = activeArea ? floor.tables.filter((table) => table.areaId === activeArea) : floor.tables;
  // พิกัดเป็นข้อมูลผังจริงจากหลังบ้าน จึงต้องรักษาหน่วย px เดียวกับ editor และให้ viewport
  // เลื่อนเมื่อจอแคบ แทนการบีบ/เรียงใหม่จนโต๊ะไม่ตรงกับตำแหน่งที่ผู้ดูแลบันทึกไว้
  const floorCanvasWidth = visibleTables.reduce((width, table) => {
    const size = FLOOR_TABLE_SIZE[table.shape === "rect" ? "rect" : "round"];
    return Math.max(width, table.positionX + size.width + 24);
  }, 720);
  const floorCanvasHeight = visibleTables.reduce((height, table) => {
    const size = FLOOR_TABLE_SIZE[table.shape === "rect" ? "rect" : "round"];
    return Math.max(height, table.positionY + size.height + 24);
  }, 520);
  const availableTables = floor.tables.filter((table) => table.status === "AVAILABLE" && table.id !== selectedTableId);
  // บรรทัดที่ย้ายไปบิลใหม่ได้ = ทุกบรรทัดที่ยังถูกคิดเงินอยู่ · บรรทัดที่ครัวยกเลิกไปแล้ว
  // (status CANCELLED) หลุดจากยอดไปแล้วจึงไม่มีอะไรให้ย้าย
  const splittableItems = (check?.items ?? []).filter((item) => item.status !== "CANCELLED");
  // แยก/รวมบิลทำได้เฉพาะบิลที่ยังเปิดอยู่จริง · บิลที่กำลังรับชำระเงิน (CLOSING) service ปฏิเสธ
  const checkIsOpen = check?.status === "OPEN";
  // ปลายทางของการรวมบิล = บิลที่เปิดอยู่ใบอื่นทั้งสาขา รวมบิลใบอื่นของโต๊ะเดียวกันด้วย
  // (แยกไปแล้วแต่ลูกค้าเปลี่ยนใจขอจ่ายรวม เป็นเรื่องที่เกิดจริงพอ ๆ กับการขอแยก)
  const mergeTargets = floor.tables.flatMap((table) => table.checks
    // service รับเฉพาะบิลที่ยัง OPEN ทั้งสองใบ — บิลที่อีกเครื่องกดคิดเงินไปแล้ว (CLOSING)
    // ยังโผล่บนผังอยู่ ถ้ายื่นให้เลือกจะได้ error ที่จอรู้ล่วงหน้าได้เอง
    .filter((row) => row.id !== check?.id && row.status === "OPEN")
    .map((row) => ({
      id: row.id,
      label: t("pos_restaurant.check_option", { table: table.name, bill: row.splitGroupNo > 1 ? t("pos_restaurant.bill_suffix", { number: row.splitGroupNo }) : "", count: row.itemCount, amount: money(row.amountDue) }),
    })));
  // นาฬิกาเดินเองทุก 30 วิ เพื่อให้ "นั่งมากี่นาที" บนการ์ดโต๊ะไม่ค้าง โดยไม่ต้องยิง API
  // เริ่มที่ 0 แล้วตั้งค่าใน effect เพื่อไม่ให้ค่าที่ render ฝั่ง server ต่างจาก client
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const minutesSince = (iso: string) => { if (!now) return null; const started = new Date(iso).getTime(); return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60_000)) : null; };
  // สถานะครัวรายโต๊ะ: ผูกด้วย check id ซึ่งไม่ซ้ำ แม้หลายโซนจะใช้ชื่อโต๊ะเดียวกัน
  // เป็นข้อมูลสำหรับ "แสดงผล" เท่านั้น การตัดสินใจเรื่องเงิน/สต็อกยังอยู่ที่ server เหมือนเดิม
  const tableKitchenStats = useMemo(() => {
    const map = new Map<string, { cooking: number; ready: number }>();
    for (const ticket of tickets) {
      if (!ticket.checkId) continue;
      if (ticket.status !== "NEW" && ticket.status !== "PREPARING" && ticket.status !== "READY") continue;
      const row = map.get(ticket.checkId) ?? { cooking: 0, ready: 0 };
      if (ticket.status === "READY") row.ready += 1; else row.cooking += 1;
      map.set(ticket.checkId, row);
    }
    return map;
  }, [tickets]);
  const occupiedTables = floor.tables.filter((table) => table.status === "OCCUPIED");
  // ยอดรวมนี้เป็นการ "บวกตัวเลขที่ server ส่งมาแล้ว" เพื่อดูภาพรวมกะเท่านั้น
  // ไม่เคยถูกส่งกลับไปเป็นยอดชำระ — ยอดที่คิดเงินยังมาจาก check.amountDue ของ server เสมอ
  const openAmountTotal = occupiedTables.reduce((sum, table) => sum + (table.check?.amountDue ?? 0), 0);
  const unsentItemTotal = occupiedTables.reduce((sum, table) => sum + (table.check?.unsentCount ?? 0), 0);
  const unsentTableCount = occupiedTables.filter((table) => (table.check?.unsentCount ?? 0) > 0).length;
  const longestSeated = occupiedTables.reduce<{ minutes: number; code: string } | null>((longest, table) => {
    const minutes = table.check ? minutesSince(table.check.openedAt) : null;
    if (minutes == null) return longest;
    return longest && longest.minutes >= minutes ? longest : { minutes, code: table.code };
  }, null);
  const kitchenCooking = tickets.filter((ticket) => ticket.status === "NEW" || ticket.status === "PREPARING").length;
  const kitchenReady = tickets.filter((ticket) => ticket.status === "READY").length;
  // แผงขวาตอนยังไม่เลือกโต๊ะ = รายการบิลที่เปิดอยู่ เรียงตามโต๊ะที่ต้องไปก่อน
  // (เดิมเป็นภาพเปล่ากลางจอ ซึ่งกินพื้นที่มากที่สุดของหน้าโดยไม่บอกอะไรเลย)
  // หนึ่งแถวต่อ **บิล** ไม่ใช่ต่อโต๊ะ — โต๊ะที่แยกบิลไว้มีสองใบที่ต้องเก็บเงินคนละครั้ง
  // ถ้านับต่อโต๊ะ หัวข้อจะเขียนว่า "บิลที่เปิดอยู่ · 1" ขณะที่การ์ดข้าง ๆ เขียนว่า "2 บิล"
  // บนหน้าจอเดียวกัน และบิลใบที่สองจะกดเข้าจากแผงนี้ไม่ได้เลย
  const openChecks = useMemo(() => floor.tables
    .flatMap((table) => table.checks.map((row) => ({
      table,
      check: row,
      state: tableState({ ...table, check: row }, tableKitchenStats, t),
    })))
    .sort((a, b) => a.state.rank - b.state.rank
      || a.table.code.localeCompare(b.table.code)
      || a.check.splitGroupNo - b.check.splitGroupNo),
    [floor.tables, tableKitchenStats, t]);
  /** ป้ายของบิลหนึ่งใบ — ใบที่สองขึ้นไปต้องบอกเลขบิล ไม่งั้นสองแถวจะอ่านเหมือนกันทุกตัวอักษร */
  const openCheckLabel = (table: DiningTable, row: FloorCheck) =>
    `${table.name}${row.splitGroupNo > 1 ? t("pos_restaurant.bill_suffix", { number: row.splitGroupNo }) : ""}`;
  const unsentInCheck = check?.items.filter((item) => item.status === "NEW").length ?? 0;
  const pendingQrSubmissions = qrSubmissions.filter((submission) => submission.status === "PENDING");
  const pendingServiceCalls = serviceCalls.filter((call) => call.status === "PENDING");
  const selectedQrSubmission = qrSubmissions.find((submission) => submission.id === qrSelectedId)
    ?? pendingQrSubmissions[0] ?? qrSubmissions[0] ?? null;
  // ครัวยกเลิกตอนบิลไม่ได้เปิดอยู่ (กำลังคิดเงิน/ปิดแล้ว) → ตัดอัตโนมัติไม่ได้ ยังคิดเงินอยู่จริง
  const kitchenCancelled = check?.items.filter((item) =>
    item.status !== "CANCELLED" && item.kitchenStatus === "CANCELLED") ?? [];
  // จำนวนที่อยู่ในบิลแล้วต่อเมนู ไว้ขึ้นเป็น badge บนการ์ด — นับ "จำนวนของ" ไม่ใช่เงิน
  // (ยอดเงินยังมาจาก check.amountDue ของ server เท่านั้น) · ใช้ for ไม่ใช่ reduce
  // เพราะเทสห้ามรูปแบบ items.reduce( ทั้งไฟล์เพื่อกันการรวมยอดเองที่จอ
  const qtyInCheckBySku = useMemo(() => {
    // server ไม่ส่งรายการที่ถูกยกเลิกมาให้หน้านี้เลย (type เป็น NEW | SENT เท่านั้น)
    // จึงไม่ต้องกรองสถานะซ้ำที่จอ
    //
    // แต่ต้องข้ามบรรทัดที่ **ครัวยกเลิกตั๋วแล้ว** — badge บอกว่า "สั่งไปแล้วกี่ที่"
    // ถ้านับของที่ครัวไม่ได้ทำเข้าไปด้วย จอจะบอกว่าสั่งผัดไทยไปแล้ว 2 ที่ ทั้งที่ไม่มีจานไหน
    // กำลังมา แล้วคนกดจะไม่กดสั่งใหม่ให้ลูกค้า
    const counts = new Map<string, number>();
    for (const item of check?.items ?? []) {
      if (item.status === "CANCELLED" || item.kitchenStatus === "CANCELLED") continue;
      counts.set(item.sku, (counts.get(item.sku) ?? 0) + Number(item.packQty ?? 0));
    }
    return counts;
  }, [check]);
  // ไม่ใช้ items.reduce() โดยตั้งใจ — เทสห้ามรูปแบบนั้นทั้งหมดเพื่อกันการ "รวมยอดเอง"
  // ที่จอ (สูตรเงินชุดที่สอง) การเลี่ยงจึงดีกว่าการไปคลายกฎในเทส
  const lastRound = Math.max(0, ...(check?.items.map((item) => item.roundNo ?? 0) ?? [])) || null;
  const checkMinutes = check ? minutesSince(check.openedAt) : null;
  // จัดกลุ่มรายการตามรอบครัว: ของที่ยังไม่ส่งอยู่ท้ายสุดเสมอ เพราะนั่นคือสิ่งที่ต้องกดต่อ
  const itemGroups = useMemo(() => {
    if (!check) return [] as Array<{ key: string; label: string; chip: string; items: CheckItem[] }>;
    const rounds = new Map<number, CheckItem[]>();
    const unsent: CheckItem[] = [];
    for (const item of check.items) {
      if (item.status === "NEW") { unsent.push(item); continue; }
      const round = item.roundNo ?? 0;
      rounds.set(round, [...(rounds.get(round) ?? []), item]);
    }
    // `chip` = รูปย่อของ label สำหรับกลุ่มที่มีรายการเดียว — รอบละหนึ่งจานเป็นเรื่องปกติ
    // ของร้านอาหาร (ลูกค้าสั่งเพิ่มทีละอย่าง) หัวข้อเต็มบรรทัดต่อหนึ่งบรรทัดรายการทำให้
    // ครึ่งหนึ่งของแผงเป็นหัวข้อ · กลุ่มที่มีหลายรายการยังใช้หัวข้อเหมือนเดิม
    const groups = [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, items]) => ({
      key: `round-${round}`,
      label: t("pos_restaurant.round_sent", { round: round || 1, time: items[0]?.sentAt ? ` ${timeOf(items[0].sentAt, uiLocale)}` : "" }),
      chip: t("pos_restaurant.round_chip", { round: round || 1, time: items[0]?.sentAt ? ` · ${timeOf(items[0].sentAt, uiLocale)}` : "" }),
      items,
    }));
    if (unsent.length) groups.push({ key: "unsent", label: t("pos_restaurant.group_unsent"), chip: t("pos_restaurant.group_unsent"), items: unsent });
    return groups;
  }, [check, t, uiLocale]);
  const operatorReady = Boolean(actorUserId && actorPin);
  const operatorName = staff.find((person) => person.id === actorUserId)?.name ?? staff.find((person) => person.id === actorUserId)?.email ?? "";
  // เกณฑ์เดียวที่ใช้ทั้งคำเตือนและป้ายยอดเงิน: "มีบรรทัดที่ยังไม่ส่งครัวจริงไหม"
  // (เทียบ version กับ reservedVersion ตรง ๆ จะเตือนตั้งแต่บิลยังว่าง เพราะบิลใหม่มี
  // version = 0 แต่ reservedVersion = null) · ยอดที่แสดงยังเป็นตัวเลขจาก server เสมอ
  // ห้ามคำนวณเองที่จอ เพราะจะกลายเป็นสูตรเงินชุดที่สอง
  const hasUnsent = Boolean(check?.items.some((item) => item.status === "NEW"));
  // ใบจองสต็อกของโต๊ะหายไป (ถูกยกเลิกนอกเส้นทางนี้) — คิดเงินจะล้มแน่นอน แต่ส่งครัวจะ
  // จองใหม่ให้ทั้งบิล · ปุ่มที่ยังไงก็ล้มต้องกดไม่ได้ พร้อมบอกทางไปต่อ ไม่ใช่ปล่อยให้กด
  // แล้วเจอ error ต่อหน้าลูกค้า (เกณฑ์มาจาก server ที่เดียว ไม่ให้จอเดาเอง)
  const reservationLost = Boolean(check?.reservationLost);
  const paymentTotal = Math.round(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) * 100) / 100;
  const checkoutDue = check == null ? 0 : Math.round((check.amountDue + (
    payments.length === 1 && payments[0].method === "CASH"
      ? cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")
      : 0
  )) * 100) / 100;
  // เหตุผลเดียวที่ทั้งปุ่มยืนยัน แถบสรุป และ settle() ใช้ร่วมกัน — สามที่ตัดสินเองจะ drift
  // แล้ววันหนึ่งปุ่มกดได้แต่ settle ปฏิเสธ (หรือแย่กว่า: กดได้แล้ว server ปฏิเสธกลางบิล)
  const checkoutBlock = check == null ? null : checkoutBlockReason(payments, checkoutDue);
  /** เงินทอนของช่องทางเงินสดแถวนี้ — `null` = ยังไม่ได้กรอก/กรอกน้อยกว่ายอด (ไม่มีเงินทอนให้บอก) */
  const cashChangeOf = (payment: PosPaymentDraft) => {
    if (payment.method !== "CASH" || !payment.tendered.trim()) return null;
    const change = Number(payment.tendered) - Number(payment.amount);
    return Number.isFinite(change) && change >= 0 ? Math.round(change * 100) / 100 : null;
  };
  const supportScope = session?.device?.id ? `pos-${session.device.id}` : "";
  const cancelNeedsApproval = Boolean(check?.hasCurrentOrder
    || check?.items.some((item) => item.status === "SENT"));
  const voidApprovers = (session?.approvers ?? []).filter((person) =>
    person.hasPin && person.id !== actorUserId && person.approvals.includes("pos.void")
  );

  async function json(url: string, init?: RequestInit) {
    const startedAt = Date.now();
    const method = String(init?.method ?? "GET").toUpperCase();
    const response = await fetch(url, { ...init, headers: { "x-pos-device-token": token, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (method !== "GET" || !response.ok) {
      let requestedAction = method;
      try {
        const requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (typeof requestBody?.action === "string") requestedAction = requestBody.action.slice(0, 80);
      } catch {}
      recordSupportActivity(supportScope, {
        category: "pos.restaurant",
        action: `restaurant.api.${requestedAction.toLowerCase()}`,
        status: response.ok ? "success" : "error",
        locationId: session?.location?.id ?? null,
        deviceId: session?.device?.id ?? null,
        context: {
          route: url.split("?")[0],
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          online: navigator.onLine,
        },
      });
    }
    // เส้นทางส่งครัว/คิดเงินตอบเป็น "สถานะ" ไม่ใช่ข้อความ (INSUFFICIENT, PAYMENT_MISMATCH …)
    // เดิมจึงตกไปที่ `HTTP 409` ซึ่งพนักงานอ่านแล้วทำอะไรต่อไม่ได้ — แปลด้วยชุดคำตอบ
    // เดียวกับหน้าค้าปลีก เพราะสองหน้านี้เรียก service เดียวกัน
    // ไม่มีทั้ง status และ error = ตอบมาไม่ใช่ JSON ของ service (proxy ตอบ HTML ตอน 502
    // หรือเน็ตหลุด) → ต้องแปลเป็นคำที่บอกได้ว่าให้ทำอะไรต่อ ไม่ใช่โชว์ "HTTP 502" ดิบ ๆ
    if (!response.ok && typeof body?.status !== "string" && !body?.error && !body?.reason) {
      throw new Error(describeTransportFailure(response.status, navigator.onLine));
    }
    if (!response.ok) throw new Error(typeof body?.status === "string"
      ? describePosFailure(body)
      : String(body?.error ?? body?.reason ?? `HTTP ${response.status}`));
    return body;
  }
  function auth(extra: Record<string, unknown> = {}) { if (!actorUserId || !actorPin) throw new Error(t("pos_restaurant.need_operator_pin")); return { ...extra, cashierUserId: actorUserId, cashierPin: actorPin }; }
  async function run(work: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try { await work(); setError(""); }
    catch (cause) { const text = cause instanceof Error ? cause.message : String(cause); setError(text); message.error(text); }
    finally { workingRef.current = false; setWorking(false); }
  }
  async function loadSession() { const data: Session = await json("/api/pos/session"); if (data.businessArchetype !== "restaurant") { window.location.replace("/pos?surface=retail"); return null; } setSession(data); setActorUserId((current) => current || data.cashiers.find((p) => p.hasPin)?.id || data.kitchenOperators.find((p) => p.hasPin)?.id || ""); return data; }
  async function loadFloor(signal?: AbortSignal) { const data: Floor = await json("/api/pos/restaurant/floor", { signal }); setFloor(data); setActiveArea((current) => current && data.areas.some((area) => area.id === current) ? current : data.areas[0]?.id ?? ""); return data; }
  async function loadWaitlist(signal?: AbortSignal) { setWaitlist(await json("/api/pos/restaurant/waitlist", { signal })); }
  /** ทุก action ของคิวคืนกระดานใหม่ให้เสมอ เพื่อไม่ให้จอถือสถานะที่ server ปฏิเสธไปแล้ว */
  async function waitlistAction(action: string, extra: Record<string, unknown> = {}) {
    await run(async () => {
      await json("/api/pos/restaurant/waitlist", {
        method: "POST", body: JSON.stringify(auth({ action, ...extra })),
      });
      await loadWaitlist();
    });
  }
  async function addWaitlistEntry() {
    const kind = queueFormOpen;
    if (!kind) return;
    await run(async () => {
      const body = await json("/api/pos/restaurant/waitlist", {
        method: "POST",
        body: JSON.stringify(auth({
          action: "add", kind, partySize: queueParty,
          guestName: queueName.trim() || null, guestPhone: queuePhone.trim() || null,
          note: queueNote.trim() || null,
          reservedFor: kind === "RESERVATION" && queueReservedFor
            ? new Date(queueReservedFor).toISOString()
            : null,
        })),
      });
      setQueueFormOpen(null);
      setQueueName(""); setQueuePhone(""); setQueueNote(""); setQueueReservedFor("");
      await loadWaitlist();
      message.success(body.entry?.queueNo
        ? t("pos_restaurant.toast_queue_added", { number: body.entry.queueNo })
        : t("pos_restaurant.toast_reservation_saved"));
    });
  }
  /**
   * พาไปนั่ง — server เปิดบิลให้ในทรานแซกชันเดียวกับการปิดคิว จอจึงกระโดดไปที่บิลนั้นได้เลย
   * (ขั้นตอนถัดไปของคนที่เพิ่งพาลูกค้าไปนั่งคือรับออร์เดอร์ ไม่ใช่กลับมาดูกระดานคิว)
   */
  async function seatWaitlistEntry() {
    if (!seatEntry || !seatTableId) return;
    await run(async () => {
      const body = await json("/api/pos/restaurant/waitlist", {
        method: "POST",
        body: JSON.stringify(auth({ action: "seat", entryId: seatEntry.id, tableId: seatTableId })),
      });
      setSeatEntry(null); setSeatTableId("");
      if (body.check) { setCheck(body.check); setSelectedTableId(body.check.tableId); setScreen("ORDER"); }
      await Promise.all([loadFloor(), loadWaitlist()]);
      message.success(t("pos_restaurant.toast_seated"));
    });
  }
  // ⚠️ ปุ่มกรองสถานีต้องนับ **ประชากรเดียวกับที่กระดานแสดง** ไม่ใช่เฉพาะงานที่ยังไม่จบ
  //
  // เดิมปุ่มนับเฉพาะ NEW/PREPARING/READY แต่กระดานมีเลน "เสิร์ฟแล้ว" (ประวัติ 12 ชม.) อยู่ด้วย
  // ผลคือ **จอเดียวกันขัดกันเอง**: ปุ่มเขียน "ทั้งหมด 2" ขณะที่เลนบวกกันได้ 7 (เจอจริงบน
  // production) · ปุ่มพวกนี้คือ "ตัวกรอง" เลขข้างปุ่มจึงต้องบอกว่ากดแล้วจะเห็นอะไร
  // ไม่ใช่ตอบคำถามคนละข้อกับที่จอแสดงอยู่ · `/admin/kitchen` นับจากทุกแถวมาตลอด — สองกระดาน
  // ที่ใช้โมดูลเดียวกันตอบไม่ตรงกันเองคือทางที่ทำให้คนเลิกเชื่อตัวเลขทั้งจอ
  //
  // สัญญาณ "งานค้างเท่าไร" ยังมีที่ของตัวเองอยู่แล้ว: badge ข้างเมนู ครัว และแถบสรุปหน้าผังโต๊ะ
  // (`kitchenCooking` / `kitchenReady`) ซึ่งนับเฉพาะที่ยังไม่จบตามเดิม
  const stationFilterKey = (filter: KitchenStationFilter) => filter.id ?? `name:${filter.name}`;
  // ปุ่มกรอง = ทะเบียนสถานีของสาขานี้ + สถานีที่โผล่บนตั๋วจริง (รวมสถานีที่เพิ่งถูกปิด
  // แต่ยังมีของค้างในครัว) · ครัวที่ว่างยังมีปุ่มของตัวเองพร้อมเลข 0 ไม่ใช่หายไปเฉย ๆ
  const stationFilters = useMemo(
    () => kitchenBoardStationFilters(tickets, stationList),
    [tickets, stationList]
  );
  const selectedStation = stationFilters.find((filter) => stationFilterKey(filter) === stationFilter) ?? null;
  const kitchenGroups = useMemo(
    () => groupKitchenTickets(
      stationFilter === null ? tickets
        : stationFilter === "UNASSIGNED" ? tickets.filter((row) => !row.stationId && !row.station)
        : tickets.filter((row) => ticketMatchesStation(row, selectedStation))
    ),
    [tickets, stationFilter, selectedStation]
  );
  const unassignedOpen = tickets.filter((row) => !row.stationId && !row.station);
  useEffect(() => {
    if (screen !== "KITCHEN") return;
    const timer = window.setInterval(() => setBoardNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [screen]);
  // สถานีที่เลือกไว้หมดงานแล้ว = ตัวกรองค้างอยู่กับช่องว่าง แล้วครัวอ่านว่าไม่มีออร์เดอร์
  useEffect(() => {
    if (!stationFilter) return;
    const stillThere = stationFilter === "UNASSIGNED"
      ? unassignedOpen.length > 0
      : stationFilters.some((filter) => stationFilterKey(filter) === stationFilter);
    if (!stillThere) setStationFilter(null);
  }, [stationFilters, unassignedOpen.length, stationFilter]);

  async function loadTickets(signal?: AbortSignal) {
    const data = await json("/api/pos/kitchen/tickets?limit=200", { signal });
    const rows: KitchenTicket[] = Array.isArray(data.tickets) ? data.tickets : [];
    setStationSlas(data.stationSlas && typeof data.stationSlas === "object" ? data.stationSlas : {});
    setStationList(Array.isArray(data.stations) ? data.stations : []);
    // ตั๋วที่ "เพิ่งเข้ามา" เทียบกับรอบก่อน ไม่ใช่ทุกใบที่สถานะ NEW — ไม่งั้นจะดังทุก 5 วินาที
    // ตราบใดที่ยังมีงานค้าง · รอบแรกหลังเปิดจอถือเป็นการตั้งต้น ไม่ใช่ของใหม่ (newAlertIds)
    const open = rows.filter((row) => row.status === "NEW");
    const openIds = open.map((row) => row.id);
    if (newAlertIds(knownTicketIds.current, openIds).length > 0) alerts.notify("ORDER_NEW");
    knownTicketIds.current = new Set(openIds);
    // "อาหารพร้อมเสิร์ฟ" เป็นสัญญาณของ *คนเสิร์ฟ* ไม่ใช่ของครัว — คนละเสียงโดยตั้งใจ
    // เพราะสองเหตุการณ์นี้เรียกคนละคนให้ทำคนละอย่าง
    const readyIds = rows.filter((row) => row.status === "READY").map((row) => row.id);
    if (newAlertIds(knownReadyTicketIds.current, readyIds).length > 0) alerts.notify("FOOD_READY");
    knownReadyTicketIds.current = new Set(readyIds);
    // ย้ำจนกว่าครัวจะกด "เริ่มทำ" — ตั๋วที่ถูกกดแล้วออกจากกอง NEW เอง นาฬิกาจึงหยุดเองด้วย
    const repeat = evaluateAlertRepeat(ticketRepeatRef.current, {
      pending: openIds.length > 0,
      now: Date.now(),
      repeatSeconds: alerts.settings.repeatSeconds,
      maxRepeats: alerts.settings.maxRepeats,
    });
    ticketRepeatRef.current = repeat.state;
    if (repeat.play) alerts.notify("ORDER_NEW");
    setTickets(rows);
  }
  // เมนูทั้งร้านโหลดครั้งเดียวไว้เรนเดอร์เป็นกริด — ไม่ต้องพิมพ์ค้นหาก่อนถึงจะเห็นเมนู
  // ต่างจาก /api/pos/search ที่ต้องมี query ก่อนถึงจะคืนอะไรมา
  async function loadMenu() { const data = await json("/api/pos/restaurant/menu"); setMenuItems(Array.isArray(data.items) ? data.items : []); }
  async function loadQrSubmissions(signal?: AbortSignal) {
    const data = await json("/api/pos/restaurant/qr-orders", { signal });
    const rows: QrSubmission[] = Array.isArray(data.submissions) ? data.submissions : [];
    // ลูกค้าที่โต๊ะกดสั่งแล้วรออยู่ — เดิมมีแต่ป้ายตัวเลข ซึ่งไม่มีใครเห็นถ้ากำลังก้มดูโต๊ะอื่น
    const pendingIds = rows.filter((row) => row.status === "PENDING").map((row) => row.id);
    if (newAlertIds(knownQrSubmissionIds.current, pendingIds).length > 0) alerts.notify("QR_PENDING");
    knownQrSubmissionIds.current = new Set(pendingIds);
    const repeat = evaluateAlertRepeat(qrRepeatRef.current, {
      pending: pendingIds.length > 0,
      now: Date.now(),
      repeatSeconds: alerts.settings.repeatSeconds,
      maxRepeats: alerts.settings.maxRepeats,
    });
    qrRepeatRef.current = repeat.state;
    if (repeat.play) alerts.notify("QR_PENDING");
    setQrSubmissions(rows);
    setQrSelectedId((current) => current && rows.some((row) => row.id === current)
      ? current
      : rows.find((row) => row.status === "PENDING")?.id ?? rows[0]?.id ?? "");
    return rows;
  }
  async function loadServiceCalls(signal?: AbortSignal) {
    const data = await json("/api/pos/restaurant/service-calls", { signal });
    const rows: ServiceCall[] = Array.isArray(data.calls) ? data.calls : [];
    const pendingIds = rows.filter((row) => row.status === "PENDING").map((row) => row.id);
    if (newAlertIds(knownServiceCallIds.current, pendingIds).length > 0) alerts.notify("QR_PENDING");
    knownServiceCallIds.current = new Set(pendingIds);
    setServiceCalls(rows);
    return rows;
  }
  async function setMenuAvailability(item: MenuItem, unavailable: boolean, reason?: string | null) {
    await run(async () => {
      const result = await json("/api/pos/restaurant/menu", {
        method: "POST",
        body: JSON.stringify(auth({
          productSku: item.sku,
          unavailable,
          reason: unavailable ? reason ?? null : null,
        })),
      });
      await loadMenu();
      // บอกเวลาที่จะกลับมาขายเองด้วยเสมอ — ไม่งั้นคนกดต้องจำกฎรีเซ็ตวันบริการของร้านเอง
      const back = typeof result?.resetsAt === "string" ? timeOf(result.resetsAt, uiLocale) : "";
      message.success(unavailable
        ? t("pos_restaurant.toast_menu_closed", { name: item.name, back: back ? t("pos_restaurant.reopens_at_suffix", { time: back }) : "" })
        : t("pos_restaurant.toast_menu_reopened", { name: item.name }));
    });
  }
  function toggleMenuAvailability(item: MenuItem) {
    return setMenuAvailability(item, item.availability !== "SOLD_OUT_TODAY", t("pos_restaurant.reported_by_kitchen"));
  }
  async function loadCheck(id: string) { const data = await json(`/api/pos/restaurant/checks/${id}`); setCheck(data.check); return data.check as RestaurantCheck; }
  async function refresh() { if (!token) return; setLoading(true); try { if (!(await loadSession())) return; await Promise.all([loadFloor(), loadTickets(), loadMenu(), loadQrSubmissions(), loadServiceCalls(), loadWaitlist()]); if (check?.id) await loadCheck(check.id).then((row) => { if (!isOpenCheckStatus(row?.status)) setCheck(null); }).catch(() => setCheck(null)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); } }
  useEffect(() => { if (token) void refresh(); else if (ready) setLoading(false); }, [token, ready]);
  /**
   * คืนจอ/โต๊ะที่ค้างไว้ — ครั้งเดียวหลังรู้ token ไม่ใช่ทุกครั้งที่ไม่มีบิล
   *
   * ทำไมต้องคืนจอ: interval 5 วินาทีของจอครัวอยู่ใต้เงื่อนไข screen === "KITCHEN"
   * และเสียงเตือนตั๋วใหม่ถูกเรียกจาก loadTickets ของ interval นั้น — แท็บเล็ตติดผนัง
   * ที่หลับแล้วตื่นมารีโหลด (หรือถูกเบราว์เซอร์ดีดจาก memory) จะเด้งกลับจอสั่งอาหาร
   * แล้ว **หยุดดึงตั๋วและหยุดส่งเสียงทั้งกะ** โดยไม่มีอะไรบนจอบอก · บัญชี pos_only
   * เปิด /admin/kitchen แทนไม่ได้ ครัวจึงไม่มีทางหนีไปหน้าอื่น
   */
  useEffect(() => {
    if (!token || localViewRestoredRef.current) return;
    localViewRestoredRef.current = true;
    let fromUrl: RestaurantScreen | undefined;
    try {
      const asked = new URLSearchParams(window.location.search).get("screen");
      fromUrl = asked ? SCREEN_FROM_URL[asked.trim().toLowerCase()] : undefined;
    } catch { /* URL แปลก ๆ ไม่ควรทำให้เปิดจอไม่ได้ */ }
    let savedScreen: string | null = null;
    let savedCheckRaw: string | null = null;
    try {
      savedScreen = window.localStorage.getItem(LOCAL_SCREEN_KEY_PREFIX + token);
      savedCheckRaw = window.localStorage.getItem(LOCAL_CHECK_KEY_PREFIX + token);
    } catch { /* โหมดส่วนตัว */ }
    // ลิงก์ที่ปักหมุดไว้ชนะค่าที่จำไว้ — แต่ชนะแค่ "จอไหน" ไม่ใช่ข้ามการคืนบิลที่ทำอยู่
    if (fromUrl) setScreen(fromUrl);
    else if (savedScreen && (RESTAURANT_SCREENS as string[]).includes(savedScreen)) {
      setScreen(savedScreen as RestaurantScreen);
    }
    if (!savedCheckRaw) { setViewRestored(true); return; }
    try {
      const saved = JSON.parse(savedCheckRaw) as { id?: unknown; savedAt?: unknown };
      const id = typeof saved.id === "string" ? saved.id : "";
      const savedAt = Number(saved.savedAt ?? 0);
      if (!id || !(savedAt > 0) || Date.now() - savedAt > LOCAL_CHECK_MAX_AGE_MS) {
        window.localStorage.removeItem(LOCAL_CHECK_KEY_PREFIX + token);
        setViewRestored(true);
        return;
      }
      // ยืนยันกับ server ทุกครั้ง — บิลอาจถูกเก็บเงิน/ยกเลิก/ย้ายโต๊ะที่เครื่องอื่นไปแล้ว
      void loadCheck(id)
        .then((restored) => {
          if (restored && isOpenCheckStatus(restored.status)) setSelectedTableId(restored.tableId);
          else setCheck(null);
        })
        .catch(() => setCheck(null))
        .finally(() => setViewRestored(true));
    } catch { setViewRestored(true); /* ค่าที่จำไว้พัง = เริ่มใหม่ ไม่ใช่ทำให้เปิดจอไม่ได้ */ }
  }, [token]);
  useEffect(() => {
    if (!token || !viewRestored) return;
    try { window.localStorage.setItem(LOCAL_SCREEN_KEY_PREFIX + token, screen); } catch { /* โหมดส่วนตัว */ }
  }, [screen, token, viewRestored]);
  // จำบิลที่กำลังทำอยู่ — เก็บแค่ id กับเวลา ไม่เก็บรายการ/ยอดเงิน (ยอดต้องมาจาก server
  // เสมอ · เวลาอัปเดตทุกครั้งที่บิลถูกโหลดใหม่ จึงเป็น "นับจากการแตะครั้งล่าสุด")
  useEffect(() => {
    if (!token || !viewRestored) return;
    const key = LOCAL_CHECK_KEY_PREFIX + token;
    try {
      if (check && isOpenCheckStatus(check.status)) {
        window.localStorage.setItem(key, JSON.stringify({ id: check.id, savedAt: Date.now() }));
      } else {
        window.localStorage.removeItem(key);
      }
    } catch { /* โหมดส่วนตัว */ }
    // viewRestored อยู่ใน deps ด้วย ไม่ใช่แค่ในเงื่อนไข — บิลที่คืนไม่สำเร็จ (ถูกเก็บเงิน/
    // ยกเลิกไปแล้ว) ทำให้ check เป็น null ตั้งแต่ก่อนธงจะปัก ถ้าไม่ให้ effect วิ่งอีกรอบ
    // ตอนธงปัก คีย์ที่ตายแล้วจะค้างอยู่ตลอดไปและเสีย GET ทิ้งทุกครั้งที่เปิดจอ
  }, [check, token, viewRestored]);
  // กรองจากเมนูที่โหลดไว้แล้วในเครื่อง ไม่ยิง API ซ้ำ — ค้นหาที่นี่เป็นตัวช่วยกรองกริด
  // ไม่ใช่ทางเดียวเหมือนเดิม (เมนูร้านอาหารมีไม่มาก พิมพ์ทุกครั้งเสียเวลาเปล่า)
  const menuStations = useMemo(() => {
    const seen = new Set<string>();
    menuItems.forEach((item) => { if (item.kitchenStation) seen.add(item.kitchenStation); });
    return [...seen];
  }, [menuItems]);
  // ราคาต่อหน่วยรวมส่วนต่างของตัวเลือก — คิดที่เดียวแล้วใช้ทั้งบรรทัดสรุปและข้อความบนปุ่ม
  // (เดิมสูตรเดียวกันถูกเขียนซ้ำสองครั้งในข้อความเดียว) · price_delta เป็นข้อมูลฝั่ง server
  // เสมอ (9.45) จอแค่แสดงให้เห็นก่อนกด ไม่ได้เป็นคนตั้งราคา
  const menuHitUnitPrice = useMemo(() => {
    if (!menuHit) return 0;
    return menuHit.packPrice + menuHit.modifiers
      .filter((modifier) => modifierCodes.includes(modifier.code))
      .reduce((sum, modifier) => sum + modifier.priceDelta, 0);
  }, [menuHit, modifierCodes]);
  const menuHitTotal = menuHitUnitPrice * menuQty;
  // ปุ่มที่กดไปก็ล้มต้องกดไม่ได้ พร้อมบอกว่าต้องแตะอะไร (กฎเดียวกับปุ่มคิดเงินตอนใบจองหาย)
  const unmetModifiers = useMemo(
    () => (menuHit ? unmetModifierGroups(menuHit.modifiers, modifierCodes) : []),
    [menuHit, modifierCodes]
  );
  const soldOutCount = useMemo(
    () => menuItems.filter((item) => item.availability === "SOLD_OUT_TODAY").length,
    [menuItems]
  );
  const visibleMenuItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (menuOnlySoldOut && item.availability !== "SOLD_OUT_TODAY") return false;
      if (menuCategory && (item.kitchenStation ?? "") !== menuCategory) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
    });
  }, [menuItems, menuCategory, menuOnlySoldOut, search]);
  // ตัวกรองที่ค้างอยู่กับกริดว่างอ่านได้ว่า "ระบบพัง" — ปลดเองเมื่อเปิดขายครบแล้ว
  // (กติกาเดียวกับตัวกรองสถานีบนจอครัว)
  useEffect(() => { if (menuOnlySoldOut && soldOutCount === 0) setMenuOnlySoldOut(false); }, [menuOnlySoldOut, soldOutCount]);
  // KDS/floor are operational screens, so stale data is more dangerous than a
  // small bounded poll. The API remains branch-scoped by the device token.
  //
  // ⚠️ ทั้งสี่รอบนี้ (คิว · ตั๋วครัว · ผังโต๊ะ · ออร์เดอร์ QR) เดินผ่าน `useLiveRefresh`
  // ไม่ใช่ `setInterval` เปล่า ๆ เพราะ setInterval
  // ตอบโจทย์จอหน้าร้านไม่ได้: เบราว์เซอร์หรี่ timer ของแท็บที่ถูกซ่อน (Chrome เหลือราว
  // 1 ครั้ง/นาทีเมื่อซ่อนครบ 5 นาที · Android freeze ทั้งหน้าเมื่อจอดับ) และของเดิม
  // **ไม่มี visibilitychange handler เลย** ครัวจึงหยิบแท็บเล็ตขึ้นมาแล้วยังต้องรอ tick ถัดไป
  // ซึ่งเป็นรอบที่เพิ่งถูกหรี่มา — นี่คือที่มาของอาการ "ส่งครัวแล้วรอ 3-5 นาทีกว่าจะเด้ง"
  const pageVisible = usePageVisible();
  // ป้ายจำนวนคิวอยู่บนแถบซ้าย (เห็นทุกจอ) ด้วยเหตุผลเดียวกับป้ายออร์เดอร์ QR — ดึงเฉพาะ
  // ตอนเปิดแท็บคิวอยู่ = ป้ายไม่มีวันขึ้นตอนพนักงานยืนหน้าผังโต๊ะ แล้วคนที่รออยู่หน้าร้าน
  // ต้องรอจนกว่าจะมีคนเผลอกดเข้าแท็บนั้น
  useLiveRefresh({
    enabled: Boolean(token),
    intervalMs: alertPollIntervalMs({ focused: screen === "QUEUE", visible: pageVisible }),
    onRefresh: (signal) => loadWaitlist(signal),
  });
  // ⚠️ ตั๋วครัว **ต้องดึงจากทุกจอ ไม่ใช่เฉพาะตอนเปิดแท็บครัว** — ของเดิมผูกไว้กับ
  // `screen === "KITCHEN"` ผลคือสองอย่างที่ผิดพร้อมกัน:
  //   · ป้ายเลขข้างเมนู "ครัว" (kitchenCooking + kitchenReady) ไม่มีวันขยับตอนยืนหน้าผังโต๊ะ
  //   · ผังโต๊ะเองก็ไม่ refresh เพราะ loadFloor() ผูกอยู่ใน effect เดียวกัน → เครื่อง A
  //     เปิดโต๊ะ เครื่อง B ที่ยืนหน้าผังไม่เห็นจนกว่าจะกดอะไรสักอย่าง
  // เป็นกับดักเดียวกับที่โค้ดนี้เขียนคอมเมนต์เตือนไว้เองแล้วสำหรับป้าย QR และป้ายคิว
  const ticketPollMs = alertPollIntervalMs({ focused: screen === "KITCHEN", visible: pageVisible });
  const ticketFeed = useLiveRefresh({
    enabled: Boolean(token),
    intervalMs: ticketPollMs,
    // hook เก็บ callback ไว้ใน ref จึงส่ง arrow ตรง ๆ ได้ — ไม่ต้อง memo และไม่ทำให้
    // interval ถูกสร้างใหม่ทุก render (ซึ่งจะทำให้ไม่มีรอบไหนเดินครบเวลาเลย)
    onRefresh: (signal) => loadTickets(signal),
  });
  // ⚠️ ผังโต๊ะแยกรอบออกจากตั๋วครัวโดยตั้งใจ — ของเดิมยิงสองคำขอพร้อมกันทุก 5 วินาที
  // ซึ่งชนเพดาน 6 connection ต่อโดเมนของเบราว์เซอร์เร็วเป็นสองเท่าเมื่อฝั่ง server ช้า
  // จอครัวไม่ต้องการผังโต๊ะใหม่ทุก 5 วินาที (ใช้แค่ป้ายจำนวนบนแถบซ้ายกับแถบสรุป)
  useLiveRefresh({
    enabled: Boolean(token),
    intervalMs: alertPollIntervalMs({ focused: screen === "FLOOR", visible: pageVisible }),
    onRefresh: (signal) => loadFloor(signal),
  });
  // ป้ายจำนวน "ออร์เดอร์ QR รอรับ" อยู่บนแถบซ้ายเพื่อให้เห็นจากทุกจอ — ถ้าดึงข้อมูล
  // เฉพาะตอนเปิดแท็บ QR อยู่ ป้ายจะไม่มีวันขึ้นเลยตอนพนักงานยืนอยู่หน้าผังโต๊ะ (ที่ยืนจริง)
  // แล้วลูกค้าที่สั่งผ่าน QR ต้องรอจนกว่าจะมีคนเผลอกดเข้าแท็บนั้น = ป้ายไม่มีความหมาย
  useLiveRefresh({
    enabled: Boolean(token),
    intervalMs: alertPollIntervalMs({ focused: screen === "QR", visible: pageVisible }),
    onRefresh: (signal) => loadQrSubmissions(signal),
  });
  // คำเรียกพนักงานมี badge บนแถบซ้ายและต้องเด้งขณะยืนอยู่ทุกจอ เช่นเดียวกับออร์เดอร์ QR
  useLiveRefresh({
    enabled: Boolean(token),
    intervalMs: alertPollIntervalMs({ focused: screen === "CALLS", visible: pageVisible }),
    onRefresh: (signal) => loadServiceCalls(signal),
  });
  // จอครัวที่แขวนไว้ต้องไม่ดับ — จอที่ดับคือจุดที่เบราว์เซอร์เริ่มหรี่ timer ตั้งแต่แรก
  // ขอเฉพาะตอนอยู่จอครัวจริง ๆ ไม่ใช่ทั้งแอป (แท็บเล็ตแคชเชียร์ที่วางเฉย ๆ ไม่ต้องกินแบต)
  const wakeLock = useWakeLock(screen === "KITCHEN");
  // "จอนี้ยังได้ข้อมูลอยู่ไหม" — คิดจากเวลาที่โหลดสำเร็จครั้งล่าสุด ไม่ใช่จากนาฬิกาของเครื่อง
  const ticketHealth = feedHealth(ticketFeed.lastOkAt, boardNow, ticketPollMs);
  const ticketAgo = describeAgo(ticketFeed.lastOkAt, boardNow);
  const agoLabel = ticketAgo === null ? ""
    : ticketAgo.unit === "seconds"
      ? t("pos_alerts.ago_seconds", { seconds: ticketAgo.value })
      : t("pos_alerts.ago_minutes", { minutes: ticketAgo.value });
  // เขียนคีย์เต็มทีละตัว ไม่ประกอบด้วย template — คีย์ที่ประกอบตอนรัน i18n-keys-contract
  // ตรวจไม่ได้ แล้ววันที่คีย์หายจะไปโผล่เป็นชื่อ key ดิบบนจอครัวของร้านจริง
  const feedLabel = ticketAgo === null ? t("pos_alerts.feed_never")
    : ticketHealth === "STALE" ? t("pos_alerts.feed_stale", { ago: agoLabel })
    : ticketHealth === "SLOW" ? t("pos_alerts.feed_slow", { ago: agoLabel })
    : t("pos_alerts.feed_live", { ago: agoLabel });
  // ตั๋วที่เลยเกณฑ์เวลาของสถานีตัวเอง — ดังตอน "ข้ามเส้น" ครั้งเดียวต่อใบ ไม่ใช่ดังซ้ำ
  // ทุกวินาทีหลังจากนั้น · เสียงคนละตัวกับตั๋วใหม่โดยตั้งใจ ถ้าใช้เสียงเดียวกัน ครัวจะ
  // แยกไม่ออกว่า "มีของใหม่" กับ "ของเก่ากำลังจะสาย" ซึ่งต้องทำคนละอย่าง
  useEffect(() => {
    if (screen !== "KITCHEN") return;
    const late = tickets
      .filter((ticket) => ticket.status === "NEW" || ticket.status === "PREPARING")
      .filter((ticket) => kitchenUrgency(
        kitchenElapsedSeconds(pickReferenceAt(ticket.status, ticket.createdAt), boardNow),
        slaForStationRef(ticket, stationSlas)
      ) === "late")
      .map((ticket) => ticket.id);
    if (newAlertIds(knownLateTicketIds.current, late).length > 0) alerts.notify("SLA_LATE");
    knownLateTicketIds.current = new Set(late);
  }, [screen, tickets, stationSlas, boardNow, alerts]);

  /** เปิดบิลที่ระบุมาแล้ว — ใช้เมื่อคนกดเลือก "ใบไหน" ไปแล้ว (แผงบิล/แถบบิล/กล่องเลือกบิล) */
  async function openCheckById(table: DiningTable, checkId: string) {
    await run(async () => {
      await loadCheck(checkId);
      setSelectedTableId(table.id);
      setOpenTable(null);
      setScreen("ORDER");
    });
  }
  async function chooseTable(table: DiningTable) {
    if (table.blocked) return;
    // โต๊ะที่แยกบิลไว้มีบิลเปิดอยู่หลายใบ — เปิดใบแรกให้เองคือการเดาแทนคนที่ยืนอยู่ตรงนั้น
    // แล้วสั่งอาหารเข้าบิลของอีกคนโดยไม่มีอะไรบนจอบอกว่าเข้าใบไหน
    if (table.checks.length > 1) {
      // ยังไม่ทำเครื่องหมายว่าเลือกโต๊ะนี้ — โต๊ะจะถูกเลือกก็ต่อเมื่อบิลใบใดใบหนึ่งโหลดสำเร็จ
      // (กฎเดิมของหน้านี้: การเลือกโต๊ะต้องตามหลังบิลที่โหลดได้จริง ไม่ใช่ตามการแตะ)
      setBillPickerTable(table);
      return;
    }
    if (table.check) {
      await run(async () => {
        await loadCheck(table.check!.id);
        setSelectedTableId(table.id);
        setOpenTable(null);
        setScreen("ORDER");
      });
      return;
    }
    setSelectedTableId(table.id);
    setCheck(null);
    setGuestCount(Math.min(table.seats, 2));
    setOpenTable(table);
  }
  async function openCheck() { if (!openTable) return; await run(async () => { const body = await json("/api/pos/restaurant/checks", { method: "POST", body: JSON.stringify(auth({ tableId: openTable.id, guestCount })) }); setOpenTable(null); setCheck(body.check); setScreen("ORDER"); await loadFloor(); }); }
  /**
   * ยิงสแกนของไซซ์หนึ่ง แล้วตั้งตัวเลือกเป็นค่าปริยาย **ของไซซ์นั้น**
   *
   * ตัวเลือกผูกกับ (sku, ไซซ์) — `resolvePosScan` query ด้วย `modifier.size` ตรง ๆ
   * เปลี่ยนไซซ์แล้วยกตัวเลือกเดิมมาใช้ต่อ = ส่งรหัสที่ไซซ์ใหม่ไม่รู้จักไปให้ server ปฏิเสธ
   */
  async function loadMenuHit(sku: string, size: string) {
    const hit: ScanHit = await json(`/api/pos/scan?code=${encodeURIComponent(sku)}&size=${encodeURIComponent(size)}&surface=RESTAURANT_POS&withImage=1`);
    setMenuHit(hit);
    setModifierCodes(hit.modifiers.filter((modifier) => modifier.defaultSelected).map((modifier) => modifier.code));
  }
  async function chooseMenu(item: SearchItem) {
    await run(async () => {
      // ⚠️ ห้ามใช้ `available > 0` เป็นตัวคัดไซซ์ที่เลือกได้ — เมนู RECIPE/NON_STOCK มีสต็อก
      // ของตัวเองเป็น 0 ตามดีไซน์ (9.51/9.52) การกรองด้วยสต็อกจะทำให้อาหารเกือบทุกจาน
      // ไม่มีไซซ์ให้เลือกสักอัน · ที่นี่ใช้แค่เลือก "ไซซ์ตั้งต้น" ให้ตรงกับของที่มีจริงถ้ามี
      const sizes = item.availableSizes;
      const size = sizes.find((variant) => variant.available > 0)?.size ?? sizes[0]?.size ?? "";
      setMenuSource(item);
      setKitchenNote("");
      setMenuQty(1);
      await loadMenuHit(item.sku, size);
    });
  }
  /** เปลี่ยนไซซ์ในกล่อง — คงจำนวนและโน้ตถึงครัวที่คนหน้าร้านกรอกไปแล้ว */
  async function pickMenuSize(size: string) {
    if (!menuSource || !menuHit || menuHit.size === size) return;
    await run(async () => { await loadMenuHit(menuSource.sku, size); });
  }
  async function addMenu() { if (!check || !menuHit) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: "add_item", sku: menuHit.sku, size: menuHit.size, packCode: menuHit.packCode, packQty: menuQty, modifierCodes, kitchenNote })) }); setCheck(body.check); setMenuHit(null); setMenuSource(null); setSearch(""); await loadFloor(); }); }
  /**
   * สั่งซ้ำบรรทัดเดิม — คุณค่าอยู่ที่การก็อป **ตัวเลือก + โน้ตครัว** ไม่ใช่ก็อปเมนู
   * ("เผ็ดน้อย เพิ่มไข่ดาว ไม่ใส่ผักชี" ถ้าไม่มีปุ่มนี้ต้องเลือกใหม่ทั้งชุดทุกครั้ง)
   *
   * **ห้ามก็อปราคา** — ส่งแต่ sku/size/packCode/จำนวน/รหัสตัวเลือก/โน้ต แล้วให้ server
   * คิดราคาใหม่ตอนเพิ่ม ถ้าร้านขึ้นราคาหรือโปรหมดไปแล้ว บรรทัดใหม่ต้องได้ราคาวันนี้
   * · ก็อปราคาเก่ามาคือสูตรเงินชุดที่สอง
   *
   * ได้บรรทัดสถานะ NEW ที่ต้องกดส่งครัวอีกรอบ — ไม่แอบเพิ่มเข้ารอบที่ส่งไปแล้ว
   */
  async function reorderLine(item: CheckItem) {
    if (!check) return;
    await run(async () => {
      const body = await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({
          action: "add_item",
          sku: item.sku,
          size: item.size,
          packCode: item.packCode,
          packQty: item.packQty,
          modifierCodes: item.modifierCodes,
          kitchenNote: item.kitchenNote,
        })),
      });
      setCheck(body.check);
      await loadFloor();
      message.success(t("pos_restaurant.toast_item_reordered", { name: item.productName, qty: item.packQty }));
    });
  }

  async function acceptQrSubmission(submission: QrSubmission) {
    await run(async () => {
      const result = await json("/api/pos/restaurant/qr-orders", {
        method: "POST",
        body: JSON.stringify(auth({
          action: "accept",
          submissionId: submission.id,
        })),
      });
      await Promise.all([loadQrSubmissions(), loadFloor(), loadTickets()]);
      if (check?.id === submission.checkId && result.check) setCheck(result.check);
      message.success(t("pos_restaurant.toast_qr_accepted", { table: submission.tableName }));
    });
  }

  async function rejectQrSubmission() {
    if (!selectedQrSubmission || !qrRejectReason.trim()) return;
    await run(async () => {
      await json("/api/pos/restaurant/qr-orders", {
        method: "POST",
        body: JSON.stringify(auth({
          action: "reject",
          submissionId: selectedQrSubmission.id,
          reason: qrRejectReason.trim(),
        })),
      });
      setQrRejectOpen(false);
      setQrRejectReason("");
      await loadQrSubmissions();
      message.success(t("pos_restaurant.toast_qr_rejected", { table: selectedQrSubmission.tableName }));
    });
  }

  async function updateServiceCall(call: ServiceCall, action: "acknowledge" | "complete") {
    await run(async () => {
      await json("/api/pos/restaurant/service-calls", {
        method: "POST",
        body: JSON.stringify(auth({ action, callId: call.id })),
      });
      await loadServiceCalls();
      message.success(action === "acknowledge"
        ? t("pos_restaurant.toast_service_acknowledged", { table: call.tableName })
        : t("pos_restaurant.toast_service_completed", { table: call.tableName }));
    });
  }

  async function action(name: string, extra: Record<string, unknown> = {}) { if (!check) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: name, ...extra })) }); if (body.check) setCheck(body.check); await Promise.all([loadFloor(), loadTickets()]); }); }
  /**
   * แยกบิล — บรรทัดที่เลือกย้ายไปเป็นบิลใหม่ของโต๊ะเดิม แล้วจอกระโดดไปยืนบนบิลใหม่
   *
   * ยืนบนใบใหม่โดยตั้งใจ เพราะขั้นตอนถัดไปของคนที่เพิ่งกดคือเก็บเงินใบที่เพิ่งแยกออกมา
   * (ลูกค้าที่ขอแยกมักเป็นคนที่จะลุกก่อน) · ใบเดิมยังกดกลับได้จากผังโต๊ะ
   */
  async function splitCheck() {
    if (!check || splitItemIds.length === 0) return;
    await run(async () => {
      const body = await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({ action: "split", itemIds: splitItemIds })),
      });
      setSplitOpen(false);
      setSplitItemIds([]);
      if (body.target) setCheck(body.target);
      await Promise.all([loadFloor(), loadTickets()]);
      message.success(t("pos_restaurant.toast_check_split", { amount: money(Number(body.target?.amountDue ?? 0)) }));
    });
  }
  /** รวมบิล — ยกบิลที่เปิดอยู่ตอนนี้ไปรวมกับใบปลายทาง แล้วจอไปยืนบนใบปลายทาง */
  async function mergeCheck() {
    if (!check || !mergeTargetId) return;
    await run(async () => {
      const body = await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({ action: "merge", targetCheckId: mergeTargetId })),
      });
      setMergeOpen(false);
      setMergeTargetId("");
      if (body.check) setCheck(body.check);
      await Promise.all([loadFloor(), loadTickets()]);
      message.success(t("pos_restaurant.toast_check_merged", { count: body.movedItems ?? 0 }));
    });
  }
  /**
   * ฐานคิดแต้มคือ `bms_orders.total_amount` ซึ่ง **ไม่รวม** ยอดปัดเศษเงินสด
   * จึงต้องส่ง `check.amountDue` ไม่ใช่ `checkoutDue` — ไม่งั้นตัวเลขที่จอสัญญา
   * จะไม่ตรงกับที่ ledger ให้จริงในบิลที่ร้านเปิดปัดเศษ
   */
  const earnBasisAmount = check?.amountDue ?? null;
  async function searchMembers() {
    if (memberQuery.trim().length < 3) { setMemberResults([]); return; }
    await run(async () => {
      const suffix = earnBasisAmount == null ? "" : `&amount=${encodeURIComponent(String(earnBasisAmount))}`;
      const body = await json(`/api/pos/member?q=${encodeURIComponent(memberQuery.trim())}${suffix}`);
      setMemberResults(Array.isArray(body.members) ? body.members : []);
      if (body.loyalty) setMemberLoyalty(body.loyalty as PosLoyaltyStatus);
    });
  }
  // ถามสถานะทันทีที่เปิดแผงคิดเงิน ไม่ต้องรอให้ค้นสมาชิกก่อน — คนที่ยังไม่ได้ค้น
  // ก็ต้องรู้ว่าผูกสมาชิกไปแล้วจะได้แต้มไหม
  useEffect(() => {
    if (!checkoutOpen || !token || earnBasisAmount == null) { setMemberLoyalty(null); return; }
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await json(`/api/pos/member?amount=${encodeURIComponent(String(earnBasisAmount))}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && body.loyalty) setMemberLoyalty(body.loyalty as PosLoyaltyStatus);
      } catch {
        // เงียบโดยตั้งใจ: นี่เป็นข้อมูลประกอบ ไม่ใช่ด่าน · ปุ่มคิดเงินบนจอเดียวกัน
        // รายงานปัญหาเน็ตอยู่แล้ว การเด้ง error ซ้ำทำให้แคชเชียร์เลิกอ่าน
      }
    })();
    return () => controller.abort();
  }, [checkoutOpen, token, earnBasisAmount]);
  /** แปลรหัสจาก server เป็นประโยค — จอไม่เดาเหตุผลเอง (server ตัดสินด้วยบันไดชุดเดียว) */
  function earnBlockText(block: PosLoyaltyStatus["block"]): string {
    switch (block) {
      case "PROGRAM_DISABLED": return t("pos_restaurant.points_off_program");
      case "BELOW_MIN_SPEND": return t("pos_restaurant.points_off_min_spend");
      case "RATE_TOO_LOW": return t("pos_restaurant.points_off_rate");
      case "NO_VISIT_POINTS": return t("pos_restaurant.points_off_visit");
      default: return "";
    }
  }
  async function loadRecentReceipts() {
    await run(async () => {
      const suffix = recentQuery.trim() ? `&q=${encodeURIComponent(recentQuery.trim())}` : "";
      const body = await json(`/api/pos/recent-sales?limit=20&deviceOnly=1${suffix}`);
      const rows: RecentReceipt[] = Array.isArray(body.sales) ? body.sales : [];
      // deviceOnly บังคับขอบเขตที่ query ฝั่ง server; filter นี้เป็น fail-closed guard ของจอ
      // เผื่อ response contract ถูกเปลี่ยนในอนาคต ไม่ใช่ชั้น authorization หลัก
      setRecentReceipts(rows.filter((row) => row.posDeviceId === session?.device.id));
    });
  }
  /**
   * payload ชุดเดียวป้อนทั้งกระดาษบนจอ (`<ReceiptPaper/>`) และไบต์ที่ส่งเข้าเครื่องพิมพ์
   * (`buildReceipt`) — สองตัวประกอบเองแยกกันเมื่อไหร่ จอกับกระดาษจะเริ่มบอกคนละเลข
   * โดยไม่มีใครรู้จนลูกค้าถือใบเสร็จมาเทียบ
   *
   * คืน `null` แทนการ throw เพราะตัวนี้ถูกเรียกตอน render ด้วย — บิลที่ราคาบรรทัดยังไม่ครบ
   * ต้องขึ้นคำเตือนในกล่อง ไม่ใช่ทำทั้งกล่องพัง (ส่วนปุ่มพิมพ์เป็นคนบอกว่าพิมพ์ไม่ได้เพราะอะไร)
   */
  function receiptPayload(receipt: ReceiptSelection): ReceiptPayload | null {
    const mode = session?.store?.receiptLanguageMode ?? "th";
    const current = "result" in receipt;
    const result = current ? receipt.result : receipt;
    const currentLines = current ? receipt.check.items.filter((item) => item.status === "SENT") : [];
    if (current && currentLines.some((item) => item.lineAmount == null)) return null;
    const lines: ReceiptLine[] = current
      ? currentLines.map((item) => ({
          name: `${item.productName}${item.size && item.size !== "-" ? ` (${item.size})` : ""}${item.modifierNames.length ? ` · ${item.modifierNames.join(", ")}` : ""}`,
          qty: item.packQty,
          amount: item.lineAmount!,
        }))
      : receipt.lines.map((item) => ({
          name: `${item.receiptName}${item.size && item.size !== "-" ? ` (${item.size})` : ""}`,
          qty: item.packQty,
          amount: item.lineTotal,
        }));
    let itemCount = 0;
    for (const line of lines) itemCount += line.qty;
    return {
      languageMode: mode,
      storeName: session?.location?.name ?? "BMS Restaurant",
      locationId: session?.location?.id ?? null,
      branchCode: session?.location?.branchCode ?? null,
      taxId: session?.store?.taxId ?? null,
      posDeviceId: session?.device.id ?? null,
      posNo: session?.device.registeredPosNo ?? session?.device.code ?? null,
      shiftId: receipt.shiftId,
      vatIncluded: Boolean(session?.vat.registered),
      docTitle: receiptDocumentTitle(mode, "sale", Boolean(session?.vat.registered)),
      docNo: result.docNo,
      orderId: result.orderId,
      // ⚠️ ต้องแปลงเป็นเวลาท้องถิ่นก่อน — `buildReceipt` พิมพ์ค่านี้ตรง ๆ
      //
      // เดิมส่ง ISO ดิบเข้าไป ใบเสร็จจึงพิมพ์ "2026-09-05T03:17:15.933Z" ซึ่งอ่านไม่ออก
      // **และเป็นเวลา UTC** = เพี้ยนจากเวลาที่ขายจริง 7 ชั่วโมงบนเอกสารที่ยื่นให้ลูกค้า
      // (การ์ดข้าง ๆ ในจอเดียวกันเขียน 10:17 แต่กระดาษเขียน 03:17) · หน้าค้าปลีกแปลงด้วย
      // `receiptAt()` มาตลอด — เจอตอนเรนเดอร์กระดาษขึ้นจอเป็นครั้งแรก
      at: localReceiptTime(current ? receipt.at : receipt.soldAt, mode),
      cashier: receipt.cashierName,
      lines,
      itemCount,
      total: result.total,
      tendered: result.cashTendered,
      change: result.cashChange,
      // ปัดเศษเงินสด (7.95) รวมอยู่ใน total แล้ว แต่ต้องมีบรรทัดของตัวเองบนใบเสร็จ
      // ร้านอาหารส่วนใหญ่ยังไม่จด VAT จึงไม่มีบล็อก VAT ให้ค่านี้ไปอาศัยอยู่
      roundingAmount: result.roundingAmount,
      payments: receipt.payments.map((payment) => ({
        label: posPaymentMethodLabel(payment.method, mode),
        amount: payment.amount,
        ref: payment.ref,
        tendered: payment.cashTendered,
        change: payment.cashChange,
      })),
      vat: result.vat,
      discountLines: result.discountLines,
      member: current
        ? receipt.member ? { name: receipt.member.name, memberNo: receipt.member.memberNo, pointsEarned: receipt.result.pointsEarned, pointsBalance: receipt.result.pointsBalance } : null
        : receipt.memberName ? { name: receipt.memberName, memberNo: receipt.memberNo, pointsEarned: receipt.pointsEarned ?? null, pointsBalance: receipt.pointsBalance ?? null } : null,
    };
  }
  /**
   * ทางพิมพ์สำรองผ่าน print dialog — ใบเสร็จที่เรนเดอร์อยู่ในกล่องคือสิ่งที่ถูกพิมพ์
   *
   * เดิมหน้านี้มีทางพิมพ์ทางเดียวคือ WebUSB ESC/POS ซึ่ง **ใช้ได้เฉพาะ Chrome/Edge บน
   * HTTPS และต้อง pair เครื่องก่อน** (บน macOS อาจต้องถอน driver ของระบบด้วย) แถลสถานะ
   * ของเส้นนั้นยังเป็น "เขียนแล้ว ไม่เคยยิงกับฮาร์ดแวร์จริง" · หน้าค้าปลีกตกมาที่ dialog ได้
   * มาตลอด หน้าร้านอาหารไม่ได้ = เครื่องพิมพ์ไม่ติดแล้วลูกค้าไม่ได้ใบเสร็จเลย
   *
   * ตั้ง marker ที่ body ก่อน `window.print()` เพราะกฎ `@media print` ใน globals.css
   * เลือกพิมพ์เฉพาะ `#pos-receipt` — ไม่งั้นได้ทั้งหน้าจอขายลงกระดาษ
   */
  function printViaBrowser() {
    document.body.setAttribute("data-pos-print-target", "receipt");
    let fallbackTimer = 0;
    const cleanup = () => {
      document.body.removeAttribute("data-pos-print-target");
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    // rAF มีไว้ให้เบราว์เซอร์คำนวณ style จาก marker ก่อน snapshot — แต่ **rAF ไม่ทำงานเลย
    // เมื่อแท็บถูกซ่อนหรือพับไปหลัง** ซึ่งเกิดจริงบนแท็บเล็ตหน้าร้านที่สลับแอปได้ตลอด
    // ถ้าพึ่งตัวเดียว ใบเสร็จจะไม่ถูกพิมพ์เงียบ ๆ ทั้งที่พนักงานกดไปแล้วและ toast บอกว่ากำลังพิมพ์
    // · ใครถึงก่อนชนะ แต่ยิงครั้งเดียว ไม่งั้นได้ dialog สองใบซ้อน
    let printed = false;
    const fire = () => {
      if (printed) return;
      printed = true;
      window.print();
    };
    window.requestAnimationFrame(fire);
    window.setTimeout(fire, 120);
    fallbackTimer = window.setTimeout(cleanup, 30_000);
  }
  /**
   * ⚠️ ลิ้นชักเปิดได้เฉพาะตอนพิมพ์ใบเสร็จของบิลที่ "เพิ่งรับเงินสด" เท่านั้น
   *
   * `8.0` ปิดช่องที่เปิดลิ้นชักได้โดยไม่มีร่องรอยไปแล้ว (ปุ่มเปล่า ๆ ที่แท็บตั้งค่า) แล้วบังคับ
   * ให้การเปิดลิ้นชักที่ไม่ได้มาจากการขายต้องผ่าน `pos.nosale` + เหตุผล + นับในสรุปกะ ·
   * ถ้าพิมพ์ซ้ำก็เปิดลิ้นชักด้วย แท็บ "บิล" จะกลายเป็นปุ่มเปิดลิ้นชักที่ไม่ต้องใช้ PIN
   * ไม่มีเหตุผล และไม่มีใครนับ — กดกี่ครั้งก็ได้ต่อหน้าเงินในลิ้นชัก
   *
   * บิลที่จ่ายบัตร/QR ล้วนก็ไม่เปิด เพราะไม่มีเงินสดให้ทอน · คนที่ต้องเปิดลิ้นชักจริง ๆ
   * ใช้ "เปิดลิ้นชักโดยไม่ขาย" ที่แท็บกะ ซึ่งบันทึกว่าใครเปิดเพราะอะไร (กฎเดียวกับหน้าค้าปลีก
   * ที่แยก `printReceipt(true)` ของบิลที่เพิ่งขาย ออกจาก `printReceipt(false)` ของการพิมพ์ซ้ำ)
   *
   * **print dialog เปิดลิ้นชักไม่ได้** — ตกมาทางสำรองเมื่อไหร่ ต้องบอกให้ไปเปิดที่แท็บกะ
   * ซึ่งเป็นทางที่มีหลักฐานอยู่แล้ว ไม่ใช่ปล่อยให้เข้าใจว่าลิ้นชักจะเด้งเอง
   */
  function receiptBytes(receipt: ReceiptSelection) {
    const payload = receiptPayload(receipt);
    if (!payload) throw new Error(t("pos_restaurant.receipt_missing_prices"));
    return buildReceipt(payload);
  }
  async function printReceipt(receipt: ReceiptSelection, openDrawer = false) {
    await run(async () => {
      if (!receiptPayload(receipt)) {
        throw new Error(t("pos_restaurant.receipt_missing_prices"));
      }
      const fallback = (reason: string) => {
        message.info(t("pos_restaurant.print_browser_fallback", { reason, drawer: openDrawer ? t("pos_restaurant.print_drawer_hint") : "" }));
        printViaBrowser();
      };
      if (!isWebUsbSupported()) {
        fallback(t("pos_restaurant.print_no_webusb"));
        return;
      }
      let printer = await findRememberedPrinter();
      if (!printer) {
        try { printer = await requestPrinter(); }
        catch { printer = null; }
      }
      if (!printer) {
        fallback(t("pos_restaurant.print_no_printer"));
        return;
      }
      try {
        await sendToPrinter(receiptBytes(receipt), printer);
        if (openDrawer) await sendToPrinter(buildDrawerKick(), printer);
      } catch (cause) {
        fallback(t("pos_restaurant.print_failed", { reason: cause instanceof Error ? cause.message : String(cause) }));
        return;
      }
      message.success(t("pos_restaurant.toast_receipt_printed"));
    });
  }
  async function settle() {
    if (!check) return;
    const blocked = checkoutBlockReason(payments, checkoutDue);
    if (blocked) { message.error(blocked); return; }
    await run(async () => {
      const settledCheck = check;
      const settledPayments = payments.map((payment) => {
        const amount = Number(payment.amount);
        const tendered = payment.method === "CASH" && payment.tendered ? Number(payment.tendered) : null;
        return {
          method: payment.method,
          amount,
          ref: payment.ref.trim() || null,
          cashTendered: tendered,
          cashChange: tendered == null ? null : Math.round((tendered - amount) * 100) / 100,
        };
      });
      const result: SettlementResult = await json(`/api/pos/restaurant/checks/${settledCheck.id}`, {
        method: "POST",
        body: JSON.stringify(auth({
          action: "settle",
          customerId: checkMember?.customerId ?? null,
          payments: payments.map((payment) => ({
            method: payment.method,
            amount: Number(payment.amount),
            cashTendered: payment.method === "CASH"
              ? Math.max(Number(payment.tendered || payment.amount), Number(payment.amount))
              : null,
            ref: payment.ref.trim() || null,
          })),
        })),
      });
      setSettlementReceipt({
        result,
        payments: settledPayments,
        check: settledCheck,
        member: checkMember,
        at: new Date().toISOString(),
        cashierName: operatorName || null,
        shiftId: session?.shift?.id ?? null,
      });
      setCheckoutOpen(false);
      setPayments([]);
      setSelectedMember(null);
      setMemberQuery("");
      setMemberResults([]);
      setCheck(null);
      setSelectedTableId("");
      setScreen("FLOOR");
      await Promise.all([loadFloor(), loadTickets(), loadSession()]);
    });
  }
  function openCancel() {
    setCancelReason("");
    setCancelApproverPin("");
    setCancelApproverId(voidApprovers[0]?.id ?? "");
    setCancelOpen(true);
  }
  async function cancelCheck() {
    if (!check) return;
    if (!cancelReason.trim()) { message.error(t("pos_restaurant.need_cancel_note")); return; }
    if (cancelNeedsApproval && (!cancelApproverId || !cancelApproverPin)) {
      message.error(t("pos_restaurant.need_second_pin_cancel"));
      return;
    }
    await run(async () => {
      await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({
          action: "cancel",
          reason: cancelReason.trim(),
          approverUserId: cancelNeedsApproval ? cancelApproverId : null,
          approverPin: cancelNeedsApproval ? cancelApproverPin : null,
        })),
      });
      setCancelOpen(false);
      setCheck(null);
      setSelectedTableId("");
      await Promise.all([loadFloor(), loadTickets()]);
      message.success(t("pos_restaurant.toast_check_cancelled"));
    });
  }
  // เลื่อนสถานะตั๋ว — ต้องมีคำตอบที่จอทุกครั้ง เพราะตั๋วที่เลื่อนแล้วจะย้ายเลน (หรือหายไปเลย
  // เมื่อยกเลิก เพราะไม่มีเลนของ CANCELLED) ถ้าเงียบ คนครัวอ่านว่า "กดแล้วไม่เกิดอะไร"
  // และการยกเลิกต้องบอกด้วยว่า **รายการยังอยู่ในบิล** ไม่งั้นเข้าใจว่าตัดออกให้แล้ว
  const TICKET_DONE_TEXT: Record<string, string> = {
    PREPARING: t("pos_restaurant.ticket_done_preparing"), READY: t("pos_restaurant.ticket_done_ready"), SERVED: t("pos_restaurant.ticket_done_served"),
  };
  /**
   * ปุ่มบนใบเลื่อนทุกตั๋วในใบนั้นพร้อมกัน ผ่าน route เดียวที่ทำในทรานแซกชันเดียว
   * (ยิงทีละใบจากที่นี่ = ใบที่ล้มกลางชุดทิ้งงานเดียวกันคาไว้สองช่องบนกระดาน)
   */
  async function ticketGroupStatus(group: KitchenBoardGroup, status: string) {
    await run(async () => {
      const body = await json("/api/pos/kitchen/tickets/status", {
        method: "POST",
        body: JSON.stringify({ userId: actorUserId, pin: actorPin, status, ticketIds: group.ticketIds }),
      });
      const moved: Array<KitchenTicket & { billLineDropped?: boolean; checkAmountDue?: number | null }> =
        Array.isArray(body.tickets) ? body.tickets : [];
      const byId = new Map(moved.map((row) => [row.id, row]));
      setTickets((current) => current.map((row) => byId.get(row.id) ?? row));
      setGroupMenu(null);
      const where = group.tableLabel ? `${group.tableLabel} · ` : "";
      // นับ "จาน" ให้ตรงกับป้ายบนหัวเลนและเมนู ⋯ — ถ้าใช้จำนวนบรรทัด (items.length)
      // การขยับชามะนาว 4 แก้วจะรายงานว่า "2 รายการ" ซึ่งไม่ตรงกับสิ่งที่เพิ่งเกิด
      const what = group.items.length === 1
        ? `${group.items[0].qty}× ${group.items[0].productName}`
        : t("pos_restaurant.item_count", { count: group.totalQty });
      if (status === "CANCELLED") {
        const dropped = moved.filter((row) => row.billLineDropped).length;
        if (dropped > 0) {
          const due = moved.find((row) => row.checkAmountDue != null)?.checkAmountDue;
          message.success(t("pos_restaurant.toast_kitchen_cancelled_dropped", { where, what, due: due == null ? "" : t("pos_restaurant.new_amount_suffix", { amount: money(due) }) }), 6);
        } else {
          message.warning(t("pos_restaurant.toast_kitchen_cancelled_charged", { where, what }), 10);
        }
      } else {
        message.success(`${where}${what}: ${TICKET_DONE_TEXT[status] ?? t("pos_restaurant.toast_updated")}`);
      }
      if (check && group.items.some((item) => item.ticketIds.length > 0)) await loadCheck(check.id);
    });
  }

  async function ticketStatus(ticket: KitchenTicket, status: string) {
    await run(async () => {
      const body = await json(`/api/pos/kitchen/tickets/${ticket.id}/status`, { method: "POST", body: JSON.stringify({ userId: actorUserId, pin: actorPin, status }) });
      setTickets((current) => current.map((row) => row.id === ticket.id ? body.ticket : row));
      const where = ticket.tableName ? `${ticket.tableName} · ` : "";
      if (status === "CANCELLED") {
        // server ตัดบรรทัดออกจากยอดให้แล้วในทรานแซกชันเดียวกัน — บอกยอดใหม่ไปเลย
        // เพื่อให้คนกดเห็นว่าเงินขยับจริง ไม่ต้องเดาว่าต้องไปแก้บิลเองอีกไหม
        if (body.ticket?.billLineDropped) {
          const due = body.ticket.checkAmountDue;
          message.success(t("pos_restaurant.toast_ticket_cancelled_dropped", { where, name: ticket.productName, due: due == null ? "" : t("pos_restaurant.new_amount_suffix", { amount: money(due) }) }), 6);
        } else {
          message.warning(t("pos_restaurant.toast_ticket_cancelled_charged", { where, name: ticket.productName }), 10);
        }
      } else {
        message.success(`${where}${ticket.productName}: ${TICKET_DONE_TEXT[status] ?? t("pos_restaurant.toast_updated")}`);
      }
      // บิลที่เปิดอยู่ต้องเห็นธง "ครัวยกเลิกรายการนี้" ทันที ไม่ต้องรอ poll รอบถัดไป
      if (check?.id) await loadCheck(check.id).catch(() => {});
    });
  }
  async function changeShift() {
    if (!shiftModal || !operatorReady) return;
    await run(async () => {
      const actionName = shiftModal;
      await json("/api/pos/shift", { method: "POST", body: JSON.stringify({ action: actionName.toLowerCase(), userId: actorUserId, pin: actorPin, ...(actionName === "OPEN" ? { openingFloat: cashAmount } : { countedCash: cashAmount }) }) });
      setShiftModal(null);
      setCashAmount(0);
      setShiftReport(null);
      await loadSession();
      message.success(actionName === "OPEN" ? t("pos_restaurant.toast_shift_opened") : t("pos_restaurant.toast_shift_closed"));
    });
  }
  async function recordCashMove() {
    if (!operatorReady) { message.error(t("pos_restaurant.need_operator_pin")); return; }
    if (!(Number(cashMoveAmount) > 0) || !cashMoveReason.trim()) { message.error(t("pos_restaurant.need_amount_and_reason")); return; }
    if (cashMoveDirection === "IN" && !cashMoveExternalConfirmed) {
      message.error(t("pos_restaurant.need_external_confirm"));
      return;
    }
    if (cashMoveDirection === "OUT" && (!cashMoveApproverId || !cashMoveApproverPin)) { message.error(t("pos_restaurant.need_second_pin_cash_out")); return; }
    await run(async () => {
      const signature = JSON.stringify({
        shiftId: session?.shift?.id ?? null,
        direction: cashMoveDirection,
        amount: Number(cashMoveAmount),
        reason: cashMoveReason.trim(),
        cashierUserId: actorUserId,
        approverUserId: cashMoveDirection === "OUT" ? cashMoveApproverId : null,
      });
      if (cashMovementRequestRef.current?.signature !== signature) {
        cashMovementRequestRef.current = { signature, key: `restaurant-cash-${crypto.randomUUID()}` };
      }
      await json("/api/pos/cash-movement", { method: "POST", body: JSON.stringify({
        direction: cashMoveDirection, amount: Number(cashMoveAmount), reason: cashMoveReason.trim(),
        cashierUserId: actorUserId, pin: actorPin,
        approverUserId: cashMoveDirection === "OUT" ? cashMoveApproverId : null,
        approverPin: cashMoveDirection === "OUT" ? cashMoveApproverPin : null,
        idempotencyKey: cashMovementRequestRef.current.key,
      }) });
      cashMovementRequestRef.current = null;
      setCashMoveAmount(""); setCashMoveReason(""); setCashMoveApproverPin(""); setCashMoveExternalConfirmed(false);
      setShiftReport(null);
      message.success(t("pos_restaurant.toast_cash_movement"));
    });
  }
  async function recordNoSale() {
    if (!operatorReady) { message.error(t("pos_restaurant.need_operator_pin")); return; }
    if (!noSaleReason.trim()) { message.error(t("pos_restaurant.need_no_sale_reason")); return; }
    await run(async () => {
      await json("/api/pos/no-sale", { method: "POST", body: JSON.stringify({ cashierUserId: actorUserId, pin: actorPin, reason: noSaleReason.trim() }) });
      setNoSaleReason("");
      const printer = await findRememberedPrinter();
      if (printer) await sendToPrinter(buildDrawerKick(), printer).catch(() => {});
      setShiftReport(null);
      message.success(t("pos_restaurant.toast_no_sale"));
    });
  }
  async function loadShiftReport() {
    if (!actorUserId || !actorPin) { message.error(t("pos_restaurant.need_operator_pin")); return; }
    await run(async () => {
      const query = new URLSearchParams({ cashierUserId: actorUserId, pin: actorPin });
      const body = await json(`/api/pos/shift-report?${query}`);
      setShiftReport(body.report ?? null);
    });
  }
  useEffect(() => {
    if (screen !== "BILLS" || !token || !session?.device.id) return;
    void loadRecentReceipts();
  }, [screen, token, session?.device.id]);
  async function supportAction(action: "export" | "send") {
    if (!token || !session?.device?.id || !actorUserId || !actorPin) return message.error(lang === "en" ? "Select an operator and enter the PIN first." : t("pos_restaurant.need_operator_pin"));
    if (action === "send" && (!supportConfirmed || !supportDescription.trim())) return message.warning(lang === "en" ? "Describe the issue and confirm before sending." : t("pos_restaurant.need_issue_and_confirm"));
    setSupportWorking(action);
    try {
      if (action === "send") recordSupportActivity(supportScope, { category: "support", action: "support.bundle_send_confirmed", status: "success", deviceId: session.device.id, locationId: session.location?.id ?? null, context: { route: "/pos/restaurant" } });
      await flushSupportActivity(supportScope, {
        url: "/api/pos/support-diagnostics",
        headers: { "x-pos-device-token": token },
        body: { action: "events", cashierUserId: actorUserId, cashierPin: actorPin },
      });
      const to = new Date();
      const response = await fetch("/api/pos/support-diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json", "x-pos-device-token": token },
        body: JSON.stringify({
          action,
          cashierUserId: actorUserId,
          cashierPin: actorPin,
          from: new Date(to.getTime() - 24 * 3_600_000).toISOString(),
          to: to.toISOString(),
          description: supportDescription.trim(),
          confirmed: action === "send" ? supportConfirmed : false,
        }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      const truncated = response.headers.get("x-support-truncated");
      if (action === "export") {
        const blob = await response.blob();
        const filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "support-diagnostics.ndjson.gz";
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
        message.success(truncated ? t("pos_restaurant.diagnostics_download_truncated", { sources: truncated }) : t("pos_restaurant.toast_diagnostics"));
      } else {
        const body = await response.json();
        const truncatedSources = Object.entries(body.truncated ?? {}).filter(([, value]) => value).map(([key]) => key).join(", ");
        if (truncatedSources) {
          message.warning(t("pos_restaurant.support_case_truncated", { code: body.ticketCode, sources: truncatedSources }));
        } else {
          message.success(t("pos_restaurant.support_case_created", { code: body.ticketCode }));
        }
        setSupportOpen(false); setSupportConfirmed(false); setSupportDescription("");
      }
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    } finally { setSupportWorking(null); }
  }

  // สองสถานะนี้ไม่มีแถบซ้าย (ยังไม่มีอะไรให้สลับ) จึงใช้ .pagePlain ที่ไม่ใช่ grid สองคอลัมน์
  // ไม่งั้นเนื้อหาไปกองอยู่คอลัมน์ที่สองโดยเว้นช่องว่าง 64px ทางซ้ายไว้เฉย ๆ
  if (!ready || loading) return <main className={`${styles.page} ${styles.pagePlain}`}><div className={styles.empty}><Spin size="large" /></div></main>;
  if (!token) return <main className={`${styles.page} ${styles.pagePlain}`}><Alert type="warning" showIcon message={t("pos_restaurant.no_token_title")} description={t("pos_restaurant.no_token_desc")} /></main>;

  // ป้ายในแถบกว้าง 64px ต้องสั้นพอไม่ตัดคำ ("สั่งอาหาร" เหลือ "สั่ง" แล้วอ่านเป็นคำอื่น)
  // ชื่อเต็มอยู่ที่ title/aria-label เพื่อให้ screen reader และ tooltip ยังได้ความหมายครบ
  const railScreens = [
    { key: "ORDER" as const, short: t("pos_restaurant.rail_order_short"), full: t("pos_restaurant.rail_order"), icon: <WalletOutlined />, badge: 0 },
    { key: "FLOOR" as const, short: t("pos_restaurant.rail_floor_short"), full: t("pos_restaurant.rail_floor"), icon: <AppstoreOutlined />, badge: unsentTableCount },
    { key: "QUEUE" as const, short: t("pos_restaurant.rail_queue_short"), full: t("pos_restaurant.rail_queue"), icon: <TeamOutlined />, badge: waitlist.waitingCount + waitlist.calledCount },
    { key: "QR" as const, short: "QR", full: t("pos_restaurant.rail_qr"), icon: <QrcodeOutlined />, badge: pendingQrSubmissions.length },
    { key: "CALLS" as const, short: t("pos_restaurant.rail_calls_short"), full: t("pos_restaurant.rail_calls"), icon: <span aria-hidden="true">🔔</span>, badge: pendingServiceCalls.length },
    { key: "KITCHEN" as const, short: t("pos_restaurant.rail_kitchen_short"), full: t("pos_restaurant.rail_kitchen"), icon: <CoffeeOutlined />, badge: kitchenCooking + kitchenReady },
    { key: "BILLS" as const, short: t("pos_restaurant.rail_bills_short"), full: t("pos_restaurant.rail_bills"), icon: <FileTextOutlined />, badge: 0 },
    { key: "SHIFT" as const, short: t("pos_restaurant.rail_shift_short"), full: t("pos_restaurant.rail_shift"), icon: <SwapOutlined />, badge: 0 },
  ];

  return <main className={styles.page} ref={rootRef}>
    {/* เมนูนำทางฝั่งซ้าย — ป้ายตัวเลขบอกงานค้างของจอนั้น (โต๊ะที่ยังไม่ส่งครัว / ตั๋วในครัว)
        เพื่อให้เห็นว่าต้องไปจอไหนต่อโดยไม่ต้องเข้าไปดูทีละจอ */}
    <nav className={styles.rail} aria-label={t("pos_restaurant.rail_aria")}>
      <div className={styles.railMark} aria-hidden="true">B</div>
      {railScreens.map((item) => <button key={item.key} type="button"
        className={`${styles.railBtn} ${screen === item.key ? styles.railBtnActive : ""}`}
        aria-pressed={screen === item.key} title={item.full} aria-label={item.full}
        onClick={() => setScreen(item.key)}>
        <span className={styles.railIcon} aria-hidden="true">{item.icon}</span>
        <span className={styles.railLabel} aria-hidden="true">{item.short}</span>
        {item.badge > 0 && <span className={styles.railBadge}>{item.badge}</span>}
      </button>)}
      <div className={styles.railHelpSlot}>
        <PosGuideAssistant variant="rail" className={styles.railBtn} />
      </div>
    </nav>
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><div><h1 className={styles.title}>BMS Restaurant</h1><p className={styles.subtitle}>{session?.location?.name ?? "-"} · {session?.device.code} · {operatorReady ? (operatorName || t("pos_restaurant.operator")) : t("pos_restaurant.operator_none")}</p></div></div>
        <div className={styles.topActions}>
          {/* PIN กรอกครั้งเดียวต่อกะ — ชื่อคนอยู่ใต้ชื่อร้าน ปุ่มนี้เปิดกล่องเลือกคน/กรอก PIN */}
          <button type="button" className={styles.btn} onClick={() => setOperatorOpen(true)}>{operatorReady ? t("pos_restaurant.operator_change") : t("pos_restaurant.operator_select")}</button>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void refresh()} title={t("pos_restaurant.refresh")} aria-label={t("pos_restaurant.refresh")}><ReloadOutlined /></button>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setSupportOpen(true)} title={`Support Log (${localSupportEventCount(supportScope)})`} aria-label={`Support Log (${localSupportEventCount(supportScope)})`}><CustomerServiceOutlined /></button>
          <button type="button" className={styles.btn} onClick={() => { window.location.href = "/pos?surface=retail"; }} title={t("pos_restaurant.retail_mode_hint")}><ShopOutlined /> {t("pos_restaurant.retail_mode")}</button>
          {!session?.shift && <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!operatorReady} title={operatorReady ? t("pos_restaurant.open_shift") : t("pos_restaurant.need_operator_pin")} onClick={() => setShiftModal("OPEN")}>{t("pos_restaurant.open_shift")}</button>}
        </div>
      </header>
      {!session?.shift && <Alert type="warning" showIcon message={t("pos_restaurant.no_shift_blocker")} />}
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}
      {/* ⚠️ เสียงที่ถูกบล็อกต้อง "เห็นได้" — ของเดิมเงียบไปเฉย ๆ แล้วครัวอ่านว่าไม่มีออร์เดอร์เข้า
          เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ ซึ่งเกิดทุกครั้งที่รีเฟรชหน้า/แท็บเล็ตรีบูต */}
      {alerts.blocked && <Alert type="warning" showIcon
        message={t("pos_alerts.blocked_banner")}
        action={<Button size="small" onClick={() => alerts.preview(alerts.settings.tones.ORDER_NEW)}>{t("pos_alerts.blocked_action")}</Button>} />}

      {/* กระดานคิว — สองรายการในจอเดียว: คนที่ยังรอ (เรียงตามลำดับที่ควรได้โต๊ะ) และ
          รายการที่ปิดไปแล้ววันนี้ · "รอมากี่นาที" เป็นตัวเลขที่ตัดสินว่าลูกค้าจะอยู่ต่อหรือเดินออก
          จึงอยู่บนการ์ดทุกใบ ไม่ใช่ต้องเปิดดู */}
      {screen === "QUEUE" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}>
          <div><h2>{t("pos_restaurant.queue_title")}</h2><small>{t("pos_restaurant.queue_summary", {
            queues: waitlist.waitingCount,
            guests: waitlist.waitingGuests,
            called: waitlist.calledCount > 0 ? t("pos_restaurant.queue_called_suffix", { count: waitlist.calledCount }) : "",
          })}</small></div>
          <div className={styles.queueHeadActions}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift}
              onClick={() => { setQueueParty(2); setQueueFormOpen("WALK_IN"); }}>{t("pos_restaurant.queue_add_walkin")}</button>
            <button type="button" className={styles.btn} disabled={!session?.shift}
              onClick={() => { setQueueParty(2); setQueueReservedFor(""); setQueueFormOpen("RESERVATION"); }}>{t("pos_restaurant.queue_add_booking")}</button>
            <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void run(loadWaitlist)}
              title={t("pos_restaurant.queue_refresh")} aria-label={t("pos_restaurant.queue_refresh")}><ReloadOutlined /></button>
          </div>
        </div>
        <div className={styles.panelScroll}>
          {waitlist.entries.length === 0 && <div className={styles.empty}><p>{t("pos_restaurant.queue_empty")}</p></div>}
          <div className={styles.queueList}>
            {waitlist.entries.map((entry) => {
              const open = entry.status === "WAITING" || entry.status === "CALLED";
              // ⚠️ "รอมากี่นาที" ใช้ได้กับคิวเดินเข้าเท่านั้น — การจองที่รับไว้เมื่อวานจะกลายเป็น
              // "รอมา 1,400 นาที" ซึ่งไม่ใช่ความจริงของใครเลย · สิ่งที่คนถามถึงการจองคือเวลานัด
              // และถ้าเลยเวลานัดแล้ว เลยไปนานแค่ไหน (นั่นคือจังหวะที่ต้องตัดสินว่าจะรออีกไหม)
              const waitLabel = entry.kind === "WALK_IN"
                ? (() => { const m = minutesSince(entry.createdAt); return m == null ? "" : t("pos_restaurant.waited_minutes_suffix", { minutes: m }); })()
                : (() => {
                    const m = entry.reservedFor == null ? null : minutesSince(entry.reservedFor);
                    if (m == null) return "";
                    return m > 0 ? t("pos_restaurant.booking_late_suffix", { minutes: m }) : t("pos_restaurant.booking_time_suffix", { time: timeOf(entry.reservedFor!, uiLocale) });
                  })();
              return <div key={entry.id} className={`${styles.queueCard} ${open ? "" : styles.queueCardClosed}`}>
                <div className={styles.queueMark}>
                  {entry.kind === "WALK_IN"
                    ? <><b>{entry.queueNo}</b><small>{t("pos_restaurant.rail_queue_short")}</small></>
                    : <><ClockCircleOutlined /><small>{entry.reservedFor ? timeOf(entry.reservedFor, uiLocale) : t("pos_restaurant.queue_booking")}</small></>}
                </div>
                <div className={styles.queueBody}>
                  <b>{entry.guestName || (entry.kind === "WALK_IN" ? t("pos_restaurant.queue_kind_walkin") : t("pos_restaurant.queue_kind_booking"))} · {t("pos_restaurant.people_count", { count: entry.partySize })}</b>
                  <small>
                    {QUEUE_STATUS_LABEL[entry.status] ?? entry.status}
                    {open ? waitLabel : ""}
                    {entry.seatedTableCode ? ` · ${entry.seatedTableCode}` : ""}
                    {entry.guestPhone ? ` · ${entry.guestPhone}` : ""}
                  </small>
                  {entry.note && <small className={styles.queueNote}>{entry.note}</small>}
                </div>
                {open && <div className={styles.queueActions}>
                  {entry.status === "WAITING" && <button type="button" className={styles.btn}
                    onClick={() => void waitlistAction("call", { entryId: entry.id })}>{t("pos_restaurant.queue_call")}</button>}
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={!session?.shift || availableTables.length === 0}
                    title={availableTables.length === 0 ? t("pos_restaurant.queue_no_free_table") : t("pos_restaurant.queue_seat_hint")}
                    onClick={() => { setSeatEntry(entry); setSeatTableId(availableTables[0]?.id ?? ""); }}>{t("pos_restaurant.queue_seat")}</button>
                  <button type="button" className={styles.btn}
                    onClick={() => void waitlistAction(entry.status === "CALLED" ? "no_show" : "cancel", { entryId: entry.id })}>
                    {entry.status === "CALLED" ? t("pos_restaurant.queue_mark_no_show") : t("pos_restaurant.cancel")}
                  </button>
                </div>}
              </div>;
            })}
          </div>
        </div>
      </section></Spin>}
      {screen === "CALLS" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}>
          <div><h2>{t("pos_restaurant.service_calls_title")}</h2><small>{t("pos_restaurant.service_calls_subtitle")}</small></div>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void loadServiceCalls()} title={t("pos_restaurant.service_calls_refresh")} aria-label={t("pos_restaurant.service_calls_refresh")}><ReloadOutlined /></button>
        </div>
        <div className={styles.serviceCallGrid}>
          {serviceCalls.length === 0 && <div className={styles.empty}><p>{t("pos_restaurant.service_calls_empty")}</p></div>}
          {serviceCalls.map((call) => {
            const label = call.requestCode === "WATER" ? t("pos_restaurant.service_water")
              : call.requestCode === "CUTLERY" ? t("pos_restaurant.service_cutlery")
              : call.requestCode === "BILL" ? t("pos_restaurant.service_bill")
              : call.requestCode === "MENU_HELP" ? t("pos_restaurant.service_menu_help")
              : call.requestNote || t("pos_restaurant.service_other");
            const waiting = minutesSince(call.createdAt);
            return <article key={call.id} className={styles.serviceCallCard} data-status={call.status}>
              <div className={styles.serviceCallHead}><b><span aria-hidden="true">🔔</span> {t("pos_restaurant.service_called_from_table")}</b><span>{call.status === "PENDING" ? t("pos_restaurant.service_priority_high") : t("pos_restaurant.service_coming")}</span></div>
              <div className={styles.serviceCallBody}>
                <small>{call.tableCode}</small><strong>{call.tableName}</strong><p>{label}</p>
                <div className={styles.serviceCallElapsed}>◷ {t("pos_restaurant.service_waited", { minutes: waiting ?? 0 })}</div>
              </div>
              <div className={styles.serviceCallActions}>
                {call.status === "PENDING" ? <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!operatorReady || !session?.shift} onClick={() => void updateServiceCall(call, "acknowledge")}>{t("pos_restaurant.service_acknowledge")}</button>
                  : <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!operatorReady || !session?.shift} onClick={() => void updateServiceCall(call, "complete")}>{t("pos_restaurant.service_complete")}</button>}
              </div>
            </article>;
          })}
        </div>
      </section></Spin>}
      {screen === "QR" && <Spin spinning={working}><section className={styles.qrScreen}>
        <div className={styles.panelHeader}>
          <div><h2>{t("pos_restaurant.qr_title")}</h2><small>{t("pos_restaurant.qr_subtitle")}</small></div>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void loadQrSubmissions()} title={t("pos_restaurant.qr_refresh")} aria-label={t("pos_restaurant.qr_refresh")}><ReloadOutlined /></button>
        </div>
        <div className={styles.qrWorkspace}>
          <aside className={styles.qrQueue}>
            {qrSubmissions.length === 0 && <div className={styles.empty}>{t("pos_restaurant.qr_empty")}</div>}
            {qrSubmissions.map((submission) => {
              const total = submission.estimatedTotal;
              return <button key={submission.id} type="button"
                className={`${styles.qrCard} ${selectedQrSubmission?.id === submission.id ? styles.qrCardActive : ""}`}
                onClick={() => setQrSelectedId(submission.id)}>
                <span><b>{submission.tableCode}</b><small>{submission.tableName}</small></span>
                <span className={`${styles.qrStatus} ${styles[`qrStatus_${submission.status}`]}`}>{submission.status === "PENDING" ? t("pos_restaurant.qr_pending") : submission.status === "ACCEPTED" ? t("pos_restaurant.qr_accepted") : t("pos_restaurant.qr_rejected")}</span>
                <span className={styles.qrCardMeta}>{t("pos_restaurant.item_count", { count: submission.items.length })} · <span className={styles.baht}>฿</span>{money(total)} · {new Date(submission.submittedAt).toLocaleTimeString(uiLocale, { hour: "2-digit", minute: "2-digit" })}</span>
              </button>;
            })}
          </aside>
          <div className={styles.qrDetail}>
            {!selectedQrSubmission ? <div className={styles.empty}>{t("pos_restaurant.qr_pick_one")}</div> : <>
              <div className={styles.qrDetailHead}><div><h3>{selectedQrSubmission.tableName}</h3><small>{selectedQrSubmission.tableCode} · {t("pos_restaurant.sent_at", { time: new Date(selectedQrSubmission.submittedAt).toLocaleString(uiLocale) })}</small></div><span className={`${styles.qrStatus} ${styles[`qrStatus_${selectedQrSubmission.status}`]}`}>{selectedQrSubmission.status === "PENDING" ? t("pos_restaurant.qr_state_pending") : selectedQrSubmission.status === "ACCEPTED" ? t("pos_restaurant.qr_state_accepted") : t("pos_restaurant.qr_state_rejected")}</span></div>
              <div className={styles.qrLines}>{selectedQrSubmission.items.map((item) => <div key={item.id} className={styles.qrLine}>
                <span className={styles.qrQty}>{item.packQty}</span>
                <span><b>{item.productName}</b><small>{[item.size, item.packCode, ...(item.modifierNames.length ? item.modifierNames : item.modifierCodes)].filter(Boolean).join(" · ") || t("pos_restaurant.standard")}</small>{item.kitchenNote && <em>{t("pos_restaurant.kitchen_note_prefix")} {item.kitchenNote}</em>}</span>
                <strong><span className={styles.baht}>฿</span>{money(item.estimatedUnitPrice * item.packQty)}</strong>
              </div>)}</div>
              <div className={styles.qrTotal}><span>{t("pos_restaurant.estimated_total")}</span><b><span className={styles.baht}>฿</span>{money(selectedQrSubmission.estimatedTotal)}</b></div>
              {selectedQrSubmission.rejectionReason && <Alert type="error" showIcon message={t("pos_restaurant.qr_reject_reason")} description={selectedQrSubmission.rejectionReason} />}
              {selectedQrSubmission.status === "PENDING" && <>
                <Alert type="info" showIcon message={t("pos_restaurant.qr_accept_once")} description={t("pos_restaurant.qr_accept_once_desc")} />
                <div className={styles.qrActions}>
                  <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={!operatorReady || !session?.shift} onClick={() => { setQrRejectReason(""); setQrRejectOpen(true); }}>{t("pos_restaurant.qr_rejected")}</button>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!operatorReady || !session?.shift} onClick={() => void acceptQrSubmission(selectedQrSubmission)}>{t("pos_restaurant.qr_accept")}</button>
                </div>
              </>}
            </>}
          </div>
        </div>
      </section></Spin>}

      {screen === "BILLS" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}>
          <div><h2>{t("pos_restaurant.bills_title")}</h2><small>{t("pos_restaurant.bills_subtitle")}</small></div>
          <div className={styles.searchRow}><input className={styles.field} value={recentQuery} onChange={(event) => setRecentQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadRecentReceipts(); }} placeholder={t("pos_restaurant.bills_search_placeholder")} /><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void loadRecentReceipts()}>{t("pos_restaurant.search")}</button></div>
        </div>
        <div className={styles.receiptGrid}>
          {recentReceipts.length === 0 && <div className={styles.empty}>{t("pos_restaurant.bills_empty")}</div>}
          {recentReceipts.map((receipt) => <button type="button" className={styles.receiptCard} key={receipt.orderId} onClick={() => setSelectedReceipt(receipt)}>
            <span><b>{receipt.docNo ?? receipt.receiptNo ?? receipt.orderId.slice(0, 8)}</b><small>{new Date(receipt.soldAt).toLocaleString(uiLocale)}</small></span>
            <strong><span className={styles.baht}>฿</span>{money(receipt.total)}</strong>
            <span>{receipt.memberName ?? t("pos_restaurant.walk_in_customer")} · {t("pos_restaurant.item_count", { count: receipt.lines.length })}{billHistoryNote(receipt, t) ? ` · ${billHistoryNote(receipt, t)}` : ""}</span>
          </button>)}
        </div>
      </section></Spin>}

      {screen === "SHIFT" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}><div><h2>{t("pos_restaurant.shift_title")}</h2><small>{session?.shift ? t("pos_restaurant.opened_at", { time: new Date(session.shift.openedAt).toLocaleString(uiLocale) }) : t("pos_restaurant.shift_not_open")}</small></div><div className={styles.searchRow}><button type="button" className={styles.btn} disabled={!session?.shift || !operatorReady} title={operatorReady ? t("pos_restaurant.shift_view_open_report") : t("pos_restaurant.need_operator_pin")} onClick={() => void loadShiftReport()}>{t("pos_restaurant.view_x_report")}</button>{session?.shift && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={!operatorReady} title={operatorReady ? t("pos_restaurant.shift_close_with_count") : t("pos_restaurant.need_operator_pin")} onClick={() => setShiftModal("CLOSE")}>{t("pos_restaurant.shift_close")}</button>}</div></div>
        <div className={styles.counterGrid}>
          <article className={styles.counterCard}><h3>{t("pos_restaurant.cash_move_title")}</h3><Segmented value={cashMoveDirection} onChange={(value) => { setCashMoveDirection(value as "IN" | "OUT"); setCashMoveExternalConfirmed(false); }} options={[{ label: t("pos_restaurant.cash_in"), value: "IN" }, { label: t("pos_restaurant.cash_out"), value: "OUT" }]} /><label>{t("pos_restaurant.amount")}<input type="number" min="0.01" step="0.01" value={cashMoveAmount} onChange={(event) => setCashMoveAmount(event.target.value)} /></label><label>{t("pos_restaurant.reason")}<input value={cashMoveReason} onChange={(event) => setCashMoveReason(event.target.value)} /></label>{cashMoveDirection === "IN" && <Checkbox className={styles.cashConfirm} checked={cashMoveExternalConfirmed} onChange={(event) => setCashMoveExternalConfirmed(event.target.checked)}>{t("pos_restaurant.cash_external_confirm")}</Checkbox>}{cashMoveDirection === "OUT" && <><label>{t("pos_restaurant.approver")}<select value={cashMoveApproverId} onChange={(event) => setCashMoveApproverId(event.target.value)}><option value="">{t("pos_restaurant.approver_select")}</option>{(session?.approvers ?? []).filter((person) => person.id !== actorUserId && person.hasPin && person.approvals.includes("pos.cash.movement")).map((person) => <option key={person.id} value={person.id}>{person.name ?? person.email ?? person.id}</option>)}</select></label><label>{t("pos_restaurant.approver_pin")}<input type="password" inputMode="numeric" autoComplete="off" value={cashMoveApproverPin} onChange={(event) => setCashMoveApproverPin(event.target.value)} /></label></>}<button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift || !operatorReady || !(Number(cashMoveAmount) > 0) || !cashMoveReason.trim() || (cashMoveDirection === "IN" ? !cashMoveExternalConfirmed : !cashMoveApproverId || !cashMoveApproverPin)} title={!operatorReady ? t("pos_restaurant.need_operator_pin") : t("pos_restaurant.cash_move_submit_title")} onClick={() => void recordCashMove()}>{t("pos_restaurant.save_entry")}</button></article>
          <article className={styles.counterCard}><h3>{t("pos_restaurant.no_sale_title")}</h3><p>{t("pos_restaurant.no_sale_desc")}</p><label>{t("pos_restaurant.reason")}<input value={noSaleReason} onChange={(event) => setNoSaleReason(event.target.value)} placeholder={t("pos_restaurant.no_sale_reason_placeholder")} /></label><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift || !operatorReady || !noSaleReason.trim()} title={!operatorReady ? t("pos_restaurant.need_operator_pin") : t("pos_restaurant.no_sale_submit")} onClick={() => void recordNoSale()}>{t("pos_restaurant.no_sale_submit")}</button></article>
          <article className={`${styles.counterCard} ${styles.reportCard}`}><h3>{t("pos_restaurant.shift_report_title")}</h3>{shiftReport ? <div className={styles.summaryGrid}><span>{t("pos_restaurant.sales_total")}<b>฿{money(shiftReport.salesTotal)}</b></span><span>{t("pos_restaurant.bill_count")}<b>{shiftReport.billCount}</b></span><span>{t("pos_restaurant.returns")}<b>{shiftReport.returnCount} / ฿{money(shiftReport.returnTotal)}</b></span><span>{t("pos_restaurant.cash_in_out")}<b>฿{money(shiftReport.cashIn)} / ฿{money(shiftReport.cashOut)}</b></span><span>{t("pos_restaurant.no_sale_count")}<b>{shiftReport.noSaleCount}</b></span><span>{t("pos_restaurant.expected_cash")}<b>{shiftReport.expectedCashHidden ? t("pos_restaurant.blind_close_hidden") : `฿${money(shiftReport.expectedCash ?? 0)}`}</b></span>{shiftReport.byMethod.map((row) => <span key={row.method}>{row.method}<b>{t("pos_restaurant.bill_count_amount", { count: row.count, amount: money(row.amount) })}</b></span>)}</div> : <p>{t("pos_restaurant.shift_report_hint")}</p>}</article>
        </div>
      </section></Spin>}

      {screen === "ORDER" || screen === "FLOOR" ? <Spin spinning={working}><div className={styles.floorWrap}>
        {screen === "FLOOR" && floor.tables.length > 0 && <section className={styles.strip} aria-label={t("pos_restaurant.floor_summary")}>
          <span>{t("pos_restaurant.tables_in_use")} <b>{occupiedTables.length}</b> / {floor.tables.length}</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span>{t("pos_restaurant.open_amount")} <b><span className={styles.baht}>฿</span>{money(openAmountTotal)}</b></span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span><span className={styles.stripDot} style={{ background: "var(--red)" }} aria-hidden="true" />{t("pos_restaurant.floor_unsent_summary", { items: unsentItemTotal, tables: unsentTableCount })}</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span>{t("pos_restaurant.longest_seated")} {longestSeated ? <><b>{longestSeated.minutes}</b> {t("pos_restaurant.minutes_at_table", { table: longestSeated.code })}</> : <b>—</b>}</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span><span className={styles.stripDot} style={{ background: "var(--amber)" }} aria-hidden="true" />{t("pos_restaurant.kitchen_queue_summary", { cooking: kitchenCooking, ready: kitchenReady })}</span>
        </section>}
        <div className={styles.workspace}>
        <section className={styles.panel}>{screen === "ORDER" ? <>
          {/* จอสั่งอาหาร: แถวบิลที่เปิดอยู่ → หมวดหมู่ (station) → กริดเมนูเต็มพื้นที่
              กริดอยู่ฝั่งกว้างโดยตั้งใจ ของเดิมอยู่ในแผงขวา 300px ซึ่งการ์ดเล็กจนต้องเพ่ง */}
          <div className={styles.panelHeader}>
            <div><h2>{t("pos_restaurant.rail_order")}</h2><small>{check ? `${check.tableName} · ${t("pos_restaurant.people_count", { count: check.guestCount })}` : t("pos_restaurant.pick_table_first")}</small></div>
            <div className={styles.searchRow}>
              {/* ปุ่มล้างคำค้น: คนหน้าร้านพิมพ์ด้วยนิ้วบนแท็บเล็ต การลบทีละตัวอักษรช้ากว่าการ
                  แตะครั้งเดียวมาก และคำค้นที่ค้างอยู่ทำให้กริดเมนูดู "ของหาย" ทั้งที่แค่ยังกรองอยู่
                  · ขึ้นเฉพาะตอนมีข้อความ ไม่งั้นเป็นปุ่มที่กดแล้วไม่เกิดอะไรลอยอยู่ตลอดเวลา */}
              <div className={styles.searchField}>
                <input ref={searchRef} className={`${styles.field} ${search ? styles.fieldClearable : ""}`}
                  value={search} onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); setSearch(""); } }}
                  placeholder={t("pos_restaurant.menu_filter_placeholder")} />
                {search && <button type="button" className={styles.searchClear} aria-label={t("pos_restaurant.clear_search")}
                  title={t("pos_restaurant.clear_search")}
                  onClick={() => { setSearch(""); searchRef.current?.focus(); }}>✕</button>}
              </div>
            </div>
          </div>

          {openChecks.length > 0 && <div className={styles.billStrip} role="group" aria-label={t("pos_restaurant.open_checks")}>
            {openChecks.map(({ table, check: row, state }) => <button key={row.id} type="button"
              className={`${styles.billChip} ${check?.id === row.id ? styles.billChipActive : ""}`}
              onClick={() => void openCheckById(table, row.id)}>
              <span className={styles.billChipCode} style={{ background: state.color }}>{table.code}</span>
              <span className={styles.billChipBody}>
                <span className={styles.billChipName}>{openCheckLabel(table, row)}</span>
                <span className={styles.billChipState} style={{ color: state.color }}>{state.label}</span>
                <span className={styles.billChipMeta}>{t("pos_restaurant.people_items", { people: row.guestCount, items: row.itemCount })}</span>
              </span>
            </button>)}
          </div>}

          {!check
            ? <div className={styles.empty}><div><AppstoreOutlined style={{ fontSize: 36 }} /><h3>{t("pos_restaurant.no_table_selected")}</h3>
                <p>{openChecks.length > 0 ? t("pos_restaurant.no_table_hint") : t("pos_restaurant.no_table_hint_empty")}</p>
                <button type="button" className={styles.btn} onClick={() => setScreen("FLOOR")}><AppstoreOutlined /> {t("pos_restaurant.go_to_floor")}</button></div></div>
            : <>
              {menuStations.length > 0 && <div className={styles.catRow}>
                <button type="button" className={`${styles.catCard} ${menuCategory === "" ? styles.catCardActive : ""}`} onClick={() => setMenuCategory("")}>
                  <span className={styles.catName}>{t("pos_restaurant.all")}</span><span className={styles.catCount}>{t("pos_restaurant.menu_count", { count: menuItems.length })}</span>
                </button>
                {menuStations.map((stationName) => <button key={stationName} type="button"
                  className={`${styles.catCard} ${menuCategory === stationName ? styles.catCardActive : ""}`}
                  onClick={() => setMenuCategory(stationName)}>
                  <span className={styles.catName}>{stationName}</span>
                  <span className={styles.catCount}>{t("pos_restaurant.menu_count", { count: menuItems.filter((item) => item.kitchenStation === stationName).length })}</span>
                </button>)}
              </div>}
              {/* งานปิด/เปิดเมนูเป็นงานวันละไม่กี่ครั้ง จึงอยู่บนแถบเครื่องมือแถวเดียว
                  ไม่ใช่แถบใต้การ์ดทุกใบตลอดกะ (ซึ่งอ่านเป็น "สถานะ" มากกว่า "ปุ่ม") */}
              <div className={styles.menuTools}>
                <button type="button" aria-pressed={menuManage}
                  className={`${styles.menuTool} ${menuManage ? styles.menuToolOn : ""}`}
                  onClick={() => setMenuManage((on) => !on)}>{menuManage ? t("pos_restaurant.done") : t("pos_restaurant.mark_sold_out_mode")}</button>
                {soldOutCount > 0 && <button type="button" aria-pressed={menuOnlySoldOut}
                  className={`${styles.menuTool} ${styles.menuToolAlert} ${menuOnlySoldOut ? styles.menuToolOn : ""}`}
                  onClick={() => setMenuOnlySoldOut((on) => !on)}>{t("pos_restaurant.sold_out_count", { count: soldOutCount })}</button>}
                <span className={styles.menuToolNote}>{menuManage
                  ? t("pos_restaurant.sold_out_mode_hint")
                  : t("pos_restaurant.menu_tap_hint")}</span>
              </div>
              <div className={styles.panelScroll}>{visibleMenuItems.length === 0
                ? <div className={styles.menuEmpty}>{menuItems.length === 0
                    ? t("pos_restaurant.menu_empty")
                    : t("pos_restaurant.menu_no_match")}</div>
                : <div className={styles.dishGrid}>{visibleMenuItems.map((item) => {
                    const tint = menuCardTint(item.kitchenStation, menuStations);
                    const inCheck = qtyInCheckBySku.get(item.sku) ?? 0;
                    const soldOutToday = item.availability === "SOLD_OUT_TODAY";
                    // การ์ดที่ปิดขายต้อง "เงียบ" ไม่ใช่ดังที่สุดบนจอ — กริดนี้มีไว้สั่งอาหาร
                    // ของที่สั่งไม่ได้ควรจางลงจนตากวาดผ่าน (รูปขาวดำ + พื้นจาง + ชิปแดงเล็ก)
                    // แทนแถบแดงทึบทับรูปอาหารกับปุ่มเต็มความกว้างที่ทำให้การ์ดสูงไม่เท่าเพื่อนในแถว
                    const backAt = soldOutToday ? timeOf(item.unavailableResetsAt, uiLocale) : "";
                    const outNote = soldOutToday
                      ? [item.unavailableReason, backAt ? t("pos_restaurant.reopens_at", { time: backAt }) : null].filter(Boolean).join(" · ")
                      : t("pos_restaurant.menu_no_stock_here");
                    return <div key={item.sku} className={`${styles.dishCard} ${!item.sellable ? styles.dishCardUnavailable : ""} ${menuManage ? "" : styles.dishCardKebab}`}>
                      {/* เมนูที่ปิดวันนี้ "แตะการ์ด = เปิดขาย" — การ์ดนี้สั่งอาหารไม่ได้อยู่แล้ว
                          การแตะจึงว่างอยู่ ใช้ให้เป็นประโยชน์แทนที่จะเพิ่มปุ่มและความสูง
                          · ของที่สต็อกหมดจริงยังกดไม่ได้ เพราะไม่มีอะไรให้ "เปิด" */}
                      <button type="button" className={styles.dishSelect} disabled={!item.sellable && !soldOutToday}
                        onClick={() => { if (soldOutToday) setSoldOutSheet(item); else void chooseMenu(item); }}>
                      <span className={styles.dishArt} style={{ background: tint.bg, color: tint.ink }}>
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt="" />
                          : <span className={styles.dishGlyph} style={{ color: tint.ink }}>{dishArt(item.name, "currentColor")}</span>}
                      </span>
                      {inCheck > 0 && <span className={styles.dishQty}>{inCheck}</span>}
                      <span className={styles.dishBody}>
                        <span className={styles.dishName}>{item.name}</span>
                        {!item.sellable && outNote && <span className={styles.dishOutNote}>{outNote}</span>}
                        <span className={styles.dishFoot}>
                          <span className={styles.dishPrice}><span className={styles.baht}>฿</span>{money(item.price)}</span>
                          {soldOutToday
                            ? <span className={styles.dishTapHint}>{t("pos_restaurant.menu_tap_reopen")}</span>
                            : item.hasModifiers && <span className={styles.dishModHint}>{t("pos_restaurant.menu_has_options")}</span>}
                        </span>
                      </span>
                      {/* ชิปสถานะแทนป้ายสถานี — ตอนสั่งไม่ได้ สถานีไม่ใช่ข้อมูลที่ต้องรู้ */}
                      {!item.sellable
                        ? <span className={styles.dishOutChip}>{soldOutToday ? t("pos_restaurant.sold_out_today") : t("pos_restaurant.out_of_stock")}</span>
                        : item.kitchenStation && <span className={styles.dishStation} style={{ background: tint.bg, color: tint.ink }}>{item.kitchenStation}</span>}
                      </button>
                      {menuManage
                        ? <div className={styles.dishManageRow}>
                            <span>{soldOutToday ? t("pos_restaurant.closed_now") : t("pos_restaurant.on_sale")}</span>
                            <button type="button" className={styles.dishSwitch} aria-pressed={!soldOutToday}
                              aria-label={t("pos_restaurant.toggle_menu_sale", { name: item.name })}
                              onClick={() => void toggleMenuAvailability(item)} />
                          </div>
                        : <button type="button" className={styles.dishKebab} aria-label={t("pos_restaurant.manage_menu", { name: item.name })}
                            onClick={() => setSoldOutSheet(item)}><MoreOutlined /></button>}
                    </div>;
                  })}</div>}</div>
            </>}
        </> : floor.areas.length === 0 ? <div className={styles.setup}><div><div className={styles.setupIcon}><ShopOutlined /></div><h2>{t("pos_restaurant.floor_empty")}</h2><p>{t("pos_restaurant.floor_seed_hint")}</p><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift} onClick={() => void run(async () => { const data = await json("/api/pos/restaurant/floor", { method: "POST", body: JSON.stringify(auth({ tableCount: 12 })) }); setFloor(data); setActiveArea(data.areas[0]?.id ?? ""); })}>{t("pos_restaurant.floor_seed")}</button></div></div> : <>
          <div className={styles.panelHeader}><div><h2>{t("pos_restaurant.rail_floor")}</h2><small>{t("pos_restaurant.floor_table_counts", { free: floor.tables.filter((row) => row.status === "AVAILABLE").length, occupied: floor.tables.filter((row) => row.status === "OCCUPIED").length })}</small></div><span className={styles.livePill}>LIVE</span></div>
          <div className={styles.areaTabs}>{floor.areas.map((area) => <button key={area.id} type="button" className={`${styles.areaButton} ${activeArea === area.id ? styles.areaButtonActive : ""}`} aria-pressed={activeArea === area.id} onClick={() => setActiveArea(area.id)}>{area.name} · {floor.tables.filter((table) => table.areaId === area.id).length}</button>)}</div>
          {/* การ์ดโต๊ะตอบสามคำถามที่พนักงานถามจริง: นั่งมานานแค่ไหน · ค้างส่งครัวกี่รายการ · เสิร์ฟครบพร้อมเก็บเงินหรือยัง
              สถานะอ่านจากจุดสีที่มุมการ์ด (tableDot) + ป้ายข้อความ (tableStatus) ใต้ชื่อโต๊ะ — คำอธิบายว่า
              สีไหนหมายถึงอะไรอยู่ที่แถบ .floorLegend ท้ายผัง (ตั้งใจวางไว้ล่างสุด ไม่ใช่บนสุด: กริดโต๊ะ
              ที่พนักงานต้องกดใช้งานจริงต้องเป็นสิ่งแรกที่เห็นใต้แท็บโซน คำอธิบายเป็นของอ้างอิงเงียบ ๆ
              ไม่ใช่ส่วนควบคุม — เทียบกับ .floorLegend เดิมที่เคยอยู่ตรงนี้: ตัวเล็กลง สีจางลง ไม่มีกรอบ)
              ⚠️ เคยเปลี่ยนจากจุด 10px มาเป็นแถบเต็มความกว้าง (tableBand) เพราะจุดเดิมแยกไม่ออกจาก
              ระยะยืน — ตอนนี้กลับมาใช้จุดอีกครั้งตามที่ตัดสินใจ แต่ขยับ "วงสี" เป็น 14px + ขอบสีพื้น
              การ์ดคั่นให้ตัดกับพื้นหลังชัดขึ้น (กล่องจึงเป็น 18px เพราะ border-box กิน ring เข้าไป —
              เหตุผลเต็มอยู่ที่ .tableDot) ถ้ายังอ่านไม่ออกจากระยะไกล ให้ย้อนดูประวัตินี้ก่อนแก้ */}
          <div className={styles.panelScroll}><div className={styles.floorViewport}><div className={styles.floorCanvas} style={{ width: `max(100%, ${floorCanvasWidth}px)`, height: floorCanvasHeight }}>{visibleTables.map((table) => {
            const state = tableState(table, tableKitchenStats, t);
            const minutes = table.check ? minutesSince(table.check.openedAt) : null;
            const shape = table.shape === "rect" ? "rect" : "round";
            return <button key={table.id} type="button" disabled={table.blocked} style={{ transform: `translate(${table.positionX}px, ${table.positionY}px)` }} className={`${styles.tableCard} ${shape === "rect" ? styles.tableRect : styles.tableRound} ${table.check ? styles[`state_${state.key}`] : styles.tableFree} ${table.blocked ? styles.tableBlocked : ""} ${selectedTableId === table.id ? styles.tableSelected : ""}`} onClick={() => void chooseTable(table)}>
              <RestaurantTableChairs seats={table.seats} shape={shape} />
              {table.check && <span className={styles.tableDot} aria-hidden="true" />}
              <span className={styles.tableCode}>{table.code}</span>
              <span className={styles.tableName}>{table.name}</span>
              {table.check && <span className={styles.tableStatus}>{state.label}</span>}
              <span className={styles.tableMeta}>{table.check
                ? t("pos_restaurant.table_people_items", { people: table.check.guestCount, items: table.check.itemCount, minutes: minutes == null ? "" : t("pos_restaurant.minutes_suffix", { minutes }) })
                : t("pos_restaurant.table_free_seats", { seats: table.seats })}</span>
              {table.check && <span className={styles.tableAmount}><span className={styles.baht}>฿</span>{money(table.check.amountDue)}</span>}
              {/* โต๊ะที่แยกบิลไว้ต้องบอกจากผังเลย ไม่ใช่ให้รู้ตอนแตะแล้วเจอกล่องถาม —
                  ยอดบนการ์ดเป็นของบิลหลักใบเดียว ป้ายนี้คือเหตุผลว่าทำไมมันไม่ใช่ยอดทั้งโต๊ะ */}
              {table.checks.length > 1 && <span className={styles.tableSplitBadge}>{t("pos_restaurant.bill_count_value", { count: table.checks.length })}</span>}
            </button>;
          })}</div></div></div>
          {/* legend ต้อง "ปักหมุด" อยู่นอก panelScroll เสมอ ห้ามเอาไปไว้เป็นบรรทัดสุดท้ายในนั้น —
              เคยลองมาแล้ว: ผังที่มี 4 แถวขึ้นไปสูงเกินพื้นที่จอจริง (ไม่ใช่แค่บนเครื่องเล็ก) ทำให้
              legend ซึ่งเป็นบรรทัดท้ายสุดถูกเลื่อนลงไปครึ่ง ๆ กลาง ๆ อ่านไม่ออก ต้องเลื่อนเอาเองถึงจะ
              เห็นเต็ม ๆ — ปักไว้นอก panelScroll (เหมือน panelHeader/areaTabs) แทน จึงเห็นครบทุกตัวอักษร
              เสมอไม่ว่าโต๊ะจะเยอะแค่ไหน · scrollbar ที่ panelScroll โผล่มาแทนเมื่อผังสูงเกินจอจริง ๆ
              (ปกติ ไม่ใช่บั๊ก) — ทำให้ดูตั้งใจด้วยการปรับสไตล์ scrollbar เอง แทนแบบเทาหนาของเบราว์เซอร์ */}
          <div className={styles.floorLegend} aria-hidden="true">
            <span className={styles.floorLegendItem}><span className={styles.floorLegendDot} style={{ background: "var(--red)" }} />{t("pos_restaurant.group_unsent")}</span>
            <span className={styles.floorLegendItem}><span className={styles.floorLegendDot} style={{ background: "var(--amber)" }} />{t("pos_restaurant.legend_cooking")}</span>
            <span className={styles.floorLegendItem}><span className={styles.floorLegendDot} style={{ background: "var(--green)" }} />{t("pos_restaurant.legend_ready")}</span>
            <span className={styles.floorLegendItem}><span className={styles.floorLegendDot} style={{ background: "var(--grey)" }} />{t("pos_restaurant.legend_idle")}</span>
          </div>

        </>}</section>
        <aside className={styles.checkPanel}>{check ? <>
          {/* หัวแผง = ชื่อโต๊ะ + เวลาที่เปิด + งานที่ทำกับ "ทั้งบิล" (ย้ายมาไว้บนตามที่ออกแบบ
              เพราะสองปุ่มล่างต้องเหลือไว้ให้งานที่ทำบ่อยที่สุด: ส่งครัว กับ คิดเงิน) */}
          <div className={styles.checkHead}>
            <div className={styles.checkHeadRow}>
              <div className={styles.checkHeadText}>
                <h2>{check.tableName}{check.splitGroupNo > 1 ? t("pos_restaurant.bill_suffix", { number: check.splitGroupNo }) : ""} · {t("pos_restaurant.people_count", { count: check.guestCount })}</h2>
                <p>{check.areaName} · {t("pos_restaurant.check_open_meta", { time: timeOf(check.openedAt, uiLocale), minutes: checkMinutes == null ? "" : t("pos_restaurant.minutes_suffix", { minutes: checkMinutes }), round: lastRound ? t("pos_restaurant.latest_round_suffix", { round: lastRound }) : "" })}</p>
              </div>
              <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setMoreOpen(true)} title={t("pos_restaurant.check_actions_title")} aria-label={t("pos_restaurant.check_actions")}><MoreOutlined /></button>
            </div>
          </div>

          <div className={styles.items}>
            {check.items.length === 0 && <div className={styles.empty}><p>{t("pos_restaurant.check_empty_hint")}</p></div>}
            {itemGroups.map((group) => <Fragment key={group.key}>
              {group.items.length > 1 && <div className={styles.roundLabel}>{group.label}</div>}
              {group.items.map((item) => {
                // สองสถานะที่ต้องแยกให้ชัด ห้ามใช้คำเดียวกัน:
                //  · status CANCELLED = ตัดออกจากยอดแล้ว (ครัวยกเลิกตอนบิลยังเปิด)
                //  · ยัง SENT แต่ตั๋ว CANCELLED = ตัดอัตโนมัติไม่ได้ ยังคิดเงินอยู่จริง
                const dropped = item.status === "CANCELLED";
                const stillCharged = !dropped && item.kitchenStatus === "CANCELLED";
                // ร้านที่ปิดคิวครัวไม่มีตั๋ว = ไม่มีอะไรให้รายงาน จึงไม่ขึ้นป้าย (ไม่ใช่ขึ้นว่า "ไม่ทราบ")
                const kitchenState = !dropped && !stillCharged && item.status === "SENT" && item.kitchenStatus
                  ? LINE_KITCHEN_STATE[item.kitchenStatus] ?? null
                  : null;
                return <article className={`${styles.item} ${item.status === "NEW" ? styles.itemUnsent : ""} ${dropped ? styles.itemDropped : ""} ${stillCharged ? styles.itemKitchenCancelled : ""}`} key={item.id}>
                  <span className={styles.itemQty}>{item.packQty}</span>
                  <span>
                    <span className={styles.itemName}>{item.productName}</span>
                    {/* ทุกอย่างที่ไม่ต้องลงมือทำอยู่บรรทัดเดียวกันหมด: ไซซ์ · หน่วย · ตัวเลือก ·
                        รอบ (เฉพาะกลุ่มที่ไม่มีหัวข้อของตัวเอง) · และคำว่าถูกยกเลิกสำหรับบรรทัด
                        ที่ตัดออกจากยอดแล้ว · "ยังไม่ส่งครัว" ไม่ต้องมีป้ายซ้ำ เพราะกรอบแดง +
                        ข้อความในหัวข้อกลุ่ม/ชิป + คำเตือนท้ายแผง บอกไปแล้วสามทาง */}
                    <span className={styles.itemMeta}>
                      {[
                        item.size !== "-" ? item.size : null,
                        item.unitName,
                        ...item.modifierNames,
                        group.items.length > 1 ? null : group.chip,
                      ].filter(Boolean).join(" · ")}
                      {dropped && <b className={styles.itemDropMark}> {t("pos_restaurant.line_kitchen_dropped")}</b>}
                    </span>
                    {item.kitchenNote && <span className={styles.itemNote}>{t("pos_restaurant.kitchen_note_prefix")} {item.kitchenNote}</span>}
                    {stillCharged && <span className={styles.itemCancelTag}>{t("pos_restaurant.line_kitchen_still_charged")}</span>}
                    {kitchenState && <span className={`${styles.itemKitchenTag} ${kitchenState.loud ? styles.itemKitchenTagLoud : ""}`} style={{ color: kitchenState.color }}>{kitchenState.label}</span>}
                  </span>
                  <span className={styles.itemSide}>
                    {/* ราคาต่อหน่วยที่ server บันทึกไว้ตอนเพิ่มรายการ — ห้ามคูณ/รวมเองที่จอ
                        เพราะตัวเลือกมีส่วนต่างราคาที่ถูกคิดฝั่ง server ตอนส่งครัว */}
                    {item.packPrice != null && <span className={`${styles.itemPrice} ${dropped ? styles.itemPriceVoid : ""}`} title={t("pos_restaurant.price_per_unit", { unit: item.unitName ?? t("pos_restaurant.unit") })}><span className={styles.baht}>฿</span>{money(item.packPrice)}</span>}
                    {/* สั่งซ้ำขึ้นเฉพาะบรรทัดที่ส่งครัวไปแล้วหรือถูกยกเลิก — บรรทัด NEW ยังแก้ได้
                        ที่การ์ดเมนูตรงหน้าอยู่แล้ว และช่องนี้เป็นที่ของปุ่มลบ */}
                    {/* คำบนปุ่มเปลี่ยนตามสถานะบรรทัด: บรรทัดที่ครัวยกเลิก อาหารไม่เคยถึงลูกค้า
                        สิ่งที่คนกดกำลังทำคือ "ทำใหม่ให้" ไม่ใช่ "เอาเพิ่มอีกที่" — ไอคอน ⟳ ตัวเดียว
                        พูดสองเรื่องนี้ไม่ได้ และ ⟳ บนจอเดียวกันนี้ยังแปลว่า "รีเฟรช" อยู่อีกที่ */}
                    {item.status !== "NEW" && <button type="button" className={styles.itemAgain}
                      title={t("pos_restaurant.order_line_again_label", { name: item.productName, action: dropped || stillCharged ? t("pos_restaurant.line_new_badge") : t("pos_restaurant.line_repeat_badge") })}
                      aria-label={t("pos_restaurant.order_line_again_label", { name: item.productName, action: dropped || stillCharged ? t("pos_restaurant.line_new_badge") : t("pos_restaurant.line_repeat_badge") })}
                      disabled={working} onClick={() => void reorderLine(item)}>
                      {dropped || stillCharged ? t("pos_restaurant.order_again_new") : t("pos_restaurant.order_again")}
                    </button>}
                    {/* คอลัมน์นี้เป็นข้อความทั้งคอลัมน์ — ปุ่มเดียวที่เป็นสัญลักษณ์ทำให้ตาต้องสลับ
                        วิธีอ่านกลางคัน และ ⊗ อ่านได้ทั้ง "ลบบรรทัด" และ "ยกเลิกบิล"
                        · ไม่ต้องถามยืนยัน: บรรทัด NEW ยังไม่มีตั๋วครัว ไม่มีการจองวัตถุดิบ ไม่มีเงินขยับ
                        และเผลอลบแล้วแตะการ์ดเมนูใบเดิมก็กลับมา (ต่างจาก "ยกเลิกบิล" ที่ต้องมี PIN) */}
                    {item.status === "NEW" && <button type="button" className={styles.itemRemove}
                      aria-label={t("pos_restaurant.remove_line_label", { name: item.productName })} title={t("pos_restaurant.remove_line_label", { name: item.productName })}
                      disabled={working} onClick={() => void action("remove_item", { itemId: item.id })}>{t("pos_restaurant.remove")}</button>}
                  </span>
                </article>;
              })}
            </Fragment>)}
          </div>

          <div className={styles.checkFooter}>
            {reservationLost && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>{t("pos_restaurant.reservation_lost")}</b> — {t("pos_restaurant.reservation_lost_action")}</span></div>}
            {hasUnsent && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>{t("pos_restaurant.unsent_count", { count: unsentInCheck })}</b> — {t("pos_restaurant.unsent_action")}</span></div>}
            {/* ปกติครัวยกเลิกแล้วบรรทัดจะหลุดจากบิลทันที เหลือค้างได้เฉพาะกรณีบิลไม่ได้เปิดอยู่
                ตอนที่ครัวกด (กำลังคิดเงิน/ปิดแล้ว) ซึ่งแตะยอดที่ออกใบเสร็จไปแล้วไม่ได้ */}
            {kitchenCancelled.length > 0 && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>{t("pos_restaurant.kitchen_cancelled_count", { count: kitchenCancelled.length })}</b> — {t("pos_restaurant.kitchen_cancelled_action")}</span></div>}
            <div className={styles.total}><span className={styles.totalLabel}>{hasUnsent ? t("pos_restaurant.amount_sent") : t("pos_restaurant.amount_current")}</span><strong><span className={styles.baht}>฿</span>{money(check.amountDue)}</strong></div>
            <div className={styles.footerButtons}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!hasUnsent && !reservationLost} onClick={() => void action("send_kitchen")}><CoffeeOutlined /> {t("pos_restaurant.send_kitchen")}{unsentInCheck > 0 ? ` (${unsentInCheck})` : ""}</button>
              <button type="button" className={styles.btn} disabled={!check.items.length || hasUnsent || reservationLost || check.amountDue <= 0} onClick={() => { const cashDue = Math.round((check.amountDue + cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")) * 100) / 100; setPayments([{ id: `pay-${Date.now()}`, method: "CASH", amount: String(cashDue), tendered: String(cashDue), ref: "" }]); setCheckoutOpen(true); }}><WalletOutlined /> {t("pos_restaurant.checkout")}</button>
            </div>
          </div>
        </> : <>
          <div className={styles.checkHead}><h2>{t("pos_restaurant.open_checks_count", { count: openChecks.length })}</h2></div>
          {openChecks.length === 0
            ? <div className={styles.empty}><div><AppstoreOutlined style={{ fontSize: 36 }} /><h3>{t("pos_restaurant.no_open_check")}</h3><p>{t("pos_restaurant.no_open_check_hint")}</p></div></div>
            : <ul className={styles.openList}>{openChecks.map(({ table, check: row, state }) => <li key={row.id}>
                <button type="button" className={styles.openRow} onClick={() => void openCheckById(table, row.id)}>
                  <span className={styles.openDot} style={{ background: state.color }} aria-hidden="true" />
                  <span>
                    <span className={styles.openName}>{openCheckLabel(table, row)}</span>
                    <span className={styles.openMeta}>{state.label}{minutesSince(row.openedAt) == null ? "" : t("pos_restaurant.minutes_suffix", { minutes: minutesSince(row.openedAt)! })}</span>
                  </span>
                  <span className={styles.openAmount}><span className={styles.baht}>฿</span>{money(row.amountDue)}</span>
                </button>
              </li>)}</ul>}
          <div className={styles.hint}>{t("pos_restaurant.sort_by")} <b>{t("pos_restaurant.sort_priority")}</b>: {t("pos_restaurant.sort_order")}</div>
        </>}</aside>
      </div></div></Spin> : screen === "KITCHEN" ? <Spin spinning={working}><section className={styles.kitchenBoard}>
          {/* หัวจอเหลือแถวเดียว — ชื่อจอกับคำอธิบายไม่ช่วยคนที่ยืนทำอาหาร พื้นที่นั้นไปเป็น
              ตัวกรองสถานี ซึ่งเป็นวิธีที่ครัวแบ่งงานกันจริง (ครัวร้อน/บาร์ อยู่คนละที่) */}
          <div className={styles.kitchenBar}>
            <details className={styles.kitchenMenuAvailability}>
              <summary>{t("pos_restaurant.sold_out_count", { count: menuItems.filter((item) => item.availability === "SOLD_OUT_TODAY").length })}</summary>
              <div className={styles.kitchenMenuAvailabilityList}>
                {menuItems.map((item) => <button type="button" key={item.sku}
                  className={item.availability === "SOLD_OUT_TODAY" ? styles.kitchenMenuSoldOut : ""}
                  onClick={() => void toggleMenuAvailability(item)}>
                  <span>{item.name}{item.availability === "SOLD_OUT_TODAY" && item.unavailableReason ? ` · ${item.unavailableReason}` : ""}</span>
                  <b>{item.availability === "SOLD_OUT_TODAY" ? t("pos_restaurant.menu_reopen") : t("pos_restaurant.menu_close_today")}</b>
                </button>)}
              </div>
            </details>
            <button type="button"
              aria-pressed={stationFilter === null}
              className={`${styles.kitchenFilter} ${stationFilter === null ? styles.kitchenFilterOn : ""}`}
              onClick={() => setStationFilter(null)}>{t("pos_restaurant.all_count", { count: countKitchenDishes(tickets) })}</button>
            {stationFilters.map((filter) => {
              const key = stationFilterKey(filter);
              return <button key={key} type="button"
                aria-pressed={stationFilter === key}
                className={`${styles.kitchenFilter} ${stationFilter === key ? styles.kitchenFilterOn : ""}`}
                onClick={() => setStationFilter(key)}>
                {filter.name} {countKitchenDishes(tickets.filter((row) => ticketMatchesStation(row, filter)))}
              </button>;
            })}
            {/* ปุ่ม "ไม่ระบุสถานี" โผล่เฉพาะตอนมีของอยู่จริง — ปุ่มที่ว่างตลอดเวลาสอนให้ครัว
                เลิกอ่านตัวเลขบนแถบนี้ */}
            {unassignedOpen.length > 0 && <button type="button"
              aria-pressed={stationFilter === "UNASSIGNED"}
              className={`${styles.kitchenFilter} ${stationFilter === "UNASSIGNED" ? styles.kitchenFilterOn : ""}`}
              onClick={() => setStationFilter("UNASSIGNED")}>
              {t("pos_restaurant.no_station_count", { count: countKitchenDishes(unassignedOpen) })}
            </button>}
            <div className={styles.kitchenBarEnd}>
              {/* ⚠️ ป้ายนี้เคยแสดง "นาฬิกาของเครื่อง" (boardNow ที่เดินทุกวินาที) จึงเดินสวย
                  ตลอดแม้เน็ตตายไปแล้วสิบนาที — จอครัวที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอครัวที่
                  ไม่มีออร์เดอร์เลย ซึ่งเป็นความล้มเหลวที่แพงที่สุดของเรื่องนี้ทั้งเรื่อง
                  ตอนนี้อ่านจาก "เวลาที่โหลดสำเร็จครั้งล่าสุด" เท่านั้น */}
              <span className={`${styles.kitchenLive} ${ticketHealth === "STALE" ? styles.kitchenLiveStale : ticketHealth === "SLOW" ? styles.kitchenLiveSlow : ""}`}
                title={wakeLock.active ? t("pos_alerts.screen_awake") : undefined}>
                <span className={styles.kitchenLiveDot} aria-hidden="true" />{feedLabel}
              </span>
              <button type="button" className={`${styles.btn} ${styles.btnIcon} ${alerts.settings.enabled ? styles.kitchenChimeOn : ""}`}
                aria-pressed={alerts.settings.enabled}
                onClick={() => {
                  const next = !alerts.settings.enabled;
                  alerts.update({ enabled: next });
                  // เล่นทันทีตอนเปิด: เป็นทั้งการทดสอบลำโพงและการปลดล็อกเสียงของเบราว์เซอร์
                  // ซึ่งต้องเกิดจากการแตะของคนเท่านั้น
                  if (next) alerts.preview(alerts.settings.tones.ORDER_NEW);
                }}
                title={alerts.settings.enabled ? t("pos_restaurant.chime_off") : t("pos_restaurant.chime_on")}
                aria-label={alerts.settings.enabled ? t("pos_restaurant.chime_off") : t("pos_restaurant.chime_on")}>
                {alerts.settings.enabled ? <SoundOutlined /> : <AudioMutedOutlined />}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnIcon}`}
                onClick={() => setAlertSettingsOpen(true)}
                title={t("pos_alerts.settings")} aria-label={t("pos_alerts.settings")}><SettingOutlined /></button>
              <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void loadTickets()} title={t("pos_restaurant.queue_refresh")} aria-label={t("pos_restaurant.queue_refresh")}><ReloadOutlined /></button>
            </div>
          </div>
          <div className={styles.lanes}>{LANES.map((lane) => {
            const groups = kitchenGroups.filter((group) => group.status === lane.status);
            return <section className={styles.lane} style={{ "--lane-color": lane.color } as CSSProperties} key={lane.status}>
              <div className={styles.laneHead}><strong>{lane.label}</strong><span className={styles.laneCount}>{groups.reduce((sum, group) => sum + group.totalQty, 0)}</span></div>
              <div className={styles.laneScroll}>
                {groups.length === 0 && <div className={styles.laneEmpty}>{t("pos_restaurant.table_free")}</div>}
                {groups.map((group) => {
                  const elapsed = kitchenElapsedSeconds(group.referenceAt, boardNow);
                  const urgency = kitchenUrgency(elapsed, slaForStationRef(group, stationSlas));
                  return <article className={styles.ticket} key={group.key}>
                    <div className={styles.ticketHead}>
                      <span className={styles.ticketTable}>{group.tableLabel ?? t("pos_restaurant.no_table")}{group.roundNo == null ? "" : t("pos_restaurant.round_suffix", { round: group.roundNo })}</span>
                      {group.station && <span className={styles.tag}>{group.station}</span>}
                      {/* ตัวนับเวลาที่รอ — ของเดิมบอกแค่เวลาที่สั่ง (21:42) แล้วให้ครัวคิดเลขเอง */}
                      <span className={`${styles.ticketAge} ${urgency === "late" ? styles.ticketAgeLate : urgency === "warn" ? styles.ticketAgeWarn : ""}`}>
                        <ClockCircleOutlined /> {formatKitchenElapsed(elapsed)}
                      </span>
                    </div>
                    {group.items.map((item) => <div className={styles.ticketLine} key={item.key}>
                      <span className={styles.ticketQty}>{item.qty}×</span>
                      <span className={styles.ticketDish}>{item.productName}
                        {item.modifierCodes.length > 0 && <span className={styles.itemTags}>{item.modifierCodes.map((code) => <span className={styles.tag} key={code}>{code}</span>)}</span>}
                        {item.kitchenNote && <span className={styles.ticketNote}>{item.kitchenNote}</span>}
                      </span>
                      {item.size && item.size !== "-" && <span className={styles.ticketSize}>{item.size}</span>}
                    </div>)}
                    {/* ปุ่มหลักเต็มความกว้าง · "ยกเลิก" ย้ายไปหลังปุ่ม ⋯ เพราะของเดิมปุ่มทำลาย
                        อยู่ติดปุ่มที่กดบ่อยสุดด้วยขนาดเท่ากัน มือเปียกกดพลาดได้ */}
                    <div className={styles.ticketActions}>
                      {lane.next && <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.ticketGo}`}
                        onClick={() => void ticketGroupStatus(group, lane.next!)}>
                        {group.ticketIds.length > 1 ? t("pos_restaurant.whole_ticket_action", { action: lane.nextLabel ?? "" }) : lane.nextLabel} <ArrowRightOutlined />
                      </button>}
                      <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setGroupMenu(group)}
                        title={t("pos_restaurant.manage_this")} aria-label={t("pos_restaurant.manage_this")}><MoreOutlined /></button>
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}</div>
        </section></Spin> : null}
    </div>

    <Modal title={t("pos_restaurant.edit_guest_count_title", { table: check?.tableName ?? "" })} open={guestOpen} onCancel={() => setGuestOpen(false)} confirmLoading={working} okText={t("pos_restaurant.save")} getContainer={modalContainer}
      onOk={() => void action("set_guest_count", { guestCount: Number(guestEdit) }).then(() => setGuestOpen(false))}>
      <div className={styles.modalGrid}><label>{t("pos_restaurant.guest_count")}<input type="number" min={1} max={500} value={guestEdit} onChange={(event) => setGuestEdit(event.target.value)} /></label></div>
    </Modal>
    {/* งานที่ไม่ได้ทำบ่อยของใบนั้น อยู่หลังปุ่ม ⋯ — รวมทั้งการเลื่อน/ยกเลิก "ทีละรายการ"
        สำหรับรอบที่ครัวทำเสร็จไม่พร้อมกัน (ของทอดเสร็จก่อนแกง) ซึ่งหน้าใบไม่ควรรับภาระ */}
    <Modal title={groupMenu ? `${groupMenu.tableLabel ?? t("pos_restaurant.this_check")}${groupMenu.roundNo == null ? "" : t("pos_restaurant.round_suffix", { round: groupMenu.roundNo })}` : ""}
      open={Boolean(groupMenu)} onCancel={() => setGroupMenu(null)} footer={null}
      getContainer={modalContainer} destroyOnClose>
      {groupMenu && <div className={styles.modalGrid}>
        <div className={styles.sheetNote}>
          {groupMenu.station ?? t("pos_restaurant.no_station")} · {t("pos_restaurant.ticket_item_count", { count: groupMenu.ticketIds.length })}
        </div>
        {groupMenu.items.map((item) => {
          const next = LANES.find((lane) => lane.status === groupMenu.status)?.next ?? null;
          const one: KitchenBoardGroup = { ...groupMenu, items: [item], ticketIds: item.ticketIds };
          return <div className={styles.sheetRow} key={item.key}>
            <span className={styles.sheetRowText}>{item.qty}× {item.productName}{item.size && item.size !== "-" ? ` · ${item.size}` : ""}</span>
            {next && <button type="button" className={styles.btn} onClick={() => void ticketGroupStatus(one, next)}>
              {LANES.find((lane) => lane.status === groupMenu.status)?.nextLabel} <ArrowRightOutlined />
            </button>}
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => void ticketGroupStatus(one, "CANCELLED")}>{t("pos_restaurant.cancel")}</button>
          </div>;
        })}
        <div className={styles.sheetActions}>
          {/* กดผิดที่จอครัวเกิดจริงและบ่อย — เดิมกดพลาดเป็น "พร้อมเสิร์ฟ" แล้วแก้ไม่ได้เลย
              ย้อนได้ทีละขั้น · ใบที่ยกเลิกไปแล้วย้อนไม่ได้ (บรรทัดหลุดจากบิลไปแล้ว) */}
          {PREVIOUS_KITCHEN_STATUS[groupMenu.status] && <button type="button" className={styles.btn}
            onClick={() => void ticketGroupStatus(groupMenu, PREVIOUS_KITCHEN_STATUS[groupMenu.status]!)}>
            <ArrowLeftOutlined /> {t("pos_restaurant.go_back_to", { status: LANES.find((lane) => lane.status === PREVIOUS_KITCHEN_STATUS[groupMenu.status])?.label ?? "" })}
          </button>}
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => void ticketGroupStatus(groupMenu, "CANCELLED")}>
            <CloseCircleOutlined /> {t("pos_restaurant.cancel_whole_ticket", { count: groupMenu.ticketIds.length })}
          </button>
        </div>
      </div>}
    </Modal>
    <Modal title={t("pos_restaurant.operator")} open={operatorOpen} onCancel={() => setOperatorOpen(false)} onOk={() => setOperatorOpen(false)} okText={t("pos_restaurant.use_this_account")} okButtonProps={{ disabled: !operatorReady }} getContainer={modalContainer}>
      <div className={styles.modalGrid}>
        <Alert type="info" showIcon message={t("pos_restaurant.operator_scope_note")} />
        <label>{t("pos_restaurant.staff")}<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}><option value="">{t("pos_restaurant.staff_select")}</option>{staff.map((person) => <option key={person.id} value={person.id} disabled={!person.hasPin}>{person.name ?? person.email ?? person.id}{person.hasPin ? "" : t("pos_restaurant.no_pin_yet")}</option>)}</select></label>
        <label>PIN<input value={actorPin} onChange={(event) => setActorPin(event.target.value)} type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" /></label>
      </div>
    </Modal>
    <Modal title={t("pos_restaurant.open_check_title", { table: openTable?.name ?? "" })} open={Boolean(openTable)} onCancel={() => setOpenTable(null)} onOk={() => void openCheck()} confirmLoading={working} okText={t("pos_restaurant.open_table")} getContainer={modalContainer}><div className={styles.modalGrid}><label>{t("pos_restaurant.guest_count")}<input type="number" min={1} max={500} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} /></label></div></Modal>
    <Modal
      title={menuHit
        ? <span className={styles.menuModalTitle}>{menuHit.productName}
            <small>{menuHit.size !== "-" ? `${menuHit.size} · ` : ""}฿{money(menuHit.packPrice)} / {menuHit.unitName}</small>
          </span>
        : t("pos_restaurant.add_dish")}
      open={Boolean(menuHit)}
      onCancel={() => { setMenuHit(null); setMenuSource(null); }}
      onOk={() => void addMenu()}
      confirmLoading={working}
      okButtonProps={{ disabled: unmetModifiers.length > 0 }}
      okText={t("pos_restaurant.add_to_check_amount", { amount: money(menuHitTotal) })}
      cancelText={t("pos_restaurant.cancel")}
      getContainer={modalContainer}
    >
      {menuHit && <div className={styles.modalGrid}>
        {/* ไซซ์ต้องเลือกได้ในกล่อง — เดิม chooseMenu เลือกให้เองเงียบ ๆ แล้วโยนไซซ์ที่เหลือทิ้ง
            เมนูที่มีถ้วยเล็ก/ถ้วยใหญ่จึงสั่งได้แต่ถ้วยเล็กจากจอนี้ · ขึ้นเฉพาะเมนูที่มีมากกว่า
            หนึ่งไซซ์ ไม่งั้นเป็นแถวที่กดแล้วไม่เกิดอะไรบนทุกเมนูจานเดียว */}
        {(menuSource?.availableSizes.length ?? 0) > 1 && <div>
          <span className={styles.fieldLabel}>{t("pos_restaurant.size")}</span>
          <div className={styles.modifierChips}>
            {menuSource!.availableSizes.map((variant) => <label
              key={variant.size}
              className={`${styles.modifierChip} ${menuHit.size === variant.size ? styles.modifierChipOn : ""}`}>
              <input className={styles.modifierChipInput} type="radio" name="menu-size"
                checked={menuHit.size === variant.size}
                onChange={() => void pickMenuSize(variant.size)} />
              <span>{variant.size}</span>
            </label>)}
          </div>
        </div>}
        {/* จำนวนเป็น stepper ไม่ใช่ช่องพิมพ์ — บนแท็บเล็ตการพิมพ์เลขตัวเดียวต้องเรียกคีย์บอร์ด
            ขึ้นมาบังครึ่งจอ · ชิป 1–5 ไว้ให้โต๊ะที่สั่งทีละหลายที่ */}
        <div>
          <span className={styles.fieldLabel}>{t("pos_restaurant.quantity")}</span>
          <div className={styles.qtyRow}>
            <div className={styles.stepper}>
              <button type="button" aria-label={t("pos_restaurant.qty_minus")} disabled={menuQty <= 1}
                onClick={() => setMenuQty((current) => Math.max(1, current - 1))}>−</button>
              <span className={styles.stepperValue} aria-live="polite">{menuQty}</span>
              <button type="button" aria-label={t("pos_restaurant.qty_plus")} disabled={menuQty >= 99}
                onClick={() => setMenuQty((current) => Math.min(99, current + 1))}>+</button>
            </div>
            <div className={styles.quickQty}>
              {MENU_QTY_SHORTCUTS.map((n) => <button key={n} type="button" aria-pressed={menuQty === n}
                className={`${styles.quickQtyBtn} ${menuQty === n ? styles.quickQtyOn : ""}`}
                onClick={() => setMenuQty(n)}>{n}</button>)}
            </div>
          </div>
        </div>
        {menuHit.modifiers.length > 0 && <MenuModifierGroups modifiers={menuHit.modifiers} selected={modifierCodes} onChange={setModifierCodes} />}
        <div>
          <span className={styles.fieldLabel}>{t("pos_restaurant.kitchen_note")} <span className={styles.fieldRule}>{t("pos_restaurant.optional")}</span></span>
          {/* คำที่ครัวเจอทุกวันไม่ควรต้องพิมพ์ใหม่ทุกครั้ง — ชิปเติมข้อความให้แล้วพิมพ์ต่อได้ */}
          <div className={styles.noteChips}>
            {KITCHEN_NOTE_SHORTCUTS.map((text) => {
              const parts = kitchenNote.split(",").map((part) => part.trim()).filter(Boolean);
              const on = parts.includes(text);
              return <button key={text} type="button" aria-pressed={on}
                className={`${styles.noteChip} ${on ? styles.noteChipOn : ""}`}
                onClick={() => setKitchenNote((on ? parts.filter((part) => part !== text) : [...parts, text]).join(", "))}>
                {on ? text : `+ ${text}`}
              </button>;
            })}
          </div>
          <textarea rows={2} maxLength={300} value={kitchenNote} className={styles.noteBox}
            onChange={(event) => setKitchenNote(event.target.value)} placeholder={t("pos_restaurant.type_freely")} />
        </div>
        {/* ยอดรวมอยู่บนปุ่มด้วย (okText) — บรรทัดนี้บอก "มาจากไหน" ให้ตรวจก่อนกด */}
        <div className={styles.menuTotalRow}>
          <span>{unmetModifiers.length > 0
            ? describeUnmetModifierGroups(unmetModifiers)
            : `฿${money(menuHitUnitPrice)} × ${menuQty}${menuHitUnitPrice !== menuHit.packPrice ? t("pos_restaurant.with_options") : ` / ${menuHit.unitName}`}`}</span>
          <b><span className={styles.baht}>฿</span>{money(menuHitTotal)}</b>
        </div>
      </div>}
    </Modal>
    <Modal title={t("pos_restaurant.reject_order_title", { table: selectedQrSubmission?.tableName ?? "" })} open={qrRejectOpen}
      onCancel={() => setQrRejectOpen(false)} onOk={() => void rejectQrSubmission()}
      okText={t("pos_restaurant.confirm_reject")} okButtonProps={{ danger: true, disabled: !qrRejectReason.trim() }}
      confirmLoading={working} getContainer={modalContainer}>
      <div className={styles.modalGrid}>
        <Alert type="warning" showIcon message={t("pos_restaurant.reject_visible_note")} />
        <label>{t("pos_restaurant.reason_required")}<textarea rows={3} maxLength={300} value={qrRejectReason}
          onChange={(event) => setQrRejectReason(event.target.value)} placeholder={t("pos_restaurant.reject_reason_example")} /></label>
      </div>
    </Modal>
    <Modal title={shiftModal === "OPEN" ? t("pos_restaurant.open_shift") : t("pos_restaurant.shift_close")} open={Boolean(shiftModal)} onCancel={() => setShiftModal(null)} onOk={() => void changeShift()} confirmLoading={working} okButtonProps={{ disabled: !operatorReady }} okText={shiftModal === "OPEN" ? t("pos_restaurant.open_shift") : t("pos_restaurant.confirm_close_shift")} getContainer={modalContainer}><div className={styles.modalGrid}><Alert type={shiftModal === "OPEN" ? "info" : "warning"} message={shiftModal === "OPEN" ? t("pos_restaurant.opening_float") : t("pos_restaurant.counted_cash")} /><label>{t("pos_restaurant.amount")}<input type="number" min={0} step="0.01" value={cashAmount} onChange={(event) => setCashAmount(Number(event.target.value))} /></label></div></Modal>
    {/* กล่องนี้มีสองงานคนละชั้น: แถบสรุปคือ "งานของแคชเชียร์" (ทอนเท่าไร ครัวได้กี่ใบ
        คิดซ้ำหรือเปล่า) ส่วนกระดาษคือ "สิ่งที่ลูกค้าจะได้" — ยอด/ส่วนลด/VAT/แต้ม อยู่บน
        กระดาษที่เดียว ไม่ซ้ำกับแถบสรุป เพราะเลขเดียวกันสองที่คือจุดที่เริ่ม drift
        destroyOnClose เพราะกฎพิมพ์เล็งที่ `#pos-receipt` — ปล่อยให้ค้างสองใบใน DOM
        แล้ว print dialog จะไม่รู้ว่าต้องพิมพ์ใบไหน */}
    <Modal title={t("pos_restaurant.settled_title")} open={Boolean(settlementReceipt)} onCancel={() => setSettlementReceipt(null)} footer={null} width={620} getContainer={modalContainer} destroyOnClose>
      {settlementReceipt && <div className={styles.modalGrid}>
        <div className={styles.receiptHero}><span>{settlementReceipt.result.docNo ?? settlementReceipt.result.receiptNo ?? t("pos_restaurant.receipt")}<small>{settlementReceipt.check.tableName} · {settlementReceipt.member?.name ?? t("pos_restaurant.walk_in_customer")}</small></span><strong>฿{money(settlementReceipt.result.total)}</strong></div>
        <div className={styles.summaryGrid}><span>{t("pos_restaurant.change_due")}<b>{settlementReceipt.result.cashChange == null ? "—" : `฿${money(settlementReceipt.result.cashChange)}`}</b></span><span>{t("pos_restaurant.kitchen_tickets")}<b>{settlementReceipt.result.kitchenTickets}</b></span><span>{t("pos_restaurant.status")}<b>{settlementReceipt.result.replayed ? t("pos_restaurant.replayed") : t("pos_restaurant.amount_received")}</b></span></div>
        {receiptPayload(settlementReceipt)
          ? <ReceiptPaper payload={receiptPayload(settlementReceipt)!} />
          : <Alert type="warning" showIcon message={t("pos_restaurant.receipt_unavailable")} description={t("pos_restaurant.receipt_retry_from_bills")} />}
        <div className={styles.receiptActions}><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void printReceipt(settlementReceipt, settlementReceipt.result.cashTendered != null)}><PrinterOutlined /> {t("pos_restaurant.print_receipt")}</button></div>
        <button type="button" className={styles.btn} onClick={() => setSettlementReceipt(null)}>{t("pos_restaurant.back_to_floor")}</button>
      </div>}
    </Modal>
    {/* กล่องนี้เคยโชว์รายการสินค้าอย่างเดียว ไม่โชว์ส่วนลด/VAT ทั้งที่ response มีให้แล้ว
        · `lineTotal` คือราคาป้ายก่อนหักราคาส่ง/โปร (9.22) บิลที่ติดโปรจึงแสดงรายการที่
        บวกแล้ว **ไม่เท่ายอดรวม** โดยไม่มีอะไรอธิบาย — ตอนนี้เรนเดอร์กระดาษจริงทั้งใบแทน */}
    <Modal title={selectedReceipt && !("result" in selectedReceipt) ? selectedReceipt.docNo ?? t("pos_restaurant.bill_details") : t("pos_restaurant.bill_details")} open={Boolean(selectedReceipt)} onCancel={() => setSelectedReceipt(null)} footer={null} width={620} getContainer={modalContainer} destroyOnClose>
      {selectedReceipt && !("result" in selectedReceipt) && <div className={styles.modalGrid}>
        {billHistoryNote(selectedReceipt, t) && <Alert type="warning" showIcon message={t("pos_restaurant.bill_history_message", { status: billHistoryNote(selectedReceipt, t) })} description={t("pos_restaurant.bill_history_description")} />}
        {receiptPayload(selectedReceipt)
          ? <ReceiptPaper payload={receiptPayload(selectedReceipt)!} />
          : <Alert type="warning" showIcon message={t("pos_restaurant.receipt_unavailable")} description={t("pos_restaurant.receipt_incomplete_prices")} />}
        <div className={styles.receiptActions}><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void printReceipt(selectedReceipt)}><PrinterOutlined /> {billHistoryNote(selectedReceipt, t) ? t("pos_restaurant.print_original_sale") : t("pos_restaurant.reprint")}</button></div>
      </div>}
    </Modal>
    <Modal
      title={t("pos_restaurant.support_diagnostics")}
      open={supportOpen}
      onCancel={() => { if (!supportWorking) setSupportOpen(false); }}
      getContainer={modalContainer}
      footer={[
        <Button key="cancel" disabled={Boolean(supportWorking)} onClick={() => setSupportOpen(false)}>{t("pos_restaurant.cancel")}</Button>,
        <Button key="export" icon={<DownloadOutlined />} loading={supportWorking === "export"} disabled={Boolean(supportWorking)} onClick={() => void supportAction("export")}>Export Log</Button>,
        <Button key="send" type="primary" icon={<CustomerServiceOutlined />} loading={supportWorking === "send"} disabled={Boolean(supportWorking) || !supportConfirmed} onClick={() => void supportAction("send")}>{t("pos_restaurant.send_to_support")}</Button>,
      ]}
    >
      <Alert type="info" showIcon message={t("pos_restaurant.support_scope")} />
      <Input.TextArea style={{ marginTop: 16 }} rows={4} maxLength={2000} showCount value={supportDescription} onChange={(event) => setSupportDescription(event.target.value)} placeholder={t("pos_restaurant.support_description_placeholder")} />
      <Checkbox style={{ marginTop: 12 }} checked={supportConfirmed} onChange={(event) => setSupportConfirmed(event.target.checked)}>{t("pos_restaurant.support_consent")}</Checkbox>
    </Modal>
    <Modal title={t("pos_restaurant.take_payment_title", { table: check?.tableName ?? "" })} open={checkoutOpen} onCancel={() => setCheckoutOpen(false)} onOk={() => void settle()} confirmLoading={working} okText={t("pos_restaurant.confirm_payment")} okButtonProps={{ disabled: Boolean(checkoutBlock) }} width={680} getContainer={modalContainer}>{check && <div className={styles.modalGrid}>
      <div className={styles.memberBox}><b>{t("pos_restaurant.member_optional")}</b>{memberLoyalty && memberLoyalty.pointsForAmount != null && memberLoyalty.pointsForAmount > 0 ? <small className={styles.memberEarnHint}>{t("pos_restaurant.points_will_earn", { points: memberLoyalty.pointsForAmount })}</small> : memberLoyalty?.block ? <small className={styles.memberEarnWarn}>{earnBlockText(memberLoyalty.block)}</small> : null}{checkMember ? <div className={styles.memberSelected}><span>{checkMember.name} · {checkMember.memberNo ?? checkMember.phone ?? t("pos_restaurant.member")}<small>{t("pos_restaurant.points_available", { points: checkMember.pointsUsable })}</small></span><button type="button" className={styles.btn} onClick={() => setSelectedMember(null)}>{t("pos_restaurant.remove")}</button></div> : <><div className={styles.searchRow}><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchMembers(); } }} placeholder={t("pos_restaurant.member_search_placeholder")} /><button type="button" className={styles.btn} onClick={() => void searchMembers()}>{t("pos_restaurant.search")}</button></div>{memberResults.map((member) => <button type="button" className={styles.memberResult} key={member.customerId} onClick={() => setSelectedMember(member)}><span>{member.name}<small>{member.memberNo ?? member.phone ?? ""}</small></span><b>{t("pos_restaurant.points_count", { points: member.pointsUsable })}</b></button>)}</>}</div>
      <div className={styles.total}><span>{t("pos_restaurant.amount_due")}</span><strong><span className={styles.baht}>฿</span>{money(checkoutDue)}</strong></div>{payments.map((payment, index) => <div className={styles.modalGrid} key={payment.id}><label>{t("pos_restaurant.payment_method")}<select value={payment.method} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, method: event.target.value, tendered: "", ref: "" } : row))}><option value="CASH">{t("pos_restaurant.payment_cash")}</option><option value="QR">{t("pos_restaurant.payment_qr")}</option><option value="CARD">{t("pos_restaurant.payment_card")}</option></select></label><label>{t("pos_restaurant.channel_amount")}<input type="number" min={0.01} step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => rebalanceSplitPayments(current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value } : row), payment.id, checkoutDue))} /></label>{payment.method === "CASH" ? <label>{t("pos_restaurant.cash_tendered")}<input type="number" min={Number(payment.amount) || 0} step="0.01" value={payment.tendered} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, tendered: event.target.value } : row))} />
        {/* เงินทอนต้องเห็น "ตอนถือเงินลูกค้าอยู่ในมือ" ไม่ใช่หลังกดยืนยันไปแล้ว — หน้าค้าปลีก
            แสดงมาตลอด (`เงินทอนรายการนี้`) หน้านี้เคยให้แคชเชียร์คิดเองหรือรอดูในใบเสร็จ
            · ขึ้นเฉพาะตอนกรอกครบและไม่ติดกฎ ไม่งั้นจะโชว์เลขทอนของยอดที่ยังผิดอยู่ */}
        {cashChangeOf(payment) != null && <span className={styles.cashChange}>{t("pos_restaurant.payment_change")} <b>฿{money(cashChangeOf(payment)!)}</b></span>}</label> : <label>{t("pos_restaurant.reference_no")}<input value={payment.ref} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, ref: event.target.value } : row))} /></label>}{payments.length > 1 && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setPayments((current) => current.filter((row) => row.id !== payment.id))}>{t("pos_restaurant.remove_payment_channel", { number: index + 1 })}</button>}</div>)}<button type="button" className={styles.btn} onClick={() => setPayments((current) => appendSplitPaymentRow(current, check.amountDue, `pay-${Date.now()}`))}>{t("pos_restaurant.add_payment_channel")}</button><Alert type={checkoutBlock ? "warning" : "success"} showIcon message={checkoutBlock ? t("pos_restaurant.payment_total_blocked", { amount: money(paymentTotal), reason: checkoutBlock }) : t("pos_restaurant.payment_total_complete", { amount: money(paymentTotal) })} /></div>}</Modal>
    <Modal title={t("pos_restaurant.manage_check_title", { table: check?.tableName ?? "" })} open={moreOpen} onCancel={() => setMoreOpen(false)} footer={null} getContainer={modalContainer}>
      <div className={styles.sheetActions}>
        <button type="button" className={styles.btn} onClick={() => { setMoreOpen(false); setTargetTableId(availableTables[0]?.id ?? ""); setMoveOpen(true); }}><SwapOutlined /> {t("pos_restaurant.move_table")}</button>
        <button type="button" className={styles.btn} disabled={!checkIsOpen || splittableItems.length < 2}
          title={splittableItems.length < 2 ? t("pos_restaurant.split_needs_two") : t("pos_restaurant.split_hint")}
          onClick={() => { setMoreOpen(false); setSplitItemIds([]); setSplitOpen(true); }}><ScissorOutlined /> {t("pos_restaurant.split_check")}</button>
        <button type="button" className={styles.btn} disabled={!checkIsOpen || mergeTargets.length === 0}
          title={mergeTargets.length === 0 ? t("pos_restaurant.merge_no_target") : t("pos_restaurant.merge_hint")}
          onClick={() => { setMoreOpen(false); setMergeTargetId(mergeTargets[0]?.id ?? ""); setMergeOpen(true); }}><MergeCellsOutlined /> {t("pos_restaurant.merge_into_another")}</button>
        <button type="button" className={styles.btn} onClick={() => { setMoreOpen(false); setGuestEdit(String(check?.guestCount ?? 1)); setGuestOpen(true); }}>{t("pos_restaurant.edit_guest_count")}</button>
        <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => { setMoreOpen(false); openCancel(); }}><CloseCircleOutlined /> {t("pos_restaurant.cancel_check")}</button>
      </div>
    </Modal>
    {/* ปิดขายเป็นงานที่ย้อนคืนยาก (เมนูหายจากทุกช่องทางของสาขานี้ทันที) จึงมีจังหวะยืนยัน
        หนึ่งครั้งพร้อมเลือกสาเหตุ — แต่ยังจบใน 2 แตะ เท่ากับแถบเดิมที่กดพลาดได้ */}
    <Modal title={soldOutSheet
        ? t("pos_restaurant.menu_availability_title", { action: soldOutSheet.availability === "SOLD_OUT_TODAY" ? t("pos_restaurant.closed_now") : t("pos_restaurant.close_sale"), name: soldOutSheet.name })
        : ""}
      open={Boolean(soldOutSheet)}
      onCancel={() => setSoldOutSheet(null)} footer={null} getContainer={modalContainer} destroyOnClose>
      {soldOutSheet && <div className={styles.sheetActions}>
        {soldOutSheet.availability === "SOLD_OUT_TODAY"
          ? <>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => { const item = soldOutSheet; setSoldOutSheet(null); void setMenuAvailability(item, false); }}>
                {t("pos_restaurant.reopen_now")}
              </button>
              <div className={styles.sheetNote}>
                {[soldOutSheet.unavailableReason ? t("pos_restaurant.closed_because", { reason: soldOutSheet.unavailableReason }) : null,
                  soldOutSheet.unavailableResetsAt ? t("pos_restaurant.reopens_automatically", { time: timeOf(soldOutSheet.unavailableResetsAt, uiLocale) }) : null]
                  .filter(Boolean).join(" · ") || t("pos_restaurant.branch_only")}
              </div>
            </>
          : <>
              {MENU_SOLD_OUT_REASONS.map((reason) => <button key={reason} type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => { const item = soldOutSheet; setSoldOutSheet(null); void setMenuAvailability(item, true, reason); }}>
                <CloseCircleOutlined /> {t("pos_restaurant.close_today_reason", { reason })}
              </button>)}
              <div className={styles.sheetNote}>
                {t("pos_restaurant.branch_close_explanation")}
              </div>
            </>}
      </div>}
    </Modal>
    {/* เลือกบิลของโต๊ะที่แยกไว้ — ปุ่มละใบ พร้อมยอดและจำนวนรายการ เพราะสิ่งที่คนจำได้คือ
        "โต๊ะนี้ใบของกลุ่มที่สั่งเบียร์" ไม่ใช่เลขใบ */}
    <Modal title={t("pos_restaurant.table_bill_count", { table: billPickerTable?.name ?? "", count: billPickerTable?.checks.length ?? 0 })}
      open={Boolean(billPickerTable)} onCancel={() => setBillPickerTable(null)} footer={null}
      getContainer={modalContainer} destroyOnClose>
      <div className={styles.sheetActions}>
        {(billPickerTable?.checks ?? []).map((row) => <button key={row.id} type="button" className={styles.btn}
          onClick={() => { const table = billPickerTable; setBillPickerTable(null); if (table) void openCheckById(table, row.id); }}>
          {t("pos_restaurant.bill_picker_option", { bill: row.splitGroupNo, items: row.itemCount, amount: money(row.amountDue), unsent: row.unsentCount > 0 ? t("pos_restaurant.unsent_suffix", { count: row.unsentCount }) : "" })}
        </button>)}
        <div className={styles.sheetNote}>{t("pos_restaurant.split_table_note")}</div>
      </div>
    </Modal>
    <Modal title={t("pos_restaurant.split_check_title", { table: check?.tableName ?? "" })} open={splitOpen} onCancel={() => setSplitOpen(false)}
      onOk={() => void splitCheck()} confirmLoading={working} okText={t("pos_restaurant.split_to_new")}
      okButtonProps={{ disabled: splitItemIds.length === 0 || splitItemIds.length >= splittableItems.length }}
      getContainer={modalContainer} destroyOnClose>
      <div className={styles.modalGrid}>
        <Alert type="info" showIcon message={t("pos_restaurant.split_select_lines")}
          description={t("pos_restaurant.split_description")} />
        <div className={styles.splitList}>
          {splittableItems.map((item) => {
            const picked = splitItemIds.includes(item.id);
            return <label key={item.id} className={`${styles.splitRow} ${picked ? styles.splitRowOn : ""}`}>
              <input type="checkbox" checked={picked}
                onChange={(event) => setSplitItemIds((current) => event.target.checked
                  ? [...current, item.id]
                  : current.filter((id) => id !== item.id))} />
              <span className={styles.splitName}>{item.productName}{item.packQty > 1 ? ` × ${item.packQty}` : ""}
                {item.modifierNames.length ? <small>{item.modifierNames.join(" · ")}</small> : null}
                <small>{item.status === "NEW" ? t("pos_restaurant.group_unsent") : t("pos_restaurant.round", { round: item.roundNo ?? 1 })}</small>
              </span>
              {item.lineAmount != null && <b>฿{money(item.lineAmount)}</b>}
            </label>;
          })}
        </div>
        {splitItemIds.length >= splittableItems.length && splittableItems.length > 0 &&
          <Alert type="warning" showIcon message={t("pos_restaurant.split_keep_one")} />}
      </div>
    </Modal>
    <Modal title={t("pos_restaurant.merge_check_title", { table: check?.tableName ?? "" })} open={mergeOpen} onCancel={() => setMergeOpen(false)}
      onOk={() => void mergeCheck()} confirmLoading={working} okText={t("pos_restaurant.merge_check")}
      okButtonProps={{ disabled: !mergeTargetId }} getContainer={modalContainer} destroyOnClose>
      <div className={styles.modalGrid}>
        {/* ⚠️ ห้ามเขียนว่า "โต๊ะจะว่างทันที" ลอย ๆ — รวมบิล 1 เข้าบิล 2 ของโต๊ะเดียวกัน
            โต๊ะนั้นยังมีคนนั่งอยู่ · ข้อความที่จริงเฉพาะบางกรณีคือข้อความที่สอนให้คนเลิกอ่าน */}
        <Alert type="warning" showIcon message={t("pos_restaurant.merge_warning")}
          description={t("pos_restaurant.merge_description")} />
        <label>{t("pos_restaurant.destination_check")}
          <select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
            {mergeTargets.map((row) => <option key={row.id} value={row.id}>
              {row.label}
            </option>)}
          </select>
        </label>
      </div>
    </Modal>
    <Modal title={queueFormOpen === "RESERVATION" ? t("pos_restaurant.reserve_table_title") : t("pos_restaurant.walkin_title")}
      open={Boolean(queueFormOpen)} onCancel={() => setQueueFormOpen(null)}
      onOk={() => void addWaitlistEntry()} confirmLoading={working}
      okText={queueFormOpen === "RESERVATION" ? t("pos_restaurant.save_reservation") : t("pos_restaurant.issue_queue_ticket")}
      okButtonProps={{ disabled: queueFormOpen === "RESERVATION" && !queueReservedFor }}
      getContainer={modalContainer} destroyOnClose>
      <div className={styles.modalGrid}>
        <label>{t("pos_restaurant.guest_count")}<input type="number" min={1} max={500} value={queueParty}
          onChange={(event) => setQueueParty(Number(event.target.value))} /></label>
        {queueFormOpen === "RESERVATION" && <label>{t("pos_restaurant.reservation_datetime")}<input type="datetime-local"
          value={queueReservedFor} onChange={(event) => setQueueReservedFor(event.target.value)} /></label>}
        <label>{t("pos_restaurant.customer_name_optional")}<input value={queueName} maxLength={120}
          onChange={(event) => setQueueName(event.target.value)} placeholder={t("pos_restaurant.customer_name_example")} /></label>
        <label>{t("pos_restaurant.phone_optional")}<input value={queuePhone} maxLength={40} inputMode="tel"
          onChange={(event) => setQueuePhone(event.target.value)} /></label>
        <label>{t("pos_restaurant.note_optional")}<textarea rows={2} maxLength={300} value={queueNote}
          onChange={(event) => setQueueNote(event.target.value)} placeholder={t("pos_restaurant.queue_note_example")} /></label>
      </div>
    </Modal>
    <Modal title={seatEntry ? t("pos_restaurant.seat_party_title", { count: seatEntry.partySize }) : ""} open={Boolean(seatEntry)}
      onCancel={() => setSeatEntry(null)} onOk={() => void seatWaitlistEntry()} confirmLoading={working}
      okText={t("pos_restaurant.open_table_now")} okButtonProps={{ disabled: !seatTableId }}
      getContainer={modalContainer} destroyOnClose>
      <div className={styles.modalGrid}>
        <Alert type="info" showIcon message={t("pos_restaurant.seat_opens_check")}
          description={t("pos_restaurant.seat_guest_count_note")} />
        {seatEntry?.preferredTableCode && <Alert type="warning" showIcon
          message={t("pos_restaurant.preferred_table", { table: seatEntry.preferredTableCode })}
          description={t("pos_restaurant.preferred_table_note")} />}
        <label>{t("pos_restaurant.free_table")}
          <select value={seatTableId} onChange={(event) => setSeatTableId(event.target.value)}>
            {availableTables.map((table) => <option key={table.id} value={table.id}>
              {table.name} · {table.code} · {t("pos_restaurant.seat_count", { count: table.seats })}
            </option>)}
          </select>
        </label>
      </div>
    </Modal>
    <Modal title={t("pos_restaurant.move_table")} open={moveOpen} onCancel={() => setMoveOpen(false)} onOk={() => void action("move", { targetTableId }).then(() => setMoveOpen(false))} confirmLoading={working} okText={t("pos_restaurant.move")} getContainer={modalContainer}><div className={styles.modalGrid}><label>{t("pos_restaurant.destination_table")}<select value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.code}</option>)}</select></label></div></Modal>
    <Modal title={t("pos_restaurant.cancel_check_title", { table: check?.tableName ?? "" })} open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => void cancelCheck()} confirmLoading={working} okText={t("pos_restaurant.confirm_cancel")} okButtonProps={{ danger: true }} getContainer={modalContainer}><div className={styles.modalGrid}>{cancelNeedsApproval && <Alert type="warning" showIcon message={t("pos_restaurant.cancel_requires_approval")} description={t("pos_restaurant.cancel_approval_description")} />}<label>{t("pos_restaurant.cancel_reason_label")}<textarea rows={3} maxLength={300} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={t("pos_restaurant.cancel_reason_example")} /></label>{cancelNeedsApproval && <><label>{t("pos_restaurant.approver")}<select value={cancelApproverId} onChange={(event) => setCancelApproverId(event.target.value)}><option value="">{t("pos_restaurant.approver_select")}</option>{voidApprovers.map((person) => <option key={person.id} value={person.id}>{person.name || person.email || person.id}</option>)}</select></label><label>{t("pos_restaurant.approver_pin")}<input type="password" inputMode="numeric" autoComplete="off" value={cancelApproverPin} onChange={(event) => setCancelApproverPin(event.target.value)} /></label>{voidApprovers.length === 0 && <Alert type="error" showIcon message={t("pos_restaurant.no_approver")} description={t("pos_restaurant.no_approver_description")} />}</>}</div></Modal>
    <OrderAlertSettingsModal open={alertSettingsOpen} onClose={() => setAlertSettingsOpen(false)}
      alerts={alerts} kinds={RESTAURANT_ALERT_KINDS} />
  </main>;
}
