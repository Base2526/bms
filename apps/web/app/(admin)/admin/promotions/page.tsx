"use client";

import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Table, Tag, message } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

const Q_PROMOTIONS = gql`
  query ProductPromotions($locationId: ID, $includeInactive: Boolean) {
    bmsPromotionLocations { id code name branchCode active }
    bmsProductPromotions(locationId: $locationId, includeInactive: $includeInactive) {
      id productSku productName locationId locationName
      kind buyQty getQty bundlePrice buySize giftSku giftSize active startsAt endsAt note updatedAt
    }
  }
`;
const Q_PRODUCTS = gql`
  query PromotionProducts($search: String) {
    bmsProducts(search: $search, limit: 30, offset: 0) { items { sku name catalogVariants { code displayName active } } }
  }
`;
const M_UPSERT = gql`
  mutation UpsertPromotion($input: BmsProductPromotionInput!) {
    bmsUpsertProductPromotion(input: $input) { id productSku locationId kind }
  }
`;
const M_DEACTIVATE = gql`
  mutation DeactivatePromotion($id: ID!) { bmsDeactivateProductPromotion(id: $id) }
`;
const Q_TIERS = gql`
  query ProductPriceTiers($productSku: String, $locationId: ID) {
    bmsProductPriceTiers(productSku: $productSku, locationId: $locationId) {
      productSku productName locationId locationName minQty scope size unitPrice discountPct updatedAt
    }
  }
`;
const M_REPLACE_TIERS = gql`
  mutation ReplacePriceTiers($input: BmsReplacePriceTiersInput!) {
    bmsReplaceProductPriceTiers(input: $input) { productSku locationId minQty scope size unitPrice discountPct }
  }
`;

type PriceTierRow = {
  productSku: string; productName: string | null;
  locationId: string | null; locationName: string | null;
  minQty: number; scope: "PER_VARIANT_FIXED" | "CROSS_VARIANT_PERCENT";
  size: string | null; unitPrice: number | null; discountPct: number | null; updatedAt: string;
};
type PromotionRow = {
  id: string; productSku: string; productName: string | null;
  locationId: string | null; locationName: string | null;
  kind: "BUY_X_GET_Y" | "N_FOR_PRICE" | "BUY_A_GET_B";
  buySize: string | null; giftSku: string | null; giftSize: string | null;
  buyQty: number; getQty: number | null; bundlePrice: number | null;
  active: boolean; startsAt: string | null; endsAt: string | null; note: string | null; updatedAt: string;
};
type ProductOption = { sku: string; name: string; catalogVariants: Array<{ code: string; displayName: string | null; active: boolean }> };

const ALL_BRANCHES = "__ALL__";

