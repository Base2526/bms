"use client";
import Link from "next/link";
import { Alert } from "antd";
import { useI18n } from "@/lib/i18nContext";

export type FeatureAccess = { feature: string; minimumPlan: string; allowed: boolean; source: string };
export default function FeatureAccessNotice({ access }: { access?: FeatureAccess }) {
  const { t } = useI18n();
  if (access?.source === "PLAN" || access?.source === "RETAIL_LOCAL") return null;
  const label = access?.feature === "REPORT_SCHEDULE" ? t("admin_billing.feature_report_schedule") : t("admin_billing.feature_retention_engine");
  const text = !access ? t("admin_billing.feature_unavailable") : access.source === "LEGACY"
    ? t("admin_billing.legacy_features", { feature: label }) : access.source === "EXISTING_WORK"
    ? t("admin_billing.existing_work", { feature: label }) : t("admin_billing.feature_locked", { feature: label, plan: access.minimumPlan });
  return <Alert closable data-testid={`feature-access-${access?.feature ?? "loading"}`} showIcon
    type={access?.allowed ? "info" : "warning"} message={text} style={{ marginBottom: 12 }}
    description={access && !access.allowed ? <Link href="/admin/billing">{t("admin_billing.view_packages")}</Link> : undefined} />;
}

export function PlanFeatureList({ features }: { features?: string[] }) {
  const { t } = useI18n();
  if (!features) return null;
  return <div data-testid="plan-feature-list">
    <div>✓ {t("admin_billing.features_core")}</div>
    <div>{features.includes("REPORT_SCHEDULE") ? "✓" : "—"} {t("admin_billing.feature_report_schedule")}</div>
    <div>{features.includes("RETENTION_ENGINE") ? "✓" : "—"} {t("admin_billing.feature_retention_engine")}</div>
  </div>;
}
