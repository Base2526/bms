import { pubsub } from "../../realtime/src/pubsub.js";

import { withFilter } from "graphql-subscriptions";
import { GraphQLError } from "graphql";

import {
  topicMyBankBlockStatusChanged,
  topicMyPhoneBlockStatusChanged,
} from "./blockSync.js";

import { topicMyBookmarkStatusChanged } from "./bookmarkSync.js";
import {
  topicMyContactSpamMarkChanged,
  topicMyContactSpamSettingsChanged,
} from "./contactSpamSync.js";
import {
  topicBmsInboxChanged,
  type BmsInboxChangedPayload,
} from "./bmsInboxSync.js";
import type { RealtimeTicketClaims } from "../../realtime/src/wsTicket.js";
import {
  REALTIME_EVENT_RULES,
  isRealtimeEventEnabled,
  validateRealtimeEvent,
  type RealtimeEvent,
} from "../../realtime/src/events.js";
import { NAMED_REALTIME_SUBSCRIPTIONS } from "../../realtime/src/namedSubscriptions.js";
import { canReceiveRealtimeEvent, realtimeTopics } from "../../realtime/src/subscriptionAuth.js";

const runtimeEnv = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

function requireRealtimeClaims(ctx: any): RealtimeTicketClaims {
  const claims = ctx?.realtime as RealtimeTicketClaims | undefined;
  if (!claims?.subjectId) {
    throw new GraphQLError("UNAUTHENTICATED", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return claims;
}

function requireRealtimeUserId(ctx: any): string {
  return requireRealtimeClaims(ctx).subjectId;
}

function requireBmsTenantId(ctx: any): string {
  const claims = requireRealtimeClaims(ctx);
  if (claims.scope !== "admin" || !claims.tenantId) {
    throw new GraphQLError("FORBIDDEN", { extensions: { code: "FORBIDDEN" } });
  }
  if (!claims.permissions.includes("inbox.view")) {
    throw new GraphQLError("FORBIDDEN", {
      extensions: { code: "FORBIDDEN", permission: "inbox.view" },
    });
  }
  return claims.tenantId;
}

const topicChat = (chat_id: string) => `MSG_CHAT_${chat_id}`;
const topicUser = (user_id: string) => `MSG_USER_${user_id}`;

const topicTime = "TIME_TICK"; 

const NOTI_TOPIC = 'NOTIFICATION_CREATED';

export const COMMENT_ADDED = 'COMMENT_ADDED';
export const COMMENT_UPDATED = 'COMMENT_UPDATED';
export const COMMENT_DELETED = 'COMMENT_DELETED';
export const NOTI_CREATED   = 'NOTI_CREATED';

export const INCOMING_MESSAGE = 'INCOMING_MESSAGE';

export const coreResolvers = {
  Query: { _ok: () => "ok" },
  Mutation: {
    send: async (_: unknown, { text }: { text: string }) => {
      const msg = { id: Date.now().toString(), text, ts: new Date().toISOString() };
      await pubsub.publish('MSG', { messageAdded: msg });

      console.log("[ graphql-core send ]", text);
      return true;
    },
  },
  Subscription: {
    time: {
      subscribe: withFilter(
        (_:any, { }:{ }) =>{
          return  pubsub.asyncIterator(topicTime);
        },
        (payload, variables) => {
          // console.log("[graphql-core withFilter : time] ", payload , variables );
          return payload.time;
        }
      )
    },
    messageAdded: {
      // เดิมรับ chat_id มาแล้ว subscribe ได้เลยโดยไม่ตรวจอะไร — ทุกคนที่ถือ ticket
      // อ่านแชทห้องไหนก็ได้ · ตรวจจากผู้รับที่ติดมากับข้อความ (รูปเดียวกับ
      // `incomingMessage`) เพราะ `apps/ws` ต่อฐานข้อมูลไม่ได้
      subscribe: withFilter(
        (_: any, { chat_id }: { chat_id: string }, ctx: any) => {
          requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicChat(chat_id));
        },
        (payload, variables, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const message = payload?.messageAdded;
          if (message?.chat_id !== variables?.chat_id) return false;
          return Array.isArray(message?.to_user_ids)
            && (message.to_user_ids.map(String).includes(userId)
              || String(message?.sender_id ?? "") === userId);
        }
      )
    },
    userMessageAdded: {
      subscribe: withFilter(
        (_:any, { user_id }:{user_id:string}, ctx: any) => {
          const authenticatedUserId = requireRealtimeUserId(ctx);
          if (String(user_id) !== authenticatedUserId) {
            throw new GraphQLError("FORBIDDEN", { extensions: { code: "FORBIDDEN" } });
          }
          return pubsub.asyncIterator(topicUser(authenticatedUserId));
        },
        (payload, _variables, ctx: any) => {
          const authenticatedUserId = requireRealtimeUserId(ctx);
          return payload?.userMessageAdded?.to_user_ids.includes(authenticatedUserId);
        }
      )
    },
    messageDeleted: {
      subscribe: withFilter(
        (_: any, { chat_id }: { chat_id: string }, ctx: any) => {
          requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicChat(chat_id));
        },
        (payload, _variables, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          if (typeof payload?.messageDeleted !== "string") return false;
          // ผู้รับมาจาก publisher · ไม่มีลิสต์ = ปฏิเสธ ไม่ใช่ปล่อยผ่าน
          return Array.isArray(payload?.messageDeletedAudience)
            && payload.messageDeletedAudience.map(String).includes(userId);
        }
      ),
      // SDL ยังเป็น `ID!` เหมือนเดิม — ลิสต์ผู้รับเป็นของ routing ไม่ใช่ของ client
      resolve: (payload: any) => payload?.messageDeleted,
    },
    notificationCreated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(NOTI_TOPIC),
        (payload: any, _variables: any, ctx: any) => {
          return String(payload?.notificationCreated?.user_id ?? "") === requireRealtimeUserId(ctx);
        }
      ),
    },
    commentAdded: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(COMMENT_ADDED),
        (payload, variables) => {
          // filter ตาม post_id
          return payload.commentAdded.post_id === variables.post_id;
        }
      ),
    },
    commentUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(COMMENT_UPDATED),
        (payload, variables) => {
          return payload.commentUpdated.post_id === variables.post_id;
        }
      ),
    },
    commentDeleted: {
      // เดิมคืน `true` เสมอ = คนที่ดูโพสต์หนึ่งได้รับการลบคอมเมนต์ของทุกโพสต์
      // โพสต์เป็นเนื้อหาสาธารณะ จึงไม่ใช่การรั่วของความลับ แต่เป็น event ที่ผิดโพสต์
      subscribe: withFilter(
        () => pubsub.asyncIterator(COMMENT_DELETED),
        (payload, variables) => String(payload?.commentDeletedPostId ?? "") === String(variables?.post_id ?? ""),
      ),
      resolve: (payload: any) => payload?.commentDeleted,
    },
    incomingMessage: {
      subscribe: withFilter(
        (_: any, { user_id }: { user_id: string }, ctx: any) => {
          const authenticatedUserId = requireRealtimeUserId(ctx);
          if (String(user_id) !== authenticatedUserId) {
            throw new GraphQLError("FORBIDDEN", { extensions: { code: "FORBIDDEN" } });
          }
          return pubsub.asyncIterator(INCOMING_MESSAGE);
        },
        (payload, vars, ctx) => {
          const uId = requireRealtimeUserId(ctx);
          const msg = payload.incomingMessage;
          return msg.to_user_ids.includes(uId) || msg.sender_id === uId;
        }
      ),
    },

    // ============================
    // Realtime multi-device sync
    // Scope: same authenticated user
    // ============================
    myPhoneBlockStatusChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicMyPhoneBlockStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const pUserId = String(payload?.myPhoneBlockStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myBankBlockStatusChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicMyBankBlockStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const pUserId = String(payload?.myBankBlockStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myBookmarkStatusChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicMyBookmarkStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const pUserId = String(payload?.myBookmarkStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myContactSpamMarkChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicMyContactSpamMarkChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const pUserId = String(payload?.myContactSpamMarkChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myContactSpamSettingsChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          return pubsub.asyncIterator(topicMyContactSpamSettingsChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = requireRealtimeUserId(ctx);
          const pUserId = String(payload?.myContactSpamSettingsChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    bmsInboxChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const tenantId = requireBmsTenantId(ctx);
          return pubsub.asyncIterator(topicBmsInboxChanged(tenantId));
        },
        (payload: { bmsInboxChanged?: BmsInboxChangedPayload }, _vars: any, ctx: any) => {
          const tenantId = requireBmsTenantId(ctx);
          return payload?.bmsInboxChanged?.tenantId === tenantId;
        }
      ),
    },
    realtimeEvent: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => pubsub.asyncIterator(realtimeTopics(requireRealtimeClaims(ctx))),
        (payload: { realtimeEvent?: unknown }, _vars: any, ctx: any) => {
          try {
            return canReceiveRealtimeEvent(
              validateRealtimeEvent(payload?.realtimeEvent),
              requireRealtimeClaims(ctx),
            );
          } catch {
            return false;
          }
        },
      ),
    },
    ...namedDomainSubscriptions(),
  },
};

