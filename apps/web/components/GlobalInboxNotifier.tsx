"use client";

import { useRef } from "react";
import { gql, useLazyQuery, useSubscription } from "@apollo/client";
import { Button, notification } from "antd";
import { useRouter } from "next/navigation";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import { useI18n } from "@/lib/i18nContext";
import { notify } from "@/lib/notify";
import { claimStaffAlert } from "@/lib/staffAlertClaim";
import { getGlobalInboxState } from "@/store/globalInboxStore";

const SUB_INBOX_CHANGED = gql`
  subscription { bmsInboxChanged { conversationId kind messageSource messageId occurredAt } }
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
  const router = useRouter();
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const enabled = !permsLoading && can("inbox.view");
  const alerts = useOrderAlerts(enabled);
  const seen = useRef(new Set<string>());
  const processing = useRef(new Set<string>());
  const [fetchConv] = useLazyQuery(Q_CONV_LOOKUP, { fetchPolicy: "network-only" });

  useSubscription(SUB_INBOX_CHANGED, {
    skip: !enabled,
    onData: async ({ data }: any) => {
      const ev = data?.data?.bmsInboxChanged;
      if (!ev || ev.kind !== "MESSAGES_CHANGED") return;
      // Fail closed: an event without a trustworthy source may refresh the Inbox UI, but must not
      // make staff hear a false customer alert. Diagnostic traffic also stays silent for coworkers.
      if (ev.messageSource !== "customer") return;
      if (getGlobalInboxState().activeConversationId === ev.conversationId) return;

      const eventKey = `${ev.conversationId}:${ev.messageId || ev.occurredAt}`;
      if (seen.current.has(eventKey) || processing.current.has(eventKey)) return;
      processing.current.add(eventKey);

      let res;
      try {
        res = await fetchConv({ variables: { id: ev.conversationId } });
      } catch {
        processing.current.delete(eventKey);
        return; // เช่น Sales เจอ 403 เพราะไม่ใช่แชทของตัวเอง — ข้ามเงียบๆ
      }
      const conv = res?.data?.bmsConversation;
      if (!conv || !conv.unread) {
        processing.current.delete(eventKey);
        return;
      }
      seen.current.add(eventKey);
      processing.current.delete(eventKey);
      if (seen.current.size > 200) {
        const oldest = seen.current.values().next().value;
        if (oldest) seen.current.delete(oldest);
      }
      if (!(await claimStaffAlert(`inbox:${eventKey}`))) return;

      const href = `/admin/inbox?c=${encodeURIComponent(conv.id)}`;
      const title = conv.customerName || t("order_notifications.inbox_fallback_title");
      alerts.notify("INBOX_MESSAGE");
      notification.open({
        key: `bms-inbox-${eventKey}`,
        message: title,
        description: conv.lastMessage || "",
        duration: 10,
        onClick: () => router.push(href),
        btn: <Button type="primary" size="small" onClick={(event) => {
          event.stopPropagation();
          router.push(href);
        }}>{t("order_notifications.open_inbox")}</Button>,
      });

      const n = await notify(title, {
        body: conv.lastMessage || "",
        tag: `bms-inbox-${conv.id}`,
      });
      if (n) {
        n.onclick = () => {
          window.focus();
          window.location.href = href;
        };
      }
    },
  });

  return null;
}
