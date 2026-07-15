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
const STATUS_LABEL: Record<POStatus, string> = {
  OPEN: "รอรับของ", PARTIAL: "รับบางส่วน", RECEIVED: "รับครบ", CANCELLED: "ยกเลิก",
};

type ProductOpt = { sku: string; name: string; variants: { size: string }[] };

function PurchaseManagement() {
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

  const onErr = (e: any) => message.error(e?.message || "การทำรายการล้มเหลว");
  const pos: PO[] = data?.bmsPurchaseOrders || [];

  const [cancel, { loading: canceling }] = useMutation(M_CANCEL, {
    onCompleted: (d: any) =>
      d?.bmsCancelPurchaseOrder
        ? (message.success("ยกเลิกใบสั่งซื้อแล้ว"), refetch())
        : onErr({ message: "ยกเลิกไม่ได้ (สถานะไม่ถูกต้อง)" }),
    onError: onErr,
  });

  const actionsFor = (r: PO) => {
    const btns: any[] = [];
    if ((r.status === "OPEN" || r.status === "PARTIAL") && can("purchase.receive")) {
      btns.push(
        <Button key="recv" type="link" size="small" icon={<InboxOutlined />} onClick={() => setReceivePO(r)}>
          รับของ
        </Button>
      );
    }
    if ((r.status === "OPEN" || r.status === "PARTIAL") && can("purchase.cancel")) {
      btns.push(
        <Popconfirm key="cancel" title="ยกเลิกใบสั่งซื้อนี้?" description="ของที่รับเข้าแล้วจะไม่ถูกดึงออก"
          okText="ยกเลิก PO" okButtonProps={{ danger: true }} cancelText="ไม่"
          disabled={canceling} onConfirm={() => cancel({ variables: { id: r.id } })}>
          <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={canceling}>ยกเลิก</Button>
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
      { title: "รับแล้ว / สั่ง", key: "progress", width: 130,
        render: (_: any, r: PO) => `${r.qtyReceived} / ${r.qtyOrdered} ชิ้น` },
      { title: "มูลค่า", dataIndex: "total", key: "total", width: 120, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      { title: "สถานะ", dataIndex: "status", key: "status", width: 140,
        render: (s: POStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: "สร้างเมื่อ", dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 180,
        render: (_: any, r: PO) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [canceling, can]
  );

  const itemColumns = [
    { title: "SKU", dataIndex: "sku", key: "sku" },
    { title: "Size", dataIndex: "size", key: "size", width: 80 },
    { title: "สั่ง", dataIndex: "qtyOrdered", key: "qo", width: 80, align: "right" as const },
    { title: "รับแล้ว", dataIndex: "qtyReceived", key: "qr", width: 90, align: "right" as const },
    { title: "คงค้าง", key: "rem", width: 90, align: "right" as const,
      render: (_: any, it: POItem) => it.qtyOrdered - it.qtyReceived },
    { title: "ทุน/หน่วย", dataIndex: "unitCost", key: "uc", width: 110, align: "right" as const,
      render: (v: number) => `${Number(v).toLocaleString()} ฿` },
  ];

  if (error) return <Alert type="error" message="โหลดใบสั่งซื้อไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>BMS Purchase (PO)</h2>
          <Space wrap>
            <Input.Search
              placeholder="ค้นหา PO / supplier / SKU"
              allowClear
              style={{ width: 260 }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {can("purchase.edit") && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>สร้างใบสั่งซื้อ</Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
          </Space>
        </Space>
      </div>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message="OPEN → (รับของ) PARTIAL → (รับครบ) RECEIVED  |  สต็อกเข้าเฉพาะตอนรับของ (บันทึก STOCK_IN) · ยกเลิกไม่ดึงของที่รับแล้วออก"
      />

      <Table
        rowKey="id" loading={loading} dataSource={pos} columns={columns}
        expandable={{
          expandedRowRender: (r: PO) => (
            <Table rowKey={(it) => `${it.sku}-${it.size}`} dataSource={r.items} columns={itemColumns} pagination={false} size="small" />
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
  const [form] = Form.useForm();
  const [create, { loading }] = useMutation(M_CREATE, {
    onCompleted: (d: any) => {
      const res = d?.bmsCreatePurchaseOrder;
      if (res?.status === "CREATED") { message.success(res.message || "สร้างแล้ว"); form.resetFields(); onDone(); }
      else message.error(res?.message || "สร้างไม่สำเร็จ");
    },
    onError: (e: any) => message.error(e?.message || "สร้างไม่สำเร็จ"),
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
      title="สร้างใบสั่งซื้อ (PO)" open={open} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText="สร้าง" cancelText="ยกเลิก" width={720} destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ items: [{}] }}>
        <Form.Item name="supplierName" label="ผู้ขาย (Supplier)">
          <Input placeholder="เช่น ABC Trading (เว้นว่างได้)" />
        </Form.Item>
        <Form.Item name="note" label="หมายเหตุ">
          <Input placeholder="เช่น ล็อตเดือน ก.ค." />
        </Form.Item>

        <Form.List name="items">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "sku"]} rules={[{ required: true, message: "เลือกสินค้า" }]}>
                    <Select
                      showSearch style={{ width: 200 }} placeholder="SKU"
                      options={products.map((p) => ({ value: p.sku, label: `${p.sku} · ${p.name}` }))}
                      filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
                    />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "size"]} rules={[{ required: true, message: "ระบุไซซ์" }]}>
                    <Input placeholder="Size (เช่น XL)" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "qty"]} rules={[{ required: true, message: "จำนวน" }]}>
                    <InputNumber placeholder="จำนวน" min={1} style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "unitCost"]}>
                    <InputNumber placeholder="ทุน/หน่วย" min={0} style={{ width: 120 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(name)} />}
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({})} icon={<PlusOutlined />} block>เพิ่มรายการ</Button>
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
  const [form] = Form.useForm();
  const [receive, { loading }] = useMutation(M_RECEIVE, {
    onCompleted: (d: any) => {
      const res = d?.bmsReceivePurchaseOrder;
      if (res?.status === "RECEIVED" || res?.status === "PARTIAL") { message.success(res.message || "รับของแล้ว"); onDone(); }
      else message.error(res?.message || "รับของไม่สำเร็จ");
    },
    onError: (e: any) => message.error(e?.message || "รับของไม่สำเร็จ"),
  });

  const pending = (po?.items || []).filter((it) => it.qtyOrdered - it.qtyReceived > 0);

  const submit = async () => {
    if (!po) return;
    const v = await form.validateFields();
    const items = pending
      .map((it) => ({ sku: it.sku, size: it.size, qty: Number(v[`${it.sku}__${it.size}`] ?? 0) }))
      .filter((it) => it.qty > 0);
    if (items.length === 0) { message.warning("ยังไม่ได้ระบุจำนวนที่รับ"); return; }
    receive({ variables: { id: po.id, items } });
  };

  return (
    <Modal
      title={`รับของเข้าสต็อก — PO ${po?.id.slice(0, 8) ?? ""}`}
      open={!!po} onCancel={onClose} onOk={submit}
      confirmLoading={loading} okText="รับของ (STOCK_IN)" cancelText="ปิด" destroyOnClose
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message="ระบุจำนวนที่รับจริงต่อรายการ — ค่าเริ่มต้น = จำนวนคงค้าง (รับบางส่วนได้)" />
      <Form form={form} layout="vertical">
        {pending.length === 0 && <Typography.Text type="secondary">ไม่มีรายการคงค้าง</Typography.Text>}
        {pending.map((it) => {
          const rem = it.qtyOrdered - it.qtyReceived;
          return (
            <Form.Item
              key={`${it.sku}-${it.size}`}
              name={`${it.sku}__${it.size}`}
              label={`${it.sku} · ${it.size} (คงค้าง ${rem})`}
              initialValue={rem}
              rules={[{ type: "number", min: 0, max: rem, message: `รับได้ไม่เกิน ${rem}` }]}
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
