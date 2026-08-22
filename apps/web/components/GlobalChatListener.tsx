"use client";

import { gql, useApolloClient, useQuery, useSubscription } from "@apollo/client";
import { useEffect, useRef } from "react";
import {
  useGlobalChatStore,
  getGlobalChatState,
} from "@/store/globalChatStore";
import { notify } from "@/lib/notify";
import { normalizeBank, normalizeTel } from "@/app/lib/jachoeiLocalState";

// ===== QUERIES =====
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

        audio {
          file_id
          url
          mime
          duration_sec
        }
      }
    }
  }
`;

// ===== SUBSCRIPTIONS =====
const SUB_INCOMING = gql`
  subscription ($user_id: ID!) {
    incomingMessage(user_id: $user_id) {
      id
      chat_id
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

      audio {
        file_id
        url
        mime
        duration_sec
      }
    }
  }
`;

function normalizeIncomingMessage(m: any) {
  if (!m) return null;

  const senderIdRaw = m?.sender?.id;
  const senderId =
    typeof senderIdRaw === "string" || typeof senderIdRaw === "number"
      ? String(senderIdRaw)
      : "";

  const images = Array.isArray(m.images) ? m.images : [];

  const audio = m.audio
    ? {
        __typename: "MessageAudio",
        file_id: m.audio.file_id,
        url: m.audio.url,
        mime: m.audio.mime ?? null,
        duration_sec:
          typeof m.audio.duration_sec === "number" ? m.audio.duration_sec : null,
      }
    : null;

  return {
    __typename: "Message",
    id: m.id,
    chat_id: m.chat_id,
    text: typeof m.text === "string" ? m.text : "",
    created_at: m.created_at,
    sender: senderId
      ? {
          __typename: "User",
          id: senderId,
          name: m?.sender?.name ?? "—",
          avatar: m?.sender?.avatar ?? null,
        }
      : m.sender,
    images: images.map((img: any) => ({
      __typename: "MessageImage",
      id: img.id,
      url: img.url,
      file_id: img.file_id ?? null,
      mime: img.mime ?? null,
    })),
    audio,
  };
}

const SUB_USER_MESSAGE = gql`
  subscription ($user_id: ID!) {
    userMessageAdded(user_id: $user_id) {
      id
      chat_id
      sender {
        id
        name
        phone
        email
      }
      text
      created_at
      to_user_ids
    }
  }
`;

// ===== JACHOEI REALTIME (BLOCK / UNBLOCK) =====
const Q_MY_BLOCKED_PHONE_KEYS = gql`
  query MyBlockedPhoneKeys {
    myBlockedPhoneKeys
  }
`;

const Q_MY_REPORTED_BANK_ACCOUNT_KEYS = gql`
  query MyReportedBankAccountKeys {
    myReportedBankAccountKeys
  }
`;

const SUB_MY_PHONE_BLOCK_STATUS_CHANGED = gql`
  subscription MyPhoneBlockStatusChanged {
    myPhoneBlockStatusChanged {
      user_id
      action
      phone
      phone_normalized
      blocked
      updated_at
    }
  }
`;

const SUB_MY_BANK_BLOCK_STATUS_CHANGED = gql`
  subscription MyBankBlockStatusChanged {
    myBankBlockStatusChanged {
      user_id
      action
      bank_name
      account_norm
      blocked
      updated_at
    }
  }
`;

const SUB_MY_BOOKMARK_STATUS_CHANGED = gql`
  subscription MyBookmarkStatusChanged {
    myBookmarkStatusChanged {
      user_id
      action
      target_type
      target_id
      bookmarked
      updated_at
    }
  }
