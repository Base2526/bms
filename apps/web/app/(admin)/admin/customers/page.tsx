'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, message, Alert, Typography, Divider, Empty, Popconfirm,
} from "antd";
import { useState, useMemo } from "react";
import { PlusOutlined, EditOutlined, ReloadOutlined, EnvironmentOutlined, DeleteOutlined } from "@ant-design/icons";

const { Text } = Typography;

type Address = { id: string; label: string | null; address: string; is_default: boolean };
type Identity = { channel: string; external_ref: string };
type Order = { id: string; channel: string; status: string; total_amount: number; created_at: string };
type Customer = {
  id: string; name: string; phone: string | null; note: string | null;
  tags: string[]; total_spent: number; order_count: number; created_at: string;
  addresses: Address[]; identities: Identity[]; orders: Order[];
};

const Q_CUSTOMERS = gql`
  query ($search: String) {
    bmsCustomers(search: $search, limit: 100) {
      id name phone note tags total_spent order_count created_at
      identities { channel external_ref }
      addresses { id label address is_default }
      orders { id channel status total_amount created_at }
    }
  }
`;
const M_UPSERT = gql`mutation ($input: BmsCustomerInput!) { bmsUpsertCustomer(input: $input) { id } }`;
const M_ADDR = gql`
  mutation ($id: ID!, $label: String, $address: String!, $isDefault: Boolean) {
    bmsAddCustomerAddress(id: $id, label: $label, address: $address, isDefault: $isDefault) { id }
  }
`;
const M_UPDATE_ADDR = gql`
  mutation ($addressId: ID!, $label: String, $address: String!) {
    bmsUpdateCustomerAddress(addressId: $addressId, label: $label, address: $address) { id }
  }
`;
const M_SET_DEFAULT_ADDR = gql`mutation ($addressId: ID!) { bmsSetDefaultCustomerAddress(addressId: $addressId) { id } }`;
const M_DELETE_ADDR = gql`mutation ($addressId: ID!) { bmsDeleteCustomerAddress(addressId: $addressId) }`;
const M_DELETE = gql`mutation ($id: ID!) { bmsDeleteCustomer(id: $id) }`;

