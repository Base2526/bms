'use client';
import { gql, useQuery, useLazyQuery, useMutation } from "@apollo/client";
import {
  List, Input, Button, Space, Tag, Segmented, message, Alert, Badge,
  Typography, Avatar, Select, Tabs, Empty, Divider, Popover, Tooltip, Statistic,
} from "antd";
import { useState, useEffect, useRef } from "react";
import {
  ReloadOutlined, SendOutlined, UserOutlined,
  SmileOutlined, PictureOutlined, PaperClipOutlined,
} from "@ant-design/icons";

const EMOJIS = ["😊","😀","😂","🙏","👍","🙂","😅","😍","🥰","😘","😉","😎","🤔","😢","😭","😡","🎉","✨","🔥","💯","❤️","💙","💚","👏","🙌","🛒","📦","🚚","💰","✅","❌","⭐","📌","🏷️","🎁","👌"];
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

// ---- Types --------------------------------------------------
type ConvStatus = "OPEN" | "PENDING" | "CLOSED";
type Conversation = {
  id: string; channel: string; customerRef: string | null; customerName: string | null;
  status: ConvStatus; assignedTo: string | null; tags: string[]; unread: number;
  lastMessage: string | null; lastMessageAt: string | null;
};
type Attachment = { url: string; name: string | null; mimeType: string | null; isImage: boolean };
type Msg = {
  id: string; direction: "IN" | "OUT"; body: string; sender: string | null; createdAt: string;
  attachment?: Attachment | null; status?: string | null; canReportDelivery?: boolean;
};
type Note = { id: string; author: string | null; body: string; createdAt: string };

// ---- GraphQL ------------------------------------------------
const Q_LIST = gql`
  query ($status: BmsConvStatus, $search: String) {
    bmsConversations(status: $status, search: $search, limit: 100) {
      id channel customerRef customerName status assignedTo tags unread lastMessage lastMessageAt
    }
  }
`;
const Q_CONV = gql`
  query ($id: ID!) {
    bmsConversation(id: $id) {
      id channel customerRef customerId customerName status assignedTo tags unread
      messages { id direction body sender createdAt attachment { url name mimeType isImage } status canReportDelivery }
      notes { id author body createdAt }
    }
  }
`;
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
const M_ASSIGN = gql`mutation ($id: ID!, $assignedTo: String) { bmsAssignConversation(id: $id, assignedTo: $assignedTo) }`;
const M_STATUS = gql`mutation ($id: ID!, $status: BmsConvStatus!) { bmsSetConversationStatus(id: $id, status: $status) }`;
const M_TAGS = gql`mutation ($id: ID!, $tags: [String!]!) { bmsSetConversationTags(id: $id, tags: $tags) }`;
const M_READ = gql`mutation ($id: ID!) { bmsMarkConversationRead(id: $id) }`;
const M_NOTE = gql`mutation ($id: ID!, $body: String!) { bmsAddConversationNote(id: $id, body: $body) { id author body createdAt } }`;
const M_REORDER = gql`mutation ($id: ID!) { bmsReorderFromOrder(id: $id) { status orderId total message } }`;

