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
} from "antd";
import { useState, useMemo, useEffect } from "react";
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
type POItem = { sku: string; size: string; qtyOrdered: number; qtyReceived: number; unitCost: number };
type Supplier = { id: string; name: string };
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
      items { sku size qtyOrdered qtyReceived unitCost }
    }
  }
`;
const Q_PRODUCTS = gql`query { bmsProducts { sku name variants { size } } }`;
const M_CREATE = gql`
  mutation ($supplierName: String, $note: String, $items: [BmsPurchaseItemInput!]!) {
    bmsCreatePurchaseOrder(supplierName: $supplierName, note: $note, items: $items) { status poId message }
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
  const { data: prodData } = useQuery(Q_PRODUCTS, { fetchPolicy: "cache-and-network" });
  const products: ProductOpt[] = prodData?.bmsProducts || [];

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
        open={createOpen} products={products}
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
  open, products, onClose, onDone,
}: { open: boolean; products: ProductOpt[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form] = Form.useForm();
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
      sku: it.sku, size: it.size, qty: Number(it.qty), unitCost: Number(it.unitCost ?? 0),
    }));
    create({ variables: { supplierName: v.supplierName || null, note: v.note || null, items } });
  };

  return (
    <Modal
      title={t("admin_purchase.create_modal_title")} open={open} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText={t("admin_purchase.create_ok_text")} cancelText={t("admin_purchase.btn_cancel")} width={720} destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ items: [{}] }}>
        <Form.Item name="supplierName" label={t("admin_purchase.supplier_label")}>
          <Input placeholder={t("admin_purchase.supplier_placeholder")} />
        </Form.Item>
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
                      showSearch style={{ width: 200 }} placeholder="SKU"
                      options={products.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
                      filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                    />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true, message: t("admin_purchase.size_required") }]}>
                    <Input placeholder={t("admin_purchase.size_placeholder")} style={{ width: 110 }} />
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
