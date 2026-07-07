'use client';
import { gql, useQuery, useLazyQuery, useMutation } from "@apollo/client";
import {
  List, Input, Button, Space, Tag, Segmented, message, Alert, Badge,
  Typography, Avatar, Select, Tabs, Empty, Divider,
} from "antd";
import { useState, useEffect } from "react";
import { ReloadOutlined, SendOutlined, UserOutlined } from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

// ---- Types --------------------------------------------------
type ConvStatus = "OPEN" | "PENDING" | "CLOSED";
type Conversation = {
  id: string; channel: string; customerRef: string | null; customerName: string | null;
  status: ConvStatus; assignedTo: string | null; tags: string[]; unread: number;
  lastMessage: string | null; lastMessageAt: string | null;
};
type Msg = { id: string; direction: "IN" | "OUT"; body: string; sender: string | null; createdAt: string };
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
      id channel customerRef customerName status assignedTo tags unread
      messages { id direction body sender createdAt }
      notes { id author body createdAt }
    }
  }
`;
const Q_TIMELINE = gql`query ($id: ID!) { bmsConversationTimeline(id: $id) { type at text ref } }`;
const M_SEND = gql`mutation ($id: ID!, $body: String!) { bmsSendMessage(id: $id, body: $body) { status delivered message } }`;
const M_ASSIGN = gql`mutation ($id: ID!, $assignedTo: String) { bmsAssignConversation(id: $id, assignedTo: $assignedTo) }`;
const M_STATUS = gql`mutation ($id: ID!, $status: BmsConvStatus!) { bmsSetConversationStatus(id: $id, status: $status) }`;
const M_TAGS = gql`mutation ($id: ID!, $tags: [String!]!) { bmsSetConversationTags(id: $id, tags: $tags) }`;
const M_READ = gql`mutation ($id: ID!) { bmsMarkConversationRead(id: $id) }`;
const M_NOTE = gql`mutation ($id: ID!, $body: String!) { bmsAddConversationNote(id: $id, body: $body) { id author body createdAt } }`;

const CHANNEL_COLOR: Record<string, string> = { line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue", test: "default" };
const STATUS_COLOR: Record<ConvStatus, string> = { OPEN: "green", PENDING: "orange", CLOSED: "default" };
const FILTERS = ["ALL", "OPEN", "PENDING", "CLOSED"] as const;

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
                  style={{ cursor: "pointer", padding: 8, borderRadius: 6, background: activeId === c.id ? "var(--app-hover, #f0f7ff)" : undefined }}
                >
                  <List.Item.Meta
                    avatar={<Badge count={c.unread}><Avatar icon={<UserOutlined />} /></Badge>}
                    title={
                      <Space size={4}>
                        <Tag color={CHANNEL_COLOR[c.channel] || "default"}>{c.channel}</Tag>
                        <span>{c.customerName || c.customerRef?.slice(0, 12) || "ลูกค้า"}</span>
                      </Space>
                    }
                    description={<Typography.Text ellipsis style={{ maxWidth: 240 }} type="secondary">{c.lastMessage || "—"}</Typography.Text>}
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
  const [assign] = useMutation(M_ASSIGN, { onCompleted: onChanged, onError: onErr });
  const [setStatus] = useMutation(M_STATUS, { onCompleted: onChanged, onError: onErr });
  const [saveTags] = useMutation(M_TAGS, { onCompleted: () => { message.success("บันทึกแท็กแล้ว"); onChanged(); }, onError: onErr });
  const [addNote, { loading: noting }] = useMutation(M_NOTE, {
    onCompleted: () => { message.success("เพิ่มโน้ตแล้ว"); setNote(""); onChanged(); }, onError: onErr,
  });
  const [loadTimeline, { data: tlData, loading: tlLoading }] = useLazyQuery(Q_TIMELINE, { fetchPolicy: "network-only" });

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

  const chatTab = (
    <div>
      <div style={{ maxHeight: 340, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {(conv.messages || []).map((m: Msg) => (
          <div key={m.id} style={{ alignSelf: m.direction === "IN" ? "flex-start" : "flex-end", maxWidth: "75%" }}>
            <div style={{
              background: m.direction === "IN" ? "#f5f5f5" : (m.sender?.startsWith("staff") ? "#e6f4ff" : "#f6ffed"),
              padding: "6px 10px", borderRadius: 8,
            }}>
              {m.body}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {m.sender} · {new Date(m.createdAt).toLocaleString()}
            </Typography.Text>
          </div>
        ))}
        {(conv.messages || []).length === 0 && <Empty description="ยังไม่มีข้อความ" />}
      </div>
      {can("inbox.reply") && (
        <Space.Compact style={{ width: "100%", marginTop: 12 }}>
          <Input.TextArea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="พิมพ์ตอบลูกค้า (LINE จะส่งจริงผ่าน push)" />
          <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!reply.trim()}
            onClick={() => send({ variables: { id: conv.id, body: reply } })}>ส่ง</Button>
        </Space.Compact>
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
