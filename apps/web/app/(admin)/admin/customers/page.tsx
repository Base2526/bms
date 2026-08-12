'use client';
import { gql, useQuery, useLazyQuery, useMutation } from "@apollo/client";
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, message, Alert, Typography, Divider, Empty, Popconfirm,
} from "antd";
import { useState, useMemo } from "react";
import { PlusOutlined, EditOutlined, ReloadOutlined, EnvironmentOutlined, DeleteOutlined, MergeCellsOutlined, TagOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

type Address = { id: string; label: string | null; address: string; is_default: boolean };
type Identity = { channel: string; external_ref: string };
type Order = { id: string; channel: string; status: string; total_amount: number; created_at: string };
type CustomerCoupon = {
  id: string;
  walletId: string | null;
  code: string;
  type: string;
  value: number;
  minOrderAmount: number | null;
  expiresAt: string | null;
  available: boolean;
  reason: string | null;
  assignedAt: string | null;
  state: string;
  redeemedOrderId: string | null;
  reservedOrderId: string | null;
  customerUsedCount: number;
  remainingRedemptions: number | null;
};
type Customer = {
  id: string; name: string; phone: string | null; note: string | null;
  tags: string[]; total_spent: number; order_count: number; created_at: string;
  addresses: Address[]; identities: Identity[]; orders: Order[]; coupons: CustomerCoupon[];
};

const Q_CUSTOMERS = gql`
  query ($search: String) {
    bmsCustomers(search: $search, limit: 100) {
      id name phone note tags total_spent order_count created_at
      identities { channel external_ref }
      addresses { id label address is_default }
      orders { id channel status total_amount created_at }
      coupons {
        id walletId code type value minOrderAmount expiresAt available reason
        assignedAt state redeemedOrderId reservedOrderId customerUsedCount remainingRedemptions
      }
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
const M_MERGE = gql`mutation ($keepId: ID!, $mergeId: ID!) { bmsMergeCustomers(keepId: $keepId, mergeId: $mergeId) }`;
const M_REORDER = gql`mutation ($id: ID!) { bmsReorderFromOrder(id: $id) { status orderId total message } }`;

// ⚠️ คีย์ของ TAG_COLOR และค่าใน TAG_OPTIONS เป็น "ค่าที่เก็บใน DB" (customers.tags) ไม่ใช่ UI copy
// ห้ามแปลตามภาษา UI — ถ้าแปล แท็กที่ลูกค้าเก่ามีอยู่จะ match สีไม่ได้ และแท็กที่สร้างใหม่จาก
// UI ภาษาอังกฤษจะกลายเป็นค่าคนละตัวกับของเดิม (หลักเดียวกับ HEADER_MAP ใน ImportModal.tsx)
const TAG_COLOR: Record<string, string> = {
  VIP: "gold",
  "ลูกค้าใหม่": "blue",
  "ลูกค้าประจำ": "green",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const COUPON_STATE_COLOR: Record<string, string> = {
  ASSIGNED: "blue",
  RESERVED: "purple",
  REDEEMED: "green",
  EXPIRED: "orange",
  REVOKED: "red",
};
const COUPON_STATE_LABEL_KEY: Record<string, string> = {
  ASSIGNED: "coupon_state_assigned",
  RESERVED: "coupon_state_reserved",
  REDEEMED: "coupon_state_redeemed",
  EXPIRED: "coupon_state_expired",
  REVOKED: "coupon_state_revoked",
};
const TAG_OPTIONS = ["VIP", "ลูกค้าใหม่", "ลูกค้าประจำ"];

function formatDiscount(coupon: CustomerCoupon, t: TFn) {
  const value = Number(coupon.value).toLocaleString();
  return coupon.type === "PERCENT"
    ? t("admin_customers.discount_percent", { value })
    : t("admin_customers.discount_fixed", { value });
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function CustomersManagement() {
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [addrForm] = Form.useForm();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [addrFor, setAddrFor] = useState<Customer | null>(null);
  const [editingAddr, setEditingAddr] = useState<Address | null>(null); // มีค่า = โหมดแก้ไขที่อยู่เดิม (ไม่ใช่เพิ่มใหม่)
  const [mergeFor, setMergeFor] = useState<Customer | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  const { data, loading, error, refetch } = useQuery(Q_CUSTOMERS, {
    variables: { search: search || null },
    fetchPolicy: "cache-and-network",
  });
  const onErr = (e: any) => message.error(e?.message || t("admin_customers.action_failed"));

  const [searchDupes, { data: dupeData, loading: dupeLoading }] = useLazyQuery(Q_CUSTOMERS, { fetchPolicy: "network-only" });
  const [merge, { loading: merging }] = useMutation(M_MERGE, {
    onCompleted: () => { message.success(t("admin_customers.merged")); closeMergeModal(); refetch(); },
    onError: onErr,
  });
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reorder] = useMutation(M_REORDER, {
    onCompleted: (d: any) => {
      const r = d?.bmsReorderFromOrder;
      setReorderingId(null);
      if (r?.status === "CREATED") { message.success(r.message); refetch(); }
      else message.error(r?.message || t("admin_customers.reorder_failed"));
    },
    onError: (e) => { setReorderingId(null); onErr(e); },
  });

  const [upsert, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success(t("admin_customers.saved")); setModalOpen(false); setEditing(null); form.resetFields(); refetch(); },
    onError: onErr,
  });
  const [addAddr, { loading: savingAddr }] = useMutation(M_ADDR, {
    onCompleted: () => { message.success(t("admin_customers.address_added")); setAddrFor(null); addrForm.resetFields(); refetch(); },
    onError: onErr,
  });
  const [updateAddr, { loading: updatingAddr }] = useMutation(M_UPDATE_ADDR, {
    onCompleted: () => { message.success(t("admin_customers.address_saved")); setAddrFor(null); setEditingAddr(null); addrForm.resetFields(); refetch(); },
    onError: onErr,
  });
  const [setDefaultAddr] = useMutation(M_SET_DEFAULT_ADDR, {
    onCompleted: () => { message.success(t("admin_customers.default_set")); refetch(); },
    onError: onErr,
  });
  const [deleteAddr] = useMutation(M_DELETE_ADDR, {
    onCompleted: () => { message.success(t("admin_customers.address_deleted")); refetch(); },
    onError: onErr,
  });
  const [del] = useMutation(M_DELETE, {
    onCompleted: (d) => { d?.bmsDeleteCustomer ? (message.success(t("admin_customers.customer_deleted")), refetch()) : onErr({ message: t("admin_customers.delete_failed") }); },
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
  const openMerge = (c: Customer) => { setMergeFor(c); setMergeTargetId(null); searchDupes({ variables: { search: c.phone || c.name } }); };
  const closeMergeModal = () => { setMergeFor(null); setMergeTargetId(null); };
  const submitMerge = () => {
    if (!mergeFor || !mergeTargetId) return;
    merge({ variables: { keepId: mergeFor.id, mergeId: mergeTargetId } });
  };
  const submitAddr = async () => {
    const v = await addrForm.validateFields();
    if (editingAddr) {
      await updateAddr({ variables: { addressId: editingAddr.id, label: v.label?.trim() || null, address: v.address.trim() } });
    } else {
      await addAddr({ variables: { id: addrFor!.id, label: v.label?.trim() || null, address: v.address.trim(), isDefault: !!v.isDefault } });
    }
  };

  const columns = useMemo(() => [
    { title: t("admin_customers.col_name"), dataIndex: "name", key: "name",
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
    { title: t("admin_customers.col_phone"), dataIndex: "phone", key: "phone", width: 130,
      render: (p: string | null) => p || <span style={{ color: "#999" }}>—</span> },
    { title: "Tags", dataIndex: "tags", key: "tags",
      render: (tags: string[]) => tags?.length
        ? tags.map((t) => <Tag key={t} color={TAG_COLOR[t] || "default"}>{t}</Tag>)
        : <span style={{ color: "#999" }}>—</span> },
    { title: t("admin_customers.col_total_spent"), dataIndex: "total_spent", key: "total", width: 130, align: "right" as const,
      render: (v: number) => <Text strong style={{ color: "#389e0d" }}>{Number(v).toLocaleString()} ฿</Text> },
    { title: t("admin_customers.col_orders"), dataIndex: "order_count", key: "oc", width: 90, align: "center" as const,
      render: (n: number) => <Tag color={n > 0 ? "blue" : "default"}>{n}</Tag> },
    { title: t("admin_customers.col_coupons"), dataIndex: "coupons", key: "coupons", width: 100, align: "center" as const,
      render: (coupons: CustomerCoupon[]) => {
        const count = coupons?.length || 0;
        const usable = coupons?.filter((coupon) => coupon.available).length || 0;
        if (!count) return <Tag>0</Tag>;
        return <Tag color={usable > 0 ? "gold" : "default"}>{usable}/{count}</Tag>;
      } },
    { title: "", key: "actions", width: 180,
      render: (_: any, c: Customer) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(c)}>{t("admin_customers.btn_edit")}</Button>
          <Button type="link" size="small" icon={<EnvironmentOutlined />} onClick={() => openAddAddress(c)}>{t("admin_customers.btn_address")}</Button>
          <Button type="link" size="small" icon={<MergeCellsOutlined />} onClick={() => openMerge(c)}>{t("admin_customers.btn_merge")}</Button>
          <Popconfirm title={t("admin_customers.delete_confirm")} okText={t("admin_customers.delete_ok")} okButtonProps={{ danger: true }} cancelText={t("admin_customers.delete_cancel")} onConfirm={() => del({ variables: { id: c.id } })}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) },
  ], []);

  if (error) return <Alert type="error" message={t("admin_customers.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Customers (CRM)</h2>
          <Space wrap>
            <Input.Search placeholder={t("admin_customers.search_placeholder")} allowClear style={{ width: 220 }}
              onSearch={(v) => setSearch(v)} onChange={(e) => !e.target.value && setSearch("")} />
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("admin_customers.btn_add_customer")}</Button>
          </Space>
        </Space>
      </div>

      <Alert type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_customers.info_banner")} />

      <Table
        rowKey="id" loading={loading} dataSource={customers} columns={columns}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (c: Customer) => (
            <CustomerDetail
              c={c}
              onAddAddress={() => openAddAddress(c)}
              onEditAddress={(a) => openEditAddress(c, a)}
              onSetDefaultAddress={(a) => setDefaultAddr({ variables: { addressId: a.id } })}
              onDeleteAddress={(a) => deleteAddr({ variables: { addressId: a.id } })}
              reorderingId={reorderingId}
              onReorder={(orderId) => { setReorderingId(orderId); reorder({ variables: { id: orderId } }); }}
            />
          ),
        }}
        pagination={{ pageSize: 20, showTotal: (t) => `Total ${t} customer(s)` }}
      />

      {/* modal แก้ไข/สร้างลูกค้า */}
      <Modal title={editing ? t("admin_customers.modal_edit_title", { name: editing.name }) : t("admin_customers.modal_create_title")} open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
        onOk={submit} confirmLoading={saving} okText={editing ? t("admin_customers.btn_save") : t("admin_customers.btn_create")} width={520}>
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label={t("admin_customers.form_name")} name="name" rules={[{ required: true, message: t("admin_customers.form_name_required") }]}>
            <Input placeholder={t("admin_customers.form_name_placeholder")} />
          </Form.Item>
          <Form.Item label={t("admin_customers.form_phone")} name="phone"><Input placeholder="08xxxxxxxx" /></Form.Item>
          <Form.Item label="Tags" name="tags">
            <Select mode="tags" options={TAG_OPTIONS.map((t) => ({ value: t, label: t }))} placeholder={t("admin_customers.form_tags_placeholder")} />
          </Form.Item>
          <Form.Item label={t("admin_customers.form_note")} name="note"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* modal เพิ่ม/แก้ไขที่อยู่ */}
      <Modal
        title={t("admin_customers.addr_modal_title", { action: editingAddr ? t("admin_customers.addr_modal_edit") : t("admin_customers.addr_modal_add"), name: addrFor?.name || "" })}
        open={!!addrFor}
        onCancel={closeAddrModal}
        onOk={submitAddr} confirmLoading={savingAddr || updatingAddr}
        okText={editingAddr ? t("admin_customers.btn_save") : t("admin_customers.btn_add")} width={480}
      >
        <Form form={addrForm} layout="vertical">
          <Form.Item label={t("admin_customers.form_label")} name="label"><Input placeholder={t("admin_customers.form_label_placeholder")} /></Form.Item>
          <Form.Item label={t("admin_customers.form_address")} name="address" rules={[{ required: true, message: t("admin_customers.form_address_required") }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {!editingAddr && (
            <Form.Item name="isDefault" valuePropName="checked" label={t("admin_customers.form_is_default")}>
              <Select options={[{ value: false, label: t("admin_customers.opt_no") }, { value: true, label: t("admin_customers.opt_yes") }]} defaultValue={false} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* modal ผสานลูกค้าซ้ำ */}
      <Modal
        title={t("admin_customers.merge_modal_title", { name: mergeFor?.name || "" })}
        open={!!mergeFor}
        onCancel={closeMergeModal}
        onOk={submitMerge}
        confirmLoading={merging}
        okText={t("admin_customers.btn_merge_ok")} okButtonProps={{ disabled: !mergeTargetId }}
        width={520}
      >
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={t("admin_customers.merge_info")}
          description={t("admin_customers.merge_desc", { name: mergeFor?.name || "" })}
        />
        <Select
          showSearch style={{ width: "100%" }}
          placeholder={t("admin_customers.merge_search_placeholder")}
          filterOption={false}
          loading={dupeLoading}
          value={mergeTargetId}
          onSearch={(v) => searchDupes({ variables: { search: v } })}
          onChange={(v) => setMergeTargetId(v)}
          options={(dupeData?.bmsCustomers || [])
            .filter((c: Customer) => c.id !== mergeFor?.id)
            .map((c: Customer) => ({
              value: c.id,
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ""} · ${c.order_count} ${t("admin_customers.merge_option_orders")} · ${Number(c.total_spent).toLocaleString()} ฿`,
            }))}
        />
      </Modal>
    </div>
  );
}

