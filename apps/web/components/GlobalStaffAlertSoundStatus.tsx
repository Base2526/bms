"use client";

import { Alert, Button } from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useOrderAlerts } from "@/app/hooks/useOrderAlerts";
import { useI18n } from "@/lib/i18nContext";

/** One global recovery prompt for every staff sound consumer on the admin surface. */
export function GlobalStaffAlertSoundStatus() {
  const { t } = useI18n();
  const { can, loading } = useBmsPermissions();
  const enabled = !loading && (can("inbox.view") || can("order.view"));
  const alerts = useOrderAlerts(enabled);
  const previewTone = [
    can("inbox.view") ? alerts.settings.tones.INBOX_MESSAGE : null,
    can("order.view") ? alerts.settings.tones.ORDER_ACTION : null,
    (can("order.view") && can("restaurant.kitchen.update")) ? alerts.settings.tones.ORDER_NEW : null,
  ].find((tone) => tone && tone !== "NONE") || "CHIME";

  if (!enabled || !alerts.blocked) return null;
  return <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2000, width: "min(560px, calc(100vw - 24px))" }}>
    <Alert
      closable
      type="warning"
      showIcon
      message={t("order_notifications.sound_blocked")}
      action={<Button size="small" onClick={() => alerts.preview(previewTone)}>{t("order_notifications.enable_sound")}</Button>}
    />
  </div>;
}
