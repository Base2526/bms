'use client';
import { gql, useApolloClient, useQuery, useLazyQuery, useMutation, useSubscription } from "@apollo/client";
import {
  List, Input, Button, Space, Tag, Segmented, message, Alert, Badge,
  Typography, Avatar, Select, Tabs, Empty, Divider, Popover, Tooltip, Switch, Statistic, Modal,
} from "antd";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ReloadOutlined, SendOutlined, UserOutlined,
  SmileOutlined, PictureOutlined, PaperClipOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, CloseOutlined,
  UserSwitchOutlined, UsergroupAddOutlined, UsergroupDeleteOutlined, CheckCircleOutlined,
  FireOutlined, ClockCircleOutlined, ShoppingCartOutlined, CreditCardOutlined,
  TruckOutlined, ThunderboltOutlined, TagsOutlined,
  LeftOutlined, RightOutlined, DownloadOutlined,
  EyeOutlined, EyeInvisibleOutlined, UpOutlined, DownOutlined,
} from "@ant-design/icons";

const EMOJIS = ["😊","😀","😂","🙏","👍","🙂","😅","😍","🥰","😘","😉","😎","🤔","😢","😭","😡","🎉","✨","🔥","💯","❤️","💙","💚","👏","🙌","🛒","📦","🚚","💰","✅","❌","⭐","📌","🏷️","🎁","👌"];
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import Customer360Panel from "./Customer360Panel";

// ---- Types --------------------------------------------------
type ConvStatus = "OPEN" | "PENDING" | "CLOSED";
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
type Note = { id: string; author: string | null; body: string; createdAt: string };
type SystemEvent = {
  id: string; kind: "assign" | "helper_add" | "helper_remove" | "status";
  at: string; actorName: string; targetName: string | null; statusValue: string | null; auto: boolean;
};

