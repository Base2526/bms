import type { UiTranslator } from "./uiText";

/** Delivery-attempt labels only. Unknown provider statuses remain available verbatim. */
export function deliveryStatusLabel(status: string, t: UiTranslator): string {
  const labels: Record<string, string> = {
    PENDING: t("admin_ui.delivery_pending"), SENDING: t("admin_ui.delivery_sending"),
    SENT: t("admin_ui.delivery_sent"), SUCCESS: t("admin_ui.delivery_success"),
    PARTIAL: t("admin_ui.delivery_partial"), FAILED: t("admin_ui.delivery_failed"),
    SKIPPED: t("admin_ui.delivery_skipped"), CANCELLED: t("admin_ui.delivery_cancelled"),
  };
  return Object.hasOwn(labels, status) ? labels[status] : status;
}
