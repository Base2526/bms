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

// ---- Types --------------------------------------------------
type PayStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "REFUNDED";
type PayMethod = "BANK_TRANSFER" | "QR" | "CARD" | "TIKTOK" | "CASH";
type Payment = {
  id: string; orderId: string; method: PayMethod; amount: number; status: PayStatus;
  slipUrl: string | null; slipRef: string | null; verifyResult: string | null;
  note: string | null; verifiedBy: string | null; createdAt: string; updatedAt: string;
};

// ---- GraphQL ------------------------------------------------
const Q_PAYMENTS = gql`
  query BmsPayments($search: String, $status: BmsPaymentStatus, $limit: Int) {
    bmsPayments(search: $search, status: $status, limit: $limit) {
      id orderId method amount status slipUrl slipRef verifyResult note verifiedBy createdAt updatedAt
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
const STATUS_LABEL: Record<PayStatus, string> = {
  PENDING: "รอยืนยัน", CONFIRMED: "ยืนยันแล้ว", REJECTED: "ปฏิเสธ", REFUNDED: "คืนเงินแล้ว",
};
const METHODS: PayMethod[] = ["BANK_TRANSFER", "QR", "CARD", "TIKTOK", "CASH"];
const METHOD_LABEL: Record<PayMethod, string> = {
  BANK_TRANSFER: "โอนธนาคาร", QR: "QR พร้อมเพย์", CARD: "บัตรเครดิต", TIKTOK: "TikTok Pay", CASH: "เงินสด",
};
const FILTERS = ["ALL", "PENDING", "CONFIRMED", "REJECTED", "REFUNDED"] as const;

function PaymentManagement() {
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

  const onErr = (e: any) => message.error(e?.message || "การทำรายการล้มเหลว");
  const payments: Payment[] = data?.bmsPayments || [];

  const [confirm, { loading: l1 }] = useMutation(M_CONFIRM, {
    onCompleted: (d: any) => {
      const r = d?.bmsConfirmPayment;
      r?.status === "CONFIRMED" ? (message.success(r.message || "ยืนยันแล้ว"), refetch()) : onErr({ message: r?.message });
    },
    onError: onErr,
  });
  const [reject, { loading: l2 }] = useMutation(M_REJECT, {
    onCompleted: (d: any) => d?.bmsRejectPayment ? (message.success("ปฏิเสธสลิปแล้ว"), refetch()) : onErr({ message: "ทำรายการไม่ได้" }),
    onError: onErr,
  });
  const [refund, { loading: l3 }] = useMutation(M_REFUND, {
    onCompleted: (d: any) => d?.bmsRefundPayment ? (message.success("คืนเงินแล้ว"), refetch()) : onErr({ message: "คืนเงินไม่ได้ (ต้องเป็นสถานะ CONFIRMED)" }),
    onError: onErr,
  });
  const [verify, { loading: l4 }] = useMutation(M_VERIFY, {
    onCompleted: (d: any) => {
      const v = d?.bmsVerifyPaymentSlip;
      if (!v) { onErr({ message: "ตรวจสลิปไม่ได้" }); return; }
      Modal.info({
        title: `ผลตรวจสลิป (${v.method === "ai" ? "AI" : "manual"})`,
        content: (
          <div>
            <p>ยอดที่ต้องชำระ: <b>{Number(v.expectedAmount).toLocaleString()} ฿</b></p>
            <p>ยอดตรงกัน: <Tag color={v.amountMatch ? "green" : "red"}>{v.amountMatch ? "ตรง" : "ไม่ตรง/อ่านไม่ได้"}</Tag></p>
            <p>{v.reason}</p>
            <Alert type="warning" showIcon message="AI แนะนำเท่านั้น — ต้องกดยืนยันรับชำระด้วยตนเอง" />
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
        btns.push(<Button key="verify" type="link" size="small" icon={<ScanOutlined />} disabled={busy} onClick={() => verify(v)}>ตรวจสลิป</Button>);
        btns.push(
          <Popconfirm key="confirm" title="ยืนยันการรับชำระ?" description="ออร์เดอร์จะเปลี่ยนเป็น PAID" okText="ยืนยัน" cancelText="ไม่" disabled={busy} onConfirm={() => confirm(v)}>
            <Button type="link" size="small" icon={<CheckCircleOutlined />} disabled={busy}>ยืนยัน</Button>
          </Popconfirm>
        );
        btns.push(
          <Popconfirm key="reject" title="ปฏิเสธสลิปนี้?" okText="ปฏิเสธ" okButtonProps={{ danger: true }} cancelText="ไม่" disabled={busy} onConfirm={() => reject(v)}>
            <Button type="link" size="small" danger icon={<CloseCircleOutlined />} disabled={busy}>ปฏิเสธ</Button>
          </Popconfirm>
        );
      }
    } else if (r.status === "CONFIRMED" && can("payment.refund")) {
      btns.push(
        <Popconfirm key="refund" title="คืนเงินรายการนี้?" description="ต้องได้รับอนุมัติจากผู้จัดการ" okText="คืนเงิน" okButtonProps={{ danger: true }} cancelText="ไม่" disabled={busy} onConfirm={() => refund(v)}>
          <Button type="link" size="small" danger icon={<RollbackOutlined />} disabled={busy}>คืนเงิน</Button>
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
      { title: "วิธี", dataIndex: "method", key: "method", width: 130,
        render: (m: PayMethod) => METHOD_LABEL[m] || m },
      { title: "ยอด", dataIndex: "amount", key: "amount", width: 110, align: "right" as const,
        render: (v: number) => `${Number(v).toLocaleString()} ฿` },
      { title: "อ้างอิง/สลิป", key: "ref",
        render: (_: any, r: Payment) => r.slipUrl
          ? <a href={r.slipUrl} target="_blank" rel="noreferrer">ดูสลิป</a>
          : (r.slipRef || <span style={{ color: "#999" }}>—</span>) },
      { title: "สถานะ", dataIndex: "status", key: "status", width: 140,
        render: (s: PayStatus) => <Tag color={STATUS_COLOR[s]}>{s} · {STATUS_LABEL[s]}</Tag> },
      { title: "ยืนยันโดย", dataIndex: "verifiedBy", key: "verifiedBy",
        render: (v: string | null) => v || <span style={{ color: "#999" }}>—</span> },
      { title: "เมื่อ", dataIndex: "createdAt", key: "createdAt", width: 160,
        render: (d: string) => new Date(d).toLocaleString() },
      { title: "Actions", key: "actions", width: 220,
        render: (_: any, r: Payment) => <Space size="small">{actionsFor(r)}</Space> },
    ],
    [busy, can]
  );

  if (error) return <Alert type="error" message="โหลดรายการชำระเงินไม่ได้" description={error.message} showIcon />;

  return (
    <div>
      <AdminPageHeader title="BMS Payment">
        <Input.Search
          placeholder="ค้นหา payment / order / slip ref"
          allowClear
          style={{ width: isMobile ? "100%" : 260 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <ResponsiveStatusFilter
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          labels={{ ALL: "ทุกสถานะ", ...STATUS_LABEL }}
        />
        {can("payment.submit") && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setSubmitOpen(true)}>บันทึกการชำระ</Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>Refresh</Button>
      </AdminPageHeader>

      <Alert
        type="info" showIcon closable style={{ marginBottom: 16 }}
        message="PENDING → (ตรวจสลิป/ยืนยัน) CONFIRMED (ออร์เดอร์เป็น PAID) · ปฏิเสธ → REJECTED · คืนเงิน → REFUNDED  |  ตรวจสลิปด้วย AI เป็นเพียงคำแนะนำ ต้องกดยืนยันเอง"
      />

      {isMobile ? (
        <AdminMobileList
          loading={loading}
          dataSource={payments}
          rowKey={(p) => p.id}
          totalText={(t) => `ทั้งหมด ${t} รายการ`}
          emptyText="ไม่มีรายการชำระเงิน"
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
                { label: "ออร์เดอร์", value: <Typography.Text code>{r.orderId.slice(0, 8)}</Typography.Text> },
                { label: "ยอด", value: <Typography.Text strong>{`${Number(r.amount).toLocaleString()} ฿`}</Typography.Text> },
                {
                  label: "อ้างอิง/สลิป",
                  value: r.slipUrl
                    ? <a href={r.slipUrl} target="_blank" rel="noreferrer">ดูสลิป</a>
                    : (r.slipRef || <span style={{ color: "#999" }}>—</span>),
                },
                { label: "ยืนยันโดย", value: r.verifiedBy || <span style={{ color: "#999" }}>—</span> },
                { label: "เมื่อ", value: new Date(r.createdAt).toLocaleString() },
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
  const isMobile = useIsMobile();
  const [form] = Form.useForm();
  const { data } = useQuery(Q_PENDING_ORDERS, { fetchPolicy: "cache-and-network", skip: !open });
  const orders: { id: string; customer_ref: string | null; total_amount: number; shipping_fee: number; amount_due: number }[] = data?.bmsOrders || [];

  const [submit, { loading }] = useMutation(M_SUBMIT, {
    onCompleted: (d: any) => {
      const r = d?.bmsSubmitPayment;
      if (r?.status === "SUBMITTED") { message.success(r.message || "บันทึกแล้ว"); form.resetFields(); onDone(); }
      else message.error(r?.message || "บันทึกไม่สำเร็จ");
    },
    onError: (e: any) => message.error(e?.message || "บันทึกไม่สำเร็จ"),
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
    <Modal title="บันทึกการชำระเงิน" open={open} onCancel={onClose} onOk={submitForm} width={panelWidth(isMobile, 520)}
      confirmLoading={loading} okText="บันทึก" cancelText="ยกเลิก" destroyOnClose>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message="เลือกออร์เดอร์ที่รอชำระ (PENDING) — เว้นยอดว่างได้ ระบบจะใช้ยอดรวมของออร์เดอร์" />
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label="ออร์เดอร์ (PENDING)" rules={[{ required: true, message: "เลือกออร์เดอร์" }]}>
          <Select showSearch placeholder="เลือกออร์เดอร์"
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.id.slice(0, 8)} · ${o.customer_ref ?? "-"} · ${Number(o.amount_due).toLocaleString()} ฿`,
            }))}
            filterOption={(i, o) => String(o?.label ?? "").toLowerCase().includes(i.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="method" label="วิธีชำระ" rules={[{ required: true, message: "เลือกวิธีชำระ" }]}>
          <Select options={METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} />
        </Form.Item>
        <Form.Item name="amount" label="ยอดชำระ (เว้นว่าง = ยอดรวมออร์เดอร์)">
          <InputNumber min={0} style={{ width: isMobile ? "100%" : 200 }} />
        </Form.Item>
        <Form.Item name="slipUrl" label="URL สลิป (เช่น /api/files/123)">
          <Input placeholder="/api/files/<id> (รูปสลิป สำหรับตรวจด้วย AI)" />
        </Form.Item>
        <Form.Item name="slipRef" label="เลขอ้างอิง (txn)">
          <Input placeholder="เช่น TXN123456" />
        </Form.Item>
        <Form.Item name="note" label="หมายเหตุ">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function Page() {
  return <PaymentManagement />;
}
