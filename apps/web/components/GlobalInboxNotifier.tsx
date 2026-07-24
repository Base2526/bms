"use client";

import { gql, useLazyQuery, useSubscription } from "@apollo/client";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { notify } from "@/lib/notify";
import { getGlobalInboxState } from "@/store/globalInboxStore";

const SUB_INBOX_CHANGED = gql`
  subscription { bmsInboxChanged { conversationId kind occurredAt } }
`;
const Q_CONV_LOOKUP = gql`
  query BmsInboxNotifyLookup($id: ID!) {
    bmsConversation(id: $id) { id customerName unread lastMessage }
  }
`;

/**
 * แจ้งเตือน browser notification เมื่อมีข้อความใหม่เข้า Inbox ขณะที่แอดมินไม่ได้เปิดดูแชทนั้นอยู่
 * mount แบบ global (SessionLayer.tsx) ไม่ใช่แค่ตอนอยู่หน้า /admin/inbox
 */
export function GlobalInboxNotifier() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const [fetchConv] = useLazyQuery(Q_CONV_LOOKUP, { fetchPolicy: "network-only" });

  useSubscription(SUB_INBOX_CHANGED, {
    skip: permsLoading || !can("inbox.view"),
    onData: async ({ data }: any) => {
      const ev = data?.data?.bmsInboxChanged;
      if (!ev || ev.kind !== "MESSAGES_CHANGED") return;
      if (getGlobalInboxState().activeConversationId === ev.conversationId) return;

      let res;
      try {
        res = await fetchConv({ variables: { id: ev.conversationId } });
      } catch {
        return; // เช่น Sales เจอ 403 เพราะไม่ใช่แชทของตัวเอง — ข้ามเงียบๆ
      }
      const conv = res?.data?.bmsConversation;
      if (!conv || !conv.unread) return;

      const n = await notify(conv.customerName || "ข้อความใหม่ในกล่องข้อความ", {
        body: conv.lastMessage || "",
        tag: `bms-inbox-${conv.id}`,
      });
      if (n) {
        n.onclick = () => {
          window.focus();
          window.location.href = `/admin/inbox?c=${conv.id}`;
        };
      }
    },
  });

  return null;
}
