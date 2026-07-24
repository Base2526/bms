'use client';
import { gql, useQuery, useMutation, useLazyQuery } from "@apollo/client";
import {
  Table, Tag, Button, Space, Alert, message, Modal, Form, Input, InputNumber,
  Select, Switch, DatePicker, Popconfirm, Typography, Empty,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import dayjs from "dayjs";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";

const { Text } = Typography;

const Q = gql`
  query {
    bmsCoupons {
      id code type value minOrderAmount maxRedemptions redemptionsCount
      perCustomerLimit startsAt expiresAt active note createdAt
    }
  }
`;
const M_UPSERT = gql`
  mutation ($input: BmsCouponInput!) {
    bmsUpsertCoupon(input: $input) { id }
  }
`;
const M_DELETE = gql`mutation ($id: ID!) { bmsDeleteCoupon(id: $id) }`;
const Q_REDEMPTIONS = gql`
  query ($couponId: ID!) {
    bmsCouponRedemptions(couponId: $couponId) {
      orderId customerName channel status discountAmount totalAmount createdAt
    }
  }
`;

const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};

const money = (n: number | null) => (n == null ? "—" : `${Number(n).toLocaleString()} ฿`);

function valueLabel(r: any) {
  return r.type === "PERCENT" ? `${r.value}%` : money(r.value);
}

// ---- Usage history modal — ไม่มีตาราง redemption แยก, query ตรงจาก bms_orders ----
function RedemptionsModal({ couponId, code, onClose }: { couponId: string | null; code: string; onClose: () => void }) {
  const [load, { data, loading }] = useLazyQuery(Q_REDEMPTIONS, { fetchPolicy: "network-only" });

  useEffect(() => {
    if (couponId) load({ variables: { couponId } });
  }, [couponId, load]);

  const rows = data?.bmsCouponRedemptions || [];

  return (
    <Modal
      title={`ประวัติการใช้โค้ด "${code}"`}
      open={!!couponId}
      onCancel={onClose}
      footer={<Button onClick={onClose}>ปิด</Button>}
      width={720}
    >
      <Table
        rowKey="orderId"
        size="small"
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: <Empty description="ยังไม่มีการใช้งาน" /> }}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "ลูกค้า", dataIndex: "customerName", render: (v: string | null) => v || "—" },
          { title: "ช่องทาง", dataIndex: "channel", width: 90 },
          {
            title: "สถานะออเดอร์", dataIndex: "status", width: 110,
            render: (v: string) => <Tag color={ORDER_STATUS_COLOR[v] || "default"}>{v}</Tag>,
          },
          { title: "ส่วนลด", dataIndex: "discountAmount", width: 100, align: "right" as const, render: money },
          { title: "ยอดสุทธิ", dataIndex: "totalAmount", width: 100, align: "right" as const, render: money },
          { title: "เมื่อ", dataIndex: "createdAt", width: 140, render: (v: string) => new Date(v).toLocaleString() },
        ]}
      />
    </Modal>
  );
}

