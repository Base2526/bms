'use client';
import { gql, useApolloClient, useQuery, useLazyQuery, useMutation, useSubscription } from "@apollo/client";
import {
  List, Input, Button, Space, Tag, Segmented, message, Alert, Badge,
  Typography, Avatar, Select, Tabs, Empty, Divider, Popover, Tooltip, Switch, Statistic, Modal,
} from "antd";
import { memo, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ReloadOutlined, SendOutlined, UserOutlined,
  SmileOutlined, PictureOutlined, PaperClipOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, CloseOutlined,
  UserSwitchOutlined, UsergroupAddOutlined, UsergroupDeleteOutlined, CheckCircleOutlined,
  FireOutlined, ClockCircleOutlined, ShoppingCartOutlined, CreditCardOutlined,
  TruckOutlined, ThunderboltOutlined, TagsOutlined, SearchOutlined,
  LeftOutlined, RightOutlined, DownloadOutlined,
  EyeOutlined, EyeInvisibleOutlined,
  FileOutlined, FilePdfOutlined,
} from "@ant-design/icons";

const EMOJIS = ["😊","😀","😂","🙏","👍","🙂","😅","😍","🥰","😘","😉","😎","🤔","😢","😭","😡","🎉","✨","🔥","💯","❤️","💙","💚","👏","🙌","🛒","📦","🚚","💰","✅","❌","⭐","📌","🏷️","🎁","👌"];
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useGlobalInboxStore } from "@/store/globalInboxStore";
import { useI18n } from "@/lib/i18nContext";
import Customer360Panel from "./Customer360Panel";
import messageStyles from "./message.module.css";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// ---- Types --------------------------------------------------
type ConvStatus = "OPEN" | "PENDING" | "CLOSED";
type QuickFilterKey = "urgent" | "payment" | "product";
type StaffRef = { id: string; name: string | null; email: string | null; avatar: string | null; role?: string | null; isAvailable?: boolean | null; openCount?: number | null };
type Conversation = {
  id: string; channel: string; customerRef: string | null; customerName: string | null; customerAvatar: string | null;
  sourceDisplayName: string | null; sourceHandle: string | null; sourceAvatar: string | null;
  status: ConvStatus; assignedStaff: StaffRef | null; tags: string[]; unread: number;
  lastMessage: string | null; lastMessageAt: string | null;
};
type Attachment = { url: string; name: string | null; mimeType: string | null; isImage: boolean };
type Msg = {
  id: string; direction: "IN" | "OUT"; body: string; sender: string | null; createdAt: string;
  attachment?: Attachment | null; status?: string | null; canReportDelivery?: boolean;
};
type Note = { id: string; author: string | null; body: string; createdAt: string; mentionedUserIds?: string[] };
type ProductPickerItem = { sku: string; name: string; active: boolean; price: number; imageUrl?: string | null; variants?: { size: string; available: number }[] };
type ProductShare = { name: string; sku: string; price: string | null; stock: string | null; url: string; caption: string | null };
type CouponPickerItem = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrderAmount?: number | null;
  maxRedemptions?: number | null;
  redemptionsCount: number;
  perCustomerLimit?: number | null;
  expiresAt?: string | null;
  active: boolean;
};
type CouponShare = {
  code: string;
  discount: string | null;
  minOrder: string | null;
  expires: string | null;
  usage: string | null;
  walletUrl: string | null;
};
type SystemEvent = {
  id: string; kind: "assign" | "helper_add" | "helper_remove" | "status";
  at: string; actorName: string; targetName: string | null; statusValue: string | null; auto: boolean;
};

const PANEL_SURFACE = "var(--app-surface, #ffffff)";
const PANEL_SUNKEN_SURFACE = "rgba(var(--app-surface-2-rgb, 241, 245, 249), 0.92)";
const SUBTLE_TEXT = "rgba(var(--app-text-rgb, 15, 23, 42), 0.62)";
const IDLE_CARD_BORDER = "rgba(var(--app-text-rgb, 15, 23, 42), 0.08)";
const IDLE_CARD_SHADOW = "0 1px 4px rgba(var(--app-shadow-rgb, 15, 23, 42), 0.06)";
const RAISED_PANEL_SHADOW = "0 6px 16px rgba(var(--app-shadow-rgb, 15, 23, 42), 0.12)";
// ภาษาภาพชุดเดียวสำหรับ chip เล็กในคิวแชท/หัวแชท (ตาม mockup "compact cards") — ช่องทางเป็น pill
// ฟ้าอ่อน ส่วน chip สถานะอื่นเป็นเส้นขอบจาง ไม่ใช่ Tag สีทึบทั้งแถว ซึ่งเดิมแย่งสายตาจากตัวข้อความ
const CHANNEL_CHIP_STYLE: React.CSSProperties = {
  flexShrink: 0, fontSize: 9, fontWeight: 700, lineHeight: "16px", letterSpacing: "0.03em",
  textTransform: "uppercase", color: "#1677ff", background: "rgba(22,119,255,0.09)",
  borderRadius: 999, paddingInline: 6,
};
const TOOL_CHIP_BASE: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, marginInlineEnd: 0,
  fontSize: 10.5, fontWeight: 600, lineHeight: "18px", paddingInline: 9, borderRadius: 999,
  background: PANEL_SURFACE, borderColor: "var(--app-border, rgba(15,23,42,0.12))", color: "var(--app-muted, #64748b)",
};
// ---- GraphQL ------------------------------------------------
const STAFF_FIELDS = `id name email avatar role isAvailable openCount`;
const Q_LIST = gql`
  query ($status: BmsConvStatus, $search: String, $assignedTo: ID, $limit: Int) {
    bmsConversations(status: $status, search: $search, assignedTo: $assignedTo, limit: $limit) {
      id channel customerRef customerName customerAvatar sourceDisplayName sourceHandle sourceAvatar status tags unread lastMessage lastMessageAt
      assignedStaff { id name avatar }
    }
  }
`;
const Q_CONV = gql`
  query ($id: ID!, $messageLimit: Int, $eventLimit: Int, $noteLimit: Int) {
    bmsConversation(id: $id) {
      id channel customerRef customerId customerName customerAvatar sourceDisplayName sourceHandle sourceAvatar status tags unread lastMessageAt createdAt
      assignedStaff { ${STAFF_FIELDS} }
      helpers { ${STAFF_FIELDS} }
      messages(limit: $messageLimit) { id direction body sender createdAt attachment { url name mimeType isImage } status canReportDelivery }
      systemEvents(limit: $eventLimit) { id kind at actorName targetName statusValue auto }
      notes(limit: $noteLimit) { id author body createdAt mentionedUserIds }
    }
  }
`;
const S_INBOX_CHANGED = gql`
  subscription {
    bmsInboxChanged { conversationId kind occurredAt }
  }
`;
const Q_STAFF = gql`query { bmsAssignableStaff { ${STAFF_FIELDS} } }`;
const Q_ME = gql`query { bmsMe { id role is_available gender tenant { slug } } bmsActingTenant { slug } }`;
const Q_TIMELINE = gql`query ($id: ID!) { bmsConversationTimeline(id: $id) { type at text ref channel entityId status statusAt } }`;
const Q_CUSTOMER = gql`
  query ($id: ID!) {
    bmsCustomer(id: $id) {
      id name phone note tags total_spent order_count
      orders { id channel status total_amount created_at }
    }
  }
`;
const Q_PRODUCTS_PICKER = gql`
  query ($search: String) {
    bmsProducts(search: $search, limit: 24) {
      items {
        sku
        name
        active
        price
        imageUrl
        variants { size available }
      }
    }
  }
`;
const Q_COUPONS_PICKER = gql`
  query {
    bmsCoupons {
      id code type value minOrderAmount maxRedemptions redemptionsCount perCustomerLimit expiresAt active
    }
  }
`;
const M_SEND = gql`mutation ($id: ID!, $body: String, $attachment: BmsAttachmentInput) { bmsSendMessage(id: $id, body: $body, attachment: $attachment) { status delivered message } }`;
const M_RETRY = gql`mutation ($id: ID!) { bmsRetryMessage(id: $id) { status delivered message } }`;
const M_ASSIGN = gql`mutation ($id: ID!, $userId: ID!) { bmsAssignConversation(id: $id, userId: $userId) }`;
const M_HELPER_ADD = gql`mutation ($id: ID!, $userId: ID!) { bmsAddConversationHelper(id: $id, userId: $userId) }`;
const M_HELPER_REMOVE = gql`mutation ($id: ID!, $userId: ID!) { bmsRemoveConversationHelper(id: $id, userId: $userId) }`;
const M_AVAILABILITY = gql`mutation ($available: Boolean!) { bmsSetMyAvailability(available: $available) }`;
const M_STATUS = gql`mutation ($id: ID!, $status: BmsConvStatus!) { bmsSetConversationStatus(id: $id, status: $status) }`;
const M_TAGS = gql`mutation ($id: ID!, $tags: [String!]!) { bmsSetConversationTags(id: $id, tags: $tags) }`;
const M_READ = gql`mutation ($id: ID!) { bmsMarkConversationRead(id: $id) }`;
const M_NOTE = gql`mutation ($id: ID!, $body: String!, $mentionedUserIds: [ID!]) { bmsAddConversationNote(id: $id, body: $body, mentionedUserIds: $mentionedUserIds) { id author body createdAt mentionedUserIds } }`;
const M_REORDER = gql`mutation ($id: ID!) { bmsReorderFromOrder(id: $id) { status orderId total message } }`;

function staffLabel(s: StaffRef, t: Translate) {
  const busy = typeof s.openCount === "number" ? ` · ${t("admin_inbox.chat_count_suffix", { n: s.openCount })}` : "";
  return `${s.name || s.email || s.id}${s.role ? ` (${s.role})` : ""}${busy}`;
}

