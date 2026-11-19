"use client";

import { gql, useQuery } from "@apollo/client";
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_LOCATIONS = gql`query QuoteLocations { bmsCustomerLocations { id name active } }`;
const Q_CUSTOMERS = gql`query QuoteCustomers($search: String) {
  bmsCustomers(search: $search, limit: 30) { id name phone }
}`;
const Q_PRODUCTS = gql`query QuoteProducts($search: String) {
  bmsProducts(search: $search, limit: 30) { items { sku name active catalogVariants { code active } } }
}`;

type QuoteRow = {
  id: string; quote_no: string; revision_no: number; status: string; project_name: string;
  location_id: string; customer_id: string; delivery_terms: string; site_address: string;
  shipping_fee: string | null; subtotal: string; total: string | null; expires_at: string;
  order_id: string | null; lines?: Array<{ line_no: number; product_sku: string; size: string;
    pack_code: string; pack_qty: number; base_qty: number; unit_name: string;
    list_unit_price: string; agreed_unit_price: string; line_discount: string;
    line_amount: string; vat_category: string }>;
  acceptance_evidence?: string | null;
};
type DraftForm = {
  locationId: string; customerId: string; projectName: string; siteAddress?: string;
  deliveryTerms: "PICKUP" | "DELIVERY"; shippingFee?: number; expiresAt: Dayjs;
  lines: Array<{ sku: string; size: string; packCode?: string; qty: number; agreedUnitPrice?: number }>;
};

