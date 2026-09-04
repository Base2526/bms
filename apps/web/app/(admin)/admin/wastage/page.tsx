"use client";

import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Table, Tag, message } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

const Q_WASTAGE = gql`
  query WastageHistory {
    bmsLocations { id code name branchCode active }
    bmsInventoryWastage(limit: 100) { id locationId locationName productSku productName size qty reason orderId actorName createdAt }
  }
`;
const Q_PRODUCTS = gql`
  query WastageProducts($search: String) {
    bmsProducts(search: $search, limit: 30, offset: 0) { items { sku name active variants { locationId size available } } }
  }
`;
const M_WASTAGE = gql`
  mutation RecordWastage($input: BmsInventoryWastageInput!) { bmsRecordInventoryWastage(input: $input) { id } }
`;
type Product = { sku: string; name: string; active: boolean; variants: Array<{ locationId: string; size: string; available: number }> };
type WastageRow = { id: string; locationId: string; locationName: string | null; productSku: string; productName: string; size: string; qty: number; reason: string; orderId: string | null; actorName: string | null; createdAt: string };

export default function WastagePage() {
  const { t, lang } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const canView = can("product.view");
  const canAdjust = can("stock.adjust");
  const [search, setSearch] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [form] = Form.useForm();
  const history = useQuery(Q_WASTAGE, { skip: !canView, fetchPolicy: "cache-and-network" });
  const [loadProducts, products] = useLazyQuery(Q_PRODUCTS, { fetchPolicy: "network-only" });
  const [record, recordState] = useMutation(M_WASTAGE);
  if (!permsLoading && !canView) return <Alert closable type="error" showIcon message={t("admin_wastage.no_permission")} />;

  const productRows: Product[] = products.data?.bmsProducts?.items ?? [];
  const selected = productRows.find((row) => row.sku === selectedSku) ?? null;
  const locationId = Form.useWatch("locationId", form);
  const variants = selected?.variants.filter((variant) => variant.locationId === locationId) ?? [];
  const rows: WastageRow[] = history.data?.bmsInventoryWastage ?? [];

  async function submit() {
    const values = await form.validateFields().catch(() => null);
    if (!values || !selectedSku) return;
    try {
      await record({ variables: { input: { ...values, productSku: selectedSku, orderId: values.orderId?.trim() || null } } });
      form.resetFields(["size", "qty", "reason", "orderId"]);
      await history.refetch();
      await loadProducts({ variables: { search: selectedSku } });
      message.success(t("admin_wastage.saved"));
    } catch (error) { message.error(error instanceof Error ? error.message : t("admin_wastage.save_failed")); }
  }

  return <main className={styles.page}>
    <section className={styles.hero}><h1>{t("admin_wastage.title")}</h1><p>{t("admin_wastage.subtitle")}</p></section>
    {!canAdjust && <Alert closable type="info" showIcon message={t("admin_wastage.read_only")} />}
    <div className={styles.grid}>
      <Card title={t("admin_wastage.record_title")}>
        <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => loadProducts({ variables: { search: search.trim() } })} placeholder={t("admin_wastage.search_product")} />
          <Button icon={<SearchOutlined />} loading={products.loading} onClick={() => loadProducts({ variables: { search: search.trim() } })} />
        </Space.Compact>
        {productRows.length > 0 && <Select
          style={{ width: "100%", marginBottom: 14 }} showSearch optionFilterProp="label"
          placeholder={t("admin_wastage.select_product")} value={selectedSku}
          onChange={(sku) => { setSelectedSku(sku); form.resetFields(["size"]); }}
          options={productRows.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
        />}
        <Form form={form} layout="vertical" disabled={!canAdjust || !selectedSku}>
          <Form.Item name="locationId" label={t("admin_wastage.location")} rules={[{ required: true }]}>
            <Select onChange={() => form.resetFields(["size"])} options={(history.data?.bmsLocations ?? []).filter((l: any) => l.active).map((l: any) => ({ value: l.id, label: `${l.branchCode} · ${l.name}` }))} />
          </Form.Item>
          <Form.Item name="size" label={t("admin_wastage.size")} rules={[{ required: true }]}>
            <Select options={variants.map((v) => ({ value: v.size, label: `${v.size} · ${t("admin_wastage.available")} ${v.available}` }))} />
          </Form.Item>
          <Form.Item name="qty" label={t("admin_wastage.qty")} rules={[{ required: true }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="reason" label={t("admin_wastage.reason")} rules={[{ required: true }]}><Input.TextArea maxLength={500} rows={3} /></Form.Item>
          <Form.Item name="orderId" label={t("admin_wastage.order_optional")}><Input /></Form.Item>
          <Button block type="primary" danger loading={recordState.loading} onClick={() => void submit()}>{t("admin_wastage.confirm")}</Button>
        </Form>
      </Card>
      <Card title={t("admin_wastage.history")} extra={<Button icon={<ReloadOutlined />} onClick={() => history.refetch()} loading={history.loading}>{t("admin_wastage.refresh")}</Button>}>
        {history.error && <Alert closable type="error" showIcon message={history.error.message} style={{ marginBottom: 12 }} />}
        <Table rowKey="id" loading={history.loading} dataSource={rows} pagination={{ pageSize: 20, showSizeChanger: false }} columns={[
          { title: t("admin_wastage.when"), dataIndex: "createdAt", width: 150, render: (value: string) => new Date(value).toLocaleString(lang === "th" ? "th-TH" : "en-GB", { dateStyle: "short", timeStyle: "short" }) },
          { title: t("admin_wastage.product"), render: (_: unknown, row: WastageRow) => <><strong>{row.productName}</strong><br /><small>{row.productSku} · {row.size}</small></> },
          { title: t("admin_wastage.location"), dataIndex: "locationName" },
          { title: t("admin_wastage.qty"), dataIndex: "qty", width: 80, render: (value: number) => <span className={styles.qty}>−{value}</span> },
          { title: t("admin_wastage.reason"), dataIndex: "reason" },
          { title: t("admin_wastage.actor"), dataIndex: "actorName", render: (value: string | null) => value || <Tag>{t("admin_wastage.system")}</Tag> },
        ]} />
      </Card>
    </div>
  </main>;
}
