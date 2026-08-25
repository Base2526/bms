'use client';
import { gql, useQuery, useMutation, useLazyQuery } from "@apollo/client";
import {
  Table, Tag, Button, Space, Alert, message, Modal, Form, Input, InputNumber,
  Select, Switch, DatePicker, Popconfirm, Typography, Empty, Avatar, Statistic, Row, Col, Divider,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import dayjs from "dayjs";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";
import { useI18n } from "@/lib/i18nContext";

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
      orderId customerId customerName channel status discountAmount totalAmount createdAt
    }
  }
`;

// สีของ avatar ผูกกับตัวลูกค้า (hash ชื่อ/id) ไม่สุ่มใหม่ทุก render กันลูกค้าคนเดิมเปลี่ยนสีไปมา
const AVATAR_COLORS = ["#2f6fd6", "#e0762b", "#12805c", "#a24fc9", "#c9455a", "#0f9aa6"];
function avatarColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};

const money = (n: number | null) => (n == null ? "—" : `${Number(n).toLocaleString()} ฿`);

function valueLabel(r: any) {
  return r.type === "PERCENT" ? `${r.value}%` : money(r.value);
}

// คู่ field แนวนอนบน desktop — บนมือถือซ้อนกันแทน เพราะแบ่งครึ่งแล้วเหลือช่องละ ~150px
// (Space.Compact ยังเชื่อมขอบ input ให้ติดกัน ซึ่งบนจอแคบทำให้อ่านยากกว่าเดิม)
function FieldPair({ isMobile, children }: { isMobile: boolean; children: React.ReactNode }) {
  if (isMobile) return <>{children}</>;
  return <Space.Compact style={{ width: "100%" }}>{children}</Space.Compact>;
}

// ---- Usage history modal — ไม่มีตาราง redemption แยก, query ตรงจาก bms_orders ----
function RedemptionsModal({ couponId, code, onClose }: { couponId: string | null; code: string; onClose: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [load, { data, loading }] = useLazyQuery(Q_REDEMPTIONS, { fetchPolicy: "network-only" });

  useEffect(() => {
    if (couponId) load({ variables: { couponId } });
  }, [couponId, load]);

  const rows = data?.bmsCouponRedemptions || [];
  const totalDiscount = rows.reduce((sum: number, r: any) => sum + Number(r.discountAmount || 0), 0);
  const uniqueCustomers = new Set(rows.map((r: any) => r.customerId || r.customerName || r.orderId)).size;

  return (
    <Modal
      title={t("admin_coupons.redemptions_title", { code })}
      open={!!couponId}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("admin_coupons.btn_close")}</Button>}
      width={panelWidth(isMobile, 760)}
    >
      {!loading && rows.length > 0 && (
        <>
          <Row gutter={[16, 8]} style={{ marginBottom: 4 }}>
            <Col xs={12} sm={8}><Statistic title={t("admin_coupons.stat_used")} value={rows.length} suffix={t("admin_coupons.stat_used_suffix")} /></Col>
            <Col xs={12} sm={8}><Statistic title={t("admin_coupons.stat_total_discount")} value={totalDiscount} precision={2} suffix="฿" valueStyle={{ color: "#12805c" }} /></Col>
            <Col xs={12} sm={8}><Statistic title={t("admin_coupons.stat_customers")} value={uniqueCustomers} suffix={t("admin_coupons.stat_customers_suffix")} /></Col>
          </Row>
          <Divider style={{ margin: "12px 0" }} />
        </>
      )}
      <Table
        rowKey="orderId"
        size="small"
        loading={loading}
        dataSource={rows}
        locale={{ emptyText: <Empty description={t("admin_coupons.redemptions_empty")} /> }}
        pagination={{ pageSize: 10 }}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: t("admin_coupons.col_customer"), dataIndex: "customerName", width: 220,
            render: (v: string | null, r: any) => {
              const name = v || t("admin_coupons.unknown_customer");
              const key = r.customerId || v || r.orderId;
              return (
                <Space size={8}>
                  <Avatar size={26} style={{ backgroundColor: avatarColor(key), fontSize: 11, fontWeight: 700 }}>
                    {initials(name)}
                  </Avatar>
                  <Space direction="vertical" size={0}>
                    <Text strong style={{ fontSize: 13 }}>{name}</Text>
                    <Text type="secondary" copyable={{ text: r.orderId }} style={{ fontSize: 11 }}>
                      order · {String(r.orderId).slice(0, 8)}
                    </Text>
                  </Space>
                </Space>
              );
            },
          },
          { title: t("admin_coupons.col_channel"), dataIndex: "channel", width: 90 },
          {
            title: t("admin_coupons.col_order_status"), dataIndex: "status", width: 110,
            render: (v: string) => <Tag color={ORDER_STATUS_COLOR[v] || "default"}>{v}</Tag>,
          },
          { title: t("admin_coupons.col_discount_amount"), dataIndex: "discountAmount", width: 100, align: "right" as const, render: money },
          { title: t("admin_coupons.col_net_total"), dataIndex: "totalAmount", width: 100, align: "right" as const, render: money },
          { title: t("admin_coupons.col_when"), dataIndex: "createdAt", width: 140, render: (v: string) => new Date(v).toLocaleString() },
        ]}
      />
    </Modal>
  );
}

export default function CouponsPage() {
  const { t } = useI18n();
  const { can, loading: permsLoading } = useBmsPermissions();
  const isMobile = useIsMobile();
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
    onCompleted: () => { message.success(t("admin_coupons.save_success")); setModalOpen(false); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_coupons.save_failed")),
  });
  const [deleteCoupon] = useMutation(M_DELETE, {
    onCompleted: () => { message.success(t("admin_coupons.delete_success")); refetch(); },
    onError: (e) => message.error(e?.message || t("admin_coupons.delete_failed")),
  });

  if (!permsLoading && !can("coupon.view")) {
    return <Alert closable type="warning" showIcon message={t("admin_coupons.no_permission")} />;
  }
  if (error) return <Alert closable type="error" showIcon message={t("admin_coupons.load_error")} description={error.message} />;

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
    { title: t("admin_coupons.col_code"), dataIndex: "code", key: "code", render: (v: string) => <Text strong copyable>{v}</Text> },
    { title: t("admin_coupons.col_discount"), key: "value", render: (_: any, r: any) => valueLabel(r) },
    { title: t("admin_coupons.col_min_order"), dataIndex: "minOrderAmount", key: "minOrderAmount", render: money },
    {
      title: t("admin_coupons.col_usage"), key: "usage",
      render: (_: any, r: any) => (
        <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setViewingRedemptions({ id: r.id, code: r.code })}>
          {r.redemptionsCount}{r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ""}
        </Button>
      ),
    },
    { title: t("admin_coupons.col_per_customer"), dataIndex: "perCustomerLimit", key: "perCustomerLimit", render: (v: number | null) => v ?? t("admin_coupons.unlimited") },
    {
      title: t("admin_coupons.col_period"), key: "period",
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span>{t("admin_coupons.period_starts", { value: r.startsAt ? new Date(r.startsAt).toLocaleDateString() : t("admin_coupons.starts_immediately") })}</span>
          <span>{t("admin_coupons.period_expires", { value: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : t("admin_coupons.no_expiry") })}</span>
        </Space>
      ),
    },
    {
      title: t("admin_coupons.col_status"), dataIndex: "active", key: "active",
      render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? t("admin_coupons.status_active") : t("admin_coupons.status_inactive")}</Tag>,
    },
    ...(canManage ? [{
      title: "", key: "actions", width: 100,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title={t("admin_coupons.delete_confirm")} onConfirm={() => deleteCoupon({ variables: { id: r.id } })}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <AdminPageHeader title={<Typography.Title level={4} style={{ margin: 0 }}>{t("admin_coupons.title")}</Typography.Title>}>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("admin_coupons.btn_create")}</Button>}
      </AdminPageHeader>

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={rows as any[]}
          rowKey={(r) => r.id}
          totalText={(n) => t("admin_coupons.mobile_total", { n })}
          emptyText={t("admin_coupons.mobile_empty")}
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={
                <Space size={6} wrap>
                  <Text strong copyable>{r.code}</Text>
                  <Tag style={{ marginInlineEnd: 0 }}>{valueLabel(r)}</Tag>
                </Space>
              }
              extra={<Tag color={r.active ? "green" : "default"} style={{ marginInlineEnd: 0 }}>{r.active ? t("admin_coupons.status_active") : t("admin_coupons.status_inactive")}</Tag>}
              fields={[
                { label: t("admin_coupons.col_min_order"), value: money(r.minOrderAmount) },
                { label: t("admin_coupons.col_per_customer"), value: r.perCustomerLimit ?? t("admin_coupons.unlimited") },
                { label: t("admin_coupons.field_starts"), value: r.startsAt ? new Date(r.startsAt).toLocaleDateString() : t("admin_coupons.starts_immediately") },
                { label: t("admin_coupons.field_expires"), value: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : t("admin_coupons.no_expiry") },
                { label: t("admin_coupons.field_note"), value: r.note, hidden: !r.note },
              ]}
              actions={
                <>
                  <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setViewingRedemptions({ id: r.id, code: r.code })}>
                    {t("admin_coupons.mobile_usage", { count: r.redemptionsCount })}{r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ""}
                  </Button>
                  {canManage && (
                    <Space size={4} style={{ marginLeft: "auto" }}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                      <Popconfirm title={t("admin_coupons.delete_confirm")} onConfirm={() => deleteCoupon({ variables: { id: r.id } })}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  )}
                </>
              }
            />
          )}
        />
      ) : (
        <Table rowKey="id" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} scroll={{ x: "max-content" }} />
      )}

      <Modal
        title={editing ? t("admin_coupons.modal_edit_title") : t("admin_coupons.modal_create_title")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        width={panelWidth(isMobile, 520)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="code"
            label={t("admin_coupons.form_code")}
            rules={[{ required: true, message: t("admin_coupons.form_code_required") }]}
            extra={editing && editing.redemptionsCount > 0
              ? t("admin_coupons.form_code_locked", { count: editing.redemptionsCount })
              : undefined}
          >
            <Input
              placeholder={t("admin_coupons.form_code_placeholder")}
              style={{ textTransform: "uppercase" }}
              disabled={!!editing && editing.redemptionsCount > 0}
            />
          </Form.Item>
          <FieldPair isMobile={isMobile}>
            <Form.Item name="type" label={t("admin_coupons.form_type")} style={{ width: isMobile ? "100%" : "40%" }} initialValue="PERCENT">
              <Select options={[
                { value: "PERCENT", label: t("admin_coupons.form_type_percent") },
                { value: "FIXED", label: t("admin_coupons.form_type_fixed") },
              ]} />
            </Form.Item>
            <Form.Item name="value" label={t("admin_coupons.form_value")} style={{ width: isMobile ? "100%" : "60%" }} rules={[{ required: true, message: t("admin_coupons.form_value_required") }]}>
              <InputNumber min={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </FieldPair>
          <Form.Item name="minOrderAmount" label={t("admin_coupons.form_min_order")}>
            <InputNumber min={0} style={{ width: "100%" }} placeholder={t("admin_coupons.form_min_order_placeholder")} />
          </Form.Item>
          <FieldPair isMobile={isMobile}>
            <Form.Item name="maxRedemptions" label={t("admin_coupons.form_max_redemptions")} style={{ width: isMobile ? "100%" : "50%" }}>
              <InputNumber min={1} style={{ width: "100%" }} placeholder={t("admin_coupons.unlimited")} />
            </Form.Item>
            <Form.Item name="perCustomerLimit" label={t("admin_coupons.form_per_customer")} style={{ width: isMobile ? "100%" : "50%" }}>
              <InputNumber min={1} style={{ width: "100%" }} placeholder={t("admin_coupons.unlimited")} />
            </Form.Item>
          </FieldPair>
          <FieldPair isMobile={isMobile}>
            <Form.Item name="startsAt" label={t("admin_coupons.form_starts_at")} style={{ width: isMobile ? "100%" : "50%" }}>
              <DatePicker style={{ width: "100%" }} showTime placeholder={t("admin_coupons.starts_immediately")} />
            </Form.Item>
            <Form.Item name="expiresAt" label={t("admin_coupons.form_expires_at")} style={{ width: isMobile ? "100%" : "50%" }}>
              <DatePicker style={{ width: "100%" }} showTime placeholder={t("admin_coupons.form_expires_placeholder")} />
            </Form.Item>
          </FieldPair>
          <Form.Item name="note" label={t("admin_coupons.form_note")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="active" label={t("admin_coupons.form_active")} valuePropName="checked" initialValue={true}>
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
