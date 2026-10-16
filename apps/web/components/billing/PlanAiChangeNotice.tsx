"use client";

import { useI18n } from "@/lib/i18nContext";

/** Only renders the pending allowance and effective time supplied by the server. */
export default function PlanAiChangeNotice({ plan }: {
  plan: { ai_credits_next_monthly?: number | null; ai_credits_change_at?: string | null };
}) {
  const { t, lang } = useI18n();
  if (plan.ai_credits_next_monthly == null || !plan.ai_credits_change_at) return null;
  const date = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "short", day: "numeric",
  }).format(new Date(plan.ai_credits_change_at));
  return <div data-testid="plan-ai-change" style={{ fontSize: 13, marginTop: 8 }}>
    {t("admin_billing.scheduled_points", { count: plan.ai_credits_next_monthly.toLocaleString("en-US"), date })}
  </div>;
}
