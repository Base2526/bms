"use client";

import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Checkbox, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Select, Space, Spin, Switch, Table, Tag, Typography, message,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

const Q_CAPABILITIES = gql`
  query StockModelCapabilities { bmsStoreCapabilities { capability enabled configured status source gating } }
`;
const Q_PRODUCTS = gql`
  query StockModelProducts($search: String) {
    bmsProducts(search: $search, limit: 30, offset: 0) {
      items { sku name active variants { size } }
    }
  }
`;
const Q_MODEL = gql`
  query StockModel($sku: String!) {
    bmsProductStockPolicy(productSku: $sku) {
      productSku stockPolicy baseUnit displayUnit displayPrecision lotTracking expiryTracking fefo
      kitchenStation scaleItemCode scaleSize
    }
    bmsProductRecipes(productSku: $sku) {
      id productSku size version outputQty active items { sku size qty }
    }
    bmsProductModifiers(productSku: $sku) {
      id productSku size code name priceDelta active
      groupId groupCode groupName selectionType minSelect maxSelect defaultSelected sortOrder
      items { sku size qtyDelta }
    }
  }
`;
const Q_STATION_SLAS = gql`
  query KitchenStationSlas { bmsKitchenStationSlas { station warnMinutes lateMinutes configured } }
`;
const M_STATION_SLA = gql`
  mutation SaveKitchenStationSla($station: String!, $warnMinutes: Int!, $lateMinutes: Int!) {
    bmsUpsertKitchenStationSla(station: $station, warnMinutes: $warnMinutes, lateMinutes: $lateMinutes) {
      station warnMinutes lateMinutes configured
    }
  }
`;
const M_CLEAR_STATION_SLA = gql`
  mutation ClearKitchenStationSla($station: String!) { bmsClearKitchenStationSla(station: $station) }
`;
const M_CAPABILITY = gql`
  mutation SetStockCapability($capability: String!, $enabled: Boolean!) {
    bmsUpsertStoreCapability(capability: $capability, enabled: $enabled) { capability enabled configured status source }
  }
`;
const M_RESET_CAPABILITY = gql`
  mutation ResetStockCapability($capability: String!) {
    bmsResetStoreCapability(capability: $capability) { capability enabled configured status source }
  }
`;
const M_POLICY = gql`
  mutation SaveStockPolicy($input: BmsProductStockPolicyInput!) {
    bmsUpsertProductStockPolicy(input: $input) { productSku stockPolicy }
  }
`;
const M_RECIPE = gql`
  mutation SaveProductRecipe($input: BmsProductRecipeInput!) {
    bmsUpsertProductRecipe(input: $input) { id version active }
  }
`;
const M_MODIFIER = gql`
  mutation SaveProductModifier($input: BmsProductModifierInput!) {
    bmsUpsertProductModifier(input: $input) { id code active }
  }
`;
const M_QUICK_INGREDIENT = gql`
  mutation QuickIngredient($input: BmsProductInput!) {
    bmsUpsertProduct(input: $input) { sku name }
  }
`;

type Capability = { capability: string; enabled: boolean; configured: boolean; status: string; source: string; gating: boolean };
type Product = { sku: string; name: string; active: boolean; variants: Array<{ size: string }> };
type Recipe = { id: string; productSku: string; size: string; version: number; outputQty: number; active: boolean; items: Array<{ sku: string; size: string; qty: number }> };
type Modifier = {
  id: string; productSku: string; size: string; code: string; name: string; priceDelta: number; active: boolean;
  groupId: string; groupCode: string; groupName: string; selectionType: "SINGLE" | "MULTIPLE";
  minSelect: number; maxSelect: number | null; defaultSelected: boolean; sortOrder: number;
  items: Array<{ sku: string; size: string; qtyDelta: number }>;
};