`;


// ====================================
//     GLOBAL CHAT LISTENER (FINAL)
// ====================================
export function GlobalChatListener() {
  const apolloClient = useApolloClient();
  const { data: meData } = useQuery(Q_ME);
  const meId = meData?.me?.id;

  const incrementUnread = useGlobalChatStore((s: any) => s.incrementUnread);
  const setWindowFocused = useGlobalChatStore((s: any) => s.setWindowFocused);

  // ติดตาม Window Focus → Zustand
  useEffect(() => {
    const onFocus = () => {
      setWindowFocused(true);
      scheduleRefetchMyBookmarks(apolloClient);
    };
    const onBlur = () => setWindowFocused(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [apolloClient, setWindowFocused]);

  // Debounce refetches to avoid duplicate network storms across rapid events.
  const refetchBlockedTelTimer = useRef<number | null>(null);
  const refetchReportedBankTimer = useRef<number | null>(null);
  const refetchMyBookmarksTimer = useRef<number | null>(null);

  const scheduleRefetchBlockedTel = (client: any) => {
    if (refetchBlockedTelTimer.current != null) return;
    refetchBlockedTelTimer.current = window.setTimeout(() => {
      refetchBlockedTelTimer.current = null;
      void client
        .refetchQueries({ include: ["MyBlockedPhoneKeys"] })
        .catch(() => {});
    }, 200);
  };

  const scheduleRefetchReportedBank = (client: any) => {
    if (refetchReportedBankTimer.current != null) return;
    refetchReportedBankTimer.current = window.setTimeout(() => {
      refetchReportedBankTimer.current = null;
      void client
        .refetchQueries({ include: ["MyReportedBankAccountKeys"] })
        .catch(() => {});
    }, 200);
  };

  const scheduleRefetchMyBookmarks = (client: any) => {
    if (refetchMyBookmarksTimer.current != null) return;
    refetchMyBookmarksTimer.current = window.setTimeout(() => {
      refetchMyBookmarksTimer.current = null;
      void client
        .refetchQueries({ include: ["MyBookmarks"] })
        .catch(() => {});
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (refetchBlockedTelTimer.current != null) window.clearTimeout(refetchBlockedTelTimer.current);
      if (refetchReportedBankTimer.current != null) window.clearTimeout(refetchReportedBankTimer.current);
      if (refetchMyBookmarksTimer.current != null) window.clearTimeout(refetchMyBookmarksTimer.current);
    };
  }, []);

  // ===========================================================
  // A) SUB_INCOMING → unread + update last_message list ซ้าย
  // ===========================================================
  useSubscription(SUB_INCOMING, {
    skip: !meId,
    variables: { user_id: meId },
    onData: ({ data, client }) => {
      const m0 = data.data?.incomingMessage;
      const m = normalizeIncomingMessage(m0);
      if (!m) return;

      const state = getGlobalChatState();
      console.log("[SUB_INCOMING]", m, state);

      const isCurrentRoom = state.currentChatId === m.chat_id;
      const isFocused = state.windowFocused;

      if (!(isCurrentRoom && isFocused)) {
        incrementUnread(m.chat_id);

        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "granted") {
            try {
              const hasImages = Array.isArray(m.images) && m.images.length > 0;
              const hasAudio = !!m.audio;
              const body =
                (m.text || "").trim() ||
                (hasAudio ? "ส่งข้อความเสียงมา" : hasImages ? "ส่งรูปภาพมา" : "ส่งข้อความมา");

              new Notification(m.sender?.name || "New message", {
                body,
              });
            } catch (e) {
              console.error("Notification error:", e);
            }
          }
        }
      }

      // อัปเดต sidebar last_message
      client.cache.updateQuery<{ myChats: any[] }>({ query: Q_CHATS }, (old) => {
        if (!old) return old;

        return {
          ...old,
          myChats: old.myChats.map((chat) => {
            if (chat.id !== m.chat_id) return chat;

            return {
              ...chat,
              last_message: {
                __typename: "Message",
                id: m.id,
                text: m.text,
                created_at: m.created_at,
                sender: m.sender,
                images: m.images ?? [],
                audio: m.audio ?? null,
              },
              last_message_at: m.created_at,
            };
          }),
        };
      });
    },
  });

  // ===========================================================
  // B) SUB_USER_MESSAGE → ใช้สำหรับ notify + dispatch event
  // ===========================================================
  useSubscription(SUB_USER_MESSAGE, {
    skip: !meId,
    variables: { user_id: meId },
    onData: async ({ data }) => {
      const msg = data.data?.userMessageAdded;
      if (!msg) return;

      const isChatPage =
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/chat");

      const activeChatId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("chatId")
          : null;

      const isActiveChat = isChatPage && activeChatId === msg.chat_id;

      if (!isActiveChat) {
        await notify("ข้อความใหม่", {
          body: msg.text,
          tag: `chat-${msg.chat_id}`,
        });

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("chat-unread", {
              detail: {
                chatId: msg.chat_id,
                count: 1,
                lastText: msg.text,
              },
            })
          );
        }
      }
    },
  });

  // ===========================================================
  // D) JACHOEI realtime: block/unblock tel (same user)
  // ===========================================================
  useSubscription(SUB_MY_PHONE_BLOCK_STATUS_CHANGED, {
    skip: !meId,
    onData: ({ data, client }) => {
      console.log("[SUB_MY_PHONE_BLOCK_STATUS_CHANGED]", data);
      const p = data.data?.myPhoneBlockStatusChanged;
      if (!p) return;

      const key = normalizeTel(p.phone_normalized || p.phone || "");
      if (key) {
        client.cache.modify({
          id: "ROOT_QUERY",
          fields: {
            myBlockedPhoneKeys(existing: unknown) {
              const current = Array.isArray(existing) ? (existing as string[]) : [];
              const set = new Set(
                current
                  .map((v) => normalizeTel(v))
                  .filter(Boolean)
              );
              if (p.blocked) set.add(key);
              else set.delete(key);
              return Array.from(set).sort();
            },
          },
        });
      }

      scheduleRefetchBlockedTel(client);
    },
    onError: (err) => console.error("[SUB_MY_PHONE_BLOCK_STATUS_CHANGED ERROR]", err),
  });

  // ===========================================================
  // E) JACHOEI realtime: block/unblock bank (same user)
  // ===========================================================
  useSubscription(SUB_MY_BANK_BLOCK_STATUS_CHANGED, {
    skip: !meId,
    onData: ({ data, client }) => {
      console.log("[SUB_MY_BANK_BLOCK_STATUS_CHANGED]", data);
      const p = data.data?.myBankBlockStatusChanged;
      if (!p) return;

      const key = normalizeBank(p.account_norm || "");
      if (key) {
        client.cache.modify({
          id: "ROOT_QUERY",
          fields: {
            myReportedBankAccountKeys(existing: unknown) {
              const current = Array.isArray(existing) ? (existing as string[]) : [];
              const set = new Set(
                current
                  .map((v) => normalizeBank(v))
                  .filter(Boolean)
              );
              if (p.blocked) set.add(key);
              else set.delete(key);
              return Array.from(set).sort();
            },
          },
        });
      }

      scheduleRefetchReportedBank(client);
    },
    onError: (err) => console.error("[SUB_MY_BANK_BLOCK_STATUS_CHANGED ERROR]", err),
  });

  // ===========================================================
  // F) Bookmark realtime: bookmark/unbookmark (same user)
  // ===========================================================
  useSubscription(SUB_MY_BOOKMARK_STATUS_CHANGED, {
    skip: !meId,
    onData: ({ data, client }) => {
      console.log("[SUB_MY_BOOKMARK_STATUS_CHANGED]", data);
      const p = data.data?.myBookmarkStatusChanged;
      if (!p) return;

      const postId = String(p.target_id || "").trim();
      if (postId) {
        const cacheId = client.cache.identify({ __typename: "Post", id: postId });
        if (cacheId) {
          client.cache.modify({
            id: cacheId,
            fields: {
              is_bookmarked() {
                return !!p.bookmarked;
              },
            },
          });
        }
      }

      // Keep bookmarked list membership correct (esp. unbookmark removes row)
      scheduleRefetchMyBookmarks(client);
    },
    onError: (err) => console.error("[SUB_MY_BOOKMARK_STATUS_CHANGED ERROR]", err),
  });

  return null;
}
