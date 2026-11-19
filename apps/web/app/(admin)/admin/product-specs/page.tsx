"use client";

import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_PRODUCTS = gql`query SpecProducts($search: String) {
  bmsProducts(search: $search, limit: 30) { items { sku name active catalogVariants { code active } } }
}`;
type SpecRow = { product_sku: string; variant_code: string; revision_no: number;
  status: "DRAFT" | "PUBLISHED"; length_mm: string | null; width_mm: string | null;
  diameter_mm: string | null; thickness_mm: string | null; nominal_weight_g: string | null;
  grade: string | null; standard_code: string | null; usage_limitations: string | null;
  source_reference: string; published_at: string | null };
type SpecForm = { sku: string; variantCode: string; lengthMm?: number; widthMm?: number;
  diameterMm?: number; thicknessMm?: number; nominalWeightG?: number;
  grade?: string; standardCode?: string; usageLimitations?: string; sourceReference: string };

export default function ProductSpecsPage() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const [form] = Form.useForm<SpecForm>();
  const [search, setSearch] = useState("");
  const [sku, setSku] = useState("");
  const [rows, setRows] = useState<SpecRow[]>([]);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const deferredSearch = useDeferredValue(search);
  const { data } = useQuery(Q_PRODUCTS, { variables: { search: deferredSearch } });
  const products: Array<{ sku: string; name: string; active: boolean;
    catalogVariants: Array<{ code: string; active: boolean }> }> = data?.bmsProducts?.items ?? [];
  const selectedProduct = products.find((p) => p.sku === sku);

  async function api(productSku: string, init?: RequestInit) {
    const response = await fetch(`/api/bms/product-specs/${encodeURIComponent(productSku)}`, {
      ...init, cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.status || payload.error || String(response.status));
    return payload;
  }
  async function refresh(productSku = sku) {
    if (!productSku) { setRows([]); return; }
    try { setRows((await api(productSku)).items ?? []); }
    catch (error) { message.error(`${t("admin_product_specs.error")}: ${String(error)}`); }
  }
  useEffect(() => { void refresh(sku); }, [sku]);

  async function stage(values: SpecForm) {
    setBusy(true);
    try {
      const result = await api(values.sku, { method: "POST", body: JSON.stringify({
        ...values, action: "STAGE", requestKey: requestKey.current,
      }) });
      message.success(`${t("admin_product_specs.draft_saved")} #${result.revisionNo}`);
      requestKey.current = crypto.randomUUID();
      await refresh(values.sku);
    } catch (error) { message.error(`${t("admin_product_specs.error")}: ${String(error)}`); }
    finally { setBusy(false); }
  }
  function publish(row: SpecRow) {
    Modal.confirm({
      title: t("admin_product_specs.publish_title"),
      content: `${row.product_sku} · ${row.variant_code} · #${row.revision_no} · ${row.source_reference}`,
      okText: t("admin_product_specs.publish"),
      onOk: async () => {
        setBusy(true);
        try {
          await api(row.product_sku, { method: "POST", body: JSON.stringify({
            action: "PUBLISH", variantCode: row.variant_code, revisionNo: row.revision_no,
            confirmed: true,
          }) });
          message.success(t("admin_product_specs.published"));
          await refresh(row.product_sku);
        } catch (error) { message.error(`${t("admin_product_specs.error")}: ${String(error)}`); }
        finally { setBusy(false); }
      },
    });
  }
  const dimensions = ["lengthMm", "widthMm", "diameterMm", "thicknessMm", "nominalWeightG"] as const;
  const dimensionLabels = ["length_mm", "width_mm", "diameter_mm", "thickness_mm", "nominal_weight_g"] as const;
  return <div style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>
    <Typography.Title level={2}>{t("admin_product_specs.title")}</Typography.Title>
    <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
      message={t("admin_product_specs.workflow")}/>
    <Form<SpecForm> form={form} layout="vertical" onFinish={stage}
      onValuesChange={() => { requestKey.current = crypto.randomUUID(); }}>
      <Space wrap align="start" style={{ width: "100%" }}>
        <Form.Item name="sku" label={t("admin_product_specs.product")} rules={[{ required: true }]}>
          <Select style={{ minWidth: 280 }} showSearch filterOption={false}
            onSearch={setSearch} onChange={(value) => { setSku(value); form.setFieldValue("variantCode", undefined); }}
            options={products.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}/>
        </Form.Item>
        <Form.Item name="variantCode" label={t("admin_product_specs.variant")} rules={[{ required: true }]}>
          <Select style={{ minWidth: 160 }} options={(selectedProduct?.catalogVariants ?? [])
            .filter((v) => v.active).map((v) => ({ value: v.code, label: v.code }))}/>
        </Form.Item>
      </Space>
      <Space wrap align="start">
        {dimensions.map((field, i) => <Form.Item key={field} name={field}
          label={t(`admin_product_specs.${dimensionLabels[i]}`)}>
          <InputNumber min={0.001} max={1_000_000_000} precision={3} style={{ width: 170 }}/>
        </Form.Item>)}
      </Space>
      <Space wrap align="start">
        <Form.Item name="grade" label={t("admin_product_specs.grade")}><Input maxLength={120}/></Form.Item>
        <Form.Item name="standardCode" label={t("admin_product_specs.standard_code")}><Input maxLength={120}/></Form.Item>
      </Space>
      <Form.Item name="usageLimitations" label={t("admin_product_specs.usage_limitations")}>
        <Input.TextArea maxLength={1000}/>
      </Form.Item>
      <Form.Item name="sourceReference" label={t("admin_product_specs.source_reference")}
        rules={[{ required: true, min: 3 }]}><Input maxLength={500}/></Form.Item>
      {can("product.edit") && <Button type="primary" htmlType="submit" loading={busy}
        disabled={!sku}>{t("admin_product_specs.save_draft")}</Button>}
    </Form>
    <Typography.Title level={4} style={{ marginTop: 24 }}>{t("admin_product_specs.revisions")}</Typography.Title>
    <Table<SpecRow> rowKey={(row) => `${row.variant_code}:${row.revision_no}`} dataSource={rows}
      pagination={{ pageSize: 20 }} scroll={{ x: 800 }}
      columns={[
        { title: t("admin_product_specs.variant"), dataIndex: "variant_code" },
        { title: t("admin_product_specs.revision"), dataIndex: "revision_no" },
        { title: t("admin_product_specs.status"), dataIndex: "status",
          render: (value: string) => <Tag color={value === "PUBLISHED" ? "green" : "gold"}>{value}</Tag> },
        { title: t("admin_product_specs.facts"), render: (_, row) => <Space wrap>
          {dimensionLabels.map((name) => row[name] == null ? null
            : <span key={name}>{t(`admin_product_specs.${name}`)}: {row[name]}</span>)}
          {row.grade && <span>{t("admin_product_specs.grade")}: {row.grade}</span>}
          {row.standard_code && <span>{t("admin_product_specs.standard_code")}: {row.standard_code}</span>}
          {row.usage_limitations && <span>{t("admin_product_specs.usage_limitations")}: {row.usage_limitations}</span>}
        </Space> },
        { title: t("admin_product_specs.source_reference"), dataIndex: "source_reference" },
        { title: "", render: (_, row) => row.status === "DRAFT" && can("product.spec.publish")
          ? <Button disabled={busy} onClick={() => publish(row)}>{t("admin_product_specs.publish")}</Button> : null },
      ]}/>
  </div>;
}
