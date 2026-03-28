"use client";

import { gql, useQuery, useMutation, useApolloClient } from "@apollo/client";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  List,
  Card,
  Input,
  Button,
  Space,
  Typography,
  Divider,
  Modal,
  message,
  Dropdown,
  Radio,
  Select,
  Avatar,
  Image,
  Spin,
  Drawer,
  Grid,
  type MenuProps,
} from "antd";
import {
  MoreOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  TeamOutlined,
  RollbackOutlined,
} from "@ant-design/icons";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

import SendMessageSection from "@/components/chat/SendMessageSection";
import { formatTimeAgo } from "@/components/comments/Helper";
import { useGlobalChatStore } from "@/store/globalChatStore";

const { Text } = Typography;
const { useBreakpoint } = Grid;

const MESSAGE_FIELDS = gql`
  fragment MessageFields on Message {
    id
    chat_id
    text
    reply_to_id

    reply_to {
      id
      text
      images {
        id
        url
        file_id
        mime
      }
      sender {
        id
        name
      }
    }

    created_at
    sender {
      id
      name
    }

    myReceipt {
      deliveredAt
      isRead
      readAt
    }

    images {
      id
      url
      mime
      file_id
    }

    readers {
      id
      name
      phone
      email
      created_at
    }
    readersCount
    deleted_at
    is_deleted
  }
`;

// ===== GraphQL =====
const Q_ME = gql`
  query {
    me {
      id
      name
    }
  }
`;

const Q_CHATS = gql`
  query {
    myChats {
      id
      name
      is_group
      created_at
      created_by {
        id
        name
        avatar
      }
      members {
        id
        name
        avatar
      }

      last_message_at
      last_message {
        id
        text
        created_at
        sender {
          id
          name
          avatar
        }
        images {
          id
          url
          file_id
          mime
        }
      }
    }
  }
`;

const Q_MSGS = gql`
  query ($chat_id: ID!, $limit: Int, $offset: Int) {
    messages(chat_id: $chat_id, limit: $limit, offset: $offset) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const Q_USERS = gql`
  query ($q: String) {
    users(search: $q) {
      id
      name
    }
  }
`;

const MUT_DELETE_MSG = gql`
  mutation ($message_id: ID!) {
    deleteMessage(message_id: $message_id)
  }
`;

const MUT_MARK_READ = gql`
  mutation ($message_id: ID!) {
    markMessageRead(message_id: $message_id)
  }
`;

const MUT_MARK_UPTO = gql`
  mutation ($chat_id: ID!, $cursor: String!) {
    markChatReadUpTo(chat_id: $chat_id, cursor: $cursor)
  }
`;

const MUT_SEND = gql`
  mutation (
    $chat_id: ID!
    $text: String!
    $to_user_ids: [ID!]!
    $images: [Upload!]
    $reply_to_id: ID
  ) {
    sendMessage(
      chat_id: $chat_id
      text: $text
      to_user_ids: $to_user_ids
      images: $images
      reply_to_id: $reply_to_id
    ) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const MUT_CREATE = gql`
  mutation ($name: String, $isGroup: Boolean!, $memberIds: [ID!]!) {
    createChat(name: $name, isGroup: $isGroup, memberIds: $memberIds) {
      id
      name
    }
  }
`;

const MUT_ADD = gql`
  mutation ($chat_id: ID!, $user_id: ID!) {
    addMember(chat_id: $chat_id, user_id: $user_id)
  }
`;

const MUT_RENAME = gql`
  mutation ($chat_id: ID!, $name: String!) {
    renameChat(chat_id: $chat_id, name: $name)
  }
`;

const MUT_DELETE = gql`
  mutation ($chat_id: ID!) {
    deleteChat(chat_id: $chat_id)
  }
`;

const SUB = gql`
  subscription ($chat_id: ID!) {
    messageAdded(chat_id: $chat_id) {
      ...MessageFields
    }
  }
  ${MESSAGE_FIELDS}
`;

const SUB_DELETED = gql`
  subscription ($chat_id: ID!) {
    messageDeleted(chat_id: $chat_id)
  }
`;

// รูปแต่ละ tile + loading state
type MessageImageTileProps = {
  src: string;
  aspectRatio: string;
  dimmed?: boolean;
  overlayText?: string | null;
};

function MessageImageTile({
  src,
  aspectRatio,
  dimmed,
  overlayText,
}: MessageImageTileProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        aspectRatio,
        overflow: "hidden",
        background: "var(--app-surface-2)",
      }}
    >
      {loading && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
          }}
        >
          <Spin size="small" />
        </div>
      )}

      {!error && (
        <Image
          src={src}
          alt=""
          preview
          loading="lazy"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: dimmed ? "brightness(0.65)" : "none",
            visibility: loading ? "hidden" : "visible",
          }}
        />
      )}

      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--app-muted)",
          }}
        >
          Failed to load
        </div>
      )}

      {overlayText && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 600,
            color: "#fff",
            zIndex: 3,
          }}
        >
          {overlayText}
        </div>
      )}
    </div>
  );
}

