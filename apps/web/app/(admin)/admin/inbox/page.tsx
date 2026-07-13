'use client';
import { gql, useQuery, useLazyQuery, useMutation } from "@apollo/client";
import {
  List, Input, Button, Space, Tag, Segmented, message, Alert, Badge,
  Typography, Avatar, Select, Tabs, Empty, Divider, Popover, Tooltip, Switch, Statistic,
} from "antd";
import { useState, useEffect, useRef } from "react";
import {
  ReloadOutlined, SendOutlined, UserOutlined,
  SmileOutlined, PictureOutlined, PaperClipOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, CloseOutlined,
  UserSwitchOutlined, UsergroupAddOutlined, UsergroupDeleteOutlined, CheckCircleOutlined,
} from "@ant-design/icons";

const EMOJIS = ["😊","😀","😂","🙏","👍","🙂","😅","😍","🥰","😘","😉","😎","🤔","😢","😭","😡","🎉","✨","🔥","💯","❤️","💙","💚","👏","🙌","🛒","📦","🚚","💰","✅","❌","⭐","📌","🏷️","🎁","👌"];
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import Customer360Panel from "./Customer360Panel";

// ---- Types --------------------------------------------------
type ConvStatus = "OPEN" | "PENDING" | "CLOSED";
type StaffRef = { id: string; name: string | null; email: string | null; avatar: string | null; role?: string | null; isAvailable?: boolean | null; openCount?: number | null };
type Conversation = {
  id: string; channel: string; customerRef: string | null; customerName: string | null;
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
      id channel customerRef customerName status tags unread lastMessage lastMessageAt
      assignedStaff { id name avatar }
    }
  }
`;
const Q_CONV = gql`
  query ($id: ID!) {
    bmsConversation(id: $id) {
      id channel customerRef customerId customerName status tags unread createdAt
      assignedStaff { ${STAFF_FIELDS} }
      helpers { ${STAFF_FIELDS} }
      messages { id direction body sender createdAt attachment { url name mimeType isImage } status canReportDelivery }
      systemEvents { id kind at actorName targetName statusValue auto }
      notes { id author body createdAt }
    }
  }