// ---- GraphQL ------------------------------------------------
const STAFF_FIELDS = `id name email avatar role isAvailable openCount`;
const Q_LIST = gql`
  query ($status: BmsConvStatus, $search: String, $assignedTo: ID) {
    bmsConversations(status: $status, search: $search, assignedTo: $assignedTo, limit: 100) {
      id channel customerRef customerName customerAvatar sourceDisplayName sourceHandle sourceAvatar status tags unread lastMessage lastMessageAt
      assignedStaff { id name avatar }
    }
  }
`;
const Q_CONV = gql`
  query ($id: ID!) {
    bmsConversation(id: $id) {
      id channel customerRef customerId customerName customerAvatar sourceDisplayName sourceHandle sourceAvatar status tags unread lastMessageAt createdAt
      assignedStaff { ${STAFF_FIELDS} }
      helpers { ${STAFF_FIELDS} }
      messages { id direction body sender createdAt attachment { url name mimeType isImage } status canReportDelivery }
      systemEvents { id kind at actorName targetName statusValue auto }
      notes { id author body createdAt }
    }
  }
`;
const S_INBOX_CHANGED = gql`
  subscription {
    bmsInboxChanged { conversationId kind occurredAt }
  }
`;
const Q_STAFF = gql`query { bmsAssignableStaff { ${STAFF_FIELDS} } }`;
const Q_ME = gql`query { bmsMe { id role is_available gender } }`;
const Q_TIMELINE = gql`query ($id: ID!) { bmsConversationTimeline(id: $id) { type at text ref } }`;
const Q_CUSTOMER = gql`
  query ($id: ID!) {
    bmsCustomer(id: $id) {
      id name phone note tags total_spent order_count
      orders { id channel status total_amount created_at }
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
const M_NOTE = gql`mutation ($id: ID!, $body: String!) { bmsAddConversationNote(id: $id, body: $body) { id author body createdAt } }`;
const M_REORDER = gql`mutation ($id: ID!) { bmsReorderFromOrder(id: $id) { status orderId total message } }`;

function staffLabel(s: StaffRef) {
  const busy = typeof s.openCount === "number" ? ` · ${s.openCount} แชท` : "";
  return `${s.name || s.email || s.id}${s.role ? ` (${s.role})` : ""}${busy}`;
}

// ---- วันที่/เวลา + system event (ยึด timezone Asia/Bangkok ให้ตรงกันทุกเครื่อง) ----
const BKK = "Asia/Bangkok";
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BKK, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: BKK, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
function dayLabel(iso: string) {
  const key = dayKey(iso);
  const now = new Date();
  const todayKey = dayKey(now.toISOString());
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === todayKey) return "วันนี้";
  if (key === dayKey(y.toISOString())) return "เมื่อวาน";
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
function eventText(ev: SystemEvent) {
  switch (ev.kind) {
    case "assign": return ev.auto
      ? `ระบบกำหนดผู้รับผิดชอบหลักเป็น ${ev.targetName} (อัตโนมัติ)`
      : `${ev.actorName} เปลี่ยนผู้รับผิดชอบหลักเป็น ${ev.targetName}`;
    case "helper_add": return `${ev.actorName} เพิ่ม ${ev.targetName} เป็นผู้ช่วยตอบ`;
    case "helper_remove": return `${ev.actorName} ถอด ${ev.targetName} ออกจากผู้ช่วยตอบ`;
    case "status": return `${ev.actorName} เปลี่ยนสถานะเป็น ${ev.statusValue}`;
  }
}

const CHANNEL_COLOR: Record<string, string> = { line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", shopee: "orange", lazada: "purple", test: "default" };
const STATUS_COLOR: Record<ConvStatus, string> = { OPEN: "green", PENDING: "orange", CLOSED: "default" };
const FILTERS = ["ALL", "OPEN", "PENDING", "CLOSED"] as const;
const LIST_COLLAPSE_KEY = "bms_inbox_list_collapsed";
const CHAT_HEADER_MODE_KEY = "bms_inbox_chat_header_mode";
const AI_SUGGESTION_VISIBILITY_KEY = "bms_inbox_ai_suggestion_visibility";
const CHAT_BOTTOM_THRESHOLD_PX = 120;
const MOBILE_QUERY = "(max-width: 767px)";
const TABLET_QUERY = "(min-width: 768px) and (max-width: 1180px)";

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
function previewNode(last?: string | null) {
  if (!last) return "—";
  if (last.startsWith("[รูปภาพ]")) return <><PictureOutlined /> รูปภาพ</>;
  if (last.startsWith("[ไฟล์]")) return <><PaperClipOutlined /> {last.replace("[ไฟล์]", "").trim() || "ไฟล์แนบ"}</>;
  return last;
}

function sourceLabel(c: { channel?: string | null; sourceDisplayName?: string | null; sourceHandle?: string | null }) {
  if (!c.sourceDisplayName && !c.sourceHandle) return null;
  const name = c.sourceDisplayName || c.sourceHandle || "";
  const handle = c.sourceHandle && c.sourceHandle !== name ? ` ${c.sourceHandle}` : "";
  const prefix = c.channel === "line" ? "LINE OA" : c.channel || "ช่องทาง";
  return `${prefix} “${name}”${handle}`;
}

function convPriority(c: Conversation) {
  const text = `${c.lastMessage || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
  if (c.unread > 0) return { label: "ต้องตอบ", color: "red", icon: <FireOutlined /> };
  if (/สลิป|โอน|paid|payment|ชำระ/.test(text)) return { label: "มีสลิป", color: "blue", icon: <CreditCardOutlined /> };
  if (/ส่ง|พัสดุ|tracking|จัดส่ง/.test(text) || c.status === "PENDING") return { label: "รอจัดส่ง", color: "purple", icon: <TruckOutlined /> };
  if (/ราคา|ไซซ์|size|มีไหม|stock|สต็อก/.test(text)) return { label: "ขายต่อ", color: "green", icon: <ShoppingCartOutlined /> };
  return { label: "ปกติ", color: "default", icon: <ClockCircleOutlined /> };
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

function nextAction(conv: any) {
  const text = String(conv?.messages?.[conv.messages.length - 1]?.body || "").toLowerCase();
  if (/สลิป|โอน|ชำระ|payment|paid/.test(text)) return { label: "ขั้นต่อไป", value: "ยืนยันสลิป", icon: <CreditCardOutlined />, color: "#1677ff" };
  if (/เลขพัสดุ|tracking|ส่งของ|จัดส่ง/.test(text) || conv?.status === "PENDING") return { label: "ขั้นต่อไป", value: "ออกเลขพัสดุ", icon: <TruckOutlined />, color: "#722ed1" };
  if (/มีไหม|ไซซ์|size|stock|สต็อก|ราคา/.test(text)) return { label: "ขั้นต่อไป", value: "เช็กสต็อก", icon: <ShoppingCartOutlined />, color: "#389e0d" };
  return { label: "ขั้นต่อไป", value: "ตอบลูกค้า", icon: <SendOutlined />, color: "#d48806" };
}

function Inbox() {
  const apollo = useApolloClient();
  const { can } = useBmsPermissions();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isTablet = useMediaQuery(TABLET_QUERY);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("OPEN");
  const [search, setSearch] = useState("");
  // deep-link จากหน้า Orders: /admin/inbox?c=<conversationId> → เปิดแชทนั้นทันที
  // อ่านตอน mount (hard load) + useEffect กันเคส SPA client-nav ที่ URL อัปเดตหลัง render แรก
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("c");
  });
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setActiveId(c);
  }, []);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("c") ? "chat" : "list";
  });
  const [mineOnly, setMineOnly] = useState(false);

  const { data: meData } = useQuery(Q_ME, { fetchPolicy: "cache-and-network" });
  const me = meData?.bmsMe;
  // Sales เห็นเฉพาะแชทของตัวเองเสมอ (บังคับที่ backend อยู่แล้ว — ฝั่งนี้แค่ปรับ UI ให้ตรงกัน)
  const restrictedToOwn = me?.role === "Sales";
  const [setAvailability, { loading: settingAvail }] = useMutation(M_AVAILABILITY, {
    onError: (e) => message.error(e.message || "ตั้งค่าไม่สำเร็จ"),
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

  const { data, loading, refetch } = useQuery(Q_LIST, {
    variables: { status: filter === "ALL" ? null : filter, search: search || null, assignedTo: (mineOnly || restrictedToOwn) ? me?.id ?? null : null },
    fetchPolicy: "cache-and-network",
    pollInterval: 20000,
    skip: (mineOnly || restrictedToOwn) && !me?.id, // กันยิงก่อนรู้ id ตัวเอง (จะได้ทั้งหมดโดยไม่ตั้งใจ)
  });
  const conversations: Conversation[] = data?.bmsConversations || [];
  const needReplyCount = conversations.filter((c) => c.unread > 0).length;
  const pendingCount = conversations.filter((c) => c.status === "PENDING").length;
  const effectiveListCollapsed = !isMobile && (listCollapsed || isTablet);
  const showListPane = !isMobile || mobilePane === "list";
  const showConversationPane = !isMobile || mobilePane === "chat";

  const [loadConv, { data: convData, refetch: refetchConv }] = useLazyQuery(Q_CONV, { fetchPolicy: "cache-and-network" });
  const conv = convData?.bmsConversation;
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
      variables: {
        status: filter === "ALL" ? null : filter,
        search: search || null,
        assignedTo: (mineOnly || restrictedToOwn) ? me?.id ?? null : null,
      },
    });
    if (list?.bmsConversations) {
      apollo.cache.writeQuery({
        query: Q_LIST,
        variables: {
          status: filter === "ALL" ? null : filter,
          search: search || null,
          assignedTo: (mineOnly || restrictedToOwn) ? me?.id ?? null : null,
        },
        data: {
          bmsConversations: list.bmsConversations.map((c: Conversation) =>
            c.id === conversationId ? { ...c, unread: 0 } : c
          ),
        },
      });
    }

    const detail = apollo.cache.readQuery<any>({
      query: Q_CONV,
      variables: { id: conversationId },
    });
    if (detail?.bmsConversation) {
      apollo.cache.writeQuery({
        query: Q_CONV,
        variables: { id: conversationId },
        data: { bmsConversation: { ...detail.bmsConversation, unread: 0 } },
      });
    }
  }, [apollo, filter, search, mineOnly, restrictedToOwn, me?.id]);

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
          void refetchConv({ id: event.conversationId });
        }
      }, 150);
    }
  }, [inboxChangedData, refetchConv, triggerListRefresh, markActiveConversationRead]);

  useEffect(() => () => {
    if (listRefreshState.current.timer) clearTimeout(listRefreshState.current.timer);
    listRefreshState.current.timer = null;
    listRefreshState.current.pending = false;
    if (convRefreshTimer.current) clearTimeout(convRefreshTimer.current);
  }, []);

  useEffect(() => {
    if (activeId) {
      loadConv({ variables: { id: activeId } });
      void markActiveConversationRead(activeId);
    }
  }, [activeId]); // eslint-disable-line

  // If the socket misses an event, the existing 20s list poll detects a newer
  // message and refreshes only the active pane instead of polling every pane.
  const activeListConversation = conversations.find((c) => c.id === activeId);
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
          void refetchConv({ id: activeId });
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

  const openConversation = (conversationId: string) => {
    setActiveId(conversationId);
    if (isMobile) setMobilePane("chat");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: isMobile ? "calc(100dvh - 48px)" : "calc(100vh - 48px)", minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
      {(!isMobile || mobilePane === "list") && (
      <div style={{ marginBottom: isMobile ? 8 : 10, flexShrink: 0 }}>
        <Space style={{ width: "100%", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center" }} wrap>
          <Space direction="vertical" size={0}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 22 : undefined, lineHeight: 1.15 }}>BMS Inbox (Omnichannel)</h2>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ตอบลูกค้า · เช็กสต็อก · ยืนยันสลิป · ส่งต่อจัดส่ง ในหน้าจอเดียว
            </Typography.Text>
          </Space>
          <Space wrap size={isMobile ? 8 : undefined}>
            {me && (
              <Tooltip title="ปิดไว้ = จะไม่ถูก auto-assign แชทใหม่เข้ามาให้ (แชทที่ถืออยู่แล้วไม่กระทบ)">
                <Space size={6}>
                  <Switch size="small" checked={me.is_available} loading={settingAvail}
                    onChange={(v) => setAvailability({ variables: { available: v } })} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>พร้อมรับแชทใหม่</Typography.Text>
                </Space>
              </Tooltip>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => { refetch(); if (activeId) refetchConv(); }} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>
      )}

      <div style={{ display: "flex", gap: isMobile ? 0 : 12, alignItems: "stretch", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        {/* ---- left: conversation list ---- */}
        {showListPane && (
        <div style={{ width: isMobile ? "100%" : effectiveListCollapsed ? 72 : 320, flexShrink: 0, minHeight: 0, minWidth: 0, border: "1px solid var(--app-border, #eee)", borderRadius: isMobile ? 12 : 14, padding: effectiveListCollapsed ? "10px 6px" : isMobile ? 10 : 12, display: "flex", flexDirection: "column", background: "var(--app-card, transparent)", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: effectiveListCollapsed ? "center" : "space-between", alignItems: "center", marginBottom: 8 }}>
            {!effectiveListCollapsed && (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>คิวแชท</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {needReplyCount} ต้องตอบ · {pendingCount} รอจัดส่ง
                </Typography.Text>
              </Space>
            )}
            {!isMobile && (
            <Tooltip title={effectiveListCollapsed ? "ขยาย list" : "ย่อ list"}>
              <Button type="text" size="small"
                icon={effectiveListCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleListCollapsed} />
            </Tooltip>
            )}
          </div>
          {!effectiveListCollapsed && (
            <>
              <Segmented block size="small" options={FILTERS as unknown as string[]} value={filter} onChange={(v) => setFilter(v as any)} style={{ marginBottom: 8 }} />
              <Input.Search size="middle" placeholder="ค้นหาชื่อ/ข้อความ/ref" allowClear onSearch={setSearch} style={{ marginBottom: 8 }} />
              <Space size={6} style={{ marginBottom: 8 }}>
                {restrictedToOwn ? (
                  <Tooltip title="role Sales เห็นเฉพาะแชทของตัวเองเสมอ">
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>แสดงเฉพาะแชทของฉัน (บังคับ)</Typography.Text>
                  </Tooltip>
                ) : (
                  <>
                    <Switch size="small" checked={mineOnly} onChange={setMineOnly} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>ของฉันเท่านั้น</Typography.Text>
                  </>
                )}
              </Space>
            </>
          )}
          {/* paddingRight กันไม่ให้ scrollbar ทับ badge ตอนย่อ (คอลัมน์แคบ) */}
          {!effectiveListCollapsed && (
            <Space wrap size={6} style={{ marginBottom: 8 }}>
              <Tag color="red" icon={<FireOutlined />}>ด่วนก่อน</Tag>
              <Tag color="blue" icon={<CreditCardOutlined />}>มีสลิป</Tag>
              <Tag color="green" icon={<ShoppingCartOutlined />}>ถามสินค้า</Tag>
            </Space>
          )}
          <div
            className="bms-inbox-conversation-scroll"
            style={{ overflowY: "auto", overflowX: "hidden", flex: 1, minHeight: 0, minWidth: 0, paddingRight: effectiveListCollapsed ? 8 : 0 }}
          >
            <List
              loading={loading} dataSource={conversations}
              locale={{ emptyText: effectiveListCollapsed ? null : <Empty description="ไม่มีบทสนทนา" /> }}
              renderItem={(c) => (
                <List.Item
                  onClick={() => openConversation(c.id)}
                  style={{
                    cursor: "pointer", padding: effectiveListCollapsed ? "6px 0" : isMobile ? "8px 10px" : "10px 12px", borderRadius: isMobile ? 12 : 16, marginBottom: 8,
                    display: effectiveListCollapsed ? "flex" : undefined,
                    justifyContent: effectiveListCollapsed ? "center" : undefined,
                    background: activeId === c.id ? "rgba(22,119,255,0.18)" : "#fff",
                    borderLeft: activeId === c.id ? "3px solid #1677ff" : "3px solid transparent",
                    border: activeId === c.id ? "1px solid rgba(22,119,255,0.28)" : "1px solid rgba(15,23,42,0.06)",
                    boxShadow: activeId === c.id ? "0 8px 24px rgba(22,119,255,0.10)" : "0 2px 10px rgba(15,23,42,0.04)",
                  }}
                >
                  {effectiveListCollapsed ? (
                    <Tooltip placement="right" title={`${c.channel} · ${c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}`}>
                      <Badge count={c.unread} size="small"><Avatar size={28} src={c.customerAvatar || undefined} icon={<UserOutlined />} /></Badge>
                    </Tooltip>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "38px minmax(0, 1fr)", columnGap: 10, width: "100%", minWidth: 0, alignItems: "start" }}>
                      <Badge count={c.unread} size="small" offset={[-2, 2]}>
                        <Avatar size={36} src={c.customerAvatar || undefined} icon={<UserOutlined />} />
                      </Badge>
                      <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <Tag color={CHANNEL_COLOR[c.channel] || "default"} style={{ marginInlineEnd: 0, fontWeight: 500, paddingInline: 7, lineHeight: "20px" }}>{c.channel}</Tag>
                          <Typography.Text strong ellipsis style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
                            {c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}
                          </Typography.Text>
                          {c.assignedStaff && (
                            <Tooltip title={`staff หลัก: ${c.assignedStaff.name || c.assignedStaff.id}`}>
                              <Avatar size={22} src={c.assignedStaff.avatar || undefined} style={{ fontSize: 10, backgroundColor: "#1677ff", flexShrink: 0 }}>
                                {(c.assignedStaff.name || "?").slice(0, 1).toUpperCase()}
                              </Avatar>
                            </Tooltip>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <Typography.Text type="secondary" ellipsis style={{ minWidth: 0, flex: 1, fontSize: 11, lineHeight: 1.25 }}>
                            {sourceLabel(c) ? `ร้าน: ${sourceLabel(c)}` : c.customerRef || c.id}
                          </Typography.Text>
                          <Tag color={convPriority(c).color} icon={convPriority(c).icon} style={{ marginInlineEnd: 0, borderRadius: 999, fontWeight: 500, fontSize: 11, lineHeight: "20px", paddingInline: 7 }}>
                            {convPriority(c).label}
                          </Tag>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <Typography.Text ellipsis style={{ minWidth: 0, flex: 1, fontSize: 12, lineHeight: 1.35 }} type="secondary">
                            {previewNode(c.lastMessage)}
                          </Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                            {c.lastMessageAt ? `${dayLabel(c.lastMessageAt)} · ${timeLabel(c.lastMessageAt)}` : "ยังไม่มีเวลา"}
                          </Typography.Text>
                        </div>
                      </div>
                    </div>
                  )}
                </List.Item>
              )}
            />
          </div>
        </div>
        )}

        {/* ---- middle: active conversation ---- */}
        {showConversationPane && (
        <div style={{ flex: "1 1 0", width: isMobile ? "100%" : undefined, minWidth: 0, minHeight: 0, overflow: "hidden", border: "1px solid var(--app-border, #eee)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? 8 : 14, background: "var(--app-card, transparent)" }}>
          {!conv ? (
            <Empty description="เลือกบทสนทนาทางซ้าย" style={{ marginTop: 120 }} />
          ) : (
            <ConversationPane key={conv.id} conv={conv} can={can} isMobile={isMobile} onBack={isMobile ? () => setMobilePane("list") : undefined}
              gender={me?.gender} onChanged={() => { refetchConv(); refetch(); }} />
          )}
        </div>
        )}

        {/* ---- right: Customer 360 panel ---- */}
        {conv && !isMobile && !isTablet && <Customer360Panel conv={conv} can={can} />}
      </div>
    </div>
  );
}

function ConversationPane({ conv, can, onChanged, isMobile = false, onBack, gender }: { conv: any; can: (p: string) => boolean; onChanged: () => void; isMobile?: boolean; onBack?: () => void; gender?: string | null }) {
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>(conv.tags || []);
  const [headerMode, setHeaderMode] = useState<"chat" | "details">("chat");
  const [showHelperTags, setShowHelperTags] = useState(false);
  const [showAiSuggestion, setShowAiSuggestion] = useState(true);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const isChatPinnedRef = useRef(true);
  const lastRenderedMessageIdRef = useRef<string | null>(null);
  const forceBottomRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่ได้");

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
      if (r?.status === "SENT") { message.success(r.message); setReply(""); onChanged(); }
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
  const [saveTags] = useMutation(M_TAGS, { onCompleted: () => { message.success("บันทึกแท็กแล้ว"); onChanged(); }, onError: onErr });
  const [addNote, { loading: noting }] = useMutation(M_NOTE, {
    onCompleted: () => { message.success("เพิ่มโน้ตแล้ว"); setNote(""); onChanged(); }, onError: onErr,
  });
  const [loadTimeline, { data: tlData, loading: tlLoading }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });
  const { data: staffData } = useQuery(Q_STAFF, { fetchPolicy: "cache-and-network" });
  const staffList: StaffRef[] = staffData?.bmsAssignableStaff || [];
  const [loadCustomer, { data: custData, loading: custLoading, refetch: refetchCustomer }] = useLazyQuery(Q_CUSTOMER, { fetchPolicy: "cache-and-network" });
  const canViewCustomer = can("customer.view");
  const canReorder = can("order.create");
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reorder] = useMutation(M_REORDER, {
    onCompleted: (d: any) => {
      const r = d?.bmsReorderFromOrder;
      setReorderingId(null);
      if (r?.status === "CREATED") { message.success(r.message); refetchCustomer(); }
      else message.error(r?.message || "ซื้อซ้ำไม่สำเร็จ");
    },
    onError: (e) => { setReorderingId(null); onErr(e); },
  });

  useEffect(() => {
    if (canViewCustomer && conv.customerId) loadCustomer({ variables: { id: conv.customerId } });
  }, [conv.customerId, canViewCustomer]); // eslint-disable-line

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(CHAT_HEADER_MODE_KEY);
    setHeaderMode(saved === "details" ? "details" : "chat");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(AI_SUGGESTION_VISIBILITY_KEY);
    setShowAiSuggestion(saved !== "hidden");
  }, []);

  const toggleHeaderMode = () => {
    setHeaderMode((prev) => {
      const next = prev === "chat" ? "details" : "chat";
      if (typeof window !== "undefined") window.localStorage.setItem(CHAT_HEADER_MODE_KEY, next);
      return next;
    });
  };

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
  const action = nextAction(conv);
  const aiReply = suggestedReply(conv, gender);
  const aiIntent = action.value === "เช็กสต็อก"
    ? "ถามสินค้า"
    : action.value === "ยืนยันสลิป"
      ? "แจ้งชำระเงิน"
      : action.value === "ออกเลขพัสดุ"
        ? "ถามจัดส่ง"
        : "ต้องตอบลูกค้า";

  // กัน primary โผล่เป็น helper ด้วย (เผื่อข้อมูลเก่าก่อน backend cleanup) — คนละบทบาทกัน ห้ามซ้ำ
  const helpers: StaffRef[] = (conv.helpers || []).filter((h: StaffRef) => h.id !== conv.assignedStaff?.id);
  const helperIds = new Set(helpers.map((h) => h.id));
  const helperCandidates = staffList.filter((s) => s.id !== conv.assignedStaff?.id && !helperIds.has(s.id));

  const headerControls = (
    <Space size={8} wrap style={{ justifyContent: isMobile ? "flex-start" : "flex-end", width: isMobile ? "100%" : undefined }}>
      <Button
        size="small"
        type={headerMode === "chat" ? "primary" : "default"}
        icon={headerMode === "chat" ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={toggleHeaderMode}
      >
        {headerMode === "chat" ? (isMobile ? "Details" : "Work Details") : "Chat Focus"}
      </Button>
      <Select size="small" value={conv.status} style={{ width: isMobile ? 98 : 110 }} disabled={!canManage}
          onChange={(v) => setStatus({ variables: { id: conv.id, status: v } })}
          options={["OPEN", "PENDING", "CLOSED"].map((s) => ({ value: s, label: s }))} />
      <Select
        size="small" style={{ minWidth: isMobile ? 170 : 180, flex: isMobile ? "1 1 170px" : undefined }} disabled={!canAssign} loading={assigning}
        value={conv.assignedStaff?.id ?? undefined}
        placeholder="ยังไม่มี staff หลัก"
        onChange={(userId) => assign({ variables: { id: conv.id, userId } })}
        options={staffList.map((s) => ({ value: s.id, label: staffLabel(s) }))}
      />
    </Space>
  );

  const header = (
    <div style={{ display: "grid", gap: isMobile ? 6 : 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: isMobile ? 8 : 12, alignItems: "flex-start", flexWrap: isMobile ? "nowrap" : "wrap" }}>
        <Space direction="vertical" size={1} style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, width: "100%" }}>
            {isMobile && (
              <Button type="text" size="small" icon={<LeftOutlined />} onClick={onBack} style={{ flexShrink: 0 }} />
            )}
            <Avatar size={isMobile ? 30 : 32} src={conv.customerAvatar || undefined} icon={<UserOutlined />} style={{ flexShrink: 0 }} />
            <Tag color={CHANNEL_COLOR[conv.channel] || "default"} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{conv.channel}</Tag>
            <Typography.Text strong ellipsis style={{ fontSize: isMobile ? 15 : 16, minWidth: 0, flex: 1 }}>
              {conv.customerName || conv.customerRef || "ลูกค้า"}
            </Typography.Text>
            {isMobile && (
              <Tag color={STATUS_COLOR[conv.status as ConvStatus] || "default"} style={{ marginInlineEnd: 0, flexShrink: 0 }}>{conv.status}</Tag>
            )}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{conv.customerRef || conv.id}</Typography.Text>
          {sourceLabel(conv) && (
            <Space size={6} wrap={!isMobile} style={{ minWidth: 0 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>ทักจาก:</Typography.Text>
              <Avatar size={18} src={conv.sourceAvatar || undefined} style={{ fontSize: 9 }}>
                {(conv.sourceDisplayName || conv.channel || "?").slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography.Text ellipsis style={{ fontSize: 12, minWidth: 0, maxWidth: isMobile ? "calc(100vw - 118px)" : undefined }}>{sourceLabel(conv)}</Typography.Text>
            </Space>
          )}
        </Space>
        {!isMobile && headerControls}
      </div>

      {isMobile && headerControls}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Tag color="blue" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999 }}>
          AI: {aiIntent}
        </Tag>
        <Tag color={action.color === "#389e0d" ? "green" : action.color === "#1677ff" ? "blue" : action.color === "#722ed1" ? "purple" : "orange"} icon={action.icon} style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999 }}>
          {action.label}: {action.value}
        </Tag>
        {headerMode === "details" && (
          <Tag color={conv.customerId ? "green" : "default"} icon={<ShoppingCartOutlined />} style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999 }}>
            {conv.customerId ? "ผูก CRM แล้ว" : "ยังไม่ผูก CRM"}
          </Tag>
        )}
        {headerMode === "details" && (
          <Tag
            color="gold" icon={<TagsOutlined />}
            style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999, cursor: "pointer" }}
            onClick={() => setShowHelperTags((v) => !v)}
          >
            {tags.length > 0 ? `${tags.length} แท็ก · ` : ""}ผู้ช่วยตอบ {helpers.length || "ยังไม่มี"} {showHelperTags ? <UpOutlined /> : <DownOutlined />}
          </Tag>
        )}
      </div>

      {headerMode === "details" && showHelperTags && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Space size={6} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>ผู้ช่วยตอบ:</Typography.Text>
            {helpers.length === 0 && <Typography.Text type="secondary" style={{ fontSize: 11 }}>ยังไม่มี</Typography.Text>}
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
                      size="small" style={{ width: 220 }} placeholder="เพิ่มคนช่วยตอบ"
                      options={helperCandidates.map((s) => ({ value: s.id, label: staffLabel(s) }))}
                      onSelect={(userId: string) => addHelper({ variables: { id: conv.id, userId } })}
                    />
                  }
                >
                  <Button type="dashed" size="small" shape="circle" icon={<PlusOutlined style={{ fontSize: 10 }} />} />
                </Popover>
              ) : (
                <Tooltip title="ยังไม่มี staff คนอื่นในร้านให้เพิ่มเป็นผู้ช่วยตอบ (ไปเพิ่ม staff ที่ /admin/users ก่อน)">
                  <Button type="dashed" size="small" shape="circle" disabled icon={<PlusOutlined style={{ fontSize: 10 }} />} />
                </Tooltip>
              )
            )}
          </Space>
          {canManage && (
            <Space size={6} wrap>
              <Select mode="tags" size="small" style={{ minWidth: 180 }} value={tags} onChange={setTags} placeholder="แท็ก" />
              <Button size="small" onClick={() => saveTags({ variables: { id: conv.id, tags } })}>บันทึกแท็ก</Button>
            </Space>
          )}
        </div>
      )}
    </div>
  );

  const [uploading, setUploading] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const submitReply = () => { if (!sending) sendWith(null); };

  const uploadAndSend = async (file: File) => {
    forceBottomRef.current = true;
    scrollChatToBottom("auto");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bms/inbox/upload", { method: "POST", body: fd, credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "อัปโหลดไม่สำเร็จ");
      sendWith({ url: j.url, name: j.name, mimeType: j.mimeType, isImage: /^image\//i.test(j.mimeType || "") });
    } catch (e: any) {
      forceBottomRef.current = false;
      message.error(e?.message || "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  };
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadAndSend(f);
    e.target.value = ""; // reset ให้เลือกไฟล์เดิมซ้ำได้
  };

  // Phase 1 status: OUT เท่านั้น · FAILED → ปุ่มส่งใหม่ · SENT → capability-gated
  const statusNode = (m: Msg) => {
    if (m.direction !== "OUT" || !m.status) return null;
    if (m.status === "FAILED") return (
      <>{" · "}<span style={{ color: "#ff4d4f" }}>✗ ส่งไม่สำเร็จ</span>{" "}
        <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 11 }}
          loading={retrying} onClick={() => retry({ variables: { id: m.id } })}>ส่งใหม่</Button>
      </>
    );
    return m.canReportDelivery
      ? <>{" · "}<span style={{ color: "#52c41a" }}>✓ ส่งแล้ว</span></>
      : <Tooltip title="ช่องนี้ไม่รายงานสถานะการส่งถึง/อ่าน"><span>{" · ✓ บันทึกแล้ว"}</span></Tooltip>;
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
  const renderMsg = (m: Msg) => {
    const isIn = m.direction === "IN";
    const isStaff = m.sender?.startsWith("staff");
    // ธีมมืด: customer = พื้นเทาโปร่ง (ตัวอักษรตามธีม) · staff = น้ำเงิน · AI = เขียว (ตัวอักษรขาว)
    const bubble = isIn
      ? { background: "rgba(148,163,184,0.20)", color: "var(--app-text, inherit)" }
      : isStaff
        ? { background: "#1677ff", color: "#fff" }
        : { background: "#15803d", color: "#fff" };
    return (
      <div key={`m-${m.id}`} style={{ alignSelf: isIn ? "flex-start" : "flex-end", maxWidth: isMobile ? "86%" : "75%", display: "flex", flexDirection: "column", alignItems: isIn ? "flex-start" : "flex-end" }}>
        <div style={{
          ...bubble,
          padding: "6px 10px", borderRadius: 10,
          whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
        }}>
          {m.body && <div>{m.body}</div>}
          {m.attachment && (m.attachment.isImage ? (
            <button
              type="button"
              onClick={() => {
                const idx = chatImages.findIndex((img) => img.id === m.id);
                setImagePreviewIndex(idx >= 0 ? idx : 0);
              }}
              style={{ border: 0, background: "transparent", padding: 0, marginTop: m.body ? 6 : 0, cursor: "zoom-in" }}
            >
              <img src={m.attachment.url} alt={m.attachment.name || "image"}
                style={{ maxWidth: isMobile ? "min(220px, 68vw)" : 220, maxHeight: isMobile ? 180 : 220, borderRadius: 8, display: "block" }} />
            </button>
          ) : (
            <a href={m.attachment.url} target="_blank" rel="noreferrer"
              style={{ color: "inherit", textDecoration: "underline", marginTop: m.body ? 6 : 0, display: "inline-block" }}>
              📎 {m.attachment.name || "ไฟล์แนบ"}
            </a>
          ))}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 2 }}>
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
            {dayLabel(item.at)}
          </span>
        </div>
      );
    }
    if (item.t === "start") feedNodes.push(centerRow("start", <>เริ่มการสนทนา · ช่องทาง {conv.channel} · {timeLabel(item.at)}</>));
    else if (item.t === "event") feedNodes.push(centerRow(`e-${item.ev.id}`, <>{eventIcon(item.ev.kind)} {eventText(item.ev)} · {timeLabel(item.at)}</>));
    else feedNodes.push(renderMsg(item.msg));
  }

  const chatTab = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* ข้อความ — เต็มพื้นที่ด้านบน scroll ได้ */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div
          ref={chatScrollRef}
          onScroll={onChatScroll}
          style={{ height: "100%", overflowY: "auto", padding: isMobile ? 4 : 6 }}
        >
          <div ref={chatFeedRef} style={{ minHeight: "100%", display: "flex", flexDirection: "column", gap: isMobile ? 7 : 8 }}>
            {feedNodes}
            {/* optimistic: กำลังส่ง/อัปโหลด */}
            {(sending || uploading) && (
              <div style={{ alignSelf: "flex-end", maxWidth: isMobile ? "86%" : "75%", display: "flex", flexDirection: "column", alignItems: "flex-end", opacity: 0.6 }}>
                <div style={{ background: "#1677ff", color: "#fff", padding: "8px 12px", borderRadius: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {uploading ? "กำลังอัปโหลดไฟล์…" : (reply || "…")}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 2 }}>⏳ กำลังส่ง…</Typography.Text>
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
            ข้อความใหม่ {newMessageCount} ↓
          </Button>
        )}
      </div>

      {can("inbox.reply") && (
        <div style={{ display: "grid", gap: 8, marginTop: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Tag color="blue" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0, paddingInline: 10, borderRadius: 999 }}>
              {showAiSuggestion ? "AI แนะนำคำตอบ" : "AI ถูกซ่อนอยู่"}
            </Tag>
            <Tooltip title={showAiSuggestion ? "ซ่อน AI suggestion" : "แสดง AI suggestion"}>
              <Button
                size="small"
                shape="circle"
                icon={showAiSuggestion ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={toggleAiSuggestion}
              />
            </Tooltip>
          </div>

          {showAiSuggestion && (
            <div style={{
              border: "1px dashed rgba(22,119,255,0.45)",
              background: "rgba(22,119,255,0.08)",
              borderRadius: isMobile ? 12 : 16,
              padding: isMobile ? 10 : 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: isMobile ? 8 : 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <Space direction="vertical" size={4} style={{ flex: 1, minWidth: isMobile ? 0 : 240 }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>คำตอบแนะนำแบบย่อ</Typography.Text>
                  <Typography.Text style={{ fontSize: 13 }}>{aiReply}</Typography.Text>
                </Space>
                <Space wrap>
                  <Button size="small" type="primary" onClick={() => setReply(aiReply)}>ใส่ในช่องพิมพ์</Button>
                  <Button size="small" onClick={() => setReply(applyGenderParticle("ขออนุญาตตรวจสอบข้อมูลให้นิดนึงนะคะ เดี๋ยวแจ้งกลับทันทีค่ะ", gender))}>ขอตรวจสอบ</Button>
                  <Button size="small" onClick={() => setReply(applyGenderParticle("ขอบคุณค่ะ หากมีข้อมูลเพิ่มเติมส่งมาได้เลยนะคะ 🙏", gender))}>ขอบคุณ</Button>
                </Space>
              </div>
            </div>
          )}
        </div>
      )}

      {/* กล่องพิมพ์ — ปักล่างสุด + toolbar */}
      {can("inbox.reply") && (
        <div style={{ borderTop: "1px solid var(--app-border, #303030)", paddingTop: 8, marginTop: 6, flexShrink: 0 }}>
          <input ref={imgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickFile} />
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
          <Space size={2} wrap style={{ marginBottom: 6 }}>
            <Popover content={emojiPicker} trigger="click" title="อีโมจิ">
              <Button type="text" size="small" icon={<SmileOutlined />}>อีโมจิ</Button>
            </Popover>
            <Tooltip title="แนบรูป (ส่งเข้าแชท)">
              <Button type="text" size="small" icon={<PictureOutlined />} loading={uploading} onClick={() => imgInputRef.current?.click()}>รูป</Button>
            </Tooltip>
            <Tooltip title="แนบไฟล์ (สูงสุด 10MB)">
              <Button type="text" size="small" icon={<PaperClipOutlined />} loading={uploading} onClick={() => fileInputRef.current?.click()}>ไฟล์</Button>
            </Tooltip>
            <Tooltip title="เปิดหน้าสินค้าเพื่อคัดลอก/ส่งรายละเอียดให้ลูกค้า">
              <Link href="/admin/products"><Button type="text" size="small" icon={<ShoppingCartOutlined />}>สินค้า</Button></Link>
            </Tooltip>
          </Space>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <Input.TextArea
              rows={isMobile ? 1 : 2} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="พิมพ์ตอบลูกค้า (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)"
              style={{ flex: 1, resize: "none" }}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); submitReply(); } }}
            />
            <Button type="primary" size="large" icon={<SendOutlined />} loading={sending} disabled={!reply.trim()}
              style={{ height: "auto", minWidth: isMobile ? 58 : 88 }} onClick={submitReply}>{isMobile ? "" : "ส่ง"}</Button>
          </div>
        </div>
      )}
    </div>
  );

  const notesTab = (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {canManage && (
        <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="โน้ตภายใน (ลูกค้าไม่เห็น)" />
          <Button loading={noting} disabled={!note.trim()} onClick={() => addNote({ variables: { id: conv.id, body: note } })}>เพิ่ม</Button>
        </Space.Compact>
      )}
      <List size="small" dataSource={conv.notes || []} locale={{ emptyText: "ยังไม่มีโน้ต" }}
        renderItem={(n: Note) => (
          <List.Item>
            <List.Item.Meta title={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{n.author} · {new Date(n.createdAt).toLocaleString()}</Typography.Text>} description={n.body} />
          </List.Item>
        )} />
    </div>
  );

  const customerTab = (
    <div>
      {!canViewCustomer && <Empty description="ไม่มีสิทธิ์ดูข้อมูลลูกค้า" />}
      {canViewCustomer && !conv.customerId && <Empty description="บทสนทนานี้ยังไม่ผูกกับลูกค้าในระบบ" />}
      {canViewCustomer && conv.customerId && custLoading && !custData && <Typography.Text type="secondary">กำลังโหลด…</Typography.Text>}
      {canViewCustomer && custData?.bmsCustomer && (
        <div>
          <Space size="large" wrap style={{ marginBottom: 12 }}>
            <Statistic title="ยอดซื้อสะสม" value={custData.bmsCustomer.total_spent} suffix="฿" precision={0} />
            <Statistic title="จำนวนออร์เดอร์" value={custData.bmsCustomer.order_count} />
          </Space>
          {(custData.bmsCustomer.tags || []).length > 0 && (
            <Space wrap style={{ marginBottom: 8 }}>
              {custData.bmsCustomer.tags.map((t: string) => <Tag key={t} color="gold">{t}</Tag>)}
            </Space>
          )}
          {custData.bmsCustomer.note && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 12 }}>
              📝 {custData.bmsCustomer.note}
            </Typography.Paragraph>
          )}
          <Divider style={{ margin: "8px 0" }} />
          <Typography.Text strong style={{ fontSize: 12.5 }}>ประวัติการซื้อ</Typography.Text>
          <List
            size="small"
            dataSource={custData.bmsCustomer.orders || []}
            locale={{ emptyText: "ยังไม่เคยสั่งซื้อ" }}
            renderItem={(o: any) => (
              <List.Item
                actions={canReorder ? [
                  <Button
                    key="reorder" type="link" size="small"
                    loading={reorderingId === o.id}
                    onClick={() => { setReorderingId(o.id); reorder({ variables: { id: o.id } }); }}
                  >ซื้อซ้ำ</Button>,
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

  const timelineTab = (
    <div style={{ height: "100%", overflowY: "auto" }}>
      {(!tlData) && <Button size="small" onClick={() => loadTimeline({ variables: { id: conv.id } })} loading={tlLoading}>โหลด timeline</Button>}
      <List size="small" dataSource={tlData?.bmsConversationTimeline || []} locale={{ emptyText: tlData ? "ไม่มีเหตุการณ์" : "" }}
        renderItem={(t: any) => (
          <List.Item>
            <List.Item.Meta
              title={<Space><Tag>{t.type}</Tag><span>{new Date(t.at).toLocaleString()}</span></Space>}
              description={<span>{t.text}{t.ref ? ` · ${t.ref}` : ""}</span>}
            />
          </List.Item>
        )} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {header}
      <Divider style={{ margin: isMobile ? "4px 0 6px" : "6px 0 8px" }} />
      <Tabs
        size="small"
        className="bms-inbox-tabs-fill"
        tabBarGutter={isMobile ? 18 : undefined}
        items={[
          { key: "chat", label: "แชท", children: chatTab },
          { key: "customer", label: "ลูกค้า", children: customerTab },
          { key: "notes", label: "โน้ต", children: notesTab },
          { key: "timeline", label: "Timeline", children: timelineTab },
        ]}
      />
      <Modal
        open={imagePreviewIndex != null}
        onCancel={() => setImagePreviewIndex(null)}
        footer={null}
        width="min(92vw, 1080px)"
        centered
        styles={{
          content: {
            padding: 16,
            borderRadius: 28,
            overflow: "hidden",
            background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
          },
          body: { padding: 0 },
        }}
      >
        {imagePreviewIndex != null && chatImages[imagePreviewIndex] && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <Space direction="vertical" size={2}>
                <Typography.Text strong style={{ fontSize: 28, lineHeight: 1 }}>
                  รูป {imagePreviewIndex + 1} / {chatImages.length}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {chatImages[imagePreviewIndex].sender} · {timeLabel(chatImages[imagePreviewIndex].createdAt)}
                </Typography.Text>
              </Space>
              <Space wrap>
                <Button icon={<DownloadOutlined />} href={chatImages[imagePreviewIndex].url} target="_blank">
                  เปิดไฟล์
                </Button>
                <Button type="primary" onClick={() => setImagePreviewIndex(null)}>ปิด</Button>
              </Space>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr) 56px", gap: 14, alignItems: "center" }}>
              <Button
                shape="circle"
                icon={<LeftOutlined />}
                onClick={() => movePreview(-1)}
                style={{ width: 56, height: 56, justifySelf: "center", boxShadow: "0 10px 24px rgba(15,23,42,0.12)" }}
              />

              <div style={{
                border: "1px solid rgba(15,23,42,0.08)",
                borderRadius: 24,
                padding: 18,
                background: "linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%)",
                display: "grid",
                gap: 14,
              }}>
                <div style={{
                  position: "relative",
                  borderRadius: 20,
                  overflow: "hidden",
                  background: "#eaf1fb",
                  minHeight: "58vh",
                  display: "grid",
                  placeItems: "center",
                }}>
                  <img
                    src={chatImages[imagePreviewIndex].url}
                    alt={chatImages[imagePreviewIndex].name}
                    style={{ width: "100%", maxHeight: "58vh", objectFit: "contain", display: "block" }}
                  />
                  <div style={{
                    position: "absolute",
                    left: 14,
                    right: 14,
                    bottom: 14,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: 10,
                    flexWrap: "wrap",
                  }}>
                    <div style={{
                      backdropFilter: "blur(14px)",
                      background: "rgba(255,255,255,0.72)",
                      border: "1px solid rgba(255,255,255,0.85)",
                      borderRadius: 16,
                      padding: "10px 12px",
                      boxShadow: "0 10px 28px rgba(15,23,42,0.16)",
                    }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>ผู้ส่ง</Typography.Text>
                      <Typography.Text strong>{chatImages[imagePreviewIndex].sender}</Typography.Text>
                    </div>
                    <div style={{
                      backdropFilter: "blur(14px)",
                      background: "rgba(255,255,255,0.72)",
                      border: "1px solid rgba(255,255,255,0.85)",
                      borderRadius: 16,
                      padding: "10px 12px",
                      boxShadow: "0 10px 28px rgba(15,23,42,0.16)",
                    }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11, display: "block" }}>เวลา</Typography.Text>
                      <Typography.Text strong>{timeLabel(chatImages[imagePreviewIndex].createdAt)}</Typography.Text>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{
                    flex: 1,
                    minWidth: 220,
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "rgba(22,119,255,0.08)",
                    border: "1px solid rgba(22,119,255,0.12)",
                  }}>
                    <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>คำอธิบาย</Typography.Text>
                    <Typography.Text>
                      {chatImages[imagePreviewIndex].body || "รูปนี้ไม่มีข้อความประกอบในแชท"}
                    </Typography.Text>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    ใช้ลูกศรซ้าย-ขวา เพื่อดูรูปก่อนหน้าและถัดไป
                  </Typography.Text>
                </div>
              </div>

              <Button
                shape="circle"
                icon={<RightOutlined />}
                type="primary"
                onClick={() => movePreview(1)}
                style={{ width: 56, height: 56, justifySelf: "center", boxShadow: "0 10px 24px rgba(22,119,255,0.22)" }}
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
