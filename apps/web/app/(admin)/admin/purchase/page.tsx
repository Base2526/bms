"use client";

import { useUiText } from "@/lib/useUiText";
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
import { useState, useMemo, useEffect, useDeferredValue, useRef } from "react";
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
  additionalUnitCost: number;
  landedUnitCost: number;
  additionalCostNote: string | null;
  supplierUnitName: string | null;
  supplierUnitQty: number | null;
  baseQtyPerSupplierUnit: number | null;
  conversionEvidence: string | null;
};
type Supplier = {
  id: string; name: string; phone: string | null; email: string | null; note: string | null;
  taxId: string | null; branchCode: string | null; address: string | null; entityType: string | null;
};
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
  landedTotal: number;
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
      id status total landedTotal note qtyOrdered qtyReceived createdAt updatedAt
      supplier { id name }
      items { sku size supplierSku supplierProductName qtyOrdered qtyReceived unitCost additionalUnitCost landedUnitCost additionalCostNote supplierUnitName supplierUnitQty baseQtyPerSupplierUnit conversionEvidence }
    }
  }
`;
const Q_PRODUCTS = gql`
  query BmsPurchaseProducts($search: String) {
    bmsProducts(search: $search, limit: 100) { items { sku name variants { size } } }
  }
`;
const Q_LINKED_PO = gql`
  query LinkedPurchaseOrder($id: ID!) {
    bmsPurchaseOrder(id: $id) {
      id status total landedTotal note qtyOrdered qtyReceived createdAt updatedAt
      supplier { id name }
      items { sku size supplierSku supplierProductName qtyOrdered qtyReceived unitCost additionalUnitCost landedUnitCost additionalCostNote supplierUnitName supplierUnitQty baseQtyPerSupplierUnit conversionEvidence }
    }
  }
`;
const Q_SUPPLIERS = gql`query { bmsSuppliers { id name phone email note taxId branchCode address entityType } }`;
const M_SUPPLIER = gql`mutation BmsUpsertSupplier($input: BmsSupplierInput!) {
  bmsUpsertSupplier(input: $input) { id name phone email note taxId branchCode address entityType }
}`;
const Q_RECEIVING_LOCATIONS = gql`query BmsPurchaseReceivingLocations { bmsPurchaseReceivingLocations { id name branchCode active } }`;
const Q_RETRY_SCOPE = gql`query BmsPurchaseRetryScope { bmsMe { id tenant { id } } bmsActingTenant { id } }`;
const Q_SUPPLIER_PRODUCTS = gql`
  query BmsSupplierProducts($supplierId: ID!) {
    bmsSupplierProducts(supplierId: $supplierId, limit: 500) {
      id supplierId sku size productName supplierSku supplierProductName supplierBarcode
      lastUnitCost packQty minOrderQty leadTimeDays active
    }
  }
`;
const M_CREATE = gql`
  mutation ($supplierId: ID, $supplierName: String, $note: String, $requestId: String, $items: [BmsPurchaseItemInput!]!) {
    bmsCreatePurchaseOrder(supplierId: $supplierId, supplierName: $supplierName, note: $note, requestId: $requestId, items: $items) { status poId message }
  }
