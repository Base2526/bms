"use client";
import { gql, useQuery } from "@apollo/client";
import { Alert, Card, Space, Tag } from "antd";
import { useI18n } from "@/lib/i18nContext";

const Q = gql`query PackageCapacity { bmsEntitlements { capacities { resource used limit source canAdd } } }`;
export default function CapacityNotice() {
  const { t } = useI18n();
  const { data, error, loading } = useQuery(Q, { fetchPolicy: "network-only" });
  const labels: Record<string,string> = { branches:t("package_metrics.branches"), devices:t("package_metrics.devices"), channels:t("package_metrics.channels") };
  return <Card size="small" title={t("package_metrics.capacity")} loading={loading} style={{ marginBottom:16 }}>
    {error ? <Alert closable type="warning" message={t("package_metrics.unavailable")} /> : <Space wrap>
      {(data?.bmsEntitlements?.capacities ?? []).map((r:any) => <Tag key={r.resource} color={r.canAdd ? "blue" : "orange"}>
        {labels[r.resource]}: {r.used} / {r.limit < 0 ? t("admin_billing.unlimited") : r.limit}
        {r.source !== "PLAN" ? ` (${r.source})` : ""}
      </Tag>)}
    </Space>}
    <p>{t("package_metrics.capacity_note")}</p>
  </Card>;
}
