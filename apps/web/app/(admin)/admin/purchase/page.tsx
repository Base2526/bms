'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Button,
  Space,
  Tag,
  message,
  Alert,
  Popconfirm,
  Typography,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  AutoComplete,
} from "antd";
import { useState, useMemo, useEffect, useDeferredValue } from "react";
import {
  ReloadOutlined,
  PlusOutlined,
  InboxOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

// ---- Types --------------------------------------------------
type POStatus = "OPEN" | "PARTIAL" | "RECEIVED" | "CANCELLED";
type POItem = {
  sku: string;
  size: string;
  supplierSku: string | null;
  supplierProductName: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
};
type Supplier = { id: string; name: string };
type SupplierProduct = {
  id: string;
  supplierId: string;
  sku: string;
  size: string;
  productName: string;
  supplierSku: string;
  supplierProductName: string | null;
  supplierBarcode: string | null;
  lastUnitCost: number | null;
  packQty: number;
  minOrderQty: number;
  leadTimeDays: number | null;
  active: boolean;
};
type PO = {
  id: string;
  status: POStatus;
  total: number;
  note: string | null;
  supplier: Supplier | null;
  qtyOrdered: number;
  qtyReceived: number;
  createdAt: string;
  updatedAt: string;
  items: POItem[];
};

// ---- GraphQL ------------------------------------------------
const Q_POS = gql`
  query BmsPurchaseOrders($search: String, $limit: Int, $offset: Int) {
    bmsPurchaseOrders(search: $search, limit: $limit, offset: $offset) {
      id status total note qtyOrdered qtyReceived createdAt updatedAt
      supplier { id name }
      items { sku size supplierSku supplierProductName qtyOrdered qtyReceived unitCost }
    }
  }
`;
const Q_PRODUCTS = gql`
  query BmsPurchaseProducts($search: String) {
    bmsProducts(search: $search, limit: 100) { items { sku name variants { size } } }
  }
`;
const Q_SUPPLIERS = gql`query { bmsSuppliers { id name } }`;
const Q_SUPPLIER_PRODUCTS = gql`
  query BmsSupplierProducts($supplierId: ID!) {
    bmsSupplierProducts(supplierId: $supplierId, limit: 500) {
      id supplierId sku size productName supplierSku supplierProductName supplierBarcode
      lastUnitCost packQty minOrderQty leadTimeDays active
    }
  }
`;
const M_CREATE = gql`
  mutation ($supplierId: ID, $supplierName: String, $note: String, $items: [BmsPurchaseItemInput!]!) {
    bmsCreatePurchaseOrder(supplierId: $supplierId, supplierName: $supplierName, note: $note, items: $items) { status poId message }
  }
`;
const M_RECEIVE = gql`
  mutation ($id: ID!, $items: [BmsReceiveItemInput!]!) {
    bmsReceivePurchaseOrder(id: $id, items: $items) { status poId message }
  }
`;
const M_CANCEL = gql`mutation ($id: ID!) { bmsCancelPurchaseOrder(id: $id) }`;

const STATUS_COLOR: Record<POStatus, string> = {
  OPEN: "orange", PARTIAL: "blue", RECEIVED: "green", CANCELLED: "default",
};

function statusLabels(t: (key: string) => string): Record<POStatus, string> {
  return {
    OPEN: t("admin_purchase.status_open"),
    PARTIAL: t("admin_purchase.status_partial"),
    RECEIVED: t("admin_purchase.status_received"),
    CANCELLED: t("admin_purchase.status_cancelled"),
  };
}

type ProductOpt = { sku: string; name: string; variants: { size: string }[] };

function PurchaseManagement() {
  const { t } = useI18n();
  const STATUS_LABEL = statusLabels(t);
  const { can } = useBmsPermissions();
  const [createOpen, setCreateOpen] = useState(false);
  const [receivePO, setReceivePO] = useState<PO | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, refetch } = useQuery(Q_POS, {
    variables: { search: search || null, limit: 100, offset: 0 },
    fetchPolicy: "cache-and-network",
  });
  const { data: supplierData } = useQuery(Q_SUPPLIERS, { fetchPolicy: "cache-and-network" });
  const suppliers: Supplier[] = supplierData?.bmsSuppliers || [];

  const onErr = (e: any) => message.error(e?.message || t("admin_purchase.action_failed"));
  const pos: PO[] = data?.bmsPurchaseOrders || [];

  const [cancel, { loading: canceling }] = useMutation(M_CANCEL, {
    onCompleted: (d: any) =>
      d?.bmsCancelPurchaseOrder
        ? (message.success(t("admin_purchase.cancel_success")), refetch())
        : onErr({ message: t("admin_purchase.cancel_invalid_status") }),
    onError: onErr,
  });

  const actionsFor = (r: PO) => {
    const btns: any[] = [];
    if ((r.status === "OPEN" || r.status === "PARTIAL") && can("purchase.receive")) {
      btns.push(
        <Button key="recv" type="link" size="small" icon={<InboxOutlined />} onClick={() => setReceivePO(r)}>
          {t("admin_purchase.btn_receive")}
        </Button>
      );
    }
    if ((r.status === "OPEN" || r.status === "PARTIAL") && can("purchase.cancel")) {
      btns.push(
        <Popconfirm key="cancel" title={t("admin_purchase.cancel_confirm_title")} description={t("admin_purchase.cancel_confirm_desc")}
          okText={t("admin_purchase.cancel_ok_text")} okButtonProps={{ danger: true }} cancelText={t("admin_purchase.no_text")}
          disabled={canceling} onConfirm={() => cancel({ variables: { id: r.id } })}>
          <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={canceling}>{t("admin_purchase.btn_cancel")}</Button>
        </Popconfirm>
      );
    }
    return btns.length ? btns : [<span key="none" style={{ color: "#999" }}>—</span>];
  };

  const columns = useMemo(
    () => [
      { title: "PO", dataIndex: "id", key: "id", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: "Supplier", key: "supplier",
        render: (_: any, r: PO) => r.supplier?.name || <span style={{ color: "#999" }}>—</span> },
      { title: t("admin_purchase.col_progress"), key: "progress", width: 130,
        render: (_: any, r: PO) => t("admin_purchase.col_progress_value", { received: r.qtyReceived, ordered: r.qtyOrdered }) },
      { title: t("admin_purchase.col_value"), dataIndex: "total", key: "total", width: 120, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      { title: t("admin_purchase.col_status"), dataIndex: "status", key: "status", width: 140,
        render: (s: POStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: t("admin_purchase.col_created"), dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 180,
        render: (_: any, r: PO) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [canceling, can, STATUS_LABEL]
  );

  const itemColumns = [
    { title: "SKU", dataIndex: "sku", key: "sku" },
    { title: t("admin_purchase.item_col_supplier_sku"), dataIndex: "supplierSku", key: "supplierSku",
      render: (value: string | null) => value || <Typography.Text type="secondary">—</Typography.Text> },
    { title: "Size", dataIndex: "size", key: "size", width: 80 },
    { title: t("admin_purchase.item_col_received"), dataIndex: "qtyReceived", key: "qr", width: 90, align: "right" as const },
    { title: t("admin_purchase.item_col_remaining"), key: "rem", width: 90, align: "right" as const,
      render: (_: any, it: POItem) => it.qtyOrdered - it.qtyReceived },
    { title: t("admin_purchase.item_col_unit_cost"), dataIndex: "unitCost", key: "uc", width: 110, align: "right" as const,
      render: (v: number) => `${Number(v).toLocaleString()} ฿` },
  ];

  if (error) return <Alert type="error" message={t("admin_purchase.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>BMS Purchase (PO)</h2>
          <Space wrap>
            <Input.Search
              placeholder={t("admin_purchase.search_placeholder")}
              allowClear
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {can("purchase.edit") && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t("admin_purchase.btn_create")}</Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_purchase.workflow_hint")}
      />

      <Table
        rowKey="id" loading={loading} dataSource={pos} columns={columns}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (r: PO) => (
            <Table rowKey={(it) => `${it.sku}-${it.size}`} dataSource={r.items} columns={itemColumns} pagination={false} size="small" scroll={{ x: "max-content" }} />
          ),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `Total ${t} PO(s)` }}
      />

      <CreatePOModal
        open={createOpen} suppliers={suppliers}
        onClose={() => setCreateOpen(false)}
        onDone={() => { setCreateOpen(false); refetch(); }}
      />
      <ReceivePOModal
        po={receivePO}
        onClose={() => setReceivePO(null)}
        onDone={() => { setReceivePO(null); refetch(); }}
      />
    </div>
  );
}

// ---- Create PO modal ----------------------------------------
function CreatePOModal({
  open, suppliers, onClose, onDone,
}: {
  open: boolean;
  suppliers: Supplier[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [productSearch, setProductSearch] = useState("");
  const deferredProductSearch = useDeferredValue(productSearch.trim());
  const { data: prodData, loading: productsLoading } = useQuery(Q_PRODUCTS, {
    variables: { search: deferredProductSearch || null },
    skip: !open,
    fetchPolicy: "cache-and-network",
  });
  const queriedProducts: ProductOpt[] = prodData?.bmsProducts?.items || [];
  const supplierName = Form.useWatch("supplierName", form);
  const selectedSupplier = suppliers.find(
    (supplier) => supplier.name.toLocaleLowerCase() === String(supplierName ?? "").trim().toLocaleLowerCase()
  );
  const { data: mappingData, loading: mappingsLoading } = useQuery(Q_SUPPLIER_PRODUCTS, {
    variables: { supplierId: selectedSupplier?.id ?? "" },
    skip: !open || !selectedSupplier?.id,
    fetchPolicy: "cache-and-network",
  });
  const mappings: SupplierProduct[] = mappingData?.bmsSupplierProducts || [];
  const [create, { loading }] = useMutation(M_CREATE, {
    onCompleted: (d: any) => {
      const res = d?.bmsCreatePurchaseOrder;
      if (res?.status === "CREATED") { message.success(res.message || t("admin_purchase.create_success")); form.resetFields(); onDone(); }
      else message.error(res?.message || t("admin_purchase.create_failed"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_purchase.create_failed")),
  });

  const submit = async () => {
    const v = await form.validateFields();
    const items = (v.items || []).map((it: any) => ({
      sku: it.sku,
      size: it.size,
      qty: Number(it.qty),
      unitCost: Number(it.unitCost ?? 0),
      supplierSku: it.supplierSku || null,
      supplierProductName: it.supplierProductName || null,
      supplierBarcode: it.supplierBarcode || null,
    }));
    create({
      variables: {
        supplierId: selectedSupplier?.id ?? null,
        supplierName: selectedSupplier ? null : v.supplierName || null,
        note: v.note || null,
        items,
      },
    });
  };

  const fillMapping = (index: number, sku: string, size?: string) => {
    const candidates = mappings.filter((mapping) =>
      mapping.active && mapping.sku === sku && (!size || mapping.size === size)
    );
    if (candidates.length !== 1) return;
    const mapping = candidates[0];
    form.setFieldValue(["items", index, "size"], mapping.size);
    form.setFieldValue(["items", index, "supplierSku"], mapping.supplierSku);
    form.setFieldValue(["items", index, "supplierProductName"], mapping.supplierProductName);
    form.setFieldValue(["items", index, "supplierBarcode"], mapping.supplierBarcode);
    if (mapping.lastUnitCost != null) form.setFieldValue(["items", index, "unitCost"], mapping.lastUnitCost);
  };

  const clearMappedItemFields = (index: number) => {
    for (const field of ["supplierSku", "supplierProductName", "supplierBarcode", "unitCost"]) {
      form.setFieldValue(["items", index, field], undefined);
    }
  };

  const productMap = new Map<string, ProductOpt>(queriedProducts.map((product) => [
    product.sku,
    { ...product, variants: [...(product.variants || [])] },
  ]));
  for (const mapping of mappings) {
    const product = productMap.get(mapping.sku);
    if (!product) {
      productMap.set(mapping.sku, { sku: mapping.sku, name: mapping.productName, variants: [{ size: mapping.size }] });
    } else if (!product.variants.some((variant) => variant.size === mapping.size)) {
      product.variants.push({ size: mapping.size });
    }
  }
  const products = [...productMap.values()];
  const productOptions = products.map((product) => {
    const supplierCodes = mappings
      .filter((mapping) => mapping.sku === product.sku && mapping.active)
      .map((mapping) => mapping.supplierSku);
    const suffix = supplierCodes.length ? ` · ${t("admin_purchase.supplier_sku_short")}: ${supplierCodes.join(", ")}` : "";
    return { value: product.sku, label: `${product.sku} · ${product.name}${suffix}` };
  });

  return (
    <Modal
      title={t("admin_purchase.create_modal_title")} open={open} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText={t("admin_purchase.create_ok_text")} cancelText={t("admin_purchase.btn_cancel")} width={1100} destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ items: [{}] }}>
        <Form.Item name="supplierName" label={t("admin_purchase.supplier_label")}>
          <AutoComplete
            allowClear
            options={suppliers.map((supplier) => ({ value: supplier.name, label: supplier.name }))}
            placeholder={t("admin_purchase.supplier_placeholder")}
            filterOption={(input, option) => String(option?.label ?? "").toLocaleLowerCase().includes(input.toLocaleLowerCase())}
            onSelect={() => form.setFieldValue("items", [{}])}
            onClear={() => form.setFieldValue("items", [{}])}
          />
        </Form.Item>
        <Alert
          type={selectedSupplier ? "success" : "info"}
          showIcon
          style={{ marginBottom: 16 }}
          message={selectedSupplier
            ? t("admin_purchase.mapping_loaded", { count: mappings.length })
            : t("admin_purchase.mapping_new_supplier_hint")}
        />
        <Form.Item name="note" label={t("admin_purchase.note_label")}>
          <Input placeholder={t("admin_purchase.note_placeholder")} />
        </Form.Item>

        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "sku"]} rules={[{ required: true, message: t("admin_purchase.select_product_required") }]}>
                    <Select
                      showSearch loading={mappingsLoading || productsLoading} style={{ width: 260 }} placeholder={t("admin_purchase.shop_sku_placeholder")}
                      options={productOptions}
                      filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                      onSearch={setProductSearch}
                      onChange={(sku) => {
                        const product = products.find((candidate) => candidate.sku === sku);
                        const sizes = [...new Set((product?.variants || []).map((variant) => variant.size.trim()).filter(Boolean))];
                        const onlySize = sizes.length === 1 ? sizes[0] : undefined;
                        form.setFieldValue(["items", name, "size"], undefined);
                        clearMappedItemFields(name);
                        if (onlySize) form.setFieldValue(["items", name, "size"], onlySize);
                        fillMapping(name, sku, onlySize);
                      }}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(previous, current) =>
                    previous.items?.[name]?.sku !== current.items?.[name]?.sku
                  }>
                    {({ getFieldValue }) => {
                      const sku = getFieldValue(["items", name, "sku"]);
                      const product = products.find((candidate) => candidate.sku === sku);
                      const sizeOptions = [...new Set(
                        (product?.variants || []).map((variant) => variant.size.trim()).filter(Boolean)
                      )]
                        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
                        .map((size) => ({ value: size, label: size }));
                      const applySizeMapping = (size: string) => {
                        if (!sku || !size) return;
                        const currentSupplierSku = form.getFieldValue(["items", name, "supplierSku"]);
                        const hasStaleMapping = mappings.some((mapping) =>
                          mapping.active && mapping.sku === sku && mapping.size !== size
                          && mapping.supplierSku === currentSupplierSku
                        );
                        if (hasStaleMapping) clearMappedItemFields(name);
                        fillMapping(name, sku, size);
                      };

                      return (
                        <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true, message: t("admin_purchase.size_required") }]}>
                          <AutoComplete
                            allowClear
                            disabled={!sku}
                            options={sizeOptions}
                            placeholder={t("admin_purchase.size_placeholder")}
                            style={{ width: 120 }}
                            filterOption={(input, option) => String(option?.value ?? "").toLocaleLowerCase().includes(input.toLocaleLowerCase())}
                            onSelect={(size) => applySizeMapping(String(size).trim())}
                            onBlur={() => applySizeMapping(String(
                              form.getFieldValue(["items", name, "size"]) ?? ""
                            ).trim())}
                          />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "supplierSku"]}>
                    <Input placeholder={t("admin_purchase.supplier_sku_placeholder")} style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "supplierProductName"]}>
                    <Input placeholder={t("admin_purchase.supplier_product_name_placeholder")} style={{ width: 190 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "supplierBarcode"]}>
                    <Input placeholder={t("admin_purchase.supplier_barcode_placeholder")} style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "qty"]} rules={[{ required: true, message: t("admin_purchase.qty_required") }]}>
                    <InputNumber placeholder={t("admin_purchase.qty_placeholder")} min={1} style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unitCost"]}>
                    <InputNumber placeholder={t("admin_purchase.unit_cost_placeholder")} min={0} style={{ width: 120 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(name)} />}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({})} icon={<PlusOutlined />} block>{t("admin_purchase.add_item")}</Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

