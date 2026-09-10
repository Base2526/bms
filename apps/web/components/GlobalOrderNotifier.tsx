"use client";

import { useRef } from "react";
import { gql, useSubscription } from "@apollo/client";
import { Button, notification } from "antd";
import { useRouter } from "next/navigation";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import { notify } from "@/lib/notify";
import { claimStaffAlert } from "@/lib/staffAlertClaim";
import { useI18n } from "@/lib/i18nContext";

const SUB_NOTIFICATION_CREATED = gql`
  subscription { notificationCreated { id title message entity_type data } }
`;

/** Global staff signal for committed order work: toast + browser notification + local sound. */
export function GlobalOrderNotifier() {
  const router = useRouter();
  const { t } = useI18n();
  const { can, loading } = useBmsPermissions();
  // Every destination reads order data, and the server additionally checks the action permission
  // (ship/kitchen) before addressing those notification kinds to this user.
  const enabled = !loading && can("order.view");
  const alerts = useOrderAlerts(enabled);
  const seen = useRef(new Set<string>());

  useSubscription(SUB_NOTIFICATION_CREATED, {
    skip: !enabled,
    onData: async ({ data }: any) => {
      const event = data?.data?.notificationCreated;
      if (!event || event.entity_type !== "bms_order_action" || seen.current.has(event.id)) return;
      seen.current.add(event.id);
      if (seen.current.size > 500) {
        const oldest = seen.current.values().next().value;
        if (oldest) seen.current.delete(oldest);
      }

      const href = typeof event.data?.href === "string" ? event.data.href : "/admin/orders";
      const kind = String(event.data?.kind || "");
      window.dispatchEvent(new CustomEvent("bms:order-action", { detail: event.data }));
      if (!(await claimStaffAlert(`order:${event.id}`))) return;
      alerts.notify(kind === "KITCHEN_TICKETS_CREATED" ? "ORDER_NEW" : "ORDER_ACTION");

      notification.open({
        key: `bms-order-${event.id}`,
        message: event.title,
        description: event.message,
        duration: 10,
        onClick: () => router.push(href),
        btn: <Button type="primary" size="small" onClick={(event) => {
          event.stopPropagation();
          router.push(href);
        }}>{t("order_notifications.open")}</Button>,
      });

      const browser = await notify(event.title || t("order_notifications.fallback_title"), {
        body: event.message || "",
        tag: `bms-order-${event.data?.kind || "action"}-${event.data?.orderId || event.id}`,
      });
      if (browser) {
        browser.onclick = () => {
          window.focus();
          window.location.href = href;
        };
      }
    },
  });

  return null;
}