`;
const Q_STAFF = gql`query { bmsAssignableStaff { ${STAFF_FIELDS} } }`;
const Q_ME = gql`query { bmsMe { id role is_available } }`;
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

// preview ในลิสต์: ถ้าข้อความล่าสุดเป็น attachment (marker จาก sendStaffMessage) → โชว์ไอคอน
function previewNode(last?: string | null) {
  if (!last) return "—";
  if (last.startsWith("[รูปภาพ]")) return <><PictureOutlined /> รูปภาพ</>;
  if (last.startsWith("[ไฟล์]")) return <><PaperClipOutlined /> {last.replace("[ไฟล์]", "").trim() || "ไฟล์แนบ"}</>;
  return last;
}

function Inbox() {
  const { can } = useBmsPermissions();
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

  const [loadConv, { data: convData, refetch: refetchConv }] = useLazyQuery(Q_CONV, { fetchPolicy: "cache-and-network" });
  const conv = convData?.bmsConversation;
  const [markRead] = useMutation(M_READ);

  useEffect(() => {
    if (activeId) {
      loadConv({ variables: { id: activeId } });
      markRead({ variables: { id: activeId } }).then(() => refetch());
    }
  }, [activeId]); // eslint-disable-line

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      <div style={{ marginBottom: 10, flexShrink: 0 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>BMS Inbox (Omnichannel)</h2>
          <Space>
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

      <div style={{ display: "flex", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>
        {/* ---- left: conversation list ---- */}
        <div style={{ width: listCollapsed ? 72 : 300, flexShrink: 0, minHeight: 0, border: "1px solid var(--app-border, #eee)", borderRadius: 8, padding: listCollapsed ? "10px 6px" : 10, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: listCollapsed ? "center" : "flex-end", marginBottom: 6 }}>
            <Tooltip title={listCollapsed ? "ขยาย list" : "ย่อ list"}>
              <Button type="text" size="small"
                icon={listCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggleListCollapsed} />
            </Tooltip>
          </div>
          {!listCollapsed && (
            <>
              <Segmented block size="small" options={FILTERS as unknown as string[]} value={filter} onChange={(v) => setFilter(v as any)} style={{ marginBottom: 6 }} />
              <Input.Search size="small" placeholder="ค้นหาชื่อ/ข้อความ/ref" allowClear onSearch={setSearch} style={{ marginBottom: 6 }} />
              <Space size={6} style={{ marginBottom: 6 }}>
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
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0, paddingRight: listCollapsed ? 8 : 0 }}>
            <List
              loading={loading} dataSource={conversations}
              locale={{ emptyText: listCollapsed ? null : <Empty description="ไม่มีบทสนทนา" /> }}
              renderItem={(c) => (
                <List.Item
                  onClick={() => setActiveId(c.id)}
                  style={{
                    cursor: "pointer", padding: listCollapsed ? "6px 0" : 6, borderRadius: 6,
                    display: listCollapsed ? "flex" : undefined,
                    justifyContent: listCollapsed ? "center" : undefined,
                    // ธีมมืด: ไฮไลต์ด้วยน้ำเงินโปร่ง (ตัวอักษรตามธีม อ่านออก) + ขีดซ้าย
                    background: activeId === c.id ? "rgba(22,119,255,0.16)" : undefined,
                    borderLeft: activeId === c.id ? "3px solid #1677ff" : "3px solid transparent",
                  }}
                >
                  {listCollapsed ? (
                    <Tooltip placement="right" title={`${c.channel} · ${c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}`}>
                      <Badge count={c.unread} size="small"><Avatar size={28} icon={<UserOutlined />} /></Badge>
                    </Tooltip>
                  ) : (
                    <List.Item.Meta
                      avatar={<Badge count={c.unread} size="small"><Avatar size={28} icon={<UserOutlined />} /></Badge>}
                      title={
                        <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                          <Space size={4}>
                            <Tag color={CHANNEL_COLOR[c.channel] || "default"}>{c.channel}</Tag>
                            <span>{c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}</span>
                          </Space>
                          {c.assignedStaff && (
                            <Tooltip title={`staff หลัก: ${c.assignedStaff.name || c.assignedStaff.id}`}>
                              <Avatar size={16} src={c.assignedStaff.avatar || undefined} style={{ fontSize: 9, backgroundColor: "#1677ff" }}>
                                {(c.assignedStaff.name || "?").slice(0, 1).toUpperCase()}
                              </Avatar>
                            </Tooltip>
                          )}
                        </Space>
                      }
                      description={<Typography.Text ellipsis style={{ maxWidth: 220, fontSize: 12 }} type="secondary">{previewNode(c.lastMessage)}</Typography.Text>}
                    />
                  )}
                </List.Item>
              )}
            />
          </div>
        </div>

        {/* ---- middle: active conversation ---- */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", border: "1px solid var(--app-border, #eee)", borderRadius: 8, padding: 12 }}>
          {!conv ? (
            <Empty description="เลือกบทสนทนาทางซ้าย" style={{ marginTop: 120 }} />
          ) : (
            <ConversationPane key={conv.id} conv={conv} can={can}
              onChanged={() => { refetchConv(); refetch(); }} />
          )}
        </div>

        {/* ---- right: Customer 360 panel ---- */}
        {conv && <Customer360Panel conv={conv} can={can} />}
      </div>
    </div>
  );
}

function ConversationPane({ conv, can, onChanged }: { conv: any; can: (p: string) => boolean; onChanged: () => void }) {
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>(conv.tags || []);
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่ได้");

  const [send, { loading: sending }] = useMutation(M_SEND, {
    onCompleted: (d: any) => {
      const r = d?.bmsSendMessage;
      if (r?.status === "SENT") { message.success(r.message); setReply(""); onChanged(); }
      else onErr({ message: r?.message });
    }, onError: onErr,
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

  const canManage = can("inbox.manage");
  const canAssign = can("inbox.assign");
  const canHelp = can("inbox.reply");

  // กัน primary โผล่เป็น helper ด้วย (เผื่อข้อมูลเก่าก่อน backend cleanup) — คนละบทบาทกัน ห้ามซ้ำ
  const helpers: StaffRef[] = (conv.helpers || []).filter((h: StaffRef) => h.id !== conv.assignedStaff?.id);
  const helperIds = new Set(helpers.map((h) => h.id));
  const helperCandidates = staffList.filter((s) => s.id !== conv.assignedStaff?.id && !helperIds.has(s.id));

  const header = (
    <Space style={{ width: "100%", justifyContent: "space-between" }} align="start" wrap>
      <Space direction="vertical" size={0}>
        <Space>
          <Tag color={CHANNEL_COLOR[conv.channel] || "default"}>{conv.channel}</Tag>
          <b>{conv.customerName || conv.customerRef || "ลูกค้า"}</b>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{conv.customerRef}</Typography.Text>
      </Space>
      <Space direction="vertical" size={4} align="end">
        <Space wrap>
          <Select size="small" value={conv.status} style={{ width: 120 }} disabled={!canManage}
            onChange={(v) => setStatus({ variables: { id: conv.id, status: v } })}
            options={["OPEN", "PENDING", "CLOSED"].map((s) => ({ value: s, label: s }))} />
          <Select
            size="small" style={{ minWidth: 170 }} disabled={!canAssign} loading={assigning}
            value={conv.assignedStaff?.id ?? undefined}
            placeholder="ยังไม่มี staff หลัก"
            onChange={(userId) => assign({ variables: { id: conv.id, userId } })}
            options={staffList.map((s) => ({ value: s.id, label: staffLabel(s) }))}
          />
        </Space>
        <Space size={4} align="center">
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>ผู้ช่วยตอบ:</Typography.Text>
          {helpers.map((h) => (
            <Tooltip key={h.id} title={h.name || h.email || h.id}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <Avatar size={20} src={h.avatar || undefined} style={{ fontSize: 10 }}>
                  {(h.name || "?").slice(0, 1).toUpperCase()}
                </Avatar>
                {canHelp && (
                  <CloseOutlined
                    onClick={() => removeHelper({ variables: { id: conv.id, userId: h.id } })}
                    style={{ position: "absolute", top: -4, right: -4, fontSize: 9, background: "#ff4d4f", color: "#fff", borderRadius: "50%", padding: 2, cursor: "pointer" }}
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
                    size="small" style={{ width: 200 }} placeholder="เพิ่มคนช่วยตอบ"
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
      </Space>
    </Space>
  );

  const [uploading, setUploading] = useState(false);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendWith = (attachment: Attachment | null) => {
    const body = reply.trim();
    if (!body && !attachment) return;
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
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bms/inbox/upload", { method: "POST", body: fd, credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "อัปโหลดไม่สำเร็จ");
      sendWith({ url: j.url, name: j.name, mimeType: j.mimeType, isImage: /^image\//i.test(j.mimeType || "") });
    } catch (e: any) {
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
  const events: SystemEvent[] = conv.systemEvents || [];
  // marker เริ่มสนทนายึดเวลาที่เก่าที่สุดระหว่าง created_at กับข้อความแรก (กัน seed ที่ created_at = now())
  const earliest = msgs.reduce((min, m) => (min && m.createdAt > min ? min : m.createdAt), conv.createdAt || "");
  const feed: FeedItem[] = [
    ...(earliest ? [{ t: "start", at: earliest } as FeedItem] : []),
    ...msgs.map((m) => ({ t: "msg", at: m.createdAt, msg: m } as FeedItem)),
    ...events.map((ev) => ({ t: "event", at: ev.at, ev } as FeedItem)),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

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
      <div key={`m-${m.id}`} style={{ alignSelf: isIn ? "flex-start" : "flex-end", maxWidth: "75%", display: "flex", flexDirection: "column", alignItems: isIn ? "flex-start" : "flex-end" }}>
        <div style={{
          ...bubble,
          padding: "6px 10px", borderRadius: 10,
          whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
        }}>
          {m.body && <div>{m.body}</div>}
          {m.attachment && (m.attachment.isImage ? (
            <a href={m.attachment.url} target="_blank" rel="noreferrer">
              <img src={m.attachment.url} alt={m.attachment.name || "image"}
                style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, marginTop: m.body ? 6 : 0, display: "block" }} />
            </a>
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
      <div style={{ flex: 1, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 8 }}>
        {feedNodes}
        {/* optimistic: กำลังส่ง/อัปโหลด */}
        {(sending || uploading) && (
          <div style={{ alignSelf: "flex-end", maxWidth: "75%", display: "flex", flexDirection: "column", alignItems: "flex-end", opacity: 0.6 }}>
            <div style={{ background: "#1677ff", color: "#fff", padding: "8px 12px", borderRadius: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {uploading ? "กำลังอัปโหลดไฟล์…" : (reply || "…")}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 2 }}>⏳ กำลังส่ง…</Typography.Text>
          </div>
        )}
      </div>

      {/* กล่องพิมพ์ — ปักล่างสุด + toolbar */}
      {can("inbox.reply") && (
        <div style={{ borderTop: "1px solid var(--app-border, #303030)", paddingTop: 8, marginTop: 6, flexShrink: 0 }}>
          <input ref={imgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickFile} />
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
          <Space size={2} style={{ marginBottom: 6 }}>
            <Popover content={emojiPicker} trigger="click" title="อีโมจิ">
              <Button type="text" size="small" icon={<SmileOutlined />} />
            </Popover>
            <Tooltip title="แนบรูป (ส่งเข้าแชท)">
              <Button type="text" size="small" icon={<PictureOutlined />} loading={uploading} onClick={() => imgInputRef.current?.click()} />
            </Tooltip>
            <Tooltip title="แนบไฟล์ (สูงสุด 10MB)">
              <Button type="text" size="small" icon={<PaperClipOutlined />} loading={uploading} onClick={() => fileInputRef.current?.click()} />
            </Tooltip>
          </Space>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <Input.TextArea
              rows={2} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="พิมพ์ตอบลูกค้า (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)"
              style={{ flex: 1, resize: "none" }}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); submitReply(); } }}
            />
            <Button type="primary" size="large" icon={<SendOutlined />} loading={sending} disabled={!reply.trim()}
              style={{ height: "auto", minWidth: 88 }} onClick={submitReply}>ส่ง</Button>
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
      {canManage && (
        <>
          <Divider style={{ margin: "8px 0" }} />
          <Space wrap>
            <Select mode="tags" size="small" style={{ minWidth: 240 }} value={tags} onChange={setTags} placeholder="แท็ก" />
            <Button size="small" onClick={() => saveTags({ variables: { id: conv.id, tags } })}>บันทึกแท็ก</Button>
          </Space>
        </>
      )}
      <Divider style={{ margin: "8px 0" }} />
      <Tabs
        size="small"
        className="bms-inbox-tabs-fill"
        items={[
          { key: "chat", label: "แชท", children: chatTab },
          { key: "customer", label: "ลูกค้า", children: customerTab },
          { key: "notes", label: "โน้ต", children: notesTab },
          { key: "timeline", label: "Timeline", children: timelineTab },
        ]}
      />
    </div>
  );
}

export default function Page() {
  return <Inbox />;
}