// ===== helper แสดงรูปใน message =====
function renderMessageImages(m: any, isMine: boolean) {
  const imgs = Array.isArray(m.images) ? m.images : [];
  if (!imgs.length) return null;

  const count = imgs.length;
  const getSrc = (img: any) =>
    img?.file_id ? `/api/files/${img.file_id}` : img?.url || "";

  // 1 รูป
  if (count === 1) {
    const img = imgs[0];
    return (
      <div
        style={{
          marginTop: m.text?.trim() ? 8 : 2,
          display: "flex",
          justifyContent: isMine ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            maxWidth: 260,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 2px 10px rgba(var(--app-shadow-rgb),0.22)",
            lineHeight: 0,
          }}
        >
          <MessageImageTile src={getSrc(img)} aspectRatio="4 / 3" />
        </div>
      </div>
    );
  }

  const wrapper = (
    content: React.ReactNode,
    options: { maxWidth?: number } = {}
  ) => (
    <div
      style={{
        marginTop: m.text?.trim() ? 8 : 2,
        display: "flex",
        justifyContent: isMine ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: options.maxWidth ?? 340,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(var(--app-shadow-rgb),0.22)",
          lineHeight: 0,
        }}
      >
        {content}
      </div>
    </div>
  );

  // 2 รูป
  if (count === 2) {
    return wrapper(
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
        }}
      >
        {imgs.map((img: any, index: number) => (
          <MessageImageTile
            key={img.id ?? index}
            src={getSrc(img)}
            aspectRatio="4 / 3"
          />
        ))}
      </div>
    );
  }

  // 3 รูป
  if (count === 3) {
    return wrapper(
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
        }}
      >
        {imgs.map((img: any, index: number) => {
          const isFirst = index === 0;
          return (
            <div
              key={img.id ?? index}
              style={{ gridColumn: isFirst ? "1 / span 2" : "auto" }}
            >
              <MessageImageTile
                src={getSrc(img)}
                aspectRatio={isFirst ? "4 / 3" : "1 / 1"}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // 4 รูป
  if (count === 4) {
    return wrapper(
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
        }}
      >
        {imgs.map((img: any, index: number) => (
          <MessageImageTile
            key={img.id ?? index}
            src={getSrc(img)}
            aspectRatio="1 / 1"
          />
        ))}
      </div>
    );
  }

  // 5+ รูป
  const first = imgs[0];
  const others = imgs.slice(1, 5);
  const extraCount = count - 5;

  return wrapper(
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1.3fr",
        gap: 2,
      }}
    >
      <MessageImageTile src={getSrc(first)} aspectRatio="4 / 3" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 2,
        }}
      >
        {others.map((img: any, index: number) => {
          const isLastTile = index === others.length - 1 && extraCount > 0;
          return (
            <MessageImageTile
              key={img.id ?? index}
              src={getSrc(img)}
              aspectRatio="1 / 1"
              dimmed={isLastTile}
              overlayText={isLastTile ? `+${extraCount}` : null}
            />
          );
        })}
      </div>
    </div>,
    { maxWidth: 360 }
  );
}

type Member = { id: string; name?: string };
type Chat = {
  id: string;
  name: string;
  is_group: boolean;
  created_by?: { id: string; name?: string } | null;
  members?: Member[];
};

