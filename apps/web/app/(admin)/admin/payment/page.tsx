'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table, Button, Space, Tag, message, Alert, Popconfirm,
  Typography, Modal, Form, Input, InputNumber, Select,
} from "antd";
import { useState, useMemo, useEffect } from "react";
import {
  ReloadOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined,
  RollbackOutlined, ScanOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile, panelWidth } from "@/app/hooks/useMediaQuery";
import AdminPageHeader, { ResponsiveStatusFilter } from "@/components/admin/AdminPageHeader";
import { AdminMobileList, AdminRecordCard } from "@/components/admin/AdminMobileList";
import { useI18n } from "@/lib/i18nContext";

// ---- Types --------------------------------------------------
type PayStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "REFUNDED";
type PayMethod = "BANK_TRANSFER" | "QR" | "CARD" | "TIKTOK" | "CASH" | "WALLET" | "STORE_CREDIT" | "CREDIT";
type Payment = {
  id: string; orderId: string; method: PayMethod; amount: number; status: PayStatus;
  completedRefundAmount: number; pendingRefundAmount: number; netAmount: number;
  slipUrl: string | null; slipRef: string | null; verifyResult: string | null;
  note: string | null; verifiedBy: string | null; createdAt: string; updatedAt: string;
};

// ---- GraphQL ------------------------------------------------
const Q_PAYMENTS = gql`
  query BmsPayments($search: String, $status: BmsPaymentStatus, $limit: Int) {
    bmsPayments(search: $search, status: $status, limit: $limit) {
      id orderId method amount completedRefundAmount pendingRefundAmount netAmount
      status slipUrl slipRef verifyResult note verifiedBy createdAt updatedAt
    }
  }
`;
const Q_PENDING_ORDERS = gql`
  query { bmsOrders(status: PENDING, limit: 200) { id customer_ref total_amount shipping_fee amount_due } }
`;
const M_SUBMIT = gql`
  mutation ($orderId: ID!, $method: BmsPaymentMethod!, $amount: Float, $slipUrl: String, $slipRef: String, $note: String) {
    bmsSubmitPayment(orderId: $orderId, method: $method, amount: $amount, slipUrl: $slipUrl, slipRef: $slipRef, note: $note) {
      status paymentId message
    }
  }
`;
const M_CONFIRM = gql`mutation ($id: ID!) { bmsConfirmPayment(id: $id) { status message } }`;
const M_REJECT = gql`mutation ($id: ID!, $note: String) { bmsRejectPayment(id: $id, note: $note) }`;
const M_REFUND = gql`mutation ($id: ID!) { bmsRefundPayment(id: $id) }`;
const M_VERIFY = gql`
  mutation ($id: ID!) {
    bmsVerifyPaymentSlip(id: $id) { method expectedAmount amountMatch verified reason checkedAt }
  }
`;

const STATUS_COLOR: Record<PayStatus, string> = {
  PENDING: "orange", CONFIRMED: "green", REJECTED: "red", REFUNDED: "purple",
};
function statusLabels(t: (key: string) => string): Record<PayStatus, string> {
  return {
    PENDING: t("admin_payment.status_pending"),
    CONFIRMED: t("admin_payment.status_confirmed"),
    REJECTED: t("admin_payment.status_rejected"),
    REFUNDED: t("admin_payment.status_refunded"),
  };
}
const SUBMIT_METHODS: Exclude<PayMethod, "CREDIT">[] = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH", "WALLET", "STORE_CREDIT"];
function methodLabels(t: (key: string) => string): Record<PayMethod, string> {
  return {
    BANK_TRANSFER: t("admin_payment.method_bank_transfer"),
    QR: t("admin_payment.method_qr"),
    CARD: t("admin_payment.method_card"),
    TIKTOK: "TikTok Pay",
    CASH: t("admin_payment.method_cash"),
    WALLET: t("admin_payment.method_wallet"),
    STORE_CREDIT: t("admin_payment.method_store_credit"),
    CREDIT: t("admin_payment.method_credit"),
  };
}
const FILTERS = ["ALL", "PENDING", "CONFIRMED", "REJECTED", "REFUNDED"] as const;

