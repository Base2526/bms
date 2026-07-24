"use client";

import { gql, useSubscription } from "@apollo/client";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { notify } from "@/lib/notify";

const SUB_NOTIFICATION_CREATED = gql`
  subscription { notificationCreated { id title message entity_type data } }
`;

/**
 * แจ้งเตือน browser notification เมื่อถูก @mention ในโน้ตภายในของ Inbox
 * reuse ระบบ notifications เดิม (createNotification + notificationCreated
 * subscription, filter ตาม user_id ที่ resolver ฝั่ง WS ทำอยู่แล้ว) — ตรงนี้
 * กรองเฉพาะ entity_type ของ mention แล้วเด้ง toast/browser notify ต่อ
 * mount แบบ global (SessionLayer.tsx) เหมือน GlobalInboxNotifier
 */
export function GlobalMentionNotifier() {
  const { can, loading: permsLoading } = useBmsPermissions();

  useSubscription(SUB_NOTIFICATION_CREATED, {
    skip: permsLoading || !can("inbox.view"),
    onData: async ({ data }: any) => {
      const n = data?.data?.notificationCreated;
      if (!n || n.entity_type !== "bms_conversation_note_mention") return;

      const conversationId = n.data?.conversationId;
      const result = await notify(n.title || "มีคนกล่าวถึงคุณ", { body: n.message || "", tag: `bms-mention-${n.id}` });
      if (result && conversationId) {
        result.onclick = () => {
          window.focus();
          window.location.href = `/admin/inbox?c=${conversationId}`;
        };
      }
    },
  });

  return null;
}