// ---- วันที่/เวลา + system event (ยึด timezone Asia/Bangkok ให้ตรงกันทุกเครื่อง) ----
const BKK = "Asia/Bangkok";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: BKK, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const baht = (value: number | null | undefined, t: Translate) => `${Number(value ?? 0).toLocaleString("th-TH")} ${t("admin_inbox.baht_suffix")}`;
function dayLabel(iso: string, t: Translate) {
  const key = dayKey(iso);
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === todayKey) return t("admin_inbox.today_label");
  if (key === dayKey(y.toISOString())) return t("admin_inbox.yesterday_label");
  return new Intl.DateTimeFormat("th-TH", { timeZone: BKK, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function eventIcon(kind: SystemEvent["kind"]) {
  switch (kind) {
    case "assign": return <UserSwitchOutlined />;
    case "helper_add": return <UsergroupAddOutlined />;
    case "helper_remove": return <UsergroupDeleteOutlined />;
    case "status": return <CheckCircleOutlined />;
  }
}
function eventText(ev: SystemEvent, t: Translate) {
  switch (ev.kind) {
    case "assign": return ev.auto
      ? t("admin_inbox.event_assign_auto", { target: ev.targetName || "" })
      : t("admin_inbox.event_assign_manual", { actor: ev.actorName, target: ev.targetName || "" });
    case "helper_add": return t("admin_inbox.event_helper_add", { actor: ev.actorName, target: ev.targetName || "" });
    case "helper_remove": return t("admin_inbox.event_helper_remove", { actor: ev.actorName, target: ev.targetName || "" });
    case "status": return t("admin_inbox.event_status", { actor: ev.actorName, status: ev.statusValue || "" });
  }
}

const CHANNEL_COLOR: Record<string, string> = { line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", shopee: "orange", lazada: "purple", test: "default" };
// ตัวย่อช่องทางสำหรับคิวแชท — ชื่อเต็มกินที่มากเกินไปในแถวแคบ ๆ (ช่องทางที่ไม่มีในนี้ใช้ชื่อเดิม)
const CHANNEL_SHORT: Record<string, string> = { line: "LINE", tiktok: "TT", facebook: "FB", instagram: "IG", web: "WEB", shopee: "SHP", lazada: "LZD", test: "TEST" };
// ป้ายของแท็บ Timeline — ORDER = "สร้างออร์เดอร์" เท่านั้น (สถานะปัจจุบันแยกไปอีกบรรทัด ไม่ผูกกับเวลา at)
function timelineTypeMeta(type: string, t: Translate): { label: string; color: string } {
  const map: Record<string, { key: string; color: string }> = {
    MESSAGE_IN: { key: "timeline_type_message_in", color: "blue" },
    MESSAGE_OUT: { key: "timeline_type_message_out", color: "default" },
    NOTE: { key: "timeline_type_note", color: "gold" },
    ORDER: { key: "timeline_type_order", color: "green" },
    ASSIGN: { key: "timeline_type_assign", color: "cyan" },
    STATUS: { key: "timeline_type_status", color: "purple" },
  };
  const entry = map[type];
  return entry ? { label: t(`admin_inbox.${entry.key}`), color: entry.color } : { label: type, color: "default" };
}
// จุดบนเส้น timeline — สีบอกชนิดเหตุการณ์ (ORDER ใช้สีตามสถานะปัจจุบันของออร์เดอร์แทน)
const TIMELINE_DOT: Record<string, string> = {
  MESSAGE_IN: "#378ADD", MESSAGE_OUT: "#B4B2A9", NOTE: "#EF9F27", ASSIGN: "#1D9E75", STATUS: "#7F77DD",
};
const ORDER_STATUS_DOT: Record<string, string> = {
  PENDING: "#EF9F27", PAID: "#639922", PACKING: "#639922", SHIPPED: "#639922",
  COMPLETED: "#1D9E75", CANCELLED: "#E24B4A", RETURNED: "#EF9F27",
};
// ต้องตรงกับ TIMELINE_MAX_PER_SOURCE ใน lib/bms/inbox.ts (ไฟล์นั้น import @/lib/db — client component ดึงตรงไม่ได้)
const TIMELINE_MAX_PER_SOURCE = 200;
const STATUS_COLOR: Record<ConvStatus, string> = { OPEN: "green", PENDING: "orange", CLOSED: "default" };
const FILTERS = ["ALL", "OPEN", "PENDING", "CLOSED"] as const;
const LIST_COLLAPSE_KEY = "bms_inbox_list_collapsed";
const AI_SUGGESTION_VISIBILITY_KEY = "bms_inbox_ai_suggestion_visibility";
const CHAT_BOTTOM_THRESHOLD_PX = 120;
const MOBILE_QUERY = "(max-width: 767px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1180px)";
const INBOX_CONVERSATION_LIST_LIMIT = 50;
const INBOX_DETAIL_MESSAGES_LIMIT = 80;
const INBOX_DETAIL_EVENTS_LIMIT = 30;
const INBOX_DETAIL_NOTES_LIMIT = 30;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

// preview ในลิสต์: ถ้าข้อความล่าสุดเป็น attachment (marker จาก sendStaffMessage) → โชว์ไอคอน
function previewNode(last: string | null | undefined, t: Translate) {
  if (!last) return "—";
  if (last.startsWith("[รูปภาพ]")) return <><PictureOutlined /> {t("admin_inbox.preview_image")}</>;
  if (last.startsWith("[ไฟล์]")) return <><PaperClipOutlined /> {last.replace("[ไฟล์]", "").trim() || t("admin_inbox.preview_file_fallback")}</>;
  if (parseCouponShare(last)) return <><TagsOutlined /> {t("admin_inbox.preview_coupon")} {parseCouponShare(last)?.code}</>;
  return last;
}

function sourceLabel(c: { channel?: string | null; sourceDisplayName?: string | null; sourceHandle?: string | null }, t: Translate) {
  if (!c.sourceDisplayName && !c.sourceHandle) return null;
  const name = c.sourceDisplayName || c.sourceHandle || "";
  const handle = c.sourceHandle && c.sourceHandle !== name ? ` ${c.sourceHandle}` : "";
  const prefix = c.channel === "line" ? "LINE OA" : c.channel || t("admin_inbox.channel_fallback");
  return `${prefix} “${name}”${handle}`;
}

function convPriority(c: Conversation, t: Translate) {
  const text = `${c.lastMessage || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
  if (c.unread > 0) return { label: t("admin_inbox.priority_need_reply"), color: "red", icon: <FireOutlined /> };
  if (/สลิป|โอน|paid|payment|ชำระ/.test(text)) return { label: t("admin_inbox.priority_has_slip"), color: "blue", icon: <CreditCardOutlined /> };
  if (/ส่ง|พัสดุ|tracking|จัดส่ง/.test(text) || c.status === "PENDING") return { label: t("admin_inbox.priority_awaiting_shipment"), color: "purple", icon: <TruckOutlined /> };
  if (/ราคา|ไซซ์|size|มีไหม|stock|สต็อก/.test(text)) return { label: t("admin_inbox.priority_ask_product"), color: "green", icon: <ShoppingCartOutlined /> };
  return { label: t("admin_inbox.priority_normal"), color: "default", icon: <ClockCircleOutlined /> };
}

function matchesQuickFilter(c: Conversation, quickFilter: QuickFilterKey | null) {
  if (!quickFilter) return true;
  const text = `${c.lastMessage || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
  if (quickFilter === "urgent") return c.unread > 0;
  if (quickFilter === "payment") return /สลิป|โอน|paid|payment|ชำระ/.test(text);
  return /ราคา|ไซซ์|size|มีไหม|stock|สต็อก/.test(text);
}

// เปลี่ยนคำลงท้ายตามเพศแอดมิน: male → "ครับ", female/ไม่ระบุ → คงเดิม (ค่ะ)
// ลำดับ replace สำคัญ: "นะคะ" ก่อน "ค่ะ" ก่อน "คะ" (กันแทนซ้อน) — ใช้กับ template ของระบบเท่านั้น
function applyGenderParticle(text: string, gender?: string | null): string {
  if (gender !== "male") return text;
  return text
    .replace(/นะคะ/g, "นะครับ")
    .replace(/ค่ะ/g, "ครับ")
    .replace(/คะ/g, "ครับ");
}

function parseProductShare(body: string): ProductShare | null {
  const lines = String(body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const urlIndex = lines.findIndex((line) => /https?:\/\/[^\s]+\/shop\/[^/\s]+\/products\/[^\s]+/i.test(line));
  if (urlIndex < 0) return null;

  const url = lines[urlIndex].match(/https?:\/\/[^\s]+\/shop\/[^/\s]+\/products\/[^\s]+/i)?.[0];
  if (!url) return null;
  const detailIndex = [...lines.keys()].reverse().find((index) => index < urlIndex && /\([^()]+\)/.test(lines[index]));
  if (detailIndex == null) return null;

  const parts = lines[detailIndex].split(/\s+·\s+/);
  const identity = parts[0].match(/^(.+)\s+\(([^()]+)\)$/);
  if (!identity) return null;
  const rawStock = parts.slice(2).join(" · ") || null;
  const stock = rawStock
    ? rawStock.replace(/คงเหลือ\s*(\d+)/, "เหลือ $1 ชิ้น").replace(/ชิ้น\s*ชิ้น/g, "ชิ้น")
    : null;

  return {
    name: identity[1].trim(),
    sku: identity[2].trim(),
    price: parts[1]?.trim() || null,
    stock,
    url,
    caption: lines.slice(0, detailIndex).join("\n") || null,
  };
}

const couponCodeFromText = (body: string): string | null => {
  return parseCouponShare(body)?.code ?? null;
};

function latestCouponCodeFromMessages(messages: Msg[] = []): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const code = couponCodeFromText(messages[i]?.body || "");
    if (code) return code;
  }
  return null;
}

function parseCouponShare(body: string): CouponShare | null {
  const lines = String(body || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const text = lines.join("\n");
  if (!/🎟|คูปอง|coupon/i.test(text)) return null;
  const codeLine = lines.find((line) => /^(?:โค้ด|CODE)\s+.+/i.test(line));
  const code = codeLine?.replace(/^(?:โค้ด|CODE)\s+/i, "").trim().toUpperCase() ?? null;
  if (!code) return null;
  const discount =
    lines.find((line) => /^ส่วนลด\s+/i.test(line))?.replace(/^ส่วนลด\s+/i, "").trim()
    || lines.find((line) => /^ลด\s+[\d,.]+%?/i.test(line))?.replace(/^ลด\s+/i, "").trim()
    || null;
  const minOrder = lines.find((line) => /^ขั้นต่ำ\s+/i.test(line))?.replace(/^ขั้นต่ำ\s+/i, "").trim() || null;
  const expires = lines.find((line) => /^(ใช้ได้ถึง|หมดอายุ)\s+/i.test(line))?.replace(/^(ใช้ได้ถึง|หมดอายุ)\s+/i, "").trim() || null;
  const usage = lines.find((line) => /^สิทธิ์\s+/i.test(line))?.replace(/^สิทธิ์\s+/i, "").trim() || null;
  const walletUrl = lines.find((line) => /\/coupon\/wallet\?t=/i.test(line)) || null;
  return { code, discount, minOrder, expires, usage, walletUrl };
}

function fileKind(attachment: Attachment) {
  const extension = attachment.name?.split(".").pop()?.toUpperCase();
  if (attachment.mimeType?.toLowerCase().includes("pdf") || extension === "PDF") return { label: "PDF", pdf: true };
  return { label: extension || attachment.mimeType?.split("/").pop()?.toUpperCase() || "FILE", pdf: false };
}

function suggestedReply(conv: any, gender?: string | null) {
  const text = String(conv?.messages?.[conv.messages.length - 1]?.body || conv?.lastMessage || "").toLowerCase();
  let base: string;
  if (/สลิป|โอน|ชำระ|payment|paid/.test(text)) {
    base = "ได้รับสลิปแล้วค่ะ เดี๋ยวตรวจสอบยอดให้ หากเรียบร้อยจะออกเลขพัสดุให้ทันทีนะคะ 🙏";
  } else if (/เลขพัสดุ|tracking|ส่งของ|จัดส่ง/.test(text)) {
    base = "กำลังตรวจสอบสถานะจัดส่งให้นะคะ ถ้ามีเลขพัสดุแล้วจะแจ้งให้ทันทีค่ะ";
  } else if (/มีไหม|ไซซ์|size|stock|สต็อก|ราคา/.test(text)) {
    base = "เดี๋ยวเช็กสต็อกและราคาให้ค่ะ ลูกค้าต้องการรุ่น/ไซซ์ไหนบ้างคะ";
  } else {
    base = "รับทราบค่ะ เดี๋ยวแอดมินตรวจสอบข้อมูลให้และแจ้งกลับโดยเร็วที่สุดนะคะ";
  }
  return applyGenderParticle(base, gender);
}

function nextAction(conv: any, t: Translate) {
  const text = String(conv?.messages?.[conv.messages.length - 1]?.body || "").toLowerCase();
  const label = t("admin_inbox.next_action_label");
  if (/สลิป|โอน|ชำระ|payment|paid/.test(text)) return { key: "confirm_slip", label, value: t("admin_inbox.next_action_confirm_slip"), icon: <CreditCardOutlined />, color: "#1677ff" };
  if (/เลขพัสดุ|tracking|ส่งของ|จัดส่ง/.test(text) || conv?.status === "PENDING") return { key: "issue_tracking", label, value: t("admin_inbox.next_action_issue_tracking"), icon: <TruckOutlined />, color: "#722ed1" };
  if (/มีไหม|ไซซ์|size|stock|สต็อก|ราคา/.test(text)) return { key: "check_stock", label, value: t("admin_inbox.next_action_check_stock"), icon: <ShoppingCartOutlined />, color: "#389e0d" };
  return { key: "reply_customer", label, value: t("admin_inbox.next_action_reply_customer"), icon: <SendOutlined />, color: "#d48806" };
}

const ConversationListItem = memo(function ConversationListItem({
  conversation: c,
  active,
  collapsed,
  onOpen,
}: {
  conversation: Conversation;
  active: boolean;
  collapsed: boolean;
  onOpen: (conversationId: string) => void;
}) {
  const { t } = useI18n();
  const priority = convPriority(c, t);
  const source = sourceLabel(c, t);
  const displayName = c.customerName || c.customerRef?.slice(0, 12) || t("admin_inbox.customer_fallback");
  const avatarLetter = (c.customerName || c.customerRef || "").slice(0, 1).toUpperCase() || undefined;

  return (
    <List.Item
      onClick={() => onOpen(c.id)}
      /* แถวเรียบคั่นด้วยเส้น ไม่ใช่การ์ดมีเงา/ขอบรอบตัว (ตาม mockup) — การ์ดซ้อนในคอลัมน์ที่มี
         กรอบอยู่แล้วกินความกว้างและทำให้ 5 แถวดูเหมือน 5 กล่องแยกกันแทนที่จะเป็นคิวเดียว */
      style={{
        cursor: "pointer", padding: collapsed ? "5px 0" : "8px 10px", borderRadius: 0, marginBottom: 0,
        display: collapsed ? "flex" : undefined,
        justifyContent: collapsed ? "center" : undefined,
        background: active ? "rgba(22,119,255,0.07)" : "transparent",
        border: "none",
        borderLeft: active ? "2px solid #1677ff" : "2px solid transparent",
        borderBottom: `1px solid ${IDLE_CARD_BORDER}`,
      }}
    >
      {collapsed ? (
        <Tooltip placement="right" title={`${c.channel} · ${displayName}`}>
          <Badge count={c.unread} size="small"><Avatar size={28} src={c.customerAvatar || undefined} icon={<UserOutlined />} /></Badge>
        </Tooltip>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", columnGap: 8, width: "100%", minWidth: 0, alignItems: "start" }}>
          <Badge count={c.unread} size="small" offset={[-2, 2]}>
            {/* ไม่มีรูปจริง = ตัวอักษรแรกบนพื้น gradient (mockup) — อ่านออกว่าเป็นใคร
                เร็วกว่าไอคอนคนสีเทาที่เหมือนกันหมดทุกแถว */}
            <Avatar
              size={28}
              src={c.customerAvatar || undefined}
              icon={c.customerAvatar ? undefined : (c.customerName || c.customerRef) ? undefined : <UserOutlined />}
              style={c.customerAvatar ? undefined : {
                background: "linear-gradient(135deg, #1677ff, #059669)",
                fontSize: 11, fontWeight: 700,
              }}
            >
              {avatarLetter}
            </Avatar>
          </Badge>
          {/* ชื่อขึ้นก่อน (สิ่งที่ staff กวาดตาหา) ช่องทางเป็น chip เล็กชิดขวา —
              เดิมเอา Tag ช่องทางไว้หน้าชื่อ ทำให้ชื่อถูกดันและอ่านยากตอน list แคบ */}
          <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <Typography.Text strong ellipsis style={{ minWidth: 0, flex: 1, fontSize: 12 }}>
                {displayName}
              </Typography.Text>
              {c.assignedStaff && (
                <Tooltip title={t("admin_inbox.primary_staff_tooltip", { name: c.assignedStaff.name || c.assignedStaff.id })}>
                  <Avatar size={15} src={c.assignedStaff.avatar || undefined} style={{ fontSize: 8, backgroundColor: "#1677ff", flexShrink: 0 }}>
                    {(c.assignedStaff.name || "?").slice(0, 1).toUpperCase()}
                  </Avatar>
                </Tooltip>
              )}
              <span style={CHANNEL_CHIP_STYLE}>
                {CHANNEL_SHORT[c.channel] || c.channel}
              </span>
            </div>

            <Typography.Text type="secondary" ellipsis style={{ minWidth: 0, fontSize: 10, lineHeight: 1.25 }}>
              {source ? t("admin_inbox.shop_prefix", { source }) : c.customerRef || c.id}
            </Typography.Text>

            <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 11, lineHeight: 1.3 }} type="secondary">
              {previewNode(c.lastMessage, t)}
            </Typography.Text>

            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, marginTop: 1 }}>
              <Tag color={priority.color} icon={priority.icon} style={{ marginInlineEnd: 0, borderRadius: 999, fontWeight: 700, fontSize: 9, lineHeight: "16px", paddingInline: 6 }}>
                {priority.label}
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 9, marginLeft: "auto", flexShrink: 0 }}>
                {c.lastMessageAt ? timeLabel(c.lastMessageAt) : ""}
              </Typography.Text>
            </div>
          </div>
        </div>
      )}
    </List.Item>
  );
});