const baht = (n: number) => `${Number(n || 0).toLocaleString()} ฿`;

function PaymentAmountBreakdown({ payment }: { payment: Payment }) {
  const { t } = useI18n();
  const completedRefund = Number(payment.completedRefundAmount || 0);
  const pendingRefund = Number(payment.pendingRefundAmount || 0);
  const hasRefund = completedRefund > 0 || pendingRefund > 0;
  if (!hasRefund) return <Typography.Text>{baht(payment.amount)}</Typography.Text>;
  return (
    <Space direction="vertical" size={0} style={{ textAlign: "right" }}>
      <Typography.Text>{t("admin_payment.amount_received")} {baht(payment.amount)}</Typography.Text>
      {completedRefund > 0 && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {t("admin_payment.amount_refunded")} {baht(completedRefund)}
        </Typography.Text>
      )}
      {pendingRefund > 0 && (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          {t("admin_payment.amount_pending_refund")} {baht(pendingRefund)}
        </Typography.Text>
      )}
      <Typography.Text type="success" strong style={{ fontSize: 12 }}>
        {t("admin_payment.amount_net")} {baht(payment.netAmount)}
      </Typography.Text>
    </Space>
  );
}

function PaymentManagement() {
  const { t } = useI18n();
  const STATUS_LABEL = statusLabels(t);
  const METHOD_LABEL = methodLabels(t);
  const { can } = useBmsPermissions();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, refetch } = useQuery(Q_PAYMENTS, {
    variables: { search: search || null, status: filter === "ALL" ? null : filter, limit: 200 },
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || t("admin_payment.action_failed"));
  const payments: Payment[] = data?.bmsPayments || [];

  const [confirm, { loading: l1 }] = useMutation(M_CONFIRM, {
    onCompleted: (d: any) => {
      const r = d?.bmsConfirmPayment;
      r?.status === "CONFIRMED" ? (message.success(r.message || t("admin_payment.confirm_success")), refetch()) : onErr({ message: r?.message });
    },
    onError: onErr,
  });
  const [reject, { loading: l2 }] = useMutation(M_REJECT, {
    onCompleted: (d: any) => d?.bmsRejectPayment ? (message.success(t("admin_payment.reject_success")), refetch()) : onErr({ message: t("admin_payment.reject_failed") }),
    onError: onErr,
  });
  const [refund, { loading: l3 }] = useMutation(M_REFUND, {
    onCompleted: (d: any) => d?.bmsRefundPayment ? (message.success(t("admin_payment.refund_success")), refetch()) : onErr({ message: t("admin_payment.refund_failed") }),
    onError: onErr,
  });
  const [verify, { loading: l4 }] = useMutation(M_VERIFY, {
    onCompleted: (d: any) => {
      const v = d?.bmsVerifyPaymentSlip;
      if (!v) { onErr({ message: t("admin_payment.verify_failed") }); return; }
      Modal.info({
        title: t("admin_payment.verify_result_title", { method: v.method === "ai" ? "AI" : "manual" }),
        content: (
          <div>
            <p>{t("admin_payment.verify_amount_due")} <b>{Number(v.expectedAmount).toLocaleString()} ฿</b></p>
            <p>{t("admin_payment.verify_amount_match")} <Tag color={v.amountMatch ? "green" : "red"}>{v.amountMatch ? t("admin_payment.verify_match_yes") : t("admin_payment.verify_match_no")}</Tag></p>
            <p>{v.reason}</p>
            <Alert closable type="warning" showIcon message={t("admin_payment.verify_ai_disclaimer")} />
          </div>
        ),
      });
      refetch();
    },
    onError: onErr,
  });
  const busy = l1 || l2 || l3 || l4;

  const actionsFor = (r: Payment) => {
    const v = { variables: { id: r.id } };
    const btns: any[] = [];
    if (r.status === "PENDING") {
      if (can("payment.confirm")) {
        btns.push(<Button key="verify" type="link" size="small" icon={<ScanOutlined />} disabled={busy} onClick={() => verify(v)}>{t("admin_payment.btn_verify")}</Button>);
        btns.push(
          <Popconfirm key="confirm" title={t("admin_payment.confirm_confirm_title")} description={t("admin_payment.confirm_confirm_desc")} okText={t("admin_payment.confirm_ok_text")} cancelText={t("admin_payment.no_text")} disabled={busy} onConfirm={() => confirm(v)}>
            <Button type="link" size="small" icon={<CheckCircleOutlined />} disabled={busy}>{t("admin_payment.btn_confirm")}</Button>
          </Popconfirm>
        );
        btns.push(
          <Popconfirm key="reject" title={t("admin_payment.reject_confirm_title")} okText={t("admin_payment.reject_ok_text")} okButtonProps={{ danger: true }} cancelText={t("admin_payment.no_text")} disabled={busy} onConfirm={() => reject(v)}>
            <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={busy}>{t("admin_payment.btn_reject")}</Button>
          </Popconfirm>
        );
      }
    } else if (r.status === "CONFIRMED" && can("payment.refund")) {
      btns.push(
        <Popconfirm key="refund" title={t("admin_payment.refund_confirm_title")} description={t("admin_payment.refund_confirm_desc")} okText={t("admin_payment.refund_ok_text")} okButtonProps={{ danger: true }} cancelText={t("admin_payment.no_text")} disabled={busy} onConfirm={() => refund(v)}>
          <Button type="link" size="small" danger icon={<RollbackOutlined />} disabled={busy}>{t("admin_payment.btn_refund")}</Button>
        </Popconfirm>
      );
    }
    return btns.length ? btns : [<span key="none" style={{ color: "#999" }}>—</span>];
  };

  const columns = useMemo(
    () => [
      { title: "Payment", dataIndex: "id", key: "id", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: "Order", dataIndex: "orderId", key: "orderId", width: 100,
        render: (id: string) => <Typography.Text code>{id.slice(0, 8)}</Typography.Text> },
      { title: t("admin_payment.col_method"), dataIndex: "method", key: "method", width: 130,
        render: (m: PayMethod) => METHOD_LABEL[m] || m },
      { title: t("admin_payment.col_amount"), dataIndex: "amount", key: "amount", width: 190, align: "right" as const,
        render: (_v: number, r: Payment) => <PaymentAmountBreakdown payment={r} /> },
      { title: t("admin_payment.col_ref_slip"), key: "ref",
        render: (_: any, r: Payment) => r.slipUrl
          ? <a href={r.slipUrl} target="_blank" rel="noreferrer">{t("admin_payment.view_slip")}</a>
          : (r.slipRef || <span style={{ color: "#999" }}>—</span>) },
      { title: t("admin_payment.col_status"), dataIndex: "status", key: "status", width: 140,
        render: (s: PayStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: t("admin_payment.col_verified_by"), dataIndex: "verifiedBy", key: "verifiedBy",
        render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span> },
      { title: t("admin_payment.col_created"), dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 220,
        render: (_: any, r: Payment) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [busy, can, STATUS_LABEL, METHOD_LABEL, t]
  );

  if (error) return <Alert closable type="error" message={t("admin_payment.load_error")} description={error.message} showIcon />;

  return (
    <div>
      <AdminPageHeader title="BMS Payment">
        <Input.Search
          placeholder={t("admin_payment.search_placeholder")}
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ResponsiveStatusFilter
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: t("admin_payment.status_all"), ...STATUS_LABEL }}
        />
        {can("payment.submit") && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setSubmitOpen(true)}>{t("admin_payment.btn_submit_payment")}</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message={t("admin_payment.workflow_hint")}
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={payments}
          rowKey={(p) => p.id}
          totalText={(count) => t("admin_payment.mobile_total", { n: count })}
          emptyText={t("admin_payment.mobile_empty")}
          renderItem={(r) => (
            <AdminRecordCard
              key={r.id}
              title={
                <Space size={6} wrap>
                  <Typography.Text code>{r.id.slice(0, 8)}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {METHOD_LABEL[r.method] || r.method}
                  </Typography.Text>
                </Space>
              }
              extra={<Tag color={STATUS_COLOR[r.status]} style={{ marginInlineEnd: 0 }}>{STATUS_LABEL[r.status]}</Tag>}
              fields={[
                { label: t("admin_payment.field_order"), value: <Typography.Text code>{r.orderId.slice(0, 8)}</Typography.Text> },
                { label: t("admin_payment.col_amount"), value: <PaymentAmountBreakdown payment={r} /> },
                {
                  label: t("admin_payment.col_ref_slip"),
                  value: r.slipUrl
                    ? <a href={r.slipUrl} target="_blank" rel="noreferrer">{t("admin_payment.view_slip")}</a>
                    : (r.slipRef || <span style={{ color: "#999" }}>—</span>),
                },
                { label: t("admin_payment.col_verified_by"), value: r.verifiedBy || <span style={{ color: "#999" }}>—</span> },
                { label: t("admin_payment.col_created"), value: new Date(r.createdAt).toLocaleString() },
              ]}
              actions={actionsFor(r)}
            />
          )}
        />
      ) : (
        <Table rowKey="id" loading={loading} dataSource={payments} columns={columns}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (t) => `Total ${t} payment(s)` }}
        />
      )}

      <SubmitPaymentModal open={submitOpen} onClose={() => setSubmitOpen(false)} onDone={() => { setSubmitOpen(false); refetch(); }} />
    </div>
  );
}