// =============================================================
// Named domain subscriptions (Phase 6)
// -------------------------------------------------------------
// Every named subscription is a filtered view of the one invalidation stream.
// They deliberately share `realtimeTopics` + `canReceiveRealtimeEvent` instead
// of each carrying its own auth: seventeen copies of a tenant/location/
// permission check is seventeen chances for one of them to drift open.
//
// The resolver key is also the payload key, because `withFilter` receives the
// published envelope under the field name the publisher used. The dispatcher
// publishes one wrapper per event, so each named field reads the same
// `realtimeEvent` payload and narrows it by event type.
// =============================================================

function namedDomainSubscriptions() {
  const resolvers: Record<string, unknown> = {};
  for (const [field, eventTypes] of Object.entries(NAMED_REALTIME_SUBSCRIPTIONS)) {
    const accepted = new Set<string>(eventTypes);
    resolvers[field] = {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => pubsub.asyncIterator(realtimeTopics(requireRealtimeClaims(ctx))),
        (payload: any, _vars: any, ctx: any) => {
          try {
            const event = validateRealtimeEvent(payload?.realtimeEvent);
            if (!accepted.has(event.eventType)) return false;
            return canReceiveRealtimeEvent(event, requireRealtimeClaims(ctx));
          } catch {
            return false;
          }
        },
      ),
      // The published wrapper carries the envelope under `realtimeEvent`; the
      // named field resolves to the same object.
      resolve: (payload: any) => payload?.realtimeEvent,
    };
  }
  return resolvers;
}
