"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppstoreOutlined, ArrowRightOutlined, CloseCircleOutlined, CoffeeOutlined, CustomerServiceOutlined, DownloadOutlined, ReloadOutlined, ShopOutlined, SwapOutlined, WalletOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Input, Modal, Segmented, Spin, Tag, message } from "antd";
import { cashRoundingDelta, type CashRounding } from "@/lib/pos/cashRounding";
import { appendSplitPaymentRow, type PosPaymentDraft } from "@/lib/pos/paymentDraft";
import { describePosFailure, describeTransportFailure } from "@/lib/pos/failureMessage";
import { useI18n } from "@/lib/i18nContext";
import { flushSupportActivity, localSupportEventCount, recordSupportActivity } from "@/lib/supportActivity";
import PosGuideAssistant from "@/components/work-assistant/PosGuideAssistant";
import styles from "./restaurant.module.css";

const TOKEN_KEY = "bms.pos.deviceToken";
type Staff = { id: string; name: string | null; email: string | null; hasPin: boolean };
type Session = { device: { id: string; code: string; name: string | null }; location: { id: string; name: string; branchCode: string } | null; shift: { id: string; openedAt: string; openingFloat: number } | null; cashiers: Staff[]; approvers: Array<Staff & { approvals: string[] }>; kitchenOperators: Staff[]; businessArchetype?: string | null; vat: { cashRounding?: CashRounding } };
type FloorCheck = { id: string; status: string; guestCount: number; amountDue: number; openedAt: string; itemCount: number; unsentCount: number; version: number; reservedVersion: number | null };
type DiningTable = { id: string; areaId: string; code: string; name: string; seats: number; blocked: boolean; status: "AVAILABLE" | "OCCUPIED" | "BLOCKED"; check: FloorCheck | null };
type Floor = { areas: Array<{ id: string; name: string; sortOrder: number }>; tables: DiningTable[] };
type CheckItem = { id: string; sku: string; productName: string; size: string; packQty: number; packCode: string | null; unitName: string | null; packPrice: number | null; modifierCodes: string[]; modifierNames: string[]; kitchenNote: string | null; status: "NEW" | "SENT" | "CANCELLED"; roundNo: number | null; sentAt: string | null; kitchenStatus: string | null };
type RestaurantCheck = { id: string; tableId: string; tableCode: string; tableName: string; areaName: string; status: string; guestCount: number; amountDue: number; version: number; reservedVersion: number | null; hasCurrentOrder: boolean; openedAt: string; items: CheckItem[] };
type SearchItem = { sku: string; name: string; price: number; availableTotal: number; availableSizes: Array<{ size: string; available: number; price?: number }> };
type MenuItem = SearchItem & { kitchenStation: string | null; hasModifiers: boolean; imageUrl: string | null };
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
type ScanHit = { sku: string; productName: string; size: string; packCode: string; unitName: string; baseQty: number; packPrice: number; available: number; modifiers: Array<{ code: string; name: string; priceDelta: number }> };
type KitchenTicket = { id: string; orderId: string | null; checkId: string | null; tableCode: string | null; tableName: string | null; roundNo: number | null; kitchenNote: string | null; station: string | null; status: string; modifierCodes: string[]; productName: string; size: string; packQty: number | null; qty: number; createdAt: string };

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
  const [activeArea, setActiveArea] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");
  const [check, setCheck] = useState<RestaurantCheck | null>(null);
  // ORDER = จอสั่งอาหาร (กริดเมนูเต็มพื้นที่) · FLOOR = ผังโต๊ะ · KITCHEN = จอครัว
  // กดโต๊ะแล้วเด้งเข้า ORDER เสมอ เพราะงานถัดไปของคนกดคือ "สั่งอาหาร" ไม่ใช่ดูผังต่อ
  const [screen, setScreen] = useState<"ORDER" | "FLOOR" | "KITCHEN">("ORDER");
  const [actorUserId, setActorUserId] = useState("");
  const [actorPin, setActorPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategory, setMenuCategory] = useState("");
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
  // Modal ของ antd portal ไป document.body โดยดีฟอลต์ ซึ่งอยู่นอก .page —
  // ตัวแปรสี/เส้นขอบทั้งหมด (--line, --panel, --ink, ...) ถูกประกาศไว้ที่ .page
  // เท่านั้น พอ modal portal ออกไปนอก scope นั้น border/background ของ input ในฟอร์ม
  // จะ resolve ไม่ได้แล้วหายไปเงียบ ๆ (เห็นแค่ตัวเลขลอยไม่มีกรอบ) — ต้องส่ง getContainer
  // ให้ modal render อยู่ใต้ .page แทนเพื่อให้ยังเห็นตัวแปรพวกนี้
  const rootRef = useRef<HTMLElement>(null);
  const workingRef = useRef(false);
  // ⚠️ ต้องเป็น reference เดิมทุก render — ถ้าสร้าง closure ใหม่ทุกครั้ง antd จะเห็นว่า
  // container เปลี่ยน แล้ว portal ใหม่ซ้ำ ๆ จน animation ค้างที่ `ant-zoom-appear-start`
  // (opacity 0) = กล่องอยู่ใน DOM ตำแหน่งถูก แต่มองไม่เห็นทั้งใบ
  const modalContainer = useCallback(() => rootRef.current ?? document.body, []);

  useEffect(() => { setToken(window.localStorage.getItem(TOKEN_KEY) ?? ""); setReady(true); }, []);
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
  // ครัวกดยกเลิกตั๋วแล้ว แต่บรรทัดยังอยู่ในบิลและยังถูกคิดเงิน (ตั้งใจ — การแก้บิลต้อง void)
  // ถ้าไม่บอกที่จอนี้ แคชเชียร์จะเก็บเงินค่าอาหารที่ครัวไม่ได้ทำ โดยที่ตั๋วก็หายจากกระดานครัวไปแล้ว
  // ตัดออกจากยอดเรียบร้อยแล้ว — โชว์ไว้ให้ตอบลูกค้าได้ว่าจานนั้นหายไปไหน ไม่ใช่คำเตือน
  const kitchenDropped = check?.items.filter((item) => item.status === "CANCELLED") ?? [];
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
    if (!check) return [] as Array<{ key: string; label: string; items: CheckItem[] }>;
    const rounds = new Map<number, CheckItem[]>();
    const unsent: CheckItem[] = [];
    for (const item of check.items) {
      if (item.status === "NEW") { unsent.push(item); continue; }
      const round = item.roundNo ?? 0;
      rounds.set(round, [...(rounds.get(round) ?? []), item]);
    }
    const groups = [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, items]) => ({
      key: `round-${round}`,
      label: `รอบ ${round || 1} · ส่งครัวแล้ว${items[0]?.sentAt ? ` ${timeOf(items[0].sentAt)}` : ""}`,
      items,
    }));
    if (unsent.length) groups.push({ key: "unsent", label: "ยังไม่ส่งครัว", items: unsent });
    return groups;
  }, [check]);
  const operatorReady = Boolean(actorUserId && actorPin);
  const operatorName = staff.find((person) => person.id === actorUserId)?.name ?? staff.find((person) => person.id === actorUserId)?.email ?? "";
  // เกณฑ์เดียวที่ใช้ทั้งคำเตือนและป้ายยอดเงิน: "มีบรรทัดที่ยังไม่ส่งครัวจริงไหม"
  // (เทียบ version กับ reservedVersion ตรง ๆ จะเตือนตั้งแต่บิลยังว่าง เพราะบิลใหม่มี
  // version = 0 แต่ reservedVersion = null) · ยอดที่แสดงยังเป็นตัวเลขจาก server เสมอ
  // ห้ามคำนวณเองที่จอ เพราะจะกลายเป็นสูตรเงินชุดที่สอง
  const hasUnsent = Boolean(check?.items.some((item) => item.status === "NEW"));
  const paymentTotal = Math.round(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) * 100) / 100;
  const checkoutDue = check == null ? 0 : Math.round((check.amountDue + (
    payments.length === 1 && payments[0].method === "CASH"
      ? cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")
      : 0
  )) * 100) / 100;
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
  async function loadTickets() { const data = await json("/api/pos/kitchen/tickets?limit=200"); setTickets(Array.isArray(data.tickets) ? data.tickets : []); }
  // เมนูทั้งร้านโหลดครั้งเดียวไว้เรนเดอร์เป็นกริด — ไม่ต้องพิมพ์ค้นหาก่อนถึงจะเห็นเมนู
  // ต่างจาก /api/pos/search ที่ต้องมี query ก่อนถึงจะคืนอะไรมา
  async function loadMenu() { const data = await json("/api/pos/restaurant/menu"); setMenuItems(Array.isArray(data.items) ? data.items : []); }
  async function loadCheck(id: string) { const data = await json(`/api/pos/restaurant/checks/${id}`); setCheck(data.check); return data.check as RestaurantCheck; }
  async function refresh() { if (!token) return; setLoading(true); try { if (!(await loadSession())) return; await Promise.all([loadFloor(), loadTickets(), loadMenu()]); if (check?.id) await loadCheck(check.id).catch(() => setCheck(null)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setLoading(false); } }
  useEffect(() => { if (token) void refresh(); else if (ready) setLoading(false); }, [token, ready]);
  // กรองจากเมนูที่โหลดไว้แล้วในเครื่อง ไม่ยิง API ซ้ำ — ค้นหาที่นี่เป็นตัวช่วยกรองกริด
  // ไม่ใช่ทางเดียวเหมือนเดิม (เมนูร้านอาหารมีไม่มาก พิมพ์ทุกครั้งเสียเวลาเปล่า)
  const menuStations = useMemo(() => {
    const seen = new Set<string>();
    menuItems.forEach((item) => { if (item.kitchenStation) seen.add(item.kitchenStation); });
    return [...seen];
  }, [menuItems]);
  const visibleMenuItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (menuCategory && (item.kitchenStation ?? "") !== menuCategory) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
    });
  }, [menuItems, menuCategory, search]);
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
  async function chooseMenu(item: SearchItem) { await run(async () => { const size = item.availableSizes.find((v) => v.available > 0)?.size ?? item.availableSizes[0]?.size ?? ""; const hit = await json(`/api/pos/scan?code=${encodeURIComponent(item.sku)}&size=${encodeURIComponent(size)}&withImage=1`); setMenuHit(hit); setModifierCodes([]); setKitchenNote(""); setMenuQty(1); }); }
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
  async function settle() {
    if (!check) return;
    if (payments.length === 0) { message.error("ต้องระบุช่องทางชำระเงิน"); return; }
    if (Math.abs(paymentTotal - checkoutDue) > 0.009) { message.error(`ยอดชำระรวมต้องเท่ากับ ฿${money(checkoutDue)}`); return; }
    await run(async () => {
      const result = await json(`/api/pos/restaurant/checks/${check.id}`, {
        method: "POST",
        body: JSON.stringify(auth({
          action: "settle",
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
      message.success(`ปิดบิลแล้ว ฿${money(result.total)}`);
      setCheckoutOpen(false);
      setPayments([]);
      setCheck(null);
      setSelectedTableId("");
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
    if (!cancelReason.trim()) { message.error("ต้องระบุเหตุผลที่ยกเลิกบิล"); return; }
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
    });
  }
  // เลื่อนสถานะตั๋ว — ต้องมีคำตอบที่จอทุกครั้ง เพราะตั๋วที่เลื่อนแล้วจะย้ายเลน (หรือหายไปเลย
  // เมื่อยกเลิก เพราะไม่มีเลนของ CANCELLED) ถ้าเงียบ คนครัวอ่านว่า "กดแล้วไม่เกิดอะไร"
  // และการยกเลิกต้องบอกด้วยว่า **รายการยังอยู่ในบิล** ไม่งั้นเข้าใจว่าตัดออกให้แล้ว
  const TICKET_DONE_TEXT: Record<string, string> = {
    PREPARING: "เริ่มทำแล้ว", READY: "พร้อมเสิร์ฟแล้ว", SERVED: "เสิร์ฟแล้ว",
  };
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
  async function changeShift() { if (!shiftModal) return; await run(async () => { await json("/api/pos/shift", { method: "POST", body: JSON.stringify({ action: shiftModal.toLowerCase(), userId: actorUserId, pin: actorPin, ...(shiftModal === "OPEN" ? { openingFloat: cashAmount } : { countedCash: cashAmount }) }) }); setShiftModal(null); setCashAmount(0); await loadSession(); }); }
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
          <button type="button" className={`${styles.btn} ${session?.shift ? "" : styles.btnPrimary}`} onClick={() => setShiftModal(session?.shift ? "CLOSE" : "OPEN")}>{session?.shift ? "ปิดกะ" : "เปิดกะ"}</button>
        </div>
      </header>
      {!session?.shift && <Alert type="warning" showIcon message="ยังไม่เปิดกะ — เปิดกะก่อนจึงจะเปิดโต๊ะและรับออร์เดอร์ได้" />}
      {error && <Alert type="error" showIcon closable message={error} onClose={() => setError("")} />}

      {screen !== "KITCHEN" ? <Spin spinning={working}><div className={styles.floorWrap}>
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
              <input className={styles.field} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="กรองเมนู (ไม่จำเป็น — แตะการ์ดได้เลย)" />
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
              {visibleMenuItems.length === 0
                ? <div className={styles.menuEmpty}>{menuItems.length === 0
                    ? "ยังไม่มีเมนูที่ขายที่โต๊ะได้ — สินค้าต้องเปิดขาย มีราคา และไม่ได้ถูกใช้เป็นวัตถุดิบของสูตรอื่น"
                    : "ไม่พบเมนูที่ตรงกับที่กรอง"}</div>
                : <div className={styles.dishGrid}>{visibleMenuItems.map((item) => {
                    const tint = menuCardTint(item.kitchenStation, menuStations);
                    const inCheck = qtyInCheckBySku.get(item.sku) ?? 0;
                    return <button key={item.sku} type="button" className={styles.dishCard} onClick={() => void chooseMenu(item)}>
                      <span className={styles.dishArt} style={{ background: tint.bg, color: tint.ink }}>
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt="" />
                          : <span className={styles.dishGlyph} style={{ color: tint.ink }}>{dishArt(item.name, "currentColor")}</span>}
                      </span>
                      {inCheck > 0 && <span className={styles.dishQty}>{inCheck}</span>}
                      <span className={styles.dishBody}>
                        <span className={styles.dishName}>{item.name}</span>
                        <span className={styles.dishFoot}>
                          <span className={styles.dishPrice}><span className={styles.baht}>฿</span>{money(item.price)}</span>
                          {item.hasModifiers && <span className={styles.dishModHint}>มีตัวเลือก</span>}
                        </span>
                      </span>
                      {item.kitchenStation && <span className={styles.dishStation} style={{ background: tint.bg, color: tint.ink }}>{item.kitchenStation}</span>}
                    </button>;
                  })}</div>}
            </>}
        </> : floor.areas.length === 0 ? <div className={styles.setup}><div><div className={styles.setupIcon}><ShopOutlined /></div><h2>ยังไม่มีผังโต๊ะของสาขานี้</h2><p>เริ่มด้วยโซนหน้าร้านและโต๊ะ 12 ตัว</p><button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!session?.shift} onClick={() => void run(async () => { const data = await json("/api/pos/restaurant/floor", { method: "POST", body: JSON.stringify(auth({ tableCount: 12 })) }); setFloor(data); setActiveArea(data.areas[0]?.id ?? ""); })}>สร้างผังเริ่มต้น</button></div></div> : <>
          <div className={styles.panelHeader}><div><h2>ผังโต๊ะ</h2><small>{floor.tables.filter((t) => t.status === "AVAILABLE").length} โต๊ะว่าง · {floor.tables.filter((t) => t.status === "OCCUPIED").length} โต๊ะใช้งาน</small></div><span className={styles.livePill}>LIVE</span></div>
          <div className={styles.areaTabs}>{floor.areas.map((area) => <button key={area.id} type="button" className={`${styles.areaButton} ${activeArea === area.id ? styles.areaButtonActive : ""}`} aria-pressed={activeArea === area.id} onClick={() => setActiveArea(area.id)}>{area.name} · {floor.tables.filter((table) => table.areaId === area.id).length}</button>)}</div>
          {/* การ์ดโต๊ะตอบสามคำถามที่พนักงานถามจริง: นั่งมานานแค่ไหน · ค้างส่งครัวกี่รายการ · เสิร์ฟครบพร้อมเก็บเงินหรือยัง
              สถานะอ่านจากแถบสีข้างการ์ด + ป้ายข้อความ (จุดสี 10px เดิมแยกไม่ออกจากระยะยืน) */}
          <div className={styles.tableGrid}>{visibleTables.map((table) => {
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
          })}</div>

        </>}</section>
        <aside className={styles.checkPanel}>{check ? <>
          {/* หัวแผง = ชื่อโต๊ะ + เวลาที่เปิด + งานที่ทำกับ "ทั้งบิล" (ย้ายมาไว้บนตามที่ออกแบบ
              เพราะสองปุ่มล่างต้องเหลือไว้ให้งานที่ทำบ่อยที่สุด: ส่งครัว กับ คิดเงิน) */}
          <div className={styles.checkHead}>
            <h2>{check.tableName} · {check.guestCount} คน</h2>
            <p>{check.areaName} · เปิดบิล {timeOf(check.openedAt)}{checkMinutes == null ? "" : ` · ${checkMinutes} นาที`}{lastRound ? ` · รอบล่าสุด ${lastRound}` : ""}</p>
            <div className={styles.checkActions}>
              <button type="button" className={styles.btn} onClick={() => { setTargetTableId(availableTables[0]?.id ?? ""); setMoveOpen(true); }}><SwapOutlined /> ย้ายโต๊ะ</button>
              <button type="button" className={styles.btn} onClick={() => { setGuestEdit(String(check.guestCount)); setGuestOpen(true); }}>แก้จำนวนคน</button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={openCancel}>ยกเลิกบิล</button>
            </div>
          </div>

          <div className={styles.items}>
            {check.items.length === 0 && <div className={styles.empty}><p>แตะการ์ดเมนูทางซ้ายเพื่อเริ่มรับออร์เดอร์</p></div>}
            {itemGroups.map((group) => <Fragment key={group.key}>
              <div className={styles.roundLabel}>{group.label}</div>
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
                    <span className={styles.itemMeta}>{[item.size !== "-" ? item.size : null, item.unitName, ...item.modifierNames].filter(Boolean).join(" · ")}</span>
                    {item.kitchenNote && <span className={styles.itemNote}>โน้ตครัว: {item.kitchenNote}</span>}
                    {dropped && <span className={styles.itemDropTag}>ครัวยกเลิก — ตัดออกจากยอดแล้ว ไม่คิดเงิน</span>}
                    {stillCharged && <span className={styles.itemCancelTag}>ครัวยกเลิกรายการนี้ — ยังคิดเงินอยู่</span>}
                    {item.status === "NEW" && <span className={styles.itemCancelTag}>ยังไม่ส่งครัว</span>}
                    {kitchenState && <span className={`${styles.itemKitchenTag} ${kitchenState.loud ? styles.itemKitchenTagLoud : ""}`} style={{ color: kitchenState.color }}>{kitchenState.label}</span>}
                  </span>
                  <span className={styles.itemSide}>
                    {/* ราคาต่อหน่วยที่ server บันทึกไว้ตอนเพิ่มรายการ — ห้ามคูณ/รวมเองที่จอ
                        เพราะตัวเลือกมีส่วนต่างราคาที่ถูกคิดฝั่ง server ตอนส่งครัว */}
                    {item.packPrice != null && <span className={`${styles.itemPrice} ${dropped ? styles.itemPriceVoid : ""}`} title={`ราคาต่อ${item.unitName ?? "หน่วย"}`}><span className={styles.baht}>฿</span>{money(item.packPrice)}</span>}
                    {/* สั่งซ้ำขึ้นเฉพาะบรรทัดที่ส่งครัวไปแล้วหรือถูกยกเลิก — บรรทัด NEW ยังแก้ได้
                        ที่การ์ดเมนูตรงหน้าอยู่แล้ว และช่องนี้เป็นที่ของปุ่มลบ */}
                    {item.status !== "NEW" && <button type="button" className={styles.itemAgain} title={`สั่ง ${item.productName} ซ้ำพร้อมตัวเลือกเดิม`} aria-label={`สั่ง ${item.productName} ซ้ำ`} disabled={working} onClick={() => void reorderLine(item)}><ReloadOutlined /> ซ้ำ</button>}
                    {item.status === "NEW" && <button type="button" className={styles.itemRemove} aria-label="ลบรายการ" disabled={working} onClick={() => void action("remove_item", { itemId: item.id })}><CloseCircleOutlined /></button>}
                  </span>
                </article>;
              })}
            </Fragment>)}
          </div>

          <div className={styles.checkFooter}>
            {hasUnsent && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>{unsentInCheck} รายการยังไม่ถึงครัว</b> — ส่งครัวก่อนจึงจะคิดเงินได้ ยอดด้านล่างคือยอดที่ส่งครัวแล้ว</span></div>}
            {/* ปกติครัวยกเลิกแล้วบรรทัดจะหลุดจากบิลทันที เหลือค้างได้เฉพาะกรณีบิลไม่ได้เปิดอยู่
                ตอนที่ครัวกด (กำลังคิดเงิน/ปิดแล้ว) ซึ่งแตะยอดที่ออกใบเสร็จไปแล้วไม่ได้ */}
            {kitchenCancelled.length > 0 && <div className={styles.warn}><span aria-hidden="true">⚠</span><span><b>ครัวยกเลิก {kitchenCancelled.length} รายการ ตอนบิลไม่ได้เปิดอยู่</b> — ยอดด้านล่างยังรวมรายการนั้น ตัดออกอัตโนมัติไม่ได้ ต้องคืนเงินหรือแก้บิลตามปกติ</span></div>}
            {/* อธิบายยอดที่ลดลงไว้ติดกับตัวยอด — ไม่ใช่คำเตือน จึงเป็นโทนเงียบ */}
            {kitchenDropped.length > 0 && <div className={styles.dropNote}>ครัวยกเลิก {kitchenDropped.length} รายการ · ตัดออกจากยอดแล้ว (ยังเห็นในรายการด้านบนแบบขีดฆ่า)</div>}
            <div className={styles.total}><span className={styles.totalLabel}>{hasUnsent ? "ยอดที่ส่งครัวแล้ว" : "ยอดบิลปัจจุบัน"}</span><strong><span className={styles.baht}>฿</span>{money(check.amountDue)}</strong></div>
            <div className={styles.footerButtons}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!hasUnsent} onClick={() => void action("send_kitchen")}><CoffeeOutlined /> ส่งครัว{unsentInCheck > 0 ? ` (${unsentInCheck})` : ""}</button>
              <button type="button" className={styles.btn} disabled={!check.items.length || hasUnsent || check.amountDue <= 0} onClick={() => { const cashDue = Math.round((check.amountDue + cashRoundingDelta(check.amountDue, session?.vat.cashRounding ?? "NONE")) * 100) / 100; setPayments([{ id: `pay-${Date.now()}`, method: "CASH", amount: String(cashDue), tendered: String(cashDue), ref: "" }]); setCheckoutOpen(true); }}><WalletOutlined /> คิดเงิน</button>
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
      </div></div></Spin> : <Spin spinning={working}><section className={styles.kitchenBoard}><div className={styles.panelHeader}><div><h2>Kitchen Display</h2><small>รายการจากโต๊ะเข้าครัวก่อนชำระเงิน</small></div><button type="button" className={styles.btn} onClick={() => void loadTickets()}><ReloadOutlined /> รีเฟรชคิว</button></div><div className={styles.lanes}>{LANES.map((lane) => { const rows = tickets.filter((ticket) => ticket.status === lane.status); return <section className={styles.lane} style={{ "--lane-color": lane.color } as CSSProperties} key={lane.status}><div className={styles.laneHead}><strong>{lane.label}</strong><span className={styles.laneCount}>{rows.length}</span></div>{rows.map((ticket) => <article className={styles.ticket} key={ticket.id}><div className={styles.ticketTable}>{ticket.tableName ? `${ticket.tableName} · รอบ ${ticket.roundNo ?? 1}` : `บิล #${ticket.orderId?.slice(0, 8) ?? "-"}`}</div><div className={styles.ticketName}>{ticket.productName}</div><div className={styles.ticketMeta}>{ticket.size !== "-" ? `${ticket.size} · ` : ""}x {ticket.packQty ?? ticket.qty} · {ticket.station ?? "ไม่ระบุ station"} · {new Date(ticket.createdAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</div>{ticket.modifierCodes.length > 0 && <div className={styles.itemTags}>{ticket.modifierCodes.map((code) => <span className={styles.tag} key={code}>{code}</span>)}</div>}{ticket.kitchenNote && <div className={styles.ticketNote}>{ticket.kitchenNote}</div>}<div className={styles.ticketActions}>{lane.next && <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void ticketStatus(ticket, lane.next!)}>{lane.nextLabel} <ArrowRightOutlined /></button>}{lane.status !== "SERVED" && <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void ticketStatus(ticket, "CANCELLED")}>ยกเลิก</button>}</div></article>)}</section>; })}</div></section></Spin>}
    </div>

    <Modal title={`แก้จำนวนคน ${check?.tableName ?? ""}`} open={guestOpen} onCancel={() => setGuestOpen(false)} confirmLoading={working} okText="บันทึก" getContainer={modalContainer}
      onOk={() => void action("set_guest_count", { guestCount: Number(guestEdit) }).then(() => setGuestOpen(false))}>
      <div className={styles.modalGrid}><label>จำนวนลูกค้า<input type="number" min={1} max={500} value={guestEdit} onChange={(event) => setGuestEdit(event.target.value)} /></label></div>
    </Modal>
    <Modal title="ผู้ปฏิบัติงาน" open={operatorOpen} onCancel={() => setOperatorOpen(false)} onOk={() => setOperatorOpen(false)} okText="ใช้บัญชีนี้" okButtonProps={{ disabled: !operatorReady }} getContainer={modalContainer}>
      <div className={styles.modalGrid}>
        <Alert type="info" showIcon message="ทุกการกระทำที่หน้านี้บันทึกในชื่อบัญชีที่เลือก — เปลี่ยนคนเมื่อสลับกะหรือสลับพนักงาน" />
        <label>พนักงาน<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}><option value="">เลือกพนักงาน</option>{staff.map((person) => <option key={person.id} value={person.id} disabled={!person.hasPin}>{person.name ?? person.email ?? person.id}{person.hasPin ? "" : " · ยังไม่มี PIN"}</option>)}</select></label>
        <label>PIN<input value={actorPin} onChange={(event) => setActorPin(event.target.value)} type="password" inputMode="numeric" autoComplete="off" placeholder="PIN" /></label>
      </div>
    </Modal>
    <Modal title={`เปิดบิล ${openTable?.name ?? ""}`} open={Boolean(openTable)} onCancel={() => setOpenTable(null)} onOk={() => void openCheck()} confirmLoading={working} okText="เปิดโต๊ะ" getContainer={modalContainer}><div className={styles.modalGrid}><label>จำนวนลูกค้า<input type="number" min={1} max={500} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} /></label></div></Modal>
    <Modal title={menuHit?.productName ?? "เพิ่มเมนู"} open={Boolean(menuHit)} onCancel={() => setMenuHit(null)} onOk={() => void addMenu()} confirmLoading={working} okText="เพิ่มในบิล" getContainer={modalContainer}>{menuHit && <div className={styles.modalGrid}><Alert type="info" message={`${menuHit.size} · ฿${money(menuHit.packPrice + menuHit.modifiers.filter((modifier) => modifierCodes.includes(modifier.code)).reduce((sum, modifier) => sum + modifier.priceDelta, 0))} / ${menuHit.unitName} · รวม ${menuQty} รายการ ฿${money((menuHit.packPrice + menuHit.modifiers.filter((modifier) => modifierCodes.includes(modifier.code)).reduce((sum, modifier) => sum + modifier.priceDelta, 0)) * menuQty)}`} /><label>จำนวน<input type="number" min={1} max={9999} value={menuQty} onChange={(event) => setMenuQty(Number(event.target.value))} /></label>{menuHit.modifiers.length > 0 && <div><strong>ตัวเลือก</strong><div className={styles.modifierList}>{menuHit.modifiers.map((modifier) => <label className={styles.modifierChoice} key={modifier.code}><input type="checkbox" checked={modifierCodes.includes(modifier.code)} onChange={(event) => setModifierCodes((current) => event.target.checked ? [...current, modifier.code] : current.filter((code) => code !== modifier.code))} /><span>{modifier.name}{modifier.priceDelta > 0 ? ` (+฿${money(modifier.priceDelta)})` : ""}</span></label>)}</div></div>}<label>โน้ตถึงครัว<textarea rows={3} maxLength={300} value={kitchenNote} onChange={(event) => setKitchenNote(event.target.value)} placeholder="เช่น ไม่เผ็ด, แยกน้ำ" /></label></div>}</Modal>
    <Modal title={shiftModal === "OPEN" ? "เปิดกะ" : "ปิดกะ"} open={Boolean(shiftModal)} onCancel={() => setShiftModal(null)} onOk={() => void changeShift()} confirmLoading={working} okText={shiftModal === "OPEN" ? "เปิดกะ" : "ยืนยันปิดกะ"} getContainer={modalContainer}><div className={styles.modalGrid}><Alert type={shiftModal === "OPEN" ? "info" : "warning"} message={shiftModal === "OPEN" ? "ระบุเงินทอนตั้งต้น" : "นับเงินสดจริงในลิ้นชัก"} /><label>จำนวนเงิน<input type="number" min={0} step="0.01" value={cashAmount} onChange={(event) => setCashAmount(Number(event.target.value))} /></label></div></Modal>
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
    <Modal title={`รับชำระ ${check?.tableName ?? ""}`} open={checkoutOpen} onCancel={() => setCheckoutOpen(false)} onOk={() => void settle()} confirmLoading={working} okText="ยืนยันรับเงิน" width={680} getContainer={modalContainer}>{check && <div className={styles.modalGrid}><div className={styles.total}><span>ยอดที่ต้องชำระ</span><strong><span className={styles.baht}>฿</span>{money(checkoutDue)}</strong></div>{payments.map((payment, index) => <div className={styles.modalGrid} key={payment.id}><label>วิธีชำระ<select value={payment.method} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, method: event.target.value, tendered: "", ref: "" } : row))}><option value="CASH">เงินสด</option><option value="QR">QR / พร้อมเพย์</option><option value="CARD">บัตร</option></select></label><label>ยอดช่องทางนี้<input type="number" min={0.01} step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value } : row))} /></label>{payment.method === "CASH" ? <label>เงินสดที่รับมา<input type="number" min={Number(payment.amount) || 0} step="0.01" value={payment.tendered} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, tendered: event.target.value } : row))} /></label> : <label>เลขอ้างอิง<input value={payment.ref} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, ref: event.target.value } : row))} /></label>}{payments.length > 1 && <Button danger onClick={() => setPayments((current) => current.filter((row) => row.id !== payment.id))}>ลบช่องทาง {index + 1}</Button>}</div>)}<Button type="dashed" onClick={() => setPayments((current) => appendSplitPaymentRow(current, check.amountDue, `pay-${Date.now()}`))}>+ แบ่งชำระอีกช่องทาง</Button><Alert type={Math.abs(paymentTotal - checkoutDue) <= 0.009 ? "success" : "warning"} showIcon message={`รวม ฿${money(paymentTotal)} · ${paymentTotal < checkoutDue ? `เหลือ ฿${money(checkoutDue - paymentTotal)}` : paymentTotal > checkoutDue ? `เกิน ฿${money(paymentTotal - checkoutDue)}` : "ครบยอด"}`} /></div>}</Modal>
    <Modal title="ย้ายโต๊ะ" open={moveOpen} onCancel={() => setMoveOpen(false)} onOk={() => void action("move", { targetTableId }).then(() => setMoveOpen(false))} confirmLoading={working} okText="ย้าย" getContainer={modalContainer}><div className={styles.modalGrid}><label>โต๊ะปลายทาง<select value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}>{availableTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.code}</option>)}</select></label></div></Modal>
    <Modal title={`ยกเลิกบิล ${check?.tableName ?? ""}`} open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => void cancelCheck()} confirmLoading={working} okText="ยืนยันยกเลิก" okButtonProps={{ danger: true }} getContainer={modalContainer}><div className={styles.modalGrid}>{cancelNeedsApproval && <Alert type="warning" showIcon message="บิลนี้ส่งครัวหรือจองวัตถุดิบแล้ว" description="ต้องให้ผู้มีสิทธิ์ยกเลิกบิลซึ่งเป็นคนละคนกับผู้ปฏิบัติงานกด PIN อนุมัติ" />}<label>เหตุผล<textarea rows={3} maxLength={300} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>{cancelNeedsApproval && <><label>ผู้อนุมัติ<select value={cancelApproverId} onChange={(event) => setCancelApproverId(event.target.value)}><option value="">เลือกผู้อนุมัติ</option>{voidApprovers.map((person) => <option key={person.id} value={person.id}>{person.name || person.email || person.id}</option>)}</select></label><label>PIN ผู้อนุมัติ<input type="password" inputMode="numeric" autoComplete="off" value={cancelApproverPin} onChange={(event) => setCancelApproverPin(event.target.value)} /></label>{voidApprovers.length === 0 && <Alert type="error" showIcon message="ไม่มีผู้อนุมัติที่พร้อมใช้งาน" description="ตั้ง PIN และมอบสิทธิ์ pos.void ให้ผู้จัดการหรือหัวหน้าก่อน" />}</>}</div></Modal>
  </main>;
}
