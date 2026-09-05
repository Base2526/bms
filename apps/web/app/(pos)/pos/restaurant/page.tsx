"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, AudioMutedOutlined, ClockCircleOutlined, CloseCircleOutlined, CoffeeOutlined, CustomerServiceOutlined, DownloadOutlined, FileTextOutlined, MoreOutlined, PrinterOutlined, ReloadOutlined, ShopOutlined, SoundOutlined, SwapOutlined, WalletOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, Modal, Segmented, Spin, Tag, message } from "antd";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
import { appendSplitPaymentRow, checkoutBlockReason, type PosPaymentDraft } from "@/lib/pos/paymentDraft";
import { describePosFailure, describeTransportFailure } from "@/lib/pos/failureMessage";
import { describeUnmetModifierGroups, unmetModifierGroups } from "@/lib/pos/modifierSelection";
import { buildDrawerKick, buildReceipt, type ReceiptLine, type ReceiptPayload } from "@/lib/pos/escpos";
import { findRememberedPrinter, isWebUsbSupported, requestPrinter, sendToPrinter } from "@/lib/pos/printerClient";
import ReceiptPaper from "@/components/pos/ReceiptPaper";
import { posPaymentMethodLabel, receiptDocumentTitle, receiptLocale, type ReceiptLanguageMode } from "@/lib/pos/receiptI18n";
import { useI18n } from "@/lib/i18nContext";
import { flushSupportActivity, localSupportEventCount, recordSupportActivity } from "@/lib/supportActivity";
import PosGuideAssistant from "@/components/work-assistant/PosGuideAssistant";
import {
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenBoardStationFilters,
  kitchenElapsedSeconds,
  countKitchenDishes,
  kitchenUrgency,
  slaForStationRef,
  ticketMatchesStation,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenBoardGroup,
  type KitchenSla,
  type KitchenStationFilter,
} from "@/lib/bms/kitchenBoard";
import styles from "./restaurant.module.css";

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
type RestaurantScreen = "ORDER" | "FLOOR" | "KITCHEN" | "BILLS" | "SHIFT";
const RESTAURANT_SCREENS: RestaurantScreen[] = ["ORDER", "FLOOR", "KITCHEN", "BILLS", "SHIFT"];
// จอครัวที่ติดผนังต้องปักหมุดลิงก์ได้ — ?screen=kitchen ชนะค่าที่จำไว้เสมอ จึงตรงแม้
// เครื่องนั้นล้าง site data หรือเปิดในโหมดส่วนตัว (ล้อรูปแบบ ?surface=retail ที่มีอยู่แล้ว)
//
// **ห้ามเขียนจอที่เปิดอยู่กลับลง URL** — เคยลองแล้วพัง: พอ replaceState ใส่ ?screen= ให้เอง
// ทุกครั้งที่สลับจอ การโหลดครั้งถัดไป *ทุกครั้ง* จะดูเหมือนลิงก์ที่คนตั้งใจปักหมุด แล้ว
// การคืนค่าอื่น (บิลที่ทำอยู่) ถูกข้ามไปเงียบ ๆ · พารามิเตอร์นี้ต้องมีเมื่อ "คนตั้งใจใส่" เท่านั้น
const SCREEN_FROM_URL: Record<string, RestaurantScreen> = {
  order: "ORDER", sell: "ORDER", floor: "FLOOR", table: "FLOOR", tables: "FLOOR", kitchen: "KITCHEN", kds: "KITCHEN", bills: "BILLS", receipts: "BILLS", shift: "SHIFT",
};
const OPEN_CHECK_STATUSES = ["OPEN", "CLOSING"];
const isOpenCheckStatus = (status: string | null | undefined) => OPEN_CHECK_STATUSES.includes(status ?? "");
type Staff = { id: string; name: string | null; email: string | null; hasPin: boolean };
type Session = { device: { id: string; code: string; name: string | null; registeredPosNo?: string | null }; location: { id: string; name: string; branchCode: string } | null; shift: { id: string; openedAt: string; openingFloat: number } | null; cashiers: Staff[]; approvers: Array<Staff & { approvals: string[] }>; kitchenOperators: Staff[]; businessArchetype?: string | null; store?: { taxId: string | null; receiptLanguageMode: ReceiptLanguageMode }; vat: { registered?: boolean; priceIncludesVat?: boolean; rate?: number; cashRounding?: CashRounding } };
type FloorCheck = { id: string; status: string; guestCount: number; amountDue: number; openedAt: string; itemCount: number; unsentCount: number; version: number; reservedVersion: number | null };
type DiningTable = { id: string; areaId: string; code: string; name: string; seats: number; blocked: boolean; status: "AVAILABLE" | "OCCUPIED" | "BLOCKED"; check: FloorCheck | null };
type Floor = { areas: Array<{ id: string; name: string; sortOrder: number }>; tables: DiningTable[] };
type CheckItem = { id: string; sku: string; productName: string; size: string; packQty: number; packCode: string | null; unitName: string | null; packPrice: number | null; lineAmount: number | null; modifierCodes: string[]; modifierNames: string[]; kitchenNote: string | null; status: "NEW" | "SENT" | "CANCELLED"; roundNo: number | null; sentAt: string | null; kitchenStatus: string | null };
type RestaurantCheck = { id: string; tableId: string; tableCode: string; tableName: string; areaName: string; status: string; guestCount: number; amountDue: number; version: number; reservedVersion: number | null; hasCurrentOrder: boolean; reservationStatus: string | null; reservationLost: boolean; openedAt: string; items: CheckItem[] };
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
type PosMember = { customerId: string; name: string; phone: string | null; memberNo: string | null; pointsBalance: number; pointsUsable: number; tier: { code: string; name: string } | null };
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
function billHistoryNote(receipt: RecentReceipt): string {
  if (receipt.voidedAt) return "ถูกยกเลิกแล้ว";
  if (receipt.orderStatus === "RETURNED") return "มีการคืนสินค้า";
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
const MENU_SOLD_OUT_REASONS = ["วัตถุดิบหมด", "เตา/เครื่องไม่พร้อม", "งดขายรอบนี้"] as const;
const MENU_QTY_SHORTCUTS = [1, 2, 3, 5] as const;
const KITCHEN_NOTE_SHORTCUTS = ["ไม่เผ็ด", "แยกน้ำ", "ไม่ใส่ผัก", "ไม่ใส่ถั่ว"] as const;
// สีการ์ดวนตาม station ตามลำดับที่เจอก่อน-หลัง ไม่ผูกกับชื่อ station ตายตัว
// เพราะแต่ละร้านตั้งชื่อ station เองอิสระ (ครัวร้อน/ครัวต้ม/HOT/COLD ฯลฯ)
const MENU_CARD_TINTS = [
  { bg: "var(--panel-2)", ink: "var(--accent)" },
  { bg: "var(--red-bg)", ink: "var(--red)" },
  { bg: "var(--amber-bg)", ink: "var(--amber)" },
  { bg: "var(--green-bg)", ink: "var(--green)" },
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
      single || meta.maxSelect === 1 ? "เลือกได้ 1"
        : meta.maxSelect != null ? `เลือกได้ไม่เกิน ${meta.maxSelect}`
        : "เลือกได้หลายอย่าง",
      meta.minSelect > 0 ? `ต้องเลือกอย่างน้อย ${meta.minSelect}` : null,
    ].filter(Boolean).join(" · ");
    // กลุ่มที่ยังไม่ครบต้องบอกที่ตัวมันเอง — เมนูที่มีหลายกลุ่ม ข้อความรวมท้ายกล่องไม่ชี้ว่าอันไหน
    const needsPick = selectedInGroup.length < meta.minSelect;
    return <fieldset key={meta.groupCode} className={styles.modifierGroup}>
      <legend className={styles.fieldLabel}>{meta.groupName} <span className={styles.fieldRule}>· {rule}</span>
        {needsPick && <span className={styles.fieldNeeded}> · ยังไม่ได้เลือก</span>}
      </legend>
      {/* ชิปแทนกล่องเต็มแถว — เมนูที่มี 4–5 ตัวเลือกไม่ต้องเลื่อนกล่องอีก · ยังเป็น
          radio/checkbox จริงข้างใน (ซ่อนไว้) จึงคุมด้วยคีย์บอร์ดและอ่านด้วย screen reader ได้ */}
      <div className={styles.modifierChips}>
        {items.map((modifier) => {
          const checked = selected.includes(modifier.code);
          const atLimit = meta.maxSelect != null && selectedInGroup.length >= meta.maxSelect;
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

const LANES = [
  { status: "NEW", label: "เข้าใหม่", color: "#dd5d3d", next: "PREPARING", nextLabel: "เริ่มทำ" },
  { status: "PREPARING", label: "กำลังทำ", color: "#e7a335", next: "READY", nextLabel: "พร้อมเสิร์ฟ" },
  { status: "READY", label: "พร้อมเสิร์ฟ", color: "#30745b", next: "SERVED", nextLabel: "เสิร์ฟแล้ว" },
  { status: "SERVED", label: "เสิร์ฟแล้ว", color: "#718078", next: null, nextLabel: null },
] as const;
const timeOf = (iso: string | null) => {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
};
/**
 * สถานะโต๊ะหนึ่งชุด ใช้ทั้งการ์ดบนผังและรายการบิลที่เปิดอยู่
 * `rank` = ลำดับที่ต้องไปก่อน (0 = ด่วนสุด) — ของที่ยังไม่ถึงครัวมาก่อนเสมอ
 * ตามด้วยของที่ครัวทำเสร็จแล้วรอคนยกไปเสิร์ฟ (ยิ่งช้ายิ่งเย็น)
 */
type TableStateKey = "unsent" | "ready" | "cooking" | "served" | "idle";
function tableState(
  table: DiningTable,
  kitchen: Map<string, { cooking: number; ready: number }>
): { key: TableStateKey; label: string; rank: number; color: string } {
  const check = table.check;
  const stats = check ? kitchen.get(check.id) : undefined;
  if (!check) return { key: "idle", label: "", rank: 99, color: "var(--grey)" };
  if (check.unsentCount > 0) return { key: "unsent", label: `ยังไม่ส่งครัว ${check.unsentCount}`, rank: 0, color: "var(--red)" };
  if ((stats?.ready ?? 0) > 0) return { key: "ready", label: `พร้อมเสิร์ฟ ${stats!.ready}`, rank: 1, color: "var(--green)" };
  if ((stats?.cooking ?? 0) > 0) return { key: "cooking", label: `ครัวกำลังทำ ${stats!.cooking}`, rank: 2, color: "var(--amber)" };
  if (check.itemCount > 0) return { key: "served", label: "เสิร์ฟครบ", rank: 3, color: "var(--green)" };
  return { key: "idle", label: "ยังไม่สั่ง", rank: 4, color: "var(--grey)" };
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
const LINE_KITCHEN_STATE: Record<string, { label: string; color: string; loud?: boolean }> = {
  NEW: { label: "เข้าครัวแล้ว รอคิว", color: "var(--ink-3)" },
  PREPARING: { label: "ครัวกำลังทำ", color: "var(--amber)" },
  READY: { label: "พร้อมเสิร์ฟ", color: "var(--green)", loud: true },
  SERVED: { label: "เสิร์ฟแล้ว", color: "var(--ink-3)" },
};

export default function RestaurantPosPage() {
  const { lang } = useI18n();
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
  // เสียงเตือนต้องให้คนเปิดเอง — เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ และครัวบางร้าน
  // เปิดเพลงอยู่แล้ว การเด้งเสียงเองจึงเป็นการรบกวน ไม่ใช่ความช่วยเหลือ
  const [chimeOn, setChimeOn] = useState(false);
  const knownTicketIds = useRef<Set<string> | null>(null);
  const chimeRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
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
  const [menuCategory, setMenuCategory] = useState("");
  // โหมดแจ้งของหมด: ครัวเดินมาบอกทีเดียวหลายอย่าง — เปิดโหมดแล้วทุกการ์ดกลายเป็นสวิตช์
  // ปิดโหมดแล้วการ์ดกลับมาเป็นปุ่มสั่งอาหารล้วน ไม่มีปุ่มปิดขายค้างอยู่ใต้ทุกเมนูตลอดกะ
  const [menuManage, setMenuManage] = useState(false);
  const [menuOnlySoldOut, setMenuOnlySoldOut] = useState(false);
  const [soldOutSheet, setSoldOutSheet] = useState<MenuItem | null>(null);
  const [menuHit, setMenuHit] = useState<ScanHit | null>(null);
  const [modifierCodes, setModifierCodes] = useState<string[]>([]);
  const [kitchenNote, setKitchenNote] = useState("");
  const [menuQty, setMenuQty] = useState(1);
  const [openTable, setOpenTable] = useState<DiningTable | null>(null);
  const [guestCount, setGuestCount] = useState(2);
  const [shiftModal, setShiftModal] = useState<"OPEN" | "CLOSE" | null>(null);
  const [cashAmount, setCashAmount] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payments, setPayments] = useState<PosPaymentDraft[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<PosMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<PosMember | null>(null);
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
  const availableTables = floor.tables.filter((table) => table.status === "AVAILABLE" && table.id !== selectedTableId);
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
  const openChecks = useMemo(() => floor.tables
    .filter((table) => table.check)
    .map((table) => ({ table, state: tableState(table, tableKitchenStats) }))
    .sort((a, b) => a.state.rank - b.state.rank || a.table.code.localeCompare(b.table.code)),
    [floor.tables, tableKitchenStats]);
  const unsentInCheck = check?.items.filter((item) => item.status === "NEW").length ?? 0;
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
      label: `รอบ ${round || 1} · ส่งครัวแล้ว${items[0]?.sentAt ? ` ${timeOf(items[0].sentAt)}` : ""}`,
      chip: `รอบ ${round || 1}${items[0]?.sentAt ? ` · ${timeOf(items[0].sentAt)}` : ""}`,
      items,
    }));
    if (unsent.length) groups.push({ key: "unsent", label: "ยังไม่ส่งครัว", chip: "ยังไม่ส่งครัว", items: unsent });
    return groups;
  }, [check]);
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
  function auth(extra: Record<string, unknown> = {}) { if (!actorUserId || !actorPin) throw new Error("เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"); return { ...extra, cashierUserId: actorUserId, cashierPin: actorPin }; }
  async function run(work: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try { await work(); setError(""); }
    catch (cause) { const text = cause instanceof Error ? cause.message : String(cause); setError(text); message.error(text); }
    finally { workingRef.current = false; setWorking(false); }
  }
  async function loadSession() { const data: Session = await json("/api/pos/session"); if (data.businessArchetype !== "restaurant") { window.location.replace("/pos?surface=retail"); return null; } setSession(data); setActorUserId((current) => current || data.cashiers.find((p) => p.hasPin)?.id || data.kitchenOperators.find((p) => p.hasPin)?.id || ""); return data; }
  async function loadFloor() { const data: Floor = await json("/api/pos/restaurant/floor"); setFloor(data); setActiveArea((current) => current && data.areas.some((area) => area.id === current) ? current : data.areas[0]?.id ?? ""); return data; }
  /**
   * เสียงเตือนสังเคราะห์เอง ไม่โหลดไฟล์ — จอครัวออฟไลน์ได้และ CSP ของแอปไม่ต้องเปิดทางให้
   * ไฟล์เสียงจากที่อื่น · สองโน้ตสั้นเพื่อให้แยกออกจากเสียงแจ้งเตือนของเครื่องอื่นในร้าน
   */
  function playKitchenChime() {
    if (!chimeRef.current) return;
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      [880, 1174].forEach((hz, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = hz;
        osc.type = "sine";
        const at = ctx.currentTime + index * 0.16;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.18);
      });
    } catch { /* จอที่เล่นเสียงไม่ได้ต้องไม่ทำให้คิวครัวพัง */ }
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
  useEffect(() => { chimeRef.current = chimeOn; }, [chimeOn]);
  useEffect(() => {
    try { setChimeOn(window.localStorage.getItem("bms.pos.kitchenChime") === "1"); } catch { /* โหมดส่วนตัว */ }
  }, []);
  // สถานีที่เลือกไว้หมดงานแล้ว = ตัวกรองค้างอยู่กับช่องว่าง แล้วครัวอ่านว่าไม่มีออร์เดอร์
  useEffect(() => {
    if (!stationFilter) return;
    const stillThere = stationFilter === "UNASSIGNED"
      ? unassignedOpen.length > 0
      : stationFilters.some((filter) => stationFilterKey(filter) === stationFilter);
    if (!stillThere) setStationFilter(null);
  }, [stationFilters, unassignedOpen.length, stationFilter]);

  async function loadTickets() {
    const data = await json("/api/pos/kitchen/tickets?limit=200");
    const rows: KitchenTicket[] = Array.isArray(data.tickets) ? data.tickets : [];
    setStationSlas(data.stationSlas && typeof data.stationSlas === "object" ? data.stationSlas : {});
    setStationList(Array.isArray(data.stations) ? data.stations : []);
    // ตั๋วที่ "เพิ่งเข้ามา" เทียบกับรอบก่อน ไม่ใช่ทุกใบที่สถานะ NEW — ไม่งั้นจะดังทุก 5 วินาที
    // ตราบใดที่ยังมีงานค้าง · รอบแรกหลังเปิดจอถือเป็นการตั้งต้น ไม่ใช่ของใหม่
    const open = rows.filter((row) => row.status === "NEW");
    const seen = knownTicketIds.current;
    if (seen && open.some((row) => !seen.has(row.id))) playKitchenChime();
    knownTicketIds.current = new Set(open.map((row) => row.id));
    setTickets(rows);
  }
  // เมนูทั้งร้านโหลดครั้งเดียวไว้เรนเดอร์เป็นกริด — ไม่ต้องพิมพ์ค้นหาก่อนถึงจะเห็นเมนู
  // ต่างจาก /api/pos/search ที่ต้องมี query ก่อนถึงจะคืนอะไรมา
  async function loadMenu() { const data = await json("/api/pos/restaurant/menu"); setMenuItems(Array.isArray(data.items) ? data.items : []); }
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
      const back = typeof result?.resetsAt === "string" ? timeOf(result.resetsAt) : "";
      message.success(unavailable
        ? `ปิด “${item.name}” แล้ว${back ? ` · เปิดขายอีกครั้ง ${back} น.` : ""}`
        : `เปิดขาย “${item.name}” แล้ว`);
    });
  }
  function toggleMenuAvailability(item: MenuItem) {
    return setMenuAvailability(item, item.availability !== "SOLD_OUT_TODAY", "แจ้งจากครัว");
  }
  async function loadCheck(id: string) { const data = await json(`/api/pos/restaurant/checks/${id}`); setCheck(data.check); return data.check as RestaurantCheck; }
  async function refresh() { if (!token) return; setLoading(true); try { if (!(await loadSession())) return; await Promise.all([loadFloor(), loadTickets(), loadMenu()]); if (check?.id) await loadCheck(check.id).then((row) => { if (!isOpenCheckStatus(row?.status)) setCheck(null); }).catch(() => setCheck(null)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); } }
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
  useEffect(() => {
    if (!token || screen !== "KITCHEN") return;
    const timer = window.setInterval(() => { void Promise.all([loadTickets(), loadFloor()]).catch(() => {}); }, 5000);
    return () => window.clearInterval(timer);
  }, [token, screen]);

  async function chooseTable(table: DiningTable) {
    if (table.blocked) return;
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
  async function chooseMenu(item: SearchItem) { await run(async () => { const size = item.availableSizes.find((v) => v.available > 0)?.size ?? item.availableSizes[0]?.size ?? ""; const hit: ScanHit = await json(`/api/pos/scan?code=${encodeURIComponent(item.sku)}&size=${encodeURIComponent(size)}&surface=RESTAURANT_POS&withImage=1`); setMenuHit(hit); setModifierCodes(hit.modifiers.filter((modifier) => modifier.defaultSelected).map((modifier) => modifier.code)); setKitchenNote(""); setMenuQty(1); }); }
  async function addMenu() { if (!check || !menuHit) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: "add_item", sku: menuHit.sku, size: menuHit.size, packCode: menuHit.packCode, packQty: menuQty, modifierCodes, kitchenNote })) }); setCheck(body.check); setMenuHit(null); setSearch(""); await loadFloor(); }); }
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
      message.success(`เพิ่ม ${item.productName} อีก ${item.packQty} — กดส่งครัวเพื่อส่งเข้าครัว`);
    });
  }

  async function action(name: string, extra: Record<string, unknown> = {}) { if (!check) return; await run(async () => { const body = await json(`/api/pos/restaurant/checks/${check.id}`, { method: "POST", body: JSON.stringify(auth({ action: name, ...extra })) }); if (body.check) setCheck(body.check); await Promise.all([loadFloor(), loadTickets()]); }); }
  async function searchMembers() {
    if (memberQuery.trim().length < 3) { setMemberResults([]); return; }
    await run(async () => {
      const body = await json(`/api/pos/member?q=${encodeURIComponent(memberQuery.trim())}`);
      setMemberResults(Array.isArray(body.members) ? body.members : []);
    });
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
    if (!payload) throw new Error("ข้อมูลราคาบรรทัดใบเสร็จไม่ครบ — เปิดแท็บบิลแล้วลองพิมพ์ซ้ำ");
    return buildReceipt(payload);
  }
  async function printReceipt(receipt: ReceiptSelection, openDrawer = false) {
    await run(async () => {
      if (!receiptPayload(receipt)) {
        throw new Error("ข้อมูลราคาบรรทัดใบเสร็จไม่ครบ — เปิดแท็บบิลแล้วลองพิมพ์ซ้ำ");
      }
      const fallback = (reason: string) => {
        message.info(`${reason} — ใช้หน้าต่างพิมพ์ของเบราว์เซอร์แทน${openDrawer ? " (ลิ้นชักไม่เปิดเอง ใช้ปุ่มที่แท็บกะ)" : ""}`);
        printViaBrowser();
      };
      if (!isWebUsbSupported()) {
        fallback("เบราว์เซอร์นี้สั่งเครื่องพิมพ์โดยตรงไม่ได้");
        return;
      }
      let printer = await findRememberedPrinter();
      if (!printer) {
        try { printer = await requestPrinter(); }
        catch { printer = null; }
      }
      if (!printer) {
        fallback("ยังไม่ได้เลือกเครื่องพิมพ์");
        return;
      }
      try {
        await sendToPrinter(receiptBytes(receipt), printer);
        if (openDrawer) await sendToPrinter(buildDrawerKick(), printer);
      } catch (cause) {
        fallback(`พิมพ์ผ่านเครื่องไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
      message.success("พิมพ์ใบเสร็จแล้ว");
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
    if (!cancelReason.trim()) { message.error("ต้องระบุ Note ว่ายกเลิกบิลเพราะอะไร"); return; }
    if (cancelNeedsApproval && (!cancelApproverId || !cancelApproverPin)) {
      message.error("บิลที่ส่งครัวแล้วต้องมีผู้อนุมัติคนที่สองกด PIN");
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
      message.success("ยกเลิกบิลและบันทึก Note แล้ว");
    });
  }
  // เลื่อนสถานะตั๋ว — ต้องมีคำตอบที่จอทุกครั้ง เพราะตั๋วที่เลื่อนแล้วจะย้ายเลน (หรือหายไปเลย
  // เมื่อยกเลิก เพราะไม่มีเลนของ CANCELLED) ถ้าเงียบ คนครัวอ่านว่า "กดแล้วไม่เกิดอะไร"
  // และการยกเลิกต้องบอกด้วยว่า **รายการยังอยู่ในบิล** ไม่งั้นเข้าใจว่าตัดออกให้แล้ว
  const TICKET_DONE_TEXT: Record<string, string> = {
    PREPARING: "เริ่มทำแล้ว", READY: "พร้อมเสิร์ฟแล้ว", SERVED: "เสิร์ฟแล้ว",
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
        : `${group.totalQty} รายการ`;
      if (status === "CANCELLED") {
        const dropped = moved.filter((row) => row.billLineDropped).length;
        if (dropped > 0) {
          const due = moved.find((row) => row.checkAmountDue != null)?.checkAmountDue;
          message.success(`${where}ยกเลิก ${what} แล้ว — ตัดออกจากบิลให้เรียบร้อย${due == null ? "" : ` ยอดใหม่ ฿${money(due)}`}`, 6);
        } else {
          message.warning(`${where}ยกเลิก ${what} แล้ว แต่บิลไม่ได้เปิดอยู่ (กำลังคิดเงินหรือปิดแล้ว) — ยอดยังรวมรายการนี้ ต้องคืนเงิน/แก้บิลตามปกติ`, 10);
        }
      } else {
        message.success(`${where}${what}: ${TICKET_DONE_TEXT[status] ?? "อัปเดตแล้ว"}`);
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
          message.success(`${where}ยกเลิก "${ticket.productName}" แล้ว — ตัดออกจากบิลให้เรียบร้อย${due == null ? "" : ` ยอดใหม่ ฿${money(due)}`}`, 6);
        } else {
          message.warning(`${where}ยกเลิกตั๋ว "${ticket.productName}" แล้ว แต่บิลไม่ได้เปิดอยู่ (กำลังคิดเงินหรือปิดแล้ว) — ยอดยังรวมรายการนี้ ต้องคืนเงิน/แก้บิลตามปกติ`, 10);
        }
      } else {
        message.success(`${where}${ticket.productName}: ${TICKET_DONE_TEXT[status] ?? "อัปเดตแล้ว"}`);
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
      message.success(actionName === "OPEN" ? "เปิดกะแล้ว" : "ปิดกะและบันทึกยอดนับแล้ว");
    });
  }
  async function recordCashMove() {
    if (!operatorReady) { message.error("เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"); return; }
    if (!(Number(cashMoveAmount) > 0) || !cashMoveReason.trim()) { message.error("ระบุจำนวนเงินที่มากกว่า 0 และเหตุผลก่อน"); return; }
    if (cashMoveDirection === "IN" && !cashMoveExternalConfirmed) {
      message.error("ยืนยันก่อนว่าเงินก้อนนี้มาจากนอกยอดขาย");
      return;
    }
    if (cashMoveDirection === "OUT" && (!cashMoveApproverId || !cashMoveApproverPin)) { message.error("เงินออกต้องมีผู้อนุมัติคนที่สองกด PIN"); return; }
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
      message.success("บันทึกเงินเข้า/ออกแล้ว");
    });
  }
  async function recordNoSale() {
    if (!operatorReady) { message.error("เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"); return; }
    if (!noSaleReason.trim()) { message.error("ระบุเหตุผลที่เปิดลิ้นชักก่อน"); return; }
    await run(async () => {
      await json("/api/pos/no-sale", { method: "POST", body: JSON.stringify({ cashierUserId: actorUserId, pin: actorPin, reason: noSaleReason.trim() }) });
      setNoSaleReason("");
      const printer = await findRememberedPrinter();
      if (printer) await sendToPrinter(buildDrawerKick(), printer).catch(() => {});
      setShiftReport(null);
      message.success("บันทึกการเปิดลิ้นชักแล้ว");
    });
  }
  async function loadShiftReport() {
    if (!actorUserId || !actorPin) { message.error("เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"); return; }
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
    if (!token || !session?.device?.id || !actorUserId || !actorPin) return message.error(lang === "en" ? "Select an operator and enter the PIN first." : "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน");
    if (action === "send" && (!supportConfirmed || !supportDescription.trim())) return message.warning(lang === "en" ? "Describe the issue and confirm before sending." : "อธิบายปัญหาและยืนยันก่อนส่ง");
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
        message.success(truncated ? (lang === "en" ? `Downloaded; ${truncated} was truncated. Select a shorter period in Admin for a complete bundle.` : `ดาวน์โหลดแล้ว แต่ ${truncated} เกินเพดาน ให้เลือกช่วงสั้นลงในหน้า Admin`) : (lang === "en" ? "Diagnostic log downloaded." : "ดาวน์โหลด Diagnostic Log แล้ว"));
      } else {
        const body = await response.json();
        const truncatedSources = Object.entries(body.truncated ?? {}).filter(([, value]) => value).map(([key]) => key).join(", ");
        if (truncatedSources) {
          message.warning(lang === "en" ? `Support case ${body.ticketCode} created, but ${truncatedSources} was truncated.` : `สร้างเคส ${body.ticketCode} แล้ว แต่ ${truncatedSources} เกินเพดานข้อมูล`);
        } else {
          message.success(lang === "en" ? `Support case created: ${body.ticketCode}` : `สร้างเคส Support แล้ว: ${body.ticketCode}`);
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
  if (!token) return <main className={`${styles.page} ${styles.pagePlain}`}><Alert type="warning" showIcon message="ยังไม่พบ device token" description="จับคู่เครื่อง POS จากหลังบ้านก่อนเปิดหน้านี้" /></main>;

  // ป้ายในแถบกว้าง 64px ต้องสั้นพอไม่ตัดคำ ("สั่งอาหาร" เหลือ "สั่ง" แล้วอ่านเป็นคำอื่น)
  // ชื่อเต็มอยู่ที่ title/aria-label เพื่อให้ screen reader และ tooltip ยังได้ความหมายครบ
  const railScreens = [
    { key: "ORDER" as const, short: "สั่ง", full: "สั่งอาหาร", icon: <WalletOutlined />, badge: 0 },
    { key: "FLOOR" as const, short: "โต๊ะ", full: "ผังโต๊ะ", icon: <AppstoreOutlined />, badge: unsentTableCount },
    { key: "KITCHEN" as const, short: "ครัว", full: "จอครัว", icon: <CoffeeOutlined />, badge: kitchenCooking + kitchenReady },
    { key: "BILLS" as const, short: "บิล", full: "บิลล่าสุด", icon: <FileTextOutlined />, badge: 0 },
    { key: "SHIFT" as const, short: "กะ", full: "จัดการกะและลิ้นชัก", icon: <SwapOutlined />, badge: 0 },
  ];

  return <main className={styles.page} ref={rootRef}>
    {/* เมนูนำทางฝั่งซ้าย — ป้ายตัวเลขบอกงานค้างของจอนั้น (โต๊ะที่ยังไม่ส่งครัว / ตั๋วในครัว)
        เพื่อให้เห็นว่าต้องไปจอไหนต่อโดยไม่ต้องเข้าไปดูทีละจอ */}
    <nav className={styles.rail} aria-label="สลับหน้าจอ">
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
        <div className={styles.brand}><div><h1 className={styles.title}>BMS Restaurant</h1><p className={styles.subtitle}>{session?.location?.name ?? "-"} · {session?.device.code} · {operatorReady ? (operatorName || "ผู้ปฏิบัติงาน") : "ยังไม่ได้ระบุผู้ปฏิบัติงาน"}</p></div></div>
        <div className={styles.topActions}>
          {/* PIN กรอกครั้งเดียวต่อกะ — ชื่อคนอยู่ใต้ชื่อร้าน ปุ่มนี้เปิดกล่องเลือกคน/กรอก PIN */}
          <button type="button" className={styles.btn} onClick={() => setOperatorOpen(true)}>{operatorReady ? "เปลี่ยนคน" : "เลือกผู้ปฏิบัติงาน"}</button>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void refresh()} title="รีเฟรช" aria-label="รีเฟรช"><ReloadOutlined /></button>
          <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setSupportOpen(true)} title={`Support Log (${localSupportEventCount(supportScope)})`} aria-label={`Support Log (${localSupportEventCount(supportScope)})`}><CustomerServiceOutlined /></button>
          <button type="button" className={styles.btn} onClick={() => { window.location.href = "/pos?surface=retail"; }} title="คืนสินค้า · รับของเข้าคลัง · มัดจำ · บัตรของขวัญ · ขายเชื่อ ยังอยู่ที่หน้าค้าปลีก"><ShopOutlined /> โหมดค้าปลีก</button>
          {!session?.shift && <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!operatorReady} title={operatorReady ? "เปิดกะ" : "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"} onClick={() => setShiftModal("OPEN")}>เปิดกะ</button>}
        </div>
      </header>
      {!session?.shift && <Alert type="warning" showIcon message="ยังไม่เปิดกะ — เปิดกะก่อนจึงจะเปิดโต๊ะและรับออร์เดอร์ได้" />}
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}

      {screen === "BILLS" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}>
          <div><h2>บิลล่าสุดของเครื่องนี้</h2><small>ค้นหา เปิดดู พิมพ์ซ้ำ หรือส่งสำเนา โดยไม่ต้องออกจากหน้าร้านอาหาร</small></div>
          <div className={styles.searchRow}><input className={styles.field} value={recentQuery} onChange={(event) => setRecentQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadRecentReceipts(); }} placeholder="เลขบิล / สมาชิก" /><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void loadRecentReceipts()}>ค้นหา</button></div>
        </div>
        <div className={styles.receiptGrid}>
          {recentReceipts.length === 0 && <div className={styles.empty}>ยังไม่มีบิลในเครื่องนี้ หรือกดค้นหาเพื่อรีเฟรช</div>}
          {recentReceipts.map((receipt) => <button type="button" className={styles.receiptCard} key={receipt.orderId} onClick={() => setSelectedReceipt(receipt)}>
            <span><b>{receipt.docNo ?? receipt.receiptNo ?? receipt.orderId.slice(0, 8)}</b><small>{new Date(receipt.soldAt).toLocaleString("th-TH")}</small></span>
            <strong><span className={styles.baht}>฿</span>{money(receipt.total)}</strong>
            <span>{receipt.memberName ?? "ลูกค้าทั่วไป"} · {receipt.lines.length} รายการ{billHistoryNote(receipt) ? ` · ${billHistoryNote(receipt)}` : ""}</span>
          </button>)}
        </div>
      </section></Spin>}

      {screen === "SHIFT" && <Spin spinning={working}><section className={styles.counterScreen}>
        <div className={styles.panelHeader}><div><h2>กะและลิ้นชัก</h2><small>{session?.shift ? `เปิดเมื่อ ${new Date(session.shift.openedAt).toLocaleString("th-TH")}` : "ยังไม่เปิดกะ"}</small></div><div className={styles.searchRow}><button type="button" className={styles.btn} disabled={!session?.shift || !operatorReady} title={operatorReady ? "ดูรายงานกะที่เปิดอยู่" : "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"} onClick={() => void loadShiftReport()}>ดูสรุปกะ X</button>{session?.shift && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={!operatorReady} title={operatorReady ? "ปิดกะและบันทึกยอดนับ" : "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน"} onClick={() => setShiftModal("CLOSE")}>ปิดกะ</button>}</div></div>
        <div className={styles.counterGrid}>
          <article className={styles.counterCard}><h3>เงินเข้า / เงินออก</h3><Segmented value={cashMoveDirection} onChange={(value) => { setCashMoveDirection(value as "IN" | "OUT"); setCashMoveExternalConfirmed(false); }} options={[{ label: "เงินเข้า", value: "IN" }, { label: "เงินออก", value: "OUT" }]} /><label>จำนวนเงิน<input type="number" min="0.01" step="0.01" value={cashMoveAmount} onChange={(event) => setCashMoveAmount(event.target.value)} /></label><label>เหตุผล<input value={cashMoveReason} onChange={(event) => setCashMoveReason(event.target.value)} /></label>{cashMoveDirection === "IN" && <Checkbox className={styles.cashConfirm} checked={cashMoveExternalConfirmed} onChange={(event) => setCashMoveExternalConfirmed(event.target.checked)}>ยืนยันว่าเป็นเงินจากนอกยอดขาย (ยอดขายเงินสดนับให้อัตโนมัติแล้ว)</Checkbox>}{cashMoveDirection === "OUT" && <><label>ผู้อนุมัติ<select value={cashMoveApproverId} onChange={(event) => setCashMoveApproverId(event.target.value)}><option value="">เลือกผู้อนุมัติคนที่สอง</option>{(session?.approvers ?? []).filter((person) => person.id !== actorUserId && person.hasPin && person.approvals.includes("pos.cash.movement")).map((person) => <option key={person.id} value={person.id}>{person.name ?? person.email ?? person.id}</option>)}</select></label><label>PIN ผู้อนุมัติ<input type="password" inputMode="numeric" autoComplete="off" value={cashMoveApproverPin} onChange={(event) => setCashMoveApproverPin(event.target.value)} /></label></>}<button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift || !operatorReady || !(Number(cashMoveAmount) > 0) || !cashMoveReason.trim() || (cashMoveDirection === "IN" ? !cashMoveExternalConfirmed : !cashMoveApproverId || !cashMoveApproverPin)} title={!operatorReady ? "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน" : "บันทึกเงินเข้า/ออกลิ้นชัก"} onClick={() => void recordCashMove()}>บันทึกรายการ</button></article>
          <article className={styles.counterCard}><h3>เปิดลิ้นชักโดยไม่ขาย</h3><p>ทุกครั้งต้องมีเหตุผล ระบบบันทึกผู้เปิดและนับในสรุปกะ</p><label>เหตุผล<input value={noSaleReason} onChange={(event) => setNoSaleReason(event.target.value)} placeholder="เช่น แลกแบงก์ย่อย" /></label><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift || !operatorReady || !noSaleReason.trim()} title={!operatorReady ? "เลือกผู้ปฏิบัติงานและกรอก PIN ก่อน" : "บันทึกและเปิดลิ้นชัก"} onClick={() => void recordNoSale()}>บันทึกและเปิดลิ้นชัก</button></article>
          <article className={`${styles.counterCard} ${styles.reportCard}`}><h3>สรุปกะจาก server</h3>{shiftReport ? <div className={styles.summaryGrid}><span>ยอดขาย<b>฿{money(shiftReport.salesTotal)}</b></span><span>จำนวนบิล<b>{shiftReport.billCount}</b></span><span>รับคืน<b>{shiftReport.returnCount} / ฿{money(shiftReport.returnTotal)}</b></span><span>เงินเข้า / ออก<b>฿{money(shiftReport.cashIn)} / ฿{money(shiftReport.cashOut)}</b></span><span>เปิดลิ้นชักไม่ขาย<b>{shiftReport.noSaleCount}</b></span><span>เงินที่ควรมี<b>{shiftReport.expectedCashHidden ? "ซ่อนจนปิดกะ" : `฿${money(shiftReport.expectedCash ?? 0)}`}</b></span>{shiftReport.byMethod.map((row) => <span key={row.method}>{row.method}<b>{row.count} บิล · ฿{money(row.amount)}</b></span>)}</div> : <p>กด “ดูสรุปกะ X” หลังเลือกผู้ปฏิบัติงานและกรอก PIN</p>}</article>
        </div>
      </section></Spin>}

      {screen === "ORDER" || screen === "FLOOR" ? <Spin spinning={working}><div className={styles.floorWrap}>
        {screen === "FLOOR" && floor.tables.length > 0 && <section className={styles.strip} aria-label="สรุปหน้าร้าน">
          <span>โต๊ะใช้งาน <b>{occupiedTables.length}</b> / {floor.tables.length}</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span>ยอดเปิดค้าง <b><span className={styles.baht}>฿</span>{money(openAmountTotal)}</b></span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span><span className={styles.stripDot} style={{ background: "var(--red)" }} aria-hidden="true" />ยังไม่ส่งครัว <b className={unsentItemTotal > 0 ? styles.stripWarn : ""}>{unsentItemTotal}</b> รายการ · {unsentTableCount} โต๊ะ</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span>นั่งนานสุด {longestSeated ? <><b>{longestSeated.minutes}</b> นาที · {longestSeated.code}</> : <b>—</b>}</span>
          <span className={styles.stripSep} aria-hidden="true">│</span>
          <span><span className={styles.stripDot} style={{ background: "var(--amber)" }} aria-hidden="true" />คิวครัว <b>{kitchenCooking}</b> กำลังทำ · {kitchenReady} พร้อมเสิร์ฟ</span>
        </section>}
        <div className={styles.workspace}>
        <section className={styles.panel}>{screen === "ORDER" ? <>
          {/* จอสั่งอาหาร: แถวบิลที่เปิดอยู่ → หมวดหมู่ (station) → กริดเมนูเต็มพื้นที่
              กริดอยู่ฝั่งกว้างโดยตั้งใจ ของเดิมอยู่ในแผงขวา 300px ซึ่งการ์ดเล็กจนต้องเพ่ง */}
          <div className={styles.panelHeader}>
            <div><h2>สั่งอาหาร</h2><small>{check ? `${check.tableName} · ${check.guestCount} คน` : "เลือกโต๊ะก่อนเริ่มรับออร์เดอร์"}</small></div>
            <div className={styles.searchRow}>
              {/* ปุ่มล้างคำค้น: คนหน้าร้านพิมพ์ด้วยนิ้วบนแท็บเล็ต การลบทีละตัวอักษรช้ากว่าการ
                  แตะครั้งเดียวมาก และคำค้นที่ค้างอยู่ทำให้กริดเมนูดู "ของหาย" ทั้งที่แค่ยังกรองอยู่
                  · ขึ้นเฉพาะตอนมีข้อความ ไม่งั้นเป็นปุ่มที่กดแล้วไม่เกิดอะไรลอยอยู่ตลอดเวลา */}
              <div className={styles.searchField}>
                <input ref={searchRef} className={`${styles.field} ${search ? styles.fieldClearable : ""}`}
                  value={search} onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); setSearch(""); } }}
                  placeholder="กรองเมนู (ไม่จำเป็น — แตะการ์ดได้เลย)" />
                {search && <button type="button" className={styles.searchClear} aria-label="ล้างคำค้น"
                  title="ล้างคำค้น"
                  onClick={() => { setSearch(""); searchRef.current?.focus(); }}>✕</button>}
              </div>
            </div>
          </div>

          {openChecks.length > 0 && <div className={styles.billStrip} role="group" aria-label="บิลที่เปิดอยู่">
            {openChecks.map(({ table, state }) => <button key={table.id} type="button"
              className={`${styles.billChip} ${check?.tableId === table.id ? styles.billChipActive : ""}`}
              onClick={() => void chooseTable(table)}>
              <span className={styles.billChipCode} style={{ background: state.color }}>{table.code}</span>
              <span className={styles.billChipBody}>
                <span className={styles.billChipName}>{table.name}</span>
                <span className={styles.billChipState} style={{ color: state.color }}>{state.label}</span>
                <span className={styles.billChipMeta}>{table.check!.guestCount} คน · {table.check!.itemCount} รายการ</span>
              </span>
            </button>)}
          </div>}

          {!check
            ? <div className={styles.empty}><div><AppstoreOutlined style={{ fontSize: 36 }} /><h3>ยังไม่ได้เลือกโต๊ะ</h3>
                <p>{openChecks.length > 0 ? "แตะบิลด้านบนเพื่อสั่งต่อ หรือไปที่แท็บโต๊ะเพื่อเปิดโต๊ะใหม่" : "ไปที่แท็บโต๊ะเพื่อเปิดโต๊ะก่อน"}</p>
                <button type="button" className={styles.btn} onClick={() => setScreen("FLOOR")}><AppstoreOutlined /> ไปที่ผังโต๊ะ</button></div></div>
            : <>
              {menuStations.length > 0 && <div className={styles.catRow}>
                <button type="button" className={`${styles.catCard} ${menuCategory === "" ? styles.catCardActive : ""}`} onClick={() => setMenuCategory("")}>
                  <span className={styles.catName}>ทั้งหมด</span><span className={styles.catCount}>{menuItems.length} เมนู</span>
                </button>
                {menuStations.map((stationName) => <button key={stationName} type="button"
                  className={`${styles.catCard} ${menuCategory === stationName ? styles.catCardActive : ""}`}
                  onClick={() => setMenuCategory(stationName)}>
                  <span className={styles.catName}>{stationName}</span>
                  <span className={styles.catCount}>{menuItems.filter((item) => item.kitchenStation === stationName).length} เมนู</span>
                </button>)}
              </div>}
              {/* งานปิด/เปิดเมนูเป็นงานวันละไม่กี่ครั้ง จึงอยู่บนแถบเครื่องมือแถวเดียว
                  ไม่ใช่แถบใต้การ์ดทุกใบตลอดกะ (ซึ่งอ่านเป็น "สถานะ" มากกว่า "ปุ่ม") */}
              <div className={styles.menuTools}>
                <button type="button" aria-pressed={menuManage}
                  className={`${styles.menuTool} ${menuManage ? styles.menuToolOn : ""}`}
                  onClick={() => setMenuManage((on) => !on)}>{menuManage ? "เสร็จแล้ว" : "แจ้งของหมด"}</button>
                {soldOutCount > 0 && <button type="button" aria-pressed={menuOnlySoldOut}
                  className={`${styles.menuTool} ${styles.menuToolAlert} ${menuOnlySoldOut ? styles.menuToolOn : ""}`}
                  onClick={() => setMenuOnlySoldOut((on) => !on)}>หมดวันนี้ {soldOutCount}</button>}
                <span className={styles.menuToolNote}>{menuManage
                  ? "สลับสวิตช์ที่การ์ดเพื่อปิด/เปิดเมนู แล้วกดเสร็จแล้ว"
                  : "แตะการ์ดเพื่อสั่ง · ปุ่ม ⋯ มุมการ์ดเพื่อปิดขาย"}</span>
              </div>
              <div className={styles.panelScroll}>{visibleMenuItems.length === 0
                ? <div className={styles.menuEmpty}>{menuItems.length === 0
                    ? "ยังไม่มีเมนูที่ขายที่โต๊ะได้ — สินค้าต้องเปิดขาย มีราคา และไม่ได้ถูกใช้เป็นวัตถุดิบของสูตรอื่น"
                    : "ไม่พบเมนูที่ตรงกับที่กรอง"}</div>
                : <div className={styles.dishGrid}>{visibleMenuItems.map((item) => {
                    const tint = menuCardTint(item.kitchenStation, menuStations);
                    const inCheck = qtyInCheckBySku.get(item.sku) ?? 0;
                    const soldOutToday = item.availability === "SOLD_OUT_TODAY";
                    // การ์ดที่ปิดขายต้อง "เงียบ" ไม่ใช่ดังที่สุดบนจอ — กริดนี้มีไว้สั่งอาหาร
                    // ของที่สั่งไม่ได้ควรจางลงจนตากวาดผ่าน (รูปขาวดำ + พื้นจาง + ชิปแดงเล็ก)
                    // แทนแถบแดงทึบทับรูปอาหารกับปุ่มเต็มความกว้างที่ทำให้การ์ดสูงไม่เท่าเพื่อนในแถว
                    const backAt = soldOutToday ? timeOf(item.unavailableResetsAt) : "";
                    const outNote = soldOutToday
                      ? [item.unavailableReason, backAt ? `เปิดเอง ${backAt} น.` : null].filter(Boolean).join(" · ")
                      : "ยังไม่มีของในสาขานี้";
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
                            ? <span className={styles.dishTapHint}>แตะเพื่อเปิดขาย</span>
                            : item.hasModifiers && <span className={styles.dishModHint}>มีตัวเลือก</span>}
                        </span>
                      </span>
                      {/* ชิปสถานะแทนป้ายสถานี — ตอนสั่งไม่ได้ สถานีไม่ใช่ข้อมูลที่ต้องรู้ */}
                      {!item.sellable
                        ? <span className={styles.dishOutChip}>{soldOutToday ? "หมดวันนี้" : "สต็อกหมด"}</span>
                        : item.kitchenStation && <span className={styles.dishStation} style={{ background: tint.bg, color: tint.ink }}>{item.kitchenStation}</span>}
                      </button>
                      {menuManage
                        ? <div className={styles.dishManageRow}>
                            <span>{soldOutToday ? "ปิดขายอยู่" : "ขายอยู่"}</span>
                            <button type="button" className={styles.dishSwitch} aria-pressed={!soldOutToday}
                              aria-label={`สลับสถานะขาย ${item.name}`}
                              onClick={() => void toggleMenuAvailability(item)} />
                          </div>
                        : <button type="button" className={styles.dishKebab} aria-label={`จัดการเมนู ${item.name}`}
                            onClick={() => setSoldOutSheet(item)}><MoreOutlined /></button>}
                    </div>;
                  })}</div>}</div>
            </>}
        </> : floor.areas.length === 0 ? <div className={styles.setup}><div><div className={styles.setupIcon}><ShopOutlined /></div><h2>ยังไม่มีผังโต๊ะของสาขานี้</h2><p>เริ่มด้วยโซนหน้าร้านและโต๊ะ 12 ตัว</p><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift} onClick={() => void run(async () => { const data = await json("/api/pos/restaurant/floor", { method: "POST", body: JSON.stringify(auth({ tableCount: 12 })) }); setFloor(data); setActiveArea(data.areas[0]?.id ?? ""); })}>สร้างผังเริ่มต้น</button></div></div> : <>
          <div className={styles.panelHeader}><div><h2>ผังโต๊ะ</h2><small>{floor.tables.filter((t) => t.status === "AVAILABLE").length} โต๊ะว่าง · {floor.tables.filter((t) => t.status === "OCCUPIED").length} โต๊ะใช้งาน</small></div><span className={styles.livePill}>LIVE</span></div>
          <div className={styles.areaTabs}>{floor.areas.map((area) => <button key={area.id} type="button" className={`${styles.areaButton} ${activeArea === area.id ? styles.areaButtonActive : ""}`} aria-pressed={activeArea === area.id} onClick={() => setActiveArea(area.id)}>{area.name} · {floor.tables.filter((table) => table.areaId === area.id).length}</button>)}</div>
          {/* การ์ดโต๊ะตอบสามคำถามที่พนักงานถามจริง: นั่งมานานแค่ไหน · ค้างส่งครัวกี่รายการ · เสิร์ฟครบพร้อมเก็บเงินหรือยัง
              สถานะอ่านจากแถบสีข้างการ์ด + ป้ายข้อความ (จุดสี 10px เดิมแยกไม่ออกจากระยะยืน) */}
          <div className={styles.panelScroll}><div className={styles.tableGrid}>{visibleTables.map((table) => {
            const state = tableState(table, tableKitchenStats);
            const minutes = table.check ? minutesSince(table.check.openedAt) : null;
            return <button key={table.id} type="button" disabled={table.blocked} className={`${styles.tableCard} ${table.check ? styles[`state_${state.key}`] : styles.tableFree} ${table.blocked ? styles.tableBlocked : ""} ${selectedTableId === table.id ? styles.tableSelected : ""}`} onClick={() => void chooseTable(table)}>
              {table.check && <span className={styles.tableBand} aria-hidden="true" />}
              <span className={styles.tableCode}>{table.code}</span>
              <span className={styles.tableName}>{table.name}</span>
              {table.check && <span className={styles.tableStatus}>{state.label}</span>}
              <span className={styles.tableMeta}>{table.check
                ? `${table.check.guestCount} คน · ${table.check.itemCount} รายการ${minutes == null ? "" : ` · ${minutes} นาที`}`
                : `${table.seats} ที่นั่ง · ว่าง`}</span>
              {table.check && <span className={styles.tableAmount}><span className={styles.baht}>฿</span>{money(table.check.amountDue)}</span>}
            </button>;
          })}</div></div>

        </>}</section>
        <aside className={styles.checkPanel}>{check ? <>
          {/* หัวแผง = ชื่อโต๊ะ + เวลาที่เปิด + งานที่ทำกับ "ทั้งบิล" (ย้ายมาไว้บนตามที่ออกแบบ
              เพราะสองปุ่มล่างต้องเหลือไว้ให้งานที่ทำบ่อยที่สุด: ส่งครัว กับ คิดเงิน) */}
          <div className={styles.checkHead}>
            <div className={styles.checkHeadRow}>
              <div className={styles.checkHeadText}>
                <h2>{check.tableName} · {check.guestCount} คน</h2>
                <p>{check.areaName} · เปิดบิล {timeOf(check.openedAt)}{checkMinutes == null ? "" : ` · ${checkMinutes} นาที`}{lastRound ? ` · รอบล่าสุด ${lastRound}` : ""}</p>
              </div>
              <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setMoreOpen(true)} title="จัดการบิลนี้ — ย้ายโต๊ะ · แก้จำนวนคน · ยกเลิกบิล" aria-label="จัดการบิลนี้"><MoreOutlined /></button>
            </div>
          </div>

          <div className={styles.items}>
            {check.items.length === 0 && <div className={styles.empty}><p>แตะการ์ดเมนูทางซ้ายเพื่อเริ่มรับออร์เดอร์</p></div>}
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
                      {dropped && <b className={styles.itemDropMark}> · ครัวยกเลิก ไม่คิดเงิน</b>}
                    </span>
                    {item.kitchenNote && <span className={styles.itemNote}>โน้ตครัว: {item.kitchenNote}</span>}
                    {stillCharged && <span className={styles.itemCancelTag}>ครัวยกเลิกรายการนี้ — ยังคิดเงินอยู่</span>}
                    {kitchenState && <span className={`${styles.itemKitchenTag} ${kitchenState.loud ? styles.itemKitchenTagLoud : ""}`} style={{ color: kitchenState.color }}>{kitchenState.label}</span>}
                  </span>
                  <span className={styles.itemSide}>
                    {/* ราคาต่อหน่วยที่ server บันทึกไว้ตอนเพิ่มรายการ — ห้ามคูณ/รวมเองที่จอ
                        เพราะตัวเลือกมีส่วนต่างราคาที่ถูกคิดฝั่ง server ตอนส่งครัว */}
                    {item.packPrice != null && <span className={`${styles.itemPrice} ${dropped ? styles.itemPriceVoid : ""}`} title={`ราคาต่อ${item.unitName ?? "หน่วย"}`}><span className={styles.baht}>฿</span>{money(item.packPrice)}</span>}
                    {/* สั่งซ้ำขึ้นเฉพาะบรรทัดที่ส่งครัวไปแล้วหรือถูกยกเลิก — บรรทัด NEW ยังแก้ได้
                        ที่การ์ดเมนูตรงหน้าอยู่แล้ว และช่องนี้เป็นที่ของปุ่มลบ */}
                    {/* คำบนปุ่มเปลี่ยนตามสถานะบรรทัด: บรรทัดที่ครัวยกเลิก อาหารไม่เคยถึงลูกค้า
                        สิ่งที่คนกดกำลังทำคือ "ทำใหม่ให้" ไม่ใช่ "เอาเพิ่มอีกที่" — ไอคอน ⟳ ตัวเดียว
                        พูดสองเรื่องนี้ไม่ได้ และ ⟳ บนจอเดียวกันนี้ยังแปลว่า "รีเฟรช" อยู่อีกที่ */}
                    {item.status !== "NEW" && <button type="button" className={styles.itemAgain}
                      title={`สั่ง ${item.productName} ${dropped || stillCharged ? "ใหม่" : "ซ้ำ"}พร้อมตัวเลือกเดิม`}
                      aria-label={`สั่ง ${item.productName} ${dropped || stillCharged ? "ใหม่" : "ซ้ำ"}พร้อมตัวเลือกเดิม`}
                      disabled={working} onClick={() => void reorderLine(item)}>
                      {dropped || stillCharged ? "สั่งใหม่" : "สั่งซ้ำ"}
                    </button>}
                    {/* คอลัมน์นี้เป็นข้อความทั้งคอลัมน์ — ปุ่มเดียวที่เป็นสัญลักษณ์ทำให้ตาต้องสลับ
                        วิธีอ่านกลางคัน และ ⊗ อ่านได้ทั้ง "ลบบรรทัด" และ "ยกเลิกบิล"
                        · ไม่ต้องถามยืนยัน: บรรทัด NEW ยังไม่มีตั๋วครัว ไม่มีการจองวัตถุดิบ ไม่มีเงินขยับ
                        และเผลอลบแล้วแตะการ์ดเมนูใบเดิมก็กลับมา (ต่างจาก "ยกเลิกบิล" ที่ต้องมี PIN) */}
                    {item.status === "NEW" && <button type="button" className={styles.itemRemove}
                      aria-label={`ลบ ${item.productName} ออกจากบิล`} title={`ลบ ${item.productName} ออกจากบิล`}
                      disabled={working} onClick={() => void action("remove_item", { itemId: item.id })}>ลบ</button>}
                  </span>
                </article>;
              })}
            </Fragment>)}
          </div>

          <div className={styles.checkFooter}>
            {reservationLost && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>ใบจองสต็อกของโต๊ะนี้หายไป</b> — กด “ส่งครัว” หนึ่งครั้งเพื่อจองทั้งบิลใหม่ แล้วจึงคิดเงินได้ (ครัวไม่ได้รับรายการซ้ำ)</span></div>}
            {hasUnsent && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>{unsentInCheck} รายการยังไม่ถึงครัว</b> — ส่งครัวก่อนจึงจะคิดเงินได้ ยอดด้านล่างคือยอดที่ส่งครัวแล้ว</span></div>}
            {/* ปกติครัวยกเลิกแล้วบรรทัดจะหลุดจากบิลทันที เหลือค้างได้เฉพาะกรณีบิลไม่ได้เปิดอยู่
                ตอนที่ครัวกด (กำลังคิดเงิน/ปิดแล้ว) ซึ่งแตะยอดที่ออกใบเสร็จไปแล้วไม่ได้ */}
            {kitchenCancelled.length > 0 && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>ครัวยกเลิก {kitchenCancelled.length} รายการ ตอนบิลไม่ได้เปิดอยู่</b> — ยอดด้านล่างยังรวมรายการนั้น ตัดออกอัตโนมัติไม่ได้ ต้องคืนเงินหรือแก้บิลตามปกติ</span></div>}
            <div className={styles.total}><span className={styles.totalLabel}>{hasUnsent ? "ยอดที่ส่งครัวแล้ว" : "ยอดบิลปัจจุบัน"}</span><strong><span className={styles.baht}>฿</span>{money(check.amountDue)}</strong></div>
            <div className={styles.footerButtons}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!hasUnsent && !reservationLost} onClick={() => void action("send_kitchen")}><CoffeeOutlined /> ส่งครัว{unsentInCheck > 0 ? ` (${unsentInCheck})` : ""}</button>
              <button type="button" className={styles.btn} disabled={!check.items.length || hasUnsent || reservationLost || check.amountDue <= 0} onClick={() => { const cashDue = Math.round((check.amountDue + cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")) * 100) / 100; setPayments([{ id: `pay-${Date.now()}`, method: "CASH", amount: String(cashDue), tendered: String(cashDue), ref: "" }]); setCheckoutOpen(true); }}><WalletOutlined /> คิดเงิน</button>
            </div>
          </div>
        </> : <>
          <div className={styles.checkHead}><h2>บิลที่เปิดอยู่ · {openChecks.length}</h2></div>
          {openChecks.length === 0
            ? <div className={styles.empty}><div><AppstoreOutlined style={{ fontSize: 36 }} /><h3>ยังไม่มีบิลที่เปิดอยู่</h3><p>กดโต๊ะว่างทางซ้ายเพื่อเปิดบิลใหม่</p></div></div>
            : <ul className={styles.openList}>{openChecks.map(({ table, state }) => <li key={table.id}>
                <button type="button" className={styles.openRow} onClick={() => void chooseTable(table)}>
                  <span className={styles.openDot} style={{ background: state.color }} aria-hidden="true" />
                  <span>
                    <span className={styles.openName}>{table.name}</span>
                    <span className={styles.openMeta}>{state.label}{minutesSince(table.check!.openedAt) == null ? "" : ` · ${minutesSince(table.check!.openedAt)} นาที`}</span>
                  </span>
                  <span className={styles.openAmount}><span className={styles.baht}>฿</span>{money(table.check!.amountDue)}</span>
                </button>
              </li>)}</ul>}
          <div className={styles.hint}>เรียงตาม <b>โต๊ะที่ต้องไปก่อน</b>: ค้างส่งครัว → พร้อมเสิร์ฟ → ครัวกำลังทำ → เสิร์ฟครบรอเก็บเงิน → ยังไม่สั่ง</div>
        </>}</aside>
      </div></div></Spin> : screen === "KITCHEN" ? <Spin spinning={working}><section className={styles.kitchenBoard}>
          {/* หัวจอเหลือแถวเดียว — ชื่อจอกับคำอธิบายไม่ช่วยคนที่ยืนทำอาหาร พื้นที่นั้นไปเป็น
              ตัวกรองสถานี ซึ่งเป็นวิธีที่ครัวแบ่งงานกันจริง (ครัวร้อน/บาร์ อยู่คนละที่) */}
          <div className={styles.kitchenBar}>
            <details className={styles.kitchenMenuAvailability}>
              <summary>เมนูหมดวันนี้ {menuItems.filter((item) => item.availability === "SOLD_OUT_TODAY").length}</summary>
              <div className={styles.kitchenMenuAvailabilityList}>
                {menuItems.map((item) => <button type="button" key={item.sku}
                  className={item.availability === "SOLD_OUT_TODAY" ? styles.kitchenMenuSoldOut : ""}
                  onClick={() => void toggleMenuAvailability(item)}>
                  <span>{item.name}{item.availability === "SOLD_OUT_TODAY" && item.unavailableReason ? ` · ${item.unavailableReason}` : ""}</span>
                  <b>{item.availability === "SOLD_OUT_TODAY" ? "เปิดขาย" : "ปิดขายวันนี้"}</b>
                </button>)}
              </div>
            </details>
            <button type="button"
              aria-pressed={stationFilter === null}
              className={`${styles.kitchenFilter} ${stationFilter === null ? styles.kitchenFilterOn : ""}`}
              onClick={() => setStationFilter(null)}>ทั้งหมด {countKitchenDishes(tickets)}</button>
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
              ไม่ระบุสถานี {countKitchenDishes(unassignedOpen)}
            </button>}
            <div className={styles.kitchenBarEnd}>
              <span className={styles.kitchenLive}><span className={styles.kitchenLiveDot} aria-hidden="true" />อัปเดตอัตโนมัติ · {timeOf(new Date(boardNow).toISOString())}</span>
              <button type="button" className={`${styles.btn} ${styles.btnIcon} ${chimeOn ? styles.kitchenChimeOn : ""}`}
                aria-pressed={chimeOn}
                onClick={() => {
                  const next = !chimeOn;
                  setChimeOn(next);
                  chimeRef.current = next;
                  try { window.localStorage.setItem("bms.pos.kitchenChime", next ? "1" : "0"); } catch { /* โหมดส่วนตัว */ }
                  // เล่นทันทีตอนเปิด: เป็นทั้งการทดสอบลำโพงและการปลดล็อกเสียงของเบราว์เซอร์
                  // ซึ่งต้องเกิดจากการแตะของคนเท่านั้น
                  if (next) playKitchenChime();
                }}
                title={chimeOn ? "ปิดเสียงเตือนตั๋วใหม่" : "เปิดเสียงเตือนตั๋วใหม่"}
                aria-label={chimeOn ? "ปิดเสียงเตือนตั๋วใหม่" : "เปิดเสียงเตือนตั๋วใหม่"}>
                {chimeOn ? <SoundOutlined /> : <AudioMutedOutlined />}
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => void loadTickets()} title="รีเฟรชคิว" aria-label="รีเฟรชคิว"><ReloadOutlined /></button>
            </div>
          </div>
          <div className={styles.lanes}>{LANES.map((lane) => {
            const groups = kitchenGroups.filter((group) => group.status === lane.status);
            return <section className={styles.lane} style={{ "--lane-color": lane.color } as CSSProperties} key={lane.status}>
              <div className={styles.laneHead}><strong>{lane.label}</strong><span className={styles.laneCount}>{groups.reduce((sum, group) => sum + group.totalQty, 0)}</span></div>
              <div className={styles.laneScroll}>
                {groups.length === 0 && <div className={styles.laneEmpty}>ว่าง</div>}
                {groups.map((group) => {
                  const elapsed = kitchenElapsedSeconds(group.referenceAt, boardNow);
                  const urgency = kitchenUrgency(elapsed, slaForStationRef(group, stationSlas));
                  return <article className={styles.ticket} key={group.key}>
                    <div className={styles.ticketHead}>
                      <span className={styles.ticketTable}>{group.tableLabel ?? "ไม่ระบุโต๊ะ"}{group.roundNo == null ? "" : ` · รอบ ${group.roundNo}`}</span>
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
                        {group.ticketIds.length > 1 ? `${lane.nextLabel} ทั้งใบ` : lane.nextLabel} <ArrowRightOutlined />
                      </button>}
                      <button type="button" className={`${styles.btn} ${styles.btnIcon}`} onClick={() => setGroupMenu(group)}
                        title="จัดการใบนี้" aria-label="จัดการใบนี้"><MoreOutlined /></button>
                    </div>
                  </article>;
                })}
              </div>
            </section>;
          })}</div>
        </section></Spin> : null}
    </div>

    <Modal title={`แก้จำนวนคน ${check?.tableName ?? ""}`} open={guestOpen} onCancel={() => setGuestOpen(false)} confirmLoading={working} okText="บันทึก" getContainer={modalContainer}
      onOk={() => void action("set_guest_count", { guestCount: Number(guestEdit) }).then(() => setGuestOpen(false))}>
      <div className={styles.modalGrid}><label>จำนวนลูกค้า<input type="number" min={1} max={500} value={guestEdit} onChange={(event) => setGuestEdit(event.target.value)} /></label></div>
    </Modal>
    {/* งานที่ไม่ได้ทำบ่อยของใบนั้น อยู่หลังปุ่ม ⋯ — รวมทั้งการเลื่อน/ยกเลิก "ทีละรายการ"
        สำหรับรอบที่ครัวทำเสร็จไม่พร้อมกัน (ของทอดเสร็จก่อนแกง) ซึ่งหน้าใบไม่ควรรับภาระ */}
    <Modal title={groupMenu ? `${groupMenu.tableLabel ?? "ใบนี้"}${groupMenu.roundNo == null ? "" : ` · รอบ ${groupMenu.roundNo}`}` : ""}
      open={Boolean(groupMenu)} onCancel={() => setGroupMenu(null)} footer={null}
      getContainer={modalContainer} destroyOnClose>
      {groupMenu && <div className={styles.modalGrid}>
        <div className={styles.sheetNote}>
          {groupMenu.station ?? "ไม่ระบุสถานี"} · {groupMenu.ticketIds.length} รายการในใบนี้
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
              onClick={() => void ticketGroupStatus(one, "CANCELLED")}>ยกเลิก</button>
          </div>;
        })}
        <div className={styles.sheetActions}>
          {/* กดผิดที่จอครัวเกิดจริงและบ่อย — เดิมกดพลาดเป็น "พร้อมเสิร์ฟ" แล้วแก้ไม่ได้เลย
              ย้อนได้ทีละขั้น · ใบที่ยกเลิกไปแล้วย้อนไม่ได้ (บรรทัดหลุดจากบิลไปแล้ว) */}
          {PREVIOUS_KITCHEN_STATUS[groupMenu.status] && <button type="button" className={styles.btn}
            onClick={() => void ticketGroupStatus(groupMenu, PREVIOUS_KITCHEN_STATUS[groupMenu.status]!)}>
            <ArrowLeftOutlined /> ย้อนกลับไป {LANES.find((lane) => lane.status === PREVIOUS_KITCHEN_STATUS[groupMenu.status])?.label}
          </button>}
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => void ticketGroupStatus(groupMenu, "CANCELLED")}>
            <CloseCircleOutlined /> ยกเลิกทั้งใบ ({groupMenu.ticketIds.length} รายการ)
          </button>
        </div>
      </div>}
    </Modal>
    <Modal title="ผู้ปฏิบัติงาน" open={operatorOpen} onCancel={() => setOperatorOpen(false)} onOk={() => setOperatorOpen(false)} okText="ใช้บัญชีนี้" okButtonProps={{ disabled: !operatorReady }} getContainer={modalContainer}>
      <div className={styles.modalGrid}>
        <Alert type="info" showIcon message="ทุกการกระทำที่หน้านี้บันทึกในชื่อบัญชีที่เลือก — เปลี่ยนคนเมื่อสลับกะหรือสลับพนักงาน" />
        <label>พนักงาน<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}><option value="">เลือกพนักงาน</option>{staff.map((person) => <option key={person.id} value={person.id} disabled={!person.hasPin}>{person.name ?? person.email ?? person.id}{person.hasPin ? "" : " · ยังไม่มี PIN"}</option>)}</select></label>
        <label>PIN<input value={actorPin} onChange={(event) => setActorPin(event.target.value)} type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" /></label>
      </div>
    </Modal>
    <Modal title={`เปิดบิล ${openTable?.name ?? ""}`} open={Boolean(openTable)} onCancel={() => setOpenTable(null)} onOk={() => void openCheck()} confirmLoading={working} okText="เปิดโต๊ะ" getContainer={modalContainer}><div className={styles.modalGrid}><label>จำนวนลูกค้า<input type="number" min={1} max={500} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} /></label></div></Modal>
    <Modal
      title={menuHit
        ? <span className={styles.menuModalTitle}>{menuHit.productName}
            <small>{menuHit.size !== "-" ? `${menuHit.size} · ` : ""}฿{money(menuHit.packPrice)} / {menuHit.unitName}</small>
          </span>
        : "เพิ่มเมนู"}
      open={Boolean(menuHit)}
      onCancel={() => setMenuHit(null)}
      onOk={() => void addMenu()}
      confirmLoading={working}
      okButtonProps={{ disabled: unmetModifiers.length > 0 }}
      okText={`เพิ่มในบิล · ฿${money(menuHitTotal)}`}
      cancelText="ยกเลิก"
      getContainer={modalContainer}
    >
      {menuHit && <div className={styles.modalGrid}>
        {/* จำนวนเป็น stepper ไม่ใช่ช่องพิมพ์ — บนแท็บเล็ตการพิมพ์เลขตัวเดียวต้องเรียกคีย์บอร์ด
            ขึ้นมาบังครึ่งจอ · ชิป 1–5 ไว้ให้โต๊ะที่สั่งทีละหลายที่ */}
        <div>
          <span className={styles.fieldLabel}>จำนวน</span>
          <div className={styles.qtyRow}>
            <div className={styles.stepper}>
              <button type="button" aria-label="ลดจำนวน" disabled={menuQty <= 1}
                onClick={() => setMenuQty((current) => Math.max(1, current - 1))}>−</button>
              <span className={styles.stepperValue} aria-live="polite">{menuQty}</span>
              <button type="button" aria-label="เพิ่มจำนวน" disabled={menuQty >= 99}
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
          <span className={styles.fieldLabel}>โน้ตถึงครัว <span className={styles.fieldRule}>· ไม่บังคับ</span></span>
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
            onChange={(event) => setKitchenNote(event.target.value)} placeholder="พิมพ์เองได้" />
        </div>
        {/* ยอดรวมอยู่บนปุ่มด้วย (okText) — บรรทัดนี้บอก "มาจากไหน" ให้ตรวจก่อนกด */}
        <div className={styles.menuTotalRow}>
          <span>{unmetModifiers.length > 0
            ? describeUnmetModifierGroups(unmetModifiers)
            : `฿${money(menuHitUnitPrice)} × ${menuQty}${menuHitUnitPrice !== menuHit.packPrice ? " (รวมตัวเลือก)" : ` / ${menuHit.unitName}`}`}</span>
          <b><span className={styles.baht}>฿</span>{money(menuHitTotal)}</b>
        </div>
      </div>}
    </Modal>
    <Modal title={shiftModal === "OPEN" ? "เปิดกะ" : "ปิดกะ"} open={Boolean(shiftModal)} onCancel={() => setShiftModal(null)} onOk={() => void changeShift()} confirmLoading={working} okButtonProps={{ disabled: !operatorReady }} okText={shiftModal === "OPEN" ? "เปิดกะ" : "ยืนยันปิดกะ"} getContainer={modalContainer}><div className={styles.modalGrid}><Alert type={shiftModal === "OPEN" ? "info" : "warning"} message={shiftModal === "OPEN" ? "ระบุเงินทอนตั้งต้น" : "นับเงินสดจริงในลิ้นชัก"} /><label>จำนวนเงิน<input type="number" min={0} step="0.01" value={cashAmount} onChange={(event) => setCashAmount(Number(event.target.value))} /></label></div></Modal>
    {/* กล่องนี้มีสองงานคนละชั้น: แถบสรุปคือ "งานของแคชเชียร์" (ทอนเท่าไร ครัวได้กี่ใบ
        คิดซ้ำหรือเปล่า) ส่วนกระดาษคือ "สิ่งที่ลูกค้าจะได้" — ยอด/ส่วนลด/VAT/แต้ม อยู่บน
        กระดาษที่เดียว ไม่ซ้ำกับแถบสรุป เพราะเลขเดียวกันสองที่คือจุดที่เริ่ม drift
        destroyOnClose เพราะกฎพิมพ์เล็งที่ `#pos-receipt` — ปล่อยให้ค้างสองใบใน DOM
        แล้ว print dialog จะไม่รู้ว่าต้องพิมพ์ใบไหน */}
    <Modal title="ปิดบิลสำเร็จ" open={Boolean(settlementReceipt)} onCancel={() => setSettlementReceipt(null)} footer={null} width={620} getContainer={modalContainer} destroyOnClose>
      {settlementReceipt && <div className={styles.modalGrid}>
        <div className={styles.receiptHero}><span>{settlementReceipt.result.docNo ?? settlementReceipt.result.receiptNo ?? "ใบเสร็จ"}<small>{settlementReceipt.check.tableName} · {settlementReceipt.member?.name ?? "ลูกค้าทั่วไป"}</small></span><strong>฿{money(settlementReceipt.result.total)}</strong></div>
        <div className={styles.summaryGrid}><span>เงินทอน<b>{settlementReceipt.result.cashChange == null ? "—" : `฿${money(settlementReceipt.result.cashChange)}`}</b></span><span>ตั๋วครัว<b>{settlementReceipt.result.kitchenTickets}</b></span><span>สถานะ<b>{settlementReceipt.result.replayed ? "รายการเดิม (ไม่คิดซ้ำ)" : "รับชำระแล้ว"}</b></span></div>
        {receiptPayload(settlementReceipt)
          ? <ReceiptPaper payload={receiptPayload(settlementReceipt)!} />
          : <Alert type="warning" showIcon message="ยังประกอบใบเสร็จไม่ได้" description="ราคาบางบรรทัดยังไม่ครบ — เปิดบิลนี้จากแท็บบิลแล้วพิมพ์ซ้ำ" />}
        <div className={styles.receiptActions}><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void printReceipt(settlementReceipt, settlementReceipt.result.cashTendered != null)}><PrinterOutlined /> พิมพ์ใบเสร็จ</button></div>
        <button type="button" className={styles.btn} onClick={() => setSettlementReceipt(null)}>กลับไปผังโต๊ะ</button>
      </div>}
    </Modal>
    {/* กล่องนี้เคยโชว์รายการสินค้าอย่างเดียว ไม่โชว์ส่วนลด/VAT ทั้งที่ response มีให้แล้ว
        · `lineTotal` คือราคาป้ายก่อนหักราคาส่ง/โปร (9.22) บิลที่ติดโปรจึงแสดงรายการที่
        บวกแล้ว **ไม่เท่ายอดรวม** โดยไม่มีอะไรอธิบาย — ตอนนี้เรนเดอร์กระดาษจริงทั้งใบแทน */}
    <Modal title={selectedReceipt && !("result" in selectedReceipt) ? selectedReceipt.docNo ?? "รายละเอียดบิล" : "รายละเอียดบิล"} open={Boolean(selectedReceipt)} onCancel={() => setSelectedReceipt(null)} footer={null} width={620} getContainer={modalContainer} destroyOnClose>
      {selectedReceipt && !("result" in selectedReceipt) && <div className={styles.modalGrid}>
        {billHistoryNote(selectedReceipt) && <Alert type="warning" showIcon message={`บิลนี้${billHistoryNote(selectedReceipt)}`} description="กระดาษที่พิมพ์จากที่นี่คือ “ใบขายเดิม” ยอดบนใบยังเป็นยอดตอนขายจริง การคืน/ยกเลิกออกเป็นเอกสารคนละใบ — ดูรายละเอียดการคืนที่โหมดค้าปลีก" />}
        {receiptPayload(selectedReceipt)
          ? <ReceiptPaper payload={receiptPayload(selectedReceipt)!} />
          : <Alert type="warning" showIcon message="ยังประกอบใบเสร็จไม่ได้" description="ราคาบางบรรทัดของบิลนี้ยังไม่ครบ" />}
        <div className={styles.receiptActions}><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void printReceipt(selectedReceipt)}><PrinterOutlined /> {billHistoryNote(selectedReceipt) ? "พิมพ์ใบขายเดิม" : "พิมพ์ซ้ำ"}</button></div>
      </div>}
    </Modal>
    <Modal
      title={lang === "en" ? "Support diagnostics" : "ข้อมูลวิเคราะห์สำหรับ Support"}
      open={supportOpen}
      onCancel={() => { if (!supportWorking) setSupportOpen(false); }}
      getContainer={modalContainer}
      footer={[
        <Button key="cancel" disabled={Boolean(supportWorking)} onClick={() => setSupportOpen(false)}>{lang === "en" ? "Cancel" : "ยกเลิก"}</Button>,
        <Button key="export" icon={<DownloadOutlined />} loading={supportWorking === "export"} disabled={Boolean(supportWorking)} onClick={() => void supportAction("export")}>Export Log</Button>,
        <Button key="send" type="primary" icon={<CustomerServiceOutlined />} loading={supportWorking === "send"} disabled={Boolean(supportWorking) || !supportConfirmed} onClick={() => void supportAction("send")}>{lang === "en" ? "Send to Support" : "ส่งให้ Support"}</Button>,
      ]}
    >
      <Alert type="info" showIcon message={lang === "en" ? "The last 24 hours will be included. Request bodies, PINs and tokens are excluded." : "ระบบจะรวมข้อมูล 24 ชั่วโมงล่าสุด โดยไม่ส่ง request body, PIN หรือ token"} />
      <Input.TextArea style={{ marginTop: 16 }} rows={4} maxLength={2000} showCount value={supportDescription} onChange={(event) => setSupportDescription(event.target.value)} placeholder={lang === "en" ? "What happened before the error?" : "ก่อนเกิดปัญหาทำอะไรอยู่ และพบข้อความอะไร"} />
      <Checkbox style={{ marginTop: 12 }} checked={supportConfirmed} onChange={(event) => setSupportConfirmed(event.target.checked)}>{lang === "en" ? "I consent to send this diagnostic bundle to Support." : "ยินยอมส่งข้อมูลวิเคราะห์ชุดนี้ให้ทีม Support"}</Checkbox>
    </Modal>
    <Modal title={`รับชำระ ${check?.tableName ?? ""}`} open={checkoutOpen} onCancel={() => setCheckoutOpen(false)} onOk={() => void settle()} confirmLoading={working} okText="ยืนยันรับเงิน" okButtonProps={{ disabled: Boolean(checkoutBlock) }} width={680} getContainer={modalContainer}>{check && <div className={styles.modalGrid}>
      <div className={styles.memberBox}><b>สมาชิก (ไม่บังคับ)</b>{checkMember ? <div className={styles.memberSelected}><span>{checkMember.name} · {checkMember.memberNo ?? checkMember.phone ?? "สมาชิก"}<small>แต้มใช้ได้ {checkMember.pointsUsable}</small></span><button type="button" className={styles.btn} onClick={() => setSelectedMember(null)}>เอาออก</button></div> : <><div className={styles.searchRow}><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchMembers(); } }} placeholder="ชื่อ / เบอร์ / เลขสมาชิก อย่างน้อย 3 ตัว" /><button type="button" className={styles.btn} onClick={() => void searchMembers()}>ค้นหา</button></div>{memberResults.map((member) => <button type="button" className={styles.memberResult} key={member.customerId} onClick={() => setSelectedMember(member)}><span>{member.name}<small>{member.memberNo ?? member.phone ?? ""}</small></span><b>{member.pointsUsable} แต้ม</b></button>)}</>}</div>
      <div className={styles.total}><span>ยอดที่ต้องชำระ</span><strong><span className={styles.baht}>฿</span>{money(checkoutDue)}</strong></div>{payments.map((payment, index) => <div className={styles.modalGrid} key={payment.id}><label>วิธีชำระ<select value={payment.method} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, method: event.target.value, tendered: "", ref: "" } : row))}><option value="CASH">เงินสด</option><option value="QR">QR / พร้อมเพย์</option><option value="CARD">บัตร</option></select></label><label>ยอดช่องทางนี้<input type="number" min={0.01} step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value } : row))} /></label>{payment.method === "CASH" ? <label>เงินสดที่รับมา<input type="number" min={Number(payment.amount) || 0} step="0.01" value={payment.tendered} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, tendered: event.target.value } : row))} /></label> : <label>เลขอ้างอิง<input value={payment.ref} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, ref: event.target.value } : row))} /></label>}{payments.length > 1 && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setPayments((current) => current.filter((row) => row.id !== payment.id))}>ลบช่องทาง {index + 1}</button>}</div>)}<button type="button" className={styles.btn} onClick={() => setPayments((current) => appendSplitPaymentRow(current, check.amountDue, `pay-${Date.now()}`))}>+ แบ่งชำระอีกช่องทาง</button><Alert type={checkoutBlock ? "warning" : "success"} showIcon message={checkoutBlock ? `รวม ฿${money(paymentTotal)} · ${checkoutBlock}` : `รวม ฿${money(paymentTotal)} · ครบยอด`} /></div>}</Modal>
    <Modal title={`จัดการบิล ${check?.tableName ?? ""}`} open={moreOpen} onCancel={() => setMoreOpen(false)} footer={null} getContainer={modalContainer}>
      <div className={styles.sheetActions}>
        <button type="button" className={styles.btn} onClick={() => { setMoreOpen(false); setTargetTableId(availableTables[0]?.id ?? ""); setMoveOpen(true); }}><SwapOutlined /> ย้ายโต๊ะ</button>
        <button type="button" className={styles.btn} onClick={() => { setMoreOpen(false); setGuestEdit(String(check?.guestCount ?? 1)); setGuestOpen(true); }}>แก้จำนวนคน</button>
        <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => { setMoreOpen(false); openCancel(); }}><CloseCircleOutlined /> ยกเลิกบิล</button>
      </div>
    </Modal>
    {/* ปิดขายเป็นงานที่ย้อนคืนยาก (เมนูหายจากทุกช่องทางของสาขานี้ทันที) จึงมีจังหวะยืนยัน
        หนึ่งครั้งพร้อมเลือกสาเหตุ — แต่ยังจบใน 2 แตะ เท่ากับแถบเดิมที่กดพลาดได้ */}
    <Modal title={soldOutSheet
        ? `${soldOutSheet.availability === "SOLD_OUT_TODAY" ? "ปิดขายอยู่" : "ปิดขาย"} ${soldOutSheet.name}`
        : ""}
      open={Boolean(soldOutSheet)}
      onCancel={() => setSoldOutSheet(null)} footer={null} getContainer={modalContainer} destroyOnClose>
      {soldOutSheet && <div className={styles.sheetActions}>
        {soldOutSheet.availability === "SOLD_OUT_TODAY"
          ? <>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => { const item = soldOutSheet; setSoldOutSheet(null); void setMenuAvailability(item, false); }}>
                เปิดขายเดี๋ยวนี้
              </button>
              <div className={styles.sheetNote}>
                {[soldOutSheet.unavailableReason ? `ปิดเพราะ ${soldOutSheet.unavailableReason}` : null,
                  soldOutSheet.unavailableResetsAt ? `เปิดเองอัตโนมัติ ${timeOf(soldOutSheet.unavailableResetsAt)} น.` : null]
                  .filter(Boolean).join(" · ") || "ปิดเฉพาะสาขานี้"}
              </div>
            </>
          : <>
              {MENU_SOLD_OUT_REASONS.map((reason) => <button key={reason} type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => { const item = soldOutSheet; setSoldOutSheet(null); void setMenuAvailability(item, true, reason); }}>
                <CloseCircleOutlined /> ปิดขายวันนี้ — {reason}
              </button>)}
              <div className={styles.sheetNote}>
                ปิดเฉพาะสาขานี้ · กลับมาขายเองเมื่อถึงรอบเปิดร้านถัดไป หรือแตะการ์ดเพื่อเปิดขายเมื่อไหร่ก็ได้
              </div>
            </>}
      </div>}
    </Modal>
    <Modal title="ย้ายโต๊ะ" open={moveOpen} onCancel={() => setMoveOpen(false)} onOk={() => void action("move", { targetTableId }).then(() => setMoveOpen(false))} confirmLoading={working} okText="ย้าย" getContainer={modalContainer}><div className={styles.modalGrid}><label>โต๊ะปลายทาง<select value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.code}</option>)}</select></label></div></Modal>
    <Modal title={`ยกเลิกบิล ${check?.tableName ?? ""}`} open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => void cancelCheck()} confirmLoading={working} okText="ยืนยันยกเลิก" okButtonProps={{ danger: true }} getContainer={modalContainer}><div className={styles.modalGrid}>{cancelNeedsApproval && <Alert type="warning" showIcon message="บิลนี้ส่งครัวหรือจองวัตถุดิบแล้ว" description="คนรับออร์เดอร์เริ่มยกเลิกได้ แต่ต้องให้ผู้มีสิทธิ์ pos.void ซึ่งเป็นคนละคนกด PIN อนุมัติ" />}<label>Note / เหตุผลที่ยกเลิก (จำเป็น)<textarea rows={3} maxLength={300} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="เช่น ลูกค้าเปลี่ยนใจ เปิดผิดโต๊ะ หรือรับรายการผิด" /></label>{cancelNeedsApproval && <><label>ผู้อนุมัติ<select value={cancelApproverId} onChange={(event) => setCancelApproverId(event.target.value)}><option value="">เลือกผู้อนุมัติ</option>{voidApprovers.map((person) => <option key={person.id} value={person.id}>{person.name || person.email || person.id}</option>)}</select></label><label>PIN ผู้อนุมัติ<input type="password" inputMode="numeric" autoComplete="off" value={cancelApproverPin} onChange={(event) => setCancelApproverPin(event.target.value)} /></label>{voidApprovers.length === 0 && <Alert type="error" showIcon message="ไม่มีผู้อนุมัติที่พร้อมใช้งาน" description="ตั้ง PIN และมอบสิทธิ์ pos.void ให้ผู้จัดการหรือหัวหน้าก่อน" />}</>}</div></Modal>
  </main>;
}
