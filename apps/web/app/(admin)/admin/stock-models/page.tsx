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
import { shopExperienceForArchetype, type StockExperienceSection } from "@/lib/bms/shopExperience";
import { POLICY_REQUIRED_CAPABILITY, PRODUCT_STOCK_POLICIES } from "@/lib/bms/productStockPolicyOptions";
import styles from "./page.module.css";

const Q_CAPABILITIES = gql`
  query StockModelCapabilities {
    bmsStoreProfile { businessArchetype }
    bmsStoreCapabilities { capability enabled configured status source gating }
  }
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
      kitchenStation kitchenStationId scaleItemCode scaleSize
    }
    bmsProductRecipes(productSku: $sku) {
      id productSku size version outputQty active items { sku size qty }
    }
    bmsProductBundleItems(bundleSku: $sku) {
      componentSku componentName componentSize qty
    }
    bmsProductModifiers(productSku: $sku) {
      id productSku size code name priceDelta active
      groupId groupCode groupName selectionType minSelect maxSelect defaultSelected sortOrder
      items { sku size qtyDelta }
    }
  }
`;
const Q_STATION_SLAS = gql`
  query KitchenStationSlas { bmsKitchenStationSlas { station stationId warnMinutes lateMinutes configured } }
`;
// ทะเบียนสถานีครัว (9.54) — includeInactive เพราะหน้าตั้งค่าต้องเห็นสถานีที่ปิดไปแล้วเพื่อ
// เปิดกลับได้ (ปิดสถานีไม่ใช่การลบ ตั๋วเก่ายังอ้างถึงมันอยู่)
const Q_STATIONS = gql`
  query KitchenStations {
    bmsKitchenStations(includeInactive: true) {
      id code name description locationId locationName active sortOrder
      productCount activeProductCount
    }
    bmsUnmappedKitchenStationNames
  }
`;
const Q_LOCATIONS = gql`query StockModelLocations { bmsLocations { id name active } }`;
const M_CREATE_STATION = gql`
  mutation CreateKitchenStation($input: BmsKitchenStationInput!) {
    bmsCreateKitchenStation(input: $input) { id }
  }
`;
const M_UPDATE_STATION = gql`
  mutation UpdateKitchenStation($id: ID!, $input: BmsKitchenStationInput!) {
    bmsUpdateKitchenStation(id: $id, input: $input) { id }
  }
`;
const M_ARCHIVE_STATION = gql`
  mutation ArchiveKitchenStation($id: ID!, $force: Boolean) {
    bmsArchiveKitchenStation(id: $id, force: $force) { id active }
  }
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
// ส่วนประกอบของชุด (8.8) — ก่อนหน้านี้ตารางนี้ไม่มีทางเขียนจากแอปเลย ทำให้ BUNDLE
// เป็นตัวเลือกที่เลือกแล้วติด blocker ถาวร
const M_BUNDLE = gql`
  mutation SetProductBundleItems($bundleSku: String!, $items: [BmsBundleItemInput!]!) {
    bmsSetProductBundleItems(bundleSku: $bundleSku, items: $items) {
      componentSku componentName componentSize qty
    }
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
type BundleItem = { componentSku: string; componentName: string; componentSize: string; qty: number };
type Modifier = {
  id: string; productSku: string; size: string; code: string; name: string; priceDelta: number; active: boolean;
  groupId: string; groupCode: string; groupName: string; selectionType: "SINGLE" | "MULTIPLE";
  minSelect: number; maxSelect: number | null; defaultSelected: boolean; sortOrder: number;
  items: Array<{ sku: string; size: string; qtyDelta: number }>;
};

const POLICY_OPTIONS = PRODUCT_STOCK_POLICIES.map((value) => ({ value, label: value as string }));

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
  const [showAdditionalCapabilities, setShowAdditionalCapabilities] = useState(false);
  const [showAdvancedProductModel, setShowAdvancedProductModel] = useState(false);
  const [ingredientTarget, setIngredientTarget] = useState<"recipe" | "modifier">("recipe");
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  const [policyForm] = Form.useForm();
  const [recipeForm] = Form.useForm();
  const [modifierForm] = Form.useForm();
  const [ingredientForm] = Form.useForm();
  const selectedStockPolicy = Form.useWatch("stockPolicy", policyForm);

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
  const stations = useQuery(Q_STATIONS, { fetchPolicy: "cache-and-network", errorPolicy: "all" });
  const locations = useQuery(Q_LOCATIONS, { fetchPolicy: "cache-first", errorPolicy: "all" });
  const [createStation] = useMutation(M_CREATE_STATION);
  const [updateStation, updateStationState] = useMutation(M_UPDATE_STATION);
  const [archiveStation] = useMutation(M_ARCHIVE_STATION);
  const [stationForm] = Form.useForm();
  const [stationModal, setStationModal] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [setCapability, capabilityMutation] = useMutation(M_CAPABILITY);
  const [resetCapability] = useMutation(M_RESET_CAPABILITY);
  const [savePolicy, policyMutation] = useMutation(M_POLICY);
  const [saveRecipe, recipeMutation] = useMutation(M_RECIPE);
  const [saveModifier, modifierMutation] = useMutation(M_MODIFIER);
  const [saveBundle, bundleMutation] = useMutation(M_BUNDLE);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleForm] = Form.useForm();
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
  const bundleItems: BundleItem[] = model.data?.bmsProductBundleItems ?? [];
  const shopExperience = shopExperienceForArchetype(capabilities.data?.bmsStoreProfile?.businessArchetype);
  const capabilityItems: Capability[] = capabilities.data?.bmsStoreCapabilities ?? [];
  const recommendedCapabilitySet = new Set<string>(shopExperience.recommendedCapabilities);
  const recommendedCapabilities = capabilityItems.filter((item) => recommendedCapabilitySet.has(item.capability));
  const activeAdditionalCapabilities = capabilityItems.filter((item) =>
    !recommendedCapabilitySet.has(item.capability) && (item.enabled || item.configured)
  );
  const inactiveAdditionalCapabilities = capabilityItems.filter((item) =>
    !recommendedCapabilitySet.has(item.capability) && !item.enabled && !item.configured
  );
  const capabilityIsActive = (capability: string) => capabilityItems.some((item) =>
    item.capability === capability && (item.enabled || item.configured)
  );
  const stockSectionVisible = (section: StockExperienceSection) => {
    if (showAdvancedProductModel || shopExperience.recommendedStockSections.includes(section)) return true;
    if (section === "LOT_EXPIRY") return ["LOT_TRACKING", "EXPIRY_TRACKING", "FEFO"].some(capabilityIsActive);
    if (section === "SCALE") return capabilityIsActive("WEIGHTED_PRODUCT");
    if (section === "KITCHEN_STATION" || section === "STATION_SLA") return capabilityIsActive("KITCHEN_WORKFLOW");
    if (section === "RECIPES") return capabilityIsActive("RECIPE") || recipes.length > 0;
    if (section === "MODIFIERS") return capabilityIsActive("MODIFIER") || modifiers.length > 0;
    // ชุดไม่มี capability ของตัวเอง (ไม่มีสวิตช์ BUNDLE) — ให้เห็นเมื่อสินค้าตัวนี้
    // เลือกรูปแบบ BUNDLE ไว้ หรือมีส่วนประกอบอยู่แล้ว
    if (section === "BUNDLE") return selectedStockPolicy === "BUNDLE" || bundleItems.length > 0;
    return false;
  };
  const policyOptions = POLICY_OPTIONS.filter((option) => {
    if (showAdvancedProductModel || option.value === selectedStockPolicy) return true;
    // เกณฑ์เดียวกับฟอร์มสินค้า (ดู POLICY_REQUIRED_CAPABILITY ใน productStockPolicies.ts):
    // ยื่นเฉพาะรูปแบบที่ตั้งค่าต่อจนเปิดขายได้จริง
    //
    // SERIALIZED เคยถูกซ่อนไว้หลัง capability `SERIAL_TRACKING` ซึ่งเป็นความสามารถแบบ
    // "ตรวจพบจากข้อมูล" (มีสินค้าที่ serial_tracked แล้วเท่านั้นจึงจะติด) = ไก่กับไข่
    // ตอนนี้ธงนั้น derive จากนโยบายแล้ว จึงเลือกได้เลย
    //
    // NON_STOCK เคยถูกผูกกับ capability `RECIPE` ซึ่งกลับหัว — ร้านที่ไม่อยากคุมวัตถุดิบ
    // คือคนที่ต้องใช้ NON_STOCK พอดี และฝั่ง server ก็ไม่ได้ตรวจ capability ให้มันเลย
    const required = POLICY_REQUIRED_CAPABILITY[option.value];
    return !required || capabilityIsActive(required);
  }).map((option) => ({
    ...option,
    label: t(`admin_products.stock_policy_${option.value.toLowerCase()}`),
  }));

  const stationRows: any[] = stations.data?.bmsKitchenStations ?? [];
  const unmappedStationNames: string[] = stations.data?.bmsUnmappedKitchenStationNames ?? [];
  const locationOptions = [
    { value: "", label: t("admin_stock.station_scope_all") },
    ...((locations.data?.bmsLocations ?? []) as Array<{ id: string; name: string; active: boolean }>)
      .filter((location) => location.active)
      .map((location) => ({ value: location.id, label: location.name })),
  ];

  const renderCapabilityCards = (items: Capability[]) => items.map((item) => {
    const copyKey = item.capability.toLowerCase();
    return <article key={item.capability} className={`${styles.capability} ${item.enabled ? styles.capabilityEnabled : ""}`}>
      <div className={styles.capabilityTitle}>
        <strong>{t(`admin_stock.cap_${copyKey}_title`)}</strong>
        {item.gating
          ? <Switch checked={item.enabled} onChange={(value) => void changeCapability(item.capability, value)} />
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
  });

  function openStationModal(row?: any) {
    stationForm.setFieldsValue({
      name: row?.name ?? "",
      code: row?.code ?? "",
      description: row?.description ?? "",
      // "" = ทั้งร้าน · ค่าปริยายของสถานีใหม่คือทั้งร้าน เพราะสินค้าหนึ่งตัวขายได้หลายสาขา
      // การผูกกับสาขาเดียวเป็นการตัดสินใจของร้าน ไม่ใช่ค่าตั้งต้น (ดู 9.54)
      locationId: row?.locationId ?? "",
      sortOrder: row?.sortOrder ?? 0,
      active: row?.active ?? true,
    });
    setStationModal({ open: true, id: row?.id ?? null });
  }

  async function submitStation() {
    const values = await stationForm.validateFields();
    const input = {
      name: String(values.name ?? "").trim(),
      code: String(values.code ?? "").trim() || null,
      description: String(values.description ?? "").trim(),
      locationId: values.locationId ? String(values.locationId) : null,
      sortOrder: Number(values.sortOrder ?? 0),
      active: values.active !== false,
    };
    try {
      if (stationModal.id) await updateStation({ variables: { id: stationModal.id, input } });
      else await createStation({ variables: { input } });
      setStationModal({ open: false, id: null });
      await Promise.all([stations.refetch(), stationSlas.refetch()]);
      message.success(t("admin_stock.saved"));
    } catch (error) { message.error(errorText(error, t("admin_stock.save_failed"))); }
  }

  // ปิดสถานีที่ยังมีสินค้าเปิดขายผูกอยู่ = อาหารของเมนูเหล่านั้นไปโผล่ช่อง "ไม่ระบุสถานี"
  // service ปฏิเสธไว้ก่อน แล้วหน้านี้ถามซ้ำพร้อมจำนวนก่อนส่ง force
  async function archiveStationRow(row: any) {
    try {
      await archiveStation({ variables: { id: row.id, force: row.activeProductCount > 0 } });
      await Promise.all([stations.refetch(), stationSlas.refetch()]);
      message.success(t("admin_stock.station_archived"));
    } catch (error) { message.error(errorText(error, t("admin_stock.action_failed"))); }
  }

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
    // ล้างสถานีต้องส่ง null จริง ๆ — antd คืน undefined เมื่อกด clear แล้ว undefined ถูก
    // ตัดออกจาก JSON ของ GraphQL ซึ่ง service อ่านว่า "ไม่ได้ส่งมา = คงค่าเดิม" (ปุ่มล้าง
    // ที่ไม่ล้างอะไรเลย) · ส่งเฉพาะตอนช่องนี้แสดงอยู่ ไม่งั้นหน้าที่ซ่อนช่องจะล้างของร้าน
    const input: Record<string, unknown> = { productSku: selectedSku, ...values };
    if (stockSectionVisible("KITCHEN_STATION")) input.kitchenStationId = values.kitchenStationId ?? null;
    try {
      await savePolicy({ variables: { input } });
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

  function openBundle() {
    // ตัด __typename ของ Apollo ทิ้งก่อนเซ็ตฟอร์ม (เหตุผลเดียวกับ openRecipe)
    bundleForm.setFieldsValue({
      items: bundleItems.length > 0
        ? bundleItems.map((item) => ({
            componentSku: item.componentSku, componentSize: item.componentSize, qty: item.qty,
          }))
        : [{ componentSku: "", componentSize: "", qty: 1 }],
    });
    setBundleOpen(true);
  }

  async function submitBundle() {
    if (!selectedSku) return;
    const values = await bundleForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await saveBundle({
        variables: {
          bundleSku: selectedSku,
          items: (values.items ?? []).map((item: any) => ({
            componentSku: String(item.componentSku ?? "").trim(),
            componentSize: String(item.componentSize ?? "").trim(),
            qty: Number(item.qty),
          })),
        },
      });
      setBundleOpen(false);
      await model.refetch();
      message.success(t("admin_stock.bundle_saved"));
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
        {recommendedCapabilities.length > 0 && <>
          <Typography.Title level={5}>{t("admin_stock.recommended_for_shop")}</Typography.Title>
          <div className={styles.capabilityGrid}>{renderCapabilityCards(recommendedCapabilities)}</div>
        </>}
        {activeAdditionalCapabilities.length > 0 && <>
          <Typography.Title level={5}>{t("admin_stock.currently_in_use")}</Typography.Title>
          <div className={styles.capabilityGrid}>{renderCapabilityCards(activeAdditionalCapabilities)}</div>
        </>}
        {inactiveAdditionalCapabilities.length > 0 && <>
          <Button type="link" style={{ paddingInline: 0 }} onClick={() => setShowAdditionalCapabilities((current) => !current)}>
            {showAdditionalCapabilities ? t("admin_stock.hide_additional") : t("admin_stock.show_additional")}
          </Button>
          {showAdditionalCapabilities && <>
            <Typography.Title level={5}>{t("admin_stock.additional_capabilities")}</Typography.Title>
            <div className={styles.capabilityGrid}>{renderCapabilityCards(inactiveAdditionalCapabilities)}</div>
          </>}
        </>}
      </Spin>
    </section>

    {/* ทะเบียนสถานีครัว (9.54) — สถานีเคยเป็นข้อความอิสระบนสินค้า จึงเปลี่ยนชื่อไม่ได้
        เรียงไม่ได้ ปิดไม่ได้ และผูกสาขาไม่ได้ · **สถานีไม่ใช่สาขา และไม่แยกสต็อก** */}
    {stockSectionVisible("KITCHEN_STATION") && <Card
      title={t("admin_stock.stations")}
      extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openStationModal()}>
        {t("admin_stock.station_add")}
      </Button>}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("admin_stock.stations_hint")}
      </Typography.Paragraph>
      {unmappedStationNames.length > 0 && <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message={t("admin_stock.stations_unmapped")}
        description={`${t("admin_stock.stations_unmapped_desc")} — ${unmappedStationNames.join(", ")}`}
      />}
      <Spin spinning={stations.loading}>
        {stationRows.length === 0
          ? <Empty description={t("admin_stock.stations_empty")} />
          : <Table
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ x: 720 }}
              dataSource={stationRows}
              columns={[
                {
                  title: t("admin_stock.station"),
                  render: (_v: unknown, row: any) => <Space direction="vertical" size={0}>
                    <strong>{row.name}</strong>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.code}</Typography.Text>
                  </Space>,
                },
                {
                  title: t("admin_stock.station_scope"),
                  render: (_v: unknown, row: any) => row.locationId
                    ? <Tag color="geekblue">{row.locationName ?? t("admin_stock.station_scope_branch")}</Tag>
                    : <Tag>{t("admin_stock.station_scope_all")}</Tag>,
                },
                { title: t("admin_stock.station_sort"), dataIndex: "sortOrder", width: 90 },
                {
                  title: t("admin_stock.station_products"),
                  width: 130,
                  render: (_v: unknown, row: any) => `${row.activeProductCount} / ${row.productCount}`,
                },
                {
                  title: t("admin_stock.status"),
                  width: 110,
                  render: (_v: unknown, row: any) => row.active
                    ? <Tag color="green">{t("admin_stock.station_active")}</Tag>
                    : <Tag>{t("admin_stock.station_inactive")}</Tag>,
                },
                {
                  title: "",
                  width: 150,
                  render: (_v: unknown, row: any) => canEdit && <Space>
                    <Button size="small" onClick={() => openStationModal(row)}>{t("admin_stock.edit")}</Button>
                    {row.active && <Popconfirm
                      title={row.activeProductCount > 0
                        ? `${t("admin_stock.station_archive_confirm_linked")} (${row.activeProductCount})`
                        : t("admin_stock.station_archive_confirm")}
                      onConfirm={() => void archiveStationRow(row)}
                    >
                      <Button size="small" danger>{t("admin_stock.station_archive")}</Button>
                    </Popconfirm>}
                  </Space>,
                },
              ]}
            />}
      </Spin>
    </Card>}

    {/* เกณฑ์เวลาของจอครัว (9.53) — บาร์ชงเสร็จใน 2 นาที ครัวร้อน 8-12 นาทีเป็นปกติ
        เกณฑ์เดียวทั้งร้านทำให้ครัวร้อนแดงตลอดจนสีเลิกมีความหมาย */}
    {stockSectionVisible("STATION_SLA") && <Card title={t("admin_stock.station_sla")}>
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
    </Card>}

    <Card title={t("admin_stock.product_model")} extra={
      <Button type="link" onClick={() => setShowAdvancedProductModel((current) => !current)}>
        {showAdvancedProductModel ? t("admin_stock.hide_advanced_model") : t("admin_stock.show_advanced_model")}
      </Button>
    }>
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
            <Form.Item name="stockPolicy" label={t("admin_stock.stock_policy")} rules={[{ required: true }]}><Select options={policyOptions} /></Form.Item>
            <Space wrap align="start">
              <Form.Item name="baseUnit" label={t("admin_stock.base_unit")} rules={[{ required: true }]}><Input placeholder="PIECE / GRAM" /></Form.Item>
              <Form.Item name="displayUnit" label={t("admin_stock.display_unit")}><Input placeholder={t("admin_stock.display_unit_hint")} /></Form.Item>
              <Form.Item name="displayPrecision" label={t("admin_stock.precision")}><InputNumber min={0} max={6} precision={0} /></Form.Item>
            </Space>
            {stockSectionVisible("LOT_EXPIRY") && <Space wrap>
              <Form.Item name="lotTracking" valuePropName="checked"><Checkbox>{t("admin_stock.lot")}</Checkbox></Form.Item>
              <Form.Item name="expiryTracking" valuePropName="checked"><Checkbox>{t("admin_stock.expiry")}</Checkbox></Form.Item>
              <Form.Item name="fefo" valuePropName="checked"><Checkbox>FEFO</Checkbox></Form.Item>
            </Space>}
            {/* เลือกจากทะเบียนสถานี (9.54) ไม่ใช่พิมพ์ชื่ออิสระ — ชื่อที่พิมพ์เกินมาหนึ่ง
                ช่องว่างเคยกลายเป็นสถานีใหม่ทั้งสถานีที่ไม่มีใครตั้งเกณฑ์เวลาให้ได้ */}
            {stockSectionVisible("KITCHEN_STATION") && <Form.Item
              name="kitchenStationId"
              label={t("admin_stock.kitchen_station")}
              extra={t("admin_stock.kitchen_station_hint")}
            >
              <Select
                allowClear showSearch optionFilterProp="label"
                placeholder={t("admin_stock.kitchen_station_placeholder")}
                options={stationRows.filter((row) => row.active || row.id === policyForm.getFieldValue("kitchenStationId"))
                  .map((row) => ({
                    value: row.id,
                    label: row.active ? row.name : `${row.name} (${t("admin_stock.station_inactive")})`,
                  }))}
              />
            </Form.Item>}
            <Form.Item name="deactivateDerived" valuePropName="checked">
              <Checkbox>{t("admin_stock.confirm_deactivate_derived")}</Checkbox>
            </Form.Item>
            {stockSectionVisible("SCALE") && <Space wrap align="start">
              <Form.Item name="scaleItemCode" label={t("admin_stock.scale_code")}><Input maxLength={5} placeholder="00001" /></Form.Item>
              <Form.Item name="scaleSize" label={t("admin_stock.scale_size")}><Select allowClear options={sizes.map((s) => ({ value: s, label: s }))} /></Form.Item>
            </Space>}
          </Form>
        </Card>

        <Card title={t("admin_stock.safety_note")}>
          <Alert type="info" showIcon message={t("admin_stock.snapshot_title")} description={t("admin_stock.snapshot_desc")} />
          <Typography.Paragraph style={{ marginTop: 16 }}>{t("admin_stock.unit_note")}</Typography.Paragraph>
        </Card>
      </div>

      {stockSectionVisible("BUNDLE") && <Card
        title={t("admin_stock.bundle_items")}
        extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openBundle()}>{t("admin_stock.edit_bundle_items")}</Button>}
      >
        <Table rowKey={(row: BundleItem) => `${row.componentSku}:${row.componentSize}`} pagination={false} dataSource={bundleItems}
          locale={{ emptyText: <Empty description={t("admin_stock.no_bundle_items")} /> }} columns={[
          { title: t("admin_stock.component_sku"), dataIndex: "componentSku", width: 200 },
          { title: t("admin_stock.name"), dataIndex: "componentName" },
          { title: t("admin_stock.size"), dataIndex: "componentSize", width: 140 },
          { title: t("admin_stock.qty_per_bundle"), dataIndex: "qty", width: 140 },
        ]} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_stock.bundle_hint")}</Typography.Text>
      </Card>}

      {stockSectionVisible("RECIPES") && <Card title={t("admin_stock.recipes")} extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openRecipe()}>{t("admin_stock.new_recipe")}</Button>}>
        <Table rowKey="id" pagination={false} dataSource={recipes} locale={{ emptyText: <Empty description={t("admin_stock.no_recipes")} /> }} columns={[
          { title: t("admin_stock.size"), dataIndex: "size" },
          { title: t("admin_stock.version"), dataIndex: "version", width: 90 },
          { title: t("admin_stock.output_qty"), dataIndex: "outputQty", width: 110 },
          { title: t("admin_stock.components"), render: (_: unknown, row: Recipe) => row.items.map((i) => `${i.sku}/${i.size} × ${i.qty}`).join(", ") },
          { title: t("admin_stock.status"), render: (_: unknown, row: Recipe) => <Tag color={row.active ? "green" : "default"}>{row.active ? t("admin_stock.active") : t("admin_stock.inactive")}</Tag> },
          ...(canEdit ? [{ title: "", width: 90, render: (_: unknown, row: Recipe) => <Button size="small" onClick={() => openRecipe(row)}>{t("admin_stock.edit")}</Button> }] : []),
        ]} />
      </Card>}

      {stockSectionVisible("MODIFIERS") && <Card title={t("admin_stock.modifiers")} extra={canEdit && <Button icon={<PlusOutlined />} onClick={() => openModifier()}>{t("admin_stock.new_modifier")}</Button>}>
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
      </Card>}
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

    <Modal
      open={bundleOpen}
      title={t("admin_stock.edit_bundle_items")}
      onCancel={() => setBundleOpen(false)}
      onOk={() => void submitBundle()}
      confirmLoading={bundleMutation.loading}
      width={760}
    >
      <Alert type="info" showIcon message={t("admin_stock.bundle_modal_hint")} style={{ marginBottom: 16 }} />
      <Form form={bundleForm} layout="vertical">
        <Form.List name="items">
          {(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>
            {fields.map(({ key, name, ...rest }) => (
              <div className={styles.componentRow} key={key}>
                <Form.Item {...rest} name={[name, "componentSku"]} rules={[{ required: true }]}><Input placeholder={t("admin_stock.component_sku")} /></Form.Item>
                <Form.Item {...rest} name={[name, "componentSize"]} rules={[{ required: true }]}><Input placeholder={t("admin_stock.component_size")} /></Form.Item>
                <Form.Item {...rest} name={[name, "qty"]} rules={[{ required: true }]}>
                  <InputNumber style={{ width: "100%" }} min={1} precision={0} placeholder="Qty" />
                </Form.Item>
                <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} aria-label={t("admin_stock.remove_component")} />
              </div>
            ))}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ qty: 1 })}>{t("admin_stock.add_component")}</Button>
          </Space>}
        </Form.List>
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

    <Modal
      open={stationModal.open}
      title={stationModal.id ? t("admin_stock.station_edit") : t("admin_stock.station_add")}
      onCancel={() => setStationModal({ open: false, id: null })}
      onOk={() => void submitStation()}
      confirmLoading={updateStationState.loading}
    >
      <Form form={stationForm} layout="vertical">
        <Form.Item name="name" label={t("admin_stock.station_name")} rules={[{ required: true }]}>
          <Input placeholder={t("admin_stock.station_name_placeholder")} maxLength={64} />
        </Form.Item>
        <Form.Item name="code" label={t("admin_stock.station_code")} extra={t("admin_stock.station_code_hint")}>
          <Input placeholder="HOT / BAR" maxLength={32} />
        </Form.Item>
        <Form.Item name="description" label={t("admin_stock.station_description")}>
          <Input.TextArea rows={2} maxLength={200} />
        </Form.Item>
        <Form.Item name="locationId" label={t("admin_stock.station_scope")} extra={t("admin_stock.station_scope_hint")}>
          <Select options={locationOptions} />
        </Form.Item>
        <Space wrap align="start">
          <Form.Item name="sortOrder" label={t("admin_stock.station_sort")} extra={t("admin_stock.station_sort_hint")}>
            <InputNumber min={-9999} max={9999} precision={0} />
          </Form.Item>
          <Form.Item name="active" label={t("admin_stock.station_active")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  </div>;
}