export default function PromotionsPage() {
  const { t, lang } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canView = can("product.view");
  const canEdit = can("product.edit");
  const [filterLocation, setFilterLocation] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption>();
  const [selectedGift, setSelectedGift] = useState<ProductOption>();
  const [form] = Form.useForm();
  const [tierSku, setTierSku] = useState<string | null>(null);
  const [tierLocation, setTierLocation] = useState<string>(ALL_BRANCHES);
  const [tierDraft, setTierDraft] = useState<Array<{ minQty: number; unitPrice: number }>>([]);

  const list = useQuery(Q_PROMOTIONS, {
    skip: !canView,
    variables: { locationId: filterLocation, includeInactive },
    fetchPolicy: "cache-and-network",
  });
  const [loadProducts, products] = useLazyQuery(Q_PRODUCTS, { fetchPolicy: "network-only" });
  const [loadGifts, gifts] = useLazyQuery(Q_PRODUCTS, { fetchPolicy: "network-only" });
  const [upsert, upsertState] = useMutation(M_UPSERT);
  const [deactivate] = useMutation(M_DEACTIVATE);
  // ราคาส่งแยกสาขา (9.65) — อยู่หน้าเดียวกับโปรโมชันเพราะเป็นคำถามเดียวกัน
  // ("สาขานี้ขายราคาต่างจากส่วนกลางตรงไหน") และตอบด้วยสิทธิ์ชุดเดียวกัน
  const tierList = useQuery(Q_TIERS, {
    skip: !canView,
    variables: { productSku: tierSku, locationId: tierLocation === ALL_BRANCHES ? null : tierLocation },
    fetchPolicy: "cache-and-network",
  });
  const [replaceTiers, replaceTiersState] = useMutation(M_REPLACE_TIERS);

  const kind = Form.useWatch("kind", form) ?? "N_FOR_PRICE";
  const giftSku = Form.useWatch("giftSku", form);

  if (!permsLoading && !canView) {
    return <Alert closable type="error" showIcon message={t("admin_promotions.no_permission")} />;
  }

  const locations = (list.data?.bmsPromotionLocations ?? []).filter((l: any) => l.active);
  const rows: PromotionRow[] = list.data?.bmsProductPromotions ?? [];
  const withSelected = (rows: ProductOption[], selected?: ProductOption) =>
    selected && !rows.some((p) => p.sku === selected.sku) ? [selected, ...rows] : rows;
  const productRows = withSelected(products.data?.bmsProducts?.items ?? [], selectedProduct);
  const giftRows = withSelected(gifts.data?.bmsProducts?.items ?? [], selectedGift);
  const sizeOptions = (p?: ProductOption) => (p?.catalogVariants ?? []).filter((v) => v.active)
    .map((v) => ({ value: v.code, label: v.displayName ? `${v.code} · ${v.displayName}` : v.code }));

  async function submit() {
    const values = await form.validateFields().catch(() => null);
    if (!values || !selectedSku) return;
    const locationId = values.locationId === ALL_BRANCHES ? null : values.locationId ?? null;
    try {
      await upsert({
        variables: {
          input: {
            productSku: selectedSku,
            locationId,
            kind: values.kind,
            buyQty: values.buyQty,
            getQty: values.kind !== "N_FOR_PRICE" ? values.getQty : null,
            bundlePrice: values.kind === "N_FOR_PRICE" ? values.bundlePrice : null,
            buySize: values.kind === "BUY_A_GET_B" ? values.buySize : null,
            giftSku: values.kind === "BUY_A_GET_B" ? values.giftSku : null,
            giftSize: values.kind === "BUY_A_GET_B" ? values.giftSize : null,
            startsAt: values.startsAt ? values.startsAt.toISOString() : null,
            endsAt: values.endsAt ? values.endsAt.toISOString() : null,
            note: values.note?.trim() || null,
          },
        },
      });
      form.resetFields(["buyQty", "getQty", "bundlePrice", "startsAt", "endsAt", "note", "buySize", "giftSku", "giftSize"]);
      await list.refetch();
      message.success(t("admin_promotions.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_promotions.save_failed"));
    }
  }

  /**
   * บันทึกบันไดราคาส่งของ (สินค้า, สาขา) ทั้งชุด
   *
   * ส่งลิสต์ว่าง = เอาบันไดของสาขานี้ออก แล้วสาขากลับไปใช้ของทั้งร้าน — ต้องเป็นการกระทำ
   * ที่ทำได้ ไม่งั้นสาขาที่เคยตั้งราคาของตัวเองจะเลิกใช้ไม่ได้เลย
   */
  async function saveTiers() {
    if (!tierSku) return;
    try {
      await replaceTiers({
        variables: {
          input: {
            productSku: tierSku,
            locationId: tierLocation === ALL_BRANCHES ? null : tierLocation,
            tiers: tierDraft
              .filter((row) => Number(row.minQty) >= 2 && Number(row.unitPrice) >= 0)
              .map((row) => ({ minQty: Math.trunc(Number(row.minQty)), scope: "PER_VARIANT_FIXED", unitPrice: Number(row.unitPrice) })),
          },
        },
      });
      await tierList.refetch();
      message.success(t("admin_promotions.tier_saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_promotions.save_failed"));
    }
  }

  async function stop(row: PromotionRow) {
    try {
      await deactivate({ variables: { id: row.id } });
      await list.refetch();
      message.success(t("admin_promotions.stopped"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_promotions.save_failed"));
    }
  }

  function describe(row: PromotionRow) {
    if (row.kind === "BUY_A_GET_B") return t("admin_promotions.describe_cross_sku")
      .replace("{buy}", String(row.buyQty)).replace("{buySize}", row.buySize ?? "")
      .replace("{gift}", row.giftSku ?? "").replace("{giftSize}", row.giftSize ?? "").replace("{get}", String(row.getQty ?? 0));
    return row.kind === "BUY_X_GET_Y"
      ? t("admin_promotions.describe_buy_x").replace("{buy}", String(row.buyQty)).replace("{get}", String(row.getQty ?? 0))
      : t("admin_promotions.describe_n_for").replace("{qty}", String(row.buyQty)).replace("{price}", Number(row.bundlePrice ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 }));
  }

  return <main className={styles.page}>
    <section className={styles.hero}>
      <h1>{t("admin_promotions.title")}</h1>
      <p>{t("admin_promotions.subtitle")}</p>
    </section>
    {!canEdit && <Alert closable type="info" showIcon message={t("admin_promotions.read_only")} />}
    <Alert type="info" showIcon closable message={t("admin_promotions.scope_hint")} />
    <div className={styles.grid}>
      <Card title={t("admin_promotions.form_title")}>
        <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => loadProducts({ variables: { search: search.trim() } })}
            placeholder={t("admin_promotions.search_product")}
          />
          <Button icon={<SearchOutlined />} loading={products.loading} onClick={() => loadProducts({ variables: { search: search.trim() } })} />
        </Space.Compact>
        {productRows.length > 0 && <Select
          aria-label={t("admin_promotions.select_product")}
          style={{ width: "100%", marginBottom: 14 }} showSearch optionFilterProp="label"
          placeholder={t("admin_promotions.select_product")} value={selectedSku}
          onChange={(sku) => {
            setSelectedSku(sku); setSelectedProduct(productRows.find((p) => p.sku === sku));
            form.resetFields(["buySize"]);
            if (sku === giftSku) { form.resetFields(["giftSku", "giftSize"]); setSelectedGift(undefined); }
          }}
          options={productRows.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
        />}
        <Form form={form} layout="vertical" disabled={!canEdit || !selectedSku} initialValues={{ kind: "N_FOR_PRICE", locationId: ALL_BRANCHES, buyQty: 3 }}>
          <Form.Item name="locationId" label={t("admin_promotions.scope")} rules={[{ required: true }]}>
            <Select options={[
              { value: ALL_BRANCHES, label: t("admin_promotions.scope_all") },
              ...locations.map((l: any) => ({ value: l.id, label: `${l.branchCode} · ${l.name}` })),
            ]} />
          </Form.Item>
          <Form.Item name="kind" label={t("admin_promotions.kind")} rules={[{ required: true }]}>
            <Select options={[
              { value: "N_FOR_PRICE", label: t("admin_promotions.kind_n_for") },
              { value: "BUY_X_GET_Y", label: t("admin_promotions.kind_buy_x") },
              { value: "BUY_A_GET_B", label: t("admin_promotions.kind_cross_sku") },
            ]} />
          </Form.Item>
          {kind === "BUY_A_GET_B" && <>
            <Form.Item name="buySize" label={t("admin_promotions.buy_size")} rules={[{ required: true }]}>
              <Select options={sizeOptions(productRows.find((p) => p.sku === selectedSku))} />
            </Form.Item>
            <Form.Item name="giftSku" label={t("admin_promotions.gift_product")} rules={[{ required: true }]}>
              <Select showSearch filterOption={false} loading={gifts.loading}
                onSearch={(search) => { void loadGifts({ variables: { search: search.trim() } }); }}
                onChange={(sku) => { setSelectedGift(giftRows.find((p) => p.sku === sku)); form.resetFields(["giftSize"]); }}
                options={giftRows.filter((p) => p.sku !== selectedSku).map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))} />
            </Form.Item>
            <Form.Item name="giftSize" label={t("admin_promotions.gift_size")} rules={[{ required: true }]}>
              <Select options={sizeOptions(giftRows.find((p) => p.sku === giftSku))} />
            </Form.Item>
            <Alert type="info" showIcon closable message={t("admin_promotions.cross_sku_policy")} style={{ marginBottom: 16 }} />
          </>}
          <Form.Item name="buyQty" label={kind !== "N_FOR_PRICE" ? t("admin_promotions.buy_qty") : t("admin_promotions.bundle_qty")} rules={[{ required: true }]}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          {kind !== "N_FOR_PRICE"
            ? <Form.Item name="getQty" label={t("admin_promotions.get_qty")} rules={[{ required: true }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            : <Form.Item name="bundlePrice" label={t("admin_promotions.bundle_price")} rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} style={{ width: "100%" }} />
              </Form.Item>}
          <Form.Item name="startsAt" label={t("admin_promotions.starts_at")}><DatePicker showTime style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="endsAt" label={t("admin_promotions.ends_at")}><DatePicker showTime style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="note" label={t("admin_promotions.note")}><Input.TextArea rows={2} maxLength={300} /></Form.Item>
          <Button block type="primary" loading={upsertState.loading} onClick={() => void submit()}>{t("admin_promotions.save")}</Button>
        </Form>
      </Card>

      {/* ราคาส่งตามจำนวนแยกสาขา (9.65) — บันไดของสาขา "แทนที่" ของทั้งร้านทั้งชุด
          ไม่ใช่ผสมกัน จึงแก้ทีละบันได ไม่ใช่ทีละขั้น (เหตุผลเต็มอยู่ใน migration) */}
      <Card title={t("admin_promotions.tier_title")}>
        <Alert type="info" showIcon closable style={{ marginBottom: 12 }} message={t("admin_promotions.tier_hint")} />
        <Space.Compact style={{ width: "100%", marginBottom: 10 }}>
          <Select
            style={{ width: "100%" }} showSearch optionFilterProp="label" allowClear
            placeholder={t("admin_promotions.select_product")} value={tierSku}
            onChange={(sku) => { setTierSku(sku ?? null); setTierDraft([]); }}
            options={productRows.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
          />
        </Space.Compact>
        <Select
          style={{ width: "100%", marginBottom: 12 }} value={tierLocation}
          onChange={(value) => { setTierLocation(value); setTierDraft([]); }}
          options={[
            { value: ALL_BRANCHES, label: t("admin_promotions.scope_all") },
            ...locations.map((l: any) => ({ value: l.id, label: `${l.branchCode} · ${l.name}` })),
          ]}
        />
        <Table
          rowKey={(row: PriceTierRow) => `${row.locationId ?? "all"}-${row.scope}-${row.size ?? ""}-${row.minQty}`}
          size="small" loading={tierList.loading} pagination={false} scroll={{ x: 320 }}
          dataSource={(tierList.data?.bmsProductPriceTiers ?? []).filter((row: PriceTierRow) =>
            (tierLocation === ALL_BRANCHES ? row.locationId == null : row.locationId === tierLocation))}
          locale={{ emptyText: t("admin_promotions.tier_empty") }}
          columns={[
            { title: t("admin_promotions.tier_min_qty"), dataIndex: "minQty", width: 110 },
            {
              title: t("admin_promotions.tier_unit_price"),
              render: (_: unknown, row: PriceTierRow) => row.scope === "CROSS_VARIANT_PERCENT"
                ? `-${row.discountPct}%`
                : Number(row.unitPrice ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
            },
            { title: t("admin_promotions.tier_size"), dataIndex: "size", width: 110, render: (v: string | null) => v ?? "—" },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          {tierDraft.map((row, index) => <Space key={index} style={{ display: "flex", marginBottom: 8 }}>
            <InputNumber min={2} value={row.minQty} placeholder={t("admin_promotions.tier_min_qty")}
              onChange={(value) => setTierDraft((current) => current.map((r, i) => i === index ? { ...r, minQty: Number(value ?? 0) } : r))} />
            <InputNumber min={0} step={0.01} value={row.unitPrice} placeholder={t("admin_promotions.tier_unit_price")}
              onChange={(value) => setTierDraft((current) => current.map((r, i) => i === index ? { ...r, unitPrice: Number(value ?? 0) } : r))} />
            <Button danger size="small" onClick={() => setTierDraft((current) => current.filter((_, i) => i !== index))}>
              {t("admin_promotions.tier_remove")}
            </Button>
          </Space>)}
          <Space>
            <Button disabled={!canEdit || !tierSku} onClick={() => setTierDraft((current) => [...current, { minQty: 2, unitPrice: 0 }])}>
              {t("admin_promotions.tier_add")}
            </Button>
            <Button type="primary" disabled={!canEdit || !tierSku} loading={replaceTiersState.loading} onClick={() => void saveTiers()}>
              {t("admin_promotions.tier_save")}
            </Button>
          </Space>
        </div>
      </Card>

      <Card
        className={styles.promotionList}
        title={t("admin_promotions.list_title")}
        extra={<Space>
          <Select
            style={{ minWidth: 190 }} value={filterLocation ?? ALL_BRANCHES}
            onChange={(value) => setFilterLocation(value === ALL_BRANCHES ? null : value)}
            options={[
              { value: ALL_BRANCHES, label: t("admin_promotions.filter_all") },
              ...locations.map((l: any) => ({ value: l.id, label: `${l.branchCode} · ${l.name}` })),
            ]}
          />
          <Button onClick={() => setIncludeInactive((prev) => !prev)}>
            {includeInactive ? t("admin_promotions.hide_stopped") : t("admin_promotions.show_stopped")}
          </Button>
          <Button icon={<ReloadOutlined />} loading={list.loading} onClick={() => list.refetch()} />
        </Space>}
      >
        {list.error && <Alert closable type="error" showIcon message={list.error.message} style={{ marginBottom: 12 }} />}
        <Table rowKey="id" scroll={{ x: 700 }} loading={list.loading} dataSource={rows} pagination={{ pageSize: 20, showSizeChanger: false }} columns={[
          {
            title: t("admin_promotions.product"),
            render: (_: unknown, row: PromotionRow) => <><strong>{row.productName ?? row.productSku}</strong><br /><small>{row.productSku}</small></>,
          },
          {
            title: t("admin_promotions.scope"),
            width: 180,
            render: (_: unknown, row: PromotionRow) => row.locationId
              ? <Tag color="purple">{row.locationName ?? row.locationId}</Tag>
              : <Tag>{t("admin_promotions.scope_all")}</Tag>,
          },
          { title: t("admin_promotions.deal"), render: (_: unknown, row: PromotionRow) => <span className={styles.saving}>{describe(row)}</span> },
          {
            title: t("admin_promotions.window"),
            render: (_: unknown, row: PromotionRow) => {
              const fmt = (value: string | null) => value
                ? new Date(value).toLocaleString(lang === "th" ? "th-TH" : "en-GB", { dateStyle: "short", timeStyle: "short" })
                : "—";
              return <small>{fmt(row.startsAt)} → {fmt(row.endsAt)}</small>;
            },
          },
          {
            title: "",
            width: 110,
            render: (_: unknown, row: PromotionRow) => row.active
              ? <Button size="small" danger disabled={!canEdit} onClick={() => void stop(row)}>{t("admin_promotions.stop")}</Button>
              : <Tag>{t("admin_promotions.stopped_tag")}</Tag>,
          },
        ]} />
      </Card>
    </div>
  </main>;
}
