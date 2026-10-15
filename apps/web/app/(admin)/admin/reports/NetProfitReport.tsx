"use client";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, DatePicker, Descriptions, Modal, Space, Spin, Table, Typography } from "antd";
import { useState } from "react";
import dayjs from "dayjs";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const REPORT = gql`query NetProfitReport($month: String!) {
  bmsNetProfit(month: $month) { status errorCode month observedAt complete truncated eventCount basis costBasis returnBasis expenseBasis
    totals { complete knownSalesRevenue knownReturnRevenue netRevenue knownSalesCost returnQuantityCostBasis netCost grossProfit
      knownOperatingExpense knownGpExpense knownDepreciationExpense knownExpenseTotal expenseTotal netProfit refundCompleted creditReductionCompleted }
    branches { locationId locationName channel bucketOnly sharedBranchCost netRevenue netCost knownExpenseTotal expenseTotal netProfit }
    channels { locationId locationName channel bucketOnly sharedBranchCost netRevenue netCost knownExpenseTotal expenseTotal netProfit }
    issues { code count } samples { key code }
  }
}`;

function Result({ month }: { month: string }) {
  const { t } = useI18n();
  const query = useQuery(REPORT, { variables: { month }, fetchPolicy: "network-only", notifyOnNetworkStatusChange: true });
  const data = query.data?.bmsNetProfit;
  const money = (v: string | null | undefined) => v == null ? t("admin_reports.cost_unknown") : `฿${v}`;
  const fields = [
    ["knownSalesRevenue", t("admin_reports.net_profit_sales")], ["knownReturnRevenue", t("admin_reports.net_profit_returns")],
    ["netRevenue", t("admin_reports.net_profit_revenue")], ["knownSalesCost", t("admin_reports.net_profit_known_cogs")],
    ["returnQuantityCostBasis", t("admin_reports.net_profit_return_cost")], ["netCost", t("admin_reports.net_profit_cogs")],
    ["grossProfit", t("admin_reports.net_profit_gross")], ["knownOperatingExpense", t("admin_reports.net_profit_operating")],
    ["knownGpExpense", t("admin_reports.net_profit_gp")], ["knownDepreciationExpense", t("admin_reports.net_profit_depreciation")],
    ["knownExpenseTotal", t("admin_reports.net_profit_known_expenses")], ["expenseTotal", t("admin_reports.net_profit_expenses")],
    ["netProfit", t("admin_reports.net_profit_net")], ["refundCompleted", t("admin_reports.net_profit_refunds")],
    ["creditReductionCompleted", t("admin_reports.net_profit_credit")],
  ];
  const columns = [
    { title: t("admin_reports.allocation_branch"), dataIndex: "locationName", render: (v: string | null) => v ?? t("admin_reports.cost_unknown") },
    { title: t("admin_reports.allocation_channel"), render: (_: any, r: any) => <>{r.channel ?? t("admin_reports.allocation_all_channels")}
      {r.sharedBranchCost && <div>{t("admin_reports.net_profit_shared")}</div>}</> },
    { title: t("admin_reports.net_profit_revenue"), dataIndex: "netRevenue", render: money },
    { title: t("admin_reports.net_profit_cogs"), dataIndex: "netCost", render: money },
    { title: t("admin_reports.net_profit_known_expenses"), dataIndex: "knownExpenseTotal", render: money },
    { title: t("admin_reports.net_profit_expenses"), dataIndex: "expenseTotal", render: money },
    { title: t("admin_reports.net_profit_net"), dataIndex: "netProfit", render: money },
  ];
  return <>
    <Button style={{ marginBlock: 16 }} loading={query.loading} onClick={() => void query.refetch().catch(() => undefined)}>{t("admin_reports.refresh")}</Button>
    {query.loading ? <Spin /> : query.error || data?.status !== "OK" ?
      <Alert closable type="error" message={t("admin_reports.cost_load_error")} description={query.error?.message ?? data?.errorCode} /> : <>
        <Alert closable type={data.complete ? "success" : "warning"} message={data.complete ? t("admin_reports.net_profit_complete") : t("admin_reports.net_profit_incomplete")} />
        <Typography.Paragraph>{data.month} · {data.observedAt} · {t("admin_reports.net_profit_events")}: {data.eventCount}</Typography.Paragraph>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} items={fields.map(([key, label]) => ({
          key, label, children: <span style={{ whiteSpace: "nowrap" }} data-profit-field={key}>{money(data.totals?.[key])}</span>,
        }))} />
        <Typography.Title level={5}>{t("admin_reports.net_profit_branches")}</Typography.Title>
        <Table size="small" rowKey={(r: any) => JSON.stringify([r.locationId, r.channel])} scroll={{ x: 1100 }} columns={columns.filter((_, i) => i !== 1)} dataSource={data.branches} pagination={{ pageSize: 10 }} />
        <Typography.Title level={5}>{t("admin_reports.net_profit_channels")}</Typography.Title>
        <Typography.Paragraph>{t("admin_reports.net_profit_group_hint")}</Typography.Paragraph>
        <Table size="small" rowKey={(r: any) => JSON.stringify([r.locationId, r.channel])} scroll={{ x: 1300 }} columns={columns} dataSource={data.channels} pagination={{ pageSize: 10 }} />
        <Typography.Title level={5}>{t("admin_reports.net_profit_issues")}</Typography.Title>
        <Typography.Paragraph>{t("admin_reports.net_profit_gap_hint")}</Typography.Paragraph>
        <Table size="small" rowKey="code" scroll={{ x: 480 }} dataSource={data.issues} pagination={{ pageSize: 10 }} columns={[
          { title: t("admin_reports.net_profit_issue_code"), dataIndex: "code" }, { title: t("admin_reports.net_profit_events"), dataIndex: "count" },
        ]} />
        <details><summary>{t("admin_reports.net_profit_samples")}</summary><Table size="small" scroll={{ x: 600 }} pagination={{ pageSize: 10 }}
          rowKey={(r: any) => JSON.stringify([r.key, r.code])} dataSource={data.samples} columns={[
            { title: t("admin_reports.cost_source"), dataIndex: "key" }, { title: t("admin_reports.net_profit_issue_code"), dataIndex: "code" },
          ]} /></details>
      </>}
  </>;
}

