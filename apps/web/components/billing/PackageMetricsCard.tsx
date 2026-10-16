"use client";
import { useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Table } from "antd";
import { useI18n } from "@/lib/i18nContext";

const Q = gql`query PackageMetrics($from:String!,$to:String!) {
  bmsPackageMetrics(from:$from,to:$to) { available from to untrackedTenants
    cohorts { kind shops converted conversionRate }
    costs { tenantId source providerCalls unpricedProviderCalls knownCostUsd }
  }
}`;
export default function PackageMetricsCard() {
  const { t } = useI18n();
  const [window, setWindow] = useState(() => ({ from: new Date(Date.now()-30*86400000).toISOString(), to:new Date().toISOString() }));
  const { data, error, loading } = useQuery(Q, { variables: window, fetchPolicy: "network-only" });
  const m = data?.bmsPackageMetrics;
  return <Card title={t("package_metrics.title")} size="small" style={{marginBottom:16}}
    extra={<Button onClick={() => setWindow({ from:new Date(Date.now()-30*86400000).toISOString(), to:new Date().toISOString() })}>{t("admin_tenants.refresh")}</Button>}>
    <Alert closable type="info" showIcon message={t("package_metrics.note")} style={{marginBottom:12}} />
    {error || m?.available === false ? <Alert closable type="warning" message={t("package_metrics.unavailable")} /> : <>
      <p>{t("package_metrics.untracked")}: {m?.untrackedTenants ?? "—"}</p>
      <Table size="small" rowKey="kind" pagination={false} loading={loading} dataSource={m?.cohorts ?? []} scroll={{x:500}} columns={[
        {title:t("package_metrics.cohort"),dataIndex:"kind",render:(v:string)=>v==="SIGNUP"?t("package_metrics.signup"):t("package_metrics.baseline")},
        {title:t("package_metrics.shops"),dataIndex:"shops"},
        {title:t("package_metrics.converted"),dataIndex:"converted"},
        {title:"%",dataIndex:"conversionRate",render:(v:number|null)=>v==null?"—":`${(v*100).toFixed(1)}%`},
      ]} />
      <Table size="small" rowKey={(r:any)=>`${r.tenantId}/${r.source}`} pagination={{pageSize:10}} loading={loading}
        dataSource={m?.costs ?? []} scroll={{x:720}} columns={[
          {title:t("package_metrics.shop_id"),dataIndex:"tenantId"},
          {title:"Shared / BYOK",dataIndex:"source"},
          {title:t("package_metrics.calls"),dataIndex:"providerCalls"},
          {title:t("package_metrics.unpriced"),dataIndex:"unpricedProviderCalls"},
          {title:t("package_metrics.known_cost"),dataIndex:"knownCostUsd",render:(v:number|null)=>v==null?t("package_metrics.unknown"):`$${v.toFixed(6)}`},
        ]} />
    </>}
  </Card>;
}