const CHANNEL_COLOR: Record<string, string> = { line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", shopee: "orange", lazada: "purple", test: "default" };
const STATUS_COLOR: Record<ConvStatus, string> = { OPEN: "green", PENDING: "orange", CLOSED: "default" };
const FILTERS = ["ALL", "OPEN", "PENDING", "CLOSED"] as const;

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
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, loading, refetch } = useQuery(Q_LIST, {
    variables: { status: filter === "ALL" ? null : filter, search: search || null },
    fetchPolicy: "cache-and-network",
    pollInterval: 20000,
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
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>BMS Inbox (Omnichannel)</h2>
          <Button icon={<ReloadOutlined />} onClick={() => { refetch(); if (activeId) refetchConv(); }} loading={loading}>Refresh</Button>
        </Space>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "stretch", minHeight: 520 }}>
        {/* ---- left: conversation list ---- */}
        <div style={{ width: 340, flexShrink: 0, border: "1px solid var(--app-border, #eee)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column" }}>
          <Segmented block options={FILTERS as unknown as string[]} value={filter} onChange={(v) => setFilter(v as any)} style={{ marginBottom: 8 }} />
          <Input.Search placeholder="ค้นหาชื่อ/ข้อความ/ref" allowClear onSearch={setSearch} style={{ marginBottom: 8 }} />
          <div style={{ overflowY: "auto", flex: 1 }}>
            <List
              loading={loading} dataSource={conversations}
              locale={{ emptyText: <Empty description="ไม่มีบทสนทนา" /> }}
              renderItem={(c) => (
                <List.Item
                  onClick={() => setActiveId(c.id)}
                  style={{
                    cursor: "pointer", padding: 8, borderRadius: 6,
                    // ธีมมืด: ไฮไลต์ด้วยน้ำเงินโปร่ง (ตัวอักษรตามธีม อ่านออก) + ขีดซ้าย
                    background: activeId === c.id ? "rgba(22,119,255,0.16)" : undefined,
                    borderLeft: activeId === c.id ? "3px solid #1677ff" : "3px solid transparent",
                  }}
                >
                  <List.Item.Meta
                    avatar={<Badge count={c.unread}><Avatar icon={<UserOutlined />} /></Badge>}
                    title={
                      <Space size={4}>
                        <Tag color={CHANNEL_COLOR[c.channel] || "default"}>{c.channel}</Tag>
                        <span>{c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}</span>
                      </Space>
                    }
                    description={<Typography.Text ellipsis style={{ maxWidth: 240 }} type="secondary">{previewNode(c.lastMessage)}</Typography.Text>}
                  />
                </List.Item>
              )}
            />
          </div>
        </div>

        {/* ---- right: active conversation ---- */}
        <div style={{ flex: 1, border: "1px solid var(--app-border, #eee)", borderRadius: 8, padding: 16 }}>
          {!conv ? (
            <Empty description="เลือกบทสนทนาทางซ้าย" style={{ marginTop: 120 }} />
          ) : (
            <ConversationPane key={conv.id} conv={conv} can={can}
              onChanged={() => { refetchConv(); refetch(); }} />
          )}
        </div>
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
  const [assign] = useMutation(M_ASSIGN, { onCompleted: onChanged, onError: onErr });
  const [setStatus] = useMutation(M_STATUS, { onCompleted: onChanged, onError: onErr });
  const [saveTags] = useMutation(M_TAGS, { onCompleted: () => { message.success("บันทึกแท็กแล้ว"); onChanged(); }, onError: onErr });
  const [addNote, { loading: noting }] = useMutation(M_NOTE, {
    onCompleted: () => { message.success("เพิ่มโน้ตแล้ว"); setNote(""); onChanged(); }, onError: onErr,
  });
  const [loadTimeline, { data: tlData, loading: tlLoading }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });
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

  const header = (
    <Space style={{ width: "100%", justifyContent: "space-between" }} align="start" wrap>
      <Space direction="vertical" size={0}>
        <Space>
          <Tag color={CHANNEL_COLOR[conv.channel] || "default"}>{conv.channel}</Tag>
          <b>{conv.customerName || conv.customerRef || "ลูกค้า"}</b>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{conv.customerRef}</Typography.Text>
      </Space>
      <Space wrap>
        <Select size="small" value={conv.status} style={{ width: 120 }} disabled={!canManage}
          onChange={(v) => setStatus({ variables: { id: conv.id, status: v } })}
          options={["OPEN", "PENDING", "CLOSED"].map((s) => ({ value: s, label: s }))} />
        <Input size="small" placeholder="assign to (email)" defaultValue={conv.assignedTo ?? ""} disabled={!canManage}
          style={{ width: 160 }} onPressEnter={(e) => assign({ variables: { id: conv.id, assignedTo: (e.target as HTMLInputElement).value || null } })} />
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

  const chatTab = (
    <div style={{ display: "flex", flexDirection: "column", height: 460 }}>
      {/* ข้อความ — เต็มพื้นที่ด้านบน scroll ได้ */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
        {(conv.messages || []).map((m: Msg) => {
          const isIn = m.direction === "IN";
          const isStaff = m.sender?.startsWith("staff");
          // ธีมมืด: customer = พื้นเทาโปร่ง (ตัวอักษรตามธีม) · staff = น้ำเงิน · AI = เขียว (ตัวอักษรขาว)
          const bubble = isIn
            ? { background: "rgba(148,163,184,0.20)", color: "var(--app-text, inherit)" }
            : isStaff
              ? { background: "#1677ff", color: "#fff" }
              : { background: "#15803d", color: "#fff" };
          return (
            <div key={m.id} style={{ alignSelf: isIn ? "flex-start" : "flex-end", maxWidth: "75%", display: "flex", flexDirection: "column", alignItems: isIn ? "flex-start" : "flex-end" }}>
              <div style={{
                ...bubble,
                padding: "8px 12px", borderRadius: 10,
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
                {m.sender} · {new Date(m.createdAt).toLocaleString()}{statusNode(m)}
              </Typography.Text>
            </div>
          );
        })}
        {(conv.messages || []).length === 0 && !sending && !uploading && <Empty description="ยังไม่มีข้อความ" />}
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
        <div style={{ borderTop: "1px solid var(--app-border, #303030)", paddingTop: 10, marginTop: 8 }}>
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
    <div>
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
    <div>
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
    <div>
      {header}
      {canManage && (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Space wrap>
            <Select mode="tags" size="small" style={{ minWidth: 240 }} value={tags} onChange={setTags} placeholder="แท็ก" />
            <Button size="small" onClick={() => saveTags({ variables: { id: conv.id, tags } })}>บันทึกแท็ก</Button>
          </Space>
        </>
      )}
      <Divider style={{ margin: "12px 0" }} />
      <Tabs
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