function Worksheet() {
  const { t } = useI18n(), [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  return <>
    <Alert closable type="info" showIcon message={t("admin_reports.net_profit_scope")} description={t("admin_reports.net_profit_basis")} />
    <Space style={{ marginTop: 16 }}><DatePicker picker="month" allowClear={false} aria-label={t("admin_reports.cost_month")}
      value={dayjs(`${month}-01`)} onChange={v => { if (v) setMonth(v.format("YYYY-MM")); }} /></Space>
    {/* A month change unmounts the previous query/result; late responses cannot overwrite the new month. */}
    <Result key={month} month={month} />
  </>;
}
export default function NetProfitReport() {
  const { t } = useI18n(), { can } = useBmsPermissions(), [open, setOpen] = useState(false);
  if (!(["report.view", "expense.view", "delivery.settlement.view", "tax.document.view"] as const).every(can)) return null;
  return <Card title={t("admin_reports.net_profit_title")} style={{ marginTop: 16 }}>
    <Typography.Paragraph>{t("admin_reports.net_profit_intro")}</Typography.Paragraph>
    <Button onClick={() => setOpen(true)}>{t("admin_reports.net_profit_open")}</Button>
    <Modal open={open} destroyOnClose footer={null} width={1150} style={{ top: 24 }}
      styles={{ body: { maxHeight: "calc(100dvh - 160px)", overflowY: "auto" } }}
      title={t("admin_reports.net_profit_title")} onCancel={() => setOpen(false)}>
      {open && <Worksheet />}
    </Modal>
  </Card>;
}