function CustomerDetail({
  c, onAddAddress, onEditAddress, onSetDefaultAddress, onDeleteAddress, reorderingId, onReorder,
}: {
  c: Customer;
  onAddAddress: () => void;
  onEditAddress: (a: Address) => void;
  onSetDefaultAddress: (a: Address) => void;
  onDeleteAddress: (a: Address) => void;
  reorderingId: string | null;
  onReorder: (orderId: string) => void;
}) {
  const { t } = useI18n();
  const couponCols = [
    { title: t("admin_customers.col_code"), dataIndex: "code", key: "code", width: 130, render: (code: string, coupon: CustomerCoupon) => (
      <Space direction="vertical" size={0}>
        <Text strong><TagOutlined /> {code}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{formatDiscount(coupon, t)}</Text>
      </Space>
    ) },
    { title: t("admin_customers.col_status"), dataIndex: "state", key: "state", width: 120, render: (state: string, coupon: CustomerCoupon) => (
      <Space direction="vertical" size={0}>
        <Tag color={COUPON_STATE_COLOR[state] || "default"}>{COUPON_STATE_LABEL_KEY[state] ? t(`admin_customers.${COUPON_STATE_LABEL_KEY[state]}`) : state}</Tag>
        {!coupon.available && coupon.reason && <Text type="secondary" style={{ fontSize: 12 }}>{coupon.reason}</Text>}
      </Space>
    ) },
    { title: t("admin_customers.col_condition"), key: "condition", render: (_: any, coupon: CustomerCoupon) => (
      <Space wrap size={4}>
        {coupon.minOrderAmount != null && <Tag>{t("admin_customers.cond_min", { value: Number(coupon.minOrderAmount).toLocaleString() })}</Tag>}
        <Tag>{coupon.remainingRedemptions == null ? t("admin_customers.cond_unlimited") : t("admin_customers.cond_remaining", { count: coupon.remainingRedemptions })}</Tag>
        {coupon.customerUsedCount > 0 && <Tag color="green">{t("admin_customers.cond_used", { count: coupon.customerUsedCount })}</Tag>}
      </Space>
    ) },
    { title: t("admin_customers.col_expires"), dataIndex: "expiresAt", key: "expiresAt", width: 130, render: (expiresAt: string | null) => formatDate(expiresAt) },
    { title: t("admin_customers.col_order"), key: "order", width: 120, render: (_: any, coupon: CustomerCoupon) => {
      const orderId = coupon.redeemedOrderId || coupon.reservedOrderId;
      return orderId ? <Text code>{orderId.slice(0, 8)}</Text> : <Text type="secondary">—</Text>;
    } },
  ];
  const orderCols = [
    { title: "Order", dataIndex: "id", key: "id", width: 100, render: (id: string) => <Text code>{id.slice(0, 8)}</Text> },
    { title: "Channel", dataIndex: "channel", key: "ch", width: 90 },
    { title: "Status", dataIndex: "status", key: "st", width: 120, render: (s: string) => <Tag color={STATUS_COLOR[s] || "default"}>{s}</Tag> },
    { title: t("admin_customers.col_amount"), dataIndex: "total_amount", key: "amt", width: 110, align: "right" as const, render: (v: number) => `${Number(v).toLocaleString()} ฿` },
    { title: t("admin_customers.col_date"), dataIndex: "created_at", key: "d", render: (d: string) => new Date(d).toLocaleString() },
    { title: "", key: "actions", width: 90, render: (_: any, o: Order) => (
      <Button type="link" size="small" loading={reorderingId === o.id} onClick={() => onReorder(o.id)}>{t("admin_customers.btn_reorder")}</Button>
    ) },
  ];
  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text strong><EnvironmentOutlined /> {t("admin_customers.section_addresses")}</Text>
        <Button size="small" type="link" icon={<PlusOutlined />} onClick={onAddAddress}>{t("admin_customers.btn_add_address")}</Button>
      </Space>
      <div style={{ marginTop: 6, marginBottom: 12 }}>
        {c.addresses?.length ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            {c.addresses.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, width: "100%" }}>
                <div>
                  {a.is_default && <Tag color="green">{t("admin_customers.tag_default")}</Tag>}
                  {a.label && <Text strong>[{a.label}] </Text>}
                  <Text>{a.address}</Text>
                </div>
                <Space size={4} style={{ flexShrink: 0 }}>
                  <Button size="small" type="link" icon={<EditOutlined />} onClick={() => onEditAddress(a)} />
                  {!a.is_default && (
                    <Button size="small" type="link" onClick={() => onSetDefaultAddress(a)}>{t("admin_customers.btn_set_default")}</Button>
                  )}
                  <Popconfirm title={t("admin_customers.addr_delete_confirm")} okText={t("admin_customers.delete_ok")} okButtonProps={{ danger: true }} cancelText={t("admin_customers.delete_cancel")}
                    onConfirm={() => onDeleteAddress(a)}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </div>
            ))}
          </Space>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("admin_customers.no_addresses")} />}
      </div>
      <Divider style={{ margin: "8px 0" }} />
      <Text strong><TagOutlined /> {t("admin_customers.section_coupons", { count: c.coupons?.length || 0 })}</Text>
      <Table style={{ marginTop: 8, marginBottom: 12 }} rowKey={(coupon: CustomerCoupon) => coupon.walletId || coupon.id} dataSource={c.coupons || []} columns={couponCols}
        size="small" scroll={{ x: "max-content" }} pagination={{ pageSize: 5, hideOnSinglePage: true }} locale={{ emptyText: t("admin_customers.no_coupons") }} />
      <Divider style={{ margin: "8px 0" }} />
      <Text strong>🧾 {t("admin_customers.section_history", { count: c.orders?.length || 0 })}</Text>
      <Table style={{ marginTop: 8 }} rowKey="id" dataSource={c.orders || []} columns={orderCols}
        size="small" scroll={{ x: "max-content" }} pagination={{ pageSize: 5, hideOnSinglePage: true }} locale={{ emptyText: t("admin_customers.no_history") }} />
    </div>
  );
}

export default function Page() {
  return <CustomersManagement />;
}
