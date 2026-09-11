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
import { topicForLocation, topicForTenant, topicForUser } from "../../realtime/src/topics.js";

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

function realtimeTopics(claims: RealtimeTicketClaims): string[] {
  const topics = [topicForUser(claims.tenantId ?? "global", claims.subjectId)];
  if (claims.tenantId) {
    topics.push(topicForTenant(claims.tenantId));
    for (const locationId of claims.locationIds) topics.push(topicForLocation(claims.tenantId, locationId));
  }
  return topics;
}

function canReceiveRealtimeEvent(event: RealtimeEvent, claims: RealtimeTicketClaims): boolean {
  const rule = REALTIME_EVENT_RULES[event.eventType];
  if (!isRealtimeEventEnabled(event.eventType, runtimeEnv)) return false;
  if (event.tenantId !== claims.tenantId) return false;
  if (!rule.permissions.every((permission) => claims.permissions.includes(permission))) return false;
  if (rule.audience === "user") return event.userId === claims.subjectId;
  if (rule.audience === "location") {
    return Boolean(event.locationId) && (claims.allLocations || claims.locationIds.includes(event.locationId!));
  }
  if (rule.audience === "device") {
    return claims.scope === "pos" && event.deviceId === claims.subjectId &&
      Boolean(event.locationId) && claims.locationIds.includes(event.locationId!);
  }
  return rule.audience === "tenant";
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
      subscribe: withFilter(
        (_: any, { chat_id }: { chat_id: string }, ctx: any) => {
          const topic = topicChat(chat_id);
          return pubsub.asyncIterator(topic);
        },
        (payload, variables) => {
          return payload?.messageAdded?.chat_id === variables?.chat_id;
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
        (_:any, { chat_id }:{chat_id:string}) => pubsub.asyncIterator(topicChat(chat_id)),
        (payload) => typeof payload?.messageDeleted === "string"
      )
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
      subscribe: withFilter(
        () => pubsub.asyncIterator(COMMENT_DELETED),
        (payload, variables) => {
          // ตอนนี้ไม่มี post_id ใน payload ถ้าอยาก filter เพิ่ม
          return true;
        }
      ),
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
  },
};