const TAG_COLOR: Record<string, string> = {
  VIP: "gold",
  "ลูกค้าใหม่": "blue",
  "ลูกค้าประจำ": "green",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const TAG_OPTIONS = ["VIP", "ลูกค้าใหม่", "ลูกค้าประจำ"];

function CustomersManagement() {
  const [form] = Form.useForm();
  const [addrForm] = Form.useForm();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [addrFor, setAddrFor] = useState<Customer | null>(null);
  const [editingAddr, setEditingAddr] = useState<Address | null>(null); // มีค่า = โหมดแก้ไขที่อยู่เดิม (ไม่ใช่เพิ่มใหม่)

  const { data, loading, error, refetch } = useQuery(Q_CUSTOMERS, {
    variables: { search: search || null },
    fetchPolicy: "cache-and-network",
  });
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");

  const [upsert, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success("บันทึกลูกค้าแล้ว"); setModalOpen(false); setEditing(null); form.resetFields(); refetch(); },
    onError: onErr,
  });
  const [addAddr, { loading: savingAddr }] = useMutation(M_ADDR, {
    onCompleted: () => { message.success("เพิ่มที่อยู่แล้ว"); setAddrFor(null); addrForm.resetFields(); refetch(); },
    onError: onErr,
  });
  const [updateAddr, { loading: updatingAddr }] = useMutation(M_UPDATE_ADDR, {
    onCompleted: () => { message.success("บันทึกที่อยู่แล้ว"); setAddrFor(null); setEditingAddr(null); addrForm.resetFields(); refetch(); },
    onError: onErr,
  });
  const [setDefaultAddr] = useMutation(M_SET_DEFAULT_ADDR, {
    onCompleted: () => { message.success("ตั้งเป็นค่าเริ่มต้นแล้ว"); refetch(); },
    onError: onErr,
  });
  const [deleteAddr] = useMutation(M_DELETE_ADDR, {
    onCompleted: () => { message.success("ลบที่อยู่แล้ว"); refetch(); },
    onError: onErr,
  });
  const [del] = useMutation(M_DELETE, {
    onCompleted: (d) => { d?.bmsDeleteCustomer ? (message.success("ลบลูกค้าแล้ว"), refetch()) : onErr({ message: "ลบไม่ได้" }); },
    onError: onErr,
  });

  const customers: Customer[] = data?.bmsCustomers || [];

  const openCreate = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ tags: [] }); setModalOpen(true); };
  const openEdit = (c: Customer) => {
    setEditing(c);
    form.setFieldsValue({ name: c.name, phone: c.phone || "", note: c.note || "", tags: c.tags });
    setModalOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    await upsert({ variables: { input: { id: editing?.id, name: v.name.trim(), phone: v.phone?.trim() || null, note: v.note?.trim() || null, tags: v.tags || [] } } });
  };
  const openAddAddress = (c: Customer) => { setAddrFor(c); setEditingAddr(null); addrForm.resetFields(); };
  const openEditAddress = (c: Customer, a: Address) => {
    setAddrFor(c);
    setEditingAddr(a);
    addrForm.setFieldsValue({ label: a.label || "", address: a.address });
  };
  const closeAddrModal = () => { setAddrFor(null); setEditingAddr(null); addrForm.resetFields(); };
  const submitAddr = async () => {
    const v = await addrForm.validateFields();
    if (editingAddr) {
      await updateAddr({ variables: { addressId: editingAddr.id, label: v.label?.trim() || null, address: v.address.trim() } });
    } else {
      await addAddr({ variables: { id: addrFor!.id, label: v.label?.trim() || null, address: v.address.trim(), isDefault: !!v.isDefault } });
    }
  };

  const columns = useMemo(() => [
    { title: "ชื่อ", dataIndex: "name", key: "name",
      render: (n: string, c: Customer) => (
        <Space direction="vertical" size={0}>
          <Text strong>{n}</Text>
          {c.identities?.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {c.identities.map((i) => `${i.channel}:${i.external_ref}`).join(", ")}
            </Text>
          )}
        </Space>
      ) },
    { title: "เบอร์โทร", dataIndex: "phone", key: "phone", width: 130,
      render: (p: string | null) => p || <span style={{ color: "#999" }}>—</span> },
    { title: "Tags", dataIndex: "tags", key: "tags",
      render: (tags: string[]) => tags?.length
        ? tags.map((t) => <Tag key={t} color={TAG_COLOR[t] || "default"}>{t}</Tag>)
        : <span style={{ color: "#999" }}>—</span> },
    { title: "ยอดซื้อสะสม", dataIndex: "total_spent", key: "total", width: 130, align: "right" as const,
      render: (v: number) => <Text strong style={{ color: "#389e0d" }}>{Number(v).toLocaleString()} ฿</Text> },
    { title: "ออเดอร์", dataIndex: "order_count", key: "oc", width: 90, align: "center" as const,
      render: (n: number) => <Tag color={n > 0 ? "blue" : "default"}>{n}</Tag> },
    { title: "", key: "actions", width: 180,
      render: (_: any, c: Customer) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(c)}>แก้ไข</Button>
          <Button type="link" size="small" icon={<EnvironmentOutlined />} onClick={() => openAddAddress(c)}>ที่อยู่</Button>
          <Popconfirm title="ลบลูกค้า (soft delete)?" okText="ลบ" okButtonProps={{ danger: true }} cancelText="ไม่" onConfirm={() => del({ variables: { id: c.id } })}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ], []);

  if (error) return <Alert type="error" message="โหลดลูกค้าไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Customers (CRM)</h2>
          <Space>
            <Input.Search placeholder="ค้นหา ชื่อ/เบอร์" allowClear style={{ width: 220 }}
              onSearch={(v) => setSearch(v)} onChange={(e) => !e.target.value && setSearch("")} />
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>เพิ่มลูกค้า</Button>
          </Space>
        </Space>
      </div>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message="ลูกค้าถูกสร้างอัตโนมัติเมื่อมี order เข้ามา (ผูกผ่าน channel:user_id) — กางแถวดูประวัติการซื้อ + ที่อยู่ · ยอดซื้อสะสมนับเฉพาะออเดอร์ที่จ่ายแล้ว" />

      <Table
        rowKey="id" loading={loading} dataSource={customers} columns={columns}
        expandable={{
          expandedRowRender: (c: Customer) => (
            <CustomerDetail
              c={c}
              onAddAddress={() => openAddAddress(c)}
              onEditAddress={(a) => openEditAddress(c, a)}
              onSetDefaultAddress={(a) => setDefaultAddr({ variables: { addressId: a.id } })}
              onDeleteAddress={(a) => deleteAddr({ variables: { addressId: a.id } })}
            />
          ),
        }}
        pagination={{ pageSize: 20, showTotal: (t) => `Total ${t} customer(s)` }}
      />

      {/* modal แก้ไข/สร้างลูกค้า */}
      <Modal title={editing ? `แก้ไข: ${editing.name}` : "เพิ่มลูกค้า"} open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={submit} confirmLoading={saving} okText={editing ? "บันทึก" : "สร้าง"} width={520}>
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="ชื่อลูกค้า" name="name" rules={[{ required: true, message: "ระบุชื่อ" }]}>
            <Input placeholder="เช่น คุณสมชาย" />
          </Form.Item>
          <Form.Item label="เบอร์โทร" name="phone"><Input placeholder="08xxxxxxxx" /></Form.Item>
          <Form.Item label="Tags" name="tags">
            <Select mode="tags" options={TAG_OPTIONS.map((t) => ({ value: t, label: t }))} placeholder="VIP / ลูกค้าใหม่ / ลูกค้าประจำ" />
          </Form.Item>
          <Form.Item label="โน้ต" name="note"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* modal เพิ่ม/แก้ไขที่อยู่ */}
      <Modal
        title={`${editingAddr ? "แก้ไขที่อยู่" : "เพิ่มที่อยู่"}: ${addrFor?.name || ""}`}
        open={!!addrFor}
        onCancel={closeAddrModal}
        onOk={submitAddr} confirmLoading={savingAddr || updatingAddr}
        okText={editingAddr ? "บันทึก" : "เพิ่ม"} width={480}
      >
        <Form form={addrForm} layout="vertical">
          <Form.Item label="ป้าย (บ้าน/ที่ทำงาน)" name="label"><Input placeholder="บ้าน" /></Form.Item>
          <Form.Item label="ที่อยู่" name="address" rules={[{ required: true, message: "ระบุที่อยู่" }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {!editingAddr && (
            <Form.Item name="isDefault" valuePropName="checked" label="ตั้งเป็นค่าเริ่มต้น">
              <Select options={[{ value: false, label: "ไม่" }, { value: true, label: "ใช่" }]} defaultValue={false} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

function CustomerDetail({
  c, onAddAddress, onEditAddress, onSetDefaultAddress, onDeleteAddress,
}: {
  c: Customer;
  onAddAddress: () => void;
  onEditAddress: (a: Address) => void;
  onSetDefaultAddress: (a: Address) => void;
  onDeleteAddress: (a: Address) => void;
}) {
  const orderCols = [
    { title: "Order", dataIndex: "id", key: "id", width: 100, render: (id: string) => <Text code>{id.slice(0, 8)}</Text> },
    { title: "Channel", dataIndex: "channel", key: "ch", width: 90 },
    { title: "Status", dataIndex: "status", key: "st", width: 120, render: (s: string) => <Tag color={STATUS_COLOR[s] || "default"}>{s}</Tag> },
    { title: "ยอด", dataIndex: "total_amount", key: "amt", width: 110, align: "right" as const, render: (v: number) => `${Number(v).toLocaleString()} ฿` },
    { title: "วันที่", dataIndex: "created_at", key: "d", render: (d: string) => new Date(d).toLocaleString() },
  ];
  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text strong><EnvironmentOutlined /> ที่อยู่</Text>
        <Button size="small" type="link" icon={<PlusOutlined />} onClick={onAddAddress}>เพิ่มที่อยู่</Button>
      </Space>
      <div style={{ marginTop: 6, marginBottom: 12 }}>
        {c.addresses?.length ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {c.addresses.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, width: "100%" }}>
                <div>
                  {a.is_default && <Tag color="green">ค่าเริ่มต้น</Tag>}
                  {a.label && <Text strong>[{a.label}] </Text>}
                  <Text>{a.address}</Text>
                </div>
                <Space size={4} style={{ flexShrink: 0 }}>
                  <Button size="small" type="link" icon={<EditOutlined />} onClick={() => onEditAddress(a)} />
                  {!a.is_default && (
                    <Button size="small" type="link" onClick={() => onSetDefaultAddress(a)}>ตั้งเป็นค่าเริ่มต้น</Button>
                  )}
                  <Popconfirm title="ลบที่อยู่นี้?" okText="ลบ" okButtonProps={{ danger: true }} cancelText="ไม่"
                    onConfirm={() => onDeleteAddress(a)}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </div>
            ))}
          </Space>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีที่อยู่" />}
      </div>
      <Divider style={{ margin: "8px 0" }} />
      <Text strong>🧾 ประวัติการซื้อ ({c.orders?.length || 0})</Text>
      <Table style={{ marginTop: 8 }} rowKey="id" dataSource={c.orders || []} columns={orderCols}
        size="small" pagination={{ pageSize: 5, hideOnSinglePage: true }} locale={{ emptyText: "ยังไม่มีประวัติ" }} />
    </div>
  );
}

export default function Page() {
  return <CustomersManagement />;
}
