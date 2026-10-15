"use client";
import { gql, useApolloClient } from "@apollo/client";
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useI18n } from "@/lib/i18nContext";
const QUERY = gql`query RestaurantMenuPlan($input: BmsRestaurantMenuPlanInput!) {
  bmsRestaurantMenuPlan(input: $input) { status errorCode
    estimates { recipeId recipeVersion calculatedAt status totalUnitCost }
    analysis { status totalUnits popularityThresholdPercent contributionThreshold totalContribution projectedProfit
      rows { recipeId label units classification popularityPercent price { contribution customerTotal netRevenue outputVat gpAmount variableUnitCost targetPrice targetPriceStatus } }
      bundle { recipeCost baselineCustomerTotal baselineContribution customerSavings contributionDelta
        price { status customerTotal netRevenue outputVat gpAmount variableUnitCost contribution contributionMarginPercent
          breakEvenUnits targetDailyUnits projectedDailyProfit targetPrice targetPriceStatus } }
    }
  }
}`;
export default function RestaurantMenuPlan({ recipeSelect }: { recipeSelect: () => ReactElement }) {
  const { t } = useI18n(), client = useApolloClient();
  const [result, setResult] = useState<any>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const requestRevision = useRef(0);
  // Closing the modal invalidates all callbacks, including errors and loading cleanup.
  useEffect(() => () => { requestRevision.current++; }, []);
  function invalidateResult() {
    requestRevision.current++;
    setResult(null); setError(null); setLoading(false);
  }
  const bundleEnabled = Form.useWatch("bundleEnabled", form);
  const blank = () => ({ vatMode: "NONE", vatPercent: 0, gpPercent: 0, gpBasis: "NET_REVENUE", extraUnitCost: 0 });
  const amount = (value: number | null | undefined) => value == null ? t("restaurant_price_plan.unknown") : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const state: Record<string, string> = {
    COMPLETE: t("restaurant_price_plan.complete"), INCOMPLETE_COST: t("restaurant_price_plan.missing_cost"),
    INCOMPLETE_FIXED_COST: t("restaurant_price_plan.missing_fixed"), NON_POSITIVE_CONTRIBUTION: t("restaurant_price_plan.non_positive"),
    INCOMPLETE_DEMAND: t("restaurant_menu_plan.missing_demand"), NO_DEMAND: t("restaurant_menu_plan.no_demand"),
    STAR: t("restaurant_menu_plan.star"), PLOWHORSE: t("restaurant_menu_plan.plowhorse"), PUZZLE: t("restaurant_menu_plan.puzzle"),
    DOG: t("restaurant_menu_plan.dog"), UNCLASSIFIED: t("restaurant_menu_plan.unclassified"),
    UNREACHABLE: t("restaurant_price_plan.unreachable"), NOT_REQUESTED: t("restaurant_price_plan.not_requested"),
  };
  const scenarioFields = (path: (string | number)[]) => <>
    <Form.Item name={[...path, "label"]} label={t("restaurant_price_plan.label")} rules={[{ required: true, whitespace: true, max: 60 }]}><Input maxLength={60} /></Form.Item>
    <Space wrap align="start">
      <Form.Item name={[...path, "vatMode"]} label={t("restaurant_price_plan.vat_mode")} rules={[{ required: true }]}><Select style={{ width: 180 }} options={[
        { value: "NONE", label: t("restaurant_price_plan.vat_none") }, { value: "INCLUSIVE", label: t("restaurant_price_plan.vat_inclusive") }, { value: "EXCLUSIVE", label: t("restaurant_price_plan.vat_exclusive") },
      ]} /></Form.Item>
      <Form.Item name={[...path, "gpBasis"]} label={t("restaurant_price_plan.gp_basis")} rules={[{ required: true }]}><Select style={{ width: 180 }} options={[
        { value: "NET_REVENUE", label: t("restaurant_price_plan.net") }, { value: "CUSTOMER_TOTAL", label: t("restaurant_price_plan.gross") },
      ]} /></Form.Item>
      {[
        { name: "price", label: t("restaurant_price_plan.price"), max: 1_000_000_000, required: true },
        { name: "vatPercent", label: t("restaurant_price_plan.vat_rate"), max: 100, required: true },
        { name: "gpPercent", label: t("restaurant_price_plan.gp_rate"), max: 100, required: true },
        { name: "extraUnitCost", label: t("restaurant_price_plan.extra"), max: 1_000_000_000, required: true },
        { name: "expectedDailyUnits", label: t("restaurant_menu_plan.units"), max: 1_000_000, required: false },
        { name: "targetMarginPercent", label: t("restaurant_price_plan.target_margin"), max: 99.99, required: false },
      ].map(f => <Form.Item key={f.name} name={[...path, f.name]} label={f.label} rules={[{ required: f.required }]}>
        <InputNumber min={0} max={f.max} precision={f.name === "expectedDailyUnits" ? 0 : 2} />
      </Form.Item>)}
    </Space>
  </>;
  async function calculate(values: any) {
    const revision = ++requestRevision.current;
    // Also catch programmatic Form updates, which do not fire onValuesChange.
    const inputSnapshot = JSON.stringify(form.getFieldsValue(true));
    const isCurrent = () => revision === requestRevision.current
      && inputSnapshot === JSON.stringify(form.getFieldsValue(true));
    setResult(null); setError(null); setLoading(true);
    const scenario = (s: any) => ({ label: s.label, price: s.price, vatMode: s.vatMode, vatPercent: s.vatPercent,
      gpPercent: s.gpPercent, gpBasis: s.gpBasis, extraUnitCost: s.extraUnitCost,
      expectedDailyUnits: s.expectedDailyUnits ?? null, targetMarginPercent: s.targetMarginPercent ?? null });
    try {
      const response = await client.query({ query: QUERY, fetchPolicy: "no-cache", variables: { input: {
        assumptionSource: values.assumptionSource, dailyFixedCost: values.dailyFixedCost ?? null, dailyTargetProfit: values.dailyTargetProfit,
        items: values.items.map((r: any) => ({ recipeId: r.recipeId, scenario: scenario(r.scenario) })),
        bundle: values.bundleEnabled ? { scenario: scenario(values.bundleScenario),
          parts: values.items.filter((r: any) => r.bundleQty > 0).map((r: any) => ({ recipeId: r.recipeId, qty: r.bundleQty })) } : null,
      } } });
      if (!isCurrent()) return;
      const data = response.data.bmsRestaurantMenuPlan;
      if (data.status !== "OK") setError(data.errorCode ?? data.status); else setResult(data);
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : "ERROR"); }
    finally { if (revision === requestRevision.current) setLoading(false); }
  }
  const figures = (rows: [string, any][]) => <dl style={{ overflowWrap: "anywhere" }}>{rows.map(([label, value]) => <div key={label} style={{ marginBlock: 8 }}>
    <dt>{label}</dt><dd style={{ marginInlineStart: 0, fontWeight: 600 }}>{amount(value)}</dd>
  </div>)}</dl>;
  return <>
    <Alert closable showIcon type="info" message={t("restaurant_menu_plan.scope")} description={t("restaurant_menu_plan.basis")} />
    <Typography.Paragraph style={{ marginTop: 12 }}>{t("restaurant_menu_plan.method")}</Typography.Paragraph>
    <Form form={form} layout="vertical" disabled={loading} initialValues={{ dailyTargetProfit: 0, bundleEnabled: false,
      items: [{ scenario: blank(), bundleQty: 0 }, { scenario: blank(), bundleQty: 0 }], bundleScenario: blank() }}
      onFinish={values => void calculate(values)} onValuesChange={invalidateResult}>
      <Form.Item name="assumptionSource" label={t("restaurant_menu_plan.source")} rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      <Space wrap align="start">
        <Form.Item name="dailyFixedCost" label={t("restaurant_price_plan.fixed")}><InputNumber min={0} max={1_000_000_000} precision={2} /></Form.Item>
        <Form.Item name="dailyTargetProfit" label={t("restaurant_price_plan.target_profit")} rules={[{ required: true }]}><InputNumber min={0} max={1_000_000_000} precision={2} /></Form.Item>
      </Space>
      <Form.List name="items">{(fields, { add, remove }) => <>
        {fields.map(field => <Card key={field.key} size="small" style={{ marginBottom: 12 }} title={`${t("restaurant_menu_plan.menu")} ${field.name + 1}`}
          extra={fields.length > 2 && <Button onClick={() => remove(field.name)}>{t("restaurant_price_plan.remove")}</Button>}>
          <Form.Item name={[field.name, "recipeId"]} label={t("restaurant_menu_plan.recipe")} rules={[{ required: true }]}>{recipeSelect()}</Form.Item>
          {scenarioFields([field.name, "scenario"])}
          <Form.Item name={[field.name, "bundleQty"]} label={t("restaurant_menu_plan.bundle_qty")}><InputNumber min={0} max={1000} precision={0} /></Form.Item>
        </Card>)}
        <Button disabled={loading || fields.length >= 12} onClick={() => add({ scenario: blank(), bundleQty: 0 })}>{t("restaurant_menu_plan.add")}</Button>
      </>}</Form.List>
      <Form.Item name="bundleEnabled" valuePropName="checked" style={{ marginTop: 16 }}><Checkbox>{t("restaurant_menu_plan.bundle")}</Checkbox></Form.Item>
      {bundleEnabled && <Card size="small" title={t("restaurant_menu_plan.bundle")}><Typography.Paragraph>{t("restaurant_menu_plan.bundle_basis")}</Typography.Paragraph>{scenarioFields(["bundleScenario"])}</Card>}
      <Button type="primary" htmlType="submit" loading={loading} style={{ marginBlock: 12 }}>{t("restaurant_price_plan.calculate")}</Button>
    </Form>
    {error && <Alert closable showIcon type="error" message={t("restaurant_price_plan.error")} description={error} />}
    {result && <section aria-label={t("restaurant_menu_plan.results")}>
      <Typography.Title level={4}>{t("restaurant_menu_plan.results")}</Typography.Title>
      <Typography.Paragraph>{t("restaurant_menu_plan.rounding")}</Typography.Paragraph>
      <Alert closable type={result.analysis.status === "COMPLETE" ? "info" : "warning"} message={state[result.analysis.status]} />
      {figures([[t("restaurant_menu_plan.popularity_threshold"), result.analysis.popularityThresholdPercent],
        [t("restaurant_menu_plan.margin_threshold"), result.analysis.contributionThreshold], [t("restaurant_menu_plan.total_units"), result.analysis.totalUnits],
        [t("restaurant_menu_plan.total_contribution"), result.analysis.totalContribution], [t("restaurant_menu_plan.mix_profit"), result.analysis.projectedProfit]])}
      {result.analysis.rows.map((row: any) => {
        const estimate = result.estimates.find((e: any) => e.recipeId === row.recipeId);
        return <Card key={row.recipeId} title={row.label} style={{ marginBottom: 12 }}>
          <Typography.Text strong>{state[row.classification]}</Typography.Text>
          {row.price.contribution != null && row.price.contribution <= 0 && <Alert closable type="warning" message={t("restaurant_price_plan.non_positive")} />}
          {figures([[t("restaurant_menu_plan.units"), row.units], [t("restaurant_menu_plan.share"), row.popularityPercent],
            [t("restaurant_price_plan.gross"), row.price.customerTotal], [t("restaurant_price_plan.net"), row.price.netRevenue],
            [t("restaurant_price_plan.vat_amount"), row.price.outputVat], [t("restaurant_price_plan.gp_amount"), row.price.gpAmount],
            [t("restaurant_price_plan.variable"), row.price.variableUnitCost], [t("restaurant_price_plan.contribution"), row.price.contribution],
            [t("restaurant_price_plan.target_price"), row.price.targetPrice]])}
          <Typography.Paragraph>{state[row.price.targetPriceStatus]}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t("restaurant_price_plan.observation")}: v{estimate?.recipeVersion} · {estimate?.calculatedAt}<br />
            {t("restaurant_price_plan.cost")}: {amount(estimate?.totalUnitCost)}</Typography.Paragraph>
        </Card>;
      })}
      {result.analysis.bundle && <Card title={t("restaurant_menu_plan.bundle_result")}>
        <Alert closable type="info" message={state[result.analysis.bundle.price.status]} />
        {figures([[t("restaurant_menu_plan.baseline_price"), result.analysis.bundle.baselineCustomerTotal],
          [t("restaurant_price_plan.gross"), result.analysis.bundle.price.customerTotal], [t("restaurant_menu_plan.savings"), result.analysis.bundle.customerSavings],
          [t("restaurant_price_plan.net"), result.analysis.bundle.price.netRevenue], [t("restaurant_price_plan.vat_amount"), result.analysis.bundle.price.outputVat],
          [t("restaurant_price_plan.gp_amount"), result.analysis.bundle.price.gpAmount],
          [t("restaurant_menu_plan.baseline_contribution"), result.analysis.bundle.baselineContribution],
          [t("restaurant_price_plan.variable"), result.analysis.bundle.price.variableUnitCost],
          [t("restaurant_price_plan.contribution"), result.analysis.bundle.price.contribution],
          [t("restaurant_menu_plan.delta"), result.analysis.bundle.contributionDelta],
          [t("restaurant_price_plan.break_even"), result.analysis.bundle.price.breakEvenUnits],
          [t("restaurant_price_plan.target_units"), result.analysis.bundle.price.targetDailyUnits],
          [t("restaurant_price_plan.projected"), result.analysis.bundle.price.projectedDailyProfit],
          [t("restaurant_price_plan.target_price"), result.analysis.bundle.price.targetPrice]])}
        <Typography.Paragraph>{state[result.analysis.bundle.price.targetPriceStatus]}</Typography.Paragraph>
      </Card>}
    </section>}
  </>;
}