export default function CouponsPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canManage = can("coupon.manage");
  const { data, loading, error, refetch } = useQuery(Q, {
    skip: permsLoading || !can("coupon.view"),
    fetchPolicy: "cache-and-network",
  });
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [viewingRedemptions, setViewingRedemptions] = useState<{ id: string; code: string } | null>(null);

  const [saveCoupon, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success("บันทึกโค้ดส่วนลดแล้ว"); setModalOpen(false); refetch(); },
    onError: (e) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
  });
  const [deleteCoupon] = useMutation(M_DELETE, {
    onCompleted: () => { message.success("ลบโค้ดส่วนลดแล้ว"); refetch(); },
    onError: (e) => message.error(e?.message || "ลบไม่สำเร็จ"),
  });

  if (!permsLoading && !can("coupon.view")) {
    return <Alert type="warning" showIcon message="ไม่มีสิทธิ์ดูหน้านี้" />;
  }
  if (error) return <Alert type="error" showIcon message="โหลดรายการโค้ดส่วนลดไม่ได้" description={error.message} />;

  const rows = data?.bmsCoupons || [];

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: "PERCENT", active: true });
    setModalOpen(true);
  };
  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      code: r.code, type: r.type, value: r.value, minOrderAmount: r.minOrderAmount,
      maxRedemptions: r.maxRedemptions, perCustomerLimit: r.perCustomerLimit, active: r.active, note: r.note,
      startsAt: r.startsAt ? dayjs(r.startsAt) : null, expiresAt: r.expiresAt ? dayjs(r.expiresAt) : null,
    });
    setModalOpen(true);
  };

  const onFinish = async (v: any) => {
    await saveCoupon({
      variables: {
        input: {
          id: editing?.id ?? null,
          code: v.code, type: v.type, value: v.value,
          minOrderAmount: v.minOrderAmount ?? null, maxRedemptions: v.maxRedemptions ?? null,
          perCustomerLimit: v.perCustomerLimit ?? null, active: v.active ?? true, note: v.note ?? null,
          startsAt: v.startsAt ? v.startsAt.toISOString() : null,
          expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
        },
      },
    });
  };

  const columns = [
    { title: "โค้ด", dataIndex: "code", key: "code", render: (v: string) => <Text strong copyable>{v}</Text> },
    { title: "ส่วนลด", key: "value", render: (_: any, r: any) => valueLabel(r) },
    { title: "ขั้นต่ำ", dataIndex: "minOrderAmount", key: "minOrderAmount", render: money },
    {
      title: "ใช้ไปแล้ว", key: "usage",
      render: (_: any, r: any) => (
        <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setViewingRedemptions({ id: r.id, code: r.code })}>
          {r.redemptionsCount}{r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ""}
        </Button>
      ),
    },
    { title: "ต่อลูกค้า", dataIndex: "perCustomerLimit", key: "perCustomerLimit", render: (v: number | null) => v ?? "ไม่จำกัด" },
    {
      title: "ช่วงเวลา", key: "period",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span>เริ่ม: {r.startsAt ? new Date(r.startsAt).toLocaleDateString() : "ทันที"}</span>
          <span>หมดอายุ: {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "ไม่มี"}</span>
        </Space>
      ),
    },
    {
      title: "สถานะ", dataIndex: "active", key: "active",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "ใช้งาน" : "ปิดใช้งาน"}</Tag>,
    },
    ...(canManage ? [{
      title: "", key: "actions", width: 100,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="ลบโค้ดนี้?" onConfirm={() => deleteCoupon({ variables: { id: r.id } })}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>โค้ดส่วนลด</Typography.Title>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>สร้างโค้ดใหม่</Button>}
      </Space>

      <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? "แก้ไขโค้ดส่วนลด" : "สร้างโค้ดส่วนลด"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="code" label="โค้ด" rules={[{ required: true, message: "ระบุโค้ด" }]}>
            <Input placeholder="เช่น SAVE10" style={{ textTransform: "uppercase" }} />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="type" label="ประเภท" style={{ width: "40%" }} initialValue="PERCENT">
              <Select options={[
                { value: "PERCENT", label: "ลด % " },
                { value: "FIXED", label: "ลดเป็นจำนวนเงิน" },
              ]} />
            </Form.Item>
            <Form.Item name="value" label="มูลค่า" style={{ width: "60%" }} rules={[{ required: true, message: "ระบุมูลค่าส่วนลด" }]}>
              <InputNumber min={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="minOrderAmount" label="ยอดสั่งซื้อขั้นต่ำ (ไม่บังคับ)">
            <InputNumber min={0} style={{ width: "100%" }} placeholder="ไม่มีขั้นต่ำ" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="maxRedemptions" label="จำนวนครั้งที่ใช้ได้รวม" style={{ width: "50%" }}>
              <InputNumber min={1} style={{ width: "100%" }} placeholder="ไม่จำกัด" />
            </Form.Item>
            <Form.Item name="perCustomerLimit" label="จำนวนครั้ง/ลูกค้า" style={{ width: "50%" }}>
              <InputNumber min={1} style={{ width: "100%" }} placeholder="ไม่จำกัด" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="startsAt" label="เริ่มใช้ได้" style={{ width: "50%" }}>
              <DatePicker style={{ width: "100%" }} showTime placeholder="ทันที" />
            </Form.Item>
            <Form.Item name="expiresAt" label="หมดอายุ" style={{ width: "50%" }}>
              <DatePicker style={{ width: "100%" }} showTime placeholder="ไม่มีวันหมดอายุ" />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="note" label="โน้ต (ไม่บังคับ)">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="active" label="เปิดใช้งาน" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <RedemptionsModal
        couponId={viewingRedemptions?.id ?? null}
        code={viewingRedemptions?.code ?? ""}
        onClose={() => setViewingRedemptions(null)}
      />
    </div>
  );
}
