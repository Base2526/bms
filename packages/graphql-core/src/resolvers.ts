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
          // console.log("[SUB INIT] subscribe chat_id=", chat_id, "topic=", topic, "ctx=", ctx);
          return pubsub.asyncIterator(topic);
        },
        (payload, variables, ctx: any) => {
          console.log("[graphql-core withFilter : messageAdded] ", payload?.messageAdded, variables?.chat_id, ctx);
          return payload?.messageAdded?.chat_id === variables?.chat_id;
        }
      )
    },
    userMessageAdded: {
      subscribe: withFilter(
        (_:any, { user_id }:{user_id:string}) => pubsub.asyncIterator(topicUser(user_id)),
        (payload, variables) => {
          console.log("[graphql-core withFilter : userMessageAdded]");
          return payload?.userMessageAdded?.to_user_ids.includes(variables?.user_id);
        }
      )
    },
    messageDeleted: {
      subscribe: withFilter(
        (_:any, { chat_id }:{chat_id:string}) => pubsub.asyncIterator(topicUser(chat_id)),
        (payload, variables) => {
          console.log("[graphql-core withFilter : messageDeleted]");
          return payload.asyncIterator(topicChat(variables?.chat_id));
        }
      )
    },
    notificationCreated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(NOTI_TOPIC),
        (payload: any, _variables: any, ctx: any) => {
          const user = ctx.user;
          if (!user) return false;
          // รับเฉพาะ noti ที่ส่งให้ user นี้
          return payload.notificationCreated.user_id === user.id;
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
        () => pubsub.asyncIterator(INCOMING_MESSAGE),
        (payload, vars, ctx) => {
          // ให้เฉพาะคนที่เป็น member หรือ to_user_ids มี user นี้

          console.log("[INCOMING_MESSAGE] =", vars, payload);
          
          const uId = vars.user_id;
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
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          if (!userId) {
            throw new GraphQLError("UNAUTHENTICATED", { extensions: { code: "UNAUTHENTICATED" } });
          }
          return pubsub.asyncIterator(topicMyPhoneBlockStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          const pUserId = String(payload?.myPhoneBlockStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myBankBlockStatusChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          if (!userId) {
            throw new GraphQLError("UNAUTHENTICATED", { extensions: { code: "UNAUTHENTICATED" } });
          }
          return pubsub.asyncIterator(topicMyBankBlockStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          const pUserId = String(payload?.myBankBlockStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myBookmarkStatusChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          if (!userId) {
            throw new GraphQLError("UNAUTHENTICATED", { extensions: { code: "UNAUTHENTICATED" } });
          }
          return pubsub.asyncIterator(topicMyBookmarkStatusChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          const pUserId = String(payload?.myBookmarkStatusChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myContactSpamMarkChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          if (!userId) {
            throw new GraphQLError("UNAUTHENTICATED", { extensions: { code: "UNAUTHENTICATED" } });
          }
          return pubsub.asyncIterator(topicMyContactSpamMarkChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          const pUserId = String(payload?.myContactSpamMarkChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },

    myContactSpamSettingsChanged: {
      subscribe: withFilter(
        (_: any, _args: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          if (!userId) {
            throw new GraphQLError("UNAUTHENTICATED", { extensions: { code: "UNAUTHENTICATED" } });
          }
          return pubsub.asyncIterator(topicMyContactSpamSettingsChanged(userId));
        },
        (payload: any, _vars: any, ctx: any) => {
          const userId = String(ctx?.user?.id ?? ctx?.user?.author_id ?? ctx?.user?.user_id ?? "").trim();
          const pUserId = String(payload?.myContactSpamSettingsChanged?.user_id || "").trim();
          return !!userId && !!pUserId && userId === pUserId;
        }
      ),
    },
  },
};