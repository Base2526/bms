'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  message,
  Alert,
  Typography,
  Tooltip,
} from "antd";
import { useState, useMemo } from "react";
import {
  PlusOutlined,
  EditOutlined,
  ReloadOutlined,
  WarningOutlined,
  HistoryOutlined,
} from "@ant-design/icons";

// ---- Types --------------------------------------------------
type Variant = {
  size: string;
  current_stock: number;
  reserved_stock: number;
  available: number;
  reorder_point: number;
  low: boolean;
};
type Product = {
  sku: string;
  name: string;
  active: boolean;
  price: number;
  keywords: string[];
  barcode: string | null;
  variants: Variant[];
};
type Movement = {
  id: string;
  size: string;
  type: string;
  qty: number;
  ref_order_id: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
};

// ---- GraphQL ------------------------------------------------
const Q_PRODUCTS = gql`
  query BmsProducts {
    bmsProducts {
      sku
      name
      active
      price
      keywords
      barcode
      variants {
        size
        current_stock
        reserved_stock
        available
        reorder_point
        low
      }
    }
  }
`;
const Q_LOW = gql`query { bmsLowStock { sku name size available reorder_point } }`;
const Q_MOVEMENTS = gql`
  query ($sku: String!) {
    bmsStockMovements(sku: $sku, limit: 30) {
      id
      size
      type
      qty
      ref_order_id
      note
      actor
      created_at
    }
  }
`;

const M_UPSERT = gql`mutation ($input: BmsProductInput!) { bmsUpsertProduct(input: $input) { sku } }`;
const M_SET_ACTIVE = gql`mutation ($sku: String!, $active: Boolean!) { bmsSetProductActive(sku: $sku, active: $active) }`;
const M_ADJUST = gql`
  mutation ($sku: String!, $size: String!, $delta: Int!) {
    bmsAdjustStock(sku: $sku, size: $size, delta: $delta) { size available }
  }
`;
const M_REORDER = gql`
  mutation ($sku: String!, $size: String!, $rp: Int!) {
    bmsSetReorderPoint(sku: $sku, size: $size, reorderPoint: $rp) { size low }
  }
`;

const MOVE_COLOR: Record<string, string> = {
  STOCK_IN: "green",
  STOCK_OUT: "volcano",
  RESERVE: "orange",
  RELEASE: "blue",
  FULFILL: "purple",
};