export default function QuotationsPage() {
  const { t } = useI18n();
  const { can } = useBmsPermissions();
  const [form] = Form.useForm<DraftForm>();
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [selected, setSelected] = useState<QuoteRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const requestKey = useRef("");
  const deferredCustomerSearch = useDeferredValue(customerSearch);
  const deferredProductSearch = useDeferredValue(productSearch);
  const { data: locationData } = useQuery(Q_LOCATIONS, { skip: !formOpen });
  const { data: customerData } = useQuery(Q_CUSTOMERS, {
    variables: { search: deferredCustomerSearch }, skip: !formOpen,
  });
  const { data: productData } = useQuery(Q_PRODUCTS, {
    variables: { search: deferredProductSearch }, skip: !formOpen,
  });
  const deliveryTerms = Form.useWatch("deliveryTerms", form);

  async function api(path: string, init?: RequestInit) {
    const response = await fetch(`/api/bms/quotations${path}`, {
      ...init, cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.status || payload.error || String(response.status));
    return payload;
  }
  async function refresh() {
    setLoading(true);
    try { setRows((await api("?limit=100")).quotes ?? []); }
    catch (error) { message.error(`${t("admin_quotations.error")}: ${String(error)}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []); // initial server-backed list

  async function loadDetail(id: string): Promise<QuoteRow> {
    const quote = (await api(`/${encodeURIComponent(id)}`)).quote as QuoteRow;
    setSelected(quote);
    return quote;
  }
  function newDraft() {
    requestKey.current = crypto.randomUUID();
    setRevising(null);
    form.resetFields();
    form.setFieldsValue({ deliveryTerms: "PICKUP", shippingFee: 0,
      expiresAt: dayjs().add(7, "day"), lines: [{ qty: 1, packCode: "BASE" }] } as Partial<DraftForm>);
    setFormOpen(true);
  }
  async function startRevision(id: string) {
    try {
      const quote = await loadDetail(id);
      requestKey.current = crypto.randomUUID();
      setRevising(id);
      form.setFieldsValue({
        locationId: quote.location_id, customerId: quote.customer_id,
        projectName: quote.project_name, siteAddress: quote.site_address,
        deliveryTerms: quote.delivery_terms as DraftForm["deliveryTerms"],
        shippingFee: quote.shipping_fee == null ? undefined : Number(quote.shipping_fee),
        expiresAt: dayjs(quote.expires_at),
        lines: quote.lines?.map((line) => ({ sku: line.product_sku, size: line.size,
          packCode: line.pack_code, qty: Number(line.pack_qty),
          agreedUnitPrice: Number(line.agreed_unit_price) })) ?? [],
      });
      setFormOpen(true);
    } catch (error) { message.error(`${t("admin_quotations.error")}: ${String(error)}`); }
  }
  async function submit(values: DraftForm) {
    const draft = {
      ...values,
      shippingFee: values.deliveryTerms === "PICKUP" ? 0 : values.shippingFee ?? null,
      expiresAt: values.expiresAt.endOf("day").toISOString(),
      requestKey: requestKey.current,
      lines: values.lines.map((line) => ({ ...line,
        packCode: line.packCode?.trim() || "BASE",
        agreedUnitPrice: line.agreedUnitPrice ?? null })),
    };
    setLoading(true);
    try {
      const result = revising
        ? await api(`/${encodeURIComponent(revising)}`, { method: "POST",
          body: JSON.stringify({ action: "REVISE", confirm: true, draft }) })
        : await api("", { method: "POST", body: JSON.stringify(draft) });
      setFormOpen(false); setRevising(null);
      await refresh(); await loadDetail(result.quoteId);
      message.success(t("admin_quotations.success"));
    } catch (error) { message.error(`${t("admin_quotations.error")}: ${String(error)}`); }
    finally { setLoading(false); }
  }
  async function action(id: string, command: "APPROVE" | "SEND" | "ACCEPT" | "REJECT" | "CONVERT") {
    try {
      const quote = await loadDetail(id);
      let acceptanceEvidence = "";
      const labels = { APPROVE: "approve", SEND: "send", ACCEPT: "accept", REJECT: "reject", CONVERT: "convert" } as const;
      Modal.confirm({
        title: t("admin_quotations.confirm_action"),
        content: <Space direction="vertical">
          <strong>{t(`admin_quotations.${labels[command]}`)}</strong>
          <span>{quote.quote_no} / {quote.revision_no} · {quote.project_name}</span>
          <span>{t("admin_quotations.customer")}: {quote.customer_id}</span>
          <span>{t("admin_quotations.branch")}: {quote.location_id}</span>
          <span>{t("admin_quotations.total")}: {quote.total == null ? t("admin_quotations.unknown_total") : `฿${Number(quote.total).toFixed(2)}`}</span>
          {quote.lines?.map((line) => <span key={line.line_no}>
            {line.product_sku}/{line.size} {line.pack_qty} {line.unit_name} @ ฿{Number(line.agreed_unit_price).toFixed(2)}
          </span>)}
          {command === "SEND" && <Alert closable type="info" message={t("admin_quotations.no_send")} />}
          {command === "ACCEPT" && <Input.TextArea maxLength={500}
            placeholder={t("admin_quotations.acceptance_evidence")}
            onChange={(event) => { acceptanceEvidence = event.target.value; }} />}
        </Space>,
        onOk: async () => {
          try {
            const result = await api(`/${encodeURIComponent(id)}`, {
              method: "POST", body: JSON.stringify({ action: command, confirm: true,
                evidenceRef: command === "ACCEPT" ? acceptanceEvidence : undefined }),
            });
            await refresh(); await loadDetail(id);
            if (result.orderId) message.success(<Link href={`/admin/orders?search=${result.orderId}`}>{result.orderId}</Link>);
            else message.success(t("admin_quotations.success"));
          } catch (error) { message.error(`${t("admin_quotations.error")}: ${String(error)}`); }
        },
      });
    } catch (error) { message.error(`${t("admin_quotations.error")}: ${String(error)}`); }
  }

  const columns = [
    { title: t("admin_quotations.number"), key: "number", render: (_: unknown, row: QuoteRow) => `${row.quote_no} / ${row.revision_no}` },
    { title: t("admin_quotations.project"), dataIndex: "project_name" },
    { title: t("admin_quotations.status"), dataIndex: "status", render: (value: string) => <Tag>{value}</Tag> },
    { title: t("admin_quotations.total"), dataIndex: "total", render: (value: string | null) => value == null ? t("admin_quotations.unknown_total") : `฿${Number(value).toFixed(2)}` },
    { title: t("admin_quotations.expiry"), dataIndex: "expires_at", render: (value: string) => dayjs(value).format("DD/MM/YYYY HH:mm") },
    { title: "", key: "actions", render: (_: unknown, row: QuoteRow) => <Space wrap>
      <Button onClick={() => void loadDetail(row.id)}>{t("admin_quotations.view")}</Button>
      {can("quotation.create") && ["DRAFT", "APPROVED", "SENT", "REJECTED"].includes(row.status)
        && <Button onClick={() => void startRevision(row.id)}>{t("admin_quotations.revise")}</Button>}
      {row.status === "DRAFT" && can("quotation.approve") && <Button onClick={() => void action(row.id, "APPROVE")}>{t("admin_quotations.approve")}</Button>}
      {row.status === "APPROVED" && can("quotation.send") && <Button onClick={() => void action(row.id, "SEND")}>{t("admin_quotations.send")}</Button>}
      {row.status === "SENT" && can("quotation.accept") && <>
        <Button onClick={() => void action(row.id, "ACCEPT")}>{t("admin_quotations.accept")}</Button>
        <Button onClick={() => void action(row.id, "REJECT")}>{t("admin_quotations.reject")}</Button>
      </>}
      {row.status === "ACCEPTED" && can("quotation.convert") && <Button type="primary" onClick={() => void action(row.id, "CONVERT")}>{t("admin_quotations.convert")}</Button>}
    </Space> },
  ];

  return <div style={{ padding: 24, maxWidth: 1400, margin: "auto" }}>
    <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
      <div><Typography.Title level={2}>{t("admin_quotations.title")}</Typography.Title>
        <Typography.Text type="secondary">{t("admin_quotations.subtitle")}</Typography.Text></div>
      <Space><Button onClick={() => void refresh()}>{t("admin_quotations.refresh")}</Button>
        {can("quotation.create") && <Button type="primary" onClick={newDraft}>{t("admin_quotations.new_draft")}</Button>}</Space>
    </Space>
    <Table style={{ marginTop: 20 }} dataSource={rows} rowKey="id" columns={columns} loading={loading}
      scroll={{ x: 900 }} pagination={{ pageSize: 20 }} locale={{ emptyText: t("admin_quotations.empty") }} />
    <Modal open={Boolean(selected)} title={selected ? `${selected.quote_no} / ${selected.revision_no}` : ""}
      footer={<Button onClick={() => setSelected(null)}>{t("admin_quotations.close")}</Button>}
      onCancel={() => setSelected(null)} width={760}>
      {selected && <Space direction="vertical" style={{ width: "100%" }}>
        <div>{selected.project_name} · {selected.status}</div>
        <div>{t("admin_quotations.customer")}: {selected.customer_id}</div>
        <div>{t("admin_quotations.branch")}: {selected.location_id}</div>
        <div>{t("admin_quotations.address")}: {selected.site_address || "—"}</div>
        {selected.acceptance_evidence && <div>{t("admin_quotations.acceptance_evidence")}: {selected.acceptance_evidence}</div>}
        <div>{t("admin_quotations.shipping")}: {selected.shipping_fee == null ? t("admin_quotations.unknown_shipping") : `฿${Number(selected.shipping_fee).toFixed(2)}`}</div>
        <Table size="small" rowKey="line_no" pagination={false} dataSource={selected.lines ?? []}
          scroll={{ x: 650 }} columns={[
            { title: t("admin_quotations.sku"), dataIndex: "product_sku" },
            { title: t("admin_quotations.size"), dataIndex: "size" },
            { title: t("admin_quotations.pack"), dataIndex: "unit_name" },
            { title: t("admin_quotations.quantity"), dataIndex: "pack_qty" },
            { title: t("admin_quotations.agreed_price"), dataIndex: "agreed_unit_price" },
            { title: t("admin_quotations.total"), dataIndex: "line_amount" },
          ]} />
        <strong>{t("admin_quotations.total")}: {selected.total == null ? t("admin_quotations.unknown_total") : `฿${Number(selected.total).toFixed(2)}`}</strong>
        {selected.order_id && <Link href={`/admin/orders?search=${selected.order_id}`}>{selected.order_id}</Link>}
      </Space>}
    </Modal>
    <Modal open={formOpen} title={revising ? t("admin_quotations.revise") : t("admin_quotations.new_draft")}
      onCancel={() => setFormOpen(false)} footer={null} width={850}>
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Form.Item name="locationId" label={t("admin_quotations.branch")} rules={[{ required: true }]}>
          <Select options={(locationData?.bmsCustomerLocations ?? []).filter((x: any) => x.active)
            .map((x: any) => ({ value: x.id, label: x.name }))} />
        </Form.Item>
        <Form.Item name="customerId" label={t("admin_quotations.customer")} rules={[{ required: true }]}>
          <Select showSearch filterOption={false} onSearch={setCustomerSearch}
            options={(customerData?.bmsCustomers ?? []).map((x: any) => ({ value: x.id, label: `${x.name} ${x.phone ?? ""}` }))} />
        </Form.Item>
        <Form.Item name="projectName" label={t("admin_quotations.project")} rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="siteAddress" label={t("admin_quotations.address")}
          rules={[{ required: deliveryTerms === "DELIVERY", whitespace: true }]}>
          <Input.TextArea maxLength={1000} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="deliveryTerms" label={t("admin_quotations.delivery")} rules={[{ required: true }]}>
            <Select style={{ width: 240 }} onChange={(value) => form.setFieldValue("shippingFee", value === "PICKUP" ? 0 : undefined)}
              options={[{ value: "PICKUP", label: t("admin_quotations.pickup") },
              { value: "DELIVERY", label: t("admin_quotations.truck") }]} />
          </Form.Item>
          <Form.Item name="shippingFee" label={t("admin_quotations.shipping")}
            tooltip={t("admin_quotations.unknown_shipping")}>
            <InputNumber min={0} precision={2} disabled={deliveryTerms === "PICKUP"} />
          </Form.Item>
          <Form.Item name="expiresAt" label={t("admin_quotations.expiry")} rules={[{ required: true }]}><DatePicker /></Form.Item>
        </Space>
        <Typography.Title level={5}>{t("admin_quotations.lines")}</Typography.Title>
        <Form.List name="lines">{(fields, { add, remove }) => <>
          {fields.map((field) => <Space key={field.key} align="start" wrap>
            <Form.Item name={[field.name, "sku"]} label={t("admin_quotations.sku")} rules={[{ required: true }]}>
              <Select style={{ width: 180 }} showSearch filterOption={false} onSearch={setProductSearch}
                options={(productData?.bmsProducts?.items ?? []).filter((x: any) => x.active)
                  .map((x: any) => ({ value: x.sku, label: `${x.sku} · ${x.name}` }))} />
            </Form.Item>
            <Form.Item name={[field.name, "size"]} label={t("admin_quotations.size")} rules={[{ required: true }]}><Input style={{ width: 110 }} /></Form.Item>
            <Form.Item name={[field.name, "packCode"]} label={t("admin_quotations.pack")}><Input style={{ width: 110 }} /></Form.Item>
            <Form.Item name={[field.name, "qty"]} label={t("admin_quotations.quantity")} rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item>
            <Form.Item name={[field.name, "agreedUnitPrice"]} label={t("admin_quotations.agreed_price")}><InputNumber min={0} precision={2} /></Form.Item>
            <Button danger onClick={() => remove(field.name)}>−</Button>
          </Space>)}
          <Button onClick={() => add({ qty: 1, packCode: "BASE" })}>{t("admin_quotations.add_line")}</Button>
        </>}</Form.List>
        <div style={{ marginTop: 20 }}><Button type="primary" htmlType="submit" loading={loading}>{t("admin_quotations.save")}</Button></div>
      </Form>
    </Modal>
  </div>;
}