`;
const M_RECEIVE = gql`
  mutation ($id: ID!, $items: [BmsReceiveItemInput!]!, $idempotencyKey: String, $locationId: ID) {
    bmsReceivePurchaseOrder(id: $id, items: $items, idempotencyKey: $idempotencyKey, locationId: $locationId) { status poId message reasonCode sku size replayed }
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
  const uiText = useUiText();
  const { t } = useI18n();
  const STATUS_LABEL = statusLabels(t);
  const { can } = useBmsPermissions();
  const [createOpen, setCreateOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [receivePO, setReceivePO] = useState<PO | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [linkedId,setLinkedId]=useState<string | null>(null);
  const [expandedKeys,setExpandedKeys]=useState<React.Key[]>([]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get("id");
    if(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {setLinkedId(id);setExpandedKeys([id]);}
  },[]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const listQuery = useQuery(Q_POS, {
    variables: { search: search || null, limit: 100, offset: 0 },
    fetchPolicy: "cache-and-network",
    skip:!!linkedId,
  });
  const linkedQuery=useQuery(Q_LINKED_PO,{variables:{id:linkedId},skip:!linkedId,fetchPolicy:"network-only"});
  const {loading,error,refetch}=linkedId?linkedQuery:listQuery;
  const data=linkedId?{bmsPurchaseOrders:linkedQuery.data?.bmsPurchaseOrder?[linkedQuery.data.bmsPurchaseOrder]:[]}:listQuery.data;
  const { data: supplierData, refetch: refetchSuppliers } = useQuery(Q_SUPPLIERS, { fetchPolicy: "cache-and-network" });
  const { data: retryScopeData } = useQuery(Q_RETRY_SCOPE, { fetchPolicy: "network-only" });
  const retryTenantId = retryScopeData?.bmsActingTenant?.id ?? retryScopeData?.bmsMe?.tenant?.id;
  const retryScope = retryTenantId && retryScopeData?.bmsMe?.id
    ? `${retryTenantId}:${retryScopeData.bmsMe.id}` : null;
  const suppliers: Supplier[] = supplierData?.bmsSuppliers || [];

  const onErr = (e: any) => message.error(e?.message || t("admin_purchase.action_failed"));
  const pos: PO[] = data?.bmsPurchaseOrders || [];
  useEffect(() => {
    if (receivePO || !can("purchase.receive")) return;
    try {
      const pending = pos.find(order => window.sessionStorage.getItem(`bms.purchase.pending:${order.id}`));
      if (pending) setReceivePO(pending);
    } catch {}
  }, [data?.bmsPurchaseOrders, receivePO, can]);

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
      { title: uiText("admin_ui.en_supplier_55edd"), key: "supplier",
        render: (_: any, r: PO) => r.supplier?.name || <span style={{ color: "#999" }}>—</span> },
      { title: t("admin_purchase.col_progress"), key: "progress", width: 130,
        render: (_: any, r: PO) => t("admin_purchase.col_progress_value", { received: r.qtyReceived, ordered: r.qtyOrdered }) },
      { title: t("admin_purchase.col_value"), dataIndex: "total", key: "total", width: 120, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      { title: t("admin_purchase.col_landed_value"), dataIndex: "landedTotal", key: "landedTotal", width: 140, align: "right" as const,
        render: (v: number) => <Typography.Text strong>{Number(v).toLocaleString()} ฿</Typography.Text> },
      { title: t("admin_purchase.col_status"), dataIndex: "status", key: "status", width: 140,
        render: (s: POStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s] ?? s}</Tag> },
      { title: t("admin_purchase.col_created"), dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString(uiText.locale) },
      { title: uiText("admin_ui.en_actions_c3cd6"), key: "actions", width: 180,
        render: (_: any, r: PO) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [uiText, canceling, can, STATUS_LABEL]
  );

  const itemColumns = [
    { title: "SKU", dataIndex: "sku", key: "sku" },
    { title: t("admin_purchase.item_col_supplier_sku"), dataIndex: "supplierSku", key: "supplierSku",
      render: (value: string | null) => value || <Typography.Text type="secondary">—</Typography.Text> },
    { title: uiText("admin_ui.en_size_b7152"), dataIndex: "size", key: "size", width: 80 },
    { title: t("admin_purchase.item_col_received"), dataIndex: "qtyReceived", key: "qr", width: 90, align: "right" as const },
    { title: t("admin_purchase.item_col_remaining"), key: "rem", width: 90, align: "right" as const,
      render: (_: any, it: POItem) => it.qtyOrdered - it.qtyReceived },
    { title: t("admin_purchase.item_col_unit_cost"), dataIndex: "unitCost", key: "uc", width: 110, align: "right" as const,
      render: (v: number) => `${Number(v).toLocaleString()} ฿` },
    { title: t("admin_purchase.item_col_additional_cost"), dataIndex: "additionalUnitCost", key: "auc", width: 140, align: "right" as const,
      render: (v: number) => `${Number(v).toLocaleString()} ฿` },
    { title: t("admin_purchase.item_col_landed_cost"), dataIndex: "landedUnitCost", key: "luc", width: 140, align: "right" as const,
      render: (v: number) => <Typography.Text strong>{Number(v).toLocaleString()} ฿</Typography.Text> },
    { title: t("admin_purchase.item_col_additional_note"), dataIndex: "additionalCostNote", key: "acn", width: 220,
      render: (v: string | null) => v || <Typography.Text type="secondary">—</Typography.Text> },
  ];

  if (error) return <Alert closable type="error" message={t("admin_purchase.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        {linkedId && <Button onClick={()=>{setLinkedId(null);setExpandedKeys([]);}}>{t("branch_requisitions.all_documents")}</Button>}
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>{uiText("admin_ui.en_bms_purchase_po_6bb47")}</h2>
          <Space wrap>
            {can("purchase.edit") && <Button onClick={() => setSuppliersOpen(true)}>{t("admin_purchase.manage_suppliers")}</Button>}
            <Input.Search
              placeholder={t("admin_purchase.search_placeholder")}
              allowClear
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => {setLinkedId(null);setSearchInput(e.target.value);}}
            />
            {can("purchase.edit") && (
              <Button type="primary" icon={<PlusOutlined />} disabled={!retryScope}
                title={!retryScope ? t("admin_purchase.retry_scope_unavailable") : undefined}
                onClick={() => setCreateOpen(true)}>{t("admin_purchase.btn_create")}</Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{uiText("admin_ui.en_refresh_56e3b")}</Button>
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
          expandedRowKeys:expandedKeys,
          onExpandedRowsChange:(keys)=>setExpandedKeys([...keys]),
          expandedRowRender: (r: PO) => (
            <Table rowKey={(it) => `${it.sku}-${it.size}`} dataSource={r.items} columns={itemColumns} pagination={false} size="small" scroll={{ x: "max-content" }} />
          ),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => uiText("admin_ui.en_total_po_s_560cc", { v0: t }) }}
      />

      <CreatePOModal
        open={createOpen} suppliers={suppliers} retryScope={retryScope}
        onClose={() => setCreateOpen(false)}
        onDone={() => { setCreateOpen(false); refetch(); }}
      />
      <SupplierManager open={suppliersOpen} suppliers={suppliers} onClose={() => setSuppliersOpen(false)}
        onSaved={() => refetchSuppliers()} />
      <ReceivePOModal
        po={receivePO}
        onClose={() => setReceivePO(null)}
        onDone={() => { setReceivePO(null); refetch(); }}
      />
    </div>
  );
}

// ---- Create PO modal ----------------------------------------
function SupplierManager({ open, suppliers, onClose, onSaved }: {
  open: boolean; suppliers: Supplier[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [save, { loading }] = useMutation(M_SUPPLIER);
  const edit = (supplier?: Supplier) => {
    setEditingId(supplier?.id ?? null);
    form.resetFields();
    form.setFieldsValue(supplier ?? { entityType: null });
  };
  const submit = async (values: any) => {
    const input = {
      ...(editingId ? { id: editingId } : {}),
      name: String(values.name ?? "").trim(),
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
      note: values.note?.trim() || null,
      taxId: values.taxId?.trim() || null,
      branchCode: values.branchCode?.trim() || null,
      address: values.address?.trim() || null,
      entityType: values.entityType || null,
    };
    try {
      await save({ variables: { input } });
      message.success(t("admin_purchase.supplier_saved"));
      onSaved();
      edit();
    } catch (error: any) {
      message.error(error?.message || t("admin_purchase.action_failed"));
    }
  };
  return <Modal open={open} title={t("admin_purchase.manage_suppliers")} footer={null} width={760}
    onCancel={() => { edit(); onClose(); }} destroyOnClose>
    <Table rowKey="id" size="small" dataSource={suppliers} pagination={{ pageSize: 5 }} scroll={{ x: 560 }}
      columns={[
        { title: t("admin_purchase.supplier_name"), dataIndex: "name", key: "name" },
        { title: t("admin_purchase.supplier_phone"), dataIndex: "phone", key: "phone" },
        { title: t("admin_purchase.supplier_tax_id"), dataIndex: "taxId", key: "taxId" },
        { title: "", key: "edit", render: (_: unknown, supplier: Supplier) =>
          <Button type="link" onClick={() => edit(supplier)}>{t("admin_purchase.supplier_edit")}</Button> },
      ]} />
    <Button onClick={() => edit()} style={{ marginBottom: 12 }}>{t("admin_purchase.supplier_new")}</Button>
    <Form form={form} layout="vertical" onFinish={submit}>
      <Form.Item name="name" label={t("admin_purchase.supplier_name")}
        rules={[{ required: true, message: t("admin_purchase.supplier_name_required") }]}>
        <Input maxLength={120} />
      </Form.Item>
      <Space wrap align="start" style={{ width: "100%" }}>
        <Form.Item name="phone" label={t("admin_purchase.supplier_phone")}><Input maxLength={30} /></Form.Item>
        <Form.Item name="email" label={t("admin_purchase.supplier_email")}><Input maxLength={254} type="email" /></Form.Item>
        <Form.Item name="entityType" label={t("admin_purchase.supplier_entity_type")}>
          <Select allowClear style={{ minWidth: 170 }} options={[
            { value: "INDIVIDUAL", label: t("admin_purchase.supplier_individual") },
            { value: "JURISTIC", label: t("admin_purchase.supplier_juristic") },
          ]} />
        </Form.Item>
        <Form.Item name="taxId" label={t("admin_purchase.supplier_tax_id")}><Input maxLength={13} /></Form.Item>
        <Form.Item name="branchCode" label={t("admin_purchase.supplier_branch_code")}><Input maxLength={5} /></Form.Item>
      </Space>
      <Form.Item name="address" label={t("admin_purchase.supplier_address")}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      <Form.Item name="note" label={t("admin_purchase.supplier_note")}><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={loading}>{t("admin_purchase.supplier_save")}</Button>
    </Form>
  </Modal>;
}

function CreatePOModal({
  open, suppliers, retryScope, onClose, onDone,
}: {
  open: boolean;
  suppliers: Supplier[];
  retryScope: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [pendingCreate, setPendingCreate] = useState<{scope: string; variables: Record<string, unknown>} | null>(null);
  const pendingCreateKey = retryScope ? `bms.purchase.create.pending:${retryScope}` : "";
  useEffect(() => {
    setPendingCreate(null);
    if (!open || !retryScope) return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(pendingCreateKey) ?? "null");
      if (saved?.scope === retryScope && saved?.variables?.requestId && Array.isArray(saved.variables.items))
        setPendingCreate(saved);
    } catch { /* Invalid local retry evidence is ignored; the server still owns idempotency. */ }
  }, [open, retryScope, pendingCreateKey]);
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
      if (res?.status) {
        try { window.sessionStorage.removeItem(pendingCreateKey); } catch {}
        setPendingCreate(null);
      }
      if (res?.status === "CREATED") { message.success(res.message || t("admin_purchase.create_success")); form.resetFields(); onDone(); }
      else message.error(res?.message || t("admin_purchase.create_failed"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_purchase.create_failed")),
  });

  const submit = async () => {
    if (pendingCreate) {
      if (pendingCreate.scope === retryScope) await create({ variables: pendingCreate.variables });
      return;
    }
    if (!retryScope) return;
    // AntD displays field errors; a rejected validation is not an unhandled page error.
    let v;
    try { v = await form.validateFields(); } catch { return; }
    const items = (v.items || []).map((it: any) => ({
      sku: it.sku,
      size: it.size,
      qty: Number(it.qty),
      unitCost: it.supplierUnitName && it.unitCost == null ? null : Number(it.unitCost ?? 0),
      additionalUnitCost: Number(it.additionalUnitCost ?? 0),
      additionalCostNote: it.additionalUnitCost > 0 ? String(it.additionalCostNote ?? "").trim() : null,
      supplierSku: it.supplierSku || null,
      supplierProductName: it.supplierProductName || null,
      supplierBarcode: it.supplierBarcode || null,
      supplierUnitName: it.supplierUnitName || null,
      supplierUnitQty: it.supplierUnitQty == null ? null : Number(it.supplierUnitQty),
      baseQtyPerSupplierUnit: it.baseQtyPerSupplierUnit == null ? null : Number(it.baseQtyPerSupplierUnit),
      conversionEvidence: it.conversionEvidence || null,
    }));
    const variables = {
        supplierId: selectedSupplier?.id ?? null,
        supplierName: selectedSupplier ? null : v.supplierName || null,
        note: v.note || null,
        requestId: crypto.randomUUID(),
        items,
    };
    const pending = { scope: retryScope, variables };
    try { window.sessionStorage.setItem(pendingCreateKey, JSON.stringify(pending)); }
    catch { message.error(t("admin_purchase.create_retry_storage_failed")); return; }
    setPendingCreate(pending);
    await create({ variables });
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
      title={t("admin_purchase.create_modal_title")} open={open} onCancel={() => { if (!pendingCreate) onClose(); }} onOk={submit}
      closable={!pendingCreate} maskClosable={!pendingCreate} keyboard={!pendingCreate}
      cancelButtonProps={{ disabled: !!pendingCreate }}
      confirmLoading={loading} okText={t("admin_purchase.create_ok_text")} cancelText={t("admin_purchase.btn_cancel")} width={1100} destroyOnClose
    >
      <Form form={form} layout="vertical" disabled={!!pendingCreate} initialValues={{ items: [{ additionalUnitCost: 0 }] }}>
        <Alert closable type="info" showIcon message={t("admin_purchase.supplier_unit_hint")} style={{ marginBottom: 16 }} />
        {pendingCreate && <Alert closable type="warning" showIcon message={t("admin_purchase.create_retry_pending")} />}
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
        <Alert closable
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
                  <Form.Item {...rest} name={[name, "supplierUnitName"]}>
                    <Input placeholder={t("admin_purchase.supplier_unit_name")} maxLength={100} style={{ width: 125 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "supplierUnitQty"]}>
                    <InputNumber placeholder={t("admin_purchase.supplier_unit_qty")} min={1} precision={0} style={{ width: 125 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "baseQtyPerSupplierUnit"]}>
                    <InputNumber placeholder={t("admin_purchase.base_qty_per_supplier_unit")} min={2} precision={0} style={{ width: 145 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "conversionEvidence"]}>
                    <Input placeholder={t("admin_purchase.conversion_evidence")} maxLength={500} style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unitCost"]} dependencies={[["items", name, "supplierUnitName"]]}
                    rules={[({ getFieldValue }) => ({ validator: async (_, value) => {
                      if (getFieldValue(["items", name, "supplierUnitName"]) && value == null)
                        throw new Error(t("admin_purchase.supplier_unit_cost_required"));
                    } })]}>
                    <InputNumber placeholder={t("admin_purchase.unit_cost_placeholder")} min={0} precision={2} style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "additionalUnitCost"]} initialValue={0}>
                    <InputNumber placeholder={t("admin_purchase.additional_unit_cost_placeholder")} min={0} precision={2} style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "additionalCostNote"]} dependencies={[["items", name, "additionalUnitCost"]]}
                    rules={[({ getFieldValue }) => ({ validator: async (_, value) => {
                      if (Number(getFieldValue(["items", name, "additionalUnitCost"]) ?? 0) > 0 && !String(value ?? "").trim()) {
                        throw new Error(t("admin_purchase.additional_cost_note_required"));
                      }
                    } })]}>
                    <Input placeholder={t("admin_purchase.additional_cost_note_placeholder")} maxLength={500} style={{ width: 220 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(name)} />}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ additionalUnitCost: 0 })} icon={<PlusOutlined />} block>{t("admin_purchase.add_item")}</Button>
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
  const [pendingReceipt, setPendingReceipt] = useState<{ id: string; items: any[]; idempotencyKey: string; locationId?: string | null } | null>(null);
  const submitting = useRef(false);
  const pendingKey = po ? `bms.purchase.pending:${po.id}` : "";
  const receivingLocations = useQuery<{ bmsPurchaseReceivingLocations: Array<{ id: string; name: string; branchCode: string; active: boolean }> }>(Q_RECEIVING_LOCATIONS, {
    skip: !po,
    fetchPolicy: "network-only",
  });
  const locations = receivingLocations.data?.bmsPurchaseReceivingLocations ?? [];
  useEffect(() => {
    if (!po) return;
    setPendingReceipt(null);
    form.resetFields();
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null");
      if (saved?.id === po.id && Array.isArray(saved.items) && typeof saved.idempotencyKey === "string") {
        setPendingReceipt(saved);
        const values: Record<string, unknown> = { lots: [], locationId: saved.locationId ?? null };
        po.items.filter(item => item.qtyReceived < item.qtyOrdered).forEach((item, index) => {
          const original = saved.items.find((line: any) => line.sku === item.sku && line.size === item.size);
          values[`${item.sku}__${item.size}`] = original?.qty ?? 0;
          if (item.baseQtyPerSupplierUnit) values[`${item.sku}__${item.size}__supplier`] = original?.supplierQty ?? 0;
          (values.lots as any[])[index] = { lotNo: original?.lotNo, expiryDate: original?.expiryDate };
        });
        form.setFieldsValue(values);
      }
    } catch { message.error(t("admin_purchase.receive_unknown")); }
  }, [po?.id, pendingKey, form]);
  useEffect(() => {
    if (!po || !receivingLocations.data || pendingReceipt) return;
    if (locations.length === 1 && !form.getFieldValue("locationId")) form.setFieldValue("locationId", locations[0].id);
  }, [po?.id, receivingLocations.data, pendingReceipt, locations, form]);
  const [receive, { loading }] = useMutation(M_RECEIVE, {
    onCompleted: (d: any) => {
      const res = d?.bmsReceivePurchaseOrder;
      if (!["RECEIVED", "PARTIAL", "PO_NOT_FOUND", "LOCATION_NOT_FOUND", "BRANCH_FORBIDDEN", "INVALID_INPUT", "INVALID_STATE", "LINE_NOT_FOUND", "OVER_RECEIVE", "IDEMPOTENCY_CONFLICT", "EMPTY"].includes(res?.status)) {
        message.error(t("admin_purchase.receive_unknown")); return;
      }
      try { window.sessionStorage.removeItem(pendingKey); } catch {}
      setPendingReceipt(null);
      if (res?.status === "RECEIVED" || res?.status === "PARTIAL") {
        message.success(t(res.replayed ? "admin_purchase.receive_replayed" : res.status === "RECEIVED" ? "admin_purchase.receive_complete" : "admin_purchase.receive_partial"));
        onDone();
      } else {
        const correction: Record<string, string> = {
          LOT_REQUIRED: "admin_purchase.receive_lot_required",
          EXPIRY_REQUIRED: "admin_purchase.receive_expiry_required",
          LOT_REVIEW_REQUIRED: "admin_purchase.receive_lot_review_required",
          SUPPLIER_UNIT_MISMATCH: "admin_purchase.receive_supplier_unit_mismatch",
          IDEMPOTENCY_REQUIRED: "admin_purchase.receive_idempotency_required",
        };
        const failures: Record<string, string> = {
          PO_NOT_FOUND: "admin_purchase.receive_po_not_found",
          LOCATION_NOT_FOUND: "admin_purchase.receive_location_not_found",
          BRANCH_FORBIDDEN: "admin_purchase.receive_branch_forbidden",
          INVALID_INPUT: "admin_purchase.receive_invalid_input",
          INVALID_STATE: "admin_purchase.receive_invalid_state",
          LINE_NOT_FOUND: "admin_purchase.receive_line_not_found",
          OVER_RECEIVE: "admin_purchase.receive_over_receive",
          IDEMPOTENCY_CONFLICT: "admin_purchase.receive_retry_conflict",
          EMPTY: "admin_purchase.receive_qty_warning",
        };
        const item = res?.sku && res?.size ? `${res.sku}/${res.size}: ` : "";
        const key = correction[res?.reasonCode] ?? failures[res?.status];
        message.error(key ? `${item}${t(key)}` : t("admin_purchase.receive_failed"));
      }
    },
    onError: () => message.error(t("admin_purchase.receive_unknown")),
  });

  const pending = (po?.items || []).filter((it) => it.qtyOrdered - it.qtyReceived > 0);

  const submit = async () => {
    if (!po || submitting.current) return;
    submitting.current = true;
    try {
    if (pendingReceipt) {
      await receive({ variables: pendingReceipt, context: { fetchOptions: { signal: AbortSignal.timeout(20_000) } } });
      return;
    }
    const v = await form.validateFields();
    const items = pending
      .map((it, index) => ({
        sku: it.sku, size: it.size, qty: Number(v[`${it.sku}__${it.size}`] ?? 0),
        ...(it.baseQtyPerSupplierUnit ? { supplierQty: Number(v[`${it.sku}__${it.size}__supplier`] ?? 0) } : {}),
        lotNo: v.lots?.[index]?.lotNo?.trim() || null,
        expiryDate: v.lots?.[index]?.expiryDate || null,
      }))
      .filter((it) => it.qty > 0);
    if (items.length === 0) { message.warning(t("admin_purchase.receive_qty_warning")); return; }
    const locationId = String(v.locationId ?? "");
    if (!locations.some((location) => location.id === locationId)) {
      message.error(t("admin_purchase.receive_location_required")); return;
    }
    const variables = { id: po.id, items, idempotencyKey: crypto.randomUUID(), locationId };
    try { window.sessionStorage.setItem(pendingKey, JSON.stringify(variables)); }
    catch { message.error(t("admin_purchase.receive_retry_storage_failed")); return; }
    setPendingReceipt(variables);
    await receive({ variables, context: { fetchOptions: { signal: AbortSignal.timeout(20_000) } } });
    } catch (error: any) {
      if (!error?.errorFields) message.error(t("admin_purchase.receive_unknown"));
    } finally { submitting.current = false; }
  };

  return (
    <Modal
      title={t("admin_purchase.receive_modal_title", { id: po?.id.slice(0, 8) ?? "" })}
      open={!!po} onCancel={() => { if (!pendingReceipt && !submitting.current) onClose(); }} onOk={submit}
      closable={!pendingReceipt} maskClosable={!pendingReceipt} keyboard={!pendingReceipt} cancelButtonProps={{ disabled: !!pendingReceipt }}
      confirmLoading={loading} okText={t(pendingReceipt ? "admin_purchase.receive_retry" : "admin_purchase.receive_ok_text")} cancelText={t("admin_purchase.close_text")} destroyOnClose
    >
      <Alert closable type="info" showIcon style={{ marginBottom: 16 }}
        message={t("admin_purchase.receive_alert")} />
      {pendingReceipt && !loading && <Alert closable type="warning" showIcon message={t("admin_purchase.receive_unknown")}
        description={pendingReceipt.items.map(item => `${item.sku}/${item.size}: ${item.qty}${item.lotNo ? ` · ${item.lotNo}` : ""}`).join(", ")} />}
      <Form form={form} layout="vertical" preserve={false} disabled={!!pendingReceipt}>
        <Form.Item name="locationId" label={t("admin_purchase.receive_location_label")}
          rules={[{ required: true, message: t("admin_purchase.receive_location_required") }]}>
          <Select loading={receivingLocations.loading} placeholder={t("admin_purchase.receive_location_required")}
            options={locations.map((location) => ({ value: location.id, label: `${location.branchCode} · ${location.name}` }))} />
        </Form.Item>
        {pending.length === 0 && <Typography.Text type="secondary">{t("admin_purchase.no_pending_items")}</Typography.Text>}
        {pending.map((it, index) => {
          const rem = it.qtyOrdered - it.qtyReceived;
          return (
            <div key={`${it.sku}-${it.size}`}>
            <Form.Item
              name={`${it.sku}__${it.size}`}
              label={t("admin_purchase.receive_item_label", { sku: it.sku, size: it.size, rem })}
              initialValue={rem}
              rules={[{ type: "number", min: 0, max: rem, message: t("admin_purchase.receive_item_max_error", { rem }) }]}
            >
              <InputNumber min={0} max={rem} precision={0} disabled={!!pendingReceipt || !!it.baseQtyPerSupplierUnit} style={{ width: 160 }} />
            </Form.Item>
            {it.baseQtyPerSupplierUnit && <Form.Item
              name={`${it.sku}__${it.size}__supplier`}
              label={t("admin_purchase.receive_supplier_unit_label", {
                unit: it.supplierUnitName ?? "", factor: it.baseQtyPerSupplierUnit,
              })}
              initialValue={rem / it.baseQtyPerSupplierUnit}
              rules={[{ type: "number", min: 0, max: rem / it.baseQtyPerSupplierUnit,
                message: t("admin_purchase.receive_supplier_unit_mismatch") }]}
            >
              <InputNumber min={0} max={rem / it.baseQtyPerSupplierUnit} precision={0} disabled={!!pendingReceipt} style={{ width: 160 }}
                onChange={(value) => form.setFieldValue(`${it.sku}__${it.size}`,
                  Number(value ?? 0) * it.baseQtyPerSupplierUnit!)} />
            </Form.Item>}
            <Form.Item name={["lots", index, "lotNo"]} label={t("admin_purchase.receive_lot_no")}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name={["lots", index, "expiryDate"]} label={t("admin_purchase.receive_expiry_date")}>
              <Input type="date" />
            </Form.Item>
            </div>
          );
        })}
      </Form>
    </Modal>
  );
}

export default function Page() {
  return <PurchaseManagement />;
}