const POLICY_OPTIONS = ["DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "SERIALIZED", "NON_STOCK"]
  .map((value) => ({ value, label: value }));

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function StockModelsPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const searchParams = useSearchParams();
  const canView = can("product.view");
  const canEdit = can("product.edit");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [ingredientOpen, setIngredientOpen] = useState(false);
  const [ingredientTarget, setIngredientTarget] = useState<"recipe" | "modifier">("recipe");
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  const [policyForm] = Form.useForm();
  const [recipeForm] = Form.useForm();
  const [modifierForm] = Form.useForm();
  const [ingredientForm] = Form.useForm();

  const capabilities = useQuery(Q_CAPABILITIES, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  const [loadProducts, productsQuery] = useLazyQuery(Q_PRODUCTS, { fetchPolicy: "network-only" });
  const model = useQuery(Q_MODEL, {
    variables: { sku: selectedSku ?? "" }, skip: !selectedSku, fetchPolicy: "network-only",
    onCompleted(data) {
      const p = data?.bmsProductStockPolicy;
      policyForm.setFieldsValue(p ?? {
        stockPolicy: "DIRECT", baseUnit: "PIECE", displayPrecision: 0,
        lotTracking: false, expiryTracking: false, fefo: false, deactivateDerived: false,
      });
    },
  });
  const stationSlas = useQuery(Q_STATION_SLAS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  const [saveStationSla, stationSlaMutation] = useMutation(M_STATION_SLA);
  const [clearStationSla] = useMutation(M_CLEAR_STATION_SLA);
  const [slaDraft, setSlaDraft] = useState<Record<string, { warnMinutes: number; lateMinutes: number }>>({});
  const [setCapability, capabilityMutation] = useMutation(M_CAPABILITY);
  const [resetCapability] = useMutation(M_RESET_CAPABILITY);
  const [savePolicy, policyMutation] = useMutation(M_POLICY);
  const [saveRecipe, recipeMutation] = useMutation(M_RECIPE);
  const [saveModifier, modifierMutation] = useMutation(M_MODIFIER);
  const [quickIngredient, ingredientMutation] = useMutation(M_QUICK_INGREDIENT);

  useEffect(() => {
    const sku = searchParams.get("sku")?.trim();
    if (!sku) return;
    setSearch(sku);
    void loadProducts({ variables: { search: sku } }).then((result) => {
      const exact = result.data?.bmsProducts?.items?.find((product: Product) => product.sku === sku);
      if (exact) setSelectedSku(exact.sku);
    });
  }, [loadProducts, searchParams]);

  if (!permsLoading && !canView) {
    return <Alert type="error" showIcon message={t("admin_stock.no_product_view")} />;
  }

  const products: Product[] = productsQuery.data?.bmsProducts?.items ?? [];
  const selectedProduct = products.find((product) => product.sku === selectedSku) ?? null;
  const sizes = Array.from(new Set(selectedProduct?.variants.map((v) => v.size) ?? [])).sort();
  const recipes: Recipe[] = model.data?.bmsProductRecipes ?? [];
  const modifiers: Modifier[] = model.data?.bmsProductModifiers ?? [];

  async function changeCapability(capability: string, enabled: boolean) {
    try {
      await setCapability({ variables: { capability, enabled } });
      await capabilities.refetch();
      message.success(t("admin_stock.capability_saved"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  async function resetPreset(capability: string) {
    try {
      await resetCapability({ variables: { capability } });
      await capabilities.refetch();
      message.success(t("admin_stock.preset_restored"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  async function submitPolicy() {
    if (!selectedSku) return;
    const values = await policyForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await savePolicy({ variables: { input: { productSku: selectedSku, ...values } } });
      await model.refetch();
      message.success(t("admin_stock.policy_saved"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  function openRecipe(recipe?: Recipe) {
    const next = recipe ?? null;
    setEditingRecipe(next);
    // Apollo แปะ __typename ลงทุก object ที่มาจาก query รวมถึงแต่ละแถวใน items —
    // ถ้าเซ็ตฟอร์มด้วย object ของ query ตรง ๆ ค่านั้นจะติดไปกับ mutation input ตอน submit
    // แล้วโดน GraphQL ปฏิเสธ ("Field \"__typename\" is not defined by type ...Input")
    // จึงต้อง map เหลือเฉพาะฟิลด์ที่ input type ต้องการก่อนเซ็ตฟอร์มเสมอ
    recipeForm.setFieldsValue(
      next
        ? {
            size: next.size, outputQty: next.outputQty, active: next.active,
            items: next.items.map((item) => ({ sku: item.sku, size: item.size, qty: item.qty })),
          }
        : { size: sizes[0], outputQty: 1, active: true, items: [{ sku: "", size: "", qty: 1 }] }
    );
    setRecipeOpen(true);
  }

  async function submitRecipe() {
    if (!selectedSku) return;
    const values = await recipeForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await saveRecipe({ variables: { input: { id: editingRecipe?.id, productSku: selectedSku, ...values } } });
      setRecipeOpen(false);
      await model.refetch();
      message.success(t("admin_stock.recipe_saved"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  function openModifier(modifier?: Modifier) {
    const next = modifier ?? null;
    setEditingModifier(next);
    // เหตุผลเดียวกับ openRecipe — ตัด __typename ที่ Apollo แปะมากับแต่ละแถวใน items ทิ้งก่อน
    modifierForm.setFieldsValue(
      next
        ? {
            size: next.size, code: next.code, name: next.name, priceDelta: next.priceDelta, active: next.active,
            groupCode: next.groupCode, groupName: next.groupName, selectionType: next.selectionType,
            minSelect: next.minSelect, maxSelect: next.maxSelect, defaultSelected: next.defaultSelected,
            sortOrder: next.sortOrder,
            items: next.items.map((item) => ({ sku: item.sku, size: item.size, qtyDelta: item.qtyDelta })),
          }
        : {
            size: sizes[0], priceDelta: 0, active: true,
            groupCode: "OPTIONS", groupName: t("admin_stock.default_modifier_group"),
            selectionType: "MULTIPLE", minSelect: 0, maxSelect: null,
            defaultSelected: false, sortOrder: 0,
            items: [{ sku: "", size: "", qtyDelta: 1 }],
          }
    );
    setModifierOpen(true);
  }

  async function submitModifier() {
    if (!selectedSku) return;
    const values = await modifierForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await saveModifier({ variables: { input: { id: editingModifier?.id, productSku: selectedSku, ...values } } });
      setModifierOpen(false);
      await model.refetch();
      message.success(t("admin_stock.modifier_saved"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  function openQuickIngredient(kind: "recipe" | "modifier") {
    setIngredientTarget(kind);
    ingredientForm.resetFields();
    ingredientForm.setFieldsValue({ variantCode: "STD", baseUnit: "PIECE" });
    setIngredientOpen(true);
  }

  async function submitQuickIngredient() {
    const values = await ingredientForm.validateFields().catch(() => null);
    if (!values) return;
    const sku = String(values.sku).trim().toUpperCase();
    const variantCode = String(values.variantCode).trim().toUpperCase();
    try {
      await quickIngredient({ variables: { input: {
        sku,
        name: String(values.name).trim(),
        price: 0,
        active: false,
        keywords: [],
        creation_template: "INGREDIENT",
        stock_policy: "DIRECT",
        base_unit: String(values.baseUnit).trim().toUpperCase(),
        variant_codes: [variantCode],
        sales_surfaces: [],
      } } });
      const targetForm = ingredientTarget === "recipe" ? recipeForm : modifierForm;
      const items = targetForm.getFieldValue("items") ?? [];
      const usableItems = items.filter((item: { sku?: string; size?: string }) =>
        String(item?.sku ?? "").trim() || String(item?.size ?? "").trim()
      );
      targetForm.setFieldsValue({
        items: [...usableItems, ingredientTarget === "recipe"
          ? { sku, size: variantCode, qty: 1 }
          : { sku, size: variantCode, qtyDelta: 1 }],
      });
      setIngredientOpen(false);
      await loadProducts({ variables: { search: search.trim() } });
      message.success(t("admin_stock.ingredient_created"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

  const componentFields = (kind: "recipe" | "modifier") => (
    <Form.List name="items">
      {(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>
        {fields.map(({ key, name, ...rest }) => (
          <div className={styles.componentRow} key={key}>
            <Form.Item {...rest} name={[name, "sku"]} rules={[{ required: true }]}><Input placeholder={t("admin_stock.component_sku")} /></Form.Item>
            <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true }]}><Input placeholder={t("admin_stock.component_size")} /></Form.Item>
            <Form.Item {...rest} name={[name, kind === "recipe" ? "qty" : "qtyDelta"]} rules={[{ required: true }]}>
              <InputNumber style={{ width: "100%" }} precision={0} placeholder={kind === "recipe" ? "Qty" : "+/-"} />
            </Form.Item>
            <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} aria-label={t("admin_stock.remove_component")} />
          </div>
        ))}
        <Space wrap>
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add(kind === "recipe" ? { qty: 1 } : { qtyDelta: 1 })}>{t("admin_stock.add_component")}</Button>
          <Button type="link" onClick={() => openQuickIngredient(kind)}>{t("admin_stock.quick_create_ingredient")}</Button>
        </Space>
      </Space>}
    </Form.List>
  );

  return <div className={styles.page}>
    <section className={styles.hero}>
      <h1>{t("admin_stock.title")}</h1>
      <p>{t("admin_stock.subtitle")}</p>
    </section>

    <section>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <div><h2 className={styles.sectionTitle}>{t("admin_stock.capabilities")}</h2><Typography.Text type="secondary">{t("admin_stock.capability_hint")}</Typography.Text></div>
        <Button icon={<ReloadOutlined />} onClick={() => capabilities.refetch()}>{t("admin_stock.refresh")}</Button>
      </Space>
      {capabilities.error && <Alert type="error" showIcon message={capabilities.error.message} style={{ marginBottom: 12 }} />}
      <Spin spinning={capabilities.loading || capabilityMutation.loading}>
        <div className={styles.capabilityGrid}>
          {(capabilities.data?.bmsStoreCapabilities ?? []).map((item: Capability) => {
            const copyKey = item.capability.toLowerCase();
            return <article key={item.capability} className={`${styles.capability} ${item.enabled ? styles.capabilityEnabled : ""}`}>
              <div className={styles.capabilityTitle}>
                <strong>{t(`admin_stock.cap_${copyKey}_title`)}</strong>
                {/* สวิตช์เฉพาะตัวที่สลับแล้วพฤติกรรมเปลี่ยนจริง — ที่เหลือเป็นสถานะที่ระบบ
                    อ่านจากข้อมูล (มีแพ็ก/มีล็อต/ตั้ง serial ไว้ไหม) ให้สวิตช์ที่กดแล้วไม่มีอะไร
                    เกิดขึ้น แย่กว่าไม่มีสวิตช์ เพราะคนอ่านว่าปิดไปแล้วทั้งที่ยังทำงานอยู่ */}
                {item.gating
                  ? <Switch checked={item.enabled} onChange={(v) => void changeCapability(item.capability, v)} />
                  : <Tag color={item.enabled ? "blue" : "default"}>
                      {item.enabled ? t("admin_stock.detected_on") : t("admin_stock.detected_off")}
                    </Tag>}
              </div>
              <p>{t(`admin_stock.cap_${copyKey}_desc`)}</p>
              {!item.gating && <p className={styles.capabilityNote}>{t("admin_stock.detected_hint")}</p>}
              <Space wrap>
                <Tag color={item.configured ? "green" : item.enabled ? "gold" : "default"}>{item.status}</Tag>
                <Tag>{item.source}</Tag>
                {item.gating && item.source === "MANUAL" && <Popconfirm title={t("admin_stock.reset_confirm")} onConfirm={() => void resetPreset(item.capability)}><Button size="small" type="link">{t("admin_stock.reset_preset")}</Button></Popconfirm>}
              </Space>
            </article>;
          })}
        </div>
      </Spin>
    </section>

    {/* เกณฑ์เวลาของจอครัว (9.53) — บาร์ชงเสร็จใน 2 นาที ครัวร้อน 8-12 นาทีเป็นปกติ
        เกณฑ์เดียวทั้งร้านทำให้ครัวร้อนแดงตลอดจนสีเลิกมีความหมาย */}
    <Card title={t("admin_stock.station_sla")}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("admin_stock.station_sla_hint")}
      </Typography.Paragraph>
      <Spin spinning={stationSlas.loading}>
        {(stationSlas.data?.bmsKitchenStationSlas ?? []).length === 0
          ? <Empty description={t("admin_stock.station_sla_empty")} />
          : <Table
              rowKey="station"
              size="small"
              pagination={false}
              dataSource={stationSlas.data?.bmsKitchenStationSlas ?? []}
              columns={[
                { title: t("admin_stock.station"), dataIndex: "station" },
                {
                  title: t("admin_stock.station_sla_warn"),
                  render: (_v: unknown, row: any) => <InputNumber min={0} max={599} disabled={!canEdit}
                    value={slaDraft[row.station]?.warnMinutes ?? row.warnMinutes}
                    onChange={(value) => setSlaDraft((current) => ({
                      ...current,
                      [row.station]: {
                        warnMinutes: Number(value ?? 0),
                        lateMinutes: current[row.station]?.lateMinutes ?? row.lateMinutes,
                      },
                    }))} />,
                },
                {
                  title: t("admin_stock.station_sla_late"),
                  render: (_v: unknown, row: any) => <InputNumber min={1} max={600} disabled={!canEdit}
                    value={slaDraft[row.station]?.lateMinutes ?? row.lateMinutes}
                    onChange={(value) => setSlaDraft((current) => ({
                      ...current,
                      [row.station]: {
                        warnMinutes: current[row.station]?.warnMinutes ?? row.warnMinutes,
                        lateMinutes: Number(value ?? 0),
                      },
                    }))} />,
                },
                {
                  title: t("admin_stock.source"),
                  render: (_v: unknown, row: any) => row.configured
                    ? <Tag color="green">{t("admin_stock.station_sla_custom")}</Tag>
                    : <Tag>{t("admin_stock.station_sla_default")}</Tag>,
                },
                {
                  title: "",
                  render: (_v: unknown, row: any) => canEdit && <Space>
                    <Button size="small" type="primary" loading={stationSlaMutation.loading}
                      onClick={async () => {
                        const draft = slaDraft[row.station] ?? { warnMinutes: row.warnMinutes, lateMinutes: row.lateMinutes };
                        try {
                          await saveStationSla({ variables: { station: row.station, ...draft } });
                          message.success(t("admin_stock.saved"));
                          await stationSlas.refetch();
                        } catch (error: any) {
                          message.error(error?.message ?? t("admin_stock.save_failed"));
                        }
                      }}>{t("admin_stock.save")}</Button>
                    {row.configured && <Popconfirm title={t("admin_stock.station_sla_reset_confirm")}
                      onConfirm={async () => {
                        await clearStationSla({ variables: { station: row.station } });
                        setSlaDraft((current) => { const next = { ...current }; delete next[row.station]; return next; });
                        await stationSlas.refetch();
                      }}>
                      <Button size="small" icon={<ReloadOutlined />} />
                    </Popconfirm>}
                  </Space>,
                },
              ]}
            />}
      </Spin>
    </Card>

    <Card title={t("admin_stock.product_model")}>
      <Space.Compact style={{ width: "100%", maxWidth: 720 }}>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => loadProducts({ variables: { search: search.trim() } })} placeholder={t("admin_stock.search_product")} />
        <Button icon={<SearchOutlined />} loading={productsQuery.loading} onClick={() => loadProducts({ variables: { search: search.trim() } })}>{t("admin_stock.search")}</Button>
      </Space.Compact>
      {products.length > 0 && <Select
        showSearch optionFilterProp="label" style={{ width: "100%", maxWidth: 720, marginTop: 12 }}
        placeholder={t("admin_stock.select_product")}
        value={selectedSku}
        onChange={(sku) => { setSelectedSku(sku); policyForm.resetFields(); }}
        options={products.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}${p.active ? "" : " (inactive)"}` }))}
      />}
    </Card>

    {!selectedSku ? <div className={styles.emptyPanel}>{t("admin_stock.select_first")}</div> : <Spin spinning={model.loading}>
      <div className={styles.modelGrid}>
        <Card title={t("admin_stock.policy")} extra={canEdit && <Button type="primary" loading={policyMutation.loading} onClick={() => void submitPolicy()}>{t("admin_stock.save")}</Button>}>
          <Form form={policyForm} layout="vertical" disabled={!canEdit}>
            <Form.Item name="stockPolicy" label={t("admin_stock.stock_policy")} rules={[{ required: true }]}><Select options={POLICY_OPTIONS} /></Form.Item>
            <Space wrap align="start">
              <Form.Item name="baseUnit" label={t("admin_stock.base_unit")} rules={[{ required: true }]}><Input placeholder="PIECE / GRAM" /></Form.Item>
              <Form.Item name="displayUnit" label={t("admin_stock.display_unit")}><Input placeholder={t("admin_stock.display_unit_hint")} /></Form.Item>
              <Form.Item name="displayPrecision" label={t("admin_stock.precision")}><InputNumber min={0} max={6} precision={0} /></Form.Item>
            </Space>
            <Space wrap>
              <Form.Item name="lotTracking" valuePropName="checked"><Checkbox>{t("admin_stock.lot")}</Checkbox></Form.Item>
              <Form.Item name="expiryTracking" valuePropName="checked"><Checkbox>{t("admin_stock.expiry")}</Checkbox></Form.Item>
              <Form.Item name="fefo" valuePropName="checked"><Checkbox>FEFO</Checkbox></Form.Item>
            </Space>
            <Form.Item name="kitchenStation" label={t("admin_stock.kitchen_station")}><Input placeholder="HOT / COLD / BAR" /></Form.Item>
            <Form.Item name="deactivateDerived" valuePropName="checked">
              <Checkbox>{t("admin_stock.confirm_deactivate_derived")}</Checkbox>
            </Form.Item>
            <Space wrap align="start">
              <Form.Item name="scaleItemCode" label={t("admin_stock.scale_code")}><Input maxLength={5} placeholder="00001" /></Form.Item>
              <Form.Item name="scaleSize" label={t("admin_stock.scale_size")}><Select allowClear options={sizes.map((s) => ({ value: s, label: s }))} /></Form.Item>
            </Space>
          </Form>
        </Card>

        <Card title={t("admin_stock.safety_note")}>
          <Alert type="info" showIcon message={t("admin_stock.snapshot_title")} description={t("admin_stock.snapshot_desc")} />
          <Typography.Paragraph style={{ marginTop: 16 }}>{t("admin_stock.unit_note")}</Typography.Paragraph>
        </Card>
      </div>

      <Card title={t("admin_stock.recipes")} extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openRecipe()}>{t("admin_stock.new_recipe")}</Button>}>
        <Table rowKey="id" pagination={false} dataSource={recipes} locale={{ emptyText: <Empty description={t("admin_stock.no_recipes")} /> }} columns={[
          { title: t("admin_stock.size"), dataIndex: "size" },
          { title: t("admin_stock.version"), dataIndex: "version", width: 90 },
          { title: t("admin_stock.output_qty"), dataIndex: "outputQty", width: 110 },
          { title: t("admin_stock.components"), render: (_: unknown, row: Recipe) => row.items.map((i) => `${i.sku}/${i.size} × ${i.qty}`).join(", ") },
          { title: t("admin_stock.status"), render: (_: unknown, row: Recipe) => <Tag color={row.active ? "green" : "default"}>{row.active ? t("admin_stock.active") : t("admin_stock.inactive")}</Tag> },
          ...(canEdit ? [{ title: "", width: 90, render: (_: unknown, row: Recipe) => <Button size="small" onClick={() => openRecipe(row)}>{t("admin_stock.edit")}</Button> }] : []),
        ]} />
      </Card>

      <Card title={t("admin_stock.modifiers")} extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openModifier()}>{t("admin_stock.new_modifier")}</Button>}>
        <Table rowKey="id" pagination={false} dataSource={modifiers} locale={{ emptyText: <Empty description={t("admin_stock.no_modifiers")} /> }} columns={[
          { title: t("admin_stock.code"), dataIndex: "code", width: 130 },
          { title: t("admin_stock.name"), dataIndex: "name" },
          { title: t("admin_stock.modifier_group"), render: (_: unknown, row: Modifier) => `${row.groupName} · ${row.selectionType} (${row.minSelect}–${row.maxSelect ?? "∞"})` },
          { title: t("admin_stock.price_delta"), dataIndex: "priceDelta", render: (value: number) => `฿${Number(value).toFixed(2)}` },
          { title: t("admin_stock.size"), dataIndex: "size" },
          { title: t("admin_stock.stock_effect"), render: (_: unknown, row: Modifier) => row.items.map((i) => `${i.sku}/${i.size} ${i.qtyDelta > 0 ? "+" : ""}${i.qtyDelta}`).join(", ") },
          { title: t("admin_stock.status"), render: (_: unknown, row: Modifier) => <Tag color={row.active ? "green" : "default"}>{row.active ? t("admin_stock.active") : t("admin_stock.inactive")}</Tag> },
          ...(canEdit ? [{ title: "", width: 90, render: (_: unknown, row: Modifier) => <Button size="small" onClick={() => openModifier(row)}>{t("admin_stock.edit")}</Button> }] : []),
        ]} />
      </Card>
    </Spin>}

    <Modal open={recipeOpen} title={editingRecipe ? t("admin_stock.edit_recipe") : t("admin_stock.new_recipe")} onCancel={() => setRecipeOpen(false)} onOk={() => void submitRecipe()} confirmLoading={recipeMutation.loading} width={760}>
      <Form form={recipeForm} layout="vertical">
        <Space wrap align="start">
          <Form.Item name="size" label={t("admin_stock.size")} rules={[{ required: true }]}><Select disabled={Boolean(editingRecipe)} style={{ width: 180 }} options={sizes.map((s) => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="outputQty" label={t("admin_stock.output_qty")} rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
          <Form.Item name="active" label={t("admin_stock.active")} valuePropName="checked"><Switch /></Form.Item>
        </Space>
        {componentFields("recipe")}
      </Form>
    </Modal>

    <Modal open={modifierOpen} title={editingModifier ? t("admin_stock.edit_modifier") : t("admin_stock.new_modifier")} onCancel={() => setModifierOpen(false)} onOk={() => void submitModifier()} confirmLoading={modifierMutation.loading} width={760}>
      <Form form={modifierForm} layout="vertical">
        <Space wrap align="start">
          <Form.Item name="size" label={t("admin_stock.size")} rules={[{ required: true }]}><Select style={{ width: 180 }} options={sizes.map((s) => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="code" label={t("admin_stock.code")} rules={[{ required: true }]}><Input placeholder="NO_SUGAR" /></Form.Item>
          <Form.Item name="name" label={t("admin_stock.name")} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="priceDelta" label={t("admin_stock.price_delta")} rules={[{ required: true }]}><InputNumber min={0} precision={2} step={1} /></Form.Item>
          <Form.Item name="active" label={t("admin_stock.active")} valuePropName="checked"><Switch /></Form.Item>
        </Space>
        <Card size="small" title={t("admin_stock.modifier_group")} style={{ marginBottom: 16 }}>
          <Space wrap align="start">
            <Form.Item name="groupCode" label={t("admin_stock.group_code")} rules={[{ required: true }]}><Input placeholder="SWEETNESS" /></Form.Item>
            <Form.Item name="groupName" label={t("admin_stock.group_name")} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="selectionType" label={t("admin_stock.selection_type")} rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={[
                { value: "SINGLE", label: t("admin_stock.selection_single") },
                { value: "MULTIPLE", label: t("admin_stock.selection_multiple") },
              ]} />
            </Form.Item>
            <Form.Item name="minSelect" label={t("admin_stock.min_select")}><InputNumber min={0} precision={0} /></Form.Item>
            <Form.Item name="maxSelect" label={t("admin_stock.max_select")}><InputNumber min={1} precision={0} /></Form.Item>
            <Form.Item name="defaultSelected" valuePropName="checked"><Checkbox>{t("admin_stock.default_selected")}</Checkbox></Form.Item>
          </Space>
        </Card>
        {componentFields("modifier")}
      </Form>
    </Modal>

    <Modal
      open={ingredientOpen}
      title={t("admin_stock.quick_create_ingredient")}
      onCancel={() => setIngredientOpen(false)}
      onOk={() => void submitQuickIngredient()}
      confirmLoading={ingredientMutation.loading}
    >
      <Alert type="info" showIcon message={t("admin_stock.ingredient_draft_hint")} style={{ marginBottom: 16 }} />
      <Form form={ingredientForm} layout="vertical">
        <Form.Item name="sku" label="SKU" rules={[{ required: true }]}><Input placeholder="ING-CHICKEN" /></Form.Item>
        <Form.Item name="name" label={t("admin_stock.name")} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="baseUnit" label={t("admin_stock.base_unit")} rules={[{ required: true }]}>
          <Select options={["PIECE", "GRAM", "ML", "MM", "CM", "METER"].map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item name="variantCode" label={t("admin_stock.size")} rules={[{ required: true }]}><Input placeholder="STD / GRAM" /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