// ---- Submit payment modal -----------------------------------
function SubmitPaymentModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const { data } = useQuery(Q_PENDING_ORDERS, { fetchPolicy: "cache-and-network", skip: !open });
  const orders: { id: string; customer_ref: string | null; total_amount: number; shipping_fee: number; amount_due: number }[] = data?.bmsOrders || [];
  const methodLabelMap = methodLabels(t);

  const [submit, { loading }] = useMutation(M_SUBMIT, {
    onCompleted: (d: any) => {
      const r = d?.bmsSubmitPayment;
      if (r?.status === "SUBMITTED") { message.success(r.message || t("admin_payment.submit_success")); form.resetFields(); onDone(); }
      else message.error(r?.message || t("admin_payment.submit_failed"));
    },
    onError: (e: any) => message.error(e?.message || t("admin_payment.submit_failed")),
  });

  const submitForm = async () => {
    const v = await form.validateFields();
    submit({ variables: {
      orderId: v.orderId, method: v.method,
      amount: v.amount != null ? Number(v.amount) : null,
      slipUrl: v.slipUrl || null, slipRef: v.slipRef || null, note: v.note || null,
    } });
  };

  return (
    <Modal title={t("admin_payment.submit_modal_title")} open={open} onCancel={onClose} onOk={submitForm} width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText={t("admin_payment.submit_ok_text")} cancelText={t("admin_payment.submit_cancel_text")} destroyOnClose>
      <Alert closable type="info" showIcon style={{ marginBottom: 16 }}
        message={t("admin_payment.submit_alert")} />
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label={t("admin_payment.order_label")} rules={[{ required: true, message: t("admin_payment.order_required") }]}>
          <Select showSearch placeholder={t("admin_payment.order_placeholder")}
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.id.slice(0, 8)} · ${o.customer_ref ?? "-"} · ${Number(o.amount_due).toLocaleString()} ฿`,
            }))}
            filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="method" label={t("admin_payment.method_label")} rules={[{ required: true, message: t("admin_payment.method_required") }]}>
          <Select options={SUBMIT_METHODS.map((m) => ({ value: m, label: methodLabelMap[m] }))} />
        </Form.Item>
        <Form.Item name="amount" label={t("admin_payment.amount_label")}>
          <InputNumber min={0} style={{ width: isMobile ? "100%" : 200 }} />
        </Form.Item>
        <Form.Item name="slipUrl" label={t("admin_payment.slip_url_label")}>
          <Input placeholder={t("admin_payment.slip_url_placeholder")} />
        </Form.Item>
        <Form.Item name="slipRef" label={t("admin_payment.slip_ref_label")}>
          <Input placeholder={t("admin_payment.slip_ref_placeholder")} />
        </Form.Item>
        <Form.Item name="note" label={t("admin_payment.note_label")}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function Page() {
  return <PaymentManagement />;
}