function Inbox() {
  const apollo = useApolloClient();
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isTablet = useMediaQuery(TABLET_QUERY);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("OPEN");
  const [search, setSearch] = useState("");
  // ช่องค้นหาไม่มีปุ่มแล้ว (mockup เป็น input เดียวเต็มความกว้าง) — พิมพ์แล้วค้นเองแบบ debounce 300ms
  // เหมือนหน้า operations อื่น ๆ เพราะ search เป็น arg ของ bmsConversations ไม่ใช่ filter ใน table
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  // deep-link จากหน้า Orders: /admin/inbox?c=<conversationId> → เปิดแชทนั้นทันที
  // อ่านตอน mount (hard load) + useEffect กันเคส SPA client-nav ที่ URL อัปเดตหลัง render แรก
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("c");
  });
  // deep-link ไปแท็บเฉพาะ: /admin/inbox?c=<id>&tab=notes — ใช้กับลิงก์จาก mention notification
  // (เดิม deep-link เปิดแท็บ "แชท" เสมอ ทำให้ staff ต้องเปิดเข้ามาแล้วกดหาแท็บโน้ตเองอีกที)
  const [initialTab, setInitialTab] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("tab");
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c) setActiveId(c);
    const tab = params.get("tab");
    if (tab) setInitialTab(tab);
  }, []);
  // แจ้ง GlobalInboxNotifier ว่ากำลังเปิดแชทไหนอยู่ (กันแจ้ง notification ซ้ำกับแชทที่เห็นอยู่ตรงหน้า)
  const setActiveConversationGlobal = useGlobalInboxStore((s) => s.setActiveConversation);
  useEffect(() => {
    setActiveConversationGlobal(activeId);
    return () => setActiveConversationGlobal(null);
  }, [activeId, setActiveConversationGlobal]);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("c") ? "chat" : "list";
  });
  const [customer360Ready, setCustomer360Ready] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey | null>(null);

  const { data: meData } = useQuery(Q_ME, { fetchPolicy: "cache-and-network" });
  const me = meData?.bmsMe;
  const tenantSlug = meData?.bmsActingTenant?.slug || me?.tenant?.slug || null;
  // Sales เห็นเฉพาะแชทของตัวเองเสมอ (บังคับที่ backend อยู่แล้ว — ฝั่งนี้แค่ปรับ UI ให้ตรงกัน)
  const restrictedToOwn = me?.role === "Sales";
  const [setAvailability, { loading: settingAvail }] = useMutation(M_AVAILABILITY, {
    onError: (e) => message.error(e.message || t("admin_inbox.settings_error")),
  });

  // ย่อ list การสนทนาเหลือแต่ avatar (จำสถานะข้ามหน้าใน localStorage)
  const [listCollapsed, setListCollapsed] = useState(false);
  useEffect(() => {
    setListCollapsed(window.localStorage.getItem(LIST_COLLAPSE_KEY) === "1");
  }, []);
  const toggleListCollapsed = () => {
    setListCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(LIST_COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const listVariables = useMemo(() => ({
    status: filter === "ALL" ? null : filter,
    search: search || null,
    assignedTo: (mineOnly || restrictedToOwn) ? me?.id ?? null : null,
    limit: INBOX_CONVERSATION_LIST_LIMIT,
  }), [filter, search, mineOnly, restrictedToOwn, me?.id]);
  const convVariables = useCallback((id: string) => ({
    id,
    messageLimit: INBOX_DETAIL_MESSAGES_LIMIT,
    eventLimit: INBOX_DETAIL_EVENTS_LIMIT,
    noteLimit: INBOX_DETAIL_NOTES_LIMIT,
  }), []);

  const { data, loading, refetch } = useQuery(Q_LIST, {
    variables: listVariables,
    fetchPolicy: "cache-and-network",
    pollInterval: 20000,
    skip: (mineOnly || restrictedToOwn) && !me?.id, // กันยิงก่อนรู้ id ตัวเอง (จะได้ทั้งหมดโดยไม่ตั้งใจ)
  });
  const conversations: Conversation[] = data?.bmsConversations || [];
  const needReplyCount = useMemo(() => conversations.filter((c) => c.unread > 0).length, [conversations]);
  const pendingCount = useMemo(() => conversations.filter((c) => c.status === "PENDING").length, [conversations]);
  const visibleConversations = useMemo(
    () => conversations.filter((c) => matchesQuickFilter(c, quickFilter)),
    [conversations, quickFilter]
  );
  const effectiveListCollapsed = !isMobile && (listCollapsed || isTablet);
  const showListPane = !isMobile || mobilePane === "list";
  const showConversationPane = !isMobile || mobilePane === "chat";

  const [loadConv, { data: convData, refetch: refetchConv }] = useLazyQuery(Q_CONV, { fetchPolicy: "cache-and-network" });
  const conv = convData?.bmsConversation;
  const showCustomer360Pane = Boolean(conv && !isMobile && !isTablet);
  const selectedCouponCode = useMemo(
    () => latestCouponCodeFromMessages(conv?.messages || []),
    [conv?.messages]
  );

  useEffect(() => {
    setCustomer360Ready(false);
    if (!showCustomer360Pane) return;
    const timer = window.setTimeout(() => setCustomer360Ready(true), 350);
    return () => window.clearTimeout(timer);
  }, [showCustomer360Pane, conv?.id]);

  const [markRead] = useMutation(M_READ);
  const { data: inboxChangedData } = useSubscription(S_INBOX_CHANGED, {
    skip: !can("inbox.view"),
  });
  const listRefreshState = useRef<{ timer: ReturnType<typeof setTimeout> | null; pending: boolean }>({
    timer: null,
    pending: false,
  });
  const convRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readStateRef = useRef(new Map<string, { running: boolean; pending: boolean }>());
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const clearUnreadInCache = useCallback((conversationId: string) => {
    const list = apollo.cache.readQuery<any>({
      query: Q_LIST,
      variables: listVariables,
    });
    if (list?.bmsConversations) {
      apollo.cache.writeQuery({
        query: Q_LIST,
        variables: listVariables,
        data: {
          bmsConversations: list.bmsConversations.map((c: Conversation) =>
            c.id === conversationId ? { ...c, unread: 0 } : c
          ),
        },
      });
    }

    const detail = apollo.cache.readQuery<any>({
      query: Q_CONV,
      variables: convVariables(conversationId),
    });
    if (detail?.bmsConversation) {
      apollo.cache.writeQuery({
        query: Q_CONV,
        variables: convVariables(conversationId),
        data: { bmsConversation: { ...detail.bmsConversation, unread: 0 } },
      });
    }
  }, [apollo, listVariables, convVariables]);

  // Refresh the first event immediately, then cap sustained bursts at two list
  // queries per second while guaranteeing one trailing refresh is not lost.
  const triggerListRefresh = useCallback(() => {
    const state = listRefreshState.current;
    if (state.timer) {
      state.pending = true;
      return;
    }
    const run = () => {
      void refetch();
      state.timer = setTimeout(() => {
        if (state.pending) {
          state.pending = false;
          run();
        } else {
          state.timer = null;
        }
      }, 500);
    };
    run();
  }, [refetch]);

  const markActiveConversationRead = useCallback(async (conversationId: string) => {
    clearUnreadInCache(conversationId);

    const current = readStateRef.current.get(conversationId);
    if (current?.running) {
      current.pending = true;
      return;
    }

    const state = { running: true, pending: false };
    readStateRef.current.set(conversationId, state);
    try {
      do {
        state.pending = false;
        await markRead({
          variables: { id: conversationId },
          optimisticResponse: { bmsMarkConversationRead: true },
          update: () => clearUnreadInCache(conversationId),
        });
        clearUnreadInCache(conversationId);
        // Refresh only after the DB is marked read. Refreshing before this point
        // can restore the stale unread value and leave the badge visible.
        await refetch();
      } while (state.pending);
    } catch (error) {
      console.warn("[BMS Inbox] mark active conversation read failed", error);
    } finally {
      readStateRef.current.delete(conversationId);
    }
  }, [clearUnreadInCache, markRead, refetch]);

  // The event contains no customer data; authoritative rows are fetched
  // through RBAC-scoped queries.
  useEffect(() => {
    const event = inboxChangedData?.bmsInboxChanged;
    if (!event?.conversationId) return;

    const isActiveEvent = event.conversationId === activeIdRef.current;
    const isActiveMessageEvent = isActiveEvent && event.kind === "MESSAGES_CHANGED";
    if (isActiveMessageEvent) {
      // The operator is already looking at this thread: clear its badge now,
      // then persist read state before the authoritative list refresh.
      void markActiveConversationRead(event.conversationId);
    } else {
      triggerListRefresh();
    }

    if (isActiveEvent && !convRefreshTimer.current) {
      convRefreshTimer.current = setTimeout(() => {
        convRefreshTimer.current = null;
        if (activeIdRef.current === event.conversationId) {
          void refetchConv(convVariables(event.conversationId));
        }
      }, 150);
    }
  }, [inboxChangedData, refetchConv, triggerListRefresh, markActiveConversationRead, convVariables]);

  useEffect(() => () => {
    if (listRefreshState.current.timer) clearTimeout(listRefreshState.current.timer);
    listRefreshState.current.timer = null;
    listRefreshState.current.pending = false;
    if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
  }, []);

  useEffect(() => {
    if (activeId) {
      loadConv({ variables: convVariables(activeId) });
      void markActiveConversationRead(activeId);
    }
  }, [activeId]); // eslint-disable-line

  // If the socket misses an event, the existing 20s list poll detects a newer
  // message and refreshes only the active pane instead of polling every pane.
  const activeListConversation = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );
  const activeListMessageAt = activeListConversation?.lastMessageAt;
  const activeListUnread = activeListConversation?.unread ?? 0;

  // Apollo normalizes the list and detail query to the same Conversation
  // entity. Consequently lastMessageAt can change on both queries at once and
  // is not sufficient to detect every missed socket event. The active card's
  // unread value is the authoritative UI trigger: whenever it rises above zero,
  // clear and persist it without waiting for another click or scroll action.
  useEffect(() => {
    if (activeId && activeListUnread > 0) {
      void markActiveConversationRead(activeId);
    }
  }, [activeId, activeListUnread, markActiveConversationRead]);

  useEffect(() => {
    if (!activeId || !activeListMessageAt || !conv?.lastMessageAt) return;
    if (activeListMessageAt !== conv.lastMessageAt && !convRefreshTimer.current) {
      void markActiveConversationRead(activeId);
      convRefreshTimer.current = setTimeout(() => {
        convRefreshTimer.current = null;
        if (activeIdRef.current === activeId) {
          void refetchConv(convVariables(activeId));
        }
      }, 150);
    }
  }, [activeId, activeListMessageAt, conv?.lastMessageAt, refetchConv, markActiveConversationRead]);

  // Final guard: whenever a newly fetched message is actually rendered in the
  // selected thread, its unread state must be cleared without another click.
  const renderedLatestMessageId = conv?.messages?.[conv.messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (activeId && conv?.id === activeId && conv.unread > 0 && renderedLatestMessageId) {
      void markActiveConversationRead(activeId);
    }
  }, [activeId, conv?.id, conv?.unread, renderedLatestMessageId, markActiveConversationRead]);

  const openConversation = useCallback((conversationId: string) => {
    setActiveId(conversationId);
    if (isMobile) setMobilePane("chat");
  }, [isMobile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: isMobile ? "calc(100dvh - 48px)" : "calc(100vh - 48px)", minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
      {(!isMobile || mobilePane === "list") && (
      <div style={{ marginBottom: isMobile ? 8 : 10, flexShrink: 0 }}>
        <Space style={{ width: "100%", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center" }} wrap>
          <Space direction="vertical" size={0}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 22 : 15, fontWeight: 800, lineHeight: 1.15 }}>BMS Inbox (Omnichannel)</h2>
            <Typography.Text type="secondary" style={{ fontSize: isMobile ? 12 : 10.5 }}>
              {t("admin_inbox.page_subtitle")}
            </Typography.Text>
          </Space>
          <Space wrap size={isMobile ? 8 : 8}>
            {me && (
              /* สถานะรับแชทเป็น pill สีตามสถานะจริง (mockup) — เดิมเป็น Switch เปล่า ๆ ที่ต้องเพ่งดูว่าเปิดอยู่ไหม */
              <Tooltip title={t("admin_inbox.availability_off_tooltip")}>
                <Space
                  size={6}
                  style={{
                    borderRadius: 999, paddingInline: 10, paddingBlock: 3,
                    background: me.is_available ? "rgba(5,150,105,0.10)" : "rgba(148,163,184,0.16)",
                  }}
                >
                  <Switch size="small" checked={me.is_available} loading={settingAvail}
                    onChange={(v) => setAvailability({ variables: { available: v } })} />
                  <Typography.Text style={{ fontSize: 11, fontWeight: 600, color: me.is_available ? "#059669" : "var(--app-muted, #64748b)" }}>
                    {t("admin_inbox.availability_on_label")}
                  </Typography.Text>
                </Space>
              </Tooltip>
            )}
            <Button size={isMobile ? "middle" : "small"} icon={<ReloadOutlined />} onClick={() => { refetch(); if (activeId) refetchConv(convVariables(activeId)); }} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>
      )}

      <div style={{ display: "flex", gap: isMobile ? 0 : 12, alignItems: "stretch", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* ---- left: conversation list ---- */}
        {/* padding ของคอลัมน์เป็น 0 ตอนกางอยู่ เพื่อให้แถวคิวและเส้นคั่นกินเต็มความกว้างแบบ mockup
            (ส่วนหัวคิวถือ padding ของตัวเองไว้) */}
        {showListPane && (
        <div style={{ width: isMobile ? "100%" : effectiveListCollapsed ? 72 : 320, flexShrink: 0, minHeight: 0, minWidth: 0, border: "1px solid var(--app-border, #eee)", borderRadius: isMobile ? 12 : 14, padding: effectiveListCollapsed ? "10px 6px" : 0, display: "flex", flexDirection: "column", background: PANEL_SURFACE, overflow: "hidden" }}>
          {/* หัวคิวไม่ต้องเป็นการ์ดซ้อนในการ์ด — ตัวคอลัมน์มีกรอบอยู่แล้ว กรอบชั้นที่สอง
              กินความกว้าง/ความสูงฟรี ๆ เหลือแค่เส้นคั่นด้านล่าง */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 0,
              padding: effectiveListCollapsed ? "0 0 8px" : isMobile ? "8px 10px" : "9px 10px",
              borderBottom: effectiveListCollapsed ? "none" : "1px solid var(--app-border, rgba(15,23,42,0.12))",
            }}
          >
          <div style={{ display: "flex", justifyContent: effectiveListCollapsed ? "center" : "space-between", alignItems: "center" }}>
            {!effectiveListCollapsed && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
                <Typography.Text strong style={{ fontSize: 13, lineHeight: 1.1 }}>{t("admin_inbox.queue_heading")}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.1, color: SUBTLE_TEXT }}>
                  {t("admin_inbox.queue_stats", { need: needReplyCount, pending: pendingCount })}
                </Typography.Text>
              </div>
            )}
            {!isMobile && (
            <Tooltip title={effectiveListCollapsed ? t("admin_inbox.expand_list_tooltip") : t("admin_inbox.collapse_list_tooltip")}>
              <Button type="text" size="small"
                icon={effectiveListCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleListCollapsed} />
            </Tooltip>
            )}
          </div>
          {!effectiveListCollapsed && (
            <>
              {/* ค้นหาอยู่เหนือแท็บสถานะตาม mockup — เป็นสิ่งที่ staff เอื้อมหาเร็วที่สุดเวลาลูกค้าโทรมา
                  ถามถึงแชทของตัวเอง ไม่ควรอยู่ใต้แถวตัวกรองที่กดนาน ๆ ครั้ง */}
              <Input
                size="small"
                placeholder={t("admin_inbox.search_placeholder")}
                allowClear
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                prefix={<SearchOutlined style={{ color: "var(--app-muted, #94a3b8)", fontSize: 11 }} />}
                style={{ borderRadius: 7, fontSize: 11.5, background: PANEL_SUNKEN_SURFACE }}
              />
              <Segmented
                block
                size="small"
                options={FILTERS as unknown as string[]}
                value={filter}
                onChange={(v) => setFilter(v as any)}
                style={{
                  marginBottom: 0,
                  padding: 2,
                  borderRadius: 8,
                  fontSize: 10.5,
                  fontWeight: 700,
                  background: PANEL_SUNKEN_SURFACE,
                }}
              />
            </>
          )}
          {/* ตัวกรองเนื้อหาแชท (ด่วน/สลิป/สินค้า) กับ "ของฉัน" เป็นคนละมิติกัน (กรองเนื้อหา vs.
              กรองเจ้าของแชท) เลย split เป็นสองกลุ่มคั่นด้วยเส้นบาง — กลุ่มซ้าย flex แถวเดียวไม่ wrap
              (เลื่อนแนวนอนได้ถ้าล้น) "ของฉัน" ปักขวาสุดเสมอ กันตกบรรทัดแบบที่เคยเกิดตอนเพิ่ม chip ที่ 4 */}
          {!effectiveListCollapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <div className="bms-inbox-filter-strip" style={{ display: "flex", gap: 6, overflowX: "auto", flex: 1, minWidth: 0, paddingBottom: 1 }}>
                <Button
                  size="small"
                  type={quickFilter === "urgent" ? "primary" : "default"}
                  danger={quickFilter !== "urgent"}
                  ghost={quickFilter !== "urgent"}
                  icon={<FireOutlined />}
                  onClick={() => setQuickFilter((prev) => prev === "urgent" ? null : "urgent")}
                  style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 24, fontWeight: 600, flexShrink: 0 }}
                >
                  {t("admin_inbox.filter_urgent")}
                </Button>
                <Button
                  size="small"
                  type={quickFilter === "payment" ? "primary" : "default"}
                  icon={<CreditCardOutlined />}
                  onClick={() => setQuickFilter((prev) => prev === "payment" ? null : "payment")}
                  style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 24, fontWeight: 600, flexShrink: 0, color: quickFilter === "payment" ? undefined : "#1677ff", borderColor: "rgba(22,119,255,0.35)" }}
                >
                  {t("admin_inbox.filter_payment")}
                </Button>
                <Button
                  size="small"
                  type={quickFilter === "product" ? "primary" : "default"}
                  icon={<ShoppingCartOutlined />}
                  onClick={() => setQuickFilter((prev) => prev === "product" ? null : "product")}
                  style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 24, fontWeight: 600, flexShrink: 0, color: quickFilter === "product" ? undefined : "#389e0d", borderColor: "rgba(82,196,26,0.45)" }}
                >
                  {t("admin_inbox.filter_product")}
                </Button>
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "var(--app-border, rgba(15,23,42,0.12))", flexShrink: 0 }} />
              {restrictedToOwn ? (
                <Tooltip title={t("admin_inbox.mine_only_sales_tooltip")}>
                  <Button size="small" type="default" disabled icon={<UserOutlined />}
                    style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 24, fontWeight: 600, flexShrink: 0 }}>
                    {t("admin_inbox.mine_only_chip")}
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip title={mineOnly ? t("admin_inbox.mine_only_on_tooltip") : t("admin_inbox.mine_only_off_tooltip")}>
                  <Button
                    size="small"
                    type={mineOnly ? "primary" : "default"}
                    icon={<UserOutlined />}
                    onClick={() => setMineOnly(!mineOnly)}
                    style={{ borderRadius: 999, paddingInline: 9, fontSize: 10.5, height: 24, fontWeight: 600, flexShrink: 0 }}
                  >
                    {t("admin_inbox.mine_only_chip")}
                  </Button>
                </Tooltip>
              )}
            </div>
          )}
          </div>
          <div
            className="bms-inbox-conversation-scroll"
            style={{ overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0, minWidth: 0, paddingRight: effectiveListCollapsed ? 8 : 0 }}
          >
            <List
              loading={loading} dataSource={visibleConversations}
              locale={{ emptyText: effectiveListCollapsed ? null : <Empty description={t("admin_inbox.empty_no_conversations")} /> }}
              renderItem={(c) => (
                <ConversationListItem
                  conversation={c}
                  active={activeId === c.id}
                  collapsed={effectiveListCollapsed}
                  onOpen={openConversation}
                />
              )}
            />
          </div>
        </div>
        )}

        {/* ---- middle: active conversation ---- */}
        {showConversationPane && (
        <div style={{ flex: "1 1 0", width: isMobile ? "100%" : undefined, minWidth: 0, minHeight: 0, overflow: "hidden", border: "1px solid var(--app-border, #eee)", borderRadius: 10, padding: isMobile ? 7 : 10, background: PANEL_SURFACE }}>
          {!conv ? (
            <Empty description={t("admin_inbox.empty_select_conversation")} style={{ marginTop: 120 }} />
          ) : (
            <ConversationPane key={conv.id} conv={conv} can={can} isMobile={isMobile} onBack={isMobile ? () => setMobilePane("list") : undefined}
              gender={me?.gender} tenantSlug={tenantSlug} initialTab={initialTab} onChanged={() => { refetchConv(convVariables(conv.id)); refetch(); }} />
          )}
        </div>
        )}

        {/* ---- right: Customer 360 panel ---- */}
        {showCustomer360Pane && customer360Ready && <Customer360Panel conv={conv} can={can} selectedCouponCode={selectedCouponCode} />}
      </div>
    </div>
  );
}

