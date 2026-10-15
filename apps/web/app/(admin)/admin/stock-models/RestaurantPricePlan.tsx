"use client";
import { gql, useApolloClient } from "@apollo/client";
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";
const QUERY = gql`query RestaurantPricePlan($input: BmsRestaurantPricePlanInput!) {
  bmsRestaurantPricePlan(input: $input) { status errorCode
    estimate { recipeId recipeVersion calculatedAt status totalUnitCost }
    scenarios { label status customerTotal netRevenue outputVat gpAmount variableUnitCost contribution
      contributionMarginPercent breakEvenUnits breakEvenCustomerSales targetDailyUnits projectedDailyProfit targetPrice targetPriceStatus }
  }
}`;
export default function RestaurantPricePlan({ recipeId }: { recipeId: string }) {
  const { t } = useI18n();
  const client = useApolloClient();
  const [result, setResult] = useState<any>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const blank = () => ({ vatMode: "NONE", vatPercent: 0, gpPercent: 0, gpBasis: "NET_REVENUE", extraUnitCost: 0 });
  const states: Record<string, string> = { COMPLETE: t("restaurant_price_plan.complete"), INCOMPLETE_COST: t("restaurant_price_plan.missing_cost"),
    INCOMPLETE_FIXED_COST: t("restaurant_price_plan.missing_fixed"), NON_POSITIVE_CONTRIBUTION: t("restaurant_price_plan.non_positive"),
    UNREACHABLE: t("restaurant_price_plan.unreachable"), NOT_REQUESTED: t("restaurant_price_plan.not_requested") };
  const show = (value: number | null, suffix = "") => value == null ? t("restaurant_price_plan.unknown") : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
  const numericFields = [
    { name: "price", label: t("restaurant_price_plan.price"), max: 1_000_000_000, required: true },
    { name: "vatPercent", label: t("restaurant_price_plan.vat_rate"), max: 100, required: true },
    { name: "gpPercent", label: t("restaurant_price_plan.gp_rate"), max: 100, required: true },
    { name: "extraUnitCost", label: t("restaurant_price_plan.extra"), max: 1_000_000_000, required: true },
    { name: "expectedDailyUnits", label: t("restaurant_price_plan.units"), max: 1_000_000, required: false },
    { name: "targetMarginPercent", label: t("restaurant_price_plan.target_margin"), max: 99.99, required: false },
  ];
  async function calculate(values: any) {
    setResult(null); setError(null); setLoading(true);
    try {
      const response = await client.query({ query: QUERY, fetchPolicy: "no-cache", variables: { input: {
        recipeId, assumptionSource: values.assumptionSource, dailyFixedCost: values.dailyFixedCost ?? null, dailyTargetProfit: values.dailyTargetProfit,
        scenarios: values.scenarios.map((s: any) => ({ label: s.label, price: s.price, vatMode: s.vatMode, vatPercent: s.vatPercent,
          gpPercent: s.gpPercent, gpBasis: s.gpBasis, extraUnitCost: s.extraUnitCost,
          expectedDailyUnits: s.expectedDailyUnits ?? null, targetMarginPercent: s.targetMarginPercent ?? null })),
      } } });
      const data = response.data.bmsRestaurantPricePlan;
      if (data.status !== "OK") setError(data.errorCode ?? data.status); else setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : "ERROR"); }
    finally { setLoading(false); }
  }
  return <>
    <Alert closable showIcon type="info" message={t("restaurant_price_plan.scope")} description={t("restaurant_price_plan.basis")} style={{ marginBottom: 16 }} />
    <Form layout="vertical" disabled={loading} initialValues={{ dailyTargetProfit: 0, scenarios: [blank()] }}
      onFinish={values => void calculate(values)} onValuesChange={() => { setResult(null); setError(null); }}>
      <Form.Item name="assumptionSource" label={t("restaurant_price_plan.source")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      <Space wrap align="start">
        <Form.Item name="dailyFixedCost" label={t("restaurant_price_plan.fixed")}><InputNumber min={0} max={1_000_000_000} precision={2} /></Form.Item>
        <Form.Item name="dailyTargetProfit" label={t("restaurant_price_plan.target_profit")} rules={[{ required: true }]}><InputNumber min={0} max={1_000_000_000} precision={2} /></Form.Item>
      </Space>
      <Form.List name="scenarios">{(fields, { add, remove }) => <>
        {fields.map(field => <Card key={field.key} size="small" style={{ marginBottom: 12 }} title={`${t("restaurant_price_plan.scenario")} ${field.name + 1}`}
          extra={fields.length > 1 && <Button onClick={() => remove(field.name)}>{t("restaurant_price_plan.remove")}</Button>}>
          <Form.Item name={[field.name, "label"]} label={t("restaurant_price_plan.label")} rules={[{ required: true, whitespace: true, max: 60 }]}><Input maxLength={60} /></Form.Item>
          <Space wrap align="start">
            <Form.Item name={[field.name, "vatMode"]} label={t("restaurant_price_plan.vat_mode")} rules={[{ required: true }]}><Select style={{ width: 180 }} options={[
              { value: "NONE", label: t("restaurant_price_plan.vat_none") }, { value: "INCLUSIVE", label: t("restaurant_price_plan.vat_inclusive") }, { value: "EXCLUSIVE", label: t("restaurant_price_plan.vat_exclusive") },
            ]} /></Form.Item>
            <Form.Item name={[field.name, "gpBasis"]} label={t("restaurant_price_plan.gp_basis")} rules={[{ required: true }]}><Select style={{ width: 180 }} options={[
              { value: "NET_REVENUE", label: t("restaurant_price_plan.net") }, { value: "CUSTOMER_TOTAL", label: t("restaurant_price_plan.gross") },
            ]} /></Form.Item>
            {numericFields.map(item => <Form.Item key={item.name} name={[field.name, item.name]} label={item.label} rules={[{ required: item.required }]}>
              <InputNumber min={0} max={item.max} precision={item.name === "expectedDailyUnits" ? 0 : 2} />
            </Form.Item>)}
          </Space>
        </Card>)}
        <Button disabled={loading || fields.length >= 12} onClick={() => add(blank())}>{t("restaurant_price_plan.add")}</Button>
      </>}</Form.List>
      <Button type="primary" htmlType="submit" loading={loading} style={{ margin: 12 }}>{t("restaurant_price_plan.calculate")}</Button>
    </Form>
    {error && <Alert closable type="error" showIcon message={t("restaurant_price_plan.error")} description={error} />}
    {result && <section aria-label={t("restaurant_price_plan.results")}>
      <Typography.Paragraph type="secondary">{t("restaurant_price_plan.rounding")}</Typography.Paragraph>
      <Typography.Paragraph>{t("restaurant_price_plan.observation")}: v{result.estimate.recipeVersion} · {result.estimate.calculatedAt}<br />
        {t("restaurant_price_plan.cost")}: {show(result.estimate.totalUnitCost, " THB")}</Typography.Paragraph>
      {result.scenarios.map((row: any) => <Card key={row.label} title={row.label} style={{ marginBottom: 12 }}>
        <Alert closable type={row.status === "COMPLETE" ? "info" : "warning"} message={states[row.status] ?? row.status} />
        <dl style={{ overflowWrap: "anywhere" }}>{[
          [t("restaurant_price_plan.gross"), show(row.customerTotal, " THB")], [t("restaurant_price_plan.net"), show(row.netRevenue, " THB")],
          [t("restaurant_price_plan.vat_amount"), show(row.outputVat, " THB")], [t("restaurant_price_plan.gp_amount"), show(row.gpAmount, " THB")],
          [t("restaurant_price_plan.variable"), show(row.variableUnitCost, " THB")], [t("restaurant_price_plan.contribution"), show(row.contribution, " THB")],
          [t("restaurant_price_plan.margin"), show(row.contributionMarginPercent, "%")], [t("restaurant_price_plan.break_even"), show(row.breakEvenUnits)],
          [t("restaurant_price_plan.break_sales"), show(row.breakEvenCustomerSales, " THB")], [t("restaurant_price_plan.target_units"), show(row.targetDailyUnits)],
          [t("restaurant_price_plan.projected"), show(row.projectedDailyProfit, " THB")],
          [t("restaurant_price_plan.target_price"), `${show(row.targetPrice, " THB")} · ${states[row.targetPriceStatus] ?? row.targetPriceStatus}`],
        ].map(([label, value]) => <div key={label} style={{ marginBlock: 8 }}><dt>{label}</dt><dd style={{ marginInlineStart: 0, fontWeight: 600 }}>{value}</dd></div>)}</dl>
      </Card>)}
    </section>}
  </>;
}