// ==== Helpers ====
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(d: Date) {
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function getInitial(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function renderDeliveryTicks(receipt: any) {
  const deliveredAt = receipt?.deliveredAt;
  const isRead = receipt?.isRead;

  let ticks = "✓";
  let color = "var(--app-muted)";

  if (deliveredAt && !isRead) {
    ticks = "✓✓";
  } else if (isRead) {
    ticks = "✓✓";
    color = "#52c41a";
  }

  return (
    <span
      style={{
        fontSize: 11,
        marginLeft: 4,
        color,
      }}
    >
      {ticks}
    </span>
  );
}

const PAGE_SIZE = 30;

function ChatUI() {
  const router = useRouter();
  const client = useApolloClient();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [mode, setMode] = useState<"single" | "group">("single");
  const [groupName, setGroupName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [openEdit, setOpenEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState<{ id: string; name?: string } | null>(null);
  const [replyTarget, setReplyTarget] = useState<any | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(true);

  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);

  // pagination state
  const [msgHasMore, setMsgHasMore] = useState(true);
  const [msgLoadingMore, setMsgLoadingMore] = useState(false);

  const searchParams = useSearchParams();
  const toParam = searchParams.get("to");
  const { data: me } = useQuery(Q_ME);

  const [send] = useMutation(MUT_SEND, {
    update(cache, { data }) {
      const newMsg = data?.sendMessage;
      if (!newMsg) return;

      // ⬇️ สำคัญ: อย่าทับ reply_to ที่ server ส่งมา
      cache.updateQuery<{ messages: any[] }>({
        query: Q_MSGS,
        variables: { chat_id: newMsg.chat_id },
      }, (old) => {
        if (!old) {
          return { messages: [newMsg] };
        }
        const exists = old.messages.some((m) => m.id === newMsg.id);
        if (exists) return old;

        return {
          ...old,
          messages: [
            ...old.messages,
            {
              ...newMsg,
              reply_to_id: newMsg.reply_to_id ?? null,
              reply_to: newMsg.reply_to ?? null,
              myReceipt: newMsg.myReceipt ?? null,
              readers: newMsg.readers ?? [],
              readersCount: newMsg.readersCount ?? 0,
              deleted_at: newMsg.deleted_at ?? null,
              is_deleted: newMsg.is_deleted ?? false,
            },
          ],
        };
      });

      cache.updateQuery<{ myChats: any[] }>({ query: Q_CHATS }, (old) => {
        if (!old) return old;
        return {
          ...old,
          myChats: old.myChats.map((chat) => {
            if (chat.id !== newMsg.chat_id) return chat;

            return {
              ...chat,
              last_message: {
                id: newMsg.id,
                text: newMsg.text,
                created_at: newMsg.created_at,
                sender: newMsg.sender,
                images: newMsg.images ?? [],
              },
              last_message_at: newMsg.created_at,
            };
          }),
        };
      });
    },
    onError(err) {
      console.error("[MUT_SEND]", err);
    },
  });

  const [createChat] = useMutation(MUT_CREATE);
  const [addMember] = useMutation(MUT_ADD);
  const [renameChat] = useMutation(MUT_RENAME, { onError: () => {} });
  const [deleteChat] = useMutation(MUT_DELETE, { onError: () => {} });
  const [markRead] = useMutation(MUT_MARK_READ);
  const [markUpTo] = useMutation(MUT_MARK_UPTO);
  const [deleteMessageMut] = useMutation(MUT_DELETE_MSG, { onError: () => {} });
  const [openMembers, setOpenMembers] = useState(false);

  const handledToRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingOlderRef = useRef(false);
  const lastOlderOffsetRef = useRef(-1);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const lastMsgCountRef = useRef(0);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meId = me?.me?.id;
  const meName = me?.me?.name as string | undefined;

  const setCurrentChat = useGlobalChatStore((s: any) => s.setCurrentChat);
  const clearUnread = useGlobalChatStore((s: any) => s.clearUnread);
  const unreadByChat = useGlobalChatStore((s: any) => s.unreadByChat);

  const {
    data: chats,
    refetch: refetchChats,
    loading: loadingChats,
  } = useQuery(Q_CHATS);

  const {
    data: msgs,
    refetch: refetchMsgs,
    subscribeToMore: subscribeToMoreMsgs,
    loading: loadingMsgs,
    fetchMore,
  } = useQuery(Q_MSGS, {
    skip: !sel,
    variables: { chat_id: sel, limit: PAGE_SIZE, offset: 0 },
    notifyOnNetworkStatusChange: true,
  });

  const { data: users, refetch: refetchUsers } = useQuery(Q_USERS, {
    variables: { q: "" },
  });

  useEffect(() => {
    console.log("[sel] = ", sel);
  }, [sel]);

  useEffect(() => {
    handledToRef.current = false;
  }, [toParam]);

  // mark read up to last
  useEffect(() => {
    if (!sel) return;
    const list = msgs?.messages || [];
    if (list.length > 0) {
      const lastTs = list[list.length - 1].created_at;
      markUpTo({ variables: { chat_id: sel, cursor: lastTs } }).catch(() => {});
    }
  }, [sel, msgs, markUpTo]);

  // subscriptions
  useEffect(() => {
    if (!sel) return;

    const unsubAdded = subscribeToMoreMsgs({
      document: SUB,
      variables: { chat_id: sel },
      updateQuery(prev, { subscriptionData }) {
        const m = subscriptionData.data?.messageAdded;
        if (!m) return prev;

        const exists = prev.messages?.some((x: any) => x.id === m.id);
        if (exists) {
          console.log("⚠ skip duplicate messageFromSub:", m.id);
          return prev;
        }

        client.cache.updateQuery<{ myChats: any[] }>({
          query: Q_CHATS,
        }, (old) => {
          if (!old) return old;

          return {
            ...old,
            myChats: old.myChats.map((chat) => {
              if (chat.id !== m.chat_id) return chat;

              return {
                ...chat,
                last_message: {
                  id: m.id,
                  text: m.text,
                  created_at: m.created_at,
                  sender: m.sender,
                  images: m.images ?? [],
                },
                last_message_at: m.created_at,
              };
            }),
          };
        });

        return {
          ...prev,
          messages: [...(prev.messages || []), m],
        };
      },
    });

    const unsubDeleted = subscribeToMoreMsgs({
      document: SUB_DELETED,
      variables: { chat_id: sel },
      updateQuery(prev, { subscriptionData }) {
        const deletedId = subscriptionData?.data?.messageDeleted;
        if (!deletedId) return prev;
        return {
          ...prev,
          messages: (prev.messages || []).filter(
            (x: any) => x.id !== deletedId
          ),
        };
      },
    });

    return () => {
      if (typeof unsubAdded === "function") unsubAdded();
      if (typeof unsubDeleted === "function") unsubDeleted();
    };
  }, [sel, subscribeToMoreMsgs, client.cache]);

  // ฟังก์ชันเปิดห้อง
  const openChatById = async (id: string) => {
    setSel(id);
    setCurrentChat(id);
    clearUnread(id);
    lastMsgCountRef.current = 0;
    loadingOlderRef.current = false;
    lastOlderOffsetRef.current = -1;
    setReplyTarget(null);
    setMsgHasMore(true);
    await refetchMsgs({ chat_id: id, limit: PAGE_SIZE, offset: 0 });
    if (isMobile) setMobileChatsOpen(false);
  };

  // auto select first chat
  useEffect(() => {
    if (toParam) return;
    if (loadingChats) return;
    const list = chats?.myChats || [];
    if (!sel && list.length > 0) {
      const firstId = list[0].id;
      openChatById(firstId);
    }
  }, [toParam, chats, loadingChats, sel]); // eslint-disable-line

  // handle ?to=
  useEffect(() => {
    const to = toParam;
    const meIdLocal = me?.me?.id;
    const list = chats?.myChats || [];

    if (!to || !meIdLocal) return;
    if (loadingChats) return;
    if (handledToRef.current) return;

    const createOneToOne = async () => {
      try {
        const { data } = await createChat({
          variables: { name: null, isGroup: false, memberIds: [to] },
        });
        const newId = data?.createChat?.id;
        if (newId) {
          await refetchChats();
          await openChatById(newId);
        } else {
          message.error("Cannot create chat");
        }
      } catch (e: any) {
        message.error(e?.message || "Cannot create chat");
      }
    };

    if (list.length === 0) {
      handledToRef.current = true;
      createOneToOne();
      return;
    }

    const existing = list.find((c: any) => {
      if (c.is_group) return false;
      const memberIds = (c.members || []).map((m: any) => m.id);
      const hasMe = memberIds.includes(meIdLocal);
      const hasTo = memberIds.includes(to);
      const creatorMatch =
        c.created_by?.id === meIdLocal || c.created_by?.id === to;
      return (hasMe && hasTo) || (creatorMatch && hasTo);
    });

    handledToRef.current = true;
    if (existing) {
      openChatById(existing.id);
    } else {
      createOneToOne();
    }
  }, [toParam, me, chats, loadingChats, createChat, refetchChats]); // eslint-disable-line

  // existing 1:1
  const existingOneToOnePartnerIds = useMemo(() => {
    const set = new Set<string>();
    const list = chats?.myChats || [];
    if (!meId) return set;
    for (const c of list) {
      if (c.is_group) continue;
      const memberIds = (c.members || []).map((m: any) => m.id);
      if (!memberIds.includes(meId)) continue;
      for (const mid of memberIds) if (mid !== meId) set.add(mid);
    }
    return set;
  }, [chats, meId]);

  const availableUsers = useMemo(() => {
    let arr = (users?.users || []).filter((u: any) => u.id !== meId);
    if (mode === "single") {
      arr = arr.filter((u: any) => !existingOneToOnePartnerIds.has(u.id));
    }
    return arr;
  }, [users, meId, mode, existingOneToOnePartnerIds]);

  const onEdit = (c: any) => {
    if (!c) return;
    setEditTarget({ id: c.id, name: c.name });
    setEditName(c.name || "");
    setOpenEdit(true);
  };

  const onDelete = (c: any) => {
    if (!c) return;
    Modal.confirm({
      title: `Delete chat`,
      content: (
        <>
          คุณต้องการลบห้อง <b>{c.name || (c.is_group ? "(Group)" : "(1:1)")}</b>{" "}
          ใช่ไหม?
        </>
      ),
      okType: "danger",
      onOk: async () => {
        try {
          await deleteChat({ variables: { chat_id: c.id } });
          message.success("Deleted");
          if (sel === c.id) setSel(null);
          refetchChats();
        } catch (e: any) {
          message.error(e.message || "Delete failed");
        }
      },
    });
  };

  const onAddMember = async (c: any) => {
    if (!c) return;
    const pick = await new Promise<string | undefined>((resolve) => {
      let localSel: string[] = [];
      Modal.confirm({
        title: "Add member",
        content: (
          <Select
            style={{ width: "100%" }}
            placeholder="Pick one user"
            options={(users?.users || []).map((u: any) => ({
              value: u.id,
              label: u.name,
            }))}
            onChange={(val) => {
              localSel = Array.isArray(val) ? val : [val];
            }}
            showSearch
          />
        ),
        onOk: () => resolve(localSel[0]),
        onCancel: () => resolve(undefined),
      });
    });
    if (!pick) return;
    try {
      await addMember({ variables: { chat_id: c.id, user_id: pick } });
      message.success("Member added");
      refetchChats();
    } catch (e: any) {
      message.error(e.message || "Add member failed");
    }
  };

  const menuFor = (c: any) => ({
    items: [
      {
        type: "group" as const,
        label: "Group",
        children: [
          { key: "edit", label: "Edit name", onClick: () => onEdit(c) },
          { key: "delete", label: "Delete chat", onClick: () => onDelete(c) },
        ],
      },
      {
        type: "group" as const,
        label: "Members",
        children: [
          { key: "add", label: "Add member", onClick: () => onAddMember(c) },
        ],
      },
    ],
  });

  const onCreateChat = async () => {
    const ids = mode === "single" ? selectedUsers.slice(0, 1) : selectedUsers;
    if (ids.length === 0) {
      message.warning("Please select at least 1 member");
      return;
    }
    await createChat({
      variables: {
        name: mode === "group" ? groupName || null : null,
        isGroup: mode === "group",
        memberIds: ids,
      },
    });
    setOpenCreate(false);
    setGroupName("");
    setSelectedUsers([]);
    message.success("Created");
    refetchChats();
  };

  const chat: Chat | undefined = useMemo(
    () => chats?.myChats?.find((i: any) => i.id === sel),
    [chats, sel]
  );

  const rawMsgs = msgs?.messages || [];
  const messagesList = useMemo(
    () =>
      [...rawMsgs].sort(
        (a: any, b: any) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [rawMsgs]
  );

  const initialLoading = !msgs && loadingMsgs;
  const isEmpty = messagesList.length === 0;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  };

  const loadOlder = async () => {
    if (!sel || msgLoadingMore || !msgHasMore) return;
    if (loadingOlderRef.current) return;

    const el = messagesContainerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    const prevIds = new Set((msgs?.messages || []).map((m: any) => m.id));
    const currentCount = msgs?.messages?.length ?? 0;
    if (currentCount <= 0) return;
    if (lastOlderOffsetRef.current === currentCount) return;

    loadingOlderRef.current = true;
    lastOlderOffsetRef.current = currentCount;
    setMsgLoadingMore(true);

    try {
      const res = await fetchMore({
        variables: {
          chat_id: sel,
          limit: PAGE_SIZE,
          offset: currentCount,
        },
        updateQuery(prev, { fetchMoreResult }) {
          if (!fetchMoreResult || !fetchMoreResult.messages) return prev;
          const older = fetchMoreResult.messages || [];
          if (!older.length) return prev;

          const seen = new Set((prev.messages || []).map((m: any) => m.id));
          const olderUnique = older.filter((m: any) => !seen.has(m.id));
          if (!olderUnique.length) return prev;

          return {
            ...prev,
            messages: [...prev.messages, ...olderUnique],
          };
        },
      });

      const loaded = res?.data?.messages ?? [];
      const newlyMerged = loaded.filter((m: any) => !prevIds.has(m.id));
      if (loaded.length < PAGE_SIZE) {
        setMsgHasMore(false);
      } else if (!newlyMerged.length) {
        setMsgHasMore(false);
      }

      requestAnimationFrame(() => {
        if (!el) return;
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = newScrollHeight - prevScrollHeight;
      });
    } catch (e) {
      console.error("[loadOlder] error", e);
      lastOlderOffsetRef.current = -1;
    } finally {
      setMsgLoadingMore(false);
      loadingOlderRef.current = false;
    }
  };

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const bottomThreshold = 80;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottomNow = distanceFromBottom <= bottomThreshold;
    setIsAtBottom(atBottomNow);
    if (atBottomNow) setHasNewMessages(false);

    const topThreshold = 80;
    if (el.scrollTop <= topThreshold && msgHasMore && !msgLoadingMore) {
      void loadOlder();
    }
  };

  useEffect(() => {
    const root = messagesContainerRef.current;
    const target = topSentinelRef.current;
    if (!sel || !root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void loadOlder();
      },
      {
        root,
        rootMargin: "100px 0px 0px 0px",
        threshold: 0.01,
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [sel, msgHasMore, msgLoadingMore, msgs?.messages?.length]);

  // auto-scroll
  useEffect(() => {
    const list = messagesList;
    const currentCount = list.length;
    const prevCount = lastMsgCountRef.current;

    if (currentCount === 0) {
      lastMsgCountRef.current = 0;
      return;
    }

    const lastMsg = list[list.length - 1];
    const isMineLast = meId && lastMsg?.sender?.id === meId;

    if (prevCount === 0 && currentCount > 0) {
      scrollToBottom("auto");
      lastMsgCountRef.current = currentCount;
      setHasNewMessages(false);
      return;
    }

    if (currentCount > prevCount) {
      if (isMineLast) {
        scrollToBottom(isAtBottom ? "smooth" : "auto");
        setHasNewMessages(false);
      } else if (isAtBottom) {
        scrollToBottom("smooth");
        setHasNewMessages(false);
      } else {
        setHasNewMessages(true);
      }
    }

    lastMsgCountRef.current = currentCount;
  }, [messagesList, meId, isAtBottom]);

  const nameGroup = () => {
    if (!sel || !chat) {
      return "Select a chat";
    }

    if (chat.is_group) {
      const title = chat.name?.trim() || "Group Chat";

      const others = (chat.members || []).filter((m: any) => m.id !== meId);
      const total = others.length;

      const previewNames = others
        .slice(0, 3)
        .map((m: any) => m.name)
        .join(", ");
      const extra = total > 3 ? ` +${total - 3} more` : "";
      const membersText = previewNames + extra;

      const initial = getInitial(title);

      return (
        <Space align="center" size={12}>
          <div
            style={{
              position: "relative",
              display: "inline-block",
            }}
          >
            <Avatar size={32} style={{ background: "var(--app-primary)" }}>
              {initial}
            </Avatar>
            <div
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 18,
                height: 18,
                background: "var(--app-surface)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.22)",
              }}
            >
              <TeamOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
            </div>
          </div>

          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600 }}>{title}</div>
            {membersText && (
              <div style={{ fontSize: 12, color: "var(--app-muted)" }}>{membersText}</div>
            )}
          </div>
        </Space>
      );
    }

    const partner = (chat.members || []).find((m: any) => m.id !== meId);
    const partnerName = partner?.name || "Chat";
    const avatarSrc = (partner as any)?.avatar;
    const initial = getInitial(partnerName);

    return (
      <Link
        href={`/profile/${partner?.id}`}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <Space align="center" style={{ cursor: "pointer" }}>
          <div
            style={{
              position: "relative",
              display: "inline-block",
            }}
          >
            <Avatar size={32} src={avatarSrc} style={{ background: "var(--app-primary)" }}>
              {!avatarSrc && initial}
            </Avatar>

            <div
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 18,
                height: 18,
                background: "var(--app-surface)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.22)",
              }}
            >
              <UserOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
            </div>
          </div>

          <span style={{ fontWeight: 600 }}>{partnerName}</span>
        </Space>
      </Link>
    );
  };

  const sortedChats = useMemo(() => {
    const list = chats?.myChats || [];

    return [...list].sort((a: any, b: any) => {
      const aTime = a.last_message_at
        ? new Date(a.last_message_at).getTime()
        : 0;
      const bTime = b.last_message_at
        ? new Date(b.last_message_at).getTime()
        : 0;

      return bTime - aTime;
    });
  }, [chats]);

  // ใช้ renderItem ร่วมกันทั้ง sidebar / drawer
  const renderChatListItem = (c: any, compact: boolean) => {
    const partnerUser = !c.is_group
      ? (c.members || []).find((m: any) => m.id !== meId) || null
      : null;

    const partnerName = partnerUser?.name || "User";

    const titleText = (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!compact && (c.is_group ? c.name || "Group" : partnerName)}
      </span>
    );

    const last = c.last_message;
    const images = Array.isArray(last?.images) ? last.images : [];

    let lastText = "";

    if (last?.text && last.text.trim()) {
      const t = last.text.trim();
      lastText = t.length > 60 ? t.slice(0, 57) + "…" : t;
    } else if (images.length > 0) {
      lastText =
        images.length === 1 ? "📷 Photo" : `📷 ${images.length} photos`;
    }

    const fallbackDesc = c.is_group
      ? (c.members || [])
          .filter((m: any) => m.id !== meId)
          .map((m: any) => m.name)
          .join(", ")
      : "";

    const lastAtRaw = c.last_message_at || last?.created_at;
    const timeAgo = lastAtRaw ? formatTimeAgo(lastAtRaw) : "";

    const descCore = lastText || fallbackDesc || "";
    const combinedDesc =
      descCore && timeAgo
        ? `${descCore} · ${timeAgo}`
        : descCore || timeAgo;

    const initial = getInitial(c.is_group ? c.name || "G" : partnerName);
    const avatarSrc = c.is_group ? undefined : partnerUser?.avatar || undefined;

    const unread = unreadByChat[c.id] ?? 0;

    return (
      <List.Item
        onClick={() => openChatById(c.id)}
        style={{
          cursor: "pointer",
          background: sel === c.id ? "rgba(var(--app-primary-rgb),0.10)" : "transparent",
          borderRadius: 8,
          marginBottom: 4,
          padding: compact ? "6px 4px" : undefined,
          justifyContent: compact ? "center" : "flex-start",
        }}
        actions={
          compact
            ? undefined
            : [
                <Dropdown key="more" menu={menuFor(c)} trigger={["click"]}>
                  <Button
                    type="text"
                    icon={<MoreOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>,
              ]
        }
      >
        {!compact ? (
          <List.Item.Meta
            avatar={
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                }}
              >
                <Avatar
                  src={avatarSrc}
                  size={42}
                  style={{ background: "var(--app-primary)" }}
                >
                  {!avatarSrc && initial}
                </Avatar>

                {unread > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      padding: "0 4px",
                      background: "#ff4d4f",
                      borderRadius: 999,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.26)",
                      zIndex: 10,
                    }}
                  >
                    {unread > 99 ? "99+" : unread}
                  </div>
                )}

                <div
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 18,
                    height: 18,
                    background: "var(--app-surface)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.22)",
                  }}
                >
                  {c.is_group ? (
                    <TeamOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
                  ) : (
                    <UserOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
                  )}
                </div>
              </div>
            }
            title={titleText}
            description={
              combinedDesc ? (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--app-muted)",
                    display: "inline-block",
                    maxWidth: "100%",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {combinedDesc}
                </span>
              ) : null
            }
          />
        ) : (
          <div
            style={{
              position: "relative",
              display: "inline-block",
            }}
          >
            <Avatar
              src={avatarSrc}
              size={40}
              style={{
                background: sel === c.id ? "var(--app-primary)" : "rgba(var(--app-text-rgb),0.16)",
              }}
            >
              {!avatarSrc && initial}
            </Avatar>

            {unread > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  padding: "0 4px",
                  background: "#ff4d4f",
                  borderRadius: 999,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.26)",
                  zIndex: 10,
                }}
              >
                {unread > 99 ? "99+" : unread}
              </div>
            )}

            <div
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 18,
                height: 18,
                background: "var(--app-surface)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 4px rgba(var(--app-shadow-rgb),0.22)",
              }}
            >
              {c.is_group ? (
                <TeamOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
              ) : (
                <UserOutlined style={{ fontSize: 11, color: "var(--app-primary)" }} />
              )}
            </div>
          </div>
        )}
      </List.Item>
    );
  };

  // ========================= RENDER =========================
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        alignItems: "stretch",
        width: "100%",
        height: "80vh",
        flexDirection: isMobile ? "column" : "row",
        position: "relative",
      }}
    >
      {/* LEFT (desktop only) */}
      {!isMobile && (
        <div
          style={{
            width: leftCollapsed ? 56 : 320,
            transition: "width 0.25s ease",
            flexShrink: 0,
            height: "100%",
          }}
        >
          <Card
            size="small"
            style={{ height: "100%" }}
            bodyStyle={{
              padding: leftCollapsed ? "8px 4px" : 12,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "hidden",
            }}
            title={
              <Space>
                <Button
                  type="text"
                  shape="circle"
                  onClick={() => setLeftCollapsed((v) => !v)}
                  icon={
                    leftCollapsed ? (
                      <MenuUnfoldOutlined />
                    ) : (
                      <MenuFoldOutlined />
                    )
                  }
                />
                {!leftCollapsed && <span>Chats</span>}
              </Space>
            }
            extra={
              !leftCollapsed && (
                <Button
                  size="small"
                  onClick={() => {
                    setOpenCreate(true);
                    refetchUsers({ q: "" });
                  }}
                >
                  +
                </Button>
              )
            }
          >
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                paddingRight: leftCollapsed ? 0 : 4,
              }}
            >
              <List
                size="small"
                dataSource={sortedChats}
                renderItem={(c: any) => renderChatListItem(c, leftCollapsed)}
              />
            </div>
          </Card>
        </div>
      )}

      {/* RIGHT (messages) */}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <Card
          title={nameGroup()}
          extra={
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: [
                  {
                    key: "members",
                    label: "View Members",
                    onClick: () => setOpenMembers(true),
                  },
                  {
                    key: "add",
                    label: "Add Member",
                    onClick: () => onAddMember(chat),
                    disabled: !chat?.is_group,
                  },
                  {
                    key: "rename",
                    label: "Rename Group",
                    onClick: () => onEdit(chat),
                    disabled: !chat?.is_group,
                  },
                  {
                    type: "divider",
                  },
                  {
                    key: "delete",
                    label: "Delete Chat",
                    danger: true,
                    onClick: () => onDelete(chat),
                  },
                ],
              }}
            >
              <Button type="text" icon={<MoreOutlined />} />
            </Dropdown>
          }
          style={{ height: "100%" }}
          bodyStyle={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          {sel && (
            <>
              <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                style={{
                  flex: 1,
                  overflow: "auto",
                  border: "1px solid var(--app-border)",
                  padding: 12,
                  position: "relative",
                  background: "var(--app-bg)",
                }}
              >
                {initialLoading ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Spin tip="Loading messages..." size="large" />
                  </div>
                ) : isEmpty ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text type="secondary">
                      {chat?.is_group
                        ? "No messages in this group yet."
                        : "No messages yet. Say hi!"}
                    </Text>
                  </div>
                ) : (
                  <>
                    <div ref={topSentinelRef} style={{ height: 1 }} />

                    {msgLoadingMore && (
                      <div style={{ textAlign: "center", padding: 8 }}>
                        <Spin size="small" /> Loading older messages...
                      </div>
                    )}

                    {messagesList.map((m: any, idx: number) => {
                      const isMine = meId && m.sender?.id === meId;
                      const createdAt = new Date(m.created_at);
                      const prev = idx > 0 ? messagesList[idx - 1] : null;
                      const prevDate = prev ? new Date(prev.created_at) : null;

                      const showDaySeparator =
                        idx === 0 ||
                        !isSameDay(
                          createdAt,
                          new Date(prev?.created_at || createdAt)
                        );

                      const prevSameSender =
                        prev &&
                        prev.sender?.id === m.sender?.id &&
                        prevDate &&
                        createdAt.getTime() - prevDate.getTime() <
                          5 * 60 * 1000;

                      const isGroupTop = !prevSameSender;
                      const senderName = isMine
                        ? meName || "Me"
                        : m.sender?.name || "—";

                      const baseRadius = 18;
                      const bubbleRadius = {
                        borderTopLeftRadius: isMine
                          ? baseRadius
                          : isGroupTop
                          ? baseRadius
                          : 6,
                        borderTopRightRadius: isMine
                          ? isGroupTop
                            ? baseRadius
                            : 6
                          : baseRadius,
                        borderBottomLeftRadius: baseRadius,
                        borderBottomRightRadius: baseRadius,
                      };

                      const wrapperMarginTop = isGroupTop ? 10 : 2;

                      const hasText =
                        typeof m.text === "string" &&
                        m.text.trim().length > 0;
                      const hasImages =
                        Array.isArray(m.images) && m.images.length > 0;

                      const timeLabel = createdAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      const reply = m.reply_to;
                      const hasReply = !!reply;
                      const replyText =
                        typeof reply?.text === "string" ? reply.text : "";
                      const replyImages: any[] = Array.isArray(reply?.images)
                        ? reply.images
                        : [];

                      const replySenderLabel =
                        reply?.sender?.id === meId
                          ? "You"
                          : reply?.sender?.name || "User";

                      const getReplyImgSrc = (img: any) =>
                        img?.file_id
                          ? `/api/files/${img.file_id}`
                          : img?.url || "";

                      return (
                        <div key={m.id} id={`msg-${m.id}`}>
                          {showDaySeparator && (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                margin: "8px 0 12px",
                              }}
                            >
                              <span
                                style={{
                                  background: "rgba(var(--app-text-rgb),0.06)",
                                  borderRadius: 999,
                                  padding: "2px 12px",
                                  fontSize: 12,
                                  color: "var(--app-muted)",
                                }}
                              >
                                {formatDayLabel(createdAt)}
                              </span>
                            </div>
                          )}

                          <div
                            style={{
                              display: "flex",
                              justifyContent: isMine ? "flex-end" : "flex-start",
                              padding: "2px 0",
                              marginTop: wrapperMarginTop,
                            }}
                            onDoubleClick={() =>
                              markRead({
                                variables: { message_id: m.id },
                              }).catch(() => {})
                            }
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: isMine ? "row-reverse" : "row",
                                alignItems: "flex-end",
                                gap: 8,
                                maxWidth: "70%",
                              }}
                            >
                              {!isMine && isGroupTop && (
                                <Avatar
                                  size={32}
                                  style={{
                                    background: "var(--app-surface-3)",
                                    flexShrink: 0,
                                  }}
                                >
                                  {getInitial(senderName)}
                                </Avatar>
                              )}

                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: isMine ? "flex-end" : "flex-start",
                                  flex: 1,
                                }}
                              >
                                {!isMine && isGroupTop && (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: "var(--app-muted)",
                                      marginBottom: 2,
                                    }}
                                  >
                                    {senderName}
                                  </div>
                                )}

                                {/* Reply block */}
                                {hasReply && (
                                  <div
                                    style={{
                                      marginBottom:
                                        hasText || hasImages ? 6 : 4,
                                      padding: "6px 8px",
                                      borderLeft: `3px solid ${
                                        isMine
                                          ? "rgba(var(--app-text-rgb),0.85)"
                                          : "var(--app-primary)"
                                      }`,
                                      background: isMine
                                        ? "rgba(var(--app-shadow-rgb),0.28)"
                                        : "rgba(var(--app-primary-rgb),0.10)",
                                      borderRadius: 8,
                                      maxWidth: "100%",
                                      cursor: "pointer",
                                    }}
                                    onClick={() => {
                                      const el = document.getElementById(
                                        `msg-${reply.id}`
                                      );
                                      if (el) {
                                        el.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                        });
                                      }
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 500,
                                        marginBottom: 2,
                                        color: isMine
                                          ? "rgba(var(--app-text-rgb),0.92)"
                                          : "var(--app-primary)",
                                      }}
                                    >
                                      {replySenderLabel}
                                    </div>

                                    {replyText && (
                                      <div
                                        style={{
                                          fontSize: 12,
                                          color: isMine
                                            ? "rgba(var(--app-text-rgb),0.86)"
                                            : "rgba(var(--app-text-rgb),0.74)",
                                          whiteSpace: "pre-wrap",
                                          wordBreak: "break-word",
                                          overflow: "hidden",
                                          display: "-webkit-box",
                                          WebkitLineClamp: 2,
                                          WebkitBoxOrient: "vertical",
                                        }}
                                      >
                                        {replyText}
                                      </div>
                                    )}

                                    {replyImages.length > 0 && (
                                      <div
                                        style={{
                                          marginTop: replyText ? 4 : 0,
                                          display: "flex",
                                          gap: 4,
                                        }}
                                      >
                                        {replyImages
                                          .slice(0, 3)
                                          .map((img, i) => {
                                            const extra =
                                              replyImages.length - 3;
                                            const isLast =
                                              i === 2 && extra > 0;
                                            return (
                                              <div
                                                key={img.id ?? i}
                                                style={{
                                                  position: "relative",
                                                  width: 36,
                                                  height: 36,
                                                  borderRadius: 6,
                                                  overflow: "hidden",
                                                  background: "var(--app-surface-3)",
                                                  flexShrink: 0,
                                                }}
                                              >
                                                <Image
                                                  src={getReplyImgSrc(img)}
                                                  alt=""
                                                  preview={false}
                                                  style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    filter:
                                                      isLast && extra > 0
                                                        ? "brightness(0.65)"
                                                        : "none",
                                                  }}
                                                />
                                                {isLast && extra > 0 && (
                                                  <div
                                                    style={{
                                                      position: "absolute",
                                                      inset: 0,
                                                      display: "flex",
                                                      alignItems: "center",
                                                      justifyContent:
                                                        "center",
                                                      background:
                                                        "rgba(var(--app-shadow-rgb),0.45)",
                                                      color: "#fff",
                                                      fontSize: 11,
                                                      fontWeight: 600,
                                                    }}
                                                  >
                                                    +{extra}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {hasText && (
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      background: isMine
                                        ? "var(--app-primary)"
                                        : "var(--app-surface-2)",
                                      color: isMine ? "#fff" : "var(--app-text)",
                                      boxShadow:
                                        "0 2px 6px rgba(var(--app-shadow-rgb),0.10)",
                                      wordBreak: "break-word",
                                      whiteSpace: "pre-wrap",
                                      ...bubbleRadius,
                                    }}
                                  >
                                    {m.text}
                                  </div>
                                )}

                                {hasImages &&
                                  renderMessageImages(m, !!isMine)}

                                <div
                                  style={{
                                    marginTop: 4,
                                    display: "flex",
                                    justifyContent: isMine
                                      ? "flex-end"
                                      : "flex-start",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      fontSize: 11,
                                    }}
                                  >
                                    <span style={{ color: "rgba(var(--app-text-rgb),0.56)" }}>
                                      {timeLabel}
                                    </span>

                                    {isMine ? (
                                      <>
                                        <span style={{ color: "rgba(var(--app-text-rgb),0.56)" }}>
                                          {m?.myReceipt?.isRead
                                            ? "Read"
                                            : m?.myReceipt?.deliveredAt
                                            ? "Delivered"
                                            : "Sent"}
                                          {renderDeliveryTicks(m?.myReceipt)}
                                        </span>
                                        <span style={{ color: "rgba(var(--app-text-rgb),0.50)" }}>
                                          · {m?.readersCount ?? 0} read
                                        </span>
                                      </>
                                    ) : (
                                      <span style={{ color: "rgba(var(--app-text-rgb),0.50)" }}>
                                        {m?.readersCount ?? 0} read
                                      </span>
                                    )}

                                    <span style={{ width: 4 }} />

                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<RollbackOutlined />}
                                      style={{ padding: 0 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setReplyTarget(m);
                                        scrollToBottom("smooth");
                                      }}
                                    />

                                    <Dropdown
                                      trigger={["click"]}
                                      placement={
                                        isMine ? "topRight" : "topLeft"
                                      }
                                      arrow={{ pointAtCenter: true }}
                                      menu={{
                                        items: ([
                                          {
                                            key: "reply",
                                            label: "Reply",
                                            onClick: () => {
                                              setReplyTarget(m);
                                              scrollToBottom("smooth");
                                            },
                                          },
                                          {
                                            key: "forward",
                                            label: "Forward",
                                            disabled: true,
                                          },
                                          {
                                            key: "pin",
                                            label: "Pin",
                                            disabled: true,
                                          },
                                          {
                                            key: "report",
                                            label: "Report",
                                            disabled: true,
                                          },
                                          isMine
                                            ? {
                                                key: "remove",
                                                label: "Remove",
                                                danger: true,
                                                onClick: () => {
                                                  Modal.confirm({
                                                    title:
                                                      "Delete this message?",
                                                    okType: "danger",
                                                    onOk: async () => {
                                                      try {
                                                        await deleteMessageMut(
                                                          {
                                                            variables: {
                                                              message_id: m.id,
                                                            },
                                                            update(cache) {
                                                              cache.updateQuery<{
                                                                messages: any[];
                                                              }>({
                                                                query: Q_MSGS,
                                                                variables: {
                                                                  chat_id: sel,
                                                                },
                                                              }, (old) => {
                                                                if (!old)
                                                                  return old;
                                                                return {
                                                                  ...old,
                                                                  messages:
                                                                    old.messages.filter(
                                                                      (mm) =>
                                                                        mm.id !==
                                                                        m.id
                                                                    ),
                                                                };
                                                              });
                                                            },
                                                          }
                                                        );
                                                      } catch (err: any) {
                                                        message.error(
                                                          err?.message ||
                                                            "Delete failed"
                                                        );
                                                      }
                                                    },
                                                  });
                                                },
                                              }
                                            : null,
                                        ].filter(
                                          Boolean
                                        ) as MenuProps["items"]),
                                      }}
                                    >
                                      <Button
                                        type="text"
                                        size="small"
                                        icon={<MoreOutlined />}
                                        style={{ padding: 0 }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </Dropdown>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!msgHasMore && messagesList.length > 0 && (
                      <div
                        style={{
                          textAlign: "center",
                          padding: "8px 0 10px",
                          fontSize: 12,
                          color: "var(--app-muted)",
                        }}
                      >
                        No older messages
                      </div>
                    )}

                    {isTyping && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-start",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "var(--app-surface-2)",
                            borderRadius: 18,
                            padding: "6px 10px",
                            fontSize: 12,
                            color: "var(--app-muted)",
                          }}
                        >
                          <span>กำลังพิมพ์…</span>
                          <span
                            style={{ display: "inline-flex", gap: 2 }}
                          >
                            <span
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: "50%",
                                background: "var(--app-muted)",
                                opacity: 0.8,
                              }}
                            />
                            <span
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: "50%",
                                background: "var(--app-muted)",
                                opacity: 0.6,
                              }}
                            />
                            <span
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: "50%",
                                background: "var(--app-muted)",
                                opacity: 0.4,
                              }}
                            />
                          </span>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />

                    {hasNewMessages && !isAtBottom && (
                      <div
                        onClick={() => {
                          scrollToBottom("smooth");
                          setHasNewMessages(false);
                        }}
                        style={{
                          position: "absolute",
                          bottom: 16,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--app-primary)",
                          color: "#fff",
                          borderRadius: 999,
                          padding: "4px 12px",
                          boxShadow:
                            "0 2px 8px rgba(var(--app-shadow-rgb),0.22)",
                          cursor: "pointer",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>
                          New messages
                        </span>
                        <span style={{ fontSize: 10 }}>▼</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <SendMessageSection
                chats={chats}
                sel={sel}
                text={text}
                setText={(val) => {
                  setText(val);
                  if (!val) setReplyTarget(null);
                  if (!isTyping) setIsTyping(true);
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                  typingTimeoutRef.current = setTimeout(() => {
                    setIsTyping(false);
                  }, 1500);
                }}
                send={send}
                me={me?.me ?? null}
                replyTarget={replyTarget}
                setReplyTarget={setReplyTarget}
              />
            </>
          )}
        </Card>
      </div>

      {/* FLOATING BUTTON + DRAWER: mobile only */}
      {isMobile && (
        <>
          <Button
            type="primary"
            shape="circle"
            icon={<TeamOutlined />}
            onClick={() => setMobileChatsOpen(true)}
            style={{
              position: "fixed",
              bottom: 80,
              left: 16,
              zIndex: 1100,
              boxShadow: "0 4px 12px rgba(var(--app-shadow-rgb),0.26)",
            }}
          />
          <Drawer
            title={
              <Space>
                <TeamOutlined />
                <span>Chats</span>
              </Space>
            }
            placement="left"
            onClose={() => setMobileChatsOpen(false)}
            open={mobileChatsOpen}
            width={320}
          >
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text strong>Recent Chats</Text>
              <Button
                size="small"
                onClick={() => {
                  setOpenCreate(true);
                  refetchUsers({ q: "" });
                }}
              >
                + New
              </Button>
            </div>
            <List
              size="small"
              dataSource={sortedChats}
              renderItem={(c: any) => renderChatListItem(c, false)}
            />
          </Drawer>
        </>
      )}

      {/* MODALS */}
      <Modal
        open={openCreate}
        title="Create chat"
        onCancel={() => setOpenCreate(false)}
        onOk={onCreateChat}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Radio.Group
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setSelectedUsers([]);
            }}
            options={[
              { label: "Single (1:1)", value: "single" },
              { label: "Group", value: "group" },
            ]}
            optionType="button"
          />

          {mode === "group" && (
            <Input
              placeholder="Group name (optional)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}

          <Select
            mode={mode === "group" ? "multiple" : undefined}
            style={{ width: "100%" }}
            placeholder={mode === "group" ? "Select members" : "Select one user"}
            options={availableUsers.map((u: any) => ({
              value: u.id,
              label: u.name,
            }))}
            value={selectedUsers}
            onChange={(val) =>
              setSelectedUsers(Array.isArray(val) ? val : [val])
            }
            showSearch
            onSearch={(val) => refetchUsers({ q: val })}
            filterOption={false}
          />
        </Space>
      </Modal>

      <Modal
        open={openEdit}
        title="Edit chat name"
        onCancel={() => setOpenEdit(false)}
        onOk={async () => {
          if (!editTarget?.id) return;
          try {
            await renameChat({
              variables: { chat_id: editTarget.id, name: editName || null },
            });
            setOpenEdit(false);
            message.success("Renamed");
            refetchChats();
          } catch (e: any) {
            message.error(e.message || "Rename failed");
          }
        }}
      >
        <Input
          placeholder="Chat name"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
        />
      </Modal>

      {/* MEMBERS MODAL */}
      <Modal
        open={openMembers && !!chat}
        title={
          chat ? `Members (${(chat.members || []).length})` : "Members"
        }
        footer={null}
        onCancel={() => setOpenMembers(false)}
      >
        <List
          dataSource={chat?.members || []}
          renderItem={(m: any) => {
            const isMe = m.id === meId;
            const initial = getInitial(m.name);
            const avatarSrc = m.avatar || undefined;

            return (
              <List.Item
                onClick={() => {
                  setOpenMembers(false);
                  router.push(`/profile/${m.id}`);
                }}
                style={{
                  cursor: "pointer",
                  borderRadius: 6,
                  padding: "6px 8px",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "var(--app-surface-2)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "transparent";
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar src={avatarSrc} style={{ background: "var(--app-primary)" }}>
                      {!avatarSrc && initial}
                    </Avatar>
                  }
                  title={
                    <span>
                      {m.name}{" "}
                      {isMe && (
                        <span
                          style={{ color: "var(--app-muted)", fontSize: 12 }}
                        >
                          (You)
                        </span>
                      )}
                    </span>
                  }
                  description={
                    m.email ||
                    m.phone || (
                      <span style={{ color: "rgba(var(--app-text-rgb),0.55)", fontSize: 12 }}>
                        Click to view profile
                      </span>
                    )
                  }
                />
              </List.Item>
            );
          }}
        />
      </Modal>
    </div>
  );
}

export default function Page() {
  return <ChatUI />;
}