function ConversationPane({ conv, can, onChanged, isMobile = false, onBack, gender, tenantSlug, initialTab }: { conv: any; can: (p: string) => boolean; onChanged: () => void; isMobile?: boolean; onBack?: () => void; gender?: string | null; tenantSlug?: string | null; initialTab?: string | null }) {
  const { t } = useI18n();
  // ควบคุม tab เอง (เดิม uncontrolled, default "แชท" เสมอ) เพื่อรองรับ deep-link ?tab=notes
  // จาก mention notification — ใช้ initialTab แค่ตอนเปิดแชทนี้ครั้งแรก ไม่บังคับทับถ้า staff สลับแท็บเอง
  const [activeTabKey, setActiveTabKey] = useState(initialTab === "notes" ? "notes" : "chat");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [noteMentionQuery, setNoteMentionQuery] = useState<string | null>(null);
  const [noteMentions, setNoteMentions] = useState<{ id: string; name: string }[]>([]);
  // ปิด mention picker (dropdown position:absolute) เสมอเมื่อสลับออกจากแท็บโน้ต — กัน dropdown
  // ค้างเปิดขวางพื้นที่ของแท็บอื่นถ้า pane ที่ไม่ active ยังไม่ถูก unmount เต็มที่
  useEffect(() => {
    if (activeTabKey !== "notes") setNoteMentionQuery(null);
  }, [activeTabKey]);
  const [tags, setTags] = useState<string[]>(conv.tags || []);
  const [showAiSuggestion, setShowAiSuggestion] = useState(true);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [uploadAction, setUploadAction] = useState<"image" | "file" | null>(null);
  const [draftAttachment, setDraftAttachment] = useState<Attachment | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [couponPickerOpen, setCouponPickerOpen] = useState(false);
  const [couponSearch, setCouponSearch] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const isChatPinnedRef = useRef(true);
  const lastRenderedMessageIdRef = useRef<string | null>(null);
  const forceBottomRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onErr = (e: any) => message.error(e?.message || t("admin_inbox.action_failed"));

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const el = chatScrollRef.current;
      if (!el) return;
      programmaticScrollRef.current = true;
      isChatPinnedRef.current = true;
      setNewMessageCount(0);
      el.scrollTo({ top: el.scrollHeight, behavior });
      if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
      }, behavior === "smooth" ? 400 : 0);
    });
  }, []);

  const onChatScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
    isChatPinnedRef.current = pinned;
    if (pinned) setNewMessageCount(0);
  }, []);

  const [send, { loading: sending }] = useMutation(M_SEND, {
    onCompleted: (d: any) => {
      const r = d?.bmsSendMessage;
      if (r?.status === "SENT") {
        message.success(r.message);
        setReply("");
        setDraftAttachment(null);
        onChanged();
      }
      else onErr({ message: r?.message });
    },
    onError: (e) => {
      forceBottomRef.current = false;
      onErr(e);
    },
  });
  const [retry, { loading: retrying }] = useMutation(M_RETRY, {
    onCompleted: (d: any) => {
      const r = d?.bmsRetryMessage;
      if (r?.status === "SENT") { (r.delivered ? message.success : message.warning)(r.message); onChanged(); }
      else onErr({ message: r?.message });
    }, onError: onErr,
  });
  const [assign, { loading: assigning }] = useMutation(M_ASSIGN, { onCompleted: onChanged, onError: onErr });
  const [addHelper] = useMutation(M_HELPER_ADD, { onCompleted: onChanged, onError: onErr });
  const [removeHelper] = useMutation(M_HELPER_REMOVE, { onCompleted: onChanged, onError: onErr });
  const [setStatus] = useMutation(M_STATUS, { onCompleted: onChanged, onError: onErr });
  const [saveTags] = useMutation(M_TAGS, { onCompleted: () => { message.success(t("admin_inbox.tags_saved")); onChanged(); }, onError: onErr });
  const [addNote, { loading: noting }] = useMutation(M_NOTE, {
    onCompleted: () => { message.success(t("admin_inbox.note_added")); setNote(""); setNoteMentions([]); setNoteMentionQuery(null); onChanged(); }, onError: onErr,
  });
  const [loadTimeline, { data: tlData, loading: tlLoading }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });
  const [tlThisChatOnly, setTlThisChatOnly] = useState(false);
  const { data: staffData } = useQuery(Q_STAFF, { fetchPolicy: "cache-and-network" });
  const staffList: StaffRef[] = useMemo(() => staffData?.bmsAssignableStaff || [], [staffData?.bmsAssignableStaff]);
  const { data: productPickerData, loading: productPickerLoading } = useQuery(Q_PRODUCTS_PICKER, {
    variables: { search: productSearch || null },
    skip: !productPickerOpen,
    fetchPolicy: "cache-and-network",
  });
  const { data: couponPickerData, loading: couponPickerLoading } = useQuery(Q_COUPONS_PICKER, {
    skip: !couponPickerOpen || !can("coupon.view"),
    fetchPolicy: "cache-and-network",
  });
  const [loadCustomer, { data: custData, loading: custLoading, refetch: refetchCustomer }] = useLazyQuery(Q_CUSTOMER, { fetchPolicy: "cache-and-network" });
  const canViewCustomer = can("customer.view");
  const canReorder = can("order.create");
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reorder] = useMutation(M_REORDER, {
    onCompleted: (d: any) => {
      const r = d?.bmsReorderFromOrder;
      setReorderingId(null);
      if (r?.status === "CREATED") { message.success(r.message); refetchCustomer(); }
      else message.error(r?.message || t("admin_inbox.reorder_failed"));
    },
    onError: (e) => { setReorderingId(null); onErr(e); },
  });

  useEffect(() => {
    if (canViewCustomer && conv.customerId) loadCustomer({ variables: { id: conv.customerId } });
  }, [conv.customerId, canViewCustomer]); // eslint-disable-line

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(AI_SUGGESTION_VISIBILITY_KEY);
    setShowAiSuggestion(saved !== "hidden");
  }, []);

  const toggleAiSuggestion = () => {
    setShowAiSuggestion((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(AI_SUGGESTION_VISIBILITY_KEY, next ? "shown" : "hidden");
      }
      return next;
    });
  };

  const canManage = can("inbox.manage");
  const canAssign = can("inbox.assign");
  const canHelp = can("inbox.reply");
  const action = useMemo(() => nextAction(conv, t), [conv, t]);
  const aiReply = useMemo(() => suggestedReply(conv, gender), [conv, gender]);
  const aiIntent = action.key === "check_stock"
    ? t("admin_inbox.ai_intent_ask_product")
    : action.key === "confirm_slip"
      ? t("admin_inbox.ai_intent_payment")
      : action.key === "issue_tracking"
        ? t("admin_inbox.ai_intent_shipping")
        : t("admin_inbox.ai_intent_need_reply");

  // กัน primary โผล่เป็น helper ด้วย (เผื่อข้อมูลเก่าก่อน backend cleanup) — คนละบทบาทกัน ห้ามซ้ำ
  const helpers: StaffRef[] = useMemo(
    () => (conv.helpers || []).filter((h: StaffRef) => h.id !== conv.assignedStaff?.id),
    [conv.helpers, conv.assignedStaff?.id]
  );
  const helperCandidates = useMemo(() => {
    const helperIds = new Set(helpers.map((h) => h.id));
    return staffList.filter((s) => s.id !== conv.assignedStaff?.id && !helperIds.has(s.id));
  }, [staffList, helpers, conv.assignedStaff?.id]);

  const headerControls = (
    <Space size={8} wrap style={{ justifyContent: isMobile ? "flex-start" : "flex-end", width: isMobile ? "100%" : undefined }}>
      <Select size="small" value={conv.status} style={{ width: isMobile ? 94 : 102 }} disabled={!canManage}
          onChange={(v) => setStatus({ variables: { id: conv.id, status: v } })}
          options={["OPEN", "PENDING", "CLOSED"].map((s) => ({ value: s, label: s }))} />
      <Select
        size="small" style={{ minWidth: isMobile ? 158 : 170, flex: isMobile ? "1 1 158px" : undefined }} disabled={!canAssign} loading={assigning}
        value={conv.assignedStaff?.id ?? undefined}
        placeholder={t("admin_inbox.no_primary_staff_placeholder")}
        onChange={(userId) => assign({ variables: { id: conv.id, userId } })}
        options={staffList.map((s) => ({ value: s.id, label: staffLabel(s, t) }))}
      />
    </Space>
  );

  const header = (
    <div style={{ display: "grid", gap: isMobile ? 4 : 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: isMobile ? 8 : 10, alignItems: "flex-start", flexWrap: isMobile ? "nowrap" : "wrap" }}>
        <Space direction="vertical" size={0} style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, width: "100%" }}>
            {isMobile && (
              <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} style={{ flexShrink: 0 }} />
            )}
            <Avatar
              size={isMobile ? 28 : 26}
              src={conv.customerAvatar || undefined}
              icon={conv.customerAvatar || conv.customerName || conv.customerRef ? undefined : <UserOutlined />}
              style={conv.customerAvatar ? { flexShrink: 0 } : { flexShrink: 0, background: "linear-gradient(135deg, #1677ff, #059669)", fontSize: 10, fontWeight: 700 }}
            >
              {(conv.customerName || conv.customerRef || "").slice(0, 1).toUpperCase() || undefined}
            </Avatar>
            <Typography.Text strong ellipsis style={{ fontSize: isMobile ? 14 : 12.5, minWidth: 0, flex: "0 1 auto" }}>
              {conv.customerName || conv.customerRef || t("admin_inbox.customer_fallback")}
            </Typography.Text>
            {/* ช่องทางเป็น chip จางแบบเดียวกับในคิว (mockup) ไม่ใช่ Tag สีทึบที่เด่นกว่าชื่อลูกค้าเอง */}
            <span style={CHANNEL_CHIP_STYLE}>{conv.channel}</span>
            {isMobile && (
              <Tag color={STATUS_COLOR[conv.status as ConvStatus] || "default"} style={{ marginInlineEnd: 0, flexShrink: 0, fontSize: 10, lineHeight: "18px", paddingInline: 6 }}>{conv.status}</Tag>
            )}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 10, lineHeight: 1.25 }}>{conv.customerRef || conv.id}</Typography.Text>
          {sourceLabel(conv, t) && (
            <Space size={6} wrap={!isMobile} style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t("admin_inbox.from_prefix")}</Typography.Text>
              <Avatar size={16} src={conv.sourceAvatar || undefined} style={{ fontSize: 8 }}>
                {(conv.sourceDisplayName || conv.channel || "?").slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography.Text ellipsis style={{ fontSize: 11, minWidth: 0, maxWidth: isMobile ? "calc(100vw - 118px)" : undefined }}>{sourceLabel(conv, t)}</Typography.Text>
            </Space>
          )}
        </Space>
        {!isMobile && headerControls}
      </div>

      {isMobile && headerControls}

      {/* แถบ chip ใต้หัวแชท: มีแค่ AI ที่ติดสี ที่เหลือเป็นเส้นขอบจาง (mockup) — เดิม Tag สีทึบ 4 อัน
          เรียงกันทำให้ไม่รู้ว่าอันไหนสำคัญ ยกเว้น "ยังไม่ผูก CRM" ที่ยังเป็นสีเตือนเพราะต้องลงมือแก้จริง */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <Tag
          icon={<ThunderboltOutlined />}
          style={{ ...TOOL_CHIP_BASE, color: "#1677ff", borderColor: "rgba(22,119,255,0.3)", background: "rgba(22,119,255,0.06)" }}
        >
          AI: {aiIntent}
        </Tag>
        <Tag icon={action.icon} style={TOOL_CHIP_BASE}>
          {action.value}
        </Tag>
        <Tag
          icon={<ShoppingCartOutlined />}
          style={conv.customerId ? TOOL_CHIP_BASE : { ...TOOL_CHIP_BASE, color: "#d97706", borderColor: "rgba(217,119,6,0.35)", background: "rgba(217,119,6,0.06)" }}
        >
          {conv.customerId ? t("admin_inbox.crm_linked") : t("admin_inbox.crm_not_linked")}
        </Tag>
        {/* ผู้ช่วยตอบ (คน) กับแท็ก (ป้ายกำกับ) เป็นคนละมิติกัน — เดิม toggle ตัวเดียวเปิดทั้งคู่พร้อมกัน
            ทำให้แถวที่ขยายออกมาปนกันไม่มีขอบเขต แยกเป็นปุ่ม Popover คนละอันแทน แต่ละอันไม่ดันความสูง
            ของหัวแชทเลยตอนปิดอยู่ (ต่างจากแถวขยายเดิมที่ต้องเผื่อพื้นที่ไว้เสมอ) */}
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={
            <Space direction="vertical" size={8} style={{ minWidth: 200 }}>
              <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {t("admin_inbox.helpers_label")}
              </Typography.Text>
              <Space size={6} wrap>
                {helpers.length === 0 && <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t("admin_inbox.helpers_none")}</Typography.Text>}
                {helpers.map((h) => (
                  <Tooltip key={h.id} title={h.name || h.email || h.id}>
                    <span style={{ position: "relative", display: "inline-flex" }}>
                      <Avatar size={18} src={h.avatar || undefined} style={{ fontSize: 9 }}>
                        {(h.name || "?").slice(0, 1).toUpperCase()}
                      </Avatar>
                      {canHelp && (
                        <CloseOutlined
                          onClick={() => removeHelper({ variables: { id: conv.id, userId: h.id } })}
                          style={{ position: "absolute", top: -4, right: -4, fontSize: 8, background: "#ff4d4f", color: "#fff", borderRadius: "50%", padding: 2, cursor: "pointer" }}
                        />
                      )}
                    </span>
                  </Tooltip>
                ))}
                {canHelp && (
                  helperCandidates.length > 0 ? (
                    <Popover
                      trigger="click"
                      placement="bottomRight"
                      content={
                        <Select
                          size="small" style={{ width: 220 }} placeholder={t("admin_inbox.add_helper_placeholder")}
                          options={helperCandidates.map((s) => ({ value: s.id, label: staffLabel(s, t) }))}
                          onSelect={(userId: string) => addHelper({ variables: { id: conv.id, userId } })}
                        />
                      }
                    >
                      <Button type="dashed" size="small" shape="circle" icon={<PlusOutlined style={{ fontSize: 10 }} />} />
                    </Popover>
                  ) : (
                    <Tooltip title={t("admin_inbox.no_other_staff_tooltip")}>
                      <Button type="dashed" size="small" shape="circle" disabled icon={<PlusOutlined style={{ fontSize: 10 }} />} />
                    </Tooltip>
                  )
                )}
              </Space>
            </Space>
          }
        >
          <Tag icon={<UsergroupAddOutlined />} style={{ ...TOOL_CHIP_BASE, cursor: "pointer" }}>
            {t("admin_inbox.helpers_chip", { n: helpers.length || 0 })}
          </Tag>
        </Popover>
        {canManage && (
          <Popover
            trigger="click"
            placement="bottomLeft"
            content={
              <Space direction="vertical" size={8} style={{ minWidth: 200 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {t("admin_inbox.tags_of_chat")}
                </Typography.Text>
                <Select mode="tags" size="small" style={{ minWidth: 200 }} value={tags} onChange={setTags} placeholder={t("admin_inbox.tags_placeholder")} />
                <Button size="small" style={{ alignSelf: "flex-end" }} onClick={() => saveTags({ variables: { id: conv.id, tags } })}>{t("admin_inbox.save_tags_button")}</Button>
              </Space>
            }
          >
            <Tag icon={<TagsOutlined />} style={{ ...TOOL_CHIP_BASE, cursor: "pointer" }}>
              {t("admin_inbox.tags_chip", { n: tags.length || 0 })}
            </Tag>
          </Popover>
        )}
      </div>
    </div>
  );

  const [uploading, setUploading] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const productItems: ProductPickerItem[] = useMemo(
    () => productPickerData?.bmsProducts?.items || [],
    [productPickerData?.bmsProducts?.items]
  );
  const couponItems: CouponPickerItem[] = useMemo(() => {
    const needle = couponSearch.trim().toLowerCase();
    return (couponPickerData?.bmsCoupons || [])
      .filter((coupon: CouponPickerItem) => coupon.active)
      .filter((coupon: CouponPickerItem) => !needle || coupon.code.toLowerCase().includes(needle));
  }, [couponPickerData?.bmsCoupons, couponSearch]);

  const sendWith = (attachment: Attachment | null) => {
    const body = reply.trim();
    if (!body && !attachment) return;
    forceBottomRef.current = true;
    scrollChatToBottom("auto");
    send({
      variables: {
        id: conv.id,
        body: body || null,
        attachment: attachment ? { url: attachment.url, name: attachment.name, mimeType: attachment.mimeType } : null,
      },
    });
  };
  const submitReply = () => { if (!sending && !uploading) sendWith(draftAttachment); };

  const uploadForDraft = async (file: File) => {
    setUploading(true);
    setUploadAction(/^image\//i.test(file.type || "") ? "image" : "file");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bms/inbox/upload", { method: "POST", body: fd, credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || t("admin_inbox.upload_failed"));
      setDraftAttachment({ url: j.url, name: j.name, mimeType: j.mimeType, isImage: /^image\//i.test(j.mimeType || "") });
      message.success(t("admin_inbox.attachment_added"));
    } catch (e: any) {
      message.error(e?.message || t("admin_inbox.upload_failed"));
    } finally {
      setUploading(false);
      setUploadAction(null);
    }
  };
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void uploadForDraft(f);
    e.target.value = ""; // reset ให้เลือกไฟล์เดิมซ้ำได้
  };

  // Phase 1 status: OUT เท่านั้น · FAILED → ปุ่มส่งใหม่ · SENT → capability-gated
  const statusNode = (m: Msg) => {
    if (m.direction !== "OUT" || !m.status) return null;
    if (m.status === "FAILED") return (
      <>{" · "}<span style={{ color: "#ff4d4f" }}>✗ {t("admin_inbox.send_failed_label")}</span>{" "}
        <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 11 }}
          loading={retrying} onClick={() => retry({ variables: { id: m.id } })}>{t("admin_inbox.resend_button")}</Button>
      </>
    );
    return m.canReportDelivery
      ? <>{" · "}<span style={{ color: "#52c41a" }}>✓ {t("admin_inbox.sent_label")}</span></>
      : <Tooltip title={t("admin_inbox.no_delivery_report_tooltip")}><span>{" · ✓ "}{t("admin_inbox.saved_label")}</span></Tooltip>;
  };

  const emojiPicker = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 30px)", gap: 2 }}>
      {EMOJIS.map((e) => (
        <span key={e} onClick={() => setReply((r) => r + e)}
          style={{ cursor: "pointer", fontSize: 20, textAlign: "center", lineHeight: "30px", borderRadius: 4, userSelect: "none" }}>
          {e}
        </span>
      ))}
    </div>
  );

  // สายแชทรวม: ข้อความ + system event + marker เริ่มสนทนา เรียงตามเวลา แล้วคั่นด้วย date separator
  type FeedItem =
    | { t: "start"; at: string }
    | { t: "msg"; at: string; msg: Msg }
    | { t: "event"; at: string; ev: SystemEvent };
  const msgs: Msg[] = conv.messages || [];
  const latestMessageId = msgs[msgs.length - 1]?.id ?? null;
  const chatImages = msgs
    .filter((m) => m.attachment?.isImage && m.attachment?.url)
    .map((m) => ({
      id: m.id,
      url: m.attachment!.url,
      name: m.attachment?.name || "image",
      sender: m.sender,
      createdAt: m.createdAt,
      body: m.body,
    }));
  const events: SystemEvent[] = conv.systemEvents || [];
  // marker เริ่มสนทนายึดเวลาที่เก่าที่สุดระหว่าง created_at กับข้อความแรก (กัน seed ที่ created_at = now())
  const earliest = msgs.reduce((min, m) => (min && m.createdAt > min ? min : m.createdAt), conv.createdAt || "");
  const feed: FeedItem[] = [
    ...(earliest ? [{ t: "start", at: earliest } as FeedItem] : []),
    ...msgs.map((m) => ({ t: "msg", at: m.createdAt, msg: m } as FeedItem)),
    ...events.map((ev) => ({ t: "event", at: ev.at, ev } as FeedItem)),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // เปิดแชทครั้งแรกให้เห็นข้อความล่าสุดทันที ส่วนข้อความชุดถัดไปจะตามลงล่าง
  // เฉพาะเมื่อผู้ใช้ยังอยู่ใกล้ล่าง หากกำลังอ่านย้อนหลังให้รักษาตำแหน่งไว้
  // และใช้ปุ่ม "ข้อความใหม่" แทนการแย่ง scrollbar.
  useLayoutEffect(() => {
    const previousId = lastRenderedMessageIdRef.current;
    if (!previousId) {
      lastRenderedMessageIdRef.current = latestMessageId;
      scrollChatToBottom("auto");
      return;
    }
    if (!latestMessageId || latestMessageId === previousId) return;

    const previousIndex = msgs.findIndex((m) => m.id === previousId);
    const appended = previousIndex >= 0 ? msgs.slice(previousIndex + 1) : [msgs[msgs.length - 1]];
    const newInboundCount = appended.filter((m) => m?.direction === "IN").length;
    lastRenderedMessageIdRef.current = latestMessageId;

    if (forceBottomRef.current || isChatPinnedRef.current) {
      const behavior: ScrollBehavior = forceBottomRef.current ? "auto" : "smooth";
      forceBottomRef.current = false;
      scrollChatToBottom(behavior);
    } else if (newInboundCount > 0) {
      setNewMessageCount((count) => count + newInboundCount);
    }
  }, [latestMessageId, msgs.length, scrollChatToBottom]); // eslint-disable-line react-hooks/exhaustive-deps

  // optimistic bubble ของข้อความที่ staff ส่งเองต้องอยู่ใน viewport ทันที
  // แม้ข้อความจริงยังรอ mutation/refetch อยู่.
  useLayoutEffect(() => {
    if ((sending || uploading) && forceBottomRef.current) {
      scrollChatToBottom("auto");
    }
  }, [sending, uploading, scrollChatToBottom]);

  // รูป/ไฟล์และฟอนต์สามารถเปลี่ยนความสูงภายหลัง render ได้ หากผู้ใช้ปักอยู่
  // ด้านล่างให้รักษาตำแหน่งล่าง แต่ห้ามแตะ scroll เมื่อกำลังอ่านย้อนหลัง.
  useEffect(() => {
    const feedEl = chatFeedRef.current;
    if (!feedEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isChatPinnedRef.current) scrollChatToBottom("auto");
    });
    observer.observe(feedEl);
    return () => observer.disconnect();
  }, [scrollChatToBottom]);

  useEffect(() => () => {
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
    if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
  }, []);

  const movePreview = (delta: number) => {
    if (!chatImages.length) return;
    setImagePreviewIndex((prev) => {
      const current = prev ?? 0;
      return (current + delta + chatImages.length) % chatImages.length;
    });
  };

  useEffect(() => {
    if (imagePreviewIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); movePreview(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); movePreview(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imagePreviewIndex, chatImages.length]);

  const centerRow = (key: string, node: React.ReactNode) => (
    <div key={key} style={{ alignSelf: "center", maxWidth: "88%", textAlign: "center" }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{node}</Typography.Text>
    </div>
  );
  const couponDiscountText = (coupon: CouponPickerItem) =>
    coupon.type === "PERCENT"
      ? `${Number(coupon.value).toLocaleString("th-TH")}%`
      : `${Number(coupon.value).toLocaleString("th-TH")} บาท`;
  const couponExpiresText = (expiresAt?: string | null) =>
    expiresAt ? new Date(expiresAt).toLocaleDateString("th-TH", { timeZone: BKK, day: "numeric", month: "short", year: "numeric" }) : "ไม่มีกำหนด";
  const insertCouponIntoChat = (coupon: CouponPickerItem) => {
    const usageLeft = coupon.maxRedemptions == null ? "ไม่จำกัดจำนวนครั้ง" : `เหลือ ${Math.max(0, coupon.maxRedemptions - coupon.redemptionsCount).toLocaleString("th-TH")} ครั้ง`;
    const minOrder = coupon.minOrderAmount ? `${Number(coupon.minOrderAmount).toLocaleString("th-TH")} บาท` : "ไม่มีขั้นต่ำ";
    setReply((prev) => {
      const prefix = prev.trim() ? `${prev.trim()}\n` : "";
      return `${prefix}🎟 คุณได้รับคูปองส่วนลดแล้วค่ะ\nโค้ด ${coupon.code}\nส่วนลด ${couponDiscountText(coupon)}\nขั้นต่ำ ${minOrder}\nใช้ได้ถึง ${couponExpiresText(coupon.expiresAt)}\nสิทธิ์ ${usageLeft}\n\nคูปองนี้ถูกเพิ่มเข้ากระเป๋าคูปองของคุณแล้วค่ะ`;
    });
    setDraftAttachment(null);
    setCouponPickerOpen(false);
    message.success(t("admin_inbox.coupon_added_toast", { code: coupon.code }));
  };
  const insertProductIntoChat = (product: ProductPickerItem, includeImage: boolean) => {
    const firstAvailable = (product.variants || []).find((variant) => variant.available > 0) || product.variants?.[0];
    const stockText = firstAvailable
      ? `ไซซ์ ${firstAvailable.size} · เหลือ ${firstAvailable.available} ชิ้น`
      : "เช็กไซซ์และสต็อกได้";
    const priceText = Number.isFinite(Number(product.price))
      ? `${Number(product.price).toLocaleString("th-TH")} บาท`
      : null;
    const publicPath = tenantSlug
      ? `/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(product.sku)}`
      : null;
    const publicUrl = publicPath && typeof window !== "undefined"
      ? new URL(publicPath, window.location.origin).toString()
      : publicPath;
    setReply((prev) => {
      const prefix = prev.trim() ? `${prev.trim()}\n` : "";
      const details = `${product.name} (${product.sku})${priceText ? ` · ${priceText}` : ""} · ${stockText}`;
      return `${prefix}${details}${publicUrl ? `\nดูรายละเอียดสินค้า: ${publicUrl}` : ""}`;
    });
    setDraftAttachment(includeImage && product.imageUrl
      ? { url: product.imageUrl, name: `${product.name} (${product.sku})`, mimeType: "image/*", isImage: true }
      : null);
    setProductPickerOpen(false);
    message.success(includeImage && product.imageUrl ? t("admin_inbox.product_added_with_image_toast") : t("admin_inbox.product_added_toast"));
  };
  const renderMsg = (m: Msg) => {
    const isIn = m.direction === "IN";
    const isStaff = m.sender?.startsWith("staff");
    const product = parseProductShare(m.body);
    const coupon = parseCouponShare(m.body);
    const rowClass = `${messageStyles.messageRow} ${isIn ? messageStyles.incomingRow : messageStyles.outgoingRow}`;
    const cardClass = `${messageStyles.card} ${isIn ? messageStyles.incomingCard : messageStyles.outgoingCard}`;
    const openImage = () => {
      const idx = chatImages.findIndex((image) => image.id === m.id);
      setImagePreviewIndex(idx >= 0 ? idx : 0);
    };

    let content: React.ReactNode;
    if (coupon) {
      content = (
        <div className={`${cardClass} ${messageStyles.couponCard}`} data-message-kind="coupon">
          <div className={messageStyles.couponIcon} aria-hidden="true"><TagsOutlined /></div>
          <div className={messageStyles.couponInfo}>
            <div className={messageStyles.productType}><TagsOutlined /> {t("admin_inbox.coupon_badge")}</div>
            <div className={messageStyles.couponCode}>{coupon.code}</div>
            {coupon.discount && <div className={messageStyles.couponDiscount}>{t("admin_inbox.coupon_discount_prefix", { discount: coupon.discount })}</div>}
            <Space size={4} wrap style={{ marginTop: 6 }}>
              {coupon.minOrder && <Tag style={{ marginInlineEnd: 0 }}>{t("admin_inbox.coupon_min_order_prefix", { minOrder: coupon.minOrder })}</Tag>}
              {coupon.expires && <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t("admin_inbox.coupon_expires_prefix", { expires: coupon.expires })}</Tag>}
              {coupon.usage && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{coupon.usage}</Tag>}
            </Space>
            {coupon.walletUrl ? (
              <a className={messageStyles.productLink} href={coupon.walletUrl} target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>
                {t("admin_inbox.open_coupon_wallet_link")} <RightOutlined />
              </a>
            ) : (
              <div className={messageStyles.productCaption} style={{ margin: "8px 0 0" }}>
                {t("admin_inbox.coupon_added_to_wallet_note")}
              </div>
            )}
          </div>
        </div>
      );
    } else if (product) {
      content = (
        <div className={`${cardClass} ${messageStyles.productCard}`} data-message-kind="product">
          {m.attachment?.isImage ? (
            <button type="button" className={messageStyles.productImageButton} onClick={openImage} aria-label={t("admin_inbox.view_image_aria", { name: product.name })}>
              <img src={m.attachment.url} alt={m.attachment.name || product.name} />
            </button>
          ) : (
            <div className={messageStyles.productPlaceholder} aria-hidden="true"><ShoppingCartOutlined /></div>
          )}
          <div className={messageStyles.productInfo}>
            <div className={messageStyles.productType}><ShoppingCartOutlined /> {t("admin_inbox.product_badge")}</div>
            <div className={messageStyles.productName}>{product.name}</div>
            <div className={messageStyles.productSku}>SKU: {product.sku}</div>
            {product.price && <div className={messageStyles.productPrice}>{product.price}</div>}
            {product.stock && <div className={messageStyles.stockPill}>{product.stock}</div>}
            <a className={messageStyles.productLink} href={product.url} target="_blank" rel="noreferrer">{t("admin_inbox.view_product_link")} <RightOutlined /></a>
          </div>
          {product.caption && <div className={messageStyles.productCaption}>{product.caption}</div>}
        </div>
      );
    } else if (m.attachment?.isImage) {
      content = (
        <div className={`${cardClass} ${messageStyles.mediaCard}`} data-message-kind="image">
          <button type="button" className={messageStyles.imageButton} onClick={openImage} aria-label={t("admin_inbox.view_image_aria", { name: m.attachment.name || t("admin_inbox.preview_image") })}>
            <img src={m.attachment.url} alt={m.attachment.name || "image"} />
          </button>
          <div className={messageStyles.mediaFooter}>
            <div className={messageStyles.mediaCaption}>{m.body || m.attachment.name || t("admin_inbox.preview_image")}</div>
            <a className={messageStyles.cardAction} href={m.attachment.url} target="_blank" rel="noreferrer" aria-label={t("admin_inbox.download_image_aria")}>
              <DownloadOutlined />
            </a>
          </div>
        </div>
      );
    } else if (m.attachment) {
      const kind = fileKind(m.attachment);
      content = (
        <div className={`${cardClass} ${messageStyles.fileCard}`} data-message-kind="file">
          <div className={`${messageStyles.fileIcon} ${kind.pdf ? messageStyles.pdfIcon : ""}`} aria-hidden="true">
            {kind.pdf ? <FilePdfOutlined /> : <FileOutlined />}
          </div>
          <div className={messageStyles.fileInfo}>
            <div className={messageStyles.fileName}>{m.attachment.name || t("admin_inbox.file_attachment_fallback")}</div>
            <div className={messageStyles.fileMeta}>{kind.label}</div>
            {m.body && <div className={messageStyles.fileCaption}>{m.body}</div>}
          </div>
          <a className={messageStyles.cardAction} href={m.attachment.url} target="_blank" rel="noreferrer" aria-label={t("admin_inbox.download_file_aria", { name: m.attachment.name || t("admin_inbox.file_attachment_fallback") })}>
            <DownloadOutlined />
          </a>
        </div>
      );
    } else {
      const textClass = isIn ? messageStyles.incomingText : isStaff ? messageStyles.staffText : messageStyles.aiText;
      content = <div className={`${messageStyles.textBubble} ${textClass}`} data-message-kind="text">{m.body}</div>;
    }

    return (
      <div key={`m-${m.id}`} className={rowClass} style={{ maxWidth: isMobile ? "94%" : "62%" }}>
        {content}
        <Typography.Text type="secondary" className={messageStyles.meta}>
          {m.sender} · {timeLabel(m.createdAt)}{statusNode(m)}
        </Typography.Text>
      </div>
    );
  };

  const feedNodes: React.ReactNode[] = [];
  let prevDay = "";
  for (const item of feed) {
    const key = dayKey(item.at);
    if (key !== prevDay) {
      prevDay = key;
      feedNodes.push(
        <div key={`d-${key}`} style={{ alignSelf: "center", margin: "4px 0" }}>
          <span style={{ fontSize: 11, color: "var(--app-muted, #888)", background: "rgba(148,163,184,0.16)", padding: "2px 10px", borderRadius: 10 }}>
            {dayLabel(item.at, t)}
          </span>
        </div>
      );
    }
    if (item.t === "start") feedNodes.push(centerRow("start", <>{t("admin_inbox.conversation_start_label", { channel: conv.channel })} · {timeLabel(item.at)}</>));
    else if (item.t === "event") feedNodes.push(centerRow(`e-${item.ev.id}`, <>{eventIcon(item.ev.kind)} {eventText(item.ev, t)} · {timeLabel(item.at)}</>));
    else feedNodes.push(renderMsg(item.msg));
  }

  const chatTab = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* ข้อความ — เต็มพื้นที่ด้านบน scroll ได้ */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {/* พื้นสายแชทจมลงหนึ่งระดับจากหัวแชท/composer ที่เป็นสีพื้นการ์ด (mockup) — ทำให้ bubble ขาว
            ของลูกค้ามีขอบเขตชัดขึ้นโดยไม่ต้องใช้พื้นเทาทึบใน bubble */}
        <div
          ref={chatScrollRef}
          onScroll={onChatScroll}
          style={{ height: "100%", overflowY: "auto", padding: isMobile ? 8 : 12, background: "var(--app-bg, #f8fafc)", borderRadius: 8 }}
        >
          <div ref={chatFeedRef} style={{ minHeight: "100%", display: "flex", flexDirection: "column", gap: isMobile ? 6 : 6 }}>
            {feedNodes}
            {/* optimistic: กำลังส่ง/อัปโหลด */}
            {sending && (
              <div style={{ alignSelf: "flex-end", maxWidth: isMobile ? "86%" : "75%", display: "flex", flexDirection: "column", alignItems: "flex-end", opacity: 0.6 }}>
                <div style={{ background: "#1677ff", color: "#fff", padding: "8px 12px", borderRadius: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {reply || (draftAttachment?.isImage ? "[รูปภาพ]" : draftAttachment ? `[ไฟล์] ${draftAttachment.name || ""}` : "…")}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 2 }}>⏳ {t("admin_inbox.sending_label")}</Typography.Text>
              </div>
            )}
          </div>
        </div>
        {newMessageCount > 0 && (
          <Button
            type="primary"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => scrollChatToBottom("smooth")}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              transform: "translateX(-50%)",
              borderRadius: 999,
              boxShadow: "0 8px 24px rgba(22,119,255,0.28)",
              zIndex: 2,
            }}
          >
            {t("admin_inbox.new_messages_button", { count: newMessageCount })}
          </Button>
        )}
      </div>

      {/* คำตอบแนะนำ = grid คอลัมน์เดียว (หัว / ข้อความ / ปุ่ม) ไม่ใช่ flex row ที่เอาข้อความไปแข่งพื้นที่
          กับกลุ่มปุ่ม — โครงเดิมบนจอ ~360px ปุ่มไม่ยอมตกบรรทัด ข้อความจึงถูกบีบเป็นคอลัมน์แคบและหัวข้อ
          ตัด 2 บรรทัด · ปุ่มตา/ป้าย "AI" ยุบเข้ามาเป็นหัวการ์ด ประหยัดไปอีกหนึ่งแถวเต็ม */}
      {can("inbox.reply") && (
        <div style={{ display: "grid", gap: 8, marginTop: 6, flexShrink: 0 }}>
          {showAiSuggestion ? (
            <div style={{
              display: "grid",
              gap: 8,
              border: "1px dashed rgba(22,119,255,0.45)",
              background: "rgba(22,119,255,0.08)",
              borderRadius: isMobile ? 12 : 14,
              padding: isMobile ? 10 : 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Typography.Text style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em", color: "#1677ff" }}>
                  <ThunderboltOutlined /> {t("admin_inbox.ai_suggested_reply_title")}
                </Typography.Text>
                <Tooltip title={t("admin_inbox.hide_ai_suggestion_tooltip")}>
                  <Button size="small" shape="circle" icon={<EyeInvisibleOutlined />} onClick={toggleAiSuggestion} />
                </Tooltip>
              </div>
              <Typography.Text style={{ fontSize: 12.5, lineHeight: 1.5 }}>{aiReply}</Typography.Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <Button size="small" type="primary" style={{ fontSize: 11.5, fontWeight: 700 }} onClick={() => setReply(aiReply)}>{t("admin_inbox.insert_reply_button")}</Button>
                {/* คำตอบด่วนเป็น chip — เป็น template ของระบบ ไม่ใช่ข้อความที่ AI แนะนำ จึงไม่ควรหนักเท่าปุ่มหลัก
                    (ข้อความ template เองคงเป็นภาษาไทยเสมอ เพราะเป็นข้อความที่ส่งหาลูกค้าโดยตรง ไม่ใช่ UI) */}
                <Button size="small" style={{ borderRadius: 999, paddingInline: 10, fontSize: 11 }}
                  onClick={() => setReply(applyGenderParticle("ขออนุญาตตรวจสอบข้อมูลให้นิดนึงนะคะ เดี๋ยวแจ้งกลับทันทีค่ะ", gender))}>{t("admin_inbox.quick_reply_check_button")}</Button>
                <Button size="small" style={{ borderRadius: 999, paddingInline: 10, fontSize: 11 }}
                  onClick={() => setReply(applyGenderParticle("ขอบคุณค่ะ หากมีข้อมูลเพิ่มเติมส่งมาได้เลยนะคะ 🙏", gender))}>{t("admin_inbox.quick_reply_thanks_button")}</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <Tag color="blue" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999, fontSize: 11 }}>
                {t("admin_inbox.ai_hidden_tag")}
              </Tag>
              <Tooltip title={t("admin_inbox.show_ai_suggestion_tooltip")}>
                <Button size="small" shape="circle" icon={<EyeOutlined />} onClick={toggleAiSuggestion} />
              </Tooltip>
            </div>
          )}
        </div>
      )}

      {/* กล่องพิมพ์ — ปักล่างสุด + toolbar */}
      {can("inbox.reply") && (
        <div style={{ borderTop: "1px solid var(--app-border, #303030)", paddingTop: 8, marginTop: 6, flexShrink: 0 }}>
          <input ref={imgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickFile} />
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
          <Modal
            title={t("admin_inbox.coupon_modal_title")}
            open={couponPickerOpen}
            onCancel={() => setCouponPickerOpen(false)}
            footer={null}
            width={isMobile ? "100%" : 640}
            style={isMobile ? { top: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
          >
            {!can("coupon.view") ? (
              <Alert type="warning" showIcon message={t("admin_inbox.no_coupon_permission")} />
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <Input.Search
                  placeholder={t("admin_inbox.coupon_search_placeholder")}
                  allowClear
                  value={couponSearch}
                  onChange={(e) => setCouponSearch(e.target.value)}
                />
                {!couponItems.length && !couponPickerLoading ? (
                  <Empty description={t("admin_inbox.no_active_coupons")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <List
                    loading={couponPickerLoading}
                    dataSource={couponItems}
                    renderItem={(item) => {
                      const usageLeft = item.maxRedemptions == null ? t("admin_inbox.coupon_unlimited") : t("admin_inbox.coupon_usage_left", { n: Math.max(0, item.maxRedemptions - item.redemptionsCount).toLocaleString("th-TH") });
                      return (
                        <List.Item
                          actions={[
                            <Button key="insert" type="primary" size="small" onClick={() => insertCouponIntoChat(item)}>{t("admin_inbox.insert_into_draft_button")}</Button>,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={<Avatar icon={<TagsOutlined />} style={{ background: "#faad14" }} />}
                            title={<Space size={6} wrap><Typography.Text strong>{item.code}</Typography.Text><Tag color="gold">{t("admin_inbox.coupon_discount_prefix", { discount: couponDiscountText(item) })}</Tag></Space>}
                            description={
                              <Space size={6} wrap>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox.coupon_min_order_label", { value: item.minOrderAmount ? baht(item.minOrderAmount, t) : t("admin_inbox.coupon_min_order_none") })}</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_inbox.coupon_expires_label", { date: couponExpiresText(item.expiresAt) })}</Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{usageLeft}</Typography.Text>
                              </Space>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </div>
            )}
          </Modal>
          <Modal
            title={t("admin_inbox.product_modal_title")}
            open={productPickerOpen}
            onCancel={() => setProductPickerOpen(false)}
            footer={null}
            width={isMobile ? "100%" : 700}
            style={isMobile ? { top: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <Input.Search
                placeholder={t("admin_inbox.product_search_placeholder")}
                allowClear
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
              {!productItems.length && !productPickerLoading ? (
                <Empty description={t("admin_inbox.no_products_found")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  loading={productPickerLoading}
                  dataSource={productItems}
                  renderItem={(item) => (
                    <List.Item style={{ alignItems: "flex-start" }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile ? "52px minmax(0,1fr)" : "52px minmax(0,1fr) auto",
                          gridTemplateAreas: isMobile ? '"thumb info" "actions actions"' : undefined,
                          gap: isMobile ? 10 : 12,
                          width: "100%",
                          alignItems: isMobile ? "start" : "center",
                        }}
                      >
                        <div style={{ gridArea: isMobile ? "thumb" : undefined, width: 52, height: 52, borderRadius: 10, overflow: "hidden", background: "rgba(var(--app-text-rgb, 15, 23, 42), 0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <ShoppingCartOutlined style={{ color: "rgba(15,23,42,0.35)" }} />
                          )}
                        </div>
                        <div style={{ gridArea: isMobile ? "info" : undefined, minWidth: 0 }}>
                          <Space size={6} wrap>
                            <Typography.Text strong style={{ fontSize: 14 }}>{item.name}</Typography.Text>
                            {!item.active && <Tag style={{ marginInlineEnd: 0 }}>{t("admin_inbox.product_inactive_tag")}</Tag>}
                          </Space>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              SKU: {item.sku} · {Number(item.price).toLocaleString("th-TH")} {t("admin_inbox.baht_suffix")}
                            </Typography.Text>
                          </div>
                          <Space size={6} wrap style={{ marginTop: 6 }}>
                            {(item.variants || []).slice(0, 4).map((variant) => (
                              <Tag key={`${item.sku}-${variant.size}`} color={variant.available > 0 ? "green" : "default"} style={{ marginInlineEnd: 0 }}>
                                {variant.size} · {t("admin_inbox.product_remaining", { n: variant.available })}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                        {isMobile ? (
                          <div style={{ gridArea: "actions", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                            <Button type="primary" disabled={!item.active || !tenantSlug} onClick={() => insertProductIntoChat(item, false)} style={{ gridColumn: "1 / -1" }}>
                              {t("admin_inbox.text_and_link_button")}
                            </Button>
                            <Button disabled={!item.active || !item.imageUrl || !tenantSlug} onClick={() => insertProductIntoChat(item, true)} style={{ gridColumn: "1 / -1" }}>
                              {t("admin_inbox.text_image_link_button")}
                            </Button>
                            {tenantSlug && (
                              <Link href={`/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(item.sku)}`} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                                <Button block style={{ color: "#1677ff", borderColor: "#91caff", background: "#f8fbff" }}>{t("admin_inbox.view_public_page_button")}</Button>
                              </Link>
                            )}
                            <Link href={`/admin/products?search=${encodeURIComponent(item.sku)}`} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                              <Button block style={{ color: "#1677ff", borderColor: "#91caff", background: "#f8fbff" }}>{t("admin_inbox.products_fullscreen_button")}</Button>
                            </Link>
                          </div>
                        ) : (
                          <Space direction="vertical" size={6} style={{ alignItems: "flex-end" }}>
                            <Button type="primary" size="small" disabled={!item.active || !tenantSlug} onClick={() => insertProductIntoChat(item, false)}>{t("admin_inbox.text_and_link_button")}</Button>
                            <Button size="small" disabled={!item.active || !item.imageUrl || !tenantSlug} onClick={() => insertProductIntoChat(item, true)}>
                              {t("admin_inbox.text_image_link_button")}
                            </Button>
                            {tenantSlug && (
                              <Link href={`/shop/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(item.sku)}`} target="_blank" rel="noreferrer">
                                <Button size="small" type="link" style={{ paddingInline: 0 }}>{t("admin_inbox.view_public_page_button")}</Button>
                              </Link>
                            )}
                            <Link href={`/admin/products?search=${encodeURIComponent(item.sku)}`} target="_blank" rel="noreferrer">
                              <Button size="small" type="link" style={{ paddingInline: 0 }}>{t("admin_inbox.products_fullscreen_link_desktop")}</Button>
                            </Link>
                          </Space>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </Modal>
          {draftAttachment && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", marginBottom: 7, border: "1px solid rgba(22,119,255,0.24)", borderRadius: 10, background: "rgba(22,119,255,0.06)" }}>
              {draftAttachment.isImage ? (
                <img src={draftAttachment.url} alt={draftAttachment.name || t("admin_inbox.attached_image_fallback")} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <PaperClipOutlined style={{ fontSize: 20, color: "#1677ff", flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <Typography.Text strong ellipsis style={{ display: "block", fontSize: 12 }}>
                  {draftAttachment.name || (draftAttachment.isImage ? t("admin_inbox.preview_image") : t("admin_inbox.file_attachment_fallback"))}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 10 }}>{t("admin_inbox.waiting_to_send_hint")}</Typography.Text>
              </div>
              <Button type="text" size="small" aria-label={t("admin_inbox.remove_attachment_aria")} icon={<CloseOutlined />} onClick={() => setDraftAttachment(null)} />
            </div>
          )}
          {/* เครื่องมือแนบอยู่แถวเดียวกับช่องพิมพ์ (เดิมเป็นแถวป้ายข้อความแยกด้านบน กินสูง ~34px
              ของพื้นที่สายแชททุกหน้าจอ) — เหลือไอคอนล้วน ความหมายอยู่ใน tooltip/aria-label */}
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
            <Space size={0} style={{ flexShrink: 0 }}>
              <Popover content={emojiPicker} trigger="click" title={t("admin_inbox.emoji_popover_title")}>
                <Button type="text" size="small" aria-label={t("admin_inbox.emoji_aria")} icon={<SmileOutlined />} />
              </Popover>
              <Tooltip title={t("admin_inbox.attach_image_tooltip")}>
                <Button type="text" size="small" aria-label={t("admin_inbox.attach_image_aria")} icon={<PictureOutlined />} disabled={uploading && uploadAction !== "image"} loading={uploading && uploadAction === "image"} onClick={() => imgInputRef.current?.click()} />
              </Tooltip>
              <Tooltip title={t("admin_inbox.attach_file_tooltip")}>
                <Button type="text" size="small" aria-label={t("admin_inbox.attach_file_aria")} icon={<PaperClipOutlined />} disabled={uploading && uploadAction !== "file"} loading={uploading && uploadAction === "file"} onClick={() => fileInputRef.current?.click()} />
              </Tooltip>
              <Tooltip title={t("admin_inbox.insert_product_tooltip")}>
                <Button type="text" size="small" aria-label={t("admin_inbox.insert_product_aria")} icon={<ShoppingCartOutlined />} onClick={() => setProductPickerOpen(true)} />
              </Tooltip>
              <Tooltip title={t("admin_inbox.insert_coupon_tooltip")}>
                <Button type="text" size="small" aria-label={t("admin_inbox.insert_coupon_aria")} icon={<TagsOutlined />} onClick={() => setCouponPickerOpen(true)} />
              </Tooltip>
            </Space>
            <Input.TextArea
              rows={1} value={reply} onChange={(e) => setReply(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 4 }}
              /* มือถือไม่มี Shift+Enter ให้กดอยู่แล้ว placeholder ยาว ๆ เลยได้แค่ตัด 2 บรรทัด —
                 คำอธิบายฉบับเต็มย้ายไป native tooltip (`title`) ของช่องพิมพ์บนเดสก์ท็อป ไม่ได้หายไป
                 และไม่ใช้ antd Tooltip เพราะมันจะเด้งค้างระหว่างพิมพ์ */
              placeholder={isMobile ? t("admin_inbox.composer_placeholder_mobile") : t("admin_inbox.composer_placeholder_desktop")}
              title={isMobile ? undefined : t("admin_inbox.composer_title_desktop")}
              style={{ flex: 1, resize: "none", fontSize: 12, borderRadius: 8, background: PANEL_SUNKEN_SURFACE }}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); submitReply(); } }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={uploading || (!reply.trim() && !draftAttachment)}
              style={{ minWidth: isMobile ? 40 : 60, fontSize: 12, fontWeight: 700, borderRadius: 8 }} onClick={submitReply}>{isMobile ? "" : t("admin_inbox.send_button")}</Button>
          </div>
        </div>
      )}
    </div>
  );

  // "@" ท้ายข้อความ (ก่อนหน้าเป็นช่องว่าง/ต้นบรรทัด) = กำลังพิมพ์ mention — ไม่ parse
  // ทั้งข้อความตอน submit, แค่ใช้ตรงนี้ช่วยกรอง dropdown เฉยๆ (แหล่งความจริงคือ noteMentions)
  const noteMentionCandidates = noteMentionQuery === null ? [] : staffList.filter((s) =>
    (s.name || s.email || "").toLowerCase().includes(noteMentionQuery.toLowerCase())
  );
  const onNoteChange = (value: string) => {
    setNote(value);
    const m = value.match(/(?:^|\s)@([^\s@]*)$/);
    setNoteMentionQuery(m ? m[1] : null);
  };
  const pickNoteMention = (s: StaffRef) => {
    const label = s.name || s.email || "staff";
    const cut = noteMentionQuery === null ? note.length : note.length - (noteMentionQuery.length + 1);
    setNote(note.slice(0, cut) + "@" + label + " ");
    setNoteMentionQuery(null);
    setNoteMentions((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, { id: s.id, name: label }]));
  };
  const submitNote = () => {
    if (!note.trim() || noting) return;   // Enter ยิงได้ทุกจังหวะแล้ว → กันโน้ตว่าง/กดรัวซ้อน mutation
    // ตัด mention ที่ถูกลบ "@ชื่อ" ออกจากข้อความไปแล้วก่อน submit ออก — กันแจ้งเตือนคนที่ถูกลบชื่อทิ้ง
    const mentionedUserIds = noteMentions.filter((m) => note.includes("@" + m.name)).map((m) => m.id);
    addNote({ variables: { id: conv.id, body: note, mentionedUserIds } });
  };
  // Enter = บันทึกโน้ต (ไม่มีปุ่ม "เพิ่ม" แล้ว) — ยกเว้นตอน dropdown เมนชันเปิดอยู่และมีคนให้เลือก
  // ให้ Enter เติมชื่อคนแรกก่อน ไม่งั้นจะเซฟทั้งที่ "@Dett" ยังพิมพ์ไม่จบ = mention ไม่ถูกส่ง
  const onNoteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && noteMentionQuery !== null) { setNoteMentionQuery(null); return; }
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (noteMentionQuery !== null && noteMentionCandidates.length > 0) pickNoteMention(noteMentionCandidates[0]);
    else submitNote();
  };
  const renderNoteBody = (body: string) => {
    if (!staffList.length) return body;
    const names = staffList.map((s) => s.name || s.email).filter(Boolean) as string[];
    if (!names.length) return body;
    const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
    // split() ด้วย regex ที่มี capturing group จะคืน [text, match, text, match, ...] —
    // index คี่ = ส่วนที่ match เสมอ ใช้เช็คแทน re.test() (regex /g ตัวเดียวกัน .test() ซ้ำ
    // จะเลื่อน lastIndex ทำให้ผลสลับถูกๆ ผิดๆ)
    return body.split(re).map((part, i) =>
      i % 2 === 1 ? <Typography.Text key={i} strong style={{ color: "#1677ff" }}>{part}</Typography.Text> : part
    );
  };

  const notesTab = (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {canManage && (
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Input
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onKeyDown={onNoteKeyDown}
            disabled={noting}
            placeholder={t("admin_inbox.note_placeholder")}
          />
          {noteMentionQuery !== null && (
            // เดิม gate ด้วย noteMentionCandidates.length > 0 — ถ้าร้านมี staff ให้เมนชันได้ 0 คน
            // (เช่น admin คนเดียว ไม่มี Sales/Manager คนอื่น) กด @ แล้วไม่มีอะไรเกิดขึ้นเลย ไม่รู้ว่า
            // "ไม่มีให้เลือก" หรือ "ปุ่มพัง" — ใส่ empty state ให้เห็นชัดแทนความเงียบ
            <List size="small" bordered
              style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: PANEL_SURFACE, border: "1px solid var(--app-border, rgba(15,23,42,0.12))", borderRadius: 12, boxShadow: RAISED_PANEL_SHADOW, maxHeight: 180, overflowY: "auto" }}
              dataSource={noteMentionCandidates}
              locale={{ emptyText: <div style={{ padding: "6px 8px", fontSize: 12, color: "#999" }}>{t("admin_inbox.no_mention_candidates")}</div> }}
              renderItem={(s) => (
                <List.Item style={{ cursor: "pointer", padding: "4px 8px" }} onClick={() => pickNoteMention(s)}>
                  {staffLabel(s, t)}
                </List.Item>
              )} />
          )}
        </div>
      )}
      <List size="small" dataSource={conv.notes || []} locale={{ emptyText: t("admin_inbox.no_notes_yet") }}
        renderItem={(n: Note) => (
          <List.Item>
            <List.Item.Meta title={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{n.author} · {dayLabel(n.createdAt, t)} {timeLabel(n.createdAt)}</Typography.Text>} description={renderNoteBody(n.body)} />
          </List.Item>
        )} />
    </div>
  );

  const customerTab = (
    <div>
      {!canViewCustomer && <Empty description={t("admin_inbox.no_view_customer_permission")} />}
      {canViewCustomer && !conv.customerId && <Empty description={t("admin_inbox.customer_not_linked")} />}
      {canViewCustomer && conv.customerId && custLoading && !custData && <Typography.Text type="secondary">{t("admin_inbox.loading_label")}</Typography.Text>}
      {canViewCustomer && custData?.bmsCustomer && (
        <div>
          <Space size="large" wrap style={{ marginBottom: 12 }}>
            <Statistic title={t("admin_inbox.lifetime_value_stat")} value={custData.bmsCustomer.total_spent} suffix="฿" precision={0} />
            <Statistic title={t("admin_inbox.order_count_stat")} value={custData.bmsCustomer.order_count} />
          </Space>
          {(custData.bmsCustomer.tags || []).length > 0 && (
            <Space wrap style={{ marginBottom: 8 }}>
              {custData.bmsCustomer.tags.map((tag: string) => <Tag key={tag} color="gold">{tag}</Tag>)}
            </Space>
          )}
          {custData.bmsCustomer.note && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
              📝 {custData.bmsCustomer.note}
            </Typography.Paragraph>
          )}
          <Divider style={{ margin: "8px 0" }} />
          <Typography.Text strong style={{ fontSize: 12.5 }}>{t("admin_inbox.purchase_history_heading")}</Typography.Text>
          <List
            size="small"
            dataSource={custData.bmsCustomer.orders || []}
            locale={{ emptyText: t("admin_inbox.no_orders_yet") }}
            renderItem={(o: any) => (
              <List.Item
                actions={canReorder ? [
                  <Button
                    key="reorder" type="link" size="small"
                    loading={reorderingId === o.id}
                    onClick={() => { setReorderingId(o.id); reorder({ variables: { id: o.id } }); }}
                  >{t("admin_inbox.reorder_button")}</Button>,
                ] : undefined}
              >
                <List.Item.Meta
                  title={
                    <Space size={4}>
                      <Tag color={CHANNEL_COLOR[o.channel] || "default"}>{o.channel}</Tag>
                      <Tag>{o.status}</Tag>
                      <span>{Number(o.total_amount).toLocaleString()} ฿</span>
                    </Space>
                  }
                  description={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleString()}</Typography.Text>}
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  );

  const timelineTab = (() => {
    const allRows: any[] = tlData?.bmsConversationTimeline || [];
    const isCrossChannel = (row: any) => row.type === "ORDER" && !!row.channel && row.channel !== conv.channel;
    // "แชทนี้เท่านั้น" = ซ่อนออร์เดอร์ช่องทางอื่น (ออร์เดอร์ scope ตามลูกค้า ไม่ใช่ตามแชท)
    const rows = tlThisChatOnly ? allRows.filter((row) => !isCrossChannel(row)) : allRows;

    return (
      <div style={{ height: "100%", overflowY: "auto", paddingInlineEnd: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {conv.customerName || conv.customerRef} · {conv.channel}
          </Typography.Text>
          <Segmented
            size="small"
            value={tlThisChatOnly ? "chat" : "all"}
            onChange={(v) => setTlThisChatOnly(v === "chat")}
            options={[{ label: t("admin_inbox.timeline_all_events"), value: "all" }, { label: t("admin_inbox.timeline_this_chat_only"), value: "chat" }]}
          />
        </div>

        {!tlData && (
          <Button size="small" onClick={() => loadTimeline({ variables: { id: conv.id } })} loading={tlLoading}>
            {t("admin_inbox.load_timeline_button")}
          </Button>
        )}
        {tlData && rows.length === 0 && <Empty description={t("admin_inbox.no_events")} image={Empty.PRESENTED_IMAGE_SIMPLE} />}

        {rows.map((row, index) => {
          const showDay = index === 0 || dayKey(rows[index - 1].at) !== dayKey(row.at);
          const meta = timelineTypeMeta(row.type, t);
          const isOrder = row.type === "ORDER";
          const crossChannel = isCrossChannel(row);
          const dot = (isOrder ? ORDER_STATUS_DOT[row.status ?? ""] : TIMELINE_DOT[row.type]) || "#B4B2A9";
          return (
            <div key={`${row.type}-${row.at}-${row.ref ?? index}`}>
              {showDay && (
                <div style={{ textAlign: "center", margin: "10px 0 8px" }}>
                  <Typography.Text type="secondary" style={{ fontSize: 11.5, background: "rgba(0,0,0,0.04)", padding: "2px 10px", borderRadius: 10 }}>
                    {dayLabel(row.at, t)}
                  </Typography.Text>
                </div>
              )}
              <div style={{ position: "relative", borderInlineStart: "1px solid rgba(0,0,0,0.08)", marginInlineStart: 5, paddingInlineStart: 14, paddingBottom: 12 }}>
                <span style={{ position: "absolute", inlineSize: 9, blockSize: 9, borderRadius: "50%", background: dot, insetInlineStart: -5, insetBlockStart: 5 }} />
                <Space size={4} wrap style={{ lineHeight: 1.4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{timeLabel(row.at)}</Typography.Text>
                  <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
                  {isOrder && row.channel && (
                    <Tag color={crossChannel ? CHANNEL_COLOR[row.channel] || "default" : "default"} style={{ marginInlineEnd: 0 }}>
                      {row.channel}{crossChannel ? t("admin_inbox.cross_channel_suffix") : ""}
                    </Tag>
                  )}
                  {!isOrder && row.ref && <Typography.Text type="secondary" style={{ fontSize: 12 }}>· {row.ref}</Typography.Text>}
                </Space>
                <div style={{ fontSize: 12.5, marginTop: 3 }}>
                  {isOrder ? (
                    <Space size={6} wrap>
                      <Typography.Text code copyable={{ text: row.entityId || row.ref }} style={{ fontSize: 11.5 }}>{row.ref}</Typography.Text>
                      <span>{row.text}</span>
                      {row.status && (
                        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                          {t("admin_inbox.status_now_label")} <Typography.Text style={{ fontSize: 11.5 }}>{row.status}</Typography.Text>
                          {row.statusAt ? ` · ${dayLabel(row.statusAt, t)} ${timeLabel(row.statusAt)}` : ""}
                        </Typography.Text>
                      )}
                    </Space>
                  ) : (
                    <span>{row.text}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {tlData && rows.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
              {t("admin_inbox.showing_events_count", { n: rows.length.toLocaleString("th-TH") })}
              {tlThisChatOnly && allRows.length !== rows.length ? t("admin_inbox.hidden_other_channel_count", { n: (allRows.length - rows.length).toLocaleString("th-TH") }) : ""}
              {rows.length >= TIMELINE_MAX_PER_SOURCE ? t("admin_inbox.reached_display_cap") : ""}
            </Typography.Text>
            <Button size="small" onClick={() => loadTimeline({ variables: { id: conv.id } })} loading={tlLoading}>
              {t("admin_inbox.refresh_timeline_button")}
            </Button>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {header}
      <Divider style={{ margin: isMobile ? "4px 0 6px" : "6px 0 8px" }} />
      <Tabs
        size="small"
        className="bms-inbox-tabs-fill"
        tabBarGutter={isMobile ? 18 : undefined}
        activeKey={activeTabKey}
        onChange={setActiveTabKey}
        items={[
          { key: "chat", label: t("admin_inbox.tab_chat"), children: chatTab },
          { key: "customer", label: t("admin_inbox.tab_customer"), children: customerTab },
          { key: "notes", label: t("admin_inbox.tab_notes"), children: notesTab },
          { key: "timeline", label: t("admin_inbox.tab_timeline"), children: timelineTab },
        ]}
      />
      {/* Lightbox โปร่งแสง — พื้นหลังเป็น scrim เข้ม+เบลอ (เห็นสายแชทเลือน ๆ อยู่ข้างหลัง) แทนการ์ดขาว
          ทึบเต็มพื้นที่เดิม · closable=false + ปุ่ม ✕ ของเราเองปุ่มเดียว (native close ของ antd ซ้ำกับ
          ปุ่มปิดเดิม) · ปุ่มก่อนหน้า/ถัดไปลอยข้างรูปเสมอทุกขนาดจอ (เดิมมีแค่ isMobile ซ้อนอีกชุด) ·
          ไม่มี caption/thumbnail แล้ว เหลือผู้ส่ง/เวลาเป็น chip เล็กลอยมุมล่างของรูปพอ */}
      <Modal
        open={imagePreviewIndex != null}
        onCancel={() => setImagePreviewIndex(null)}
        footer={null}
        closable={false}
        width={isMobile ? "100%" : "min(92vw, 1080px)"}
        style={isMobile ? { top: 0, maxWidth: "100vw", paddingBottom: 0 } : undefined}
        centered={!isMobile}
        styles={{
          content: {
            padding: 0,
            borderRadius: isMobile ? 0 : 20,
            overflow: "hidden",
            background: "rgba(8,13,24,0.72)",
            backdropFilter: "blur(6px)",
          },
          body: { padding: 0 },
        }}
      >
        {imagePreviewIndex != null && chatImages[imagePreviewIndex] && (
          <div style={{ display: "flex", flexDirection: "column", minHeight: isMobile ? "80vh" : "70vh" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: isMobile ? "10px 12px" : "12px 16px", flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.14)", borderRadius: 999, padding: "4px 11px" }}>
                {imagePreviewIndex + 1} / {chatImages.length}
              </span>
              <Space size={6}>
                <Tooltip title={t("admin_inbox.open_file_new_tab_tooltip")}>
                  <Button
                    shape="circle" size={isMobile ? "small" : "middle"} icon={<DownloadOutlined />}
                    href={chatImages[imagePreviewIndex].url} target="_blank" aria-label={t("admin_inbox.open_file_aria")}
                    style={{ background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.22)", color: "#fff" }}
                  />
                </Tooltip>
                <Button
                  shape="circle" size={isMobile ? "small" : "middle"} icon={<CloseOutlined />}
                  onClick={() => setImagePreviewIndex(null)} aria-label={t("admin_inbox.close_aria")}
                  style={{ background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.22)", color: "#fff" }}
                />
              </Space>
            </div>

            <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "0 44px 16px" : "0 64px 20px" }}>
              <Button
                shape="circle" icon={<LeftOutlined />} onClick={() => movePreview(-1)} aria-label={t("admin_inbox.prev_image_aria")}
                style={{
                  position: "absolute", left: isMobile ? 6 : 16, top: "50%", transform: "translateY(-50%)",
                  width: isMobile ? 32 : 40, height: isMobile ? 32 : 40,
                  background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.22)", color: "#fff",
                }}
              />
              <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", display: "inline-flex" }}>
                <img
                  src={chatImages[imagePreviewIndex].url}
                  alt={chatImages[imagePreviewIndex].name}
                  style={{ maxWidth: "100%", maxHeight: isMobile ? "56vh" : "64vh", borderRadius: 8, boxShadow: "0 20px 50px rgba(0,0,0,0.4)", display: "block" }}
                />
                <div style={{
                  position: "absolute", insetInlineStart: 10, insetBlockEnd: 10,
                  fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.9)",
                  background: "rgba(8,13,24,0.55)", backdropFilter: "blur(6px)", borderRadius: 999, padding: "4px 10px",
                }}>
                  {chatImages[imagePreviewIndex].sender} · {timeLabel(chatImages[imagePreviewIndex].createdAt)}
                </div>
              </div>
              <Button
                shape="circle" icon={<RightOutlined />} onClick={() => movePreview(1)} aria-label={t("admin_inbox.next_image_aria")}
                style={{
                  position: "absolute", right: isMobile ? 6 : 16, top: "50%", transform: "translateY(-50%)",
                  width: isMobile ? 32 : 40, height: isMobile ? 32 : 40,
                  background: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.22)", color: "#fff",
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return <Inbox />;
}