// ---- Receive PO modal ---------------------------------------
function ReceivePOModal({
  po, onClose, onDone,
}: { po: PO | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [receive, { loading }] = useMutation(M_RECEIVE, {
    onCompleted: (d: any) => {
      const res = d?.bmsReceivePurchaseOrder;
      if (res?.status === "RECEIVED" || res?.status === "PARTIAL") { message.success(res.message || t("admin_purchase.receive_success")); onDone(); }
      else message.error(res?.message || t("admin_purchase.receive_failed"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_purchase.receive_failed")),
  });

  const pending = (po?.items || []).filter((it) => it.qtyOrdered - it.qtyReceived > 0);

  const submit = async () => {
    if (!po) return;
    const v = await form.validateFields();
    const items = pending
      .map((it) => ({ sku: it.sku, size: it.size, qty: Number(v[`${it.sku}__${it.size}`] ?? 0) }))
      .filter((it) => it.qty > 0);
    if (items.length === 0) { message.warning(t("admin_purchase.receive_qty_warning")); return; }
    receive({ variables: { id: po.id, items } });
  };

  return (
    <Modal
      title={t("admin_purchase.receive_modal_title", { id: po?.id.slice(0, 8) ?? "" })}
      open={!!po} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText={t("admin_purchase.receive_ok_text")} cancelText={t("admin_purchase.close_text")} destroyOnClose
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t("admin_purchase.receive_alert")} />
      <Form form={form} layout="vertical">
        {pending.length === 0 && <Typography.Text type="secondary">{t("admin_purchase.no_pending_items")}</Typography.Text>}
        {pending.map((it) => {
          const rem = it.qtyOrdered - it.qtyReceived;
          return (
            <Form.Item
              key={`${it.sku}-${it.size}`}
              name={`${it.sku}__${it.size}`}
              label={t("admin_purchase.receive_item_label", { sku: it.sku, size: it.size, rem })}
              initialValue={rem}
              rules={[{ type: "number", min: 0, max: rem, message: t("admin_purchase.receive_item_max_error", { rem }) }]}
            >
              <InputNumber min={0} max={rem} style={{ width: 160 }} />
            </Form.Item>
          );
        })}
      </Form>
    </Modal>
  );
}

export default function Page() {
  return <PurchaseManagement />;
}