function ProductsManagement() {
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const { data, loading, error, refetch } = useQuery(Q_PRODUCTS, {
    fetchPolicy: "cache-and-network",
  });
  const { data: lowData, refetch: refetchLow } = useQuery(Q_LOW, {
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");
  const refreshAll = () => {
    refetch();
    refetchLow();
  };

  const [upsertProduct, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => {
      message.success("บันทึกสินค้าแล้ว");
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      refreshAll();
    },
    onError: onErr,
  });
  const [setActive] = useMutation(M_SET_ACTIVE, {
    onCompleted: () => { message.success("อัปเดตสถานะแล้ว"); refreshAll(); },
    onError: onErr,
  });

  const products: Product[] = data?.bmsProducts || [];
  const lowCount: number = lowData?.bmsLowStock?.length || 0;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ active: true, keywords: [] });
    setModalOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    form.setFieldsValue({
      sku: p.sku, name: p.name, price: p.price,
      keywords: p.keywords, active: p.active, barcode: p.barcode || "",
    });
    setModalOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    await upsertProduct({
      variables: {
        input: {
          sku: v.sku.trim(), name: v.name.trim(), price: Number(v.price),
          keywords: v.keywords || [], active: v.active,
          barcode: v.barcode?.trim() || null,
        },
      },
    });
  };

  const columns = useMemo(
    () => [
      { title: "SKU", dataIndex: "sku", key: "sku", width: 120,
        render: (s: string) => <Typography.Text code>{s}</Typography.Text> },
      { title: "Barcode", dataIndex: "barcode", key: "barcode", width: 130,
        render: (b: string | null) => b || <span style={{ color: "#999" }}>—</span> },
      { title: "Name", dataIndex: "name", key: "name" },
      { title: "Price", dataIndex: "price", key: "price", width: 100, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      {
        title: "Stock", key: "stock", width: 170,
        render: (_: any, p: Product) => {
          const avail = p.variants.reduce((n, v) => n + v.available, 0);
          const lows = p.variants.filter((v) => v.low).length;
          return (
            <Space size={4}>
              <Tag color={avail > 0 ? "green" : "default"}>{avail} ชิ้น</Tag>
              {lows > 0 && (
                <Tag icon={<WarningOutlined />} color="warning">ใกล้หมด {lows}</Tag>
              )}
            </Space>
          );
        },
      },
      {
        title: "Active", dataIndex: "active", key: "active", width: 80,
        render: (active: boolean, p: Product) => (
          <Switch size="small" checked={active}
            onChange={(c) => setActive({ variables: { sku: p.sku, active: c } })} />
        ),
      },
      {
        title: "", key: "actions", width: 80,
        render: (_: any, p: Product) => (
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>Edit</Button>
        ),
      },
    ],
    []
  );

  if (error) {
    return <Alert type="error" message="โหลดสินค้าไม่ได้" description={error.message} showIcon />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Products & Inventory</h2>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>เพิ่มสินค้า</Button>
          </Space>
        </Space>
      </div>

      {lowCount > 0 && (
        <Alert
          type="warning" showIcon icon={<WarningOutlined />}
          message={`มีสินค้าใกล้หมด/หมด ${lowCount} รายการ`}
          description={
            <Space wrap>
              {(lowData?.bmsLowStock || []).map((x: any) => (
                <Tag color="warning" key={`${x.sku}-${x.size}`}>
                  {x.name} {x.size}: เหลือ {x.available} (จุดเตือน {x.reorder_point})
                </Tag>
              ))}
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Alert
        type="info"
        message="กางแถวเพื่อปรับสต็อก/จุดแจ้งเตือน + ดูประวัติการเคลื่อนไหว — reserved คุมโดยระบบผ่าน order, available = current − reserved"
        showIcon closable style={{ marginBottom: 16 }}
      />

      <Table
        rowKey="sku"
        loading={loading}
        dataSource={products}
        columns={columns}
        expandable={{ expandedRowRender: (p: Product) => <ProductDetail product={p} onChanged={refreshAll} /> }}
        pagination={false}
      />

      <Modal
        title={editing ? `แก้ไขสินค้า: ${editing.sku}` : "เพิ่มสินค้า"}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={submit} confirmLoading={saving}
        okText={editing ? "บันทึก" : "สร้าง"} width={560}
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="SKU" name="sku" rules={[{ required: true, message: "ระบุ SKU" }]}>
            <Input placeholder="เช่น NIKE-AIR" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="Barcode" name="barcode">
            <Input placeholder="เช่น 8850001234567 (ไม่บังคับ)" />
          </Form.Item>
          <Form.Item label="ชื่อสินค้า" name="name" rules={[{ required: true, message: "ระบุชื่อ" }]}>
            <Input placeholder="เช่น Nike Air" />
          </Form.Item>
          <Form.Item label="ราคา (บาท)" name="price" rules={[{ required: true, message: "ระบุราคา" }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Keywords (คำที่ลูกค้าพิมพ์แล้ว match สินค้านี้)" name="keywords">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="nike, ไนกี้, air" />
          </Form.Item>
          <Form.Item label="เปิดขาย" name="active" valuePropName="checked">
            <Switch checkedChildren="ขายอยู่" unCheckedChildren="ปิด" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ---- Expanded row: inventory editor + movement history ------
function ProductDetail({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");
  const [adjustStock] = useMutation(M_ADJUST, {
    onCompleted: () => { message.success("ปรับสต็อกแล้ว"); onChanged(); refetchMoves(); },
    onError: onErr,
  });
  const [setReorder] = useMutation(M_REORDER, {
    onCompleted: () => { message.success("ตั้งจุดแจ้งเตือนแล้ว"); onChanged(); },
    onError: onErr,
  });
  const { data: movesData, refetch: refetchMoves } = useQuery(Q_MOVEMENTS, {
    variables: { sku: product.sku },
    fetchPolicy: "cache-and-network",
  });

  const [newSize, setNewSize] = useState<string | undefined>();
  const [newQty, setNewQty] = useState<number>(1);

  const variantCols = [
    { title: "Size", dataIndex: "size", key: "size", width: 70 },
    { title: "Current", dataIndex: "current_stock", key: "cur", width: 80, align: "right" as const },
    { title: "Reserved", dataIndex: "reserved_stock", key: "res", width: 90, align: "right" as const,
      render: (v: number) => <Tag color={v > 0 ? "orange" : "default"}>{v}</Tag> },
    { title: "Available", dataIndex: "available", key: "avail", width: 90, align: "right" as const,
      render: (v: number, r: Variant) => (
        <strong style={{ color: r.low ? "#d46b08" : v > 0 ? "#389e0d" : "#999" }}>{v}</strong>
      ) },
    {
      title: "จุดเตือน", key: "reorder", width: 130,
      render: (_: any, r: Variant) => (
        <Space size={4}>
          <InputNumber
            size="small" min={0} defaultValue={r.reorder_point} style={{ width: 64 }}
            onBlur={(e) => {
              const rp = Number((e.target as HTMLInputElement).value);
              if (rp !== r.reorder_point)
                setReorder({ variables: { sku: product.sku, size: r.size, rp } });
            }}
          />
          {r.low && <Tag color="warning" icon={<WarningOutlined />}>ใกล้หมด</Tag>}
        </Space>
      ),
    },
    {
      title: "ปรับสต็อก", key: "adjust", width: 200,
      render: (_: any, v: Variant) => (
        <Space>
          <Button size="small" onClick={() => adjustStock({ variables: { sku: product.sku, size: v.size, delta: 10 } })}>+10</Button>
          <Button size="small" onClick={() => adjustStock({ variables: { sku: product.sku, size: v.size, delta: 1 } })}>+1</Button>
          <Button size="small" onClick={() => adjustStock({ variables: { sku: product.sku, size: v.size, delta: -1 } })}>−1</Button>
        </Space>
      ),
    },
  ];

  const moveCols = [
    { title: "เวลา", dataIndex: "created_at", key: "t", width: 165,
      render: (d: string) => new Date(d).toLocaleString() },
    { title: "ประเภท", dataIndex: "type", key: "type", width: 110,
      render: (t: string) => <Tag color={MOVE_COLOR[t] || "default"}>{t}</Tag> },
    { title: "Size", dataIndex: "size", key: "size", width: 60 },
    { title: "Qty", dataIndex: "qty", key: "qty", width: 60, align: "right" as const },
    { title: "Order", dataIndex: "ref_order_id", key: "ref", width: 100,
      render: (o: string | null) => o ? <Typography.Text code>{o.slice(0, 8)}</Typography.Text> : "—" },
    { title: "โดย", dataIndex: "actor", key: "actor", render: (a: string | null) => a || "—" },
  ];

  const SIZE_OPTS = ["S", "M", "L", "XL", "XXL"].filter((s) => !product.variants.some((v) => v.size === s));
  const moves: Movement[] = movesData?.bmsStockMovements || [];

  return (
    <div>
      <Table rowKey="size" dataSource={product.variants} columns={variantCols} pagination={false} size="small" />
      <Space style={{ marginTop: 12 }}>
        <span>เพิ่มไซซ์ใหม่:</span>
        <Select placeholder="size" style={{ width: 90 }} value={newSize} onChange={setNewSize}
          options={SIZE_OPTS.map((s) => ({ value: s, label: s }))} />
        <InputNumber min={1} value={newQty} onChange={(v) => setNewQty(Number(v) || 1)} />
        <Button type="primary" size="small" disabled={!newSize}
          onClick={() => {
            if (!newSize) return;
            adjustStock({ variables: { sku: product.sku, size: newSize, delta: newQty } });
            setNewSize(undefined); setNewQty(1);
          }}>เพิ่ม</Button>
      </Space>

      <div style={{ marginTop: 20 }}>
        <Typography.Text strong><HistoryOutlined /> ประวัติการเคลื่อนไหว (30 ล่าสุด)</Typography.Text>
        <Table
          style={{ marginTop: 8 }}
          rowKey="id" dataSource={moves} columns={moveCols} size="small"
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          locale={{ emptyText: "ยังไม่มีประวัติ" }}
        />
      </div>
    </div>
  );
}

export default function Page() {
  return <ProductsManagement />;
}
